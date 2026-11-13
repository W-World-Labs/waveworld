/**
 * Michelson interferometer · pure teaching stubs.
 * Order m = 2 d / λ; I = I0 cos²(2π d / λ) = I0 cos²(δ/2) with δ = 4π d / λ.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Michelson interferometer. */
export const METHOD_MICHELSON = 'method-michelson'

/** Algo · fringe order m = 2 d / λ. */
export const METHOD_ALGO_MICHELSON_FRINGE = 'method-algo-michelson-order'

/** Parent alias (aligns with familyId). */
export const MICHELSON_PARENT = METHOD_MICHELSON

export const MICHELSON_METHOD_IDS = [METHOD_ALGO_MICHELSON_FRINGE] as const

/** Default path difference d (m). */
export const DEFAULT_D = 5e-7

/** Default wavelength λ (m); HeNe-class. */
export const DEFAULT_LAMBDA = 632.8e-9

/** Default peak intensity I0. */
export const DEFAULT_I0 = 1

/**
 * Fringe order (dimensionless):
 *   m = 2 · d / λ
 *
 * d: optical path difference / mirror displacement (m),
 * lambda: wavelength (m). Requires λ>0, finite; else NaN.
 */
export function michelsonOrder(d: number, lambda: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(lambda) || !(lambda > 0)) {
    return NaN
  }
  return (2 * d) / lambda
}

/**
 * Two-beam interference intensity (equal amplitudes):
 *   I = I0 · cos²(2 π d / λ)
 *
 * Equivalent: I = I0 cos²(δ/2) with phase difference δ = 4π d / λ.
 * Requires I0≥0, λ>0, finite; else NaN.
 */
export function michelsonIntensity(
  d: number,
  lambda: number,
  I0: number = DEFAULT_I0,
): number {
  if (
    !Number.isFinite(d) ||
    !Number.isFinite(lambda) ||
    !Number.isFinite(I0) ||
    !(lambda > 0) ||
    !(I0 >= 0)
  ) {
    return NaN
  }
  const cosArg = (2 * Math.PI * d) / lambda
  const c = Math.cos(cosArg)
  return I0 * c * c
}

/**
 * Phase difference (rad) for path difference d:
 *   δ = 4 π d / λ
 */
export function michelsonPhase(d: number, lambda: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(lambda) || !(lambda > 0)) {
    return NaN
  }
  return (4 * Math.PI * d) / lambda
}

/**
 * Michelson sample: m=2d/λ; I=I0 cos²(2πd/λ); constructive at d=m λ/2.
 */
export function runMichelsonFringeSample(opts?: {
  d?: number
  lambda?: number
  I0?: number
}): {
  d: number
  lambda: number
  I0: number
  m: number
  I: number
  I_constructive: number
  I_destructive: number
  delta: number
  m_badLam: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MICHELSON_FRINGE
  familyId: typeof METHOD_MICHELSON
} {
  const d = opts?.d ?? DEFAULT_D
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const I0 = opts?.I0 ?? DEFAULT_I0

  const m = michelsonOrder(d, lambda)
  const I = michelsonIntensity(d, lambda, I0)
  // constructive: d = k λ/2 with k integer → cos(2π d/λ) = cos(k π) = ±1
  const I_constructive = michelsonIntensity(0, lambda, I0)
  // destructive: d = λ/4 → cos(π/2)=0
  const I_destructive = michelsonIntensity(lambda / 4, lambda, I0)
  const delta = michelsonPhase(d, lambda)
  const m_badLam = michelsonOrder(d, 0)

  const finite =
    Number.isFinite(m) &&
    Number.isFinite(I) &&
    Number.isFinite(I_constructive) &&
    Number.isFinite(I_destructive) &&
    Number.isFinite(delta)

  const orderOk = Math.abs(m - (2 * d) / lambda) < 1e-12 * Math.max(1, Math.abs(m))
  const cosArg = (2 * Math.PI * d) / lambda
  const Iexp = I0 * Math.cos(cosArg) ** 2
  const IOk = Math.abs(I - Iexp) < 1e-12 * Math.max(1e-30, I0)
  const constOk = Math.abs(I_constructive - I0) < 1e-12 * Math.max(1e-30, I0)
  const destOk = Math.abs(I_destructive) < 1e-12 * Math.max(1e-30, I0)
  // I = I0 cos²(δ/2)
  const fromPhase =
    I0 * Math.cos(delta / 2) ** 2
  const phaseOk = Math.abs(I - fromPhase) < 1e-10 * Math.max(1e-30, I0)
  const badOk = !Number.isFinite(m_badLam)

  const ok =
    finite && orderOk && IOk && constOk && destOk && phaseOk && badOk

  return {
    d,
    lambda,
    I0,
    m,
    I,
    I_constructive,
    I_destructive,
    delta,
    m_badLam,
    finite,
    ok,
    methodId: METHOD_ALGO_MICHELSON_FRINGE,
    familyId: METHOD_MICHELSON,
  }
}
