// Happy Singh Park — a bright park city you can look over, walk through or fly across.
// Every building holds one body of work. Content lives in catalog.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, CHIPS, PLAZA, AREAS, SITE, AVENUES, EXHIBITS, A, GATE, SPAWN } from './catalog.js';
import { openBuilding, openSite, openGame, isOpen, onInspectorChange } from './inspector.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const $ = s => document.querySelector(s);
const status = $('#city-status');
const PARK_R = 178, FLY_MAX = 95, RADIUS = 0.7, GATE_Z = PLAZA[1] + GATE.d, SPAWN_Z = PLAZA[1] + SPAWN.d;
const COL = { path: 0xefe5cf, plaza: 0xe5dac2, water: 0x58b4e0, white: 0xf3f1ec, horizon: 0xe2f0f4, ink: 0x1d2a30 };
const hex = s => parseInt(s.slice(1), 16);
const GLOW = { Glow: 1.6, Spirit: 2.2, 'Race Cyan': 1.3, 'Race Coral': 1.0, 'Signal cyan': 1.4, 'Signal gold': 1.2, 'Signal pink': 1.4, Hive: 0.35, 'Pulse.002': 1.2 };
const TOON = ['Fur', 'Cream', 'Ink'];

for (const a of document.querySelectorAll('[data-classic]')) a.href = SITE.classicUrl;
document.addEventListener('contextmenu', e => e.preventDefault());
const webglOK = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };
const fallback = () => { status.hidden = false; status.innerHTML = `This browser can’t show the 3D park. <a href="${SITE.classicUrl}">Open the classic website</a>.`; };
if (!webglOK()) fallback(); else init().catch(err => { console.error(err); fallback(); });

async function init() {
  // ---------- renderer, scene, camera ----------
  const host = $('#city');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.25 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.append(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.horizon);
  scene.fog = new THREE.Fog(COL.horizon, 260, 720);
  const pmrem = new THREE.PMREMGenerator(renderer);
  { // reflections come from a simple sky-and-park environment, so glass mirrors the sky and the trees
    const env = new THREE.Scene(), geo = new THREE.SphereGeometry(100, 48, 24), pos = geo.attributes.position, col = [], c = new THREE.Color();
    const skyTop = new THREE.Color('#4f9fdc'), skyLow = new THREE.Color('#dcebf2'), grass = new THREE.Color('#7fae55'), grassFar = new THREE.Color('#a9c98a');
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 100; if (y >= 0) c.copy(skyLow).lerp(skyTop, Math.pow(y, 0.6)); else c.copy(grassFar).lerp(grass, Math.min(1, -y * 3)); col.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 10) })); sunDisc.position.set(48, 72, 36); env.add(sunDisc);
    const cloudM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.3) });
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, m = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), cloudM); m.scale.set(2.2, 0.55, 1.2); m.position.set(Math.sin(a) * 80, 28 + (i % 3) * 9, Math.cos(a) * 80); m.lookAt(0, m.position.y, 0); env.add(m); }
    const treeM = new THREE.MeshBasicMaterial({ color: '#4d8a3c' });
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, m = new THREE.Mesh(new THREE.SphereGeometry(7 + (i % 4) * 2, 10, 6), treeM); m.position.set(Math.sin(a) * 88, 2 + (i % 3) * 2, Math.cos(a) * 88); env.add(m); }
    scene.environment = pmrem.fromScene(env, 0.02).texture;
    scene.environmentIntensity = 0.45;
  }
  const camera = new THREE.PerspectiveCamera(innerWidth < 700 ? 56 : 48, innerWidth / innerHeight, 0.3, 2400);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5fb1e6) }, bottom: { value: new THREE.Color(COL.horizon) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main() {
        float h = clamp(normalize(vP).y * 1.5 + 0.04, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1; scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x5a7d3c, 1.0); scene.add(hemi);
  const nightFx = []; // functions (nightK) that switch things on after dark
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.5);
  sun.position.set(95, 165, 70); sun.castShadow = true;
  const sm = coarse ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -185, right: 185, top: 185, bottom: -185, near: 30, far: 480 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, done, total) => { status.textContent = `Planting the park… ${Math.round(done / total * 100)}%`; };
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const loadTex = url => { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };

  await Promise.race([Promise.all([document.fonts.load('600 80px Unbounded'), document.fonts.load('500 40px Figtree')]), new Promise(r => setTimeout(r, 2500))]).catch(() => {});

  const tickers = [], mixers = [], colliders = [], keepout = [];
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- helpers ----------
  const mats = new Map();
  const M = (color, o = {}) => { const k = color + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...o })); return mats.get(k); };
  const solid = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = solid(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); return m; };
  const tex2d = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  const fit = (g, text, maxW, size, weight, family) => { let s = size; g.font = `${weight} ${s}px ${family}`; while (g.measureText(text).width > maxW && s > 14) { s -= 2; g.font = `${weight} ${s}px ${family}`; } return s; };
  const DISPLAY = 'Unbounded, "Segoe UI", sans-serif', BODY = 'Figtree, "Segoe UI", sans-serif';
  const basic = (map, o = {}) => new THREE.MeshBasicMaterial({ map, toneMapped: false, ...o });

  function signTex({ title, sub = '', w = 1024, h = 256, bg = '#ffffff', fg = '#1d2a30', subFg = '#55676e', accent = '#e07a2d', align = 'left' }) {
    return tex2d(w, h, g => {
      g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, Math.min(h * 0.16, 40)); g.fill();
      g.fillStyle = accent; g.fillRect(0, h - Math.max(8, h * 0.07), w, Math.max(8, h * 0.07));
      const pad = w * 0.06, x = align === 'center' ? w / 2 : pad; g.textAlign = align;
      g.fillStyle = fg; fit(g, title, w - pad * 2, sub ? h * 0.36 : h * 0.5, 600, DISPLAY);
      if (sub) { g.fillText(title, x, h * 0.47); g.fillStyle = subFg; fit(g, sub, w - pad * 2, h * 0.19, 500, BODY); g.fillText(sub, x, h * 0.76); }
      else g.fillText(title, x, h * 0.64);
    });
  }
  const signMesh = (opts, width, height) => new THREE.Mesh(new THREE.PlaneGeometry(width, height), basic(signTex({ ...opts, h: Math.round(1024 * height / width) }), { transparent: true }));
  const postSign = (opts, width, height, y) => { const g = new THREE.Group(); const s = signMesh(opts, width, height); s.position.y = y; g.add(s); for (const sx of [-1, 1]) g.add(box(0.18, y + height / 2, 0.18, M(COL.ink), sx * (width / 2 - 0.4), (y + height / 2) / 2, -0.12)); return g; };

  // a texture that fills a screen of a given aspect without stretching (crops like CSS "cover")
  const coverTex = (url, aspect) => { const t = texLoader.load(url, tt => { const ia = tt.image.width / tt.image.height; if (ia > aspect) { tt.repeat.set(aspect / ia, 1); tt.offset.set((1 - aspect / ia) / 2, 0); } else { tt.repeat.set(1, ia / aspect); tt.offset.set(0, (1 - ia / aspect) / 2); } }); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  // a white artboard with the work placed inside it (contain), plus a small caption
  const artboardTex = (url, caption, w = 1024, h = 720) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
    const paint = im => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); if (im) { const pad = 0.1, aw = w * (1 - pad * 2), ah = h * (1 - pad * 2) - 40, s = Math.min(aw / im.width, ah / im.height), iw = im.width * s, ih = im.height * s; g.drawImage(im, (w - iw) / 2, (h - 40 - ih) / 2, iw, ih); } g.fillStyle = '#55676e'; g.font = `500 26px ${BODY}`; g.fillText(caption, w * 0.1, h - 34); t.needsUpdate = true; };
    paint(null); const im = new Image(); im.onload = () => paint(im); im.src = url; return t;
  };
  const screen = (w, h, textures, every, offset = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(textures[0])); let i = 0, next = every + offset; tickers.push(t => { if (reduced || t < next || textures.length < 2) return; next = t + every; i = (i + 1) % textures.length; m.material.map = textures[i]; }); return m; };
  const bezel = (w, h, d = 0.4) => box(w + 0.7, h + 0.7, d, M(0x161d22, { roughness: 0.5 }));
  const windowTex = (base, light) => { const t = tex2d(128, 128, (g, w) => { g.fillStyle = base; g.fillRect(0, 0, w, w); for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const gr = g.createLinearGradient(0, y * 64, 0, y * 64 + 60); gr.addColorStop(0, light); gr.addColorStop(1, base); g.fillStyle = gr; g.fillRect(x * 64 + 5, y * 64 + 6, 54, 50); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const tickerTex = (msg, fg, bg) => { const t = tex2d(2048, 128, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.font = `600 64px ${DISPLAY}`; c.textBaseline = 'middle'; let x = 20; const mw = c.measureText(msg).width; while (x < w) { c.fillText(msg, x, h / 2 + 4); x += mw; } }); t.wrapS = THREE.RepeatWrapping; return t; };
  const edgeFrame = (w, h, d, y0, mat, t = 0.28) => { const grp = new THREE.Group(), hx = w / 2, hz = d / 2; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) grp.add(box(t, h, t, mat, sx * hx, y0 + h / 2, sz * hz)); for (const y of [y0, y0 + h]) grp.add(box(w + t, t, t, mat, 0, y, -hz), box(w + t, t, t, mat, 0, y, hz), box(t, t, d + t, mat, -hx, y, 0), box(t, t, d + t, mat, hx, y, 0)); return grp; };
  const toonRamp = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat); toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter; toonRamp.needsUpdate = true;

  // ---------- characters ----------
  const [fox, fluffy, explorer] = await Promise.all(['ink-fox', 'fluffy', 'explorer'].map(n => gltfLoader.loadAsync(`assets/models/${n}.glb`)));
  const assets = { 'ink-fox': fox, fluffy, explorer };
  const placeModel = (src, height) => {
    const m = SkeletonUtils.clone(src.scene), bb = new THREE.Box3().setFromObject(m), s = height / (bb.max.y - bb.min.y);
    m.scale.setScalar(s); m.position.y = -bb.min.y * s; m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const holder = new THREE.Group(); holder.add(m); return { holder, model: m };
  };
  const playClip = (model, src, name) => { const mx = new THREE.AnimationMixer(model); const clip = src.animations.find(c => c.name === name) || src.animations[0]; if (clip) mx.clipAction(clip).play(); mixers.push(mx); return mx; };
  const later = []; // async loads that tag meshes after placement

  // ---------- shop rooftop icons ----------
  function shopIcon(kind, color) {
    const g = new THREE.Group(), mat = M(color, { roughness: 0.4, metalness: 0.2 }), ink = M(COL.ink), white = M(0xffffff);
    const extrude = (shape, depth = 0.35) => { const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 18 }); geo.center(); return solid(new THREE.Mesh(geo, mat)); };
    if (kind === 'city') { g.add(box(0.5, 1.6, 0.5, mat, -0.45, 0.8, 0), box(0.55, 1.1, 0.55, white, 0.15, 0.55, 0.15), box(0.45, 2.1, 0.45, ink, 0.55, 1.05, -0.3)); }
    else if (kind === 'checker') { const t = tex2d(128, 128, (c, w) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? '#ffffff' : '#1d2a30'; c.fillRect(x * 32, y * 32, 32, 32); } }); const cube = solid(new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshStandardMaterial({ map: t }))); cube.position.y = 0.9; cube.rotation.set(0.5, 0.6, 0); g.add(cube); }
    else if (kind === 'mesh') { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), new THREE.MeshBasicMaterial({ color, wireframe: true })); m.position.y = 0.95; const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), M(0xffffff, { transparent: true, opacity: 0.5 })); inner.position.y = 0.95; g.add(m, inner); }
    else if (kind === 'cable') { const curve = new THREE.CatmullRomCurve3([[-0.9, 1.6, 0], [-0.4, 0.4, 0.3], [0.2, 1.2, -0.3], [0.9, 0.3, 0.2]].map(p => new THREE.Vector3(...p))); g.add(solid(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.12, 8), mat)), box(0.25, 1.8, 0.25, ink, -0.95, 0.9, 0), box(0.25, 0.5, 0.25, ink, 0.95, 0.25, 0.2)); }
    else if (kind === 'check') { const s = new THREE.Shape(); s.moveTo(-0.9, 0.1); s.lineTo(-0.55, 0.45); s.lineTo(-0.2, 0.1); s.lineTo(0.6, 0.9); s.lineTo(0.95, 0.55); s.lineTo(-0.2, -0.6); s.closePath(); const m = extrude(s); m.position.y = 1; g.add(m); }
    else if (kind === 'nut') { const s = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 0.85, Math.sin(a) * 0.85); } s.closePath(); const h = new THREE.Path(); h.absarc(0, 0, 0.38, 0, Math.PI * 2, true); s.holes.push(h); const m = extrude(s, 0.45); m.position.y = 1; g.add(m); }
    else if (kind === 'gear') { const s = new THREE.Shape(), n = 10; for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * Math.PI * 2, r = i % 2 ? 0.68 : 0.9, a2 = a + Math.PI / (n * 2); s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); s.lineTo(Math.cos(a2) * r, Math.sin(a2) * r); } s.closePath(); const h = new THREE.Path(); h.absarc(0, 0, 0.3, 0, Math.PI * 2, true); s.holes.push(h); const m = extrude(s, 0.35); m.position.y = 1; g.add(m); }
    else if (kind === 'shapes') { const sp = solid(new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), mat)); sp.position.set(-0.5, 0.45, 0.2); const cone = solid(new THREE.Mesh(new THREE.ConeGeometry(0.45, 1, 24), ink)); cone.position.set(0.55, 0.5, 0); g.add(box(0.75, 0.75, 0.75, white, 0, 1.15, -0.2), sp, cone); }
    else if (kind === 'radial') { const ring = solid(new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.09, 8, 40), mat)); ring.position.y = 1; g.add(ring); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, m = box(0.36, 0.22, 0.12, i % 2 ? white : ink, Math.cos(a) * 0.75, 1 + Math.sin(a) * 0.75, 0); m.rotation.z = a; g.add(m); } const dot = solid(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), white)); dot.position.y = 1; g.add(dot); }
    else if (kind === 'gift') { g.add(box(1.2, 0.9, 1.2, mat, 0, 0.45, 0), box(1.3, 0.25, 1.3, mat, 0, 1.0, 0), box(0.22, 1.18, 1.32, white, 0, 0.6, 0), box(1.32, 1.18, 0.22, white, 0, 0.6, 0)); const bow = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 8, 20), white); bow.position.set(-0.22, 1.3, 0); const bow2 = bow.clone(); bow2.position.x = 0.22; g.add(bow, bow2); }
    return g;
  }

  // ---------- building builders: each returns { group, colliders (local), labelY, nearY, depth } ----------
  const shopGlass = new THREE.MeshStandardMaterial({ color: 0x2a3f4c, roughness: 0.2, emissive: 0xffc677, emissiveIntensity: 0 }); nightFx.push(k => { shopGlass.emissiveIntensity = k * 0.9; });
  const BUILD = {
    tower(b) {
      const g = new THREE.Group(), W = b.w, D = b.d, H = b.h, podH = 7, pw = W + 6, pd = D + 6, acc = hex(b.accent);
      const covers = b.items.filter(i => i.cover).map(i => i.cover);
      g.add(box(pw, podH, pd, M(0xe3ded4), 0, podH / 2, 0));
      const wt = windowTex('#3b6a8a', '#a8d6ec'); wt.repeat.set(W / 3, H / 3.4);
      const towerGlass = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.3, metalness: 0.2, envMapIntensity: 1.2, emissiveMap: wt, emissive: 0xffe9bf, emissiveIntensity: 0 });
      nightFx.push(k => { towerGlass.emissiveIntensity = k * 1.1; });
      g.add(box(W, H, D, towerGlass, 0, podH + H / 2, 0));
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1]]) g.add(box(0.9, H, 0.9, M(0xebe6dc), sx * W / 2, podH + H / 2, sz * D / 2));
      // LED ticker around the podium
      const tick = tickerTex('Character animation   ·   Rigging   ·   Real-time effects   ·   Maya   ·   Unity   ·   ', '#8fe6ff', '#0c1518'); tick.repeat.set(2.2, 1);
      const tickMat = basic(tick);
      for (const [w, rot, x, z] of [[pw, 0, 0, pd / 2 + 0.03], [pw, Math.PI, 0, -pd / 2 - 0.03], [pd, Math.PI / 2, pw / 2 + 0.03, 0], [pd, -Math.PI / 2, -pw / 2 - 0.03, 0]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.5), tickMat); m.position.set(x, podH - 1.0, z); m.rotation.y = rot; g.add(m); }
      tickers.push((t, dt) => { if (!reduced) tick.offset.x -= dt * 0.035; });
      // Times Square screens
      const scr = (w, h, aspectOff, every, x, y, z, rot) => { const texs = covers.map(u => coverTex(u, w / h)); const s = screen(w, h, texs, every, aspectOff); const bz = bezel(w, h); const grp = new THREE.Group(); s.position.z = 0.25; grp.add(bz, s); grp.position.set(x, y, z); grp.rotation.y = rot; g.add(grp); };
      scr(9.4, 13.5, 0, 4.2, W / 2 - 5.2, podH + 4 + 6.75, D / 2 + 0.2, 0);                 // tall front screen, right side
      scr(W - 1.5, 8.5, 1.3, 5.0, 0, podH + 30, D / 2 + 0.2, 0);                             // wide upper front screen
      scr(D - 4, 15, 2.1, 4.6, W / 2 + 0.2, podH + 14, 0, Math.PI / 2);                      // right side screen
      scr(D - 3, 9, 0.7, 5.4, -W / 2 - 0.2, podH + 32, 0, -Math.PI / 2);                      // left side upper screen
      scr(W - 4, 11, 3.0, 4.8, 0, podH + 22, -D / 2 - 0.2, Math.PI);                          // back screen
      // 3D corner billboard: the characters take turns stepping out onto a ledge in front of it
      const bbH = 11, bbW = 9.5, by = podH + 3, cx = -W / 2, cz = D / 2;
      const room = tex2d(512, 600, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0f2c4a'); gr.addColorStop(1, '#2a1650'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(143,230,255,.55)'; c.lineWidth = 3; for (let i = 0; i <= 10; i++) { const y = h * 0.62 + (h * 0.38) * Math.pow(i / 10, 1.8); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } for (let i = -6; i <= 16; i++) { c.beginPath(); c.moveTo(w * 0.5 + (i - 5) * 18, h * 0.62); c.lineTo(w * 0.5 + (i - 5) * 120, h); c.stroke(); } });
      const wingA = new THREE.Mesh(new THREE.PlaneGeometry(bbW, bbH), basic(room)); wingA.position.set(cx + bbW / 2, by + bbH / 2, cz + 0.35);
      const wingB = new THREE.Mesh(new THREE.PlaneGeometry(bbW, bbH), basic(room)); wingB.position.set(cx - 0.35, by + bbH / 2, cz - bbW / 2); wingB.rotation.y = -Math.PI / 2;
      const fr = M(0x161d22, { roughness: 0.5 }), lx = cx - 3.4, lz = cz + 3.4;
      g.add(wingA, wingB, box(bbW + 0.6, 0.6, 0.8, fr, cx + bbW / 2, by + bbH + 0.3, cz + 0.4), box(0.8, 0.6, bbW + 0.6, fr, cx - 0.4, by + bbH + 0.3, cz - bbW / 2),
        box(bbW + 0.6, 0.6, 0.8, fr, cx + bbW / 2, by - 0.3, cz + 0.4), box(0.8, 0.6, bbW + 0.6, fr, cx - 0.4, by - 0.3, cz - bbW / 2));
      // the ledge sits fully outside the screens, so nobody stands inside the building
      const ledge = solid(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 40), fr)); ledge.position.set(lx, by - 0.25, lz); g.add(ledge);
      const ledgeGlow = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.07, 6, 48), new THREE.MeshBasicMaterial({ color: 0x8fe6ff })); ledgeGlow.rotation.x = Math.PI / 2; ledgeGlow.position.set(lx, by + 0.02, lz); g.add(ledgeGlow);
      g.add(box(0.5, by, 0.5, fr, lx, by / 2, lz));
      const cast = [[fox, 6.2, ['wave', 'Joy', 'jump']], [fluffy, 6.0, ['wave', 'Joy', 'look_around']], [explorer, 6.6, ['Approval', 'Joy']]].map(([src, h, emotes]) => {
        const { holder, model } = placeModel(src, h); holder.position.set(lx, by, lz); holder.rotation.y = -Math.PI / 4; holder.visible = false; g.add(holder);
        const mx = new THREE.AnimationMixer(model); mixers.push(mx);
        const clip = n => src.animations.find(c => c.name === n);
        const idle = mx.clipAction(clip('idle') || src.animations[0]); idle.play();
        return { holder, mx, idle, emotes: emotes.map(clip).filter(Boolean), k: 0 };
      });
      const emote = c => { const clip = c.emotes[c.k++ % c.emotes.length]; if (!clip || reduced) return; const a = c.mx.clipAction(clip); a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play(); c.idle.fadeOut(0.25); setTimeout(() => { c.idle.reset().fadeIn(0.3).play(); a.fadeOut(0.3); }, Math.max(400, clip.duration * 1000 - 300)); };
      const backOut = v => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2); };
      let ci = 0, swapAt = 7, swap = null; cast[0].holder.visible = true; setTimeout(() => emote(cast[0]), 1500);
      tickers.push(t => {
        if (swap) {
          const u = t - swap.t0;
          if (u < 0.3) swap.from.holder.scale.setScalar(Math.max(0.001, 1 - u / 0.3));
          else { swap.from.holder.visible = false; swap.to.holder.visible = true; const v = Math.min(1, (u - 0.3) / 0.5); swap.to.holder.scale.setScalar(Math.max(0.001, backOut(v))); if (v >= 1) { emote(swap.to); swap = null; } }
          return;
        }
        if (t < swapAt) return;
        swapAt = t + 7; const from = cast[ci]; ci = (ci + 1) % cast.length; const to = cast[ci];
        if (reduced) { from.holder.visible = false; to.holder.visible = true; to.holder.scale.setScalar(1); } else swap = { from, to, t0: t };
      });
      // crown, rotating name ring, antenna
      g.add(box(W * 0.66, 3.2, D * 0.66, M(acc), 0, podH + H + 1.6, 0));
      const ringTex = tickerTex('Animation tower   ·   Happy Singh   ·   ', '#ffffff', '#3d8fb8'); ringTex.repeat.set(1.6, 1);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.42, W * 0.42, 2.6, 48, 1, true), basic(ringTex, { side: THREE.FrontSide })); ring.position.y = podH + H + 5.2; g.add(ring);
      tickers.push((t, dt) => { if (!reduced) ring.rotation.y += dt * 0.25; });
      const ant = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 10, 8), M(0xdddddd))); ant.position.y = podH + H + 8.5; g.add(ant);
      g.add(box(6, 3.8, 0.3, M(0x22343f, { roughness: 0.2 }), 2, 1.9, pd / 2 + 0.02));
      const s = signMesh({ title: b.title, sub: b.sub, accent: b.accent }, 9.5, 1.7); s.position.set(-6, 3.4, pd / 2 + 0.06); g.add(s);
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: pw / 2, hd: pd / 2, h: podH + H + 12 }, { kind: 'circle', x: lx, z: lz, r: 3.4, h: by + 7 }], labelY: podH + H + 18, nearY: 18, depth: pd / 2 };
    },
    showroom(b) {
      const g = new THREE.Group(), acc = hex(b.accent), round = b.variant === 'round';
      const glass = new THREE.MeshStandardMaterial({ color: 0xe4f3f8, metalness: 1, roughness: 0.03, transparent: true, opacity: 0.42, envMapIntensity: 2.6, depthWrite: false, side: THREE.DoubleSide });
      const frame = M(0x26323b, { metalness: 0.6, roughness: 0.32 }), stone = M(0xe6e1d6);
      let pedR = 2.6, pedH = 2.2, depth, colliders;
      if (round) {
        const plinth = solid(new THREE.Mesh(new THREE.CylinderGeometry(b.r + 1.2, b.r + 1.4, 1, 48), stone)); plinth.position.y = 0.5; g.add(plinth);
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, b.h, 48, 1, true), glass); cyl.position.y = 1 + b.h / 2; g.add(cyl);
        for (const y of [1, 1 + b.h]) { const r = new THREE.Mesh(new THREE.TorusGeometry(b.r, 0.18, 8, 64), frame); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); }
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.add(box(0.2, b.h, 0.2, frame, Math.sin(a) * b.r, 1 + b.h / 2, Math.cos(a) * b.r)); }
        const roof = solid(new THREE.Mesh(new THREE.CylinderGeometry(b.r + 1, b.r + 1, 0.7, 48), M(acc))); roof.position.y = 1 + b.h + 0.35; g.add(roof);
        depth = b.r + 1.4; colliders = [{ kind: 'circle', x: 0, z: 0, r: b.r + 1.2, h: b.h + 3 }];
      } else {
        g.add(box(b.w + 2, 1, b.d + 2, stone, 0, 0.5, 0));
        { const gb = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), glass); gb.position.y = 1 + b.h / 2; g.add(gb); }
        g.add(edgeFrame(b.w, b.h, b.d, 1, frame));
        g.add(box(b.w + (b.variant === 'cube' ? 3 : 1.4), 0.8, b.d + (b.variant === 'cube' ? 3 : 1.4), M(acc), 0, 1 + b.h + 0.4, 0));
        if (b.variant === 'tower') for (const y of [1 + b.h * 0.62, 1 + b.h * 0.82]) { const hw = b.w / 2, hd = b.d / 2; g.add(box(b.w, 0.16, 0.16, frame, 0, y, hd), box(b.w, 0.16, 0.16, frame, 0, y, -hd), box(0.16, 0.16, b.d, frame, hw, y, 0), box(0.16, 0.16, b.d, frame, -hw, y, 0)); }
        if (b.variant === 'tower') { const crown = new THREE.Mesh(new THREE.CylinderGeometry(b.w * 0.36, b.w * 0.36, 0.5, 6), M(0xffffff, { roughness: 0.3 })); crown.position.y = 1 + b.h + 1.05; g.add(crown); }
        if (b.variant === 'cube') { pedR = 3.4; pedH = 1.4; }
        depth = b.d / 2 + 1; colliders = [{ kind: 'rect', x: 0, z: 0, hw: b.w / 2 + 1, hd: b.d / 2 + 1, h: b.h + 3 }];
      }
      const ped = solid(new THREE.Mesh(new THREE.CylinderGeometry(pedR, pedR + 0.2, pedH, 40), M(0xf4f1ea, { roughness: 0.4 }))); ped.position.y = 1 + pedH / 2; g.add(ped);
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(pedR + 0.05, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color: acc })); glowRing.rotation.x = Math.PI / 2; glowRing.position.y = 1 + pedH + 0.02; g.add(glowRing);
      const lamp = new THREE.PointLight(0xfff1dc, 140, 30, 2); lamp.position.set(0, 1 + b.h - 1.5, 2); g.add(lamp);
      const turn = new THREE.Group(); turn.position.y = 1 + pedH; g.add(turn);
      tickers.push((t, dt) => { if (!reduced) turn.rotation.y += dt * 0.4; });
      later.push(gltfLoader.loadAsync(b.model).then(gltf => {
        const m = gltf.scene, bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3()), s = b.productH / size.y;
        m.scale.setScalar(s); bb.setFromObject(m); const c = bb.getCenter(new THREE.Vector3());
        m.position.set(-c.x, -bb.min.y, -c.z); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.bid = b.id; if (o.material) o.material.envMapIntensity = 1.2; } });
        turn.add(m);
      }));
      const sign = postSign({ title: b.title, sub: b.sub, accent: b.accent }, 6.4, 1.4, 1.9); sign.position.z = depth + 2.4; g.add(sign);
      colliders.push({ kind: 'rect', x: 0, z: depth + 2.3, hw: 3.3, hd: 0.3, h: 3.5 });
      return { group: g, colliders, labelY: 1 + b.h + 7, nearY: Math.min(1 + b.h + 3, 13), depth: depth + 3 };
    },
    video(b) {
      const g = new THREE.Group(), acc = hex(b.accent);
      g.add(box(b.w, b.h, b.d, M(0x46535f), 0, b.h / 2, 0));
      g.add(box(b.w + 0.6, 1, b.d + 0.6, M(acc), 0, b.h + 0.5, 0));
      const sw = b.w - 3, sh = Math.min(sw * 9 / 16, b.h - 5.4), sy = 4.6 + sh / 2;
      const s0 = screen(sw, sh, b.items.map(i => coverTex(i.cover, sw / sh)), 3.5); s0.position.set(0, sy, b.d / 2 + 0.2);
      g.add(box(sw + 0.9, sh + 0.9, 0.3, M(0x161d22), 0, sy, b.d / 2 + 0.02), s0);
      // clapperboard standing on the front edge of the roof, readable from the ground; the take number goes up on every clap
      const clap = new THREE.Group(); clap.position.set(-b.w / 2 + 5.2, b.h + 1, b.d / 2 - 0.7); clap.scale.setScalar(1.2); g.add(clap);
      const stripes = tex2d(256, 64, (c, w, h) => { c.fillStyle = '#1d2a30'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; for (let i = -1; i < 9; i++) { c.beginPath(); c.moveTo(i * 32, h); c.lineTo(i * 32 + 16, h); c.lineTo(i * 32 + 32, 0); c.lineTo(i * 32 + 16, 0); c.fill(); } });
      const slate = document.createElement('canvas'); slate.width = 512; slate.height = 320; const sg = slate.getContext('2d'); const slateTex = new THREE.CanvasTexture(slate); slateTex.colorSpace = THREE.SRGBColorSpace; slateTex.anisotropy = maxAniso;
      let take = 1;
      const drawSlate = () => {
        sg.fillStyle = '#161d22'; sg.fillRect(0, 0, 512, 320); sg.strokeStyle = 'rgba(255,255,255,.85)'; sg.lineWidth = 4;
        sg.strokeRect(14, 14, 484, 292); sg.beginPath(); sg.moveTo(14, 118); sg.lineTo(498, 118); sg.moveTo(14, 222); sg.lineTo(498, 222); sg.moveTo(176, 118); sg.lineTo(176, 222); sg.moveTo(338, 118); sg.lineTo(338, 222); sg.stroke();
        sg.fillStyle = '#ffffff'; sg.textAlign = 'center'; sg.font = `600 54px ${DISPLAY}`; sg.fillText('HAPPY SINGH', 256, 86);
        sg.font = `500 22px ${BODY}`; sg.fillStyle = 'rgba(255,255,255,.7)'; sg.fillText('SCENE', 95, 146); sg.fillText('TAKE', 257, 146); sg.fillText('ROLL', 418, 146);
        sg.fillStyle = '#ffffff'; sg.font = `600 50px ${DISPLAY}`; sg.fillText('07', 95, 204); sg.fillText(String(take), 257, 204); sg.fillText('A', 418, 204);
        sg.font = `500 26px ${BODY}`; sg.fillText('VIDEO EDITING  ·  MOTION  ·  FILM', 256, 276); slateTex.needsUpdate = true;
      };
      drawSlate();
      const ink = M(COL.ink), stripeMat = new THREE.MeshStandardMaterial({ map: stripes });
      clap.add(solid(new THREE.Mesh(new THREE.BoxGeometry(7, 4.4, 0.7), [ink, ink, ink, ink, new THREE.MeshBasicMaterial({ map: slateTex, toneMapped: false }), ink])).translateY(2.2));
      clap.add(solid(new THREE.Mesh(new THREE.BoxGeometry(7, 0.85, 0.7), stripeMat)).translateY(4.83));
      const hinge = new THREE.Group(); hinge.position.set(-3.5, 5.3, 0); clap.add(hinge);
      const stick = solid(new THREE.Mesh(new THREE.BoxGeometry(7, 0.85, 0.7), stripeMat)); stick.position.set(3.5, 0.43, 0); hinge.add(stick);
      let wasOpen = false;
      tickers.push(t => {
        if (reduced) { hinge.rotation.z = 0.3; return; }
        const ph = t % 4.2, open = ph < 0.9 ? ph / 0.9 : ph < 3.4 ? 1 : ph < 3.5 ? 1 - (ph - 3.4) / 0.1 : 0;
        hinge.rotation.z = open * 0.42;
        if (open > 0.5) wasOpen = true; else if (wasOpen && open === 0) { wasOpen = false; take = take % 9 + 1; drawSlate(); }
      });
      g.add(box(3.6, 3.6, 0.3, M(0x22343f, { roughness: 0.2 }), b.w / 2 - 3.5, 1.8, b.d / 2 + 0.05));
      const s = signMesh({ title: b.title, sub: b.sub, accent: b.accent }, 10, 1.9); s.position.set(-3, 2.1, b.d / 2 + 0.08); g.add(s);
      const band = new THREE.MeshBasicMaterial({ color: acc });
      for (const y of [b.h * 0.33, b.h * 0.66]) g.add(box(b.w + 0.1, 0.3, b.d + 0.1, band, 0, y, 0));
      const winT = windowTex('#2c3a44', '#7fb6d1'); winT.repeat.set(4, 3);
      const sideMat = new THREE.MeshStandardMaterial({ map: winT, roughness: 0.3, emissiveMap: winT, emissive: 0xffe2b0, emissiveIntensity: 0 }); nightFx.push(k => { sideMat.emissiveIntensity = k; });
      for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(b.d - 3, b.h - 4), sideMat); side.position.set(sx * (b.w / 2 + 0.03), b.h / 2 + 0.5, 0); side.rotation.y = sx * Math.PI / 2; g.add(side); }
      const recPlate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), basic(tex2d(340, 130, (c, w, h) => { c.fillStyle = '#161d22'; c.beginPath(); c.roundRect(0, 0, w, h, 24); c.fill(); c.fillStyle = '#ffffff'; c.font = `600 64px ${DISPLAY}`; c.fillText('REC', 120, 90); }), { transparent: true }));
      recPlate.position.set(b.w / 2 - 3, b.h + 1.75, b.d / 2 + 0.02); g.add(recPlate, box(0.15, 0.8, 0.15, M(COL.ink), b.w / 2 - 3, b.h + 1.3, b.d / 2 - 0.1));
      const rec = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff3b3b })); rec.position.set(b.w / 2 - 4.05, b.h + 1.75, b.d / 2 + 0.2); g.add(rec);
      tickers.push(t => { rec.visible = reduced || Math.sin(t * 3) > -0.3; });
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: b.w / 2, hd: b.d / 2, h: b.h + 6 }], labelY: b.h + 8, nearY: b.h + 2, depth: b.d / 2 };
    },
    design(b) {
      const g = new THREE.Group(), W = b.w, D = b.d, H = b.h, blue = hex(b.accent), sel = new THREE.MeshBasicMaterial({ color: blue }), ink = M(COL.ink, { roughness: 0.5 }), white = M(0xffffff, { roughness: 0.5 });
      g.add(box(W, H, D, M(0xfafaf8, { roughness: 0.6 }), 0, H / 2, 0));
      // the facade is an artboard that cycles through the design work
      const sw = W - 4, sh = H - 7.5, sy = 5.2 + sh / 2;
      const boards = b.items.map(i => artboardTex(i.cover, i.title, 1024, Math.round(1024 * sh / sw)));
      const art = screen(sw, sh, boards, 4.5); art.position.set(0, sy, D / 2 + 0.06); g.add(art);
      const crop = (x, y, sx, sy2) => { g.add(box(1.4, 0.12, 0.08, ink, x + sx * 0.9, y, D / 2 + 0.08), box(0.12, 1.4, 0.08, ink, x, y + sy2 * 0.9, D / 2 + 0.08)); };
      crop(-sw / 2 - 0.5, sy - sh / 2 - 0.5, -1, -1); crop(sw / 2 + 0.5, sy - sh / 2 - 0.5, 1, -1); crop(-sw / 2 - 0.5, sy + sh / 2 + 0.5, -1, 1); crop(sw / 2 + 0.5, sy + sh / 2 + 0.5, 1, 1);
      // the whole building is "selected": bounding box, transform handles and a rotate handle
      const SW = W + 0.9, SH = H + 0.9, SD = D + 0.9, t = 0.14;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(t, SH, t, sel, sx * SW / 2, SH / 2, sz * SD / 2));
      for (const y of [0.07, SH]) g.add(box(SW, t, t, sel, 0, y, SD / 2), box(SW, t, t, sel, 0, y, -SD / 2), box(t, t, SD, sel, SW / 2, y, 0), box(t, t, SD, sel, -SW / 2, y, 0));
      const handle = (x, y, z) => { g.add(box(1.25, 1.25, 0.3, sel, x, y, z), box(0.95, 0.95, 0.36, white, x, y, z + 0.02)); };
      for (const x of [-SW / 2, 0, SW / 2]) for (const y of [0.6, SH / 2, SH]) if (!(x === 0 && y === SH / 2)) handle(x, y, SD / 2 + 0.1);
      g.add(box(0.1, 3.2, 0.1, sel, 0, SH + 1.6, SD / 2));
      const rot = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 8, 32), sel); rot.position.set(0, SH + 3.8, SD / 2); g.add(rot);
      // pen tool on the roof
      const nib = new THREE.Shape(); nib.moveTo(0, 0); nib.quadraticCurveTo(2.0, 2.3, 1.55, 4.3); nib.lineTo(-1.55, 4.3); nib.quadraticCurveTo(-2.0, 2.3, 0, 0);
      const hole = new THREE.Path(); hole.absarc(0, 2.5, 0.45, 0, Math.PI * 2, true); nib.holes.push(hole);
      const slit = new THREE.Path(); slit.moveTo(-0.09, 0.45); slit.lineTo(-0.09, 2.05); slit.lineTo(0.09, 2.05); slit.lineTo(0.09, 0.45); slit.closePath(); nib.holes.push(slit);
      const pen = new THREE.Group(); const nibM = solid(new THREE.Mesh(new THREE.ExtrudeGeometry(nib, { depth: 0.8, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 24 }), ink)); nibM.position.z = -0.4;
      pen.add(nibM, box(3.4, 1.1, 1.1, white, 0, 4.95, 0), box(3.0, 0.5, 1.0, sel, 0, 5.75, 0)); pen.scale.setScalar(1.55); pen.position.set(W * 0.18, H + 0.6, -1); pen.rotation.z = -0.45; g.add(pen);
      // a Bézier curve arch over the path in front, with anchors and handles
      const z0 = D / 2 + 7, A = new THREE.Vector3(-8, 0.3, z0), C1 = new THREE.Vector3(-8.5, 12, z0), C2 = new THREE.Vector3(8.5, 12, z0), B2 = new THREE.Vector3(8, 0.3, z0);
      g.add(solid(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CubicBezierCurve3(A, C1, C2, B2), 80, 0.32, 10), ink)));
      for (const [p, c] of [[A, C1], [B2, C2]]) {
        g.add(box(1.4, 1.4, 1.4, sel, p.x, 0.7, p.z), box(1.05, 1.05, 1.5, white, p.x, 0.7, p.z));
        const len = p.distanceTo(c), mid = p.clone().add(c).multiplyScalar(0.5), line = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), sel);
        line.position.copy(mid); line.lookAt(c); line.rotateX(Math.PI / 2); g.add(line);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), sel); dot.position.copy(c); g.add(dot);
      }
      // swatch fan
      const fan = new THREE.Group(); fan.position.set(W / 2 + 4.2, 0, D / 2 + 1.5); fan.rotation.y = -0.5;
      ['#ef476f', '#f78c6b', '#ffd166', '#06d6a0', '#118ab2', '#073b4c', '#8a6fd1'].forEach((c, i, arr) => {
        const t = tex2d(128, 512, (cx, w, h) => { cx.fillStyle = c; cx.fillRect(0, 0, w, h * 0.78); cx.fillStyle = '#ffffff'; cx.fillRect(0, h * 0.78, w, h * 0.22); cx.fillStyle = '#1d2a30'; cx.font = `600 22px ${BODY}`; cx.fillText(c.toUpperCase(), 12, h * 0.9); });
        const card = solid(new THREE.Mesh(new THREE.BoxGeometry(1.5, 6.4, 0.08), [M(0xffffff), M(0xffffff), M(0xffffff), M(0xffffff), new THREE.MeshStandardMaterial({ map: t }), new THREE.MeshStandardMaterial({ map: t })]));
        card.geometry.translate(0, 3.2, 0); card.position.z = i * 0.09; card.rotation.z = (i - (arr.length - 1) / 2) * 0.17; fan.add(card);
      });
      fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 16).rotateX(Math.PI / 2), M(0xd0d4d6, { metalness: 0.8, roughness: 0.3 })).translateY(0.6).translateZ(0.3));
      g.add(fan);
      g.add(box(3.6, 3.8, 0.3, M(0x22343f, { roughness: 0.2 }), 0, 1.9, D / 2 + 0.05));
      const s = signMesh({ title: b.title, sub: b.sub, accent: b.accent }, 7, 1.6); s.position.set(-6.5, 2.4, D / 2 + 0.08); g.add(s);
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: W / 2 + 0.6, hd: D / 2 + 0.6, h: H + 10 }, { kind: 'circle', x: A.x, z: A.z, r: 1, h: 2 }, { kind: 'circle', x: B2.x, z: B2.z, r: 1, h: 2 }, { kind: 'circle', x: W / 2 + 4.2, z: D / 2 + 1.5, r: 1.2, h: 7 }],
        labelY: H + 13, nearY: H + 2, depth: D / 2 + 8 };
    },
    lot(b) {
      const g = new THREE.Group(), [lw, ld] = b.lot, acc = hex(b.accent), slabH = 0.35;
      g.add(box(lw, slabH, ld, M(0x26313a, { roughness: 0.85 }), 0, slabH / 2, 0));
      const glow = new THREE.MeshBasicMaterial({ color: acc });
      g.add(box(lw, 0.08, 0.3, glow, 0, slabH + 0.02, ld / 2 - 0.15), box(lw, 0.08, 0.3, glow, 0, slabH + 0.02, -ld / 2 + 0.15), box(0.3, 0.08, ld, glow, lw / 2 - 0.15, slabH + 0.02, 0), box(0.3, 0.08, ld, glow, -lw / 2 + 0.15, slabH + 0.02, 0));
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(lw, b.boxH, ld)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })); wire.position.y = b.boxH / 2 + slabH; g.add(wire);
      later.push(gltfLoader.loadAsync(b.model).then(gltf => {
        const root = gltf.scene;
        root.traverse(o => {
          if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.userData.bid = b.id;
          const list = Array.isArray(o.material) ? o.material : [o.material];
          list.forEach((m, i) => {
            let mat = m;
            if (b.toon && TOON.includes(m.name)) { mat = new THREE.MeshToonMaterial({ color: m.color, map: m.map, gradientMap: toonRamp }); mat.name = m.name; if (Array.isArray(o.material)) o.material[i] = mat; else o.material = mat; }
            const gl = GLOW[m.name]; if (gl && mat.emissive) { mat.emissive.copy(mat.color); mat.emissiveMap = mat.map || null; mat.emissiveIntensity = gl; }
          });
        });
        const bb = new THREE.Box3().setFromObject(root), size = bb.getSize(new THREE.Vector3());
        const s = Math.min(b.fit[0] / size.x, b.fit[1] / size.z, b.fit[2] / size.y); root.scale.multiplyScalar(s);
        bb.setFromObject(root); const c = bb.getCenter(new THREE.Vector3()); root.position.set(-c.x, slabH - bb.min.y, -c.z);
        if (b.modelRot) root.rotation.y = b.modelRot;
        g.add(root);
        if (b.anim && gltf.animations.length) {
          const mx = new THREE.AnimationMixer(root); mixers.push(mx);
          if (b.anim === '*') gltf.animations.forEach(cl => mx.clipAction(cl).play());
          else {
            const idle = mx.clipAction(gltf.animations.find(a => a.name === b.anim) || gltf.animations[0]); idle.play();
            const extras = gltf.animations.filter(a => a.name !== b.anim);
            if (extras.length) { let next = 9, k = 0; tickers.push(t => { if (reduced || t < next) return; const clip = extras[k++ % extras.length], a = mx.clipAction(clip); a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play(); idle.fadeOut(0.25); next = t + clip.duration + 10; setTimeout(() => { idle.reset().fadeIn(0.35).play(); a.fadeOut(0.35); }, clip.duration * 1000 - 300); }); }
          }
        }
      }));
      const sign = postSign({ title: b.title, sub: b.lotLabel, accent: b.accent }, 7.2, 1.6, 2.0); sign.position.z = ld / 2 + 2.2; g.add(sign);
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: lw / 2, hd: ld / 2, h: b.boxH }, { kind: 'rect', x: 0, z: ld / 2 + 2.1, hw: 3.7, hd: 0.3, h: 4 }], labelY: b.boxH + 6, nearY: Math.min(b.boxH, 14), depth: ld / 2 + 2.5 };
    },
    workshop(b) {
      const g = new THREE.Group(), tw = b.w / 3;
      g.add(box(b.w, b.h, b.d, M(0xc9754f), 0, b.h / 2, 0));
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(tw, 0); shape.lineTo(tw, 3.4); shape.closePath();
      const tooth = new THREE.ExtrudeGeometry(shape, { depth: b.d, bevelEnabled: false });
      for (let i = 0; i < 3; i++) {
        const m = solid(new THREE.Mesh(tooth, M(0xe8e3d9))); m.position.set(-b.w / 2 + i * tw, b.h, -b.d / 2); g.add(m);
        g.add(box(0.12, 2.9, b.d - 0.6, M(0x9fd0e6, { roughness: 0.15 }), -b.w / 2 + (i + 1) * tw - 0.08, b.h + 1.6, 0));
      }
      const sw = 9, sh = b.h - 3.2, s0 = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), basic(coverTex(b.items[0].cover, sw / sh)));
      s0.position.set(-4.2, sh / 2 + 1.5, b.d / 2 + 0.25); g.add(bezel(sw, sh).translateX(-4.2).translateY(sh / 2 + 1.5).translateZ(b.d / 2 + 0.02), s0);
      g.add(box(3, 3.6, 0.3, M(0x22343f, { roughness: 0.2 }), b.w / 2 - 3.4, 1.8, b.d / 2 + 0.05));
      const s = signMesh({ title: b.title, sub: 'Free, runs in your browser', accent: b.accent }, 7.6, 1.6); s.position.set(b.w / 2 - 4.6, 4.9, b.d / 2 + 0.08); g.add(s);
      const icon = shopIcon('gear', hex(b.accent)); icon.scale.setScalar(2.4); icon.position.set(b.w / 2 - 3, b.h + 3.4, 0); g.add(icon);
      tickers.push((t, dt) => { if (!reduced) icon.rotation.y += dt * 0.5; });
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: b.w / 2, hd: b.d / 2, h: b.h + 4 }], labelY: b.h + 10, nearY: b.h + 4, depth: b.d / 2 };
    },
    shop(b) {
      const g = new THREE.Group();
      g.add(box(b.w, b.h, b.d, M(hex(b.body)), 0, b.h / 2, 0));
      g.add(box(b.w + 0.4, 0.4, b.d + 0.4, M(COL.white), 0, b.h + 0.2, 0));
      g.add(box(b.w - 1.6, 1.7, 0.2, shopGlass, 0, 2.15, b.d / 2 + 0.05));
      g.add(box(b.w - 1, 0.22, 0.9, M(COL.white), 0, 1.1, b.d / 2 + 0.45));
      const stripes = tex2d(256, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : b.accent; c.fillRect(i * 32, 0, 32, h); } });
      const aw = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 0.4, 1.9), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide }));
      aw.position.set(0, 3.4, b.d / 2 + 0.8); aw.rotation.x = -1.0; aw.castShadow = true; g.add(aw);
      g.add(box(b.w + 0.6, 1.6, 0.15, M(COL.white), 0, b.h + 1.2, b.d / 2 - 0.25));
      const s = signMesh({ title: b.title, sub: b.sub, accent: b.accent }, b.w + 0.5, 1.5); s.position.set(0, b.h + 1.2, b.d / 2 - 0.16); g.add(s);
      const icon = shopIcon(b.icon, hex(b.accent)); icon.position.set(0, b.h + 2.4, -0.6); g.add(icon);
      const ph = rnd() * 6; tickers.push((t, dt) => { if (!reduced) { icon.rotation.y += dt * 0.6; icon.position.y = b.h + 2.4 + Math.sin(t * 1.4 + ph) * 0.15; } });
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0.3, hw: b.w / 2, hd: b.d / 2 + 0.5, h: b.h + 4 }], labelY: b.h + 6, nearY: b.h + 4.6, depth: b.d / 2 + 1 };
    },
    kiosk(b) {
      const g = new THREE.Group();
      g.add(box(b.w, b.h, b.d, M(COL.white), 0, b.h / 2, 0));
      g.add(box(b.w + 1.2, 0.5, b.d + 1.2, M(hex(b.accent)), 0, b.h + 0.25, 0));
      const face = signMesh({ title: b.title, sub: b.sub, accent: b.accent }, b.w - 0.6, 1.7); face.position.set(0, b.h * 0.62, b.d / 2 + 0.03); g.add(face);
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: b.w / 2, hd: b.d / 2, h: b.h + 1 }], labelY: b.h + 4, nearY: b.h + 3, depth: b.d / 2 };
    },
    garden(b) {
      const g = new THREE.Group(), acc = hex(b.accent);
      const lawn = new THREE.Mesh(new THREE.CircleGeometry(b.r, 48), M(0xa6d47d)); lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.05; lawn.receiveShadow = true; lawn.userData.walk = true; g.add(lawn);
      const bushes = [];
      for (let a = 0; a < Math.PI * 2; a += 0.19) { if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.45) continue; bushes.push([Math.sin(a) * b.r, Math.cos(a) * b.r, 0.9 + rnd() * 0.5]); }
      const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M(0xffffff, { flatShading: true }), bushes.length);
      const mm = new THREE.Matrix4(), cc = new THREE.Color();
      bushes.forEach(([x, z, s], i) => { bm.setMatrixAt(i, mm.makeScale(s * 1.2, s, s * 1.2).setPosition(x, s * 0.7, z)); bm.setColorAt(i, cc.set(['#4f9a45', '#5fae4f', '#6cba57'][i % 3])); });
      bm.castShadow = true; bm.userData.walk = true; g.add(bm);
      const glow = new THREE.MeshBasicMaterial({ color: acc });
      b.items.filter(i => i.kind === 'model').slice(0, 3).forEach((item, i) => {
        const x = (i - 1) * 5.4, base = new THREE.Group(); base.position.set(x, 0, -1);
        base.add(solid(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 1, 40), M(0xf1ece2))).translateY(0.5));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.07, 8, 48), glow); ring.rotation.x = Math.PI / 2; ring.position.y = 1.02; base.add(ring);
        const src = assets[item.id];
        if (src) { const { holder, model } = placeModel(src, item.id === 'explorer' ? 3.2 : 2.6); holder.position.y = 1.0; base.add(holder); playClip(model, src, 'idle'); tickers.push((t, dt) => { if (!reduced) holder.rotation.y += dt * 0.3; }); }
        base.userData.itemId = item.id; g.add(base);
      });
      const board = postSign({ title: b.title, sub: b.sub, accent: b.accent }, 6.4, 1.5, 2.2); board.position.z = b.r + 0.6; g.add(board);
      return { group: g, colliders: [-5.4, 0, 5.4].map(x => ({ kind: 'circle', x, z: -1, r: 2, h: 5 })), labelY: 9, nearY: 7, depth: b.r };
    },
    outpost(b) {
      // Project Frontier: a survivor's cabin with solar panels, a lookout tower, a campfire, a big screen of in-engine shots
      // and the game's axe, giant, sunk into a stump out front
      const g = new THREE.Group(), W = b.w, D = b.d, H = b.h, acc = hex(b.accent);
      const plank = tex2d(256, 256, (c, w) => { for (let y = 0; y < 8; y++) { c.fillStyle = ['#7a5333', '#6d4a2d', '#835a37', '#73502f'][y % 4]; c.fillRect(0, y * 32, w, 31); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, y * 32 + 30, w, 2); for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(40,24,12,.18)'; c.fillRect(rnd() * w, y * 32 + 6 + rnd() * 20, 30 + rnd() * 60, 1.5); } } });
      plank.wrapS = plank.wrapT = THREE.RepeatWrapping; plank.repeat.set(W / 4, H / 4);
      const wood = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.9 }), dark = M(0x3b2a1d), metal = M(0x5d6b6e, { metalness: 0.5, roughness: 0.5 });
      g.add(box(W + 6, 0.6, D + 6, M(0x8a6a48), 0, 0.3, 0));
      g.add(box(W, H, D, wood, 0, 0.6 + H / 2, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(0.5, H + 0.2, 0.5, dark, sx * W / 2, 0.6 + H / 2, sz * D / 2));
      const roofSh = new THREE.Shape(); roofSh.moveTo(-D / 2 - 1, 0); roofSh.lineTo(0, 3.6); roofSh.lineTo(D / 2 + 1, 0); roofSh.closePath();
      const roof = solid(new THREE.Mesh(new THREE.ExtrudeGeometry(roofSh, { depth: W + 1.6, bevelEnabled: false }), M(0x6e3b2a, { roughness: 0.7 })));
      roof.rotation.y = Math.PI / 2; roof.position.set(-W / 2 - 0.8, 0.6 + H, 0); g.add(roof);
      const panelTex = tex2d(128, 64, (c, w, h) => { c.fillStyle = '#1b2b45'; c.fillRect(0, 0, w, h); c.strokeStyle = '#6f8fb8'; c.lineWidth = 2; for (let x = 0; x <= w; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y <= h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } });
      const slope = Math.atan2(3.6, D / 2 + 1);
      for (const x of [-W / 4, W / 4 - 1]) { const pnl = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 2.6), new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.4, roughness: 0.3 })); pnl.position.set(x, 0.6 + H + 1.9, (D / 2 + 1) / 2 + 0.1); pnl.rotation.x = slope; pnl.castShadow = true; g.add(pnl); }
      g.add(box(2.4, 3.4, 0.3, dark, W / 2 - 2.4, 0.6 + 1.7, D / 2 + 0.05));
      const win = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 0.35 }); nightFx.push(k => { win.emissiveIntensity = 0.35 + k * 1.4; }); g.add(box(2.2, 1.4, 0.2, win, W / 2 - 6, 0.6 + 3.3, D / 2 + 0.05));
      // lookout tower at the back
      const tx = -W / 2 + 1.5, tz = -D / 2 - 1.2, th = 13;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(0.35, th, 0.35, dark, tx + sx * 1.6, th / 2, tz + sz * 1.6));
      for (const y of [4.5, 8.5]) { g.add(box(3.6, 0.2, 0.2, dark, tx, y, tz + 1.6), box(3.6, 0.2, 0.2, dark, tx, y, tz - 1.6), box(0.2, 0.2, 3.6, dark, tx + 1.6, y, tz), box(0.2, 0.2, 3.6, dark, tx - 1.6, y, tz)); }
      g.add(box(4.6, 0.4, 4.6, wood, tx, th, tz));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(0.2, 2.2, 0.2, dark, tx + sx * 2.1, th + 1.3, tz + sz * 2.1));
      const tr = solid(new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.8, 4), M(0x6e3b2a))); tr.rotation.y = Math.PI / 4; tr.position.set(tx, th + 3.3, tz); g.add(tr);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: acc, side: THREE.DoubleSide })); flag.position.set(tx + 0.8, th + 5.2, tz); g.add(flag, box(0.08, 2.2, 0.08, dark, tx, th + 4.6, tz));
      tickers.push(t => { if (!reduced) flag.rotation.y = Math.sin(t * 2.2) * 0.35; });
      // big screen of in-engine shots on log posts
      const shots = b.items[0].images.slice(0, 3).map(([, u]) => coverTex(u, 16 / 9));
      const scr = screen(9, 5.06, shots, 4); const scrG = new THREE.Group(); scrG.add(bezel(9, 5.06), scr); scr.position.z = 0.25; scrG.position.set(W / 2 + 5.5, 5.8, 1); scrG.rotation.y = -0.35; g.add(scrG);
      for (const sx of [-3.6, 3.6]) { const post = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 8.4, 8), dark)); post.position.set(sx, -1.6, -0.3); scrG.add(post); }
      const head = signMesh({ title: 'PROJECT FRONTIER', sub: 'In development · Unity', bg: '#1d2a30', fg: '#ffffff', subFg: '#f2c48d', accent: b.accent }, 9, 1.3); head.position.set(0, 3.35, 0.05); scrG.add(head);
      // the axe in a stump
      const stump = solid(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 1.3, 20), dark)); stump.position.set(-W / 2 - 1, 0.6 + 0.65, D / 2 + 2.6); g.add(stump);
      const rings = tex2d(128, 128, (c, w) => { c.fillStyle = '#c99a63'; c.fillRect(0, 0, w, w); c.strokeStyle = 'rgba(110,70,35,.6)'; for (let r = 6; r < 64; r += 6) { c.lineWidth = 1.5; c.beginPath(); c.arc(64, 64, r, 0, 7); c.stroke(); } });
      const top = new THREE.Mesh(new THREE.CircleGeometry(1.5, 20), new THREE.MeshStandardMaterial({ map: rings })); top.rotation.x = -Math.PI / 2; top.position.set(stump.position.x, 0.6 + 1.31, stump.position.z); g.add(top);
      const axe = new THREE.Group(); axe.position.set(stump.position.x, 0.6 + 1.0, stump.position.z); axe.rotation.set(0, 0.5, -0.32); g.add(axe);
      const handle = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.2, 10), M(0x5a3a22))); handle.position.y = 3.6; axe.add(handle);
      for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.05, 6, 16), M(0xe8dcc0)); r.rotation.x = Math.PI / 2; r.position.y = 1.2 + i * 0.16; axe.add(r); }
      const bladeSh = new THREE.Shape(); bladeSh.moveTo(-0.35, -0.55); bladeSh.lineTo(0.35, -0.55); bladeSh.lineTo(0.5, -0.2); bladeSh.quadraticCurveTo(1.9, -0.9, 2.2, -1.25); bladeSh.quadraticCurveTo(2.45, 0, 2.2, 1.25); bladeSh.quadraticCurveTo(1.9, 0.9, 0.5, 0.2); bladeSh.lineTo(0.35, 0.55); bladeSh.lineTo(-0.35, 0.55); bladeSh.closePath();
      const blade = solid(new THREE.Mesh(new THREE.ExtrudeGeometry(bladeSh, { depth: 0.34, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }), M(0xa9b0b4, { metalness: 0.85, roughness: 0.35 })));
      blade.position.set(0, 0.2, -0.17); blade.rotation.z = Math.PI / 2; axe.add(blade);
      // campfire
      const fireX = W / 2 + 1.5, fireZ = D / 2 + 4.5;
      for (let i = 0; i < 5; i++) { const lg = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 6), dark)); const a = i / 5 * Math.PI * 2; lg.position.set(fireX + Math.cos(a) * 0.35, 0.95, fireZ + Math.sin(a) * 0.35); lg.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); g.add(lg); }
      const flameM = new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.85 }), flames = [];
      for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.32 - i * 0.07, 1.2 - i * 0.2, 8), flameM); f.position.set(fireX + (i - 1) * 0.15, 1.3, fireZ + (i % 2) * 0.1); g.add(f); flames.push(f); }
      const fireLight = new THREE.PointLight(0xff9a3c, 30, 14, 2); fireLight.position.set(fireX, 1.8, fireZ); g.add(fireLight);
      tickers.push(t => { if (reduced) return; flames.forEach((f, i) => { f.scale.y = 0.8 + Math.sin(t * 9 + i * 2) * 0.2 + Math.sin(t * 13 + i) * 0.1; }); fireLight.intensity = 26 + Math.sin(t * 11) * 5 + Math.sin(t * 17) * 3; });
      const sign = postSign({ title: b.title, sub: b.sub, accent: b.accent }, 7.4, 1.5, 2.0); sign.position.set(-2, 0, D / 2 + 3.4); g.add(sign);
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: W / 2 + 0.3, hd: D / 2 + 0.3, h: H + 5 }, { kind: 'rect', x: tx, z: tz, hw: 2.3, hd: 2.3, h: th + 5 }, { kind: 'circle', x: stump.position.x, z: stump.position.z, r: 1.8, h: 8 }, { kind: 'circle', x: W / 2 + 5.5, z: 1, r: 4.4, h: 9 }, { kind: 'circle', x: fireX, z: fireZ, r: 0.8, h: 2 }],
        labelY: th + 9, nearY: H + 5, depth: D / 2 + 4 };
    },
    marquee(b) {
      // a tall LED sign: "18 games on itch.io", with the game names scrolling underneath
      const g = new THREE.Group(), acc = hex(b.accent), steel = M(0x2b3238, { metalness: 0.6, roughness: 0.4 });
      for (const sx of [-1, 1]) g.add(box(0.5, b.h, 0.5, steel, sx * (b.w / 2 - 0.6), b.h / 2, 0));
      g.add(box(b.w + 0.6, 4.8, 0.7, M(0x161d22), 0, b.h - 2.2, 0));
      const face = tex2d(1024, 440, (c, w, h) => { c.fillStyle = '#121a1f'; c.fillRect(0, 0, w, h); c.fillStyle = b.accent; c.fillRect(0, 0, w, 14); c.textAlign = 'center'; c.fillStyle = '#ffffff'; c.font = `600 150px ${DISPLAY}`; c.fillText(String(b.games.length), w / 2 - 270, 250); c.font = `600 86px ${DISPLAY}`; c.textAlign = 'left'; c.fillText('games', w / 2 - 170, 190); c.fillStyle = b.accent; c.fillText('on itch.io', w / 2 - 170, 290); c.fillStyle = 'rgba(255,255,255,.7)'; c.font = `500 40px ${BODY}`; c.textAlign = 'center'; c.fillText('All play in your browser', w / 2, 380); });
      for (const side of [1, -1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, 4.3), basic(face)); m.position.set(0, b.h - 2.0, side * 0.37); if (side < 0) m.rotation.y = Math.PI; g.add(m); }
      const tick = tickerTex(b.games.join('   ·   ') + '   ·   ', '#ffd36b', '#0c1215'); tick.repeat.set(0.6, 1);
      for (const side of [1, -1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 0.4, 0.9), basic(tick)); m.position.set(0, b.h - 5.1, side * 0.43); if (side < 0) m.rotation.y = Math.PI; g.add(m); }
      g.add(box(b.w + 0.8, 1.1, 0.8, M(0x161d22), 0, b.h - 5.1, 0));
      tickers.push((t, dt) => { if (!reduced) tick.offset.x += dt * 0.05; });
      const bulbs = new THREE.MeshBasicMaterial({ color: 0xfff1c4 }); for (let i = 0; i < 14; i++) { const x = -b.w / 2 + 0.3 + i * (b.w - 0.6) / 13; for (const y of [b.h + 0.25, b.h - 4.65]) { const bl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), bulbs); bl.position.set(x, y, 0.4); g.add(bl); } }
      const glow = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color: acc })); glow.rotation.x = Math.PI / 2; glow.position.y = 0.08; g.add(glow);
      return { group: g, colliders: [{ kind: 'rect', x: 0, z: 0, hw: b.w / 2, hd: 0.6, h: b.h + 1 }], labelY: b.h + 3, nearY: b.h - 4, depth: 1.5 };
    },
    gallery() { return { group: new THREE.Group(), colliders: [], labelY: 0, nearY: 0, depth: 0 }; },
    plot(b) {
      const g = new THREE.Group();
      const dirt = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), M(0xd2bb8e)); dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.05; dirt.receiveShadow = true; dirt.userData.walk = true; g.add(dirt);
      const geos = [];
      const post = (x, z) => geos.push(new THREE.BoxGeometry(0.2, 1.3, 0.2).translate(x, 0.65, z));
      const rail = (x, z, len, along) => geos.push(new THREE.BoxGeometry(along === 'x' ? len : 0.1, 0.18, along === 'x' ? 0.1 : len).translate(x, 1.05, z));
      for (let x = -b.w / 2; x <= b.w / 2 + 0.01; x += 2) { post(x, -b.d / 2); post(x, b.d / 2); }
      for (let z = -b.d / 2 + 2; z < b.d / 2; z += 2) { post(-b.w / 2, z); post(b.w / 2, z); }
      rail(0, -b.d / 2, b.w, 'x'); rail(0, b.d / 2, b.w, 'x'); rail(-b.w / 2, 0, b.d, 'z'); rail(b.w / 2, 0, b.d, 'z');
      g.add(solid(new THREE.Mesh(mergeGeometries(geos), M(0xf0a24a))));
      const s = postSign({ title: b.title, sub: b.sub, accent: b.accent }, 7, 1.7, 2.6); s.position.z = b.d / 2 + 0.4; g.add(s);
      return { group: g, colliders: [], labelY: 6, nearY: 5, depth: b.d / 2 };
    },
  };

  // ---------- place buildings ----------
  const places = [];
  const keepCircle = (x, z, r) => keepout.push({ kind: 'c', x, z, r });
  for (const b of BUILDINGS) {
    const [x, z] = b.at, face = b.face || PLAZA, rot = Math.atan2(face[0] - x, face[1] - z);
    const res = BUILD[b.type](b);
    const g = res.group; g.position.set(x, 0, z); g.rotation.y = rot;
    const cos = Math.cos(rot), sin = Math.sin(rot), toWorld = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    for (const c of res.colliders) { const [cx, cz] = toWorld(c.x, c.z); colliders.push({ ...c, x: cx, z: cz, cos, sin }); }
    g.traverse(o => { if (o.isMesh && !o.userData.walk) o.userData.bid = b.id; });
    scene.add(g);
    const front = toWorld(0, res.depth + 2.5);
    const ext = b.r ? b.r + 2 : b.lot ? Math.hypot(...b.lot) / 2 : Math.hypot(b.w || 0, b.d || 0) / 2;
    if (!b.hidden) keepCircle(x, z, ext + 5);
    if (b.type === 'design') { const [ax, az] = toWorld(0, b.d / 2 + 7); keepCircle(ax, az, 10); }
    places.push({ b, x, z, rot, front: new THREE.Vector3(front[0], 0, front[1]), labelY: res.labelY, nearY: res.nearY, ext, depth: res.depth, hidden: !!b.hidden });
  }
  const byId = id => places.find(p => p.b.id === id);

  // ---------- ground, paths, plaza, fountain ----------
  const grassTex = tex2d(256, 256, (g, w) => {
    g.fillStyle = '#93c86a'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 2600; i++) { g.fillStyle = ['#86bd5e', '#a2d277', '#8cc363', '#9bcc70', '#7fb558'][i % 5]; g.fillRect(rnd() * w, rnd() * w, 2 + rnd() * 3, 2 + rnd() * 3); }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(200, 200);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, envMapIntensity: 0.3 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground'; scene.add(ground);

  const pathGeos = [], segs = [];
  const strip = (ax, az, bx, bz, w) => {
    const len = Math.hypot(bx - ax, bz - az); const g = new THREE.PlaneGeometry(w, len); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(bx - ax, bz - az));
    g.translate((ax + bx) / 2, 0.03, (az + bz) / 2); pathGeos.push(g); segs.push({ ax, az, bx, bz, hw: w / 2 + 2.5 });
  };
  // six district avenues run out from the plaza; side buildings get a short path to their avenue
  for (const av of AVENUES) { const [ax, az] = A(av.angle, 17), [bx, bz] = A(av.angle, av.length); strip(ax, az, bx, bz, av.width); }
  for (const p of places) { if (p.hidden || !p.b.face || p.b.type === 'shop') continue; strip(p.front.x, p.front.z, p.b.face[0], p.b.face[1], 4); }
  scene.add(Object.assign(new THREE.Mesh(mergeGeometries(pathGeos), M(COL.path, { roughness: 0.95 })), { receiveShadow: true }));

  const plaza = new THREE.Mesh(new THREE.CircleGeometry(18, 64), M(COL.plaza, { roughness: 0.95 })); plaza.rotation.x = -Math.PI / 2; plaza.position.set(PLAZA[0], 0.04, PLAZA[1]); plaza.receiveShadow = true; scene.add(plaza);
  const plazaRing = new THREE.Mesh(new THREE.RingGeometry(14.2, 14.8, 64), M(0xcfc2a6)); plazaRing.rotation.x = -Math.PI / 2; plazaRing.position.set(PLAZA[0], 0.05, PLAZA[1]); scene.add(plazaRing);
  keepCircle(PLAZA[0], PLAZA[1], 23);
  // ---------- fountain: a real basin with rippling, reflective water, rising jets and falling spray ----------
  const WATER_Y = 0.72, FX = PLAZA[0], FZ = PLAZA[1], stoneM = M(0xe9e2d2, { roughness: 0.75 });
  { const ring = new THREE.Shape(); ring.absarc(0, 0, 9.9, 0, Math.PI * 2); const hole = new THREE.Path(); hole.absarc(0, 0, 9.05, 0, Math.PI * 2, true); ring.holes.push(hole);
    const wall = solid(new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.95, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 72 }), stoneM));
    wall.rotation.x = -Math.PI / 2; wall.position.set(FX, 0, FZ); scene.add(wall); }
  const mosaic = tex2d(256, 256, (c, w) => { c.fillStyle = '#7fb9c4'; c.fillRect(0, 0, w, w); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const k = rnd(); c.fillStyle = k > 0.85 ? '#5d9fb0' : k > 0.6 ? '#93c9d1' : '#86c0ca'; c.fillRect(x * 16 + 1, y * 16 + 1, 14, 14); } });
  mosaic.wrapS = mosaic.wrapT = THREE.RepeatWrapping; mosaic.repeat.set(5, 5);
  const floorMat = new THREE.MeshStandardMaterial({ map: mosaic, roughness: 0.6, emissive: 0x2fb7e8, emissiveMap: mosaic, emissiveIntensity: 0 }); nightFx.push(k => { floorMat.emissiveIntensity = k * 0.9; });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9.1, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(FX, 0.12, FZ); floor.receiveShadow = true; scene.add(floor);
  // tileable ripple normals, drawn once; two layers scroll across each other so the surface never repeats visibly
  const rippleTex = (() => {
    const N = 256, h = new Float32Array(N * N), waves = [];
    for (let i = 0; i < 26; i++) waves.push([Math.round((rnd() - 0.5) * 14), Math.round((rnd() - 0.5) * 14), rnd() * 6.28, 0.4 + rnd()]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (const [fx, fy, ph, am] of waves) v += Math.sin((fx * x + fy * y) / N * Math.PI * 2 + ph) * am / (1 + Math.hypot(fx, fy) * 0.25); h[y * N + x] = v; }
    const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N], dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      const nx = -dx * 0.9, ny = -dy * 0.9, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const rippleB = rippleTex.clone(); rippleB.needsUpdate = true;
  rippleTex.repeat.set(3, 3); rippleB.repeat.set(5.5, 5.5);
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x3f9fb8, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.78,
    normalMap: rippleTex, normalScale: new THREE.Vector2(0.45, 0.45), clearcoat: 1, clearcoatRoughness: 0.03, clearcoatNormalMap: rippleB, clearcoatNormalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 1.6, specularIntensity: 1, ior: 1.33, depthWrite: false });
  const waterGeo = new THREE.RingGeometry(0.05, 9.06, 128, 30), water = new THREE.Mesh(waterGeo, waterMat); water.rotation.x = -Math.PI / 2; water.position.set(FX, WATER_Y, FZ); water.renderOrder = 1; scene.add(water);
  tickers.push((t, dt) => { if (reduced) return; rippleTex.offset.x += dt * 0.045; rippleTex.offset.y += dt * 0.03; rippleB.offset.x -= dt * 0.06; rippleB.offset.y += dt * 0.05; });
  // tiered centre: pedestal, a shallow upper bowl that spills a thin curtain of water
  const column = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.25, 2.2, 28), stoneM)); column.position.set(FX, 1.1, FZ); scene.add(column);
  const bowl = solid(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 1.0, 0.55, 40), stoneM)); bowl.position.set(FX, 2.45, FZ); scene.add(bowl);
  const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(2.1, 40), waterMat); bowlWater.rotation.x = -Math.PI / 2; bowlWater.position.set(FX, 2.71, FZ); scene.add(bowlWater);
  const curtainTex = tex2d(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.15, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,.35)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.6})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 8 + rnd() * 40); } });
  curtainTex.wrapS = curtainTex.wrapT = THREE.RepeatWrapping; curtainTex.repeat.set(10, 1);
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0xeaf7fb, map: curtainTex, transparent: true, opacity: 0.75, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const curtain = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 2.55, 2.0, 48, 1, true), curtainMat); curtain.position.set(FX, 2.72 - 1.0, FZ); scene.add(curtain);
  tickers.push((t, dt) => { if (!reduced) curtainTex.offset.y += dt * 1.6; });
  // jets: a rising column of water for each nozzle, with spray that arcs out and falls back to the surface
  const streamTex = tex2d(32, 256, (c, w, h) => { c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.7})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 6 + rnd() * 30); } });
  streamTex.wrapS = streamTex.wrapT = THREE.RepeatWrapping;
  const streamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: streamTex, transparent: true, opacity: 0.92, roughness: 0.1, emissive: 0xbfe8f5, emissiveIntensity: 0.45, envMapIntensity: 1.4, depthWrite: false });
  const nozzles = []; let clockT = 0, splashAcc = 0;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; nozzles.push({ x: FX + Math.cos(a) * 5.4, z: FZ + Math.sin(a) * 5.4, y: WATER_Y, r: 0.17, base: 2.2, amp: 0.9, ph: i, spread: 0.8 }); }
  nozzles.push({ x: FX, z: FZ, y: 2.72, r: 0.24, base: 4.6, amp: 0.8, ph: 0, spread: 2.2, center: true });
  for (const n of nozzles) {
    n.mesh = new THREE.Mesh(new THREE.CylinderGeometry(n.r * 0.55, n.r, 1, 10, 1, true).translate(0, 0.5, 0), streamMat); n.mesh.position.set(n.x, n.y, n.z); scene.add(n.mesh);
    n.crown = new THREE.Mesh(new THREE.SphereGeometry(n.r * 2.2, 10, 6), streamMat); n.crown.scale.y = 0.6; scene.add(n.crown);
    n.height = () => reduced ? n.base : n.base + Math.sin(clockT * (n.center ? 2 : 2.4) + n.ph) * n.amp;
  }
  tickers.push((t, dt) => { if (!reduced) streamTex.offset.y -= dt * 2.2; for (const n of nozzles) { const hgt = n.height(); n.mesh.scale.y = hgt; n.crown.position.set(n.x, n.y + hgt, n.z); } });
  const dropTex = tex2d(32, 32, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(235,248,255,.7)'); gr.addColorStop(1, 'rgba(235,248,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const DROPS = coarse ? 900 : 1800, dPos = new Float32Array(DROPS * 3), dVel = new Float32Array(DROPS * 3), dOwner = new Uint8Array(DROPS);
  const respawn = i => { const n = nozzles[dOwner[i]], hgt = n.height(), a = rnd() * Math.PI * 2, sp = n.spread * (0.35 + rnd() * 0.65);
    dPos[i * 3] = n.x + (rnd() - 0.5) * n.r; dPos[i * 3 + 1] = n.y + hgt * (0.82 + rnd() * 0.18); dPos[i * 3 + 2] = n.z + (rnd() - 0.5) * n.r;
    dVel[i * 3] = Math.cos(a) * sp; dVel[i * 3 + 1] = rnd() * 1.6; dVel[i * 3 + 2] = Math.sin(a) * sp; };
  for (let i = 0; i < DROPS; i++) { dOwner[i] = i < DROPS * 0.45 ? 8 : i % 8; respawn(i); dPos[i * 3 + 1] -= rnd() * 3; }
  const dropGeo = new THREE.BufferGeometry(); dropGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ map: dropTex, size: 0.24, transparent: true, opacity: 0.9, depthWrite: false, color: 0xffffff }));
  drops.frustumCulled = false; scene.add(drops);
  { // move the pool surface itself (local plane: x right, y = -world z, z = up)
    const wPos = waterGeo.attributes.position, base = Float32Array.from(wPos.array), n = wPos.count;
    const srcs = nozzles.filter(nz => !nz.center).map(nz => [nz.x - FX, -(nz.z - FZ)]);
    let flip = 0;
    tickers.push(t => {
      if (reduced || (flip++ & 1)) return; // every other frame is plenty
      for (let i = 0; i < n; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], r = Math.hypot(x, y);
        let h = 0.012 * Math.sin(0.8 * x + 1.1 * t) + 0.01 * Math.sin(0.9 * y - 1.4 * t + 1.3);
        const dc = Math.abs(r - 2.55); h += 0.04 * Math.sin(6 * dc - 5 * t) * Math.exp(-0.3 * dc);
        for (const [sx, sy] of srcs) { const d = Math.hypot(x - sx, y - sy); if (d < 4.5) h += 0.034 * Math.sin(7 * d - 6.5 * t) * Math.exp(-0.5 * d); }
        wPos.setZ(i, h * (1 - THREE.MathUtils.smoothstep(r, 8.2, 9.05)));
      }
      wPos.needsUpdate = true; waterGeo.computeVertexNormals();
    });
  }
  // rings spread where the spray lands
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const ripples = []; for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 40), ringMat.clone()); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); ripples.push({ m, life: 0 }); }
  let rippleI = 0; const splash = (x, z) => { const r = ripples[rippleI++ % ripples.length]; r.m.position.set(x, WATER_Y + 0.02, z); r.life = 1; r.m.visible = true; };
  tickers.push((t, dt) => {
    clockT = t; if (reduced) return;
    for (let i = 0; i < DROPS; i++) {
      dVel[i * 3 + 1] -= 9.8 * dt; dPos[i * 3] += dVel[i * 3] * dt; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt; dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
      const x = dPos[i * 3] - FX, z = dPos[i * 3 + 2] - FZ, landY = dOwner[i] === 8 && x * x + z * z < 2.2 * 2.2 ? 2.72 : WATER_Y;
      if (dPos[i * 3 + 1] < landY) { splashAcc += 0.04; if (splashAcc > 1) { splashAcc = 0; splash(dPos[i * 3], dPos[i * 3 + 2]); } respawn(i); }
    }
    dropGeo.attributes.position.needsUpdate = true;
    if (rnd() < dt * 7) { const nz = nozzles[Math.floor(rnd() * 8)]; splash(nz.x + (rnd() - 0.5) * 0.8, nz.z + (rnd() - 0.5) * 0.8); }
    for (const r of ripples) if (r.life > 0) { r.life -= dt * 0.9; const k = 1 - r.life; r.m.scale.setScalar(0.25 + k * 2.1); r.m.material.opacity = Math.max(0, r.life) * 0.6; if (r.life <= 0) r.m.visible = false; }
  });
  colliders.push({ kind: 'circle', x: PLAZA[0], z: PLAZA[1], r: 10.1, h: 2.5 });

  // benches sit on the grass: around the plaza between the avenues, and beside each avenue facing it
  const pathClear = (x, z, margin) => { for (const sg of segs) { const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l2 = dx * dx + dz * dz; let t = ((x - sg.ax) * dx + (z - sg.az) * dz) / l2; t = Math.max(0, Math.min(1, t)); if (Math.hypot(x - (sg.ax + t * dx), z - (sg.az + t * dz)) < sg.hw - 2.5 + margin) return false; } return true; };
  const benchSpots = [];
  { let lastA = -99; for (let deg = 0; deg < 360; deg += 2) { const [x, z] = A(deg, 22.5); if (deg - lastA >= 16 && pathClear(x, z, 1.9)) { benchSpots.push({ x, z, back: Math.atan2(x - PLAZA[0], z - PLAZA[1]) }); lastA = deg; } } }
  const exhibitSpots = EXHIBITS.map(ex => A(ex.avenue, ex.d, ex.side * 6));
  for (const av of AVENUES) for (let d = 34; d < av.length - 8; d += 21) for (const side of [-1, 1]) {
    const off = side * (av.width / 2 + 2.1), [x, z] = A(av.angle, d, off), [fx, fz] = A(av.angle, d, 0);
    if (!pathClear(x, z, 1.3) || exhibitSpots.some(([ex, ez]) => Math.hypot(ex - x, ez - z) < 5) || places.some(p => !p.hidden && Math.hypot(p.x - x, p.z - z) < p.ext + 3)) continue;
    benchSpots.push({ x, z, back: Math.atan2(x - fx, z - fz) });
  }
  { const geos = [];
    for (const { x, z, back } of benchSpots) {
      const parts = [new THREE.BoxGeometry(2.6, 0.14, 0.7).translate(0, 0.55, 0), new THREE.BoxGeometry(2.6, 0.6, 0.12).translate(0, 0.95, 0.34), new THREE.BoxGeometry(0.12, 0.55, 0.6).translate(-1.1, 0.27, 0), new THREE.BoxGeometry(0.12, 0.55, 0.6).translate(1.1, 0.27, 0)];
      for (const p of parts) { p.rotateY(back); p.translate(x, 0, z); geos.push(p); }
      colliders.push({ kind: 'circle', x, z, r: 1.3, h: 1.2 }); keepCircle(x, z, 2.6);
    }
    scene.add(solid(new THREE.Mesh(mergeGeometries(geos), M(0x9a6b45)))); }

  // ---------- welcome gate ----------
  { const gate = new THREE.Group(); gate.position.set(0, 0, GATE_Z);
    for (const sx of [-1, 1]) { gate.add(box(2.6, 9, 2.6, M(0xebe6dc), sx * 12, 4.5, 0)); colliders.push({ kind: 'rect', x: sx * 12, z: GATE_Z, hw: 1.4, hd: 1.4, h: 11, cos: 1, sin: 0 }); }
    gate.add(box(27, 3, 1.9, M(0x2f5f4f), 0, 9.6, 0));
    const opts = { title: 'Happy Singh', sub: '3D artist and animator', bg: '#2f5f4f', fg: '#ffffff', subFg: '#cfe6dc', accent: '#e07a2d', align: 'center' };
    const f = signMesh(opts, 23, 2.6); f.position.set(0, 9.6, 0.97); const bk = signMesh(opts, 23, 2.6); bk.position.set(0, 9.6, -0.97); bk.rotation.y = Math.PI;
    gate.add(f, bk); scene.add(gate); keepCircle(0, GATE_Z, 15); }

  // ---------- exhibits along the avenues: creatures on plinths, animation posters, video screens, design easels, game standees ----------
  { const plinthM = M(0xf4f1ea, { roughness: 0.4 }), standM = M(0x26323b, { metalness: 0.4, roughness: 0.45 }), woodM = M(0x8a6a48);
    const caption = (g, title, sub, accent, y, w = 2.6) => { const c = signMesh({ title, sub, accent }, w, w * 0.22); c.position.set(0, y, 0.02); g.add(c); return c; };
    for (const ex of EXHIBITS) {
      const av = AVENUES.find(v => v.angle === ex.avenue), off = ex.side * (av.width / 2 + 3.4);
      const [x, z] = A(ex.avenue, ex.d, off), [fx, fz] = A(ex.avenue, ex.d, 0);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(fx - x, fz - z); scene.add(g);
      const bld = BUILDINGS.find(bb => bb.id === ex.building), item = bld?.items.find(i => i.id === ex.item), accent = ex.color || bld?.accent || '#3d8fb8';
      if (ex.kind === 'model') {
        g.add(solid(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 1.0, 32), plinthM)).translateY(0.5));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.05, 6, 40), new THREE.MeshBasicMaterial({ color: hex(accent) })); ring.rotation.x = Math.PI / 2; ring.position.y = 1.01; g.add(ring);
        const turn = new THREE.Group(); turn.position.y = 1.0; g.add(turn);
        const ph = rnd() * 6; tickers.push((t, dt) => { if (!reduced) turn.rotation.y += dt * 0.45; });
        later.push(gltfLoader.loadAsync(item.model).then(gltf => { const m = gltf.scene, bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3()), k = Math.min((ex.h || 2) / sz.y, 2.4 / Math.max(sz.x, sz.z)); m.scale.setScalar(k); bb.setFromObject(m); const c = bb.getCenter(new THREE.Vector3()); m.position.set(-c.x, -bb.min.y, -c.z); m.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.frustumCulled = false; o.userData.bid = ex.building;
            if (item.base) { // the Hive Adapt chitin look: dark tinted shell, glow where the vertex alpha marks it
              const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(item.base[0] * 1.7, item.base[1] * 1.7, item.base[2] * 1.7, THREE.LinearSRGBColorSpace), vertexColors: !!o.geometry.attributes.color, roughness: 0.36, metalness: 0.12 });
              const em = new THREE.Color().setRGB(item.emis[0] * 0.35, item.emis[1] * 0.35, item.emis[2] * 0.35, THREE.LinearSRGBColorSpace);
              mat.onBeforeCompile = sh => { sh.uniforms.uEmis = { value: em }; sh.fragmentShader = 'uniform vec3 uEmis;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR_ALPHA\n  totalEmissiveRadiance += uEmis * vColor.a;\n#endif'); };
              o.material = mat;
            } }); turn.add(m); }).catch(e => console.warn('exhibit', item.model, e)));
        caption(g, item.title, 'Hive Adapt creature', accent, 0.55, 2.0).position.z = 1.32;
      } else if (ex.kind === 'poster') {
        const url = item.images ? item.images[ex.image || 0][1] : item.cover, W2 = 3.0, H2 = 1.9;
        for (const sx of [-1, 1]) g.add(box(0.12, 3.4, 0.12, standM, sx * (W2 / 2 - 0.15), 1.7, -0.08));
        g.add(box(W2 + 0.24, H2 + 0.24, 0.1, standM, 0, 2.25, -0.03));
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(W2, H2), basic(coverTex(url, W2 / H2))); pic.position.set(0, 2.25, 0.03); g.add(pic);
        caption(g, item.title, bld.title, accent, 0.82);
      } else if (ex.kind === 'screen') {
        g.add(box(0.18, 4.2, 0.18, standM, 0, 2.1, -0.25));
        const W2 = 3.4, H2 = 1.91; g.add(box(W2 + 0.3, H2 + 0.3, 0.2, M(0x161d22), 0, 3.3, -0.1));
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(W2, H2), basic(coverTex(item.cover, W2 / H2))); pic.position.set(0, 3.3, 0.02); g.add(pic);
        const play = new THREE.Mesh(new THREE.CircleGeometry(0.32, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })); play.position.set(0, 3.3, 0.04); g.add(play);
        caption(g, item.title, 'Video', accent, 1.6, 2.4);
      } else if (ex.kind === 'easel') {
        const legs = [[-0.75, 0.2], [0.75, 0.2], [0, -0.7]]; for (const [lx, lz] of legs) { const l = box(0.09, 3.5, 0.09, woodM, lx * 0.85, 1.65, lz * 0.6); l.rotation.set(-lz * 0.18, 0, -lx * 0.08); g.add(l); }
        g.add(box(2.1, 0.12, 0.3, woodM, 0, 0.95, 0.12));
        const W2 = 2.0, H2 = 2.5, art = new THREE.Mesh(new THREE.PlaneGeometry(W2, H2), basic(artboardTex(item.cover, item.title, 800, 1000))); art.position.set(0, 2.3, 0.22); art.rotation.x = -0.1; g.add(art);
        g.add(box(W2 + 0.08, H2 + 0.08, 0.05, M(0xffffff), 0, 2.3, 0.18).rotateX(-0.1));
      } else if (ex.kind === 'standee') {
        const tex = tex2d(400, 680, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, ex.color); gr.addColorStop(1, '#14161f'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(rnd() * w, rnd() * h * 0.6, 4 + rnd() * 30, 0, 7); c.fill(); } c.fillStyle = '#ffffff'; c.textAlign = 'center'; const words = ex.title.split(' '); let y = 300 - (words.length - 1) * 34; c.font = `600 62px ${DISPLAY}`; for (const wd of words) { fit(c, wd, w - 40, 62, 600, DISPLAY); c.fillText(wd, w / 2, y); y += 68; } c.font = `500 26px ${BODY}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(ex.sub, w / 2, y + 18); c.fillStyle = '#fa5c5c'; c.beginPath(); c.roundRect(w / 2 - 110, h - 110, 220, 56, 28); c.fill(); c.fillStyle = '#ffffff'; c.font = `600 28px ${BODY}`; c.fillText('Play on itch.io', w / 2, h - 72); });
        g.add(box(1.9, 0.25, 0.9, standM, 0, 0.12, 0));
        const card = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.9), basic(tex)); card.position.set(0, 1.75, 0.06); g.add(card, box(1.8, 3.0, 0.1, standM, 0, 1.75, 0));
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.1), new THREE.MeshBasicMaterial({ color: hex(ex.color), transparent: true, opacity: 0.5 })); edge.position.set(0, 1.75, -0.06); edge.rotation.y = Math.PI; g.add(edge);
      }
      g.traverse(o => { if (o.isMesh) { if (ex.href) o.userData.href = ex.href; else o.userData.bid = ex.building; } });
      g.userData.itemId = ex.item || null;
      keepCircle(x, z, 3.4); colliders.push({ kind: 'circle', x, z, r: 1.0, h: 3.4 });
    } }

  // ---------- trees (organic multi-blob crowns), flowers, lamps, clouds, skyline ----------
  const segDist = (x, z, s) => { const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz; let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz)); };
  const blocked = (x, z) => {
    for (const k of keepout) {
      if (k.kind === 'c' && Math.hypot(x - k.x, z - k.z) < k.r) return true;
      if (k.kind === 'r') { const dx = x - PLAZA[0], dz = z - PLAZA[1], r = Math.hypot(dx, dz); if (r > k.r0 && r < k.r1) { let a = Math.atan2(dx, -dz) * 180 / Math.PI; if (a < 0) a += 360; if (a >= k.a0 - 3 && a <= k.a1 + 3) return true; } }
    }
    for (const s of segs) if (segDist(x, z, s) < s.hw) return true;
    return false;
  };
  const treeGeos = (() => {
    const v = new THREE.Vector3(), nz = (x, y, z, s) => Math.sin(x * 1.9 + s) * Math.cos(z * 1.7 - s * 0.7) * 0.5 + Math.sin(y * 2.3 + x * 0.8 + s * 1.3) * 0.5;
    const colorize = (g, base, lo = 0.72, span = 0.42) => { const p = g.attributes.position; let y0 = 1e9, y1 = -1e9; for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); } const col = new Float32Array(p.count * 3), c = new THREE.Color(base); for (let i = 0; i < p.count; i++) { const k = lo + span * (p.getY(i) - y0) / Math.max(0.001, y1 - y0) + (Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * 0.04); col.set([c.r * k, c.g * k, c.b * k], i * 3); } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
    const clean = g => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return mergeVertices(g); };
    const blob = (r, cx, cy, cz, detail, base, sy = 1, s = 0) => { const g = clean(new THREE.IcosahedronGeometry(r, detail)); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + nz(v.x / r * 1.5, v.y / r * 1.5, v.z / r * 1.5, s) * 0.24; p.setXYZ(i, cx + v.x * k, cy + v.y * k * sy, cz + v.z * k); } g.computeVertexNormals(); return colorize(g, base); };
    const trunk = (rt, rb, h, x = 0, z = 0, tilt = 0, dir = 0) => { const g = clean(new THREE.CylinderGeometry(rt, rb, h, 7)); g.translate(0, h / 2, 0); if (tilt) { g.rotateZ(tilt); g.rotateY(dir); } g.translate(x, 0, z); g.computeVertexNormals(); return colorize(g, '#6e4a2e', 0.8, 0.3); };
    const cone = (r, h, y, base, s) => { const g = clean(new THREE.ConeGeometry(r, h, 10, 3)); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + nz(v.x * 1.3, v.y * 1.3, v.z * 1.3, s) * 0.16; p.setXYZ(i, v.x * k, v.y + y, v.z * k); } g.computeVertexNormals(); return colorize(g, base, 0.7, 0.45); };
    const fine = 1, far = 0;
    const oak = d => mergeGeometries([trunk(0.32, 0.55, 4.6), trunk(0.12, 0.2, 2.2, 0.2, 0, -0.7, 0.3), trunk(0.12, 0.2, 2.0, -0.2, 0.1, 0.7, -0.4),
      blob(3.1, 0, 6.2, 0, d, '#5c9c43', 0.9, 1), blob(2.4, 1.9, 5.3, 0.6, d, '#669f3f', 0.9, 2), blob(2.4, -1.7, 5.5, -0.8, d, '#5a9640', 0.9, 3), blob(2.1, 0.4, 7.8, -0.3, d, '#76b04d', 0.9, 4), blob(2.0, -0.4, 5.1, 1.8, d, '#5f9e45', 0.9, 5)]);
    const round = d => mergeGeometries([trunk(0.28, 0.42, 3.8), blob(2.9, 0, 5.4, 0, d, '#71ad4c', 0.95, 6), blob(2.1, 1.0, 6.7, 0.4, d, '#7eb857', 0.95, 7), blob(2.2, -1.1, 4.8, -0.6, d, '#68a447', 0.95, 8)]);
    const poplar = d => mergeGeometries([trunk(0.22, 0.36, 3.2), blob(1.8, 0, 4.6, 0, d, '#4f8f3e', 1.35, 9), blob(1.7, 0.1, 7.0, 0.1, d, '#5a9a44', 1.3, 10), blob(1.25, 0, 9.2, 0, d, '#68a64c', 1.2, 11)]);
    const pine = () => mergeGeometries([trunk(0.24, 0.4, 2.6), cone(3.1, 3.8, 3.6, '#3f7a3a', 12), cone(2.5, 3.4, 5.7, '#45823d', 13), cone(1.9, 3.0, 7.6, '#4c8a42', 14), cone(1.2, 2.4, 9.3, '#559347', 15)]);
    return { fine: [oak(fine), round(fine), poplar(fine), pine()], far: [round(far), poplar(far), pine()] };
  })();
  const trees = [];
  // trees stay clear of every building and of the view from the plaza to it, so buildings read from the ground and from above
  const views = places.filter(p => !p.hidden && !['shop', 'plot', 'kiosk'].includes(p.b.type));
  const inView = (x, z) => {
    for (const p of places) if (!p.hidden && Math.hypot(x - p.x, z - p.z) < p.ext + (p.b.type === 'shop' ? 6 : 10)) return true;
    for (const p of views) { const f = p.b.face, s = f ? { ax: f[0], az: f[1], bx: p.x, bz: p.z } : { ax: PLAZA[0] + (p.x - PLAZA[0]) * 0.55, az: PLAZA[1] + (p.z - PLAZA[1]) * 0.55, bx: p.x, bz: p.z }; if (segDist(x, z, s) < p.ext * 0.75 + 4) return true; }
    return false;
  };
  const tryTree = (x, z, minGap, set) => { if (blocked(x, z) || (set !== 'far' && inView(x, z))) return; for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < minGap) return; trees.push({ x, z, s: 0.8 + rnd() * 0.45, set, k: Math.floor(rnd() * (set === 'fine' ? 4 : 3)), r: rnd() * 6.3 }); };
  for (let i = 0; i < 4000 && trees.length < 175; i++) { const a = rnd() * Math.PI * 2, r = 28 + Math.sqrt(rnd()) * 140; tryTree(Math.sin(a) * r, PLAZA[1] + Math.cos(a) * r, 11, 'fine'); }
  for (let i = 0; i < 5000 && trees.length < 500; i++) { const a = rnd() * Math.PI * 2, r = 184 + rnd() * 70; tryTree(Math.sin(a) * r, PLAZA[1] + Math.cos(a) * r, 8, r < 205 ? 'fine' : 'far'); }
  { const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), cc = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.5 });
    for (const set of ['fine', 'far']) treeGeos[set].forEach((geo, k) => {
      const list = trees.filter(t => t.set === set && t.k === k); if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, treeMat, list.length);
      list.forEach((t, i) => { im.setMatrixAt(i, mm.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(up, t.r), new THREE.Vector3(t.s, t.s * (0.9 + rnd() * 0.25), t.s))); im.setColorAt(i, cc.setHSL(0, 0, 0.9 + rnd() * 0.2)); });
      im.castShadow = set === 'fine'; scene.add(im);
    }); }

  { const spots = []; for (let i = 0; i < 1400 && spots.length < 620; i++) { const a = rnd() * Math.PI * 2, r = 25 + rnd() * 145, x = Math.sin(a) * r, z = PLAZA[1] + Math.cos(a) * r; if (!blocked(x, z)) for (let k = 0; k < 8; k++) spots.push([x + (rnd() - 0.5) * 3.5, z + (rnd() - 0.5) * 3.5]); }
    const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 0), M(0xffffff), spots.length), mm = new THREE.Matrix4(), cc = new THREE.Color();
    spots.forEach(([x, z], i) => { fl.setMatrixAt(i, mm.makeTranslation(x, 0.22, z)); fl.setColorAt(i, cc.set(['#f4a3c0', '#fbe07a', '#ffffff', '#c7a6f2', '#f6b26b'][i % 5])); });
    scene.add(fl); }

  { const lamps = []; for (const s of segs) { const len = Math.hypot(s.bx - s.ax, s.bz - s.az), ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len; for (let d = 9, side = 1; d < len - 4; d += 15, side *= -1) lamps.push([s.ax + ux * d - uz * side * (s.hw - 1.5), s.az + uz * d + ux * side * (s.hw - 1.5)]); }
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 4.2, 8).translate(0, 2.1, 0), M(0x2f3a40), lamps.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 12, 8).translate(0, 4.4, 0), new THREE.MeshBasicMaterial({ color: 0xfff3d6 }), lamps.length);
    const mm = new THREE.Matrix4(); lamps.forEach(([x, z], i) => { mm.makeTranslation(x, 0, z); poles.setMatrixAt(i, mm); heads.setMatrixAt(i, mm); });
    poles.castShadow = true; scene.add(poles, heads);
    const halo = tex2d(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,236,190,1)'); gr.addColorStop(0.25, 'rgba(255,214,150,.55)'); gr.addColorStop(1, 'rgba(255,200,130,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
    const hp = new Float32Array(lamps.length * 3); lamps.forEach(([x, z], i) => hp.set([x, 4.4, z], i * 3));
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    const halos = new THREE.Points(hg, new THREE.PointsMaterial({ map: halo, size: 4.2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: halo, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), lamps.length);
    lamps.forEach(([x, z], i) => { mm.makeTranslation(x, 0.07, z); pools.setMatrixAt(i, mm); });
    pools.renderOrder = 2; halos.renderOrder = 3; scene.add(halos, pools);
    const headMat = heads.material, dayHead = new THREE.Color(0xf1ede4), nightHead = new THREE.Color(0xfff1c9);
    nightFx.push(k => { halos.material.opacity = k; pools.material.opacity = k * 0.5; halos.visible = pools.visible = k > 0.02; headMat.color.copy(dayHead).lerp(nightHead, k); }); }

  { const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.94 }); nightFx.push(k => { cloudMat.opacity = 0.94 - k * 0.6; });
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group(); for (let k = 0; k < 5; k++) { const s = 5 + rnd() * 7; const m = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), cloudMat); m.position.set((k - 2) * 6 + rnd() * 3, rnd() * 2, rnd() * 6); m.scale.y = 0.6; c.add(m); }
      c.position.set(-420 + rnd() * 840, 120 + rnd() * 50, -420 + rnd() * 840); const v = 1.5 + rnd() * 1.5; scene.add(c);
      tickers.push((t, dt) => { if (reduced) return; c.position.x += v * dt; if (c.position.x > 440) c.position.x = -440; });
    } }

  { const geos = []; for (let i = 0; i < 110; i++) { const a = i / 110 * Math.PI * 2 + rnd() * 0.04, r = 390 + rnd() * 120, w = 14 + rnd() * 20, d = 14 + rnd() * 20, h = 25 + rnd() * rnd() * 120; geos.push(new THREE.BoxGeometry(w, h, d).translate(Math.sin(a) * r, h / 2, PLAZA[1] + Math.cos(a) * r)); }
    scene.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: 0xc3d3de }))); }

  // ---------- day and night: a six-minute cycle, about two thirds of it daylight; lamps, windows, screens and the pool light up after dark ----------
  const DAY_LEN = 360; let dayPhase = 0.16, nightK = 0;
  const skyDay = [new THREE.Color(0x5fb1e6), new THREE.Color(COL.horizon)], skyDusk = [new THREE.Color(0x34508c), new THREE.Color(0xf2a46c)], skyNight = [new THREE.Color(0x040a1b), new THREE.Color(0x152039)];
  const hemiDay = [new THREE.Color(0xeaf6ff), new THREE.Color(0x5a7d3c)], hemiNight = [new THREE.Color(0x6f86c9), new THREE.Color(0x1d2b3a)];
  const sunDay = new THREE.Color(0xfff1dc), sunDusk = new THREE.Color(0xff9e63), moonCol = new THREE.Color(0xa9c2ff), tTop = new THREE.Color(), tBot = new THREE.Color();
  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 900; i++) { const a = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.92, r = Math.sqrt(1 - y * y); sp.push(Math.cos(a) * r * 1100, y * 1100, Math.sin(a) * r * 1100); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf5f2e6, transparent: true, opacity: 0, fog: false }));
  moon.position.set(-80, 150, -60).normalize().multiplyScalar(1000); sky.add(stars, moon);
  function applyTime(p) {
    const th = p < 0.65 ? p / 0.65 * Math.PI : Math.PI + (p - 0.65) / 0.35 * Math.PI, e = Math.sin(th);
    const dayK = THREE.MathUtils.smoothstep(e, -0.1, 0.22), duskK = Math.max(0, 1 - Math.abs(e - 0.03) / 0.22);
    nightK = 1 - dayK;
    tTop.copy(skyNight[0]).lerp(skyDay[0], dayK).lerp(skyDusk[0], duskK * 0.6); tBot.copy(skyNight[1]).lerp(skyDay[1], dayK).lerp(skyDusk[1], duskK * 0.75);
    sky.material.uniforms.top.value.copy(tTop); sky.material.uniforms.bottom.value.copy(tBot); scene.background.copy(tBot); scene.fog.color.copy(tBot);
    if (e > -0.04) { sun.position.set(Math.cos(th) * 150, Math.max(0.1, e) * 170 + 12, 70); sun.color.copy(sunDay).lerp(sunDusk, duskK); sun.intensity = 2.5 * THREE.MathUtils.smoothstep(e, -0.04, 0.25); }
    else { sun.position.set(-80, 150, -60); sun.color.copy(moonCol); sun.intensity = 0.7 * THREE.MathUtils.smoothstep(-e, 0.04, 0.3); }
    hemi.intensity = 0.42 + 0.58 * dayK; hemi.color.copy(hemiNight[0]).lerp(hemiDay[0], dayK); hemi.groundColor.copy(hemiNight[1]).lerp(hemiDay[1], dayK);
    scene.environmentIntensity = 0.1 + 0.35 * dayK;
    stars.material.opacity = nightK; moon.material.opacity = nightK; stars.visible = moon.visible = nightK > 0.02;
    for (const f of nightFx) f(nightK);
  }
  applyTime(dayPhase);
  const timeBtn = $('#time-btn');
  const timeLabel = () => { if (!timeBtn) return; const sm = innerWidth < 640, night = nightK > 0.5; timeBtn.textContent = sm ? (night ? '☀' : '☾') : (night ? '☀ Day' : '☾ Night'); timeBtn.setAttribute('aria-label', night ? 'Switch to day' : 'Switch to night'); };
  let lastNight = null;
  timeBtn?.addEventListener('click', () => { dayPhase = nightK > 0.5 ? 0.06 : 0.72; applyTime(dayPhase); timeLabel(); timeBtn.blur(); });
  timeLabel(); addEventListener('resize', timeLabel);
  tickers.push((t, dt) => { dayPhase = (dayPhase + dt / DAY_LEN) % 1; applyTime(dayPhase); const n = nightK > 0.5; if (n !== lastNight) { lastNight = n; timeLabel(); } });

  // ---------- wandering foxes ----------
  [[45, 35], [115, 40], [160, 45], [205, 35], [290, 30], [340, 40], [20, 30]].map(([a, r]) => A(a, r)).forEach(([hx, hz], i) => {
    const src = i % 2 ? fluffy : fox, { holder, model } = placeModel(src, 1.1 + rnd() * 0.3);
    holder.position.set(hx, 0, hz); scene.add(holder);
    const mx = new THREE.AnimationMixer(model); mixers.push(mx);
    const act = n => mx.clipAction(src.animations.find(c => c.name === n) || src.animations[0]);
    const st = { pose: act('idle'), target: null, wait: 1 + rnd() * 3 }; st.pose.play();
    const pose = n => { const a = act(n); if (a === st.pose) return; a.reset().fadeIn(0.3).play(); st.pose.fadeOut(0.3); st.pose = a; };
    holder.traverse(o => { if (o.isMesh) o.userData.bid = 'characters'; });
    tickers.push((t, dt) => {
      if (reduced) return;
      if (!st.target) { st.wait -= dt; if (st.wait <= 0) { const a = rnd() * Math.PI * 2, r = 2 + rnd() * 10; const x = hx + Math.sin(a) * r, z = hz + Math.cos(a) * r; if (!blocked(x, z) || Math.hypot(x - hx, z - hz) < 3) { st.target = new THREE.Vector3(x, 0, z); st.run = rnd() < 0.25; pose(st.run ? 'run' : 'walk'); } else st.wait = 0.5; } return; }
      const d = st.target.clone().sub(holder.position); const dist = d.length();
      if (dist < 0.3) { st.target = null; st.wait = 2 + rnd() * 5; pose(['idle', 'sit', 'sniff', 'look_around'][Math.floor(rnd() * 4)]); return; }
      d.normalize(); holder.position.addScaledVector(d, (st.run ? 4.5 : 1.8) * dt);
      const want = Math.atan2(d.x, d.z); let dr = want - holder.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); holder.rotation.y += dr * Math.min(1, dt * 6);
    });
  });

  // ---------- the player: Ink Fox ----------
  const { holder: avatar, model: player } = placeModel(fox, 1.35);
  avatar.position.set(0, 0, GATE_Z - 4); avatar.rotation.y = Math.PI; scene.add(avatar);
  const footY = player.position.y;
  const mixer = new THREE.AnimationMixer(player); mixers.push(mixer);
  const acts = {}; for (const n of ['idle', 'walk', 'run', 'fly', 'fly_fast', 'ascend', 'descend']) acts[n] = mixer.clipAction(fox.animations.find(c => c.name === n) || fox.animations[0]);
  let pose = 'idle'; acts.idle.play();
  const setPose = p => { if (p === pose) return; acts[p].reset().fadeIn(0.22).play(); acts[pose].fadeOut(0.22); pose = p; };

  // ---------- modes, camera, input ----------
  let mode = 'overview', flying = false, landing = false, transT = 0, idleT = 0, shift = 0, flyHold = 0;
  const ov = { target: new THREE.Vector3(PLAZA[0], 0, PLAZA[1] - 4), yaw: 0, pitch: 0.66, dist: 0, base: 0 };
  const fol = { yaw: 0, pitch: 0.34, dist: innerWidth < 700 ? 12 : 10 }; let arrived = false;
  const portrait = () => camera.aspect < 0.8;
  const overviewDist = () => {
    const v = THREE.MathUtils.degToRad(camera.fov / 2), hh = Math.atan(Math.tan(v) * camera.aspect);
    return portrait() ? THREE.MathUtils.clamp(100 / Math.tan(hh), 200, 480) : THREE.MathUtils.clamp(Math.max(138 / Math.tan(hh), 140 / Math.tan(v) * 0.8), 190, 520);
  };
  ov.base = ov.dist = overviewDist(); if (portrait()) { ov.pitch = 1.02; ov.target.z = PLAZA[1] + 20; }
  camera.position.set(0, ov.dist * 1.5, ov.dist * 1.4); const camLook = ov.target.clone();

  const body = document.body, modeTop = $('#mode-top'), flyBtn = $('#fly-btn'), flyPad = $('#fly-pad'); let flyHintShown = false;
  const shortLabels = () => { const sm = innerWidth < 640; modeTop.textContent = sm ? 'Overview' : 'Back to overview'; $('#help-btn').textContent = sm ? 'Help' : 'How to move'; $('#classic-link').textContent = sm ? 'Classic' : 'Classic view'; };
  shortLabels(); addEventListener('resize', shortLabels);
  function setMode(m) {
    mode = m; body.dataset.mode = m; transT = 1.6; idleT = 0;
    if (m === 'explore') { fol.yaw = avatar.rotation.y + Math.PI; fol.pitch = 0.34; if (!arrived) { arrived = true; avatar.position.set(0, 0, GATE_Z - 4); avatar.rotation.y = Math.PI; fol.yaw = 0; fol.pitch = 0.08; fol.dist = 20; } }
    else { setFlying(false); landing = false; keys.clear(); stick = { x: 0, y: 0 }; moveTarget = null; }
    updatePrompt(null);
  }
  function setFlying(on) {
    flying = on; landing = false; body.dataset.flying = String(on);
    flyBtn.textContent = on ? 'Land' : 'Fly'; flyBtn.setAttribute('aria-pressed', String(on));
    flyPad.hidden = !(on && mode === 'explore');
    if (on && !flyHintShown) { flyHintShown = true; toast(coarse ? 'Flying: use ▲ and ▼ to go up and down. Tap Land to walk again.' : 'Flying: Space up, Ctrl down, Shift faster. Drag to look; the fox flies where you look.'); }
    if (on) { avatar.position.y = Math.max(avatar.position.y, 1.2); moveTarget = null; }
  }
  $('#explore-btn').addEventListener('click', () => setMode('explore'));
  modeTop.addEventListener('click', () => setMode('overview'));
  flyBtn.addEventListener('click', () => { if (flying) landing = true; else setFlying(true); flyBtn.blur(); });

  const keys = new Set(); let stick = { x: 0, y: 0 }, moveTarget = null, padUp = false, padDown = false;
  const MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const FLYKEYS = ['ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ControlLeft', 'ControlRight'];
  const UP = ['Space', 'KeyE'], DOWN = ['ControlLeft', 'ControlRight', 'KeyC', 'KeyQ'];
  const held = list => list.some(k => keys.has(k));
  const typing = () => ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  addEventListener('keydown', e => {
    if (isOpen() || typing()) return;
    if (MOVE.includes(e.code) || e.code === 'KeyF') { if (mode === 'overview') setMode('explore'); }
    if (MOVE.includes(e.code) || FLYKEYS.includes(e.code)) { keys.add(e.code); moveTarget = null; if (e.code.startsWith('Arrow') || e.code === 'Space' || (flying && e.code.startsWith('Control'))) e.preventDefault(); }
    if (mode !== 'explore') return;
    if (e.code === 'KeyF') { if (flying) landing = true; else setFlying(true); }
    if (e.code === 'Space' && !flying) setFlying(true);
    if ((e.code === 'KeyE' || e.code === 'Enter') && near && !flying && (document.activeElement === document.body || document.activeElement === renderer.domElement)) { keys.delete('KeyE'); act(near.b); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const hold = (el, set) => { el.addEventListener('pointerdown', e => { e.preventDefault(); set(true); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => set(false)); };
  hold($('#fly-up'), v => (padUp = v)); hold($('#fly-down'), v => (padDown = v));

  const canvas = renderer.domElement, pointers = new Map(); let downAt = null, pinch = null;
  const view = () => mode === 'overview' ? ov : fol;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; idleT = 0; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view().dist }; } });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return; idleT = 0;
    if (pointers.size === 2 && pinch) { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...pointers.values()]; setDist(pinch.dist * pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))); return; }
    const v = view(); v.yaw -= (e.clientX - p.x) * 0.006; v.pitch = THREE.MathUtils.clamp(v.pitch + (e.clientY - p.y) * 0.004, mode === 'overview' ? 0.35 : 0.06, mode === 'overview' ? 1.38 : 1.3);
    p.x = e.clientX; p.y = e.clientY;
  });
  const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (downAt && e.button === 0 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 7 && performance.now() - downAt.t < 450) tap(e); downAt = null; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch = null; downAt = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); idleT = 0; setDist(view().dist * (1 + Math.sign(e.deltaY) * 0.1)); }, { passive: false });
  function setDist(d) { if (mode === 'overview') ov.dist = THREE.MathUtils.clamp(d, 45, ov.base * 1.25); else fol.dist = THREE.MathUtils.clamp(d, 4, flying ? 50 : 28); }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function tap(e) {
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true).find(h => h.object.userData.bid || h.object.userData.href || h.object.userData.walk || h.object === ground);
    if (!hit) return;
    if (hit.object.userData.href) { window.open(hit.object.userData.href, '_blank', 'noopener'); toast('Opening the game on itch.io in a new tab.'); return; }
    const bid = hit.object.userData.bid;
    if (bid) { const p = byId(bid); let itemId = null; for (let o = hit.object; o; o = o.parent) if (o.userData.itemId) { itemId = o.userData.itemId; break; } act(p.b, itemId); return; }
    if (mode === 'explore' && !flying) moveTarget = new THREE.Vector3(hit.point.x, 0, hit.point.z);
  }
  function act(b, itemId) {
    if (b.opens === 'site') return openSite(b.site);
    if (b.opens === 'game') return openGame(b);
    if (b.opens === 'link') { window.open(b.href, '_blank', 'noopener'); return toast(`Opening ${b.title} in a new tab.`); }
    if (!b.items.length) return toast(`${b.title}: ${b.sub}.`);
    openBuilding(b, itemId);
  }

  const stickEl = $('#stick'), knob = stickEl.querySelector('.stick-knob');
  stickEl.addEventListener('pointerdown', e => { stickEl.setPointerCapture(e.pointerId); moveStick(e); });
  stickEl.addEventListener('pointermove', e => { if (stickEl.hasPointerCapture(e.pointerId)) moveStick(e); });
  const releaseStick = () => { stick = { x: 0, y: 0 }; knob.style.transform = ''; };
  stickEl.addEventListener('pointerup', releaseStick); stickEl.addEventListener('pointercancel', releaseStick);
  function moveStick(e) { const r = stickEl.getBoundingClientRect(), max = r.width / 2; let x = e.clientX - r.left - max, y = e.clientY - r.top - max; const len = Math.hypot(x, y); if (len > max) { x *= max / len; y *= max / len; } stick = { x: x / max, y: y / max }; moveTarget = null; knob.style.transform = `translate(${x * 0.6}px, ${y * 0.6}px)`; }

  // ---------- name tags ----------
  const layer = $('#labels'), tmpV = new THREE.Vector3();
  const tags = places.filter(p => !p.hidden).map(p => {
    const el = document.createElement('button'); el.className = 'tag' + (p.b.overview === false ? ' tag-minor' : '') + (p.b.opens ? ' tag-site' : '');
    el.style.setProperty('--accent', p.b.accent); el.tabIndex = -1;
    el.innerHTML = '<span class="tag-title"></span><span class="tag-sub"></span>';
    el.children[0].textContent = p.b.title; el.children[1].textContent = p.b.sub || '';
    el.addEventListener('click', () => act(p.b)); layer.append(el);
    return { p, el, hi: new THREE.Vector3(p.x, p.labelY, p.z), lo: new THREE.Vector3(p.x, p.nearY, p.z), on: false, minor: p.b.overview === false };
  });
  for (const a of AREAS) {
    const el = document.createElement('button'); el.className = 'tag tag-area'; el.style.setProperty('--accent', a.accent); el.tabIndex = -1;
    el.innerHTML = '<span class="tag-title"></span><span class="tag-sub"></span>'; el.children[0].textContent = a.title; el.children[1].textContent = a.sub;
    el.addEventListener('click', () => focus(byId(a.focus))); layer.append(el);
    const v = new THREE.Vector3(a.at[0], a.y, a.at[1]);
    tags.push({ p: { x: a.at[0], z: a.at[1], b: { overview: true } }, el, hi: v, lo: v, on: false, area: true });
  }
  const placed = [];
  const measure = () => tags.forEach(T => { T.w = T.el.offsetWidth; T.h = T.el.offsetHeight; });
  document.fonts.ready.then(measure); measure();
  function updateTags() {
    const w = innerWidth, h = innerHeight, zoomed = ov.dist < 135, vis = [];
    for (const T of tags) {
      let show, anchor;
      if (mode === 'overview') { anchor = T.hi; show = T.area ? !zoomed : (!T.minor || zoomed); }
      else { anchor = flying && avatar.position.y > 12 ? T.hi : T.lo; const d = Math.hypot(avatar.position.x - T.p.x, avatar.position.z - T.p.z); show = T.area ? (flying && avatar.position.y > 18) : d < (T.minor ? 42 : 135); }
      if (show) { tmpV.copy(anchor).project(camera); show = tmpV.z < 1 && Math.abs(tmpV.x) < 1.04 && tmpV.y > -1.04 && tmpV.y < 1.5; }
      if (show) vis.push({ T, sx: (tmpV.x + 1) / 2 * w, sy: Math.max((1 - tmpV.y) / 2 * h, (T.h || 44) + 96), z: tmpV.z });
      else if (T.on) { T.el.classList.remove('is-on'); T.el.tabIndex = -1; T.on = false; }
    }
    vis.sort((a, b) => a.z - b.z); placed.length = 0;
    for (const v of vis) {
      const tw = v.T.w || 160, th = v.T.h || 44; let y = v.sy; v.sx = Math.min(Math.max(v.sx, tw / 2 + 10), w - tw / 2 - 10);
      for (let k = 0; k < 5; k++) { const x0 = v.sx - tw / 2, y0 = y - th - 8; if (!placed.some(r => x0 < r.x1 && x0 + tw > r.x0 && y0 < r.y1 && y0 + th > r.y0)) break; y -= th + 6; }
      placed.push({ x0: v.sx - tw / 2 - 3, x1: v.sx + tw / 2 + 3, y0: y - th - 11, y1: y + 3 });
      v.T.el.style.transform = `translate3d(${v.sx.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      v.T.el.classList.toggle('tag-lifted', y !== v.sy);
      if (!v.T.on) { v.T.el.classList.add('is-on'); v.T.el.tabIndex = 0; v.T.on = true; }
    }
  }

  // ---------- chips, prompt, help, toast ----------
  const dir = $('#directory');
  for (const c of CHIPS) {
    const p = byId(c.id); if (!p) continue;
    const btn = document.createElement('button'); btn.className = 'chip'; btn.style.setProperty('--accent', p.b.accent);
    btn.innerHTML = '<span class="swatch" aria-hidden="true"></span><span></span>'; btn.lastChild.textContent = c.label;
    btn.addEventListener('click', () => { focus(p); if (c.open) setTimeout(() => act(p.b), mode === 'overview' ? 650 : 50); });
    dir.append(btn);
  }
  function focus(p) {
    idleT = -6;
    if (mode === 'overview') { const big = (p.b.h || p.b.boxH || 10) > 30; ov.target.set(p.x, big ? 14 : 3, p.z); ov.yaw = p.rot; ov.pitch = big ? 0.42 : 0.5; ov.dist = (innerWidth < 700 ? 1.6 : 1) * (big ? 92 : Math.max(42, p.ext * 2.6)); transT = 1.2; return; }
    setFlying(false); avatar.position.set(p.front.x, 0, p.front.z); avatar.rotation.y = p.rot + Math.PI; fol.yaw = p.rot; fol.pitch = 0.3; moveTarget = null;
  }
  const prompt = $('#prompt'), promptBtn = $('#prompt-btn'); let near = null;
  promptBtn.addEventListener('click', () => near && act(near.b));
  function updatePrompt(found) {
    if (found === near) return; near = found; prompt.hidden = !near;
    if (!near) return; const b = near.b;
    promptBtn.textContent = b.opens === 'site' ? `Open the ${b.site.title}` : (b.opens === 'game' || b.items[0]?.kind === 'game') ? `Play ${b.title}` : b.opens === 'link' ? `Play ${b.title} on itch.io` : b.items.length ? `Open ${b.title}` : 'This plot is waiting for new work';
  }
  const toastEl = $('#toast'); let toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.hidden = true), 2800); }
  const help = $('#help'), helpBtn = $('#help-btn');
  const setHelp = open => { help.hidden = !open; helpBtn.setAttribute('aria-expanded', String(open)); };
  helpBtn.addEventListener('click', () => setHelp(help.hidden)); $('#help-close').addEventListener('click', () => setHelp(false));

  let paused = false; onInspectorChange(open => { paused = open; keys.clear(); stick = { x: 0, y: 0 }; padUp = padDown = false; layer.hidden = open; });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight); camera.fov = innerWidth < 700 ? 56 : 48; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const nb = overviewDist(); if (Math.abs(ov.dist - ov.base) < 1) ov.dist = nb; ov.base = nb; measure();
  });

  // ---------- collision ----------
  function collide(p) {
    for (const c of colliders) {
      if (p.y > c.h + 0.3) continue;
      if (c.kind === 'circle') { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + RADIUS; if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; } continue; }
      const dx = p.x - c.x, dz = p.z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      const ex = c.hw + RADIUS - Math.abs(lx), ez = c.hd + RADIUS - Math.abs(lz);
      if (ex > 0 && ez > 0) {
        let nx = lx, nz = lz; if (ex < ez) nx = Math.sign(lx || 1) * (c.hw + RADIUS); else nz = Math.sign(lz || 1) * (c.hd + RADIUS);
        p.x = c.x + nx * c.cos + nz * c.sin; p.z = c.z - nx * c.sin + nz * c.cos;
      }
    }
  }
  const tmpP = new THREE.Vector3();
  function insideAny(p, pad) {
    for (const c of colliders) {
      if (p.y > c.h) continue;
      if (c.kind === 'circle') { if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + pad) return true; continue; }
      const dx = p.x - c.x, dz = p.z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad) return true;
    }
    return false;
  }

  // ---------- loop ----------
  const clock = new THREE.Clock(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3();
  await Promise.race([Promise.allSettled(later), new Promise(r => setTimeout(r, 12000))]);
  status.hidden = true;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (paused || document.hidden) return;
    if (transT > 0) transT -= dt;

    if (mode === 'explore') {
      let ix = 0, iz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
      ix += stick.x; iz -= stick.y;
      fwd.set(-Math.sin(fol.yaw), 0, -Math.cos(fol.yaw)); right.set(Math.cos(fol.yaw), 0, -Math.sin(fol.yaw));
      move.set(0, 0, 0).addScaledVector(fwd, iz).addScaledVector(right, ix);
      let amount = Math.min(move.length(), 1);
      flyHold = flying && amount > 0.3 ? flyHold + dt : 0;
      if (amount < 0.05 && moveTarget) { move.subVectors(moveTarget, avatar.position).setY(0); if (move.length() < 0.4) { moveTarget = null; amount = 0; } else amount = 1; }
      const shiftHeld = keys.has('ShiftLeft') || keys.has('ShiftRight'), fast = flying ? (shiftHeld || flyHold > 1.2) : (shiftHeld || (moveTarget && move.length() > 14)); let curSpeed = 0;
      if (amount > 0.05) {
        move.normalize(); const speed = (flying ? (shiftHeld ? 21 : 10 + Math.min(1, Math.max(0, flyHold - 0.6) / 1.2) * 10) : (fast ? 9 : 4.5)) * amount; curSpeed = speed;
        avatar.position.addScaledVector(move, speed * dt);
        const yawWant = Math.atan2(move.x, move.z); let d = yawWant - avatar.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); avatar.rotation.y += d * Math.min(1, dt * 10);
      }
      let vy = 0;
      if (flying) {
        if (held(UP) || padUp) { vy += 1; landing = false; }
        if (held(DOWN) || padDown || landing) vy -= 1;
        // the fox heads where the camera looks: camera low (looking up) climbs, camera high (looking down) dives
        const steer = Math.abs(iz) > 0.1 && !landing ? THREE.MathUtils.clamp((0.36 - fol.pitch) / 0.3, -1.4, 1) * Math.sign(iz) : 0;
        avatar.position.y = THREE.MathUtils.clamp(avatar.position.y + (vy * (landing ? 11 : 8) + steer * curSpeed * 0.75) * dt, 0, FLY_MAX);
        if (avatar.position.y <= 0.001 && (vy < 0 || steer < 0)) setFlying(false);
      }
      collide(avatar.position);
      const rr = Math.hypot(avatar.position.x - PLAZA[0], avatar.position.z - PLAZA[1]); if (rr > PARK_R) { avatar.position.x = PLAZA[0] + (avatar.position.x - PLAZA[0]) * PARK_R / rr; avatar.position.z = PLAZA[1] + (avatar.position.z - PLAZA[1]) * PARK_R / rr; }
      if (flying) setPose(vy > 0 && amount < 0.05 ? 'ascend' : vy < 0 && amount < 0.05 ? 'descend' : fast && amount > 0.05 ? 'fly_fast' : 'fly');
      else setPose(amount > 0.05 ? (fast ? 'run' : 'walk') : 'idle');
      player.position.y = footY + (flying ? Math.sin(t * 2.2) * 0.08 : 0);

      let found = null, best = 1e9;
      if (avatar.position.y < 6) for (const p of places) { if (p.hidden) continue; const d = Math.hypot(avatar.position.x - p.front.x, avatar.position.z - p.front.z); const inside = Math.hypot(avatar.position.x - p.x, avatar.position.z - p.z) < p.ext + 3; if ((d < 8 || inside) && d < best) { best = d; found = p; } }
      updatePrompt(found);

      look.set(avatar.position.x, avatar.position.y + 1.2 + Math.min(2.2, fol.dist * 0.08), avatar.position.z);
      want.set(look.x + Math.sin(fol.yaw) * Math.cos(fol.pitch) * fol.dist, look.y + Math.sin(fol.pitch) * fol.dist, look.z + Math.cos(fol.yaw) * Math.cos(fol.pitch) * fol.dist);
      want.y = Math.max(want.y, 0.8);
      const steps = Math.ceil(fol.dist); let last = 1;
      for (let i = 1; i <= steps; i++) { const f = i / steps; tmpP.lerpVectors(look, want, f); if (insideAny(tmpP, 0.6)) break; last = f; }
      if (last < 1) want.lerpVectors(look, want, Math.max(0.25, last - 0.05));
    } else {
      idleT += dt; if (idleT > 6 && !reduced) ov.yaw += dt * 0.03;
      setPose('idle'); player.position.y = footY;
      look.copy(ov.target);
      want.set(look.x + Math.sin(ov.yaw) * Math.cos(ov.pitch) * ov.dist, look.y + Math.sin(ov.pitch) * ov.dist, look.z + Math.cos(ov.yaw) * Math.cos(ov.pitch) * ov.dist);
    }
    const shiftWant = mode === 'overview' && innerWidth > 900 ? Math.min(240, innerWidth * 0.15) : 0;
    shift += (shiftWant - shift) * Math.min(1, dt * 4);
    if (Math.abs(shift) > 0.5) camera.setViewOffset(innerWidth, innerHeight, -shift, 0, innerWidth, innerHeight); else if (camera.view) camera.clearViewOffset();
    const k = 1 - Math.exp(-dt * (transT > 0 ? 3 : mode === 'overview' ? 6 : 9));
    camera.position.lerp(want, k); camLook.lerp(look, k); camera.lookAt(camLook);
    sky.position.copy(camera.position);

    for (const m of mixers) m.update(dt);
    for (const f of tickers) f(t, dt);
    renderer.render(scene, camera);
    updateTags();
  });

  window.__city = { renderer, scene, camera, avatar, setMode, setFlying, focus: (id, snap) => { focus(byId(id)); if (snap) { transT = 0; camera.position.set(ov.target.x + Math.sin(ov.yaw) * Math.cos(ov.pitch) * ov.dist, ov.target.y + Math.sin(ov.pitch) * ov.dist, ov.target.z + Math.cos(ov.yaw) * Math.cos(ov.pitch) * ov.dist); camLook.copy(ov.target); } }, ov, fol, camLook, places: places.map(p => p.b.id), state: () => ({ mode, flying, y: avatar.position.y }) };
}
