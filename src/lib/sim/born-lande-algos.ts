/**
 * Born–Landé lattice energy · pure teaching stubs.
 * U = − (N · A · e²) / (4π ε0 r0) · (1 − 1/n)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Born–Landé energy. */
export const METHOD_BORN_LANDE = 'method-born-lande'

/** Algo · Born–Landé lattice energy U. */
export const METHOD_ALGO_BORN_LANDE_U = 'method-algo-born-lande-u'

/** Parent alias (aligns with familyId). */
export const BORN_LANDE_PARENT = METHOD_BORN_LANDE

export const BORN_LANDE_METHOD_IDS = [METHOD_ALGO_BORN_LANDE_U] as const

/** Vacuum permittivity ε0 (F/m). */
export const EPS0 = 8.854187817e-12

/** Elementary charge e (C). */
export const E_CHARGE = 1.602176634e-19

/** Default Madelung constant A (NaCl-class). */
export const DEFAULT_A = 1.74756

/** Default nearest-neighbor distance r0 (m). */
export const DEFAULT_R0 = 2.82e-10

/** Default Born exponent n (dimensionless, typically 5–12). */
export const DEFAULT_N_BORN = 9

/** Default formula-unit count N. */
export const DEFAULT_N = 1

/**
 * Born–Landé ionic lattice energy (J):
 *   U = − (N · A · e²) / (4π ε0 r0) · (1 − 1/n)
 *
 * N: formula units, A: Madelung constant, e: elementary charge,
 * r0: nearest-neighbor distance (m), n: Born exponent (>1),
 * eps0: vacuum permittivity.
 * Requires r0>0, n>1, finite; else NaN.
 */
export function bornLandeU(
  A: number,
  r0: number,
  n: number,
  N: number = DEFAULT_N,
  e: number = E_CHARGE,
  eps0: number = EPS0,
): number {
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(r0) ||
    !Number.isFinite(n) ||
    !Number.isFinite(N) ||
    !Number.isFinite(e) ||
    !Number.isFinite(eps0) ||
    !(r0 > 0) ||
    !(n > 1) ||
    !(eps0 > 0)
  ) {
    return NaN
  }
  const coulomb = (N * A * e * e) / (4 * Math.PI * eps0 * r0)
  return -coulomb * (1 - 1 / n)
}

/**
 * Born–Landé sample: U formula; n→∞ ⇒ pure Coulomb; r≤0 or n≤1 illegal.
 */
export function runBornLandeUSample(opts?: {
  A?: number
  r0?: number
  n?: number
  N?: number
}): {
  A: number
  r0: number
  n: number
  N: number
  U: number
  U_doubleR: number
  U_largeN: number
  U_badR: number
  U_badN: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BORN_LANDE_U
  familyId: typeof METHOD_BORN_LANDE
} {
  const A = opts?.A ?? DEFAULT_A
  const r0 = opts?.r0 ?? DEFAULT_R0
  const n = opts?.n ?? DEFAULT_N_BORN
  const N = opts?.N ?? DEFAULT_N

  const U = bornLandeU(A, r0, n, N)
  const U_doubleR = bornLandeU(A, 2 * r0, n, N)
  const U_largeN = bornLandeU(A, r0, 1e6, N)
  const U_badR = bornLandeU(A, 0, n, N)
  const U_badN = bornLandeU(A, r0, 1, N)

  const finite =
    Number.isFinite(U) &&
    Number.isFinite(U_doubleR) &&
    Number.isFinite(U_largeN)

  const coulomb = (N * A * E_CHARGE * E_CHARGE) / (4 * Math.PI * EPS0 * r0)
  const expected = -coulomb * (1 - 1 / n)
  const formulaOk =
    Math.abs(U - expected) < 1e-12 * Math.max(1e-30, Math.abs(U))
  // double r0 ⇒ half |U|
  const doubleROk =
    Math.abs(U_doubleR - U / 2) < 1e-12 * Math.max(1e-30, Math.abs(U))
  // large n ⇒ approaches −coulomb
  const largeNOk =
    Math.abs(U_largeN - -coulomb) < 1e-5 * Math.max(1e-30, Math.abs(coulomb))
  const negOk = U < 0
  const badROk = !Number.isFinite(U_badR)
  const badNOk = !Number.isFinite(U_badN)

  const ok =
    finite &&
    formulaOk &&
    doubleROk &&
    largeNOk &&
    negOk &&
    badROk &&
    badNOk

  return {
    A,
    r0,
    n,
    N,
    U,
    U_doubleR,
    U_largeN,
    U_badR,
    U_badN,
    finite,
    ok,
    methodId: METHOD_ALGO_BORN_LANDE_U,
    familyId: METHOD_BORN_LANDE,
  }
}
