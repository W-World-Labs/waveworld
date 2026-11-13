import { describe, it, expect } from 'vitest'
import {
  WAVELET_L2_PARENT,
  WAVELET_L2_METHOD_IDS,
  METHOD_ALGO_WAVELET_HARD_THRESH,
  hardThreshold,
  hardThresholdVec,
  mse,
  snrDb,
  haarHardThreshDenoise,
  runWaveletHardThreshSample,
} from './wavelet-l2-algos'
import { METHOD_WAVELET, haarDwt1Level, haarIdwt1Level } from './wavelet-algos'
import { methodById } from '../../data/methods/methods'

describe('小波 L2 · Haar 细节硬阈值', () => {
  it('方法 id 常量（hard-thresh 为未入库新 id，仅校验父族）', () => {
    expect(WAVELET_L2_PARENT).toBe('method-wavelet')
    expect(WAVELET_L2_PARENT).toBe(METHOD_WAVELET)
    expect(METHOD_ALGO_WAVELET_HARD_THRESH).toBe('method-algo-wavelet-hard-thresh')
    expect(WAVELET_L2_METHOD_IDS).toContain(METHOD_ALGO_WAVELET_HARD_THRESH)
    // 父族已在目录；子 id 尚未入库 — 勿 methodById 新 id
    expect(methodById(WAVELET_L2_PARENT)).toBeDefined()
    expect(methodById(WAVELET_L2_PARENT)!.role).toBe('family')
  })

  it('hardThreshold：超过阈值保留，否则 0', () => {
    expect(hardThreshold(2, 0.5)).toBe(2)
    expect(hardThreshold(-2, 0.5)).toBe(-2)
    expect(hardThreshold(0.3, 0.5)).toBe(0)
    expect(hardThreshold(-0.3, 0.5)).toBe(0)
    expect(hardThreshold(0.5, 0.5)).toBe(0) // 严格 >
    const v = hardThresholdVec([1, -1, 0.1, 0.6], 0.5)
    expect(v[0]).toBe(1)
    expect(v[1]).toBe(-1)
    expect(v[2]).toBe(0)
    expect(v[3]).toBe(0.6)
  })

  it('mse / snrDb 基本性质', () => {
    expect(mse([1, 2], [1, 2])).toBe(0)
    expect(mse([1, 0], [0, 0])).toBeCloseTo(0.5, 12)
    expect(snrDb([1, 0], [1, 0])).toBe(Number.POSITIVE_INFINITY)
    // clean=[1,0], est=[0,0] → pe=1, ps=1 → 0 dB
    expect(snrDb([1, 0], [0, 0])).toBeCloseTo(0, 12)
  })

  it('无噪声常数块：细节≈0，硬阈值后精确重构', () => {
    const x = new Float64Array([2, 2, 2, 2, -1, -1, -1, -1])
    const { detail, recon } = haarHardThreshDenoise(x, 0.1)
    // 块内细节应为 0；块界可能有小细节
    let maxInBlock = 0
    for (let i = 0; i < detail.length; i++) {
      if (i !== 1 && i !== 2) maxInBlock = Math.max(maxInBlock, Math.abs(detail[i]!))
    }
    expect(maxInBlock).toBeLessThan(1e-14)
    for (let i = 0; i < x.length; i++) {
      expect(recon[i]).toBeCloseTo(x[i]!, 12)
    }
  })

  it('硬阈值细节后可与 Haar 正/逆闭合', () => {
    const x = new Float64Array([0, 1, 0, 1, 2, 2, 0, 0])
    const { approx, detailThresh, recon } = haarHardThreshDenoise(x, 0.5)
    const again = haarIdwt1Level(approx, detailThresh)
    for (let i = 0; i < recon.length; i++) {
      expect(again[i]).toBeCloseTo(recon[i]!, 12)
    }
    // 近似未改
    const { approx: a2 } = haarDwt1Level(x)
    for (let i = 0; i < approx.length; i++) {
      expect(approx[i]).toBeCloseTo(a2[i]!, 12)
    }
  })

  it('runWaveletHardThreshSample：细节能量↓、MSE↓、SNR↑', () => {
    const r = runWaveletHardThreshSample()
    expect(r.methodId).toBe(METHOD_ALGO_WAVELET_HARD_THRESH)
    expect(r.familyId).toBe(WAVELET_L2_PARENT)
    expect(r.N).toBeGreaterThanOrEqual(8)
    expect(r.detailEnergyReduced).toBe(true)
    expect(r.detailEnergyAfter).toBeLessThan(r.detailEnergyBefore)
    expect(r.mseImproved).toBe(true)
    expect(r.mseDenoised).toBeLessThan(r.mseNoisy)
    expect(r.snrImproved).toBe(true)
    expect(r.snrDenoisedDb).toBeGreaterThan(r.snrNoisyDb)
    expect(Number.isFinite(r.snrDenoisedDb)).toBe(true)
  })
})
