/**
 * Nelder–Mead simplex · derivative-free minimization (teaching stub).
 * Reflection / expansion / contraction / shrink on n-simplex;
 * targets Rosenbrock-lite 2D or SPD quadratic. f decreases.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Nelder–Mead. */
export const METHOD_NELDER_MEAD = 'method-nelder-mead'

/** Algo · NM simplex (reflection / expand / contract / shrink). */
export const METHOD_ALGO_NM_SIMPLEX = 'method-algo-nm-simplex'

/** Parent alias (aligns with familyId). */
export const NELDER_MEAD_PARENT = METHOD_NELDER_MEAD

export const NELDER_MEAD_METHOD_IDS = [METHOD_ALGO_NM_SIMPLEX] as const

/** Scalar objective f: R^n → R (no gradient). */
export type NmObjective = {
  f: (x: Float64Array) => number
  n: number
}

export type NmResult = {
  x: Float64Array
  /** best f history (incl. initial) */
  fValues: number[]
  iterations: number
  evaluations: number
  converged: boolean
  /** final simplex side scale (max edge from best) */
  size: number
}

/** ‖v‖₂ */
export function norm2(v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
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
 * Quadratic f(x) = 0.5 x^T A x − b · x, A SPD row-major.
 * Minimizer x* = A^{-1} b.
 */
export function makeQuadraticObjective(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
): NmObjective {
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
  }
}

/**
 * Rosenbrock-lite: f(x,y) = (1−x)² + β (y − x²)² with mild β (default 10).
 * Global min (1,1), f=0.
 */
export function makeRosenbrockLite(beta = 10): NmObjective {
  return {
    n: 2,
    f(x) {
      const a = 1 - x[0]!
      const b = x[1]! - x[0]! * x[0]!
      return a * a + beta * b * b
    },
  }
}

/**
 * Symmetric SPD diagonal-dominant sample:
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

/** Standard NM coefficients: α reflect, γ expand, ρ contract, σ shrink. */
export type NmCoeffs = {
  alpha?: number
  gamma?: number
  rho?: number
  sigma?: number
}

/**
 * Build initial simplex: vertex 0 = x0; vertex i = x0 + step·e_{i-1}
 * (with small scale if |x0_i| large).
 */
export function initialSimplex(
  x0: Float64Array,
  step = 0.05,
): Float64Array[] {
  const n = x0.length
  const verts: Float64Array[] = [new Float64Array(x0)]
  for (let i = 0; i < n; i++) {
    const v = new Float64Array(x0)
    const xi = x0[i]!
    const h = Math.abs(xi) > 1e-6 ? step * Math.abs(xi) : step
    v[i] = xi + h
    verts.push(v)
  }
  return verts
}

/** Max ‖v_i − v_0‖ over simplex vertices (size measure). */
export function simplexSize(verts: Float64Array[]): number {
  const n = verts[0]!.length
  let m = 0
  const v0 = verts[0]!
  for (let k = 1; k < verts.length; k++) {
    let s = 0
    const vk = verts[k]!
    for (let i = 0; i < n; i++) {
      const d = vk[i]! - v0[i]!
      s += d * d
    }
    const r = Math.sqrt(s)
    if (r > m) m = r
  }
  return m
}

function sortByF(
  verts: Float64Array[],
  fvals: number[],
): void {
  const m = verts.length
  const order = Array.from({ length: m }, (_, i) => i)
  order.sort((a, b) => fvals[a]! - fvals[b]!)
  const nv = order.map((i) => verts[i]!)
  const nf = order.map((i) => fvals[i]!)
  for (let i = 0; i < m; i++) {
    verts[i] = nv[i]!
    fvals[i] = nf[i]!
  }
}

/**
 * Nelder–Mead minimize:
 * order simplex by f, reflect / expand / contract / shrink.
 * Stops when size < xTol, |f_worst − f_best| < fTol, or maxIter.
 */
export function nmMinimize(
  obj: NmObjective,
  opts?: {
    x0?: Float64Array
    step?: number
    maxIter?: number
    xTol?: number
    fTol?: number
    coeffs?: NmCoeffs
  },
): NmResult {
  const n = obj.n
  const maxIter = opts?.maxIter ?? 200
  const xTol = opts?.xTol ?? 1e-10
  const fTol = opts?.fTol ?? 1e-12
  const alpha = opts?.coeffs?.alpha ?? 1
  const gamma = opts?.coeffs?.gamma ?? 2
  const rho = opts?.coeffs?.rho ?? 0.5
  const sigma = opts?.coeffs?.sigma ?? 0.5

  const x0 = opts?.x0 ? new Float64Array(opts.x0) : new Float64Array(n)
  const verts = initialSimplex(x0, opts?.step ?? 0.05)
  const fvals = new Array<number>(n + 1)
  let evaluations = 0
  for (let i = 0; i <= n; i++) {
    fvals[i] = obj.f(verts[i]!)
    evaluations++
  }
  sortByF(verts, fvals)

  const fValues: number[] = [fvals[0]!]
  let iterations = 0
  let size = simplexSize(verts)
  let converged =
    size < xTol || Math.abs(fvals[n]! - fvals[0]!) < fTol

  const centroid = new Float64Array(n)
  const xr = new Float64Array(n)
  const xe = new Float64Array(n)
  const xc = new Float64Array(n)

  while (!converged && iterations < maxIter) {
    // centroid of all but worst (verts[0..n-1])
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let i = 0; i < n; i++) s += verts[i]![j]!
      centroid[j] = s / n
    }

    // reflection: xr = x̄ + α (x̄ − x_worst)
    for (let j = 0; j < n; j++) {
      xr[j] = centroid[j]! + alpha * (centroid[j]! - verts[n]![j]!)
    }
    const fr = obj.f(xr)
    evaluations++

    if (fr < fvals[0]!) {
      // expansion
      for (let j = 0; j < n; j++) {
        xe[j] = centroid[j]! + gamma * (xr[j]! - centroid[j]!)
      }
      const fe = obj.f(xe)
      evaluations++
      if (fe < fr) {
        verts[n] = new Float64Array(xe)
        fvals[n] = fe
      } else {
        verts[n] = new Float64Array(xr)
        fvals[n] = fr
      }
    } else if (fr < fvals[n - 1]!) {
      // accept reflection
      verts[n] = new Float64Array(xr)
      fvals[n] = fr
    } else {
      // contraction
      let accept = false
      if (fr < fvals[n]!) {
        // outside contraction toward xr
        for (let j = 0; j < n; j++) {
          xc[j] = centroid[j]! + rho * (xr[j]! - centroid[j]!)
        }
        const fc = obj.f(xc)
        evaluations++
        if (fc <= fr) {
          verts[n] = new Float64Array(xc)
          fvals[n] = fc
          accept = true
        }
      } else {
        // inside contraction toward worst
        for (let j = 0; j < n; j++) {
          xc[j] = centroid[j]! + rho * (verts[n]![j]! - centroid[j]!)
        }
        const fc = obj.f(xc)
        evaluations++
        if (fc < fvals[n]!) {
          verts[n] = new Float64Array(xc)
          fvals[n] = fc
          accept = true
        }
      }
      if (!accept) {
        // shrink toward best
        for (let i = 1; i <= n; i++) {
          for (let j = 0; j < n; j++) {
            verts[i]![j] =
              verts[0]![j]! + sigma * (verts[i]![j]! - verts[0]![j]!)
          }
          fvals[i] = obj.f(verts[i]!)
          evaluations++
        }
      }
    }

    sortByF(verts, fvals)
    fValues.push(fvals[0]!)
    iterations++
    size = simplexSize(verts)
    converged =
      size < xTol || Math.abs(fvals[n]! - fvals[0]!) < fTol
  }

  return {
    x: new Float64Array(verts[0]!),
    fValues,
    iterations,
    evaluations,
    converged,
    size,
  }
}

/**
 * Representative sample: NM on SPD quadratic + Rosenbrock-lite.
 * f decreases; ok teaching gate.
 */
export function runNmSimplexSample(
  opts: {
    n?: number
    maxIter?: number
    xTol?: number
    fTol?: number
    rosenBeta?: number
  } = {},
): {
  n: number
  f0: number
  fF: number
  fDecreased: boolean
  maxErr: number
  rosenF0: number
  rosenFF: number
  size: number
  iterations: number
  evaluations: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_NM_SIMPLEX
  familyId: typeof METHOD_NELDER_MEAD
} {
  const n = opts.n ?? 3
  const maxIter = opts.maxIter ?? 250
  const xTol = opts.xTol ?? 1e-10
  const fTol = opts.fTol ?? 1e-12
  const rosenBeta = opts.rosenBeta ?? 10

  const sys = makeSpdQuadraticSystem(n)
  const obj = makeQuadraticObjective(sys.A, sys.b, n)
  const x0 = new Float64Array(n)
  for (let i = 0; i < n; i++) x0[i] = 0.3 + 0.1 * i
  const r = nmMinimize(obj, {
    x0,
    step: 0.2,
    maxIter,
    xTol,
    fTol,
  })

  let maxErr = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const e = Math.abs(r.x[i]! - sys.xTrue[i]!)
    if (e > maxErr) maxErr = e
    if (!Number.isFinite(r.x[i]!)) finite = false
  }

  const f0 = r.fValues[0]!
  const fF = r.fValues[r.fValues.length - 1]!
  const fDecreased = fF < f0

  // Rosenbrock-lite from (−1.2, 1)
  const ros = makeRosenbrockLite(rosenBeta)
  const xRos0 = new Float64Array([-1.2, 1])
  const rr = nmMinimize(ros, {
    x0: xRos0,
    step: 0.5,
    maxIter: 600,
    xTol: 1e-11,
    fTol: 1e-14,
  })
  const rosenF0 = rr.fValues[0]!
  const rosenFF = rr.fValues[rr.fValues.length - 1]!
  if (!Number.isFinite(rr.x[0]!) || !Number.isFinite(rr.x[1]!)) finite = false

  const ok =
    fDecreased &&
    (r.converged || fF < f0 - 1e-6) &&
    maxErr < 1e-4 &&
    rosenFF < rosenF0 &&
    rosenFF < 1e-4 &&
    Math.abs(rr.x[0]! - 1) < 0.05 &&
    Math.abs(rr.x[1]! - 1) < 0.05 &&
    finite

  return {
    n,
    f0,
    fF,
    fDecreased,
    maxErr,
    rosenF0,
    rosenFF,
    size: r.size,
    iterations: r.iterations,
    evaluations: r.evaluations,
    converged: r.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_NM_SIMPLEX,
    familyId: METHOD_NELDER_MEAD,
  }
}
