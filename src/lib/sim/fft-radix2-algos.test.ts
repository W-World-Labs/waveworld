import { describe, it, expect } from 'vitest'
import {
  METHOD_FFT,
  METHOD_ALGO_FFT_RADIX2,
  FFT_PARENT,
  FFT_METHOD_IDS,
  FFT_MAX_N,
  isPowerOfTwo,
  log2Pow2,
  bitReversePermute,
  fftRadix2InPlace,
  fftRadix2,
  ifftRadix2,
  dftComplexNaive,
  maxAbsDiffComplex,
  runFftRadix2Sample,
} from './fft-radix2-algos'

describe('Radix-2 Cooley–Tukey FFT · complex N=2^p', () => {
  it('method id constants (family method-fft, not spectral)', () => {
    expect(METHOD_FFT).toBe('method-fft')
    expect(METHOD_ALGO_FFT_RADIX2).toBe('method-algo-fft-radix2')
    expect(FFT_PARENT).toBe(METHOD_FFT)
    expect(FFT_METHOD_IDS).toContain(METHOD_ALGO_FFT_RADIX2)
    expect(METHOD_FFT).not.toBe('method-spectral-method')
  })

  it('isPowerOfTwo / log2Pow2', () => {
    expect(isPowerOfTwo(2)).toBe(true)
    expect(isPowerOfTwo(32)).toBe(true)
    expect(isPowerOfTwo(256)).toBe(true)
    expect(isPowerOfTwo(1)).toBe(false)
    expect(isPowerOfTwo(3)).toBe(false)
    expect(log2Pow2(8)).toBe(3)
    expect(log2Pow2(64)).toBe(6)
    expect(() => log2Pow2(6)).toThrow()
  })

  it('bitReversePermute swaps pairs correctly (N=8)', () => {
    const re = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7])
    const im = new Float64Array([0, 10, 20, 30, 40, 50, 60, 70])
    bitReversePermute(re, im)
    // bit-reverse 3 bits: 0,4,2,6,1,5,3,7
    expect(Array.from(re)).toEqual([0, 4, 2, 6, 1, 5, 3, 7])
    expect(Array.from(im)).toEqual([0, 40, 20, 60, 10, 50, 30, 70])
  })

  it('FFT matches naive DFT within tol (N=16)', () => {
    const N = 16
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      re[n] = Math.sin((2 * Math.PI * 3 * n) / N) + 0.2
      im[n] = Math.cos((2 * Math.PI * 5 * n) / N)
    }
    const ref = dftComplexNaive(re, im)
    const fft = fftRadix2(re, im)
    expect(maxAbsDiffComplex(fft.re, fft.im, ref.re, ref.im)).toBeLessThan(1e-10)
  })

  it('in-place FFT same as out-of-place', () => {
    const re = new Float64Array([1, 0, -1, 0.5, 0, 2, -0.3, 0.1])
    const im = new Float64Array([0.2, -1, 0, 0.4, 1, 0, -0.5, 0.3])
    const out = fftRadix2(re, im)
    const reI = new Float64Array(re)
    const imI = new Float64Array(im)
    fftRadix2InPlace(reI, imI, -1)
    expect(maxAbsDiffComplex(reI, imI, out.re, out.im)).toBeLessThan(1e-14)
  })

  it('inverse round-trip ifft(fft(x)) ≈ x', () => {
    const N = 32
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      re[n] = Math.sin(0.3 * n) + 0.01 * n
      im[n] = Math.cos(0.7 * n) - 0.02 * n
    }
    const X = fftRadix2(re, im)
    const y = ifftRadix2(X.re, X.im)
    expect(maxAbsDiffComplex(y.re, y.im, re, im)).toBeLessThan(1e-12)
  })

  it('impulse → flat spectrum', () => {
    const N = 16
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    re[0] = 1
    const X = fftRadix2(re, im)
    for (let k = 0; k < N; k++) {
      expect(X.re[k]).toBeCloseTo(1, 10)
      expect(X.im[k]).toBeCloseTo(0, 10)
    }
  })

  it('rejects non power-of-two', () => {
    const re = new Float64Array(6)
    const im = new Float64Array(6)
    expect(() => fftRadix2(re, im)).toThrow()
  })

  it('runFftRadix2Sample: ok, methodId/familyId method-fft', () => {
    const r = runFftRadix2Sample({ N: 32, k0: 3 })
    expect(r.methodId).toBe(METHOD_ALGO_FFT_RADIX2)
    expect(r.familyId).toBe(METHOD_FFT)
    expect(r.familyId).toBe('method-fft')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.dftMaxErr).toBeLessThan(1e-9)
    expect(r.roundTripMaxErr).toBeLessThan(1e-10)
    expect(r.peakK).toBe(3)
    expect(r.N).toBe(32)
    expect(r.N).toBeLessThanOrEqual(FFT_MAX_N)
  })

  it('runFftRadix2Sample N=8 also ok', () => {
    const r = runFftRadix2Sample({ N: 8, k0: 2 })
    expect(r.ok).toBe(true)
    expect(r.dftMaxErr).toBeLessThan(1e-9)
  })
})
