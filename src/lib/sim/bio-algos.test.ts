import { describe, it, expect } from 'vitest'
import {
  BIO_CHILD_METHOD_IDS,
  BIO_PARENT,
  bioChildCount,
  runBioCoreCheck,
  runFhnSpikeSample,
  runFhnSubthreshold,
} from './bio-algos'
import { methodById } from '../../data/methods/methods'

describe('生物电方法族模块化', () => {
  it('父族下有 ECG/EMG/EEG/FHN 子模块', () => {
    expect(bioChildCount()).toBeGreaterThanOrEqual(4)
    for (const id of BIO_CHILD_METHOD_IDS) {
      expect(methodById(id)?.parentId).toBe(BIO_PARENT)
    }
  })

  it('FHN 超阈尖峰 > 静息', () => {
    const r = runFhnSpikeSample()
    expect(r.tracePeak).toBeGreaterThan(r.resting + 0.5)
  })

  it('超阈峰值高于亚阈响应', () => {
    const r = runFhnSubthreshold()
    expect(r.peakSuper).toBeGreaterThan(r.peakSub)
  })

  it('runBioCoreCheck 驱动真实 fhnStep', () => {
    const r = runBioCoreCheck()
    expect(r.stepped).toBe(true)
    expect(r.fhn.tracePeak).toBeGreaterThan(0)
  })
})
