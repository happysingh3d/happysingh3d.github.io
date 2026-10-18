// Hive Adapt 3D: the scene. A paper arena under a dusk sky with ink-wash mountains, torii gates that throw a
// light beam while bugs pour through them, a foxfire shrine, paper-lantern turrets, ink bugs that walk on
// shader-driven legs, and the Ink Fox. All geometry is made here; the only files are the fox and the sounds.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as ART from './art.js'
import * as R from './rules.js'

export const INK = 0x17131f
export const CREAM = 0xf3e4c6
export const VERM = 0xd9432b
export const GOLD = 0xffc24a

export function outlineMaterial(width) {
  const m = new THREE.MeshBasicMaterial({ color: 0x120e19, side: THREE.BackSide })
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed += normalize(normal) * ${width.toFixed(4)};`)
  }
  m.customProgramCacheKey = () => 'ink-outline-' + width.toFixed(4)
  return m
}

const toon = (ramp, color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra })

const mat = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz))
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
}

/** Geometry with one flat vertex colour and an optional leg-animation weight (aLeg), ready to merge. */
function colored(geo, rgb, m, anim) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  const n = g.attributes.position.count
  const a = new Float32Array(n * 2)
  if (anim) {
    for (let i = 0; i < n; i++) {
      const [ax, ay] = anim(g.attributes.position.getY(i))
      a[i * 2] = ax; a[i * 2 + 1] = ay
    }
  }
  if (m) g.applyMatrix4(m)
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2] }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  g.setAttribute('aLeg', new THREE.BufferAttribute(a, 2))
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aLeg'].includes(k)) g.deleteAttribute(k)
  return g
}

// ------------------------------------------------------------------ sky, land and the far scenery
export function buildSky(scene) {
  const tex = ART.skyTexture()
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.repeat.set(1, 2)
  tex.offset.set(0, -1)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }))
  sky.renderOrder = -10
  scene.add(sky)
  return sky
}

export function buildGround(world, ramp, glowTex) {
  const r = R.ARENA_R + 0.4
  const gates = []
  for (let i = 0; i < R.GATES; i++) gates.push(R.gatePos(i).a)
  const tex = ART.arenaTexture(r, R.PAD_R, [...Array(R.PADS).keys()].map(i => {
    const a = ((i + 0.5) / R.PADS) * Math.PI * 2
    return { x: Math.cos(a) * R.PAD_R, z: Math.sin(a) * R.PAD_R }
  }), 2.3, gates)
  const top = new THREE.Mesh(new THREE.CircleGeometry(r, 72), new THREE.MeshBasicMaterial({ map: tex }))
  top.rotation.x = -Math.PI / 2
  top.position.y = 0.0
  world.add(top)
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.01, 0.5, 72, 1, true), toon(ramp, 0xb89a6c, { side: THREE.DoubleSide }))
  side.position.y = -0.25
  world.add(side)
  // the land round the paper
  const outer = new THREE.Mesh(new THREE.CircleGeometry(150, 64), new THREE.MeshBasicMaterial({ map: ART.outerGroundTexture() }))
  outer.rotation.x = -Math.PI / 2
  outer.position.y = -0.5
  world.add(outer)
  // the warm pool of light round the shrine, painted additively on the paper
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff9a40, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }))
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.02
  world.add(pool)
  // low mist drifting round the outside
  const clouds = []
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8a5a78, transparent: true, opacity: 0.22, depthWrite: false }))
    const a = (i / 9) * Math.PI * 2
    s.position.set(Math.cos(a) * 17, 1.2, Math.sin(a) * 17)
    s.scale.set(16, 4.5, 1)
    world.add(s)
    clouds.push({ s, a, rad: 17 + (i % 3) * 3, sp: 0.02 + (i % 4) * 0.006 })
  }
  return { top, clouds, pool }
}

/** Mountains, the moon, ink pines and rocks outside the arena, stone kerbs round the rim, paper grass on it. */
export function buildScenery(world, ramp, glowTex, lite = false) {
  const out = { tufts: null, lanterns: { update() {} } }
  // ink-wash ridges on two open cylinders
  const ridge = (radius, height, seed, ink, mist, rep, y0) => {
    const t = ART.ridgeTexture(seed, ink, mist)
    t.wrapS = THREE.RepeatWrapping
    t.repeat.set(rep, 1)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.BackSide, depthWrite: false }))
    m.position.y = y0 + height / 2
    m.renderOrder = -5
    world.add(m)
    return m
  }
  ridge(92, 30, 11, 'rgba(70,46,84,0.95)', 'rgba(150,84,80,0.25)', 3, -3)
  ridge(64, 20, 23, 'rgba(30,22,44,0.97)', 'rgba(96,58,74,0.55)', 4, -2)
  if (lite) return out
  // the moon
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: ART.moonTexture(), transparent: true, depthWrite: false, fog: false }))
  moon.position.set(-60, 44, -78)
  moon.scale.set(30, 30, 1)
  moon.renderOrder = -6
  world.add(moon)
  // ink pines and rocks, beyond where the camera can go
  const pineParts = []
  pineParts.push(colored(new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6), [0.2, 0.14, 0.16], mat(0, 0.6, 0)))
  const tiers = [[1.5, 1.8, 1.4], [1.15, 1.5, 2.4], [0.78, 1.3, 3.3]]
  tiers.forEach(([rad, h, y], k) => pineParts.push(colored(new THREE.ConeGeometry(rad, h, 7), k === 1 ? [0.16, 0.17, 0.25] : [0.13, 0.13, 0.21], mat(0, y, 0))))
  const pineGeo = mergeGeometries(pineParts)
  const rockGeo = colored(new THREE.DodecahedronGeometry(0.8, 0), [0.32, 0.28, 0.36])
  const sceneryMat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: ramp })
  const pines = new THREE.InstancedMesh(pineGeo, sceneryMat, 34)
  const rocks = new THREE.InstancedMesh(rockGeo, sceneryMat, 22)
  const rnd = (() => { let s = 77; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) })()
  const gateA = [...Array(R.GATES).keys()].map(i => R.gatePos(i).a)
  const nearGate = (a, w) => gateA.some(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < w)
  const dummy = new THREE.Object3D()
  let np = 0, nr = 0
  for (let tries = 0; tries < 400 && (np < 34 || nr < 22); tries++) {
    const a = rnd() * Math.PI * 2
    if (nearGate(a, 0.2)) continue
    const d = 16 + rnd() * 9
    if (np < 34) {
      const s = 0.8 + rnd() * 0.9
      dummy.position.set(Math.cos(a) * d, -0.5, Math.sin(a) * d)
      dummy.rotation.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.1)
      dummy.scale.set(s, s * (0.9 + rnd() * 0.5), s)
      dummy.updateMatrix(); pines.setMatrixAt(np++, dummy.matrix)
    }
    if (nr < 22 && rnd() < 0.7) {
      const d2 = 12.5 + rnd() * 5, a2 = a + 0.12
      if (nearGate(a2, 0.25)) continue
      const s = 0.5 + rnd() * 1.1
      dummy.position.set(Math.cos(a2) * d2, -0.5 + s * 0.2, Math.sin(a2) * d2)
      dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      dummy.scale.set(s * 1.3, s * 0.7, s)
      dummy.updateMatrix(); rocks.setMatrixAt(nr++, dummy.matrix)
    }
  }
  pines.count = np; rocks.count = nr
  world.add(pines, rocks)
  // stone kerb round the rim, open at the gates
  const kerbGeo = new THREE.BoxGeometry(0.95, 0.32, 0.5)
  const kerb = new THREE.InstancedMesh(kerbGeo, toon(ramp, 0x5d5466), 80)
  let nk = 0
  for (let k = 0; k < 80; k++) {
    const a = (k / 80) * Math.PI * 2
    if (nearGate(a, 0.17)) continue
    dummy.position.set(Math.cos(a) * 9.62, 0.1, Math.sin(a) * 9.62)
    dummy.rotation.set(0, Math.PI / 2 - a, 0)
    dummy.scale.set(0.82, 1 + ((k * 7) % 3) * 0.12, 1)
    dummy.updateMatrix(); kerb.setMatrixAt(nk++, dummy.matrix)
  }
  kerb.count = nk
  world.add(kerb)
  // paper grass on the arena, kept off the shrine circle, the pads and the gate paths
  const blade = new THREE.ConeGeometry(0.05, 0.34, 3)
  const tuftParts = []
  for (let k = 0; k < 3; k++) tuftParts.push(colored(blade, k === 1 ? [0.62, 0.5, 0.28] : [0.48, 0.47, 0.3], mat((k - 1) * 0.06, 0.15, (k % 2) * 0.04, 0, 0, (k - 1) * 0.35)))
  const tufts = new THREE.InstancedMesh(mergeGeometries(tuftParts), sceneryMat, 200)
  let nt = 0
  for (let tries = 0; tries < 1200 && nt < 200; tries++) {
    const a = rnd() * Math.PI * 2, d = 2.8 + rnd() * 6.1
    if (nearGate(a, 0.12)) continue
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    let bad = false
    for (let i = 0; i < R.PADS; i++) {
      const pa = ((i + 0.5) / R.PADS) * Math.PI * 2
      if ((x - Math.cos(pa) * R.PAD_R) ** 2 + (z - Math.sin(pa) * R.PAD_R) ** 2 < 1.4 * 1.4) bad = true
    }
    if (bad) continue
    const s = 0.7 + rnd() * 0.8
    dummy.position.set(x, 0, z)
    dummy.rotation.set(0, rnd() * 6.28, 0)
    dummy.scale.setScalar(s)
    dummy.updateMatrix(); tufts.setMatrixAt(nt++, dummy.matrix)
  }
  tufts.count = nt
  world.add(tufts)
  out.tufts = tufts
  // sky lanterns: little paper bodies rising slowly, each with a glow drawn by the caller's dots
  const lanGeo = new THREE.CylinderGeometry(0.22, 0.17, 0.42, 8)
  const skyLan = new THREE.InstancedMesh(lanGeo, new THREE.MeshBasicMaterial({ color: 0xffc070 }), 26)
  const items = []
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, d = 18 + rnd() * 30
    items.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 2 + rnd() * 26, sp: 0.25 + rnd() * 0.35, ph: rnd() * 6.28 })
  }
  skyLan.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  skyLan.frustumCulled = false
  world.add(skyLan)
  out.lanterns = {
    mesh: skyLan, items,
    update(dt, t, dots, S) {
      for (let k = 0; k < items.length; k++) {
        const it = items[k]
        it.y += it.sp * dt
        if (it.y > 30) it.y = 1
        const x = it.x + Math.sin(t * 0.3 + it.ph) * 0.6
        dummy.position.set(x, it.y, it.z)
        dummy.rotation.set(0, 0, Math.sin(t + it.ph) * 0.08)
        dummy.scale.setScalar(1)
        dummy.updateMatrix(); skyLan.setMatrixAt(k, dummy.matrix)
        if (dots) dots.add(x, it.y, it.z, 2.4 * S, 0.9, 0.5, 0.22)
      }
      skyLan.instanceMatrix.needsUpdate = true
    },
  }
  return out
}

// ------------------------------------------------------------------ gates: one merged mesh per material, a portal, a glow and a beam each
export function buildGates(world, ramp, glowTex, beamTex) {
  const items = []
  const vParts = [], iParts = []
  const post = new THREE.CylinderGeometry(0.13, 0.15, 2.4, 8)
  const beam1 = new THREE.BoxGeometry(2.5, 0.2, 0.26)
  const beam2 = new THREE.BoxGeometry(1.9, 0.12, 0.2)
  const cap = new THREE.BoxGeometry(2.8, 0.1, 0.34)
  const foot = new THREE.CylinderGeometry(0.2, 0.22, 0.22, 8)
  const strip = g => { const c = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k); return c }
  for (let i = 0; i < R.GATES; i++) {
    const gp = R.gatePos(i)
    const gm = mat(gp.x, 0, gp.z, 0, Math.PI / 2 - gp.a, 0)
    const add = (list, geo, local) => list.push(strip(geo).applyMatrix4(new THREE.Matrix4().multiplyMatrices(gm, local)))
    for (const sx of [-0.9, 0.9]) { add(vParts, post, mat(sx, 1.2, 0)); add(iParts, foot, mat(sx, 0.11, 0)) }
    add(vParts, beam1, mat(0, 2.3, 0))
    add(vParts, beam2, mat(0, 1.85, 0))
    add(iParts, cap, mat(0, 2.46, 0))
    const gr = new THREE.Group()
    gr.position.set(gp.x, 0, gp.z)
    gr.rotation.y = Math.PI / 2 - gp.a
    const portal = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshBasicMaterial({ color: 0x24103e, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }))
    portal.position.y = 1.0
    portal.scale.y = 1.25
    gr.add(portal)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xd9432b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.position.y = 1.2
    glow.scale.set(4.2, 4.2, 1)
    gr.add(glow)
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 16), new THREE.MeshBasicMaterial({ map: beamTex, color: 0xff5a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }))
    beam.position.set(gp.x * 1.02, 8, gp.z * 1.02)
    beam.visible = false
    world.add(beam)
    world.add(gr)
    items.push({ group: gr, portal, glow, beam })
  }
  world.add(new THREE.Mesh(mergeGeometries(vParts), toon(ramp, VERM)))
  world.add(new THREE.Mesh(mergeGeometries(iParts), toon(ramp, INK)))
  return items
}

// ------------------------------------------------------------------ the shrine (the Core)
export function buildCore(world, ramp, glowTex, lanternTex, lite = false) {
  const group = new THREE.Group()
  const stone = toon(ramp, 0x4d4658)
  const stone2 = toon(ramp, 0x6e6678)
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.28, 24), stone); s1.position.y = 0.14; group.add(s1)
  const s2 = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.34, 24), stone2); s2.position.y = 0.45; group.add(s2)
  const lanternMat = new THREE.MeshToonMaterial({ color: 0xffffff, map: lanternTex, gradientMap: ramp, emissive: GOLD, emissiveIntensity: 0.9 })
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.78, 24, 16), lanternMat)
  lantern.scale.y = 1.22
  lantern.position.y = 1.62
  group.add(lantern)
  const vm = toon(ramp, VERM)
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.72, 0.2, 20), vm); capTop.position.y = 2.56; group.add(capTop)
  const capBot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 0.18, 20), vm); capBot.position.y = 0.72; group.add(capBot)
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.75, 4), vm)
    ear.position.set(sx * 0.3, 2.98, 0)
    ear.rotation.z = -sx * 0.22
    group.add(ear)
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 4), toon(ramp, CREAM))
    inner.position.set(sx * 0.3, 2.96, 0.07)
    inner.rotation.z = -sx * 0.22
    group.add(inner)
  }
  // four little stone lanterns on the lower step
  const toro = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.12, 0.4, 6).translate(0, 0.2, 0),
    new THREE.BoxGeometry(0.26, 0.2, 0.26).translate(0, 0.5, 0),
    new THREE.ConeGeometry(0.24, 0.18, 4).rotateY(Math.PI / 4).translate(0, 0.69, 0),
  ])
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    const t = new THREE.Mesh(toro, stone2)
    t.position.set(Math.cos(a) * 1.38, 0.28, Math.sin(a) * 1.38)
    group.add(t)
  }
  if (!lite) {
    const outline = new THREE.Mesh(lantern.geometry, outlineMaterial(0.035))
    outline.scale.copy(lantern.scale); outline.position.copy(lantern.position)
    group.add(outline)
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb454, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
  glow.position.y = 1.7
  glow.scale.set(6, 6, 1)
  group.add(glow)
  const light = new THREE.PointLight(0xffb060, 1.4, 20, 1.2)
  light.position.y = 2.4
  group.add(light)
  world.add(group)
  const fadeMats = []
  group.traverse(o => {
    if (!o.isMesh || fadeMats.includes(o.material)) return
    o.material.transparent = true
    fadeMats.push(o.material)
  })
  let fade = 1
  const warm = new THREE.Color(GOLD), hot = new THREE.Color(VERM), tmp = new THREE.Color()
  return {
    group, lantern, glow, light, lanternMat,
    /** 1 = solid, lower = see-through, for when the shrine hides the fox. */
    setFade(a) {
      if (Math.abs(a - fade) < 0.004) return
      fade = a
      for (const m of fadeMats) { m.opacity = a; m.depthWrite = a > 0.95 }
    },
    update(g, t, pool) {
      const frac = Math.max(0, g.core.hp / g.core.max)
      tmp.copy(hot).lerp(warm, Math.min(1, frac * 1.5))
      lanternMat.emissive.copy(tmp)
      const flick = 0.85 + 0.15 * Math.sin(t * 7.3 + Math.sin(t * 3.1) * 2)
      const hit = Math.max(0, g.core.hit) * 4
      lanternMat.emissiveIntensity = (0.55 + 0.6 * frac) * flick + hit
      glow.material.opacity = (0.35 + 0.5 * frac) * flick * (0.4 + 0.6 * fade)
      glow.material.color.copy(tmp)
      light.intensity = (0.6 + 1.2 * frac) * flick
      if (pool) { pool.material.opacity = (0.12 + 0.24 * frac) * flick; pool.material.color.copy(tmp) }
      group.position.x = hit > 0.05 ? (Math.random() - 0.5) * 0.12 : 0
      group.position.z = hit > 0.05 ? (Math.random() - 0.5) * 0.12 : 0
      lantern.rotation.y = Math.sin(t * 0.5) * 0.08
    },
  }
}

// ------------------------------------------------------------------ lantern pads (the turrets): they grow taller with every level
export function buildPads(world, ramp, glowTex, lite = false) {
  const pads = []
  const padStone = toon(ramp, 0x9a8f9e)
  const gmBase = toon(ramp, 0xf2b33d, { emissive: 0x7a4a00, emissiveIntensity: 0.6 })
  const lanternGeo = new THREE.SphereGeometry(0.44, 18, 12)
  const tailGeo = new THREE.ConeGeometry(0.15, 0.85, 5)
  tailGeo.translate(0, 0.42, 0)
  for (let i = 0; i < R.PADS; i++) {
    // each lantern has its own materials so it can fade alone when the camera comes close
    const pole = toon(ramp, 0x4a3426, { transparent: true })
    const cream = toon(ramp, CREAM, { transparent: true })
    const vm = toon(ramp, VERM, { transparent: true })
    const gm = toon(ramp, 0xf2b33d, { emissive: 0x7a4a00, emissiveIntensity: 0.6, transparent: true })
    const outMat = outlineMaterial(0.03)
    outMat.transparent = true
    const a = ((i + 0.5) / R.PADS) * Math.PI * 2
    const group = new THREE.Group()
    group.position.set(Math.cos(a) * R.PAD_R, 0, Math.sin(a) * R.PAD_R)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.14, 20), padStone); base.position.y = 0.07
    group.add(base)
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 4, 28), gmBase)
    inlay.rotation.x = Math.PI / 2; inlay.position.y = 0.145
    group.add(inlay)
    const up = new THREE.Group()
    group.add(up)
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.25, 6), pole); p.position.y = 0.75; up.add(p)
    const lm = new THREE.MeshToonMaterial({ color: 0xffffff, map: ART.lanternTexture(i), gradientMap: ramp, emissive: GOLD, emissiveIntensity: 0.9, transparent: true })
    const mats = lite ? [pole, cream, vm, gm, lm] : [pole, cream, vm, gm, outMat, lm]
    const lan = new THREE.Mesh(lanternGeo, lm)
    lan.scale.y = 1.18
    lan.position.y = 1.6
    up.add(lan)
    if (!lite) {
      const ol = new THREE.Mesh(lanternGeo, outMat)
      ol.scale.copy(lan.scale); ol.position.copy(lan.position)
      up.add(ol)
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.12, 12), vm); cap.position.y = 2.15; up.add(cap)
    const ears = new THREE.Group()
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 4), vm)
      ear.position.set(sx * 0.15, 2.4, 0); ear.rotation.z = -sx * 0.2
      ears.add(ear)
    }
    up.add(ears)
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 6, 24), gm)
    band.rotation.x = Math.PI / 2; band.position.y = 1.6
    up.add(band)
    const tails = new THREE.Group()
    for (let k = 0; k < 3; k++) {
      const t = new THREE.Mesh(tailGeo, k === 1 ? gm : cream)
      t.position.set(0, 1.55, -0.2)
      t.rotation.set(-0.75, 0, (k - 1) * 0.55)
      tails.add(t)
    }
    up.add(tails)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb454, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.position.y = 1.62
    glow.scale.set(2.6, 2.6, 1)
    up.add(glow)
    const jam = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0x120e19, transparent: true, opacity: 0.72 }))
    jam.scale.y = 1.2; jam.position.y = 1.6; jam.visible = false
    up.add(jam)
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }))
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.05; fill.visible = false
    group.add(fill)
    const [tc, tg] = ART.canvas(256, 96)
    const tt = ART.texture(tc)
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tt, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }))
    tag.renderOrder = 12; tag.position.y = 2.7; tag.scale.set(0.29, 0.11, 1)
    group.add(tag)
    const hbBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x120e19, depthTest: false, transparent: true, opacity: 0.8 }))
    const hbFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x7fd36b, depthTest: false }))
    for (const s of [hbBg, hbFg]) { s.renderOrder = 13; s.visible = false; group.add(s) }
    hbBg.scale.set(1.1, 0.14, 1)
    world.add(group)
    pads.push({ group, up, lan, lm, ears, band, tails, glow, jam, fill, tag, tg, tt, hbBg, hbFg, mats, fade: 1, key: '', level: -1, x: group.position.x, z: group.position.z })
  }
  let tagH = 0.11
  return {
    pads,
    /** The tags keep one size on screen: h is their height as the sprite scale that gives it. */
    setTagSize(h) { tagH = h },
    setFade(i, a) {
      const v = pads[i]
      if (Math.abs(v.fade - a) < 0.004) return
      v.fade = a
      for (const m of v.mats) { m.opacity = a; m.depthWrite = a > 0.95 }
    },
    update(g, t, opt = {}) {
      const showTags = opt.tags !== false
      for (let i = 0; i < pads.length; i++) {
        const v = pads[i], p = g.pads[i]
        if (v.level !== p.level) {
          v.level = p.level
          v.up.visible = p.level > 0
          v.ears.visible = p.level >= 2
          v.band.visible = p.level >= 2
          v.tails.visible = p.level >= 3
          v.up.scale.setScalar(0.01)
          if (p.level === 0) v.hbBg.visible = v.hbFg.visible = false
        }
        const full = p.level > 0 ? 1 + 0.08 * (p.level - 1) : 1
        if (v.up.visible) {
          const k = Math.min(full, v.up.scale.x + 0.12 + (full - v.up.scale.x) * 0.2)
          v.up.scale.setScalar(k)
          const jam = p.jam > 0
          v.jam.visible = jam
          const fl = 0.8 + 0.2 * Math.sin(t * 6 + i)
          v.lm.emissiveIntensity = jam ? 0.05 : (0.7 + 0.15 * p.level) * fl + (p.fire > 0.55 ? 0.7 : 0)
          v.glow.material.opacity = (jam ? 0.05 : 0.35 + 0.1 * p.level) * (0.3 + 0.7 * v.fade)
          v.lan.rotation.y = Math.sin(t * 0.8 + i) * 0.15
          v.up.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.03
          const frac = p.hp / [0, 60, 90, 130][p.level]
          const dmg = frac < 0.999
          v.hbBg.visible = v.hbFg.visible = dmg
          const hy = 2.55 * full + 0.1
          v.hbBg.position.y = v.hbFg.position.y = hy
          if (dmg) {
            v.hbFg.scale.set(Math.max(0.001, 1.06 * frac), 0.1, 1)
            v.hbFg.position.x = -0.53 * (1 - frac)
            v.hbFg.material.color.setHex(frac < 0.35 ? 0xd9432b : 0x7fd36b)
          }
        }
        const need = p.level < 3 ? R.LANTERN_COST[p.level] : 0
        const afford = g.bio >= need
        const key = `${p.level}|${afford ? 1 : 0}`
        if (key !== v.key) {
          v.key = key
          v.tag.visible = p.level < 3
          if (p.level < 3) ART.drawTag(v.tg, (p.level === 0 ? 'BUILD ' : 'UPGRADE ') + need, afford)
          v.tt.needsUpdate = true
        }
        v.tag.visible = showTags && p.level < 3
        const near = opt.fox ? Math.hypot(opt.fox.x - v.x, opt.fox.z - v.z) : 0
        v.tag.material.opacity = near < 3.5 ? 1 : afford ? 0.75 : 0.45
        const k = near < 3.5 ? 1.15 : 0.9
        v.tag.scale.set(tagH * 2.67 * k, tagH * k, 1)
        v.tag.position.y = p.level === 0 ? 1.2 : 2.85 * full + 0.25
        v.fill.visible = p.hold > 0.01
        if (v.fill.visible) v.fill.scale.setScalar(Math.max(0.05, p.hold / 0.7))
      }
    },
  }
}

// ------------------------------------------------------------------ ink bugs: instanced, with legs and wings moved in the vertex shader
const INKC = [0.16, 0.13, 0.22], CREAMC = [0.9, 0.82, 0.68], VERMC = [0.85, 0.26, 0.17], EYE = [3.2, 1.0, 0.45]
const GAIT = `
  transformed.z += aLeg.x * sin(iPhase);
  transformed.y += abs(aLeg.x) * 0.6 * max(0.0, sign(aLeg.x) * cos(iPhase)) + aLeg.y * sin(iPhase * 2.6);
`
function gaitMaterial(base, key, extra = '') {
  base.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec2 aLeg;\nattribute float iPhase;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GAIT + extra)
  }
  base.customProgramCacheKey = () => key
  return base
}

function eyes(parts, x, y, z, r = 0.07) {
  const e = new THREE.SphereGeometry(r, 8, 6)
  for (const sx of [-1, 1]) parts.push(colored(e, EYE, mat(sx * x, y, z)))
}

/** n legs in rows, each a cone whose foot swings; the two tripods move in turn. */
function legs(parts, n, spread, len, y, rgb = CREAMC) {
  const l = new THREE.ConeGeometry(0.045 * Math.max(1, len / 0.4), len, 4)
  const amp = 0.5 * len
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1
    const row = Math.floor(i / 2)
    const sgn = (row + (side > 0 ? 1 : 0)) % 2 ? 1 : -1
    const anim = yy => [Math.max(0, Math.min(1, 0.5 - yy / len)) * amp * sgn, 0]
    parts.push(colored(l, rgb, mat(side * spread, y, (row - (n / 4 - 0.5)) * 0.3 * Math.max(1, len / 0.5), 0, 0, side * 1.0), anim))
  }
}

function bugGeometry(kind) {
  const parts = []
  if (kind === 'crawler') {
    parts.push(colored(new THREE.IcosahedronGeometry(0.38, 1), INKC, mat(0, 0.36, 0, 0, 0, 0, 1.0, 0.72, 1.25)))
    parts.push(colored(new THREE.SphereGeometry(0.2, 10, 8), INKC, mat(0, 0.4, 0.45, 0, 0, 0, 1, 0.85, 0.9)))
    for (const sx of [-1, 1]) parts.push(colored(new THREE.ConeGeometry(0.025, 0.36, 4), CREAMC, mat(sx * 0.08, 0.6, 0.62, 0.9, 0, -sx * 0.4)))
    legs(parts, 6, 0.36, 0.38, 0.19)
    eyes(parts, 0.1, 0.46, 0.6)
  } else if (kind === 'rammer') {
    parts.push(colored(new THREE.BoxGeometry(0.95, 0.6, 1.3), INKC, mat(0, 0.55, 0)))
    parts.push(colored(new THREE.OctahedronGeometry(0.55), CREAMC, mat(0, 0.92, -0.05, 0, 0.78, 0, 1, 0.45, 1.25)))
    parts.push(colored(new THREE.ConeGeometry(0.2, 0.8, 5), VERMC, mat(0, 0.62, 0.95, Math.PI / 2, 0, 0)))
    legs(parts, 6, 0.56, 0.5, 0.28)
    eyes(parts, 0.22, 0.7, 0.62, 0.09)
  } else if (kind === 'spitter') {
    parts.push(colored(new THREE.OctahedronGeometry(0.48), INKC, mat(0, 0.85, 0, 0, 0.4, 0, 1, 0.95, 1.2)))
    parts.push(colored(new THREE.ConeGeometry(0.17, 0.9, 5), INKC, mat(0, 0.8, -0.8, -Math.PI / 2, 0, 0)))
    parts.push(colored(new THREE.SphereGeometry(0.14, 8, 6), VERMC, mat(0, 0.76, 0.55)))
    for (const sx of [-1, 1]) {
      const anim = yy => [0, Math.max(0, Math.min(1, 0.5 + yy / 0.7)) * 0.3 * sx]
      parts.push(colored(new THREE.ConeGeometry(0.2, 0.7, 3), CREAMC, mat(sx * 0.6, 0.95, 0, 0, 0, -sx * 1.15), anim))
    }
    eyes(parts, 0.17, 0.98, 0.4, 0.07)
  } else if (kind === 'leech') {
    const radii = [0.22, 0.2, 0.17, 0.13]
    radii.forEach((r, i) => parts.push(colored(new THREE.SphereGeometry(r, 10, 8), INKC, mat(0, 0.24 - i * 0.015, 0.28 - i * 0.27, 0, 0, 0, 1, 0.85, 1.1))))
    parts.push(colored(new THREE.TorusGeometry(0.13, 0.04, 6, 10), VERMC, mat(0, 0.26, 0.5, Math.PI / 2, 0, 0)))
    eyes(parts, 0.1, 0.34, 0.4, 0.05)
  } else {
    parts.push(colored(new THREE.IcosahedronGeometry(1.0, 1), INKC, mat(0, 1.1, 0, 0, 0, 0, 1.1, 0.85, 1.4)))
    parts.push(colored(new THREE.IcosahedronGeometry(0.55, 1), INKC, mat(0, 1.15, 1.35, 0, 0, 0, 1, 0.85, 0.9)))
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 1.4
      parts.push(colored(new THREE.ConeGeometry(0.17, 0.8, 4), VERMC, mat(Math.sin(a) * 0.7, 1.8 - Math.abs(a) * 0.3, -0.1, 0, 0, -a * 0.7)))
    }
    for (const sx of [-1, 1]) parts.push(colored(new THREE.ConeGeometry(0.17, 0.95, 5), CREAMC, mat(sx * 0.45, 0.85, 1.9, Math.PI / 2, 0, 0)))
    legs(parts, 8, 1.1, 1.1, 0.55)
    eyes(parts, 0.3, 1.3, 1.75, 0.12)
    eyes(parts, 0.5, 1.15, 1.6, 0.08)
  }
  return mergeGeometries(parts)
}

const CAP = { crawler: 150, rammer: 70, spitter: 70, leech: 50, queen: 3 }

export function buildBugs(world, ramp, withOutline) {
  const kit = {}
  const dummy = new THREE.Object3D()
  const bodyMat = gaitMaterial(new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: ramp }), 'ink-bug')
  const outMat = gaitMaterial(new THREE.MeshBasicMaterial({ color: 0x120e19, side: THREE.BackSide }), 'ink-bug-outline', '  transformed += normalize(normal) * 0.03;\n')
  for (const kind of Object.keys(CAP)) {
    const geo = bugGeometry(kind)
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(CAP[kind]), 1)
    phase.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iPhase', phase)
    const body = new THREE.InstancedMesh(geo, bodyMat, CAP[kind])
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    body.frustumCulled = false
    body.count = 0
    world.add(body)
    let out = null
    if (withOutline) {
      out = new THREE.InstancedMesh(geo, outMat, CAP[kind])
      out.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      out.frustumCulled = false
      out.count = 0
      world.add(out)
    }
    body.setColorAt(0, new THREE.Color(1, 1, 1))
    kit[kind] = { body, out, phase, n: 0 }
  }
  // folded-paper plates the Hive grows as it adapts, one more shard per generation
  const shard = new THREE.TetrahedronGeometry(0.2)
  shard.scale(1, 0.55, 1.9)
  const plates = new THREE.InstancedMesh(shard, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp }), 420)
  plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  plates.frustumCulled = false
  plates.count = 0
  plates.setColorAt(0, new THREE.Color(1, 1, 1))
  world.add(plates)
  const shGeo = new THREE.CircleGeometry(1, 14)
  shGeo.rotateX(-Math.PI / 2)
  const shadows = new THREE.InstancedMesh(shGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }), 220)
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  shadows.frustumCulled = false
  shadows.count = 0
  shadows.position.y = 0.03
  world.add(shadows)
  const spit = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3a1a6a }), 40)
  spit.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spit.frustumCulled = false
  spit.count = 0
  world.add(spit)

  const seen = new Map()
  const col = new THREE.Color()
  const gens = [new THREE.Color(0xf3e4c6), new THREE.Color(0xffe39a), new THREE.Color(0xff9a6a), new THREE.Color(0xff6a8a)]
  const outlineOn = { v: withOutline }
  const GAIT_SPEED = { crawler: 2.6, rammer: 1.5, spitter: 1.6, leech: 2.2, queen: 1.1 }

  return {
    kit, plates, shadows, spit, outlineOn,
    setOutline(on) { outlineOn.v = on && withOutline },
    update(g, t, dt) {
      for (const k of Object.keys(kit)) kit[k].n = 0
      let np = 0, ns = 0
      const alive = new Set()
      for (const e of g.enemies) {
        const kc = kit[e.kind]
        if (kc.n >= CAP[e.kind]) continue
        alive.add(e.id)
        let s = seen.get(e.id)
        if (!s) { s = { x: e.x, z: e.z, heading: Math.atan2(-e.x, -e.z), born: 0 }; seen.set(e.id, s) }
        const mx = e.x - s.x, mz = e.z - s.z
        if (mx * mx + mz * mz > 1e-6) {
          const want = Math.atan2(mx, mz)
          let d = want - s.heading
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          s.heading += d * Math.min(1, dt * 10)
        }
        s.x = e.x; s.z = e.z
        s.born = Math.min(1, s.born + dt * 3)
        const sc = (e.r / R.ENEMY[e.kind].r) * (0.3 + 0.7 * s.born)
        const bob = e.kind === 'spitter' ? 0.25 + Math.sin(e.phase * 0.7) * 0.12 : Math.abs(Math.sin(e.phase * 1.3)) * 0.04
        const wob = e.kind === 'leech' ? Math.sin(e.phase * 1.4) * 0.25 : Math.sin(e.phase * 0.5) * 0.05
        dummy.position.set(e.x, bob, e.z)
        dummy.rotation.set(e.hurt > 0 ? -0.15 : 0, s.heading + wob, 0)
        dummy.scale.set(sc, sc * (1 - Math.abs(Math.sin(e.phase)) * 0.05), sc)
        dummy.updateMatrix()
        kc.body.setMatrixAt(kc.n, dummy.matrix)
        kc.phase.array[kc.n] = e.phase * GAIT_SPEED[e.kind]
        const f = e.hurt > 0 ? 1 + e.hurt * 18 : 1
        col.setRGB(f, f * (e.hurt > 0 ? 0.9 : 1), f * (e.hurt > 0 ? 0.8 : 1))
        kc.body.setColorAt(kc.n, col)
        if (kc.out) kc.out.setMatrixAt(kc.n, dummy.matrix)
        kc.n++
        if (ns < 220) {
          dummy.position.set(e.x, 0, e.z)
          dummy.rotation.set(0, 0, 0)
          const r = e.r * 1.35 * (e.kind === 'spitter' ? 0.8 : 1)
          dummy.scale.set(r, 1, r)
          dummy.updateMatrix()
          shadows.setMatrixAt(ns++, dummy.matrix)
        }
        const shards = e.kind === 'queen' ? 3 : Math.min(3, e.gen) + (e.elite ? 1 : 0)
        for (let q = 0; q < shards && np < 420; q++) {
          const a = s.heading + (q - (shards - 1) / 2) * 0.7 + Math.PI
          const top = (e.kind === 'queen' ? 2.1 : e.kind === 'rammer' ? 1.05 : e.kind === 'spitter' ? 1.15 : 0.6) * sc
          dummy.position.set(e.x + Math.sin(a) * 0.12 * sc, top + bob, e.z + Math.cos(a) * 0.12 * sc)
          dummy.rotation.set(0.25, s.heading + (q - 1) * 0.5, 0)
          dummy.scale.setScalar(sc * (e.kind === 'queen' ? 1.8 : 1))
          dummy.updateMatrix()
          plates.setMatrixAt(np, dummy.matrix)
          if (e.elite && q === shards - 1) col.setHex(0xffc24a)
          else col.copy(gens[Math.min(3, e.gen)])
          plates.setColorAt(np, col)
          np++
        }
      }
      for (const k of Object.keys(kit)) {
        const kc = kit[k]
        kc.body.count = kc.n
        kc.body.instanceMatrix.needsUpdate = true
        if (kc.body.instanceColor) kc.body.instanceColor.needsUpdate = true
        kc.phase.needsUpdate = true
        if (kc.out) { kc.out.count = outlineOn.v ? kc.n : 0; kc.out.instanceMatrix.needsUpdate = true }
      }
      plates.count = np
      plates.instanceMatrix.needsUpdate = true
      if (plates.instanceColor) plates.instanceColor.needsUpdate = true
      for (const id of seen.keys()) if (!alive.has(id)) seen.delete(id)
      let nsp = 0
      for (const s of g.spits) {
        if (nsp >= 40) break
        const arc = Math.sin(Math.min(1, (2.2 - s.life) / 0.7) * Math.PI) * 0.6
        dummy.position.set(s.x, 0.6 + arc, s.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        spit.setMatrixAt(nsp++, dummy.matrix)
      }
      spit.count = nsp
      spit.instanceMatrix.needsUpdate = true
      shadows.count = ns
      shadows.instanceMatrix.needsUpdate = true
    },
  }
}

// ------------------------------------------------------------------ the Ink Fox
export async function loadFox(world, url, ramp, onProgress, lite = false) {
  const gltf = await new GLTFLoader().loadAsync(url, e => onProgress && e.total && onProgress(e.loaded / e.total))
  const root = gltf.scene
  const box = new THREE.Box3().setFromObject(root)
  const h = box.max.y - box.min.y
  const scale = 1.7 / h
  root.scale.setScalar(scale)
  root.position.y = -box.min.y * scale
  const outlines = []
  root.traverse(o => {
    if (!o.isMesh) return
    const src = o.material
    const name = src.name || ''
    const color = src.color ? src.color.clone() : new THREE.Color(0xffffff)
    const spirit = name.includes('Spirit')
    o.material = spirit ? new THREE.MeshBasicMaterial({ color: GOLD }) : new THREE.MeshToonMaterial({ color, gradientMap: ramp })
    o.frustumCulled = false
    if (!spirit && o.isSkinnedMesh && !lite) outlines.push(o)
  })
  const outlineMeshes = []
  for (const o of outlines) {
    const ol = new THREE.SkinnedMesh(o.geometry, outlineMaterial(0.02))
    ol.bind(o.skeleton, o.bindMatrix)
    ol.frustumCulled = false
    ol.name = 'fox-outline'
    o.parent.add(ol)
    ol.position.copy(o.position); ol.quaternion.copy(o.quaternion); ol.scale.copy(o.scale)
    outlineMeshes.push(ol)
  }
  const holder = new THREE.Group()
  holder.add(root)
  world.add(holder)
  const mixer = new THREE.AnimationMixer(root)
  const clips = {}
  for (const c of gltf.animations) clips[c.name] = c
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.035
  world.add(shadow)
  return { holder, root, mixer, clips, shadow, outlines: outlineMeshes }
}
