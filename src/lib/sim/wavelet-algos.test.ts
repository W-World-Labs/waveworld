import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_HAAR_DWT,
  METHOD_ALGO_WAVELET_SOFT_THRESH,
  METHOD_WAVELET,
  haarDwt1Level,
  haarIdwt1Level,
  runHaarDwtSample,
  runWaveletThresholdSample,
  softThreshold,
  softThresholdVec,
  sumSquares,
} from './wavelet-algos'
import { methodById } from '../../data/methods/methods'

describe('小波 · Haar 一级 DWT', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(METHOD_WAVELET).toBe('method-wavelet')
    expect(METHOD_ALGO_HAAR_DWT).toBe('method-algo-haar-dwt')
    const m = methodById(METHOD_WAVELET)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
  })

  it('正交 Haar：能量 Σx² = ΣcA²+ΣcD²', () => {
    const x = new Float64Array([1, -1, 2, 2, 0, 4, 3, 1])
    const { approx, detail } = haarDwt1Level(x)
    expect(approx).toHaveLength(4)
    expect(detail).toHaveLength(4)
    const eIn = sumSquares(x)
    const eOut = sumSquares(approx) + sumSquares(detail)
    expect(eOut).toBeCloseTo(eIn, 12)
  })

  it('逆变换精确重构', () => {
    const x = new Float64Array([0.5, 1.5, -2, 3, 1, 1, 0, 8])
    const { approx, detail } = haarDwt1Level(x)
    const y = haarIdwt1Level(approx, detail)
    for (let i = 0; i < x.length; i++) {
      expect(y[i]).toBeCloseTo(x[i]!, 12)
    }
  })

  it('常数信号：细节 ≈ 0，近似 = √2 · c', () => {
    const c = 3
    const x = new Float64Array([c, c, c, c])
    const { approx, detail } = haarDwt1Level(x)
    for (let i = 0; i < detail.length; i++) {
      expect(Math.abs(detail[i]!)).toBeLessThan(1e-15)
      expect(approx[i]).toBeCloseTo(c * Math.SQRT2, 12)
    }
  })

  it('runHaarDwtSample：能量守恒 + 可逆', () => {
    const r = runHaarDwtSample()
    expect(r.methodId).toBe(METHOD_ALGO_HAAR_DWT)
    expect(r.familyId).toBe(METHOD_WAVELET)
    expect(r.N).toBe(8)
    expect(r.energyErr).toBeLessThan(1e-12)
    expect(r.reconMaxErr).toBeLessThan(1e-12)
    expect(r.energyIn).toBeGreaterThan(0)
  })

  it('奇数长度拒绝', () => {
    expect(() => haarDwt1Level([1, 2, 3])).toThrow()
  })
})

describe('小波 · 软阈值去噪', () => {
  it('方法 id 对齐 wavelet 目录', () => {
    expect(METHOD_ALGO_WAVELET_SOFT_THRESH).toBe('method-algo-wavelet-soft-thresh')
    expect(methodById(METHOD_ALGO_WAVELET_SOFT_THRESH)?.parentId).toBe(METHOD_WAVELET)
  })

  it('softThreshold 标准收缩', () => {
    expect(softThreshold(2, 0.5)).toBeCloseTo(1.5, 12)
    expect(softThreshold(-2, 0.5)).toBeCloseTo(-1.5, 12)
    expect(softThreshold(0.3, 0.5)).toBe(0)
    expect(softThreshold(-0.3, 0.5)).toBe(0)
    const v = softThresholdVec([1, -1, 0.1], 0.5)
    expect(v[0]).toBeCloseTo(0.5, 12)
    expect(v[1]).toBeCloseTo(-0.5, 12)
    expect(v[2]).toBe(0)
  })

  it('runWaveletThresholdSample：细节能量下降且 MSE 改善', () => {
    const r = runWaveletThresholdSample()
    expect(r.methodId).toBe(METHOD_ALGO_WAVELET_SOFT_THRESH)
    expect(r.familyId).toBe(METHOD_WAVELET)
    expect(r.detailEnergyReduced).toBe(true)
    expect(r.detailEnergyAfter).toBeLessThan(r.detailEnergyBefore)
    expect(r.mseImproved).toBe(true)
    expect(r.mseDenoised).toBeLessThan(r.mseNoisy)
  })
})
