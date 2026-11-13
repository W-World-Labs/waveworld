/**
 * Johnson–Nyquist thermal noise · pure teaching stubs.
 * V_rms = √(4 k_B T R Δf), k_B = 1.380649e-23 J/K.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Johnson–Nyquist noise. */
export const METHOD_JOHNSON = 'method-johnson-nyquist'

/** Algo · thermal noise voltage V_rms. */
export const METHOD_ALGO_JOHNSON_VRMS = 'method-algo-johnson-vrms'

/** Parent alias (aligns with familyId). */
export const JOHNSON_PARENT = METHOD_JOHNSON

export const JOHNSON_METHOD_IDS = [METHOD_ALGO_JOHNSON_VRMS] as const

/** Boltzmann constant k_B (J/K). */
export const KB = 1.380649e-23

/** Default temperature T (K). */
export const DEFAULT_T = 300

/** Default resistance R (Ω). */
export const DEFAULT_R = 1000

/** Default noise bandwidth Δf (Hz). */
export const DEFAULT_DELTA_F = 1e6

/**
 * Johnson–Nyquist RMS noise voltage (V):
 *   V_rms = √(4 · k_B · T · R · Δf)
 *
 * T: temperature (K), R: resistance (Ω), deltaF: bandwidth (Hz),
 * kB: Boltzmann constant (default 1.380649e-23).
 * Requires T≥0, R≥0, deltaF≥0, kB>0, finite; else NaN.
 */
export function johnsonVrms(
  T: number,
  R: number,
  deltaF: number,
  kB: number = KB,
): number {
  if (
    !Number.isFinite(T) ||
    !Number.isFinite(R) ||
    !Number.isFinite(deltaF) ||
    !Number.isFinite(kB) ||
    !(T >= 0) ||
    !(R >= 0) ||
    !(deltaF >= 0) ||
    !(kB > 0)
  ) {
    return NaN
  }
  return Math.sqrt(4 * kB * T * R * deltaF)
}

/**
 * Johnson sample: T=300 K, R=1 kΩ, Δf=1 MHz;
 * V_rms ∝ √T, √R, √Δf; zero at T=0 or R=0.
 */
export function runJohnsonVrmsSample(opts?: {
  T?: number
  R?: number
  deltaF?: number
  kB?: number
}): {
  T: number
  R: number
  deltaF: number
  kB: number
  Vrms: number
  Vrms_doubleT: number
  Vrms_zeroT: number
  Vrms_doubleR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_JOHNSON_VRMS
  familyId: typeof METHOD_JOHNSON
} {
  const T = opts?.T ?? DEFAULT_T
  const R = opts?.R ?? DEFAULT_R
  const deltaF = opts?.deltaF ?? DEFAULT_DELTA_F
  const kB = opts?.kB ?? KB

  const Vrms = johnsonVrms(T, R, deltaF, kB)
  const Vrms_doubleT = johnsonVrms(2 * T, R, deltaF, kB)
  const Vrms_zeroT = johnsonVrms(0, R, deltaF, kB)
  const Vrms_doubleR = johnsonVrms(T, 2 * R, deltaF, kB)

  const finite =
    Number.isFinite(Vrms) &&
    Number.isFinite(Vrms_doubleT) &&
    Number.isFinite(Vrms_zeroT) &&
    Number.isFinite(Vrms_doubleR)

  const expected = Math.sqrt(4 * kB * T * R * deltaF)
  const formulaOk =
    Math.abs(Vrms - expected) < 1e-12 * Math.max(1e-30, Vrms)
  const sqrtTOk =
    Math.abs(Vrms_doubleT - Vrms * Math.SQRT2) <
    1e-12 * Math.max(1e-30, Vrms)
  const sqrtROk =
    Math.abs(Vrms_doubleR - Vrms * Math.SQRT2) <
    1e-12 * Math.max(1e-30, Vrms)
  const zeroOk = Math.abs(Vrms_zeroT) < 1e-30
  const positiveOk = Vrms > 0

  const ok =
    finite && formulaOk && sqrtTOk && sqrtROk && zeroOk && positiveOk

  return {
    T,
    R,
    deltaF,
    kB,
    Vrms,
    Vrms_doubleT,
    Vrms_zeroT,
    Vrms_doubleR,
    finite,
    ok,
    methodId: METHOD_ALGO_JOHNSON_VRMS,
    familyId: METHOD_JOHNSON,
  }
}
