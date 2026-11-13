/**
 * Saha ionization equation (simplified) · pure teaching stubs.
 * K_rel = T^{3/2} · exp(−I_eV / (k_eV · T)), k_eV = 8.617e-5 eV/K.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Saha ionization equilibrium. */
export const METHOD_SAHA = 'method-saha-ionization'

/** Algo · simplified Saha relative ionization factor K. */
export const METHOD_ALGO_SAHA_K = 'method-algo-saha-k'

/** Parent alias (aligns with familyId). */
export const SAHA_PARENT = METHOD_SAHA

export const SAHA_METHOD_IDS = [METHOD_ALGO_SAHA_K] as const

/** Boltzmann constant in eV/K. */
export const K_EV = 8.617e-5

/** Default temperature T (K); stellar-atmosphere class toy. */
export const DEFAULT_T = 10000

/** Default ionization energy I (eV); H-like ~13.6 eV. */
export const DEFAULT_I_EV = 13.6

/**
 * Simplified relative Saha factor (teaching, dimensionless scale):
 *   K_rel = T^{3/2} · exp(−I_eV / (k_eV · T))
 *
 * T: temperature (K), I_eV: ionization energy (eV),
 * k_eV: Boltzmann in eV/K (default 8.617e-5).
 * Requires T>0, k_eV>0, finite; else NaN.
 */
export function sahaKRel(
  T: number,
  I_eV: number,
  k_eV: number = K_EV,
): number {
  if (
    !Number.isFinite(T) ||
    !Number.isFinite(I_eV) ||
    !Number.isFinite(k_eV) ||
    !(T > 0) ||
    !(k_eV > 0)
  ) {
    return NaN
  }
  return T ** 1.5 * Math.exp(-I_eV / (k_eV * T))
}

/**
 * Saha sample: K_rel formula; T↑ ⇒ K↑; I↑ ⇒ K↓; T≤0 illegal.
 */
export function runSahaKSample(opts?: {
  T?: number
  I_eV?: number
  k_eV?: number
}): {
  T: number
  I_eV: number
  k_eV: number
  K: number
  K_hotter: number
  K_higherI: number
  K_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SAHA_K
  familyId: typeof METHOD_SAHA
} {
  const T = opts?.T ?? DEFAULT_T
  const I_eV = opts?.I_eV ?? DEFAULT_I_EV
  const k_eV = opts?.k_eV ?? K_EV

  const K = sahaKRel(T, I_eV, k_eV)
  const K_hotter = sahaKRel(T * 1.2, I_eV, k_eV)
  const K_higherI = sahaKRel(T, I_eV * 1.2, k_eV)
  const K_badT = sahaKRel(0, I_eV, k_eV)

  const finite =
    Number.isFinite(K) &&
    Number.isFinite(K_hotter) &&
    Number.isFinite(K_higherI)

  const expected = T ** 1.5 * Math.exp(-I_eV / (k_eV * T))
  const formulaOk =
    Math.abs(K - expected) < 1e-12 * Math.max(1e-30, Math.abs(K))
  const hotterOk = K_hotter > K
  const barrierOk = K_higherI < K
  const positiveOk = K > 0
  const badOk = !Number.isFinite(K_badT)

  const ok = finite && formulaOk && hotterOk && barrierOk && positiveOk && badOk

  return {
    T,
    I_eV,
    k_eV,
    K,
    K_hotter,
    K_higherI,
    K_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_SAHA_K,
    familyId: METHOD_SAHA,
  }
}
