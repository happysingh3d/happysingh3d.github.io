// Hive Adapt: the fighters' legs (the local player and the other defenders, on the procedural trooper rig of standin.js).
// Each leg is a two-bone IK in the plane of travel: the stance foot stays planted while the body passes over it, the swing foot
// follows a curve to the next footfall (a heel kick when running), and the hips ride the stance leg: a walk rises over the
// planted foot, a run dips into it and floats between steps. Step length grows with speed, so the cadence stays natural.
// In the air the legs push off, tuck on the way up and reach for the ground on the way down (a running jump leads with one
// knee); a landing sinks the hips and the planted legs fold under it. A dodge roll tucks; a fallen fighter kneels.
//
// createGait() -> state; poseLegs(state, bones, rig, o) -> { drop, yaw, roll, step }
//   o: { dt, speed (m/s), fc, rc (unit travel direction in the body frame: forward, right), moveAmt 0-1, sprintW 0-1,
//        airW 0-1, vy (m/s), grounded, drop (extra hip drop: crouch, landing, m), tuck 0-1, dead }
//   drop: how far to lower the hips (m); yaw / roll: the pelvis' swing; step: a foot touched down this frame;
//   lean: extra torso pitch in the air (curl rising, open falling); airW: the air pose's weight.
// The swing leaves the ground at the planted foot's speed and pulls back into the next footfall (Hermite), the lift starts
// and ends with no vertical speed, and the planted legs cap the hips without lag, so feet don't slide and knees don't pop.
const PI = Math.PI
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = v => clamp(v, 0, 1)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t) }

/** step length (m) for a speed (m/s): the cadence of a walk at 2 m/s is ~2.6 steps/s, a run at 4.2 ~3.7, a sprint ~4.4 */
export const stepLength = sp => 0.5 + 0.15 * Math.min(Math.max(sp, 0), 7)

export function createGait() {
  return { u: 0, hip: null, lead: 0, airT: 0, inAir: false, runAtTakeoff: 0, stance: [true, true], mk: 0, S: 0.8, aw: 0 }
}

/** sagittal two-bone IK: thigh forward swing phi and knee flex kappa that put the ankle fwd metres ahead and h below the hip */
function ik(a, b, fwd, h, out) {
  const D = clamp(Math.hypot(fwd, h), Math.abs(a - b) + 1e-3, (a + b) * 0.9995)
  const alpha = Math.atan2(fwd, h)
  const beta = Math.acos(clamp((a * a + D * D - b * b) / (2 * a * D), -1, 1))
  out[0] = alpha + beta
  out[1] = PI - Math.acos(clamp((a * a + b * b - D * D) / (2 * a * b), -1, 1))
  return out
}

const SIDES = ['L', 'R']
const _ik = [0, 0]
const legOut = [{ x: 0, lift: 0, foot: 0, us: 0, stance: true }, { x: 0, lift: 0, foot: 0, us: 0, stance: true }]

export function poseLegs(g, B, rig, o) {
  const dt = Math.max(0, Math.min(0.1, o.dt || 0))
  const rest = rig.rest
  const a = rest.shinL ? rest.shinL.length() : 0.42, b = rest.footL ? rest.footL.length() : 0.42
  const L = a + b
  const sp = o.dead ? 0 : Math.max(0, o.speed || 0)
  // stepping in or out: the stride grows from nothing when moving starts and settles the feet under the hips when it stops
  g.mk += ((sp > 0.3 && !o.dead ? 1 : 0) - g.mk) * Math.min(1, dt * 9)
  const move = g.mk
  const sprint = clamp01(o.sprintW || 0)
  const runK = clamp01((sp - 2.6) / 1.6)
  let fc = o.fc, rc = o.rc
  const fl = Math.hypot(fc || 0, rc || 0)
  if (!(fl > 1e-3)) { fc = 1; rc = 0 } else { fc /= fl; rc /= fl }

  // ---- the cycle (two steps), advanced by distance on the ground. A foot can only reach so far ahead of the hips (X0max),
  // so the stance covers duty x step <= 2 X0max: walks take shorter steps, runs spend less of the cycle on the ground
  const crouch = (0.015 + 0.03 * (1 - runK) + 0.035 * runK + 0.02 * sprint) * move // soft knees: a tactical walk, a run
  const Hbase = L * 0.995 - crouch
  const extra = Math.max(0, o.drop || 0) // landing, kneeling, the roll's tuck: straight onto the hips, no easing
  const reach = L * 0.965 // a planted leg keeps a little knee bend: no snap to straight at the footfall
  const X0max = Math.sqrt(Math.max(0, reach * reach - (Hbase - 0.065) * (Hbase - 0.065))) // the hips dip <= 6.5 cm between feet
  const duty = clamp(0.62 - (sp - 1.6) * 0.11, 0.28, 0.62)
  const S = Math.max(0.3, Math.min(stepLength(sp), X0max / duty))
  g.S = S
  if (o.grounded !== false && !o.dead) g.u = (g.u + dt * sp / (2 * S)) % 1
  const X0 = duty * S * move
  const lift = (0.08 + 0.18 * runK + 0.08 * sprint) * move
  const kick = runK
  // the planted foot's speed relative to the hips, per unit of swing: the swing leaves the ground moving with it and
  // pulls back into the next footfall, so the knee and ankle never change speed in a single frame
  const vSt = -2 * X0 * (1 - duty) / Math.max(0.05, duty)
  const TO = (0.25 + 0.3 * runK) * move // toe-off: the heel peels up at the end of a stance
  const HS = -0.16 * (1 - runK) * move // a walk lands on the heel, toes up
  // ---- feet: where each one is in the travel direction (x), how high (lift), stance or swing
  const lim = L * 0.975 // the most a leg may stretch (IK pulls the foot in beyond it)
  const capR = L * 0.966 // the planted legs never let the hips rise past this reach (no lag, so no sliding)
  let hipH = Infinity, cap = Infinity, anyStance = false, step = false
  for (let i = 0; i < 2; i++) {
    const ui = (g.u + i * 0.5) % 1
    const lo = legOut[i]
    if (ui < duty) {
      const us = ui / duty
      lo.x = X0 * (1 - 2 * us); lo.lift = 0
      const hr = Math.sqrt(Math.max(0, reach * reach - lo.x * lo.x))
      const sag = 0.05 * runK * move * Math.sin(PI * us)
      hipH = Math.min(hipH, Math.min(Hbase, hr) - sag)
      cap = Math.min(cap, Math.sqrt(Math.max(0, capR * capR - lo.x * lo.x)))
      anyStance = true
      lo.us = us; lo.stance = true
      lo.foot = TO * smooth((us - 0.6) / 0.4) + HS * (1 - smooth(us / 0.22))
    } else {
      const t = (ui - duty) / (1 - duty), t2 = t * t, t3 = t2 * t
      lo.x = (2 * t3 - 3 * t2 + 1) * -X0 + (t3 - 2 * t2 + t) * vSt * (1 - 0.3 * runK) + (-2 * t3 + 3 * t2) * X0 + (t3 - t2) * vSt * (0.35 + 0.35 * runK)
      // lift: leaves and meets the ground with no vertical speed; a run kicks the heel up early in the swing
      const sn = Math.sin(PI * Math.pow(t, 1 - 0.3 * kick))
      lo.lift = lift * sn * sn
      lo.foot = TO * (1 - smooth(t / 0.45)) + HS * smooth((t - 0.55) / 0.45) + 0.12 * runK * sn * move
      lo.us = t; lo.stance = false
    }
    if (lo.stance && !g.stance[i] && move > 0.3 && o.grounded !== false) step = true
    g.stance[i] = lo.stance
  }
  // between steps the hips float at the height the next footfall can be reached from
  if (!anyStance) hipH = Math.min(Hbase, Math.sqrt(Math.max(0, reach * reach - X0 * X0)))
  if (g.hip == null) g.hip = hipH
  g.hip += (hipH - g.hip) * Math.min(1, dt * 18)
  if (anyStance && o.grounded !== false) g.hip = Math.min(g.hip, cap)
  const H = g.hip - extra

  // ---- the air: push off, tuck rising, reach falling; a running jump leads with the knee that was swinging
  const airborne = o.grounded === false && !o.dead
  // the air pose fades in over a few frames and out at once on touchdown (the landing legs are the ground IK)
  g.aw += ((airborne ? 1 : 0) - g.aw) * Math.min(1, dt * (airborne ? 14 : 30))
  const airW = Math.min(clamp01(o.airW == null ? 1 : o.airW * 1.6), g.aw)
  if (airborne && !g.inAir) {
    g.inAir = true; g.airT = 0; g.runAtTakeoff = runK * move
    const u0 = g.u, u1 = (g.u + 0.5) % 1
    g.lead = (u0 >= duty ? u0 : -1) >= (u1 >= duty ? u1 : -1) ? 0 : 1
  } else if (!airborne) g.inAir = false
  if (airborne) g.airT += dt
  // knees come up through the climb and stay tucked over the top; on the way down the legs reach for the ground
  const rising = smooth(((o.vy || 0) + 3) / 5)
  const push = 1 - smooth(g.airT / 0.16)
  const run0 = g.runAtTakeoff

  // ---- the pelvis swings with the legs (forward hip with the forward foot) and drops on the swinging side; the legs
  // cancel both so the planted feet stay put
  const xs = legOut[0].x - legOut[1].x
  const yaw = -0.1 * move * (X0 > 0.02 ? clamp(xs / (2 * X0), -1, 1) : 0) * (1 - airW)
  const roll = -0.035 * move * (lift > 0.01 ? (legOut[0].lift - legOut[1].lift) / lift : 0) * (1 - airW) * (1 - 0.6 * runK)

  // ---- each leg: IK on the ground, the air pose, the roll's tuck; then onto the bones
  const tuck = clamp01(o.tuck || 0)
  for (let i = 0; i < 2; i++) {
    const lo = legOut[i]
    const sd = SIDES[i]
    const hx = rest['thigh' + sd] ? rest['thigh' + sd].x : (i === 0 ? 0.1 : -0.1)
    let fwd = lo.x * fc + hx * Math.sin(yaw), side = -lo.x * rc
    const h = Math.max(0.05, H - lo.lift + hx * Math.sin(roll))
    // never ask for a fully straight leg (the knee would snap): pull the foot in along the travel line instead
    const dd = Math.hypot(fwd, side, h)
    if (dd > lim) { const k = Math.sqrt(Math.max(0, lim * lim - h * h)) / Math.max(1e-4, Math.hypot(fwd, side)); fwd *= Math.min(1, k); side *= Math.min(1, k) }
    // the leg's plane tilts out to the side foot (a side step), so the IK works on the distance down that tilted plane
    ik(a, b, fwd, Math.hypot(side, h), _ik)
    let phi = _ik[0], kappa = _ik[1]
    let foot = phi - kappa + lo.foot // flat, plus the heel strike / toe-off roll
    let sideA = Math.atan2(side, Math.max(0.2, h))
    if (airW > 0.001) {
      const lead = i === g.lead
      // standing jump: both knees up, a little apart; running: the lead knee drives up, the trail leg folds behind
      const sPhi = lead ? lerp(0.24, 1.05, rising) : lerp(0.1, 0.9, rising)
      const sKap = lead ? lerp(0.38, 1.75, rising) : lerp(0.45, 1.6, rising)
      const rPhi = lead ? lerp(0.4, 1.2, rising) : lerp(-0.05, -0.4, rising)
      const rKap = lead ? lerp(0.45, 1.5, rising) : lerp(0.6, 1.7, rising)
      let aPhi = lerp(sPhi, rPhi, run0), aKap = lerp(sKap, rKap, run0)
      // push-off: both legs extend for the first moment
      aPhi = lerp(aPhi, lead ? 0.12 : -0.22, push)
      aKap = lerp(aKap, lead ? 0.25 : 0.08, push)
      const aFoot = aPhi - aKap + 0.12 + 0.25 * rising + 0.3 * push // pointed off the ground, flatter reaching for it
      phi = lerp(phi, aPhi, airW); kappa = lerp(kappa, aKap, airW); foot = lerp(foot, aFoot, airW)
      sideA *= 1 - airW
    }
    if (tuck > 0.001) { phi = lerp(phi, 1.5, tuck); kappa = lerp(kappa, 2.1, tuck); foot = lerp(foot, phi - kappa, tuck) }
    // the leg's plane leans out first (Z), then the thigh swings within it (X): order YZX keeps the IK exact on side steps
    const th = B['thigh' + sd]
    if (th.rotation.order !== 'YZX') th.rotation.order = 'YZX'
    th.rotation.set(-phi, -yaw, sideA + (i === 0 ? 0.02 : -0.02) * move - roll)
    B['shin' + sd].rotation.set(kappa, 0, 0)
    B['foot' + sd].rotation.set(foot, 0, 0)
  }
  // the torso curls over the tucked knees on the way up and opens on the way down
  const lean = airW * (0.14 * rising - 0.05 * (1 - rising)) * (1 - push * 0.6)
  return { drop: Math.max(-0.02, L - H), yaw, roll, step, lean, airW }
}
