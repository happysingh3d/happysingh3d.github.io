// Hive Adapt (Project 0 port): FX module — every visual effect (CONTRACT.md "fx.js"). createFx(G) -> API:
//   burst(kind, pos, opts{ normal, dir, colour|color, scale, count, radius, seconds, energy })   one-shot particle effects (fxkinds.js)
//   decal(pos, normal, kind, { life, scale (size in metres), rot (deg) })   pooled flat decals: bulletHole scorch scorchLarge plasmaScorch goo acid crack
//   tracer(from, to, kind)            racing bullet streak: 'bullet' (340 m/s, 7 m) | 'pellet' (300 m/s, 3.5 m) | 'turret' (300 m/s, 9 m)
//   beam(from, to, kind, life)        held beam: 'rail' (w 0.075, 0.14 s, width (1-k)(1+0.3 sin 90t)) | 'energy' (turret, w 0.16)
//   muzzle(pos, dir, kind, opts)      flash star + side flame + sparks (+ smoke) + muzzle light: ar plasma shotgun smg rail gl
//                                     turretBallistic turretEnergy (also 'muzzle_ar', 'turretMuzzle_energy', 'AR7', ...); opts.light false =
//                                     no light (turret kinds default to no light: turrets.js flashes its own; opts.light true forces one)
//   number(pos, value, style)         damage number: 'normal' | 'weak' ("N!") | 'kill' | 'turret' (DamageNumbers.cs, unscaled time)
//   light(pos, colour, intensity, range, life)   flash from a pool of 3 PointLights (Unity URP intensity/range; skipped when G.lite)
//   shell(pos, right, opts)           ejected brass casing (also burst('shell', pos, { dir: right })); tinks once on first contact
//   shake(amount) -> G.shake, update(dt, rdt), load(), clear() (new run), stats() (counts for tests), kinds()
// Projectiles can call burst('plasmaBolt' | 'grenadeFuse', pos) every frame for a glowing core (drawn once, gone next
// frame) and burst('plasmaTrail' | 'grenadeTrail', pos) for their trails. Unknown kinds are logged once and ignored.
// Everything lives under G.root in game space (Unity metres). Draw calls: 2 particle pools + decals + numbers + shells (each
// only when non-empty). No per-frame allocation: pools are preallocated structure-of-arrays, kinds are resolved through a cache.
import { fontBuffer } from './b64.js'
import * as THREE from 'three'
import { ParticlePool, particleMaterial } from './fxparts.js'
import { particleAtlas, decalAtlas, glyphAtlas, CELL, DECAL_CELL } from './fxtex.js'
import { KINDS, MUZZLES, TRACERS, BEAMS, DECALS, ALIASES, MUZZLE_ALIASES, TRACER_ALIASES, BEAM_ALIASES } from './fxkinds.js'

const DEG = Math.PI / 180
const G9 = 9.81
const EMPTY = Object.freeze({})
const ALPHA_CELLS = new Set(['smoke', 'smoke2', 'debris', 'debris2', 'blob'])
// colour multipliers per sprite (Unity FxMat intensities 3-8 under bloom; here ACES alone, so kept low enough to hold the hue)
const INTENSITY = { dot: 1.6, glow: 1.1, ring: 1.25, flash: 1.8, beam: 1.6, spore: 1.2, star: 1.4, cone: 1.6, shard: 1.2, softRing: 1.0 }
const SHAPES = { cone: 0, sphere: 1, hemi: 2, circle: 3, disc: 4, none: 5 }
const FADES = { in: 1, lin: 2, hold: 3 }
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const linArr = (c, k = 1) => [toLin(c[0]) * k, toLin(c[1]) * k, toLin(c[2]) * k, c.length > 3 ? c[3] : 1]
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

// ---------------------------------------------------------------- spec preparation (once, at create)
function prepEmitter(s) {
  const t = s.t || 'dot'
  const add = s.add !== undefined ? s.add : (ALPHA_CELLS.has(t) ? 0 : 1)
  const k = s.i !== undefined ? s.i : (add ? (INTENSITY[t] || 1.5) : 1)
  const c = s.c || [[1, 1, 1], [1, 1, 1]]
  const flat = s.flat === 'n' ? 2 : s.flat ? 1 : 0
  return {
    cell: CELL[t] ?? 0, cellAlt: t === 'smoke' ? CELL.smoke2 : t === 'debris' ? CELL.debris2 : -1, add, k,
    n: s.n || 0, rate: s.rate || 0, dur: s.dur || 0, delay: s.delay || 0,
    life0: s.life[0], life1: s.life[1], sp0: s.sp ? s.sp[0] : 0, sp1: s.sp ? s.sp[1] : 0, sz0: s.sz[0], sz1: s.sz[1],
    cA: linArr(c[0], k), cB: linArr(c[1] || c[0], k), grav: (s.grav || 0) * G9, drag: s.drag || 0, noise: s.noise || 0,
    shape: SHAPES[s.shape || 'cone'], cosAng: Math.cos((s.ang ?? 25) * DEG), rad: s.rad ?? 0.05, up: !!s.up,
    st: s.st || 0, fixed: !!s.fixed, sl: s.sl ?? (s.fixed ? 1 : 0), se0: s.se ? s.se[0] : 1, se1: s.se ? s.se[1] : 1,
    rot: (s.rot || 0) * DEG, spin: (s.spin || 0) * DEG, flat, fade: FADES[s.fade] || 0, col: !!s.col,
    offx: s.off ? s.off[0] : 0, offy: s.off ? s.off[1] : 0, offz: s.off ? s.off[2] : 0, offA: s.offA || 0,
    tint: s.tint || 0, ringR: !!s.ringR, ringU: !!s.ringU, sec: !!s.sec, tintK: k,
    mode: s.fixed || s.st ? 1 : flat ? 2 : 0,
  }
}
function prepKind(name, def) {
  const L = def.light
  return { name, e: def.e.map(prepEmitter), light: L ? { c: linArr(L[0]), i: L[1], r: L[2], fade: L[3] } : null, collide: def.e.some(e => e.col) }
}

export function createFx(G) {
  const S = G.S || 1 / 12
  const root = G.root
  const fx = {}
  let ready = false

  // ------------------------------------------------------------------ fast local RNG (never touches G.rng: gameplay stays deterministic)
  let seed = 0x9e3779b9
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const rr = (a, b) => a + (b - a) * rnd()

  // ------------------------------------------------------------------ prepared tables
  const kinds = new Map()
  for (const k of Object.keys(KINDS)) kinds.set(k, prepKind(k, KINDS[k]))
  kinds.get('barricadeHit').energyKind = kinds.get('barricadeHitEnergy')
  kinds.get('barricadeBreak').energyKind = kinds.get('barricadeBreakEnergy')
  const normKinds = new Map()
  for (const k of kinds.keys()) normKinds.set(norm(k), kinds.get(k))
  for (const a of Object.keys(ALIASES)) normKinds.set(a, kinds.get(ALIASES[a]))
  const muzzles = {}
  for (const k of Object.keys(MUZZLES)) {
    const m = MUZZLES[k]
    const c = m.c, w = [c[0] + (1 - c[0]) * 0.4, c[1] + (1 - c[1]) * 0.4, c[2] + (1 - c[2]) * 0.4]
    muzzles[k] = { turret: /^turret/.test(k), size: m.size, smoke: m.smoke, cA: linArr(c, 1.8), cB: linArr(w, 1.8), cGlow: linArr(c, 0.9), cCone: linArr(c, 1.5), cSpark: linArr(c, 1.6), light: { c: linArr(m.light[0]), i: m.light[1], r: m.light[2], life: m.light[3] } }
  }
  const tracers = {}
  for (const k of Object.keys(TRACERS)) { const t = TRACERS[k]; tracers[k] = { ...t, lc: linArr(t.c, t.i) } }
  const beams = {}
  for (const k of Object.keys(BEAMS)) { const b = BEAMS[k]; beams[k] = { ...b, lc: linArr(b.c, b.i), glow: linArr(b.c, 0.9) } }
  const smokeA = linArr([0.6, 0.58, 0.55]), smokeB = linArr([0.5, 0.48, 0.45]), WHITE_L = linArr([1, 1, 1], 1.5)

  const resolved = new Map() // raw kind string -> prepared kind | null (cache: no string work per call)
  const warned = new Set()
  function warnOnce(what) { if (!warned.has(what)) { warned.add(what); G.log?.('fx: unknown ' + what) } }
  const MUZZLE_KIND = { muzzle: true }
  function resolveKind(kind) {
    let k = resolved.get(kind)
    if (k !== undefined) return k
    k = kinds.get(kind) || normKinds.get(norm(kind)) || null
    if (!k && /^(turret)?muzzle/i.test(String(kind))) k = MUZZLE_KIND
    if (!k) warnOnce('burst kind ' + kind)
    resolved.set(kind, k)
    return k
  }
  function resolveFrom(table, aliases, kind, fallback, cache) {
    let k = cache.get(kind)
    if (k !== undefined) return k
    const n = norm(kind || fallback).replace(/^(fx|muzzleflash|muzzle|tracer|beam)+/, '')
    k = table[aliases[n] || n] || table[aliases[n.replace(/^turretmuzzle/, 'turret')]] || null
    if (!k) { warnOnce('kind ' + kind); k = table[fallback] }
    cache.set(kind, k)
    return k
  }
  const muzzleCache = new Map(), tracerCache = new Map(), beamCache = new Map()

  // ------------------------------------------------------------------ GPU objects
  let pAlpha = null, pAdd = null, pMat = null
  const lite = () => !!G.lite
  function buildPools() {
    const atlas = particleAtlas(lite())
    pMat = particleMaterial(atlas, S)
    pAlpha = new ParticlePool(pMat, lite() ? 360 : 1100, 'FX_ParticlesAlpha', 30)
    pAdd = new ParticlePool(pMat, lite() ? 800 : 2400, 'FX_ParticlesAdd', 31)
    root.add(pAlpha.mesh, pAdd.mesh)
  }

  // ------------------------------------------------------------------ scratch (no allocation in hot paths)
  const _n = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3()
  const _v2 = new THREE.Vector2()
  const tint = [1, 1, 1]
  const UPV = new THREE.Vector3(0, 1, 0)
  function basis(nx, ny, nz) {
    const l = Math.hypot(nx, ny, nz)
    if (l < 1e-6) { nx = 0; ny = 1; nz = 0 } else { nx /= l; ny /= l; nz /= l }
    _n.set(nx, ny, nz)
    if (Math.abs(ny) < 0.99) _t.set(nz, 0, -nx).normalize() // cross(n, up) direction (horizontal)
    else _t.set(1, 0, 0)
    _b.crossVectors(_n, _t)
  }
  /** colour from opts (THREE.Color, [r,g,b] HDR, hex number) -> normalised linear into tint; false if none */
  function readTint(o) {
    const c = o.colour !== undefined ? o.colour : o.color
    if (c === undefined || c === null) return false
    let r, g, b
    if (typeof c === 'number') { r = toLin(((c >> 16) & 255) / 255); g = toLin(((c >> 8) & 255) / 255); b = toLin((c & 255) / 255) }
    else if (c.isColor) { r = c.r; g = c.g; b = c.b }
    else if (c.length >= 3) {
      // HDR emission arrays (enemydata mat.emis, e.g. [4.5, 1.2, 0.2], linear) keep their hue: normalise by the brightest
      // channel; plain 0..1 arrays are sRGB-authored palette colours (boss uiColor)
      const m = Math.max(c[0], c[1], c[2], 1e-4)
      if (m > 1) { r = c[0] / m; g = c[1] / m; b = c[2] / m } else { r = toLin(c[0]); g = toLin(c[1]); b = toLin(c[2]) }
    } else return false
    tint[0] = r; tint[1] = g; tint[2] = b
    return true
  }
  /** how many of n to emit: lite cut, pool pressure, distance from the camera */
  function countFor(n, pool, mul) {
    if (n <= 0) return 0
    if (pool.n >= pool.cap) return 0
    if (n <= 1) return n * mul >= 0.5 || n === 1 ? 1 : 0
    let x = n * mul
    if (lite()) x *= 0.34
    const f = pool.n / pool.cap
    if (f > 0.5) x *= Math.max(0.08, (1 - f) * 2)
    return Math.floor(x + rnd())
  }
  function distMul(x, y, z) {
    const c = G.cam && G.cam.pos
    if (!c) return 1
    const d2 = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) + (z - c.z) * (z - c.z)
    return d2 > 14400 ? 0.3 : d2 > 4900 ? 0.6 : 1
  }

  /** spawn one particle of emitter E at (x, y, z) using the current basis (_n/_t/_b) */
  function spawn(E, x, y, z, scale, sizeMul, se1, hasTint, floorY, lifeMul) {
    const pool = E.add ? pAdd : pAlpha
    const i = pool.alloc()
    if (i < 0) return -1
    // shape: direction (dx, dy, dz) and offset (ox, oy, oz), in the emitter frame -> world
    let dx, dy, dz, ox = 0, oy = 0, oz = 0
    const sh = E.shape
    if (sh === 0) {
      const ct = 1 - rnd() * (1 - E.cosAng), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = rnd() * 6.2831853
      const lx = Math.cos(ph) * st, ly = Math.sin(ph) * st
      dx = _t.x * lx + _b.x * ly + _n.x * ct; dy = _t.y * lx + _b.y * ly + _n.y * ct; dz = _t.z * lx + _b.z * ly + _n.z * ct
      if (E.rad > 0.001) { const r = E.rad * Math.sqrt(rnd()), ps = rnd() * 6.2831853, cx = Math.cos(ps) * r, cy = Math.sin(ps) * r; ox = _t.x * cx + _b.x * cy; oy = _t.y * cx + _b.y * cy; oz = _t.z * cx + _b.z * cy }
    } else if (sh === 1 || sh === 2) {
      const zz = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - zz * zz)
      dx = Math.cos(ph) * s; dy = Math.sin(ph) * s; dz = zz
      if (sh === 2 && dx * _n.x + dy * _n.y + dz * _n.z < 0) { dx = -dx; dy = -dy; dz = -dz }
      const r = E.rad * Math.cbrt(rnd())
      ox = dx * r; oy = dy * r; oz = dz * r
    } else if (sh === 3 || sh === 4) {
      const ps = rnd() * 6.2831853, r = E.rad * Math.sqrt(rnd()), cx = Math.cos(ps), cy = Math.sin(ps)
      const rx = _t.x * cx + _b.x * cy, ry = _t.y * cx + _b.y * cy, rz = _t.z * cx + _b.z * cy
      ox = rx * r; oy = ry * r; oz = rz * r
      if (sh === 3) { dx = rx; dy = ry; dz = rz } else { dx = _n.x; dy = _n.y; dz = _n.z }
    } else { dx = _n.x; dy = _n.y; dz = _n.z }
    const sp = rr(E.sp0, E.sp1) * scale
    const P = pool
    P.px[i] = x + (ox + E.offx) * scale + _n.x * E.offA * scale
    P.py[i] = y + (oy + E.offy) * scale + _n.y * E.offA * scale
    P.pz[i] = z + (oz + E.offz) * scale + _n.z * E.offA * scale
    P.vx[i] = dx * sp; P.vy[i] = dy * sp; P.vz[i] = dz * sp
    P.life[i] = rr(E.life0, E.life1) * lifeMul
    P.age[i] = -E.delay
    P.size[i] = rr(E.sz0, E.sz1) * scale * sizeMul
    P.s0[i] = E.se0; P.s1[i] = se1
    P.rot[i] = E.rot > 0 ? rnd() * E.rot : 0
    P.spin[i] = E.spin > 0 ? rr(-E.spin, E.spin) : 0
    P.grav[i] = E.grav * scale; P.drag[i] = E.drag; P.noise[i] = E.noise * scale; P.ph[i] = rnd() * 100
    const m = rnd()
    if (hasTint && E.tint === 1) {
      const k = E.tintK, w = m * 0.12
      P.r[i] = (tint[0] + (1 - tint[0]) * w) * k; P.g[i] = (tint[1] + (1 - tint[1]) * w) * k; P.b[i] = (tint[2] + (1 - tint[2]) * w) * k
      P.a[i] = E.cA[3]
    } else if (hasTint && E.tint === 2 && m < 0.6) {
      const k = E.tintK
      P.r[i] = tint[0] * k; P.g[i] = tint[1] * k; P.b[i] = tint[2] * k; P.a[i] = E.cA[3]
    } else {
      const A = E.cA, B = E.cB
      P.r[i] = A[0] + (B[0] - A[0]) * m; P.g[i] = A[1] + (B[1] - A[1]) * m; P.b[i] = A[2] + (B[2] - A[2]) * m; P.a[i] = A[3] + (B[3] - A[3]) * m
    }
    P.cell[i] = E.cellAlt >= 0 && rnd() < 0.5 ? E.cellAlt : E.cell
    P.mode[i] = E.mode
    P.stretch[i] = E.st; P.slen[i] = E.sl
    P.fade[i] = E.fade
    P.add[i] = E.add
    P.floor[i] = E.col ? floorY : -1e9
    if (E.mode === 2) { if (E.flat === 1) { P.ax[i] = 0; P.ay[i] = 1; P.az[i] = 0 } else { P.ax[i] = _n.x; P.ay[i] = _n.y; P.az[i] = _n.z } }
    else if (E.fixed) {
      P.ax[i] = _n.x; P.ay[i] = _n.y; P.az[i] = _n.z
      // a fixed segment is centred on its spawn point (Unity stretched billboard): move the head forward by half its length
      const half = P.size[i] * E.sl * 0.5
      P.px[i] += _n.x * half; P.py[i] += _n.y * half; P.pz[i] += _n.z * half
      P.beh[i] = 3
    }
    return i
  }

  // ------------------------------------------------------------------ timed emitters (rate over a duration)
  const EM_CAP = 48
  const ems = []
  for (let i = 0; i < EM_CAP; i++) ems.push({ live: false, E: null, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, t: 0, dur: 0, acc: 0, rate: 0, scale: 1, sizeMul: 1, se1: 1, tint: false, tr: 1, tg: 1, tb: 1, floor: 0, lifeMul: 1 })
  function startEmitter(E, x, y, z, scale, sizeMul, se1, hasTint, floorY, durMul, mul) {
    let slot = null
    for (let i = 0; i < EM_CAP; i++) if (!ems[i].live) { slot = ems[i]; break }
    if (!slot) return
    slot.live = true; slot.E = E; slot.x = x; slot.y = y; slot.z = z; slot.nx = _n.x; slot.ny = _n.y; slot.nz = _n.z
    slot.t = 0; slot.dur = E.dur * durMul; slot.acc = rnd(); slot.rate = E.rate * mul * (lite() ? 0.34 : 1)
    slot.scale = scale; slot.sizeMul = sizeMul; slot.se1 = se1; slot.tint = hasTint; slot.tr = tint[0]; slot.tg = tint[1]; slot.tb = tint[2]
    slot.floor = floorY
  }
  function tickEmitters(dt) {
    for (let i = 0; i < EM_CAP; i++) {
      const m = ems[i]
      if (!m.live) continue
      m.t += dt
      if (m.t >= m.dur) { m.live = false; continue }
      m.acc += m.rate * dt
      if (m.acc < 1) continue
      basis(m.nx, m.ny, m.nz)
      if (m.tint) { tint[0] = m.tr; tint[1] = m.tg; tint[2] = m.tb }
      const pool = m.E.add ? pAdd : pAlpha
      while (m.acc >= 1) {
        m.acc -= 1
        if (pool.n < pool.cap * 0.9) spawn(m.E, m.x, m.y, m.z, m.scale, m.sizeMul, m.se1, m.tint, m.floor, 1)
      }
    }
  }

  // ------------------------------------------------------------------ lights (a small pool, world-space distances scale with G.S)
  const lights = []
  const LIGHT_N = 3
  // built at create time (before world/enemies warm their materials) so the lit-shader light count never changes later
  function buildLights() {
    if (lite()) return
    for (let i = 0; i < LIGHT_N; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1 * S, 2)
      l.name = 'FX_Light' + i
      l.castShadow = false
      root.add(l)
      lights.push({ l, level: 0, fade: 10, base: 0 })
    }
  }
  const _lc = [1, 1, 1]
  function colourInto(c, out) {
    if (c === undefined || c === null) { out[0] = out[1] = out[2] = 1; return out }
    if (typeof c === 'number') { out[0] = toLin(((c >> 16) & 255) / 255); out[1] = toLin(((c >> 8) & 255) / 255); out[2] = toLin((c & 255) / 255) }
    else if (c.isColor) { out[0] = c.r; out[1] = c.g; out[2] = c.b }
    else { const m = Math.max(c[0], c[1], c[2], 1e-4), k = m > 1 ? 1 / m : 1; out[0] = toLin(c[0] * k); out[1] = toLin(c[1] * k); out[2] = toLin(c[2] * k) }
    return out
  }
  function lightLin(x, y, z, cr, cg, cb, intensity, range, life) {
    if (!lights.length || !(intensity > 0) || !(life > 0)) return
    const c = G.cam && G.cam.pos
    if (c) { const dx = x - c.x, dy = y - c.y, dz = z - c.z; if (dx * dx + dy * dy + dz * dz > 55 * 55) return }
    const base = intensity * Math.PI * S * S
    let best = null, bestI = Infinity
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i], cur = L.level > 0 ? L.base * L.level * L.level : 0
      if (cur < bestI) { bestI = cur; best = L }
    }
    if (!best || bestI > base) return
    best.level = 1; best.fade = 1 / life; best.base = base
    best.l.color.setRGB(cr, cg, cb, THREE.LinearSRGBColorSpace)
    best.l.distance = range * S
    best.l.position.set(x, y, z)
    best.l.intensity = base
  }
  function tickLights(dt) {
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i]
      if (L.level <= 0) continue
      L.level = Math.max(0, L.level - dt * L.fade)
      L.l.intensity = L.base * L.level * L.level
    }
  }

  // ------------------------------------------------------------------ bursts
  fx.burst = (kind, pos, opts) => {
    if (!ready || !pos) return
    const o = opts || EMPTY
    if (kind === 'shell' || kind === 'shellCasing' || kind === 'casing') { fx.shell(pos, o.dir || o.normal, o); return }
    let K = resolveKind(kind)
    if (!K) return
    if (K === MUZZLE_KIND) { fx.muzzle(pos, o.dir || o.normal || UPV, kind, o); return }
    if (o.energy && K.energyKind) K = K.energyKind // barricade tier 3: the energy-field variant
    // opts.scale: sizes, speeds and radii; small bugs (enemies pass 0.6-1) shrink only by the square root so they still read
    const scale = o.scale > 0 ? (o.scale < 1 ? Math.sqrt(o.scale) : o.scale) : 1
    const nrm = o.normal || o.dir
    const hasTint = readTint(o)
    const cmul = (o.count > 0 ? o.count : 1) * (scale > 1 ? Math.min(2, Math.sqrt(scale)) : 1) * distMul(pos.x, pos.y, pos.z)
    const secMul = o.seconds > 0 ? o.seconds / 4.5 : 1
    let floorY = -1e9
    if (K.collide && G.world && G.world.groundY) { try { floorY = G.world.groundY(pos.x, pos.z, pos.y + 0.5) } catch (e) { floorY = -1e9 } }
    for (let j = 0; j < K.e.length; j++) {
      const E = K.e[j]
      if (E.up) basis(0, 1, 0)
      else if (nrm) basis(nrm.x, nrm.y, nrm.z)
      else basis(0, 1, 0)
      let sizeMul = 1, se1 = E.se1
      if (E.ringR && o.radius > 0) sizeMul = (2 * o.radius / 0.82) / (((E.sz0 + E.sz1) * 0.5) * E.se1 * scale)
      if (E.ringU && o.radius > 0) se1 = o.radius
      const lifeMul = E.sec ? secMul : 1
      const pool = E.add ? pAdd : pAlpha
      const n = countFor(E.n, pool, cmul)
      for (let k = 0; k < n; k++) if (spawn(E, pos.x, pos.y, pos.z, scale, sizeMul, se1, hasTint, floorY, lifeMul) < 0) break
      if (E.rate > 0) startEmitter(E, pos.x, pos.y, pos.z, scale, sizeMul, se1, hasTint, floorY, E.sec ? secMul : 1, cmul)
    }
    const L = K.light
    if (L) {
      if (hasTint && K.name === 'bossDeath') lightLin(pos.x, pos.y + 0.3, pos.z, tint[0], tint[1], tint[2], L.i * Math.min(2, scale), L.r * scale, 1 / L.fade)
      else lightLin(pos.x, pos.y + 0.3, pos.z, L.c[0], L.c[1], L.c[2], L.i * Math.min(2, scale), L.r * Math.max(1, Math.min(2, scale)), 1 / L.fade)
    }
  }

  // ------------------------------------------------------------------ muzzle flashes
  fx.muzzle = (pos, dir, kind, opts) => {
    if (!ready || !pos) return
    const M = resolveFrom(muzzles, MUZZLE_ALIASES, kind, 'ar', muzzleCache)
    if (!M) return
    const o = opts || EMPTY
    const s = M.size * (o.scale > 0 ? o.scale : 1)
    const d = dir || UPV
    basis(d.x, d.y, d.z)
    const x = pos.x, y = pos.y, z = pos.z
    // front: the star flash, facing the camera
    let i = pAdd.alloc()
    if (i >= 0) setSprite(pAdd, i, x + _n.x * s * 0.15, y + _n.y * s * 0.15, z + _n.z * s * 0.15, rr(0.9, 1.2) * s, rr(0.04, 0.06), CELL.flash, M.cA, M.cB, rnd() * 6.283, 3)
    // a hot core glow so the flash reads at any angle
    i = pAdd.alloc()
    if (i >= 0) setSprite(pAdd, i, x, y, z, s * 1.5, 0.05, CELL.glow, M.cGlow, M.cGlow, 0, 2)
    // side: the flame cone along the barrel
    i = pAdd.alloc()
    if (i >= 0) {
      const len = s * rr(1.3, 1.6), w = s * rr(0.62, 0.78)
      setSprite(pAdd, i, x + _n.x * (len + s * 0.05), y + _n.y * (len + s * 0.05), z + _n.z * (len + s * 0.05), w, rr(0.04, 0.05), CELL.cone, M.cCone, M.cCone, 0, 3)
      pAdd.mode[i] = 1; pAdd.beh[i] = 3; pAdd.ax[i] = _n.x; pAdd.ay[i] = _n.y; pAdd.az[i] = _n.z; pAdd.slen[i] = len / w
    }
    // sparks
    const ns = countFor(6, pAdd, 1)
    for (let k = 0; k < ns; k++) {
      i = pAdd.alloc()
      if (i < 0) break
      const ct = 1 - rnd() * (1 - Math.cos(14 * DEG)), st = Math.sqrt(1 - ct * ct), ph = rnd() * 6.283
      const lx = Math.cos(ph) * st, ly = Math.sin(ph) * st, sp = rr(8, 18)
      setSprite(pAdd, i, x, y, z, rr(0.01, 0.025), rr(0.05, 0.15), CELL.dot, M.cSpark, WHITE_L, 0, 0)
      pAdd.vx[i] = (_t.x * lx + _b.x * ly + _n.x * ct) * sp; pAdd.vy[i] = (_t.y * lx + _b.y * ly + _n.y * ct) * sp; pAdd.vz[i] = (_t.z * lx + _b.z * ly + _n.z * ct) * sp
      pAdd.mode[i] = 1; pAdd.stretch[i] = 0.02; pAdd.beh[i] = 0
    }
    if (M.smoke) {
      const nm = countFor(2, pAlpha, 1)
      for (let k = 0; k < nm; k++) {
        i = pAlpha.alloc()
        if (i < 0) break
        setSprite(pAlpha, i, x + _n.x * s * 0.3, y + _n.y * s * 0.3, z + _n.z * s * 0.3, rr(0.15, 0.3), rr(0.4, 0.8), rnd() < 0.5 ? CELL.smoke : CELL.smoke2, smokeA, smokeB, rnd() * 6.283, 0)
        const sp = rr(0.5, 1.5), ct = 1 - rnd() * (1 - Math.cos(20 * DEG)), st = Math.sqrt(1 - ct * ct), ph = rnd() * 6.283
        const lx = Math.cos(ph) * st, ly = Math.sin(ph) * st
        pAlpha.vx[i] = (_t.x * lx + _b.x * ly + _n.x * ct) * sp; pAlpha.vy[i] = (_t.y * lx + _b.y * ly + _n.y * ct) * sp + 0.2; pAlpha.vz[i] = (_t.z * lx + _b.z * ly + _n.z * ct) * sp
        pAlpha.a[i] = rr(0.2, 0.3); pAlpha.add[i] = 0; pAlpha.s0[i] = 0.5; pAlpha.s1[i] = 2; pAlpha.drag[i] = 3; pAlpha.spin[i] = rr(-0.6, 0.6)
      }
    }
    if (o.light === true || (o.light !== false && !M.turret)) lightLin(x, y, z, M.light.c[0], M.light.c[1], M.light.c[2], M.light.i, M.light.r, M.light.life)
  }
  /** fill a pool slot as a simple sprite (beh 0, no motion unless set after) */
  function setSprite(P, i, x, y, z, size, life, cell, cA, cB, rot, fade) {
    const m = rnd()
    P.px[i] = x; P.py[i] = y; P.pz[i] = z
    P.size[i] = size; P.life[i] = life; P.cell[i] = cell; P.rot[i] = rot; P.fade[i] = fade
    P.r[i] = cA[0] + (cB[0] - cA[0]) * m; P.g[i] = cA[1] + (cB[1] - cA[1]) * m; P.b[i] = cA[2] + (cB[2] - cA[2]) * m; P.a[i] = cA[3] + (cB[3] - cA[3]) * m
    P.add[i] = P === pAdd ? 1 : 0
  }

  // ------------------------------------------------------------------ tracers and beams
  fx.tracer = (from, to, kind) => {
    if (!ready || !from || !to) return
    const T = resolveFrom(tracers, TRACER_ALIASES, kind, 'bullet', tracerCache)
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
    const D = Math.hypot(dx, dy, dz)
    if (D < 0.05) return
    const i = pAdd.alloc()
    if (i < 0) return
    const P = pAdd
    P.ox[i] = from.x; P.oy[i] = from.y; P.oz[i] = from.z
    P.ax[i] = dx / D; P.ay[i] = dy / D; P.az[i] = dz / D
    P.px[i] = from.x; P.py[i] = from.y; P.pz[i] = from.z
    P.dist[i] = D; P.tlen[i] = T.len; P.trav[i] = 0; P.vx[i] = T.speed
    P.size[i] = T.w; P.life[i] = 10; P.mode[i] = 1; P.beh[i] = 1; P.cell[i] = CELL.beam; P.tail[i] = 0.25
    P.r[i] = T.lc[0]; P.g[i] = T.lc[1]; P.b[i] = T.lc[2]; P.a[i] = 1
  }
  fx.beam = (from, to, kind, life) => {
    if (!ready || !from || !to) return
    const B = resolveFrom(beams, BEAM_ALIASES, kind, 'rail', beamCache)
    const L = life > 0 ? life : B.life
    for (let pass = 0; pass < 2; pass++) {
      const i = pAdd.alloc()
      if (i < 0) return
      const P = pAdd
      P.ox[i] = from.x; P.oy[i] = from.y; P.oz[i] = from.z
      P.px[i] = to.x; P.py[i] = to.y; P.pz[i] = to.z
      P.size[i] = pass === 0 ? B.w : B.w * 3.2; P.life[i] = L; P.mode[i] = 1; P.beh[i] = 2; P.cell[i] = CELL.beam; P.tail[i] = 1
      const c = pass === 0 ? B.lc : B.glow, a = pass === 0 ? 1 : 0.55
      P.r[i] = c[0]; P.g[i] = c[1]; P.b[i] = c[2]; P.a[i] = a
    }
    // end flares
    for (let e = 0; e < 2; e++) {
      const i = pAdd.alloc()
      if (i < 0) return
      const p = e === 0 ? from : to
      setSprite(pAdd, i, p.x, p.y, p.z, B.w * (e === 0 ? 7 : 9), L * 1.4, CELL.glow, B.glow, B.glow, 0, 2)
    }
    // a few motes left hanging along a rail shot
    if (B === beams.rail && !lite()) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
      const D = Math.hypot(dx, dy, dz), n = Math.min(14, Math.floor(D / 2.5))
      for (let k = 0; k < n; k++) {
        const i = pAdd.alloc()
        if (i < 0) break
        const t = rnd()
        setSprite(pAdd, i, from.x + dx * t, from.y + dy * t, from.z + dz * t, rr(0.03, 0.06), rr(0.25, 0.5), CELL.dot, B.glow, WHITE_L, 0, 0)
        pAdd.vx[i] = rr(-0.3, 0.3); pAdd.vy[i] = rr(0, 0.5); pAdd.vz[i] = rr(-0.3, 0.3); pAdd.drag[i] = 2
      }
    }
  }

  // ------------------------------------------------------------------ light API
  buildLights()

  fx.light = (pos, colour, intensity = 3, range = 4, life = 0.1) => {
    if (!ready || !pos) return
    colourInto(colour, _lc)
    lightLin(pos.x, pos.y, pos.z, _lc[0], _lc[1], _lc[2], intensity, range, life)
  }
  fx.shake = amount => { if (G.shake && amount > 0) G.shake(amount) }

  // ------------------------------------------------------------------ decals (pooled flat quads, ground-fitted, fading)
  const DECAL_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iNrm;
attribute vec4 iMisc; // size, rotation, cell, alpha
varying vec2 vUv;
varying vec2 vCell;
varying float vAlpha;
varying float vFogDepth;
void main() {
  vec3 n = normalize(iNrm);
  vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float cr = cos(iMisc.y), sr = sin(iMisc.y);
  vec2 c = position.xy;
  vec2 r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * iMisc.x;
  vec4 mv = modelViewMatrix * vec4(iPos + t * r.x + b * r.y, 1.0);
  float cell = floor(iMisc.z + 0.5);
  vUv = c + 0.5; vCell = vec2(mod(cell, 4.0), floor(cell / 4.0)) * vec2(0.25, 0.5); vAlpha = iMisc.w; vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
  const DECAL_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uLight;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec2 vCell;
varying float vAlpha;
varying float vFogDepth;
void main() {
  vec4 t = texture2D(uMap, vCell + (0.01 + vUv * 0.98) * vec2(0.25, 0.5));
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = t.rgb * uLight;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, fogColor, fogF);
  #endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
  let decalCap = 0, decalN = 0, decalMesh = null, dPos = null, dNrm = null, dMisc = null
  let smallCap = 0, nextSmall = 0, nextBig = 0 // slots [0, smallCap) take bullet holes, the rest everything bigger
  let D = null // structure of arrays
  function buildDecals() {
    decalCap = lite() ? 40 : 64
    smallCap = lite() ? 14 : 22
    nextBig = smallCap
    D = {}
    for (const f of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'size', 'rot', 'cell', 'age', 'life', 'fadeIn', 'grow', 'live']) D[f] = new Float32Array(decalCap)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const mk = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(decalCap * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a }
    dPos = mk('iPos', 3); dNrm = mk('iNrm', 3); dMisc = mk('iMisc', 4)
    g.instanceCount = 0
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uLight: { value: 0.85 } }]),
      vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    })
    m.uniforms.uMap.value = decalAtlas(lite())
    m.name = 'FX_Decals'
    decalMesh = new THREE.Mesh(g, m)
    decalMesh.name = 'FX_Decals'
    decalMesh.frustumCulled = false
    decalMesh.renderOrder = 20
    decalMesh.matrixAutoUpdate = false
    root.add(decalMesh)
  }
  const decalCache = new Map()
  function resolveDecal(kind) {
    let d = decalCache.get(kind)
    if (d !== undefined) return d
    const n = norm(kind)
    const key = Object.keys(DECALS).find(k => norm(k) === n) || (/hole|bullet/.test(n) ? 'bulletHole' : /large|big|grenade|siege/.test(n) ? 'scorchLarge' : /plasma/.test(n) ? 'plasmaScorch' : /scorch|burn/.test(n) ? 'scorch' : /goo|blood|bug/.test(n) ? 'goo' : /acid|spit/.test(n) ? 'acid' : /crack/.test(n) ? 'crack' : null)
    if (!key) { warnOnce('decal ' + kind); d = null } else { const def = DECALS[key]; d = { size: def.size, life: def.life, cell: DECAL_CELL[def.cell || key], grow: key === 'goo' || key === 'acid', slowIn: key === 'crack' } }
    decalCache.set(kind, d)
    return d
  }
  fx.decal = (pos, normal, kind, opts) => {
    if (!ready || !pos || !decalMesh) return
    const K = resolveDecal(kind || 'bulletHole')
    if (!K) return
    const o = opts || EMPTY
    const size = o.scale > 0 ? o.scale : o.size > 0 ? o.size : K.size
    let x = pos.x, y = pos.y, z = pos.z, nx = 0, ny = 1, nz = 0
    if (normal) { const l = Math.hypot(normal.x, normal.y, normal.z); if (l > 1e-5) { nx = normal.x / l; ny = normal.y / l; nz = normal.z / l } }
    const w = G.world
    if (ny > 0.7 && w && w.groundY) {
      // ground decal: snap to the floor (none if the floor is far below, e.g. a flyer dying in the air) and fit the slope
      try {
        const gy = w.groundY(x, z, y + 0.6)
        if (y - gy > 1.3 || gy - y > 1.2) return
        y = gy
        if (size > 0.7) {
          const r = Math.min(1.2, size * 0.35)
          const h1 = w.groundY(x + r, z, y + 0.6 + r) - gy, h2 = w.groundY(x, z + r, y + 0.6 + r) - gy
          if (Math.abs(h1) < r * 1.2 && Math.abs(h2) < r * 1.2) { nx = -h1 / r; ny = 1; nz = -h2 / r; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l } else { nx = 0; ny = 1; nz = 0 }
        }
      } catch (e) { /* no floor query: keep as given */ }
    }
    const lift = size > 1 ? 0.03 : 0.012
    // a free slot from the ring position on, else the ring position (the oldest spawned); small and big decals have
    // separate rings so a burst of bullet holes never wipes the goo of the last kills
    const small = size < 0.3
    const lo = small ? 0 : smallCap, n = small ? smallCap : decalCap - smallCap, start = small ? nextSmall : nextBig
    let i = start
    for (let k = 0; k < n; k++) { const j = lo + ((start - lo + k) % n); if (!D.live[j]) { i = j; break } }
    if (small) nextSmall = lo + ((i - lo + 1) % n); else nextBig = lo + ((i - lo + 1) % n)
    if (!D.live[i]) decalN++
    D.live[i] = 1
    D.x[i] = x + nx * lift; D.y[i] = y + ny * lift; D.z[i] = z + nz * lift; D.nx[i] = nx; D.ny[i] = ny; D.nz[i] = nz
    D.size[i] = size; D.rot[i] = o.rot !== undefined ? o.rot * DEG : rnd() * 6.2831853; D.cell[i] = K.cell
    D.age[i] = 0; D.life[i] = o.life > 0 ? o.life : K.life; D.fadeIn[i] = K.slowIn ? 0.35 : 0.08; D.grow[i] = K.grow ? 1 : 0
  }
  function tickDecals(dt) {
    if (!decalMesh) return
    const P = dPos.array, N = dNrm.array, M = dMisc.array
    let n = 0
    for (let i = 0; i < decalCap; i++) {
      if (!D.live[i]) continue
      D.age[i] += dt
      const a = D.age[i], L = D.life[i]
      if (a >= L) { D.live[i] = 0; decalN--; continue }
      const out = Math.min(2, L * 0.3)
      let al = Math.min(1, a / D.fadeIn[i])
      if (a > L - out) al *= (L - a) / out
      let s = D.size[i]
      if (D.grow[i]) { const k = Math.min(1, a / 0.18); s *= 0.55 + 0.45 * (1 - (1 - k) * (1 - k)) }
      const o3 = n * 3, o4 = n * 4
      P[o3] = D.x[i]; P[o3 + 1] = D.y[i]; P[o3 + 2] = D.z[i]
      N[o3] = D.nx[i]; N[o3 + 1] = D.ny[i]; N[o3 + 2] = D.nz[i]
      M[o4] = s; M[o4 + 1] = D.rot[i]; M[o4 + 2] = D.cell[i]; M[o4 + 3] = al
      n++
    }
    decalMesh.geometry.instanceCount = n
    decalMesh.visible = n > 0
    if (n > 0) for (let k = 0; k < decalAttrs.length; k++) { const at = decalAttrs[k]; at.clearUpdateRanges(); at.addUpdateRange(0, n * at.itemSize); at.needsUpdate = true }
  }
  let decalAttrs = []

  // ------------------------------------------------------------------ damage numbers (screen-sized billboards from a glyph atlas)
  const NUM_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iGlyph; // x offset (em), glyph cell, scale, unused
attribute vec4 iCol;
uniform float uS;
uniform float uAspect;
uniform float uEm;       // NDC height of 1 em at scale 1 (34 px on a 1080 reference)
uniform float uCellW;    // glyph cell width in em
uniform float uCellH;    // glyph cell height in em
uniform float uCols;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float depth = max(1.0, -mv.z / uS);
  float ds = clamp(12.0 / depth, 0.55, 1.3);
  vec4 clip = projectionMatrix * mv;
  float em = uEm * iGlyph.z * ds;
  vec2 c = position.xy;
  vec2 off = vec2((iGlyph.x + c.x * uCellW) * em / uAspect, c.y * uCellH * em);
  if (clip.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
  else { clip.xy += off * clip.w; clip.z = -clip.w * 0.999; gl_Position = clip; }
  vUv = vec2((iGlyph.y + c.x + 0.5) / uCols, 0.5 - c.y);
  vCol = iCol;
}
`
  const NUM_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol.rgb * t.r, a);
}
`
  const NUM_CAP = 64, GLYPH_MAX = 6
  let numMesh = null, nPos = null, nGlyph = null, nCol = null, glyphs = null, numNext = 0
  const NUM = []
  for (let i = 0; i < NUM_CAP; i++) NUM.push({ live: false, x: 0, y: 0, z: 0, age: 0, r: 1, g: 1, b: 1, a: 1, scale: 1, len: 0, idx: new Uint8Array(GLYPH_MAX), off: new Float32Array(GLYPH_MAX) })
  const STYLES = {
    normal: { c: [1, 1, 1, 1], s: 1 }, weak: { c: [1, 0.83, 0.2, 1], s: 1.45, bang: true }, kill: { c: [1, 0.42, 0.2, 1], s: 1.2 },
    turret: { c: [0.75, 0.85, 1, 0.85], s: 0.72 }, player: { c: [1, 1, 1, 1], s: 1 },
  }
  async function loadFont() {
    try {
      const set = (typeof self !== 'undefined' && self.fonts) || null
      if (typeof FontFace === 'undefined' || !set || typeof fetch === 'undefined') return false
      const buf = await fontBuffer(p => (G.p0 && G.p0.asset ? G.p0.asset(p) : p), 'Rajdhani-Bold')
      const face = new FontFace('FX Rajdhani', buf, { weight: '700', style: 'normal' })
      await face.load()
      set.add(face)
      return true
    } catch (e) { G.log?.('fx: damage-number font unavailable, using sans-serif'); return false }
  }
  function buildNumbers() {
    glyphs = glyphAtlas('"FX Rajdhani", "HA Rajdhani", "Rajdhani", sans-serif')
    if (!glyphs) { G.log?.('fx: no OffscreenCanvas, damage numbers off'); return }
    const cap = NUM_CAP * GLYPH_MAX
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const mk = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a }
    nPos = mk('iPos', 3); nGlyph = mk('iGlyph', 4); nCol = mk('iCol', 4)
    g.instanceCount = 0
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: glyphs.texture }, uS: { value: S }, uAspect: { value: 16 / 9 }, uEm: { value: 34 / 540 },
        uCellW: { value: glyphs.cellEm * glyphs.cellAspect }, uCellH: { value: glyphs.cellEm }, uCols: { value: glyphs.cols },
      },
      vertexShader: NUM_VERT, fragmentShader: NUM_FRAG, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    })
    m.name = 'FX_Numbers'
    numMesh = new THREE.Mesh(g, m)
    numMesh.name = 'FX_Numbers'
    numMesh.frustumCulled = false
    numMesh.renderOrder = 8000 // above the world, below the HUD quad (9000)
    numMesh.matrixAutoUpdate = false
    root.add(numMesh)
  }
  fx.number = (pos, value, style) => {
    if (!ready || !pos || !numMesh) return
    const st = STYLES[style] || STYLES.normal
    let v = Math.round(Math.abs(Number(value) || 0))
    const R = NUM[numNext]
    numNext = (numNext + 1) % NUM_CAP
    // digits right to left, then reverse; '!' for weak points
    let len = 0
    const idx = R.idx
    do { idx[len++] = v % 10; v = Math.floor(v / 10) } while (v > 0 && len < GLYPH_MAX - 1)
    for (let a = 0, b = len - 1; a < b; a++, b--) { const t = idx[a]; idx[a] = idx[b]; idx[b] = t }
    if (st.bang) idx[len++] = 10
    R.len = len
    let w = 0
    for (let k = 0; k < len; k++) w += glyphs.advance[idx[k]] - 0.02
    let x = -w / 2
    for (let k = 0; k < len; k++) { const ad = glyphs.advance[idx[k]] - 0.02; R.off[k] = x + ad / 2; x += ad }
    // hitPoint + 0.25 up + a 0.25 m random offset (inside a sphere)
    let ox, oy, oz
    do { ox = rnd() * 2 - 1; oy = rnd() * 2 - 1; oz = rnd() * 2 - 1 } while (ox * ox + oy * oy + oz * oz > 1)
    R.x = pos.x + ox * 0.25; R.y = pos.y + 0.25 + oy * 0.25; R.z = pos.z + oz * 0.25
    R.age = 0; R.live = true
    R.r = st.c[0]; R.g = st.c[1]; R.b = st.c[2]; R.a = st.c[3]; R.scale = st.s
  }
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) }
  function tickNumbers(rdt) {
    if (!numMesh) return
    const P = nPos.array, Gl = nGlyph.array, C = nCol.array
    let n = 0
    for (let j = 0; j < NUM_CAP; j++) {
      // oldest first so the newest draws on top
      const R = NUM[(numNext + j) % NUM_CAP]
      if (!R.live) continue
      R.age += rdt
      if (R.age >= 0.85) { R.live = false; continue }
      const k = R.age / 0.85
      const y = R.y + k * 1.1
      const pop = 1.7 + (1 - 1.7) * easeOutBack(Math.min(1, R.age / 0.14))
      const s = pop * R.scale
      const al = R.a * Math.min(1, (1 - k) / 0.35)
      for (let g = 0; g < R.len; g++) {
        const o3 = n * 3, o4 = n * 4
        P[o3] = R.x; P[o3 + 1] = y; P[o3 + 2] = R.z
        Gl[o4] = R.off[g]; Gl[o4 + 1] = R.idx[g]; Gl[o4 + 2] = s; Gl[o4 + 3] = 0
        C[o4] = R.r; C[o4 + 1] = R.g; C[o4 + 2] = R.b; C[o4 + 3] = al
        n++
      }
    }
    numMesh.geometry.instanceCount = n
    numMesh.visible = n > 0
    if (n > 0) for (let k = 0; k < numAttrs.length; k++) { const at = numAttrs[k]; at.clearUpdateRanges(); at.addUpdateRange(0, n * at.itemSize); at.needsUpdate = true }
  }
  let numAttrs = []

  // ------------------------------------------------------------------ shell casings (one InstancedMesh, simple bouncing physics)
  let shellMesh = null, shellCap = 0, shellNext = 0
  let SH = null
  const _m4 = new THREE.Matrix4(), _qt = new THREE.Quaternion(), _eu = new THREE.Euler(), _sc = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0)
  async function buildShells() {
    let geo = null, mat = null
    try {
      const gltf = await G.assets.glb('SM_ShellCasing')
      gltf.scene.traverse(o => { if (!geo && o.isMesh) { geo = o.geometry; mat = o.material } })
    } catch (e) { /* no model: a small cylinder */ }
    if (!geo) geo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 8)
    try { const m = G.assets.mat && G.assets.mat('M_Brass'); if (m) mat = m } catch (e) { /* keep the glb material */ }
    if (!mat) mat = new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.3 })
    shellCap = lite() ? 16 : 40
    SH = {}
    for (const f of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'rx', 'ry', 'rz', 'wx', 'wy', 'wz', 'age', 'floor', 'tink', 'live']) SH[f] = new Float32Array(shellCap)
    shellMesh = new THREE.InstancedMesh(geo, mat, shellCap)
    shellMesh.name = 'FX_Shells'
    shellMesh.frustumCulled = false
    shellMesh.castShadow = false
    shellMesh.receiveShadow = false
    shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < shellCap; i++) shellMesh.setMatrixAt(i, _zero)
    shellMesh.count = 0
    root.add(shellMesh)
  }
  fx.shell = (pos, right, opts) => {
    if (!ready || !pos || !shellMesh) return
    const i = shellNext
    shellNext = (shellNext + 1) % shellCap
    let rx = 1, ry = 0, rz = 0
    if (right) { const l = Math.hypot(right.x, right.y, right.z); if (l > 1e-5) { rx = right.x / l; ry = right.y / l; rz = right.z / l } }
    const a = rr(2.2, 3.2), u = rr(1.2, 2)
    SH.x[i] = pos.x; SH.y[i] = pos.y; SH.z[i] = pos.z
    SH.vx[i] = rx * a; SH.vy[i] = ry * a + u; SH.vz[i] = rz * a
    const o = opts || EMPTY
    if (o.vel) { SH.vx[i] += o.vel.x; SH.vy[i] += o.vel.y; SH.vz[i] += o.vel.z }
    SH.rx[i] = rnd() * 6.28; SH.ry[i] = rnd() * 6.28; SH.rz[i] = rnd() * 6.28
    SH.wx[i] = rr(-25, 25); SH.wy[i] = rr(-25, 25); SH.wz[i] = rr(-25, 25)
    SH.age[i] = 0; SH.tink[i] = 0; SH.live[i] = 1
    let f = pos.y - 1.6
    if (G.world && G.world.groundY) { try { f = G.world.groundY(pos.x, pos.z, pos.y + 0.2) } catch (e) { /* keep */ } }
    SH.floor[i] = f + 0.006
  }
  function tickShells(dt) {
    if (!shellMesh) return
    let any = 0, hi = 0, died = false
    for (let i = 0; i < shellCap; i++) {
      if (!SH.live[i]) continue
      SH.age[i] += dt
      if (SH.age[i] >= 2.5) { SH.live[i] = 0; shellMesh.setMatrixAt(i, _zero); died = true; continue }
      SH.vy[i] -= G9 * dt
      const damp = Math.exp(-0.1 * dt)
      SH.vx[i] *= damp; SH.vy[i] *= damp; SH.vz[i] *= damp
      SH.x[i] += SH.vx[i] * dt; SH.y[i] += SH.vy[i] * dt; SH.z[i] += SH.vz[i] * dt
      if (SH.y[i] < SH.floor[i]) {
        SH.y[i] = SH.floor[i]
        if (SH.vy[i] < 0) {
          if (!SH.tink[i]) { SH.tink[i] = 1; if (G.sfx) { _p.set(SH.x[i], SH.y[i], SH.z[i]); tinkOpts.pos = _p; tinkOpts.rate = rr(0.85, 1.15); G.sfx(SHELL_SFX[(rnd() * 3) | 0], tinkOpts) } }
          SH.vy[i] = -SH.vy[i] * 0.3; SH.vx[i] *= 0.55; SH.vz[i] *= 0.55; SH.wx[i] *= 0.5; SH.wy[i] *= 0.5; SH.wz[i] *= 0.5
          if (SH.vy[i] < 0.35) { SH.vy[i] = 0; SH.vx[i] *= 0.7; SH.vz[i] *= 0.7; SH.wx[i] *= 0.6; SH.wz[i] *= 0.6 }
        }
      }
      SH.rx[i] += SH.wx[i] * dt; SH.ry[i] += SH.wy[i] * dt; SH.rz[i] += SH.wz[i] * dt
      const k = SH.age[i] > 2.2 ? (2.5 - SH.age[i]) / 0.3 : 1
      _eu.set(SH.rx[i], SH.ry[i], SH.rz[i])
      _qt.setFromEuler(_eu)
      _p.set(SH.x[i], SH.y[i], SH.z[i])
      _sc.setScalar(k)
      _m4.compose(_p, _qt, _sc)
      shellMesh.setMatrixAt(i, _m4)
      any++
      hi = i + 1
    }
    shellMesh.count = hi
    shellMesh.visible = any > 0
    if (any > 0 || died) shellMesh.instanceMatrix.needsUpdate = true
  }
  const SHELL_SFX = ['sfx_shell_0', 'sfx_shell_1', 'sfx_shell_2']
  const tinkOpts = { pos: null, vol: 0.25, rate: 1 }

  // ------------------------------------------------------------------ lifecycle
  fx.load = async () => {
    const t0 = performance.now()
    buildPools()
    buildDecals()
    decalAttrs = [dPos, dNrm, dMisc]
    await loadFont()
    buildNumbers()
    if (numMesh) numAttrs = [nPos, nGlyph, nCol]
    await buildShells()
    ready = true
    // warm-up: one of each draw on screen for the shader compile pass that main.js runs right after load
    pAlpha.alloc(); pAlpha.size[0] = 0; pAlpha.life[0] = 0.01; pAlpha.a[0] = 0; pAdd.alloc(); pAdd.size[0] = 0; pAdd.life[0] = 0.01; pAdd.a[0] = 0
    pAlpha.update(0); pAdd.update(0)
    pAlpha.mesh.visible = pAdd.mesh.visible = true
    if (decalMesh) decalMesh.visible = true
    if (numMesh) numMesh.visible = true
    if (shellMesh) { shellMesh.visible = true; shellMesh.count = 1 }
    G.log?.(`fx ready in ${(performance.now() - t0).toFixed(0)} ms${lite() ? ' (lite)' : ''}`)
  }
  fx.update = (dt, rdt) => {
    if (!ready) return
    const d = dt || 0, r = rdt === undefined ? d : rdt
    const cam = G.camera
    if (cam && G.renderer) {
      G.renderer.getDrawingBufferSize(_v2)
      pMat.uniforms.uPx.value = cam.projectionMatrix.elements[5] * _v2.y * 0.5
      pMat.uniforms.uMinPx.value = lite() ? 1.1 : 1.4
      if (numMesh) numMesh.material.uniforms.uAspect.value = cam.aspect || 1.7778
    }
    tickEmitters(d)
    pAlpha.update(d)
    pAdd.update(d)
    tickDecals(d)
    tickNumbers(r)
    tickLights(d)
    tickShells(d)
  }
  fx.clear = () => {
    if (!ready) return
    pAlpha.clear(); pAdd.clear()
    for (const m of ems) m.live = false
    if (D) { D.live.fill(0); decalN = 0 }
    for (const R of NUM) R.live = false
    for (const L of lights) { L.level = 0; L.l.intensity = 0 }
    if (SH) { SH.live.fill(0); for (let i = 0; i < shellCap; i++) shellMesh.setMatrixAt(i, _zero); shellMesh.count = 0; shellMesh.instanceMatrix.needsUpdate = true }
  }
  fx.stats = () => {
    let nums = 0
    for (const R of NUM) if (R.live) nums++
    const draws = (pAlpha && pAlpha.n ? 1 : 0) + (pAdd && pAdd.n ? 1 : 0) + (decalMesh && decalMesh.visible ? 1 : 0) + (numMesh && numMesh.visible ? 1 : 0) + (shellMesh && shellMesh.visible ? 1 : 0)
    let lit = 0
    for (const L of lights) if (L.level > 0) lit++
    let shells = 0
    if (SH) for (let i = 0; i < shellCap; i++) if (SH.live[i]) shells++
    return { alpha: pAlpha ? pAlpha.n : 0, additive: pAdd ? pAdd.n : 0, caps: pAlpha ? [pAlpha.cap, pAdd.cap] : null, decals: decalN, numbers: nums, shells, lights: lit, emitters: ems.filter(m => m.live).length, draws }
  }
  fx.kinds = () => [...kinds.keys()]
  return fx
}
