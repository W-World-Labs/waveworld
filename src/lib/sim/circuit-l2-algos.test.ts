import { describe, it, expect } from 'vitest'
import {
  CIRCUIT_L2_EULER_METHOD_ID,
  CIRCUIT_L2_PARENT,
  CIRCUIT_L2_RK4_METHOD_ID,
  compareRlcIntegratorEnergyDrift,
  rlcEulerStep,
  runEulerRlcSample,
  runRk4RlcSample,
} from './circuit-l2-algos'
import { energy, type RlcParams, type RlcState } from './rlc'

describe('circuit L2 · 串联 RLC 并行积分器（Euler ‖ RK4）', () => {
  it('方法 id 常量为字符串，Euler 为未入库新 id', () => {
    expect(CIRCUIT_L2_PARENT).toBe('method-lumped-circuit')
    // RK4 语义挂接既有 series-rlc 节点
    expect(CIRCUIT_L2_RK4_METHOD_ID).toBe('method-algo-series-rlc')
    // 新 id 仅模块常量，不要求 methods.data 登记
    expect(CIRCUIT_L2_EULER_METHOD_ID).toBe('method-algo-rlc-euler')
  })

  it('rlcEulerStep 是纯函数：不修改入参', () => {
    const p: RlcParams = { L: 1, R: 0, C: 1, V: 0 }
    const s: RlcState = { q: 1, i: 0 }
    const snap = { ...s }
    const next = rlcEulerStep(s, p, 0.01)
    expect(s).toEqual(snap)
    // i=0 时首步 q 不变、i 因电容电压获加速度
    expect(next.i).not.toBe(s.i)
    expect(Number.isFinite(next.q)).toBe(true)
    expect(Number.isFinite(next.i)).toBe(true)
  })

  it('runEulerRlcSample / runRk4RlcSample：状态与能量有限', () => {
    const eul = runEulerRlcSample(500, 0.01)
    const rk4 = runRk4RlcSample(500, 0.01)
    expect(eul.energy0).toBeGreaterThan(0)
    expect(rk4.energy0).toBeGreaterThan(0)
    expect(Number.isFinite(eul.energyF)).toBe(true)
    expect(Number.isFinite(rk4.energyF)).toBe(true)
    expect(Number.isFinite(eul.final.q)).toBe(true)
    expect(Number.isFinite(rk4.final.i)).toBe(true)
  })

  it('能量漂移：同 steps/dt 下 RK4 明显优于粗欧拉（非平凡）', () => {
    // R=0 谐振子：物理守恒；欧拉数值注入能量，RK4 近守恒
    const { euler, rk4, rk4Better } = compareRlcIntegratorEnergyDrift(2000, 0.02)
    expect(euler.energy0).toBeCloseTo(rk4.energy0, 12)
    expect(euler.drift).toBeGreaterThan(0)
    expect(rk4Better).toBe(true)
    // 非平凡裕度：欧拉漂移至少比 RK4 大一个数量级，或 RK4 漂移极小
    expect(euler.drift).toBeGreaterThan(rk4.drift * 10)
    // RK4 在此步长下相对漂移应 < 1%
    expect(rk4.drift).toBeLessThan(0.01)
    // 欧拉相对漂移应可见（> 1%）
    expect(euler.drift).toBeGreaterThan(0.01)
  })

  it('runRk4RlcSample 能量与 energy() 一致', () => {
    const r = runRk4RlcSample(100, 0.005)
    expect(r.energyF).toBeCloseTo(energy(r.final, { L: 1, C: 1 }), 12)
  })
})
