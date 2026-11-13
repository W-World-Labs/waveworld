/**
 * Radiation view factors · pure teaching stubs.
 * Infinite parallel plates: F12 = 1
 * Facing disks approx: F12 = 1 / (1 + (H/R)²)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · view / configuration factor. */
export const METHOD_VIEW = 'method-view-factor'

/** Algo · parallel / facing-disk view-factor stubs. */
export const METHOD_ALGO_VIEW_PARALLEL = 'method-algo-view-parallel'

/** Parent alias. */
export const VIEW_PARENT = METHOD_VIEW

export const VIEW_METHOD_IDS = [METHOD_ALGO_VIEW_PARALLEL] as const

/** Default plate separation H (m) for facing-disk approx. */
export const DEFAULT_H = 1

/** Default disk radius R (m). */
export const DEFAULT_R = 1

/**
 * Infinite parallel plates (teaching):
 *   F12 = 1
 *
 * Any finite geometry args are accepted but unused — returns 1.
 * Non-finite → NaN for consistency with callers that pass H,R.
 */
export function viewFactorParallelInfinite(
  _h?: number,
  _r?: number,
): number {
  if (
    (_h !== undefined && !Number.isFinite(_h)) ||
    (_r !== undefined && !Number.isFinite(_r))
  ) {
    return NaN
  }
  return 1
}

/**
 * Facing equal-radius disks (teaching approx):
 *   F12 = 1 / (1 + (H/R)²)
 *
 * H: separation (m), R: radius (m). Requires R>0, H≥0, finite; else NaN.
 * As H→0, F→1; as H→∞, F→0.
 */
export function viewFactorFacingDisks(H: number, R: number): number {
  if (
    !Number.isFinite(H) ||
    !Number.isFinite(R) ||
    !(R > 0) ||
    !(H >= 0)
  ) {
    return NaN
  }
  const x = H / R
  return 1 / (1 + x * x)
}

/**
 * Concentric spheres / cylinders outer-from-inner stub:
 *   F12 = r1 / r2   (r1 < r2; inner surface fully sees outer)
 *
 * Requires 0 < r1 ≤ r2, finite; else NaN. When r1=r2, F=1.
 */
export function viewFactorConcentric(r1: number, r2: number): number {
  if (
    !Number.isFinite(r1) ||
    !Number.isFinite(r2) ||
    !(r1 > 0) ||
    !(r2 > 0) ||
    !(r1 <= r2)
  ) {
    return NaN
  }
  return r1 / r2
}

/**
 * View-factor sample: parallel F=1; disks formula; concentric ratio.
 */
export function runViewParallelSample(opts?: {
  H?: number
  R?: number
  r1?: number
  r2?: number
}): {
  H: number
  R: number
  r1: number
  r2: number
  F_parallel: number
  F_disks: number
  F_disks_H0: number
  F_concentric: number
  F_badR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VIEW_PARALLEL
  familyId: typeof METHOD_VIEW
} {
  const H = opts?.H ?? DEFAULT_H
  const R = opts?.R ?? DEFAULT_R
  const r1 = opts?.r1 ?? 0.5
  const r2 = opts?.r2 ?? 1

  const F_parallel = viewFactorParallelInfinite(H, R)
  const F_disks = viewFactorFacingDisks(H, R)
  const F_disks_H0 = viewFactorFacingDisks(0, R)
  const F_concentric = viewFactorConcentric(r1, r2)
  const F_badR = viewFactorFacingDisks(H, 0)

  const finite =
    Number.isFinite(F_parallel) &&
    Number.isFinite(F_disks) &&
    Number.isFinite(F_disks_H0) &&
    Number.isFinite(F_concentric)

  const parallelOk = Math.abs(F_parallel - 1) < 1e-18
  const x = H / R
  const disksExpected = 1 / (1 + x * x)
  const disksOk =
    Math.abs(F_disks - disksExpected) < 1e-12 * Math.max(1, Math.abs(F_disks))
  const H0Ok = Math.abs(F_disks_H0 - 1) < 1e-18
  const concOk =
    Math.abs(F_concentric - r1 / r2) < 1e-12 * Math.max(1, Math.abs(F_concentric))
  const rangeOk = F_disks > 0 && F_disks <= 1 && F_concentric > 0 && F_concentric <= 1
  const badOk = !Number.isFinite(F_badR)

  const ok =
    finite && parallelOk && disksOk && H0Ok && concOk && rangeOk && badOk

  return {
    H,
    R,
    r1,
    r2,
    F_parallel,
    F_disks,
    F_disks_H0,
    F_concentric,
    F_badR,
    finite,
    ok,
    methodId: METHOD_ALGO_VIEW_PARALLEL,
    familyId: METHOD_VIEW,
  }
}
