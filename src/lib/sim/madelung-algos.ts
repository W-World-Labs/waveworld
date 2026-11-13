/**
 * Madelung ionic lattice energy · pure teaching stubs.
 * U = − (N A k q²) / r0   teaching per-pair: U = −A k q² / r
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Madelung energy. */
export const METHOD_MADELUNG = 'method-madelung'

/** Algo · Madelung lattice / pair energy U. */
export const METHOD_ALGO_MADELUNG_U = 'method-algo-madelung-u'

/** Parent alias (aligns with familyId). */
export const MADELUNG_PARENT = METHOD_MADELUNG

export const MADELUNG_METHOD_IDS = [METHOD_ALGO_MADELUNG_U] as const

/** Coulomb constant k = 1/(4πε0) (N·m²/C²). */
export const K_COULOMB = 8.9875517923e9

/** Default Madelung constant A (NaCl-class ≈ 1.748). */
export const DEFAULT_A = 1.74756

/** Default ion charge magnitude q (C); elementary charge. */
export const DEFAULT_Q = 1.602176634e-19

/** Default nearest-neighbor distance r0 (m). */
export const DEFAULT_R0 = 2.82e-10

/** Default formula-unit count N (per-pair teaching N=1). */
export const DEFAULT_N = 1

/**
 * Madelung lattice energy (J) teaching form:
 *   U = − (N · A · k · q²) / r0
 *
 * Per pair (N=1): U = − A k q² / r.
 * A: Madelung constant, k: Coulomb constant, q: ion charge,
 * r0: nearest-neighbor distance (m), N: number of formula units.
 * Requires A,k,q finite, r0>0, N finite; else NaN.
 */
export function madelungU(
  A: number,
  r0: number,
  q: number = DEFAULT_Q,
  N: number = DEFAULT_N,
  k: number = K_COULOMB,
): number {
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(r0) ||
    !Number.isFinite(q) ||
    !Number.isFinite(N) ||
    !Number.isFinite(k) ||
    !(r0 > 0)
  ) {
    return NaN
  }
  return -((N * A * k * q * q) / r0)
}

/**
 * Madelung sample: U = −N A k q²/r0; deeper (smaller r) more negative; r≤0 illegal.
 */
export function runMadelungUSample(opts?: {
  A?: number
  r0?: number
  q?: number
  N?: number
}): {
  A: number
  r0: number
  q: number
  N: number
  U: number
  U_doubleR: number
  U_doubleA: number
  U_badR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MADELUNG_U
  familyId: typeof METHOD_MADELUNG
} {
  const A = opts?.A ?? DEFAULT_A
  const r0 = opts?.r0 ?? DEFAULT_R0
  const q = opts?.q ?? DEFAULT_Q
  const N = opts?.N ?? DEFAULT_N

  const U = madelungU(A, r0, q, N)
  const U_doubleR = madelungU(A, 2 * r0, q, N)
  const U_doubleA = madelungU(2 * A, r0, q, N)
  const U_badR = madelungU(A, 0, q, N)

  const finite =
    Number.isFinite(U) &&
    Number.isFinite(U_doubleR) &&
    Number.isFinite(U_doubleA)

  const expected = -((N * A * K_COULOMB * q * q) / r0)
  const formulaOk =
    Math.abs(U - expected) < 1e-12 * Math.max(1e-30, Math.abs(U))
  // larger r ⇒ |U| half ⇒ U_doubleR = U/2 (both negative)
  const halfROk =
    Math.abs(U_doubleR - U / 2) < 1e-12 * Math.max(1e-30, Math.abs(U))
  const linAOk =
    Math.abs(U_doubleA - 2 * U) < 1e-12 * Math.max(1e-30, Math.abs(U))
  const badOk = !Number.isFinite(U_badR)
  const boundOk = A > 0 && q !== 0 ? U < 0 : true

  const ok = finite && formulaOk && halfROk && linAOk && badOk && boundOk

  return {
    A,
    r0,
    q,
    N,
    U,
    U_doubleR,
    U_doubleA,
    U_badR,
    finite,
    ok,
    methodId: METHOD_ALGO_MADELUNG_U,
    familyId: METHOD_MADELUNG,
  }
}
