/**
 * Carnot + Otto cycle · pure teaching stubs.
 * Carnot η = 1 − T_c/T_h; Otto η = 1 − r^(1−γ).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Carnot heat engine. */
export const METHOD_CARNOT = 'method-carnot'

/** Algo · Carnot thermal efficiency η = 1 − T_c/T_h. */
export const METHOD_ALGO_CARNOT_ETA = 'method-algo-carnot-eta'

/** Family · Otto cycle (spark-ignition ideal gas). */
export const METHOD_OTTO = 'method-otto'

/** Algo · Otto thermal efficiency η = 1 − r^(1−γ). */
export const METHOD_ALGO_OTTO_ETA = 'method-algo-otto-eta'

/** Parent aliases (align with familyId). */
export const CARNOT_PARENT = METHOD_CARNOT
export const OTTO_PARENT = METHOD_OTTO

export const CARNOT_METHOD_IDS = [METHOD_ALGO_CARNOT_ETA] as const
export const OTTO_METHOD_IDS = [METHOD_ALGO_OTTO_ETA] as const

/** Combined export for both families in this module. */
export const CARNOT_OTTO_METHOD_IDS = [
  METHOD_ALGO_CARNOT_ETA,
  METHOD_ALGO_OTTO_ETA,
] as const

/**
 * Ideal Carnot thermal efficiency:
 *   η = 1 − T_c / T_h
 *
 * T absolute (K). Requires T_h > T_c > 0; else NaN.
 * Same guard style as rankineIdealEta.
 */
export function carnotEta(Th: number, Tc: number): number {
  if (
    !Number.isFinite(Th) ||
    !Number.isFinite(Tc) ||
    !(Th > 0) ||
    !(Tc > 0) ||
    !(Th > Tc)
  ) {
    return NaN
  }
  return 1 - Tc / Th
}

/**
 * Ideal Otto-cycle thermal efficiency (cold air-standard):
 *   η = 1 − r^(1−γ)  = 1 − 1 / r^(γ−1)
 *
 * r = V1/V2 compression ratio (>1), γ = c_p/c_v heat-capacity ratio (>1).
 * Invalid domain → NaN.
 */
export function ottoEta(r: number, gamma: number): number {
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(gamma) ||
    !(r > 1) ||
    !(gamma > 1)
  ) {
    return NaN
  }
  return 1 - Math.pow(r, 1 - gamma)
}

/**
 * Carnot sample: Th=800 K, Tc=300 K → η=0.625; monotonic; equal-T illegal.
 */
export function runCarnotEtaSample(opts?: {
  Th?: number
  Tc?: number
}): {
  Th: number
  Tc: number
  eta: number
  etaHotter: number
  etaColderSink: number
  etaEqualT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CARNOT_ETA
  familyId: typeof METHOD_CARNOT
} {
  const Th = opts?.Th ?? 800
  const Tc = opts?.Tc ?? 300

  const eta = carnotEta(Th, Tc)
  const etaHotter = carnotEta(Th + 100, Tc)
  const etaColderSink = carnotEta(Th, Tc - 20)
  const etaEqualT = carnotEta(Th, Th)

  const finite =
    Number.isFinite(eta) &&
    Number.isFinite(etaHotter) &&
    Number.isFinite(etaColderSink)

  const formulaOk = Math.abs(eta - (1 - Tc / Th)) < 1e-14
  const boundsOk = eta > 0 && eta < 1
  const monoOk = etaHotter > eta && etaColderSink > eta
  const equalIllegal = !Number.isFinite(etaEqualT)

  const ok = finite && formulaOk && boundsOk && monoOk && equalIllegal

  return {
    Th,
    Tc,
    eta,
    etaHotter,
    etaColderSink,
    etaEqualT,
    finite,
    ok,
    methodId: METHOD_ALGO_CARNOT_ETA,
    familyId: METHOD_CARNOT,
  }
}

/**
 * Otto sample: r=8, γ=1.4 → η ≈ 0.565; r↑ ⇒ η↑; γ↑ ⇒ η↑.
 */
export function runOttoEtaSample(opts?: {
  r?: number
  gamma?: number
}): {
  r: number
  gamma: number
  eta: number
  etaHigherR: number
  etaHigherGamma: number
  etaBadR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_OTTO_ETA
  familyId: typeof METHOD_OTTO
} {
  const r = opts?.r ?? 8
  const gamma = opts?.gamma ?? 1.4

  const eta = ottoEta(r, gamma)
  const etaHigherR = ottoEta(r + 2, gamma)
  const etaHigherGamma = ottoEta(r, gamma + 0.1)
  const etaBadR = ottoEta(1, gamma)

  const finite =
    Number.isFinite(eta) &&
    Number.isFinite(etaHigherR) &&
    Number.isFinite(etaHigherGamma)

  const expected = 1 - Math.pow(r, 1 - gamma)
  const formulaOk = Math.abs(eta - expected) < 1e-14
  const altForm = 1 - 1 / Math.pow(r, gamma - 1)
  const altOk = Math.abs(eta - altForm) < 1e-12
  const boundsOk = eta > 0 && eta < 1
  const monoOk = etaHigherR > eta && etaHigherGamma > eta
  const badOk = !Number.isFinite(etaBadR)

  const ok = finite && formulaOk && altOk && boundsOk && monoOk && badOk

  return {
    r,
    gamma,
    eta,
    etaHigherR,
    etaHigherGamma,
    etaBadR,
    finite,
    ok,
    methodId: METHOD_ALGO_OTTO_ETA,
    familyId: METHOD_OTTO,
  }
}
