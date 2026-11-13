import { describe, it, expect } from 'vitest'
import {
  FARADAY_METHOD_ID,
  FARADAY_PARENT,
  runFaradaySample,
  runInducedEmfSample,
  runMotionalEmfSample,
  runRotatingCoilSample,
} from './faraday-algos'

describe('法拉第感应算法模块', () => {
  it('方法 id 常量对齐目录', () => {
    expect(FARADAY_METHOD_ID).toBe('method-algo-faraday')
    expect(FARADAY_PARENT).toBe('method-lumped-circuit')
  })

  it('runInducedEmfSample：ε=−N·dΦ/dt 且楞次符号', () => {
    const r = runInducedEmfSample()
    expect(r.emf).toBeCloseTo(-r.N * r.dPhiDt, 12)
    expect(r.lenzSign).toBe(true)
  })

  it('runMotionalEmfSample：ε=B·L·v 对 v 线性', () => {
    const r = runMotionalEmfSample()
    expect(r.e0).toBeCloseTo(0, 12)
    expect(r.e1).toBeCloseTo(r.B * r.L * 2, 12)
    expect(r.e2).toBeCloseTo(2 * r.e1, 12)
  })

  it('runRotatingCoilSample：峰值、90° 相位差、数值对拍', () => {
    const r = runRotatingCoilSample()
    expect(r.peak).toBeGreaterThan(0)
    expect(r.flux0).toBeCloseTo(r.peak / (2 * Math.PI * 50), 9) // N·B·A = peak/ω
    expect(r.emf0).toBeCloseTo(0, 9)
    expect(r.fluxQuarter).toBeCloseTo(0, 9)
    expect(r.emfQuarter).toBeCloseTo(r.peak, 6)
    expect(r.numRelErrMax).toBeLessThan(1e-3)
  })

  it('runFaradaySample 聚合三项样例均有限', () => {
    const r = runFaradaySample()
    expect(r.induced.lenzSign).toBe(true)
    expect(r.motional.e1).toBeGreaterThan(0)
    expect(r.coil.peak).toBeGreaterThan(0)
  })
})
