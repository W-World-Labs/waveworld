/**
 * Shooting method for 2-point BVP · teaching stubs.
 * Linear BVP y''=y on [0,1], y(0)=0, y(1)=sinh(1); shoot with y'(0)=s via RK4.
 * Secant updates s until |y(1)−target| is small. Exact slope s=1 (y=sinh x).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · shooting method for two-point BVP. */
export const METHOD_SHOOTING = 'method-shooting'

/** Algo · single linear shoot (known / trial slope s). */
export const METHOD_ALGO_SHOOT_LINEAR = 'method-algo-shoot-linear'

/** Algo · secant root-find on residual F(s)=y(1;s)−target. */
export const METHOD_ALGO_SHOOT_SECANT = 'method-algo-shoot-secant'

/** Parent alias (aligns with familyId). */
export const SHOOTING_PARENT = METHOD_SHOOTING

export const SHOOTING_METHOD_IDS = [
  METHOD_ALGO_SHOOT_LINEAR,
  METHOD_ALGO_SHOOT_SECANT,
] as const

/** Default interval [a,b] for the demo BVP. */
export const DEFAULT_A = 0
export const DEFAULT_B = 1

/** Dirichlet left: y(a)=0. */
export const DEFAULT_Y0 = 0

/** Right target y(b)=sinh(1). */
export const DEFAULT_TARGET = Math.sinh(1)

/** Exact initial slope for y=sinh(x) on this BVP. */
export const EXACT_SLOPE = 1

/** Default RK4 steps on [0,1]. */
export const DEFAULT_N_STEPS = 64

/** Vector field for y''=y written as [y,v]: y'=v, v'=y. */
export function sinhField(
  _t: number,
  y: ArrayLike<number>,
  out: Float64Array,
): void {
  out[0] = y[1]!
  out[1] = y[0]!
}

/** Classical RK4 vector single step (returns new array). */
export function rk4StepVec(
  y: ArrayLike<number>,
  t: number,
  dt: number,
  f: (t: number, y: ArrayLike<number>, out: Float64Array) => void,
): Float64Array {
  const n = y.length
  const k1 = new Float64Array(n)
  const k2 = new Float64Array(n)
  const k3 = new Float64Array(n)
  const k4 = new Float64Array(n)
  const tmp = new Float64Array(n)

  f(t, y, k1)
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (dt * k1[i]!) / 2
  f(t + dt / 2, tmp, k2)
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (dt * k2[i]!) / 2
  f(t + dt / 2, tmp, k3)
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + dt * k3[i]!
  f(t + dt, tmp, k4)

  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    out[i] =
      y[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)
  }
  return out
}

/**
 * Integrate y''=y from x=a with y(a)=y0, y'(a)=s to x=b with fixed-step RK4.
 * Returns terminal y(b), y'(b), and optional trajectory samples.
 */
export function integrateShoot(
  s: number,
  opts: {
    a?: number
    b?: number
    y0?: number
    nSteps?: number
    /** If true, store (x,y) at each step including start. */
    storePath?: boolean
  } = {},
): {
  yEnd: number
  vEnd: number
  xEnd: number
  nSteps: number
  dt: number
  pathX?: Float64Array
  pathY?: Float64Array
  finite: boolean
} {
  const a = opts.a ?? DEFAULT_A
  const b = opts.b ?? DEFAULT_B
  const y0 = opts.y0 ?? DEFAULT_Y0
  const nSteps = opts.nSteps ?? DEFAULT_N_STEPS
  if (!(nSteps >= 1) || !Number.isInteger(nSteps)) {
    throw new Error('integrateShoot: nSteps integer ≥ 1')
  }
  if (!(b > a) || !Number.isFinite(s) || !Number.isFinite(y0)) {
    throw new Error('integrateShoot: need b>a, finite s and y0')
  }
  const dt = (b - a) / nSteps
  let state = new Float64Array([y0, s])
  let t = a
  const store = opts.storePath === true
  const pathX = store ? new Float64Array(nSteps + 1) : undefined
  const pathY = store ? new Float64Array(nSteps + 1) : undefined
  if (pathX && pathY) {
    pathX[0] = t
    pathY[0] = state[0]!
  }
  let finite = Number.isFinite(state[0]!) && Number.isFinite(state[1]!)
  for (let i = 0; i < nSteps; i++) {
    state = new Float64Array(rk4StepVec(state, t, dt, sinhField))
    t += dt
    if (!Number.isFinite(state[0]!) || !Number.isFinite(state[1]!)) {
      finite = false
    }
    if (pathX && pathY) {
      pathX[i + 1] = t
      pathY[i + 1] = state[0]!
    }
  }
  return {
    yEnd: state[0]!,
    vEnd: state[1]!,
    xEnd: t,
    nSteps,
    dt,
    pathX,
    pathY,
    finite,
  }
}

/** Residual F(s) = y(b; s) − target for the linear BVP. */
export function shootResidual(
  s: number,
  opts: {
    a?: number
    b?: number
    y0?: number
    target?: number
    nSteps?: number
  } = {},
): number {
  const target = opts.target ?? DEFAULT_TARGET
  const r = integrateShoot(s, opts)
  return r.yEnd - target
}

/**
 * Exact solution of y''=y, y(0)=0, y'(0)=s is y(x)=s·sinh(x).
 * Hence y(1)=s·sinh(1); matching target sinh(1) gives s=1.
 */
export function exactY(x: number, s: number = EXACT_SLOPE): number {
  return s * Math.sinh(x)
}

/**
 * One linear shoot with trial slope s (default exact s=1).
 * Reports terminal mismatch vs target and vs exact sinh profile max-error.
 */
export function shootLinear(
  opts: {
    s?: number
    a?: number
    b?: number
    y0?: number
    target?: number
    nSteps?: number
  } = {},
): {
  s: number
  yEnd: number
  target: number
  residual: number
  absResidual: number
  maxPathErr: number
  finite: boolean
  nSteps: number
  methodId: typeof METHOD_ALGO_SHOOT_LINEAR
  familyId: typeof METHOD_SHOOTING
} {
  const s = opts.s ?? EXACT_SLOPE
  const a = opts.a ?? DEFAULT_A
  const b = opts.b ?? DEFAULT_B
  const target = opts.target ?? DEFAULT_TARGET
  const nSteps = opts.nSteps ?? DEFAULT_N_STEPS
  const r = integrateShoot(s, { ...opts, a, b, nSteps, storePath: true })
  const residual = r.yEnd - target
  let maxPathErr = 0
  if (r.pathX && r.pathY) {
    for (let i = 0; i < r.pathX.length; i++) {
      const e = Math.abs(r.pathY[i]! - exactY(r.pathX[i]!, s))
      if (e > maxPathErr) maxPathErr = e
    }
  }
  const finite =
    r.finite &&
    Number.isFinite(residual) &&
    Number.isFinite(maxPathErr)
  return {
    s,
    yEnd: r.yEnd,
    target,
    residual,
    absResidual: Math.abs(residual),
    maxPathErr,
    finite,
    nSteps,
    methodId: METHOD_ALGO_SHOOT_LINEAR,
    familyId: METHOD_SHOOTING,
  }
}

export type SecantResult = {
  s: number
  residual: number
  absResidual: number
  iterations: number
  history: { s: number; residual: number }[]
  converged: boolean
  finite: boolean
  yEnd: number
  target: number
  methodId: typeof METHOD_ALGO_SHOOT_SECANT
  familyId: typeof METHOD_SHOOTING
}

/**
 * Secant method on F(s)=y(b;s)−target.
 * Two initial guesses s0,s1; update
 *   s ← s1 − F1·(s1−s0)/(F1−F0)
 * until |F| < tol or maxIter.
 */
export function shootSecant(
  opts: {
    s0?: number
    s1?: number
    a?: number
    b?: number
    y0?: number
    target?: number
    nSteps?: number
    tol?: number
    maxIter?: number
  } = {},
): SecantResult {
  const s0init = opts.s0 ?? 0.3
  const s1init = opts.s1 ?? 1.7
  const target = opts.target ?? DEFAULT_TARGET
  const tol = opts.tol ?? 1e-10
  const maxIter = opts.maxIter ?? 30
  const base = {
    a: opts.a,
    b: opts.b,
    y0: opts.y0,
    target,
    nSteps: opts.nSteps,
  }

  let s0 = s0init
  let s1 = s1init
  let f0 = shootResidual(s0, base)
  let f1 = shootResidual(s1, base)
  const history: { s: number; residual: number }[] = [
    { s: s0, residual: f0 },
    { s: s1, residual: f1 },
  ]
  let iterations = 0
  let finite = Number.isFinite(f0) && Number.isFinite(f1)
  let converged = Math.abs(f1) < tol

  while (!converged && iterations < maxIter && finite) {
    const denom = f1 - f0
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-16) {
      finite = false
      break
    }
    const s2 = s1 - (f1 * (s1 - s0)) / denom
    if (!Number.isFinite(s2)) {
      finite = false
      break
    }
    const f2 = shootResidual(s2, base)
    history.push({ s: s2, residual: f2 })
    s0 = s1
    f0 = f1
    s1 = s2
    f1 = f2
    iterations++
    finite = Number.isFinite(f1) && Number.isFinite(s1)
    converged = Math.abs(f1) < tol
  }

  const yEnd = f1 + target
  return {
    s: s1,
    residual: f1,
    absResidual: Math.abs(f1),
    iterations,
    history,
    converged,
    finite,
    yEnd,
    target,
    methodId: METHOD_ALGO_SHOOT_SECANT,
    familyId: METHOD_SHOOTING,
  }
}

/**
 * Demo: shoot with exact slope s=1; residual and path error small.
 */
export function runShootLinearSample(
  opts: {
    s?: number
    nSteps?: number
  } = {},
): {
  s: number
  yEnd: number
  target: number
  absResidual: number
  maxPathErr: number
  exactSlope: typeof EXACT_SLOPE
  matchesExact: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SHOOT_LINEAR
  familyId: typeof METHOD_SHOOTING
} {
  const s = opts.s ?? EXACT_SLOPE
  const r = shootLinear({ s, nSteps: opts.nSteps ?? DEFAULT_N_STEPS })
  const matchesExact = Math.abs(s - EXACT_SLOPE) < 1e-15
  const ok =
    r.finite &&
    r.absResidual < 1e-8 &&
    r.maxPathErr < 1e-8 &&
    (matchesExact ? r.absResidual < 1e-8 : true)
  return {
    s: r.s,
    yEnd: r.yEnd,
    target: r.target,
    absResidual: r.absResidual,
    maxPathErr: r.maxPathErr,
    exactSlope: EXACT_SLOPE,
    matchesExact,
    finite: r.finite,
    ok,
    methodId: METHOD_ALGO_SHOOT_LINEAR,
    familyId: METHOD_SHOOTING,
  }
}

/**
 * Demo: secant from two wrong slopes recovers s≈1 and small residual.
 */
export function runShootSecantSample(
  opts: {
    s0?: number
    s1?: number
    nSteps?: number
    tol?: number
    maxIter?: number
  } = {},
): {
  s: number
  absResidual: number
  iterations: number
  converged: boolean
  slopeErr: number
  exactSlope: typeof EXACT_SLOPE
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SHOOT_SECANT
  familyId: typeof METHOD_SHOOTING
} {
  const r = shootSecant({
    s0: opts.s0 ?? 0.2,
    s1: opts.s1 ?? 1.8,
    nSteps: opts.nSteps ?? DEFAULT_N_STEPS,
    tol: opts.tol ?? 1e-10,
    maxIter: opts.maxIter ?? 30,
  })
  const slopeErr = Math.abs(r.s - EXACT_SLOPE)
  const ok =
    r.finite &&
    r.converged &&
    r.absResidual < 1e-8 &&
    slopeErr < 1e-6
  return {
    s: r.s,
    absResidual: r.absResidual,
    iterations: r.iterations,
    converged: r.converged,
    slopeErr,
    exactSlope: EXACT_SLOPE,
    finite: r.finite,
    ok,
    methodId: METHOD_ALGO_SHOOT_SECANT,
    familyId: METHOD_SHOOTING,
  }
}
