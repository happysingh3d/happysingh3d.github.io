// Hive Adapt (Project 0 port): Hive Evolution (Scripts/Hive/HiveEvolution.cs, EvolutionRules.cs, HiveAdvice.cs), pure (node-testable).
// What the Hive measures (damage by type and source, zone time, gate kills, barricades, deaths), how it chooses 2 evolutions
// before every 5th wave, how a pick changes the shared Hive table, and the report / advice / tag text (run-hive-economy.md §3).
import { roundEven } from './u.js'
import { DAMAGE_TYPES } from './rundata.js'

const f = Math.fround
export const MAX_RESIST = 0.6

/** EvolutionCatalog.asset settings */
export const CATALOG = { everyWaves: 5, picksPerGeneration: 2, minDamage: 400, minSeconds: 30, minGateKills: 10, minKillsNoDeaths: 25 }
export const isEvolutionWave = w => w >= CATALOG.everyWaves && w % CATALOG.everyWaves === 0

const ONE = { Rammer: 1, Spitter: 1, Leech: 1, Burrower: 1 }
const ev = o => ({ minWave: 5, maxStacks: 2, fallback: false, fallbackReason: '', subject: '', resist: {}, weights: ONE, siege: 1, health: 1, speed: 1, size: 1, elite: 0, tint: [1, 1, 1], plates: 0, plateColor: [0.42, 0.4, 0.37], glow: [0, 0, 0], glowMix: 0, ...o })
/** The 10 evolutions in catalog order (Data/Evolutions/EV_*.asset) */
export const EVOLUTIONS = [
  ev({ id: 'conductive_carapace', name: 'Conductive Carapace', short: 'CONDUCTIVE', trigger: 'type', types: ['Energy'], threshold: 0.35, reason: 'You relied on {1} ({0}%)', subject: 'PLASMA', effect: 'Energy resistance +25%', desc: 'Its shell grounds plasma into the swarm around it. Mix in ballistic or explosive damage.', resist: { Energy: 0.25 }, colour: [0.45, 0.62, 1], tint: [0.82, 0.88, 1.12], plates: 0.08, plateColor: [0.26, 0.33, 0.46], glow: [0.7, 1.9, 5.5], glowMix: 0.65 }),
  ev({ id: 'hardened_plating', name: 'Hardened Plating', short: 'PLATED', trigger: 'type', types: ['Ballistic', 'Rail'], threshold: 0.45, reason: 'You relied on {1} ({0}%)', subject: 'BULLETS', effect: 'Ballistic and rail resistance +20%', desc: 'Overlapping plates turn bullets aside. Energy and explosives get under them.', resist: { Ballistic: 0.2, Rail: 0.2 }, colour: [0.78, 0.8, 0.86], tint: [0.88, 0.88, 0.93], plates: 0.42, plateColor: [0.46, 0.48, 0.52] }),
  ev({ id: 'blast_damped_shell', name: 'Blast-Damped Shell', short: 'BLAST-DAMPED', trigger: 'type', types: ['Explosive'], threshold: 0.22, reason: 'You relied on {1} ({0}%)', subject: 'EXPLOSIVES', effect: 'Explosive resistance +25%', desc: 'Spongy layers under the shell soak up blasts. Precise fire still gets through.', resist: { Explosive: 0.25 }, colour: [1, 0.55, 0.25], tint: [0.72, 0.7, 0.68], plates: 0.3, plateColor: [0.5, 0.41, 0.29], size: 1.04 }),
  ev({ id: 'parasite_bloom', name: 'Parasite Bloom', short: 'PARASITES', trigger: 'turret', threshold: 0.5, reason: 'Your turrets did {0}% of the killing', effect: 'More Leeches and Spitters hunt your turrets', desc: 'The Hive breeds turret-killers: Leeches jam them, Spitters shell them from range. Guard your guns.', weights: { Rammer: 1, Spitter: 1.5, Leech: 2, Burrower: 1 }, colour: [0.72, 1, 0.24], tint: [0.95, 1.02, 0.86], glow: [2.4, 4.2, 0.5], glowMix: 0.55 }),
  ev({ id: 'swift_swarm', name: 'Swift Swarm', short: 'SWIFT', trigger: 'player', threshold: 0.65, reason: 'You carried the fight yourself ({0}% of the damage)', effect: 'The swarm moves 15% faster', desc: 'Leaner legs, longer strides: it closes the distance before you can pick it apart.', speed: 1.15, size: 0.96, colour: [1, 0.42, 0.3], tint: [1.12, 0.86, 0.8], glow: [6, 0.9, 0.5], glowMix: 0.35 }),
  ev({ id: 'siege_organs', name: 'Siege Organs', short: 'SIEGE ORGANS', trigger: 'walls', threshold: 0.45, reason: 'You held the walls ({0}% of the time)', effect: 'Siege Nodes grow far more often', desc: 'The Hive grows artillery on the plain to shell you off the walls. Go out and kill it.', weights: { Rammer: 1, Spitter: 1.3, Leech: 1, Burrower: 1 }, siege: 2.5, colour: [1, 0.38, 0.26], glow: [7, 1.4, 0.25], glowMix: 0.3 }),
  ev({ id: 'tunnel_brood', name: 'Tunnel Brood', short: 'TUNNELLERS', trigger: 'gate', threshold: 0.62, reason: 'You camped {1} ({0}% of gate kills)', effect: 'Burrowers will tunnel past your walls', desc: 'It stops knocking at the gate you hold and digs under the walls instead. Watch the yard.', weights: { Rammer: 1, Spitter: 1, Leech: 1, Burrower: 2.2 }, colour: [0.86, 0.7, 0.45], tint: [1, 0.88, 0.72], plates: 0.12, plateColor: [0.46, 0.27, 0.15] }),
  ev({ id: 'battering_brood', name: 'Battering Brood', short: 'BATTERING RAMS', trigger: 'barricades', threshold: 2, reason: 'You built {0} barricades', effect: 'More Rammers to break your barricades', desc: 'Armoured chargers come for the barricades you hide behind. Shoot their backs; grenades crack the plates.', weights: { Rammer: 2, Spitter: 1, Leech: 1, Burrower: 1 }, health: 1.05, colour: [0.9, 0.62, 0.4], tint: [0.9, 0.84, 0.82], plates: 0.22, plateColor: [0.56, 0.5, 0.4] }),
  ev({ id: 'thickened_hide', name: 'Thickened Hide', short: 'THICK HIDE', trigger: 'always', threshold: 0, reason: '', maxStacks: 3, fallback: true, fallbackReason: 'It fed on its dead and grew heavier', effect: '+18% health, bigger bodies', desc: 'It feeds on its own dead and grows heavier with every generation.', health: 1.18, size: 1.06, colour: [0.85, 0.5, 0.4], tint: [0.86, 0.8, 0.78], plates: 0.12, plateColor: [0.52, 0.46, 0.38] }),
  ev({ id: 'pack_mind', name: 'Pack Mind', short: 'PACK MIND', trigger: 'nodeaths', threshold: 1, reason: 'You never fell since it last changed', fallback: true, fallbackReason: 'It learned to follow its strongest', effect: 'More elites lead the swarm (+6% elite chance)', desc: 'The swarm learns to follow its strongest. Kill the glowing ones first.', elite: 0.06, colour: [1, 0.8, 0.35], glow: [5, 2.6, 0.6], glowMix: 0.25 }),
]
export const EVOLUTION_BY_ID = Object.fromEntries(EVOLUTIONS.map(e => [e.id, e]))
const isShare = t => t !== 'barricades' && t !== 'nodeaths' && t !== 'always'

// ---------------------------------------------------------------- EvolutionStats
export function newStats() {
  return { dmg: new Map(), player: 0, turret: 0, wall: 0, ground: 0, outside: 0, gate: [0, 0], barricades: 0, deaths: 0, playerKills: 0, kills: 0 }
}
export function clearStats(s) {
  s.dmg.clear(); s.player = s.turret = 0; s.wall = s.ground = s.outside = 0; s.gate[0] = s.gate[1] = 0
  s.barricades = s.deaths = s.playerKills = s.kills = 0
  return s
}
export function copyStats(s) { const c = newStats(); for (const [k, v] of s.dmg) c.dmg.set(k, v); Object.assign(c, { player: s.player, turret: s.turret, wall: s.wall, ground: s.ground, outside: s.outside, gate: [s.gate[0], s.gate[1]], barricades: s.barricades, deaths: s.deaths, playerKills: s.playerKills, kills: s.kills }); return c }
export function addDamage(s, type, amount, turret) {
  if (!type || !(amount > 0)) return
  s.dmg.set(type, f((s.dmg.get(type) || 0) + amount))
  if (turret) s.turret = f(s.turret + amount); else s.player = f(s.player + amount)
}
export const totalDamage = s => { let t = 0; for (const v of s.dmg.values()) t = f(t + v); return t }
export const sourceDamage = s => f(s.player + s.turret)
export const aliveSeconds = s => f(f(s.wall + s.ground) + s.outside)
const share = (a, b) => (b > 0 ? f(a / b) : 0)
export const typeShare = (s, types) => { const t = totalDamage(s); if (t <= 0) return 0; let p = 0; for (const k of types) p = f(p + (s.dmg.get(k) || 0)); return f(p / t) }
export const turretShare = s => share(s.turret, sourceDamage(s))
export const playerShare = s => share(s.player, sourceDamage(s))
export const wallShare = s => share(s.wall, aliveSeconds(s))
export const groundShare = s => share(s.ground, aliveSeconds(s))
export const outsideShare = s => share(s.outside, aliveSeconds(s))
export function topGate(s) { const g = s.gate[1] > s.gate[0] ? 1 : 0, t = s.gate[0] + s.gate[1]; return { g, share: t > 0 ? f(s.gate[g] / t) : 0, name: g ? 'Gate B' : 'Gate A' } }

/**
 * HiveEvolution.Zone: 0 yard, 1 walls, 2 outside (r = planar distance from the Core at the origin; game y = Unity y)
 */
export function zoneOf(p) {
  const r = Math.hypot(p.x, p.z)
  if (r > 23) return 2
  if (p.y >= 8.6 && r >= 12.5 && r <= 21.5) return 1
  return p.y < 8.6 - 4.5 ? 2 : 0
}

// ---------------------------------------------------------------- EvolutionRules
/** the habit e measures (0 when there is too little data) and its subject */
export function metric(e, s) {
  switch (e.trigger) {
    case 'type': return { m: totalDamage(s) >= CATALOG.minDamage ? typeShare(s, e.types) : 0, subject: e.subject }
    case 'turret': return { m: sourceDamage(s) >= CATALOG.minDamage ? turretShare(s) : 0, subject: e.subject }
    case 'player': return { m: sourceDamage(s) >= CATALOG.minDamage ? playerShare(s) : 0, subject: e.subject }
    case 'walls': return { m: aliveSeconds(s) >= CATALOG.minSeconds ? wallShare(s) : 0, subject: e.subject }
    case 'gate': {
      if (s.gate[0] + s.gate[1] < CATALOG.minGateKills) return { m: 0, subject: e.subject }
      const t = topGate(s)
      return { m: t.share, subject: t.name }
    }
    case 'barricades': return { m: s.barricades, subject: e.subject }
    case 'nodeaths': return { m: s.deaths === 0 && s.playerKills >= CATALOG.minKillsNoDeaths ? 1 : 0, subject: e.subject }
    default: return { m: 0, subject: e.subject }
  }
}
export function reasonText(e, m, subject) {
  const value = isShare(e.trigger) ? String(roundEven(f(m * 100))) : String(roundEven(m))
  return (e.reason || '').replace('{0}', value).replace('{1}', subject || '')
}
/** EvolutionRules.Available: wave, stacks, and it must still change something */
export function available(e, wave, stacks, resist) {
  if (!e || wave < e.minWave || (stacks[e.id] || 0) >= e.maxStacks) return false
  const keys = Object.keys(e.resist)
  if (keys.length && resist) {
    let any = false
    for (const k of keys) if (e.resist[k] > 0 && (resist[k] || 0) < MAX_RESIST - 0.005) any = true
    if (!any) return false
  }
  return true
}
/** EvolutionRules.Choose: up to 2 picks [{ e, metric, score, subject, reason, fallback, stack }] */
export function choose(s, wave, stacks, resist, picks = CATALOG.picksPerGeneration) {
  const out = []
  const qualified = []
  EVOLUTIONS.forEach((e, i) => {
    if (e.trigger === 'always' || e.threshold <= 0 || !available(e, wave, stacks, resist)) return
    const { m, subject } = metric(e, s)
    if (m < f(e.threshold)) return
    qualified.push({ e, metric: m, score: f(m / f(e.threshold)), subject, order: i })
  })
  qualified.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.order - b.order))
  for (const p of qualified) {
    if (out.length >= picks) break
    out.push({ e: p.e, metric: p.metric, score: p.score, subject: p.subject, reason: reasonText(p.e, p.metric, p.subject), fallback: false, stack: (stacks[p.e.id] || 0) + 1 })
  }
  if (out.length < picks) {
    const fb = []
    EVOLUTIONS.forEach((e, i) => { if (e.fallback && available(e, wave, stacks, resist) && !out.some(p => p.e === e)) fb.push({ e, stack: stacks[e.id] || 0, order: i }) })
    fb.sort((a, b) => (a.stack !== b.stack ? a.stack - b.stack : a.order - b.order))
    for (const p of fb) {
      if (out.length >= picks) break
      out.push({ e: p.e, metric: 0, score: 0, subject: p.e.subject, reason: p.e.fallbackReason || reasonText(p.e, 0, p.e.subject), fallback: true, stack: p.stack + 1 })
    }
  }
  return out
}

// ---------------------------------------------------------------- the Hive (shared live with enemies.js as G.run.hive)
export function newHive() {
  return {
    resist: { Ballistic: 0, Energy: 0, Explosive: 0, Rail: 0 }, resistOrder: [], generation: 0,
    healthScale: 1, speedScale: 1, sizeScale: 1, eliteChanceAdd: 0, roleWeights: { Rammer: 1, Spitter: 1, Leech: 1, Burrower: 1 }, siegeChanceScale: 1,
    picks: [], stacks: {}, history: [],
    swarm: { tint: [1, 1, 1], plates: 0, plateColor: [0.42, 0.4, 0.37], glow: [0, 0, 0], glowMix: 0 },
  }
}
export function setResist(h, type, v) {
  if (!type) return
  if (!h.resistOrder.includes(type)) h.resistOrder.push(type)
  h.resist[type] = Math.min(MAX_RESIST, Math.max(0, f(v)))
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
/** HiveEvolution.Apply + EvolutionState.Apply for one pick */
export function applyEvolution(h, e) {
  for (const k of Object.keys(e.resist)) setResist(h, k, f((h.resist[k] || 0) + e.resist[k]))
  for (const k of Object.keys(h.roleWeights)) h.roleWeights[k] = f(h.roleWeights[k] * (e.weights[k] ?? 1))
  h.siegeChanceScale = f(h.siegeChanceScale * e.siege)
  h.healthScale = f(h.healthScale * Math.max(0.1, e.health))
  h.speedScale = Math.min(1.45, f(h.speedScale * Math.max(0.1, e.speed)))
  h.sizeScale = clamp(f(h.sizeScale * Math.max(0.1, e.size)), 0.85, 1.3)
  h.eliteChanceAdd = f(h.eliteChanceAdd + e.elite)
  const s = h.swarm
  s.tint = s.tint.map((v, i) => clamp(v * e.tint[i], 0.45, 1.4))
  if (e.plates > 0) s.plateColor = s.plates <= 0 ? e.plateColor.slice() : lerp3(s.plateColor, e.plateColor, e.plates / (s.plates + e.plates))
  s.plates = clamp(s.plates + e.plates, 0, 1)
  if (e.glowMix > 0) {
    s.glow = s.glowMix <= 0 ? e.glow.slice() : lerp3(s.glow, e.glow, 0.6)
    s.glowMix = clamp(Math.max(s.glowMix, e.glowMix) + (s.glowMix > 0 ? 0.1 : 0), 0, 1)
  }
}
/**
 * HiveEvolution.Evolve(wave): win must already carry barricades / deaths. Raises the generation (even with no picks),
 * applies the picks, records them and returns the report { generation, wave, picks:[record], seen (copy of the win) }.
 */
export function evolve(h, win, wave) {
  const picks = choose(win, wave, h.stacks, h.resist)
  const report = { wave, generation: 0, picks: [], seen: copyStats(win) }
  h.generation++
  report.generation = h.generation
  for (const p of picks) {
    applyEvolution(h, p.e)
    h.stacks[p.e.id] = (h.stacks[p.e.id] || 0) + 1
    const rec = { id: p.e.id, name: p.e.name, generation: h.generation, wave, stack: h.stacks[p.e.id], stacks: h.stacks[p.e.id], reason: p.reason, metric: p.metric, fallback: p.fallback, score: p.score }
    h.picks.push(rec)
    h.history.push(rec)
    report.picks.push(rec)
  }
  clearStats(win)
  return report
}

// ---------------------------------------------------------------- text
const pct = v => roundEven(f(v * 100)) + '%'
export { pct }
/** "resists ballistic 15%, energy 25%" part (HudController.ResistText), in the order the Hive first resisted each type */
export function resistText(h) {
  const parts = []
  for (const k of h.resistOrder) if ((h.resist[k] || 0) > 0.001) parts.push(k.toLowerCase() + ' ' + pct(h.resist[k]))
  return parts.join(', ')
}
export function hiveTag(h) { const r = resistText(h); return 'Hive generation ' + h.generation + (r ? '  ·  resists ' + r : '') }

/**
 * The report's "what the Hive saw" line as HUD segments: "Ballistic 30%  ·  Energy 64%      Turrets 41%  ·  You 59%      Walls 22% ..."
 */
export function seenSegments(s) {
  const out = []
  const dot = ['  ·  ', 'dim']
  const gap = ['      ', 'dim']
  const t = totalDamage(s)
  if (t > 0) {
    let n = 0
    for (const [k, v] of s.dmg) { if (!(v > 0)) continue; if (n++) out.push(dot); out.push([k + ' ' + pct(typeShare(s, [k]))]) }
    out.push(gap, ['Turrets ' + pct(turretShare(s))], dot, ['You ' + pct(playerShare(s))])
  } else out.push(['No damage dealt'])
  if (aliveSeconds(s) > 1) out.push(gap, ['Walls ' + pct(wallShare(s))], dot, ['Yard ' + pct(groundShare(s))], dot, ['Outside ' + pct(outsideShare(s))])
  if (s.gate[0] + s.gate[1] > 0) { const g = topGate(s); out.push(gap, [g.name + ' ' + pct(g.share)], [' of gate kills', 'dim']) }
  return out
}
export const segText = sg => sg.map(x => x[0]).join('')

/**
 * HiveAdvice.WhatYouCanDoNow(hive, unlocked, carried): weapons are [{ name, type }], never a locked one.
 * "Energy resistance up to 35%. Ballistic is your best option right now (10%): your AR-7."
 */
export function advice(h, unlocked, carried, swapHint = 'swap at the gear locker [B] between waves') {
  if (!h || !unlocked) return ''
  let worst = null, worstR = 0, best = null, bestR = Infinity
  for (const k of h.resistOrder) { const v = h.resist[k] || 0; if (v > worstR + 0.001) { worst = k; worstR = v } }
  for (const w of unlocked) { if (!w || !w.type) continue; const r = h.resist[w.type] || 0; if (r < bestR - 0.001) { best = w.type; bestR = r } }
  if (!best) return ''
  if (!worst || worstR < 0.005) return 'The Hive resists nothing yet: every weapon you have hits at full strength.'
  let s = worst + ' resistance up to ' + pct(worstR) + '. '
  if (bestR >= worstR - 0.001) {
    const oneType = unlocked.every(w => !w || !w.type || w.type === worst)
    if (oneType) return s + 'Every weapon you have unlocked is ' + worst + ": lean on your turrets and the Core's boost until you unlock another type."
    return s + 'The Hive resists all your unlocked damage types equally (' + pct(bestR) + "): switching damage type gives no resistance advantage right now. Lean on your turrets and the Core's boost."
  }
  s += best + ' is your best option right now (' + pct(bestR) + ')'
  const names = list => (list || []).filter(w => w && w.type === best).map(w => w.name).join(' or ')
  const mine = names(carried)
  if (mine) return s + ': your ' + mine + '.'
  return s + ': ' + names(unlocked) + ', ' + swapHint + '.'
}

/** "Thickened Hide  II" etc. */
export const roman = n => ['', '', 'II', 'III', 'IV', 'V'][n] || ''
export { DAMAGE_TYPES }
