/**
 * Cole–Cole / Debye permittivity · pure teaching stubs.
 * Debye real: ε′ = ε∞ + (εs − ε∞) / (1 + (ωτ)²)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Cole–Cole dielectric response. */
export const METHOD_COLE = 'method-cole-cole'

/** Algo · real permittivity (Debye / Cole α=0 teaching). */
export const METHOD_ALGO_COLE_EPS = 'method-algo-cole-eps'

/** Parent alias (aligns with familyId). */
export const COLE_PARENT = METHOD_COLE

export const COLE_METHOD_IDS = [METHOD_ALGO_COLE_EPS] as const

/** Default static permittivity ε_s. */
export const DEFAULT_EPS_S = 80

/** Default high-frequency permittivity ε_∞. */
export const DEFAULT_EPS_INF = 5

/** Default angular frequency ω (rad/s). */
export const DEFAULT_OMEGA = 1e9

/** Default relaxation time τ (s). */
export const DEFAULT_TAU = 1e-9

/**
 * Debye real permittivity (Cole–Cole with α=0):
 *   ε′ = ε∞ + (εs − ε∞) / (1 + (ω · τ)²)
 *
 * epsS: static dielectric constant, epsInf: optical/high-f limit,
 * omega: angular frequency (rad/s), tau: relaxation time (s).
 * Requires finite inputs and ωτ defined; no sign restriction on eps
 * beyond finiteness (teaching). Returns NaN for non-finite inputs.
 */
export function debyeRealEps(
  epsS: number,
  epsInf: number,
  omega: number,
  tau: number,
): number {
  if (
    !Number.isFinite(epsS) ||
    !Number.isFinite(epsInf) ||
    !Number.isFinite(omega) ||
    !Number.isFinite(tau)
  ) {
    return NaN
  }
  const wt = omega * tau
  return epsInf + (epsS - epsInf) / (1 + wt * wt)
}

/**
 * Cole/Debye ε′ sample: static limit ω→0 ⇒ εs; HF ωτ≫1 ⇒ ε∞.
 */
export function runColeEpsSample(opts?: {
  epsS?: number
  epsInf?: number
  omega?: number
  tau?: number
}): {
  epsS: number
  epsInf: number
  omega: number
  tau: number
  eps: number
  eps_static: number
  eps_hf: number
  eps_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_COLE_EPS
  familyId: typeof METHOD_COLE
} {
  const epsS = opts?.epsS ?? DEFAULT_EPS_S
  const epsInf = opts?.epsInf ?? DEFAULT_EPS_INF
  const omega = opts?.omega ?? DEFAULT_OMEGA
  const tau = opts?.tau ?? DEFAULT_TAU

  const eps = debyeRealEps(epsS, epsInf, omega, tau)
  const eps_static = debyeRealEps(epsS, epsInf, 0, tau)
  // large ωτ ⇒ ε → ε∞
  const eps_hf = debyeRealEps(epsS, epsInf, 1e15, tau)
  const eps_bad = debyeRealEps(epsS, epsInf, NaN, tau)

  const finite =
    Number.isFinite(eps) &&
    Number.isFinite(eps_static) &&
    Number.isFinite(eps_hf)

  const wt = omega * tau
  const expected = epsInf + (epsS - epsInf) / (1 + wt * wt)
  const formulaOk =
    Math.abs(eps - expected) < 1e-12 * Math.max(1, Math.abs(eps))
  const staticOk = Math.abs(eps_static - epsS) < 1e-12 * Math.max(1, epsS)
  const hfOk =
    Math.abs(eps_hf - epsInf) < 1e-4 * Math.max(1, Math.abs(epsInf))
  const badOk = !Number.isFinite(eps_bad)
  const betweenOk =
    epsS > epsInf
      ? eps <= epsS + 1e-12 && eps >= epsInf - 1e-12
      : true

  const ok = finite && formulaOk && staticOk && hfOk && badOk && betweenOk

  return {
    epsS,
    epsInf,
    omega,
    tau,
    eps,
    eps_static,
    eps_hf,
    eps_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_COLE_EPS,
    familyId: METHOD_COLE,
  }
}
