// Hive Adapt 3D: the on-screen panels, painted on canvases that ride in front of the camera. Everything sits
// at the top or in a corner so the fox, who runs in the lower middle of the view, is never covered.
import * as THREE from 'three'
import { canvas, texture } from './art.js'
import * as R from './rules.js'

const SERIF = 'Georgia, "Times New Roman", serif'
const DIST = 2
const GOLD = '#c99b4b'

function plane(c) {
  const t = texture(c)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, fog: false }))
  m.renderOrder = 20
  m.frustumCulled = false
  m.userData = { tex: t }
  return m
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r)
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r)
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y)
  g.closePath()
}

function box(g, w, h, accent = 'rgba(201,155,75,0.85)') {
  g.clearRect(0, 0, w, h)
  roundRect(g, 6, 6, w - 12, h - 12, 30)
  g.fillStyle = 'rgba(16,13,24,0.72)'
  g.fill()
  g.strokeStyle = accent
  g.lineWidth = 3
  g.stroke()
  g.textBaseline = 'middle'
}

function bar(g, x, y, w, h, frac, fill, back = 'rgba(255,255,255,0.12)') {
  g.fillStyle = back
  roundRect(g, x, y, w, h, h / 2); g.fill()
  const fw = Math.max(0, Math.min(1, frac)) * w
  if (fw > h * 0.4) { g.fillStyle = fill; roundRect(g, x, y, fw, h, h / 2); g.fill() }
}

function fitText(g, text, maxW, size, bold = false) {
  let s = size
  g.font = `${bold ? 'bold ' : ''}${s}px ${SERIF}`
  while (g.measureText(text).width > maxW && s > 14) { s -= 2; g.font = `${bold ? 'bold ' : ''}${s}px ${SERIF}` }
  return s
}

const BUG_COL = { crawler: '#b07ae8', rammer: '#ff6a5a', spitter: '#ff7ad1', leech: '#8de07a', queen: '#ff3b2b' }

export class Hud {
  constructor(camera) {
    ;[this.leftC, this.leftG] = canvas(512, 200)
    ;[this.rightC, this.rightG] = canvas(512, 200)
    ;[this.hiveC, this.hiveG] = canvas(640, 200)
    ;[this.banC, this.banG] = canvas(1024, 220)
    ;[this.bossC, this.bossG] = canvas(1024, 90)
    ;[this.panC, this.panG] = canvas(1024, 1024)
    ;[this.mapC, this.mapG] = canvas(256, 256)
    ;[this.logoC, this.logoG] = canvas(1024, 330)
    ;[this.infoC, this.infoG] = canvas(1024, 400)
    ;[this.tallC, this.tallG] = canvas(768, 720)
    this.left = plane(this.leftC)
    this.right = plane(this.rightC)
    this.hive = plane(this.hiveC)
    this.ban = plane(this.banC)
    this.boss = plane(this.bossC)
    this.panel = plane(this.panC)
    this.map = plane(this.mapC)
    this.logo = plane(this.logoC)
    this.info = plane(this.infoC)
    this.tall = plane(this.tallC)
    this.panel.visible = this.ban.visible = this.boss.visible = this.logo.visible = this.info.visible = this.tall.visible = false
    this.play = [this.left, this.right, this.hive, this.map]
    camera.add(this.left, this.right, this.hive, this.ban, this.boss, this.panel, this.map, this.logo, this.info, this.tall)
    this.keys = {}
    this.banT = 0
    this.banLife = 1
    this.stack = false
    this.t = 0
  }

  layout(camera) {
    const h = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const w = h * camera.aspect
    const m = Math.min(w, h) * 0.022
    this.stack = w < h * 1.1
    let bw, bh, hw, hh, topY
    if (!this.stack) {
      bw = Math.min(w * 0.28, h * 0.46); bh = bw * 200 / 512
      hw = Math.min(w * 0.32, h * 0.52); hh = hw * 200 / 640
      this.left.position.set(-w / 2 + m + bw / 2, h / 2 - m - bh / 2, -DIST)
      this.right.position.set(w / 2 - m - bw / 2, h / 2 - m - bh / 2, -DIST)
      this.hive.position.set(0, h / 2 - m - hh / 2, -DIST)
      topY = h / 2 - m - Math.max(bh, hh) - m
    } else {
      bw = (w - 3 * m) / 2; bh = bw * 200 / 512
      hw = w * 0.8; hh = hw * 200 / 640
      this.left.position.set(-w / 2 + m + bw / 2, h / 2 - m - bh / 2, -DIST)
      this.right.position.set(w / 2 - m - bw / 2, h / 2 - m - bh / 2, -DIST)
      this.hive.position.set(0, h / 2 - m - bh - m * 0.6 - hh / 2, -DIST)
      topY = h / 2 - m - bh - m * 0.6 - hh - m
    }
    this.left.scale.set(bw, bh, 1)
    this.right.scale.set(bw, bh, 1)
    this.hive.scale.set(hw, hh, 1)
    const bsw = this.stack ? w - 2 * m : Math.min(w * 0.5, h * 0.9)
    const bsh = bsw * 90 / 1024
    this.boss.scale.set(bsw, bsh, 1)
    this.boss.position.set(0, topY - bsh / 2, -DIST)
    const bnw = this.stack ? w - 2 * m : Math.min(w * 0.5, h * 0.85)
    const bnh = bnw * 220 / 1024
    this.ban.scale.set(bnw, bnh, 1)
    this.ban.position.set(0, topY - bsh - m * 0.5 - bnh / 2, -DIST)
    const mm = this.stack ? w * 0.34 : Math.min(w, h) * 0.3
    this.map.scale.set(mm, mm, 1)
    this.map.position.set(w / 2 - m - mm / 2, -h / 2 + m + mm / 2 + (this.stack ? h * 0.06 : 0), -DIST)
    const pan = Math.min(w * 0.96, h * 0.86)
    this.panel.scale.set(pan, pan, 1)
    this.panel.position.set(0, h * 0.02, -DIST + 0.01)
    const lw = Math.min(w * 0.9, h * 1.1), lh = lw * 330 / 1024
    this.logo.scale.set(lw, lh, 1)
    this.logo.position.set(0, h / 2 - m * 1.5 - lh / 2, -DIST)
    const iw = Math.min(w * 0.9, h * 0.95), ih = iw * 400 / 1024
    this.info.scale.set(iw, ih, 1)
    this.info.position.set(0, -h / 2 + m * 1.5 + ih / 2, -DIST)
    const tw = Math.min(w * 0.9, h * 0.5), th = tw * 720 / 768
    this.tall.scale.set(tw, th, 1)
    this.tall.position.set(0, Math.min(-h / 2 + h * 0.24 + th / 2, h * 0.3 - th / 2), -DIST)
    if (this.logo.visible || this.info.visible || this.tall.visible) this.showTitle(true)
    this.keys = {}
  }

  showPlay(on) { for (const p of this.play) p.visible = on; if (!on) this.boss.visible = false }

  /** s: { wave, bugs, score, bio, hp, hpMax, foxHp, foxMax, dash, prep, phase, hab, resist, gen, nextEvolve, boss } */
  draw(s) {
    const k1 = `${s.wave}|${s.bugs}|${s.score}|${s.phase}|${Math.ceil(s.prep)}|${this.stack}`
    if (k1 !== this.keys.l) {
      this.keys.l = k1
      const g = this.leftG
      box(g, 512, 200)
      g.textAlign = 'left'
      const big = this.stack
      g.fillStyle = GOLD; g.font = `bold ${big ? 36 : 28}px ${SERIF}`
      g.fillText('WAVE', 30, 52)
      g.fillStyle = '#fff1d6'; g.font = `bold ${big ? 76 : 64}px ${SERIF}`
      g.fillText(String(s.wave), big ? 150 : 140, 56)
      g.fillStyle = GOLD; g.font = `bold ${big ? 32 : 26}px ${SERIF}`
      g.fillText(s.phase === 'prep' ? 'NEXT' : 'BUGS', 290, big ? 40 : 38)
      g.fillStyle = s.phase === 'prep' ? '#9be37d' : '#fff1d6'; g.font = `bold ${big ? 54 : 46}px ${SERIF}`
      g.fillText(s.phase === 'prep' ? `${Math.ceil(s.prep)}s` : String(s.bugs), 290, big ? 88 : 84)
      g.fillStyle = GOLD; g.font = `bold ${big ? 32 : 26}px ${SERIF}`
      g.fillText('SCORE', 30, 146)
      g.fillStyle = '#fff1d6'; g.font = `bold ${big ? 58 : 52}px ${SERIF}`
      g.fillText(s.score.toLocaleString('en-US'), big ? 160 : 150, 148)
      this.left.userData.tex.needsUpdate = true
    }
    const k2 = `${Math.floor(s.bio)}|${Math.ceil(s.hp)}|${Math.ceil(s.foxHp)}|${Math.round(s.dash * 10)}|${this.stack}`
    if (k2 !== this.keys.r) {
      this.keys.r = k2
      const g = this.rightG
      const low = s.hp < s.hpMax * 0.3
      box(g, 512, 200, low ? 'rgba(217,67,43,0.95)' : 'rgba(201,155,75,0.85)')
      g.textAlign = 'left'
      if (this.stack) {
        g.fillStyle = GOLD; g.font = `bold 32px ${SERIF}`
        g.fillText('BIO', 26, 50)
        g.fillStyle = '#a8e88c'; g.font = `bold 56px ${SERIF}`
        g.fillText(String(Math.floor(s.bio)), 100, 52)
        g.fillStyle = s.dash >= 0.999 ? '#9be37d' : '#8d8576'; g.font = `bold 32px ${SERIF}`
        g.textAlign = 'right'
        g.fillText(s.dash >= 0.999 ? 'DASH ✓' : 'DASH', 486, 50)
        g.textAlign = 'left'
        g.fillStyle = GOLD; g.font = `bold 30px ${SERIF}`
        g.fillText('SHRINE', 26, 112)
        bar(g, 170, 96, 316, 32, s.hp / s.hpMax, low ? '#d9432b' : '#ffc24a')
        g.fillText('FOX', 26, 162)
        bar(g, 170, 148, 316, 28, s.foxHp / s.foxMax, '#e9d7b4')
      } else {
        g.fillStyle = GOLD; g.font = `bold 26px ${SERIF}`
        g.fillText('BIOMASS', 30, 42)
        g.fillStyle = '#a8e88c'; g.font = `bold 50px ${SERIF}`
        g.fillText(String(Math.floor(s.bio)), 190, 44)
        g.fillStyle = GOLD; g.font = `bold 26px ${SERIF}`
        g.fillText('SHRINE', 26, 98)
        bar(g, 130, 84, 350, 26, s.hp / s.hpMax, low ? '#d9432b' : '#ffc24a')
        g.fillStyle = '#fff'; g.font = `bold 20px ${SERIF}`; g.textAlign = 'center'
        g.fillText(String(Math.ceil(s.hp)), 305, 98)
        g.textAlign = 'left'
        g.fillStyle = GOLD; g.font = `bold 26px ${SERIF}`
        g.fillText('FOX', 26, 142)
        bar(g, 130, 130, 220, 22, s.foxHp / s.foxMax, '#e9d7b4')
        g.fillStyle = GOLD
        g.fillText('DASH', 26, 175)
        bar(g, 130, 164, 220, 18, s.dash, s.dash >= 0.999 ? '#9be37d' : '#7b6a3c')
        if (s.dash >= 0.999) { g.fillStyle = '#9be37d'; g.font = `bold 24px ${SERIF}`; g.fillText('READY', 364, 175) }
      }
      this.right.userData.tex.needsUpdate = true
    }
    const hk = `${s.gen}|${Math.round(s.hab.bolt * 20)}|${Math.round(s.hab.lantern * 20)}|${Math.round(s.hab.burst * 20)}|${Math.round(s.resist.bolt * 100)}|${Math.round(s.resist.lantern * 100)}|${Math.round(s.resist.burst * 100)}|${s.nextEvolve}`
    if (hk !== this.keys.h) {
      this.keys.h = hk
      const g = this.hiveG
      box(g, 640, 200, 'rgba(217,67,43,0.85)')
      g.textAlign = 'left'
      g.fillStyle = '#e8836f'; g.font = `bold 32px ${SERIF}`
      g.fillText(`THE HIVE · GEN ${s.gen}`, 28, 40)
      g.textAlign = 'right'
      g.fillStyle = '#c9bfae'; g.font = `24px ${SERIF}`
      g.fillText(`adapts after wave ${s.nextEvolve}`, 614, 40)
      const rows = [['bolt', 'FOXFIRE'], ['lantern', 'LANTERN'], ['burst', 'DASH']]
      rows.forEach(([key, label], i) => {
        const y = 88 + i * 40
        g.textAlign = 'left'
        g.fillStyle = GOLD; g.font = `bold 26px ${SERIF}`
        g.fillText(label, 28, y)
        bar(g, 172, y - 11, 250, 22, s.hab[key], '#ffc24a')
        const r = Math.round(s.resist[key] * 100)
        g.fillStyle = r > 0 ? '#ff8f78' : '#8d8576'; g.font = `bold 26px ${SERIF}`
        g.fillText(r > 0 ? `resists ${r}%` : 'no resist', 436, y)
      })
      this.hive.userData.tex.needsUpdate = true
    }
    if (s.boss) {
      const bk = `${Math.ceil(s.boss.hp)}`
      if (bk !== this.keys.b) {
        this.keys.b = bk
        const g = this.bossG
        g.clearRect(0, 0, 1024, 90)
        roundRect(g, 6, 14, 1012, 62, 28); g.fillStyle = 'rgba(16,13,24,0.8)'; g.fill()
        g.strokeStyle = 'rgba(217,67,43,0.95)'; g.lineWidth = 3; g.stroke()
        g.textBaseline = 'middle'; g.textAlign = 'left'
        g.fillStyle = '#ff8f78'; g.font = `bold 28px ${SERIF}`
        g.fillText('INK QUEEN', 34, 46)
        bar(g, 250, 32, 740, 28, s.boss.hp / s.boss.max, '#d9432b')
        this.boss.userData.tex.needsUpdate = true
      }
      this.boss.visible = this.play[0].visible
    } else { this.boss.visible = false; this.keys.b = '' }
  }

  /** The arena from above, turned so that up is where the camera looks. */
  drawMap(g, yaw, t, others) {
    const c = this.mapG
    const N = 256, C = 128, k = 112 / 10.2
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw)
    const P = (x, z) => [C + (x * rx + z * rz) * k, C - (x * fx + z * fz) * k]
    c.clearRect(0, 0, N, N)
    c.fillStyle = 'rgba(16,13,24,0.74)'
    c.beginPath(); c.arc(C, C, 124, 0, Math.PI * 2); c.fill()
    c.strokeStyle = 'rgba(201,155,75,0.85)'; c.lineWidth = 3; c.stroke()
    c.fillStyle = 'rgba(239,224,194,0.16)'
    c.beginPath(); c.arc(C, C, R.ARENA_R * k, 0, Math.PI * 2); c.fill()
    // gates
    for (let i = 0; i < R.GATES; i++) {
      const gp = R.gatePos(i)
      const [x, y] = P(gp.x, gp.z)
      const open = g.phase === 'wave' && g.gatesOpen.includes(i) && g.queue.length > 0
      c.fillStyle = open ? (Math.sin(t * 10) > 0 ? '#ff5a3a' : '#ffb04a') : 'rgba(217,67,43,0.6)'
      c.beginPath(); c.arc(x, y, open ? 9 : 6, 0, Math.PI * 2); c.fill()
    }
    // pads
    for (const p of g.pads) {
      const [x, y] = P(p.x, p.z)
      c.strokeStyle = p.level ? '#ffc24a' : 'rgba(255,220,160,0.45)'
      c.lineWidth = 2
      c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.stroke()
      if (p.level) { c.fillStyle = p.jam > 0 ? '#3a2c5c' : '#ffc24a'; c.beginPath(); c.arc(x, y, 2 + p.level * 1.5, 0, Math.PI * 2); c.fill() }
    }
    // shrine with its health as a ring
    const [sx, sy] = P(0, 0)
    c.fillStyle = '#ffc24a'
    c.beginPath(); c.arc(sx, sy, 8, 0, Math.PI * 2); c.fill()
    c.strokeStyle = g.core.hp < g.core.max * 0.3 ? '#ff4a3a' : '#ffe2a6'
    c.lineWidth = 4
    c.beginPath(); c.arc(sx, sy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, g.core.hp / g.core.max)); c.stroke()
    // bugs
    for (const e of g.enemies) {
      const [x, y] = P(e.x, e.z)
      c.fillStyle = BUG_COL[e.kind] || '#fff'
      const r = e.kind === 'queen' ? 7 : e.kind === 'rammer' ? 4 : 3
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
    }
    for (const o of others) {
      const [x, y] = P(o.x, o.z)
      c.fillStyle = 'rgba(160,220,255,0.9)'
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill()
    }
    // the fox, an arrow along its facing
    if (g.fox.down <= 0) {
      const f = g.fox
      const [x, y] = P(f.x, f.z)
      const dx = Math.cos(f.face), dz = Math.sin(f.face)
      const ax = dx * rx + dz * rz, ay = -(dx * fx + dz * fz)
      c.save(); c.translate(x, y); c.rotate(Math.atan2(ay, ax) + Math.PI / 2)
      c.fillStyle = '#fff1d6'; c.strokeStyle = '#17131f'; c.lineWidth = 2
      c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath(); c.fill(); c.stroke()
      c.restore()
    }
    this.map.userData.tex.needsUpdate = true
  }

  banner(title, sub = '', color = '#ffd98a', life = 2.4) {
    const g = this.banG
    g.clearRect(0, 0, 1024, 220)
    roundRect(g, 20, 14, 984, 192, 44)
    g.fillStyle = 'rgba(16,13,24,0.7)'; g.fill()
    g.strokeStyle = color; g.lineWidth = 4; g.stroke()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = color
    fitText(g, title, 940, sub ? 76 : 88, true)
    g.fillText(title, 512, sub ? 84 : 110)
    if (sub) {
      g.fillStyle = '#f3e8d4'
      fitText(g, sub, 920, 36)
      g.fillText(sub, 512, 156)
    }
    this.ban.userData.tex.needsUpdate = true
    this.ban.visible = true
    this.ban.material.opacity = 1
    this.banT = 0
    this.banLife = life
  }

  update(dt) {
    this.t += dt
    if (this.info.visible) this.info.material.opacity = 0.82 + 0.18 * Math.sin(this.t * 3)
    if (this.tall.visible) this.tall.material.opacity = 0.82 + 0.18 * Math.sin(this.t * 3)
    if (!this.ban.visible) return
    this.banT += dt
    if (this.banT >= this.banLife) { this.ban.visible = false; return }
    const t = this.banT / this.banLife
    this.ban.material.opacity = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2
  }

  hidePanel() { this.panel.visible = false }

  /** The title over the live arena: the name at the top, how to play at the bottom. */
  drawTitle(best) {
    let g = this.logoG
    g.clearRect(0, 0, 1024, 330)
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `bold 150px ${SERIF}`
    g.lineWidth = 18; g.strokeStyle = 'rgba(20,14,26,0.9)'; g.lineJoin = 'round'
    g.strokeText('HIVE ADAPT', 512, 120)
    const grad = g.createLinearGradient(0, 50, 0, 190)
    grad.addColorStop(0, '#fff3d6'); grad.addColorStop(1, '#ffc24a')
    g.fillStyle = grad
    g.fillText('HIVE ADAPT', 512, 120)
    g.font = `bold 58px ${SERIF}`
    g.lineWidth = 12
    g.strokeText('FOXFIRE WATCH', 512, 236)
    g.fillStyle = '#ff7a5c'
    g.fillText('FOXFIRE WATCH', 512, 236)
    g.font = `italic 30px ${SERIF}`
    g.lineWidth = 8
    g.strokeText('an endless ink-bug swarm, and a Hive that learns', 512, 296)
    g.fillStyle = '#f3e8d4'
    g.fillText('an endless ink-bug swarm, and a Hive that learns', 512, 296)
    this.logo.userData.tex.needsUpdate = true

    g = this.infoG
    g.clearRect(0, 0, 1024, 400)
    roundRect(g, 14, 10, 996, 380, 46)
    g.fillStyle = 'rgba(14,11,22,0.74)'; g.fill()
    g.strokeStyle = 'rgba(201,155,75,0.9)'; g.lineWidth = 4; g.stroke()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    const lines = [
      ['WASD or stick: run  ·  drag or Q / E: turn the camera', '#f3e8d4'],
      ['Foxfire shoots by itself  ·  SPACE, SHIFT or tap: dash burst', '#f3e8d4'],
      ['Stand on a pad to build a lantern  ·  at the shrine to mend it', '#f3e8d4'],
      [best, '#c9bfae'],
    ]
    lines.forEach(([text, color], i) => {
      g.fillStyle = color
      fitText(g, text, 940, 34)
      g.fillText(text, 512, 62 + i * 58)
    })
    g.fillStyle = '#ffbf45'
    fitText(g, 'PRESS ANY KEY OR TAP TO DEFEND THE SHRINE', 940, 42, true)
    g.fillText('PRESS ANY KEY OR TAP TO DEFEND THE SHRINE', 512, 336)
    this.info.userData.tex.needsUpdate = true

    g = this.tallG
    g.clearRect(0, 0, 768, 720)
    roundRect(g, 12, 10, 744, 700, 46)
    g.fillStyle = 'rgba(14,11,22,0.76)'; g.fill()
    g.strokeStyle = 'rgba(201,155,75,0.9)'; g.lineWidth = 4; g.stroke()
    g.textAlign = 'center'; g.textBaseline = 'middle'
    const tall = [
      ['Stick: run the Ink Fox', '#f3e8d4'],
      ['Drag: turn the camera', '#f3e8d4'],
      ['Foxfire shoots by itself', '#f3e8d4'],
      ['Tap, or push the stick hard: dash', '#f3e8d4'],
      ['Stand on a pad: build a lantern', '#f3e8d4'],
      ['Stand at the shrine: mend it', '#f3e8d4'],
      [best, '#c9bfae'],
    ]
    tall.forEach(([text, color], i) => {
      g.fillStyle = color
      fitText(g, text, 700, 44)
      g.fillText(text, 384, 66 + i * 76)
    })
    g.fillStyle = '#ffbf45'
    fitText(g, 'TAP TO DEFEND THE SHRINE', 700, 50, true)
    g.fillText('TAP TO DEFEND THE SHRINE', 384, 650)
    this.tall.userData.tex.needsUpdate = true
  }

  showTitle(on) {
    this.logo.visible = on
    this.info.visible = on && !this.stack
    this.tall.visible = on && this.stack
  }

  /** lines: [text, size?, color?] or text */
  drawPanel(title, lines, footer, accent = GOLD) {
    const g = this.panG
    g.clearRect(0, 0, 1024, 1024)
    roundRect(g, 40, 110, 944, 800, 60)
    g.fillStyle = 'rgba(14,11,22,0.8)'
    g.fill()
    g.strokeStyle = accent
    g.lineWidth = 5
    g.stroke()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#ffd98a'
    fitText(g, title, 860, 72, true)
    g.fillText(title, 512, 200)
    let y = 290
    for (const line of lines) {
      const [text, size = 38, color = '#f3e8d4'] = Array.isArray(line) ? line : [line]
      fitText(g, text, 890, size, size >= 44)
      g.fillStyle = color
      g.fillText(text, 512, y)
      y += size * 1.42
    }
    if (footer) {
      g.fillStyle = '#ffbf45'
      fitText(g, footer, 890, 38, true)
      g.fillText(footer, 512, 850)
    }
    this.panel.userData.tex.needsUpdate = true
    this.panel.visible = true
  }
}
