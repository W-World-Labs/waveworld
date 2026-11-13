/**
 * Poynting vector magnitude · pure teaching stubs.
 * Orthogonal EM wave: S = E · H  (or S = E · B / μ₀).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Poynting energy flux. */
export const METHOD_POYNTING = 'method-poynting'

/** Algo · S = E · H (orthogonal teaching). */
export const METHOD_ALGO_POYNTING_S = 'method-algo-poynting-s'

/** Parent alias. */
export const POYNTING_PARENT = METHOD_POYNTING

export const POYNTING_METHOD_IDS = [METHOD_ALGO_POYNTING_S] as const

/** Vacuum permeability μ₀ (H/m). */
export const MU0 = 4e-7 * Math.PI

/** Default E field (V/m). */
export const DEFAULT_E = 100

/** Default H field (A/m). */
export const DEFAULT_H = 0.265

/**
 * Poynting magnitude for orthogonal E, H (teaching):
 *   S = E · H   (W/m²)
 *
 * Non-finite → NaN. Uses |E|·|H| so result is ≥ 0.
 */
export function poyntingS(E: number, H: number): number {
  if (!Number.isFinite(E) || !Number.isFinite(H)) return NaN
  return Math.abs(E) * Math.abs(H)
}

/**
 * Equivalent form with B instead of H:
 *   S = E · B / μ₀
 *
 * Requires μ₀ > 0; non-finite → NaN.
 */
export function poyntingFromEB(
  E: number,
  B: number,
  mu0: number = MU0,
): number {
  if (
    !Number.isFinite(E) ||
    !Number.isFinite(B) ||
    !Number.isFinite(mu0) ||
    !(mu0 > 0)
  ) {
    return NaN
  }
  return (Math.abs(E) * Math.abs(B)) / mu0
}

/**
 * Poynting sample: S = E·H; linear in E and H; EB form agrees when H=B/μ₀.
 */
export function runPoyntingSample(opts?: {
  E?: number
  H?: number
  mu0?: number
}): {
  E: number
  H: number
  mu0: number
  S: number
  S_doubleE: number
  S_fromEB: number
  B: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_POYNTING_S
  familyId: typeof METHOD_POYNTING
} {
  const E = opts?.E ?? DEFAULT_E
  const H = opts?.H ?? DEFAULT_H
  const mu0 = opts?.mu0 ?? MU0

  const S = poyntingS(E, H)
  const S_doubleE = poyntingS(2 * E, H)
  const B = mu0 * Math.abs(H)
  const S_fromEB = poyntingFromEB(E, B, mu0)

  const finite =
    Number.isFinite(S) &&
    Number.isFinite(S_doubleE) &&
    Number.isFinite(S_fromEB)

  const formulaOk =
    Math.abs(S - Math.abs(E) * Math.abs(H)) <
    1e-12 * Math.max(1e-30, Math.abs(S))
  const linOk =
    Math.abs(S_doubleE - 2 * S) < 1e-12 * Math.max(1e-30, Math.abs(S))
  const ebOk =
    Math.abs(S_fromEB - S) < 1e-10 * Math.max(1e-30, Math.abs(S))
  const positiveOk = S > 0
  const badOk = !Number.isFinite(poyntingS(NaN, H))

  const ok = finite && formulaOk && linOk && ebOk && positiveOk && badOk

  return {
    E,
    H,
    mu0,
    S,
    S_doubleE,
    S_fromEB,
    B,
    finite,
    ok,
    methodId: METHOD_ALGO_POYNTING_S,
    familyId: METHOD_POYNTING,
  }
}
