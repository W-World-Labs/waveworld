/**
 * FDTD 方法族 · 可组装子模块入口。
 */
import {
  createField,
  fdtdStep,
  fresnelReflection,
  injectSoftSource,
  totalEnergy,
  gaussianPulse,
} from './fdtd'
import { childrenOf, parallelGroup } from '../../data/methods/methods'

export const FDTD_PARENT = 'method-fdtd'
export const FDTD_BND_GROUP = 'fdtd-boundary'

export const FDTD_CHILD_IDS = [
  'method-algo-yee-update',
  'method-algo-fdtd-source',
  'method-algo-fdtd-bnd-mur',
  'method-algo-fdtd-bnd-pec',
] as const

/** Yee 步进：注入脉冲后跑若干步，能量有限。 */
export function runYeeUpdateSample(steps = 40): { E0: number; Ef: number; finite: boolean } {
  const f = createField(32, 32, { S: 0.5, boundary: 'mur' })
  injectSoftSource(f, 16, 16, gaussianPulse(0, 10, 3))
  const E0 = totalEnergy(f)
  for (let t = 0; t < steps; t++) {
    injectSoftSource(f, 16, 16, gaussianPulse(t, 10, 3))
    fdtdStep(f)
  }
  const Ef = totalEnergy(f)
  return { E0, Ef, finite: Number.isFinite(Ef) && Ef >= 0 }
}

/** 软源：单点注入后能量应上升。 */
export function runSourceSample(): { before: number; after: number } {
  const f = createField(24, 24, { S: 0.5 })
  const before = totalEnergy(f)
  injectSoftSource(f, 12, 12, 1.0)
  const after = totalEnergy(f)
  return { before, after }
}

/** 并行边界：Mur 开放 vs PEC 腔 — 同初值多步后能量行为可区分。 */
export function runBoundaryParallel(steps = 80): { murE: number; pecE: number } {
  const seed = (boundary: 'mur' | 'pec') => {
    const f = createField(28, 28, { S: 0.5, boundary })
    for (let t = 0; t < 8; t++) {
      injectSoftSource(f, 14, 14, gaussianPulse(t, 5, 2))
      fdtdStep(f)
    }
    for (let t = 0; t < steps; t++) fdtdStep(f)
    return totalEnergy(f)
  }
  return { murE: seed('mur'), pecE: seed('pec') }
}

/** 菲涅耳公式模块（介质界面对照）。 */
export function runFresnelSample(): { R: number } {
  return { R: fresnelReflection(1, 4) }
}

export function fdtdChildCount(): number {
  return childrenOf(FDTD_PARENT).length
}

export function fdtdBoundaryParallelCount(): number {
  return parallelGroup(FDTD_BND_GROUP).length
}
