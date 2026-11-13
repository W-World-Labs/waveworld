import { describe, it, expect } from 'vitest'
import { createMdSim } from './mdSim'
import { createParticleScene } from './particleSim'
import { pedotParticleScene } from '../sim/pedotpss'

// 回归：批次恒温器曾把整批缩放 √(Ttarget/lastT) 每步施加 → 累计 s^steps 过冲，
// /md(N=256) 与 /pedotpss(N=400) 默认参数下约 8 帧炸成 NaN（指标/图表变空）。
// 修复=每步施 s^(1/steps)，整批累计仍为 s。本测试以页面真实默认跑多帧，锁死不再 NaN。

describe('恒温器稳定性回归（CPU 兜底，页面默认参数）', () => {
  it('/md：N=256 L=18 T0=0.4 跑 250 帧观测量恒有限、T 落在合理带', async () => {
    const sim = await createMdSim({ N: 256, L: 18, T0: 0.4, seed: 1 })
    expect(sim.backend).toBe('cpu')
    sim.setTemperature(0.4)
    for (let f = 0; f < 250; f++) {
      sim.setTemperature(0.4)
      await sim.step(4)
      const { observables: o } = await sim.read()
      expect(Number.isFinite(o.temperature)).toBe(true)
      expect(Number.isFinite(o.msd)).toBe(true)
      expect(Number.isFinite(o.pressure)).toBe(true)
    }
    const { observables: o } = await sim.read()
    expect(o.temperature).toBeGreaterThan(0.1) // 恒温器把 T 维持在 0.4 附近（不塌不爆）
    expect(o.temperature).toBeLessThan(1.5)
  })

  it('/md：升温档 T0=0.4→目标 2.0 大幅缩放也不发散', async () => {
    const sim = await createMdSim({ N: 256, L: 18, T0: 0.4, seed: 2 })
    sim.setTemperature(2.0) // 大 s（√(2.0/0.4)≈2.24）——旧实现 s^4 立即炸
    for (let f = 0; f < 120; f++) {
      await sim.step(4)
      const { observables: o } = await sim.read()
      expect(Number.isFinite(o.temperature)).toBe(true)
      expect(Number.isFinite(o.msd)).toBe(true)
    }
  })

  it('/pedotpss：N=400 L=20 T0=0.5 跑 150 帧观测量恒有限', async () => {
    const sim = await createParticleScene(pedotParticleScene(400), true)
    expect(sim.backend).toBe('cpu')
    sim.setTemperature(0.5)
    for (let f = 0; f < 150; f++) {
      sim.setTemperature(0.5)
      await sim.step(4)
      const { observables: o } = await sim.read()
      expect(Number.isFinite(o.temperature)).toBe(true)
      expect(Number.isFinite(o.msd)).toBe(true)
      expect(Number.isFinite(o.pressure)).toBe(true)
    }
  })
})
