// Hive Adapt (Project 0 port): enemy-owned visuals that are gameplay-critical and must not depend on fx.js:
// telegraph rings (TelegraphMarker / FX_BossTelegraph), siege landing markers, burrow cracks, charge lines,
// and the projectile bodies (acid, acid lob, siege shell). Everything lives under G.root (game space).
import * as THREE from 'three'

const RING_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
// style 0: boss telegraph (hard ring at 0.93, 24 hazard ticks at 0.84, fill disc 0 -> full), 1: siege landing marker,
// 2: burrow cracks (radial embers), 3: soft ring (charge line node)
const RING_FRAG = /* glsl */`
uniform float uK, uTime, uAlpha, uStyle;
uniform vec3 uColor;
varying vec2 vUv;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float k = clamp(uK, 0.0, 1.0);
  float pulse = 0.6 + 0.4 * sin(uTime * (3.0 + 6.0 * k) * 6.2831853);
  float val = 0.0;
  if (uStyle < 0.5 || uStyle > 2.5) {
    float ring = smoothstep(0.045, 0.0, abs(r - 0.93));
    float ticks = step(0.5, fract(a / 6.2831853 * 24.0)) * smoothstep(0.035, 0.0, abs(r - 0.84) - 0.025);
    float fill = step(r, k) * mix(0.35, 0.8, k) * 0.5;
    float edge = smoothstep(0.04, 0.0, abs(r - k)) * step(0.02, k) * 0.9;
    val = ring * pulse * 1.3 + ticks * 0.7 + fill + edge;
    if (uStyle > 2.5) val = ring * 0.8 + fill * 0.6;
  } else if (uStyle < 1.5) {
    float ring = smoothstep(0.06, 0.0, abs(r - 0.92));
    float inner = smoothstep(0.05, 0.0, abs(r - 0.35 - 0.55 * (1.0 - k)));
    float cross = (smoothstep(0.035, 0.0, abs(vUv.x)) + smoothstep(0.035, 0.0, abs(vUv.y))) * step(r, 0.3);
    float fill = step(r, k) * 0.3;
    val = ring * pulse * 1.4 + inner * 0.9 + cross * 0.8 + fill;
  } else {
    float n = floor(a / 6.2831853 * 9.0 + 4.5);
    float jag = 0.07 * sin(r * 23.0 + n * 3.1) + 0.04 * sin(r * 51.0 + n);
    float seg = abs(fract(a / 6.2831853 * 9.0 + jag + 0.5 * h1(n)) - 0.5);
    float crack = smoothstep(0.07, 0.0, seg) * smoothstep(1.0, 0.25, r) * step(0.12, r);
    float core = smoothstep(0.5, 0.0, r) * 0.6;
    val = (crack * 1.4 + core) * (0.55 + 0.45 * k) * (0.7 + 0.3 * pulse);
  }
  gl_FragColor = vec4(uColor * val * uAlpha, 1.0);
}
`
const LINE_FRAG = /* glsl */`
uniform float uK, uTime, uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = vUv.x, y = vUv.y * 0.5 + 0.5;
  float side = smoothstep(0.12, 0.0, abs(abs(x) - 0.85));
  float chev = fract(y * 6.0 - abs(x) * 0.6 - uTime * 1.5);
  float arrow = smoothstep(0.15, 0.0, abs(chev - 0.5)) * step(abs(x), 0.8) * step(y, uK + 0.02);
  float val = side * 0.8 + arrow * 0.9;
  gl_FragColor = vec4(uColor * val * uAlpha, 1.0);
}
`

const UP = new THREE.Vector3(0, 1, 0)
const _n = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion()

export function createEnemyFx(G) {
  const root = G.root
  const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
  const lineGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).translate(0, 0, -1) // spans z 0..-2 -> scaled to length
  const markers = []
  const free = { ring: [], line: [] }
  const time = { value: 0 }

  function makeMat(frag) {
    return new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 }, uTime: time, uAlpha: { value: 1 }, uStyle: { value: 0 }, uColor: { value: new THREE.Color() } },
      vertexShader: RING_VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, toneMapped: false, fog: false,
    })
  }
  function take(type) {
    let m = free[type].pop()
    if (!m) {
      m = new THREE.Mesh(type === 'ring' ? ringGeo : lineGeo, makeMat(type === 'ring' ? RING_FRAG : LINE_FRAG))
      m.frustumCulled = false
      m.renderOrder = 5
      m.userData.type = type
    }
    root.add(m)
    m.visible = true
    return m
  }

  /** orient a marker to the ground plane under it (samples world.groundY around the centre) */
  function fitGround(mesh, pos, r) {
    const w = G.world
    const y0 = pos.y
    let nx = 0, nz = 0
    if (w && w.groundY && r > 0.5) {
      const d = Math.min(r * 0.7, 3)
      const yE = w.groundY(pos.x + d, pos.z, y0 + 1.5), yW = w.groundY(pos.x - d, pos.z, y0 + 1.5)
      const yN = w.groundY(pos.x, pos.z - d, y0 + 1.5), yS = w.groundY(pos.x, pos.z + d, y0 + 1.5)
      if (isFinite(yE) && isFinite(yW) && Math.abs(yE - yW) < d * 1.2) nx = -(yE - yW) / (2 * d)
      if (isFinite(yN) && isFinite(yS) && Math.abs(yN - yS) < d * 1.2) nz = -(yS - yN) / (2 * d)
    }
    _n.set(nx, 1, nz).normalize()
    mesh.quaternion.setFromUnitVectors(UP, _n)
    mesh.position.copy(pos).addScaledVector(_n, 0.07)
  }

  /**
   * Ground ring that fills over `seconds` (the attack lands when it is full).
   * style: 'boss' (red hazard ring), 'siege' (red landing marker), 'crack' (ember burrow cracks), 'soft'
   * returns a handle { kill(), pos, k }
   */
  function ring(pos, radius, seconds, opts = {}) {
    const m = take('ring')
    const style = opts.style || 'boss'
    const u = m.material.uniforms
    u.uStyle.value = style === 'boss' ? 0 : style === 'siege' ? 1 : style === 'crack' ? 2 : 3
    const c = opts.color || (style === 'crack' ? [1, 0.42, 0.08] : [1, 0.24, 0.08])
    const boost = opts.intensity || (style === 'crack' ? 2.2 : 1.8)
    u.uColor.value.setRGB(c[0] * boost, c[1] * boost, c[2] * boost)
    u.uK.value = 0; u.uAlpha.value = 0
    m.scale.setScalar(Math.max(0.2, radius))
    fitGround(m, pos, radius)
    const h = { mesh: m, type: 'ring', t: 0, dur: Math.max(0.05, seconds), hold: opts.hold ?? 0.25, fadeIn: 0.12, pos: m.position, follow: opts.follow || null, dead: false, k: 0 }
    h.kill = () => { h.dead = true }
    markers.push(h)
    return h
  }

  /** chevron line on the ground from a to b (charge lines), fills over `seconds` */
  function line(a, b, width, seconds, opts = {}) {
    const m = take('line')
    const u = m.material.uniforms
    const c = opts.color || [1, 0.3, 0.1]
    const boost = opts.intensity || 1.6
    u.uColor.value.setRGB(c[0] * boost, c[1] * boost, c[2] * boost)
    u.uK.value = 0; u.uAlpha.value = 0
    _v.subVectors(b, a); _v.y = 0
    const len = Math.max(0.5, _v.length())
    m.position.copy(a); m.position.y = Math.max(a.y, b.y) + 0.08
    m.rotation.set(0, Math.atan2(-_v.x, -_v.z), 0)
    m.scale.set(width * 0.5, 1, len * 0.5)
    const h = { mesh: m, type: 'line', t: 0, dur: Math.max(0.05, seconds), hold: opts.hold ?? 0.15, fadeIn: 0.1, dead: false, k: 0 }
    h.kill = () => { h.dead = true }
    markers.push(h)
    return h
  }

  function update(dt, t) {
    time.value = t
    for (let i = markers.length - 1; i >= 0; i--) {
      const h = markers[i]
      h.t += dt
      const u = h.mesh.material.uniforms
      h.k = Math.min(1, h.t / h.dur)
      u.uK.value = h.k
      const fade = h.t > h.dur ? 1 - (h.t - h.dur) / Math.max(0.01, h.hold) : 1
      u.uAlpha.value = Math.min(1, h.t / h.fadeIn) * Math.max(0, fade)
      if (h.follow) { h.follow(h); }
      if (h.dead || h.t > h.dur + h.hold) {
        h.mesh.visible = false
        root.remove(h.mesh)
        free[h.type].push(h.mesh)
        markers[i] = markers[markers.length - 1]
        markers.pop()
      }
    }
  }

  function clear() { for (const h of markers) h.dead = true; update(0, time.value) }

  // ---------------------------------------------------------------- projectile bodies
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const projMats = {}
  function projMesh(kind, colour, radius) {
    if (!projMats[kind]) {
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour[0] * 2.2, colour[1] * 2.2, colour[2] * 2.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour[0] * 3, colour[1] * 3, colour[2] * 3), toneMapped: false })
      projMats[kind] = { glow, core }
    }
    const g = new THREE.Group()
    const core = new THREE.Mesh(sphere, projMats[kind].core); core.scale.setScalar(radius * 0.8)
    const halo = new THREE.Mesh(sphere, projMats[kind].glow); halo.scale.set(radius * 1.9, radius * 1.9, radius * 3.2)
    g.add(core, halo)
    g.userData.halo = halo
    return g
  }

  return { ring, line, update, clear, projMesh, markers }
}
