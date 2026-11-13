/**
 * Wien displacement + Planck spectral radiance · pure teaching stubs.
 * λ_max = b/T; B_ν ∝ ν³ / (exp(hν/(kT)) − 1).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Wien displacement law. */
export const METHOD_WIEN = 'method-wien-displacement'

/** Algo · peak wavelength λ_max = b/T. */
export const METHOD_ALGO_WIEN_PEAK = 'method-algo-wien-peak'

/** Family · Planck's law. */
export const METHOD_PLANCK = 'method-planck-law'

/** Algo · spectral radiance B_ν teaching. */
export const METHOD_ALGO_PLANCK_B = 'method-algo-planck-spectral'

/** Parent aliases. */
export const WIEN_PARENT = METHOD_WIEN
export const PLANCK_PARENT = METHOD_PLANCK

export const WIEN_METHOD_IDS = [METHOD_ALGO_WIEN_PEAK] as const
export const PLANCK_METHOD_IDS = [METHOD_ALGO_PLANCK_B] as const

/** Wien displacement constant b (m·K). */
export const WIEN_B = 2.897771955e-3

/** Planck constant h (J·s). */
export const H = 6.62607015e-34

/** Boltzmann constant k_B (J/K). */
export const KB = 1.380649e-23

/** Speed of light c (m/s). */
export const C = 299792458

/** Default blackbody temperature T (K). */
export const DEFAULT_T = 5800

/** Default frequency ν (Hz); near IR–visible teaching. */
export const DEFAULT_NU = 5e14

/**
 * Wien peak wavelength (m):
 *   λ_max = b / T
 *
 * T: absolute temperature (K), b: Wien constant (default 2.897e-3 m·K).
 * Requires T>0, b>0, finite; else NaN.
 */
export function wienLambdaMax(T: number, b: number = WIEN_B): number {
  if (!Number.isFinite(T) || !Number.isFinite(b) || !(T > 0) || !(b > 0)) {
    return NaN
  }
  return b / T
}

/**
 * Planck spectral radiance B_ν (W·sr⁻¹·m⁻²·Hz⁻¹ teaching SI form):
 *   B = (2 h ν³ / c²) / (exp(h ν / (k T)) − 1)
 *
 * Requires ν>0, T>0, finite constants; else NaN.
 */
export function planckBnu(
  nu: number,
  T: number,
  h: number = H,
  kB: number = KB,
  c: number = C,
): number {
  if (
    !Number.isFinite(nu) ||
    !Number.isFinite(T) ||
    !Number.isFinite(h) ||
    !Number.isFinite(kB) ||
    !Number.isFinite(c) ||
    !(nu > 0) ||
    !(T > 0) ||
    !(h > 0) ||
    !(kB > 0) ||
    !(c > 0)
  ) {
    return NaN
  }
  const x = (h * nu) / (kB * T)
  if (!(x > 0) || !Number.isFinite(x)) return NaN
  const denom = Math.exp(x) - 1
  if (!(denom > 0) || !Number.isFinite(denom)) return NaN
  return ((2 * h * nu * nu * nu) / (c * c)) / denom
}

/**
 * Dimensionless teaching proportional form:
 *   x = h ν / (k T),   B_prop = ν³ / (exp(x) − 1)
 *
 * Omits 2h/c² prefactor; useful for shape/comparisons.
 */
export function planckBprop(
  nu: number,
  T: number,
  h: number = H,
  kB: number = KB,
): number {
  if (
    !Number.isFinite(nu) ||
    !Number.isFinite(T) ||
    !Number.isFinite(h) ||
    !Number.isFinite(kB) ||
    !(nu > 0) ||
    !(T > 0) ||
    !(h > 0) ||
    !(kB > 0)
  ) {
    return NaN
  }
  const x = (h * nu) / (kB * T)
  if (!(x > 0) || !Number.isFinite(x)) return NaN
  const denom = Math.exp(x) - 1
  if (!(denom > 0) || !Number.isFinite(denom)) return NaN
  return (nu * nu * nu) / denom
}

/**
 * Wien peak sample: λ_max = b/T; hotter ⇒ shorter peak; T≤0 illegal.
 */
export function runWienPeakSample(opts?: {
  T?: number
  b?: number
}): {
  T: number
  b: number
  lambdaMax: number
  lambdaMax_hotter: number
  lambdaMax_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_WIEN_PEAK
  familyId: typeof METHOD_WIEN
} {
  const T = opts?.T ?? DEFAULT_T
  const b = opts?.b ?? WIEN_B

  const lambdaMax = wienLambdaMax(T, b)
  const lambdaMax_hotter = wienLambdaMax(2 * T, b)
  const lambdaMax_badT = wienLambdaMax(0, b)

  const finite =
    Number.isFinite(lambdaMax) && Number.isFinite(lambdaMax_hotter)

  const formulaOk =
    Math.abs(lambdaMax - b / T) < 1e-18 * Math.max(1e-30, lambdaMax)
  const halfOk =
    Math.abs(lambdaMax_hotter - lambdaMax / 2) <
    1e-18 * Math.max(1e-30, lambdaMax)
  const positiveOk = lambdaMax > 0
  const badOk = !Number.isFinite(lambdaMax_badT)

  const ok = finite && formulaOk && halfOk && positiveOk && badOk

  return {
    T,
    b,
    lambdaMax,
    lambdaMax_hotter,
    lambdaMax_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_WIEN_PEAK,
    familyId: METHOD_WIEN,
  }
}

/**
 * Planck B_ν sample: SI form + proportional stub; B>0; T↑ ⇒ B↑ in Wien tail.
 */
export function runPlanckBSample(opts?: {
  nu?: number
  T?: number
}): {
  nu: number
  T: number
  B: number
  Bprop: number
  B_hotter: number
  B_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PLANCK_B
  familyId: typeof METHOD_PLANCK
} {
  const nu = opts?.nu ?? DEFAULT_NU
  const T = opts?.T ?? DEFAULT_T

  const B = planckBnu(nu, T)
  const Bprop = planckBprop(nu, T)
  const B_hotter = planckBnu(nu, 2 * T)
  const B_badT = planckBnu(nu, 0)

  const finite =
    Number.isFinite(B) &&
    Number.isFinite(Bprop) &&
    Number.isFinite(B_hotter)

  const x = (H * nu) / (KB * T)
  const expected =
    ((2 * H * nu * nu * nu) / (C * C)) / (Math.exp(x) - 1)
  const formulaOk =
    Math.abs(B - expected) < 1e-10 * Math.max(1e-30, Math.abs(B))
  const propOk = Bprop > 0
  const hotterOk = B_hotter > B
  const positiveOk = B > 0
  const badOk = !Number.isFinite(B_badT)
  // Consistency: B = (2h/c²) · Bprop
  const linkOk =
    Math.abs(B - ((2 * H) / (C * C)) * Bprop) <
    1e-10 * Math.max(1e-30, Math.abs(B))

  const ok =
    finite && formulaOk && propOk && hotterOk && positiveOk && badOk && linkOk

  return {
    nu,
    T,
    B,
    Bprop,
    B_hotter,
    B_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_PLANCK_B,
    familyId: METHOD_PLANCK,
  }
}
