/**
 * Arrhenius rate law · pure teaching stubs.
 * k = A · exp(−Ea / (R · T)), R = 8.314 J/(mol·K).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Arrhenius kinetics. */
export const METHOD_ARRHENIUS = 'method-arrhenius'

/** Algo · rate constant k = A exp(−Ea/(R T)). */
export const METHOD_ALGO_ARRHENIUS_K = 'method-algo-arrhenius-k'

/** Parent alias (aligns with familyId). */
export const ARRHENIUS_PARENT = METHOD_ARRHENIUS

export const ARRHENIUS_METHOD_IDS = [METHOD_ALGO_ARRHENIUS_K] as const

/** Gas constant R (J/(mol·K)). */
export const R_GAS = 8.314

/** Default pre-exponential A (1/s teaching). */
export const DEFAULT_A = 1e13

/** Default activation energy Ea (J/mol); ~50 kJ/mol. */
export const DEFAULT_EA = 5e4

/** Default temperature T (K). */
export const DEFAULT_T = 300

/**
 * Arrhenius rate constant:
 *   k = A · exp(−Ea / (R · T))
 *
 * A: pre-exponential factor (1/s), Ea: activation energy (J/mol),
 * T: absolute temperature (K), R: gas constant (default 8.314).
 * Requires T>0, R>0, finite inputs; else NaN.
 */
export function arrheniusK(
  A: number,
  Ea: number,
  T: number,
  R: number = R_GAS,
): number {
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(Ea) ||
    !Number.isFinite(T) ||
    !Number.isFinite(R) ||
    !(T > 0) ||
    !(R > 0)
  ) {
    return NaN
  }
  return A * Math.exp(-Ea / (R * T))
}

/**
 * Arrhenius sample: A=1e13, Ea=50 kJ/mol, T=300 K;
 * T↑ ⇒ k↑; Ea↑ ⇒ k↓; T≤0 illegal.
 */
export function runArrheniusKSample(opts?: {
  A?: number
  Ea?: number
  T?: number
  R?: number
}): {
  A: number
  Ea: number
  T: number
  R: number
  k: number
  k_hotter: number
  k_higherEa: number
  k_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ARRHENIUS_K
  familyId: typeof METHOD_ARRHENIUS
} {
  const A = opts?.A ?? DEFAULT_A
  const Ea = opts?.Ea ?? DEFAULT_EA
  const T = opts?.T ?? DEFAULT_T
  const R = opts?.R ?? R_GAS

  const k = arrheniusK(A, Ea, T, R)
  const k_hotter = arrheniusK(A, Ea, T + 50, R)
  const k_higherEa = arrheniusK(A, Ea * 1.2, T, R)
  const k_badT = arrheniusK(A, Ea, 0, R)

  const finite =
    Number.isFinite(k) &&
    Number.isFinite(k_hotter) &&
    Number.isFinite(k_higherEa)

  const expected = A * Math.exp(-Ea / (R * T))
  const formulaOk =
    Math.abs(k - expected) < 1e-12 * Math.max(1e-30, Math.abs(k))
  const hotterOk = k_hotter > k
  const barrierOk = k_higherEa < k
  const positiveOk = k > 0
  const badOk = !Number.isFinite(k_badT)

  const ok = finite && formulaOk && hotterOk && barrierOk && positiveOk && badOk

  return {
    A,
    Ea,
    T,
    R,
    k,
    k_hotter,
    k_higherEa,
    k_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_ARRHENIUS_K,
    familyId: METHOD_ARRHENIUS,
  }
}
