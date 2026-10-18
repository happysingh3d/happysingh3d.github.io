// Hive Adapt: Foxfire Watch: the rules, with no rendering. Endless waves of ink bugs attack the foxfire shrine.
// The Ink Fox fights, paper lanterns shoot, and every fifth wave the Hive adapts to the way the shrine is
// defended. Plain arithmetic on plain objects so it can be simulated outside the game (see sim_rules.mjs).

export const ARENA_R = 9.0            // game units; the scene scales this to the lot
export const GATE_R = 9.4
export const PAD_R = 4.7
export const CORE_R = 1.15
export const GATES = 6
export const PADS = 6
export const CHANNELS = ['bolt', 'lantern', 'burst']
export const LANTERN_COST = [15, 20, 35]      // to reach level 1, 2, 3
export const MAX_ALIVE = 90

export const ENEMY = {
  crawler: { hp: 10, spd: 2.7, r: 0.42, dmg: 4, rate: 0.9, reward: 2, cost: 1 },
  rammer: { hp: 48, spd: 1.55, r: 0.72, dmg: 14, rate: 1.4, reward: 6, cost: 3 },
  spitter: { hp: 16, spd: 1.9, r: 0.46, dmg: 6, rate: 2.4, reward: 4, cost: 2, range: 5.4 },
  leech: { hp: 14, spd: 3.1, r: 0.4, dmg: 3, rate: 0.5, reward: 4, cost: 2 },
  queen: { hp: 330, spd: 1.0, r: 1.35, dmg: 25, rate: 1.8, reward: 60, cost: 0 },
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz)

export function gatePos(i) {
  const a = (i / GATES) * Math.PI * 2
  return { x: Math.cos(a) * GATE_R, z: Math.sin(a) * GATE_R, a }
}

export function createGame(seed = 1) {
  const g = {
    rnd: mulberry32(seed),
    t: 0,
    phase: 'prep',            // prep | wave | over
    wave: 0,
    prep: 8.0,
    queue: [], spawnT: 0, gatesOpen: [],
    enemies: [], bolts: [], spits: [],
    nextId: 1,
    bio: 20,
    score: 0, kills: 0,
    core: { hp: 100, max: 100, hit: 0 },
    fox: { x: 0, z: 2.2, vx: 0, vz: 0, hp: 50, max: 50, fire: 0, dash: 0, dashCd: 0, down: 0, face: 0, inv: 0, moving: false },
    pads: [],
    hive: { gen: 0, resist: { bolt: 0, lantern: 0, burst: 0 }, traits: [], nextEvolve: 5 },
    win: { bolt: 0, lantern: 0, burst: 0 },       // damage dealt by channel since the last adaptation
    ev: [],
    boss: null,
    bestWave: 0,
    stats: { shotsFox: 0 },
  }
  for (let i = 0; i < PADS; i++) {
    const a = ((i + 0.5) / PADS) * Math.PI * 2
    g.pads.push({ i, x: Math.cos(a) * PAD_R, z: Math.sin(a) * PAD_R, level: 0, hp: 0, fire: 0, jam: 0, hold: 0, need: false })
  }
  return g
}

function emit(g, type, data) { g.ev.push({ type, ...data }) }

function hpMul(w) { return 1 + 0.08 * (w - 1) + 0.004 * (w - 1) * (w - 1) }

function padMaxHp(level) { return [0, 60, 90, 130][level] }

function spawnEnemy(g, kind, gate, elite = false) {
  const d = ENEMY[kind]
  const gp = gatePos(gate)
  const jitter = (g.rnd() - 0.5) * 1.4
  const e = {
    id: g.nextId++, kind, x: gp.x + Math.cos(gp.a + Math.PI / 2) * jitter, z: gp.z + Math.sin(gp.a + Math.PI / 2) * jitter,
    hp: 0, max: 0, r: d.r * (elite ? 1.22 : 1), spd: d.spd * (1 + 0.04 * g.hive.gen) * (0.92 + g.rnd() * 0.16),
    gen: g.hive.gen, elite, atk: g.rnd() * d.rate, shoot: g.rnd() * d.rate, hurt: 0, phase: g.rnd() * 6.28,
    target: null, spawnT: 0, queenT: 3, rage: false, kx: 0, kz: 0,
  }
  const mul = hpMul(g.wave) * (elite ? 2.2 : 1) * (kind === 'queen' ? 1 + 0.45 * Math.floor(g.wave / 10 - 1) : 1)
  e.max = e.hp = d.hp * mul
  g.enemies.push(e)
  if (kind === 'queen') g.boss = e
  return e
}

function planWave(g) {
  const w = g.wave
  const budget = 6 + 4.2 * w + 0.25 * w * w
  const q = []
  let left = budget
  const want = () => {
    const r = g.rnd()
    if (w >= 6 && r < Math.min(0.14, 0.03 + 0.01 * w)) return 'leech'
    if (w >= 4 && r < Math.min(0.32, 0.12 + 0.02 * w)) return 'spitter'
    if (w >= 3 && r < Math.min(0.52, 0.28 + 0.025 * w)) return 'rammer'
    return 'crawler'
  }
  let guard = 0
  while (left > 0 && guard++ < 400) {
    const k = want()
    const c = ENEMY[k].cost
    if (c > left && k !== 'crawler') continue
    q.push({ kind: k, elite: w >= 3 && g.rnd() < 0.1 })
    left -= c
  }
  g.queue = q
  const n = Math.min(GATES, 1 + Math.floor(w / 2))
  const start = Math.floor(g.rnd() * GATES)
  g.gatesOpen = []
  for (let i = 0; i < n; i++) g.gatesOpen.push((start + i * 2 + (i > 2 ? 1 : 0)) % GATES)
  g.spawnT = 0.6
  if (w % 10 === 0) {
    const gate = g.gatesOpen[0]
    spawnEnemy(g, 'queen', gate)
    emit(g, 'boss', { gate })
  }
  emit(g, 'wave', { wave: w, count: q.length + (w % 10 === 0 ? 1 : 0), gates: g.gatesOpen.slice() })
}

export function hurtEnemy(g, e, raw, ch) {
  const amt = raw * (1 - g.hive.resist[ch])
  e.hp -= amt
  e.hurt = 0.12
  g.win[ch] += raw
  emit(g, 'hit', { id: e.id, x: e.x, z: e.z, ch, amt, resisted: g.hive.resist[ch] > 0.01 })
  if (e.hp <= 0 && !e.dead) {
    e.dead = true
    const d = ENEMY[e.kind]
    const gain = Math.round(d.reward * (e.elite ? 2 : 1))
    g.bio += gain
    g.kills++
    g.score += e.kind === 'queen' ? 500 : 10 * (e.elite ? 3 : 1)
    emit(g, 'kill', { id: e.id, kind: e.kind, x: e.x, z: e.z, gain, elite: e.elite, ch })
    if (e.kind === 'queen') g.boss = null
  }
}

function nearestEnemy(g, x, z, range) {
  let best = null, bd = range * range
  for (const e of g.enemies) {
    if (e.dead) continue
    const d = dist2(x, z, e.x, e.z)
    if (d < bd) { bd = d; best = e }
  }
  return best
}

function damageCore(g, amt, x, z) {
  g.core.hp -= amt
  g.core.hit = 0.25
  emit(g, 'coreHit', { amt, x, z })
  if (g.core.hp <= 0 && g.phase !== 'over') {
    g.core.hp = 0
    g.phase = 'over'
    g.bestWave = Math.max(g.bestWave, g.wave)
    emit(g, 'over', { wave: g.wave, score: g.score, kills: g.kills })
  }
}

function damagePad(g, pad, amt) {
  if (pad.level === 0) return
  pad.hp -= amt
  emit(g, 'padHit', { i: pad.i, x: pad.x, z: pad.z })
  if (pad.hp <= 0) {
    pad.level = 0; pad.hp = 0; pad.jam = 0; pad.hold = 0
    emit(g, 'padLost', { i: pad.i, x: pad.x, z: pad.z })
  }
}

function damageFox(g, amt) {
  const f = g.fox
  if (f.down > 0 || f.inv > 0 || g.phase === 'over') return
  f.hp -= amt
  f.inv = 0.45
  emit(g, 'foxHit', { amt })
  if (f.hp <= 0) {
    f.hp = 0
    f.down = 4.0
    g.bio = Math.max(0, g.bio - 8)
    emit(g, 'foxDown', {})
  }
}

function evolve(g) {
  const h = g.hive
  let top = 'bolt', tv = -1, sum = 0
  for (const c of CHANNELS) { sum += g.win[c]; if (g.win[c] > tv) { tv = g.win[c]; top = c } }
  const share = sum > 0 ? tv / sum : 0
  h.gen++
  h.resist[top] = Math.min(0.65, h.resist[top] + 0.22)
  const name = { bolt: 'Ink Hide', lantern: 'Lantern Veil', burst: 'Quick Scuttle' }[top]
  const tip = { bolt: 'Lean on lanterns and dashes.', lantern: 'Fight with your own foxfire.', burst: 'Mix bolts and lanterns.' }[top]
  h.traits.push(name)
  emit(g, 'evolve', { gen: h.gen, channel: top, share, name, tip, resist: { ...h.resist } })
  g.win = { bolt: 0, lantern: 0, burst: 0 }
}

/** Advance the game by dt seconds. input: { mx, mz (-1..1), dash (bool) }. Events collect in g.ev. */
export function step(g, dt, input = {}) {
  if (g.phase === 'over') return
  dt = Math.min(dt, 0.1)
  g.t += dt
  const f = g.fox
  const core = g.core
  if (core.hit > 0) core.hit -= dt

  // ---- the fox
  f.inv = Math.max(0, f.inv - dt)
  f.dashCd = Math.max(0, f.dashCd - dt)
  f.fire = Math.max(0, f.fire - dt)
  if (f.down > 0) {
    f.down -= dt
    f.moving = false
    if (f.down <= 0) { f.down = 0; f.hp = f.max; f.x = 0; f.z = 2.2; emit(g, 'foxUp', {}) }
  } else {
    let mx = input.mx || 0, mz = input.mz || 0
    const len = Math.hypot(mx, mz)
    if (len > 1) { mx /= len; mz /= len }
    f.moving = len > 0.05
    if (input.dash && f.dashCd <= 0) {
      f.dashCd = 2.8
      f.dash = 0.22
      const dl = f.moving ? 1 : 0
      f.dx = dl ? mx / Math.max(0.001, Math.min(1, len)) : Math.cos(f.face)
      f.dz = dl ? mz / Math.max(0.001, Math.min(1, len)) : Math.sin(f.face)
      const n = Math.hypot(f.dx, f.dz) || 1
      f.dx /= n; f.dz /= n
      f.inv = Math.max(f.inv, 0.3)
      emit(g, 'dash', { x: f.x, z: f.z })
    }
    if (f.dash > 0) {
      f.dash -= dt
      f.x += f.dx * 15 * dt
      f.z += f.dz * 15 * dt
      if (f.dash <= 0) {
        // the nova where the dash ends
        for (const e of g.enemies) {
          if (e.dead) continue
          if (dist2(f.x, f.z, e.x, e.z) < 2.5 * 2.5) {
            hurtEnemy(g, e, 20, 'burst')
            const d = Math.hypot(e.x - f.x, e.z - f.z) || 1
            e.kx += ((e.x - f.x) / d) * 5
            e.kz += ((e.z - f.z) / d) * 5
          }
        }
        emit(g, 'nova', { x: f.x, z: f.z })
      }
    } else {
      f.x += mx * 5.6 * dt
      f.z += mz * 5.6 * dt
    }
    if (mx || mz) f.face = Math.atan2(mz, mx)
    const rr = Math.hypot(f.x, f.z)
    if (rr > ARENA_R - 0.6) { f.x *= (ARENA_R - 0.6) / rr; f.z *= (ARENA_R - 0.6) / rr }
    if (rr < CORE_R + 0.35) { const k = (CORE_R + 0.35) / Math.max(0.001, rr); f.x *= k; f.z *= k }
    // foxfire bolts at the nearest bug
    const tgt = nearestEnemy(g, f.x, f.z, 8.2)
    if (tgt && f.fire <= 0 && f.dash <= 0) {
      f.fire = 0.31
      const a = Math.atan2(tgt.z - f.z, tgt.x - f.x) + (g.rnd() - 0.5) * 0.07
      const dmg = 7 * (1 + 0.04 * (g.wave - 1))
      g.bolts.push({ x: f.x, z: f.z, vx: Math.cos(a) * 16, vz: Math.sin(a) * 16, life: 0.62, dmg, ch: 'bolt', homing: null })
      emit(g, 'shot', { x: f.x, z: f.z, ch: 'bolt' })
    }
    // standing at the shrine mends it, for biomass
    if (dist2(f.x, f.z, 0, 0) < 2.3 * 2.3 && core.hp < core.max && g.bio > 0) {
      const heal = Math.min(core.max - core.hp, 6 * dt)
      core.hp += heal
      g.bio = Math.max(0, g.bio - heal / 4)
      emit(g, 'mend', { x: 0, z: 0 })
    }
  }

  // ---- pads and lanterns
  for (const p of g.pads) {
    p.fire = Math.max(0, p.fire - dt)
    p.jam = Math.max(0, p.jam - dt)
    p.need = false
    const near = f.down <= 0 && dist2(f.x, f.z, p.x, p.z) < 1.15 * 1.15
    if (near && p.level < 3) {
      const cost = LANTERN_COST[p.level]
      if (g.bio >= cost) {
        p.hold += dt
        if (p.hold >= 0.7) {
          g.bio -= cost
          p.level++
          p.hp = padMaxHp(p.level)
          p.hold = 0
          emit(g, p.level === 1 ? 'build' : 'upgrade', { i: p.i, level: p.level, x: p.x, z: p.z })
        }
      } else { p.hold = 0; p.need = true }
    } else if (!near) p.hold = 0
    if (near && p.level > 0 && p.hp < padMaxHp(p.level)) p.hp = Math.min(padMaxHp(p.level), p.hp + 15 * dt)
    if (p.level > 0 && p.jam <= 0 && p.fire <= 0) {
      const range = 6.5 + 0.5 * (p.level - 1)
      const t = nearestEnemy(g, p.x, p.z, range)
      if (t) {
        p.fire = 0.78 / (0.8 + 0.2 * p.level)
        const dmg = 5 * (1 + 0.6 * (p.level - 1))
        const shots = p.level >= 3 ? 2 : 1
        for (let s = 0; s < shots; s++) {
          const a = Math.atan2(t.z - p.z, t.x - p.x) + (s ? 0.18 : 0) - (shots > 1 ? 0.09 : 0)
          g.bolts.push({ x: p.x, z: p.z, vx: Math.cos(a) * 17, vz: Math.sin(a) * 17, life: 0.7, dmg, ch: 'lantern', homing: t.id })
        }
        emit(g, 'shot', { x: p.x, z: p.z, ch: 'lantern' })
      }
    }
  }

  // ---- bolts
  for (const b of g.bolts) {
    if (b.homing) {
      const t = g.enemies.find(e => e.id === b.homing && !e.dead)
      if (t) {
        const sp = Math.hypot(b.vx, b.vz)
        const a = Math.atan2(t.z - b.z, t.x - b.x)
        const ca = Math.atan2(b.vz, b.vx)
        let da = a - ca
        while (da > Math.PI) da -= Math.PI * 2
        while (da < -Math.PI) da += Math.PI * 2
        const na = ca + Math.max(-9 * dt, Math.min(9 * dt, da))
        b.vx = Math.cos(na) * sp; b.vz = Math.sin(na) * sp
      }
    }
    b.x += b.vx * dt; b.z += b.vz * dt
    b.life -= dt
    for (const e of g.enemies) {
      if (e.dead) continue
      if (dist2(b.x, b.z, e.x, e.z) < (e.r + 0.22) * (e.r + 0.22)) {
        hurtEnemy(g, e, b.dmg, b.ch)
        b.life = 0
        break
      }
    }
  }
  g.bolts = g.bolts.filter(b => b.life > 0)

  // ---- spawning and the wave
  if (g.phase === 'prep') {
    g.prep -= dt
    if (g.prep <= 0) { g.wave++; g.phase = 'wave'; planWave(g) }
  } else if (g.phase === 'wave') {
    g.spawnT -= dt
    if (g.queue.length && g.spawnT <= 0 && g.enemies.length < MAX_ALIVE) {
      const s = g.queue.shift()
      const gate = g.gatesOpen[Math.floor(g.rnd() * g.gatesOpen.length)]
      spawnEnemy(g, s.kind, gate, s.elite)
      g.spawnT = Math.max(0.16, 0.7 - 0.02 * g.wave) * (0.7 + g.rnd() * 0.6)
    }
    if (!g.queue.length && !g.enemies.some(e => !e.dead)) {
      g.score += 100 * g.wave
      const bonus = 10 + 2 * g.wave
      g.bio += bonus
      g.bestWave = Math.max(g.bestWave, g.wave)
      emit(g, 'clear', { wave: g.wave, bonus, score: g.score })
      g.phase = 'prep'
      g.prep = 7.0
      if (g.wave >= g.hive.nextEvolve) { g.hive.nextEvolve += 5; evolve(g) }
    }
  }

  // ---- enemies
  for (const e of g.enemies) {
    if (e.dead) continue
    const d = ENEMY[e.kind]
    e.hurt = Math.max(0, e.hurt - dt)
    e.atk -= dt
    e.shoot -= dt
    e.phase += dt * 6
    // knockback
    e.x += e.kx * dt; e.z += e.kz * dt
    e.kx *= Math.max(0, 1 - 6 * dt); e.kz *= Math.max(0, 1 - 6 * dt)
    // pick a target: the core, or a lantern for leeches and spitters
    let tx = 0, tz = 0, tr = CORE_R, tpad = null
    if (e.kind === 'leech' || e.kind === 'spitter') {
      let bd = e.kind === 'leech' ? 1e9 : 8 * 8
      for (const p of g.pads) {
        if (p.level === 0) continue
        const dd = dist2(e.x, e.z, p.x, p.z)
        if (dd < bd) { bd = dd; tpad = p }
      }
      if (tpad) { tx = tpad.x; tz = tpad.z; tr = 0.55 }
    }
    const dx = tx - e.x, dz = tz - e.z
    const dl = Math.hypot(dx, dz) || 1
    const gap = dl - tr - e.r
    const stand = e.kind === 'spitter' ? d.range : 0
    let moving = true
    if (gap <= stand + 0.05) moving = false
    if (e.kind === 'queen' && g.hive.gen >= 0 && e.hp < e.max * 0.5 && !e.rage) { e.rage = true; emit(g, 'rage', { x: e.x, z: e.z }) }
    const sp = e.spd * (e.rage ? 1.6 : 1) * (g.hive.resist.burst > 0.3 ? 1 : 1)
    if (moving) { e.x += (dx / dl) * sp * dt; e.z += (dz / dl) * sp * dt }
    // contact and ranged attacks
    if (!moving) {
      if (e.kind === 'spitter') {
        if (e.shoot <= 0) {
          e.shoot = d.rate
          g.spits.push({ x: e.x, z: e.z, vx: (dx / dl) * 7.5, vz: (dz / dl) * 7.5, life: 2.2, dmg: d.dmg, pad: tpad ? tpad.i : -1 })
          emit(g, 'spit', { x: e.x, z: e.z })
        }
      } else if (e.kind === 'leech') {
        if (tpad) { tpad.jam = Math.max(tpad.jam, 1.2); if (e.atk <= 0) { e.atk = d.rate; damagePad(g, tpad, d.dmg) } }
        else if (e.atk <= 0) { e.atk = d.rate; damageCore(g, d.dmg, e.x, e.z) }
      } else if (e.atk <= 0) {
        e.atk = d.rate
        if (e.kind === 'queen') damageCore(g, d.dmg, e.x, e.z)
        else damageCore(g, d.dmg * (e.elite ? 1.4 : 1), e.x, e.z)
      }
    }
    // chewing on lanterns and the fox as they pass
    if (e.kind !== 'spitter' && e.kind !== 'leech') {
      for (const p of g.pads) {
        if (p.level && dist2(e.x, e.z, p.x, p.z) < (e.r + 0.5) * (e.r + 0.5) && e.atk <= 0) { e.atk = d.rate; damagePad(g, p, d.dmg * 1.3) }
      }
    }
    if (f.down <= 0 && dist2(e.x, e.z, f.x, f.z) < (e.r + 0.4) * (e.r + 0.4) && e.atk <= 0 && e.kind !== 'leech') {
      e.atk = d.rate; damageFox(g, d.dmg)
    }
    if (e.kind === 'queen') {
      e.queenT -= dt
      if (e.queenT <= 0 && g.enemies.length < MAX_ALIVE) {
        e.queenT = e.rage ? 3.0 : 4.5
        for (let k = 0; k < 2; k++) {
          const c = spawnEnemy(g, 'crawler', 0)
          c.x = e.x + (k ? 0.9 : -0.9); c.z = e.z + 0.5
        }
        emit(g, 'brood', { x: e.x, z: e.z })
      }
    }
  }
  g.enemies = g.enemies.filter(e => !e.dead)

  // ---- ink spit
  for (const s of g.spits) {
    s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt
    if (f.down <= 0 && dist2(s.x, s.z, f.x, f.z) < 0.55 * 0.55) { damageFox(g, s.dmg); s.life = 0; continue }
    if (dist2(s.x, s.z, 0, 0) < (CORE_R + 0.2) * (CORE_R + 0.2)) { damageCore(g, s.dmg, s.x, s.z); s.life = 0; continue }
    for (const p of g.pads) {
      if (p.level && dist2(s.x, s.z, p.x, p.z) < 0.55 * 0.55) { damagePad(g, p, s.dmg); s.life = 0; break }
    }
  }
  g.spits = g.spits.filter(s => s.life > 0)
}

/** The dominant habit right now: shares of damage by channel since the last adaptation. */
export function habits(g) {
  const sum = g.win.bolt + g.win.lantern + g.win.burst
  if (sum <= 0) return { bolt: 0, lantern: 0, burst: 0 }
  return { bolt: g.win.bolt / sum, lantern: g.win.lantern / sum, burst: g.win.burst / sum }
}
