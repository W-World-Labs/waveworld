import { describe, it, expect } from 'vitest'
import {
  FDTD_L2_CFL_METHOD_ID,
  FDTD_L2_METHOD_IDS,
  FDTD_L2_MUR_METHOD_ID,
  FDTD_L2_PARENT,
  FDTD_L2_PEC_METHOD_ID,
  FDTD_L2_SOURCE_METHOD_ID,
  FDTD_L2_YEE_METHOD_ID,
  runCflSample,
  runEnergyMonitorSample,
  runPecVsMurEnergySample,
} from './fdtd-l2-algos'

describe('FDTD L2 · 诊断 runner（能量监视 / 边界并行）', () => {
  it('方法 id 常量对齐一级 FDTD 子模块', () => {
    expect(FDTD_L2_PARENT).toBe('method-fdtd')
    expect(FDTD_L2_YEE_METHOD_ID).toBe('method-algo-yee-update')
    expect(FDTD_L2_SOURCE_METHOD_ID).toBe('method-algo-fdtd-source')
    expect(FDTD_L2_MUR_METHOD_ID).toBe('method-algo-fdtd-bnd-mur')
    expect(FDTD_L2_PEC_METHOD_ID).toBe('method-algo-fdtd-bnd-pec')
    expect(FDTD_L2_CFL_METHOD_ID).toBe('method-algo-fdtd-cfl')
    expect(FDTD_L2_METHOD_IDS).toHaveLength(5)
  })

  it('runEnergyMonitorSample：源注入后自由演化能量有限且非负', () => {
    const r = runEnergyMonitorSample(20, 80, 32)
    expect(r.finite).toBe(true)
    expect(r.nonNeg).toBe(true)
    expect(r.E0).toBe(0)
    // 软源注入后应出现正能量峰值
    expect(r.Epeak).toBeGreaterThan(0)
    expect(Number.isFinite(r.Efinal)).toBe(true)
    expect(r.Efinal).toBeGreaterThanOrEqual(0)
  })

  it('runPecVsMurEnergySample：PEC 与 Mur 末能量可区分且有限', () => {
    const r = runPecVsMurEnergySample(12, 100, 28)
    expect(r.finite).toBe(true)
    expect(r.murPeak).toBeGreaterThan(0)
    expect(r.pecPeak).toBeGreaterThan(0)
    expect(r.murE).not.toBeCloseTo(r.pecE, 6)
    // 开放边界耗散/逃逸更多；PEC 腔留存更多
    expect(r.pecE).toBeGreaterThan(r.murE)
  })

  it('runCflSample：S=0.5 稳定，S=1.2 拒绝执行', () => {
    const r = runCflSample()
    expect(r.methodId).toBe(FDTD_L2_CFL_METHOD_ID)
    expect(r.stableFinite).toBe(true)
    expect(r.unstableRejected).toBe(true)
    expect(r.rejectionReason).toMatch(/CFL/)
    expect(r).not.toHaveProperty('Eunstable')
  })
})
