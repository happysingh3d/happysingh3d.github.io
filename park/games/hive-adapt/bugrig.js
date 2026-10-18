// Hive Adapt (Project 0 port): BugAnimator, the procedural gait (BugAnimator.cs) on the GLB bones.
// Tripod gait with 2-bone leg IK that plants feet on the ground, stride matched to speed, body bob/tilt from the
// planted feet and acceleration, head tracking, mandibles, lunges, flinches, wings, boss arms/plates/roar and a
// death tumble with curling legs. Nothing is keyframed.
//
// Spaces: "world" = game space (G.root local). "model" = the GLB scene space (+Z forward, +Y up, feet at y 0).
// All rig math runs in model space; bone local rotations are derived from precomputed rest data, so the per-frame
// cost is a handful of quaternion ops per bone and no matrixWorld reads.
import * as THREE from 'three'
import { GAIT_DEFAULT } from './enemydata.js'

const DEG = Math.PI / 180
const smooth = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x) }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const angDiffDeg = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d }

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1)

// scratch (module-level, reused every call: zero per-frame allocations)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3()
const _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3()
const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _xa = new THREE.Vector3()
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qInv = new THREE.Quaternion()
const _m = new THREE.Matrix4(), _mInv = new THREE.Matrix4(), _mb = new THREE.Matrix4(), _mVis = new THREE.Matrix4()
const _one = new THREE.Vector3(1, 1, 1)
const _A = new THREE.Vector3(), _T = new THREE.Vector3(), _H = new THREE.Vector3(), _K = new THREE.Vector3(), _E = new THREE.Vector3()
const _u1 = new THREE.Vector3(), _w1 = new THREE.Vector3(), _n1 = new THREE.Vector3(), _perp = new THREE.Vector3()
const _qf = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qc = new THREE.Quaternion()

function basisQuat(x, y, z, out) { _mb.makeBasis(x, y, z); return out.setFromRotationMatrix(_mb) }
/** axis (model frame) expressed in the rest frame of a bone's parent */
function axisIn(parentRestQ, axis) { return axis.clone().applyQuaternion(parentRestQ.clone().invert()).normalize() }

/**
 * Analyse a GLB scene once per kind: rest model-space transforms, IK constants and per-bone rotation axes.
 * Returns a template shared by every instance of the kind.
 */
export function analyseRig(scene, data) {
  scene.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert()
  const restM = new Map() // name -> { pos, quat } in model space
  scene.traverse(o => {
    if (!o.name) return
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3()
    m.decompose(pos, quat, sc)
    restM.set(o.name, { pos, quat, obj: o })
  })
  const has = n => restM.has(n)
  const R = n => restM.get(n)
  const parentQ = n => { const p = R(n).obj.parent; return p && restM.has(p.name) ? R(p.name).quat : new THREE.Quaternion() }
  const local = n => ({ pos: R(n).obj.position.clone(), quat: R(n).obj.quaternion.clone(), scale: R(n).obj.scale.clone() })
  const gait = Object.assign({}, GAIT_DEFAULT, data.gait || {})
  const tpl = { gait, animScale: data.animScale || 1, flying: !!gait.flying, referenceSpeed: data.moveSpeed || 3.6, names: [], bones: {}, legs: [], wings: [], arms: [], plates: [], mandibles: [] }
  const add = (key, n, extra = {}) => { if (!has(n)) return null; tpl.names.push(n); const b = Object.assign({ name: n, idx: tpl.names.length - 1, rest: local(n), restM: R(n) }, extra); tpl.bones[key] = b; return b }
  const withAxes = (n, extra = {}) => { const pq = parentQ(n); return Object.assign({ upP: axisIn(pq, Y), xP: axisIn(pq, X), zP: axisIn(pq, Z) }, extra) }

  add('root', 'Root')
  tpl.pivot = has('Body') ? R('Body').pos.clone() : new THREE.Vector3()
  tpl.bodyHeight = Math.max(0.05, tpl.pivot.y)
  if (has('Head')) add('head', 'Head', withAxes('Head'))
  if (has('Abdomen')) add('abdomen', 'Abdomen', withAxes('Abdomen'))
  const headX = has('Head') ? R('Head').pos.x : 0
  for (const s of ['L', 'R']) {
    const n = 'Mandible_' + s
    if (!has(n)) continue
    const b = add('mand' + s, n, withAxes(n, { side: Math.sign(R(n).pos.x - headX) || (s === 'L' ? 1 : -1) }))
    tpl.mandibles.push(b)
  }
  for (const s of ['L', 'R']) for (let i = 0; i < 2; i++) {
    const n = `Wing_${s}${i}`
    if (!has(n)) continue
    tpl.wings.push(add('wing' + s + i, n, withAxes(n, { side: R(n).pos.x >= 0 ? 1 : -1 })))
  }
  for (const s of ['L', 'R']) {
    const n = `Arm_${s}_Upper`, nl = `Arm_${s}_Lower`
    if (!has(n)) continue
    const up = add('armU' + s, n, withAxes(n))
    const lo = has(nl) ? add('armL' + s, nl, withAxes(nl)) : null
    tpl.arms.push({ upper: up, lower: lo })
  }
  for (let i = 0; i < 3; i++) { const n = 'Plate_' + i; if (has(n)) tpl.plates.push(add('plate' + i, n, withAxes(n))) }
  // legs: Leg_{L|R}{0..2}_{Coxa,Femur,Tibia,Foot}; flyers have no Foot (a tip is synthesised)
  for (const s of ['L', 'R']) for (let i = 0; i < 3; i++) {
    const fN = `Leg_${s}${i}_Femur`, tN = `Leg_${s}${i}_Tibia`, ftN = `Leg_${s}${i}_Foot`
    if (!has(fN) || !has(tN)) continue
    const femur = add(`legF${s}${i}`, fN, withAxes(fN))
    const tibia = add(`legT${s}${i}`, tN)
    const fRest = R(fN).pos, kRest = R(tN).pos
    const footRest = has(ftN) ? R(ftN).pos.clone() : kRest.clone().add(kRest.clone().sub(fRest).multiplyScalar(0.9))
    const uRest = kRest.clone().sub(fRest), vRest = footRest.clone().sub(kRest)
    const a = uRest.length(), b = vRest.length()
    uRest.normalize(); vRest.normalize()
    const nRest = new THREE.Vector3().crossVectors(uRest, vRest)
    if (nRest.lengthSq() < 1e-8) nRest.set(0, 0, 1).cross(uRest)
    nRest.normalize()
    const B0f = basisQuat(uRest, nRest, new THREE.Vector3().crossVectors(uRest, nRest), new THREE.Quaternion())
    const B0t = basisQuat(vRest, nRest, new THREE.Vector3().crossVectors(vRest, nRest), new THREE.Quaternion())
    const Kf = B0f.clone().invert().multiply(R(fN).quat)
    const Kt = B0t.clone().invert().multiply(R(tN).quat)
    const restLocal = footRest.clone(); restLocal.y = 0
    tpl.legs.push({
      femur, tibia, hasFoot: has(ftN), group: ((s === 'L' ? 0 : 1) + i) % 2, side: s, i,
      fRest: fRest.clone(), kRest: kRest.clone(), footRest, restLocal, a, b, nRest, Kf, Kt, coxaQ: parentQ(fN).clone(),
    })
  }
  tpl.nLegs = tpl.legs.length
  tpl.restList = []
  for (const k in tpl.bones) tpl.restList[tpl.bones[k].idx] = tpl.bones[k].rest
  return tpl
}

/** Leg state per instance */
class LegState {
  constructor() { this.planted = new THREE.Vector3(); this.from = new THREE.Vector3(); this.to = new THREE.Vector3(); this.current = new THREE.Vector3(); this.t = 0; this.stepping = false }
}

const ACT_NONE = 0, ACT_WINDUP = 1, ACT_STRIKE = 2, ACT_RECOVER = 3, ACT_ROAR = 4, ACT_DEAD = 5

/**
 * Per-instance animator. bones = array of Object3D in tpl.names order (found on the clone).
 * ground(p, up, scale, out) -> out (world point under p along -up); provided by enemies.js.
 */
export class BugAnim {
  constructor(tpl, bones, ground, rng) {
    this.tpl = tpl
    this.b = bones
    this.ground = ground
    this.rng = rng
    this.legs = tpl.legs.map(() => new LegState())
    this.lastPos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.accel = new THREE.Vector3()
    this.flinchPos = new THREE.Vector3(); this.flinchPosVel = new THREE.Vector3(); this.flinchTilt = new THREE.Vector3(); this.flinchTiltVel = new THREE.Vector3()
    this.deadOffset = new THREE.Vector3(); this.deadVel = new THREE.Vector3()
    this.lookTarget = new THREE.Vector3(); this.hasLook = false
    // published every frame: the body transform in model space (weak points follow it)
    this.bodyQ = new THREE.Quaternion(); this.bodyT = new THREE.Vector3(); this.offM = new THREE.Vector3()
    // per-frame scalars (kept as fields: no boxed doubles between the steps)
    this.dt = 0.016; this.sizeScale = 1.5; this.vs = 1.5; this.lunge = 0.5; this.pitchAct = 0.5; this.armRaise = 0.5; this.headPitch = 0.5; this.rise = 0.5; this.mandOpen = 0.5
    this.speed = 0.5; this.stepDur = 0.5; this.stepping = 0; this.bodyY = 0.5; this.pitch = 0.5; this.roll = 0.5; this.yawRate = 0.5; this.lastYaw = 0.5; this.actT = 0.5; this.deadT = 0.5
    this.windupDur = 0.5; this.roarDur = 0.5; this.plateOpen = 0.5; this.plateTarget = 0.5; this.deadRoll = 0.5; this.deadPitch = 0.5
    this.onFootPlanted = null
    this.act = ACT_NONE
    this.time = 0; this.seed = 0
  }

  /** after the enemy is placed (obj = its Object3D, vis = visual root) */
  initialize(obj, vis, sizeScale) {
    this.restorePose()
    this.act = ACT_NONE; this.actT = 0
    this.flinchPos.set(0, 0, 0); this.flinchPosVel.set(0, 0, 0); this.flinchTilt.set(0, 0, 0); this.flinchTiltVel.set(0, 0, 0)
    this.deadOffset.set(0, 0, 0); this.deadVel.set(0, 0, 0)
    this.plateOpen = 0; this.plateTarget = 0; this.hasLook = false
    this.seed = this.rng() * 100
    this.lastPos.copy(obj.position)
    this.lastYaw = this.yawOf(obj.quaternion); this.yawRate = 0
    this.vel.set(0, 0, 0); this.accel.set(0, 0, 0)
    this.wingDead = 1
    this.replant(obj, sizeScale)
    this.bodyQ.identity(); this.bodyT.set(0, 0, 0)
  }

  yawOf(q) { _fwd.set(0, 0, 1).applyQuaternion(q); return Math.atan2(_fwd.x, _fwd.z) / DEG }

  replant(obj, sizeScale) {
    _up.set(0, 1, 0).applyQuaternion(obj.quaternion)
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i]
      _v1.copy(this.tpl.legs[i].restLocal).multiplyScalar(sizeScale).applyQuaternion(obj.quaternion).add(obj.position)
      this.ground(_v1, _up, this.tpl.animScale, l.planted)
      l.current.copy(l.planted); l.stepping = false; l.t = 0
    }
  }

  restorePose() {
    const rl = this.tpl.restList
    for (let i = 0; i < rl.length; i++) {
      const bone = this.b[i], r = rl[i]
      if (bone && r) { bone.position.copy(r.pos); bone.quaternion.copy(r.quat); bone.scale.copy(r.scale) }
    }
  }

  setLook(p) { this.lookTarget.copy(p); this.hasLook = true }
  clearLook() { this.hasLook = false }
  beginAttack(windup) { if (this.act === ACT_DEAD) return; this.act = ACT_WINDUP; this.windupDur = Math.max(0.05, windup); this.actT = 0 }
  strike() { if (this.act === ACT_DEAD) return; this.act = ACT_STRIKE; this.actT = 0 }
  roar(d) { if (this.act === ACT_DEAD) return; this.act = ACT_ROAR; this.roarDur = d; this.actT = 0 }
  setPlatesOpen(open) { this.plateTarget = open ? 1 : 0 }
  get dead() { return this.act === ACT_DEAD }

  /** directional flinch: dir = travel direction of the hit (world) */
  flinch(dir, strength) {
    if (this.act === ACT_DEAD) return
    _v1.set(dir ? dir.x : 0, 0, dir ? dir.z : 0)
    if (_v1.lengthSq() < 1e-4) _v1.set(0, 0, -1).applyQuaternion(this._lastQ || _q1.identity()).setY(0)
    if (_v1.lengthSq() < 1e-6) _v1.set(0, 0, -1)
    _v1.normalize()
    const s = clamp(strength, 0.1, 2) / this.tpl.animScale
    this.flinchPosVel.addScaledVector(_v1, 2.6 * s)
    // tilt away from the shot: about cross(up, dir) (positive about +X = nose down, as in Unity)
    _v2.crossVectors(Y, _v1)
    this.flinchTiltVel.addScaledVector(_v2, 260 * s)
  }

  die(dir, obj) {
    if (this.act === ACT_DEAD) return
    this.act = ACT_DEAD; this.deadT = 0
    _v1.set(dir ? dir.x : 0, 0, dir ? dir.z : 0)
    if (_v1.lengthSq() < 1e-4) _v1.set(0, 0, -1).applyQuaternion(obj.quaternion).setY(0)
    if (_v1.lengthSq() < 1e-6) _v1.set(0, 0, -1)
    _v1.normalize()
    const as = Math.sqrt(this.tpl.animScale)
    this.deadVel.copy(_v1).multiplyScalar(2.2).add(_v2.set(0, 2.4, 0)).divideScalar(as)
    this.deadOffset.set(0, 0, 0)
    const side = this.rng() < 0.5 ? -1 : 1
    this.deadRoll = side * (95 + this.rng() * 70) / as
    this.deadPitch = -15 + this.rng() * 30
  }

  /**
   * obj: the enemy Object3D (game-space position/quaternion), vis: visual root (scale, sink), sizeScale: rest scale.
   * Split into small steps so V8 can inline the vector math (fewer boxed doubles); bone rotations are written
   * through raw quaternion math (no Euler resync on every bone write).
   */
  update(dt, obj, vis, sizeScale) {
    if (dt <= 0) return
    this.time += dt
    this.dt = dt
    this.sizeScale = sizeScale
    this.motion(obj, vis)
    this.actions()
    const flying = this.tpl.flying, dead = this.act === ACT_DEAD
    this.stepping = 0
    if (!flying && !dead && this.legs.length) this.gait(obj)
    this.body(obj)
    this.bodyRotation()
    this.rootBone()
    this.bones(obj)
    this.legIK()
  }

  motion(obj, vis) {
    const P = obj.position, Q = obj.quaternion, dt = this.dt
    this._lastQ = Q
    _v1.copy(P).sub(this.lastPos).divideScalar(dt)
    this.lastPos.copy(P)
    _v2.copy(_v1).sub(this.vel).divideScalar(dt)
    this.accel.lerp(_v2, 1 - Math.exp(-6 * dt))
    this.vel.copy(_v1)
    const yaw = this.yawOf(Q)
    this.yawRate += (angDiffDeg(this.lastYaw, yaw) / dt - this.yawRate) * (1 - Math.exp(-8 * dt))
    this.lastYaw = yaw
    // world -> model transform (obj * vis)
    _m.compose(P, Q, _one)
    _mVis.compose(vis.position, vis.quaternion, vis.scale)
    _m.multiply(_mVis)
    _mInv.copy(_m).invert()
    _qInv.copy(Q).invert()
    this.vs = vis.scale.x || 1
    _up.set(0, 1, 0).applyQuaternion(Q); _fwd.set(0, 0, 1).applyQuaternion(Q)
    // flinch springs
    this.flinchPosVel.addScaledVector(this.flinchPos, -90 * dt).addScaledVector(this.flinchPosVel, -13 * dt)
    this.flinchPos.addScaledVector(this.flinchPosVel, dt)
    this.flinchTiltVel.addScaledVector(this.flinchTilt, -110 * dt).addScaledVector(this.flinchTiltVel, -12 * dt)
    this.flinchTilt.addScaledVector(this.flinchTiltVel, dt)
    const pd = this.plateTarget - this.plateOpen
    this.plateOpen = Math.abs(pd) <= dt * 0.8 ? this.plateTarget : this.plateOpen + (pd > 0 ? 1 : -1) * dt * 0.8
  }

  actions() {
    let lunge = 0, pitchAct = 0, armRaise = 0, headPitch = 0, rise = 0
    let mandOpen = 0.12 + 0.08 * Math.sin(this.time * 9 + this.seed)
    this.actT += this.dt
    switch (this.act) {
      case ACT_WINDUP: { const k = smooth(this.actT / this.windupDur); lunge = -0.16 * k; pitchAct = -9 * k; mandOpen += (1 - mandOpen) * k; armRaise = k; headPitch = -8 * k; break }
      case ACT_STRIKE: {
        const k = smooth(this.actT / 0.1)
        lunge = -0.16 + 0.54 * k; pitchAct = -9 + 21 * k; mandOpen = 1 - Math.min(1, k * 1.5); armRaise = 1 - 1.45 * k
        if (this.actT >= 0.1) { this.act = ACT_RECOVER; this.actT = 0 }
        break
      }
      case ACT_RECOVER: {
        const k = smooth(this.actT / 0.3)
        lunge = 0.38 * (1 - k); pitchAct = 12 * (1 - k); mandOpen = mandOpen * k; armRaise = -0.45 * (1 - k)
        if (this.actT >= 0.3) this.act = ACT_NONE
        break
      }
      case ACT_ROAR: {
        const k = Math.sin(clamp01(this.actT / this.roarDur) * Math.PI)
        headPitch = -28 * k; pitchAct = -10 * k; rise = 0.25 * k; mandOpen = 0.2 + k; armRaise = 0.8 * k
        if (this.actT >= this.roarDur) this.act = ACT_NONE
        break
      }
    }
    this.lunge = lunge * this.tpl.animScale; this.pitchAct = pitchAct; this.armRaise = armRaise; this.headPitch = headPitch; this.rise = rise; this.mandOpen = mandOpen
    // planar velocity (world)
    _v3.copy(this.vel).addScaledVector(_up, -this.vel.dot(_up))
    this.speed = _v3.length()
    const g = this.tpl.gait
    this.stepDur = g.baseStepDuration * Math.sqrt(this.tpl.animScale) * clamp(this.tpl.referenceSpeed / Math.max(this.speed, 0.6), 0.55, 1.45)
  }

  gait(obj) {
    const tpl = this.tpl, g = tpl.gait, as = tpl.animScale, dt = this.dt, stepDur = this.stepDur
    const P = obj.position, Q = obj.quaternion
    const legs = this.legs, tl = tpl.legs, nL = legs.length
    let g0 = false, g1 = false
    for (let i = 0; i < nL; i++) if (legs[i].stepping) { if (tl[i].group === 0) g0 = true; else g1 = true }
    const thr = g.stepThreshold * as * (this.speed < 0.15 ? 0.35 : 1)
    const lift = g.stepHeight * as
    for (let i = 0; i < nL; i++) {
      const l = legs[i]
      if (l.stepping) {
        l.t += dt / stepDur
        const s = smooth(l.t)
        l.current.lerpVectors(l.from, l.to, s).addScaledVector(_up, Math.sin(Math.min(l.t, 1) * Math.PI) * lift)
        if (l.t >= 1) {
          l.stepping = false
          l.planted.copy(l.to); l.current.copy(l.to)
          if (this.onFootPlanted) this.onFootPlanted(l.to)
        } else this.stepping++
        continue
      }
      // desired = root . restLocal + planarVel * (stepDur * strideLead)
      _v4.copy(tl[i].restLocal).multiplyScalar(this.sizeScale).applyQuaternion(Q).add(P).addScaledVector(_v3, stepDur * g.strideLead)
      _v5.copy(_v4).sub(l.planted)
      _v5.addScaledVector(_up, -_v5.dot(_up))
      const d = _v5.length()
      const otherBusy = tl[i].group === 0 ? g1 : g0
      if ((d > thr && !otherBusy) || d > thr * 2.5) {
        l.from.copy(l.planted)
        // land where the hip will be when the foot comes down (+ the stride lead), so each tripod gets a real
        // stance phase at full speed (Unity aims at the hip's position at lift-off and the feet never settle)
        _v8.copy(_v4).addScaledVector(_v3, stepDur)
        this.ground(_v8, _up, as, l.to)
        l.t = 0; l.stepping = true
        if (tl[i].group === 0) g0 = true; else g1 = true
      }
      l.current.copy(l.planted)
    }
  }

  body(obj) {
    const tpl = this.tpl, g = tpl.gait, as = tpl.animScale, P = obj.position
    const flying = tpl.flying, dead = this.act === ACT_DEAD
    const legs = this.legs, tl = tpl.legs, nL = legs.length
    let bodyY = 0, pitch = 0, roll = 0
    if (!flying && !dead && nL) {
      let sum = 0, fr = 0, bk = 0, lf = 0, rt = 0, frZ = 0, bkZ = 0, span = 0, nf = 0, nb = 0, nl = 0, nr = 0
      for (let i = 0; i < nL; i++) {
        const c = legs[i].current
        const h = (c.x - P.x) * _up.x + (c.y - P.y) * _up.y + (c.z - P.z) * _up.z
        sum += h
        const rl = tl[i].restLocal
        if (rl.z > 0.05) { fr += h; frZ += rl.z; nf++ } else if (rl.z < -0.05) { bk += h; bkZ += rl.z; nb++ }
        // three: +X is the bug's left side
        if (rl.x > 0) { lf += h; nl++; span += rl.x } else { rt += h; nr++ }
      }
      bodyY = sum / nL * 0.6
      if (nf > 0 && nb > 0) pitch = -Math.atan2(fr / nf - bk / nb, Math.max(0.1, (frZ / nf - bkZ / nb) * this.sizeScale)) / DEG
      if (nl > 0 && nr > 0) roll = Math.atan2(lf / nl - rt / nr, Math.max(0.1, 2 * span / nl * this.sizeScale)) / DEG
      bodyY -= g.bodyBob * as * (this.stepping / nL) * 2
    }
    bodyY += Math.sin(this.time * 2.1 + this.seed) * 0.008 * as
    _v4.copy(this.accel).applyQuaternion(_qInv) // local accel
    const lean = flying ? g.maxLean * 2 : g.maxLean
    pitch += clamp(-_v4.z * g.leanPerAccel * 0.6, -lean, lean)
    roll += clamp(-this.yawRate * g.turnLean * (flying ? 3 : 1) + (flying ? _v4.x * 1.5 : 0), -lean, lean)
    if (flying) bodyY += Math.sin(this.time * 3 + this.seed) * g.hoverBob
    this.bodyY = bodyY; this.pitch = pitch; this.roll = roll
  }

  bodyRotation() {
    const Rl = this.bodyQ.identity(), dt = this.dt
    if (this.act === ACT_DEAD) {
      this.deadT += dt
      this.deadVel.y -= 9.81 * dt
      this.deadOffset.addScaledVector(this.deadVel, dt)
      const floor = -this.tpl.bodyHeight * 0.5 * this.sizeScale
      if (this.deadOffset.y < floor) {
        this.deadOffset.y = floor
        this.deadVel.y = 0
        this.deadVel.multiplyScalar(Math.exp(-10 * dt))
      }
      const k = smooth(this.deadT / 0.55)
      Rl.setFromAxisAngle(Z, this.deadRoll * k * DEG).multiply(_q1.setFromAxisAngle(X, this.deadPitch * k * DEG))
    }
    _v4.copy(this.flinchTilt).applyQuaternion(_qInv)
    const fm = _v4.length()
    if (fm > 1e-3) Rl.multiply(_q1.setFromAxisAngle(_v4.divideScalar(fm), fm * DEG))
    Rl.multiply(_q1.setFromAxisAngle(X, (this.pitch + this.pitchAct) * DEG)).multiply(_q2.setFromAxisAngle(Z, this.roll * DEG))
  }

  rootBone() {
    const tpl = this.tpl, Rl = this.bodyQ
    // offset (world) -> model
    _v5.copy(_up).multiplyScalar(this.bodyY + this.rise * tpl.animScale).addScaledVector(_fwd, this.lunge).addScaledVector(this.flinchPos, 0.12).add(this.deadOffset)
    const len = _v5.length()
    this.offM.copy(_v5).transformDirection(_mInv).multiplyScalar(len / this.vs)
    const pivot = tpl.pivot
    this.bodyT.copy(pivot).sub(_v7.copy(pivot).applyQuaternion(Rl)).add(this.offM)
    const root = tpl.bones.root ? this.b[tpl.bones.root.idx] : null
    if (root) { root.position.copy(this.bodyT); qcopyRaw(root.quaternion, Rl) }
  }

  bones(obj) {
    const tpl = this.tpl, g = tpl.gait, b = this.b, B = tpl.bones, t = this.time, seed = this.seed
    const dead = this.act === ACT_DEAD
    if (B.head) {
      let yawH = 0
      if (this.hasLook && !dead) {
        _v4.copy(this.lookTarget).sub(obj.position).applyQuaternion(_qInv)
        yawH = clamp(Math.atan2(_v4.x, _v4.z) / DEG, -40, 40) * 0.8
      }
      aa2Raw(b[B.head.idx].quaternion, B.head.upP, (yawH + Math.sin(t * 1.3 + seed) * 4) * DEG, B.head.xP, this.headPitch * DEG, B.head.rest.quat)
    }
    if (B.abdomen) {
      const tw = dead ? Math.sin(t * 30) * 6 * clamp01(1.2 - this.deadT) : 0
      aa2Raw(b[B.abdomen.idx].quaternion, B.abdomen.upP, (Math.sin(t * 1.7 + seed) * 3 - this.yawRate * 0.02 + tw) * DEG, B.abdomen.xP, Math.sin(t * 2.3 + seed) * 2.5 * DEG, B.abdomen.rest.quat)
    }
    const mandAngle = (dead ? 0.6 : this.mandOpen) * 30 * DEG
    const md = tpl.mandibles
    for (let i = 0; i < md.length; i++) aaRaw(b[md[i].idx].quaternion, md[i].upP, md[i].side * mandAngle, md[i].rest.quat)
    const arms = tpl.arms, ar = this.armRaise
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i]
      aaRaw(b[arm.upper.idx].quaternion, arm.upper.xP, (-ar * 70 + Math.sin(t * 1.1 + i) * 3) * DEG, arm.upper.rest.quat)
      if (arm.lower) aaRaw(b[arm.lower.idx].quaternion, arm.lower.xP, -ar * 30 * DEG, arm.lower.rest.quat)
    }
    const plates = tpl.plates
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i]
      const flutter = this.plateOpen > 0.5 ? Math.sin(t * 7 + i * 2) * 4 : 0
      aaRaw(b[p.idx].quaternion, p.xP, (this.plateOpen * 75 + flutter) * DEG, p.rest.quat)
    }
    const wings = tpl.wings
    if (wings.length) {
      const amp = dead ? g.wingAmp * clamp01(1 - this.deadT * 1.5) : g.wingAmp
      for (let i = 0; i < wings.length; i++) {
        const w = wings[i]
        aaRaw(b[w.idx].quaternion, w.zP, w.side * Math.sin(t * g.wingFreq * 6.2831853 + i * 0.9) * amp * DEG, w.rest.quat)
      }
    }
  }

  legIK() {
    const tpl = this.tpl, b = this.b, tl = tpl.legs, nL = tl.length, Rl = this.bodyQ, offM = this.offM, pivot = tpl.pivot
    const flying = tpl.flying, dead = this.act === ACT_DEAD, t = this.time, as = tpl.animScale, vs = this.vs
    const curl = dead ? smooth(this.deadT / 0.35) : 0
    _upM.set(0, 1, 0).applyQuaternion(Rl)
    for (let i = 0; i < nL; i++) {
      const L = tl[i], femur = b[L.femur.idx], tibia = b[L.tibia.idx]
      if (flying && !dead) {
        aaRaw(femur.quaternion, L.femur.xP, Math.sin(t * 4 + i) * 8 * DEG, L.femur.rest.quat)
        qcopyRaw(tibia.quaternion, L.tibia.rest.quat)
        continue
      }
      // femur joint after the body transform
      _A.copy(L.fRest).sub(pivot).applyQuaternion(Rl).add(pivot).add(offM)
      // target (model)
      if (!flying) _T.copy(this.legs[i].current).applyMatrix4(_mInv)
      else _T.copy(L.footRest).sub(pivot).applyQuaternion(Rl).add(pivot).add(offM)
      if (dead) {
        _v4.copy(L.restLocal).sub(pivot).multiply(_curlS).applyQuaternion(Rl).add(pivot).add(offM)
        _v4.addScaledVector(_upM, Math.sin(t * 28 + i * 1.7) * 0.05 * as * clamp01(1.5 - this.deadT) / vs)
        if (flying) _T.copy(_v4); else _T.lerp(_v4, curl)
      }
      // knee hint
      _H.copy(L.kRest).sub(pivot).applyQuaternion(Rl).add(pivot).add(offM).addScaledVector(_upM, 0.3 * as / vs)
      this.solveLeg(L, femur, tibia, Rl)
    }
  }

  /** analytic 2-bone IK (femur A -> knee K -> foot E) in model space; raw scalar math (hot: every leg, every frame) */
  solveLeg(L, femur, tibia, Rl) {
    const a = L.a, bl = L.b
    const Ax = _A.x, Ay = _A.y, Az = _A.z
    let dx = _T.x - Ax, dy = _T.y - Ay, dz = _T.z - Az
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist < 1e-5) { _v4.copy(L.footRest).sub(L.fRest).applyQuaternion(Rl); dx = _v4.x; dy = _v4.y; dz = _v4.z; dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1 }
    dx /= dist; dy /= dist; dz /= dist
    const lo = Math.abs(a - bl) + 1e-4, hi = a + bl - 1e-4
    const d = dist < lo ? lo : dist > hi ? hi : dist
    // bend direction: the hint projected off the reach axis
    let px = _H.x - Ax, py = _H.y - Ay, pz = _H.z - Az
    const pd = px * dx + py * dy + pz * dz
    px -= dx * pd; py -= dy * pd; pz -= dz * pd
    let pl = px * px + py * py + pz * pz
    if (pl < 1e-10) { _v4.copy(L.nRest).applyQuaternion(Rl); px = _v4.y * dz - _v4.z * dy; py = _v4.z * dx - _v4.x * dz; pz = _v4.x * dy - _v4.y * dx; pl = px * px + py * py + pz * pz || 1 }
    pl = Math.sqrt(pl); px /= pl; py /= pl; pz /= pl
    const x = (a * a - bl * bl + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, a * a - x * x))
    // knee K = A + dir*x + perp*h ; end E = A + dir*d
    const kx = dx * x + px * h, ky = dy * x + py * h, kz = dz * x + pz * h
    const ex = dx * d - kx, ey = dy * d - ky, ez = dz * d - kz
    _u1.set(kx / a, ky / a, kz / a)
    _w1.set(ex / bl, ey / bl, ez / bl)
    let nx = _u1.y * _w1.z - _u1.z * _w1.y, ny = _u1.z * _w1.x - _u1.x * _w1.z, nz = _u1.x * _w1.y - _u1.y * _w1.x
    let nl = nx * nx + ny * ny + nz * nz
    if (nl < 1e-10) { _v4.copy(L.nRest).applyQuaternion(Rl); nx = _v4.x; ny = _v4.y; nz = _v4.z; nl = 1 }
    nl = Math.sqrt(nl)
    _n1.set(nx / nl, ny / nl, nz / nl)
    // femur model rotation = B(u1, n1) * Kf ; tibia = B(w1, n1) * Kt
    basisQuatRaw(_u1, _n1, _qf); qmulRaw(_qf, _qf, L.Kf)
    basisQuatRaw(_w1, _n1, _qt); qmulRaw(_qt, _qt, L.Kt)
    // local = inverse(parent model) * model ; parent of the femur = coxa (rigid with the body: Rl * coxaRest)
    qmulRaw(_qc, Rl, L.coxaQ)
    qconjMulRaw(femur.quaternion, _qc, _qf)
    qconjMulRaw(tibia.quaternion, _qf, _qt)
  }
}

/** quaternion of the rotation whose columns are (x, y, x cross y) for orthonormal x, y */
function basisQuatRaw(x, y, out) {
  const m11 = x.x, m21 = x.y, m31 = x.z, m12 = y.x, m22 = y.y, m32 = y.z
  const m13 = x.y * y.z - x.z * y.y, m23 = x.z * y.x - x.x * y.z, m33 = x.x * y.y - x.y * y.x
  const tr = m11 + m22 + m33
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0)
    out._w = 0.25 / s; out._x = (m32 - m23) * s; out._y = (m13 - m31) * s; out._z = (m21 - m12) * s
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33)
    out._w = (m32 - m23) / s; out._x = 0.25 * s; out._y = (m12 + m21) / s; out._z = (m13 + m31) / s
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33)
    out._w = (m13 - m31) / s; out._x = (m12 + m21) / s; out._y = 0.25 * s; out._z = (m23 + m32) / s
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22)
    out._w = (m21 - m12) / s; out._x = (m13 + m31) / s; out._y = (m23 + m32) / s; out._z = 0.25 * s
  }
  return out
}
/** q = conj(a) * b (a unit) */
function qconjMulRaw(q, a, b) {
  const ax = -a._x, ay = -a._y, az = -a._z, aw = a._w, bx = b._x, by = b._y, bz = b._z, bw = b._w
  q._x = ax * bw + aw * bx + ay * bz - az * by
  q._y = ay * bw + aw * by + az * bx - ax * bz
  q._z = az * bw + aw * bz + ax * by - ay * bx
  q._w = aw * bw - ax * bx - ay * by - az * bz
}

// ---------------------------------------------------------------- raw quaternion writes (bones only: skip the Euler resync)
function qcopyRaw(q, r) { q._x = r._x; q._y = r._y; q._z = r._z; q._w = r._w }
/** q = a * b */
function qmulRaw(q, a, b) {
  const ax = a._x, ay = a._y, az = a._z, aw = a._w, bx = b._x, by = b._y, bz = b._z, bw = b._w
  q._x = ax * bw + aw * bx + ay * bz - az * by
  q._y = ay * bw + aw * by + az * bx - ax * bz
  q._z = az * bw + aw * bz + ax * by - ay * bx
  q._w = aw * bw - ax * bx - ay * by - az * bz
}
/** q = AxisAngle(axis, ang) * r */
function aaRaw(q, axis, ang, r) {
  const h = ang * 0.5, s = Math.sin(h)
  const ax = axis.x * s, ay = axis.y * s, az = axis.z * s, aw = Math.cos(h)
  const bx = r._x, by = r._y, bz = r._z, bw = r._w
  q._x = ax * bw + aw * bx + ay * bz - az * by
  q._y = ay * bw + aw * by + az * bx - ax * bz
  q._z = az * bw + aw * bz + ax * by - ay * bx
  q._w = aw * bw - ax * bx - ay * by - az * bz
}
/** q = AxisAngle(a1, ang1) * AxisAngle(a2, ang2) * r */
function aa2Raw(q, a1, ang1, a2, ang2, r) { aaRaw(_qTmp, a2, ang2, r); aaRaw(q, a1, ang1, _qTmp) }
const _qTmp = new THREE.Quaternion()
const _upM = new THREE.Vector3(), _curlS = new THREE.Vector3(0.45, 0.35, 0.45)

/** build the per-instance bone array (tpl.names order) from a cloned scene */
export function bindBones(tpl, clone) {
  const byName = new Map()
  clone.traverse(o => { if (o.name && !byName.has(o.name)) byName.set(o.name, o) })
  return tpl.names.map(n => byName.get(n) || null)
}
