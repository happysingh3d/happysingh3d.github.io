// Hive Adapt (Project 0 port): procedural FX textures (ports of HiveBuilder.Vfx.cs BuildVfxTextures + Roles cracks/acid),
// generated once at load into DataTextures (no DOM). The damage-number glyph atlas uses an OffscreenCanvas.
import * as THREE from 'three'

// ---------------------------------------------------------------- noise (exact ports of the Unity builder's Hash/VNoise/Fbm)
function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0
  h = Math.imul(h ^ (h >> 13), 1274126177)
  return ((h ^ (h >> 16)) & 0xffff) / 65535
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y)
  let fx = x - xi, fy = y - yi
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s)
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx
  return ab + (cd - ab) * fy
}
const fbm = (x, y, s) => vnoise(x, y, s) * 0.5 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.2
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const deltaAngle = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }

// ---------------------------------------------------------------- sprite generators: f(x, y) with x, y in [-1, 1] -> [r, g, b, a] (0..1)
const out = [0, 0, 0, 0]
const set = (r, g, b, a) => { out[0] = r; out[1] = g; out[2] = b; out[3] = a; return out }
const SPRITES = {
  // T_SoftDot
  dot: (x, y) => { const r = Math.sqrt(x * x + y * y); const a = c01(1 - r); return set(1, 1, 1, a * a) },
  // T_Glow
  glow: (x, y) => set(1, 1, 1, c01(Math.exp(-(x * x + y * y) * 5) * 1.1 - 0.02)),
  // T_Smoke (two seeds so a puff field does not repeat)
  smoke: (x, y) => smokeFn(x, y, 3, 10),
  smoke2: (x, y) => smokeFn(x, y, 7, 23),
  // T_Ring
  ring: (x, y) => {
    const r = Math.sqrt(x * x + y * y)
    const a = Math.exp(-Math.pow((r - 0.82) * 10, 2)) + Math.exp(-Math.pow((r - 0.82) * 4, 2)) * 0.25
    return set(1, 1, 1, r < 1 ? c01(a) : 0)
  },
  // T_MuzzleFlash
  flash: (x, y) => {
    const r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x)
    const star = Math.pow(Math.abs(Math.cos(ang * 3)), 18) * c01(1 - r) + Math.pow(Math.abs(Math.cos(ang * 2 + 0.4)), 30) * c01(1 - r * 1.2) * 0.6
    const core = Math.exp(-r * r * 14)
    const n = fbm(ang * 3 + 20, r * 6, 9) * c01(1 - r) * 0.5
    return set(1, 1, 1, c01(core + star + n * 0.6))
  },
  // T_Beam (u along the line, v across: profile on y)
  beam: (x, y) => { const a = Math.exp(-y * y * 9) + Math.exp(-y * y * 60) * 0.8; const end = c01((1 - Math.abs(x)) * 12); return set(1, 1, 1, c01(a) * end) },
  // T_Debris (two variants)
  debris: (x, y) => debrisFn(x, y, 5, 6),
  debris2: (x, y) => debrisFn(x * 1.15, y * 0.85, 15, 16),
  // T_Spore
  spore: (x, y) => { const r = Math.sqrt(x * x + y * y); return set(1, 1, 1, c01(Math.exp(-r * r * 9) + Math.exp(-Math.pow((r - 0.5) * 9, 2)) * 0.4)) },
  // a goo droplet: firmer edge than the soft dot, with a darker rim so it reads as liquid
  blob: (x, y) => { const r = Math.sqrt(x * x + y * y); const a = c01((0.82 - r) * 7); const s = 0.75 + 0.25 * c01(1 - r * 1.4); return set(s, s, s, a) },
  // the side flame of a muzzle flash, drawn along u (x) from the muzzle (x = -1) out to the tip (x = 1)
  cone: (x, y) => {
    const u = (x + 1) * 0.5
    const w = 0.12 + 0.75 * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.62) * (1 - u * 0.55)
    const n = 0.75 + 0.5 * fbm(u * 5 + 3, y * 3 + 7, 29)
    const a = Math.exp(-Math.pow(y / Math.max(0.05, w), 2) * 2.2) * c01(u * 7) * c01((1 - u) * 2.6) * n
    return set(1, 1, 1, c01(a))
  },
  // a four-point sparkle (Hive Sample gold, elite bursts)
  star: (x, y) => {
    const r = Math.sqrt(x * x + y * y)
    const cross = Math.exp(-Math.abs(x) * 26) * c01(1 - Math.abs(y)) + Math.exp(-Math.abs(y) * 26) * c01(1 - Math.abs(x))
    return set(1, 1, 1, c01(Math.exp(-r * r * 22) * 1.2 + cross * 0.9))
  },
  // a soft thick ring (dust / shock fronts, shield ripples)
  softRing: (x, y) => { const r = Math.sqrt(x * x + y * y); return set(1, 1, 1, r < 1 ? c01(Math.exp(-Math.pow((r - 0.72) * 4.2, 2)) * 0.9 + Math.exp(-Math.pow((r - 0.86) * 16, 2)) * 0.5) : 0) },
  // a hex-cell energy shard (Core / shield break)
  shard: (x, y) => { const ax = Math.abs(x), ay = Math.abs(y); const d = Math.max(ax * 0.866 + ay * 0.5, ay); return set(1, 1, 1, c01((0.8 - d) * 8) * (0.55 + 0.45 * c01(1 - d))) },
  white: () => set(1, 1, 1, 1),
}
function smokeFn(x, y, s, o) {
  const r = Math.sqrt(x * x + y * y)
  const n = fbm(x * 3 + o, y * 3 + o, s)
  const a = c01((1 - r * (1.1 + n * 0.5)) * 1.6) * (0.55 + n * 0.6)
  const shade = 0.75 + n * 0.25
  return set(shade, shade, shade, c01(a))
}
function debrisFn(x, y, s1, s2) {
  const ang = Math.atan2(y, x)
  const edge = 0.55 + 0.35 * vnoise(ang * 1.8 + 5, 0.5, s1)
  const r = Math.sqrt(x * x + y * y)
  const a = c01((edge - r) * 14)
  const s = 0.35 + 0.4 * vnoise(x * 6 + 3, y * 6 + 3, s2)
  return set(s * 1.25, s * 0.85 * 1.25, s * 0.6 * 1.25, a)
}

/** particle atlas cell indices (4 x 4) */
export const CELL = { dot: 0, glow: 1, smoke: 2, smoke2: 3, ring: 4, flash: 5, beam: 6, debris: 7, debris2: 8, spore: 9, blob: 10, cone: 11, star: 12, softRing: 13, shard: 14, white: 15 }

function bake(cols, rows, cell, names, fns) {
  const W = cols * cell, H = rows * cell
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < names.length; i++) {
    const f = fns[names[i]]
    if (!f) continue
    const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell
    for (let py = 0; py < cell; py++) {
      const y = (py + 0.5) / cell * 2 - 1
      for (let px = 0; px < cell; px++) {
        const x = (px + 0.5) / cell * 2 - 1
        const c = f(x, y)
        const o = ((cy + py) * W + cx + px) * 4
        data[o] = Math.round(c01(c[0]) * 255); data[o + 1] = Math.round(c01(c[1]) * 255); data[o + 2] = Math.round(c01(c[2]) * 255); data[o + 3] = Math.round(c01(c[3]) * 255)
      }
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace // the Unity builder's GenTex colours are sRGB-authored (alpha stays linear)
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

/** 512 x 512 particle atlas (16 cells of 128 px; 64 px cells when lite) */
export function particleAtlas(lite) {
  const names = Object.keys(CELL).sort((a, b) => CELL[a] - CELL[b])
  return bake(4, 4, lite ? 64 : 112, names, SPRITES)
}

// ---------------------------------------------------------------- decal atlas (4 x 2 cells): colour + alpha, alpha-blended
const DECALS = {
  // T_Decal_BulletHole
  bulletHole: (x, y) => {
    const r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x)
    const cracks = Math.pow(Math.abs(Math.sin(ang * 5 + vnoise(ang * 2, 1, 8) * 3)), 40) * c01(1 - r * 1.1)
    const hole = c01((0.22 - r) * 30)
    const soot = c01(1 - r * 1.25) * 0.55 * (0.6 + 0.4 * fbm(x * 5, y * 5, 11))
    const a = c01(hole + soot + cracks * 0.7)
    const c = 0.18 + (0.02 - 0.18) * hole
    return set(c, c * 0.95, c * 0.9, a)
  },
  // T_Decal_Scorch
  scorch: (x, y) => {
    const r = Math.sqrt(x * x + y * y)
    const n = fbm(x * 4 + 2, y * 4 + 2, 13)
    return set(0.03, 0.028, 0.025, c01((1 - r * (1.1 + n * 0.6)) * 2) * 0.85)
  },
  // T_Decal_Goo
  goo: (x, y) => {
    const r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x)
    const lobes = 0.5 + 0.18 * vnoise(ang * 2.2 + 7, 0.3, 17) + 0.12 * Math.sin(ang * 7)
    const body = c01((lobes - r) * 12)
    let drops = 0
    if (r > 0.5) for (let i = 0; i < 9; i++) {
      const da = i * 0.7 + hash(i, 3, 21) * 0.6, dr = 0.62 + hash(i, 5, 21) * 0.3, ds = 0.03 + hash(i, 7, 21) * 0.05
      const dx = x - Math.cos(da) * dr, dy = y - Math.sin(da) * dr
      drops = Math.max(drops, c01((ds - Math.sqrt(dx * dx + dy * dy)) * 60))
    }
    const a = Math.max(body, drops)
    const n = fbm(x * 6, y * 6, 19)
    // a glossy wet sheen toward the middle (the decal is unlit)
    const sheen = c01(1 - r * 2.2) * 0.12
    return set(0.27 + n * 0.12 + sheen, 0.15 + n * 0.07 + sheen * 0.6, 0.03, a * 0.92)
  },
  // T_Decal_Acid
  acid: (x, y) => {
    const r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x)
    const lobes = 0.55 + 0.2 * vnoise(ang * 2.4 + 3, 0.7, 41) + 0.08 * Math.sin(ang * 9)
    const body = c01((lobes - r) * 9)
    const n = fbm(x * 7, y * 7, 43)
    const burn = c01((lobes + 0.12 - r) * 6) * 0.5
    const a = Math.max(body * (0.75 + n * 0.25), burn)
    return set(0.22 + n * 0.15, 0.34 + n * 0.2, 0.05, a * 0.9)
  },
  // T_Decal_Cracks
  crack: (x, y) => {
    const r = Math.sqrt(x * x + y * y), ang = Math.atan2(y, x)
    let c = 0
    if (r < 0.96) for (let k = 0; k < 8; k++) {
      const a0 = k * 0.785 + (hash(k, 1, 31) - 0.5) * 0.6
      const wob = (vnoise(r * 7 + k * 3, k * 1.7, 33) - 0.5) * 0.7
      const da = Math.abs(deltaAngle(ang, a0 + wob))
      const len = 0.55 + hash(k, 2, 31) * 0.4
      if (r > len) continue
      const w = 0.022 * (1 - r / len) + 0.004
      c = Math.max(c, c01((w - da * r) * 110))
    }
    const hole = c01((0.2 - r + (fbm(x * 8, y * 8, 35) - 0.5) * 0.12) * 18)
    const rubble = c01(1 - r * 1.6) * 0.35 * fbm(x * 10 + 3, y * 10 + 3, 37)
    return set(0.05, 0.04, 0.03, c01(Math.max(c, hole * 0.95) + rubble))
  },
  // plasma scorch: the scorch with a faint cyan-burnt rim
  plasmaScorch: (x, y) => {
    const r = Math.sqrt(x * x + y * y)
    const n = fbm(x * 4 + 9, y * 4 + 9, 47)
    const a = c01((1 - r * (1.1 + n * 0.6)) * 2) * 0.85
    const rim = c01(1 - Math.abs(r - 0.42) * 6) * 0.25
    return set(0.03 + rim * 0.1, 0.03 + rim * 0.35, 0.03 + rim * 0.45, a)
  },
}
export const DECAL_CELL = { bulletHole: 0, scorch: 1, goo: 2, acid: 3, crack: 4, plasmaScorch: 5 }
export function decalAtlas(lite) {
  const names = Object.keys(DECAL_CELL).sort((a, b) => DECAL_CELL[a] - DECAL_CELL[b])
  return bake(4, 2, lite ? 128 : 192, names, DECALS)
}

// ---------------------------------------------------------------- damage-number glyph atlas ('0'-'9', '!'), white fill + black outline
export const GLYPHS = '0123456789!'
/** returns { texture, cols, rows, advance: Float32Array (em, per glyph), cellAspect (w/h), cellEm (cell height in em) } or null */
export function glyphAtlas(family) {
  if (typeof OffscreenCanvas === 'undefined') return null
  const px = 72, cellH = 96, cellW = 64, cols = GLYPHS.length
  const cv = new OffscreenCanvas(cols * cellW, cellH)
  const g = cv.getContext('2d')
  if (!g) return null
  g.clearRect(0, 0, cv.width, cv.height)
  g.font = `700 ${px}px ${family}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const advance = new Float32Array(cols)
  for (let i = 0; i < cols; i++) {
    const ch = GLYPHS[i], x = i * cellW + cellW / 2, y = cellH / 2 + px * 0.04
    advance[i] = g.measureText(ch).width / px
    // TMP outline 0.18 (alpha 200): a stroke ~0.16 em wide in black, then the white face
    g.lineWidth = px * 0.17
    g.strokeStyle = 'rgba(0,0,0,0.82)'
    g.strokeText(ch, x, y)
    g.fillStyle = '#fff'
    g.fillText(ch, x, y)
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.NoColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.flipY = false
  t.needsUpdate = true
  return { texture: t, cols, advance, cellAspect: cellW / cellH, cellEm: cellH / px }
}
