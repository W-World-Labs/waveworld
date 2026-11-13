import { describe, it, expect } from 'vitest'
import {
  METHOD_PIEZO,
  METHOD_ALGO_PIEZO_DIRECT,
  METHOD_ALGO_PIEZO_CONVERSE,
  PIEZO_METHOD_IDS,
  piezoDirectCharge,
  piezoDirectVoltage,
  piezoConverseStrain,
  piezoConverseDisplacement,
  runPiezoDirectSample,
  runPiezoConverseSample,
} from './piezo-algos'

describe('压电 · 正/逆效应教学 stub', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_PIEZO).toBe('method-piezo')
    expect(METHOD_ALGO_PIEZO_DIRECT).toBe('method-algo-piezo-direct')
    expect(METHOD_ALGO_PIEZO_CONVERSE).toBe('method-algo-piezo-converse')
    expect(PIEZO_METHOD_IDS).toContain(METHOD_ALGO_PIEZO_DIRECT)
    expect(PIEZO_METHOD_IDS).toContain(METHOD_ALGO_PIEZO_CONVERSE)
  })

  describe('direct piezo', () => {
    it('Q = d · F；V = Q/C', () => {
      const d = 200e-12
      const F = 5
      const C = 2e-9
      expect(piezoDirectCharge(d, F)).toBeCloseTo(d * F, 18)
      expect(piezoDirectVoltage(d, F, C)).toBeCloseTo((d * F) / C, 12)
    })

    it('对 F 线性；F=0 → Q=0', () => {
      const d = 1e-10
      expect(piezoDirectCharge(d, 4)).toBeCloseTo(2 * piezoDirectCharge(d, 2), 18)
      expect(piezoDirectCharge(d, 0)).toBe(0)
    })

    it('C≤0 → NaN', () => {
      expect(Number.isNaN(piezoDirectVoltage(1e-10, 1, 0))).toBe(true)
      expect(Number.isNaN(piezoDirectVoltage(1e-10, 1, -1))).toBe(true)
    })
  })

  describe('converse piezo', () => {
    it('S = d · E；ΔL = d · V', () => {
      const d = 300e-12
      expect(piezoConverseStrain(d, 1e6)).toBeCloseTo(d * 1e6, 18)
      expect(piezoConverseDisplacement(d, 50)).toBeCloseTo(d * 50, 18)
    })

    it('对 E 线性', () => {
      const d = 1e-10
      expect(piezoConverseStrain(d, 200)).toBeCloseTo(2 * piezoConverseStrain(d, 100), 18)
    })
  })

  describe('样例入口', () => {
    it('runPiezoDirectSample：ok 且 methodId/familyId 对齐', () => {
      const r = runPiezoDirectSample()
      expect(r.methodId).toBe(METHOD_ALGO_PIEZO_DIRECT)
      expect(r.familyId).toBe(METHOD_PIEZO)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.Q).toBeCloseTo(r.d * r.force, 18)
      expect(r.V).toBeCloseTo(r.Q / r.capacitance, 10)
      expect(r.Q_doubleF).toBeCloseTo(2 * r.Q, 18)
      expect(r.Q_zero).toBe(0)
    })

    it('runPiezoConverseSample：ok 且线性', () => {
      const r = runPiezoConverseSample()
      expect(r.methodId).toBe(METHOD_ALGO_PIEZO_CONVERSE)
      expect(r.familyId).toBe(METHOD_PIEZO)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.strain).toBeCloseTo(r.d * r.electricField, 18)
      expect(r.displacement).toBeCloseTo(r.d * r.voltage, 18)
      expect(r.strain_doubleE).toBeCloseTo(2 * r.strain, 18)
    })
  })
})
