/**
 * Varshni bandgap temperature law · pure teaching stubs.
 * Eg(T) = Eg0 − a T² / (T + b)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Varshni equation. */
export const METHOD_VARSHNI = 'method-varshni'

/** Algo · bandgap Eg(T) via Varshni. */
export const METHOD_ALGO_VARSHNI_EG = 'method-algo-varshni-eg'

/** Parent alias (aligns with familyId). */
export const VARSHNI_PARENT = METHOD_VARSHNI

export const VARSHNI_METHOD_IDS = [METHOD_ALGO_VARSHNI_EG] as const

/** Default zero-K gap Eg0 (eV); Si-class toy. */
export const DEFAULT_EG0 = 1.17

/** Default Varshni a (eV/K). */
export const DEFAULT_A = 4.73e-4

/** Default Varshni b (K). */
export const DEFAULT_B = 636

/** Default temperature T (K). */
export const DEFAULT_T = 300

/**
 * Varshni temperature-dependent bandgap (eV):
 *   Eg(T) = Eg0 − a · T² / (T + b)
 *
 * Eg0: gap at T=0 (eV), a,b: Varshni parameters, T: temperature (K).
 * Requires T≥0, (T+b)≠0, finite; else NaN.
 */
export function varshniEg(
  Eg0: number,
  a: number,
  b: number,
  T: number,
): number {
  if (
    !Number.isFinite(Eg0) ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(T) ||
    !(T >= 0) ||
    T + b === 0
  ) {
    return NaN
  }
  return Eg0 - (a * T * T) / (T + b)
}

/**
 * Varshni sample: Eg decreases with T; Eg(0)=Eg0.
 */
export function runVarshniEgSample(opts?: {
  Eg0?: number
  a?: number
  b?: number
  T?: number
}): {
  Eg0: number
  a: number
  b: number
  T: number
  Eg: number
  Eg_zero: number
  Eg_hot: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VARSHNI_EG
  familyId: typeof METHOD_VARSHNI
} {
  const Eg0 = opts?.Eg0 ?? DEFAULT_EG0
  const a = opts?.a ?? DEFAULT_A
  const b = opts?.b ?? DEFAULT_B
  const T = opts?.T ?? DEFAULT_T

  const Eg = varshniEg(Eg0, a, b, T)
  const Eg_zero = varshniEg(Eg0, a, b, 0)
  const Eg_hot = varshniEg(Eg0, a, b, 2 * T)

  const finite =
    Number.isFinite(Eg) && Number.isFinite(Eg_zero) && Number.isFinite(Eg_hot)

  const expected = Eg0 - (a * T * T) / (T + b)
  const formulaOk =
    Math.abs(Eg - expected) < 1e-12 * Math.max(1, Math.abs(Eg))
  const zeroOk = Math.abs(Eg_zero - Eg0) < 1e-18
  const shrinkOk = Eg < Eg0 && Eg_hot < Eg
  const positiveOk = Eg > 0

  const ok = finite && formulaOk && zeroOk && shrinkOk && positiveOk

  return {
    Eg0,
    a,
    b,
    T,
    Eg,
    Eg_zero,
    Eg_hot,
    finite,
    ok,
    methodId: METHOD_ALGO_VARSHNI_EG,
    familyId: METHOD_VARSHNI,
  }
}
