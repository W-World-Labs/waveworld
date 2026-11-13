/**
 * Root-locus damping (2nd-order mass–spring–damper) · pure teaching stubs.
 * ζ = c / (2 √(k m))
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · root locus / damping analysis. */
export const METHOD_ROOT_LOCUS = 'method-root-locus'

/** Algo · damping ratio ζ for 2nd-order MSD. */
export const METHOD_ALGO_DAMPING_ZETA = 'method-algo-damping-zeta'

/** Parent alias (aligns with familyId). */
export const ROOT_LOCUS_PARENT = METHOD_ROOT_LOCUS

export const ROOT_LOCUS_METHOD_IDS = [METHOD_ALGO_DAMPING_ZETA] as const

/** Default damping coefficient c (N·s/m). */
export const DEFAULT_C = 2

/** Default spring constant k (N/m). */
export const DEFAULT_K = 100

/** Default mass m (kg). */
export const DEFAULT_M = 1

/**
 * Viscous damping ratio for mass–spring–damper:
 *   ζ = c / (2 √(k m))
 *
 * Underdamped ζ<1, critically damped ζ=1, overdamped ζ>1.
 * Requires c finite, k>0, m>0; else NaN.
 */
export function dampingZeta(c: number, k: number, m: number): number {
  if (
    !Number.isFinite(c) ||
    !Number.isFinite(k) ||
    !Number.isFinite(m) ||
    !(k > 0) ||
    !(m > 0)
  ) {
    return NaN
  }
  return c / (2 * Math.sqrt(k * m))
}

/**
 * Damping-ζ sample: ζ = c/(2√(km)); linear in c; k,m≤0 illegal.
 */
export function runDampingZetaSample(opts?: {
  c?: number
  k?: number
  m?: number
}): {
  c: number
  k: number
  m: number
  zeta: number
  zeta_doubleC: number
  zeta_doubleK: number
  zeta_badK: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DAMPING_ZETA
  familyId: typeof METHOD_ROOT_LOCUS
} {
  const c = opts?.c ?? DEFAULT_C
  const k = opts?.k ?? DEFAULT_K
  const m = opts?.m ?? DEFAULT_M

  const zeta = dampingZeta(c, k, m)
  const zeta_doubleC = dampingZeta(2 * c, k, m)
  const zeta_doubleK = dampingZeta(c, 2 * k, m)
  const zeta_badK = dampingZeta(c, 0, m)

  const finite =
    Number.isFinite(zeta) &&
    Number.isFinite(zeta_doubleC) &&
    Number.isFinite(zeta_doubleK)

  const expected = c / (2 * Math.sqrt(k * m))
  const formulaOk =
    Math.abs(zeta - expected) < 1e-12 * Math.max(1e-30, Math.abs(zeta))
  const linCOk =
    Math.abs(zeta_doubleC - 2 * zeta) <
    1e-12 * Math.max(1e-30, Math.abs(zeta))
  const halfSqrtKOk =
    Math.abs(zeta_doubleK - zeta / Math.SQRT2) <
    1e-12 * Math.max(1e-30, Math.abs(zeta))
  const badOk = !Number.isFinite(zeta_badK)
  const positiveOk = c > 0 ? zeta > 0 : true

  const ok =
    finite && formulaOk && linCOk && halfSqrtKOk && badOk && positiveOk

  return {
    c,
    k,
    m,
    zeta,
    zeta_doubleC,
    zeta_doubleK,
    zeta_badK,
    finite,
    ok,
    methodId: METHOD_ALGO_DAMPING_ZETA,
    familyId: METHOD_ROOT_LOCUS,
  }
}
