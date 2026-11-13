/**
 * Lorentz force + cyclotron frequency · pure teaching stubs.
 * F_mag ≈ |q| v B (perp stub); ω = |q| B / m.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Lorentz force. */
export const METHOD_LORENTZ = 'method-lorentz-force'

/** Algo · magnetic Lorentz force magnitude stub q v B. */
export const METHOD_ALGO_LORENTZ_F = 'method-algo-lorentz-force'

/** Family · cyclotron motion. */
export const METHOD_CYCLOTRON = 'method-cyclotron'

/** Algo · cyclotron angular frequency ω = q B / m. */
export const METHOD_ALGO_CYCLOTRON_W = 'method-algo-cyclotron-omega'

/** Parent aliases. */
export const LORENTZ_PARENT = METHOD_LORENTZ
export const CYCLOTRON_PARENT = METHOD_CYCLOTRON

export const LORENTZ_METHOD_IDS = [METHOD_ALGO_LORENTZ_F] as const
export const CYCLOTRON_METHOD_IDS = [METHOD_ALGO_CYCLOTRON_W] as const

export const LORENTZ_CYCLOTRON_METHOD_IDS = [
  METHOD_ALGO_LORENTZ_F,
  METHOD_ALGO_CYCLOTRON_W,
] as const

/** Default |q| (C); elementary charge scale. */
export const DEFAULT_Q = 1.602e-19

/** Default speed v (m/s). */
export const DEFAULT_V = 1e6

/** Default |B| (T). */
export const DEFAULT_B = 0.1

/** Default mass m (kg); electron. */
export const DEFAULT_M = 9.109e-31

/**
 * Magnetic Lorentz force magnitude stub (N), v ⟂ B teaching:
 *   F = |q| · |v| · |B|
 *
 * Full form F = q(E + v×B) reduced to magnetic magnitude when E=0, sinθ=1.
 * Non-finite → NaN.
 */
export function lorentzForceMag(q: number, v: number, B: number): number {
  if (!Number.isFinite(q) || !Number.isFinite(v) || !Number.isFinite(B)) {
    return NaN
  }
  return Math.abs(q) * Math.abs(v) * Math.abs(B)
}

/**
 * Cyclotron angular frequency (rad/s):
 *   ω = |q| · |B| / m
 *
 * Requires m>0, finite; else NaN.
 */
export function cyclotronOmega(q: number, B: number, m: number): number {
  if (
    !Number.isFinite(q) ||
    !Number.isFinite(B) ||
    !Number.isFinite(m) ||
    !(m > 0)
  ) {
    return NaN
  }
  return (Math.abs(q) * Math.abs(B)) / m
}

/**
 * Lorentz sample: F = |q|vB; linear in |q|,v,B; zero B ⇒ 0.
 */
export function runLorentzForceSample(opts?: {
  q?: number
  v?: number
  B?: number
}): {
  q: number
  v: number
  B: number
  F: number
  F_doubleB: number
  F_doubleV: number
  F_zeroB: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LORENTZ_F
  familyId: typeof METHOD_LORENTZ
} {
  const q = opts?.q ?? DEFAULT_Q
  const v = opts?.v ?? DEFAULT_V
  const B = opts?.B ?? DEFAULT_B

  const F = lorentzForceMag(q, v, B)
  const F_doubleB = lorentzForceMag(q, v, 2 * B)
  const F_doubleV = lorentzForceMag(q, 2 * v, B)
  const F_zeroB = lorentzForceMag(q, v, 0)

  const finite =
    Number.isFinite(F) &&
    Number.isFinite(F_doubleB) &&
    Number.isFinite(F_doubleV) &&
    Number.isFinite(F_zeroB)

  const expected = Math.abs(q) * Math.abs(v) * Math.abs(B)
  const formulaOk =
    Math.abs(F - expected) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const linBOk =
    Math.abs(F_doubleB - 2 * F) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const linVOk =
    Math.abs(F_doubleV - 2 * F) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const zeroOk = Math.abs(F_zeroB) < 1e-30
  const positiveOk = F > 0

  const ok = finite && formulaOk && linBOk && linVOk && zeroOk && positiveOk

  return {
    q,
    v,
    B,
    F,
    F_doubleB,
    F_doubleV,
    F_zeroB,
    finite,
    ok,
    methodId: METHOD_ALGO_LORENTZ_F,
    familyId: METHOD_LORENTZ,
  }
}

/**
 * Cyclotron sample: ω = |q|B/m; ∝ B, 1/m; m≤0 illegal.
 */
export function runCyclotronOmegaSample(opts?: {
  q?: number
  B?: number
  m?: number
}): {
  q: number
  B: number
  m: number
  omega: number
  omega_doubleB: number
  omega_doubleM: number
  omega_badM: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CYCLOTRON_W
  familyId: typeof METHOD_CYCLOTRON
} {
  const q = opts?.q ?? DEFAULT_Q
  const B = opts?.B ?? DEFAULT_B
  const m = opts?.m ?? DEFAULT_M

  const omega = cyclotronOmega(q, B, m)
  const omega_doubleB = cyclotronOmega(q, 2 * B, m)
  const omega_doubleM = cyclotronOmega(q, B, 2 * m)
  const omega_badM = cyclotronOmega(q, B, 0)

  const finite =
    Number.isFinite(omega) &&
    Number.isFinite(omega_doubleB) &&
    Number.isFinite(omega_doubleM)

  const expected = (Math.abs(q) * Math.abs(B)) / m
  const formulaOk =
    Math.abs(omega - expected) < 1e-12 * Math.max(1e-30, Math.abs(omega))
  const linBOk =
    Math.abs(omega_doubleB - 2 * omega) <
    1e-12 * Math.max(1e-30, Math.abs(omega))
  const halfMOk =
    Math.abs(omega_doubleM - omega / 2) <
    1e-12 * Math.max(1e-30, Math.abs(omega))
  const badOk = !Number.isFinite(omega_badM)
  const positiveOk = omega > 0

  const ok = finite && formulaOk && linBOk && halfMOk && badOk && positiveOk

  return {
    q,
    B,
    m,
    omega,
    omega_doubleB,
    omega_doubleM,
    omega_badM,
    finite,
    ok,
    methodId: METHOD_ALGO_CYCLOTRON_W,
    familyId: METHOD_CYCLOTRON,
  }
}
