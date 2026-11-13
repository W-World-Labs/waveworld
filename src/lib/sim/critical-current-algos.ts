/**
 * Josephson critical current (Ambegaokar–Baratoff-like) · pure teaching stubs.
 * Ic = (π/2) · Δ / (e Rn)   [simplified AB at T→0]
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · critical current. */
export const METHOD_IC = 'method-critical-current'

/** Algo · Josephson Ic from gap and normal resistance. */
export const METHOD_ALGO_IC_JOSEPHSON = 'method-algo-ic-josephson'

/** Parent alias (aligns with familyId). */
export const IC_PARENT = METHOD_IC

export const IC_METHOD_IDS = [METHOD_ALGO_IC_JOSEPHSON] as const

/** Elementary charge e (C). */
export const E_CHARGE = 1.602176634e-19

/** Default gap Δ (J) — ~1 meV scale. */
export const DEFAULT_DELTA = 1.6e-22

/** Default normal-state resistance Rn (Ω). */
export const DEFAULT_RN = 100

/** Default Tc (K) for near-Tc linear stub. */
export const DEFAULT_TC = 9.2

/**
 * Ambegaokar–Baratoff-like critical current (A) at T→0 teaching form:
 *   Ic = (π / 2) · Δ / (e · Rn)
 *
 * Δ: superconducting gap energy (J), e: elementary charge (C),
 * Rn: normal-state tunnel resistance (Ω).
 * Requires Δ finite, e>0, Rn>0; else NaN.
 */
export function josephsonIc(
  Delta: number,
  Rn: number,
  e: number = E_CHARGE,
): number {
  if (
    !Number.isFinite(Delta) ||
    !Number.isFinite(Rn) ||
    !Number.isFinite(e) ||
    !(Rn > 0) ||
    !(e > 0)
  ) {
    return NaN
  }
  return ((Math.PI / 2) * Delta) / (e * Rn)
}

/**
 * Near-Tc linear stub for critical current:
 *   Ic(T) ≈ I0 · (1 − T/Tc)   for T < Tc
 *
 * Requires I0 finite, Tc>0, 0 ≤ T < Tc; else NaN. T≥Tc ⇒ 0.
 */
export function icNearTc(I0: number, T: number, Tc: number): number {
  if (
    !Number.isFinite(I0) ||
    !Number.isFinite(T) ||
    !Number.isFinite(Tc) ||
    !(Tc > 0) ||
    !(T >= 0)
  ) {
    return NaN
  }
  if (T >= Tc) return 0
  return I0 * (1 - T / Tc)
}

/**
 * Josephson Ic sample: Ic = (π/2) Δ/(e Rn); ∝ Δ, 1/Rn; Rn≤0 illegal.
 */
export function runIcJosephsonSample(opts?: {
  Delta?: number
  Rn?: number
}): {
  Delta: number
  Rn: number
  Ic: number
  Ic_doubleDelta: number
  Ic_doubleRn: number
  Ic_badRn: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_IC_JOSEPHSON
  familyId: typeof METHOD_IC
} {
  const Delta = opts?.Delta ?? DEFAULT_DELTA
  const Rn = opts?.Rn ?? DEFAULT_RN

  const Ic = josephsonIc(Delta, Rn)
  const Ic_doubleDelta = josephsonIc(2 * Delta, Rn)
  const Ic_doubleRn = josephsonIc(Delta, 2 * Rn)
  const Ic_badRn = josephsonIc(Delta, 0)

  const finite =
    Number.isFinite(Ic) &&
    Number.isFinite(Ic_doubleDelta) &&
    Number.isFinite(Ic_doubleRn)

  const expected = ((Math.PI / 2) * Delta) / (E_CHARGE * Rn)
  const formulaOk =
    Math.abs(Ic - expected) < 1e-12 * Math.max(1e-30, Math.abs(Ic))
  const linDOk =
    Math.abs(Ic_doubleDelta - 2 * Ic) <
    1e-12 * Math.max(1e-30, Math.abs(Ic))
  const halfRnOk =
    Math.abs(Ic_doubleRn - Ic / 2) < 1e-12 * Math.max(1e-30, Math.abs(Ic))
  const badOk = !Number.isFinite(Ic_badRn)
  const positiveOk = Delta > 0 ? Ic > 0 : true
  // near-Tc stub consistency: at T=0 recovers I0 scale
  const nearOk = Math.abs(icNearTc(Ic, 0, DEFAULT_TC) - Ic) < 1e-30

  const ok =
    finite && formulaOk && linDOk && halfRnOk && badOk && positiveOk && nearOk

  return {
    Delta,
    Rn,
    Ic,
    Ic_doubleDelta,
    Ic_doubleRn,
    Ic_badRn,
    finite,
    ok,
    methodId: METHOD_ALGO_IC_JOSEPHSON,
    familyId: METHOD_IC,
  }
}
