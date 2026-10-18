// Hive Adapt (Project 0 port): enemy data tables.
// Numbers are LOCKED by the game's owner (enemies.md §2, Data/Enemies/*.asset): keep them exact.
// Positions inside models are model-local (+Z forward, +Y up, origin at the feet), metres.

const ELITE = { eliteHealthScale: 2.5, eliteDamageScale: 1.3, eliteSizeScale: 1.12, eliteGlow: [6, 4.2, 1.2], eliteRim: [1, 0.72, 0.28] }

const sfx = (stem, n) => (n ? Array.from({ length: n }, (_, i) => stem + i) : [stem])
const BUG_HURT = sfx('sfx_bug_hurt_', 4)

// BugAnimator defaults (BugAnimator.cs:32-50)
export const GAIT_DEFAULT = { stepHeight: 0.16, baseStepDuration: 0.16, stepThreshold: 0.3, strideLead: 0.6, bodyBob: 0.035, leanPerAccel: 1.4, maxLean: 12, turnLean: 0.035, wingFreq: 22, wingAmp: 45, hoverBob: 0.12 }
const GAIT_BOSS = { stepHeight: 0.5, baseStepDuration: 0.34, stepThreshold: 0.9, bodyBob: 0.08 }

/** Chitin material values (HiveBuilder.Art.cs:302-308, Roles.cs:30-42, Bosses.cs:41-53, Siege.cs:32-35) */
export const MATS = {
  Crawler: { base: [0.15, 0.11, 0.08], emis: [4.5, 1.2, 0.2], sss: [0.95, 0.35, 0.08], smooth: 0.74, smoothVar: 0.35, sssStrength: 0.6 },
  Flyer: { base: [0.1, 0.13, 0.09], emis: [1.6, 4.2, 0.6], sss: [0.5, 0.9, 0.2], smooth: 0.74, smoothVar: 0.35, sssStrength: 0.6 },
  Wing: { base: [0.55, 0.62, 0.5], emis: [0.6, 1.6, 0.3], sss: [0.6, 1, 0.4], smooth: 0.92, smoothVar: 0.35, sssStrength: 2.5, wing: true },
  Rammer: { base: [0.36, 0.27, 0.17], emis: [6, 2.1, 0.35], sss: [0.9, 0.45, 0.12], smooth: 0.5, smoothVar: 0.45, sssStrength: 0.6 },
  Spitter: { base: [0.25, 0.3, 0.16], emis: [2.2, 6, 0.45], sss: [0.6, 1, 0.22], smooth: 0.74, smoothVar: 0.35, sssStrength: 0.9 },
  Leech: { base: [0.13, 0.07, 0.17], emis: [0.35, 3.4, 5.6], sss: [0.55, 0.25, 0.9], smooth: 0.88, smoothVar: 0.35, sssStrength: 0.6 },
  Burrower: { base: [0.24, 0.14, 0.08], emis: [5, 1.3, 0.12], sss: [0.75, 0.3, 0.1], smooth: 0.42, smoothVar: 0.5, sssStrength: 0.6 },
  BroodMother: { base: [0.13, 0.07, 0.06], emis: [6, 1.1, 0.15], sss: [1, 0.25, 0.05], smooth: 0.74, smoothVar: 0.35, sssStrength: 0.6 },
  ArmoredMatriarch: { base: [0.16, 0.16, 0.17], emis: [6.5, 4.2, 1.6], sss: [1, 0.72, 0.35], smooth: 0.6, smoothVar: 0.5, sssStrength: 0.6 },
  BurrowQueen: { base: [0.27, 0.13, 0.06], emis: [6, 1.5, 0.12], sss: [0.9, 0.32, 0.08], smooth: 0.4, smoothVar: 0.55, sssStrength: 0.6 },
  SkyQueen: { base: [0.09, 0.07, 0.13], emis: [0.9, 3.8, 6.5], sss: [0.45, 0.55, 1], smooth: 0.86, smoothVar: 0.35, sssStrength: 0.6 },
  SkyQueenWing: { base: [0.4, 0.4, 0.55], emis: [0.7, 2.4, 4.8], sss: [0.55, 0.75, 1], smooth: 0.94, smoothVar: 0.35, sssStrength: 2.8, wing: true },
  SiegeNode: { base: [0.2, 0.08, 0.08], emis: [5, 1.35, 0.3], sss: [1, 0.3, 0.16], smooth: 0.72, smoothVar: 0.35, sssStrength: 1.1, pulseSpeed: 1.6 },
}

/**
 * Per-kind data (Data/Enemies/*.asset). Fields keep the Unity names so the run loop can read
 * biomassReward / xpReward / eliteRewardScale straight off enemy.data.
 */
export const KINDS = {
  Crawler: {
    id: 'Crawler', displayName: 'Crawler', model: 'SK_Crawler', role: null,
    maxHealth: 60, moveSpeed: 3.6, attackDamage: 8, attackInterval: 1.2, attackRange: 1.4, windupSeconds: 0.32, playerAggroRange: 4,
    acceleration: 18, angularSpeed: 600, bodyRadius: 0.7, isFlying: false, hoverHeight: 0, climbChance: 0.35,
    projectile: null, corpseSeconds: 2, hitReactionScale: 1, staggerTaken: 1, weakTo: null, weakToScale: 1,
    biomassReward: 10, xpReward: 10, eliteRewardScale: 4, samples: 0, animScale: 0.8, flashScale: 1,
    gait: {}, sounds: { attack: sfx('sfx_bug_attack_', 3), hurt: BUG_HURT, death: sfx('sfx_bug_death_', 3) }, ...ELITE,
  },
  Flyer: {
    id: 'Flyer', displayName: 'Flyer', model: 'SK_Flyer', role: null,
    maxHealth: 35, moveSpeed: 5, attackDamage: 6, attackInterval: 1.7, attackRange: 9, windupSeconds: 0.4, playerAggroRange: 6,
    acceleration: 12, angularSpeed: 360, bodyRadius: 0.45, isFlying: true, hoverHeight: 2.4, climbChance: 0,
    projectile: 'acid', projectileSpeed: 16, corpseSeconds: 2, hitReactionScale: 1.3, staggerTaken: 1, weakTo: null, weakToScale: 1,
    biomassReward: 12, xpReward: 12, eliteRewardScale: 4, samples: 0, animScale: 1, flashScale: 1,
    gait: { flying: true }, sounds: { attack: ['sfx_flyer_spit_0'], hurt: BUG_HURT, death: sfx('sfx_bug_death_', 3) }, ...ELITE,
  },
  Rammer: {
    id: 'Rammer', displayName: 'Rammer', model: 'SK_Rammer', role: 'Rammer',
    maxHealth: 900, moveSpeed: 2.6, attackDamage: 38, attackInterval: 2, attackRange: 1.8, windupSeconds: 0.6, playerAggroRange: 3.5,
    acceleration: 8, angularSpeed: 220, bodyRadius: 1.15, isFlying: false, hoverHeight: 0, climbChance: 0,
    projectile: null, corpseSeconds: 3.5, hitReactionScale: 0.45, staggerTaken: 0.35, weakTo: 'Explosive', weakToScale: 1.6,
    biomassReward: 45, xpReward: 60, eliteRewardScale: 4, samples: 0, animScale: 1.9, flashScale: 0.6,
    chargeRange: 14, chargeSpeed: 11, chargeDamage: 260, chargeWindup: 0.9, chargeCooldown: 7,
    armor: { reduction: 0.6, plateHealth: 300, frontOnly: true, frontDot: -0.25, breakPlateScale: 4, breakBypass: 0.6, bypassType: 'Explosive' },
    weak: [{ bone: 'WeakPoint_0', r: 0.42, open: true }],
    gait: { stepHeight: 0.2, baseStepDuration: 0.22, stepThreshold: 0.45, bodyBob: 0.05 },
    sounds: { attack: sfx('sfx_rammer_attack_', 2), hurt: sfx('sfx_rammer_hurt_', 2), death: ['sfx_rammer_death_0'] }, ...ELITE,
  },
  Spitter: {
    id: 'Spitter', displayName: 'Spitter', model: 'SK_Spitter', role: 'Spitter',
    maxHealth: 150, moveSpeed: 3, attackDamage: 22, attackInterval: 2.8, attackRange: 18, windupSeconds: 0.75, playerAggroRange: 0,
    acceleration: 14, angularSpeed: 360, bodyRadius: 0.65, isFlying: false, hoverHeight: 0, climbChance: 0,
    projectile: 'lob', projectileSpeed: 17, lobProjectile: true, corpseSeconds: 2.2, hitReactionScale: 1, staggerTaken: 1, weakTo: 'Rail', weakToScale: 1.5,
    biomassReward: 22, xpReward: 25, eliteRewardScale: 4, samples: 0, animScale: 1.3, flashScale: 1,
    preferredRange: 16, minRange: 9, turretScanRange: 24,
    // the acid sac: 0.44 m behind the nozzle base (HiveBuilder.Roles.cs:308-319); muzzle 0.16 m ahead of the nozzle
    weak: [{ pos: [0, 2.08, -0.08], r: 0.3, open: true }], mouth: [0, 2.08, 0.52],
    gait: { stepHeight: 0.26, baseStepDuration: 0.2, stepThreshold: 0.5 },
    sounds: { attack: sfx('sfx_spitter_spit_', 2), hurt: sfx('sfx_spitter_hurt_', 2), death: ['sfx_spitter_death_0'] }, ...ELITE,
  },
  Leech: {
    id: 'Leech', displayName: 'Leech', model: 'SK_Leech', role: 'Leech',
    maxHealth: 28, moveSpeed: 5.2, attackDamage: 5, attackInterval: 0.9, attackRange: 1, windupSeconds: 0.15, playerAggroRange: 2.5,
    acceleration: 30, angularSpeed: 720, bodyRadius: 0.35, isFlying: false, hoverHeight: 0, climbChance: 0.7,
    projectile: null, corpseSeconds: 1.5, hitReactionScale: 1.4, staggerTaken: 1, weakTo: null, weakToScale: 1,
    biomassReward: 8, xpReward: 8, eliteRewardScale: 4, samples: 0, animScale: 0.55, flashScale: 1,
    drainPerSecond: 12, shieldDrain: 2.5, leapRange: 7, turretPreference: 0.65, maxLeechesPerTurret: 3,
    gait: {}, sounds: { attack: sfx('sfx_leech_latch_', 2), hurt: sfx('sfx_leech_hurt_', 2), death: sfx('sfx_leech_death_', 2) }, ...ELITE,
  },
  Burrower: {
    id: 'Burrower', displayName: 'Burrower', model: 'SK_Burrower', role: 'Burrower',
    maxHealth: 220, moveSpeed: 3.4, attackDamage: 16, attackInterval: 1.3, attackRange: 1.6, windupSeconds: 0.4, playerAggroRange: 5,
    acceleration: 16, angularSpeed: 480, bodyRadius: 0.8, isFlying: false, hoverHeight: 0, climbChance: 0,
    projectile: null, corpseSeconds: 2.5, hitReactionScale: 0.8, staggerTaken: 0.8, weakTo: null, weakToScale: 1,
    biomassReward: 25, xpReward: 30, eliteRewardScale: 4, samples: 0, animScale: 1.2, flashScale: 1,
    approachSeconds: 3, digSeconds: 1.2, undergroundSpeed: 7, telegraphSeconds: 2.2, surfaceMinRadius: 7, surfaceMaxRadius: 14, emergeDamage: 18,
    gait: { stepHeight: 0.18, baseStepDuration: 0.18 },
    sounds: { attack: sfx('sfx_burrower_attack_', 2), hurt: sfx('sfx_burrower_hurt_', 2), death: ['sfx_burrower_death_0'] }, ...ELITE,
  },
  // ------------------------------------------------------------------ queens (HiveBoss.asset, ArmoredMatriarch/BurrowQueen/SkyQueen.asset)
  BroodMother: {
    id: 'BroodMother', displayName: 'Brood Mother', model: 'SK_HiveBoss', role: 'BroodMother', isBoss: true,
    maxHealth: 5500, moveSpeed: 2.3, attackDamage: 70, attackInterval: 2.4, attackRange: 3.8, windupSeconds: 0.85, playerAggroRange: 7,
    acceleration: 6, angularSpeed: 120, bodyRadius: 1.9, isFlying: false, hoverHeight: 0, climbChance: 0,
    projectile: null, corpseSeconds: 6, hitReactionScale: 0.25, staggerTaken: 1, weakTo: null, weakToScale: 1,
    biomassReward: 400, xpReward: 400, eliteRewardScale: 3, samples: 5, animScale: 3.4, flashScale: 0.35,
    weak: [{ bone: 'WeakPoint_0', r: 0.62 }, { bone: 'WeakPoint_1', r: 0.62 }, { bone: 'WeakPoint_2', r: 0.62 }],
    gait: GAIT_BOSS, glowLight: [1, 0.35, 0.08],
    sounds: { attack: ['sfx_boss_slam'], hurt: BUG_HURT, death: ['sfx_boss_roar'], roar: ['sfx_boss_roar'], cue: [] }, ...ELITE,
  },
  ArmoredMatriarch: {
    id: 'ArmoredMatriarch', displayName: 'Armored Matriarch', model: 'SK_ArmoredMatriarch', role: 'Matriarch', isBoss: true,
    maxHealth: 5000, moveSpeed: 2.1, attackDamage: 80, attackInterval: 2.6, attackRange: 4.2, windupSeconds: 0.95, playerAggroRange: 7,
    acceleration: 6, angularSpeed: 100, bodyRadius: 2.2, isFlying: false, hoverHeight: 0, climbChance: 0,
    projectile: null, corpseSeconds: 6, hitReactionScale: 0.2, staggerTaken: 0, weakTo: 'Explosive', weakToScale: 1.35,
    biomassReward: 450, xpReward: 500, eliteRewardScale: 3, samples: 5, animScale: 3.5, flashScale: 0.3,
    weak: [0, 1, 2, 3, 4, 5].map(i => ({ bone: 'WeakPoint_' + i, r: 0.62 })), shells: [0, 1, 2, 3, 4, 5].map(i => ({ bone: 'Shell_' + i, r: 0.8 })),
    gait: { stepHeight: 0.45, baseStepDuration: 0.36, stepThreshold: 0.95, bodyBob: 0.06 }, glowLight: [1, 0.72, 0.4],
    sounds: { attack: ['sfx_boss_slam'], hurt: BUG_HURT, death: ['sfx_queen_matriarch_roar'], roar: ['sfx_queen_matriarch_roar'], cue: sfx('sfx_queen_matriarch_charge_', 2) }, ...ELITE,
  },
  BurrowQueen: {
    id: 'BurrowQueen', displayName: 'Burrow Queen', model: 'SK_BurrowQueen', role: 'BurrowQueen', isBoss: true,
    maxHealth: 5200, moveSpeed: 2.7, attackDamage: 70, attackInterval: 2.2, attackRange: 4.4, windupSeconds: 0.8, playerAggroRange: 7,
    acceleration: 7, angularSpeed: 140, bodyRadius: 2, isFlying: false, hoverHeight: 0, climbChance: 0,
    projectile: null, corpseSeconds: 6, hitReactionScale: 0.2, staggerTaken: 0, weakTo: null, weakToScale: 1,
    biomassReward: 450, xpReward: 500, eliteRewardScale: 3, samples: 5, animScale: 3, flashScale: 0.35,
    weak: [0, 1, 2, 3].map(i => ({ bone: 'WeakPoint_' + i, r: 0.62 })),
    gait: { stepHeight: 0.38, baseStepDuration: 0.26, stepThreshold: 0.8, bodyBob: 0.05 }, glowLight: [1, 0.4, 0.1],
    sounds: { attack: ['sfx_boss_slam'], hurt: BUG_HURT, death: ['sfx_queen_burrow_roar'], roar: ['sfx_queen_burrow_roar'], cue: sfx('sfx_queen_burrow_cue_', 2) }, ...ELITE,
  },
  SkyQueen: {
    id: 'SkyQueen', displayName: 'Sky Queen', model: 'SK_SkyQueen', role: 'SkyQueen', isBoss: true,
    maxHealth: 3600, moveSpeed: 4.4, attackDamage: 18, attackInterval: 1.5, attackRange: 16, windupSeconds: 0.45, playerAggroRange: 24,
    acceleration: 6, angularSpeed: 160, bodyRadius: 1.6, isFlying: true, hoverHeight: 8, climbChance: 0,
    projectile: 'acid', projectileSpeed: 18, corpseSeconds: 6, hitReactionScale: 0.2, staggerTaken: 0, weakTo: 'Rail', weakToScale: 1.35,
    biomassReward: 450, xpReward: 500, eliteRewardScale: 3, samples: 5, animScale: 2.6, flashScale: 0.4,
    weak: [0, 1, 2].map(i => ({ bone: 'WeakPoint_' + i, r: 0.62 })),
    // two capsules (HiveBuilder.Bosses.cs:341-342): thorax and the abdomen pitched -19 degrees
    capsules: [{ r: 0.676, h: 2.47, c: [0, 0.104, 0.312], pitch: 0 }, { r: 0.52, h: 3.12, c: [0, -0.52, -2.132], pitch: -19 }],
    gait: { flying: true }, glowLight: [0.45, 0.85, 1],
    sounds: { attack: ['sfx_flyer_spit_0'], hurt: BUG_HURT, death: ['sfx_queen_sky_screech'], roar: ['sfx_queen_sky_screech'], cue: sfx('sfx_queen_sky_cue_', 2) }, ...ELITE,
  },
  // the Siege Node is not on the live list (turrets never target it); enemies.siegeNodes holds it
  SiegeNode: {
    id: 'SiegeNode', displayName: 'Siege Node', model: 'SM_SiegeNode', role: 'SiegeNode', isSiege: true,
    maxHealth: 1400, moveSpeed: 0, attackDamage: 70, attackInterval: 7, attackRange: 80, windupSeconds: 0.8, playerAggroRange: 0,
    bodyRadius: 2.4, corpseSeconds: 2.2, hitReactionScale: 0, staggerTaken: 0, weakTo: 'Explosive', weakToScale: 2.2, attackDamageType: 'Explosive',
    // XP 250 comes from Progression siegeNodeXp (the asset's xpReward 120 is never used)
    biomassReward: 250, xpReward: 250, eliteRewardScale: 3, samples: 2, flashScale: 1,
    firstWave: 6, healthPerWave: 0.08, damagePerWave: 0.05, growSeconds: 4.5, firstShotDelay: 2.5, fireInterval: 7, shellSpeed: 34, scatter: 1.6,
    barricadeChance: 0.45, minRadius: 46, maxRadius: 60, avoidYaws: [-40, 48], avoidDegrees: 16,
    sounds: { attack: sfx('sfx_siege_fire_', 2), hurt: sfx('sfx_siege_hurt_', 2), death: ['sfx_siege_death_0'], grow: sfx('sfx_siege_grow_', 2), alarm: ['sfx_siege_alarm'] },
  },
}
for (const k in KINDS) { const d = KINDS[k]; d.attackDamageType = d.attackDamageType || 'Ballistic'; d.mat = MATS[k] }
KINDS.Flyer.wingMat = MATS.Wing
KINDS.SkyQueen.wingMat = MATS.SkyQueenWing

/** Projectile prefabs (enemies.md §1.6) */
export const PROJECTILES = {
  acid: { radius: 0.16, gravity: 9, life: 3, splash: 0, splashScale: 0, colour: [0.55, 1, 0.2], sound: ['sfx_acid_impact_0'], fx: 'acidImpact', decal: null },
  lob: { radius: 0.2, gravity: 14, life: 5, splash: 1.9, splashScale: 0.6, colour: [0.6, 1, 0.15], sound: ['sfx_acid_splash_0', 'sfx_acid_splash_1'], fx: 'acidSplash', decal: 'acid', decalLife: 12 },
  shell: { radius: 0.35, gravity: 14, life: 9, splash: 4, splashScale: 1, colour: [1, 0.4, 0.15], sound: ['sfx_siege_impact_0', 'sfx_siege_impact_1'], fx: 'siegeImpact', decal: 'scorch', decalLife: 14 },
}

/** Boss profiles (Data/Bosses/BS_*.asset, BossCatalog.asset) — catalog order matters for the rotation */
export const QUEENS = {
  BroodMother: {
    kind: 'BroodMother', id: 'brood_mother', title: 'The Brood Mother', awakenLine: 'Her plates open at half health', uiColor: [1, 0.5, 0.2],
    description: 'The first queen. Armoured until half health, then her plates open on glowing sacs and her brood comes to her.',
    phases: [{ startsAt: 1, label: 'Armoured' }, { startsAt: 0.5, label: 'Weak points exposed  ·  double damage', banner: 'Weak points exposed', bannerSub: 'Shoot the glowing sacs for double damage' }],
    answers: ['thickened_hide', 'pack_mind'], slamRadius: 4.5, slamPlayerDamage: 30, telegraphSeconds: 1.6, minionsPerAppearance: 1,
    reward: { kind: 0, amount: 0.1, biomass: 100, bonusSamples: 0, title: 'Brood Ichor', text: '+10% weapon damage for the rest of the run' },
  },
  ArmoredMatriarch: {
    kind: 'ArmoredMatriarch', id: 'armored_matriarch', title: 'The Armored Matriarch', awakenLine: 'Shoot her shells off', uiColor: [0.72, 0.8, 0.95],
    description: 'Six steel shells cover the sacs on her back and shrug off two thirds of the damage to her body. Every shell shot off exposes a weak point and lets more through. Stripped or wounded she charges down a marked line.',
    phases: [{ startsAt: 1, label: 'Shelled  ·  shoot the shells off' }, { startsAt: 0.45, label: 'Enraged  ·  charging', banner: 'The Matriarch is enraged', bannerSub: 'She charges down the marked line, get out of it' }],
    answers: ['hardened_plating', 'blast_damped_shell', 'conductive_carapace'], slamRadius: 5, slamPlayerDamage: 34, telegraphSeconds: 1.6, minionsPerAppearance: 1,
    shellHealth: 380, shelledBodyDamage: 0.35, chargeInterval: 9, chargeSpeed: 15, chargeDistance: 18, chargeDamage: 45,
    reward: { kind: 1, amount: 0.25, biomass: 120, bonusSamples: 2, title: 'Matriarch Plating', text: 'Core Shield +1 level (or +25% capacity), fully charged' },
  },
  BurrowQueen: {
    kind: 'BurrowQueen', id: 'burrow_queen', title: 'The Burrow Queen', awakenLine: 'She tunnels between the gates', uiColor: [1, 0.55, 0.22],
    description: 'She dives underground and comes up at the other gate, then inside the walls. Cracks and a ring mark where she surfaces; her gill vents open for a few seconds after.',
    phases: [{ startsAt: 1, label: 'Coming for the gates' }, { startsAt: 0.7, label: 'Tunnelling between the gates', banner: 'The Burrow Queen dives', bannerSub: 'Cracks mark where she comes up' }, { startsAt: 0.4, label: 'Inside the walls  ·  frenzy', banner: 'She is under the walls', bannerSub: 'Watch the yard, she surfaces inside' }],
    answers: ['tunnel_brood', 'battering_brood'], slamRadius: 4.8, slamPlayerDamage: 32, telegraphSeconds: 2.4, minionsPerAppearance: 1,
    burrowAfterSeconds: 26, undergroundSpeed: 9, emergeRadius: 4.5, emergeDamage: 40, emergeMinion: 'Burrower', emergeMinions: 2,
    reward: { kind: 2, amount: 0.25, biomass: 200, bonusSamples: 2, title: "Queen's Hoard", text: '+200 Biomass, every barricade rebuilt, +25% barricade integrity' },
  },
  SkyQueen: {
    kind: 'SkyQueen', id: 'sky_queen', title: 'The Sky Queen', awakenLine: 'She drops Leeches from the air', uiColor: [0.5, 0.78, 1],
    description: 'She circles out of reach of the walls, spitting acid and dropping Leeches onto your turrets. At half health her brood sac opens and she dives at you: move when the ring under you fills.',
    phases: [{ startsAt: 1, label: 'Airborne  ·  Leech drops' }, { startsAt: 0.5, label: 'Brood sac exposed  ·  diving', banner: 'The Sky Queen dives', bannerSub: 'Her brood sac is open, move when the ring fills' }],
    answers: ['siege_organs', 'parasite_bloom', 'swift_swarm'], slamRadius: 4.5, slamPlayerDamage: 30, telegraphSeconds: 1.6, minionsPerAppearance: 1,
    broodMinion: 'Leech', broodPerDrop: 2, broodInterval: 9, broodIntervalEnraged: 6, diveInterval: 10, diveRadius: 3.5, diveDamage: 35,
    reward: { kind: 3, amount: 0.15, biomass: 120, bonusSamples: 2, title: 'Sky Queen Venom', text: '+15% turret damage for the rest of the run' },
  },
}
export const QUEEN_ORDER = ['BroodMother', 'ArmoredMatriarch', 'BurrowQueen', 'SkyQueen']

/** Evolution display names and looks (run-hive-economy.md §3.4) */
export const EVOLUTIONS = {
  conductive_carapace: { name: 'Conductive Carapace', tint: [0.82, 0.88, 1.12], plates: 0.08, plateColor: [0.26, 0.33, 0.46], glow: [0.7, 1.9, 5.5], glowMix: 0.65, size: 1, siege: 1 },
  hardened_plating: { name: 'Hardened Plating', tint: [0.88, 0.88, 0.93], plates: 0.42, plateColor: [0.46, 0.48, 0.52], glowMix: 0, size: 1, siege: 1 },
  blast_damped_shell: { name: 'Blast-Damped Shell', tint: [0.72, 0.7, 0.68], plates: 0.3, plateColor: [0.5, 0.41, 0.29], glowMix: 0, size: 1.04, siege: 1 },
  parasite_bloom: { name: 'Parasite Bloom', tint: [0.95, 1.02, 0.86], plates: 0, glow: [2.4, 4.2, 0.5], glowMix: 0.55, size: 1, siege: 1 },
  swift_swarm: { name: 'Swift Swarm', tint: [1.12, 0.86, 0.8], plates: 0, glow: [6, 0.9, 0.5], glowMix: 0.35, size: 0.96, siege: 1 },
  siege_organs: { name: 'Siege Organs', tint: [1, 1, 1], plates: 0, glow: [7, 1.4, 0.25], glowMix: 0.3, size: 1, siege: 2.5 },
  tunnel_brood: { name: 'Tunnel Brood', tint: [1, 0.88, 0.72], plates: 0.12, plateColor: [0.46, 0.27, 0.15], glowMix: 0, size: 1, siege: 1 },
  battering_brood: { name: 'Battering Brood', tint: [0.9, 0.84, 0.82], plates: 0.22, plateColor: [0.56, 0.5, 0.4], glowMix: 0, size: 1, siege: 1 },
  thickened_hide: { name: 'Thickened Hide', tint: [0.86, 0.8, 0.78], plates: 0.12, plateColor: [0.52, 0.46, 0.38], glowMix: 0, size: 1.06, siege: 1 },
  pack_mind: { name: 'Pack Mind', tint: [1, 1, 1], plates: 0, glow: [5, 2.6, 0.6], glowMix: 0.25, size: 1, siege: 1 },
}
export const DEFAULT_PLATE_COLOR = [0.42, 0.4, 0.37]

/** Endless boss scaling per appearance k (WaveGenerator.cs:175-185) */
export const bossHealthScale = k => 1 + 0.6 * (Math.max(1, k) - 1)
export const bossDamageScale = k => 1 + 0.2 * (Math.max(1, k) - 1)
