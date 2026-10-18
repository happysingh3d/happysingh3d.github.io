// Hive Adapt (Project 0 port): ENEMIES module (createEnemies(G) -> API in CONTRACT.md).
// Ports Scripts/Enemies/** (EnemyController, BugAnimator, ChitinFx, roles, queens, Siege Node) and Combat/Projectile.
// Everything is in game space (Unity metres, +Y up, north = -Z) under G.root.
//
// Files: enemies.js (this: pools, base state machine, movement, damage, hit volumes, projectiles, API),
//        enemydata.js (locked tables), chitin.js (material), bugrig.js (procedural gait), enemyfx.js (markers),
//        bugroles.js (Rammer/Spitter/Leech/Burrower), queens.js (4 queens + pickQueen), siege.js (Siege Node + director).
//
// ---------------------------------------------------------------- integration notes (run loop / towers / player)
// await enemies.load()            once, after G.assets/G.root exist (clones + warms pools; ~0.3 s)
// enemies.update(dt)              every frame in every phase (corpses, projectiles, markers, nodes keep animating)
// enemies.spawn(kind, opts)       opts: { spawnId:'A'|'B'|'C'|'D' (or 0..3), pos, elite:true | eliteChance, healthScale,
//                                 damageScale, minion, climber, yaw }. Spawned facing the Core; climbers are rolled here
//                                 (35% Crawlers, 70% Leeches) and get world.route(spawnId, { climber: true }).
//   queens: const q = enemies.pickQueen({ appearance: wave / 5, faced }); enemies.spawn(q.kind, { spawnId: 'B',
//           boss: { appearance: q.appearance } }) — leave healthScale/damageScale unset: x(1+0.6(k-1)) / x(1+0.2(k-1))
//           are applied here (+ Hive healthScale). pickQueen also takes history (evolution records [{ id, generation }],
//           defaults to G.run.hive.picks) and latestGeneration (defaults to G.run.hive.generation).
// enemies.siegeTick(wave, waveTime[, { bossWave, chanceScale }])   every COMBAT frame: the first call for a new wave
//           number rolls the grow (wave >= 6, not a boss wave, 1 alive (2 from w15), 0.4+0.05(w-6) <= 0.8, x2.5 per
//           Siege Organs pick); it grows 6-12 s of waveTime later. Nodes only fire on frames siegeTick was called.
//           Nodes live in enemies.siegeNodes (NOT enemies.list: turrets never see them, they never hold a wave).
// enemy.aim                       body-centre aim point (updated every frame; turrets/HUD should aim here, not pos)
// enemies.alive()                 live hostiles that hold the wave open (incl. boss minions; never Siege Nodes)
// enemies.raycast / sphere        include Siege Nodes; results are reused arrays (valid until the next call).
//                                 raycast hits carry part: 'weak_i' | 'shell_i' | undefined — pass it on to damage().
// enemies.damage(e, info)         info.part 'shell_i' damages a Matriarch shell (bullets; Explosive never does).
// enemyKilled(e, info)            info.culled === true: stuck bug removed by the watchdog (counts as killed, NO reward).
//   rewards (run loop): e.data.biomassReward x (e.elite ? e.data.eliteRewardScale : 1); XP e.data.xpReward x (tower 0.6)
//   x (elite 3); samples: elite +1, queens e.data.samples (5) + e.boss.profile.reward, Siege Node e.data.samples (2).
// Events emitted here (towers/player must NOT re-emit): enemySpawned, enemyDamaged, enemyKilled, coreHit, playerHit,
//   bossPhase(e, phase) (e.boss.banner / bannerSub hold the phase banner), siegeShell({ pos, aim, kind, barricade,
//   flight, node }); additions: siegeGrow(node), bossTelegraph(e, what, at, end, seconds), burrowTelegraph(e, at, s),
//   bossSurfaced(e, at), shellBroken(e, i, at), enemyRecovered(e, from, to), enemyProjectileHit(type, kind, point).
// Reads (optional fields are feature-detected): G.towers.turrets[i].{pos, alive, wrecked, leeches[], latchRadius, yaw
//   (head yaw, three rotation.y) or leechPoint(slot, out)}, G.towers.barricades[i].{pos, yawDeg, halfWidth, intact|hp,
//   strikePoint(p)}, G.towers.coreAlive() or G.towers.core.hp, G.towers.damageCore(amount, enemy, info) (info.shieldDrain
//   2.5 on Leech bites), G.run.hive.{resist, healthScale, speedScale, sizeScale, picks, generation, look?},
//   G.fx.shake(amount) (camera shake), G.enemyLights === true (opt-in boss/siege point lights).

import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { KINDS, PROJECTILES, EVOLUTIONS, DEFAULT_PLATE_COLOR, bossHealthScale, bossDamageScale } from './enemydata.js'
import { makeChitin, ChitinFx, chitinTime } from './chitin.js'
import { analyseRig, bindBones, BugAnim } from './bugrig.js'
import { createEnemyFx } from './enemyfx.js'
import { createRoles } from './bugroles.js'
import { createQueens } from './queens.js'
import { createSiege } from './siege.js'

export const ST = { SPAWNED: 0, MOVE: 1, ATTACK_CORE: 2, ATTACK_PLAYER: 3, ATTACK_BARRICADE: 4, DEAD: 5 }
const STATE_NAMES = ['Spawned', 'MoveToCore', 'AttackCore', 'AttackPlayer', 'AttackBarricade', 'Dead']

const DEG = Math.PI / 180
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t
const invLerp = (a, b, v) => (a === b ? 0 : clamp01((v - a) / (b - a)))
const planar = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz) }
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }

const UP = new THREE.Vector3(0, 1, 0)
const ARRIVE = { stairTop: 0.5, stair: 0.6, stairFoot: 0.7, walk: 0.8, wallTop: 0.8, gate: 1.1, ramp: 1.1, foot: 1.2 }
const CORE_C = 2.3, CORE_R = 2.5, PART_DEPTH = 0.75, SPAWN_POP = 0.35, SPAWN_SECONDS = 0.55, BOSS_SPAWN_SECONDS = 3.4, FLYER_CORE_ALT = 5.5
const WARM = { Crawler: 20, Flyer: 6, Rammer: 3, Spitter: 4, Leech: 6, Burrower: 3, BroodMother: 1, ArmoredMatriarch: 1, BurrowQueen: 1, SkyQueen: 1 }

// scratch
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3()
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4()
const _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _cp = new THREE.Vector3()

const byDistance = (a, b) => a.distance - b.distance

// ---------------------------------------------------------------- geometry helpers (local space)
/** ray (ro, rd unit) vs capsule a-b radius r: distance t or -1 (iq) */
function rayCapsule(ro, rd, pa, pb, r) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z
  const baba = bax * bax + bay * bay + baz * baz
  const bard = bax * rd.x + bay * rd.y + baz * rd.z
  const baoa = bax * oax + bay * oay + baz * oaz
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz
  const oaoa = oax * oax + oay * oay + oaz * oaz
  const a = baba - bard * bard
  let b = baba * rdoa - baoa * bard
  let c = baba * oaoa - baoa * baoa - r * r * baba
  let h = b * b - a * c
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a
    const y = baoa + t * bard
    if (y > 0 && y < baba) return t
    // caps
    const ocx = y <= 0 ? oax : ro.x - pb.x, ocy = y <= 0 ? oay : ro.y - pb.y, ocz = y <= 0 ? oaz : ro.z - pb.z
    b = rd.x * ocx + rd.y * ocy + rd.z * ocz
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r
    h = b * b - c
    if (h > 0) return -b - Math.sqrt(h)
  } else if (a <= 1e-9) {
    // ray parallel to the axis: test both caps as spheres
    const t1 = raySphere(ro, rd, pa, r), t2 = raySphere(ro, rd, pb, r)
    if (t1 >= 0 && (t2 < 0 || t1 < t2)) return t1
    return t2
  }
  return -1
}
function raySphere(ro, rd, c, r) {
  const ox = ro.x - c.x, oy = ro.y - c.y, oz = ro.z - c.z
  const b = ox * rd.x + oy * rd.y + oz * rd.z
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const h = b * b - cc
  if (h < 0) return -1
  const s = Math.sqrt(h)
  const t = -b - s
  return t >= 0 ? t : (-b + s >= 0 ? 0 : -1)
}
/** distance from point p to segment a-b */
function segDist(p, a, b) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z
  const l2 = bx * bx + by * by + bz * bz
  let t = l2 > 1e-9 ? ((p.x - a.x) * bx + (p.y - a.y) * by + (p.z - a.z) * bz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = p.x - (a.x + bx * t), dy = p.y - (a.y + by * t), dz = p.z - (a.z + bz * t)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** EnemyController.LobVelocity: the HIGH arc (+sqrt root); false = out of reach (45 degree throw) */
export function lobVelocity(from, to, speed, g, out) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
  const x = Math.hypot(dx, dz), s2 = speed * speed
  const fx = x > 1e-3 ? dx / x : 0, fz = x > 1e-3 ? dz / x : 1
  out.set(fx, 1, fz).normalize().multiplyScalar(speed)
  if (x < 0.05 || g <= 0) return false
  const disc = s2 * s2 - g * (g * x * x + 2 * dy * s2)
  if (disc < 0) return false
  const tan = (s2 + Math.sqrt(disc)) / (g * x)
  out.set(fx, tan, fz).normalize().multiplyScalar(speed)
  return true
}

// ---------------------------------------------------------------- Hive evolution look (HiveEvolution.Apply, visual part)
function evoLookFromPicks(picks) {
  const look = { tint: [1, 1, 1], plates: 0, plateColor: DEFAULT_PLATE_COLOR.slice(), glow: [0, 0, 0], glowMix: 0, size: 1 }
  for (const p of picks || []) {
    const id = typeof p === 'string' ? p : p && (p.id || (p.data && p.data.id))
    const e = EVOLUTIONS[id]
    if (!e) continue
    for (let i = 0; i < 3; i++) look.tint[i] = clamp(look.tint[i] * e.tint[i], 0.45, 1.4)
    if (e.plates > 0) {
      if (look.plates <= 0) look.plateColor = e.plateColor.slice()
      else for (let i = 0; i < 3; i++) look.plateColor[i] = lerp(look.plateColor[i], e.plateColor[i], e.plates / (look.plates + e.plates))
      look.plates = clamp01(look.plates + e.plates)
    }
    if (e.glowMix > 0) {
      if (look.glowMix <= 0) look.glow = e.glow.slice()
      else for (let i = 0; i < 3; i++) look.glow[i] = lerp(look.glow[i], e.glow[i], 0.6)
      look.glowMix = clamp01(Math.max(look.glowMix, e.glowMix) + (look.glowMix > 0 ? 0.1 : 0))
    }
  }
  return look
}

export function createEnemies(G) {
  const list = []
  const pools = {}
  const templates = {}
  const projectiles = []
  const projPool = { acid: [], lob: [], shell: [] }
  let loaded = false, nextId = 1, clock = 0, frame = 0
  let markers = null, roles = null, queens = null, siege = null
  let bossLight = null
  const hitPool = [], hitOut = [], sphereOut = []

  // ---------------------------------------------------------------- shared helpers (the "kit" the role modules use)
  // gameplay randomness comes from G.rng; the local mulberry32 only covers a missing G.rng (tests)
  let fallbackSeed = 0x9e3779b9
  const fallbackRng = () => { fallbackSeed = (fallbackSeed + 0x6d2b79f5) | 0; let t = fallbackSeed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const rng = () => (G.rng ? G.rng() : fallbackRng())
  const range = (a, b) => a + (b - a) * rng()
  const pick = arr => arr[Math.floor(rng() * arr.length) % arr.length]
  const emit = (n, ...a) => { if (G.events && G.events.emit) G.events.emit(n, ...a) }
  const sfx = (names, pos, vol = 1) => { if (!names || !names.length || !G.sfx) return; G.sfx(pick(names), { pos, vol }) }
  const fxBurst = (kind, pos, opts) => { if (G.fx && G.fx.burst) G.fx.burst(kind, pos, opts || {}) }
  const fxDecal = (kind, pos, normal, opts) => { if (G.fx && G.fx.decal) G.fx.decal(pos, normal || UP, kind, opts || {}) }
  const shake = amount => { if (amount > 0.001 && G.fx && G.fx.shake) G.fx.shake(amount) }
  const shakeAt = (amount, at, rangeM) => { const p = playerPos(); if (!p) return; const d = p.distanceTo(at); if (d < rangeM) shake(amount * (1 - d / rangeM)) }
  const world = () => G.world
  const core = () => (G.world && G.world.core) || DEFAULT_CORE
  const DEFAULT_CORE = { pos: new THREE.Vector3(0, 7, 0), radius: 2.6 }
  const towers = () => G.towers || {}
  const coreAlive = () => {
    const t = G.towers
    if (!t) return true
    if (typeof t.coreAlive === 'function') return t.coreAlive()
    if (t.core && typeof t.core.hp === 'number') return t.core.hp > 0
    return true
  }
  const playerAlive = () => !!(G.player && G.player.pos && G.player.alive !== false)
  const playerPos = () => (G.player && G.player.pos) || null
  // ---- co-op targets: G.net.targets() lists every defender { id, pos, alive, local, ok }. A bug hunts the nearest one; the
  // machine that hurts a fighter is that fighter's own (damagePlayer only lands when the bug's target is local). `cur` is the
  // bug being ticked, so the roles' K.playerPos() / K.playerAlive() answer for its target.
  let cur = null
  const localT = { id: 'me', pos: null, alive: false, local: true, ok: true }
  function tgt(e) {
    const t = e && e.tp
    if (t && t.ok) return t
    localT.pos = playerPos(); localT.alive = playerAlive()
    return localT
  }
  function pickTarget(e, dt) {
    const N = G.net
    if (!N || !N.multi) { e.tp = null; return }
    e.tpT = (e.tpT || 0) - dt
    if (e.tpT > 0 && e.tp && e.tp.ok && e.tp.alive) return
    e.tpT = 0.45 + (e.id % 7) * 0.03
    const now = tgt(e)
    let best = null, bd = Infinity
    for (const t of N.targets()) {
      if (!t.ok || !t.alive || !t.pos) continue
      let d = planar(e.pos, t.pos)
      if (t.local ? now.local : t === now) d *= 0.8 // keep the current target unless another is clearly nearer
      if (d < bd) { bd = d; best = t }
    }
    e.tp = best && !best.local ? best : null
  }
  const groundY = (x, z, yHint) => {
    const w = G.world
    if (!w || !w.groundY) return 0
    const y = w.groundY(x, z, yHint)
    return typeof y === 'number' && isFinite(y) ? y : NaN
  }
  const raycastEnv = (o, d, far) => (G.world && G.world.raycastEnv ? G.world.raycastEnv(o, d, far) : null)
  const turretsList = () => towers().turrets || []
  const barricadesList = () => towers().barricades || []
  const barricadeIntact = b => !!b && b.intact !== false && b.broken !== true && !(typeof b.hp === 'number' && b.hp <= 0)
  const barricadeBlocking = (p, reach) => (towers().barricadeBlocking ? towers().barricadeBlocking(p, reach) : null)
  const barricadePos = b => b.pos || (b.slot && b.slot.pos) || (b.group && b.group.position) || core().pos
  const strikePoint = (b, p, out) => {
    if (b && b.strikePoint) { const s = b.strikePoint(p); if (s) return out.copy(s) }
    return out.copy(barricadePos(b)).add(_v5.set(0, 0.8, 0))
  }
  const barricadeYaw = b => (b.yawDeg ?? (b.slot && b.slot.yawDeg) ?? 0)
  const turretOffline = t => !t || t.alive === false || t.wrecked || (t.leeches && t.leeches.length > 0) || (typeof t.hp === 'number' && t.hp <= 0)
  const turretDead = t => !t || t.alive === false || t.wrecked || (typeof t.hp === 'number' && t.hp <= 0)

  function damagePlayer(amount, e, info) {
    if (!playerAlive() || amount <= 0) return
    if (cur && !tgt(cur).local) return // co-op: that fighter's own machine lands this hit
    if (G.player.hurt) G.player.hurt(amount, e, info)
    emit('playerHit', amount, e)
  }
  function damageCore(amount, e, info) {
    if (!coreAlive() || amount <= 0) return
    if (towers().damageCore) towers().damageCore(amount, e, info)
    emit('coreHit', amount, e)
  }
  function damageBarricade(b, amount, e, info) { if (b && amount > 0 && towers().damageBarricade) towers().damageBarricade(b, amount, e, info) }
  function damageTurret(t, amount, e, info) { if (t && amount > 0 && towers().damageTurret) towers().damageTurret(t, amount, e, info) }

  function hive() { return (G.run && G.run.hive) || null }
  let lookKey = '', lookCache = null
  function evoLook() {
    const h = hive()
    if (!h) return null
    if (h.look) return h.look
    const picks = h.picks || []
    const key = picks.length + '|' + (h.generation || 0)
    if (key !== lookKey) { lookKey = key; lookCache = picks.length ? evoLookFromPicks(picks) : null }
    return lookCache
  }

  // ---------------------------------------------------------------- loading and pools
  async function load(opts = {}) {
    if (loaded) return
    const kinds = Object.keys(KINDS).filter(k => k !== 'SiegeNode')
    const gltfs = await Promise.all(kinds.map(k => G.assets.glb(KINDS[k].model)))
    kinds.forEach((k, i) => { templates[k] = buildTemplate(k, gltfs[i]) })
    markers = createEnemyFx(G)
    roles = createRoles(kit)
    queens = createQueens(kit)
    siege = createSiege(kit)
    await siege.load()
    if (G.enemyLights === true) {
      const S = G.S || 1
      bossLight = new THREE.PointLight(0xff6020, 0, 9 * S, 2)
      bossLight.userData.base = 10 * S * S
      G.root.add(bossLight)
    }
    const warm = opts.warm ?? 1
    for (const k of kinds) {
      pools[k] = pools[k] || []
      const n = Math.round((WARM[k] || 1) * warm)
      for (let i = 0; i < n; i++) pools[k].push(makeInstance(k))
    }
    loaded = true
  }

  function buildTemplate(kind, gltf) {
    const d = KINDS[kind]
    const scene = gltf.scene
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3()
    scene.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox) } })
    const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3()), ext = size.clone().multiplyScalar(0.5)
    const tpl = { kind, gltf, scene, box, rig: analyseRig(scene, d), capsules: [], sphere: null, weak: [], shells: [], center: ctr }
    // hit volumes (HiveBuilder.Prefabs.cs:140-186)
    if (d.capsules) {
      for (const c of d.capsules) {
        const half = Math.max(0, c.h / 2 - c.r)
        const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), -c.pitch * DEG)
        const cc = new THREE.Vector3(c.c[0], c.c[1], c.c[2])
        tpl.capsules.push({ a: cc.clone().addScaledVector(dir, -half), b: cc.clone().addScaledVector(dir, half), r: c.r })
      }
    } else if (d.isFlying) {
      tpl.sphere = { c: new THREE.Vector3(0, ctr.y, ctr.z), r: Math.max(ext.x, ext.y) * 0.75 }
    } else {
      const r = Math.min(ext.x * 0.55, ext.y * 0.8), h = size.z * 0.9, half = Math.max(0, h / 2 - r)
      tpl.capsules.push({ a: new THREE.Vector3(0, ctr.y, ctr.z - half), b: new THREE.Vector3(0, ctr.y, ctr.z + half), r })
    }
    const restPos = name => { const o = scene.getObjectByName(name); if (!o) return null; return o.getWorldPosition(new THREE.Vector3()) }
    for (const w of d.weak || []) {
      const pos = w.pos ? new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2]) : restPos(w.bone)
      if (pos) tpl.weak.push({ pos, r: w.r, open: !!w.open, bone: w.bone })
    }
    for (const s of d.shells || []) { const pos = restPos(s.bone); if (pos) tpl.shells.push({ pos, r: s.r, bone: s.bone }) }
    tpl.mouth = d.mouth ? new THREE.Vector3(d.mouth[0], d.mouth[1], d.mouth[2]) : null
    tpl.aimY = tpl.sphere ? tpl.sphere.c.y : ctr.y
    tpl.radius = tpl.sphere ? tpl.sphere.r : Math.max(...tpl.capsules.map(c => c.r))
    tpl.height = size.y
    tpl.bsphere = new THREE.Sphere(ctr.clone(), size.length() * 0.5 * 1.35)
    return tpl
  }

  function makeInstance(kind) {
    const tpl = templates[kind], d = KINDS[kind]
    const model = SkeletonUtils.clone(tpl.scene)
    const mats = []
    const body = makeChitin(d.mat)
    mats.push(body)
    let wing = null
    if (d.wingMat) { wing = makeChitin(d.wingMat); mats.push(wing) }
    const meshes = []
    model.traverse(o => {
      if (!o.isMesh) return
      const nm = (o.material && o.material.name) || ''
      o.material = /Wing/.test(nm) && wing ? wing : body
      o.castShadow = true
      o.receiveShadow = false
      if (o.isSkinnedMesh) o.boundingSphere = tpl.bsphere.clone()
      meshes.push(o)
    })
    const vis = new THREE.Group()
    vis.add(model)
    const obj = new THREE.Group()
    obj.name = 'Enemy_' + kind
    obj.add(vis)
    const inst = { kind, obj, vis, model, meshes, mats, chitin: new ChitinFx(mats, d.flashScale || 1), bones: bindBones(tpl.rig, model) }
    inst.anim = new BugAnim(tpl.rig, inst.bones, groundUnder, rng)
    // bones that roles scale (Matriarch shells) or hide
    inst.extraBones = {}
    for (const s of tpl.shells) inst.extraBones[s.bone] = model.getObjectByName(s.bone)
    return inst
  }
  function takeInstance(kind) { const p = pools[kind] || (pools[kind] = []); return p.pop() || makeInstance(kind) }
  function releaseInstance(inst) {
    if (inst.obj.parent) inst.obj.parent.remove(inst.obj)
    pools[inst.kind].push(inst)
  }

  /** BugAnimator.Ground: point under p along -up (walkable floor), else projected to the body plane */
  function groundUnder(p, up, animScale, out) {
    if (up.y > 0.85) {
      const y = groundY(p.x, p.z, p.y + 1.2 * animScale)
      if (y === y && y > p.y - 2.8 * animScale) return out.set(p.x, y, p.z)
      return out.copy(p)
    }
    _ro.copy(p).addScaledVector(up, 1.2 * animScale)
    _rd.copy(up).negate()
    const hit = raycastEnv(_ro, _rd, 2.8 * animScale)
    if (hit && hit.point) return out.copy(hit.point)
    return out.copy(p)
  }

  // ---------------------------------------------------------------- spawning
  function spawnPointPos(spawnId, out) {
    const w = world()
    const sps = (w && w.spawns) || []
    let sp = sps.find(s => s.id === spawnId)
    if (!sp && typeof spawnId === 'number') sp = sps[spawnId]
    if (!sp) return null
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (sp.radius || 2.5)
    out.set(sp.pos.x + Math.cos(a) * r, sp.pos.y, sp.pos.z + Math.sin(a) * r)
    const y = groundY(out.x, out.z, sp.pos.y + 5)
    if (y === y) out.y = y
    return sp
  }

  /**
   * spawn(kind, { spawnId, pos, elite, eliteChance, healthScale, damageScale, boss: { appearance }, minion, climber, yaw })
   * Queens: pass boss: { appearance: k } and leave healthScale/damageScale unset (1+0.6(k-1) / 1+0.2(k-1) are applied here).
   */
  function spawn(kind, opts = {}) {
    if (G.net && G.net.client && !opts.net) return null // co-op: only the host spawns; guests get every spawn from it
    if (kind === 'SiegeNode') return siege.grow(opts.pos || null, opts.wave || (G.run && G.run.wave) || 6, opts.id)
    const d = KINDS[kind]
    if (!d) throw new Error('enemies.spawn: unknown kind ' + kind)
    if (!loaded) { console.warn('enemies.spawn before load()'); return null }
    const inst = takeInstance(kind)
    const p = new THREE.Vector3()
    let sp = null
    if (opts.pos) {
      p.copy(opts.pos)
      if (!d.isFlying && !opts.keepY) { const y = groundY(p.x, p.z, p.y + 2); if (y === y) p.y = y }
    } else {
      sp = spawnPointPos(opts.spawnId ?? 'A', p)
      if (!sp) p.set(0, 0, -60)
    }
    if (d.isFlying && !opts.pos) p.y += 1
    const e = {
      id: opts.id != null ? opts.id : nextId++, kind, data: d, inst, obj: inst.obj, pos: inst.obj.position, vel: new THREE.Vector3(), aim: new THREE.Vector3(),
      hp: 0, maxHp: 0, alive: true, elite: false, boss: null, minion: !!opts.minion, siege: false, targetable: false, attackingStructure: false,
      zone: 'outside', radius: templates[kind].radius, height: templates[kind].height, spawnId: sp ? sp.id : (opts.spawnId ?? null),
      state: ST.SPAWNED, stateName: 'Spawned', stateTime: 0, rs: null,
    }
    if (opts.id != null && opts.id >= nextId) nextId = opts.id + 1
    e.netSpawn = { hs: opts.healthScale, ds: opts.damageScale, boss: opts.boss || null }
    e.tp = null; e.tpT = 0; e.netErr = null
    const bossOpt = opts.boss || (d.isBoss ? { appearance: 1 } : null)
    let hs = opts.healthScale, ds = opts.damageScale
    if (bossOpt) { if (hs === undefined) hs = bossHealthScale(bossOpt.appearance || 1); if (ds === undefined) ds = bossDamageScale(bossOpt.appearance || 1) }
    init(e, p, opts, hs ?? 1, ds ?? 1)
    aimPoint(e, e.aim)
    const wantElite = opts.elite === true || (typeof opts.eliteChance === 'number' && opts.eliteChance > 0 && rng() < opts.eliteChance)
    if (wantElite && !d.isBoss && !e.minion) makeElite(e)
    if (bossOpt && d.isBoss) queens.init(e, bossOpt)
    if (roles[d.role]) { e.role = roles[d.role]; e.role.init(e) } else if (queens.roles[d.role]) { e.role = queens.roles[d.role]; e.role.init(e) }
    list.push(e)
    fxBurst('bugSpawn', e.pos, { scale: d.isBoss ? 3 : 1 })
    sfx(['sfx_bug_spawn_0', 'sfx_bug_spawn_1'], e.pos, 0.5)
    emit('enemySpawned', e)
    return e
  }

  function init(e, p, opts, healthScale, damageScale) {
    const d = e.data, inst = e.inst, tpl = templates[e.kind]
    const h = hive()
    e.healthScale = Math.max(0.01, healthScale) * (h && h.healthScale ? h.healthScale : 1)
    e.speedScale = h && h.speedScale ? Math.min(1.45, h.speedScale) : 1
    e.sizeMul = d.isBoss ? 1 : clamp(h && h.sizeScale ? h.sizeScale : 1, 0.85, 1.3)
    e.damageScale = Math.max(0, damageScale)
    e.maxHp = d.maxHealth * e.healthScale
    e.hp = e.maxHp
    e.damageTakenScale = 1
    e.invulnerable = false
    e.hittable = true
    e.weakOpen = false
    e.attackIntervalScale = 1
    e.winding = false; e.windupTimer = 0
    e.attackCooldown = range(0.1, d.attackInterval * 0.6)
    e.barricade = null
    e.staggerT = 0; e.staggerCooldown = 0
    e.hurtCd = 0
    e.flying = !!d.isFlying
    e.climbing = false; e.falling = false
    e.flyVel = new THREE.Vector3(); e.fallVel = new THREE.Vector3()
    e.flySeed = range(0, 10)
    e.groundProbe = 0; e.groundYv = p.y
    e.navOn = false; e.useRoute = true; e.navGoal = new THREE.Vector3().copy(core().pos)
    e.repathT = 0; e.blockedT = 0; e.lookAt = null
    e.wallN = e.wallN || new THREE.Vector3(); e.wallT = 0; e.noTurn = false; e.roleMoves = false
    e.spawnSeconds = d.isBoss ? BOSS_SPAWN_SECONDS : SPAWN_SECONDS
    e.deadT = 0; e.releaseAt = 0
    e.zoneT = rng() * 0.5
    e.armor = d.armor ? { max: Math.max(1, d.armor.plateHealth * e.healthScale), hp: Math.max(1, d.armor.plateHealth * e.healthScale), broken: false } : null
    e.canClimb = !e.flying && d.climbChance > 0 && (opts.climber ?? (rng() < d.climbChance))
    // route (ground): world.route lanes or the breach climb
    e.route = null; e.wp = 0
    if (!e.flying) setupRoute(e, p, opts)
    // placement, facing the Core
    inst.obj.position.copy(p)
    const c = core().pos
    const yaw = opts.yaw ?? Math.atan2(c.x - p.x, c.z - p.z)
    inst.obj.quaternion.setFromAxisAngle(UP, yaw)
    inst.vis.position.set(0, 0, 0); inst.vis.quaternion.identity(); inst.vis.visible = true
    inst.vis.scale.setScalar(e.sizeMul * 0.55)
    for (const n in inst.extraBones) if (inst.extraBones[n]) inst.extraBones[n].scale.set(1, 1, 1)
    G.root.add(inst.obj)
    inst.chitin.reset(rng() * 6.28)
    inst.chitin.setEvolution(evoLook())
    inst.chitin.setGlow(1)
    inst.anim.onFootPlanted = null
    inst.obj.updateMatrix()
    inst.anim.initialize(inst.obj, inst.vis, e.sizeMul)
    e.watch = { t: rng(), samples: [], count: 0, head: 0, stuck: 0, best: Infinity, noProgress: 0, recovered: false, recoverPos: new THREE.Vector3(), recoveries: 0 }
    for (let i = 0; i < 9; i++) e.watch.samples.push(new THREE.Vector3())
    setState(e, ST.SPAWNED)
  }

  function setupRoute(e, p, opts) {
    const w = world()
    if (!w || !w.route) return
    let id = e.spawnId
    if (id === null || id === undefined) {
      if (w.inYard && w.inYard(p)) return
      // nearest spawn lane by bearing (Sky Queen drops on the plain, recovered bugs)
      let best = Infinity
      for (const s of w.spawns || []) { const d2 = (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2; if (d2 < best) { best = d2; id = s.id } }
    }
    if (id === null || id === undefined) return
    const r = w.route(id, { climber: e.canClimb })
    if (!r || !r.length) return
    e.route = r
    e.wp = opts.pos || e.spawnId === null ? nearestWaypoint(e, p, 0, 'any') : 0
  }
  /** remaining route length after each waypoint (cached on the route array) */
  function routeRem(r) {
    let rem = r._rem
    if (!rem || rem.length !== r.length) {
      rem = r._rem = new Float32Array(r.length)
      for (let i = r.length - 2; i >= 0; i--) rem[i] = rem[i + 1] + r[i].distanceTo(r[i + 1])
    }
    return rem
  }
  /**
   * where to rejoin a route from p. 'near' (default): a window around the current waypoint (wp-1 .. wp+3), so a winding
   * route is never short-cut across a cliff; 'any': the nearest waypoint at a similar height (recovery, drops).
   * Inside the yard (open ground): the yard waypoint with the least (reach + route left), i.e. straight on to the Core.
   */
  function nearestWaypoint(e, p, from, mode) {
    const r = e.route, w = world()
    // on the yard floor (not on a stair or deck that zoneOf also calls yard)
    const yardY = core().pos.y
    if (w && w.inYard && w.inYard(p) && Math.abs(p.y - yardY) < 1.2) {
      const rem = routeRem(r)
      let best = Infinity, bi = -1
      for (let i = 0; i < r.length; i++) { if (Math.abs(r[i].y - yardY) > 1.2 || !w.inYard(r[i])) continue; const d = planar(p, r[i]) + rem[i]; if (d < best) { best = d; bi = i } }
      if (bi >= 0) return bi
    }
    const any = mode === 'any'
    const lo = any ? 0 : Math.max(0, from - 1), hi = any ? r.length - 1 : Math.min(r.length - 1, from + 3)
    let best = Infinity, bi = Math.max(0, Math.min(r.length - 1, from))
    for (let pass = 0; pass < 2 && best === Infinity; pass++) {
      for (let i = lo; i <= hi; i++) {
        const dy = Math.abs(p.y - r[i].y)
        if (any && pass === 0 && dy > 2.5) continue
        const d = planar(p, r[i]) + dy * 3
        if (d < best) { best = d; bi = i }
      }
    }
    if (bi + 1 < r.length && planar(p, r[bi + 1]) < planar(r[bi], r[bi + 1]) && Math.abs(p.y - r[bi + 1].y) < 2) bi++
    return bi
  }

  function makeElite(e) {
    const d = e.data
    if (e.elite || d.isBoss) return
    e.elite = true
    e.healthScale *= d.eliteHealthScale
    e.damageScale *= d.eliteDamageScale
    e.maxHp = d.maxHealth * e.healthScale
    e.hp = e.maxHp
    if (e.armor) { e.armor.max = e.armor.hp = Math.max(1, d.armor.plateHealth * e.healthScale) }
    const h = hive()
    e.sizeMul = d.eliteSizeScale * clamp(h && h.sizeScale ? h.sizeScale : 1, 0.85, 1.3)
    e.inst.chitin.setElite(d.eliteGlow, d.eliteRim)
    e.inst.chitin.setGlow(1.6)
  }

  // ---------------------------------------------------------------- state machine helpers
  function setState(e, s) {
    e.state = s; e.stateName = STATE_NAMES[s]; e.stateTime = 0
    if (e.flying) return
    switch (s) {
      case ST.MOVE: e.navOn = true; e.useRoute = true; e.navGoal.copy(core().pos); if (e.route && e.wp < e.route.length) e.wp = nearestWaypoint(e, e.pos, e.wp); break
      case ST.ATTACK_CORE: case ST.ATTACK_BARRICADE: e.navOn = false; e.vel.multiplyScalar(0.3); break
      case ST.ATTACK_PLAYER: e.navOn = true; e.useRoute = false; e.repathT = 0; break
      case ST.SPAWNED: e.navOn = false; break
    }
  }
  const cancelAttack = e => { e.winding = false }
  function coreInRange(e, slack = 0) {
    if (!coreAlive()) return false
    const c = core()
    return planar(e.pos, c.pos) - c.radius - e.data.bodyRadius * 0.5 <= e.data.attackRange + slack
  }
  const playerDistance = e => { const p = tgt(e).pos; return !p ? Infinity : e.flying ? e.pos.distanceTo(p) : planar(e.pos, p) }
  const playerReachable = e => e.flying || Math.abs(tgt(e).pos.y - e.pos.y) < 2.2
  const playerInAggro = (e, extra = 0) => { const t = tgt(e); return !!(t.alive && t.pos) && playerReachable(e) && playerDistance(e) <= e.data.playerAggroRange + extra }
  function faceTowards(e, target, dt, rateMul = 1) {
    const dx = target.x - e.pos.x, dz = target.z - e.pos.z
    if (dx * dx + dz * dz < 1e-4) return
    turnYaw(e, Math.atan2(dx, dz), e.data.angularSpeed * 0.5 * rateMul * DEG * dt)
  }
  function yawOf(e) { _v1.set(0, 0, 1).applyQuaternion(e.obj.quaternion); return Math.atan2(_v1.x, _v1.z) }
  function turnYaw(e, want, step) {
    const cur = yawOf(e)
    const d = angDiff(cur, want)
    const ny = Math.abs(d) <= step ? want : cur + Math.sign(d) * step
    e.obj.quaternion.setFromAxisAngle(UP, ny)
  }
  function checkBarricade(e) {
    if (e.flying) return false
    const b = barricadeBlocking(e.pos, e.data.bodyRadius + e.data.attackRange * 0.8)
    if (!b || !barricadeIntact(b)) return false
    e.barricade = b
    e.winding = false
    setState(e, ST.ATTACK_BARRICADE)
    return true
  }
  function sameSide(b, p, me) {
    const yaw = barricadeYaw(b) * DEG
    const fx = Math.sin(yaw), fz = -Math.cos(yaw)
    const bp = barricadePos(b)
    return ((p.x - bp.x) * fx + (p.z - bp.z) * fz) * ((me.x - bp.x) * fx + (me.z - bp.z) * fz) > 0
  }
  function aimPoint(e, out) {
    const t = templates[e.kind]
    return out.set(0, t.aimY * e.sizeMul, 0).applyQuaternion(e.obj.quaternion).add(e.pos)
  }
  function mouthPoint(e, out) {
    const t = templates[e.kind]
    if (!t.mouth) return aimPoint(e, out)
    return out.copy(t.mouth).multiplyScalar(e.sizeMul).applyQuaternion(e.obj.quaternion).add(e.pos)
  }

  // ---------------------------------------------------------------- TickAttack / DoStrike
  // target kinds: 'core' | 'player' | 'barricade' (ref = barricade) | 'turret' (ref = turret)
  function tickAttack(e, tkind, ref, aim, dt) {
    const d = e.data
    if (e.winding) {
      e.windupTimer -= dt
      if (e.windupTimer <= 0) {
        e.winding = false
        e.inst.anim.strike()
        doStrike(e, tkind, ref, aim)
        e.attackCooldown = d.attackInterval * e.attackIntervalScale
      }
      return
    }
    e.attackCooldown -= dt
    if (e.attackCooldown <= 0) {
      e.winding = true
      e.windupTimer = d.windupSeconds
      e.inst.anim.beginAttack(d.windupSeconds)
      sfx(d.sounds.attack, e.pos, 0.8)
      if (e.boss) queens.onWindup(e)
    }
  }
  const _dsAim = new THREE.Vector3(), _dsFwd = new THREE.Vector3(), _dsFrom = new THREE.Vector3(), _dsVel = new THREE.Vector3(), _dsStrike = new THREE.Vector3()
  function doStrike(e, tkind, ref, aimIn) {
    const d = e.data
    const dmg = d.attackDamage * e.damageScale
    const aim = _dsAim.copy(aimIn)
    const fwd = _dsFwd.set(0, 0, 1).applyQuaternion(e.obj.quaternion)
    if (d.projectile) {
      const from = mouthPoint(e, _dsFrom)
      const v = _dsVel.copy(aim).sub(from).normalize().multiplyScalar(d.projectileSpeed)
      if (d.lobProjectile) lobVelocity(from, aim, d.projectileSpeed, PROJECTILES[d.projectile].gravity, v)
      fireProjectile(d.projectile, from, v, dmg, e, d.attackDamageType)
    } else {
      let inRange = false
      if (tkind === 'core') inRange = coreInRange(e, 0.9)
      else if (tkind === 'barricade') inRange = barricadeIntact(ref)
      else if (tkind === 'player') inRange = tgt(e).alive && playerDistance(e) - 0.4 - d.bodyRadius * 0.5 <= d.attackRange + 0.9
      else if (tkind === 'turret') inRange = !turretDead(ref)
      if (inRange) {
        const info = { type: d.attackDamageType, point: aim.clone(), dir: fwd.clone(), source: 'enemy', sourceId: e.kind }
        if (tkind === 'core') damageCore(dmg, e, info)
        else if (tkind === 'barricade') damageBarricade(ref, dmg, e, info)
        else if (tkind === 'player') damagePlayer(dmg, e, info)
        else if (tkind === 'turret') damageTurret(ref, dmg, e, info)
      }
    }
    if (e.boss) queens.onStruck(e, _dsStrike.copy(e.pos).addScaledVector(fwd, d.bodyRadius + d.attackRange * 0.6))
    if (e.role && e.role.onStruck) e.role.onStruck(e)
  }

  // ---------------------------------------------------------------- per-frame update
  function update(dt) {
    if (!loaded || dt <= 0) return
    dt = Math.min(dt, 0.1)
    clock += dt
    frame++
    chitinTime(clock)
    buildGrid()
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (e.state === ST.DEAD) tickDead(e, dt)
      else { cur = e; try { tickAlive(e, dt) } finally { cur = null } }
    }
    // presentation
    for (let i = 0; i < list.length; i++) {
      const e = list[i], inst = e.inst
      if (inst.vis.visible) inst.anim.update(dt, inst.obj, inst.vis, e.sizeMul, e.alive)
      inst.chitin.update(dt, clock)
      if (e.alive) {
        aimPoint(e, e.aim)
        e.targetable = e.hittable && e.state !== ST.SPAWNED && (!e.role || !e.role.targetable || e.role.targetable(e))
        e.attackingStructure = e.state === ST.ATTACK_CORE || e.state === ST.ATTACK_BARRICADE || e.climbing || !!(e.role && e.role.attackingStructure && e.role.attackingStructure(e))
        e.zoneT -= dt
        if (e.zoneT <= 0) { e.zoneT = 0.5; const w = world(); e.zone = w && w.zoneOf ? w.zoneOf(e.pos) : e.zone }
      }
    }
    updateProjectiles(dt)
    siege.update(dt)
    queens.update(dt)
    updateBossLight(dt)
    markers.update(dt, clock)
    // release finished corpses
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]
      if (e.state === ST.DEAD && clock >= e.releaseAt) { releaseInstance(e.inst); list.splice(i, 1) }
    }
  }

  function tickAlive(e, dt) {
    const d = e.data
    e.stateTime += dt
    e.hurtCd -= dt
    watchdog(e, dt)
    if (!e.alive) return
    if (e.staggerCooldown > 0) e.staggerCooldown -= dt
    if (e.staggerT > 0) { tickStagger(e, dt); return }
    if (e.climbing) { tickClimb(e, dt); return }
    pickTarget(e, dt)
    if (e.netErr) netEase(e, dt)
    if (e.role && e.state !== ST.SPAWNED && e.role.tick(e, dt)) { if (!e.flying && !e.roleMoves) moveGround(e, dt); e.roleMoves = false; return }
    e.roleMoves = false
    switch (e.state) {
      case ST.SPAWNED: {
        const k = clamp01(e.stateTime / SPAWN_POP)
        const pop = 1 + Math.sin(k * Math.PI) * 0.12
        e.inst.vis.scale.setScalar(e.sizeMul * lerp(0.55, 1, 1 - (1 - k) * (1 - k)) * pop)
        if (e.stateTime >= e.spawnSeconds) { e.inst.vis.scale.setScalar(e.sizeMul); setState(e, ST.MOVE) }
        if (e.flying) hover(e, dt)
        break
      }
      case ST.MOVE:
        if (coreInRange(e)) { setState(e, ST.ATTACK_CORE); break }
        if (playerInAggro(e)) { setState(e, ST.ATTACK_PLAYER); break }
        e.inst.anim.clearLook()
        if (e.flying) { fly(e, _v1.copy(core().pos).addScaledVector(UP, FLYER_CORE_ALT), core().radius + d.attackRange * 0.7, false, dt); break }
        if (checkBarricade(e)) break
        break
      case ST.ATTACK_CORE: {
        const c = core().pos
        if (e.flying) fly(e, _v1.copy(c).addScaledVector(UP, FLYER_CORE_ALT), core().radius + d.attackRange * 0.7, true, dt)
        else faceTowards(e, c, dt)
        e.inst.anim.setLook(_v2.copy(c).addScaledVector(UP, 1.5))
        tickAttack(e, 'core', null, _v3.copy(c).addScaledVector(UP, 1.4), dt)
        if (!e.winding && !coreInRange(e, 0.8)) setState(e, ST.MOVE)
        break
      }
      case ST.ATTACK_PLAYER: {
        if (coreInRange(e)) { setState(e, ST.ATTACK_CORE); break }
        if (!playerInAggro(e, 1.5)) { e.winding = false; setState(e, ST.MOVE); break }
        const pp = tgt(e).pos
        e.inst.anim.setLook(_v2.copy(pp).addScaledVector(UP, 1.2))
        if (e.flying) {
          fly(e, _v1.copy(pp).addScaledVector(UP, 3.2), 4.5, true, dt)
          if (playerDistance(e) <= d.attackRange) tickAttack(e, 'player', null, _v3.copy(pp).addScaledVector(UP, 1.1), dt)
          break
        }
        if (!e.winding && checkBarricade(e)) break
        const edge = playerDistance(e) - 0.4 - d.bodyRadius * 0.5
        if (edge <= d.attackRange) {
          e.navOn = false
          faceTowards(e, pp, dt)
          tickAttack(e, 'player', null, _v3.copy(pp).addScaledVector(UP, 1.1), dt)
        } else if (!e.winding) {
          e.navOn = true; e.useRoute = false
          e.repathT -= dt
          if (e.repathT <= 0) { e.repathT = 0.2; e.navGoal.copy(pp) }
        }
        break
      }
      case ST.ATTACK_BARRICADE: {
        const b = e.barricade
        if (!b || !barricadeIntact(b)) { if (!e.winding || !b) { e.winding = false; e.barricade = null; setState(e, ST.MOVE); break } }
        if (!e.winding && playerInAggro(e) && sameSide(b, tgt(e).pos, e.pos)) { setState(e, ST.ATTACK_PLAYER); break }
        const s = strikePoint(b, e.pos, _v3)
        faceTowards(e, s, dt)
        e.inst.anim.setLook(s)
        tickAttack(e, 'barricade', b, s, dt)
        break
      }
    }
    if (!e.flying && e.alive && !e.climbing) moveGround(e, dt)
  }

  // ---------------------------------------------------------------- ground movement ("NavMeshAgent")
  const SEP_CELL = 3, GRID_N = 80, GRID_OFF = 120
  const gridHead = new Int32Array(GRID_N * GRID_N).fill(-1)
  const gridNext = new Int32Array(1024)
  const gridIdx = []
  function cellOf(x, z) {
    const ix = clamp(Math.floor((x + GRID_OFF) / SEP_CELL), 0, GRID_N - 1), iz = clamp(Math.floor((z + GRID_OFF) / SEP_CELL), 0, GRID_N - 1)
    return ix * GRID_N + iz
  }
  function buildGrid() {
    for (let i = 0; i < gridIdx.length; i++) gridHead[gridIdx[i]] = -1
    gridIdx.length = 0
    for (let i = 0; i < list.length && i < 1024; i++) {
      const e = list[i]
      if (!e.alive || e.flying || !e.hittable) continue
      const c = cellOf(e.pos.x, e.pos.z)
      if (gridHead[c] === -1) gridIdx.push(c)
      gridNext[i] = gridHead[c]
      gridHead[c] = i
    }
  }
  const prio = e => (e.boss ? 12 : e.navOn ? 1 : 4) * (e.data.bodyRadius + 0.3)
  /** separation push for e from its grid neighbours (written into out) */
  function separation(e, out) {
    out.set(0, 0, 0)
    const cx = clamp(Math.floor((e.pos.x + GRID_OFF) / SEP_CELL), 0, GRID_N - 1), cz = clamp(Math.floor((e.pos.z + GRID_OFF) / SEP_CELL), 0, GRID_N - 1)
    const ri = e.data.bodyRadius * 0.8 * e.sizeMul, pi = prio(e)
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      if (ix < 0 || ix >= GRID_N) continue
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        if (iz < 0 || iz >= GRID_N) continue
        for (let j = gridHead[ix * GRID_N + iz]; j !== -1; j = gridNext[j]) {
          const o = list[j]
          if (o === e) continue
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z
          if (Math.abs(e.pos.y - o.pos.y) > 1.6) continue
          const rr = ri + o.data.bodyRadius * 0.8 * o.sizeMul
          const d2 = dx * dx + dz * dz
          if (d2 >= rr * rr) continue
          const dd = Math.sqrt(d2) || 1e-3
          const po = prio(o)
          const w = po / (pi + po)
          const push = (rr - dd) * w
          out.x += (d2 > 1e-8 ? dx / dd : (e.id % 2 ? 1 : -1)) * push
          out.z += (d2 > 1e-8 ? dz / dd : 0.3) * push
        }
      }
    }
    return out
  }

  /** the steering point: next route waypoint, else the nav goal */
  function steerPoint(e) {
    if (e.useRoute && e.route) {
      const r = e.route
      while (e.wp < r.length) {
        const w = r[e.wp]
        const dp = planar(e.pos, w), dy = Math.abs(w.y - e.pos.y)
        // stairs, the wall walk and the ramps are narrow: hit those corners closely (NavMesh path corners)
        const rad = ARRIVE[w.kind] || 1.6
        if (dp < rad && dy < 2.5) { e.wp++; continue }
        // pushed past it in a crowd: closer to the next corner than this corner is, on the same level
        if (e.wp + 1 < r.length && dp < 3 && dy < 0.8) { const n = r[e.wp + 1]; if (Math.abs(n.y - e.pos.y) < 1.2 && planar(e.pos, n) < planar(w, n) - 0.3) { e.wp++; continue } }
        // breach climb segment: the next point is far above (cliff + wall face)
        if (e.canClimb && isClimbSegment(r, e.wp - 1) && planar(e.pos, r[e.wp - 1]) < 2.2) { beginClimb(e, r[e.wp], r.climbPath || null); return null }
        return w
      }
    }
    return e.navGoal
  }
  function isClimbSegment(r, i) {
    if (i < 0 || i + 1 >= r.length) return false
    const a = r[i], b = r[i + 1]
    if (a.climb || b.climbTop) return true
    return b.y - a.y > 2.5 && planar(a, b) < 12
  }

  function moveGround(e, dt) {
    const d = e.data
    const speed = d.moveSpeed * e.speedScale
    let tx = 0, tz = 0
    if (e.navOn && e.state !== ST.SPAWNED) {
      const sp = steerPoint(e)
      if (e.climbing) return
      if (sp) {
        const dx = sp.x - e.pos.x, dz = sp.z - e.pos.z, dl = Math.sqrt(dx * dx + dz * dz)
        const stop = e.useRoute && e.route && e.wp < e.route.length ? 0 : 0.05
        if (dl > stop) { tx = dx / dl * speed; tz = dz / dl * speed }
      }
    }
    // accelerate toward the desired velocity
    const ax = tx - e.vel.x, az = tz - e.vel.z, al = Math.sqrt(ax * ax + az * az), step = d.acceleration * dt
    if (al <= step) { e.vel.x = tx; e.vel.z = tz } else { e.vel.x += ax / al * step; e.vel.z += az / al * step }
    separation(e, _v4)
    const maxPush = 3 * dt
    const pl = Math.sqrt(_v4.x * _v4.x + _v4.z * _v4.z)
    if (pl > maxPush) _v4.multiplyScalar(maxPush / pl)
    let mx = e.vel.x * dt + _v4.x, mz = e.vel.z * dt + _v4.z
    if (mx * mx + mz * mz > 1e-8) {
      // level geometry the floor probe cannot see (cliff faces, rampart, containers): a short env ray every 3rd frame
      if ((frame + e.id) % 3 === 0) wallProbe(e, mx, mz, dt)
      if (e.wallT > 0) {
        e.wallT -= dt
        const n = e.wallN, into = mx * n.x + mz * n.z
        if (into < 0) { mx -= n.x * into; mz -= n.z * into; const vi = e.vel.x * n.x + e.vel.z * n.z; if (vi < 0) { e.vel.x -= n.x * vi; e.vel.z -= n.z * vi } }
      }
      tryMove(e, mx, mz, dt)
    }
    // face the velocity (NavMeshAgent updateRotation)
    if (e.navOn && !e.noTurn && e.vel.x * e.vel.x + e.vel.z * e.vel.z > 0.04) turnYaw(e, Math.atan2(e.vel.x, e.vel.z), d.angularSpeed * DEG * dt)
    e.noTurn = false
  }
  function wallProbe(e, mx, mz, dt) {
    const l = Math.sqrt(mx * mx + mz * mz)
    if (l < 1e-6) return
    _ro.set(e.pos.x, e.pos.y + 0.6, e.pos.z)
    _rd.set(mx / l, 0, mz / l)
    const reach = l * 3 + e.data.bodyRadius * 0.6 * e.sizeMul + 0.25
    const hit = raycastEnv(_ro, _rd, reach)
    if (hit && hit.normal && Math.abs(hit.normal.y) < 0.7) {
      const nl = Math.sqrt(hit.normal.x * hit.normal.x + hit.normal.z * hit.normal.z) || 1
      e.wallN.set(hit.normal.x / nl, 0, hit.normal.z / nl)
      e.wallT = 0.15
      e.blockedT += dt
    }
  }
  /** walkable-surface move: refuses steps up > 0.6 m (walls, props, parapets) and drops > 1.1 m (cliff edges); slides */
  function tryMove(e, mx, mz, dt) {
    const p = e.pos
    const y0 = p.y
    let ok = probe(p.x + mx, p.z + mz, y0)
    if (ok !== ok) {
      // a seam or crack between walk meshes: look 0.3 m further before calling it a wall or a drop
      const l = Math.sqrt(mx * mx + mz * mz), k = 1 + 0.3 / Math.max(l, 1e-4)
      const ok2 = probe(p.x + mx * k, p.z + mz * k, y0)
      if (ok2 === ok2) ok = y0 + (ok2 - y0) / k
    }
    if (ok === ok) { p.x += mx; p.z += mz; p.y = ok; e.blockedT = Math.max(0, e.blockedT - dt); return true }
    // slide along whichever axis still works
    const ax = Math.abs(mx) > Math.abs(mz)
    ok = ax ? probe(p.x + mx, p.z, y0) : probe(p.x, p.z + mz, y0)
    if (ok === ok) { if (ax) { p.x += mx; e.vel.z *= 0.5 } else { p.z += mz; e.vel.x *= 0.5 } p.y = ok; e.blockedT += dt * 0.5; return true }
    ok = ax ? probe(p.x, p.z + mz, y0) : probe(p.x + mx, p.z, y0)
    if (ok === ok) { if (ax) { p.z += mz; e.vel.x *= 0.5 } else { p.x += mx; e.vel.z *= 0.5 } p.y = ok; e.blockedT += dt * 0.5; return true }
    e.vel.x *= 0.2; e.vel.z *= 0.2
    e.blockedT += dt
    return false
  }
  function probe(x, z, y0) {
    const y = groundY(x, z, y0 + 3)
    if (y !== y) return NaN
    if (y > y0 + 0.6 || y < y0 - 1.1) return NaN
    return y
  }
  /** a straight walkable run from a to b (NavMesh.Raycast stand-in): returns the clear distance */
  function clearRun(a, b, maxD) {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.min(maxD ?? Infinity, Math.hypot(dx, dz))
    if (L < 1e-3) return 0
    const ux = dx / Math.hypot(dx, dz), uz = dz / Math.hypot(dx, dz)
    let y = a.y
    for (let s = 1; s <= L + 1e-3; s += 1) {
      const t = Math.min(s, L)
      const ny = probe(a.x + ux * t, a.z + uz * t, y)
      if (ny !== ny) return Math.max(0, t - 1)
      y = ny
    }
    return L
  }
  /** direct move along a direction (Rammer / Matriarch charge, agent.Move) */
  function moveDirect(e, dx, dz, dt) {
    const before = _v5.copy(e.pos)
    const bx = before.x, bz = before.z
    if (dx * dx + dz * dz > 1e-10) {
      wallProbe(e, dx, dz, dt)
      if (e.wallT > 0) { const n = e.wallN, into = dx * n.x + dz * n.z; if (into < 0) { dx -= n.x * into; dz -= n.z * into } }
      tryMove(e, dx, dz, dt)
    }
    const ddx = e.pos.x - bx, ddz = e.pos.z - bz
    return Math.sqrt(ddx * ddx + ddz * ddz)
  }
  function navTo(e, p) { e.navOn = true; e.useRoute = false; e.navGoal.copy(p) }
  function navRoute(e) { e.navOn = true; e.useRoute = true; e.navGoal.copy(core().pos) }
  function navStop(e) { e.navOn = false; e.vel.set(0, 0, 0) }
  const routeLeft = e => !!(e.route && e.wp < e.route.length)

  // ---------------------------------------------------------------- flight (Fly, EnemyController.cs:387-415)
  function fly(e, target, standoff, faceTarget, dt) {
    const d = e.data, p = e.pos
    e.groundProbe -= dt
    if (e.groundProbe <= 0) {
      e.groundProbe = 0.15
      const y = groundY(p.x, p.z, p.y + 3)
      e.groundYv = y === y ? y : p.y - d.hoverHeight
    }
    const cruise = Math.max(e.groundYv + d.hoverHeight + 1.2, target.y)
    let tx = target.x - p.x, tz = target.z - p.z
    const dist = Math.sqrt(tx * tx + tz * tz)
    let dx, dz
    if (dist > 0.01) { dx = tx / dist; dz = tz / dist } else { _v5.set(0, 0, 1).applyQuaternion(e.obj.quaternion); dx = _v5.x; dz = _v5.z }
    const sx = dz, sz = -dx // side = cross(up, dir) in three (right-handed): (dz, 0, -dx)
    const spd = d.moveSpeed * e.speedScale
    let vx, vz
    if (dist > standoff) { const k = spd * clamp01((dist - standoff) / 3 + 0.25); vx = dx * k; vz = dz * k }
    else { const o = spd * 0.3 * (e.flySeed > 5 ? 1 : -1), b = (standoff - dist) * 0.8; vx = sx * o - dx * b; vz = sz * o - dz * b }
    const weave = Math.sin(clock * 1.3 + e.flySeed) * 1.4
    vx += sx * weave; vz += sz * weave
    const vy = clamp((cruise - p.y) * 2.2, -3, 6) + Math.sin(clock * 0.9 + e.flySeed) * 0.3
    // MoveTowards(flyVel, desired, accel*dt)
    const fv = e.flyVel
    const ax = vx - fv.x, ay = vy - fv.y, az = vz - fv.z, al = Math.sqrt(ax * ax + ay * ay + az * az), st = d.acceleration * dt
    if (al <= st) fv.set(vx, vy, vz); else fv.set(fv.x + ax / al * st, fv.y + ay / al * st, fv.z + az / al * st)
    p.addScaledVector(fv, dt)
    e.vel.copy(fv)
    const lx = faceTarget ? tx : fv.x, lz = faceTarget ? tz : fv.z
    if (lx * lx + lz * lz > 0.01) turnYaw(e, Math.atan2(lx, lz), d.angularSpeed * DEG * dt)
  }
  function hover(e, dt) {
    // Spawned flyer: rise to cruise height in place
    const y = groundY(e.pos.x, e.pos.z, e.pos.y + 3)
    const gy = y === y ? y : e.pos.y - 2
    e.pos.y += clamp((Math.max(gy + e.data.hoverHeight * 0.5, e.pos.y) - e.pos.y) * 2, -3, 3) * dt
  }

  // ---------------------------------------------------------------- stagger, damage, death
  function stagger(e, seconds, dir) {
    if (!e.alive || e.state === ST.SPAWNED || e.climbing || e.falling) return false
    const s = seconds * e.data.staggerTaken
    if (s <= 0.02 || e.staggerCooldown > 0) return false
    e.staggerT = s
    e.staggerCooldown = s + 0.7
    e.winding = false
    if (!e.flying) e.vel.set(0, 0, 0)
    if (e.flying && dir && dir.lengthSq() > 1e-4) e.flyVel.copy(dir).normalize().multiplyScalar(3.5)
    e.inst.anim.flinch(dir, 1.6 * e.data.hitReactionScale)
    if (e.role && e.role.onStagger) e.role.onStagger(e)
    return true
  }
  function tickStagger(e, dt) {
    e.staggerT -= dt
    if (e.flying) { e.pos.addScaledVector(e.flyVel, dt); e.flyVel.multiplyScalar(Math.exp(-4 * dt)) }
    if (e.staggerT > 0) return
    e.staggerT = 0
  }

  /** Health.ApplyDamage flow (Health.cs:97-139). info: { amount, type, source, sourceId, point, dir, weak, weakBonus, armorBreak, stagger, part } */
  function damage(e, info) {
    if (!e || !info) return 0
    // co-op guest: the host's bug decides. Our own shots go to the host; every hit still shows here, but nothing dies until the
    // host says so (health stays >= 1)
    const N = G.net, pred = !!(N && N.client && !info.net)
    if (pred && info.source === 'player' && e.alive) N.hit(e, info)
    if (e.siege) return siege.damage(e, info, pred)
    if (!e.alive || e.hp <= 0) return 0
    if (e.invulnerable || !e.hittable) return 0
    const d = e.data
    const amount = Math.max(0, info.amount || 0)
    const type = info.type || 'Ballistic'
    const h = hive()
    const res = h && h.resist ? clamp(h.resist[type] || 0, 0, 0.6) : 0
    // Armored Matriarch shells: bullets that strike a shell hit the shell's own Health (grenades never do)
    if (e.rs && e.rs.shells && type !== 'Explosive') {
      const si = info.part && info.part.startsWith && info.part.startsWith('shell') ? +info.part.slice(6) : (info.part === undefined && info.point ? queens.shellAt(e, info.point) : -1)
      if (si >= 0) return queens.damageShell(e, si, amount * (1 - res), info)
    }
    const weak = !!info.weak && e.weakOpen
    let final = amount * (weak ? 2 + Math.max(0, info.weakBonus || 0) : 1) * (1 - res) * e.damageTakenScale
    if (d.weakTo && type === d.weakTo) final *= d.weakToScale
    if (e.armor) final = mitigate(e, info, final, weak, type)
    e.hp = pred ? Math.max(Math.min(e.hp, 1), e.hp - final) : Math.max(0, e.hp - final)
    emit('enemyDamaged', e, final, info)
    onDamaged(e, info, final, weak)
    if (e.hp <= 0 && !pred) die(e, info)
    return final
  }
  function mitigate(e, info, final, weak, type) {
    const A = e.data.armor, a = e.armor
    if (a.broken || weak || type === A.bypassType) return final
    if (A.frontOnly && info.dir && info.dir.lengthSq() > 1e-4) {
      _v1.copy(info.dir).normalize().negate()
      _v2.set(0, 0, 1).applyQuaternion(e.obj.quaternion)
      if (_v1.dot(_v2) <= A.frontDot) return final
    }
    const brk = Math.max(0, info.armorBreak || 0)
    const red = A.reduction * clamp01(1 - A.breakBypass * brk)
    a.hp -= final * A.reduction * (1 + A.breakPlateScale * brk)
    if (a.hp <= 0) {
      a.hp = 0; a.broken = true
      const at = _v3.copy(e.pos).addScaledVector(UP, 0.6)
      fxBurst('armorChip', at, { color: e.data.mat.emis })
      sfx(['sfx_armor_break'], at, 0.9)
    }
    return final - final * red
  }
  function onDamaged(e, info, final, weak) {
    const d = e.data
    if (info.stagger > 0) stagger(e, info.stagger, info.dir)
    const strength = clamp(final / Math.max(1, d.maxHealth * e.healthScale) * 6, 0.25, 1.6) * d.hitReactionScale
    e.inst.anim.flinch(info.dir, strength)
    e.inst.chitin.hit(weak ? 1 : 0.75)
    if (e.hurtCd <= 0) { e.hurtCd = 0.35; sfx(d.sounds.hurt, e.pos, 0.55) }
    if (e.boss) queens.onDamaged(e, info, final, weak)
  }

  function die(e, info) {
    const d = e.data
    e.winding = false
    const perched = !!(e.role && e.role.fallsOnDeath && e.role.fallsOnDeath(e))
    if (e.role && e.role.onDied) e.role.onDied(e, info)
    e.alive = false
    e.targetable = false
    e.attackingStructure = false
    e.state = ST.DEAD; e.stateName = 'Dead'; e.stateTime = 0
    if (e.flying || e.climbing || perched) {
      e.falling = true
      if (e.flying) e.fallVel.copy(e.flyVel)
      else if (e.climbing) { e.fallVel.copy(e.climbOut).multiplyScalar(1.2); e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(-e.climbOut.x, -e.climbOut.z)) }
      else e.fallVel.set(info.dir ? info.dir.x * 1.5 : 0, 1.2, info.dir ? info.dir.z * 1.5 : 0)
      e.climbing = false
    }
    e.inst.anim.die(info.dir, e.obj)
    e.inst.chitin.hit(1)
    e.inst.chitin.beginDissolve(clock, d.corpseSeconds * 0.45, d.corpseSeconds * 0.5)
    const ap = aimPoint(e, _v1)
    fxBurst('bugDeath', ap, { color: d.mat.emis, scale: e.boss ? 3 : Math.max(0.6, e.radius * 1.5) })
    if (e.elite) { fxBurst('eliteDeath', ap, {}); sfx(['sfx_elite_kill'], ap, 1) }
    fxDecal('goo', _v2.copy(e.pos).addScaledVector(UP, 0.05), UP, { life: 14, scale: e.boss ? 4 : 1 + e.radius })
    sfx(d.sounds.death, e.pos, e.boss ? 1 : 0.8)
    if (e.boss) queens.onDied(e, info)
    e.releaseAt = clock + d.corpseSeconds
    emit('enemyKilled', e, info)
  }
  function tickDead(e, dt) {
    if (!e.falling) return
    const fv = e.fallVel
    fv.y -= 9.81 * dt
    fv.x *= Math.exp(-1.5 * dt); fv.z *= Math.exp(-1.5 * dt)
    const p = e.pos
    const ny = p.y + fv.y * dt
    const gy = groundY(p.x + fv.x * dt, p.z + fv.z * dt, p.y + 0.3)
    if (fv.y < 0 && gy === gy && ny <= gy) { p.set(p.x + fv.x * dt, gy, p.z + fv.z * dt); e.falling = false; return }
    p.addScaledVector(fv, dt)
    if (p.y < -20) e.falling = false
  }

  // ---------------------------------------------------------------- cliff / wall climbing (BeginClimb / TickClimb)
  function beginClimb(e, end, path) {
    e.climbing = true
    e.climbPhase = 0
    e.climbTime = 0
    e.climbPath = path && path.length > 1 ? path : null
    e.climbIdx = 1
    e.climbEnd = (e.climbEnd || new THREE.Vector3()).copy(end)
    e.climbOut = e.climbOut || new THREE.Vector3()
    e.climbOut.set(e.pos.x - end.x, 0, e.pos.z - end.z)
    if (e.climbOut.lengthSq() > 0.01) e.climbOut.normalize(); else e.climbOut.set(0, 0, -1).applyQuaternion(e.obj.quaternion)
    e.climbNormal = (e.climbNormal || new THREE.Vector3()).copy(e.climbOut)
    e.climbWant = e.climbWant || new THREE.Quaternion()
    e.winding = false
    e.vel.set(0, 0, 0)
    e.inst.anim.clearLook()
  }
  const _look = new THREE.Matrix4(), _zero = new THREE.Vector3()
  function lookRot(fwd, up, out) {
    // a rotation whose +Z is fwd and +Y is up (Quaternion.LookRotation)
    _v5.copy(fwd).normalize()
    _v4.crossVectors(up, _v5).normalize() // x = up x z
    _v3.crossVectors(_v5, _v4)
    _look.makeBasis(_v4, _v3, _v5)
    return out.setFromRotationMatrix(_look)
  }
  /** follow world.route()'s climbPath (nav.js: cliff face, ledge, wall face, over the parapet) */
  function tickClimbPath(e, dt) {
    const d = e.data, p = e.pos, P = e.climbPath
    const k = e.climbIdx, target = P[k], prev = P[k - 1]
    const dy = target.y - prev.y, dh = planar(target, prev)
    const face = dy > dh * 0.8
    e.climbPhase = target.phase ?? (face ? 1 : 2)
    const speed = d.moveSpeed * e.speedScale * (face ? 0.55 : e.climbPhase === 1 ? 0.55 * 1.3 : 0.8)
    moveTowardsV(p, target, speed * dt)
    const want = e.climbWant
    if (face) {
      const n = target.normal || e.climbOut
      e.climbNormal.lerp(_v1.set(n.x, clamp(n.y || 0, -0.1, 0.6), n.z).normalize(), 1 - Math.exp(-8 * dt)).normalize()
      lookRot(_v2.copy(UP).addScaledVector(e.climbNormal, -e.climbNormal.y), e.climbNormal, want)
    } else {
      e.climbNormal.lerp(UP, 1 - Math.exp(-10 * dt)).normalize()
      _v2.set(target.x - prev.x, 0, target.z - prev.z)
      if (_v2.lengthSq() < 1e-4) _v2.copy(e.climbOut).negate()
      lookRot(_v2, UP, want)
    }
    rotateTowards(e.obj.quaternion, want, 420 * DEG * dt)
    if (p.distanceToSquared(target) < 1e-4) {
      e.climbIdx++
      if (e.climbIdx >= P.length) { e.climbEnd.copy(P[P.length - 1]); finishClimb(e) }
    }
    if ((e.climbTime += dt) > 40) { e.climbEnd.copy(P[P.length - 1]); finishClimb(e) }
  }
  function tickClimb(e, dt) {
    if (e.climbPath) { tickClimbPath(e, dt); return }
    const d = e.data, p = e.pos
    e.climbTime += dt
    const speed = d.moveSpeed * e.speedScale * (e.climbPhase === 1 ? 0.55 : 0.8)
    const out = e.climbOut, want = e.climbWant
    want.copy(e.obj.quaternion)
    switch (e.climbPhase) {
      case 0: {
        lookRot(_v1.copy(out).negate(), UP, want)
        _ro.copy(p).addScaledVector(UP, 0.45); _rd.copy(out).negate()
        if (e.climbTime > 3 || raycastEnv(_ro, _rd, d.bodyRadius + 0.7)) e.climbPhase = 1
        else { p.addScaledVector(out, -speed * dt); const y = groundY(p.x, p.z, p.y + 1); if (y === y && Math.abs(y - p.y) < 1) p.y = y }
        break
      }
      case 1: {
        if (e.climbTime > 16) { e.climbPhase = 2; break }
        const reach = d.bodyRadius + 0.6
        _ro.set(p.x, p.y + 0.3, p.z).addScaledVector(out, 2.5); _rd.copy(out).negate()
        const hit = raycastEnv(_ro, _rd, 9)
        const faceAhead = !!hit && hit.distance - 2.5 < reach
        if (!faceAhead && p.y >= e.climbEnd.y + 0.05) {
          _ro.copy(p).addScaledVector(UP, 0.02).addScaledVector(out, 0.3)
          if (!raycastEnv(_ro, _rd, reach + 0.3)) { e.climbPhase = 2; break }
        }
        if (hit && !faceAhead) {
          // topped a ledge with another face beyond it: run across, feet on the floor
          _v2.copy(hit.point).addScaledVector(hit.normal, d.bodyRadius + 0.1); _v2.y = p.y
          moveTowardsV(p, _v2, speed * 1.3 * dt)
          const fy = groundY(p.x, p.z, p.y + 1)
          if (fy === fy && fy > p.y - 1.8) p.y = moveTowards(p.y, fy, 6 * dt)
          e.climbNormal.lerp(UP, 1 - Math.exp(-10 * dt)).normalize()
          lookRot(_v1.copy(out).negate(), UP, want)
          break
        }
        if (!hit && p.y >= e.climbEnd.y + 0.05) { e.climbPhase = 2; break }
        p.y += speed * dt
        if (faceAhead) {
          _v2.copy(hit.normal); _v2.y = clamp(_v2.y, -0.1, 0.6); _v2.normalize()
          e.climbNormal.lerp(_v2, 1 - Math.exp(-8 * dt)).normalize()
          _v3.copy(hit.point).addScaledVector(UP, -0.3).addScaledVector(e.climbNormal, 0.12)
          _v3.y = p.y
          moveTowardsV(p, _v3, 4 * dt)
          _v1.copy(UP).addScaledVector(e.climbNormal, -UP.dot(e.climbNormal)) // ProjectOnPlane(up, n)
          if (_v1.lengthSq() > 1e-4) lookRot(_v1, e.climbNormal, want)
        } else {
          // no face found (no env geometry): drift toward the top while rising
          _v2.set(e.climbEnd.x, p.y, e.climbEnd.z)
          moveTowardsV(p, _v2, speed * 0.4 * dt)
          lookRot(_v1.copy(UP).addScaledVector(out, -0.2), out, want)
        }
        break
      }
      case 2: {
        _v1.copy(e.climbEnd).sub(p)
        _v2.set(_v1.x, 0, _v1.z)
        if (_v2.lengthSq() > 0.01) lookRot(_v2, UP, want)
        if (_v2.lengthSq() > 0.35 * 0.35 && p.y > e.climbEnd.y + 0.2 && e.climbTime < 18) p.add(_v2.clampLength(0, speed * dt))
        else moveTowardsV(p, e.climbEnd, speed * dt)
        if (p.distanceToSquared(e.climbEnd) < 0.0025) { finishClimb(e); return }
        break
      }
    }
    rotateTowards(e.obj.quaternion, want, 420 * DEG * dt)
  }
  function finishClimb(e) {
    e.climbing = false
    _v1.set(0, 0, 1).applyQuaternion(e.obj.quaternion); _v1.y = 0
    if (_v1.lengthSq() < 1e-4) _v1.copy(e.climbOut).negate()
    e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(_v1.x, _v1.z))
    e.pos.copy(e.climbEnd)
    if (e.route) e.wp = Math.min(e.route.length - 1, nearestWaypoint(e, e.pos, e.wp))
    e.climbsCompleted = (e.climbsCompleted || 0) + 1
  }
  function moveTowards(a, b, step) { return Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step }
  function moveTowardsV(p, t, step) { _v5.copy(t).sub(p); const l = _v5.length(); if (l <= step || l < 1e-6) p.copy(t); else p.addScaledVector(_v5, step / l) }
  function rotateTowards(q, target, step) {
    const ang = q.angleTo(target)
    if (ang < 1e-5) return
    q.slerp(target, Math.min(1, step / ang))
  }

  // ---------------------------------------------------------------- stuck watchdog (simplified EnemyController.cs:716-934)
  function engaged(e) {
    if (e.role && e.role.engaged && e.role.engaged(e)) return true
    if (e.state === ST.SPAWNED || e.state === ST.ATTACK_CORE || e.state === ST.ATTACK_BARRICADE) return true
    if (e.state === ST.ATTACK_PLAYER && (e.winding || (tgt(e).alive && playerDistance(e) - 0.4 - e.data.bodyRadius * 0.5 <= e.data.attackRange + 1))) return true
    return queued(e)
  }
  function queued(e) {
    if (e.flying) return false
    const p = e.pos
    let front = planar(p, core().pos) <= core().radius + 9
    const bl = barricadesList()
    for (let i = 0; !front && i < bl.length; i++) { const b = bl[i]; if (barricadeIntact(b) && Math.abs(p.y - barricadePos(b).y) < 3.5 && planar(p, barricadePos(b)) <= (b.halfWidth || 3.5) + 9) front = true }
    if (!front) return false
    let near = 0
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o === e || !o.alive || o.flying) continue; if (o.pos.distanceToSquared(p) < 9 && ++near >= 2) return true }
    return false
  }
  function watchdog(e, dt) {
    const w = e.watch
    w.t -= dt
    if (w.t > 0) return
    w.t += 1
    if (engaged(e) || e.staggerT > 0 || e.climbing) { w.count = 0; w.head = 0; w.stuck = 0; w.noProgress = 0; w.best = Infinity; w.recovered = false; return }
    const p = e.pos
    w.samples[w.head].copy(p); w.head = (w.head + 1) % w.samples.length
    if (w.count < w.samples.length) w.count++
    if (e.state === ST.MOVE) {
      const dc = planar(p, core().pos)
      if (dc < w.best - 1.5) { w.best = dc; w.noProgress = 0 } else w.noProgress += 1
    } else { w.best = Infinity; w.noProgress = 0 }
    let stationary = w.count === w.samples.length
    if (stationary) for (let i = 0; i < w.count; i++) if (w.samples[i].distanceToSquared(p) > 1) { stationary = false; break }
    const stuck = w.recovered ? p.distanceToSquared(w.recoverPos) < 16 : stationary || w.noProgress >= 25
    if (!stuck) { w.stuck = 0; w.recovered = false; return }
    w.stuck = w.stuck <= 0 ? 8 : w.stuck + 1
    if (w.stuck >= 20) {
      if (!e.data.isBoss) { if (!(G.net && G.net.client)) cull(e); return } // co-op guests wait for the host's word
      w.recovered = false; w.stuck = 8
    }
    if (!w.recovered && w.stuck >= 8 && (w.recoveries < 2 || e.data.isBoss) && recover(e)) {
      w.recovered = true; w.recoverPos.copy(e.pos); w.count = 0; w.noProgress = 0; w.best = Infinity
    }
  }
  function recover(e) {
    const from = _v1.copy(e.pos)
    if (e.flying) {
      _v2.copy(from).sub(core().pos); _v2.y = 0
      if (_v2.lengthSq() < 0.01) _v2.set(0, 0, 1)
      _v2.normalize()
      e.pos.copy(core().pos).addScaledVector(_v2, core().radius + 8).addScaledVector(UP, FLYER_CORE_ALT + 2)
      e.flyVel.set(0, 0, 0)
    } else {
      // the nearest recovery point that lies on (or next to) this bug's own route
      let best = Infinity, to = null
      const cands = (world() && world().recovery) || []
      const r = e.route
      const offRoute = c => { if (!r) return 0; let m = Infinity; for (let i = 0; i < r.length; i++) { const dy = Math.abs(c.y - r[i].y); m = Math.min(m, planar(c, r[i]) + dy * 3) } return m }
      for (const c of cands) { const d = c.distanceTo(from); if (d < 3) continue; const sc = d + 2 * offRoute(c); if (sc < best) { best = sc; to = c } }
      if (!to) for (const s of (world() && world().spawns) || []) { const d = s.pos.distanceTo(from); if (d < 3) continue; if (d < best) { best = d; to = s.pos } }
      if (!to) return false
      e.pos.copy(to)
      const y = groundY(to.x, to.z, to.y + 2); if (y === y) e.pos.y = y
      e.climbing = false
      const c = core().pos
      e.obj.quaternion.setFromAxisAngle(UP, Math.atan2(c.x - e.pos.x, c.z - e.pos.z))
      if (e.route) e.wp = nearestWaypoint(e, e.pos, 0, 'any')
      else setupRoute(e, e.pos, { pos: e.pos })
    }
    e.winding = false; e.barricade = null
    e.watch.recoveries++
    e.inst.vis.scale.setScalar(e.sizeMul * 0.55)
    e.inst.anim.replant(e.obj, e.sizeMul)
    setState(e, ST.SPAWNED)
    fxBurst('bugSpawn', e.pos, {})
    emit('enemyRecovered', e, from, e.pos)
    return true
  }
  /** silent removal of a bug that stayed stuck: no FX or reward, but it counts as killed (info.culled) */
  function cull(e) {
    if (e.role && e.role.onRemoved) e.role.onRemoved(e)
    e.alive = false; e.winding = false; e.climbing = false; e.falling = false
    e.state = ST.DEAD; e.stateName = 'Dead'
    e.releaseAt = clock
    e.inst.vis.visible = false
    emit('enemyKilled', e, { culled: true, source: 'cull', amount: 0 })
  }

  // ---------------------------------------------------------------- projectiles (Combat/Projectile.cs, hostile side)
  function fireProjectile(type, from, vel, dmg, owner, dmgType, extra) {
    const P = PROJECTILES[type]
    let pr = projPool[type].pop()
    if (!pr) { pr = { type, pos: new THREE.Vector3(), vel: new THREE.Vector3(), mesh: markers.projMesh(type, P.colour, P.radius) } }
    pr.pos.copy(from); pr.vel.copy(vel); pr.life = 0; pr.damage = dmg; pr.owner = owner; pr.dmgType = dmgType || 'Ballistic'; pr.extra = extra || null
    pr.mesh.position.copy(from)
    G.root.add(pr.mesh)
    projectiles.push(pr)
    return pr
  }
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3()
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i], P = PROJECTILES[pr.type]
      pr.life += dt
      let done = false
      if (pr.life > P.life) done = true
      else {
        pr.vel.y -= P.gravity * dt
        _pa.copy(pr.pos)
        _pb.copy(pr.pos).addScaledVector(pr.vel, dt)
        const hit = sweepHostile(pr, _pa, _pb, P.radius)
        if (hit) { impact(pr, hit); done = true }
        else {
          pr.pos.copy(_pb)
          pr.mesh.position.copy(pr.pos)
          _v1.copy(pr.vel).normalize()
          pr.mesh.quaternion.setFromUnitVectors(_v2.set(0, 0, 1), _v1)
        }
      }
      if (done) {
        G.root.remove(pr.mesh)
        projPool[pr.type].push(pr)
        projectiles[i] = projectiles[projectiles.length - 1]
        projectiles.pop()
      }
    }
  }
  const sweepHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: '', ref: null }
  /** first thing a hostile shot strikes between a and b: player, Core, turret, barricade or level geometry */
  function sweepHostile(pr, a, b, r) {
    const len = a.distanceTo(b)
    if (len < 1e-6) return null
    _rd.copy(b).sub(a).divideScalar(len)
    let best = len + 1, kind = null, ref = null
    // player capsule (feet pos, 1.8 m tall, r 0.4)
    if (playerAlive()) {
      const pp = G.player.pos
      _ca.copy(pp).addScaledVector(UP, 0.4); _cb.copy(pp).addScaledVector(UP, 1.4)
      const t = rayCapsule(a, _rd, _ca, _cb, 0.4 + r)
      if (t >= 0 && t < best) { best = t; kind = 'player' }
    }
    // Core collider: capsule r 2.5 h 4.8 centred +2.3 (h < 2r, so Unity makes it a sphere r 2.5 at +2.3)
    if (coreAlive()) {
      _ca.copy(core().pos).addScaledVector(UP, CORE_C)
      const t = raySphere(a, _rd, _ca, CORE_R + r)
      if (t >= 0 && t < best) { best = t; kind = 'core' }
    }
    // turrets (capsule r 0.55 around the pivot)
    for (const tw of turretsList()) {
      if (turretDead(tw) || !tw.pos) continue
      _ca.copy(tw.pos).addScaledVector(UP, -0.8); _cb.copy(tw.pos).addScaledVector(UP, 0.6)
      const t = rayCapsule(a, _rd, _ca, _cb, 0.55 + r)
      if (t >= 0 && t < best) { best = t; kind = 'turret'; ref = tw }
    }
    // barricades: the blocker volume (Barricade.Blocking)
    if (!kind || best > len * 0.5) {
      const bb = barricadeBlocking(b, r)
      if (bb && barricadeIntact(bb) && (!kind || len < best)) { best = len; kind = 'barricade'; ref = bb }
    }
    // level geometry
    const env = raycastEnv(a, _rd, Math.min(best, len) + r)
    if (env && env.distance < best) { best = env.distance; kind = 'env'; ref = null; sweepHit.normal.copy(env.normal || UP) }
    else sweepHit.normal.copy(_rd).negate()
    // ground fallback (no env BVH: flat stub worlds)
    if (!kind) {
      const gy = groundY(b.x, b.z, Math.max(a.y, b.y) + 1)
      if (gy === gy && b.y - r <= gy && pr.vel.y < 0) {
        const dyA = a.y - gy, dyB = b.y - gy
        const t = dyA - dyB > 1e-6 ? clamp01(dyA / (dyA - dyB)) * len : len
        best = t; kind = 'env'; sweepHit.normal.copy(UP)
      }
    }
    if (!kind || best > len + r) return null
    sweepHit.point.copy(a).addScaledVector(_rd, Math.min(best, len))
    sweepHit.kind = kind; sweepHit.ref = ref
    return sweepHit
  }
  function impact(pr, hit) {
    const P = PROJECTILES[pr.type]
    const info = { type: pr.dmgType, point: hit.point, dir: pr.vel.clone().normalize(), source: 'enemy', sourceId: pr.owner ? pr.owner.kind : 'Hive' }
    if (hit.kind === 'player') damagePlayer(pr.damage, pr.owner, info)
    else if (hit.kind === 'core') damageCore(pr.damage, pr.owner, info)
    else if (hit.kind === 'turret') damageTurret(hit.ref, pr.damage, pr.owner, info)
    else if (hit.kind === 'barricade') damageBarricade(hit.ref, pr.damage, pr.owner, info)
    if (P.splash > 0) splashHostile(hit.point, P.splash, P.splashScale, pr, hit.kind, hit.ref, info)
    fxBurst(P.fx, hit.point, { normal: hit.normal })
    if (P.decal && hit.kind === 'env') fxDecal(P.decal, hit.point, hit.normal, { life: P.decalLife, scale: P.splash })
    sfx(P.sound, hit.point, pr.type === 'shell' ? 1 : 0.7)
    if (pr.type === 'shell') shakeAt(0.28, hit.point, 30)
    if (pr.extra && pr.extra.onImpact) pr.extra.onImpact(hit)
    emit('enemyProjectileHit', pr.type, hit.kind, hit.point)
  }
  /** SplashHostile: non-bug targets within r, amount*scale*lerp(1, 0.4, d/r), excluding the direct hit */
  function splashHostile(c, r, scale, pr, skipKind, skipRef, info) {
    const amt = d => pr.damage * scale * lerp(1, 0.4, clamp01(d / r))
    if (skipKind !== 'player' && playerAlive()) {
      const pp = G.player.pos
      _ca.copy(pp).addScaledVector(UP, 0.4); _cb.copy(pp).addScaledVector(UP, 1.4)
      const d = Math.max(0, segDist(c, _ca, _cb) - 0.4)
      if (d <= r) damagePlayer(amt(d), pr.owner, info)
    }
    if (skipKind !== 'core' && coreAlive()) {
      _ca.copy(core().pos).addScaledVector(UP, CORE_C)
      const d = Math.max(0, c.distanceTo(_ca) - CORE_R)
      if (d <= r) damageCore(amt(d), pr.owner, info)
    }
    for (const tw of turretsList()) {
      if (tw === skipRef || turretDead(tw) || !tw.pos) continue
      _ca.copy(tw.pos).addScaledVector(UP, -0.8); _cb.copy(tw.pos).addScaledVector(UP, 0.6)
      const d = Math.max(0, segDist(c, _ca, _cb) - 0.55)
      if (d <= r) damageTurret(tw, amt(d), pr.owner, info)
    }
    for (const b of barricadesList()) {
      if (b === skipRef || !barricadeIntact(b)) continue
      const sp = strikePoint(b, c, _v4)
      const d = Math.max(0, Math.hypot(sp.x - c.x, sp.z - c.z) - 0.6)
      if (d <= r && Math.abs(sp.y - c.y) < 3.5) damageBarricade(b, amt(d), pr.owner, info)
    }
  }

  // ---------------------------------------------------------------- hit volumes: raycast / sphere
  /** current model-space position of weak sphere / shell (follows the animated body) */
  function partPos(e, restPos, out) {
    const a = e.inst.anim
    return out.copy(restPos).applyQuaternion(a.bodyQ).add(a.bodyT)
  }
  function toLocal(e, p, out) {
    _q1.copy(e.obj.quaternion).invert()
    return out.copy(p).sub(e.pos).applyQuaternion(_q1).divideScalar(e.sizeMul)
  }
  function getHit() { return hitPool.pop() || { enemy: null, distance: 0, point: new THREE.Vector3(), weak: false, part: undefined } }
  /**
   * enemies.raycast(origin, dir, far) -> [{ enemy, distance, point, weak, part }] near -> far, one entry per enemy.
   * The array and its entries are reused: valid until the next raycast() call.
   */
  function raycast(origin, dir, far = 500) {
    for (const h of hitOut) hitPool.push(h)
    hitOut.length = 0
    _rd.copy(dir).normalize()
    const n = list.length
    for (let i = 0; i < n + siege.nodes.length; i++) {
      const e = i < n ? list[i] : siege.nodes[i - n]
      if (!e.alive || !e.hittable) continue
      if (e.siege) { const h = siege.raycast(e, origin, _rd, far); if (h) { const o = getHit(); o.enemy = e; o.distance = h.t; o.point.copy(origin).addScaledVector(_rd, h.t); o.weak = h.weak; o.part = undefined; hitOut.push(o) } continue }
      // broad phase: bounding sphere around the body
      const tpl = templates[e.kind], s = e.sizeMul
      _v1.copy(tpl.center).multiplyScalar(s).applyQuaternion(e.obj.quaternion).add(e.pos)
      const br = tpl.bsphere.radius * s
      _v2.copy(_v1).sub(origin)
      const tc = _v2.dot(_rd)
      if (tc < -br || tc > far + br) continue
      if (_v2.lengthSq() - tc * tc > br * br) continue
      // narrow phase in model space
      toLocal(e, origin, _ro)
      _q1.copy(e.obj.quaternion).invert()
      _cp.copy(_rd).applyQuaternion(_q1)
      let best = Infinity, weak = false, part
      for (const c of tpl.capsules) { const t = rayCapsule(_ro, _cp, c.a, c.b, c.r); if (t >= 0 && t < best) best = t }
      if (tpl.sphere) { const t = raySphere(_ro, _cp, tpl.sphere.c, tpl.sphere.r); if (t >= 0 && t < best) best = t }
      // parts (weak sacs, Matriarch shells) sit half inside the body capsule, as in Unity where the capsule hides them
      // from nearly every angle; here a part the ray crosses within PART_DEPTH behind the body surface takes the hit
      let pBest = Infinity
      if (e.weakOpen) for (let k = 0; k < tpl.weak.length; k++) {
        if (e.rs && e.rs.shells && !e.rs.shells[k].broken) continue
        const t = raySphere(_ro, _cp, partPos(e, tpl.weak[k].pos, _ca), tpl.weak[k].r)
        if (t >= 0 && t < pBest) { pBest = t; weak = true; part = 'weak_' + k }
      }
      if (e.rs && e.rs.shells) for (let k = 0; k < tpl.shells.length; k++) {
        if (e.rs.shells[k].broken) continue
        const t = raySphere(_ro, _cp, partPos(e, tpl.shells[k].pos, _ca), tpl.shells[k].r)
        if (t >= 0 && t < pBest) { pBest = t; weak = false; part = 'shell_' + k }
      }
      if (pBest <= best + PART_DEPTH) best = pBest
      else { weak = false; part = undefined }
      if (best === Infinity) continue
      const dist = best * s
      if (dist > far) continue
      const o = getHit()
      o.enemy = e; o.distance = dist; o.point.copy(origin).addScaledVector(_rd, dist); o.weak = weak; o.part = part
      hitOut.push(o)
    }
    hitOut.sort(byDistance)
    return hitOut
  }
  /** enemies.sphere(center, radius) -> [{ enemy, distance }] (closest-point distance to the body), reused array */
  function sphere(center, radius) {
    sphereOut.length = 0
    const n = list.length
    for (let i = 0; i < n + siege.nodes.length; i++) {
      const e = i < n ? list[i] : siege.nodes[i - n]
      if (!e.alive || !e.hittable) continue
      let dist
      if (e.siege) dist = siege.distance(e, center)
      else {
        const tpl = templates[e.kind], s = e.sizeMul
        if (e.pos.distanceTo(center) > radius + tpl.bsphere.radius * s + 2) continue
        toLocal(e, center, _ro)
        let best = Infinity
        for (const c of tpl.capsules) best = Math.min(best, segDist(_ro, c.a, c.b) - c.r)
        if (tpl.sphere) best = Math.min(best, _ro.distanceTo(tpl.sphere.c) - tpl.sphere.r)
        if (e.rs && e.rs.shells) for (let k = 0; k < tpl.shells.length; k++) if (!e.rs.shells[k].broken) best = Math.min(best, _ro.distanceTo(partPos(e, tpl.shells[k].pos, _ca)) - tpl.shells[k].r)
        dist = Math.max(0, best * s)
      }
      if (dist <= radius) sphereOut.push(sphereEntry(sphereOut.length, e, dist))
    }
    return sphereOut
  }
  const sphereEntries = []
  function sphereEntry(i, e, d) { const o = sphereEntries[i] || (sphereEntries[i] = { enemy: null, distance: 0 }); o.enemy = e; o.distance = d; return o }

  /** debug / HUD: world positions of an enemy's weak points and shells: [{ part, pos, r, open }] (allocates) */
  function parts(e) {
    const out = []
    if (!e || e.siege) return out
    const tpl = templates[e.kind]
    const add = (part, rest, r, open) => {
      const pos = partPos(e, rest, new THREE.Vector3()).multiplyScalar(e.sizeMul).applyQuaternion(e.obj.quaternion).add(e.pos)
      out.push({ part, pos, r: r * e.sizeMul, open })
    }
    tpl.weak.forEach((w, k) => add('weak_' + k, w.pos, w.r, e.weakOpen && !(e.rs && e.rs.shells && !e.rs.shells[k].broken)))
    tpl.shells.forEach((w, k) => add('shell_' + k, w.pos, w.r, !e.rs.shells[k].broken))
    return out
  }

  // ---------------------------------------------------------------- co-op (net.js): the host's bugs, mirrored on the guests
  const byId = id => { for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; for (const n of siege ? siege.nodes : []) if (n.id === id) return n; return null }
  const r2 = v => Math.round(v * 100) / 100
  /** what a guest needs to make the same bug (host side, after spawn) */
  function spawnInfo(e) {
    const ns = e.netSpawn || {}, b = ns.boss
    const o = { i: e.id, k: e.kind, p: [r2(e.pos.x), r2(e.pos.y), r2(e.pos.z)] }
    if (e.siege) { o.w = e.wave; return o }
    o.y = r2(yawOf(e))
    if (e.elite) o.el = 1
    if (b) { o.b = b.appearance || 1; if (b.reason) o.br = String(b.reason).slice(0, 90) }
    if (ns.hs != null) o.hs = r2(ns.hs)
    if (ns.ds != null) o.ds = r2(ns.ds)
    if (e.minion) o.m = 1
    if (e.spawnId != null) o.sp = e.spawnId
    if (e.canClimb) o.cl = 1
    return o
  }
  /** guest: make the host's bug (same id) */
  function netSpawn(o) {
    const have = byId(o.i)
    if (have) return have
    const pos = new THREE.Vector3(o.p[0], o.p[1], o.p[2])
    if (o.k === 'SiegeNode') return siege.grow(pos, o.w, o.i)
    if (!KINDS[o.k]) return null
    return spawn(o.k, {
      net: true, id: o.i, pos, keepY: true, yaw: o.y, elite: o.el === 1, boss: o.b ? { appearance: o.b, reason: o.br || '' } : undefined,
      healthScale: o.hs, damageScale: o.ds, minion: o.m === 1, spawnId: o.sp, climber: o.cl === 1,
    })
  }
  /** guest: the host's bug died (info: { source, type, sourceId, remote, culled, dir }) */
  function netKill(id, info) {
    const e = byId(id)
    if (!e || !e.alive) return null
    info.net = true
    if (e.siege) { siege.kill(e, info); return e }
    e.hp = 0
    if (info.culled) cull(e)
    else die(e, info)
    return e
  }
  /** guest: ease toward the host's position (snap when far), take the host's health (never above ours: our own hits may be
   * on their way), armour plates broken there break here */
  function netCorrect(e, x, y, z, hp, flags) {
    if (!e || !e.alive) return
    if (e.siege) { if (hp < e.hp) e.hp = Math.max(1, hp); return }
    if (hp < e.hp) {
      e.hp = Math.max(1, hp)
      if (e.boss) queens.onDamaged(e, {}, 0, false) // phases follow health
    }
    if ((flags & 1) && e.armor && !e.armor.broken) { e.armor.hp = 0; e.armor.broken = true }
    const dx = x - e.pos.x, dy = y - e.pos.y, dz = z - e.pos.z
    const d2 = dx * dx + dz * dz
    if (e.climbing && d2 < 36 && Math.abs(dy) < 6) return // a climb follows its own path
    if (d2 > 25 || Math.abs(dy) > 4) {
      e.pos.set(x, y, z)
      e.netErr = null
      if (e.climbing) { e.climbing = false; setState(e, ST.MOVE) }
      if (e.route) e.wp = nearestWaypoint(e, e.pos, 0, 'any')
      return
    }
    if (d2 < 0.09 && Math.abs(dy) < 0.3) { e.netErr = null; return }
    e.netErr = (e.netErr || new THREE.Vector3()).set(dx, e.flying ? dy : 0, dz)
  }
  function netEase(e, dt) {
    const k = Math.min(1, dt * 5)
    e.pos.addScaledVector(e.netErr, k)
    e.netErr.multiplyScalar(1 - k)
    if (e.netErr.lengthSq() < 0.0004) e.netErr = null
  }
  /** guest: a bug the host no longer has (missed message): gone without a word */
  function netRemove(e) {
    if (!e || !e.alive || e.siege) return
    if (e.role && e.role.onRemoved) e.role.onRemoved(e)
    e.alive = false; e.winding = false; e.climbing = false; e.falling = false
    e.state = ST.DEAD; e.stateName = 'Dead'
    e.releaseAt = clock
    e.inst.vis.visible = false
  }

  // ---------------------------------------------------------------- misc API
  function alive() {
    let n = 0
    for (const e of list) if (e.alive) n++
    return n
  }
  function clear() {
    for (const e of list) { if (e.alive && e.role && e.role.onRemoved) e.role.onRemoved(e); releaseInstance(e.inst) }
    list.length = 0
    for (const pr of projectiles) { G.root.remove(pr.mesh); projPool[pr.type].push(pr) }
    projectiles.length = 0
    if (markers) markers.clear()
    if (siege) siege.clear()
    if (queens) queens.clear()
  }
  function updateBossLight(dt) {
    if (!bossLight) return
    let boss = null
    for (let i = 0; i < list.length; i++) { const e = list[i]; if (e.boss && e.state !== ST.DEAD && e.inst.vis.visible) { boss = e; break } }
    if (!boss) { bossLight.intensity = 0; return }
    const c = boss.data.glowLight || [1, 0.4, 0.1]
    bossLight.color.setRGB(c[0], c[1], c[2])
    const tpl = templates[boss.kind]
    aimPoint(boss, bossLight.position)
    bossLight.position.addScaledVector(_v1.set(0, 0, -1).applyQuaternion(boss.obj.quaternion), tpl.box.max.z * 0.2 + 0.8)
    bossLight.intensity = bossLight.userData.base * (1 + (Math.sin(clock * 13) * 0.5 + Math.sin(clock * 7.3) * 0.5) * 0.2) * boss.inst.chitin.glow
  }

  const kit = {
    G, THREE, ST, KINDS, PROJECTILES, UP, get clock() { return clock }, get list() { return list },
    rng, range, pick, emit, sfx, fxBurst, fxDecal, shake, shakeAt, world, core, coreAlive, groundY, raycastEnv,
    playerAlive: () => (cur ? tgt(cur).alive : playerAlive()), playerPos: () => (cur ? tgt(cur).pos : playerPos()),
    turretsList, barricadesList, barricadeIntact, barricadeBlocking, barricadePos, strikePoint, turretOffline, turretDead,
    damagePlayer, damageCore, damageBarricade, damageTurret, planar, clamp, clamp01, lerp, invLerp,
    setState, cancelAttack, coreInRange, playerInAggro, playerDistance, faceTowards, turnYaw, tickAttack, checkBarricade,
    navTo, navRoute, navStop, routeLeft, moveDirect, clearRun, probe, fly, stagger, aimPoint, mouthPoint, fireProjectile, lobVelocity,
    spawn: (k, o) => spawn(k, o), templates, get markers() { return markers }, hive, evoLook, die, damage: (e, i) => damage(e, i),
    setWeakOpen: (e, open) => { e.weakOpen = open }, setHittable: (e, on) => { e.hittable = on },
  }

  const api = {
    load, spawn, update, list, alive, raycast, sphere, damage, clear,
    byId, spawnInfo, netSpawn, netKill, netCorrect, netRemove, yawOf: e => yawOf(e),
    /** Siege Node director: call every COMBAT frame from the run loop: enemies.siegeTick(wave, waveTime). */
    siegeTick: (wave, waveTime, opts) => siege.tick(wave, waveTime, opts),
    /** grow a Siege Node now (tests / scripted): enemies.siegeGrow(pos|null, wave) */
    siegeGrow: (pos, wave) => siege.grow(pos, wave),
    get siegeNodes() { return siege ? siege.nodes : [] },
    /** boss rotation (BossRotation.Choose): pickQueen({ appearance, history|picks, latestGeneration, faced }) -> { kind, title, reason, appearance, because } */
    pickQueen: state => queens.pickQueen(state),
    /** the live queen (or null) for the HUD boss band: e.boss = { title, phase, phaseLabel, status, uiColor, ... } */
    get boss() { for (const e of list) if (e.boss && e.alive) return e; return null },
    stagger: (e, seconds, dir) => stagger(e, seconds, dir),
    lobVelocity, parts,
    /** tests and tooling */
    _kit: kit, templates, projectiles,
    get markers() { return markers },
    get clock() { return clock },
  }
  return api
}
