import { describe, expect, it } from 'vitest'
import {
  computeNodeEnergyBudget,
  harvestCoversLoad,
  runNodeDutyBudgetSample,
  METHOD_NODE_BUDGET,
  METHOD_ALGO_NODE_DUTY,
} from './nodeEnergyBudget'

describe('nodeEnergyBudget · duty-cycle ULP node', () => {
  it('method ids', () => {
    expect(METHOD_NODE_BUDGET).toBe('method-node-energy-budget')
    expect(METHOD_ALGO_NODE_DUTY).toBe('method-algo-node-duty-budget')
  })

  it('representative ULP inputs → finite µW-class average power', () => {
    // 2 µA sleep, 5 mA active 50 ms every 60 s @ 3 V
    const r = computeNodeEnergyBudget({
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
      harvestPowerW: 0,
    })
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.dutyCycle).toBeCloseTo(0.05 / 60, 10)
    // Hand: E = 3*(2e-6*59.95 + 5e-3*0.05) = 3*(1.199e-4 + 2.5e-4) = 1.1097e-3 J
    // P = E/60 ≈ 1.85e-5 W ≈ 18.5 µW
    expect(r.avgPowerW).toBeGreaterThan(1e-5)
    expect(r.avgPowerW).toBeLessThan(5e-5)
    expect(r.avgCurrentA).toBeCloseTo(r.avgPowerW / 3, 12)
    expect(Number.isFinite(r.lifetimeS)).toBe(true)
    expect(r.lifetimeS).toBeGreaterThan(0)
  })

  it('higher sleep current → higher avg power and shorter life', () => {
    const base = {
      sleepCurrentA: 1e-6,
      activeCurrentA: 2e-3,
      activeTimeS: 0.1,
      periodS: 30,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.1,
    }
    const a = computeNodeEnergyBudget(base)
    const b = computeNodeEnergyBudget({ ...base, sleepCurrentA: 5e-6 })
    expect(b.avgPowerW).toBeGreaterThan(a.avgPowerW)
    expect(b.lifetimeS).toBeLessThan(a.lifetimeS)
  })

  it('harvest covering drain → infinite lifetime and zero required capacity', () => {
    const r0 = computeNodeEnergyBudget({
      sleepCurrentA: 10e-6,
      activeCurrentA: 1e-3,
      activeTimeS: 0.02,
      periodS: 10,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.05,
      harvestPowerW: 0,
    })
    expect(r0.harvestCoversLoad).toBe(false)
    expect(harvestCoversLoad(r0)).toBe(false)
    const r1 = computeNodeEnergyBudget({
      sleepCurrentA: 10e-6,
      activeCurrentA: 1e-3,
      activeTimeS: 0.02,
      periodS: 10,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.05,
      harvestPowerW: r0.avgPowerW * 1.2,
      targetLifetimeS: 1e8,
    })
    expect(r1.netPowerW).toBeLessThan(0)
    expect(r1.harvestCoversLoad).toBe(true)
    expect(harvestCoversLoad(r1)).toBe(true)
    expect(r1.lifetimeS).toBe(Infinity)
    expect(r1.requiredCapacityAh).toBe(0)
  })

  it('self-power shortfall: harvest below load → finite life and positive required capacity', () => {
    const r = computeNodeEnergyBudget({
      sleepCurrentA: 5e-6,
      activeCurrentA: 8e-3,
      activeTimeS: 0.1,
      periodS: 30,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.1,
      harvestPowerW: 5e-6, // 5 µW micro-harvest, below load
      targetLifetimeS: 365.25 * 24 * 3600,
    })
    expect(r.ok).toBe(true)
    expect(r.avgPowerW).toBeGreaterThan(r.harvestPowerW)
    expect(r.harvestCoversLoad).toBe(false)
    expect(r.netPowerW).toBeGreaterThan(0)
    expect(Number.isFinite(r.lifetimeS)).toBe(true)
    expect(r.lifetimeS).toBeGreaterThan(0)
    expect(r.requiredCapacityAh).toBeGreaterThan(0)
  })

  it('required capacity grows with target lifetime when draining', () => {
    const base = {
      sleepCurrentA: 5e-6,
      activeCurrentA: 3e-3,
      activeTimeS: 0.05,
      periodS: 20,
      supplyVoltageV: 3,
      harvestPowerW: 0,
    }
    const short = computeNodeEnergyBudget({ ...base, targetLifetimeS: 365 * 24 * 3600 })
    const long = computeNodeEnergyBudget({ ...base, targetLifetimeS: 10 * 365 * 24 * 3600 })
    expect(long.requiredCapacityAh).toBeGreaterThan(short.requiredCapacityAh)
    expect(short.requiredCapacityAh).toBeGreaterThan(0)
  })

  it('extraContinuousLoadW increases drain and shortens life (no clamp)', () => {
    const base = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
      harvestPowerW: 10e-6,
      targetLifetimeS: 10 * 365.25 * 24 * 3600,
    }
    const a = computeNodeEnergyBudget(base)
    const b = computeNodeEnergyBudget({ ...base, extraContinuousLoadW: 50e-6 })
    expect(b.totalLoadPowerW).toBeCloseTo(a.avgPowerW + 50e-6, 12)
    expect(b.netPowerW).toBeCloseTo(a.netPowerW + 50e-6, 12)
    expect(b.lifetimeS).toBeLessThan(a.lifetimeS)
    expect(b.requiredCapacityAh!).toBeGreaterThan(a.requiredCapacityAh!)
  })

  it('invalid inputs → not ok / NaN', () => {
    expect(computeNodeEnergyBudget({
      sleepCurrentA: 1e-6,
      activeCurrentA: 1e-3,
      activeTimeS: 10,
      periodS: 5, // active > period
      supplyVoltageV: 3,
    }).ok).toBe(false)
    expect(computeNodeEnergyBudget({
      sleepCurrentA: -1,
      activeCurrentA: 1e-3,
      activeTimeS: 0.01,
      periodS: 1,
      supplyVoltageV: 3,
    }).finite).toBe(false)
  })

  it('runNodeDutyBudgetSample ok', () => {
    const s = runNodeDutyBudgetSample()
    expect(s.methodId).toBe(METHOD_ALGO_NODE_DUTY)
    expect(s.familyId).toBe(METHOD_NODE_BUDGET)
    expect(s.ok).toBe(true)
    expect(s.monoOk).toBe(true)
    expect(s.coverOk).toBe(true)
    expect(s.result.avgPowerW).toBeGreaterThan(0)
  })
})
