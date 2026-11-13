import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_MONOLITHIC_RESIDUAL,
  MULTIPHYSICS_PARENT,
  monolithicResidual,
  runMonolithicResidualSample,
  solveMonolithicNewton,
} from './multiphysics-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('多物理 L2 · 单片联合残差', () => {
  it('方法 id 对齐 multiphysics catalog', () => {
    expect(MULTIPHYSICS_PARENT).toBe('method-comsol-style-multiphysics')
    expect(METHOD_ALGO_MONOLITHIC_RESIDUAL).toBe('method-algo-monolithic-residual')
    expect(methodById(MULTIPHYSICS_PARENT)).toBeDefined()
    expect(methodById(METHOD_ALGO_MONOLITHIC_RESIDUAL)?.parentId).toBe(
      MULTIPHYSICS_PARENT,
    )
  })

  it('任意初值残差范数 ≥ 0；平衡点残差≈0', () => {
    const p = {
      V: 5,
      sigma0: 1e4,
      alpha: 0.002,
      Tref: 300,
      geomFactor: 1e-5,
      Rth: 0.5,
    }
    const r0 = monolithicResidual({ T: 300, sigma: 1e4 }, p)
    expect(r0.norm).toBeGreaterThan(0)
    const sol = solveMonolithicNewton(p)
    expect(sol.ok).toBe(true)
    expect(sol.residual).toBeLessThan(1e-8)
    const rF = monolithicResidual(sol.u, p)
    expect(rF.norm).toBeLessThan(1e-8)
  })

  it('runMonolithicResidualSample 残差下降且 ok', () => {
    const r = runMonolithicResidualSample()
    expect(r.methodId).toBe(METHOD_ALGO_MONOLITHIC_RESIDUAL)
    expect(r.familyId).toBe(MULTIPHYSICS_PARENT)
    expect(r.ok).toBe(true)
    expect(r.reduced).toBe(true)
    expect(r.residualF).toBeLessThan(1e-6)
    expect(r.T).toBeGreaterThanOrEqual(300)
  })
})
