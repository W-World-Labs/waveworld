/**
 * Fourier's law of heat conduction · pure teaching stubs.
 * q = −k · dT/dx  (use ΔT/Δx).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Fourier heat conduction. */
export const METHOD_FOURIER = 'method-fourier-law'

/** Algo · heat flux q = −k ΔT/Δx. */
export const METHOD_ALGO_FOURIER_FLUX = 'method-algo-fourier-flux'

/** Parent alias (aligns with familyId). */
export const FOURIER_PARENT = METHOD_FOURIER

export const FOURIER_METHOD_IDS = [METHOD_ALGO_FOURIER_FLUX] as const

/** Default thermal conductivity k (W/(m·K)); metal-class toy. */
export const DEFAULT_K = 200

/** Default temperature difference ΔT (K). */
export const DEFAULT_DELTA_T = 50

/** Default length Δx (m). */
export const DEFAULT_DELTA_X = 0.01

/**
 * Fourier heat flux density (W/m² teaching):
 *   q = −k · (ΔT / Δx)
 *
 * k: thermal conductivity (W/(m·K)), deltaT: temperature difference (K),
 * deltaX: spatial interval (m). Requires deltaX ≠ 0, finite; else NaN.
 * Sign: positive ΔT (hotter at higher x-start) yields negative q (heat → −x).
 */
export function fourierFlux(k: number, deltaT: number, deltaX: number): number {
  if (
    !Number.isFinite(k) ||
    !Number.isFinite(deltaT) ||
    !Number.isFinite(deltaX) ||
    deltaX === 0
  ) {
    return NaN
  }
  const q = -k * (deltaT / deltaX)
  return q === 0 ? 0 : q
}

/**
 * Fourier sample: q = −k ΔT/Δx; linear in k and ΔT; zero ΔT ⇒ q=0;
 * doubles with k; illegal Δx=0.
 */
export function runFourierFluxSample(opts?: {
  k?: number
  deltaT?: number
  deltaX?: number
}): {
  k: number
  deltaT: number
  deltaX: number
  q: number
  q_doubleK: number
  q_zeroT: number
  q_badX: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FOURIER_FLUX
  familyId: typeof METHOD_FOURIER
} {
  const k = opts?.k ?? DEFAULT_K
  const deltaT = opts?.deltaT ?? DEFAULT_DELTA_T
  const deltaX = opts?.deltaX ?? DEFAULT_DELTA_X

  const q = fourierFlux(k, deltaT, deltaX)
  const q_doubleK = fourierFlux(2 * k, deltaT, deltaX)
  const q_zeroT = fourierFlux(k, 0, deltaX)
  const q_badX = fourierFlux(k, deltaT, 0)

  const finite =
    Number.isFinite(q) &&
    Number.isFinite(q_doubleK) &&
    Number.isFinite(q_zeroT)

  const expected = -k * (deltaT / deltaX)
  const formulaOk =
    Math.abs(q - expected) < 1e-12 * Math.max(1, Math.abs(q))
  const linKOk =
    Math.abs(q_doubleK - 2 * q) < 1e-12 * Math.max(1, Math.abs(q))
  const zeroOk = Math.abs(q_zeroT) < 1e-30
  // Down-gradient: ΔT>0, Δx>0, k>0 ⇒ q < 0
  const signOk = k > 0 && deltaT > 0 && deltaX > 0 ? q < 0 : true
  const badOk = !Number.isFinite(q_badX)

  const ok = finite && formulaOk && linKOk && zeroOk && signOk && badOk

  return {
    k,
    deltaT,
    deltaX,
    q,
    q_doubleK,
    q_zeroT,
    q_badX,
    finite,
    ok,
    methodId: METHOD_ALGO_FOURIER_FLUX,
    familyId: METHOD_FOURIER,
  }
}
