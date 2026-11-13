/**
 * Zernike defocus · pure teaching stubs.
 * Z₂⁰ defocus ~ 2r² − 1; sample RMS of piston/defocus mode amplitude.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Zernike polynomials. */
export const METHOD_ZERNIKE = 'method-zernike'

/** Algo · Z₂⁰ defocus mode. */
export const METHOD_ALGO_ZERNIKE_DEFOCUS = 'method-algo-zernike-defocus'

/** Parent alias (aligns with familyId). */
export const ZERNIKE_PARENT = METHOD_ZERNIKE

export const ZERNIKE_METHOD_IDS = [METHOD_ALGO_ZERNIKE_DEFOCUS] as const

/** Default radial sample count on unit disk. */
export const DEFAULT_N = 64

/** Default defocus coefficient a₂⁰ (waves / arbitrary units). */
export const DEFAULT_A20 = 1

/**
 * Noll/OSA Zernike defocus (radial only):
 *   Z₂⁰(r) = 2 r² − 1
 *
 * r: normalized pupil radius in [0, 1]. Non-finite → NaN.
 */
export function zernikeDefocus(r: number): number {
  if (!Number.isFinite(r)) return NaN
  return 2 * r * r - 1
}

/**
 * Piston Z₀⁰ = 1 (constant).
 */
export function zernikePiston(_r: number = 0): number {
  return 1
}

/**
 * RMS of a radial Zernike sample on a uniform r-grid (teaching, not
 * area-weighted). For pure defocus mode with amplitude a20:
 *   W(r) = a20 · (2r² − 1)
 * returns √⟨W²⟩ over n samples r ∈ [0,1].
 */
export function zernikeDefocusRms(a20: number, n: number = DEFAULT_N): number {
  if (!Number.isFinite(a20) || !Number.isFinite(n) || !(n >= 2)) return NaN
  const nPts = Math.floor(n)
  let sumSq = 0
  for (let i = 0; i < nPts; i++) {
    const r = i / (nPts - 1)
    const w = a20 * zernikeDefocus(r)
    sumSq += w * w
  }
  return Math.sqrt(sumSq / nPts)
}

/**
 * Zernike defocus sample: Z(0)=-1, Z(1)=1; RMS scales with |a20|.
 */
export function runZernikeDefocusSample(opts?: {
  a20?: number
  n?: number
}): {
  a20: number
  n: number
  Z0: number
  Z1: number
  Z_half: number
  rms: number
  rms_double: number
  piston: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ZERNIKE_DEFOCUS
  familyId: typeof METHOD_ZERNIKE
} {
  const a20 = opts?.a20 ?? DEFAULT_A20
  const n = opts?.n ?? DEFAULT_N

  const Z0 = zernikeDefocus(0)
  const Z1 = zernikeDefocus(1)
  const Z_half = zernikeDefocus(0.5)
  const rms = zernikeDefocusRms(a20, n)
  const rms_double = zernikeDefocusRms(2 * a20, n)
  const piston = zernikePiston(0)

  const finite =
    Number.isFinite(Z0) &&
    Number.isFinite(Z1) &&
    Number.isFinite(Z_half) &&
    Number.isFinite(rms) &&
    Number.isFinite(rms_double)

  const endpointsOk = Math.abs(Z0 - -1) < 1e-15 && Math.abs(Z1 - 1) < 1e-15
  // 2*(0.5)² − 1 = −0.5
  const halfOk = Math.abs(Z_half - -0.5) < 1e-15
  const rmsScaleOk =
    Math.abs(rms_double - 2 * rms) < 1e-12 * Math.max(1e-30, Math.abs(rms))
  const rmsPosOk = a20 !== 0 ? rms > 0 : Math.abs(rms) < 1e-30
  const pistonOk = piston === 1
  const badOk = !Number.isFinite(zernikeDefocus(NaN))

  const ok =
    finite &&
    endpointsOk &&
    halfOk &&
    rmsScaleOk &&
    rmsPosOk &&
    pistonOk &&
    badOk

  return {
    a20,
    n,
    Z0,
    Z1,
    Z_half,
    rms,
    rms_double,
    piston,
    finite,
    ok,
    methodId: METHOD_ALGO_ZERNIKE_DEFOCUS,
    familyId: METHOD_ZERNIKE,
  }
}
