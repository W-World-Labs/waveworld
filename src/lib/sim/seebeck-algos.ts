/**
 * Seebeck thermoelectric · pure teaching stubs.
 * Voltage V = α · ΔT; figure of merit ZT = α² σ T / κ.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Seebeck thermoelectric generation. */
export const METHOD_SEEBECK = 'method-seebeck'

/** Algo · Seebeck open-circuit voltage V = α · ΔT. */
export const METHOD_ALGO_SEEBECK_V = 'method-algo-seebeck-v'

/** Algo · dimensionless figure of merit ZT = α² σ T / κ. */
export const METHOD_ALGO_ZT = 'method-algo-zt-figure'

/** Parent alias (aligns with familyId). */
export const SEEBECK_PARENT = METHOD_SEEBECK

export const SEEBECK_METHOD_IDS = [
  METHOD_ALGO_SEEBECK_V,
  METHOD_ALGO_ZT,
] as const

/** Typical Bi2Te3-class Seebeck coefficient (V/K) at room temp (toy). */
export const DEFAULT_ALPHA = 200e-6

/** Default ΔT for samples (K). */
export const DEFAULT_DELTA_T = 50

/**
 * Seebeck open-circuit voltage:
 *   V = α · ΔT
 *
 * α: Seebeck coefficient (V/K), ΔT = T_hot − T_cold (K).
 * Sign follows α · ΔT (p-type α>0 ⇒ positive V for ΔT>0).
 */
export function seebeckVoltage(alpha: number, deltaT: number): number {
  if (!Number.isFinite(alpha) || !Number.isFinite(deltaT)) return NaN
  return alpha * deltaT
}

/**
 * Thermoelectric figure of merit (dimensionless):
 *   ZT = (α² · σ · T) / κ
 *
 * α: Seebeck (V/K), σ: electrical conductivity (S/m),
 * T: absolute temperature (K), κ: thermal conductivity (W/(m·K)).
 * Requires T>0, κ>0, finite inputs; else NaN.
 */
export function figureOfMeritZT(
  alpha: number,
  sigma: number,
  T: number,
  kappa: number,
): number {
  if (
    !Number.isFinite(alpha) ||
    !Number.isFinite(sigma) ||
    !Number.isFinite(T) ||
    !Number.isFinite(kappa) ||
    !(T > 0) ||
    !(kappa > 0)
  ) {
    return NaN
  }
  return (alpha * alpha * sigma * T) / kappa
}

/**
 * Power factor PF = α² · σ (W/(m·K²)) — intermediate ZT building block.
 */
export function powerFactor(alpha: number, sigma: number): number {
  if (!Number.isFinite(alpha) || !Number.isFinite(sigma)) return NaN
  return alpha * alpha * sigma
}

/**
 * Sweep V vs ΔT on a uniform grid; returns Float64Array series.
 */
export function seebeckVoltageSweep(
  alpha: number,
  deltaTMax: number,
  n = 11,
): { deltaT: Float64Array; V: Float64Array } {
  const nPts = Math.max(2, Math.floor(n))
  const deltaT = new Float64Array(nPts)
  const V = new Float64Array(nPts)
  for (let i = 0; i < nPts; i++) {
    const dT = (i / (nPts - 1)) * deltaTMax
    deltaT[i] = dT
    V[i] = seebeckVoltage(alpha, dT)
  }
  return { deltaT, V }
}

/**
 * Seebeck voltage sample: V=αΔT; linear in ΔT; zero at ΔT=0.
 */
export function runSeebeckVSample(opts?: {
  alpha?: number
  deltaT?: number
}): {
  alpha: number
  deltaT: number
  V: number
  V_doubleDT: number
  V_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SEEBECK_V
  familyId: typeof METHOD_SEEBECK
} {
  const alpha = opts?.alpha ?? DEFAULT_ALPHA
  const deltaT = opts?.deltaT ?? DEFAULT_DELTA_T

  const V = seebeckVoltage(alpha, deltaT)
  const V_doubleDT = seebeckVoltage(alpha, 2 * deltaT)
  const V_zero = seebeckVoltage(alpha, 0)

  const finite =
    Number.isFinite(V) &&
    Number.isFinite(V_doubleDT) &&
    Number.isFinite(V_zero)

  const formulaOk = Math.abs(V - alpha * deltaT) < 1e-18
  const linOk = Math.abs(V_doubleDT - 2 * V) < 1e-18
  const zeroOk = Math.abs(V_zero) < 1e-30
  const signOk = alpha > 0 && deltaT > 0 ? V > 0 : true

  const ok = finite && formulaOk && linOk && zeroOk && signOk

  return {
    alpha,
    deltaT,
    V,
    V_doubleDT,
    V_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_SEEBECK_V,
    familyId: METHOD_SEEBECK,
  }
}

/**
 * ZT sample: ZT = α²σT/κ; scales with α² and 1/κ; requires T,κ > 0.
 */
export function runZTSample(opts?: {
  alpha?: number
  sigma?: number
  T?: number
  kappa?: number
}): {
  alpha: number
  sigma: number
  T: number
  kappa: number
  ZT: number
  PF: number
  ZT_halfKappa: number
  ZT_badKappa: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ZT
  familyId: typeof METHOD_SEEBECK
} {
  // Bi2Te3-class toy: α~200 µV/K, σ~1e5 S/m, κ~1.5 W/(m·K), T=300 K → ZT~0.8
  const alpha = opts?.alpha ?? 200e-6
  const sigma = opts?.sigma ?? 1e5
  const T = opts?.T ?? 300
  const kappa = opts?.kappa ?? 1.5

  const ZT = figureOfMeritZT(alpha, sigma, T, kappa)
  const PF = powerFactor(alpha, sigma)
  const ZT_halfKappa = figureOfMeritZT(alpha, sigma, T, kappa / 2)
  const ZT_badKappa = figureOfMeritZT(alpha, sigma, T, 0)

  const finite =
    Number.isFinite(ZT) && Number.isFinite(PF) && Number.isFinite(ZT_halfKappa)

  const formulaOk =
    Math.abs(ZT - (alpha * alpha * sigma * T) / kappa) < 1e-12 * Math.max(1, ZT)
  const pfOk = Math.abs(PF - alpha * alpha * sigma) < 1e-18
  const halfKappaOk =
    Number.isFinite(ZT_halfKappa) &&
    Math.abs(ZT_halfKappa - 2 * ZT) < 1e-12 * Math.max(1, ZT)
  const badOk = !Number.isFinite(ZT_badKappa)
  const positiveOk = ZT > 0

  const ok = finite && formulaOk && pfOk && halfKappaOk && badOk && positiveOk

  return {
    alpha,
    sigma,
    T,
    kappa,
    ZT,
    PF,
    ZT_halfKappa,
    ZT_badKappa,
    finite,
    ok,
    methodId: METHOD_ALGO_ZT,
    familyId: METHOD_SEEBECK,
  }
}
