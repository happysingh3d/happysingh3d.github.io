import * as THREE from 'three';
import {createRun, step} from './core.js';
import {createWorld} from './world.js';
import {createHud} from './hud.js';
import {createAudio} from './audio.js';

export default async function start(p0) {
  if (p0.lot.width < 11 || p0.lot.depth < 11 || p0.lot.height < 8) throw new Error('Afterglow needs an 11m square lot');
  const worldScale = Math.min(.29, (p0.lot.width - 1) / 38, (p0.lot.depth - 1) / 27, (p0.lot.height - 1) / 24);
  const prior = {background: p0.scene.background, fog: p0.scene.fog, mode: p0.controls.mode,
    bodies: p0.bodies.visible, position: p0.camera.position.clone(), quaternion: p0.camera.quaternion.clone(),
    fov: p0.camera.fov, near: p0.camera.near, far: p0.camera.far, vertical: p0.controls.vertical};
  let stopped = false, world, hud, audio, run = createRun(1), state = 'welcome';
  let lift = 0, target = null, dragging = false, flarePress = false, accumulator = 0;
  let scored = false, seed = 1, message = '', messageUntil = 0;
  const fixed = 1 / 60;
  function cleanup() {
    if (stopped) return; stopped = true;
    audio?.dispose(); hud?.dispose(); world?.dispose();
    p0.scene.background = prior.background; p0.scene.fog = prior.fog;
    p0.controls.mode = prior.mode; p0.controls.vertical = prior.vertical; p0.bodies.visible = prior.bodies;
    p0.camera.position.copy(prior.position); p0.camera.quaternion.copy(prior.quaternion);
    Object.assign(p0.camera, {fov: prior.fov, near: prior.near, far: prior.far}); p0.camera.updateProjectionMatrix();
  }
  p0.on('end', cleanup);
  function notice(text, seconds = 3) {message = text; messageUntil = run.elapsed + seconds;}
  function begin() {
    run = createRun(seed++); state = 'playing'; lift = 0; target = null;
    flarePress = false; accumulator = 0; scored = false;
    audio.start();
    notice('Hold your light on the first ray to guide it home.', 7);
  }
  function action(id) {
    if (id === 'sound') {audio.toggle(); return;}
    if (id === 'start') begin();
    if (state !== 'playing' || run.done) return;
    if (id === 'lift') {lift = 1 - lift; notice(lift ? 'High beam clears rocks. Its wake fades faster.' : 'Low beam leaves longer-lasting roads.');}
    if (id === 'flare') flarePress = true;
  }
  try {
    p0.controls.mode = 'none'; p0.controls.vertical = false; p0.bodies.visible = false;
    function framing() {
      p0.camera.fov = p0.width < 700 ? 108 : 80;
      const focus = new THREE.Vector3(p0.width < 700 ? -5 : -1, 7, 0);
      p0.camera.position.set(-15, 21.7, 9.5);
      if (p0.width < 700) p0.camera.position.sub(focus).multiplyScalar(1.27).add(focus);
      p0.camera.position.multiplyScalar(worldScale);
      p0.camera.lookAt(focus.multiplyScalar(worldScale)); p0.camera.updateProjectionMatrix();
    }
    p0.camera.near = .05; p0.camera.far = 100; framing();
    p0.on('resize', () => {if (!stopped) framing();});
    p0.scene.fog = new THREE.Fog(0x5f8291, 36 * worldScale, 80 * worldScale);
    p0.loading(.15, 'Building the lighthouse'); world = createWorld(p0, worldScale);
    p0.loading(.6, 'Lighting the cloud-sea'); hud = createHud(p0); audio = createAudio(p0);
    world.update(run, 0, true); hud.update(run, state, '', lift, 0, audio.enabled);
    p0.hud('Drag the sea or A/D to aim. W lifts above rocks; S lowers for a longer wake.\nSpace/tap starts; Space or FLARE uses a charge during play. Seven rescues, 90 seconds.');
    if (p0.renderer.compileAsync) await p0.renderer.compileAsync(p0.scene, p0.camera);
    if (stopped) return;
    p0.renderer.render(p0.scene, p0.camera); p0.loading(1, 'A light to come home to');
    p0.on('keydown', e => {
      if (stopped || e.repeat) return;
      if (e.code === 'Space') {if (state === 'welcome' || run.done) begin(); else flarePress = true;}
      if (e.code === 'KeyW' || e.code === 'ArrowUp') lift = 1;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') lift = 0;
    });
    p0.on('pointerdown', e => {
      if (stopped) return;
      const x = e.x ?? p0.input.pointer.x, y = e.y ?? p0.input.pointer.y;
      const id = hud.hit(x, y);
      if (id) {action(id); return;}
      if (state === 'playing' && !run.done) {dragging = true; target = world.aimBearing(x, y);}
    });
    p0.on('pointermove', e => {
      if (dragging && !stopped) target = world.aimBearing(e.x ?? p0.input.pointer.x, e.y ?? p0.input.pointer.y);
    });
    p0.on('pointerup', () => {dragging = false;});
    p0.on('end', () => {dragging = false; flarePress = false;});
    p0.loop(dt => {
      if (stopped) return;
      const frameDt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .1));
      if (state === 'playing' && !run.done) {
        const down = key => p0.input.isDown(key);
        const steering = Number(down('KeyD') || down('ArrowRight')) - Number(down('KeyA') || down('ArrowLeft'));
        if (steering) target = null;
        const sweep = target === null ? steering : THREE.MathUtils.clamp((target - run.lamp.angle) * 6, -1, 1);
        accumulator += frameDt;
        while (accumulator >= fixed && !run.done) {
          step(run, fixed, {sweep, lift, flare: flarePress}); flarePress = false; accumulator -= fixed;
          for (const event of run.events) {
            audio.event(event, run.saved);
            if (event.type === 'saved') notice(`Ray ${event.id} is home. ${run.saved} rescued.`, 2.5);
            if (event.type === 'fadeWarning') notice('A road is fading. Refresh it before the ray drifts.', 2.5);
            if (event.type === 'stranded') notice('A ray is drifting. Relight its route home.', 2.5);
            if (event.type === 'squall' && event.state === 'in') notice('The squall eats light. A flare calms it.', 4);
            if (event.type === 'flare') notice('Flare sent. The storm is quiet for six seconds.', 3);
            if (event.type === 'flareEmpty') notice('No flares left. Keep the roads alive.', 2);
          }
        }
        if (run.done && !scored) {scored = true; state = 'results'; audio.finish(run.saved); p0.score(run.score); p0.log('afterglow-finished', {saved: run.saved, score: run.score});}
      }
      if (run.elapsed > messageUntil) message = '';
      world.update(run, frameDt, state === 'welcome');
      hud.update(run, state, message, lift, frameDt, audio.enabled);
    });
    p0.log('afterglow-ready', {version: 2, singleVisitor: true, lot: p0.lot.id, worldScale});
  } catch (e) {cleanup(); throw e;}
}
