import { describe, it, expect } from 'vitest'
import {
  METHOD_CWT,
  METHOD_ALGO_CWT_MEXHAT,
  CWT_PARENT,
  CWT_METHOD_IDS,
  mexicanHat,
  mexhatPeriodToScale,
  mexhatScaleToPeriod,
  cwtMexhat,
  scaleogramEnergy,
  argmax,
  linspaceScales,
  runCwtMexhatSample,
} from './cwt-algos'

describe('CWT · Mexican-hat continuous wavelet', () => {
  it('方法 id 常量 · method-cwt 新族', () => {
    expect(METHOD_CWT).toBe('method-cwt')
    expect(METHOD_ALGO_CWT_MEXHAT).toBe('method-algo-cwt-mexhat')
    expect(CWT_PARENT).toBe(METHOD_CWT)
    expect(CWT_METHOD_IDS).toContain(METHOD_ALGO_CWT_MEXHAT)
  })

  it('mexicanHat: ψ(0)=1, 过零 |τ|=1, 衰减', () => {
    expect(mexicanHat(0)).toBeCloseTo(1, 12)
    expect(mexicanHat(1)).toBeCloseTo(0, 12)
    expect(mexicanHat(-1)).toBeCloseTo(0, 12)
    expect(Math.abs(mexicanHat(5))).toBeLessThan(0.01)
  })

  it('mexhatPeriodToScale / ScaleToPeriod 互逆', () => {
    const T = 20
    const a = mexhatPeriodToScale(T)
    expect(mexhatScaleToPeriod(a)).toBeCloseTo(T, 10)
    expect(a).toBeCloseTo(T / (Math.PI * Math.SQRT2), 12)
  })

  it('linspaceScales 端点与单调', () => {
    const s = linspaceScales(1, 5, 5)
    expect(s[0]).toBeCloseTo(1, 12)
    expect(s[4]).toBeCloseTo(5, 12)
    expect(s[2]).toBeCloseTo(3, 12)
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!)
  })

  it('cwtMexhat: 系数矩阵形状与有限值', () => {
    const N = 32
    const x = new Float64Array(N)
    for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * i) / 8)
    const scales = new Float64Array([1.5, 2, 3])
    const { coeffs, nTime, nScales } = cwtMexhat(x, scales)
    expect(nTime).toBe(N)
    expect(nScales).toBe(3)
    expect(coeffs.length).toBe(3 * N)
    for (let i = 0; i < coeffs.length; i++) {
      expect(Number.isFinite(coeffs[i]!)).toBe(true)
    }
  })

  it('scaleogramEnergy + argmax', () => {
    // 手工 2 scales × 2 time
    const coeffs = new Float64Array([1, 0, 0, 2]) // E0=1, E1=4
    const E = scaleogramEnergy(coeffs, 2, 2)
    expect(E[0]).toBeCloseTo(1, 12)
    expect(E[1]).toBeCloseTo(4, 12)
    expect(argmax(E)).toBe(1)
  })

  it('cwtMexhat 拒绝非法尺度 / 过短信号', () => {
    expect(() => cwtMexhat(new Float64Array(2), [1])).toThrow()
    expect(() => cwtMexhat(new Float64Array(8), [0])).toThrow()
    expect(() => cwtMexhat(new Float64Array(8), [-1])).toThrow()
  })

  it('runCwtMexhatSample: ok, 峰尺度靠近已知周期', () => {
    const r = runCwtMexhatSample({ N: 128, period: 16, nScales: 32 })
    expect(r.methodId).toBe(METHOD_ALGO_CWT_MEXHAT)
    expect(r.familyId).toBe(METHOD_CWT)
    expect(r.ok).toBe(true)
    expect(r.peakNearPeriod).toBe(true)
    expect(r.scaleRelErr).toBeLessThan(0.5)
    expect(r.energyMax).toBeGreaterThan(0)
    expect(r.peakScale).toBeGreaterThan(0)
    // peak period loosely near 16
    const peakPeriod = mexhatScaleToPeriod(r.peakScale)
    expect(Math.abs(peakPeriod - 16) / 16).toBeLessThan(0.5)
  })

  it('runCwtMexhatSample 默认参数亦 ok', () => {
    const r = runCwtMexhatSample()
    expect(r.ok).toBe(true)
    expect(r.familyId).toBe('method-cwt')
  })
})
