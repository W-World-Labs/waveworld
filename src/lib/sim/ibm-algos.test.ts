import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_IBM_DELTA,
  METHOD_ALGO_IBM_INTERPOLATE,
  METHOD_IMMERSED_BOUNDARY,
  ibmDelta,
  peskinPhi4,
  runIbmDeltaSample,
  runIbmInterpolateSample,
  spreadForce1d,
} from './ibm-algos'
import { methodById } from '../../data/methods/methods'

describe('浸没边界 · 1D δ 核力铺展', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(METHOD_IMMERSED_BOUNDARY).toBe('method-immersed-boundary')
    expect(METHOD_ALGO_IBM_DELTA).toBe('method-algo-ibm-delta')
    const m = methodById(METHOD_IMMERSED_BOUNDARY)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
  })

  it('Peskin φ₄：支撑外为 0，r=0 为 1/2', () => {
    expect(peskinPhi4(0)).toBeCloseTo(0.5, 12)
    expect(peskinPhi4(2)).toBe(0)
    expect(peskinPhi4(-2)).toBe(0)
    expect(peskinPhi4(3)).toBe(0)
    expect(peskinPhi4(1)).toBeCloseTo(0.25 * (1 + Math.cos(Math.PI / 2)), 12)
  })

  it('离散单位分解：∑_j φ(r−j) ≈ 1（|r| 在格内）', () => {
    for (const r of [0, 0.3, 0.7, 1.2, -0.5]) {
      let s = 0
      for (let j = -3; j <= 3; j++) s += peskinPhi4(r - j)
      expect(s).toBeCloseTo(1, 10)
    }
  })

  it('ibmDelta 与 φ/h 一致', () => {
    const h = 0.5
    expect(ibmDelta(0, h)).toBeCloseTo(peskinPhi4(0) / h, 12)
    expect(ibmDelta(3 * h, h)).toBe(0)
  })

  it('力铺展总力守恒 ∑ f_i h = F', () => {
    const N = 40
    const h = 0.25
    const force = new Float64Array(N)
    const X = 5.1
    const F = 1.7
    const total = spreadForce1d(force, X, F, h, 0)
    expect(total).toBeCloseTo(F, 10)
    // 力应集中在 X 附近
    let peakI = 0
    for (let i = 1; i < N; i++) {
      if (Math.abs(force[i]!) > Math.abs(force[peakI]!)) peakI = i
    }
    const xPeak = peakI * h
    expect(Math.abs(xPeak - X)).toBeLessThan(2 * h)
  })

  it('runIbmDeltaSample：总力守恒、峰在点附近', () => {
    const r = runIbmDeltaSample()
    expect(r.methodId).toBe(METHOD_ALGO_IBM_DELTA)
    expect(r.familyId).toBe(METHOD_IMMERSED_BOUNDARY)
    expect(r.forceErr).toBeLessThan(1e-10)
    expect(r.gridTotal).toBeCloseTo(r.F, 10)
    expect(r.peakValue).toBeGreaterThan(0)
    // X=32.3 → 峰约在 32
    expect(r.peakIndex).toBeGreaterThanOrEqual(30)
    expect(r.peakIndex).toBeLessThanOrEqual(34)
  })

  it('runIbmInterpolateSample：常数场再现', () => {
    const r = runIbmInterpolateSample()
    expect(r.methodId).toBe(METHOD_ALGO_IBM_INTERPOLATE)
    expect(r.constErr).toBeLessThan(1e-10)
    expect(r.interpConst).toBeCloseTo(r.constField, 10)
    expect(r.linearErr).toBeLessThan(0.05)
    expect(methodById(METHOD_ALGO_IBM_INTERPOLATE)).toBeDefined()
  })
})
