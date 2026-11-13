/**
 * SPH（Smoothed Particle Hydrodynamics）· 纯算法核。
 * 1D Monaghan 三次样条核 + 密度求和 ρ_i = Σ_j m_j W(|x_i−x_j|, h)。
 * method id 仅常量；catalog / methods.data / moduleRegistry 稍后接线。
 */

/** 父族 · SPH。 */
export const METHOD_SPH = 'method-sph'
/** @deprecated alias */
export const SPH_PARENT = METHOD_SPH

/** 子算法 · 1D 三次样条核（Monaghan）。 */
export const METHOD_ALGO_SPH_CUBIC_SPLINE = 'method-algo-sph-cubic-spline'

/** 子算法 · 密度求和。 */
export const METHOD_ALGO_SPH_DENSITY_SUM = 'method-algo-sph-density-sum'

export const SPH_METHOD_IDS = [
  METHOD_ALGO_SPH_CUBIC_SPLINE,
  METHOD_ALGO_SPH_DENSITY_SUM,
] as const

/**
 * 1D Monaghan 三次样条核 W(q, h)，q = r/h ≥ 0：
 *
 *   W = (2/(3h)) · {
 *     1 − 1.5 q² + 0.75 q³   if 0 ≤ q < 1
 *     0.25 (2−q)³             if 1 ≤ q < 2
 *     0                       otherwise
 *   }
 *
 * 归一化：∫_{−∞}^{∞} W(|r|/h, h) dr = 1（1D）。
 * 支撑半径 2h。
 */
export function cubicSplineW(q: number, h: number): number {
  if (!(h > 0) || !Number.isFinite(h) || !Number.isFinite(q)) return 0
  const qq = Math.abs(q)
  const c = 2 / (3 * h)
  if (qq < 1) {
    return c * (1 - 1.5 * qq * qq + 0.75 * qq * qq * qq)
  }
  if (qq < 2) {
    const t = 2 - qq
    return c * 0.25 * t * t * t
  }
  return 0
}

/**
 * 对 r = |x_i − x_j| 求 W：内部转 q = r/h。
 */
export function cubicSplineWFromR(r: number, h: number): number {
  if (!(h > 0)) return 0
  return cubicSplineW(Math.abs(r) / h, h)
}

/**
 * 可选：∂W/∂r 径向导数（1D，r ≥ 0）。
 * dW/dr = (1/h) dW/dq。
 *
 *   dW/dq = (2/(3h)) · {
 *     −3 q + 2.25 q²     if 0 ≤ q < 1
 *     −0.75 (2−q)²       if 1 ≤ q < 2
 *     0                  otherwise
 *   }
 */
export function cubicSplineGradW(q: number, h: number): number {
  if (!(h > 0) || !Number.isFinite(h) || !Number.isFinite(q)) return 0
  const qq = Math.abs(q)
  const c = 2 / (3 * h)
  let dWdq = 0
  if (qq < 1) {
    dWdq = c * (-3 * qq + 2.25 * qq * qq)
  } else if (qq < 2) {
    const t = 2 - qq
    dWdq = c * (-0.75 * t * t)
  } else {
    return 0
  }
  // dW/dr = dW/dq · dq/dr = dW/dq / h；符号随 q 的绝对值导数在 r≥0 为负向
  return dWdq / h
}

/**
 * SPH 密度求和：ρ_i = Σ_j m_j W(|x_i − x_j|, h)。
 * x、m 等长；i 为粒子下标。
 */
export function sphDensitySum(
  x: Float64Array,
  m: Float64Array,
  h: number,
  i: number,
): number {
  const n = x.length
  if (i < 0 || i >= n || m.length !== n || !(h > 0)) return 0
  const xi = x[i]!
  let rho = 0
  for (let j = 0; j < n; j++) {
    const r = Math.abs(xi - x[j]!)
    rho += m[j]! * cubicSplineWFromR(r, h)
  }
  return rho
}

/**
 * 对全部粒子求密度，返回新 Float64Array。
 */
export function sphDensityAll(
  x: Float64Array,
  m: Float64Array,
  h: number,
): Float64Array {
  const n = x.length
  const rho = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    rho[i] = sphDensitySum(x, m, h, i)
  }
  return rho
}

/**
 * 数值积分 ∫ W(|r|/h, h) dr 于 [−R, R]（R = 2h 足够）。
 * 理想值 = 1。
 */
export function integrateCubicSplineW(
  h: number,
  nSteps = 4000,
): number {
  if (!(h > 0)) return 0
  const R = 2 * h
  const dr = (2 * R) / nSteps
  let s = 0
  for (let k = 0; k <= nSteps; k++) {
    const r = -R + k * dr
    const w = cubicSplineWFromR(Math.abs(r), h)
    // 梯形
    const weight = k === 0 || k === nSteps ? 0.5 : 1
    s += weight * w
  }
  return s * dr
}

/**
 * 三次样条核样例：
 * - W(0) > 0，支撑外 = 0
 * - q=1 处两支连续
 * - 数值积分 ≈ 1
 */
export function runSphCubicSplineSample(opts?: {
  h?: number
}): {
  h: number
  w0: number
  wAt1Left: number
  wAt1Right: number
  contErrAt1: number
  wOutside: number
  integral: number
  integralErr: number
  ok: boolean
  methodId: typeof METHOD_ALGO_SPH_CUBIC_SPLINE
  familyId: typeof METHOD_SPH
} {
  const h = opts?.h ?? 1
  const w0 = cubicSplineW(0, h)
  // 两支在 q=1 的解析值应一致
  const wAt1Left = (2 / (3 * h)) * (1 - 1.5 + 0.75) // 0.25 * 2/(3h)
  const wAt1Right = (2 / (3 * h)) * 0.25 * 1 // (2−1)³=1
  const contErrAt1 = Math.abs(cubicSplineW(1, h) - wAt1Left)
  const wOutside = cubicSplineW(2.01, h) + cubicSplineW(3, h)
  const integral = integrateCubicSplineW(h)
  const integralErr = Math.abs(integral - 1)
  const ok =
    w0 > 0 &&
    wOutside === 0 &&
    contErrAt1 < 1e-12 &&
    Math.abs(wAt1Left - wAt1Right) < 1e-12 &&
    integralErr < 0.02

  return {
    h,
    w0,
    wAt1Left,
    wAt1Right,
    contErrAt1,
    wOutside,
    integral,
    integralErr,
    ok,
    methodId: METHOD_ALGO_SPH_CUBIC_SPLINE,
    familyId: METHOD_SPH,
  }
}

/**
 * 密度求和样例：均匀 1D 晶格 x_i = i·Δx，m = ρ0·Δx，h = κ·Δx。
 * 内部粒子 ρ ≈ ρ0（有限支撑截断导致边界偏低）。
 */
export function runSphDensitySumSample(opts?: {
  n?: number
  dx?: number
  rho0?: number
  /** h / dx，缺省 1.5 */
  kappa?: number
}): {
  n: number
  dx: number
  h: number
  rho0: number
  /** 内部粒子（去掉两端 2h 邻域）平均密度 */
  meanRhoInterior: number
  /** 内部密度相对 ρ0 的 max |ρ−ρ0|/ρ0 */
  maxRelErrInterior: number
  /** 全体密度相对起伏 (max−min)/mean */
  relSpread: number
  ok: boolean
  methodId: typeof METHOD_ALGO_SPH_DENSITY_SUM
  familyId: typeof METHOD_SPH
} {
  const n = opts?.n ?? 64
  const dx = opts?.dx ?? 1
  const rho0 = opts?.rho0 ?? 1
  const kappa = opts?.kappa ?? 1.5
  const h = kappa * dx
  const m_i = rho0 * dx

  const x = new Float64Array(n)
  const m = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = i * dx
    m[i] = m_i
  }

  const rho = sphDensityAll(x, m, h)
  // 去掉两端约 2h 的粒子（支撑半宽）
  const margin = Math.ceil((2 * h) / dx) + 1
  let sum = 0
  let count = 0
  let maxRel = 0
  let rMin = Infinity
  let rMax = -Infinity
  for (let i = margin; i < n - margin; i++) {
    const ri = rho[i]!
    sum += ri
    count++
    const rel = Math.abs(ri - rho0) / Math.max(rho0, 1e-30)
    if (rel > maxRel) maxRel = rel
    if (ri < rMin) rMin = ri
    if (ri > rMax) rMax = ri
  }
  const meanRhoInterior = count > 0 ? sum / count : 0
  const relSpread =
    meanRhoInterior > 0 ? (rMax - rMin) / meanRhoInterior : Infinity
  const ok =
    count > 0 &&
    Number.isFinite(meanRhoInterior) &&
    maxRel < 0.08 &&
    relSpread < 0.05

  return {
    n,
    dx,
    h,
    rho0,
    meanRhoInterior,
    maxRelErrInterior: maxRel,
    relSpread,
    ok,
    methodId: METHOD_ALGO_SPH_DENSITY_SUM,
    familyId: METHOD_SPH,
  }
}
