import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_UKF_SIGMA,
  METHOD_KALMAN,
  runUkfSigmaSample,
  sigmaPoints,
  ukfWeights,
  unscentedTransform,
} from './ukf-algos'
import { methodById } from '../../data/methods/methods'

describe('UKF · sigma 点无迹变换', () => {
  it('方法 id 对齐 Kalman catalog', () => {
    expect(METHOD_KALMAN).toBe('method-kalman')
    expect(METHOD_ALGO_UKF_SIGMA).toBe('method-algo-ukf-sigma')
    expect(methodById(METHOD_KALMAN)).toBeDefined()
    expect(methodById(METHOD_ALGO_UKF_SIGMA)?.parentId).toBe(METHOD_KALMAN)
  })

  it('权重：2n+1 点，Wm 和 ≈1', () => {
    const w = ukfWeights(2, 0.5, 2, 0)
    expect(w.Wm.length).toBe(5)
    let s = 0
    for (let i = 0; i < w.Wm.length; i++) s += w.Wm[i]!
    expect(s).toBeCloseTo(1, 10)
  })

  it('sigma 点对称：均值还原 x', () => {
    const n = 2
    const w = ukfWeights(n, 0.5, 2, 0)
    const x = new Float64Array([1, -0.5])
    const P = new Float64Array([0.25, 1])
    const chi = sigmaPoints(x, P, w.c)
    const mean = new Float64Array(n)
    for (let i = 0; i < 2 * n + 1; i++) {
      for (let j = 0; j < n; j++) mean[j]! += w.Wm[i]! * chi[i * n + j]!
    }
    expect(mean[0]).toBeCloseTo(1, 10)
    expect(mean[1]).toBeCloseTo(-0.5, 10)
  })

  it('线性 f(x)=x 无迹还原均值与对角方差', () => {
    const n = 1
    const w = ukfWeights(n, 0.5, 2, 0)
    const x = new Float64Array([3])
    const P = new Float64Array([0.49])
    const chi = sigmaPoints(x, P, w.c)
    const { yMean, Pdiag } = unscentedTransform(
      chi,
      n,
      w.Wm,
      w.Wc,
      (z) => new Float64Array([z[0]!]),
    )
    expect(yMean[0]).toBeCloseTo(3, 10)
    expect(Pdiag[0]).toBeCloseTo(0.49, 8)
  })

  it('runUkfSigmaSample：x² 均值对拍高斯解析', () => {
    const r = runUkfSigmaSample({ mu: 1.0, sigma: 0.3, alpha: 0.5 })
    expect(r.methodId).toBe(METHOD_ALGO_UKF_SIGMA)
    expect(r.familyId).toBe(METHOD_KALMAN)
    expect(r.nSigma).toBe(3)
    expect(r.meanErr).toBeLessThan(1e-9)
    expect(r.ok).toBe(true)
  })
})
