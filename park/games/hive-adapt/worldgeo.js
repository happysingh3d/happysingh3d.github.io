// Hive Adapt (Project 0 port): outpost geometry (HiveBuilder.Outpost.cs / Defence.cs / BaseLook.cs, ported).
// Everything here is computed in UNITY space (left-handed numbers, Compass(yaw) = (sin, 0, cos)) exactly like the builder,
// then MeshBuf.geometries() mirrors it into game space (z negated, winding reversed) or into a game-local frame (x negated).
import * as THREE from 'three'
import { perlin, clamp01, smooth01, DEG, rng } from './u.js'

// ------------------------------------------------------------------ layout constants (Unity metres / degrees)
export const K = {
  H: 7, LIP: 22, CLIFF: 68,
  WALL_R: 17.5, WALL_HT: 1.2, WALL_TOP: 9.8, PAR_H: 1.1, PAR_T: 0.4,
  RAMP_W: 7, RAMP_WALL: 0.5, RAMP_PAR: 0.9, CAUSE0: 19.6,
  GATE_HW: 4.3, BREACH_HW: 2.1, BASTION: 4.5, PLINTH_H: 0.5, PLINTH: 2.2, GATE_SHIFT: 0.9,
  RAMPS: [-40, 48], BREACHES: [-105, 112], SPAWNS: [-40, 48, -112, 120], STAIRS: [4, 135, 180],
  SPAWN_R: 88, CORE_PAD_R: 5.6, WATCH_DECK: 3, WATCH_SIZE: 4.4,
}
K.RAMP_TAN = Math.tan(19 * DEG)
K.RAMP_TOP = K.LIP + 0.3
K.RAMP_LEN = (K.H + 0.03) / K.RAMP_TAN
K.RAMP_FOOT = K.RAMP_TOP + K.RAMP_LEN
K.GATE_HALF_DEG = Math.asin(K.GATE_HW / K.WALL_R) / DEG
K.WATCH = [
  { id: 'Tower0', bearing: -120, r: 12, gapYaw: 90, jumpDist: 5 },
  { id: 'Tower1', bearing: 150, r: 11.5, gapYaw: -40, jumpDist: 4.5 },
]
K.CORE_PADS = [['Core0', -65], ['Core1', 65], ['Core2', -115], ['Core3', 115]]

// ------------------------------------------------------------------ Unity-space helpers
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
/** Unity Compass(yaw, r, y) = (sin·r, y, cos·r) */
export const uc = (yaw, r = 1, y = 0) => new THREE.Vector3(Math.sin(yaw * DEG) * r, y, Math.cos(yaw * DEG) * r)
/** Unity Lateral(yaw) = Cross(up, Compass(yaw)) = right-hand side looking outward */
export const ulat = yaw => uc(yaw + 90)
/** Unity point -> game point (in place) */
export const toGame = v => { v.z = -v.z; return v }
export const deltaAngle = (a, b) => { let d = ((b - a) % 360 + 540) % 360 - 180; return d }
export const angleTo = (a, b) => Math.abs(deltaAngle(a, b))
const UP = V3(0, 1, 0)
/** Unity Quaternion.Euler(x, y, z) (degrees): Ry·Rx·Rz, numerically identical in three */
export const qEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'YXZ'))
/** Unity Quaternion.LookRotation(forward, up) */
export function qLook(fwd, up = UP) {
  const z = fwd.clone().normalize()
  const x = new THREE.Vector3().crossVectors(up, z)
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0)
  x.normalize()
  const y = new THREE.Vector3().crossVectors(z, x)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}
export const qYaw = yaw => qEuler(0, yaw, 0)

// ------------------------------------------------------------------ terrain functions (Unity coordinates)
export function spawnPosU(i) { return uc(K.SPAWNS[i], K.SPAWN_R) }
const SPAWN_XZ = K.SPAWNS.map((a, i) => spawnPosU(i))

export function rampCalm(yaw) {
  let calm = 1
  for (const r of K.RAMPS) calm = Math.min(calm, smooth01((angleTo(yaw, r) - 13) / 10))
  return calm
}
export function lipRadius(yaw) {
  const a = yaw * DEG
  const n = 0.6 * Math.sin(3 * a + 1.3) + 0.4 * Math.sin(7 * a + 0.4) + 0.22 * Math.sin(13 * a + 2.1)
  let calm = rampCalm(yaw)
  for (const b of K.BREACHES) calm = Math.min(calm, smooth01((angleTo(yaw, b) - 8) / 8))
  return K.LIP + n * calm
}
const CLIFF_TAN = Math.tan(K.CLIFF * DEG)
const fract = x => x - Math.floor(x)
/** radius of the cliff face at height y (strata and noise below the lip) */
export function cliffRadius(yaw, y) {
  const d = K.H - y, a = yaw * DEG, ca = Math.cos(a), sa = Math.sin(a)
  const r = lipRadius(yaw) + Math.max(0, d) / CLIFF_TAN
  const k = smooth01(d / 1.4) * (0.15 + 0.85 * rampCalm(yaw))
  const n1 = perlin(12.3 + ca * 4.1 + d * 0.21, 7.7 + sa * 4.1 + d * 0.37) - 0.5
  const n2 = perlin(3.1 + ca * 11, 5.3 + sa * 11 + d * 0.9) - 0.5
  const strata = (fract(d * 0.75 + n1 * 1.6) - 0.5) * 0.7
  const n3 = perlin(40 + ca * 26 + d * 0.8, 11 + sa * 26 + d * 1.9) - 0.5
  return r + k * (n1 * 2.2 + n2 * 0.8 + strata + n3 * 0.9)
}
/** outermost cliff radius between y0 and y1 on a bearing */
export function cliffMaxR(yaw, y0 = -0.5, y1 = K.H) {
  let m = 0
  for (let y = y0; y < y1; y += 0.25) m = Math.max(m, cliffRadius(yaw, y))
  return m
}
/** plain height (Unity x, z): flat to Chebyshev 68 m, hills to ~11 m at the edge, spawn dips */
export function plainHeight(x, z) {
  const e = Math.max(Math.abs(x), Math.abs(z))
  const rim = clamp01((e - 68) / 32)
  let h = rim * rim * 11 + (perlin(x * 0.045 + 40, z * 0.045 + 40) - 0.5) * 3 * rim
  const r = Math.sqrt(x * x + z * z)
  h += (perlin(x * 0.18 + 9, z * 0.18 + 3) - 0.5) * 0.22 * smooth01((r - 26) / 6)
  for (const sp of SPAWN_XZ) {
    const ds = Math.hypot(x - sp.x, z - sp.z)
    if (ds < 7) h -= 0.45 * (1 - smooth01(ds / 7))
  }
  return h
}
export const rampRoadY = s => Math.max(0.02, K.H + 0.03 - Math.max(0, s - K.RAMP_TOP) * K.RAMP_TAN)

// ------------------------------------------------------------------ mesh assembly (port of MeshBuf)
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3()
export class MeshBuf {
  constructor(subs) { this.p = []; this.t = []; this.c = []; this.sub = Array.from({ length: subs }, () => []) }
  get count() { return this.p.length / 3 }
  V(p, u = 0, v = 0, c0 = 1, c1 = 0) { this.p.push(p.x, p.y, p.z); this.t.push(u, v); this.c.push(c0, c1); return this.p.length / 3 - 1 }
  /** triangle whose Cross(b-a, c-a) faces `want` (Unity convention) */
  Tri(s, a, b, c, want) {
    const P = this.p
    _ab.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2])
    _ac.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2])
    _n.crossVectors(_ab, _ac)
    if (_n.dot(want) < 0) { const t = b; b = c; c = t }
    this.sub[s].push(a, b, c)
  }
  Quad(s, a, b, c, d, want) { this.Tri(s, a, b, c, want); this.Tri(s, a, c, d, want) }
  /** quad with UVs planar-mapped in metres (walls: along the face x height, floors: world XZ) */
  QuadW(s, a, b, c, d, want) {
    const n = want.clone().normalize()
    const flat = Math.abs(n.y) > 0.7
    const ax = flat ? V3(1, 0, 0) : new THREE.Vector3().crossVectors(UP, n).normalize()
    const ay = flat ? V3(0, 0, 1) : UP
    const T = p => this.V(p, p.dot(ax), p.dot(ay))
    this.Quad(s, T(a), T(b), T(c), T(d), n)
  }
  /** oriented box; up-facing faces go to topSub */
  Box(sideSub, topSub, center, rot, size, bottom = false) {
    const h = size.clone().multiplyScalar(0.5)
    for (const nl of AXES) {
      if (nl.y < -0.5 && !bottom) continue
      const upL = Math.abs(nl.y) > 0.5 ? V3(0, 0, 1) : V3(0, 1, 0)
      const rightL = new THREE.Vector3().crossVectors(upL, nl.clone().negate())
      const c = nl.clone().multiply(h), r = rightL.multiply(h), u = upL.multiply(h)
      const P = l => l.applyQuaternion(rot).add(center)
      const n = nl.clone().applyQuaternion(rot)
      this.QuadW(n.y > 0.7 ? topSub : sideSub, P(c.clone().sub(r).add(u)), P(c.clone().add(r).add(u)), P(c.clone().add(r).sub(u)), P(c.clone().sub(r).sub(u)), n)
    }
  }
  /** cylinder / cone around local +Y (Defence.cs Cyl), transformed by rot+offset */
  Cyl(sub, capSub, c, r0, r1, y0, y1, seg, top = true, bottom = false, rot = null, off = null) {
    const X = v => { if (rot) v.applyQuaternion(rot); if (off) v.add(off); return v }
    const D = v => (rot ? v.applyQuaternion(rot) : v)
    const upW = D(V3(0, 1, 0))
    for (let i = 0; i < seg; i++) {
      const a0 = i * Math.PI * 2 / seg, a1 = (i + 1) * Math.PI * 2 / seg
      const d0 = V3(Math.cos(a0), 0, Math.sin(a0)), d1 = V3(Math.cos(a1), 0, Math.sin(a1))
      const p0 = c.clone().addScaledVector(d0, r0).setY(c.y + y0), p1 = c.clone().addScaledVector(d1, r0).setY(c.y + y0)
      const p2 = c.clone().addScaledVector(d1, r1).setY(c.y + y1), p3 = c.clone().addScaledVector(d0, r1).setY(c.y + y1)
      const u0 = a0 * Math.max(r0, r1), u1 = a1 * Math.max(r0, r1)
      const want = D(d0.clone().add(d1).multiplyScalar(0.5))
      const w0 = X(p0.clone()), w1 = X(p1.clone()), w2 = X(p2.clone()), w3 = X(p3.clone())
      this.Quad(sub, this.V(w0, u0, y0), this.V(w1, u1, y0), this.V(w2, u1, y1), this.V(w3, u0, y1), want)
      if (top && r1 > 0.001) { const cc = X(c.clone().setY(c.y + y1)); this.Tri(capSub, this.V(cc, cc.x, cc.z), this.V(w2, w2.x, w2.z), this.V(w3, w3.x, w3.z), upW) }
      if (bottom && r0 > 0.001) { const cc = X(c.clone().setY(c.y + y0)); this.Tri(capSub, this.V(cc, cc.x, cc.z), this.V(w0, w0.x, w0.z), this.V(w1, w1.x, w1.z), upW.clone().negate()) }
    }
  }
  /**
   * One BufferGeometry per sub-mesh (null when empty), mirrored into three's right-handed frame.
   * mirror 'z': Unity world -> game world; 'x': Unity local -> game local (for objects rotated with yawToRot).
   * opts.blend: add the vertex colour as a vec2 'blend' attribute; opts.weld: [[i, j]] vertex pairs whose normals are averaged.
   */
  geometries({ mirror = 'z', blend = false, weld = null, smooth = true } = {}) {
    const out = []
    const mi = mirror === 'x' ? 0 : 2
    for (let s = 0; s < this.sub.length; s++) {
      const idx = this.sub[s]
      if (!idx.length) { out.push(null); continue }
      const remap = new Map(), pos = [], uv = [], col = [], index = []
      for (let k = 0; k < idx.length; k += 3) {
        for (const o of [0, 2, 1]) { // reversed winding (mirror flips handedness)
          const v = idx[k + o]
          let m = remap.get(v)
          if (m === undefined) {
            m = pos.length / 3
            remap.set(v, m)
            pos.push(this.p[v * 3], this.p[v * 3 + 1], this.p[v * 3 + 2])
            pos[m * 3 + mi] = -pos[m * 3 + mi]
            uv.push(this.t[v * 2], this.t[v * 2 + 1])
            col.push(this.c[v * 2], this.c[v * 2 + 1])
          }
          index.push(m)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      if (blend) g.setAttribute('blend', new THREE.Float32BufferAttribute(col, 2))
      g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1))
      if (smooth) g.computeVertexNormals()
      if (weld) {
        const n = g.attributes.normal
        for (const [a, b] of weld) {
          const ma = remap.get(a), mb = remap.get(b)
          if (ma === undefined || mb === undefined) continue
          _n.set(n.getX(ma) + n.getX(mb), n.getY(ma) + n.getY(mb), n.getZ(ma) + n.getZ(mb)).normalize()
          n.setXYZ(ma, _n.x, _n.y, _n.z); n.setXYZ(mb, _n.x, _n.y, _n.z)
        }
      }
      out.push(g)
    }
    return out
  }
}
const AXES = [V3(1, 0, 0), V3(-1, 0, 0), V3(0, 1, 0), V3(0, -1, 0), V3(0, 0, 1), V3(0, 0, -1)]

// ------------------------------------------------------------------ plain, skirt, plateau, cliff
/** 200 x 200 m plain (1 m grid; 2 m in lite), uv in metres, blend = (dirt, puddle). Cells hidden under the plateau are skipped. */
export function plainBuf(lite) {
  const size = 200, step = lite ? 2 : 1, n = size / step, W = n + 1
  const b = new MeshBuf(1)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -size / 2 + i * step, z = -size / 2 + j * step
    const r = Math.hypot(x, z) + (perlin(x * 0.08, z * 0.08) - 0.5) * 8
    const dirt = clamp01(0.72 + (perlin(x * 0.06 + 5, z * 0.06 + 1) - 0.5) * 0.9 + smooth01((r - 40) / 15) * 0.3)
    const puddle = r < 60 && !lite ? smooth01((perlin(x * 0.11 + 2, z * 0.11 + 9) - 0.68) / 0.07) : 0
    b.V(V3(x, plainHeight(x, z), z), x, z, dirt, puddle)
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = -size / 2 + i * step, z0 = -size / 2 + j * step
    if (Math.max(Math.hypot(x0, z0), Math.hypot(x0 + step, z0), Math.hypot(x0, z0 + step), Math.hypot(x0 + step, z0 + step)) < 19.5) continue
    b.Quad(0, j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i, UP)
  }
  return b
}
/** a coarse skirt from the square edge out to the horizon so no void shows from high cameras */
export function skirtBuf() {
  const b = new MeshBuf(1)
  const edge = []
  for (let k = 0; k < 400; k += 2) { // perimeter every 2 m, counter-clockwise from (-100,-100)
    const s = k % 100, side = Math.floor(k / 100)
    const x = side === 0 ? -100 + s * 2 : side === 1 ? 100 : side === 2 ? 100 - s * 2 : -100
    const z = side === 0 ? -100 : side === 1 ? -100 + s * 2 : side === 2 ? 100 : 100 - s * 2
    edge.push([x, z])
  }
  const rings = [0, 40, 140, 330]
  const N = edge.length
  for (const d of rings) for (const [x, z] of edge) {
    const r = Math.hypot(x, z), ux = x / r, uz = z / r
    const X = x + ux * d, Z = z + uz * d
    const h = d === 0 ? plainHeight(x, z) : plainHeight(x, z) + Math.min(d, 140) * 0.06 + (perlin(X * 0.02 + 7, Z * 0.02 + 3) - 0.5) * 9 * Math.min(1, d / 40)
    b.V(V3(X, h - (d === 0 ? 0.02 : 0), Z), X, Z, 1, 0)
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, c = j * N + (i + 1) % N
    b.Quad(0, a, c, c + N, a + N, UP)
  }
  return b
}
/** plateau cap (sub 0, ground blend) and the cliff (sub 1, M_CliffRock); returns { buf, weld } */
export function plateauBuf(lite) {
  const seg = lite ? 180 : 360, rings = lite ? 14 : 22
  const b = new MeshBuf(2)
  const weld = []
  const cap0 = b.count
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
    const yaw = i * 360 / seg
    const r = lipRadius(yaw) * j / rings
    const p = uc(yaw, r, K.H)
    const nd = perlin(p.x * 0.09 + 20, p.z * 0.09 + 4) - 0.5
    const dirt = clamp01(smooth01((r - 10) / 11) * 0.75 + nd * 0.7)
    const puddle = r < 15 ? smooth01((perlin(p.x * 0.13 + 7, p.z * 0.13 + 1) - 0.66) / 0.07) : 0
    b.V(p, p.x, p.z, dirt, puddle)
  }
  for (let j = 0; j <= rings; j++) weld.push([cap0 + j * (seg + 1), cap0 + j * (seg + 1) + seg])
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = cap0 + j * (seg + 1) + i, c = cap0 + (j + 1) * (seg + 1) + i
    if (j === 0) b.Tri(0, a, c, c + 1, UP)
    else b.Quad(0, a, a + 1, c + 1, c, UP)
  }
  const ys = [K.H, K.H - 0.3, K.H - 0.8, K.H - 1.4]
  for (let y = K.H - 1.85; y > -1.6; y -= lite ? 0.9 : 0.45) ys.push(y)
  ys.push(-1.8)
  const uScale = Math.round(2 * Math.PI * 23.5 * 0.35) / 0.35 / 360
  const cl0 = b.count
  for (const y of ys) for (let i = 0; i <= seg; i++) {
    const yaw = i * 360 / seg, w = (i % seg) * 360 / seg * DEG
    const yy = y + (y < K.H - 0.1 ? (perlin(Math.cos(w) * 9 + 30, Math.sin(w) * 9 + y * 0.7) - 0.5) * 0.35 : 0)
    const p = uc(yaw, cliffRadius(yaw, yy), yy)
    b.V(p, yaw * uScale, yy + (perlin(Math.cos(w) * 2 + 3, Math.sin(w) * 2) - 0.5) * 2)
  }
  for (let j = 0; j < ys.length; j++) weld.push([cl0 + j * (seg + 1), cl0 + j * (seg + 1) + seg])
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = cl0 + j * (seg + 1) + i, c = cl0 + (j + 1) * (seg + 1) + i
    b.Quad(1, a, a + 1, c + 1, c, uc(i * 360 / seg + 0.5 * 360 / seg))
  }
  return { buf: b, weld }
}

// ------------------------------------------------------------------ causeways
/** sub 0 = road (M_Concrete), sub 1 = retaining walls + parapets (M_WallConcrete) */
export function rampBuf(yaw) {
  const b = new MeshBuf(2)
  const u = uc(yaw), w = ulat(yaw)
  const ss = [K.CAUSE0, K.RAMP_TOP]
  for (let s = K.RAMP_TOP + 1; s < K.RAMP_FOOT; s += 1) ss.push(s)
  ss.push(K.RAMP_FOOT)
  const hw = K.RAMP_W / 2
  const Q = (s, l, y) => u.clone().multiplyScalar(s).addScaledVector(w, l).setY(y)
  for (let k = 0; k < ss.length - 1; k++) {
    const s0 = ss[k], s1 = ss[k + 1]
    const P = (s, l) => Q(s, l, rampRoadY(s))
    b.Quad(0, b.V(P(s0, -hw), -hw, s0), b.V(P(s0, hw), hw, s0), b.V(P(s1, hw), hw, s1), b.V(P(s1, -hw), -hw, s1), UP)
  }
  const bottom = -0.8
  for (const side of [-1, 1]) {
    const inner = side * hw, outer = side * (hw + K.RAMP_WALL)
    for (let k = 0; k < ss.length - 1; k++) {
      const s0 = ss[k], s1 = ss[k + 1]
      const t0 = rampRoadY(s0) + K.RAMP_PAR, t1 = rampRoadY(s1) + K.RAMP_PAR
      b.QuadW(1, Q(s0, inner, t0), Q(s1, inner, t1), Q(s1, inner, bottom), Q(s0, inner, bottom), w.clone().multiplyScalar(-side))
      b.QuadW(1, Q(s0, outer, t0), Q(s1, outer, t1), Q(s1, outer, bottom), Q(s0, outer, bottom), w.clone().multiplyScalar(side))
      b.QuadW(1, Q(s0, inner, t0), Q(s1, inner, t1), Q(s1, outer, t1), Q(s0, outer, t0), UP)
    }
    for (const [s, dir] of [[ss[0], u.clone().negate()], [ss[ss.length - 1], u]]) {
      const t = rampRoadY(s) + K.RAMP_PAR
      b.QuadW(1, Q(s, inner, t), Q(s, outer, t), Q(s, outer, bottom), Q(s, inner, bottom), dir)
    }
  }
  // the embankment: a closed fill under the road (end face at the top, so no gap shows under the road head)
  const s0 = K.CAUSE0
  b.QuadW(1, Q(s0, -hw, rampRoadY(s0)), Q(s0, hw, rampRoadY(s0)), Q(s0, hw, bottom), Q(s0, -hw, bottom), u.clone().negate())
  return b
}

// ------------------------------------------------------------------ rampart, bastions, stairs
export function wallOpenings() {
  return K.RAMPS.map(yaw => ({ yaw, half: K.GATE_HALF_DEG })).sort((a, b) => ((a.yaw % 360) + 360) % 360 - ((b.yaw % 360) + 360) % 360)
}
/** bastion centres (top surface y 9.8): two per gate and one beside each breach */
export function bastions() {
  const list = []
  const off = K.GATE_HW + K.BASTION / 2
  K.RAMPS.forEach((yaw, g) => {
    const c = uc(yaw, K.WALL_R + 0.35, K.WALL_TOP)
    list.push({ pos: c.clone().addScaledVector(ulat(yaw), off), yaw, id: 'Gate' + g + 'R' })
    list.push({ pos: c.clone().addScaledVector(ulat(yaw), -off), yaw, id: 'Gate' + g + 'L' })
  })
  K.BREACHES.forEach((yaw, i) => {
    const side = i === 0 ? 1 : -1
    const c = uc(yaw, K.WALL_R + 0.35, K.WALL_TOP)
    list.push({ pos: c.clone().addScaledVector(ulat(yaw), side * (K.BREACH_HW + K.BASTION / 2)), yaw, id: 'Breach' + i })
  })
  return list
}
export function gateTurretSpot(pos, yaw, id) {
  const toGate = id.endsWith('L') ? 1 : -1
  const p = pos.clone().addScaledVector(ulat(yaw), toGate * K.GATE_SHIFT).addScaledVector(uc(yaw), K.GATE_SHIFT)
  p.y = K.WALL_TOP + K.PLINTH_H
  return p
}
/** sub 0 = block faces (M_WallConcrete), sub 1 = tops / walkway (M_Concrete). Returns { buf, pours } */
export function rampartBuf() {
  const b = new MeshBuf(2)
  const baseY = K.H - 0.6, h = K.WALL_TOP - baseY
  const openings = wallOpenings()
  const rOut = K.WALL_R + K.WALL_HT
  for (let k = 0; k < openings.length; k++) {
    const o0 = openings[k], o1 = openings[(k + 1) % openings.length]
    const a0 = o0.yaw + o0.half
    let a1 = o1.yaw - o1.half
    while (a1 <= a0) a1 += 360
    const n = Math.max(1, Math.ceil((a1 - a0) / 7.5))
    const step = (a1 - a0) / n
    for (let i = 0; i < n; i++) {
      const c = a0 + (i + 0.5) * step
      const rot = qYaw(c)
      const len = 2 * rOut * Math.sin(step * 0.5 * DEG) + 0.04
      b.Box(0, 1, uc(c, K.WALL_R, baseY + h / 2), rot, V3(len, h, K.WALL_HT * 2))
      const rp = rOut - K.PAR_T / 2
      const plen = 2 * rp * Math.sin(step * 0.5 * DEG) + 0.04
      b.Box(0, 1, uc(c, rp, K.WALL_TOP + K.PAR_H / 2), rot, V3(plen, K.PAR_H, K.PAR_T))
      const bh = K.WALL_TOP + K.PAR_H - baseY - 0.25
      b.Box(0, 1, uc(c - step / 2, rOut + 0.18, baseY + bh / 2), qYaw(c - step / 2), V3(0.7, bh, 0.36))
    }
  }
  for (const { pos, yaw, id } of bastions()) {
    const rot = qYaw(yaw)
    b.Box(0, 1, V3(pos.x, baseY + h / 2, pos.z), rot, V3(K.BASTION, h, K.BASTION))
    const q = K.BASTION / 2 - 0.3
    const gate = id.startsWith('Gate'), gateSide = id.endsWith('L') ? 1 : -1
    for (const [x, z] of [[q, q], [-q, q], [q, -q], [-q, -q]]) {
      if (gate && z > 0 && x * gateSide > 0) continue
      b.Box(0, 1, pos.clone().add(V3(x, 0.55, z).applyQuaternion(rot)), rot, V3(0.6, 1.1, 0.6))
    }
    if (gate) {
      const spot = gateTurretSpot(pos, yaw, id)
      b.Box(0, 1, V3(spot.x, K.WALL_TOP + K.PLINTH_H / 2, spot.z), rot, V3(K.PLINTH, K.PLINTH_H, K.PLINTH))
    }
  }
  for (const yaw of K.STAIRS) {
    const tangent = ulat(yaw), rot = qYaw(yaw)
    const steps = 10, tread = 0.42, rise = (K.WALL_TOP - K.H) / steps
    const top = uc(yaw, K.WALL_R - K.WALL_HT - 0.8, 0)
    for (let k = 0; k < steps; k++) {
      const topY = K.WALL_TOP - rise * k
      const hh = topY - (K.H - 0.2)
      const c = top.clone().addScaledVector(tangent, -(k + 0.5) * tread).setY(K.H - 0.2 + hh / 2)
      b.Box(0, 1, c, rot, V3(tread + 0.01, hh, 1.6))
    }
  }
  return b
}
/** stair geometry facts (Unity): top step centre, descent direction, bottom */
export function stairInfo(yaw) {
  const tangent = ulat(yaw)
  const top = uc(yaw, K.WALL_R - K.WALL_HT - 0.8, 0)
  return { yaw, top, down: tangent.clone().negate(), tread: 0.42, rise: 0.28, steps: 10 }
}

/** rusted plates + stiffeners over each patched breach. sub 0 = plates (M_RustMetal), 1 = beams (M_DarkMetal) */
export function breachPatchBuf() {
  const R = rng(4243)
  const Rr = (a, b) => a + R() * (b - a)
  const b = new MeshBuf(2)
  const baseY = K.H - 0.4, top = K.WALL_TOP + K.PAR_H - 0.15, rFace = K.WALL_R + K.WALL_HT
  for (const yaw of K.BREACHES) {
    const half = Math.asin((K.BREACH_HW + 0.9) / K.WALL_R) / DEG
    for (let row = 0; row < 3; row++) {
      const h = (top - baseY) / 3 + 0.25, y0 = baseY + row * (top - baseY) / 3 - 0.1
      for (let k = 0; k < 3; k++) {
        const a = yaw - half + (k + 0.5 + (row % 2) * 0.35 - 0.175) * (2 * half / 3)
        const rot = qYaw(a).multiply(qEuler(0, 0, Rr(-2.5, 2.5)))
        const w = 2 * rFace * Math.sin(half / 3 * DEG) * 2 + 0.35
        b.Box(0, 1, uc(a, rFace + 0.05 + row * 0.025, y0 + h / 2), rot, V3(w, h, 0.07))
      }
    }
    for (const k of [-0.85, 0, 0.85]) {
      const a = yaw + half * k
      b.Box(1, 1, uc(a, rFace + 0.2, (baseY + top) / 2), qYaw(a), V3(0.22, top - baseY, 0.22))
    }
    b.Box(1, 1, uc(yaw, rFace + 0.18, top - 0.1), qYaw(yaw), V3(2 * rFace * Math.sin(half * DEG) + 0.4, 0.24, 0.26))
  }
  return b
}

// ------------------------------------------------------------------ defence-layer pieces (Defence.cs)
/** jump pad body in Unity WORLD space: sub 0 concrete plinth, 1 grate deck, 2 hazard rim blocks */
export function jumpPadBodyBuf(b, pos, rot, s) {
  b.Cyl(0, 0, V3(), 1.1 * s, 1.05 * s, -0.4, 0.16, 16, true, false, rot, pos)
  b.Cyl(1, 1, V3(), 0.86 * s, 0.86 * s, 0.16, 0.2, 16, true, false, rot, pos)
  for (let k = 0; k < 8; k++) {
    const q = rot.clone().multiply(qEuler(0, k * 45 + 22.5, 0))
    b.Box(2, 2, V3(0, 0.19, 0.96 * s).applyQuaternion(q).add(pos), q, V3(0.36 * s, 0.06, 0.14))
  }
}
/** glowing chevrons + ring (pad-local Unity space) */
export function jumpPadGlowBuf(s) {
  const g = new MeshBuf(1)
  for (let k = 0; k < 3; k++) {
    const z = (-0.45 + k * 0.38) * s
    for (const sx of [-1, 1]) g.Box(0, 0, V3(sx * 0.2 * s, 0.215, z), qEuler(0, -sx * 45, 0), V3(0.09 * s, 0.02, 0.5 * s))
  }
  g.Cyl(0, 0, V3(), 0.8 * s, 0.8 * s, 0.2, 0.225, 24, false)
  return g
}
/** empty barricade slot (local Unity space): sub 0 hazard, 1 dark metal */
export function barricadeEmptyBuf(hw, slopeTan) {
  const b = new MeshBuf(2)
  const n = Math.ceil(hw * 2 / 0.5)
  const pitch = qEuler(Math.atan(slopeTan) / DEG, 0, 0)
  for (let k = 0; k < n; k++) {
    const x = -hw + (k + 0.5) * (hw * 2 / n)
    b.Box(k % 2, k % 2, V3(x, 0.015, 0), pitch, V3(hw * 2 / n, 0.03, 0.4))
  }
  for (const sx of [-1, 1]) {
    b.Box(1, 1, V3(sx * (hw + 0.05), 0.35, 0), new THREE.Quaternion(), V3(0.22, 1.1, 0.22))
    b.Box(0, 0, V3(sx * (hw + 0.05), 0.95, 0), new THREE.Quaternion(), V3(0.24, 0.12, 0.24))
  }
  return b
}

// ------------------------------------------------------------------ base stage parts (BaseLook.cs); local Unity space
export function coreBraceBuf(yaw) {
  const m = new MeshBuf(2)
  const foot = V3(0, 0.5, 0), head = uc(yaw, 1.2, 3.3).sub(uc(yaw, 2.7))
  const rot = qLook(head.clone().sub(foot), uc(yaw))
  const len = head.distanceTo(foot)
  const mid = foot.clone().add(head).multiplyScalar(0.5)
  m.Box(0, 0, mid, rot, V3(0.26, 0.26, len))
  m.Box(1, 1, mid.clone().add(V3(0, 0.14, 0).applyQuaternion(rot)), rot, V3(0.08, 0.03, len * 0.8))
  m.Box(0, 0, V3(0, 0.25, 0), qYaw(yaw), V3(0.7, 0.5, 0.7))
  m.Box(0, 0, head, rot, V3(0.4, 0.3, 0.4))
  return m
}
/** a floor conduit from r0 to r1 on a bearing, ducking under pads (pads: [{x,z,half}] Unity), in WORLD-relative coords around pivot */
export function conduitBuf(m, pivot, yaw, r0, r1, junction, pads) {
  const dir = uc(yaw), rot = qYaw(yaw)
  const under = p => pads.some(b => Math.abs(p.x - b.x) < b.half && Math.abs(p.z - b.z) < b.half)
  for (let r = r0; r < r1 - 0.01; r += 1) {
    const len = Math.min(1, r1 - r)
    const p = dir.clone().multiplyScalar(r + len / 2)
    if (under(p)) continue
    p.y = K.H
    const local = p.clone().sub(pivot)
    m.Box(0, 0, local.clone().add(V3(0, 0.08, 0)), rot, V3(0.42, 0.16, len))
    m.Box(1, 1, local.clone().add(V3(0, 0.17, 0)), rot, V3(0.12, 0.02, len - 0.02))
    if (Math.round(r - r0) % 2 === 0) m.Box(0, 0, local.clone().addScaledVector(dir, -len / 2).add(V3(0, 0.11, 0)), rot, V3(0.56, 0.22, 0.12))
  }
  if (junction) {
    const j = dir.clone().multiplyScalar(r0).setY(K.H)
    m.Box(0, 0, j.sub(pivot).add(V3(0, 0.2, 0)), rot, V3(0.7, 0.4, 0.7))
  }
  return m
}
export function gateFrameBuf(yaw) {
  const m = new MeshBuf(2)
  const dir = uc(yaw), right = uc(yaw + 90), rot = qYaw(yaw)
  for (const side of [-1, 1]) {
    m.Box(0, 0, right.clone().multiplyScalar(4.1 * side).add(V3(0, 1.8, 0)), rot, V3(0.4, 3.6, 0.5))
    m.Box(1, 1, right.clone().multiplyScalar((4.1 - 0.21) * side).add(V3(0, 1.8, 0)), rot, V3(0.04, 3.0, 0.12))
  }
  m.Box(0, 0, V3(0, 3.6, 0), rot, V3(8.8, 0.4, 0.5))
  m.Box(1, 1, V3(0, 3.38, 0), rot, V3(8.0, 0.04, 0.14))
  m.Box(1, 1, V3(0, 3.6, 0).addScaledVector(dir, -0.26), rot, V3(8.0, 0.06, 0.02))
  return m
}
export function emitterBuf(m, yaw, off) {
  const outward = uc(yaw), rot = qYaw(yaw)
  m.Box(0, 0, V3(0, 0.15, 0).add(off), rot, V3(0.6, 0.3, 1.0))
  m.Box(0, 0, V3(0, 2.0, 0).add(off), rot, V3(0.2, 3.4, 0.7))
  m.Box(1, 1, V3(0, 2.0, 0).addScaledVector(outward, -0.36).add(off), rot, V3(0.06, 3.0, 0.04))
  return m
}
export function crownBuf(m, yaw, off) {
  const rot = qYaw(yaw)
  m.Box(0, 0, V3(0, 0.1, 0).add(off), rot, V3(0.34, 0.2, 0.9))
  m.Box(1, 1, V3(0, 0.24, 0).add(off), rot, V3(0.1, 0.08, 0.7))
  return m
}
export function wallStripsBuf() {
  const m = new MeshBuf(1)
  for (let a = -180; a < 180; a += 3) {
    const mid = a + 1.5
    let clear = true
    for (const r of K.RAMPS) if (angleTo(mid, r) < 17) clear = false
    for (const r of K.STAIRS) if (angleTo(mid, r) < 16) clear = false
    for (const r of K.BREACHES) if (angleTo(mid, r) < 9) clear = false
    if (clear) m.Box(0, 0, uc(mid, 16.27, K.WALL_TOP - 0.3), qYaw(mid), V3(0.8, 0.07, 0.05))
  }
  return m
}

// ------------------------------------------------------------------ helpers for loaded models
/** box-projected UVs (metres) for a geometry with no uv; `scale` = object scale so texel density stays right */
export function boxUV(geo, scale = 1) {
  if (geo.attributes.uv) return geo
  const p = geo.attributes.position, n = geo.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * scale, y = p.getY(i) * scale, z = p.getZ(i) * scale
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z } else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y } else { uv[i * 2] = x; uv[i * 2 + 1] = y }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}
/** world-space box UVs after a transform (for merged props: continuous texture across instances) */
export function worldBoxUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z } else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y } else { uv[i * 2] = x; uv[i * 2 + 1] = y }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

/** per-triangle box UVs (un-indexes the geometry; keeps smooth normals): no stretching on rounded rocks */
export function faceBoxUV(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const p = g.attributes.position
  const uv = new Float32Array(p.count * 2)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3()
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2)
    n.subVectors(c, b).cross(_ab.subVectors(a, b))
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z)
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c
      if (ay >= ax && ay >= az) { uv[(i + k) * 2] = v.x; uv[(i + k) * 2 + 1] = v.z } else if (ax >= az) { uv[(i + k) * 2] = v.z; uv[(i + k) * 2 + 1] = v.y } else { uv[(i + k) * 2] = v.x; uv[(i + k) * 2 + 1] = v.y }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

// ------------------------------------------------------------------ procedural textures (no DOM)
/** Mat_PadRing mask (Prefabs.cs T_PadRing), 256², rgb = alpha = mask */
export function padRingTexture() {
  const N = 256, d = new Uint8Array(N * N * 4)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1
    const r = Math.hypot(x, y), ang = Math.atan2(y, x)
    const ring = Math.exp(-Math.pow((r - 0.86) * 28, 2))
    const dash = (Math.sin(ang * 24) > 0 ? 1 : 0) * Math.exp(-Math.pow((r - 0.76) * 40, 2))
    let corner = 0
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4
      const dd = Math.abs(deltaAngle(ang / DEG, a / DEG))
      corner = Math.max(corner, (dd < 8 ? 1 : 0) * Math.exp(-Math.pow((r - 0.93) * 30, 2)))
    }
    const m = Math.round(clamp01(ring + dash * 0.7 + corner) * 255)
    const o = (j * N + i) * 4
    d[o] = d[o + 1] = d[o + 2] = d[o + 3] = m
  }
  const t = new THREE.DataTexture(d, N, N)
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
/** thin bright ring at 0.82 of the half size (the upgrade sweep, T_Ring) */
export function sweepRingTexture() {
  const N = 256, d = new Uint8Array(N * N * 4)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1
    const r = Math.hypot(x, y)
    const m = Math.round(clamp01(Math.exp(-Math.pow((r - 0.82) * 22, 2)) + 0.25 * Math.exp(-Math.pow((r - 0.75) * 9, 2)) * (r < 0.82 ? 1 : 0)) * 255)
    const o = (j * N + i) * 4
    d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = m
  }
  const t = new THREE.DataTexture(d, N, N)
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
/** soft radial falloff for the fake light pools */
export function poolTexture() {
  const N = 64, d = new Uint8Array(N * N * 4)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1
    const r = Math.min(1, Math.hypot(x, y))
    const f = Math.pow(1 - r, 2.2)
    const o = (j * N + i) * 4
    d[o] = d[o + 1] = d[o + 2] = Math.round(f * 255); d[o + 3] = 255
  }
  const t = new THREE.DataTexture(d, N, N)
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
