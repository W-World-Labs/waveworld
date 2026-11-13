/**
 * Routh–Hurwitz stability · pure teaching stubs.
 * 2nd order s² + a s + b: stable iff a>0, b>0.
 * 3rd order s³ + a s² + b s + c: a>0, c>0, a·b>c.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Routh–Hurwitz criterion. */
export const METHOD_ROUTH = 'method-routh-hurwitz'

/** Algo · 2nd-order Routh stability (with 3rd-order companion). */
export const METHOD_ALGO_ROUTH_STABLE = 'method-algo-routh-stable-2'

/** Parent alias (aligns with familyId). */
export const ROUTH_PARENT = METHOD_ROUTH

export const ROUTH_METHOD_IDS = [METHOD_ALGO_ROUTH_STABLE] as const

/** Default 2nd-order coefficients a, b for s² + a s + b. */
export const DEFAULT_A2 = 2
export const DEFAULT_B2 = 5

/** Default 3rd-order coefficients a, b, c for s³ + a s² + b s + c. */
export const DEFAULT_A3 = 6
export const DEFAULT_B3 = 11
export const DEFAULT_C3 = 6

/**
 * Strict Routh–Hurwitz for monic 2nd order:
 *   s² + a s + b   stable  ⇔  a > 0 and b > 0
 *
 * Non-finite a or b → false (not stable).
 */
export function routhStable2(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return a > 0 && b > 0
}

/**
 * Strict Routh–Hurwitz for monic 3rd order:
 *   s³ + a s² + b s + c   stable  ⇔  a>0, c>0, a·b > c
 *
 * (Implies b>0 when a,c>0 and a·b>c for real positive roots of RH.)
 * Non-finite coefficients → false.
 */
export function routhStable3(a: number, b: number, c: number): boolean {
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c)
  ) {
    return false
  }
  return a > 0 && c > 0 && a * b > c
}

/**
 * Routh sample: 2nd-order stable defaults; 3rd-order stable;
 * known unstable counterexamples.
 */
export function runRouthStable2Sample(opts?: {
  a2?: number
  b2?: number
  a3?: number
  b3?: number
  c3?: number
}): {
  a2: number
  b2: number
  a3: number
  b3: number
  c3: number
  stable2: boolean
  stable2_badA: boolean
  stable2_badB: boolean
  stable3: boolean
  stable3_bad: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ROUTH_STABLE
  familyId: typeof METHOD_ROUTH
} {
  const a2 = opts?.a2 ?? DEFAULT_A2
  const b2 = opts?.b2 ?? DEFAULT_B2
  const a3 = opts?.a3 ?? DEFAULT_A3
  const b3 = opts?.b3 ?? DEFAULT_B3
  const c3 = opts?.c3 ?? DEFAULT_C3

  const stable2 = routhStable2(a2, b2)
  const stable2_badA = routhStable2(-1, b2)
  const stable2_badB = routhStable2(a2, -1)
  const stable3 = routhStable3(a3, b3, c3)
  // a*b = c ⇒ not strictly stable
  const stable3_bad = routhStable3(2, 3, 6)

  const finite =
    Number.isFinite(a2) &&
    Number.isFinite(b2) &&
    Number.isFinite(a3) &&
    Number.isFinite(b3) &&
    Number.isFinite(c3)

  const ok2 = stable2 === true && stable2_badA === false && stable2_badB === false
  const ok3 = stable3 === true && stable3_bad === false
  const cond3 =
    a3 > 0 && c3 > 0 && a3 * b3 > c3

  const ok = finite && ok2 && ok3 && cond3

  return {
    a2,
    b2,
    a3,
    b3,
    c3,
    stable2,
    stable2_badA,
    stable2_badB,
    stable3,
    stable3_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_ROUTH_STABLE,
    familyId: METHOD_ROUTH,
  }
}
