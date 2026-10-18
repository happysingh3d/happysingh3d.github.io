// HIVE ADAPT for Project 0: DeadHunk's own third-person swarm shooter + tower defence, rebuilt for the web from his own
// Unity project (the design, models and code are his). Co-op for up to 4 defenders on the lot's session (net.js).
// Hold the Core on an elevated desert outpost against an endless Hive that studies how you fight and adapts.
// main.js wires the modules together: renderer setup, the scaled world root, input, sound, time control, camera, the loop.
// Module contract: CONTRACT.md. Everything gameplay lives in game space (Unity metres, north = -Z) under G.root (scale 1/12).
import * as THREE from 'three'
import { createAssets } from './assets.js'
import { createWorld } from './world.js'
import { createEnemies } from './enemies.js'
import { createHud } from './hud.js'
import { createFx } from './fx.js'
import { createPlayer } from './player.js'
import { createWeapons } from './weapons.js'
import { createTowers } from './towers.js'
import { createRun } from './run.js'
import { createNet } from './net.js'
import { rng, clamp, clamp01, perlin } from './u.js'

// game metres -> lot metres: the outpost's reachable ground (about 72 m out from the Core) fits the lot's narrower side
let S = 1 / 12
const VERSION = '1.0.0'
const HELP = 'HIVE ADAPT · co-op up to 4 · hold the Core · WASD move, mouse aim, LMB fire, RMB aim · E/Q build at amber pads · G start the wave · B gear · P pause'
/** this week's prize from the lot's game rules ('' when there is none): "Top 3 share 50 tokens" */
function prizeNote(p0) {
  const g = p0 && p0.game
  if (!g || g.paused || g.mode !== 'top' || !(g.prize > 0)) return ''
  return 'Top ' + (g.places || 3) + ' share ' + Math.round(g.prize).toLocaleString('en-US') + ' tokens'
}
const helpText = p0 => { const n = prizeNote(p0); return n ? HELP + ' · THIS WEEK: ' + n.toLowerCase() + ' (score = waves held)' : HELP }

export default async function start(p0) {
  const t0 = performance.now()
  { const L = p0.lot || {}; const side = Math.min(+L.width || 12, +L.depth || 12); S = Math.min(1 / 4, Math.max(1 / 20, side / 144)) }
  const scene = p0.scene
  const camera = p0.camera
  const renderer = p0.renderer
  p0.controls.mode = 'none'
  p0.controls.vertical = false
  p0.bodies.visible = false
  p0.hud(helpText(p0))
  p0.loading(0.02, 'deploying to the frontier')

  // ------------------------------------------------------------------ renderer + light mode
  let gpuName = ''
  try {
    const gl = renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '')
  } catch (e) { /* unknown */ }
  const software = /swiftshader|llvmpipe|software|softpipe|microsoft basic/i.test(gpuName)
  const phone = (p0.width < 700 && p0.height > p0.width) || /mali|adreno|powervr|apple gpu/i.test(gpuName)
  const lite = software
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  try { renderer.setPixelRatio(Math.min(software ? 0.5 : phone ? 1.5 : 1.75, p0.pixelRatio || 1)) } catch (e) { /* shell owns it */ }
  for (const c of [...scene.children]) if (c.isHemisphereLight || c.isAmbientLight) scene.remove(c) // the world brings its own light
  if (!camera.parent) scene.add(camera) // the HUD hangs off the camera
  camera.near = 0.05 * S
  camera.far = 520 * S
  camera.fov = 60
  camera.updateProjectionMatrix()

  // ------------------------------------------------------------------ the shared game object
  const root = new THREE.Group()
  root.name = 'HiveAdapt'
  root.scale.setScalar(S)
  scene.add(root)
  const handlers = new Map()
  const events = {
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); return () => events.off(name, fn) },
    off(name, fn) { const l = handlers.get(name); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) } },
    emit(name, ...args) {
      const l = handlers.get(name)
      if (!l) return
      for (const fn of [...l]) { try { fn(...args) } catch (e) { p0.log('[hive] handler ' + name + ' failed: ' + (e && e.stack || e)) } }
    },
  }
  const G = {
    THREE, p0, S, root, scene, camera, renderer, events, lite, software, phone, version: VERSION,
    time: 0, rt: 0, dt: 0, rdt: 0, timeScale: 1, paused: false, state: 'loading',
    rng: rng(((p0.room && p0.room.seed) || 1878) >>> 0),
    toLot: (v, out = new THREE.Vector3()) => out.copy(v).multiplyScalar(S),
    log: (...a) => p0.log('[hive] ' + a.join(' ')),
    markers: [], // edge markers pushed by modules each frame, flushed to the HUD by main
    listener: new THREE.Vector3(0, 7, -7), // where sounds are heard from (game space), set to the player each frame
    cam: { pos: new THREE.Vector3(0.6, 8.6, 10.3), quat: new THREE.Quaternion(), fov: 60 }, // the rig writes this (game space)
  }
  G.input = freshInput()
  p0.__probe?.(G) // test harness hook (absent on the platform)

  // ------------------------------------------------------------------ sound
  const lastPlayed = new Map()
  let soundOn = false
  let frameSounds = 0
  G.sfx = (name, o = {}) => {
    if (!soundOn || !p0.sound || !name) return 0
    let vol = o.vol ?? 1
    if (o.pos) {
      const d = o.pos.distanceTo(G.listener)
      vol *= 1 / (1 + Math.max(0, d - 3) / 9)
      if (vol < 0.03) return 0
    }
    const now = G.rt
    if (now - (lastPlayed.get(name) || -1) < (o.gap ?? 0.04)) return 0
    if (frameSounds > 7 && !o.ui) return 0
    lastPlayed.set(name, now)
    frameSounds++
    try { return p0.sound.play(`assets/sfx/${name}.mp3`, { volume: clamp(vol, 0, 1.5), rate: o.rate ?? 1, loop: !!o.loop }) } catch (e) { return 0 }
  }
  G.sfxStop = id => { try { if (id) p0.sound.stop(id) } catch (e) { /* gone */ } }
  let musicName = null, musicVol = 0.4
  G.music = (name, vol = 0.4) => {
    if (name === musicName) { if (vol !== musicVol) { musicVol = vol; try { p0.music.volume(vol) } catch (e) { /* none */ } } return }
    musicName = name; musicVol = vol
    if (!soundOn || !p0.music) return
    try { if (name) p0.music.play(`assets/music/${name}.mp3`, { volume: vol, loop: true }); else p0.music.stop() } catch (e) { /* none */ }
  }
  let windId = 0
  function wakeSound() {
    if (soundOn) return
    soundOn = true
    p0.hud(helpText(p0))
    const n = musicName; musicName = null
    if (n) G.music(n, musicVol)
    try { windId = p0.sound.play('assets/music/amb_wind_loop.mp3', { volume: 0.22, loop: true }) || 0 } catch (e) { windId = 0 }
  }

  // ------------------------------------------------------------------ time control (TimeController.cs)
  const timeFx = []
  G.hitStop = (seconds = 0.045, scale = 0.06) => timeFx.push({ t: 0, d: seconds, s: scale, ease: 0 })
  G.slowMo = (seconds = 2.4, scale = 0.18, easeFrac = 0.35) => timeFx.push({ t: 0, d: seconds, s: scale, ease: easeFrac })
  function tickTime(rdt) {
    let s = 1
    for (let i = timeFx.length - 1; i >= 0; i--) {
      const f = timeFx[i]
      f.t += rdt
      if (f.t >= f.d) { timeFx.splice(i, 1); continue }
      let k = f.s
      if (f.ease > 0) { const e0 = f.d * (1 - f.ease); if (f.t > e0) k = f.s + (1 - f.s) * ((f.t - e0) / (f.d - e0)) }
      s = Math.min(s, k)
    }
    G.timeScale = s
  }

  // ------------------------------------------------------------------ camera shake (CameraShake.cs): trauma + kick spring
  const shake = { trauma: 0, kp: new THREE.Vector3(), kv: new THREE.Vector3() }
  G.shake = amount => { shake.trauma = clamp01(shake.trauma + amount) }
  G.kick = (pitchDeg, yawDeg, rollDeg) => { shake.kv.x += pitchDeg * 18; shake.kv.y += yawDeg * 18; shake.kv.z += rollDeg * 18 }
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _off = new THREE.Vector3()
  function applyShake(rdt) {
    shake.trauma = Math.max(0, shake.trauma - 1.4 * rdt)
    const k = shake.kp, v = shake.kv
    v.x += (-k.x * 220 - v.x * 24) * rdt; v.y += (-k.y * 220 - v.y * 24) * rdt; v.z += (-k.z * 220 - v.z * 24) * rdt
    k.addScaledVector(v, rdt)
    const t2 = shake.trauma * shake.trauma, tt = G.rt * 26
    const n = (a, b) => (perlin(tt + a, b) - 0.5) * 2
    _off.set(n(0, 1.3), n(5.1, 2.7), n(9.7, 4.1)).multiplyScalar(t2 * 0.16)
    _off.applyQuaternion(camera.quaternion)
    camera.position.addScaledVector(_off, S)
    const D = Math.PI / 180
    _e.set((n(13, 7) * 1.2 * t2 + k.x) * D, (n(17, 3) * 1.2 * t2 + k.y) * D, (n(21, 5) * 2.2 * t2 + k.z) * D, 'YXZ')
    camera.quaternion.multiply(_q.setFromEuler(_e))
  }

  // ------------------------------------------------------------------ build the modules
  const step = (f, label) => p0.loading(f, label)
  G.assets = createAssets(p0, { lite })
  G.assets.setRenderer(renderer)
  G.hud = createHud(G)
  G.fx = createFx(G)
  G.world = createWorld(G)
  step(0.08, 'raising the outpost')
  await G.world.build()
  if (lite) { // software renderer (the review): no shadow pass, a shorter view
    renderer.shadowMap.enabled = false
    if (G.world.sun) G.world.sun.castShadow = false
    camera.far = 300 * S
    camera.updateProjectionMatrix()
  }
  const fogDensity = (G.world.fogDensityGame || 0.0105) / S
  if (scene.fog && scene.fog.isFogExp2) scene.fog.density = fogDensity
  step(0.4, 'waking the Hive')
  G.enemies = createEnemies(G)
  G.towers = createTowers(G)
  G.player = createPlayer(G)
  G.weapons = createWeapons(G)
  G.run = createRun(G)
  await G.enemies.load({ warm: true })
  step(0.6, 'arming the turrets')
  await G.towers.load?.()
  await G.fx.load?.()
  step(0.7, 'calling your fighter')
  // fighters: the player's own fighter entity when they have made one (this lot's entity kind), the Foxfire Ronin,
  // the Outpost Guard. Picked on the title screen; the procedural trooper rig drives whichever body (fighter.js).
  const roster = [
    { id: 'ronin', name: 'Foxfire Ronin', sub: 'The Ink Fox in starship armour', url: p0.asset('assets/fighters/ronin.glb'), pic: p0.asset('assets/fighters/ronin.png') },
    { id: 'guard', name: 'Outpost Guard', sub: 'Frontier trooper of the Core', url: p0.asset('assets/fighters/guard.glb'), pic: p0.asset('assets/fighters/guard.png') },
  ]
  // the "+" tile: how to bring your own (the platform's hint names this game); shown whenever the lot takes fighters
  let fighterHint = '', plusText = '', plusOpen = false, picV = 0
  try {
    const E = p0.entities
    let mine = E && E.kind && E.mine ? E.mine() : null
    if (mine && typeof mine.then === 'function') mine = await mine
    // this lot takes fighters (kind "hive-adapt"), so the "+" is always there; the platform's hint names the game exactly
    const ask = String(E && E.hint || 'Ask your AI agent: make me a fighter for Hive Adapt').replace(/[.\s]+$/, '')
    const am = /^ask your (?:ai )?agent:?\s*(.+)$/i.exec(ask)
    const req = am ? 'ask your AI agent "' + am[1] + '"' : ask
    if (mine && mine.model && mine.status !== 'needs_update') {
      roster.unshift({ id: 'mine', name: String(mine.name || 'Your fighter').slice(0, 32), sub: 'Your own fighter', url: mine.model, map: mine.data && mine.data.skeleton, pic: mine.picture || null, mine: true })
      plusText = 'New look? Just ' + req + ' again: the new one replaces yours here once it passes review.'
    } else {
      fighterHint = ask
      plusText = 'Your own fighter, any look you like: ' + req + '. Your agent builds it, the review checks it, and it shows up here marked YOURS.'
    }
    G.log('fighters: ' + roster.length + (E ? ', entities ' + (E.kind ? (E.kind.game || 'kind') : 'without a kind') + (mine ? ', yours: ' + (mine.status || 'live') : ', none of yours') : ', no entities API'))
  } catch (e) { G.log('entities', e && e.message || e) }
  if (!p0.entities) { fighterHint = ''; plusText = '' } // played outside Project 0 (the portfolio park): no custom fighters
  // portraits for the picker (the built-ins ship theirs; a player's fighter brings its own picture when it has one)
  for (const r of roster) {
    if (!r.pic || typeof createImageBitmap === 'undefined') continue
    ;(async () => {
      try {
        const res = await fetch(r.pic)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        r.img = await createImageBitmap(await res.blob())
        picV++
        events.emit('fighter')
      } catch (e) { G.log('fighter picture ' + r.id + ': ' + (e && e.message || e)) }
    })()
  }
  let fIndex = 0, fBusy = false
  G.fighters = {
    list: roster,
    current: () => roster[fIndex] || null,
    drop: e => { const i = roster.indexOf(e); if (i >= 0) roster.splice(i, 1); fIndex = 0 },
    card: () => (roster[fIndex] ? {
      id: roster[fIndex].id, name: roster[fIndex].name, sub: roster[fIndex].sub, pos: (fIndex + 1) + ' / ' + roster.length, hint: fighterHint,
      tiles: roster.map(r => ({ id: r.id, name: r.name, img: r.img || null, mine: !!r.mine })), index: fIndex,
      plus: plusText, plusOpen: plusOpen && !!plusText, picV,
    } : undefined),
    pick(i) { plusOpen = false; if (i === fIndex) { events.emit('fighter'); return } G.fighters.cycle(i - fIndex) },
    togglePlus() { plusOpen = !plusOpen; events.emit('fighter') },
    async cycle(d) {
      if (fBusy || roster.length < 2) return
      fBusy = true
      const prev = roster[fIndex]
      fIndex = (fIndex + d + roster.length) % roster.length
      const next = roster[fIndex]
      try { await G.player.setFighter(next) } catch (e) {
        G.log('fighter ' + next.id + ' unusable: ' + (e && e.message || e))
        G.fighters.drop(next)
        fIndex = Math.max(0, roster.indexOf(prev))
      }
      fBusy = false
      events.emit('fighter')
    },
  }
  await G.player.load?.()
  await G.weapons.load?.()
  await G.run.load?.()
  G.net = createNet(G)
  if (G.hud.load) { try { await G.hud.load() } catch (e) { G.log('hud fonts', e) } }
  step(0.82, 'sighting the Hive')

  // ------------------------------------------------------------------ HUD placement
  function fit() {
    G.hud.resize?.(p0.width, p0.height, p0.pixelRatio || 1)
    camera.aspect = Math.max(0.2, p0.width / Math.max(1, p0.height))
    camera.updateProjectionMatrix()
    G.hud.fit?.(camera)
  }
  camera.add(G.hud.object)
  fit()
  p0.on('resize', fit)
  G.touch = false
  if (phone) { G.touch = true; G.hud.touchButtons?.(true) }

  // ------------------------------------------------------------------ input
  function freshInput() {
    return {
      move: { x: 0, y: 0 }, sprint: false, look: { dx: 0, dy: 0 }, fireHeld: false, aimHeld: false,
      pressed: new Set(), // edge-triggered action names this frame: jump dodge reload interact alt ready gear guide pause weapon1 weapon2 next prev fire fireUp aimToggle
      wheel: 0, touch: false, locked: false,
    }
  }
  const KEYMAP = {
    Space: 'jump', KeyC: 'dodge', ControlLeft: 'dodge', KeyR: 'reload', KeyE: 'interact', KeyQ: 'alt', KeyG: 'ready', KeyB: 'gear',
    KeyH: 'guide', KeyP: 'pause', Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'item3', Digit4: 'item4', Digit5: 'item5', KeyF1: 'skipTutorial', F1: 'skipTutorial',
  }
  const pressed = new Set()
  let lookX = 0, lookY = 0, wheel = 0
  let mouseFire = false, mouseAim = false, touchFire = false, touchAim = false, aimToggled = false
  const touchHeld = new Map()
  // Browsers send pointerdown/pointerup only for the FIRST mouse button; pressing or releasing a second one while the
  // first is held (fire while aiming with RMB) arrives as a pointermove with new 'buttons' bits. Read the bits on
  // every mouse event so aim + fire works in any order.
  function syncMouse(e) {
    if (!e || e.touch || typeof e.buttons !== 'number') return
    const f = (e.buttons & 1) !== 0, a = (e.buttons & 2) !== 0
    const live = G.state === 'run' && !G.hud.blocking?.()
    if (f && !mouseFire && live) { mouseFire = true; pressed.add('fire') }
    else if (!f && mouseFire) { mouseFire = false; pressed.add('fireUp') }
    if (a && !mouseAim && live) mouseAim = true
    else if (!a && mouseAim) mouseAim = false
  }
  p0.on('keydown', e => {
    if (!e || !e.code) return
    wakeSound()
    G.touch = false
    if (e.repeat) return
    if (G.hud.key?.(e.code)) return
    const a = KEYMAP[e.code]
    if (a) pressed.add(a)
  })
  p0.on('pointerdown', e => {
    if (!e) return
    wakeSound()
    G.touch = !!e.touch
    if (e.touch) {
      const id = G.hud.touchAt?.(e.x, e.y)
      if (id) { G.hud.touchPress?.(id, true); touchHeld.set(id, true); onTouchButton(id, true); return }
    }
    if (G.hud.click?.(e.x, e.y)) return
    if (G.state !== 'run' || G.hud.blocking?.()) return
    if (!e.touch && !p0.input.pointer.locked) { try { p0.input.lockPointer() } catch (err) { /* refused: drag to look */ } }
    if (!e.touch) {
      if (e.button === 0) { mouseFire = true; pressed.add('fire') }
      if (e.button === 2) mouseAim = true
    }
  })
  p0.on('pointerup', e => {
    if (!e) return
    if (e.touch) {
      for (const id of touchHeld.keys()) { G.hud.touchPress?.(id, false); onTouchButton(id, false) }
      touchHeld.clear()
      return
    }
    if (e.button === 0) { if (mouseFire) pressed.add('fireUp'); mouseFire = false }
    if (e.button === 2) mouseAim = false
    syncMouse(e)
  })
  p0.on('pointermove', e => {
    if (!e) return
    G.hud.hover?.(e.x, e.y)
    syncMouse(e)
    if (G.state !== 'run') return
    const locked = p0.input.pointer.locked
    if (locked || e.buttons || e.touch) {
      const k = e.touch ? 2.2 : 1
      if (!(e.touch && touchHeld.size)) { lookX += (e.dx || 0) * k; lookY += (e.dy || 0) * k }
    }
  })
  p0.on('wheel', e => { if (e && e.dy) wheel += Math.sign(e.dy) })
  p0.on('pointerlock', locked => { G.input.locked = !!locked })
  function onTouchButton(id, down) {
    if (id === 'fire') { touchFire = down; if (down) pressed.add('fire'); else pressed.add('fireUp') }
    else if (id === 'aim') { if (down) aimToggled = !aimToggled }
    else if (down) {
      const map = { jump: 'jump', dodge: 'dodge', reload: 'reload', e: 'interact', q: 'alt', pause: 'pause', g: 'ready', ready: 'ready', gear: 'gear', swap: 'next' }
      if (map[id]) pressed.add(map[id])
    }
  }
  function readInput() {
    const k = p0.input
    const inp = G.input
    let x = 0, y = 0
    if (k.isDown('KeyA') || k.isDown('ArrowLeft')) x -= 1
    if (k.isDown('KeyD') || k.isDown('ArrowRight')) x += 1
    if (k.isDown('KeyW') || k.isDown('ArrowUp')) y += 1
    if (k.isDown('KeyS') || k.isDown('ArrowDown')) y -= 1
    const len = Math.hypot(x, y)
    if (len > 1) { x /= len; y /= len }
    inp.move.x = x; inp.move.y = y
    inp.sprint = k.isDown('ShiftLeft') || k.isDown('ShiftRight')
    inp.look.dx = lookX; inp.look.dy = lookY; lookX = 0; lookY = 0
    inp.wheel = wheel; wheel = 0
    if (inp.wheel) pressed.add(inp.wheel > 0 ? 'next' : 'prev')
    inp.fireHeld = mouseFire || touchFire
    inp.aimHeld = mouseAim || aimToggled
    inp.touch = G.touch
    inp.locked = !!(k.pointer && k.pointer.locked)
    inp.pressed = new Set(pressed)
    pressed.clear()
    if (G.hud.blocking?.()) { inp.move.x = inp.move.y = 0; inp.fireHeld = false; inp.aimHeld = false; inp.sprint = false; inp.look.dx = inp.look.dy = 0 }
  }
  G.setAimToggle = v => { aimToggled = !!v }
  G.releaseMouse = () => { mouseFire = false; mouseAim = false; try { p0.input.unlockPointer() } catch (e) { /* none */ } }

  // ------------------------------------------------------------------ score + table
  let runStartedAt = 0
  G.markRunStart = () => { runStartedAt = G.rt }
  G.postScore = n => {
    const minPlay = (p0.game?.minSeconds || 10) + 1
    if (!(n > 0) || G.rt - runStartedAt < minPlay) return false
    G.lastWeek = null
    try { p0.score(Math.round(n)) } catch (e) { G.log('score failed', e) }
    return true
  }
  G.table = () => p0.table || []
  G.prizeNote = () => prizeNote(p0)
  G.prizePlaces = () => (prizeNote(p0) ? (p0.game.places || 3) : 0)
  // the answer to this run's score: its place among the players this week (the owner's row does not count)
  G.lastWeek = null
  G.weekLine = () => {
    const w = G.lastWeek
    if (!w || !w.ok || !(w.place > 0)) return ''
    const n = G.prizePlaces()
    return '#' + w.place + ' THIS WEEK' + (n && w.place <= n ? '  ·  IN THE PRIZES' : '')
  }
  p0.on('table', top => events.emit('table', top || []))
  p0.on('reward', r => {
    if (r && r.kind === 'score') G.lastWeek = { ok: !!r.ok, place: +r.place || 0, best: r.best }
    events.emit('reward', r)
  })
  p0.on('update', () => G.hud.toast?.('A new version of Hive Adapt is out: leave and enter again to play it', 'info'))

  // ------------------------------------------------------------------ warm-up: compile everything before the first frame
  step(0.9, 'warming the shaders')
  const tw = performance.now()
  G.state = 'title'
  G.run.title?.()
  G.player.placeCamera?.(0)
  applyCamera()
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera)
    renderer.render(scene, camera)
    // draw every pooled / hidden object once while the loading screen is up: software GPUs build each shader on its first
    // draw, which otherwise lands as a long frame the first time a bug, turret tier or screen appears
    const shown = [], unculled = []
    root.traverse(o => {
      if (!o.visible) { o.visible = true; shown.push(o) }
      if ((o.isMesh || o.isPoints || o.isLine) && o.frustumCulled) { o.frustumCulled = false; unculled.push(o) }
    })
    renderer.render(scene, camera)
    for (const o of shown) o.visible = false
    for (const o of unculled) o.frustumCulled = true
    renderer.render(scene, camera)
  } catch (e) { G.log('warm-up', e) }
  const warmMs = performance.now() - tw
  G.log(`v${VERSION} ready in ${(performance.now() - t0).toFixed(0)} ms (warm-up ${warmMs.toFixed(0)} ms), renderer "${gpuName.slice(0, 60)}"${lite ? ' (lite)' : ''}`)
  step(1, 'hold the Core')

  // ------------------------------------------------------------------ camera: rig output (game space) -> lot space
  function applyCamera() {
    camera.position.copy(G.cam.pos).multiplyScalar(S)
    camera.quaternion.copy(G.cam.quat)
    if (Math.abs(camera.fov - G.cam.fov) > 0.01) { camera.fov = G.cam.fov; camera.updateProjectionMatrix(); G.hud.fit?.(camera) }
  }

  // ------------------------------------------------------------------ auto light: drop resolution if frames are slow
  let slowAcc = 0, frames = 0, scaled = false, programsAt = 0
  function watchFrames(rdt) {
    frames++
    if (frames % 30 === 0) { // shader programs made after the warm-up are first-time stalls: name them so they can be pre-warmed
      const progs = renderer.info.programs || []
      if (programsAt && progs.length > programsAt) G.log(`new shader programs at frame ${frames}: ` + progs.slice(programsAt).map(p => p.name || p.cacheKey?.slice(0, 40)).join(', '))
      programsAt = progs.length
    }
    if (frames < 30 || scaled || software) return // software already renders at half resolution: a resize would redraw every HUD texture at once
    slowAcc = slowAcc * 0.97 + (rdt > 0.05 ? 1 : 0) * 0.03
    if (slowAcc > 0.5) {
      scaled = true
      try { renderer.setPixelRatio(Math.max(0.5, renderer.getPixelRatio() * 0.6)); fit() } catch (e) { /* shell owns it */ }
      G.log('slow frames: render scale reduced')
    }
  }

  // ------------------------------------------------------------------ the loop
  const _me = new THREE.Vector3()
  const prof = {}
  let profT = 0, slowLogs = 0
  function mark(name) { const t = performance.now(); prof[name] = (prof[name] || 0) + (t - profT); profT = t }
  p0.loop((dtRaw) => {
    const rdt = Math.min(0.1, Math.max(0, dtRaw || 0))
    G.rdt = rdt
    G.rt += rdt
    frameSounds = 0
    tickTime(rdt)
    const dt = G.paused ? 0 : Math.min(0.05, rdt * G.timeScale)
    G.dt = dt
    G.time += dt
    G.markers.length = 0
    readInput()
    const tf = performance.now()
    profT = tf
    try {
      G.net.update(dt, rdt); mark('net')
      if (G.paused && G.net.multi) G.paused = false // co-op: the Hive never waits
      G.run.update?.(dt, rdt); mark('run')
      if (!G.paused) {
        G.player.update?.(dt, rdt); mark('player')
        G.weapons.update?.(dt, rdt); mark('weapons')
        G.enemies.update?.(dt); mark('enemies')
        G.towers.update?.(dt, rdt); mark('towers')
      }
      G.world.update(dt); mark('world')
      G.fx.update?.(dt, rdt); mark('fx')
      G.player.updateCamera?.(dt, rdt); mark('camera')
    } catch (e) {
      G.log('frame failed: ' + (e && e.stack || e))
    }
    applyCamera()
    applyShake(rdt)
    if (G.player.pos) {
      G.listener.copy(G.player.pos)
      _me.copy(G.player.pos).multiplyScalar(S)
      const L = p0.lot || { width: 12, depth: 12, height: 19 }
      _me.x = clamp(_me.x, -L.width / 2, L.width / 2); _me.z = clamp(_me.z, -L.depth / 2, L.depth / 2); _me.y = clamp(_me.y + 1.6, 0, L.height)
      if (p0.me.position && p0.me.position.set) p0.me.position.copy(_me)
    }
    G.hud.markers?.(G.markers)
    G.hud.update?.(rdt); mark('hud')
    watchFrames(rdt)
    const spent = performance.now() - tf
    if (spent > 120 && slowLogs < 6) { slowLogs++; G.log(`slow frame ${spent.toFixed(0)} ms: ` + Object.entries(prof).filter(e => e[1] > 4).map(e => e[0] + ' ' + e[1].toFixed(0)).join(', ')) }
    for (const k in prof) prof[k] = 0
  })
  p0.on('end', () => { G.sfxStop(windId) })
}
