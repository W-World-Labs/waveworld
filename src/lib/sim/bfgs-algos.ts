/**
 * BFGS quasi-Newton pure algo stub.
 * Minimize quadratic f(x)=0.5 x^T A x − b·x (SPD A) or Rosenbrock-lite 2D.
 * BFGS inverse-Hessian update + Armijo line search; gradient residual drops.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · BFGS quasi-Newton. */
export const METHOD_BFGS = 'method-bfgs'

/** Algo · BFGS Hessian / inverse-Hessian update step. */
export const METHOD_ALGO_BFGS_UPDATE = 'method-algo-bfgs-update'

/** Parent alias (aligns with familyId). */
export const BFGS_PARENT = METHOD_BFGS

export const BFGS_METHOD_IDS = [METHOD_ALGO_BFGS_UPDATE] as const

/** Objective: value + gradient at x. */
export type Objective = {
  f: (x: Float64Array) => number
  grad: (x: Float64Array, out: Float64Array) => void
  n: number
}

export type BfgsResult = {
  x: Float64Array
  /** ‖∇f‖₂ history (incl. initial) */
  gradNorms: number[]
  /** f(x) history (incl. initial) */
  fValues: number[]
  iterations: number
  converged: boolean
  /** final inverse-Hessian approx, row-major n×n */
  H: Float64Array
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

/** y = A x, A row-major dense n×n. */
export function denseMatVec(
  A: ArrayLike<number>,
  n: number,
  x: Float64Array | number[],
  y: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    let s = 0
    const row = i * n
    for (let j = 0; j < n; j++) s += A[row + j]! * x[j]!
    y[i] = s
  }
}

/**
 * Quadratic objective f(x) = 0.5 x^T A x − b · x, A SPD row-major.
 * ∇f = A x − b, minimizer x* = A^{-1} b.
 */
export function makeQuadraticObjective(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
): Objective {
  return {
    n,
    f(x) {
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
    },
    grad(x, out) {
      denseMatVec(A, n, x, out)
      for (let i = 0; i < n; i++) out[i]! -= b[i]!
    },
  }
}

/**
 * Rosenbrock-lite: f(x,y) = (1−x)² + β (y − x²)² with mild β (default 10).
 * Classic β=100; lite is easier for short teaching runs.
 * Global min (1,1), f=0.
 */
export function makeRosenbrockLite(beta = 10): Objective {
  return {
    n: 2,
    f(x) {
      const a = 1 - x[0]!
      const b = x[1]! - x[0]! * x[0]!
      return a * a + beta * b * b
    },
    grad(x, out) {
      const xv = x[0]!
      const yv = x[1]!
      const t = yv - xv * xv
      out[0] = -2 * (1 - xv) - 4 * beta * xv * t
      out[1] = 2 * beta * t
    },
  }
}

/**
 * Symmetric SPD diagonal-dominant sample for quadratic BFGS:
 * A_ii = 2 + i*0.1, A_ij = 0.1 (i≠j). RHS so x* = (1,...,1).
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
 * Armijo backtracking: find α s.t. f(x+αp) ≤ f(x) + c α g·p.
 * p is descent (g·p < 0). Returns α > 0, or 0 if stalled.
 */
export function armijoLineSearch(
  obj: Objective,
  x: Float64Array,
  p: Float64Array,
  g: Float64Array,
  fx: number,
  opts?: { c?: number; rho?: number; alpha0?: number; maxBack?: number },
): number {
  const c = opts?.c ?? 1e-4
  const rho = opts?.rho ?? 0.5
  const maxBack = opts?.maxBack ?? 30
  let alpha = opts?.alpha0 ?? 1
  const n = obj.n
  const gp = dot(g, p)
  if (!(gp < 0) || !Number.isFinite(gp)) return 0
  const trial = new Float64Array(n)
  for (let k = 0; k < maxBack; k++) {
    for (let i = 0; i < n; i++) trial[i] = x[i]! + alpha * p[i]!
    const ft = obj.f(trial)
    if (Number.isFinite(ft) && ft <= fx + c * alpha * gp) return alpha
    alpha *= rho
  }
  // failed: do not take a non-Armijo step
  return 0
}

/**
 * BFGS inverse-Hessian update (rank-2):
 * H ← (I − ρ s y^T) H (I − ρ y s^T) + ρ s s^T,  ρ = 1/(y·s).
 * Skips update if y·s ≤ 0 (curvature fail).
 * H is row-major n×n, mutated in place.
 */
export function bfgsUpdateH(
  H: Float64Array,
  s: Float64Array,
  y: Float64Array,
  n: number,
): boolean {
  const ys = dot(y, s)
  if (!(ys > 1e-14) || !Number.isFinite(ys)) return false
  const rho = 1 / ys

  // Hy = H y
  const Hy = new Float64Array(n)
  denseMatVec(H, n, y, Hy)
  const yHy = dot(y, Hy)

  // H ← H − ρ (s (Hy)^T + Hy s^T) + ρ² yHy s s^T + ρ s s^T
  // equivalent compact form used below
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const idx = i * n + j
      H[idx]! +=
        rho * s[i]! * s[j]! * (1 + rho * yHy) -
        rho * (s[i]! * Hy[j]! + Hy[i]! * s[j]!)
    }
  }
  return true
}

/**
 * BFGS minimize: p = −H g, Armijo step, then BFGS H-update.
 * Starts with H = I. Stops when ‖g‖ < tol · max(1, ‖g0‖) or maxIter.
 */
export function bfgsMinimize(
  obj: Objective,
  opts?: {
    x0?: Float64Array
    maxIter?: number
    tol?: number
    armijo?: { c?: number; rho?: number; alpha0?: number; maxBack?: number }
  },
): BfgsResult {
  const n = obj.n
  const maxIter = opts?.maxIter ?? 80
  const tol = opts?.tol ?? 1e-10
  const x = opts?.x0 ? new Float64Array(opts.x0) : new Float64Array(n)
  const H = new Float64Array(n * n)
  for (let i = 0; i < n; i++) H[i * n + i] = 1

  const g = new Float64Array(n)
  const gNew = new Float64Array(n)
  const p = new Float64Array(n)
  const s = new Float64Array(n)
  const y = new Float64Array(n)

  obj.grad(x, g)
  let fx = obj.f(x)
  const gradNorms: number[] = []
  const fValues: number[] = []
  let gNorm = norm2(g)
  gradNorms.push(gNorm)
  fValues.push(fx)

  const g0 = Math.max(gNorm, 1)
  const thresh = tol * g0
  let converged = gNorm < thresh
  let iterations = 0
  let scaled = false

  while (!converged && iterations < maxIter) {
    // p = −H g
    denseMatVec(H, n, g, p)
    for (let i = 0; i < n; i++) p[i] = -p[i]!

    // ensure descent
    if (!(dot(g, p) < 0)) {
      for (let i = 0; i < n; i++) p[i] = -g[i]!
    }

    const alpha = armijoLineSearch(obj, x, p, g, fx, opts?.armijo)
    if (!(alpha > 1e-16)) break

    for (let i = 0; i < n; i++) {
      s[i] = alpha * p[i]!
      x[i]! += s[i]!
    }
    obj.grad(x, gNew)
    fx = obj.f(x)
    for (let i = 0; i < n; i++) y[i] = gNew[i]! - g[i]!

    // Nocedal scale H ← (s·y)/(y·y) I before first rank-2 update
    if (!scaled) {
      const yy = dot(y, y)
      const sy = dot(s, y)
      if (yy > 1e-16 && sy > 0) {
        const sigma = sy / yy
        H.fill(0)
        for (let i = 0; i < n; i++) H[i * n + i] = sigma
      }
      scaled = true
    }
    bfgsUpdateH(H, s, y, n)

    for (let i = 0; i < n; i++) g[i] = gNew[i]!
    gNorm = norm2(g)
    gradNorms.push(gNorm)
    fValues.push(fx)
    iterations++
    converged = gNorm < thresh
  }

  return { x, gradNorms, fValues, iterations, converged, H }
}

/**
 * Representative sample: BFGS on SPD quadratic + Rosenbrock-lite.
 * Gradient residual drops; ok teaching gate.
 */
export function runBfgsUpdateSample(
  opts: {
    n?: number
    maxIter?: number
    tol?: number
    rosenBeta?: number
  } = {},
): {
  n: number
  grad0: number
  gradF: number
  residualDecreased: boolean
  maxErr: number
  rosenGrad0: number
  rosenGradF: number
  rosenF: number
  iterations: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BFGS_UPDATE
  familyId: typeof METHOD_BFGS
} {
  const n = opts.n ?? 6
  const maxIter = opts.maxIter ?? 40
  const tol = opts.tol ?? 1e-10
  const rosenBeta = opts.rosenBeta ?? 10

  const sys = makeSpdQuadraticSystem(n)
  const obj = makeQuadraticObjective(sys.A, sys.b, n)
  const x0 = new Float64Array(n)
  for (let i = 0; i < n; i++) x0[i] = 0.3 + 0.1 * i
  const r = bfgsMinimize(obj, { x0, maxIter, tol })

  let maxErr = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const e = Math.abs(r.x[i]! - sys.xTrue[i]!)
    if (e > maxErr) maxErr = e
    if (!Number.isFinite(r.x[i]!)) finite = false
  }

  const grad0 = r.gradNorms[0]!
  const gradF = r.gradNorms[r.gradNorms.length - 1]!
  const residualDecreased = gradF < grad0 * 1e-4 || gradF < 1e-8

  // Rosenbrock-lite from (−1.2, 1)
  const ros = makeRosenbrockLite(rosenBeta)
  const xRos0 = new Float64Array([-1.2, 1])
  const rr = bfgsMinimize(ros, {
    x0: xRos0,
    maxIter: 80,
    tol: 1e-10,
  })
  const rosenGrad0 = rr.gradNorms[0]!
  const rosenGradF = rr.gradNorms[rr.gradNorms.length - 1]!
  const rosenF = rr.fValues[rr.fValues.length - 1]!
  if (!Number.isFinite(rr.x[0]!) || !Number.isFinite(rr.x[1]!)) finite = false

  const ok =
    residualDecreased &&
    (r.converged || gradF < grad0 * 1e-6) &&
    maxErr < 1e-5 &&
    rosenGradF < rosenGrad0 * 1e-3 &&
    rosenF < 1e-4 &&
    finite

  return {
    n,
    grad0,
    gradF,
    residualDecreased,
    maxErr,
    rosenGrad0,
    rosenGradF,
    rosenF,
    iterations: r.iterations,
    converged: r.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_BFGS_UPDATE,
    familyId: METHOD_BFGS,
  }
}
