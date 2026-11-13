import { describe, it, expect } from 'vitest'
import {
  MULTIPHYSICS_PARENT,
  MULTIPHYSICS_PARTITIONED_ID,
  MULTIPHYSICS_STAGGERED_ID,
  conductivity,
  jouleHeatingDeltaT,
  runMultiphysicsSample,
  runPartitionedCouplingSample,
  runStaggeredThermoelasticSample,
  weakCoupleThermalElectric,
} from './multiphysics-algos'
import { methodById } from '../../data/methods/methods'

describe('多物理 · 热–电弱耦合与交错热弹', () => {
  it('方法 id 对齐 catalog', () => {
    expect(MULTIPHYSICS_PARENT).toBe('method-comsol-style-multiphysics')
    expect(MULTIPHYSICS_STAGGERED_ID).toBe('method-algo-staggered-thermoelastic')
    expect(methodById(MULTIPHYSICS_PARENT)).toBeDefined()
  })

  it('电导随温度上升下降（正 α）', () => {
    const s0 = conductivity(300, 1e5, 0.004, 300)
    const s1 = conductivity(400, 1e5, 0.004, 300)
    expect(s0).toBeCloseTo(1e5, 6)
    expect(s1).toBeLessThan(s0)
  })

  it('焦耳加热 ΔT 正', () => {
    expect(jouleHeatingDeltaT(10, 1e4, 1e-4, 2)).toBeGreaterThan(0)
  })

  it('weakCoupleThermalElectric 残差收敛', () => {
    const r = weakCoupleThermalElectric(5, 1e4, 0.002, 300, 1e-5, 0.5, 300, 40)
    expect(r.residual).toBeLessThan(1e-3)
    expect(r.T).toBeGreaterThanOrEqual(300)
  })

  it('runMultiphysicsSample ok', () => {
    const r = runMultiphysicsSample()
    expect(r.ok).toBe(true)
    expect(r.methodId).toBe(MULTIPHYSICS_PARENT)
    expect(r.residual).toBeLessThan(1e-3)
  })

  it('runStaggeredThermoelasticSample 应力与热应变', () => {
    const r = runStaggeredThermoelasticSample()
    expect(r.methodId).toBe(MULTIPHYSICS_STAGGERED_ID)
    expect(r.epsTh).toBeCloseTo(r.alphaTh * r.deltaT, 12)
    expect(r.stress).toBeCloseTo(-r.E * r.epsTh, 0)
  })

  it('runPartitionedCouplingSample 固定点收敛', () => {
    const r = runPartitionedCouplingSample()
    expect(r.methodId).toBe(MULTIPHYSICS_PARTITIONED_ID)
    expect(r.ok).toBe(true)
    expect(r.residual).toBeLessThan(1e-6)
    expect(r.err).toBeLessThan(1e-4)
    expect(methodById(MULTIPHYSICS_PARTITIONED_ID)).toBeDefined()
  })
})
