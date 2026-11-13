import { describe, it, expect } from 'vitest'
import {
  METHOD_DEBYE,
  METHOD_ALGO_DEBYE_L,
  METHOD_PLASMA,
  METHOD_ALGO_PLASMA_W,
  DEBYE_PARENT,
  PLASMA_PARENT,
  DEBYE_METHOD_IDS,
  PLASMA_METHOD_IDS,
  EPS0,
  KB,
  E_CHARGE,
  M_E,
  DEFAULT_N,
  DEFAULT_T,
  debyeLength,
  plasmaOmega,
  runDebyeLengthSample,
  runPlasmaOmegaSample,
} from './debye-plasma-algos'

describe('Debye · λ_D = √(ε0 kT / (n e²))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_DEBYE).toBe('method-debye-length')
    expect(METHOD_ALGO_DEBYE_L).toBe('method-algo-debye-length')
    expect(DEBYE_PARENT).toBe(METHOD_DEBYE)
    expect(DEBYE_METHOD_IDS).toContain(METHOD_ALGO_DEBYE_L)
  })

  it('debyeLength: formula', () => {
    const n = DEFAULT_N
    const T = DEFAULT_T
    const ld = debyeLength(n, T)
    expect(ld).toBeCloseTo(
      Math.sqrt((EPS0 * KB * T) / (n * E_CHARGE * E_CHARGE)),
      12,
    )
    expect(ld).toBeGreaterThan(0)
  })

  it('∝ √T, 1/√n; n=0 → NaN', () => {
    const ld = debyeLength(1e16, 1e4)
    expect(debyeLength(1e16, 2e4)).toBeCloseTo(ld * Math.SQRT2, 12)
    expect(debyeLength(2e16, 1e4)).toBeCloseTo(ld / Math.SQRT2, 12)
    expect(Number.isNaN(debyeLength(0, 1e4))).toBe(true)
    expect(Number.isNaN(debyeLength(NaN, 1e4))).toBe(true)
  })

  it('runDebyeLengthSample: ok, formula, scalings', () => {
    const r = runDebyeLengthSample()
    expect(r.methodId).toBe(METHOD_ALGO_DEBYE_L)
    expect(r.familyId).toBe(METHOD_DEBYE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.lambdaD_doubleT).toBeCloseTo(r.lambdaD * Math.SQRT2, 12)
    expect(r.lambdaD_doubleN).toBeCloseTo(r.lambdaD / Math.SQRT2, 12)
    expect(Number.isFinite(r.lambdaD_badN)).toBe(false)
  })
})

describe('Plasma · ω_p = √(n e² / (ε0 m_e))', () => {
  it('method id constants', () => {
    expect(METHOD_PLASMA).toBe('method-plasma-frequency')
    expect(METHOD_ALGO_PLASMA_W).toBe('method-algo-plasma-omega')
    expect(PLASMA_PARENT).toBe(METHOD_PLASMA)
    expect(PLASMA_METHOD_IDS).toContain(METHOD_ALGO_PLASMA_W)
  })

  it('plasmaOmega: formula', () => {
    const n = DEFAULT_N
    const wp = plasmaOmega(n)
    expect(wp).toBeCloseTo(
      Math.sqrt((n * E_CHARGE * E_CHARGE) / (EPS0 * M_E)),
      6,
    )
  })

  it('∝ √n; n=0 ⇒ 0', () => {
    const wp = plasmaOmega(1e16)
    expect(plasmaOmega(2e16)).toBeCloseTo(wp * Math.SQRT2, 12)
    expect(plasmaOmega(0)).toBe(0)
  })

  it('runPlasmaOmegaSample: ok, formula, sqrt n', () => {
    const r = runPlasmaOmegaSample()
    expect(r.methodId).toBe(METHOD_ALGO_PLASMA_W)
    expect(r.familyId).toBe(METHOD_PLASMA)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.omegaP_doubleN).toBeCloseTo(r.omegaP * Math.SQRT2, 12)
    expect(r.omegaP_zeroN).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runDebyeLengthSample({ n: 1e18, T: 1e5 }).ok).toBe(true)
    expect(runPlasmaOmegaSample({ n: 1e18 }).ok).toBe(true)
  })
})
