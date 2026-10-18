// Logical metres. Rendering scales this district to the host lot.
export const HAVEN = { x: -24, z: 12, radius: 3.2 };
export const BEACON = { x: -24, z: 10.5 };
export const CONSOLE = { x: 16, z: -11 };
export const BRIDGES = [-10, 12];
export const PEOPLE = [
  { id: 'wisp', name: 'Wisp', role: 'Scout', x: -23, z: -12, cost: 0,
    color: '#6ee7ff', greeting: 'My navigation is gone. Stay close — I can follow your light.',
    home: 'A safe signal! I will guide the next arrivals from here.' },
  { id: 'pulse', name: 'Pulse', role: 'Medic', x: 21, z: 9, cost: 2,
    color: '#ffa8d7', greeting: 'Two cells will restart my legs. Then we can leave together.',
    home: 'Thank you. Haven has a medic again. Nobody gets left behind.' },
  { id: 'rook', name: 'Rook', role: 'Engineer', x: 24, z: -11, cost: 0,
    color: '#ffd479', greeting: 'You opened the yard! Get me home and I can restore the beacon.',
    home: 'All systems ready. Bring everyone in, then light the beacon.' }
];
export const CELLS = [
  { x: -21, z: 5 }, { x: -22, z: -9 }, { x: -6, z: -5 },
  { x: 14, z: 5 }, { x: 10, z: -9 }, { x: 25, z: 4.5 }
];
export const BUILDINGS = [
  { x: -26, z: -5, w: 5, d: 5, h: 7, label: 'MOTH / CAFE' },
  { x: -16, z: -13, w: 8, d: 6, h: 8, label: 'RELAY / 04' },
  { x: 0, z: -14, w: 13, d: 8, h: 9, label: 'SIGNAL WORKS' },
  { x: -14, z: 15, w: 6, d: 5, h: 5, label: 'NIGHT MARKET' },
  { x: 5, z: 13, w: 9, d: 8, h: 6, label: 'DISTRICT 07' },
  { x: 25, z: 16, w: 10, d: 4, h: 7, label: 'FREIGHT / EAST' }
];
export const YARD_WALLS = [
  { x: 23, z: -15, w: 10.6, d: .5, h: 1.6 },
  { x: 28, z: -11, w: .5, d: 8, h: 1.6 },
  { x: 23, z: -7, w: 10.6, d: .5, h: 1.6 },
  { x: 18, z: -14, w: .5, d: 2, h: 1.6 },
  { x: 18, z: -8, w: .5, d: 2, h: 1.6 }
];
export const GATE = { x: 18, z: -11, w: .5, d: 4, h: 2.5 };
export const HAZARDS = [
  { x: -10, z: 0, radius: 1.25, phase: 0 },
  { x: 12, z: -4, radius: 1.45, phase: 1.1 },
  { x: 17, z: 7, radius: 1.25, phase: 2.2 },
  { x: -22, z: -6, radius: 1.1, phase: .6 }
];
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const hazardActive = (h, time) => (time + h.phase) % 3.6 < 1.1;

export function walkable(x, z, gateOpen = false, radius = .42) {
  if (Math.abs(x) > 30.8 - radius || Math.abs(z) > 18.8 - radius) return false;
  if (Math.abs(z) < 2.2 + radius && !BRIDGES.some(b => Math.abs(x - b) < 2.5 - radius)) return false;
  const obstacles = gateOpen ? [...BUILDINGS, ...YARD_WALLS] : [...BUILDINGS, ...YARD_WALLS, GATE];
  return !obstacles.some(b => Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius);
}
