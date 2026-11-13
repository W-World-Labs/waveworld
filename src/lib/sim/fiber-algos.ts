/**
 * 光纤传播 · 纯算法教学 stub。
 * Beer-Lambert 衰减 P=P0 exp(-α L)；群时延/色散教学 stub。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 光纤光学。 */
export const METHOD_FIBER = 'method-fiber-optic'

/** 子算法 · Beer-Lambert 功率衰减。 */
export const METHOD_ALGO_FIBER_ATTEN = 'method-algo-fiber-atten'

/** 子算法 · 群时延/色散教学 stub。 */
export const METHOD_ALGO_FIBER_DISPERSION = 'method-algo-fiber-dispersion-stub'

export const FIBER_METHOD_IDS = [
  METHOD_ALGO_FIBER_ATTEN,
  METHOD_ALGO_FIBER_DISPERSION,
] as const

/**
 * Beer-Lambert 功率衰减：
 *   P(L) = P0 · exp(−α L)
 *
 * α: 线性衰减系数 (1/m)，L: 长度 (m)，P0: 入射功率。
 * α 或 L 为负时返回 NaN（物理域外）。
 */
export function fiberPowerAtten(
  P0: number,
  alpha: number,
  length: number,
): number {
  if (
    !Number.isFinite(P0) ||
    !Number.isFinite(alpha) ||
    !Number.isFinite(length) ||
    !(alpha >= 0) ||
    !(length >= 0) ||
    !(P0 >= 0)
  ) {
    return NaN
  }
  return P0 * Math.exp(-alpha * length)
}

/**
 * 功率比（透射）T = P/P0 = exp(−α L)。
 * P0=0 时若 α,L 合法返回 exp(−α L)，否则 NaN。
 */
export function fiberTransmittance(alpha: number, length: number): number {
  if (
    !Number.isFinite(alpha) ||
    !Number.isFinite(length) ||
    !(alpha >= 0) ||
    !(length >= 0)
  ) {
    return NaN
  }
  return Math.exp(-alpha * length)
}

/**
 * 分贝损耗：A_dB = −10 log10(P/P0) = (10/ln10) α L ≈ 4.3429 α L。
 * 仅教学；与线性 α 一致。
 */
export function fiberLossDb(alpha: number, length: number): number {
  const T = fiberTransmittance(alpha, length)
  if (!(T > 0) || !Number.isFinite(T)) return NaN
  return -10 * Math.log10(T)
}

/**
 * 群时延教学 stub：
 *   τ_g = L · n_g / c
 *
 * n_g: 群折射率，c: 光速 (m/s)。默认 c=2.99792458e8。
 * 不建模材料色散曲线，仅 L 线性 stub。
 */
export function fiberGroupDelay(
  length: number,
  nGroup: number,
  c = 2.997_924_58e8,
): number {
  if (
    !Number.isFinite(length) ||
    !Number.isFinite(nGroup) ||
    !Number.isFinite(c) ||
    !(length >= 0) ||
    !(nGroup > 0) ||
    !(c > 0)
  ) {
    return NaN
  }
  return (length * nGroup) / c
}

/**
 * 色度色散时延展宽教学 stub（一阶）：
 *   Δτ ≈ |D| · L · Δλ
 *
 * D: 色散参量 (s/(m·m) 即 s/(m²)，常用 ps/(nm·km) 需换算)，
 * Δλ: 谱宽 (m，与 D 量纲一致)。
 * 返回 |Δτ| ≥ 0。
 */
export function fiberDispersionBroaden(
  D: number,
  length: number,
  deltaLambda: number,
): number {
  if (
    !Number.isFinite(D) ||
    !Number.isFinite(length) ||
    !Number.isFinite(deltaLambda) ||
    !(length >= 0) ||
    !(deltaLambda >= 0)
  ) {
    return NaN
  }
  return Math.abs(D) * length * deltaLambda
}

/**
 * 衰减样例：P=P0 exp(−α L)；L=0 → P=P0；加倍 L 平方透射。
 */
export function runFiberAttenSample(opts?: {
  P0?: number
  alpha?: number
  length?: number
}): {
  P0: number
  alpha: number
  length: number
  P: number
  T: number
  lossDb: number
  P_zeroL: number
  T_double: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FIBER_ATTEN
  familyId: typeof METHOD_FIBER
} {
  const P0 = opts?.P0 ?? 1
  const alpha = opts?.alpha ?? 0.05 // 1/m 教学值
  const length = opts?.length ?? 10 // m
  const P = fiberPowerAtten(P0, alpha, length)
  const T = fiberTransmittance(alpha, length)
  const lossDb = fiberLossDb(alpha, length)
  const P_zeroL = fiberPowerAtten(P0, alpha, 0)
  const T_double = fiberTransmittance(alpha, 2 * length)
  const T_sq = T * T

  const finite =
    Number.isFinite(P) &&
    Number.isFinite(T) &&
    Number.isFinite(lossDb) &&
    Number.isFinite(P_zeroL) &&
    Number.isFinite(T_double)

  const beerOk = Math.abs(P - P0 * Math.exp(-alpha * length)) < 1e-14
  const zeroOk = Math.abs(P_zeroL - P0) < 1e-14
  const doubleOk = Math.abs(T_double - T_sq) < 1e-12
  const monoOk = P <= P0 + 1e-15 && T > 0 && T <= 1 + 1e-15

  const ok = finite && beerOk && zeroOk && doubleOk && monoOk && P0 > 0

  return {
    P0,
    alpha,
    length,
    P,
    T,
    lossDb,
    P_zeroL,
    T_double,
    finite,
    ok,
    methodId: METHOD_ALGO_FIBER_ATTEN,
    familyId: METHOD_FIBER,
  }
}

/**
 * 色散样例：群时延 ∝ L；展宽 ∝ L·Δλ；有限且非负。
 */
export function runFiberDispersionSample(opts?: {
  length?: number
  nGroup?: number
  D?: number
  deltaLambda?: number
}): {
  length: number
  nGroup: number
  D: number
  deltaLambda: number
  tauG: number
  tauG_double: number
  deltaTau: number
  deltaTau_doubleL: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FIBER_DISPERSION
  familyId: typeof METHOD_FIBER
} {
  const length = opts?.length ?? 1000 // m
  const nGroup = opts?.nGroup ?? 1.468
  // 教学量纲：D 取 s/(m·m)，Δλ 取 m
  const D = opts?.D ?? 1e-5
  const deltaLambda = opts?.deltaLambda ?? 1e-9 // ~1 nm

  const tauG = fiberGroupDelay(length, nGroup)
  const tauG_double = fiberGroupDelay(2 * length, nGroup)
  const deltaTau = fiberDispersionBroaden(D, length, deltaLambda)
  const deltaTau_doubleL = fiberDispersionBroaden(D, 2 * length, deltaLambda)

  const finite =
    Number.isFinite(tauG) &&
    Number.isFinite(tauG_double) &&
    Number.isFinite(deltaTau) &&
    Number.isFinite(deltaTau_doubleL)

  const linDelay = Math.abs(tauG_double - 2 * tauG) < 1e-12 * Math.max(1, Math.abs(tauG))
  const linBroad =
    Math.abs(deltaTau_doubleL - 2 * deltaTau) < 1e-12 * Math.max(1, Math.abs(deltaTau))
  const nonNeg = tauG >= 0 && deltaTau >= 0

  const ok = finite && linDelay && linBroad && nonNeg && length > 0

  return {
    length,
    nGroup,
    D,
    deltaLambda,
    tauG,
    tauG_double,
    deltaTau,
    deltaTau_doubleL,
    finite,
    ok,
    methodId: METHOD_ALGO_FIBER_DISPERSION,
    familyId: METHOD_FIBER,
  }
}
