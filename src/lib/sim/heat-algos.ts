/**
 * 热扩散方法族 · 数值 FTCS 与解析 erfc 并行模块。
 */
import { STABLE_R, HeatField, sum } from './heat'
import { heatStepSolution } from './heaterfc'
import { parallelGroup } from '../../data/methods/methods'

export const HEAT_PARALLEL_GROUP = 'heat-solver'
export const HEAT_PARENT = 'method-heat-ftcs'

/** FTCS：绝热边界总热量近似守恒。 */
export function runHeatFtcsConserve(): { sum0: number; sumF: number; r: number } {
  const W = 16
  const H = 16
  const u = new Float32Array(W * H)
  u[(H / 2) * W + W / 2] = 1
  const sum0 = sum(u)
  const r = 0.2
  if (r > STABLE_R) throw new Error(`r=${r} exceeds STABLE_R=${STABLE_R}`)
  const heat = new HeatField(W, H, u)
  for (let i = 0; i < 40; i++) heat.step(r)
  return { sum0, sumF: sum(heat.field), r }
}

/**
 * erfc 解析模块（shipped heaterfc.heatStepSolution）：
 * 中点温度应介于阶跃两侧水平。
 */
export function runErfcProfileSample(): { Tmid: number; Tleft: number; Tright: number } {
  const kappa = 1
  const t = 0.5
  const x0 = 0
  const Tmid = heatStepSolution(0.5, t, kappa, x0)
  const Tleft = heatStepSolution(-2, t, kappa, x0)
  const Tright = heatStepSolution(2, t, kappa, x0)
  return { Tmid, Tleft, Tright }
}

export function heatParallelCount(): number {
  return parallelGroup(HEAT_PARALLEL_GROUP).length
}
