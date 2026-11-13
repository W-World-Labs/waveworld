import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_PF_SYSTEMATIC,
  METHOD_PARTICLE_FILTER,
  PF_L3_PARENT,
  PF_L3_METHOD_IDS,
  METHOD_ALGO_PF_ESS,
  effectiveSampleSize,
  makeSpikedWeights,
  systematicResampleStep,
  countCopies,
  runPfSystematicSample,
  initUniformParticles,
  mulberry32,
  systematicResample,
} from './pf-l3-algos'

describe('粒子滤波 L3 · 系统重采样', () => {
  it('方法 id 常量（新 id 未入库，仅对齐字符串 / 父族）', () => {
    expect(METHOD_PARTICLE_FILTER).toBe('method-particle-filter')
    expect(PF_L3_PARENT).toBe('method-particle-filter')
    expect(METHOD_ALGO_PF_SYSTEMATIC).toBe('method-algo-pf-systematic')
    expect(METHOD_ALGO_PF_ESS).toBe('method-algo-pf-ess')
    expect(PF_L3_METHOD_IDS).toContain(METHOD_ALGO_PF_SYSTEMATIC)
    // 新 catalog id 勿 methodById
  })

  it('makeSpikedWeights：归一化且 ESS ≪ N', () => {
    const N = 50
    const w = makeSpikedWeights(N, 0.9)
    let sum = 0
    for (let i = 0; i < N; i++) sum += w[i]!
    expect(sum).toBeCloseTo(1, 12)
    const ess = effectiveSampleSize(w)
    expect(ess).toBeLessThan(N / 2)
    expect(ess).toBeGreaterThan(1)
  })

  it('systematicResampleStep：权重 → 1/N，ESS 恢复', () => {
    const N = 64
    const rng = mulberry32(9)
    const p = initUniformParticles(N, 0, 0.1, rng)
    for (let i = 0; i < N; i++) p.x[i] = i
    const spiked = makeSpikedWeights(N, 0.8)
    for (let i = 0; i < N; i++) p.w[i] = spiked[i]!

    const { essBefore, essAfter, weightsUniform } = systematicResampleStep(p, rng)
    expect(essBefore).toBeLessThan(N / 2)
    expect(weightsUniform).toBe(true)
    expect(essAfter).toBeCloseTo(N, 8)
    const inv = 1 / N
    for (let i = 0; i < N; i++) {
      expect(p.w[i]).toBeCloseTo(inv, 14)
    }
  })

  it('高权粒子被系统重采样多次复制', () => {
    const N = 40
    const rng = mulberry32(7)
    const x = new Float64Array(N)
    const w = makeSpikedWeights(N, 0.85)
    for (let i = 0; i < N; i++) x[i] = i
    const out = systematicResample(x, w, rng)
    const zeros = countCopies(out, 0)
    expect(zeros).toBeGreaterThan(N / 2)
  })

  it('runPfSystematicSample：ok、ESS 恢复、familyId', () => {
    const r = runPfSystematicSample({ N: 128, w0: 0.85, seed: 23 })
    expect(r.methodId).toBe(METHOD_ALGO_PF_SYSTEMATIC)
    expect(r.familyId).toBe(PF_L3_PARENT)
    expect(r.familyId).toBe('method-particle-filter')
    expect(r.relatedAlgoId).toBe(METHOD_ALGO_PF_ESS)
    expect(r.ok).toBe(true)
    expect(r.collapsed).toBe(true)
    expect(r.recovered).toBe(true)
    expect(r.weightsUniform).toBe(true)
    expect(r.essAfter).toBeCloseTo(r.N, 6)
    expect(r.essAfter).toBeGreaterThan(r.essBefore)
    expect(r.copiesOfSpike).toBeGreaterThan(r.N / 2)
    expect(Number.isFinite(r.estimate)).toBe(true)
  })

  it('runPfSystematicSample multimodal 路径仍 ok', () => {
    const r = runPfSystematicSample({
      N: 160,
      seed: 5,
      multimodal: true,
    })
    expect(r.ok).toBe(true)
    expect(r.essAfter).toBeCloseTo(r.N, 5)
    expect(r.weightsUniform).toBe(true)
  })
})
