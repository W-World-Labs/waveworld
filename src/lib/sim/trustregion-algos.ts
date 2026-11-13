/**
 * Trust-region · Cauchy point pure algo.
 * Quadratic model m(s)=f + g·s + 0.5 s^T B s; Cauchy step inside ||s||≤Δ.
 * Reduce f on SPD quadratic bowl; method id constants only (no catalog).
 */

/** Family · trust region. */
export const METHOD_TRUST_REGION = 'method-trust-region'

/** Algo · Cauchy point step in trust ball. */
export const METHOD_ALGO_TR_CAUCHY = 'method-algo-tr-cauchy'

/** Parent alias (aligns with familyId). */
export const TRUST_REGION_PARENT = METHOD_TRUST_REGION

export const TRUST_REGION_METHOD_IDS = [METHOD_ALGO_TR_CAUCHY] as const

export type CauchyPointResult = {
  /** step s (length n) */
  s: Float64Array
  /** ||s||₂ */
  stepNorm: number
  /** τ* ∈ (0,1] along steepest-descent ray */
  tau: number
  /** true if ||s|| is at the trust boundary (within tol) */
  onBoundary: boolean
  /** model reduction m(0) − m(s) ≥ 0 */
  modelReduction: number
}

/** ‖v‖₂ */
export function norm2(v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** u · v */
export function dot(u: Float64Array | number[], v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < u.length; i++) s += u[i]! * v[i]!
  return s
}

/** y = B x, B row-major dense n×n. */
export function denseMatVec(
  B: ArrayLike<number>,
  n: number,
  x: Float64Array | number[] | ArrayLike<number>,
  y: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    let s = 0
    const row = i * n
    for (let j = 0; j < n; j++) s += B[row + j]! * x[j]!
    y[i] = s
  }
}

/**
 * Quadratic objective f(x) = 0.5 x^T A x − b · x (A SPD row-major).
 * ∇f = A x − b.
 */
export function quadraticValue(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
  x: Float64Array | number[] | ArrayLike<number>,
): number {
  let axDot = 0
  let bDot = 0
  for (let i = 0; i < n; i++) {
    let axi = 0
    const row = i * n
    for (let j = 0; j < n; j++) axi += A[row + j]! * x[j]!
    axDot += x[i]! * axi
    bDot += b[i]! * x[i]!
  }
  return 0.5 * axDot - bDot
}

export function quadraticGrad(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
  x: Float64Array | number[] | ArrayLike<number>,
  out: Float64Array,
): void {
  denseMatVec(A, n, x, out)
  for (let i = 0; i < n; i++) out[i]! -= b[i]!
}

/**
 * SPD diagonal-dominant sample: A_ii = 2 + i*0.1, A_ij = 0.1 (i≠j).
 * RHS so x* = (1,...,1).
 */
export function makeSpdQuadraticSystem(n: number): {
  A: Float64Array
  b: Float64Array
  xTrue: Float64Array
  n: number
} {
  const A = new Float64Array(n * n)
  const xTrue = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xTrue[i] = 1
    for (let j = 0; j < n; j++) {
      A[i * n + j] = i === j ? 2 + i * 0.1 : 0.1
    }
  }
  const b = new Float64Array(n)
  denseMatVec(A, n, xTrue, b)
  return { A, b, xTrue, n }
}

/**
 * Cauchy point for model m(s) = f + g·s + 0.5 s^T B s
 * subject to ||s|| ≤ Δ.
 *
 * s^C = −τ* (Δ / ||g||) g, with
 *   τ* = 1 if g^T B g ≤ 0,
 *   τ* = min(1, ||g||³ / (Δ · g^T B g)) otherwise
 * (Nocedal–Wright).
 *
 * If ||g|| = 0, returns s = 0.
 */
export function cauchyPoint(
  g: Float64Array | number[],
  B: ArrayLike<number>,
  delta: number,
  opts?: { boundaryTol?: number },
): CauchyPointResult {
  const n = g.length
  if (!(delta > 0) || !Number.isFinite(delta)) {
    throw new Error('cauchyPoint: need Δ > 0')
  }
  const gNorm = norm2(g)
  const s = new Float64Array(n)
  if (!(gNorm > 0) || !Number.isFinite(gNorm)) {
    return {
      s,
      stepNorm: 0,
      tau: 0,
      onBoundary: false,
      modelReduction: 0,
    }
  }

  const Bg = new Float64Array(n)
  denseMatVec(B, n, g, Bg)
  const gBg = dot(g, Bg)

  let tau: number
  if (!(gBg > 0) || !Number.isFinite(gBg)) {
    // non-positive curvature along −g: go to boundary
    tau = 1
  } else {
    const num = gNorm * gNorm * gNorm
    const den = delta * gBg
    tau = Math.min(1, num / den)
  }
  if (!Number.isFinite(tau) || tau < 0) tau = 0
  if (tau > 1) tau = 1

  const scale = -tau * (delta / gNorm)
  for (let i = 0; i < n; i++) s[i] = scale * g[i]!

  const stepNorm = norm2(s)
  const boundaryTol = opts?.boundaryTol ?? 1e-10
  const onBoundary = Math.abs(stepNorm - delta) <= boundaryTol * Math.max(1, delta)

  // model reduction: −(g·s + 0.5 s^T B s)
  const Bs = new Float64Array(n)
  denseMatVec(B, n, s, Bs)
  const modelReduction = -(dot(g, s) + 0.5 * dot(s, Bs))

  return { s, stepNorm, tau, onBoundary, modelReduction }
}

/**
 * One Cauchy trust-region step: x ← x + s^C with model Hessian B.
 * Returns new x, f before/after (if A,b provided for true f), and Cauchy meta.
 */
export function cauchyStep(
  x: Float64Array,
  g: Float64Array,
  B: ArrayLike<number>,
  delta: number,
): { xNew: Float64Array; cauchy: CauchyPointResult } {
  const cauchy = cauchyPoint(g, B, delta)
  const xNew = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) xNew[i] = x[i]! + cauchy.s[i]!
  return { xNew, cauchy }
}

/**
 * Multi-step Cauchy TR on quadratic f with B = A (exact Hessian).
 * Fixed or mildly adaptive Δ; stops on small grad or maxIter.
 */
export function cauchyTrustRegionMinimize(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
  opts?: {
    x0?: Float64Array
    delta0?: number
    maxIter?: number
    tol?: number
  },
): {
  x: Float64Array
  fValues: number[]
  gradNorms: number[]
  iterations: number
  converged: boolean
  deltas: number[]
} {
  const maxIter = opts?.maxIter ?? 40
  const tol = opts?.tol ?? 1e-10
  let delta = opts?.delta0 ?? 1
  const x = new Float64Array(n)
  if (opts?.x0) {
    for (let i = 0; i < n; i++) x[i] = opts.x0[i]!
  }

  const g = new Float64Array(n)
  const fValues: number[] = []
  const gradNorms: number[] = []
  const deltas: number[] = []

  quadraticGrad(A, b, n, x, g)
  let fx = quadraticValue(A, b, n, x)
  let gNorm = norm2(g)
  fValues.push(fx)
  gradNorms.push(gNorm)
  deltas.push(delta)

  let iterations = 0
  let converged = gNorm < tol
  const trial = new Float64Array(n)

  while (!converged && iterations < maxIter) {
    const cp = cauchyPoint(g, A, delta)
    for (let i = 0; i < n; i++) trial[i] = x[i]! + cp.s[i]!
    const fNew = quadraticValue(A, b, n, trial)

    // ratio of actual to predicted reduction (quadratic model = exact f for this bowl)
    const pred = cp.modelReduction
    const actual = fx - fNew
    let accept = Number.isFinite(fNew) && actual > 0

    if (pred > 1e-16) {
      const rho = actual / pred
      if (rho < 0.25) {
        delta *= 0.25
        accept = accept && rho > 0
      } else if (rho > 0.75 && cp.onBoundary) {
        delta = Math.min(delta * 2, 1e6)
      }
    } else if (!(actual > 0)) {
      delta *= 0.25
      accept = false
    }

    if (accept) {
      for (let i = 0; i < n; i++) x[i] = trial[i]!
      fx = fNew
      quadraticGrad(A, b, n, x, g)
      gNorm = norm2(g)
    } else if (!(delta > 1e-16)) {
      break
    }

    iterations++
    fValues.push(fx)
    gradNorms.push(gNorm)
    deltas.push(delta)
    converged = gNorm < tol
  }

  return { x, fValues, gradNorms, iterations, converged, deltas }
}

/**
 * Representative sample: Cauchy TR on SPD quadratic bowl.
 * f decreases; step stays inside Δ; ok teaching gate.
 */
export function runTrCauchySample(
  opts: {
    n?: number
    maxIter?: number
    tol?: number
    delta0?: number
  } = {},
): {
  n: number
  f0: number
  fF: number
  grad0: number
  gradF: number
  fDecreased: boolean
  residualDecreased: boolean
  maxErr: number
  singleStepNorm: number
  singleDelta: number
  singleWithinRadius: boolean
  singleModelReduction: number
  iterations: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_TR_CAUCHY
  familyId: typeof METHOD_TRUST_REGION
} {
  const n = opts.n ?? 5
  const maxIter = opts.maxIter ?? 50
  const tol = opts.tol ?? 1e-10
  const delta0 = opts.delta0 ?? 0.5

  const sys = makeSpdQuadraticSystem(n)
  const x0 = new Float64Array(n)
  for (let i = 0; i < n; i++) x0[i] = 0.2 + 0.15 * i

  // single Cauchy step checks
  const g0 = new Float64Array(n)
  quadraticGrad(sys.A, sys.b, n, x0, g0)
  const singleDelta = 0.8
  const single = cauchyPoint(g0, sys.A, singleDelta)
  const singleWithinRadius = single.stepNorm <= singleDelta + 1e-12

  const r = cauchyTrustRegionMinimize(sys.A, sys.b, n, {
    x0,
    delta0,
    maxIter,
    tol,
  })

  const f0 = r.fValues[0]!
  const fF = r.fValues[r.fValues.length - 1]!
  const grad0 = r.gradNorms[0]!
  const gradF = r.gradNorms[r.gradNorms.length - 1]!
  const fDecreased = fF < f0
  const residualDecreased = gradF < grad0 * 1e-4 || gradF < 1e-8

  let maxErr = 0
  let finite = Number.isFinite(f0) && Number.isFinite(fF) && Number.isFinite(single.modelReduction)
  for (let i = 0; i < n; i++) {
    const e = Math.abs(r.x[i]! - sys.xTrue[i]!)
    if (e > maxErr) maxErr = e
    if (!Number.isFinite(r.x[i]!)) finite = false
  }
  if (!Number.isFinite(single.stepNorm)) finite = false

  const ok =
    finite &&
    fDecreased &&
    residualDecreased &&
    singleWithinRadius &&
    single.modelReduction >= -1e-14 &&
    (r.converged || maxErr < 1e-4 || gradF < 1e-6)

  return {
    n,
    f0,
    fF,
    grad0,
    gradF,
    fDecreased,
    residualDecreased,
    maxErr,
    singleStepNorm: single.stepNorm,
    singleDelta,
    singleWithinRadius,
    singleModelReduction: single.modelReduction,
    iterations: r.iterations,
    converged: r.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_TR_CAUCHY,
    familyId: METHOD_TRUST_REGION,
  }
}
