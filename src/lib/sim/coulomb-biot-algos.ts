/**
 * Coulomb force + Biot–Savart (long wire) · pure teaching stubs.
 * F = k |q1 q2| / r²; B = μ₀ I / (2 π r) = 2e-7 · I / r.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Coulomb's law. */
export const METHOD_COULOMB = 'method-coulomb-law'

/** Algo · Coulomb force magnitude F = k |q1 q2| / r². */
export const METHOD_ALGO_COULOMB_F = 'method-algo-coulomb-force'

/** Family · Biot–Savart / long-wire B field. */
export const METHOD_BIOT = 'method-biot-savart'

/** Algo · long-wire B magnitude. */
export const METHOD_ALGO_BIOT_B = 'method-algo-biot-b'

/** Parent aliases. */
export const COULOMB_PARENT = METHOD_COULOMB
export const BIOT_PARENT = METHOD_BIOT

export const COULOMB_METHOD_IDS = [METHOD_ALGO_COULOMB_F] as const
export const BIOT_METHOD_IDS = [METHOD_ALGO_BIOT_B] as const

export const COULOMB_BIOT_METHOD_IDS = [
  METHOD_ALGO_COULOMB_F,
  METHOD_ALGO_BIOT_B,
] as const

/** Coulomb constant k = 1/(4πε₀) (N·m²/C²). */
export const K_COULOMB = 8.99e9

/** μ₀ / (2π) = 2e-7 (T·m/A) for infinite straight wire. */
export const MU0_OVER_2PI = 2e-7

/** Default charges (C) for samples. */
export const DEFAULT_Q1 = 1e-6
export const DEFAULT_Q2 = 1e-6

/** Default separation r (m). */
export const DEFAULT_R_COULOMB = 0.1

/** Default current I (A). */
export const DEFAULT_I = 10

/** Default radial distance from wire (m). */
export const DEFAULT_R_WIRE = 0.05

/**
 * Coulomb force magnitude (N):
 *   F = k · |q1 · q2| / r²
 *
 * Requires r>0, finite inputs; else NaN.
 * Returns magnitude only (always ≥ 0).
 */
export function coulombForce(
  q1: number,
  q2: number,
  r: number,
  k: number = K_COULOMB,
): number {
  if (
    !Number.isFinite(q1) ||
    !Number.isFinite(q2) ||
    !Number.isFinite(r) ||
    !Number.isFinite(k) ||
    !(r > 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return (k * Math.abs(q1 * q2)) / (r * r)
}

/**
 * Magnetic field magnitude (T) of an infinite straight wire:
 *   B = (μ₀ / (2π)) · I / r = 2e-7 · I / r
 *
 * Requires r>0, finite; else NaN. Magnitude uses |I|.
 */
export function biotWireB(
  I: number,
  r: number,
  mu0Over2pi: number = MU0_OVER_2PI,
): number {
  if (
    !Number.isFinite(I) ||
    !Number.isFinite(r) ||
    !Number.isFinite(mu0Over2pi) ||
    !(r > 0) ||
    !(mu0Over2pi > 0)
  ) {
    return NaN
  }
  return (mu0Over2pi * Math.abs(I)) / r
}

/**
 * Coulomb sample: F = k |q1 q2|/r²; ∝ 1/r²; r≤0 → NaN.
 */
export function runCoulombForceSample(opts?: {
  q1?: number
  q2?: number
  r?: number
  k?: number
}): {
  q1: number
  q2: number
  r: number
  k: number
  F: number
  F_doubleR: number
  F_badR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_COULOMB_F
  familyId: typeof METHOD_COULOMB
} {
  const q1 = opts?.q1 ?? DEFAULT_Q1
  const q2 = opts?.q2 ?? DEFAULT_Q2
  const r = opts?.r ?? DEFAULT_R_COULOMB
  const k = opts?.k ?? K_COULOMB

  const F = coulombForce(q1, q2, r, k)
  const F_doubleR = coulombForce(q1, q2, 2 * r, k)
  const F_badR = coulombForce(q1, q2, 0, k)

  const finite = Number.isFinite(F) && Number.isFinite(F_doubleR)

  const expected = (k * Math.abs(q1 * q2)) / (r * r)
  const formulaOk =
    Math.abs(F - expected) < 1e-12 * Math.max(1e-30, Math.abs(F))
  // (2r)² / r² = 4 ⇒ F_double = F/4
  const invR2Ok =
    Math.abs(F_doubleR - F / 4) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const badOk = !Number.isFinite(F_badR)
  const positiveOk = F > 0

  const ok = finite && formulaOk && invR2Ok && badOk && positiveOk

  return {
    q1,
    q2,
    r,
    k,
    F,
    F_doubleR,
    F_badR,
    finite,
    ok,
    methodId: METHOD_ALGO_COULOMB_F,
    familyId: METHOD_COULOMB,
  }
}

/**
 * Biot–Savart long-wire sample: B = 2e-7 · I / r; ∝ I, 1/r.
 */
export function runBiotBSample(opts?: {
  I?: number
  r?: number
  mu0Over2pi?: number
}): {
  I: number
  r: number
  mu0Over2pi: number
  B: number
  B_doubleI: number
  B_doubleR: number
  B_badR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BIOT_B
  familyId: typeof METHOD_BIOT
} {
  const I = opts?.I ?? DEFAULT_I
  const r = opts?.r ?? DEFAULT_R_WIRE
  const mu0Over2pi = opts?.mu0Over2pi ?? MU0_OVER_2PI

  const B = biotWireB(I, r, mu0Over2pi)
  const B_doubleI = biotWireB(2 * I, r, mu0Over2pi)
  const B_doubleR = biotWireB(I, 2 * r, mu0Over2pi)
  const B_badR = biotWireB(I, 0, mu0Over2pi)

  const finite =
    Number.isFinite(B) &&
    Number.isFinite(B_doubleI) &&
    Number.isFinite(B_doubleR)

  const expected = (mu0Over2pi * Math.abs(I)) / r
  const formulaOk =
    Math.abs(B - expected) < 1e-12 * Math.max(1e-30, Math.abs(B))
  const linIOk =
    Math.abs(B_doubleI - 2 * B) < 1e-12 * Math.max(1e-30, Math.abs(B))
  const invROk =
    Math.abs(B_doubleR - B / 2) < 1e-12 * Math.max(1e-30, Math.abs(B))
  const badOk = !Number.isFinite(B_badR)
  const positiveOk = B > 0

  const ok =
    finite && formulaOk && linIOk && invROk && badOk && positiveOk

  return {
    I,
    r,
    mu0Over2pi,
    B,
    B_doubleI,
    B_doubleR,
    B_badR,
    finite,
    ok,
    methodId: METHOD_ALGO_BIOT_B,
    familyId: METHOD_BIOT,
  }
}
