import { describe, it, expect } from 'vitest'
import {
  METHOD_BREWSTER,
  METHOD_ALGO_BREWSTER,
  METHOD_MALUS,
  METHOD_ALGO_MALUS,
  BREWSTER_PARENT,
  MALUS_PARENT,
  BREWSTER_METHOD_IDS,
  MALUS_METHOD_IDS,
  DEFAULT_N1,
  DEFAULT_N2,
  DEFAULT_I0,
  brewsterAngle,
  malusIntensity,
  runBrewsterSample,
  runMalusSample,
} from './brewster-malus-algos'

describe('Brewster · θ_B = atan(n2/n1)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BREWSTER).toBe('method-brewster')
    expect(METHOD_ALGO_BREWSTER).toBe('method-algo-brewster-angle')
    expect(BREWSTER_PARENT).toBe(METHOD_BREWSTER)
    expect(BREWSTER_METHOD_IDS).toContain(METHOD_ALGO_BREWSTER)
  })

  it('brewsterAngle: formula air→glass', () => {
    const th = brewsterAngle(DEFAULT_N1, DEFAULT_N2)
    expect(th).toBeCloseTo(Math.atan(DEFAULT_N2 / DEFAULT_N1), 14)
    // ~56.3°
    expect(th * (180 / Math.PI)).toBeCloseTo(56.31, 1)
  })

  it('equal n ⇒ 45°; n≤0 → NaN', () => {
    expect(brewsterAngle(1.5, 1.5)).toBeCloseTo(Math.PI / 4, 14)
    expect(Number.isNaN(brewsterAngle(0, 1.5))).toBe(true)
    expect(Number.isNaN(brewsterAngle(1, -1))).toBe(true)
  })

  it('runBrewsterSample: ok, formula, swap product tan=1', () => {
    const r = runBrewsterSample()
    expect(r.methodId).toBe(METHOD_ALGO_BREWSTER)
    expect(r.familyId).toBe(METHOD_BREWSTER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.thetaB).toBeCloseTo(Math.atan(r.n2 / r.n1), 14)
    expect(r.thetaB_equalN).toBeCloseTo(Math.PI / 4, 14)
    expect(Math.tan(r.thetaB) * Math.tan(r.thetaB_swapped)).toBeCloseTo(1, 12)
    expect(Number.isFinite(r.thetaB_badN)).toBe(false)
  })
})

describe("Malus · I = I0 cos²(θ)", () => {
  it('method id constants', () => {
    expect(METHOD_MALUS).toBe('method-malus-law')
    expect(METHOD_ALGO_MALUS).toBe('method-algo-malus-i')
    expect(MALUS_PARENT).toBe(METHOD_MALUS)
    expect(MALUS_METHOD_IDS).toContain(METHOD_ALGO_MALUS)
  })

  it('malusIntensity: formula', () => {
    expect(malusIntensity(DEFAULT_I0, 0)).toBeCloseTo(DEFAULT_I0, 15)
    expect(malusIntensity(1, Math.PI / 2)).toBeCloseTo(0, 15)
    expect(malusIntensity(1, Math.PI / 4)).toBeCloseTo(0.5, 12)
  })

  it('non-finite → NaN', () => {
    expect(Number.isNaN(malusIntensity(NaN, 0))).toBe(true)
    expect(Number.isNaN(malusIntensity(1, Infinity))).toBe(true)
  })

  it('runMalusSample: ok, aligned/crossed/45°', () => {
    const r = runMalusSample()
    expect(r.methodId).toBe(METHOD_ALGO_MALUS)
    expect(r.familyId).toBe(METHOD_MALUS)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.I).toBeCloseTo(r.I0 * Math.cos(r.theta) ** 2, 12)
    expect(r.I_aligned).toBeCloseTo(r.I0, 15)
    expect(r.I_crossed).toBeCloseTo(0, 15)
    expect(r.I_45).toBeCloseTo(r.I0 / 2, 12)
  })

  it('custom params still ok', () => {
    expect(runBrewsterSample({ n1: 1.33, n2: 1.5 }).ok).toBe(true)
    expect(runMalusSample({ I0: 2, theta: Math.PI / 6 }).ok).toBe(true)
  })
})
