/**
 * SPM 方法族 · STM ‖ AFM 并行 + 扫描模式步进。
 */
import { gapFromCurrent, scanConstantCurrent, scanConstantHeight, tunnelCurrent } from './stm'
import { LJ_MIN, ljForce, scanLine } from './afm'
import { childrenOf, parallelGroup } from '../../data/methods/methods'

export const SPM_PARENT = 'method-spm'
export const SPM_MODALITY_GROUP = 'spm-modality'

/** 隧穿：间距增大电流指数下降。 */
export function runTunnelSample(): { Iclose: number; Ifar: number } {
  const kappa = 10
  const I0 = 1
  return {
    Iclose: tunnelCurrent(0.1, kappa, I0),
    Ifar: tunnelCurrent(0.3, kappa, I0),
  }
}

/** 恒高扫描：表面台阶 → 电流对比。 */
export function runConstHeightSample(): { contrast: number } {
  const surface = [0, 0, 0.05, 0.05, 0]
  const I = scanConstantHeight(surface, 0.2, 10, 1)
  return { contrast: Math.max(...I) / Math.min(...I) }
}

/** 恒流：针高跟踪表面。 */
export function runConstCurrentSample(): { trackErr: number } {
  const surface = [0, 0.02, 0.04, 0.02, 0]
  const tip = scanConstantCurrent(surface, 0.1, 10, 1)
  const gap = gapFromCurrent(0.1, 10, 1)
  let err = 0
  for (let i = 0; i < surface.length; i++) err = Math.max(err, Math.abs(tip[i] - surface[i] - gap))
  return { trackErr: err }
}

/** AFM：势阱距离附近力近 0，更近排斥。 */
export function runAfmForceSample(): { fNear: number; fMin: number } {
  const sigma = 1
  const d0 = LJ_MIN(sigma)
  return {
    fNear: ljForce(0.5 * sigma, 1, sigma),
    fMin: ljForce(d0, 1, sigma),
  }
}

/** AFM 扫描线长度对齐表面。 */
export function runAfmScanSample(): { n: number; maxDefl: number } {
  const surface = [0, 0.1, 0.2, 0.1, 0]
  const defl = scanLine(surface, 1.2, 1, 1, 1)
  return { n: defl.length, maxDefl: Math.max(...defl.map(Math.abs)) }
}

export function spmChildCount(): number {
  return childrenOf(SPM_PARENT).length
}

export function spmModalityParallelCount(): number {
  return parallelGroup(SPM_MODALITY_GROUP).length
}
