// Hive Adapt co-op: the other defenders, drawn from what their machines send 20 times a second (net.js -> room.input).
// Each one is their fighter (Foxfire Ronin, Outpost Guard or their own fighter entity) on the same procedural trooper rig the
// local player uses (standin.js + fighter.js): a gait from how fast they move, the torso turned to their aim, the gun in the
// shoulder pocket aimed where they look, two-bone IK onto its grips, muzzle flashes and tracers for the shots they report, a
// roll, a fall when they die. A name tag with their health floats over them. Everything in game space under G.root.
//
// createRemotes(G) -> { update(id, info, sample), remove(id), clear(), tick(dt), get(id), list }
//   sample: { p: [x, y, z], b: body bearing, c: aim bearing, pi: pitch (deg, + = down), f: flags, w: weapon index,
//             fi: fighter id, n: shots fired (mod 1000), h: health % }
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { buildStandIn } from './standin.js'
import { createGait, poseLegs } from './gait.js'
import { prepareFighter, createRetarget } from './fighter.js'
import { WEAPONS, ORDER } from './weapons.js'
import { buildAR7 } from './weaponart.js'

const DEG = Math.PI / 180
export const FLAG = { aim: 1, sprint: 2, dodge: 4, air: 8, dead: 16, respawn: 32, fire: 64, reload: 128 }
const POCKET_HIP = new THREE.Vector3(-0.245, 0.12, 0.16)
const POCKET_ADS = new THREE.Vector3(-0.185, 0.25, 0.14)
const DELAY = 0.11 // interpolation delay (s): two input ticks
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = v => clamp(v, 0, 1)
const lerp = (a, b, t) => a + (b - a) * t
const smooth01 = t => { t = clamp01(t); return t * t * (3 - 2 * t) }
const deltaDeg = (a, b) => { let d = ((b - a) % 360 + 540) % 360 - 180; return d === -180 ? 180 : d }
const rotOf = yawDeg => Math.PI - yawDeg * DEG
const fwdOf = (yawDeg, out) => out.set(Math.sin(yawDeg * DEG), 0, -Math.cos(yawDeg * DEG))
const rightOf = (yawDeg, out) => out.set(Math.cos(yawDeg * DEG), 0, Math.sin(yawDeg * DEG))
const pick = a => a[(Math.random() * a.length) | 0]

export function createRemotes(G) {
  const p0 = G.p0
  const list = new Map()
  const fighterGltf = new Map()
  const gunTpl = new Map()
  const UP = new THREE.Vector3(0, 1, 0)
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3()
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _e1 = new THREE.Euler(0, 0, 0, 'YXZ')
  const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _dir = new THREE.Vector3(), _pp = new THREE.Vector3()
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _gr = new THREE.Vector3(), _gl = new THREE.Vector3()
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qL = new THREE.Quaternion(), _poleR = new THREE.Vector3(), _poleL = new THREE.Vector3()

  // ---------------------------------------------------------------- models
  function fighterEntry(id, fi) {
    if (fi === 'mine') {
      try {
        const e = p0.entities && p0.entities.of ? p0.entities.of(id) : null
        if (e && e.model && e.status !== 'needs_update') return { key: 'mine:' + e.id + ':' + (e.version || 0), url: e.model, map: e.data && e.data.skeleton }
      } catch (err) { /* none */ }
      fi = 'ronin'
    }
    if (fi !== 'guard') fi = 'ronin'
    return { key: fi, url: p0.asset('assets/fighters/' + fi + '.glb') }
  }
  function loadGltf(entry) {
    let p = fighterGltf.get(entry.key)
    if (!p) { p = new GLTFLoader().loadAsync(entry.url); fighterGltf.set(entry.key, p); p.catch(() => fighterGltf.delete(entry.key)) }
    return p
  }
  async function gunModel(wid) {
    let p = gunTpl.get(wid)
    if (!p) {
      const d = WEAPONS[wid] || WEAPONS.AR7
      p = (async () => {
        const A = G.assets
        let m
        try { if (d.model) { m = await A.clone(d.model); A.dress(m, {}); m.scale.x = -1 } else m = buildAR7(A) } catch (e) { m = buildAR7(A) }
        return m
      })()
      gunTpl.set(wid, p)
    }
    const tpl = await p
    const model = tpl.clone(true)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const find = n => model.getObjectByName(n) || null
    const g = { id: wid, root: new THREE.Group(), model, muzzle: find('Muzzle'), gripR: find('Grip_R'), gripL: find('Grip_L') }
    if (!g.muzzle) { g.muzzle = new THREE.Object3D(); g.muzzle.position.set(0, 0, box.max.z); model.add(g.muzzle) }
    if (!g.gripR) { g.gripR = new THREE.Object3D(); g.gripR.position.set(0, -0.08, box.min.z + 0.3); model.add(g.gripR) }
    if (!g.gripL) { g.gripL = new THREE.Object3D(); g.gripL.position.set(0, -0.03, box.min.z + 0.7); model.add(g.gripL) }
    g.root.add(model)
    g.root.position.set(0, -0.05 - box.max.y, -0.04 - box.min.z) // the shoulder mount (weapons.js placeRoot)
    model.traverse(o => { if (o.isMesh) { o.castShadow = true } })
    return g
  }

  // ---------------------------------------------------------------- the name tag (canvas sprite): name + health bar
  function makeTag(r) {
    // the game runs in a Web Worker (no DOM): an OffscreenCanvas, like every other canvas in the game
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 64) : document.createElement('canvas')
    cv.width = 256; cv.height = 64
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
    const sp = new THREE.Sprite(mat)
    sp.scale.set(2.6, 0.65, 1)
    sp.renderOrder = 30
    r.tag = { cv, tex, sp, drawn: '' }
    G.root.add(sp)
  }
  function drawTag(r) {
    const hp = clamp(Math.round(r.hp / 5) * 5, 0, 100)
    const key = r.name + '|' + hp + '|' + r.dead
    if (key === r.tag.drawn) return
    r.tag.drawn = key
    const c = r.tag.cv.getContext('2d')
    c.clearRect(0, 0, 256, 64)
    c.font = '600 28px "HA Rajdhani", "Rajdhani", sans-serif'
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.75)'
    const nm = r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name
    c.strokeText(nm, 128, 22)
    c.fillStyle = r.dead ? '#9aa3ad' : r.color
    c.fillText(nm, 128, 22)
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(58, 44, 140, 10)
    c.fillStyle = hp > 50 ? '#7dff9a' : hp > 25 ? '#ffc247' : '#ff4a2e'
    c.fillRect(60, 46, 136 * hp / 100, 6)
    r.tag.tex.needsUpdate = true
  }

  // ---------------------------------------------------------------- one remote defender
  function create(id, info) {
    const vroot = new THREE.Group(); vroot.name = 'Ally_' + id
    const pivot = new THREE.Group(), offset = new THREE.Group()
    vroot.add(pivot); pivot.add(offset)
    const socket = new THREE.Group()
    G.root.add(vroot); G.root.add(socket)
    const r = {
      id, name: String(info.name || 'Ally'), color: info.color || '#7fdcff', vroot, pivot, offset, socket, rig: null, fighter: null, fid: null, loading: null,
      gun: null, gunId: null, gunLoading: null, samples: [], pos: new THREE.Vector3(), lastPos: new THREE.Vector3(), body: 0, cam: 0, pitch: 8, flags: 0,
      hp: 100, dead: false, shots: -1, pendingShots: 0, shotT: 0, wid: 'AR7', t: 0, seen: G.rt,
      anim: { phase: 0, moveAmt: 0, sprintW: 0, airW: 0, aimW: 0, tuck: 0, roll: 0, dodgeT: 0, deathT: 0, carryW: 0, fwdC: 1, sideC: 0, speed: 0, vy: 0, inAir: false, airT: 0, landDip: 0, landDipV: 0, gait: createGait() },
    }
    makeTag(r)
    list.set(id, r)
    return r
  }
  async function setFighter(r, fi) {
    if (r.fid === fi || r.loading === fi) return
    r.loading = fi
    const entry = fighterEntry(r.id, fi)
    let gltf
    try { gltf = await loadGltf(entry) } catch (e) { if (fi !== 'ronin') { r.loading = null; return setFighter(r, 'ronin') } r.loading = null; return }
    if (!list.has(r.id) || r.loading !== fi) return
    const scene = SkeletonUtils.clone(gltf.scene || gltf.scenes[0])
    let prep
    try { prep = prepareFighter(scene, entry.map) } catch (e) { r.loading = null; if (fi !== 'ronin') return setFighter(r, 'ronin'); return }
    if (r.rig) r.offset.remove(r.rig.object)
    if (r.fighter) r.offset.remove(r.fighter.prep.wrap)
    r.pivot.position.set(0, 0, 0); r.pivot.rotation.set(0, 0, 0); r.offset.position.set(0, 0, 0)
    const rig = buildStandIn({ meshless: true, joints: prep.joints })
    r.offset.add(rig.object)
    r.offset.add(prep.wrap)
    r.rig = rig
    r.fighter = { prep, retarget: createRetarget(prep, rig, r.offset) }
    r.pocketK = Math.min(1.35, Math.max(0.85, prep.shoulder / 0.205))
    r.fid = fi
    r.loading = null
    G.log && G.log('co-op: ' + r.name + ' is here as ' + (fi === 'mine' ? 'their own fighter' : fi === 'guard' ? 'the Outpost Guard' : 'the Foxfire Ronin'))
  }
  async function setGun(r, wid) {
    if (r.gunId === wid || r.gunLoading === wid) return
    r.gunLoading = wid
    const g = await gunModel(wid)
    if (!list.has(r.id) || r.gunLoading !== wid) return
    if (r.gun) r.socket.remove(r.gun.root)
    r.socket.add(g.root)
    r.gun = g; r.gunId = wid; r.gunLoading = null
  }

  /** a new input sample from that player */
  function update(id, info, s) {
    let r = list.get(id)
    if (!r) r = create(id, info)
    if (info.name) r.name = String(info.name)
    if (info.color) r.color = info.color
    r.seen = G.rt
    if (!s || !Array.isArray(s.p)) return r
    // time the sample by the sender's clock when it carries one (arrivals bunch up and stall; the sender's 20 Hz is even):
    // its offset to ours is the quickest arrival seen, drifting up slowly, so the newest sample lands at about now
    let t = G.rt
    if (typeof s.t === 'number' && isFinite(s.t)) {
      if (r.lastSt != null && s.t <= r.lastSt && s.t > r.lastSt - 30) t = null // the same (or an older) sample again
      else {
        const off = G.rt - s.t
        if (r.off == null || Math.abs(off - r.off) > 2) r.off = off // first sample, or the sender's clock jumped
        else if (off < r.off) r.off = off
        else r.off += (off - r.off) * 0.02
        r.lastSt = s.t
        t = s.t + r.off
      }
    }
    if (t != null) {
      r.samples.push({ t, x: +s.p[0] || 0, y: +s.p[1] || 0, z: +s.p[2] || 0, b: +s.b || 0, c: +s.c || 0, pi: +s.pi || 0, f: s.f | 0 })
      if (r.samples.length > 8) r.samples.shift()
    }
    r.hp = clamp(+s.h || 0, 0, 100)
    const wid = ORDER[s.w | 0] || 'AR7'
    r.wid = wid
    setGun(r, wid)
    setFighter(r, s.fi === 'guard' || s.fi === 'mine' ? s.fi : 'ronin')
    const n = s.n | 0
    if (r.shots < 0) r.shots = n
    else if (n !== r.shots) { r.pendingShots += Math.min(6, (n - r.shots + 1000) % 1000); r.shots = n }
    return r
  }
  function remove(id) {
    const r = list.get(id)
    if (!r) return
    list.delete(id)
    r.loading = r.gunLoading = '__gone'
    G.root.remove(r.vroot); G.root.remove(r.socket); G.root.remove(r.tag.sp)
    r.tag.tex.dispose(); r.tag.sp.material.dispose()
  }
  function clear() { for (const id of [...list.keys()]) remove(id) }

  // ---------------------------------------------------------------- per frame
  function sampleAt(r, t) {
    const S = r.samples
    if (!S.length) return null
    if (t <= S[0].t) return S[0]
    for (let i = S.length - 1; i > 0; i--) {
      const a = S[i - 1], b = S[i]
      if (t >= a.t && t <= b.t) {
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), b: a.b + deltaDeg(a.b, b.b) * k, c: a.c + deltaDeg(a.c, b.c) * k, pi: lerp(a.pi, b.pi, k), f: k < 0.5 ? a.f : b.f }
      }
    }
    return S[S.length - 1]
  }
  function tick(dt) {
    for (const r of list.values()) {
      const s = sampleAt(r, G.rt - DELAY)
      if (!s) continue
      r.t += dt
      r.lastPos.copy(r.pos)
      r.pos.set(s.x, s.y, s.z)
      r.body = s.b; r.cam = s.c; r.pitch = s.pi; r.flags = s.f
      const dead = !!(s.f & FLAG.dead)
      if (dead && !r.dead) r.anim.deathT = 0
      r.dead = dead
      const vis = r.samples.length > 0
      r.vroot.visible = vis; r.socket.visible = vis && !dead
      try {
        // the name tag shows at once, even while the fighter's model is still loading
        drawTag(r)
        r.tag.sp.position.set(r.pos.x, r.pos.y + 2.2, r.pos.z)
        r.tag.sp.visible = vis
        // full size from 9 m away; smaller up close, so a teammate beside you doesn't cover the view
        const d = G.cam && G.cam.pos ? G.cam.pos.distanceTo(r.tag.sp.position) : 9
        const k = clamp(d / 9, 0.4, 1)
        r.tag.sp.scale.set(2.6 * k, 0.65 * k, 1)
        if (!r.rig) { r.vroot.position.copy(r.pos); continue }
        animate(r, dt)
        pose(r)
        shots(r, dt)
      } catch (e) {
        if (!r.err) { r.err = true; G.log && G.log('co-op: animating ' + r.name + ' failed: ' + (e && e.message || e)) }
      }
    }
  }
  function animate(r, dt) {
    const A = r.anim, f = r.flags
    const vx = dt > 0 ? (r.pos.x - r.lastPos.x) / dt : 0, vz = dt > 0 ? (r.pos.z - r.lastPos.z) / dt : 0
    let sp = Math.hypot(vx, vz)
    if (sp > 12) sp = 0 // a teleport (respawn)
    A.speed = lerp(A.speed, sp, 1 - Math.exp(-12 * dt))
    let vy = dt > 0 ? (r.pos.y - r.lastPos.y) / dt : 0
    if (Math.abs(vy) > 30) vy = 0
    A.vy = lerp(A.vy, vy, 1 - Math.exp(-15 * dt))
    fwdOf(r.body, _v1); rightOf(r.body, _v2)
    const fwd = vx * _v1.x + vz * _v1.z, side = vx * _v2.x + vz * _v2.z
    const grounded = !(f & FLAG.air)
    // landing: the hips sink on a spring, as for the local fighter (player.js onLanded)
    if (!grounded) { if (!A.inAir) { A.inAir = true; A.airT = 0; A.fall = 0 } A.airT += dt; A.fall = Math.min(A.fall, A.vy) }
    else if (A.inAir) { A.inAir = false; if (A.airT > 0.2 && !r.dead) A.landDipV -= clamp(-A.fall, 0, 14) * 0.3 }
    A.landDipV += (-100 * A.landDip - 12 * A.landDipV) * dt
    A.landDip = clamp(A.landDip + A.landDipV * dt, -0.32, 0.1)
    const moving = A.speed > 0.25 && grounded && !(f & FLAG.dodge) && !r.dead
    A.moveAmt = lerp(A.moveAmt, moving ? clamp01(A.speed / 3) : 0, 1 - Math.exp(-10 * dt))
    A.sprintW = lerp(A.sprintW, f & FLAG.sprint ? 1 : 0, 1 - Math.exp(-8 * dt))
    A.airW = lerp(A.airW, !grounded && !(f & FLAG.dodge) && !r.dead ? 1 : 0, 1 - Math.exp(-10 * dt))
    A.aimW = lerp(A.aimW, f & FLAG.aim ? 1 : 0, 1 - Math.exp(-12 * dt))
    if (sp > 0.25) { A.fwdC = lerp(A.fwdC, fwd / sp, 1 - Math.exp(-10 * dt)); A.sideC = lerp(A.sideC, -side / sp, 1 - Math.exp(-10 * dt)) }
    const stride = lerp(0.72, 1.05, A.sprintW)
    if (moving) A.phase += A.speed * dt / stride * Math.PI
    if (f & FLAG.dodge) A.dodgeT += dt; else A.dodgeT = 0
    if (r.dead) A.deathT += dt
    const carry = !!(f & FLAG.dodge) || r.dead || !!(f & FLAG.respawn)
    A.carryW = lerp(A.carryW, carry ? 1 : 0, 1 - Math.exp(-12 * dt))
    const B = r.rig.bones
    // roll, death topple, get-up crouch (player.js animStandIn)
    let tuck = 0, roll = 0
    if (f & FLAG.dodge) { const u = clamp01(A.dodgeT / 0.9); tuck = Math.sin(Math.PI * clamp01(u / 0.85)); roll = smooth01((u - 0.08) / 0.62) * Math.PI * 2 }
    A.tuck = lerp(A.tuck, tuck, 1 - Math.exp(-25 * dt))
    let crouch = 0, topple = 0
    if (r.dead) { crouch = smooth01(A.deathT / 0.4) * 0.38; const k = clamp01((A.deathT - 0.3) / 0.65); topple = k * k * k * 1.42 }
    else if (f & FLAG.respawn) crouch = 0.3
    if ((f & FLAG.dodge) || A.tuck > 0.01) { r.pivot.position.set(0, 0.52, 0); r.offset.position.set(0, -0.52, 0); r.pivot.rotation.set(roll, 0, 0) }
    else if (r.dead) { r.pivot.position.set(0, 0.16, 0.12); r.offset.position.set(0, -0.16, -0.12); r.pivot.rotation.set(topple, 0, 0) }
    else { r.pivot.position.set(0, 0, 0); r.offset.position.set(0, 0, 0); r.pivot.rotation.set(0, 0, 0) }
    // legs: the same planted-foot gait as the local fighter (gait.js)
    const legs = poseLegs(A.gait, B, r.rig, {
      dt, speed: A.speed, fc: A.fwdC, rc: -A.sideC, moveAmt: A.moveAmt, sprintW: A.sprintW, airW: A.airW,
      vy: A.vy, grounded, drop: Math.max(0, -A.landDip) + crouch + 0.3 * A.tuck, tuck: A.tuck, dead: r.dead,
    })
    B.hips.position.y = r.rig.rest.hips.y - legs.drop
    B.hips.rotation.set(0, legs.yaw, legs.roll)
    const runLean = 0.07 * clamp01((A.speed - 2.6) / 1.6) * A.moveAmt * (1 - A.airW)
    const aimW = 1 - A.carryW
    const twist = clamp(-deltaDeg(r.body, r.cam), -80, 80) * DEG * aimW
    const up = clamp(-r.pitch, -60, 60) * DEG * aimW
    const blade = -20 * DEG * aimW
    const breathe = Math.sin(r.t * 1.9) * 0.012
    B.spine.rotation.set(-up * 0.12 + A.sprintW * 0.16 * (1 - legs.airW) + runLean + legs.lean + A.tuck * 0.55 + crouch * 0.35, twist * 0.4 + blade * 0.4 - legs.yaw * 0.85, -legs.roll * 0.7)
    B.chest.rotation.set(-up * 0.26 + breathe + A.tuck * 0.35, twist * 0.6 + blade * 0.6, 0)
    B.neck.rotation.set(-up * 0.15, -blade * 0.5, 0)
    B.head.rotation.set(-up * 0.32 + (r.dead ? 0.5 : 0), -blade * 0.5, 0)
  }
  /** aim direction (game space) from bearing + pitch (Unity: + = down) */
  const aimDir = (r, out) => out.set(Math.sin(r.cam * DEG) * Math.cos(r.pitch * DEG), -Math.sin(r.pitch * DEG), -Math.cos(r.cam * DEG) * Math.cos(r.pitch * DEG))
  function pose(r) {
    r.vroot.position.copy(r.pos)
    r.vroot.rotation.y = rotOf(r.body)
    r.vroot.updateMatrixWorld(true)
    const B = r.rig.bones
    const chest = _v1.set(r.pos.x, r.pos.y + 1.4, r.pos.z)
    const tgt = _v2.copy(chest).addScaledVector(aimDir(r, _v3), 20)
    _v4.lerpVectors(POCKET_HIP, POCKET_ADS, smooth01(r.anim.aimW))
    _v4.x *= r.pocketK || 1
    B.chest.localToWorld(_v4); G.root.worldToLocal(_v4)
    r.socket.position.copy(_v4)
    _m1.lookAt(tgt, _v4, UP)
    _q1.setFromRotationMatrix(_m1)
    if (r.anim.carryW > 0.001) {
      _v3.set(-0.19, -0.02, 0.2); B.chest.localToWorld(_v3); G.root.worldToLocal(_v3)
      B.chest.getWorldQuaternion(_q2)
      G.root.getWorldQuaternion(_q3).invert(); _q2.premultiply(_q3)
      _q3.setFromEuler(_e1.set(0.6, 0.35, 0, 'YXZ'))
      _q2.multiply(_q3)
      r.socket.position.lerp(_v3, r.anim.carryW)
      _q1.slerp(_q2, r.anim.carryW)
    }
    r.socket.quaternion.copy(_q1)
    r.socket.updateMatrixWorld(true)
    if (r.gun && !r.dead) solveArms(r)
    else limpArms(r)
    r.fighter.retarget.apply(r.t, r.anim.moveAmt, r.anim.sprintW)
  }
  function limpArms(r) {
    const B = r.rig.bones
    B.upperArmL.rotation.set(0.15, 0, 0.12); B.foreArmL.rotation.set(-0.25, 0, 0); B.handL.rotation.set(0, 0, 0)
    B.upperArmR.rotation.set(0.15, 0, -0.12); B.foreArmR.rotation.set(-0.25, 0, 0); B.handR.rotation.set(0, 0, 0)
  }
  function solveArms(r) {
    const B = r.rig.bones, W = r.gun, rig = r.rig
    const scale = G.S || 1
    B.chest.getWorldQuaternion(_qh)
    _poleR.set(-0.55, -1, -0.3).applyQuaternion(_qh)
    _poleL.set(0.75, -1, -0.15).applyQuaternion(_qh)
    W.gripR.getWorldPosition(_gr)
    W.gripL.getWorldPosition(_gl)
    B.upperArmL.getWorldPosition(_S)
    const reach = (rig.arm.upper + rig.arm.fore) * 0.97 * scale
    if (_gl.distanceTo(_S) > reach) {
      _dir.subVectors(_gr, _gl); _pp.subVectors(_gl, _S)
      const a = _dir.lengthSq(), b = 2 * _pp.dot(_dir), c = _pp.lengthSq() - reach * reach
      const disc = b * b - 4 * a * c
      const t = a > 1e-12 && disc >= 0 ? clamp((-b - Math.sqrt(disc)) / (2 * a), 0, 1) : 1
      _gl.addScaledVector(_dir, t)
    }
    r.socket.getWorldQuaternion(_qa)
    _qb.setFromEuler(_e1.set(-0.35, 0, 0, 'YXZ'))
    _qa.multiply(_qb)
    solveArm(rig, B.upperArmR, B.foreArmR, B.handR, _gr, _poleR, _qa, scale)
    _qb.setFromEuler(_e1.set(0.2, 0, -1.2, 'YXZ'))
    r.socket.getWorldQuaternion(_qL).multiply(_qb)
    solveArm(rig, B.upperArmL, B.foreArmL, B.handL, _gl, _poleL, _qL, scale)
  }
  function solveArm(rig, upper, fore, hand, target, pole, handQuat, scale) {
    upper.getWorldPosition(_S)
    const a = rig.arm.upper * scale, b = rig.arm.fore * scale
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
  // ---------------------------------------------------------------- their shots: flash, tracer, sound (no damage here: the host applied it)
  const _mz = new THREE.Vector3(), _ad = new THREE.Vector3(), _end = new THREE.Vector3(), _org = new THREE.Vector3()
  function shots(r, dt) {
    if (r.pendingShots <= 0 || !r.gun || r.dead) { if (r.dead) r.pendingShots = 0; return }
    r.shotT -= dt
    if (r.shotT > 0) return
    r.pendingShots--
    r.shotT = 0.05 / Math.max(1, r.pendingShots + 1)
    const d = WEAPONS[r.wid] || WEAPONS.AR7
    r.gun.muzzle.getWorldPosition(_mz); G.root.worldToLocal(_mz)
    aimDir(r, _ad)
    const F = G.fx || {}
    if (F.muzzle) F.muzzle(_mz, _ad, d.muzzle, { light: false })
    if (d.hitscan) {
      _org.set(r.pos.x, r.pos.y + 1.4, r.pos.z)
      let far = d.range || 80
      const hits = G.enemies && G.enemies.raycast ? G.enemies.raycast(_org, _ad, far) : null
      if (hits && hits.length) far = hits[0].distance
      const env = G.world && G.world.raycastEnv ? G.world.raycastEnv(_org, _ad, far) : null
      if (env && env.distance < far) far = env.distance
      _end.copy(_org).addScaledVector(_ad, far)
      if (d.beam && F.beam) F.beam(_mz, _end, d.beam, 0.14)
      else if (d.tracer && F.tracer) F.tracer(_mz, _end, d.tracer)
    }
    if (G.sfx && d.fire) G.sfx(pick(d.fire), { pos: _mz, vol: 0.55, gap: 0.03 })
  }

  return { update, remove, clear, tick, get: id => list.get(id), list, aimDir }
}
