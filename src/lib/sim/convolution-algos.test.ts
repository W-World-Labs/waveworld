import { describe, it, expect } from 'vitest'
import {
  METHOD_CONVOLUTION,
  METHOD_ALGO_CONV_DFT,
  CONVOLUTION_METHOD_IDS,
  CONV_MAX_N,
  isPowerOfTwo,
  dftReal1d,
  idftReal1d,
  circularConvDirect,
  circularConvDft,
  maxAbsDiff,
  runConvDftSample,
} from './convolution-algos'

describe('Convolution theorem · circular conv via DFT product', () => {
  it('方法 id 常量字符串（METHOD_CONVOLUTION 族，非 spectral parent）', () => {
    expect(METHOD_CONVOLUTION).toBe('method-convolution')
    expect(METHOD_ALGO_CONV_DFT).toBe('method-algo-conv-dft')
    expect(CONVOLUTION_METHOD_IDS).toContain(METHOD_ALGO_CONV_DFT)
  })

  it('isPowerOfTwo', () => {
    expect(isPowerOfTwo(2)).toBe(true)
    expect(isPowerOfTwo(16)).toBe(true)
    expect(isPowerOfTwo(64)).toBe(true)
    expect(isPowerOfTwo(1)).toBe(false)
    expect(isPowerOfTwo(3)).toBe(false)
    expect(isPowerOfTwo(12)).toBe(false)
  })

  describe('DFT round-trip', () => {
    it('idft(dft(x)) ≈ x', () => {
      const x = new Float64Array([1, 2, 0, -1, 0.5, 0, 3, -2])
      const { re, im } = dftReal1d(x)
      const y = idftReal1d(re, im)
      expect(maxAbsDiff(x, y)).toBeLessThan(1e-12)
    })
  })

  describe('circularConvDirect / circularConvDft', () => {
    it('单位脉冲 ⋆ b = b', () => {
      const N = 8
      const a = new Float64Array(N)
      a[0] = 1
      const b = new Float64Array([1, 2, 3, 0, -1, 0, 0.5, 4])
      const c = circularConvDirect(a, b)
      expect(maxAbsDiff(c, b)).toBeLessThan(1e-14)
      const cD = circularConvDft(a, b)
      expect(maxAbsDiff(cD, b)).toBeLessThan(1e-12)
    })

    it('DFT 乘积 ≡ 直接圆周卷积（N=2^p）', () => {
      const N = 16
      const a = new Float64Array(N)
      const b = new Float64Array(N)
      for (let n = 0; n < N; n++) {
        a[n] = Math.sin((2 * Math.PI * 2 * n) / N)
        b[n] = Math.cos((2 * Math.PI * 3 * n) / N) + (n === 0 ? 1 : 0)
      }
      const cDir = circularConvDirect(a, b)
      const cDft = circularConvDft(a, b)
      expect(maxAbsDiff(cDir, cDft)).toBeLessThan(1e-10)
    })

    it('非 2 的幂 / 超长拒绝', () => {
      const a = new Float64Array(6)
      const b = new Float64Array(6)
      expect(() => circularConvDirect(a, b)).toThrow()
      const long = new Float64Array(CONV_MAX_N + 1)
      // 非 power-of-2 且超长
      expect(() => circularConvDft(long, long)).toThrow()
    })

    it('长度不一致拒绝', () => {
      expect(() =>
        circularConvDirect(new Float64Array(4), new Float64Array(8)),
      ).toThrow()
    })
  })

  it('runConvDftSample：ok 且 methodId/familyId 对齐', () => {
    const r = runConvDftSample({ N: 16 })
    expect(r.methodId).toBe(METHOD_ALGO_CONV_DFT)
    expect(r.familyId).toBe(METHOD_CONVOLUTION)
    expect(r.ok).toBe(true)
    expect(r.N).toBe(16)
    expect(r.maxAbsErr).toBeLessThan(1e-10)
    expect(r.maxAbsConv).toBeGreaterThan(0)
    expect(Number.isFinite(r.peakValue)).toBe(true)
  })

  it('runConvDftSample N=8 亦 ok', () => {
    const r = runConvDftSample({ N: 8 })
    expect(r.ok).toBe(true)
    expect(r.maxAbsErr).toBeLessThan(1e-10)
  })
})
