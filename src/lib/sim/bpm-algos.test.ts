import { describe, it, expect } from 'vitest'
import {
  METHOD_BPM,
  METHOD_ALGO_BPM_SPLIT_STEP,
  BPM_METHOD_IDS,
  angularSpectrumStep,
  applyPhaseScreen,
  beamPower,
  beamWidthRms,
  createGaussianBeam1d,
  dftComplex1d,
  idftComplex1d,
  rayleighRange,
  runBpmSplitStepSample,
  splitStepBpm,
  transverseWaveNumbers,
} from './bpm-algos'

describe('BPM · split-step Fourier（傍轴）', () => {
  it('方法 id 常量（family / algo 可未入库）', () => {
    expect(METHOD_BPM).toBe('method-bpm')
    expect(METHOD_ALGO_BPM_SPLIT_STEP).toBe('method-algo-bpm-split-step')
    expect(BPM_METHOD_IDS).toContain(METHOD_ALGO_BPM_SPLIT_STEP)
  })

  it('transverseWaveNumbers：κ 反对称、零频 0', () => {
    const L = 2 * Math.PI
    const κ = transverseWaveNumbers(8, L)
    expect(κ[0]).toBeCloseTo(0, 12)
    expect(κ[1]).toBeCloseTo(1, 12)
    expect(κ[7]).toBeCloseTo(-1, 12)
  })

  it('DFT 往返：实高斯近似还原', () => {
    const f = createGaussianBeam1d({ n: 32, L: 10, w0: 1 })
    const { re: Re, im: Im } = dftComplex1d(f.re, f.im)
    const inv = idftComplex1d(Re, Im)
    let maxErr = 0
    for (let i = 0; i < f.n; i++) {
      maxErr = Math.max(maxErr, Math.abs(inv.re[i]! - f.re[i]!), Math.abs(inv.im[i]!))
    }
    expect(maxErr).toBeLessThan(1e-12)
  })

  it('自由空间角谱：功率守恒，束宽增大', () => {
    const f = createGaussianBeam1d({ n: 128, L: 24, w0: 1.5 })
    const k0 = 2 * Math.PI
    const zR = rayleighRange(k0, 1.5)
    const w0m = beamWidthRms(f.re, f.im, f.L)
    const p0 = beamPower(f.re, f.im, f.dx)
    angularSpectrumStep(f.re, f.im, f.L, k0, 1.2 * zR)
    const wF = beamWidthRms(f.re, f.im, f.L)
    const pF = beamPower(f.re, f.im, f.dx)
    expect(wF).toBeGreaterThan(w0m * 1.2)
    expect(Math.abs(pF - p0) / p0).toBeLessThan(1e-10)
  })

  it('相位屏：均匀相位不改 |u|', () => {
    const f = createGaussianBeam1d({ n: 32, L: 8, w0: 1 })
    const phase = new Float64Array(f.n)
    phase.fill(0.7)
    const p0 = beamPower(f.re, f.im, f.dx)
    applyPhaseScreen(f.re, f.im, phase)
    expect(beamPower(f.re, f.im, f.dx)).toBeCloseTo(p0, 12)
  })

  it('split-step 纯自由空间 ≡ 整步角谱（功率/宽度）', () => {
    const a = createGaussianBeam1d({ n: 64, L: 20, w0: 1.2 })
    const b = createGaussianBeam1d({ n: 64, L: 20, w0: 1.2 })
    const k0 = 2 * Math.PI
    const dz = 0.8
    angularSpectrumStep(a.re, a.im, a.L, k0, dz)
    splitStepBpm(b.re, b.im, b.L, k0, dz, null)
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

  it('runBpmSplitStepSample ok：衍射展宽 + 功率守恒', () => {
    const r = runBpmSplitStepSample({ n: 128, L: 24, w0: 1.5, steps: 20 })
    expect(r.methodId).toBe(METHOD_ALGO_BPM_SPLIT_STEP)
    expect(r.familyId).toBe(METHOD_BPM)
    expect(r.finite).toBe(true)
    expect(r.powerConserved).toBe(true)
    expect(r.widthGrew).toBe(true)
    expect(r.widthF).toBeGreaterThan(r.width0)
    expect(r.ok).toBe(true)
  })

  it('runBpmSplitStepSample withLens：有限且 ok', () => {
    const r = runBpmSplitStepSample({
      n: 96,
      L: 20,
      w0: 1.4,
      steps: 16,
      withLens: true,
    })
    expect(r.finite).toBe(true)
    expect(r.powerConserved).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.methodId).toBe(METHOD_ALGO_BPM_SPLIT_STEP)
  })
})
