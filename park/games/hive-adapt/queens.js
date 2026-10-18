// Hive Adapt (Project 0 port): the four queens (BossController.cs, MatriarchRole.cs, BurrowQueenRole.cs, SkyQueenRole.cs)
// and the boss rotation (BossRotation.cs). The shared machine: 3.4 s intro (untargetable, roar), phases by health
// fraction, a telegraphed ground slam for every non-ranged queen, footstep shake, weak-point bursts.
import * as THREE from 'three'
import { QUEENS, QUEEN_ORDER, EVOLUTIONS } from './enemydata.js'

const DEG = Math.PI / 180
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()

export function createQueens(K) {
  const { UP, ST } = K
  let current = null

  // ================================================================ shared boss machine
  function init(e, opts) {
    const prof = QUEENS[e.kind]
    e.boss = {
      kind: e.kind, profile: prof, title: prof.title, uiColor: prof.uiColor, appearance: Math.max(1, opts.appearance || 1),
      phase: 0, phaseCount: prof.phases.length, phaseLabel: prof.phases[0].label, status: '', state: 'intro',
      banner: null, bannerSub: null, slamRadius: prof.slamRadius, slamPlayerDamage: prof.slamPlayerDamage, stepCd: 0, reason: opts.reason || null,
    }
    e.spawnSeconds = 3.4
    e.inst.anim.setPlatesOpen(false)
    e.inst.anim.roar(3.4 * 0.8)
    e.inst.anim.onFootPlanted = p => footPlanted(e, p)
    e.inst.chitin.setGlow(1)
    roar(e, 0.55)
    current = e
    // the role's OnInit sets the status before PhaseChanged(0) fires
    K.emit('bossPhase', e, 0)
  }
  function minions(base, appearance) { return base + (Math.max(1, appearance) - 1) * 1 }
  function roar(e, shake) {
    K.sfx(e.data.sounds.roar, e.pos, 1)
    K.shake(shake)
    K.fxBurst('roarWave', _a.copy(e.pos).addScaledVector(UP, 0.2), { color: e.boss.uiColor })
  }
  function phaseAt(prof, h01) {
    let p = 0
    for (let i = 1; i < prof.phases.length; i++) if (h01 <= prof.phases[i].startsAt) p = i
    return p
  }
  function enterPhase(e, p) {
    const b = e.boss
    if (p <= b.phase || p >= b.phaseCount || b.state === 'dead') return
    b.phase = p
    b.state = 'phase2'
    const ph = b.profile.phases[p]
    b.phaseLabel = ph.label; b.banner = ph.banner || null; b.bannerSub = ph.bannerSub || null
    if (e.kind === 'BroodMother' && p === 1) broodPhase2(e)
    if (e.role && e.role.onPhase) e.role.onPhase(e, p)
    e.inst.anim.roar(2.2)
    roar(e, 0.7)
    K.emit('bossPhase', e, p)
  }
  function onDamaged(e, info, final, weak) {
    const b = e.boss
    if (e.hp > 0 && b.state !== 'dead') {
      const target = phaseAt(b.profile, e.hp / e.maxHp)
      while (b.phase < target) enterPhase(e, b.phase + 1)
    }
    if (weak && info.point) K.fxBurst('weakPoint', info.point, { color: e.data.mat.emis })
  }
  function onWindup(e) {
    // every ground queen telegraphs her slam: a ring where it lands, filling over the wind-up
    if (e.data.isFlying || e.data.projectile) return
    const fwd = _a.set(0, 0, 1).applyQuaternion(e.obj.quaternion)
    const sp = _b.copy(e.pos).addScaledVector(fwd, e.data.bodyRadius + e.data.attackRange * 0.6)
    const y = K.groundY(sp.x, sp.z, e.pos.y + 1.5); if (y === y) sp.y = y
    K.markers.ring(sp, e.boss.slamRadius, Math.max(0.2, e.data.windupSeconds), { style: 'boss', hold: 0.2 })
  }
  function onStruck(e, point) {
    if (e.data.isFlying || e.data.projectile) return
    const pp = K.playerPos()
    if (pp) K.shake(K.lerp(0.6, 0.1, K.invLerp(3, 25, pp.distanceTo(point))))
    K.fxBurst('slamShockwave', _a.copy(point).addScaledVector(UP, 0.05), { radius: e.boss.slamRadius })
    K.sfx(['sfx_boss_slam'], point, 1)
    if (K.playerAlive() && K.planar(pp, point) <= e.boss.slamRadius) {
      K.damagePlayer(e.boss.slamPlayerDamage * e.damageScale, e, { type: 'Ballistic', point: pp, dir: _b.copy(pp).sub(point).setY(0).normalize().clone(), source: 'enemy', sourceId: e.kind + '.Slam' })
    }
  }
  function footPlanted(e, p) {
    const b = e.boss
    if (!b || b.stepCd > 0) return
    b.stepCd = 0.18
    const pp = K.playerPos()
    if (pp) K.shake(K.lerp(0.12, 0, K.invLerp(4, 30, pp.distanceTo(p))))
    K.sfx(['sfx_impact_hard_0', 'sfx_impact_hard_1', 'sfx_impact_hard_2'], p, 0.35)
  }
  function onDied(e) {
    if (!e.boss) return
    e.boss.state = 'dead'
    e.boss.status = ''
    e.weakOpen = false
    if (current === e) current = null
    K.fxBurst('bossDeath', K.aimPoint(e, _a), { color: e.data.mat.emis })
  }
  function update(dt) {
    const list = K.list
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (!e.boss || !e.alive) continue
      const b = e.boss
      b.stepCd -= dt
      if (b.state === 'intro' && e.state !== ST.SPAWNED) b.state = 'phase1'
    }
  }

  // ================================================================ Brood Mother: plates open at half health, six Crawlers
  function broodPhase2(e) {
    e.attackIntervalScale = 0.7
    e.weakOpen = true
    e.inst.anim.setPlatesOpen(true)
    e.inst.chitin.setGlow(2.5)
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2
      _c.set(e.pos.x + Math.cos(a) * 4.5, e.pos.y, e.pos.z + Math.sin(a) * 4.5)
      K.spawn('Crawler', { pos: _c.clone(), minion: true, healthScale: 1, damageScale: 1 })
    }
  }
  const BroodMother = { init() {}, tick: () => false }

  // ================================================================ Armored Matriarch
  const Matriarch = {
    init(e) {
      const p = QUEENS.ArmoredMatriarch
      e.rs = { shells: [], intact: 6, charge: 'idle', chargeT: p.chargeInterval * 0.5, t: 0, dir: new THREE.Vector3(), start: new THREE.Vector3(), end: new THREE.Vector3(), length: 0, travelled: 0, hitPlayer: false, hitBarricade: false, rings: [] }
      for (let i = 0; i < 6; i++) e.rs.shells.push({ hp: p.shellHealth * e.healthScale, max: p.shellHealth * e.healthScale, broken: false })
      for (const n in e.inst.extraBones) if (e.inst.extraBones[n]) e.inst.extraBones[n].scale.set(1, 1, 1)
      e.weakOpen = true // per-sac: only the sacs under broken shells can be hit (enemies.raycast checks rs.shells)
      applyBodyScale(e)
    },
    engaged: e => e.rs.charge !== 'idle',
    onPhase(e, p) { if (p >= 1) { e.attackIntervalScale = 0.75; e.rs.chargeT = Math.min(e.rs.chargeT, 1.5) } },
    tick(e, dt) {
      const r = e.rs, p = QUEENS.ArmoredMatriarch
      if (e.boss.phase < 1) return false
      switch (r.charge) {
        case 'idle':
          r.chargeT -= dt
          if (r.chargeT > 0 || e.staggerT > 0) return false
          return beginTelegraph(e)
        case 'telegraph':
          r.t += dt
          K.faceTowards(e, r.end, dt)
          if (r.t >= p.telegraphSeconds) { r.charge = 'charge'; r.t = 0; r.travelled = 0; r.hitPlayer = r.hitBarricade = false; e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(r.dir.x, r.dir.z)) }
          return true
        case 'charge': tickCharge(e, dt); return true
        case 'recover':
          r.t += dt
          if (r.t < 0.9) return true
          r.charge = 'idle'; r.chargeT = p.chargeInterval
          K.setState(e, ST.MOVE)
          return false
      }
      return false
    },
    onDied(e) { stopMatriarch(e) },
    onRemoved(e) { stopMatriarch(e) },
  }
  function stopMatriarch(e) { const r = e.rs; r.charge = 'idle'; for (const h of r.rings) h.kill(); r.rings.length = 0; e.damageTakenScale = 1 }
  function applyBodyScale(e) {
    const r = e.rs, n = r.shells.length
    e.damageTakenScale = K.lerp(QUEENS.ArmoredMatriarch.shelledBodyDamage, 1, (n - r.intact) / n)
    e.boss.status = r.intact > 0 ? r.intact + ' of ' + n + ' shells left' : 'Every shell is off'
  }
  /** the shell sphere a body hit point lands in (bullets that strike a shell), or -1 */
  function shellAt(e, point) {
    const tpl = K.templates[e.kind]
    if (!tpl.shells.length) return -1
    _a.copy(point).sub(e.pos).applyQuaternion(_q.copy(e.obj.quaternion).invert()).divideScalar(e.sizeMul)
    const an = e.inst.anim
    for (let k = 0; k < tpl.shells.length; k++) {
      if (e.rs.shells[k].broken) continue
      _b.copy(tpl.shells[k].pos).applyQuaternion(an.bodyQ).add(an.bodyT)
      if (_a.distanceTo(_b) <= tpl.shells[k].r + 0.1) return k
    }
    return -1
  }
  const _q = new THREE.Quaternion()
  /** shell Health (no EnemyData: no weakTo, no body damage scale); Hive resistances already applied by the caller */
  function damageShell(e, i, amount, info) {
    const s = e.rs.shells[i]
    if (!s || s.broken || !e.alive) return 0
    const final = Math.min(s.hp, amount)
    s.hp -= amount
    e.inst.chitin.hit(0.6)
    K.emit('enemyDamaged', e, final, Object.assign({}, info, { part: 'shell_' + i, shell: i }))
    if (s.hp <= 0) breakShell(e, i)
    return final
  }
  function breakShell(e, i) {
    const r = e.rs, s = r.shells[i]
    if (s.broken || !e.alive) return
    s.broken = true; r.intact--
    const tpl = K.templates[e.kind]
    const bone = e.inst.extraBones[tpl.shells[i].bone]
    const at = _a.copy(tpl.shells[i].pos).multiplyScalar(e.sizeMul).applyQuaternion(e.obj.quaternion).add(e.pos)
    if (bone) bone.scale.set(1e-4, 1e-4, 1e-4)
    K.fxBurst('shellBreak', at, {})
    K.sfx(['sfx_queen_shell_break'], at, 1)
    const pp = K.playerPos()
    if (pp) K.shake(K.lerp(0.35, 0.08, K.invLerp(5, 35, pp.distanceTo(at))))
    applyBodyScale(e)
    K.emit('shellBroken', e, i, at.clone())
    if (r.intact === 0) enterPhase(e, 1) // stripped bare: enraged whatever her health
  }
  function beginTelegraph(e) {
    const r = e.rs, p = QUEENS.ArmoredMatriarch
    const from = e.pos
    const target = _a.copy(K.core().pos)
    if (K.playerAlive()) { const pp = K.playerPos(); if (K.planar(pp, from) < p.chargeDistance + 6 && Math.abs(pp.y - from.y) < 3) target.copy(pp) }
    _b.set(target.x - from.x, 0, target.z - from.z)
    if (_b.lengthSq() < 1) _b.set(0, 0, 1).applyQuaternion(e.obj.quaternion).setY(0)
    r.dir.copy(_b).normalize()
    let len = Math.min(p.chargeDistance, _b.length() + 3)
    // stop at walls and drops (NavMesh.Raycast stand-in)
    _c.copy(from).addScaledVector(r.dir, len)
    len = K.clearRun(from, _c, len)
    if (len < 3) { r.chargeT = 2; return false }
    r.length = len
    r.start.copy(from)
    r.end.copy(from).addScaledVector(r.dir, len)
    const ey = K.groundY(r.end.x, r.end.z, from.y + 2); if (ey === ey) r.end.y = ey
    r.charge = 'telegraph'; r.t = 0
    K.navStop(e)
    K.cancelAttack(e)
    e.inst.anim.roar(p.telegraphSeconds)
    const n = Math.max(2, Math.ceil(len / 3.2))
    r.rings.length = 0
    for (let i = 0; i < n; i++) {
      const at = _c.lerpVectors(_b.copy(from).addScaledVector(r.dir, 2.5), r.end, n === 1 ? 1 : i / (n - 1))
      const gy = K.groundY(at.x, at.z, from.y + 2); if (gy === gy) at.y = gy
      r.rings.push(K.markers.ring(at, 2.2, p.telegraphSeconds, { style: 'boss', hold: 0.3 }))
    }
    K.sfx(e.data.sounds.cue, from, 1)
    K.emit('bossTelegraph', e, 'charge', r.start.clone(), r.end.clone(), p.telegraphSeconds)
    return true
  }
  function tickCharge(e, dt) {
    const r = e.rs, p = QUEENS.ArmoredMatriarch, d = e.data
    r.t += dt
    e.roleMoves = true
    const step = p.chargeSpeed * dt
    const moved = K.moveDirect(e, r.dir.x * step, r.dir.z * step, dt)
    e.vel.copy(r.dir).multiplyScalar(p.chargeSpeed)
    r.travelled += moved
    const reach = d.bodyRadius + 1.2
    if (!r.hitPlayer && K.playerAlive()) {
      const pp = K.playerPos()
      if (K.planar(pp, e.pos) < reach + 0.6 && Math.abs(pp.y - e.pos.y) < 2.5) {
        r.hitPlayer = true
        K.damagePlayer(p.chargeDamage * e.damageScale, e, { type: d.attackDamageType, point: pp, dir: r.dir.clone(), source: 'enemy', sourceId: 'ArmoredMatriarch.Charge' })
        K.shake(0.6)
      }
    }
    let stopped = false
    if (!r.hitBarricade) {
      const b = K.barricadeBlocking(_a.copy(e.pos).addScaledVector(r.dir, reach), 0.6)
      if (b && K.barricadeIntact(b)) {
        r.hitBarricade = true
        K.damageBarricade(b, p.chargeDamage * 4 * e.damageScale, e, { type: d.attackDamageType, point: K.barricadePos(b).clone(), dir: r.dir.clone(), source: 'enemy', sourceId: 'ArmoredMatriarch.Charge' })
        stopped = true
      }
    }
    if (stopped || r.travelled >= r.length || (r.t > 0.2 && moved < step * 0.25) || r.t > 3) {
      r.charge = 'recover'; r.t = 0
      K.navStop(e)
      K.fxBurst('slamShockwave', _a.copy(e.pos).addScaledVector(r.dir, d.bodyRadius), { radius: 4 })
      K.sfx(['sfx_boss_slam'], e.pos, 1)
      const pp = K.playerPos()
      if (pp) K.shake(K.lerp(0.45, 0.05, K.invLerp(5, 35, pp.distanceTo(e.pos))))
    }
  }

  // ================================================================ Burrow Queen
  const SINK_Q = 4.5, INSIDE_MIN = 6, INSIDE_MAX = 12, EMERGE_Q = 1.1, GILLS = 6, TRAIL_Q = 0.45, RUMBLE_Q = 1.6
  const BurrowQueen = {
    init(e) {
      e.rs = { phase: 'fight', t: 0, sinceSurface: 0, pending: -1, tunnels: 0, inside: false, exit: new THREE.Vector3(), exitName: '', gillsUntil: -1, trailT: 0, rumbleT: 0, emergeHit: false, tele: 2.4, ring: null, crack: null }
      resetQVisual(e)
      e.invulnerable = false
      e.weakOpen = false
      e.boss.status = 'Coming for the gates'
    },
    targetable: e => e.rs.phase === 'fight' || (e.rs.phase === 'emerge' && e.rs.t > 0.4),
    engaged: e => e.rs.phase !== 'fight',
    onPhase(e, p) { if (p >= 1) e.rs.pending = p },
    tick(e, dt) {
      const r = e.rs, prof = QUEENS.BurrowQueen
      r.t += dt
      switch (r.phase) {
        case 'fight': {
          r.sinceSurface += dt
          if (r.gillsUntil > 0 && K.clock >= r.gillsUntil) closeGills(e)
          if (e.state === ST.SPAWNED || e.staggerT > 0) return false
          const timer = r.sinceSurface >= prof.burrowAfterSeconds
          if (r.pending < 1 && !timer) return false
          const inside = e.boss.phase >= 2 || r.pending >= 2
          r.pending = -1
          if (!chooseQExit(e, inside)) { r.sinceSurface = 0; return false }
          beginQDig(e)
          return true
        }
        case 'dig': tickQDig(e); return true
        case 'under': tickQUnder(e, dt); return true
        case 'telegraph': tickQTelegraph(e, dt); return true
        case 'emerge': tickQEmerge(e); return r.phase === 'emerge'
      }
      return false
    },
    onDied(e) { restoreQ(e) },
    onRemoved(e) { restoreQ(e) },
  }
  function chooseQExit(e, inside) { return (!inside && chooseGate(e)) || chooseInside(e) }
  function chooseGate(e) {
    const r = e.rs, w = K.world(), c = K.core().pos
    const slots = ((w && w.barricadeSlots) || []).filter(s => /^Gate/.test(s.id || s.label || ''))
    let best = null, bd = -1
    for (const s of slots) { const d = K.planar(s.pos, e.pos); if (d > bd) { bd = d; best = s } }
    if (!best) return false
    _a.set(best.pos.x - c.x, 0, best.pos.z - c.z)
    if (_a.lengthSq() < 0.01) _a.set(0, 0, -1)
    _a.normalize()
    for (let k = 4.5; k <= 8; k += 1.5) {
      _b.copy(best.pos).addScaledVector(_a, k)
      const y = K.groundY(_b.x, _b.z, best.pos.y + 2)
      if (y !== y || Math.abs(y - best.pos.y) > 3) continue
      _b.y = y
      r.exit.copy(_b); r.inside = false; r.exitName = best.label || best.id || 'the gate'
      return true
    }
    return false
  }
  function chooseInside(e) {
    const r = e.rs, c = K.core().pos, w = K.world()
    const pp = K.playerAlive() ? K.playerPos() : null
    let best = -Infinity, found = false
    for (let i = 0; i < 12; i++) {
      const a = K.rng() * Math.PI * 2, rr = K.range(INSIDE_MIN, INSIDE_MAX)
      _a.set(c.x + Math.cos(a) * rr, c.y, c.z + Math.sin(a) * rr)
      const y = K.groundY(_a.x, _a.z, c.y + 1.5)
      if (y !== y || Math.abs(y - c.y) > 1.5) continue
      _a.y = y
      if (w && w.inYard && !w.inYard(_a)) continue
      if (K.planar(_a, c) < INSIDE_MIN * 0.8) continue
      let score = K.range(0, 3)
      if (pp) { const dp = K.planar(_a, pp); score += dp < 6 ? -20 : Math.min(dp, 14) }
      if (score > best) { best = score; r.exit.copy(_a); found = true }
    }
    if (found) { r.inside = true; r.exitName = 'inside the walls' }
    return found
  }
  function setQSink(e, depth01, pitchDeg) { e.inst.vis.position.set(0, -SINK_Q * depth01, 0); e.inst.vis.rotation.set(pitchDeg * DEG, 0, 0) }
  function resetQVisual(e) { e.inst.vis.position.set(0, 0, 0); e.inst.vis.rotation.set(0, 0, 0); e.inst.vis.visible = true }
  function beginQDig(e) {
    const r = e.rs
    r.phase = 'dig'; r.t = 0; r.tunnels++
    K.cancelAttack(e)
    closeGills(e)
    K.navStop(e)
    e.inst.anim.clearLook(); e.inst.anim.roar(1.2)
    K.fxBurst('burrowDig', e.pos, { scale: 2 })
    K.fxBurst('burrowDig', _a.set(0, 0, e.data.bodyRadius).applyQuaternion(e.obj.quaternion).add(e.pos), { scale: 2 })
    K.sfx(['sfx_burrow_dig_0', 'sfx_burrow_dig_1'], e.pos, 1)
    K.sfx(e.data.sounds.cue, e.pos, 1)
    e.boss.status = r.inside ? 'Burrowing under the walls' : 'Burrowing toward ' + r.exitName
  }
  function tickQDig(e) {
    const r = e.rs
    e.roleMoves = true
    const k = K.clamp01(r.t / 1.6)
    setQSink(e, k * k, 30 * Math.min(1, k * 2))
    if (k < 1) return
    K.setHittable(e, false)
    e.invulnerable = true
    e.inst.vis.visible = false
    r.phase = 'under'; r.t = 0; r.trailT = 0; r.rumbleT = RUMBLE_Q * 0.3
  }
  function tickQUnder(e, dt) {
    const r = e.rs, p = e.pos
    e.roleMoves = true
    _a.set(r.exit.x - p.x, 0, r.exit.z - p.z)
    const dist = _a.length(), step = QUEENS.BurrowQueen.undergroundSpeed * dt
    if (dist > 0.01) e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_a.x, _a.z))
    if (dist > step) p.addScaledVector(_a, step / dist); else p.add(_a)
    const gy = K.groundY(p.x, p.z, Math.max(p.y, r.exit.y) + 30)
    p.y = K.lerp(p.y, gy === gy ? gy : r.exit.y, 0.5)
    r.trailT -= dt
    if (r.trailT <= 0) { r.trailT = TRAIL_Q; K.fxBurst('burrowTrail', p, { scale: 2 }) }
    r.rumbleT -= dt
    if (r.rumbleT <= 0) {
      r.rumbleT = RUMBLE_Q
      K.sfx(['sfx_burrow_rumble_0', 'sfx_burrow_rumble_1'], p, 0.7)
      const pp = K.playerPos(); if (pp && K.planar(pp, p) < 20) K.shake(0.15)
    }
    if (dist > step) return
    p.copy(r.exit)
    r.phase = 'telegraph'; r.t = 0
    r.tele = Math.max(2.4, QUEENS.BurrowQueen.telegraphSeconds)
    r.crack = K.markers.ring(r.exit, 2.6, r.tele, { style: 'crack', hold: 1.2 })
    r.ring = K.markers.ring(r.exit, QUEENS.BurrowQueen.emergeRadius, r.tele, { style: 'boss', hold: 0.3 })
    K.fxDecal('crack', _a.copy(r.exit), UP, { life: r.tele + 1.2, scale: 3.4 })
    K.fxDecal('crack', _a.copy(r.exit).add(_b.set(1.6, 0, -0.8)), UP, { life: r.tele + 1.2, scale: 3.4, rot: 70 })
    K.sfx(['sfx_burrow_rumble_0', 'sfx_burrow_rumble_1'], r.exit, 1)
    e.boss.status = r.inside ? 'Surfacing inside the walls' : 'Surfacing at ' + r.exitName
    K.emit('bossTelegraph', e, 'surface', r.exit.clone(), null, r.tele)
  }
  function tickQTelegraph(e, dt) {
    const r = e.rs
    e.roleMoves = true
    const pp = K.playerPos()
    if (pp && pp.distanceTo(r.exit) < 16) K.shake(0.9 * dt)
    if (r.t < r.tele) return
    r.phase = 'emerge'; r.t = 0; r.emergeHit = false
    e.pos.copy(r.exit)
    const c = K.core().pos
    _a.set(c.x - r.exit.x, 0, c.z - r.exit.z)
    if (_a.lengthSq() > 0.01) e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_a.x, _a.z))
    e.inst.vis.visible = true
    setQSink(e, 1, -28)
    e.inst.anim.initialize(e.obj, e.inst.vis, e.sizeMul)
    e.inst.anim.roar(1.6)
    K.fxBurst('burrowEmerge', r.exit, { scale: 2.5 })
    K.fxBurst('slamShockwave', _a.copy(r.exit).addScaledVector(UP, 0.05), { radius: QUEENS.BurrowQueen.emergeRadius })
    K.sfx(['sfx_burrow_emerge_0', 'sfx_burrow_emerge_1'], r.exit, 1)
    if (pp) { const d = pp.distanceTo(r.exit); if (d < 24) K.shake(K.lerp(0.8, 0.15, d / 24)) }
  }
  function tickQEmerge(e) {
    const r = e.rs, prof = QUEENS.BurrowQueen
    e.roleMoves = true
    const k = K.clamp01(r.t / EMERGE_Q)
    const ease = 1 - (1 - k) * (1 - k) * (1 - k)
    setQSink(e, 1 - ease, -28 * (1 - ease))
    if (r.t > 0.4 && !r.emergeHit) {
      r.emergeHit = true
      K.setHittable(e, true)
      e.invulnerable = false
      if (K.playerAlive()) {
        const pp = K.playerPos()
        if (K.planar(pp, r.exit) < prof.emergeRadius && Math.abs(pp.y - r.exit.y) < 2.5) {
          K.damagePlayer(prof.emergeDamage * e.damageScale, e, { type: 'Ballistic', point: pp, dir: _b.copy(pp).sub(r.exit).normalize().clone(), source: 'enemy', sourceId: 'BurrowQueen.Emerge' })
        }
      }
      // her brood comes up with her (HP scale = half hers; the evolution HP multiplies again at spawn, as in Unity)
      const n = minions(prof.emergeMinions, e.boss.appearance)
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * Math.PI * 2
        _c.set(r.exit.x + Math.cos(a) * (prof.emergeRadius + 1), r.exit.y, r.exit.z + Math.sin(a) * (prof.emergeRadius + 1))
        K.spawn(prof.emergeMinion, { pos: _c.clone(), minion: true, healthScale: e.healthScale * 0.5, damageScale: e.damageScale })
      }
      // gills flare open
      e.weakOpen = true
      r.gillsUntil = K.clock + GILLS
      e.boss.status = 'Gills open  ·  shoot the glowing vents'
      K.emit('bossSurfaced', e, r.exit.clone())
    }
    if (k < 1) return
    resetQVisual(e)
    r.phase = 'fight'; r.sinceSurface = 0
    K.setState(e, ST.MOVE)
  }
  function closeGills(e) {
    const r = e.rs
    if (r.gillsUntil < 0) return
    r.gillsUntil = -1
    e.weakOpen = false
    if (r.phase === 'fight') e.boss.status = r.inside ? 'Inside the walls' : 'At ' + r.exitName
  }
  function restoreQ(e) { resetQVisual(e); const r = e.rs; r.phase = 'fight'; r.gillsUntil = -1; e.invulnerable = false; K.setHittable(e, true); if (r.ring) r.ring.kill(); if (r.crack) r.crack.kill() }

  // ================================================================ Sky Queen
  const DOWN = 0.55, HOLD = 0.6
  const SkyQueen = {
    init(e) {
      const p = QUEENS.SkyQueen
      e.rs = { broodT: p.broodInterval * 0.6, diveT: p.diveInterval, dropPending: false, dropAt: 0, dropPoint: new THREE.Vector3(), dive: 'none', t: 0, diveTo: new THREE.Vector3(), diveFrom: new THREE.Vector3(), diveHit: false, dropped: 0, dives: 0 }
      e.boss.status = 'Airborne  ·  watch for Leech drops'
    },
    engaged: e => e.rs.dive !== 'none',
    onPhase(e, p) { if (p < 1) return; e.weakOpen = true; e.rs.diveT = Math.min(e.rs.diveT, 2.5); e.boss.status = 'Brood sac exposed  ·  she dives at you' },
    tick(e, dt) {
      const r = e.rs, p = QUEENS.SkyQueen
      if (e.state === ST.SPAWNED) return false
      if (r.dropPending) { if (K.clock >= r.dropAt) drop(e) } else { r.broodT -= dt; if (r.broodT <= 0) beginBrood(e) }
      if (e.boss.phase < 1) return false
      switch (r.dive) {
        case 'none':
          r.diveT -= dt
          if (r.diveT <= 0) beginDive(e)
          return r.dive !== 'none'
        case 'telegraph':
          r.t += dt
          e.flyVel.multiplyScalar(Math.exp(-6 * dt))
          K.faceTowards(e, r.diveTo, dt)
          if (r.t >= p.telegraphSeconds) { r.dive = 'down'; r.t = 0; r.diveFrom.copy(e.pos) }
          return true
        case 'down': {
          r.t += dt
          const k = K.clamp01(r.t / DOWN)
          e.pos.lerpVectors(r.diveFrom, _a.copy(r.diveTo).addScaledVector(UP, 1.6), k * k)
          if (k >= 1) diveImpact(e)
          return true
        }
        case 'hold':
          r.t += dt
          e.flyVel.set(0, 0, 0)
          if (r.t < HOLD) return true
          r.dive = 'none'; r.diveT = p.diveInterval
          return false // the flight code lifts her back to cruise height
      }
      return false
    },
    onDied(e) { e.rs.dive = 'none'; e.rs.dropPending = false },
    onRemoved(e) { e.rs.dive = 'none'; e.rs.dropPending = false },
  }
  function beginBrood(e) {
    const r = e.rs, p = QUEENS.SkyQueen
    const gy = K.groundY(e.pos.x, e.pos.z, e.pos.y)
    if (gy !== gy) { r.broodT = 2; return false }
    r.dropPoint.set(e.pos.x, gy, e.pos.z)
    r.dropPending = true
    r.dropAt = K.clock + p.telegraphSeconds
    K.markers.ring(r.dropPoint, 2.6, p.telegraphSeconds, { style: 'boss', hold: 0.3 })
    K.sfx(e.data.sounds.cue, e.pos, 1)
    K.emit('bossTelegraph', e, 'brood', r.dropPoint.clone(), null, p.telegraphSeconds)
    return true
  }
  function drop(e) {
    const r = e.rs, p = QUEENS.SkyQueen
    r.dropPending = false
    r.broodT = e.boss.phase >= 1 ? p.broodIntervalEnraged : p.broodInterval
    const n = minions(p.broodPerDrop, e.boss.appearance)
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2
      _c.set(r.dropPoint.x + Math.cos(a) * 1.4, r.dropPoint.y, r.dropPoint.z + Math.sin(a) * 1.4)
      if (K.spawn(p.broodMinion, { pos: _c.clone(), minion: true, healthScale: Math.max(1, e.healthScale * 0.5), damageScale: e.damageScale })) r.dropped++
    }
    K.fxBurst('bugSpawn', r.dropPoint, { scale: 1.5 })
  }
  function beginDive(e) {
    const r = e.rs, p = QUEENS.SkyQueen
    if (!K.playerAlive() || r.dive !== 'none') { r.diveT = 2; return false }
    const pp = K.playerPos()
    if (K.planar(pp, e.pos) > 45) { r.diveT = 2; return false }
    r.diveTo.copy(pp)
    const gy = K.groundY(pp.x, pp.z, pp.y + 0.5); if (gy === gy) r.diveTo.y = gy
    r.dive = 'telegraph'; r.t = 0; r.diveHit = false
    K.cancelAttack(e)
    K.markers.ring(r.diveTo, p.diveRadius, p.telegraphSeconds, { style: 'boss', hold: 0.3 })
    e.inst.anim.roar(p.telegraphSeconds)
    K.sfx(e.data.sounds.cue, e.pos, 1)
    K.emit('bossTelegraph', e, 'dive', r.diveTo.clone(), null, p.telegraphSeconds)
    return true
  }
  function diveImpact(e) {
    const r = e.rs, p = QUEENS.SkyQueen
    r.dive = 'hold'; r.t = 0; r.dives++
    if (!r.diveHit && K.playerAlive()) {
      const pp = K.playerPos()
      if (K.planar(pp, r.diveTo) < p.diveRadius && Math.abs(pp.y - r.diveTo.y) < 3) {
        r.diveHit = true
        K.damagePlayer(p.diveDamage * e.damageScale, e, { type: 'Ballistic', point: pp, dir: _b.copy(pp).sub(r.diveTo).normalize().clone(), source: 'enemy', sourceId: 'SkyQueen.Dive' })
      }
    }
    K.fxBurst('slamShockwave', _a.copy(r.diveTo).addScaledVector(UP, 0.05), { radius: p.diveRadius })
    K.sfx(['sfx_boss_slam'], r.diveTo, 1)
    const pp = K.playerPos()
    if (pp) K.shake(K.lerp(0.6, 0.05, K.invLerp(3, 30, pp.distanceTo(r.diveTo))))
  }

  // ================================================================ rotation (BossRotation.Choose)
  /**
   * pickQueen({ appearance, history | picks, latestGeneration | generation, faced })
   *  appearance: 1 = the run's first boss wave (wave 5), k = wave / 5
   *  history: evolution records [{ id, generation }] (or ids); defaults to G.run.hive.picks
   *  latestGeneration: the newest generation number; defaults to G.run.hive.generation
   *  faced: queen kinds already faced this run, oldest first (e.g. ['BroodMother', 'BurrowQueen'])
   * returns { kind, title, appearance, reason, because, score }
   */
  function pickQueen(state = {}) {
    const hv = (K.G.run && K.G.run.hive) || {}
    const appearance = Math.max(1, state.appearance || (K.G.run && K.G.run.wave ? Math.floor(K.G.run.wave / 5) : 1))
    const history = (state.history || state.picks || hv.picks || []).map(r => (typeof r === 'string' ? { id: r, generation: hv.generation || 0 } : { id: r.id || (r.data && r.data.id), generation: r.generation ?? (hv.generation || 0) }))
    const latest = state.latestGeneration ?? state.generation ?? hv.generation ?? history.reduce((m, r) => Math.max(m, r.generation || 0), 0)
    const faced = state.faced || (K.G.run && K.G.run.bossesFaced) || []
    if (appearance <= 1) return { kind: 'BroodMother', title: QUEENS.BroodMother.title, appearance, reason: 'The Hive sends its first queen', because: null, score: 0 }
    const last = faced.length ? faced[faced.length - 1] : null
    let best = -Infinity, bestSeen = Infinity, choice = null
    for (const kind of QUEEN_ORDER) {
      if (kind === last) continue
      const prof = QUEENS[kind]
      let score = 0, topW = 0, top = null
      for (const rec of history) {
        if (!rec.id || !prof.answers.includes(rec.id)) continue
        const w = rec.generation === latest ? 2 : 1
        score += w
        if (w >= topW) { topW = w; top = rec.id }
      }
      const seen = faced.filter(f => f === kind).length
      if (seen === 0) score += 0.5
      if (score > best + 1e-4 || (score > best - 1e-4 && seen < bestSeen)) { best = score; bestSeen = seen; choice = { kind, top, score } }
    }
    const because = choice.top
    return {
      kind: choice.kind, title: QUEENS[choice.kind].title, appearance, score: choice.score, because,
      reason: because ? 'Bred from ' + ((EVOLUTIONS[because] && EVOLUTIONS[because].name) || because) : 'The Hive sends another queen',
    }
  }

  function clear() { current = null }

  return {
    init, update, onDamaged, onWindup, onStruck, onDied, enterPhase, shellAt, damageShell, pickQueen, clear,
    roles: { BroodMother, Matriarch, BurrowQueen, SkyQueen },
    get current() { return current },
  }
}
