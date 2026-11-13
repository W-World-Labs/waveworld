/**
 * Thomson thermoelectric effect · pure teaching stub.
 * Heat (signed teaching): Q = τ · I · ΔT.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Thomson thermoelectric heat. */
export const METHOD_THOMSON = 'method-thomson-thermoelectric'

/** Algo · Thomson heat Q = τ · I · ΔT. */
export const METHOD_ALGO_THOMSON_Q = 'method-algo-thomson-heat'

/** Parent alias (aligns with familyId). */
export const THOMSON_PARENT = METHOD_THOMSON

export const THOMSON_METHOD_IDS = [METHOD_ALGO_THOMSON_Q] as const

/** Default Thomson coefficient τ (V/K = W/(A·K) teaching). */
export const DEFAULT_TAU = 1e-4

/** Default current I (A). */
export const DEFAULT_I = 2

/** Default temperature difference ΔT (K). */
export const DEFAULT_DELTA_T = 20

/**
 * Thomson heat (integrated teaching form):
 *   Q = τ · I · ΔT
 *
 * From q̇ = −τ I dT/dx integrated over length: Q = τ I ΔT (signed).
 * τ: Thomson coeff (V/K), I: current (A), ΔT: T_end − T_start (K).
 * Sign follows product; non-finite → NaN.
 */
export function thomsonHeat(tau: number, I: number, deltaT: number): number {
  if (
    !Number.isFinite(tau) ||
    !Number.isFinite(I) ||
    !Number.isFinite(deltaT)
  ) {
    return NaN
  }
  return tau * I * deltaT
}

/**
 * Thomson heat sample: τ=1e-4, I=2 A, ΔT=20 K → Q=0.004 J/s-class teaching.
 * Linear in I and ΔT; zero at I=0 or ΔT=0.
 */
export function runThomsonHeatSample(opts?: {
  tau?: number
  I?: number
  deltaT?: number
}): {
  tau: number
  I: number
  deltaT: number
  Q: number
  Q_doubleI: number
  Q_negDeltaT: number
  Q_zeroI: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_THOMSON_Q
  familyId: typeof METHOD_THOMSON
} {
  const tau = opts?.tau ?? DEFAULT_TAU
  const I = opts?.I ?? DEFAULT_I
  const deltaT = opts?.deltaT ?? DEFAULT_DELTA_T

  const Q = thomsonHeat(tau, I, deltaT)
  const Q_doubleI = thomsonHeat(tau, 2 * I, deltaT)
  const Q_negDeltaT = thomsonHeat(tau, I, -deltaT)
  const Q_zeroI = thomsonHeat(tau, 0, deltaT)

  const finite =
    Number.isFinite(Q) &&
    Number.isFinite(Q_doubleI) &&
    Number.isFinite(Q_negDeltaT) &&
    Number.isFinite(Q_zeroI)

  const formulaOk =
    Math.abs(Q - tau * I * deltaT) < 1e-18 * Math.max(1, Math.abs(Q))
  const linI =
    Math.abs(Q_doubleI - 2 * Q) < 1e-18 * Math.max(1, Math.abs(Q))
  const antisym =
    Math.abs(Q_negDeltaT + Q) < 1e-18 * Math.max(1, Math.abs(Q))
  const zeroOk = Math.abs(Q_zeroI) < 1e-30

  const ok = finite && formulaOk && linI && antisym && zeroOk

  return {
    tau,
    I,
    deltaT,
    Q,
    Q_doubleI,
    Q_negDeltaT,
    Q_zeroI,
    finite,
    ok,
    methodId: METHOD_ALGO_THOMSON_Q,
    familyId: METHOD_THOMSON,
  }
}
