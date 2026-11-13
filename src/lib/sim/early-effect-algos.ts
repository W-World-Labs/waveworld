/**
 * Early effect (BJT base-width modulation) · pure teaching stubs.
 * Ic = Ic0 · (1 + Vce / Va)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Early effect. */
export const METHOD_EARLY = 'method-early-effect'

/** Algo · Early voltage collector current model. */
export const METHOD_ALGO_EARLY_VA = 'method-algo-early-va'

/** Parent alias (aligns with familyId). */
export const EARLY_PARENT = METHOD_EARLY

export const EARLY_METHOD_IDS = [METHOD_ALGO_EARLY_VA] as const

/** Default zero-Vce intercept current Ic0 (A). */
export const DEFAULT_IC0 = 1e-3

/** Default collector–emitter voltage Vce (V). */
export const DEFAULT_VCE = 5

/** Default Early voltage Va (V). */
export const DEFAULT_VA = 50

/**
 * Early-effect collector current (A):
 *   Ic = Ic0 · (1 + Vce / Va)
 *
 * Ic0: current at Vce=0 intercept (A), Vce: C–E voltage (V),
 * Va: Early voltage (V). Requires Va≠0, finite; else NaN.
 */
export function earlyIc(Ic0: number, Vce: number, Va: number): number {
  if (
    !Number.isFinite(Ic0) ||
    !Number.isFinite(Vce) ||
    !Number.isFinite(Va) ||
    Va === 0
  ) {
    return NaN
  }
  return Ic0 * (1 + Vce / Va)
}

/**
 * Early sample: Ic = Ic0(1+Vce/Va); Vce=0 ⇒ Ic0; ∝ Ic0.
 */
export function runEarlyVaSample(opts?: {
  Ic0?: number
  Vce?: number
  Va?: number
}): {
  Ic0: number
  Vce: number
  Va: number
  Ic: number
  Ic_zeroVce: number
  Ic_doubleIc0: number
  Ic_badVa: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_EARLY_VA
  familyId: typeof METHOD_EARLY
} {
  const Ic0 = opts?.Ic0 ?? DEFAULT_IC0
  const Vce = opts?.Vce ?? DEFAULT_VCE
  const Va = opts?.Va ?? DEFAULT_VA

  const Ic = earlyIc(Ic0, Vce, Va)
  const Ic_zeroVce = earlyIc(Ic0, 0, Va)
  const Ic_doubleIc0 = earlyIc(2 * Ic0, Vce, Va)
  const Ic_badVa = earlyIc(Ic0, Vce, 0)

  const finite =
    Number.isFinite(Ic) &&
    Number.isFinite(Ic_zeroVce) &&
    Number.isFinite(Ic_doubleIc0)

  const expected = Ic0 * (1 + Vce / Va)
  const formulaOk =
    Math.abs(Ic - expected) < 1e-12 * Math.max(1e-30, Math.abs(Ic))
  const zeroOk =
    Math.abs(Ic_zeroVce - Ic0) < 1e-18 * Math.max(1, Math.abs(Ic0))
  const linOk =
    Math.abs(Ic_doubleIc0 - 2 * Ic) < 1e-12 * Math.max(1e-30, Math.abs(Ic))
  const badOk = !Number.isFinite(Ic_badVa)
  const boostOk = Vce > 0 && Va > 0 ? Ic > Ic0 : true

  const ok = finite && formulaOk && zeroOk && linOk && badOk && boostOk

  return {
    Ic0,
    Vce,
    Va,
    Ic,
    Ic_zeroVce,
    Ic_doubleIc0,
    Ic_badVa,
    finite,
    ok,
    methodId: METHOD_ALGO_EARLY_VA,
    familyId: METHOD_EARLY,
  }
}
