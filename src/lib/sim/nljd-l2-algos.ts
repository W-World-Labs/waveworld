/**
 * NLJD 二级算法 · 三类目标（半导体 / 锈蚀 / 金属）完整判读流水线。
 * 委托 nljd.junctionCoefficients / harmonics / classify；
 * method id 仅常量，不改 methods.data。
 */
import {
  classify,
  harmonics,
  junctionCoefficients,
  type Harmonics,
  type JunctionKind,
} from './nljd'

/** 父族（与 methods.data 中 NLJD 对齐）。 */
export const NLJD_L2_PARENT = 'method-nljd'

/** 一级 · 多项式响应系数。 */
export const NLJD_L2_POLY_ID = 'method-algo-nljd-poly'

/** 一级 · 谐波分类。 */
export const NLJD_L2_CLASSIFY_ID = 'method-algo-nljd-classify'

/**
 * 二级 · 三类目标种类端到端（系数 → 谐波 → 分类）。
 * 仅常量，不写入 methods.data。
 */
export const NLJD_L2_TARGET_KINDS_ID = 'method-algo-nljd-target-kinds'

export const NLJD_L2_METHOD_IDS = [
  NLJD_L2_POLY_ID,
  NLJD_L2_CLASSIFY_ID,
  NLJD_L2_TARGET_KINDS_ID,
] as const

export const NLJD_TARGET_KINDS: readonly JunctionKind[] = [
  'semiconductor',
  'corrosion',
  'metal',
] as const

export interface TargetKindResult {
  kind: JunctionKind
  a2: number
  a3: number
  h: Harmonics
  classified: JunctionKind
  ok: boolean
}

/** 单目标：系数 → 谐波 → 分类，并标记是否与真值一致。 */
export function analyzeTarget(kind: JunctionKind): TargetKindResult {
  const { a2, a3 } = junctionCoefficients(kind)
  const h = harmonics(kind)
  const classified = classify(h)
  return { kind, a2, a3, h, classified, ok: classified === kind }
}

/**
 * 三类目标全部分类正确样例。
 * semiconductor → 2f 主导；corrosion → 3f 主导；metal → 仅 1f。
 */
export function runAllTargetsSample(): {
  results: TargetKindResult[]
  allOk: boolean
  semi: JunctionKind
  corrosion: JunctionKind
  metal: JunctionKind
  methodId: typeof NLJD_L2_TARGET_KINDS_ID
} {
  const results = NLJD_TARGET_KINDS.map(analyzeTarget)
  const byKind = Object.fromEntries(results.map((r) => [r.kind, r.classified])) as Record<
    JunctionKind,
    JunctionKind
  >
  return {
    results,
    allOk: results.every((r) => r.ok),
    semi: byKind.semiconductor,
    corrosion: byKind.corrosion,
    metal: byKind.metal,
    methodId: NLJD_L2_TARGET_KINDS_ID,
  }
}
