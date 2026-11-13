/**
 * Diesel cycle · pure teaching stub.
 * η = 1 − (1/r^(γ−1)) · (rc^γ − 1)/(γ(rc − 1)).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Diesel cycle. */
export const METHOD_DIESEL = 'method-diesel'

/** Algo · Diesel thermal efficiency. */
export const METHOD_ALGO_DIESEL_ETA = 'method-algo-diesel-eta'

/** Parent alias (aligns with familyId). */
export const DIESEL_PARENT = METHOD_DIESEL

export const DIESEL_METHOD_IDS = [METHOD_ALGO_DIESEL_ETA] as const

/** Default compression ratio r = V1/V2. */
export const DEFAULT_R = 18

/** Default cutoff ratio rc = V3/V2. */
export const DEFAULT_RC = 2

/** Default heat-capacity ratio γ. */
export const DEFAULT_GAMMA = 1.4

/**
 * Ideal Diesel-cycle thermal efficiency (cold air-standard):
 *   η = 1 − (1 / r^(γ−1)) · (rc^γ − 1) / (γ · (rc − 1))
 *
 * r: compression ratio (>1), rc: cutoff ratio (>1), γ: cp/cv (>1).
 * Invalid domain → NaN.
 */
export function dieselEta(r: number, rc: number, gamma: number): number {
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(rc) ||
    !Number.isFinite(gamma) ||
    !(r > 1) ||
    !(rc > 1) ||
    !(gamma > 1)
  ) {
    return NaN
  }
  const inv = 1 / Math.pow(r, gamma - 1)
  const num = Math.pow(rc, gamma) - 1
  const den = gamma * (rc - 1)
  return 1 - inv * (num / den)
}

/**
 * Diesel sample: r=18, rc=2, γ=1.4 → η ≈ 0.63-class;
 * r↑ ⇒ η↑; rc→1⁺ approaches Otto; illegal r≤1.
 */
export function runDieselEtaSample(opts?: {
  r?: number
  rc?: number
  gamma?: number
}): {
  r: number
  rc: number
  gamma: number
  eta: number
  etaHigherR: number
  etaNearOtto: number
  etaBadR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DIESEL_ETA
  familyId: typeof METHOD_DIESEL
} {
  const r = opts?.r ?? DEFAULT_R
  const rc = opts?.rc ?? DEFAULT_RC
  const gamma = opts?.gamma ?? DEFAULT_GAMMA

  const eta = dieselEta(r, rc, gamma)
  const etaHigherR = dieselEta(r + 4, rc, gamma)
  // rc close to 1: cutoff→isochoric limit (Otto-like)
  const etaNearOtto = dieselEta(r, 1.01, gamma)
  const etaBadR = dieselEta(1, rc, gamma)

  const finite =
    Number.isFinite(eta) &&
    Number.isFinite(etaHigherR) &&
    Number.isFinite(etaNearOtto)

  const inv = 1 / Math.pow(r, gamma - 1)
  const expected = 1 - inv * ((Math.pow(rc, gamma) - 1) / (gamma * (rc - 1)))
  const formulaOk = Math.abs(eta - expected) < 1e-12
  const boundsOk = eta > 0 && eta < 1
  const monoR = etaHigherR > eta
  // Near-Otto should exceed full-cutoff diesel efficiency (rc↑ lowers η)
  const nearOttoHigher = etaNearOtto > eta
  const badOk = !Number.isFinite(etaBadR)

  const ok = finite && formulaOk && boundsOk && monoR && nearOttoHigher && badOk

  return {
    r,
    rc,
    gamma,
    eta,
    etaHigherR,
    etaNearOtto,
    etaBadR,
    finite,
    ok,
    methodId: METHOD_ALGO_DIESEL_ETA,
    familyId: METHOD_DIESEL,
  }
}
