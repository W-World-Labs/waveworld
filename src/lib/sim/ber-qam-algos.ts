/**
 * Bit-error rate (BPSK teaching) · pure teaching stubs.
 * Pb ≈ ½ erfc(√(Eb/N0)) for coherent BPSK
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · BER / digital link. */
export const METHOD_BER = 'method-ber'

/** Algo · BPSK bit-error probability. */
export const METHOD_ALGO_BER_BPSK = 'method-algo-ber-bpsk'

/** Parent alias. */
export const BER_PARENT = METHOD_BER

export const BER_METHOD_IDS = [METHOD_ALGO_BER_BPSK] as const

/** Default Eb/N0 linear (power ratio). */
export const DEFAULT_EBN0 = 10 // ~10 dB class linear ≈ 10

/**
 * Complementary error function.
 * Prefer Math.erfc when available; otherwise Abramowitz–Stegun-class approx.
 * erfc(+∞)=0, erfc(−∞)=2, erfc(0)=1.
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x === Infinity) return 0
  if (x === -Infinity) return 2
  if (x === 0) return 1

  const mathErfc = (Math as unknown as { erfc?: (z: number) => number }).erfc
  if (typeof mathErfc === 'function') {
    return mathErfc(x)
  }
  // erfc(x) = 1 - erf(x); erf via A&S 7.1.26
  return 1 - erfApprox(x)
}

/** A&S 7.1.26 approximation of erf(x); max abs error ~1.5e-7. */
function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t
  const y = 1 - poly * Math.exp(-ax * ax)
  return sign * y
}

/**
 * Coherent BPSK bit-error probability (teaching):
 *   Pb = ½ · erfc(√(EbN0))
 *
 * EbN0: energy-per-bit over noise PSD (linear, not dB).
 * Requires EbN0 ≥ 0, finite; else NaN.
 * EbN0 = 0 ⇒ Pb = ½.
 */
export function berBpsk(EbN0: number): number {
  if (!Number.isFinite(EbN0) || !(EbN0 >= 0)) return NaN
  if (EbN0 === 0) return 0.5
  return 0.5 * erfc(Math.sqrt(EbN0))
}

/**
 * Convert Eb/N0 from dB to linear:
 *   lin = 10^(dB/10)
 */
export function ebN0FromDb(db: number): number {
  if (!Number.isFinite(db)) return NaN
  return 10 ** (db / 10)
}

/**
 * BPSK BER sample: Pb = ½ erfc√(EbN0); decreases with EbN0; EbN0=0 ⇒ 0.5.
 */
export function runBerBpskSample(opts?: {
  EbN0?: number
}): {
  EbN0: number
  Pb: number
  Pb_highSnr: number
  Pb_zero: number
  Pb_fromDb: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BER_BPSK
  familyId: typeof METHOD_BER
} {
  const EbN0 = opts?.EbN0 ?? DEFAULT_EBN0

  const Pb = berBpsk(EbN0)
  const Pb_highSnr = berBpsk(EbN0 * 4)
  const Pb_zero = berBpsk(0)
  // 10 dB ⇒ EbN0_lin = 10
  const Pb_fromDb = berBpsk(ebN0FromDb(10))

  const finite =
    Number.isFinite(Pb) &&
    Number.isFinite(Pb_highSnr) &&
    Number.isFinite(Pb_zero) &&
    Number.isFinite(Pb_fromDb)

  const expected = 0.5 * erfc(Math.sqrt(EbN0))
  const formulaOk =
    Math.abs(Pb - expected) < 1e-9 * Math.max(1e-30, Math.abs(Pb))
  const monoOk = Pb_highSnr < Pb
  const zeroOk = Math.abs(Pb_zero - 0.5) < 1e-12
  const rangeOk = Pb > 0 && Pb < 0.5
  const dbOk =
    Math.abs(Pb_fromDb - berBpsk(10)) <
    1e-9 * Math.max(1e-30, Math.abs(Pb_fromDb))

  const ok = finite && formulaOk && monoOk && zeroOk && rangeOk && dbOk

  return {
    EbN0,
    Pb,
    Pb_highSnr,
    Pb_zero,
    Pb_fromDb,
    finite,
    ok,
    methodId: METHOD_ALGO_BER_BPSK,
    familyId: METHOD_BER,
  }
}
