import { describe, it, expect } from 'vitest'
import {
  METHOD_EQUIP,
  METHOD_ALGO_EQUIP_E,
  METHOD_MORSE,
  METHOD_ALGO_MORSE_V,
  EQUIP_PARENT,
  MORSE_PARENT,
  EQUIP_METHOD_IDS,
  MORSE_METHOD_IDS,
  EQUIPARTITION_MORSE_METHOD_IDS,
  KB,
  DEFAULT_F,
  DEFAULT_T,
  DEFAULT_DE,
  DEFAULT_A,
  DEFAULT_RE,
  equipartitionEnergy,
  morsePotential,
  runEquipESample,
  runMorseVSample,
} from './equipartition-morse-algos'

describe('Equipartition + Morse · E = ½ f k T; V = De(1−e^{−a(r−re)})²', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_EQUIP).toBe('method-equipartition')
    expect(METHOD_ALGO_EQUIP_E).toBe('method-algo-equipartition-e')
    expect(METHOD_MORSE).toBe('method-morse-potential')
    expect(METHOD_ALGO_MORSE_V).toBe('method-algo-morse-v')
    expect(EQUIP_PARENT).toBe(METHOD_EQUIP)
    expect(MORSE_PARENT).toBe(METHOD_MORSE)
    expect(EQUIP_METHOD_IDS).toContain(METHOD_ALGO_EQUIP_E)
    expect(MORSE_METHOD_IDS).toContain(METHOD_ALGO_MORSE_V)
    expect(EQUIPARTITION_MORSE_METHOD_IDS).toContain(METHOD_ALGO_EQUIP_E)
    expect(EQUIPARTITION_MORSE_METHOD_IDS).toContain(METHOD_ALGO_MORSE_V)
  })

  describe('equipartitionEnergy', () => {
    it('E = ½ f k T', () => {
      expect(equipartitionEnergy(DEFAULT_F, DEFAULT_T)).toBeCloseTo(
        0.5 * DEFAULT_F * KB * DEFAULT_T,
        20,
      )
      expect(equipartitionEnergy(2, 0)).toBe(0)
    })

    it('∝ f and T; bad → NaN', () => {
      const E = equipartitionEnergy(3, 300)
      expect(equipartitionEnergy(6, 300)).toBeCloseTo(2 * E, 20)
      expect(equipartitionEnergy(3, 600)).toBeCloseTo(2 * E, 20)
      expect(Number.isNaN(equipartitionEnergy(-1, 300))).toBe(true)
      expect(Number.isNaN(equipartitionEnergy(3, -10))).toBe(true)
    })

    it('runEquipESample: ok, methodId/familyId', () => {
      const r = runEquipESample()
      expect(r.methodId).toBe(METHOD_ALGO_EQUIP_E)
      expect(r.familyId).toBe(METHOD_EQUIP)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.E).toBeCloseTo(0.5 * r.f * r.k * r.T, 20)
      expect(r.E_doubleF).toBeCloseTo(2 * r.E, 20)
      expect(r.E_zero).toBe(0)
    })
  })

  describe('morsePotential', () => {
    it('V(re)=0; formula', () => {
      expect(morsePotential(DEFAULT_RE, DEFAULT_DE, DEFAULT_A, DEFAULT_RE)).toBeCloseTo(
        0,
        20,
      )
      const r = DEFAULT_RE + 1e-11
      const x = 1 - Math.exp(-DEFAULT_A * (r - DEFAULT_RE))
      expect(morsePotential(r, DEFAULT_DE, DEFAULT_A, DEFAULT_RE)).toBeCloseTo(
        DEFAULT_DE * x * x,
        12,
      )
    })

    it('asymptote → De; De<0 → NaN', () => {
      const Vfar = morsePotential(1e-8, 1e-18, 2e10, 1e-10)
      expect(Vfar / 1e-18).toBeCloseTo(1, 4)
      expect(Number.isNaN(morsePotential(1e-10, -1, 1e10, 1e-10))).toBe(true)
      expect(Number.isNaN(morsePotential(NaN, 1, 1, 1))).toBe(true)
    })

    it('runMorseVSample: ok, methodId/familyId', () => {
      const r = runMorseVSample()
      expect(r.methodId).toBe(METHOD_ALGO_MORSE_V)
      expect(r.familyId).toBe(METHOD_MORSE)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.V_eq).toBeCloseTo(0, 12)
      expect(r.V_far / r.De).toBeCloseTo(1, 5)
      expect(r.V).toBeGreaterThanOrEqual(0)
    })
  })
})
