import { describe, it, expect } from 'vitest'
import {
  METHOD_MCRT,
  METHOD_ALGO_MCRT_WALK,
  MCRT_PARENT,
  MCRT_METHOD_IDS,
  mulberry32,
  extinction,
  albedo,
  pureAbsorptionTransmission,
  walkPhoton1d,
  estimateTransmission,
  runMcrtWalkSample,
} from './mcrt-algos'

describe('MCRT · 1D slab 光子随机游走', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_MCRT).toBe('method-mcrt')
    expect(METHOD_ALGO_MCRT_WALK).toBe('method-algo-mcrt-walk')
    expect(MCRT_PARENT).toBe(METHOD_MCRT)
    expect(MCRT_METHOD_IDS).toContain(METHOD_ALGO_MCRT_WALK)
  })

  it('extinction / albedo / 纯吸收解析透射', () => {
    expect(extinction(0.3, 0.7)).toBeCloseTo(1, 12)
    expect(albedo(0.3, 0.7)).toBeCloseTo(0.7, 12)
    expect(albedo(1, 0)).toBeCloseTo(0, 12)
    expect(albedo(0, 0)).toBe(0)
    expect(pureAbsorptionTransmission(1, 1)).toBeCloseTo(Math.exp(-1), 12)
    expect(pureAbsorptionTransmission(0, 5)).toBe(1)
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

  it('κ=0 真空：单光子直接透射', () => {
    const w = walkPhoton1d({ L: 2, sigmaA: 0, sigmaS: 0 }, mulberry32(1))
    expect(w.fate).toBe('transmitted')
    expect(w.interactions).toBe(0)
    expect(w.pathLength).toBeCloseTo(2, 12)
  })

  it('纯吸收 MC 逼近 exp(−κL)', () => {
    const L = 1.2
    const kappa = 0.8
    const analytic = pureAbsorptionTransmission(kappa, L)
    const est = estimateTransmission(
      { L, sigmaA: kappa, sigmaS: 0 },
      8000,
      11,
    )
    expect(est.omega).toBe(0)
    expect(est.T).toBeCloseTo(analytic, 1)
    expect(Math.abs(est.T - analytic)).toBeLessThan(0.02)
    expect(est.R).toBe(0)
    expect(est.T + est.A).toBeCloseTo(1, 10)
  })

  it('纯散射 ω=1：无吸收，T+R≈1', () => {
    const est = estimateTransmission(
      { L: 1, sigmaA: 0, sigmaS: 2, maxInteractions: 50_000 },
      3000,
      3,
    )
    expect(est.omega).toBeCloseTo(1, 12)
    expect(est.A).toBe(0)
    expect(est.T + est.R + est.truncatedFrac).toBeCloseTo(1, 10)
    expect(est.T).toBeGreaterThan(0)
    expect(est.T).toBeLessThan(1)
  })

  it('runMcrtWalkSample：ok、有限 T∈(0,1)、methodId/familyId', () => {
    const r = runMcrtWalkSample()
    expect(r.methodId).toBe(METHOD_ALGO_MCRT_WALK)
    expect(r.familyId).toBe(METHOD_MCRT)
    expect(r.familyId).toBe('method-mcrt')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.T_in_open_unit).toBe(true)
    expect(r.T).toBeGreaterThan(0)
    expect(r.T).toBeLessThan(1)
    expect(Number.isFinite(r.T)).toBe(true)
    expect(r.pureAbsErr).toBeLessThan(0.03)
    expect(r.truncatedFrac).toBeLessThan(0.02)
  })
})
