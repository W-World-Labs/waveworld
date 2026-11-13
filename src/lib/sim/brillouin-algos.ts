/**
 * Brillouin scattering · pure teaching stubs.
 * Frequency shift Δν ≈ (2 n v_sound / λ) · sin(θ/2).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Brillouin scattering. */
export const METHOD_BRILLOUIN = 'method-brillouin'

/** Algo · Brillouin frequency shift (Hz teaching). */
export const METHOD_ALGO_BRILLOUIN_SHIFT = 'method-algo-brillouin-shift'

/** Parent alias (aligns with familyId). */
export const BRILLOUIN_PARENT = METHOD_BRILLOUIN

export const BRILLOUIN_METHOD_IDS = [METHOD_ALGO_BRILLOUIN_SHIFT] as const

/** Default acoustic speed (m/s); water-class toy. */
export const DEFAULT_V_SOUND = 1480

/** Default refractive index (dimensionless). */
export const DEFAULT_N = 1.33

/** Default optical wavelength (m); 532 nm. */
export const DEFAULT_LAMBDA = 532e-9

/** Default scattering angle (rad); backscattering π. */
export const DEFAULT_THETA = Math.PI

/**
 * Brillouin frequency shift (Hz teaching):
 *   Δν ≈ (2 n v_sound / λ) · sin(θ/2)
 *
 * v_sound: acoustic speed (m/s), n: refractive index,
 * lambda: optical wavelength (m), theta: scattering angle (rad).
 * Requires lambda>0, finite inputs; else NaN.
 */
export function brillouinShiftHz(
  v_sound: number,
  n: number,
  lambda: number,
  theta: number,
): number {
  if (
    !Number.isFinite(v_sound) ||
    !Number.isFinite(n) ||
    !Number.isFinite(lambda) ||
    !Number.isFinite(theta) ||
    !(lambda > 0)
  ) {
    return NaN
  }
  return ((2 * n * v_sound) / lambda) * Math.sin(theta / 2)
}

/**
 * Brillouin sample: water-class n=1.33, v=1480 m/s, λ=532 nm, θ=π;
 * backscattering maximizes sin(θ/2); scales with n, v_sound, 1/λ.
 */
export function runBrillouinShiftSample(opts?: {
  v_sound?: number
  n?: number
  lambda?: number
  theta?: number
}): {
  v_sound: number
  n: number
  lambda: number
  theta: number
  dNu: number
  dNu_halfN: number
  dNu_forward: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BRILLOUIN_SHIFT
  familyId: typeof METHOD_BRILLOUIN
} {
  const v_sound = opts?.v_sound ?? DEFAULT_V_SOUND
  const n = opts?.n ?? DEFAULT_N
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const theta = opts?.theta ?? DEFAULT_THETA

  const dNu = brillouinShiftHz(v_sound, n, lambda, theta)
  const dNu_halfN = brillouinShiftHz(v_sound, n / 2, lambda, theta)
  const dNu_forward = brillouinShiftHz(v_sound, n, lambda, 0)

  const finite =
    Number.isFinite(dNu) &&
    Number.isFinite(dNu_halfN) &&
    Number.isFinite(dNu_forward)

  const expected =
    ((2 * n * v_sound) / lambda) * Math.sin(theta / 2)
  const formulaOk =
    Math.abs(dNu - expected) < 1e-12 * Math.max(1, Math.abs(dNu))
  const halfNOk =
    Math.abs(dNu_halfN - dNu / 2) < 1e-12 * Math.max(1, Math.abs(dNu))
  const forwardOk = Math.abs(dNu_forward) < 1e-30
  const positiveOk = dNu > 0
  const illegal = !Number.isFinite(brillouinShiftHz(v_sound, n, 0, theta))

  const ok = finite && formulaOk && halfNOk && forwardOk && positiveOk && illegal

  return {
    v_sound,
    n,
    lambda,
    theta,
    dNu,
    dNu_halfN,
    dNu_forward,
    finite,
    ok,
    methodId: METHOD_ALGO_BRILLOUIN_SHIFT,
    familyId: METHOD_BRILLOUIN,
  }
}
