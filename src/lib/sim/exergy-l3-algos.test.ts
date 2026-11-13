import { describe, it, expect } from 'vitest'
import {
  EXERGY_L3_PARENT,
  METHOD_ALGO_EXERGY_EFFICIENCY,
  T0,
  carnotEfficiency,
  exergyEfficiency,
  heatEngineExergyEfficiency,
  inputExergy,
  runExergyEfficiencySample,
  thermalExergyFactor,
} from './exergy-l3-algos'
import { methodById } from '../../data/methods/methods'

describe('㶲分析 L3 · 㶲效率 W/Ex_in', () => {
  it('方法 id 对齐 exergy catalog', () => {
    expect(EXERGY_L3_PARENT).toBe('method-exergy-analysis')
    expect(METHOD_ALGO_EXERGY_EFFICIENCY).toBe('method-algo-exergy-efficiency')
    expect(methodById(EXERGY_L3_PARENT)).toBeDefined()
    expect(methodById(METHOD_ALGO_EXERGY_EFFICIENCY)?.parentId).toBe(
      EXERGY_L3_PARENT,
    )
  })

  it('Ex_in = φ · E_in；η_ex = W/Ex_in', () => {
    const phi = thermalExergyFactor(600)
    const Ex = inputExergy(1000, phi)
    expect(Ex).toBeCloseTo(phi * 1000, 12)
    expect(exergyEfficiency(200, Ex)).toBeCloseTo(200 / Ex, 12)
    expect(exergyEfficiency(10, 0)).toBe(0)
  })

  it('可逆卡诺 η_ex=1；不可逆 η_ex<1 且 =η/φ', () => {
    const Q = 1000
    const Th = 600
    const phi = thermalExergyFactor(Th)
    const etaC = carnotEfficiency(Th, T0)
    const rev = heatEngineExergyEfficiency(Q, Th, etaC)
    expect(rev.etaExergy).toBeCloseTo(1, 12)
    expect(rev.secondLawOk).toBe(true)

    const eta = 0.35 * etaC
    const irr = heatEngineExergyEfficiency(Q, Th, eta)
    expect(irr.etaExergy).toBeLessThan(1)
    expect(irr.etaExergy).toBeCloseTo(eta / phi, 10)
    expect(irr.etaExergy).toBeGreaterThan(irr.etaEnergy)
  })

  it('runExergyEfficiencySample：可逆=1、第二定律、W/Ex_in', () => {
    const r = runExergyEfficiencySample()
    expect(r.methodId).toBe(METHOD_ALGO_EXERGY_EFFICIENCY)
    expect(r.familyId).toBe(EXERGY_L3_PARENT)
    expect(r.reversibleOk).toBe(true)
    expect(r.secondLawOk).toBe(true)
    expect(r.etaExRev).toBeCloseTo(1, 12)
    expect(r.etaExIrr).toBeLessThan(1)
    expect(r.etaExIrr).toBeCloseTo(r.W_irr / r.Ex_in, 12)
    expect(r.ratioExOverEnergy).toBeCloseTo(1 / r.phi, 8)
  })
})
