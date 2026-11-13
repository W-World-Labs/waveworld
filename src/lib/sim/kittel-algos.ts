/**
 * Kittel ferromagnetic resonance · pure teaching stubs.
 * ω = γ √(B (B + μ₀ Ms))  thin-film / demag teaching form
 * f = (γ / 2π) B         simple FMR when demag neglected
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Kittel FMR. */
export const METHOD_KITTEL = 'method-kittel'

/** Algo · Kittel frequency / angular frequency. */
export const METHOD_ALGO_KITTEL_F = 'method-algo-kittel-f'

/** Parent alias. */
export const KITTEL_PARENT = METHOD_KITTEL

export const KITTEL_METHOD_IDS = [METHOD_ALGO_KITTEL_F] as const

/** Vacuum permeability μ₀ (H/m). */
export const MU0 = 1.25663706212e-6

/**
 * Electron gyromagnetic ratio γ/(2π) ≈ 28 GHz/T teaching value
 * (γ ≈ 1.76085963023e11 rad/(s·T)).
 */
export const GAMMA = 1.76085963023e11

/** Default external field B (T). */
export const DEFAULT_B = 0.1

/** Default saturation magnetization Ms (A/m) — permalloy-class toy. */
export const DEFAULT_MS = 8e5

/**
 * Thin-film Kittel angular frequency (rad/s):
 *   ω = γ · √(B · (B + μ₀ Ms))
 *
 * B: applied field (T), Ms: saturation magnetization (A/m),
 * gamma: gyromagnetic ratio (rad/(s·T)), mu0: μ₀.
 * Requires B≥0, Ms≥0, gamma>0, mu0>0, finite; else NaN.
 */
export function kittelOmega(
  B: number,
  Ms: number,
  gamma: number = GAMMA,
  mu0: number = MU0,
): number {
  if (
    !Number.isFinite(B) ||
    !Number.isFinite(Ms) ||
    !Number.isFinite(gamma) ||
    !Number.isFinite(mu0) ||
    !(B >= 0) ||
    !(Ms >= 0) ||
    !(gamma > 0) ||
    !(mu0 > 0)
  ) {
    return NaN
  }
  return gamma * Math.sqrt(B * (B + mu0 * Ms))
}

/**
 * Simple ferromagnetic resonance frequency (Hz), demag neglected:
 *   f = (γ / 2π) · B
 */
export function kittelFreqSimple(
  B: number,
  gamma: number = GAMMA,
): number {
  if (!Number.isFinite(B) || !Number.isFinite(gamma) || !(B >= 0) || !(gamma > 0)) {
    return NaN
  }
  return (gamma / (2 * Math.PI)) * B
}

/**
 * Full Kittel frequency f = ω / 2π (Hz).
 */
export function kittelFreq(
  B: number,
  Ms: number,
  gamma: number = GAMMA,
  mu0: number = MU0,
): number {
  const omega = kittelOmega(B, Ms, gamma, mu0)
  if (!Number.isFinite(omega)) return NaN
  return omega / (2 * Math.PI)
}

/**
 * Kittel sample: ω = γ√(B(B+μ₀Ms)); f_simple ∝ B; B=0 ⇒ 0.
 */
export function runKittelFSample(opts?: {
  B?: number
  Ms?: number
}): {
  B: number
  Ms: number
  omega: number
  f: number
  f_simple: number
  omega_doubleB_approx: number
  omega_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_KITTEL_F
  familyId: typeof METHOD_KITTEL
} {
  const B = opts?.B ?? DEFAULT_B
  const Ms = opts?.Ms ?? DEFAULT_MS

  const omega = kittelOmega(B, Ms)
  const f = kittelFreq(B, Ms)
  const f_simple = kittelFreqSimple(B)
  // For large B ≫ μ₀ Ms demag, ω ~ γ B so 2B ≈ 2ω; here we just recompute
  const omega_doubleB_approx = kittelOmega(2 * B, Ms)
  const omega_zero = kittelOmega(0, Ms)

  const finite =
    Number.isFinite(omega) &&
    Number.isFinite(f) &&
    Number.isFinite(f_simple) &&
    Number.isFinite(omega_doubleB_approx) &&
    Number.isFinite(omega_zero)

  const expected = GAMMA * Math.sqrt(B * (B + MU0 * Ms))
  const formulaOk =
    Math.abs(omega - expected) < 1e-10 * Math.max(1, Math.abs(omega))
  const fOk =
    Math.abs(f - omega / (2 * Math.PI)) < 1e-10 * Math.max(1, Math.abs(f))
  const simpleExpected = (GAMMA / (2 * Math.PI)) * B
  const simpleOk =
    Math.abs(f_simple - simpleExpected) <
    1e-10 * Math.max(1, Math.abs(f_simple))
  // ω(2B) > ω(B) for B>0
  const monoOk = omega_doubleB_approx > omega
  const zeroOk = Math.abs(omega_zero) < 1e-30
  const positiveOk = omega > 0 && f > 0

  const ok =
    finite && formulaOk && fOk && simpleOk && monoOk && zeroOk && positiveOk

  return {
    B,
    Ms,
    omega,
    f,
    f_simple,
    omega_doubleB_approx,
    omega_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_KITTEL_F,
    familyId: METHOD_KITTEL,
  }
}
