// Hive Adapt (Project 0 port): bug navigation, zones and lane points for world.js.
// Replaces the Unity NavMesh with hand-built waypoint polylines that follow the same lanes the NavMesh produced:
// spawn -> causeway foot -> up the ramp -> through the gate -> yard -> Core, flank spawns around the plain, and the
// climbers' off-mesh links up the cliff and the patched wall at the two breaches, then along the wall walk and down a stair.
//
// Route format (world.route(spawnId, opts) -> Array<THREE.Vector3>), game space, last point ~3.6 m from the Core centre:
//   wp.kind     : 'spawn'|'lane'|'arc'|'approach'|'foot'|'ramp'|'gate'|'yard'|'core'|'climbFoot'|'wallTop'|'walk'|'stairTop'|'stair'|'stairFoot'
//   wp.climb    : true on the climb-link START (the 'climbFoot' on the plain, 1.3 m outside the cliff foot): the segment
//                 route[i] -> route[i+1] is a climb (Unity NavMeshLink area "Climb"), not walkable ground
//   wp.climbTop : true on the climb-link END (the 'wallTop' point on the wall walk, Compass(yaw, 17.3, 9.8))
//   wp.slot     : on the two ramp points that sit on a barricade slot ('CausewayA'|'GateA'|...)
//   route.climbPath : for climb routes, the detailed climb polyline from the foot to the top (THREE.Vector3[]), each
//                 point with .phase (0 up the cliff face, 1 over the ledge and up the wall face, 2 over the parapet) and
//                 .normal (horizontal outward face normal, game space); null otherwise
//   route.spawnId, route.climber, route.breach ('W'|'E'|null), route.gate ('A'|'B'|null),
//   route.climbStart / route.climbEnd = indices of the link start / end (-1 when none)
import * as THREE from 'three'
import { K, uc, ulat, plainHeight, rampRoadY, cliffRadius, cliffMaxR, lipRadius, stairInfo, angleTo, deltaAngle, bastions } from './worldgeo.js'

const G3 = (u, kind, extra) => { const v = new THREE.Vector3(u.x, u.y, -u.z); v.kind = kind; if (extra) Object.assign(v, extra); return v }
const onPlain = u => { u.y = plainHeight(u.x, u.z); return u }

export const GATES = [
  { id: 'A', bearing: -40 },
  { id: 'B', bearing: 48 },
]
export const BREACHES = [
  { id: 'W', bearing: -105, stair: 180 },
  { id: 'E', bearing: 112, stair: 135 },
]
export const SPAWN_IDS = ['A', 'B', 'C', 'D']

export function spawnList() {
  return K.SPAWNS.map((bearing, i) => ({ id: SPAWN_IDS[i], index: i, bearing, radius: 2.5, pos: G3(onPlain(uc(bearing, K.SPAWN_R)), 'spawn') }))
}
export function gateList() {
  return GATES.map((g, i) => {
    const b = g.bearing
    return {
      id: g.id, index: i, bearing: b,
      centre: G3(uc(b, K.WALL_R, K.H), 'gate'),
      foot: G3(uc(b, K.RAMP_FOOT, 0.02), 'foot'),
      top: G3(uc(b, K.RAMP_TOP, K.H + 0.03), 'ramp'),
      inside: G3(uc(b, K.WALL_R - 5, K.H), 'yard'),
    }
  })
}
/** the climb links: 3 per breach at bearing offsets -4/0/+4, foot 1.3 m outside the cliff foot, top on the wall walk */
export function climbLinks(breachBearing) {
  return [-4, 0, 4].map(off => {
    const yaw = breachBearing + off
    const footR = cliffMaxR(yaw, -0.5, K.H)
    return { yaw, off, foot: G3(onPlain(uc(yaw, footR + 1.3)), 'climbFoot'), top: G3(uc(yaw, K.WALL_R - 0.2, K.WALL_TOP), 'wallTop') }
  })
}
export function breachList() {
  return BREACHES.map((b, i) => {
    const links = climbLinks(b.bearing)
    return { id: b.id, index: i, bearing: b.bearing, climbFoot: links[1].foot.clone(), wallTop: links[1].top.clone(), links, stair: b.stair, centre: G3(uc(b.bearing, K.WALL_R, K.H), 'gate') }
  })
}
/** stuck-bug recovery points (Outpost.cs:630-645) */
export function recoveryPoints() {
  const out = []
  for (const r of K.RAMPS) {
    out.push(G3(onPlain(uc(r, K.RAMP_FOOT + 3)), 'foot'))
    const mid = (K.RAMP_TOP + K.RAMP_FOOT) / 2
    out.push(G3(uc(r, mid, rampRoadY(mid)), 'ramp'))
    out.push(G3(uc(r, K.WALL_R - 5, K.H), 'yard'))
  }
  for (const a of K.SPAWNS) out.push(G3(onPlain(uc(a, 62)), 'lane'))
  return out.map(v => new THREE.Vector3().copy(v))
}

// ------------------------------------------------------------------ routes
function arc(fromB, toB, r, stepDeg, stopWithin) {
  const pts = []
  const d = deltaAngle(fromB, toB)
  const n = Math.max(1, Math.ceil((Math.abs(d) - stopWithin) / stepDeg))
  for (let i = 0; i <= n; i++) {
    const b = fromB + Math.sign(d) * Math.min(Math.abs(d) - stopWithin, i * stepDeg)
    pts.push(G3(onPlain(uc(b, r)), 'arc'))
  }
  return pts
}
/** from the causeway foot of gate g up the ramp, through the gate and across the yard to the Core */
function gateLeg(g) {
  const b = GATES[g].bearing
  const pts = []
  pts.push(G3(onPlain(uc(b, K.RAMP_FOOT + 3)), 'approach'))
  pts.push(G3(uc(b, K.RAMP_FOOT - 0.6, rampRoadY(K.RAMP_FOOT - 0.6)), 'foot'))
  pts.push(G3(uc(b, 31, rampRoadY(31)), 'ramp', { slot: 'Causeway' + GATES[g].id }))
  pts.push(G3(uc(b, K.RAMP_TOP, K.H + 0.03), 'ramp'))
  pts.push(G3(uc(b, 21.4, K.H + 0.03), 'ramp', { slot: 'Gate' + GATES[g].id }))
  pts.push(G3(uc(b, K.WALL_R, K.H + 0.03), 'gate'))
  pts.push(G3(uc(b, K.WALL_R - 5, K.H), 'yard'))
  pts.push(G3(uc(b, 3.6, K.H), 'core'))
  return pts
}
/** the yard paths from each stair's foot to the Core (Unity x,z), kept clear of the watchtowers, container and crates */
const STAIR_YARD = {
  180: [[3.2, -12.0], [0.7, -4.6], [0.55, -3.55]],
  135: [[9.5, -5.6], [3.2, -1.75]],
  4: [[3.0, 9.0], [1.2, 3.4]],
}
function stairLeg(stairYaw) {
  const s = stairInfo(stairYaw)
  // the flight is straight (tangent at r 15.5), so its far end runs close to the wall face: walk 0.35 m inside its centre line
  const line = s.top.clone().addScaledVector(uc(stairYaw), -0.35)
  const pts = []
  pts.push(G3(uc(stairYaw, K.WALL_R - 0.5, K.WALL_TOP), 'walk'))
  pts.push(G3(line.clone().addScaledVector(s.down, s.tread * 0.5).setY(K.WALL_TOP), 'stairTop'))
  pts.push(G3(line.clone().addScaledVector(s.down, s.tread * 5).setY(K.WALL_TOP - s.rise * 4.5), 'stair'))
  pts.push(G3(line.clone().addScaledVector(s.down, s.tread * 9.5).setY(K.WALL_TOP - s.rise * 9), 'stair'))
  pts.push(G3(line.clone().addScaledVector(s.down, s.tread * 11.2).addScaledVector(uc(stairYaw), -0.7).setY(K.H), 'stairFoot'))
  const yard = STAIR_YARD[stairYaw]
  yard.forEach(([x, z], i) => pts.push(G3(new THREE.Vector3(x, K.H, z), i === yard.length - 1 ? 'core' : 'yard')))
  return pts
}
/** the climb itself for one link: cliff face, ledge, wall face, over the parapet, onto the walk */
function climbLeg(yaw) {
  const pts = []
  const outN = uc(yaw)
  const nG = new THREE.Vector3(outN.x, 0, -outN.z)
  const C = (u, kind, phase) => G3(u, kind, { phase, normal: nG.clone() })
  const baseR = cliffRadius(yaw, 0) + 0.35
  pts.push(C(uc(yaw, baseR, Math.max(0, plainHeight(uc(yaw, baseR).x, uc(yaw, baseR).z))), 'face', 0))
  for (const y of [1.5, 3, 4.5, 6]) pts.push(C(uc(yaw, cliffMaxR(yaw, y - 0.75, Math.min(K.H, y + 0.75)) + 0.3, y), 'face', 0))
  pts.push(C(uc(yaw, lipRadius(yaw) - 0.2, K.H), 'lip', 1))
  pts.push(C(uc(yaw, K.WALL_R + K.WALL_HT + 0.45, K.H), 'ledge', 1))
  pts.push(C(uc(yaw, K.WALL_R + K.WALL_HT + 0.45, K.WALL_TOP + K.PAR_H - 0.2), 'wallFace', 1))
  pts.push(C(uc(yaw, K.WALL_R + K.WALL_HT - K.PAR_T / 2, K.WALL_TOP + K.PAR_H + 0.15), 'over', 2))
  pts.push(C(uc(yaw, K.WALL_R - 0.2, K.WALL_TOP), 'wallTop', 2))
  return pts
}
/** along the wall walk (r 17.3) from one bearing to the stair bearing (the walk is continuous around the south side) */
function walkLeg(fromB, toB) {
  const pts = []
  const d = deltaAngle(fromB, toB)
  const n = Math.max(1, Math.ceil(Math.abs(d) / 9))
  for (let i = 1; i < n; i++) pts.push(G3(uc(fromB + d * i / n, K.WALL_R - 0.2, K.WALL_TOP), 'walk'))
  return pts
}
function nearestGate(bearing) {
  let best = 0
  GATES.forEach((g, i) => { if (angleTo(bearing, g.bearing) < angleTo(bearing, GATES[best].bearing)) best = i })
  return best
}
function nearestBreach(bearing) {
  let best = 0
  BREACHES.forEach((b, i) => { if (angleTo(bearing, b.bearing) < angleTo(bearing, BREACHES[best].bearing)) best = i })
  return best
}

/**
 * route(spawnId, { climber, lane, breach, rng }) -> waypoint array (see the format at the top of this file).
 * Lane spawns A/B walk their own causeway. Flank spawns C/D: non-climbers circle the plain (r 52, between the cliff and the
 * ruins ring) to the nearest causeway; climbers go to the nearest breach and climb link (lane 0/1/2 = bearing -4/0/+4, random
 * when omitted). opts.breach ('W'|'E') sends any climber (also from A/B) up that breach.
 */
export function buildRoute(spawnId, opts = {}) {
  const si = typeof spawnId === 'number' ? Math.max(0, Math.min(3, spawnId | 0)) : Math.max(0, SPAWN_IDS.indexOf(spawnId))
  const sb = K.SPAWNS[si]
  const flank = si >= 2
  const pts = []
  pts.push(G3(onPlain(uc(sb, K.SPAWN_R)), 'spawn'))
  for (const r of [80, 72]) pts.push(G3(onPlain(uc(sb, r)), 'lane'))
  pts.push(G3(onPlain(uc(sb, 62)), 'lane'))
  let breach = null, gate = null
  const wantClimb = !!opts.climber && (flank || opts.breach)
  if (wantClimb) {
    const bi = opts.breach ? Math.max(0, BREACHES.findIndex(b => b.id === opts.breach)) : nearestBreach(sb)
    const B = BREACHES[bi]
    breach = B.id
    const r = opts.rng || Math.random
    const lane = opts.lane != null ? opts.lane : Math.floor(r() * 3)
    const yaw = B.bearing + [-4, 0, 4][Math.max(0, Math.min(2, lane))]
    const footR = cliffMaxR(yaw, -0.5, K.H)
    if (angleTo(sb, yaw) > 20) pts.push(...arc(sb, yaw, 52, 12, 10).slice(1))
    pts.push(G3(onPlain(uc(yaw, footR + 5)), 'approach'))
    const foot = G3(onPlain(uc(yaw, footR + 1.3)), 'climbFoot', { climb: true })
    const top = G3(uc(yaw, K.WALL_R - 0.2, K.WALL_TOP), 'wallTop', { climbTop: true })
    pts.push(foot, top)
    pts.climbPath = [foot.clone(), ...climbLeg(yaw)]
    pts.push(...walkLeg(yaw, B.stair))
    pts.push(...stairLeg(B.stair))
  } else {
    const g = flank ? nearestGate(sb) : si
    gate = GATES[g].id
    if (flank) pts.push(...arc(sb, GATES[g].bearing, 52, 12, 14).slice(1))
    pts.push(...gateLeg(g))
  }
  pts.spawnId = SPAWN_IDS[si]
  pts.climber = !!opts.climber
  pts.breach = breach
  pts.gate = gate
  if (!pts.climbPath) pts.climbPath = null
  pts.climbStart = pts.findIndex(p => p.climb)
  pts.climbEnd = pts.findIndex(p => p.climbTop)
  return pts
}

// ------------------------------------------------------------------ zones
const BASTIONS = bastions().map(b => ({ x: b.pos.x, z: -b.pos.z, yaw: b.yaw }))
/** inside a bastion's footprint (game x, z) */
export function inBastion(x, z) {
  for (const b of BASTIONS) {
    const a = b.yaw * Math.PI / 180
    const dx = x - b.x, dz = z - b.z
    // Unity rotation by yaw; in game space the local axes are (cos a, sin a) lateral and (sin a, -cos a) outward
    const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = dx * Math.sin(a) - dz * Math.cos(a)
    if (Math.abs(lx) <= K.BASTION / 2 + 0.05 && Math.abs(lz) <= K.BASTION / 2 + 0.05) return true
  }
  return false
}
export function zoneOf(p) {
  const r = Math.hypot(p.x, p.z)
  if (p.y > K.WALL_TOP - 0.7 && ((r >= K.WALL_R - K.WALL_HT - 0.3 && r <= K.WALL_R + K.WALL_HT + 0.3) || inBastion(p.x, p.z))) return 'walls'
  if (r < K.WALL_R - K.WALL_HT && p.y > K.H - 0.8) return 'yard'
  return 'outside'
}
export { ulat }
