/**
 * MHD Faraday generator · pure teaching stub.
 * Open-circuit EMF ℰ = u B L (velocity × field × electrode span).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · MHD generator. */
export const METHOD_MHD = 'method-mhd-generator'

/** Algo · open-circuit Faraday MHD EMF. */
export const METHOD_ALGO_MHD_EMF = 'method-algo-mhd-emf'

/** Parent alias (aligns with familyId). */
export const MHD_PARENT = METHOD_MHD

export const MHD_METHOD_IDS = [METHOD_ALGO_MHD_EMF] as const

/**
 * Open-circuit Faraday MHD electromotive force (V):
 *   ℰ = u · B · L
 *
 * u: plasma/flow speed (m/s) perpendicular to B,
 * B: magnetic field (T),
 * L: electrode spacing / channel width (m).
 * Non-finite → NaN.
 */
export function mhdEmf(u: number, B: number, L: number): number {
  if (!Number.isFinite(u) || !Number.isFinite(B) || !Number.isFinite(L)) {
    return NaN
  }
  return u * B * L
}

/**
 * MHD EMF sample: ℰ = u B L; linear in each factor; zero velocity → 0.
 */
export function runMhdEmfSample(opts?: {
  u?: number
  B?: number
  L?: number
}): {
  u: number
  B: number
  L: number
  emf: number
  emf_doubleU: number
  emf_doubleB: number
  emf_doubleL: number
  emf_zeroU: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MHD_EMF
  familyId: typeof METHOD_MHD
} {
  const u = opts?.u ?? 1000 // m/s
  const B = opts?.B ?? 2 // T
  const L = opts?.L ?? 0.5 // m

  const emf = mhdEmf(u, B, L)
  const emf_doubleU = mhdEmf(2 * u, B, L)
  const emf_doubleB = mhdEmf(u, 2 * B, L)
  const emf_doubleL = mhdEmf(u, B, 2 * L)
  const emf_zeroU = mhdEmf(0, B, L)

  const finite =
    Number.isFinite(emf) &&
    Number.isFinite(emf_doubleU) &&
    Number.isFinite(emf_doubleB) &&
    Number.isFinite(emf_doubleL) &&
    Number.isFinite(emf_zeroU)

  const formulaOk = Math.abs(emf - u * B * L) < 1e-12 * Math.max(1, Math.abs(emf))
  const linU = Math.abs(emf_doubleU - 2 * emf) < 1e-12 * Math.max(1, Math.abs(emf))
  const linB = Math.abs(emf_doubleB - 2 * emf) < 1e-12 * Math.max(1, Math.abs(emf))
  const linL = Math.abs(emf_doubleL - 2 * emf) < 1e-12 * Math.max(1, Math.abs(emf))
  const zeroOk = Math.abs(emf_zeroU) < 1e-30
  const positive = emf > 0

  const ok = finite && formulaOk && linU && linB && linL && zeroOk && positive

  return {
    u,
    B,
    L,
    emf,
    emf_doubleU,
    emf_doubleB,
    emf_doubleL,
    emf_zeroU,
    finite,
    ok,
    methodId: METHOD_ALGO_MHD_EMF,
    familyId: METHOD_MHD,
  }
}
