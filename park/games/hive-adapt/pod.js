// Hive Adapt (Project 0 port): the supply pod (Scripts/Defence/SupplyPod.cs). One pod object, reused.
// From wave 2, 7 s into each wave (if no pod is up) it falls 70 m over 2.6 s (h = 70(1-k^2) with a slight drift and a smoke
// trail) onto the plain 28-40 m out, outside +-18 deg of the causeways. An amber ring marks the spot from the moment it drops;
// it waits 35 s and is picked up by walking within 2.2 m (|dy| < 2.5). Contents are chosen at drop time among the rewards
// that help right now (run-hive-economy.md §2.9, player-weapons.md §5.2). Everything lives under G.root in game space.
import * as THREE from 'three'
import { POD } from './rundata.js'

const DEG = Math.PI / 180
const SMOKE = 28

/** a soft round puff (DataTexture, no canvas needed) */
function puffTexture() {
  const n = 32, data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r = Math.sqrt(dx * dx + dy * dy)
    const a = Math.max(0, 1 - r) ** 1.6
    const i = (y * n + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255)
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  t.needsUpdate = true
  return t
}
/** vertical fade for the beacon column */
function beamTexture() {
  const n = 64, data = new Uint8Array(4 * n * 4)
  for (let y = 0; y < n; y++) for (let x = 0; x < 4; x++) {
    const a = Math.pow(1 - y / (n - 1), 1.5)
    const i = (y * 4 + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255)
  }
  const t = new THREE.DataTexture(data, 4, n, THREE.RGBAFormat)
  t.needsUpdate = true
  return t
}

export function createPod(G, hooks) {
  const root = new THREE.Group()
  root.name = 'SupplyPod'
  root.visible = false
  const amber = new THREE.Color(1, 0.69, 0)
  // ---------------------------------------------------------------- the drop pod body (origin at its base, +Y up)
  const body = new THREE.Group()
  let metal = null, dark = null
  try { metal = G.assets && G.assets.mat ? G.assets.mat('M_GunMetal') : null } catch (e) { metal = null }
  try { dark = G.assets && G.assets.mat ? G.assets.mat('M_DarkMetal') : null } catch (e) { dark = null }
  metal = metal || new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.8, roughness: 0.45 })
  dark = dark || new THREE.MeshStandardMaterial({ color: 0x1d2024, metalness: 0.7, roughness: 0.55 })
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x221500, emissive: amber, emissiveIntensity: 2.4, roughness: 0.4 })
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; body.add(m); return m }
  add(new THREE.CylinderGeometry(0.62, 0.78, 1.7, 10), metal, 0, 0.95, 0)
  add(new THREE.CylinderGeometry(0.28, 0.62, 0.55, 10), dark, 0, 2.07, 0)
  add(new THREE.CylinderGeometry(0.84, 0.92, 0.22, 10), dark, 0, 0.11, 0)
  add(new THREE.CylinderGeometry(0.645, 0.665, 0.14, 10), glowMat, 0, 1.35, 0)
  add(new THREE.CylinderGeometry(0.73, 0.75, 0.1, 10), glowMat, 0, 0.42, 0)
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4
    add(new THREE.BoxGeometry(0.1, 1.1, 0.55), dark, Math.sin(a) * 0.72, 0.75, Math.cos(a) * 0.72, a)
  }
  add(new THREE.BoxGeometry(0.5, 0.36, 0.06), glowMat, 0, 0.95, 0.72)
  // retro-rocket flame (on while falling)
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.15), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 10, 1, true), flameMat)
  flame.rotation.x = Math.PI
  flame.position.y = -1.1
  body.add(flame)
  root.add(body)
  // ---------------------------------------------------------------- landing ring + beacon column
  const ringMat = new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.25, 48), ringMat)
  ring.rotation.x = -Math.PI / 2
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), ringMat.clone())
  ring2.rotation.x = -Math.PI / 2
  const marks = new THREE.Group()
  marks.add(ring, ring2)
  root.add(marks)
  const beamMat = new THREE.MeshBasicMaterial({ color: amber, map: beamTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 26, 8, 1, true), beamMat)
  beam.position.y = 13
  marks.add(beam)
  // ---------------------------------------------------------------- smoke trail (pooled sprites)
  const puffTex = puffTexture()
  const smoke = []
  const nSmoke = G.lite ? 14 : SMOKE
  for (let i = 0; i < nSmoke; i++) {
    const m = new THREE.SpriteMaterial({ map: puffTex, color: 0x9a948c, transparent: true, opacity: 0, depthWrite: false })
    const s = new THREE.Sprite(m)
    s.visible = false
    root.add(s)
    smoke.push({ s, t: 9, life: 1.8, vel: new THREE.Vector3() })
  }
  let smokeAcc = 0, smokeNext = 0

  const pod = {
    object: root,
    state: 'idle', // 'idle' | 'incoming' | 'landed'
    pos: new THREE.Vector3(),
    contents: null, amount: 0,
    dropAt: -1, fallT: 0, expireAt: 0, clock: 0,
    get timeLeft() { return pod.state === 'landed' ? Math.max(0, pod.expireAt - pod.clock) : 0 },
    get label() { return pod.contents ? pod.contents.label : 'Supply pod' },
  }
  let attached = false
  function attach() { if (!attached && G.root) { G.root.add(root); attached = true } }

  /** a spot on the plain outside the walls (SupplyPod.ChooseSpot) */
  function chooseSpot(out) {
    const rng = G.rng || Math.random
    let found = false
    for (let i = 0; i < 24; i++) {
      const yaw = rng() * 360 - 180
      if (POD.avoidYaws.some(a => Math.abs(((yaw - a) % 360 + 540) % 360 - 180) < POD.avoidDegrees)) continue
      const r = POD.minRadius + (POD.maxRadius - POD.minRadius) * rng()
      const x = Math.sin(yaw * DEG) * r, z = -Math.cos(yaw * DEG) * r
      const y = G.world && G.world.groundY ? G.world.groundY(x, z, 40) : 0
      if (!(y === y) || y > 2.5) continue
      out.set(x, y, z)
      found = true
      break
    }
    if (!found) out.set(0, 0, -34)
    return out
  }

  function useful(r, wave) {
    if (r.weight <= 0 || wave < r.firstWave) return false
    switch (r.kind) {
      case 'armor': { const p = G.player; return !!p && typeof p.armor === 'number' && typeof p.armorMax === 'number' && p.armor < p.armorMax - 10 }
      case 'core': { const c = hooks.core(); return !!c && c.max > 0 && c.hp > 0 && c.hp / c.max < 0.85 }
      case 'barricade': return hooks.barricadesNeedRepair()
      default: return true
    }
  }
  function chooseContents(wave, force) {
    let pick = force ? POD.rewards.find(r => r.kind === force) : null
    if (!pick) {
      const list = POD.rewards.filter(r => useful(r, wave))
      let total = 0
      for (const r of list) total += r.weight
      let roll = (G.rng || Math.random)() * total
      for (const r of list) { roll -= r.weight; if (roll <= 0) { pick = r; break } }
    }
    pod.contents = pick || POD.rewards[0]
    pod.amount = pod.contents.base + pod.contents.perWave * Math.max(1, wave)
  }

  pod.reset = () => {
    pod.state = 'idle'; pod.dropAt = -1; pod.contents = null
    root.visible = false
    for (const p of smoke) { p.t = 9; p.s.visible = false }
  }
  /** WaveStarted: from wave 2, the pod drops 7 s later if none is up */
  pod.onWaveStarted = wave => { if (wave >= POD.firstWave && pod.state === 'idle') pod.dropAt = pod.clock + POD.dropDelay }
  pod.dropNow = (at, force) => {
    attach()
    if (at) pod.pos.copy(at); else chooseSpot(pod.pos)
    chooseContents(hooks.wave(), force)
    pod.state = 'incoming'
    pod.fallT = 0
    pod.dropAt = -1
    root.visible = true
    body.visible = true
    flame.visible = true
    body.rotation.y = (G.rng || Math.random)() * Math.PI * 2
    placeBody(0)
    marks.position.copy(pod.pos).add(new THREE.Vector3(0, 0.06, 0))
    beam.visible = false
    smokeAcc = 0
    G.sfx && G.sfx('sfx_pod_incoming', { pos: new THREE.Vector3(pod.pos.x, pod.pos.y + 20, pod.pos.z), vol: 1 })
    hooks.onIncoming && hooks.onIncoming(pod)
    hooks.onDrop && hooks.onDrop(pod)
  }
  function placeBody(k) {
    const h = POD.fallHeight * (1 - k * k)
    body.position.set(pod.pos.x + h * 0.08, pod.pos.y + h, pod.pos.z + h * 0.08 * 0.6)
  }
  function land() {
    pod.state = 'landed'
    pod.expireAt = pod.clock + POD.lifetime
    placeBody(1)
    flame.visible = false
    beam.visible = true
    G.fx && G.fx.burst && G.fx.burst('podLanding', pod.pos, { scale: 1.2 })
    G.fx && G.fx.light && G.fx.light(new THREE.Vector3(pod.pos.x, pod.pos.y + 1.5, pod.pos.z), [1, 0.6, 0.2], 6, 14, 0.6)
    G.sfx && G.sfx('sfx_pod_impact', { pos: pod.pos, vol: 1 })
    const pp = G.player && G.player.pos
    if (pp && G.shake) G.shake(Math.max(0, Math.min(1, 1 - pp.distanceTo(pod.pos) / 45)) * 0.5)
    hooks.onLanded && hooks.onLanded(pod)
  }
  function hide() { pod.state = 'idle'; root.visible = false }
  function collect() {
    const kind = pod.contents.kind
    let got = pod.amount
    got = hooks.collect(kind, pod.amount)
    G.fx && G.fx.burst && G.fx.burst('podPickup', pod.pos, {})
    G.sfx && G.sfx('sfx_pod_pickup', { pos: pod.pos, vol: 1 })
    const c = pod.contents
    hide()
    hooks.onCollected && hooks.onCollected(c, got)
  }

  function puff(dt) {
    smokeAcc += dt
    while (smokeAcc >= smokeNext) {
      smokeAcc -= smokeNext
      smokeNext = G.lite ? 0.09 : 0.05
      const p = smoke.find(q => q.t >= q.life) || smoke[0]
      p.t = 0
      p.life = 1.6 + Math.random() * 0.6
      p.s.position.copy(body.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 2.2, (Math.random() - 0.5) * 0.4))
      p.vel.set((Math.random() - 0.5) * 0.8, 1.2, (Math.random() - 0.5) * 0.8)
      p.s.visible = true
    }
  }
  function tickSmoke(dt) {
    for (const p of smoke) {
      if (p.t >= p.life) { if (p.s.visible) p.s.visible = false; continue }
      p.t += dt
      const k = Math.min(1, p.t / p.life)
      p.s.position.addScaledVector(p.vel, dt)
      const sc = 1.2 + k * 4.5
      p.s.scale.set(sc, sc, 1)
      p.s.material.opacity = 0.55 * (1 - k) * Math.min(1, p.t / 0.08)
    }
  }

  /** dt: scaled game time (SupplyPod uses Time.time) */
  pod.update = (dt, rdt) => {
    pod.clock += dt
    const t = G.rt || 0
    switch (pod.state) {
      case 'idle':
        if (pod.dropAt > 0 && pod.clock >= pod.dropAt) pod.dropNow()
        break
      case 'incoming': {
        pod.fallT += dt / POD.fallTime
        const k = Math.min(1, pod.fallT)
        placeBody(k)
        puff(dt)
        flame.scale.set(1, 0.8 + Math.random() * 0.5, 1)
        if (pod.fallT >= 1) land()
        break
      }
      case 'landed': {
        const pp = G.player && G.player.pos
        if (pp && G.player.alive !== false) {
          const dx = pp.x - pod.pos.x, dz = pp.z - pod.pos.z
          if (Math.abs(pp.y - pod.pos.y) < 2.5 && dx * dx + dz * dz <= POD.pickupRadius * POD.pickupRadius) { collect(); break }
        }
        if (pod.clock >= pod.expireAt) {
          G.fx && G.fx.burst && G.fx.burst('podPickup', pod.pos, { scale: 0.6 })
          hide()
          hooks.onExpired && hooks.onExpired(pod)
        }
        break
      }
    }
    tickSmoke(dt)
    if (root.visible) {
      const s = 1 + 0.08 * Math.sin(t * 5)
      ring.scale.set(s, s, 1)
      const urgent = pod.state === 'landed' && pod.timeLeft < 8
      ringMat.opacity = pod.state === 'incoming' ? 0.55 + 0.35 * Math.abs(Math.sin(t * 9)) : urgent ? 0.4 + 0.5 * Math.abs(Math.sin(t * 5)) : 0.85
      ring2.material.opacity = ringMat.opacity * 0.8
      const k2 = (t * 0.7) % 1
      ring2.scale.set(1 + k2 * 1.2, 1 + k2 * 1.2, 1)
      beamMat.opacity = 0.35 + 0.2 * Math.sin(t * 3)
    }
  }
  pod.hide = hide
  return pod
}
