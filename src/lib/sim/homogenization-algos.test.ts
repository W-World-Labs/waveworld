import { describe, it, expect } from 'vitest'
import {
  METHOD_HOMOGENIZATION,
  METHOD_ALGO_HOMOG_SERIES,
  METHOD_ALGO_HOMOG_PARALLEL,
  HOMOG_PARENT,
  HOMOG_METHOD_IDS,
  DEFAULT_LAYERS,
  volumeSum,
  normalizeLayers,
  effectiveConductivitySeries,
  effectiveConductivityParallel,
  wienerBoundHolds,
  singlePhaseK,
  runHomogSeriesSample,
  runHomogParallelSample,
  type HomogLayer,
} from './homogenization-algos'

describe('Homogenization · 1D effective conductivity', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_HOMOGENIZATION).toBe('method-homogenization')
    expect(METHOD_ALGO_HOMOG_SERIES).toBe('method-algo-homog-series')
    expect(METHOD_ALGO_HOMOG_PARALLEL).toBe('method-algo-homog-parallel')
    expect(HOMOG_PARENT).toBe(METHOD_HOMOGENIZATION)
    expect(HOMOG_METHOD_IDS).toContain(METHOD_ALGO_HOMOG_SERIES)
    expect(HOMOG_METHOD_IDS).toContain(METHOD_ALGO_HOMOG_PARALLEL)
  })

  it('volumeSum / normalizeLayers: Σv → 1', () => {
    expect(volumeSum(DEFAULT_LAYERS)).toBeCloseTo(1, 12)
    const raw: HomogLayer[] = [
      { k: 2, v: 1 },
      { k: 8, v: 3 },
    ]
    const n = normalizeLayers(raw)
    expect(volumeSum(n)).toBeCloseTo(1, 12)
    expect(n[0]!.v).toBeCloseTo(0.25, 12)
    expect(n[1]!.v).toBeCloseTo(0.75, 12)
  })

  it('single phase: series = parallel = k', () => {
    const L = singlePhaseK(4.5)
    expect(effectiveConductivitySeries(L)).toBeCloseTo(4.5, 12)
    expect(effectiveConductivityParallel(L)).toBeCloseTo(4.5, 12)
    expect(wienerBoundHolds(L)).toBe(true)
  })

  it('two equal-v layers: harmonic series, arithmetic parallel', () => {
    const layers: HomogLayer[] = [
      { k: 1, v: 0.5 },
      { k: 10, v: 0.5 },
    ]
    const ks = effectiveConductivitySeries(layers)
    const kp = effectiveConductivityParallel(layers)
    // harmonic mean of 1 and 10
    expect(ks).toBeCloseTo(2 / (1 / 1 + 1 / 10), 12)
    expect(ks).toBeCloseTo(20 / 11, 12)
    expect(kp).toBeCloseTo(5.5, 12)
    expect(ks).toBeLessThan(kp)
    expect(wienerBoundHolds(layers)).toBe(true)
  })

  it('series ≤ parallel for same layers (Wiener bounds)', () => {
    const stacks: HomogLayer[][] = [
      [
        { k: 1, v: 0.3 },
        { k: 100, v: 0.7 },
      ],
      [
        { k: 2, v: 0.2 },
        { k: 5, v: 0.5 },
        { k: 20, v: 0.3 },
      ],
      [...DEFAULT_LAYERS],
    ]
    for (const layers of stacks) {
      const ks = effectiveConductivitySeries(layers)
      const kp = effectiveConductivityParallel(layers)
      expect(ks).toBeLessThanOrEqual(kp + 1e-12)
      expect(wienerBoundHolds(layers)).toBe(true)
      expect(ks).toBeGreaterThan(0)
      expect(kp).toBeGreaterThan(0)
    }
  })

  it('rejects non-positive conductivity', () => {
    expect(() =>
      effectiveConductivitySeries([{ k: 0, v: 1 }]),
    ).toThrow(/k must/)
    expect(() =>
      effectiveConductivityParallel([{ k: -1, v: 1 }]),
    ).toThrow(/k must/)
  })

  it('runHomogSeriesSample: ok, series ≤ parallel, methodId/familyId', () => {
    const r = runHomogSeriesSample()
    expect(r.methodId).toBe(METHOD_ALGO_HOMOG_SERIES)
    expect(r.familyId).toBe(METHOD_HOMOGENIZATION)
    expect(r.familyId).toBe('method-homogenization')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.seriesLeqParallel).toBe(true)
    expect(r.kSeries).toBeLessThanOrEqual(r.kParallel)
    expect(r.kSeries).toBeCloseTo(20 / 11, 10)
    expect(r.matchesTwoLayerHarmonic).toBe(true)
    expect(r.volumeSum).toBeCloseTo(1, 12)
  })

  it('runHomogParallelSample: ok, arithmetic mean, methodId/familyId', () => {
    const r = runHomogParallelSample()
    expect(r.methodId).toBe(METHOD_ALGO_HOMOG_PARALLEL)
    expect(r.familyId).toBe(METHOD_HOMOGENIZATION)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.seriesLeqParallel).toBe(true)
    expect(r.kParallel).toBeCloseTo(5.5, 10)
    expect(r.kSeries).toBeLessThanOrEqual(r.kParallel)
    expect(r.matchesTwoLayerArithmetic).toBe(true)
  })

  it('series and parallel samples agree on Wiener ordering for same custom layers', () => {
    const layers: HomogLayer[] = [
      { k: 3, v: 0.4 },
      { k: 12, v: 0.6 },
    ]
    const s = runHomogSeriesSample({ layers })
    const p = runHomogParallelSample({ layers })
    expect(s.ok).toBe(true)
    expect(p.ok).toBe(true)
    expect(s.kSeries).toBeCloseTo(p.kSeries, 12)
    expect(s.kParallel).toBeCloseTo(p.kParallel, 12)
    expect(s.kSeries).toBeLessThan(s.kParallel)
  })
})
