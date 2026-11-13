/**
 * Josephson voltage–frequency relation · pure teaching stubs.
 * f = V / Φ₀ with Φ₀ = 2.067833848e-15 Wb  (or f = 2 e V / h).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Josephson effect. */
export const METHOD_JOSEPHSON = 'method-josephson'

/** Algo · Josephson frequency f = V / Φ₀. */
export const METHOD_ALGO_JOSEPHSON_F = 'method-algo-josephson-freq'

/** Parent alias. */
export const JOSEPHSON_PARENT = METHOD_JOSEPHSON

export const JOSEPHSON_METHOD_IDS = [METHOD_ALGO_JOSEPHSON_F] as const

/** Magnetic flux quantum Φ₀ (Wb = V·s). */
export const PHI0 = 2.067833848e-15

/** Elementary charge e (C). */
export const E_CHARGE = 1.602176634e-19

/** Planck constant h (J·s). */
export const H_PLANCK = 6.62607015e-34

/** Default voltage V (V) — 1 mV class. */
export const DEFAULT_V = 1e-3

/**
 * Josephson frequency (Hz) from bias voltage:
 *   f = V / Φ₀
 *
 * Requires finite V, Φ₀>0; uses |V| for magnitude.
 * V=0 ⇒ f=0.
 */
export function josephsonFreq(V: number, phi0: number = PHI0): number {
  if (!Number.isFinite(V) || !Number.isFinite(phi0) || !(phi0 > 0)) {
    return NaN
  }
  return Math.abs(V) / phi0
}

/**
 * Equivalent form f = 2 e V / h.
 */
export function josephsonFreqFromEH(
  V: number,
  e: number = E_CHARGE,
  h: number = H_PLANCK,
): number {
  if (
    !Number.isFinite(V) ||
    !Number.isFinite(e) ||
    !Number.isFinite(h) ||
    !(e > 0) ||
    !(h > 0)
  ) {
    return NaN
  }
  return (2 * e * Math.abs(V)) / h
}

/**
 * Josephson sample: f = V/Φ₀; linear in V; agrees with 2eV/h; V=0 ⇒ 0.
 */
export function runJosephsonFreqSample(opts?: {
  V?: number
  phi0?: number
}): {
  V: number
  phi0: number
  f: number
  f_doubleV: number
  f_zero: number
  f_eh: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_JOSEPHSON_F
  familyId: typeof METHOD_JOSEPHSON
} {
  const V = opts?.V ?? DEFAULT_V
  const phi0 = opts?.phi0 ?? PHI0

  const f = josephsonFreq(V, phi0)
  const f_doubleV = josephsonFreq(2 * V, phi0)
  const f_zero = josephsonFreq(0, phi0)
  const f_eh = josephsonFreqFromEH(V)

  const finite =
    Number.isFinite(f) &&
    Number.isFinite(f_doubleV) &&
    Number.isFinite(f_zero) &&
    Number.isFinite(f_eh)

  const expected = Math.abs(V) / phi0
  const formulaOk =
    Math.abs(f - expected) < 1e-12 * Math.max(1e-30, Math.abs(f))
  const linOk =
    Math.abs(f_doubleV - 2 * f) < 1e-12 * Math.max(1e-30, Math.abs(f))
  const zeroOk = Math.abs(f_zero) < 1e-30
  // Φ₀ = h/(2e) ⇒ 1/Φ₀ = 2e/h; relative agreement to CODATA consistency
  const ehOk =
    Math.abs(f_eh - f) / Math.max(f, 1e-30) < 1e-6
  const positiveOk = f > 0
  const badOk = !Number.isFinite(josephsonFreq(NaN))

  const ok =
    finite && formulaOk && linOk && zeroOk && ehOk && positiveOk && badOk

  return {
    V,
    phi0,
    f,
    f_doubleV,
    f_zero,
    f_eh,
    finite,
    ok,
    methodId: METHOD_ALGO_JOSEPHSON_F,
    familyId: METHOD_JOSEPHSON,
  }
}
