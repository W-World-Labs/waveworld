import { describe, it, expect } from 'vitest'
import {
  SEM_GLL_ID,
  SEM_LAGRANGE_ID,
  SEM_PARENT,
  gllNodesWeightsN2,
  gllQuadrature,
  legendreP,
  runGllSample,
  runSemLagrangeSample,
  runSemSample,
} from './sem-algos'
import { methodById } from '../../data/methods/methods'

describe('谱元 SEM · Legendre / GLL', () => {
  it('方法 id 常量对齐 catalog 族', () => {
    expect(SEM_PARENT).toBe('method-spectral-element')
    expect(SEM_LAGRANGE_ID).toBe('method-algo-sem-lagrange')
    expect(methodById(SEM_PARENT)).toBeDefined()
    expect(methodById(SEM_PARENT)!.kind).toBe('continuum')
  })

  it('Legendre P2 值', () => {
    expect(legendreP(2, 0)).toBeCloseTo(-0.5, 12)
    expect(legendreP(2, 1)).toBeCloseTo(1, 12)
  })

  it('GLL N=2 对 x² 精确积分 2/3，权重和=2', () => {
    const { nodes, weights } = gllNodesWeightsN2()
    const I = gllQuadrature((x) => x * x, nodes, weights)
    expect(I).toBeCloseTo(2 / 3, 12)
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 12)
  })

  it('runSemSample / runSemLagrangeSample 误差极小', () => {
    const r = runSemSample()
    expect(r.errX2).toBeLessThan(1e-12)
    expect(r.methodId).toBe(SEM_PARENT)
    const c = runSemLagrangeSample()
    expect(c.methodId).toBe(SEM_LAGRANGE_ID)
    expect(c.errX2).toBeLessThan(1e-12)
  })

  it('runGllSample 别名：GLL 求积原子', () => {
    const g = runGllSample()
    expect(g.methodId).toBe(SEM_GLL_ID)
    expect(g.errX2).toBeLessThan(1e-12)
    expect(g.weightSum).toBeCloseTo(2, 12)
    expect(methodById(SEM_GLL_ID)).toBeDefined()
  })
})
