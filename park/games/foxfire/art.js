// Hive Adapt: Foxfire Watch: textures painted at start into OffscreenCanvas (no image files needed).
import * as THREE from 'three'

export function canvas(w, h) {
  const c = new OffscreenCanvas(w, h)
  return [c, c.getContext('2d')]
}

export function texture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 1
  return t
}

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Night sky: indigo to a warm horizon, a few soft cloud bands. */
export function skyTexture() {
  const [c, g] = canvas(64, 512)
  const grad = g.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0.0, '#0b0d22')
  grad.addColorStop(0.45, '#1e2147')
  grad.addColorStop(0.72, '#5a3a5c')
  grad.addColorStop(0.86, '#b8614a')
  grad.addColorStop(1.0, '#e9a15e')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 512)
  return texture(c)
}

/** A round glow with a soft edge, for additive sprites and particles. */
export function glowTexture() {
  const [c, g] = canvas(128, 128)
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0.0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,235,190,0.85)')
  grad.addColorStop(0.45, 'rgba(255,170,70,0.32)')
  grad.addColorStop(1.0, 'rgba(255,120,30,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return texture(c)
}

/** Ink-wash mountain ridge: dark ink at the bottom, washed out towards the peaks. */
export function ridgeTexture(seed, ink, mist) {
  const [c, g] = canvas(1024, 256)
  const r = rng(seed)
  const pts = []
  let y = 120 + r() * 40
  for (let x = 0; x <= 1024; x += 16) {
    y += (r() - 0.5) * 34
    y = Math.max(40, Math.min(200, y))
    pts.push([x, y])
  }
  const grad = g.createLinearGradient(0, 40, 0, 256)
  grad.addColorStop(0, ink)
  grad.addColorStop(1, mist)
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, 256)
  for (const [x, yy] of pts) g.lineTo(x, yy)
  g.lineTo(1024, 256)
  g.closePath()
  g.fill()
  return texture(c)
}

/** Paper lantern skin: warm paper, ink ribs, red bands and an original fox crest. */
export function lanternTexture(hue = 0) {
  const [c, g] = canvas(256, 256)
  const paper = ['#f3e4c6', '#f6dcc0', '#efe7cf'][hue % 3]
  g.fillStyle = paper
  g.fillRect(0, 0, 256, 256)
  // soft fibre noise
  const r = rng(7 + hue)
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(120,80,40,${0.03 + r() * 0.05})`
    g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1)
  }
  // ribs
  g.strokeStyle = 'rgba(70,40,25,0.45)'
  g.lineWidth = 2
  for (let y = 22; y < 236; y += 21) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke()
  }
  // red bands top and bottom
  g.fillStyle = '#b3311f'
  g.fillRect(0, 0, 256, 18)
  g.fillRect(0, 238, 256, 18)
  // fox crest, twice around the lantern
  for (const cx of [64, 192]) {
    g.fillStyle = '#b3311f'
    g.beginPath()
    g.moveTo(cx - 34, 92); g.lineTo(cx - 22, 58); g.lineTo(cx - 8, 86)
    g.lineTo(cx + 8, 86); g.lineTo(cx + 22, 58); g.lineTo(cx + 34, 92)
    g.lineTo(cx, 150); g.closePath(); g.fill()
    g.fillStyle = paper
    g.beginPath(); g.ellipse(cx - 12, 104, 6, 3, -0.4, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.ellipse(cx + 12, 104, 6, 3, 0.4, 0, Math.PI * 2); g.fill()
    g.strokeStyle = 'rgba(40,20,15,0.7)'
    g.lineWidth = 3
    g.beginPath(); g.moveTo(cx - 40, 172); g.quadraticCurveTo(cx, 190, cx + 40, 172); g.stroke()
  }
  return texture(c)
}

/** Gold lantern: same shape, gilded. */
export function goldTexture() {
  const [c, g] = canvas(128, 128)
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, '#ffe9a0'); grad.addColorStop(0.5, '#f2b33d'); grad.addColorStop(1, '#b97a1c')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(120,70,10,0.5)'
  g.lineWidth = 2
  for (let y = 12; y < 120; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke() }
  return texture(c)
}

/** Washi floor: dark ink-stained paper. */
export function floorTexture() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#231c22'
  g.fillRect(0, 0, 256, 256)
  const r = rng(99)
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(10,8,14,${0.15 + r() * 0.25})`
    g.beginPath(); g.ellipse(r() * 256, r() * 256, 6 + r() * 30, 3 + r() * 12, r() * 3, 0, Math.PI * 2); g.fill()
  }
  const t = texture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(40, 40)
  return t
}

/** Three-step toon ramp for the fox and the shrine. */
export function toonRamp() {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255])
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

/**
 * The paper arena: a washi disc of radius `r` game units, with an ink-brush rim, the mend circle round the
 * shrine, the lantern ring and a vermilion seal at every pad. Painted for a CircleGeometry laid flat
 * (canvas x = world x, canvas y = world z).
 */
export function arenaTexture(r, padR, padPositions, mendR, gateAngles) {
  const N = 1024
  const [c, g] = canvas(N, N)
  const px = u => (u / r + 1) * N / 2
  const rnd = rng(31)
  g.fillStyle = '#efe0c2'
  g.fillRect(0, 0, N, N)
  // paper fibres and soft stains
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = `rgba(120,80,40,${0.025 + rnd() * 0.05})`
    g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 6, 1)
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(190,150,100,${0.04 + rnd() * 0.06})`
    g.beginPath(); g.ellipse(rnd() * N, rnd() * N, 20 + rnd() * 70, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2); g.fill()
  }
  // darker toward the rim
  const vg = g.createRadialGradient(N / 2, N / 2, N * 0.28, N / 2, N / 2, N / 2)
  vg.addColorStop(0, 'rgba(120,70,30,0)')
  vg.addColorStop(1, 'rgba(120,70,30,0.32)')
  g.fillStyle = vg
  g.fillRect(0, 0, N, N)
  // ink-brush rim: a rough ring
  g.strokeStyle = 'rgba(28,20,34,0.92)'
  for (let k = 0; k < 3; k++) {
    g.lineWidth = 16 - k * 4
    g.beginPath()
    for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.05) {
      const rr = px(r * 0.985 - k * 0.07) - N / 2 + (rnd() - 0.5) * 3
      const x = N / 2 + Math.cos(a) * rr, y = N / 2 + Math.sin(a) * rr
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y)
    }
    g.stroke()
  }
  // lantern ring (dashed)
  g.setLineDash([14, 12])
  g.strokeStyle = 'rgba(150,60,40,0.4)'
  g.lineWidth = 4
  g.beginPath(); g.arc(N / 2, N / 2, px(padR) - N / 2, 0, Math.PI * 2); g.stroke()
  g.setLineDash([])
  // mend circle round the shrine
  g.strokeStyle = 'rgba(217,67,43,0.55)'
  g.lineWidth = 6
  g.beginPath(); g.arc(N / 2, N / 2, px(mendR) - N / 2, 0, Math.PI * 2); g.stroke()
  g.strokeStyle = 'rgba(217,67,43,0.3)'
  g.lineWidth = 3
  g.beginPath(); g.arc(N / 2, N / 2, px(mendR * 0.62) - N / 2, 0, Math.PI * 2); g.stroke()
  // pad seals
  for (const p of padPositions) {
    const x = px(p.x), y = px(p.z)
    g.fillStyle = 'rgba(217,67,43,0.22)'
    g.beginPath(); g.arc(x, y, 52, 0, Math.PI * 2); g.fill()
    g.strokeStyle = 'rgba(150,40,25,0.7)'
    g.lineWidth = 5
    g.beginPath(); g.arc(x, y, 52, 0, Math.PI * 2); g.stroke()
    g.beginPath(); g.arc(x, y, 34, 0, Math.PI * 2); g.stroke()
  }
  // a brush line from every gate towards the shrine
  for (const a of gateAngles) {
    g.strokeStyle = 'rgba(28,20,34,0.12)'
    g.lineWidth = 36
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(N / 2 + Math.cos(a) * px(r * 0.95) - N / 2 + 0, N / 2 + Math.sin(a) * (px(r * 0.95) - N / 2))
    g.lineTo(N / 2 + Math.cos(a) * 150, N / 2 + Math.sin(a) * 150)
    g.stroke()
  }
  const t = texture(c)
  t.anisotropy = 4
  return t
}

/** A small label for a pad: its price, on a dark paper tag. */
export function drawTag(g, text, ok) {
  g.clearRect(0, 0, 256, 96)
  g.fillStyle = ok ? 'rgba(26,18,34,0.85)' : 'rgba(26,18,34,0.6)'
  g.beginPath()
  g.roundRect ? g.roundRect(8, 8, 240, 80, 30) : g.rect(8, 8, 240, 80)
  g.fill()
  g.strokeStyle = ok ? '#ffc24a' : 'rgba(217,67,43,0.8)'
  g.lineWidth = 4
  g.stroke()
  let size = 52
  g.font = `bold ${size}px Georgia, "Times New Roman", serif`
  while (g.measureText(text).width > 212 && size > 24) { size -= 2; g.font = `bold ${size}px Georgia, "Times New Roman", serif` }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = ok ? '#ffe9b0' : '#e2a79a'
  g.fillText(text, 128, 50)
}

/** A pale moon with a soft halo and a band of ink cloud across it. */
export function moonTexture() {
  const [c, g] = canvas(256, 256)
  const halo = g.createRadialGradient(128, 128, 40, 128, 128, 128)
  halo.addColorStop(0, 'rgba(255,236,200,0.55)')
  halo.addColorStop(1, 'rgba(255,200,150,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, 256, 256)
  const disc = g.createRadialGradient(118, 116, 6, 128, 128, 52)
  disc.addColorStop(0, '#fff8e6')
  disc.addColorStop(1, '#f1d9ad')
  g.fillStyle = disc
  g.beginPath(); g.arc(128, 128, 50, 0, Math.PI * 2); g.fill()
  g.fillStyle = 'rgba(214,180,140,0.35)'
  for (const [x, y, r] of [[110, 112, 9], [146, 140, 12], [132, 104, 5], [104, 146, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
  g.fillStyle = 'rgba(40,26,52,0.55)'
  g.beginPath(); g.ellipse(120, 150, 92, 9, -0.08, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.ellipse(150, 166, 60, 6, -0.05, 0, Math.PI * 2); g.fill()
  return texture(c)
}

/** A light beam: bright at the bottom, gone at the top, soft at the sides. For the open gates. */
export function beamTexture() {
  const [c, g] = canvas(64, 256)
  const v = g.createLinearGradient(0, 256, 0, 0)
  v.addColorStop(0, 'rgba(255,255,255,1)')
  v.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  v.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = v
  g.fillRect(0, 0, 64, 256)
  g.globalCompositeOperation = 'destination-in'
  const h = g.createLinearGradient(0, 0, 64, 0)
  h.addColorStop(0, 'rgba(0,0,0,0.25)')
  h.addColorStop(0.5, 'rgba(0,0,0,1)')
  h.addColorStop(1, 'rgba(0,0,0,0.25)')
  g.fillStyle = h
  g.fillRect(0, 0, 64, 256)
  return texture(c)
}

/** The land round the arena: dark ink-washed earth, warmer and lighter toward the horizon. */
export function outerGroundTexture() {
  const N = 512
  const [c, g] = canvas(N, N)
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  grad.addColorStop(0, '#2a2133')
  grad.addColorStop(0.12, '#2f2436')
  grad.addColorStop(0.45, '#4a3245')
  grad.addColorStop(1, '#7a4a4a')
  g.fillStyle = grad
  g.fillRect(0, 0, N, N)
  const r = rng(5)
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = (0.06 + r() * 0.44) * N
    g.fillStyle = `rgba(16,10,22,${0.08 + r() * 0.14})`
    g.beginPath()
    g.ellipse(N / 2 + Math.cos(a) * d, N / 2 + Math.sin(a) * d, 4 + r() * 22, 2 + r() * 6, a + Math.PI / 2, 0, Math.PI * 2)
    g.fill()
  }
  return texture(c)
}
