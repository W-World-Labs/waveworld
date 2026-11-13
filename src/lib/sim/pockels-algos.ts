/**
 * Pockels (linear electro-optic) effect · pure teaching stub.
 * Δn = (1/2) n³ r E.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Pockels effect. */
export const METHOD_POCKELS = 'method-pockels'

/** Algo · refractive index shift Δn = ½ n³ r E. */
export const METHOD_ALGO_POCKELS_DN = 'method-algo-pockels-dn'

/** Parent alias (aligns with familyId). */
export const POCKELS_PARENT = METHOD_POCKELS

export const POCKELS_METHOD_IDS = [METHOD_ALGO_POCKELS_DN] as const

/** Default refractive index n (LiNbO3-class toy). */
export const DEFAULT_N = 2.2

/** Default EO coefficient r (m/V teaching); ~30 pm/V. */
export const DEFAULT_R = 30e-12

/** Default electric field E (V/m). */
export const DEFAULT_E = 1e6

/**
 * Pockels refractive-index change:
 *   Δn = 0.5 · n³ · r · E
 *
 * n: refractive index (>0), r: EO coefficient (m/V), E: field (V/m).
 * Linear (odd) in E; non-finite or n≤0 → NaN.
 */
export function pockelsDn(n: number, r: number, E: number): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(r) ||
    !Number.isFinite(E) ||
    !(n > 0)
  ) {
    return NaN
  }
  return 0.5 * n * n * n * r * E
}

/**
 * Pockels sample: n=2.2, r=30 pm/V, E=1e6 → small Δn;
 * linear in E; antisym under E reverse.
 */
export function runPockelsDnSample(opts?: {
  n?: number
  r?: number
  E?: number
}): {
  n: number
  r: number
  E: number
  dn: number
  dn_doubleE: number
  dn_negE: number
  dn_zeroE: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_POCKELS_DN
  familyId: typeof METHOD_POCKELS
} {
  const n = opts?.n ?? DEFAULT_N
  const r = opts?.r ?? DEFAULT_R
  const E = opts?.E ?? DEFAULT_E

  const dn = pockelsDn(n, r, E)
  const dn_doubleE = pockelsDn(n, r, 2 * E)
  const dn_negE = pockelsDn(n, r, -E)
  const dn_zeroE = pockelsDn(n, r, 0)

  const finite =
    Number.isFinite(dn) &&
    Number.isFinite(dn_doubleE) &&
    Number.isFinite(dn_negE) &&
    Number.isFinite(dn_zeroE)

  const expected = 0.5 * n * n * n * r * E
  const formulaOk =
    Math.abs(dn - expected) < 1e-18 * Math.max(1, Math.abs(dn))
  const linE =
    Math.abs(dn_doubleE - 2 * dn) < 1e-18 * Math.max(1, Math.abs(dn))
  const antisym =
    Math.abs(dn_negE + dn) < 1e-18 * Math.max(1, Math.abs(dn))
  const zeroOk = Math.abs(dn_zeroE) < 1e-30

  const ok = finite && formulaOk && linE && antisym && zeroOk

  return {
    n,
    r,
    E,
    dn,
    dn_doubleE,
    dn_negE,
    dn_zeroE,
    finite,
    ok,
    methodId: METHOD_ALGO_POCKELS_DN,
    familyId: METHOD_POCKELS,
  }
}
