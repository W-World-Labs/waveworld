import { describe, it, expect } from 'vitest'
import {
  C_EM,
  SPECTRUM_BAND_GROUP,
  SPECTRUM_BAND_METHOD_IDS,
  SPECTRUM_PARENT,
  V_SOUND,
  compareSpectrumBands,
  emFreqFromLambda,
  emLambdaFromFreq,
  expectedWaveSpeed,
  runSpectrumBandSample,
  shoFreq,
  soundFreqFromLambda,
  soundLambdaFromFreq,
  spectrumBandParallelCount,
  spectrumChildCount,
  stringModalFreq,
  stringModalLambda,
  stringWaveSpeed,
  type SpectrumBandKind,
} from './spectrum-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('频谱观测 · spectrum-band 并行模块', () => {
  it('父族与并行组对齐目录（EM / 声 / 振动）', () => {
    expect(SPECTRUM_PARENT).toBe('method-spectrum-viewer')
    expect(spectrumChildCount()).toBeGreaterThanOrEqual(3)
    expect(spectrumBandParallelCount()).toBe(3)
    expect(parallelGroup(SPECTRUM_BAND_GROUP).length).toBe(3)
    for (const id of Object.values(SPECTRUM_BAND_METHOD_IDS)) {
      const m = methodById(id)
      expect(m?.parentId).toBe(SPECTRUM_PARENT)
      expect(m?.parallelGroupId).toBe(SPECTRUM_BAND_GROUP)
      expect(m?.role).toBe('parallel-variant')
    }
  })

  it('EM 助手：f = c/λ，product ≈ 3e8', () => {
    const lambda = 500e-9
    const f = emFreqFromLambda(lambda)
    expect(f).toBeCloseTo(C_EM / lambda, 6)
    expect(f * lambda).toBeCloseTo(C_EM, 5)
    expect(emLambdaFromFreq(f)).toBeCloseTo(lambda, 12)
  })

  it('声 助手：f = v/λ，product ≈ 343', () => {
    const lambda = 0.5
    const f = soundFreqFromLambda(lambda)
    expect(f).toBeCloseTo(V_SOUND / lambda, 10)
    expect(f * lambda).toBeCloseTo(V_SOUND, 10)
    expect(soundLambdaFromFreq(f)).toBeCloseTo(lambda, 12)
  })

  it('振动：弦模态 f·λ = √(T/μ)；SHO f = √(k/m)/(2π)', () => {
    const L = 0.8
    const T = 40
    const mu = 0.0025
    const n = 2
    const f = stringModalFreq(n, L, T, mu)
    const lambda = stringModalLambda(n, L)
    const v = stringWaveSpeed(T, mu)
    expect(f).toBeCloseTo((n / (2 * L)) * v, 12)
    expect(f * lambda).toBeCloseTo(v, 10)

    // 简谐：k/m = ω² = (2πf)²
    const k = 100
    const m = 0.25
    const fSho = shoFreq(k, m)
    expect(fSho).toBeCloseTo(Math.sqrt(k / m) / (2 * Math.PI), 12)
    expect(fSho).toBeCloseTo(10 / Math.PI, 10) // √400=20 → 20/(2π)=10/π
  })

  it('runSpectrumBandSample：各 kind 的 product 贴近波速', () => {
    const kinds: SpectrumBandKind[] = ['em', 'sound', 'vibration']
    for (const kind of kinds) {
      const r = runSpectrumBandSample(kind)
      expect(r.kind).toBe(kind)
      expect(r.f).toBeGreaterThan(0)
      expect(r.lambda).toBeGreaterThan(0)
      expect(r.product).toBeCloseTo(expectedWaveSpeed(kind), 5)
      // product = f·λ 代数闭合
      expect(r.product).toBeCloseTo(r.f * r.lambda, 10)
    }

    // 显式对拍 c 与 343
    expect(runSpectrumBandSample('em').product).toBeCloseTo(3e8, 5)
    expect(runSpectrumBandSample('sound').product).toBeCloseTo(343, 10)
    expect(runSpectrumBandSample('vibration').product).toBeCloseTo(100, 10)
  })

  it('compareSpectrumBands 覆盖三并行且波速可区分', () => {
    const all = compareSpectrumBands()
    expect(Object.keys(all).sort()).toEqual(['em', 'sound', 'vibration'])
    const speeds = (['em', 'sound', 'vibration'] as const).map((k) => all[k].product)
    expect(new Set(speeds.map((s) => s.toFixed(3))).size).toBe(3)
    expect(all.em.product).toBeGreaterThan(all.sound.product)
    expect(all.sound.product).toBeGreaterThan(all.vibration.product)
  })
})
