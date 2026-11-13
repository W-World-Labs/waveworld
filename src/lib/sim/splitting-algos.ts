/**
 * Operator splitting pure algos · Lie–Trotter / Strang on toy linear ODE.
 * u' = A u + B u with exact subflow exp(Δt A), exp(Δt B) (2D rotation + scaling).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · operator splitting. */
export const METHOD_SPLITTING = 'method-operator-splitting'

/** Algo · first-order Lie–Trotter product formula. */
export const METHOD_ALGO_LIE_TROTTER = 'method-algo-lie-trotter'

/** Algo · second-order Strang splitting. */
export const METHOD_ALGO_STRANG = 'method-algo-strang'

/** Parent alias (aligns with familyId). */
export const SPLITTING_PARENT = METHOD_SPLITTING

export const SPLITTING_METHOD_IDS = [
  METHOD_ALGO_LIE_TROTTER,
  METHOD_ALGO_STRANG,
] as const

/** 2-vector as [x, y]. */
export type Vec2 = [number, number]

/**
 * Toy split generators (2×2 linear):
 *   A = rotation generator [[0, −ω], [ω, 0]]  →  exp(t A) = R(ω t)
 *   B = diagonal scaling  [[λ, 0], [0, μ]]     →  exp(t B) = diag(e^{λ t}, e^{μ t})
 * Commute when λ = μ (isotropic scaling); generally noncommute when λ ≠ μ.
 */
export type SplitOps = {
  omega: number
  lambda: number
  mu: number
}

export const DEFAULT_COMMUTING: SplitOps = {
  omega: 1.2,
  lambda: -0.5,
  mu: -0.5,
}

export const DEFAULT_NONCOMMUTING: SplitOps = {
  omega: 1.5,
  lambda: -0.3,
  mu: -1.1,
}

/** ‖v‖₂ for length-2. */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** max_i |a_i − b_i| */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const e = Math.abs(a[i]! - b[i]!)
    if (e > m) m = e
  }
  return m
}

/** Apply exp(t A): 2D rotation by θ = ω t. */
export function applyExpA(u: Vec2, t: number, ops: SplitOps): Vec2 {
  const th = ops.omega * t
  const c = Math.cos(th)
  const s = Math.sin(th)
  const x = u[0]
  const y = u[1]
  return [c * x - s * y, s * x + c * y]
}

/** Apply exp(t B): anisotropic (or isotropic) scaling. */
export function applyExpB(u: Vec2, t: number, ops: SplitOps): Vec2 {
  return [u[0] * Math.exp(ops.lambda * t), u[1] * Math.exp(ops.mu * t)]
}

/**
 * Dense 2×2 matvec y = M x, M row-major [m00, m01, m10, m11].
 */
export function matVec2(
  M: ArrayLike<number>,
  x: ArrayLike<number>,
  y: Float64Array | number[],
): void {
  y[0] = M[0]! * x[0]! + M[1]! * x[1]!
  y[1] = M[2]! * x[0]! + M[3]! * x[1]!
}

/** Dense generator C = A + B as row-major 2×2: [[λ, −ω], [ω, μ]]. */
export function combinedGenerator(ops: SplitOps): Float64Array {
  return new Float64Array([ops.lambda, -ops.omega, ops.omega, ops.mu])
}

/**
 * Closed-form exp(t (A+B)) for A rotation + B diagonal scaling.
 * C = σ I + D with σ=(λ+μ)/2, D=[[δ,−ω],[ω,−δ]], δ=(λ−μ)/2,
 * D² = (δ² − ω²) I → cosh/cos series on the traceless part.
 */
export function expmCombined(t: number, ops: SplitOps): Float64Array {
  const { omega: w, lambda: lam, mu } = ops
  const sigma = 0.5 * (lam + mu)
  const delta = 0.5 * (lam - mu)
  const es = Math.exp(sigma * t)

  // pure isotropic scaling + rotation
  if (Math.abs(delta) < 1e-15) {
    const th = w * t
    const c = Math.cos(th) * es
    const s = Math.sin(th) * es
    return new Float64Array([c, -s, s, c])
  }

  // κ² = δ² − ω²; branch on sign
  const kappa2 = delta * delta - w * w
  let a = 0 // coeff of I in exp(t D)
  let b = 0 // coeff of D in exp(t D): exp(tD) = a I + b D
  if (kappa2 > 1e-16) {
    const k = Math.sqrt(kappa2)
    a = Math.cosh(k * t)
    b = Math.sinh(k * t) / k
  } else if (kappa2 < -1e-16) {
    const eta = Math.sqrt(-kappa2)
    a = Math.cos(eta * t)
    b = Math.sin(eta * t) / eta
  } else {
    // nilpotent-ish: D² ≈ 0
    a = 1
    b = t
  }

  // exp(t C) = e^{σ t} (a I + b D)
  // a I + b [[δ,−ω],[ω,−δ]] = [[a+bδ, −bω],[bω, a−bδ]]
  const e00 = es * (a + b * delta)
  const e01 = es * (-b * w)
  const e10 = es * (b * w)
  const e11 = es * (a - b * delta)
  return new Float64Array([e00, e01, e10, e11])
}

/** Exact flow exp(T (A+B)) u0. */
export function exactFlow(u0: Vec2, T: number, ops: SplitOps): Vec2 {
  const E = expmCombined(T, ops)
  const y = new Float64Array(2)
  matVec2(E, u0, y)
  return [y[0]!, y[1]!]
}

/**
 * One Lie–Trotter step: u ← exp(Δt A) exp(Δt B) u
 * (first-order product formula; order-1 global error).
 */
export function lieTrotterStep(u: Vec2, dt: number, ops: SplitOps): Vec2 {
  return applyExpA(applyExpB(u, dt, ops), dt, ops)
}

/**
 * One Strang step: u ← exp(Δt A/2) exp(Δt B) exp(Δt A/2) u
 * (second-order symmetric product; order-2 global error).
 */
export function strangStep(u: Vec2, dt: number, ops: SplitOps): Vec2 {
  const h = 0.5 * dt
  return applyExpA(applyExpB(applyExpA(u, h, ops), dt, ops), h, ops)
}

export type SplitIntegrateResult = {
  u: Vec2
  steps: number
  dt: number
  T: number
  err: number
  exact: Vec2
  finite: boolean
}

/**
 * Integrate over [0, T] with nSteps equal Δt = T/nSteps using Lie–Trotter.
 */
export function integrateLieTrotter(
  u0: Vec2,
  T: number,
  nSteps: number,
  ops: SplitOps,
): SplitIntegrateResult {
  const dt = T / nSteps
  let u: Vec2 = [u0[0], u0[1]]
  for (let k = 0; k < nSteps; k++) u = lieTrotterStep(u, dt, ops)
  const exact = exactFlow(u0, T, ops)
  const err = maxAbsDiff(u, exact)
  const finite = Number.isFinite(u[0]) && Number.isFinite(u[1])
  return { u, steps: nSteps, dt, T, err, exact, finite }
}

/**
 * Integrate over [0, T] with nSteps equal Δt using Strang.
 */
export function integrateStrang(
  u0: Vec2,
  T: number,
  nSteps: number,
  ops: SplitOps,
): SplitIntegrateResult {
  const dt = T / nSteps
  let u: Vec2 = [u0[0], u0[1]]
  for (let k = 0; k < nSteps; k++) u = strangStep(u, dt, ops)
  const exact = exactFlow(u0, T, ops)
  const err = maxAbsDiff(u, exact)
  const finite = Number.isFinite(u[0]) && Number.isFinite(u[1])
  return { u, steps: nSteps, dt, T, err, exact, finite }
}

/**
 * Representative Lie–Trotter sample: noncommuting ops, residual/error finite, ok.
 * familyId method-operator-splitting.
 */
export function runLieTrotterSample(
  opts: {
    T?: number
    nSteps?: number
    u0?: Vec2
    ops?: SplitOps
  } = {},
): {
  T: number
  nSteps: number
  dt: number
  err: number
  errStrang: number
  strangLowerError: boolean
  commutingErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LIE_TROTTER
  familyId: typeof METHOD_SPLITTING
} {
  const T = opts.T ?? 1
  const nSteps = opts.nSteps ?? 20
  const u0: Vec2 = opts.u0 ?? [1, 0.5]
  const ops = opts.ops ?? DEFAULT_NONCOMMUTING

  const lt = integrateLieTrotter(u0, T, nSteps, ops)
  const st = integrateStrang(u0, T, nSteps, ops)
  // commuting control: isotropic scaling → product exact
  const comm = integrateLieTrotter(u0, T, nSteps, DEFAULT_COMMUTING)

  const strangLowerError = st.err < lt.err * 0.95 || st.err < 1e-12
  const finite = lt.finite && st.finite && comm.finite
  const ok =
    finite &&
    lt.err < 0.5 &&
    strangLowerError &&
    comm.err < 1e-10

  return {
    T,
    nSteps,
    dt: lt.dt,
    err: lt.err,
    errStrang: st.err,
    strangLowerError,
    commutingErr: comm.err,
    finite,
    ok,
    methodId: METHOD_ALGO_LIE_TROTTER,
    familyId: METHOD_SPLITTING,
  }
}

/**
 * Representative Strang sample: same noncommuting toy; lower error than Lie–Trotter.
 * familyId method-operator-splitting.
 */
export function runStrangSample(
  opts: {
    T?: number
    nSteps?: number
    u0?: Vec2
    ops?: SplitOps
  } = {},
): {
  T: number
  nSteps: number
  dt: number
  err: number
  errLieTrotter: number
  lowerThanLieTrotter: boolean
  refineRatio: number
  orderHint: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_STRANG
  familyId: typeof METHOD_SPLITTING
} {
  const T = opts.T ?? 1
  const nSteps = opts.nSteps ?? 16
  const u0: Vec2 = opts.u0 ?? [1, 0.5]
  const ops = opts.ops ?? DEFAULT_NONCOMMUTING

  const st = integrateStrang(u0, T, nSteps, ops)
  const lt = integrateLieTrotter(u0, T, nSteps, ops)
  // order probe: double steps → Strang error should drop ~4× (order 2 loosely)
  const st2 = integrateStrang(u0, T, nSteps * 2, ops)
  const refineRatio =
    st.err > 1e-16 ? st.err / Math.max(st2.err, 1e-30) : Infinity
  // order ≈ log2(e_h / e_{h/2}); expect ~2 for Strang
  const orderHint =
    st.err > 1e-16 && st2.err > 1e-30
      ? Math.log(st.err / st2.err) / Math.log(2)
      : 2

  const lowerThanLieTrotter = st.err < lt.err * 0.95 || st.err < 1e-12
  const finite = st.finite && lt.finite && st2.finite
  // teaching: Strang beats Lie–Trotter; refine improves; order loosely > 1.3
  const ok =
    finite &&
    lowerThanLieTrotter &&
    st.err < 0.2 &&
    refineRatio > 2.5 &&
    orderHint > 1.3

  return {
    T,
    nSteps,
    dt: st.dt,
    err: st.err,
    errLieTrotter: lt.err,
    lowerThanLieTrotter,
    refineRatio,
    orderHint,
    finite,
    ok,
    methodId: METHOD_ALGO_STRANG,
    familyId: METHOD_SPLITTING,
  }
}
