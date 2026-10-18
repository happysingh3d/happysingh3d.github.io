// Hive Adapt (Project 0 port): Siege Node (SiegeNode.cs) and its director (SiegeNodeDirector.cs).
// A static artillery organ that grows on the plain 46-60 m out. It is NOT on enemies.list: turrets never target it
// (LOCKED #3), it never holds a wave open, it persists across waves until killed and only fires during combat.
// The run loop drives the director with enemies.siegeTick(wave, waveTime) every combat frame.
import * as THREE from 'three'
import { KINDS, MATS } from './enemydata.js'
import { makeChitin, ChitinFx } from './chitin.js'
import { compass } from './u.js'

const SINK = 4.2, WINDUP = 0.8, DEATH = 2.2, POOL = 2
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _v = new THREE.Vector3()
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

export function createSiege(K) {
  const G = K.G
  const D = KINDS.SiegeNode
  const nodes = [] // live + dying (the HUD reads these)
  const free = []
  let gltf = null
  let lastWave = -1, pendingAt = -1, pendingWave = 0, lastTick = -10, waveClock = 0
  let nextId = 900000

  async function load() {
    gltf = await G.assets.glb('SM_SiegeNode')
    for (let i = 0; i < POOL; i++) free.push(makeNode())
  }

  function makeNode() {
    const model = gltf.scene.clone(true)
    const mat = makeChitin(MATS.SiegeNode)
    model.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true } })
    const vis = new THREE.Group(); vis.add(model)
    const obj = new THREE.Group(); obj.name = 'SiegeNode'; obj.add(vis)
    const sac = model.getObjectByName('Sac'), throat = model.getObjectByName('Throat'), muzzle = model.getObjectByName('Muzzle')
    let light = null
    if (G.enemyLights === true) {
      const S = G.S || 1
      light = new THREE.PointLight(new THREE.Color(1, 0.34, 0.1), 0, 12 * S, 2)
      light.userData.base = 14 * S * S
      light.position.set(0, 2.6, 0)
      obj.add(light)
    }
    return {
      obj, vis, model, sac, throat, muzzle, light, mat, chitin: new ChitinFx([mat], 1),
      sacRest: sac ? sac.scale.clone() : new THREE.Vector3(1, 1, 1), throatRest: throat ? throat.quaternion.clone() : new THREE.Quaternion(),
      throatPos: throat ? throat.position.clone() : new THREE.Vector3(0, 3.55, 0.2),
    }
  }

  // ---------------------------------------------------------------- director
  function siegeOrgansStacks() {
    const h = K.hive()
    if (!h) return 0
    if (typeof h.siegeChanceScale === 'number') return Math.log(h.siegeChanceScale) / Math.log(2.5)
    let n = 0
    for (const p of h.picks || []) { const id = typeof p === 'string' ? p : p && (p.id || (p.data && p.data.id)); if (id === 'siege_organs') n++ }
    return n
  }
  const maxAliveOn = w => (w >= 15 ? 2 : 1)
  const growChance = w => Math.min(0.8, 0.4 + 0.05 * (w - D.firstWave))
  const aliveCount = () => nodes.filter(n => n.alive).length

  /**
   * enemies.siegeTick(wave, waveTime, { bossWave, chanceScale }): call every COMBAT frame.
   * The first call with a new wave number is WaveStarted (the grow roll); the node grows 6-12 s of waveTime later.
   * Nodes only fire on frames where siegeTick was called (combat); between waves they hold fire.
   */
  function tick(wave, waveTime, opts = {}) {
    lastTick = K.clock
    waveClock = waveTime
    if (wave !== lastWave) {
      lastWave = wave
      const boss = opts.bossWave ?? (wave > 0 && wave % 5 === 0)
      const alive = aliveCount() + (pendingAt >= 0 ? 1 : 0)
      const chanceScale = opts.chanceScale ?? Math.pow(2.5, siegeOrgansStacks())
      if (wave >= D.firstWave && !boss && alive < maxAliveOn(wave) && K.rng() < K.clamp01(growChance(wave) * Math.max(0, chanceScale))) {
        pendingAt = waveTime + K.range(6, 12)
        pendingWave = wave
      }
    }
    if (pendingAt >= 0 && waveTime >= pendingAt) { pendingAt = -1; grow(null, pendingWave) }
  }
  const firingAllowed = () => K.clock - lastTick < 0.25

  function chooseSpot(out) {
    const c = K.core().pos, pp = K.playerPos()
    let best = -Infinity
    out.set(c.x, 0, c.z - D.minRadius)
    for (let i = 0; i < 30; i++) {
      const yaw = K.range(-180, 180)
      let near = false
      for (const a of D.avoidYaws) { let dd = ((yaw - a) % 360 + 540) % 360 - 180; if (Math.abs(dd) < D.avoidDegrees) near = true }
      if (near) continue
      const r = K.range(D.minRadius, D.maxRadius)
      compass(yaw, r, 0, _a).add(_b.set(c.x, 0, c.z))
      const y = K.groundY(_a.x, _a.z, 40)
      if (y !== y || y > 2.5) continue
      _a.y = y
      let score = K.rng() * 4
      if (pp) score += Math.min(Math.hypot(_a.x - pp.x, _a.z - pp.z), 40)
      for (const n of nodes) if (n.alive && n.pos.distanceToSquared(_a) < 18 * 18) score -= 40
      if (score > best) { best = score; out.copy(_a) }
    }
    return out
  }

  // ---------------------------------------------------------------- node lifecycle
  function grow(at, wave, id) {
    let inst = free.pop()
    if (!inst) {
      // both slots busy: Unity has two pooled nodes and refuses a third
      if (nodes.length >= POOL) return null
      inst = makeNode()
    }
    wave = Math.max(wave || D.firstWave, D.firstWave)
    const pos = at ? _c.copy(at) : chooseSpot(_c)
    const n = {
      id: id != null ? id : nextId++, kind: 'SiegeNode', data: D, inst, obj: inst.obj, pos: inst.obj.position, vel: new THREE.Vector3(), aim: new THREE.Vector3(),
      hp: 0, maxHp: 0, alive: true, elite: false, boss: null, minion: false, siege: true, targetable: false, attackingStructure: false,
      zone: 'outside', radius: D.bodyRadius, height: 6.9, hittable: true, state: 'growing', t: 0, wave, shots: 0,
      winding: false, nextShot: 0, recoil: 0, target: new THREE.Vector3(), aimKind: null, aimRef: null, throatAim: inst.throatRest.clone(),
      hurtAt: 0, releaseAt: 0, weakOpen: true,
    }
    if (id != null && id >= nextId) nextId = id + 1
    n.pos.copy(pos)
    const c = K.core().pos
    n.obj.quaternion.setFromAxisAngle(UP, Math.atan2(c.x - pos.x, c.z - pos.z))
    n.maxHp = D.maxHealth * (1 + D.healthPerWave * (wave - D.firstWave))
    n.hp = n.maxHp
    if (inst.throat) { inst.throat.quaternion.copy(inst.throatRest); inst.throat.scale.set(1, 1, 1) }
    if (inst.sac) inst.sac.scale.copy(inst.sacRest)
    inst.vis.position.set(0, -SINK, 0)
    inst.vis.scale.setScalar(0.7)
    inst.vis.visible = true
    inst.chitin.reset(K.rng() * 6.28)
    G.root.add(n.obj)
    nodes.push(n)
    K.fxBurst('siegeGrow', pos, { seconds: D.growSeconds })
    K.sfx(D.sounds.grow, _a.copy(pos).addScaledVector(UP, 1), 1)
    K.shakeAt(0.35, pos, 60)
    K.sfx(D.sounds.alarm, null, 0.8)
    K.emit('siegeGrow', n)
    return n
  }

  function update(dt) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      n.t += dt
      n.aim.set(0, 2.45 * n.inst.vis.scale.y, 0).add(n.inst.vis.position).add(n.pos)
      if (n.state === 'growing') tickGrow(n)
      else if (n.state === 'active') tickActive(n, dt)
      else if (n.state === 'dead') tickDeath(n)
      n.inst.chitin.update(dt, K.clock)
      if (n.state === 'gone') {
        G.root.remove(n.obj)
        if (n.inst.light) n.inst.light.intensity = 0
        free.push(n.inst)
        nodes.splice(i, 1)
      }
    }
  }
  function tickGrow(n) {
    const k = K.clamp01(n.t / D.growSeconds)
    const e = 1 - (1 - k) ** 3
    const tr = 0.05 * (1 - k)
    n.inst.vis.position.set((K.rng() - 0.5) * 2 * tr, -SINK * (1 - e) + (K.rng() - 0.5) * 2 * tr, (K.rng() - 0.5) * 2 * tr)
    n.inst.vis.scale.setScalar(K.lerp(0.7, 1, e))
    if (n.inst.light) n.inst.light.intensity = n.inst.light.userData.base * e * 0.8
    if (k >= 1) { n.state = 'active'; n.t = 0; n.inst.vis.position.set(0, 0, 0); n.inst.vis.scale.setScalar(1); n.nextShot = K.clock + D.firstShotDelay }
  }
  function tickActive(n, dt) {
    const inst = n.inst
    const pulse = 1 + Math.sin(n.t * MATS.SiegeNode.pulseSpeed * Math.PI * 2) * 0.06
    const flare = n.winding ? K.clamp01(1 - (n.nextShot - K.clock) / WINDUP) : 0
    if (inst.sac) inst.sac.scale.copy(inst.sacRest).multiplyScalar(pulse + flare * 0.12)
    inst.chitin.setGlow(1 + flare * 1.8)
    if (inst.light) inst.light.intensity = inst.light.userData.base * (0.8 + 0.2 * pulse + flare * 2.5)
    if (inst.throat) {
      n.recoil = Math.max(0, n.recoil - dt * 3)
      const want = n.winding ? n.throatAim : _q2.copy(inst.throatRest).slerp(n.throatAim, 0.5)
      inst.throat.quaternion.slerp(want, Math.min(1, dt * 5))
      inst.throat.scale.set(1 + n.recoil * 0.12, 1 - n.recoil * 0.18, 1 + n.recoil * 0.12)
    }
    if (!firingAllowed()) { n.winding = false; n.nextShot = Math.max(n.nextShot, K.clock + D.firstShotDelay); return }
    if (!n.winding && K.clock >= n.nextShot - WINDUP) { n.winding = pickTarget(n); if (!n.winding) n.nextShot = K.clock + 1 }
    if (n.winding && K.clock >= n.nextShot) { fire(n); n.winding = false; n.nextShot = K.clock + D.fireInterval }
  }
  function muzzleWorld(n, out) {
    // game-space muzzle position (obj -> vis -> throat -> muzzle)
    const inst = n.inst
    _q.copy(inst.throat ? inst.throat.quaternion : _qi.identity())
    out.set(0, 3.3, 0).multiply(inst.throat ? inst.throat.scale : _v.set(1, 1, 1)).applyQuaternion(_q).add(inst.throatPos)
    out.multiplyScalar(inst.vis.scale.x).add(inst.vis.position).applyQuaternion(n.obj.quaternion).add(n.pos)
    return out
  }
  function pickTarget(n) {
    let best = null
    if (K.rng() < D.barricadeChance) {
      let bd = Infinity
      for (const b of K.barricadesList()) { if (!K.barricadeIntact(b)) continue; const d = K.barricadePos(b).distanceToSquared(n.pos); if (d < bd) { bd = d; best = b } }
    }
    const a = K.rng() * Math.PI * 2, s = Math.sqrt(K.rng()) * D.scatter
    if (best) {
      K.strikePoint(best, n.pos, n.target).add(_a.set(Math.cos(a) * s * 0.5, 0, Math.sin(a) * s * 0.5))
      n.aimKind = 'barricade'; n.aimRef = best
    } else {
      if (!K.coreAlive()) return false
      n.target.copy(K.core().pos).addScaledVector(UP, 1.2).add(_a.set(Math.cos(a) * s, 0, Math.sin(a) * s))
      n.aimKind = 'core'; n.aimRef = null
    }
    // swing the throat (rest pose = neck up) onto the launch direction
    if (n.inst.throat) {
      const from = muzzleWorld(n, _b)
      K.lobVelocity(from, n.target, D.shellSpeed, K.PROJECTILES.shell.gravity, _c)
      _q.setFromUnitVectors(UP, _c.normalize())
      _qi.copy(n.obj.quaternion).invert()
      n.throatAim.copy(_qi).multiply(_q).multiply(n.obj.quaternion).multiply(n.inst.throatRest)
    }
    return true
  }
  function fire(n) {
    const from = muzzleWorld(n, _b).clone()
    const v = _c
    K.lobVelocity(from, n.target, D.shellSpeed, K.PROJECTILES.shell.gravity, v)
    const dmg = D.attackDamage * (1 + D.damagePerWave * (n.wave - D.firstWave))
    K.fireProjectile('shell', from, v, dmg, n, 'Explosive')
    const hv = Math.hypot(v.x, v.z), hd = Math.hypot(n.target.x - from.x, n.target.z - from.z)
    const flight = hv > 0.1 ? hd / hv : 2
    const ground = _a.copy(n.target)
    const gy = K.groundY(ground.x, ground.z, ground.y + 3)
    if (gy === gy) ground.y = gy
    K.markers.ring(ground, K.PROJECTILES.shell.splash, flight + 0.25, { style: 'siege', color: [1, 0.2, 0.08], hold: 0.15 })
    K.fxBurst('siegeMuzzle', from, { dir: v.clone().normalize() })
    K.sfx(D.sounds.attack, from, 1)
    n.recoil = 1
    n.shots++
    K.shakeAt(0.12, n.pos, 40)
    K.emit('siegeShell', { pos: ground.clone(), aim: n.target.clone(), kind: n.aimKind, barricade: n.aimRef, flight, node: n })
  }
  function tickDeath(n) {
    const k = K.clamp01(n.t / DEATH)
    n.inst.vis.position.set(0, -SINK * 0.6 * k * k, 0)
    if (n.inst.light) n.inst.light.intensity = n.inst.light.userData.base * (1 - k)
    if (k >= 1) n.state = 'gone'
  }

  // ---------------------------------------------------------------- damage and hit volumes
  // body box 4.4 x 1.9 x 4.4 centred y 0.75; throat capsule r 0.6 pivot -> muzzle (+0.6); weak sac sphere r 1.24 at y 2.45
  /** pred: a co-op guest's own view (the host's node decides): the node never dies here, the host's kill message ends it */
  function damage(n, info, pred) {
    if (!n.alive) return 0
    const h = K.hive()
    const type = info.type || 'Ballistic'
    const res = h && h.resist ? K.clamp(h.resist[type] || 0, 0, 0.6) : 0
    const weak = !!info.weak
    let final = Math.max(0, info.amount || 0) * (weak ? 2 + Math.max(0, info.weakBonus || 0) : 1) * (1 - res)
    if (type === D.weakTo) final *= D.weakToScale
    n.hp = pred ? Math.max(Math.min(n.hp, 1), n.hp - final) : Math.max(0, n.hp - final)
    n.inst.chitin.hit(weak ? 1 : 0.7)
    if (K.clock >= n.hurtAt) { n.hurtAt = K.clock + 0.35; K.sfx(D.sounds.hurt, info.point || n.pos, 0.9) }
    K.emit('enemyDamaged', n, final, info)
    if (n.hp <= 0 && !pred) die(n, info)
    return final
  }
  function die(n, info) {
    n.alive = false; n.hittable = false; n.winding = false
    n.state = 'dead'; n.t = 0
    const at = _a.copy(n.pos).addScaledVector(UP, 2.4)
    K.fxBurst('siegeDeath', at, { radius: 14 })
    K.sfx(D.sounds.death, at, 1)
    K.shakeAt(0.5, n.pos, 50)
    n.inst.chitin.beginDissolve(K.clock, 0.6, DEATH - 0.6)
    K.emit('enemyKilled', n, info)
  }
  const _lo = new THREE.Vector3(), _ld = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3()
  function localRay(n, o, d) {
    _qi.copy(n.obj.quaternion).invert()
    const s = n.inst.vis.scale.x || 1
    _lo.copy(o).sub(n.pos).applyQuaternion(_qi).sub(n.inst.vis.position).divideScalar(s)
    _ld.copy(d).applyQuaternion(_qi)
    return s
  }
  function throatSeg(n) {
    const inst = n.inst
    _p1.copy(inst.throatPos)
    _p2.set(0, 3.9, 0).applyQuaternion(inst.throat ? inst.throat.quaternion : _qi.identity()).add(inst.throatPos)
  }
  function rayBox(o, d, min, max) {
    let t0 = -Infinity, t1 = Infinity
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < min[ax] || o[ax] > max[ax]) return -1; continue }
      let ta = (min[ax] - o[ax]) / d[ax], tb = (max[ax] - o[ax]) / d[ax]
      if (ta > tb) { const t = ta; ta = tb; tb = t }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb)
      if (t0 > t1) return -1
    }
    return t1 < 0 ? -1 : Math.max(0, t0)
  }
  const BOX_MIN = new THREE.Vector3(-2.2, -0.2, -2.2), BOX_MAX = new THREE.Vector3(2.2, 1.7, 2.2), SAC = new THREE.Vector3(0, 2.45, 0)
  function raycast(n, o, d, far) {
    if (!n.alive) return null
    const s = localRay(n, o, d)
    let best = Infinity, weak = false
    const tb = rayBox(_lo, _ld, BOX_MIN, BOX_MAX); if (tb >= 0 && tb < best) { best = tb; weak = false }
    throatSeg(n)
    const tt = rayCapsuleLocal(_lo, _ld, _p1, _p2, 0.6); if (tt >= 0 && tt < best) { best = tt; weak = false }
    const sc = n.inst.sac ? n.inst.sac.scale.x / (n.inst.sacRest.x || 1) : 1
    const ts = raySphereLocal(_lo, _ld, SAC, 1.24 * sc); if (ts >= 0 && ts < best) { best = ts; weak = true }
    if (best === Infinity || best * s > far) return null
    return { t: best * s, weak }
  }
  function distance(n, p) {
    const s = localRay(n, p, UP)
    const cx = K.clamp(_lo.x, BOX_MIN.x, BOX_MAX.x), cy = K.clamp(_lo.y, BOX_MIN.y, BOX_MAX.y), cz = K.clamp(_lo.z, BOX_MIN.z, BOX_MAX.z)
    let d = Math.hypot(_lo.x - cx, _lo.y - cy, _lo.z - cz)
    d = Math.min(d, _lo.distanceTo(SAC) - 1.24)
    throatSeg(n)
    _a.subVectors(_p2, _p1); const l2 = _a.lengthSq()
    const t = l2 > 0 ? K.clamp(_b.subVectors(_lo, _p1).dot(_a) / l2, 0, 1) : 0
    d = Math.min(d, _lo.distanceTo(_c.copy(_p1).addScaledVector(_a, t)) - 0.6)
    return Math.max(0, d * s)
  }
  function clear() {
    for (const n of nodes) { G.root.remove(n.obj); if (n.inst.light) n.inst.light.intensity = 0; free.push(n.inst) }
    nodes.length = 0
    pendingAt = -1; lastWave = -1
  }

  return { load, tick, grow, update, damage, raycast, distance, clear, nodes, chooseSpot, get pending() { return pendingAt }, kill: (n, info) => { if (n && n.alive) { n.hp = 0; die(n, info || {}) } } }
}

function raySphereLocal(ro, rd, c, r) {
  const ox = ro.x - c.x, oy = ro.y - c.y, oz = ro.z - c.z
  const b = ox * rd.x + oy * rd.y + oz * rd.z
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  if (h < 0) return -1
  const t = -b - Math.sqrt(h)
  return t >= 0 ? t : (-b + Math.sqrt(h) >= 0 ? 0 : -1)
}
function rayCapsuleLocal(ro, rd, pa, pb, r) {
  // sample-free: closest approach of the ray to the segment, then sphere test there
  const ux = pb.x - pa.x, uy = pb.y - pa.y, uz = pb.z - pa.z
  const wx = ro.x - pa.x, wy = ro.y - pa.y, wz = ro.z - pa.z
  const a = ux * ux + uy * uy + uz * uz, b = ux * rd.x + uy * rd.y + uz * rd.z, c = rd.x * rd.x + rd.y * rd.y + rd.z * rd.z
  const d = ux * wx + uy * wy + uz * wz, e = rd.x * wx + rd.y * wy + rd.z * wz
  const den = a * c - b * b
  let s = den > 1e-9 ? (b * e - c * d) / den : 0
  s = Math.max(0, Math.min(1, s))
  const cx = pa.x + ux * s, cy = pa.y + uy * s, cz = pa.z + uz * s
  return raySphereLocal(ro, rd, { x: cx, y: cy, z: cz }, r)
}
