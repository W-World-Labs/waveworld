/**
 * BiCGSTAB pure algo stub · solve small nonsymmetric Ax=b (tridiag / dense).
 * Residual drops; teaching tol style like gmres-algos.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · BiCGSTAB (Krylov nonsym solver family). */
export const METHOD_BICGSTAB = 'method-bicgstab'

/** Algo · BiCGSTAB iteration. */
export const METHOD_ALGO_BICGSTAB = 'method-algo-bicgstab'

/** Parent alias (aligns with familyId). */
export const BICGSTAB_PARENT = METHOD_BICGSTAB

export const BICGSTAB_METHOD_IDS = [METHOD_ALGO_BICGSTAB] as const

export type MatVec = (x: Float64Array, y: Float64Array) => void

export type BicgstabResult = {
  x: Float64Array
  /** residual norms ‖b−Ax‖₂ (incl. initial) */
  residuals: number[]
  iterations: number
  converged: boolean
}

/** ‖v‖₂ */
export function norm2(v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** dot product */
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

export function makeDenseMatVec(A: ArrayLike<number>, n: number): MatVec {
  return (x, y) => denseMatVec(A, n, x, y)
}

/**
 * Tridiagonal matvec: a sub (a[0] unused), b main, c super (c[n-1] unused).
 * May be nonsymmetric (a ≠ c).
 */
export function tridiagMatVec(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
  x: Float64Array | number[],
  y: Float64Array,
): void {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let s = b[i]! * x[i]!
    if (i > 0) s += a[i]! * x[i - 1]!
    if (i < n - 1) s += c[i]! * x[i + 1]!
    y[i] = s
  }
}

export function makeTridiagMatVec(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
): MatVec {
  return (x, y) => tridiagMatVec(a, b, c, x, y)
}

/**
 * BiCGSTAB (van der Vorst): short-recurrence Krylov for nonsym Ax=b.
 * Stop when ‖r‖ < tol · max(1, ‖b‖).
 */
export function bicgstab(
  matvec: MatVec,
  b: Float64Array | number[],
  opts?: {
    maxIter?: number
    tol?: number
    x0?: Float64Array
  },
): BicgstabResult {
  const n = b.length
  const maxIter = opts?.maxIter ?? Math.max(2 * n, 40)
  const tol = opts?.tol ?? 1e-10
  const x = opts?.x0 ? new Float64Array(opts.x0) : new Float64Array(n)

  const Ax = new Float64Array(n)
  const r = new Float64Array(n)
  const rTilde = new Float64Array(n)
  const p = new Float64Array(n)
  const v = new Float64Array(n)
  const s = new Float64Array(n)
  const t = new Float64Array(n)

  matvec(x, Ax)
  for (let i = 0; i < n; i++) {
    r[i] = b[i]! - Ax[i]!
    rTilde[i] = r[i]!
  }

  const residuals: number[] = []
  const bNorm = Math.max(norm2(b), 1)
  const thresh = tol * bNorm
  let rho = 1
  let alpha = 1
  let omega = 1
  let res = norm2(r)
  residuals.push(res)

  let iterations = 0
  let converged = res < thresh

  for (let k = 0; k < maxIter && !converged; k++) {
    const rhoPrev = rho
    rho = dot(rTilde, r)
    if (!Number.isFinite(rho) || Math.abs(rho) < 1e-300) {
      // shadow residual breakdown
      break
    }

    const beta = (rho / rhoPrev) * (alpha / omega)
    if (k === 0) {
      for (let i = 0; i < n; i++) p[i] = r[i]!
    } else {
      for (let i = 0; i < n; i++) {
        p[i] = r[i]! + beta * (p[i]! - omega * v[i]!)
      }
    }

    matvec(p, v)
    const rTv = dot(rTilde, v)
    if (!Number.isFinite(rTv) || Math.abs(rTv) < 1e-300) break
    alpha = rho / rTv

    for (let i = 0; i < n; i++) s[i] = r[i]! - alpha * v[i]!
    const sNorm = norm2(s)
    if (sNorm < thresh) {
      for (let i = 0; i < n; i++) x[i]! += alpha * p[i]!
      iterations++
      matvec(x, Ax)
      for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!
      res = norm2(r)
      residuals.push(res)
      converged = res < thresh
      break
    }

    matvec(s, t)
    const tt = dot(t, t)
    if (!Number.isFinite(tt) || tt < 1e-300) break
    omega = dot(t, s) / tt
    if (!Number.isFinite(omega) || Math.abs(omega) < 1e-300) break

    for (let i = 0; i < n; i++) {
      x[i]! += alpha * p[i]! + omega * s[i]!
      r[i] = s[i]! - omega * t[i]!
    }
    iterations++
    res = norm2(r)
    residuals.push(res)
    converged = res < thresh
  }

  // exact residual
  matvec(x, Ax)
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!
  const finalRes = norm2(r)
  if (residuals[residuals.length - 1] !== finalRes) {
    residuals.push(finalRes)
  }
  converged = finalRes < thresh

  return { x, residuals, iterations, converged }
}

/**
 * Small nonsym tridiagonal convection–diffusion:
 * sub a = −1−δ, main b = 2, super c = −1+δ.
 * RHS so x* = (1,...,1).
 */
export function makeNonsymTridiagSystem(n: number, delta = 0.3): {
  a: Float64Array
  b: Float64Array
  c: Float64Array
  rhs: Float64Array
  xTrue: Float64Array
} {
  const a = new Float64Array(n)
  const b = new Float64Array(n)
  const c = new Float64Array(n)
  const xTrue = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    b[i] = 2
    if (i > 0) a[i] = -1 - delta
    if (i < n - 1) c[i] = -1 + delta
    xTrue[i] = 1
  }
  const rhs = new Float64Array(n)
  tridiagMatVec(a, b, c, xTrue, rhs)
  return { a, b, c, rhs, xTrue }
}

/**
 * Dense nonsym 3×3:
 *   A = [[4, 1, 0], [2, 5, 1], [0, 1, 3]], x* = (1, 2, 3).
 */
export function makeDenseNonsym3x3(): {
  A: Float64Array
  n: number
  rhs: Float64Array
  xTrue: Float64Array
} {
  const n = 3
  const A = new Float64Array([4, 1, 0, 2, 5, 1, 0, 1, 3])
  const xTrue = new Float64Array([1, 2, 3])
  const rhs = new Float64Array(n)
  denseMatVec(A, n, xTrue, rhs)
  return { A, n, rhs, xTrue }
}

/**
 * Representative sample: BiCGSTAB on nonsym tridiag (+ dense check).
 * Residual drops; ok teaching gate.
 */
export function runBicgstabSample(
  opts: {
    n?: number
    delta?: number
    maxIter?: number
    tol?: number
  } = {},
): {
  n: number
  residual0: number
  residualF: number
  residualDecreased: boolean
  maxErr: number
  denseMaxErr: number
  denseResidualF: number
  iterations: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BICGSTAB
  familyId: typeof METHOD_BICGSTAB
} {
  const n = opts.n ?? 12
  const delta = opts.delta ?? 0.35
  const maxIter = opts.maxIter ?? Math.max(4 * n, 50)
  // teaching: slightly loose tol relative to ‖b‖, like gmres-algos
  const tol = opts.tol ?? 1e-10

  const sys = makeNonsymTridiagSystem(n, delta)
  const matvec = makeTridiagMatVec(sys.a, sys.b, sys.c)
  const g = bicgstab(matvec, sys.rhs, { maxIter, tol })

  let maxErr = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const e = Math.abs(g.x[i]! - sys.xTrue[i]!)
    if (e > maxErr) maxErr = e
    if (!Number.isFinite(g.x[i]!)) finite = false
  }

  const residual0 = g.residuals[0]!
  const residualF = g.residuals[g.residuals.length - 1]!
  const residualDecreased =
    residualF < residual0 * 1e-4 || residualF < 1e-8

  const d = makeDenseNonsym3x3()
  const gd = bicgstab(makeDenseMatVec(d.A, d.n), d.rhs, {
    maxIter: 20,
    tol: 1e-12,
  })
  let denseMaxErr = 0
  for (let i = 0; i < d.n; i++) {
    const e = Math.abs(gd.x[i]! - d.xTrue[i]!)
    if (e > denseMaxErr) denseMaxErr = e
    if (!Number.isFinite(gd.x[i]!)) finite = false
  }
  const denseResidualF = gd.residuals[gd.residuals.length - 1]!

  const ok =
    residualDecreased &&
    (g.converged || residualF < residual0 * 1e-6) &&
    maxErr < 1e-6 &&
    denseMaxErr < 1e-8 &&
    denseResidualF < 1e-8 &&
    finite

  return {
    n,
    residual0,
    residualF,
    residualDecreased,
    maxErr,
    denseMaxErr,
    denseResidualF,
    iterations: g.iterations,
    converged: g.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_BICGSTAB,
    familyId: METHOD_BICGSTAB,
  }
}
