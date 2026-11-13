/**
 * Stefan–Boltzmann law · pure teaching toy.
 * Radiant exitance j = σ T⁴; optional photon-energy scale hν.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Stefan–Boltzmann radiation law. */
export const METHOD_STEFAN = 'method-stefan-boltzmann'

/** Algo · j = σ T⁴ (and related photon scale helpers). */
export const METHOD_ALGO_STEFAN = 'method-algo-stefan-law'

/** Parent alias (aligns with familyId). */
export const STEFAN_PARENT = METHOD_STEFAN

export const STEFAN_METHOD_IDS = [METHOD_ALGO_STEFAN] as const

/** Stefan–Boltzmann constant σ (W/m²/K⁴). */
export const SIGMA = 5.670374419e-8

/** Boltzmann constant (J/K). */
export const KB = 1.380649e-23

/** Planck constant (J·s). */
export const H = 6.62607015e-34

/** Speed of light (m/s). */
export const C = 299792458

/**
 * Radiant exitance (W/m²) of a blackbody:
 *   j = σ T⁴
 *
 * T in kelvin; T ≤ 0 or non-finite → NaN.
 */
export function stefanExitance(T: number, sigma: number = SIGMA): number {
  if (!Number.isFinite(T) || !Number.isFinite(sigma) || !(T > 0) || !(sigma > 0)) {
    return NaN
  }
  return sigma * T ** 4
}

/**
 * Net heat flux between two black surfaces (parallel plates / teaching):
 *   q = σ (T_h⁴ − T_c⁴)
 *
 * Requires T_h > 0, T_c > 0; may be negative if T_c > T_h.
 */
export function stefanNetFlux(
  T_h: number,
  T_c: number,
  sigma: number = SIGMA,
): number {
  if (
    !Number.isFinite(T_h) ||
    !Number.isFinite(T_c) ||
    !Number.isFinite(sigma) ||
    !(T_h > 0) ||
    !(T_c > 0) ||
    !(sigma > 0)
  ) {
    return NaN
  }
  return sigma * (T_h ** 4 - T_c ** 4)
}

/**
 * Grey-body exitance with emissivity ε ∈ [0, 1]:
 *   j = ε σ T⁴
 */
export function stefanGreyExitance(
  T: number,
  emissivity: number,
  sigma: number = SIGMA,
): number {
  if (
    !Number.isFinite(emissivity) ||
    !(emissivity >= 0) ||
    !(emissivity <= 1)
  ) {
    return NaN
  }
  const j = stefanExitance(T, sigma)
  if (!Number.isFinite(j)) return NaN
  return emissivity * j
}

/**
 * Optional photon-related helper: energy of a photon (J) at frequency ν (Hz).
 *   E = h ν
 */
export function photonEnergy(nu: number): number {
  if (!Number.isFinite(nu) || !(nu > 0)) return NaN
  return H * nu
}

/**
 * Optional: wavelength (m) from frequency via c = λ ν.
 *   λ = c / ν
 */
export function wavelengthFromFreq(nu: number): number {
  if (!Number.isFinite(nu) || !(nu > 0)) return NaN
  return C / nu
}

/**
 * Optional Wien peak wavelength (m) for blackbody (teaching constant):
 *   λ_max T ≈ 2.897771955e-3 m·K  (Wien displacement)
 */
export const WIEN_B = 2.897771955e-3

export function wienPeakWavelength(T: number): number {
  if (!Number.isFinite(T) || !(T > 0)) return NaN
  return WIEN_B / T
}

/**
 * Stefan sample: j = σ T⁴; T↑ ⇒ j↑; net flux; grey ε; optional photon scales.
 */
export function runStefanSample(opts?: {
  T?: number
  T_c?: number
  emissivity?: number
  nu?: number
}): {
  T: number
  T_c: number
  sigma: number
  j: number
  jHotter: number
  jCold: number
  qNet: number
  jGrey: number
  emissivity: number
  E_photon: number
  lambda: number
  lambdaPeak: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_STEFAN
  familyId: typeof METHOD_STEFAN
} {
  const T = opts?.T ?? 300
  const T_c = opts?.T_c ?? 250
  const emissivity = opts?.emissivity ?? 0.8
  const nu = opts?.nu ?? 5e14 // ~visible

  const j = stefanExitance(T)
  const jHotter = stefanExitance(T * 2)
  const jCold = stefanExitance(T_c)
  const qNet = stefanNetFlux(T, T_c)
  const jGrey = stefanGreyExitance(T, emissivity)
  const E_photon = photonEnergy(nu)
  const lambda = wavelengthFromFreq(nu)
  const lambdaPeak = wienPeakWavelength(T)

  const finite =
    Number.isFinite(j) &&
    Number.isFinite(jHotter) &&
    Number.isFinite(jCold) &&
    Number.isFinite(qNet) &&
    Number.isFinite(jGrey) &&
    Number.isFinite(E_photon) &&
    Number.isFinite(lambda) &&
    Number.isFinite(lambdaPeak)

  const formulaOk = Math.abs(j - SIGMA * T ** 4) < 1e-12 * Math.max(1, j)
  const scaleOk = Math.abs(jHotter / j - 16) < 1e-10 // (2T)⁴ / T⁴ = 16
  const monoOk = j > jCold && qNet > 0
  const greyOk = Math.abs(jGrey - emissivity * j) < 1e-12 * Math.max(1, j)
  const photonOk = E_photon > 0 && lambda > 0 && lambdaPeak > 0
  const illegal = !Number.isFinite(stefanExitance(0)) && !Number.isFinite(stefanExitance(-10))

  const ok = finite && formulaOk && scaleOk && monoOk && greyOk && photonOk && illegal

  return {
    T,
    T_c,
    sigma: SIGMA,
    j,
    jHotter,
    jCold,
    qNet,
    jGrey,
    emissivity,
    E_photon,
    lambda,
    lambdaPeak,
    finite,
    ok,
    methodId: METHOD_ALGO_STEFAN,
    familyId: METHOD_STEFAN,
  }
}
