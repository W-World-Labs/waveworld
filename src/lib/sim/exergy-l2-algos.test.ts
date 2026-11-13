import { describe, it, expect } from 'vitest'
import {
  EXERGY_L2_PARENT,
  METHOD_ALGO_EXERGY_LOST_WORK,
  T0,
  carnotEfficiency,
  carnotMatchesThermalFactor,
  gouyStodolaLostWork,
  heatEngineEntropyGen,
  pathExergy,
  runExergyLostWorkSample,
  thermalExergyFactor,
} from './exergy-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('㶲分析 L2 · 卡诺 / Gouy–Stodola 损失功', () => {
  it('方法 id 对齐 catalog 父族（lost-work 为未入库新 id）', () => {
    expect(EXERGY_L2_PARENT).toBe('method-exergy-analysis')
    expect(METHOD_ALGO_EXERGY_LOST_WORK).toBe('method-algo-exergy-lost-work')
    expect(methodById(EXERGY_L2_PARENT)).toBeDefined()
  })

  it('卡诺效率随热源 T 升高，且 = thermalExergyFactor', () => {
    expect(carnotEfficiency(T0)).toBe(0)
    expect(carnotEfficiency(2 * T0)).toBeCloseTo(0.5, 12)
    expect(carnotEfficiency(900)).toBeGreaterThan(carnotEfficiency(600))
    expect(carnotMatchesThermalFactor(600)).toBe(true)
    expect(carnotEfficiency(600)).toBeCloseTo(thermalExergyFactor(600), 12)
  })

  it('Gouy–Stodola：W_lost = T₀ · S_gen', () => {
    const S = 2.5
    expect(gouyStodolaLostWork(S)).toBeCloseTo(T0 * S, 12)
    expect(gouyStodolaLostWork(0)).toBe(0)
  })

  it('不可逆热机有损失功；可逆极限 W_lost→0', () => {
    const Q = 1000
    const Th = 600
    const etaC = carnotEfficiency(Th)
    const irr = heatEngineEntropyGen(Q, Th, 0.4 * etaC)
    expect(irr.W_lost).toBeGreaterThan(0)
    expect(irr.S_gen).toBeGreaterThan(0)
    expect(irr.W_lost).toBeCloseTo(T0 * irr.S_gen, 10)

    const rev = heatEngineEntropyGen(Q, Th, etaC)
    expect(rev.W_lost).toBeCloseTo(0, 10)
    expect(rev.S_gen).toBeCloseTo(0, 10)
  })

  it('pathExergy 热→功路径可用', () => {
    const pe = pathExergy([{ eff: 0.3, from: 'thermal', to: 'mechanical' }], (id) => id)
    expect(pe.energyEff).toBeCloseTo(0.3, 12)
    expect(pe.usableWorkOut).toBeGreaterThan(0)
  })

  it('runExergyLostWorkSample：卡诺单调、Gouy 恒等式、可逆零损失', () => {
    const r = runExergyLostWorkSample()
    expect(r.methodId).toBe(METHOD_ALGO_EXERGY_LOST_WORK)
    expect(r.familyId).toBe(EXERGY_L2_PARENT)
    expect(r.carnotMonotone).toBe(true)
    expect(r.matchesPhi).toBe(true)
    expect(r.etaCarnot).toBeCloseTo(r.phi, 12)
    expect(r.W_lost).toBeGreaterThan(0)
    expect(r.gouyResidual).toBeLessThan(1e-9)
    expect(r.W_lost_rev).toBeCloseTo(0, 10)
    expect(r.pathEnergyEff).toBeGreaterThan(0)
    expect(r.pathEnergyEff).toBeLessThanOrEqual(1)
  })
})
