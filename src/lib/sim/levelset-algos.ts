/**
 * 水平集 Level-set · 纯算法（圆界面符号距离 + 重新初始化残差）。
 * 对应 method-level-set / method-algo-sdf-circle。
 * 不修改 methods.data。
 */

/** 父族 · 水平集。 */
export const METHOD_LEVEL_SET = 'method-level-set'
/** @deprecated alias */
export const LEVELSET_PARENT = METHOD_LEVEL_SET

/** 子算法 · 圆界面符号距离场。 */
export const METHOD_ALGO_SDF_CIRCLE = 'method-algo-sdf-circle'

/**
 * 圆界面符号距离：φ(x,y) = √((x−cx)²+(y−cy)²) − R。
 * φ < 0 圆内，φ = 0 界面，φ > 0 圆外。
 */
export function signedDistanceCircle(
  x: number,
  y: number,
  cx: number,
  cy: number,
  R: number,
): number {
  if (!(R >= 0)) throw new Error('radius must be non-negative')
  return Math.hypot(x - cx, y - cy) - R
}

/**
 * 在规则网格上采样圆 SDF。
 */
export function sampleCircleSdf(
  nx: number,
  ny: number,
  opts: {
    x0?: number
    y0?: number
    dx?: number
    dy?: number
    cx?: number
    cy?: number
    R?: number
  } = {},
): { phi: Float64Array; dx: number; dy: number; cx: number; cy: number; R: number } {
  const dx = opts.dx ?? 1 / (nx - 1)
  const dy = opts.dy ?? 1 / (ny - 1)
  const x0 = opts.x0 ?? 0
  const y0 = opts.y0 ?? 0
  const cx = opts.cx ?? 0.5
  const cy = opts.cy ?? 0.5
  const R = opts.R ?? 0.25
  const phi = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * dy
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * dx
      phi[j * nx + i] = signedDistanceCircle(x, y, cx, cy, R)
    }
  }
  return { phi, dx, dy, cx, cy, R }
}

/**
 * 中心差分 |∇φ| 相对 1 的 L∞ / 均值残差（理想 SDF |∇φ|≡1）。
 */
export function reinitResidual(
  phi: ArrayLike<number>,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
): { maxRes: number; meanRes: number; samples: number } {
  let maxRes = 0
  let sum = 0
  let n = 0
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i
      const dphidx = (phi[k + 1]! - phi[k - 1]!) / (2 * dx)
      const dphidy = (phi[k + nx]! - phi[k - nx]!) / (2 * dy)
      const g = Math.hypot(dphidx, dphidy)
      const res = Math.abs(g - 1)
      if (res > maxRes) maxRes = res
      sum += res
      n++
    }
  }
  return { maxRes, meanRes: n ? sum / n : 0, samples: n }
}

/** 中心差分 |∇φ| 单点估计。 */
export function gradMagEstimate(
  phi: Float64Array,
  n: number,
  dx: number,
  i: number,
  j: number,
): number {
  const ix = (ii: number, jj: number) => jj * n + ii
  const ip = Math.min(n - 1, i + 1)
  const im = Math.max(0, i - 1)
  const jp = Math.min(n - 1, j + 1)
  const jm = Math.max(0, j - 1)
  const dphix = (phi[ix(ip, j)]! - phi[ix(im, j)]!) / ((ip - im) * dx || dx)
  const dphiy = (phi[ix(i, jp)]! - phi[ix(i, jm)]!) / ((jp - jm) * dx || dx)
  return Math.hypot(dphix, dphiy)
}

/** 常速法向推进一步：φ ← φ − dt · F · |∇φ|。 */
export function levelSetStep(
  phi: Float64Array,
  n: number,
  dx: number,
  dt: number,
  F: number,
): Float64Array {
  const out = new Float64Array(phi.length)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const g = gradMagEstimate(phi, n, dx, i, j)
      out[j * n + i] = phi[j * n + i]! - dt * F * g
    }
  }
  return out
}

/**
 * 圆 SDF 样例：中心负、界面≈0、|∇φ|≈1。
 */
export function runSdfCircleSample(n = 65): {
  phiCenter: number
  phiInterface: number
  R: number
  maxGradRes: number
  meanGradRes: number
  methodId: typeof METHOD_ALGO_SDF_CIRCLE
  familyId: typeof METHOD_LEVEL_SET
} {
  const R = 0.3
  const cx = 0.5
  const cy = 0.5
  const { phi, dx, dy } = sampleCircleSdf(n, n, { cx, cy, R })
  const phiCenter = phi[(n >> 1) * n + (n >> 1)]!
  const phiInterface = signedDistanceCircle(cx + R, cy, cx, cy, R)
  const { maxRes, meanRes } = reinitResidual(phi, n, n, dx, dy)
  return {
    phiCenter,
    phiInterface,
    R,
    maxGradRes: maxRes,
    meanGradRes: meanRes,
    methodId: METHOD_ALGO_SDF_CIRCLE,
    familyId: METHOD_LEVEL_SET,
  }
}

/** moduleRegistry 入口：圆 SDF + 法向推进。 */
export function runLevelSetSample(n = 33): {
  phiCenter: number
  phiFar: number
  gradMagNear: number
  zeroCrossBefore: number
  zeroCrossAfter: number
  expanded: boolean
  methodId: typeof METHOD_LEVEL_SET
} {
  const dx = 1 / (n - 1)
  const cx = 0.5
  const cy = 0.5
  const R = 0.2
  const phi = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      phi[j * n + i] = signedDistanceCircle(i * dx, j * dx, cx, cy, R)
    }
  }
  const mid = ((n / 2) | 0) * n + ((n / 2) | 0)
  const far = 0
  const iR = Math.min(n - 2, Math.max(1, Math.round((cx + R) / dx)))
  const j0 = (n / 2) | 0
  const gNear = gradMagEstimate(phi, n, dx, iR, j0)

  let zeroBefore = 0
  for (let i = 0; i < phi.length; i++) if (Math.abs(phi[i]!) < 0.5 * dx) zeroBefore++

  const dt = 0.5 * dx
  const F = 1
  const next = levelSetStep(phi, n, dx, dt, F)
  let zeroAfter = 0
  for (let i = 0; i < next.length; i++) if (Math.abs(next[i]!) < 0.5 * dx) zeroAfter++

  const expanded = next[mid]! < phi[mid]!
  return {
    phiCenter: phi[mid]!,
    phiFar: phi[far]!,
    gradMagNear: gNear,
    zeroCrossBefore: zeroBefore,
    zeroCrossAfter: zeroAfter,
    expanded,
    methodId: METHOD_LEVEL_SET,
  }
}
