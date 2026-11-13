/**
 * Virial theorem / ideal-gas temperature · pure teaching stubs.
 * Ideal gas: 2K = 3 N k T  ⇒  T = 2K / (3 N k); also T = P V / (N k).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · virial / kinetic temperature. */
export const METHOD_VIRIAL = 'method-virial'

/** Algo · temperature from kinetic energy or PV = NkT. */
export const METHOD_ALGO_VIRIAL_T = 'method-algo-virial-t'

/** Parent alias (aligns with familyId). */
export const VIRIAL_PARENT = METHOD_VIRIAL

export const VIRIAL_METHOD_IDS = [METHOD_ALGO_VIRIAL_T] as const

/** Boltzmann constant k (J/K). */
export const K_B = 1.380649e-23

/** Default total kinetic energy K (J). */
export const DEFAULT_K = 6.21e-21

/** Default particle number N. */
export const DEFAULT_N = 1

/** Default pressure P (Pa). */
export const DEFAULT_P = 1e5

/** Default volume V (m³). */
export const DEFAULT_V = 4.14e-26

/**
 * Ideal-gas temperature from kinetic energy (K):
 *   T = 2 K / (3 N k)
 *
 * From virial / equipartition: 2K = 3 N k T for monatomic ideal gas.
 * Requires K finite, N>0, k>0; else NaN.
 */
export function virialTempFromKE(
  K: number,
  N: number,
  k: number = K_B,
): number {
  if (
    !Number.isFinite(K) ||
    !Number.isFinite(N) ||
    !Number.isFinite(k) ||
    !(N > 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return (2 * K) / (3 * N * k)
}

/**
 * Ideal-gas temperature from equation of state (K):
 *   T = P V / (N k)
 *
 * Requires P,V finite, N>0, k>0; else NaN.
 */
export function virialTempFromPV(
  P: number,
  V: number,
  N: number,
  k: number = K_B,
): number {
  if (
    !Number.isFinite(P) ||
    !Number.isFinite(V) ||
    !Number.isFinite(N) ||
    !Number.isFinite(k) ||
    !(N > 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return (P * V) / (N * k)
}

/**
 * Virial temperature sample: T = 2K/(3Nk); also T = PV/(Nk); N≤0 illegal.
 */
export function runVirialTSample(opts?: {
  K?: number
  N?: number
  P?: number
  V?: number
}): {
  K: number
  N: number
  P: number
  V: number
  T_ke: number
  T_pv: number
  T_doubleK: number
  T_badN: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VIRIAL_T
  familyId: typeof METHOD_VIRIAL
} {
  const K = opts?.K ?? DEFAULT_K
  const N = opts?.N ?? DEFAULT_N
  const P = opts?.P ?? DEFAULT_P
  const V = opts?.V ?? DEFAULT_V

  const T_ke = virialTempFromKE(K, N)
  const T_pv = virialTempFromPV(P, V, N)
  const T_doubleK = virialTempFromKE(2 * K, N)
  const T_badN = virialTempFromKE(K, 0)

  const finite =
    Number.isFinite(T_ke) &&
    Number.isFinite(T_pv) &&
    Number.isFinite(T_doubleK)

  const expectedKe = (2 * K) / (3 * N * K_B)
  const formulaOk =
    Math.abs(T_ke - expectedKe) < 1e-12 * Math.max(1e-30, Math.abs(T_ke))
  const linKOk =
    Math.abs(T_doubleK - 2 * T_ke) < 1e-12 * Math.max(1e-30, Math.abs(T_ke))
  const expectedPv = (P * V) / (N * K_B)
  const pvOk =
    Math.abs(T_pv - expectedPv) < 1e-12 * Math.max(1e-30, Math.abs(T_pv))
  const badOk = !Number.isFinite(T_badN)
  const positiveOk = K > 0 ? T_ke > 0 : true

  const ok = finite && formulaOk && linKOk && pvOk && badOk && positiveOk

  return {
    K,
    N,
    P,
    V,
    T_ke,
    T_pv,
    T_doubleK,
    T_badN,
    finite,
    ok,
    methodId: METHOD_ALGO_VIRIAL_T,
    familyId: METHOD_VIRIAL,
  }
}
