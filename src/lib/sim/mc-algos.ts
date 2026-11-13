/**
 * Metropolis MC / Ising 方法族 · 子模块入口。
 */
import {
  deltaE,
  heatbathSweep,
  initIsing,
  magnetization,
  metropolisSweep,
  onsagerMagnetization,
  onsagerTc,
} from './ising'
import { childrenOf, parallelGroup } from '../../data/methods/methods'

export const MC_PARENT = 'method-monte-carlo'
export const ISING_SOLVER_GROUP = 'ising-solver'
export const MC_UPDATE_GROUP = 'mc-update'
export const MC_HEATBATH_ID = 'method-algo-mc-heatbath'

/** 提议模块：ΔE 仅取离散值 ±0,±4,±8。 */
export function runProposeSample(): { dE: number; legal: boolean } {
  const st = initIsing(8, 2.0, 1, false)
  const dE = deltaE(st, 0)
  const legal = [-8, -4, 0, 4, 8].includes(dE)
  return { dE, legal }
}

/** Metropolis 扫：低温冷启动磁化保持高。 */
export function runMetropolisSweepSample(sweeps = 30): { m0: number; mF: number } {
  const st = initIsing(16, 1.5, 2, false)
  const m0 = magnetization(st)
  for (let i = 0; i < sweeps; i++) metropolisSweep(st)
  return { m0, mF: magnetization(st) }
}

/** Heat-bath 更新：低温冷启动磁化保持高（与 Metropolis 并立）。 */
export function runHeatbathSample(sweeps = 30): {
  m0: number
  mF: number
  methodId: typeof MC_HEATBATH_ID
} {
  const st = initIsing(16, 1.5, 3, false)
  const m0 = magnetization(st)
  for (let i = 0; i < sweeps; i++) heatbathSweep(st)
  return { m0, mF: magnetization(st), methodId: MC_HEATBATH_ID }
}

/** Onsager 并行透镜。 */
export function runOnsagerSample(T = 2.0): { m: number; Tc: number; below: boolean } {
  const Tc = onsagerTc()
  return { m: onsagerMagnetization(T), Tc, below: T < Tc }
}

/** 数值 vs 解析：T≪Tc 时两者磁化都接近 1。 */
export function compareIsingParallels(): { onsager: number; mc: number } {
  const T = 1.5
  const st = initIsing(24, T, 5, false)
  for (let i = 0; i < 80; i++) metropolisSweep(st)
  return { onsager: onsagerMagnetization(T), mc: magnetization(st) }
}

export function mcChildCount(): number {
  return childrenOf(MC_PARENT).length
}

export function isingParallelCount(): number {
  return parallelGroup(ISING_SOLVER_GROUP).length
}
