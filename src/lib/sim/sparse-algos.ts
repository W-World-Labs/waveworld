/**
 * Sparse linear algebra · CSR matvec + Jacobi iteration.
 * CSR SpMV; Jacobi on SPD diagonally-dominant Ax=b with residual drop.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · sparse iterative solvers. */
export const METHOD_SPARSE = 'method-sparse'

/** Algo · CSR sparse matrix–vector product. */
export const METHOD_ALGO_CSR_SPMV = 'method-algo-csr-spmv'

/** Algo · Jacobi iteration on diagonal-dominant SPD. */
export const METHOD_ALGO_JACOBI_ITER = 'method-algo-jacobi-iter'

/** Parent alias (aligns with familyId). */
export const SPARSE_PARENT = METHOD_SPARSE

export const SPARSE_METHOD_IDS = [
  METHOD_ALGO_CSR_SPMV,
  METHOD_ALGO_JACOBI_ITER,
] as const

// ---------------------------------------------------------------------------
// CSR format
// ---------------------------------------------------------------------------

/**
 * Compressed Sparse Row matrix.
 * values[rowPtr[i] .. rowPtr[i+1]) with colInd; n rows, ncols columns.
 */
export type CsrMatrix = {
  n: number
  ncols: number
  values: Float64Array
  colInd: Int32Array
  rowPtr: Int32Array
}

/** ‖v‖₂ */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** max |v_i| */
export function maxAbs(v: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]!)
    if (a > m) m = a
  }
  return m
}

/**
 * Build CSR from dense row-major n×ncols (drop |a_ij| ≤ dropTol).
 */
export function denseToCsr(
  A: ArrayLike<number>,
  n: number,
  ncols: number,
  dropTol = 0,
): CsrMatrix {
  if (A.length !== n * ncols) throw new Error('denseToCsr: size mismatch')
  const vals: number[] = []
  const cols: number[] = []
  const rowPtr = new Int32Array(n + 1)
  let nnz = 0
  for (let i = 0; i < n; i++) {
    rowPtr[i] = nnz
    const base = i * ncols
    for (let j = 0; j < ncols; j++) {
      const a = A[base + j]!
      if (Math.abs(a) > dropTol) {
        vals.push(a)
        cols.push(j)
        nnz++
      }
    }
  }
  rowPtr[n] = nnz
  return {
    n,
    ncols,
    values: new Float64Array(vals),
    colInd: Int32Array.from(cols),
    rowPtr,
  }
}

/**
 * CSR for 1D shifted Laplacian tridiag(−1, 4, −1) (SPD, strictly diag-dominant).
 * Jacobi spectral radius ≲ 1/2 so residual drops quickly (teaching scale).
 */
export function makeLaplacian1dCsr(n: number): CsrMatrix {
  if (!(n >= 1)) throw new Error('makeLaplacian1dCsr: n ≥ 1')
  const vals: number[] = []
  const cols: number[] = []
  const rowPtr = new Int32Array(n + 1)
  let nnz = 0
  for (let i = 0; i < n; i++) {
    rowPtr[i] = nnz
    if (i > 0) {
      vals.push(-1)
      cols.push(i - 1)
      nnz++
    }
    vals.push(4)
    cols.push(i)
    nnz++
    if (i < n - 1) {
      vals.push(-1)
      cols.push(i + 1)
      nnz++
    }
  }
  rowPtr[n] = nnz
  return {
    n,
    ncols: n,
    values: new Float64Array(vals),
    colInd: Int32Array.from(cols),
    rowPtr,
  }
}

/**
 * y = A x (CSR SpMV). y length = A.n; x length = A.ncols.
 */
export function csrSpmv(
  A: CsrMatrix,
  x: ArrayLike<number>,
  y?: Float64Array,
): Float64Array {
  if (x.length !== A.ncols) throw new Error('csrSpmv: x length')
  const out = y ?? new Float64Array(A.n)
  if (out.length !== A.n) throw new Error('csrSpmv: y length')
  const { values, colInd, rowPtr, n } = A
  for (let i = 0; i < n; i++) {
    let s = 0
    const start = rowPtr[i]!
    const end = rowPtr[i + 1]!
    for (let p = start; p < end; p++) {
      s += values[p]! * x[colInd[p]!]!
    }
    out[i] = s
  }
  return out
}

/** Extract diagonal of square CSR (0 if missing). */
export function csrDiagonal(A: CsrMatrix): Float64Array {
  if (A.n !== A.ncols) throw new Error('csrDiagonal: square only')
  const d = new Float64Array(A.n)
  for (let i = 0; i < A.n; i++) {
    const start = A.rowPtr[i]!
    const end = A.rowPtr[i + 1]!
    for (let p = start; p < end; p++) {
      if (A.colInd[p]! === i) {
        d[i] = A.values[p]!
        break
      }
    }
  }
  return d
}

/** r = b − A x */
export function csrResidual(
  A: CsrMatrix,
  b: ArrayLike<number>,
  x: ArrayLike<number>,
  out?: Float64Array,
): Float64Array {
  const Ax = csrSpmv(A, x)
  const r = out ?? new Float64Array(A.n)
  for (let i = 0; i < A.n; i++) r[i] = b[i]! - Ax[i]!
  return r
}

export type JacobiResult = {
  x: Float64Array
  /** residual norms ‖b−Ax‖₂ including initial */
  residuals: number[]
  iterations: number
  converged: boolean
}

/**
 * Jacobi iteration for square Ax=b:
 *   x_i ← (b_i − Σ_{j≠i} a_ij x_j) / a_ii
 * Requires nonzero diagonal. Converges when A is strictly diagonally dominant
 * (or SPD with suitable spectrum). Optional damping omega (default 1).
 */
export function jacobiIter(
  A: CsrMatrix,
  b: ArrayLike<number>,
  opts?: {
    maxIter?: number
    tol?: number
    x0?: ArrayLike<number>
    omega?: number
  },
): JacobiResult {
  if (A.n !== A.ncols) throw new Error('jacobiIter: A must be square')
  if (b.length !== A.n) throw new Error('jacobiIter: b length')
  const n = A.n
  const maxIter = opts?.maxIter ?? Math.max(4 * n, 40)
  const tol = opts?.tol ?? 1e-10
  const omega = opts?.omega ?? 1
  const x = opts?.x0 ? new Float64Array(opts.x0) : new Float64Array(n)
  const xNew = new Float64Array(n)
  const diag = csrDiagonal(A)
  for (let i = 0; i < n; i++) {
    if (!(Math.abs(diag[i]!) > 1e-30)) {
      throw new Error(`jacobiIter: zero diagonal at ${i}`)
    }
  }

  const residuals: number[] = []
  let r = csrResidual(A, b, x)
  let res = norm2(r)
  residuals.push(res)
  const bNorm = Math.max(norm2(b), 1)
  const thresh = tol * bNorm
  let converged = res < thresh
  let iterations = 0

  for (let k = 0; k < maxIter && !converged; k++) {
    for (let i = 0; i < n; i++) {
      let sigma = 0
      const start = A.rowPtr[i]!
      const end = A.rowPtr[i + 1]!
      for (let p = start; p < end; p++) {
        const j = A.colInd[p]!
        if (j !== i) sigma += A.values[p]! * x[j]!
      }
      const xi = (b[i]! - sigma) / diag[i]!
      xNew[i] = omega === 1 ? xi : (1 - omega) * x[i]! + omega * xi
    }
    x.set(xNew)
    iterations++
    r = csrResidual(A, b, x, r)
    res = norm2(r)
    residuals.push(res)
    converged = res < thresh
  }

  return { x, residuals, iterations, converged }
}

/**
 * SPD diag-dominant toy: Laplacian1d with known solution x* = (1,...,1)
 * so b = A x*.
 */
export function makeJacobiToy(n: number): {
  A: CsrMatrix
  b: Float64Array
  xTrue: Float64Array
} {
  const A = makeLaplacian1dCsr(n)
  const xTrue = new Float64Array(n)
  for (let i = 0; i < n; i++) xTrue[i] = 1
  const b = csrSpmv(A, xTrue)
  return { A, b, xTrue }
}

/**
 * Representative CSR SpMV sample: dense-vs-CSR agreement on small matrix
 * + Laplacian matvec sanity.
 */
export function runCsrSpmvSample(
  opts: { n?: number } = {},
): {
  n: number
  denseAgree: boolean
  maxDiff: number
  laplacianNorm: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CSR_SPMV
  familyId: typeof METHOD_SPARSE
} {
  const n = opts.n ?? 5
  // dense tridiag(−1, 4, −1) for CSR vs dense agreement
  const dense = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    dense[i * n + i] = 4
    if (i > 0) dense[i * n + (i - 1)] = -1
    if (i < n - 1) dense[i * n + (i + 1)] = -1
  }
  const A = denseToCsr(dense, n, n)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = i + 1
  const yCsr = csrSpmv(A, x)
  const yDense = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += dense[i * n + j]! * x[j]!
    yDense[i] = s
  }
  let maxDiff = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const d = Math.abs(yCsr[i]! - yDense[i]!)
    if (d > maxDiff) maxDiff = d
    if (!Number.isFinite(yCsr[i]!)) finite = false
  }
  const Lap = makeLaplacian1dCsr(n)
  const yL = csrSpmv(Lap, x)
  const laplacianNorm = norm2(yL)
  const denseAgree = maxDiff < 1e-14
  const ok = finite && denseAgree && laplacianNorm > 0

  return {
    n,
    denseAgree,
    maxDiff,
    laplacianNorm,
    finite,
    ok,
    methodId: METHOD_ALGO_CSR_SPMV,
    familyId: METHOD_SPARSE,
  }
}

/**
 * Representative Jacobi sample on SPD diag-dominant Laplacian.
 * Residual drops; solution approaches x*.
 */
export function runJacobiIterSample(
  opts: {
    n?: number
    maxIter?: number
    tol?: number
  } = {},
): {
  n: number
  residual0: number
  residualF: number
  residualDecreased: boolean
  maxErr: number
  iterations: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_JACOBI_ITER
  familyId: typeof METHOD_SPARSE
} {
  const n = opts.n ?? 12
  const maxIter = opts.maxIter ?? Math.max(8 * n, 80)
  const tol = opts.tol ?? 1e-10
  const toy = makeJacobiToy(n)
  const r = jacobiIter(toy.A, toy.b, { maxIter, tol })

  let maxErr = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const e = Math.abs(r.x[i]! - toy.xTrue[i]!)
    if (e > maxErr) maxErr = e
    if (!Number.isFinite(r.x[i]!)) finite = false
  }
  const residual0 = r.residuals[0]!
  const residualF = r.residuals[r.residuals.length - 1]!
  const residualDecreased =
    residualF < residual0 * 1e-4 || residualF < 1e-8

  const ok =
    finite &&
    residualDecreased &&
    (r.converged || residualF < residual0 * 1e-6) &&
    maxErr < 1e-5

  return {
    n,
    residual0,
    residualF,
    residualDecreased,
    maxErr,
    iterations: r.iterations,
    converged: r.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_JACOBI_ITER,
    familyId: METHOD_SPARSE,
  }
}
