/**
 * Shot noise · pure teaching stubs.
 * I_rms = √(2 q I Δf), q = 1.602e-19 C.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · shot noise. */
export const METHOD_SHOT = 'method-shot-noise'

/** Algo · shot-noise RMS current. */
export const METHOD_ALGO_SHOT_IRMS = 'method-algo-shot-irms'

/** Parent alias (aligns with familyId). */
export const SHOT_PARENT = METHOD_SHOT

export const SHOT_METHOD_IDS = [METHOD_ALGO_SHOT_IRMS] as const

/** Elementary charge q (C). */
export const Q_E = 1.602e-19

/** Default DC current I (A). */
export const DEFAULT_I = 1e-3

/** Default bandwidth Δf (Hz). */
export const DEFAULT_DELTA_F = 1e6

/**
 * Shot-noise RMS current (A):
 *   I_rms = √(2 · q · I · Δf)
 *
 * I: mean current (A), deltaF: bandwidth (Hz), q: elementary charge.
 * Requires I≥0, deltaF≥0, q>0, finite; else NaN.
 */
export function shotIrms(
  I: number,
  deltaF: number,
  q: number = Q_E,
): number {
  if (
    !Number.isFinite(I) ||
    !Number.isFinite(deltaF) ||
    !Number.isFinite(q) ||
    !(I >= 0) ||
    !(deltaF >= 0) ||
    !(q > 0)
  ) {
    return NaN
  }
  return Math.sqrt(2 * q * I * deltaF)
}

/**
 * Shot sample: I_rms ∝ √I, √Δf; I=0 ⇒ 0; illegal negative.
 */
export function runShotIrmsSample(opts?: {
  I?: number
  deltaF?: number
  q?: number
}): {
  I: number
  deltaF: number
  q: number
  Irms: number
  Irms_doubleI: number
  Irms_doubleF: number
  Irms_zeroI: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SHOT_IRMS
  familyId: typeof METHOD_SHOT
} {
  const I = opts?.I ?? DEFAULT_I
  const deltaF = opts?.deltaF ?? DEFAULT_DELTA_F
  const q = opts?.q ?? Q_E

  const Irms = shotIrms(I, deltaF, q)
  const Irms_doubleI = shotIrms(2 * I, deltaF, q)
  const Irms_doubleF = shotIrms(I, 2 * deltaF, q)
  const Irms_zeroI = shotIrms(0, deltaF, q)

  const finite =
    Number.isFinite(Irms) &&
    Number.isFinite(Irms_doubleI) &&
    Number.isFinite(Irms_doubleF) &&
    Number.isFinite(Irms_zeroI)

  const expected = Math.sqrt(2 * q * I * deltaF)
  const formulaOk =
    Math.abs(Irms - expected) < 1e-12 * Math.max(1e-30, Irms)
  const sqrtIOk =
    Math.abs(Irms_doubleI - Irms * Math.SQRT2) <
    1e-12 * Math.max(1e-30, Irms)
  const sqrtFOk =
    Math.abs(Irms_doubleF - Irms * Math.SQRT2) <
    1e-12 * Math.max(1e-30, Irms)
  const zeroOk = Math.abs(Irms_zeroI) < 1e-30
  const positiveOk = Irms > 0

  const ok =
    finite && formulaOk && sqrtIOk && sqrtFOk && zeroOk && positiveOk

  return {
    I,
    deltaF,
    q,
    Irms,
    Irms_doubleI,
    Irms_doubleF,
    Irms_zeroI,
    finite,
    ok,
    methodId: METHOD_ALGO_SHOT_IRMS,
    familyId: METHOD_SHOT,
  }
}
