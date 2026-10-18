// Hive Adapt (Project 0 port): the RUN module (createRun(G)): run loop, waves, Hive Evolution, economy, in-run progression,
// flow screens, tutorial, supply pods, combat feedback, debrief, score. Ports Core/RunManager.cs, Waves/*, Hive/*, Economy/*,
// Progression/*, Defence/SupplyPod.cs + GearShop.cs, Combat/CombatFeedback.cs and the UI flow (TutorialController, EvolutionScreen,
// EndScreen, Debrief, HiveGuide, FieldGuide, PauseMenu). Spec: hive-spec/run-hive-economy.md (+ player-weapons.md §4-5,
// outpost-turrets-ui.md §11-12). Helpers: waves.js (generator), hive.js (evolution), progress.js (levels, Armory, debrief),
// rundata.js (tables), pod.js (supply pod), flow.js (tutorial, field guide), screens.js (screen models).
//
// Web adaptations: endless only; the Hive starts at generation 0 with no resistance (WebGL baked default); nothing persists:
// player level, weapon unlocks, Hive Samples and the Armory are earned and spent inside the run (the Armory is a page of the
// gear locker [B]); the tutorial and field-guide cards run once per visit; score = waves held -> G.postScore at game over.
//
// Public API (CONTRACT.md run.js): title(), start(), update(dt, rdt), load(); fields phase 'build'|'combat'|'over', wave, best,
// biomass, level, xp, samples, kills, deaths, hive, mods, loadout, bossesFaced; canAfford(n), spend(n, reason) -> bool,
// earn(n, reason), addXp(n, why), addSamples(n, why), lackMessage(n); debug hooks on run.debug.
// Events emitted (G.events): runStarted, buildPhase(wave), waveStarted(wave), waveCleared(wave, bonus), hiveEvolved(report),
// levelUp(level, unlocks), modsChanged(source), loadoutChanged(slots), gearBought(id), gearLocker(open), podLanded(pod),
// podCollected(kind, amount), runEnded(summary).
import * as THREE from 'three'
import { generateWave, createSpawner, isBoss, bossAppearance, waveClearBonus, SPAWN_IDS } from './waves.js'
import * as HV from './hive.js'
import * as PR from './progress.js'
import { RUN, GEAR, ARMORY, WEAPON_BY_ID, DEFAULT_LOADOUT, TYPE_COLOUR, UI, baseMods, streakLabel } from './rundata.js'
import { QUEENS, KINDS } from './enemydata.js'
import { createPod } from './pod.js'
import { createTutorial, createFieldGuide } from './flow.js'
import * as SC from './screens.js'
import { roundEven } from './u.js'

const BEARINGS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const bearingName = (x, z) => { const yaw = Math.atan2(x, -z) * 180 / Math.PI; return BEARINGS[Math.round(((yaw % 360) + 360) % 360 / 45) % 8] }
const fn = v => typeof v === 'function'
const arr = v => (Array.isArray(v) ? v : [])

export function createRun(G) {
  const hud = () => G.hud || {}
  const emit = (n, ...a) => { if (G.events && G.events.emit) G.events.emit(n, ...a) }
  const sfx = (name, o = {}) => { if (G.sfx) G.sfx(name, { ui: true, ...o }) }
  const toast = (t, kind = 'info') => { if (hud().toast) hud().toast(t, kind) }
  const deny = t => { toast(t, 'error'); sfx('ui_denied', { vol: 0.8 }) }

  // ---------------------------------------------------------------- what lives for the whole visit (nothing is stored)
  // the tutorial is opt-in (the start screen's Tutorial button, or Tutorial run in the pause menu): most players know the controls
  const visit = { runs: 0, best: 0, wantTutorial: false, seen: new Set(), met: [], log: [] }
  const tut = createTutorial(G)
  const guideCards = createFieldGuide(G, visit)
  let pod = null

  // ---------------------------------------------------------------- the public object (G.run)
  const run = {
    phase: 'over', wave: 1, waveIndex: 0, best: 0, wavesCleared: 0, buildTime: 0, held: false,
    biomass: RUN.startingBiomass, earned: 0, spent: 0, level: 1, xp: 0, samples: 0, samplesEarned: 0, samplesSpent: 0, kills: 0, deaths: 0,
    hive: HV.newHive(), mods: baseMods(), armory: {}, gear: {}, loadout: DEFAULT_LOADOUT.slice(), bossesFaced: [],
    telemetry: null, visit,
  }
  /** 0-1 progress to the next player level (player.js draws it on the vitals' XP line) */
  Object.defineProperty(run, 'xpFrac', { get: () => PR.levelProgress(run.xp), enumerable: true })
  // per-run internals
  let R = null
  // open screens / UI state
  const S = { pause: false, guide: null, gear: null, evo: null, end: null, endAt: -1, endModel: null, titleSig: '', timers: [], streak: 0, lastKill: -10 }

  function newRunState() {
    return {
      win: HV.newStats(), totals: HV.newStats(), debrief: PR.newDebrief(), deathsBase: 0, evolvedAt: new Set(), reports: [],
      fights: [], milestones: [], unlocked: [], towersBuilt: 0, pending: null, spawner: null, nextBoss: null, lastBonus: 0,
      sawCoreDamaged: false, sawPlayerDamaged: false, startT: G.time || 0, summary: null, sources: {}, queenMods: {},
    }
  }

  // ================================================================== co-op (net.js): one host runs the Hive, the others mirror it
  const N = () => G.net || null
  const guest = () => !!(G.net && G.net.client)
  const multi = () => !!(G.net && G.net.multi)
  /** players in this run (me included): the Hive's Biomass and Samples are shared out between them */
  const squad = () => { const n = G.net && G.net.squad ? G.net.squad() : 1; return n > 1 ? n : 1 }
  const SPLIT = new Set(['kill', 'wave', 'queen', 'pod', 'siege'])
  let bioFrac = 0, sampleFrac = 0

  // ================================================================== economy (EconomyManager)
  run.canAfford = n => run.biomass >= Math.max(0, n || 0)
  run.lackMessage = n => 'Not enough Biomass: need ' + Math.ceil(n) + ', have ' + Math.floor(run.biomass)
  run.spend = (n, reason) => {
    n = Math.max(0, Math.ceil(n || 0))
    if (run.biomass < n) return false
    run.biomass -= n
    run.spent += n
    return true
  }
  /** returns what landed in this wallet: in co-op the Hive's Biomass is split between the defenders (fractions carry over) */
  run.earn = (n, reason) => {
    n = Math.round(n || 0)
    if (n <= 0) return 0
    const k = SPLIT.has(reason) ? squad() : 1
    if (k > 1) { const x = n / k + bioFrac; n = Math.floor(x); bioFrac = x - n; if (n <= 0) return 0 }
    run.biomass += n
    run.earned += n
    return n
  }

  // ================================================================== progression (RunProgression)
  run.addXp = (n, why) => {
    n = Math.round(n || 0)
    if (n <= 0 || !R) return
    const before = run.level
    run.xp += n
    run.level = PR.levelForXp(run.xp)
    if (run.level > before) {
      const un = PR.unlocksBetween(before, run.level)
      for (const w of un) if (!R.unlocked.includes(w.name)) R.unlocked.push(w.name)
      const locker = G.touch ? 'the gear locker' : 'the gear locker [B]'
      const line = un.length ? [['Unlocked   ', 'dim'], [un.map(w => w.name).join('  ·  ')], ['   ·  equip it at ' + locker, 'dim']]
        : [['Hive Samples buy Armory upgrades at ' + locker, 'dim']]
      if (hud().levelUp) hud().levelUp(run.level, line)
      sfx('sfx_level_up', { vol: 1 })
      for (const w of un) toast([[w.name + ' unlocked', 'warn'], ['  ·  Equip it at ' + locker]], 'info')
      emit('levelUp', run.level, un.map(w => w.id))
    }
  }
  run.addSamples = (n, why) => {
    if (!(n > 0) || !R) return 0
    let total = PR.sampleGrant(n, run.mods.sampleFind)
    const k = why === 'debug' ? 1 : squad()
    if (k > 1) { const x = total / k + sampleFrac; total = Math.floor(x); sampleFrac = x - total; if (total <= 0) return 0 }
    run.samples += total
    run.samplesEarned += total
    toast('+' + total + (total === 1 ? ' Hive Sample' : ' Hive Samples') + '  ·  ' + why, 'sample')
    return total
  }
  run.unlockedWeapons = () => PR.unlockedWeapons(run.level)
  run.carriedWeapons = () => SC.weaponList(SC.currentSlots(G, run))

  /** RunModifiers = Armory ranks x value per rank + queen rewards (rebuilt in place: other modules read G.run.mods live) */
  function recomputeMods() {
    const m = run.mods
    for (const k of Object.keys(m)) m[k] = 0
    for (const u of ARMORY) m[u.mod] = Math.fround((m[u.mod] || 0) + PR.armoryValue(u, run.armory[u.id] || 0))
    if (R) for (const k of Object.keys(R.queenMods)) m[k] = Math.fround((m[k] || 0) + R.queenMods[k])
  }
  /** tell the fighter / weapons / towers the run modifiers changed (Armory buys, queen rewards) */
  function modsChanged(source) {
    for (const m of [G.player, G.weapons, G.towers]) { try { if (m && fn(m.applyMods)) m.applyMods(run.mods) } catch (e) { G.log && G.log('applyMods failed', e) } }
    emit('modsChanged', source)
  }

  // ================================================================== run start / title
  function resetRunFields() {
    run.hive = HV.newHive()
    run.mods = baseMods()
    run.biomass = RUN.startingBiomass + roundEven(run.mods.startBiomass)
    run.earned = run.spent = 0
    run.level = 1; run.xp = 0; run.samples = 0; run.samplesEarned = 0; run.samplesSpent = 0
    run.kills = 0; run.deaths = 0; run.wavesCleared = 0; run.wave = 1; run.waveIndex = 0; run.buildTime = 0; run.held = false
    run.armory = {}; run.gear = {}; run.loadout = DEFAULT_LOADOUT.slice(); run.bossesFaced = []
    run.best = visit.best
    bioFrac = 0; sampleFrac = 0
    R = newRunState()
    run.telemetry = {
      schemaVersion: 2, runId: 'web-' + Date.now().toString(36), buildVersion: G.version || '', hiveGeneration: 0, runConfig: 'Run_Endless',
      startedAtUtc: new Date().toISOString(), sources: R.sources, towersBuilt: [], evolutions: [], bosses: [],
    }
  }
  function closeScreens() {
    if (S.pause) { S.pause = false; G.paused = false; hud().pause && hud().pause(null) }
    if (S.guide) { S.guide = null; hud().guide && hud().guide(null) }
    if (S.gear) closeGear(true)
    if (S.evo) { S.evo = null; hud().evolution && hud().evolution(null) }
    S.end = null; S.endAt = -1; S.endModel = null
    hud().end && hud().end(null)
    S.timers.length = 0
  }
  function clearGameplayHud() {
    const h = hud()
    try {
      if (fn(h.clearTransient)) h.clearTransient() // banners, level cards, field-guide cards, toasts, kill feed, pops (requested from hud.js)
      h.buildBanner && h.buildBanner(null); h.gearHint && h.gearHint(false); h.bossPreview && h.bossPreview(null); h.bossBand && h.bossBand(null)
      h.evoChip && h.evoChip(null); h.hiveBadge && h.hiveBadge(null); h.tutorial && h.tutorial(null); h.streak && h.streak(0)
    } catch (e) { /* hud missing a widget */ }
  }
  function callReset(mod, ...a) { try { if (mod && fn(mod.reset)) mod.reset(...a) } catch (e) { G.log && G.log('reset failed', e && e.stack || e) } }

  run.title = () => {
    G.state = 'title'
    G.paused = false
    closeScreens()
    tut.finish()
    run.phase = 'over'
    if (R && R.spawner) R.spawner.stop()
    if (pod) pod.reset()
    try { G.enemies && fn(G.enemies.clear) && G.enemies.clear() } catch (e) { /* not loaded */ }
    if (visit.runs > 0) callReset(G.towers)
    clearGameplayHud()
    hud().setVisible && hud().setVisible(false) // the title is a full screen: no gameplay HUD behind it
    S.titleSig = ''
    showTitle()
    G.music && G.music('mus_menu_loop', 0.4)
  }
  function showTitle() {
    if (!hud().title) return
    const m = SC.titleModel(G, visit.best, () => { visit.wantTutorial = false; run.start() }, () => { visit.wantTutorial = true; run.start() })
    const co = N() && N().lobby ? N().lobby() : null
    if (co) { m.startLabel = co.label; m.footer = co.line }
    const sig = JSON.stringify([m.best, m.table, m.footer, !!G.touch, m.fighter, m.startLabel])
    if (sig === S.titleSig) return
    S.titleSig = sig
    hud().title(m)
  }

  run.start = () => {
    if (guest()) { N().requestStart(); return } // the host starts runs; joining one in progress brings its snapshot
    beginRun()
    // every run gets its id, a solo one too: a player who arrives later joins it by that id (with none, a late
    // joiner landed in 'run 0', where nothing is shared: the two players never saw each other)
    if (N() && N().runStarted) N().runStarted()
    enterBuild(0)
    // The Hive's starting resistances (none on the web baseline: the banner only shows if the table carries any)
    const rt = HV.resistText(run.hive)
    if (rt) hud().banner && hud().banner('The Hive has adapted', 'Resists ' + rt + '  ·  mix your damage types', UI.hive, 3.4)
    emit('runStarted', run)
  }
  /** a co-op guest enters the host's run: at its start (snap null: the build message follows) or in the middle (snapshot) */
  run.netEnter = snap => {
    beginRun()
    run.phase = 'build'; run.buildTime = 60 // until the host's word arrives (the same moment, normally)
    if (snap) {
      const H = HV.newHive()
      run.hive = Object.assign(H, snap.hive || {})
      run.wavesCleared = snap.wc || 0
      enterBuild(Math.max(0, (snap.w || 1) - 1), { bt: snap.bt, nb: snap.nb, quiet: true })
      if (snap.ph === 'combat') startCombat(true)
    }
    emit('runStarted', run)
  }
  function beginRun() {
    closeScreens()
    hud().title && hud().title(null)
    G.state = 'run'
    G.paused = false
    G.markRunStart && G.markRunStart()
    resetRunFields()
    visit.runs++
    try { G.enemies && fn(G.enemies.clear) && G.enemies.clear() } catch (e) { /* not loaded */ }
    callReset(G.player, { mods: run.mods })
    callReset(G.weapons, { loadout: run.loadout.slice() })
    callReset(G.towers)
    if (pod) pod.reset()
    try { G.fx && fn(G.fx.clear) && G.fx.clear() } catch (e) { /* fx not ready */ }
    clearGameplayHud()
    S.streak = 0
    tut.finish()
    if (visit.wantTutorial) { visit.wantTutorial = false; tut.begin() }
    hud().setVisible && hud().setVisible(true)
    hud().biomass && hud().biomass(run.biomass)
  }

  // ================================================================== build phase (RunManager.EnterBuildPhase)
  /** H (co-op guest): the host's { bt, nb, evo: { hive, report }, quiet } */
  function enterBuild(index, H) {
    run.waveIndex = index
    run.wave = index + 1
    const w = run.wave
    if (H) {
      if (H.evo) applyHostEvolution(w, H.evo)
      R.nextBoss = H.nb ? { ...H.nb } : null
      if (R.nextBoss) run.bossesFaced.push(R.nextBoss.kind)
    } else {
      // BuildPhaseStarting: the Hive evolves before every 5th wave, then the BossDirector lines up the queen
      if (HV.isEvolutionWave(w) && !R.evolvedAt.has(w)) evolveNow(w, true)
      R.nextBoss = null
      if (isBoss(w)) lineUpQueen(w)
    }
    R.pending = generateWave(w, { weights: run.hive.roleWeights, bossKind: R.nextBoss ? R.nextBoss.kind : 'BroodMother', bossTitle: R.nextBoss ? R.nextBoss.title : null })
    R.spawner = null
    run.buildTime = H && H.bt != null ? H.bt : multi() && index === 0 ? 60 : R.pending.build // co-op: a minute to gather before the first wave
    run.phase = 'build'
    if (!H && multi()) N().phase('b', { w, bt: run.buildTime, nb: R.nextBoss, evo: R.evoOut || undefined })
    R.evoOut = null
    if (H && H.quiet) { emit('buildPhase', w); return }
    if (index === 0) hud().banner && hud().banner('Hold the Core', G.touch ? 'Build turrets on the glowing pads, then tap the build bar' : 'Build turrets on the glowing pads, then press G', UI.cyan, 3.2)
    else hud().banner && hud().banner('Wave cleared', R.lastBonus > 0 ? '+' + R.lastBonus + ' Biomass  ·  upgrade, repair, get ready' : 'Upgrade, repair, get ready', UI.lime, 2.6)
    G.music && G.music('mus_calm_loop', 0.4)
    emit('buildPhase', w)
  }
  function lineUpQueen(w) {
    const k = bossAppearance(w)
    const latest = run.hive.history.length ? run.hive.history[run.hive.history.length - 1].generation : 0
    let q = null
    try { q = G.enemies && fn(G.enemies.pickQueen) ? G.enemies.pickQueen({ appearance: k, history: run.hive.picks, latestGeneration: latest, faced: run.bossesFaced.slice() }) : null } catch (e) { q = null }
    if (!q || !QUEENS[q.kind]) q = { kind: 'BroodMother', title: QUEENS.BroodMother.title, appearance: k, reason: k <= 1 ? 'The Hive sends its first queen' : 'The Hive sends another queen' }
    run.bossesFaced.push(q.kind)
    R.nextBoss = { kind: q.kind, title: q.title || QUEENS[q.kind].title, reason: q.reason || '', appearance: k, wave: w }
  }
  /** the HIVE EVOLVED report: open = show the screen (held build timer) */
  function evolveNow(w, open) {
    R.evolvedAt.add(w)
    R.win.barricades = standingBarricades()
    R.win.deaths = run.deaths - R.deathsBase
    const report = HV.evolve(run.hive, R.win, w)
    R.deathsBase = run.deaths
    const sw = run.hive.swarm
    run.hive.look = run.hive.picks.length ? { tint: sw.tint.slice(), plates: sw.plates, plateColor: sw.plateColor.slice(), glow: sw.glow.slice(), glowMix: sw.glowMix, size: 1 } : null
    R.reports.push(report)
    if (multi()) { const seen = report.seen; R.evoOut = { hive: run.hive, report: { ...report, seen: { ...seen, dmg: [...seen.dmg.entries()] } } } }
    for (const p of report.picks) run.telemetry.evolutions.push({ generation: p.generation, wave: p.wave, id: p.id, name: p.name, stack: p.stack, reason: p.reason, metric: p.metric, fallback: p.fallback })
    emit('hiveEvolved', report)
    if (open) openEvolution(report)
    return report
  }
  /** co-op guest: the host's Hive after its evolution, and its report on screen */
  function applyHostEvolution(w, evo) {
    R.evolvedAt.add(w)
    const H = HV.newHive()
    run.hive = Object.assign(H, evo.hive || {})
    const report = evo.report || { wave: w, generation: run.hive.generation, picks: [] }
    const seen = report.seen && typeof report.seen === 'object' ? report.seen : HV.newStats()
    report.seen = Object.assign(HV.newStats(), seen, { dmg: new Map(Array.isArray(seen.dmg) ? seen.dmg : []) })
    R.reports.push(report)
    for (const p of report.picks || []) run.telemetry.evolutions.push({ generation: p.generation, wave: p.wave, id: p.id, name: p.name, stack: p.stack, reason: p.reason, metric: p.metric, fallback: p.fallback })
    emit('hiveEvolved', report)
    openEvolution(report)
  }
  function standingBarricades() {
    let n = 0
    for (const b of arr(G.towers && G.towers.barricades)) if (b && barricadeIntact(b)) n++
    return Math.min(4, n)
  }
  const barricadeIntact = b => (b.intact != null ? !!b.intact : (b.built !== false && b.tier !== 0 && !b.broken && (typeof b.hp !== 'number' || b.hp > 0)))

  function openEvolution(report) {
    if (!hud().evolution) return
    S.evo = report
    const m = SC.evolutionModel(run, report, HV.advice(run.hive, run.unlockedWeapons(), run.carriedWeapons(), swapHint()), () => {
      if (S.evo !== report) return
      S.evo = null
      hud().evolution(null)
    })
    hud().evolution(m)
    sfx('sfx_hive_evolved', { vol: 1 })
    const t0 = G.rt || 0
    m.rows.forEach((r, i) => S.timers.push({ at: t0 + 1.45 + 0.75 * i, fn: () => { if (S.evo === report) sfx('sfx_hive_evolve_line', { vol: 0.9 }) } }))
  }

  const swapHint = () => (G.touch ? 'swap at the gear locker between waves' : 'swap at the gear locker [B] between waves')
  function heldNow() {
    if (multi()) return false // co-op: the clock is shared (G starts the wave for everyone)
    return !!((tut.active && run.waveIndex === 0) || S.evo || (S.guide && run.phase === 'build'))
  }

  // ================================================================== combat (RunManager.StartCombat, WaveManager)
  /** fromHost: a co-op guest following the host (it spawns nothing itself) */
  function startCombat(fromHost) {
    if (run.phase !== 'build' || !R) return
    if (guest() && !fromHost) { N().ready(); return }
    run.buildTime = 0
    run.phase = 'combat'
    if (S.gear) closeGear(true)
    if (S.guide && !S.pause) { S.guide = null; hud().guide && hud().guide(null) }
    sfx('sfx_wave_start', { vol: 0.9 })
    R.spawner = fromHost ? null : createSpawner(R.pending)
    if (!fromHost && multi()) N().phase('c', { w: run.wave })
    const boss = R.pending.groups.find(g => g.boss)
    let sub = R.pending.total + ' hostiles inbound'
    if (boss) { const prof = QUEENS[boss.kind]; sub = prof ? prof.title + ' awakens  ·  ' + prof.awakenLine : PR.displayName(boss.kind) + ' awakens' }
    hud().banner && hud().banner('Wave ' + run.wave, sub, UI.danger, 2.4)
    if (pod && !fromHost) pod.onWaveStarted(run.wave)
    tut.event('combat')
    G.music && G.music('mus_combat_loop', 0.45)
    emit('waveStarted', run.wave)
  }
  function spawnOne(g) {
    const E = G.enemies
    if (!E || !fn(E.spawn)) return null
    const spawnId = SPAWN_IDS[g.point] || 'A'
    try {
      if (g.boss) {
        const nb = R.nextBoss
        return E.spawn(g.kind, { spawnId, boss: { appearance: bossAppearance(run.wave), reason: nb ? nb.reason : '' } })
      }
      const chance = g.eliteChance > 0 ? Math.fround(g.eliteChance + run.hive.eliteChanceAdd) : 0
      const elite = chance > 0 && G.rng() < chance
      return E.spawn(g.kind, { spawnId, healthScale: g.healthScale, damageScale: g.damageScale, elite })
    } catch (e) { G.log && G.log('spawn failed', g.kind, e && e.stack || e); return null }
  }
  const aliveCount = () => { try { return G.enemies && fn(G.enemies.alive) ? G.enemies.alive() : 0 } catch (e) { return 0 } }
  function tickCombat(dt) {
    const sp = R.spawner
    if (!sp) { zoneTime(dt); return } // a co-op guest: the host spawns and calls the wave
    sp.tick(dt, aliveCount, spawnOne)
    try { G.enemies && fn(G.enemies.siegeTick) && G.enemies.siegeTick(run.wave, sp.time, { bossWave: isBoss(run.wave), chanceScale: run.hive.siegeChanceScale }) } catch (e) { /* siege off */ }
    zoneTime(dt)
    if (!sp.spawning && aliveCount() === 0) waveCleared()
  }
  /** a co-op host that takes over mid-wave: its own spawner for what the old host had left to send */
  run.netAdopt = remaining => {
    if (!R || run.phase !== 'combat' || R.spawner) return
    const sp = createSpawner(R.pending)
    for (let guard = 0; sp.remaining > Math.max(0, remaining | 0) && guard < 4000; guard++) sp.tick(0.05, () => 0, () => {})
    R.spawner = sp
  }
  function zoneTime(dt) {
    // zone time (only while alive in combat)
    const p = G.player
    if (p && p.pos && p.alive !== false && dt > 0) {
      const z = HV.zoneOf(p.pos)
      for (const s of [R.win, R.totals]) { if (z === 1) s.wall += dt; else if (z === 2) s.outside += dt; else s.ground += dt }
    }
  }
  /** host: the wave is clear; a co-op guest hears it from the host (its build message follows) */
  function waveCleared(fromHost) {
    if (run.phase !== 'combat') return
    const w = run.wave
    run.wavesCleared = w
    sfx('sfx_wave_clear', { vol: 0.9 })
    if (!fromHost && multi()) N().phase('x', { w })
    R.lastBonus = run.earn(waveClearBonus(w, run.mods.biomassGain), 'wave')
    try { G.towers && fn(G.towers.rechargeShield) && G.towers.rechargeShield() } catch (e) { /* none */ }
    run.addXp(PR.waveClearXp(w), 'wave')
    const m = PR.milestoneFor(w)
    if (m && !R.milestones.includes(w)) {
      R.milestones.push(w)
      run.addXp(m.xp, 'milestone')
      run.addSamples(m.samples, m.title)
      hud().banner && hud().banner('Milestone  ·  wave ' + w, m.title + '  ·  +' + m.samples + ' Hive Samples  ·  +' + m.xp + ' XP', UI.amber, 3.4)
    }
    emit('waveCleared', w, R.lastBonus)
    if (!fromHost) enterBuild(run.waveIndex + 1)
    else run.phase = 'build' // the host's build message sets the timer, queen and evolution
  }

  // ================================================================== game over (RunManager.OnCoreDied / End)
  function gameOver(killer, fromHost) {
    if (run.phase === 'over' || !R || G.state !== 'run') return
    if (!fromHost && multi()) N().phase('o', { k: killer || '' })
    run.phase = 'over'
    if (R.spawner) R.spawner.stop()
    if (S.gear) closeGear(true)
    if (S.guide && !S.pause) { S.guide = null; hud().guide && hud().guide(null) }
    tut.finish()
    R.debrief.coreKiller = killer || R.debrief.coreKiller
    R.debrief.ended = true
    const core = G.world && G.world.core
    if (core && G.fx && G.fx.burst) G.fx.burst('coreShockwave', core.pos, { scale: 1.4 })
    G.slowMo && G.slowMo(2.5, 0.25)
    // the visit's best (like the saved best wave in Unity) only moves when a run ends
    const prevBest = visit.best
    const held = run.wavesCleared
    const posted = G.postScore ? G.postScore(held) : false
    if (held > visit.best) visit.best = held
    run.best = visit.best
    sfx('sfx_defeat', { vol: 1 })
    if (pod) pod.hide()
    R.summary = summarize(held > prevBest && held > 0, posted)
    finishTelemetry('Lost')
    S.endAt = (G.rt || 0) + 2.2
    emit('runEnded', R.summary)
  }
  function summarize(newBest, posted) {
    const d = R.debrief
    const top = PR.topDamager(d)
    const totals = R.totals
    const step = PR.nextStep({
      top: top.id, hive: run.hive, damage: totals.dmg, turretShare: HV.turretShare(totals), sourceDamage: HV.sourceDamage(totals),
      carried: run.carriedWeapons(), unlocked: run.unlockedWeapons(), level: run.level, towersBuilt: R.towersBuilt, touch: !!G.touch,
    })
    return {
      won: false, waveReached: run.wave, wavesCleared: run.wavesCleared, newBest, best: visit.best, posted,
      cause: PR.causeLine(false, d.coreKiller), playerLine: PR.playerLine(d.deaths, d.playerKiller), topLine: PR.topLine(top.id, top.share),
      top: top.id, step, level: run.level, xp: run.xp, samplesEarned: run.samplesEarned, samplesSpent: run.samplesSpent, unlocked: R.unlocked.slice(),
      history: run.hive.history.slice(), fights: R.fights.map(f => ({ kind: f.kind, wave: f.wave, killed: f.killed })), milestones: R.milestones.slice(),
      kills: run.kills, deaths: run.deaths, earned: run.earned, spent: run.spent, generation: run.hive.generation,
    }
  }
  function finishTelemetry(result) {
    const t = run.telemetry
    if (!t) return
    const core = coreState()
    Object.assign(t, {
      durationSeconds: Math.round(((G.time || 0) - R.startT) * 10) / 10, result, wavesCleared: run.wavesCleared, playerDeaths: run.deaths,
      coreHealthEnd: core && core.max > 0 ? Math.max(0, core.hp / core.max) : 0, biomassEarned: run.earned, biomassSpent: run.spent,
      hiveTracking: {
        damageShare: Object.fromEntries([...R.totals.dmg.keys()].map(k => [k, HV.typeShare(R.totals, [k])])), turretShare: HV.turretShare(R.totals), playerShare: HV.playerShare(R.totals),
        wallSeconds: R.totals.wall, groundSeconds: R.totals.ground, outsideSeconds: R.totals.outside, gateKills: { 'Gate A': R.totals.gate[0], 'Gate B': R.totals.gate[1] },
      },
    })
    G.log && G.log(`run ${result}: wave ${run.wave}, held ${run.wavesCleared}, kills ${run.kills}, gen ${run.hive.generation}, level ${run.level}, biomass +${run.earned}/-${run.spent}`)
  }
  /** a mid-run restart or quit writes a "Quit" report (RunManager) */
  function quitTelemetry() { if (R && run.phase !== 'over' && G.state === 'run') finishTelemetry('Quit') }
  function showEnd() {
    S.endAt = -1
    S.end = true
    S.endModel = SC.endModel(R.summary, {
      again: () => run.start(),
      menu: () => run.title(),
      action: () => openGuide(R.summary.step && R.summary.step.focus),
    }, R.summary.posted && G.weekLine ? G.weekLine() : '')
    hud().end && hud().end(S.endModel)
    G.releaseMouse && G.releaseMouse()
    G.music && G.music('mus_menu_loop', 0.35)
  }

  // ================================================================== kills, damage, rewards (EconomyManager, RunProgression, HiveEvolution, CombatFeedback)
  function gateOf(p) {
    const slots = G.world && G.world.barricadeSlots
    if (!slots || !p) return -1
    let best = -1, bd = 14 * 14
    for (const b of slots) {
      const id = String(b.id || b.label || ''), g = id.endsWith('A') ? 0 : id.endsWith('B') ? 1 : -1
      if (g < 0) continue
      const dx = b.pos.x - p.x, dz = b.pos.z - p.z, d2 = dx * dx + dz * dz
      if (d2 < bd) { bd = d2; best = g }
    }
    return best
  }
  function sourceName(info) {
    if (!info) return { name: 'Hive', colour: UI.text }
    const col = TYPE_COLOUR[info.type] || UI.text
    if (info.source === 'tower') {
      let name = null
      try { name = G.towers && fn(G.towers.displayName) ? G.towers.displayName(info.sourceId) : null } catch (e) { name = null }
      return { name: typeof name === 'string' && name ? name : /energy/i.test(String(info.sourceId || '')) ? 'Energy Tower' : 'Ballistic Turret', colour: col }
    }
    if (info.source === 'player') { const w = WEAPON_BY_ID[info.sourceId]; return { name: w ? w.name : 'You', colour: col } }
    return { name: 'Hive', colour: col }
  }
  function onKilled(e, info) {
    if (!R || G.state !== 'run' || run.phase === 'over' || !e) return
    info = info || {}
    const src = info.source
    run.kills++
    for (const s of [R.win, R.totals]) {
      s.kills++
      if (src === 'player') s.playerKills++
      const g = gateOf(e.pos)
      if (g >= 0) s.gate[g]++
    }
    const tk = info.source === 'player' || info.source === 'tower' ? info.source + '.' + (info.type || 'Ballistic') : null
    if (tk) (R.sources[tk] = R.sources[tk] || { damage: 0, hits: 0, kills: 0, bossDamage: 0 }).kills++
    if (info.culled) return // the stuck-bug watchdog: counts as a kill, pays nothing
    const d = e.data || KINDS[e.kind]
    if (!d) return
    const siege = !!(e.siege || e.kind === 'SiegeNode')
    const elite = !!e.elite && !siege && !d.isBoss
    const bio = run.earn(PR.killBiomass(d, elite, run.mods.biomassGain), 'kill')
    if (siege) {
      run.addXp(250, 'siege node')
      run.addSamples(2, 'Siege Node')
      toast('Siege Node destroyed', 'success')
    } else {
      run.addXp(PR.killXp(d, elite, src === 'tower'), d.isBoss ? 'boss' : elite ? 'elite' : 'kill')
      if (d.isBoss) run.addSamples(5, d.displayName)
      else if (elite) run.addSamples(1, 'Elite ' + d.displayName)
    }
    const sn = sourceName(info)
    if (info.remote) sn.name = info.byName || 'Ally'
    hud().killFeed && hud().killFeed(sn.name, sn.colour, d.displayName, bio)
    // CombatFeedback: boss kill slow-mo (any source); hit-stop, shake and streaks on the player's kills
    if (d.isBoss) { bossKilled(e); G.slowMo && G.slowMo(2.4, 0.18); G.shake && G.shake(1) }
    if (src === 'player' && !info.remote) {
      if (!d.isBoss && G.hitStop) G.hitStop(0.045, 0.06)
      G.shake && G.shake(0.08)
      const now = G.rt || 0
      S.streak = now - S.lastKill <= 2.6 ? S.streak + 1 : 1
      S.lastKill = now
      sfx('sfx_kill_confirm', { vol: 0.5, rate: 1 + Math.min(S.streak, 10) * 0.03, gap: 0.03 })
      if (S.streak >= 2 && hud().streak) hud().streak(streakLabel(S.streak), S.streak)
    }
  }
  function bossKilled(e) {
    const f = R.fights.find(x => x.kind === e.kind && !x.killed)
    if (f) { f.killed = true; f.seconds = (G.time || 0) - f.t0 }
    const tb = run.telemetry && run.telemetry.bosses.find(x => x.id === e.kind && !x.killed)
    if (tb) { tb.killed = true; tb.seconds = f ? Math.round(f.seconds * 10) / 10 : 0 }
    const prof = QUEENS[e.kind]
    if (!prof) return
    const r = prof.reward
    const Q = R.queenMods
    const addQ = (k, v) => { Q[k] = (Q[k] || 0) + v; recomputeMods() }
    switch (r.kind) {
      case 0: addQ('weaponDamage', r.amount); break
      case 3: addQ('turretDamage', r.amount); break
      case 1: {
        let up = false
        try { up = !!(G.towers && fn(G.towers.addShieldLevel) && G.towers.addShieldLevel()) } catch (err) { up = false }
        if (!up) { addQ('shieldCapacity', r.amount); try { G.towers && fn(G.towers.rechargeShield) && G.towers.rechargeShield() } catch (err) { /* none */ } }
        break
      }
      case 2:
        addQ('barricadeHp', r.amount)
        try { G.towers && fn(G.towers.fortifyBarricades) && G.towers.fortifyBarricades() } catch (err) { /* none */ }
        break
    }
    const qb = run.earn(r.biomass, 'queen')
    if (r.bonusSamples > 0) run.addSamples(r.bonusSamples, r.title)
    hud().banner && hud().banner(prof.title + ' down', r.title + '  ·  ' + r.text, UI.lime, 3.6)
    sfx('sfx_queen_reward', { vol: 0.9 })
    modsChanged('queen')
  }
  function onDamaged(e, final, info) {
    if (!R || G.state !== 'run' || !e || !info) return
    const src = info.source
    if (src !== 'player' && src !== 'tower') return
    const dealt = e.hp <= 0 ? Math.min(final, e.maxHp || final) : final
    const type = info.type || 'Ballistic'
    HV.addDamage(R.win, type, dealt, src === 'tower')
    HV.addDamage(R.totals, type, dealt, src === 'tower')
    const k = src + '.' + type
    const s = R.sources[k] || (R.sources[k] = { damage: 0, hits: 0, kills: 0, bossDamage: 0 })
    s.damage += dealt; s.hits++
    if (e.boss) s.bossDamage += dealt
  }
  function onSpawned(e) {
    if (!e || !R) return
    if (!visit.met.includes(e.kind)) visit.met.push(e.kind)
    guideCards.offer(e.kind)
    if (e.boss && G.state === 'run') {
      R.fights.push({ kind: e.kind, wave: run.wave, killed: false, t0: G.time || 0, appearance: e.boss.appearance || 1 })
      run.telemetry.bosses.push({ id: e.kind, wave: run.wave, appearance: e.boss.appearance || 1, reason: e.boss.reason || (R.nextBoss && R.nextBoss.reason) || '', killed: false, seconds: 0 })
    }
  }
  function onSiegeGrow(n) {
    if (!n || G.state !== 'run' || !R) return
    if (!visit.met.includes('SiegeNode')) visit.met.push('SiegeNode')
    const pp = G.player && G.player.pos
    const dist = pp ? pp.distanceTo(n.pos) : Math.hypot(n.pos.x, n.pos.z)
    hud().banner && hud().banner('SIEGE NODE', 'Growing outside the walls  ·  ' + bearingName(n.pos.x, n.pos.z) + '  ·  ' + Math.round(dist) + ' m  ·  grenades crack it', UI.siege, 3.4)
    guideCards.offer('SiegeNode')
  }

  // ---------------------------------------------------------------- debrief record (RunDebrief)
  function coreState() { const c = G.towers && G.towers.core; return c && typeof c === 'object' && typeof c.hp === 'number' ? c : null }
  function recordCore(amount, enemy, info) {
    if (!R || R.debrief.ended || !(amount > 0)) return
    const id = PR.hitId(enemy, info)
    if (!id) return
    R.debrief.toCore[id] = (R.debrief.toCore[id] || 0) + amount
  }
  function recordPlayer(amount, enemy, info) {
    if (!R || R.debrief.ended || !(amount > 0)) return
    const id = PR.hitId(enemy, info)
    if (!id) return
    R.debrief.toPlayer[id] = (R.debrief.toPlayer[id] || 0) + amount
  }

  // ---------------------------------------------------------------- events
  const ev = G.events
  if (ev && ev.on) {
    ev.on('enemyKilled', (e, info) => onKilled(e, info))
    ev.on('enemyDamaged', (e, final, info) => onDamaged(e, final, info))
    ev.on('enemySpawned', e => onSpawned(e))
    ev.on('siegeGrow', n => onSiegeGrow(n))
    ev.on('bossPhase', (e, phase) => {
      if (phase >= 1 && e && e.boss && e.boss.banner && G.state === 'run' && run.phase !== 'over') hud().banner && hud().banner(e.boss.banner, e.boss.bannerSub || '', e.boss.uiColor || UI.amber, 2.8)
    })
    // the Core: towers report what actually came off (hull + shield); enemies' raw coreHit is the fallback
    ev.on('coreDamaged', (final, enemy, info) => { if (R) R.sawCoreDamaged = true; recordCore(final, enemy, info) })
    ev.on('coreHit', (amount, enemy) => { if (R && !R.sawCoreDamaged) recordCore(amount, enemy) })
    ev.on('playerDamaged', (final, enemy, info) => { if (R) R.sawPlayerDamaged = true; recordPlayer(final, enemy, info) })
    ev.on('playerHit', (amount, enemy) => { if (R && !R.sawPlayerDamaged) recordPlayer(amount, enemy) })
    ev.on('playerDied', (enemy, info) => {
      if (!R || G.state !== 'run' || run.phase === 'over') return
      run.deaths++
      R.debrief.deaths++
      const id = PR.hitId(enemy, info)
      if (id) R.debrief.playerKiller = id
    })
    ev.on('playerRespawned', () => { if (G.state === 'run' && run.phase !== 'over') hud().banner && hud().banner('Back in the fight', 'Respawned at the Core', UI.text, 1.6) })
    ev.on('coreDestroyed', (enemy, info) => gameOver(PR.hitId(enemy, info)))
    ev.on('towerBuilt', t => {
      if (!R) return
      R.towersBuilt++
      run.telemetry.towersBuilt.push({ towerId: (t && (t.type || t.kind)) || 'tower', padIndex: t && t.pad && t.pad.index != null ? t.pad.index : (t && t.padIndex), wave: run.wave, maxLevel: (t && t.level) || 1 })
      tut.event('towerBuilt')
    })
    ev.on('towerUpgraded', t => { const rec = run.telemetry && t && run.telemetry.towersBuilt.find(x => x.padIndex === (t.pad && t.pad.index != null ? t.pad.index : t.padIndex)); if (rec) rec.maxLevel = Math.max(rec.maxLevel, t.level || 1) })
    ev.on('focus', kind => tut.event('focus', kind))
    ev.on('jumpPad', () => tut.event('jumpPad'))
    for (const n of ['shotFired', 'weaponFired']) ev.on(n, (a) => { if (!a || a === 'player' || a.source === 'player' || a.source == null) tut.event('shotEvent') })
    for (const n of ['playerJumped', 'jumped']) ev.on(n, () => tut.event('jump'))
    for (const n of ['playerDodged', 'dodged']) ev.on(n, () => tut.event('dodge'))
    for (const n of ['weaponChanged', 'weaponSwitched']) ev.on(n, () => tut.event('weapon'))
    ev.on('table', () => { if (G.state === 'title') showTitle() })
    // the week's place came back after the end screen was up: say it in a toast
    ev.on('reward', r => {
      if (!r || r.kind !== 'score' || !S.end || !S.endModel || S.endModel.week || !G.weekLine) return
      const wl = G.weekLine()
      if (wl) toast(wl.replace('  ·  IN THE PRIZES', ', in the prize places').replace('THIS WEEK', 'this week'), 'success')
    })
    ev.on('fighter', () => { if (G.state === 'title') showTitle() })
  }

  // ================================================================== gear locker (GearShop) + weapon rack + in-run Armory
  function openGear(page = 'gear') {
    if (run.phase !== 'build' || G.state !== 'run') { deny('The gear locker opens between waves'); return }
    S.gear = { page, apage: 0, sig: '' }
    sfx('ui_click', { vol: 0.7 })
    tut.event('gear')
    renderGear(true)
    emit('gearLocker', true)
  }
  function closeGear(silent) {
    if (!S.gear) return
    S.gear = null
    hud().gearLocker && hud().gearLocker(null)
    if (!silent) sfx('ui_click', { vol: 0.7 })
    emit('gearLocker', false)
  }
  const gearActions = {
    buyGear: i => buyGear(i),
    swap: i => cycleSlot(i),
    close: () => closeGear(),
    tab: i => { if (!S.gear) return; S.gear.page = i ? 'armory' : 'gear'; S.gear.apage = 0; sfx('ui_click', { vol: 0.6 }); renderGear() },
    buyArmory: i => { const u = ARMORY[(S.gear ? S.gear.apage : 0) * SC.ARMORY_PER_PAGE + i]; if (u) buyArmory(u) },
    armoryPage: i => {
      if (!S.gear) return
      const pages = SC.ARMORY_PAGES
      S.gear.apage = (S.gear.apage + (i === 0 ? pages - 1 : 1)) % pages // [4] previous, [5] next, both wrap
      sfx('ui_click', { vol: 0.6 })
      renderGear()
    },
  }
  function renderGear(force) {
    if (!S.gear || !hud().gearLocker) return
    const m = SC.gearModel(G, run, S.gear, gearActions)
    const sig = JSON.stringify(m, (k, v) => (typeof v === 'function' ? undefined : v))
    if (!force && sig === S.gear.sig) return
    S.gear.sig = sig
    hud().gearLocker(m)
  }
  function buyGear(i) {
    const it = GEAR[i]
    if (!it) return
    if (run.phase !== 'build') { deny('The gear locker opens between waves'); return }
    if (run.gear[it.id]) { deny(it.name + ' already equipped'); return }
    if (!run.spend(it.cost, 'gear')) { deny(run.lackMessage(it.cost)); return }
    run.gear[it.id] = true
    const p = G.player
    try {
      if (p && fn(p.equipGear)) p.equipGear(it.id)
      else if (p && typeof p === 'object') { p.gear = p.gear && typeof p.gear === 'object' ? p.gear : {}; p.gear[it.id] = true }
    } catch (e) { G.log && G.log('equipGear failed', e) }
    renderGear()
    toast(it.name + ' equipped', 'success')
    sfx('ui_purchase', { vol: 0.9 })
    emit('gearBought', it.id)
  }
  function cycleSlot(slot) {
    if (run.phase !== 'build') { deny('Swap weapons at the gear locker between waves'); return }
    const un = run.unlockedWeapons()
    const slots = SC.currentSlots(G, run).slice()
    if (slot < 0 || slot > 1 || un.length < 2) { deny('No other weapon unlocked yet'); return }
    const cur = slots[slot]
    const idx = un.findIndex(w => w.id === cur)
    const next = un[(idx + 1) % un.length]
    if (!next || next.id === cur) { deny('No other weapon unlocked yet'); return }
    const other = 1 - slot
    if (slots[other] === next.id) slots[other] = cur // taking the other slot's weapon swaps the two
    slots[slot] = next.id
    run.loadout = slots
    const W = G.weapons
    try {
      if (W && fn(W.equipSlot)) { W.equipSlot(slot, slots[slot]); W.equipSlot(other, slots[other]) }
      if (W && fn(W.rearm)) W.rearm()
    } catch (e) { G.log && G.log('equipSlot failed', e) }
    renderGear()
    toast('Slot ' + (slot + 1) + ': ' + next.name, 'success')
    sfx('sfx_upgrade', { vol: 0.8 })
    tut.event('weapon')
    emit('loadoutChanged', slots.slice())
  }
  function buyArmory(u) {
    const rank = run.armory[u.id] || 0, cost = PR.armoryCost(u, rank)
    if (run.phase !== 'build') { deny('The gear locker opens between waves'); return }
    if (cost <= 0) { deny(u.name + ' is at max rank'); return }
    if (run.level < u.unlock) { deny(u.name + ' unlocks at player level ' + u.unlock); return }
    if (run.samples < cost) { deny('Not enough Hive Samples: need ' + cost + ', have ' + run.samples); return }
    run.samples -= cost
    run.samplesSpent += cost
    run.armory[u.id] = rank + 1
    recomputeMods()
    // web: bought mid-run, the "at run start" upgrades pay out at once
    if (u.id === 'seed_biomass') run.earn(u.per, 'armory')
    if (u.id === 'plate_carrier') addArmor(u.per)
    renderGear()
    toast(u.name + ' rank ' + (rank + 1) + '  ·  ' + PR.armoryDescribe(u, rank + 1), 'success')
    sfx('ui_purchase', { vol: 0.9 })
    modsChanged('armory')
  }
  function addArmor(n) {
    const p = G.player
    if (!p || typeof p !== 'object') return 0
    try {
      if (fn(p.addArmor)) return p.addArmor(n) || 0
      if (typeof p.armor === 'number') { const max = typeof p.armorMax === 'number' ? p.armorMax : Infinity; const before = p.armor; p.armor = Math.min(max, p.armor + n); return p.armor - before }
    } catch (e) { /* none */ }
    return 0
  }

  // ================================================================== pause, Hive guide
  const shared = () => { if (!multi()) return false; deny('This run is shared: it ends when the Core falls'); return true }
  const pauseActions = {
    resume: () => closePause(),
    guide: () => openGuide(null),
    restart: () => { if (shared()) return; closePause(); quitTelemetry(); run.start() },
    tutorial: () => { if (shared()) return; closePause(); quitTelemetry(); visit.wantTutorial = true; visit.seen.clear(); run.start() },
    quit: () => {
      if (multi() && !guest()) { deny('You are holding this run for the others: leave the lot to hand it over'); return }
      closePause(); quitTelemetry(); run.title()
    },
  }
  function openPause() {
    if (G.state !== 'run' || run.phase === 'over' || S.pause || S.evo) return
    S.pause = true
    G.paused = !multi() // co-op: the Hive does not wait
    G.releaseMouse && G.releaseMouse()
    hud().pause && hud().pause(SC.pauseModel(G, run, pauseActions))
  }
  function closePause() {
    if (!S.pause) return
    if (S.guide) { S.guide = null; hud().guide && hud().guide(null) }
    S.pause = false
    G.paused = false
    hud().pause && hud().pause(null)
  }
  function openGuide(focusKind) {
    const met = ['Crawler', 'Flyer', 'Rammer', 'Spitter', 'Leech', 'Burrower', 'SiegeNode', 'BroodMother', 'ArmoredMatriarch', 'BurrowQueen', 'SkyQueen'].filter(k => visit.met.includes(k))
    const i = focusKind ? met.indexOf(focusKind) : -1
    S.guide = { selected: i >= 0 ? i : 0, page: 0, sig: '' }
    renderGuide(true)
    sfx('ui_click', { vol: 0.7 })
  }
  const guideActions = {
    select: i => { if (S.guide) { S.guide.selected = i; sfx('ui_hover', { vol: 0.5 }) } },
    page: d => { if (S.guide) S.guide.page = Math.max(0, S.guide.page + d) },
    close: () => { S.guide = null; hud().guide && hud().guide(null) },
  }
  function renderGuide(force) {
    if (!S.guide || !hud().guide) return
    const m = SC.guideModel(G, run, visit, S.guide, guideActions)
    const sig = JSON.stringify(m, (k, v) => (typeof v === 'function' ? undefined : v))
    if (!force && sig === S.guide.sig) return
    S.guide.sig = sig
    hud().guide(m)
  }

  // ================================================================== HUD feed (every frame in a run)
  function feedHud() {
    const h = hud()
    const blocked = !!(S.pause || S.guide || S.evo || S.end)
    h.setVisible && h.setVisible(!blocked)
    const sp = R.spawner
    const left = run.phase === 'combat' ? aliveCount() + (sp ? sp.remaining : guest() ? N().hostRemaining() : 0) : 0
    h.wave && h.wave({ wave: run.wave, best: run.best, endless: true, phase: run.phase === 'over' ? 'lost' : run.phase, timer: run.buildTime, held: run.held, left })
    const c = coreState()
    if (c && h.core) {
      const lvl = c.shieldLevel || 0
      h.core({ hp: Math.max(0, c.hp), max: c.max || RUN.coreMaxHealth, shield: c.shield || 0, shieldMax: c.shieldMax || 0, boostPct: typeof c.boostPct === 'number' ? c.boostPct : 10 * Math.max(0, lvl - 1), hit: !!c.hit })
    } else if (h.core) h.core({ hp: RUN.coreMaxHealth, max: RUN.coreMaxHealth, shield: 0, shieldMax: 0, boostPct: 0 })
    h.hiveTag && h.hiveTag(HV.hiveTag(run.hive))
    if (h.hiveBadge) {
      const order = []
      for (const rec of run.hive.history) if (!order.includes(rec.id)) order.push(rec.id)
      h.hiveBadge(order.length ? { generation: run.hive.generation, rows: order.map(id => ({ name: HV.EVOLUTION_BY_ID[id].short, colour: HV.EVOLUTION_BY_ID[id].colour, stacks: run.hive.stacks[id] || 1 })) } : null)
    }
    const build = run.phase === 'build'
    h.buildBanner && h.buildBanner(build ? { seconds: run.buildTime, held: run.held, onReady: () => { if (!(G.hud.blocking && G.hud.blocking())) startCombat() } } : null)
    h.gearHint && h.gearHint(build, () => { if (!S.gear) openGear() })
    const nb = R.nextBoss
    h.bossPreview && h.bossPreview(build && nb && nb.wave === run.wave ? 'Boss wave ' + nb.wave + '  ·  ' + nb.title + '  ·  ' + nb.reason : null, nb && QUEENS[nb.kind] ? QUEENS[nb.kind].uiColor : UI.danger)
    let boss = null
    try { boss = run.phase === 'combat' && G.enemies ? G.enemies.boss : null } catch (e) { boss = null }
    if (boss && boss.boss && h.bossBand) {
      const b = boss.boss, prof = b.profile || QUEENS[boss.kind] || null
      const phaseLine = 'Phase ' + ((b.phase || 0) + 1) + ' of ' + (b.phaseCount || 1) + '  ·  ' + (b.phaseLabel || '') + (b.status ? '  ·  ' + b.status : '')
      h.bossBand({ name: b.title || PR.displayName(boss.kind), frac: boss.maxHp > 0 ? boss.hp / boss.maxHp : 1, phaseLine, colour: b.uiColor || UI.amber, marks: prof ? prof.phases.slice(1).map(p => p.startsAt) : [0.5] })
    } else h.bossBand && h.bossBand(null)
    h.biomass && h.biomass(run.biomass)
    if (h.tutorial) h.tutorial(tut.active ? tut.model(() => tut.finish()) : null)
  }

  // ---------------------------------------------------------------- edge markers: pod, Siege Nodes (<= 2), last hostiles (<= 3)
  const _mp = new THREE.Vector3()
  function pushMarkers() {
    const h = hud(), cam = G.camera
    if (!h.project || !cam || !G.markers || S.end || run.phase === 'over') return
    const pp = G.player && G.player.pos
    const mark = (pos, m) => {
      const p = h.project(pos, cam, true)
      G.markers.push({ ...m, x: p.x, y: p.y, behind: p.behind, onScreen: p.onScreen })
    }
    if (pod && pod.state !== 'idle' && pod.contents) {
      _mp.copy(pod.pos); _mp.y += 2.5
      const dist = pp ? Math.round(pp.distanceTo(pod.pos)) : 0
      const label = pod.state === 'incoming' ? pod.contents.label + ' inbound' : pod.contents.label + '  ' + dist + ' m  ·  ' + Math.ceil(pod.timeLeft) + ' s'
      mark(_mp, { kind: 'pod', label, colour: pod.contents.colour, icon: pod.contents.icon, pulse: pod.state === 'landed' && pod.timeLeft < 8 })
    }
    let n = 0
    for (const node of arr(G.enemies && G.enemies.siegeNodes)) {
      if (!node || !node.alive || n >= 2) continue
      n++
      _mp.copy(node.pos); _mp.y += 5.5
      mark(_mp, { kind: 'siege', label: 'SIEGE NODE  ' + (pp ? Math.round(pp.distanceTo(node.pos)) : 0) + ' m', bar: node.maxHp > 0 ? node.hp / node.maxHp : 1, pulse: !!node.winding })
    }
    if (run.phase === 'combat' && R.spawner && R.spawner.remaining === 0) {
      const alive = aliveCount()
      if (alive > 0 && alive <= 3) {
        let k = 0
        for (const e of arr(G.enemies && G.enemies.list)) {
          if (!e || !e.alive || k >= 3) continue
          k++
          const a = e.aim && e.aim.lengthSq() > 0 ? e.aim : e.pos
          _mp.copy(a); _mp.y += 1.2
          mark(_mp, { kind: 'hostile', label: (pp ? Math.round(pp.distanceTo(e.pos)) : 0) + ' m' })
        }
      }
    }
  }

  // ================================================================== the frame
  let lastErrAt = -10
  run.update = (dt, rdt) => {
    // a failure here must not take main.js's frame down with it (player, weapons and enemies update after us)
    try { frame(dt, rdt) } catch (e) { if ((G.rt || 0) - lastErrAt > 2) { lastErrAt = G.rt || 0; G.log && G.log('run.update failed: ' + (e && e.stack || e)) } }
  }
  function frame(dt, rdt) {
    // real-time timers (evolution line thuds, end screen delay)
    const now = G.rt || 0
    for (let i = S.timers.length - 1; i >= 0; i--) if (now >= S.timers[i].at) { const t = S.timers[i]; S.timers.splice(i, 1); t.fn() }
    if (G.state === 'title') { showTitle(); return }
    if (G.state !== 'run' || !R) return
    const inp = G.input || {}
    const pr = inp.pressed || new Set()
    const blocked = !!(G.hud && G.hud.blocking && G.hud.blocking())
    // ---- input actions
    if (pr.has('skipTutorial')) tut.finish()
    if (pr.has('pause') && run.phase !== 'over') openPause()
    if (!S.pause && !S.evo && !S.end) {
      if (pr.has('gear')) { if (S.gear) closeGear(); else if (!blocked) openGear() }
      // the mouse wheel flips the locker's tabs (Q / Tab are handled by hud.js through onTab)
      if (S.gear && (pr.has('next') || pr.has('prev'))) gearActions.tab(S.gear.page === 'gear' ? 1 : 0)
      if (pr.has('guide') && run.phase === 'build' && !S.guide && !S.gear) openGuide(null)
      if (pr.has('ready') && run.phase === 'build' && !blocked) startCombat() // a co-op guest's G asks the host
    }
    if (S.gear && run.phase !== 'build') closeGear(true)
    // ---- phases (debug.speed > 1 only in tests: the software renderer runs a few frames a second)
    const k = run.debug.speed > 0 ? run.debug.speed : 1
    run.held = run.phase === 'build' && heldNow()
    if (run.phase === 'build') {
      if (!run.held) run.buildTime -= dt * k
      if (run.buildTime <= 0) { if (guest()) run.buildTime = 0; else startCombat() }
    } else if (run.phase === 'combat') tickCombat(dt * k)
    if (pod) pod.update(dt * k, rdt)
    tut.update(rdt, true)
    guideCards.update()
    if (S.streak > 0 && now - S.lastKill > 2.6) { S.streak = 0; hud().streak && hud().streak(0) }
    if (run.phase === 'over' && S.endAt > 0 && now >= S.endAt) showEnd()
    // ---- HUD
    feedHud()
    renderGear(false)
    renderGuide(false)
    if (S.pause && hud().pause) hud().pause(SC.pauseModel(G, run, pauseActions))
    pushMarkers()
  }

  run.load = async () => {
    pod = createPod(G, {
      wave: () => run.wave,
      core: () => coreState(),
      onDrop: p => { if (multi() && !guest()) N().podDropped(p) },
      barricadesNeedRepair: () => arr(G.towers && G.towers.barricades).some(b => b && (b.needsRepair === true || (fn(b.needsRepair) && b.needsRepair()) || (b.built !== false && b.tier > 0 && typeof b.hp === 'number' && typeof b.max === 'number' && b.hp < b.max))),
      collect: (kind, amount) => {
        if (multi()) N().podTaken(kind, amount) // the others hide it, take their share of Biomass; the host does the repairs
        switch (kind) {
          case 'armor': return Math.round(addArmor(amount))
          case 'core': {
            if (guest()) { const c = coreState(); return c ? Math.round(Math.max(0, Math.min(amount, c.max - c.hp))) : 0 }
            let healed = 0
            try {
              if (G.towers && fn(G.towers.healCore)) healed = G.towers.healCore(amount) || 0
              else { const c = coreState(); if (c && c.hp > 0) { const b = c.hp; c.hp = Math.min(c.max, c.hp + amount); healed = c.hp - b } }
            } catch (e) { healed = 0 }
            return Math.round(healed)
          }
          case 'barricade': {
            if (guest()) return arr(G.towers && G.towers.barricades).filter(b => b && b.built && b.needsRepair).length
            try { return G.towers && fn(G.towers.repairAllBarricades) ? G.towers.repairAllBarricades() || 0 : 0 } catch (e) { return 0 }
          }
          default: return run.earn(amount, 'pod')
        }
      },
      onIncoming: p => { if (G.state === 'run') toast([['Supply pod inbound outside the walls  ·  ', 'info'], [p.contents.label, p.contents.colour]], 'info') },
      onLanded: p => emit('podLanded', p),
      onCollected: (c, got) => {
        const text = c.kind === 'armor' ? (got > 0 ? '+' + got + ' Armor' : 'Armor already full')
          : c.kind === 'core' ? (got > 0 ? 'Core patched +' + got : 'Core already intact')
            : c.kind === 'barricade' ? (got <= 0 ? 'Barricades already sound' : got === 1 ? '1 barricade repaired' : got + ' barricades repaired') : '+' + got + ' Biomass'
        hud().podPop && hud().podPop(text, c.icon, c.colour)
        toast([['Supply pod recovered  ·  ', 'info'], [text, c.colour]], 'info')
        emit('podCollected', c.kind, got)
      },
      onExpired: () => { if (G.state === 'run' && run.phase !== 'over') toast('Supply pod lost', 'dim') },
    })
    if (G.root) G.root.add(pod.object)
  }

  // ================================================================== co-op entry points (net.js)
  run.net = {
    build: d => { if (!R || G.state !== 'run') return; if (run.phase === 'combat') waveCleared(true); enterBuild(Math.max(0, (d.w || 1) - 1), { bt: d.bt, nb: d.nb, evo: d.evo }) },
    combat: () => { if (R && run.phase === 'build') startCombat(true) },
    cleared: () => { if (R && run.phase === 'combat') waveCleared(true) },
    over: k => gameOver(k || null, true),
    ready: () => { if (R && run.phase === 'build' && !guest()) startCombat() },
    timer: (bt, ph, w) => { if (!R || run.phase !== 'build' || ph !== 'build' || w !== run.wave) return; if (Math.abs(run.buildTime - bt) > 0.75) run.buildTime = bt },
    podDrop: (pos, kind) => { if (pod && R && run.phase !== 'over') pod.dropNow(pos, kind) },
    podTaken: (kind, amount, name) => {
      if (!pod || !R) return
      if (pod.state !== 'idle') { G.fx && G.fx.burst && G.fx.burst('podPickup', pod.pos, {}); pod.hide() }
      let text = name + ' recovered the supply pod'
      if (kind === 'biomass' || !['armor', 'core', 'barricade'].includes(kind)) { const got = run.earn(amount, 'pod'); if (got > 0) text += '  ·  +' + got + ' Biomass' }
      else if (!guest() && kind === 'core') { try { G.towers.healCore(amount) } catch (e) { /* none */ } }
      else if (!guest() && kind === 'barricade') { try { G.towers.repairAllBarricades() } catch (e) { /* none */ } }
      toast(text, 'info')
    },
    snapshot: () => (R ? { ph: run.phase, w: run.wave, bt: run.buildTime, wc: run.wavesCleared, nb: R.nextBoss, hive: run.hive, rem: R.spawner ? R.spawner.remaining : 0 } : null),
    get remaining() { return R && R.spawner ? R.spawner.remaining : 0 },
    get active() { return !!R && G.state === 'run' && run.phase !== 'over' },
  }

  // ================================================================== debug hooks (tests)
  run.debug = {
    speed: 1,
    state: () => ({
      state: G.state, phase: run.phase, wave: run.wave, wavesCleared: run.wavesCleared, best: visit.best, biomass: run.biomass, level: run.level, xp: run.xp, samples: run.samples,
      kills: run.kills, deaths: run.deaths, generation: run.hive.generation, resist: { ...run.hive.resist }, picks: run.hive.picks.map(p => p.id), buildTime: run.buildTime, held: run.held,
      left: R && R.spawner ? R.spawner.remaining : null, alive: aliveCount(), tutorial: tut.active ? tut.step + 1 : 0, pod: pod ? pod.state : null, podKind: pod && pod.contents ? pod.contents.kind : null,
      screens: { pause: S.pause, guide: !!S.guide, gear: S.gear ? S.gear.page : null, evo: !!S.evo, end: !!S.end }, nextBoss: R && R.nextBoss ? R.nextBoss.kind : null,
      loadout: SC.currentSlots(G, run), mods: { ...run.mods }, armory: { ...run.armory }, gear: { ...run.gear }, met: visit.met.slice(),
    }),
    /** jump to the build phase of `wave` (waves before it count as held) */
    skipTo: wave => {
      if (!R) return
      try { G.enemies.clear() } catch (e) { /* none */ }
      run.wavesCleared = Math.max(0, wave - 1)
      R.lastBonus = 0
      enterBuild(wave - 1)
    },
    startWave: () => startCombat(),
    killAll: (source = 'player') => {
      const E = G.enemies
      if (!E) return 0
      let n = 0
      for (const e of [...arr(E.list), ...arr(E.siegeNodes)]) if (e && e.alive) { try { E.damage(e, { amount: 1e7, type: 'Ballistic', source, sourceId: source === 'player' ? 'AR7' : 'Ballistic#6' }); n++ } catch (err) { /* none */ } }
      return n
    },
    evolveNow: () => (R ? evolveNow(run.wave, true) : null),
    forceGameOver: (killer = 'Crawler') => { if (R) { R.debrief.toCore[killer] = (R.debrief.toCore[killer] || 0) + 100; gameOver(killer) } },
    dropPod: (kind, at) => { if (pod) pod.dropNow(at || null, kind || null) },
    pod: () => pod,
    grantXp: n => run.addXp(n, 'debug'),
    grantSamples: n => run.addSamples(n, 'debug'),
    setBiomass: n => { run.biomass = n },
    feedDamage: (type, amount, source = 'player') => { if (R) { HV.addDamage(R.win, type, amount, source === 'tower'); HV.addDamage(R.totals, type, amount, source === 'tower') } },
    tutorial: () => tut,
    openGear: page => openGear(page),
    openGuide: k => openGuide(k),
    openPause: () => openPause(),
    endNow: () => { if (S.endAt > 0) S.endAt = G.rt || 0 },
    internals: () => ({ R, S, visit }),
  }
  return run
}
