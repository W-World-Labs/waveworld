/**
 * Spectral collocation for 2-point BVP · Chebyshev nodes + diff matrix.
 * Solve y″=y on [−1,1] with Dirichlet y(±1) given; residual small.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · spectral collocation (BVP). */
export const METHOD_COLLOCATION = 'method-collocation'

/** Algo · Chebyshev differentiation-matrix collocation. */
export const METHOD_ALGO_CHEB_COLLOC = 'method-algo-cheb-colloc'

/** Parent alias (aligns with familyId). */
export const COLLOCATION_PARENT = METHOD_COLLOCATION

export const COLLOCATION_METHOD_IDS = [METHOD_ALGO_CHEB_COLLOC] as const

/** Default polynomial degree N (N+1 Chebyshev nodes). */
export const DEFAULT_N = 12

/** Default left BC y(−1). */
export const DEFAULT_Y_LEFT = Math.cosh(1)

/** Default right BC y(+1). */
export const DEFAULT_Y_RIGHT = Math.cosh(1)

/**
 * Chebyshev–Lobatto (2nd-kind) nodes on [−1,1]:
 *   x_j = cos(π j / N), j=0..N
 * so x_0 = +1, x_N = −1.
 */
export function chebyshevLobattoNodes(N: number): Float64Array {
  if (!(Number.isInteger(N) && N >= 2)) {
    throw new Error('chebyshevLobattoNodes: N integer ≥ 2')
  }
  const x = new Float64Array(N + 1)
  for (let j = 0; j <= N; j++) {
    x[j] = Math.cos((Math.PI * j) / N)
  }
  return x
}

/**
 * First-derivative Chebyshev differentiation matrix (Trefethen).
 * Row-major (N+1)×(N+1). c_0=c_N=2, else 1.
 */
export function chebyshevDiffMatrix(N: number): Float64Array {
  if (!(Number.isInteger(N) && N >= 2)) {
    throw new Error('chebyshevDiffMatrix: N integer ≥ 2')
  }
  const n = N + 1
  const x = chebyshevLobattoNodes(N)
  const D = new Float64Array(n * n)
  const c = new Float64Array(n)
  for (let j = 0; j < n; j++) c[j] = j === 0 || j === N ? 2 : 1

  for (let j = 0; j < n; j++) {
    for (let k = 0; k < n; k++) {
      if (j !== k) {
        const sign = (j + k) % 2 === 0 ? 1 : -1
        D[j * n + k] =
          ((c[j]! / c[k]!) * sign) / (x[j]! - x[k]!)
      }
    }
  }
  // Diagonal: negative row sum (exact for constant mode)
  for (let j = 0; j < n; j++) {
    let s = 0
    for (let k = 0; k < n; k++) {
      if (k !== j) s += D[j * n + k]!
    }
    D[j * n + j] = -s
  }
  return D
}

/** Dense matmul C = A B for square n×n row-major. */
export function matMul(
  A: ArrayLike<number>,
  B: ArrayLike<number>,
  n: number,
): Float64Array {
  const C = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = A[i * n + k]!
      for (let j = 0; j < n; j++) {
        C[i * n + j] = C[i * n + j]! + aik * B[k * n + j]!
      }
    }
  }
  return C
}

/** y = A x for n×n row-major A. */
export function matVec(
  A: ArrayLike<number>,
  x: ArrayLike<number>,
  n: number,
): Float64Array {
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += A[i * n + j]! * x[j]!
    y[i] = s
  }
  return y
}

/** D² = D·D second-derivative matrix. */
export function chebyshevD2(N: number): {
  x: Float64Array
  D: Float64Array
  D2: Float64Array
  n: number
} {
  const D = chebyshevDiffMatrix(N)
  const n = N + 1
  const D2 = matMul(D, D, n)
  return { x: chebyshevLobattoNodes(N), D, D2, n }
}

/**
 * Partial-pivot Gaussian elimination A z = b (row-major n×n, copies A).
 */
export function solveDenseGauss(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
): Float64Array {
  if (n < 1 || A.length < n * n || b.length < n) {
    throw new Error('solveDenseGauss: size mismatch')
  }
  const M = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) M[i] = A[i]!
  const rhs = new Float64Array(n)
  for (let i = 0; i < n; i++) rhs[i] = b[i]!

  for (let k = 0; k < n; k++) {
    let piv = k
    let best = Math.abs(M[k * n + k]!)
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]!)
      if (v > best) {
        best = v
        piv = i
      }
    }
    if (best < 1e-14) throw new Error('solveDenseGauss: singular')
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const tmp = M[k * n + j]!
        M[k * n + j] = M[piv * n + j]!
        M[piv * n + j] = tmp
      }
      const tb = rhs[k]!
      rhs[k] = rhs[piv]!
      rhs[piv] = tb
    }
    const akk = M[k * n + k]!
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k]! / akk
      M[i * n + k] = 0
      for (let j = k + 1; j < n; j++) {
        M[i * n + j] = M[i * n + j]! - f * M[k * n + j]!
      }
      rhs[i] = rhs[i]! - f * rhs[k]!
    }
  }

  const z = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i]!
    for (let j = i + 1; j < n; j++) s -= M[i * n + j]! * z[j]!
    z[i] = s / M[i * n + i]!
  }
  return z
}

/**
 * Exact solution of y″=y is A cosh(x)+B sinh(x).
 * Fit A,B to Dirichlet y(−1)=yL, y(+1)=yR.
 */
export function exactCoeff(yL: number, yR: number): { A: number; B: number } {
  const ch = Math.cosh(1)
  const sh = Math.sinh(1)
  // y(+1)= A ch + B sh = yR
  // y(−1)= A ch − B sh = yL
  const A = (yR + yL) / (2 * ch)
  const B = (yR - yL) / (2 * sh)
  return { A, B }
}

export function exactY(x: number, yL: number, yR: number): number {
  const { A, B } = exactCoeff(yL, yR)
  return A * Math.cosh(x) + B * Math.sinh(x)
}

/**
 * Chebyshev collocation for y″ − y = 0 on [−1,1],
 * y(x_0)=yR (at +1), y(x_N)=yL (at −1).
 * Interior rows of D2 − I enforce the ODE; BC rows fix endpoints.
 */
export function solveChebCollocBvp(
  opts: {
    N?: number
    yLeft?: number
    yRight?: number
  } = {},
): {
  N: number
  n: number
  x: Float64Array
  y: Float64Array
  D2: Float64Array
  residualMax: number
  maxErr: number
  yLeft: number
  yRight: number
  finite: boolean
  methodId: typeof METHOD_ALGO_CHEB_COLLOC
  familyId: typeof METHOD_COLLOCATION
} {
  const N = opts.N ?? DEFAULT_N
  const yL = opts.yLeft ?? DEFAULT_Y_LEFT
  const yR = opts.yRight ?? DEFAULT_Y_RIGHT
  if (!(Number.isInteger(N) && N >= 2)) {
    throw new Error('solveChebCollocBvp: N integer ≥ 2')
  }
  if (!Number.isFinite(yL) || !Number.isFinite(yR)) {
    throw new Error('solveChebCollocBvp: finite BC')
  }

  const { x, D2, n } = chebyshevD2(N)
  // Build system (D2 − I) y = 0 with BC rows replaced
  const A = new Float64Array(n * n)
  const b = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      // y(+1) = yR
      A[0] = 1
      b[0] = yR
    } else if (i === N) {
      // y(−1) = yL
      A[N * n + N] = 1
      b[N] = yL
    } else {
      for (let j = 0; j < n; j++) {
        A[i * n + j] = D2[i * n + j]! - (i === j ? 1 : 0)
      }
      b[i] = 0
    }
  }

  const y = solveDenseGauss(A, b, n)

  // Residual of ODE at interior nodes: |(D2 y)_i − y_i|
  const d2y = matVec(D2, y, n)
  let residualMax = 0
  for (let i = 1; i < N; i++) {
    const r = Math.abs(d2y[i]! - y[i]!)
    if (r > residualMax) residualMax = r
  }

  let maxErr = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i]!)) finite = false
    const e = Math.abs(y[i]! - exactY(x[i]!, yL, yR))
    if (e > maxErr) maxErr = e
  }
  finite = finite && Number.isFinite(residualMax) && Number.isFinite(maxErr)

  return {
    N,
    n,
    x,
    y,
    D2,
    residualMax,
    maxErr,
    yLeft: yL,
    yRight: yR,
    finite,
    methodId: METHOD_ALGO_CHEB_COLLOC,
    familyId: METHOD_COLLOCATION,
  }
}

/**
 * Demo: collocate y″=y, y(±1)=cosh(1) → y=cosh(x); residual and maxErr small.
 */
export function runChebCollocSample(
  opts: {
    N?: number
    yLeft?: number
    yRight?: number
  } = {},
): {
  N: number
  residualMax: number
  maxErr: number
  bcOk: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CHEB_COLLOC
  familyId: typeof METHOD_COLLOCATION
} {
  const r = solveChebCollocBvp(opts)
  const bcOk =
    Math.abs(r.y[0]! - r.yRight) < 1e-12 &&
    Math.abs(r.y[r.N]! - r.yLeft) < 1e-12
  const ok =
    r.finite &&
    bcOk &&
    r.residualMax < 1e-8 &&
    r.maxErr < 1e-8
  return {
    N: r.N,
    residualMax: r.residualMax,
    maxErr: r.maxErr,
    bcOk,
    finite: r.finite,
    ok,
    methodId: METHOD_ALGO_CHEB_COLLOC,
    familyId: METHOD_COLLOCATION,
  }
}
