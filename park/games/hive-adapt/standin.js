// Hive Adapt (Project 0 port): the procedural stand-in trooper, drawn for players who have no city avatar.
// Dark olive armour plates over a black undersuit, a helmet with a glowing cyan visor, a backpack with cyan status
// lights and an antenna (it reads well from behind, which is how the over-the-shoulder camera sees it).
// One skinned body mesh (vertex colours) + one emissive skinned mesh (visor and lights) on a 19-bone skeleton, built
// from primitives in game metres: 1.8 m tall, origin at the feet, facing +Z. Its RIGHT side is -X.
// player.js animates the bones procedurally (gait, aim twist, two-bone arm IK onto the weapon grips, roll, death).
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const DEG = Math.PI / 180

/** joints: name, parent, model-space position (rest pose: arms hanging, every bone unrotated) */
const JOINTS = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.97, 0]],
  ['spine', 'hips', [0, 1.08, 0]],
  ['chest', 'spine', [0, 1.27, -0.01]],
  ['neck', 'chest', [0, 1.5, 0]],
  ['head', 'neck', [0, 1.58, 0.01]],
  ['upperArmL', 'chest', [0.205, 1.43, -0.01]],
  ['foreArmL', 'upperArmL', [0.205, 1.14, -0.01]],
  ['handL', 'foreArmL', [0.205, 0.87, -0.01]],
  ['upperArmR', 'chest', [-0.205, 1.43, -0.01]],
  ['foreArmR', 'upperArmR', [-0.205, 1.14, -0.01]],
  ['handR', 'foreArmR', [-0.205, 0.87, -0.01]],
  ['thighL', 'hips', [0.098, 0.93, 0]],
  ['shinL', 'thighL', [0.098, 0.51, 0]],
  ['footL', 'shinL', [0.098, 0.09, 0]],
  ['thighR', 'hips', [-0.098, 0.93, 0]],
  ['shinR', 'thighR', [-0.098, 0.51, 0]],
  ['footR', 'shinR', [-0.098, 0.09, 0]],
]
export const ARM = { upper: 0.29, fore: 0.27 }
export const LEG = 0.84
export { JOINTS }

// colours (sRGB authored): olive plates, darker olive, undersuit, gunmetal trim, webbing, boots
const C = {
  plate: [0.21, 0.25, 0.155], plateLite: [0.27, 0.31, 0.2], plateDark: [0.135, 0.16, 0.1], suit: [0.07, 0.075, 0.08],
  trim: [0.15, 0.155, 0.165], strap: [0.13, 0.12, 0.09], pouch: [0.28, 0.29, 0.2], boot: [0.065, 0.06, 0.055], metal: [0.45, 0.46, 0.48],
}

/**
 * opts.joints: { name: [x, y, z] } overrides (model space) to re-proportion the rig to another fighter's body;
 * opts.meshless: build only the skeleton (it then drives a fighter model through fighter.js and is never drawn).
 */
export function buildStandIn(opts = {}) {
  if (opts.meshless) return buildRig(opts.joints || {})
  const boneIndex = {}
  JOINTS.forEach((j, i) => { boneIndex[j[0]] = i })
  const body = [], glow = []
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3()
  const _c = new THREE.Color()

  /** one primitive, transformed into model space, coloured and rigidly skinned to one bone */
  function part(list, geo, bone, colour, pos, rot = [0, 0, 0], scl = [1, 1, 1]) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone()
    geo.dispose()
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    _e.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e), _s.set(scl[0], scl[1], scl[2]))
    g.applyMatrix4(_m)
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4)
    _c.setRGB(colour[0], colour[1], colour[2], THREE.SRGBColorSpace)
    const b = boneIndex[bone]
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b
      si[i * 4] = b; sw[i * 4] = 1
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
    list.push(g)
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const rbox = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))
  const cap = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 2, seg)
  const cyl = (r0, r1, h, seg = 10) => new THREE.CylinderGeometry(r0, r1, h, seg)
  const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs)

  // ---------------------------------------------------------------- legs
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R', x = 0.098 * s
    part(body, cap(0.086, 0.3), 'thigh' + side, C.suit, [x, 0.72, 0])
    part(body, rbox(0.05, 0.25, 0.15, 0.018), 'thigh' + side, C.plate, [x + s * 0.075, 0.74, 0])
    part(body, rbox(0.13, 0.21, 0.045, 0.016), 'thigh' + side, C.plateDark, [x, 0.75, 0.075], [-4, 0, 0])
    part(body, rbox(0.13, 0.2, 0.045, 0.016), 'thigh' + side, C.plateDark, [x, 0.76, -0.075], [5, 0, 0])
    part(body, box(0.185, 0.03, 0.185), 'thigh' + side, C.strap, [x, 0.66, 0])
    if (s < 0) part(body, rbox(0.065, 0.16, 0.13, 0.014), 'thigh' + side, C.pouch, [x - 0.115, 0.8, -0.01]) // right-leg holster
    part(body, rbox(0.125, 0.12, 0.08, 0.028), 'shin' + side, C.plateLite, [x, 0.51, 0.072])
    part(body, cap(0.07, 0.3), 'shin' + side, C.suit, [x, 0.3, -0.005])
    part(body, rbox(0.11, 0.28, 0.055, 0.016), 'shin' + side, C.plate, [x, 0.3, 0.062], [3, 0, 0])
    part(body, rbox(0.105, 0.22, 0.05, 0.016), 'shin' + side, C.plateDark, [x, 0.33, -0.06], [-4, 0, 0])
    part(body, rbox(0.135, 0.14, 0.29, 0.032), 'foot' + side, C.boot, [x, 0.075, 0.035])
    part(body, box(0.14, 0.03, 0.3), 'foot' + side, C.trim, [x, 0.015, 0.035])
  }
  // ---------------------------------------------------------------- pelvis + abdomen
  part(body, rbox(0.33, 0.17, 0.21, 0.04), 'hips', C.suit, [0, 0.93, 0])
  part(body, box(0.355, 0.055, 0.235), 'hips', C.strap, [0, 0.995, 0])
  part(body, box(0.05, 0.05, 0.02), 'hips', C.metal, [0, 0.995, 0.12])
  for (const x of [-0.1, 0, 0.1]) part(body, rbox(0.085, 0.085, 0.055, 0.012), 'hips', C.pouch, [x, 0.965, -0.135])
  part(body, rbox(0.15, 0.13, 0.035, 0.012), 'hips', C.plate, [0, 0.9, 0.112], [-6, 0, 0])
  part(body, rbox(0.24, 0.13, 0.035, 0.012), 'hips', C.plateDark, [0, 0.89, -0.118], [6, 0, 0])
  part(body, rbox(0.29, 0.2, 0.19, 0.05), 'spine', C.suit, [0, 1.12, 0])
  part(body, rbox(0.21, 0.15, 0.035, 0.012), 'spine', C.plateDark, [0, 1.13, 0.1])
  // ---------------------------------------------------------------- chest, backpack
  part(body, rbox(0.38, 0.3, 0.25, 0.06), 'chest', C.plate, [0, 1.33, 0])
  part(body, rbox(0.34, 0.22, 0.05, 0.02), 'chest', C.plateLite, [0, 1.345, 0.125], [-5, 0, 0])
  part(body, box(0.05, 0.12, 0.03), 'chest', C.pouch, [0.09, 1.3, 0.155])
  part(body, box(0.05, 0.12, 0.03), 'chest', C.pouch, [-0.09, 1.3, 0.155])
  part(body, rbox(0.34, 0.27, 0.04, 0.015), 'chest', C.plateDark, [0, 1.34, -0.13])
  part(body, rbox(0.3, 0.34, 0.15, 0.035), 'chest', C.plateDark, [0, 1.3, -0.215])
  part(body, rbox(0.315, 0.06, 0.165, 0.02), 'chest', C.trim, [0, 1.48, -0.215])
  part(body, box(0.26, 0.025, 0.02), 'chest', C.strap, [0, 1.2, -0.293])
  for (const s of [1, -1]) {
    part(body, cyl(0.036, 0.036, 0.27), 'chest', C.trim, [s * 0.172, 1.28, -0.225])
    part(body, cyl(0.038, 0.038, 0.02), 'chest', C.metal, [s * 0.172, 1.42, -0.225])
    part(body, box(0.035, 0.32, 0.03), 'chest', C.strap, [s * 0.11, 1.33, 0.13], [-6, 0, 0])
  }
  part(body, cyl(0.006, 0.006, 0.36, 5), 'chest', C.trim, [0.12, 1.66, -0.26])
  part(body, cyl(0.015, 0.02, 0.05, 6), 'chest', C.metal, [0.12, 1.5, -0.26])
  part(glow, sph(0.016, 8, 6), 'chest', [1, 1, 1], [0.12, 1.845, -0.26])
  part(glow, box(0.18, 0.018, 0.01), 'chest', [1, 1, 1], [0, 1.39, -0.292])
  part(glow, box(0.014, 0.1, 0.01), 'chest', [1, 1, 1], [0.1, 1.27, -0.292])
  part(glow, box(0.014, 0.1, 0.01), 'chest', [1, 1, 1], [-0.1, 1.27, -0.292])
  part(body, cyl(0.1, 0.12, 0.07, 12), 'chest', C.trim, [0, 1.49, -0.005])
  // ---------------------------------------------------------------- head
  part(body, cyl(0.055, 0.06, 0.12, 8), 'neck', C.suit, [0, 1.54, 0])
  part(body, sph(0.128, 16, 12), 'head', C.plate, [0, 1.655, -0.01], [0, 0, 0], [1, 0.98, 1.12])
  part(body, rbox(0.17, 0.095, 0.09, 0.03), 'head', C.trim, [0, 1.57, 0.085])
  part(body, rbox(0.25, 0.03, 0.06, 0.012), 'head', C.plateDark, [0, 1.7, 0.1], [-12, 0, 0])
  part(body, rbox(0.035, 0.05, 0.2, 0.012), 'head', C.plateDark, [0, 1.775, -0.04])
  for (const s of [1, -1]) part(body, cyl(0.04, 0.04, 0.035, 10), 'head', C.trim, [s * 0.128, 1.63, -0.005], [0, 0, 90])
  part(glow, new THREE.CylinderGeometry(0.131, 0.131, 0.042, 16, 1, true, -78 * DEG, 156 * DEG), 'head', [1, 1, 1], [0, 1.64, -0.01], [0, 0, 0], [1, 1, 1.13])
  part(glow, sph(0.012, 6, 4), 'head', [1, 1, 1], [-0.148, 1.63, -0.005])
  // ---------------------------------------------------------------- arms
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R', x = 0.205 * s
    part(body, sph(0.098, 12, 8), 'upperArm' + side, C.plate, [x + s * 0.012, 1.45, -0.01], [0, 0, -s * 12], [1.02, 0.7, 1.1])
    part(body, rbox(0.11, 0.045, 0.18, 0.015), 'upperArm' + side, C.plateDark, [x + s * 0.045, 1.4, -0.01], [0, 0, -s * 24])
    part(body, cap(0.056, 0.18), 'upperArm' + side, C.suit, [x, 1.29, -0.01])
    part(body, rbox(0.07, 0.13, 0.09, 0.02), 'upperArm' + side, C.plate, [x + s * 0.03, 1.3, -0.01])
    part(body, sph(0.052, 10, 6), 'foreArm' + side, C.plateLite, [x, 1.145, -0.035])
    part(body, cap(0.049, 0.17), 'foreArm' + side, C.suit, [x, 1.01, -0.01])
    part(body, rbox(0.088, 0.15, 0.092, 0.022), 'foreArm' + side, C.plateDark, [x, 0.985, -0.01])
    part(body, rbox(0.065, 0.1, 0.085, 0.022), 'hand' + side, C.boot, [x, 0.81, 0.005])
  }

  const bodyGeo = mergeGeometries(body)
  const glowGeo = mergeGeometries(glow)
  for (const g of body.concat(glow)) g.dispose()
  bodyGeo.computeBoundingSphere()
  glowGeo.computeBoundingSphere()

  // ---------------------------------------------------------------- skeleton
  const { bones, list } = skeletonOf({})
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.25, envMapIntensity: 0.9 })
  bodyMat.name = 'StandIn_Armour'
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.5, 2.1) })
  glowMat.name = 'StandIn_Visor'
  const mesh = new THREE.SkinnedMesh(bodyGeo, bodyMat)
  mesh.name = 'StandIn_Body'
  mesh.add(bones.root)
  const skeleton = new THREE.Skeleton(list)
  mesh.bind(skeleton)
  const lights = new THREE.SkinnedMesh(glowGeo, glowMat)
  lights.name = 'StandIn_Visor'
  lights.bind(skeleton, mesh.bindMatrix)
  for (const m of [mesh, lights]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true }
  lights.castShadow = false
  const object = new THREE.Group()
  object.name = 'StandInTrooper'
  object.add(mesh, lights)
  /** rest local positions, so the animator can restore them */
  const rest = {}
  for (const b of list) rest[b.name] = b.position.clone()
  return { object, mesh, lights, bones, rest, skeleton, glowMat, bodyMat, height: 1.8, arm: { ...ARM }, leg: LEG }
}

/** the 19-bone rig, every bone unrotated at rest (arms hang along -Y), joints at JOINTS or the overrides */
function skeletonOf(over) {
  const bones = {}, list = []
  const posOf = name => over[name] || JOINTS.find(j => j[0] === name)[2]
  for (const [name, parent] of JOINTS) {
    const p = posOf(name)
    const b = new THREE.Bone()
    b.name = name
    const pp = parent ? posOf(parent) : [0, 0, 0]
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2])
    b.rotation.order = 'YXZ'
    bones[name] = b
    list.push(b)
    if (parent) bones[parent].add(b)
  }
  return { bones, list }
}

/** skeleton-only rig for driving another model: same API as the stand-in (bones, rest, arm, leg), nothing drawn */
function buildRig(over) {
  const { bones, list } = skeletonOf(over)
  const object = new THREE.Group()
  object.name = 'FighterRig'
  object.add(bones.root)
  const rest = {}
  for (const b of list) rest[b.name] = b.position.clone()
  const P = n => over[n] || JOINTS.find(j => j[0] === n)[2]
  const dist = (a, b) => Math.hypot(P(a)[0] - P(b)[0], P(a)[1] - P(b)[1], P(a)[2] - P(b)[2])
  const arm = { upper: dist('upperArmR', 'foreArmR'), fore: dist('foreArmR', 'handR') }
  const leg = dist('thighR', 'shinR') + dist('shinR', 'footR')
  const dummy = { geometry: { dispose() {} } }
  return { object, mesh: dummy, lights: dummy, bones, rest, skeleton: new THREE.Skeleton(list), rig: true, arm, leg, height: P('head')[1] + 0.15 }
}
