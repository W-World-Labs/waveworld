/**
 * Maxwell–Boltzmann speeds · pure teaching stubs.
 * v_rms = √(3 k T / m)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Maxwell–Boltzmann distribution. */
export const METHOD_MB = 'method-maxwell-boltzmann'

/** Algo · RMS speed v_rms = √(3kT/m). */
export const METHOD_ALGO_MB_RMS = 'method-algo-mb-vrms'

/** Parent alias (aligns with familyId). */
export const MB_PARENT = METHOD_MB

export const MB_METHOD_IDS = [METHOD_ALGO_MB_RMS] as const

/** Boltzmann constant k (J/K). */
export const KB = 1.380649e-23

/** Default temperature T (K). */
export const DEFAULT_T = 300

/** Default molecular mass m (kg); N2 ≈ 28 u. */
export const DEFAULT_M = 4.65e-26

/**
 * RMS molecular speed (m/s):
 *   v_rms = √(3 k T / m)
 *
 * T: temperature (K), m: molecular mass (kg), k: Boltzmann constant.
 * Requires T≥0, m>0, k>0, finite; else NaN.
 */
export function mbVrms(T: number, m: number, k: number = KB): number {
  if (
    !Number.isFinite(T) ||
    !Number.isFinite(m) ||
    !Number.isFinite(k) ||
    !(T >= 0) ||
    !(m > 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return Math.sqrt((3 * k * T) / m)
}

/**
 * MB sample: v_rms = √(3kT/m); ∝ √T; ∝ 1/√m; T=0 ⇒ 0.
 */
export function runMbVrmsSample(opts?: {
  T?: number
  m?: number
}): {
  T: number
  m: number
  k: number
  vRms: number
  vRms_doubleT: number
  vRms_doubleM: number
  vRms_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MB_RMS
  familyId: typeof METHOD_MB
} {
  const T = opts?.T ?? DEFAULT_T
  const m = opts?.m ?? DEFAULT_M

  const vRms = mbVrms(T, m)
  const vRms_doubleT = mbVrms(2 * T, m)
  const vRms_doubleM = mbVrms(T, 2 * m)
  const vRms_zero = mbVrms(0, m)

  const finite =
    Number.isFinite(vRms) &&
    Number.isFinite(vRms_doubleT) &&
    Number.isFinite(vRms_doubleM) &&
    Number.isFinite(vRms_zero)

  const expected = Math.sqrt((3 * KB * T) / m)
  const formulaOk =
    Math.abs(vRms - expected) < 1e-12 * Math.max(1, Math.abs(vRms))
  const sqrtTOk =
    Math.abs(vRms_doubleT / vRms - Math.SQRT2) < 1e-10
  const sqrtMOk =
    Math.abs(vRms_doubleM / vRms - 1 / Math.SQRT2) < 1e-10
  const zeroOk = Math.abs(vRms_zero) < 1e-30
  const positiveOk = vRms > 0

  const ok =
    finite && formulaOk && sqrtTOk && sqrtMOk && zeroOk && positiveOk

  return {
    T,
    m,
    k: KB,
    vRms,
    vRms_doubleT,
    vRms_doubleM,
    vRms_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_MB_RMS,
    familyId: METHOD_MB,
  }
}
