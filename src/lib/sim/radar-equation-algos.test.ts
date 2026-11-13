import { describe, it, expect } from 'vitest'
import {
  METHOD_RADAR,
  METHOD_ALGO_RADAR_PR,
  RADAR_EQ_PARENT,
  RADAR_EQ_METHOD_IDS,
  DEFAULT_PT,
  DEFAULT_GT,
  DEFAULT_GR,
  DEFAULT_LAMBDA,
  DEFAULT_SIGMA,
  DEFAULT_R,
  radarPr,
  runRadarPrSample,
} from './radar-equation-algos'

describe('Radar equation · Pr = Pt Gt Gr λ² σ / ((4π)³ R⁴)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RADAR).toBe('method-radar-equation')
    expect(METHOD_ALGO_RADAR_PR).toBe('method-algo-radar-pr')
    expect(RADAR_EQ_PARENT).toBe(METHOD_RADAR)
    expect(RADAR_EQ_METHOD_IDS).toContain(METHOD_ALGO_RADAR_PR)
  })

  it('radarPr: formula', () => {
    const Pt = 1000
    const Gt = 100
    const Gr = 100
    const lambda = 0.1
    const sigma = 1
    const R = 1000
    const expected =
      (Pt * Gt * Gr * lambda * lambda * sigma) /
      ((4 * Math.PI) ** 3 * R ** 4)
    expect(radarPr(Pt, Gt, Gr, lambda, sigma, R)).toBeCloseTo(expected, 12)
  })

  it('R→2R ⇒ Pr/16; Pt linear; bad → NaN', () => {
    const Pr = radarPr(
      DEFAULT_PT,
      DEFAULT_GT,
      DEFAULT_GR,
      DEFAULT_LAMBDA,
      DEFAULT_SIGMA,
      DEFAULT_R,
    )
    expect(
      radarPr(
        DEFAULT_PT,
        DEFAULT_GT,
        DEFAULT_GR,
        DEFAULT_LAMBDA,
        DEFAULT_SIGMA,
        2 * DEFAULT_R,
      ),
    ).toBeCloseTo(Pr / 16, 12)
    expect(
      radarPr(
        2 * DEFAULT_PT,
        DEFAULT_GT,
        DEFAULT_GR,
        DEFAULT_LAMBDA,
        DEFAULT_SIGMA,
        DEFAULT_R,
      ),
    ).toBeCloseTo(2 * Pr, 12)
    expect(
      Number.isNaN(
        radarPr(DEFAULT_PT, DEFAULT_GT, DEFAULT_GR, DEFAULT_LAMBDA, DEFAULT_SIGMA, 0),
      ),
    ).toBe(true)
    expect(Number.isNaN(radarPr(NaN, 1, 1, 1, 1, 1))).toBe(true)
  })

  it('runRadarPrSample: ok, formula, 1/16 double-R', () => {
    const r = runRadarPrSample()
    expect(r.methodId).toBe(METHOD_ALGO_RADAR_PR)
    expect(r.familyId).toBe(METHOD_RADAR)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Pr_doubleR).toBeCloseTo(r.Pr / 16, 12)
    expect(r.Pr_doublePt).toBeCloseTo(2 * r.Pr, 12)
    expect(Number.isFinite(r.Pr_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runRadarPrSample({ R: 500, Pt: 100 }).ok).toBe(true)
  })
})
