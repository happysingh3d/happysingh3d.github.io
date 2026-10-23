import * as THREE from 'three';

export function createHud(p0) {
  const canvas = new OffscreenCanvas(1280, 720), ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.renderOrder = 1000; p0.scene.add(mesh);
  let buttons = [], lastState = '', timer = 0;
  const ink = '#d9eae9', mint = '#96e2d0', gold = '#e9b66b';
  function text(value, x, y, size = 16, color = ink, weight = 500, align = 'left') {
    ctx.font = `${weight} ${size}px Georgia, serif`;
    ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function fit(value, x, y, width, size = 16, color = ink, weight = 500, align = 'left') {
    ctx.font = `${weight} ${size}px Georgia, serif`;
    while (ctx.measureText(value).width > width && size > 9) {
      size -= .5; ctx.font = `${weight} ${size}px Georgia, serif`;
    }
    text(value, x, y, size, color, weight, align);
  }
  function panel(x, y, w, h, alpha = .9) {
    ctx.fillStyle = `rgba(10,29,43,${alpha})`; ctx.strokeStyle = '#57837f'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill(); ctx.stroke();
  }
  function button(id, label, x, y, w, h, selected = false) {
    ctx.fillStyle = selected ? mint : '#234755'; ctx.strokeStyle = selected ? '#bbf5df' : '#4e797b';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
    text(label, x + w / 2, y + h / 2 + 6, 16, selected ? '#112f3e' : ink, 700, 'center');
    buttons.push({id, x, y, w, h});
  }
  function draw(run, state, message, lift, w, h, sound) {
    buttons = []; ctx.clearRect(0, 0, w, h);
    const narrow = w < 700, margin = narrow ? 12 : 25;
    button('sound', sound ? 'SOUND ON' : 'MUTED', w - margin - 92, 25, 92, 33, sound);
    if (state === 'welcome' || run.done) {
      const compact = h < 520;
      const pw = Math.min(w - 2 * margin, 460), ph = compact ? 224 : 314;
      const x = narrow ? (w - pw) / 2 : w - pw - 35, y = Math.min(h - ph - 16, Math.max(72, (h - ph) / 2));
      panel(x, y, pw, ph, .91);
      fit('DEADHUNK  /  A LIGHT TO COME HOME TO', x + 24, y + 31, pw - 48, 11, mint, 700);
      fit('THE LAST LIGHTHOUSE', x + 24, y + 67, pw - 48, narrow ? 23 : 27, ink, 700);
      text('AFTERGLOW', x + 24, y + 96, 17, gold, 700);
      if (compact) {
        fit(run.done ? `${run.saved} / 7 HOME · SCORE ${run.score}` : 'Drag or A/D aims. Lift clears rocks.', x + 24, y + 126, pw - 48, 15, mint);
        fit(run.done ? 'Every rescue matters.' : 'Two flares calm storms. Rescue seven in 90s.', x + 24, y + 151, pw - 48, 14, gold);
      } else
      if (run.done) {
        text(`${run.saved} / 7 safely home`, x + 24, y + 139, 25, mint, 700);
        text(run.stars ? '★'.repeat(run.stars) + '☆'.repeat(3 - run.stars) : 'Try keeping a wider road alive', x + 24, y + 170, 22, gold);
        text(`SCORE ${run.score}   ·   ${run.elapsed.toFixed(1)} seconds`, x + 24, y + 199, 15);
        text(run.saved === 7 ? 'The cloud-sea remembers your light.' : 'Every rescue matters. Try again.', x + 24, y + 228, 15, mint);
      } else {
        fit('Paint fading roads of light. Bring seven rays home.', x + 24, y + 136, pw - 48, 15);
        fit('Drag across the sea, or use A / D to aim.', x + 24, y + 165, pw - 48, 15);
        fit('Lift clears rocks; low light lasts longer.', x + 24, y + 194, pw - 48, 15);
        fit('Two flares calm the storm. Night falls in 90s.', x + 24, y + 223, pw - 48, 15, gold);
      }
      button('start', run.done ? 'LIGHT THE WAY AGAIN' : 'LIGHT THE WAY  /  SPACE', x + 20, y + ph - 64, pw - 40, 43, true);
    } else {
      panel(margin, 77, narrow ? 146 : 178, 76, .83);
      text(`${run.saved} / 7 HOME`, margin + 16, 108, narrow ? 21 : 26, mint, 700);
      text(`${Math.max(0, 90 - run.elapsed).toFixed(1)}s until night`, margin + 16, 137, 15);
      if (message) {
        const mw = Math.min(w - 2 * margin, 560), mx = (w - mw) / 2;
        const noticeY = w < 1100 ? 168 : 76;
        panel(mx, noticeY, mw, 43, .85);
        fit(message, w / 2, noticeY + 28, mw - 24, narrow ? 13 : 16, gold, 700, 'center');
      }
      const y = h - 74, bw = narrow ? 110 : 144;
      button('lift', lift ? 'HIGH / LOWER' : 'LOW / LIFT', margin, y, bw, 44, !!lift);
      button('flare', `FLARE × ${run.flares}`, w - margin - bw, y, bw, 44, run.flares > 0);
      if (!narrow) text('DRAG THE SEA / A D AIM     ·     W S LIFT     ·     SPACE FLARE', w / 2, h - 26, 13, '#b2caca', 500, 'center');
      else text('Drag to aim', w / 2, h - 14, 13, '#b2caca', 500, 'center');
    }
  }
  function update(run, state, message, lift, dt, sound = true) {
    timer += dt;
    const w = Math.max(260, Math.floor(p0.width)), h = Math.max(260, Math.floor(p0.height));
    const key = [w, h, state, run.done, run.saved, run.flares, message, lift, sound].join('|');
    if (key !== lastState || timer > .1) {
      // WebGL allocates immutable texture storage at first upload. A resize
      // needs fresh storage, otherwise the previous desktop HUD is corrupted.
      if (canvas.width !== w || canvas.height !== h) texture.dispose();
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      draw(run, state, message, lift, w, h, sound); texture.needsUpdate = true; timer = 0; lastState = key;
    }
    const distance = .7;
    mesh.position.copy(p0.camera.position).add(new THREE.Vector3(0, 0, -distance).applyQuaternion(p0.camera.quaternion));
    mesh.quaternion.copy(p0.camera.quaternion);
    const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(p0.camera.fov / 2));
    mesh.scale.set(height * p0.camera.aspect, height, 1);
  }
  return {mesh, update, hit(x, y) {
    return buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id;
  }, dispose() {p0.scene.remove(mesh); geometry.dispose(); material.dispose(); texture.dispose();}};
}
