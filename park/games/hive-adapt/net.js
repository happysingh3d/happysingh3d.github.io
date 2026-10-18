// Hive Adapt co-op on the Project 0 session (up to 4 defenders on the lot).
//
// One player, the HOST, runs the Hive: the waves, every spawn, every bug's health and death, the evolution, the queens, the
// supply pods and the outpost's structures (turrets, barricades, the Core). The others (GUESTS) play the same game on the
// host's word: every bug is made with the host's id, runs its own AI here and is eased toward the host's position five times
// a second; a guest's shots show at once and go to the host, which applies them; deaths come back from the host and every
// machine pays its own share for them. Each player simulates their own fighter and is hurt only on their own machine (the bug
// that hunts you on your screen is the one that bites). Fighters are shared 20 times a second (room.input) and drawn by
// remote.js. Biomass and Hive Samples from the Hive (kills, wave bonuses, queens, pods) are split between the defenders in
// the run: a solo run's income, shared out (run.js earn()). Building is an op: done at once by whoever pays, applied free on
// the other machines; the host's structures win (room.state 'st', 3 times a second). The host is whoever runs the live run
// (else the session's host); when it leaves, the next player carries the run on from their own copy.
//
// Wire: room.send (<= 1 KB, <= 30 a second): one ordered stream of items per sender, batched every 0.1 s ('ev'); an item too
// big for one message goes in parts ('bg'); bug corrections every 0.2 s ('cr', in parts). Guests send to the host only.
// Items: R run start · b build phase · c combat · x wave clear · go game over · s spawn · k kill · pd pod drop · pt pod taken ·
//        op structure op (host) · oq op request · rf refund · h hits · ry ready · rq start / join · J snapshot · nd need bugs
import * as THREE from 'three'
import { createRemotes, FLAG } from './remote.js'
import { ORDER } from './weapons.js'

const VER = 1
const FLUSH = 0.1, CORRECT = 0.2, STATE = 0.34, INPUT = 0.05, MAXLEN = 880, STALE = 5, BUDGET = 26
const b36 = n => Math.round(n).toString(36)
const r2 = v => Math.round(v * 100) / 100

export function createNet(G) {
  const p0 = G.p0
  const room = p0.room
  const on = !!(room && typeof room.send === 'function')
  const me = () => String((p0.me && p0.me.id) ?? 'me')
  // every id this machine has had (a reconnect gives a new one): anything signed with one of them is our own, echoed back
  const myIds = new Set([me()])
  const mine = s => s != null && myIds.has(String(s))
  const myName = () => String((p0.me && p0.me.name) || 'Defender').slice(0, 24)
  const remotes = createRemotes(G)

  // ---------------------------------------------------------------- peers (other players running Hive Adapt)
  const peers = new Map() // id -> { id, name, color, last, rid, active, tgt, input }
  const localTarget = { id: 'me', pos: null, alive: true, local: true, ok: true }
  const targetList = [localTarget]
  function peerInfo(id) {
    // ids reach us as strings; the session may key its players by number
    let p = null
    const P = p0.players
    if (P && P.get) {
      p = P.get(id) || (/^\d+$/.test(id) ? P.get(Number(id)) : null)
      if (!p && P.forEach) P.forEach(pl => { if (!p && pl && String(pl.id) === id) p = pl })
    }
    return { name: (p && p.name) || 'Ally', color: (p && p.color) || '#7fdcff', found: !!(p && p.name) }
  }
  function touchPeer(id) {
    let p = peers.get(id)
    if (!p) {
      const info = peerInfo(id)
      p = { id, name: info.name, color: typeof info.color === 'string' ? info.color : '#7fdcff', last: G.rt, rid: 0, active: G.rt, lastP: null, shots: -1, tgt: { id, pos: new THREE.Vector3(), alive: false, local: false, ok: true }, input: null, announced: false }
      peers.set(id, p)
      targetList.push(p.tgt)
      p.last = G.rt
      refreshRole()
    }
    p.last = G.rt
    return p
  }
  function dropPeer(id, why) {
    const p = peers.get(id)
    if (!p) return
    peers.delete(id)
    p.tgt.ok = false
    const i = targetList.indexOf(p.tgt); if (i >= 0) targetList.splice(i, 1)
    remotes.remove(id)
    refreshRole()
    if (p.announced && G.state === 'run' && why !== '') toast(p.name + (why || ' left the defence'), 'dim')
  }
  const fresh = p => G.rt - p.last < STALE
  const gamePeers = () => { const a = []; for (const p of peers.values()) if (fresh(p)) a.push(p); return a }

  // ---------------------------------------------------------------- roles
  let rid = 0 // the run this machine is in (0: none)
  let lastSt = null, lastStFrom = null // the host's latest 'st'
  let hostRem = 0
  let wasHost = true
  const liveRun = () => !!(rid && G.state === 'run' && G.run && G.run.phase !== 'over')
  // the latest 'st' of each run (two separate runs can share the session for a moment: they write in turn)
  const runSt = new Map() // rid -> { from, live, at }
  /** the players who count for our roles: everyone, or while our run is live, those in it or in no run (a player in
   *  another live run does not make us a guest of a run we are not in; the runs merge, see maybeMerge) */
  function rolePeers() {
    const all = gamePeers()
    if (!liveRun()) return all
    return all.filter(p => p.input && (!p.rid || p.rid === rid)) // (no input yet: we don't know their run)
  }
  function authority(list) {
    const mine = me()
    // the live run's host keeps the run while it is here
    const s = liveRun() ? runSt.get(rid) : lastSt && lastSt.live && lastStFrom ? { from: lastStFrom, live: 1 } : null
    if (s && s.live && s.from) {
      if (s.from === mine && G.run && G.run.net && G.run.net.active) return mine
      const p = peers.get(s.from)
      if (p && fresh(p) && list.includes(p)) return s.from
    }
    if (liveRun()) {
      if (role.auth === mine && G.run && G.run.net && G.run.net.active) return mine // we hold our run: we keep it while we're here
      for (const p of list) if (p.rid === rid && p.input && p.input.hs) return p.id // says it holds our run
    }
    const ids = [mine]
    for (const p of list) ids.push(p.id)
    const h = room && room.host != null ? String(room.host) : null
    if (h && ids.includes(h)) return h
    ids.sort()
    return ids[0]
  }
  // the roles, worked out once a frame (and when a peer appears or goes): modules ask them many times a frame
  const role = { multi: false, client: false, auth: null }
  let roleSig = ''
  function refreshRole() {
    const list = rolePeers()
    const n = list.length
    role.multi = on && n > 0
    role.auth = role.multi ? authority(list) : me()
    role.client = role.multi && role.auth !== me()
    const sig = n + '|' + role.auth
    if (sig !== roleSig) { roleSig = sig; G.log && G.log('co-op: ' + (n + 1) + ' here, ' + (role.client ? 'guest of ' + role.auth : 'host')) }
  }
  const api = {
    get multi() { return role.multi },
    get client() { return role.client },
    get host() { return !role.client },
    get rid() { return rid },
    targets: () => targetList,
    /** players in this run, me included, who have moved or fired in the last minute (idle visitors take no share) */
    squad() {
      if (!api.multi) return 1
      let n = G.state === 'run' ? 1 : 0
      for (const p of gamePeers()) if (p.rid && p.rid === rid && G.rt - p.active < 60) n++
      return Math.max(1, n)
    },
    hostRemaining: () => hostRem,
    /** for tests: who we follow, each run's last word, the peers' runs */
    debugRoles: () => ({ me: me(), rid, auth: role.auth, client: role.client, runSt: [...runSt].map(([r, v]) => [r, v.from, v.live]), peers: [...peers.values()].map(p => [p.id, p.rid, p.input ? p.input.hs : null, p.input ? p.input.wv : null]) }),
    remotes,
  }

  // ---------------------------------------------------------------- outgoing stream
  const queue = []
  let tokens = BUDGET, flushT = 0, correctT = 0, stateT = 0, inputT = 0, seq = 0, bigId = 0
  const hits = new Map()
  function push(item, urgent) { queue.push(item); if (urgent) flushT = 0 }
  function sendRaw(msg, to) {
    if (!on) return false
    try { if (to != null && typeof room.sendTo === 'function') room.sendTo(to, msg); else room.send(msg) } catch (e) { G.log && G.log('net send failed', e && e.message || e); return false }
    tokens -= 1
    return true
  }
  /** pack queued items into messages (in order); stop when the second's budget is spent */
  function flush(to) {
    if (!queue.length) return
    let batch = [], len = 40
    const out = () => { if (batch.length) { sendRaw({ s: me(), t: 'ev', r: rid, e: batch }, to); batch = []; len = 40 } }
    while (queue.length && tokens >= 1) {
      const it = queue[0]
      const js = JSON.stringify(it)
      if (js.length > MAXLEN) {
        out()
        const parts = Math.ceil(js.length * 1.25 / MAXLEN)
        if (tokens < parts + 1 && tokens < BUDGET - 1) break // wait for room in the budget
        queue.shift()
        sendBig(js, to)
        continue
      }
      if (len + js.length + 1 > MAXLEN) { out(); if (tokens < 1) break }
      queue.shift()
      batch.push(it); len += js.length + 1
    }
    out()
  }
  /** a payload in parts; each part's message stays under 1 KB once its quotes are escaped */
  function sendBig(js, to) {
    const id = ++bigId, parts = []
    for (let at = 0; at < js.length;) {
      let n = Math.min(MAXLEN, js.length - at)
      while (n > 64 && JSON.stringify(js.slice(at, at + n)).length > MAXLEN) n = Math.floor(n * 0.9)
      parts.push(js.slice(at, at + n)); at += n
    }
    parts.forEach((d, i) => sendRaw({ s: me(), t: 'bg', r: rid, id, i, n: parts.length, d }, to))
  }
  const toHost = () => { const a = role.multi ? role.auth : me(); return a === me() ? null : a }
  let wantJoin = -10, joinFrom = null

  // ---------------------------------------------------------------- incoming
  const bigs = new Map() // from -> { id, n, parts }
  function onMessage(data, from) {
    myIds.add(me())
    if (!data || typeof data !== 'object' || mine(data.s)) return // our own, echoed back
    from = String(from ?? data.s)
    touchPeer(from)
    if (data.t === 'ev' && Array.isArray(data.e)) { for (const it of data.e) handle(it, from, data.r) }
    else if (data.t === 'bg') {
      let b = bigs.get(from)
      if (!b || b.id !== data.id) { b = { id: data.id, n: data.n, parts: [] }; bigs.set(from, b) }
      b.parts[data.i] = data.d
      if (b.parts.filter(x => x != null).length === b.n) {
        bigs.delete(from)
        let it = null
        try { it = JSON.parse(b.parts.join('')) } catch (e) { it = null }
        if (it) handle(it, from, data.r)
      }
    } else if (data.t === 'cr') correction(data, from)
  }
  const inMyRun = r => rid !== 0 && r === rid && G.state === 'run'
  function handle(it, from, r) {
    if (!Array.isArray(it)) return
    const host = api.host, E = G.enemies, RN = G.run && G.run.net
    try {
      switch (it[0]) {
        // ---- host -> guests
        case 'R': // a new run: players already in a run (or on its end screen) come along; the title stays for the others
          // (a player in a live run of their own stays: two live runs merge by seniority, see maybeMerge)
          if (!(G.rt - wantJoin < 10 && from === joinFrom) && (host || from !== role.auth || liveRun())) return
          if ((G.state === 'run' || G.rt - wantJoin < 10) && rid !== it[1]) { rid = it[1]; wantJoin = -10; G.run.netEnter(null) }
          return
        case 'J': // our snapshot: join the run in progress (asked from the title, or to merge our run into theirs)
          if (host && !(G.rt - wantJoin < 10 && from === joinFrom)) return
          if (!it[1]) return // an old version's run without an id: nothing in it would reach us
          rid = it[1]; wantJoin = -10
          role.auth = from // the sender holds this run (until its own word says otherwise)
          enterSnapshot(it[2])
          return
        case 'b': if (inMyRun(r) && RN) RN.build(it[1]); return
        case 'c': if (inMyRun(r) && RN) RN.combat(); return
        case 'x': if (inMyRun(r) && RN) RN.cleared(); return
        case 'go': if (inMyRun(r) && RN) RN.over(it[1]); return
        case 's': if (inMyRun(r) && E) E.netSpawn(it[1]); return
        case 'k': if (inMyRun(r) && E) kill(it); return
        case 'pd': if (inMyRun(r) && RN) RN.podDrop(new THREE.Vector3(it[1], it[2], it[3]), it[4]); return
        case 'op': if (inMyRun(r) && !mine(it[3]) && G.towers.applyOp) G.towers.applyOp(it[1], it[2]); return
        case 'rf': if (inMyRun(r)) { const got = G.run.earn(it[1], 'refund'); if (got > 0) toast('Someone else got there first  ·  ' + got + ' Biomass back', 'info') } return
        // ---- anyone
        case 'pt': if (inMyRun(r) && RN && !mine(it[4])) RN.podTaken(it[1], it[2], it[3]); return
        // ---- guests -> host
        case 'h': if (host && inMyRun(r) && E) applyHits(it, from); return
        case 'oq': if (host && inMyRun(r)) opRequest(it, from); return
        case 'ry': if (host && inMyRun(r) && RN) RN.ready(); return
        case 'rq': if (host) startRequest(from); return
        case 'nd': if (host && inMyRun(r) && E) { for (const id of it[1] || []) { const e = E.byId(id); if (e && e.alive) push(['s', E.spawnInfo(e)]) } } return
      }
    } catch (e) { G.log && G.log('net item ' + it[0] + ' failed: ' + (e && e.stack || e)) }
  }

  // ---------------------------------------------------------------- the host's side
  function onSpawned(e) { if (api.multi && api.host && rid && G.enemies) push(['s', G.enemies.spawnInfo(e)]) }
  function onKilled(e, info) {
    if (!api.multi || !api.host || !rid || !e || (info && info.net)) return
    info = info || {}
    const killer = info.remote || (info.source === 'player' ? me() : '')
    const d = info.dir
    push(['k', e.id, info.source || '', info.type || '', info.sourceId || '', killer, info.culled ? 1 : 0, d ? r2(d.x) : 0, d ? r2(d.z) : 0])
  }
  const _hd = new THREE.Vector3()
  function applyHits(it, from) {
    const E = G.enemies, p = peers.get(from)
    for (const h of it[1] || []) {
      const e = E.byId(h[0])
      if (!e || !e.alive) continue
      const info = {
        amount: +h[1] || 0, type: h[2] || 'Ballistic', source: 'player', sourceId: h[3] || '', weak: !!h[4], part: h[5] == null ? undefined : h[5],
        weakBonus: +h[6] || 0, armorBreak: +h[7] || 0, stagger: +h[8] || 0, dir: new THREE.Vector3(+h[9] || 0, 0, +h[10] || 0),
        point: h[11] ? new THREE.Vector3(h[11][0], h[11][1], h[11][2]) : undefined, remote: from, byName: p ? p.name : 'Ally',
      }
      if (info.dir.lengthSq() < 1e-6) info.dir.set(0, 0, -1)
      info.dir.normalize()
      E.damage(e, info)
    }
  }
  function opRequest(it, from) {
    const p = peers.get(from)
    const name = p ? p.name : 'Ally'
    const done = G.towers.applyOp(it[1], name)
    if (done) push(['op', it[1], name, from])
    else if (it[2] > 0) sendRaw({ s: me(), t: 'ev', r: rid, e: [['rf', it[2]]] }, from) // their spend comes back; the next 'st' undoes their copy
  }
  function startRequest(from) {
    const RN = G.run && G.run.net
    if (RN && RN.active) { sendSnapshot(from); return }
    // no run (or it ended): start a fresh one for everyone in the run state
    G.run.start()
  }
  function sendSnapshot(to) {
    const RN = G.run.net, E = G.enemies
    if (!rid) api.runStarted() // a run from before ids were given to solo runs
    const snap = RN.snapshot()
    if (!snap) return
    snap.en = []
    for (const e of [...E.list, ...E.siegeNodes]) if (e && e.alive) { const s = E.spawnInfo(e); s.hp = Math.round(e.hp); snap.en.push(s) }
    sendBig(JSON.stringify(['J', rid, snap]), to)
  }
  function writeState(force, starting) {
    if (!on || !room.set || !rid) return
    const RN = G.run.net
    const st = { h: me(), r: rid, live: RN.active || starting ? 1 : 0, ph: G.run.phase, w: G.run.wave, bt: r2(Math.max(0, G.run.buildTime || 0)), rem: RN.remaining, s: G.towers.netState ? G.towers.netState() : '' }
    runSt.set(rid, { from: st.h, live: st.live, at: G.rt }) // our own word on our run (the session may not echo it back)
    const js = JSON.stringify(st)
    if (!force && js === writeState.last) return
    writeState.last = js
    try { room.set('st', st) } catch (e) { /* over the rate: next time */ }
  }
  /** host: positions and health of every live bug, 5 times a second, in parts */
  function sendCorrections() {
    const E = G.enemies
    const rows = []
    for (const e of E.list) {
      if (!e.alive) continue
      rows.push(b36(e.id) + ',' + b36(e.pos.x * 10) + ',' + b36(e.pos.y * 10) + ',' + b36(e.pos.z * 10) + ',' + b36(e.hp) + ',' + ((e.armor && e.armor.broken ? 1 : 0)))
    }
    for (const n of E.siegeNodes) if (n.alive) rows.push(b36(n.id) + ',' + b36(n.pos.x * 10) + ',' + b36(n.pos.y * 10) + ',' + b36(n.pos.z * 10) + ',' + b36(n.hp) + ',2')
    const parts = []
    let cur = ''
    for (const r of rows) { if (cur.length + r.length + 1 > MAXLEN) { parts.push(cur); cur = '' } cur += (cur ? ';' : '') + r }
    parts.push(cur)
    if (tokens < parts.length + 2) return // corrections wait for room in the budget
    seq++
    parts.forEach((d, i) => sendRaw({ s: me(), t: 'cr', r: rid, q: seq, i, n: parts.length, d }))
  }

  // ---------------------------------------------------------------- the guests' side
  /** ['k', id, source, type, sourceId, killer, culled, dirX, dirZ] */
  function kill(it) {
    const killer = it[5]
    const p = peers.get(killer)
    const info = { source: it[2] || undefined, type: it[3] || undefined, sourceId: it[4] || undefined, remote: killer && killer !== me() ? killer : undefined, byName: killer === me() ? myName() : p ? p.name : 'Ally', culled: it[6] === 1 }
    if (it[7] || it[8]) info.dir = new THREE.Vector3(it[7], 0, it[8]).normalize()
    G.enemies.netKill(it[1], info)
  }
  /** our own shot landed (enemies.damage on a guest): batched per bug, weapon and spot, sent with the next flush */
  api.hit = (e, info) => {
    if (!api.client || !rid) return
    const key = e.id + '|' + (info.sourceId || '') + '|' + (info.type || '') + '|' + (info.weak ? 1 : 0) + '|' + (info.part || '')
    let h = hits.get(key)
    if (!h) {
      const pt = info.point
      h = [e.id, 0, info.type || 'Ballistic', info.sourceId || '', info.weak ? 1 : 0, info.part ?? null, r2(info.weakBonus || 0), r2(info.armorBreak || 0), 0, 0, 0, pt ? [r2(pt.x), r2(pt.y), r2(pt.z)] : 0]
      hits.set(key, h)
    }
    h[1] = r2(h[1] + (info.amount || 0))
    h[8] = Math.max(h[8], r2(info.stagger || 0))
    if (info.dir) { h[9] = r2(info.dir.x); h[10] = r2(info.dir.z) }
  }
  const corr = { q: -1, parts: [], n: 0 }
  function correction(m, from) {
    if (!api.client || !inMyRun(m.r) || from !== role.auth) return
    if (m.q !== corr.q) { corr.q = m.q; corr.parts = []; corr.n = m.n }
    corr.parts[m.i] = m.d
    if (corr.parts.filter(x => x != null).length < corr.n) return
    const E = G.enemies, seen = new Set(), need = []
    for (const part of corr.parts) for (const row of part ? part.split(';') : []) {
      const v = row.split(',').map(x => parseInt(x, 36))
      if (v.length < 6 || v.some(x => x !== x)) continue
      seen.add(v[0])
      const e = E.byId(v[0])
      if (!e) { need.push(v[0]); continue }
      E.netCorrect(e, v[1] / 10, v[2] / 10, v[3] / 10, v[4], v[5])
    }
    for (const e of E.list) {
      if (!e.alive || seen.has(e.id)) { if (e.alive) e.netMiss = 0; continue }
      e.netMiss = (e.netMiss || 0) + 1
      if (e.netMiss >= 3) E.netRemove(e) // the host has no such bug
    }
    if (need.length) push(['nd', need.slice(0, 40)])
  }
  function enterSnapshot(snap) {
    if (!snap) return
    G.run.netEnter(snap)
    const E = G.enemies
    for (const s of snap.en || []) { const e = E.netSpawn(s); if (e && s.hp > 0) e.hp = Math.min(e.hp, Math.max(1, s.hp)) }
    hostRem = snap.rem || 0
    try { const st = room.state && room.state.st; if (st && st.r === rid && G.towers.applyNetState) G.towers.applyNetState(st.s) } catch (e) { /* none */ }
    toast('Joined the defence  ·  wave ' + (snap.w || 1) + '  ·  Biomass is shared between defenders', 'info')
  }
  function onState(key, value, from) {
    if (key !== 'st' || !value || typeof value !== 'object') return
    from = String(from ?? value.h)
    lastSt = value; lastStFrom = String(value.h ?? from)
    if (value.r) {
      runSt.set(value.r, { from: lastStFrom, live: value.live, at: G.rt })
      if (runSt.size > 8) for (const [k, v] of runSt) if (G.rt - v.at > 30 && k !== rid) runSt.delete(k)
    }
    if (lastStFrom === me() || !api.client) return
    if (!inMyRun(value.r)) return
    hostRem = value.rem || 0
    if (G.towers.applyNetState) G.towers.applyNetState(value.s)
    if (G.run.net) G.run.net.timer(value.bt, value.ph, value.w)
  }

  // ---------------------------------------------------------------- fighters: ours out, theirs in
  let myShots = 0, myActive = 0
  const myLast = new THREE.Vector3()
  function myInput() {
    const P = G.player, W = G.weapons
    const inRun = G.state === 'run' && G.run.phase !== 'over'
    let f = 0
    if (P) {
      if (P.aiming) f |= FLAG.aim
      if (P.sprinting) f |= FLAG.sprint
      if (P.dodging) f |= FLAG.dodge
      if (!P.grounded) f |= FLAG.air
      if (P.state === 'dead') f |= FLAG.dead
      if (P.state === 'respawning') f |= FLAG.respawn
      if (G.input && G.input.fireHeld) f |= FLAG.fire
      if (W && W.reloading) f |= FLAG.reload
    }
    const p = P && P.pos ? P.pos : myLast
    if (p.distanceToSquared(myLast) > 0.25) { myActive = G.rt; myLast.copy(p) }
    return {
      g: VER, s: me(), r: inRun ? rid : 0, p: [r2(p.x), r2(p.y), r2(p.z)], b: Math.round(P ? P.bodyYawDeg : 0), c: Math.round(P ? P.camYawDeg : 0),
      pi: Math.round(P ? P.camPitchDeg : 0), f, w: Math.max(0, ORDER.indexOf(W && W.current)), fi: (G.fighters && G.fighters.current() && G.fighters.current().id) || 'ronin',
      n: myShots % 1000, h: P ? Math.round(100 * Math.max(0, P.hp) / Math.max(1, P.maxHp)) : 100, a: G.rt - myActive < 60 ? 1 : 0,
      t: Math.round(G.rt * 100) / 100, // when this was sampled (our clock): the others space our positions by it, not by arrival
      wv: inRun ? G.run.wave || 1 : 0, hs: inRun && rid && !role.client ? 1 : 0, // our run's wave; we hold it (merging two runs)
    }
  }
  function onTick(n, inputs) {
    if (!inputs || typeof inputs.forEach !== 'function') return
    myIds.add(me()) // a new id can arrive before the reconnect event
    inputs.forEach((inp, id) => {
      id = String(id)
      if (id === me() || !inp || inp.g !== VER || mine(inp.s) || mine(id)) return // a bot sending our own input back is not a player
      if (!peers.has(id)) G.log && G.log('co-op: player ' + id + ' runs Hive Adapt (signed ' + inp.s + ', we are ' + [...myIds].join('/') + ')')
      const p = touchPeer(id)
      if (!p.named) { const info = peerInfo(id); if (info.found) { p.name = info.name; if (typeof info.color === 'string') p.color = info.color; p.named = true } }
      const wasIn = p.rid
      p.rid = inp.r || 0
      if (inp.a) p.active = G.rt
      p.input = inp
      if (!p.announced && p.rid && p.rid === rid && G.state === 'run') { p.announced = true; toast(p.name + ' joined the defence  ·  Biomass is now shared ' + api.squad() + ' ways', 'info') }
      if (wasIn && !p.rid && p.announced && G.state === 'run') { p.announced = false; toast(p.name + ' left the run', 'dim') }
      const inRun = p.rid && p.rid === rid && G.state === 'run'
      if (inRun) {
        // the Hive hunts them first (their position and state), then they are drawn: a drawing problem must never hide a
        // defender from the bugs or stop the other players' inputs in this tick
        p.tgt.pos.set(inp.p[0], inp.p[1], inp.p[2])
        p.tgt.alive = !(inp.f & FLAG.dead) && !(inp.f & FLAG.respawn)
        let r = null
        try { r = remotes.update(id, { name: p.name, color: p.color }, inp) } catch (e) {
          if (!p.drawErr) { p.drawErr = true; G.log && G.log('co-op: drawing ' + p.name + ' failed: ' + (e && e.message || e)) }
        }
        if (r) r.vroot.visible = true
      } else { remotes.remove(id); p.tgt.alive = false }
    })
  }

  // ---------------------------------------------------------------- lifecycle
  if (on) {
    p0.on('message', onMessage)
    p0.on('state', onState)
    p0.on('tick', onTick)
    p0.on('leave', pl => { if (pl && pl.id != null) dropPeer(String(pl.id)) })
    p0.on('reconnect', () => {
      myIds.add(me())
      // a new session: new ids, new host, empty state. A guest's run is gone; a host carries on alone until others join
      const wasGuest = api.client
      for (const id of [...peers.keys()]) dropPeer(id, '')
      lastSt = null; lastStFrom = null; queue.length = 0; hits.clear(); bigs.clear()
      if (wasGuest && G.state === 'run') { rid = 0; G.run.title(); toast('Connection dropped: the shared run was lost', 'error') }
      if (rid) writeState(true)
    })
    try { if (room.state && room.state.st) onState('st', room.state.st, room.state.st.h) } catch (e) { /* none */ }
  }
  if (G.events) {
    G.events.on('enemySpawned', e => onSpawned(e))
    G.events.on('siegeGrow', n => onSpawned(n))
    G.events.on('enemyKilled', (e, info) => onKilled(e, info))
    G.events.on('shotFired', () => { myShots++; myActive = G.rt })
  }

  // ---------------------------------------------------------------- hooks for run.js / towers.js
  api.runStarted = () => { rid = 1 + Math.floor(Math.random() * 2e9); role.auth = me(); push(['R', rid], true); writeState(true, true) }
  api.phase = (kind, d) => {
    if (!api.multi || !api.host || !rid) return
    if (kind === 'b') push(['b', d], true)
    else if (kind === 'c') push(['c', d.w], true)
    else if (kind === 'x') push(['x', d.w], true)
    else if (kind === 'o') { push(['go', d.k || ''], true); writeState(true) }
  }
  api.ready = () => { if (api.client && rid) { push(['ry'], true); toast('Ready  ·  asking the host to send the wave', 'dim') } }
  api.requestStart = () => {
    const h = toHost()
    if (h == null) { G.run.start(); return }
    wantJoin = G.rt; joinFrom = h
    sendRaw({ s: me(), t: 'ev', r: rid, e: [['rq']] }, h)
    toast('Joining the defence…', 'info')
  }
  /** two separate runs in one session (both started before they saw each other, e.g. one tab was in the background):
   *  the junior run joins the senior one, so everyone defends together. Senior: the higher wave, then the lower host id.
   *  Every machine works it out the same way; the junior's players each ask the senior host for its snapshot. */
  const idLess = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) < Number(b) : String(a) < String(b))
  const senior = (w1, h1, w2, h2) => (w1 !== w2 ? w1 > w2 : idLess(h1, h2))
  let mergeT = 2
  function maybeMerge(rdt) {
    mergeT -= rdt
    if (mergeT > 0) return
    mergeT = 1
    if (!liveRun() || G.rt - wantJoin < 8) return
    const myHost = api.client ? role.auth : me(), myWave = G.run.wave || 1
    let best = null
    for (const p of gamePeers()) {
      const inp = p.input
      if (!p.rid || p.rid === rid || !inp || !inp.hs) continue
      const w = inp.wv || 1
      if (!senior(w, p.id, myWave, myHost)) continue
      if (!best || senior(w, p.id, best.input.wv || 1, best.id)) best = p
    }
    if (!best) return
    wantJoin = G.rt; joinFrom = best.id
    sendRaw({ s: me(), t: 'ev', r: rid, e: [['rq']] }, best.id)
    G.log && G.log('co-op: two runs here: joining ' + best.name + "'s (wave " + (best.input.wv || 1) + ', ours ' + myWave + ')')
    toast(best.name + ' is defending here too  ·  joining their run (wave ' + (best.input.wv || 1) + ')', 'info')
  }
  api.op = (op, cost) => {
    if (!api.multi || !rid) return
    if (api.host) push(['op', op, myName(), me()], true)
    else push(['oq', op, cost || 0], true)
  }
  api.podDropped = pod => { if (api.multi && api.host && rid) push(['pd', r2(pod.pos.x), r2(pod.pos.y), r2(pod.pos.z), pod.contents ? pod.contents.kind : null], true) }
  api.podTaken = (kind, amount) => { if (api.multi && rid) push(['pt', kind, amount, myName(), me()], true) }
  /** the title's co-op line */
  api.lobby = () => {
    if (!api.multi) return null
    const others = gamePeers()
    const st = lastSt && lastSt.live && lastStFrom !== me() ? lastSt : null
    const names = others.map(p => p.name).slice(0, 3).join(', ')
    if (st && api.client) {
      const n = others.filter(p => p.rid && p.rid === st.r).length
      return { label: 'Join the run', line: 'Co-op  ·  ' + (n || 1) + ' defending wave ' + (st.w || 1) + '  ·  ' + names + '  ·  Biomass is split between defenders' }
    }
    return { label: 'Start co-op run', line: 'Co-op  ·  here with ' + names + '  ·  up to 4 defenders  ·  Biomass is split between you' }
  }

  // ---------------------------------------------------------------- every frame (main.js, after the modules)
  api.update = (dt, rdt) => {
    if (!on) return
    myIds.add(me())
    tokens = Math.min(BUDGET, tokens + rdt * BUDGET)
    for (const p of [...peers.values()]) if (G.rt - p.last > STALE * 2) dropPeer(p.id)
    refreshRole()
    // our fighter for everyone (always: it also tells the others we are here)
    localTarget.pos = G.player && G.player.pos ? G.player.pos : null
    localTarget.alive = !!(G.player && G.player.alive !== false && G.player.state === 'alive')
    localTarget.id = me()
    inputT -= rdt
    if (inputT <= 0 && typeof room.input === 'function') {
      inputT = api.multi ? INPUT : 0.5
      try { room.input(myInput()) } catch (e) { /* none */ }
    }
    remotes.tick(rdt)
    maybeMerge(rdt)
    const host = api.host
    if (host !== wasHost) {
      wasHost = host
      if (host && rid && G.run.net && G.run.net.active) { // the old host left: carry the run on from our copy
        G.run.netAdopt(hostRem)
        writeState(true)
        toast('The host left: you are holding the run now', 'info')
      }
    }
    if (api.multi && rid && G.state === 'run') {
      if (host) {
        correctT -= rdt
        if (correctT <= 0) { correctT = CORRECT; sendCorrections() }
        stateT -= rdt
        if (stateT <= 0) { stateT = STATE; writeState(false) }
      }
    } else hits.clear()
    flushT -= rdt
    if (flushT <= 0 && (queue.length || hits.size)) {
      flushT = FLUSH
      if (hits.size) { push(['h', [...hits.values()]]); hits.clear() }
      flush(null) // everyone hears everything (four players at most); each takes the items meant for its role
    }
  }
  return api

  function toast(t, kind) { try { G.hud && G.hud.toast && G.hud.toast(t, kind) } catch (e) { /* none */ } }
}
