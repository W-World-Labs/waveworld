import { describe, it, expect } from 'vitest'
import {
  LUMPED_ALGO_METHOD_IDS,
  LUMPED_PARENT_METHOD_ID,
  runLumpedAlgo,
  runMutualSample,
  runRcTransientSample,
  runSeriesRlcSample,
  type LumpedAlgoId,
} from './circuit-algos'
import { methodById, childrenOf } from '../../data/methods/methods'

describe('lumped-circuit 子算法纯核心（一级细分）', () => {
  it('目录：父方法下有 ≥2 个子算法节点且 id 对齐', () => {
    const kids = childrenOf(LUMPED_PARENT_METHOD_ID)
    expect(kids.length).toBeGreaterThanOrEqual(2)
    for (const methodId of Object.values(LUMPED_ALGO_METHOD_IDS)) {
      const m = methodById(methodId)
      expect(m, methodId).toBeDefined()
      expect(m!.parentId).toBe(LUMPED_PARENT_METHOD_ID)
    }
  })

  it('series-rlc-rk4：欠阻尼 ω₀ 与能量有限衰减', () => {
    const r = runSeriesRlcSample(500, 5e-8)
    // ω₀ = 1/√(LC) = 1/√(1e-9) = 31622.776… rad/s
    expect(r.omega0).toBeCloseTo(1 / Math.sqrt(1e-3 * 1e-6), 5)
    expect(r.zeta).toBeLessThan(1)
    expect(r.energy0).toBeGreaterThan(0)
    // 有阻尼：末能量应低于初能量，但仍为正
    expect(r.energyF).toBeGreaterThan(0)
    expect(r.energyF).toBeLessThan(r.energy0)
    expect(Number.isFinite(r.final.q)).toBe(true)
    expect(Number.isFinite(r.final.i)).toBe(true)
  })

  it('rc-rl-transient：t=τ 解析与数值均接近 (1-1/e)V0', () => {
    const r = runRcTransientSample()
    const target = r.V0 * (1 - Math.exp(-1))
    expect(r.analyticAtTau).toBeCloseTo(target, 10)
    // RK4 400 步应与解析接近（相对误差 < 1%）
    expect(Math.abs(r.numericAtTau - target) / target).toBeLessThan(0.01)
  })

  it('mutual-coupled：k=M/√(L1 L2) 且次级有感生电流', () => {
    const r = runMutualSample(200, 1e-5)
    expect(r.k).toBeCloseTo(0.008 / Math.sqrt(0.01 * 0.01), 10)
    expect(r.k).toBeGreaterThan(0.5)
    expect(r.k).toBeLessThan(1)
    // 初级加电压后应出现电流；耦合使次级非零
    expect(Math.abs(r.final.i1)).toBeGreaterThan(1e-6)
    expect(Math.abs(r.final.i2)).toBeGreaterThan(1e-9)
  })

  it('runLumpedAlgo 分发覆盖全部子算法 id', () => {
    const ids = Object.keys(LUMPED_ALGO_METHOD_IDS) as LumpedAlgoId[]
    expect(ids.length).toBeGreaterThanOrEqual(2)
    for (const id of ids) {
      const out = runLumpedAlgo(id)
      expect(out).toBeTruthy()
      expect(typeof out).toBe('object')
    }
  })
})
