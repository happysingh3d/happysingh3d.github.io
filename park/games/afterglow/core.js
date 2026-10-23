// core.js — The Last Lighthouse: Afterglow · pure deterministic gameplay core (ES module, no deps).
// No DOM, network, filesystem, eval, timers, rewards or Math.random. Same seed + same inputs → same state.
//
// Space: metres. x ∈ [-16,16] (east), z ∈ [-10,10]. Lamp bearing 0 points +x; positive bearings turn toward +z.
// Grid: Float32Array(64*40) of glow 0..1, index = j*64 + i, cell centre x = -16+(i+.5)*.5, z = -10+(j+.5)*.5.
// Input per step: { sweep: -1..1 turn rate, lift: 0..1 lamp-height target, flare: true (edge-triggered) }.
// run.events = what happened during the latest step only; run.tick changes only when a step actually ran.
// Fry statuses: hidden → waiting (unlit) ⇄ moving (lit, flying home) → stranded (drifting out) → saved | lost.

export const CONFIG = Object.freeze({
  W: 32, D: 20, GW: 64, GH: 40, CELL: 0.5,
  lampX: -10, lampZ: 0, range: 24, angleLimit: 1.35,
  sweepRate: 1.2,                 // rad/s at |sweep| = 1
  liftRate: 2.5,                  // lift units/s toward the requested lift (lamp elevator travel)
  beamHalf: 0.09,                 // rad, beam half-angle
  beamMinHalfWidth: 0.6,          // m, keeps the beam usable close to the lamp
  paintLow: 1.0, paintHigh: 0.7,  // glow painted at lift 0 / lift 1 (high lamp = dimmer wake)
  fadeLow: 0.25, fadeHigh: 0.5,   // glow lost per second at lift 0 / lift 1 (high lamp = shorter wake)
  litT: 0.25, warnT: 0.45, fullSpeedGlow: 0.7,
  frySpeed: 2.6, homeR: 1.8, strandT: 3, driftSpeed: 0.4,
  edgeMargin: 0.5, spawnMargin: 2, flyY: 4,
  flares: 2, calmT: 6,
  squallR: 4, squallVX: -0.12, squallVZ: 0.42, squallDrain: 1.2,
  groupAAt: 10, groupBAt: 35, limit: 90, maxDt: 0.05,
  stars: Object.freeze([3, 5, 7]), // saved fry needed for 1 / 2 / 3 stars
});
const C = CONFIG;
const N = C.GW * C.GH;

// clear = lamp lift needed to shine past it; top = suggested rock height (m) for the renderer.
const OCCLUDERS = [
  { id: 'stack', kind: 'stack', x: -2.75, z: -4.44, r: 1.3, clear: 0.7, top: 8 },
  { id: 'reef-north', kind: 'reef', x: -1.78, z: 3.67, r: 0.8, clear: 0.35, top: 3.8 },
  { id: 'reef-tutorial', kind: 'reef', x: 3.5, z: -1.6, r: 0.7, clear: 0.35, top: 3.8 },
];
// [bearing rad, distance m, spawn s, group]. The tutorial fry sits exactly on the lamp's initial bearing (0).
const FRY = [
  [0, 12, 0, 'tutorial'],
  [0.6, 11, C.groupAAt, 'A'], [-0.55, 13, C.groupAAt, 'A'], [0.25, 19, C.groupAAt, 'A'], // A2 hides behind the stack
  [0.95, 8, C.groupBAt, 'B'], [-0.25, 17, C.groupBAt, 'B'], [0.4, 15, C.groupBAt, 'B'],  // B arrives with the squall; B3 hides behind a reef
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Static per-cell geometry relative to the (fixed) lamp.
const CELL_X = new Float64Array(N), CELL_Z = new Float64Array(N);
const CELL_ANG = new Float64Array(N), CELL_DIST = new Float64Array(N);
for (let j = 0; j < C.GH; j++) for (let i = 0; i < C.GW; i++) {
  const c = j * C.GW + i;
  CELL_X[c] = -C.W / 2 + (i + 0.5) * C.CELL;
  CELL_Z[c] = -C.D / 2 + (j + 0.5) * C.CELL;
  CELL_ANG[c] = Math.atan2(CELL_Z[c] - C.lampZ, CELL_X[c] - C.lampX);
  CELL_DIST[c] = Math.hypot(CELL_X[c] - C.lampX, CELL_Z[c] - C.lampZ);
}

export function cellIndex(x, z) {
  const i = clamp(Math.floor((num(x, 0) + C.W / 2) / C.CELL), 0, C.GW - 1);
  const j = clamp(Math.floor((num(z, 0) + C.D / 2) / C.CELL), 0, C.GH - 1);
  return j * C.GW + i;
}
export const sampleGlow = (run, x, z) => run.grid[cellIndex(x, z)];

function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// shade[c] = lift needed for the beam to reach cell c (0 = never shadowed).
function buildShade(occ) {
  const shade = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const dx = CELL_X[c] - C.lampX, dz = CELL_Z[c] - C.lampZ, len2 = dx * dx + dz * dz || 1e-9;
    for (const o of occ) {
      const t = clamp(((o.x - C.lampX) * dx + (o.z - C.lampZ) * dz) / len2, 0, 1);
      const qx = C.lampX + dx * t - o.x, qz = C.lampZ + dz * t - o.z;
      if (qx * qx + qz * qz <= o.r * o.r && o.clear > shade[c]) shade[c] = o.clear;
    }
  }
  return shade;
}

// Reachable spawn: inside lamp range and sweep limits, inside the world with margin, clear of every rock.
// Every rock's `clear` ≤ 1 and flares ignore shadow, so every spawn has a lightable radial corridor home.
function place(b, d, occ) {
  const lim = C.angleLimit - 0.1, m = C.spawnMargin, minD = C.homeR + 4;
  b = clamp(b, -lim, lim);
  for (d = clamp(d, minD, C.range - 3); d > minD; d -= 0.25) {
    const x = C.lampX + d * Math.cos(b), z = C.lampZ + d * Math.sin(b);
    if (Math.abs(x) <= C.W / 2 - m && Math.abs(z) <= C.D / 2 - m &&
        occ.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 0.6)) return { x, z };
  }
  return { x: C.lampX + minD * Math.cos(b), z: C.lampZ + minD * Math.sin(b) }; // in front of every rock
}

// Suggested flight height so fry clear rocks they cross (renderer may ignore).
function hover(occ, x, z) {
  let y = C.flyY;
  for (const o of occ) {
    const k = clamp((o.r + 2 - Math.hypot(x - o.x, z - o.z)) / 2, 0, 1);
    if (k > 0) y = Math.max(y, C.flyY + (o.top + 1 - C.flyY) * k * k * (3 - 2 * k));
  }
  return y;
}

export function createRun(seed = 1) {
  const s = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : 1;
  const rand = mulberry32(s);
  const occluders = OCCLUDERS.map((o) => ({ ...o }));
  const fries = FRY.map(([b, d, spawnAt, group], k) => {
    const jb = group === 'tutorial' ? 0 : (rand() - 0.5) * 0.06; // seed only nudges spawns slightly
    const p = place(b + jb, d + (rand() - 0.5) * 1.2, occluders);
    return { id: k + 1, group, spawnAt, x: p.x, z: p.z, y: hover(occluders, p.x, p.z),
      status: 'hidden', dark: 0, glow: 0, warned: false };
  });
  return {
    seed: s, tick: 0, elapsed: 0, limit: C.limit, phase: 'tutorial', done: false,
    world: { width: C.W, depth: C.D },
    grid: new Float32Array(N),
    lamp: { x: C.lampX, z: C.lampZ, angle: 0, range: C.range, lift: 0, halfAngle: C.beamHalf },
    occluders, shade: buildShade(occluders), fries,
    squall: { active: false, passed: false, x: 9.5 + (rand() - 0.5) * 2, z: -C.D / 2 + 0.5,
      r: C.squallR, vx: C.squallVX, vz: C.squallVZ, calm: 0 },
    saved: 0, lost: 0, total: fries.length, flares: C.flares, flareHeld: false,
    stars: 0, score: 0, events: [],
  };
}

export function step(run, dt, input) {
  if (!run || run.done) return run; // finished runs are frozen: no field changes at all
  dt = Math.min(clamp(num(dt, 0), 0, C.maxDt), C.limit - run.elapsed);
  if (dt <= 0) return run; // Codex: paused/invalid time must not mutate state or spend a flare.
  const inp = input || {};
  const sweep = clamp(num(inp.sweep, 0), -1, 1);
  const liftIn = clamp(num(inp.lift, 0), 0, 1);
  const flare = inp.flare === true;
  const ev = run.events;
  ev.length = 0;
  run.tick++;
  run.elapsed += dt;
  const emit = (type, extra) => ev.push({ type, t: run.elapsed, ...extra });

  // Lamp: sweep turns it, lift eases toward the request.
  const lamp = run.lamp, prevAngle = lamp.angle;
  lamp.angle = clamp(lamp.angle + sweep * C.sweepRate * dt, -C.angleLimit, C.angleLimit);
  lamp.lift = clamp(lamp.lift + clamp(liftIn - lamp.lift, -C.liftRate * dt, C.liftRate * dt), 0, 1);

  // Flare: fires once per press (rising edge), full-radius pulse that ignores shadow and calms the squall.
  if (flare && !run.flareHeld) {
    if (run.flares > 0) {
      run.flares--;
      for (let c = 0; c < N; c++) if (CELL_DIST[c] <= C.range) run.grid[c] = 1;
      run.squall.calm = C.calmT;
      emit('flare', { left: run.flares });
    } else emit('flareEmpty');
  }
  run.flareHeld = flare;

  // Squall: drifts across once, absorbing the beam and draining glow unless calmed by a flare.
  const sq = run.squall;
  if (sq.calm > 0) {
    sq.calm = Math.max(0, sq.calm - dt);
    if (sq.calm === 0 && sq.active) emit('squall', { state: 'stirs' });
  }
  if (!sq.active && !sq.passed && run.elapsed >= C.groupBAt) { sq.active = true; emit('squall', { state: 'in' }); }
  if (sq.active) {
    sq.x += sq.vx * dt;
    sq.z += sq.vz * dt;
    if (sq.z - sq.r > C.D / 2 || sq.x + sq.r < -C.W / 2) { sq.active = false; sq.passed = true; emit('squall', { state: 'out' }); }
  }
  const absorbing = sq.active && sq.calm <= 0;

  // Glow: fade everywhere, then paint the arc swept this step (no gaps at any sweep speed).
  const g = run.grid, lift = lamp.lift, r2 = sq.r * sq.r;
  const fade = (C.fadeLow + (C.fadeHigh - C.fadeLow) * lift) * dt;
  const paint = C.paintLow + (C.paintHigh - C.paintLow) * lift;
  const a0 = Math.min(prevAngle, lamp.angle), a1 = Math.max(prevAngle, lamp.angle);
  for (let c = 0; c < N; c++) {
    const inSquall = absorbing && (CELL_X[c] - sq.x) ** 2 + (CELL_Z[c] - sq.z) ** 2 <= r2;
    let v = g[c] - fade - (inSquall ? C.squallDrain * dt : 0);
    const d = CELL_DIST[c];
    if (!inSquall && d <= C.range && run.shade[c] <= lift) {
      const w = Math.max(C.beamHalf, C.beamMinHalfWidth / Math.max(d, 1e-3));
      if (CELL_ANG[c] >= a0 - w && CELL_ANG[c] <= a1 + w && v < paint) v = paint;
    }
    g[c] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Fry: lit → fly straight home along their own bearing (the beam's corridor); dark → hover, then drift out.
  for (const f of run.fries) {
    if (f.status === 'hidden') {
      if (run.elapsed < f.spawnAt) continue;
      f.status = 'waiting';
      emit('spawn', { id: f.id });
    }
    if (f.status === 'saved' || f.status === 'lost') continue;
    const glow = (f.glow = sampleGlow(run, f.x, f.z));
    const dist = Math.max(Math.hypot(f.x - C.lampX, f.z - C.lampZ), 1e-6);
    const ux = (f.x - C.lampX) / dist, uz = (f.z - C.lampZ) / dist;
    if (glow >= C.litT) {
      if (f.status !== 'moving') emit('lit', { id: f.id });
      f.status = 'moving';
      f.dark = 0;
      const nd = Math.max(C.homeR, dist - C.frySpeed * Math.min(1, glow / C.fullSpeedGlow) * dt);
      f.x = C.lampX + ux * nd;
      f.z = C.lampZ + uz * nd;
      if (glow < C.warnT && !f.warned) { f.warned = true; emit('fadeWarning', { id: f.id }); }
      else if (glow >= C.warnT + 0.1) f.warned = false;
      if (nd <= C.homeR) { f.status = 'saved'; run.saved++; emit('saved', { id: f.id }); }
    } else {
      f.dark += dt;
      if (f.status === 'moving') f.status = 'waiting';
      if (f.dark >= C.strandT) {
        if (f.status !== 'stranded') { f.status = 'stranded'; emit('stranded', { id: f.id }); }
        const nd = dist + C.driftSpeed * dt;
        f.x = C.lampX + ux * nd;
        f.z = C.lampZ + uz * nd;
        if (Math.abs(f.x) > C.W / 2 - C.edgeMargin || Math.abs(f.z) > C.D / 2 - C.edgeMargin || nd > C.range) {
          f.status = 'lost'; run.lost++; emit('lost', { id: f.id, reason: 'drift' });
        }
      }
    }
    f.y = hover(run.occluders, f.x, f.z);
  }

  const phase = run.elapsed < C.groupAAt ? 'tutorial' : sq.active ? 'squall' : 'archipelago';
  if (phase !== run.phase) { run.phase = phase; emit('phase', { phase }); }
  if (run.saved + run.lost === run.total || run.elapsed >= C.limit) finish(run, emit);
  return run;
}

function finish(run, emit) {
  for (const f of run.fries) {
    if (f.status !== 'saved' && f.status !== 'lost') { f.status = 'lost'; run.lost++; emit('lost', { id: f.id, reason: 'night' }); }
  }
  run.stars = C.stars.filter((n) => run.saved >= n).length;
  const timeBonus = run.saved === run.total ? Math.round((C.limit - run.elapsed) * 10) : 0;
  run.score = run.saved * 1000 + run.stars * 500 + run.flares * 100 + timeBonus;
  run.phase = 'done';
  run.done = true;
  emit('finished', { saved: run.saved, lost: run.lost, stars: run.stars, score: run.score });
}
