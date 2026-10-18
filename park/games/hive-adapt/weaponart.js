// Hive Adapt (Project 0 port): weapon art that has no GLB. The AR-7 (a third-party Rifle.FBX in Unity, scaled to
// 0.92 m) is built here from boxes and cylinders with the W_* weapon library materials, with the same node layout as
// the other weapon GLBs: Muzzle, Grip_R, Grip_L, Eject and a separate Mag. Faces +Z, top +Y, its RIGHT side is -X.
// Also the radial glow texture the projectiles use: a DataTexture, no canvas needed.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const DEG = Math.PI / 180

/** box-mapped UVs in metres (1 UV = 0.25 m, as the Unity weapon meshes) */
function boxUV(geo, size = 0.25) {
  const p = geo.attributes.position, n = geo.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    let u, v
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i) } else if (ay >= az) { u = p.getX(i); v = p.getZ(i) } else { u = p.getX(i); v = p.getY(i) }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

export function buildAR7(A) {
  const lists = {}
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler()
  function add(mat, geo, pos, rot = [0, 0, 0], list = lists) {
    const g = geo.index ? geo.toNonIndexed() : geo
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    _m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)), new THREE.Vector3(1, 1, 1))
    g.applyMatrix4(_m)
    boxUV(g)
    ;(list[mat] = list[mat] || []).push(g)
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const tube = (r0, r1, len, seg = 10) => new THREE.CylinderGeometry(r0, r1, len, seg)
  const Z = [90, 0, 0] // cylinders along +Z

  // metal: upper receiver, barrel, brake, gas block, charging handle, forward assist, bolt cover
  add('M_GunMetal', box(0.05, 0.055, 0.3), [0, 0.012, -0.02])
  add('M_GunMetal', box(0.052, 0.012, 0.3), [0, -0.012, -0.02])
  add('M_GunMetal', tube(0.0115, 0.0115, 0.17), [0, 0, 0.435], Z)
  add('M_GunMetal', tube(0.019, 0.019, 0.052, 8), [0, 0, 0.534], Z)
  add('M_GunMetal', tube(0.013, 0.013, 0.012, 8), [0, 0, 0.562], Z)
  add('M_GunMetal', box(0.03, 0.036, 0.03), [0, 0.006, 0.415])
  add('M_GunMetal', box(0.034, 0.012, 0.03), [0, 0.044, -0.165])
  add('M_GunMetal', tube(0.008, 0.008, 0.03, 8), [-0.03, 0.02, -0.11], [0, 0, 90])
  // worn steel: top rail with teeth, ejection port cover, sight post, trigger
  add('W_Worn', box(0.024, 0.01, 0.42), [0, 0.045, 0.07])
  for (let k = 0; k < 16; k++) add('W_Worn', box(0.026, 0.006, 0.012), [0, 0.052, -0.13 + k * 0.026])
  add('W_Worn', box(0.004, 0.024, 0.07), [-0.0265, 0.014, -0.005])
  add('W_Worn', box(0.012, 0.05, 0.012), [0, 0.07, 0.385])
  add('W_Worn', box(0.006, 0.026, 0.008), [0, -0.062, -0.04], [12, 0, 0])
  add('W_Worn', box(0.008, 0.008, 0.07), [0, -0.08, -0.045])
  // polymer: lower, mag well, raked pistol grip, buffer tube, stock + cheek riser, optic
  add('W_Polymer', box(0.046, 0.05, 0.22), [0, -0.035, -0.04])
  add('W_Polymer', box(0.044, 0.05, 0.08), [0, -0.07, 0.03])
  add('W_Polymer', box(0.034, 0.105, 0.046), [0, -0.105, -0.1], [18, 0, 0])
  add('W_Polymer', tube(0.016, 0.016, 0.11, 10), [0, 0.0, -0.18], Z)
  add('W_Polymer', box(0.042, 0.078, 0.17), [0, -0.024, -0.272])
  add('W_Polymer', box(0.036, 0.022, 0.13), [0, 0.024, -0.272])
  add('W_Polymer', box(0.036, 0.042, 0.088), [0, 0.083, -0.03])
  add('W_Polymer', box(0.028, 0.02, 0.05), [0, 0.06, -0.03])
  add('W_Polymer', tube(0.021, 0.021, 0.012, 12), [0, 0.085, 0.018], Z)
  // rubber butt pad
  add('W_Rubber', box(0.045, 0.084, 0.014), [0, -0.024, -0.36])
  // OD green octagonal handguard with a lower rail, vents as dark inserts
  add('W_OD', tube(0.03, 0.03, 0.27, 8), [0, 0.004, 0.265], [90, 22.5, 0])
  add('W_OD', box(0.02, 0.012, 0.25), [0, -0.03, 0.265])
  for (let k = 0; k < 4; k++) for (const s of [1, -1]) add('W_Polymer', box(0.004, 0.012, 0.035), [s * 0.0285, 0.006, 0.18 + k * 0.055])
  // optic glass and the amber dot (seen from behind the shooter)
  add('M_Glass', box(0.026, 0.026, 0.003), [0, 0.085, 0.013])
  add('M_EmissiveAmber', box(0.004, 0.004, 0.002), [0, 0.086, -0.075])
  const mag = {}
  add('W_Polymer', box(0.026, 0.1, 0.064), [0, -0.135, 0.035], [8, 0, 0], mag)
  add('W_Polymer', box(0.026, 0.075, 0.062), [0, -0.215, 0.052], [20, 0, 0], mag)
  add('W_Worn', box(0.028, 0.012, 0.066), [0, -0.255, 0.064], [20, 0, 0], mag)

  const root = new THREE.Group()
  root.name = 'AR7_Root'
  const body = new THREE.Group()
  body.name = 'AR7_Body'
  root.add(body)
  for (const [mat, list] of Object.entries(lists)) {
    const m = new THREE.Mesh(mergeGeometries(list), A.mat(mat))
    m.name = 'AR7_' + mat
    m.castShadow = true; m.receiveShadow = true
    body.add(m)
    list.forEach(g => g.dispose())
  }
  const magNode = new THREE.Group()
  magNode.name = 'Mag'
  for (const [mat, list] of Object.entries(mag)) {
    const m = new THREE.Mesh(mergeGeometries(list), A.mat(mat))
    m.castShadow = true
    magNode.add(m)
    list.forEach(g => g.dispose())
  }
  root.add(magNode)
  const node = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); root.add(o); return o }
  node('Muzzle', 0, 0, 0.568)
  node('Grip_R', 0, -0.088, -0.098)
  node('Grip_L', 0, -0.022, 0.27)
  node('Eject', -0.03, 0.014, -0.005)
  return root
}

/** a soft radial glow (white, alpha falls off), size px */
export function glowTexture(size = 64, power = 2.2) {
  const d = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1
    const r = Math.min(1, Math.hypot(dx, dy))
    const a = Math.pow(1 - r, power)
    const i = (y * size + x) * 4
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = Math.round(a * 255)
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
