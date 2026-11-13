/**
 * Compton scattering · pure teaching stub.
 * Wavelength shift Δλ = λ_C (1 − cos θ).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Compton effect. */
export const METHOD_COMPTON = 'method-compton'

/** Algo · Compton wavelength shift. */
export const METHOD_ALGO_COMPTON_SHIFT = 'method-algo-compton-shift'

/** Parent alias (aligns with familyId). */
export const COMPTON_PARENT = METHOD_COMPTON

export const COMPTON_METHOD_IDS = [METHOD_ALGO_COMPTON_SHIFT] as const

/** Compton wavelength of the electron λ_C = h/(m_e c) (m). */
export const LAMBDA_C = 2.42631023867e-12

/** Default Compton wavelength used in samples (m). */
export const DEFAULT_LAMBDA_C = 2.426e-12

/**
 * Compton wavelength shift:
 *   Δλ = λ_C · (1 − cos θ)
 *
 * θ in radians; λ_C defaults to 2.426e-12 m.
 * Non-finite θ or λ_C → NaN.
 */
export function comptonShift(
  theta: number,
  lambdaC: number = DEFAULT_LAMBDA_C,
): number {
  if (!Number.isFinite(theta) || !Number.isFinite(lambdaC)) return NaN
  return lambdaC * (1 - Math.cos(theta))
}

/**
 * Compton shift sample: θ=90° → Δλ=λ_C; θ=0 → 0; θ=180° → 2 λ_C.
 */
export function runComptonShiftSample(opts?: {
  theta?: number
  lambdaC?: number
}): {
  theta: number
  lambdaC: number
  dLambda: number
  dLambda0: number
  dLambda90: number
  dLambda180: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_COMPTON_SHIFT
  familyId: typeof METHOD_COMPTON
} {
  const theta = opts?.theta ?? Math.PI / 3 // 60°
  const lambdaC = opts?.lambdaC ?? DEFAULT_LAMBDA_C

  const dLambda = comptonShift(theta, lambdaC)
  const dLambda0 = comptonShift(0, lambdaC)
  const dLambda90 = comptonShift(Math.PI / 2, lambdaC)
  const dLambda180 = comptonShift(Math.PI, lambdaC)

  const finite =
    Number.isFinite(dLambda) &&
    Number.isFinite(dLambda0) &&
    Number.isFinite(dLambda90) &&
    Number.isFinite(dLambda180)

  const formulaOk =
    Math.abs(dLambda - lambdaC * (1 - Math.cos(theta))) < 1e-18 * Math.max(1, lambdaC)
  const zeroOk = Math.abs(dLambda0) < 1e-30 * Math.max(1, lambdaC)
  const rightOk = Math.abs(dLambda90 - lambdaC) < 1e-18 * Math.max(1, lambdaC)
  const backOk = Math.abs(dLambda180 - 2 * lambdaC) < 1e-18 * Math.max(1, lambdaC)
  const monoOk = dLambda90 > dLambda0 && dLambda180 > dLambda90
  const nonNeg = dLambda >= 0

  const ok = finite && formulaOk && zeroOk && rightOk && backOk && monoOk && nonNeg

  return {
    theta,
    lambdaC,
    dLambda,
    dLambda0,
    dLambda90,
    dLambda180,
    finite,
    ok,
    methodId: METHOD_ALGO_COMPTON_SHIFT,
    familyId: METHOD_COMPTON,
  }
}
