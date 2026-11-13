/**
 * Shannon–Hartley channel capacity · pure teaching stubs.
 * C = B · log2(1 + SNR)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Shannon channel capacity. */
export const METHOD_SHANNON = 'method-shannon-capacity'

/** Algo · capacity C = B log2(1+SNR). */
export const METHOD_ALGO_SHANNON_C = 'method-algo-shannon-c'

/** Parent alias (aligns with familyId). */
export const SHANNON_PARENT = METHOD_SHANNON

export const SHANNON_METHOD_IDS = [METHOD_ALGO_SHANNON_C] as const

/** Default bandwidth B (Hz). */
export const DEFAULT_B = 1e6

/** Default linear SNR (power ratio, dimensionless). */
export const DEFAULT_SNR = 10

/**
 * Shannon–Hartley capacity (bit/s):
 *   C = B · log₂(1 + SNR)
 *
 * B: bandwidth (Hz), SNR: signal-to-noise power ratio (linear, not dB).
 * Requires B≥0, SNR≥0, finite; else NaN.
 */
export function shannonCapacity(B: number, snr: number): number {
  if (
    !Number.isFinite(B) ||
    !Number.isFinite(snr) ||
    !(B >= 0) ||
    !(snr >= 0)
  ) {
    return NaN
  }
  return B * Math.log2(1 + snr)
}

/**
 * Convert SNR from dB to linear:
 *   SNR_lin = 10^(SNRdB / 10)
 */
export function snrFromDb(snrDb: number): number {
  if (!Number.isFinite(snrDb)) return NaN
  return 10 ** (snrDb / 10)
}

/**
 * Shannon sample: C = B log2(1+SNR); ∝ B; SNR=0 ⇒ C=0.
 */
export function runShannonCSample(opts?: {
  B?: number
  snr?: number
}): {
  B: number
  snr: number
  C: number
  C_doubleB: number
  C_zeroSnr: number
  C_fromDb: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SHANNON_C
  familyId: typeof METHOD_SHANNON
} {
  const B = opts?.B ?? DEFAULT_B
  const snr = opts?.snr ?? DEFAULT_SNR

  const C = shannonCapacity(B, snr)
  const C_doubleB = shannonCapacity(2 * B, snr)
  const C_zeroSnr = shannonCapacity(B, 0)
  // 10 dB ⇒ SNR = 10
  const C_fromDb = shannonCapacity(B, snrFromDb(10))

  const finite =
    Number.isFinite(C) &&
    Number.isFinite(C_doubleB) &&
    Number.isFinite(C_zeroSnr) &&
    Number.isFinite(C_fromDb)

  const expected = B * Math.log2(1 + snr)
  const formulaOk =
    Math.abs(C - expected) < 1e-12 * Math.max(1, Math.abs(C))
  const linBOk =
    Math.abs(C_doubleB - 2 * C) < 1e-12 * Math.max(1, Math.abs(C))
  const zeroOk = Math.abs(C_zeroSnr) < 1e-30
  const dbOk =
    Math.abs(C_fromDb - B * Math.log2(1 + 10)) <
    1e-10 * Math.max(1, Math.abs(C_fromDb))
  const positiveOk = C > 0

  const ok = finite && formulaOk && linBOk && zeroOk && dbOk && positiveOk

  return {
    B,
    snr,
    C,
    C_doubleB,
    C_zeroSnr,
    C_fromDb,
    finite,
    ok,
    methodId: METHOD_ALGO_SHANNON_C,
    familyId: METHOD_SHANNON,
  }
}
