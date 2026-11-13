/**
 * 光/声敏化 · 并行机理假说模块。
 * 共享 Jablonski 速率壳；不同假说 = 不同参数透镜（不裁决唯一真理）。
 */
import {
  branchFractions,
  defaultPhotoParams,
  steadyState,
  type PhotoParams,
} from './photosensitization'
import { parallelGroup } from '../../data/methods/methods'

export const SDT_PARALLEL_GROUP = 'sdt-mechanism'
export const PHOTO_PARENT = 'method-photosensitization-kinetics'

export type SdtVariantId = 'cavitation' | 'sonoluminescence' | 'piezo'

export const SDT_VARIANT_METHOD_IDS: Record<SdtVariantId, string> = {
  cavitation: 'method-variant-sdt-cavitation',
  sonoluminescence: 'method-variant-sdt-sonoluminescence',
  piezo: 'method-variant-sdt-piezo',
}

/** 各假说对应的参数预设（同一壳，不同强调）。 */
export function paramsForVariant(id: SdtVariantId): PhotoParams {
  const base = defaultPhotoParams()
  switch (id) {
    case 'cavitation':
      // 强超声激活 + 偏 Type I / 化学自由基通道
      return { ...base, k_exc: 1.2, k_I: 1.0, k_q: 0.8, O2: 0.7 }
    case 'sonoluminescence':
      // 光敏类：高激发 + Type II ¹O2 主导
      return { ...base, k_exc: 0.9, k_q: 2.5, k_I: 0.1, O2: 1.2 }
    case 'piezo':
      // 弱光子、直接三线态相关：中等 k_exc，偏低 Type II
      return { ...base, k_exc: 0.35, k_isc: 4.0, k_q: 0.6, k_I: 0.5 }
    default: {
      const _e: never = id
      return _e
    }
  }
}

export function runSdtVariant(id: SdtVariantId): {
  phiTss: number
  genRateSinglet: number
  branches: ReturnType<typeof branchFractions>
} {
  const p = paramsForVariant(id)
  const ss = steadyState(p)
  return {
    phiTss: ss.phiTss,
    genRateSinglet: ss.genRateSinglet,
    branches: branchFractions(p),
  }
}

/** 三假说并行：输出可比较的 ¹O2 生成率，且分支和为 1。 */
export function compareSdtParallels(): Record<SdtVariantId, number> {
  const out = {} as Record<SdtVariantId, number>
  for (const id of Object.keys(SDT_VARIANT_METHOD_IDS) as SdtVariantId[]) {
    out[id] = runSdtVariant(id).genRateSinglet
  }
  return out
}

export function sdtParallelCount(): number {
  return parallelGroup(SDT_PARALLEL_GROUP).length
}
