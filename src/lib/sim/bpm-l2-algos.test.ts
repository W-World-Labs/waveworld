import { describe, it, expect } from 'vitest'
import {
  METHOD_BPM,
  METHOD_ALGO_BPM_KERR,
  BPM_L2_PARENT,
  BPM_L2_METHOD_IDS,
  applyKerrPhase,
  kerrPhase,
  runBpmKerrSample,
  spectralWidthRms,
  splitStepBpmKerr,
} from './bpm-l2-algos'
import {
  beamPower,
  createGaussianBeam1d,
  angularSpectrumStep,
} from './bpm-algos'

describe('BPM L2 · Kerr 非线性（SPM）', () => {
  it('方法 id 常量（family / algo 可未入库）', () => {
    expect(METHOD_BPM).toBe('method-bpm')
    expect(BPM_L2_PARENT).toBe('method-bpm')
    expect(METHOD_ALGO_BPM_KERR).toBe('method-algo-bpm-kerr')
    expect(BPM_L2_METHOD_IDS).toContain(METHOD_ALGO_BPM_KERR)
  })

  it('kerrPhase：φ = γ |A|² dz，与强度成正比', () => {
    const re = new Float64Array([1, 2, 0])
    const im = new Float64Array([0, 0, 1])
    const ph = kerrPhase(re, im, 0.5, 2)
    expect(ph[0]).toBeCloseTo(0.5 * 1 * 2, 12)
    expect(ph[1]).toBeCloseTo(0.5 * 4 * 2, 12)
    expect(ph[2]).toBeCloseTo(0.5 * 1 * 2, 12)
  })

  it('applyKerrPhase：功率严格守恒，|A| 不变', () => {
    const f = createGaussianBeam1d({ n: 64, L: 16, w0: 1.2, amp: 1.5 })
    const p0 = beamPower(f.re, f.im, f.dx)
    const mag0 = new Float64Array(f.n)
    for (let i = 0; i < f.n; i++) {
      mag0[i] = Math.hypot(f.re[i]!, f.im[i]!)
    }
    applyKerrPhase(f.re, f.im, 1.2, 0.5)
    expect(beamPower(f.re, f.im, f.dx)).toBeCloseTo(p0, 12)
    for (let i = 0; i < f.n; i++) {
      expect(Math.hypot(f.re[i]!, f.im[i]!)).toBeCloseTo(mag0[i]!, 10)
    }
  })

  it('纯 SPM：功率守恒且谱展宽', () => {
    const f = createGaussianBeam1d({ n: 128, L: 24, w0: 1.5, amp: 1.5 })
    const p0 = beamPower(f.re, f.im, f.dx)
    const s0 = spectralWidthRms(f.re, f.im, f.L)
    const steps = 40
    const dz = 2 / steps
    for (let s = 0; s < steps; s++) applyKerrPhase(f.re, f.im, 0.9, dz)
    const pF = beamPower(f.re, f.im, f.dx)
    const sF = spectralWidthRms(f.re, f.im, f.L)
    expect(Math.abs(pF - p0) / p0).toBeLessThan(1e-10)
    expect(sF).toBeGreaterThan(s0 * 1.1)
  })

  it('splitStepBpmKerr γ=0 ≡ 整步角谱', () => {
    const a = createGaussianBeam1d({ n: 64, L: 20, w0: 1.2 })
    const b = createGaussianBeam1d({ n: 64, L: 20, w0: 1.2 })
    const k0 = 2 * Math.PI
    const dz = 0.6
    angularSpectrumStep(a.re, a.im, a.L, k0, dz)
    splitStepBpmKerr(b.re, b.im, b.L, k0, dz, 0)
    let maxErr = 0
    for (let i = 0; i < a.n; i++) {
      maxErr = Math.max(
        maxErr,
        Math.abs(a.re[i]! - b.re[i]!),
        Math.abs(a.im[i]! - b.im[i]!),
      )
    }
    expect(maxErr).toBeLessThan(1e-10)
  })

  it('splitStepBpmKerr：有 γ 时功率仍守恒', () => {
    const f = createGaussianBeam1d({ n: 96, L: 20, w0: 1.3, amp: 1.2 })
    const k0 = 2 * Math.PI
    const p0 = beamPower(f.re, f.im, f.dx)
    for (let s = 0; s < 20; s++) {
      splitStepBpmKerr(f.re, f.im, f.L, k0, 0.05, 0.6)
    }
    const pF = beamPower(f.re, f.im, f.dx)
    expect(Math.abs(pF - p0) / p0).toBeLessThan(0.02)
  })

  it('runBpmKerrSample pureSpm：ok + 谱展宽 + 功率守恒', () => {
    const r = runBpmKerrSample({
      n: 128,
      L: 24,
      w0: 1.5,
      amp: 1.5,
      gamma: 0.8,
      zTotal: 2,
      steps: 32,
      pureSpm: true,
    })
    expect(r.methodId).toBe(METHOD_ALGO_BPM_KERR)
    expect(r.familyId).toBe(METHOD_BPM)
    expect(r.finite).toBe(true)
    expect(r.powerConserved).toBe(true)
    expect(r.spectrumBroadened).toBe(true)
    expect(r.specF).toBeGreaterThan(r.spec0)
    expect(r.ok).toBe(true)
  })

  it('runBpmKerrSample with diffraction：ok + 功率守恒', () => {
    const r = runBpmKerrSample({
      n: 96,
      L: 20,
      w0: 1.4,
      amp: 1.2,
      gamma: 0.5,
      zTotal: 1.2,
      steps: 24,
      pureSpm: false,
    })
    expect(r.methodId).toBe(METHOD_ALGO_BPM_KERR)
    expect(r.familyId).toBe(METHOD_BPM)
    expect(r.finite).toBe(true)
    expect(r.powerConserved).toBe(true)
    expect(r.ok).toBe(true)
  })
})
