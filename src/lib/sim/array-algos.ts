/**
 * 相控阵 / 链路方法族 · 子模块入口。
 */
import { arrayFactor, beamwidth3dB, gratingLobes, pattern } from './phasedarray'
import { friisLink } from './antennalink'
import { childrenOf, parallelGroup } from '../../data/methods/methods'

export const ARRAY_PARENT = 'method-array-beamforming'
export const ARRAY_LINK_GROUP = 'array-link-view'

/** 阵列因子：指向角峰值 ≈1。 */
export function runArrayFactorSample(): { peak: number; offAxis: number } {
  const N = 8
  const d = 0.5
  const steer = 20
  return {
    peak: arrayFactor(steer, N, d, steer),
    offAxis: arrayFactor(steer + 40, N, d, steer),
  }
}

/** 波束宽：N 增大应收窄。 */
export function runBeamwidthSample(): { bw8: number; bw16: number } {
  return {
    bw8: beamwidth3dB(8, 0.5, 0),
    bw16: beamwidth3dB(16, 0.5, 0),
  }
}

/** 栅瓣：d/λ 过大时出现。 */
export function runGratingSample(): { lobesHalf: number[]; lobesWide: number[] } {
  return {
    lobesHalf: gratingLobes(0.5, 0),
    lobesWide: gratingLobes(1.2, 0),
  }
}

/** Friis：距离加倍 FSPL +6 dB。 */
export function runFriisSample(): { fspl1: number; fspl2: number; dPr: number } {
  const a = friisLink(0, 0, 0, 2.4e9, 10)
  const b = friisLink(0, 0, 0, 2.4e9, 20)
  return { fspl1: a.fsplDb, fspl2: b.fsplDb, dPr: a.prDbm - b.prDbm }
}

/** 方向图长度与峰值。 */
export function runPatternSample(): { n: number; maxG: number } {
  const p = pattern(8, 0.5, 0, 181)
  let maxG = 0
  for (const q of p) if (q.gain > maxG) maxG = q.gain
  return { n: p.length, maxG }
}

export function arrayChildCount(): number {
  return childrenOf(ARRAY_PARENT).length
}

export function arrayLinkParallelCount(): number {
  return parallelGroup(ARRAY_LINK_GROUP).length
}
