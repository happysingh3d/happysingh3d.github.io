import { HAVEN, BEACON, CONSOLE, PEOPLE, CELLS, HAZARDS, distance, walkable, hazardActive } from './world.js';

export function createMission(best = null) {
  return { phase: 'ready', time: 0, best, hero: { x: -24, z: 15, yaw: Math.PI, energy: 100 },
    people: PEOPLE.map((p, i) => ({ ...p, status: 'stranded', trail: [], slot: i })),
    cells: CELLS.map(p => ({ ...p, collected: false })), inventory: 0,
    gateOpen: false, escort: null, rescued: 0, recoveries: 0, invulnerable: 0,
    target: null, progress: 0, message: 'The city is dark. Three friends are waiting for your light.',
    messageTime: 7, events: [], sprinting: false, moving: false };
}

function say(s, text, seconds = 4) { s.message = text; s.messageTime = seconds; }
function emit(s, type, id = '') { s.events.push({ type, id }); }
export function safePosition(person) {
  return [{ x: -27, z: 12.5 }, { x: -25.5, z: 15.2 }, { x: -22.5, z: 14.9 }][person.slot];
}
function recover(s) {
  const h = s.hero;
  h.x = -24; h.z = 15; h.energy = 65; s.recoveries++;
  if (s.escort) {
    const p = s.people.find(p => p.id === s.escort), origin = PEOPLE.find(p => p.id === s.escort);
    p.x = origin.x; p.z = origin.z; p.status = 'stranded'; p.trail = []; s.escort = null;
  }
  s.invulnerable = 2; s.target = null; s.progress = 0;
  say(s, 'Haven recovered your signal. Your friend is waiting where you met them.');
  emit(s, 'recover');
}
function moveHero(s, input, dt) {
  let x = Number(input.x) || 0, z = Number(input.z) || 0;
  const length = Math.hypot(x, z);
  if (length > 1) { x /= length; z /= length; }
  s.moving = length > .05;
  s.sprinting = s.moving && !!input.sprint && s.hero.energy > 1;
  const speed = s.sprinting ? 7.7 : 4.5;
  if (s.sprinting) s.hero.energy = Math.max(0, s.hero.energy - 8 * dt);
  if (!s.moving) return;
  s.hero.yaw = Math.atan2(x, z);
  // Substeps prevent crossing a thin wall at low frame rates. Slide along walls.
  const steps = Math.max(1, Math.ceil(speed * dt / .15));
  for (let i = 0; i < steps; i++) {
    const dx = x * speed * dt / steps, dz = z * speed * dt / steps;
    if (walkable(s.hero.x + dx, s.hero.z, s.gateOpen)) s.hero.x += dx;
    if (walkable(s.hero.x, s.hero.z + dz, s.gateOpen)) s.hero.z += dz;
  }
}
function moveEscort(s, dt) {
  if (!s.escort) return;
  const p = s.people.find(p => p.id === s.escort);
  const tail = p.trail[p.trail.length - 1];
  if (!tail || distance(tail, s.hero) > .3) p.trail.push({ x: s.hero.x, z: s.hero.z });
  // Cap the trail without losing its next waypoint; the player cannot fill it in an ordinary run.
  if (p.trail.length > 1200) p.trail.splice(600, 1);
  let budget = dt * 5.2;
  while (budget > 0 && p.trail.length) {
    const target = p.trail[0], d = distance(p, target);
    if (d < .02) { p.trail.shift(); continue; }
    if (p.trail.length === 1 && d < 1.05) break;
    const step = Math.min(budget, d);
    const x = p.x + (target.x - p.x) / d * step;
    const z = p.z + (target.z - p.z) / d * step;
    p.yaw = Math.atan2(target.x - p.x, target.z - p.z);
    if (walkable(x, z, s.gateOpen, .3)) { p.x = x; p.z = z; }
    else break;
    budget -= step;
    if (step >= d) p.trail.shift();
  }
  if (distance(p, HAVEN) < HAVEN.radius && distance(s.hero, HAVEN) < HAVEN.radius) {
    p.status = 'safe'; Object.assign(p, safePosition(p)); p.trail = [];
    s.escort = null; s.rescued++; emit(s, 'deliver', p.id); say(s, `${p.name}: ${p.home}`, 6);
  }
}
function targetAt(s) {
  if (!s.gateOpen && distance(s.hero, CONSOLE) < 1.9) return { id: 'gate', seconds: 1.25, cost: 1 };
  if (!s.escort) {
    const p = s.people.find(p => p.status === 'stranded' && distance(s.hero, p) < 2.2);
    if (p) return { id: p.id, seconds: 1.2, cost: p.cost };
  }
  if (s.rescued === 3 && distance(s.hero, BEACON) < 2.8) return { id: 'beacon', seconds: 2, cost: 0 };
  return null;
}

export function updateMission(s, input = {}, delta = 0) {
  s.events = [];
  const dt = Math.max(0, Math.min(Number(delta) || 0, .1));
  if (s.phase === 'won') return s;
  if (s.phase === 'ready') {
    if (!input.start && !(Math.abs(input.x || 0) + Math.abs(input.z || 0) > .05)) return s;
    s.phase = 'playing'; say(s, 'First signal: Wisp is west of the canal. Cells glow gold.', 6); emit(s, 'start');
  }
  s.time += dt; s.messageTime = Math.max(0, s.messageTime - dt);
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  moveHero(s, input, dt);
  if (distance(s.hero, HAVEN) < HAVEN.radius) s.hero.energy = Math.min(100, s.hero.energy + 22 * dt);
  for (const c of s.cells) if (!c.collected && distance(s.hero, c) < 1.2) {
    c.collected = true; s.inventory++; say(s, `Power cell recovered. Carrying ${s.inventory}.`); emit(s, 'pickup');
  }
  if (!s.invulnerable && HAZARDS.some(h => hazardActive(h, s.time) && distance(s.hero, h) < h.radius + .25)) {
    s.hero.energy = Math.max(0, s.hero.energy - 22); s.invulnerable = 1.1;
    emit(s, 'damage'); say(s, 'Arc surge! Wait for a dark ring, or take another route.');
    if (s.hero.energy <= 0) recover(s);
  }
  moveEscort(s, dt);
  const target = targetAt(s);
  if (!target || s.moving) { s.target = null; s.progress = 0; return s; }
  if (s.target !== target.id) { s.target = target.id; s.progress = 0; }
  if (s.inventory < target.cost) { s.progress = 0; return s; }
  s.progress += dt / target.seconds;
  if (s.progress < 1) return s;
  s.inventory -= target.cost; s.target = null; s.progress = 0;
  if (target.id === 'gate') {
    s.gateOpen = true; emit(s, 'repair'); say(s, 'Yard power restored. Rook is through the gate.');
  } else if (target.id === 'beacon') {
    s.phase = 'won'; s.best = s.best === null ? s.time : Math.min(s.best, s.time);
    say(s, 'Wisp, Pulse and Rook are home. You brought the city back.', Infinity); emit(s, 'win');
  } else {
    const p = s.people.find(p => p.id === target.id);
    p.status = 'following'; p.trail = [{ x: s.hero.x, z: s.hero.z }]; s.escort = p.id;
    emit(s, 'join', p.id); say(s, `${p.name}: ${p.greeting}`, 6);
  }
  return s;
}

export function objective(s) {
  if (s.phase === 'ready') return { title: 'NEON RESCUE', detail: 'Bring three friends home. Then restore the beacon.', hint: 'Move to begin · WASD / arrows · Shift sprint' };
  if (s.phase === 'won') return { title: 'EVERYONE IS HOME', detail: 'The signal is yours. A district has its light again.', hint: 'R or tap to replay · session best recorded' };
  if (s.target === 'gate') return { title: s.inventory ? 'RESTORE THE YARD' : 'ONE CELL NEEDED', detail: 'Stand still beside this console to power the gate.', hint: s.inventory ? 'Repairing…' : 'Look for a gold floating power cell.' };
  if (s.target === 'beacon') return { title: 'LIGHT THE BEACON', detail: 'Stay here while Rook restores the city signal.', hint: 'Restoring…' };
  if (s.target) {
    const p = s.people.find(p => p.id === s.target);
    return { title: s.inventory < p.cost ? `${p.name.toUpperCase()} NEEDS ${p.cost} CELLS` : `HELP ${p.name.toUpperCase()}`,
      detail: p.greeting, hint: s.inventory < p.cost ? `You have ${s.inventory}. Search the streets for gold cells.` : 'Stand still to help your friend.' };
  }
  if (s.escort) {
    const p = s.people.find(p => p.id === s.escort);
    return { title: `BRING ${p.name.toUpperCase()} HOME`, detail: 'Follow the green Haven marker. Your friend follows your path.', hint: distance(p, s.hero) > 4 ? 'Slow down — your friend is catching up.' : 'Cross at a bridge. Avoid bright arc rings.' };
  }
  if (s.rescued === 3) return { title: 'RESTORE THE BEACON', detail: 'All three friends are safe. Meet Rook at Haven’s beacon.', hint: 'Stand still beside the green signal tower.' };
  const locations = { wisp: 'Wisp: west', pulse: 'Pulse: east, needs 2 cells', rook: 'Rook: north-east yard' };
  return { title: `FRIENDS HOME  ${s.rescued} / 3`,
    detail: s.people.filter(p => p.status !== 'safe').map(p => locations[p.id]).join(' · '),
    hint: 'Stand still beside a friend to help. Haven recharges your battery.' };
}
