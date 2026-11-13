/**
 * Q-factor + Fabry–Pérot finesse · pure teaching stubs.
 * Q = f0 / Δf; F = π √R / (1−R) for high-R cavity mirrors.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · resonator quality factor. */
export const METHOD_Q = 'method-q-factor'

/** Algo · quality factor Q = f0 / Δf. */
export const METHOD_ALGO_Q = 'method-algo-q-factor'

/** Family · Fabry–Pérot finesse. */
export const METHOD_FINESSE = 'method-finesse'

/** Algo · finesse F = π √R / (1−R). */
export const METHOD_ALGO_FINESSE = 'method-algo-finesse'

/** Parent aliases. */
export const Q_PARENT = METHOD_Q
export const FINESSE_PARENT = METHOD_FINESSE

export const Q_METHOD_IDS = [METHOD_ALGO_Q] as const
export const FINESSE_METHOD_IDS = [METHOD_ALGO_FINESSE] as const

export const Q_FINESSE_METHOD_IDS = [
  METHOD_ALGO_Q,
  METHOD_ALGO_FINESSE,
] as const

/** Default resonance frequency f0 (Hz). */
export const DEFAULT_F0 = 1e9

/** Default full-width at half-maximum Δf (Hz). */
export const DEFAULT_DELTA_F = 1e6

/** Default power reflectivity R (0 < R < 1). */
export const DEFAULT_R = 0.99

/**
 * Quality factor (dimensionless):
 *   Q = f0 / Δf
 *
 * f0: resonance frequency (Hz), Δf: FWHM bandwidth (Hz).
 * Requires f0≥0, Δf>0, finite; else NaN.
 */
export function qualityFactor(f0: number, deltaF: number): number {
  if (
    !Number.isFinite(f0) ||
    !Number.isFinite(deltaF) ||
    !(f0 >= 0) ||
    !(deltaF > 0)
  ) {
    return NaN
  }
  return f0 / deltaF
}

/**
 * Fabry–Pérot finesse (dimensionless, power reflectivity form):
 *   F = π · √R / (1 − R)
 *
 * R: intensity reflectivity of each mirror, 0 < R < 1.
 * Requires finite R strictly in (0, 1); else NaN.
 */
export function finesseFromR(R: number): number {
  if (!Number.isFinite(R) || !(R > 0) || !(R < 1)) {
    return NaN
  }
  return (Math.PI * Math.sqrt(R)) / (1 - R)
}

/**
 * Q-factor sample: Q = f0/Δf; ∝ f0, 1/Δf; Δf≤0 illegal.
 */
export function runQFactorSample(opts?: {
  f0?: number
  deltaF?: number
}): {
  f0: number
  deltaF: number
  Q: number
  Q_doubleF0: number
  Q_doubleDeltaF: number
  Q_badDeltaF: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_Q
  familyId: typeof METHOD_Q
} {
  const f0 = opts?.f0 ?? DEFAULT_F0
  const deltaF = opts?.deltaF ?? DEFAULT_DELTA_F

  const Q = qualityFactor(f0, deltaF)
  const Q_doubleF0 = qualityFactor(2 * f0, deltaF)
  const Q_doubleDeltaF = qualityFactor(f0, 2 * deltaF)
  const Q_badDeltaF = qualityFactor(f0, 0)

  const finite =
    Number.isFinite(Q) &&
    Number.isFinite(Q_doubleF0) &&
    Number.isFinite(Q_doubleDeltaF)

  const formulaOk = Math.abs(Q - f0 / deltaF) < 1e-12 * Math.max(1, Q)
  const linF0Ok = Math.abs(Q_doubleF0 - 2 * Q) < 1e-12 * Math.max(1, Q)
  const invDeltaOk =
    Math.abs(Q_doubleDeltaF - Q / 2) < 1e-12 * Math.max(1, Q)
  const badOk = !Number.isFinite(Q_badDeltaF)
  const positiveOk = Q > 0

  const ok = finite && formulaOk && linF0Ok && invDeltaOk && badOk && positiveOk

  return {
    f0,
    deltaF,
    Q,
    Q_doubleF0,
    Q_doubleDeltaF,
    Q_badDeltaF,
    finite,
    ok,
    methodId: METHOD_ALGO_Q,
    familyId: METHOD_Q,
  }
}

/**
 * Finesse sample: F = π√R/(1−R); high-R large F; R∉(0,1) illegal.
 */
export function runFinesseSample(opts?: { R?: number }): {
  R: number
  F: number
  F_higherR: number
  F_badR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FINESSE
  familyId: typeof METHOD_FINESSE
} {
  const R = opts?.R ?? DEFAULT_R

  const F = finesseFromR(R)
  const F_higherR = finesseFromR(Math.min(0.999, R + (1 - R) * 0.5))
  const F_badR = finesseFromR(1)

  const finite = Number.isFinite(F) && Number.isFinite(F_higherR)

  const expected = (Math.PI * Math.sqrt(R)) / (1 - R)
  const formulaOk = Math.abs(F - expected) < 1e-12 * Math.max(1, F)
  const higherOk = F_higherR > F
  const badOk = !Number.isFinite(F_badR)
  const positiveOk = F > 0

  const ok = finite && formulaOk && higherOk && badOk && positiveOk

  return {
    R,
    F,
    F_higherR,
    F_badR,
    finite,
    ok,
    methodId: METHOD_ALGO_FINESSE,
    familyId: METHOD_FINESSE,
  }
}
