/**
 * BDF2 multistep ODE integrators · teaching stubs.
 * (3 y_{n+1} − 4 y_n + y_{n−1}) / (2 dt) = f(t_{n+1}, y_{n+1}).
 * Bootstrap with BDF1 or RK4; y′=−y uses direct solve (or fixed-point).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · backward differentiation formulas. */
export const METHOD_BDF = 'method-bdf'

/** Algo · second-order BDF (Gear). */
export const METHOD_ALGO_BDF2 = 'method-algo-bdf2'

/** Parent alias (aligns with familyId). */
export const BDF_PARENT = METHOD_BDF

export const BDF_METHOD_IDS = [METHOD_ALGO_BDF2] as const

export type ScalarOde = (t: number, y: number) => number

/** Exponential decay y′ = −y; exact y(t)=y0 e^{−t}. */
export const decayOde: ScalarOde = (_t, y) => -y

export function decayExact(y0: number, t: number): number {
  return y0 * Math.exp(-t)
}

/**
 * BDF1 (backward Euler) for y′=−y:
 *   (y_{n+1} − y_n)/dt = −y_{n+1}
 *   y_{n+1} = y_n / (1+dt)
 */
export function bdf1StepDecay(y: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt) || !Number.isFinite(y)) {
    throw new Error('bdf1StepDecay: need finite y and dt>0')
  }
  return y / (1 + dt)
}

/**
 * BDF2 for y′=−y (direct solve):
 *   (3 y+ − 4 y_n + y_{n−1}) / (2 dt) = −y+
 *   y+ = (4 y_n − y_{n−1}) / (3 + 2 dt)
 */
export function bdf2StepDecay(yN: number, yNm1: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new Error('bdf2StepDecay: need dt>0')
  }
  if (!Number.isFinite(yN) || !Number.isFinite(yNm1)) {
    throw new Error('bdf2StepDecay: need finite history')
  }
  return (4 * yN - yNm1) / (3 + 2 * dt)
}

/**
 * Fixed-point BDF2 step for general scalar f:
 *   y+ = (4/3) y_n − (1/3) y_{n−1} + (2 dt / 3) f(t+, y+)
 * Iterate from predictor y0 until |Δy| < tol or maxIter.
 */
export function bdf2StepFixedPoint(
  yN: number,
  yNm1: number,
  tN: number,
  dt: number,
  f: ScalarOde,
  opts: { tol?: number; maxIter?: number; yPredict?: number } = {},
): { y: number; iterations: number; converged: boolean } {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new Error('bdf2StepFixedPoint: need dt>0')
  }
  const tol = opts.tol ?? 1e-12
  const maxIter = opts.maxIter ?? 40
  const tPlus = tN + dt
  let y =
    opts.yPredict ??
    (2 * yN - yNm1) // linear extrapolate predictor
  let converged = false
  let iterations = 0
  const a = (4 / 3) * yN - (1 / 3) * yNm1
  const c = (2 * dt) / 3
  for (let k = 0; k < maxIter; k++) {
    const yNew = a + c * f(tPlus, y)
    iterations = k + 1
    if (!Number.isFinite(yNew)) {
      return { y: yNew, iterations, converged: false }
    }
    if (Math.abs(yNew - y) < tol) {
      y = yNew
      converged = true
      break
    }
    y = yNew
  }
  return { y, iterations, converged }
}

/**
 * Classical RK4 single step (bootstrap).
 */
export function rk4Step(
  y: number,
  t: number,
  dt: number,
  f: ScalarOde,
): number {
  const k1 = f(t, y)
  const k2 = f(t + dt / 2, y + (dt * k1) / 2)
  const k3 = f(t + dt / 2, y + (dt * k2) / 2)
  const k4 = f(t + dt, y + dt * k3)
  return y + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
}

/**
 * Forward Euler single step (stiff-ish baseline for comparison).
 */
export function eulerStep(
  y: number,
  t: number,
  dt: number,
  f: ScalarOde,
): number {
  return y + dt * f(t, y)
}

export type BdfBootstrap = 'bdf1' | 'rk4'

/**
 * Integrate y′=−y with BDF2 after one bootstrap step (BDF1 or RK4).
 * Returns trajectory samples and final value.
 */
export function integrateBdf2Decay(
  y0: number,
  t0: number,
  dt: number,
  nSteps: number,
  opts: {
    bootstrap?: BdfBootstrap
    /** Use fixed-point general step instead of direct decay solve. */
    fixedPoint?: boolean
    tol?: number
    maxIter?: number
  } = {},
): {
  y: number
  t: number
  yHist: Float64Array
  tHist: Float64Array
  finite: boolean
  bootstrap: BdfBootstrap
} {
  if (!(nSteps >= 1) || !Number.isInteger(nSteps)) {
    throw new Error('integrateBdf2Decay: nSteps integer ≥ 1')
  }
  if (!(dt > 0) || !Number.isFinite(dt) || !Number.isFinite(y0)) {
    throw new Error('integrateBdf2Decay: need finite y0 and dt>0')
  }
  const bootstrap: BdfBootstrap = opts.bootstrap ?? 'bdf1'
  const useFp = opts.fixedPoint === true

  const yHist = new Float64Array(nSteps + 1)
  const tHist = new Float64Array(nSteps + 1)
  yHist[0] = y0
  tHist[0] = t0

  // Bootstrap to get y1
  let yNm1 = y0
  let yN: number
  if (bootstrap === 'rk4') {
    yN = rk4Step(y0, t0, dt, decayOde)
  } else {
    yN = bdf1StepDecay(y0, dt)
  }
  yHist[1] = yN
  tHist[1] = t0 + dt

  let finite = Number.isFinite(yN)
  let t = t0 + dt

  for (let n = 1; n < nSteps; n++) {
    let yPlus: number
    if (useFp) {
      const r = bdf2StepFixedPoint(yN, yNm1, t, dt, decayOde, {
        tol: opts.tol,
        maxIter: opts.maxIter,
      })
      yPlus = r.y
      if (!r.converged) finite = false
    } else {
      yPlus = bdf2StepDecay(yN, yNm1, dt)
    }
    yNm1 = yN
    yN = yPlus
    t += dt
    yHist[n + 1] = yN
    tHist[n + 1] = t
    if (!Number.isFinite(yN)) finite = false
  }

  return {
    y: yN,
    t,
    yHist,
    tHist,
    finite,
    bootstrap,
  }
}

/**
 * Integrate with forward Euler (comparison baseline).
 */
export function integrateEulerDecay(
  y0: number,
  t0: number,
  dt: number,
  nSteps: number,
): { y: number; t: number; finite: boolean } {
  let y = y0
  let t = t0
  let finite = true
  for (let i = 0; i < nSteps; i++) {
    y = eulerStep(y, t, dt, decayOde)
    t += dt
    if (!Number.isFinite(y)) finite = false
  }
  return { y, t, finite }
}

/**
 * Demo: BDF2 on y′=−y vs exact and forward Euler.
 * BDF2 is more accurate / stable than Euler on moderate-stiff-ish dt.
 */
export function runBdf2Sample(
  opts: {
    nSteps?: number
    dt?: number
    y0?: number
    bootstrap?: BdfBootstrap
    fixedPoint?: boolean
  } = {},
): {
  yExact: number
  yBdf2: number
  yEuler: number
  bdf2Err: number
  eulerErr: number
  bdf2Better: boolean
  /** Direct vs fixed-point relative agreement when both used. */
  fpAgree: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BDF2
  familyId: typeof METHOD_BDF
} {
  const nSteps = opts.nSteps ?? 40
  const dt = opts.dt ?? 0.1
  const y0 = opts.y0 ?? 1
  const bootstrap = opts.bootstrap ?? 'bdf1'
  const tEnd = nSteps * dt
  const yExact = decayExact(y0, tEnd)

  const bdf = integrateBdf2Decay(y0, 0, dt, nSteps, {
    bootstrap,
    fixedPoint: opts.fixedPoint === true,
  })
  const euler = integrateEulerDecay(y0, 0, dt, nSteps)

  // Cross-check fixed-point vs direct on same grid
  const bdfFp = integrateBdf2Decay(y0, 0, dt, nSteps, {
    bootstrap,
    fixedPoint: true,
  })
  const fpAgree = Math.abs(bdf.y - bdfFp.y)

  const bdf2Err = Math.abs(bdf.y - yExact)
  const eulerErr = Math.abs(euler.y - yExact)
  const bdf2Better = bdf2Err < eulerErr * 0.5

  const finite =
    bdf.finite &&
    euler.finite &&
    bdfFp.finite &&
    Number.isFinite(bdf2Err) &&
    Number.isFinite(eulerErr)

  const ok =
    finite &&
    bdf2Better &&
    bdf2Err < 1e-3 &&
    fpAgree < 1e-10

  return {
    yExact,
    yBdf2: bdf.y,
    yEuler: euler.y,
    bdf2Err,
    eulerErr,
    bdf2Better,
    fpAgree,
    finite,
    ok,
    methodId: METHOD_ALGO_BDF2,
    familyId: METHOD_BDF,
  }
}
