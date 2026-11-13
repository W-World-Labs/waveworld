/**
 * Air mass + Lambert cosine law · pure teaching stubs.
 * AM ≈ 1/cos(z); E = E0 cos(θ) for θ ∈ [0, π/2].
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · atmospheric air mass. */
export const METHOD_AIRMASS = 'method-air-mass'

/** Algo · simple AM = 1/cos(z). */
export const METHOD_ALGO_AIRMASS = 'method-algo-air-mass-am'

/** Family · Lambert cosine irradiance. */
export const METHOD_LAMBERT = 'method-lambert-cosine'

/** Algo · E = E0 cos(θ). */
export const METHOD_ALGO_LAMBERT_E = 'method-algo-lambert-irradiance'

/** Parent aliases. */
export const AIRMASS_PARENT = METHOD_AIRMASS
export const LAMBERT_PARENT = METHOD_LAMBERT

export const AIRMASS_METHOD_IDS = [METHOD_ALGO_AIRMASS] as const
export const LAMBERT_METHOD_IDS = [METHOD_ALGO_LAMBERT_E] as const

export const AIR_MASS_LAMBERT_METHOD_IDS = [
  METHOD_ALGO_AIRMASS,
  METHOD_ALGO_LAMBERT_E,
] as const

/** Default zenith angle z (rad) — ~48.2° for AM1.5. */
export const DEFAULT_Z = Math.acos(1 / 1.5)

/** Default irradiance E0 (W/m²) — ~1 sun. */
export const DEFAULT_E0 = 1000

/** Default incidence angle θ (rad). */
export const DEFAULT_THETA = Math.PI / 6

/**
 * Simple plane-parallel air mass:
 *   AM ≈ 1 / cos(z)
 *
 * z: zenith angle (rad). Requires cos(z) > 0 (z ∈ [0, π/2)), finite; else NaN.
 * z=0 ⇒ AM=1 (overhead).
 */
export function airMass(z: number): number {
  // Domain z ∈ [0, π/2); cos(π/2) is a tiny float ≠ 0, so use angle check.
  if (!Number.isFinite(z) || z < 0 || z >= Math.PI / 2) return NaN
  return 1 / Math.cos(z)
}

/**
 * Lambert cosine-law irradiance:
 *   E = E0 · cos(θ)   for θ ∈ [0, π/2]
 *
 * θ outside [0, π/2] → 0 (back side / grazing teaching clamp) if finite E0;
 * non-finite → NaN. E0 may be any finite (sign preserved via cos≥0 in range).
 */
export function lambertIrradiance(E0: number, theta: number): number {
  if (!Number.isFinite(E0) || !Number.isFinite(theta)) return NaN
  // θ = π/2: cos is ~1e-16, not exact 0 — treat ≥ π/2 as dark side.
  if (theta < 0 || theta >= Math.PI / 2) return 0
  return E0 * Math.cos(theta)
}

/**
 * Air-mass sample: z=0 → 1; AM=1/cos(z); z≥π/2 → NaN.
 */
export function runAirMassSample(opts?: { z?: number }): {
  z: number
  AM: number
  AM_overhead: number
  AM_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_AIRMASS
  familyId: typeof METHOD_AIRMASS
} {
  const z = opts?.z ?? DEFAULT_Z

  const AM = airMass(z)
  const AM_overhead = airMass(0)
  const AM_bad = airMass(Math.PI / 2)

  const finite = Number.isFinite(AM) && Number.isFinite(AM_overhead)

  const expected = 1 / Math.cos(z)
  const formulaOk =
    Math.abs(AM - expected) < 1e-12 * Math.max(1, Math.abs(AM))
  const overheadOk = Math.abs(AM_overhead - 1) < 1e-15
  const monoOk = AM >= 1
  const badOk = !Number.isFinite(AM_bad)

  const ok = finite && formulaOk && overheadOk && monoOk && badOk

  return {
    z,
    AM,
    AM_overhead,
    AM_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_AIRMASS,
    familyId: METHOD_AIRMASS,
  }
}

/**
 * Lambert sample: θ=0 → E0; θ=π/2 → 0; formula; outside range → 0.
 */
export function runLambertIrradianceSample(opts?: {
  E0?: number
  theta?: number
}): {
  E0: number
  theta: number
  E: number
  E_normal: number
  E_grazing: number
  E_back: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LAMBERT_E
  familyId: typeof METHOD_LAMBERT
} {
  const E0 = opts?.E0 ?? DEFAULT_E0
  const theta = opts?.theta ?? DEFAULT_THETA

  const E = lambertIrradiance(E0, theta)
  const E_normal = lambertIrradiance(E0, 0)
  const E_grazing = lambertIrradiance(E0, Math.PI / 2)
  const E_back = lambertIrradiance(E0, Math.PI)

  const finite =
    Number.isFinite(E) &&
    Number.isFinite(E_normal) &&
    Number.isFinite(E_grazing) &&
    Number.isFinite(E_back)

  const expected = E0 * Math.cos(theta)
  const formulaOk =
    Math.abs(E - expected) < 1e-12 * Math.max(1e-30, Math.abs(E))
  const normalOk =
    Math.abs(E_normal - E0) < 1e-12 * Math.max(1, Math.abs(E0))
  const grazingOk = Math.abs(E_grazing) < 1e-15
  const backOk = Math.abs(E_back) < 1e-15
  const nonNegOk = E >= 0 || E0 < 0

  const ok =
    finite && formulaOk && normalOk && grazingOk && backOk && nonNegOk

  return {
    E0,
    theta,
    E,
    E_normal,
    E_grazing,
    E_back,
    finite,
    ok,
    methodId: METHOD_ALGO_LAMBERT_E,
    familyId: METHOD_LAMBERT,
  }
}
