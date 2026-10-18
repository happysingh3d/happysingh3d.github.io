// Hive Adapt: asset loading and the Unity material library (HiveBuilder.Art.cs BuildMaterials, ported).
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { col, hdr } from './u.js'

export function createAssets(p0, opts = {}) {
  const loader = new GLTFLoader()
  // the platform runs games in a Web Worker: no <img>, so textures come in as ImageBitmaps (pre-flipped, flipY off)
  const bitmapLoader = new THREE.ImageBitmapLoader()
  bitmapLoader.setOptions({ imageOrientation: 'flipY' })
  /** a Texture that fills in when its ImageBitmap arrives (worker-safe stand-in for TextureLoader.load) */
  function loadTexture(url, onLoad) {
    const t = new THREE.Texture()
    t.flipY = false
    bitmapLoader.load(url, bmp => { t.image = bmp; t.needsUpdate = true; if (onLoad) onLoad(t) }, undefined, e => p0.log?.('[hive] texture failed ' + url + ' ' + (e && e.message || e)))
    return t
  }
  const loadTextureAsync = url => new Promise(resolve => { loadTexture(url, resolve) })
  const glbCache = new Map()
  const texCache = new Map()
  const matCache = new Map()
  const lite = !!opts.lite
  let maxAniso = 4

  function glb(name) {
    if (!glbCache.has(name)) glbCache.set(name, loader.loadAsync(p0.asset(`assets/models/${name}.glb`)))
    return glbCache.get(name)
  }
  async function clone(name) {
    const g = await glb(name)
    return SkeletonUtils.clone(g.scene)
  }
  function tex(name, { repeat = 1, srgb } = {}) {
    const key = name + '|' + repeat
    if (texCache.has(key)) return texCache.get(key)
    const t = loadTexture(p0.asset(`assets/tex/${name}.jpg`))
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat, repeat)
    t.colorSpace = (srgb ?? /albedo/.test(name)) ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = maxAniso
    texCache.set(key, t)
    return t
  }
  function setRenderer(r) { try { maxAniso = Math.min(8, r.capabilities.getMaxAnisotropy()) } catch (e) { /* default */ } }

  // PolyLit(name, set, tiling, tint, smooth, normalScale): URP Lit with a Poly Haven albedo + normal
  function polyLit(set, tiling, tint, smooth = 1, normalScale = 1, metal = 0) {
    const m = new THREE.MeshStandardMaterial({
      color: tint,
      map: tex(`${set}_albedo`, { repeat: tiling }),
      normalMap: lite ? null : tex(`${set}_normal`, { repeat: tiling }),
      roughness: 1 - 0.55 * smooth,
      metalness: metal,
    })
    if (m.normalMap) m.normalScale.set(normalScale, normalScale)
    return m
  }
  function plain(color, rough = 0.6, metal = 0, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }) }
  function emissive(color, strength) {
    return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: strength, roughness: 0.5 })
  }

  const ACCENT = col(0, 0.898, 1)
  const AMBER = col(1, 0.69, 0)
  const defs = {
    M_Concrete: () => polyLit('brushed_concrete', 0.5, col(0.92, 0.9, 0.86)),
    M_ConcreteWall: () => polyLit('concrete_block_wall_02', 0.4, col(1, 1, 1)),
    M_RustMetal: () => polyLit('rusty_metal_02', 0.6, col(1, 1, 1), 1, 1, 0.3),
    M_Corrugated: () => polyLit('rusty_corrugated_iron', 0.4, col(1, 1, 1), 1, 1, 0.3),
    M_ContainerPaint: () => polyLit('green_metal_rust', 0.35, col(1, 1, 1), 1, 1, 0.2),
    M_DarkMetal: () => polyLit('metal_plate', 0.8, col(0.32, 0.33, 0.35), 1, 0.5, 0.6),
    M_GunMetal: () => polyLit('metal_plate', 1.5, col(0.16, 0.16, 0.17), 1.2, 0.6, 0.7),
    M_Hazard: () => polyLit('metal_plate', 1, col(0.95, 0.66, 0.06), 0.8, 0.4, 0.2),
    M_Grate: () => polyLit('metal_grate_rusty', 0.8, col(1, 1, 1), 1, 1, 0.4),
    M_Rock: () => polyLit('rock_boulder_dry', 0.35, col(1, 1, 1)),
    M_Sandbag: () => polyLit('dirty_concrete', 0.8, col(0.78, 0.68, 0.5), 0.6),
    M_Asphalt: () => polyLit('asphalt_02', 0.3, col(1, 1, 1)),
    M_CliffRock: () => polyLit('rock_boulder_dry', 0.2, col(0.8, 0.68, 0.58), 0.8, 1.4),
    M_Planks: () => polyLit('weathered_planks', 0.7, col(0.92, 0.86, 0.8), 0.7),
    M_WallConcrete: () => polyLit('dirty_concrete', 0.3, col(0.86, 0.83, 0.78), 0.8),
    M_Brass: () => plain(col(0.85, 0.62, 0.28), 0.3, 1),
    M_EmissiveLime: () => emissive(col(0.72, 1, 0.24), 3),
    M_EmissiveCyan: () => emissive(ACCENT, 1.6),
    M_EmissiveAmber: () => emissive(col(1, 0.55, 0.12), 3),
    M_Interactable: () => emissive(AMBER, 1.4),
    M_CoreEnergy: () => emissive(ACCENT, 3),
    M_Glass: () => new THREE.MeshStandardMaterial({ color: col(0.6, 0.85, 0.95), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }),
    M_Rubber: () => plain(col(0.09, 0.09, 0.09), 0.8),
    M_Armour: () => polyLit('metal_plate', 1.2, col(0.26, 0.27, 0.29), 1.05, 0.5, 0.6),
    M_ArmourDark: () => polyLit('metal_plate', 1.2, col(0.13, 0.135, 0.145), 1.15, 0.45, 0.6),
    M_ArmourBlack: () => polyLit('metal_plate', 1.2, col(0.06, 0.062, 0.07), 1.3, 0.4, 0.6),
    M_Trim: () => polyLit('metal_plate', 1.5, col(0.15, 0.155, 0.17), 1.2, 0.5, 0.6),
    W_Steel: () => { const m = polyLit('blue_metal_plate', 0.2, col(0.95, 0.68, 0.58), 0.55, 0.6, 0.6); return m },
    W_Worn: () => plain(col(0.56, 0.56, 0.57), 0.35, 1),
    W_Hazard: () => plain(col(0.95, 0.66, 0.06), 0.55, 0),
    W_Polymer: () => plain(col(0.075, 0.075, 0.08), 0.75, 0),
    W_FDE: () => plain(col(0.6, 0.52, 0.4), 0.8, 0),
    W_OD: () => plain(col(0.33, 0.35, 0.26), 0.78, 0),
    W_Rubber: () => plain(col(0.045, 0.045, 0.045), 0.9, 0),
    W_ShellRed: () => plain(col(0.6, 0.08, 0.06), 0.6, 0),
    // obsidian (Core level 4+) versions of the base categories (HiveBuilder.BaseLook.cs:27-35)
    O_Wall: () => polyLit('metal_plate', 0.3, col(0.11, 0.12, 0.14), 1, 0.6, 0.5),
    O_Floor: () => polyLit('metal_plate', 0.5, col(0.22, 0.24, 0.27), 1, 0.6, 0.5),
    O_Panel: () => polyLit('metal_plate', 1.2, col(0.075, 0.085, 0.1), 1.2, 0.7, 0.6),
    O_Trim: () => polyLit('metal_plate', 1.5, col(0.2, 0.225, 0.26), 1.2, 0.5, 0.6),
    O_Grate: () => polyLit('metal_grate_rusty', 0.8, col(0.25, 0.27, 0.3), 1, 1, 0.5),
  }
  function mat(name) {
    if (matCache.has(name)) return matCache.get(name)
    const make = defs[name]
    const m = make ? make() : plain(0x999999)
    m.name = name
    matCache.set(name, m)
    return m
  }
  /** replace every material on a loaded model with the shared library material of the same name */
  function dress(obj, overrides = {}) {
    obj.traverse(o => {
      if (!o.isMesh) return
      const swap = m => {
        const base = (m && m.name || '').replace(/\.\d+$/, '')
        return overrides[base] || mat(base)
      }
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
      o.castShadow = true
      o.receiveShadow = true
    })
    return obj
  }
  return { glb, clone, tex, mat, dress, setRenderer, loadTexture, loadTextureAsync, polyLit, emissive, ACCENT, AMBER, defs }
}

export { col, hdr }
