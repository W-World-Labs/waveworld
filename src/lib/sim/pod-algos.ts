/**
 * POD / SVD reduced-order teaching stubs.
 * Snapshot matrix X (n_space × n_time); economy SVD via small Gram G = X^T X
 * eigendecomp (Jacobi) or power iteration for top-k singular vectors (n ≤ 16).
 * POD modes = left singular vectors; energy capture ratio; project + reconstruct.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Proper Orthogonal Decomposition / reduced-order models. */
export const METHOD_POD = 'method-pod'

/** Algo · economy POD-SVD of snapshot matrix via Gram eigendecomp. */
export const METHOD_ALGO_POD_SVD = 'method-algo-pod-svd'

/** Algo · project onto r POD modes and reconstruct. */
export const METHOD_ALGO_POD_PROJECT = 'method-algo-pod-project'

/** Parent alias (aligns with familyId). */
export const POD_PARENT = METHOD_POD

export const POD_METHOD_IDS = [
  METHOD_ALGO_POD_SVD,
  METHOD_ALGO_POD_PROJECT,
] as const

/** Teaching cap on space / time dimensions (dense Gram). */
export const POD_MAX_N = 16

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
 * Snapshot matrix layout: column-major nSpace × nTime.
 * X[i + j * nSpace] = spatial index i of snapshot j.
 */
export function snapshotAt(
  X: ArrayLike<number>,
  nSpace: number,
  i: number,
  j: number,
): number {
  return X[i + j * nSpace]!
}

/** Copy column j of X into out (length nSpace). */
export function getSnapshot(
  X: ArrayLike<number>,
  nSpace: number,
  nTime: number,
  j: number,
  out?: Float64Array,
): Float64Array {
  if (j < 0 || j >= nTime) throw new Error('getSnapshot: j out of range')
  const y = out ?? new Float64Array(nSpace)
  if (y.length !== nSpace) throw new Error('getSnapshot: out length')
  const base = j * nSpace
  for (let i = 0; i < nSpace; i++) y[i] = X[base + i]!
  return y
}

// ---------------------------------------------------------------------------
// Gram matrix + Jacobi symmetric eigendecomp
// ---------------------------------------------------------------------------

/**
 * G = X^T X (nTime × nTime, row-major).
 * G_jk = Σ_i X_ij X_ik (snapshot inner products).
 */
export function gramMatrix(
  X: ArrayLike<number>,
  nSpace: number,
  nTime: number,
): Float64Array {
  if (nSpace < 1 || nTime < 1) throw new Error('gramMatrix: dims ≥ 1')
  if (nSpace > POD_MAX_N || nTime > POD_MAX_N) {
    throw new Error(`gramMatrix: need n ≤ ${POD_MAX_N}`)
  }
  if (X.length < nSpace * nTime) throw new Error('gramMatrix: X size')
  const G = new Float64Array(nTime * nTime)
  for (let j = 0; j < nTime; j++) {
    const bj = j * nSpace
    for (let k = j; k < nTime; k++) {
      const bk = k * nSpace
      let s = 0
      for (let i = 0; i < nSpace; i++) s += X[bj + i]! * X[bk + i]!
      G[j * nTime + k] = s
      G[k * nTime + j] = s
    }
  }
  return G
}

/**
 * Classical Jacobi eigenvalue algorithm for symmetric n×n (row-major).
 * Returns eigenvalues (descending) and eigenvectors as columns of V (row-major n×n:
 * V[i + p * n] is component i of eigenvector p — column-major storage of V).
 * Teaching scale: n ≤ POD_MAX_N.
 */
export function jacobiEigenSymmetric(
  AIn: ArrayLike<number>,
  n: number,
  opts?: { maxSweeps?: number; tol?: number },
): { eigenvalues: Float64Array; eigenvectors: Float64Array } {
  if (!Number.isInteger(n) || n < 1 || n > POD_MAX_N) {
    throw new Error(`jacobiEigenSymmetric: need integer 1 ≤ n ≤ ${POD_MAX_N}`)
  }
  if (AIn.length < n * n) throw new Error('jacobiEigenSymmetric: A size')
  const maxSweeps = opts?.maxSweeps ?? 80
  const tol = opts?.tol ?? 1e-14

  // Work copy of A (row-major); V starts as I (column-major storage of columns).
  const A = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) A[i] = AIn[i]!
  const V = new Float64Array(n * n)
  for (let i = 0; i < n; i++) V[i + i * n] = 1

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
        // t = tan(θ); classical stable formula
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

        // Rotate A: zero A_pq
        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue
          const aip = A[i * n + p]!
          const aiq = A[i * n + q]!
          A[i * n + p] = c * aip - s * aiq
          A[p * n + i] = A[i * n + p]!
          A[i * n + q] = s * aip + c * aiq
          A[q * n + i] = A[i * n + q]!
        }
        const appNew = c * c * app - 2 * s * c * apq + s * s * aqq
        const aqqNew = s * s * app + 2 * s * c * apq + c * c * aqq
        A[p * n + p] = appNew
        A[q * n + q] = aqqNew
        A[p * n + q] = 0
        A[q * n + p] = 0

        // Accumulate V columns: v_p, v_q
        for (let i = 0; i < n; i++) {
          const vip = V[i + p * n]!
          const viq = V[i + q * n]!
          V[i + p * n] = c * vip - s * viq
          V[i + q * n] = s * vip + c * viq
        }
      }
    }
  }

  // Eigenvalues from diagonal; sort descending by |λ| then λ
  const idx = new Array<number>(n)
  for (let i = 0; i < n; i++) idx[i] = i
  idx.sort((a, b) => {
    const da = A[a! * n + a!]!
    const db = A[b! * n + b!]!
    return db - da // descending algebraic (energy uses λ≥0 for Gram)
  })

  const eigenvalues = new Float64Array(n)
  const eigenvectors = new Float64Array(n * n)
  for (let p = 0; p < n; p++) {
    const src = idx[p]!
    eigenvalues[p] = A[src * n + src]!
    for (let i = 0; i < n; i++) {
      eigenvectors[i + p * n] = V[i + src * n]!
    }
  }
  return { eigenvalues, eigenvectors }
}

/**
 * Power iteration for the dominant eigenpair of symmetric G (n×n row-major).
 * Teaching helper for top-1 singular vector path.
 */
export function powerIterSymmetric(
  G: ArrayLike<number>,
  n: number,
  opts?: { maxIter?: number; tol?: number; v0?: ArrayLike<number> },
): { eigenvalue: number; eigenvector: Float64Array; iterations: number } {
  if (n < 1 || G.length < n * n) throw new Error('powerIterSymmetric: size')
  const maxIter = opts?.maxIter ?? 200
  const tol = opts?.tol ?? 1e-12
  const v = new Float64Array(n)
  if (opts?.v0 && opts.v0.length === n) {
    for (let i = 0; i < n; i++) v[i] = opts.v0[i]!
  } else {
    for (let i = 0; i < n; i++) v[i] = 1 / Math.sqrt(n)
  }
  let nv = norm2(v)
  if (!(nv > 0)) throw new Error('powerIterSymmetric: zero start')
  for (let i = 0; i < n; i++) v[i]! /= nv

  const w = new Float64Array(n)
  let lambda = 0
  let iterations = 0
  for (let k = 0; k < maxIter; k++) {
    // w = G v
    for (let i = 0; i < n; i++) {
      let s = 0
      const row = i * n
      for (let j = 0; j < n; j++) s += G[row + j]! * v[j]!
      w[i] = s
    }
    lambda = dot(v, w)
    const nw = norm2(w)
    if (!(nw > 0)) break
    let diff = 0
    for (let i = 0; i < n; i++) {
      const wi = w[i]! / nw
      diff += (wi - v[i]!) * (wi - v[i]!)
      v[i] = wi
    }
    iterations = k + 1
    if (Math.sqrt(diff) < tol) break
  }
  return { eigenvalue: lambda, eigenvector: v, iterations }
}

// ---------------------------------------------------------------------------
// POD / economy SVD
// ---------------------------------------------------------------------------

export type PodSvdResult = {
  /** nSpace × r POD modes (left singular vectors), column-major. */
  modes: Float64Array
  /** Singular values σ_p ≥ 0, length r (descending). */
  singularValues: Float64Array
  /** nTime × r right singular vectors (columns of V), column-major. */
  rightVectors: Float64Array
  /** Per-mode energy σ_p² / Σ σ_q². */
  modalEnergy: Float64Array
  /** Cumulative energy capture of first (k+1) modes (index k): Σ_{p=0..k} σ_p² / total. */
  cumulativeEnergy: Float64Array
  totalEnergy: number
  nSpace: number
  nTime: number
  rank: number
}

/**
 * Economy POD-SVD of snapshot matrix X via Gram G = X^T X.
 * X = U Σ V^T with U = X V Σ^{+} (left singular / POD modes).
 * r = min(nSpace, nTime, opts.rank ?? full); drops λ below relTol * λ_max.
 */
export function podSvd(
  X: ArrayLike<number>,
  nSpace: number,
  nTime: number,
  opts?: { rank?: number; relTol?: number },
): PodSvdResult {
  if (!Number.isInteger(nSpace) || !Number.isInteger(nTime)) {
    throw new Error('podSvd: integer dims')
  }
  if (nSpace < 1 || nTime < 1 || nSpace > POD_MAX_N || nTime > POD_MAX_N) {
    throw new Error(`podSvd: need 1 ≤ nSpace,nTime ≤ ${POD_MAX_N}`)
  }
  if (X.length < nSpace * nTime) throw new Error('podSvd: X size')

  const G = gramMatrix(X, nSpace, nTime)
  const { eigenvalues, eigenvectors } = jacobiEigenSymmetric(G, nTime)
  const relTol = opts?.relTol ?? 1e-12
  const lamMax = Math.max(eigenvalues[0]!, 0)
  const thresh = relTol * Math.max(lamMax, 1e-30)

  // Count significant modes (λ ≥ thresh and λ > 0)
  let rFull = 0
  for (let p = 0; p < nTime; p++) {
    if (eigenvalues[p]! > thresh) rFull++
    else break
  }
  rFull = Math.min(rFull, nSpace, nTime)
  if (rFull < 1 && lamMax > 0) rFull = 1
  const rReq = opts?.rank ?? rFull
  const r = Math.max(0, Math.min(rReq, rFull, nSpace, nTime))

  const singularValues = new Float64Array(r)
  const rightVectors = new Float64Array(nTime * r)
  const modes = new Float64Array(nSpace * r)

  let totalEnergy = 0
  for (let p = 0; p < nTime; p++) {
    const lam = Math.max(eigenvalues[p]!, 0)
    totalEnergy += lam
  }
  if (!(totalEnergy > 0)) totalEnergy = 0

  for (let p = 0; p < r; p++) {
    const lam = Math.max(eigenvalues[p]!, 0)
    const sigma = Math.sqrt(lam)
    singularValues[p] = sigma
    // V column p
    for (let j = 0; j < nTime; j++) {
      rightVectors[j + p * nTime] = eigenvectors[j + p * nTime]!
    }
    // U column: u = X v / σ  (if σ ~ 0, leave zero)
    if (sigma > 1e-15) {
      const inv = 1 / sigma
      for (let i = 0; i < nSpace; i++) {
        let s = 0
        for (let j = 0; j < nTime; j++) {
          s += X[i + j * nSpace]! * rightVectors[j + p * nTime]!
        }
        modes[i + p * nSpace] = s * inv
      }
      // re-orthonormalize lightly against previous modes (Gram–Schmidt)
      for (let q = 0; q < p; q++) {
        let c = 0
        for (let i = 0; i < nSpace; i++) {
          c += modes[i + p * nSpace]! * modes[i + q * nSpace]!
        }
        for (let i = 0; i < nSpace; i++) {
          modes[i + p * nSpace]! -= c * modes[i + q * nSpace]!
        }
      }
      let nu = 0
      for (let i = 0; i < nSpace; i++) {
        const ui = modes[i + p * nSpace]!
        nu += ui * ui
      }
      nu = Math.sqrt(nu)
      if (nu > 1e-15) {
        const invU = 1 / nu
        for (let i = 0; i < nSpace; i++) modes[i + p * nSpace]! *= invU
      }
    }
  }

  const modalEnergy = new Float64Array(r)
  const cumulativeEnergy = new Float64Array(r)
  let run = 0
  for (let p = 0; p < r; p++) {
    const e = singularValues[p]! * singularValues[p]!
    modalEnergy[p] = totalEnergy > 0 ? e / totalEnergy : 0
    run += e
    cumulativeEnergy[p] = totalEnergy > 0 ? run / totalEnergy : 0
  }

  return {
    modes,
    singularValues,
    rightVectors,
    modalEnergy,
    cumulativeEnergy,
    totalEnergy,
    nSpace,
    nTime,
    rank: r,
  }
}

/**
 * Energy capture ratio of the first k modes: sum_{p=0..k-1} σ_p² / sum_all σ_q².
 * k in 1..rank; uses cumulativeEnergy[k-1] when available.
 */
export function energyCaptureRatio(pod: PodSvdResult, k: number): number {
  if (k <= 0) return 0
  if (k >= pod.rank) {
    return pod.rank > 0 ? pod.cumulativeEnergy[pod.rank - 1]! : 0
  }
  return pod.cumulativeEnergy[k - 1]!
}

// ---------------------------------------------------------------------------
// Projection + reconstruction
// ---------------------------------------------------------------------------

/**
 * Project one snapshot (length nSpace) onto first r modes:
 * coeff_p = u_p · x  (modes orthonormal ⇒ Galerkin).
 */
export function projectSnapshot(
  modes: ArrayLike<number>,
  nSpace: number,
  r: number,
  x: ArrayLike<number>,
  out?: Float64Array,
): Float64Array {
  if (x.length < nSpace) throw new Error('projectSnapshot: x length')
  if (modes.length < nSpace * r) throw new Error('projectSnapshot: modes size')
  const c = out ?? new Float64Array(r)
  if (c.length !== r) throw new Error('projectSnapshot: out length')
  for (let p = 0; p < r; p++) {
    let s = 0
    const base = p * nSpace
    for (let i = 0; i < nSpace; i++) s += modes[base + i]! * x[i]!
    c[p] = s
  }
  return c
}

/**
 * Reconstruct x ≈ Σ_p coeff_p u_p from POD coefficients.
 */
export function reconstructSnapshot(
  modes: ArrayLike<number>,
  nSpace: number,
  r: number,
  coeffs: ArrayLike<number>,
  out?: Float64Array,
): Float64Array {
  if (coeffs.length < r) throw new Error('reconstructSnapshot: coeffs')
  if (modes.length < nSpace * r) throw new Error('reconstructSnapshot: modes')
  const x = out ?? new Float64Array(nSpace)
  if (x.length !== nSpace) throw new Error('reconstructSnapshot: out length')
  x.fill(0)
  for (let p = 0; p < r; p++) {
    const cp = coeffs[p]!
    const base = p * nSpace
    for (let i = 0; i < nSpace; i++) x[i]! += cp * modes[base + i]!
  }
  return x
}

/**
 * Frobenius reconstruction error of full snapshot matrix using first r modes:
 * ‖X − U_r U_r^T X‖_F / ‖X‖_F  (relative).
 */
export function reconstructionErrorRel(
  X: ArrayLike<number>,
  nSpace: number,
  nTime: number,
  modes: ArrayLike<number>,
  r: number,
): number {
  let num = 0
  let den = 0
  const xj = new Float64Array(nSpace)
  const recon = new Float64Array(nSpace)
  const coeffs = new Float64Array(r)
  for (let j = 0; j < nTime; j++) {
    getSnapshot(X, nSpace, nTime, j, xj)
    projectSnapshot(modes, nSpace, r, xj, coeffs)
    reconstructSnapshot(modes, nSpace, r, coeffs, recon)
    for (let i = 0; i < nSpace; i++) {
      const d = xj[i]! - recon[i]!
      num += d * d
      den += xj[i]! * xj[i]!
    }
  }
  if (!(den > 0)) return 0
  return Math.sqrt(num / den)
}

// ---------------------------------------------------------------------------
// Toy snapshot generators
// ---------------------------------------------------------------------------

/**
 * Rank-deficient teaching snapshots:
 * X = Σ_{p=0}^{rank-1} σ_p u_p v_p^T with orthonormal-ish u, v and decaying σ.
 * Exact numerical rank ≤ rank (within noise).
 */
export function makeLowRankSnapshots(
  nSpace: number,
  nTime: number,
  rank: number,
  opts?: { noise?: number; seed?: number },
): {
  X: Float64Array
  trueRank: number
  trueSigmas: Float64Array
} {
  if (nSpace < 1 || nTime < 1 || rank < 1) {
    throw new Error('makeLowRankSnapshots: dims')
  }
  if (nSpace > POD_MAX_N || nTime > POD_MAX_N) {
    throw new Error(`makeLowRankSnapshots: n ≤ ${POD_MAX_N}`)
  }
  const r = Math.min(rank, nSpace, nTime)
  const noise = opts?.noise ?? 0
  // Deterministic pseudo-random from seed
  let state = (opts?.seed ?? 42) >>> 0
  const rnd = (): number => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }

  const U = new Float64Array(nSpace * r)
  const V = new Float64Array(nTime * r)
  const sigmas = new Float64Array(r)

  // Build roughly orthogonal columns via Gram–Schmidt on random vectors
  for (let p = 0; p < r; p++) {
    for (let i = 0; i < nSpace; i++) U[i + p * nSpace] = rnd() - 0.5
    for (let q = 0; q < p; q++) {
      let c = 0
      for (let i = 0; i < nSpace; i++) c += U[i + p * nSpace]! * U[i + q * nSpace]!
      for (let i = 0; i < nSpace; i++) U[i + p * nSpace]! -= c * U[i + q * nSpace]!
    }
    let nu = 0
    for (let i = 0; i < nSpace; i++) nu += U[i + p * nSpace]! * U[i + p * nSpace]!
    nu = Math.sqrt(nu)
    if (!(nu > 1e-15)) throw new Error('makeLowRankSnapshots: U collapse')
    for (let i = 0; i < nSpace; i++) U[i + p * nSpace]! /= nu

    for (let j = 0; j < nTime; j++) V[j + p * nTime] = rnd() - 0.5
    for (let q = 0; q < p; q++) {
      let c = 0
      for (let j = 0; j < nTime; j++) c += V[j + p * nTime]! * V[j + q * nTime]!
      for (let j = 0; j < nTime; j++) V[j + p * nTime]! -= c * V[j + q * nTime]!
    }
    let nv = 0
    for (let j = 0; j < nTime; j++) nv += V[j + p * nTime]! * V[j + p * nTime]!
    nv = Math.sqrt(nv)
    if (!(nv > 1e-15)) throw new Error('makeLowRankSnapshots: V collapse')
    for (let j = 0; j < nTime; j++) V[j + p * nTime]! /= nv

    // Decaying singular values: 4, 2, 1, 0.5, ...
    sigmas[p] = 4 * Math.pow(0.5, p)
  }

  const X = new Float64Array(nSpace * nTime)
  for (let p = 0; p < r; p++) {
    const sp = sigmas[p]!
    for (let j = 0; j < nTime; j++) {
      const vjp = V[j + p * nTime]!
      const base = j * nSpace
      for (let i = 0; i < nSpace; i++) {
        X[base + i]! += sp * U[i + p * nSpace]! * vjp
      }
    }
  }
  if (noise > 0) {
    for (let k = 0; k < X.length; k++) {
      X[k]! += noise * (rnd() - 0.5)
    }
  }

  return { X, trueRank: r, trueSigmas: sigmas }
}

/**
 * Separable field snapshots on a 1D grid:
 * u(x,t) = sin(π x) cos(ω t) + 0.3 sin(2π x) cos(2 ω t)
 * exact POD rank ≤ 2 (two spatial modes).
 */
export function makeWaveSnapshots(
  nSpace: number,
  nTime: number,
  opts?: { omega?: number },
): Float64Array {
  if (nSpace < 2 || nTime < 2) throw new Error('makeWaveSnapshots: n ≥ 2')
  if (nSpace > POD_MAX_N || nTime > POD_MAX_N) {
    throw new Error(`makeWaveSnapshots: n ≤ ${POD_MAX_N}`)
  }
  const omega = opts?.omega ?? 1
  const X = new Float64Array(nSpace * nTime)
  for (let j = 0; j < nTime; j++) {
    const t = j / Math.max(nTime - 1, 1)
    const c1 = Math.cos(omega * t)
    const c2 = Math.cos(2 * omega * t)
    const base = j * nSpace
    for (let i = 0; i < nSpace; i++) {
      const x = i / Math.max(nSpace - 1, 1)
      X[base + i] =
        Math.sin(Math.PI * x) * c1 + 0.3 * Math.sin(2 * Math.PI * x) * c2
    }
  }
  return X
}

// ---------------------------------------------------------------------------
// Representative samples
// ---------------------------------------------------------------------------

/**
 * Representative POD-SVD sample on low-rank snapshots.
 * Checks singular values, energy capture, orthonormality of modes.
 */
export function runPodSvdSample(
  opts: {
    nSpace?: number
    nTime?: number
    trueRank?: number
  } = {},
): {
  nSpace: number
  nTime: number
  trueRank: number
  recoveredRank: number
  energyTop: number
  modesOrthonormal: boolean
  maxOrthoOff: number
  sigma0: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_POD_SVD
  familyId: typeof METHOD_POD
} {
  const nSpace = opts.nSpace ?? 10
  const nTime = opts.nTime ?? 8
  const trueRank = opts.trueRank ?? 3
  const toy = makeLowRankSnapshots(nSpace, nTime, trueRank, { seed: 7 })
  const pod = podSvd(toy.X, nSpace, nTime)

  // Mode orthonormality: U^T U ≈ I
  let maxOrthoOff = 0
  let modesOrthonormal = true
  const r = pod.rank
  for (let p = 0; p < r; p++) {
    for (let q = 0; q < r; q++) {
      let c = 0
      for (let i = 0; i < nSpace; i++) {
        c += pod.modes[i + p * nSpace]! * pod.modes[i + q * nSpace]!
      }
      const target = p === q ? 1 : 0
      const d = Math.abs(c - target)
      if (d > maxOrthoOff) maxOrthoOff = d
      if (d > 1e-8) modesOrthonormal = false
    }
  }

  const energyTop = energyCaptureRatio(pod, Math.min(trueRank, r))
  const sigma0 = r > 0 ? pod.singularValues[0]! : 0
  let finite = Number.isFinite(sigma0) && Number.isFinite(pod.totalEnergy)
  for (let p = 0; p < r; p++) {
    if (!Number.isFinite(pod.singularValues[p]!)) finite = false
  }

  // Recovered numerical rank should be ≥ trueRank and energy of trueRank ≈ 1
  const recoveredRank = pod.rank
  const ok =
    finite &&
    modesOrthonormal &&
    recoveredRank >= trueRank &&
    energyTop > 0.999 &&
    sigma0 > 0

  return {
    nSpace,
    nTime,
    trueRank,
    recoveredRank,
    energyTop,
    modesOrthonormal,
    maxOrthoOff,
    sigma0,
    finite,
    ok,
    methodId: METHOD_ALGO_POD_SVD,
    familyId: METHOD_POD,
  }
}

/**
 * Representative project + reconstruct sample on rank-deficient data.
 * Reconstruction error small when r ≥ true rank.
 */
export function runPodProjectSample(
  opts: {
    nSpace?: number
    nTime?: number
    trueRank?: number
    r?: number
  } = {},
): {
  nSpace: number
  nTime: number
  trueRank: number
  r: number
  errFull: number
  errUnder: number
  energyAtR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_POD_PROJECT
  familyId: typeof METHOD_POD
} {
  const nSpace = opts.nSpace ?? 12
  const nTime = opts.nTime ?? 10
  const trueRank = opts.trueRank ?? 2
  const toy = makeLowRankSnapshots(nSpace, nTime, trueRank, { seed: 11 })
  const pod = podSvd(toy.X, nSpace, nTime)
  const r = opts.r ?? trueRank

  const errFull = reconstructionErrorRel(
    toy.X,
    nSpace,
    nTime,
    pod.modes,
    Math.min(r, pod.rank),
  )
  // Under-resolved: r-1 modes should leave residual energy
  const rUnder = Math.max(1, Math.min(trueRank - 1, pod.rank))
  const errUnder =
    trueRank > 1
      ? reconstructionErrorRel(toy.X, nSpace, nTime, pod.modes, rUnder)
      : 1
  const energyAtR = energyCaptureRatio(pod, Math.min(r, pod.rank))

  let finite = Number.isFinite(errFull) && Number.isFinite(errUnder)
  for (let i = 0; i < pod.modes.length; i++) {
    if (!Number.isFinite(pod.modes[i]!)) finite = false
  }

  const ok =
    finite &&
    errFull < 1e-8 &&
    energyAtR > 0.999 &&
    (trueRank <= 1 || errUnder > errFull * 10 || errUnder > 1e-4)

  return {
    nSpace,
    nTime,
    trueRank,
    r: Math.min(r, pod.rank),
    errFull,
    errUnder,
    energyAtR,
    finite,
    ok,
    methodId: METHOD_ALGO_POD_PROJECT,
    familyId: METHOD_POD,
  }
}
