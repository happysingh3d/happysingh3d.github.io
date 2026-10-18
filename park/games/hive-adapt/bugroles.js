// Hive Adapt (Project 0 port): role behaviour on top of the base machine (Scripts/Enemies/Roles/*.cs).
// A role's tick(e, dt) returns true while it drives the bug this frame (the base machine is skipped; enemies.js still
// runs the ground mover with e.navOn/e.navGoal unless the role set e.roleMoves = true because it placed the bug itself).
import * as THREE from 'three'

const DEG = Math.PI / 180
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3()

export function createRoles(K) {
  const { UP, ST } = K

  // ================================================================ Rammer (RammerRole.cs)
  const MIN_CHARGE = 3.5, RECOVER = 0.9, TURN = 240, PLAYER_SHARE = 0.3
  const Rammer = {
    init(e) {
      e.rs = { phase: 'none', cooldown: 1.5, t: 0, pawT: 0, stallT: 0, maxT: 0, hitPlayer: false, target: new THREE.Vector3(), tKind: null, tRef: null, lastPos: new THREE.Vector3(), line: null, charges: 0, hits: 0 }
      K.setWeakOpen(e, true)
    },
    onStagger(e) { if (e.rs.phase === 'windup' || e.rs.phase === 'charge') endCharge(e, false) },
    engaged: e => e.rs.phase !== 'none',
    attackingStructure: e => (e.rs.phase === 'windup' || e.rs.phase === 'charge') && !!e.rs.tKind,
    tick(e, dt) {
      const r = e.rs, d = e.data
      switch (r.phase) {
        case 'none':
          r.cooldown -= dt
          if (r.cooldown > 0 || e.winding) return false
          if (e.state !== ST.MOVE && e.state !== ST.ATTACK_PLAYER && e.state !== ST.ATTACK_BARRICADE) return false
          if (!pickTarget(e)) { r.cooldown = 0.4; return false }
          beginWindup(e)
          return true
        case 'windup': {
          r.t += dt
          K.faceTowards(e, r.target, dt, 3)
          r.pawT -= dt
          if (r.pawT <= 0) { r.pawT = 0.42; K.fxBurst('rammerPaw', _a.set(0, 0, d.bodyRadius * 0.8).applyQuaternion(e.obj.quaternion).add(e.pos), {}) }
          if (!targetAlive(r)) { endCharge(e, false); return true }
          if (r.t >= d.chargeWindup) {
            r.phase = 'charge'; r.t = 0; r.stallT = 0; r.lastPos.copy(e.pos)
            r.maxT = K.planar(e.pos, r.target) / Math.max(1, d.chargeSpeed) + 0.8
          }
          return true
        }
        case 'charge': tickCharge(e, dt); return true
        case 'recover':
          r.t += dt
          if (r.t >= RECOVER) { r.phase = 'none'; r.cooldown = d.chargeCooldown; K.setState(e, ST.MOVE); return false }
          return true
      }
      return false
    },
    onDied(e) { killLine(e); e.rs.phase = 'none' },
    onRemoved(e) { killLine(e); e.rs.phase = 'none' },
  }
  function killLine(e) { if (e.rs.line) { e.rs.line.kill(); e.rs.line = null } }
  function targetAlive(r) {
    if (r.tKind === 'core') return K.coreAlive()
    if (r.tKind === 'barricade') return K.barricadeIntact(r.tRef)
    return false
  }
  function pickTarget(e) {
    const r = e.rs, d = e.data, p = e.pos
    r.tKind = null; r.tRef = null
    let best = Infinity
    for (const b of K.barricadesList()) {
      if (!K.barricadeIntact(b) || Math.abs(K.barricadePos(b).y - p.y) > 3.5) continue
      const s = K.strikePoint(b, p, _a)
      const dd = K.planar(p, s)
      if (dd < MIN_CHARGE || dd > d.chargeRange || dd >= best) continue
      if (K.clearRun(p, s, dd) < dd - (d.bodyRadius + 0.9)) continue
      best = dd; r.tKind = 'barricade'; r.tRef = b; r.target.copy(s)
    }
    if (r.tKind) return true
    if (!K.coreAlive()) return false
    const c = K.core()
    _b.set(p.x - c.pos.x, 0, p.z - c.pos.z)
    if (_b.lengthSq() < 0.01) return false
    _a.copy(c.pos).addScaledVector(_b.normalize(), c.radius).addScaledVector(UP, 1.2)
    const dc = K.planar(p, _a)
    if (dc < MIN_CHARGE || dc > d.chargeRange || Math.abs(c.pos.y - p.y) > 3) return false
    if (K.clearRun(p, _a, dc) < dc - (d.bodyRadius + 0.9)) return false
    r.target.copy(_a); r.tKind = 'core'
    return true
  }
  function beginWindup(e) {
    const r = e.rs, d = e.data
    r.phase = 'windup'; r.t = 0; r.pawT = 0; r.charges++; r.hitPlayer = false
    K.cancelAttack(e)
    K.navStop(e)
    e.inst.anim.setLook(r.target)
    e.inst.anim.roar(d.chargeWindup)
    K.sfx(['sfx_rammer_charge_0', 'sfx_rammer_charge_1'], e.pos, 1)
    // charge line on the ground (telegraph)
    killLine(e)
    _a.copy(e.pos); _b.copy(r.target); _b.y = e.pos.y
    r.line = K.markers.line(_a, _b, 1.6, d.chargeWindup, { color: [1, 0.45, 0.12], hold: 0.6 })
  }
  function tickCharge(e, dt) {
    const r = e.rs, d = e.data
    r.t += dt
    e.roleMoves = true
    const to = _a.set(r.target.x - e.pos.x, 0, r.target.z - e.pos.z)
    const dist = to.length()
    if (dist > 0.05) K.turnYaw(e, Math.atan2(to.x, to.z), TURN * DEG * dt)
    const speed = d.chargeSpeed * K.clamp01(r.t / 0.25 + 0.3)
    _b.set(0, 0, 1).applyQuaternion(e.obj.quaternion)
    K.moveDirect(e, _b.x * speed * dt, _b.z * speed * dt, dt)
    e.vel.copy(_b).multiplyScalar(speed)
    if (!r.hitPlayer && K.playerAlive()) {
      const pp = K.playerPos()
      if (K.planar(pp, e.pos) < d.bodyRadius + 1 && Math.abs(pp.y - e.pos.y) < 1.8) {
        r.hitPlayer = true
        K.damagePlayer(d.chargeDamage * PLAYER_SHARE * e.damageScale, e, { type: d.attackDamageType, point: pp, dir: _b.clone(), source: 'enemy', sourceId: 'Rammer.Charge' })
        K.shake(0.45)
      }
    }
    let arrived = dist <= d.bodyRadius + 0.55
    r.stallT += dt
    if (!arrived && r.stallT >= 0.3) {
      const moved = K.planar(e.pos, r.lastPos)
      if (moved < speed * r.stallT * 0.2) {
        if (dist <= d.bodyRadius + 2.2) arrived = true
        else { endCharge(e, false); return }
      }
      r.stallT = 0; r.lastPos.copy(e.pos)
    }
    if (arrived) { impact(e); return }
    if (r.t >= r.maxT) endCharge(e, false)
  }
  function impact(e) {
    const r = e.rs, d = e.data
    _b.set(0, 0, 1).applyQuaternion(e.obj.quaternion)
    const info = { type: d.attackDamageType, point: r.target.clone(), dir: _b.clone(), source: 'enemy', sourceId: 'Rammer.Charge' }
    if (r.tKind === 'barricade' && K.barricadeIntact(r.tRef)) { K.damageBarricade(r.tRef, d.chargeDamage * e.damageScale, e, info); r.hits++ }
    else if (r.tKind === 'core' && K.coreAlive()) { K.damageCore(d.chargeDamage * e.damageScale, e, info); r.hits++ }
    e.inst.anim.strike()
    K.fxBurst('rammerImpact', r.target, { normal: _b.clone().negate() })
    K.sfx(['sfx_rammer_impact_0', 'sfx_rammer_impact_1'], r.target, 1)
    const pp = K.playerPos()
    if (pp) { const dd = pp.distanceTo(r.target); if (dd < 30) K.shake(K.lerp(0.55, 0.08, dd / 30)) }
    endCharge(e, true)
  }
  function endCharge(e, landed) {
    const r = e.rs
    K.navStop(e)
    e.inst.anim.clearLook()
    killLine(e)
    r.phase = 'recover'
    r.t = landed ? 0 : RECOVER * 0.5
  }

  // ================================================================ Spitter (SpitterRole.cs)
  const SCAN = 0.4, PLAYER_SLACK = 6
  const Spitter = {
    init(e) {
      e.rs = { aim: 'none', turret: null, unreachable: null, unreachableUntil: 0, holding: false, scanT: K.range(0, SCAN), lobs: 0, tp: new THREE.Vector3() }
      K.setWeakOpen(e, true)
    },
    engaged: e => e.rs.aim !== 'none',
    attackingStructure: e => e.rs.aim === 'turret' && e.rs.holding,
    onStruck(e) { e.rs.lobs++ },
    tick(e, dt) {
      const r = e.rs, d = e.data
      r.scanT -= dt
      if (r.scanT <= 0) {
        r.scanT = SCAN
        const before = r.aim
        pick(e)
        if (r.aim === 'none' && before !== 'none') release(e)
      }
      if (r.aim === 'none') return false
      const tp = r.tp
      let tkind, tref = null
      if (r.aim === 'turret') {
        if (K.turretOffline(r.turret)) { r.aim = 'none'; release(e); return false }
        tp.copy(r.turret.pos); tkind = 'turret'; tref = r.turret
      } else {
        if (!K.playerAlive()) { r.aim = 'none'; release(e); return false }
        tp.copy(K.playerPos()).addScaledVector(UP, 1.1); tkind = 'player'
      }
      const p = e.pos
      const dd = K.planar(p, tp)
      e.inst.anim.setLook(tp)
      if (dd > d.preferredRange + 1 && !e.winding) {
        // close in: walk the lane while one is left outside the walls, then head straight for it
        r.holding = false
        const w = K.world()
        if (K.routeLeft(e) && w && w.inYard && !w.inYard(p)) K.navRoute(e)
        else { _a.copy(tp); _a.y = p.y; K.navTo(e, _a) }
        if (e.blockedT < 1.2 && (K.routeLeft(e) || dd > 1.5)) return true
        if (dd > d.attackRange) {
          // the path ends out of the arc's reach: forget this target for a while and walk on
          if (r.aim === 'turret') { r.unreachable = r.turret; r.unreachableUntil = K.clock + 15 }
          r.aim = 'none'; release(e); e.blockedT = 0
          return false
        }
      } else if (r.aim === 'player' && dd < d.minRange && !e.winding) {
        // too close: back off, keeping the player in front
        r.holding = false
        _a.set(p.x - tp.x, 0, p.z - tp.z)
        if (_a.lengthSq() < 0.01) _a.set(0, 0, -1).applyQuaternion(e.obj.quaternion)
        _a.normalize().multiplyScalar(5).add(p)
        K.navTo(e, _a)
        e.noTurn = true // keep the player in front while backing off
        K.faceTowards(e, tp, dt)
        return true
      }
      // in the band: plant and lob
      r.holding = true
      K.navStop(e)
      K.faceTowards(e, tp, dt)
      K.tickAttack(e, tkind, tref, tp, dt)
      return true
    },
    onDied(e) { e.rs.aim = 'none'; e.rs.turret = null },
    onRemoved(e) { e.rs.aim = 'none'; e.rs.turret = null },
  }
  function pick(e) {
    const r = e.rs, d = e.data, p = e.pos
    let best = null, bestD = d.turretScanRange
    for (const t of K.turretsList()) {
      if (K.turretOffline(t) || !t.pos) continue
      if (t === r.unreachable && K.clock < r.unreachableUntil) continue
      if (Math.abs(t.pos.y - p.y) > 9) continue
      const dd = K.planar(p, t.pos) * (t === r.turret ? 0.8 : 1)
      if (dd < bestD) { bestD = dd; best = t }
    }
    if (best) { r.aim = 'turret'; r.turret = best; return }
    r.turret = null
    const pp = K.playerPos()
    if (K.playerAlive() && K.planar(p, pp) <= d.preferredRange + PLAYER_SLACK && Math.abs(pp.y - p.y) < 9) { r.aim = 'player'; return }
    r.aim = 'none'
  }
  function release(e) {
    const r = e.rs
    r.holding = false; r.turret = null
    K.cancelAttack(e)
    e.inst.anim.clearLook()
    if (e.state === ST.MOVE || e.state === ST.ATTACK_PLAYER) K.setState(e, ST.MOVE)
  }

  // ================================================================ Leech (LeechRole.cs)
  const LEAP_SECONDS = 0.55, LEAP_HEIGHT = 1.6, BITE = 0.5, SEEK_GIVE_UP = 25
  const leeches = t => (t && t.leeches) || []
  function leechPoint(t, slot, out) {
    if (t.leechPoint) { const lp = t.leechPoint(slot, out); if (lp) return out.copy(lp) }
    const yaw = (t.yaw || 0) + ((slot % 3) * 120 + 30) * DEG
    const r = t.latchRadius || 0.42
    return out.set(t.pos.x + Math.sin(yaw) * r, t.pos.y + 0.12, t.pos.z + Math.cos(yaw) * r)
  }
  function latch(t, e) {
    const tw = K.G.towers
    if (tw && tw.leechLatch) tw.leechLatch(t, e)
    else { if (!t.leeches) t.leeches = []; if (!t.leeches.includes(e)) t.leeches.push(e) }
  }
  function unlatch(t, e) {
    const tw = K.G.towers
    if (tw && tw.leechRelease) tw.leechRelease(t, e)
    else if (t.leeches) { const i = t.leeches.indexOf(e); if (i >= 0) t.leeches.splice(i, 1) }
  }
  function pickTurret(e, maxR) {
    let best = null, bestD = maxR
    for (const t of K.turretsList()) {
      if (K.turretDead(t) || !t.pos || leeches(t).length >= e.data.maxLeechesPerTurret) continue
      const dd = K.planar(e.pos, t.pos) + leeches(t).length * 12
      if (dd < bestD) { bestD = dd; best = t }
    }
    return best
  }
  const Leech = {
    init(e) {
      e.rs = { phase: 'seek', turret: null, t: 0, repathT: 0, slot: 0, from: new THREE.Vector3(), biteT: 0, fxT: 0, soundT: 0, latched: false }
      if (K.rng() < e.data.turretPreference) e.rs.turret = pickTurret(e, Infinity)
    },
    targetable: e => e.rs.phase !== 'leap',
    attackingStructure: e => e.rs.phase === 'latched' || e.rs.phase === 'feed',
    engaged: e => e.rs.phase !== 'seek' || !!e.rs.turret,
    fallsOnDeath: e => e.rs.phase === 'latched' || e.rs.phase === 'leap',
    tick(e, dt) {
      const r = e.rs
      r.t += dt
      switch (r.phase) {
        case 'seek': return seek(e, dt)
        case 'leap': tickLeap(e); return true
        case 'latched': tickLatched(e, dt); return true
        case 'feed': return tickFeed(e, dt)
      }
      return false
    },
    onDied(e) { detach(e) },
    onRemoved(e) { detach(e); e.rs.phase = 'seek' },
  }
  function seek(e, dt) {
    const r = e.rs, d = e.data
    if (!r.turret) {
      if (K.coreInRange(e)) { beginFeed(e); return true }
      r.repathT -= dt
      if (r.repathT <= 0) {
        r.repathT = 1
        const near = pickTurret(e, d.leapRange + 2)
        if (near && leeches(near).length === 0) { r.turret = near; r.t = 0 }
      }
      return false
    }
    const t = r.turret
    if (K.turretDead(t) || leeches(t).length >= d.maxLeechesPerTurret || r.t > SEEK_GIVE_UP) {
      r.turret = null
      K.setState(e, ST.MOVE)
      return false
    }
    const p = e.pos, lp = t.pos
    const dd = K.planar(p, lp), dy = lp.y - p.y
    if (dd <= d.leapRange && dy < 5 && dy > -3 && !e.winding) { beginLeap(e); return true }
    if (e.state === ST.SPAWNED) return false
    // path toward the turret: the lane (or the breach climb) while outside the walls, then straight at it
    const w = K.world()
    if (K.routeLeft(e) && w && w.inYard && !w.inYard(p) && !(dd < 14 && Math.abs(dy) < 3)) K.navRoute(e)
    else { _a.copy(lp); _a.y = p.y; K.navTo(e, _a) }
    return true
  }
  function beginLeap(e) {
    const r = e.rs
    r.phase = 'leap'; r.t = 0
    r.slot = leeches(r.turret).length
    latch(r.turret, e)
    r.latched = true
    r.from.copy(e.pos)
    K.navStop(e)
    K.cancelAttack(e)
    K.sfx(e.data.sounds.attack, e.pos, 0.8)
  }
  function tickLeap(e) {
    const r = e.rs
    e.roleMoves = true
    const k = K.clamp01(r.t / LEAP_SECONDS)
    const to = r.turret ? leechPoint(r.turret, r.slot, _a) : _a.copy(r.from)
    e.pos.lerpVectors(r.from, to, k).addScaledVector(UP, Math.sin(k * Math.PI) * LEAP_HEIGHT)
    _b.set(to.x - r.from.x, 0, to.z - r.from.z)
    if (_b.lengthSq() > 0.01) e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_b.x, _b.z))
    if (k >= 1) { r.phase = 'latched'; r.t = 0; r.biteT = BITE; r.fxT = 0; r.soundT = 0 }
  }
  function tickLatched(e, dt) {
    const r = e.rs, d = e.data, t = r.turret
    e.roleMoves = true
    if (!t || K.turretDead(t)) { detach(e); drop(e); return }
    const at = leechPoint(t, r.slot, _a)
    e.pos.copy(at)
    _b.set(t.pos.x - at.x, 0, t.pos.z - at.z)
    if (_b.lengthSq() > 1e-4) e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_b.x, _b.z))
    r.biteT -= dt
    if (r.biteT <= 0) {
      r.biteT = BITE
      K.damageTurret(t, d.drainPerSecond * BITE * e.damageScale, e, { type: d.attackDamageType, point: at.clone(), source: 'enemy', sourceId: 'Leech' })
      e.inst.anim.beginAttack(0.15); e.inst.anim.strike()
    }
    drainFx(e, at, dt)
  }
  function beginFeed(e) {
    const r = e.rs
    r.phase = 'feed'; r.t = 0; r.biteT = 0.2; r.fxT = 0; r.soundT = 0
    K.setState(e, ST.ATTACK_CORE)
    K.sfx(e.data.sounds.attack, e.pos, 0.7)
  }
  function tickFeed(e, dt) {
    const r = e.rs, d = e.data
    if (!K.coreInRange(e, 0.9) || !K.coreAlive()) { r.phase = 'seek'; K.setState(e, ST.MOVE); return false }
    const c = K.core()
    K.faceTowards(e, c.pos, dt)
    _b.set(e.pos.x - c.pos.x, 0, e.pos.z - c.pos.z)
    if (_b.lengthSq() < 0.01) _b.set(0, 0, 1).applyQuaternion(e.obj.quaternion)
    _a.copy(c.pos).addScaledVector(_b.normalize(), c.radius).addScaledVector(UP, 0.9)
    e.inst.anim.setLook(_a)
    r.biteT -= dt
    if (r.biteT <= 0) {
      r.biteT = BITE
      // shieldDrain 2.5: a shield soaking the bite loses 3.5x what it soaks (towers.damageCore reads info.shieldDrain)
      K.damageCore(d.drainPerSecond * BITE * e.damageScale, e, { type: d.attackDamageType, point: _a.clone(), source: 'enemy', sourceId: 'Leech', shieldDrain: d.shieldDrain })
      e.inst.anim.beginAttack(0.15); e.inst.anim.strike()
    }
    drainFx(e, _a, dt)
    return true
  }
  function drainFx(e, at, dt) {
    const r = e.rs
    r.fxT -= dt
    if (r.fxT <= 0) { r.fxT = 0.6; K.fxBurst('leechDrain', at, { color: e.data.mat.emis }) }
    r.soundT -= dt
    if (r.soundT <= 0) { r.soundT = K.range(1.6, 2.4); K.sfx(['sfx_leech_drain_0', 'sfx_leech_drain_1'], e.pos, 0.55) }
  }
  function detach(e) {
    const r = e.rs
    if (r.turret && r.latched) unlatch(r.turret, e)
    r.latched = false
    r.turret = null
  }
  function drop(e) {
    const r = e.rs
    r.phase = 'seek'
    const y = K.groundY(e.pos.x, e.pos.z, e.pos.y + 0.5)
    if (y === y) e.pos.y = y
    e.inst.anim.replant(e.obj, e.sizeMul)
    K.setState(e, ST.MOVE)
  }

  // ================================================================ Burrower (BurrowerRole.cs)
  const SINK = 2.4, EMERGE_SECONDS = 0.8, TRAIL = 0.8, RUMBLE = 2.2
  const Burrower = {
    init(e) {
      e.rs = { phase: 'approach', t: 0, exit: new THREE.Vector3(), trailT: 0, rumbleT: 0, emergeHit: false, crack: null, telegraphStarted: -1, surfacedAt: -1 }
    },
    targetable: e => e.rs.phase === 'approach' || e.rs.phase === 'surface' || (e.rs.phase === 'emerge' && e.rs.t > 0.3),
    engaged: e => e.rs.phase !== 'approach' && e.rs.phase !== 'surface',
    tick(e, dt) {
      const r = e.rs, d = e.data
      r.t += dt
      switch (r.phase) {
        case 'approach': {
          if (r.t < d.approachSeconds) return false
          if (K.planar(e.pos, K.core().pos) < d.surfaceMaxRadius + 8 || !chooseExit(e)) { r.phase = 'surface'; return false }
          beginDig(e)
          return true
        }
        case 'dig': tickDig(e); return true
        case 'under': tickUnder(e, dt); return true
        case 'telegraph': tickTelegraph(e, dt); return true
        case 'emerge': tickEmerge(e); return r.phase === 'emerge'
      }
      return false
    },
    onDied(e) { resetVisual(e); if (e.rs.crack) e.rs.crack.kill(); e.rs.phase = 'surface' },
    onRemoved(e) { resetVisual(e); if (e.rs.crack) e.rs.crack.kill(); e.rs.phase = 'surface' },
  }
  function chooseExit(e) {
    const d = e.data, c = K.core().pos, w = K.world()
    const pp = K.playerAlive() ? K.playerPos() : null
    let best = -Infinity, found = false
    for (let i = 0; i < 10; i++) {
      const a = K.rng() * Math.PI * 2, rr = K.range(d.surfaceMinRadius, d.surfaceMaxRadius)
      _a.set(c.x + Math.cos(a) * rr, c.y, c.z + Math.sin(a) * rr)
      const y = K.groundY(_a.x, _a.z, c.y + 1.5)
      if (y !== y || Math.abs(y - c.y) > 1.5) continue
      _a.y = y
      if (w && w.inYard && !w.inYard(_a)) continue
      if (K.planar(_a, c) < d.surfaceMinRadius * 0.8) continue
      let score = K.range(0, 4)
      if (pp) { const dp = K.planar(_a, pp); score += dp < 5 ? -20 : Math.min(dp, 18) }
      if (score > best) { best = score; e.rs.exit.copy(_a); found = true }
    }
    return found
  }
  function setSink(e, depth01, pitchDeg) {
    e.inst.vis.position.set(0, -SINK * depth01 * e.sizeMul, 0)
    e.inst.vis.rotation.set(pitchDeg * DEG, 0, 0)
  }
  function resetVisual(e) { e.inst.vis.position.set(0, 0, 0); e.inst.vis.rotation.set(0, 0, 0); e.inst.vis.visible = true; K.setHittable(e, true) }
  function beginDig(e) {
    const r = e.rs
    r.phase = 'dig'; r.t = 0
    K.cancelAttack(e)
    K.navStop(e)
    e.inst.anim.clearLook()
    K.fxBurst('burrowDig', e.pos, {})
    K.sfx(['sfx_burrow_dig_0', 'sfx_burrow_dig_1'], e.pos, 0.9)
  }
  function tickDig(e) {
    const r = e.rs
    e.roleMoves = true
    const k = K.clamp01(r.t / Math.max(0.1, e.data.digSeconds))
    setSink(e, k * k, 38 * Math.min(1, k * 2))
    if (k < 1) return
    K.setHittable(e, false)
    e.inst.vis.visible = false
    r.phase = 'under'; r.t = 0; r.trailT = 0; r.rumbleT = RUMBLE * 0.5
  }
  function tickUnder(e, dt) {
    const r = e.rs, d = e.data, p = e.pos
    e.roleMoves = true
    _a.set(r.exit.x - p.x, 0, r.exit.z - p.z)
    const dist = _a.length(), step = d.undergroundSpeed * dt
    if (dist > 0.01) e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_a.x, _a.z))
    if (dist > step) p.addScaledVector(_a, step / dist); else p.add(_a)
    const gy = K.groundY(p.x, p.z, Math.max(p.y, r.exit.y) + 30)
    p.y = K.lerp(p.y, gy === gy ? gy : r.exit.y, 0.5)
    r.trailT -= dt
    if (r.trailT <= 0) { r.trailT = TRAIL; K.fxBurst('burrowTrail', p, {}) }
    r.rumbleT -= dt
    if (r.rumbleT <= 0) { r.rumbleT = RUMBLE; K.sfx(['sfx_burrow_rumble_0', 'sfx_burrow_rumble_1'], p, 0.45) }
    if (dist > step) return
    // under the exit: the ground starts to crack
    p.copy(r.exit)
    r.phase = 'telegraph'; r.t = 0; r.telegraphStarted = K.clock
    r.crack = K.markers.ring(r.exit, 1.7, d.telegraphSeconds, { style: 'crack', hold: 1.2 })
    K.fxDecal('crack', r.exit, UP, { life: d.telegraphSeconds + 1.2, scale: 3.4 })
    K.sfx(['sfx_burrow_rumble_0', 'sfx_burrow_rumble_1'], r.exit, 1)
    K.emit('burrowTelegraph', e, r.exit, d.telegraphSeconds)
  }
  function tickTelegraph(e, dt) {
    const r = e.rs, d = e.data
    e.roleMoves = true
    const pp = K.playerPos()
    if (pp && pp.distanceTo(r.exit) < 12) K.shake(0.6 * dt)
    if (r.t < d.telegraphSeconds) return
    r.phase = 'emerge'; r.t = 0; r.emergeHit = false
    e.pos.copy(r.exit)
    const c = K.core().pos
    _a.set(c.x - r.exit.x, 0, c.z - r.exit.z)
    if (_a.lengthSq() > 0.01) e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_a.x, _a.z))
    e.inst.vis.visible = true
    setSink(e, 1, -32)
    e.inst.anim.initialize(e.obj, e.inst.vis, e.sizeMul)
    r.surfacedAt = K.clock
    K.fxBurst('burrowEmerge', r.exit, {})
    K.sfx(['sfx_burrow_emerge_0', 'sfx_burrow_emerge_1'], r.exit, 1)
    if (pp) { const dd = pp.distanceTo(r.exit); if (dd < 18) K.shake(K.lerp(0.5, 0.1, dd / 18)) }
  }
  function tickEmerge(e) {
    const r = e.rs, d = e.data
    e.roleMoves = true
    const k = K.clamp01(r.t / EMERGE_SECONDS)
    const ease = 1 - (1 - k) * (1 - k) * (1 - k)
    setSink(e, 1 - ease, -32 * (1 - ease))
    if (r.t > 0.3 && !r.emergeHit) {
      r.emergeHit = true
      K.setHittable(e, true)
      if (K.playerAlive()) {
        const pp = K.playerPos()
        if (K.planar(pp, r.exit) < 2.6 && Math.abs(pp.y - r.exit.y) < 2) {
          K.damagePlayer(d.emergeDamage * e.damageScale, e, { type: d.attackDamageType, point: pp, dir: _b.copy(pp).sub(r.exit).normalize().clone(), source: 'enemy', sourceId: 'Burrower.Emerge' })
        }
      }
    }
    if (k < 1) return
    resetVisual(e)
    r.phase = 'surface'
    K.setState(e, ST.MOVE)
  }

  return { Rammer, Spitter, Leech, Burrower, leechPoint }
}
