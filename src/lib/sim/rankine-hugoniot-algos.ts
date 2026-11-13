/**
 * Rankine–Hugoniot normal shock · pure teaching stubs.
 * Ideal-gas pressure ratio: p2/p1 = (2 γ M² − (γ−1)) / (γ+1).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Rankine–Hugoniot jump conditions. */
export const METHOD_RH = 'method-rankine-hugoniot'

/** Algo · shock pressure ratio p2/p1. */
export const METHOD_ALGO_RH_PRESSURE = 'method-algo-rh-pressure-ratio'

/** Parent alias (aligns with familyId). */
export const RH_PARENT = METHOD_RH

export const RH_METHOD_IDS = [METHOD_ALGO_RH_PRESSURE] as const

/** Default ratio of specific heats γ (diatomic air-class). */
export const DEFAULT_GAMMA = 1.4

/** Default upstream Mach number M. */
export const DEFAULT_M = 2

/**
 * Ideal-gas normal-shock pressure ratio:
 *   p2/p1 = (2 γ M² − (γ − 1)) / (γ + 1)
 *
 * M: upstream Mach number (M ≥ 1 for physical shock),
 * gamma: ratio of specific heats (γ > 1).
 * Requires M>0, gamma>1, finite; else NaN.
 * At M=1, p2/p1 = 1 (sonic continuity).
 */
export function rhPressureRatio(M: number, gamma: number): number {
  if (
    !Number.isFinite(M) ||
    !Number.isFinite(gamma) ||
    !(M > 0) ||
    !(gamma > 1)
  ) {
    return NaN
  }
  return (2 * gamma * M * M - (gamma - 1)) / (gamma + 1)
}

/**
 * RH sample: γ=1.4, M=2 → p2/p1 = 4.5; M=1 ⇒ ratio=1;
 * higher M ⇒ higher ratio; illegal M≤0 or γ≤1.
 */
export function runRhPressureSample(opts?: {
  M?: number
  gamma?: number
}): {
  M: number
  gamma: number
  ratio: number
  ratio_sonic: number
  ratio_higherM: number
  ratio_badM: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RH_PRESSURE
  familyId: typeof METHOD_RH
} {
  const M = opts?.M ?? DEFAULT_M
  const gamma = opts?.gamma ?? DEFAULT_GAMMA

  const ratio = rhPressureRatio(M, gamma)
  const ratio_sonic = rhPressureRatio(1, gamma)
  const ratio_higherM = rhPressureRatio(M + 1, gamma)
  const ratio_badM = rhPressureRatio(0, gamma)

  const finite =
    Number.isFinite(ratio) &&
    Number.isFinite(ratio_sonic) &&
    Number.isFinite(ratio_higherM)

  const expected = (2 * gamma * M * M - (gamma - 1)) / (gamma + 1)
  const formulaOk =
    Math.abs(ratio - expected) < 1e-12 * Math.max(1, Math.abs(ratio))
  const sonicOk = Math.abs(ratio_sonic - 1) < 1e-12
  const monoOk = ratio_higherM > ratio
  // Supersonic M>1 ⇒ compressive p2/p1 > 1
  const compressOk = M > 1 ? ratio > 1 : true
  const badOk = !Number.isFinite(ratio_badM)

  const ok = finite && formulaOk && sonicOk && monoOk && compressOk && badOk

  return {
    M,
    gamma,
    ratio,
    ratio_sonic,
    ratio_higherM,
    ratio_badM,
    finite,
    ok,
    methodId: METHOD_ALGO_RH_PRESSURE,
    familyId: METHOD_RH,
  }
}
