// Hive Adapt 3D: Foxfire Watch, an endless-wave defence for a Project 0 lot, played in third person.
// You run the Ink Fox round a foxfire shrine while ink bugs pour through six torii gates. Foxfire fires by
// itself; you move, dash, and build paper-lantern turrets with biomass. Every fifth wave the Hive studies what
// hurt it most and adapts. Each visitor plays their own run and posts the score to the lot's weekly table.
// The rules (rules.js) are plain arithmetic on the ground plane; this file draws them in 3D and steers the camera.
import * as THREE from 'three'
import * as R from './rules.js'
import * as W from './world.js'
import * as ART from './art.js'
import { Sparks, Dots, Rings, Popups } from './fx.js'
import { Hud } from './hud.js'

const SFX = {
  pop: 'assets/sfx/pop.wav', chime: 'assets/sfx/chime.wav', whoosh: 'assets/sfx/whoosh.wav', crane: 'assets/sfx/crane.wav',
  snuff: 'assets/sfx/snuff.wav', end: 'assets/sfx/end.wav', gold: 'assets/sfx/gold.wav', tail: 'assets/sfx/tail.wav',
  kyubi: 'assets/sfx/kyubi.wav',
}
const HELP = 'WASD / stick: run. Drag, or Q and E: turn the camera. Wheel: zoom. Foxfire fires by itself. ' +
  'SPACE, SHIFT or tap: dash (ends in a burst). Stand on a pad to build or upgrade a lantern; stand at the ' +
  'shrine to mend it. R restarts. Click or press a key for sound.'
const CHANNEL_NAME = { bolt: 'foxfire', lantern: 'lantern', burst: 'dash' }
const HALF = 11.0                  // game units from the arena's centre to the edge of the lot
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a }

/** The attract-mode pilot: builds lanterns when it can afford them, circles the shrine, dashes into crowds. */
function demoPilot(g) {
  const f = g.fox
  let mx = 0, mz = 0
  const want = g.pads.filter(p => p.level < 3 && g.bio >= R.LANTERN_COST[p.level]).sort((a, b) => a.level - b.level)[0]
  if (want) {
    const dx = want.x - f.x, dz = want.z - f.z, d = Math.hypot(dx, dz)
    if (d > 0.3) { mx = dx / d; mz = dz / d }
  } else {
    let near = null, nd = 1e9
    for (const e of g.enemies) { const d = Math.hypot(e.x - f.x, e.z - f.z); if (d < nd) { nd = d; near = e } }
    if (near && nd < 2.2) { mx = (f.x - near.x) / nd; mz = (f.z - near.z) / nd } else {
      const hx = Math.cos(g.t * 0.35) * 2.8, hz = Math.sin(g.t * 0.35) * 2.8
      const dx = hx - f.x, dz = hz - f.z, d = Math.hypot(dx, dz)
      if (d > 0.4) { mx = dx / d; mz = dz / d }
    }
  }
  let close = 0
  for (const e of g.enemies) if (Math.hypot(e.x - f.x, e.z - f.z) < 2.3) close++
  return { mx, mz, dash: close >= 4 && f.dashCd <= 0 }
}

export default async function start(p0) {
  const scene = p0.scene
  const camera = p0.camera
  p0.controls.mode = 'none'
  p0.controls.vertical = false
  p0.bodies.visible = false
  p0.hud(HELP)
  scene.add(camera)

  const lot = p0.lot || { width: 12, depth: 12, height: 12 }
  const S = Math.min(lot.width, lot.depth) / (2 * HALF)       // metres per game unit
  const box = { x: lot.width / 2 - 0.3, z: lot.depth / 2 - 0.3, y: lot.height - 0.35 }
  if (p0.me.position && p0.me.position.set) p0.me.position.set(0, 1, 0)

  // a software renderer (the review's browser has no GPU) gets a leaner scene: no ink outlines and no far scenery,
  // which leaves fewer shaders to compile before the first frame
  let gpuName = ''
  try {
    const gl = p0.renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    gpuName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '')
  } catch (e) { /* unknown renderer */ }
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName)
  p0.loading(0.05, 'folding the paper')
  scene.add(new THREE.DirectionalLight(0xffe3c4, 1.5).translateX(-6).translateY(14).translateZ(8))
  scene.add(new THREE.AmbientLight(0x7a6d98, 0.75))
  scene.fog = new THREE.Fog(0x6e4258, 10, 62)
  const glowTex = ART.glowTexture()
  const ramp = ART.toonRamp()
  W.buildSky(scene)
  const world = new THREE.Group()
  world.scale.setScalar(S)
  scene.add(world)

  const ground = W.buildGround(world, ramp, glowTex)
  const scenery = W.buildScenery(world, ramp, glowTex, software)
  const gates = W.buildGates(world, ramp, glowTex, ART.beamTexture())
  const core = W.buildCore(world, ramp, glowTex, ART.lanternTexture(0), software)
  const pads = W.buildPads(world, ramp, glowTex, software)
  const bugs = W.buildBugs(world, ramp, !software)
  const sparks = new Sparks(world, glowTex)
  const dots = new Dots(world, glowTex, 420)
  const rings = new Rings(world)
  const pops = new Popups(world)
  const hud = new Hud(camera)

  p0.loading(0.3, 'waking the fox')
  const fox = await W.loadFox(world, p0.asset('assets/fox.glb'), ramp, f => p0.loading(0.3 + 0.5 * f, 'waking the fox'), software)
  const baseAction = n => (fox.clips[n] ? fox.mixer.clipAction(fox.clips[n]) : null)
  const A = { idle: baseAction('idle'), run: baseAction('run') }
  let curLoop = null, oneShot = null
  function loopAnim(name) {
    const a = A[name]
    if (!a || curLoop === a || oneShot) return
    a.reset().fadeIn(0.15).play()
    if (curLoop) curLoop.fadeOut(0.15)
    curLoop = a
  }
  function foxDo(name, clampEnd = false) {
    const clip = fox.clips[name]
    if (!clip) return
    if (oneShot) oneShot.fadeOut(0.1)
    const a = fox.mixer.clipAction(clip)
    a.reset().setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = clampEnd
    a.fadeIn(0.12).play()
    if (curLoop) curLoop.fadeOut(0.12)
    curLoop = null
    oneShot = a
  }
  fox.mixer.addEventListener('finished', e => {
    if (e.action !== oneShot || e.action.clampWhenFinished) return
    oneShot.fadeOut(0.2)
    oneShot = null
  })
  loopAnim('idle')

  // ---------------------------------------------------------------- the camera: a chase camera on a leash, kept inside the lot's box
  const cam = {
    yaw: 0, pitch: 0.68, dist: 7.0, lift: 0, // lift: extra pitch to look over the shrine
    x: 0, z: 9,                               // the leash end, in game units, before the box clamp
    manualT: 99,
    pos: new THREE.Vector3(0, 6 * S, 9 * S), look: new THREE.Vector3(0, 0.8 * S, 0),
    orbit: 0.4, snap: true,
  }
  const want = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  let shake = 0

  let renderScale = 1
  const basePR = p0.pixelRatio || (p0.renderer.getPixelRatio ? p0.renderer.getPixelRatio() : 1)
  function applyScale() {
    if (renderScale >= 1 || !p0.renderer.setPixelRatio) return
    try { p0.renderer.setPixelRatio(Math.max(0.35, Math.min(1, basePR) * renderScale)) } catch (e) { /* the shell keeps its own */ }
  }
  function fit() {
    applyScale()
    const aspect = Math.max(0.3, p0.width / Math.max(1, p0.height))
    camera.aspect = aspect
    camera.near = 0.05
    camera.far = 420
    const hfov = THREE.MathUtils.degToRad(50)
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect))
    camera.fov = clamp(vfov, 56, 92)
    if (!cam.zoomed) cam.dist = aspect < 1.1 ? 6.2 : 7.0
    camera.updateProjectionMatrix()
    hud.layout(camera)
    const p11 = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    pads.setTagSize((aspect < 1.1 ? 0.04 : 0.052) * 2 / (p11 * S))
    pops.setScreenScale((aspect < 1.1 ? 0.045 : 0.06) * 2 / (p11 * S))
    const px = p0.height * (p0.renderer.getPixelRatio ? p0.renderer.getPixelRatio() : (p0.pixelRatio || 1))
    sparks.setScale(px, camera.fov)
    dots.setScale(px, camera.fov)
  }
  fit()
  p0.on('resize', fit)

  /** Put a camera wish (game units) into the box: what the box cuts off sideways is given back as height. */
  function boxed(x, y, z, out) {
    const px = x * S, pz = z * S
    const cx = clamp(px, -box.x, box.x), cz = clamp(pz, -box.z, box.z)
    const lost = Math.hypot(px - cx, pz - cz)
    out.set(cx, clamp(y * S + lost * 1.1, 0.25, box.y), cz)
    return out
  }

  function chaseCamera(dt, f) {
    let vx = cam.x - f.x, vz = cam.z - f.z
    if (vx * vx + vz * vz < 1e-4) { vx = 0; vz = 1 }
    cam.yaw = Math.atan2(vx, vz)
    if (cam.manualT > 1.4 && f.moving && f.down <= 0) {
      const dx = Math.cos(f.face), dz = Math.sin(f.face)
      const fwd = dx * -Math.sin(cam.yaw) + dz * -Math.cos(cam.yaw)
      const rate = 1.3 * Math.max(0, fwd)
      cam.yaw += wrap(Math.atan2(-dx, -dz) - cam.yaw) * Math.min(1, rate * dt)
    }
    // look over the shrine when it stands between the camera and the fox
    const t = clamp(-(f.x * vx + f.z * vz) / (vx * vx + vz * vz), 0, 1)
    const nx = f.x + vx * t, nz = f.z + vz * t
    const near = Math.hypot(nx, nz)
    const liftWant = t > 0.05 && t < 0.97 && near < 2.4 ? 0.62 * (1 - near / 2.4) : 0
    cam.lift += (liftWant - cam.lift) * Math.min(1, dt * 4)
    const pitch = clamp(cam.pitch + cam.lift, 0.12, 1.3)
    const hd = cam.dist * Math.cos(pitch)
    cam.x = f.x + Math.sin(cam.yaw) * hd
    cam.z = f.z + Math.cos(cam.yaw) * hd
    boxed(cam.x, 1.1 + cam.dist * Math.sin(pitch), cam.z, want.pos)
    const lead = 1.3
    want.look.set((f.x - Math.sin(cam.yaw) * lead) * S, 1.0 * S, (f.z - Math.cos(cam.yaw) * lead) * S)
  }

  function orbitCamera(dt, radius, height, speed, lookY) {
    cam.orbit += dt * speed
    const r = Math.min(radius, (Math.min(box.x, box.z) - 0.2) / S)
    boxed(Math.sin(cam.orbit) * r, height + Math.sin(cam.orbit * 0.7) * 0.6, Math.cos(cam.orbit) * r, want.pos)
    want.look.set(0, lookY * S, 0)
  }

  function placeCamera(dt) {
    if (cam.snap) { cam.pos.copy(want.pos); cam.look.copy(want.look); cam.snap = false } else {
      cam.pos.lerp(want.pos, 1 - Math.exp(-dt * 7))
      cam.look.lerp(want.look, 1 - Math.exp(-dt * 9))
    }
    camera.position.copy(cam.pos)
    if (shake > 0.001) {
      shake *= Math.max(0, 1 - 6 * dt)
      camera.position.x += (Math.random() - 0.5) * shake * 0.35 * S * 2
      camera.position.y += (Math.random() - 0.5) * shake * 0.25 * S * 2
      camera.position.z += (Math.random() - 0.5) * shake * 0.35 * S * 2
    }
    camera.position.x = clamp(camera.position.x, -box.x, box.x)
    camera.position.z = clamp(camera.position.z, -box.z, box.z)
    camera.position.y = clamp(camera.position.y, 0.2, box.y)
    camera.lookAt(cam.look)
  }

  // ---------------------------------------------------------------- warm-up: draw every material once now
  p0.loading(0.88, 'lighting lanterns')
  const warmGame = R.createGame(1)
  for (const k of Object.keys(R.ENEMY)) warmGame.enemies.push({ id: 900 + warmGame.nextId++, kind: k, x: 3, z: 3, hp: 10, max: 10, r: R.ENEMY[k].r, gen: 2, elite: true, phase: 0, hurt: 0.1 })
  warmGame.spits.push({ x: 2, z: 2, life: 1 })
  for (const p of warmGame.pads) { p.level = 3; p.hp = 50; p.hold = 0.3; p.jam = 1 }
  warmGame.boss = { hp: 10, max: 20 }
  pads.update(warmGame, 0)
  bugs.update(warmGame, 0, 0.016)
  core.update(warmGame, 0, ground.pool)
  for (const gt of gates) { gt.beam.visible = true; gt.beam.material.opacity = 0.2 }
  sparks.emit(0, 1, 0, { count: 6 })
  sparks.update(0.01)
  dots.begin(); dots.add(0, 1, 0, 0.3, 1, 1, 1); dots.end()
  rings.spawn(0, 0, 1)
  pops.show('+1', 0, 1, 0)
  hud.banner('HIVE ADAPT', 'warming up', '#ffd98a', 0.1)
  hud.drawPanel('HIVE ADAPT', [''], '')
  hud.drawTitle('')
  hud.logo.visible = hud.info.visible = hud.tall.visible = true
  hud.showPlay(true)
  hud.draw({ wave: 1, bugs: 0, score: 0, bio: 0, hp: 1, hpMax: 1, foxHp: 1, foxMax: 1, dash: 1, prep: 1, phase: 'prep', hab: { bolt: 0, lantern: 0, burst: 0 }, resist: warmGame.hive.resist, gen: 0, nextEvolve: 5, boss: warmGame.boss })
  hud.drawMap(warmGame, 0, 0, [])
  orbitCamera(0, 9, 6, 0, 1.2)
  placeCamera(0)
  const t0 = performance.now()
  if (p0.renderer.compileAsync) await p0.renderer.compileAsync(scene, camera)
  p0.renderer.render(scene, camera)
  const warmMs = performance.now() - t0
  let light = software || warmMs > 8000
  p0.log(`[hive-adapt-3d] warm-up ${warmMs.toFixed(0)} ms, renderer "${gpuName.slice(0, 60)}"${light ? ' (light mode)' : ''}`)
  hud.hidePanel()
  hud.ban.visible = false
  for (const gt of gates) gt.beam.visible = false
  for (const it of rings.items) it.m.visible = false
  for (const it of pops.items) it.s.visible = false
  sparks.n = 0
  function applyLight() {
    renderScale = 0.7
    fit()
    sparks.density = 0.4
    bugs.setOutline(false)
    for (const o of fox.outlines) o.visible = false
    for (const c of ground.clouds) c.s.visible = false
    if (scenery.tufts) scenery.tufts.visible = false
  }
  if (light) applyLight()

  // ---------------------------------------------------------------- sound
  let soundOn = false
  const lastSfx = {}
  function sfx(name, volume = 0.5, rate = 1, gap = 0.05) {
    if (!soundOn || !p0.sound) return
    const now = p0.time
    if (lastSfx[name] !== undefined && now - lastSfx[name] < gap) return
    lastSfx[name] = now
    try { p0.sound.play(SFX[name], { volume, rate }) } catch (e) { /* muted or not ready */ }
  }

  // ---------------------------------------------------------------- game state
  const seed = () => (Date.now() ^ 0x9e3779b9) >>> 0
  let g = R.createGame(seed())
  g.prep = 2.5
  let mode = 'title'            // title (a demo plays behind it) | play | over
  let acc = 0, playStart = 0, overAt = 0
  let tableTop = p0.table || []
  let lastReward = null
  let dashQueued = false
  let foxAngle = Math.PI
  let postedScore = 0

  function bestLine() {
    return tableTop.length ? `Your browser best: ${Number(tableTop[0].score).toLocaleString('en-US')}` : 'Start your first local run'
  }

  function newRun() {
    g = R.createGame(seed())
    mode = 'play'
    acc = 0
    playStart = p0.time
    lastReward = null
    postedScore = 0
    hud.hidePanel()
    hud.showTitle(false)
    hud.showPlay(true)
    fox.holder.visible = true
    fox.shadow.visible = true
    if (oneShot) { oneShot.stop(); oneShot = null }
    curLoop = null
    loopAnim('idle')
    cam.x = g.fox.x; cam.z = g.fox.z + 6
    cam.pitch = 0.68; cam.manualT = 99
    hud.banner('WAVE 1 IN 8', 'Guard the foxfire shrine', '#ffd98a', 3)
    p0.hud(HELP)
  }

  function showTitle() {
    hud.drawTitle(bestLine())
    hud.showTitle(true)
    hud.showPlay(false)
  }

  function showOver(e) {
    const lines = [
      [`Wave ${e.wave}`, 84, '#fff1d6'],
      [`${e.score.toLocaleString('en-US')} points · ${e.kills} bugs inked`, 40],
      [`The Hive reached generation ${g.hive.gen}${g.hive.traits.length ? ': ' + g.hive.traits.join(', ') : ''}`, 30, '#e8a590'],
    ]
    if (lastReward && lastReward.ok && lastReward.best !== undefined) {
      lines.push([`Your browser best: ${Number(lastReward.best).toLocaleString('en-US')}`, 34, '#ffd98a'])
    } else if (lastReward && !lastReward.ok && lastReward.reason) {
      lines.push([String(lastReward.reason).slice(0, 60), 26, '#c9bfae'])
    }
    lines.push(['', 10])
    const top = (tableTop || []).slice(0, 5)
    if (top.length) {
      lines.push(['YOUR BROWSER', 30, '#c99b4b'])
      top.forEach((r, i) => lines.push([`${i + 1}. ${String(r.name).slice(0, 18)} — ${Number(r.score).toLocaleString('en-US')}${r.you ? '  ◂ you' : ''}`, 34, r.you ? '#ffd98a' : '#f3e8d4']))
    }
    hud.drawPanel('THE SHRINE FALLS', lines, 'Press R or tap to defend it again', '#d9432b')
  }

  p0.on('reward', r => {
    if (r && r.kind === 'score') { lastReward = r; if (mode === 'over') showOver({ wave: g.wave, score: g.score, kills: g.kills }) }
  })
  p0.on('table', top => { tableTop = top || []; if (mode === 'title') showTitle(); else if (mode === 'over') showOver({ wave: g.wave, score: g.score, kills: g.kills }) })

  function post(score) {
    if (score <= postedScore || p0.time - playStart < 11) return
    postedScore = score
    try { p0.score(score) } catch (err) { p0.log('score failed', String(err)) }
  }

  // ---------------------------------------------------------------- input: keys, a drag to turn the camera, a tap to dash
  function wake() { if (!soundOn) soundOn = true }
  p0.on('keydown', e => {
    const code = e && e.code
    if (code === 'Enter' || code === 'Escape') return
    wake()
    if (mode === 'title') { newRun(); return }
    if (code === 'KeyR') { newRun(); return }
    if (mode === 'over') { if (code === 'Space' && p0.time - overAt > 1.0) newRun(); return }
    if (code === 'Space') dashQueued = true
  })
  const drag = { on: false, x: 0, y: 0, moved: 0, t0: 0, fromPlay: false }
  let pixels = false
  function ptr(e) {
    const P = (p0.input && p0.input.pointer) || {}
    const x = e && Number.isFinite(e.x) ? e.x : e && Number.isFinite(e.clientX) ? e.clientX : (P.x || 0)
    const y = e && Number.isFinite(e.y) ? e.y : e && Number.isFinite(e.clientY) ? e.clientY : (P.y || 0)
    if (Math.abs(x) > 2.5 || Math.abs(y) > 2.5) pixels = true
    return [x, y]
  }
  p0.on('pointerdown', e => {
    wake()
    const [x, y] = ptr(e)
    drag.on = true; drag.x = x; drag.y = y; drag.moved = 0; drag.t0 = p0.time; drag.fromPlay = mode === 'play'
    if (mode === 'title') { newRun(); return }
    if (mode === 'over') { if (p0.time - overAt > 1.0) newRun() }
  })
  p0.on('pointermove', e => {
    if (!drag.on) return
    const [x, y] = ptr(e)
    let dx = x - drag.x, dy = y - drag.y
    drag.x = x; drag.y = y
    if (pixels) { dx /= Math.max(1, p0.height); dy /= Math.max(1, p0.height) } else { dx /= 2; dy = -dy / 2 }
    drag.moved += Math.abs(dx) + Math.abs(dy)
    if (mode !== 'play') return
    turnCamera(-dx * 3.4, dy * 2.2)
  })
  p0.on('pointerup', () => {
    if (drag.on && drag.fromPlay && mode === 'play' && drag.moved < 0.025 && p0.time - drag.t0 < 0.35) dashQueued = true
    drag.on = false
  })
  p0.on('wheel', e => {
    const d = e ? (e.deltaY ?? e.dy ?? e.delta ?? 0) : 0
    if (d) { cam.dist = clamp(cam.dist + Math.sign(d) * 0.6, 4.6, 10); cam.zoomed = true }
  })
  function turnCamera(dyaw, dpitch) {
    if (!dyaw && !dpitch) return
    const f = g.fox
    cam.yaw += dyaw
    cam.pitch = clamp(cam.pitch + dpitch, 0.2, 1.2)
    const hd = Math.hypot(cam.x - f.x, cam.z - f.z) || 1
    cam.x = f.x + Math.sin(cam.yaw) * hd
    cam.z = f.z + Math.cos(cam.yaw) * hd
    cam.manualT = 0
  }
  let shiftWas = false
  function readInput(dt) {
    const k = p0.input
    let ix = 0, iy = 0
    if (k.isDown('KeyA') || k.isDown('ArrowLeft')) ix -= 1
    if (k.isDown('KeyD') || k.isDown('ArrowRight')) ix += 1
    if (k.isDown('KeyW') || k.isDown('ArrowUp')) iy += 1
    if (k.isDown('KeyS') || k.isDown('ArrowDown')) iy -= 1
    let turn = 0
    if (k.isDown('KeyQ')) turn += 1
    if (k.isDown('KeyE')) turn -= 1
    if (turn) turnCamera(turn * 2.2 * dt, 0)
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw)
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw)
    const shift = k.isDown('ShiftLeft') || k.isDown('ShiftRight')
    const dash = dashQueued || (shift && !shiftWas)
    shiftWas = shift
    dashQueued = false
    return { mx: fx * iy + rx * ix, mz: fz * iy + rz * ix, dash }
  }

  // ---------------------------------------------------------------- events from the rules
  const CH_COLOR = { bolt: [1, 0.75, 0.3], lantern: [1, 0.55, 0.3], burst: [1, 0.9, 0.5] }
  let hitSparks = 0
  function handle(ev, demo) {
    const banner = (...a) => { if (!demo) hud.banner(...a) }
    switch (ev.type) {
      case 'shot':
        if (ev.ch === 'bolt') sparks.emit(ev.x, 0.95, ev.z, { count: 1, speed: 0.6, color: [1, 0.8, 0.4], size: 0.3 * S, life: 0.15, up: 0.3, gravity: 0 })
        sfx('whoosh', ev.ch === 'bolt' ? 0.16 : 0.12, ev.ch === 'bolt' ? 1.25 : 0.95, 0.09)
        break
      case 'hit':
        if (hitSparks++ % 2 === 0) sparks.emit(ev.x, 0.55, ev.z, { count: 3, speed: 2.2, color: ev.resisted ? [0.7, 0.7, 0.8] : CH_COLOR[ev.ch], size: 0.2 * S, life: 0.35, up: 1.2 })
        break
      case 'kill':
        sparks.emit(ev.x, 0.45, ev.z, { count: ev.kind === 'queen' ? 40 : 10, speed: 3, color: [0.55, 0.3, 0.9], size: 0.28 * S, life: 0.6, up: 2.2 })
        sparks.emit(ev.x, 0.5, ev.z, { count: 4, speed: 2, color: [1, 0.35, 0.2], size: 0.2 * S, life: 0.5, up: 2 })
        sfx('pop', 0.28, ev.kind === 'queen' ? 0.6 : 0.9 + Math.random() * 0.4, 0.04)
        if (ev.gain >= 4) pops.show(`+${ev.gain}`, ev.x, 1.4, ev.z, { color: '#a8e88c', size: 0.6, life: 0.8 })
        if (ev.kind === 'queen') { banner('INK QUEEN DOWN', '+500 points · +60 biomass', '#a8e88c', 3); shake = 0.5 }
        break
      case 'coreHit':
        if (!demo) shake = Math.max(shake, 0.14)
        sfx('snuff', 0.4, 1, 0.25)
        sparks.emit(0, 1.6, 0, { count: 8, speed: 3, color: [1, 0.3, 0.2], size: 0.3 * S, life: 0.5 })
        break
      case 'padHit':
        sparks.emit(ev.x, 1.4, ev.z, { count: 3, speed: 2, color: [1, 0.4, 0.2], size: 0.2 * S, life: 0.3 })
        break
      case 'padLost':
        pops.show('LANTERN LOST', ev.x, 2.4, ev.z, { color: '#ff8f78', size: 0.8, life: 1.3 })
        sparks.emit(ev.x, 1.2, ev.z, { count: 16, speed: 3.5, color: [1, 0.5, 0.2], size: 0.3 * S, life: 0.7 })
        sfx('snuff', 0.45, 0.8, 0.1)
        break
      case 'foxHit':
        if (!demo) shake = Math.max(shake, 0.1)
        sfx('snuff', 0.25, 1.4, 0.2)
        break
      case 'foxDown':
        pops.show('FOX DOWN', g.fox.x, 2.2, g.fox.z, { color: '#ff8f78', size: 0.9, life: 1.6 })
        fox.holder.visible = false
        fox.shadow.visible = false
        sparks.emit(g.fox.x, 0.8, g.fox.z, { count: 24, speed: 4, color: [1, 0.5, 0.2], size: 0.35 * S, life: 0.8 })
        break
      case 'foxUp':
        fox.holder.visible = true
        fox.shadow.visible = true
        pops.show('BACK!', 0, 2.4, 2.2, { color: '#a8e88c', size: 0.8, life: 1.1 })
        break
      case 'dash':
        foxDo('jump')
        sfx('whoosh', 0.4, 0.85, 0.1)
        rings.spawn(ev.x, ev.z, 0.8, 0xffd27a, 0.3)
        break
      case 'nova':
        rings.spawn(ev.x, ev.z, 2.6, 0xffc24a, 0.45)
        sparks.emit(ev.x, 0.6, ev.z, { count: 26, speed: 6, color: [1, 0.8, 0.35], size: 0.3 * S, life: 0.6, up: 1.4 })
        sfx('tail', 0.35, 1.1, 0.1)
        if (!demo) shake = Math.max(shake, 0.12)
        break
      case 'build':
      case 'upgrade':
        rings.spawn(ev.x, ev.z, 1.6, 0xffc24a, 0.5)
        sparks.emit(ev.x, 1.3, ev.z, { count: 20, speed: 3.2, color: [1, 0.8, 0.4], size: 0.3 * S, life: 0.8, up: 2.5 })
        pops.show(ev.type === 'build' ? 'LANTERN' : `LEVEL ${ev.level}`, ev.x, 3.2, ev.z, { color: '#ffe2a6', size: 0.8, life: 1.1 })
        sfx(ev.type === 'build' ? 'chime' : 'tail', 0.5, 1, 0.1)
        foxDo('interact')
        break
      case 'mend':
        if (Math.random() < 0.15) sparks.emit(Math.cos(p0.time * 4) * 1.4, 0.6, Math.sin(p0.time * 4) * 1.4, { count: 1, speed: 0.2, color: [0.5, 1, 0.5], size: 0.25 * S, life: 0.7, up: 2.4, gravity: 0 })
        break
      case 'spit':
        sfx('pop', 0.12, 0.6, 0.15)
        break
      case 'brood':
        sparks.emit(ev.x, 0.8, ev.z, { count: 14, speed: 3, color: [0.55, 0.3, 0.9], size: 0.35 * S, life: 0.6 })
        break
      case 'rage':
        banner('THE QUEEN IS ENRAGED', '', '#ff8f78', 2)
        rings.spawn(ev.x, ev.z, 3, 0xd9432b, 0.6)
        sfx('crane', 0.5, 0.7, 0.5)
        break
      case 'wave':
        banner(`WAVE ${ev.wave}`, `${ev.count} bugs from ${ev.gates.length} gate${ev.gates.length > 1 ? 's' : ''}: watch the red beams`, '#ffd98a', 2.6)
        sfx('crane', 0.5, 1, 0.5)
        break
      case 'boss':
        sfx('kyubi', 0.5, 0.7, 0.5)
        if (!demo) shake = 0.4
        banner('THE INK QUEEN', 'Break her plates. She calls her brood.', '#ff8f78', 3.2)
        break
      case 'clear':
        banner('WAVE CLEARED', `+${ev.bonus} biomass · next wave in 7s`, '#a8e88c', 2.6)
        sfx('gold', 0.5, 1, 0.5)
        foxDo('Joy')
        if (!demo) post(ev.score)
        break
      case 'evolve': {
        const pct = Math.round(ev.resist[ev.channel] * 100)
        banner('THE HIVE ADAPTED', `${ev.name}: resists ${pct}% of ${CHANNEL_NAME[ev.channel]} damage. ${ev.tip}`, '#ff8f78', 5.2)
        sfx('kyubi', 0.55, 1, 1)
        rings.spawn(0, 0, 8.5, 0xd9432b, 0.9)
        if (!demo) shake = 0.45
        break
      }
      case 'over':
        if (demo) { g = R.createGame(seed()); g.prep = 2; fox.holder.visible = fox.shadow.visible = true; break }
        mode = 'over'
        overAt = p0.time
        sfx('end', 0.6, 1, 1)
        foxDo('Sadness', true)
        post(ev.score)
        showOver(ev)
        cam.orbit = Math.atan2(cam.pos.x, cam.pos.z)
        break
      default:
    }
  }

  // ---------------------------------------------------------------- frame
  const hudState = { hab: { bolt: 0, lantern: 0, burst: 0 }, resist: g.hive.resist }
  let frames = 0, slowAcc = 0, hudT = 0, mapT = 0, shrineFade = 1
  const others = []
  p0.log('[hive-adapt-3d] ready, metres per unit ' + S.toFixed(3))

  p0.loop((dt, time) => {
    dt = Math.min(dt, 0.1)
    frames++
    if (!light && frames <= 90) {
      slowAcc += dt
      if (frames === 90 && slowAcc / 90 > 0.05) { light = true; slowAcc = 0.05; applyLight(); p0.log('[hive-adapt-3d] switching to light mode') }
    } else if (light && renderScale > 0.5) {
      slowAcc = slowAcc * 0.97 + dt * 0.03
      if (slowAcc > 0.14 && frames > 150) { renderScale = 0.5; fit(); slowAcc = 0.05; p0.log('[hive-adapt-3d] render scale 0.5') }
    }
    cam.manualT += dt
    // ---- simulate
    if (mode === 'play' || mode === 'title') {
      const demo = mode === 'title'
      const input = demo ? null : readInput(dt)
      acc += dt
      let guard = 0
      while (acc > 1 / 60 && guard++ < 6) {
        R.step(g, 1 / 60, demo ? demoPilot(g) : input)
        acc -= 1 / 60
        for (const ev of g.ev) handle(ev, demo)
        g.ev.length = 0
        if (input) input.dash = false
      }
    }
    // ---- the fox
    const f = g.fox
    fox.holder.position.set(f.x, 0, f.z)
    let faceWant = null
    if (f.moving || f.dash > 0) faceWant = Math.atan2(Math.cos(f.face), Math.sin(f.face))
    else if (f.down <= 0) {
      let best = null, bd = 8.2 * 8.2
      for (const e of g.enemies) { const d = (e.x - f.x) ** 2 + (e.z - f.z) ** 2; if (d < bd) { bd = d; best = e } }
      if (best) faceWant = Math.atan2(best.x - f.x, best.z - f.z)
    }
    if (faceWant !== null) foxAngle += wrap(faceWant - foxAngle) * Math.min(1, dt * 14)
    fox.holder.rotation.y = foxAngle
    fox.root.visible = !(f.inv > 0 && f.down <= 0 && Math.floor(time * 12) % 2 === 1)
    fox.shadow.position.set(f.x, 0.035, f.z)
    if (!oneShot) loopAnim(f.moving && mode !== 'over' ? 'run' : 'idle')
    fox.mixer.update(dt)
    if (f.dash > 0) sparks.emit(f.x, 0.5, f.z, { count: 2, speed: 1, color: [1, 0.7, 0.3], size: 0.3 * S, life: 0.3 })
    if (mode === 'play' && p0.me.position && p0.me.position.set) { p0.me.position.set(f.x * S, 1.0, f.z * S); p0.me.yaw = foxAngle }
    // ---- the scene
    core.update(g, time, ground.pool)
    {
      const cx = camera.position.x / S, cz = camera.position.z / S
      const dc = Math.hypot(cx, cz)
      const fwdx = cam.look.x / S - cx, fwdz = cam.look.z / S - cz
      const ahead = (-cx * fwdx - cz * fwdz) > 0
      let a = ahead ? clamp((dc - 2.2) / 2.6, 0.28, 1) : 1
      if (mode === 'play') {
        const vx = cx - f.x, vz = cz - f.z, vv = vx * vx + vz * vz || 1
        const tt = clamp(-(f.x * vx + f.z * vz) / vv, 0, 1)
        const nd = Math.hypot(f.x + vx * tt, f.z + vz * tt)
        if (tt > 0.05 && tt < 0.95 && nd < 1.6 && camera.position.y / S < 3.6) a = Math.min(a, 0.35)
      }
      shrineFade += (a - shrineFade) * Math.min(1, dt * 6)
      core.setFade(shrineFade)
      for (let i = 0; i < pads.pads.length; i++) {
        const v = pads.pads[i]
        const d = Math.hypot(cx - v.x, cz - v.z)
        const want = mode === 'title' ? 1 : clamp((d - 1.3) / 2.2, 0.18, 1)
        pads.setFade(i, v.fade + (want - v.fade) * Math.min(1, dt * 8))
      }
    }
    pads.update(g, time, { tags: mode === 'play', fox: f })
    bugs.update(g, time, dt)
    for (const c of ground.clouds) {
      c.a += dt * c.sp
      c.s.position.set(Math.cos(c.a) * c.rad, 1.2, Math.sin(c.a) * c.rad)
    }
    for (let i = 0; i < gates.length; i++) {
      const gt = gates[i]
      const open = g.phase === 'wave' && g.gatesOpen.includes(i) && g.queue.length > 0
      const breath = 0.5 + 0.5 * Math.sin(time * 3 + i)
      const soon = g.phase === 'prep' && g.prep < 2.5
      const glowWant = open ? 0.55 + 0.25 * breath : (soon ? 0.15 + 0.15 * breath : 0)
      gt.glow.material.opacity += (glowWant - gt.glow.material.opacity) * Math.min(1, dt * 6)
      gt.portal.material.opacity += ((open ? 0.88 : 0.3) - gt.portal.material.opacity) * Math.min(1, dt * 5)
      const bx = gt.beam.position.x, bz = gt.beam.position.z
      const cdx = camera.position.x / S - bx, cdz = camera.position.z / S - bz
      const away = clamp((Math.hypot(cdx, cdz) - 2.5) / 3, 0, 1)
      gt.beamLevel = (gt.beamLevel || 0) + ((open ? 0.42 + 0.12 * breath : 0) - (gt.beamLevel || 0)) * Math.min(1, dt * 4)
      gt.beam.material.opacity = gt.beamLevel * away
      gt.beam.rotation.y = Math.atan2(cdx, cdz)
      gt.beam.visible = gt.beam.material.opacity > 0.01
    }
    dots.begin()
    for (const b of g.bolts) {
      const fox_ = b.ch === 'bolt'
      const y0 = fox_ ? 0.95 : 1.6, life0 = fox_ ? 0.62 : 0.7
      const y = 0.5 + (y0 - 0.5) * Math.max(0, b.life / life0)
      const cr = 1.0, cg = fox_ ? 0.72 : 0.45, cb = fox_ ? 0.28 : 0.25
      dots.add(b.x, y, b.z, (fox_ ? 0.55 : 0.48) * S, cr, cg, cb)
      dots.add(b.x - b.vx * 0.014, y + 0.01, b.z - b.vz * 0.014, 0.36 * S, cr * 0.7, cg * 0.6, cb * 0.5)
      dots.add(b.x - b.vx * 0.028, y + 0.02, b.z - b.vz * 0.028, 0.22 * S, cr * 0.45, cg * 0.35, cb * 0.3)
    }
    others.length = 0
    if (p0.players) {
      for (const p of p0.players.values()) {
        if (p.isMe || !p.position) continue
        const ox = p.position.x / S, oz = p.position.z / S
        others.push({ x: ox, z: oz })
        dots.add(ox, 1.3 + Math.sin(time * 2 + ox) * 0.15, oz, 0.9 * S, 0.45, 0.75, 1.0)
      }
    }
    scenery.lanterns.update(dt, time, light ? null : dots, S)
    dots.end()
    sparks.update(dt)
    rings.update(dt)
    pops.update(dt)
    hud.update(dt)
    // ---- the camera
    if (mode === 'play') chaseCamera(dt, f)
    else if (mode === 'title') orbitCamera(dt, 9.6, 6.2, 0.1, 1.0)
    else orbitCamera(dt, 7.5, 5.0, 0.06, 1.2)
    placeCamera(dt)
    // ---- the hud
    if (mode !== 'title') {
      hudT += dt
      if (hudT > 0.08) {
        hudT = 0
        hudState.wave = Math.max(g.wave, 1)
        hudState.bugs = g.enemies.length + g.queue.length
        hudState.score = g.score
        hudState.bio = g.bio
        hudState.hp = g.core.hp
        hudState.hpMax = g.core.max
        hudState.foxHp = g.fox.hp
        hudState.foxMax = g.fox.max
        hudState.dash = 1 - Math.min(1, g.fox.dashCd / 2.8)
        hudState.prep = g.prep
        hudState.phase = g.phase
        hudState.hab = R.habits(g)
        hudState.resist = g.hive.resist
        hudState.gen = g.hive.gen
        hudState.nextEvolve = g.hive.nextEvolve
        hudState.boss = g.boss ? { hp: Math.max(0, g.boss.hp), max: g.boss.max } : null
        hud.draw(hudState)
      }
      mapT += dt
      if (mapT > 0.12) { mapT = 0; hud.drawMap(g, cam.yaw, time, others) }
    }
  })

  showTitle()
  p0.on('end', () => { /* nothing to clean up: the session owns the scene */ })
}
