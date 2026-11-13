/**
 * WKB tunneling · pure teaching stubs.
 * T ≈ exp(−2 κ L) with κ = √(2 m (V−E)) / ℏ; simplified T = exp(−2 k L).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · WKB barrier tunneling. */
export const METHOD_WKB = 'method-wkb-tunneling'

/** Algo · WKB transmission probability. */
export const METHOD_ALGO_WKB_T = 'method-algo-wkb-transmission'

/** Parent alias (aligns with familyId). */
export const WKB_PARENT = METHOD_WKB

export const WKB_METHOD_IDS = [METHOD_ALGO_WKB_T] as const

/** Reduced Planck constant ℏ (J·s). */
export const HBAR = 1.0545718176461565e-34

/** Electron mass m_e (kg). */
export const M_E = 9.1093837015e-31

/** Default barrier width L (m). */
export const DEFAULT_L = 1e-9

/** Default decay constant k or κ (1/m). */
export const DEFAULT_K = 1e9

/** Default (V − E) energy difference (J); toy ~1 eV. */
export const DEFAULT_V_MINUS_E = 1.602176634e-19

/**
 * Simplified WKB transmission:
 *   T = exp(−2 · k · L)
 *
 * k: decay constant (1/m), L: barrier width (m).
 * Requires k≥0, L≥0, finite; else NaN. T ∈ (0, 1].
 */
export function wkbTransmission(k: number, L: number): number {
  if (
    !Number.isFinite(k) ||
    !Number.isFinite(L) ||
    !(k >= 0) ||
    !(L >= 0)
  ) {
    return NaN
  }
  return Math.exp(-2 * k * L)
}

/**
 * Decay constant κ for rectangular barrier (above-threshold forbidden):
 *   κ = √(2 m (V − E)) / ℏ
 *
 * Requires (V−E)>0, m>0, ℏ>0; else NaN.
 */
export function wkbKappa(
  VminusE: number,
  m: number = M_E,
  hbar: number = HBAR,
): number {
  if (
    !Number.isFinite(VminusE) ||
    !Number.isFinite(m) ||
    !Number.isFinite(hbar) ||
    !(VminusE > 0) ||
    !(m > 0) ||
    !(hbar > 0)
  ) {
    return NaN
  }
  return Math.sqrt(2 * m * VminusE) / hbar
}

/**
 * Full WKB T from barrier height/width:
 *   T = exp(−2 κ L), κ = √(2 m (V−E))/ℏ
 */
export function wkbTransmissionFromEnergy(
  VminusE: number,
  L: number,
  m: number = M_E,
  hbar: number = HBAR,
): number {
  const kappa = wkbKappa(VminusE, m, hbar)
  if (!Number.isFinite(kappa)) return NaN
  return wkbTransmission(kappa, L)
}

/**
 * WKB sample: T=exp(−2kL); doubles L ⇒ T² relation; κ from energy.
 */
export function runWkbTSample(opts?: {
  k?: number
  L?: number
  VminusE?: number
}): {
  k: number
  L: number
  VminusE: number
  T: number
  T_doubleL: number
  kappa: number
  T_fromE: number
  T_zeroL: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_WKB_T
  familyId: typeof METHOD_WKB
} {
  const k = opts?.k ?? DEFAULT_K
  const L = opts?.L ?? DEFAULT_L
  const VminusE = opts?.VminusE ?? DEFAULT_V_MINUS_E

  const T = wkbTransmission(k, L)
  const T_doubleL = wkbTransmission(k, 2 * L)
  const kappa = wkbKappa(VminusE)
  const T_fromE = wkbTransmissionFromEnergy(VminusE, L)
  const T_zeroL = wkbTransmission(k, 0)

  const finite =
    Number.isFinite(T) &&
    Number.isFinite(T_doubleL) &&
    Number.isFinite(kappa) &&
    Number.isFinite(T_fromE) &&
    Number.isFinite(T_zeroL)

  const formulaOk =
    Math.abs(T - Math.exp(-2 * k * L)) < 1e-12 * Math.max(1e-30, T)
  // T(2L) = exp(−4 k L) = [exp(−2 k L)]² = T²
  const doubleLOk =
    Math.abs(T_doubleL - T * T) < 1e-10 * Math.max(1e-30, T * T)
  const zeroLOk = Math.abs(T_zeroL - 1) < 1e-15
  const kappaOk =
    Math.abs(kappa - Math.sqrt(2 * M_E * VminusE) / HBAR) <
    1e-10 * Math.max(1, kappa)
  const fromEOk =
    Math.abs(T_fromE - Math.exp(-2 * kappa * L)) <
    1e-10 * Math.max(1e-30, T_fromE)
  const rangeOk = T > 0 && T <= 1

  const ok =
    finite &&
    formulaOk &&
    doubleLOk &&
    zeroLOk &&
    kappaOk &&
    fromEOk &&
    rangeOk

  return {
    k,
    L,
    VminusE,
    T,
    T_doubleL,
    kappa,
    T_fromE,
    T_zeroL,
    finite,
    ok,
    methodId: METHOD_ALGO_WKB_T,
    familyId: METHOD_WKB,
  }
}
