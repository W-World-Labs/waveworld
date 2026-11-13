/**
 * Photoacoustic initial pressure · pure teaching stub.
 * p0 = Γ · μ_a · F  (stress-confinement short-pulse limit).
 * Distinct from photo-algos (PDT); method id constants only.
 */

/** Family · photoacoustic imaging / sensing. */
export const METHOD_PA = 'method-photoacoustic'

/** Algo · initial pressure p0 = Γ μ_a F. */
export const METHOD_ALGO_PA_PRESSURE = 'method-algo-pa-pressure'

/** Parent alias (aligns with familyId). */
export const PA_PARENT = METHOD_PA

export const PA_METHOD_IDS = [METHOD_ALGO_PA_PRESSURE] as const

/**
 * Initial photoacoustic pressure (Pa) under stress confinement:
 *   p0 = Γ · μ_a · F
 *
 * Γ: Grüneisen parameter (dimensionless),
 * μ_a: optical absorption coefficient (m⁻¹),
 * F: local fluence (J/m²).
 * Requires all finite; Γ, μ_a, F typically ≥0 for physical samples.
 * Non-finite → NaN. Negative inputs still compute (teaching) but sample uses ≥0.
 */
export function paPressure(Gamma: number, mua: number, F: number): number {
  if (
    !Number.isFinite(Gamma) ||
    !Number.isFinite(mua) ||
    !Number.isFinite(F)
  ) {
    return NaN
  }
  return Gamma * mua * F
}

/**
 * Photoacoustic pressure sample: p0 = Γ μ_a F; linear in each factor.
 */
export function runPaPressureSample(opts?: {
  Gamma?: number
  mua?: number
  F?: number
}): {
  Gamma: number
  mua: number
  F: number
  p0: number
  p0_doubleGamma: number
  p0_doubleMua: number
  p0_doubleF: number
  p0_zeroF: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PA_PRESSURE
  familyId: typeof METHOD_PA
} {
  // Soft tissue-ish teaching: Γ~0.2, μ_a~100 m⁻¹, F~20 J/m²
  const Gamma = opts?.Gamma ?? 0.2
  const mua = opts?.mua ?? 100
  const F = opts?.F ?? 20

  const p0 = paPressure(Gamma, mua, F)
  const p0_doubleGamma = paPressure(2 * Gamma, mua, F)
  const p0_doubleMua = paPressure(Gamma, 2 * mua, F)
  const p0_doubleF = paPressure(Gamma, mua, 2 * F)
  const p0_zeroF = paPressure(Gamma, mua, 0)

  const finite =
    Number.isFinite(p0) &&
    Number.isFinite(p0_doubleGamma) &&
    Number.isFinite(p0_doubleMua) &&
    Number.isFinite(p0_doubleF) &&
    Number.isFinite(p0_zeroF)

  const formulaOk = Math.abs(p0 - Gamma * mua * F) < 1e-12 * Math.max(1, p0)
  const linG = Math.abs(p0_doubleGamma - 2 * p0) < 1e-12 * Math.max(1, p0)
  const linM = Math.abs(p0_doubleMua - 2 * p0) < 1e-12 * Math.max(1, p0)
  const linF = Math.abs(p0_doubleF - 2 * p0) < 1e-12 * Math.max(1, p0)
  const zeroOk = Math.abs(p0_zeroF) < 1e-30
  const positive = p0 > 0

  const ok = finite && formulaOk && linG && linM && linF && zeroOk && positive

  return {
    Gamma,
    mua,
    F,
    p0,
    p0_doubleGamma,
    p0_doubleMua,
    p0_doubleF,
    p0_zeroF,
    finite,
    ok,
    methodId: METHOD_ALGO_PA_PRESSURE,
    familyId: METHOD_PA,
  }
}
