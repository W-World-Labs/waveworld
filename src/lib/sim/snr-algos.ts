/**
 * Signal-to-noise ratio · pure teaching stubs.
 * SNR_dB = 10 · log10(Ps / Pn)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · SNR. */
export const METHOD_SNR = 'method-snr'

/** Algo · SNR in dB. */
export const METHOD_ALGO_SNR_DB = 'method-algo-snr-db'

/** Parent alias (aligns with familyId). */
export const SNR_PARENT = METHOD_SNR

export const SNR_METHOD_IDS = [METHOD_ALGO_SNR_DB] as const

/** Default signal power Ps (W, arbitrary linear units). */
export const DEFAULT_PS = 1e-6

/** Default noise power Pn (W). */
export const DEFAULT_PN = 1e-9

/**
 * SNR in dB:
 *   SNR_dB = 10 · log₁₀(Ps / Pn)
 *
 * Ps: signal power, Pn: noise power (same linear units).
 * Requires Ps>0, Pn>0, finite; else NaN.
 */
export function snrDb(Ps: number, Pn: number): number {
  if (
    !Number.isFinite(Ps) ||
    !Number.isFinite(Pn) ||
    !(Ps > 0) ||
    !(Pn > 0)
  ) {
    return NaN
  }
  return 10 * Math.log10(Ps / Pn)
}

/**
 * Linear SNR from powers: Ps/Pn.
 */
export function snrLinear(Ps: number, Pn: number): number {
  if (
    !Number.isFinite(Ps) ||
    !Number.isFinite(Pn) ||
    !(Ps > 0) ||
    !(Pn > 0)
  ) {
    return NaN
  }
  return Ps / Pn
}

/**
 * SNR sample: 10 log10(Ps/Pn); 10× Ps ⇒ +10 dB; Pn≤0 illegal.
 */
export function runSnrDbSample(opts?: { Ps?: number; Pn?: number }): {
  Ps: number
  Pn: number
  SNR_dB: number
  SNR_lin: number
  SNR_10xPs: number
  SNR_equal: number
  SNR_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SNR_DB
  familyId: typeof METHOD_SNR
} {
  const Ps = opts?.Ps ?? DEFAULT_PS
  const Pn = opts?.Pn ?? DEFAULT_PN

  const SNR_dB = snrDb(Ps, Pn)
  const SNR_lin = snrLinear(Ps, Pn)
  const SNR_10xPs = snrDb(10 * Ps, Pn)
  const SNR_equal = snrDb(Pn, Pn)
  const SNR_bad = snrDb(Ps, 0)

  const finite =
    Number.isFinite(SNR_dB) &&
    Number.isFinite(SNR_lin) &&
    Number.isFinite(SNR_10xPs) &&
    Number.isFinite(SNR_equal)

  const expected = 10 * Math.log10(Ps / Pn)
  const formulaOk =
    Math.abs(SNR_dB - expected) < 1e-12 * Math.max(1, Math.abs(SNR_dB))
  const linOk = Math.abs(SNR_lin - Ps / Pn) < 1e-12 * Math.max(1, SNR_lin)
  const tenOk = Math.abs(SNR_10xPs - (SNR_dB + 10)) < 1e-10
  const equalOk = Math.abs(SNR_equal) < 1e-15
  const badOk = !Number.isFinite(SNR_bad)

  const ok = finite && formulaOk && linOk && tenOk && equalOk && badOk

  return {
    Ps,
    Pn,
    SNR_dB,
    SNR_lin,
    SNR_10xPs,
    SNR_equal,
    SNR_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_SNR_DB,
    familyId: METHOD_SNR,
  }
}
