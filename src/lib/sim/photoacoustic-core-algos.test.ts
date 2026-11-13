import { describe, it, expect } from 'vitest'
import {
  METHOD_PA,
  METHOD_ALGO_PA_PRESSURE,
  PA_PARENT,
  PA_METHOD_IDS,
  paPressure,
  runPaPressureSample,
} from './photoacoustic-core-algos'

describe('Photoacoustic core · p0 = Γ μ_a F', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_PA).toBe('method-photoacoustic')
    expect(METHOD_ALGO_PA_PRESSURE).toBe('method-algo-pa-pressure')
    expect(PA_PARENT).toBe(METHOD_PA)
    expect(PA_METHOD_IDS).toContain(METHOD_ALGO_PA_PRESSURE)
  })

  it('paPressure: p0 = Γ · μ_a · F', () => {
    expect(paPressure(0.2, 100, 20)).toBeCloseTo(400, 12)
    expect(paPressure(1, 1, 1)).toBe(1)
    expect(paPressure(0.5, 50, 0)).toBe(0)
  })

  it('paPressure: linear in Γ, μ_a, F', () => {
    const base = paPressure(0.15, 80, 10)
    expect(paPressure(0.3, 80, 10)).toBeCloseTo(2 * base, 12)
    expect(paPressure(0.15, 160, 10)).toBeCloseTo(2 * base, 12)
    expect(paPressure(0.15, 80, 20)).toBeCloseTo(2 * base, 12)
  })

  it('paPressure: non-finite → NaN', () => {
    expect(Number.isNaN(paPressure(NaN, 1, 1))).toBe(true)
    expect(Number.isNaN(paPressure(1, Infinity, 1))).toBe(true)
    expect(Number.isNaN(paPressure(1, 1, -Infinity))).toBe(true)
  })

  it('runPaPressureSample: ok, methodId/familyId, linear checks', () => {
    const r = runPaPressureSample()
    expect(r.methodId).toBe(METHOD_ALGO_PA_PRESSURE)
    expect(r.familyId).toBe(METHOD_PA)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.p0).toBeCloseTo(r.Gamma * r.mua * r.F, 12)
    expect(r.p0).toBeCloseTo(400, 12)
    expect(r.p0_doubleGamma).toBeCloseTo(2 * r.p0, 12)
    expect(r.p0_doubleMua).toBeCloseTo(2 * r.p0, 12)
    expect(r.p0_doubleF).toBeCloseTo(2 * r.p0, 12)
    expect(r.p0_zeroF).toBe(0)
  })

  it('custom params still ok', () => {
    const r = runPaPressureSample({ Gamma: 0.12, mua: 200, F: 5 })
    expect(r.ok).toBe(true)
    expect(r.p0).toBeCloseTo(120, 12)
  })
})
