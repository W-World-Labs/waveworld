/**
 * Richardson–Dushman thermionic emission · pure teaching stub.
 * J = A · T² · exp(−W / (k T)), W in eV, k in eV/K.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · thermionic emission. */
export const METHOD_THERMIONIC = 'method-thermionic-emission'

/** Algo · Richardson current density. */
export const METHOD_ALGO_RICHARDSON = 'method-algo-richardson-current'

/** Parent alias (aligns with familyId). */
export const THERMIONIC_PARENT = METHOD_THERMIONIC

export const THERMIONIC_METHOD_IDS = [METHOD_ALGO_RICHARDSON] as const

/** Boltzmann constant in eV/K. */
export const K_EV = 8.617e-5

/** Default Richardson constant A (A/(m²·K²) teaching order). */
export const DEFAULT_A = 1.2e6

/** Default cathode temperature T (K). */
export const DEFAULT_T = 2000

/** Default work function W (eV); W-class metal toy. */
export const DEFAULT_W = 4.5

/**
 * Richardson–Dushman current density:
 *   J = A · T² · exp(−W / (k T))
 *
 * A: Richardson constant (A/(m²·K²)), T: temperature (K),
 * W: work function (eV), k: Boltzmann (eV/K, default 8.617e-5).
 * Requires T>0, A≥0, W finite; else NaN.
 */
export function richardsonJ(
  A: number,
  T: number,
  W: number,
  k: number = K_EV,
): number {
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(T) ||
    !Number.isFinite(W) ||
    !Number.isFinite(k) ||
    !(T > 0) ||
    !(A >= 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return A * T * T * Math.exp(-W / (k * T))
}

/**
 * Richardson sample: A=1.2e6, T=2000 K, W=4.5 eV;
 * T↑ ⇒ J↑ strongly; W↑ ⇒ J↓; T≤0 illegal.
 */
export function runRichardsonSample(opts?: {
  A?: number
  T?: number
  W?: number
  k?: number
}): {
  A: number
  T: number
  W: number
  k: number
  J: number
  J_hotter: number
  J_higherW: number
  J_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RICHARDSON
  familyId: typeof METHOD_THERMIONIC
} {
  const A = opts?.A ?? DEFAULT_A
  const T = opts?.T ?? DEFAULT_T
  const W = opts?.W ?? DEFAULT_W
  const k = opts?.k ?? K_EV

  const J = richardsonJ(A, T, W, k)
  const J_hotter = richardsonJ(A, T + 200, W, k)
  const J_higherW = richardsonJ(A, T, W + 0.5, k)
  const J_badT = richardsonJ(A, 0, W, k)

  const finite =
    Number.isFinite(J) &&
    Number.isFinite(J_hotter) &&
    Number.isFinite(J_higherW)

  const expected = A * T * T * Math.exp(-W / (k * T))
  const formulaOk =
    Math.abs(J - expected) < 1e-10 * Math.max(1, Math.abs(J))
  const hotterOk = J_hotter > J
  const workOk = J_higherW < J
  const posOk = J > 0
  const badOk = !Number.isFinite(J_badT)

  const ok = finite && formulaOk && hotterOk && workOk && posOk && badOk

  return {
    A,
    T,
    W,
    k,
    J,
    J_hotter,
    J_higherW,
    J_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_RICHARDSON,
    familyId: METHOD_THERMIONIC,
  }
}
