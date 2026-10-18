// Hive Adapt (Project 0 port): the WORLD module. The elevated desert outpost (terrain, plateau + cliff, causeways, rampart,
// bastions, stairs, watchtowers, Core, shield dome, build pads, jump pads, barricade slots, props, hive breaches), the sun,
// sky and fog, two collision BVHs (walk / env), the capsule character controller, bug routes and the base progression look.
// Ported from HiveBuilder.Outpost.cs, Defence.cs, Scenes.cs, BaseLook.cs and Scripts/Defence/*.cs. See CONTRACT.md.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { fontBuffer, hdrBuffer } from './b64.js'
import { MeshBVH } from 'three-mesh-bvh'
import { U, yawToRot, DEG, col, clamp, clamp01, lerp, perlin, rng, moveTowards, easeOutQuad, easeOutBack } from './u.js'
import * as WG from './worldgeo.js'
import * as NAV from './nav.js'

const { K, uc, ulat, V3, qYaw } = WG
const PI = Math.PI
const ACCENT = col(0, 0.898, 1)
const AMBER = col(1, 0.69, 0)
const WARM = col(1, 0.6, 0.28)
const WALKABLE_NY = 0.64 // slope limit 50 deg
const STEP = 0.35

// base skins (HiveBuilder.BaseLook.cs): built material -> category -> Obsidian material (assets.js O_*)
const CATEGORY = {
  M_WallConcrete: 'Walls', M_ConcreteWall: 'Walls', M_Concrete: 'Floors', M_DarkMetal: 'Trims',
  M_GunMetal: 'Panels', M_RustMetal: 'Panels', M_Corrugated: 'Panels', M_Armour: 'Turrets', M_Grate: 'Pads',
  M_ContainerPaint: 'Props', M_Planks: 'Props', M_Sandbag: 'Props',
}
const OBSIDIAN = { Walls: 'O_Wall', Floors: 'O_Floor', Trims: 'O_Trim', Panels: 'O_Panel', Turrets: 'O_Trim', Pads: 'O_Grate', Props: 'O_Panel' }
const TURRET_SURFACES = ['Turrets', 'Trims', 'Panels', 'Props']
const stageName = level => (level >= 4 ? 'Obsidian' : level >= 3 ? 'Reinforced' : 'Standard')
const baseName = n => (n || '').replace(/\.\d+$/, '')

export function createWorld(G) {
  const lite = !!G.lite
  const A = G.assets
  const root = G.root
  const p0 = G.p0 || {}
  const asset = path => (p0.asset ? p0.asset(path) : path)
  const getScene = () => G.scene || p0.scene
  const getRenderer = () => G.renderer || p0.renderer
  const R = rng(1878)
  const Rr = (a, b) => a + R() * (b - a)

  // ------------------------------------------------------------------ the public object
  const world = {
    lite,
    fogDensityGame: 0.0105,
    core: { pos: U(0, K.H, 0), radius: 2.6 },
    spawns: NAV.spawnList(),
    gates: NAV.gateList(),
    breaches: NAV.breachList(),
    recovery: NAV.recoveryPoints(),
    pads: [], jumpPads: [], barricadeSlots: [],
    coreObj: null, domeObj: null, coreLight: null, sun: null,
    walkBVH: null, envBVH: null,
    /** Core presentation inputs (towers.js sets danger = 1 - hp/max, dead; kickCore() on hits) */
    coreFx: { danger: 0, heat: 0, dead: false, glowBoost: 1 },
    stage: { level: -1, name: 'Standard', sweeping: false, sweepRadius: 0, turretSkin: 'Standard' },
    autoShadowFocus: true,
    stats: {},
  }

  // ------------------------------------------------------------------ static batching (merge per material / zone)
  const batches = new Map()
  const special = {}
  const KEEP = ['position', 'normal', 'uv']
  /** a plain (non-interleaved, de-normalised) Float32 copy, so every batch member merges */
  function plainAttr(a) {
    const n = a.count, s = a.itemSize, arr = new Float32Array(n * s)
    for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = a.getComponent(i, k)
    return new THREE.BufferAttribute(arr, s)
  }
  function prep(geo, keep) {
    for (const name of Object.keys(geo.attributes)) {
      if (!KEEP.includes(name) && !(keep && keep.includes(name))) geo.deleteAttribute(name)
      else geo.setAttribute(name, plainAttr(geo.attributes[name]))
    }
    geo.morphAttributes = {}
    if (!geo.attributes.normal) geo.computeVertexNormals()
    if (!geo.attributes.uv) WG.worldBoxUV(geo)
    if (!geo.index) {
      const n = geo.attributes.position.count, idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n)
      for (let i = 0; i < n; i++) idx[i] = i
      geo.setIndex(new THREE.BufferAttribute(idx, 1))
    }
    return geo
  }
  /** add a game-space geometry to the static batch of material `matKey` (library name or a special key) */
  function addStatic(matKey, geo, o = {}) {
    if (!geo) return
    const zone = o.zone || null
    const band = zone ? Math.round((o.dist || 0) / 6) : 0
    const cast = o.cast !== false, recv = o.receive !== false
    const key = `${matKey}|${zone}|${band}|${cast}|${recv}`
    let b = batches.get(key)
    if (!b) batches.set(key, (b = { matKey, zone, cast, recv, geos: [], dist: 0 }))
    b.geos.push(prep(geo, o.keep))
    b.dist += o.dist || 0
  }
  const skinned = [] // { mesh, built, zone, dist } renderers the base look can re-skin
  function getMat(key) { return special[key] || A.mat(key) }
  function flushBatches() {
    let tris = 0
    for (const b of batches.values()) {
      const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false)
      if (!geo) { console.warn('world: merge failed for', b.matKey); continue }
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, getMat(b.matKey))
      mesh.name = 'W_' + b.matKey + (b.zone ? '_' + b.zone : '')
      mesh.castShadow = b.cast
      mesh.receiveShadow = b.recv
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      root.add(mesh)
      tris += geo.index.count / 3
      if (b.zone && CATEGORY[b.matKey]) skinned.push({ mesh, built: b.matKey, zone: b.zone, dist: b.dist / b.geos.length })
    }
    batches.clear()
    return tris
  }

  // ------------------------------------------------------------------ collision soups -> BVHs
  const soups = { walk: [], env: [] }
  const _v = new THREE.Vector3()
  function addCol(geo, where = 'both') {
    if (!geo) return
    const pos = geo.attributes.position, idx = geo.index
    const n = idx ? idx.count : pos.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const k = idx ? idx.getX(i) : i
      arr[i * 3] = pos.getX(k); arr[i * 3 + 1] = pos.getY(k); arr[i * 3 + 2] = pos.getZ(k)
    }
    if (where === 'both' || where === 'walk') soups.walk.push(arr)
    if (where === 'both' || where === 'env') soups.env.push(arr)
  }
  function buildBVH(list) {
    let total = 0
    for (const a of list) total += a.length
    const all = new Float32Array(total)
    let o = 0
    for (const a of list) { all.set(a, o); o += a.length }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(all, 3))
    const bvh = new MeshBVH(geo, { targetLeafSize: 8 })
    return bvh
  }
  const boxCol = (center, rotY, sx, sy, sz, where = 'walk') => {
    const g = new THREE.BoxGeometry(sx, sy, sz)
    g.applyMatrix4(new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rotY), V3(1, 1, 1)))
    addCol(g, where)
  }

  // ------------------------------------------------------------------ materials (special)
  function groundMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, name: 'M_Ground' })
    m.map = A.tex('cracked_concrete_albedo', { repeat: 0.25 })
    if (!lite) m.normalMap = A.tex('cracked_concrete_normal', { repeat: 0.25 })
    const uni = {
      tB: { value: A.tex('dry_ground_rocks_albedo') },
      tBn: { value: lite ? null : A.tex('dry_ground_rocks_normal') },
      tArmA: { value: lite ? null : A.tex('cracked_concrete_arm') },
      tArmB: { value: lite ? null : A.tex('dry_ground_rocks_arm') },
      uBTint: { value: col(0.92, 0.86, 0.78) },
    }
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni)
      sh.defines = sh.defines || {}
      if (!lite) sh.defines.GROUND_ARM = 1
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 blend;\nvarying vec2 vBlend;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBlend = blend;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tB;\nuniform vec3 uBTint;\nvarying vec2 vBlend;\n#ifdef GROUND_ARM\nuniform sampler2D tBn;\nuniform sampler2D tArmA;\nuniform sampler2D tArmB;\n#endif')
        .replace('#include <map_fragment>', [
          'vec2 gUvA = vMapUv; vec2 gUvB = vMapUv * 1.25;',
          'vec4 gA = texture2D( map, gUvA ); vec4 gB = texture2D( tB, gUvB ); gB.rgb *= uBTint;',
          'float gMacro = texture2D( tB, vMapUv * 0.071 + 0.31 ).g; float gMacro2 = texture2D( map, vMapUv * 0.043 ).r;',
          'float gLum = dot( gB.rgb, vec3( 0.333 ) );',
          'float gk = clamp( ( vBlend.x - 0.5 ) * 2.4 + 0.5 + ( gLum - 0.35 ) * 0.9, 0.0, 1.0 );',
          'float gWet = clamp( vBlend.y, 0.0, 1.0 );',
          'vec3 gCol = mix( gA.rgb, gB.rgb, gk ) * ( 0.78 + 0.3 * gMacro + 0.18 * gMacro2 );',
          '#ifdef GROUND_ARM',
          'vec4 gArmA = texture2D( tArmA, gUvA ); vec4 gArmB = texture2D( tArmB, gUvB );',
          'gCol *= mix( 1.0, mix( gArmA.r, gArmB.r, gk ), 0.6 );',
          '#endif',
          'gCol *= mix( 1.0, 0.5, gWet );',
          'diffuseColor.rgb *= gCol;',
        ].join('\n'))
        .replace('#include <roughnessmap_fragment>', [
          'float roughnessFactor = roughness;',
          '#ifdef GROUND_ARM',
          'roughnessFactor = mix( gArmA.g, gArmB.g, gk ) * 0.95 + 0.05;',
          '#endif',
          'roughnessFactor = mix( roughnessFactor, 0.3, gWet );',
        ].join('\n'))
        .replace('#include <normal_fragment_maps>', [
          '#ifdef USE_NORMALMAP_TANGENTSPACE',
          'vec3 gnA = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          '#ifdef GROUND_ARM',
          'vec3 gnB = texture2D( tBn, vNormalMapUv * 1.25 ).xyz * 2.0 - 1.0;',
          '#else',
          'vec3 gnB = gnA;',
          '#endif',
          'vec3 mapN = normalize( mix( gnA, gnB, gk ) );',
          'mapN.xy *= normalScale * ( 1.0 - 0.85 * gWet );',
          'normal = normalize( tbn * mapN );',
          '#endif',
        ].join('\n'))
    }
    m.customProgramCacheKey = () => 'hive-ground-' + (lite ? 1 : 0)
    return m
  }
  const uTime = { value: 0 }
  function chitinMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: col(0.1, 0.075, 0.06), roughness: 0.5, metalness: 0.05, vertexColors: true, name: 'M_Chitin' })
    if (!lite) { m.normalMap = A.tex('rock_boulder_dry_normal', { repeat: 0.6 }); m.normalScale.set(0.8, 0.8) }
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime
      sh.uniforms.uGlow = { value: new THREE.Color(4, 0.9, 0.15) }
      sh.uniforms.uRim = { value: col(0.9, 0.3, 0.08) }
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uGlow;\nuniform vec3 uRim;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuse, diffuseColor.rgb * 0.25, 0.35 );')
        .replace('#include <emissivemap_fragment>', [
          '#include <emissivemap_fragment>',
          'float hPulse = 0.72 + 0.28 * sin( uTime * 1.2 * 6.2832 * 0.35 + vViewPosition.x * 0.0 );',
          '#ifdef USE_COLOR_ALPHA',
          'totalEmissiveRadiance += uGlow * pow( vColor.a, 2.0 ) * hPulse * 0.55;',
          '#endif',
          'totalEmissiveRadiance += uRim * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 4.0 ) * 0.18;',
        ].join('\n'))
    }
    m.customProgramCacheKey = () => 'hive-chitin-' + (lite ? 1 : 0)
    return m
  }
  /** HiveAdapt/EnergyField: fresnel + cellular lattice + hit ripple, additive (Core Shield dome) */
  function energyFieldMaterial() {
    return new THREE.ShaderMaterial({
      name: 'M_EnergyDome',
      uniforms: {
        uColor: { value: new THREE.Color(0.22, 0.78, 1.6) }, uIntensity: { value: 1 }, uFlash: { value: 0 },
        uFresnel: { value: 1 }, uCell: { value: 1.1 }, uLattice: { value: 0.3 }, uBase: { value: 0.03 },
        uTime, uHitPos: { value: new THREE.Vector3(0, -1000, 0) }, uHitAge: { value: 10 },
        uLocal: { value: new THREE.Matrix4() },
      },
      vertexShader: [
        'uniform mat4 uLocal;',
        'varying vec3 vGame; varying vec3 vObj; varying vec3 vN; varying vec3 vV;',
        'void main() {',
        '  vObj = position; vGame = ( uLocal * vec4( position, 1.0 ) ).xyz;',
        '  vec4 mv = modelViewMatrix * vec4( position, 1.0 );',
        '  vN = normalize( normalMatrix * normal ); vV = -mv.xyz;',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; uniform float uIntensity, uFlash, uFresnel, uCell, uLattice, uBase, uTime, uHitAge; uniform vec3 uHitPos;',
        'varying vec3 vGame; varying vec3 vObj; varying vec3 vN; varying vec3 vV;',
        'vec3 hash3( vec3 p ) { p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) ); return fract( sin( p ) * 43758.5453 ); }',
        'vec2 cells( vec3 p ) {',
        '  vec3 i = floor( p ), f = fract( p ); float d1 = 8.0, d2 = 8.0;',
        '  for ( int z = -1; z <= 1; z ++ ) for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {',
        '    vec3 g = vec3( float( x ), float( y ), float( z ) ); vec3 o = hash3( i + g ); o = 0.5 + 0.4 * sin( uTime * 0.6 + 6.2831 * o );',
        '    float d = length( g + o - f ); if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;',
        '  }',
        '  return vec2( d1, d2 );',
        '}',
        'void main() {',
        '  float ndv = abs( dot( normalize( vN ), normalize( vV ) ) );',
        '  float fres = pow( 1.0 - ndv, 3.0 );',
        '  vec2 c = cells( vGame * uCell * 0.55 );',
        '  float edge = 1.0 - smoothstep( 0.0, 0.09, c.y - c.x );',
        '  float shimmer = 0.5 + 0.5 * sin( uTime * 1.7 + c.x * 9.0 );',
        '  float a = uBase + fres * uFresnel * 0.3 + edge * uLattice * ( 0.22 + 0.45 * fres ) + shimmer * 0.012;',
        '  float hd = distance( vGame, uHitPos );',
        '  float ring = exp( -pow( ( hd - uHitAge * 7.0 ) * 1.6, 2.0 ) ) * exp( -uHitAge * 2.2 );',
        '  float spot = exp( -hd * 0.9 ) * exp( -uHitAge * 4.0 );',
        '  float lowFade = smoothstep( -0.05, 0.25, vObj.y + 0.033 );',
        '  vec3 col = uColor * ( a * uIntensity + ( ring + spot ) * 0.7 + uFlash * ( 0.12 + 0.35 * fres ) ) * lowFade * 0.55;',
        '  gl_FragColor = vec4( col, 1.0 );',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  }
  /** billboard smoke + fire puffs (one instanced draw): premultiplied alpha, smoke blends over, fire adds */
  function smokeMaterial(columns) {
    return new THREE.ShaderMaterial({
      name: 'FX_Smoke',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCols: { value: columns }, uSun: { value: new THREE.Vector3() } }]),
      vertexShader: [
        'uniform float uTime; uniform vec3 uCols[3];',
        'attribute vec4 aSeed;',
        'varying vec2 vUv; varying float vAlpha; varying float vKind; varying float vSeed; varying float vAge;',
        '#include <fog_pars_vertex>',
        'void main() {',
        '  vUv = uv; vKind = aSeed.w; vSeed = aSeed.z;',
        '  vec3 base = aSeed.x < 0.5 ? uCols[0] : aSeed.x < 1.5 ? uCols[1] : uCols[2];',
        '  float life = vKind > 0.5 ? 1.1 : 11.0;',
        '  float age = fract( uTime / life + aSeed.y ); vAge = age;',
        '  vec3 c; float size;',
        '  if ( vKind < 0.5 ) {',
        '    float h = age * 24.0;',
        '    c = base + vec3( h * 0.32 + sin( aSeed.z * 6.28 + uTime * 0.3 ) * 0.8 * age, h + 1.2, -h * 0.12 + cos( aSeed.z * 9.0 ) * 1.4 * age );',
        '    size = mix( 1.8, 9.5, sqrt( age ) );',
        '    vAlpha = smoothstep( 0.0, 0.1, age ) * ( 1.0 - smoothstep( 0.45, 1.0, age ) ) * 0.62;',
        '  } else {',
        '    c = base + vec3( sin( aSeed.z * 20.0 ) * 0.45, age * 1.4 + 0.15, cos( aSeed.z * 13.0 ) * 0.45 );',
        '    size = mix( 1.1, 0.25, age );',
        '    vAlpha = ( 1.0 - age ) * smoothstep( 0.0, 0.12, age );',
        '  }',
        '  vec4 mvPosition = modelViewMatrix * vec4( c, 1.0 );',
        '  float sc = length( modelMatrix[ 0 ].xyz );',
        '  float rot = aSeed.z * 6.28 + uTime * 0.15 * ( aSeed.z - 0.5 );',
        '  vec2 q = vec2( position.x * cos( rot ) - position.y * sin( rot ), position.x * sin( rot ) + position.y * cos( rot ) );',
        '  mvPosition.xy += q * size * sc;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <fog_vertex>',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec2 vUv; varying float vAlpha; varying float vKind; varying float vSeed; varying float vAge;',
        '#include <fog_pars_fragment>',
        'float h21( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }',
        'float vnoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y ); }',
        'void main() {',
        '  vec2 p = vUv * 2.0 - 1.0; float r = length( p );',
        '  float n = vnoise( vUv * 3.5 + vSeed * 17.0 ) * 0.6 + vnoise( vUv * 7.0 - vSeed * 5.0 ) * 0.4;',
        '  float a = smoothstep( 1.0, 0.15, r + ( n - 0.5 ) * 0.7 ) * vAlpha;',
        '  if ( a < 0.004 ) discard;',
        '  vec3 col;',
        '  if ( vKind < 0.5 ) col = vec3( 0.075, 0.07, 0.068 ) * ( 0.75 + 0.5 * n ) + vec3( 0.06, 0.035, 0.02 ) * clamp( p.x + 0.3, 0.0, 1.0 );',
        '  else col = mix( vec3( 3.2, 1.3, 0.35 ), vec3( 1.6, 0.35, 0.06 ), vAge );',
        '  vec4 o = vec4( col, 1.0 );',
        '  gl_FragColor = o;',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '  float fogF = 0.0; vec3 fogC = vec3( 0.0 );',
        '  #if defined( USE_FOG ) && defined( FOG_EXP2 )',
        '  fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth ); fogC = fogColor;',
        '  #endif',
        '  if ( vKind < 0.5 ) gl_FragColor = vec4( mix( gl_FragColor.rgb, fogC, fogF ) * a, a );',
        '  else gl_FragColor = vec4( gl_FragColor.rgb * a * ( 1.0 - fogF ), 0.0 );',
        '}',
      ].join('\n'),
      transparent: true, depthWrite: false, fog: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
  }

  // ------------------------------------------------------------------ model helpers
  const models = {}
  async function loadModel(name) {
    if (models[name]) return models[name]
    const gltf = await A.glb(name)
    gltf.scene.updateMatrixWorld(true)
    const parts = []
    const nodes = {}
    gltf.scene.traverse(o => {
      if (o.name) nodes[o.name] = o.matrixWorld.clone()
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const g = o.geometry
      if (mats.length > 1 && g.groups.length) {
        for (const gr of g.groups) {
          const sub = g.clone()
          sub.setIndex(Array.from(g.index.array.slice(gr.start, gr.start + gr.count)))
          parts.push({ geo: sub.applyMatrix4(o.matrixWorld), mat: baseName(mats[gr.materialIndex].name) })
        }
      } else parts.push({ geo: g.clone().applyMatrix4(o.matrixWorld), mat: baseName(mats[0].name) })
    })
    models[name] = { parts, nodes }
    return models[name]
  }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion()
  const propMatrix = (pos, rotY, scale) => new THREE.Matrix4().compose(pos, _q.setFromAxisAngle(V3(0, 1, 0), rotY), V3(scale, scale, scale))
  /**
   * Place a loaded model statically (merged into the batches). pos game space, yaw = Unity yaw (deg).
   * o.col: 'both' | 'walk' | 'env' | null; o.mat: override material key; o.zone/o.dist: base-look zone.
   */
  function prop(name, pos, yaw, scale = 1, o = {}) {
    const m = models[name]
    if (!m) return
    const M = propMatrix(pos, yawToRot(yaw), scale)
    for (const p of m.parts) {
      const g = p.geo.clone().applyMatrix4(M)
      const key = o.mat || p.mat
      if (o.col) addCol(g, o.col)
      if (key === 'M_Chitin' || o.mat === 'chitin') addStatic('chitin', g, { keep: ['color'], cast: o.cast })
      else if (key === 'M_CliffRock' || key === 'M_Rock') addStatic(key, WG.faceBoxUV(g), { zone: o.zone, dist: o.dist, cast: o.cast })
      else addStatic(key, WG.worldBoxUV(g), { zone: o.zone, dist: o.dist, cast: o.cast })
    }
  }

  // ------------------------------------------------------------------ build
  async function build() {
    const t0 = performance.now()
    const scene = getScene()
    const renderer = getRenderer()
    if (renderer && A.setRenderer) A.setRenderer(renderer)
    special.ground = groundMaterial()
    special.chitin = chitinMaterial()

    const MODEL_NAMES = ['SM_BuildPad', 'SM_ContainerA', 'SM_Crate', 'SM_FuelTank', 'SM_HiveBreach', 'SM_HiveSpire', 'SM_JerseyBarrier', 'SM_LightPole',
      'SM_RockA', 'SM_RockB', 'SM_RockC', 'SM_RubbleA', 'SM_RubbleB', 'SM_WallA', 'SM_WallB', 'SM_Watchtower']
    const loads = Promise.all(MODEL_NAMES.map(loadModel))
    const coreLoad = A.clone('SM_FrontierCore')
    const skyLoad = loadSky(scene, renderer).catch(e => console.warn('world: sky failed', e))
    const fontLoad = loadFont().catch(() => null)

    // ---- terrain, plateau, cliff (procedural, meanwhile the models load)
    const plain = WG.plainBuf(lite).geometries({ blend: true })[0]
    addCol(plain, 'both')
    addStatic('ground', plain, { keep: ['blend'], cast: false })
    const skirt = WG.skirtBuf().geometries({ blend: true })[0]
    addCol(skirt, 'walk')
    addStatic('ground', skirt, { keep: ['blend'], cast: false })
    const pl = WG.plateauBuf(lite)
    const [cap, cliff] = pl.buf.geometries({ blend: true, weld: pl.weld })
    addCol(cap, 'both'); addCol(cliff, 'both')
    addStatic('ground', cap, { keep: ['blend'], cast: false })
    cliff.deleteAttribute('blend')
    addStatic('M_CliffRock', cliff)
    // the map edge: invisible walls just inside the 200 m square (walk only)
    for (const [x, z, sx, sz] of [[99.6, 0, 0.4, 200], [-99.6, 0, 0.4, 200], [0, 99.6, 200, 0.4], [0, -99.6, 200, 0.4]]) boxCol(V3(x, 20, z), 0, sx, 60, sz, 'walk')

    // ---- causeways, rampart, breach patches
    for (const yaw of K.RAMPS) {
      const [road, walls] = WG.rampBuf(yaw).geometries()
      addCol(road, 'both'); addCol(walls, 'both')
      addStatic('M_Concrete', road)
      addStatic('M_WallConcrete', walls)
    }
    const [rw, rt] = WG.rampartBuf().geometries()
    addCol(rw, 'both'); addCol(rt, 'both')
    addStatic('M_WallConcrete', rw, { zone: 'base', dist: 13 })
    addStatic('M_Concrete', rt, { zone: 'base', dist: 13 })
    const [plates, beams] = WG.breachPatchBuf().geometries()
    addCol(plates, 'both'); addCol(beams, 'both')
    addStatic('M_RustMetal', plates, { zone: 'base', dist: 19 })
    addStatic('M_DarkMetal', beams, { zone: 'base', dist: 19 })

    await loads
    placeProps()
    await buildCore(await coreLoad)
    buildPads()
    world.envBVH = buildBVH(soups.env)
    buildJumpPads()
    buildBarricadeSlots()
    world.walkBVH = buildBVH(soups.walk)
    const colTris = { walk: world.walkBVH.geometry.index.count / 3, env: world.envBVH.geometry.index.count / 3 }
    soups.walk.length = 0; soups.env.length = 0
    buildStageParts()
    buildFx()
    const staticTris = flushBatches()
    for (const k of Object.keys(models)) { for (const part of models[k].parts) part.geo.dispose(); delete models[k] }
    await fontLoad
    buildPadTags()
    buildLights(scene, renderer)
    await skyLoad
    setStage(0, { instant: true })
    updateShadows(world.core.pos)
    const cam = G.camera || p0.camera
    if (renderer && scene && cam) await prewarm(cam)
    world.stats = { buildMs: Math.round(performance.now() - t0), staticTris, colTris }
    return world
  }
  /** compile every program the base look can need (Obsidian skins, stage parts, dome) so a Core upgrade never hitches */
  async function prewarm(camera) {
    const renderer = getRenderer(), scene = getScene()
    if (!renderer || !scene || !camera) return
    for (const e of skinned) applySkin(e, 'Obsidian')
    for (const sp of stageParts) sp.obj.visible = true
    if (strips) strips.material = A.mat('M_EmissiveCyan')
    const dome = world.domeObj
    if (dome) dome.visible = true
    if (sweepMesh) sweepMesh.visible = true
    try {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera)
      else renderer.compile(scene, camera)
    } catch (e) { console.warn('world: prewarm failed', e) }
    if (dome) dome.visible = false
    if (sweepMesh) sweepMesh.visible = false
    skinState.level = -1
    setStage(Math.max(0, world.stage.level), { instant: true })
  }

  // ------------------------------------------------------------------ props
  function placeProps() {
    const H = K.H
    const Top = (yaw, r) => uc(yaw, r, H)
    const Low = (yaw, r) => { const p = uc(yaw, r); p.y = WG.plainHeight(p.x, p.z); return p }
    const g = u => WG.toGame(u.clone())
    // yard: the container (a platform) and the crate stack beside it
    prop('SM_ContainerA', g(Top(-150, 13)), -150 + 90, 1, { col: 'both' })
    prop('SM_Crate', g(Top(-165, 9.5)), Rr(0, 360), 1.05, { col: 'both' })
    prop('SM_Crate', g(Top(-165, 9.5)).add(V3(0, 0.8, 0)), -158, 0.95, { col: 'both' })
    // watchtowers (friendly structures: walkable, never stop shots)
    K.WATCH.forEach(w => prop('SM_Watchtower', g(uc(w.bearing, w.r, H)), w.gapYaw, 1, { col: 'walk', zone: 'base', dist: w.r + 1.5 }))
    // rubble at the cliff foot under each patched breach
    for (const b of K.BREACHES) prop('SM_RubbleA', g(Low(b + 4, WG.cliffRadius(b + 4, 0) + 1.6)), Rr(0, 360), 1)
    // the plain
    for (const [a, r] of [[-70, 30], [-20, 31], [20, 30], [80, 31.5], [150, 29], [-160, 30], [-130, 36], [120, 38]]) prop('SM_JerseyBarrier', g(Low(a, r)), a + 90 + Rr(-15, 15), 1, { col: 'both' })
    prop('SM_ContainerA', g(Low(-88, 36)), 20, 1, { col: 'both' })
    prop('SM_ContainerA', g(Low(170, 38)), -60, 1, { col: 'both' })
    prop('SM_ContainerA', g(Low(92, 44)), 110, 1, { col: 'both' })
    prop('SM_FuelTank', g(Low(160, 33)), 250, 1, { col: 'both' })
    prop('SM_FuelTank', g(Low(165, 34.5)), 256, 1, { col: 'both' })
    if (!lite) for (const [a, r] of [[-60, 40], [0, 38], [25, 42], [70, 40], [-175, 42], [140, 45], [-120, 46], [-10, 55]]) prop(R() > 0.5 ? 'SM_RubbleA' : 'SM_RubbleB', g(Low(a, r)), Rr(0, 360), Rr(0.9, 1.3))
    // outer ruins ring
    let wi = 0
    for (let a = 0; a < 360; a += 9, wi++) {
      let lane = false
      for (const s of K.RAMPS) lane = lane || WG.angleTo(a, s) < 12
      for (const s of K.SPAWNS) lane = lane || WG.angleTo(a, s) < 8
      if (lane || wi % 3 === 2) continue
      if (lite && wi % 2) continue
      const p = g(Low(a, 64 + Rr(-1.5, 1.5)))
      if (wi % 5 === 3) { prop('SM_RubbleA', p, Rr(0, 360), 1.1); continue }
      prop(wi % 2 === 1 ? 'SM_WallB' : 'SM_WallA', p, a + Rr(-6, 6), 1, { col: 'both' })
    }
    // big boulders on the hills
    for (let i = 0; i < 18; i++) {
      const a = i * 20 + Rr(-7, 7), r = Rr(70, 86)
      let near = false
      for (const s of K.SPAWNS) near = near || WG.angleTo(a, s) < 12
      if (near) continue
      const m = i % 3 === 0 ? 'SM_RockB' : i % 3 === 1 ? 'SM_RockA' : 'SM_RockC'
      prop(m, g(Low(a, r)).add(V3(0, -0.4, 0)), Rr(0, 360), Rr(1.6, 3), { col: 'both', mat: 'M_CliffRock' })
    }
    // boulders at the cliff foot and a few set into the face (clear of causeways and climb routes)
    let ri = 0
    for (let yaw = 0; yaw < 360; yaw += 7.5, ri++) {
      const y = yaw + Rr(-2.5, 2.5)
      let nearRamp = false, nearBreach = false
      for (const a of K.RAMPS) nearRamp = nearRamp || WG.angleTo(y, a) < 17
      for (const a of K.BREACHES) nearBreach = nearBreach || WG.angleTo(y, a) < 11
      if (nearRamp || nearBreach) continue
      const m = ri % 3 === 0 ? 'SM_RockB' : ri % 3 === 1 ? 'SM_RockA' : 'SM_RockC'
      const baseR = WG.cliffRadius(y, 0)
      prop(m, g(uc(y, baseR + Rr(0.1, 1.1), Rr(-0.7, -0.3))), Rr(0, 360), Rr(0.8, 1.5), { col: 'both', mat: 'M_CliffRock' })
      if (ri % 4 === 1 && !lite) {
        const hy = Rr(1.8, 4.5)
        prop(ri % 8 === 1 ? 'SM_RockA' : 'SM_RockC', g(uc(y, WG.cliffRadius(y, hy) - 0.35, hy)), Rr(0, 360), Rr(1.1, 1.9), { mat: 'M_CliffRock' })
      }
    }
    // sodium lamps inside the walls and at the causeway feet
    const polePlaces = [Top(95, 13.8), Top(-80, 13.5), Top(172, 13), Top(4, 12.5)]
    for (const s of K.RAMPS) polePlaces.push(Low(s, K.RAMP_FOOT - 1.5).addScaledVector(ulat(s), K.RAMP_W / 2 + K.RAMP_WALL + 1))
    world.poles = polePlaces.map((p, i) => {
      const yaw = Math.atan2(p.x, p.z) / DEG + 180
      const gp = g(p)
      prop('SM_LightPole', gp, yaw, 1, { cast: true })
      const c = new THREE.CylinderGeometry(0.2, 0.2, 6, 8).translate(gp.x, gp.y + 3, gp.z)
      addCol(c, 'walk')
      const flat = V3(gp.x, 0, gp.z).normalize()
      return { index: i, pos: gp, light: V3(gp.x, gp.y + 6.6, gp.z).addScaledVector(flat, -0.6) }
    })
    // hive breaches and spires at the spawns
    world.spawns.forEach(sp => {
      const su = V3(sp.pos.x, sp.pos.y, -sp.pos.z)
      const out = V3(su.x, 0, su.z).normalize()
      const side = new THREE.Vector3().crossVectors(V3(0, 1, 0), out)
      const P = v => { v.y = WG.plainHeight(v.x, v.z); return g(v) }
      prop('SM_HiveBreach', P(su.clone().addScaledVector(out, 1.5)), Math.atan2(out.x, out.z) / DEG, 1.25, { mat: 'chitin' })
      prop('SM_HiveSpire', P(su.clone().addScaledVector(out, 5).addScaledVector(side, 5.5)), Rr(0, 360), Rr(1.2, 1.6), { mat: 'chitin', col: 'both' })
      prop('SM_HiveSpire', P(su.clone().addScaledVector(out, 6.5).addScaledVector(side, -4.5)), Rr(0, 360), Rr(0.9, 1.3), { mat: 'chitin', col: 'both' })
      prop('SM_HiveSpire', P(su.clone().addScaledVector(out, 9).addScaledVector(side, 1)), Rr(0, 360), Rr(1.6, 2.1), { mat: 'chitin', col: 'both' })
    })
    // smoke columns: rubble at their feet
    world.smokeSpots = [Low(-150, 34), Low(105, 33), Top(188, 13.8)].map(p => g(p))
    for (const p of world.smokeSpots) prop('SM_RubbleB', p, Rr(0, 360), 1.3)
  }

  // ------------------------------------------------------------------ Core + dome
  async function buildCore(obj) {
    obj.position.copy(world.core.pos)
    A.dress(obj)
    // the Core's energy reads as saturated accent cyan (as with the original's bloom): not tone-mapped
    const glowMat = A.mat('M_EmissiveCyan').clone()
    const orbMat = A.mat('M_CoreEnergy').clone()
    glowMat.toneMapped = false; orbMat.toneMapped = false
    const parts = {}
    obj.traverse(o => {
      if (o.name) parts[o.name] = parts[o.name] || o
      if (!o.isMesh) return
      WG.boxUV(o.geometry)
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const swapped = mats.map(m => (m.name === 'M_EmissiveCyan' ? glowMat : m.name === 'M_CoreEnergy' ? orbMat : m))
      o.material = Array.isArray(o.material) ? swapped : swapped[0]
      if (mats.some(m => m.name === 'M_Glass' || m.name === 'M_CoreEnergy' || m.name === 'M_EmissiveCyan')) o.castShadow = false
    })
    root.add(obj)
    world.coreObj = obj
    const coreParts = { base: parts.Core_Base, orb: parts.Core_Orb, ringA: parts.Core_RingA, ringB: parts.Core_RingB }
    world.coreParts = coreParts
    coreState.orbRest = coreParts.orb ? coreParts.orb.position.y : 2.15
    coreState.glowMat = glowMat
    coreState.orbMat = orbMat
    // the Core frame is in the "core" zone of the base look (its trims and panels turn Obsidian)
    if (coreParts.base) coreParts.base.traverse(o => {
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m, i) => { if (CATEGORY[m.name]) skinned.push({ mesh: o, slot: Array.isArray(o.material) ? i : -1, built: m.name, zone: 'core', dist: 0.7 * 2.8 }) })
    })
    // capsule collider (r 2.5, centre +2.3)
    const cap = new THREE.CapsuleGeometry(2.5, 0.2, 4, 12).translate(0, K.H + 2.3, 0)
    addCol(cap, 'walk')
    // shield dome: ellipsoid radii 7/6/7 centred +0.2 (hidden until a shield is bought)
    const dm = energyFieldMaterial()
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, lite ? 32 : 56, lite ? 16 : 28), dm)
    dome.position.set(0, K.H + 0.2, 0)
    dome.scale.set(7, 6, 7)
    dome.visible = false
    dome.renderOrder = 10
    dome.frustumCulled = false
    root.add(dome)
    dome.updateMatrix()
    dm.uniforms.uLocal.value.copy(dome.matrix)
    world.domeObj = dome
  }

  // ------------------------------------------------------------------ build pads
  const LABEL = { Inner0: 'Yard A', Inner1: 'Yard B', Breach0: 'Wall W', Breach1: 'Wall E', Core0: 'Core NW', Core1: 'Core NE', Core2: 'Core SW', Core3: 'Core SE', Tower0: 'Tower W', Tower1: 'Tower S' }
  const padLabel = id => LABEL[id] || (id.length === 6 && id.startsWith('Gate') ? 'Gate ' + String.fromCharCode(65 + +id[4]) + '-' + id[5] : id)
  let ringTex = null
  function buildPads() {
    const list = []
    K.RAMPS.forEach((yaw, gi) => list.push({ pos: uc(yaw, 12.2, K.H).addScaledVector(ulat(yaw), -5.2), yaw, id: 'Inner' + gi }))
    const bs = WG.bastions()
    for (const b of bs) if (b.id.startsWith('Breach')) list.push({ pos: b.pos.clone(), yaw: b.yaw, id: b.id })
    for (const b of bs) if (b.id.endsWith('R')) list.push({ pos: WG.gateTurretSpot(b.pos, b.yaw, b.id), yaw: b.yaw, id: b.id })
    for (const b of bs) if (b.id.endsWith('L')) list.push({ pos: WG.gateTurretSpot(b.pos, b.yaw, b.id), yaw: b.yaw, id: b.id })
    for (const [id, bearing] of K.CORE_PADS) list.push({ pos: uc(bearing, K.CORE_PAD_R, K.H), yaw: bearing, id })
    K.WATCH.forEach(w => {
      const base = uc(w.bearing, w.r, K.H)
      list.push({ pos: base.add(V3(0, K.WATCH_DECK, -0.95).applyQuaternion(qYaw(w.gapYaw))), yaw: w.gapYaw + 180, id: w.id })
    })
    ringTex = WG.padRingTexture()
    const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2)
    world.pads = list.map((p, index) => {
      const id = p.id
      const scale = id.startsWith('Gate') || id.startsWith('Core') || id.startsWith('Tower') ? 0.8 : 1
      const reach = id.startsWith('Tower') ? 'deck' : id.startsWith('Breach') || id.startsWith('Gate') ? 'wall' : 'yard'
      const zone = id.startsWith('Core') ? 'core' : id.startsWith('Gate') || id.startsWith('Inner') ? 'gates' : 'base'
      const base = WG.toGame(p.pos.clone())
      const rotY = yawToRot(p.yaw)
      prop('SM_BuildPad', base, p.yaw, scale, { zone, dist: Math.hypot(base.x, base.z) + 0.7 * 1.5 * scale })
      boxCol(base.clone().add(V3(0, 0.1, 0)), rotY, 3 * scale, 0.2, 3 * scale, 'walk')
      const group = new THREE.Group()
      group.name = 'Pad_' + index + '_' + id
      group.position.copy(base)
      group.rotation.y = rotY
      root.add(group)
      const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, color: AMBER.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.y = 0.215 * scale + 0.005
      ring.scale.setScalar(3.3 * scale)
      ring.renderOrder = 2
      group.add(ring)
      return {
        index, id, label: padLabel(id), pos: base.clone().add(V3(0, 0.2, 0)), base, yawDeg: p.yaw, rotY, scale, reach,
        preinstalled: id.startsWith('Gate') && id.endsWith('L'), ring, tag: null, group, zone,
        occupied: false, focus: 0, highlight: 0,
      }
    })
  }
  async function loadFont() {
    if (typeof FontFace === 'undefined' || !globalThis.fonts) return
    const f = new FontFace('Chakra Petch', await fontBuffer(asset, 'ChakraPetch-Bold'), { weight: '700' })
    await f.load()
    globalThis.fonts.add(f)
  }
  /** flat amber name tags (one OffscreenCanvas atlas, one quad per pad lying on its inner edge) */
  function buildPadTags() {
    if (typeof OffscreenCanvas === 'undefined') return
    const ROW = 64, W = 512, PPM = 128 // pixels per metre: text 0.3 m = 38 px
    const cv = new OffscreenCanvas(W, ROW * world.pads.length)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.font = '700 40px "Chakra Petch", "Rajdhani", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    try { ctx.letterSpacing = '4px' } catch (e) { /* older engines */ }
    ctx.fillStyle = 'rgba(255,176,0,0.92)'
    const widths = world.pads.map((p, i) => {
      const text = p.label.toUpperCase()
      const w = Math.min(W - 8, ctx.measureText(text).width + 12)
      ctx.fillText(text, W / 2, i * ROW + ROW / 2 + 2, W - 8)
      return w
    })
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) })
    const basis = new THREE.Matrix4().makeBasis(V3(-1, 0, 0), V3(0, 0, 1), V3(0, 1, 0)) // text right = local -X, up = outward +Z, facing up
    world.pads.forEach((p, i) => {
      const wPx = widths[i], wM = wPx / PPM, hM = ROW / PPM
      const geo = new THREE.PlaneGeometry(wM, hM)
      const u0 = (W - wPx) / 2 / W, u1 = (W + wPx) / 2 / W, v1 = 1 - i * ROW / cv.height, v0 = 1 - (i + 1) * ROW / cv.height
      const uv = geo.attributes.uv
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) < 0.5 ? u0 : u1, uv.getY(k) < 0.5 ? v0 : v1)
      geo.applyMatrix4(basis)
      const tag = new THREE.Mesh(geo, mat)
      tag.position.set(0, 0.235 * p.scale + 0.006, -1.15 * p.scale)
      tag.renderOrder = 3
      p.group.add(tag)
      p.tag = tag
    })
  }

  // ------------------------------------------------------------------ jump pads
  const JUMP_SPOTS = [
    ['North', 15, 34, true, 15], ['South', -160, 33, true, -160], ['GateA', -76, 9, false, -65],
    ['GateB', 86, 9, false, 73], ['BreachWest', -100, 9, false, -100], ['BreachEast', 108, 9, false, 107],
  ]
  function buildJumpPads() {
    const spots = []
    const tgt = {}
    for (const [id, yaw, r, outside, landYaw] of JUMP_SPOTS) {
      let p = uc(yaw, r)
      p.y = outside ? WG.plainHeight(p.x, p.z) : K.H
      if (outside) {
        for (let rr = r; rr <= r + 8; rr += 0.5) {
          const q = uc(yaw, rr)
          q.y = WG.plainHeight(q.x, q.z)
          p = q
          let blocked = false
          for (const dy of [2.4, 2.9, 3.4]) {
            const c = V3(q.x, q.y + dy, -q.z)
            const h = world.envBVH.closestPointToPoint(c, tgt, 0, 2.2)
            if (h && h.distance < 2.2) { blocked = true; break }
          }
          if (!blocked) break
        }
      }
      spots.push({ id, pos: p, land: uc(landYaw, 16.7, K.WALL_TOP), outside })
    }
    K.WATCH.forEach(w => {
      const base = uc(w.bearing, w.r, K.H)
      const id = 'Watchtower' + (w.id === 'Tower0' ? 'W' : 'S')
      spots.push({ id, pos: base.clone().add(uc(w.gapYaw, w.jumpDist)), land: base.clone().add(V3(0, K.WATCH_DECK, 1.2).applyQuaternion(qYaw(w.gapYaw))), outside: false })
    })
    const bodyIn = new WG.MeshBuf(3), bodyOut = new WG.MeshBuf(3), marks = new WG.MeshBuf(2)
    const glowBase = A.mat('M_Interactable')
    const beamTex = beamTexture()
    world.jumpPads = spots.map((s, i) => {
      const flat = s.land.clone().sub(s.pos).setY(0)
      const yaw = Math.atan2(flat.x, flat.z) / DEG
      const rot = qYaw(yaw)
      const sc = s.outside ? 1.45 : 1
      WG.jumpPadBodyBuf(s.outside ? bodyOut : bodyIn, s.pos, rot, sc)
      // landing mark: hazard square with a dark plate
      marks.Box(0, 0, s.land.clone().add(V3(0, 0.012, 0)), rot, V3(1.3, 0.02, 1.3))
      marks.Box(1, 1, s.land.clone().add(V3(0, 0.025, 0)), rot, V3(1.0, 0.02, 1.0))
      const pos = WG.toGame(s.pos.clone()), land = WG.toGame(s.land.clone())
      const rotY = yawToRot(yaw)
      boxCol(pos.clone().add(V3(0, -0.1, 0)), rotY, 2.1 * sc, 0.6, 2.1 * sc, 'walk')
      const group = new THREE.Group()
      group.name = 'JumpPad_' + s.id
      group.position.copy(pos)
      group.rotation.y = rotY
      root.add(group)
      const glowMat = glowBase.clone()
      const glow = new THREE.Mesh(WG.jumpPadGlowBuf(sc).geometries({ mirror: 'x' })[0], glowMat)
      glow.renderOrder = 1
      group.add(glow)
      const jp = { index: i, id: s.id, pos, land, radius: 1.1 * sc, outside: s.outside, glow, glowMat, ring: null, ringMat: null, column: null, group, yawDeg: yaw, kick: 0, cooldown: 0.8, apexAbove: 3.5 }
      jp.launchVelocity = (from, gravity = 22, out = new THREE.Vector3()) => {
        const apex = Math.max(from.y, jp.land.y) + jp.apexAbove
        const vy = Math.sqrt(2 * gravity * (apex - from.y))
        const t = vy / gravity + Math.sqrt(2 * Math.max(0, apex - jp.land.y) / gravity)
        return out.set((jp.land.x - from.x) / t, vy, (jp.land.z - from.z) / t)
      }
      if (s.outside) {
        // emissive ring laid on the plain, and the 30 m light column
        const rb = new WG.MeshBuf(1)
        const r0 = 1.1 * sc + 0.25, r1 = r0 + 0.32, seg = 40
        const on = (a, r) => { const l = V3(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(rot).add(s.pos); l.y = WG.plainHeight(l.x, l.z) + 0.05; return l }
        for (let k = 0; k < seg; k++) {
          const a0 = k * 2 * PI / seg, a1 = (k + 1) * 2 * PI / seg
          rb.Quad(0, rb.V(on(a0, r0), k / seg, 0), rb.V(on(a1, r0), (k + 1) / seg, 0), rb.V(on(a1, r1), (k + 1) / seg, 1), rb.V(on(a0, r1), k / seg, 1), V3(0, 1, 0))
        }
        const ringMat = glowBase.clone()
        const ring = new THREE.Mesh(rb.geometries()[0], ringMat)
        root.add(ring)
        jp.ring = ring; jp.ringMat = ringMat
        const column = new THREE.Mesh(columnGeometry(30, 1.4), new THREE.MeshBasicMaterial({ map: beamTex, color: AMBER.clone().multiplyScalar(1.6), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
        column.position.y = 0.2
        group.add(column)
        jp.column = column
      }
      return jp
    })
    const [cIn, gIn, hIn] = bodyIn.geometries(), [cOut, gOut, hOut] = bodyOut.geometries()
    addStatic('M_Concrete', cIn, { zone: 'base', dist: 9.5 }); addStatic('M_Grate', gIn, { zone: 'base', dist: 9.5 }); addStatic('M_Hazard', hIn)
    addStatic('M_Concrete', cOut, { zone: 'base', dist: 36 }); addStatic('M_Grate', gOut, { zone: 'base', dist: 36 }); addStatic('M_Hazard', hOut)
    const [mh, md] = marks.geometries()
    addStatic('M_Hazard', mh, { cast: false }); addStatic('M_DarkMetal', md, { zone: 'base', dist: 16, cast: false })
  }
  function beamTexture() {
    const N = 64, d = new Uint8Array(N * 4)
    for (let i = 0; i < N; i++) { const x = (i + 0.5) / N * 2 - 1; const f = Math.round(Math.pow(Math.max(0, 1 - Math.abs(x)), 1.6) * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = f; d[i * 4 + 3] = 255 }
    const t = new THREE.DataTexture(d, N, 1)
    t.magFilter = THREE.LinearFilter; t.needsUpdate = true
    return t
  }
  /** three crossed vertical quads (rendered double-sided), vertex alpha 0.5 -> 0.42 at 15 m -> 0.2 at 25.5 m -> 0 at 30 m */
  function columnGeometry(height, width) {
    const rows = [[0, 0.5], [height * 0.5, 0.42], [height * 0.85, 0.2], [height, 0]]
    const pos = [], uv = [], colr = [], idx = []
    for (let k = 0; k < 3; k++) {
      const a = k * PI / 3, hx = Math.cos(a) * width / 2, hz = Math.sin(a) * width / 2
      const b0 = pos.length / 3
      rows.forEach(([h, al]) => {
        pos.push(-hx, h, -hz, hx, h, hz)
        uv.push(0, h / height, 1, h / height)
        colr.push(1, 1, 1, al, 1, 1, 1, al)
      })
      for (let r = 0; r < rows.length - 1; r++) { const a0 = b0 + r * 2; idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2) }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 4))
    g.setIndex(idx)
    return g
  }

  // ------------------------------------------------------------------ barricade slots (empty look; tiers are the lead's)
  function buildBarricadeSlots() {
    const defs = [['CausewayA', 'Causeway A', -40, 31, K.RAMP_W / 2 - 0.3, K.RAMP_TAN], ['CausewayB', 'Causeway B', 48, 31, K.RAMP_W / 2 - 0.3, K.RAMP_TAN],
      ['GateA', 'Gate A', -40, 21.4, K.RAMP_W / 2 - 0.05, 0], ['GateB', 'Gate B', 48, 21.4, K.RAMP_W / 2 - 0.05, 0]]
    const hazard = A.mat('M_Hazard'), dark = A.mat('M_DarkMetal')
    world.barricadeSlots = defs.map(([id, label, yaw, s, hw, slopeTan], index) => {
      const pos = WG.toGame(uc(yaw, s, WG.rampRoadY(s)))
      const group = new THREE.Group()
      group.name = 'Barricade_' + id
      group.position.copy(pos)
      group.rotation.y = yawToRot(yaw)
      root.add(group)
      const empty = new THREE.Group()
      empty.name = 'Empty'
      const [gh, gd] = WG.barricadeEmptyBuf(hw, slopeTan).geometries({ mirror: 'x' })
      for (const [g, m] of [[gh, hazard], [gd, dark]]) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; empty.add(mesh) }
      group.add(empty)
      return { index, id, label, pos, yawDeg: yaw, rotY: yawToRot(yaw), halfWidth: hw, halfDepth: 0.6, sloped: slopeTan > 0, slopeTan, group, empty, outward: compassG(yaw) }
    })
  }
  const compassG = yaw => V3(Math.sin(yaw * DEG), 0, -Math.cos(yaw * DEG))

  // ------------------------------------------------------------------ base progression stage parts (BaseLook.cs)
  const stageParts = [] // { obj, level, dist, rest: Vector3, lock: -1|t }
  let strips = null, sweepMesh = null
  const gateLights = []
  function buildStageParts() {
    const body = A.mat('O_Trim'), glow = A.mat('M_EmissiveCyan')
    const c = V3(0, K.H, 0)
    const padRects = world.pads.map(p => {
      const a = p.yawDeg * DEG, half = 1.5 * p.scale * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) + 0.5
      return { x: p.base.x, z: -p.base.z, half }
    })
    const group = (name, level, dist, bufs) => {
      const geosA = [], geosB = []
      for (const [buf, pivot] of bufs) {
        const [ga, gb] = buf.geometries()
        const off = WG.toGame(pivot.clone())
        if (ga) geosA.push(ga.translate(off.x, off.y, off.z))
        if (gb) geosB.push(gb.translate(off.x, off.y, off.z))
      }
      const obj = new THREE.Group()
      obj.name = 'BaseStage_' + name
      for (const [gs, m, cast] of [[geosA, body, true], [geosB, glow, false]]) {
        if (!gs.length) continue
        const mesh = new THREE.Mesh(gs.length === 1 ? gs[0] : mergeGeometries(gs.map(g => prep(g)), false), m)
        mesh.castShadow = cast
        mesh.receiveShadow = true
        obj.add(mesh)
      }
      obj.visible = false
      root.add(obj)
      stageParts.push({ obj, level, dist, lock: -1 })
      return obj
    }
    group('CoreBraces', 3, 2.7, [0, 90, 180, 270].map(y => [WG.coreBraceBuf(y), c.clone().add(uc(y, 2.7))]))
    group('ConduitsInner', 3, 7, K.RAMPS.map(y => [WG.conduitBuf(new WG.MeshBuf(2), V3(), y, 3, 11, true, padRects), V3()]))
    const frames = group('GateFrames', 3, 16, K.RAMPS.map(y => [WG.gateFrameBuf(y), uc(y, 16, K.H)]))
    if (!lite) for (const y of K.RAMPS) {
      const l = new THREE.PointLight(ACCENT, 0, 9 * root.scale.x, 2)
      l.position.copy(WG.toGame(uc(y, 16, K.H).add(V3(0, 3, 0)).addScaledVector(uc(y), -0.8)))
      l.castShadow = false
      root.add(l)
      gateLights.push(l)
    }
    group('Emitters', 4, 3.5, [[[45, 135, 225, 315].reduce((m, y) => WG.emitterBuf(m, y, uc(y, 3.5, K.H)), new WG.MeshBuf(2)), V3()]])
    group('ConduitsOuter', 4, 12, [
      ...K.RAMPS.map(y => [WG.conduitBuf(new WG.MeshBuf(2), V3(), y, 11, 15.6, false, padRects), V3()]),
      [WG.conduitBuf(new WG.MeshBuf(2), V3(), -95, 3, 15.4, true, padRects), V3()],
      [WG.conduitBuf(new WG.MeshBuf(2), V3(), 98, 3, 15.4, true, padRects), V3()],
    ])
    group('Crowns', 5, 3.5, [[[45, 135, 225, 315].reduce((m, y) => WG.crownBuf(m, y, uc(y, 3.5, K.H + 3.7)), new WG.MeshBuf(2)), V3()]])
    for (const sp of stageParts) sp.rest = sp.obj.position.clone()
    void frames
    // the wall's light strips: dark (Standard trim) until the Reinforced stage
    strips = new THREE.Mesh(WG.wallStripsBuf().geometries()[0], A.mat('M_DarkMetal'))
    strips.castShadow = false
    root.add(strips)
    // the upgrade sweep ring
    sweepMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: WG.sweepRingTexture(), color: ACCENT.clone().multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    sweepMesh.position.set(0, K.H + 0.12, 0)
    sweepMesh.visible = false
    sweepMesh.renderOrder = 4
    root.add(sweepMesh)
  }

  // ------------------------------------------------------------------ ambient FX: smoke columns, fire, fake light pools
  let smoke = null, pools = null
  const poolFlicker = []
  function buildFx() {
    const cols = world.smokeSpots.map(p => p.clone())
    const n = lite ? 14 : 28, nf = lite ? 4 : 8
    const plane = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = plane.index
    g.setAttribute('position', plane.attributes.position)
    g.setAttribute('uv', plane.attributes.uv)
    const seeds = []
    for (let c = 0; c < cols.length; c++) {
      for (let i = 0; i < n; i++) seeds.push(c, i / n + Rr(-0.02, 0.02), R(), 0)
      for (let i = 0; i < nf; i++) seeds.push(c, i / nf, R(), 1)
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4))
    g.instanceCount = seeds.length / 4
    const mat = smokeMaterial(cols)
    mat.uniforms.uTime = uTime
    smoke = new THREE.Mesh(g, mat)
    smoke.frustumCulled = false
    smoke.renderOrder = 20
    root.add(smoke)
    // fake light pools (additive ground glow) where Unity had realtime lights we cannot afford
    const spots = []
    const pool = (p, c, r, k, flick = 0) => spots.push([p, c, r, k, flick])
    for (const jp of world.jumpPads) pool(jp.pos, AMBER, jp.outside ? 4.2 : 2.6, jp.outside ? 0.5 : 0.35)
    for (const pole of world.poles) pool(V3(pole.light.x, pole.pos.y, pole.light.z), WARM, 7, 0.32)
    for (const sp of world.spawns) pool(sp.pos, col(1, 0.38, 0.08), 9, 0.45, 0.25) // HiveLight flicker 0.25
    for (const s of world.smokeSpots) pool(s, col(1, 0.5, 0.15), 5, 0.4, 0.35) // fire light
    const pg = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2)
    pools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: WG.poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), spots.length)
    const m = new THREE.Matrix4(), cc = new THREE.Color()
    poolFlicker.length = 0
    spots.forEach(([p, c, r, k, flick], i) => {
      m.compose(V3(p.x, p.y + 0.06, p.z), new THREE.Quaternion(), V3(r * 2, 1, r * 2))
      pools.setMatrixAt(i, m)
      pools.setColorAt(i, cc.copy(c).multiplyScalar(k))
      if (flick) poolFlicker.push({ i, base: c.clone().multiplyScalar(k), amount: flick, seed: R() * 100 })
    })
    pools.renderOrder = 1
    pools.frustumCulled = false
    root.add(pools)
    world.poolSpots = spots
  }

  // ------------------------------------------------------------------ sky, environment, fog
  const SKY_ROT = 156 * DEG
  async function loadSky(scene, renderer) {
    if (!scene) return
    scene.fog = new THREE.FogExp2(col(0.55, 0.42, 0.34), world.fogDensityGame / root.scale.x)
    scene.backgroundRotation.set(0, SKY_ROT, 0)
    scene.environmentRotation.set(0, SKY_ROT, 0)
    const bgP = A.loadTextureAsync(asset('assets/sky/sky_2k.jpg')).then(t => {
      t.colorSpace = THREE.SRGBColorSpace
      t.mapping = THREE.EquirectangularReflectionMapping
      scene.background = t
      world.skyTexture = t
    })
    const envP = hdrBuffer(asset).then(buf => {
      const hdrTex = new HDRLoader().createDataTexture(buf)
      hdrTex.needsUpdate = true
      if (!renderer) return
      const pm = new THREE.PMREMGenerator(renderer)
      const rt = pm.fromEquirectangular(hdrTex)
      scene.environment = rt.texture
      world.envTexture = rt.texture
      // metals need the sky reflection at full strength (the original had baked reflection probes); the scene-wide
      // environment stays low so the rough surfaces keep the warm bounce look
      for (const name of Object.keys(A.defs || {})) {
        const m = A.mat(name)
        if (m.isMeshStandardMaterial && m.metalness >= 0.5) {
          m.envMap = rt.texture
          m.envMapIntensity = LOOK.metalEnv
          m.envMapRotation.copy(scene.environmentRotation)
          m.needsUpdate = true
        }
      }
      hdrTex.dispose(); pm.dispose()
    })
    await Promise.all([bgP, envP])
  }

  // ------------------------------------------------------------------ lights
  /** lighting balance under ACES (exposure 1): sun = Unity 2.4 x pi x 0.8, environment (sky PMREM), bounce hemisphere, sky background */
  const LOOK = { sun: 2.4 * PI * 0.34, env: 0.35, hemi: 1.9, bg: 0.85, core: 0.45, metalEnv: 0.8 }
  /** setLighting({ sun, env, hemi, bg }): rebalance (main.js / tuning) */
  function setLighting(o = {}) {
    Object.assign(LOOK, o)
    const scene = getScene()
    if (world.sun) world.sun.intensity = LOOK.sun
    if (world.hemi) world.hemi.intensity = LOOK.hemi
    if (scene) { scene.environmentIntensity = LOOK.env; scene.backgroundIntensity = LOOK.bg }
  }
  const TO_SUN = V3(-0.4908, 0.1908, -0.8501).normalize() // compass bearing -30, elevation 11 (game space)
  const SHADOW = { halfW: 35, halfH: 22, dist: 140, far: 300 }
  const lights = { warm: [] }
  function buildLights(scene, renderer) {
    const s = root.scale.x
    const pointI = i => i * PI * s * s // Unity URP intensity -> three candela in lot units (no 1/pi in URP, distances scaled)
    if (renderer) { renderer.shadowMap.enabled = true; if (renderer.shadowMap.type === THREE.BasicShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap }
    const sun = new THREE.DirectionalLight(col(1, 0.6, 0.34), LOOK.sun)
    sun.name = 'Sun'
    sun.castShadow = true
    sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048)
    sun.shadow.radius = lite ? 2 : 3
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.035 * s
    const cam = sun.shadow.camera
    cam.left = -SHADOW.halfW * s; cam.right = SHADOW.halfW * s; cam.top = SHADOW.halfH * s; cam.bottom = -SHADOW.halfH * s
    cam.near = 1 * s; cam.far = SHADOW.far * s
    cam.updateProjectionMatrix()
    root.add(sun); root.add(sun.target)
    world.sun = sun
    // bounce light: the baked GI of the original (warm ground bounce, sky above) as a hemisphere light
    const hemi = new THREE.HemisphereLight(col(0.66, 0.66, 0.7), col(0.55, 0.38, 0.28), LOOK.hemi)
    hemi.name = 'Bounce'
    root.add(hemi)
    world.hemi = hemi
    if (scene) { scene.environmentIntensity = LOOK.env; scene.backgroundIntensity = LOOK.bg }
    // the Core light (accent, i9 r16, pulse); no point-light shadows (draw-call budget)
    const cl = new THREE.PointLight(ACCENT, pointI(9), 16 * s, 2)
    cl.position.set(0, K.H + 2.15, 0)
    cl.castShadow = false
    root.add(cl)
    world.coreLight = cl
    lights.coreBase = pointI(9) * LOOK.core
    // up to four warm lights: two yard sodium lamps, the north lamp and the yard fire (two in lite)
    const warm = lite ? [[world.poles[1].light, WARM, 6, 15, 0.15], [world.smokeSpots[2].clone().add(V3(0, 1, 0)), col(1, 0.5, 0.15), 6, 9, 0.35]]
      : [[world.poles[1].light, WARM, 6, 15, 0.15], [world.poles[0].light, WARM, 6, 15, 0], [world.poles[3].light, WARM, 6, 15, 0], [world.smokeSpots[2].clone().add(V3(0, 1, 0)), col(1, 0.5, 0.15), 6, 9, 0.35]]
    for (const [p, c, i, r, flick] of warm) {
      const l = new THREE.PointLight(c, pointI(i), r * s, 2)
      l.position.copy(p)
      root.add(l)
      lights.warm.push({ light: l, base: pointI(i), flicker: flick, seed: R() * 100, dropout: 0 })
    }
    for (const l of gateLights) l.intensity = 0
    lights.gateBase = pointI(3.5)
  }
  const _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sf = new THREE.Vector3()
  /** centre the sun's shadow box on a game-space focus, snapped to whole shadow texels (no swimming) */
  function updateShadows(focus) {
    const sun = world.sun
    if (!sun || !focus) return
    const size = sun.shadow.mapSize.x
    _sx.crossVectors(V3(0, 1, 0), TO_SUN).normalize() // shadow camera x (lookAt basis)
    _sy.crossVectors(TO_SUN, _sx).normalize()
    const tx = 2 * SHADOW.halfW / size, ty = 2 * SHADOW.halfH / size
    const fx = focus.dot(_sx), fy = focus.dot(_sy), fz = focus.dot(TO_SUN)
    _sf.copy(_sx).multiplyScalar(Math.round(fx / tx) * tx).addScaledVector(_sy, Math.round(fy / ty) * ty).addScaledVector(TO_SUN, fz)
    sun.target.position.copy(_sf)
    sun.position.copy(_sf).addScaledVector(TO_SUN, SHADOW.dist)
    sun.target.updateMatrixWorld()
    sun.updateMatrixWorld()
  }

  // ------------------------------------------------------------------ base look: stages + skins
  const skinState = { level: -1, sweep: null }
  function skinFor(built, zone, stage) {
    const cat = CATEGORY[built]
    if (!cat || !zone) return built
    if (stage === 'Obsidian') return OBSIDIAN[cat]
    if (stage === 'Reinforced' && (zone === 'core' || zone === 'gates') && (cat === 'Panels' || cat === 'Trims')) return OBSIDIAN[cat]
    return built
  }
  function applySkin(e, stage) {
    const m = A.mat(skinFor(e.built, e.zone, stage))
    if (e.slot >= 0) e.mesh.material[e.slot] = m
    else e.mesh.material = m
  }
  function dressTo(level, radius) {
    const stage = stageName(level)
    for (const e of skinned) if (!e.done && e.dist <= radius) { applySkin(e, stage); e.done = true }
    if (strips && !strips.userData.done && 11.4 <= radius) { strips.material = stage === 'Standard' ? A.mat('M_DarkMetal') : A.mat('M_EmissiveCyan'); strips.userData.done = true }
    if (radius >= 15) for (const l of gateLights) l.intensity = stage === 'Standard' ? 0 : lights.gateBase * (stage === 'Reinforced' ? 0.75 : 1)
    if (radius >= 4) domeState.stageTint = stage === 'Obsidian' ? ACCENT.clone().multiplyScalar(0.8) : null
    if (radius >= 8 && world.stage.turretSkin !== (stage === 'Obsidian' ? 'Obsidian' : 'Standard')) {
      world.stage.turretSkin = stage === 'Obsidian' ? 'Obsidian' : 'Standard'
      if (G.events && G.events.emit) G.events.emit('baseSkin', world.stage.turretSkin, level)
    }
  }
  /** setStage(level, { instant }): Core level 0-5. A rise plays the sweep (1.4 s) and locks new parts in; anything else snaps. */
  function setStage(level, opts = {}) {
    level = clamp(Math.round(level), 0, 5)
    const prev = skinState.level
    skinState.level = level
    const stage = stageName(level)
    world.stage.level = level
    world.stage.name = stage
    world.coreFx.glowBoost = (stage === 'Obsidian' ? 1.35 : stage === 'Reinforced' ? 1.15 : 1) + (level >= 5 ? 0.15 : 0)
    for (const e of skinned) e.done = false
    if (strips) strips.userData.done = false
    const instant = opts.instant || prev < 0 || level <= prev
    if (instant) {
      skinState.sweep = null
      sweepMesh && (sweepMesh.visible = false)
      dressTo(level, Infinity)
      for (const sp of stageParts) { sp.lock = -1; sp.obj.position.copy(sp.rest); sp.obj.scale.setScalar(1); sp.obj.visible = level >= sp.level }
      world.stage.sweeping = false
      return
    }
    skinState.sweep = { t: 0, level, partsArrive: stageParts.some(sp => sp.level > prev && sp.level <= level) }
    world.stage.sweeping = true
    if (G.sfx) { G.sfx('sfx_turret_tierup_energy', { pos: world.core.pos, vol: 0.9 }); if (skinState.sweep.partsArrive) G.sfx('sfx_turret_tierup_ballistic', { pos: world.core.pos, vol: 1 }) }
  }
  function updateStage(dt) {
    const sw = skinState.sweep
    if (sw) {
      sw.t += dt
      const k = clamp01(sw.t / 1.4)
      const radius = lerp(1.5, 26, easeOutQuad(k))
      world.stage.sweepRadius = radius
      dressTo(sw.level, radius)
      for (const sp of stageParts) if (sp.lock < 0 && sw.level >= sp.level && !sp.obj.visible && sp.dist <= radius) { sp.lock = 0; sp.obj.visible = true }
      if (sweepMesh) {
        sweepMesh.visible = true
        sweepMesh.scale.setScalar(2 * radius / 0.82)
        sweepMesh.material.color.copy(ACCENT).multiplyScalar(3 * (1 - k * k))
      }
      if (k >= 1) {
        dressTo(sw.level, Infinity)
        for (const sp of stageParts) if (sw.level >= sp.level && !sp.obj.visible) { sp.lock = 0; sp.obj.visible = true }
        skinState.sweep = null
        sweepMesh && (sweepMesh.visible = false)
        world.stage.sweeping = false
        world.stage.sweepRadius = 0
      }
    }
    for (const sp of stageParts) {
      if (sp.lock < 0) continue
      sp.lock += dt
      const k = clamp01(sp.lock / 0.55), e = easeOutBack(k)
      sp.obj.position.copy(sp.rest).add(V3(0, -0.9 * (1 - e), 0))
      if (k >= 1) { sp.lock = -1; sp.obj.position.copy(sp.rest) }
    }
  }
  /** the Obsidian replacement for a turret material at the current turret skin (towers.js), or the material itself */
  function turretMaterial(material) {
    const name = baseName(material && material.name)
    const cat = CATEGORY[name]
    if (world.stage.turretSkin !== 'Obsidian' || !cat || !TURRET_SURFACES.includes(cat)) return material
    return A.mat(OBSIDIAN[cat])
  }

  // ------------------------------------------------------------------ dome (CoreShield presentation)
  const domeState = { visible: false, intensity: 0, shown: 0, flash: 0, hitAge: 10, tint: null, stageTint: null }
  function setDome(o = {}) {
    if (o.visible != null) domeState.visible = !!o.visible
    if (o.intensity != null) domeState.intensity = o.intensity
    if (o.tint !== undefined) domeState.tint = o.tint
    if (o.flash != null) domeState.flash = Math.max(domeState.flash, o.flash)
    if (o.hitPoint) { world.domeObj && world.domeObj.material.uniforms.uHitPos.value.copy(o.hitPoint); domeState.hitAge = 0 }
  }
  function updateDome(dt) {
    const d = world.domeObj
    if (!d) return
    domeState.hitAge += dt
    domeState.flash = moveTowards(domeState.flash, 0, dt * 2.5)
    const target = domeState.visible ? domeState.intensity : 0
    domeState.shown = moveTowards(domeState.shown, target, dt * (domeState.visible ? 1.5 : 3))
    const on = domeState.shown > 0.01 || domeState.flash > 0.01
    d.visible = on
    if (!on) return
    const u = d.material.uniforms
    u.uIntensity.value = Math.max(domeState.shown, domeState.flash * 0.8)
    u.uFlash.value = domeState.flash
    u.uHitAge.value = domeState.hitAge
    const tint = domeState.tint || domeState.stageTint
    if (tint) u.uColor.value.copy(tint)
    else u.uColor.value.setRGB(0.22, 0.78, 1.6)
  }

  // ------------------------------------------------------------------ Core presentation (CoreController.Update)
  const coreState = { ringA: 30, ringB: -22, orbKick: 0, orbKickVel: 0, orbRest: 2.15, glowMat: null, orbMat: null }
  const _cc = new THREE.Color(), HEALTHY = ACCENT, CRITICAL = new THREE.Color(1, 0.18, 0.08)
  /** a hit on the Core: spins the rings up and kicks the orb (call from towers.damageCore) */
  function kickCore(final = 10) {
    world.coreFx.heat = Math.min(1, world.coreFx.heat + 0.25)
    coreState.orbKickVel += 1.5 + final * 0.05
  }
  function updateCore(dt, t) {
    const fx = world.coreFx, parts = world.coreParts
    fx.heat = moveTowards(fx.heat, 0, dt * 0.35)
    const danger = clamp01(fx.danger)
    const targetA = 30 + fx.heat * 140 + danger * 60
    coreState.ringA = moveTowards(coreState.ringA, targetA, 90 * dt)
    coreState.ringB = moveTowards(coreState.ringB, -targetA * 0.7, 70 * dt)
    if (parts) {
      if (parts.ringA) parts.ringA.rotateOnWorldAxis(V3(0, 1, 0), -coreState.ringA * DEG * dt)
      if (parts.ringB) parts.ringB.rotateOnWorldAxis(V3(0, 1, 0), -coreState.ringB * DEG * dt)
      coreState.orbKickVel += (-coreState.orbKick * 160 - coreState.orbKickVel * 10) * dt
      coreState.orbKick += coreState.orbKickVel * dt
      if (parts.orb) parts.orb.position.y = coreState.orbRest + Math.sin(t * 1.6) * 0.08 - coreState.orbKick * 0.15
    }
    const pulse = 1 + Math.sin(t * (2 + danger * 8)) * (0.12 + danger * 0.35)
    _cc.copy(HEALTHY).lerp(CRITICAL, danger * danger).multiplyScalar(fx.dead ? 0.05 : 1)
    if (world.coreLight) {
      world.coreLight.color.copy(_cc)
      world.coreLight.intensity = lights.coreBase * fx.glowBoost * pulse * (1 + fx.heat * 0.6)
    }
    const e = (1.8 * fx.glowBoost * pulse + fx.heat * 2.5) * 0.5
    for (const m of [coreState.glowMat, coreState.orbMat]) if (m) { m.emissive.copy(_cc); m.emissiveIntensity = e }
  }

  // ------------------------------------------------------------------ per-frame
  let clock = 0
  function update(dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0))
    clock += dt
    const t = clock
    uTime.value = t
    updateCore(dt, t)
    updateDome(dt)
    updateStage(dt)
    // build pad rings: pulse (0.35 when a tower stands, else breathing) + 3 x focus highlight
    for (const p of world.pads) {
      p.highlight = moveTowards(p.highlight, p.focus ? 1 : 0, dt * 5)
      const pulse = p.occupied ? 0.35 : 0.6 + 0.4 * Math.sin(2.4 * t + p.index)
      p.ring.material.color.copy(AMBER).multiplyScalar(1.4 * (pulse + 3 * p.highlight))
    }
    // jump pads: deck glow, ground ring a beat behind, kick on launch (set jp.kick = 1)
    const wave = Math.sin(t * 3)
    for (const jp of world.jumpPads) {
      jp.kick = moveTowards(jp.kick, 0, dt * 2)
      jp.glowMat.emissiveIntensity = 1.4 * (1 + 0.35 * wave + jp.kick * 3)
      if (jp.ringMat) jp.ringMat.emissiveIntensity = 1.4 * (0.9 + 0.5 * Math.sin(t * 3 - 1.3) + jp.kick * 3)
    }
    // flickering lamps (LightFlicker: amount, speed 3, dropouts)
    for (const w of lights.warm) {
      if (!w.flicker) continue
      const tt = t * 3 + w.seed
      const n = perlin(tt, w.seed) * 0.65 + perlin(tt * 2.7, w.seed + 3) * 0.35
      if (w.dropout <= 0 && R() < 0.25 * dt) w.dropout = Rr(0.05, 0.25)
      let k = 1 - w.flicker + n * w.flicker * 2
      if (w.dropout > 0) { w.dropout -= dt; k *= 0.15 }
      w.light.intensity = w.base * k
    }
    // hive vents and fires: the fake light pools flicker (LightFlicker amount, speed 7)
    if (pools && poolFlicker.length) {
      for (const f of poolFlicker) {
        const tt = t * 7 + f.seed
        const n = perlin(tt, f.seed) * 0.65 + perlin(tt * 2.7, f.seed + 3) * 0.35
        pools.setColorAt(f.i, _cc.copy(f.base).multiplyScalar(1 - f.amount + n * f.amount * 2))
      }
      pools.instanceColor.needsUpdate = true
    }
    if (world.autoShadowFocus && G.player && G.player.pos) updateShadows(G.player.pos)
  }

  // ------------------------------------------------------------------ queries
  const _ray = new THREE.Ray(), _dn = V3(0, -1, 0)
  /** floor height under (x, z) at or below yHint + 0.4 (walk geometry); falls back to the analytic plain */
  function groundY(x, z, yHint = 200) {
    _ray.origin.set(x, yHint + 0.4, z)
    _ray.direction.copy(_dn)
    const hit = world.walkBVH && world.walkBVH.raycastFirst(_ray, THREE.DoubleSide, 0, yHint + 60)
    return hit ? hit.point.y : WG.plainHeight(x, -z)
  }
  /** first hit against shot-stopping level geometry: { point, normal (towards the origin), distance } | null */
  function raycastEnv(origin, dir, far = 500) {
    _ray.origin.copy(origin)
    _ray.direction.copy(dir).normalize()
    const hit = world.envBVH && world.envBVH.raycastFirst(_ray, THREE.DoubleSide, 0, far)
    if (!hit) return null
    const n = hit.face.normal.clone()
    if (n.dot(_ray.direction) > 0) n.negate()
    return { point: hit.point.clone(), normal: n, distance: hit.distance }
  }
  /** walk-geometry raycast (same result shape) */
  function raycastWalk(origin, dir, far = 500) {
    _ray.origin.copy(origin)
    _ray.direction.copy(dir).normalize()
    const hit = world.walkBVH && world.walkBVH.raycastFirst(_ray, THREE.DoubleSide, 0, far)
    if (!hit) return null
    const n = hit.face.normal.clone()
    if (n.dot(_ray.direction) > 0) n.negate()
    return { point: hit.point.clone(), normal: n, distance: hit.distance }
  }
  const _cp = {}, _sp = new THREE.Vector3(), _sd = new THREE.Vector3()
  /** distance along from->to of the first contact of a sphere with walk geometry (camera collision), or the full length */
  function sphereCast(from, to, radius) {
    _sd.subVectors(to, from)
    const len = _sd.length()
    if (len < 1e-6 || !world.walkBVH) return len
    _sd.multiplyScalar(1 / len)
    const bvh = world.walkBVH
    const clear = d => { _sp.copy(from).addScaledVector(_sd, d); const h = bvh.closestPointToPoint(_sp, _cp, 0, radius); return !h || h.distance >= radius }
    if (!clear(0)) return 0
    // centre-line ray caps the search; then march in radius/2 steps and refine by bisection
    _ray.origin.copy(from); _ray.direction.copy(_sd)
    const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len)
    const maxD = hit ? hit.distance : len
    const step = Math.max(0.05, radius * 0.5)
    let a = 0
    for (let d = step; ; d += step) {
      const dd = Math.min(d, maxD)
      if (!clear(dd)) {
        let lo = a, hi = dd
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (clear(m)) lo = m; else hi = m }
        return lo
      }
      a = dd
      if (dd >= maxD) break
    }
    return hit ? Math.max(0, maxD - radius * 0.2) : len
  }

  // ------------------------------------------------------------------ capsule character controller
  const _seg = new THREE.Line3(), _box = new THREE.Box3(), _tp = new THREE.Vector3(), _cpt = new THREE.Vector3(), _tn = new THREE.Vector3()
  const _push = new THREE.Vector3(), _before = new THREE.Vector3()
  /**
   * collide(pos, vel, radius, height, dt): moves pos (feet, game space) by vel*dt against the walk geometry.
   * Horizontal slide against steep triangles (wall pass on a capsule lifted by the 0.35 m step), step-up <= 0.35 m and
   * ground snap by downward rays, slope limit 50 deg. Gravity is the caller's (vel.y); a grounded result zeroes vel.y < 0.
   * Returns { grounded, floorY, floorNormal, ceiling }.
   */
  function collide(pos, vel, radius = 0.35, height = 1.8, dt = 1 / 60) {
    const res = { grounded: false, floorY: -Infinity, floorNormal: new THREE.Vector3(0, 1, 0), ceiling: false }
    if (!world.walkBVH) { pos.addScaledVector(vel, dt); return res }
    const move = Math.hypot(vel.x, vel.y, vel.z) * dt
    const n = clamp(Math.ceil(move / (radius * 0.7)), 1, 10)
    const h = dt / n
    for (let i = 0; i < n; i++) moveOnce(pos, vel, radius, height, h, res)
    return res
  }
  function moveOnce(pos, vel, r, height, dt, res) {
    const bvh = world.walkBVH
    pos.addScaledVector(vel, dt)
    _before.copy(pos)
    const lowY = STEP + r, highY = Math.max(height - r, lowY + 0.01)
    for (let iter = 0; iter < 3; iter++) {
      _seg.start.set(pos.x, pos.y + lowY, pos.z)
      _seg.end.set(pos.x, pos.y + highY, pos.z)
      _box.makeEmpty().expandByPoint(_seg.start).expandByPoint(_seg.end)
      _box.min.addScalar(-r); _box.max.addScalar(r)
      let moved = false
      bvh.shapecast({
        intersectsBounds: b => b.intersectsBox(_box),
        intersectsTriangle: tri => {
          const d = tri.closestPointToSegment(_seg, _tp, _cpt)
          if (d >= r) return false
          tri.getNormal(_tn)
          const any = Math.abs(_tn.y)
          if (any >= WALKABLE_NY) {
            if (_cpt.y >= _tp.y) return false // a floor: the ground rays handle it
            // a ceiling over the head: push down (only what the head reaches)
            const depth = r - d
            _seg.start.y -= depth; _seg.end.y -= depth
            pos.y -= depth
            res.ceiling = true
            if (vel.y > 0) vel.y = 0
            moved = true
            return false
          }
          let dx = _cpt.x - _tp.x, dz = _cpt.z - _tp.z
          let hd = Math.hypot(dx, dz)
          if (hd < 1e-5) { dx = _tn.x; dz = _tn.z; hd = Math.hypot(dx, dz); if (hd < 1e-5) return false }
          const vy = _cpt.y - _tp.y
          const want = Math.sqrt(Math.max(0, r * r - vy * vy))
          const push = Math.max(0, want - (d < 1e-6 ? 0 : hd))
          if (push <= 0) return false
          dx /= hd; dz /= hd
          _seg.start.x += dx * push; _seg.start.z += dz * push
          _seg.end.x += dx * push; _seg.end.z += dz * push
          pos.x += dx * push; pos.z += dz * push
          moved = true
          return false
        },
      })
      if (!moved) break
    }
    // slide: remove the velocity component into what pushed us
    _push.set(pos.x - _before.x, 0, pos.z - _before.z)
    const pl = _push.length()
    if (pl > 1e-6) {
      _push.multiplyScalar(1 / pl)
      const vn = vel.x * _push.x + vel.z * _push.z
      if (vn < 0) { vel.x -= _push.x * vn; vel.z -= _push.z * vn }
    }
    // ground: rays down from step height at the centre and four points at half radius
    const top = pos.y + STEP + 0.05
    // walking (vel.y ~ -2 from the caller's ground clamp) snaps down a step; a falling body lands only where it arrives
    const falling = vel.y < -3
    const snap = falling ? 0.02 : STEP + 0.07
    let best = -Infinity, bestN = null
    const offs = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]
    for (const [ox, oz] of offs) {
      _ray.origin.set(pos.x + ox * r, top, pos.z + oz * r)
      _ray.direction.copy(_dn)
      const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, STEP + 0.05 + Math.max(snap, 0.05))
      if (!hit) continue
      _tn.copy(hit.face.normal)
      if (_tn.y < 0) _tn.negate()
      if (_tn.y < WALKABLE_NY) continue
      if (hit.point.y > best) { best = hit.point.y; bestN = _tn.clone() }
    }
    if (best > -Infinity) {
      const gap = pos.y - best
      const rising = vel.y > 0.5
      if ((!rising && gap <= snap) || (rising && gap < 0)) {
        pos.y = best
        if (vel.y < 0) vel.y = 0
        res.grounded = true
        res.floorY = best
        res.floorNormal.copy(bestN)
      }
    }
  }

  // ------------------------------------------------------------------ zones + routes
  const zoneOf = p => NAV.zoneOf(p)
  Object.assign(world, {
    build, prewarm, update, updateShadows, setLighting, collide, groundY, raycastEnv, raycastWalk, sphereCast, setStage, setDome, kickCore, turretMaterial,
    route: (spawnId, opts = {}) => NAV.buildRoute(spawnId, { rng: G.rng || R, ...opts }),
    zoneOf,
    inYard: p => zoneOf(p) === 'yard',
    onWall: p => zoneOf(p) === 'walls',
    outside: p => zoneOf(p) === 'outside',
    plainHeight: (x, z) => WG.plainHeight(x, -z),
    K,
  })
  return world
}
