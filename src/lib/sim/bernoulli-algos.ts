/**
 * Bernoulli principle · pure teaching stubs.
 * p + ½ ρ v² + ρ g h = const; dynamic pressure ½ ρ v²; head form optional.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Bernoulli fluid energy. */
export const METHOD_BERNOULLI = 'method-bernoulli'

/** Algo · Bernoulli head / dynamic-pressure teaching core. */
export const METHOD_ALGO_BERNOULLI = 'method-algo-bernoulli-head'

/** Parent alias (aligns with familyId). */
export const BERNOULLI_PARENT = METHOD_BERNOULLI

export const BERNOULLI_METHOD_IDS = [METHOD_ALGO_BERNOULLI] as const

/** Default density ρ (kg/m³); water-class toy. */
export const DEFAULT_RHO = 1000

/** Default speed v (m/s). */
export const DEFAULT_V = 2

/** Default height h (m). */
export const DEFAULT_H = 1

/** Default static pressure p (Pa). */
export const DEFAULT_P = 1e5

/** Gravity g (m/s²). */
export const G = 9.81

/**
 * Dynamic pressure (Pa):
 *   q = ½ · ρ · v²
 *
 * ρ: density (kg/m³), v: speed (m/s). Non-finite → NaN.
 */
export function bernoulliDynamicP(rho: number, v: number): number {
  if (!Number.isFinite(rho) || !Number.isFinite(v)) return NaN
  return 0.5 * rho * v * v
}

/**
 * Bernoulli head form (m of fluid):
 *   H = p/(ρ g) + v²/(2 g) + h
 *
 * Requires ρ>0, g>0, finite; else NaN.
 */
export function bernoulliHead(
  p: number,
  rho: number,
  v: number,
  h: number,
  g: number = G,
): number {
  if (
    !Number.isFinite(p) ||
    !Number.isFinite(rho) ||
    !Number.isFinite(v) ||
    !Number.isFinite(h) ||
    !Number.isFinite(g) ||
    !(rho > 0) ||
    !(g > 0)
  ) {
    return NaN
  }
  return p / (rho * g) + (v * v) / (2 * g) + h
}

/**
 * Full Bernoulli specific energy (J/m³ = Pa):
 *   E = p + ½ ρ v² + ρ g h
 */
export function bernoulliEnergy(
  p: number,
  rho: number,
  v: number,
  h: number,
  g: number = G,
): number {
  if (
    !Number.isFinite(p) ||
    !Number.isFinite(rho) ||
    !Number.isFinite(v) ||
    !Number.isFinite(h) ||
    !Number.isFinite(g)
  ) {
    return NaN
  }
  return p + 0.5 * rho * v * v + rho * g * h
}

/**
 * Bernoulli sample: dynamic P = ½ρv²; energy form; head form; v=0 ⇒ q=0.
 */
export function runBernoulliSample(opts?: {
  p?: number
  rho?: number
  v?: number
  h?: number
  g?: number
}): {
  p: number
  rho: number
  v: number
  h: number
  g: number
  dynamicP: number
  dynamicP_doubleV: number
  dynamicP_zeroV: number
  energy: number
  head: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BERNOULLI
  familyId: typeof METHOD_BERNOULLI
} {
  const p = opts?.p ?? DEFAULT_P
  const rho = opts?.rho ?? DEFAULT_RHO
  const v = opts?.v ?? DEFAULT_V
  const h = opts?.h ?? DEFAULT_H
  const g = opts?.g ?? G

  const dynamicP = bernoulliDynamicP(rho, v)
  const dynamicP_doubleV = bernoulliDynamicP(rho, 2 * v)
  const dynamicP_zeroV = bernoulliDynamicP(rho, 0)
  const energy = bernoulliEnergy(p, rho, v, h, g)
  const head = bernoulliHead(p, rho, v, h, g)

  const finite =
    Number.isFinite(dynamicP) &&
    Number.isFinite(dynamicP_doubleV) &&
    Number.isFinite(dynamicP_zeroV) &&
    Number.isFinite(energy) &&
    Number.isFinite(head)

  const expectedQ = 0.5 * rho * v * v
  const formulaOk =
    Math.abs(dynamicP - expectedQ) < 1e-12 * Math.max(1, Math.abs(dynamicP))
  // v → 2v ⇒ q → 4q
  const quadOk =
    Math.abs(dynamicP_doubleV - 4 * dynamicP) <
    1e-12 * Math.max(1, Math.abs(dynamicP))
  const zeroOk = Math.abs(dynamicP_zeroV) < 1e-30
  const energyOk =
    Math.abs(energy - (p + expectedQ + rho * g * h)) <
    1e-9 * Math.max(1, Math.abs(energy))
  const headOk =
    Math.abs(head - (p / (rho * g) + (v * v) / (2 * g) + h)) <
    1e-12 * Math.max(1, Math.abs(head))
  const positiveOk = dynamicP > 0

  const ok =
    finite &&
    formulaOk &&
    quadOk &&
    zeroOk &&
    energyOk &&
    headOk &&
    positiveOk

  return {
    p,
    rho,
    v,
    h,
    g,
    dynamicP,
    dynamicP_doubleV,
    dynamicP_zeroV,
    energy,
    head,
    finite,
    ok,
    methodId: METHOD_ALGO_BERNOULLI,
    familyId: METHOD_BERNOULLI,
  }
}
