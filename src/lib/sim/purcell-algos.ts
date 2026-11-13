/**
 * Purcell factor · pure teaching stubs.
 * F_p = (3 Q λ³) / (4 π² V)   (n=1 simplified; full: ·(λ/n)³)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Purcell enhancement. */
export const METHOD_PURCELL = 'method-purcell-factor'

/** Algo · Purcell factor F_p. */
export const METHOD_ALGO_PURCELL_F = 'method-algo-purcell-f'

/** Parent alias (aligns with familyId). */
export const PURCELL_PARENT = METHOD_PURCELL

export const PURCELL_METHOD_IDS = [METHOD_ALGO_PURCELL_F] as const

/** Default cavity Q. */
export const DEFAULT_Q = 1e4

/** Default mode volume V (m³ teaching). */
export const DEFAULT_V = 1e-18

/** Default wavelength λ (m). */
export const DEFAULT_LAMBDA = 1e-6

/**
 * Simplified Purcell factor (n=1, emitter on resonance, peak):
 *   F_p = (3 / (4 π²)) · (Q / V) · λ³
 *       = (3 Q λ³) / (4 π² V)
 *
 * Full form uses (λ/n)³; here n=1 teaching stub.
 * Requires Q finite, V>0, λ finite; else NaN.
 */
export function purcellFactor(
  Q: number,
  V: number,
  lambda: number,
): number {
  if (
    !Number.isFinite(Q) ||
    !Number.isFinite(V) ||
    !Number.isFinite(lambda) ||
    !(V > 0)
  ) {
    return NaN
  }
  return (3 * Q * lambda ** 3) / (4 * Math.PI ** 2 * V)
}

/**
 * Purcell sample: F_p formula; ∝ Q, 1/V, λ³; V≤0 illegal.
 */
export function runPurcellFSample(opts?: {
  Q?: number
  V?: number
  lambda?: number
}): {
  Q: number
  V: number
  lambda: number
  Fp: number
  Fp_doubleQ: number
  Fp_doubleV: number
  Fp_badV: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PURCELL_F
  familyId: typeof METHOD_PURCELL
} {
  const Q = opts?.Q ?? DEFAULT_Q
  const V = opts?.V ?? DEFAULT_V
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA

  const Fp = purcellFactor(Q, V, lambda)
  const Fp_doubleQ = purcellFactor(2 * Q, V, lambda)
  const Fp_doubleV = purcellFactor(Q, 2 * V, lambda)
  const Fp_badV = purcellFactor(Q, 0, lambda)

  const finite =
    Number.isFinite(Fp) &&
    Number.isFinite(Fp_doubleQ) &&
    Number.isFinite(Fp_doubleV)

  const expected = (3 * Q * lambda ** 3) / (4 * Math.PI ** 2 * V)
  const formulaOk =
    Math.abs(Fp - expected) < 1e-12 * Math.max(1e-30, Math.abs(Fp))
  const linQOk =
    Math.abs(Fp_doubleQ - 2 * Fp) < 1e-12 * Math.max(1e-30, Math.abs(Fp))
  const halfVOk =
    Math.abs(Fp_doubleV - Fp / 2) < 1e-12 * Math.max(1e-30, Math.abs(Fp))
  const badOk = !Number.isFinite(Fp_badV)
  const positiveOk = Q > 0 && lambda !== 0 ? Fp > 0 : true

  const ok = finite && formulaOk && linQOk && halfVOk && badOk && positiveOk

  return {
    Q,
    V,
    lambda,
    Fp,
    Fp_doubleQ,
    Fp_doubleV,
    Fp_badV,
    finite,
    ok,
    methodId: METHOD_ALGO_PURCELL_F,
    familyId: METHOD_PURCELL,
  }
}
