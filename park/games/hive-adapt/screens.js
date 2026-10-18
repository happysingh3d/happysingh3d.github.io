// Hive Adapt (Project 0 port): the RUN module's screen models for hud.js (pure builders; run.js owns the state and actions).
// Title (web), pause (PauseMenu.cs), Hive guide (HiveGuide.cs), gear locker + rack + in-run Armory (GearShop.cs / ArmoryPanel),
// evolution report (EvolutionScreen.cs), end screen + debrief (EndScreen.cs / Debrief.cs). Strings: outpost-turrets-ui.md §11-12.
import { GEAR, ARMORY, WEAPONS, WEAPON_BY_ID, ROSTER, GOES_FOR, FIELD_GUIDE, GUIDE_TEXT, DAMAGE_TYPES, CONTROLS, UI } from './rundata.js'
import { EVOLUTION_BY_ID, advice, seenSegments, pct, roman } from './hive.js'
import { KINDS, QUEENS } from './enemydata.js'
import { displayName, armoryCost, armoryDescribe, nextLockedWeapon, unlockedWeapons, levelProgress } from './progress.js'

const DOT = ['  ·  ', 'dim']
const fmtInt = n => Math.round(n).toLocaleString('en-US')
export const weaponName = id => (WEAPON_BY_ID[id] ? WEAPON_BY_ID[id].name : id || 'Empty')
export const weaponList = ids => ids.map(id => WEAPON_BY_ID[id]).filter(Boolean)

// ---------------------------------------------------------------- title
export function titleModel(G, visitBest, onStart, onTutorial) {
  return {
    best: visitBest, bestLabel: 'Best this visit', table: safeTable(G), onStart, onTutorial,
    tableNote: G.prizeNote ? G.prizeNote() : '', prizePlaces: G.prizePlaces ? G.prizePlaces() : 0,
    fighter: G.fighters ? G.fighters.card() : undefined, onFighter: d => G.fighters && G.fighters.cycle(d),
    onFighterPick: i => G.fighters && G.fighters.pick(i), onFighterPlus: () => G.fighters && G.fighters.togglePlus(),
    controls: G.touch ? undefined : CONTROLS,
    footer: 'Runs are not saved between visits  ·  play as many as you like',
  }
}
export function safeTable(G) { try { const t = G.table ? G.table() : []; return Array.isArray(t) ? t : [] } catch (e) { return [] } }

// ---------------------------------------------------------------- pause
export function pauseModel(G, run, A) {
  const h = run.hive
  const seen = []
  for (const rec of h.history) { const i = seen.findIndex(x => x.id === rec.id); if (i >= 0) seen[i] = rec; else seen.push(rec) }
  const lines = seen.map(rec => { const e = EVOLUTION_BY_ID[rec.id]; return { name: e.name, stacks: h.stacks[rec.id] || 1, effect: e.effect, colour: e.colour, reason: rec.reason, wave: rec.wave } })
  return {
    status: 'Wave ' + run.wave + '  ·  best ' + run.best + '  ·  ' + (run.phase === 'build' ? 'build phase' : 'wave in progress'),
    onResume: A.resume, onGuide: A.guide, onRestart: A.restart, onTutorial: A.tutorial, onQuit: A.quit,
    evolutions: lines.length ? { title: 'Hive evolutions  ·  generation ' + h.generation, lines } : { title: 'The Hive has not evolved yet' },
    controls: G.touch ? undefined : CONTROLS,
  }
}

// ---------------------------------------------------------------- Hive guide
const roleLabel = k => (KINDS[k] && KINDS[k].isBoss ? 'QUEEN' : k === 'SiegeNode' ? 'SIEGE NODE' : String(k).toUpperCase())
const roleColour = k => (KINDS[k] && KINDS[k].isBoss ? UI.danger : k === 'SiegeNode' ? UI.siegeGuide : UI.amber)
const goesFor = k => (KINDS[k] && KINDS[k].isBoss ? 'the Core, with her brood' : GOES_FOR[k] || 'the Core')
/** HiveGuide.Describe as one flowing line of segments */
export function describe(k, h) {
  const d = KINDS[k]
  if (!d) return []
  const out = [['Goes for  ', 'dim'], [goesFor(k)], ['     ', 'dim'], ['Weak to  ', 'dim']]
  if (d.weakTo && d.weakToScale > 1.001) {
    out.push([d.weakTo, 'amber'], ['  (+' + Math.round((d.weakToScale - 1) * 100) + '% damage)'])
    const r = h && h.resist ? h.resist[d.weakTo] || 0 : 0
    if (r > 0.005) out.push(['  ·  the Hive resists ' + d.weakTo + ' ' + pct(r) + ' now', 'dim'])
  } else out.push(['no damage type in particular: aim for its glowing weak point'])
  const how = FIELD_GUIDE[k] || GUIDE_TEXT[k]
  if (how) out.push(['     ', 'dim'], [how])
  return out
}
/** HiveGuide.Resistances: every type, the highest marked */
export function resistSegments(h) {
  let top = 0
  for (const t of DAMAGE_TYPES) top = Math.max(top, h.resist[t] || 0)
  const out = []
  DAMAGE_TYPES.forEach((t, i) => {
    const r = h.resist[t] || 0, most = top > 0.005 && r >= top - 0.001
    if (i) out.push(['   ·   ', 'dim'])
    out.push([t + ' ' + pct(r) + (most ? '  highest' : ''), most ? 'hive' : r > 0.005 ? 'text' : 'dim'])
  })
  return out
}
export function guideModel(G, run, visit, st, A) {
  const met = ROSTER.filter(k => visit.met.includes(k))
  const sel = Math.max(0, Math.min(met.length - 1, st.selected || 0))
  const k = met[sel]
  const unlocked = unlockedWeapons(run.level), carried = weaponList(currentSlots(G, run))
  const per = 5, pages = Math.max(1, Math.ceil(visit.log.length / per)), page = Math.max(0, Math.min(pages - 1, st.page || 0))
  const log = []
  for (let i = visit.log.length - 1 - page * per, n = 0; i >= 0 && n < per; i--, n++) { const e = visit.log[i]; log.push([[e.title, e.colour], ['   ' + e.kicker.replace('Field guide  ·  ', ''), 'dim'], ['   ' + e.body]]) }
  return {
    enemies: met.map(x => ({ name: displayName(x) })), selected: sel,
    count: met.length + ' of ' + ROSTER.length + ' met' + (met.length < ROSTER.length ? '  ·  the rest are still out there' : ''),
    detail: k ? { kicker: roleLabel(k), title: displayName(k), text: describe(k, run.hive), colour: roleColour(k) }
      : { kicker: '', title: 'Nothing met yet', text: 'Every enemy you meet is written down here: what it goes for, what it is weak to and how to beat it.', colour: UI.amber },
    hive: { resist: resistSegments(run.hive), advice: advice(run.hive, unlocked, carried, G.touch ? 'swap at the gear locker between waves' : undefined) },
    log: log.length ? log : [[['No field-guide cards yet this visit.', 'dim']]], page: 'Page ' + (page + 1) + ' / ' + pages,
    onSelect: A.select, onClose: A.close, onPage: A.page,
  }
}

// ---------------------------------------------------------------- gear locker: run items + weapon rack, and the Armory page
export function currentSlots(G, run) {
  const s = G.weapons && G.weapons.slots
  return Array.isArray(s) && s.length >= 2 && typeof s[0] === 'string' ? [s[0], s[1]] : run.loadout
}
function rackInfo(run, id) {
  const w = WEAPON_BY_ID[id]
  if (!w) return ''
  const r = run.hive.resist[w.type] || 0
  return [[w.type], DOT, r > 0.005 ? ['Hive resists ' + pct(r), 'danger'] : ['no resistance', 'dim']]
}
export function gearModel(G, run, st, A) {
  const page = st.page === 'armory' ? 'armory' : 'gear'
  const tabs = [{ label: 'Gear', on: page === 'gear' }, { label: 'Armory  ·  ' + run.samples + (run.samples === 1 ? ' Sample' : ' Samples'), on: page === 'armory' }]
  if (page === 'armory') return armoryModel(G, run, st, A, tabs)
  const slots = currentSlots(G, run)
  const un = unlockedWeapons(run.level), next = nextLockedWeapon(run.level)
  const rackNext = (un.length > 2 ? un.length + ' weapons unlocked' : 'Two weapons unlocked') + (next ? '  ·  next: ' + next.name + ' at level ' + next.unlock : '  ·  all unlocked')
  return {
    title: 'Gear locker', sub: 'Run upgrades. One of each, lost when the run ends.', balance: run.biomass, tabs, onTab: A.tab,
    items: GEAR.map(g => ({ name: g.name, desc: g.desc, cost: g.cost, owned: !!run.gear[g.id], icon: g.icon })),
    rackTitle: 'Weapons', rackSub: 'Free swap · unlocked weapons · this run',
    rack: [0, 1].map(i => ({ name: weaponName(slots[i]), info: rackInfo(run, slots[i]) })),
    next: rackNext,
    onBuy: A.buyGear, onSwap: A.swap, onClose: A.close,
  }
}
export const ARMORY_PER_PAGE = 3
export const ARMORY_PAGES = Math.ceil(ARMORY.length / ARMORY_PER_PAGE)
export function armoryBuyable(run) {
  return ARMORY.some(u => run.level >= u.unlock && armoryCost(u, run.armory[u.id] || 0) > 0 && armoryCost(u, run.armory[u.id] || 0) <= run.samples)
}
function armoryModel(G, run, st, A, tabs) {
  const pages = ARMORY_PAGES
  const p = Math.max(0, Math.min(pages - 1, st.apage || 0))
  const list = ARMORY.slice(p * ARMORY_PER_PAGE, p * ARMORY_PER_PAGE + ARMORY_PER_PAGE)
  return {
    title: 'Armory', sub: 'Upgrades for this run, paid in Hive Samples. Each unlocks at a player level.', balance: run.samples, tabs, onTab: A.tab,
    items: list.map(u => {
      const rank = run.armory[u.id] || 0, max = u.costs.length, cost = armoryCost(u, rank)
      const maxed = rank >= max, locked = !maxed && run.level < u.unlock
      return {
        name: u.name + '  ·  ' + rank + ' / ' + max, icon: 'sample', costIcon: 'sample', cost: maxed ? null : cost,
        desc: maxed ? 'Maxed  ·  ' + armoryDescribe(u, rank) : locked ? 'Unlocks at player level ' + u.unlock + '  ·  ' + armoryDescribe(u, rank + 1) : 'Next rank: ' + armoryDescribe(u, rank + 1),
        note: locked ? 'LV ' + u.unlock : maxed ? 'MAX' : undefined, noteColour: locked ? 'danger' : 'lime',
      }
    }),
    rackTitle: 'Upgrades', rackSub: 'Page ' + (p + 1) + ' / ' + pages + '  ·  player level ' + run.level,
    rack: [{ name: '‹ Previous page', slotLabel: '' }, { name: 'Next page ›', slotLabel: '' }],
    next: '',
    onBuy: A.buyArmory, onSwap: A.armoryPage, onClose: A.close,
  }
}

// ---------------------------------------------------------------- evolution report
export function evolutionModel(run, report, adviceText, onContinue) {
  return {
    generation: report.generation,
    rows: report.picks.slice(0, 3).map(p => { const e = EVOLUTION_BY_ID[p.id]; return { reason: p.reason, name: e.name, stacks: p.stack, effect: e.effect, colour: e.colour } }),
    advice: adviceText, seen: seenSegments(report.seen), onContinue,
  }
}

// ---------------------------------------------------------------- end screen + debrief
/**
 * s = summary { won, waveReached, wavesCleared, newBest, best, cause, playerLine, topLine, step:{label, reason}, level, xp, samplesEarned,
 *               samplesSpent, unlocked:[names], history, fights:[{ kind, wave, killed }], milestones:[waves] }
 */
export function endModel(s, A, week) {
  const prog = [['Player level ' + s.level, 'amber'], ['   ·   ', 'dim'], [fmtInt(s.xp) + ' XP'], ['   ·   ', 'dim'], [s.samplesEarned + (s.samplesEarned === 1 ? ' Hive Sample' : ' Hive Samples'), 'sample'],
    ['  (' + s.samplesSpent + ' spent in the Armory)', 'dim']]
  const next = nextLockedWeapon(s.level)
  const unlock = s.unlocked.length ? [['UNLOCKED', 'amber'], ['   ' + s.unlocked.join('   ·   ')], ['   ·   this run', 'dim']]
    : next ? [['Next unlock   ', 'dim'], [next.name], ['   at player level ' + next.unlock, 'dim']] : [['Every weapon is unlocked', 'dim']]
  let evo
  if (!s.history.length) evo = [['The Hive did not evolve this run', 'dim']]
  else {
    evo = [['HIVE EVOLUTIONS FACED', 'hive']]
    let gen = -1
    for (const rec of s.history) {
      const e = EVOLUTION_BY_ID[rec.id]
      if (rec.generation !== gen) { gen = rec.generation; evo.push(['     Gen ' + gen + ' · wave ' + rec.wave + ':  ', 'dim']) } else evo.push([', '])
      evo.push([e.name + (roman(rec.stack) ? ' ' + roman(rec.stack) : ''), e.colour])
    }
  }
  let queens = []
  if (!s.fights.length) queens.push(['No queen came this run', 'dim'])
  else {
    queens.push(['QUEENS FACED', 'danger'])
    for (const f of s.fights) {
      queens.push(['     Wave ' + f.wave + ' · ', 'dim'], [QUEENS[f.kind] ? QUEENS[f.kind].title.replace(/^The /, '') : displayName(f.kind), QUEENS[f.kind] ? QUEENS[f.kind].uiColor : 'text'])
      if (!f.killed) queens.push([' (survived)', 'dim'])
    }
  }
  if (s.milestones.length) queens = queens.concat([['          '], ['MILESTONES', 'amber'], ['  ' + s.milestones.map(w => 'wave ' + w).join(' · ')]])
  return {
    won: !!s.won, title: s.won ? 'Outpost held' : 'Core lost',
    subtitle: 'The Hive overran the outpost on wave ' + s.waveReached,
    bestLine: (s.newBest ? 'NEW BEST  ·  ' + s.wavesCleared + (s.wavesCleared === 1 ? ' WAVE' : ' WAVES') + ' HELD' : 'BEST THIS VISIT  ·  ' + s.best + (s.best === 1 ? ' WAVE' : ' WAVES') + ' HELD') + (week ? '  ·  ' + week : ''),
    newBest: !!s.newBest || /IN THE PRIZES/.test(week || ''), week: week || '',
    cause: s.cause, playerLine: s.playerLine, topLine: s.topLine,
    action: s.step ? { label: s.step.label, reason: s.step.reason } : null,
    progress: prog, levelFrac: levelProgress(s.xp), unlockLine: unlock,
    hint: 'Each run starts fresh: player level, weapon unlocks, Hive Samples and the Armory are earned inside the run',
    evoLine: evo, queensLine: queens,
    againLabel: 'Play again', menuLabel: 'Start screen',
    onAgain: A.again, onMenu: A.menu, onAction: A.action,
  }
}
export { WEAPONS }
