import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CONFIG as C} from './core.js';

// Original geometry and surface painting. No remote assets or post-processing.
export function createWorld(p0, scale = 1) {
  const group = new THREE.Group();
  group.name = 'Afterglow archipelago';
  group.scale.setScalar(scale);
  p0.scene.add(group);
  const owned = new Set(), textures = new Set();
  const seaY = 3;
  const metal = material(0x638b87, .5, .56);
  const brass = material(0xbd9a58, .33, .75);
  const stone = material(0x3b5265, .93, .03);
  const dark = material(0x182d40, .65, .32);
  const ivory = material(0xcfccb0, .8, .02);
  const amber = material(0xffbf69, .3, .5, 0xffb154, 1.8);
  const teal = material(0x70ded5, .4, .18, 0x52cfc7, .6);
  const lantern = new THREE.Group();
  const aim = new THREE.Group();
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -seaY * scale);
  const hitPoint = new THREE.Vector3();
  const glowBytes = new Uint8Array(C.GW * C.GH * 4);
  const glowMap = new THREE.DataTexture(glowBytes, C.GW, C.GH, THREE.RGBAFormat);
  glowMap.minFilter = glowMap.magFilter = THREE.LinearFilter;
  glowMap.generateMipmaps = false;
  textures.add(glowMap);

  function material(color, roughness, metalness, emission = 0, power = 0) {
    const m = new THREE.MeshStandardMaterial({color, roughness, metalness, emissive: emission, emissiveIntensity: power});
    owned.add(m);
    return m;
  }
  function mesh(geometry, mat, parent = group) {
    owned.add(geometry);
    const m = new THREE.Mesh(geometry, mat);
    parent.add(m);
    return m;
  }
  function cylinder(r1, r2, h, mat, x, y, z, parent = group, sides = 32) {
    const m = mesh(new THREE.CylinderGeometry(r1, r2, h, sides), mat, parent);
    m.position.set(x, y, z);
    return m;
  }
  function ring(radius, tube, mat, x, y, z, parent = group) {
    const m = mesh(new THREE.TorusGeometry(radius, tube, 6, 48), mat, parent);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }
  function lineTube(points, radius, mat, parent = group) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(12, points.length * 2), radius, 5, false), mat, parent);
  }

  // A restrained painterly sky rather than a black void.
  const sky = new OffscreenCanvas(512, 256), s = sky.getContext('2d');
  const gradient = s.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#111b35');
  gradient.addColorStop(.55, '#325f78');
  gradient.addColorStop(1, '#9ab4b3');
  s.fillStyle = gradient;
  s.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    const x = (i * 73.73) % 512, y = (i * 31.17) % 126;
    s.fillStyle = `rgba(225,242,238,${.15 + (i % 4) * .1})`;
    s.fillRect(x, y, i % 6 === 0 ? 2 : 1, 1);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  textures.add(skyTex);
  p0.scene.background = skyTex;

  // Fresnel lighthouse: masonry courses, brass ribs, balcony and an exposed lens.
  cylinder(2.35, 3.05, .8, dark, C.lampX, 3.2, 0);
  cylinder(2.08, 2.35, .7, ivory, C.lampX, 3.9, 0);
  cylinder(.82, 1.42, 10.5, metal, C.lampX, 9.5, 0);
  for (let i = 0; i < 16; i++) {
    const y = 4.4 + i * .65, r = 1.42 - (y - 4.25) / 10.5 * .6;
    ring(r + .012, .035, i % 4 === 0 ? brass : dark, C.lampX, y, 0);
  }
  for (let side = 0; side < 8; side++) {
    const a = side * Math.PI / 4;
    lineTube([new THREE.Vector3(C.lampX + 1.4 * Math.cos(a), 4.25, 1.4 * Math.sin(a)),
      new THREE.Vector3(C.lampX + .84 * Math.cos(a), 14.8, .84 * Math.sin(a))], .055, brass);
  }
  const stairPoints = [];
  for (let i = 0; i < 120; i++) {
    const y = 4.3 + i * .084, a = i * .15, r = 1.65 - i * .004;
    stairPoints.push(new THREE.Vector3(C.lampX + r * Math.cos(a), y + .55, r * Math.sin(a)));
    if (i % 2 === 0) {
      const tread = mesh(new THREE.BoxGeometry(.42, .08, .7), dark);
      tread.position.set(C.lampX + r * Math.cos(a), y, r * Math.sin(a));
      tread.rotation.y = -a;
    }
  }
  lineTube(stairPoints, .035, brass);
  cylinder(1.55, 1.55, .23, brass, C.lampX, 14.95, 0);
  ring(1.57, .045, brass, C.lampX, 15.65, 0);
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    cylinder(.025, .025, .7, brass, C.lampX + 1.55 * Math.cos(a), 15.3, 1.55 * Math.sin(a), group, 5);
  }
  group.add(lantern);
  lantern.position.set(C.lampX, 16.5, 0);
  cylinder(.9, .9, 1.7, dark, 0, 0, 0, lantern);
  for (let i = 0; i < 12; i++) ring(.92 + Math.sin(i / 11 * Math.PI) * .18, .038, amber, 0, -.64 + i * .116, 0, lantern);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    cylinder(.034, .034, 1.75, brass, 1.19 * Math.cos(a), 0, 1.19 * Math.sin(a), lantern, 6);
  }
  cylinder(0, 1.35, .95, metal, 0, 1.43, 0, lantern);
  cylinder(.04, .08, .65, brass, 0, 2.2, 0, lantern, 8);
  lantern.add(new THREE.PointLight(0xffc384, 14 * scale * scale, 12 * scale, 2));
  lantern.add(aim);
  const optic = cylinder(.46, .46, .08, amber, 1.18, 0, 0, aim);
  optic.rotation.z = Math.PI / 2;
  const telescope = cylinder(.14, .14, 1, brass, C.lampX, 15.3, 0);
  telescope.name = 'Telescoping lens mast';

  // Each rock has an authored asymmetric contour and terrace, matching the core's shadows.
  for (const rock of [{x: -2.75, z: -4.44, r: 1.3, h: 8}, {x: -1.78, z: 3.67, r: .8, h: 3.8},
    {x: 3.5, z: -1.6, r: .7, h: 3.8}]) {
    const height = rock.h - seaY; // Core obstacle tops are absolute world heights.
    const g = new THREE.CylinderGeometry(rock.r * .58, rock.r, height, 11, 5);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const rough = 1 + .08 * Math.sin(x * 7 + z * 11 + y * 3);
      p.setXYZ(i, x * rough + Math.sin(y * .7) * .09, y, z * rough);
    }
    g.computeVertexNormals();
    const m = mesh(g, stone);
    m.position.set(rock.x, seaY + height / 2, rock.z);
    cylinder(rock.r * .64, rock.r * .66, .12, metal, rock.x, rock.h, rock.z, group, 11);
    ring(rock.r * .72, .035, teal, rock.x, seaY + .07, rock.z);
  }

  const water = new THREE.ShaderMaterial({transparent: true, depthWrite: false, uniforms: {
    glow: {value: glowMap}, time: {value: 0}, finale: {value: 0}
  }, vertexShader: `varying vec2 vUv;
    void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `uniform sampler2D glow;uniform float time;uniform float finale;varying vec2 vUv;
    void main(){float g=texture2D(glow,vUv).r;
      float ripple=sin(vUv.x*93.0+time*.35)*sin(vUv.y*61.0-time*.22);
      float cloud=sin(vUv.x*13.0+vUv.y*11.0+time*.03)*cos(vUv.y*17.0-time*.02);
      vec3 base=mix(vec3(.055,.13,.23),vec3(.13,.27,.35),cloud*.35+.4);
      base+=ripple*.009;
      vec3 light=mix(vec3(.15,.65,.68),vec3(1.0,.71,.28),smoothstep(.35,.85,g));
      vec3 color=base+light*g*.83;
      color+=vec3(.12,.30,.26)*finale*(.5+.5*sin(vUv.x*19.0+time*.3));
      float edge=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y));
      float opacity=smoothstep(0.0,.07,edge);
      gl_FragColor=vec4(color,opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  owned.add(water);
  const sea = mesh(new THREE.PlaneGeometry(C.W, C.D), water);
  sea.rotation.x = -Math.PI / 2;
  // The texture's row zero corresponds to z=-10. Flip the UVs to preserve that mapping.
  const uv = sea.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  sea.position.y = seaY;
  cylinder(2, 2.5, .45, dark, C.lampX, seaY + .22, 0);
  ring(C.homeR, .055, teal, C.lampX, seaY + .3, 0);

  // Soft cloud banks along the outer rim; original translucent painting in one instanced draw.
  const cloudCanvas = new OffscreenCanvas(128, 128), cc = cloudCanvas.getContext('2d');
  const cg = cc.createRadialGradient(64, 64, 1, 64, 64, 62);
  cg.addColorStop(0, 'rgba(135,171,179,.48)');
  cg.addColorStop(.4, 'rgba(112,152,172,.25)');
  cg.addColorStop(1, 'rgba(95,126,157,0)');
  cc.fillStyle = cg; cc.fillRect(0, 0, 128, 128);
  const cloudTex = new THREE.CanvasTexture(cloudCanvas); textures.add(cloudTex);
  const cloudMat = new THREE.MeshBasicMaterial({map: cloudTex, transparent: true, depthWrite: false, color: 0xbad9e5});
  owned.add(cloudMat);
  const cloudGeo = new THREE.PlaneGeometry(1, 1); owned.add(cloudGeo);
  const cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, 34);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 34; i++) {
    const a = i * 2.39996, radius = 11.5 + (i % 3) * .8;
    dummy.position.set(Math.cos(a) * Math.min(radius, 14.5), 3.1 + (i % 4) * .12, Math.sin(a) * 8.4);
    dummy.rotation.x = -Math.PI / 2;
    dummy.scale.set(4 + i % 4, 2 + i % 3, 1); dummy.updateMatrix();
    cloudMesh.setMatrixAt(i, dummy.matrix);
  }
  group.add(cloudMesh);

  // Juvenile rays use a continuous custom surface with swept anatomy, not assembled primitives.
  const rayGeo = mantaGeometry(); owned.add(rayGeo);
  const rayMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .48, metalness: .15,
    emissive: 0x073939, emissiveIntensity: .4, side: THREE.DoubleSide}); owned.add(rayMat);
  const rayTime = {value: 0};
  rayMat.onBeforeCompile = shader => {
    shader.uniforms.rayTime = rayTime;
    shader.vertexShader = 'uniform float rayTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed.y += sin(rayTime*3.9-abs(position.x)*3.4-position.z*2.0)*pow(abs(position.x),1.4)*.19;');
  };
  const rays = Array.from({length: 7}, (_, i) => {
    const root = new THREE.Group(); root.name = `Manta fry ${i + 1}`; group.add(root);
    root.scale.setScalar(1.35);
    const body = mesh(rayGeo, rayMat, root);
    const tail = lineTube([new THREE.Vector3(0, 0, -.32), new THREE.Vector3(.025, .015, -.6),
      new THREE.Vector3(-.02, .06, -.9)], .012, teal, root);
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(.037, 8, 6), dark, root);
      eye.position.set(side * .11, .05, .25);
    }
    const aura = ring(.42, .016, teal, 0, -.18, 0, root);
    return {root, body, tail, aura};
  });

  const stormMat = new THREE.MeshBasicMaterial({color: 0x646396, transparent: true, opacity: .19,
    depthWrite: false, side: THREE.DoubleSide}); owned.add(stormMat);
  const storm = mesh(new THREE.CircleGeometry(C.squallR, 48), stormMat);
  storm.rotation.x = -Math.PI / 2; storm.visible = false;
  const stormRing = ring(C.squallR, .025, teal, 0, 3.25, 0); stormRing.visible = false;
  const beacon = new THREE.PointLight(0x73fff0, 2 * scale * scale, 8 * scale, 2);
  beacon.position.set(C.lampX, 4.5, 0); group.add(beacon);

  const guideGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(C.lampX, seaY + .12, 0),
    new THREE.Vector3(C.lampX + 24, seaY + .12, 0)]); owned.add(guideGeo);
  const guideMat = new THREE.LineBasicMaterial({color: 0xffd89b, transparent: true, opacity: .35}); owned.add(guideMat);
  const guide = new THREE.Line(guideGeo, guideMat); group.add(guide);
  function consolidate(parent, exceptions) {
    const sets = new Map();
    for (const child of [...parent.children]) {
      if (!child.isMesh || child.isInstancedMesh || exceptions.has(child)) continue;
      child.updateMatrix();
      const geometry = child.geometry.clone().applyMatrix4(child.matrix);
      if (!sets.has(child.material)) sets.set(child.material, []);
      sets.get(child.material).push(geometry);
      parent.remove(child);
    }
    for (const [mat, geometries] of sets) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) throw new Error('Static lighthouse geometry could not be consolidated');
      mesh(merged, mat, parent);
    }
  }
  consolidate(group, new Set([sea, storm, stormRing, guide, cloudMesh, telescope]));
  consolidate(lantern, new Set());
  let time = 0;
  function update(run, dt, menu = false) {
    time += dt;
    rayTime.value = time;
    water.uniforms.time.value = time;
    water.uniforms.finale.value = run.done && run.saved === 7 ? 1 : 0;
    const lightHeight = 16.5 + run.lamp.lift * 2;
    lantern.position.y = lightHeight;
    telescope.scale.y = .70 + run.lamp.lift * 2;
    telescope.position.y = 15.3 + run.lamp.lift;
    aim.rotation.y = -run.lamp.angle;
    const positions = guide.geometry.attributes.position;
    positions.setXYZ(1, C.lampX + Math.cos(run.lamp.angle) * 24, seaY + .12, Math.sin(run.lamp.angle) * 24);
    positions.needsUpdate = true;
    for (let i = 0; i < run.grid.length; i++) {
      glowBytes[i * 4] = Math.round(run.grid[i] * 255);
      glowBytes[i * 4 + 3] = 255;
    }
    glowMap.needsUpdate = true;
    rays.forEach((ray, i) => {
      const f = run.fries[i];
      ray.root.visible = menu || ['moving', 'waiting', 'stranded'].includes(f.status);
      const x = menu ? 4 + Math.cos(i * .85) * 5 : f.x;
      const z = menu ? Math.sin(i * .85) * 5 : f.z;
      ray.root.position.set(x, menu ? 5.2 + Math.sin(time + i) * .14 : f.y + .18, z);
      ray.root.rotation.y = Math.atan2(C.lampX - x, -z);
      ray.body.scale.y = 1 + Math.sin(time * 3 + i) * .35;
      ray.body.rotation.z = Math.sin(time * 2.3 + i) * .09;
      ray.tail.rotation.y = Math.sin(time * 2.6 + i) * .17;
      ray.aura.material = f.status === 'stranded' ? amber : teal;
      ray.aura.visible = !menu;
    });
    storm.visible = stormRing.visible = run.squall.active;
    storm.position.set(run.squall.x, seaY + .08, run.squall.z);
    stormRing.position.set(run.squall.x, seaY + .16, run.squall.z);
    stormMat.opacity = run.squall.calm > 0 ? .06 : .2;
    beacon.intensity = (1.5 + run.saved * .5 + Math.sin(time * 2) * .15) * scale * scale;
  }
  function aimBearing(x, y) {
    pointer.set(x / p0.width * 2 - 1, 1 - y / p0.height * 2);
    ray.setFromCamera(pointer, p0.camera);
    if (!ray.ray.intersectPlane(plane, hitPoint)) return null;
    group.updateMatrixWorld(true); group.worldToLocal(hitPoint);
    return THREE.MathUtils.clamp(Math.atan2(hitPoint.z, hitPoint.x - C.lampX), -C.angleLimit, C.angleLimit);
  }
  return {group, update, aimBearing, seaY, dispose() {
    p0.scene.remove(group);
    for (const item of owned) item.dispose();
    for (const tex of textures) tex.dispose();
  }};
}

function mantaGeometry() {
  const positions = [], colors = [], indices = [];
  const rows = 20, columns = 30;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, z = .4 - t * .83;
    const width = .12 + .57 * Math.sin(Math.PI * t) ** .72;
    for (let i = 0; i <= columns; i++) {
      const u = i / columns * 2 - 1;
      const edge = Math.abs(u);
      const y = .085 * (1 - u * u) * Math.sin(t * Math.PI) + .1 * edge ** 3 * Math.sin(t * Math.PI);
      positions.push(u * width, y, z - edge * .18);
      const neon = edge ** 12;
      colors.push(.055 + neon * .23, .22 + neon * .51, .34 + neon * .42);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * (columns + 1) + i, b = a + columns + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
