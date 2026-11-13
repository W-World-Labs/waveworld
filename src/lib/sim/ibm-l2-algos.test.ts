import { describe, it, expect } from 'vitest'
import {
  IBM_L2_PARENT,
  METHOD_ALGO_IBM_SPREAD_INTERP,
  IBM_L2_METHOD_IDS,
  eulerInner,
  multiPointAdjointResidual,
  runIbmSpreadInterpSample,
  spreadInterpAdjointResidual,
  spreadMany,
} from './ibm-l2-algos'
import {
  METHOD_IMMERSED_BOUNDARY,
  interpolate1d,
  spreadForce1dPeriodic,
} from './ibm-algos'
import { methodById } from '../../data/methods/methods'

describe('IBM L2 · 铺展→插值投影一致性', () => {
  it('方法 id 常量（spread-interp 为未入库新 id）', () => {
    expect(IBM_L2_PARENT).toBe('method-immersed-boundary')
    expect(IBM_L2_PARENT).toBe(METHOD_IMMERSED_BOUNDARY)
    expect(METHOD_ALGO_IBM_SPREAD_INTERP).toBe('method-algo-ibm-spread-interp')
    expect(IBM_L2_METHOD_IDS).toContain(METHOD_ALGO_IBM_SPREAD_INTERP)
    expect(methodById(IBM_L2_PARENT)).toBeDefined()
  })

  it('单点伴随：⟨Sf,u⟩_h = F · S*u', () => {
    const n = 48
    const dx = 1
    const u = new Float64Array(n)
    for (let i = 0; i < n; i++) u[i] = i * 0.01 + Math.cos(i * 0.3)
    const r = spreadInterpAdjointResidual(1.7, 12.4, u, n, dx)
    expect(r.residual).toBeLessThan(1e-12)
    expect(r.left).toBeCloseTo(r.right, 10)
  })

  it('多点伴随与总力守恒', () => {
    const n = 64
    const dx = 1
    const forces = [1, -0.5, 0.25]
    const Xs = [5.2, 18.7, 40.1]
    const u = new Float64Array(n)
    for (let i = 0; i < n; i++) u[i] = Math.sin(i / 3)
    const adj = multiPointAdjointResidual(forces, Xs, u, n, dx)
    expect(adj.residual).toBeLessThan(1e-11)

    const f = spreadMany(forces, Xs, n, dx)
    let sum = 0
    for (let i = 0; i < n; i++) sum += f[i]! * dx
    expect(sum).toBeCloseTo(forces.reduce((a, b) => a + b, 0), 10)
  })

  it('eulerInner 与 spread/interp 手算一致', () => {
    const n = 32
    const dx = 0.5
    const F = 2
    const X = 4.1
    const f = spreadForce1dPeriodic(F, X, n, dx)
    const u = new Float64Array(n)
    u.fill(1.5)
    const left = eulerInner(f, u, dx)
    const right = F * interpolate1d(u, X, n, dx)
    expect(left).toBeCloseTo(right, 12)
    expect(right).toBeCloseTo(F * 1.5, 10)
  })

  it('runIbmSpreadInterpSample：伴随残差≈0、力守恒、常数再现', () => {
    const r = runIbmSpreadInterpSample()
    expect(r.methodId).toBe(METHOD_ALGO_IBM_SPREAD_INTERP)
    expect(r.familyId).toBe(IBM_L2_PARENT)
    expect(r.adjointResidual).toBeLessThan(1e-11)
    expect(r.multiAdjointResidual).toBeLessThan(1e-11)
    expect(r.forceSumErr).toBeLessThan(1e-10)
    expect(r.constInterpErr).toBeLessThan(1e-12)
    expect(r.selfInterp).not.toBe(0)
    expect(Number.isFinite(r.selfInterp)).toBe(true)
  })
})
