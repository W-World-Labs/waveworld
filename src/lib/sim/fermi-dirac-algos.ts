/**
 * Fermi–Dirac occupation · pure teaching stubs.
 * f(E) = 1 / (exp((E − E_F)/(kT)) + 1), k in eV/K.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Fermi–Dirac statistics. */
export const METHOD_FERMI = 'method-fermi-dirac'

/** Algo · occupation f(E). */
export const METHOD_ALGO_FERMI_F = 'method-algo-fermi-occupation'

/** Parent alias. */
export const FERMI_PARENT = METHOD_FERMI

export const FERMI_METHOD_IDS = [METHOD_ALGO_FERMI_F] as const

/** Boltzmann constant in eV/K. */
export const K_EV = 8.617e-5

/** Default Fermi energy E_F (eV). */
export const DEFAULT_EF = 5.5

/** Default temperature T (K). */
export const DEFAULT_T = 300

/** Default energy E (eV) near E_F. */
export const DEFAULT_E = 5.5

/**
 * Fermi–Dirac occupation probability:
 *   f(E) = 1 / (exp((E − E_F) / (k · T)) + 1)
 *
 * E, Ef in eV; T in K; k in eV/K (default 8.617e-5).
 * Requires T>0, k>0, finite; else NaN.
 * Clamps extreme exp to avoid overflow (f→0 or 1).
 */
export function fermiOccupation(
  E: number,
  Ef: number,
  T: number,
  k: number = K_EV,
): number {
  if (
    !Number.isFinite(E) ||
    !Number.isFinite(Ef) ||
    !Number.isFinite(T) ||
    !Number.isFinite(k) ||
    !(T > 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  const x = (E - Ef) / (k * T)
  // Avoid overflow: exp(x) huge when x ≫ 0 → f ≈ 0; x ≪ 0 → f ≈ 1
  if (x > 50) return 0
  if (x < -50) return 1
  return 1 / (Math.exp(x) + 1)
}

/**
 * Fermi sample: f(E_F)=1/2; E≪E_F → ~1; E≫E_F → ~0; T≤0 → NaN.
 */
export function runFermiOccupationSample(opts?: {
  E?: number
  Ef?: number
  T?: number
  k?: number
}): {
  E: number
  Ef: number
  T: number
  k: number
  f: number
  f_atEf: number
  f_below: number
  f_above: number
  f_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FERMI_F
  familyId: typeof METHOD_FERMI
} {
  const E = opts?.E ?? DEFAULT_E
  const Ef = opts?.Ef ?? DEFAULT_EF
  const T = opts?.T ?? DEFAULT_T
  const k = opts?.k ?? K_EV

  const f = fermiOccupation(E, Ef, T, k)
  const f_atEf = fermiOccupation(Ef, Ef, T, k)
  const f_below = fermiOccupation(Ef - 1, Ef, T, k)
  const f_above = fermiOccupation(Ef + 1, Ef, T, k)
  const f_badT = fermiOccupation(E, Ef, 0, k)

  const finite =
    Number.isFinite(f) &&
    Number.isFinite(f_atEf) &&
    Number.isFinite(f_below) &&
    Number.isFinite(f_above)

  const halfOk = Math.abs(f_atEf - 0.5) < 1e-14
  const monoOk = f_below > f_atEf && f_atEf > f_above
  const boundsOk =
    f_below > 0.9 && f_above < 0.1 && f >= 0 && f <= 1
  const badOk = !Number.isFinite(f_badT)

  // When E = Ef (default), f should be 1/2
  const formulaOk =
    Math.abs(E - Ef) < 1e-15
      ? Math.abs(f - 0.5) < 1e-14
      : Math.abs(
          f - 1 / (Math.exp((E - Ef) / (k * T)) + 1),
        ) < 1e-12 * Math.max(1e-30, Math.abs(f))

  const ok = finite && halfOk && monoOk && boundsOk && badOk && formulaOk

  return {
    E,
    Ef,
    T,
    k,
    f,
    f_atEf,
    f_below,
    f_above,
    f_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_FERMI_F,
    familyId: METHOD_FERMI,
  }
}
