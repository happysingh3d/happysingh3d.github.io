// Hive Adapt (Project 0 port): shared helpers.
// Game space = Unity metres, +Y up, right-handed: Unity (x, y, z) -> game (x, y, -z).
// Compass bearings (degrees) as in the Unity builder: 0 = north, 90 = east.
// Unity Compass(yaw, r, y) = (sin·r, y, cos·r)  ->  game (sin·r, y, -cos·r): north is -Z here.
import * as THREE from 'three'

export const DEG = Math.PI / 180
export const TAU = Math.PI * 2

/** Unity world point -> game-space Vector3 */
export function U(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, -z) }
/** compass point (bearing deg, radius, height) in game space */
export function compass(yawDeg, r, y = 0, out = new THREE.Vector3()) {
  const a = yawDeg * DEG
  return out.set(Math.sin(a) * r, y, -Math.cos(a) * r)
}
/** unit vector pointing along a bearing (game space, horizontal) */
export function bearingDir(yawDeg, out = new THREE.Vector3()) { return compass(yawDeg, 1, 0, out) }
/** bearing (deg) of a game-space point seen from the origin */
export function bearingOf(x, z) { return Math.atan2(x, -z) / DEG }
/** three.js rotation.y that makes a +Z-facing model face Unity yaw `yawDeg` */
export function yawToRot(yawDeg) { return Math.PI - yawDeg * DEG }
/** three.js rotation.y that makes a +Z-facing model face game-space direction (dx, dz) */
export function faceRot(dx, dz) { return Math.atan2(dx, dz) }

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const invLerp = (a, b, v) => (a === b ? 0 : clamp01((v - a) / (b - a)))
export const smooth01 = t => { t = clamp01(t); return t * t * (3 - 2 * t) }
export const easeOutQuad = t => 1 - (1 - t) * (1 - t)
export const easeOutBack = (t, c = 1.70158) => { const c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) }
export const planar = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
export const planar2 = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz }
/** shortest signed angle difference (radians) */
export function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d }
/** rotate angle a toward b by at most step (radians) */
export function turnToward(a, b, step) { const d = angDiff(a, b); return Math.abs(d) <= step ? b : a + Math.sign(d) * step }
/** Unity Mathf.MoveTowards */
export function moveTowards(a, b, step) { return Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step }
/** Unity Mathf.RoundToInt: rounds halves to even (banker's rounding) */
export function roundEven(v) {
  const f = Math.floor(v), d = v - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}
/** Unity Mathf.CeilToInt on a float32 product (matches the economy tables' float32 quirks) */
export const ceil32 = v => Math.ceil(Math.fround(v))
export const fmt = n => Math.round(n).toLocaleString('en-US')
/** print an integer when within 0.05, else one decimal (HudController Num()) */
export const num = v => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1))

/** small deterministic PRNG (mulberry32) */
export function rng(seed = 1) {
  let a = seed >>> 0
  const f = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  f.range = (lo, hi) => lo + (hi - lo) * f()
  f.int = (lo, hiExcl) => Math.floor(lo + (hiExcl - lo) * f())
  f.pick = arr => arr[Math.floor(f() * arr.length)]
  f.sign = () => (f() < 0.5 ? -1 : 1)
  return f
}

/** 2D gradient noise in [0,1], centred on 0.5 (stand-in for Mathf.PerlinNoise) */
const PERM = (() => { const r = rng(1337), p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] } return p.concat(p) })()
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
export function perlin(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const X = xi & 255, Y = yi & 255
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10)
  const g = (h, dx, dy) => { const q = GRAD[h & 7]; return q[0] * dx + q[1] * dy }
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1], ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1]
  const u = fade(xf), v = fade(yf)
  const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u), x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u)
  return clamp01(lerp(x1, x2, v) * 0.7071 + 0.5)
}

/** colour helpers: Unity linear-ish float colours -> THREE.Color (treated as sRGB-authored values) */
export const col = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)
export const hdr = (r, g, b) => new THREE.Color(r, g, b) // HDR emission, linear

export const PAL = {
  amber: col(1, 0.69, 0), // interactable #FFB000
  cyan: col(0, 0.898, 1), // Core energy #00E5FF
  hudAmber: [255, 181, 71],
  coreCyan: [84, 219, 255],
  danger: [255, 74, 46],
  lime: [184, 255, 61],
  text: [242, 237, 227],
  textDim: [184, 199, 212],
  hive: [255, 92, 51],
  jam: [184, 92, 255],
  sample: [199, 153, 255],
  siege: [255, 97, 66],
  shield: [158, 204, 255],
  stamina: [245, 214, 128],
  dmg: { Ballistic: [255, 191, 89], Energy: [89, 204, 255], Explosive: [255, 115, 51], Rail: [153, 217, 255] },
}
export const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
