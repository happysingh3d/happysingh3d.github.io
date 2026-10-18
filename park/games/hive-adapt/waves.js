// Hive Adapt (Project 0 port): the endless wave generator (Scripts/Waves/WaveGenerator.cs), pure so it can be tested in node.
// run-hive-economy.md §2: counts with banker's rounding (Mathf.RoundToInt), float32 maths as Unity, role trimming, spawn groups.
import { roundEven } from './u.js'

const f = Math.fround

/** Run_Endless.asset endlessSettings */
export const ENDLESS = {
  baseCount: 12, countPerWave: 6.5, maxCount: 160, breatherWaves: 1.5, healthGrowth: 1.1, damagePerWave: 0.035,
  flyersFromWave: 4, flyerShareStart: 0.18, flyerSharePerWave: 0.02, flyerShareMax: 0.3, maxFlyers: 14,
  roleSharePerWave: 0.004, roleShareMax: 0.16,
  roles: { Rammer: { from: 3, share: 0.05, cap: 4 }, Spitter: { from: 4, share: 0.08, cap: 8 }, Leech: { from: 5, share: 0.1, cap: 10 }, Burrower: { from: 6, share: 0.06, cap: 6 } },
  elitesFromWave: 3, eliteChanceStart: 0.03, eliteChancePerWave: 0.006, eliteChanceMax: 0.12,
  bossEvery: 5, bossHealthPerAppearance: 0.6, bossDamagePerAppearance: 0.2,
  spawnDirections: 4, threeDirectionsUntilWave: 2, buildSeconds: 30, bossBuildSeconds: 35, spawnWindow: 22, minInterval: 0.3,
  maxAlive: 45,
}
const S = ENDLESS
export const ROLE_KINDS = ['Rammer', 'Spitter', 'Leech', 'Burrower']
export const SPAWN_IDS = ['A', 'B', 'C', 'D']
export const defaultWeights = () => ({ Rammer: 1, Spitter: 1, Leech: 1, Burrower: 1 })

export const isBoss = w => S.bossEvery > 0 && w > 0 && w % S.bossEvery === 0
export const bossAppearance = w => (isBoss(w) ? Math.floor(w / S.bossEvery) : 0)
export const isBreather = w => w > 1 && isBoss(w - 1)

export function totalCount(w) {
  w = Math.max(1, w)
  let n = f(S.baseCount + f(S.countPerWave * (w - 1)))
  if (isBreather(w)) n = f(n - f(S.countPerWave * S.breatherWaves))
  return Math.min(S.maxCount, roundEven(n))
}
export function flyerShare(w) {
  if (w < S.flyersFromWave) return 0
  return Math.min(f(S.flyerShareMax), f(f(S.flyerShareStart) + f(f(S.flyerSharePerWave) * (w - S.flyersFromWave))))
}
export const flyerCount = w => Math.min(S.maxFlyers, roundEven(f(totalCount(w) * flyerShare(w))))
export const groundCount = w => totalCount(w) - flyerCount(w)

/** how many of a role wave w brings (0 before it appears or with weight <= 0, at least 1 after) */
export function roleCount(w, role, weights) {
  const r = S.roles[role]
  const weight = f(weights && weights[role] != null ? weights[role] : 1)
  w = Math.max(1, w)
  if (!r || w < r.from || weight <= 0) return 0
  const ground = groundCount(w)
  const sh = f(Math.min(f(S.roleShareMax), f(f(r.share) + f(f(S.roleSharePerWave) * (w - r.from)))) * weight)
  const cap = Math.max(1, roundEven(f(r.cap * Math.max(1, weight))))
  return Math.min(Math.max(roundEven(f(ground * sh)), 1), cap)
}
export function roleTotal(w, weights) {
  let n = 0
  for (const k of ROLE_KINDS) n += roleCount(w, k, weights)
  return Math.min(n, Math.floor(groundCount(w) / 2))
}
export const crawlerCount = (w, weights) => Math.max(0, groundCount(w) - roleTotal(w, weights))
export function eliteChance(w) {
  if (w < S.elitesFromWave) return 0
  return Math.min(f(S.eliteChanceMax), f(f(S.eliteChanceStart) + f(f(S.eliteChancePerWave) * (w - S.elitesFromWave))))
}
export const healthScale = w => f(Math.pow(f(S.healthGrowth), Math.max(0, w - 1)))
export const damageScale = w => f(1 + f(f(S.damagePerWave) * Math.max(0, w - 1)))
export function bossHealthScale(w) { const k = bossAppearance(w); return k <= 0 ? 0 : f(1 + f(f(S.bossHealthPerAppearance) * (k - 1))) }
export function bossDamageScale(w) { const k = bossAppearance(w); return k <= 0 ? 0 : f(1 + f(f(S.bossDamagePerAppearance) * (k - 1))) }
export const directions = w => (w <= S.threeDirectionsUntilWave ? Math.min(3, S.spawnDirections) : S.spawnDirections)
function interval(count) { return count <= 1 ? 1 : Math.min(1.2, Math.max(S.minInterval, f(S.spawnWindow / count))) }

/**
 * Wave w (1-based) as { wave, title, build, boss, groups:[{ kind, count, point, interval, delay, healthScale, damageScale,
 * eliteChance, boss }], total, counts:{ Crawler, Flyer, Rammer, Spitter, Leech, Burrower } }.
 * opts: { weights (evolution role weights), bossKind ('BroodMother'), bossTitle }
 */
export function generateWave(w, opts = {}) {
  w = Math.max(1, w)
  const weights = opts.weights || defaultWeights()
  const boss = isBoss(w)
  const out = {
    wave: w, boss, title: boss ? opts.bossTitle || 'The Brood Mother' : 'Wave ' + w, build: boss ? S.bossBuildSeconds : S.buildSeconds,
    groups: [], total: 0, counts: { Crawler: 0, Flyer: 0, Rammer: 0, Spitter: 0, Leech: 0, Burrower: 0 },
  }
  const hp = healthScale(w), dmg = damageScale(w), elite = eliteChance(w)
  const add = (kind, count, point, iv, delay, h = hp, d = dmg, isQueen = false) => {
    if (count <= 0) return
    out.groups.push({ kind, count, point, interval: iv, delay, healthScale: h, damageScale: d, eliteChance: isQueen ? 0 : elite, boss: isQueen })
    out.total += count
    if (out.counts[kind] != null) out.counts[kind] += count
  }
  const crawlers = crawlerCount(w, weights), flyers = flyerCount(w)
  // crawlers: the bulk over three or four far-edge directions (both lanes first), then a late surge from the flanks
  const dirs = directions(w)
  const all = Math.max(2, S.spawnDirections)
  const flank = all > 2 ? 2 + (w % (all - 2)) : w % 2
  const pointFor = k => (k < 2 || dirs > 3 ? k : flank)
  const surge = crawlers >= 16 ? Math.floor(crawlers / 4) : 0
  const main = crawlers - surge
  const mainInterval = interval(Math.ceil(f(main / dirs)))
  for (let k = 0; k < dirs; k++) add('Crawler', Math.floor(main / dirs) + (k < main % dirs ? 1 : 0), pointFor(k), mainInterval, boss ? 0.5 * k : 2 * k)
  if (surge > 0) {
    const surgeA = Math.floor((surge + 1) / 2)
    const pa = dirs > 3 ? 2 + (w % 2) : w % 2, pb = dirs > 3 ? 3 - (w % 2) : 1 - (w % 2)
    const si = Math.max(S.minInterval, f(mainInterval * 0.7))
    add('Crawler', surgeA, pa, si, 14)
    add('Crawler', surge - surgeA, pb, si, 18)
  }
  // flyers: two flights from different directions
  if (flyers > 0) {
    const flyA = Math.floor((flyers + 1) / 2)
    const fi = Math.min(1.5, Math.max(0.9, f(10 / Math.max(1, flyA))))
    const fa = w % dirs, fb = (w + Math.floor(dirs / 2)) % dirs
    add('Flyer', flyA, pointFor(fa), fi, 5)
    add('Flyer', flyers - flyA, pointFor(fb), fi, 9)
  }
  // roles, trimmed Burrowers -> Leeches -> Spitters -> Rammers under half the ground count
  let room = roleTotal(w, weights)
  const trim = n => { const t = Math.min(n, Math.max(0, room)); room -= t; return t }
  const burrowers = trim(roleCount(w, 'Burrower', weights)), leeches = trim(roleCount(w, 'Leech', weights))
  const spitters = trim(roleCount(w, 'Spitter', weights)), rammers = trim(roleCount(w, 'Rammer', weights))
  const lane = w % 2, otherLane = 1 - lane
  const flankA = dirs > 3 ? 2 + (w % 2) : flank, flankB = dirs > 3 ? 3 - (w % 2) : flank
  const half = n => Math.floor((n + 1) / 2)
  if (rammers > 0) { const a = half(rammers); add('Rammer', a, lane, 4, 4); add('Rammer', rammers - a, otherLane, 4, 9) }
  if (spitters > 0) { const a = half(spitters); add('Spitter', a, otherLane, 2.5, 6); add('Spitter', spitters - a, flankA, 2.5, 11) }
  if (leeches > 0) { const a = half(leeches); add('Leech', a, lane, 1.2, 8); add('Leech', leeches - a, flankB, 1.2, 12) }
  if (burrowers > 0) { const a = half(burrowers); add('Burrower', a, flankA, 3, 3); add('Burrower', burrowers - a, flankB, 3, 13) }
  if (boss) add(opts.bossKind || 'BroodMother', 1, 1, 1, 6, bossHealthScale(w), bossDamageScale(w), true)
  return out
}

/** the wave-clear Biomass bonus (RunConfig.WaveClearBonus x Mult(BiomassGain)) */
export function waveClearBonus(w, biomassGain = 0) {
  if (w <= 0) return 0
  return Math.max(0, roundEven(f(f(50 + 10 * (w - 1)) * f(1 + biomassGain))))
}

/**
 * Runtime of one wave's spawn groups (WaveManager.RunGroup coroutines): tick(dt, aliveCount, spawnFn) spawns what is due.
 * Each group waits `delay`, then spawns `count` bugs `max(0.02, interval)` apart, holding while aliveCount >= maxAlive.
 */
export function createSpawner(wave) {
  const groups = wave.groups.map(g => ({ g, next: g.delay, done: 0 }))
  let t = 0, remaining = wave.total
  return {
    get time() { return t },
    get remaining() { return remaining },
    get spawning() { return remaining > 0 },
    tick(dt, alive, spawn) {
      t += dt
      let n = alive()
      for (const s of groups) {
        let guard = 0
        while (s.done < s.g.count && t >= s.next && guard++ < 8) {
          if (n >= S.maxAlive) break
          spawn(s.g)
          s.done++
          remaining--
          n++
          s.next = Math.max(s.next, t - 0.05) + Math.max(0.02, s.g.interval)
        }
      }
    },
    /** stop spawning (run end) */
    stop() { for (const s of groups) s.done = s.g.count; remaining = 0 },
  }
}
