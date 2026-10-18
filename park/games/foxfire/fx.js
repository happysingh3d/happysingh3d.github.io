// Hive Adapt: Foxfire Watch: effects. Sparks, flat rings on the paper, floating words, and a pool of glowing dots
// that the game redraws every frame for bolts. All additive sprites; no new materials appear once the game runs.
import * as THREE from 'three'
import { canvas, texture } from './art.js'

const POINT_VERT = `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  uniform float scale;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`
const POINT_FRAG = `
  uniform sampler2D map;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.a * 1.4, 1.0);
  }`

function pointMaterial(glowTex) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTex }, scale: { value: 600 } },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

export class Sparks {
  constructor(scene, glowTex, max = 600) {
    this.max = max
    this.n = 0
    this.p = new Float32Array(max * 3)
    this.v = new Float32Array(max * 3)
    this.c = new Float32Array(max * 3)
    this.base = new Float32Array(max * 3)
    this.s = new Float32Array(max)
    this.life = new Float32Array(max)
    this.age = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.grav = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage)
    this.sizeAttr = new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.posAttr)
    g.setAttribute('color', this.colAttr)
    g.setAttribute('size', this.sizeAttr)
    g.setDrawRange(0, 0)
    this.material = pointMaterial(glowTex)
    this.points = new THREE.Points(g, this.material)
    this.points.frustumCulled = false
    scene.add(this.points)
    this.geo = g
    this.density = 1
  }

  setScale(viewHeightPx, fovDeg) {
    this.material.uniforms.scale.value = viewHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))
  }

  /** A burst in the ground plane (x, z) with an upward kick. */
  emit(x, y, z, opts) {
    const { count = 10, speed = 3, color = [1, 0.6, 0.2], size = 0.35, life = 0.8, up = 1.5, drag = 1.5, gravity = 4 } = opts
    const n = Math.max(1, Math.round(count * this.density))
    for (let k = 0; k < n; k++) {
      if (this.n >= this.max) this.kill(0)
      const i = this.n++
      const a = Math.random() * Math.PI * 2
      const r = speed * (0.35 + 0.65 * Math.random())
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z
      this.v[i * 3] = Math.cos(a) * r; this.v[i * 3 + 1] = up * (0.4 + Math.random()); this.v[i * 3 + 2] = Math.sin(a) * r
      this.base[i * 3] = color[0]; this.base[i * 3 + 1] = color[1]; this.base[i * 3 + 2] = color[2]
      this.s[i] = size * (0.6 + 0.8 * Math.random())
      this.life[i] = life * (0.6 + 0.6 * Math.random())
      this.age[i] = 0
      this.drag[i] = drag
      this.grav[i] = gravity
    }
  }

  kill(i) {
    const j = --this.n
    if (i === j) return
    for (let k = 0; k < 3; k++) {
      this.p[i * 3 + k] = this.p[j * 3 + k]; this.v[i * 3 + k] = this.v[j * 3 + k]; this.base[i * 3 + k] = this.base[j * 3 + k]
    }
    this.s[i] = this.s[j]; this.life[i] = this.life[j]; this.age[i] = this.age[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j]
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue }
      const f = Math.max(0, 1 - this.drag[i] * dt)
      this.v[i * 3] *= f; this.v[i * 3 + 2] *= f
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * f - this.grav[i] * dt
      this.p[i * 3] += this.v[i * 3] * dt
      this.p[i * 3 + 1] = Math.max(0.02, this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt)
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt
      const t = 1 - this.age[i] / this.life[i]
      const fade = t * t
      this.c[i * 3] = this.base[i * 3] * fade; this.c[i * 3 + 1] = this.base[i * 3 + 1] * fade; this.c[i * 3 + 2] = this.base[i * 3 + 2] * fade
    }
    this.geo.setDrawRange(0, this.n)
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = true
  }
}

/** Glowing dots the game rewrites every frame: bolts and lantern wisps. begin(), add() many times, end(). */
export class Dots {
  constructor(scene, glowTex, max = 220) {
    this.max = max
    this.n = 0
    this.p = new Float32Array(max * 3)
    this.c = new Float32Array(max * 3)
    this.s = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage)
    this.sizeAttr = new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.posAttr)
    g.setAttribute('color', this.colAttr)
    g.setAttribute('size', this.sizeAttr)
    g.setDrawRange(0, 0)
    this.material = pointMaterial(glowTex)
    this.points = new THREE.Points(g, this.material)
    this.points.frustumCulled = false
    scene.add(this.points)
    this.geo = g
  }

  setScale(viewHeightPx, fovDeg) {
    this.material.uniforms.scale.value = viewHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))
  }

  begin() { this.n = 0 }

  add(x, y, z, size, r, g, b) {
    if (this.n >= this.max) return
    const i = this.n++
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z
    this.c[i * 3] = r; this.c[i * 3 + 1] = g; this.c[i * 3 + 2] = b
    this.s[i] = size
  }

  end() {
    this.geo.setDrawRange(0, this.n)
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = true
  }
}

/** Expanding light rings lying flat on the paper. */
export class Rings {
  constructor(scene, count = 12) {
    this.items = []
    const geo = new THREE.RingGeometry(0.88, 1.0, 48)
    geo.rotateX(-Math.PI / 2)
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      m.visible = false
      scene.add(m)
      this.items.push({ m, t: 1, dur: 0.4, r: 3 })
    }
    this.next = 0
  }

  spawn(x, z, radius, color = 0xffb04a, dur = 0.42) {
    const it = this.items[this.next++ % this.items.length]
    it.m.position.set(x, 0.06, z)
    it.m.material.color.setHex(color)
    it.t = 0; it.dur = dur; it.r = radius
    it.m.visible = true
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue
      it.t += dt / it.dur
      if (it.t >= 1) { it.m.visible = false; continue }
      const e = 1 - (1 - it.t) ** 3
      it.m.scale.setScalar(0.2 + it.r * e)
      it.m.material.opacity = 0.9 * (1 - it.t)
    }
  }
}

/** Floating words and numbers drawn on small canvases. */
export class Popups {
  constructor(scene, count = 16) {
    this.items = []
    for (let i = 0; i < count; i++) {
      const [c, g] = canvas(512, 128)
      const t = texture(c)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }))
      s.visible = false
      s.renderOrder = 10
      scene.add(s)
      this.items.push({ s, c, g, t, age: 0, life: 1, vy: 1 })
    }
    this.next = 0
    this.k = 0.12
  }

  /** Words keep one size on screen: k turns a size in units into the sprite scale that gives it. */
  setScreenScale(k) { this.k = k }

  show(text, x, y, z, opts = {}) {
    const { color = '#ffe2a6', size = 0.9, life = 1.0, vy = 1.2, stroke = '#2a120c' } = opts
    const it = this.items[this.next++ % this.items.length]
    const g = it.g
    g.clearRect(0, 0, 512, 128)
    g.font = 'bold 76px Georgia, "Times New Roman", serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 12
    g.strokeStyle = stroke
    g.strokeText(text, 256, 66)
    g.fillStyle = color
    g.fillText(text, 256, 66)
    it.t.needsUpdate = true
    it.s.position.set(x, y, z)
    it.s.scale.set(size * 4 * this.k, size * this.k, 1)
    it.s.material.opacity = 1
    it.s.visible = true
    it.age = 0; it.life = life; it.vy = vy
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.s.visible) continue
      it.age += dt
      if (it.age >= it.life) { it.s.visible = false; continue }
      it.s.position.y += it.vy * dt
      const t = it.age / it.life
      it.s.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
    }
  }
}
