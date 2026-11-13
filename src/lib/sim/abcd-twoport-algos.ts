/**
 * ABCD two-port (transmission) matrix · pure teaching stubs.
 * Series impedance Z: A=1, B=Z, C=0, D=1; cascade = matrix multiply.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · ABCD two-port. */
export const METHOD_ABCD = 'method-abcd-twoport'

/** Algo · series-Z ABCD matrix. */
export const METHOD_ALGO_ABCD_SERIES_Z = 'method-algo-abcd-series-z'

/** Parent alias (aligns with familyId). */
export const ABCD_PARENT = METHOD_ABCD

export const ABCD_METHOD_IDS = [METHOD_ALGO_ABCD_SERIES_Z] as const

/** Default series impedance Z (Ω, real teaching). */
export const DEFAULT_Z = 50

/** ABCD matrix as flat [A, B, C, D]. */
export type Abcd = { A: number; B: number; C: number; D: number }

/**
 * Series impedance Z two-port:
 *   [ A B ]   [ 1  Z ]
 *   [ C D ] = [ 0  1 ]
 *
 * Non-finite Z → NaN entries.
 */
export function abcdSeriesZ(Z: number): Abcd {
  if (!Number.isFinite(Z)) {
    return { A: NaN, B: NaN, C: NaN, D: NaN }
  }
  return { A: 1, B: Z, C: 0, D: 1 }
}

/**
 * Cascade two ABCD matrices: M = M1 · M2
 * (left-to-right wave from port1→port2).
 *   A = A1 A2 + B1 C2
 *   B = A1 B2 + B1 D2
 *   C = C1 A2 + D1 C2
 *   D = C1 B2 + D1 D2
 */
export function abcdCascade(m1: Abcd, m2: Abcd): Abcd {
  const { A: A1, B: B1, C: C1, D: D1 } = m1
  const { A: A2, B: B2, C: C2, D: D2 } = m2
  if (
    !Number.isFinite(A1) ||
    !Number.isFinite(B1) ||
    !Number.isFinite(C1) ||
    !Number.isFinite(D1) ||
    !Number.isFinite(A2) ||
    !Number.isFinite(B2) ||
    !Number.isFinite(C2) ||
    !Number.isFinite(D2)
  ) {
    return { A: NaN, B: NaN, C: NaN, D: NaN }
  }
  return {
    A: A1 * A2 + B1 * C2,
    B: A1 * B2 + B1 * D2,
    C: C1 * A2 + D1 * C2,
    D: C1 * B2 + D1 * D2,
  }
}

/**
 * Series-Z sample: A=1,B=Z,C=0,D=1; cascade of two Z ⇒ B=Z1+Z2.
 */
export function runAbcdSeriesZSample(opts?: { Z?: number }): {
  Z: number
  A: number
  B: number
  C: number
  D: number
  cascadeB: number
  det: number
  badB: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ABCD_SERIES_Z
  familyId: typeof METHOD_ABCD
} {
  const Z = opts?.Z ?? DEFAULT_Z

  const m = abcdSeriesZ(Z)
  const m2 = abcdSeriesZ(Z)
  const casc = abcdCascade(m, m2)
  const bad = abcdSeriesZ(NaN)

  const finite =
    Number.isFinite(m.A) &&
    Number.isFinite(m.B) &&
    Number.isFinite(m.C) &&
    Number.isFinite(m.D) &&
    Number.isFinite(casc.B)

  const entriesOk =
    m.A === 1 &&
    Math.abs(m.B - Z) < 1e-18 &&
    m.C === 0 &&
    m.D === 1
  // two series Z cascade: total B = Z+Z
  const cascadeOk = Math.abs(casc.B - 2 * Z) < 1e-12 * Math.max(1, Math.abs(Z))
  const cascADOk = casc.A === 1 && casc.D === 1 && casc.C === 0
  // reciprocal series-Z: AD − BC = 1
  const det = m.A * m.D - m.B * m.C
  const detOk = Math.abs(det - 1) < 1e-15
  const badOk = !Number.isFinite(bad.B)

  const ok = finite && entriesOk && cascadeOk && cascADOk && detOk && badOk

  return {
    Z,
    A: m.A,
    B: m.B,
    C: m.C,
    D: m.D,
    cascadeB: casc.B,
    det,
    badB: bad.B,
    finite,
    ok,
    methodId: METHOD_ALGO_ABCD_SERIES_Z,
    familyId: METHOD_ABCD,
  }
}
