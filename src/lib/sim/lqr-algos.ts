/**
 * Discrete LQR · finite-horizon / DARE Riccati iteration for 1D–2D systems.
 * x' = A x + B u; quadratic cost with Q, R; gain K from steady P.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · discrete LQR. */
export const METHOD_LQR = 'method-lqr'

/** Algo · discrete Riccati (DARE iteration) + LQR gain. */
export const METHOD_ALGO_LQR_RICCATI = 'method-algo-lqr-riccati'

/** Parent alias (aligns with familyId). */
export const LQR_PARENT = METHOD_LQR

export const LQR_METHOD_IDS = [METHOD_ALGO_LQR_RICCATI] as const

// ---------------------------------------------------------------------------
// Small dense helpers (row-major Float64Array, n ≤ 2 teaching scale)
// ---------------------------------------------------------------------------

/** y = M x, M row-major n×n. */
export function matVec(
  M: ArrayLike<number>,
  n: number,
  x: ArrayLike<number>,
  y: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    let s = 0
    const row = i * n
    for (let j = 0; j < n; j++) s += M[row + j]! * x[j]!
    y[i] = s
  }
}

/** C = A B, all row-major n×n (or n×m with m cols for B,C). */
export function matMul(
  A: ArrayLike<number>,
  B: ArrayLike<number>,
  n: number,
  m: number,
  p: number,
  out?: Float64Array,
): Float64Array {
  const C = out ?? new Float64Array(n * p)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      let s = 0
      for (let k = 0; k < m; k++) s += A[i * m + k]! * B[k * p + j]!
      C[i * p + j] = s
    }
  }
  return C
}

/** B = Aᵀ (n×m → m×n). */
export function matTranspose(
  A: ArrayLike<number>,
  n: number,
  m: number,
  out?: Float64Array,
): Float64Array {
  const T = out ?? new Float64Array(m * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) T[j * n + i] = A[i * m + j]!
  }
  return T
}

/** C = α A + β B (same length). */
export function matAxpy(
  alpha: number,
  A: ArrayLike<number>,
  beta: number,
  B: ArrayLike<number>,
  out?: Float64Array,
): Float64Array {
  const n = A.length
  const C = out ?? new Float64Array(n)
  for (let i = 0; i < n; i++) C[i] = alpha * A[i]! + beta * B[i]!
  return C
}

/** Frobenius norm. */
export function frobenius(M: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < M.length; i++) s += M[i]! * M[i]!
  return Math.sqrt(s)
}

/** Invert 1×1 or 2×2 row-major; throws if singular. */
export function invSmall(M: ArrayLike<number>, n: number): Float64Array {
  if (n === 1) {
    const a = M[0]!
    if (!(Math.abs(a) > 1e-30)) throw new Error('invSmall: singular 1×1')
    return new Float64Array([1 / a])
  }
  if (n !== 2) throw new Error('invSmall: only n=1 or 2')
  const a = M[0]!,
    b = M[1]!,
    c = M[2]!,
    d = M[3]!
  const det = a * d - b * c
  if (!(Math.abs(det) > 1e-30)) throw new Error('invSmall: singular 2×2')
  const inv = 1 / det
  return new Float64Array([d * inv, -b * inv, -c * inv, a * inv])
}

/**
 * Spectral radius of 1×1 or 2×2 real matrix (row-major).
 * 2×2: eigenvalues of characteristic polynomial λ² − tr λ + det = 0.
 */
export function spectralRadius(M: ArrayLike<number>, n: number): number {
  if (n === 1) return Math.abs(M[0]!)
  if (n !== 2) throw new Error('spectralRadius: only n=1 or 2')
  const a = M[0]!,
    b = M[1]!,
    c = M[2]!,
    d = M[3]!
  const tr = a + d
  const det = a * d - b * c
  const disc = tr * tr - 4 * det
  if (disc >= 0) {
    const s = Math.sqrt(disc)
    return Math.max(Math.abs((tr + s) / 2), Math.abs((tr - s) / 2))
  }
  // complex conjugate pair: |λ| = sqrt(det) when det>0; else modulus of roots
  return Math.sqrt(Math.abs(det))
}

// ---------------------------------------------------------------------------
// Discrete Riccati / LQR
// ---------------------------------------------------------------------------

export type LqrSystem = {
  /** State dim n (1 or 2). */
  n: number
  /** Input dim m (1 or 2, m ≤ n for teaching toys). */
  m: number
  /** A row-major n×n. */
  A: Float64Array
  /** B row-major n×m. */
  B: Float64Array
  /** Q row-major n×n (SPD-ish). */
  Q: Float64Array
  /** R row-major m×m (SPD). */
  R: Float64Array
}

export type RiccatiResult = {
  /** Steady (or final) cost-to-go P, row-major n×n. */
  P: Float64Array
  /** Gain K, row-major m×n: u = −K x. */
  K: Float64Array
  /** ‖P_{k+1}−P_k‖_F history (after each iterate). */
  deltas: number[]
  iterations: number
  converged: boolean
}

/**
 * One discrete Riccati step (backward):
 *   S = R + Bᵀ P B
 *   K = S⁻¹ Bᵀ P A
 *   P' = Aᵀ P A − Aᵀ P B K + Q
 *      = Aᵀ P (A − B K) + Q
 * Returns new P and gain K for this P (feedback from current cost-to-go).
 */
export function riccatiStep(
  sys: LqrSystem,
  P: ArrayLike<number>,
): { Pnext: Float64Array; K: Float64Array } {
  const { n, m, A, B, Q, R } = sys
  // Bt = Bᵀ (m×n)
  const Bt = matTranspose(B, n, m)
  // PB = P B (n×m)
  const PB = matMul(P, B, n, n, m)
  // BtPB = Bᵀ P B (m×m)
  const BtPB = matMul(Bt, PB, m, n, m)
  // S = R + Bᵀ P B
  const S = matAxpy(1, R, 1, BtPB)
  const Sinv = invSmall(S, m)
  // BtPA = Bᵀ P A (m×n)
  const PA = matMul(P, A, n, n, n)
  const BtPA = matMul(Bt, PA, m, n, n)
  // K = S⁻¹ Bᵀ P A (m×n)
  const K = matMul(Sinv, BtPA, m, m, n)
  // Acl = A − B K (n×n)
  const BK = matMul(B, K, n, m, n)
  const Acl = matAxpy(1, A, -1, BK)
  // Pnext = Aᵀ P Acl + Q
  const PAcl = matMul(P, Acl, n, n, n)
  const At = matTranspose(A, n, n)
  const AtPAcl = matMul(At, PAcl, n, n, n)
  const Pnext = matAxpy(1, AtPAcl, 1, Q)
  return { Pnext, K }
}

/**
 * DARE fixed-point iteration: start from P₀ = Q (or P0), iterate riccatiStep
 * until ‖ΔP‖_F < tol or maxIter. Final K from last P.
 */
export function dareIterate(
  sys: LqrSystem,
  opts?: {
    maxIter?: number
    tol?: number
    P0?: ArrayLike<number>
  },
): RiccatiResult {
  const { n, m } = sys
  const maxIter = opts?.maxIter ?? 200
  const tol = opts?.tol ?? 1e-12
  let P = opts?.P0
    ? new Float64Array(opts.P0)
    : new Float64Array(sys.Q)
  if (P.length !== n * n) throw new Error('dareIterate: P0 size')

  const deltas: number[] = []
  let K = new Float64Array(m * n)
  let converged = false
  let iterations = 0

  for (let k = 0; k < maxIter; k++) {
    const step = riccatiStep(sys, P)
    const d = frobenius(matAxpy(1, step.Pnext, -1, P))
    deltas.push(d)
    P = new Float64Array(step.Pnext)
    K = new Float64Array(step.K)
    iterations++
    if (d < tol) {
      converged = true
      break
    }
  }

  // refresh K from final P
  const final = riccatiStep(sys, P)
  K = new Float64Array(final.K)
  // one more delta not needed; P is fixed-point iterate

  return { P, K, deltas, iterations, converged }
}

/**
 * Finite-horizon discrete LQR: P_N = Qf (default Q), step backward N times.
 * Returns terminal-stage gain sequence K[0..N-1] (stage 0 is first applied)
 * and P_0. For infinite-horizon teaching, prefer dareIterate.
 */
export function finiteHorizonLqr(
  sys: LqrSystem,
  N: number,
  Qf?: ArrayLike<number>,
): {
  P0: Float64Array
  /** Gains from stage 0 .. N-1, each m×n row-major. */
  gains: Float64Array[]
  /** Cost-to-go after each backward step (length N+1), P_N .. P_0. */
  Pseq: Float64Array[]
} {
  if (!(N >= 1)) throw new Error('finiteHorizonLqr: N ≥ 1')
  let P = Qf ? new Float64Array(Qf) : new Float64Array(sys.Q)
  const Pseq: Float64Array[] = [new Float64Array(P)]
  const gainsRev: Float64Array[] = []

  for (let k = 0; k < N; k++) {
    const step = riccatiStep(sys, P)
    gainsRev.push(new Float64Array(step.K))
    P = new Float64Array(step.Pnext)
    Pseq.push(new Float64Array(P))
  }

  // reverse gains so gains[0] is for first stage (from P_1)
  const gains = gainsRev.reverse()
  // Pseq was [P_N, P_{N-1}, ..., P_0] — keep that order documented
  return { P0: P, gains, Pseq }
}

/** Closed-loop A_cl = A − B K. */
export function closedLoopA(sys: LqrSystem, K: ArrayLike<number>): Float64Array {
  const { n, m, A, B } = sys
  const BK = matMul(B, K, n, m, n)
  return matAxpy(1, A, -1, BK)
}

/**
 * Controllable 1D unstable toy: A=1.2, B=1, Q=1, R=1.
 * Open-loop |ρ|=1.2 > 1; LQR should stabilize.
 */
export function makeLqrToy1d(): LqrSystem {
  return {
    n: 1,
    m: 1,
    A: new Float64Array([1.2]),
    B: new Float64Array([1]),
    Q: new Float64Array([1]),
    R: new Float64Array([1]),
  }
}

/**
 * Controllable 2D toy (discrete double-integrator-ish unstable):
 *   A = [[1.1, 0.1], [0, 1.05]], B = [[0], [1]]
 *   Q = I, R = [1]
 */
export function makeLqrToy2d(): LqrSystem {
  return {
    n: 2,
    m: 1,
    A: new Float64Array([1.1, 0.1, 0, 1.05]),
    B: new Float64Array([0, 1]),
    Q: new Float64Array([1, 0, 0, 1]),
    R: new Float64Array([1]),
  }
}

/**
 * Representative sample: DARE Riccati on 1D + 2D controllable toys.
 * ok when closed-loop spectral radius < open-loop (stabilizing gain).
 */
export function runLqrRiccatiSample(
  opts: {
    maxIter?: number
    tol?: number
  } = {},
): {
  rhoOpen1d: number
  rhoCl1d: number
  rhoOpen2d: number
  rhoCl2d: number
  stabilized1d: boolean
  stabilized2d: boolean
  K1d: Float64Array
  K2d: Float64Array
  P1d: Float64Array
  P2d: Float64Array
  iterations1d: number
  iterations2d: number
  converged1d: boolean
  converged2d: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LQR_RICCATI
  familyId: typeof METHOD_LQR
} {
  const maxIter = opts.maxIter ?? 200
  const tol = opts.tol ?? 1e-12

  const sys1 = makeLqrToy1d()
  const r1 = dareIterate(sys1, { maxIter, tol })
  const Acl1 = closedLoopA(sys1, r1.K)
  const rhoOpen1d = spectralRadius(sys1.A, 1)
  const rhoCl1d = spectralRadius(Acl1, 1)
  const stabilized1d = rhoCl1d < rhoOpen1d && rhoCl1d < 1

  const sys2 = makeLqrToy2d()
  const r2 = dareIterate(sys2, { maxIter, tol })
  const Acl2 = closedLoopA(sys2, r2.K)
  const rhoOpen2d = spectralRadius(sys2.A, 2)
  const rhoCl2d = spectralRadius(Acl2, 2)
  const stabilized2d = rhoCl2d < rhoOpen2d && rhoCl2d < 1

  let finite = true
  for (const v of [r1.P, r1.K, r2.P, r2.K, Acl1, Acl2]) {
    for (let i = 0; i < v.length; i++) {
      if (!Number.isFinite(v[i]!)) finite = false
    }
  }
  finite =
    finite &&
    Number.isFinite(rhoOpen1d) &&
    Number.isFinite(rhoCl1d) &&
    Number.isFinite(rhoOpen2d) &&
    Number.isFinite(rhoCl2d)

  const ok =
    finite &&
    stabilized1d &&
    stabilized2d &&
    (r1.converged || r1.deltas[r1.deltas.length - 1]! < 1e-8) &&
    (r2.converged || r2.deltas[r2.deltas.length - 1]! < 1e-8)

  return {
    rhoOpen1d,
    rhoCl1d,
    rhoOpen2d,
    rhoCl2d,
    stabilized1d,
    stabilized2d,
    K1d: r1.K,
    K2d: r2.K,
    P1d: r1.P,
    P2d: r2.P,
    iterations1d: r1.iterations,
    iterations2d: r2.iterations,
    converged1d: r1.converged,
    converged2d: r2.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_LQR_RICCATI,
    familyId: METHOD_LQR,
  }
}
