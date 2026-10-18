// Hive Adapt (Project 0 port): TURRETS (helper of towers.js). Ports Scripts/Towers/Tower.cs, TowerData.cs, TurretTierRig.cs,
// TurretHealthBar.cs and UI/BuildGhost.cs: the two turret families (data, costs with Unity's float32 quirks), the five tier
// models per family (SM_Turret{Ballistic|Energy}_T1..T5: Turret_Base, Turret_Yaw @y1.0, Turret_Pitch @y1.45, Barrel_X/Muzzle_X
// or Muzzle_C, optional Spinner and Deploy_* parts), Tower.cs targeting and firing, the upgrade deploy animation, the wrecked
// hull, Leech jamming, world-space integrity bars (two instanced draws) and the build ghost with its range rings.
// Everything in game space under G.root. towers.js owns economy, prompts, alerts; this file owns the turrets themselves.
import * as THREE from 'three'
import { DEG, clamp, clamp01, lerp, invLerp, moveTowards, roundEven, col, rng } from './u.js'
import * as WG from './worldgeo.js'

const f32 = Math.fround
const UP = new THREE.Vector3(0, 1, 0)
const TIER_SWAP = [null, null, null, { M_Armour: 'M_ArmourDark' }, { M_Armour: 'M_ArmourDark' }, { M_Armour: 'M_ArmourBlack', M_DarkMetal: 'M_Trim' }]
const TIER_EMISSION = [0, 1.35, 1.6, 1.9, 2.1, 2.3]
const ACCENT_MATS = { M_EmissiveAmber: true, M_EmissiveCyan: true }
const CHARRED = col(0.17, 0.15, 0.14)
const WRECK_ACCENT = col(1, 0.12, 0.05)
const JAM_ACCENT = col(0.75, 0.2, 1)
const BAR = { sound: col(0.95, 0.93, 0.89), failing: col(1, 0.29, 0.18), jammed: col(0.72, 0.36, 1), track: col(0.03, 0.03, 0.04), trackDead: col(0.32, 0.05, 0.03) }
const DANGER = col(1, 0.29, 0.18)
const MUZZLES = ['L', 'R', 'L2', 'R2', 'C']
const MAIN_PARTS = { Turret_Base: true, Turret_Yaw: true, Turret_Pitch: true }

/** smooth value noise in [0,1] (stands in for Mathf.PerlinNoise(x, row) in the offline stutter; no allocation) */
function hash1(i, row) { const h = Math.sin(i * 127.1 + row * 311.7) * 43758.5453; return h - Math.floor(h) }
function stutter(x, row) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f)
  return hash1(i, row) * (1 - u) + hash1(i + 1, row) * u
}

// ------------------------------------------------------------------ data (Data/Towers/Turret*.asset, TowerData.cs)
export const TD = {
  Ballistic: {
    type: 'Ballistic', id: 'TurretBallistic', name: 'Ballistic Turret', short: 'Ballistic', icon: 'turret', other: 'Energy',
    damage: 11, fireRate: 6.5, range: 20, buildCost: 100, upgradeCost: 80, maxLevel: 5, steps: [1, 2, 3.5, 5.5],
    dmgPer: 0.5, ratePer: 0.15, rangePer: 1.5, beam: false, turnSpeed: 260, turnAccel: 900, spinUp: 0.5, charge: 0,
    minPitch: -72, maxPitch: 70, integrity: 510, intPer: 0.3, repairShare: 0.3, rebuildShare: 0.5, salvageShare: 0.5,
    tierNames: ['Twin Gun', 'Shielded Twin', 'Heavy Quad', 'Armoured Quad', 'Rotary Cannon'],
    blurbs: ['Two barrels on a pivot mount', 'Gun shield, side wings and a second ammo box', 'Four barrels, armoured housing and drum feeds',
      'Armour skirts, barrel cooling and a radiator', 'Six-barrel rotary cannon on a heavy turntable'],
    fire: ['sfx_turret_ballistic_0', 'sfx_turret_ballistic_1'], muzzleFx: 'turretMuzzle_ballistic', tracer: 'turretBallistic',
    tierUpFx: 'tierUpBallistic', tierUpSfx: 'sfx_turret_tierup_ballistic', light: [1, 0.65, 0.25, 6, 7],
    colour: col(1, 0.75, 0.35), hud: [255, 191, 89],
  },
  Energy: {
    type: 'Energy', id: 'TurretEnergy', name: 'Energy Tower', short: 'Energy', icon: 'tower', other: 'Ballistic',
    damage: 32, fireRate: 1.2, range: 22, buildCost: 150, upgradeCost: 110, maxLevel: 5, steps: [1, 2, 3.5, 5.5],
    dmgPer: 0.5, ratePer: 0.15, rangePer: 1.5, beam: true, turnSpeed: 200, turnAccel: 700, spinUp: 0, charge: 0.35,
    minPitch: -72, maxPitch: 70, integrity: 480, intPer: 0.3, repairShare: 0.3, rebuildShare: 0.5, salvageShare: 0.5,
    tierNames: ['Coil Emitter', 'Charged Emitter', 'Lance', 'Capacitor Lance', 'Arc Projector'],
    blurbs: ['A coil emitter on a pivot mount', 'Charge cells and flank pods feed the coils', 'Faceted lance housing and a capacitor bank',
      'Focus halo, heat sink and charge nodes', 'Reactor core and a three-prong arc emitter'],
    fire: ['sfx_turret_energy_0'], muzzleFx: 'turretMuzzle_energy', tracer: 'turretEnergy',
    tierUpFx: 'tierUpEnergy', tierUpSfx: 'sfx_turret_tierup_energy', light: [0.35, 0.85, 1, 10, 9],
    colour: col(0.35, 0.8, 1), hud: [89, 204, 255],
  },
}
export const damageAt = (d, L) => d.damage * (1 + d.dmgPer * (L - 1))
export const fireRateAt = (d, L) => d.fireRate * (1 + d.ratePer * (L - 1))
export const rangeAt = (d, L) => d.range + d.rangePer * (L - 1)
/** IntegrityAt in float32 (Unity) */
export const integrityAt = (d, L) => f32(d.integrity * f32(1 + f32(d.intPer * (L - 1))))
export const upgradeCostFor = (d, L) => roundEven(f32(d.upgradeCost * d.steps[Math.min(Math.max(1, L) - 1, d.steps.length - 1)]))
export function investedAt(d, L) { let c = d.buildCost; for (let l = 1; l < L; l++) c += upgradeCostFor(d, l); return c }
/** RepairCostFor: max(1, ceil(amount / IntegrityAt * InvestedAt * repairShare)), every step in float32 (Ballistic L1 full = 31) */
export function repairCostFor(d, amount, L) {
  if (!(amount > 0)) return 0
  const a = f32(f32(f32(f32(amount) / integrityAt(d, L)) * investedAt(d, L)) * f32(d.repairShare))
  return Math.max(1, Math.ceil(a))
}
export const rebuildCostAt = (d, L) => Math.ceil(f32(investedAt(d, L) * f32(d.rebuildShare)))
export const salvageAt = (d, L) => Math.floor(f32(investedAt(d, L) * f32(clamp01(d.salvageShare))))
/** prompt dps label (Mathf.RoundToInt of the L1 dps: Ballistic 72, Energy 38) */
export const dpsLabel = d => roundEven(f32(damageAt(d, 1) * fireRateAt(d, 1)))

// ------------------------------------------------------------------ the turret system
export function createTurrets(K) {
  const G = K.G
  const A = G.assets
  const lite = !!G.lite
  const R = rng(4417)
  const T = { Ballistic: [], Energy: [] } // tier templates [1..5]
  const list = [] // live turret records (standing or wrecked)
  let barTrack = null, barFill = null, ghost = null, ghostMat = null
  const rings = []
  const ringGeos = new Map()
  const shots = [] // fallback shot visuals while fx.js is a stub
  let shotNext = 0

  // scratch
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3()
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _cr = new THREE.Vector3(), _col = new THREE.Color()
  const _ray = new THREE.Ray()
  const _envHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() }

  // ---------------------------------------------------------------- templates
  function boundsOf(root, except) {
    const box = new THREE.Box3()
    root.updateWorldMatrix(true, true)
    root.traverse(o => {
      if (!o.isMesh) return
      for (let p = o; p; p = p.parent) { if (p === except) return; if (p === root) break }
      o.geometry.computeBoundingBox()
      box.union(_tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld))
    })
    return box
  }
  const _tmpBox = new THREE.Box3()
  function nodesOf(root) {
    const map = {}
    root.traverse(o => { if (o.name && !map[o.name]) map[o.name] = o })
    return map
  }
  async function loadTemplates() {
    const jobs = []
    for (const type of ['Ballistic', 'Energy']) {
      for (let n = 1; n <= 5; n++) {
        jobs.push(A.glb(`SM_Turret${type}_T${n}`).then(gltf => {
          const scene = gltf.scene
          scene.traverse(o => {
            if (!o.isMesh) return
            WG.boxUV(o.geometry)
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            o.userData.mats = mats.map(m => ((m && m.name) || '').replace(/\.\d+$/, ''))
          })
          scene.position.set(0, 0, 0); scene.rotation.set(0, 0, 0); scene.scale.set(1, 1, 1)
          const N = nodesOf(scene)
          const yaw = N.Turret_Yaw, pitch = N.Turret_Pitch
          const all = boundsOf(scene), head = boundsOf(yaw), housing = boundsOf(yaw, pitch)
          const y0 = yaw.getWorldPosition(new THREE.Vector3())
          const hh = Math.max(y0.x - housing.min.x, housing.max.x - y0.x, y0.z - housing.min.z, housing.max.z - y0.z)
          const muzzles = MUZZLES.filter(s => N['Muzzle_' + s])
          const pv = pitch.getWorldPosition(new THREE.Vector3())
          const barrelLength = muzzles.length ? N['Muzzle_' + muzzles[0]].getWorldPosition(new THREE.Vector3()).distanceTo(pv) : 0
          // the parts that lock into place on the upgrade: low ones first, then left before right (Prefabs.cs BuildTierRig)
          const deploy = Object.keys(N).filter(k => k.startsWith('Deploy_')).map(k => {
            const b = boundsOf(N[k]), c = b.getCenter(new THREE.Vector3())
            return { name: k, y: c.y, x: N[k].getWorldPosition(new THREE.Vector3()).x }
          })
          deploy.sort((a, b) => (Math.abs(a.y - b.y) > 0.05 ? a.y - b.y : b.x - a.x))
          T[type][n] = {
            scene, type, tier: n, muzzles, barrelLength, deploy: deploy.map(p => p.name),
            leechRadius: clamp(hh * 0.72, 0.42, 0.62), barHeight: Math.max(2.55, all.max.y + 0.45), bodyH: clamp(head.max.y, 1.8, 2.4),
          }
        }))
      }
    }
    await Promise.all(jobs)
  }

  // ---------------------------------------------------------------- materials
  const charredCache = new Map()
  function charred(m) {
    let c = charredCache.get(m)
    if (!c) {
      c = m.clone()
      c.name = m.name
      if (c.color) c.color.copy(CHARRED)
      if (c.emissive && !(c.emissiveIntensity > 0 && c.emissive.getHex() !== 0)) c.emissive.setRGB(0, 0, 0)
      charredCache.set(m, c)
    }
    return c
  }
  function resolveMat(t, name) {
    if (ACCENT_MATS[name]) return t.accent
    let m = A.mat(name)
    if (G.world && G.world.turretMaterial) m = G.world.turretMaterial(m)
    return t.wrecked ? charred(m) : m
  }
  /** (re)assign every renderer of the shown rig: tier swaps, the base's Obsidian skin, the charred hull */
  function dress(t) {
    const swap = TIER_SWAP[t.level] || null
    for (const e of t.rig.meshes) {
      const names = e.names
      if (names.length === 1) e.mesh.material = resolveMat(t, (swap && swap[names[0]]) || names[0])
      else { const arr = e.mesh.material; for (let i = 0; i < names.length; i++) arr[i] = resolveMat(t, (swap && swap[names[i]]) || names[i]) }
    }
    t.accentKey = -1
  }

  // ---------------------------------------------------------------- one rig (one tier model) on a turret
  function makeRig(type, tier) {
    const tpl = T[type][tier]
    const obj = tpl.scene.clone(true)
    obj.name = `Turret_${type}_T${tier}`
    const N = nodesOf(obj)
    const meshes = []
    obj.traverse(o => {
      if (!o.isMesh) return
      // lite (software renderer): only the housing casts a shadow (barrels and add-on parts are small)
      o.castShadow = !lite || MAIN_PARTS[o.name] || (o.parent && MAIN_PARTS[o.parent.name]) || false
      o.receiveShadow = true
      const names = o.userData.mats || ['M_GunMetal']
      if (names.length > 1) o.material = names.map(() => null)
      meshes.push({ mesh: o, names })
    })
    const barrels = [], muzzles = []
    for (const s of tpl.muzzles) { muzzles.push(N['Muzzle_' + s]); if (N['Barrel_' + s]) barrels.push(N['Barrel_' + s]) }
    if (barrels.length && barrels.length !== muzzles.length) barrels.length = 0
    const deploy = tpl.deploy.map(name => {
      const p = N[name]
      return { obj: p, seat: p.position.clone(), scale: p.scale.clone() }
    })
    return {
      tpl, obj, yaw: N.Turret_Yaw, pitch: N.Turret_Pitch, spinner: N.Spinner || N.Coil_1 || null, meshes, barrels, muzzles,
      barrelRest: barrels.map(b => b.position.clone()), kick: new Float32Array(barrels.length), deploy, deployT: 1,
    }
  }
  /** TurretTierRig.Apply: every Deploy_ part slides out from its pivot to its seat (0.36 s each, staggered over 0.75 s) */
  function applyDeploy(rig) {
    const n = rig.deploy.length
    const part = 0.36 / 0.75
    const stagger = n > 1 ? (1 - part) / (n - 1) : 0
    for (let i = 0; i < n; i++) {
      const p = rig.deploy[i]
      const k = backOut(clamp01((rig.deployT - i * stagger) / part))
      const len = p.seat.length()
      const back = Math.min(0.35, Math.max(0.12, len * 0.6))
      if (len > 1e-4) _a.copy(p.seat).multiplyScalar(1 - back / len)
      else _a.copy(p.seat).addScaledVector(UP, -back)
      p.obj.position.lerpVectors(_a, p.seat, k)
      p.obj.scale.copy(p.scale).multiplyScalar(lerp(0.6, 1, k))
    }
  }
  function backOut(u) { const c = 1.7, t = u - 1; return 1 + (c + 1) * t * t * t + c * t * t }

  // ---------------------------------------------------------------- placing / swapping
  /** a new turret on `pad` (world pad), shown at `level` (no fanfare: towers.js plays it) */
  function place(pad, type, level = 1) {
    const d = TD[type]
    const root = new THREE.Group()
    root.name = 'Turret_' + pad.index
    root.position.copy(pad.pos)
    root.rotation.y = pad.rotY
    G.root.add(root)
    const accent = A.mat(type === 'Energy' ? 'M_EmissiveCyan' : 'M_EmissiveAmber').clone()
    accent.name = 'TurretAccent'
    const t = {
      id: `${type}#${pad.index}`, sourceId: `${type}#${pad.index}`, type, data: d, pad, padIndex: pad.index, padRef: pad, label: pad.label,
      level: 1, hp: 0, maxHp: 0, alive: true, wrecked: false, leeches: [], latchRadius: 0.42, yaw: pad.rotY,
      base: pad.pos.clone(), pos: pad.pos.clone().add(new THREE.Vector3(0, 1, 0)), pivot: pad.pos.clone().add(new THREE.Vector3(0, 1.45, 0)),
      aimPoint: null, range: d.range, barHeight: 2.55, root, rig: null, accent, accentKey: -1,
      target: null, retarget: R() * 0.2, cooldown: 0, spin: 0, charge: 0, yawAngle: 0, pitchAngle: 0, yawVel: 0, pitchVel: 0,
      scanT: R() * 10, popT: 1, barrelIndex: 0, blockedShots: 0, blockedTarget: null, blockedUntil: 0,
      lastHiveHit: -100, warned: 0, wasOffline: false, smokeT: 0, info: null,
      leechPoint: (slot, out) => leechPoint(t, slot, out || new THREE.Vector3()),
      get jammed() { return this.leeches.length > 0 },
      get offline() { return this.wrecked || this.leeches.length > 0 },
      get underAttack() { return !this.wrecked && G.time - this.lastHiveHit < 4 },
      get integrity() { return this.wrecked ? 0 : (this.maxHp > 0 ? clamp01(this.hp / this.maxHp) : 0) },
      get damaged() { return !this.wrecked && this.hp < this.maxHp - 0.5 },
    }
    t.aimPoint = t.pivot
    t.info = { amount: 0, type, source: 'tower', sourceId: t.sourceId, point: new THREE.Vector3(), dir: new THREE.Vector3(), weak: false, part: undefined }
    setLevel(t, level, false)
    t.popT = 0
    list.push(t)
    return t
  }
  /** show the model for `level` (aim carries over); deploy plays the parts locking into place */
  function setLevel(t, level, deploy) {
    const d = t.data
    t.level = clamp(level, 1, d.maxLevel)
    t.maxHp = integrityAt(d, t.level)
    t.hp = t.maxHp
    t.range = rangeAt(d, t.level)
    t.warned = 0
    if (t.rig) t.root.remove(t.rig.obj)
    const rig = makeRig(t.type, t.level)
    t.rig = rig
    t.root.add(rig.obj)
    t.latchRadius = rig.tpl.leechRadius
    t.barHeight = rig.tpl.barHeight
    t.barrelIndex = 0
    rig.deployT = deploy && rig.deploy.length ? 0 : 1
    applyDeploy(rig)
    applyAim(t)
    dress(t)
  }
  function upgrade(t) {
    if (t.wrecked || t.level >= t.data.maxLevel) return false
    setLevel(t, t.level + 1, true)
    t.popT = 0
    return true
  }
  function repair(t) {
    if (t.wrecked || t.hp >= t.maxHp - 0.5) return false
    t.hp = t.maxHp
    t.warned = 0
    return true
  }
  function rebuild(t) {
    t.wrecked = false
    t.alive = true
    t.hp = t.maxHp = integrityAt(t.data, t.level)
    t.warned = 0
    t.lastHiveHit = -100
    t.target = null
    t.popT = 0
    dress(t)
  }
  function remove(t) {
    const i = list.indexOf(t)
    if (i >= 0) list.splice(i, 1)
    t.alive = false
    t.target = null
    t.leeches.length = 0
    if (t.root.parent) t.root.parent.remove(t.root)
    t.accent.dispose()
  }
  function clear() { while (list.length) remove(list[list.length - 1]) }

  // ---------------------------------------------------------------- integrity
  function damage(t, amount) {
    if (t.wrecked || !(amount > 0)) return 0
    const before = t.hp
    t.hp = Math.max(0, t.hp - amount)
    t.lastHiveHit = G.time
    if (t.hp <= 0) { wreck(t); return before }
    const n = t.hp / t.maxHp
    let w = 0
    while (w < 2 && n < (w === 0 ? 0.6 : 0.25)) w++
    if (w > t.warned) { t.warned = w; K.onWarning(t) }
    return amount
  }
  function wreck(t) {
    t.wrecked = true
    t.alive = false
    t.hp = 0
    t.lastHiveHit = G.time
    t.target = null
    t.smokeT = 1.4
    t.spin = 0
    t.charge = 0
    K.fx('towerWrecked', t.pivot)
    K.sfx('sfx_barricade_break', t.pivot, 1)
    dress(t)
    K.onWrecked(t)
  }

  // ---------------------------------------------------------------- Leeches
  /** latch spot slot (0..2) on the yaw housing: Unity AngleAxis(30 + 120 k, up) * yawPivot.forward (a Unity +angle is a -angle here) */
  function leechPoint(t, slot, out) {
    const a = t.yaw - ((slot % 3) * 120 + 30) * DEG
    const r = t.latchRadius
    return out.set(t.pos.x + Math.sin(a) * r, t.pos.y + 0.12, t.pos.z + Math.cos(a) * r)
  }

  // ---------------------------------------------------------------- aiming
  function applyAim(t) {
    const r = t.rig
    if (r.yaw) r.yaw.rotation.y = t.yawAngle * DEG
    if (r.pitch) r.pitch.rotation.x = -t.pitchAngle * DEG
    t.yaw = t.padRef.rotY + t.yawAngle * DEG
  }
  /** desired yaw (deg, turret-local, three convention) and pitch (deg) toward a game-space point from the pitch pivot */
  function aimAngles(t, p, out) {
    const dx = p.x - t.pivot.x, dy = p.y - t.pivot.y, dz = p.z - t.pivot.z
    const ry = t.padRef.rotY, c = Math.cos(ry), s = Math.sin(ry)
    const lx = dx * c - dz * s, lz = dx * s + dz * c
    out.x = Math.atan2(lx, lz) / DEG
    out.y = Math.atan2(dy, Math.hypot(dx, dz)) / DEG
    return out
  }
  function inPitchRange(t, e) {
    aimAngles(t, e.aim, _cr)
    return _cr.y >= t.data.minPitch - 2 && _cr.y <= t.data.maxPitch + 2
  }
  /** first hit against shot-stopping level geometry (no allocation besides the BVH's own result) */
  function envCast(from, dir, far) {
    const bvh = G.world && G.world.envBVH
    if (!bvh || far <= 0) return null
    _ray.origin.copy(from)
    _ray.direction.copy(dir)
    const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far)
    if (!hit) return null
    _envHit.distance = hit.distance
    _envHit.point.copy(hit.point)
    if (hit.face) { _envHit.normal.copy(hit.face.normal); if (_envHit.normal.dot(dir) > 0) _envHit.normal.negate() } else _envHit.normal.copy(dir).negate()
    return _envHit
  }
  /** clear shot from where the barrel tip would be when aimed at e (Tower.HasLineOfSight) */
  function hasLOS(t, e) {
    _d.subVectors(e.aim, t.pivot)
    const len = _d.length()
    if (len < 0.5) return true
    _d.divideScalar(len)
    const tip = Math.min(t.rig.tpl.barrelLength, len - 0.5)
    _e.copy(t.pivot).addScaledVector(_d, tip)
    return !envCast(_e, _d, len - tip - 0.4)
  }
  /** Tower.FindTarget: structure attackers first, then the bug nearest the Core (+ a quarter of the turret distance) */
  function findTarget(t) {
    const en = G.enemies
    const listE = en && en.list
    if (!listE) return null
    const range2 = t.range * t.range
    const core = K.corePos()
    let best = null, bestScore = Infinity
    for (let i = 0; i < listE.length; i++) {
      const e = listE[i]
      if (!e.alive || !e.targetable || e.siege) continue
      if (e === t.blockedTarget && G.time < t.blockedUntil) continue
      const dx = e.pos.x - t.base.x, dz = e.pos.z - t.base.z
      const dist2 = dx * dx + dz * dz
      if (dist2 > range2) continue
      let score = e.pos.distanceToSquared(core) + dist2 * 0.25
      if (e === t.target) score *= 0.7
      if (!e.attackingStructure) score += 1e6
      if (score < bestScore && inPitchRange(t, e) && hasLOS(t, e)) { bestScore = score; best = e }
    }
    return best
  }

  // ---------------------------------------------------------------- firing
  function fire(t) {
    const rig = t.rig, d = t.data, e = t.target
    if (!rig.muzzles.length || !e) return
    const idx = t.barrelIndex % rig.muzzles.length
    t.barrelIndex++
    if (idx < rig.kick.length) rig.kick[idx] = 1
    const m = rig.muzzles[idx]
    m.getWorldPosition(_a)
    G.root.worldToLocal(_a) // muzzle, game space
    // aim + Random.insideUnitSphere * 0.12
    let rx, ry, rz
    do { rx = R() * 2 - 1; ry = R() * 2 - 1; rz = R() * 2 - 1 } while (rx * rx + ry * ry + rz * rz > 1)
    _b.set(e.aim.x + rx * 0.12, e.aim.y + ry * 0.12, e.aim.z + rz * 0.12)
    const from = _b.distanceTo(t.pivot) < rig.tpl.barrelLength + 0.5 ? t.pivot : _a
    _c.subVectors(_b, from)
    const aimDist = _c.length()
    _c.divideScalar(Math.max(1e-6, aimDist))
    const far = t.range + 3
    const hits = G.enemies.raycast ? G.enemies.raycast(from, _c, far) : null
    const eh = hits && hits.length ? hits[0] : null
    const env = envCast(from, _c, far)
    _d.copy(from).addScaledVector(_c, far) // shot end
    const info = t.info
    if (eh && (!env || eh.distance <= env.distance)) {
      _d.copy(eh.point)
      info.amount = damageAt(d, t.level) * K.turretDamageMult()
      info.point.copy(eh.point)
      info.dir.copy(_c)
      info.weak = !!eh.weak
      info.part = eh.part
      const target = eh.enemy
      G.enemies.damage(target, info)
      t.blockedShots = 0
      _e.copy(_c).negate()
      K.fx(d.beam ? 'turretImpactEnergy' : 'turretImpact', _d, _e, _c)
    } else if (env) {
      _d.copy(env.point)
      if (env.distance < aimDist - 0.6 && ++t.blockedShots >= 2) {
        // two shots in a row into cover: drop this target for a moment and pick another right away
        t.blockedShots = 0
        t.blockedTarget = t.target
        t.blockedUntil = G.time + 2
        t.target = null
        t.retarget = 0
      }
      K.fx('sparks', _d, env.normal, _c)
    }
    // presentation: tracer or beam from the muzzle, flash, light, sound
    if (d.beam) { if (!K.fxCall('beam', _a, _d, d.tracer, 0.14)) fallbackShot(_a, _d, true) } else if (!K.fxCall('tracer', _a, _d, d.tracer)) fallbackShot(_a, _d, false)
    _e.subVectors(_d, _a).normalize()
    K.fxCall('muzzle', _a, _e, d.muzzleFx) // fx.js adds the 0.04 s muzzle light (Unity values) unless G.lite
    if (!d.beam) {
      // brass out of the side the barrel is on, 0.6 m behind the muzzle (Tower.Fire shellPrefab)
      const side = m.parent && m.parent.position.x > 0.01 ? -1 : 1
      _cr.set(-Math.cos(t.yaw) * side, 0, Math.sin(t.yaw) * side)
      _b.copy(_a).addScaledVector(_e, -0.6)
      K.fxCall('shell', _b, _cr)
    }
    K.sfx(d.fire[(R() * d.fire.length) | 0], _a, 0.65, 1 + (R() - 0.5) * 0.12, 0.03)
  }

  // ---------------------------------------------------------------- per-frame (Tower.Update)
  const _ang = new THREE.Vector2()
  function tick(t, dt) {
    const d = t.data
    // integrity: the wreck smokes; going offline or coming back is announced
    if (t.wrecked) {
      t.smokeT -= dt
      if (t.smokeT <= 0) { t.smokeT = 1.4; K.fx('towerWrecked', t.pivot) }
    }
    const off = t.wrecked || t.leeches.length > 0
    if (off !== t.wasOffline) { t.wasOffline = off; K.onStatus(t, off) }
    t.retarget -= dt
    if (off) t.target = null
    else if (t.retarget <= 0) { t.retarget = 0.2; t.target = findTarget(t) }
    if (t.target && (!t.target.alive || !t.target.targetable)) t.target = null
    let desiredYaw, desiredPitch
    const now = G.time
    if (t.target) {
      aimAngles(t, t.target.aim, _ang)
      desiredYaw = _ang.x
      desiredPitch = _ang.y
      if (t.spin < 0.05 && d.spinUp > 0) K.sfx('sfx_turret_spin', t.pivot, 0.35, 1, 0.6)
      t.spin = moveTowards(t.spin, 1, dt / Math.max(0.05, d.spinUp))
    } else if (off) {
      desiredYaw = t.leeches.length && !t.wrecked ? t.yawAngle + Math.sin(now * 29 + t.padIndex) * 9 : t.yawAngle
      desiredPitch = t.wrecked ? d.minPitch * 0.25 : t.pitchAngle + Math.sin(now * 23) * 4
      t.spin = moveTowards(t.spin, 0, dt * 2)
      t.charge = 0
    } else {
      t.scanT += dt
      desiredYaw = Math.sin(t.scanT * 0.45 + t.padIndex) * 45
      desiredPitch = Math.sin(t.scanT * 0.3) * 4
      t.spin = moveTowards(t.spin, 0, dt / Math.max(0.05, d.spinUp * 1.6))
      t.charge = moveTowards(t.charge, 0, dt)
    }
    const speed = t.target ? 1 : off ? (t.wrecked ? 0.15 : 1) : 0.25
    let yawErr = (desiredYaw - t.yawAngle) % 360
    if (yawErr > 180) yawErr -= 360
    if (yawErr < -180) yawErr += 360
    t.yawVel = moveTowards(t.yawVel, clamp(yawErr * 9, -d.turnSpeed, d.turnSpeed) * speed, d.turnAccel * dt)
    t.yawAngle += t.yawVel * dt
    if (t.yawAngle > 540 || t.yawAngle < -540) t.yawAngle = ((t.yawAngle % 360) + 540) % 360 - 180
    const pitchErr = desiredPitch - t.pitchAngle
    t.pitchVel = moveTowards(t.pitchVel, clamp(pitchErr * 9, -d.turnSpeed, d.turnSpeed) * speed, d.turnAccel * dt)
    t.pitchAngle = clamp(t.pitchAngle + t.pitchVel * dt, d.minPitch, d.maxPitch)
    applyAim(t)
    const rig = t.rig
    if (rig.spinner) rig.spinner.rotation.z += t.spin * 1500 * DEG * dt
    if (t.cooldown > 0) t.cooldown -= dt
    if (t.target && Math.abs(yawErr) < 7 && Math.abs(pitchErr) < 9) {
      if (d.charge > 0) {
        t.charge += dt
        if (t.charge >= d.charge && t.cooldown <= 0) { t.charge = 0; t.cooldown = 1 / fireRateAt(d, t.level); fire(t) }
      } else if (t.cooldown <= 0) {
        t.cooldown = 1 / (fireRateAt(d, t.level) * lerp(0.3, 1, t.spin))
        fire(t)
      }
    }
    animate(t, dt)
  }
  function animate(t, dt) {
    const rig = t.rig, d = t.data
    if (rig.deployT < 1) { rig.deployT = Math.min(1, rig.deployT + dt / 0.75); applyDeploy(rig) }
    for (let i = 0; i < rig.barrels.length; i++) {
      if (rig.kick[i] <= 0 && rig.barrels[i].position.z === rig.barrelRest[i].z) continue
      rig.kick[i] = moveTowards(rig.kick[i], 0, dt * 7)
      const k = rig.kick[i]
      rig.barrels[i].position.z = rig.barrelRest[i].z - k * k * 0.14
    }
    if (t.popT < 1) {
      t.popT = Math.min(1, t.popT + dt / 0.35)
      t.root.scale.setScalar(1 + Math.sin(t.popT * Math.PI) * 0.12)
    }
    // accent glow: tier emission in the damage-type colour; Energy adds +3.5 x charge; offline stutters violet / dying red
    let key, mul, c
    if (t.wrecked || t.leeches.length) {
      const on = stutter(G.time * 9, t.padIndex) > 0.45 ? 1 : 0.08
      c = t.wrecked ? WRECK_ACCENT : JAM_ACCENT
      mul = (t.wrecked ? 0.4 : 1.6) * on
      key = (t.wrecked ? 2 : 3) + on
    } else {
      c = d.colour
      mul = TIER_EMISSION[t.level] + (d.charge > 0 ? t.charge / d.charge * 3.5 : 0)
      key = 10 + mul
    }
    if (key !== t.accentKey) {
      t.accentKey = key
      t.accent.emissive.copy(c)
      t.accent.emissiveIntensity = mul
    }
  }

  // ---------------------------------------------------------------- integrity bars (TurretHealthBar): two instanced draws
  function buildBars() {
    const n = 14
    const tg = new THREE.PlaneGeometry(1.16, 0.17).translate(0, 0, -0.01)
    const fg = new THREE.PlaneGeometry(1.08, 0.11).translate(0.54, 0, 0)
    const mk = (g, off) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide })
      if (off) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2 }
      const im = new THREE.InstancedMesh(g, m, n)
      im.count = 0
      im.frustumCulled = false
      im.castShadow = false
      im.receiveShadow = false
      im.renderOrder = 5
      im.setColorAt(0, _col.setRGB(1, 1, 1))
      G.root.add(im)
      return im
    }
    barTrack = mk(tg, false)
    barFill = mk(fg, true)
  }
  function updateBars(viewer, camQuat) {
    if (!barTrack) return
    let n = 0
    _cr.set(1, 0, 0).applyQuaternion(camQuat) // camera right (game space)
    for (let i = 0; i < list.length && n < 14; i++) {
      const t = list[i]
      _a.copy(t.base)
      _a.y += t.barHeight
      let show = t.wrecked || t.hp < t.maxHp - 0.5
      if (!show && viewer) show = viewer.distanceToSquared(_a) <= 49
      if (!show) continue
      const frac = t.wrecked ? 0 : clamp01(t.hp / t.maxHp)
      _s.set(1, 1, 1)
      _m.compose(_a, camQuat, _s)
      barTrack.setMatrixAt(n, _m)
      barTrack.setColorAt(n, t.wrecked ? BAR.trackDead : BAR.track)
      _b.copy(_a).addScaledVector(_cr, -0.54)
      _s.set(Math.max(0.0001, frac), 1, 1)
      _m.compose(_b, camQuat, _s)
      barFill.setMatrixAt(n, _m)
      if (t.leeches.length) _col.copy(BAR.jammed)
      else _col.copy(BAR.failing).lerp(BAR.sound, invLerp(0.25, 0.6, frac))
      barFill.setColorAt(n, _col)
      n++
    }
    barTrack.count = n
    barFill.count = n
    if (n) {
      barTrack.instanceMatrix.needsUpdate = true; barTrack.instanceColor.needsUpdate = true
      barFill.instanceMatrix.needsUpdate = true; barFill.instanceColor.needsUpdate = true
    }
  }

  // ---------------------------------------------------------------- build ghost + range rings (BuildGhost.cs)
  function buildGhost() {
    ghostMat = new THREE.MeshBasicMaterial({ color: 0x55dbff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const g = T.Ballistic[1].scene.clone(true)
    g.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4 } })
    ghost = new THREE.Group()
    ghost.name = 'BuildGhost'
    ghost.add(g)
    ghost.visible = false
    G.root.add(ghost)
    for (let i = 0; i < 2; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(ringGeo(20, false), m)
      mesh.visible = false
      mesh.renderOrder = 4
      mesh.frustumCulled = false
      G.root.add(mesh)
      rings.push({ mesh, radius: -1, dashed: false })
    }
  }
  /** flat annulus in XZ; dashed rings keep every other run of segments (about 0.8 m dashes) */
  function ringGeo(radius, dashed) {
    const key = radius.toFixed(2) + (dashed ? 'd' : 's')
    let g = ringGeos.get(key)
    if (g) return g
    const width = dashed ? 0.09 * 0.7 : 0.09
    const seg = clamp(Math.round(radius * 12), 48, 256)
    const dashLen = Math.max(1, Math.round(seg * 0.8 / (2 * Math.PI * radius)))
    const r0 = radius - width / 2, r1 = radius + width / 2
    const pos = [], idx = []
    for (let i = 0; i < seg; i++) {
      if (dashed && Math.floor(i / dashLen) % 2 === 1) continue
      const a0 = i * Math.PI * 2 / seg, a1 = (i + 1) * Math.PI * 2 / seg
      const v = pos.length / 3
      pos.push(Math.cos(a0) * r0, 0, Math.sin(a0) * r0, Math.cos(a0) * r1, 0, Math.sin(a0) * r1, Math.cos(a1) * r0, 0, Math.sin(a1) * r0, Math.cos(a1) * r1, 0, Math.sin(a1) * r1)
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    }
    g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    ringGeos.set(key, g)
    return g
  }
  function showRing(i, at, radius, dashed, colour, alpha) {
    const r = rings[i]
    if (!(radius > 0.01)) { r.mesh.visible = false; return }
    if (radius !== r.radius || dashed !== r.dashed) { r.mesh.geometry = ringGeo(radius, dashed); r.radius = radius; r.dashed = dashed }
    r.mesh.position.set(at.x, at.y + 0.07, at.z)
    r.mesh.material.color.copy(colour)
    r.mesh.material.opacity = alpha
    r.mesh.visible = true
  }
  function hideRing(i) { if (rings[i]) rings[i].mesh.visible = false }
  /** pad: world pad or null; o: { mode:'build'|'built', e, q, canE, canNext, t } */
  function updateGhost(pad, o) {
    if (!ghost) return
    if (!pad || !o) { ghost.visible = false; hideRing(0); hideRing(1); return }
    const pulse = 0.75 + 0.25 * Math.sin(G.rt * 4)
    const at = pad.pos
    if (o.mode === 'build') {
      const ca = o.canE ? TD.Ballistic.colour : DANGER
      ghost.visible = true
      ghost.position.copy(at)
      ghost.rotation.y = pad.rotY
      ghostMat.color.copy(ca)
      ghostMat.opacity = 0.22 + 0.12 * pulse
      showRing(0, at, rangeAt(TD.Ballistic, 1), false, ca, 0.9 * pulse)
      showRing(1, at, rangeAt(TD.Energy, 1), true, TD.Energy.colour, 0.45)
      return
    }
    ghost.visible = false
    const t = o.t
    if (!t) { hideRing(0); hideRing(1); return }
    showRing(0, at, t.range, false, t.data.colour, t.wrecked ? 0.25 : 0.55)
    if (!t.wrecked && t.level < t.data.maxLevel && !t.damaged) showRing(1, at, rangeAt(t.data, t.level + 1), true, o.canNext ? t.data.colour : DANGER, 0.8 * pulse)
    else hideRing(1)
  }

  // ---------------------------------------------------------------- fallback shot visuals (only while fx.js is a stub)
  function buildShots() {
    const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0)
    for (let i = 0; i < 12; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      const mesh = new THREE.Mesh(g, m)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 6
      G.root.add(mesh)
      shots.push({ mesh, life: 0, max: 0.1 })
    }
  }
  function fallbackShot(from, to, beam) {
    if (!shots.length) return
    const s = shots[shotNext]
    shotNext = (shotNext + 1) % shots.length
    _e.subVectors(to, from)
    const len = _e.length()
    if (len < 0.05) return
    s.mesh.position.copy(from)
    s.mesh.quaternion.setFromUnitVectors(UP, _e.divideScalar(len))
    const w = beam ? 0.07 : 0.025
    s.mesh.scale.set(w, len, w)
    s.mesh.material.color.copy(beam ? TD.Energy.colour : TD.Ballistic.colour).multiplyScalar(beam ? 2.2 : 1.6)
    s.max = s.life = beam ? 0.16 : 0.05
    s.mesh.visible = true
  }
  function updateShots(dt) {
    for (const s of shots) {
      if (!s.mesh.visible) continue
      s.life -= dt
      if (s.life <= 0) { s.mesh.visible = false; continue }
      s.mesh.material.opacity = clamp01(s.life / s.max)
    }
  }

  // ---------------------------------------------------------------- load / update / warm-up
  let warm = null
  async function load() {
    await loadTemplates()
    buildBars()
    buildGhost()
    buildShots()
    // warm-up: one hidden rig per family so main's compile pass builds the programs (removed on the first update)
    warm = new THREE.Group()
    warm.visible = false
    for (const type of ['Ballistic', 'Energy']) {
      const r = makeRig(type, 5)
      const fake = { level: 5, wrecked: false, accent: A.mat('M_EmissiveCyan'), rig: r }
      for (const e of r.meshes) {
        const names = e.names
        if (names.length === 1) e.mesh.material = ACCENT_MATS[names[0]] ? fake.accent : A.mat(names[0])
        else for (let i = 0; i < names.length; i++) e.mesh.material[i] = ACCENT_MATS[names[i]] ? fake.accent : A.mat(names[i])
      }
      warm.add(r.obj)
    }
    G.root.add(warm)
  }
  function update(dt, viewer, camQuat) {
    if (warm) { G.root.remove(warm); warm = null }
    if (dt > 0) for (let i = 0; i < list.length; i++) tick(list[i], dt)
    updateBars(viewer, camQuat)
    updateShots(dt)
  }
  function redressAll() { for (const t of list) dress(t) }

  return {
    T, list, load, update, place, upgrade, repair, rebuild, remove, clear, damage, wreck, setLevel, redressAll, updateGhost,
    findTarget, hasLOS, fire,
  }
}
