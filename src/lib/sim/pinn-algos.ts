/**
 * Physics-informed residual teaching stubs (not full NN training).
 * Trial linear model (Fourier / polynomial coeffs) on collocation points;
 * residual L2 for y''+y=0 or heat u_t − ν u_xx; fit weights by normal
 * equations or one gradient step so residual decreases.
 * method id constants only — no methods.data / registry / edges.
 */

/** Parent family · PINN residual teaching. */
export const METHOD_PINN = 'method-pinn'

/** Algorithm · collocation residual + linear weight fit. */
export const METHOD_ALGO_PINN_RESIDUAL = 'method-algo-pinn-residual'

export const PINN_METHOD_IDS = [METHOD_ALGO_PINN_RESIDUAL] as const

/** ‖v‖₂ */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** Collocation abscissae: n points in (a, b) open (Chebyshev-ish uniform interior). */
export function collocationPoints(n: number, a: number = 0, b: number = Math.PI): Float64Array {
  if (!(n >= 2) || !Number.isInteger(n)) {
    throw new Error('collocationPoints: n integer ≥ 2')
  }
  if (!(b > a)) throw new Error('collocationPoints: b > a')
  const xs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = a + ((i + 1) / (n + 1)) * (b - a)
  }
  return xs
}

/**
 * Sine Fourier trial basis on [0, π] (Dirichlet-friendly):
 * φ_k(x) = sin((k+1) x), k = 0..m−1.
 * Returns basis value at x for mode k.
 */
export function sineBasis(k: number, x: number): number {
  return Math.sin((k + 1) * x)
}

/** L[φ] = φ'' + φ for sine basis: (1 − (k+1)²) sin((k+1) x). */
export function sineBasisHarmonicResidual(k: number, x: number): number {
  const m = k + 1
  return (1 - m * m) * Math.sin(m * x)
}

/**
 * Trial y(x) = Σ_k w_k sin((k+1) x).
 */
export function trialSineSeries(x: number, w: ArrayLike<number>): number {
  let y = 0
  for (let k = 0; k < w.length; k++) y += w[k]! * sineBasis(k, x)
  return y
}

/**
 * Harmonic residual r(x) = y''(x) + y(x) for sine series trial.
 * Exact mode sin(x) (w=[1,0,…]) has r≡0.
 */
export function residualHarmonicOscillator(
  x: number,
  w: ArrayLike<number>,
): number {
  let r = 0
  for (let k = 0; k < w.length; k++) {
    r += w[k]! * sineBasisHarmonicResidual(k, x)
  }
  return r
}

/**
 * Collocation residual vector r_i = y''(x_i) + y(x_i).
 */
export function residualVectorHarmonic(
  xs: ArrayLike<number>,
  w: ArrayLike<number>,
): Float64Array {
  const r = new Float64Array(xs.length)
  for (let i = 0; i < xs.length; i++) {
    r[i] = residualHarmonicOscillator(xs[i]!, w)
  }
  return r
}

/** L2 residual √(Σ r_i² · Δx) with Δx ≈ (b−a)/(n+1), or plain ‖r‖₂ if measure=false. */
export function residualL2(
  xs: ArrayLike<number>,
  w: ArrayLike<number>,
  opts?: { a?: number; b?: number; measure?: boolean },
): number {
  const r = residualVectorHarmonic(xs, w)
  const n = r.length
  if (opts?.measure === false) return norm2(r)
  const a = opts?.a ?? 0
  const b = opts?.b ?? Math.PI
  const dx = (b - a) / (n + 1)
  let s = 0
  for (let i = 0; i < n; i++) s += r[i]! * r[i]!
  return Math.sqrt(s * dx)
}

/**
 * Monomial trial φ_j(x) = x^j, j=0..deg.
 * L[φ_j] = φ_j'' + φ_j for harmonic oscillator.
 */
export function polyBasis(j: number, x: number): number {
  return x ** j
}

export function polyBasisHarmonicResidual(j: number, x: number): number {
  // (x^j)'' = j(j−1) x^{j−2} for j≥2
  const y = x ** j
  const ypp = j >= 2 ? j * (j - 1) * x ** (j - 2) : 0
  return ypp + y
}

/**
 * Heat residual teaching: for separable trial
 * u(x,t) = Σ_k w_k sin((k+1)x) e^{−ν (k+1)² t}
 * exact solution of u_t − ν u_xx = 0 on [0,π] with Dirichlet,
 * residual is 0. Perturbed decay rates produce nonzero residual.
 *
 * Here: fixed t, trial spatial sine series with free weights;
 * residual of stationary heat u''=0 is less useful — instead evaluate
 * space-time residual for u = Σ w_k φ_k(x) τ_k(t) with τ_k = exp(−ν m² t)
 * when weights match pure modes residual vanishes.
 *
 * Simplified static form at fixed t with wrong decay:
 * r = Σ w_k (−ν m² − (−ν m²)) … trivial.
 *
 * Space-time sample residual for product trial with free α_k ≠ ν m²:
 * u = Σ w_k sin(m x) exp(−α_k t), r = u_t − ν u_xx
 *   = Σ w_k (−α_k + ν m²) sin(m x) exp(−α_k t)
 */
export function residualHeatProduct(
  x: number,
  t: number,
  w: ArrayLike<number>,
  alphas: ArrayLike<number>,
  nu: number,
): number {
  if (w.length !== alphas.length) {
    throw new Error('residualHeatProduct: w/alphas length mismatch')
  }
  if (!(nu > 0)) throw new Error('residualHeatProduct: nu > 0')
  let r = 0
  for (let k = 0; k < w.length; k++) {
    const m = k + 1
    const decay = Math.exp(-alphas[k]! * t)
    r += w[k]! * (-alphas[k]! + nu * m * m) * Math.sin(m * x) * decay
  }
  return r
}

/**
 * Dense Gauss elimination (partial pivot) for small systems.
 * A row-major n×n, b length n; returns new solution array.
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

  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i]!
    for (let j = i + 1; j < n; j++) s -= M[i * n + j]! * x[j]!
    x[i] = s / M[i * n + i]!
  }
  return x
}

/**
 * Design matrix for harmonic residual: A_ik = L[φ_k](x_i).
 * r = A w.
 */
export function residualDesignMatrix(
  xs: ArrayLike<number>,
  m: number,
): Float64Array {
  if (!(m >= 1) || !Number.isInteger(m)) {
    throw new Error('residualDesignMatrix: m integer ≥ 1')
  }
  const n = xs.length
  const A = new Float64Array(n * m)
  for (let i = 0; i < n; i++) {
    const x = xs[i]!
    for (let k = 0; k < m; k++) {
      A[i * m + k] = sineBasisHarmonicResidual(k, x)
    }
  }
  return A
}

/**
 * Fit linear weights minimizing
 *   ‖A w‖² + λ ‖B w − g‖²
 * with soft observation rows B (default: y(π/2) ≈ 1 via sine basis).
 * Pure residual min is w=0; soft data anchors amplitude.
 * Returns weights via normal equations (G w = rhs).
 */
export function fitWeightsNormalEq(opts?: {
  nColloc?: number
  m?: number
  lambda?: number
  /** Observation abscissae; default [π/2]. */
  xObs?: ArrayLike<number>
  /** Observation targets y; default [1]. */
  yObs?: ArrayLike<number>
}): Float64Array {
  const nColloc = opts?.nColloc ?? 24
  const m = opts?.m ?? 3
  const lambda = opts?.lambda ?? 10
  const xObs = opts?.xObs ?? new Float64Array([Math.PI / 2])
  const yObs = opts?.yObs ?? new Float64Array([1])
  if (xObs.length !== yObs.length) {
    throw new Error('fitWeightsNormalEq: xObs/yObs length mismatch')
  }

  const xs = collocationPoints(nColloc)
  const A = residualDesignMatrix(xs, m)
  const n = nColloc

  // G = AᵀA + λ BᵀB,  rhs = λ Bᵀ g
  const G = new Float64Array(m * m)
  const rhs = new Float64Array(m)

  for (let i = 0; i < n; i++) {
    for (let p = 0; p < m; p++) {
      const aip = A[i * m + p]!
      for (let q = 0; q < m; q++) {
        G[p * m + q] += aip * A[i * m + q]!
      }
    }
  }

  for (let o = 0; o < xObs.length; o++) {
    const xo = xObs[o]!
    const go = yObs[o]!
    for (let p = 0; p < m; p++) {
      const bp = sineBasis(p, xo)
      rhs[p] += lambda * bp * go
      for (let q = 0; q < m; q++) {
        G[p * m + q] += lambda * bp * sineBasis(q, xo)
      }
    }
  }

  return solveDenseGauss(G, rhs, m)
}

/**
 * One gradient-descent step on
 *   L(w) = ½ ‖A w‖² + (λ/2) ‖B w − g‖²
 * ∇L = Aᵀ A w + λ Bᵀ (B w − g).
 * Default λ=0 (pure residual) so one step strictly reduces ‖r‖ for small lr.
 * Returns new weight vector (does not mutate w0).
 * lr auto-scales by 1/(‖∇‖+ε) when lrAuto is true (default).
 */
export function residualGradientStep(
  w0: ArrayLike<number>,
  opts?: {
    nColloc?: number
    lr?: number
    /** Soft data weight; 0 = residual-only (default). */
    lambda?: number
    xObs?: ArrayLike<number>
    yObs?: ArrayLike<number>
    /** Scale step by 1/(‖grad‖+ε); default true. */
    lrAuto?: boolean
  },
): Float64Array {
  const m = w0.length
  const nColloc = opts?.nColloc ?? 24
  const lr = opts?.lr ?? 0.25
  const lambda = opts?.lambda ?? 0
  const xObs = opts?.xObs ?? new Float64Array([Math.PI / 2])
  const yObs = opts?.yObs ?? new Float64Array([1])
  const lrAuto = opts?.lrAuto ?? true

  const xs = collocationPoints(nColloc)
  const A = residualDesignMatrix(xs, m)
  const n = nColloc

  // r = A w
  const r = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < m; k++) s += A[i * m + k]! * w0[k]!
    r[i] = s
  }

  const grad = new Float64Array(m)
  // Aᵀ r
  for (let i = 0; i < n; i++) {
    const ri = r[i]!
    for (let k = 0; k < m; k++) grad[k] += A[i * m + k]! * ri
  }
  // λ Bᵀ (B w − g)
  if (lambda !== 0) {
    for (let o = 0; o < xObs.length; o++) {
      const xo = xObs[o]!
      let pred = 0
      for (let k = 0; k < m; k++) pred += w0[k]! * sineBasis(k, xo)
      const err = pred - yObs[o]!
      for (let k = 0; k < m; k++) grad[k] += lambda * sineBasis(k, xo) * err
    }
  }

  let step = lr
  if (lrAuto) {
    const gNorm = norm2(grad)
    step = lr / (gNorm + 1e-12)
  }

  const w1 = new Float64Array(m)
  for (let k = 0; k < m; k++) w1[k] = w0[k]! - step * grad[k]!
  return w1
}

/**
 * Representative sample: poor initial Fourier weights → residual L2 large;
 * one normal-eq fit (or GD step) reduces residual while matching y(π/2)≈1.
 */
export function runPinnResidualSample(opts?: {
  nColloc?: number
  m?: number
  /** 'normal' | 'gd' — fit mode for the one teaching step. */
  mode?: 'normal' | 'gd'
  lr?: number
  lambda?: number
}): {
  nColloc: number
  m: number
  mode: 'normal' | 'gd'
  w0: Float64Array
  w1: Float64Array
  residual0: number
  residual1: number
  residualDecreased: boolean
  yObsErr0: number
  yObsErr1: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PINN_RESIDUAL
  familyId: typeof METHOD_PINN
} {
  const nColloc = opts?.nColloc ?? 24
  const m = opts?.m ?? 3
  const mode = opts?.mode ?? 'normal'
  const lr = opts?.lr ?? 0.35
  // normal-eq needs soft data (else w→0); GD default pure residual
  const lambda = opts?.lambda ?? (mode === 'gd' ? 0 : 25)

  // Poor trial: mix of fundamental + polluting higher harmonics
  const w0 = new Float64Array(m)
  w0[0] = 0.4
  if (m > 1) w0[1] = 0.55
  if (m > 2) w0[2] = 0.35
  for (let k = 3; k < m; k++) w0[k] = 0.15 / k

  const xs = collocationPoints(nColloc)
  const residual0 = residualL2(xs, w0)
  const yMid0 = trialSineSeries(Math.PI / 2, w0)
  const yObsErr0 = Math.abs(yMid0 - 1)

  let w1: Float64Array
  if (mode === 'gd') {
    w1 = residualGradientStep(w0, { nColloc, lr, lambda })
  } else {
    w1 = fitWeightsNormalEq({ nColloc, m, lambda })
  }

  const residual1 = residualL2(xs, w1)
  const yMid1 = trialSineSeries(Math.PI / 2, w1)
  const yObsErr1 = Math.abs(yMid1 - 1)

  let finite =
    Number.isFinite(residual0) &&
    Number.isFinite(residual1) &&
    Number.isFinite(yMid0) &&
    Number.isFinite(yMid1)
  for (let k = 0; k < m; k++) {
    if (!Number.isFinite(w1[k]!)) finite = false
  }

  // Normal eq should nearly kill residual; GD only needs a decrease
  const residualDecreased = residual1 < residual0 * 0.98
  const ok =
    finite &&
    residualDecreased &&
    residual1 < residual0 &&
    (mode === 'normal' ? residual1 < residual0 * 0.5 : residual1 < residual0)

  return {
    nColloc,
    m,
    mode,
    w0,
    w1,
    residual0,
    residual1,
    residualDecreased,
    yObsErr0,
    yObsErr1,
    finite,
    ok,
    methodId: METHOD_ALGO_PINN_RESIDUAL,
    familyId: METHOD_PINN,
  }
}
