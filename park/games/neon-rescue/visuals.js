import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { HAVEN, BEACON, CONSOLE, PEOPLE, CELLS, BUILDINGS, BRIDGES, YARD_WALLS, GATE, HAZARDS, hazardActive } from './world.js';

export async function createDistrict(p0, scale) {
  p0.loading(.2, 'Finding our friends');
  const gltf = await new GLTFLoader().loadAsync(p0.asset('assets/explorer.glb'));
  const source = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(source), modelHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(modelHeight) || modelHeight < .01) throw new Error('Explorer model has invalid bounds');
  const root = new THREE.Group(); root.scale.setScalar(scale); p0.scene.add(root);
  const materials = new Set(), geometries = new Set(), textures = new Set();
  const actors = [], particles = [], cells = [], hazardMeshes = [], occluders = [];
  const mat = (color, metal = .4, glow = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: .55,
      emissive: glow, emissiveIntensity: glow ? 1.6 : 0 }); materials.add(m); return m;
  };
  const palette = {
    dark: mat(0x142536), stone: mat(0x213c4b), roof: mat(0x304e60),
    ground: mat(0x132a38, .15), road: mat(0x223f49, .18), silver: mat(0x65828c, .75),
    cyan: mat(0x73e7f0, .3, 0x166781), gold: mat(0xffc862, .35, 0x925b1b),
    pink: mat(0xff9cca, .2, 0x723f67), green: mat(0x9fffcb, .25, 0x226b4d),
    white: mat(0xd1e9e2, .1), hazard: mat(0xffad65, .3, 0xae3710)
  };
  const geo = (g) => { geometries.add(g); return g; };
  const cube = geo(new THREE.BoxGeometry(1, 1, 1));
  const sphere = geo(new THREE.SphereGeometry(1, 12, 8));
  const cylinder = geo(new THREE.CylinderGeometry(1, 1, 1, 12));
  const ringGeo = geo(new THREE.TorusGeometry(1, .035, 6, 48));
  function mesh(g, m, x, y, z, parent = root) {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); return o;
  }
  function box(w, h, d, m, x, y, z, parent = root) {
    const o = mesh(cube, m, x, y, z, parent); o.scale.set(w, h, d); return o;
  }
  function ring(r, m, x, y, z) {
    const o = mesh(ringGeo, m, x, y, z); o.scale.setScalar(r); o.rotation.x = -Math.PI / 2; return o;
  }
  function instances(g, m, transforms) {
    const inst = new THREE.InstancedMesh(g, m, transforms.length), temp = new THREE.Object3D();
    transforms.forEach((t, i) => {
      temp.position.set(t.x, t.y, t.z); temp.scale.set(t.w || 1, t.h || 1, t.d || 1);
      temp.rotation.set(t.rx || 0, t.ry || 0, 0); temp.updateMatrix(); inst.setMatrixAt(i, temp.matrix);
    }); root.add(inst); return inst;
  }
  function sign(text, x, y, z, width, color = '#9ff5ee', rotation = 0) {
    const canvas = new OffscreenCanvas(512, 128), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1b2a'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = color; ctx.font = 'bold 34px monospace'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 77);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; textures.add(texture);
    const m = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }); materials.add(m);
    const o = mesh(geo(new THREE.PlaneGeometry(width, width / 4)), m, x, y, z);
    o.rotation.y = rotation; return o;
  }
  box(64, .7, 40, palette.ground, 0, -.4, 0);
  box(61, .035, 4.4, palette.road, 0, .005, -5.5);
  box(61, .035, 4.4, palette.road, 0, .005, 6);
  for (const x of BRIDGES) box(4.9, .035, 37, palette.road, x, .008, 0);
  const roadMarks = [];
  for (let x = -28; x < 29; x += 4) for (const z of [-5.5, 6]) roadMarks.push({ x, y: .042, z, w: 1.5, h: .035, d: .065 });
  instances(cube, palette.silver, roadMarks);

  const waterMaterial = new THREE.ShaderMaterial({ transparent: false,
    uniforms: { time: { value: 0 }, restored: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float time; uniform float restored; varying vec3 vP;
      void main(){float wave=sin(vP.x*1.5+time*.8)*sin(vP.z*4.-time*.9);
        float streak=pow(max(0.,sin(vP.x*.7+vP.z*4.+time)),12.);
        vec3 c=mix(vec3(.025,.12,.19),vec3(.045,.25,.27),restored);
        gl_FragColor=vec4(c+wave*.013+streak*vec3(.025,.08,.1),1.);}`
  }); materials.add(waterMaterial);
  const water = mesh(geo(new THREE.PlaneGeometry(63, 4.4)), waterMaterial, 0, -.13, 0);
  water.rotation.x = -Math.PI / 2;
  box(62, .35, .3, palette.roof, 0, -.07, -2.4);
  box(62, .35, .3, palette.roof, 0, -.07, 2.4);
  const railPosts = [], railBars = [];
  for (const x of BRIDGES) {
    box(5, .3, 5.1, palette.roof, x, -.02, 0);
    for (const dx of [-2.45, 2.45]) {
      railBars.push({ x: x + dx, y: 1.05, z: 0, w: .08, h: .08, d: 5 });
      for (const z of [-2, 0, 2]) railPosts.push({ x: x + dx, y: .53, z, w: .09, h: 1, d: .09 });
    }
  }
  instances(cube, palette.silver, railPosts); instances(cube, palette.cyan, railBars);

  const windows = [], roofVents = [], wallRibs = [];
  for (const b of BUILDINGS) {
    const facade = palette.dark.clone(), roof = palette.roof.clone(), base = palette.stone.clone();
    for (const m of [facade, roof, base]) { m.transparent = true; materials.add(m); }
    box(b.w, b.h, b.d, facade, b.x, b.h / 2, b.z);
    box(b.w + .5, .28, b.d + .5, roof, b.x, b.h, b.z);
    box(b.w + .25, .3, b.d + .25, base, b.x, .15, b.z);
    const wm = palette.cyan.clone(); wm.transparent = true; wm.emissiveIntensity = .26; materials.add(wm);
    occluders.push({ b, materials: [facade, roof, base, wm], window: wm });
    for (let x = b.x - b.w / 2 + .8; x < b.x + b.w / 2 - .4; x += 1.4) {
      for (let y = 2.8; y < b.h - .5; y += 1.6) {
        windows.push({ x, y, z: b.z + b.d / 2 + .018, w: .7, h: .65, d: .03 });
        windows.push({ x, y, z: b.z - b.d / 2 - .018, w: .7, h: .65, d: .03 });
      }
      wallRibs.push({ x, y: b.h / 2, z: b.z + b.d / 2 + .025, w: .035, h: b.h, d: .04 });
    }
    roofVents.push({ x: b.x - b.w * .2, y: b.h + .4, z: b.z, w: 1.3, h: .6, d: 1.8 });
    sign(b.label, b.x, 1.9, b.z + b.d / 2 + .04, Math.min(b.w - .3, 7));
    instances(cube, wm, windows.splice(0)); instances(cube, roof, wallRibs.splice(0));
    instances(cube, roof, roofVents.splice(0));
  }
  for (const b of YARD_WALLS) box(b.w, b.h, b.d, palette.roof, b.x, b.h / 2, b.z);
  const gate = box(GATE.w, GATE.h, GATE.d, palette.gold, GATE.x, GATE.h / 2, GATE.z);
  box(.6, 1.1, .6, palette.dark, CONSOLE.x, .55, CONSOLE.z);
  const consoleGlow = box(.45, .35, .45, palette.gold, CONSOLE.x, 1.1, CONSOLE.z);
  sign('POWER YARD', 23, 2.8, -6.71, 6, '#ffcf78');

  const havenPad = mesh(cylinder, palette.stone, HAVEN.x, .02, HAVEN.z);
  havenPad.scale.set(3.3, .08, 3.3); ring(3.25, palette.green, HAVEN.x, .085, HAVEN.z);
  // Open shelter frame keeps the pilot and returning friends visible from above.
  box(6.8, .12, .12, palette.silver, -24, 4.2, 17.1);
  for (const x of [-27.25, -20.75]) box(.16, 4.2, .16, palette.silver, x, 2.1, 16.8);
  sign('HAVEN / RECHARGE', -24, 3.7, 17.37, 6.4, '#a7ffd0');
  box(.9, .6, .9, palette.dark, BEACON.x, .3, BEACON.z);
  const tower = mesh(cylinder, palette.silver, BEACON.x, 2.3, BEACON.z); tower.scale.set(.15, 4.6, .15);
  const beaconSphere = mesh(sphere, palette.green, BEACON.x, 4.8, BEACON.z); beaconSphere.scale.setScalar(.55);
  const beaconRings = [ring(.9, palette.green, BEACON.x, 4.7, BEACON.z), ring(.7, palette.green, BEACON.x, 5.1, BEACON.z)];
  // Street furniture and planter silhouettes make routes feel inhabited.
  const lamps = [], lampHeads = [], planters = [], stems = [];
  for (const x of [-29, -17, -3, 9, 28]) for (const z of [-8, 8]) {
    if (BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2)) continue;
    lamps.push({ x, y: 1.9, z, w: .09, h: 3.8, d: .09 });
    lampHeads.push({ x, y: 3.8, z, w: .75, h: .08, d: .22 });
  }
  for (const [x, z] of [[-29, 17], [-19, 10], [-8, 17], [10, 17], [29, -17], [-29, -17]]) {
    planters.push({ x, y: .25, z, w: 1.8, h: .5, d: 1 });
    for (let i = 0; i < 4; i++) stems.push({ x: x - .6 + i * .4, y: .8, z, w: .12, h: .8 + i % 2 * .3, d: .3, ry: i });
  }
  instances(cube, palette.silver, lamps); instances(cube, palette.gold, lampHeads);
  instances(cube, palette.stone, planters); instances(cube, palette.green, stems);
  const debris = [];
  for (const [x, z] of [[-28, 4], [-17, -8], [3, -8], [21, 13], [27, -4]]) {
    debris.push({ x, y: .25, z, w: 1.2, h: .5, d: .6, ry: .25 });
    debris.push({ x: x + 1, y: .12, z: z + .7, w: .5, h: .25, d: .6, ry: -.4 });
  }
  instances(cube, palette.roof, debris);
  for (const c of CELLS) {
    const g = new THREE.Group(); g.position.set(c.x, .9, c.z); root.add(g);
    const core = box(.48, .72, .48, palette.gold, 0, 0, 0, g);
    for (const y of [-.3, .3]) box(.6, .09, .6, palette.silver, 0, y, 0, g);
    cells.push({ root: g, halo: ring(.7, palette.gold, c.x, .06, c.z), core });
  }
  for (const h of HAZARDS) {
    const m = palette.hazard.clone(); materials.add(m);
    const o = ring(h.radius, m, h.x, .08, h.z);
    const bolts = new THREE.Group(); bolts.position.set(h.x, .3, h.z); root.add(bolts);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, b = box(.075, .5, .075, m, Math.cos(a) * .6, 0, Math.sin(a) * .6, bolts);
      b.rotation.z = .4 * (i % 2 ? 1 : -1);
    }
    hazardMeshes.push({ ring: o, bolts, material: m });
  }
  // Slow, sparse embers, never a high-frequency flash.
  const particleGeometry = geo(new THREE.BufferGeometry());
  const particlePositions = new Float32Array(45 * 3);
  for (let i = 0; i < 45; i++) {
    const x = Math.sin(i * 21.31) * 30, z = Math.cos(i * 17.17) * 18, y = .5 + (i % 9) * .5;
    particles.push({ x, y, z }); particlePositions.set([x, y, z], i * 3);
  }
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({ color: 0xffce84, size: .065, transparent: true, opacity: .6 });
  materials.add(particleMaterial); root.add(new THREE.Points(particleGeometry, particleMaterial));

  p0.loading(.55, 'Building the streets');
  source.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  const colors = [0x61e9ff, 0x6ee7ff, 0xffa8d7, 0xffd479];
  for (let i = 0; i < 4; i++) {
    const rig = clone(source), holder = new THREE.Group(); root.add(holder);
    rig.scale.setScalar(2.7 / modelHeight); rig.position.y = -bounds.min.y * rig.scale.x; holder.add(rig);
    const actorMaterials = new Map();
    rig.traverse(o => {
      if (!o.isMesh) return;
      const make = m => {
        if (!actorMaterials.has(m)) {
          const c = m.clone();
          if (m.name === 'Suit') c.color.setHex([0x315562, 0x284d59, 0x4f3f56, 0x5b4834][i]);
          if (m.name === 'Visor' || m.name === 'Reactor') {
            c.color.setHex(colors[i]); c.emissive.setHex(colors[i]); c.emissiveIntensity = .3;
          }
          c.roughness = .43; actorMaterials.set(m, c); materials.add(c);
        } return actorMaterials.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(make) : make(o.material);
      o.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(rig), actions = new Map(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
    const marker = ring(.65, [palette.cyan, palette.cyan, palette.pink, palette.gold][i], 0, .09, 0);
    root.remove(marker); holder.add(marker);
    // Distinct equipment silhouettes: scout aerial, medic satchel, engineer tool pack.
    if (i === 1) {
      box(.04, .45, .04, palette.silver, .45, 2.2, 0, holder);
      mesh(sphere, palette.cyan, .45, 2.5, 0, holder).scale.setScalar(.08);
    } else if (i === 2) {
      box(.45, .6, .28, palette.pink, -.65, .9, 0, holder);
      box(.27, .07, .03, palette.white, -.65, .9, .16, holder);
      box(.07, .27, .03, palette.white, -.65, .9, .16, holder);
    } else if (i === 3) {
      box(.6, .8, .3, palette.gold, 0, 1.2, -.45, holder);
      box(.07, .5, .07, palette.silver, .42, 1.65, -.48, holder);
    }
    const label = i ? sign(PEOPLE[i - 1].name.toUpperCase(), 0, 3.3, 0, 2.2, PEOPLE[i - 1].color) : null;
    actors.push({ root: holder, mixer, actions, clip: '', marker, label });
  }

  const hemisphere = new THREE.HemisphereLight(0xbce6f3, 0x142634, 2.5);
  const sun = new THREE.DirectionalLight(0xc8eaff, 3); sun.position.set(-10 * scale, 22 * scale, 12 * scale);
  p0.scene.add(hemisphere, sun);
  const target = new THREE.Vector3(), desired = new THREE.Vector3();
  function play(actor, name) {
    if (actor.clip === name) return;
    actor.actions.get(actor.clip)?.fadeOut(.25);
    actor.actions.get(name)?.reset().fadeIn(.25).play(); actor.clip = name;
  }
  function update(s, dt, width, height) {
    const restored = s.phase === 'won' ? 1 : s.rescued * .13;
    waterMaterial.uniforms.time.value = s.time; waterMaterial.uniforms.restored.value = restored;
    occluders.forEach(o => { o.window.emissiveIntensity = .25 + restored * 1.4; });
    palette.green.emissiveIntensity = 1.2 + restored * .8;
    palette.gold.emissiveIntensity = .7 + restored * .4;
    for (const o of occluders) {
      const behind = Math.abs(s.hero.x - o.b.x) < o.b.w / 2 + 1 && s.hero.z < o.b.z + .4 &&
        s.hero.z > o.b.z - o.b.d / 2 - o.b.h * .9 - 1;
      for (const m of o.materials) {
        m.opacity += ((behind ? .2 : 1) - m.opacity) * Math.min(1, dt * 8);
        m.depthWrite = m.opacity > .95;
      }
    }
    gate.position.y += ((s.gateOpen ? -1.5 : GATE.h / 2) - gate.position.y) * Math.min(1, dt * 5);
    consoleGlow.material = s.gateOpen ? palette.green : palette.gold;
    beaconSphere.scale.setScalar(.5 + Math.sin(s.time * 2) * .035);
    beaconRings.forEach((r, i) => { r.rotation.z = s.time * .2 * (i ? -1 : 1); });
    cells.forEach((c, i) => {
      c.root.visible = c.halo.visible = !s.cells[i].collected;
      c.root.position.y = .95 + Math.sin(s.time * 2 + i) * .16; c.root.rotation.y = s.time * .8;
    });
    hazardMeshes.forEach((o, i) => {
      const active = hazardActive(HAZARDS[i], s.time) && s.phase !== 'won';
      o.bolts.visible = active; o.material.emissiveIntensity = active ? 2 : .12;
      o.material.color.setHex(active ? 0xffb36e : 0x43606b);
    });
    const all = [s.hero, ...s.people];
    actors.forEach((a, i) => {
      const p = all[i]; a.root.position.set(p.x, .12, p.z);
      const yaw = p.yaw ?? (i ? -Math.PI / 2 : 0);
      let difference = yaw - a.root.rotation.y;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      a.root.rotation.y += difference * Math.min(1, dt * 10);
      const clip = i === 0 ? (s.phase === 'won' ? 'Joy' : s.moving ? 'fly' : 'idle') :
        p.status === 'safe' ? 'Joy' : p.status === 'following' ? (p.trail.length > 1 ? 'fly' : 'idle') : 'Sadness';
      play(a, clip); a.mixer.update(dt);
      a.marker.visible = i === 0 || p.status !== 'safe';
      if (a.label) {
        a.label.position.set(p.x, 3.3, p.z); a.label.quaternion.copy(p0.camera.quaternion);
      }
      if (i === 0) a.root.visible = !(s.invulnerable > 0 && Math.sin(s.time * 10) < 0);
    });
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]; particlePositions[i * 3 + 1] = .3 + (p.y + s.time * .18) % 5;
      particlePositions[i * 3] = p.x + Math.sin(s.time * .4 + i) * .2;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    const mobile = width / height < 1;
    const zoom = mobile ? 1.15 : 1;
    const focusX = Math.max(-21, Math.min(21, s.hero.x)), focusZ = Math.max(-11, Math.min(11, s.hero.z));
    target.set(focusX * scale, .3 * scale, focusZ * scale);
    desired.set(focusX * scale, 18 * scale * zoom, (focusZ + 14 * zoom) * scale);
    p0.camera.position.lerp(desired, Math.min(1, dt * 6)); p0.camera.lookAt(target);
    p0.me.position.set(s.hero.x * scale, .3 * scale, s.hero.z * scale); p0.me.yaw = s.hero.yaw;
  }
  function dispose() {
    root.removeFromParent(); hemisphere.removeFromParent(); sun.removeFromParent();
    actors.forEach(a => { a.mixer.stopAllAction(); a.mixer.uncacheRoot(a.mixer.getRoot()); });
    materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
  }
  let triangles = 0, drawObjects = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    drawObjects++;
  });
  p0.log('Neon Rescue district', { triangles, drawObjects, riggedCharacters: actors.length });
  return { update, dispose, root, actors };
}
