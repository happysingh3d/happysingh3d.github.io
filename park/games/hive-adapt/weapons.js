// Hive Adapt (Project 0 port): the WEAPONS module. The two-slot loadout of the six guns (Weapon.cs, WeaponHolder.cs,
// WeaponInstance.cs, WeaponProgression.cs), shot resolution along the camera ray (PlayerShots.cs: 1 m back-off, friendly
// structures ignored, 0.22 m edge tolerance), projectiles (Projectile.cs: plasma bolt, GL-40 grenade + blast), shell
// casings (ShellCasing.cs), the procedural kick/sway springs, moving parts, sounds and the HUD weapon/crosshair feed.
// Numbers: hive-spec/player-weapons.md §1.8, §2, §3, §4.2. Everything in game space under G.root.
//
// API (createWeapons(G)):
//   load()                    weapon models (GLBs dressed with the W_* library; the AR-7 is procedural), pools; hangs them on G.player.socket
//   update(dt, rdt)           fire / reload / switch / charge, projectiles, shells, kick springs, parts, HUD weapon + crosshair
//   reset({ loadout:[id,id] }) new run: full mags, slot 1 active (weapon XP/levels are kept for the visit)
//   equipSlot(slot, id)       loadout change (gear locker): swaps when the other slot holds id, re-arms at once
//   rearm()                   full mags, reload cancelled
//   select(slot)              switch the active slot (also from 1 / 2 / wheel / touch swap)
//   unlocked(id)              by G.run.level: AR7 1, Plasma 1, Shotgun 3, SMG 5, Marksman 8, Launcher 12
//   unlockedList()            ids in catalog order
//   cancelReload(), cancelCharge(), fireOnce(charge01) (tests: one shot along G.aim now)
// Fields: slots [id, id], active (0|1), current (id), def (table row), inst { id: { ammo, level, xp, kills } }, reloading,
//   charging, charge (0-1), scopeFov (current weapon's scope, 0 = none), range, gripR / gripL / muzzle (Object3D of the
//   current model, for the arm IK), mag (magazine size with mods), ammo.
// Damage: G.enemies.damage(e, { amount, type, source: 'player', sourceId: weaponId, point, dir, weak, part, weakBonus, armorBreak,
//   stagger }). Events: shotFired(id, type), weaponSwitched(id, slot), reloadStarted(id), weaponLevelUp(id, level), loadoutChanged(slots).
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { DEG, clamp, clamp01, lerp, invLerp, roundEven, PAL } from './u.js'
import { buildAR7, glowTexture } from './weaponart.js'

// ------------------------------------------------------------------ the weapon table (D/Weapons/*.asset)
const R = (n, stem) => Array.from({ length: n }, (_, i) => stem + i)
export const WEAPONS = {
  AR7: {
    id: 'AR7', name: 'AR-7', type: 'Ballistic', unlock: 1, damage: 14, rate: 10, auto: true, mag: 30, reload: 2.1, range: 80, hitscan: true,
    hip: 1.4, ads: 0.25, bloom: 0.28, bloomMax: 4, recover: 7, recoilP: 0.85, recoilY: 0.3, shake: 0.05, accent: [1, 0.72, 0.3],
    muzzle: 'ar', tracer: 'bullet', impact: 'sparks', decal: 'bulletHole', shells: true, model: null, magPart: true,
    fire: R(3, 'sfx_rifle_shot_'), reloadSfx: 'sfx_reload_ar',
  },
  Plasma: {
    id: 'Plasma', name: 'PL-2 Plasma', type: 'Energy', unlock: 1, damage: 24, rate: 5, auto: true, mag: 24, reload: 2.4, range: 60, hitscan: false,
    speed: 72, projRadius: 0.12, life: 3, gravity: 0, hip: 0.9, ads: 0.2, bloom: 0.35, bloomMax: 3.5, recover: 6, recoilP: 1.4, recoilY: 0.35,
    shake: 0.08, accent: [0.35, 0.85, 1], muzzle: 'plasma', impact: 'plasmaBurst', decal: 'scorch', model: 'SM_PlasmaRifle', glow: true,
    fire: R(2, 'sfx_plasma_shot_'), reloadSfx: 'sfx_reload_plasma',
  },
  Shotgun: {
    id: 'Shotgun', name: 'SG-12 Breacher', type: 'Ballistic', unlock: 3, damage: 13, rate: 1.25, auto: false, mag: 6, reload: 2.7, range: 40, hitscan: true,
    pellets: 9, pelletCone: 4.2, falloff: [8, 24, 0.25], armorBreak: 1, stagger: 0.45, hip: 1, ads: 0.5, bloom: 0.4, bloomMax: 2, recover: 4,
    recoilP: 3.2, recoilY: 0.8, shake: 0.16, accent: [1, 0.6, 0.25], muzzle: 'shotgun', tracer: 'pellet', impact: 'sparks', decal: 'bulletHole',
    shells: true, model: 'SM_Shotgun', pump: true, cycle: 'sfx_shotgun_pump', cycleDelay: 0.26,
    fire: R(3, 'sfx_shotgun_shot_'), reloadSfx: 'sfx_reload_shotgun',
  },
  SMG: {
    id: 'SMG', name: 'VK-9 SMG', type: 'Ballistic', unlock: 5, damage: 8.5, rate: 15, auto: true, mag: 40, reload: 1.8, range: 55, hitscan: true,
    falloff: [18, 40, 0.6], hip: 2.1, ads: 0.8, bloom: 0.22, bloomMax: 5, recover: 9, recoilP: 0.5, recoilY: 0.35, shake: 0.03,
    accent: [1, 0.78, 0.35], muzzle: 'smg', tracer: 'bullet', impact: 'sparks', decal: 'bulletHole', shells: true, model: 'SM_SMG', magPart: true,
    fire: R(3, 'sfx_smg_shot_'), reloadSfx: 'sfx_reload_smg',
  },
  Marksman: {
    id: 'Marksman', name: 'RX-3 Lancer', type: 'Rail', unlock: 8, damage: 120, rate: 1.1, auto: false, mag: 5, reload: 2.8, range: 140, hitscan: true,
    charge: 0.75, uncharged: 0.35, weakBonus: 1.5, pierce: 3, keep: 0.85, scope: 20, hip: 3, ads: 0, bloom: 0, bloomMax: 0, recover: 6,
    recoilP: 3.5, recoilY: 0.6, shake: 0.12, accent: [0.45, 0.88, 1], muzzle: 'rail', beam: 'rail', impact: 'plasmaBurst', decal: 'scorch',
    model: 'SM_Marksman', magPart: true, glow: true, chargeSfx: 'sfx_marksman_charge',
    fire: R(2, 'sfx_marksman_shot_'), reloadSfx: 'sfx_reload_marksman',
  },
  Launcher: {
    id: 'Launcher', name: 'GL-40 Thumper', type: 'Explosive', unlock: 12, damage: 95, rate: 1, auto: false, mag: 6, reload: 3.3, range: 70, hitscan: false,
    speed: 34, projRadius: 0.08, life: 3.5, gravity: 13, ballistic: true, aoe: 4.5, aoeEdge: 0.3, armorBreak: 0.5, stagger: 0.3,
    hip: 1.2, ads: 0.4, bloom: 0.5, bloomMax: 2, recover: 4, recoilP: 4, recoilY: 0.7, shake: 0.14, accent: [1, 0.5, 0.2], muzzle: 'gl',
    model: 'SM_GrenadeLauncher', drum: true, fire: ['sfx_grenade_launch'], reloadSfx: 'sfx_reload_gl', blast: R(3, 'sfx_explosion_'),
  },
}
export const ORDER = ['AR7', 'Plasma', 'Shotgun', 'SMG', 'Marksman', 'Launcher']
const DEFAULT_LOADOUT = ['AR7', 'Plasma']
/** cumulative weapon XP per level (WeaponData xpCurve: (1,0) (2,100) (5,700) (10,2500) (15,5600) (20,10000)) */
const XP_AT = [0, 0, 100, 260, 453, 700, 988, 1300, 1648, 2044, 2500, 3016, 3584, 4204, 4876, 5600, 6397, 7266, 8178, 9099, 10000]
const MAX_LEVEL = 20
const BACKOFF = 1, EDGE_R = 0.22, EDGE_FRONT = 1.5, EDGE_DEPTH = 0.75, MUZZLE_GRACE = 1.5, POINT_BLANK = 0.45
const pick = arr => arr[(Math.random() * arr.length) | 0]
const jitter = j => 1 + (Math.random() * 2 - 1) * j
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)

export function createWeapons(G) {
  const UP = new THREE.Vector3(0, 1, 0)
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3()
  const _start = new THREE.Vector3(), _dir = new THREE.Vector3(), _centre = new THREE.Vector3(), _muz = new THREE.Vector3(), _end = new THREE.Vector3()
  const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _m1 = new THREE.Matrix4(), _q1 = new THREE.Quaternion(), _e1 = new THREE.Euler()
  const _s1 = new THREE.Vector3(), _impP = new THREE.Vector3(), _impN = new THREE.Vector3(), _blastAt = new THREE.Vector3(), _blastN = new THREE.Vector3()

  const weapons = {
    slots: DEFAULT_LOADOUT.slice(), active: 0, inst: {}, ready: false,
    get current() { return weapons.slots[weapons.active] },
    get def() { return WEAPONS[weapons.slots[weapons.active]] },
    get reloading() { const s = weapons.inst[weapons.current]; return !!(s && s.reloadLeft > 0) },
    get charging() { const s = weapons.inst[weapons.current]; return !!(s && s.charging) },
    get charge() { const s = weapons.inst[weapons.current], d = weapons.def; return s && s.charging && d.charge ? clamp01(s.chargeT / d.charge) : 0 },
    get scopeFov() { const d = weapons.def; return (d && d.scope) || 0 },
    get range() { const d = weapons.def; return (d && d.range) || 80 },
    get mag() { return magSize(weapons.current) },
    get ammo() { const s = weapons.inst[weapons.current]; return s ? s.ammo : 0 },
    gripR: null, gripL: null, muzzle: null,
  }
  for (const id of ORDER) weapons.inst[id] = freshInst(id)
  function freshInst(id) {
    return { id, ammo: WEAPONS[id].mag, level: 1, xp: 0, kills: 0, cool: 0, bloom: 0, reloadLeft: 0, reloadTime: 1, charging: false, chargeT: 0, chargeSfx: 0, cycleT: 99, cycleAt: -1, drum: 0, drumTarget: 0 }
  }

  // ------------------------------------------------------------------ helpers
  const ev = (name, ...a) => { try { G.events && G.events.emit(name, ...a) } catch (e) { /* listener */ } }
  const sfx = (name, o) => (G.sfx ? G.sfx(name, o) : 0)
  const fx = () => G.fx || {}
  const mods = () => { const m = G.run && G.run.mods; return m && typeof m === 'object' ? m : {} }
  const blocked = () => !!(G.hud && G.hud.blocking && G.hud.blocking())
  function magSize(id) { const d = WEAPONS[id]; return d ? Math.max(1, roundEven(d.mag * (1 + num(mods().magazine, 0)))) : 0 }
  function reloadTime(id) { return WEAPONS[id].reload / (1 + num(mods().reload, 0)) }
  function damageOf(id) { const d = WEAPONS[id], s = weapons.inst[id]; return d.damage * (1 + 0.025 * (s.level - 1)) * (1 + num(mods().weaponDamage, 0)) }
  function unlocked(id) { const d = WEAPONS[id]; return !!d && num(G.run && G.run.level, 1) >= d.unlock }
  function unlockedList() { return ORDER.filter(unlocked) }
  const typeColour = {}
  for (const id of ORDER) typeColour[id] = PAL.dmg[WEAPONS[id].type] || PAL.hudAmber
  const accent = {}
  for (const id of ORDER) { const a = WEAPONS[id].accent; accent[id] = new THREE.Color(a[0], a[1], a[2]) }

  // ------------------------------------------------------------------ views (models on the player's socket)
  const views = {}
  let kick = null, holder = null
  const kickPos = new THREE.Vector3(), kickPosV = new THREE.Vector3(), kickRot = new THREE.Vector3(), kickRotV = new THREE.Vector3()
  let crossKick = 0, bobT = 0

  async function load() {
    holder = (G.player && G.player.socket) || new THREE.Group()
    if (!holder.parent) G.root.add(holder)
    kick = new THREE.Group()
    kick.name = 'WeaponKick'
    holder.add(kick)
    const A = G.assets
    for (const id of ORDER) {
      const d = WEAPONS[id]
      let model
      try {
        if (d.model) {
          model = await A.clone(d.model)
          const glow = A.mat('M_EmissiveCyan').clone()
          A.dress(model, d.glow ? { M_EmissiveCyan: glow } : {})
          model.scale.x = -1 // the GLBs have their ejection side on +X: mirror it to the shooter's right (-X)
          model.userData.glow = d.glow ? glow : null
        } else model = buildAR7(A)
      } catch (e) {
        G.log && G.log('weapon model ' + id + ' failed: ' + (e && e.message || e))
        model = buildAR7(A)
      }
      views[id] = makeView(id, model)
    }
    buildPools()
    if (G.events && G.events.on) G.events.on('enemyKilled', onKill)
    reset({ loadout: DEFAULT_LOADOUT })
    weapons.ready = true
  }
  function makeView(id, model) {
    const root = new THREE.Group()
    root.name = 'Weapon_' + id
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const gr = model.getObjectByName('Grip_R')
    const gripLocal = gr ? gr.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, -0.08, box.min.z + 0.3)
    root.add(model)
    root.visible = false
    kick.add(root)
    const find = n => model.getObjectByName(n) || null
    const v = { id, root, model, box, gripLocal, muzzle: find('Muzzle'), gripR: find('Grip_R'), gripL: find('Grip_L'), eject: find('Eject'), pump: find('Pump'), drum: find('Drum'), mag: find('Mag'), glow: model.userData.glow || null }
    if (!v.muzzle) { v.muzzle = new THREE.Object3D(); v.muzzle.position.set(0, 0, box.max.z); model.add(v.muzzle) }
    if (!v.gripR) { v.gripR = new THREE.Object3D(); v.gripR.position.set(0, -0.08, box.min.z + 0.3); model.add(v.gripR) }
    if (!v.gripL) { v.gripL = new THREE.Object3D(); v.gripL.position.set(0, -0.03, box.min.z + 0.7); model.add(v.gripL) }
    if (!v.eject) { v.eject = new THREE.Object3D(); v.eject.position.set(0.03, 0.01, 0); model.add(v.eject) }
    v.pumpRest = v.pump ? v.pump.position.z : 0
    placeRoot(v, 'shoulder')
    return v
  }
  /** shoulder: Unity's mount (the stock 0.04 m behind the pivot, the top of the gun 0.05 m below it); hand / float: the grip at the pivot */
  function placeRoot(v, mount) {
    if (mount === 'shoulder') v.root.position.set(0, -0.05 - v.box.max.y, -0.04 - v.box.min.z)
    else v.root.position.copy(v.gripLocal).negate()
    v.mount = mount
  }
  function showView(id) {
    for (const k of ORDER) if (views[k]) views[k].root.visible = k === id
    const v = views[id]
    weapons.gripR = v ? v.gripR : null
    weapons.gripL = v ? v.gripL : null
    weapons.muzzle = v ? v.muzzle : null
  }
  function muzzlePos(out) {
    const v = views[weapons.current]
    if (!v || !holder) return out.copy(G.aim.origin)
    holder.updateMatrixWorld(true)
    v.muzzle.getWorldPosition(out)
    return G.root.worldToLocal(out)
  }

  // ------------------------------------------------------------------ pools: projectiles, shells, smoke puffs
  const bolts = [], grenades = [], live = []
  let shellMesh = null
  const shells = []
  const SHELLS = 36
  function buildPools() {
    const glowTex = glowTexture(64, 2)
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 1.5, 2.1), fog: false })
    const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.2, 0.75, 1.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })
    const streakMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0.15, 0.6, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide })
    const coreGeo = new THREE.SphereGeometry(0.06, 10, 8)
    // the trail: two crossed quads in one geometry, along -Z (behind the bolt), length 1 (scaled by the distance flown)
    const sA = new THREE.PlaneGeometry(0.16, 1), sB = new THREE.PlaneGeometry(0.16, 1)
    sA.rotateX(-Math.PI / 2); sB.rotateX(-Math.PI / 2); sB.rotateZ(Math.PI / 2)
    const streakGeo = mergeGeometries([sA, sB]); streakGeo.translate(0, 0, -0.5)
    for (let i = 0; i < 20; i++) {
      const g = new THREE.Group()
      g.name = 'PlasmaBolt'
      const core = new THREE.Mesh(coreGeo, coreMat)
      const halo = new THREE.Sprite(haloMat); halo.scale.setScalar(0.62)
      const streak = new THREE.Mesh(streakGeo, streakMat)
      g.add(core, halo, streak)
      g.visible = false
      G.root.add(g)
      bolts.push({ kind: 'bolt', obj: g, streak, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, travelled: 0, grace: 0, active: false, puffT: 0, def: null, amount: 0 })
    }
    const slugGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 10)
    slugGeo.rotateX(Math.PI / 2)
    const tipGeo = new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    tipGeo.rotateX(Math.PI / 2); tipGeo.translate(0, 0, 0.05)
    const fuseMat = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.6, 0.7, 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group()
      g.name = 'Grenade'
      const slug = new THREE.Mesh(slugGeo, G.assets.mat('W_OD'))
      const tip = new THREE.Mesh(tipGeo, G.assets.mat('M_Brass'))
      const fuse = new THREE.Sprite(fuseMat); fuse.scale.setScalar(0.32); fuse.position.z = -0.06
      g.add(slug, tip, fuse)
      g.visible = false
      G.root.add(g)
      grenades.push({ kind: 'grenade', obj: g, fuse, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, travelled: 0, grace: 0, active: false, puffT: 0, def: null, amount: 0 })
    }
    // shell casings: one instanced mesh
    G.assets.glb('SM_ShellCasing').then(gltf => {
      let geo = null
      gltf.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry })
      if (!geo) { geo = new THREE.CylinderGeometry(0.005, 0.005, 0.046, 6) }
      shellMesh = new THREE.InstancedMesh(geo, G.assets.mat('M_Brass'), SHELLS)
      shellMesh.name = 'ShellCasings'
      shellMesh.frustumCulled = false
      shellMesh.castShadow = false
      shellMesh.count = SHELLS
      for (let i = 0; i < SHELLS; i++) { shellMesh.setMatrixAt(i, _m1.makeScale(0, 0, 0)); shells.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), age: 99, floor: 0, tink: false, rest: false }) }
      G.root.add(shellMesh)
    }).catch(e => G.log && G.log('shell casing model: ' + (e && e.message || e)))
  }
  let shellNext = 0
  function ejectShell() {
    if (!shellMesh) return
    const v = views[weapons.current]
    const s = shells[shellNext]; shellNext = (shellNext + 1) % SHELLS
    v.eject.getWorldPosition(s.pos); G.root.worldToLocal(s.pos)
    holder.getWorldQuaternion(_q1)
    _v1.set(-1, 0, 0).applyQuaternion(_q1) // the gun's right
    _v2.set(0, 1, 0).applyQuaternion(_q1)
    s.vel.copy(_v1).multiplyScalar(2.2 + Math.random()).addScaledVector(_v2, 1.2 + Math.random() * 0.8)
    if (G.player && G.player.vel) s.vel.x += G.player.vel.x * 0.8, s.vel.z += G.player.vel.z * 0.8
    s.q.copy(_q1)
    s.w.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(25 * Math.random())
    s.age = 0; s.tink = false; s.rest = false
    const gp = G.player && G.player.pos
    s.floor = gp ? gp.y : s.pos.y - 1.3
    if (G.world && G.world.groundY) { const gy = G.world.groundY(s.pos.x + s.vel.x * 0.3, s.pos.z + s.vel.z * 0.3, s.pos.y); if (isFinite(gy) && gy <= s.pos.y) s.floor = gy }
  }
  function updateShells(dt) {
    if (!shellMesh) return
    let dirty = false
    for (let i = 0; i < SHELLS; i++) {
      const s = shells[i]
      if (s.age >= 2.5) continue
      s.age += dt
      dirty = true
      if (s.age >= 2.5) { shellMesh.setMatrixAt(i, _m1.makeScale(0, 0, 0)); continue }
      if (!s.rest) {
        s.vel.y -= 9.81 * dt
        s.pos.addScaledVector(s.vel, dt)
        const a = s.w.length()
        if (a > 1e-4) { _q1.setFromAxisAngle(_v1.copy(s.w).multiplyScalar(1 / a), a * dt); s.q.premultiply(_q1) }
        if (s.pos.y < s.floor + 0.006 && s.vel.y < 0) {
          s.pos.y = s.floor + 0.006
          if (!s.tink) { s.tink = true; sfx(pick(['sfx_shell_0', 'sfx_shell_1', 'sfx_shell_2']), { pos: s.pos, vol: 0.25, rate: jitter(0.2), gap: 0.02 }) }
          s.vel.y = -s.vel.y * 0.32; s.vel.x *= 0.5; s.vel.z *= 0.5; s.w.multiplyScalar(0.45)
          if (s.vel.y < 0.45) {
            s.rest = true
            // lie flat on its side
            _e1.setFromQuaternion(s.q); _e1.x = Math.PI / 2; _e1.z = 0; s.q.setFromEuler(_e1)
          }
        }
      }
      const k = s.age > 2.2 ? (2.5 - s.age) / 0.3 : 1
      _m1.compose(s.pos, s.q, _s1.setScalar(k))
      shellMesh.setMatrixAt(i, _m1)
    }
    if (dirty) shellMesh.instanceMatrix.needsUpdate = true
  }

  // ------------------------------------------------------------------ damage info ring (no per-hit allocation)
  const infoRing = []
  for (let i = 0; i < 48; i++) infoRing.push(newInfo())
  let infoNext = 0
  function newInfo() { return { amount: 0, type: 'Ballistic', source: 'player', sourceId: '', point: new THREE.Vector3(), dir: new THREE.Vector3(), weak: false, part: undefined, weakBonus: 0, armorBreak: 0, stagger: 0 } }
  function info(d, amount, point, dir, weak, part) {
    const o = infoRing[infoNext]; infoNext = (infoNext + 1) % infoRing.length
    o.amount = amount; o.type = d.type; o.source = 'player'; o.sourceId = d.id
    o.point.copy(point); o.dir.copy(dir); o.weak = !!weak; o.part = part
    o.weakBonus = d.weakBonus || 0; o.armorBreak = d.armorBreak || 0; o.stagger = d.stagger || 0
    return o
  }

  // ------------------------------------------------------------------ shot resolution (PlayerShots.Trace)
  const hitRec = () => ({ kind: 'none', enemy: null, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), weak: false, part: undefined, edge: false })
  const T = hitRec()
  const bugs = [] // copied enemy hits along the centre ray (enemies.raycast reuses its array)
  for (let i = 0; i < 24; i++) bugs.push(hitRec())
  let bugCount = 0
  const edgeOut = []
  for (let i = 0; i < 8; i++) edgeOut.push(hitRec())
  let edgeCount = 0
  function copyHit(dst, h) { dst.kind = 'enemy'; dst.enemy = h.enemy; dst.distance = h.distance; dst.point.copy(h.point); dst.weak = !!h.weak; dst.part = h.part; dst.edge = false; return dst }
  /** live bugs along start + dir (sorted), copied into bugs[] */
  function castBugs(start, dir, reach) {
    bugCount = 0
    const hits = G.enemies && G.enemies.raycast ? G.enemies.raycast(start, dir, reach) : null
    if (!hits) return 0
    for (let i = 0; i < hits.length && bugCount < bugs.length; i++) if (hits[i].enemy && hits[i].enemy.alive) copyHit(bugs[bugCount++], hits[i])
    return bugCount
  }
  /** distance (from start) of the first shot-blocking surface beyond the back-off, or Infinity; normal in _w */
  function castWall(origin, dir, range, outPoint) {
    const env = G.world && G.world.raycastEnv ? G.world.raycastEnv(origin, dir, range) : null
    if (!env) return Infinity
    outPoint.copy(env.point); _w.copy(env.normal)
    return BACKOFF + env.distance
  }
  /** bugs the edge tolerance hands a round stopped by geometry at wallD: within EDGE_R of the ray, from wallD - 1.5 to wallD + 0.75 */
  function edgeBugs(start, dir, wallD, skip) {
    edgeCount = 0
    const lo = wallD - EDGE_FRONT, hi = wallD + EDGE_DEPTH
    const consider = (h, edge) => {
      if (!h.enemy || !h.enemy.alive || h.distance < lo || h.distance > hi) return
      if (skip && skip.indexOf(h.enemy) >= 0) return
      for (let i = 0; i < edgeCount; i++) if (edgeOut[i].enemy === h.enemy) { if (h.distance < edgeOut[i].distance) copyHit(edgeOut[i], h).edge = edge; return }
      if (edgeCount < edgeOut.length) copyHit(edgeOut[edgeCount++], h).edge = edge
    }
    for (let i = 0; i < bugCount; i++) consider(bugs[i], false)
    // the sphere sweep's rim: four rays offset by EDGE_R around the centre line
    if (G.enemies && G.enemies.raycast) {
      _u.set(0, 1, 0)
      if (Math.abs(dir.y) > 0.95) _u.set(1, 0, 0)
      _u.crossVectors(_u, dir).normalize()
      _v4.crossVectors(dir, _u).normalize()
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2
        _v3.copy(start).addScaledVector(_u, Math.cos(a) * EDGE_R).addScaledVector(_v4, Math.sin(a) * EDGE_R)
        const hits = G.enemies.raycast(_v3, dir, hi)
        for (let i = 0; i < hits.length; i++) consider(hits[i], true)
      }
    }
    // nearest first
    for (let i = 1; i < edgeCount; i++) for (let j = i; j > 0 && edgeOut[j].distance < edgeOut[j - 1].distance; j--) { const t = edgeOut[j]; edgeOut[j] = edgeOut[j - 1]; edgeOut[j - 1] = t }
    return edgeCount
  }
  /** the first thing a round along origin + dir strikes (into T) */
  function trace(origin, dir, range) {
    _start.copy(origin).addScaledVector(dir, -BACKOFF)
    const reach = range + BACKOFF
    castBugs(_start, dir, reach)
    const wall = castWall(origin, dir, range, _v2)
    T.edge = false
    if (bugCount && bugs[0].distance <= wall) { copyHit(T, bugs[0]); return T }
    if (wall === Infinity) { T.kind = 'none'; T.enemy = null; T.distance = reach; T.point.copy(_start).addScaledVector(dir, reach); return T }
    if (edgeBugs(_start, dir, wall, null) > 0) { copyHit(T, edgeOut[0]); T.edge = true; return T }
    T.kind = 'env'; T.enemy = null; T.distance = wall; T.point.copy(_v2); T.normal.copy(_w); T.weak = false; T.part = undefined
    return T
  }

  // ------------------------------------------------------------------ hit feedback for one shot
  const shot = { impacts: 0, decals: 0, marker: 0, kill: false, hit: false }
  function beginShot() { shot.impacts = 0; shot.decals = 0; shot.marker = 0; shot.kill = false; shot.hit = false }
  function endShot() {
    if (!shot.hit) return
    const h = G.hud
    if (h && h.hitmarker) h.hitmarker(shot.kill ? 'kill' : shot.marker >= 1 ? 'weak' : 'normal')
    // a kill's confirm sound, hit-stop, shake and streak belong to run.js (CombatFeedback); a plain hit gets the hitmarker tick
    if (!shot.kill) sfx('sfx_hitmarker', { vol: shot.marker >= 1 ? 0.55 : 0.3, rate: shot.marker >= 1 ? 1.25 : 1 })
  }
  const GOO = { normal: new THREE.Vector3(), dir: new THREE.Vector3(), colour: undefined, color: undefined }
  const HIT = { normal: new THREE.Vector3(), colour: null }
  const DEC = { life: 10, scale: undefined }
  /** apply one round's damage to a bug + the number, goo and flesh sound */
  function hitEnemy(d, e, amount, point, dir, weak, part) {
    if (!e || !e.alive) return 0
    const wasAlive = e.alive
    const weakHit = !!weak && e.weakOpen !== false
    const final = G.enemies.damage(e, info(d, amount, point, dir, weak, part)) || 0
    const killed = wasAlive && !e.alive
    shot.hit = true
    if (killed) shot.kill = true
    if (weakHit && final > 0) shot.marker = 1
    const F = fx()
    if (final > 0 && F.number) F.number(point, final, killed ? 'kill' : weakHit ? 'weak' : 'normal')
    const col = e.data && e.data.mat ? e.data.mat.emis : undefined
    GOO.normal.copy(dir).negate(); GOO.dir.copy(dir); GOO.colour = GOO.color = col
    if (F.burst) F.burst('goo', point, GOO)
    if (shot.impacts++ < 2) sfx(pick(['sfx_flesh_impact_0', 'sfx_flesh_impact_1', 'sfx_flesh_impact_2']), { pos: point, vol: 0.5, rate: jitter(0.15), gap: 0.02 })
    return final
  }
  function hitEnv(d, point, normal) {
    const F = fx()
    HIT.normal.copy(normal); HIT.colour = d.accent
    if (F.burst) F.burst(d.impact || 'sparks', point, HIT)
    DEC.life = 10; DEC.scale = d.decal === 'scorch' ? 0.5 : undefined
    if (shot.decals++ < 3 && F.decal) F.decal(point, normal, d.decal || 'bulletHole', DEC)
    if (shot.impacts++ < 2) sfx(pick(['sfx_impact_hard_0', 'sfx_impact_hard_1', 'sfx_impact_hard_2']), { pos: point, vol: 0.35, rate: jitter(0.15), gap: 0.02 })
  }
  function falloff(d, amount, from, at) {
    if (!d.falloff) return amount
    const [a, b, min] = d.falloff
    return amount * lerp(1, min, invLerp(a, b, from.distanceTo(at)))
  }

  // ------------------------------------------------------------------ firing
  function spreadDir(dir, deg, out) {
    out.copy(dir)
    if (deg <= 0.001) return out
    const t = Math.tan(deg * DEG), r = Math.sqrt(Math.random()) * t, a = Math.random() * Math.PI * 2
    _u.set(0, 1, 0)
    if (Math.abs(dir.y) > 0.95) _u.set(1, 0, 0)
    _u.crossVectors(_u, dir).normalize()
    _v4.crossVectors(dir, _u)
    return out.addScaledVector(_u, Math.cos(a) * r).addScaledVector(_v4, Math.sin(a) * r).normalize()
  }
  /** Weapon.TryFire: one trigger pull of the current weapon along G.aim (charge01 scales the RX-3) */
  function tryFire(charge01 = 1) {
    const id = weapons.current, d = WEAPONS[id], s = weapons.inst[id]
    if (s.reloadLeft > 0 || s.cool > 0) return false
    if (s.ammo <= 0) { emptyClick(); startReload(); return false }
    s.ammo--
    s.cool += 1 / d.rate
    s.charging = false; s.chargeT = 0; stopChargeSfx(s)
    const aiming = !!(G.player && G.player.aiming)
    const spread = (aiming ? d.ads : d.hip) + s.bloom
    s.bloom = Math.min(s.bloom + d.bloom, d.bloomMax)
    const aim = G.aim
    spreadDir(aim.dir, spread, _centre)
    const charge = clamp01(charge01)
    let amount = damageOf(id)
    if (d.charge) amount *= lerp(d.uncharged, 1, charge)
    muzzlePos(_muz)
    beginShot()
    const pellets = Math.max(1, d.pellets || 1)
    for (let p = 0; p < pellets; p++) {
      if (pellets > 1) spreadDir(_centre, d.pelletCone, _dir); else _dir.copy(_centre)
      if (d.hitscan) fireRay(d, aim.origin, _dir, _muz, amount)
      else fireProjectile(d, aim.origin, _dir, _muz, amount)
    }
    endShot()
    presentation(d, s, _muz, charge)
    const k = d.charge ? lerp(0.45, 1, charge) : 1
    const pitch = d.recoilP * (aiming ? 0.6 : 1) * k, yaw = (Math.random() * 2 - 1) * d.recoilY * k
    if (G.player && G.player.addRecoil) G.player.addRecoil(pitch, yaw)
    if (G.kick) G.kick(pitch * 0.6, -yaw * 0.4, (Math.random() * 2 - 1) * 0.4)
    if (G.shake) G.shake(d.shake)
    if (d.cycle) s.cycleAt = G.time + d.cycleDelay
    s.cycleT = 0
    if (d.drum) s.drumTarget += 360 / d.mag
    crossKick = 1
    ev('shotFired', id, d.type)
    if (s.ammo === 0) startReload()
    return true
  }
  function fireRay(d, origin, dir, muzzle, amount) {
    if (d.pierce) _end.copy(firePiercing(d, origin, dir, muzzle, amount))
    else {
      const h = trace(origin, dir, d.range)
      if (h.kind === 'enemy') { hitEnemy(d, h.enemy, falloff(d, amount, muzzle, h.point), h.point, dir, h.weak, h.part); _end.copy(h.point) }
      else if (h.kind === 'env') { hitEnv(d, h.point, h.normal); _end.copy(h.point) }
      else _end.copy(origin).addScaledVector(dir, d.range)
    }
    const F = fx()
    if (d.beam) { if (F.beam) F.beam(muzzle, _end, d.beam, 0.14) }
    else if (d.tracer && F.tracer) F.tracer(muzzle, _end, d.tracer)
  }
  const pierced = []
  /** RX-3: each distinct live bug once, nearest first, up to 1 + pierce; stops at the first wall (edge bugs still take it) */
  function firePiercing(d, origin, dir, muzzle, amount) {
    _start.copy(origin).addScaledVector(dir, -BACKOFF)
    const reach = d.range + BACKOFF
    castBugs(_start, dir, reach)
    const wall = castWall(origin, dir, d.range, _v2)
    pierced.length = 0
    let left = d.pierce
    for (let i = 0; i < bugCount; i++) {
      const h = bugs[i]
      if (h.distance > wall) break
      hitEnemy(d, h.enemy, falloff(d, amount, muzzle, h.point), h.point, dir, h.weak, h.part)
      pierced.push(h.enemy)
      if (left-- <= 0) return h.point
      amount *= d.keep
    }
    if (wall === Infinity) return _v1.copy(_start).addScaledVector(dir, reach)
    _v1.copy(_v2); const nx = _w.x, ny = _w.y, nz = _w.z // edgeBugs clobbers _w via nothing, but keep the wall hit safe
    const n = edgeBugs(_start, dir, wall, pierced)
    for (let i = 0; i < n; i++) {
      const h = edgeOut[i]
      hitEnemy(d, h.enemy, falloff(d, amount, muzzle, h.point), h.point, dir, h.weak, h.part)
      if (left-- <= 0) return h.point
      amount *= d.keep
    }
    hitEnv(d, _v1, _v3.set(nx, ny, nz))
    return _v1
  }
  /** Weapon.BallisticVelocity: the low arc through `to` at this speed under g; false = out of reach */
  function ballisticVelocity(from, to, speed, g, out) {
    _v3.subVectors(to, from)
    const x = Math.hypot(_v3.x, _v3.z), y = _v3.y, s2 = speed * speed
    out.copy(_v3).normalize().multiplyScalar(speed)
    if (x < 0.05 || g <= 0) return false
    const disc = s2 * s2 - g * (g * x * x + 2 * y * s2)
    if (disc < 0) return false
    const tan = (s2 - Math.sqrt(disc)) / (g * x)
    out.set(_v3.x / x, tan, _v3.z / x).normalize().multiplyScalar(speed)
    return true
  }
  function fireProjectile(d, origin, dir, muzzle, amount) {
    const h = trace(origin, dir, d.range)
    const hitSomething = h.kind !== 'none'
    _end.copy(hitSomething ? h.point : _v1.copy(origin).addScaledVector(dir, d.range))
    _v2.copy(muzzle)
    if (h.kind === 'enemy' && _v3.subVectors(_end, muzzle).dot(dir) < POINT_BLANK) _v2.copy(_end).addScaledVector(dir, -POINT_BLANK)
    const pool = d.aoe ? grenades : bolts
    let p = null
    for (const q of pool) if (!q.active) { p = q; break }
    if (!p) p = pool[(Math.random() * pool.length) | 0] // all in flight: recycle one
    p.vel.subVectors(_end, _v2)
    if (p.vel.lengthSq() < 1e-8) p.vel.copy(dir)
    p.vel.normalize().multiplyScalar(d.speed)
    if (d.ballistic && d.gravity > 0 && !ballisticVelocity(_v2, _end, d.speed, d.gravity, p.vel)) p.vel.copy(dir).addScaledVector(UP, 0.12).normalize().multiplyScalar(d.speed)
    p.pos.copy(_v2)
    p.grace = clamp(_v2.distanceTo(_end) - 0.3, 0, MUZZLE_GRACE)
    p.travelled = 0; p.life = 0; p.puffT = 0
    p.def = d
    p.amount = amount
    if (!p.active) { p.active = true; live.push(p) }
    p.obj.visible = true
    orient(p)
  }
  function orient(p) {
    p.obj.position.copy(p.pos)
    if (p.vel.lengthSq() > 1e-8) { _v1.copy(p.pos).add(p.vel); _m1.lookAt(_v1, p.pos, UP); p.obj.quaternion.setFromRotationMatrix(_m1) }
  }
  function presentation(d, s, muzzle, charge) {
    const F = fx()
    holder.getWorldQuaternion(_q1)
    _v1.set(0, 0, 1).applyQuaternion(_q1)
    if (F.muzzle) F.muzzle(muzzle, _v1, d.muzzle) // the flash brings the weapon's muzzle light
    sfx(pick(d.fire), { pos: muzzle, vol: 0.9, rate: jitter(0.05) })
    if (d.shells) ejectShell()
    kickPosV.x += (Math.random() * 2 - 1) * 0.2; kickPosV.y += 0.25; kickPosV.z -= 1.6
    kickRotV.x += -d.recoilP * 55 * (d.charge ? lerp(0.45, 1, charge) : 1); kickRotV.y += (Math.random() * 2 - 1) * 12; kickRotV.z += (Math.random() * 2 - 1) * 18
  }
  function emptyClick() { sfx('sfx_empty_click', { pos: G.player ? G.player.pos : undefined, vol: 0.6, rate: jitter(0.02) }) }

  // ------------------------------------------------------------------ reload, charge, switching
  function startReload() {
    const id = weapons.current, s = weapons.inst[id]
    if (s.reloadLeft > 0 || s.ammo >= magSize(id)) return false
    cancelCharge()
    s.reloadTime = reloadTime(id)
    s.reloadLeft = s.reloadTime
    sfx(WEAPONS[id].reloadSfx, { pos: G.player ? G.player.pos : undefined, vol: 0.7, rate: jitter(0.03) })
    ev('reloadStarted', id)
    return true
  }
  function cancelReload() { const s = weapons.inst[weapons.current]; if (s) s.reloadLeft = 0 }
  function stopChargeSfx(s) { if (s.chargeSfx) { if (G.sfxStop) G.sfxStop(s.chargeSfx); s.chargeSfx = 0 } }
  function cancelCharge() { const s = weapons.inst[weapons.current]; if (s && s.charging) { s.charging = false; s.chargeT = 0; stopChargeSfx(s) } }
  function beginCharge() {
    const id = weapons.current, d = WEAPONS[id], s = weapons.inst[id]
    if (!d.charge || s.reloadLeft > 0 || s.cool > 0 || s.charging) return false
    if (s.ammo <= 0) { emptyClick(); startReload(); return false }
    s.charging = true; s.chargeT = 0
    s.chargeSfx = sfx(d.chargeSfx, { pos: G.player ? G.player.pos : undefined, vol: 0.4, rate: jitter(0.03) }) || 0
    return true
  }
  function releaseCharge() {
    const id = weapons.current, d = WEAPONS[id], s = weapons.inst[id]
    if (!s.charging) return false
    const c = clamp01(s.chargeT / d.charge)
    s.charging = false; s.chargeT = 0; stopChargeSfx(s)
    return tryFire(c)
  }
  function select(slot, force) {
    slot = ((slot % 2) + 2) % 2
    if (slot === weapons.active && !force) return
    cancelReload(); cancelCharge()
    weapons.active = slot
    const s = weapons.inst[weapons.current]
    s.cool = Math.max(0, s.cool)
    showView(weapons.current)
    if (!force) { sfx('ui_click', { vol: 0.5, rate: jitter(0.05) }); ev('weaponSwitched', weapons.current, slot) }
  }
  function resolveLoadout(want) {
    const out = []
    for (let i = 0; i < 2; i++) {
      let id = want && want[i]
      if (!WEAPONS[id] || !unlocked(id) || out.indexOf(id) >= 0) id = DEFAULT_LOADOUT[i]
      if (!unlocked(id) || out.indexOf(id) >= 0) id = ORDER.find(k => unlocked(k) && out.indexOf(k) < 0) || ORDER[i]
      out.push(id)
    }
    return out
  }
  function rearm() {
    for (const id of ORDER) { const s = weapons.inst[id]; s.ammo = magSize(id); s.reloadLeft = 0; s.charging = false; s.chargeT = 0; stopChargeSfx(s); s.cool = 0; s.bloom = 0 }
  }
  function equipSlot(slot, id) {
    if (!WEAPONS[id] || (slot !== 0 && slot !== 1)) return false
    const other = 1 - slot
    cancelReload(); cancelCharge()
    if (weapons.slots[other] === id) { weapons.slots[other] = weapons.slots[slot] }
    weapons.slots[slot] = id
    for (const k of weapons.slots) { const s = weapons.inst[k]; s.ammo = magSize(k); s.reloadLeft = 0 }
    showView(weapons.current)
    return true
  }
  function reset(opts = {}) {
    weapons.slots = resolveLoadout(opts.loadout || weapons.slots)
    weapons.active = 0
    rearm()
    for (const p of live) { p.active = false; p.obj.visible = false }
    live.length = 0
    for (let i = 0; i < shells.length; i++) shells[i].age = 99
    if (shellMesh) { for (let i = 0; i < SHELLS; i++) shellMesh.setMatrixAt(i, _m1.makeScale(0, 0, 0)); shellMesh.instanceMatrix.needsUpdate = true }
    kickPos.set(0, 0, 0); kickPosV.set(0, 0, 0); kickRot.set(0, 0, 0); kickRotV.set(0, 0, 0)
    if (kick) showView(weapons.current)
  }

  // ------------------------------------------------------------------ weapon progression (WeaponProgression.cs)
  function levelFor(xp) { let l = 1; for (let i = 2; i <= MAX_LEVEL; i++) { if (xp >= XP_AT[i]) l = i; else break } return l }
  function onKill(e, inf) {
    if (!inf || inf.source !== 'player' || inf.culled) return
    const s = weapons.inst[inf.sourceId]
    if (!s) return
    s.kills++
    const xp = (e && e.data && e.data.xpReward) || 0
    if (xp <= 0) return
    s.xp += xp
    const l = levelFor(s.xp)
    if (l > s.level) { s.level = l; ev('weaponLevelUp', s.id, l) }
  }

  // ------------------------------------------------------------------ update
  function tickWeapon(d, s, dt) {
    s.cool -= dt
    s.bloom = Math.max(0, s.bloom - d.recover * dt)
    if (s.charging) s.chargeT += dt
    if (s.cycleAt > 0 && G.time >= s.cycleAt) { s.cycleAt = -1; if (d.cycle) sfx(d.cycle, { pos: G.player ? G.player.pos : undefined, vol: 0.7, rate: jitter(0.04) }) }
    if (s.reloadLeft > 0) {
      s.reloadLeft -= dt
      if (s.reloadLeft <= 0) { s.reloadLeft = 0; s.ammo = magSize(d.id) }
    }
  }
  function update(dt, rdt) {
    if (!weapons.ready) return
    const P = G.player || {}
    const run = G.state === 'run'
    const id = weapons.current, d = WEAPONS[id], s = weapons.inst[id]
    if (s.ammo > magSize(id)) s.ammo = magSize(id)
    tickWeapon(d, s, dt)
    const isBlocked = blocked()
    const canAct = run && P.state === 'alive' && !isBlocked && !P.dodging
    if (P.state === 'dead' || P.dodging) { cancelReload(); cancelCharge() }
    else if (!canAct) cancelCharge()
    const inp = G.input || { pressed: new Set(), look: { dx: 0, dy: 0 } }
    if (canAct) {
      const pr = inp.pressed
      if (pr.has('weapon1')) select(0)
      else if (pr.has('weapon2')) select(1)
      else if (pr.has('next')) select(weapons.active + 1)
      else if (pr.has('prev')) select(weapons.active - 1)
      const cd = WEAPONS[weapons.current], cs = weapons.inst[weapons.current]
      if (cd.charge) {
        const held = !!inp.fireHeld
        if (held && !cs.charging) { if (P.sprinting) P.cancelSprint && P.cancelSprint(); else beginCharge() }
        else if (!held && cs.charging) releaseCharge()
      } else {
        const trig = cd.auto ? !!inp.fireHeld : pr.has('fire')
        if (trig) {
          if (P.sprinting) { if (P.cancelSprint) P.cancelSprint() }
          else if (cd.auto) { let n = 0; while (cs.cool <= 0 && n < 4) { if (!tryFire(1)) break; n++ } }
          else tryFire(1)
        }
        if (!trig || cs.ammo <= 0 || cs.reloadLeft > 0) cs.cool = Math.max(0, cs.cool)
      }
      if (pr.has('reload')) startReload()
    }
    if (!canAct || WEAPONS[weapons.current].charge) { const cs = weapons.inst[weapons.current]; if (!cs.charging) cs.cool = Math.max(0, cs.cool) }
    animateView(dt, rdt, canAct ? inp : null)
    updateProjectiles(dt)
    updateShells(dt)
    crossKick = Math.max(0, crossKick - rdt * 8)
    if (run) feedHud()
  }
  /** procedural kick / sway / reload tilt (Weapon.AnimateKick, AddSway) and the moving parts */
  function animateView(dt, rdt, inp) {
    if (!kick) return
    const id = weapons.current, d = WEAPONS[id], s = weapons.inst[id], v = views[id]
    const P = G.player || {}
    const mount = P.mount || 'shoulder'
    if (v.mount !== mount) placeRoot(v, mount)
    if (inp && dt > 0) {
      const aiming = !!P.aiming
      const sens = 0.12 * (aiming ? (d.scope ? 0.32 : 0.65) : 1)
      const k = aiming ? 0.25 : 1
      const lx = (inp.look.dx || 0) * sens, ly = -(inp.look.dy || 0) * sens
      kickRotV.x += ly * 1.5 * k; kickRotV.y += -lx * 1.5 * k; kickRotV.z += -lx * 1.2 * k
      const speed = P.planarSpeed || 0
      bobT += dt
      const f = 5.5 + speed * 1.1
      const b = Math.min(speed, 7) * 0.9 * k * dt
      kickPosV.x += Math.cos(bobT * f * 0.5) * b; kickPosV.y += Math.sin(bobT * f) * b
    }
    // springs (two sub-steps above 30 fps steps keep them stable)
    const n = dt > 0.02 ? 2 : 1, h = dt / n
    for (let i = 0; i < n; i++) {
      kickPosV.x += (-kickPos.x * 260 - kickPosV.x * 22) * h; kickPosV.y += (-kickPos.y * 260 - kickPosV.y * 22) * h; kickPosV.z += (-kickPos.z * 260 - kickPosV.z * 22) * h
      kickPos.addScaledVector(kickPosV, h)
      kickRotV.x += (-kickRot.x * 240 - kickRotV.x * 20) * h; kickRotV.y += (-kickRot.y * 240 - kickRotV.y * 20) * h; kickRotV.z += (-kickRot.z * 240 - kickRotV.z * 20) * h
      kickRot.addScaledVector(kickRotV, h)
    }
    let rx = 0, ry = 0, rz = 0
    const t = s.reloadLeft > 0 ? 1 - s.reloadLeft / s.reloadTime : 0
    if (s.reloadLeft > 0) { const tilt = Math.sin(clamp01(t / 0.9) * Math.PI); rx = -12 * tilt; ry = 8 * tilt; rz = 30 * tilt }
    kick.position.copy(kickPos).multiplyScalar(0.35)
    kick.rotation.set((kickRot.x + rx) * DEG, (kickRot.y + ry) * DEG, (kickRot.z + rz) * DEG, 'YXZ')
    // moving parts: pump, drum, magazine, the RX-3 coils
    if (v.pump && d.pump) {
      if (s.cycleT < 1) s.cycleT += dt
      const k = s.cycleT < 0.12 ? 0 : Math.sin(clamp01((s.cycleT - 0.12) / 0.32) * Math.PI)
      v.pump.position.z = v.pumpRest - 0.085 * k
    }
    if (v.drum && d.drum && s.drum !== s.drumTarget) {
      s.drum = Math.abs(s.drumTarget - s.drum) <= 540 * dt ? s.drumTarget : s.drum + Math.sign(s.drumTarget - s.drum) * 540 * dt
      v.drum.rotation.z = s.drum * DEG
    }
    if (v.mag && d.magPart) v.mag.visible = !(s.reloadLeft > 0 && t > 0.22 && t < 0.64)
    if (v.glow) v.glow.emissiveIntensity = 1.6 * (1 + (s.charging ? 2.2 * clamp01(s.chargeT / (d.charge || 1)) : 0) + (s.cool > 0 && d.id === 'Plasma' ? 0.6 * clamp01(s.cool * d.rate) : 0))
  }

  // ------------------------------------------------------------------ projectiles (Projectile.cs)
  const TRAIL_OPTS = {}
  function updateProjectiles(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i]
      if (!p.active) { live.splice(i, 1); continue }
      if (dt <= 0) continue
      const d = p.def
      p.life += dt
      if (p.life > d.life) { if (d.aoe) detonate(p, p.pos, UP); else finish(p); live.splice(i, 1); continue }
      p.vel.y -= (d.gravity || 0) * dt
      const dist = p.vel.length() * dt
      if (dist < 1e-6) continue
      _dir.copy(p.vel).normalize()
      // bugs anywhere along the step; level geometry only after the muzzle grace
      let best = dist + d.projRadius, kind = null
      castBugs(p.pos, _dir, best)
      if (bugCount) { best = bugs[0].distance; kind = 'enemy' }
      const g = p.grace - p.travelled
      if (g < dist + d.projRadius) {
        const from = Math.max(0, g)
        _v1.copy(p.pos).addScaledVector(_dir, from)
        const env = G.world && G.world.raycastEnv ? G.world.raycastEnv(_v1, _dir, dist + d.projRadius - from) : null
        if (env && from + env.distance < best) { best = from + env.distance; kind = 'env'; _v2.copy(env.point); _v3.copy(env.normal) }
      }
      if (kind) {
        if (kind === 'enemy') { _v2.copy(bugs[0].point); _v3.copy(_dir).negate() }
        p.pos.copy(_v2)
        impact(p, kind, kind === 'enemy' ? bugs[0] : null, _v2, _v3)
        live.splice(i, 1)
        continue
      }
      p.pos.addScaledVector(p.vel, dt)
      p.travelled += dist
      orient(p)
      p.puffT -= dt
      const F = fx()
      if (p.kind === 'bolt') {
        p.streak.scale.set(1, 1, Math.min(1.5, 0.15 + p.travelled * 0.5))
        if (p.puffT <= 0) { p.puffT = 0.03; if (F.burst) F.burst('plasmaTrail', p.pos, TRAIL_OPTS) }
      } else {
        p.fuse.scale.setScalar(0.26 + 0.08 * Math.sin(p.life * 40))
        if (p.puffT <= 0) { p.puffT = 0.03; if (F.burst) F.burst('grenadeTrail', p.pos, TRAIL_OPTS) }
      }
    }
  }
  function impact(p, kind, bugHit, pointIn, normalIn) {
    const d = p.def
    const point = _impP.copy(pointIn), normal = _impN.copy(normalIn)
    if (d.aoe) { detonate(p, _blastAt.copy(point).addScaledVector(normal, 0.15), normal); return }
    // plasma bolt: one target with weak points; a surface within 0.34 m of a live bug hits that bug (edge tolerance)
    beginShot()
    let target = bugHit ? bugHit.enemy : null, weak = bugHit ? bugHit.weak : false, part = bugHit ? bugHit.part : undefined
    if (!target && G.enemies && G.enemies.sphere) {
      const near = G.enemies.sphere(point, d.projRadius + EDGE_R)
      let bd = Infinity
      for (let i = 0; i < near.length; i++) if (near[i].distance < bd && near[i].enemy.alive) { bd = near[i].distance; target = near[i].enemy }
      weak = false; part = undefined
    }
    _v1.copy(p.vel).normalize()
    if (target) hitEnemy(d, target, p.amount, point, _v1, weak, part)
    const F = fx()
    HIT.normal.copy(normal); HIT.colour = d.accent
    if (F.burst) F.burst(d.impact, point, HIT)
    DEC.life = 12; DEC.scale = 0.5
    if (!target && F.decal) F.decal(point, normal, d.decal, DEC)
    endShot()
    finish(p)
  }
  /** GL-40 blast: Hive bugs only, lerp(1, 0.3, dist / 4.5), halved behind cover, never a weak point */
  const blastList = []
  function detonate(p, atIn, normalIn) {
    const d = p.def
    const at = _blastAt.copy(atIn), normal = _blastN.copy(normalIn)
    beginShot()
    blastList.length = 0
    const near = G.enemies && G.enemies.sphere ? G.enemies.sphere(at, d.aoe) : []
    for (let i = 0; i < near.length; i++) blastList.push(near[i].enemy, near[i].distance)
    _v2.copy(at).addScaledVector(UP, 0.3)
    for (let i = 0; i < blastList.length; i += 2) {
      const e = blastList[i], dist = blastList[i + 1]
      if (!e.alive) continue
      let k = lerp(1, d.aoeEdge, clamp01(dist / d.aoe))
      const tp = e.aim || e.pos
      _v3.subVectors(tp, _v2)
      const len = _v3.length()
      if (len > 0.05 && G.world && G.world.raycastEnv) { const env = G.world.raycastEnv(_v2, _v3.multiplyScalar(1 / len), len); if (env && env.distance < len - 0.15) k *= 0.5 }
      _v1.subVectors(tp, at)
      if (_v1.lengthSq() < 1e-6) _v1.set(0, 1, 0)
      hitEnemy(d, e, p.amount * k, tp, _v1.normalize(), false, undefined)
    }
    endShot()
    const F = fx()
    HIT.normal.copy(normal); HIT.colour = null
    if (F.burst) F.burst('grenadeBlast', at, HIT)
    if (F.decal && G.world && G.world.raycastEnv) {
      const g = G.world.raycastEnv(_v2.copy(at).addScaledVector(normal, 0.3), _v3.copy(normal).negate(), 1.5)
      DEC.life = 14; DEC.scale = 2.4
      if (g) F.decal(g.point, g.normal, 'scorchLarge', DEC)
    }
    sfx(pick(d.blast), { pos: at, vol: 1, rate: jitter(0.07) })
    if (G.shake) G.shake(0.28)
    finish(p)
  }
  function finish(p) { p.active = false; p.obj.visible = false }

  // ------------------------------------------------------------------ HUD
  const hudW = { name: '', typeColour: null, level: 1, xpToNext: 0, xpFrac: 0, maxLevel: false, ammo: 0, mag: 0, reloadFrac: 0, slots: ['', ''], active: 0, charge: 0, scoped: false }
  const hudC = { gap: 5, visible: true }
  function feedHud() {
    const h = G.hud
    if (!h) return
    const id = weapons.current, d = WEAPONS[id], s = weapons.inst[id], P = G.player || {}
    hudW.name = d.name; hudW.typeColour = typeColour[id]; hudW.level = s.level
    hudW.maxLevel = s.level >= MAX_LEVEL
    hudW.xpToNext = hudW.maxLevel ? 0 : Math.max(0, XP_AT[s.level + 1] - s.xp)
    hudW.xpFrac = hudW.maxLevel ? 1 : clamp01((s.xp - XP_AT[s.level]) / Math.max(1, XP_AT[s.level + 1] - XP_AT[s.level]))
    hudW.ammo = s.ammo; hudW.mag = magSize(id)
    hudW.reloadFrac = s.reloadLeft > 0 ? clamp01(1 - s.reloadLeft / s.reloadTime) : 0
    hudW.slots[0] = WEAPONS[weapons.slots[0]].name; hudW.slots[1] = WEAPONS[weapons.slots[1]].name; hudW.active = weapons.active
    hudW.charge = s.charging && d.charge ? clamp01(s.chargeT / d.charge) : 0
    hudW.scoped = !!(d.scope && P.aiming && P.state === 'alive' && (P.aimBlend || 0) > 0.55)
    if (h.weapon) h.weapon(hudW)
    const aiming = !!P.aiming
    hudC.gap = 5 + ((aiming ? d.ads : d.hip) + s.bloom + (d.pelletCone || 0)) * 7 + crossKick * 5
    hudC.visible = P.state === 'alive' && !hudW.scoped
    if (h.crosshair) h.crosshair(hudC)
  }

  /** tests: fire the current weapon once along G.aim right now (bypasses input, honours ammo / cooldown) */
  function fireOnce(charge01 = 1) { const s = weapons.inst[weapons.current]; s.cool = Math.min(s.cool, 0); return tryFire(charge01) }

  /** run.js calls this when the Armory / queen rewards change G.run.mods: magazines follow at once (never above the new size) */
  function applyMods() { for (const id of ORDER) { const s = weapons.inst[id]; s.ammo = Math.min(s.ammo, magSize(id)) } }

  Object.assign(weapons, {
    load, update, reset, rearm, applyMods, equipSlot, select, unlocked, unlockedList, cancelReload, cancelCharge, startReload, fireOnce, trace,
    views, WEAPONS, ORDER, magSize, levelFor, live,
  })
  return weapons
}
