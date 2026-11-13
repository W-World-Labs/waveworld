/**
 * Wind power · pure teaching stubs.
 * Kinetic flux P = ½ ρ A v³; Betz limit Cp_max = 16/27.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · wind power conversion. */
export const METHOD_WIND = 'method-wind-power'

/** Algo · Betz limit Cp_max = 16/27. */
export const METHOD_ALGO_BETZ = 'method-algo-betz-limit'

/** Algo · free-stream kinetic power P = ½ ρ A v³. */
export const METHOD_ALGO_WIND_POWER = 'method-algo-wind-power'

/** Parent alias (aligns with familyId). */
export const WIND_PARENT = METHOD_WIND

export const WIND_METHOD_IDS = [
  METHOD_ALGO_BETZ,
  METHOD_ALGO_WIND_POWER,
] as const

/** Betz maximum power coefficient: 16/27 ≈ 0.5926. */
export const BETZ_LIMIT = 16 / 27

/** Standard air density at sea level (kg/m³), ISA toy. */
export const RHO_AIR = 1.225

/**
 * Free-stream kinetic power through area A:
 *   P = ½ · ρ · A · v³
 *
 * ρ: air density (kg/m³), A: rotor swept area (m²), v: wind speed (m/s).
 * Requires ρ≥0, A≥0; non-finite → NaN.
 */
export function windPower(rho: number, area: number, v: number): number {
  if (
    !Number.isFinite(rho) ||
    !Number.isFinite(area) ||
    !Number.isFinite(v) ||
    !(rho >= 0) ||
    !(area >= 0)
  ) {
    return NaN
  }
  return 0.5 * rho * area * v * v * v
}

/**
 * Extractable power with power coefficient Cp:
 *   P_ext = Cp · ½ · ρ · A · v³
 *
 * Cp typically 0–Betz; values outside [0,1] still compute (teaching).
 */
export function windPowerExtracted(
  rho: number,
  area: number,
  v: number,
  Cp: number,
): number {
  if (!Number.isFinite(Cp)) return NaN
  const P = windPower(rho, area, v)
  if (!Number.isFinite(P)) return NaN
  return Cp * P
}

/**
 * Maximum extractable power under Betz:
 *   P_max = (16/27) · ½ · ρ · A · v³
 */
export function windPowerBetzMax(
  rho: number,
  area: number,
  v: number,
): number {
  return windPowerExtracted(rho, area, v, BETZ_LIMIT)
}

/**
 * Rotor swept area of a horizontal-axis turbine:
 *   A = π · R²
 */
export function rotorArea(radius: number): number {
  if (!Number.isFinite(radius) || !(radius >= 0)) return NaN
  return Math.PI * radius * radius
}

/**
 * Sweep P vs v on a uniform grid; returns Float64Array series.
 */
export function windPowerSweep(
  rho: number,
  area: number,
  vMax: number,
  n = 11,
): { v: Float64Array; P: Float64Array } {
  const nPts = Math.max(2, Math.floor(n))
  const v = new Float64Array(nPts)
  const P = new Float64Array(nPts)
  for (let i = 0; i < nPts; i++) {
    const vi = (i / (nPts - 1)) * vMax
    v[i] = vi
    P[i] = windPower(rho, area, vi)
  }
  return { v, P }
}

/**
 * Betz limit sample: Cp_max = 16/27; P_max = Cp · P_avail; Cp > practical.
 */
export function runBetzSample(opts?: {
  rho?: number
  area?: number
  v?: number
  CpPractical?: number
}): {
  betz: number
  rho: number
  area: number
  v: number
  P_avail: number
  P_max: number
  P_practical: number
  CpPractical: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BETZ
  familyId: typeof METHOD_WIND
} {
  const rho = opts?.rho ?? RHO_AIR
  const area = opts?.area ?? Math.PI * 40 * 40 // R=40 m
  const v = opts?.v ?? 12
  const CpPractical = opts?.CpPractical ?? 0.4

  const P_avail = windPower(rho, area, v)
  const P_max = windPowerBetzMax(rho, area, v)
  const P_practical = windPowerExtracted(rho, area, v, CpPractical)

  const finite =
    Number.isFinite(P_avail) &&
    Number.isFinite(P_max) &&
    Number.isFinite(P_practical)

  const betzExact = Math.abs(BETZ_LIMIT - 16 / 27) < 1e-15
  const betzRange = BETZ_LIMIT > 0.59 && BETZ_LIMIT < 0.6
  const maxOk = Math.abs(P_max - BETZ_LIMIT * P_avail) < 1e-9 * Math.max(1, P_avail)
  const practBelow =
    P_practical < P_max && CpPractical < BETZ_LIMIT && P_practical > 0
  const positive = P_avail > 0 && P_max > 0

  const ok =
    finite && betzExact && betzRange && maxOk && practBelow && positive

  return {
    betz: BETZ_LIMIT,
    rho,
    area,
    v,
    P_avail,
    P_max,
    P_practical,
    CpPractical,
    finite,
    ok,
    methodId: METHOD_ALGO_BETZ,
    familyId: METHOD_WIND,
  }
}

/**
 * Wind power sample: P = ½ρAv³; cubic in v; linear in A, ρ.
 */
export function runWindPowerSample(opts?: {
  rho?: number
  area?: number
  v?: number
}): {
  rho: number
  area: number
  v: number
  P: number
  P_doubleV: number
  P_doubleA: number
  P_zeroV: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_WIND_POWER
  familyId: typeof METHOD_WIND
} {
  const rho = opts?.rho ?? RHO_AIR
  const area = opts?.area ?? 100
  const v = opts?.v ?? 10

  const P = windPower(rho, area, v)
  const P_doubleV = windPower(rho, area, 2 * v)
  const P_doubleA = windPower(rho, 2 * area, v)
  const P_zeroV = windPower(rho, area, 0)

  const finite =
    Number.isFinite(P) &&
    Number.isFinite(P_doubleV) &&
    Number.isFinite(P_doubleA) &&
    Number.isFinite(P_zeroV)

  const formulaOk = Math.abs(P - 0.5 * rho * area * v ** 3) < 1e-9 * Math.max(1, P)
  const cubicOk = Math.abs(P_doubleV - 8 * P) < 1e-9 * Math.max(1, P)
  const linAOk = Math.abs(P_doubleA - 2 * P) < 1e-9 * Math.max(1, P)
  const zeroOk = Math.abs(P_zeroV) < 1e-30
  const positive = P > 0

  const ok = finite && formulaOk && cubicOk && linAOk && zeroOk && positive

  return {
    rho,
    area,
    v,
    P,
    P_doubleV,
    P_doubleA,
    P_zeroV,
    finite,
    ok,
    methodId: METHOD_ALGO_WIND_POWER,
    familyId: METHOD_WIND,
  }
}
