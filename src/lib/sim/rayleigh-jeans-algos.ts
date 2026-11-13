/**
 * Rayleigh–Jeans spectral radiance · pure teaching stubs.
 * B_ν = 2 ν² k T / c²  (classical, frequency form)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Rayleigh–Jeans law. */
export const METHOD_RJ = 'method-rayleigh-jeans'

/** Algo · spectral radiance B_ν. */
export const METHOD_ALGO_RJ_B = 'method-algo-rj-b'

/** Parent alias. */
export const RJ_PARENT = METHOD_RJ

export const RJ_METHOD_IDS = [METHOD_ALGO_RJ_B] as const

/** Boltzmann constant k (J/K). */
export const K_B = 1.380649e-23

/** Speed of light c (m/s). */
export const C_LIGHT = 299792458

/** Default frequency ν (Hz) — microwave class. */
export const DEFAULT_NU = 1e10

/** Default temperature T (K). */
export const DEFAULT_T = 300

/**
 * Rayleigh–Jeans spectral radiance (W·m⁻²·Hz⁻¹·sr⁻¹, teaching units):
 *   B_ν = 2 · ν² · k · T / c²
 *
 * nu: frequency (Hz), T: temperature (K), k: Boltzmann, c: speed of light.
 * Requires ν≥0, T≥0, k>0, c>0, finite; else NaN.
 */
export function rayleighJeansB(
  nu: number,
  T: number,
  k: number = K_B,
  c: number = C_LIGHT,
): number {
  if (
    !Number.isFinite(nu) ||
    !Number.isFinite(T) ||
    !Number.isFinite(k) ||
    !Number.isFinite(c) ||
    !(nu >= 0) ||
    !(T >= 0) ||
    !(k > 0) ||
    !(c > 0)
  ) {
    return NaN
  }
  return (2 * nu * nu * k * T) / (c * c)
}

/**
 * Rayleigh–Jeans sample: B ∝ ν², T; T=0 ⇒ 0; ν=0 ⇒ 0.
 */
export function runRayleighJeansBSample(opts?: {
  nu?: number
  T?: number
}): {
  nu: number
  T: number
  B: number
  B_doubleNu: number
  B_doubleT: number
  B_zeroT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RJ_B
  familyId: typeof METHOD_RJ
} {
  const nu = opts?.nu ?? DEFAULT_NU
  const T = opts?.T ?? DEFAULT_T

  const B = rayleighJeansB(nu, T)
  const B_doubleNu = rayleighJeansB(2 * nu, T)
  const B_doubleT = rayleighJeansB(nu, 2 * T)
  const B_zeroT = rayleighJeansB(nu, 0)

  const finite =
    Number.isFinite(B) &&
    Number.isFinite(B_doubleNu) &&
    Number.isFinite(B_doubleT) &&
    Number.isFinite(B_zeroT)

  const expected = (2 * nu * nu * K_B * T) / (C_LIGHT * C_LIGHT)
  const formulaOk =
    Math.abs(B - expected) < 1e-12 * Math.max(1e-40, Math.abs(B))
  // (2ν)² = 4 ν²
  const nu2Ok =
    Math.abs(B_doubleNu - 4 * B) < 1e-12 * Math.max(1e-40, Math.abs(B))
  const linTOk =
    Math.abs(B_doubleT - 2 * B) < 1e-12 * Math.max(1e-40, Math.abs(B))
  const zeroOk = Math.abs(B_zeroT) < 1e-40
  const positiveOk = B > 0

  const ok = finite && formulaOk && nu2Ok && linTOk && zeroOk && positiveOk

  return {
    nu,
    T,
    B,
    B_doubleNu,
    B_doubleT,
    B_zeroT,
    finite,
    ok,
    methodId: METHOD_ALGO_RJ_B,
    familyId: METHOD_RJ,
  }
}
