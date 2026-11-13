/**
 * Equipartition theorem + Morse potential · pure teaching stubs.
 * E = ½ f k T;  V = De (1 − exp(−a(r−re)))²
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · equipartition energy. */
export const METHOD_EQUIP = 'method-equipartition'

/** Algo · mean energy E = ½ f k T. */
export const METHOD_ALGO_EQUIP_E = 'method-algo-equipartition-e'

/** Family · Morse interatomic potential. */
export const METHOD_MORSE = 'method-morse-potential'

/** Algo · Morse potential V(r). */
export const METHOD_ALGO_MORSE_V = 'method-algo-morse-v'

/** Parent aliases. */
export const EQUIP_PARENT = METHOD_EQUIP
export const MORSE_PARENT = METHOD_MORSE

export const EQUIP_METHOD_IDS = [METHOD_ALGO_EQUIP_E] as const
export const MORSE_METHOD_IDS = [METHOD_ALGO_MORSE_V] as const

export const EQUIPARTITION_MORSE_METHOD_IDS = [
  METHOD_ALGO_EQUIP_E,
  METHOD_ALGO_MORSE_V,
] as const

/** Boltzmann constant k (J/K). */
export const KB = 1.380649e-23

/** Default degrees of freedom f. */
export const DEFAULT_F = 3

/** Default temperature T (K). */
export const DEFAULT_T = 300

/** Default dissociation energy De (J, teaching). */
export const DEFAULT_DE = 1e-18

/** Default Morse width parameter a (1/m). */
export const DEFAULT_A = 2e10

/** Default equilibrium bond length re (m). */
export const DEFAULT_RE = 1.2e-10

/** Default separation r (m). */
export const DEFAULT_R = 1.3e-10

/**
 * Classical equipartition mean energy (J):
 *   E = ½ · f · k · T
 *
 * f: degrees of freedom, k: Boltzmann constant, T: temperature (K).
 * Requires f≥0, T≥0, k>0, finite; else NaN.
 */
export function equipartitionEnergy(
  f: number,
  T: number,
  k: number = KB,
): number {
  if (
    !Number.isFinite(f) ||
    !Number.isFinite(T) ||
    !Number.isFinite(k) ||
    !(f >= 0) ||
    !(T >= 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return 0.5 * f * k * T
}

/**
 * Morse potential energy (J):
 *   V(r) = De · (1 − exp(−a (r − re)))²
 *
 * De: well depth, a: width (1/m), r: separation (m), re: equilibrium (m).
 * Requires De≥0, finite; else NaN.
 */
export function morsePotential(
  r: number,
  De: number,
  a: number,
  re: number,
): number {
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(De) ||
    !Number.isFinite(a) ||
    !Number.isFinite(re) ||
    !(De >= 0)
  ) {
    return NaN
  }
  const x = 1 - Math.exp(-a * (r - re))
  return De * x * x
}

/**
 * Equipartition sample: E = ½ f k T; ∝ f and T; T=0 ⇒ 0.
 */
export function runEquipESample(opts?: {
  f?: number
  T?: number
}): {
  f: number
  T: number
  k: number
  E: number
  E_doubleF: number
  E_doubleT: number
  E_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_EQUIP_E
  familyId: typeof METHOD_EQUIP
} {
  const f = opts?.f ?? DEFAULT_F
  const T = opts?.T ?? DEFAULT_T

  const E = equipartitionEnergy(f, T)
  const E_doubleF = equipartitionEnergy(2 * f, T)
  const E_doubleT = equipartitionEnergy(f, 2 * T)
  const E_zero = equipartitionEnergy(f, 0)

  const finite =
    Number.isFinite(E) &&
    Number.isFinite(E_doubleF) &&
    Number.isFinite(E_doubleT) &&
    Number.isFinite(E_zero)

  const expected = 0.5 * f * KB * T
  const formulaOk =
    Math.abs(E - expected) < 1e-12 * Math.max(1e-30, Math.abs(E))
  const linFOk =
    Math.abs(E_doubleF - 2 * E) < 1e-12 * Math.max(1e-30, Math.abs(E))
  const linTOk =
    Math.abs(E_doubleT - 2 * E) < 1e-12 * Math.max(1e-30, Math.abs(E))
  const zeroOk = Math.abs(E_zero) < 1e-30
  const positiveOk = E > 0

  const ok = finite && formulaOk && linFOk && linTOk && zeroOk && positiveOk

  return {
    f,
    T,
    k: KB,
    E,
    E_doubleF,
    E_doubleT,
    E_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_EQUIP_E,
    familyId: METHOD_EQUIP,
  }
}

/**
 * Morse sample: V(re)=0; V→De as r→∞; V≥0 for De>0.
 */
export function runMorseVSample(opts?: {
  r?: number
  De?: number
  a?: number
  re?: number
}): {
  r: number
  De: number
  a: number
  re: number
  V: number
  V_eq: number
  V_far: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MORSE_V
  familyId: typeof METHOD_MORSE
} {
  const r = opts?.r ?? DEFAULT_R
  const De = opts?.De ?? DEFAULT_DE
  const a = opts?.a ?? DEFAULT_A
  const re = opts?.re ?? DEFAULT_RE

  const V = morsePotential(r, De, a, re)
  const V_eq = morsePotential(re, De, a, re)
  const V_far = morsePotential(re + 20 / a, De, a, re)

  const finite =
    Number.isFinite(V) && Number.isFinite(V_eq) && Number.isFinite(V_far)

  const x = 1 - Math.exp(-a * (r - re))
  const expected = De * x * x
  const formulaOk =
    Math.abs(V - expected) < 1e-12 * Math.max(1e-30, Math.abs(V), Math.abs(De))
  const eqOk = Math.abs(V_eq) < 1e-18 * Math.max(1, De)
  // far from well: V → De
  const asymOk = Math.abs(V_far - De) / De < 1e-6
  const nonNegOk = V >= 0 && V_far >= 0

  const ok = finite && formulaOk && eqOk && asymOk && nonNegOk

  return {
    r,
    De,
    a,
    re,
    V,
    V_eq,
    V_far,
    finite,
    ok,
    methodId: METHOD_ALGO_MORSE_V,
    familyId: METHOD_MORSE,
  }
}
