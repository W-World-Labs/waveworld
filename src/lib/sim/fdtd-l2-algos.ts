/**
 * FDTD · 二级诊断 runner：能量监视 / 边界并行（PEC ‖ Mur）。
 * 委托 fdtd.ts 纯核心；method id 字符串常量对齐 methods.data（不在此改 registry）。
 */
import {
  createField,
  fdtdStep,
  gaussianPulse,
  injectSoftSource,
  totalEnergy,
  type FdtdBoundary,
} from './fdtd'

/** 父族 method-fdtd。 */
export const FDTD_L2_PARENT = 'method-fdtd'

/** Yee 蛙跳更新（一级已有）。 */
export const FDTD_L2_YEE_METHOD_ID = 'method-algo-yee-update'

/** 软源注入。 */
export const FDTD_L2_SOURCE_METHOD_ID = 'method-algo-fdtd-source'

/** 边界并行 · Mur ABC。 */
export const FDTD_L2_MUR_METHOD_ID = 'method-algo-fdtd-bnd-mur'

/** 边界并行 · PEC。 */
export const FDTD_L2_PEC_METHOD_ID = 'method-algo-fdtd-bnd-pec'

/** CFL 稳定性检查原子。 */
export const FDTD_L2_CFL_METHOD_ID = 'method-algo-fdtd-cfl'

export const FDTD_L2_METHOD_IDS = [
  FDTD_L2_YEE_METHOD_ID,
  FDTD_L2_SOURCE_METHOD_ID,
  FDTD_L2_MUR_METHOD_ID,
  FDTD_L2_PEC_METHOD_ID,
  FDTD_L2_CFL_METHOD_ID,
] as const

/**
 * 能量监视样例：中心软源注入若干步，再自由演化；
 * 全程能量有限、非负，且注入后峰值 > 0。
 */
export function runEnergyMonitorSample(
  sourceSteps = 20,
  freeSteps = 80,
  N = 32,
): {
  E0: number
  Epeak: number
  Efinal: number
  finite: boolean
  nonNeg: boolean
} {
  const f = createField(N, N, { S: 0.5, boundary: 'mur' })
  const cx = N >> 1
  const cy = N >> 1
  const E0 = totalEnergy(f)
  let Epeak = E0
  for (let t = 0; t < sourceSteps; t++) {
    injectSoftSource(f, cx, cy, gaussianPulse(t, 10, 3))
    fdtdStep(f)
    const e = totalEnergy(f)
    if (e > Epeak) Epeak = e
  }
  for (let t = 0; t < freeSteps; t++) {
    fdtdStep(f)
    const e = totalEnergy(f)
    if (e > Epeak) Epeak = e
  }
  const Efinal = totalEnergy(f)
  const finite =
    Number.isFinite(Efinal) && Number.isFinite(Epeak) && Number.isFinite(E0)
  const nonNeg = Efinal >= 0 && Epeak >= 0
  return { E0, Epeak, Efinal, finite, nonNeg }
}

/**
 * CFL 稳定性样例：S=0.5 能量有限；S=1.2 超 CFL 在运行前拒绝。
 * 2D 约化：dt = S/√2，S>1 超出稳定范围。
 */
export function runCflSample(
  steps = 40,
  N = 24,
): {
  Sstable: number
  Sunstable: number
  Estable: number
  stableFinite: boolean
  unstableRejected: boolean
  rejectionReason: string | null
  methodId: typeof FDTD_L2_CFL_METHOD_ID
} {
  const probe = (S: number) => {
    const f = createField(N, N, { S, boundary: 'pec' })
    const cx = N >> 1
    const cy = N >> 1
    injectSoftSource(f, cx, cy, 1)
    for (let t = 0; t < steps; t++) fdtdStep(f)
    return totalEnergy(f)
  }
  const Sstable = 0.5
  const Sunstable = 1.2
  const Estable = probe(Sstable)
  let rejectionReason: string | null = null
  try { probe(Sunstable) } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('CFL')) throw error
    rejectionReason = error.message
  }
  const stableFinite = Number.isFinite(Estable) && Estable >= 0 && Estable < 1e6
  return {
    Sstable,
    Sunstable,
    Estable,
    stableFinite,
    unstableRejected: rejectionReason !== null,
    rejectionReason,
    methodId: FDTD_L2_CFL_METHOD_ID,
  }
}

/**
 * 边界并行能量对拍（复用/适配 fdtd-algos 的 Mur vs PEC 口径）：
 * 同网格、同软源注入后自由演化，比较末能量。
 * PEC 腔应显著高于 Mur 开放域残余。
 */
export function runPecVsMurEnergySample(
  sourceSteps = 12,
  freeSteps = 100,
  N = 28,
): {
  murE: number
  pecE: number
  murPeak: number
  pecPeak: number
  finite: boolean
} {
  const run = (boundary: FdtdBoundary) => {
    const f = createField(N, N, { S: 0.5, boundary })
    const cx = N >> 1
    const cy = N >> 1
    let peak = 0
    for (let t = 0; t < sourceSteps; t++) {
      injectSoftSource(f, cx, cy, gaussianPulse(t, 5, 2))
      fdtdStep(f)
      peak = Math.max(peak, totalEnergy(f))
    }
    for (let t = 0; t < freeSteps; t++) fdtdStep(f)
    return { residual: totalEnergy(f), peak }
  }
  const mur = run('mur')
  const pec = run('pec')
  return {
    murE: mur.residual,
    pecE: pec.residual,
    murPeak: mur.peak,
    pecPeak: pec.peak,
    finite:
      Number.isFinite(mur.residual) &&
      Number.isFinite(pec.residual) &&
      Number.isFinite(mur.peak) &&
      Number.isFinite(pec.peak),
  }
}
