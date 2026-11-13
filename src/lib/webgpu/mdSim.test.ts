// src/lib/webgpu/mdSim.test.ts
import { describe, it, expect } from 'vitest'
import { createMdSim } from './mdSim'

describe('createMdSim preferCpu', () => {
  it('preferCpu true → backend cpu（node 无 GPU 亦可）', async () => {
    const sim = await createMdSim({ N: 8, L: 4, T0: 0.5, seed: 1, preferCpu: true })
    expect(sim.backend).toBe('cpu')
    sim.destroy()
  })
})

describe('MdSim.read 携带逐粒子 speed（CPU 后端）', () => {
  it('speed[i] = |v_i| 且长度 N，与动能自洽 KE=½Σv²', async () => {
    // node 无 WebGPU → createMdSim 必走 CpuMdSim 兜底
    const sim = await createMdSim({ N: 16, L: 4.5, T0: 0.6, seed: 3 })
    expect(sim.backend).toBe('cpu')
    const { speed, observables } = await sim.read()
    expect(speed.length).toBe(16)
    // 由 speed 反推 KE：½Σ speed² 应等于 observables.kinetic
    let ke = 0
    for (let i = 0; i < speed.length; i++) ke += speed[i] * speed[i]
    expect(0.5 * ke).toBeCloseTo(observables.kinetic, 5)
    expect(observables.boxL).toBeCloseTo(4.5, 9) // 未开压浴 → 盒长=初始 L
    expect(observables.volume).toBeCloseTo(4.5 * 4.5, 9)
    expect(observables.density).toBeCloseTo(16 / (4.5 * 4.5), 9)
    sim.destroy()
  })

  it('压浴关闭（缺省）⇒ 跑多步盒长恒定（NVT 零改动）', async () => {
    const sim = await createMdSim({ N: 64, L: 8, T0: 0.7, seed: 5 })
    sim.setTemperature(0.7)
    await expect(sim.step(50)).rejects.toThrow(/1–4/)
    await sim.step(4)
    const { observables } = await sim.read()
    expect(observables.boxL).toBeCloseTo(8, 9)
    sim.destroy()
  })

  it('NPT 开启（setBarostat）⇒ 压强收敛向目标、盒长/密度自洽', async () => {
    const sim = await createMdSim({ N: 64, L: 8, T0: 0.7, seed: 5 })
    sim.setTemperature(0.7)
    // 先 NVT 平衡，取代表性平衡压强（初始冷晶格压强不代表平衡态）
    for (let i = 0; i < 80; i++) { sim.setTemperature(0.7); await sim.step(4) }
    const Peq = (await sim.read()).observables.pressure
    const target = Peq - 3

    sim.setBarostat(target, 0.5) // 压浴把 ⟨P⟩ 拉向 target（盒长/密度据可压缩性相应变化）
    for (let i = 0; i < 250; i++) { sim.setTemperature(0.7); await sim.step(4) }
    const o = (await sim.read()).observables

    // 压浴的本职：压强向目标收敛（比平衡值更接近 target）
    expect(Math.abs(o.pressure - target)).toBeLessThan(Math.abs(Peq - target))
    // 盒长有限、密度=N/V 自洽
    expect(Number.isFinite(o.boxL)).toBe(true)
    expect(o.density).toBeCloseTo(64 / (o.boxL * o.boxL), 6)
    sim.destroy()
  })
})
