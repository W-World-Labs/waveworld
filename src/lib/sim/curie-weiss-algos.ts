/**
 * Curie–Weiss susceptibility · pure teaching stubs.
 * χ = C / (T − Tc) for T > Tc
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Curie–Weiss law. */
export const METHOD_CURIE = 'method-curie-weiss'

/** Algo · paramagnetic susceptibility χ = C/(T−Tc). */
export const METHOD_ALGO_CURIE_CHI = 'method-algo-curie-chi'

/** Parent alias (aligns with familyId). */
export const CURIE_PARENT = METHOD_CURIE

export const CURIE_METHOD_IDS = [METHOD_ALGO_CURIE_CHI] as const

/** Default Curie constant C (K, teaching units for χ). */
export const DEFAULT_C = 1

/** Default temperature T (K). */
export const DEFAULT_T = 400

/** Default Curie temperature Tc (K). */
export const DEFAULT_TC = 300

/**
 * Curie–Weiss magnetic susceptibility (dimensionless teaching form):
 *   χ = C / (T − Tc)   for T > Tc
 *
 * C: Curie constant, T: temperature (K), Tc: Curie temperature (K).
 * Requires T > Tc, C finite; T ≤ Tc or non-finite → NaN.
 */
export function curieChi(C: number, T: number, Tc: number): number {
  if (
    !Number.isFinite(C) ||
    !Number.isFinite(T) ||
    !Number.isFinite(Tc) ||
    !(T > Tc)
  ) {
    return NaN
  }
  return C / (T - Tc)
}

/**
 * Curie–Weiss sample: χ = C/(T−Tc); ∝ C; diverges as T→Tc⁺.
 */
export function runCurieChiSample(opts?: {
  C?: number
  T?: number
  Tc?: number
}): {
  C: number
  T: number
  Tc: number
  chi: number
  chi_doubleC: number
  chi_nearTc: number
  chi_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CURIE_CHI
  familyId: typeof METHOD_CURIE
} {
  const C = opts?.C ?? DEFAULT_C
  const T = opts?.T ?? DEFAULT_T
  const Tc = opts?.Tc ?? DEFAULT_TC

  const chi = curieChi(C, T, Tc)
  const chi_doubleC = curieChi(2 * C, T, Tc)
  // closer to Tc from above → larger χ
  const chi_nearTc = curieChi(C, Tc + (T - Tc) / 2, Tc)
  const chi_bad = curieChi(C, Tc, Tc)

  const finite =
    Number.isFinite(chi) &&
    Number.isFinite(chi_doubleC) &&
    Number.isFinite(chi_nearTc)

  const expected = C / (T - Tc)
  const formulaOk =
    Math.abs(chi - expected) < 1e-12 * Math.max(1, Math.abs(chi))
  const linCOk =
    Math.abs(chi_doubleC - 2 * chi) < 1e-12 * Math.max(1, Math.abs(chi))
  const divergeOk = chi_nearTc > chi
  const badOk = !Number.isFinite(chi_bad)
  const positiveOk = chi > 0

  const ok = finite && formulaOk && linCOk && divergeOk && badOk && positiveOk

  return {
    C,
    T,
    Tc,
    chi,
    chi_doubleC,
    chi_nearTc,
    chi_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_CURIE_CHI,
    familyId: METHOD_CURIE,
  }
}
