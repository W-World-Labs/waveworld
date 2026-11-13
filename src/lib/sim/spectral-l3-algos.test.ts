import { describe, it, expect } from 'vitest'
import {
  SPECTRAL_L3_PARENT,
  SPECTRAL_L3_METHOD_IDS,
  METHOD_ALGO_PSEUDOSPECTRAL_DIFF,
  fourierWaveNumbers,
  dft1d,
  idft1d,
  spectralDiff1d,
  maxAbsDiff,
  runPseudospectralDiffSample,
} from './spectral-l3-algos'
import { METHOD_SPECTRAL } from './research-algos'
import { methodById } from '../../data/methods/methods'

describe('谱方法 L3 · Fourier 拟谱一阶导数', () => {
  it('方法 id 常量（pseudospectral-diff 为未入库新 id，仅校验父族）', () => {
    expect(SPECTRAL_L3_PARENT).toBe('method-spectral-method')
    expect(SPECTRAL_L3_PARENT).toBe(METHOD_SPECTRAL)
    expect(METHOD_ALGO_PSEUDOSPECTRAL_DIFF).toBe('method-algo-pseudospectral-diff')
    expect(SPECTRAL_L3_METHOD_IDS).toContain(METHOD_ALGO_PSEUDOSPECTRAL_DIFF)
    // 父族已在目录；子 id 尚未入库 — 勿 methodById 新 id
    expect(methodById(SPECTRAL_L3_PARENT)).toBeDefined()
    expect(methodById(SPECTRAL_L3_PARENT)!.role).toBe('family')
  })

  it('fourierWaveNumbers：κ[0]=0，对称，偶 N 时 Nyquist=0', () => {
    const N = 8
    const L = 2 * Math.PI
    const κ = fourierWaveNumbers(N, L)
    expect(κ[0]).toBe(0)
    expect(κ[1]).toBeCloseTo(1, 12)
    expect(κ[N - 1]).toBeCloseTo(-1, 12)
    expect(κ[N / 2]).toBe(0) // Nyquist
  })

  it('DFT/iDFT 往返重构', () => {
    const x = new Float64Array([1, -0.5, 0.25, 2, 0, -1, 0.5, 1])
    const { re, im } = dft1d(x)
    const y = idft1d(re, im)
    for (let i = 0; i < x.length; i++) {
      expect(y[i]).toBeCloseTo(x[i]!, 12)
    }
  })

  it('spectralDiff1d：sin(m x) → m cos(m x)，机器精度', () => {
    const N = 32
    const L = 2 * Math.PI
    const m = 4
    const u = new Float64Array(N)
    const duExact = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      const x = (n * L) / N
      u[n] = Math.sin(m * x)
      duExact[n] = m * Math.cos(m * x)
    }
    const du = spectralDiff1d(u, L)
    expect(maxAbsDiff(du, duExact)).toBeLessThan(1e-12)
  })

  it('spectralDiff1d：cos → −sin', () => {
    const N = 48
    const L = 2 * Math.PI
    const m = 2
    const u = new Float64Array(N)
    const duExact = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      const x = (n * L) / N
      u[n] = Math.cos(m * x)
      duExact[n] = -m * Math.sin(m * x)
    }
    const du = spectralDiff1d(u, L)
    expect(maxAbsDiff(du, duExact)).toBeLessThan(1e-12)
  })

  it('runPseudospectralDiffSample：exact 容差内', () => {
    const r = runPseudospectralDiffSample()
    expect(r.methodId).toBe(METHOD_ALGO_PSEUDOSPECTRAL_DIFF)
    expect(r.familyId).toBe(SPECTRAL_L3_PARENT)
    expect(r.N).toBe(64)
    expect(r.m).toBe(3)
    expect(r.exact).toBe(true)
    expect(r.maxErr).toBeLessThan(1e-10)
    expect(r.maxErr).toBeLessThan(1e-12)
  })
})
