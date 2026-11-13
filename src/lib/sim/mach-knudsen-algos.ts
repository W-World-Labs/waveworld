/**
 * Mach & Knudsen numbers · pure teaching stubs.
 * M = U / a ;  Kn = λ / L
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Mach number. */
export const METHOD_MACH = 'method-mach-number'

/** Algo · M = U / a. */
export const METHOD_ALGO_MACH = 'method-algo-mach'

/** Family · Knudsen number. */
export const METHOD_KN = 'method-knudsen-number'

/** Algo · Kn = λ / L. */
export const METHOD_ALGO_KN = 'method-algo-knudsen'

/** Parent aliases. */
export const MACH_PARENT = METHOD_MACH
export const KN_PARENT = METHOD_KN

export const MACH_METHOD_IDS = [METHOD_ALGO_MACH] as const
export const KN_METHOD_IDS = [METHOD_ALGO_KN] as const

/** Default free-stream speed U (m/s). */
export const DEFAULT_U = 100

/** Default sound speed a (m/s) — air ~340. */
export const DEFAULT_A = 340

/** Default mean free path λ (m). */
export const DEFAULT_LAMBDA = 6.5e-8

/** Default characteristic length L (m). */
export const DEFAULT_L = 1e-3

/**
 * Mach number (dimensionless):
 *   M = U / a
 *
 * U: flow speed (m/s), a: sound speed (m/s).
 * Requires finite inputs and a>0; else NaN.
 */
export function machNumber(U: number, a: number): number {
  if (!Number.isFinite(U) || !Number.isFinite(a) || !(a > 0)) {
    return NaN
  }
  return U / a
}

/**
 * Knudsen number (dimensionless):
 *   Kn = λ / L
 *
 * lambda: mean free path (m), L: characteristic length (m).
 * Requires finite inputs and L>0; else NaN.
 */
export function knudsenNumber(lambda: number, L: number): number {
  if (!Number.isFinite(lambda) || !Number.isFinite(L) || !(L > 0)) {
    return NaN
  }
  return lambda / L
}

/**
 * Mach sample: M = U/a; ∝ U; ∝ 1/a; a≤0 illegal.
 */
export function runMachSample(opts?: {
  U?: number
  a?: number
}): {
  U: number
  a: number
  M: number
  M_doubleU: number
  M_halfA: number
  M_badA: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MACH
  familyId: typeof METHOD_MACH
} {
  const U = opts?.U ?? DEFAULT_U
  const a = opts?.a ?? DEFAULT_A

  const M = machNumber(U, a)
  const M_doubleU = machNumber(2 * U, a)
  const M_halfA = machNumber(U, a / 2)
  const M_badA = machNumber(U, 0)

  const finite =
    Number.isFinite(M) &&
    Number.isFinite(M_doubleU) &&
    Number.isFinite(M_halfA)

  const expected = U / a
  const formulaOk =
    Math.abs(M - expected) < 1e-12 * Math.max(1, Math.abs(M))
  const linUOk =
    Math.abs(M_doubleU - 2 * M) < 1e-12 * Math.max(1, Math.abs(M))
  const halfAOk =
    Math.abs(M_halfA - 2 * M) < 1e-12 * Math.max(1, Math.abs(M))
  const badOk = !Number.isFinite(M_badA)
  const positiveOk = M > 0

  const ok = finite && formulaOk && linUOk && halfAOk && badOk && positiveOk

  return {
    U,
    a,
    M,
    M_doubleU,
    M_halfA,
    M_badA,
    finite,
    ok,
    methodId: METHOD_ALGO_MACH,
    familyId: METHOD_MACH,
  }
}

/**
 * Knudsen sample: Kn = λ/L; ∝ λ; ∝ 1/L; L≤0 illegal.
 */
export function runKnudsenSample(opts?: {
  lambda?: number
  L?: number
}): {
  lambda: number
  L: number
  Kn: number
  Kn_doubleLambda: number
  Kn_halfL: number
  Kn_badL: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_KN
  familyId: typeof METHOD_KN
} {
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const L = opts?.L ?? DEFAULT_L

  const Kn = knudsenNumber(lambda, L)
  const Kn_doubleLambda = knudsenNumber(2 * lambda, L)
  const Kn_halfL = knudsenNumber(lambda, L / 2)
  const Kn_badL = knudsenNumber(lambda, 0)

  const finite =
    Number.isFinite(Kn) &&
    Number.isFinite(Kn_doubleLambda) &&
    Number.isFinite(Kn_halfL)

  const expected = lambda / L
  const formulaOk =
    Math.abs(Kn - expected) < 1e-12 * Math.max(1e-30, Math.abs(Kn))
  const linLambdaOk =
    Math.abs(Kn_doubleLambda - 2 * Kn) <
    1e-12 * Math.max(1e-30, Math.abs(Kn))
  const halfLOk =
    Math.abs(Kn_halfL - 2 * Kn) < 1e-12 * Math.max(1e-30, Math.abs(Kn))
  const badOk = !Number.isFinite(Kn_badL)
  const positiveOk = Kn > 0

  const ok =
    finite && formulaOk && linLambdaOk && halfLOk && badOk && positiveOk

  return {
    lambda,
    L,
    Kn,
    Kn_doubleLambda,
    Kn_halfL,
    Kn_badL,
    finite,
    ok,
    methodId: METHOD_ALGO_KN,
    familyId: METHOD_KN,
  }
}
