// Small GLB viewer used inside the inspector.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function createViewer(container, url) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdce9ec, 0x1c1410, 1.4));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0d8, 1.2); rim.position.set(-4, 3, -3); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false;

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene; scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;
  controls.target.copy(centre);
  camera.position.copy(centre).add(new THREE.Vector3(radius * 1.2, radius * 0.6, radius * 2.2));
  controls.minDistance = radius * 0.8; controls.maxDistance = radius * 6;

  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 48),
    new THREE.MeshBasicMaterial({ color: 0x92b8b8, transparent: true, opacity: 0.12 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = box.min.y + 0.001; scene.add(disc);

  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations.map(c => c.name);
  let action = null, active = null;
  const play = name => {
    const clip = gltf.animations.find(c => c.name === name); if (!clip) return;
    const next = mixer.clipAction(clip); next.reset().fadeIn(0.25).play();
    if (action && action !== next) action.fadeOut(0.25);
    action = next; active = name;
  };
  if (clips.length) play(clips.includes('idle') ? 'idle' : clips[0]);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight || w * 0.75;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    mixer.update(Math.min(clock.getDelta(), 0.05));
    controls.update(); renderer.render(scene, camera);
  });

  return {
    clips, get active() { return active; }, play,
    dispose() {
      renderer.setAnimationLoop(null); ro.disconnect(); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => { m.map?.dispose(); m.dispose(); }); });
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
