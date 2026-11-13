import { describe, it, expect } from 'vitest'
import {
  METHOD_KMC,
  METHOD_ALGO_KMC_RATES,
  METHOD_ALGO_KMC_STEP,
  KMC_PARENT,
  KMC_METHOD_IDS,
  mulberry32,
  unitOpen01,
  totalRate,
  cumulativeRates,
  pickEventNFold,
  kmcTimeAdvance,
  adsDesRates,
  kmcStepAdsDes,
  runAdsDesTrajectory,
  sampleEventFrequencies,
  runKmcRatesSample,
  runKmcStepSample,
} from './kmc-algos'

describe('KMC · n-fold rates + exponential clock + 2-state ads/des', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_KMC).toBe('method-kmc')
    expect(METHOD_ALGO_KMC_RATES).toBe('method-algo-kmc-rates')
    expect(METHOD_ALGO_KMC_STEP).toBe('method-algo-kmc-step')
    expect(KMC_PARENT).toBe(METHOD_KMC)
    expect(KMC_METHOD_IDS).toContain(METHOD_ALGO_KMC_RATES)
    expect(KMC_METHOD_IDS).toContain(METHOD_ALGO_KMC_STEP)
  })

  it('mulberry32 可复现且 ∈[0,1)', () => {
    const a = mulberry32(99)
    const b = mulberry32(99)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    for (const u of seqA) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('totalRate / cumulativeRates', () => {
    const rates = [1, 2, 0.5]
    expect(totalRate(rates)).toBeCloseTo(3.5, 12)
    const c = cumulativeRates(rates)
    expect(c[0]).toBeCloseTo(1, 12)
    expect(c[1]).toBeCloseTo(3, 12)
    expect(c[2]).toBeCloseTo(3.5, 12)
    expect(totalRate([0, 0])).toBe(0)
  })

  it('unitOpen01 与 kmcTimeAdvance 指数钟', () => {
    expect(unitOpen01(0)).toBeGreaterThan(0)
    expect(unitOpen01(0.5)).toBeCloseTo(0.5, 12)
    const R = 2
    const dt = kmcTimeAdvance(R, Math.exp(-1))
    // −ln(e^{−1}) / 2 = 1/2
    expect(dt).toBeCloseTo(0.5, 12)
    expect(kmcTimeAdvance(1, 1)).toBeCloseTo(0, 12)
  })

  it('pickEventNFold：累积阈值选择（n-fold way）', () => {
    const rates = [1, 3, 0]
    // thr = u * 4; u=0.1 → thr=0.4 → event 0; u=0.5 → thr=2 → event 1
    expect(pickEventNFold(rates, 0.1)).toBe(0)
    expect(pickEventNFold(rates, 0.5)).toBe(1)
    expect(pickEventNFold(rates, 0.999)).toBe(1)
  })

  it('sampleEventFrequencies 逼近 r_i / R_tot', () => {
    const rates = [1, 2, 1]
    const { freqs, Rtot } = sampleEventFrequencies(rates, 12_000, 3)
    expect(Rtot).toBeCloseTo(4, 12)
    expect(freqs[0]).toBeCloseTo(0.25, 1)
    expect(freqs[1]).toBeCloseTo(0.5, 1)
    expect(freqs[2]).toBeCloseTo(0.25, 1)
    expect(Math.abs(freqs[0]! - 0.25)).toBeLessThan(0.02)
    expect(Math.abs(freqs[1]! - 0.5)).toBeLessThan(0.02)
  })

  it('adsDesRates：空位只吸附、占位只脱附', () => {
    const empty = adsDesRates(0, 1.2, 0.8)
    expect(empty[0]).toBeCloseTo(1.2, 12)
    expect(empty[1]).toBe(0)
    const full = adsDesRates(1, 1.2, 0.8)
    expect(full[0]).toBe(0)
    expect(full[1]).toBeCloseTo(0.8, 12)
  })

  it('kmcStepAdsDes：空位一步必吸附并翻转', () => {
    const rand = mulberry32(5)
    const s = kmcStepAdsDes(0, 2, 1, rand)
    expect(s.eventIndex).toBe(0)
    expect(s.occBefore).toBe(0)
    expect(s.occAfter).toBe(1)
    expect(s.Rtot).toBeCloseTo(2, 12)
    expect(s.dt).toBeGreaterThan(0)
    expect(Number.isFinite(s.dt)).toBe(true)
  })

  it('轨迹平均占据与平均事件率逼近稳态解析', () => {
    const kAbs = 1.5
    const kDes = 0.5
    const tr = runAdsDesTrajectory(40_000, kAbs, kDes, 11, 0)
    const theta = kAbs / (kAbs + kDes)
    const rate = (2 * kAbs * kDes) / (kAbs + kDes)
    expect(tr.analyticOcc).toBeCloseTo(theta, 12)
    expect(tr.analyticEventRate).toBeCloseTo(rate, 12)
    expect(Math.abs(tr.meanOcc - theta)).toBeLessThan(0.03)
    expect(Math.abs(tr.meanEventRate - rate)).toBeLessThan(0.05)
    expect(tr.time).toBeGreaterThan(0)
  })

  it('runKmcRatesSample：ok、methodId/familyId', () => {
    const r = runKmcRatesSample()
    expect(r.methodId).toBe(METHOD_ALGO_KMC_RATES)
    expect(r.familyId).toBe(METHOD_KMC)
    expect(r.familyId).toBe('method-kmc')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Rtot).toBeGreaterThan(0)
    expect(r.maxFreqErr).toBeLessThan(0.02)
    expect(Math.abs(r.meanDt - r.analyticMeanDt)).toBeLessThan(
      0.05 * r.analyticMeanDt,
    )
  })

  it('runKmcStepSample：ok、占据/速率、methodId/familyId', () => {
    const r = runKmcStepSample()
    expect(r.methodId).toBe(METHOD_ALGO_KMC_STEP)
    expect(r.familyId).toBe(METHOD_KMC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.meanOcc).toBeGreaterThan(0.5)
    expect(r.occErr).toBeLessThan(0.03)
    expect(r.rateErr).toBeLessThan(0.08 * r.analyticEventRate)
    expect(r.single.dt).toBeGreaterThan(0)
    expect(r.single.occAfter).toBe(1)
  })
})
