/**
 * Hagen–Poiseuille pipe flow · pure teaching stubs.
 * Q = (π r⁴ ΔP) / (8 μ L)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Poiseuille laminar pipe flow. */
export const METHOD_POISEUILLE = 'method-poiseuille'

/** Algo · volumetric flow rate Q. */
export const METHOD_ALGO_POISEUILLE_Q = 'method-algo-poiseuille-q'

/** Parent alias (aligns with familyId). */
export const POISEUILLE_PARENT = METHOD_POISEUILLE

export const POISEUILLE_METHOD_IDS = [METHOD_ALGO_POISEUILLE_Q] as const

/** Default radius r (m). */
export const DEFAULT_R = 1e-3

/** Default pressure drop ΔP (Pa). */
export const DEFAULT_DELTA_P = 1000

/** Default dynamic viscosity μ (Pa·s); water ~1e-3. */
export const DEFAULT_MU = 1e-3

/** Default length L (m). */
export const DEFAULT_L = 0.1

/**
 * Hagen–Poiseuille volumetric flow rate (m³/s):
 *   Q = (π · r⁴ · ΔP) / (8 · μ · L)
 *
 * r: radius (m), deltaP: pressure drop (Pa), mu: viscosity (Pa·s), L: length (m).
 * Requires r finite, mu>0, L>0; else NaN.
 */
export function poiseuilleQ(
  r: number,
  deltaP: number,
  mu: number,
  L: number,
): number {
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(deltaP) ||
    !Number.isFinite(mu) ||
    !Number.isFinite(L) ||
    !(mu > 0) ||
    !(L > 0)
  ) {
    return NaN
  }
  return (Math.PI * r ** 4 * deltaP) / (8 * mu * L)
}

/**
 * Poiseuille sample: Q ∝ r⁴, ΔP; ∝ 1/μ, 1/L; μ≤0 or L≤0 illegal.
 */
export function runPoiseuilleQSample(opts?: {
  r?: number
  deltaP?: number
  mu?: number
  L?: number
}): {
  r: number
  deltaP: number
  mu: number
  L: number
  Q: number
  Q_doubleR: number
  Q_doubleDeltaP: number
  Q_badMu: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_POISEUILLE_Q
  familyId: typeof METHOD_POISEUILLE
} {
  const r = opts?.r ?? DEFAULT_R
  const deltaP = opts?.deltaP ?? DEFAULT_DELTA_P
  const mu = opts?.mu ?? DEFAULT_MU
  const L = opts?.L ?? DEFAULT_L

  const Q = poiseuilleQ(r, deltaP, mu, L)
  const Q_doubleR = poiseuilleQ(2 * r, deltaP, mu, L)
  const Q_doubleDeltaP = poiseuilleQ(r, 2 * deltaP, mu, L)
  const Q_badMu = poiseuilleQ(r, deltaP, 0, L)

  const finite =
    Number.isFinite(Q) &&
    Number.isFinite(Q_doubleR) &&
    Number.isFinite(Q_doubleDeltaP)

  const expected = (Math.PI * r ** 4 * deltaP) / (8 * mu * L)
  const formulaOk =
    Math.abs(Q - expected) < 1e-12 * Math.max(1e-30, Math.abs(Q))
  // r → 2r ⇒ Q → 16 Q
  const r4Ok =
    Math.abs(Q_doubleR - 16 * Q) < 1e-12 * Math.max(1e-30, Math.abs(Q))
  const linPOk =
    Math.abs(Q_doubleDeltaP - 2 * Q) < 1e-12 * Math.max(1e-30, Math.abs(Q))
  const badOk = !Number.isFinite(Q_badMu)
  const positiveOk = Q > 0

  const ok = finite && formulaOk && r4Ok && linPOk && badOk && positiveOk

  return {
    r,
    deltaP,
    mu,
    L,
    Q,
    Q_doubleR,
    Q_doubleDeltaP,
    Q_badMu,
    finite,
    ok,
    methodId: METHOD_ALGO_POISEUILLE_Q,
    familyId: METHOD_POISEUILLE,
  }
}
