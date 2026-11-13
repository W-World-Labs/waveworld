/**
 * 超声 B 超二级算法 · 多线横向扫描合成 B 模矩阵。
 * 委托 ultrasound.aline / reflectionCoef；method id 仅常量，不改 methods.data。
 */
import { aline, reflectionCoef } from './ultrasound'

/** 父族（与 methods.data 中 B-mode 对齐）。 */
export const US_L2_PARENT = 'method-b-mode-ultrasound'

/** 一级 · 反射系数。 */
export const US_L2_REFLECTION_ID = 'method-algo-us-reflection'

/** 一级 · A 线。 */
export const US_L2_ALINE_ID = 'method-algo-us-aline'

/**
 * 二级 · 多线 B 模合成（横向扫描拼接 A 线）。
 * 仅常量，不写入 methods.data。
 */
export const US_L2_BMODE_COMPOSE_ID = 'method-algo-us-bmode-compose'

export const US_L2_METHOD_IDS = [
  US_L2_REFLECTION_ID,
  US_L2_ALINE_ID,
  US_L2_BMODE_COMPOSE_ID,
] as const

export type UsBoundary = { depth: number; r: number }

/**
 * 给定横向位置 lx∈[0,1]，构造分层体模 + 可选点状内含物的反射界面。
 * 分层 Z 用 reflectionCoef；内含物在横向中心附近加深反射。
 */
export function boundariesAtLx(
  lx: number,
  maxDepth: number,
  gain = 1,
): UsBoundary[] {
  // 组织层界面（归一深度 → 物理深度）
  const layerZ1 = [0.15, 0.4, 0.7] // 三界面
  const Z = [1.5, 1.38, 1.65, 1.7]
  const bs: UsBoundary[] = []
  for (let i = 0; i < layerZ1.length; i++) {
    const depth = layerZ1[i]! * maxDepth
    const r = reflectionCoef(Z[i]!, Z[i + 1]!)
    bs.push({ depth, r: r * gain })
  }
  // 横向局部强反射（囊肿 / 病灶）：|lx−0.5|<0.12 时在 depth≈0.55 加壁回波
  const cystCx = 0.5
  const cystHalf = 0.12
  if (Math.abs(lx - cystCx) < cystHalf) {
    const rWall = Math.abs(reflectionCoef(1.65, 1.48))
    bs.push({ depth: 0.55 * maxDepth, r: rWall * 1.8 * gain })
  }
  return bs
}

/**
 * 横向扫描多条 A 线，按列拼成 B 模幅度矩阵（行优先：line-major）。
 * out[li * samples + s] = 第 li 条 A 线深度采样 s。
 */
export function composeBmode(
  nLines: number,
  samples: number,
  maxDepth: number,
  atten: number,
  gain = 1,
): Float32Array {
  const out = new Float32Array(nLines * samples)
  if (nLines <= 0 || samples <= 0 || maxDepth <= 0) return out
  for (let li = 0; li < nLines; li++) {
    const lx = nLines === 1 ? 0.5 : li / (nLines - 1)
    const bs = boundariesAtLx(lx, maxDepth, gain)
    const a = aline(bs, maxDepth, samples, atten)
    out.set(a, li * samples)
  }
  return out
}

/** B 模矩阵能量（幅度平方和）。 */
export function bmodeEnergy(matrix: Float32Array): number {
  let e = 0
  for (let i = 0; i < matrix.length; i++) {
    const v = matrix[i]!
    e += v * v
  }
  return e
}

/** 统计矩阵中局部峰个数（列内三点峰）。 */
export function countBmodePeaks(matrix: Float32Array, nLines: number, samples: number): number {
  let peaks = 0
  for (let li = 0; li < nLines; li++) {
    const base = li * samples
    for (let s = 1; s < samples - 1; s++) {
      const v = matrix[base + s]!
      if (v > 1e-6 && v > matrix[base + s - 1]! && v >= matrix[base + s + 1]!) peaks++
    }
  }
  return peaks
}

/**
 * B 模合成样例：多线横向扫描，检查维度、能量有限、峰存在。
 */
export function runBmodeComposeSample(
  nLines = 32,
  samples = 128,
  maxDepth = 100,
  atten = 0.02,
): {
  nLines: number
  samples: number
  length: number
  energy: number
  peaks: number
  finite: boolean
  methodId: typeof US_L2_BMODE_COMPOSE_ID
} {
  const matrix = composeBmode(nLines, samples, maxDepth, atten)
  const energy = bmodeEnergy(matrix)
  const peaks = countBmodePeaks(matrix, nLines, samples)
  return {
    nLines,
    samples,
    length: matrix.length,
    energy,
    peaks,
    finite: Number.isFinite(energy) && energy >= 0,
    methodId: US_L2_BMODE_COMPOSE_ID,
  }
}
