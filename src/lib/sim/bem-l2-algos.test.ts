import { describe, it, expect } from 'vitest'
import {
  BEM_COLLOCATION_ID,
  BEM_L2_PARENT,
  analyticPoisson1d,
  bemCollocation1d,
  runBemCollocationSample,
} from './bem-l2-algos'
import { greenDirichlet1d } from './research-algos'
import { methodById } from '../../data/methods/methods'

describe('BEM L2 · 1D 配点 Green 和', () => {
  it('方法 id 对齐 BEM 目录', () => {
    expect(BEM_L2_PARENT).toBe('method-boundary-element')
    expect(BEM_COLLOCATION_ID).toBe('method-algo-bem-collocation')
    expect(methodById(BEM_L2_PARENT)).toBeDefined()
    expect(methodById(BEM_COLLOCATION_ID)?.parentId).toBe(BEM_L2_PARENT)
  })

  it('Green 核对称且边界为 0', () => {
    expect(greenDirichlet1d(0.2, 0.7)).toBeCloseTo(greenDirichlet1d(0.7, 0.2), 12)
    expect(greenDirichlet1d(0, 0.5)).toBe(0)
    expect(greenDirichlet1d(1, 0.5)).toBe(0)
  })

  it('配点解逼近 x(1−x)/2', () => {
    const { x, u } = bemCollocation1d(48)
    let maxErr = 0
    for (let i = 0; i < x.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(u[i]! - analyticPoisson1d(x[i]!)))
    }
    expect(maxErr).toBeLessThan(5e-3)
  })

  it('runBemCollocationSample：中点≈1/8', () => {
    const r = runBemCollocationSample()
    expect(r.methodId).toBe(BEM_COLLOCATION_ID)
    expect(r.familyId).toBe(BEM_L2_PARENT)
    expect(r.errMid).toBeLessThan(1e-2)
    expect(r.uMid).toBeCloseTo(0.125, 2)
    expect(r.maxAbsErr).toBeLessThan(1e-2)
  })
})
