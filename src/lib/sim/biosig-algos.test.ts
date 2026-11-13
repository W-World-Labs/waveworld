import { describe, it, expect } from 'vitest'
import {
  BIOSIG_ALGO_METHOD_IDS,
  BIOSIG_PARENT,
  runBiosigAlgo,
  runEcgSample,
  runEegSample,
  runEmgSample,
  type BiosigAlgoId,
} from './biosig-algos'

describe('生物电信号算法模块（ECG/EMG/EEG · 纯函数）', () => {
  it('BIOSIG_PARENT / method id 常量对齐目录', () => {
    expect(BIOSIG_PARENT).toBe('method-bioelectric')
    expect(BIOSIG_ALGO_METHOD_IDS['ecg-wave']).toBe('method-algo-ecg-wave')
    expect(BIOSIG_ALGO_METHOD_IDS['emg-signal']).toBe('method-algo-emg-signal')
    expect(BIOSIG_ALGO_METHOD_IDS['eeg-rhythm']).toBe('method-algo-eeg-rhythm')
  })

  it('runEcgSample：有限长度、R 峰突出、方差非平凡（shipped ecgWaveform）', () => {
    const r = runEcgSample(75, 3, 500)
    expect(r.length).toBe(1500)
    expect(r.finite).toBe(true)
    expect(r.rr).toBeCloseTo(0.8, 6)
    // R 峰幅度接近 ECG_WAVES.R.amp=1
    expect(r.peak).toBeGreaterThan(0.9)
    expect(r.peakPhase).toBeCloseTo(r.rMu, 2)
    // 非平坦：有 PQRST 结构 → 方差 > 0
    expect(r.variance).toBeGreaterThan(0.01)
    expect(Number.isFinite(r.peak)).toBe(true)
  })

  it('runEmgSample：高激活 RMS/方差明显高于低激活，长度有限', () => {
    const r = runEmgSample(2000, 0.15, 0.9, 42)
    expect(r.length).toBe(2000)
    expect(r.finite).toBe(true)
    expect(r.rmsHigh).toBeGreaterThan(r.rmsLow * 2)
    expect(r.varianceHigh).toBeGreaterThan(r.varianceLow * 2)
    expect(r.peakHigh).toBeGreaterThan(0.1)
    expect(r.varianceLow).toBeGreaterThan(0)
    expect(Number.isFinite(r.rmsHigh)).toBe(true)
  })

  it('runEegSample：α 主导、有限长度轨迹、峰值与方差非零', () => {
    const r = runEegSample(1000, 250)
    expect(r.length).toBe(1000)
    expect(r.finite).toBe(true)
    expect(r.dominant).toBe('alpha')
    expect(r.powers.alpha).toBeGreaterThan(r.powers.beta!)
    expect(r.peak).toBeGreaterThan(0.5)
    expect(r.variance).toBeGreaterThan(0.1)
    expect(Number.isFinite(r.peak)).toBe(true)
  })

  it('runBiosigAlgo 分发覆盖全部子算法 id', () => {
    const ids = Object.keys(BIOSIG_ALGO_METHOD_IDS) as BiosigAlgoId[]
    expect(ids.length).toBe(3)
    for (const id of ids) {
      const out = runBiosigAlgo(id) as { length?: number; finite?: boolean }
      expect(out).toBeTruthy()
      expect(typeof out).toBe('object')
      if ('length' in out) expect(out.length).toBeGreaterThan(0)
      if ('finite' in out) expect(out.finite).toBe(true)
    }
  })
})
