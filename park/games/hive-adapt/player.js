// Hive Adapt (Project 0 port): the PLAYER module. The fighter (the visitor's own Project 0 avatar, or a procedural
// stand-in trooper), its movement (PlayerController.cs), stamina (PlayerStamina.cs), armor (PlayerArmor.cs), death and
// respawn (PlayerRespawn.cs), footsteps (Footsteps.cs), jump pads (JumpPad.cs) and the over-the-shoulder camera rig
// (CameraRig.cs) that also computes G.aim, the camera-centre aim ray every other module shoots along.
// Numbers: hive-spec/player-weapons.md §1 and §5.1. Everything in game space (Unity metres, north = -Z) under G.root.
//
// API (createPlayer(G)):
//   load()                      avatar (p0.avatars.load(p0.me.id) -> GLTFLoader) or the stand-in, the weapon socket
//   update(dt, rdt)             movement, stamina, dodge, jump pads, death/respawn, HUD vitals, body animation
//   updateCamera(dt, rdt)       camera rig -> G.cam (game space), G.aim, then poses the model, the weapon socket and the arm IK
//   placeCamera()               snap the camera (warm-up)
//   hurt(amount, enemy, info)   enemies call this: dodge i-frames, tower shots ignored, plating x0.8, armor soaks 85 %
//   reset(stats)                new run: (0, 7, -7) Unity, full HP / stamina, armor = mods.armorStart, gear cleared
//   addRecoil(pitchDeg, yawDeg) camera recoil (climbs, never recovers: CameraRig.cs)
//   addArmor(n) -> added, refillStamina(), setGear(id, on) ('speed' | 'plating' | 'stamina'), cancelSprint()
//   teleport(pos, bearingDeg), respawnNow(), kill() (tests), setAvatarBytes(bytes) (async: swap in a GLB avatar)
// Fields: pos (feet), vel, yaw (body rotation.y), camYaw (camera rotation.y), camPitch (camera rotation.x, + = up),
//   camYawDeg (bearing, clockwise from north), camPitchDeg (Unity: + = down), alive, state 'alive'|'dead'|'respawning',
//   hp, maxHp, armor, armorMax, stamina, staminaMax, winded, grounded, sprinting, aiming, dodging, invulnerable, launched,
//   deaths, lastKiller (enemy kind), respawnLeft, gear { speed, plating, stamina }, aimBlend, socket (weapon mount, under G.root),
//   avatar (true when the visitor's own model is drawn), handBone, mount ('shoulder' stand-in | 'hand' avatar hand bone | 'float').
// G.aim (every frame): { origin, dir, point, distance, enemyHit, weak, part, camPos } — origin is the camera ray moved
//   forward to the chest plane; point = first enemy (enemies.raycast) or shot-blocking geometry (world.raycastEnv) in 200 m.
// Events: playerDamaged(final, enemy, info), playerEvaded(enemy, info), playerDied(enemy), playerRespawned, jumpPad(pad),
//   playerMoved(metres, ~every 0.5 m), playerJumped, playerDodged, playerLanded(impact).
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { U, DEG, clamp, clamp01, lerp, smooth01 } from './u.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { buildStandIn } from './standin.js'
import { prepareFighter, createRetarget } from './fighter.js'
import { createGait, poseLegs, stepLength } from './gait.js'

// PlayerController.cs / PlayerStamina.cs / PlayerRespawn.cs / PlayerArmor.cs / Footsteps.cs (player-weapons.md §1)
const P = {
  jog: 4.2, strafe: 3.5, back: 2.8, sprint: 6.4, aim: 2.1,
  hipTwist: 62, hipTwistBack: 40, hipTwistAim: 32, twistRate: 320, turnSpeed: 720,
  accel: 14, decel: 18, airControl: 0.3, gravity: -22,
  jumpV: Math.sqrt(2 * 22 * 1.05), jumpCost: 12, coyote: 0.12,
  dodgeDist: 4.2, dodgeDur: 0.9, dodgeCd: 1.5, dodgeCost: 25, iStart: 0.06, iEnd: 0.5, dodgeTurn: 2400, dodgeBlend: 0.15,
  radius: 0.35, height: 1.8,
  stamina: 100, drain: 16, regen: 26, regenDelay: 0.9, recover: 30,
  respawn: 10, getUp: 1.8, hp: 100, armorMax: 100, absorb: 0.85,
  padCooldown: 0.8, walkStride: 0.72, sprintStride: 1.05, stepVol: 0.45,
}
// CameraRig.cs (player-weapons.md §1.7)
const CAM = {
  height: 1.6, dist: 3.9, aimDist: 2.4, shoulder: 0.78, aimShoulder: 0.7, fov: 60, aimFov: 44, sprintFov: 67,
  pitchMin: -60, pitchMax: 70, pitchStart: 8, radius: 0.22, sens: 0.12, aimShare: 0.65, scopeShare: 0.32,
  orbitR: 12.5, orbitH: 2.4, orbitRate: 2.2, touchLook: 1.2, assistCone: 8, assistRate: 3.5, assistMax: 40,
}
const START = U(0, 7, -7)
const RESPAWN = U(0, 7, -4.6)
const AIM_RANGE = 200
// the gun mount in the chest bone's frame: low and to the right at the hip, in the shoulder pocket when aiming down sights
const POCKET_HIP = new THREE.Vector3(-0.245, 0.12, 0.16)
const POCKET_ADS = new THREE.Vector3(-0.185, 0.25, 0.14)
const CARRY = new THREE.Vector3(-0.19, -0.02, 0.2)
const HAND_RE = /(^|[^a-z])(right.?hand|hand[._ -]?r)([^a-z]|$)|righthand/i

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)
const deltaDeg = (a, b) => { let d = ((b - a) % 360 + 540) % 360 - 180; return d === -180 ? 180 : d }
const towardDeg = (a, b, step) => { const d = deltaDeg(a, b); return Math.abs(d) <= step ? b : a + Math.sign(d) * step }
const fwdOf = (yawDeg, out) => out.set(Math.sin(yawDeg * DEG), 0, -Math.cos(yawDeg * DEG))
const rightOf = (yawDeg, out) => out.set(Math.cos(yawDeg * DEG), 0, Math.sin(yawDeg * DEG))
const rotOf = yawDeg => Math.PI - yawDeg * DEG // three rotation.y for a +Z-facing model facing this bearing
const pick = arr => arr[(Math.random() * arr.length) | 0]

/** player level XP: XpToAdvance(L) = round(350 x 1.16^(L-1)) (ProgressionData.cs) */
const XP_TOTAL = [0, 0]
for (let L = 1; L < 31; L++) XP_TOTAL[L + 1] = XP_TOTAL[L] + Math.round(350 * Math.pow(1.16, L - 1))

export function createPlayer(G) {
  const UP = new THREE.Vector3(0, 1, 0)
  // scratch (no per-frame allocation)
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3()
  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _wish = new THREE.Vector3(), _tgt = new THREE.Vector3(), _cv = new THREE.Vector3()
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _e1 = new THREE.Euler(0, 0, 0, 'YXZ')
  const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _dir = new THREE.Vector3(), _pp = new THREE.Vector3()
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _gr = new THREE.Vector3(), _gl = new THREE.Vector3()
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qL = new THREE.Quaternion(), _poleR = new THREE.Vector3(), _poleL = new THREE.Vector3()

  const player = {
    pos: START.clone(), vel: new THREE.Vector3(), yaw: Math.PI, camYaw: 0, camPitch: -CAM.pitchStart * DEG, camYawDeg: 0, camPitchDeg: CAM.pitchStart,
    alive: true, state: 'alive', hp: P.hp, maxHp: P.hp, armor: 0, armorMax: P.armorMax, stamina: P.stamina, staminaMax: P.stamina, winded: false,
    grounded: true, sprinting: false, aiming: false, dodging: false, invulnerable: false, launched: false, deaths: 0, lastKiller: null,
    respawnLeft: 0, gear: { speed: false, plating: false, stamina: false }, aimBlend: 0, sprintBlend: 0, socket: null, avatar: false, handBone: null,
    bodyYawDeg: 0, planarSpeed: 0, dodgeCooldown: 0, mount: 'shoulder',
  }

  // ------------------------------------------------------------------ internal state
  const planar = new THREE.Vector3()
  let vy = 0, ctrlGrounded = true, lastGroundedT = 0, airTime = 0, hipOffset = 0, sprintCancelled = false
  let dodgeT = 0, dodgeReadyAt = 0, padReadyAt = 0, regenAt = 0, staminaFlash = false
  const dodgeDir = new THREE.Vector3()
  let getUpLeft = 0, deathT = 0, movedAcc = 0, stepAcc = 0, stepLeft = false
  let recoilP = 0, recoilY = 0
  const cam = { dist: CAM.dist, fov: CAM.fov, pivotY: START.y + CAM.height, orbit: 0, mode: 'orbit', blend: 1, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion() }
  const camRight = new THREE.Vector3(), camFwd = new THREE.Vector3()
  G.aim = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), point: new THREE.Vector3(0, 7, -20), distance: 20, enemyHit: null, weak: false, part: undefined, camPos: new THREE.Vector3() }

  // visuals: vroot (pos, body yaw) -> pivot (rolls, leans, topples) -> offset -> model
  const vroot = new THREE.Group(); vroot.name = 'Player'
  const pivot = new THREE.Group(), offset = new THREE.Group()
  vroot.add(pivot); pivot.add(offset)
  const socket = new THREE.Group(); socket.name = 'WeaponSocket'
  player.socket = socket
  let standin = null, avatar = null, fighter = null, pocketK = 1, camWide = 0
  const fighterCache = new Map()
  const gait = createGait()
  const anim = {
    phase: 0, moveAmt: 0, airW: 0, sprintW: 0, aimW: 1, carryW: 0, tuck: 0, landDip: 0, landDipV: 0, crouch: 0,
    flinch: new THREE.Vector3(), flinchV: new THREE.Vector3(), fwdC: 1, sideC: 0, t: 0,
  }

  // ------------------------------------------------------------------ helpers
  const ev = (name, ...a) => { try { G.events && G.events.emit(name, ...a) } catch (e) { /* listener */ } }
  const sfx = (name, o) => (G.sfx ? G.sfx(name, o) : 0)
  const fx = () => G.fx || {}
  const hud = () => G.hud || {}
  const mods = () => { const m = G.run && G.run.mods; return m && typeof m === 'object' ? m : {} }
  const blocked = () => !!(G.hud && G.hud.blocking && G.hud.blocking())
  const speedMul = () => { const s = player.gear.speed; return typeof s === 'number' ? s : s ? 1.12 : 1 }
  const takenScale = () => { const p = player.gear.plating; return typeof p === 'number' ? p : p ? 0.8 : 1 }
  const regenMul = () => (player.gear.stamina ? 1.3 : 1)
  function computeMax() {
    const m = mods()
    const hpBonus = num(m.maxHp, 0)
    const maxHp = hpBonus > 100 ? hpBonus : P.hp + hpBonus
    if (maxHp !== player.maxHp) { if (maxHp > player.maxHp && player.state !== 'dead') player.hp += maxHp - player.maxHp; player.maxHp = maxHp; player.hp = Math.min(player.hp, maxHp) }
    const st = P.stamina * (1 + num(m.maxStamina, 0)) + (player.gear.stamina ? 40 : 0)
    if (st !== player.staminaMax) { player.staminaMax = st; player.stamina = Math.min(player.stamina, st) }
  }
  function speedForAngle(a) { return a <= 90 ? lerp(P.jog, P.strafe, a / 90) : lerp(P.strafe, P.back, (a - 90) / 90) }
  function toGame(obj, out) { obj.getWorldPosition(out); return G.root.worldToLocal(out) }

  // ------------------------------------------------------------------ stamina (PlayerStamina.cs)
  const hasStamina = c => !player.winded && player.stamina >= c
  function trySpend(c) {
    if (!hasStamina(c)) { staminaFlash = true; return false }
    player.stamina = clamp(player.stamina - c, 0, player.staminaMax)
    regenAt = G.time + P.regenDelay
    return true
  }
  function drain(dt) {
    player.stamina = clamp(player.stamina - P.drain * dt, 0, player.staminaMax)
    regenAt = G.time + P.regenDelay
    if (player.stamina <= 0.01) player.winded = true
  }
  function tickStamina(dt) {
    if (G.time < regenAt || player.stamina >= player.staminaMax) return
    player.stamina = Math.min(player.staminaMax, player.stamina + P.regen * regenMul() * dt)
    if (player.winded && player.stamina >= P.recover) player.winded = false
  }

  // ------------------------------------------------------------------ load: avatar or stand-in, socket
  async function load() {
    G.root.add(vroot)
    G.root.add(socket)
    const F = G.fighters
    for (let k = 0; F && k < 4 && F.current(); k++) {
      const e = F.current()
      try { await setFighter(e); return } catch (err) { G.log && G.log('fighter ' + e.id + ' unusable: ' + (err && err.message || err)); F.drop(e) }
    }
    let bytes = null
    try {
      const p0 = G.p0, id = p0 && p0.me && p0.me.id
      if (p0 && p0.avatars && p0.avatars.load && id != null) bytes = await p0.avatars.load(id)
    } catch (e) { G.log && G.log('avatar load failed: ' + (e && e.message || e)) }
    if (bytes) {
      try { await setAvatarBytes(bytes); return } catch (e) { G.log && G.log('avatar unusable, stand-in instead: ' + (e && e.message || e)) }
    }
    useStandIn()
    placeVisual(0)
  }
  function clearModel() {
    if (fighter) { offset.remove(fighter.prep.wrap); fighter = null }
    pocketK = 1; camWide = 0
    if (standin) { offset.remove(standin.object); standin.mesh.geometry.dispose(); standin.lights.geometry.dispose(); standin = null }
    if (avatar) { offset.remove(avatar.wrap); avatar.mixer.stopAllAction(); avatar = null }
    player.avatar = false; player.handBone = null
  }
  function useStandIn() {
    clearModel()
    standin = buildStandIn()
    offset.add(standin.object)
    player.mount = 'shoulder'
  }
  /**
   * play as a humanoid fighter: entry { id, name, url | bytes, map? } (map: { role: boneName } for unusual rigs).
   * The procedural trooper rig is rebuilt with the fighter's proportions and drives its bones (fighter.js).
   */
  async function setFighter(entry) {
    if (!entry) throw new Error('no fighter')
    const key = entry.id + '|' + (entry.url || '')
    let gltfP = fighterCache.get(key)
    if (!gltfP) {
      const loader = new GLTFLoader()
      if (entry.bytes) {
        let buf = entry.bytes
        if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        gltfP = loader.parseAsync(buf, '')
      } else gltfP = loader.loadAsync(entry.url)
      fighterCache.set(key, gltfP)
    }
    let gltf
    try { gltf = await gltfP } catch (e) { fighterCache.delete(key); throw e }
    const scene = SkeletonUtils.clone(gltf.scene || gltf.scenes[0])
    const prep = prepareFighter(scene, entry.map)
    clearModel()
    standin = buildStandIn({ meshless: true, joints: prep.joints })
    offset.add(standin.object)
    offset.add(prep.wrap)
    pivot.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0); offset.position.set(0, 0, 0); offset.scale.set(1, 1, 1)
    fighter = { entry, prep, retarget: createRetarget(prep, standin, offset) }
    pocketK = Math.min(1.35, Math.max(0.85, prep.shoulder / 0.205))
    camWide = clamp((prep.halfWidth || 0.36) - 0.36, 0, 0.32) // bulky fighters: the camera sits further out so the aim stays clear
    player.mount = 'shoulder'
    player.fighterId = entry.id
    placeVisual(0)
    return true
  }
  /** swap in a GLB avatar (bytes: ArrayBuffer | Uint8Array): normalised to 1.8 m, feet on the ground, idle/fly/fly_fast */
  async function setAvatarBytes(bytes) {
    let buf = bytes
    if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const gltf = await new GLTFLoader().parseAsync(buf, '')
    installAvatar(gltf)
    placeVisual(0)
    return player.avatar
  }
  function installAvatar(gltf) {
    const scene = gltf.scene || (gltf.scenes && gltf.scenes[0])
    if (!scene) throw new Error('no scene')
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const h = box.max.y - box.min.y
    if (!(h > 0.05) || !isFinite(h)) throw new Error('empty model')
    const s = P.height / h
    clearModel()
    const wrap = new THREE.Group(); wrap.name = 'Avatar'
    scene.scale.multiplyScalar(s)
    scene.position.multiplyScalar(s)
    scene.position.y -= box.min.y * s
    wrap.add(scene)
    let hand = null
    scene.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false }
      if ((o.isBone || o.type === 'Bone' || o.type === 'Object3D') && HAND_RE.test(o.name || '') && (!hand || o.name.length < hand.name.length)) hand = o
    })
    // a "hand" down at the feet (a quadruped's paw) would drag the gun along the ground: float it at the hip instead
    if (hand) { const hp = hand.getWorldPosition(new THREE.Vector3()); if (hp.y / P.height < 0.33) hand = null } // wrap space: feet at 0, 1.8 m tall
    const mixer = new THREE.AnimationMixer(scene)
    const clips = gltf.animations || []
    const find = n => clips.find(c => (c.name || '').toLowerCase() === n) || null
    const act = c => { if (!c) return null; const a = mixer.clipAction(c); a.setLoop(THREE.LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(0); a.play(); return a }
    const idleClip = find('idle') || clips[0] || null
    const flyClip = find('fly') || idleClip
    const fastClip = find('fly_fast') || flyClip
    const acts = { idle: act(idleClip) }
    acts.fly = flyClip === idleClip ? acts.idle : act(flyClip)
    acts.fast = fastClip === flyClip ? acts.fly : act(fastClip)
    acts.up = find('ascend') ? act(find('ascend')) : null
    acts.down = find('descend') ? act(find('descend')) : null
    const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * s
    // distinct actions (a missing clip falls back to another slot's action); slot -> index, the last index is a sink for none
    const uniq = []
    const slot = {}
    for (const k of ['idle', 'fly', 'fast', 'up', 'down']) {
      const ac = acts[k]
      if (!ac) { slot[k] = -1; continue }
      let i = uniq.indexOf(ac)
      if (i < 0) { uniq.push(ac); i = uniq.length - 1 }
      slot[k] = i
    }
    for (const k in slot) if (slot[k] < 0) slot[k] = uniq.length
    avatar = {
      wrap, scene, mixer, acts, uniq, slot, acc: new Float32Array(uniq.length + 1), scale: s, hand, w: { idle: 1, fly: 0, fast: 0, up: 0, down: 0 },
      float: new THREE.Vector3(-clamp(halfW * 0.85 + 0.1, 0.24, 0.6), 1.12, 0.14), clips: clips.map(c => c.name),
    }
    offset.add(wrap)
    player.avatar = true
    player.handBone = hand
    player.mount = hand ? 'hand' : 'float'
  }

  // ------------------------------------------------------------------ reset / teleport / gear
  function reset(stats = {}) {
    player.gear = { speed: false, plating: false, stamina: false }
    player.maxHp = 0; player.staminaMax = 0
    computeMax()
    player.hp = player.maxHp
    player.armor = clamp(num(stats.armor, num(mods().armorStart, 0)), 0, P.armorMax)
    player.stamina = player.staminaMax; player.winded = false
    player.deaths = num(stats.deaths, 0); player.lastKiller = null
    player.state = 'alive'; player.alive = true; player.respawnLeft = 0
    getUpLeft = 0; deathT = 0
    teleport(stats.pos || START, num(stats.bearing, 0))
    player.camPitchDeg = CAM.pitchStart
    recoilP = recoilY = 0
    dodgeReadyAt = 0; padReadyAt = 0; regenAt = 0
    socket.visible = true
    if (G.hud && G.hud.death) G.hud.death(null)
    cam.dist = CAM.dist
  }
  function teleport(p, bearingDeg = player.camYawDeg) {
    player.pos.copy(p)
    planar.set(0, 0, 0); vy = 0; player.vel.set(0, 0, 0)
    hipOffset = 0; player.launched = false
    endDodge(true)
    player.bodyYawDeg = bearingDeg; player.camYawDeg = bearingDeg
    ctrlGrounded = true; player.grounded = true; lastGroundedT = G.time
    cam.pivotY = p.y + CAM.height
    placeVisual(0)
  }
  function setGear(id, on = true) {
    player.gear[id] = on
    if (id === 'stamina' && on) { computeMax(); refillStamina() }
  }
  function refillStamina() { player.winded = false; player.stamina = player.staminaMax }
  function addArmor(n) { const b = player.armor; player.armor = clamp(player.armor + Math.max(0, n || 0), 0, P.armorMax); return player.armor - b }
  function cancelSprint() { player.sprinting = false; sprintCancelled = true }
  function addRecoil(p, y) { recoilP += p || 0; recoilY += y || 0 }

  // ------------------------------------------------------------------ damage (Health.ApplyDamage for the player)
  function hurt(amount, enemy, info) {
    if (!(amount > 0) || player.state === 'dead' || player.hp <= 0) return 0
    if (player.invulnerable) { ev('playerEvaded', enemy, info); return 0 }
    if (info && info.source === 'tower') return 0 // Friendly: turret fire never hurts the player
    let final = amount * takenScale()
    if (final <= 0) return 0
    if (player.armor > 0) {
      const soaked = Math.min(player.armor, final * P.absorb)
      player.armor -= soaked
      final -= soaked
      if (final <= 0.0001) return 0
    }
    player.hp = Math.max(0, player.hp - final)
    // hurt feedback (PlayerRespawn.OnDamaged, CombatFeedback.OnDamage)
    flinch(info && info.dir, final / 15)
    sfx(pick(['sfx_player_hurt_0', 'sfx_player_hurt_1']), { vol: 0.7 })
    if (G.shake) G.shake(clamp(final / 40, 0.12, 0.5))
    ev('playerDamaged', final, enemy, info)
    if (player.hp <= 0) die(enemy, info)
    return final
  }
  function flinch(dir, strength) {
    const k = clamp(strength, 0.2, 2)
    let lx = 0, lz = 1
    if (dir && dir.lengthSq && dir.lengthSq() > 1e-6) {
      fwdOf(player.bodyYawDeg, _v1); rightOf(player.bodyYawDeg, _v2)
      lz = dir.x * _v1.x + dir.z * _v1.z; lx = dir.x * _v2.x + dir.z * _v2.z
    }
    anim.flinchV.x += (Math.abs(lz) * 60 + 20) * k
    anim.flinchV.y += lx * 80 * k
    anim.flinchV.z += -lx * 60 * k
  }
  function die(enemy) {
    player.state = 'dead'; player.alive = false
    player.deaths++
    player.lastKiller = enemy ? enemy.kind || null : null
    player.respawnLeft = P.respawn
    player.sprinting = false; player.aiming = false
    endDodge(true)
    deathT = 0
    ev('playerDied', enemy)
  }
  function beginRespawn() {
    player.respawnLeft = 0
    player.state = 'respawning'; player.alive = true
    teleport(RESPAWN, player.camYawDeg)
    player.hp = player.maxHp
    getUpLeft = P.getUp
    if (fx().burst) fx().burst('respawn', RESPAWN, {})
    sfx('sfx_respawn', { pos: RESPAWN, vol: 0.9 })
    ev('playerRespawned')
  }
  function respawnNow() { if (player.state === 'dead') beginRespawn() }
  function kill() { if (player.state !== 'dead') { player.hp = 0; die(null) } }

  // ------------------------------------------------------------------ dodge roll
  function beginDodge(mx, my) {
    // the roll direction: move input rotated by the camera yaw only; no input rolls straight back
    if (mx * mx + my * my > 0.01) { const l = Math.hypot(mx, my); fwdOf(player.camYawDeg, _f); rightOf(player.camYawDeg, _r); dodgeDir.copy(_r).multiplyScalar(mx / l).addScaledVector(_f, my / l) }
    else fwdOf(player.camYawDeg, dodgeDir).negate()
    dodgeDir.y = 0; dodgeDir.normalize()
    player.dodging = true; dodgeT = 0
    player.sprinting = false
    if (G.weapons && G.weapons.cancelReload) G.weapons.cancelReload()
    sfx(pick(['sfx_roll_0', 'sfx_roll_1']), { pos: player.pos, vol: 0.8, rate: 0.95 + Math.random() * 0.1 })
    if (fx().burst) fx().burst('dodgeDust', player.pos, { dir: dodgeDir })
    ev('playerDodged')
  }
  function tickDodge(dt) {
    const um = clamp01((dodgeT + dt * 0.5) / P.dodgeDur) // speed at the middle of the step: exactly 4.2 m at any frame rate
    dodgeT += dt
    planar.copy(dodgeDir).multiplyScalar(2 * P.dodgeDist / P.dodgeDur * (1 - um))
    const rollFace = Math.atan2(dodgeDir.x, -dodgeDir.z) / DEG
    const remaining = P.dodgeDur - dodgeT
    if (remaining > P.dodgeBlend) player.bodyYawDeg = towardDeg(player.bodyYawDeg, rollFace, P.dodgeTurn * dt)
    else {
      let k = 1 - clamp01(remaining / P.dodgeBlend)
      k = k * k * (3 - 2 * k)
      player.bodyYawDeg = rollFace + deltaDeg(rollFace, player.camYawDeg) * k
    }
    player.invulnerable = dodgeT >= P.iStart && dodgeT <= P.iEnd
    if (dodgeT >= P.dodgeDur) endDodge()
  }
  function endDodge(silent) {
    if (!player.dodging) return
    player.dodging = false
    player.invulnerable = false
    if (!silent) dodgeReadyAt = G.time + P.dodgeCd
    hipOffset = deltaDeg(player.camYawDeg, player.bodyYawDeg)
  }

  // ------------------------------------------------------------------ update (PlayerController.Update + respawn + stamina)
  function update(dt, rdt) {
    if (!standin && !avatar) return
    anim.t += dt
    if (G.state !== 'run') { player.aiming = false; player.sprinting = false; animate(dt); placeVisual(dt); return }
    computeMax()
    tickStamina(dt)
    // life state machine (PlayerRespawn.Update)
    if (player.state === 'dead') {
      player.respawnLeft -= dt
      deathT += dt
      if (player.respawnLeft <= 0) beginRespawn()
    } else if (player.state === 'respawning') {
      getUpLeft -= dt
      if (getUpLeft <= 0) { getUpLeft = 0; player.state = 'alive' }
    }
    const control = player.state === 'alive' && !blocked()
    const inp = G.input || { move: { x: 0, y: 0 }, pressed: new Set() }
    let mx = 0, my = 0, sprintHeld = false, jumpP = false, dodgeP = false
    if (control) {
      mx = inp.move.x || 0; my = inp.move.y || 0
      sprintHeld = !!inp.sprint
      jumpP = inp.pressed && inp.pressed.has('jump')
      dodgeP = inp.pressed && inp.pressed.has('dodge')
    }
    const ml = Math.hypot(mx, my)
    if (ml > 1) { mx /= ml; my /= ml }
    if (!sprintHeld) sprintCancelled = false

    const wasGrounded = player.grounded
    player.grounded = ctrlGrounded
    if (player.grounded) lastGroundedT = G.time
    else airTime += dt
    if (player.grounded && !wasGrounded) {
      if (player.launched && vy <= 0) player.launched = false
      const impact = -vy
      if (airTime > 0.2) onLanded(impact)
      airTime = 0
    }

    const camYaw = player.camYawDeg
    fwdOf(camYaw, _f); rightOf(camYaw, _r)
    _wish.copy(_r).multiplyScalar(mx).addScaledVector(_f, my)
    const moveAngle = mx * mx + my * my > 0.01 ? Math.atan2(mx, my) / DEG : 0
    player.aiming = control && !!inp.aimHeld && !player.dodging
    const reloading = !!(G.weapons && G.weapons.reloading === true)

    // dodge roll
    if (!player.dodging && dodgeP && player.grounded && G.time >= dodgeReadyAt && trySpend(P.dodgeCost)) beginDodge(mx, my)
    if (player.dodging) {
      tickDodge(dt)
      player.aiming = false
    } else {
      // jump (coyote time)
      const canJump = jumpP && G.time - lastGroundedT <= P.coyote && vy <= 0.1
      if (canJump && trySpend(P.jumpCost)) {
        vy = P.jumpV
        lastGroundedT = -1
        player.grounded = false
        sfx(pick(['sfx_step_0', 'sfx_step_1', 'sfx_step_2', 'sfx_step_3', 'sfx_step_4']), { pos: player.pos, vol: P.stepVol * 1.1, rate: 0.94 + Math.random() * 0.12 })
        sfx(pick(['sfx_jump_0', 'sfx_jump_1']), { pos: player.pos, vol: 0.5, rate: 0.94 + Math.random() * 0.12 })
        ev('playerJumped')
      }
      const wantSprint = control && sprintHeld && !sprintCancelled && my > 0.35 && Math.abs(moveAngle) < 55 && !player.aiming && !reloading
      // sprint runs the pool dry and winds the player (spec §1.4); Unity's CanSprint (> 0.5) let the drain stop just short of 0
      player.sprinting = wantSprint && !player.winded && player.stamina > 0.01
      if (player.sprinting && player.grounded) drain(dt)
      const speed = (player.sprinting ? P.sprint : player.aiming ? P.aim : speedForAngle(Math.abs(moveAngle))) * speedMul()
      _tgt.copy(_wish).multiplyScalar(speed)
      let rate = _tgt.lengthSq() > planar.lengthSq() ? P.accel : P.decel
      if (!player.grounded) rate *= P.airControl
      if (!player.launched) {
        _v1.subVectors(_tgt, planar)
        const dl = _v1.length(), step = rate * dt
        if (dl <= step || dl < 1e-6) planar.copy(_tgt); else planar.addScaledVector(_v1, step / dl)
      }
      // facing: camera yaw + hip twist toward the travel direction
      let twist = 0
      if (player.sprinting) twist = moveAngle
      else if (!player.grounded) twist = hipOffset
      else if (mx * mx + my * my > 0.04) {
        const maxF = player.aiming ? P.hipTwistAim : P.hipTwist, maxB = player.aiming ? P.hipTwistAim : P.hipTwistBack
        if (Math.abs(moveAngle) <= 100) twist = clamp(moveAngle, -maxF, maxF)
        else twist = clamp(deltaDeg(0, moveAngle - Math.sign(moveAngle) * 180), -maxB, maxB)
      }
      hipOffset = hipOffset + clamp(twist - hipOffset, -P.twistRate * dt, P.twistRate * dt)
      player.bodyYawDeg = towardDeg(player.bodyYawDeg, camYaw + hipOffset, P.turnSpeed * dt)
    }
    if (player.state !== 'alive') { planar.set(0, 0, 0); player.sprinting = false }

    // gravity + capsule move (exact integration over the step so jump heights and pad arcs hold at low frame rates)
    if (player.grounded && vy < 0) vy = -2
    const vyAvg = vy + 0.5 * P.gravity * dt
    vy += P.gravity * dt
    _cv.set(planar.x, vyAvg, planar.z)
    const bx = player.pos.x, by = player.pos.y, bz = player.pos.z
    const w = G.world
    if (w && w.collide && dt > 0) {
      const res = w.collide(player.pos, _cv, P.radius, P.height, dt)
      ctrlGrounded = !!(res && res.grounded)
      if (res && res.ceiling && vy > 0) vy = 0
    } else { player.pos.addScaledVector(_cv, dt); ctrlGrounded = false }
    if (!(player.pos.y > -60) || !isFinite(player.pos.x) || !isFinite(player.pos.z)) { teleport(RESPAWN, player.camYawDeg); vy = 0 }
    player.vel.set(planar.x, vy, planar.z)
    player.planarSpeed = Math.hypot(planar.x, planar.z)
    // the weapon socket rides along until updateCamera re-poses it (weapons.update fires from it in between)
    socket.position.x += player.pos.x - bx; socket.position.y += player.pos.y - by; socket.position.z += player.pos.z - bz
    const moved = Math.hypot(player.pos.x - bx, player.pos.z - bz)

    // jump pads (JumpPad.cs): polled, no key
    if (player.state === 'alive' && ctrlGrounded && G.time >= padReadyAt && w && w.jumpPads) {
      for (const jp of w.jumpPads) {
        if (Math.abs(player.pos.y - jp.pos.y) > 0.8) continue
        const dx = player.pos.x - jp.pos.x, dz = player.pos.z - jp.pos.z
        if (dx * dx + dz * dz > jp.radius * jp.radius) continue
        launch(jp)
        break
      }
    }

    // footsteps (Footsteps.cs) and the tutorial's distance
    if (player.state === 'alive') {
      movedAcc += moved
      if (movedAcc >= 0.5) { ev('playerMoved', movedAcc); movedAcc = 0 }
    }
    const sp = player.planarSpeed
    if (sp < 0.3 || player.state !== 'alive' || !player.grounded || player.dodging) stepAcc = 0
    else {
      stepAcc += sp * dt
      const stride = standin ? gait.S : stepLength(sp) // one footfall per step of the gait (gait.js)
      if (stepAcc >= stride) {
        stepAcc -= stride
        stepLeft = !stepLeft
        sfx('sfx_step_' + ((Math.random() * 5) | 0), { pos: player.pos, vol: P.stepVol * clamp(sp / 4, 0.5, 1.3), rate: 0.92 + Math.random() * 0.16 })
      }
    }

    player.dodgeCooldown = Math.max(0, dodgeReadyAt - G.time)
    feedHud()
    animate(dt)
    placeVisual(dt)
  }
  function onLanded(impact) {
    sfx(pick(['sfx_land_0', 'sfx_land_1']), { pos: player.pos, vol: clamp(impact / 9, 0.35, 1), rate: 0.95 + Math.random() * 0.1 })
    stepAcc = 0
    anim.landDipV -= clamp(impact, 0, 14) * 0.3
    if (impact > 9 && fx().burst) fx().burst('footDust', player.pos, { scale: 1.4 })
    ev('playerLanded', impact)
  }
  function launch(jp) {
    if (player.dodging) endDodge(true)
    const v = jp.launchVelocity ? jp.launchVelocity(player.pos, -P.gravity, _v1) : _v1.set(0, 9, 0)
    planar.set(v.x, 0, v.z)
    vy = v.y
    player.launched = true
    lastGroundedT = -1
    player.grounded = false; ctrlGrounded = false
    player.sprinting = false
    padReadyAt = G.time + (jp.cooldown || P.padCooldown)
    jp.kick = 1
    sfx('sfx_jumppad_launch_0', { pos: player.pos, vol: 1 })
    if (fx().burst) fx().burst('jumpPadBurst', jp.pos, { scale: jp.outside ? 1.45 : 1 })
    if (G.shake) G.shake(0.12)
    ev('jumpPad', jp)
  }
  const vitals = { hp: 0, max: 0, stamina: 0, staminaMax: 0, winded: false, dodgeFrac: 0, dodgeBlocked: false, xpFrac: 0, level: 1, armor: 0, armorMax: 0, staminaFlash: false }
  function feedHud() {
    const h = hud()
    if (!h.vitals) return
    const r = G.run || {}
    const level = num(r.level, 1)
    let xpFrac = num(r.xpFrac, NaN)
    if (isNaN(xpFrac)) {
      const xp = num(r.xp, 0), L = clamp(Math.floor(level), 1, 30)
      const base = xp >= XP_TOTAL[L] ? XP_TOTAL[L] : 0, need = (XP_TOTAL[L + 1] || XP_TOTAL[L] + 1) - XP_TOTAL[L]
      xpFrac = L >= 30 ? 1 : clamp01((xp - base) / need)
    }
    const V = vitals
    V.hp = player.hp; V.max = player.maxHp; V.stamina = player.stamina; V.staminaMax = player.staminaMax; V.winded = player.winded
    V.dodgeFrac = player.dodging ? 1 : clamp01(player.dodgeCooldown / P.dodgeCd)
    V.dodgeBlocked = player.dodging || player.stamina < P.dodgeCost || player.winded
    V.xpFrac = xpFrac; V.level = level; V.armor = player.armor; V.armorMax = player.armorMax; V.staminaFlash = staminaFlash
    h.vitals(V)
    staminaFlash = false
    if (h.death) h.death(player.state === 'dead' ? Math.max(0, player.respawnLeft) : null)
  }

  // ------------------------------------------------------------------ camera rig (CameraRig.LateUpdate) + G.aim
  function updateCamera(dt, rdt) {
    if (!standin && !avatar) return
    const rig = G.state === 'run' && player.state !== 'dead'
    const mode = rig ? 'rig' : 'orbit'
    if (mode !== cam.mode) {
      cam.fromPos.copy(G.cam.pos); cam.fromQuat.copy(G.cam.quat); cam.blend = 0
      if (mode === 'orbit') { const c = coreCentre(_v1); cam.orbit = Math.atan2(G.cam.pos.x - c.x, -(G.cam.pos.z - c.z)) / DEG }
      else { cam.pivotY = player.pos.y + CAM.height; cam.dist = CAM.dist }
      cam.mode = mode
    }
    if (mode === 'rig') rigCamera(dt, rdt)
    else orbitCamera(rdt)
    if (cam.blend < 1) {
      cam.blend = Math.min(1, cam.blend + rdt / 0.6)
      const k = smooth01(cam.blend)
      G.cam.pos.lerpVectors(cam.fromPos, G.cam.pos, k)
      G.cam.quat.slerpQuaternions(cam.fromQuat, G.cam.quat, k)
    }
    computeAim()
    // the HUD crosshair cannot know about the rig: aim blend and scope are fed by weapons.js from player.aimBlend
    player.camYaw = -player.camYawDeg * DEG
    player.camPitch = -player.camPitchDeg * DEG
    poseVisual(dt)
  }
  function coreCentre(out) { const c = G.world && G.world.core ? G.world.core.pos : null; return c ? out.copy(c) : out.set(0, 7, 0) }
  function orbitCamera(rdt) {
    cam.orbit += CAM.orbitRate * rdt
    const c = coreCentre(_v1)
    G.cam.pos.set(c.x + Math.sin(cam.orbit * DEG) * CAM.orbitR, c.y + CAM.orbitH, c.z - Math.cos(cam.orbit * DEG) * CAM.orbitR)
    _v2.set(c.x, c.y + 1.6, c.z)
    _m1.lookAt(G.cam.pos, _v2, UP)
    G.cam.quat.setFromRotationMatrix(_m1)
    cam.fov = lerp(cam.fov, CAM.fov, 1 - Math.exp(-6 * rdt))
    G.cam.fov = cam.fov
    camFwd.set(0, 0, -1).applyQuaternion(G.cam.quat)
    player.aimBlend = Math.max(0, player.aimBlend - rdt * 6)
  }
  function rigCamera(dt, rdt) {
    const inp = G.input || { look: { dx: 0, dy: 0 } }
    const scopeFov = (G.weapons && G.weapons.scopeFov) || 0
    if (!blocked() && !G.paused) {
      let sens = CAM.sens * (inp.touch ? CAM.touchLook : 1)
      if (player.aiming) sens *= scopeFov > 0 ? CAM.scopeShare : CAM.aimShare
      player.camYawDeg += (inp.look.dx || 0) * sens
      player.camPitchDeg = clamp(player.camPitchDeg + (inp.look.dy || 0) * sens, CAM.pitchMin, CAM.pitchMax)
      if (inp.touch && inp.fireHeld && player.state === 'alive') aimAssist(rdt)
    }
    // recoil: fed in at min(1, dt*22) of the remainder per frame; it is never recovered
    const k = Math.min(1, dt * 22)
    const ap = recoilP * k, ay = recoilY * k
    recoilP -= ap; recoilY -= ay
    player.camPitchDeg = clamp(player.camPitchDeg - ap, CAM.pitchMin, CAM.pitchMax)
    player.camYawDeg += ay
    if (player.camYawDeg > 3600 || player.camYawDeg < -3600) player.camYawDeg %= 360

    player.aimBlend = clamp01(player.aimBlend + (player.aiming ? 1 : -1) * rdt * 6)
    player.sprintBlend = clamp01(player.sprintBlend + (player.sprinting ? 1 : -1) * rdt * 3)
    const a = smooth01(player.aimBlend)
    const dist = lerp(CAM.dist, CAM.aimDist, a)
    const sh = lerp(CAM.shoulder, CAM.aimShoulder, a) + camWide
    const fovT = lerp(lerp(CAM.fov, CAM.sprintFov, player.sprintBlend), scopeFov > 0 ? scopeFov : CAM.aimFov, a)
    cam.fov = lerp(cam.fov, fovT, 1 - Math.exp(-12 * rdt))
    G.cam.fov = cam.fov

    // pivot (a fast vertical ease hides the 0.35 m stair steps; teleports snap)
    const ty = player.pos.y + CAM.height
    cam.pivotY = Math.abs(ty - cam.pivotY) > 1.5 ? ty : lerp(cam.pivotY, ty, 1 - Math.exp(-22 * rdt))
    const yawR = player.camYawDeg * DEG, pitR = player.camPitchDeg * DEG
    camFwd.set(Math.sin(yawR) * Math.cos(pitR), -Math.sin(pitR), -Math.cos(yawR) * Math.cos(pitR))
    camRight.set(Math.cos(yawR), 0, Math.sin(yawR))
    const shoulder = _v1.set(player.pos.x, cam.pivotY, player.pos.z).addScaledVector(camRight, sh)
    const desired = _v2.copy(shoulder).addScaledVector(camFwd, -dist)
    let allowed = dist
    const hit = camCast(shoulder, desired, CAM.radius)
    if (hit < dist - 1e-3) allowed = Math.max(0.3, hit - 0.05)
    cam.dist = allowed < cam.dist ? allowed : lerp(cam.dist, allowed, 1 - Math.exp(-6 * rdt))
    G.cam.pos.copy(shoulder).addScaledVector(camFwd, -cam.dist)
    _e1.set(-pitR, -yawR, 0, 'YXZ')
    G.cam.quat.setFromEuler(_e1)
  }
  /** camera collision: the centre ray and four rays on the 0.22 m rim against the walk BVH (a sphere cast's cheap stand-in) */
  const _ray = new THREE.Ray(), _cd = new THREE.Vector3(), _cu = new THREE.Vector3(), _cw = new THREE.Vector3()
  function camCast(from, to, radius) {
    _cd.subVectors(to, from)
    const len = _cd.length()
    if (len < 1e-6) return 0
    _cd.multiplyScalar(1 / len)
    const bvh = G.world && G.world.walkBVH
    if (!bvh || !bvh.raycastFirst) return G.world && G.world.sphereCast ? G.world.sphereCast(from, to, radius) : len
    _cu.set(0, 1, 0)
    if (Math.abs(_cd.y) > 0.95) _cu.set(1, 0, 0)
    _cu.crossVectors(_cu, _cd).normalize()
    _cw.crossVectors(_cd, _cu)
    let best = len
    for (let k = 0; k < 5; k++) {
      _ray.origin.copy(from)
      if (k > 0) { const a = (k - 1) * Math.PI / 2; _ray.origin.addScaledVector(_cu, Math.cos(a) * radius).addScaledVector(_cw, Math.sin(a) * radius) }
      _ray.direction.copy(_cd)
      const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, best)
      if (h && h.distance < best) best = h.distance
    }
    return best
  }
  /** touch only, while FIRE is held: pull the view toward the nearest live bug near the crosshair */
  function aimAssist(rdt) {
    const en = G.enemies && G.enemies.list
    if (!en || !en.length) return
    const range = (G.weapons && G.weapons.range) || 80
    const cos = Math.cos(CAM.assistCone * DEG)
    let best = null, bestDot = cos
    for (let i = 0; i < en.length; i++) {
      const e = en[i]
      if (!e.alive || e.hittable === false) continue
      const p = e.aim || e.pos
      _v3.subVectors(p, G.cam.pos)
      const d = _v3.length()
      if (d < 1 || d > range + 4) continue
      const dot = _v3.dot(camFwd) / d
      if (dot > bestDot) { bestDot = dot; best = p }
    }
    if (!best) return
    _v3.subVectors(best, G.cam.pos)
    const wantYaw = Math.atan2(_v3.x, -_v3.z) / DEG
    const wantPitch = -Math.atan2(_v3.y, Math.hypot(_v3.x, _v3.z)) / DEG
    const k = 1 - Math.exp(-CAM.assistRate * rdt), cap = CAM.assistMax * rdt
    player.camYawDeg += clamp(deltaDeg(player.camYawDeg, wantYaw) * k, -cap, cap)
    player.camPitchDeg = clamp(player.camPitchDeg + clamp((wantPitch - player.camPitchDeg) * k, -cap, cap), CAM.pitchMin, CAM.pitchMax)
  }
  function computeAim() {
    const A = G.aim
    A.camPos.copy(G.cam.pos)
    A.dir.set(0, 0, -1).applyQuaternion(G.cam.quat)
    // the ray starts level with the player's chest so walls behind the character are ignored
    _v1.set(player.pos.x, player.pos.y + 1.4, player.pos.z).sub(G.cam.pos)
    const skip = G.state === 'run' && player.state !== 'dead' ? Math.max(0, _v1.dot(A.dir)) : 0
    A.origin.copy(G.cam.pos).addScaledVector(A.dir, skip)
    let dist = AIM_RANGE, enemy = null, weak = false, part
    const hits = G.enemies && G.enemies.raycast ? G.enemies.raycast(A.origin, A.dir, AIM_RANGE) : null
    if (hits && hits.length) { dist = hits[0].distance; enemy = hits[0].enemy; weak = !!hits[0].weak; part = hits[0].part }
    const env = G.world && G.world.raycastEnv ? G.world.raycastEnv(A.origin, A.dir, dist) : null
    if (env && env.distance < dist) { dist = env.distance; enemy = null; weak = false; part = undefined }
    A.distance = dist; A.enemyHit = enemy; A.weak = weak; A.part = part
    A.point.copy(A.origin).addScaledVector(A.dir, dist)
  }

  // ------------------------------------------------------------------ visuals: place, animate, socket, arm IK
  function placeVisual() {
    vroot.position.copy(player.pos)
    vroot.rotation.y = rotOf(player.bodyYawDeg)
    player.yaw = vroot.rotation.y
  }
  function springStep(x, v, k, d, dt) { return v + (-x * k - v * d) * dt }
  function animate(dt) {
    const sp = player.planarSpeed
    fwdOf(player.bodyYawDeg, _v1); rightOf(player.bodyYawDeg, _v2)
    const fwd = planar.x * _v1.x + planar.z * _v1.z, side = planar.x * _v2.x + planar.z * _v2.z
    const moving = sp > 0.25 && player.grounded && !player.dodging && player.state === 'alive'
    anim.moveAmt = lerp(anim.moveAmt, moving ? clamp01(sp / 3) : 0, 1 - Math.exp(-10 * dt))
    anim.sprintW = lerp(anim.sprintW, player.sprinting ? 1 : 0, 1 - Math.exp(-8 * dt))
    anim.airW = lerp(anim.airW, !player.grounded && !player.dodging && player.state !== 'dead' ? 1 : 0, 1 - Math.exp(-10 * dt))
    if (sp > 0.25) { anim.fwdC = lerp(anim.fwdC, fwd / sp, 1 - Math.exp(-10 * dt)); anim.sideC = lerp(anim.sideC, -side / sp, 1 - Math.exp(-10 * dt)) }
    const stride = lerp(P.walkStride, P.sprintStride, anim.sprintW)
    if (moving) anim.phase += sp * dt / stride * Math.PI
    // springs: landing dip, flinch
    anim.landDipV = springStep(anim.landDip, anim.landDipV, 100, 12, dt)
    anim.landDip = clamp(anim.landDip + anim.landDipV * dt, -0.32, 0.1)
    anim.flinchV.x = springStep(anim.flinch.x, anim.flinchV.x, 220, 18, dt)
    anim.flinchV.y = springStep(anim.flinch.y, anim.flinchV.y, 220, 18, dt)
    anim.flinchV.z = springStep(anim.flinch.z, anim.flinchV.z, 220, 18, dt)
    anim.flinch.addScaledVector(anim.flinchV, dt)
    const carry = player.dodging || player.state === 'dead' || (player.state === 'respawning' && getUpLeft > P.getUp - 0.7)
    anim.carryW = lerp(anim.carryW, carry ? 1 : 0, 1 - Math.exp(-12 * dt))
    if (standin) animStandIn(dt)
    else if (avatar) animAvatar(dt)
  }
  /** knee bend that keeps the feet on the floor when the hips drop d metres (leg 0.84 m) */
  const kneeFor = d => Math.acos(clamp(1 - Math.max(0, d) / (standin ? standin.leg || 0.84 : 0.84), -1, 1))
  function animStandIn(dt) {
    const B = standin.bones
    const dead = player.state === 'dead'
    // roll (dodge): tuck and a forward somersault about the hips
    let tuck = 0, roll = 0
    if (player.dodging) {
      const u = clamp01(dodgeT / P.dodgeDur)
      tuck = Math.sin(Math.PI * clamp01(u / 0.85))
      roll = smooth01((u - 0.08) / 0.62) * Math.PI * 2
    }
    anim.tuck = lerp(anim.tuck, tuck, 1 - Math.exp(-25 * dt))
    // death: knees buckle, then topple forward; respawn: get up from a kneel
    let crouch = 0, topple = 0
    if (dead) {
      crouch = smooth01(deathT / 0.4) * 0.38
      const k = clamp01((deathT - 0.3) / 0.65)
      topple = k * k * k * 1.42 + (k >= 1 ? Math.sin(Math.min(1, (deathT - 0.95) / 0.25) * Math.PI) * 0.06 : 0)
    } else if (player.state === 'respawning') {
      const u = 1 - getUpLeft / P.getUp
      crouch = (1 - smooth01((u - 0.1) / 0.55)) * 0.42
    }
    anim.crouch = crouch
    // pivot: forward roll around the tucked hips, or the topple around the knees
    if (player.dodging || anim.tuck > 0.01) { pivot.position.set(0, 0.52, 0); offset.position.set(0, -0.52, 0); pivot.rotation.set(roll, 0, 0) }
    else if (dead) { pivot.position.set(0, 0.16, 0.12); offset.position.set(0, -0.16, -0.12); pivot.rotation.set(topple, 0, 0) }
    else { pivot.position.set(0, 0, 0); offset.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0) }
    offset.scale.set(1, 1, 1)
    // legs: planted-foot IK, run cycle, jump and landing (gait.js)
    const legs = poseLegs(gait, B, standin, {
      dt, speed: player.planarSpeed, fc: anim.fwdC, rc: -anim.sideC, moveAmt: anim.moveAmt, sprintW: anim.sprintW, airW: anim.airW,
      vy: player.vel.y, grounded: player.grounded, drop: Math.max(0, -anim.landDip) + crouch + 0.3 * anim.tuck, tuck: anim.tuck, dead,
    })
    B.hips.position.y = standin.rest.hips.y - legs.drop
    B.hips.rotation.set(0, legs.yaw, legs.roll)
    const runLean = 0.07 * clamp01((player.planarSpeed - 2.6) / 1.6) * anim.moveAmt * (1 - anim.airW)
    // upper body: the torso turns back to the aim (hips follow the travel), pitches with the view, a 16 deg bladed stance
    const aimW = (1 - anim.carryW) * (G.state === 'run' ? 1 : 0.35)
    const twist = clamp(-deltaDeg(player.bodyYawDeg, player.camYawDeg), -80, 80) * DEG * aimW
    const up = clamp(-player.camPitchDeg, -60, 60) * DEG * aimW
    const blade = -20 * DEG * aimW
    const breathe = Math.sin(anim.t * 1.9) * 0.012
    const fl = anim.flinch
    B.spine.rotation.set(-up * 0.12 + anim.sprintW * 0.16 * (1 - legs.airW) + runLean + legs.lean + anim.tuck * 0.55 + crouch * 0.35 - fl.x * DEG * 0.3, twist * 0.4 + blade * 0.4 - legs.yaw * 0.85, -legs.roll * 0.7)
    B.chest.rotation.set(-up * 0.26 + breathe + anim.tuck * 0.35 - fl.x * DEG * 0.5, twist * 0.6 + blade * 0.6 + fl.y * DEG * 0.4, fl.z * DEG * 0.4)
    B.neck.rotation.set(-up * 0.15, -blade * 0.5, 0)
    B.head.rotation.set(-up * 0.32 + (dead ? 0.5 : 0), -blade * 0.5, 0)
  }
  function animAvatar(dt) {
    const a = avatar
    const dead = player.state === 'dead'
    // clip weights: idle standing, fly moving, fly_fast sprinting; ascend/descend in the air when the avatar has them
    const air = a.acts.up && a.acts.down ? anim.airW : 0
    const move = clamp01(anim.moveAmt * 1.4) * (1 - air)
    const w = a.w, r = 1 - Math.exp(-8 * dt)
    w.idle = lerp(w.idle, (1 - move) * (1 - air), r)
    w.fly = lerp(w.fly, move * (1 - anim.sprintW), r)
    w.fast = lerp(w.fast, move * anim.sprintW, r)
    w.up = lerp(w.up, air * (vy > 0 ? 1 : 0), r)
    w.down = lerp(w.down, air * (vy > 0 ? 0 : 1), r)
    const acc = a.acc
    acc.fill(0)
    acc[a.slot.idle] += w.idle; acc[a.slot.fly] += w.fly; acc[a.slot.fast] += w.fast; acc[a.slot.up] += w.up; acc[a.slot.down] += w.down
    for (let i = 0; i < a.uniq.length; i++) a.uniq[i].setEffectiveWeight(acc[i])
    a.mixer.update(dt)
    // lean into the movement; spin + squash for the roll; slump on death; scale up on the get-up
    let rx = (0.16 + 0.1 * anim.sprintW) * anim.moveAmt * clamp(anim.fwdC, -0.6, 1)
    let rz = -anim.sideC * 0.16 * anim.moveAmt
    let ry = 0, sy = 1, sxz = 1, py = 0
    if (player.dodging) {
      const u = clamp01(dodgeT / P.dodgeDur)
      ry = smooth01(u / 0.8) * Math.PI * 2
      const sq = Math.sin(Math.PI * u)
      sy = 1 - 0.28 * sq; sxz = 1 + 0.14 * sq
    }
    if (dead) { const k = smooth01(deathT / 0.9); rx = 1.15 * k; rz = 0.2 * k; py = -0.35 * k; sy = 1 - 0.15 * k }
    if (player.state === 'respawning') { const u = 1 - getUpLeft / P.getUp; const s = lerp(0.55, 1, smooth01(u / 0.6)); sy *= s; sxz *= s }
    pivot.position.set(0, dead ? 0.1 : 0.9, 0); offset.position.set(0, (dead ? -0.1 : -0.9) + py + Math.sin(anim.t * 2.2) * 0.025 * (1 - anim.moveAmt) - Math.max(0, -anim.landDip) * 0.6, 0)
    pivot.rotation.set(rx, ry, rz)
    offset.scale.set(sxz, sy, sxz)
  }

  /** pose the weapon socket (shoulder pocket / hand / floating point, aimed at G.aim.point) and the stand-in's arms */
  function poseVisual() {
    placeVisual()
    vroot.updateMatrixWorld(true)
    const hasWeapon = !!(G.weapons && G.weapons.gripR)
    socket.visible = player.state !== 'dead' && !!(standin || avatar)
    // aim target, kept at least 4 m from the chest (PlayerAnimation.cs)
    const chest = _v1.set(player.pos.x, player.pos.y + 1.4, player.pos.z)
    const tgt = _v2
    if (G.state === 'run') tgt.copy(G.aim.point)
    else fwdOf(player.bodyYawDeg, tgt).multiplyScalar(12).add(chest).addScaledVector(UP, -1.2)
    _v3.subVectors(tgt, chest)
    const dl = _v3.length()
    if (dl < 4) tgt.copy(chest).addScaledVector(dl > 1e-4 ? _v3.multiplyScalar(1 / dl) : fwdOf(player.camYawDeg, _v3), 4)
    // socket position
    if (standin) { _v4.lerpVectors(POCKET_HIP, POCKET_ADS, smooth01(player.aimBlend)); _v4.x *= pocketK; standin.bones.chest.localToWorld(_v4); G.root.worldToLocal(_v4) }
    else if (avatar && avatar.hand) toGame(avatar.hand, _v4)
    else if (avatar) { _v4.copy(avatar.float); _v4.y += Math.sin(anim.t * 2.4) * 0.02; offset.localToWorld(_v4); G.root.worldToLocal(_v4) }
    else _v4.copy(chest)
    socket.position.copy(_v4)
    _m1.lookAt(tgt, _v4, UP)
    _q1.setFromRotationMatrix(_m1)
    // carry pose (roll, death, get-up): the gun rides on the chest, muzzle down and inward
    if (standin && anim.carryW > 0.001) {
      _v3.copy(CARRY); standin.bones.chest.localToWorld(_v3); G.root.worldToLocal(_v3)
      standin.bones.chest.getWorldQuaternion(_q2)
      _q3.setFromEuler(_e1.set(0.6, 0.35, 0, 'YXZ'))
      _q2.multiply(_q3)
      socket.position.lerp(_v3, anim.carryW)
      _q1.slerp(_q2, anim.carryW)
    }
    socket.quaternion.copy(_q1)
    socket.updateMatrixWorld(true)
    if (standin) {
      if (hasWeapon && player.state !== 'dead') solveArms()
      else limpArms()
      if (fighter) fighter.retarget.apply(anim.t, anim.moveAmt, anim.sprintW)
    }
  }
  function limpArms() {
    const B = standin.bones
    B.upperArmL.rotation.set(0.15, 0, 0.12); B.foreArmL.rotation.set(-0.25, 0, 0); B.handL.rotation.set(0, 0, 0)
    B.upperArmR.rotation.set(0.15, 0, -0.12); B.foreArmR.rotation.set(-0.25, 0, 0); B.handR.rotation.set(0, 0, 0)
  }
  function solveArms() {
    const B = standin.bones, W = G.weapons
    const scale = G.S || 1
    // poles: elbows down and out, a little back (in the chest frame)
    B.chest.getWorldQuaternion(_qh)
    _poleR.set(-0.55, -1, -0.3).applyQuaternion(_qh)
    _poleL.set(0.75, -1, -0.15).applyQuaternion(_qh)
    W.gripR.getWorldPosition(_gr)
    W.gripL.getWorldPosition(_gl)
    // the support hand slides back along the gun until the arm reaches it
    B.upperArmL.getWorldPosition(_S)
    const reach = (standin.arm.upper + standin.arm.fore) * 0.97 * scale
    if (_gl.distanceTo(_S) > reach) {
      // |gl + t (gr - gl) - S| = reach
      _dir.subVectors(_gr, _gl); _pp.subVectors(_gl, _S)
      const a = _dir.lengthSq(), b = 2 * _pp.dot(_dir), c = _pp.lengthSq() - reach * reach
      const disc = b * b - 4 * a * c
      const t = a > 1e-12 && disc >= 0 ? clamp((-b - Math.sqrt(disc)) / (2 * a), 0, 1) : 1
      _gl.addScaledVector(_dir, t)
    }
    socket.getWorldQuaternion(_qa)
    _qb.setFromEuler(_e1.set(-0.35, 0, 0, 'YXZ'))
    _qa.multiply(_qb)
    solveArm(B.upperArmR, B.foreArmR, B.handR, _gr, _poleR, _qa, scale)
    _qb.setFromEuler(_e1.set(0.2, 0, -1.2, 'YXZ'))
    socket.getWorldQuaternion(_qL).multiply(_qb)
    solveArm(B.upperArmL, B.foreArmL, B.handL, _gl, _poleL, _qL, scale)
  }
  /** analytic two-bone IK in world space; bones hang along their -Y axis at rest, elbows bend toward +Z */
  function solveArm(upper, fore, hand, target, pole, handQuat, scale) {
    upper.getWorldPosition(_S)
    const a = standin.arm.upper * scale, b = standin.arm.fore * scale
    _dir.subVectors(target, _S)
    let d = _dir.length()
    if (d < 1e-6) return
    _dir.multiplyScalar(1 / d)
    d = clamp(d, Math.abs(a - b) + 1e-5, (a + b) * 0.999)
    _pp.copy(pole).addScaledVector(_dir, -pole.dot(_dir))
    if (_pp.lengthSq() < 1e-10) _pp.set(0, -1, 0).addScaledVector(_dir, _dir.y)
    _pp.normalize()
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA)
    _E.copy(_S).addScaledVector(_dir, a * cosA).addScaledVector(_pp, a * sinA)
    _T.copy(_S).addScaledVector(_dir, d)
    limbQuat(_v3.subVectors(_E, _S), _pp, _q1)
    upper.parent.getWorldQuaternion(_q2)
    upper.quaternion.copy(_q2.invert().multiply(_q1))
    limbQuat(_v3.subVectors(_T, _E), _pp, _q2)
    _q3.copy(_q1).invert()
    fore.quaternion.copy(_q3).multiply(_q2)
    _q2.invert()
    hand.quaternion.copy(_q2).multiply(handQuat)
  }
  function limbQuat(limb, pole, out) {
    _by.copy(limb).normalize().negate()
    _bz.copy(pole).addScaledVector(_by, -pole.dot(_by)).normalize().negate()
    _bx.crossVectors(_by, _bz)
    _m1.makeBasis(_bx, _by, _bz)
    return out.setFromRotationMatrix(_m1)
  }

  function placeCamera() {
    cam.blend = 1
    if (G.state === 'run' && player.state !== 'dead') { cam.mode = 'rig'; rigCamera(0, 1) } else { cam.mode = 'orbit'; orbitCamera(0) }
    computeAim()
    poseVisual()
  }

  Object.assign(player, {
    equipGear: id => setGear(id, true), applyMods: () => computeMax(),
    load, update, updateCamera, placeCamera, hurt, reset, addRecoil, addArmor, refillStamina, setGear, cancelSprint, teleport,
    respawnNow, kill, setAvatarBytes, setFighter, useStandIn: () => { useStandIn(); placeVisual() },
    model: vroot, START, RESPAWN, P, CAM,
  })
  Object.defineProperties(player, {
    standIn: { get: () => standin },
    fighter: { get: () => (fighter ? { id: fighter.entry.id, name: fighter.entry.name, height: fighter.prep.height, roles: fighter.retarget.roles } : null) },
    avatarInfo: { get: () => (avatar ? { scale: avatar.scale, clips: avatar.clips, hand: avatar.hand ? avatar.hand.name : null } : null) },
    getUpLeft: { get: () => getUpLeft },
    gait: { get: () => gait },
  })
  return player
}
