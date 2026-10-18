// Hive Adapt (Project 0 port): the first-run tutorial (UI/TutorialController.cs) and the field guide (UI/FieldGuide.cs).
// Web: both run once per visit (nothing is stored): the tutorial on the visit's first run (F1 / tap skips), field-guide cards the
// first time each enemy shows up this visit, plus a one-time jump-pad hint near the pads outside the walls.
import * as THREE from 'three'
import { TUTORIAL, FIELD_GUIDE, JUMP_PAD_HINT, UI } from './rundata.js'
import { KINDS } from './enemydata.js'

/**
 * createTutorial(G, ctx): ctx = { onHold(bool) } . Steps complete from real events; the next shows 0.9 s after.
 * Events fed by run.js: shot, jump, dodge, weapon, towerBuilt, focus(kind), gear, jumpPad, combat.
 */
export function createTutorial(G) {
  const T = { active: false, step: 0, doneAt: -1, moved: 0, shots: 0, heldFire: 0, last: new THREE.Vector3(), started: 0 }
  const touch = () => !!(G.touch || (G.input && G.input.touch))
  T.begin = () => {
    T.active = true
    T.show(0)
  }
  T.show = i => {
    T.step = Math.max(0, Math.min(TUTORIAL.length - 1, i))
    T.doneAt = -1
    T.moved = 0
    T.shots = 0
    T.heldFire = 0
    if (G.player && G.player.pos) T.last.copy(G.player.pos)
  }
  T.complete = i => {
    if (!T.active || i !== T.step || T.doneAt >= 0) return
    T.doneAt = G.rt || 0
    G.sfx && G.sfx('ui_click', { vol: 0.8, rate: 1.25, ui: true })
  }
  T.finish = () => { if (!T.active) return; T.active = false; G.hud && G.hud.tutorial && G.hud.tutorial(null) }
  /** events from the game (run.js forwards them) */
  T.event = (name, arg) => {
    if (!T.active) return
    switch (name) {
      case 'shot': if (T.step === 1 && ++T.shots >= 3) T.complete(1); break
      case 'shotEvent': T.shotEvents = true; T.event('shot'); break
      case 'jump': T.complete(2); break
      case 'dodge': T.complete(3); break
      case 'weapon': T.complete(4); break
      case 'towerBuilt': T.complete(5); break
      case 'focus': if (arg === 'barricade') T.complete(6); else if (arg === 'core') T.complete(7); break
      case 'gear': T.complete(8); break
      case 'jumpPad': T.complete(9); break
      case 'combat': T.complete(10); T.finish(); break
    }
  }
  /** per frame (real time): movement, input-based fallbacks, proximity steps, advancing */
  T.update = (rdt, inRun) => {
    if (!T.active) return
    const p = G.player
    if (inRun && p && p.pos && T.doneAt < 0) {
      if (T.step === 0) {
        const dx = p.pos.x - T.last.x, dz = p.pos.z - T.last.z
        T.moved += Math.min(Math.hypot(dx, dz), 1)
        T.last.copy(p.pos)
        if (T.moved >= 5) T.complete(0)
      }
      const inp = G.input || {}
      const blocked = !!(G.hud && G.hud.blocking && G.hud.blocking())
      const pr = inp.pressed || new Set()
      if (!blocked && p.alive !== false) {
        // input fallbacks (the fighter's own events are used when player.js / weapons.js emit them)
        if (T.step === 1 && !T.shotEvents) {
          if (pr.has('fire')) T.event('shot')
          if (inp.fireHeld) { T.heldFire += rdt; if (T.heldFire >= 0.15) { T.heldFire = 0; T.event('shot') } }
        }
        if (T.step === 2 && pr.has('jump')) T.complete(2)
        if (T.step === 3 && pr.has('dodge')) T.complete(3)
        if (T.step === 4 && (pr.has('weapon1') || pr.has('weapon2') || pr.has('next') || pr.has('prev'))) T.complete(4)
      }
      const W = G.world
      if (T.step === 6 && W && W.barricadeSlots) for (const b of W.barricadeSlots) if (Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) <= 4.2 && Math.abs(p.pos.y - b.pos.y) <= 3) T.complete(6)
      if (T.step === 7 && W && W.core && Math.hypot(p.pos.x - W.core.pos.x, p.pos.z - W.core.pos.z) <= 5.2 && Math.abs(p.pos.y - W.core.pos.y) <= 3) T.complete(7)
    }
    if (T.doneAt >= 0 && (G.rt || 0) - T.doneAt > 0.9) {
      if (T.step + 1 < TUTORIAL.length) T.show(T.step + 1)
      else T.finish()
    }
  }
  T.model = onSkip => {
    if (!T.active) return null
    const s = TUTORIAL[T.step]
    const t = touch()
    return { step: T.step + 1, total: TUTORIAL.length, title: s.title, keys: t && s.touchKeys ? s.touchKeys : s.keys, body: t && s.touchBody ? s.touchBody : s.body, done: T.doneAt >= 0, onSkip }
  }
  return T
}

/**
 * createFieldGuide(G): one-time cards per visit. offer(kind) on a new enemy, hint(def) for the jump pad; log for the Hive guide.
 * visit = { seen:Set, log:[] } survives runs.
 */
export function createFieldGuide(G, visit) {
  const FG = {}
  FG.offer = kind => {
    const d = KINDS[kind]
    const body = FIELD_GUIDE[kind]
    if (!d || !body || visit.seen.has(kind)) return false
    visit.seen.add(kind)
    const queen = !!d.isBoss
    const colour = queen ? UI.danger : kind === 'SiegeNode' ? UI.siegeGuide : UI.amber
    const kicker = queen ? 'Field guide  ·  queen' : 'Field guide  ·  new enemy'
    G.hud && G.hud.fieldGuide && G.hud.fieldGuide(kicker, d.displayName, body, colour)
    visit.log.push({ kicker, title: d.displayName, body, colour })
    return true
  }
  FG.hint = (def = JUMP_PAD_HINT) => {
    if (visit.seen.has(def.id)) return false
    visit.seen.add(def.id)
    G.hud && G.hud.fieldGuide && G.hud.fieldGuide(def.kicker, def.title, def.body, UI.inter)
    visit.log.push({ kicker: def.kicker, title: def.title, body: def.body, colour: UI.inter })
    return true
  }
  /** the jump-pad hint: the first time the player comes within 14 m of a pad outside the walls */
  FG.update = () => {
    if (visit.seen.has(JUMP_PAD_HINT.id)) return
    const p = G.player && G.player.pos, pads = G.world && G.world.jumpPads
    if (!p || !pads) return
    for (const jp of pads) if (jp.outside && jp.pos && Math.hypot(p.x - jp.pos.x, p.z - jp.pos.z) < 14) { FG.hint(); return }
  }
  return FG
}
