// Hive Adapt (Project 0 port): the FX particle pool. One InstancedBufferGeometry quad per pool, one draw call each.
// Every particle is a camera-facing sprite (mode 0), a camera-facing segment (mode 1: velocity-stretched sparks, tracers,
// beams, flames) or a flat quad on a plane (mode 2: ground rings, ripples). Premultiplied blending lets one draw mix
// additive (glow) and alpha (smoke, debris) particles: additive ones write alpha 0.
// Simulation on the CPU in structure-of-arrays Float32Arrays; dead particles are swap-removed so instanceCount = live count.
// All positions are game-space metres (the meshes live under G.root, scaled by G.S).
import * as THREE from 'three'

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iAxis;
attribute vec4 iCol;
attribute vec4 iMisc;   // size (m), rotation (rad), atlas cell, mode
attribute vec2 iExtra;  // tail alpha (segments), additive (0..1)
uniform float uS;       // G.S: game metres -> lot units
uniform float uPx;      // projectionMatrix[1][1] * viewport height / 2 (pixels per unit at depth 1)
uniform float uMinPx;   // thinnest a sprite/segment may get on screen, in pixels (alpha compensates)
varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;
varying vec2 vCell;    // atlas cell origin (computed per vertex: an interpolated index can flip cells per pixel)
varying float vFogDepth;
void main() {
  vec2 c = position.xy;
  float size = iMisc.x;
  float mode = iMisc.w;
  float alphaK = 1.0;
  vec4 mv;
  if (mode < 0.5) {
    mv = modelViewMatrix * vec4(iPos, 1.0);
    float w = size * uS;
    float z0 = max(-mv.z, 1e-5);
    float px = w * uPx / z0;
    float k = max(1.0, uMinPx / max(px, 1e-5));
    alphaK = 1.0 / (k * k);
    // no soft particles: pull the sprite toward the eye along its view ray (same screen position and size) so a puff
    // sitting on the floor is not sliced by it
    float f = (z0 - min(min(size * 0.35, 2.0) * uS, z0 * 0.6)) / z0;
    mv.xyz *= f;
    float cr = cos(iMisc.y), sr = sin(iMisc.y);
    mv.xy += vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * (w * k * f);
    vUv = c + 0.5;
  } else if (mode < 1.5) {
    vec3 a = (modelViewMatrix * vec4(iPos - iAxis, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
    vec3 d = b - a;
    float len = length(d);
    vec3 dir = len > 1e-6 ? d / len : vec3(0.0, 1.0, 0.0);
    vec3 mid = (a + b) * 0.5;
    vec3 side = cross(dir, normalize(mid));
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float w = size * uS;
    float px = w * uPx / max(-mid.z, 1e-5);
    float k = max(1.0, uMinPx / max(px, 1e-5));
    alphaK = 1.0 / k;
    w *= k;
    float along = c.y + 0.5;
    vec3 pa = a - dir * (w * 0.5), pb = b + dir * (w * 0.5);
    mv = vec4(mix(pa, pb, along) + side * (c.x * w), 1.0);
    vUv = vec2(along, c.x + 0.5);
    alphaK *= mix(iExtra.x, 1.0, along);
  } else {
    vec3 n = normalize(iAxis);
    vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bt = cross(n, t);
    float cr = cos(iMisc.y), sr = sin(iMisc.y);
    vec2 r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * size;
    mv = modelViewMatrix * vec4(iPos + t * r.x + bt * r.y, 1.0);
    // depth bias toward the eye (screen position unchanged): a ground ring stays over the bumps of the terrain it lies on
    mv.xyz -= normalize(mv.xyz) * (uS * min(0.08 + size * 0.06, 0.6));
    vUv = c + 0.5;
  }
  vCol = vec4(iCol.rgb, iCol.a * alphaK);
  vAdd = iExtra.y;
  float cell = floor(iMisc.z + 0.5);
  vCell = vec2(mod(cell, 4.0), floor(cell / 4.0)) * 0.25;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;
varying vec2 vCell;
varying float vFogDepth;
void main() {
  vec2 uv = vCell + (0.015 + clamp(vUv, 0.0, 1.0) * 0.97) * 0.25;
  vec4 t = texture2D(uMap, uv);
  float a = t.a * vCol.a;
  if (a < 0.003) discard;
  vec3 col = vCol.rgb * t.rgb;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, fogColor * (1.0 - vAdd), fogF);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
}
`

export function particleMaterial(map, S) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uS: { value: S }, uPx: { value: 600 }, uMinPx: { value: 1.4 } }]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  })
  m.uniforms.uMap.value = map
  m.name = 'FX_Particles'
  return m
}

// per-particle fields (structure of arrays); every one is swap-copied on removal
const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'size', 's0', 's1', 'rot', 'spin', 'grav', 'drag', 'r', 'g', 'b', 'a',
  'cell', 'mode', 'stretch', 'slen', 'ax', 'ay', 'az', 'floor', 'fade', 'noise', 'add', 'tail', 'beh', 'ox', 'oy', 'oz', 'dist', 'tlen', 'trav', 'ph', 'hit', 'fresh']
// beh: 0 physics, 1 tracer (head races from o along v at |v|), 2 beam (fixed from o to p, width pulse), 3 held (fixed, no motion)
// fade: 0 Unity default (1 until 35 %, then linear to 0), 1 fade in (0 -> 1 by 15 %, hold to 60 %, -> 0), 2 linear 1 -> 0, 3 flat 1 then last 20 %

export class ParticlePool {
  constructor(material, cap, name, renderOrder) {
    this.cap = cap
    this.n = 0
    for (const f of FIELDS) this[f] = new Float32Array(cap)
    this.arrays = FIELDS.map(f => this[f])
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const mk = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a }
    this.aPos = mk('iPos', 3)
    this.aAxis = mk('iAxis', 3)
    this.aCol = mk('iCol', 4)
    this.aMisc = mk('iMisc', 4)
    this.aExtra = mk('iExtra', 2)
    this.uploads = [this.aPos, this.aAxis, this.aCol, this.aMisc, this.aExtra]
    g.instanceCount = 0
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    this.geometry = g
    this.mesh = new THREE.Mesh(g, material)
    this.mesh.name = name
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.mesh.matrixAutoUpdate = false
  }
  /** a fresh slot (fields zeroed where it matters) or -1 when full */
  alloc() {
    if (this.n >= this.cap) return -1
    const i = this.n++
    this.age[i] = 0; this.vx[i] = this.vy[i] = this.vz[i] = 0; this.rot[i] = 0; this.spin[i] = 0; this.grav[i] = 0; this.drag[i] = 0
    this.s0[i] = 1; this.s1[i] = 1; this.mode[i] = 0; this.stretch[i] = 0; this.slen[i] = 0; this.ax[i] = 0; this.ay[i] = 1; this.az[i] = 0
    this.floor[i] = -1e9; this.fade[i] = 0; this.noise[i] = 0; this.add[i] = 1; this.tail[i] = 1; this.beh[i] = 0; this.hit[i] = 0; this.fresh[i] = 1
    return i
  }
  kill(i) {
    const last = --this.n
    if (i !== last) { const A = this.arrays; for (let k = 0; k < A.length; k++) A[k][i] = A[k][last] }
  }
  clear() { this.n = 0; this.geometry.instanceCount = 0 }

  /** integrate and write the instance buffers */
  update(dtFrame) {
    const { px, py, pz, vx, vy, vz, age, life, size, s0, s1, rot, spin, grav, drag, r, g, b, a, cell, mode, stretch, slen, ax, ay, az,
      floor, fade, noise, add, tail, beh, ox, oy, oz, dist, tlen, trav, ph, hit, fresh } = this
    const P = this.aPos.array, X = this.aAxis.array, C = this.aCol.array, M = this.aMisc.array, E = this.aExtra.array
    let i = 0
    while (i < this.n) {
      const bh = beh[i]
      // a particle spawned since the last update is drawn once at birth before it ages (a 0.04 s muzzle flash must show
      // even at 15 fps); tracers start racing at once
      let dt = dtFrame
      if (fresh[i]) { fresh[i] = 0; if (bh !== 1) dt = 0 }
      age[i] += dt
      const L = life[i]
      let alpha = a[i], sz = size[i], axx = 0, axy = 0, axz = 0
      if (bh === 1) {
        // tracer: a bright segment races from o toward o + dir * dist at |v| m/s, length tlen
        trav[i] += vx[i] * dt
        const t = trav[i], D = dist[i]
        if (D < 0.01 || t - tlen[i] >= D) { this.kill(i); continue }
        const head = t < D ? t : D
        let tl = t - tlen[i]; if (tl < 0) tl = 0
        px[i] = ox[i] + ax[i] * head; py[i] = oy[i] + ay[i] * head; pz[i] = oz[i] + az[i] * head
        const l = head - tl
        axx = ax[i] * l; axy = ay[i] * l; axz = az[i] * l
      } else if (bh === 2) {
        // beam: holds from o to p; width x (1 - k)(1 + 0.3 sin 90t) (Tracer.cs)
        if (age[i] >= L) { this.kill(i); continue }
        const k = age[i] / L
        sz = size[i] * (1 - k) * (1 + 0.3 * Math.sin(age[i] * 90))
        axx = px[i] - ox[i]; axy = py[i] - oy[i]; axz = pz[i] - oz[i]
      } else {
        const ag = age[i]
        if (ag >= L) { this.kill(i); continue }
        if (ag < 0) { alpha = 0 } else {
          if (bh === 0) {
            const gr = grav[i]
            if (gr !== 0) vy[i] -= gr * dt
            const dr = drag[i]
            if (dr > 0) { const f = Math.exp(-dr * dt); vx[i] *= f; vy[i] *= f; vz[i] *= f }
            const nz = noise[i]
            if (nz > 0) {
              const q = ph[i], w = nz * 2.4 * dt
              vx[i] += Math.sin(ag * 2.3 + q) * w; vy[i] += Math.sin(ag * 1.7 + q * 1.3) * w * 0.6; vz[i] += Math.cos(ag * 2.1 + q * 0.7) * w
            }
            px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt
            if (py[i] < floor[i]) {
              py[i] = floor[i]
              if (vy[i] < 0) {
                vy[i] = -vy[i] * 0.35; vx[i] *= 0.55; vz[i] *= 0.55; spin[i] *= 0.5
                if (hit[i] < 3) { age[i] += L * 0.25; hit[i] += 1 }
                if (vy[i] < 0.4) { vy[i] = 0; vx[i] *= 0.6; vz[i] *= 0.6 }
              }
            }
          }
          rot[i] += spin[i] * dt
          const k = ag / L
          const fd = fade[i]
          let fa
          if (fd === 0) fa = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65
          else if (fd === 1) fa = k < 0.15 ? k / 0.15 : k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4
          else if (fd === 2) fa = 1 - k
          else fa = k < 0.8 ? 1 : (1 - k) * 5
          alpha *= fa
          const e = k * k * (3 - 2 * k)
          sz *= s0[i] + (s1[i] - s0[i]) * e
          if (mode[i] === 1) {
            const st = stretch[i]
            if (st > 0) {
              const sp2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]
              const sp = Math.sqrt(sp2)
              if (sp > 1e-4) {
                const l = sp * st + sz * slen[i]
                axx = vx[i] / sp * l; axy = vy[i] / sp * l; axz = vz[i] / sp * l
              }
            } else {
              const l = sz * slen[i]
              axx = ax[i] * l; axy = ay[i] * l; axz = az[i] * l
            }
          } else if (mode[i] === 2) { axx = ax[i]; axy = ay[i]; axz = az[i] }
        }
      }
      const o3 = i * 3, o4 = i * 4, o2 = i * 2
      P[o3] = px[i]; P[o3 + 1] = py[i]; P[o3 + 2] = pz[i]
      X[o3] = axx; X[o3 + 1] = axy; X[o3 + 2] = axz
      C[o4] = r[i]; C[o4 + 1] = g[i]; C[o4 + 2] = b[i]; C[o4 + 3] = alpha
      M[o4] = sz; M[o4 + 1] = rot[i]; M[o4 + 2] = cell[i]; M[o4 + 3] = mode[i]
      E[o2] = tail[i]; E[o2 + 1] = add[i]
      i++
    }
    const n = this.n
    this.geometry.instanceCount = n
    if (n > 0) {
      const U = this.uploads
      for (let k = 0; k < U.length; k++) { const attr = U[k]; attr.clearUpdateRanges(); attr.addUpdateRange(0, n * attr.itemSize); attr.needsUpdate = true }
    }
    this.mesh.visible = n > 0
    return n
  }
}
