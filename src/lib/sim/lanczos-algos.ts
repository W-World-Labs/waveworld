/**
 * Lanczos tridiagonalization for SPD eigenvalue estimates (Ritz values).
 * Dense / tridiagonal matvec; extremal eigenvalues of diag-dominant SPD.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Lanczos (Krylov eigenvalue / tridiagonalization). */
export const METHOD_LANCZOS = 'method-lanczos'

/** Algo · Lanczos Ritz eigenvalues for SPD matrices. */
export const METHOD_ALGO_LANCZOS_EIG = 'method-algo-lanczos-eig'

/** Parent alias (aligns with familyId). */
export const LANCZOS_PARENT = METHOD_LANCZOS

export const LANCZOS_METHOD_IDS = [METHOD_ALGO_LANCZOS_EIG] as const

/** Teaching cap on matrix size / Krylov dimension. */
export const LANCZOS_MAX_N = 64

export type MatVec = (x: Float64Array, y: Float64Array) => void

export type LanczosResult = {
  /** Diagonal of T (length m). */
  alpha: Float64Array
  /** Off-diagonal of T (length m−1); beta[j] = T[j+1,j]. */
  beta: Float64Array
  /** Krylov basis columns V[:,0..m-1] packed column-major n×m. */
  V: Float64Array
  /** Number of Lanczos steps completed. */
  m: number
  n: number
  /** Ritz values (eigenvalues of T), ascending. */
  ritzValues: Float64Array
  /** Whether an early breakdown (beta≈0) occurred. */
  breakdown: boolean
}

// ---------------------------------------------------------------------------
// Linear algebra helpers
// ---------------------------------------------------------------------------

/** ‖v‖₂ */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** u · v */
export function dot(u: ArrayLike<number>, v: ArrayLike<number>): number {
  let s = 0
  const n = Math.min(u.length, v.length)
  for (let i = 0; i < n; i++) s += u[i]! * v[i]!
  return s
}

/** y = A x, A row-major dense n×n. */
export function denseMatVec(
  A: ArrayLike<number>,
  n: number,
  x: ArrayLike<number>,
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
 * Symmetric tridiagonal matvec: a off-diagonal (length n−1), b main (length n).
 * a[i] couples i and i+1.
 */
export function tridiagSymMatVec(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  x: ArrayLike<number>,
  y: Float64Array,
): void {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let s = b[i]! * x[i]!
    if (i > 0) s += a[i - 1]! * x[i - 1]!
    if (i < n - 1) s += a[i]! * x[i + 1]!
    y[i] = s
  }
}

export function makeTridiagSymMatVec(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): MatVec {
  return (x, y) => tridiagSymMatVec(a, b, x, y)
}

// ---------------------------------------------------------------------------
// Symmetric eigenvalues (Jacobi) used for T and dense checks
// ---------------------------------------------------------------------------

/**
 * Classical Jacobi eigenvalues for symmetric n×n (row-major).
 * Returns ascending-sorted eigenvalues. Teaching: n ≤ LANCZOS_MAX_N.
 */
export function jacobiEigenvalues(
  AIn: ArrayLike<number>,
  n: number,
  opts?: { maxSweeps?: number; tol?: number },
): Float64Array {
  if (n < 1 || n > LANCZOS_MAX_N) throw new Error('jacobiEigenvalues: n')
  if (AIn.length < n * n) throw new Error('jacobiEigenvalues: A size')
  const maxSweeps = opts?.maxSweeps ?? 80
  const tol = opts?.tol ?? 1e-14
  const A = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) A[i] = AIn[i]!

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]!
        off += apq * apq
      }
    }
    if (Math.sqrt(2 * off) < tol) break

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]!
        if (Math.abs(apq) < tol) continue
        const app = A[p * n + p]!
        const aqq = A[q * n + q]!
        let t: number
        if (Math.abs(aqq - app) < 1e-30 * Math.max(Math.abs(apq), 1)) {
          t = 1
        } else {
          const tau = (aqq - app) / (2 * apq)
          t =
            (tau >= 0 ? 1 : -1) /
            (Math.abs(tau) + Math.sqrt(1 + tau * tau))
        }
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c

        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue
          const aip = A[i * n + p]!
          const aiq = A[i * n + q]!
          const nip = c * aip - s * aiq
          const niq = s * aip + c * aiq
          A[i * n + p] = nip
          A[p * n + i] = nip
          A[i * n + q] = niq
          A[q * n + i] = niq
        }
        const appNew = c * c * app - 2 * s * c * apq + s * s * aqq
        const aqqNew = s * s * app + 2 * s * c * apq + c * c * aqq
        A[p * n + p] = appNew
        A[q * n + q] = aqqNew
        A[p * n + q] = 0
        A[q * n + p] = 0
      }
    }
  }

  const ev = new Float64Array(n)
  for (let i = 0; i < n; i++) ev[i] = A[i * n + i]!
  ev.sort()
  return ev
}

/**
 * Eigenvalues of symmetric tridiagonal (diag d, off-diag e length n−1).
 * Builds dense T and uses Jacobi (reliable at teaching scale).
 */
export function tridiagEigenvalues(
  dIn: ArrayLike<number>,
  eIn: ArrayLike<number>,
): Float64Array {
  const n = dIn.length
  if (n < 1) return new Float64Array(0)
  if (n > LANCZOS_MAX_N) {
    throw new Error(`tridiagEigenvalues: need n ≤ ${LANCZOS_MAX_N}`)
  }
  if (n > 1 && eIn.length < n - 1) {
    throw new Error('tridiagEigenvalues: e length')
  }
  const T = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    T[i * n + i] = dIn[i]!
    if (i < n - 1) {
      const e = eIn[i]!
      T[i * n + i + 1] = e
      T[(i + 1) * n + i] = e
    }
  }
  return jacobiEigenvalues(T, n)
}

// ---------------------------------------------------------------------------
// Lanczos
// ---------------------------------------------------------------------------

/**
 * Lanczos tridiagonalization of SPD (or symmetric) operator.
 * Builds orthonormal V (n×m) and tridiagonal T = V^T A V with
 * diag alpha, off-diag beta; Ritz values = eig(T).
 *
 * Three-term recurrence + full reorthogonalization for teaching stability.
 */
export function lanczos(
  matvec: MatVec,
  n: number,
  opts?: {
    m?: number
    v0?: ArrayLike<number>
    breakdownTol?: number
  },
): LanczosResult {
  if (!Number.isInteger(n) || n < 1 || n > LANCZOS_MAX_N) {
    throw new Error(`lanczos: need integer 1 ≤ n ≤ ${LANCZOS_MAX_N}`)
  }
  const mWant = opts?.m ?? Math.min(n, 12)
  const mMax = Math.min(Math.max(1, mWant), n)
  const breakdownTol = opts?.breakdownTol ?? 1e-14

  const alpha = new Float64Array(mMax)
  const beta = new Float64Array(Math.max(0, mMax - 1))
  const V = new Float64Array(n * mMax)

  const w = new Float64Array(n)
  if (opts?.v0 && opts.v0.length >= n) {
    for (let i = 0; i < n; i++) w[i] = opts.v0[i]!
  } else {
    for (let i = 0; i < n; i++) w[i] = 1
  }
  let nrm = norm2(w)
  if (!(nrm > 0)) {
    w[0] = 1
    nrm = 1
  }
  const inv0 = 1 / nrm
  for (let i = 0; i < n; i++) V[i] = w[i]! * inv0

  const Av = new Float64Array(n)
  const vj = new Float64Array(n)
  let breakdown = false
  let mDone = 0

  for (let j = 0; j < mMax; j++) {
    mDone = j + 1
    // copy v_j
    const baseJ = j * n
    for (let i = 0; i < n; i++) vj[i] = V[baseJ + i]!

    // w = A v_j
    matvec(vj, Av)
    for (let i = 0; i < n; i++) w[i] = Av[i]!

    // alpha_j = v_j · A v_j
    alpha[j] = dot(w, vj)

    // w ← A v_j − beta_{j-1} v_{j-1} − alpha_j v_j
    if (j > 0) {
      const bjm = beta[j - 1]!
      const basePrev = (j - 1) * n
      for (let i = 0; i < n; i++) w[i]! -= bjm * V[basePrev + i]!
    }
    const aj = alpha[j]!
    for (let i = 0; i < n; i++) w[i]! -= aj * vj[i]!

    // Full reorthogonalization against v_0..v_j (twice)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= j; i++) {
        const baseI = i * n
        let hij = 0
        for (let k = 0; k < n; k++) hij += w[k]! * V[baseI + k]!
        for (let k = 0; k < n; k++) w[k]! -= hij * V[baseI + k]!
      }
    }

    if (j + 1 === mMax) break

    const bj = norm2(w)
    beta[j] = bj
    if (!(bj > breakdownTol)) {
      breakdown = true
      break
    }
    const inv = 1 / bj
    const baseNext = (j + 1) * n
    for (let i = 0; i < n; i++) V[baseNext + i] = w[i]! * inv
  }

  const m = mDone
  const alphaM = new Float64Array(m)
  for (let i = 0; i < m; i++) alphaM[i] = alpha[i]!
  const betaM = new Float64Array(Math.max(0, m - 1))
  for (let i = 0; i < m - 1; i++) betaM[i] = beta[i]!

  // Rayleigh–Ritz: T = V^T A V (symmetric); more consistent with full reortho
  // than pure three-term alpha/beta alone. Use tridiag path when m is small
  // via dense Jacobi on T.
  const T = new Float64Array(m * m)
  const Avi = new Float64Array(n)
  const vi = new Float64Array(n)
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < n; k++) vi[k] = V[i * n + k]!
    matvec(vi, Avi)
    for (let j = i; j < m; j++) {
      let s = 0
      const baseJ = j * n
      for (let k = 0; k < n; k++) s += Avi[k]! * V[baseJ + k]!
      T[i * m + j] = s
      T[j * m + i] = s
    }
  }
  const ritzValues = jacobiEigenvalues(T, m)

  const Vout = new Float64Array(n * m)
  for (let i = 0; i < n * m; i++) Vout[i] = V[i]!

  return {
    alpha: alphaM,
    beta: betaM,
    V: Vout,
    m,
    n,
    ritzValues,
    breakdown,
  }
}

// ---------------------------------------------------------------------------
// Test matrices
// ---------------------------------------------------------------------------

/**
 * Diagonal SPD: A = diag(1, 2, ..., n). Exact eigenvalues 1..n.
 */
export function makeDiagonalSpd(n: number): {
  A: Float64Array
  n: number
  eigenvalues: Float64Array
} {
  const A = new Float64Array(n * n)
  const eigenvalues = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    A[i * n + i] = i + 1
    eigenvalues[i] = i + 1
  }
  return { A, n, eigenvalues }
}

/**
 * Symmetric tridiagonal diag-dominant SPD:
 * main = 2 + 0.1·i (or constant 4), off = −1.
 * Strong diagonal dominance → positive definite.
 */
export function makeTridiagSpd(n: number, diagBoost = 0): {
  a: Float64Array
  b: Float64Array
  n: number
} {
  const a = new Float64Array(n - 1)
  const b = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    b[i] = 4 + diagBoost + 0.05 * i
    if (i < n - 1) a[i] = -1
  }
  return { a, b, n }
}

/**
 * Dense diag-dominant SPD: A = D + 0.1 ones-sym + I scale.
 * A_ij = δ_ij · (n+1) + 0.05 · (i===j?0:1) style →
 * A = (n) I + 0.1 (ee^T) is rank-one SPD update if scaled well.
 * Use: A_ii = 10 + i, A_ij = 0.2 for i≠j (symmetric, diag dominant).
 */
export function makeDenseDiagDominantSpd(n: number): {
  A: Float64Array
  n: number
} {
  const A = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i * n + j] = i === j ? 10 + i : 0.25
    }
  }
  return { A, n }
}

// ---------------------------------------------------------------------------
// Sample runner
// ---------------------------------------------------------------------------

/**
 * Representative sample: Lanczos Ritz values vs exact extremal eigenvalues
 * on diag SPD and dense diag-dominant SPD.
 */
export function runLanczosEigSample(
  opts: {
    n?: number
    m?: number
  } = {},
): {
  n: number
  m: number
  ritzMin: number
  ritzMax: number
  exactMin: number
  exactMax: number
  absErrMin: number
  absErrMax: number
  denseAbsErrMin: number
  denseAbsErrMax: number
  tridiagRitzMax: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LANCZOS_EIG
  familyId: typeof METHOD_LANCZOS
} {
  const n = opts.n ?? 12
  const m = opts.m ?? Math.min(n, 12)

  // Diagonal SPD: eigenvalues 1..n — full m=n recovers exactly
  const diag = makeDiagonalSpd(n)
  const Ldiag = lanczos(makeDenseMatVec(diag.A, n), n, { m: n })
  const exactMin = 1
  const exactMax = n
  const ritzMin = Ldiag.ritzValues[0]!
  const ritzMax = Ldiag.ritzValues[Ldiag.ritzValues.length - 1]!
  const absErrMin = Math.abs(ritzMin - exactMin)
  const absErrMax = Math.abs(ritzMax - exactMax)

  // Dense diag-dominant: m steps approximate extremal eigenvalues
  const dense = makeDenseDiagDominantSpd(n)
  const exactD = jacobiEigenvalues(dense.A, n)
  const Ld = lanczos(makeDenseMatVec(dense.A, n), n, {
    m: Math.min(m, n),
    v0: (() => {
      const v = new Float64Array(n)
      for (let i = 0; i < n; i++) v[i] = 1 + 0.01 * i
      return v
    })(),
  })
  const denseAbsErrMin = Math.abs(Ld.ritzValues[0]! - exactD[0]!)
  const denseAbsErrMax = Math.abs(
    Ld.ritzValues[Ld.ritzValues.length - 1]! - exactD[n - 1]!,
  )

  // Tridiagonal SPD path
  const tri = makeTridiagSpd(n)
  const Lt = lanczos(makeTridiagSymMatVec(tri.a, tri.b), n, {
    m: Math.min(m, n),
  })
  const tridiagRitzMax = Lt.ritzValues[Lt.ritzValues.length - 1]!

  let finite = true
  for (const arr of [Ldiag.ritzValues, Ld.ritzValues, Lt.ritzValues]) {
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i]!)) finite = false
    }
  }

  // Extremal Ritz values for diag (full basis) should be exact;
  // for dense with m≈n or large m, extremals within moderate tol.
  const ok =
    finite &&
    absErrMin < 1e-8 &&
    absErrMax < 1e-8 &&
    denseAbsErrMin < 0.5 &&
    denseAbsErrMax < 0.5 &&
    tridiagRitzMax > 0

  return {
    n,
    m: Ld.m,
    ritzMin,
    ritzMax,
    exactMin,
    exactMax,
    absErrMin,
    absErrMax,
    denseAbsErrMin,
    denseAbsErrMax,
    tridiagRitzMax,
    finite,
    ok,
    methodId: METHOD_ALGO_LANCZOS_EIG,
    familyId: METHOD_LANCZOS,
  }
}
