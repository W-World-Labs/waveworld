/**
 * Fick's first law · pure teaching stubs.
 * J = −D · dC/dx  (use ΔC/Δx).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Fick diffusion. */
export const METHOD_FICK = 'method-fick-diffusion'

/** Algo · diffusive flux J = −D ΔC/Δx. */
export const METHOD_ALGO_FICK_FLUX = 'method-algo-fick-flux'

/** Parent alias (aligns with familyId). */
export const FICK_PARENT = METHOD_FICK

export const FICK_METHOD_IDS = [METHOD_ALGO_FICK_FLUX] as const

/** Default diffusivity D (m²/s); liquid-class toy. */
export const DEFAULT_D = 1e-9

/** Default concentration difference ΔC (mol/m³). */
export const DEFAULT_DELTA_C = 100

/** Default length Δx (m). */
export const DEFAULT_DELTA_X = 1e-3

/**
 * Fickian molar flux (mol/(m²·s) teaching):
 *   J = −D · (ΔC / Δx)
 *
 * D: diffusivity (m²/s), deltaC: concentration difference,
 * deltaX: spatial interval (m). Requires deltaX ≠ 0, finite; else NaN.
 * Sign: positive ΔC (high→low along +x) yields negative J (down-gradient).
 */
export function fickFlux(D: number, deltaC: number, deltaX: number): number {
  if (
    !Number.isFinite(D) ||
    !Number.isFinite(deltaC) ||
    !Number.isFinite(deltaX) ||
    deltaX === 0
  ) {
    return NaN
  }
  const j = -D * (deltaC / deltaX)
  return j === 0 ? 0 : j
}

/**
 * Fick sample: J = −D ΔC/Δx; linear in D and ΔC; zero ΔC ⇒ J=0;
 * doubles with D; illegal Δx=0.
 */
export function runFickFluxSample(opts?: {
  D?: number
  deltaC?: number
  deltaX?: number
}): {
  D: number
  deltaC: number
  deltaX: number
  J: number
  J_doubleD: number
  J_zeroC: number
  J_badX: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FICK_FLUX
  familyId: typeof METHOD_FICK
} {
  const D = opts?.D ?? DEFAULT_D
  const deltaC = opts?.deltaC ?? DEFAULT_DELTA_C
  const deltaX = opts?.deltaX ?? DEFAULT_DELTA_X

  const J = fickFlux(D, deltaC, deltaX)
  const J_doubleD = fickFlux(2 * D, deltaC, deltaX)
  const J_zeroC = fickFlux(D, 0, deltaX)
  const J_badX = fickFlux(D, deltaC, 0)

  const finite =
    Number.isFinite(J) &&
    Number.isFinite(J_doubleD) &&
    Number.isFinite(J_zeroC)

  const expected = -D * (deltaC / deltaX)
  const formulaOk =
    Math.abs(J - expected) < 1e-18 * Math.max(1, Math.abs(J))
  const linDOk =
    Math.abs(J_doubleD - 2 * J) < 1e-18 * Math.max(1, Math.abs(J))
  const zeroOk = Math.abs(J_zeroC) < 1e-30
  // Down-gradient: ΔC>0, Δx>0, D>0 ⇒ J < 0
  const signOk = D > 0 && deltaC > 0 && deltaX > 0 ? J < 0 : true
  const badOk = !Number.isFinite(J_badX)

  const ok = finite && formulaOk && linDOk && zeroOk && signOk && badOk

  return {
    D,
    deltaC,
    deltaX,
    J,
    J_doubleD,
    J_zeroC,
    J_badX,
    finite,
    ok,
    methodId: METHOD_ALGO_FICK_FLUX,
    familyId: METHOD_FICK,
  }
}
