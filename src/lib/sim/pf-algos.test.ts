import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_PF_1D,
  METHOD_PARTICLE_FILTER,
  gaussPdf,
  initParticles,
  mulberry32,
  pfEstimate,
  pfMultinomialResample,
  pfPredict,
  pfReweight,
  runPf1dSample,
} from './pf-algos'
import { methodById } from '../../data/methods/methods'

describe('粒子滤波 · 1D SIR', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(METHOD_PARTICLE_FILTER).toBe('method-particle-filter')
    expect(METHOD_ALGO_PF_1D).toBe('method-algo-pf-1d')
    const m = methodById(METHOD_PARTICLE_FILTER)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
  })

  it('gaussPdf 在均值处最大且积分配额合理', () => {
    const p0 = gaussPdf(0, 0, 1)
    const p1 = gaussPdf(1, 0, 1)
    expect(p0).toBeGreaterThan(p1)
    expect(p0).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 10)
  })

  it('重加权后权重和 = 1，且贴近量测的粒子权重大', () => {
    const rng = mulberry32(1)
    const p = initParticles(4, 0, 0, rng)
    // 手工位置
    p.x[0] = 0
    p.x[1] = 1
    p.x[2] = 5
    p.x[3] = 10
    const neff = pfReweight(p, 1, 1)
    let sum = 0
    for (let i = 0; i < 4; i++) sum += p.w[i]!
    expect(sum).toBeCloseTo(1, 12)
    expect(p.w[1]!).toBeGreaterThan(p.w[0]!)
    expect(p.w[1]!).toBeGreaterThan(p.w[3]!)
    expect(neff).toBeGreaterThan(1)
    expect(neff).toBeLessThanOrEqual(4 + 1e-9)
  })

  it('多项式重采样后权重均匀', () => {
    const rng = mulberry32(99)
    const p = initParticles(50, 0, 1, rng)
    pfReweight(p, 0.5, 0.5)
    pfMultinomialResample(p, rng)
    for (let i = 0; i < p.w.length; i++) {
      expect(p.w[i]).toBeCloseTo(1 / 50, 12)
    }
    expect(Number.isFinite(pfEstimate(p))).toBe(true)
  })

  it('predict 在 Q=0 时位置不变', () => {
    const rng = mulberry32(3)
    const p = initParticles(10, 2, 0, rng)
    const before = Array.from(p.x)
    pfPredict(p, 0, rng)
    for (let i = 0; i < 10; i++) expect(p.x[i]).toBeCloseTo(before[i]!, 12)
  })

  it('runPf1dSample：更新后估计比先验更接近真值', () => {
    const r = runPf1dSample({ N: 300, trueX: 3, priorSpread: 2.5, steps: 6, seed: 42 })
    expect(r.methodId).toBe(METHOD_ALGO_PF_1D)
    expect(r.familyId).toBe(METHOD_PARTICLE_FILTER)
    expect(r.priorErr).toBeGreaterThan(1)
    expect(r.err).toBeLessThan(r.priorErr)
    expect(r.improved).toBe(true)
    expect(r.err).toBeLessThan(0.8)
    expect(r.estimate).toBeCloseTo(r.trueX, 0)
  })
})
