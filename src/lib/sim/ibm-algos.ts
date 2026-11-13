/**
 * 浸没边界 IBM · 纯算法（1D δ 核力铺展，总力守恒）。
 * 对应 method-immersed-boundary / method-algo-ibm-delta。
 * Peskin 余弦核 φ₄ 在 Euler 格点上铺展 Lagrangian 点力。
 * 不修改 methods.data。
 */

/** 父族 · 浸没边界。 */
export const METHOD_IMMERSED_BOUNDARY = 'method-immersed-boundary'
/** @deprecated alias */
export const IBM_PARENT = METHOD_IMMERSED_BOUNDARY

/** 子算法 · 1D δ 核力铺展。 */
export const METHOD_ALGO_IBM_DELTA = 'method-algo-ibm-delta'

/** 子算法 · 1D δ 核速度插值。 */
export const METHOD_ALGO_IBM_INTERPOLATE = 'method-algo-ibm-interpolate'

/**
 * Peskin 四支撑余弦核 φ(r)：
 *   (1/4)(1 + cos(π r / 2))  |r| < 2
 *   0                        otherwise
 */
export function peskinPhi4(r: number): number {
  const a = Math.abs(r)
  if (a >= 2) return 0
  return 0.25 * (1 + Math.cos((Math.PI * a) / 2))
}

/** 别名 */
export const peskinPhi = peskinPhi4

/** δ_h(x) = (1/h) φ(x/h) */
export function ibmDelta(x: number, h: number): number {
  if (!(h > 0)) throw new Error('h must be positive')
  return peskinPhi4(x / h) / h
}

/**
 * 将位于 X 的 Lagrangian 点力 F 累加铺展到 force[i]，x_i = x0 + i·h。
 * 返回 ∑ force[i]·h（应 ≈ F）。
 */
export function spreadForce1d(
  force: Float64Array,
  X: number,
  F: number,
  h: number,
  x0 = 0,
): number {
  const N = force.length
  const rMin = Math.floor((X - x0) / h - 2) - 1
  const rMax = Math.ceil((X - x0) / h + 2) + 1
  for (let i = Math.max(0, rMin); i < Math.min(N, rMax + 1); i++) {
    const xi = x0 + i * h
    force[i]! += F * ibmDelta(xi - X, h)
  }
  let total = 0
  for (let i = 0; i < N; i++) total += force[i]! * h
  return total
}

/**
 * 周期 1D 铺展（moduleRegistry 风格）：返回新数组 f。
 */
export function spreadForce1dPeriodic(
  F: number,
  x: number,
  n: number,
  dx: number,
): Float64Array {
  const f = new Float64Array(n)
  const L = n * dx
  const xp = ((x % L) + L) % L
  for (let i = 0; i < n; i++) {
    let d = (xp - i * dx) / dx
    if (d > n / 2) d -= n
    if (d < -n / 2) d += n
    f[i]! += (F * peskinPhi4(d)) / dx
  }
  return f
}

/** 从欧拉场插值到拉格朗日点。 */
export function interpolate1d(
  u: ArrayLike<number>,
  x: number,
  n: number,
  dx: number,
): number {
  const L = n * dx
  const xp = ((x % L) + L) % L
  let acc = 0
  for (let i = 0; i < n; i++) {
    let d = (xp - i * dx) / dx
    if (d > n / 2) d -= n
    if (d < -n / 2) d += n
    acc += u[i]! * peskinPhi4(d)
  }
  return acc
}

/**
 * IBM δ 铺展样例：∑ f_i h = F。
 */
export function runIbmDeltaSample(): {
  F: number
  gridTotal: number
  forceErr: number
  peakIndex: number
  peakValue: number
  methodId: typeof METHOD_ALGO_IBM_DELTA
  familyId: typeof METHOD_IMMERSED_BOUNDARY
} {
  const N = 64
  const h = 1
  const x0 = 0
  const X = 32.3
  const F = 2.5
  const force = new Float64Array(N)
  const gridTotal = spreadForce1d(force, X, F, h, x0)
  let peakIndex = 0
  let peakValue = 0
  for (let i = 0; i < N; i++) {
    if (Math.abs(force[i]!) > Math.abs(peakValue)) {
      peakValue = force[i]!
      peakIndex = i
    }
  }
  return {
    F,
    gridTotal,
    forceErr: Math.abs(gridTotal - F),
    peakIndex,
    peakValue,
    methodId: METHOD_ALGO_IBM_DELTA,
    familyId: METHOD_IMMERSED_BOUNDARY,
  }
}

/** moduleRegistry 入口。 */
export function runIbmSample(): {
  F: number
  sumForce: number
  forceRatio: number
  interpConst: number
  methodId: typeof METHOD_IMMERSED_BOUNDARY
} {
  const n = 32
  const dx = 1
  const F = 2.5
  const x = 10.3
  const f = spreadForce1dPeriodic(F, x, n, dx)
  let sumForce = 0
  for (let i = 0; i < n; i++) sumForce += f[i]! * dx

  const u = new Float64Array(n)
  u.fill(7)
  const interpConst = interpolate1d(u, x, n, dx)

  return {
    F,
    sumForce,
    forceRatio: sumForce / F,
    interpConst,
    methodId: METHOD_IMMERSED_BOUNDARY,
  }
}

/**
 * IBM δ 核插值样例：常数场 u≡c → 插值 = c；线性场局部再现。
 */
export function runIbmInterpolateSample(): {
  constField: number
  interpConst: number
  constErr: number
  linearFieldAt: number
  interpLinear: number
  linearErr: number
  methodId: typeof METHOD_ALGO_IBM_INTERPOLATE
  familyId: typeof METHOD_IMMERSED_BOUNDARY
} {
  const n = 64
  const dx = 1
  const x = 20.4
  const c = 3.5
  const uConst = new Float64Array(n)
  uConst.fill(c)
  const interpConst = interpolate1d(uConst, x, n, dx)

  // 周期线性场在短支撑内近似：u_i = a + b·i（小斜率）
  const a = 1
  const b = 0.02
  const uLin = new Float64Array(n)
  for (let i = 0; i < n; i++) uLin[i] = a + b * i
  const interpLinear = interpolate1d(uLin, x, n, dx)
  // 期望 ≈ a + b·(x/dx)（Peskin 核一阶矩近似）
  const linearFieldAt = a + b * (x / dx)

  return {
    constField: c,
    interpConst,
    constErr: Math.abs(interpConst - c),
    linearFieldAt,
    interpLinear,
    linearErr: Math.abs(interpLinear - linearFieldAt),
    methodId: METHOD_ALGO_IBM_INTERPOLATE,
    familyId: METHOD_IMMERSED_BOUNDARY,
  }
}
