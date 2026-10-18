// Hive Adapt (Project 0 port): progression and debrief rules, pure (node-testable).
// Player level curve (ProgressionData.cs), Hive Sample grants (RunProgression.GrantSamples), the Armory (ArmoryUpgrade.cs),
// rewards per kill, and the debrief's record and three lines (RunDebrief.cs, UI/Debrief.cs) with the web's "next step".
import { roundEven } from './u.js'
import { PROGRESSION as P, ARMORY, WEAPONS, FIELD_GUIDE, TYPE_COLOUR } from './rundata.js'
import { KINDS, QUEENS } from './enemydata.js'

const f = Math.fround

// ---------------------------------------------------------------- level curve (float32 Mathf.Pow, banker's rounding)
export const xpToAdvance = L => roundEven(f(P.xpFirstLevel * f(Math.pow(f(P.xpGrowth), Math.max(1, L) - 1))))
export function totalXpForLevel(L) { let t = 0; for (let l = 1; l < Math.min(L, P.maxLevel); l++) t += xpToAdvance(l); return t }
export function levelForXp(xp) {
  let level = 1, total = 0
  while (level < P.maxLevel) { total += xpToAdvance(level); if (xp < total) break; level++ }
  return level
}
export function levelProgress(xp) {
  const L = levelForXp(xp)
  if (L >= P.maxLevel) return 1
  const a = totalXpForLevel(L), b = a + xpToAdvance(L)
  return Math.min(1, Math.max(0, (xp - a) / Math.max(1, b - a)))
}
/** weapons that unlock in (before, after] */
export const unlocksBetween = (before, after) => WEAPONS.filter(w => w.unlock > before && w.unlock <= after)
export const unlockedWeapons = level => WEAPONS.filter(w => w.unlock <= level)
export function nextLockedWeapon(level) { let n = null; for (const w of WEAPONS) if (w.unlock > level && (!n || w.unlock < n.unlock)) n = w; return n }

/** Samples x (1 + SampleFind), at least the base amount (Unity rounds half to even: 2 x 1.25 = 2.5 -> 2) */
export const sampleGrant = (n, sampleFind = 0) => Math.max(n, roundEven(f(n * f(1 + sampleFind))))

// ---------------------------------------------------------------- rewards (EconomyManager / RunProgression)
/** Biomass for a kill: round(biomassReward x (elite ? eliteRewardScale : 1) x (1 + BiomassGain)) */
export function killBiomass(data, elite, biomassGain = 0) {
  if (!data) return 0
  return roundEven(f(f(data.biomassReward * (elite ? data.eliteRewardScale || 4 : 1)) * f(1 + biomassGain)))
}
/** XP for a kill: xpReward x (turret 0.6) x (elite 3); a Siege Node pays a flat 250 (handled by the caller) */
export function killXp(data, elite, byTurret) {
  if (!data) return 0
  let xp = f(data.xpReward)
  if (byTurret) xp = f(xp * f(P.turretKillShare))
  if (elite) xp = f(xp * P.eliteXpMultiplier)
  return roundEven(xp)
}
export const waveClearXp = w => P.waveClearXp + P.waveClearXpPerWave * w
export const milestoneFor = w => P.milestones.find(m => m.wave === w) || null

// ---------------------------------------------------------------- Armory
export const armoryCost = (u, rank) => (rank >= 0 && rank < u.costs.length ? u.costs[rank] : -1)
export const armoryValue = (u, rank) => u.per * Math.min(Math.max(rank, 0), u.costs.length)
export const armoryFormat = (u, v) => (u.pct ? roundEven(f(v * 100)) + '%' : String(roundEven(v)))
/** the description at a rank (rank 0 describes the first rank) */
export const armoryDescribe = (u, rank) => u.desc.replace('{0}', armoryFormat(u, armoryValue(u, Math.max(1, rank))))
/** the cheapest next rank at or below the player's level that the banked Samples buy (Debrief.Affordable) */
export function armoryAffordable(ranks, level, samples) {
  let best = null, cost = 0
  for (const u of ARMORY) {
    if (level < u.unlock) continue
    const c = armoryCost(u, ranks[u.id] || 0)
    if (c <= 0 || c > samples) continue
    if (!best || c < cost) { best = u; cost = c }
  }
  return best ? { u: best, cost } : null
}

// ---------------------------------------------------------------- names (Debrief.Plural / One)
export const kindData = kind => KINDS[kind] || null
export const displayName = kind => (KINDS[kind] ? KINDS[kind].displayName : kind || '')
export const isQueen = kind => !!(KINDS[kind] && KINDS[kind].isBoss)
export function plural(kind) {
  const d = KINDS[kind]
  if (!d) return ''
  if (d.isBoss) return 'the ' + d.displayName
  if (kind === 'Leech') return 'Leeches'
  if (kind === 'SiegeNode') return 'Siege Nodes'
  return d.displayName + 's'
}
export function one(kind) {
  const d = KINDS[kind]
  if (!d) return ''
  if (d.isBoss) return 'the ' + d.displayName
  return (/^[aeiou]/i.test(d.displayName) ? 'an ' : 'a ') + d.displayName
}
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)
export { cap }
export const queenTitle = kind => (QUEENS[kind] ? QUEENS[kind].title : displayName(kind))

// ---------------------------------------------------------------- debrief record (RunDebrief.cs)
export function newDebrief() { return { toCore: {}, toPlayer: {}, coreKiller: null, playerKiller: null, deaths: 0, ended: false } }
/** the enemy id of a hit: its kind, or the info's sourceId cut at the first '.' ("ArmoredMatriarch.Charge") */
export function hitId(enemy, info) {
  if (enemy && enemy.kind) return enemy.kind
  const s = info && info.sourceId
  return typeof s === 'string' && s ? s.split('.')[0] : null
}
export function topDamager(d) {
  const ids = new Set([...Object.keys(d.toCore), ...Object.keys(d.toPlayer)])
  let best = null, bestT = 0, bestCore = 0, all = 0
  for (const id of ids) all += (d.toCore[id] || 0) + (d.toPlayer[id] || 0)
  for (const id of [...ids].sort()) {
    const c = d.toCore[id] || 0, t = c + (d.toPlayer[id] || 0)
    if (t <= 0) continue
    if (!best || t > bestT + 0.001 || (Math.abs(t - bestT) <= 0.001 && c > bestCore)) { best = id; bestT = t; bestCore = c }
  }
  return { id: best, share: best && all > 0 ? bestT / all : 0 }
}
export const causeLine = (won, killer) => (won ? 'The Core held' : killer && KINDS[killer] ? 'The Core fell to ' + one(killer) : 'The Core fell')
export function playerLine(deaths, killer) {
  if (deaths <= 0) return 'You never went down'
  const s = 'You went down ' + (deaths === 1 ? 'once' : deaths + ' times')
  return killer && KINDS[killer] ? s + (deaths === 1 ? ', to ' : ', the last time to ') + one(killer) : s
}
export function topLine(top, share) {
  if (!top || !KINDS[top]) return 'Nothing got through to the Core or to you'
  return cap(plural(top)) + ' did the most damage: ' + roundEven(f(share * 100)) + '% of everything that hit the Core and you'
}

/**
 * The web debrief's one next step (Debrief.Plan adapted: nothing carries over between runs, so it is advice for the next
 * run inside this visit; the button always opens the Hive guide on the enemy it is about).
 * ctx: { top, hive:{ resist, resistOrder }, damage: Map(type -> dealt, whole run), turretShare, sourceDamage, carried:[{name,type}],
 *        unlocked:[{name,type}], level, towersBuilt }
 */
export function nextStep(ctx) {
  const top = ctx.top && KINDS[ctx.top] ? ctx.top : null
  const d = top ? KINDS[top] : null
  const pctS = v => roundEven(f(v * 100)) + '%'
  // 1. what beat you is weak to a damage type you did not bring
  if (d && d.weakTo && d.weakToScale > 1.001 && !(ctx.carried || []).some(w => w.type === d.weakTo)) {
    const unlocked = (ctx.unlocked || []).find(w => w.type === d.weakTo)
    const any = WEAPONS.find(w => w.type === d.weakTo)
    const bonus = '+' + roundEven(f((d.weakToScale - 1) * 100)) + '% damage'
    const locker = ctx.touch ? 'the gear locker' : 'the gear locker [B]'
    const how = unlocked ? 'you had the ' + unlocked.name + ' unlocked: swap it in at ' + locker + ' between waves.'
      : any ? 'the ' + any.name + ' unlocks at player level ' + any.unlock + ', then swap it in at ' + locker + '.' : 'aim for the glowing weak point.'
    return { focus: top, label: 'Hit ' + plural(top) + ' with ' + d.weakTo, reason: cap(plural(top)) + ' are weak to ' + d.weakTo + ' (' + bonus + '): ' + how }
  }
  // 2. the Hive resisted what you fired most
  const h = ctx.hive
  if (h && ctx.damage) {
    let worst = null, worstR = 0
    for (const k of h.resistOrder || []) { const v = h.resist[k] || 0; if (v > worstR + 0.001) { worst = k; worstR = v } }
    let total = 0
    for (const v of ctx.damage.values()) total += v
    const mine = worst && total > 0 ? (ctx.damage.get(worst) || 0) / total : 0
    if (worst && worstR >= 0.15 && mine >= 0.5) {
      const alt = worst === 'Energy' ? 'Ballistic Turrets and the AR-7' : 'Energy Towers and the PL-2 Plasma'
      return { focus: top, label: 'Mix your damage types', reason: 'The Hive resisted ' + worst.toLowerCase() + ' ' + pctS(worstR) + ' and ' + pctS(mine) + ' of your damage was ' + worst.toLowerCase() + ': bring ' + alt + '.' }
    }
  }
  // 3. the turrets did too little of the work
  if ((ctx.sourceDamage || 0) >= 400 && (ctx.turretShare || 0) < 0.35) {
    const energy = h && (h.resist.Ballistic || 0) > (h.resist.Energy || 0) + 0.001
    return { focus: top, label: energy ? 'Build Energy Towers at the gates' : 'Build more turrets at the gates', reason: 'Turrets did only ' + pctS(ctx.turretShare || 0) + ' of the damage. Towers on the gate pads hold the lanes while you hunt and repair.' }
  }
  // 4. read up on what beat you
  return {
    focus: top,
    label: top ? 'Open the ' + d.displayName + ' in the Hive guide' : 'Open the Hive guide',
    reason: top ? 'How ' + plural(top) + ' fight, what they are weak to and how to beat them.' : 'Every enemy you have met and how to beat it.',
  }
}

export const fieldGuideText = kind => FIELD_GUIDE[kind] || ''
export { TYPE_COLOUR }
