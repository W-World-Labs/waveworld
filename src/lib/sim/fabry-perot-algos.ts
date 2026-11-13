/**
 * Fabry–Pérot etalon · pure teaching stubs.
 * FSR = c / (2 n L); Airy T = 1 / (1 + F sin²(φ/2)).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Fabry–Pérot interferometer. */
export const METHOD_FP = 'method-fabry-perot'

/** Algo · frequency free spectral range. */
export const METHOD_ALGO_FP_FSR = 'method-algo-fp-fsr'

/** Parent alias (aligns with familyId). */
export const FP_PARENT = METHOD_FP

export const FP_METHOD_IDS = [METHOD_ALGO_FP_FSR] as const

/** Speed of light c (m/s). */
export const C = 299792458

/** Default refractive index n. */
export const DEFAULT_N = 1.5

/** Default cavity length L (m). */
export const DEFAULT_L = 0.01

/** Default coefficient of finesse F (dimensionless). */
export const DEFAULT_FINESSE_F = 10

/**
 * Frequency free spectral range (Hz):
 *   FSR = c / (2 · n · L)
 *
 * n: refractive index, L: optical cavity length (m).
 * Requires n>0, L>0, c>0, finite; else NaN.
 */
export function fabryPerotFSR(
  n: number,
  L: number,
  c: number = C,
): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(L) ||
    !Number.isFinite(c) ||
    !(n > 0) ||
    !(L > 0) ||
    !(c > 0)
  ) {
    return NaN
  }
  return c / (2 * n * L)
}

/**
 * Airy transmission (normalized peak teaching form):
 *   T = 1 / (1 + F · sin²(φ/2))
 *
 * F: coefficient of finesse, φ: round-trip phase (rad).
 * T ∈ (0, 1]; peaks at φ = 2π m.
 */
export function airyTransmission(F: number, phi: number): number {
  if (!Number.isFinite(F) || !Number.isFinite(phi) || !(F >= 0)) {
    return NaN
  }
  const s = Math.sin(phi / 2)
  return 1 / (1 + F * s * s)
}

/**
 * FP sample: FSR = c/(2 n L); ∝ 1/L, 1/n; Airy peak T=1 at φ=0.
 */
export function runFpFsrSample(opts?: {
  n?: number
  L?: number
  c?: number
  F?: number
}): {
  n: number
  L: number
  c: number
  F: number
  fsr: number
  fsr_doubleL: number
  T_peak: number
  T_mid: number
  fsr_badL: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FP_FSR
  familyId: typeof METHOD_FP
} {
  const n = opts?.n ?? DEFAULT_N
  const L = opts?.L ?? DEFAULT_L
  const c = opts?.c ?? C
  const F = opts?.F ?? DEFAULT_FINESSE_F

  const fsr = fabryPerotFSR(n, L, c)
  const fsr_doubleL = fabryPerotFSR(n, 2 * L, c)
  const T_peak = airyTransmission(F, 0)
  const T_mid = airyTransmission(F, Math.PI)
  const fsr_badL = fabryPerotFSR(n, 0, c)

  const finite =
    Number.isFinite(fsr) &&
    Number.isFinite(fsr_doubleL) &&
    Number.isFinite(T_peak) &&
    Number.isFinite(T_mid)

  const expected = c / (2 * n * L)
  const formulaOk =
    Math.abs(fsr - expected) < 1e-12 * Math.max(1, Math.abs(fsr))
  const invLOk =
    Math.abs(fsr_doubleL - fsr / 2) < 1e-12 * Math.max(1, Math.abs(fsr))
  const peakOk = Math.abs(T_peak - 1) < 1e-15
  // at φ=π, sin(φ/2)=1 ⇒ T = 1/(1+F)
  const midOk =
    Math.abs(T_mid - 1 / (1 + F)) < 1e-12 * Math.max(1e-30, T_mid)
  const badOk = !Number.isFinite(fsr_badL)
  const positiveOk = fsr > 0

  const ok =
    finite && formulaOk && invLOk && peakOk && midOk && badOk && positiveOk

  return {
    n,
    L,
    c,
    F,
    fsr,
    fsr_doubleL,
    T_peak,
    T_mid,
    fsr_badL,
    finite,
    ok,
    methodId: METHOD_ALGO_FP_FSR,
    familyId: METHOD_FP,
  }
}
