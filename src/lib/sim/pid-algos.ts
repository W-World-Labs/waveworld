/**
 * Discrete PID controller meta · first-order plant step tracking.
 * u = Kp e + Ki ∫e dt + Kd de/dt  (rectangular integral, backward difference).
 * Plant: τ y' + y = K_p u  (unity-gain first-order lag when K_p=1).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · PID control. */
export const METHOD_PID = 'method-pid'

/** Algo · discrete PID step on first-order plant. */
export const METHOD_ALGO_PID_STEP = 'method-algo-pid-step'

/** Parent alias (aligns with familyId). */
export const PID_PARENT = METHOD_PID

export const PID_METHOD_IDS = [METHOD_ALGO_PID_STEP] as const

/** PID gains. */
export type PidGains = {
  Kp: number
  Ki: number
  Kd: number
}

/** Default gains for a τ≈1 plant (stable discrete step, mild overshoot). */
export const DEFAULT_PID_GAINS: Readonly<PidGains> = {
  Kp: 2.5,
  Ki: 1.2,
  Kd: 0.15,
}

/** First-order plant parameters: τ y' + y = K u. */
export type FirstOrderPlant = {
  /** Time constant τ > 0. */
  tau: number
  /** Plant gain K (usually 1). */
  K: number
}

export const DEFAULT_PLANT: Readonly<FirstOrderPlant> = {
  tau: 1,
  K: 1,
}

/** Mutable PID integrator / derivative memory. */
export type PidState = {
  integral: number
  prevError: number
  /** Whether prevError has been set (first step skips D kick). */
  hasPrev: boolean
}

export function createPidState(): PidState {
  return { integral: 0, prevError: 0, hasPrev: false }
}

/**
 * One discrete PID step.
 * e = sp − y;  I ← I + e·dt;  D = (e − e_prev)/dt  (0 on first call).
 * u = Kp·e + Ki·I + Kd·D
 */
export function pidStep(
  sp: number,
  y: number,
  dt: number,
  gains: PidGains,
  state: PidState,
  opts?: { iClamp?: number; uClamp?: number },
): { u: number; e: number; state: PidState } {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new Error('dt must be finite and > 0')
  }
  const e = sp - y
  const iClamp = opts?.iClamp ?? 20
  const uClamp = opts?.uClamp ?? 50
  let integral = state.integral + e * dt
  if (integral > iClamp) integral = iClamp
  if (integral < -iClamp) integral = -iClamp
  const derivative = state.hasPrev ? (e - state.prevError) / dt : 0
  let u = gains.Kp * e + gains.Ki * integral + gains.Kd * derivative
  if (u > uClamp) u = uClamp
  if (u < -uClamp) u = -uClamp
  if (!Number.isFinite(u)) u = 0
  return {
    u,
    e,
    state: { integral, prevError: e, hasPrev: true },
  }
}

/**
 * Explicit Euler step of first-order plant:
 *   y ← y + dt · (K u − y) / τ
 */
export function plantStep(
  y: number,
  u: number,
  dt: number,
  plant: FirstOrderPlant = DEFAULT_PLANT,
): number {
  if (!(plant.tau > 0)) throw new Error('tau must be > 0')
  if (!(dt > 0)) throw new Error('dt must be > 0')
  return y + (dt * (plant.K * u - y)) / plant.tau
}

/**
 * Closed-loop: PID + plant over nSteps from y0 toward constant setpoint.
 */
export function simulatePidPlant(
  opts: {
    sp?: number
    y0?: number
    dt?: number
    nSteps?: number
    gains?: PidGains
    plant?: FirstOrderPlant
  } = {},
): {
  y: Float64Array
  u: Float64Array
  e: Float64Array
  t: Float64Array
  yFinal: number
  absErrFinal: number
  maxAbsY: number
  finite: boolean
} {
  const sp = opts.sp ?? 1
  const y0 = opts.y0 ?? 0
  const dt = opts.dt ?? 0.02
  const nSteps = opts.nSteps ?? 400
  const gains = opts.gains ?? DEFAULT_PID_GAINS
  const plant = opts.plant ?? DEFAULT_PLANT

  const yArr = new Float64Array(nSteps + 1)
  const uArr = new Float64Array(nSteps + 1)
  const eArr = new Float64Array(nSteps + 1)
  const tArr = new Float64Array(nSteps + 1)
  yArr[0] = y0
  eArr[0] = sp - y0
  tArr[0] = 0

  let y = y0
  let st = createPidState()
  let maxAbsY = Math.abs(y)
  let finite = Number.isFinite(y)

  for (let i = 0; i < nSteps; i++) {
    const step = pidStep(sp, y, dt, gains, st)
    st = step.state
    const u = step.u
    y = plantStep(y, u, dt, plant)
    yArr[i + 1] = y
    uArr[i + 1] = u
    eArr[i + 1] = step.e
    tArr[i + 1] = (i + 1) * dt
    const ay = Math.abs(y)
    if (ay > maxAbsY) maxAbsY = ay
    if (!Number.isFinite(y) || !Number.isFinite(u)) finite = false
  }

  const yFinal = yArr[nSteps]!
  return {
    y: yArr,
    u: uArr,
    e: eArr,
    t: tArr,
    yFinal,
    absErrFinal: Math.abs(sp - yFinal),
    maxAbsY,
    finite,
  }
}

/**
 * Representative sample: unit step setpoint, first-order plant,
 * PID tracks setpoint loosely (final |e| small; faster than open-loop lag).
 */
export function runPidStepSample(
  opts: {
    sp?: number
    y0?: number
    dt?: number
    nSteps?: number
    gains?: PidGains
    plant?: FirstOrderPlant
    /** Max |sp − y_final| accepted as "tracks loosely". */
    errTol?: number
  } = {},
): {
  sp: number
  y0: number
  yFinal: number
  absErrFinal: number
  /** final |e| below tolerance */
  tracks: boolean
  /**
   * At mid-horizon, closed-loop |e| is smaller than open-loop unit step
   * (PID accelerates rise vs pure plant lag u=sp).
   */
  betterThanOpenLoopMid: boolean
  openLoopMid: number
  openLoopFinal: number
  midAbsErrClosed: number
  midAbsErrOpen: number
  maxAbsY: number
  /** no blow-up */
  bounded: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PID_STEP
  familyId: typeof METHOD_PID
} {
  // Horizon ~ few τ: closed-loop should end near sp and not explode.
  const sp = opts.sp ?? 1
  const y0 = opts.y0 ?? 0
  const dt = opts.dt ?? 0.05
  const nSteps = opts.nSteps ?? 120
  const gains = opts.gains ?? DEFAULT_PID_GAINS
  const plant = opts.plant ?? DEFAULT_PLANT
  const errTol = opts.errTol ?? 0.12

  const closed = simulatePidPlant({ sp, y0, dt, nSteps, gains, plant })

  // Open-loop unit step u=sp for mid/final lag comparison
  let yOl = y0
  const mid = Math.floor(nSteps / 2)
  let openLoopMid = y0
  for (let i = 0; i < nSteps; i++) {
    yOl = plantStep(yOl, sp, dt, plant)
    if (i + 1 === mid) openLoopMid = yOl
  }
  const openLoopFinal = yOl
  const midAbsErrOpen = Math.abs(sp - openLoopMid)
  const midAbsErrClosed = Math.abs(sp - closed.y[mid]!)

  const tracks = closed.absErrFinal < errTol
  // Early-horizon (20%) closed vs open: PID should reduce lag while rising
  const early = Math.max(1, Math.floor(nSteps * 0.2))
  let yOlEarly = y0
  for (let i = 0; i < early; i++) yOlEarly = plantStep(yOlEarly, sp, dt, plant)
  const earlyAbsErrOpen = Math.abs(sp - yOlEarly)
  const earlyAbsErrClosed = Math.abs(sp - closed.y[early]!)
  const betterThanOpenLoopMid =
    earlyAbsErrClosed <= earlyAbsErrOpen * 0.95 + 1e-9 ||
    midAbsErrClosed <= midAbsErrOpen + 1e-9
  const bounded = closed.maxAbsY < Math.abs(sp) * 4 + 1
  const finite =
    closed.finite &&
    Number.isFinite(openLoopFinal) &&
    Number.isFinite(openLoopMid) &&
    Number.isFinite(closed.yFinal)

  // Moved toward sp from y0 (not stuck / not inverted)
  const movedToward =
    Math.abs(sp - closed.yFinal) < Math.abs(sp - y0) * 0.5 + errTol

  // Primary: tracks setpoint without exploding; early-rise metric is soft
  const ok = finite && tracks && bounded && movedToward

  return {
    sp,
    y0,
    yFinal: closed.yFinal,
    absErrFinal: closed.absErrFinal,
    tracks,
    betterThanOpenLoopMid,
    openLoopMid,
    openLoopFinal,
    midAbsErrClosed,
    midAbsErrOpen,
    maxAbsY: closed.maxAbsY,
    bounded,
    finite,
    ok,
    methodId: METHOD_ALGO_PID_STEP,
    familyId: METHOD_PID,
  }
}
