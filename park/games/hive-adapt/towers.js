// Hive Adapt (Project 0 port): TOWERS module (createTowers(G) -> API in CONTRACT.md "towers.js").
// The defenders' side: turrets on the 14 build pads (turrets.js), the 4 barricade slots (barricades.js), the Frontier Core with
// its Core Shield (Core level 0-5: the base's look via world.setStage, +10 % turret damage per level above 1), and the
// BuildInteractor (focus pad > barricade > Core, E/Q actions, replace by double Q), the world-anchored build prompt
// (hud.prompt), result / error toasts, turret status alerts (hud.turretCallout, merge 0.35 s / throttle 2.5 s / quiet 8 s) and
// turret edge markers (pushed to G.markers). Ports Scripts/Towers/*.cs, Defence/Barricade.cs, CoreShield.cs,
// Core/CoreController.cs, UI/HudController.World.cs / .Turrets.cs and UI/BuildGhost.cs.
//
// ---------------------------------------------------------------- integration notes
// await towers.load()              turret tier models, barricade tier visuals, ghost, bars; then reset() (2 free gate turrets)
// towers.update(dt, rdt)           every unpaused frame (main.js)
// towers.reset()                   new run: no turrets but the free Ballistic L1 on Gate A-L / Gate B-L (no build event),
//                                  empty barricade slots, Core 1800/1800, shield level 0, world.setStage(0, { instant })
// towers.rechargeShield()          wave cleared (CoreShield.OnWaveCleared): full charge, flash, sound if it was down
// towers.repairCore(amount)        free Core heal (supply pod "Core patched +150"); returns HP restored
// towers.repairBarricadesFree()    supply pod "2 barricades repaired"; returns how many (alias repairAllBarricades; healCore = repairCore)
// towers.addShieldLevel()          free Core Shield level (Matriarch reward) -> false at max; fortifyBarricades() (Queen's Hoard);
//                                  applyMods() when G.run.mods change (barricade max HP follows mods.barricadeHp)
// towers.core                      { hp, max, alive, shield, shieldMax, shieldLevel, boostPct, hit } (hit: true for 0.12 s
//                                  after Core HP damage) -> pass straight to hud.core(towers.core)
// towers.displayName(sourceId)     'Ballistic#6' -> 'Ballistic Turret' (kill feed)
// Economy: G.run.canAfford(n) / spend(n, reason) / earn(n, reason) and G.run.phase; while run.js is a stub (or missing) an
// internal balance is used: towers.econ = { biomass, phase } (tests set it). spend() is only called after canAfford().
// Events: towerBuilt(t), towerUpgraded(t), towerRepaired(t), towerRebuilt(t), towerReplaced(t, old), towerWrecked(t),
// barricadeBuilt(b), barricadeUpgraded(b), barricadeRepaired(b), barricadeBroken(b), coreDamaged(final = hull removed + shield
// soaked, enemy, info), coreDestroyed(enemy, info), coreRepaired(amount), shieldBought(level), shieldDown,
// focus(kind 'pad'|'barricade'|'core'|null). Turret records: t.pad = world pad, t.padIndex, t.type, t.level, t.label, t.hp/maxHp ...
// Toasts owned here: every build / upgrade / repair result and error, "Core Shield down", "<slot> barricade is down".
import * as THREE from 'three'
import { clamp, clamp01, num, rng } from './u.js'
import {
  TD, createTurrets, damageAt, fireRateAt, rangeAt, upgradeCostFor, repairCostFor, rebuildCostAt, salvageAt, dpsLabel,
} from './turrets.js'
import { createBarricades, BARRICADE } from './barricades.js'

const f32 = Math.fround
const CORE_MAX = 1800
const SHIELD = { capacity: [0, 250, 450, 675, 925, 1200], cost: [120, 150, 190, 240, 300], perLevel: 0.1 }
const RANGE = { pad: 2.8, padDy: 1.5, core: 5.2, coreSurface: 2.8, barricade: 4.2, barricadeDy: 3 }
const NO_MODS = { turretDamage: 0, barricadeHp: 0, shieldCapacity: 0 }
const HUDC = { amber: [255, 181, 71], cyan: [84, 219, 255], shield: [158, 204, 255], jam: [184, 92, 255], danger: [255, 74, 46] }
const MODE = { None: 0, BuildOptions: 1, BuildLocked: 2, Upgrade: 3, MaxLevel: 4, Repair: 5, Rebuild: 6, Core: 7, Barricade: 8 }
const ALERT = { merge: 0.35, throttle: 2.5, quiet: 8, seconds: 4.5 }
const TYPES = ['Ballistic', 'Energy']
const SHIELD_HIT_SFX = ['sfx_shield_hit_0', 'sfx_shield_hit_1'], CORE_HIT_SFX = ['sfx_core_hit_0', 'sfx_core_hit_1']

/** a module still being written is a Proxy stub that answers every property with a function */
const isStub = o => !o || typeof o.__towersProbe === 'function'

export function createTowers(G) {
  const R = rng(9137)
  const world = () => G.world
  const hud = () => G.hud || {}

  // ---------------------------------------------------------------- economy (run.js, or an internal balance meanwhile)
  const econ = { biomass: 150, phase: 'build' }
  const runReal = () => !isStub(G.run) && typeof G.run.phase === 'string'
  const balance = () => (runReal() ? (typeof G.run.biomass === 'number' ? G.run.biomass : 0) : econ.biomass)
  const phase = () => (runReal() ? G.run.phase : econ.phase)
  const buildPhase = () => phase() === 'build'
  const ended = () => phase() === 'over'
  function mods() {
    const m = runReal() ? G.run.mods : null
    return m && typeof m === 'object' ? m : NO_MODS
  }
  const modv = k => { const v = mods()[k]; return typeof v === 'number' && isFinite(v) ? v : 0 }
  function canAfford(n) { return n <= 0 || (runReal() && typeof G.run.canAfford === 'function' ? !!G.run.canAfford(n) : balance() >= n) }
  // co-op: an ally's build arrives as an op and is applied free (they paid on their own machine); `ally` names them in the toast
  let freeMode = false, ally = ''
  /** TrySpend: null on success, else the refusal message */
  function trySpend(n, reason) {
    if (freeMode) return null
    if (!(n > 0)) return null
    const fail = () => `Not enough Biomass: need ${n}, have ${Math.max(0, Math.floor(balance()))}`
    if (!canAfford(n)) return fail()
    if (runReal()) { if (G.run.spend(n, reason) === false) return fail() } else econ.biomass -= n
    return null
  }
  function earn(n, reason) { if (freeMode || !(n > 0)) return; if (runReal()) G.run.earn(n, reason); else econ.biomass += n }
  const guest = () => !!(G.net && G.net.client)

  // ---------------------------------------------------------------- the shared kit for the helpers
  const fxOpts = { normal: null, dir: null, colour: null, scale: 1 }
  const sfxOpts = { pos: null, vol: 1, rate: 1, gap: 0.04, ui: false }
  const fxReal = () => !!G.fx && !isStub(G.fx)
  const K = {
    G,
    mods: () => ({ turretDamage: modv('turretDamage'), barricadeHp: modv('barricadeHp'), shieldCapacity: modv('shieldCapacity') }),
    /** G.fx.burst(kind, pos, opts) without allocating */
    fx(kind, pos, normal, dir, scale) {
      const fx = G.fx
      if (!fx || typeof fx.burst !== 'function') return
      fxOpts.normal = normal || null; fxOpts.dir = dir || null; fxOpts.scale = scale || 1
      try { fx.burst(kind, pos, fxOpts) } catch (e) { /* fx in progress */ }
    },
    /** G.fx[name](...args) when fx.js is real; false while it is a stub (the caller draws a fallback) */
    fxCall(name, a, b, c, d, e) {
      if (!fxReal() || typeof G.fx[name] !== 'function') return false
      try { G.fx[name](a, b, c, d, e) } catch (err) { return false }
      return true
    },
    sfx(name, pos, vol = 1, rate = 1, gap = 0.04, ui = false) {
      if (!G.sfx) return
      sfxOpts.pos = pos || null; sfxOpts.vol = vol; sfxOpts.rate = rate; sfxOpts.gap = gap; sfxOpts.ui = ui
      G.sfx(name, sfxOpts)
    },
    pick: arr => arr[(R() * arr.length) | 0],
    rand: R,
    corePos: () => world().core.pos,
    turretDamageMult: () => (1 + modv('turretDamage')) * (1 + SHIELD.perLevel * Math.max(0, core.shieldLevel - 1)),
    onStatus: (t, off) => alertStatus(t, off),
    onWarning: t => flag(t),
    onWrecked: t => { emit('towerWrecked', t) },
    onBroken: b => {
      emit('barricadeBroken', b)
      toast(`${b.label} barricade is down`, 'error')
    },
  }
  const emit = (name, ...a) => { if (G.events) G.events.emit(name, ...a) }
  const toast = (text, kind) => { const h = hud(); if (h.toast) h.toast(text, kind) }

  const turrets = createTurrets(K)
  const barricades = createBarricades(K)
  const padTurret = new Array(14).fill(null)

  // ---------------------------------------------------------------- the Core + Core Shield
  const core = {
    hp: CORE_MAX, max: CORE_MAX, alive: true, shield: 0, shieldMax: 0, shieldLevel: 0, boostPct: 0, hitT: -10,
    get hit() { return G.time - this.hitT < 0.12 },
    get level() { return this.shieldLevel },
  }
  const shieldState = { hitSoundCd: 0, coreSoundCd: 0, domeVisible: null, domeI: -1 }
  const domeArg = { visible: null, intensity: null, flash: null, hitPoint: null, tint: undefined }
  function dome(visible, intensity, flash, hitPoint) {
    const w = world()
    if (!w || !w.setDome) return
    domeArg.visible = visible; domeArg.intensity = intensity; domeArg.flash = flash; domeArg.hitPoint = hitPoint
    w.setDome(domeArg)
  }
  const shieldCapacity = L => f32(SHIELD.capacity[clamp(L, 0, 5)] * f32(1 + modv('shieldCapacity')))
  const turretBonusAt = L => SHIELD.perLevel * Math.max(0, clamp(L, 0, 5) - 1)
  function setShieldLevel(L, instant) {
    const prev = core.shieldLevel
    core.shieldLevel = clamp(L | 0, 0, 5)
    core.shieldMax = shieldCapacity(core.shieldLevel)
    core.shield = core.shieldMax
    core.boostPct = Math.round(turretBonusAt(core.shieldLevel) * 100)
    if (!instant) dome(null, null, 1, null)
    const w = world()
    if (w && w.setStage && (core.shieldLevel !== prev || instant)) w.setStage(core.shieldLevel, instant ? { instant: true } : undefined)
  }
  function rechargeShield() {
    if (core.shieldLevel <= 0) return false
    const cap = shieldCapacity(core.shieldLevel)
    if (core.shield >= cap) return false
    const wasDown = core.shield <= 0
    core.shield = cap
    dome(null, null, 1, null)
    if (wasDown) K.sfx('sfx_shield_up', world().core.pos, 0.8)
    return true
  }
  const _hit = new THREE.Vector3(), _up2 = new THREE.Vector3()
  /** enemies.js: a Hive hit on the Core. The shield soaks first (a Leech bite costs it (1 + shieldDrain) x what it soaks). */
  function damageCore(amount, enemy, info) {
    if (!core.alive || !(amount > 0)) return 0
    const w = world()
    let rest = amount
    if (info && info.point) _hit.copy(info.point)
    else _hit.copy(w.core.pos).add(_up2.set(0, 2, 0))
    if (guest()) { // co-op guest: the host's Core takes the hit; show it here
      if (core.shieldLevel > 0 && core.shield > 0) { dome(null, null, null, _hit); if (shieldState.hitSoundCd <= 0) { shieldState.hitSoundCd = 0.1; K.sfx(K.pick(SHIELD_HIT_SFX), _hit, 0.7) } K.fx('shieldHit', _hit, null, info && info.dir) }
      else { if (w.kickCore) w.kickCore(rest); K.fx('coreHit', _hit, null, info && info.dir); if (shieldState.coreSoundCd <= 0) { shieldState.coreSoundCd = 0.12; K.sfx(K.pick(CORE_HIT_SFX), _hit, 0.6) } }
      return 0
    }
    let soaked = 0
    if (core.shieldLevel > 0 && core.shield > 0) {
      const mult = 1 + Math.max(0, (info && info.shieldDrain) || 0)
      soaked = Math.min(core.shield / mult, rest)
      core.shield -= soaked * mult
      if (core.shield < 0.001) core.shield = 0
      rest -= soaked
      dome(null, null, null, _hit)
      if (shieldState.hitSoundCd <= 0) { shieldState.hitSoundCd = 0.1; K.sfx(K.pick(SHIELD_HIT_SFX), _hit, 0.7, 1 + (R() - 0.5) * 0.2) }
      K.fx('shieldHit', _hit, null, info && info.dir)
      if (core.shield <= 0) {
        dome(null, null, 1, null)
        K.sfx('sfx_shield_break', w.core.pos, 1)
        K.fx('shieldBreak', w.core.pos)
        if (G.shake) G.shake(0.35)
        emit('shieldDown')
        toast('Core Shield down', 'error')
      }
    }
    if (rest <= 1e-6) { emit('coreDamaged', soaked, enemy, info); return 0 }
    const hull = Math.min(core.hp, rest)
    core.hp = Math.max(0, core.hp - rest)
    core.hitT = G.time
    if (w.kickCore) w.kickCore(rest)
    K.fx('coreHit', _hit, null, info && info.dir)
    if (shieldState.coreSoundCd <= 0) { shieldState.coreSoundCd = 0.12; K.sfx(K.pick(CORE_HIT_SFX), _hit, 0.6, 1 + (R() - 0.5) * 0.2) }
    emit('coreDamaged', hull + soaked, enemy, info)
    if (core.hp <= 0) {
      core.alive = false
      if (w.coreFx) w.coreFx.dead = true
      K.fx('coreShockwave', w.core.pos)
      if (G.shake) G.shake(1)
      emit('coreDestroyed', enemy, info)
    }
    return rest
  }
  const coreAlive = () => core.alive
  /** CoreController.RepairCost: min(15 % of max, missing) for 1 Biomass per HP (ceil) */
  const _rc = { amount: 0, cost: 0 }
  function coreRepair() {
    _rc.amount = Math.min(f32(core.max * f32(0.15)), core.max - core.hp)
    _rc.cost = Math.ceil(f32(_rc.amount * 1))
    return _rc
  }
  function repairCore(amount) {
    if (!core.alive) return 0
    const a = Math.min(amount, core.max - core.hp)
    if (a <= 0) return 0
    core.hp += a
    return a
  }

  // ---------------------------------------------------------------- turret helpers
  function placeTurret(pad, type, level) {
    const t = turrets.place(pad, type, level)
    padTurret[pad.index] = t
    pad.occupied = true
    return t
  }
  function removeTurret(t) {
    if (!t) return
    if (padTurret[t.padIndex] === t) padTurret[t.padIndex] = null
    if (t.padRef) t.padRef.occupied = false
    forgetAlerts(t)
    turrets.remove(t)
  }
  const otherType = type => (type === 'Ballistic' ? 'Energy' : 'Ballistic')
  const _tr = { amount: 0, cost: 0 }
  const turretRepair = t => { _tr.amount = t.damaged ? t.maxHp - t.hp : 0; _tr.cost = _tr.amount > 0 ? repairCostFor(t.data, _tr.amount, t.level) : 0; return _tr }
  const canUpgrade = t => !!t && !t.wrecked && t.level < t.data.maxLevel

  // ---------------------------------------------------------------- BuildInteractor: focus
  const focus = { kind: null, pad: null, barricade: null, nearCore: false, atCore: false }
  let replaceArmed = null, replaceArmedUntil = 0
  function playerAlive() {
    const p = G.player
    if (!p || !p.pos) return false
    if (p.alive === false) return false
    return typeof p.state !== 'string' || p.state === 'alive'
  }
  function updateFocus() {
    const w = world()
    const p = G.player && G.player.pos
    const alive = G.state === 'run' && playerAlive() && !ended()
    let nearest = null, nb = null
    focus.nearCore = false
    if (alive && p) {
      const cdx = w.core.pos.x - p.x, cdz = w.core.pos.z - p.z
      const dc = Math.hypot(cdx, cdz)
      focus.nearCore = dc <= RANGE.core
      // at the Core, a pad around it takes focus only when the player is nearer the pad's centre than the Core's edge
      const coreGap = focus.nearCore ? Math.max(0, dc - RANGE.coreSurface) : Infinity
      let best = RANGE.pad * RANGE.pad
      for (const pad of w.pads) {
        const b = pad.base || pad.pos
        if (Math.abs(b.y - p.y) > RANGE.padDy) continue
        const dx = b.x - p.x, dz = b.z - p.z, d2 = dx * dx + dz * dz
        if (d2 < best && coreGap * coreGap >= d2) { best = d2; nearest = pad }
      }
      if (!nearest) {
        let bestB = RANGE.barricade * RANGE.barricade
        for (const b of barricades.list) {
          if (Math.abs(b.pos.y - p.y) > RANGE.barricadeDy) continue
          const dx = b.pos.x - p.x, dz = b.pos.z - p.z, d2 = dx * dx + dz * dz
          if (d2 < bestB) { bestB = d2; nb = b }
        }
      }
    }
    if (focus.pad !== nearest) {
      if (focus.pad) focus.pad.focus = false
      if (nearest) nearest.focus = true
      focus.pad = nearest
      replaceArmed = null // walking off a pad disarms its Replace
    }
    focus.barricade = nb
    focus.atCore = alive && !nearest && !nb && focus.nearCore && core.alive
    const kind = nearest ? 'pad' : nb ? 'barricade' : focus.atCore ? 'core' : null
    if (kind !== focus.kind) { focus.kind = kind; emit('focus', kind) }
  }
  const canRepairCore = () => focus.atCore && core.hp < core.max - 0.5
  const canBuyShield = () => focus.atCore && core.shieldLevel < 5
  const replaceIsArmed = pad => !!pad && replaceArmed === pad && G.rt <= replaceArmedUntil

  // ---------------------------------------------------------------- BuildInteractor: actions
  /** what E (slot 0) and Q (slot 1) do at a pad now */
  function padAction(pad, slot) {
    const t = padTurret[pad.index]
    if (!t) return buildPhase() ? 'build' : 'locked'
    if (t.wrecked) return 'rebuild'
    if (slot !== 0) return buildPhase() ? 'replace' : null
    if (t.damaged) return 'repair'
    return canUpgrade(t) ? 'upgrade' : 'max'
  }
  /** what E and Q do at a barricade now (Q does nothing there) */
  function barricadeAction(b, slot) {
    if (!b.built) return slot === 0 ? (buildPhase() ? 'build' : 'locked') : null
    if (slot !== 0) return null
    if (b.needsRepair) return 'repair'
    if (b.canUpgrade) return buildPhase() ? 'upgrade' : 'locked'
    return 'max'
  }
  function ok(msg, sound, pos, vol = 1) {
    if (freeMode) { toast(ally + ': ' + msg.replace(/\s+·\s+\d+ Biomass salvaged$/, ''), 'info'); if (sound) K.sfx(sound, pos, vol); return true }
    toast(msg, 'success')
    if (sound) K.sfx(sound, pos, vol)
    K.sfx('ui_purchase', null, 0.4, 1, 0.04, true)
    return true
  }
  function fail(msg) {
    if (freeMode) return false
    if (msg) toast(msg, 'error')
    K.sfx('ui_denied', null, 0.8, 1, 0.04, true)
    return false
  }
  const _pp = new THREE.Vector3()
  function tryBuild(pad, type) {
    const d = TD[type]
    if (padTurret[pad.index]) return fail('This pad already has a tower')
    const err = trySpend(d.buildCost, 'build')
    if (err) return fail(err)
    const t = placeTurret(pad, type, 1)
    K.fx('build', pad.base || pad.pos)
    emit('towerBuilt', t)
    return ok(`${d.name} built`, 'sfx_build', pad.pos)
  }
  function tryUpgrade(pad) {
    const t = padTurret[pad.index]
    if (!t) return fail('No tower to upgrade')
    const d = t.data
    if (t.wrecked) return fail(`${d.name} is destroyed: rebuild it first`)
    if (t.level >= d.maxLevel) return fail(`${d.name} is at max level`)
    if (t.damaged) return fail('Repair the turret first')
    const err = trySpend(upgradeCostFor(d, t.level), 'upgrade')
    if (err) return fail(err)
    turrets.upgrade(t)
    flagReset(t)
    K.fx('upgrade', pad.base || pad.pos)
    K.fx(d.tierUpFx, t.pivot)
    emit('towerUpgraded', t)
    return ok(`${d.name} upgraded to Lv${t.level}`, d.tierUpSfx, t.pivot)
  }
  function tryRepair(pad) {
    const t = padTurret[pad.index]
    if (!t) return fail('No turret to repair')
    const d = t.data
    if (t.wrecked) return fail(`${d.name} is destroyed: rebuild it`)
    const { amount, cost } = turretRepair(t)
    if (amount <= 0) return fail(`${d.name} is undamaged`)
    const err = trySpend(cost, 'repair')
    if (err) return fail(err)
    turrets.repair(t)
    flagReset(t)
    _pp.copy(pad.pos).y += 1
    K.fx('repair', _pp)
    emit('towerRepaired', t)
    return ok(`${d.name} repaired +${Math.round(amount)} integrity`, 'sfx_repair', _pp)
  }
  function tryRebuild(pad, type) {
    let t = padTurret[pad.index]
    if (!t || !t.wrecked) return fail(t ? `${t.data.name} is not destroyed` : 'No turret to rebuild')
    const d = TD[type]
    const level = clamp(t.level, 1, d.maxLevel)
    const err = trySpend(rebuildCostAt(d, level), 'rebuild')
    if (err) return fail(err)
    if (type === t.type) turrets.rebuild(t)
    else { removeTurret(t); t = placeTurret(pad, type, level) }
    flagReset(t)
    K.fx('build', pad.base || pad.pos)
    emit('towerRebuilt', t)
    return ok(`${d.name} rebuilt${level > 1 ? ' at level ' + level : ''}`, 'sfx_build', pad.pos)
  }
  function tryReplace(pad) {
    const t = padTurret[pad.index]
    if (!t || t.wrecked) return fail(t ? `${t.data.name} is destroyed: rebuild it` : 'No turret to replace')
    const d = TD[otherType(t.type)]
    const refund = salvageAt(t.data, t.level), net = d.buildCost - refund
    if (net > 0) { const err = trySpend(net, 'replace'); if (err) return fail(err) }
    if (net < 0) earn(-net, 'replace')
    removeTurret(t)
    const nt = placeTurret(pad, d.type, 1)
    K.fx('build', pad.base || pad.pos)
    emit('towerReplaced', nt, t)
    return ok(`Replaced with ${d.name}  ·  ${refund} Biomass salvaged`, 'sfx_build', pad.pos)
  }
  // barricades
  function tryBarricadeBuild(b) {
    if (b.built) return fail(`${b.name} already built`)
    const err = trySpend(BARRICADE.cost[0], 'barricade')
    if (err) return fail(err)
    barricades.setTier(b, 1)
    barricades.fanfare(b, false)
    emit('barricadeBuilt', b)
    return ok(`${BARRICADE.names[0]} built at ${b.label}`)
  }
  function tryBarricadeUpgrade(b) {
    if (!b.built) return tryBarricadeBuild(b)
    if (b.broken) return fail('Repair the barricade first')
    if (!b.canUpgrade) return fail(`${b.name} is fully upgraded`)
    const err = trySpend(BARRICADE.cost[b.tier], 'barricade')
    if (err) return fail(err)
    barricades.setTier(b, b.tier + 1)
    barricades.fanfare(b, true)
    emit('barricadeUpgraded', b)
    return ok(`Upgraded to ${b.name}`)
  }
  function tryBarricadeRepair(b) {
    if (!b.needsRepair) return fail(b.built ? `${b.name} is undamaged` : 'Nothing to repair')
    const { amount, cost } = barricades.repairCost(b)
    const err = trySpend(cost, 'barricade')
    if (err) return fail(err)
    const rebuilt = b.broken
    if (rebuilt) b.sweepT = 0
    barricades.revive(b)
    barricades.fanfare(b, false)
    emit('barricadeRepaired', b)
    return ok(rebuilt ? `${b.name} rebuilt` : `${b.name} repaired +${Math.round(amount)} HP`)
  }
  // the Core
  function tryCoreRepair() {
    if (!core.alive) return fail('The Core is destroyed')
    const { amount, cost } = coreRepair()
    if (amount <= 0.5) return fail('Core is at full health')
    const err = trySpend(cost, 'repair')
    if (err) return fail(err)
    core.hp = Math.min(core.max, core.hp + amount)
    K.fx('repair', world().core.pos)
    emit('coreRepaired', amount)
    return ok(`Core repaired +${Math.round(amount)} HP`, 'sfx_repair', world().core.pos)
  }
  function tryShield() {
    if (core.shieldLevel >= 5) return fail('Core Shield is at max level')
    if (!core.alive) return fail('The Core is destroyed')
    const err = trySpend(SHIELD.cost[core.shieldLevel], 'shield')
    if (err) return fail(err)
    setShieldLevel(core.shieldLevel + 1)
    emit('shieldBought', core.shieldLevel)
    return ok(core.shieldLevel === 1 ? 'Core Shield online' : `Core Shield upgraded to level ${core.shieldLevel}`, 'sfx_shield_up', world().core.pos)
  }
  // ---------------------------------------------------------------- co-op ops: { a, p (pad) | b (barricade), t (type) }
  function runOp(op) {
    const pad = op.p != null ? world().pads[op.p] : null
    const b = op.b != null ? barricades.list[op.b] : null
    switch (op.a) {
      case 'build': return !!pad && tryBuild(pad, op.t)
      case 'upgrade': return !!pad && tryUpgrade(pad)
      case 'repair': return !!pad && tryRepair(pad)
      case 'rebuild': return !!pad && tryRebuild(pad, op.t)
      case 'replace': return !!pad && tryReplace(pad)
      case 'bbuild': return !!b && tryBarricadeBuild(b)
      case 'bupgrade': return !!b && tryBarricadeUpgrade(b)
      case 'brepair': return !!b && tryBarricadeRepair(b)
      case 'crepair': return tryCoreRepair()
      case 'shield': return tryShield()
    }
    return false
  }
  const guardUntil = { p: new Float64Array(14), b: new Float64Array(4), c: 0 }
  /** our own action: done here at once, then told to the others (net.js) */
  function act(op) {
    const before = balance()
    const done = runOp(op)
    if (done && G.net && G.net.multi) {
      if (op.p != null) guardUntil.p[op.p] = G.rt + 1.5
      else if (op.b != null) guardUntil.b[op.b] = G.rt + 1.5
      else guardUntil.c = G.rt + 1.5
      G.net.op(op, Math.max(0, Math.round(before - balance())))
    }
    return done
  }
  /** an ally's action (host: from them; guests: relayed by the host): free here. false when it no longer applies */
  function applyOp(op, name) {
    freeMode = true; ally = name || 'Ally'
    let done = false
    try { done = runOp(op) } finally { freeMode = false; ally = '' }
    return done
  }

  // ---------------------------------------------------------------- co-op state: the host's structures, a few times a second
  /** host: "pad.type.level.hp.wrecked;..." | "tier.hp;..." | "hp.shieldLevel.shield" */
  function netState() {
    const tu = []
    for (let i = 0; i < padTurret.length; i++) { const t = padTurret[i]; if (t) tu.push(i + '.' + (t.type === 'Energy' ? 2 : 1) + '.' + t.level + '.' + Math.round(t.hp) + '.' + (t.wrecked ? 1 : 0)) }
    const ba = barricades.list.map(b => b.tier + '.' + Math.max(0, Math.round(b.hp))).join(';')
    return tu.join(';') + '|' + ba + '|' + Math.round(core.hp) + '.' + core.shieldLevel + '.' + Math.round(core.shield)
  }
  /** guest: take the host's structures (our own action of the last 1.5 s on a spot waits for the host to agree) */
  function applyNetState(str) {
    if (!loaded || typeof str !== 'string') return
    const [tuS, baS, coS] = str.split('|')
    const want = new Array(14).fill(null)
    for (const r of (tuS ? tuS.split(';') : [])) { const v = r.split('.').map(Number); if (v.length === 5 && v[0] >= 0 && v[0] < 14) want[v[0]] = { type: v[1] === 2 ? 'Energy' : 'Ballistic', level: v[2], hp: v[3], wrecked: v[4] === 1 } }
    const pads = world().pads
    for (let i = 0; i < 14; i++) {
      if (G.rt < guardUntil.p[i] || !pads[i]) continue
      const w = want[i]
      let t = padTurret[i]
      if (!w) { if (t) removeTurret(t); continue }
      if (t && t.type !== w.type) { removeTurret(t); t = null }
      if (!t) { t = placeTurret(pads[i], w.type, w.level); K.fx('build', pads[i].base || pads[i].pos) }
      if (t.level !== w.level) turrets.setLevel(t, w.level, true)
      if (w.wrecked && !t.wrecked) turrets.damage(t, t.hp + 1)
      else if (!w.wrecked && t.wrecked) turrets.rebuild(t)
      if (!w.wrecked) { if (w.hp < t.hp - 0.5) t.lastHiveHit = G.time; t.hp = Math.min(t.maxHp, w.hp) }
    }
    const bs = baS ? baS.split(';') : []
    barricades.list.forEach((b, i) => {
      if (G.rt < guardUntil.b[i] || !bs[i]) return
      const [tier, hp] = bs[i].split('.').map(Number)
      if (b.tier !== tier) barricades.setTier(b, tier)
      if (tier > 0) {
        if (hp <= 0 && b.intact) barricades.damage(b, b.hp + 1, null)
        else if (hp > 0) { if (hp < b.hp - 0.5) b.shake = Math.min(1, b.shake + 0.2); b.hp = Math.min(b.max, hp); barricades.refresh(b) }
      }
    })
    if (coS && G.rt >= guardUntil.c) {
      const [hp, L, sh] = coS.split('.').map(Number)
      if (L !== core.shieldLevel) setShieldLevel(L)
      if (hp < core.hp - 0.5) core.hitT = G.time
      core.hp = Math.max(0, Math.min(core.max, hp))
      core.shield = Math.max(0, Math.min(core.shieldMax || shieldCapacity(L), sh))
      if (core.hp <= 0 && core.alive) { core.alive = false; const w = world(); if (w.coreFx) w.coreFx.dead = true }
    }
  }

  /** E (slot 0) or Q (slot 1) at whatever has focus */
  function interact(slot) {
    if (ended() || G.state !== 'run') return false
    const pad = focus.pad
    if (pad) {
      const t = padTurret[pad.index]
      switch (padAction(pad, slot)) {
        case 'build': return act({ a: 'build', p: pad.index, t: TYPES[slot] })
        case 'locked': return fail('Towers can only be placed during the build phase')
        case 'repair': return act({ a: 'repair', p: pad.index })
        case 'rebuild': return act({ a: 'rebuild', p: pad.index, t: slot === 0 ? t.type : otherType(t.type) })
        case 'upgrade': case 'max': return act({ a: 'upgrade', p: pad.index })
        case 'replace': {
          // the first press arms it (the prompt asks for a second), so a levelled turret is never swapped by accident
          const d = TD[otherType(t.type)]
          if (!replaceIsArmed(pad)) {
            replaceArmed = pad
            replaceArmedUntil = G.rt + 3
            toast(`Press Q again to replace with ${d.name}  ·  refund ${salvageAt(t.data, t.level)}, costs ${d.buildCost}`, 'info')
            K.sfx('ui_click', null, 0.6, 1, 0.04, true)
            return false
          }
          replaceArmed = null
          return act({ a: 'replace', p: pad.index })
        }
        default: return false
      }
    }
    const b = focus.barricade
    if (b) {
      const bi = barricades.list.indexOf(b)
      switch (barricadeAction(b, slot)) {
        case 'build': return act({ a: 'bbuild', b: bi })
        case 'repair': return act({ a: 'brepair', b: bi })
        case 'upgrade': return act({ a: 'bupgrade', b: bi })
        case 'locked': return fail('Barricades can be built between waves')
        case 'max': return fail(`${b.name} is fully upgraded`)
        default: return false
      }
    }
    if (focus.nearCore) return act({ a: slot === 0 ? 'crepair' : 'shield' })
    return false
  }

  // ---------------------------------------------------------------- the world-anchored prompt (HudController.World)
  const sig = new Float64Array(16), sigPrev = new Float64Array(16)
  let sigN = 0, sigPrevN = -1
  const sp = v => { sig[sigN++] = v }
  let model = null, promptMode = MODE.None
  const anchor = new THREE.Vector3()
  const onTap = key => interact(key === 'Q' ? 1 : 0)
  const typeCode = type => (type === 'Energy' ? 2 : 1)
  /** fills sig[] for the current focus and sets anchor; returns the mode */
  function promptSignature(bal, compact) {
    sigN = 0
    const pad = focus.pad
    let mode = MODE.None
    if (pad) {
      const t = padTurret[pad.index]
      anchor.copy(pad.pos).y += !t ? 2.2 : Math.max(3.1, t.barHeight + 0.45)
      if (!t) {
        if (buildPhase()) { mode = MODE.BuildOptions; sp(bal >= TD.Ballistic.buildCost ? 1 : 0); sp(bal >= TD.Energy.buildCost ? 1 : 0) } else mode = MODE.BuildLocked
      } else if (t.wrecked) {
        mode = MODE.Rebuild
        sp(typeCode(t.type)); sp(t.level); sp(bal >= rebuildCostAt(t.data, t.level) ? 1 : 0); sp(bal >= rebuildCostAt(TD[otherType(t.type)], t.level) ? 1 : 0)
      } else if (t.damaged) {
        mode = MODE.Repair
        const rc = turretRepair(t).cost
        sp(typeCode(t.type)); sp(t.level); sp(rc); sp(Math.ceil(t.hp)); sp(bal >= rc ? 1 : 0)
      } else if (canUpgrade(t)) {
        mode = MODE.Upgrade
        sp(typeCode(t.type)); sp(t.level); sp(bal >= upgradeCostFor(t.data, t.level) ? 1 : 0)
      } else { mode = MODE.MaxLevel; sp(typeCode(t.type)) }
      if (t && !t.wrecked && buildPhase()) {
        const d = TD[otherType(t.type)], refund = salvageAt(t.data, t.level)
        sp(9); sp(refund); sp(bal + refund >= d.buildCost ? 1 : 0); sp(replaceIsArmed(pad) ? 1 : 0)
      }
      sp(pad.index)
    } else if (focus.barricade) {
      const b = focus.barricade
      mode = MODE.Barricade
      anchor.copy(b.pos).y += 2.8
      const rc = barricades.repairCost(b).cost
      const a0 = barricadeAction(b, 0)
      sp(b.index); sp(b.tier); sp(a0 === 'build' ? 1 : a0 === 'repair' ? 2 : a0 === 'upgrade' ? 3 : a0 === 'locked' ? 4 : 5); sp(rc); sp(Math.ceil(Math.max(0, b.hp)))
      sp(bal >= rc ? 1 : 0); sp(bal >= (b.tier > 0 && b.tier < 3 ? BARRICADE.cost[b.tier] : 0) ? 1 : 0); sp(bal >= BARRICADE.cost[0] ? 1 : 0)
    } else if (canRepairCore() || canBuyShield()) {
      mode = MODE.Core
      anchor.copy(world().core.pos).y += 4.2
      const { amount, cost } = coreRepair()
      if (canRepairCore()) { sp(cost); sp(Math.round(amount)); sp(bal >= cost ? 1 : 0); sp(Math.ceil(core.hp)) } else sp(-1)
      sp(core.shieldLevel); sp(core.shieldLevel < 5 && bal >= SHIELD.cost[core.shieldLevel] ? 1 : 0)
    }
    sp(mode); sp(compact ? 1 : 0)
    return mode
  }
  const typeRow = (key, d, name, sub, cost, bal, extra) => ({ key, icon: d.icon, tint: d.hud, name, sub, cost, affordable: bal >= cost, ...extra })
  /** the replace row (Q, build phase, standing turret) */
  function replaceRow(pad, t, bal, rows) {
    if (!t || t.wrecked || !buildPhase()) return
    const d = TD[otherType(t.type)], refund = salvageAt(t.data, t.level)
    rows.push({ key: 'Q', icon: d.icon, tint: d.hud, name: replaceIsArmed(pad) ? 'Press Q again' : `Replace: ${d.short}`, sub: `Refund ${refund}  ·  level 1`, cost: d.buildCost, affordable: bal + refund >= d.buildCost, gap: true })
  }
  function buildModel(mode, bal, compact) {
    const m = { title: '', rows: [], stats: [], lines: [], notes: [], preview: null, compact, onTap }
    const pad = focus.pad, t = pad ? padTurret[pad.index] : null
    switch (mode) {
      case MODE.BuildOptions:
        for (let i = 0; i < 2; i++) {
          const d = TD[TYPES[i]]
          m.rows.push(typeRow(i === 0 ? 'E' : 'Q', d, d.name, `${d.short}  ·  ${dpsLabel(d)} dps  ·  ${num(rangeAt(d, 1))} m`, d.buildCost, bal))
        }
        break
      case MODE.BuildLocked:
        m.notes.push(compact ? 'Build between waves' : 'Towers can be built between waves')
        break
      case MODE.Upgrade: case MODE.MaxLevel: {
        const d = t.data
        if (!compact) m.title = `${d.name}  ·  level ${t.level} of ${d.maxLevel}`
        if (mode === MODE.MaxLevel) { m.notes.push('Fully upgraded'); replaceRow(pad, t, bal, m.rows); break }
        const next = t.level + 1
        const cost = upgradeCostFor(d, t.level)
        m.rows.push(typeRow('E', d, `Upgrade to level ${next}`, d.tierNames[next - 1], cost, bal))
        if (!compact) {
          m.stats.push({ label: 'Damage', from: num(damageAt(d, t.level)), to: num(damageAt(d, next)), unit: '' })
          m.stats.push({ label: 'Fire rate', from: num(fireRateAt(d, t.level)), to: num(fireRateAt(d, next)), unit: ' /s' })
          m.stats.push({ label: 'Range', from: num(rangeAt(d, t.level)), to: num(rangeAt(d, next)), unit: ' m' })
          m.preview = { icon: d.icon, name: d.tierNames[next - 1], blurb: d.blurbs[next - 1], tint: d.hud }
        }
        replaceRow(pad, t, bal, m.rows)
        break
      }
      case MODE.Repair: {
        const d = t.data
        if (!compact) m.title = `${d.name}  ·  level ${t.level}  ·  ${Math.ceil(t.hp)} / ${Math.round(t.maxHp)}`
        const { amount, cost } = turretRepair(t)
        m.rows.push({ key: 'E', icon: 'repair', tint: HUDC.amber, name: 'Repair', sub: `+${Math.round(amount)} integrity`, cost, affordable: bal >= cost })
        if (!compact && canUpgrade(t)) m.notes.push('Repair to full before upgrading')
        replaceRow(pad, t, bal, m.rows)
        break
      }
      case MODE.Rebuild: {
        if (!compact) m.title = `${t.data.name}  ·  ${pad.label}  ·  destroyed`
        for (let i = 0; i < 2; i++) {
          const d = i === 0 ? t.data : TD[otherType(t.type)]
          const L = clamp(t.level, 1, d.maxLevel)
          m.rows.push(typeRow(i === 0 ? 'E' : 'Q', d, i === 0 ? 'Rebuild' : `Rebuild as ${d.short}`, `${d.name}  ·  level ${L}`, rebuildCostAt(d, L), bal))
        }
        break
      }
      case MODE.Core: {
        if (canRepairCore()) {
          const { amount, cost } = coreRepair()
          m.rows.push({ key: 'E', icon: 'repair', tint: HUDC.cyan, name: 'Repair Core', sub: `+${Math.round(amount)} HP  ·  ${Math.ceil(core.hp)} / ${Math.round(core.max)}`, cost, affordable: bal >= cost })
        }
        if (core.shieldLevel < 5) {
          const L = core.shieldLevel, next = L + 1, cost = SHIELD.cost[L]
          m.rows.push({ key: 'Q', icon: 'shield', tint: HUDC.shield, name: L === 0 ? 'Core Shield' : `Shield level ${next} / 5`, sub: `Absorbs ${SHIELD.capacity[next]} damage`, cost, affordable: bal >= cost })
          const nowPct = Math.round(turretBonusAt(L) * 100), nextPct = Math.round(turretBonusAt(next) * 100)
          if (!compact && nextPct > nowPct) m.lines.push([['All turrets ', 'text'], [`+${nextPct}% damage`, 'lime'], ...(nowPct > 0 ? [[`  (now +${nowPct}%)`, 'dim']] : [])])
          else if (!compact) m.lines.push([['Recharges after every wave', 'dim']])
        }
        break
      }
      case MODE.Barricade: {
        const b = focus.barricade
        if (!compact) m.title = b.built ? `${b.name}  ·  ${b.label}` + (b.broken ? '  ·  destroyed' : `  ·  ${Math.ceil(Math.max(0, b.hp))} / ${Math.round(b.max)}`) : `Barricade slot  ·  ${b.label}`
        switch (barricadeAction(b, 0)) {
          case 'build': m.rows.push({ key: 'E', icon: 'barricade', tint: HUDC.amber, name: `Build ${BARRICADE.names[0]}`, sub: `${BARRICADE.hp[0]} integrity  ·  blocks bugs`, cost: BARRICADE.cost[0], affordable: bal >= BARRICADE.cost[0] }); break
          case 'repair': { const { amount, cost } = barricades.repairCost(b); m.rows.push({ key: 'E', icon: 'repair', tint: HUDC.amber, name: b.broken ? 'Rebuild' : 'Repair', sub: `+${Math.round(amount)} integrity`, cost, affordable: bal >= cost }); break }
          case 'upgrade': {
            const cost = BARRICADE.cost[b.tier]
            m.rows.push({ key: 'E', icon: 'arrow', tint: HUDC.amber, name: 'Upgrade', sub: BARRICADE.names[b.tier], cost, affordable: bal >= cost })
            if (!compact) m.stats.push({ label: 'Integrity', from: num(BARRICADE.hp[b.tier - 1]), to: num(BARRICADE.hp[b.tier]), unit: '' })
            break
          }
          case 'locked': m.notes.push(!compact ? 'Barricades can be built between waves' : b.built ? 'Upgrade between waves' : 'Build between waves'); break
          case 'max': m.notes.push('Fully upgraded'); break
        }
        break
      }
    }
    return m
  }
  /** plain-text form of the prompt (BuildInteractor.Prompt; tests, logs) */
  function promptText() {
    if (ended()) return ''
    const pad = focus.pad
    if (pad) {
      const t = padTurret[pad.index]
      const line = slot => {
        const k = slot === 0 ? '[E] ' : '[Q] '
        switch (padAction(pad, slot)) {
          case 'build': { const d = TD[TYPES[slot]]; return k + d.name + ' - ' + d.buildCost + (slot === 0 ? ' Biomass' : '') }
          case 'locked': return slot === 0 ? 'Towers can only be placed during the build phase' : ''
          case 'repair': { const r = turretRepair(t); return `${k}Repair ${t.data.name} +${Math.round(r.amount)} integrity - ${r.cost} Biomass` }
          case 'rebuild': { const d = slot === 0 ? t.data : TD[otherType(t.type)]; return `${k}${slot === 0 ? 'Rebuild ' : 'Rebuild as '}${d.name} - ${rebuildCostAt(d, t.level)} Biomass` }
          case 'upgrade': return `${k}Upgrade ${t.data.name} to level ${t.level + 1} - ${upgradeCostFor(t.data, t.level)} Biomass`
          case 'max': return `${t.data.name} - max level`
          case 'replace': { const d = TD[otherType(t.type)]; return `${k}${replaceIsArmed(pad) ? 'again to replace with ' : 'Replace with '}${d.name} - refund ${salvageAt(t.data, t.level)}, costs ${d.buildCost} Biomass` }
        }
        return ''
      }
      const a = line(0), q = line(1)
      return q ? (a ? a + '   ' + q : q) : a
    }
    const b = focus.barricade
    if (b) {
      switch (barricadeAction(b, 0)) {
        case 'build': return `[E] Build ${BARRICADE.names[0]} - ${BARRICADE.cost[0]} Biomass`
        case 'repair': return `[E] ${b.broken ? 'Rebuild ' : 'Repair '}${b.name} - ${barricades.repairCost(b).cost} Biomass`
        case 'upgrade': return `[E] Upgrade to ${BARRICADE.names[b.tier]} - ${BARRICADE.cost[b.tier]} Biomass`
        case 'max': return `${b.name} - fully upgraded`
        case 'locked': return 'Barricades can be built between waves'
      }
      return ''
    }
    let text = ''
    if (canRepairCore()) { const r = coreRepair(); text = `[E] Repair Core +${Math.round(r.amount)} HP - ${r.cost} Biomass` }
    if (canBuyShield()) text += (text ? '   ' : '') + `[Q] ${core.shieldLevel === 0 ? 'Core Shield' : 'Shield level ' + (core.shieldLevel + 1)} - ${SHIELD.cost[core.shieldLevel]}`
    return text
  }
  // projection (game space -> css px), allocation-free (hud.project's maths)
  const _pv = new THREE.Vector3()
  const proj = { x: 0, y: 0, behind: false, onScreen: false }
  function project(pos) {
    const cam = G.camera
    const W = (G.p0 && G.p0.width) || 1280, H = (G.p0 && G.p0.height) || 720
    _pv.copy(pos).multiplyScalar(G.S)
    if (G.root && (G.root.position.lengthSq() > 0)) _pv.add(G.root.position)
    cam.updateMatrixWorld()
    _pv.applyMatrix4(cam.matrixWorldInverse)
    proj.behind = _pv.z > 0
    _pv.applyMatrix4(cam.projectionMatrix)
    let x = (_pv.x * 0.5 + 0.5) * W, y = (-_pv.y * 0.5 + 0.5) * H
    if (proj.behind) { x = W - x; y = H - y }
    proj.x = x; proj.y = y
    proj.onScreen = !proj.behind && x >= 0 && x <= W && y >= 0 && y <= H
    return proj
  }
  function updatePrompt() {
    const h = hud()
    if (!h.prompt) return
    const bal = balance()
    const compact = phase() === 'combat'
    const mode = G.state === 'run' && !ended() && playerAlive() ? promptSignature(bal, compact) : MODE.None
    if (mode === MODE.None) { if (promptMode !== MODE.None) h.prompt(null); promptMode = MODE.None; model = null; sigPrevN = -1; return }
    let same = sigN === sigPrevN
    for (let i = 0; same && i < sigN; i++) if (sig[i] !== sigPrev[i]) same = false
    if (!same || !model) {
      model = buildModel(mode, bal, compact)
      sigPrev.set(sig); sigPrevN = sigN
    }
    promptMode = mode
    const p = project(anchor)
    if (p.behind) { h.prompt(null); promptMode = MODE.None; sigPrevN = -1; return }
    h.prompt(model, p.x, p.y)
  }
  function updateGhost() {
    const pad = focus.pad
    if (!pad || G.state !== 'run' || ended()) { turrets.updateGhost(null); return }
    const t = padTurret[pad.index]
    if (!t) {
      if (!buildPhase()) { turrets.updateGhost(null); return }
      ghostArg.mode = 'build'; ghostArg.canE = canAfford(TD.Ballistic.buildCost); ghostArg.t = null
    } else {
      ghostArg.mode = 'built'; ghostArg.t = t; ghostArg.canNext = canUpgrade(t) && canAfford(upgradeCostFor(t.data, t.level))
    }
    turrets.updateGhost(pad, ghostArg)
  }
  const ghostArg = { mode: 'build', canE: true, canNext: true, t: null }

  // ---------------------------------------------------------------- turret status alerts (HudController.Turrets)
  const pending = [], down = [], calledAt = new Map()
  let flushAt = -1, nextCallout = -100, calloutLeft = 0
  const flagged = t => padTurret[t.padIndex] === t && (t.offline || t.underAttack)
  function alertStatus(t, off) {
    if (!off) {
      if (!t.underAttack) { const i = down.indexOf(t); if (i >= 0) down.splice(i, 1) }
      const j = pending.indexOf(t); if (j >= 0) pending.splice(j, 1)
      return
    }
    flag(t)
  }
  function flag(t) {
    if (!down.includes(t)) down.push(t)
    // a turret that drops again soon after its callout keeps its marker but is not called out again
    const at = calledAt.get(t)
    if (at !== undefined && G.rt - at < ALERT.quiet) return
    if (!pending.includes(t)) pending.push(t)
    if (flushAt < 0) flushAt = G.rt + ALERT.merge
  }
  /** a repair, rebuild or upgrade re-arms the integrity warnings */
  function flagReset(t) { t.warned = 0 }
  function forgetAlerts(t) {
    let i = down.indexOf(t); if (i >= 0) down.splice(i, 1)
    i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1)
    calledAt.delete(t)
  }
  const calloutList = []
  function showCallout() {
    calloutList.length = 0
    for (const t of pending) {
      calledAt.set(t, G.rt)
      calloutList.push({ state: t.leeches.length ? 'jammed' : t.wrecked ? 'destroyed' : 'attack', leeches: t.leeches.length, label: t.label, integrity: t.integrity })
    }
    const h = hud()
    const m = h.turretCalloutText ? h.turretCalloutText(calloutList) : null
    if (m && h.turretCallout) { h.turretCallout(null); h.turretCallout(m) }
    calloutLeft = ALERT.seconds
    nextCallout = G.rt + ALERT.throttle
    K.sfx('ui_turret_alert', null, 0.8, 1, 0.04, true)
  }
  const markerItems = [0, 1, 2].map(() => ({ kind: 'turret', x: 0, y: 0, onScreen: true, behind: false, icon: 'turret', label: '', colour: HUDC.jam, bar: 1, pulse: false }))
  const marked = [null, null, null], markedKey = [0, 0, 0]
  const _mk = new THREE.Vector3()
  const rank = t => (t.leeches.length ? 0 : t.wrecked ? 2 : 1)
  function updateAlerts(rdt) {
    const now = G.rt
    const live = G.state === 'run' && !ended()
    if (flushAt >= 0 && now >= flushAt && now >= nextCallout) {
      flushAt = -1
      for (let i = pending.length - 1; i >= 0; i--) if (!flagged(pending[i])) pending.splice(i, 1)
      if (pending.length && live) showCallout()
      pending.length = 0
    }
    if (calloutLeft > 0) {
      calloutLeft -= rdt
      if (calloutLeft <= 0) { const h = hud(); if (h.turretCallout) h.turretCallout(null) }
    }
    // markers: jammed first (the player can clear them), then under attack, then destroyed; nearest first
    for (const t of turrets.list) if (t.underAttack && t.integrity < 0.6 && !down.includes(t)) down.push(t)
    if (!down.length || !live) { marked[0] = marked[1] = marked[2] = null; return }
    for (let i = down.length - 1; i >= 0; i--) if (!flagged(down[i])) down.splice(i, 1)
    const me = G.player && G.player.pos
    for (let k = 0; k < 3; k++) {
      let best = null, bestKey = Infinity
      for (const t of down) {
        if ((k > 0 && marked[0] === t) || (k > 1 && marked[1] === t)) continue
        const key = rank(t) * 1e6 + (me ? t.base.distanceToSquared(me) : 0)
        if (key < bestKey) { bestKey = key; best = t }
      }
      marked[k] = best
      if (!best) { for (let j = k + 1; j < 3; j++) marked[j] = null; break }
      const item = markerItems[k]
      _mk.copy(best.pivot).y += 1.6
      const p = project(_mk)
      item.x = p.x; item.y = p.y; item.onScreen = p.onScreen; item.behind = p.behind
      const dist = me ? Math.round(me.distanceTo(best.base)) : 0
      const rk = rank(best)
      const shownKey = dist * 4 + rk + 1 + best.padIndex * 10000
      if (markedKey[k] !== shownKey) {
        markedKey[k] = shownKey
        item.label = best.label.toUpperCase() + (rk === 0 ? '  JAMMED  ' : rk === 1 ? '  UNDER ATTACK  ' : '  DESTROYED  ') + dist + ' m'
        item.colour = rk === 0 ? HUDC.jam : HUDC.danger
      }
      item.bar = best.integrity
      item.pulse = rk === 0
      if (G.markers) G.markers.push(item)
    }
  }

  // ---------------------------------------------------------------- load / reset / update
  let loaded = false
  async function load() {
    await turrets.load()
    await barricades.load()
    if (G.events) G.events.on('baseSkin', () => turrets.redressAll())
    loaded = true
    reset()
  }
  function reset() {
    for (const t of [...turrets.list]) removeTurret(t)
    padTurret.fill(null)
    barricades.reset()
    core.hp = core.max = CORE_MAX
    core.alive = true
    core.hitT = -10
    const w = world()
    if (w && w.coreFx) { w.coreFx.dead = false; w.coreFx.danger = 0 }
    setShieldLevel(0, true)
    core.shield = 0
    dome(false, 0, null, null)
    shieldState.domeVisible = null
    pending.length = 0; down.length = 0; calledAt.clear(); flushAt = -1; nextCallout = -100; calloutLeft = 0
    const h = hud()
    if (h.turretCallout) h.turretCallout(null)
    replaceArmed = null
    if (focus.pad) focus.pad.focus = false
    focus.pad = null; focus.barricade = null; focus.kind = null
    econ.biomass = 150
    if (loaded && w) for (const pad of w.pads) if (pad.preinstalled) placeTurret(pad, 'Ballistic', 1)
  }
  const _cq = new THREE.Quaternion()
  function update(dt, rdt = dt) {
    if (!loaded) return
    const w = world()
    shieldState.hitSoundCd -= dt
    shieldState.coreSoundCd -= dt
    // the Core: presentation inputs, shield dome
    if (w.coreFx) w.coreFx.danger = 1 - clamp01(core.hp / core.max)
    core.shieldMax = shieldCapacity(core.shieldLevel)
    const up = core.shieldLevel > 0 && core.shield > 0
    const di = up ? Math.round((0.45 + 0.55 * clamp01(core.shield / Math.max(1, core.shieldMax))) * 100) / 100 : 0
    if (up !== shieldState.domeVisible || di !== shieldState.domeI) { shieldState.domeVisible = up; shieldState.domeI = di; dome(up, di, null, null) }
    // turrets, bars, ghost; barricades
    _cq.copy(G.cam ? G.cam.quat : G.camera.quaternion)
    const viewer = G.state === 'run' && G.player && G.player.pos && playerAlive() ? G.player.pos : null
    turrets.update(dt, viewer, _cq)
    barricades.update(dt, viewer)
    // the BuildInteractor
    updateFocus()
    updatePrompt()
    updateGhost()
    const inp = G.input
    if (inp && inp.pressed && G.state === 'run' && (focus.kind || focus.nearCore) && !(G.hud && G.hud.blocking && G.hud.blocking())) {
      if (inp.pressed.has('interact')) interact(0)
      else if (inp.pressed.has('alt')) interact(1)
    }
    updateAlerts(rdt)
  }

  // ---------------------------------------------------------------- tests / tooling helpers
  function build(padIndex, type = 'Ballistic', o = {}) {
    const pad = world().pads[padIndex]
    if (!pad) return null
    if (padTurret[padIndex]) removeTurret(padTurret[padIndex])
    const t = placeTurret(pad, type, o.level || 1)
    if (!o.silent) { K.fx('build', pad.base || pad.pos); K.sfx('sfx_build', pad.pos, 1); emit('towerBuilt', t) }
    return t
  }

  const api = {
    load, update, reset, core, econ, focus,
    get turrets() { return turrets.list },
    get barricades() { return barricades.list },
    get pads() { return world().pads },
    padTurret,
    damageCore,
    damageTurret: (t, amount, enemy, info) => { if (guest()) { if (t) t.lastHiveHit = G.time; return 0 } return turrets.damage(t, amount, enemy, info) },
    damageBarricade: (b, amount, enemy, info) => (guest() ? barricades.hitFx(b, amount, info) : barricades.damage(b, amount, info)),
    act, applyOp, netState, applyNetState,
    leechLatch(t, e) { if (t && e && !t.wrecked && !t.leeches.includes(e)) { t.leeches.push(e); t.target = null } },
    leechRelease(t, e) { if (!t) return; const i = t.leeches.indexOf(e); if (i >= 0) t.leeches.splice(i, 1) },
    barricadeBlocking: (pos, reach) => barricades.blocking(pos, reach),
    coreAlive,
    rechargeShield,
    repairCore,
    repairBarricadesFree() { let n = 0; for (const b of barricades.list) if (barricades.repairFree(b)) n++; return n },
    /** run.js names: supply pod Core patch / barricade repair */
    healCore: n => repairCore(n),
    repairAllBarricades() { return api.repairBarricadesFree() },
    /** Matriarch Plating reward: a free Core Shield level (full charge); false at max */
    addShieldLevel() {
      if (core.shieldLevel >= 5 || !core.alive) return false
      setShieldLevel(core.shieldLevel + 1)
      emit('shieldBought', core.shieldLevel)
      return true
    },
    /** Queen's Hoard: every slot stands again at full integrity (new mods.barricadeHp); empty slots get tier 1 */
    fortifyBarricades() { for (const b of barricades.list) { barricades.setTier(b, Math.max(1, b.tier)); barricades.fanfare(b, false) } },
    /** Armory / queen rewards changed G.run.mods: barricades keep their share of integrity at the new maximum */
    applyMods() {
      for (const b of barricades.list) {
        if (b.tier <= 0) continue
        const max = barricades.tierHealth(b.tier)
        if (max === b.max) continue
        b.hp = b.max > 0 ? b.hp * max / b.max : max
        b.max = max
      }
      core.shieldMax = shieldCapacity(core.shieldLevel)
    },
    turretDamageMult: () => K.turretDamageMult(),
    displayName(sourceId) { const type = String(sourceId || '').split('#')[0].replace(/^Turret/, ''); return TD[type] ? TD[type].name : 'Turret' },
    interact,
    get promptText() { return promptText() },
    get promptModel() { return model },
    // tooling
    build,
    upgrade: padIndex => { const t = padTurret[padIndex]; return t ? turrets.upgrade(t) : false },
    remove: padIndex => { const t = padTurret[padIndex]; if (t) removeTurret(t); return !!t },
    setLevel: (padIndex, level) => { const t = padTurret[padIndex]; if (t) turrets.setLevel(t, level, true); return t },
    wreck: padIndex => { const t = padTurret[padIndex]; if (t && !t.wrecked) turrets.damage(t, t.hp + 1); return t },
    setShieldLevel: L => setShieldLevel(L),
    setBarricadeTier: (i, tier) => { const b = barricades.list[i]; if (b) barricades.setTier(b, tier); return b },
    TD, SHIELD, BARRICADE,
    _turrets: turrets, _barricades: barricades,
  }
  return api
}
