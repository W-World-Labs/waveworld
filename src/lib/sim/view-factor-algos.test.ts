import { describe, it, expect } from 'vitest'
import {
  METHOD_VIEW,
  METHOD_ALGO_VIEW_PARALLEL,
  VIEW_PARENT,
  VIEW_METHOD_IDS,
  DEFAULT_H,
  DEFAULT_R,
  viewFactorParallelInfinite,
  viewFactorFacingDisks,
  viewFactorConcentric,
  runViewParallelSample,
} from './view-factor-algos'

describe('View factor · parallel / disks / concentric', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_VIEW).toBe('method-view-factor')
    expect(METHOD_ALGO_VIEW_PARALLEL).toBe('method-algo-view-parallel')
    expect(VIEW_PARENT).toBe(METHOD_VIEW)
    expect(VIEW_METHOD_IDS).toContain(METHOD_ALGO_VIEW_PARALLEL)
  })

  it('viewFactorParallelInfinite: F = 1', () => {
    expect(viewFactorParallelInfinite()).toBe(1)
    expect(viewFactorParallelInfinite(DEFAULT_H, DEFAULT_R)).toBe(1)
    expect(Number.isNaN(viewFactorParallelInfinite(NaN))).toBe(true)
  })

  it('viewFactorFacingDisks: F = 1/(1+(H/R)²)', () => {
    expect(viewFactorFacingDisks(0, 1)).toBeCloseTo(1, 12)
    expect(viewFactorFacingDisks(1, 1)).toBeCloseTo(0.5, 12)
    expect(viewFactorFacingDisks(DEFAULT_H, DEFAULT_R)).toBeCloseTo(
      1 / (1 + (DEFAULT_H / DEFAULT_R) ** 2),
      12,
    )
    // large separation → small F
    expect(viewFactorFacingDisks(100, 1)).toBeLessThan(1e-3)
  })

  it('viewFactorFacingDisks: R≤0 / H<0 / non-finite → NaN', () => {
    expect(Number.isNaN(viewFactorFacingDisks(1, 0))).toBe(true)
    expect(Number.isNaN(viewFactorFacingDisks(-1, 1))).toBe(true)
    expect(Number.isNaN(viewFactorFacingDisks(1, NaN))).toBe(true)
  })

  it('viewFactorConcentric: F = r1/r2 for r1≤r2', () => {
    expect(viewFactorConcentric(0.5, 1)).toBeCloseTo(0.5, 12)
    expect(viewFactorConcentric(1, 1)).toBeCloseTo(1, 12)
    expect(Number.isNaN(viewFactorConcentric(2, 1))).toBe(true)
    expect(Number.isNaN(viewFactorConcentric(0, 1))).toBe(true)
  })

  it('runViewParallelSample: ok, F_parallel=1, disks formula', () => {
    const r = runViewParallelSample()
    expect(r.methodId).toBe(METHOD_ALGO_VIEW_PARALLEL)
    expect(r.familyId).toBe(METHOD_VIEW)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.F_parallel).toBe(1)
    expect(r.F_disks).toBeCloseTo(1 / (1 + (r.H / r.R) ** 2), 12)
    expect(r.F_disks_H0).toBe(1)
    expect(r.F_concentric).toBeCloseTo(r.r1 / r.r2, 12)
    expect(Number.isFinite(r.F_badR)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runViewParallelSample({ H: 2, R: 3, r1: 1, r2: 4 }).ok).toBe(true)
  })
})
