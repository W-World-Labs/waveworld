/**
 * Snell's law + Fresnel normal reflectance · pure teaching stubs.
 * n1 sin θ1 = n2 sin θ2; R = ((n1−n2)/(n1+n2))² at normal incidence.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Fresnel / Snell optics. */
export const METHOD_FRESNEL = 'method-fresnel-snell'

/** Algo · Snell refraction angle θ2. */
export const METHOD_ALGO_SNELL = 'method-algo-snell'

/** Algo · normal-incidence intensity reflectance R. */
export const METHOD_ALGO_FRESNEL_R = 'method-algo-fresnel-r'

/** Parent alias (aligns with familyId). */
export const FRESNEL_PARENT = METHOD_FRESNEL

export const FRESNEL_METHOD_IDS = [
  METHOD_ALGO_SNELL,
  METHOD_ALGO_FRESNEL_R,
] as const

/**
 * Snell's law — transmitted angle (radians):
 *   θ2 = arcsin((n1/n2) · sin θ1)
 *
 * Domain: n1,n2 > 0; θ1 finite; |n1/n2 · sin θ1| ≤ 1 (else TIR → NaN).
 */
export function snellTheta2(n1: number, n2: number, theta1: number): number {
  if (
    !Number.isFinite(n1) ||
    !Number.isFinite(n2) ||
    !Number.isFinite(theta1) ||
    !(n1 > 0) ||
    !(n2 > 0)
  ) {
    return NaN
  }
  const arg = (n1 / n2) * Math.sin(theta1)
  if (!Number.isFinite(arg) || Math.abs(arg) > 1) return NaN
  return Math.asin(arg)
}

/**
 * Intensity reflectance at normal incidence (unpolarized teaching):
 *   R = ((n1 − n2) / (n1 + n2))²
 *
 * Requires n1>0, n2>0, n1+n2 ≠ 0; else NaN.
 */
export function fresnelRNormal(n1: number, n2: number): number {
  if (
    !Number.isFinite(n1) ||
    !Number.isFinite(n2) ||
    !(n1 > 0) ||
    !(n2 > 0)
  ) {
    return NaN
  }
  const den = n1 + n2
  if (den === 0) return NaN
  const r = (n1 - n2) / den
  return r * r
}

/**
 * Snell sample: air→glass n1=1, n2=1.5; domain / TIR checks.
 */
export function runSnellSample(opts?: {
  n1?: number
  n2?: number
  theta1?: number
}): {
  n1: number
  n2: number
  theta1: number
  theta2: number
  theta2Normal: number
  theta2Tir: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SNELL
  familyId: typeof METHOD_FRESNEL
} {
  const n1 = opts?.n1 ?? 1.0
  const n2 = opts?.n2 ?? 1.5
  const theta1 = opts?.theta1 ?? Math.PI / 6 // 30°

  const theta2 = snellTheta2(n1, n2, theta1)
  const theta2Normal = snellTheta2(n1, n2, 0)
  // glass→air steep angle often TIR
  const theta2Tir = snellTheta2(1.5, 1.0, Math.PI / 3) // 60° into air

  const finite = Number.isFinite(theta2) && Number.isFinite(theta2Normal)

  const expected = Math.asin((n1 / n2) * Math.sin(theta1))
  const formulaOk = Math.abs(theta2 - expected) < 1e-14
  const normalOk = Math.abs(theta2Normal) < 1e-15
  // denser → rarer at 60°: critical ≈ arcsin(1/1.5)≈41.8° ⇒ TIR
  const tirOk = !Number.isFinite(theta2Tir)
  // into denser medium: θ2 < θ1
  const bendOk = n2 > n1 ? theta2 < theta1 : true

  const ok = finite && formulaOk && normalOk && tirOk && bendOk

  return {
    n1,
    n2,
    theta1,
    theta2,
    theta2Normal,
    theta2Tir,
    finite,
    ok,
    methodId: METHOD_ALGO_SNELL,
    familyId: METHOD_FRESNEL,
  }
}

/**
 * Fresnel-R sample: air–glass R ≈ 0.04; n1=n2 → R=0; swap symmetry.
 */
export function runFresnelRSample(opts?: {
  n1?: number
  n2?: number
}): {
  n1: number
  n2: number
  R: number
  R_swap: number
  R_matched: number
  R_airGlass: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FRESNEL_R
  familyId: typeof METHOD_FRESNEL
} {
  const n1 = opts?.n1 ?? 1.0
  const n2 = opts?.n2 ?? 1.5

  const R = fresnelRNormal(n1, n2)
  const R_swap = fresnelRNormal(n2, n1)
  const R_matched = fresnelRNormal(n1, n1)
  const R_airGlass = fresnelRNormal(1.0, 1.5)

  const finite =
    Number.isFinite(R) &&
    Number.isFinite(R_swap) &&
    Number.isFinite(R_matched) &&
    Number.isFinite(R_airGlass)

  const expected = ((n1 - n2) / (n1 + n2)) ** 2
  const formulaOk = Math.abs(R - expected) < 1e-14
  const swapOk = Math.abs(R - R_swap) < 1e-14
  const matchOk = Math.abs(R_matched) < 1e-15
  const airGlassOk = Math.abs(R_airGlass - ((1 - 1.5) / (1 + 1.5)) ** 2) < 1e-14
  const boundsOk = R >= 0 && R <= 1

  const ok = finite && formulaOk && swapOk && matchOk && airGlassOk && boundsOk

  return {
    n1,
    n2,
    R,
    R_swap,
    R_matched,
    R_airGlass,
    finite,
    ok,
    methodId: METHOD_ALGO_FRESNEL_R,
    familyId: METHOD_FRESNEL,
  }
}
