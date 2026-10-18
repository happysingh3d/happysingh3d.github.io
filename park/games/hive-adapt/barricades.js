// Hive Adapt (Project 0 port): BARRICADES (helper of towers.js). Ports Scripts/Defence/Barricade.cs and the tier geometry of
// Editor/HiveBuilder.Defence.cs (BarricadeSlot): four slots (Causeway A/B, Gate A/B) on world.barricadeSlots, three tiers
// (T1 scrap and timber, T2 steel with Czech hedgehogs, T3 energy barrier) with HP 450 / 1000 / 1800 x mods.barricadeHp,
// costs 60 -> 120 -> 200, repair 0.1 Biomass per HP, rubble when broken, hit shudder / field ripple, player pass-through.
// Geometry is built in Unity local space with worldgeo's MeshBuf and mirrored into the slot group's frame (mirror 'x').
import * as THREE from 'three'
import { DEG, rng } from './u.js'
import * as WG from './worldgeo.js'

const { MeshBuf, V3, qEuler, qLook } = WG
const f32 = Math.fround
const HIT_SFX = ['sfx_barricade_hit_0', 'sfx_barricade_hit_1', 'sfx_barricade_hit_2'], FIELD_SFX = ['sfx_shield_hit_0', 'sfx_shield_hit_1']
export const BARRICADE = {
  hp: [450, 1000, 1800], cost: [60, 120, 200], names: ['Scrap barricade', 'Steel barricade', 'Energy barrier'], repairPerHp: 0.1,
}

// ------------------------------------------------------------------ the energy barrier field (M_EnergyBarrier, EnergyField)
function fieldMaterial(uTime) {
  return new THREE.ShaderMaterial({
    name: 'M_EnergyBarrier',
    uniforms: {
      uColor: { value: new THREE.Color(0.22, 0.6, 1.5) }, uTime, uHitPos: { value: new THREE.Vector3(0, -100, 0) }, uHitAge: { value: 10 },
      uHalf: { value: new THREE.Vector2(3, 1.1) }, uIntensity: { value: 1 },
    },
    vertexShader: [
      'varying vec3 vLocal; varying vec2 vUv;',
      'void main() { vLocal = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor; uniform float uTime, uHitAge, uIntensity; uniform vec3 uHitPos; uniform vec2 uHalf;',
      'varying vec3 vLocal; varying vec2 vUv;',
      'vec2 hash2( vec2 p ) { p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ); return fract( sin( p ) * 43758.5453 ); }',
      'vec2 cells( vec2 p ) {',
      '  vec2 i = floor( p ), f = fract( p ); float d1 = 8.0, d2 = 8.0;',
      '  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {',
      '    vec2 g = vec2( float( x ), float( y ) ); vec2 o = hash2( i + g ); o = 0.5 + 0.4 * sin( uTime * 0.7 + 6.2831 * o );',
      '    float d = length( g + o - f ); if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;',
      '  }',
      '  return vec2( d1, d2 );',
      '}',
      'void main() {',
      '  vec2 c = cells( vLocal.xy / 0.32 * 0.55 );',
      '  float edge = 1.0 - smoothstep( 0.0, 0.08, c.y - c.x );',
      '  float scan = 0.5 + 0.5 * sin( vLocal.y * 9.0 - uTime * 3.2 );',
      '  float a = 0.07 + edge * 0.55 * ( 0.35 + 0.4 * scan ) + 0.02 * scan;',
      '  float sideFade = smoothstep( 0.0, 0.35, uHalf.x - abs( vLocal.x ) );',
      '  float vy = clamp( ( vLocal.y - 0.25 ) / 2.2, 0.0, 1.0 );',
      '  float vFade = smoothstep( 0.0, 0.08, vy ) * ( 1.0 - 0.55 * vy );',
      '  float edgeGlow = smoothstep( 0.92, 1.0, vy ) * 0.6 + smoothstep( 0.12, 0.0, vy ) * 0.9;',
      '  float hd = distance( vLocal, uHitPos );',
      '  float ring = exp( -pow( ( hd - uHitAge * 5.0 ) * 2.2, 2.0 ) ) * exp( -uHitAge * 2.6 );',
      '  float spot = exp( -hd * 1.6 ) * exp( -uHitAge * 5.0 );',
      '  vec3 col = uColor * ( ( a + edgeGlow * 0.3 ) * vFade * sideFade * uIntensity + ( ring + spot ) * 0.9 ) * 0.6;',
      '  gl_FragColor = vec4( col, 1.0 );',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })
}
/** a soft radial glow texture (the field's light pool on the road; no real point lights) */
function glowTexture() {
  const N = 64, d = new Uint8Array(N * N * 4)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1
    const r = Math.min(1, Math.hypot(x, y))
    const v = Math.round(255 * Math.pow(1 - r, 2.2))
    const k = (j * N + i) * 4
    d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255
  }
  const t = new THREE.DataTexture(d, N, N)
  t.needsUpdate = true
  return t
}

export function createBarricades(K) {
  const G = K.G
  const A = G.assets
  const list = []
  const uTime = { value: 0 }
  let sandbags = null, glowTex = null
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _strike = new THREE.Vector3(), _inv = new THREE.Matrix4()

  // ---------------------------------------------------------------- geometry (HiveBuilder.Defence.cs BarricadeSlot)
  function meshesFrom(buf, mats, parent, cast = true) {
    const geos = buf.geometries({ mirror: 'x' })
    geos.forEach((g, i) => {
      if (!g) return
      const mesh = new THREE.Mesh(g, A.mat(mats[i]))
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
    })
  }
  /** local (game-frame) position of a Unity-local point on this slot's group */
  const loc = (x, y, z) => V3(-x, y, z)
  function buildTiers(slot) {
    const hw = slot.halfWidth, slopeTan = slot.slopeTan || 0
    const Gz = z => -z * slopeTan
    const r0 = rng(1878 + slot.index * 977)
    const R = (a, b) => a + r0() * (b - a)
    const pitch = qEuler(Math.atan(slopeTan) / DEG, 0, 0)
    const groups = []
    // --- tier 1: scrap and timber. Rusty I-beam posts, uneven weathered planks with gaps, corrugated sheets, back braces,
    //     and the outpost's sandbag props along the outer foot
    {
      const g = new THREE.Group(); g.name = 'Tier1'
      const b = new MeshBuf(4) // 0 planks, 1 corrugated, 2 rust metal, 3 sandbag
      const posts = []
      const bays = Math.max(3, Math.round(hw * 2 / 1.7))
      for (let k = 0; k <= bays; k++) posts.push(-hw + k * (hw * 2 / bays))
      for (const x of posts) b.Box(2, 2, V3(x, 0.7 + Gz(0.1) * 0.5, 0.1), qEuler(0, R(-6, 6), R(-3, 3)), V3(0.16, 2.1, 0.16))
      const rows = [0.32, 0.66, 1.0, 1.34]
      for (let k = 0; k < bays; k++) {
        const x0 = posts[k], x1 = posts[k + 1]
        for (const y of rows) {
          if (R(0, 1) < 0.16) continue // missing board
          const len = x1 - x0 + R(0.1, 0.45)
          b.Box(0, 0, V3((x0 + x1) * 0.5 + R(-0.12, 0.12), y + R(-0.04, 0.04) + Gz(0.22), 0.22), qEuler(R(-3, 3), R(-3, 3), R(-5, 5)), V3(len, R(0.18, 0.26), 0.05))
        }
        const a = V3(x0, 1.45, -0.08), c = V3(x1, 0.15 + Gz(-0.08), -0.08)
        b.Box(0, 0, a.clone().add(c).multiplyScalar(0.5), qLook(V3(0, 0, -1), c.clone().sub(a)), V3(0.2, c.distanceTo(a) + 0.2, 0.05))
        if (k % 2 === (bays > 3 ? 1 : 0)) b.Box(1, 1, V3((x0 + x1) * 0.5, 0.72 + Gz(0.36), 0.36), qEuler(-9, R(-4, 4), R(-3, 3)), V3(x1 - x0 + 0.2, 1.35, 0.03))
      }
      meshesFrom(b, ['M_Planks', 'M_Corrugated', 'M_RustMetal', 'M_Sandbag'], g)
      if (sandbags) {
        for (let x = -hw + 1.1; x < hw - 0.5; x += 2.2) {
          const s = sandbags.clone(true)
          s.position.copy(loc(x, Gz(0.75) - 0.05, 0.75))
          s.rotation.y = -R(-4, 4) * DEG
          s.scale.setScalar(0.75)
          g.add(s)
        }
      }
      groups.push(g)
    }
    // --- tier 2: steel. Concrete footing, welded plate panels with rear ribs, a hazard rail, Czech hedgehogs in front
    {
      const g = new THREE.Group(); g.name = 'Tier2'
      const b = new MeshBuf(4) // 0 plate, 1 rust (hedgehogs), 2 concrete, 3 hazard
      b.Box(2, 2, V3(0, -0.1, 0), pitch, V3(hw * 2 + 0.3, 0.7, 0.95))
      const panels = Math.max(3, Math.round(hw * 2 / 1.25))
      for (let k = 0; k < panels; k++) {
        const x = -hw + (k + 0.5) * (hw * 2 / panels)
        b.Box(0, 0, V3(x, 1.2, -0.05 + R(-0.03, 0.03)), qEuler(R(-1.5, 1.5), R(-3, 3), 0), V3(hw * 2 / panels + 0.04, 1.8, 0.06))
        b.Box(0, 0, V3(-hw + k * (hw * 2 / panels), 1.15, -0.16), new THREE.Quaternion(), V3(0.1, 1.9, 0.14))
      }
      b.Box(0, 0, V3(hw, 1.15, -0.16), new THREE.Quaternion(), V3(0.1, 1.9, 0.14))
      b.Box(3, 3, V3(0, 2.12, -0.05), new THREE.Quaternion(), V3(hw * 2 + 0.1, 0.12, 0.1))
      const hedgeUp = new THREE.Quaternion().setFromUnitVectors(V3(1, 1, 1).normalize(), V3(0, 1, 0))
      const hogs = Math.max(2, Math.round(hw * 2 / 2.3))
      for (let k = 0; k < hogs; k++) {
        const x = -hw + (k + 0.5) * (hw * 2 / hogs)
        const q = qEuler(0, R(0, 120), 0).multiply(hedgeUp)
        const c = V3(x + R(-0.15, 0.15), 0.52 + Gz(1.15), 1.15)
        for (const axis of [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)]) b.Box(1, 1, c, q.clone().multiply(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), axis)), V3(0.13, 1.8, 0.13))
      }
      meshesFrom(b, ['M_DarkMetal', 'M_RustMetal', 'M_Concrete', 'M_Hazard'], g)
      groups.push(g)
    }
    // --- tier 3: energy barrier. Two emitter pylons, a floor emitter rail, and the field between them
    let field = null
    {
      const g = new THREE.Group(); g.name = 'Tier3'
      const b = new MeshBuf(3) // 0 gunmetal, 1 dark metal, 2 emissive
      for (const sx of [-1, 1]) {
        const x = sx * (hw + 0.1)
        b.Box(0, 1, V3(x, 1.0, 0), new THREE.Quaternion(), V3(0.6, 2.9, 0.8))
        b.Box(1, 1, V3(x, 2.5, 0), new THREE.Quaternion(), V3(0.78, 0.14, 0.95))
        b.Box(1, 1, V3(x + sx * 0.12, 0.05, 0), new THREE.Quaternion(), V3(0.9, 0.5, 1.1))
        b.Box(2, 2, V3(x - sx * 0.31, 1.35, 0), new THREE.Quaternion(), V3(0.04, 2.0, 0.2))
        b.Box(2, 2, V3(x, 2.6, 0), new THREE.Quaternion(), V3(0.3, 0.06, 0.3))
      }
      b.Box(1, 1, V3(0, 0.02, 0), pitch, V3(hw * 2, 0.4, 0.55))
      b.Box(2, 2, V3(0, 0.23, 0), pitch, V3(hw * 2 - 0.2, 0.03, 0.12))
      meshesFrom(b, ['M_GunMetal', 'M_DarkMetal', 'M_EmissiveCyan'], g)
      const fm = fieldMaterial(uTime)
      fm.uniforms.uHalf.value.set(hw - 0.25, 1.1)
      const fg = new THREE.PlaneGeometry(hw * 2 - 0.5, 2.2, 1, 1).translate(0, 1.35, 0)
      field = new THREE.Mesh(fg, fm)
      field.renderOrder = 8
      field.castShadow = false
      field.receiveShadow = false
      g.add(field)
      // the field light (0.35, 0.75, 1) i2.5 r7 at +1.3 up, +0.6 forward: a soft additive pool on the road instead of a light
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0.35, 0.75, 1).multiplyScalar(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
      pool.position.set(0, 0.06 + Gz(0.4), 0.4)
      pool.rotation.x = Math.atan(slopeTan)
      pool.scale.set(hw * 2 + 3, 1, 5)
      pool.renderOrder = 3
      g.add(pool)
      groups.push(g)
    }
    // --- rubble: what is left when it breaks
    const rubble = new THREE.Group(); rubble.name = 'Rubble'
    {
      const b = new MeshBuf(3)
      for (let k = 0; k < 16; k++) {
        const x = R(-hw, hw), z = R(-0.8, 1.2)
        const size = V3(R(0.3, 1.3), R(0.06, 0.3), R(0.12, 0.5))
        b.Box(k % 3, k % 3, V3(x, Gz(z) + size.y * 0.4, z), qEuler(R(-20, 20), R(0, 360), R(-25, 25)), size)
      }
      meshesFrom(b, ['M_Planks', 'M_RustMetal', 'M_Concrete'], rubble)
    }
    for (const g of groups) { g.visible = false; slot.group.add(g) }
    rubble.visible = false
    slot.group.add(rubble)
    return { tiers: groups, rubble, field }
  }

  // ---------------------------------------------------------------- the barricade records
  async function load() {
    try {
      const s = await A.clone('SM_Sandbags')
      A.dress(s)
      s.traverse(o => { if (o.isMesh) WG.boxUV(o.geometry) })
      sandbags = s
    } catch (e) { sandbags = null }
    glowTex = glowTexture()
    const slots = (G.world && G.world.barricadeSlots) || []
    for (const slot of slots) {
      const v = buildTiers(slot)
      const fwd = slot.outward ? slot.outward.clone().setY(0).normalize() : V3(Math.sin(slot.yawDeg * DEG), 0, -Math.cos(slot.yawDeg * DEG))
      const right = V3(-fwd.z, 0, fwd.x)
      const b = {
        index: slot.index, id: slot.id, label: slot.label, slot, pos: slot.pos, yawDeg: slot.yawDeg, halfWidth: slot.halfWidth, halfDepth: 0.6,
        tier: 0, hp: 0, max: 0, built: false, intact: false, broken: false, fwd, right,
        models: v.tiers, rubble: v.rubble, field: v.field, rest: v.tiers.map(g => g.position.z),
        shake: 0, hitAge: 10, hitPos: new THREE.Vector3(0, -100, 0), hitSoundCd: 0, passCd: 0, playerInside: false, passes: 0, sweepT: 1,
        strikePoint: p => strikePoint(b, p),
        get name() { return this.tier > 0 ? BARRICADE.names[this.tier - 1] : 'Barricade slot' },
        get needsRepair() { return this.tier > 0 && this.hp < this.max - 0.5 },
        get canUpgrade() { return this.intact && this.tier < 3 },
      }
      list.push(b)
      refresh(b)
    }
  }

  const tierHealth = tier => f32(BARRICADE.hp[Math.max(1, Math.min(3, tier)) - 1] * f32(1 + K.mods().barricadeHp))
  function refresh(b) {
    b.built = b.tier > 0
    b.intact = b.built && b.hp > 0
    b.broken = b.built && b.hp <= 0
    for (let i = 0; i < b.models.length; i++) b.models[i].visible = b.intact && i === b.tier - 1
    b.rubble.visible = b.broken
    if (b.slot.empty) b.slot.empty.visible = !b.built
  }
  /** Places a tier at full HP (no cost) */
  function setTier(b, tier) {
    b.tier = Math.max(0, Math.min(3, tier | 0))
    b.max = b.tier > 0 ? tierHealth(b.tier) : 0
    b.hp = b.max
    b.sweepT = 0
    refresh(b)
  }
  function reset() { for (const b of list) { b.tier = 0; b.hp = 0; b.max = 0; b.shake = 0; b.hitAge = 10; refresh(b) } }
  /** Biomass to repair (or rebuild) it to full: ceil(missing x 0.1) */
  const _rc = { amount: 0, cost: 0 }
  function repairCost(b) {
    _rc.amount = b.built ? b.max - Math.max(0, b.hp) : 0
    _rc.cost = Math.ceil(f32(f32(_rc.amount) * f32(BARRICADE.repairPerHp)))
    return _rc
  }
  function revive(b) { b.hp = b.max; refresh(b) }
  function repairFree(b) {
    if (!b.needsRepair) return false
    revive(b)
    fanfare(b, false)
    return true
  }
  function fanfare(b, upgrade) {
    _a.copy(b.pos).y += 1
    K.fx(upgrade ? 'upgrade' : 'build', b.pos)
    K.sfx('sfx_barricade_build', _a, 1)
  }

  // ---------------------------------------------------------------- bugs (Barricade.Blocking / StrikePoint)
  function blocking(pos, reach) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.intact) continue
      const dx = pos.x - b.pos.x, dy = pos.y - b.pos.y, dz = pos.z - b.pos.z
      if (Math.abs(dy) > 3.5) continue
      const along = dx * b.fwd.x + dz * b.fwd.z, lat = dx * b.right.x + dz * b.right.z
      if (Math.abs(lat) <= b.halfWidth + 0.6 && Math.abs(along) <= b.halfDepth + reach) return b
    }
    return null
  }
  function strikePoint(b, from) {
    const dx = from.x - b.pos.x, dz = from.z - b.pos.z
    const lat = Math.max(-b.halfWidth, Math.min(b.halfWidth, dx * b.right.x + dz * b.right.z))
    const side = dx * b.fwd.x + dz * b.fwd.z >= 0 ? 1 : -1
    return _strike.copy(b.pos).addScaledVector(b.right, lat).addScaledVector(b.fwd, b.halfDepth * side).setY(b.pos.y + 0.8)
  }
  /** Hive damage (Health.ApplyDamage on the barricade) */
  function damage(b, amount, info) {
    if (!b.intact || !(amount > 0)) return 0
    b.hp = Math.max(0, b.hp - amount)
    b.shake = Math.min(1, b.shake + 0.35)
    const p = info && info.point ? info.point : strikePoint(b, b.pos)
    setHit(b, p)
    if (b.hitSoundCd <= 0) { b.hitSoundCd = 0.09; K.sfx(K.pick(HIT_SFX), p, 0.75, 1 + (K.rand() - 0.5) * 0.24) }
    K.fx(b.tier < 3 ? 'barricadeHit' : 'barricadeHitEnergy', p, null, info && info.dir)
    if (b.hp <= 0) {
      _a.copy(b.pos).y += 1
      K.sfx('sfx_barricade_break', _a, 1)
      K.fx(b.tier < 3 ? 'barricadeBreak' : 'barricadeBreakEnergy', b.pos)
      refresh(b)
      K.onBroken(b)
    }
    return amount
  }
  /** co-op guest: a Hive hit shown without touching integrity (the host's barricade decides) */
  function hitFx(b, amount, info) {
    if (!b || !b.intact || !(amount > 0)) return 0
    b.shake = Math.min(1, b.shake + 0.35)
    const p = info && info.point ? info.point : strikePoint(b, b.pos)
    setHit(b, p)
    if (b.hitSoundCd <= 0) { b.hitSoundCd = 0.09; K.sfx(K.pick(HIT_SFX), p, 0.75, 1 + (K.rand() - 0.5) * 0.24) }
    K.fx(b.tier < 3 ? 'barricadeHit' : 'barricadeHitEnergy', p, null, info && info.dir)
    return 0
  }
  function setHit(b, p) {
    b.hitAge = 0
    // the field ripple point in the slot group's local frame
    b.slot.group.updateWorldMatrix(true, false)
    _a.copy(p)
    G.root.localToWorld(_a)
    _inv.copy(b.slot.group.matrixWorld).invert()
    b.hitPos.copy(_a.applyMatrix4(_inv))
  }

  // ---------------------------------------------------------------- per frame
  function update(dt, player) {
    uTime.value = G.time
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      b.hitSoundCd -= dt
      b.passCd -= dt
      b.hitAge += dt
      // the player stepping through: the field shimmers where they cross (energy tier) or the scrap / steel shudders
      if (player && b.intact) {
        const dx = player.x - b.pos.x, dy = player.y - b.pos.y, dz = player.z - b.pos.z
        const along = dx * b.fwd.x + dz * b.fwd.z, lat = dx * b.right.x + dz * b.right.z
        const inside = Math.abs(lat) <= b.halfWidth + 0.3 && Math.abs(along) <= b.halfDepth + 0.35 && dy > -1 && dy < 2.5
        if (inside && !b.playerInside) {
          b.passes++
          _b.copy(player).y += 1.1
          if (b.tier === 3) setHit(b, _b)
          else b.shake = Math.min(1, b.shake + 0.6)
          if (b.passCd <= 0) {
            b.passCd = 0.4
            const clips = b.tier === 3 ? FIELD_SFX : HIT_SFX
            K.sfx(K.pick(clips), _b, b.tier === 3 ? 0.45 : 0.35, 1 + (K.rand() - 0.5) * 0.2)
          }
        }
        b.playerInside = inside
      } else b.playerInside = false
      if (b.tier <= 0) continue
      b.shake = Math.max(0, b.shake - dt * 4)
      const m = b.models[b.tier - 1]
      if (b.tier < 3) m.position.z = b.rest[b.tier - 1] + Math.sin(G.time * 55) * 0.025 * b.shake
      if (b.sweepT < 1) {
        // the new tier rises into place (a short lift so a build reads, Barricade.Fanfare's burst does the rest)
        b.sweepT = Math.min(1, b.sweepT + dt / 0.4)
        const k = 1 - (1 - b.sweepT) * (1 - b.sweepT)
        m.position.y = -0.5 * (1 - k)
        m.scale.set(1, 0.85 + 0.15 * k, 1)
      }
      if (b.tier === 3 && b.field) {
        const u = b.field.material.uniforms
        u.uHitAge.value = b.hitAge
        u.uHitPos.value.copy(b.hitPos)
        u.uIntensity.value = 0.85 + 0.15 * Math.sin(G.time * 2.3 + b.index)
      }
    }
  }

  return { list, load, reset, update, setTier, refresh, repairCost, revive, repairFree, fanfare, blocking, strikePoint, damage, hitFx, tierHealth, BARRICADE }
}
