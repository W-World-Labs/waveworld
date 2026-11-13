import { describe, it, expect } from 'vitest'
import {
  EXERGY_CARNOT_ID,
  EXERGY_PARENT,
  runCarnotExergySample,
  runExergySample,
} from './exergy-algos'
import { thermalExergyFactor, T0 } from '../exergy'
import { methodById } from '../../data/methods/methods'

describe('㶲分析 · Carnot / 路径', () => {
  it('方法 id 对齐 catalog', () => {
    expect(EXERGY_PARENT).toBe('method-exergy-analysis')
    expect(EXERGY_CARNOT_ID).toBe('method-algo-exergy-carnot')
    expect(methodById(EXERGY_PARENT)).toBeDefined()
  })

  it('runExergySample：热因子 < 电因子，路径效率有限', () => {
    const r = runExergySample()
    expect(r.methodId).toBe(EXERGY_PARENT)
    expect(r.electric).toBe(1)
    expect(r.thermal).toBeLessThan(1)
    expect(r.carnot600).toBeCloseTo(thermalExergyFactor(600), 12)
    expect(r.pathEnergyEff).toBeGreaterThan(0)
    expect(r.pathEnergyEff).toBeLessThanOrEqual(1)
  })

  it('runCarnotExergySample：T 升高 φ 单调不减', () => {
    const r = runCarnotExergySample()
    expect(r.methodId).toBe(EXERGY_CARNOT_ID)
    expect(r.monotone).toBe(true)
    expect(r.phi300).toBeLessThanOrEqual(r.phi600)
    expect(thermalExergyFactor(T0)).toBe(0)
  })
})
