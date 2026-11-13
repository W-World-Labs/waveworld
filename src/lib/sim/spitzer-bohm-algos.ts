/**
 * Spitzer resistivity + Bohm diffusion · pure teaching stubs.
 * η = C · lnΛ / T^{3/2};  D_B = T / (16 B)  (teaching units).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Spitzer resistivity. */
export const METHOD_SPITZER = 'method-spitzer-resistivity'

/** Algo · η ~ lnΛ / T^{3/2}. */
export const METHOD_ALGO_SPITZER_ETA = 'method-algo-spitzer-eta'

/** Family · Bohm diffusion. */
export const METHOD_BOHM = 'method-bohm-diffusion'

/** Algo · D_B = T/(16 B). */
export const METHOD_ALGO_BOHM_D = 'method-algo-bohm-d'

/** Parent aliases. */
export const SPITZER_PARENT = METHOD_SPITZER
export const BOHM_PARENT = METHOD_BOHM

export const SPITZER_METHOD_IDS = [METHOD_ALGO_SPITZER_ETA] as const
export const BOHM_METHOD_IDS = [METHOD_ALGO_BOHM_D] as const

export const SPITZER_BOHM_METHOD_IDS = [
  METHOD_ALGO_SPITZER_ETA,
  METHOD_ALGO_BOHM_D,
] as const

/** Default Coulomb logarithm lnΛ. */
export const DEFAULT_LN_LAMBDA = 15

/** Default temperature T (teaching units, e.g. eV). */
export const DEFAULT_T = 100

/** Default prefactor C (includes Z etc.; teaching). */
export const DEFAULT_C = 1

/** Default B field (T or teaching units). */
export const DEFAULT_B = 1

/**
 * Spitzer-like resistivity (teaching units):
 *   η = C · lnΛ / T^{3/2}
 *
 * Full plasma form ~ Z lnΛ / T^{3/2}; C absorbs Z and constants.
 * Requires T>0, lnΛ finite, C finite; else NaN.
 */
export function spitzerEta(
  T: number,
  lnLambda: number,
  C: number = DEFAULT_C,
): number {
  if (
    !Number.isFinite(T) ||
    !Number.isFinite(lnLambda) ||
    !Number.isFinite(C) ||
    !(T > 0)
  ) {
    return NaN
  }
  return (C * lnLambda) / T ** 1.5
}

/**
 * Bohm diffusion coefficient (teaching units):
 *   D_B = T / (16 · B)
 *
 * Full form D_B = (1/16) kT/(e B); here T/(16 B) in convenient units.
 * Requires T finite, B>0; else NaN.
 */
export function bohmDiffusion(T: number, B: number): number {
  if (!Number.isFinite(T) || !Number.isFinite(B) || !(B > 0)) {
    return NaN
  }
  return T / (16 * B)
}

/**
 * Spitzer sample: η = C lnΛ / T^{1.5}; hotter ⇒ lower η; T≤0 illegal.
 */
export function runSpitzerEtaSample(opts?: {
  T?: number
  lnLambda?: number
  C?: number
}): {
  T: number
  lnLambda: number
  C: number
  eta: number
  eta_doubleT: number
  eta_doubleLn: number
  eta_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SPITZER_ETA
  familyId: typeof METHOD_SPITZER
} {
  const T = opts?.T ?? DEFAULT_T
  const lnLambda = opts?.lnLambda ?? DEFAULT_LN_LAMBDA
  const C = opts?.C ?? DEFAULT_C

  const eta = spitzerEta(T, lnLambda, C)
  const eta_doubleT = spitzerEta(2 * T, lnLambda, C)
  const eta_doubleLn = spitzerEta(T, 2 * lnLambda, C)
  const eta_badT = spitzerEta(0, lnLambda, C)

  const finite =
    Number.isFinite(eta) &&
    Number.isFinite(eta_doubleT) &&
    Number.isFinite(eta_doubleLn)

  const expected = (C * lnLambda) / T ** 1.5
  const formulaOk =
    Math.abs(eta - expected) < 1e-12 * Math.max(1e-30, Math.abs(eta))
  const hotOk = Math.abs(eta_doubleT) < Math.abs(eta)
  const scaleTOk =
    Math.abs(eta_doubleT - eta / (2 ** 1.5)) <
    1e-12 * Math.max(1e-30, Math.abs(eta))
  const linLnOk =
    Math.abs(eta_doubleLn - 2 * eta) < 1e-12 * Math.max(1e-30, Math.abs(eta))
  const badOk = !Number.isFinite(eta_badT)
  const positiveOk = lnLambda > 0 && C > 0 ? eta > 0 : true

  const ok =
    finite && formulaOk && hotOk && scaleTOk && linLnOk && badOk && positiveOk

  return {
    T,
    lnLambda,
    C,
    eta,
    eta_doubleT,
    eta_doubleLn,
    eta_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_SPITZER_ETA,
    familyId: METHOD_SPITZER,
  }
}

/**
 * Bohm sample: D = T/(16 B); ∝ T, 1/B; B≤0 illegal.
 */
export function runBohmDSample(opts?: {
  T?: number
  B?: number
}): {
  T: number
  B: number
  D: number
  D_doubleT: number
  D_doubleB: number
  D_badB: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BOHM_D
  familyId: typeof METHOD_BOHM
} {
  const T = opts?.T ?? DEFAULT_T
  const B = opts?.B ?? DEFAULT_B

  const D = bohmDiffusion(T, B)
  const D_doubleT = bohmDiffusion(2 * T, B)
  const D_doubleB = bohmDiffusion(T, 2 * B)
  const D_badB = bohmDiffusion(T, 0)

  const finite =
    Number.isFinite(D) &&
    Number.isFinite(D_doubleT) &&
    Number.isFinite(D_doubleB)

  const expected = T / (16 * B)
  const formulaOk =
    Math.abs(D - expected) < 1e-12 * Math.max(1e-30, Math.abs(D))
  const linTOk =
    Math.abs(D_doubleT - 2 * D) < 1e-12 * Math.max(1e-30, Math.abs(D))
  const halfBOk =
    Math.abs(D_doubleB - D / 2) < 1e-12 * Math.max(1e-30, Math.abs(D))
  const badOk = !Number.isFinite(D_badB)
  const positiveOk = T > 0 ? D > 0 : true

  const ok = finite && formulaOk && linTOk && halfBOk && badOk && positiveOk

  return {
    T,
    B,
    D,
    D_doubleT,
    D_doubleB,
    D_badB,
    finite,
    ok,
    methodId: METHOD_ALGO_BOHM_D,
    familyId: METHOD_BOHM,
  }
}
