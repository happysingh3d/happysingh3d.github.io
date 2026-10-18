import * as THREE from 'three';
import { HAVEN, BEACON, PEOPLE, BUILDINGS, BRIDGES, HAZARDS, CONSOLE, hazardActive } from './world.js';
import { objective } from './mission.js';

export function clock(seconds) {
  const value = Math.max(0, seconds || 0);
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
}
export function createHud(p0, scale) {
  const canvas = new OffscreenCanvas(1024, 768), ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = texture.magFilter = THREE.LinearFilter;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const panel = new THREE.Mesh(geometry, material); panel.renderOrder = 10000; panel.frustumCulled = false; p0.scene.add(panel);
  let lastDraw = -1, lastPhase = '', lastW = 0, lastH = 0;
  function text(value, x, y, size = 15, color = '#d5e8ed', weight = 'normal') {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px monospace`; ctx.fillText(value, x, y);
  }
  function rect(x, y, w, h, color, stroke = '#355666') {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  }
  function wrap(value, x, y, max, size = 14, color = '#d5e8ed', line = 20) {
    ctx.font = `${size}px monospace`; let current = '', rows = 0;
    for (const word of value.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > max && current) { text(current, x, y + rows++ * line, size, color); current = word; }
      else current = candidate;
    }
    if (current) text(current, x, y + rows++ * line, size, color);
    return rows * line;
  }
  function minimap(s, x, y, w, h) {
    rect(x, y, w, h, '#071927e8');
    text('DISTRICT / 07', x + 10, y + 18, 11, '#799baa');
    const mx = n => x + 8 + (n + 32) / 64 * (w - 16);
    const mz = n => y + 26 + (n + 20) / 40 * (h - 34);
    ctx.fillStyle = '#164052'; ctx.fillRect(mx(-32), mz(-2.2), w - 16, mz(2.2) - mz(-2.2));
    ctx.fillStyle = '#587484'; for (const b of BRIDGES) ctx.fillRect(mx(b - 2.5), mz(-2.3), mx(b + 2.5) - mx(b - 2.5), mz(2.3) - mz(-2.3));
    ctx.fillStyle = '#2b4656';
    for (const b of BUILDINGS) ctx.fillRect(mx(b.x - b.w / 2), mz(b.z - b.d / 2), mx(b.x + b.w / 2) - mx(b.x - b.w / 2), mz(b.z + b.d / 2) - mz(b.z - b.d / 2));
    for (const h of HAZARDS) {
      ctx.strokeStyle = hazardActive(h, s.time) ? '#ff975e' : '#536979'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(mx(h.x), mz(h.z), 4, 0, Math.PI * 2); ctx.stroke();
    }
    const dot = (p, color, radius) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(mx(p.x), mz(p.z), radius, 0, Math.PI * 2); ctx.fill(); };
    dot(HAVEN, '#9fffd0', 6); text('H', mx(HAVEN.x) - 3, mz(HAVEN.z) + 3, 10, '#12332f', 'bold');
    if (!s.gateOpen) { dot(CONSOLE, '#ffca70', 3); }
    for (const c of s.cells) if (!c.collected) { ctx.fillStyle = '#ffcd79'; ctx.fillRect(mx(c.x) - 2, mz(c.z) - 2, 4, 4); }
    for (const p of s.people) if (p.status !== 'safe') { dot(p, p.color, 4); text(p.name[0], mx(p.x) + 5, mz(p.z) + 3, 10, p.color); }
    dot(s.hero, '#ffffff', 3); ctx.strokeStyle = '#ffffff'; ctx.beginPath();
    ctx.moveTo(mx(s.hero.x), mz(s.hero.z)); ctx.lineTo(mx(s.hero.x) + Math.sin(s.hero.yaw) * 7, mz(s.hero.z) + Math.cos(s.hero.yaw) * 7); ctx.stroke();
  }
  function draw(s, width, height) {
    const w = Math.max(320, Math.min(1600, width)), h = Math.max(240, Math.min(1200, height));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const compact = w < 600 || h > w * 1.15, margin = 14, top = 62;
    const ow = compact ? w - margin * 2 : Math.min(420, w * .55);
    const o = objective(s);
    rect(margin, top, ow, compact ? 124 : 146, '#081824e8');
    text(o.title, margin + 14, top + 26, compact ? 17 : 21, '#9fffd0', 'bold');
    const used = wrap(o.detail, margin + 14, top + 50, ow - 28, compact ? 12 : 14, '#e0eff1', compact ? 16 : 20);
    wrap(compact && s.phase === 'ready' ? 'Drag the stick to move · its rim sprints' : o.hint,
      margin + 14, top + 55 + used, ow - 28, 11, '#ffcd79', 15);
    if (s.progress > 0) {
      rect(margin + 14, top + (compact ? 111 : 132), ow - 28, 4, '#284457', '#284457');
      ctx.fillStyle = '#9fffd0'; ctx.fillRect(margin + 14, top + (compact ? 111 : 132), (ow - 28) * s.progress, 4);
    }
    const mw = compact ? 145 : 218, mh = compact ? 115 : 164;
    minimap(s, w - mw - margin, compact ? top + 138 : top, mw, mh);
    if (s.messageTime > 0 && s.phase !== 'ready' && s.phase !== 'won') {
      const dw = compact ? w - 28 : Math.min(560, w - 42), dx = (w - dw) / 2;
      const dy = h - (compact ? 288 : 138);
      rect(dx, dy, dw, compact ? 61 : 58, '#0b2030ed', '#617e8b');
      wrap(s.message, dx + 12, dy + 21, dw - 24, compact ? 12 : 14, '#f5e6c2', 17);
    }
    // Reserve the phone's lower-left 140px for Project 0's touch stick.
    const sw = compact ? w - 28 : 450, sx = (w - sw) / 2, sy = h - (compact ? 214 : 75);
    rect(sx, sy, sw, 62, '#081824ed');
    text(`CELLS ${s.inventory}   HOME ${s.rescued}/3   ${clock(s.time)}`, sx + 12, sy + 20, compact ? 12 : 14, '#e1eff4', 'bold');
    text('POWER', sx + 12, sy + 40, 11, '#96b8c4');
    const bw = compact ? 94 : 140;
    ctx.fillStyle = '#294653'; ctx.fillRect(sx + 65, sy + 31, bw, 8);
    ctx.fillStyle = s.hero.energy < 25 ? '#ff9767' : '#9fffd0'; ctx.fillRect(sx + 65, sy + 31, bw * s.hero.energy / 100, 8);
    text(`${Math.ceil(s.hero.energy)}%`, sx + 71 + bw, sy + 40, 11, '#d6e8ee');
    const namesX = compact ? sx + 12 : sx + 260, namesY = compact ? sy + 54 : sy + 40;
    s.people.forEach((p, i) => text(`${p.status === 'safe' ? '+' : p.status === 'following' ? '>' : '·'}${p.name}`, namesX + i * 60, namesY, 10, p.color));
    if (!compact) text('WASD / arrows · Shift sprint · stand still to help · R retry', 18, h - 14, 11, '#b0cad4');
    if (s.phase === 'won') {
      if (compact) {
        const xx = 14, yy = top + 138, ww = w - mw - 42;
        rect(xx, yy, ww, 115, '#0c2331f5', '#9fffd0');
        text('RESCUE COMPLETE', xx + 10, yy + 22, 12, '#9fffd0', 'bold');
        text(`Time ${clock(s.time)}`, xx + 10, yy + 45, 12);
        text(`Best ${clock(s.best)}`, xx + 10, yy + 66, 12, '#ffcd79');
        text(`${s.recoveries} recoveries`, xx + 10, yy + 86, 11);
        text('Tap to rescue again', xx + 10, yy + 105, 10);
      } else {
        const ww = Math.min(430, w - 32), xx = (w - ww) / 2, yy = h - 196;
        rect(xx, yy, ww, 108, '#0c2331f5', '#9fffd0');
        text('THREE SIGNALS. ONE HOME.', xx + 18, yy + 25, 21, '#9fffd0', 'bold');
        text(`Rescue time ${clock(s.time)} · Recoveries ${s.recoveries}`, xx + 18, yy + 48, 14);
        text(`Best this session: ${clock(s.best)}`, xx + 18, yy + 70, 13, '#ffcd79');
        text('R or tap: another night, another rescue', xx + 18, yy + 94, 13);
      }
    }
    texture.needsUpdate = true;
  }
  function update(s, width, height) {
    if (s.time - lastDraw > .12 || s.phase !== lastPhase || width !== lastW || height !== lastH) {
      draw(s, width, height); lastDraw = s.time; lastPhase = s.phase; lastW = width; lastH = height;
    }
    const camera = p0.camera, depth = Math.max(camera.near * 2, scale * 3);
    const vh = 2 * depth * Math.tan(camera.fov * Math.PI / 360), vw = vh * camera.aspect;
    panel.scale.set(vw, vh, 1); panel.position.set(0, 0, -depth);
    panel.position.applyQuaternion(camera.quaternion).add(camera.position); panel.quaternion.copy(camera.quaternion);
  }
  function dispose() { panel.removeFromParent(); geometry.dispose(); material.dispose(); texture.dispose(); }
  return { update, dispose, canvas };
}
