/**
 * S-parameters · pure teaching stubs.
 * S11_dB = 20 · log10(|S11|) for |S11| > 0.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · scattering parameters. */
export const METHOD_SPARAM = 'method-s-parameters'

/** Algo · reflection coefficient in dB. */
export const METHOD_ALGO_S11_DB = 'method-algo-s11-db'

/** Parent alias (aligns with familyId). */
export const SPARAM_PARENT = METHOD_SPARAM

export const SPARAM_METHOD_IDS = [METHOD_ALGO_S11_DB] as const

/** Default |S11| (linear magnitude). */
export const DEFAULT_S11_MAG = 0.1

/**
 * Reflection coefficient magnitude in dB:
 *   S11_dB = 20 · log₁₀(|S11|)
 *
 * mag: |S11| (linear). Requires mag > 0 and finite; else NaN.
 * (mag = 0 would be −∞.)
 */
export function s11Db(mag: number): number {
  if (!Number.isFinite(mag) || !(mag > 0)) return NaN
  return 20 * Math.log10(mag)
}

/**
 * S11_dB sample: 20 log10(|S11|); half mag −6 dB; mag≤0 illegal.
 */
export function runS11DbSample(opts?: { mag?: number }): {
  mag: number
  S11_dB: number
  S11_dB_half: number
  S11_dB_unity: number
  S11_dB_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_S11_DB
  familyId: typeof METHOD_SPARAM
} {
  const mag = opts?.mag ?? DEFAULT_S11_MAG

  const S11_dB = s11Db(mag)
  const S11_dB_half = s11Db(mag / 2)
  const S11_dB_unity = s11Db(1)
  const S11_dB_bad = s11Db(0)

  const finite =
    Number.isFinite(S11_dB) &&
    Number.isFinite(S11_dB_half) &&
    Number.isFinite(S11_dB_unity)

  const formulaOk =
    Math.abs(S11_dB - 20 * Math.log10(mag)) <
    1e-12 * Math.max(1, Math.abs(S11_dB))
  // half magnitude ⇒ −6.0206… dB shift
  const halfOk =
    Math.abs(S11_dB_half - (S11_dB - 20 * Math.log10(2))) < 1e-10
  const unityOk = Math.abs(S11_dB_unity) < 1e-15
  const badOk = !Number.isFinite(S11_dB_bad)
  const negOk = mag < 1 ? S11_dB < 0 : true

  const ok = finite && formulaOk && halfOk && unityOk && badOk && negOk

  return {
    mag,
    S11_dB,
    S11_dB_half,
    S11_dB_unity,
    S11_dB_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_S11_DB,
    familyId: METHOD_SPARAM,
  }
}
