import * as THREE from 'three';
import { createMission, updateMission, objective } from './mission.js';
import { createDistrict } from './visuals.js';
import { createHud, clock } from './hud.js';

// Local single-player mission: no scores, prizes, item grants or public account mutations.
export default async function start(p0) {
  // Reserve camera space south of the district so the picture always fills the lot view.
  const scale = Math.min(p0.lot.width / 64, p0.lot.depth / 60, p0.lot.height / 32);
  if (!(scale > 0)) throw new Error('The district needs positive lot dimensions');
  const scene = p0.scene, camera = p0.camera;
  const previous = { background: scene.background, fog: scene.fog, controls: p0.controls.mode,
    bodies: p0.bodies.visible, fov: camera.fov, near: camera.near, far: camera.far };
  p0.controls.mode = 'none'; p0.bodies.visible = false;
  camera.fov = 50; camera.near = .1 * scale; camera.far = 180 * scale; camera.updateProjectionMatrix();
  scene.background = new THREE.Color(0x0c2030); scene.fog = new THREE.Fog(0x0c2030, 44 * scale, 90 * scale);
  camera.position.set(-21 * scale, 18 * scale, 25 * scale); camera.lookAt(-21 * scale, 0, 11 * scale);
  let state = createMission(), district, hud, stopped = false, startRequested = false, lastHud = '';
  const sounds = new Set();
  const soundFiles = { pickup: 'cell.wav', repair: 'repair.wav', join: 'join.wav',
    deliver: 'home.wav', damage: 'arc.wav', recover: 'arc.wav', win: 'win.wav' };
  const restart = () => { state = createMission(state.best); startRequested = false; lastHud = ''; };
  const cleanup = () => {
    if (stopped) return; stopped = true;
    hud?.dispose(); district?.dispose(); sounds.forEach(id => p0.sound.stop(id));
    scene.background = previous.background; scene.fog = previous.fog;
    p0.controls.mode = previous.controls; p0.bodies.visible = previous.bodies;
    camera.fov = previous.fov; camera.near = previous.near; camera.far = previous.far; camera.updateProjectionMatrix();
  };
  p0.on('end', cleanup);
  try {
    p0.loading(.08, 'Entering District 07');
    district = await createDistrict(p0, scale);
    if (stopped) { district?.dispose(); return; }
    hud = createHud(p0, scale); district.update(state, 1, p0.width, p0.height); hud.update(state, p0.width, p0.height);
    p0.loading(.8, 'Warming the city lights');
    if (p0.renderer.compileAsync) await p0.renderer.compileAsync(scene, camera);
    if (stopped) return;
    p0.loading(1, 'District ready');
    p0.renderer.render(scene, camera);
    p0.on('keydown', e => { if (e.code === 'KeyR') restart(); });
    p0.on('pointerdown', () => { if (state.phase === 'won') restart(); else if (state.phase === 'ready') startRequested = true; });
    p0.loop(dt => {
      if (stopped) return;
      const down = key => p0.input.isDown(key);
      const x = Number(down('KeyD') || down('ArrowRight')) - Number(down('KeyA') || down('ArrowLeft'));
      const z = Number(down('KeyS') || down('ArrowDown')) - Number(down('KeyW') || down('ArrowUp'));
      updateMission(state, { x, z, sprint: down('ShiftLeft') || down('ShiftRight'), start: startRequested }, dt);
      startRequested = false;
      district.update(state, Math.max(0, Math.min(dt, .1)), p0.width, p0.height);
      hud.update(state, p0.width, p0.height);
      for (const event of state.events) if (soundFiles[event.type]) {
        try { const id = p0.sound.play(p0.asset(`assets/${soundFiles[event.type]}`), { volume: event.type === 'damage' ? .18 : .3 });
          sounds.add(id); if (sounds.size > 30) sounds.delete(sounds.values().next().value);
        } catch { /* A muted browser must never interrupt the rescue. */ }
      }
      const o = objective(state), summary = `${o.title}\n${o.detail}\nCells ${state.inventory} · Home ${state.rescued}/3 · Power ${Math.ceil(state.hero.energy)}% · ${clock(state.time)}\n${o.hint}`;
      if (summary !== lastHud) { p0.hud(summary.slice(0, 400)); lastHud = summary; }
    });
  } catch (error) { cleanup(); throw error; }
}
