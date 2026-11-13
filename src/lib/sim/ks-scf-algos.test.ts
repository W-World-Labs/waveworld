import { describe, it, expect } from 'vitest'
import {
  KS_SCF_ID,
  KS_SCF_PARENT,
  LDA_EXCHANGE_ID,
  LDA_EXCHANGE_STUB_ID,
  LDA_CX,
  densityMix,
  densityResidualNorm,
  ldaExchangeEnergyDensity,
  ldaExchangePotential,
  runKsScfSample,
  runLdaExchangeSample,
  toyKsMap,
} from './ks-scf-algos'
import { methodById } from '../../data/methods/methods'

describe('KS-SCF 玩具 · 密度混合残差', () => {
  it('方法 id 对齐 dft-electronic 目录', () => {
    expect(KS_SCF_PARENT).toBe('method-dft-electronic')
    expect(KS_SCF_ID).toBe('method-algo-ks-scf')
    expect(methodById(KS_SCF_PARENT)).toBeDefined()
    expect(methodById(KS_SCF_ID)?.parentId).toBe(KS_SCF_PARENT)
  })

  it('toyKsMap 守恒电子数', () => {
    const n = 8
    const nElec = 2
    const rho = new Float64Array(n)
    for (let i = 0; i < n; i++) rho[i] = 0.1 + 0.05 * i
    const out = toyKsMap(rho, nElec)
    let s = 0
    for (let i = 0; i < n; i++) s += out[i]!
    expect(s).toBeCloseTo(nElec, 12)
  })

  it('混合 α=1 即取输出', () => {
    const a = new Float64Array([1, 2, 3])
    const b = new Float64Array([4, 5, 6])
    const m = densityMix(a, b, 1)
    expect([...m]).toEqual([4, 5, 6])
    expect(densityResidualNorm(a, b)).toBeCloseTo(Math.sqrt(27), 12)
  })

  it('runKsScfSample：残差下降 + 电荷守恒', () => {
    const r = runKsScfSample()
    expect(r.methodId).toBe(KS_SCF_ID)
    expect(r.familyId).toBe(KS_SCF_PARENT)
    expect(r.residual0).toBeGreaterThan(0)
    expect(r.residualDecreased).toBe(true)
    expect(r.residualF).toBeLessThan(r.residual0)
    expect(r.chargeErr).toBeLessThan(1e-12)
  })
})

describe('LDA 交换能密度桩', () => {
  it('方法 id 对齐 dft-electronic', () => {
    expect(LDA_EXCHANGE_ID).toBe('method-algo-lda-exchange')
    expect(LDA_EXCHANGE_STUB_ID).toBe('method-algo-exchange-lda-stub')
    expect(methodById(LDA_EXCHANGE_ID)?.parentId).toBe(KS_SCF_PARENT)
    expect(methodById(LDA_EXCHANGE_STUB_ID)?.parentId).toBe(KS_SCF_PARENT)
  })

  it('ε_x / v_x 与 C_x 关系', () => {
    const rho = 0.25
    const ex = ldaExchangeEnergyDensity(rho)
    const vx = ldaExchangePotential(rho)
    expect(ex).toBeCloseTo(-LDA_CX * Math.pow(rho, 1 / 3), 12)
    expect(vx / ex).toBeCloseTo(4 / 3, 12)
  })

  it('runLdaExchangeSample：均匀密度解析对拍', () => {
    const r = runLdaExchangeSample({ n: 32, nElec: 1 })
    expect(r.methodId).toBe(LDA_EXCHANGE_ID)
    expect(r.familyId).toBe(KS_SCF_PARENT)
    expect(r.Ex).toBeLessThan(0)
    expect(r.ExErr).toBeLessThan(1e-12)
    expect(r.ratioOk).toBe(true)
  })
})
