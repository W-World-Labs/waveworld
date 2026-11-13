import { describe, it, expect } from 'vitest'
import {
  METHOD_SHOT,
  METHOD_ALGO_SHOT_IRMS,
  SHOT_PARENT,
  SHOT_METHOD_IDS,
  Q_E,
  DEFAULT_I,
  DEFAULT_DELTA_F,
  shotIrms,
  runShotIrmsSample,
} from './shot-noise-algos'

describe('Shot noise · I_rms = √(2 q I Δf)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SHOT).toBe('method-shot-noise')
    expect(METHOD_ALGO_SHOT_IRMS).toBe('method-algo-shot-irms')
    expect(SHOT_PARENT).toBe(METHOD_SHOT)
    expect(SHOT_METHOD_IDS).toContain(METHOD_ALGO_SHOT_IRMS)
    expect(Q_E).toBe(1.602e-19)
  })

  it('shotIrms: formula', () => {
    const I = DEFAULT_I
    const df = DEFAULT_DELTA_F
    const Irms = shotIrms(I, df)
    expect(Irms).toBeCloseTo(Math.sqrt(2 * Q_E * I * df), 18)
    expect(Irms).toBeGreaterThan(0)
  })

  it('∝ √I, √Δf; I=0 ⇒ 0; illegal → NaN', () => {
    const Irms = shotIrms(DEFAULT_I, DEFAULT_DELTA_F)
    expect(shotIrms(2 * DEFAULT_I, DEFAULT_DELTA_F)).toBeCloseTo(
      Irms * Math.SQRT2,
      12,
    )
    expect(shotIrms(DEFAULT_I, 2 * DEFAULT_DELTA_F)).toBeCloseTo(
      Irms * Math.SQRT2,
      12,
    )
    expect(shotIrms(0, DEFAULT_DELTA_F)).toBe(0)
    expect(Number.isNaN(shotIrms(-1, 1))).toBe(true)
    expect(Number.isNaN(shotIrms(1, -1))).toBe(true)
    expect(Number.isNaN(shotIrms(NaN, 1))).toBe(true)
  })

  it('runShotIrmsSample: ok, formula, sqrt scalings', () => {
    const r = runShotIrmsSample()
    expect(r.methodId).toBe(METHOD_ALGO_SHOT_IRMS)
    expect(r.familyId).toBe(METHOD_SHOT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.q).toBe(Q_E)
    expect(r.Irms).toBeCloseTo(Math.sqrt(2 * r.q * r.I * r.deltaF), 18)
    expect(r.Irms_doubleI).toBeCloseTo(r.Irms * Math.SQRT2, 12)
    expect(r.Irms_doubleF).toBeCloseTo(r.Irms * Math.SQRT2, 12)
    expect(r.Irms_zeroI).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runShotIrmsSample({ I: 1e-6, deltaF: 1e4 }).ok).toBe(true)
  })
})
