// Hive Adapt: fighters. Any humanoid GLB (the Foxfire Ronin, the Guard, or a player's own fighter entity) is driven by
// the procedural trooper rig from standin.js (gait, aim twist, two-bone arm IK onto the gun grips, roll, death).
// prepareFighter() finds the body bones by name (Blender/rigify, Mixamo, VRM, Unity humanoid, or an explicit map),
// scales the model to a 0.97 m hip height with the feet on the ground, and measures its joints so the rig can be rebuilt
// with the same proportions (arm lengths matter: the IK puts the hands on the grips). Every frame retarget.apply() gives
// each mapped bone the rig bone's change of rotation, then swings arms and legs so they point where the rig's point.
// Bones that are not mapped (fingers, ears, tails, clavicles) keep their rest pose relative to their parents.
import * as THREE from 'three'

export const ROLES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
const CHILD = { upperArmL: 'foreArmL', foreArmL: 'handL', upperArmR: 'foreArmR', foreArmR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR' }
const HIP_HEIGHT = 0.97

// base names (lower case, letters and digits only, side words removed) -> role
const BASE = {
  hips: 'hips', hip: 'hips', pelvis: 'hips',
  neck: 'neck', neck1: 'neck', head: 'head',
  upperarm: 'upperArm', arm: 'upperArm', uparm: 'upperArm',
  forearm: 'foreArm', lowerarm: 'foreArm', elbow: 'foreArm',
  hand: 'hand', wrist: 'hand',
  thigh: 'thigh', upperleg: 'thigh', upleg: 'thigh',
  shin: 'shin', calf: 'shin', lowerleg: 'shin', leg: 'shin', knee: 'shin',
  foot: 'foot', ankle: 'foot',
}
function sideOf(name) {
  const n = name.replace(/([a-z])([A-Z])/g, '$1 $2')
  if (/left/i.test(n) || /(^|[^a-z])l([^a-z]|$)/i.test(n)) return 'L'
  if (/right/i.test(n) || /(^|[^a-z])r([^a-z]|$)/i.test(n)) return 'R'
  if (/[a-z]L$/.test(name)) return 'L'
  if (/[a-z]R$/.test(name)) return 'R'
  return ''
}
function baseOf(name) {
  let n = name.replace(/mixamorig\d*:?/i, '').replace(/^(def|org|bip0*1|j_bip_[clr]_|armature)[_.:\- ]*/i, '')
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2')
  n = n.replace(/\b(left|right)\b/ig, ' ').replace(/(^|[._\- ])[lr](?=([._\- ]|$))/ig, ' ')
  n = n.toLowerCase().replace(/[^a-z0-9]/g, '')
  n = n.replace(/^(left|right)/, '').replace(/(left|right)$/, '')
  if (/^(l|r)(upperarm|forearm|lowerarm|hand|thigh|shin|calf|foot|upperleg|lowerleg)$/.test(n)) n = n.slice(1)
  if (/^(upperarm|forearm|lowerarm|hand|thigh|shin|calf|foot|upperleg|lowerleg|arm|leg|upleg)(l|r)$/.test(n)) n = n.slice(0, -1)
  return n
}

/** role -> Bone, from an explicit { role: boneName } map or by name, with the spine found structurally */
export function findBones(scene, map) {
  const all = []
  scene.traverse(o => { if (o.isBone || o.type === 'Bone') all.push(o) })
  const byName = new Map(all.map(b => [b.name, b]))
  const out = {}
  if (map && typeof map === 'object') {
    for (const r of ROLES) if (typeof map[r] === 'string' && byName.has(map[r])) out[r] = byName.get(map[r])
  }
  for (const b of all) {
    const role0 = BASE[baseOf(b.name)]
    if (!role0) continue
    const sided = ['upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot'].includes(role0)
    const side = sideOf(b.name)
    if (sided && !side) continue
    const role = sided ? role0 + side : role0
    if (!out[role]) out[role] = b
  }
  // chest = the bone the neck (or else both upper arms) hang from; spine = the bone between the hips and the chest
  const up = (b, n) => { while (b && n-- > 0) b = b.parent; return b }
  if (!out.chest) {
    if (out.neck && out.neck.parent && out.neck.parent.isBone) out.chest = out.neck.parent
    else if (out.upperArmL) { let p = out.upperArmL.parent; if (p && /shoulder|clavicle|collar/i.test(p.name)) p = p.parent; if (p && p.isBone) out.chest = p }
  }
  if (!out.spine && out.chest && out.hips) {
    let b = out.chest
    while (b.parent && b.parent !== out.hips && b.parent.isBone) b = b.parent
    out.spine = b.parent === out.hips && b !== out.chest ? b : null
  }
  if (!out.spine) delete out.spine
  void up
  return out
}

/**
 * Normalise and measure a loaded humanoid (gltf.scene, facing +Z). Returns { wrap, scene, bones, joints, scale, height }
 * or throws when the body bones are missing. joints are the rig overrides for buildStandIn({ meshless, joints }).
 */
export function prepareFighter(scene, map) {
  scene.updateMatrixWorld(true)
  const bones = findBones(scene, map)
  const need = ['hips', 'chest', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
  const missing = need.filter(r => !bones[r])
  if (missing.length) throw new Error('fighter bones missing: ' + missing.join(', '))
  const box = new THREE.Box3().setFromObject(scene)
  const wp = b => b.getWorldPosition(new THREE.Vector3())
  const hipH = wp(bones.hips).y - box.min.y
  const H = box.max.y - box.min.y
  if (!(hipH > 0.05) || !(H > 0.1)) throw new Error('fighter has no height')
  let s = HIP_HEIGHT / hipH
  s = Math.min(Math.max(s, 1.45 / H), 2.4 / H)
  const wrap = new THREE.Group()
  wrap.name = 'Fighter'
  scene.scale.multiplyScalar(s)
  scene.position.multiplyScalar(s)
  scene.position.y -= box.min.y * s
  wrap.add(scene)
  wrap.updateMatrixWorld(true)
  scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false } })
  // joints in model space (feet at 0, +Z forward); the rig hangs arms and legs straight down with the model's lengths
  const P = r => (bones[r] ? wp(bones[r]) : null)
  const j = {}
  const hips = P('hips'), chest = P('chest'), head = P('head')
  const spine = P('spine') || hips.clone().lerp(chest, 0.45)
  const neck = P('neck') || chest.clone().lerp(head, 0.6)
  j.hips = [0, hips.y, hips.z]
  j.spine = [0, Math.max(spine.y, hips.y + 0.04), spine.z]
  j.chest = [0, Math.max(chest.y, j.spine[1] + 0.04), chest.z]
  j.neck = [0, Math.max(neck.y, j.chest[1] + 0.04), neck.z]
  j.head = [0, Math.max(head.y, j.neck[1] + 0.04), head.z]
  for (const sd of ['L', 'R']) {
    const sh = P('upperArm' + sd), el = P('foreArm' + sd), wr = P('hand' + sd)
    const up = Math.max(0.12, sh.distanceTo(el)), fo = Math.max(0.12, el.distanceTo(wr))
    const sx = sd === 'L' ? Math.abs(sh.x) : -Math.abs(sh.x)
    j['upperArm' + sd] = [sx, sh.y, sh.z]
    j['foreArm' + sd] = [sx, sh.y - up, sh.z]
    j['hand' + sd] = [sx, sh.y - up - fo, sh.z]
    const th = P('thigh' + sd), kn = P('shin' + sd), an = P('foot' + sd)
    const tl = Math.max(0.15, th.distanceTo(kn)), sl = Math.max(0.15, kn.distanceTo(an))
    const lx = sd === 'L' ? Math.abs(th.x) : -Math.abs(th.x)
    j['thigh' + sd] = [lx, th.y, th.z]
    j['shin' + sd] = [lx, th.y - tl, th.z]
    j['foot' + sd] = [lx, Math.max(0.03, th.y - tl - sl), th.z]
  }
  const shoulder = Math.abs(j.upperArmR[0])
  // upper-body half width (bind pose vertices between the hips and the head): bulky fighters push the camera out
  let halfWidth = shoulder + 0.1
  const _v = new THREE.Vector3()
  scene.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry || !o.geometry.attributes.position) return
    const pa = o.geometry.attributes.position
    for (let i = 0; i < pa.count; i += 5) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld)
      if (_v.y > j.hips[1] && _v.y < j.head[1] && Math.abs(_v.z) < 0.45) halfWidth = Math.max(halfWidth, Math.abs(_v.x))
    }
  })
  // tail chains (fox tails, capes...): a little sway so they are not frozen
  const tails = []
  scene.traverse(o => { if ((o.isBone || o.type === 'Bone') && /tail/i.test(o.name || '')) tails.push(o) })
  tails.sort((a, b) => depthOf(a) - depthOf(b))
  return { wrap, scene, bones, joints: j, scale: s, height: (box.max.y - box.min.y) * s, shoulder, halfWidth: Math.min(halfWidth, 1), tails }
}
function depthOf(o) { let d = 0; while (o.parent) { o = o.parent; d++ } return d
}

/**
 * Bind a prepared fighter to a rig built from its joints (both children of the same parent, the player's offset group).
 * apply() after the rig is posed (procedural animation + arm IK) copies the pose onto the fighter.
 */
export function createRetarget(fighter, rig, space) {
  const T = fighter.bones, D = rig.bones
  const roles = ROLES.filter(r => T[r] && D[r])
  const _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion()
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3()
  const _mi = new THREE.Matrix4()
  const spaceQ = () => space.getWorldQuaternion(_qs).invert()
  // rest: model-space rotations and positions of both skeletons (taken now, before anything is posed)
  space.updateMatrixWorld(true)
  const sq = spaceQ()
  const rest = {}
  for (const r of roles) {
    const t = T[r], d = D[r]
    const tq = t.getWorldQuaternion(new THREE.Quaternion()).premultiply(sq)
    const dq = d.getWorldQuaternion(new THREE.Quaternion()).premultiply(sq)
    _mi.copy(space.matrixWorld).invert()
    const tp = t.getWorldPosition(new THREE.Vector3()).applyMatrix4(_mi)
    const dp = d.getWorldPosition(new THREE.Vector3()).applyMatrix4(_mi)
    let dir = null
    if (CHILD[r] && T[CHILD[r]]) dir = T[CHILD[r]].getWorldPosition(new THREE.Vector3()).applyMatrix4(_mi).sub(tp).normalize()
    rest[r] = { tq, dqInv: dq.clone().invert(), tp, dp, dir, local: t.quaternion.clone(), localPos: t.position.clone() }
  }
  function applyBody() {
    space.updateMatrixWorld(true)
    _mi.copy(space.matrixWorld).invert()
    const sqi = spaceQ()
    for (const r of roles) {
      const t = T[r], d = D[r], R = rest[r]
      // the rig bone's change of rotation since rest (model space), applied to the fighter bone's rest rotation
      d.getWorldQuaternion(_qd).premultiply(sqi)
      _qd.multiply(R.dqInv)
      _q.copy(_qd).multiply(R.tq)
      if (R.dir) {
        // swing the limb onto the rig limb's direction (the rest poses can differ: T-pose, A-pose, hanging)
        _a.copy(R.dir).applyQuaternion(_qd)
        D[CHILD[r]].getWorldPosition(_b).applyMatrix4(_mi)
        d.getWorldPosition(_c).applyMatrix4(_mi)
        _b.sub(_c)
        if (_b.lengthSq() > 1e-10) { _b.normalize(); _qp.setFromUnitVectors(_a, _b); _q.premultiply(_qp) }
      }
      if (r === 'hips') {
        d.getWorldPosition(_p).applyMatrix4(_mi).sub(R.dp).add(R.tp)
        space.localToWorld(_p)
        t.parent.worldToLocal(_p)
        t.position.copy(_p)
      }
      t.parent.getWorldQuaternion(_qp).premultiply(sqi)
      t.quaternion.copy(_qp.invert().multiply(_q))
      t.updateMatrixWorld(true)
    }
  }
  // tail sway: each tail bone turns a little about the body's up axis (and lifts when running), down the chain
  const tails = (fighter.tails || []).map((b, i) => ({ b, i, local: b.quaternion.clone() }))
  const _up = new THREE.Vector3(), _side = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion()
  function sway(t, move, sprint) {
    if (!tails.length) return
    space.getWorldQuaternion(_qs)
    _up.set(0, 1, 0).applyQuaternion(_qs)
    _side.set(1, 0, 0).applyQuaternion(_qs)
    for (const k of tails) {
      const b = k.b
      b.quaternion.copy(k.local)
      b.parent.updateWorldMatrix(true, false)
      b.parent.getWorldQuaternion(_qp)
      _q.copy(_qp).multiply(k.local)
      const yaw = (0.1 + 0.12 * move) * Math.sin(t * (2.2 + 3 * move) - k.i * 0.7)
      const lift = -(0.05 * move + 0.08 * sprint) + 0.03 * Math.sin(t * 1.3 - k.i * 0.5)
      _qa.setFromAxisAngle(_up, yaw)
      _qb.setFromAxisAngle(_side, lift)
      _q.premultiply(_qa).premultiply(_qb)
      b.quaternion.copy(_qp.invert().multiply(_q))
      b.updateMatrixWorld(true)
    }
  }
  function reset() { for (const r of roles) { T[r].quaternion.copy(rest[r].local); T[r].position.copy(rest[r].localPos) } }
  return { apply: (t = 0, move = 0, sprint = 0) => { applyBody(); sway(t, move, sprint) }, reset, roles }
}
