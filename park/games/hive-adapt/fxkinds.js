// Hive Adapt (Project 0 port): the one-shot effect table. Each kind is a list of emitters ported from the Unity builder
// (HiveBuilder.Vfx.cs / .Weapons.cs / .Roles.cs / .Siege.cs / .Bosses.cs: Emit { burst, life, speed, size, colours, gravity,
// shape, stretch, sizeOverLife, drag, noise, horizontal, collide }), plus a few the port needs (pod, shield, barricade, dust).
// Counts are trimmed a little from Unity so a 45-bug wave does not flood the miniature view; fx.js cuts them ~3x when G.lite.
//
// Emitter fields: t sprite cell (fxtex CELL) | add 1 additive / 0 alpha (default by sprite) | i colour intensity
//   n burst count | rate + dur (emits over dur seconds) | delay | life [a, b] s | sp speed [a, b] m/s | sz size [a, b] m
//   c [colourA, colourB] (sRGB, optional alpha; random mix) | grav gravity modifier (x 9.81) | drag | noise (turbulence)
//   shape 'cone' (default, ang half-angle deg, rad base radius) | 'sphere' | 'hemi' | 'circle' (disc, radial out) | 'disc' (disc, along axis) | 'none'
//   up 1: the emitter axis is world up (Unity shapeEuler -90); else the burst normal/dir
//   st velocity stretch (velScale: a spark streak) | fixed: a segment along the axis, length sz * sl | sl length scale
//   se [sizeStart, sizeEnd] multipliers (ease in-out) | rot random start rotation deg | spin deg/s
//   flat 1: horizontal (Unity HorizontalBillboard), 'n': flat on the burst normal | fade 'in' | 'lin' | 'hold'
//   col 1: bounce on the ground | off [x, y, z] world offset | offA offset along the axis | tint 1: colour from opts.colour
//   ringR 1: final ring radius = opts.radius | ringU 1: sizeEnd = opts.radius (Unity size units) | dur scaled by opts.seconds when 'sec'
// light: [colour, intensity (Unity), range (m), fade (1/s)] (FxAutoRestart: level falls at fade/s, intensity x level^2)

const AMBER = [1, 0.62, 0.2], CYAN = [0.3, 0.85, 1], GOO = [0.95, 0.55, 0.08], GOO_DARK = [0.35, 0.2, 0.05], ACID = [0.55, 1, 0.15]
const GOLD = [1, 0.8, 0.3], LIME = [0.72, 1, 0.24], WHITE = [1, 1, 1], VIOLET = [0.7, 0.25, 1], EMBER = [1, 0.42, 0.1]
const DUST = [0.5, 0.42, 0.32, 0.68], DUST_DARK = [0.36, 0.3, 0.23, 0.52], SOIL = [0.3, 0.22, 0.15], SOIL_DARK = [0.16, 0.12, 0.08]
const SIEGE_HOT = [1, 0.34, 0.1], SIEGE_BILE = [0.95, 0.6, 0.14], FUME = [0.32, 0.22, 0.16, 0.55], FUME_DARK = [0.16, 0.11, 0.09, 0.45]
const INTERACT = [1, 0.69, 0]
const GREY_DUST = [0.55, 0.5, 0.44, 0.55], GREY_DUST2 = [0.45, 0.42, 0.38, 0.4]
const PALE_DUST = [0.5, 0.45, 0.38, 0.55], PALE_DUST2 = [0.42, 0.38, 0.32, 0.4]
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export const COLORS = { AMBER, CYAN, GOO, GOO_DARK, ACID, GOLD, LIME, WHITE, VIOLET, EMBER, SIEGE_HOT, SIEGE_BILE, INTERACT }

export const KINDS = {
  // ------------------------------------------------------------------ impacts (weapons, turrets)
  sparks: {
    light: [AMBER, 3, 3, 25],
    e: [
      { t: 'dot', n: 12, life: [0.15, 0.45], sp: [4, 11], sz: [0.022, 0.045], c: [AMBER, [1, 0.85, 0.5]], grav: 1.4, ang: 50, st: 0.045, col: 1 },
      { t: 'smoke', n: 3, life: [0.5, 1.1], sp: [0.4, 1.4], sz: [0.25, 0.5], c: [GREY_DUST, GREY_DUST2], ang: 30, se: [0.5, 1.6], drag: 3, rot: 360 },
      { t: 'debris', n: 4, life: [0.4, 0.8], sp: [2, 5], sz: [0.02, 0.05], c: [[0.5, 0.48, 0.45], [0.3, 0.29, 0.27]], grav: 2, ang: 45, rot: 360, spin: 600, col: 1 },
      { t: 'glow', i: 1.6, n: 1, life: [0.05, 0.07], sp: [0, 0], sz: [0.35, 0.45], c: [AMBER, AMBER] },
    ],
  },
  goo: {
    e: [
      { t: 'blob', n: 12, life: [0.35, 0.7], sp: [2.5, 6.5], sz: [0.04, 0.09], c: [GOO, GOO_DARK], grav: 2.2, ang: 55, st: 0.02, col: 1 },
      { t: 'smoke', n: 2, life: [0.3, 0.6], sp: [0.5, 1.5], sz: [0.25, 0.45], c: [[0.7, 0.4, 0.08, 0.55], [0.5, 0.3, 0.06, 0.4]], ang: 35, se: [0.6, 1.5], drag: 4, rot: 360 },
      { t: 'glow', n: 1, life: [0.08, 0.1], sp: [0, 0], sz: [0.4, 0.5], c: [GOO, GOO], tint: 1 },
    ],
  },
  plasmaBurst: {
    light: [CYAN, 5, 4, 12],
    e: [
      { t: 'dot', n: 18, life: [0.2, 0.5], sp: [3, 9], sz: [0.02, 0.05], c: [CYAN, [0.7, 0.95, 1]], grav: 0.6, ang: 70, st: 0.04 },
      { t: 'glow', i: 1.6, n: 1, life: [0.12, 0.14], sp: [0, 0], sz: [0.9, 1.1], c: [CYAN, CYAN], se: [0.4, 1.3] },
      { t: 'ring', n: 1, life: [0.22, 0.25], sp: [0, 0], sz: [0.4, 0.4], c: [CYAN, CYAN], se: [0.3, 3] },
    ],
  },
  grenadeBlast: {
    light: [[1, 0.55, 0.2], 14, 12, 6],
    e: [
      { t: 'glow', i: 1.5, n: 1, life: [0.12, 0.16], sp: [0, 0], sz: [5.5, 6], c: [[1, 0.75, 0.4], [1, 0.75, 0.4]], se: [0.4, 1.3] },
      { t: 'glow', i: 1.4, n: 12, life: [0.25, 0.5], sp: [3, 7], sz: [0.9, 1.6], c: [[1, 0.55, 0.15], [1, 0.3, 0.05]], shape: 'hemi', up: 1, rad: 0.4, se: [0.6, 1.6], drag: 4 },
      { t: 'smoke', n: 12, life: [1.6, 3.2], sp: [1.5, 5], sz: [1.4, 2.6], c: [[0.22, 0.2, 0.18, 0.75], [0.38, 0.35, 0.32, 0.55]], shape: 'hemi', up: 1, rad: 0.6, se: [0.5, 2.4], drag: 2.2, grav: -0.15, rot: 360, spin: 25 },
      { t: 'smoke', n: 10, life: [1.2, 2.4], sp: [4, 9], sz: [0.9, 1.6], c: [[0.52, 0.46, 0.38, 0.55], [0.44, 0.4, 0.34, 0.4]], shape: 'circle', up: 1, rad: 0.8, se: [0.5, 2.2], drag: 3, rot: 360 },
      { t: 'debris', n: 26, life: [0.8, 1.8], sp: [5, 13], sz: [0.05, 0.18], c: [[0.32, 0.28, 0.24], [0.16, 0.14, 0.12]], grav: 2.6, ang: 55, up: 1, rad: 0.4, rot: 360, spin: 800, col: 1 },
      { t: 'dot', n: 32, life: [0.3, 0.9], sp: [8, 20], sz: [0.02, 0.05], c: [[1, 0.7, 0.3], WHITE], grav: 1.2, shape: 'hemi', up: 1, rad: 0.3, st: 0.025, col: 1 },
      { t: 'ring', n: 1, life: [0.3, 0.35], sp: [0, 0], sz: [1, 1], c: [[1, 0.6, 0.25], [1, 0.6, 0.25]], se: [0.3, 9], flat: 1, off: [0, 0.08, 0] },
    ],
  },
  // ------------------------------------------------------------------ bugs
  bugDeath: {
    light: [[1, 0.5, 0.12], 7, 5, 5],
    e: [
      { t: 'blob', n: 24, life: [0.5, 1.0], sp: [3, 8], sz: [0.06, 0.16], c: [GOO, GOO_DARK], grav: 2.4, shape: 'sphere', rad: 0.25, st: 0.02, col: 1 },
      { t: 'debris', n: 10, life: [0.8, 1.5], sp: [2.5, 6], sz: [0.07, 0.18], c: [[0.35, 0.28, 0.18], [0.18, 0.14, 0.1]], grav: 2.6, shape: 'hemi', up: 1, rad: 0.3, rot: 360, spin: 720, col: 1 },
      { t: 'dot', n: 16, life: [0.5, 1.2], sp: [1.5, 5], sz: [0.025, 0.06], c: [[1, 0.55, 0.1], [1, 0.85, 0.35]], grav: -0.3, shape: 'sphere', rad: 0.3, noise: 1.2, drag: 1.5, tint: 2 },
      { t: 'smoke', n: 5, life: [0.8, 1.6], sp: [0.4, 1.5], sz: [0.6, 1.2], c: [[0.55, 0.35, 0.1, 0.6], [0.3, 0.22, 0.12, 0.45]], shape: 'sphere', rad: 0.3, se: [0.5, 1.8], drag: 2.5, rot: 360, spin: 40 },
      { t: 'glow', i: 1.5, n: 1, life: [0.12, 0.15], sp: [0, 0], sz: [1.6, 1.8], c: [[1, 0.55, 0.12], [1, 0.55, 0.12]], se: [0.5, 1.4], tint: 1 },
      { t: 'ring', n: 1, life: [0.3, 0.35], sp: [0, 0], sz: [1, 1], c: [[1, 0.6, 0.15], [1, 0.6, 0.15]], se: [0.2, 3.2], flat: 1, tint: 1 },
    ],
  },
  bugSpawn: {
    light: [[1, 0.45, 0.1], 4, 6, 4],
    e: [
      { t: 'debris', n: 18, life: [0.6, 1.2], sp: [3, 7], sz: [0.05, 0.16], c: [[0.36, 0.3, 0.23], [0.2, 0.17, 0.13]], grav: 2.5, ang: 30, up: 1, rad: 0.5, rot: 360, spin: 500, col: 1 },
      { t: 'smoke', n: 7, life: [1, 2], sp: [0.8, 2.4], sz: [0.8, 1.6], c: [PALE_DUST, PALE_DUST2], ang: 70, up: 1, rad: 0.6, se: [0.5, 2], drag: 2, rot: 360, spin: 30 },
      { t: 'spore', n: 12, life: [0.8, 1.6], sp: [0.5, 2.5], sz: [0.04, 0.1], c: [[1, 0.5, 0.1], ACID], ang: 40, up: 1, rad: 0.5, noise: 1, drag: 1 },
    ],
  },
  eliteDeath: {
    light: [GOLD, 6, 6, 5],
    e: [
      { t: 'ring', n: 1, life: [0.45, 0.5], sp: [0, 0], sz: [1, 1], c: [GOLD, GOLD], se: [0.3, 4.5], flat: 1 },
      { t: 'dot', n: 30, life: [0.4, 1.1], sp: [3, 9], sz: [0.03, 0.07], c: [GOLD, WHITE], grav: 0.6, shape: 'sphere', rad: 0.3, st: 0.03 },
      { t: 'glow', i: 1.5, n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [2.4, 2.6], c: [GOLD, GOLD], se: [0.5, 1.4] },
      { t: 'glow', n: 9, life: [1.2, 2], sp: [0.3, 1.2], sz: [0.12, 0.22], c: [GOLD, [1, 0.9, 0.6]], grav: -0.25, shape: 'sphere', rad: 0.4, noise: 0.6 },
      { t: 'star', n: 5, life: [0.5, 0.9], sp: [0.6, 2], sz: [0.3, 0.45], c: [GOLD, WHITE], shape: 'sphere', rad: 0.3, grav: -0.1, rot: 45, spin: 90 },
    ],
  },
  bossDeath: {
    light: [[1, 0.5, 0.15], 14, 14, 1.5],
    e: [
      { t: 'glow', i: 1.6, n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [6, 7], c: [[1, 0.55, 0.15], [1, 0.55, 0.15]], se: [0.4, 1.5], tint: 1 },
      { t: 'ring', n: 1, life: [0.8, 0.85], sp: [0, 0], sz: [3, 3], c: [[1, 0.5, 0.12], [1, 0.5, 0.12]], se: [0.3, 8], flat: 1, tint: 1 },
      { t: 'ring', n: 1, delay: 0.15, life: [0.9, 0.95], sp: [0, 0], sz: [3, 3], c: [GOLD, GOLD], se: [0.3, 6], flat: 1 },
      { t: 'dot', n: 46, life: [1, 2.4], sp: [3, 10], sz: [0.05, 0.12], c: [[1, 0.55, 0.1], GOLD], grav: -0.4, shape: 'sphere', rad: 1, noise: 1, drag: 1.2, tint: 2 },
      { t: 'smoke', n: 10, life: [2.5, 4], sp: [1, 3], sz: [2, 3], c: [FUME, FUME_DARK], grav: -0.15, shape: 'sphere', rad: 1.2, se: [0.5, 2.4], rot: 360, spin: 15 },
      { t: 'star', n: 8, life: [0.6, 1.2], sp: [1, 4], sz: [0.45, 0.7], c: [GOLD, WHITE], shape: 'sphere', rad: 0.8, rot: 45, spin: 120 },
    ],
  },
  armorChip: {
    light: [[1, 0.7, 0.35], 3, 3, 10],
    e: [
      { t: 'debris', n: 12, life: [0.7, 1.4], sp: [2.5, 6], sz: [0.07, 0.16], c: [[0.24, 0.2, 0.16], [0.12, 0.1, 0.08]], grav: 2.6, shape: 'sphere', rad: 0.2, rot: 360, spin: 900, col: 1 },
      { t: 'smoke', n: 4, life: [0.6, 1.1], sp: [0.5, 1.5], sz: [0.4, 0.7], c: [[0.5, 0.45, 0.38, 0.45], [0.4, 0.36, 0.3, 0.3]], se: [0.5, 1.6], drag: 3, rot: 360 },
      { t: 'dot', n: 10, life: [0.15, 0.35], sp: [4, 9], sz: [0.015, 0.035], c: [[1, 0.75, 0.4], WHITE], st: 0.02 },
    ],
  },
  weakPoint: {
    light: [GOLD, 8, 6, 6],
    e: [
      { t: 'dot', n: 22, life: [0.3, 0.8], sp: [3, 9], sz: [0.04, 0.09], c: [GOLD, WHITE], grav: 0.8, shape: 'sphere', rad: 0.2, st: 0.03 },
      { t: 'glow', i: 1.5, n: 1, life: [0.15, 0.18], sp: [0, 0], sz: [1.6, 1.8], c: [GOLD, GOLD], se: [0.4, 1.5] },
      { t: 'ring', n: 1, life: [0.3, 0.35], sp: [0, 0], sz: [1, 1], c: [GOLD, GOLD], se: [0.2, 3.5] },
    ],
  },
  shellBreak: {
    light: [[1, 0.7, 0.35], 6, 8, 8],
    e: [
      { t: 'debris2', n: 18, life: [0.8, 1.6], sp: [4, 10], sz: [0.1, 0.3], c: [[0.5, 0.52, 0.56], [0.25, 0.26, 0.3]], grav: 2.4, ang: 55, up: 1, rad: 0.5, rot: 360, spin: 700, col: 1 },
      { t: 'dot', n: 28, life: [0.2, 0.6], sp: [6, 15], sz: [0.02, 0.05], c: [[1, 0.75, 0.35], WHITE], grav: 1.4, shape: 'sphere', rad: 0.4, st: 0.025 },
      { t: 'glow', i: 1.5, n: 1, life: [0.3, 0.35], sp: [0, 0], sz: [3, 3.4], c: [[1, 0.7, 0.35], [1, 0.7, 0.35]], se: [0.5, 1.3] },
      { t: 'smoke', n: 7, life: [1, 2], sp: [1.5, 4], sz: [1, 1.8], c: [[0.42, 0.38, 0.33, 0.5], [0.3, 0.27, 0.24, 0.35]], shape: 'sphere', rad: 0.6, se: [0.5, 2], drag: 3, rot: 360, spin: 25 },
    ],
  },
  roarWave: {
    e: [
      { t: 'ring', n: 1, life: [0.9, 1], sp: [0, 0], sz: [3, 3], c: [[1, 0.45, 0.1], [1, 0.45, 0.1]], se: [0.3, 9], flat: 1, tint: 1 },
      { t: 'ring', n: 1, delay: 0.18, life: [0.9, 1], sp: [0, 0], sz: [3, 3], c: [[1, 0.3, 0.05], [1, 0.3, 0.05]], se: [0.3, 7], flat: 1 },
      { t: 'smoke', n: 22, life: [1.2, 2.2], sp: [5, 10], sz: [1, 2], c: [[0.5, 0.44, 0.36, 0.5], [0.42, 0.38, 0.32, 0.35]], shape: 'circle', up: 1, rad: 2, se: [0.5, 2.4], drag: 3, rot: 360, spin: 30 },
    ],
  },
  slamShockwave: {
    light: [[1, 0.55, 0.2], 6, 9, 4],
    e: [
      { t: 'ring', n: 1, life: [0.5, 0.55], sp: [0, 0], sz: [2, 2], c: [[1, 0.55, 0.15], [1, 0.55, 0.15]], se: [0.2, 5], flat: 1, ringR: 1, off: [0, 0.1, 0] },
      { t: 'softRing', n: 1, life: [0.6, 0.7], sp: [0, 0], sz: [2, 2], c: [[0.6, 0.5, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]], add: 0, se: [0.2, 4.6], flat: 1, ringR: 1, off: [0, 0.12, 0] },
      { t: 'debris', n: 20, life: [0.7, 1.4], sp: [4, 9], sz: [0.08, 0.25], c: [[0.4, 0.37, 0.33], [0.22, 0.2, 0.18]], grav: 2.5, ang: 60, up: 1, rad: 1.2, rot: 360, spin: 700, col: 1 },
      { t: 'smoke', n: 14, life: [1, 2], sp: [3, 7], sz: [1, 1.8], c: [PALE_DUST, PALE_DUST2], shape: 'circle', up: 1, rad: 1.5, se: [0.5, 2.2], drag: 3, rot: 360 },
    ],
  },
  rammerPaw: {
    e: [
      { t: 'smoke', n: 4, life: [0.8, 1.4], sp: [1.5, 3], sz: [0.6, 1], c: [DUST, DUST_DARK], ang: 35, up: 1, se: [0.5, 1.5], drag: 2, rot: 360 },
      { t: 'debris', n: 5, life: [0.4, 0.8], sp: [2, 4], sz: [0.05, 0.12], c: [SOIL, SOIL_DARK], grav: 2.2, ang: 30, up: 1, rad: 0.2, rot: 360, spin: 500 },
    ],
  },
  rammerImpact: {
    light: [[1, 0.7, 0.4], 4, 6, 10],
    e: [
      { t: 'debris', n: 24, life: [0.7, 1.5], sp: [4, 11], sz: [0.06, 0.2], c: [[0.35, 0.3, 0.25], [0.18, 0.15, 0.12]], grav: 2.6, ang: 55, rad: 0.5, rot: 360, spin: 800, col: 1 },
      { t: 'dot', n: 22, life: [0.2, 0.6], sp: [6, 14], sz: [0.02, 0.05], c: [[1, 0.7, 0.3], WHITE], grav: 1.2, ang: 60, rad: 0.3, st: 0.025 },
      { t: 'smoke', n: 9, life: [1.2, 2.4], sp: [2, 5], sz: [1.2, 2], c: [DUST, DUST_DARK], ang: 70, rad: 0.8, se: [0.5, 2.2], drag: 3, rot: 360, spin: 25 },
      { t: 'ring', n: 1, life: [0.3, 0.35], sp: [0, 0], sz: [1, 1], c: [[1, 0.75, 0.45, 0.6], [1, 0.75, 0.45, 0.6]], se: [0.4, 6] },
    ],
  },
  leechDrain: {
    e: [
      { t: 'dot', n: 10, life: [0.2, 0.45], sp: [1, 3], sz: [0.02, 0.05], c: [VIOLET, [0.4, 0.9, 1]], shape: 'sphere', rad: 0.15, st: 0.04 },
      { t: 'glow', n: 2, life: [0.3, 0.5], sp: [0, 0], sz: [0.5, 0.7], c: [VIOLET, VIOLET], se: [0.6, 1.2] },
    ],
  },
  burrowDig: {
    e: [
      { t: 'debris', n: 20, life: [0.6, 1.3], sp: [3, 7], sz: [0.06, 0.16], c: [SOIL, SOIL_DARK], grav: 2.4, ang: 40, up: 1, rad: 0.6, rot: 360, spin: 600, col: 1 },
      { t: 'smoke', n: 9, life: [1.4, 2.6], sp: [1.5, 4], sz: [1.2, 2.2], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 0.9, se: [0.5, 2.2], drag: 2.5, rot: 360, spin: 20 },
      { t: 'smoke', rate: 14, dur: 1.1, life: [0.6, 1], sp: [2, 4], sz: [0.5, 0.9], c: [DUST, DUST_DARK], ang: 30, up: 1, rad: 0.4, se: [0.6, 1.6], rot: 360 },
    ],
  },
  burrowTrail: {
    e: [
      { t: 'smoke', n: 3, life: [1, 1.8], sp: [0.4, 1.2], sz: [0.8, 1.3], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 0.6, se: [0.4, 1.5], drag: 2, rot: 360 },
      { t: 'debris', n: 4, life: [0.4, 0.7], sp: [1, 2.5], sz: [0.04, 0.09], c: [SOIL, SOIL_DARK], grav: 2, ang: 30, up: 1, rad: 0.4, rot: 360, spin: 400 },
    ],
  },
  burrowEmerge: {
    light: [EMBER, 3, 5, 6],
    e: [
      { t: 'debris', n: 28, life: [0.8, 1.6], sp: [4, 10], sz: [0.08, 0.24], c: [SOIL, SOIL_DARK], grav: 2.6, ang: 35, up: 1, rad: 0.8, rot: 360, spin: 700, col: 1 },
      { t: 'smoke', n: 12, life: [1.6, 3], sp: [2, 6], sz: [1.4, 2.6], c: [DUST, DUST_DARK], shape: 'hemi', up: 1, rad: 1, se: [0.5, 2.4], drag: 2.5, rot: 360, spin: 20 },
      { t: 'smoke2', n: 10, life: [0.8, 1.4], sp: [5, 8], sz: [0.9, 1.4], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 0.6, se: [0.6, 1.8], drag: 4 },
    ],
  },
  acidImpact: {
    light: [ACID, 3, 3, 6],
    e: [
      { t: 'blob', n: 14, life: [0.3, 0.7], sp: [2, 5], sz: [0.05, 0.12], c: [ACID, [0.3, 0.6, 0.05]], grav: 2, shape: 'hemi', rad: 0.15, st: 0.02 },
      { t: 'smoke', n: 5, life: [0.8, 1.5], sp: [0.3, 1], sz: [0.3, 0.7], c: [[0.6, 0.9, 0.3, 0.4], [0.4, 0.5, 0.3, 0.3]], ang: 30, up: 1, se: [0.5, 1.6], rot: 360 },
      { t: 'glow', n: 1, life: [0.2, 0.25], sp: [0, 0], sz: [0.9, 1], c: [ACID, ACID] },
    ],
  },
  acidSplash: {
    light: [ACID, 5, 5, 6],
    e: [
      { t: 'glow', n: 12, life: [0.3, 0.6], sp: [2, 6], sz: [0.25, 0.5], c: [ACID, [0.3, 0.8, 0.1]], grav: 1.6, shape: 'hemi', up: 1, rad: 0.25, se: [1, 0.3] },
      { t: 'dot', n: 18, life: [0.4, 0.9], sp: [3, 8], sz: [0.04, 0.09], c: [ACID, WHITE], grav: 2.2, shape: 'hemi', up: 1, rad: 0.2, st: 0.03 },
      { t: 'smoke', n: 4, life: [1.2, 2.2], sp: [0.4, 1.2], sz: [0.8, 1.4], c: [[0.45, 0.6, 0.25, 0.45], [0.35, 0.45, 0.2, 0.3]], grav: -0.08, shape: 'hemi', up: 1, rad: 0.4, se: [0.5, 1.8], rot: 360, spin: 20 },
    ],
  },
  // ------------------------------------------------------------------ Siege Node
  siegeGrow: {
    light: [SIEGE_HOT, 4, 10, 0.4],
    e: [
      { t: 'debris', n: 14, rate: 12, dur: 3.6, sec: 1, life: [0.8, 1.6], sp: [3, 8], sz: [0.08, 0.26], c: [SOIL, SOIL_DARK], grav: 2.6, ang: 35, up: 1, rad: 2.2, rot: 360, spin: 600, col: 1 },
      { t: 'smoke', n: 8, rate: 6, dur: 4, sec: 1, life: [2, 3.4], sp: [1.5, 4], sz: [2, 3.2], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 2.6, se: [0.5, 2.4], drag: 2, rot: 360, spin: 15 },
      { t: 'glow', n: 1, life: [4.6, 4.6], sec: 1, sp: [0, 0], sz: [7, 7], c: [mul(SIEGE_HOT, 0.8), mul(SIEGE_HOT, 0.8)], se: [0.3, 1], fade: 'in', flat: 1, off: [0, 0.1, 0] },
      { t: 'smoke2', n: 12, life: [1, 1.8], sp: [6, 9], sz: [1.4, 2], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 1.5, se: [0.6, 2], drag: 4 },
    ],
  },
  siegeMuzzle: {
    light: [SIEGE_HOT, 6, 8, 10],
    e: [
      { t: 'glow', i: 1.5, n: 3, life: [0.12, 0.2], sp: [0, 0], sz: [2.4, 3], c: [SIEGE_HOT, SIEGE_BILE], se: [0.6, 1.3] },
      { t: 'dot', n: 18, life: [0.3, 0.8], sp: [4, 10], sz: [0.05, 0.12], c: [SIEGE_BILE, SIEGE_HOT], grav: 1.8, ang: 18, rad: 0.3, st: 0.03 },
      { t: 'smoke', n: 7, life: [1.2, 2.2], sp: [1, 3], sz: [1, 1.6], c: [FUME, FUME_DARK], ang: 30, rad: 0.5, se: [0.5, 2.2], drag: 2, rot: 360, spin: 20 },
    ],
  },
  siegeImpact: {
    light: [SIEGE_HOT, 6, 12, 7],
    e: [
      { t: 'glow', n: 6, life: [0.2, 0.4], sp: [1, 4], sz: [2, 3], c: [mul(SIEGE_HOT, 0.75), [0.6, 0.22, 0.08]], shape: 'hemi', up: 1, rad: 0.6, se: [0.5, 1.3] },
      { t: 'dot', n: 30, life: [0.5, 1.2], sp: [5, 13], sz: [0.06, 0.14], c: [SIEGE_BILE, SIEGE_HOT], grav: 2.2, shape: 'hemi', up: 1, rad: 0.4, st: 0.03, col: 1 },
      { t: 'debris', n: 18, life: [0.8, 1.6], sp: [4, 10], sz: [0.08, 0.22], c: [SOIL, SOIL_DARK], grav: 2.6, ang: 40, up: 1, rad: 0.6, rot: 360, spin: 700, col: 1 },
      { t: 'smoke', n: 10, life: [2, 3.6], sp: [1.5, 4.5], sz: [2, 3.4], c: [FUME, FUME_DARK], grav: -0.1, shape: 'hemi', up: 1, rad: 1, se: [0.5, 2.4], drag: 2, rot: 360, spin: 18 },
      { t: 'smoke2', n: 10, life: [0.9, 1.5], sp: [7, 10], sz: [1.2, 1.8], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 0.8, se: [0.6, 2], drag: 4 },
      { t: 'ring', n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [1, 1], c: [[1, 0.55, 0.25, 0.7], [1, 0.55, 0.25, 0.7]], se: [0.5, 9], flat: 1, off: [0, 0.1, 0] },
    ],
  },
  siegeDeath: {
    light: [SIEGE_HOT, 10, 16, 3],
    e: [
      { t: 'glow', n: 8, life: [0.25, 0.5], sp: [1, 5], sz: [2.6, 4], c: [mul(SIEGE_HOT, 0.7), mul(SIEGE_BILE, 0.6)], shape: 'sphere', rad: 0.8, se: [0.5, 1.4] },
      { t: 'dot', n: 48, life: [0.6, 1.6], sp: [5, 15], sz: [0.07, 0.16], c: [SIEGE_BILE, SIEGE_HOT], grav: 2, shape: 'sphere', rad: 0.8, st: 0.03, col: 1 },
      { t: 'debris', n: 24, life: [1, 2], sp: [4, 11], sz: [0.12, 0.32], c: [[0.35, 0.12, 0.1], [0.16, 0.06, 0.05]], grav: 2.6, shape: 'sphere', rad: 0.8, rot: 360, spin: 500, col: 1 },
      { t: 'smoke', n: 8, rate: 6, dur: 2.5, life: [3, 5], sp: [1, 3], sz: [2.4, 3.6], c: [FUME, FUME_DARK], grav: -0.12, ang: 15, up: 1, rad: 1.2, se: [0.5, 2.6], rot: 360, spin: 15, noise: 0.3 },
      { t: 'ring', n: 1, life: [0.5, 0.55], sp: [0, 0], sz: [1, 1], c: [[1, 0.5, 0.2, 0.7], [1, 0.5, 0.2, 0.7]], se: [0.5, 14], flat: 1, ringU: 1, off: [0, 0.15, 0] },
    ],
  },
  // ------------------------------------------------------------------ towers, Core, barricades
  towerWrecked: {
    light: [[1, 0.55, 0.2], 2, 3, 8],
    e: [
      { t: 'dot', n: 12, life: [0.3, 0.8], sp: [2, 6], sz: [0.02, 0.05], c: [[1, 0.65, 0.25], WHITE], grav: 1.4, shape: 'sphere', rad: 0.2, st: 0.03, col: 1 },
      { t: 'smoke', n: 2, rate: 5, dur: 1.4, life: [2.2, 3.4], sp: [0.8, 1.6], sz: [0.7, 1.2], c: [[0.12, 0.11, 0.1, 0.7], [0.22, 0.2, 0.18, 0.5]], grav: -0.12, ang: 12, up: 1, rad: 0.2, se: [0.5, 2.4], rot: 360, spin: 20, noise: 0.3 },
    ],
  },
  upgrade: {
    light: [GOLD, 6, 6, 3],
    e: [
      { t: 'dot', n: 34, life: [0.8, 1.5], sp: [1, 4], sz: [0.03, 0.07], c: [GOLD, WHITE], grav: -0.4, shape: 'circle', up: 1, rad: 1, noise: 0.6, drag: 1.2 },
      { t: 'ring', n: 2, life: [0.6, 0.8], sp: [0.6, 1.2], sz: [3, 3], c: [GOLD, GOLD], shape: 'none', up: 1, se: [0.3, 1.2], flat: 1, off: [0, 0.1, 0] },
      { t: 'star', n: 6, life: [0.6, 1], sp: [0.8, 2.2], sz: [0.25, 0.4], c: [GOLD, WHITE], shape: 'disc', up: 1, rad: 0.9, rot: 45, spin: 90 },
    ],
  },
  tierUpBallistic: {
    light: [AMBER, 5, 5, 6],
    e: [
      { t: 'dot', n: 24, life: [0.3, 0.8], sp: [3, 8], sz: [0.02, 0.05], c: [AMBER, WHITE], grav: 1.6, shape: 'sphere', rad: 0.4, st: 0.04, col: 1 },
      { t: 'ring', n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [2, 2], c: [GOLD, GOLD], se: [0.3, 1.6], flat: 1 },
      { t: 'smoke', n: 6, life: [0.9, 1.6], sp: [0.6, 1.8], sz: [0.5, 0.9], c: [[0.36, 0.34, 0.32, 0.45], [0.3, 0.29, 0.28, 0.3]], shape: 'sphere', rad: 0.5, se: [0.5, 1.8], drag: 2, rot: 360, spin: 30 },
    ],
  },
  tierUpEnergy: {
    light: [CYAN, 6, 5, 6],
    e: [
      { t: 'dot', n: 26, life: [0.3, 0.7], sp: [3, 9], sz: [0.02, 0.05], c: [CYAN, WHITE], grav: 0.4, shape: 'sphere', rad: 0.35, st: 0.04 },
      { t: 'ring', n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [2, 2], c: [CYAN, CYAN], se: [0.3, 1.8], flat: 1 },
      { t: 'glow', n: 1, life: [0.25, 0.3], sp: [0, 0], sz: [1.6, 1.8], c: [CYAN, CYAN], se: [0.4, 1.2] },
    ],
  },
  build: {
    light: [CYAN, 6, 6, 3],
    e: [
      { t: 'ring', n: 3, life: [0.8, 1], sp: [1.5, 2.2], sz: [2.6, 2.8], c: [[0.3, 0.85, 1, 0.55], [0.3, 0.85, 1, 0.55]], shape: 'none', up: 1, se: [1, 0.4], flat: 1 },
      { t: 'dot', n: 28, life: [0.4, 1], sp: [2, 6], sz: [0.02, 0.05], c: [AMBER, WHITE], grav: 1.5, ang: 60, up: 1, rad: 0.8, st: 0.04, col: 1 },
      { t: 'smoke', n: 8, life: [1, 1.8], sp: [1, 3], sz: [0.8, 1.4], c: [[0.5, 0.46, 0.4, 0.5], [0.4, 0.37, 0.33, 0.35]], shape: 'circle', up: 1, rad: 1.2, se: [0.5, 2], drag: 2.5, rot: 360 },
    ],
  },
  repair: {
    light: [CYAN, 8, 8, 3],
    e: [
      { t: 'dot', n: 36, life: [0.8, 1.6], sp: [0.5, 2], sz: [0.04, 0.08], c: [CYAN, WHITE], grav: -0.3, shape: 'disc', up: 1, rad: 2.5, noise: 0.8 },
      { t: 'ring', n: 1, life: [0.6, 0.7], sp: [0, 0], sz: [3, 3], c: [CYAN, CYAN], se: [0.4, 2.5], flat: 1, off: [0, 0.9, 0] },
    ],
  },
  barricadeHit: {
    e: [
      { t: 'dot', n: 8, life: [0.15, 0.4], sp: [3, 8], sz: [0.015, 0.035], c: [AMBER, [1, 0.85, 0.5]], grav: 1.4, ang: 50, st: 0.035, col: 1 },
      { t: 'debris', n: 6, life: [0.5, 1], sp: [2, 5], sz: [0.04, 0.1], c: [[0.45, 0.38, 0.3], [0.25, 0.22, 0.2]], grav: 2.2, ang: 50, rot: 360, spin: 700, col: 1 },
      { t: 'smoke', n: 3, life: [0.7, 1.3], sp: [0.5, 1.6], sz: [0.4, 0.8], c: [GREY_DUST, GREY_DUST2], ang: 40, se: [0.5, 1.8], drag: 3, rot: 360 },
    ],
  },
  barricadeHitEnergy: {
    light: [[0.35, 0.75, 1], 2.5, 4, 10],
    e: [
      { t: 'ring', n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [0.6, 0.6], c: [CYAN, CYAN], se: [0.3, 3], flat: 'n' },
      { t: 'dot', n: 10, life: [0.2, 0.45], sp: [2, 6], sz: [0.02, 0.045], c: [CYAN, WHITE], grav: 0.5, ang: 60, st: 0.04 },
      { t: 'glow', n: 1, life: [0.1, 0.12], sp: [0, 0], sz: [0.6, 0.7], c: [CYAN, CYAN] },
    ],
  },
  barricadeBreak: {
    light: [[1, 0.6, 0.25], 5, 7, 5],
    e: [
      { t: 'debris2', n: 26, life: [1, 2], sp: [3, 8], sz: [0.12, 0.34], c: [[0.5, 0.44, 0.36], [0.26, 0.24, 0.22]], grav: 2.6, shape: 'hemi', up: 1, rad: 1.6, rot: 360, spin: 600, col: 1 },
      { t: 'debris', n: 16, life: [0.8, 1.6], sp: [2, 6], sz: [0.05, 0.14], c: [[0.4, 0.35, 0.3], [0.2, 0.18, 0.16]], grav: 2.4, ang: 60, up: 1, rad: 1.4, rot: 360, spin: 800, col: 1 },
      { t: 'dot', n: 20, life: [0.2, 0.6], sp: [5, 12], sz: [0.02, 0.05], c: [[1, 0.7, 0.3], WHITE], grav: 1.4, shape: 'hemi', up: 1, rad: 1, st: 0.03 },
      { t: 'smoke', n: 12, life: [1.4, 2.6], sp: [1.5, 4], sz: [1.2, 2.2], c: [PALE_DUST, PALE_DUST2], shape: 'circle', up: 1, rad: 1.6, se: [0.5, 2.2], drag: 2.5, rot: 360, spin: 20 },
    ],
  },
  barricadeBreakEnergy: {
    light: [[0.35, 0.75, 1], 8, 8, 4],
    e: [
      { t: 'shard', n: 40, life: [0.6, 1.4], sp: [2, 7], sz: [0.08, 0.2], c: [[0.15, 0.75, 1], [0.5, 0.9, 1]], grav: 0.8, shape: 'hemi', up: 1, rad: 1.6, rot: 360, spin: 400 },
      { t: 'glow', i: 1.4, n: 1, life: [0.25, 0.3], sp: [0, 0], sz: [4, 4.5], c: [CYAN, CYAN], se: [0.5, 1.3], off: [0, 1.2, 0] },
      { t: 'dot', n: 24, life: [0.3, 0.8], sp: [3, 9], sz: [0.02, 0.05], c: [CYAN, WHITE], grav: 0.6, shape: 'sphere', rad: 1, st: 0.04, off: [0, 1.2, 0] },
    ],
  },
  coreHit: {
    light: [CYAN, 4, 5, 10],
    e: [
      { t: 'ring', n: 1, life: [0.35, 0.4], sp: [0, 0], sz: [0.8, 0.8], c: [CYAN, CYAN], se: [0.2, 2.4] },
      { t: 'dot', n: 12, life: [0.2, 0.5], sp: [2, 6], sz: [0.02, 0.05], c: [CYAN, WHITE], grav: 0.5, ang: 60, st: 0.04 },
    ],
  },
  shieldHit: {
    light: [[0.62, 0.8, 1], 4, 5, 10],
    e: [
      { t: 'ring', n: 1, life: [0.45, 0.5], sp: [0, 0], sz: [1, 1], c: [[0.62, 0.8, 1], [0.62, 0.8, 1]], se: [0.2, 2.6], flat: 'n' },
      { t: 'softRing', n: 1, life: [0.6, 0.7], sp: [0, 0], sz: [1, 1], c: [CYAN, CYAN], se: [0.3, 3.4], flat: 'n', i: 0.9 },
      { t: 'dot', n: 10, life: [0.2, 0.5], sp: [2, 5], sz: [0.02, 0.045], c: [CYAN, WHITE], grav: 0.4, ang: 70, st: 0.04 },
      { t: 'glow', n: 1, life: [0.1, 0.14], sp: [0, 0], sz: [0.8, 0.9], c: [CYAN, CYAN] },
    ],
  },
  shieldBreak: {
    light: [CYAN, 20, 20, 1.5],
    e: [
      { t: 'glow', i: 1.5, n: 1, life: [0.4, 0.5], sp: [0, 0], sz: [9, 10], c: [CYAN, CYAN], se: [0.4, 1.3], off: [0, 2, 0] },
      { t: 'shard', i: 0.9, n: 70, life: [0.9, 2], sp: [3, 10], sz: [0.12, 0.3], c: [[0.15, 0.75, 1], [0.5, 0.9, 1]], grav: 0.9, shape: 'hemi', up: 1, rad: 5, rot: 360, spin: 360, off: [0, 0.5, 0] },
      { t: 'ring', n: 1, life: [0.9, 1], sp: [0, 0], sz: [4, 4], c: [CYAN, CYAN], se: [0.3, 6], flat: 1, off: [0, 0.4, 0] },
      { t: 'dot', n: 40, life: [0.5, 1.4], sp: [4, 12], sz: [0.03, 0.08], c: [CYAN, WHITE], grav: 0.8, shape: 'sphere', rad: 3, st: 0.03, off: [0, 2, 0] },
    ],
  },
  coreShockwave: {
    light: [CYAN, 30, 25, 1.2],
    e: [
      { t: 'ring', n: 1, life: [1.4, 1.5], sp: [0, 0], sz: [4, 4], c: [CYAN, CYAN], se: [0.2, 16], flat: 1, off: [0, 0.5, 0] },
      { t: 'glow', i: 1.5, n: 1, life: [0.5, 0.6], sp: [0, 0], sz: [8, 9], c: [CYAN, CYAN], se: [0.3, 1.3], off: [0, 2.2, 0] },
      { t: 'dot', n: 70, life: [1, 2.5], sp: [4, 14], sz: [0.05, 0.14], c: [CYAN, WHITE], grav: 1, shape: 'sphere', rad: 0.8, st: 0.03, off: [0, 2.2, 0], col: 1 },
    ],
  },
  // ------------------------------------------------------------------ player, pads, pods, rewards
  respawn: {
    light: [CYAN, 10, 6, 2.5],
    e: [
      { t: 'beam', n: 1, life: [0.9, 1], sp: [0, 0], sz: [1.2, 1.2], c: [CYAN, CYAN], fixed: 1, sl: 6, up: 1, off: [0, 1, 0], i: 1.3 },
      { t: 'ring', n: 2, life: [0.6, 0.9], sp: [0, 0], sz: [2.4, 2.4], c: [CYAN, CYAN], se: [0.2, 1.4], flat: 1, off: [0, 0.05, 0] },
      { t: 'dot', n: 30, life: [0.6, 1.4], sp: [1, 3.5], sz: [0.03, 0.07], c: [CYAN, WHITE], shape: 'disc', up: 1, rad: 0.7 },
    ],
  },
  levelUp: {
    light: [GOLD, 8, 5, 3],
    e: [
      { t: 'dot', n: 40, life: [0.6, 1.4], sp: [2, 7], sz: [0.03, 0.08], c: [GOLD, WHITE], grav: 0.5, shape: 'sphere', rad: 0.3, st: 0.02, off: [0, 1.2, 0] },
      { t: 'ring', n: 1, life: [0.5, 0.6], sp: [0, 0], sz: [2, 2], c: [GOLD, GOLD], se: [0.2, 2.5], flat: 1, off: [0, 0.1, 0] },
    ],
  },
  bossReward: {
    light: [GOLD, 6, 8, 3],
    e: [
      { t: 'ring', n: 1, life: [0.7, 0.75], sp: [0, 0], sz: [1, 1], c: [GOLD, GOLD], se: [0.4, 9], flat: 1, off: [0, 0.1, 0] },
      { t: 'glow', n: 1, life: [1, 1.1], sp: [0, 0], sz: [2.6, 2.8], c: [LIME, GOLD], se: [0.6, 1.4], off: [0, 1.2, 0] },
      { t: 'dot', n: 36, life: [1.2, 2.2], sp: [0.6, 2.4], sz: [0.04, 0.09], c: [GOLD, LIME], grav: -0.35, shape: 'disc', up: 1, rad: 1.2, noise: 0.6 },
    ],
  },
  jumpPadBurst: {
    light: [AMBER, 5, 5, 5],
    e: [
      { t: 'ring', n: 1, life: [0.4, 0.45], sp: [0, 0], sz: [2, 2], c: [AMBER, AMBER], se: [0.3, 2.2], flat: 1, off: [0, 0.25, 0] },
      { t: 'smoke', n: 10, life: [0.8, 1.4], sp: [2, 4.5], sz: [0.7, 1.2], c: [[0.52, 0.47, 0.4, 0.45], [0.42, 0.38, 0.33, 0.3]], shape: 'circle', up: 1, rad: 0.9, se: [0.4, 1.8], drag: 3, rot: 360 },
      { t: 'dot', n: 16, life: [0.3, 0.7], sp: [3, 7], sz: [0.02, 0.04], c: [AMBER, WHITE], grav: 1.2, ang: 25, up: 1, rad: 0.6, st: 0.05 },
    ],
  },
  podLanding: {
    light: [[1, 0.7, 0.4], 8, 12, 3],
    e: [
      { t: 'glow', i: 1.5, n: 1, life: [0.2, 0.25], sp: [0, 0], sz: [4, 4.5], c: [[1, 0.7, 0.4], [1, 0.7, 0.4]], se: [0.4, 1.3], off: [0, 0.6, 0] },
      { t: 'ring', n: 1, life: [0.5, 0.55], sp: [0, 0], sz: [1, 1], c: [[1, 0.75, 0.45, 0.8], [1, 0.75, 0.45, 0.8]], se: [0.3, 10], flat: 1, off: [0, 0.1, 0] },
      { t: 'smoke', n: 14, life: [1.4, 2.6], sp: [4, 9], sz: [1.2, 2.2], c: [DUST, DUST_DARK], shape: 'circle', up: 1, rad: 1, se: [0.5, 2.4], drag: 3, rot: 360, spin: 20 },
      { t: 'debris', n: 16, life: [0.8, 1.6], sp: [3, 9], sz: [0.06, 0.2], c: [SOIL, SOIL_DARK], grav: 2.6, ang: 45, up: 1, rad: 0.6, rot: 360, spin: 600, col: 1 },
      { t: 'dot', n: 16, life: [0.3, 0.8], sp: [5, 12], sz: [0.02, 0.05], c: [AMBER, WHITE], grav: 1.4, shape: 'hemi', up: 1, rad: 0.5, st: 0.03 },
    ],
  },
  podPickup: {
    light: [INTERACT, 6, 8, 3],
    e: [
      { t: 'ring', n: 1, life: [0.6, 0.65], sp: [0, 0], sz: [1, 1], c: [INTERACT, INTERACT], se: [0.4, 6], flat: 1, off: [0, 0.1, 0] },
      { t: 'glow', n: 1, life: [0.8, 0.9], sp: [0, 0], sz: [2.2, 2.4], c: [INTERACT, LIME], se: [0.6, 1.4], off: [0, 1, 0] },
      { t: 'dot', n: 30, life: [1, 1.8], sp: [0.6, 2.4], sz: [0.04, 0.08], c: [INTERACT, LIME], grav: -0.35, shape: 'disc', up: 1, rad: 1, noise: 0.6 },
    ],
  },
  dodgeDust: {
    e: [
      { t: 'smoke', n: 4, life: [0.5, 0.9], sp: [0.6, 1.8], sz: [0.35, 0.6], c: [[0.55, 0.47, 0.37, 0.42], [0.45, 0.39, 0.31, 0.3]], shape: 'circle', up: 1, rad: 0.3, se: [0.5, 1.6], drag: 3, rot: 360, off: [0, 0.1, 0] },
    ],
  },
  footDust: {
    e: [
      { t: 'smoke2', n: 2, life: [0.4, 0.7], sp: [0.3, 0.8], sz: [0.2, 0.35], c: [[0.55, 0.47, 0.37, 0.32], [0.45, 0.39, 0.31, 0.24]], shape: 'circle', up: 1, rad: 0.1, se: [0.5, 1.4], drag: 3, rot: 360, off: [0, 0.05, 0] },
    ],
  },
  landDust: {
    e: [
      { t: 'smoke', n: 5, life: [0.5, 1], sp: [1, 2.4], sz: [0.4, 0.7], c: [[0.55, 0.47, 0.37, 0.42], [0.45, 0.39, 0.31, 0.3]], shape: 'circle', up: 1, rad: 0.3, se: [0.5, 1.7], drag: 3.5, rot: 360, off: [0, 0.08, 0] },
    ],
  },
  // ------------------------------------------------------------------ projectile trails (call once per frame from the projectile)
  plasmaTrail: {
    e: [{ t: 'dot', n: 3, life: [0.15, 0.3], sp: [0, 0.3], sz: [0.18, 0.3], c: [CYAN, mix(CYAN, WHITE, 0.3)], shape: 'sphere', rad: 0.04, se: [1, 0.1] }],
  },
  // a projectile's glowing core: emit every frame at the projectile (drawn once, gone the next frame)
  plasmaBolt: {
    e: [{ t: 'glow', i: 1.6, n: 1, life: [0.001, 0.001], sp: [0, 0], sz: [0.6, 0.66], c: [CYAN, CYAN], shape: 'none' }],
  },
  grenadeFuse: {
    e: [{ t: 'glow', i: 1.6, n: 1, life: [0.001, 0.001], sp: [0, 0], sz: [0.18, 0.2], c: [AMBER, AMBER], shape: 'none' }],
  },
  grenadeTrail: {
    e: [{ t: 'smoke', n: 1, life: [0.5, 0.9], sp: [0, 0.2], sz: [0.12, 0.2], c: [[0.75, 0.72, 0.68, 0.35], [0.6, 0.58, 0.55, 0.25]], shape: 'sphere', rad: 0.02, se: [0.6, 2.2], rot: 360 }],
  },
}

// muzzle flashes (MuzzleFlash(): front star, side flame, sparks, optional smoke); light = the weapon's muzzle light
export const MUZZLES = {
  ar: { size: 0.34, c: AMBER, smoke: 1, light: [[1, 0.72, 0.3], 7, 7, 0.045] },
  plasma: { size: 0.4, c: CYAN, smoke: 0, light: [[0.35, 0.85, 1], 7, 7, 0.045] },
  shotgun: { size: 0.62, c: AMBER, smoke: 1, light: [[1, 0.6, 0.25], 7, 7, 0.045] },
  smg: { size: 0.26, c: AMBER, smoke: 1, light: [[1, 0.78, 0.35], 7, 7, 0.045] },
  rail: { size: 0.55, c: CYAN, smoke: 0, light: [[0.45, 0.88, 1], 7, 7, 0.045] },
  gl: { size: 0.42, c: AMBER, smoke: 1, light: [[1, 0.5, 0.2], 7, 7, 0.045] },
  turretBallistic: { size: 0.6, c: AMBER, smoke: 1, light: [[1, 0.65, 0.25], 6, 7, 0.04] },
  turretEnergy: { size: 0.7, c: CYAN, smoke: 0, light: [[0.35, 0.85, 1], 10, 9, 0.04] },
}
// tracers (Tracer.cs): speed m/s, length m, width m, colour, tail alpha; beams hold for 0.14 s
export const TRACERS = {
  bullet: { speed: 340, len: 7, w: 0.03, c: [1, 0.7, 0.35], i: 1.45 },
  pellet: { speed: 300, len: 3.5, w: 0.018, c: [1, 0.72, 0.4], i: 1.45 },
  turret: { speed: 300, len: 9, w: 0.05, c: [1, 0.6, 0.25], i: 1.35 },
}
export const BEAMS = {
  rail: { w: 0.075, c: [0.45, 0.9, 1], i: 1.3, life: 0.14 },
  energy: { w: 0.16, c: CYAN, i: 1.2, life: 0.14 },
}
// decals: default size (m) and life (s); cell in the decal atlas
export const DECALS = {
  bulletHole: { size: 0.14, life: 10 },
  scorch: { size: 0.5, life: 10 },
  scorchLarge: { size: 2.4, life: 14, cell: 'scorch' },
  plasmaScorch: { size: 0.5, life: 10 },
  goo: { size: 1.6, life: 14 },
  acid: { size: 1.9, life: 12 },
  crack: { size: 3.4, life: 3.4 },
}
// loose names other modules may use -> canonical kinds (keys compared lower-case with _ - spaces removed)
export const ALIASES = {
  turretimpact: 'sparks', turretimpactballistic: 'sparks', turretimpactenergy: 'plasmaBurst', energyimpact: 'plasmaBurst', // Tower impactPrefab (Data.cs:109,121)
  impactsparks: 'sparks', spark: 'sparks', impact: 'sparks', hitsparks: 'sparks', env: 'sparks', ballistic: 'sparks', bullet: 'sparks',
  impactgoo: 'goo', goohit: 'goo', flesh: 'goo', blood: 'goo', bughit: 'goo',
  plasma: 'plasmaBurst', impactplasma: 'plasmaBurst', plasmaimpact: 'plasmaBurst', plasmahit: 'plasmaBurst', rail: 'plasmaBurst', railimpact: 'plasmaBurst',
  explosion: 'grenadeBlast', grenade: 'grenadeBlast', explosiongrenade: 'grenadeBlast', blast: 'grenadeBlast', explosive: 'grenadeBlast',
  bugdeathburst: 'bugDeath', death: 'bugDeath', bugspawnburst: 'bugSpawn', spawn: 'bugSpawn',
  elite: 'eliteDeath', bosskill: 'bossDeath', weakpointburst: 'weakPoint', weak: 'weakPoint', bossroarwave: 'roarWave', roar: 'roarWave',
  slam: 'slamShockwave', shockwave: 'slamShockwave', chip: 'armorChip', platelost: 'armorChip',
  wrecked: 'towerWrecked', turretwrecked: 'towerWrecked', turretsmoke: 'towerWrecked', towersmoke: 'towerWrecked',
  tierup: 'tierUpBallistic', turrettierupballistic: 'tierUpBallistic', turrettierupenergy: 'tierUpEnergy', fxupgrade: 'upgrade', upgradegold: 'upgrade',
  impactcore: 'coreHit', corehitfx: 'coreHit', coreimpact: 'coreHit', shieldimpact: 'shieldHit', shielddown: 'shieldBreak',
  barricadehitenergy: 'barricadeHitEnergy', barricadebreakenergy: 'barricadeBreakEnergy', barricadebroken: 'barricadeBreak',
  jumppad: 'jumpPadBurst', jumppadlaunch: 'jumpPadBurst', podimpact: 'podLanding', pod: 'podLanding', podland: 'podLanding', pickup: 'podPickup',
  dodge: 'dodgeDust', roll: 'dodgeDust', footstep: 'footDust', step: 'footDust', land: 'landDust', landing: 'landDust',
  levelup: 'levelUp', reward: 'bossReward', bossreward: 'bossReward', repairfx: 'repair', buildfx: 'build',
  acid: 'acidImpact', acidlob: 'acidSplash', siegeshell: 'siegeImpact', siegemuzzleflash: 'siegeMuzzle',
}
export const MUZZLE_ALIASES = {
  ar: 'ar', ar7: 'ar', rifle: 'ar', bullet: 'ar', plasma: 'plasma', pl2: 'plasma', shotgun: 'shotgun', sg12: 'shotgun', pellet: 'shotgun',
  smg: 'smg', vk9: 'smg', rail: 'rail', marksman: 'rail', rx3: 'rail', lancer: 'rail', gl: 'gl', gl40: 'gl', launcher: 'gl', grenade: 'gl', grenadelauncher: 'gl',
  turretballistic: 'turretBallistic', ballistic: 'turretBallistic', turret: 'turretBallistic', turretmuzzleballistic: 'turretBallistic',
  energy: 'turretEnergy', turretenergy: 'turretEnergy', turretmuzzleenergy: 'turretEnergy',
}
export const TRACER_ALIASES = {
  bullet: 'bullet', ar: 'bullet', ar7: 'bullet', smg: 'bullet', vk9: 'bullet', rifle: 'bullet', player: 'bullet', default: 'bullet',
  pellet: 'pellet', shotgun: 'pellet', sg12: 'pellet', turret: 'turret', ballistic: 'turret', turretballistic: 'turret', tower: 'turret',
}
export const BEAM_ALIASES = {
  rail: 'rail', marksman: 'rail', rx3: 'rail', lancer: 'rail', energy: 'energy', turretenergy: 'energy', energybeam: 'energy', turret: 'energy', tower: 'energy',
}
