/**
 * NLJD 方法族 · 多项式响应 + 谐波分类。
 */
import { classify, diodeResponse, harmonics, junctionCoefficients } from './nljd'
import { childrenOf } from '../../data/methods/methods'

export const NLJD_PARENT = 'method-nljd'

/** Shockley 结：a2 槽承载饱和电流 Is，a3 承载 nVt。 */
export function runPolySample(): { y: number; a2: number } {
  const { a2, a3 } = junctionCoefficients('semiconductor')
  return { y: diodeResponse(0.5, a2, a3), a2 }
}

/** 三类目标分类正确。 */
export function runClassifySample(): {
  semi: string
  corrosion: string
  metal: string
} {
  return {
    semi: classify(harmonics('semiconductor')),
    corrosion: classify(harmonics('corrosion')),
    metal: classify(harmonics('metal')),
  }
}

/** 半导体 2f > 3f；锈蚀 3f 相对更强。 */
export function runHarmonicRatioSample(): {
  semiF2: number
  semiF3: number
  corrF2: number
  corrF3: number
} {
  const s = harmonics('semiconductor')
  const c = harmonics('corrosion')
  return { semiF2: s.f2, semiF3: s.f3, corrF2: c.f2, corrF3: c.f3 }
}

export function nljdChildCount(): number {
  return childrenOf(NLJD_PARENT).length
}
