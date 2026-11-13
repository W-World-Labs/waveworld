/**
 * Goos–Hänchen lateral shift · pure teaching stubs (optional 11th).
 * δ = (λ / 2π) · cos(θ) / √(sin²θ − n₂²/n₁²)   (TIR, simplified).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Goos–Hänchen shift. */
export const METHOD_GOOS_HANCHEN = 'method-goos-hanchen'

/** Algo · lateral beam shift δ. */
export const METHOD_ALGO_GOOS_HANCHEN_D = 'method-algo-goos-hanchen-d'

/** Parent alias (aligns with familyId). */
export const GOOS_HANCHEN_PARENT = METHOD_GOOS_HANCHEN

export const GOOS_HANCHEN_METHOD_IDS = [METHOD_ALGO_GOOS_HANCHEN_D] as const

/** Default wavelength λ (m). */
export const DEFAULT_LAMBDA = 632.8e-9

/** Default incidence angle θ (rad) — above critical for glass→air. */
export const DEFAULT_THETA = (50 * Math.PI) / 180

/** Default n1 (incident medium, glass). */
export const DEFAULT_N1 = 1.5

/** Default n2 (transmitted medium, air). */
export const DEFAULT_N2 = 1.0

/**
 * Simplified Goos–Hänchen lateral shift (m) under TIR:
 *   δ = (λ / 2π) · cos(θ) / √(sin²θ − n₂²/n₁²)
 *
 * Requires λ>0, n1>0, n2≥0, θ in (0, π/2), and sin²θ > (n2/n1)²
 * (above critical angle); else NaN.
 */
export function goosHanchenDelta(
  lambda: number,
  theta: number,
  n1: number,
  n2: number,
): number {
  if (
    !Number.isFinite(lambda) ||
    !Number.isFinite(theta) ||
    !Number.isFinite(n1) ||
    !Number.isFinite(n2) ||
    !(lambda > 0) ||
    !(n1 > 0) ||
    !(n2 >= 0) ||
    !(theta > 0) ||
    !(theta < Math.PI / 2)
  ) {
    return NaN
  }
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  const crit = (n2 / n1) * (n2 / n1)
  const inside = s * s - crit
  if (!(inside > 0)) return NaN
  return (lambda / (2 * Math.PI)) * (c / Math.sqrt(inside))
}

/**
 * Goos–Hänchen sample: TIR formula; below critical illegal; ∝ λ.
 */
export function runGoosHanchenSample(opts?: {
  lambda?: number
  theta?: number
  n1?: number
  n2?: number
}): {
  lambda: number
  theta: number
  n1: number
  n2: number
  delta: number
  delta_doubleL: number
  delta_belowCrit: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_GOOS_HANCHEN_D
  familyId: typeof METHOD_GOOS_HANCHEN
} {
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const theta = opts?.theta ?? DEFAULT_THETA
  const n1 = opts?.n1 ?? DEFAULT_N1
  const n2 = opts?.n2 ?? DEFAULT_N2

  const delta = goosHanchenDelta(lambda, theta, n1, n2)
  const delta_doubleL = goosHanchenDelta(2 * lambda, theta, n1, n2)
  // θ = arcsin(n2/n1) is critical — use slightly below
  const thetaCrit = Math.asin(n2 / n1)
  const delta_belowCrit = goosHanchenDelta(
    lambda,
    thetaCrit * 0.9,
    n1,
    n2,
  )

  const finite =
    Number.isFinite(delta) && Number.isFinite(delta_doubleL)

  const s = Math.sin(theta)
  const c = Math.cos(theta)
  const inside = s * s - (n2 / n1) ** 2
  const expected =
    (lambda / (2 * Math.PI)) * (c / Math.sqrt(inside))
  const formulaOk =
    Math.abs(delta - expected) < 1e-12 * Math.max(1e-30, Math.abs(delta))
  const linLOk =
    Math.abs(delta_doubleL - 2 * delta) <
    1e-12 * Math.max(1e-30, Math.abs(delta))
  const posOk = delta > 0
  const belowOk = !Number.isFinite(delta_belowCrit)
  const badOk = !Number.isFinite(goosHanchenDelta(0, theta, n1, n2))

  const ok = finite && formulaOk && linLOk && posOk && belowOk && badOk

  return {
    lambda,
    theta,
    n1,
    n2,
    delta,
    delta_doubleL,
    delta_belowCrit,
    finite,
    ok,
    methodId: METHOD_ALGO_GOOS_HANCHEN_D,
    familyId: METHOD_GOOS_HANCHEN,
  }
}
