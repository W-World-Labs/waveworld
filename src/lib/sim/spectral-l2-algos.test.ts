import { describe, it, expect } from 'vitest'
import {
  SPECTRAL_L2_PARENT,
  SPECTRAL_PERIODOGRAM_ID,
  SPECTRAL_CHEBYSHEV_INTERP_ID,
  periodogramPower,
  runPeriodogramSample,
  runChebyshevInterpSample,
  chebyshevNodesSecondKind,
  chebyshevBarycentricWeights,
  barycentricEval,
  sumSquares,
} from './spectral-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('谱方法 L2 · 周期图功率峰', () => {
  it('方法 id 对齐 spectral 目录', () => {
    expect(SPECTRAL_L2_PARENT).toBe('method-spectral-method')
    expect(SPECTRAL_PERIODOGRAM_ID).toBe('method-algo-fft-periodogram')
    expect(methodById(SPECTRAL_L2_PARENT)).toBeDefined()
    expect(methodById(SPECTRAL_PERIODOGRAM_ID)?.parentId).toBe(SPECTRAL_L2_PARENT)
  })

  it('正弦峰：功率最大 bin 在 k0', () => {
    const N = 32
    const k0 = 3
    const x = new Float64Array(N)
    for (let n = 0; n < N; n++) x[n] = Math.cos((2 * Math.PI * k0 * n) / N)
    const P = periodogramPower(x)
    let kMax = 0
    let pMax = P[0]!
    for (let k = 1; k < N; k++) {
      if (P[k]! > pMax) {
        pMax = P[k]!
        kMax = k
      }
    }
    // 实信号对称：峰在 k0 或 N−k0
    expect(kMax === k0 || kMax === N - k0).toBe(true)
    expect(P[0]!).toBeLessThan(pMax)
  })

  it('Parseval：Σ P ≈ Σ x²', () => {
    const x = new Float64Array([1, -0.5, 0.25, 2, 0, -1, 0.5, 1])
    const P = periodogramPower(x)
    let eP = 0
    for (let i = 0; i < P.length; i++) eP += P[i]!
    expect(eP).toBeCloseTo(sumSquares(x), 10)
  })

  it('runPeriodogramSample：峰位 + 能量闭合', () => {
    const r = runPeriodogramSample()
    expect(r.methodId).toBe(SPECTRAL_PERIODOGRAM_ID)
    expect(r.familyId).toBe(SPECTRAL_L2_PARENT)
    expect(r.peakK === r.k0 || r.peakK === r.N - r.k0).toBe(true)
    expect(r.peakPower).toBeGreaterThan(r.powerDc)
    expect(r.parsevalErr).toBeLessThan(1e-10)
    expect(r.energyX).toBeGreaterThan(0)
  })
})

describe('谱方法 L2 · Chebyshev 插值', () => {
  it('方法 id 对齐 spectral 目录', () => {
    expect(SPECTRAL_CHEBYSHEV_INTERP_ID).toBe('method-algo-chebyshev-interp')
    expect(methodById(SPECTRAL_CHEBYSHEV_INTERP_ID)?.parentId).toBe(SPECTRAL_L2_PARENT)
  })

  it('节点端点为 ±1，权重端点半权', () => {
    const n = 4
    const x = chebyshevNodesSecondKind(n)
    const w = chebyshevBarycentricWeights(n)
    expect(x[0]).toBeCloseTo(1, 12)
    expect(x[n]).toBeCloseTo(-1, 12)
    expect(Math.abs(w[0]!)).toBeCloseTo(0.5, 12)
    expect(Math.abs(w[n]!)).toBeCloseTo(0.5, 12)
  })

  it('节点上精确还原', () => {
    const n = 6
    const nodes = chebyshevNodesSecondKind(n)
    const w = chebyshevBarycentricWeights(n)
    const y = new Float64Array(n + 1)
    for (let j = 0; j <= n; j++) y[j] = nodes[j]! ** 2
    expect(barycentricEval(nodes[2]!, nodes, y, w)).toBeCloseTo(y[2]!, 12)
  })

  it('runChebyshevInterpSample：节点精确 + 测试点准确', () => {
    const r = runChebyshevInterpSample()
    expect(r.methodId).toBe(SPECTRAL_CHEBYSHEV_INTERP_ID)
    expect(r.familyId).toBe(SPECTRAL_L2_PARENT)
    expect(r.nodesExact).toBe(true)
    expect(r.accurate).toBe(true)
    expect(r.testMaxErr).toBeLessThan(1e-6)
  })
})
