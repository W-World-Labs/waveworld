import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_PF_1D,
  METHOD_ALGO_PF_ESS,
  METHOD_PARTICLE_FILTER,
  PF_L2_PARENT,
  effectiveSampleSize,
  initUniformParticles,
  multimodalLikelihood,
  mulberry32,
  pfReweightMultimodal,
  pfSystematicResample,
  runPfEssSample,
  systematicResample,
} from './pf-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('粒子滤波 L2 · ESS / 系统重采样', () => {
  it('方法 id 常量对齐目录父族与 1D 子算法', () => {
    expect(METHOD_PARTICLE_FILTER).toBe('method-particle-filter')
    expect(PF_L2_PARENT).toBe('method-particle-filter')
    expect(METHOD_ALGO_PF_ESS).toBe('method-algo-pf-ess')
    expect(METHOD_ALGO_PF_1D).toBe('method-algo-pf-1d')
    expect(methodById(METHOD_PARTICLE_FILTER)).toBeDefined()
    expect(methodById(METHOD_ALGO_PF_1D)?.parentId).toBe(METHOD_PARTICLE_FILTER)
  })

  it('均匀权重 ESS = N；尖峰权重 ESS → 1', () => {
    const N = 100
    const uni = new Float64Array(N).fill(1 / N)
    expect(effectiveSampleSize(uni)).toBeCloseTo(N, 10)

    const spike = new Float64Array(N)
    spike[0] = 1
    expect(effectiveSampleSize(spike)).toBeCloseTo(1, 10)
  })

  it('系统重采样后权重均匀且输出长度 = N', () => {
    const rng = mulberry32(7)
    const N = 40
    const x = new Float64Array(N)
    const w = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      x[i] = i
      w[i] = i === 0 ? 0.8 : 0.2 / (N - 1)
    }
    const out = systematicResample(x, w, rng)
    expect(out.length).toBe(N)
    // 高权粒子 0 应被多次复制
    let zeros = 0
    for (let i = 0; i < N; i++) if (out[i] === 0) zeros++
    expect(zeros).toBeGreaterThan(N / 2)
  })

  it('多峰似然在两峰处均高于谷底', () => {
    const R = 0.25
    const sep = 4
    const z = 0
    const peak0 = multimodalLikelihood(z, 0, R, sep)
    const peakSep = multimodalLikelihood(z, sep, R, sep)
    const valley = multimodalLikelihood(z, sep / 2, R, sep)
    expect(peak0).toBeGreaterThan(valley)
    expect(peakSep).toBeGreaterThan(valley)
  })

  it('多峰重加权后 ESS 下降，系统重采样后恢复', () => {
    const rng = mulberry32(3)
    const N = 128
    const p = initUniformParticles(N, 0, 4, rng)
    const ess0 = effectiveSampleSize(p.w)
    expect(ess0).toBeCloseTo(N, 8)

    const essW = pfReweightMultimodal(p, 2, 0.1, 5)
    expect(essW).toBeLessThan(N / 2)

    pfSystematicResample(p, rng)
    const essR = effectiveSampleSize(p.w)
    expect(essR).toBeCloseTo(N, 8)
    expect(essR).toBeGreaterThan(essW)
  })

  it('runPfEssSample：权值塌缩后 ESS 恢复', () => {
    const r = runPfEssSample({ N: 256, seed: 17, steps: 3 })
    expect(r.methodId).toBe(METHOD_ALGO_PF_ESS)
    expect(r.familyId).toBe(PF_L2_PARENT)
    expect(r.relatedAlgoId).toBe(METHOD_ALGO_PF_1D)
    expect(r.essPrior).toBeGreaterThan(0.95 * r.N)
    expect(r.collapsed).toBe(true)
    expect(r.essAfterWeight).toBeLessThan(r.N / 2)
    expect(r.recovered).toBe(true)
    expect(r.essAfterResample).toBeCloseTo(r.N, 6)
    expect(Number.isFinite(r.estimate)).toBe(true)
  })
})
