/**
 * Hydroelectric power · pure teaching stubs.
 * P = ρ g Q H η; specific head energy g h (J/kg).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · hydro power. */
export const METHOD_HYDRO = 'method-hydro-power'

/** Algo · mechanical/electrical power P = ρ g Q H η. */
export const METHOD_ALGO_HYDRO_POWER = 'method-algo-hydro-power'

/** Algo · specific energy from head: e = g h (J/kg). */
export const METHOD_ALGO_HYDRO_HEAD = 'method-algo-hydro-head'

/** Parent alias (aligns with familyId). */
export const HYDRO_PARENT = METHOD_HYDRO

export const HYDRO_METHOD_IDS = [
  METHOD_ALGO_HYDRO_POWER,
  METHOD_ALGO_HYDRO_HEAD,
] as const

/** Liquid water density (kg/m³), teaching default. */
export const DEFAULT_RHO = 1000

/** Standard gravity (m/s²). */
export const DEFAULT_G = 9.81

/**
 * Hydroelectric power (W):
 *   P = ρ · g · Q · H · η
 *
 * ρ: density (kg/m³), g: gravity (m/s²), Q: volume flow (m³/s),
 * H: net head (m), η: overall efficiency ∈ [0,1] typically.
 * Requires ρ≥0, g>0, Q≥0, H≥0, η≥0; non-finite → NaN.
 */
export function hydroPower(
  rho: number,
  g: number,
  Q: number,
  H: number,
  eta: number,
): number {
  if (
    !Number.isFinite(rho) ||
    !Number.isFinite(g) ||
    !Number.isFinite(Q) ||
    !Number.isFinite(H) ||
    !Number.isFinite(eta) ||
    !(rho >= 0) ||
    !(g > 0) ||
    !(Q >= 0) ||
    !(H >= 0) ||
    !(eta >= 0)
  ) {
    return NaN
  }
  return rho * g * Q * H * eta
}

/**
 * Specific gravitational potential energy (J/kg) for teaching head:
 *   e = g · h
 *
 * g: gravity (m/s²), h: elevation / head (m).
 * Requires g>0, h≥0; else NaN.
 */
export function hydroHeadFromPotential(g: number, h: number): number {
  if (!Number.isFinite(g) || !Number.isFinite(h) || !(g > 0) || !(h >= 0)) {
    return NaN
  }
  return g * h
}

/**
 * Hydro power sample: P = ρgQHη; linear in Q,H,η; zero flow → 0.
 */
export function runHydroPowerSample(opts?: {
  rho?: number
  g?: number
  Q?: number
  H?: number
  eta?: number
}): {
  rho: number
  g: number
  Q: number
  H: number
  eta: number
  P: number
  P_doubleQ: number
  P_doubleH: number
  P_zeroQ: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HYDRO_POWER
  familyId: typeof METHOD_HYDRO
} {
  const rho = opts?.rho ?? DEFAULT_RHO
  const g = opts?.g ?? DEFAULT_G
  const Q = opts?.Q ?? 50 // m³/s
  const H = opts?.H ?? 20 // m
  const eta = opts?.eta ?? 0.85

  const P = hydroPower(rho, g, Q, H, eta)
  const P_doubleQ = hydroPower(rho, g, 2 * Q, H, eta)
  const P_doubleH = hydroPower(rho, g, Q, 2 * H, eta)
  const P_zeroQ = hydroPower(rho, g, 0, H, eta)

  const finite =
    Number.isFinite(P) &&
    Number.isFinite(P_doubleQ) &&
    Number.isFinite(P_doubleH) &&
    Number.isFinite(P_zeroQ)

  const formulaOk =
    Math.abs(P - rho * g * Q * H * eta) < 1e-9 * Math.max(1, P)
  const linQ = Math.abs(P_doubleQ - 2 * P) < 1e-9 * Math.max(1, P)
  const linH = Math.abs(P_doubleH - 2 * P) < 1e-9 * Math.max(1, P)
  const zeroOk = Math.abs(P_zeroQ) < 1e-30
  const positive = P > 0

  const ok = finite && formulaOk && linQ && linH && zeroOk && positive

  return {
    rho,
    g,
    Q,
    H,
    eta,
    P,
    P_doubleQ,
    P_doubleH,
    P_zeroQ,
    finite,
    ok,
    methodId: METHOD_ALGO_HYDRO_POWER,
    familyId: METHOD_HYDRO,
  }
}

/**
 * Head / specific energy sample: e = g h; linear in h; h=0 → 0.
 */
export function runHydroHeadSample(opts?: {
  g?: number
  h?: number
}): {
  g: number
  h: number
  e: number
  e_doubleH: number
  e_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HYDRO_HEAD
  familyId: typeof METHOD_HYDRO
} {
  const g = opts?.g ?? DEFAULT_G
  const h = opts?.h ?? 20

  const e = hydroHeadFromPotential(g, h)
  const e_doubleH = hydroHeadFromPotential(g, 2 * h)
  const e_zero = hydroHeadFromPotential(g, 0)

  const finite =
    Number.isFinite(e) && Number.isFinite(e_doubleH) && Number.isFinite(e_zero)

  const formulaOk = Math.abs(e - g * h) < 1e-12
  const linOk = Math.abs(e_doubleH - 2 * e) < 1e-12
  const zeroOk = Math.abs(e_zero) < 1e-30
  const positive = e > 0

  const ok = finite && formulaOk && linOk && zeroOk && positive

  return {
    g,
    h,
    e,
    e_doubleH,
    e_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_HYDRO_HEAD,
    familyId: METHOD_HYDRO,
  }
}
