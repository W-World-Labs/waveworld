import { describe, it, expect } from 'vitest'
import {
  METHOD_GOOS_HANCHEN,
  METHOD_ALGO_GOOS_HANCHEN_D,
  GOOS_HANCHEN_PARENT,
  GOOS_HANCHEN_METHOD_IDS,
  DEFAULT_LAMBDA,
  DEFAULT_THETA,
  DEFAULT_N1,
  DEFAULT_N2,
  goosHanchenDelta,
  runGoosHanchenSample,
} from './goos-hanchen-algos'

describe('Goos–Hänchen · lateral TIR shift', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_GOOS_HANCHEN).toBe('method-goos-hanchen')
    expect(METHOD_ALGO_GOOS_HANCHEN_D).toBe('method-algo-goos-hanchen-d')
    expect(GOOS_HANCHEN_PARENT).toBe(METHOD_GOOS_HANCHEN)
    expect(GOOS_HANCHEN_METHOD_IDS).toContain(METHOD_ALGO_GOOS_HANCHEN_D)
  })

  it('goosHanchenDelta: formula under TIR', () => {
    const lambda = DEFAULT_LAMBDA
    const theta = DEFAULT_THETA
    const n1 = DEFAULT_N1
    const n2 = DEFAULT_N2
    const s = Math.sin(theta)
    const c = Math.cos(theta)
    const inside = s * s - (n2 / n1) ** 2
    const expected = (lambda / (2 * Math.PI)) * (c / Math.sqrt(inside))
    expect(goosHanchenDelta(lambda, theta, n1, n2)).toBeCloseTo(expected, 12)
    expect(goosHanchenDelta(lambda, theta, n1, n2)).toBeGreaterThan(0)
  })

  it('∝ λ; below critical → NaN; bad → NaN', () => {
    const d = goosHanchenDelta(
      DEFAULT_LAMBDA,
      DEFAULT_THETA,
      DEFAULT_N1,
      DEFAULT_N2,
    )
    expect(
      goosHanchenDelta(2 * DEFAULT_LAMBDA, DEFAULT_THETA, DEFAULT_N1, DEFAULT_N2),
    ).toBeCloseTo(2 * d, 12)
    const thetaCrit = Math.asin(DEFAULT_N2 / DEFAULT_N1)
    expect(
      Number.isNaN(
        goosHanchenDelta(DEFAULT_LAMBDA, thetaCrit * 0.5, DEFAULT_N1, DEFAULT_N2),
      ),
    ).toBe(true)
    expect(Number.isNaN(goosHanchenDelta(0, DEFAULT_THETA, 1.5, 1))).toBe(true)
    expect(Number.isNaN(goosHanchenDelta(NaN, DEFAULT_THETA, 1.5, 1))).toBe(true)
  })

  it('runGoosHanchenSample: ok, ∝λ, below-crit illegal', () => {
    const r = runGoosHanchenSample()
    expect(r.methodId).toBe(METHOD_ALGO_GOOS_HANCHEN_D)
    expect(r.familyId).toBe(METHOD_GOOS_HANCHEN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.delta_doubleL).toBeCloseTo(2 * r.delta, 10)
    expect(Number.isFinite(r.delta_belowCrit)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runGoosHanchenSample({
        theta: (60 * Math.PI) / 180,
        n1: 1.5,
        n2: 1,
      }).ok,
    ).toBe(true)
  })
})
