/**
 * 几何光学二级算法 · 菲涅耳正入射反射 / 全反射临界角。
 * 与 method-algo-snell / method-ray-optics 并立（L2 装配，不改 methods.data）。
 * 可选交叉校验：fdtd.fresnelReflection（ε=n² 非磁性）。
 */
import { fresnelReflection } from './fdtd'

/** 父族（与 methods.data 中 ray-optics 对齐）。 */
export const OPTICS_L2_PARENT = 'method-ray-optics'

/** 一级 · 斯涅尔折射（已有 research-algos / registry）。 */
export const OPTICS_SNELL_ID = 'method-algo-snell'

/**
 * 二级 · 菲涅耳正入射功率反射率（仅常量，不写 methods.data）。
 * 物理：R = ((n1−n2)/(n1+n2))²。
 */
export const OPTICS_FRESNEL_ID = 'method-algo-fresnel-normal'

/**
 * 二级 · 全反射临界角（仅常量）。
 * θc = arcsin(n2/n1)，n1 > n2。
 */
export const OPTICS_CRITICAL_ID = 'method-algo-critical-angle'

export const OPTICS_L2_METHOD_IDS = [
  OPTICS_SNELL_ID,
  OPTICS_FRESNEL_ID,
  OPTICS_CRITICAL_ID,
] as const

// ═══════════════════════════════════════════════════════════════════════════
// 菲涅耳 · 正入射（s/p 退化为同一值）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 正入射振幅反射系数（带符号）r = (n1 − n2)/(n1 + n2)。
 * 从密到疏 n1>n2 时 r>0；疏→密 r<0（π 相位跳）。
 */
export function fresnelAmplitudeR(n1: number, n2: number): number {
  if (!(n1 > 0) || !(n2 > 0)) throw new Error('indices must be positive')
  return (n1 - n2) / (n1 + n2)
}

/**
 * 正入射功率反射率 R = r² = ((n1−n2)/(n1+n2))²。
 * 正入射时 s 与 p 偏振相同；|r| 与 fdtd.fresnelReflection(n1²,n2²) 一致。
 */
export function fresnelPowerR(n1: number, n2: number): number {
  const r = fresnelAmplitudeR(n1, n2)
  return r * r
}

/**
 * 正入射功率透射率（能量守恒，无吸收界面）：T = 1 − R。
 * 注：振幅透射 t 另含阻抗因子；此处仅功率口径。
 */
export function fresnelPowerT(n1: number, n2: number): number {
  return 1 - fresnelPowerR(n1, n2)
}

/**
 * 与 fdtd 内核交叉：|r| = fresnelReflection(ε1,ε2)，ε=n²（μr=1）。
 */
export function fresnelAmplitudeAbsViaEps(n1: number, n2: number): number {
  return fresnelReflection(n1 * n1, n2 * n2)
}

// ═══════════════════════════════════════════════════════════════════════════
// 全反射临界角
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 临界角（弧度）：密→疏 n1>n2 时 θc = arcsin(n2/n1)。
 * n1 ≤ n2 时不可能 TIR，返回 NaN。
 */
export function criticalAngle(n1: number, n2: number): number {
  if (!(n1 > 0) || !(n2 > 0)) throw new Error('indices must be positive')
  if (!(n1 > n2)) return Number.NaN
  return Math.asin(n2 / n1)
}

/** 入射角（相对法线）是否全反射：n1>n2 且 θ1 ≥ θc。 */
export function isTotalInternalReflection(
  n1: number,
  n2: number,
  theta1: number,
): boolean {
  const tc = criticalAngle(n1, n2)
  if (!Number.isFinite(tc)) return false
  return theta1 >= tc - 1e-15
}

// ═══════════════════════════════════════════════════════════════════════════
// 代表样例 runners
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 空气→玻璃 n=1→1.5：R = ((1−1.5)/(1+1.5))² = 0.04；
 * 与 fdtd |r| 及 |r|² 交叉校验。
 */
export function runFresnelNormalSample(): {
  n1: number
  n2: number
  r: number
  R: number
  T: number
  absRViaFdtd: number
  methodId: typeof OPTICS_FRESNEL_ID
} {
  const n1 = 1
  const n2 = 1.5
  const r = fresnelAmplitudeR(n1, n2)
  const R = fresnelPowerR(n1, n2)
  return {
    n1,
    n2,
    r,
    R,
    T: fresnelPowerT(n1, n2),
    absRViaFdtd: fresnelAmplitudeAbsViaEps(n1, n2),
    methodId: OPTICS_FRESNEL_ID,
  }
}

/**
 * 玻璃→空气 n=1.5→1：θc = arcsin(1/1.5)≈41.81°；
 * θ=45° 全反射，θ=30° 可折射。
 */
export function runCriticalAngleSample(): {
  n1: number
  n2: number
  thetaC: number
  thetaCdeg: number
  tirAt45: boolean
  tirAt30: boolean
  methodId: typeof OPTICS_CRITICAL_ID
} {
  const n1 = 1.5
  const n2 = 1
  const thetaC = criticalAngle(n1, n2)
  return {
    n1,
    n2,
    thetaC,
    thetaCdeg: (thetaC * 180) / Math.PI,
    tirAt45: isTotalInternalReflection(n1, n2, Math.PI / 4),
    tirAt30: isTotalInternalReflection(n1, n2, Math.PI / 6),
    methodId: OPTICS_CRITICAL_ID,
  }
}
