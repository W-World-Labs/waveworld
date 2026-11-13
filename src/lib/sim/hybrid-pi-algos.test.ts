import { describe, it, expect } from 'vitest'
import {
  METHOD_HYBRID_PI,
  METHOD_ALGO_GM,
  HYBRID_PI_PARENT,
  HYBRID_PI_METHOD_IDS,
  VT_ROOM,
  DEFAULT_IC,
  DEFAULT_VT,
  transconductanceGm,
  thermalVoltage,
  runGmSample,
} from './hybrid-pi-algos'

describe('Hybrid-π · gm = Ic / VT', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_HYBRID_PI).toBe('method-hybrid-pi')
    expect(METHOD_ALGO_GM).toBe('method-algo-gm')
    expect(HYBRID_PI_PARENT).toBe(METHOD_HYBRID_PI)
    expect(HYBRID_PI_METHOD_IDS).toContain(METHOD_ALGO_GM)
  })

  it('transconductanceGm: formula', () => {
    expect(transconductanceGm(1e-3, 0.026)).toBeCloseTo(1e-3 / 0.026, 12)
    expect(transconductanceGm(DEFAULT_IC, DEFAULT_VT)).toBeCloseTo(
      DEFAULT_IC / DEFAULT_VT,
      12,
    )
    expect(VT_ROOM).toBeCloseTo(0.026, 12)
  })

  it('∝ Ic; ∝ 1/VT; VT≤0 / non-finite → NaN', () => {
    const gm = transconductanceGm(1e-3, 0.026)
    expect(transconductanceGm(2e-3, 0.026)).toBeCloseTo(2 * gm, 12)
    expect(transconductanceGm(1e-3, 0.013)).toBeCloseTo(2 * gm, 12)
    expect(Number.isNaN(transconductanceGm(1e-3, 0))).toBe(true)
    expect(Number.isNaN(transconductanceGm(1e-3, -0.026))).toBe(true)
    expect(Number.isNaN(transconductanceGm(NaN, 0.026))).toBe(true)
  })

  it('thermalVoltage: kT/q ~ 26 mV at 300 K', () => {
    expect(thermalVoltage(300)).toBeGreaterThan(0.025)
    expect(thermalVoltage(300)).toBeLessThan(0.027)
    expect(Number.isNaN(thermalVoltage(0))).toBe(true)
    expect(Number.isNaN(thermalVoltage(-10))).toBe(true)
  })

  it('runGmSample: ok, formula, linear Ic', () => {
    const r = runGmSample()
    expect(r.methodId).toBe(METHOD_ALGO_GM)
    expect(r.familyId).toBe(METHOD_HYBRID_PI)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.gm).toBeCloseTo(r.Ic / r.VT, 12)
    expect(r.gm_doubleIc).toBeCloseTo(2 * r.gm, 12)
    expect(r.gm_halfVT).toBeCloseTo(2 * r.gm, 12)
    expect(Number.isFinite(r.gm_badVT)).toBe(false)
    expect(r.VT_fromT).toBeGreaterThan(0.025)
  })

  it('custom params still ok', () => {
    expect(runGmSample({ Ic: 5e-3, VT: 0.02585 }).ok).toBe(true)
  })
})
