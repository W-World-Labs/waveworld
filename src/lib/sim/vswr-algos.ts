/**
 * VSWR from reflection coefficient · pure teaching stubs.
 * VSWR = (1 + |Γ|) / (1 − |Γ|) for |Γ| < 1.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · voltage standing wave ratio. */
export const METHOD_VSWR = 'method-vswr'

/** Algo · VSWR from Γ. */
export const METHOD_ALGO_VSWR = 'method-algo-vswr-from-gamma'

/** Parent alias. */
export const VSWR_PARENT = METHOD_VSWR

export const VSWR_METHOD_IDS = [METHOD_ALGO_VSWR] as const

/** Default |Γ| for samples. */
export const DEFAULT_GAMMA = 0.2

/**
 * Voltage standing wave ratio from reflection coefficient magnitude:
 *   VSWR = (1 + |Γ|) / (1 − |Γ|)
 *
 * Requires |Γ| < 1 and finite; else NaN.
 * Γ=0 ⇒ VSWR=1 (matched).
 */
export function vswrFromGamma(gamma: number): number {
  if (!Number.isFinite(gamma)) return NaN
  const g = Math.abs(gamma)
  if (!(g < 1)) return NaN
  return (1 + g) / (1 - g)
}

/**
 * Inverse: |Γ| from VSWR:
 *   |Γ| = (VSWR − 1) / (VSWR + 1)
 *
 * Requires VSWR ≥ 1, finite; else NaN.
 */
export function gammaFromVswr(vswr: number): number {
  if (!Number.isFinite(vswr) || !(vswr >= 1)) return NaN
  return (vswr - 1) / (vswr + 1)
}

/**
 * VSWR sample: Γ=0 → 1; formula; inverse round-trip; |Γ|≥1 → NaN.
 */
export function runVswrSample(opts?: { gamma?: number }): {
  gamma: number
  vswr: number
  vswr_matched: number
  gamma_back: number
  vswr_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VSWR
  familyId: typeof METHOD_VSWR
} {
  const gamma = opts?.gamma ?? DEFAULT_GAMMA

  const vswr = vswrFromGamma(gamma)
  const vswr_matched = vswrFromGamma(0)
  const gamma_back = gammaFromVswr(vswr)
  const vswr_bad = vswrFromGamma(1)

  const finite =
    Number.isFinite(vswr) &&
    Number.isFinite(vswr_matched) &&
    Number.isFinite(gamma_back)

  const g = Math.abs(gamma)
  const expected = (1 + g) / (1 - g)
  const formulaOk =
    Math.abs(vswr - expected) < 1e-12 * Math.max(1, Math.abs(vswr))
  const matchedOk = Math.abs(vswr_matched - 1) < 1e-15
  const invOk = Math.abs(gamma_back - g) < 1e-12
  const monoOk = vswr >= 1
  const badOk = !Number.isFinite(vswr_bad)

  const ok = finite && formulaOk && matchedOk && invOk && monoOk && badOk

  return {
    gamma,
    vswr,
    vswr_matched,
    gamma_back,
    vswr_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_VSWR,
    familyId: METHOD_VSWR,
  }
}
