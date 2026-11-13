/**
 * Ramsey fringe probability · pure teaching stubs.
 * P = cos²(δ · T / 2)  (on-resonance envelope teaching form).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Ramsey interferometry. */
export const METHOD_RAMSEY = 'method-ramsey'

/** Algo · fringe probability P. */
export const METHOD_ALGO_RAMSEY_P = 'method-algo-ramsey-p'

/** Parent alias (aligns with familyId). */
export const RAMSEY_PARENT = METHOD_RAMSEY

export const RAMSEY_METHOD_IDS = [METHOD_ALGO_RAMSEY_P] as const

/** Default detuning δ (rad/s). */
export const DEFAULT_DELTA = 2 * Math.PI * 100

/** Default free-evolution time T (s). */
export const DEFAULT_T = 0.005

/**
 * Ramsey bright-state probability (teaching):
 *   P = cos²(δ · T / 2)
 *
 * δ: detuning (rad/s), T: free-evolution time (s).
 * Non-finite → NaN. Result in [0, 1] when finite.
 */
export function ramseyP(delta: number, T: number): number {
  if (!Number.isFinite(delta) || !Number.isFinite(T)) return NaN
  const half = (delta * T) / 2
  const c = Math.cos(half)
  return c * c
}

/**
 * Ramsey sample: P=cos²(δT/2); δ=0 ⇒ P=1; T=0 ⇒ P=1.
 */
export function runRamseyPSample(opts?: {
  delta?: number
  T?: number
}): {
  delta: number
  T: number
  P: number
  P_zeroDelta: number
  P_zeroT: number
  P_pi: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RAMSEY_P
  familyId: typeof METHOD_RAMSEY
} {
  const delta = opts?.delta ?? DEFAULT_DELTA
  const T = opts?.T ?? DEFAULT_T

  const P = ramseyP(delta, T)
  const P_zeroDelta = ramseyP(0, T)
  const P_zeroT = ramseyP(delta, 0)
  // δ T / 2 = π/2 ⇒ cos=0 ⇒ P=0
  const P_pi = ramseyP(Math.PI / T, T)

  const finite =
    Number.isFinite(P) &&
    Number.isFinite(P_zeroDelta) &&
    Number.isFinite(P_zeroT) &&
    Number.isFinite(P_pi)

  const half = (delta * T) / 2
  const expected = Math.cos(half) ** 2
  const formulaOk = Math.abs(P - expected) < 1e-12
  const zeroDOk = Math.abs(P_zeroDelta - 1) < 1e-15
  const zeroTOk = Math.abs(P_zeroT - 1) < 1e-15
  const piOk = Math.abs(P_pi) < 1e-12
  const boundsOk = P >= 0 && P <= 1
  const badOk = !Number.isFinite(ramseyP(NaN, T))

  const ok =
    finite && formulaOk && zeroDOk && zeroTOk && piOk && boundsOk && badOk

  return {
    delta,
    T,
    P,
    P_zeroDelta,
    P_zeroT,
    P_pi,
    finite,
    ok,
    methodId: METHOD_ALGO_RAMSEY_P,
    familyId: METHOD_RAMSEY,
  }
}
