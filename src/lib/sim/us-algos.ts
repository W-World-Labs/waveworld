/**
 * 超声 B 超方法族 · 反射 / A 线 子模块。
 */
import { aline, reflectionCoef } from './ultrasound'
import { childrenOf } from '../../data/methods/methods'

export const US_PARENT = 'method-b-mode-ultrasound'

/** 反射系数：匹配介质 r=0；硬边界 |r|→1。 */
export function runReflectionSample(): { soft: number; hard: number; match: number } {
  return {
    soft: reflectionCoef(1.5, 1.6),
    hard: reflectionCoef(1.5, 7.8),
    match: reflectionCoef(1.5, 1.5),
  }
}

/** A 线：相同 |r| 两界面，更深处因衰减更弱。 */
export function runAlineSample(): { peaks: number; ampNear: number; ampFar: number } {
  const r = 0.3
  const line = aline(
    [
      { depth: 0.02, r },
      { depth: 0.07, r },
    ],
    0.1,
    200,
    12,
  )
  const peaks: number[] = []
  for (let i = 1; i < line.length - 1; i++) {
    if (line[i] > line[i - 1] && line[i] >= line[i + 1] && line[i] > 1e-6) peaks.push(i)
  }
  // 取峰处幅值而非固定格点（高斯峰中心）
  const ampNear = Math.max(...Array.from(line.slice(0, 80)))
  const ampFar = Math.max(...Array.from(line.slice(100)))
  return { peaks: peaks.length, ampNear, ampFar }
}

export function usChildCount(): number {
  return childrenOf(US_PARENT).length
}
