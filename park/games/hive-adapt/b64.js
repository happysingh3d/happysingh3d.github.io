// Hive Adapt: the HUD fonts and the HDR sky ship as base64 inside JSON, because Project 0 serves only
// .js .json .glb images, audio and .txt (no .ttf or .hdr). Decoded once, then cached.
const cache = new Map()
function json(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => r.json()))
  return cache.get(url)
}
export function toBuffer(lines) {
  const s = atob(Array.isArray(lines) ? lines.join('') : lines)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}
/** a subset TTF (Latin, punctuation, arrows, shapes) by name: ChakraPetch-Bold, Rajdhani-Bold, Rajdhani-SemiBold */
export async function fontBuffer(asset, name) {
  const j = await json(asset('assets/fonts/fonts.json'))
  return toBuffer(j[name])
}
/** the Radiance .hdr bytes of the environment sky */
export async function hdrBuffer(asset) {
  const j = await json(asset('assets/sky/sky_env.json'))
  return toBuffer(j.data)
}
