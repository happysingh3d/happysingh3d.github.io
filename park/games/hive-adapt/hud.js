// Hive Adapt (Project 0 port): imperative HUD library.
// Everything is drawn with OffscreenCanvas 2D into small CanvasTextures ("sprites"), one textured quad each, all children of
// `hud.object` (a Group the lead parents to the camera; `hud.fit(camera)` sizes it to fill the view just past the near
// plane). A sprite redraws (and re-uploads its texture) only when its content changes; moves, fades, pops and rotations
// are mesh transforms and material opacity, so they cost nothing on the texture side. Full-screen tints and vignettes are
// plain quads with a tiny generated texture.
// Layout: reference 1920x1080 units, Unity CanvasScaler "match 0.5" (s = sqrt(w/1920 * h/1080)), clamped so 16 units
// is never under 11 css px; a narrow (portrait phone) layout stacks and shrinks the panels.
// Strings, colours, positions and timings follow hive-spec/outpost-turrets-ui.md §7, §9.8, §11, §12 and the Unity UI source.
import { fontBuffer } from './b64.js'
import * as THREE from 'three'

// ------------------------------------------------------------------ palette (sRGB 0-255; UiKit.cs)
const P = {
  text: [242, 237, 227], dim: [184, 199, 212], amber: [255, 181, 71], inter: [255, 176, 0], cyan: [84, 219, 255],
  danger: [255, 74, 46], lime: [184, 255, 61], hive: [255, 92, 51], shield: [158, 204, 255], energy: [115, 158, 255],
  stamina: [245, 214, 128], jam: [184, 92, 255], sample: [199, 153, 255], siege: [255, 97, 66], steel: [214, 224, 235],
  white: [255, 255, 255], vital: [230, 242, 230], gold: [255, 217, 51], black: [0, 0, 0], panel: [5, 7, 11],
}
const DIM_A = 0.9
// Unity blends its UI in linear space, so a plate at alpha a darkens far less than a in sRGB; this gives the same look here
const aS = a => 1 - Math.sqrt(Math.max(0, 1 - a))
const KIND_COL = { success: P.lime, error: P.danger, info: P.text, hive: P.hive, sample: P.sample, dim: P.dim, core: P.cyan, warn: P.amber, siege: P.siege, armor: P.steel }
const STREAKS = [[20, 'Exterminator'], [12, 'Hive hunter'], [8, 'Swarm breaker'], [5, 'Rampage'], [4, 'Multi kill'], [3, 'Triple kill'], [2, 'Double kill']]
const ICONS = ['alert', 'armor', 'arrow', 'barricade', 'biomass', 'check', 'core', 'dodge', 'health', 'repair', 'ring', 'sample', 'shield', 'stamina', 'target', 'timer', 'tower', 'turret', 'wave']
// font vertical metrics (em): ascender, descender, cap height (from the TTFs' hhea / OS2 tables)
const FM = { h: [0.992, 0.308, 0.7], n: [0.93, 0.346, 0.643], b: [0.93, 0.346, 0.643] }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; t = clamp01(t) - 1; return 1 + c3 * t * t * t + c1 * t * t }
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t) }
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const moveTo = (a, b, step) => (Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step)
export const roman = n => (n <= 1 ? '' : ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n))
const fmtInt = n => Math.round(n).toLocaleString('en-US')

/** colour input -> [r,g,b] 0-255: [r,g,b] (0-1 floats or 0-255), THREE.Color, '#rrggbb', or a kind name */
function col(c, fallback = P.text) {
  if (c == null) return fallback
  if (Array.isArray(c)) {
    if (c.length < 3) return fallback
    const f = c[0] <= 1 && c[1] <= 1 && c[2] <= 1
    return f ? [c[0] * 255, c[1] * 255, c[2] * 255] : [c[0], c[1], c[2]]
  }
  if (c.isColor) { const t = {}; c.getRGB(t, THREE.SRGBColorSpace); return [t.r * 255, t.g * 255, t.b * 255] }
  if (typeof c === 'string') {
    if (KIND_COL[c]) return KIND_COL[c]
    if (P[c]) return P[c]
    const m = /^#?([0-9a-f]{6})$/i.exec(c)
    if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }
  }
  return fallback
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

/** a line of text: a string, or segments [[text, colour, alpha?], ...] */
function segs(v, def = P.text) {
  if (v == null) return []
  if (typeof v === 'string' || typeof v === 'number') return [[String(v), def, 1]]
  if (Array.isArray(v)) return v.map(s => (typeof s === 'string' ? [s, def, 1] : [String(s[0]), col(s[1], def), s[2] == null ? (s[1] === 'dim' ? DIM_A : 1) : s[2]]))
  return []
}
const segText = s => s.map(x => x[0]).join('')
// allocation-free comparisons for the models fed every frame
const sameList = (a, b) => { if (a === b) return true; if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
const copyList = (dst, src) => { dst.length = 0; if (src) for (let i = 0; i < src.length; i++) dst.push(src[i]); return dst }
const _ct = [0, 0, 0]
/** writes colour c (any accepted form) into dst as 0-255 */
function colInto(dst, c, fb) {
  if (Array.isArray(c) && c.length >= 3) { const k = c[0] <= 1 && c[1] <= 1 && c[2] <= 1 ? 255 : 1; dst[0] = c[0] * k; dst[1] = c[1] * k; dst[2] = c[2] * k; return dst }
  const r = col(c, fb); dst[0] = r[0]; dst[1] = r[1]; dst[2] = r[2]; return dst
}
/** stores colour c in store; true when it changed */
function colChanged(store, c, fb) {
  colInto(_ct, c, fb)
  if (_ct[0] === store[0] && _ct[1] === store[1] && _ct[2] === store[2]) return false
  store[0] = _ct[0]; store[1] = _ct[1]; store[2] = _ct[2]
  return true
}
const q200 = x => Math.round((x || 0) * 200)
const NO_MARKS = [0.5], NONE = []
// quad colours set every frame (constants: no per-frame arrays)
const C_DMG = [217, 13, 5], C_ALARM = [255, 64, 13], C_DEATH = [26, 0, 0], C_EVO_BG = [8, 2, 2], C_EVO_VIG = [107, 15, 5], C_END_BG = [3, 4, 5], C_PAUSE_BG = [3, 5, 8], C_INK = [5, 5, 5]
// duplex reticle (HudController.Weapons): x, y, w, h on a 980-unit lens
const RETICLE = [[-140, 0, 250, 2], [140, 0, 250, 2], [0, -140, 2, 250], [0, 140, 2, 250], [-375, 0, 200, 7], [375, 0, 200, 7], [0, -375, 7, 200], [0, 375, 7, 200]]

export function createHud(G) {
  const p0 = G.p0
  const hud = {}
  const object = new THREE.Group()
  object.name = 'HUD'
  object.renderOrder = 9000
  hud.object = object
  const geo = new THREE.PlaneGeometry(1, 1)

  // ------------------------------------------------------------------ view and scale
  let Wc = p0.width || 1280, Hc = p0.height || 720, dpr = p0.pixelRatio || 1
  let s = 1, k = 1, Wu = 1920, Hu = 1080
  let fontsOk = false, loaded = false
  const insetsCss = { top: 0, bottom: 0, left: 0, right: 0 }
  const L = {} // layout values (units)

  const measureCv = new OffscreenCanvas(4, 4)
  const mctx = measureCv.getContext('2d')
  const fontCache = new Map()
  function font(kind, size, italic) {
    const key = kind + size + (italic ? 'i' : '')
    let f = fontCache.get(key)
    if (!f) {
      const fam = kind === 'h' ? '"HA Chakra", "Chakra Petch", sans-serif' : '"HA Rajdhani", "Rajdhani", sans-serif'
      f = `${italic ? 'italic ' : ''}${kind === 'b' ? 600 : 700} ${size}px ${fam}`
      fontCache.set(key, f)
    }
    return f
  }
  const twCache = new Map()
  function tw(text, kind, size, sp = 0) {
    const key = kind + size + '|' + text
    let w = twCache.get(key)
    if (w == null) {
      mctx.font = font(kind, size)
      w = mctx.measureText(text).width
      if (twCache.size > 2000) twCache.clear()
      twCache.set(key, w)
    }
    return sp ? w + sp * size / 100 * Math.max(0, text.length - 1) : w
  }
  function segsW(sg, kind, size) { let w = 0; for (const x of sg) w += tw(x[0], kind, size); return w }

  // ------------------------------------------------------------------ assets: fonts, icons, generated textures
  const icons = {}
  const tintCache = new Map()
  function tinted(name, c) {
    const src = icons[name]
    if (!src) return null
    const key = name + '|' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0)
    let t = tintCache.get(key)
    if (!t) {
      t = new OffscreenCanvas(src.width, src.height)
      const x = t.getContext('2d')
      x.drawImage(src, 0, 0)
      x.globalCompositeOperation = 'source-in'
      x.fillStyle = css(c)
      x.fillRect(0, 0, src.width, src.height)
      tintCache.set(key, t)
    }
    return t
  }
  let loading = null
  hud.load = () => {
    if (loading) return loading
    const asset = p => (p0.asset ? p0.asset(p) : p)
    const fonts = (async () => {
      try {
        // the worker's FontFaceSet (a page test bench aliases its own as self.fonts)
        const set = (typeof self !== 'undefined' && self.fonts) || null
        if (typeof FontFace === 'undefined' || !set) return
        const list = [['HA Chakra', 'ChakraPetch-Bold', '700'], ['HA Rajdhani', 'Rajdhani-Bold', '700'], ['HA Rajdhani', 'Rajdhani-SemiBold', '600']]
        await Promise.all(list.map(async ([fam, file, weight]) => {
          const buf = await fontBuffer(asset, file)
          const face = new FontFace(fam, buf, { weight, style: 'normal' })
          await face.load()
          set.add(face)
        }))
        fontsOk = true
      } catch (e) { console.warn('hud: fonts unavailable, using sans-serif', e && e.message) }
    })()
    const pics = Promise.all(ICONS.map(async n => {
      try {
        if (typeof createImageBitmap === 'undefined') return
        const blob = await (await fetch(asset('assets/icons/' + n + '.png'))).blob()
        icons[n] = await createImageBitmap(blob)
      } catch (e) { /* icon missing: drawn as nothing */ }
    }))
    loading = Promise.all([fonts, pics]).then(() => { loaded = true; tintCache.clear(); fontCache.clear(); twCache.clear(); dirtyAll() })
    return loading
  }

  /** radial alpha texture (UiKit.Vignette / Glow) */
  function radialTex(n, fn) {
    const cv = new OffscreenCanvas(n, n), x = cv.getContext('2d'), img = x.createImageData(n, n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1, o = (j * n + i) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
      img.data[o + 3] = Math.round(clamp01(fn(Math.sqrt(dx * dx + dy * dy))) * 255)
    }
    x.putImageData(img, 0, 0)
    return cv
  }
  const vignetteCv = radialTex(128, d => { const a = clamp01((d - 0.55) / 0.6); return a * a })
  const glowCv = radialTex(64, d => { const a = clamp01(1 - d); return a * a })
  // scope mask: black square with a soft round hole (HudController.Weapons.ScopeMask, LensShare 0.94)
  const scopeCv = radialTex(256, d => { const r = d / 0.94; return r >= 1 ? 1 : Math.pow(smooth((r - 0.78) / 0.22), 1.6) })
  function texOf(cv) {
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }

  // ------------------------------------------------------------------ sprites and plain quads
  const sprites = []
  const quads = []
  const stats = { redraws: 0, uploadsPx: 0, updateMs: 0, frameRedraws: 0 }
  hud.stats = stats

  function mkMat(map, color = 0xffffff) {
    return new THREE.MeshBasicMaterial({ map, color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
  }
  /**
   * A sprite: content box w x h units drawn by draw(ctx, w, h); placed with at(x, y, ax, ay) (anchor point in screen
   * units, anchor fraction of the box); scale / alpha / rot animate for free.
   * group: 'hud' (gameplay HUD), 'top' (gameplay HUD that steps back under the scope), 'screen' (menus), 'touch'.
   */
  function sprite(z, group, draw) {
    const mat = mkMat(null)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 10000 + z
    mesh.frustumCulled = false
    mesh.visible = false
    object.add(mesh)
    const sp = { z, group, draw, mesh, mat, w: 1, h: 1, x: 0, y: 0, ax: 0, ay: 0, scale: 1, alpha: 1, rot: 0, on: false, dirty: true, cv: null, ctx: null, tex: null, cw: 0, ch: 0, lw: 0, lh: 0, snap: true, _m: '' }
    sp.size = (w, h) => { if (Math.abs(w - sp.w) > 0.01 || Math.abs(h - sp.h) > 0.01) { sp.w = w; sp.h = h; sp.dirty = true } return sp }
    sp.at = (x, y, ax = 0, ay = 0) => { sp.x = x; sp.y = y; sp.ax = ax; sp.ay = ay; return sp }
    sp.show = on => { sp.on = !!on; return sp }
    sp.redraw = () => { sp.dirty = true; return sp }
    sprites.push(sp)
    return sp
  }
  function renderSprite(sp) {
    const needW = Math.max(2, Math.ceil(sp.w * k) + 2), needH = Math.max(2, Math.ceil(sp.h * k) + 2)
    if (!sp.cv || needW > sp.cw || needH > sp.ch || needW * needH * 4 < sp.cw * sp.ch) {
      const cw = Math.ceil(needW / 16) * 16, ch = Math.ceil(needH / 16) * 16
      if (!sp.cv) sp.cv = new OffscreenCanvas(cw, ch)
      else { sp.cv.width = cw; sp.cv.height = ch }
      sp.ctx = sp.cv.getContext('2d')
      if (sp.tex) sp.tex.dispose()
      sp.tex = texOf(sp.cv)
      const hadMap = !!sp.mat.map
      sp.mat.map = sp.tex
      if (!hadMap) sp.mat.needsUpdate = true
      sp.cw = cw; sp.ch = ch; sp.lw = cw; sp.lh = ch
    }
    const c = sp.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, Math.max(sp.lw, needW), Math.max(sp.lh, needH))
    sp.lw = needW; sp.lh = needH
    c.setTransform(k, 0, 0, k, 0, 0)
    c.globalAlpha = 1
    c.textBaseline = 'alphabetic'
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    try { sp.draw(c, sp.w, sp.h) } catch (e) { console.error('hud draw', e) }
    sp.tex.needsUpdate = true
    sp.dirty = false
    stats.redraws++
    stats.frameRedraws++
    stats.uploadsPx += sp.cw * sp.ch
  }
  function placeMesh(sp, alpha) {
    const m = sp.mesh
    const cwU = sp.cw / k, chU = sp.ch / k, sc = sp.scale
    let tlx = sp.x - sp.ax * sp.w * sc, tly = sp.y - sp.ay * sp.h * sc
    if (sp.snap && sc === 1 && sp.rot === 0) { tlx = Math.round(tlx * k) / k; tly = Math.round(tly * k) / k }
    let cx = tlx + cwU * sc / 2, cy = tly + chU * sc / 2
    if (sp.rot) {
      const dx = cx - sp.x, dy = cy - sp.y, c = Math.cos(sp.rot), sn = Math.sin(sp.rot)
      cx = sp.x + dx * c - dy * sn; cy = sp.y + dx * sn + dy * c
    }
    m.position.set(cx - Wu / 2, Hu / 2 - cy, 0)
    m.scale.set(cwU * sc, chU * sc, 1)
    m.rotation.z = -sp.rot
    sp.mat.opacity = alpha
  }
  /** full-screen (or rect) quad with a solid colour or a stretched generated texture */
  function quad(z, group, cv) {
    const mat = mkMat(cv ? texOf(cv) : null)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 10000 + z
    mesh.frustumCulled = false
    mesh.visible = false
    object.add(mesh)
    const q = { z, group, mesh, mat, alpha: 0, color: P.black, rect: null, r: [0, 0, 0, 0], rot: 0, on: true }
    q.set = (c, a) => { q.color = c; q.alpha = a; return q }
    q.setRect = (x, y, w, h) => { q.r[0] = x; q.r[1] = y; q.r[2] = w; q.r[3] = h; q.rect = q.r; return q }
    quads.push(q)
    return q
  }

  // ------------------------------------------------------------------ drawing kit (units, canvas y down)
  function chamfer(c, x, y, w, h, ch) {
    ch = Math.min(ch, h * 0.35, w * 0.35)
    c.beginPath()
    c.moveTo(x + ch, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h - ch); c.lineTo(x + w - ch, y + h); c.lineTo(x, y + h); c.lineTo(x, y + ch)
    c.closePath()
  }
  /** chamfered 9-slice panel with an optional accent edge (left, from 18% to 82%; or bottom) */
  function panel(c, x, y, w, h, o = {}) {
    const fill = o.fill || P.panel
    chamfer(c, x, y, w, h, o.ch == null ? 10 : o.ch)
    c.fillStyle = css(fill, aS(o.a == null ? 0.8 : o.a))
    c.fill()
    if (o.accent) {
      c.fillStyle = css(o.accent, o.accentA == null ? 1 : o.accentA)
      if (o.side === 'bottom') c.fillRect(x + w * 0.18, y + h - 2, w * 0.64, 2)
      else if (o.side === 'top') c.fillRect(x, y + (o.accentY || 0), 3, o.accentH || 30)
      else c.fillRect(x, y + h * 0.18, 3, h * 0.64)
    }
  }
  function rect(c, x, y, w, h, color, a = 1) { c.fillStyle = css(color, a); c.fillRect(x, y, w, h) }
  /** text; v: 'middle' | 'top' | 'bottom' | 'base' (y is then the baseline) */
  function text(c, str, x, y, o = {}) {
    if (str == null || str === '') return 0
    str = String(str)
    const kind = o.f || 'b', size = o.size || 20, fm = FM[kind]
    c.font = font(kind, size, o.italic)
    c.textAlign = 'left'
    const sp = o.sp ? o.sp * size / 100 : 0
    let w = sp ? 0 : c.measureText(str).width
    if (sp) for (let i = 0; i < str.length; i++) w += c.measureText(str[i]).width + (i < str.length - 1 ? sp : 0)
    let sx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
    const v = o.v || 'middle'
    const by = v === 'top' ? y + fm[0] * size : v === 'bottom' ? y - fm[1] * size : v === 'base' ? y : y + (fm[0] - fm[1]) / 2 * size
    c.fillStyle = css(o.col || P.text, o.a == null ? 1 : o.a)
    if (o.shadow) { c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = o.shadow; c.shadowOffsetY = 0 }
    if (o.stroke) { c.lineJoin = 'round'; c.lineWidth = o.stroke; c.strokeStyle = 'rgba(0,0,0,0.9)' }
    if (!sp) {
      if (o.stroke) c.strokeText(str, sx, by)
      c.fillText(str, sx, by)
    } else {
      for (let i = 0; i < str.length; i++) {
        if (o.stroke) c.strokeText(str[i], sx, by)
        c.fillText(str[i], sx, by)
        sx += c.measureText(str[i]).width + sp
      }
    }
    if (o.shadow) { c.shadowColor = 'transparent'; c.shadowBlur = 0 }
    return w
  }
  /** a line of segments; returns its width */
  function rich(c, sg, x, y, o = {}) {
    const kind = o.f || 'b', size = o.size || 20
    const w = segsW(sg, kind, size)
    let sx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
    for (const sgm of sg) sx += text(c, sgm[0], sx, y, { ...o, align: 'left', col: sgm[1], a: (o.a == null ? 1 : o.a) * sgm[2] })
    return w
  }
  /** cut segments to maxW with an ellipsis */
  function clip(sg, kind, size, maxW) {
    if (segsW(sg, kind, size) <= maxW) return sg
    const out = []
    let w = tw('…', kind, size)
    for (const x of sg) {
      const cw = tw(x[0], kind, size)
      if (w + cw <= maxW) { out.push(x); w += cw; continue }
      let t = x[0]
      while (t.length && w + tw(t, kind, size) > maxW) t = t.slice(0, -1)
      out.push([t.replace(/\s+$/, '') + '…', x[1], x[2]])
      return out
    }
    return out
  }
  /** word-wrap segments to maxW: array of lines (each segments) */
  function wrap(sg, kind, size, maxW) {
    const words = []
    for (const x of sg) for (const part of x[0].split(/(\s+)/)) if (part) words.push([part, x[1], x[2]])
    const lines = []
    let line = [], w = 0
    for (const wd of words) {
      const ww = tw(wd[0], kind, size)
      const space = /^\s+$/.test(wd[0])
      if (w + ww > maxW && line.length && !space) {
        while (line.length && /^\s+$/.test(line[line.length - 1][0])) line.pop()
        lines.push(line); line = []; w = 0
      }
      if (space && !line.length) continue
      line.push(wd); w += ww
    }
    if (line.length) lines.push(line)
    return lines.map(l => {
      const out = []
      for (const x of l) { const last = out[out.length - 1]; if (last && last[1] === x[1] && last[2] === x[2]) last[0] += x[0]; else out.push([...x]) }
      return out
    })
  }
  /** largest size <= size (>= min) at which the text fits maxW */
  function fit(str, kind, size, maxW, min = 16, sp = 0) {
    const w = typeof str === 'string' ? tw(str, kind, size, sp) : segsW(str, kind, size)
    if (w <= maxW) return size
    return Math.max(min, Math.floor(size * maxW / w))
  }
  /** text shrunk toward 16 units to fit maxW, then cut with an ellipsis */
  function textFit(c, str, x, y, maxW, o) {
    str = String(str == null ? '' : str)
    const kind = o.f || 'b', size = fit(str, kind, o.size || 20, maxW, 16, o.sp || 0)
    const sg = clip([[str, o.col || P.text, o.a == null ? 1 : o.a]], kind, size, maxW)
    return rich(c, sg, x, y, { ...o, size, a: 1 })
  }
  function icon(c, name, cx, cy, size, color, a = 1) {
    const t = tinted(name, color)
    if (!t) return
    c.globalAlpha = a
    c.drawImage(t, cx - size / 2, cy - size / 2, size, size)
    c.globalAlpha = 1
  }
  /** keycap: dark fill, light rim; width grows with the label (UiKit.Key) */
  function keyW(label, h) { return Math.max(h, 12 + label.length * h * 0.42) }
  function keycap(c, label, x, cy, h, o = {}) {
    const w = keyW(label, h), y = cy - h / 2, r = Math.max(3, h * 0.18)
    c.beginPath()
    c.roundRect ? c.roundRect(x + 1, y + 1, w - 2, h - 2, r) : c.rect(x + 1, y + 1, w - 2, h - 2)
    c.fillStyle = css(o.fill || [18, 22, 28], 0.92)
    c.fill()
    c.lineWidth = Math.max(1.5, h * 0.07)
    c.strokeStyle = css(o.rim || P.text, 0.95)
    c.stroke()
    text(c, label, x + w / 2, cy + h * 0.02, { f: 'h', size: Math.round(h * 0.56), col: o.col || P.text, align: 'center' })
    return w
  }
  /** horizontal bar: track, trailing chip, fill */
  function bar(c, x, y, w, h, frac, fill, o = {}) {
    rect(c, x, y, w, h, o.track || P.black, o.trackA == null ? 0.5 : o.trackA)
    if (o.chip != null && o.chip > frac) rect(c, x, y, w * clamp01(o.chip), h, P.white, 0.55)
    if (frac > 0) rect(c, x, y, w * clamp01(frac), h, fill, o.a == null ? 1 : o.a)
  }
  function glow(c, cx, cy, w, h, color, a) {
    const t = tinted('__glow', color)
    c.globalAlpha = a
    c.drawImage(t || glowCv, cx - w / 2, cy - h / 2, w, h)
    c.globalAlpha = 1
  }
  icons.__glow = glowCv
  /** soft dark band (UiKit.SoftBand stretched): flat middle, smoothstep feather fx / fy units; generated small, drawn stretched (no seams) */
  const bandCache = new Map()
  function softBand(c, x, y, w, h, fx, fy, a) {
    const key = Math.round(w) + 'x' + Math.round(h) + '|' + fx + '|' + fy
    let cv = bandCache.get(key)
    if (!cv) {
      const n = 96, m = 40
      cv = new OffscreenCanvas(n, m)
      const x2 = cv.getContext('2d'), img = x2.createImageData(n, m)
      for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
        const px = (i + 0.5) / n * w, py = (j + 0.5) / m * h, o = (j * n + i) * 4
        img.data[o + 3] = Math.round(smooth(Math.min(px, w - px) / fx) * smooth(Math.min(py, h - py) / fy) * 255)
      }
      x2.putImageData(img, 0, 0)
      if (bandCache.size > 24) bandCache.clear()
      bandCache.set(key, cv)
    }
    c.globalAlpha = a
    c.drawImage(cv, x, y, w, h)
    c.globalAlpha = 1
  }
  /** menu button (MenuParts.Button): chamfered fill; primary amber; amber edge + brighter fill when focused */
  function button(c, b, focused) {
    const prim = b.primary
    chamfer(c, b.x, b.y, b.w, b.h, Math.min(12, b.h * 0.22))
    const dis = b.disabled
    c.fillStyle = prim ? css(focused ? [255, 238, 104] : P.amber, dis ? 0.4 : 0.95) : css(focused ? [205, 215, 225] : [160, 172, 185], focused ? 0.34 : 0.2)
    c.fill()
    const ink = prim ? [18, 13, 5] : P.text
    if (prim || focused) rect(c, b.x + 8, b.y + b.h * 0.25, 3, b.h * 0.5, prim ? ink : P.amber)
    const size = b.size || Math.round(b.h * 0.38)
    const lab = b.label || ''
    const fs = fit(lab, 'h', size, b.w - 44, 16)
    text(c, lab, b.align === 'center' ? b.x + b.w / 2 : b.x + 28, b.y + b.h / 2, { f: 'h', size: fs, col: ink, a: dis ? 0.5 : 1, align: b.align === 'center' ? 'center' : 'left', sp: 1 })
  }

  // ------------------------------------------------------------------ weapon silhouettes (blocky, from the renders' outline)
  const GUNS = {
    ar: [[0, 9, 16, 9], [12, 6, 40, 9], [26, 3, 14, 3], [52, 8, 30, 5], [80, 9, 14, 3], [30, 15, 7, 11], [18, 15, 5, 9]],
    plasma: [[0, 8, 20, 9], [18, 5, 46, 12], [30, 1, 12, 4], [44, 2, 8, 3], [62, 6, 22, 9], [84, 8, 14, 4], [26, 17, 6, 10]],
    shotgun: [[0, 9, 18, 9], [16, 7, 24, 9], [40, 6, 52, 4], [42, 11, 40, 4], [50, 11, 14, 6], [22, 16, 5, 8]],
    smg: [[0, 9, 10, 6], [10, 6, 34, 10], [44, 8, 18, 4], [26, 16, 6, 13], [14, 16, 5, 8], [20, 3, 10, 3]],
    rail: [[0, 9, 18, 8], [16, 7, 34, 8], [22, 1, 22, 5], [50, 8, 46, 3], [50, 6, 10, 7], [26, 15, 5, 9]],
    launcher: [[0, 9, 16, 8], [14, 5, 22, 12], [36, 3, 34, 15], [70, 5, 18, 11], [22, 17, 6, 9], [40, 18, 12, 8]],
  }
  function gunKind(name = '') {
    const n = name.toUpperCase()
    if (/PL-?2|PLASMA/.test(n)) return 'plasma'
    if (/SG-?12|SHOT|BREACH/.test(n)) return 'shotgun'
    if (/VK-?9|SMG/.test(n)) return 'smg'
    if (/RX-?3|LANCER|MARKS|RAIL/.test(n)) return 'rail'
    if (/GL-?40|THUMP|LAUNCH|GRENADE/.test(n)) return 'launcher'
    return 'ar'
  }
  function gun(c, name, x, y, w, h, color, a = 0.92) {
    const parts = GUNS[gunKind(name)], sx = w / 100, sy = h / 30, sc = Math.min(sx, sy)
    const ox = x + (w - 100 * sc) / 2, oy = y + (h - 30 * sc) / 2
    c.fillStyle = css(color, a)
    for (const p of parts) c.fillRect(ox + p[0] * sc, oy + p[1] * sc, p[2] * sc, p[3] * sc)
  }

  // ------------------------------------------------------------------ state
  const S = {
    visible: true, t: 0,
    wave: null, waveSig: '', core: null, coreN: 1, coreChip: 1, corePulse: 0, hiveTag: null,
    buildBanner: null, gearHint: false, bossPreview: null, bossBand: null, bossChip: 1, evoChip: null,
    badge: null, badgePulse: 0, biomassTarget: 0, biomassShown: 0, biomassInit: false, biomassPulse: 0, delta: 0, deltaT: 0,
    vitals: null, hpChip: 1, staminaFlash: 0, vignetteFlash: 0, weapon: null, cross: { gap: 5, visible: true }, hitT: 0, hitDur: 0.16, hitKind: 'normal',
    streak: null, streakT: 0, streakPop: 1, prompt: null, promptSig: '', promptAlpha: 0, promptPos: null, markers: [],
    callout: null, calloutSig: '', calloutT: 0, toasts: [], feed: [], banners: [], banner: null, bannerT: -1,
    levels: [], level: null, levelT: 99, guides: [], guide: null, guideT: 99, pod: null, podT: 99, death: null,
    scope: false, scopeBlend: 0, touch: null, hover: -1,
  }

  // ================================================================== gameplay HUD widgets
  // ---------------------------------------------------------------- wave strip + Core plate
  const waveSp = sprite(20, 'top', (c, w) => {
    const v = S.wave || {}
    const hw = L.HWt
    c.save(); c.translate(12, 0)
    panel(c, 0, 0, hw, 50, { accent: P.dim, accentA: DIM_A, side: 'bottom' })
    icon(c, 'wave', 30, 25, 24, P.danger)
    const label = v.endless || !v.total ? `Wave ${v.wave || 1}  ·  best ${v.best || 0}` : `Wave ${v.wave || 1} of ${v.total}`
    const st = waveStatus(v)
    const stW = tw(st.text, 'n', 30)
    const room = hw - 52 - 20 - Math.max(120, stW) - 40
    textFit(c, label, 52, 26, room, { f: 'n', size: 30, col: P.text })
    text(c, st.text, hw - 20, 26, { f: 'n', size: 30, col: st.col, align: 'right' })
    icon(c, st.icon, hw - 20 - Math.max(110, stW) - 22, 25, 22, st.iconCol)
    c.restore()
    // the Core's plate under the strip (the bar itself is its own sprite: it jitters when hit)
    chamfer(c, 0, 54, hw + 24, 56, 9)
    c.fillStyle = css(P.panel, aS(0.85)); c.fill()
  })
  function waveStatus(v) {
    const ph = v.phase || 'build'
    if (ph === 'held') return { text: 'Held', col: P.text, icon: 'check', iconCol: P.lime }
    if (ph === 'lost') return { text: 'Lost', col: P.text, icon: 'core', iconCol: P.danger }
    if (ph === 'combat') return { text: (v.left | 0) + ' left', col: P.text, icon: 'target', iconCol: P.danger }
    const secs = Math.max(0, Math.ceil(v.timer || 0)), held = !!v.held, warn = secs <= 5 && !held
    return { text: held ? '--:--' : Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), col: warn ? P.amber : P.text, icon: 'timer', iconCol: warn ? P.amber : P.text }
  }
  const WV = { wave: 0, best: 0, endless: false, total: 0, phase: '', timer: 0, held: false, left: 0 }
  hud.wave = v => {
    if (!v) { S.wave = null; return }
    const secs = Math.ceil(v.timer || 0)
    if (S.wave && WV.wave === v.wave && WV.best === v.best && WV.endless === !!v.endless && WV.total === v.total && WV.phase === v.phase && WV.timer === secs && WV.held === !!v.held && WV.left === v.left) return
    WV.wave = v.wave; WV.best = v.best; WV.endless = !!v.endless; WV.total = v.total; WV.phase = v.phase; WV.timer = secs; WV.held = !!v.held; WV.left = v.left
    S.wave = WV
    waveSp.redraw()
  }

  // ---------------------------------------------------------------- Core bar (inside the plate; jitters when hit)
  const coreSp = sprite(21, 'top', (c, w) => {
    const v = S.core || { hp: 1, max: 1 }
    const pw = L.HWt + 24, bx = 40, bw = pw - 52, by = 30
    const n = S.coreN
    const fillC = mix(P.danger, P.cyan, clamp01((n - 0.15) / 0.5))
    bar(c, bx, by, bw, 18, n, fillC, { chip: S.coreChip })
    icon(c, 'core', bx - 18, by + 9 - 8, 26, P.cyan)
    text(c, 'Frontier Core', bx, by - 3, { f: 'h', size: 17, col: P.cyan, v: 'bottom' })
    text(c, `${Math.ceil(v.hp || 0)} / ${Math.round(v.max || 0)}`, bx + bw, by - 1, { f: 'n', size: 22, col: P.text, align: 'right', v: 'bottom' })
    if (v.boostPct > 0) {
      const t = 'Turrets +' + Math.round(v.boostPct) + '%', tW = tw(t, 'h', 17), x0 = bx + bw / 2 - (tW + 24) / 2
      icon(c, 'turret', x0 + 10, by - 3 - 12, 18, P.cyan)
      text(c, t, x0 + 24, by - 3, { f: 'h', size: 17, col: P.cyan, v: 'bottom' })
    }
    if (v.shieldMax > 0) {
      rect(c, bx, by - 6, bw, 4, P.black, 0.45)
      rect(c, bx, by - 6, bw * clamp01((v.shield || 0) / v.shieldMax), 4, P.shield)
      icon(c, 'shield', bx + bw + 14, by - 4, 16, P.shield)
    }
  })
  const CORE = { hp: 0, max: 0, shield: 0, shieldMax: 0, boostPct: 0 }
  hud.core = v => {
    if (!v) { S.core = null; return }
    const first = !S.core
    const n = v.max > 0 ? clamp01(v.hp / v.max) : 0
    if (first || CORE.hp !== v.hp || CORE.max !== v.max || CORE.shield !== v.shield || CORE.shieldMax !== v.shieldMax || CORE.boostPct !== v.boostPct) coreSp.redraw()
    if (n > S.coreChip) S.coreChip = n
    if (v.hit || (!first && v.hp < CORE.hp)) S.corePulse = 1
    S.coreN = n
    CORE.hp = v.hp; CORE.max = v.max; CORE.shield = v.shield; CORE.shieldMax = v.shieldMax; CORE.boostPct = v.boostPct
    S.core = CORE
  }

  // ---------------------------------------------------------------- Hive tag
  const tagSp = sprite(22, 'top', (c, w) => {
    chamfer(c, 0, 0, w, 26, 6); c.fillStyle = css(P.panel, aS(0.85)); c.fill()
    textFit(c, S.hiveTag, w / 2, 13, w - 20, { f: 'h', size: L.tagSize, col: P.hive, align: 'center' })
  })
  hud.hiveTag = t => { t = t || null; if (t !== S.hiveTag) { S.hiveTag = t; tagSp.redraw() } }

  // ---------------------------------------------------------------- build banner + gear hint + boss preview
  const buildSp = sprite(23, 'top', (c, w) => {
    const b = S.buildBanner || {}
    panel(c, 0, 0, w, 46, { a: 0.88, accent: P.amber })
    const secs = Math.max(0, Math.ceil(b.seconds || 0)), warn = secs <= 5 && !b.held
    const tx = L.narrow ? 16 : 20
    const titleW = text(c, 'Build phase', tx, 23, { f: 'h', size: L.narrow ? 20 : 22, col: P.amber })
    const timeS = b.held ? 'no limit' : secs + ' s'
    const timeX = L.narrow ? tx + titleW + 14 : 176
    const timeEnd = timeX + text(c, timeS, timeX, 24, { f: 'n', size: 30, col: warn ? P.amber : P.text })
    text(c, L.touch ? 'tap to start' : 'to start', w - 18, 23, { f: 'b', size: 20, col: P.text, align: 'right' })
    if (!L.touch) {
      keycap(c, 'G', w - 134, 23, 30)
      if (w - 142 - tw('press', 'b', 20) > timeEnd + 10) text(c, 'press', w - 142, 23, { f: 'b', size: 20, col: P.text, align: 'right' })
    }
  })
  const BB = { seconds: 0, held: false, onReady: null }
  hud.buildBanner = b => {
    if (!b) { S.buildBanner = null; return }
    const secs = Math.ceil(b.seconds || 0)
    if (!S.buildBanner || BB.seconds !== secs || BB.held !== !!b.held) { BB.seconds = secs; BB.held = !!b.held; buildSp.redraw() }
    BB.onReady = b.onReady || null
    S.buildBanner = BB
  }
  const gearSp = sprite(23, 'top', (c, w) => {
    chamfer(c, 0, 0, w, 34, 8); c.fillStyle = css(P.panel, aS(0.85)); c.fill()
    keycap(c, 'B', 18, 17, 26)
    const sg = [['Gear locker', P.inter, 1], ['  ·  run upgrades and your two weapons', P.text, 1]]
    rich(c, clip(sg, 'b', 19, w - 72), 56, 17, { f: 'b', size: 19 })
  })
  hud.gearHint = on => { S.gearHint = !!on }
  const previewSp = sprite(23, 'top', (c, w) => {
    const b = S.bossPreview
    chamfer(c, 0, 0, w, 30, 7); c.fillStyle = css(P.panel, aS(0.85)); c.fill()
    textFit(c, b.text, w / 2, 15, w - 20, { f: 'h', size: L.previewSize, col: b.col, align: 'center' })
  })
  const BPV = { text: '', col: [255, 74, 46] }
  let bpSrc = null
  hud.bossPreview = (t, colour) => {
    t = t || null
    const colCh = colChanged(BPV.col, colour, P.danger)
    if (t === bpSrc && !colCh) return
    bpSrc = t
    if (t) { BPV.text = String(t); S.bossPreview = BPV } else S.bossPreview = null
    L.previewFor = null
    previewSp.redraw()
  }

  // ---------------------------------------------------------------- boss band (reserved 196-286 from the top, ±470)
  const bossSp = sprite(24, 'hud', (c, w) => {
    const b = S.bossBand
    const bw = w - 40
    chamfer(c, 0, 0, w, 88, 9); c.fillStyle = css(P.panel, aS(0.85)); c.fill()
    const cl = b.colour
    textFit(c, b.name, w / 2, 35, bw, { f: 'h', size: 22, col: cl, align: 'center', v: 'bottom' })
    bar(c, 20, 40, bw, 16, b.frac, cl, { chip: S.bossChip, trackA: 0.6 })
    for (const m of b.marks) if (m > 0 && m < 1) rect(c, 20 + bw * m - 1.5, 36, 3, 24, P.white, 0.85)
    if (b.phaseLine) textFit(c, b.phaseLine, w / 2, 62, bw, { f: 'h', size: 17, col: P.dim, a: DIM_A, align: 'center', v: 'top' })
  })
  const BOSS = { name: '', frac: 1, phaseLine: '', colour: [255, 181, 71], marks: [] }
  hud.bossBand = b => {
    if (!b) { S.bossBand = null; return }
    const first = !S.bossBand
    if (first) S.bossChip = 1
    const frac = clamp01(b.frac == null ? 1 : b.frac), name = b.name || '', line = b.phaseLine || '', marks = b.marks || NO_MARKS
    const colCh = colChanged(BOSS.colour, b.colour, P.amber)
    if (first || colCh || BOSS.name !== name || Math.abs(BOSS.frac - frac) > 0.0005 || BOSS.phaseLine !== line || !sameList(BOSS.marks, marks)) {
      BOSS.name = name; BOSS.frac = frac; BOSS.phaseLine = line; copyList(BOSS.marks, marks)
      bossSp.redraw()
    }
    S.bossBand = BOSS
  }

  // ---------------------------------------------------------------- evolution chip ([H] HIVE EVOLVED · see what changed)
  const chipSp = sprite(25, 'hud', (c, w) => {
    panel(c, 0, 0, w, 40, { fill: [20, 5, 4], a: 0.9 })
    rect(c, 0, 5, 3, 30, P.hive)
    keycap(c, 'H', 16, 20, 28)
    const t = S.evoChip.text
    textFit(c, t, 56, 20, w - 70, { f: 'h', size: 19, col: P.hive })
  })
  const CHIP = { text: '', onOpen: null }
  let chipSrc = null
  hud.evoChip = (t, onOpen) => {
    if (!t) { S.evoChip = null; chipSrc = null; return }
    if (typeof t === 'object') { onOpen = t.onOpen; t = t.text }
    CHIP.onOpen = onOpen || null
    if (t === chipSrc && S.evoChip) return
    chipSrc = t
    const txt = String(t).replace(/^\[H\]\s*/, '')
    if (!S.evoChip || CHIP.text !== txt) chipSp.redraw()
    CHIP.text = txt
    S.evoChip = CHIP
  }

  // ---------------------------------------------------------------- Hive badge (top-left)
  const badgeSp = sprite(26, 'hud', (c, w, h) => {
    const b = S.badge
    const k2 = Math.abs(Math.sin(S.badgePulse * Math.PI * 4) * S.badgePulse)
    chamfer(c, 0, 0, w, h, 10)
    c.fillStyle = css(mix([13, 4, 3], [128, 26, 10], k2), aS(lerp(0.58, 0.8, k2))); c.fill()
    rect(c, 0, 0, 3, 30, P.hive)
    text(c, `HIVE  ·  GENERATION ${b.generation}`, 14, 6, { f: 'h', size: 17, col: P.hive, v: 'top', sp: 3 })
    const rows = b.shown
    rows.forEach((r, i) => {
      rect(c, 14, 36 + i * 21, 3, 14, col(r.colour, P.amber))
      const st = roman(r.stacks || 1)
      text(c, r.more ? r.name : r.name + (st ? '  ' + st : ''), 24, 33 + i * 21, { f: 'h', size: 16, col: r.more ? P.dim : P.text, v: 'top' })
    })
  })
  const badgeRefs = []
  hud.hiveBadge = b => {
    if (!b || !b.rows || !b.rows.length) { S.badge = null; badgeRefs.length = 0; return }
    // fast path: the same rows as last time (names, stacks and colour objects), no stringify
    if (S.badge && S.badge.generation === b.generation && badgeRefs.length === b.rows.length * 3) {
      let same = true
      for (let i = 0; i < b.rows.length && same; i++) { const r = b.rows[i]; same = badgeRefs[i * 3] === r.name && badgeRefs[i * 3 + 1] === r.stacks && badgeRefs[i * 3 + 2] === r.colour }
      if (same) return
    }
    badgeRefs.length = 0
    for (const r of b.rows) badgeRefs.push(r.name, r.stacks, r.colour)
    const sig = JSON.stringify(b)
    if (!S.badge || S.badge.sig !== sig) {
      if (S.badge && S.badge.sig !== sig) S.badgePulse = 1
      S.badge = { generation: b.generation, rows: b.rows.slice(0, 10), sig }
      badgeSp.redraw()
    }
  }

  // ---------------------------------------------------------------- Biomass (top-right) and its delta
  const bioSp = sprite(27, 'top', (c, w) => {
    const p = S.biomassPulse
    panel(c, 0, 0, w, 64, { accent: P.lime })
    glow(c, 40, 32, 84, 84, P.lime, 0.25 + p * 0.6)
    icon(c, 'biomass', 40, 32, 34 * (1 + p * 0.35), P.lime)
    text(c, 'Biomass', 70, 6, { f: 'h', size: 16, col: P.dim, a: DIM_A, v: 'top' })
    const sc = 1 + p * 0.12
    c.save(); c.translate(w - 16, 64); c.scale(sc, sc)
    text(c, fmtInt(S.biomassShown), 0, 0, { f: 'n', size: 42, col: P.lime, align: 'right', v: 'bottom' })
    c.restore()
  })
  const deltaSp = sprite(27, 'top', (c, w) => {
    text(c, S.delta > 0 ? '+' + S.delta : '−' + Math.abs(S.delta), 0, 0, { f: 'n', size: 26, col: S.delta > 0 ? P.lime : P.danger, v: 'top' })
  })
  hud.biomass = (value, pulse) => {
    value = Math.round(value || 0)
    if (!S.biomassInit) { S.biomassInit = true; S.biomassTarget = S.biomassShown = value; bioSp.redraw(); return }
    if (value === S.biomassTarget && !pulse) return
    const d = value - S.biomassTarget
    if (d !== 0) { S.delta = d; S.deltaT = 1.3; deltaSp.redraw() }
    if (d > 0 || pulse) S.biomassPulse = 1
    if (d < 0 || S.biomassShown > value) { S.biomassShown = value; bioSp.redraw() }
    S.biomassTarget = value
  }

  // ---------------------------------------------------------------- kill feed (5 rows, 4 s)
  const feedPool = []
  function feedSprite() {
    const sp = sprite(28, 'hud', (c, w) => {
      const e = sp.entry
      chamfer(c, 0, 0, w, 30, 6); c.fillStyle = css([8, 13, 18], aS(0.5)); c.fill()
      rich(c, e.clipped, w - 12, 15, { f: 'b', size: 19, align: 'right' })
    })
    sp.snap = true
    return sp
  }
  hud.killFeed = (source, sourceColour, enemy, reward) => {
    const sg = [[String(source || 'Hive'), col(sourceColour, P.text), 1], ['  ›  ', P.dim, DIM_A], [String(enemy || ''), P.text, 1]]
    if (reward > 0) sg.push(['   +' + reward, P.lime, 1])
    let sp = feedPool.find(x => !x.entry)
    if (S.feed.length >= L.feedRows) { const old = S.feed.pop(); sp = old.sp }
    if (!sp) { sp = feedSprite(); feedPool.push(sp) }
    const e = { segs: sg, t: 4, sp, cap: 0, clipped: sg }
    sp.entry = e
    S.feed.unshift(e)
    sp.dirty = true
  }

  // ---------------------------------------------------------------- vitals (bottom-left) + armor row
  const vitSp = sprite(29, 'hud', (c, w) => {
    const v = S.vitals || {}
    if (L.narrow) { vitalsCompact(c, w, v); return }
    const pw = w, top = 28, ph = L.vitH
    panel(c, 0, top, pw, ph, { accent: P.vital, accentA: 0.9 })
    const hpN = v.max > 0 ? clamp01(v.hp / v.max) : 0
    const hpY = top + 32
    icon(c, 'health', 32, hpY, 22, P.vital)
    bar(c, 56, hpY - 6, 262, 12, hpN, mix(P.danger, P.vital, clamp01((hpN - 0.2) / 0.4)), { chip: S.hpChip })
    text(c, String(Math.ceil(v.hp || 0)), pw - 18, hpY - 1, { f: 'n', size: 30, col: P.text, align: 'right' })
    if (!L.touch) keycap(c, 'C', pw - 18 - 24, top + 66, 24)
    // player level: the XP line on the top edge and "LV 7" above it
    if (v.level != null) {
      bar(c, 18, top + 2.5, pw - 36, 3, clamp01(v.xpFrac || 0), P.amber, { trackA: 0.45 })
      text(c, 'LV ' + v.level, pw - 18, top - 2, { f: 'n', size: 18, col: P.amber, align: 'right', v: 'bottom' })
    }
  })
  /** the stamina row and the dodge sweep (they change every frame while sprinting): a strip over the vitals panel */
  const stamSp = sprite(30, 'hud', (c, w, h) => {
    const v = S.vitals || {}, cy = 18
    const stN = v.staminaMax > 0 ? clamp01(v.stamina / v.staminaMax) : 0
    icon(c, 'stamina', 32, cy - 2, 20, P.stamina)
    const stC = v.winded ? mix(P.stamina, P.danger, 0.55) : P.stamina
    bar(c, 56, cy - 5, 262, 6, stN, mix(stC, P.danger, S.staminaFlash), { track: mix(P.black, [153, 20, 10], S.staminaFlash), trackA: lerp(0.5, 0.7, S.staminaFlash) })
    // dodge: radial cooldown sweep around the dodge icon
    const df = clamp01(v.dodgeFrac || 0), ready = df <= 0 && !v.dodgeBlocked
    const dx = w - 72, dy = cy
    c.globalAlpha = ready ? 1 : 0.7
    icon(c, 'ring', dx, dy, 34, P.black, 0.35)
    if (df > 0) {
      c.beginPath(); c.moveTo(dx, dy); c.arc(dx, dy, 17, -Math.PI / 2, -Math.PI / 2 - df * Math.PI * 2, true); c.closePath()
      c.fillStyle = 'rgba(255,255,255,0.28)'; c.fill()
    }
    icon(c, 'dodge', dx, dy, 22, ready ? P.text : P.dim, ready ? 1 : DIM_A)
    c.globalAlpha = 1
  })
  /** phones: HP, stamina, dodge, level and armor in one 72-unit panel in the top row, next to Biomass */
  function vitalsCompact(c, pw, v) {
    panel(c, 0, 0, pw, 72, { accent: P.vital, accentA: 0.9 })
    const hpN = v.max > 0 ? clamp01(v.hp / v.max) : 0, bx = 38, bw = pw - bx - 100
    if (v.level != null) {
      bar(c, 14, 2.5, pw - 28, 3, clamp01(v.xpFrac || 0), P.amber, { trackA: 0.45 })
      text(c, 'LV ' + v.level, pw - 12, 22, { f: 'n', size: 17, col: P.amber, align: 'right' })
    }
    icon(c, 'health', 20, 22, 18, P.vital)
    bar(c, bx, 16, bw, 12, hpN, mix(P.danger, P.vital, clamp01((hpN - 0.2) / 0.4)), { chip: S.hpChip })
    text(c, String(Math.ceil(v.hp || 0)), pw - 54, 22, { f: 'n', size: 26, col: P.text, align: 'right' })
    const stN = v.staminaMax > 0 ? clamp01(v.stamina / v.staminaMax) : 0
    const stC = v.winded ? mix(P.stamina, P.danger, 0.55) : P.stamina
    icon(c, 'stamina', 20, 44, 16, P.stamina)
    bar(c, bx, 41, bw, 6, stN, mix(stC, P.danger, S.staminaFlash), { track: mix(P.black, [153, 20, 10], S.staminaFlash), trackA: lerp(0.5, 0.7, S.staminaFlash) })
    const df = clamp01(v.dodgeFrac || 0), ready = df <= 0 && !v.dodgeBlocked, dx = pw - 34, dy = 46
    c.globalAlpha = ready ? 1 : 0.7
    icon(c, 'ring', dx, dy, 26, P.black, 0.35)
    if (df > 0) { c.beginPath(); c.moveTo(dx, dy); c.arc(dx, dy, 13, -Math.PI / 2, -Math.PI / 2 - df * Math.PI * 2, true); c.closePath(); c.fillStyle = 'rgba(255,255,255,0.28)'; c.fill() }
    icon(c, 'dodge', dx, dy, 17, ready ? P.text : P.dim, ready ? 1 : DIM_A)
    c.globalAlpha = 1
    if (v.armor > 0) {
      icon(c, 'armor', 20, 61, 13, P.steel)
      bar(c, bx, 59, bw, 4, clamp01((v.armor || 0) / (v.armorMax || 1)), P.steel)
      text(c, String(Math.ceil(v.armor)), pw - 54, 61, { f: 'n', size: 16, col: P.steel, align: 'right' })
    }
  }
  const armorSp = sprite(29, 'hud', (c, w) => {
    const v = S.vitals || {}
    const nar = L.narrow, barX = nar ? 44 : 56, barW = nar ? w - barX - 76 : 262
    chamfer(c, 0, 0, w, 30, 7); c.fillStyle = css(P.panel, aS(0.6)); c.fill()
    icon(c, 'armor', nar ? 24 : 32, 15, 20, P.steel)
    bar(c, barX, 12, barW, 6, clamp01((v.armor || 0) / (v.armorMax || 1)), P.steel)
    text(c, String(Math.ceil(v.armor || 0)), w - 18, 15, { f: 'n', size: 22, col: P.steel, align: 'right' })
  })
  const VS = { hp: 0, max: 0, stamina: 0, staminaMax: 0, winded: false, dodgeFrac: 0, dodgeBlocked: false, xpFrac: 0, level: null, armor: 0, armorMax: 0 }
  hud.vitals = v => {
    if (!v) { S.vitals = null; return }
    const first = !S.vitals, p = VS
    const level = v.level == null ? null : v.level, armor = v.armor || 0, armorMax = v.armorMax || 0
    const stam = first || q200(p.stamina / (p.staminaMax || 1)) !== q200(v.stamina / (v.staminaMax || 1)) || p.winded !== !!v.winded ||
      Math.round(p.dodgeFrac * 48) !== Math.round((v.dodgeFrac || 0) * 48) || p.dodgeBlocked !== !!v.dodgeBlocked
    if (stam) { if (L.narrow) vitSp.redraw(); else stamSp.redraw() }
    if (first || p.hp !== v.hp || p.max !== v.max || q200(p.xpFrac) !== q200(v.xpFrac) || p.level !== level) vitSp.redraw()
    if (first || p.armor !== armor || p.armorMax !== armorMax) { armorSp.redraw(); if (L.narrow) vitSp.redraw() }
    const n = v.max > 0 ? clamp01(v.hp / v.max) : 0
    if (!first && v.hp < p.hp && v.max > 0) S.vignetteFlash = Math.min(1, S.vignetteFlash + 0.25 + (p.hp - v.hp) / 40)
    if (n > S.hpChip) S.hpChip = n
    if (v.staminaFlash) S.staminaFlash = 1
    p.hp = v.hp; p.max = v.max; p.stamina = v.stamina || 0; p.staminaMax = v.staminaMax || 0; p.winded = !!v.winded; p.dodgeFrac = v.dodgeFrac || 0
    p.dodgeBlocked = !!v.dodgeBlocked; p.xpFrac = v.xpFrac || 0; p.level = level; p.armor = armor; p.armorMax = armorMax
    S.vitals = VS
  }
  hud.hurt = amount => { S.vignetteFlash = Math.min(1, S.vignetteFlash + 0.25 + (amount || 0) / 40) }

  // ---------------------------------------------------------------- weapon (bottom-right) + ammo + reload strip
  // the ammo count is its own small sprite: it changes on every shot, the rest of the panel rarely
  const wepSp = sprite(30, 'hud', (c, w) => {
    const v = S.weapon || WP
    const top = 30, ph = L.wepH, pw = w, nar = L.narrow
    const tc = v.tc
    panel(c, 0, top, pw, ph, { accent: tc })
    // "1  AR-7     2  PL-2 Plasma" over the panel
    if (v.slots && v.slots.length > 1) {
      const sg = []
      v.slots.forEach((n, i) => { if (i) sg.push(['     ', P.dim, 1]); const on = i === (v.active || 0); sg.push([(i + 1) + '  ' + n, on ? P.text : P.dim, on ? 1 : DIM_A]) })
      rich(c, clip(sg, 'b', 18, pw), pw, top - 8, { f: 'b', size: 18, align: 'right', v: 'bottom' })
    }
    const lvl = v.level != null ? 'Level ' + v.level + (v.maxLevel || v.xpToNext == null ? '  ·  max' : '  ·  ' + fmtInt(v.xpToNext) + ' xp to next') : ''
    if (!nar) {
      gun(c, v.name, 22, top + 14, 210, 62, P.text)
      text(c, v.name || '', 22, top + ph - 44, { f: 'h', size: fit(v.name || '', 'h', 24, 250), col: P.text, v: 'bottom' })
      text(c, lvl, 22, top + ph - 20, { f: 'n', size: fit(lvl, 'n', 18, 240), col: tc, v: 'bottom' })
    } else {
      const room = pw - 18 - L.ammoW - 12
      const lv2 = v.level != null ? 'Lv ' + v.level + (v.maxLevel || v.xpToNext == null ? '  ·  max' : '  ·  ' + fmtInt(v.xpToNext) + ' xp to next') : ''
      text(c, v.name || '', 18, top + 30, { f: 'h', size: fit(v.name || '', 'h', 22, room), col: P.text })
      rich(c, clip(segs(lv2, tc), 'n', 17, room), 18, top + 56, { f: 'n', size: 17 })
    }
    const xf = clamp01(v.xpFrac == null ? 0 : v.xpFrac)
    rect(c, 22, top + ph - 14, pw - 44, 4, P.white, 0.12)
    if (xf > 0) rect(c, 22, top + ph - 14, (pw - 44) * xf, 4, tc)
  })
  /** "24 / 24": the box's right edge is the panel's right edge, its bottom the panel's bottom */
  const ammoSp = sprite(31, 'hud', (c, w, h) => {
    const v = S.weapon || WP, nar = L.narrow
    const ammo = v.ammo == null ? 0 : v.ammo, mag = v.mag || 0
    const low = mag > 0 && ammo <= Math.ceil(mag * 0.25)
    if (!nar) {
      text(c, String(ammo), w - 92, h - 8, { f: 'n', size: 84, col: low ? P.danger : P.text, align: 'right', v: 'bottom' })
      text(c, '/ ' + mag, w - 88, h - 22, { f: 'n', size: 28, col: P.dim, a: DIM_A, v: 'bottom' })
    } else {
      const mx = w - 16 - tw('/ ' + mag, 'n', 22)
      text(c, '/ ' + mag, w - 16, h - 18, { f: 'n', size: 22, col: P.dim, a: DIM_A, align: 'right', v: 'bottom' })
      text(c, String(ammo), mx - 6, h - 10, { f: 'n', size: 60, col: low ? P.danger : P.text, align: 'right', v: 'bottom' })
    }
  })
  const reloadSp = sprite(31, 'hud', (c, w) => {
    const v = S.weapon || WP
    const tc = v.tc
    rect(c, 0, 0, w * clamp01(v.reloadFrac || 0), 3, tc)
    text(c, 'Reloading', w - 20, 12, { f: 'h', size: 17, col: P.amber, align: 'right', v: 'top' })
  })
  const WP = { name: '', tc: [255, 181, 71], level: null, xpToNext: null, xpFrac: 0, maxLevel: false, ammo: 0, mag: 0, reloadFrac: 0, slots: [], active: 0, charge: 0, scoped: null, onTap: null }
  hud.weapon = v => {
    if (!v) { S.weapon = null; return }
    const first = !S.weapon, p = WP
    const name = v.name || '', mag = v.mag || 0, active = v.active || 0, level = v.level == null ? null : v.level, xpToNext = v.xpToNext == null ? null : v.xpToNext
    const colCh = colChanged(p.tc, v.typeColour, P.amber), magCh = p.mag !== mag
    if (first || colCh || p.name !== name || p.level !== level || p.xpToNext !== xpToNext || (L.narrow && magCh) || !sameList(p.slots, v.slots) || p.active !== active ||
      Math.round(p.xpFrac * 400) !== Math.round((v.xpFrac || 0) * 400) || p.maxLevel !== !!v.maxLevel) wepSp.redraw()
    if (first || p.ammo !== v.ammo || magCh) ammoSp.redraw()
    if (first || colCh || Math.round(p.reloadFrac * 230) !== Math.round((v.reloadFrac || 0) * 230)) reloadSp.redraw()
    if (Math.round(p.charge * 64) !== Math.round((v.charge || 0) * 64)) chargeSp.redraw()
    if (v.scoped != null) S.scope = !!v.scoped || S.scopeForced
    if (first || magCh) L.ammoW = tw(String(mag), 'n', 60) + tw('/ ' + mag, 'n', 22) + 26
    p.name = name; p.level = level; p.xpToNext = xpToNext; p.xpFrac = v.xpFrac || 0; p.maxLevel = !!v.maxLevel; p.ammo = v.ammo; p.mag = mag
    p.reloadFrac = v.reloadFrac || 0; copyList(p.slots, v.slots); p.active = active; p.charge = v.charge || 0; p.scoped = v.scoped; p.onTap = v.onTap || null
    S.weapon = WP
  }
  L.ammoW = 120

  // ---------------------------------------------------------------- crosshair, hitmarker (plain quads: moving them costs no upload), RX-3 charge ring
  const ticks = [0, 1, 2, 3].map(() => quad(45, 'hud'))
  const dotQ = quad(45, 'hud')
  const hitQ = [0, 1, 2, 3].map(() => quad(45, 'hud'))
  const chargeSp = sprite(44, 'hud', (c, w, h) => {
    const ch = clamp01((S.weapon && S.weapon.charge) || 0), full = ch >= 0.999, r = 27
    c.lineWidth = 4
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.stroke()
    c.strokeStyle = css(full ? P.white : mix(P.amber, P.white, ch * 0.35))
    c.beginPath(); c.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + ch * Math.PI * 2); c.stroke()
  })
  chargeSp.size(64, 64)
  chargeSp.snap = false
  hud.crosshair = v => { if (v) { S.cross.gap = v.gap == null ? 5 : v.gap; S.cross.visible = v.visible } }
  hud.hitmarker = kind => { S.hitKind = kind || 'normal'; S.hitDur = kind === 'kill' ? 0.32 : 0.16; S.hitT = S.hitDur }
  function arrangeCrosshair(on, cx, cy) {
    const v = S.cross, show = on && v.visible !== false
    const tickA = show && S.scopeBlend < 0.5 ? 0.9 : 0
    const g = clamp(v.gap, 0, 64) + 6
    for (const q of ticks) q.set(P.white, tickA)
    ticks[0].setRect(cx - g - 6, cy - 1, 12, 2); ticks[1].setRect(cx + g - 6, cy - 1, 12, 2)
    ticks[2].setRect(cx - 1, cy - g - 6, 2, 12); ticks[3].setRect(cx - 1, cy + g - 6, 2, 12)
    dotQ.set(P.white, show ? 0.95 : 0).setRect(cx - 1.5, cy - 1.5, 3, 3)
    const kk = S.hitT > 0 ? S.hitT / Math.max(0.01, S.hitDur) : 0, sc = 0.8 + (1 - kk) * 0.5
    const hc = S.hitKind === 'kill' ? P.danger : S.hitKind === 'weak' ? P.gold : P.white
    for (let i = 0; i < 4; i++) {
      const q = hitQ[i], a = (45 + i * 90) * Math.PI / 180, px = cx + Math.cos(a) * 13 * sc, py = cy - Math.sin(a) * 13 * sc
      q.set(hc, on ? kk : 0).setRect(px - 7 * sc, py - 1.5 * sc, 14 * sc, 3 * sc); q.rot = -a
    }
    const ch = S.weapon && S.weapon.charge
    chargeSp.show(on && ch > 0).at(cx, cy, 0.5, 0.5)
    if (ch >= 0.999) chargeSp.scale = 1 + 0.07 * Math.sin(S.t * 18); else chargeSp.scale = 1
  }

  // ---------------------------------------------------------------- streak (Double kill · 3 kills)
  const streakSp = sprite(46, 'hud', (c, w, h) => {
    const st = S.streak
    text(c, st.label, 4, 38, { f: 'h', size: 38, col: P.amber, italic: true, shadow: 6 })
    text(c, st.kills + ' kills', 8, 78, { f: 'n', size: 28, col: P.text, shadow: 6 })
  })
  streakSp.size(600, 110)
  hud.streak = (label, kills) => {
    if (typeof label === 'number' && kills == null) { kills = label; label = null }
    if (!label && kills >= 2) { const e = STREAKS.find(x => kills >= x[0]); label = e ? e[1] : '' }
    if (!label || !(kills >= 2)) { if (!kills) S.streakT = Math.min(S.streakT, 0.3); return }
    S.streak = { label, kills }
    S.streakT = 2.4; S.streakPop = 0
    streakSp.redraw()
  }

  // ---------------------------------------------------------------- toasts (bottom centre, 2.6 s)
  const toastPool = []
  hud.toast = (t, kind = 'info') => {
    if (!t) return
    let sp
    if (S.toasts.length >= 3) sp = S.toasts.pop().sp
    else sp = toastPool.find(x => !x.entry)
    if (!sp) {
      sp = sprite(96, 'hud', (c, w) => { // over the gear locker: purchases are confirmed by toasts
        const e = sp.entry
        chamfer(c, 0, 0, w, 32, 7); c.fillStyle = css(P.panel, aS(0.92)); c.fill()
        rich(c, clip(e.segs, 'h', e.size, w - 24), w / 2, 16, { f: 'h', size: e.size, align: 'center' })
      })
      toastPool.push(sp)
    }
    const sg = segs(t, col(kind, P.text))
    const e = { segs: sg, t: 2.6, sp, size: 22 }
    sp.entry = e
    S.toasts.unshift(e)
    sp.dirty = true
  }

  // ---------------------------------------------------------------- centre banner queue
  const bannerSp = sprite(50, 'hud', (c, w, h) => {
    const b = S.banner
    const cx = w / 2
    const aIn = clamp01(S.bannerT / 0.28)
    const spc = lerp(8, 1, aIn)
    const ts = b.tsize, ss = b.ssize
    const tW = Math.max(tw(b.title, 'h', ts, spc), b.subLines.reduce((m, l) => Math.max(m, segsW(l, 'b', ss)), 0))
    const bw = clamp(tW + 260, 600, Math.min(1400, L.Wu))
    softBand(c, cx - bw / 2, b.backY, bw, b.backH, 120, 45, 0.8)
    text(c, b.title, cx, b.titleY, { f: 'h', size: ts, col: b.col, align: 'center', sp: spc })
    b.subLines.forEach((l, i) => rich(c, l, cx, b.subY + i * ss * 1.25, { f: 'b', size: ss, align: 'center', a: 0.9 }))
  })
  hud.banner = (title, sub, colour, seconds) => {
    S.banners.push({ title: String(title || ''), sub: sub || '', col: col(colour, P.text), dur: seconds || 2.4 })
    if (!S.banner && S.levelT >= 3.6) nextBanner()
  }
  function nextBanner() {
    const b = S.banners.shift()
    if (!b) { S.banner = null; S.bannerT = -1; return }
    layoutBanner(b)
    S.banner = b; S.bannerT = 0
    bannerSp.redraw()
  }
  function layoutBanner(b) {
    const maxW = Math.min(1400, L.Wu - 24) - (L.narrow ? 0 : 40)
    b.tsize = fit(b.title, 'h', 60, maxW, 26, 1)
    const sg = segs(b.sub, P.text)
    b.ssize = fit(sg, 'b', 26, maxW, 18)
    b.subLines = segsW(sg, 'b', b.ssize) > maxW ? wrap(sg, 'b', b.ssize, maxW) : (sg.length ? [sg] : [])
    const extra = Math.max(0, b.subLines.length - 1) * b.ssize * 1.25
    b.titleY = 102; b.subY = 158; b.backY = 47; b.backH = 190 + extra
    bannerSp.size(Math.min(1400, L.Wu), 240 + extra)
  }

  // ---------------------------------------------------------------- level-up card (holds the banners)
  const levelSp = sprite(51, 'hud', (c, w, h) => {
    const v = S.level
    const cx = w / 2, cw = Math.min(760, w - 16)
    glow(c, cx, 100, Math.min(980, w), 180, [255, 158, 51], 0.16 / 0.16 * 0.16)
    rect(c, cx - cw / 2, 14, cw, 180, [8, 10, 15], aS(0.9))
    rect(c, cx - cw / 2, 12.5, cw, 3, P.amber)
    text(c, 'Player level up', cx, 38, { f: 'b', size: 20, col: P.amber, align: 'center', sp: 8 })
    text(c, 'Level ' + v.level, cx, 92, { f: 'h', size: 76, col: P.amber, align: 'center' })
    rect(c, cx - 110, 139, 220, 2, P.amber)
    if (v.line) {
      const sg = segs(v.line, P.text)
      const sz = fit(sg, 'b', 22, cw - 24, 16)
      rich(c, clip(sg, 'b', sz, cw - 24), cx, 166, { f: 'b', size: sz, align: 'center' })
    }
  })
  hud.levelUp = (level, unlockLine) => {
    S.levels.push({ level, line: unlockLine || '' })
    if (S.levelT >= 3.6) nextLevel()
  }
  function nextLevel() {
    const v = S.levels.shift()
    if (!v) return
    S.level = v; S.levelT = 0
    levelSp.size(Math.min(980, L.Wu), 200).redraw()
  }

  // ---------------------------------------------------------------- field-guide card (7 s, queued)
  const guideSp = sprite(41, 'hud', (c, w, h) => {
    const g = S.guide
    panel(c, 0, 0, w, h, { fill: [8, 10, 15], a: 0.86, ch: 10 })
    rect(c, 3, h / 2 - (h - 20) / 2, 4, h - 20, g.col)
    text(c, g.kicker, 26, 12, { f: 'b', size: 16, col: g.col, v: 'top', sp: 6 })
    text(c, g.title, 26, 32, { f: 'h', size: 28, col: P.text, v: 'top' })
    g.lines.forEach((l, i) => rich(c, l, 26, 68 + i * 22, { f: 'b', size: 19, v: 'top', a: DIM_A }))
  })
  hud.fieldGuide = (kicker, title, body, colour) => {
    S.guides.push({ kicker: String(kicker || ''), title: String(title || ''), body: body || '', col: col(colour, P.amber) })
    if (!S.guide) nextGuide()
  }
  function nextGuide() {
    const g = S.guides.shift()
    if (!g) { S.guide = null; return }
    const w = Math.min(820, L.Wu - 16)
    g.lines = wrap(segs(g.body, P.dim), 'b', 19, w - 50)
    S.guide = g; S.guideT = 0
    guideSp.size(w, Math.max(112, 76 + g.lines.length * 22)).redraw()
  }

  // ---------------------------------------------------------------- supply-pod pop (+75 Biomass)
  const podSp = sprite(47, 'hud', (c, w, h) => {
    const v = S.pod
    icon(c, v.icon, 40, 28, 40, v.col)
    text(c, v.text, 70, 28, { f: 'h', size: 34, col: v.col, shadow: 6 })
  })
  hud.podPop = (t, iconName, colour) => {
    const s2 = String(t || '')
    const guess = /armor/i.test(s2) ? ['armor', P.steel] : /core/i.test(s2) ? ['repair', P.cyan] : /barricade/i.test(s2) ? ['barricade', P.amber] : ['biomass', P.lime]
    S.pod = { text: s2, icon: iconName || guess[0], col: col(colour, guess[1]) }
    S.podT = 0
    podSp.size(Math.max(200, 80 + tw(s2, 'h', 34)), 56).redraw()
  }

  // ---------------------------------------------------------------- death overlay
  const deathQ = quad(5, 'hud')
  const deathSp = sprite(52, 'hud', (c, w, h) => {
    softBand(c, w / 2 - Math.min(w, 900) / 2, 0, Math.min(w, 900), h, 72, 27, 0.75)
    text(c, "You're down", w / 2, 40, { f: 'h', size: 64, col: P.danger, align: 'center', sp: 1 })
    if (S.death.sec != null) text(c, 'Respawning at the Core in ' + S.death.sec, w / 2, 108, { f: 'n', size: 34, col: P.text, align: 'center' })
  })
  hud.death = sec => {
    if (sec == null || sec === false) { S.death = null; return }
    const v = sec === true ? null : Math.ceil(sec)
    if (!S.death || S.death.sec !== v) { S.death = { sec: v }; deathSp.size(Math.min(1200, L.Wu), 140).redraw() }
  }

  // ---------------------------------------------------------------- vignettes, scope
  const dmgQ = quad(1, 'hud', vignetteCv)
  const alarmQ = quad(2, 'hud', vignetteCv)
  const scopeQ = quad(3, 'hud', scopeCv)
  const scopeL = quad(3, 'hud'), scopeR = quad(3, 'hud')
  const reticle = []
  for (let i = 0; i < 9; i++) reticle.push(quad(4, 'hud'))
  hud.scope = on => { S.scopeForced = !!on; S.scope = !!on || !!(S.weapon && S.weapon.scoped) }

  // ---------------------------------------------------------------- world-anchored build prompt
  const promptSp = sprite(35, 'hud', (c, w, h) => drawPrompt(c, w, h))
  function promptModel(m) {
    if (L.narrow && !m.compact) m = { ...m, stats: [], lines: [], preview: null }
    const rows = (m.rows || []).slice(0, 2).map(r => ({ key: r.key || 'E', icon: r.icon || 'turret', name: r.name || '', sub: m.compact ? '' : r.sub || '', cost: r.cost, affordable: r.affordable !== false, tint: col(r.tint, P.text), gap: !!r.gap }))
    return { title: m.compact ? '' : m.title || '', rows, stats: m.compact ? [] : (m.stats || []).slice(0, 3), notes: (m.notes || []).slice(0, 2), lines: m.compact ? [] : (m.lines || []).slice(0, 2), preview: m.compact ? null : m.preview || null, onTap: m.onTap }
  }
  function layoutPrompt(m) {
    const W0 = Math.min(460, L.Wu - 32)
    let y = 14
    const items = []
    if (m.title) { items.push(['title', y]); y += 30 }
    for (const r of m.rows) if (!r.gap) { items.push(['row', y, r]); y += 58 }
    for (const st of m.stats) { items.push(['stat', y, st]); y += 24 }
    for (const l of m.lines) { items.push(['line', y, l]); y += 24 }
    if (m.preview) { y += 6; items.push(['preview', y, m.preview]); y += 104 }
    for (const n of m.notes) { items.push(['note', y, n]); y += 28 }
    for (const r of m.rows) if (r.gap) { y += 4; items.push(['row', y, r]); y += 58 }
    const noteOnly = !m.title && !m.rows.length && m.notes.length && !m.stats.length
    const w = noteOnly ? clamp(tw(m.notes[0], 'b', 19) + 40, 200, W0) : W0
    m.items = items; m.w = w; m.h = y + 12 - (m.rows.length && !m.title ? 0 : 0)
    if (noteOnly) m.h = 14 + 28 + 2
  }
  function drawPrompt(c, w) {
    const m = S.prompt.m, h = m.h
    chamfer(c, 0, 0, w, h, 10); c.fillStyle = css([8, 13, 18], aS(0.95)); c.fill()
    rect(c, w * 0.06, h - 2, w * 0.88, 2, P.white, 0.35)
    rect(c, w / 2 - 1, h + 2, 2, 18, P.white, 0.35)
    const W0 = w
    for (const it of m.items) {
      const y = it[1]
      if (it[0] === 'title') text(c, m.title, 18, y, { f: 'h', size: fit(m.title, 'h', 20, W0 - 36), col: P.text, v: 'top' })
      else if (it[0] === 'row') {
        const r = it[2], mid = y + 29
        keycap(c, r.key, 16, mid, 32)
        icon(c, r.icon, 84, mid, 48, mix(r.tint, P.white, 0.35))
        const cc = r.affordable ? P.lime : P.danger
        const costS = r.cost == null ? '' : String(r.cost)
        const costW = costS ? tw(costS, 'n', 28) : 0
        const nameMax = W0 - 118 - (costS ? costW + 50 : 18)
        text(c, r.name, 118, r.sub ? mid + 2 : mid + 14, { f: 'h', size: fit(r.name, 'h', 21, nameMax, 16), col: r.affordable ? P.text : P.dim, a: r.affordable ? 1 : DIM_A, v: 'bottom' })
        if (r.sub) rich(c, clip(segs(r.sub, P.dim), 'b', 17, nameMax), 118, mid + 2, { f: 'b', size: 17, v: 'top', a: DIM_A })
        if (costS) {
          text(c, costS, W0 - 18, mid + 1, { f: 'n', size: 28, col: cc, align: 'right' })
          icon(c, 'biomass', W0 - 18 - Math.max(70, costW) - 12, mid, 20, cc)
        }
      } else if (it[0] === 'stat') {
        const st = it[2], u = st.unit || ''
        rich(c, [[st.label, P.dim, DIM_A], ['   ' + st.from + u + '  ', P.text, 1], ['→  ' + st.to + u, P.lime, 1]], 118, y, { f: 'b', size: 19, v: 'top' })
      } else if (it[0] === 'line') rich(c, clip(segs(it[2], P.text), 'b', 19, W0 - 136), 118, y, { f: 'b', size: 19, v: 'top' })
      else if (it[0] === 'note') text(c, it[2], 18, y, { f: 'b', size: 19, col: P.dim, a: DIM_A, v: 'top' })
      else if (it[0] === 'preview') {
        const pv = it[2], tint = col(pv.tint, P.text)
        rect(c, 18, y + 4, 150, 96, P.white, 0.05)
        icon(c, pv.icon || 'turret', 93, y + 52, 84, mix(tint, P.white, 0.35))
        rich(c, [['Next', P.dim, DIM_A], ['  ' + (pv.name || ''), mix(tint, P.white, 0.55), 1]], 184, y + 8, { f: 'h', size: 20, v: 'top' })
        wrap(segs(pv.blurb || '', P.dim), 'b', 17, W0 - 202).slice(0, 3).forEach((l, i) => rich(c, l, 184, y + 36 + i * 20, { f: 'b', size: 17, v: 'top', a: DIM_A }))
      }
    }
  }
  const PR = { src: null, sig: '', m: null, has: false, tx: 0, ty: 0, pos: [0, 0], placed: false }
  hud.prompt = (m, sx, sy) => {
    if (!m) { PR.has = false; return }
    // the same model object as last frame: nothing to compare (towers passes a new object when the content changes)
    if (m !== PR.src || !PR.m) {
      PR.src = m
      const sig = JSON.stringify(m, (key, val) => (typeof val === 'function' ? undefined : val))
      if (!PR.m || PR.sig !== sig) {
        const pm = promptModel(m)
        layoutPrompt(pm)
        if (!PR.has || !S.prompt) PR.placed = false
        PR.sig = sig; PR.m = pm
        promptSp.size(pm.w, pm.h + 22).redraw()
      }
    }
    PR.m.onTap = m.onTap
    PR.tx = sx / s; PR.ty = sy / s; PR.has = true
    S.prompt = PR
  }

  // ---------------------------------------------------------------- edge markers (pod, last hostiles, Siege Nodes, turrets)
  const markerPool = []
  function markerSprites() {
    const lab = sprite(33, 'hud', (c, w, h) => {
      const m = rec, st = MK[m.kind] || MK.turret
      const pw = w, ph = st.plate
      chamfer(c, 0, 0, pw, ph, 6); c.fillStyle = css(m.plateCol || [10, 8, 12], aS(0.85)); c.fill()
      text(c, m.label, pw / 2, st.labY, { f: st.f, size: st.size, col: m.col, align: 'center', v: 'top' })
      if (m.bar != null) {
        rect(c, pw / 2 - 75, st.barY, 150, 4, P.black, 0.5)
        rect(c, pw / 2 - 75, st.barY, 150 * clamp01(m.bar), 4, m.col)
      }
    })
    const ic = sprite(34, 'hud', (c, w, h) => { icon(c, ic.icon, w / 2, h / 2, w, ic.col) })
    const rec = { lab, ic, labSrc: undefined, kind: '', label: '', lw: 0, col: [-1, -1, -1], bar: null, barQ: -2, plateCol: PLATE_DEF }
    return rec
  }
  const MK = {
    turret: { plate: 40, labY: 3, size: 18, f: 'h', barY: 30, icon: 32, iconY: -23, plateY: -5, min: 206 },
    siege: { plate: 40, labY: 3, size: 19, f: 'h', barY: 30, icon: 32, iconY: -23, plateY: -5, min: 196 },
    pod: { plate: 26, labY: 1, size: 17, f: 'h', barY: 0, icon: 28, iconY: -14, plateY: 1, min: 240 },
    hostile: { plate: 26, labY: 2, size: 17, f: 'n', barY: 0, icon: 22, iconY: -12, plateY: 0, min: 84 },
  }
  hud.markers = list => { S.markers = list || NONE }

  // ---------------------------------------------------------------- turret callout (§9.8)
  const callSp = sprite(36, 'hud', (c, w, h) => {
    const v = S.callout
    panel(c, 0, 0, w, 58, { a: 0.85, accent: v.col })
    icon(c, 'turret', 34, 26, 34, v.col)
    glow(c, 49, 40, 26, 26, [5, 5, 8], 0.9)
    icon(c, v.icon, 49, 40, 17, v.col)
    rich(c, v.segs, 70, 28, { f: 'h', size: 21 })
  })
  let calloutSrc = null
  hud.turretCallout = v => {
    if (!v) { if (S.callout && S.calloutT > 0.4) S.calloutT = 0.4; S.calloutSig = ''; calloutSrc = null; return }
    if (v === calloutSrc) return
    calloutSrc = v
    const sig = JSON.stringify(v)
    if (sig === S.calloutSig) return
    S.calloutSig = sig
    const cl = col(v.colour, P.danger)
    const sg = v.head ? [[v.head, cl, 1], [' — ' + (v.text || ''), P.text, 1]] : segs(v.text || '', P.text)
    const w = clamp(segsW(sg, 'h', 21) + 96, 380, Math.min(900, L.Wu - 40))
    S.callout = { col: cl, segs: clip(sg, 'h', 21, w - 82), icon: v.icon || 'alert' }
    S.calloutT = 4.5
    callSp.size(w, 58).redraw()
  }
  /** builds the callout text from the turrets that need the player (HudController.Turrets.ShowTurretCallout) */
  hud.turretCalloutText = list => {
    const n = list.length
    if (!n) return null
    let jammed = 0, destroyed = 0, attacked = 0, leeches = 0
    for (const t of list) { if (t.state === 'jammed') { jammed++; leeches += t.leeches || 1 } else if (t.state === 'destroyed') destroyed++; else attacked++ }
    const leech = leeches > 1 ? 'Leeches' : 'Leech'
    const names = n === 1 ? list[0].label : n === 2 ? list[0].label + ' and ' + list[1].label : String(n)
    let head, tail
    if (jammed === n) { head = names + (n === 1 ? ' turret jammed' : ' turrets jammed'); tail = 'clear the ' + leech }
    else if (destroyed === n) { head = names + (n === 1 ? ' turret destroyed' : ' turrets destroyed'); tail = n === 1 ? 'rebuild it' : 'rebuild them' }
    else if (attacked === n) { head = names + (n === 1 ? ' turret under attack' : ' turrets under attack'); tail = n === 1 ? Math.max(1, Math.round((list[0].integrity == null ? 1 : list[0].integrity) * 100)) + '% left' : 'defend them' }
    else {
      head = n + ' turrets need you'
      const parts = []
      if (jammed) parts.push(jammed + ' jammed')
      if (attacked) parts.push(attacked + ' under attack')
      if (destroyed) parts.push(destroyed + ' destroyed')
      tail = parts.join(', ') + (jammed ? '  ·  clear the ' + leech : '')
    }
    return { head, text: tail, colour: jammed ? P.jam : P.danger, icon: jammed === 0 && attacked === 0 ? 'repair' : 'alert' }
  }

  // ---------------------------------------------------------------- tutorial card (32, 32) 540 x 150
  const tutSp = sprite(37, 'hud', (c, w, h) => {
    const v = S.tut
    panel(c, 0, 0, w, h, { fill: [8, 13, 18], a: 0.82 })
    rect(c, 0, 18, 3, 44, P.amber)
    text(c, `Training  ·  ${v.step} of ${v.total}`, 24, 12, { f: 'b', size: 17, col: P.dim, a: DIM_A, v: 'top' })
    const keys = v.keys || []
    let kx = w - 24, kwTot = 0
    for (let i = keys.length - 1; i >= 0; i--) kwTot += keyW(keys[i], 30) + (i ? 6 : 0)
    text(c, v.title, 24, 34, { f: 'h', size: fit(v.title, 'h', 28, w - 60 - kwTot), col: P.text, v: 'top' })
    if (v.done) icon(c, 'check', w - 50, 50, 40 * (S.tutCheck < 1 ? lerp(1.6, 1, easeOutBack(S.tutCheck)) : 1), P.lime)
    else for (let i = keys.length - 1; i >= 0; i--) { const kw = keyW(keys[i], 30); kx -= kw; keycap(c, keys[i], kx, 51, 30); kx -= 6 }
    v.lines.forEach((l, i) => rich(c, l, 24, 76 + i * 25, { f: 'b', size: 21, v: 'top' }))
    for (let i = 0; i < v.total; i++) rect(c, 24 + i * 22, h - 18, 16, 4, i < v.step - 1 ? P.lime : i === v.step - 1 ? P.amber : P.white, i < v.step ? 1 : 0.2)
    if (v.skip !== false) {
      const kw = keycap(c, L.touch ? 'Tap' : 'F1', w - 70 - keyW(L.touch ? 'Tap' : 'F1', 22), h - 19, 22)
      text(c, 'skip', w - 24, h - 19, { f: 'b', size: 16, col: P.dim, a: DIM_A, align: 'right' })
      S.tutSkipW = kw
    }
  })
  hud.tutorial = v => {
    if (!v) { S.tut = null; return }
    if (S.tut && S.tut.src === v && S.tut.wu === L.Wu) { S.tut.onSkip = v.onSkip; return }
    const sig = JSON.stringify(v, (key, val) => (typeof val === 'function' ? undefined : val)) + L.Wu
    if (!S.tut || S.tut.sig !== sig) {
      const w = Math.min(540, L.Wu - 16)
      const lines = wrap(segs(v.body || '', P.text), 'b', 21, w - 48).slice(0, 3)
      if (v.done && !(S.tut && S.tut.done)) S.tutCheck = 0
      S.tut = { step: v.step || 1, total: v.total || 11, title: v.title || '', keys: v.keys || [], done: !!v.done, lines, sig, skip: v.skip, onSkip: v.onSkip, src: v, wu: L.Wu }
      tutSp.size(w, Math.max(150, 76 + lines.length * 25 + 30)).redraw()
    }
    S.tut.onSkip = v.onSkip; S.tut.src = v; S.tut.wu = L.Wu
  }
  S.tutCheck = 1

  // ================================================================== full screens
  const screenBg = quad(100, 'screen')
  const screenVig = quad(101, 'screen', vignetteCv)
  const shadeQ = quad(101, 'screen') // title screen: left readability shade (drawn as a sprite gradient below)
  const scr = { title: null, evolution: null, gear: null, pause: null, guide: null, end: null }
  const noFns = (key, val) => (typeof val === 'function' ? undefined : val)
  const sigOf = m => JSON.stringify(m, noFns)
  const screenSp = sprite(110, 'screen', (c, w, h) => { const o = openScreen(); if (o && o.draw) o.draw(c, w, h) })
  const scrA = sprite(111, 'screen', (c, w, h) => { const o = openScreen(); if (o && o.drawA) o.drawA(c, w, h) })
  const scrB = sprite(112, 'screen', (c, w, h) => { const o = openScreen(); if (o && o.drawB) o.drawB(c, w, h) })
  const evoRows = [0, 1, 2].map(i => sprite(113 + i, 'screen', (c, w, h) => { const o = scr.evolution; if (o) o.drawRow(c, w, h, i) }))
  const gearSpS = sprite(95, 'screen', (c, w, h) => { if (scr.gear) scr.gear.draw(c, w, h) })
  /** the topmost open full screen (input goes to it) */
  function openScreen() { return scr.guide || scr.pause || scr.evolution || scr.end || scr.title || null }
  function modalOpen() { return !!(openScreen() || scr.gear) }

  // shared: focusable buttons in screen units
  function hitButton(o, x, y) {
    if (!o || !o.buttons) return -1
    for (let i = o.buttons.length - 1; i >= 0; i--) {
      const b = o.buttons[i]
      if (!b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i
    }
    return -1
  }
  function activate(o, i) { const b = o && o.buttons && o.buttons[i]; if (b && !b.disabled && b.onClick) b.onClick() }
  function moveFocus(o, d) {
    if (!o || !o.buttons || !o.buttons.length) return
    const n = o.buttons.length
    let i = o.focus < 0 ? 0 : o.focus
    for (let t = 0; t < n; t++) { i = (i + d + n) % n; if (!o.buttons[i].disabled) break }
    o.focus = i
    o.dirty()
  }

  // ---------------------------------------------------------------- title screen (web: no Quit; Start run; controls; this week's best)
  const DEFAULT_CONTROLS = [
    [['W', 'A', 'S', 'D'], 'Move'], [['Mouse'], 'Look'], [['LMB'], 'Fire'], [['RMB'], 'Aim'], [['Shift'], 'Sprint'], [['Space'], 'Jump'], [['C'], 'Dodge roll'],
    [['R'], 'Reload'], [['1', '2'], 'Swap weapon'], [['E'], 'Build · upgrade · repair'], [['Q'], 'Other tower · Shield'], [['G'], 'Start the wave'],
    [['B'], 'Gear locker'], [['H'], 'Hive guide'], [['Esc'], 'Pause'],
  ]
  const TOUCH_CONTROLS = [[['Stick'], 'Move'], [['Drag'], 'Look'], [['FIRE'], 'Shoot · hold for automatics'], [['E'], 'Build · upgrade · repair'], [['Q'], 'Other tower · Shield'], [['G'], 'Start the wave'], [['II'], 'Pause']]
  hud.title = m => {
    if (!m) { scr.title = null; return }
    if (scr.title && scr.title.m === m) return
    const sig = sigOf(m)
    if (scr.title && scr.title.sig === sig) { scr.title.m = m; return }
    const o = { m, sig, focus: 0, buttons: [], dirty: () => screenSp.redraw() }
    o.draw = (c, w, h) => drawTitle(c, w, h, o)
    o.key = code => {
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'KeyG') { if (o.m.onStart) o.m.onStart(); return true }
      if (code === 'KeyT' && o.m.onTutorial) { o.m.onTutorial(); return true }
      if (o.m.onFighter && (code === 'KeyF' || code === 'ArrowRight')) { o.m.onFighter(1); return true }
      if (o.m.onFighter && code === 'ArrowLeft') { o.m.onFighter(-1); return true }
      return true
    }
    scr.title = o
    screenSp.redraw()
  }
  /** the line under Start run: "<bestLabel>  ·  wave N" (default label "Your best this week") */
  const bestLine = m => (m.best > 0 ? (m.bestLabel || 'Your best this week') + '  ·  wave ' + m.best : 'Endless waves  ·  how long can the Core hold?')
  function controlRows(c, list, x, y, colW, rowH, cols) {
    list.forEach((r, i) => {
      const cx = x + (i % cols) * colW, cy = y + Math.floor(i / cols) * rowH
      let kx = cx
      for (const kk of r[0]) kx += keycap(c, kk, kx, cy, 26) + 4
      const lx = Math.max(kx + 6, cx + 104), room = colW - (lx - cx) - 10
      text(c, r[1], lx, cy, { f: 'b', size: fit(r[1], 'b', 19, room, 16), col: P.text })
    })
    return Math.ceil(list.length / cols) * rowH
  }
  /** the week's table; `note` (the prize) sits right of the title, or under it when it does not fit; the owner's row
   *  takes no place, so it gets no rank; the first `places` ranks (the prize places) are amber */
  function leaderboard(c, x, y, w, rows, title, note, places) {
    const n = Math.min(rows.length, L.narrow ? 6 : 10)
    const under = !!note && tw(title, 'h', 24) + tw(note, 'b', 18) + 76 > w
    const top = 70 + (under ? 26 : 0)
    const h = top + Math.max(1, n) * 34 + 14
    panel(c, x, y, w, h, { fill: [5, 7, 11], a: 0.88, ch: 12 })
    rect(c, x, y + 22, 3, 26, P.amber)
    text(c, title, x + 26, y + 18, { f: 'h', size: 24, col: P.text, v: 'top' })
    if (note) {
      if (under) text(c, note, x + 26, y + 56, { f: 'b', size: fit(note, 'b', 18, w - 52), col: P.amber, v: 'top' })
      else text(c, note, x + w - 24, y + 22, { f: 'b', size: 18, col: P.amber, align: 'right', v: 'top' })
    }
    if (!n) text(c, 'No runs yet this week. Be the first.', x + 26, y + top + 17, { f: 'b', size: 19, col: P.dim, a: DIM_A })
    let rank = 0
    for (let i = 0; i < n; i++) {
      const r = rows[i], ry = y + top + i * 34 + 17, you = !!r.you, own = !!r.owner
      if (you) rect(c, x + 14, ry - 15, w - 28, 30, P.amber, 0.12)
      const cl = you ? P.amber : own ? P.dim : P.text
      const rk = own ? 0 : (r.rank || ++rank)
      const prize = rk > 0 && places > 0 && rk <= places
      text(c, rk ? String(rk) : '·', x + 26, ry, { f: 'n', size: 22, col: you || prize ? P.amber : P.dim, a: you || prize ? 1 : DIM_A })
      const nm = String(r.name || '—') + (own ? '  (owner)' : '')
      text(c, nm, x + 66, ry, { f: 'b', size: fit(nm, 'b', 21, w - 200), col: cl, a: own && !you ? DIM_A : 1 })
      text(c, 'wave ' + (r.score == null ? 0 : r.score), x + w - 26, ry, { f: 'n', size: 22, col: cl, align: 'right', a: own && !you ? DIM_A : 1 })
    }
    return h
  }
  /** the fighter picker: a portrait tile per fighter (click to pick, F cycles), a "+" tile that tells how to bring your
   *  own (ask your AI agent; it shows up here as YOURS), the picked fighter's name; returns its height */
  function fighterCard(c, o, x, y, w) {
    const f = o.m.fighter
    const tiles = f.tiles || [{ id: f.id, name: f.name, img: null }]
    const plus = f.plus ? String(f.plus) : ''
    const n = tiles.length + (plus ? 1 : 0)
    const gap = 10
    const T = Math.round(Math.max(60, Math.min(100, (w - 44 - 170 - gap * (n - 1)) / Math.max(1, n))))
    const open = !!(f.plusOpen && plus)
    const note = open ? plus : (f.hint ? String(f.hint) : '')
    const noteLines = note ? wrap([[note, open ? P.amber : P.dim, open ? 1 : DIM_A]], 'b', 17, w - 52).slice(0, 3) : []
    const h = 60 + T + 18 + (noteLines.length ? noteLines.length * 24 + 4 : 0)
    panel(c, x, y, w, h, { fill: [5, 7, 11], a: 0.88, ch: 12 })
    rect(c, x, y + 22, 3, 26, P.amber)
    text(c, 'Fighter', x + 26, y + 18, { f: 'h', size: 24, col: P.text, v: 'top' })
    text(c, (f.pos || '') + (L.touch ? '' : '   ·   F to change'), x + w - 24, y + 22, { f: 'b', size: 17, col: P.dim, a: DIM_A, align: 'right', v: 'top' })
    const ty = y + 60
    tiles.forEach((t, i) => {
      const tx = x + 22 + i * (T + gap)
      const bi = o.buttons.length
      o.buttons.push({ x: tx, y: ty, w: T, h: T, label: '', tile: true, onClick: () => o.m.onFighterPick ? o.m.onFighterPick(i) : o.m.onFighter && o.m.onFighter(1) })
      portraitTile(c, tx, ty, T, t, i === f.index, o.focus === bi)
    })
    if (plus) {
      const tx = x + 22 + tiles.length * (T + gap)
      const bi = o.buttons.length
      o.buttons.push({ x: tx, y: ty, w: T, h: T, label: '', tile: true, onClick: () => o.m.onFighterPlus && o.m.onFighterPlus() })
      plusTile(c, tx, ty, T, open, o.focus === bi)
    }
    // the picked fighter, right of the tiles
    const nx = x + 22 + n * (T + gap) - gap + 18, room = x + w - 22 - nx
    const nm = String(f.name || '')
    text(c, nm, nx, ty + T * 0.36, { f: 'h', size: fit(nm, 'h', 30, room, 15), col: P.amber })
    const sb = String(f.sub || '')
    text(c, sb, nx, ty + T * 0.72, { f: 'b', size: fit(sb, 'b', 17, room, 11), col: P.dim, a: DIM_A })
    noteLines.forEach((ln, k) => rich(c, ln, x + 26, ty + T + 18 + k * 24 + 10, { f: 'b', size: 17 }))
    return h
  }
  function portraitTile(c, x, y, T, t, sel, focused) {
    chamfer(c, x, y, T, T, 9)
    c.fillStyle = css([12, 16, 22], 0.96); c.fill()
    if (t.img) {
      c.save(); chamfer(c, x, y, T, T, 9); c.clip()
      c.globalAlpha = sel ? 1 : 0.78
      c.drawImage(t.img, x, y, T, T)
      c.globalAlpha = 1; c.restore()
    } else {
      const ini = String(t.name || '?').trim().charAt(0).toUpperCase() || '?'
      text(c, ini, x + T / 2, y + T / 2, { f: 'h', size: Math.round(T * 0.5), col: sel ? P.amber : P.dim, a: 0.9, align: 'center' })
    }
    if (t.mine) {
      const cw = Math.min(T - 8, 52), chh = 16
      rect(c, x + (T - cw) / 2, y + T - chh - 4, cw, chh, P.amber, 0.95)
      text(c, 'YOURS', x + T / 2, y + T - chh / 2 - 4, { f: 'h', size: 12, col: [18, 13, 5], align: 'center', sp: 1 })
    }
    chamfer(c, x + 1, y + 1, T - 2, T - 2, 9)
    c.lineWidth = sel ? 3 : focused ? 2 : 1.5
    c.strokeStyle = sel ? css(P.amber, 1) : focused ? css(P.text, 0.8) : css([160, 172, 185], 0.35)
    c.stroke()
  }
  function plusTile(c, x, y, T, open, focused) {
    chamfer(c, x, y, T, T, 9)
    c.fillStyle = css(open ? [40, 28, 10] : [12, 16, 22], 0.9); c.fill()
    c.save()
    chamfer(c, x + 1.5, y + 1.5, T - 3, T - 3, 9)
    c.setLineDash([6, 5]); c.lineWidth = open || focused ? 2.5 : 2
    c.strokeStyle = css(open ? P.amber : focused ? P.text : P.amber, open || focused ? 1 : 0.6)
    c.stroke(); c.restore()
    const cx = x + T / 2, cy = y + T * 0.42, arm = T * 0.17, th = Math.max(3, T * 0.06)
    rect(c, cx - arm, cy - th / 2, arm * 2, th, P.amber, open ? 1 : 0.9)
    rect(c, cx - th / 2, cy - arm, th, arm * 2, P.amber, open ? 1 : 0.9)
    const lab = 'ADD YOURS'
    text(c, lab, cx, y + T * 0.8, { f: 'h', size: fit(lab, 'h', Math.max(10, Math.round(T * 0.14)), T - 10, 9), col: P.amber, a: open ? 1 : 0.85, align: 'center', sp: 1 })
  }
  function drawTitle(c, w, h, o) {
    const m = o.m, nar = L.narrow
    const ctrls = m.controls || (L.touch ? TOUCH_CONTROLS : DEFAULT_CONTROLS)
    o.buttons = []
    if (!nar) {
      // left column at x 120, centred vertically (BootMenu)
      const g = c.createLinearGradient(0, 0, w * 0.6, 0)
      g.addColorStop(0, 'rgba(3,4,5,' + aS(0.85) + ')'); g.addColorStop(0.55, 'rgba(3,4,5,' + aS(0.85) * 0.6 + ')'); g.addColorStop(1, 'rgba(3,4,5,0)')
      c.fillStyle = g; c.fillRect(0, 0, w * 0.6, h)
      const x = 120, cy = h / 2
      glow(c, x + 300, cy - 290, 860, 320, [255, 140, 38], 0.14)
      text(c, 'Hive Adapt', x - 6, cy - 300, { f: 'h', size: 132, col: P.text })
      rect(c, x, cy - 207.5, 140, 3, P.amber)
      text(c, 'Hold the Core. The Hive learns.', x, cy - 172, { f: 'b', size: 30, col: P.amber })
      const sb = { x, y: cy - 70 - 34, w: 440, h: 68, label: m.startLabel || 'Start run', primary: true, onClick: () => m.onStart && m.onStart() }
      o.buttons.push(sb)
      button(c, sb, o.focus === 0)
      if (m.onTutorial) { // optional: a run with the step-by-step tutorial cards
        const tb = { x: x + 456, y: sb.y, w: 200, h: 68, label: 'Tutorial', onClick: () => m.onTutorial() }
        o.buttons.push(tb)
        button(c, tb, o.focus === o.buttons.length - 1)
      }
      textFit(c, bestLine(m), x + 2, cy + 10, 600, { f: 'b', size: 22, col: m.best > 0 ? P.amber : P.dim, a: m.best > 0 ? 1 : DIM_A })
      // controls
      const cw2 = 620, rowsN = Math.ceil(ctrls.length / 2)
      const ch2 = 66 + rowsN * 36 + 10
      const cyTop = cy + 48
      panel(c, x, cyTop, cw2, ch2, { fill: [5, 7, 11], a: 0.88, ch: 12 })
      rect(c, x, cyTop + 22, 3, 26, P.amber)
      text(c, 'Controls', x + 26, cyTop + 18, { f: 'h', size: 24, col: P.text, v: 'top' })
      text(c, m.controlsNote || (L.touch ? 'touch' : 'mouse drag also aims'), x + cw2 - 24, cyTop + 22, { f: 'b', size: 17, col: P.dim, a: DIM_A, align: 'right', v: 'top' })
      controlRows(c, ctrls, x + 26, cyTop + 66 + 13, 300, 36, 2)
      // this week's best waves (right)
      const lw = 560, lx = w - 120 - lw
      const lbH = leaderboard(c, lx, cy - 300, lw, m.table || [], m.tableTitle || "This week's best waves", m.tableNote, m.prizePlaces)
      if (m.fighter) fighterCard(c, o, lx, cy - 300 + lbH + 18, lw)
      text(c, m.footer || 'Runs are not saved between visits  ·  play as many as you like', w - 40, h - 26, { f: 'b', size: 18, col: P.dim, a: DIM_A, align: 'right', v: 'bottom' })
    } else {
      rect(c, 0, 0, w, h, [3, 4, 5], aS(0.6))
      const x = 24, cw2 = w - 48
      let y = 60 + L.insT
      const ts = fit('Hive Adapt', 'h', 96, cw2)
      text(c, 'Hive Adapt', x - 3, y + ts * 0.4, { f: 'h', size: ts, col: P.text })
      y += ts * 0.9
      rect(c, x, y, 120, 3, P.amber)
      y += 30
      text(c, 'Hold the Core. The Hive learns.', x, y, { f: 'b', size: fit('Hold the Core. The Hive learns.', 'b', 26, cw2), col: P.amber })
      y += 40
      const tw2 = m.onTutorial ? Math.min(170, Math.round(cw2 * 0.36)) : 0
      const sb = { x, y, w: cw2 - (tw2 ? tw2 + 12 : 0), h: 72, label: m.startLabel || 'Start run', primary: true, onClick: () => m.onStart && m.onStart() }
      o.buttons.push(sb)
      button(c, sb, o.focus === 0)
      if (tw2) {
        const tb = { x: x + cw2 - tw2, y, w: tw2, h: 72, label: 'Tutorial', align: 'center', onClick: () => m.onTutorial() }
        o.buttons.push(tb)
        button(c, tb, o.focus === o.buttons.length - 1)
      }
      y += 72 + 26
      const bl = bestLine(m)
      text(c, bl, x, y, { f: 'b', size: fit(bl, 'b', 21, cw2), col: m.best > 0 ? P.amber : P.dim })
      y += 30
      if (m.fighter) y += fighterCard(c, o, x, y, cw2) + 16
      y += leaderboard(c, x, y, cw2, m.table || [], m.tableTitle || "This week's best waves", m.tableNote, m.prizePlaces) + 16
      const rowsN = ctrls.length
      const chH = 66 + rowsN * 36 + 6
      if (y + chH < h - 50) {
        panel(c, x, y, cw2, chH, { fill: [5, 7, 11], a: 0.88, ch: 12 })
        rect(c, x, y + 22, 3, 26, P.amber)
        text(c, 'Controls', x + 26, y + 18, { f: 'h', size: 24, col: P.text, v: 'top' })
        controlRows(c, ctrls, x + 26, y + 66 + 13, cw2, 36, 1)
        y += chH + 16
      }
      const ft = m.footer || 'Runs are not saved between visits'
      text(c, ft, w / 2, Math.min(h - 20 - L.insB, Math.max(y + 20, h - 40)), { f: 'b', size: fit(ft, 'b', 18, cw2), col: P.dim, a: DIM_A, align: 'center', v: 'bottom' })
    }
  }

  // ---------------------------------------------------------------- evolution report (EvolutionScreen.cs)
  let evoDoneSig = null
  hud.evolution = m => {
    if (!m) { evoDoneSig = null; if (scr.evolution) scr.evolution.closing = scr.evolution.closing >= 0 ? scr.evolution.closing : 0; return }
    if (scr.evolution && scr.evolution.m === m) return
    const sig = sigOf(m)
    if (scr.evolution && scr.evolution.sig === sig) { scr.evolution.m = m; return }
    if (sig === evoDoneSig) return // dismissed: stays closed until the lead passes null or another report
    const o = { m, sig, t: 0, closing: -1, buttons: [], focus: -1, dirty: () => screenSp.redraw() }
    o.rows = (m.rows || []).slice(0, 3).map(r => ({ reason: String(r.reason || ''), name: String(r.name || '') + (roman(r.stacks || 1) ? '  ' + roman(r.stacks || 1) : ''), effect: String(r.effect || ''), col: col(r.colour, P.amber) }))
    o.dismiss = () => { if (o.t >= 2.2 && o.closing < 0) o.closing = 0 }
    o.key = code => { if (['KeyG', 'KeyE', 'Space', 'Enter', 'NumpadEnter'].includes(code)) o.dismiss(); return true }
    o.click = () => { o.dismiss(); return true }
    o.draw = (c, w, h) => drawEvoStatic(c, w, h, o)
    o.drawA = (c, w, h) => drawEvoTitle(c, w, h, o)
    o.drawB = (c, w, h) => drawEvoGen(c, w, h, o)
    o.drawRow = (c, w, h, i) => drawEvoRow(c, w, h, o, i)
    scr.evolution = o
    layoutEvo(o)
    screenSp.redraw(); scrA.redraw(); scrB.redraw()
    evoRows.forEach(r => r.redraw())
  }
  function layoutEvo(o) {
    const nar = L.narrow, cx = L.Wu / 2, cy = L.Hu / 2, n = o.rows.length
    const Y = {}
    if (!nar) {
      Y.kicker = cy - 330; Y.title = cy - 248; Y.gen = cy - 160; Y.heads = cy - 92
      Y.rows = o.rows.map((r, i) => cy - ((n - 1) * 56 - 26 - i * 112))
      Y.rowW = Math.min(1500, L.Wu - 40); Y.rowH = 100
      Y.adviceH = cy + 222; Y.advice = cy + 256; Y.foot = cy + 366
      Y.titleSize = fit('HIVE EVOLVED', 'h', 124, L.Wu - 80, 40, 4)
    } else {
      const cw = L.Wu - 24
      let y = 40 + L.insT
      Y.kicker = y; y += 44
      Y.titleSize = fit('HIVE EVOLVED', 'h', 124, cw, 40, 4)
      Y.title = y + Y.titleSize * 0.45; y += Y.titleSize * 0.95
      Y.gen = y + 10; y += 60
      Y.rowW = cw
      Y.rowLay = o.rows.map(r => {
        const reason = wrap(segs(r.reason), 'b', 24, cw - 40)
        const nameS = fit(r.name, 'h', 30, cw - 40)
        const eff = wrap(segs(r.effect, P.dim), 'b', 20, cw - 40)
        return { reason, nameS, eff, h: 20 + reason.length * 28 + 10 + nameS + 6 + eff.length * 24 + 16 }
      })
      Y.rows = []
      Y.heads = y
      y += 4
      for (const rl of Y.rowLay) { Y.rows.push(y + rl.h / 2); y += rl.h + 12 }
      y += 10
      Y.adviceLines = wrap(segs(o.m.advice || ''), 'b', 22, cw)
      Y.adviceH = y; y += 30
      Y.advice = y; y += Y.adviceLines.length * 28 + 20
      Y.seenLines = wrap(segs(o.m.seen || '', P.text), 'b', 20, cw)
      Y.foot = y; y += 30 + Y.seenLines.length * 26 + 50
      Y.total = y
    }
    o.Y = Y
    // animated sprites: title, generation, rows
    scrA.size(L.Wu, Y.titleSize * 1.3).at(cx, Y.title, 0.5, 0.5)
    scrB.size(Math.min(L.Wu, 900), 60).at(cx, Y.gen, 0.5, 0.5)
    o.rows.forEach((r, i) => evoRows[i].size(Y.rowW, nar ? Y.rowLay[i].h : 100).at(cx, Y.rows[i], 0.5, 0.5))
  }
  function drawEvoStatic(c, w, h, o) {
    const Y = o.Y, cx = w / 2, m = o.m, nar = L.narrow
    text(c, 'THE HIVE HAS STUDIED YOU', cx, Y.kicker, { f: 'b', size: 22, col: P.dim, a: DIM_A, align: 'center', sp: 9 })
    if (!nar) {
      text(c, 'WHAT IT LEARNED', cx - 70, Y.heads, { f: 'h', size: 18, col: P.dim, a: DIM_A, align: 'right', sp: 5 })
      text(c, 'WHAT IT IS DOING', cx + 70, Y.heads, { f: 'h', size: 18, col: P.dim, a: DIM_A, sp: 5 })
    }
    const footA = clamp01((o.t - (1.45 + o.rows.length * 0.75)) / 0.5)
    if (footA <= 0) return
    c.globalAlpha = footA
    if (m.advice) {
      text(c, 'WHAT YOU CAN DO NOW', cx, Y.adviceH, { f: 'h', size: 18, col: P.amber, align: 'center', sp: 5 })
      if (!nar) { const sg = segs(m.advice); rich(c, sg, cx, Y.advice, { f: 'b', size: fit(sg, 'b', 26, w - 80), align: 'center' }) }
      else Y.adviceLines.forEach((l, i) => rich(c, l, cx, Y.advice + i * 28, { f: 'b', size: 22, align: 'center' }))
    }
    if (!nar) {
      text(c, 'WHAT THE HIVE SAW SINCE IT LAST CHANGED', cx, Y.foot - 52, { f: 'h', size: 18, col: P.dim, a: DIM_A, align: 'center', sp: 5 })
      const sg = segs(m.seen || 'No damage dealt', P.text)
      rich(c, sg, cx, Y.foot - 18, { f: 'b', size: fit(sg, 'b', 22, w - 80), align: 'center' })
      const hw2 = keyW('G', 32) + 12 + tw('continue  ·  the swarm has changed', 'b', 22)
      keycap(c, 'G', cx - hw2 / 2, Y.foot + 48, 32)
      text(c, 'continue  ·  the swarm has changed', cx - hw2 / 2 + keyW('G', 32) + 12, Y.foot + 48, { f: 'b', size: 22, col: P.dim, a: DIM_A })
    } else {
      text(c, 'WHAT THE HIVE SAW', cx, Y.foot, { f: 'h', size: 17, col: P.dim, a: DIM_A, align: 'center', sp: 5 })
      Y.seenLines.forEach((l, i) => rich(c, l, cx, Y.foot + 30 + i * 26, { f: 'b', size: 20, align: 'center' }))
      const ky = Y.foot + 30 + Y.seenLines.length * 26 + 30
      const lab = L.touch ? 'Tap to continue  ·  the swarm has changed' : 'continue  ·  the swarm has changed'
      const kw = L.touch ? 0 : keyW('G', 30) + 10
      const ls = fit(lab, 'b', 21, w - 40 - kw)
      if (!L.touch) keycap(c, 'G', cx - (kw + tw(lab, 'b', ls)) / 2, ky, 30)
      text(c, lab, cx - (kw + tw(lab, 'b', ls)) / 2 + kw, ky, { f: 'b', size: ls, col: P.dim, a: DIM_A })
    }
    c.globalAlpha = 1
  }
  function drawEvoTitle(c, w, h, o) {
    const tk = clamp01((o.t - 0.2) / 0.45)
    const spc = lerp(34, 4, 1 - (1 - tk) * (1 - tk))
    const size = o.Y.titleSize
    text(c, 'HIVE EVOLVED', w / 2, h / 2, { f: 'h', size: fit('HIVE EVOLVED', 'h', size, w - 20, 30, spc), col: P.hive, align: 'center', sp: spc })
  }
  function drawEvoGen(c, w, h, o) {
    const gk = clamp01((o.t - 0.85) / 0.4)
    const g = 'GENERATION ' + (o.m.generation || 2)
    const gw = text(c, g, w / 2, h / 2, { f: 'h', size: 38, col: P.amber, align: 'center', sp: 6 })
    const rule = Math.min(lerp(0, 260, easeOutBack(gw > 0 ? gk : 0)), (w - gw) / 2 - 40)
    if (rule > 0) { rect(c, w / 2 - gw / 2 - 30 - rule, h / 2 - 1, rule, 2, P.amber); rect(c, w / 2 + gw / 2 + 30, h / 2 - 1, rule, 2, P.amber) }
  }
  function drawEvoRow(c, w, h, o, i) {
    const r = o.rows[i]
    if (!r) return
    chamfer(c, 0, 0, w, h, 10); c.fillStyle = css([15, 5, 4], aS(0.72)); c.fill()
    const cx = w / 2
    if (!L.narrow) {
      text(c, r.reason, cx - 70, h / 2, { f: 'b', size: fit(r.reason, 'b', 30, cx - 90), col: P.text, align: 'right' })
      c.save(); c.translate(cx, h / 2); c.rotate(Math.PI / 2); icon(c, 'arrow', 0, 0, 30, r.col); c.restore()
      text(c, r.name, cx + 70, h / 2 + 2, { f: 'h', size: fit(r.name, 'h', 34, cx - 90), col: r.col, v: 'bottom' })
      text(c, r.effect, cx + 70, h / 2 - 2, { f: 'b', size: fit(r.effect, 'b', 24, cx - 90), col: P.dim, a: DIM_A, v: 'top' })
    } else {
      const rl = o.Y.rowLay[i]
      let y = 20
      rl.reason.forEach(l => { rich(c, l, 20, y + 14, { f: 'b', size: 24 }); y += 28 })
      c.save(); c.translate(w - 30, 30); c.rotate(Math.PI / 2); icon(c, 'arrow', 0, 0, 24, r.col); c.restore()
      y += 10
      text(c, r.name, 20, y, { f: 'h', size: rl.nameS, col: r.col, v: 'top' }); y += rl.nameS + 6
      rl.eff.forEach(l => { rich(c, l, 20, y, { f: 'b', size: 20, v: 'top', a: DIM_A }); y += 24 })
    }
  }

  // ---------------------------------------------------------------- gear locker (centre, 640 wide)
  const GEAR_ICONS = ['arrow', 'health', 'stamina']
  /**
   * Gear locker (GearShop + weapon rack), and the web Armory as a second tab. Model:
   * { title, sub, balance, tabs: [{ label, on }], onTab(i), items: [{ name, desc, icon, cost, costIcon: 'biomass'|'sample', affordable,
   *   owned, note, noteColour }], rackTitle, rackSub, rack: [{ name, info, slotLabel }], next, closeLabel, onBuy(i), onSwap(slot), onClose }
   * Keys: 1-3 buy, 4-5 rack, Q / Tab next tab, B / Esc close, arrows + Enter.
   */
  const activeTab = m => { const t = m.tabs || NONE; for (let i = 0; i < t.length; i++) if (t[i] && t[i].on) return i; return 0 }
  function gearLayout(m) {
    const tabs = m.tabs && m.tabs.length > 1, rack = m.rack && m.rack.length
    const itemsTop = tabs ? 140 : 100
    const rackTop = itemsTop + 78 * 3 + 14
    const h = rackTop + (rack ? 40 + 62 * 2 : 0) + 34 + 44
    return { tabs, rack, itemsTop, rackTop, h }
  }
  hud.gearLocker = m => {
    if (!m) { scr.gear = null; return }
    if (scr.gear && scr.gear.m === m) return
    const sig = sigOf(m)
    if (scr.gear && scr.gear.sig === sig) { scr.gear.m = m; return }
    const o = { m, sig, focus: scr.gear ? scr.gear.focus : -1, buttons: [], dirty: () => gearSpS.redraw() }
    o.draw = (c, w, h) => drawGear(c, w, h, o)
    o.key = code => {
      const mm = o.m
      const d = /^(Digit|Numpad)([1-5])$/.exec(code)
      if (d) { const i = +d[2] - 1; if (i < 3) { if (mm.onBuy) mm.onBuy(i) } else if (mm.onSwap) mm.onSwap(i - 3); return true }
      if (code === 'KeyB' || code === 'Escape') { if (mm.onClose) mm.onClose(); return true }
      const tabs = mm.tabs && mm.tabs.length > 1 && mm.onTab
      if (tabs && (code === 'KeyQ' || code === 'Tab')) { mm.onTab((activeTab(mm) + 1) % mm.tabs.length); return true }
      if (tabs && (code === 'ArrowLeft' || code === 'ArrowRight')) { mm.onTab((activeTab(mm) + (code === 'ArrowLeft' ? mm.tabs.length - 1 : 1)) % mm.tabs.length); return true }
      if (code === 'ArrowDown' || code === 'Tab') { moveFocus(o, 1); return true }
      if (code === 'ArrowUp') { moveFocus(o, -1); return true }
      if ((code === 'Enter' || code === 'Space') && o.focus >= 0) { activate(o, o.focus); return true }
      return false
    }
    scr.gear = o
    o.lay = gearLayout(m)
    gearSpS.size(Math.min(640, L.Wu - 16), o.lay.h).redraw()
  }
  function drawGear(c, w, h, o) {
    const m = o.m, lay = o.lay, bal = m.balance == null ? Infinity : m.balance
    panel(c, 0, 0, w, h, { fill: [8, 13, 18], a: 0.94, ch: 14 })
    rect(c, 0, h * 0.12, 3, h * 0.76, P.amber)
    textFit(c, m.title || 'Gear locker', 28, 20, w - 56, { f: 'h', size: 30, col: P.amber, v: 'top' })
    const sub = m.sub == null ? 'Run upgrades. One of each, lost when the run ends.' : m.sub
    if (sub) textFit(c, sub, 28, 58, w - 56, { f: 'b', size: 19, col: P.dim, a: DIM_A, v: 'top' })
    o.buttons = []
    const ox = L.gearX, oy = L.gearY, B = o.buttons
    const items = m.items || NONE
    for (let i = 0; i < 3; i++) {
      const it = items[i]
      if (!it) { B[i] = { x: 0, y: 0, w: 0, h: 0, disabled: true }; continue }
      const y = lay.itemsTop + i * 78
      const owned = !!it.owned, cost = it.cost
      const afford = it.affordable != null ? !!it.affordable : typeof cost === 'number' ? bal >= cost : false
      if (o.focus === i) rect(c, 12, y + 2, w - 24, 74, P.amber, 0.08)
      rect(c, 24, y, w - 48, 1, [153, 171, 189], 0.16)
      keycap(c, String(i + 1), 26, y + 39, 34)
      icon(c, it.icon || GEAR_ICONS[i] || 'arrow', 98, y + 39, 40, P.text)
      textFit(c, it.name || '', 132, y + 39, w - 132 - 150, { f: 'h', size: 23, col: owned || afford ? P.text : P.dim, v: 'bottom' })
      textFit(c, it.desc || '', 132, y + 37, w - 132 - 140, { f: 'b', size: 18, col: P.dim, a: DIM_A, v: 'top' })
      if (it.note != null && it.note !== '') {
        // e.g. 'LV 7' (locked) or 'MAX': drawn in place of the price
        text(c, String(it.note), w - 28, y + 40, { f: 'n', size: 26, col: col(it.noteColour, P.dim), align: 'right' })
      } else if (owned) {
        icon(c, 'check', w - 134, y + 39, 24, P.lime)
        text(c, it.ownedLabel || 'Equipped', w - 28, y + 39, { f: 'n', size: 20, col: P.lime, align: 'right' })
      } else if (cost != null) {
        const sample = it.costIcon === 'sample'
        const cc = afford ? (sample ? P.sample : P.lime) : P.danger
        const cs = String(cost), cw = tw(cs, 'n', 30)
        text(c, cs, w - 28, y + 40, { f: 'n', size: 30, col: cc, align: 'right' })
        icon(c, sample ? 'sample' : 'biomass', w - 28 - Math.max(cw, 40) - 22, y + 39, 22, cc)
      }
      B[i] = { x: ox, y: oy + y, w, h: 78, onClick: () => o.m.onBuy && o.m.onBuy(i) }
    }
    // tabs (Gear | Armory): segmented pills under the title
    if (lay.tabs) {
      const tabs = m.tabs, act = activeTab(m)
      const hintW = L.touch || !m.onTab ? 0 : keyW('Q', 26) + 8 + tw('switch', 'b', 17) + 12
      const room = w - 56 - hintW - 8 * (tabs.length - 1)
      let total = 0
      for (const t of tabs) total += tw(String((t && t.label) || ''), 'h', 19) + 40
      const fs = total > room ? Math.max(16, Math.floor(19 * room / total)) : 19
      let x = 28
      for (let i = 0; i < tabs.length; i++) {
        const lab = String((tabs[i] && tabs[i].label) || ''), on = i === act
        const tw2 = Math.min(tw(lab, 'h', fs) + 40, total > room ? room / tabs.length : Infinity)
        chamfer(c, x, 90, tw2, 36, 8)
        c.fillStyle = on ? css(P.amber, 0.95) : css(o.focus === 6 + i ? [205, 215, 225] : [160, 172, 185], o.focus === 6 + i ? 0.34 : 0.18); c.fill()
        rich(c, clip([[lab, on ? [18, 13, 5] : P.text, 1]], 'h', fs, tw2 - 20), x + tw2 / 2, 108, { f: 'h', size: fs, align: 'center' })
        B[6 + i] = { x: ox + x, y: oy + 90, w: tw2, h: 36, onClick: () => o.m.onTab && o.m.onTab(i) }
        x += tw2 + 8
      }
      if (hintW) {
        const kx = w - 28 - hintW + 12
        keycap(c, 'Q', kx, 108, 26)
        text(c, 'switch', kx + keyW('Q', 26) + 8, 108, { f: 'b', size: 17, col: P.dim, a: DIM_A })
      }
    }
    // the rack (weapon slots; the Armory tab may use it for its pages)
    const rackTop = lay.rackTop
    if (lay.rack) {
      rect(c, 24, rackTop, w - 48, 1, [153, 171, 189], 0.16)
      const rt = m.rackTitle == null ? 'Weapons' : m.rackTitle
      const rtW = rt ? text(c, rt, 28, rackTop + 8, { f: 'h', size: 22, col: P.amber, v: 'top' }) : 0
      const rs = m.rackSub == null ? 'Free swap · unlocked weapons · kept next run' : m.rackSub
      if (rs) textFit(c, rs, w - 28, rackTop + 10, w - 56 - rtW - 20, { f: 'b', size: 17, col: P.dim, a: DIM_A, align: 'right', v: 'top' })
      for (let i = 0; i < 2; i++) {
        const r = m.rack[i]
        if (!r) { B[3 + i] = { x: 0, y: 0, w: 0, h: 0, disabled: true }; continue }
        const y = rackTop + 40 + i * 62, mid = y + 31
        if (o.focus === 3 + i) rect(c, 12, y + 2, w - 24, 58, P.amber, 0.08)
        keycap(c, String(i + 4), 26, mid, 34)
        const sl = r.slotLabel == null ? 'Slot ' + (i + 1) : String(r.slotLabel)
        if (sl) text(c, sl, 86, mid, { f: 'b', size: 17, col: P.dim, a: DIM_A })
        const nx = sl ? 160 : 86
        const nm = String(r.name || 'Empty')
        const nmW = textFit(c, nm, nx, mid + 1, w - nx - 150, { f: 'h', size: 23, col: P.text })
        const info = segs(r.info || '', P.dim)
        if (info.length) rich(c, clip(info, 'b', 18, Math.max(100, w - nx - nmW - 50)), w - 28, mid, { f: 'b', size: 18, align: 'right', a: DIM_A })
        B[3 + i] = { x: ox, y: oy + y, w, h: 62, onClick: () => o.m.onSwap && o.m.onSwap(i) }
      }
    } else { B[3] = { x: 0, y: 0, w: 0, h: 0, disabled: true }; B[4] = B[3] }
    const nextY = lay.rack ? rackTop + 40 + 124 + 6 : rackTop + 6
    if (m.next) textFit(c, m.next, 28, nextY, w - 56, { f: 'b', size: 17, col: P.dim, a: DIM_A, v: 'top' })
    const fy = h - 12 - 15
    const kw = keycap(c, L.touch ? '×' : 'B', 26, fy, 26)
    text(c, m.closeLabel || 'Close', 26 + kw + 12, fy, { f: 'b', size: 19, col: P.dim, a: DIM_A })
    B[5] = { x: ox, y: oy + h - 44, w: 200, h: 44, onClick: () => o.m.onClose && o.m.onClose() }
    for (let i = 0; i < B.length; i++) if (!B[i]) B[i] = { x: 0, y: 0, w: 0, h: 0, disabled: true }
  }

  // ---------------------------------------------------------------- pause (PauseMenu.cs)
  hud.pause = m => {
    if (!m) { scr.pause = null; return }
    if (scr.pause && scr.pause.m === m) return
    const sig = sigOf(m)
    if (scr.pause && scr.pause.sig === sig) { scr.pause.m = m; return }
    const o = { m, sig, focus: scr.pause ? scr.pause.focus : 0, buttons: [], dirty: () => screenSp.redraw() }
    o.draw = (c, w, h) => drawPause(c, w, h, o)
    o.key = code => {
      if (code === 'Escape' || code === 'KeyP') { if (o.m.onResume) o.m.onResume(); return true }
      if (code === 'KeyH' && o.m.onGuide) { o.m.onGuide(); return true }
      if (code === 'ArrowDown' || code === 'Tab' || code === 'KeyS') { moveFocus(o, 1); return true }
      if (code === 'ArrowUp' || code === 'KeyW') { moveFocus(o, -1); return true }
      if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { activate(o, o.focus); return true }
      return true
    }
    scr.pause = o
    screenSp.redraw()
  }
  function drawPause(c, w, h, o) {
    const m = o.m, nar = L.narrow, cx = w / 2, cy = h / 2
    const list = [['Resume', m.onResume, true], ['Hive guide', m.onGuide], ['Restart run', m.onRestart], ['Tutorial run', m.onTutorial], [m.quitLabel || 'Quit to start screen', m.onQuit]].filter(b => b[1] || b[2])
    o.buttons = []
    let x0, y0, bw, bh, gap, ey
    if (!nar) {
      text(c, 'Paused', cx - 700, cy - 300, { f: 'h', size: 76, col: P.text })
      if (m.status) text(c, m.status, cx - 696, cy - 238, { f: 'b', size: 24, col: P.dim, a: DIM_A })
      rect(c, cx - 696, cy - 206, 120, 2, P.amber)
      x0 = cx - 696; y0 = cy - 124 - 29; bw = 420; bh = 58; gap = 68
      ey = cy + 206
    } else {
      let y = 70 + L.insT
      text(c, 'Paused', 24, y, { f: 'h', size: 64, col: P.text }); y += 50
      if (m.status) { text(c, m.status, 24, y, { f: 'b', size: fit(m.status, 'b', 22, w - 48), col: P.dim, a: DIM_A }); y += 30 }
      rect(c, 24, y, 120, 2, P.amber); y += 26
      x0 = 24; y0 = y; bw = w - 48; bh = 64; gap = 74
      ey = y0 + list.length * gap + 30
    }
    list.forEach((b, i) => {
      const bt = { x: x0, y: y0 + i * gap, w: bw, h: bh, label: b[0], primary: i === 0, onClick: b[1] }
      o.buttons.push(bt)
      button(c, bt, o.focus === i)
    })
    // the Hive's evolutions in full
    const ev = m.evolutions || {}
    const ex = nar ? 24 : cx - 696, ew = nar ? w - 48 : 660
    rect(c, ex, ey, 120, 2, P.hive)
    const et = ev.title || 'The Hive has not evolved yet'
    text(c, et, ex, ey + 24, { f: 'h', size: fit(et, 'h', 26, ew), col: P.hive })
    let ly = ey + 46
    const lines = ev.lines || []
    if (!lines.length) text(c, ev.empty || 'It studies how you fight and changes before every boss wave.', ex, ly, { f: 'b', size: fit('It studies how you fight and changes before every boss wave.', 'b', 18, ew), col: P.dim, a: DIM_A, v: 'top' })
    lines.slice(0, 5).forEach(l => {
      if (ly > h - 40) return
      const nm = l.name + (roman(l.stacks || 1) ? '  ' + roman(l.stacks || 1) : '')
      const sg = [[nm, col(l.colour, P.amber), 1], ['   ' + (l.effect || ''), P.text, 1]]
      rich(c, clip(sg, 'b', 18, ew), ex, ly, { f: 'b', size: 18, v: 'top' })
      const r2 = (l.reason || '') + (l.wave ? '  ·  wave ' + l.wave : '')
      text(c, r2, ex, ly + 22, { f: 'b', size: 16, col: P.dim, a: DIM_A, v: 'top' })
      ly += 46
    })
    if (lines.length > 5) text(c, '+' + (lines.length - 5) + ' more', ex, ly, { f: 'b', size: 16, col: P.dim, a: DIM_A, v: 'top' })
    // right: controls (the web build has no settings to save)
    if (!nar) {
      const px = cx + 40, pw = 660, ctrls = m.controls || (L.touch ? TOUCH_CONTROLS : DEFAULT_CONTROLS)
      const rowsN = Math.ceil(ctrls.length / 2), ph = 66 + rowsN * 36 + 12
      const py = cy - 400
      panel(c, px, py, pw, ph, { fill: [5, 7, 11], a: 0.88, ch: 12 })
      rect(c, px, py + 22, 3, 26, P.amber)
      text(c, 'Controls', px + 26, py + 18, { f: 'h', size: 24, col: P.text, v: 'top' })
      controlRows(c, ctrls, px + 26, py + 66 + 13, 316, 36, 2)
    }
  }

  // ---------------------------------------------------------------- Hive guide (HiveGuide.cs, simplified)
  hud.guide = m => {
    if (!m) { scr.guide = null; return }
    if (scr.guide && scr.guide.m === m) return
    const sig = sigOf(m)
    if (scr.guide && scr.guide.sig === sig) { scr.guide.m = m; return }
    const o = { m, sig, focus: m.selected || 0, buttons: [], dirty: () => screenSp.redraw() }
    o.draw = (c, w, h) => drawGuide(c, w, h, o)
    o.key = code => {
      const n = (o.m.enemies || []).length
      if (code === 'KeyH' || code === 'Escape') { if (o.m.onClose) o.m.onClose(); return true }
      if ((code === 'ArrowDown' || code === 'ArrowUp' || code === 'KeyS' || code === 'KeyW') && n) {
        const d = code === 'ArrowDown' || code === 'KeyS' ? 1 : -1
        const i = ((o.m.selected || 0) + d + n) % n
        if (o.m.onSelect) o.m.onSelect(i)
        return true
      }
      if (code === 'PageDown' || code === 'ArrowRight') { if (o.m.onPage) o.m.onPage(1); return true }
      if (code === 'PageUp' || code === 'ArrowLeft') { if (o.m.onPage) o.m.onPage(-1); return true }
      return true
    }
    scr.guide = o
    screenSp.redraw()
  }
  function drawGuide(c, w, h, o) {
    const m = o.m, nar = L.narrow, cx = w / 2, cy = h / 2
    const en = m.enemies || []
    o.buttons = []
    const left = nar ? 24 : cx - 860
    let y = nar ? 70 + L.insT : cy - 430
    text(c, 'Hive guide', left, y, { f: 'h', size: nar ? 52 : 64, col: P.text })
    const cnt = m.count || (en.length ? en.length + ' kinds of bug met so far' : 'No bugs met yet')
    text(c, cnt, left + 4, y + (nar ? 44 : 50), { f: 'b', size: 22, col: P.dim, a: DIM_A })
    rect(c, left + 4, y + (nar ? 68 : 78), 120, 2, P.hive)
    const closeL = L.touch ? 'Tap here to close' : 'close'
    const ckw = L.touch ? 0 : keyW('H', 30) + 10
    const cxr = nar ? w - 24 : cx + 860
    if (!L.touch) keycap(c, 'H', cxr - ckw - tw(closeL, 'b', 20), y, 30)
    text(c, closeL, cxr, y, { f: 'b', size: 20, col: P.dim, a: DIM_A, align: 'right' })
    o.buttons.push({ x: cxr - ckw - tw(closeL, 'b', 20) - 10, y: y - 24, w: ckw + tw(closeL, 'b', 20) + 20, h: 48, onClick: () => m.onClose && m.onClose() })
    y += nar ? 92 : 108
    // enemy list
    const listW = nar ? w - 48 : 360, bh = nar ? 52 : 50, cols = nar ? 2 : 1
    const bw = nar ? (listW - 10) / 2 : listW
    en.forEach((e, i) => {
      const bx = left + (i % cols) * (bw + 10), by = y + Math.floor(i / cols) * (bh + 8)
      const b = { x: bx, y: by, w: bw, h: bh, label: e.name || e, primary: i === (m.selected || 0), onClick: () => m.onSelect && m.onSelect(i), size: 20 }
      o.buttons.push(b)
      button(c, b, i === (m.selected || 0))
    })
    const listH = Math.ceil(en.length / cols) * (bh + 8)
    // detail panel
    const d = m.detail || {}
    const dx = nar ? left : left + listW + 30, dw = nar ? w - 48 : 760
    let dy = nar ? y + listH + 12 : y
    const dl = wrap(segs(d.text || '', P.text), 'b', nar ? 20 : 23, dw - 56)
    const dh = Math.max(nar ? 120 : 360, 116 + dl.length * (nar ? 26 : 30) + 20)
    panel(c, dx, dy, dw, dh, { fill: [5, 7, 11], a: 0.88, ch: 12 })
    rect(c, dx, dy + 16, 4, 90, col(d.colour, P.amber))
    text(c, d.kicker || '', dx + 28, dy + 18, { f: 'b', size: 17, col: col(d.colour, P.amber), v: 'top', sp: 6 })
    text(c, d.title || (en[m.selected || 0] && en[m.selected || 0].name) || '', dx + 28, dy + 44, { f: 'h', size: fit(d.title || '', 'h', 44, dw - 56), col: P.text, v: 'top' })
    dl.forEach((l, i) => rich(c, l, dx + 28, dy + 116 + i * (nar ? 26 : 30), { f: 'b', size: nar ? 20 : 23, v: 'top' }))
    // the Hive now
    const hv = m.hive || {}
    const hx = nar ? left : dx + dw + 30, hw2 = nar ? w - 48 : Math.min(540, cx + 860 - hx)
    const hy = nar ? dy + dh + 12 : y
    const rl = wrap(segs(hv.resist || 'Resists nothing yet', P.text), 'b', 24, hw2 - 56)
    const al = wrap(segs(hv.advice || '', P.text), 'b', 21, hw2 - 56)
    const hh = 100 + rl.length * 30 + 40 + al.length * 26 + 30
    panel(c, hx, hy, hw2, hh, { fill: [5, 7, 11], a: 0.88, ch: 12 })
    rect(c, hx, hy + 16, 4, 90, P.hive)
    text(c, 'THE HIVE NOW', hx + 28, hy + 18, { f: 'b', size: 17, col: P.hive, v: 'top', sp: 6 })
    text(c, 'Resistances', hx + 28, hy + 46, { f: 'h', size: 30, col: P.text, v: 'top' })
    rl.forEach((l, i) => rich(c, l, hx + 28, hy + 96 + i * 30, { f: 'b', size: 24, v: 'top' }))
    const ay = hy + 96 + rl.length * 30 + 14
    if (al.length) {
      text(c, 'WHAT YOU CAN DO NOW', hx + 28, ay, { f: 'b', size: 17, col: P.amber, v: 'top', sp: 6 })
      al.forEach((l, i) => rich(c, l, hx + 28, ay + 30 + i * 26, { f: 'b', size: 21, v: 'top' }))
    }
    // field-guide log
    const log = m.log || []
    const ly = nar ? hy + hh + 16 : Math.max(y + 400, y + listH + 20)
    if (log.length && ly < h - 60) {
      text(c, 'FIELD GUIDE  ·  CARDS SO FAR', left, ly, { f: 'b', size: 17, col: P.amber, v: 'top', sp: 6 })
      if (m.page) text(c, m.page, nar ? w - 24 : cx + 860, ly, { f: 'b', size: 17, col: P.dim, a: DIM_A, align: 'right', v: 'top' })
      let yy = ly + 34
      for (const e of log) {
        if (yy > h - 30) break
        const sg = segs(e, P.text)
        rich(c, clip(sg, 'b', 19, nar ? w - 48 : 1720), left, yy, { f: 'b', size: 19, v: 'top' })
        yy += 26
      }
    }
  }

  // ---------------------------------------------------------------- end screen + debrief (EndScreen.cs)
  hud.end = m => {
    if (!m) { scr.end = null; return }
    if (scr.end && scr.end.m === m) return
    const sig = sigOf(m)
    if (scr.end && scr.end.sig === sig) { scr.end.m = m; return }
    const o = { m, sig, t: 0, focus: 0, buttons: [], dirty: () => screenSp.redraw() }
    o.draw = (c, w, h) => drawEnd(c, w, h, o)
    o.drawA = (c, w, h) => drawEndTitle(c, w, h, o)
    o.drawB = (c, w, h) => drawEndBar(c, w, h, o)
    o.key = code => {
      if (code === 'ArrowDown' || code === 'ArrowRight' || code === 'Tab') { moveFocus(o, 1); return true }
      if (code === 'ArrowUp' || code === 'ArrowLeft') { moveFocus(o, -1); return true }
      if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { activate(o, o.focus); return true }
      if (code === 'KeyR' && o.m.onAgain) { o.m.onAgain(); return true }
      return true
    }
    scr.end = o
    layoutEnd(o)
    screenSp.redraw(); scrA.redraw(); scrB.redraw()
  }
  function layoutEnd(o) {
    const m = o.m, nar = L.narrow, cx = L.Wu / 2, cy = L.Hu / 2
    const Y = {}
    if (!nar) {
      Y.title = cy - 330; Y.rule = cy - 262; Y.sub = cy - 226; Y.best = cy - 186; Y.panel = cy + 10 - 150; Y.panelH = 300; Y.panelW = Math.min(1240, L.Wu - 40)
      Y.progress = cy + 206; Y.bar = cy + 234; Y.unlock = cy + 264; Y.buttons = cy + 340; Y.hint = cy + 404; Y.evo = cy + 448; Y.queens = cy + 494
      Y.titleSize = 100
    } else {
      const cw = L.Wu - 32
      let y = 40 + L.insT
      Y.titleSize = fit(m.title || (m.won ? 'Outpost held' : 'Core lost'), 'h', 84, cw, 30)
      Y.title = y + Y.titleSize * 0.5; y += Y.titleSize + 6
      Y.rule = y; y += 22
      Y.subLines = wrap(segs(m.subtitle || ''), 'b', 24, cw)
      Y.sub = y; y += Y.subLines.length * 28 + 6
      Y.best = y; y += m.bestLine ? 36 : 0
      Y.panelW = cw
      const pw = cw - 32
      Y.causeS = fit(m.cause || '', 'h', 34, pw, 20)
      Y.pl = wrap(segs(m.playerLine || '', P.dim), 'b', 21, pw)
      Y.tl = wrap(segs(m.topLine || '', P.text), 'b', 21, pw)
      Y.rl = wrap(segs((m.action && m.action.reason) || '', P.dim), 'b', 18, pw)
      Y.panelH = 44 + Y.causeS + 14 + (Y.pl.length + Y.tl.length) * 26 + 10 + Y.rl.length * 22 + (m.action ? 14 + 64 : 0) + 20
      Y.panel = y; y += Y.panelH + 18
      Y.progLines = wrap(segs(m.progress || ''), 'b', 20, cw)
      Y.progress = y; y += Y.progLines.length * 26 + 4
      Y.bar = y; y += 22
      Y.unlockLines = wrap(segs(m.unlockLine || ''), 'b', 19, cw)
      Y.unlock = y; y += Y.unlockLines.length * 24 + 16
      Y.buttons = y; y += 2 * 74 + 10
      Y.hintLines = wrap(segs(m.hint || '', P.dim), 'b', 17, cw)
      Y.hint = y; y += Y.hintLines.length * 22 + 8
      Y.evoLines = wrap(segs(m.evoLine || '', P.text), 'b', 17, cw)
      Y.evo = y; y += Y.evoLines.length * 22 + 8
      Y.queenLines = wrap(segs(m.queensLine || '', P.text), 'b', 17, cw)
      Y.queens = y
    }
    o.Y = Y
    scrA.size(L.Wu, Y.titleSize * 1.3 + 30).at(cx, Y.title, 0.5, (Y.titleSize * 0.65) / (Y.titleSize * 1.3 + 30))
    scrB.size(Math.min(760, L.Wu - 32), 6).at(cx, Y.bar, 0.5, 0.5)
  }
  function drawEndTitle(c, w, h, o) {
    const m = o.m, Y = o.Y
    const tk = clamp01(o.t / 0.6)
    const cl = m.won ? P.lime : P.danger
    const t = m.title || (m.won ? 'Outpost held' : 'Core lost')
    const spc = lerp(14, 1, tk)
    text(c, t, w / 2, Y.titleSize * 0.65, { f: 'h', size: fit(t, 'h', Y.titleSize, w - 30, 30, spc), col: cl, align: 'center', sp: spc })
    const rw = lerp(0, 160, easeOutBack(tk))
    rect(c, w / 2 - rw / 2, Y.rule - Y.title + Y.titleSize * 0.65 - 1.5, rw, 3, cl)
  }
  function drawEndBar(c, w, h, o) {
    const k2 = clamp01((o.t - 0.3) / 1.1), kk = 1 - (1 - k2) * (1 - k2)
    rect(c, 0, 0, w, 6, P.white, 0.12)
    rect(c, 0, 0, w * clamp01(o.m.levelFrac || 0) * kk, 6, P.amber)
  }
  function drawEnd(c, w, h, o) {
    const m = o.m, Y = o.Y, cx = w / 2, nar = L.narrow
    o.buttons = []
    if (!nar) {
      if (m.subtitle) text(c, m.subtitle, cx, Y.sub, { f: 'b', size: fit(m.subtitle, 'b', 30, w - 60), col: P.dim, a: DIM_A, align: 'center' })
      if (m.bestLine) text(c, m.bestLine, cx, Y.best, { f: 'h', size: 26, col: m.newBest ? P.amber : P.dim, a: m.newBest ? 1 : DIM_A, align: 'center', sp: 4 })
      const pw = Y.panelW, px = cx - pw / 2, py = Y.panel
      chamfer(c, px, py, pw, Y.panelH, 12); c.fillStyle = css(P.panel, aS(0.88)); c.fill()
      text(c, 'DEBRIEF', cx, py + 14, { f: 'b', size: 17, col: P.amber, align: 'center', v: 'top', sp: 6 })
      const cause = m.cause || ''
      text(c, cause, cx, py + 40 + 28, { f: 'h', size: fit(cause, 'h', 44, pw - 40, 24), col: m.won ? P.lime : P.text, align: 'center' })
      const pl = segs(m.playerLine || '', P.dim), tl = segs(m.topLine || '', P.text)
      rich(c, pl, cx, py + 100 + 16, { f: 'b', size: fit(pl, 'b', 24, pw - 40), align: 'center', a: DIM_A })
      rich(c, tl, cx, py + 134 + 16, { f: 'b', size: fit(tl, 'b', 24, pw - 40), align: 'center' })
      if (m.action) {
        const rs = segs(m.action.reason || '', P.dim)
        rich(c, rs, cx, py + 176 + 14, { f: 'b', size: fit(rs, 'b', 20, pw - 40), align: 'center', a: DIM_A })
        const ab = { x: cx - 320, y: py + 150 + 100 - 32, w: 640, h: 64, label: m.action.label || '', primary: true, onClick: () => m.onAction && m.onAction() }
        o.buttons.push(ab)
      }
      if (m.progress) { const sg = segs(m.progress); rich(c, sg, cx, Y.progress, { f: 'b', size: fit(sg, 'b', 22, w - 60), align: 'center' }) }
      if (m.unlockLine) { const sg = segs(m.unlockLine); rich(c, sg, cx, Y.unlock, { f: 'b', size: fit(sg, 'b', 20, w - 60), align: 'center' }) }
      o.buttons.push({ x: cx - 236 - 220, y: Y.buttons - 35, w: 440, h: 70, label: m.againLabel || 'Play again', onClick: () => m.onAgain && m.onAgain() })
      if (m.onMenu || m.menuLabel) o.buttons.push({ x: cx + 214 - 200, y: Y.buttons - 35, w: 400, h: 70, label: m.menuLabel || 'Start screen', onClick: () => m.onMenu && m.onMenu() })
      if (m.hint) text(c, m.hint, cx, Y.hint, { f: 'b', size: fit(m.hint, 'b', 18, w - 60), col: P.dim, a: DIM_A, align: 'center' })
      if (m.evoLine) { const sg = segs(m.evoLine, P.text); rich(c, clip(sg, 'b', 18, w - 60), cx, Y.evo, { f: 'b', size: 18, align: 'center' }) }
      if (m.queensLine) { const sg = segs(m.queensLine, P.text); rich(c, clip(sg, 'b', 18, w - 60), cx, Y.queens, { f: 'b', size: 18, align: 'center' }) }
    } else {
      const lx = 16
      Y.subLines.forEach((l, i) => rich(c, l, cx, Y.sub + 12 + i * 28, { f: 'b', size: 24, align: 'center', a: DIM_A }))
      if (m.bestLine) text(c, m.bestLine, cx, Y.best + 12, { f: 'h', size: fit(m.bestLine, 'h', 24, w - 32, 16, 4), col: m.newBest ? P.amber : P.dim, align: 'center', sp: 4 })
      const pw = Y.panelW, px = lx, py = Y.panel
      chamfer(c, px, py, pw, Y.panelH, 12); c.fillStyle = css(P.panel, aS(0.88)); c.fill()
      let y = py + 14
      text(c, 'DEBRIEF', cx, y, { f: 'b', size: 17, col: P.amber, align: 'center', v: 'top', sp: 6 }); y += 30
      text(c, m.cause || '', cx, y, { f: 'h', size: Y.causeS, col: m.won ? P.lime : P.text, align: 'center', v: 'top' }); y += Y.causeS + 14
      Y.pl.forEach(l => { rich(c, l, cx, y, { f: 'b', size: 21, align: 'center', v: 'top', a: DIM_A }); y += 26 })
      Y.tl.forEach(l => { rich(c, l, cx, y, { f: 'b', size: 21, align: 'center', v: 'top' }); y += 26 })
      y += 10
      Y.rl.forEach(l => { rich(c, l, cx, y, { f: 'b', size: 18, align: 'center', v: 'top', a: DIM_A }); y += 22 })
      if (m.action) { y += 14; o.buttons.push({ x: px + 16, y, w: pw - 32, h: 64, label: m.action.label || '', primary: true, onClick: () => m.onAction && m.onAction() }) }
      Y.progLines.forEach((l, i) => rich(c, l, cx, Y.progress + 12 + i * 26, { f: 'b', size: 20, align: 'center' }))
      Y.unlockLines.forEach((l, i) => rich(c, l, cx, Y.unlock + 12 + i * 24, { f: 'b', size: 19, align: 'center' }))
      o.buttons.push({ x: lx, y: Y.buttons, w: w - 32, h: 64, label: m.againLabel || 'Play again', onClick: () => m.onAgain && m.onAgain() })
      if (m.onMenu || m.menuLabel) o.buttons.push({ x: lx, y: Y.buttons + 74, w: w - 32, h: 64, label: m.menuLabel || 'Start screen', onClick: () => m.onMenu && m.onMenu() })
      Y.hintLines.forEach((l, i) => rich(c, l, cx, Y.hint + 10 + i * 22, { f: 'b', size: 17, align: 'center', a: DIM_A }))
      Y.evoLines.forEach((l, i) => rich(c, l, cx, Y.evo + 10 + i * 22, { f: 'b', size: 17, align: 'center' }))
      Y.queenLines.forEach((l, i) => rich(c, l, cx, Y.queens + 10 + i * 22, { f: 'b', size: 17, align: 'center' }))
    }
    o.buttons.forEach((b, i) => button(c, b, o.focus === i))
  }

  // ================================================================== reset between runs
  /**
   * Flushes everything transient: queued and visible banners, level-up cards, field-guide cards, toasts, the kill feed, the
   * streak, the supply-pod pop, the turret callout, the hitmarker, the damage / alarm flashes and the Biomass delta (the next
   * hud.biomass(v) snaps to v without a delta). Persistent widgets keep their last values until fed again.
   */
  hud.clearTransient = () => {
    S.banners.length = 0; S.banner = null; S.bannerT = -1
    S.levels.length = 0; S.level = null; S.levelT = 99
    S.guides.length = 0; S.guide = null; S.guideT = 99
    for (const e of S.toasts) e.sp.entry = null
    S.toasts.length = 0
    for (const e of S.feed) e.sp.entry = null
    S.feed.length = 0
    S.streak = null; S.streakT = 0
    S.pod = null; S.podT = 99
    S.callout = null; S.calloutT = 0; S.calloutSig = ''; calloutSrc = null
    S.hitT = 0; S.vignetteFlash = 0; S.corePulse = 0; S.staminaFlash = 0; S.badgePulse = 0
    S.deltaT = 0; S.biomassInit = false; S.biomassPulse = 0
    S.coreChip = S.coreN
    if (S.vitals && S.vitals.max > 0) S.hpChip = clamp01(S.vitals.hp / S.vitals.max)
    if (S.bossBand) S.bossChip = S.bossBand.frac
  }

  // ================================================================== touch buttons
  const touchPool = []
  hud.defaultTouchButtons = () => [
    { id: 'fire', label: 'FIRE', anchor: 'br', x: 60, y: 80, r: 40, colour: P.danger },
    { id: 'jump', label: 'JUMP', anchor: 'br', x: 150, y: 44, r: 26 },
    { id: 'dodge', label: 'DODGE', anchor: 'br', x: 155, y: 112, r: 26 },
    { id: 'aim', label: 'AIM', anchor: 'br', x: 98, y: 164, r: 24 },
    { id: 'reload', label: 'R', anchor: 'br', x: 36, y: 160, r: 22 },
    { id: 'e', label: 'E', anchor: 'br', x: 160, y: 176, r: 24, colour: P.amber },
    { id: 'q', label: 'Q', anchor: 'br', x: 40, y: 222, r: 22, colour: P.amber },
    { id: 'pause', label: 'II', anchor: 'tr', x: 26, y: 26, r: 20 },
  ]
  hud.touchButtons = list => {
    if (list === true) list = hud.defaultTouchButtons()
    S.touch = list && list.length ? list.map(b => ({ ...b })) : null
    L.touch = !!S.touch
    while (touchPool.length < (S.touch ? S.touch.length : 0)) {
      const sp = sprite(90, 'touch', (c, w, h) => {
        const b = sp.btn, r = w / 2, cl = col(b.colour, P.text)
        c.beginPath(); c.arc(r, r, r - 1.5, 0, Math.PI * 2)
        c.fillStyle = css(b.down ? mix(cl, P.black, 0.35) : [10, 14, 18], b.down ? 0.75 : 0.42); c.fill()
        c.lineWidth = 2.5; c.strokeStyle = css(cl, b.down ? 1 : 0.8); c.stroke()
        if (b.icon) icon(c, b.icon, r, r, r, cl)
        else text(c, b.label || b.id, r, r, { f: 'h', size: fit(b.label || b.id, 'h', Math.max(16, r * 0.5), w - 14, 12), col: cl, align: 'center' })
      })
      sp.snap = false
      touchPool.push(sp)
    }
    touchPool.forEach((sp, i) => { sp.btn = S.touch && S.touch[i] ? { ...S.touch[i] } : null; sp.redraw() })
    relayout()
  }
  hud.touchPress = (id, down) => {
    const sp = touchPool.find(x => x.btn && x.btn.id === id)
    if (sp && !!sp.btn.down !== !!down) { sp.btn.down = !!down; const b = S.touch.find(x => x.id === id); if (b) b.down = !!down; sp.redraw() }
  }
  const _tc = [0, 0]
  /** a touch button's centre in css px (written into a shared pair: read it at once) */
  function touchCentre(b) {
    const a = b.anchor || 'br'
    _tc[0] = a.includes('l') ? b.x : a.includes('r') ? Wc - b.x : Wc / 2 + (b.x || 0)
    _tc[1] = a.includes('t') ? b.y : a.includes('b') ? Hc - b.y : Hc / 2 + (b.y || 0)
    return _tc
  }
  hud.touchAt = (x, y) => {
    if (!S.touch || modalOpen()) return null
    let best = null, bd = Infinity
    for (const b of S.touch) {
      if (b.hidden) continue
      const tc = touchCentre(b), d = Math.hypot(x - tc[0], y - tc[1])
      if (d <= (b.r || 30) * 1.2 && d < bd) { bd = d; best = b.id }
    }
    return best
  }

  // ================================================================== input
  hud.click = (x, y) => {
    const ux = x / s, uy = y / s
    const o = openScreen()
    if (o) {
      if (o.click) return o.click(ux, uy)
      const i = hitButton(o, ux, uy)
      if (i >= 0) { o.focus = i; o.dirty(); activate(o, i) }
      return true
    }
    if (scr.gear) {
      const i = hitButton(scr.gear, ux, uy)
      if (i >= 0) activate(scr.gear, i)
      return true
    }
    for (const hz of hitZones) if (hz.on() && ux >= hz.r[0] && ux <= hz.r[0] + hz.r[2] && uy >= hz.r[1] && uy <= hz.r[1] + hz.r[3]) { hz.fn(ux, uy); return true }
    return false
  }
  hud.key = code => {
    const o = openScreen()
    if (o) return o.key ? !!o.key(code) : true
    if (scr.gear) return !!scr.gear.key(code)
    if (code === 'F1' && S.tut && S.tut.onSkip) { S.tut.onSkip(); return true }
    if (code === 'KeyH' && S.evoChip && S.evoChip.onOpen) { S.evoChip.onOpen(); return true }
    return false
  }
  hud.hover = (x, y) => {
    const o = openScreen() || scr.gear
    if (!o) return
    const i = hitButton(o, x / s, y / s)
    if (i >= 0 && i !== o.focus) { o.focus = i; o.dirty() }
  }
  /** true while a full screen or the gear locker is open (gameplay input should be blocked) */
  hud.blocking = () => modalOpen()
  hud.isOpen = name => !!(name === 'gear' ? scr.gear : scr[name])
  // tappable bits of the gameplay HUD (phones): build banner -> onReady, gear hint -> onGear, evo chip -> onOpen, tutorial skip, prompt rows
  const hitZones = [
    { on: () => buildSp.on && S.buildBanner && S.buildBanner.onReady, r: [0, 0, 0, 0], fn: () => S.buildBanner.onReady() },
    { on: () => gearSp.on && S.gearHintFn, r: [0, 0, 0, 0], fn: () => S.gearHintFn() },
    { on: () => chipSp.on && S.evoChip && S.evoChip.onOpen, r: [0, 0, 0, 0], fn: () => S.evoChip.onOpen() },
    { on: () => tutSp.on && S.tut && S.tut.onSkip, r: [0, 0, 0, 0], fn: () => S.tut.onSkip() },
    { on: () => promptSp.on && S.prompt && S.prompt.m && S.prompt.m.onTap && S.promptAlpha > 0.5, r: [0, 0, 0, 0], fn: (x, y) => promptTap(x, y) },
    { on: () => wepSp.on && S.weapon && S.weapon.onTap, r: [0, 0, 0, 0], fn: () => S.weapon.onTap() },
  ]
  const setR = (r, x, y, w, h) => { r[0] = x; r[1] = y; r[2] = w; r[3] = h }
  function promptTap(x, y) {
    const m = S.prompt.m
    const top = promptSp.y - promptSp.ay * promptSp.h
    for (const it of m.items) if (it[0] === 'row' && y >= top + it[1] && y <= top + it[1] + 58) { m.onTap(it[2].key); return }
  }
  const gearHintOrig = hud.gearHint
  hud.gearHint = (on, onTap) => { gearHintOrig(on); S.gearHintFn = on ? onTap || (typeof on === 'object' ? on.onTap : null) : null }

  // ================================================================== projection helper
  const _v = new THREE.Vector3()
  /** world point -> { x, y (css px), behind, onScreen }; game: true converts a game-space point through G.root first */
  hud.project = (pos, camera, game) => {
    _v.copy(pos)
    if (game && G.root) G.root.localToWorld(_v)
    camera.updateMatrixWorld()
    _v.applyMatrix4(camera.matrixWorldInverse)
    const behind = _v.z > 0
    _v.applyMatrix4(camera.projectionMatrix)
    let x = (_v.x * 0.5 + 0.5) * Wc, y = (-_v.y * 0.5 + 0.5) * Hc
    if (behind) { x = Wc - x; y = Hc - y }
    return { x, y, behind, onScreen: !behind && x >= 0 && x <= Wc && y >= 0 && y <= Hc }
  }

  // ================================================================== layout
  function relayout() {
    L.Wu = Wu; L.Hu = Hu
    L.narrow = Wu < 1180
    L.short = Hu < 760
    // top-anchored touch buttons (pause): the narrow header shrinks to clear them; the wide corners step down
    let tl = 0, tr = 0, sideL = 0, sideR = 0
    if (S.touch) for (const b of S.touch) {
      const a = b.anchor || 'br'
      if (b.hidden || !a.includes('t')) continue
      const bottom = ((b.y || 0) + (b.r || 30) + 8) / s, side = ((b.x || 0) + (b.r || 30) + 8) / s
      if (a.includes('l')) { tl = Math.max(tl, bottom); sideL = Math.max(sideL, side) }
      if (a.includes('r')) { tr = Math.max(tr, bottom); sideR = Math.max(sideR, side) }
    }
    L.topL = tl; L.topR = tr
    L.HW = Math.min(560, Wu - 16)
    // the wave strip and the Core plate (the rows level with a corner button) on a phone: shifted aside, not shrunk twice
    L.HWt = Wu < 1180 ? Math.min(560, Wu - 16 - sideL - sideR - 24) : L.HW
    L.cxT = Wu < 1180 ? (8 + sideL + Wu - 8 - sideR) / 2 : Wu / 2
    L.insT = insetsCss.top / s; L.insB = insetsCss.bottom / s; L.insL = insetsCss.left / s; L.insR = insetsCss.right / s
    L.feedRows = L.narrow ? 2 : 5
    L.tagSize = 17
    L.previewSize = 19
    L.vitH = L.narrow ? 74 : 96
    L.wepH = L.narrow ? 96 : 148
    // bottom reserve for the platform stick (insets) and the touch buttons, per panel column (vitals left, weapon right)
    let rl = L.insB, rr = L.insB
    const nar0 = Wu < 1180, colW = nar0 ? (Wu - 24 - L.insL - L.insR) / 2 : 0
    const colL = nar0 ? [8 + L.insL, 8 + L.insL + colW] : [32, 452], colR = nar0 ? [Wu - 8 - L.insR - colW, Wu - 8 - L.insR] : [Wu - 492, Wu - 32]
    if (S.touch) for (const b of S.touch) {
      if (b.hidden || !(b.anchor || 'br').includes('b')) continue
      const cxp = touchCentre(b)[0], r = b.r || 30
      const x0 = (cxp - r) / s, x1 = (cxp + r) / s, top = ((b.y || 0) + r + 10) / s
      if (x1 > colL[0] && x0 < colL[1]) rl = Math.max(rl, top)
      if (x1 > colR[0] && x0 < colR[1]) rr = Math.max(rr, top)
    }
    L.resL = rl; L.resR = rr
    let clusterL = Wu
    if (S.touch) for (const b of S.touch) { if (b.hidden || !(b.anchor || 'br').includes('b')) continue; const cxp = touchCentre(b)[0]; if (cxp > Wc / 2) clusterL = Math.min(clusterL, (cxp - (b.r || 30) - 8) / s) }
    L.toastCol = clusterL - 8 - L.insL
    L.toastBase = Hu - 16 - rl
    dirtyAll()
  }
  function dirtyAll() {
    for (const sp of sprites) sp.dirty = true
    if (S.banner) layoutBanner(S.banner)
    PR.sig = ''; PR.src = null
    if (scr.evolution) layoutEvo(scr.evolution)
    if (scr.end) layoutEnd(scr.end)
    if (S.guide) { const g = S.guide; g.lines = wrap(segs(g.body, P.dim), 'b', 19, Math.min(820, Wu - 16) - 50); guideSp.size(Math.min(820, Wu - 16), Math.max(112, 76 + g.lines.length * 22)) }
    if (S.tut) { S.tut.sig = ''; S.tut.src = null }
    if (scr.gear) { const m = scr.gear.m; scr.gear = null; hud.gearLocker(m) }
  }

  /** per-frame placement (cheap: numbers only) */
  function arrange(dt) {
    const nar = L.narrow, cx = Wu / 2
    const hudOn = S.visible && !openScreen()
    // phones: the gear locker takes the middle of the screen; the panels it would cover step aside
    const lockerNar = nar && !!scr.gear
    const midOn = hudOn && !lockerNar
    const top = 12 + L.insT
    // ---- top centre stack
    const waveY = nar ? top : 20
    waveSp.show(hudOn && S.wave).size(L.HWt + 24, 110).at(L.cxT, waveY, 0.5, 0)
    const pw = L.HWt + 24
    const jit = Math.sin(S.t * 70) * S.corePulse * 4
    coreSp.show(hudOn && S.core && S.wave !== undefined).size(pw + 20, 56).at(L.cxT - pw / 2 + jit, waveY + 54, 0, 0)
    let y = waveY + 54 + 56
    // narrow: badge (left) and Biomass (right) share a row under the Core plate
    let badgeH = 0
    if (S.badge) {
      const maxRows = nar ? 3 : 10
      if (!S.badge.shown || S.badge.shownFor !== maxRows) {
        const rows = S.badge.rows
        S.badge.shown = rows.length > maxRows ? rows.slice(0, maxRows - 1).concat([{ name: '+' + (rows.length - maxRows + 1) + ' more', colour: P.dim, more: true }]) : rows
        S.badge.shownFor = maxRows
        badgeSp.dirty = true
      }
      badgeH = 36 + S.badge.shown.length * 21 + 6
    }
    const tutOn = hudOn && !!S.tut
    tutSp.show(tutOn)
    const badgeW = nar ? Math.min(300, Wu - 16 - 230 - 8) : 300
    let badgeY = nar ? y + 8 : 26 + L.insT + L.topL
    if (tutOn && !nar) { tutSp.at(32 + L.insL, 32 + L.insT + L.topL, 0, 0); badgeY = tutSp.y + tutSp.h + 10 }
    badgeSp.show(hudOn && S.badge && !nar).size(badgeW, badgeH).at((nar ? 8 : 28) + L.insL, badgeY, 0, 0)
    const bioW = nar ? 230 : 250
    bioSp.show(hudOn && S.biomassInit).size(bioW, 64).at(Wu - (nar ? 8 : 32) - L.insR, nar ? y + 8 : 20 + L.insT + L.topR, 1, 0)
    // the delta sits in the panel under the caption (under the panel it ran into the kill feed's first row)
    deltaSp.show(hudOn && S.deltaT > 0).size(120, 30).at(bioSp.x - bioW + 70, bioSp.y + 30 + (1.3 - S.deltaT) * 4, 0, 0)
    deltaSp.alpha = clamp01(S.deltaT / 0.4)
    if (nar) {
      L.vitTopY = y + 8
      y = y + 8 + (S.vitals ? 72 : 64) + 8
      if (tutOn) { tutSp.at(8, y, 0, 0); y += tutSp.h + 8 }
    } else y = 134
    // hive tag
    const tagOn = midOn && S.hiveTag
    if (tagOn) {
      if (L.tagFor !== S.hiveTag) { L.tagFor = S.hiveTag; L.tagSize = fit(S.hiveTag, 'h', 17, Wu - 48); L.tagW = Math.min(Wu - 16, tw(S.hiveTag, 'h', L.tagSize) + 32); tagSp.dirty = true }
      tagSp.size(L.tagW, 26).at(cx, y, 0.5, 0)
    }
    tagSp.show(tagOn)
    y += nar ? (tagOn ? 34 : 0) : 34
    const bossOn = hudOn && !!S.bossBand
    L.bossOn = bossOn
    const building = hudOn && !!S.buildBanner && !bossOn
    buildSp.show(building).size(L.HW, 46).at(cx, nar ? y : 168, 0.5, 0)
    gearSp.show(building && S.gearHint && !scr.gear).size(L.HW, 34).at(cx, buildSp.y + 46 + 8 - 2, 0.5, 0)
    let stackBottom = y
    if (building) stackBottom = buildSp.y + 46 + (S.gearHint ? 8 + 34 : 0) + 8
    const prevOn = building && S.bossPreview && !lockerNar
    if (prevOn) {
      if (L.previewFor !== S.bossPreview.text) { L.previewFor = S.bossPreview.text; L.previewSize = fit(S.bossPreview.text, 'h', 19, Wu - 48); L.previewW = Math.min(Wu - 16, tw(S.bossPreview.text, 'h', L.previewSize) + 32); previewSp.dirty = true }
      previewSp.size(L.previewW, 30).at(cx, nar ? stackBottom : 257, 0.5, 0)
      previewSp.alpha = 0.75 + 0.25 * Math.sin(S.t * 3)
      stackBottom = previewSp.y + 30 + 8
    }
    previewSp.show(prevOn)
    // boss band (reserved; nothing else in it)
    const bandTop = nar ? y : 196
    bossSp.show(bossOn).size(Math.min(920, Wu - 16), 88).at(cx, bandTop + 1, 0.5, 0)
    L.bandTop = bandTop; L.bandBottom = bandTop + 90; L.bandHalf = Math.min(470, Wu / 2 - 8)
    if (bossOn) stackBottom = Math.max(stackBottom, L.bandBottom + 8)
    const chipOn = hudOn && !!S.evoChip
    chipSp.show(chipOn).size(L.HW, 40).at(cx, nar ? stackBottom : 300, 0.5, 0)
    if (chipOn) stackBottom = Math.max(stackBottom, chipSp.y + 48)
    L.stackBottom = nar ? stackBottom : Math.max(stackBottom, 296)
    // ---- kill feed (top right; narrow: under the stack)
    const feedTop = nar ? L.stackBottom : 100 + L.topR
    for (let i = 0; i < S.feed.length; i++) {
      const e = S.feed[i], rowTop = feedTop + i * 34
      let cap = nar ? Math.min(360, Wu - 16) : 450
      if (!nar && L.bossOn && rowTop < L.bandBottom && rowTop + 30 > L.bandTop) cap = Math.min(cap, Math.max(120, Wu / 2 - 32 - L.bandHalf - 8))
      if (e.cap !== cap) { e.cap = cap; e.clipped = clip(e.segs, 'b', 19, cap - 24); e.w = clamp(segsW(e.clipped, 'b', 19) + 28, 120, cap); e.sp.dirty = true }
      e.sp.show(hudOn).size(e.w, 30).at(Wu - (nar ? 8 : 32) - L.insR, feedTop + i * 34 + (nar ? 0 : L.insT), 1, 0)
      e.sp.alpha = clamp01(e.t / 0.6)
    }
    for (const sp of feedPool) if (!sp.entry) sp.show(false)
    L.feedBottom = feedTop + S.feed.length * 34
    // ---- bottom panels
    const vw = nar ? (Wu - 24 - L.insL - L.insR) / 2 : 420
    const vBottom = Hu - (nar ? 8 : 32) - L.resL
    if (nar) vitSp.show(hudOn && S.vitals).size(Wu - 16 - 230 - 8, 72).at(8 + L.insL, L.vitTopY, 0, 0)
    else vitSp.show(midOn && S.vitals).size(vw, L.vitH + 28).at(32 + L.insL, vBottom, 0, 1)
    stamSp.show(midOn && !nar && S.vitals).size(vw - 50, 36).at(32 + L.insL, vBottom - 30 - 18, 0, 0)
    const armorOn = midOn && !nar && S.vitals && S.vitals.armor > 0
    armorSp.show(armorOn).size(vw, 30).at(vitSp.x, vBottom - L.vitH - 28 - 8, 0, 1)
    const ww = nar ? vw : 460
    const wBottom = Hu - (nar ? 8 : 32) - L.resR
    wepSp.show(midOn && S.weapon).size(ww, L.wepH + 30).at(Wu - (nar ? 8 : 32) - L.insR, wBottom, 1, 1)
    ammoSp.show(midOn && S.weapon).size(nar ? Math.min(ww, L.ammoW + 30) : 300, nar ? 80 : 110).at(wepSp.x, wBottom, 1, 1)
    const reloading = midOn && S.weapon && S.weapon.reloadFrac > 0 && S.weapon.reloadFrac < 1
    reloadSp.show(reloading).size(ww, 36).at(wepSp.x - ww, wBottom - L.wepH, 0, 0)
    reloadSp.alpha = 1
    const panelsTop = Math.min(vitSp.on && !nar ? vBottom - L.vitH - (armorOn ? 38 : 0) : Hu, wepSp.on ? wBottom - L.wepH - 30 : Hu)
    L.panelsTop = panelsTop
    // ---- centre
    const ccy = Hu / 2
    arrangeCrosshair(midOn && !S.death, cx, ccy)
    streakSp.show(hudOn && S.streakT > 0 && S.streak)
    if (S.streak) {
      const sc = lerp(1.6, 1, easeOutBack(S.streakPop))
      let fitK = 1
      if (nar) { const room = Wu - (cx + 50) - 8; fitK = Math.min(1, room / (tw(S.streak.label, 'h', 38) + 12)); streakSp.at(cx + 50, ccy, 0, 0.5) } else streakSp.at(cx + 120, ccy - 70, 0, 0.5)
      streakSp.scale = sc * fitK; streakSp.alpha = clamp01(S.streakT / 0.4)
    }
    // centre banner and level card: below the stack and the boss band
    const bannerCy = nar ? Math.max(L.feedBottom + 100, Math.min(ccy - 145, Hu * 0.4)) : Math.max(390, L.short ? L.stackBottom + 80 : 0)
    bannerSp.show(hudOn && S.banner && S.levelT >= 3.6)
    if (S.banner) {
      const inK = clamp01(S.bannerT / 0.28), outK = clamp01((S.bannerT - (S.banner.dur - 0.35)) / 0.35)
      bannerSp.scale = lerp(1.35, 1, easeOutBack(inK)) * (1 + outK * 0.1)
      bannerSp.alpha = inK * (1 - outK)
      bannerSp.at(cx, bannerCy, 0.5, 120 / bannerSp.h)
      bannerSp.snap = inK >= 1
    }
    const lvOn = hudOn && S.level && S.levelT < 3.6
    levelSp.show(lvOn)
    if (lvOn) {
      const kk = S.levelT / 3.6
      levelSp.alpha = clamp01(S.levelT / 0.15) * clamp01((1 - kk) / 0.12)
      levelSp.scale = lerp(1.22, 1, easeOutBack(clamp01(S.levelT / 0.45)))
      levelSp.at(cx, nar ? bannerCy : 400, 0.5, 0.5)
    }
    // pod pop under the crosshair
    const podOn = hudOn && S.pod && S.podT < 2.6
    podSp.show(podOn)
    if (podOn) {
      const kk = S.podT / 2.6
      podSp.alpha = clamp01(S.podT / 0.12) * clamp01((1 - kk) / 0.25)
      podSp.scale = 1 + 0.18 * Math.exp(-S.podT * 9)
      if (nar) podSp.at(8 + L.insL, L.toastBase - S.toasts.length * 36 - 4 - 14 * kk, 0, 1)
      else podSp.at(cx, ccy + 150 - 14 * kk, 0.5, 0.5)
    }
    // death
    const dead = hudOn && !!S.death
    deathQ.set(C_DEATH, dead ? 0.35 : 0)
    deathSp.show(dead).at(cx, ccy - 100, 0.5, 0)
    // ---- bottom centre: field guide card, toasts
    // field-guide card: bottom centre; on a phone it takes the banner's place above the crosshair (it waits for banners)
    const fgOn = hudOn && S.guide && S.guideT < 7 && !(nar && S.banner)
    guideSp.show(fgOn)
    let base = Hu - 150 - L.insB
    if (fgOn) {
      const t = S.guideT, kk = t / 7, drop = 18 * (1 - easeOutBack(clamp01(t / 0.4)))
      guideSp.alpha = clamp01(t / 0.25) * clamp01((1 - kk) / 0.08)
      if (nar) guideSp.at(cx, Math.max(L.feedBottom + 8, ccy - 70 - guideSp.h) + drop, 0.5, 0)
      else { guideSp.at(cx, base + drop, 0.5, 1); base -= guideSp.h + 10 }
    }
    // toasts: bottom centre; on a phone bottom-left, over the stick and clear of the button cluster
    const toastMax = nar ? Math.min(Wu - 16, L.toastCol) : Wu - 24
    const toastBase = nar ? Hu - 8 - Math.max(L.resL, 0) - 8 : base
    L.toastBase = toastBase
    for (let i = 0; i < S.toasts.length; i++) {
      const e = S.toasts[i]
      if (e.sp.dirty || !e.w || e.max !== toastMax) { e.max = toastMax; e.size = fit(e.segs, 'h', 22, toastMax - 40); e.w = Math.min(toastMax, segsW(e.segs, 'h', e.size) + 40); e.sp.dirty = true }
      if (nar) e.sp.show(hudOn).size(e.w, 32).at(8 + L.insL, toastBase - i * 36, 0, 1)
      else e.sp.show(hudOn).size(e.w, 32).at(cx, base - i * 36, 0.5, 1)
      e.sp.alpha = clamp01(e.t / 0.5)
    }
    for (const sp of toastPool) if (!sp.entry) sp.show(false)
    // ---- turret callout (top-left, 350 from the top; narrow: under the stack on the left)
    const callOn = hudOn && S.callout && S.calloutT > 0
    callSp.show(callOn)
    if (callOn) {
      const shown = 4.5 - S.calloutT
      callSp.alpha = clamp01(shown / 0.12) * clamp01(S.calloutT / 0.4)
      const slide = 1 - clamp01(shown / 0.18)
      const cyy = nar ? Math.max(L.feedBottom, L.stackBottom) + 8 + 29 : 350 + L.insT
      callSp.at((nar ? 8 : 28) + L.insL - 40 * slide * slide, cyy, 0, 0.5)
    }
    L.calloutBottom = callOn && nar ? callSp.y + 29 : 0
    // ---- world prompt
    arrangePrompt(dt, midOn)
    // ---- markers
    arrangeMarkers(midOn && !S.death)
    // ---- touch buttons
    const touchOn = S.visible && !modalOpen()
    for (const sp of touchPool) {
      const b = sp.btn
      const on = !!(b && !b.hidden && touchOn)
      sp.show(on)
      if (on) { const tc = touchCentre(b), r = b.r || 30; sp.size(r * 2 / s, r * 2 / s).at(tc[0] / s, tc[1] / s, 0.5, 0.5) }
    }
    // ---- vignettes and scope
    const hpN = S.vitals && S.vitals.max > 0 ? S.vitals.hp / S.vitals.max : 1
    const low = hpN < 0.4 && hpN > 0 ? (1 - hpN / 0.4) * (0.35 + 0.1 * Math.sin(S.t * 5)) : 0
    dmgQ.set(C_DMG, hudOn ? clamp01(Math.max(low, S.vignetteFlash * 0.8)) : 0)
    const cn = S.coreN
    const alarm = S.core && cn < 0.3 && cn > 0 ? (0.25 + 0.25 * Math.sin(S.t * 6)) * (1 - cn / 0.3) : 0
    alarmQ.set(C_ALARM, hudOn && S.core ? clamp01(alarm + S.corePulse * 0.12) : 0)
    const sa = smooth((S.scopeBlend - 0.35) / 0.65)
    const scopeA = hudOn ? sa : 0
    const lens = Hu + 4
    scopeQ.set(P.black, scopeA).setRect(cx - lens / 2, Hu / 2 - lens / 2, lens, lens)
    const side = Math.max(0, (Wu - lens) / 2 + 2)
    scopeL.set(P.black, side > 0 ? scopeA : 0).setRect(0, 0, side, Hu)
    scopeR.set(P.black, side > 0 ? scopeA : 0).setRect(Wu - side, 0, side, Hu)
    // duplex reticle: thick outer posts, fine inner cross, amber dot (in units of a 980 lens, scaled)
    const ls = lens / 980
    for (let i = 0; i < RETICLE.length; i++) { const r = RETICLE[i]; reticle[i].set(C_INK, scopeA * 0.9).setRect(cx + r[0] * ls - r[2] * ls / 2, Hu / 2 + r[1] * ls - r[3] * ls / 2, r[2] * ls, r[3] * ls) }
    reticle[8].set(P.amber, scopeA).setRect(cx - 2.5, Hu / 2 - 2.5, 5, 5)
    L.topAlpha = 1 - 0.92 * scopeA
    // ---- screens
    arrangeScreens()
  }

  function arrangePrompt(dt, hudOn) {
    const pr = S.prompt
    const want = hudOn && pr && pr.has && pr.m ? (S.banner ? 0 : 1) : 0
    S.promptAlpha = moveTo(S.promptAlpha, want, dt * 8)
    if (!pr || !pr.m || S.promptAlpha <= 0.001) { promptSp.show(false); if (pr && !pr.has && S.promptAlpha <= 0.001) { S.prompt = null; pr.placed = false } return }
    const m = pr.m
    if (pr.has) {
      const h = m.h, w = m.w
      const x = clamp(pr.tx, w / 2 + 24, Wu - w / 2 - 24)
      const topClear = Math.max(L.stackBottom, L.bossOn ? L.bandBottom : 0, L.narrow ? L.feedBottom : 0, L.narrow ? L.calloutBottom : 0) + 10
      const bottomMax = L.narrow ? L.panelsTop - 30 : Hu - 200
      const yb = clamp(pr.ty, topClear + h, Math.max(topClear + h, bottomMax))
      if (!pr.placed) { pr.pos[0] = x; pr.pos[1] = yb; pr.placed = true } else {
        const kk = 1 - Math.exp(-18 * dt)
        pr.pos[0] += (x - pr.pos[0]) * kk; pr.pos[1] += (yb - pr.pos[1]) * kk
      }
    }
    promptSp.show(true).at(pr.pos[0], pr.pos[1], 0.5, m.h / (m.h + 22))
    promptSp.alpha = S.promptAlpha
    setR(hitZones[4].r, pr.pos[0] - m.w / 2, pr.pos[1] - m.h, m.w, m.h)
  }

  const PLATE_SIEGE = [10, 8, 8], PLATE_TURRET = [10, 8, 13], PLATE_DEF = [5, 7, 11]
  function markerColour(kind) { return kind === 'hostile' ? P.danger : kind === 'pod' ? P.lime : kind === 'siege' ? P.siege : P.jam }
  function arrangeMarkers(hudOn) {
    const list = hudOn ? S.markers : NONE
    const n = Math.min(list.length, 10)
    while (markerPool.length < n) markerPool.push(markerSprites())
    const mx = 90, myTop = L.narrow ? Math.max(150, L.stackBottom, L.feedBottom || 0, L.calloutBottom || 0) + 40 : 150 + L.insT, myBottom = L.narrow ? Hu - L.panelsTop + 60 : 300
    for (let i = 0; i < markerPool.length; i++) {
      const mk = markerPool[i], m = i < n ? list[i] : null
      if (!m) { mk.lab.show(false); mk.ic.show(false); continue }
      const kind = MK[m.kind] ? m.kind : 'turret', st = MK[kind]
      // label plate: redrawn only when its text, colour, kind or bar (to 1/150) change; nothing is allocated otherwise
      const label = m.label == null ? '' : m.label
      let dirty = false
      if (mk.labSrc !== label || mk.kind !== kind) { mk.labSrc = label; mk.kind = kind; mk.label = String(label); mk.lw = Math.max(st.min, tw(mk.label, st.f, st.size) + 24); dirty = true }
      const colCh = colChanged(mk.col, m.colour, markerColour(kind))
      const barQ = m.bar == null ? -1 : Math.round(m.bar * 150)
      if (dirty || colCh || barQ !== mk.barQ) { mk.barQ = barQ; mk.bar = m.bar == null ? null : m.bar; mk.plateCol = kind === 'siege' ? PLATE_SIEGE : kind === 'turret' ? PLATE_TURRET : PLATE_DEF; mk.lab.redraw() }
      const lw = mk.lw
      const lx = m.x / s, ly = m.y / s
      const mxx = Math.max(mx, lw / 2 + 8)
      let px = clamp(lx, mxx, Wu - mxx), py = clamp(ly, myTop, Hu - myBottom)
      if (m.behind && Math.abs(py - (Hu - myBottom)) > 1) py = Hu - myBottom
      const boxH = kind === 'hostile' ? 48 : kind === 'pod' ? 56 : 70
      if (L.bossOn && Math.abs(px - Wu / 2) < L.bandHalf + 110 && py + boxH / 2 > L.bandTop && py - boxH / 2 < L.bandBottom) py = L.bandBottom + boxH / 2 + 4
      const off = m.behind || Math.hypot(px - lx, py - ly) > 1 || m.onScreen === false
      mk.lab.show(true).size(lw, st.plate).at(px, py + st.plateY, 0.5, 0)
      const pulse = m.pulse ? 0.7 + 0.3 * Math.abs(Math.sin(S.t * 5)) : 1
      mk.lab.alpha = pulse
      // icon on target, arrow at the edge
      const icName = off ? 'arrow' : m.icon || (kind === 'hostile' || kind === 'siege' ? 'target' : kind === 'pod' ? 'biomass' : 'turret')
      const isz = off ? (kind === 'hostile' ? 20 : 26) : st.icon
      if (icName !== mk.ic.icon || colCh || !mk.ic.col) { mk.ic.icon = icName; mk.ic.col = mk.col; mk.ic.redraw() }
      let rot = 0
      if (off) {
        let dx = lx - px, dy = ly - py
        if (typeof m.angle === 'number') { dx = Math.cos(m.angle); dy = Math.sin(m.angle) }
        if (Math.hypot(dx, dy) < 1) { dx = 0; dy = 1 }
        if (m.behind && typeof m.angle !== 'number') { dx = -dx; dy = -dy }
        rot = Math.atan2(dy, dx)
      }
      mk.ic.show(true).size(isz, isz).at(px, py + st.iconY, 0.5, 0.5)
      mk.ic.rot = rot
      mk.ic.snap = !off
      mk.ic.alpha = pulse
    }
  }

  function arrangeScreens() {
    const o = openScreen()
    const full = !!o
    const isTitle = o && o === scr.title
    const evo = o && o === scr.evolution
    const end = o && o === scr.end
    let fade = 1
    if (evo) {
      fade = clamp01(o.t / 0.3)
      if (o.closing >= 0) fade *= 1 - clamp01(o.closing / 0.4)
      screenBg.set(C_EVO_BG, aS(0.9) * fade)
      screenVig.set(C_EVO_VIG, 0.9 * fade)
    } else if (end) {
      fade = clamp01(o.t / 0.35)
      screenBg.set(C_END_BG, aS(0.86) * fade)
      screenVig.set(P.black, 0.6 * fade)
    } else if (o && (o === scr.pause || o === scr.guide)) {
      screenBg.set(C_PAUSE_BG, aS(o === scr.guide ? 0.9 : 0.8))
      screenVig.set(P.black, 0.6)
    } else if (isTitle) {
      screenBg.set(P.black, 0)
      screenVig.set(P.black, 0.7)
    } else { screenBg.set(P.black, 0); screenVig.set(P.black, 0) }
    shadeQ.set(P.black, 0)
    screenSp.show(full).size(Wu, Hu).at(0, 0, 0, 0)
    screenSp.alpha = fade
    scrA.show(full && (evo || end))
    scrB.show(full && (evo || end))
    if (evo) {
      const tk = clamp01((o.t - 0.2) / 0.45)
      scrA.alpha = tk * fade
      scrA.scale = lerp(1.22, 1, easeOutBack(tk))
      scrB.alpha = clamp01((o.t - 0.85) / 0.4) * fade
      for (let i = 0; i < o.rows.length; i++) {
        const at = 1.45 + i * 0.75, kk = clamp01((o.t - at) / 0.35)
        evoRows[i].show(true)
        evoRows[i].alpha = kk * fade
        evoRows[i].scale = 1
        evoRows[i].at(Wu / 2 + (1 - kk) * (1 - kk) * (L.narrow ? 0 : 0), o.Y.rows[i] + (1 - kk) * (1 - kk) * 30, 0.5, 0.5)
        evoRows[i].snap = kk >= 1
      }
      for (let i = o.rows.length; i < 3; i++) evoRows[i].show(false)
    } else for (const r of evoRows) r.show(false)
    if (end) { scrA.alpha = fade; scrA.scale = 1; scrB.alpha = fade }
    const g = scr.gear
    gearSpS.show(!!g && !full && S.visible)
    if (g) {
      // centred 20 above the middle (Unity), but never over the header stack, and kept on screen
      const gy = clamp(Hu / 2 - 20 - gearSpS.h / 2, Math.min(L.stackBottom + 6, Hu - gearSpS.h - 8), Math.max(8, Hu - gearSpS.h - 8))
      gearSpS.at(Wu / 2, gy, 0.5, 0)
      L.gearX = Wu / 2 - gearSpS.w / 2; L.gearY = gy
    }
    // tappable zones of the gameplay HUD
    setR(hitZones[0].r, buildSp.x - buildSp.w / 2, buildSp.y, buildSp.w, 46)
    setR(hitZones[1].r, gearSp.x - gearSp.w / 2, gearSp.y, gearSp.w, 34)
    setR(hitZones[2].r, chipSp.x - chipSp.w / 2, chipSp.y, chipSp.w, 40)
    setR(hitZones[3].r, tutSp.x + tutSp.w - 130, tutSp.y + tutSp.h - 40, 130, 40)
    setR(hitZones[5].r, wepSp.x - wepSp.w, wepSp.y - wepSp.h + 30, wepSp.w, wepSp.h - 30)
  }

  // ================================================================== frame
  function tick(dt) {
    S.t += dt
    // Core chip / pulse
    if (S.core) {
      const n = S.coreN, prev = S.coreChip
      S.coreChip = moveTo(S.coreChip, n, dt * (S.coreChip - n > 0.1 ? 0.5 : 0.25))
      if (Math.abs(prev - S.coreChip) > 1e-4) coreSp.dirty = true
      S.corePulse = moveTo(S.corePulse, 0, dt * 3)
    }
    if (S.vitals) {
      const n = S.vitals.max > 0 ? clamp01(S.vitals.hp / S.vitals.max) : 0, prev = S.hpChip
      S.hpChip = moveTo(S.hpChip, n, dt * 0.4)
      if (Math.abs(prev - S.hpChip) > 1e-4) vitSp.dirty = true
      if (S.staminaFlash > 0) { S.staminaFlash = moveTo(S.staminaFlash, 0, dt * 2.5); if (L.narrow) vitSp.dirty = true; else stamSp.dirty = true }
    }
    S.vignetteFlash = moveTo(S.vignetteFlash, 0, dt * 1.6)
    if (S.bossBand) { const prev = S.bossChip; S.bossChip = moveTo(S.bossChip, S.bossBand.frac, dt * 0.3); if (prev !== S.bossChip) bossSp.dirty = true }
    if (S.badgePulse > 0) { S.badgePulse = Math.max(0, S.badgePulse - dt * 0.5); badgeSp.dirty = true }
    // Biomass count-up
    if (S.biomassShown < S.biomassTarget) {
      const prev = Math.round(S.biomassShown)
      S.biomassShown = moveTo(S.biomassShown, S.biomassTarget, Math.max(30, (S.biomassTarget - S.biomassShown) * 7) * dt)
      if (Math.round(S.biomassShown) !== prev) bioSp.dirty = true
    }
    if (S.biomassPulse > 0) { S.biomassPulse = moveTo(S.biomassPulse, 0, dt * 4); bioSp.dirty = true }
    if (S.deltaT > 0) S.deltaT -= dt
    // feed, toasts
    for (let i = S.feed.length - 1; i >= 0; i--) { S.feed[i].t -= dt; if (S.feed[i].t <= 0) { S.feed[i].sp.entry = null; S.feed.splice(i, 1) } }
    for (let i = S.toasts.length - 1; i >= 0; i--) { S.toasts[i].t -= dt; if (S.toasts[i].t <= 0) { S.toasts[i].sp.entry = null; S.toasts.splice(i, 1) } }
    // crosshair hitmarker
    if (S.hitT > 0) S.hitT -= dt
    // streak
    if (S.streakT > 0) { S.streakT -= dt; S.streakPop = Math.min(1, S.streakPop + dt / 0.2) }
    // banner queue (held while a level-up card shows)
    if (S.levelT < 3.6) {
      S.levelT += dt
      if (S.levelT >= 3.6) { if (S.levels.length) nextLevel(); else if (!S.banner && S.banners.length) nextBanner() }
    } else if (S.levels.length) nextLevel()
    if (S.banner && S.levelT >= 3.6) {
      const prevIn = clamp01(S.bannerT / 0.28)
      S.bannerT += dt
      const spc = Math.round(lerp(8, 1, clamp01(S.bannerT / 0.28)) * 2)
      if (prevIn < 1 && spc !== Math.round(lerp(8, 1, prevIn) * 2)) bannerSp.dirty = true
      if (S.bannerT >= S.banner.dur) nextBanner()
    } else if (!S.banner && S.banners.length && S.levelT >= 3.6) nextBanner()
    if (S.guide) { S.guideT += dt; if (S.guideT >= 7) nextGuide() }
    if (S.podT < 2.6) S.podT += dt
    if (S.calloutT > 0) S.calloutT -= dt
    if (S.tut && S.tutCheck < 1) { S.tutCheck = Math.min(1, S.tutCheck + dt / 0.3); tutSp.dirty = true }
    // reload text pulse
    if (S.weapon && S.weapon.reloadFrac > 0 && S.weapon.reloadFrac < 1) reloadSp.alpha = 0.6 + 0.4 * Math.sin(S.t * 14)
    // scope
    const prevBlend = S.scopeBlend
    S.scopeBlend = moveTo(S.scopeBlend, S.scope ? 1 : 0, dt * 6)
    // screens
    const ev = scr.evolution
    if (ev) {
      const prevT = ev.t
      ev.t += dt
      if (ev.t < 0.75) scrA.dirty = true
      if (ev.t < 1.4) scrB.dirty = true
      const footAt = 1.45 + ev.rows.length * 0.75
      if (ev.t >= footAt && prevT < footAt + 0.55) screenSp.dirty = true
      if (ev.closing >= 0) {
        ev.closing += dt
        if (ev.closing >= 0.4) { scr.evolution = null; evoDoneSig = ev.sig; if (ev.m.onContinue) ev.m.onContinue() }
      }
    }
    const en = scr.end
    if (en) { const pt = en.t; en.t += dt; if (pt < 0.65) scrA.dirty = true; if (pt < 1.45) scrB.dirty = true }
  }

  hud.update = dt => {
    const t0 = performance.now()
    if (fitCam && !overlay) hud.fit(fitCam) // the FOV changes with aiming and sprinting
    dt = Math.min(0.1, Math.max(0, dt || 0))
    stats.frameRedraws = 0
    tick(dt)
    arrange(dt)
    for (const sp of sprites) {
      const groupOn = sp.group === 'screen' || sp.group === 'touch' || S.visible
      const ga = sp.group === 'top' ? L.topAlpha : 1
      const a = sp.alpha * ga
      const vis = sp.on && groupOn && a > 0.003
      if (vis && sp.dirty) renderSprite(sp)
      sp.mesh.visible = vis && !!sp.tex
      if (sp.mesh.visible) placeMesh(sp, a)
    }
    for (const q of quads) {
      const vis = q.alpha > 0.003 && (q.group === 'screen' || S.visible)
      q.mesh.visible = vis
      if (!vis) continue
      q.mat.color.setRGB(q.color[0] / 255, q.color[1] / 255, q.color[2] / 255, THREE.SRGBColorSpace)
      q.mat.opacity = q.alpha
      const r = q.rect || [0, 0, Wu, Hu]
      q.mesh.position.set(r[0] + r[2] / 2 - Wu / 2, Hu / 2 - (r[1] + r[3] / 2), 0)
      q.mesh.scale.set(r[2], r[3], 1)
      q.mesh.rotation.z = q.rot ? -q.rot : 0
    }
    stats.updateMs = performance.now() - t0
  }

  // ================================================================== view
  hud.resize = (w, h, pixelRatio) => {
    Wc = Math.max(1, w || Wc); Hc = Math.max(1, h || Hc); dpr = pixelRatio || dpr
    s = Math.max(Math.sqrt((Wc / 1920) * (Hc / 1080)), 11 / 16)
    let pr = Math.min(dpr, 1.5)
    const long = Math.max(Wc, Hc)
    if (long > 1920) pr *= 1920 / long
    k = s * pr
    Wu = Wc / s; Hu = Hc / s
    relayout()
  }
  hud.insets = v => { Object.assign(insetsCss, v || {}); relayout() }
  let fitCam = null, overlay = null
  hud.fit = camera => {
    fitCam = camera || fitCam
    const cam = fitCam
    if (!cam) return
    const d = (cam.near || 0.1) + 0.05
    let hW
    if (cam.isOrthographicCamera) hW = (cam.top - cam.bottom) / (cam.zoom || 1)
    else hW = 2 * d * Math.tan((cam.fov * Math.PI / 180) / 2) / (cam.zoom || 1)
    object.position.set(0, 0, -d)
    object.quaternion.identity()
    object.scale.set(hW / Hu, hW / Hu, 1)
  }
  /**
   * Alternative to parenting hud.object to the camera (e.g. when a post-processing composer would bloom or tone-map the
   * HUD): call this after the main render each frame; it draws the HUD with its own orthographic camera on top.
   */
  hud.renderOverlay = renderer => {
    if (!overlay) overlay = { scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10) }
    if (object.parent !== overlay.scene) overlay.scene.add(object)
    object.position.set(0, 0, -1); object.quaternion.identity(); object.scale.set(1, 1, 1)
    const cam = overlay.cam
    if (cam.right !== Wu / 2 || cam.top !== Hu / 2) { cam.left = -Wu / 2; cam.right = Wu / 2; cam.top = Hu / 2; cam.bottom = -Hu / 2; cam.updateProjectionMatrix() }
    const ac = renderer.autoClear
    renderer.autoClear = false
    renderer.render(overlay.scene, cam)
    renderer.autoClear = ac
  }
  hud.setVisible = on => { S.visible = !!on }
  /** positions (units) of a few tappable things, for tests */
  hud._debug = () => ({ gear: { x: L.gearX, y: L.gearY }, build: { x: buildSp.x, y: buildSp.y }, prompt: { x: promptSp.x, y: promptSp.y - promptSp.ay * promptSp.h },
    transient: S.banners.length + S.levels.length + S.guides.length + S.toasts.length + S.feed.length + (S.banner ? 1 : 0) + (S.level ? 1 : 0) + (S.guide ? 1 : 0) + (S.streak ? 1 : 0) + (S.pod ? 1 : 0) + (S.deltaT > 0 ? 1 : 0) })
  hud.size = () => ({ width: Wc, height: Hc, scale: s, unitsW: Wu, unitsH: Hu, narrow: !!L.narrow })
  hud.dispose = () => {
    for (const sp of sprites) { if (sp.tex) sp.tex.dispose(); sp.mat.dispose() }
    for (const q of quads) { if (q.mat.map) q.mat.map.dispose(); q.mat.dispose() }
    geo.dispose()
    if (object.parent) object.parent.remove(object)
  }

  hud.resize(Wc, Hc, dpr)
  hud.load()
  return hud
}
