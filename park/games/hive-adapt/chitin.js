// Hive Adapt (Project 0 port): the HiveAdapt/Chitin look as a MeshStandardMaterial extension.
// Vertex COLOR_0: rgb = per-part tint (multiplies the base colour), alpha = glow mask (drives emission).
// Per-bug uniforms (one material per bug, one shared GPU program): hit flash, dissolve, glow boost, pulse phase,
// elite emission + rim, Hive evolution tint / plates / glow shift. The SSS colour is a cheap back-light + rim term.
import * as THREE from 'three'

/** global knobs (tune against the renderer's ACES exposure) */
export const CHITIN = { emissionScale: 0.4, rimScale: 1.0, sssScale: 0.12 }

const shared = { uTime: { value: 0 } }
/** call once per frame with the game time (glow breathing) */
export function chitinTime(t) { shared.uTime.value = t }

const lin = (c, s = 1) => new THREE.Color().setRGB(c[0] * s, c[1] * s, c[2] * s, THREE.LinearSRGBColorSpace)
const srgb = c => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)

const VERT_PARS = /* glsl */`
varying vec3 vHvObj;
`
const FRAG_PARS = /* glsl */`
varying vec3 vHvObj;
uniform float uHvTime, uHvFlash, uHvDissolve, uHvGlow, uHvPhase, uHvPulse, uHvSmooth, uHvSmoothVar, uHvSSSStr, uHvPlates, uHvEvoMix, uHvEliteRim;
uniform vec3 uHvEmis, uHvSSS, uHvRim, uHvEvoTint, uHvPlateCol, uHvEvoGlow, uHvRimElite;
float hvHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hvNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hvHash(i), hvHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hvHash(i + vec3(0.0, 1.0, 0.0)), hvHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hvHash(i + vec3(0.0, 0.0, 1.0)), hvHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hvHash(i + vec3(0.0, 1.0, 1.0)), hvHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`
const FRAG_DISSOLVE = /* glsl */`
float hvN = hvNoise(vHvObj * 3.1) * 0.62 + hvNoise(vHvObj * 9.7) * 0.38;
float hvCut = uHvDissolve * 1.08;
if (uHvDissolve > 0.0 && hvN < hvCut) discard;
float hvEdge = uHvDissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.07, hvN - hvCut) : 0.0;
float hvMask = 0.0;
`
const FRAG_COLOR = /* glsl */`
#if defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= vColor.rgb;
  hvMask = vColor.a;
#elif defined( USE_COLOR )
  diffuseColor.rgb *= vColor;
#endif
diffuseColor.rgb *= uHvEvoTint;
float hvPlate = 0.0;
if (uHvPlates > 0.001) {
  float pn = hvNoise(vHvObj * 3.7 + 11.0) * 0.7 + hvNoise(vHvObj * 11.0) * 0.3;
  hvPlate = smoothstep(0.62 - uHvPlates * 0.55, 0.66 - uHvPlates * 0.55, pn) * (1.0 - hvMask);
  diffuseColor.rgb = mix(diffuseColor.rgb, uHvPlateCol, hvPlate * 0.8);
}
`
const FRAG_ROUGH = /* glsl */`
float roughnessFactor = clamp(1.0 - (uHvSmooth + (hvNoise(vHvObj * 6.3 + 3.0) - 0.5) * uHvSmoothVar), 0.06, 1.0);
roughnessFactor = mix(roughnessFactor, 0.6, hvPlate);
`
const FRAG_EMIS = /* glsl */`
float hvPulse = 0.8 + 0.2 * sin(uHvTime * 6.2831853 * uHvPulse + uHvPhase);
vec3 hvEm = mix(uHvEmis, uHvEvoGlow, uHvEvoMix);
vec3 hvGlowC = hvEm * (hvMask * uHvGlow * hvPulse);
// keep the hue under ACES without bloom: cap the brightest channel
float hvPeak = max(hvGlowC.r, max(hvGlowC.g, hvGlowC.b));
hvGlowC *= min(1.0, 2.6 / max(hvPeak, 1e-4));
totalEmissiveRadiance = hvGlowC + vec3(1.0, 0.8, 0.6) * (uHvFlash * 1.5) + hvEm * (hvEdge * 1.4) + vec3(1.0, 0.45, 0.1) * (hvEdge * 0.6);
`
const FRAG_RIM = /* glsl */`
{
  vec3 hvV = normalize(vViewPosition);
  float hvNdV = clamp(dot(normal, hvV), 0.0, 1.0);
  float hvFres = pow(1.0 - hvNdV, 3.0);
  outgoingLight += (uHvRim + uHvRimElite * (uHvEliteRim * (0.55 + 0.45 * hvPulse))) * hvFres;
  #if NUM_DIR_LIGHTS > 0
    float hvBack = pow(clamp(dot(-hvV, directionalLights[ 0 ].direction), 0.0, 1.0), 4.0);
    float hvThin = (1.0 - hvNdV) * (1.0 - hvNdV);
    outgoingLight += uHvSSS * (uHvSSSStr * hvBack * hvThin) * directionalLights[ 0 ].color;
  #endif
}
`

/**
 * Builds one chitin material (call per bug instance; all instances share the GPU program).
 * p = MATS entry: { base, emis, sss, smooth, smoothVar, sssStrength, pulseSpeed, wing }
 */
export function makeChitin(p) {
  const m = new THREE.MeshStandardMaterial({ color: srgb(p.base), roughness: 1 - p.smooth, metalness: 0.08, vertexColors: true, envMapIntensity: 0.9 })
  m.name = 'Chitin'
  const u = {
    uHvTime: shared.uTime,
    uHvFlash: { value: 0 }, uHvDissolve: { value: 0 }, uHvGlow: { value: 1 }, uHvPhase: { value: 0 },
    uHvPulse: { value: p.pulseSpeed || 0.9 }, uHvSmooth: { value: p.smooth }, uHvSmoothVar: { value: p.smoothVar },
    uHvSSSStr: { value: p.sssStrength * CHITIN.sssScale }, uHvPlates: { value: 0 }, uHvEvoMix: { value: 0 }, uHvEliteRim: { value: 0 },
    uHvEmis: { value: lin(p.emis, CHITIN.emissionScale) }, uHvSSS: { value: srgb(p.sss) }, uHvRim: { value: srgb(p.sss).multiplyScalar(0.12 * CHITIN.rimScale) },
    uHvEvoTint: { value: new THREE.Color(1, 1, 1) }, uHvPlateCol: { value: srgb([0.42, 0.4, 0.37]) }, uHvEvoGlow: { value: new THREE.Color(0, 0, 0) },
    uHvRimElite: { value: srgb([1, 0.72, 0.28]) },
  }
  m.userData.hv = u
  m.userData.baseEmis = u.uHvEmis.value.clone()
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHvObj = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_DISSOLVE)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <emissivemap_fragment>', FRAG_EMIS)
      .replace('#include <opaque_fragment>', FRAG_RIM + '\n#include <opaque_fragment>')
  }
  m.customProgramCacheKey = () => 'hive-chitin-v1'
  return m
}

/** per-bug FX state driving the uniforms (ChitinFx.cs) */
export class ChitinFx {
  constructor(materials, flashScale = 1) {
    this.mats = materials
    this.flashScale = flashScale
    this.reset(0)
  }
  reset(phase) {
    this.flash = 0; this.dissolve = 0; this.dissolveStart = -1; this.dissolveDur = 1; this.glow = 1; this.elite = false
    for (const m of this.mats) {
      const u = m.userData.hv
      u.uHvFlash.value = 0; u.uHvDissolve.value = 0; u.uHvGlow.value = 1; u.uHvPhase.value = phase; u.uHvEliteRim.value = 0
      u.uHvEmis.value.copy(m.userData.baseEmis)
      u.uHvEvoTint.value.setRGB(1, 1, 1); u.uHvPlates.value = 0; u.uHvEvoMix.value = 0
    }
  }
  setEvolution(look) {
    if (!look) return
    for (const m of this.mats) {
      const u = m.userData.hv
      u.uHvEvoTint.value.setRGB(look.tint[0], look.tint[1], look.tint[2])
      u.uHvPlates.value = look.plates
      u.uHvPlateCol.value.setRGB(look.plateColor[0], look.plateColor[1], look.plateColor[2], THREE.SRGBColorSpace)
      u.uHvEvoGlow.value.setRGB(look.glow[0] * CHITIN.emissionScale, look.glow[1] * CHITIN.emissionScale, look.glow[2] * CHITIN.emissionScale)
      u.uHvEvoMix.value = look.glowMix
    }
  }
  setElite(glow, rim) {
    this.elite = true
    for (const m of this.mats) {
      const u = m.userData.hv
      u.uHvEmis.value.setRGB(glow[0] * CHITIN.emissionScale, glow[1] * CHITIN.emissionScale, glow[2] * CHITIN.emissionScale)
      u.uHvRimElite.value.setRGB(rim[0], rim[1], rim[2], THREE.SRGBColorSpace)
      u.uHvEliteRim.value = 0.55
      u.uHvEvoMix.value = 0
    }
  }
  setGlow(g) { this.glow = g; for (const m of this.mats) m.userData.hv.uHvGlow.value = g }
  hit(amount) { this.flash = Math.max(this.flash, amount * this.flashScale) }
  beginDissolve(now, delay, dur) { this.dissolveStart = now + delay; this.dissolveDur = Math.max(0.05, dur) }
  update(dt, now) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 9)
    if (this.dissolveStart >= 0 && now >= this.dissolveStart) this.dissolve = Math.min(1, (now - this.dissolveStart) / this.dissolveDur)
    const mats = this.mats
    for (let i = 0; i < mats.length; i++) {
      const u = mats[i].userData.hv
      u.uHvFlash.value = this.flash
      u.uHvDissolve.value = this.dissolve
    }
  }
}
