/**
 * SQUID flux quanta · pure teaching stubs.
 * n = Φ / Φ₀  with Φ₀ = 2.067833848e-15 Wb
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · SQUID / flux quantization. */
export const METHOD_SQUID = 'method-squid'

/** Algo · flux quanta n = Φ / Φ₀. */
export const METHOD_ALGO_SQUID_PHI = 'method-algo-squid-flux'

/** Parent alias. */
export const SQUID_PARENT = METHOD_SQUID

export const SQUID_METHOD_IDS = [METHOD_ALGO_SQUID_PHI] as const

/** Magnetic flux quantum Φ₀ (Wb). */
export const PHI0 = 2.067833848e-15

/** Default flux Φ (Wb) — one quantum. */
export const DEFAULT_PHI = PHI0

/**
 * Number of flux quanta (dimensionless):
 *   n = Φ / Φ₀
 *
 * Phi: magnetic flux (Wb), phi0: flux quantum (Wb).
 * Requires finite Phi and phi0>0; else NaN.
 */
export function fluxQuanta(Phi: number, phi0: number = PHI0): number {
  if (!Number.isFinite(Phi) || !Number.isFinite(phi0) || !(phi0 > 0)) {
    return NaN
  }
  return Phi / phi0
}

/**
 * SQUID flux sample: n = Φ/Φ₀; ∝ Φ; Φ=Φ₀ ⇒ n=1; Φ=0 ⇒ 0.
 */
export function runSquidFluxSample(opts?: {
  Phi?: number
  phi0?: number
}): {
  Phi: number
  phi0: number
  n: number
  n_doublePhi: number
  n_zero: number
  n_oneQuantum: number
  n_badPhi0: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SQUID_PHI
  familyId: typeof METHOD_SQUID
} {
  const Phi = opts?.Phi ?? DEFAULT_PHI
  const phi0 = opts?.phi0 ?? PHI0

  const n = fluxQuanta(Phi, phi0)
  const n_doublePhi = fluxQuanta(2 * Phi, phi0)
  const n_zero = fluxQuanta(0, phi0)
  const n_oneQuantum = fluxQuanta(phi0, phi0)
  const n_badPhi0 = fluxQuanta(Phi, 0)

  const finite =
    Number.isFinite(n) &&
    Number.isFinite(n_doublePhi) &&
    Number.isFinite(n_zero) &&
    Number.isFinite(n_oneQuantum)

  const expected = Phi / phi0
  const formulaOk =
    Math.abs(n - expected) < 1e-12 * Math.max(1, Math.abs(n))
  const linOk =
    Math.abs(n_doublePhi - 2 * n) < 1e-12 * Math.max(1, Math.abs(n))
  const zeroOk = Math.abs(n_zero) < 1e-30
  const oneOk = Math.abs(n_oneQuantum - 1) < 1e-18
  const badOk = !Number.isFinite(n_badPhi0)

  const ok = finite && formulaOk && linOk && zeroOk && oneOk && badOk

  return {
    Phi,
    phi0,
    n,
    n_doublePhi,
    n_zero,
    n_oneQuantum,
    n_badPhi0,
    finite,
    ok,
    methodId: METHOD_ALGO_SQUID_PHI,
    familyId: METHOD_SQUID,
  }
}
