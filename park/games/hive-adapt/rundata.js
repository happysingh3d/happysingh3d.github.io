// Hive Adapt (Project 0 port): RUN data tables (pure, no imports). Numbers are the Unity assets' (run-hive-economy.md,
// player-weapons.md §4, Data/Evolutions, Data/Progression, Defence/GearShop.cs, Defence/SupplyPod.cs, Data/Enemies fieldGuide).

/** Damage types: display name and UI colour (Data/DamageTypes) */
export const DAMAGE_TYPES = ['Ballistic', 'Energy', 'Explosive', 'Rail']
export const TYPE_COLOUR = { Ballistic: [1, 0.75, 0.35], Energy: [0.35, 0.8, 1], Explosive: [1, 0.45, 0.2], Rail: [0.6, 0.85, 1] }

/** The six weapons in Armory catalog order (Data/Weapons; ids as weapons.js uses them) */
export const WEAPONS = [
  { id: 'AR7', name: 'AR-7', type: 'Ballistic', unlock: 1 },
  { id: 'Plasma', name: 'PL-2 Plasma', type: 'Energy', unlock: 1 },
  { id: 'Shotgun', name: 'SG-12 Breacher', type: 'Ballistic', unlock: 3 },
  { id: 'SMG', name: 'VK-9 SMG', type: 'Ballistic', unlock: 5 },
  { id: 'Marksman', name: 'RX-3 Lancer', type: 'Rail', unlock: 8 },
  { id: 'Launcher', name: 'GL-40 Thumper', type: 'Explosive', unlock: 12 },
]
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]))
export const DEFAULT_LOADOUT = ['AR7', 'Plasma']

/** Progression.asset */
export const PROGRESSION = {
  maxLevel: 30, xpFirstLevel: 350, xpGrowth: 1.16, turretKillShare: 0.6, eliteXpMultiplier: 3, waveClearXp: 30, waveClearXpPerWave: 6,
  siegeNodeXp: 250, eliteSamples: 1, bossSamples: 5, siegeNodeSamples: 2,
  milestones: [{ wave: 10, title: 'Ten waves held', samples: 3, xp: 300 }, { wave: 20, title: 'Twenty waves held', samples: 5, xp: 600 }, { wave: 30, title: 'Thirty waves held', samples: 8, xp: 1000 }],
}

/**
 * The 12 Armory upgrades in catalog order (HiveBuilder.Progression.cs). mod = the RunModifiers key it adds to.
 * Web: bought inside the run with Hive Samples at the gear locker; Seed Biomass and Plate Carrier pay out at once.
 */
export const ARMORY = [
  { id: 'hardened_rounds', name: 'Hardened Rounds', desc: '+{0} weapon damage', mod: 'weaponDamage', per: 0.06, pct: true, unlock: 1, costs: [2, 3, 5, 7, 10] },
  { id: 'field_medic', name: 'Field Medic', desc: '+{0} max health', mod: 'maxHp', per: 15, pct: false, unlock: 1, costs: [2, 3, 5, 7] },
  { id: 'seed_biomass', name: 'Seed Biomass', desc: '+{0} Biomass now', mod: 'startBiomass', per: 40, pct: false, unlock: 1, costs: [1, 2, 3, 5, 7] },
  { id: 'extended_mags', name: 'Extended Mags', desc: '+{0} magazine size', mod: 'magazine', per: 0.12, pct: true, unlock: 2, costs: [2, 4, 6] },
  { id: 'quick_hands', name: 'Quick Hands', desc: '+{0} reload speed', mod: 'reload', per: 0.1, pct: true, unlock: 2, costs: [2, 4, 6] },
  { id: 'turret_calibration', name: 'Turret Calibration', desc: '+{0} turret damage', mod: 'turretDamage', per: 0.08, pct: true, unlock: 3, costs: [2, 3, 5, 7, 10] },
  { id: 'endurance', name: 'Endurance Training', desc: '+{0} stamina', mod: 'maxStamina', per: 0.15, pct: true, unlock: 3, costs: [2, 3, 5] },
  { id: 'plate_carrier', name: 'Plate Carrier', desc: '+{0} armor now', mod: 'armorStart', per: 25, pct: false, unlock: 4, costs: [3, 5, 7] },
  { id: 'reinforced_barricades', name: 'Reinforced Barricades', desc: '+{0} barricade health', mod: 'barricadeHp', per: 0.15, pct: true, unlock: 5, costs: [2, 4, 6] },
  { id: 'shield_capacitors', name: 'Shield Capacitors', desc: '+{0} Core Shield capacity', mod: 'shieldCapacity', per: 0.12, pct: true, unlock: 6, costs: [3, 5, 8] },
  { id: 'salvage_rights', name: 'Salvage Rights', desc: '+{0} Biomass from kills', mod: 'biomassGain', per: 0.07, pct: true, unlock: 7, costs: [3, 5, 8] },
  { id: 'sample_extraction', name: 'Sample Extraction', desc: '+{0} Hive Samples found', mod: 'sampleFind', per: 0.25, pct: true, unlock: 9, costs: [5, 9] },
]

/** RunModifiers (Armory + queen rewards): fractions add to 1 where they scale, flat values add */
export function baseMods() {
  return { weaponDamage: 0, magazine: 0, reload: 0, turretDamage: 0, maxStamina: 0, maxHp: 0, armorStart: 0, barricadeHp: 0, shieldCapacity: 0, biomassGain: 0, sampleFind: 0, startBiomass: 0 }
}

/** Gear locker run items (GearShop.cs) */
export const GEAR = [
  { id: 'speed', name: 'Speed boots', desc: '+12% move and sprint speed', cost: 90, icon: 'arrow' },
  { id: 'plating', name: 'Armor plating', desc: 'Take 20% less damage', cost: 110, icon: 'armor' },
  { id: 'stamina', name: 'Stamina pack', desc: '+40 stamina, 30% faster recovery', cost: 80, icon: 'stamina' },
]

/** Run_Endless economy (RunManager / RunConfig) */
export const RUN = { startingBiomass: 150, coreMaxHealth: 1800, respawnSeconds: 10, waveBonusBase: 50, waveBonusPerWave: 10 }

/** Supply pod (SupplyPod.cs) */
export const POD = {
  firstWave: 2, dropDelay: 7, fallTime: 2.6, fallHeight: 70, lifetime: 35, pickupRadius: 2.2, minRadius: 28, maxRadius: 40, avoidYaws: [-40, 48], avoidDegrees: 18,
  rewards: [
    { kind: 'biomass', label: 'Biomass', weight: 3, base: 60, perWave: 15, firstWave: 2, colour: [184, 255, 61], icon: 'biomass' },
    { kind: 'armor', label: 'Armor', weight: 2, base: 60, perWave: 0, firstWave: 2, colour: [214, 224, 235], icon: 'armor' },
    { kind: 'core', label: 'Core patch', weight: 1.5, base: 120, perWave: 10, firstWave: 3, colour: [84, 219, 255], icon: 'repair' },
    { kind: 'barricade', label: 'Barricade repair', weight: 1.2, base: 0, perWave: 0, firstWave: 3, colour: [255, 181, 71], icon: 'barricade' },
  ],
}

/** The Hive guide roster (HiveGuide.roster order) with the field-guide / guide texts (Data/Enemies/*.asset) */
export const ROSTER = ['Crawler', 'Flyer', 'Rammer', 'Spitter', 'Leech', 'Burrower', 'SiegeNode', 'BroodMother', 'ArmoredMatriarch', 'BurrowQueen', 'SkyQueen']
export const FIELD_GUIDE = {
  ArmoredMatriarch: 'Six armour shells soak your fire. Shoot them off to bare the glowing sacs; stripped bare she charges, so step off the ringed line.',
  BurrowQueen: 'Tunnels to the far gate, then inside the walls. Ground rings mark where she will surface; shoot her glowing gills while they are open.',
  Burrower: 'Digs under your barricades and comes up inside the walls. Watch for the cracking ground and be there when it surfaces.',
  BroodMother: 'The first queen. Armoured until half health, then her plates open on glowing sacs and Crawlers come to her.',
  Leech: 'Jumps onto a turret and jams it while it feeds. Shoot it off yourself; the turret cannot shoot what is on it.',
  Rammer: 'Charges barricades and turrets head-down. Get out of its line, then shoot the glowing hump on its back while it recovers.',
  SiegeNode: 'Grows out of the plain and shells the outpost from range. Leave the walls and burst its glowing sac before it fires again.',
  SkyQueen: 'Flies over the walls dropping Leeches on marked rings. Enraged, she dives on the ring under you: move off it and shoot her brood sac.',
  Spitter: 'Stalks just outside turret range and lobs acid at your turrets. Hunt it down; its acid sac is the weak point.',
}
export const GUIDE_TEXT = {
  Crawler: 'Comes in numbers straight for the Core. Your turrets do most of the work: keep the pads built and repaired, and thin the pack at the gates.',
  Flyer: 'Flies over the walls and spits at the Core. Fragile: shoot it down before it gets inside, and keep a turret near the Core.',
}
export const GOES_FOR = {
  Crawler: 'the Core', Flyer: 'the Core, over the walls', Rammer: 'barricades, gates and turrets', Spitter: 'your turrets and you, from range',
  Leech: "your turrets and the Core's shield", Burrower: 'the inside of the walls, from under them', SiegeNode: 'the outpost, shelled from the plain',
}
export const JUMP_PAD_HINT = { id: 'hint.jumppad', kicker: 'Field guide  ·  jump pad', title: 'Jump pad', body: 'Step onto the glowing amber pad to launch up onto the wall walk. Pads out here on the plain bring you back up.' }

/** Tutorial steps (TutorialController.cs) */
export const TUTORIAL = [
  { title: 'Move', keys: ['W', 'A', 'S', 'D'], touchKeys: ['Stick'], body: 'Move around. Hold S to walk backwards while you keep aiming.', touchBody: 'Move around with the stick on the left of the screen.' },
  { title: 'Shoot', keys: ['LMB', 'RMB'], touchKeys: ['FIRE'], body: 'Fire with the left mouse button. Hold the right button to aim.', touchBody: 'Hold FIRE to shoot. AIM toggles aiming down the sights.' },
  { title: 'Jump', keys: ['Space'], touchKeys: ['JUMP'], body: 'Jump over low cover.' },
  { title: 'Dodge', keys: ['C'], touchKeys: ['DODGE'], body: "Dodge roll. You can't be hurt mid-roll, and it costs stamina." },
  { title: 'Weapons', keys: ['1', '2'], touchKeys: ['Tap'], body: 'Swap your two loadout weapons with 1, 2 or the wheel. Choose the pair at the gear locker.', touchBody: 'Tap the weapon panel to swap your two loadout weapons. Choose the pair at the gear locker.' },
  { title: 'Build a turret', keys: ['E'], body: 'Walk to a glowing pad and build a Ballistic Turret.' },
  { title: 'Barricades', keys: ['E'], body: 'Walk to a gate or causeway slot. A barricade holds the bugs until they break it.' },
  { title: 'Core Shield', keys: ['Q'], body: 'At the Core, Q buys the Core Shield. It absorbs hits first and recharges after every wave.' },
  { title: 'Gear locker', keys: ['B'], touchKeys: ['Tap'], body: 'Open the gear locker between waves: speed boots, armor plating, a stamina pack.', touchBody: 'Tap the gear locker bar between waves: speed boots, armor plating, a stamina pack.' },
  { title: 'Jump pads', keys: ['Walk'], body: 'Step on an amber jump pad to land on the walls. Pads outside bring you back up.' },
  { title: 'Start the wave', keys: ['G'], touchKeys: ['Tap'], body: 'Start the first wave. Each new kind of bug gets a field-guide card when it shows up.', touchBody: 'Tap the build bar to start the first wave. Each new kind of bug gets a field-guide card when it shows up.' },
]

/** Controls list for the title and pause screens on the web (P pauses: Esc belongs to the platform) */
export const CONTROLS = [
  [['W', 'A', 'S', 'D'], 'Move'], [['Mouse'], 'Look'], [['LMB'], 'Fire'], [['RMB'], 'Aim'], [['Shift'], 'Sprint'], [['Space'], 'Jump'], [['C'], 'Dodge roll'],
  [['R'], 'Reload'], [['1', '2'], 'Swap weapon'], [['E'], 'Build · upgrade · repair'], [['Q'], 'Other tower · Shield'], [['G'], 'Start the wave'],
  [['B'], 'Gear locker · Armory'], [['H'], 'Hive guide'], [['P'], 'Pause'],
]

/** Kill streak labels (CombatFeedback.cs) */
export function streakLabel(n) {
  const L = ['', '', 'Double kill', 'Triple kill', 'Multi kill', 'Rampage', 'Rampage', 'Rampage', 'Swarm breaker']
  return n < L.length ? L[n] : n >= 20 ? 'Exterminator' : n >= 12 ? 'Hive hunter' : 'Swarm breaker'
}

/** UI colours (UiKit.cs, sRGB 0-1) */
export const UI = {
  text: [0.949, 0.929, 0.89], dim: [0.722, 0.78, 0.831], amber: [1, 0.71, 0.278], inter: [1, 0.69, 0], cyan: [0.329, 0.859, 1], danger: [1, 0.29, 0.18],
  lime: [0.722, 1, 0.239], hive: [1, 0.36, 0.2], sample: [0.78, 0.6, 1], siege: [1, 0.38, 0.26], steel: [0.84, 0.88, 0.92], siegeGuide: [0.92, 0.36, 0.3],
}
