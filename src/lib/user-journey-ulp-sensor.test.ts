/**
 * Persona: engineer researching edge-computing self-powered devices.
 * Drives shipped APIs — self-power harvest rank, node budget cover, RF, pathway discovery.
 */
import { describe, expect, it } from 'vitest'
import {
  ENERGY_FORMS,
  bestConversionMethods,
  sensorsFor,
  sensorsForSelfPower,
  methodTransducerScale,
} from './applications'
import { methodsForSimPath } from '../data/methods/methods'
import { computeNodeEnergyBudget, harvestCoversLoad } from './nodeEnergyBudget'
import { computeEdgeSelfPowerChain } from './edgeSelfPowerChain'
import {
  landauerBitRatePowerFloor,
  minAmbientForSelfPower,
  composeTegSelfPower,
  composeBetzSelfPower,
  sParamPowerBound,
  edgeInferenceEdp,
} from './research2026Calcs'
import { BETZ_MAX } from './physics/limits'
import { runSmithChartSample } from './sim/smith-chart'
import { runReflectionGammaSample } from './sim/impedance-match-algos'
import { ALL_LEAVES } from '../nav'
import { PAGE_HEADERS } from './i18n/pageHeaders'

describe('USER JOURNEY · edge self-powered device research', () => {
  it('walks harvest → budget cover → RF on real shipped APIs', () => {
    const usefulPaths = [
      'sensing',
      'node-budget',
      'transducers',
      'apps',
      'matrix',
      'paths',
      'methods',
      'smith',
      'converter',
    ]
    const leaves = new Set(ALL_LEAVES.map((l) => l.path))
    for (const p of usefulPaths) {
      expect(leaves.has(p), `leaf /${p}`).toBe(true)
    }
    expect(PAGE_HEADERS.sensing?.titleEn).toBeTruthy()
    expect(PAGE_HEADERS['node-budget']?.titleEn).toMatch(/budget|duty/i)
    expect(PAGE_HEADERS.sensing?.subtitleEn ?? '').toMatch(/self-power|harvester|budget/i)
    expect(ENERGY_FORMS.length).toBeGreaterThan(5)

    // R1: self-power harvest — harvester-scale, not plant-only tops
    const selfMech = sensorsForSelfPower('mechanical', { k: 5 })
    expect(selfMech.length).toBeGreaterThan(0)
    expect(selfMech.some((m) => methodTransducerScale(m) === 'transducer')).toBe(true)
    expect(methodTransducerScale(selfMech[0]!)).not.toBe('plant')
    for (const m of selfMech) {
      expect(methodTransducerScale(m)).not.toBe('plant')
    }

    const selfThermal = sensorsForSelfPower('thermal', { k: 5 })
    expect(selfThermal.length).toBeGreaterThan(0)

    // Measure still demotes plant
    const meas = sensorsFor('mechanical', { intent: 'measure', practicalOnly: true, k: 5 })
    for (const m of meas) {
      expect(methodTransducerScale(m)).not.toBe('plant')
    }

    // R2: composed chain — ambient×η → load cover / shortfall + RF tax
    const nodeBase = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
      targetLifetimeS: 10 * 365.25 * 24 * 3600,
    }
    const shortfall = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 20e-6, eta: 0.2 },
      node: nodeBase,
    })
    expect(shortfall.ok).toBe(true)
    expect(shortfall.avgLoadPowerW).toBeGreaterThan(0)
    expect(shortfall.harvestCoversLoad).toBe(false)
    expect(harvestCoversLoad(shortfall.node)).toBe(false)
    expect(shortfall.node.requiredCapacityAh).toBeGreaterThan(0)

    const covered = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 200e-6, eta: 0.3 },
      node: nodeBase,
      rf: { gammaMag: 0, loadRfShare: 0.25 },
    })
    expect(covered.harvestCoversLoad).toBe(true)
    expect(covered.node.lifetimeS).toBe(Infinity)
    expect(covered.node.requiredCapacityAh).toBe(0)

    const mismatched = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 80e-6, eta: 0.25 },
      node: nodeBase,
      rf: { gammaMag: 0.6, loadRfShare: 0.4 },
    })
    expect(mismatched.ok).toBe(true)
    expect(mismatched.rfTax?.reflectedPowerW ?? 0).toBeGreaterThan(0)

    // Legacy budget + RF toys still work
    const legacy = computeNodeEnergyBudget({ ...nodeBase, harvestPowerW: 5e-6 })
    expect(legacy.ok).toBe(true)
    const gamma = runReflectionGammaSample({ Z0: 50, ZL_mismatch: 100 })
    const smith = runSmithChartSample({ Z0: 50, ZL: { re: 25, im: 40 } })
    expect(gamma.ok).toBe(true)
    expect(smith.ok).toBe(true)

    // R3: discovery wiring
    const sensingMethods = methodsForSimPath('sensing')
    expect(
      sensingMethods.some(
        (m) =>
          m.id.includes('node') ||
          m.id.includes('impedance') ||
          m.id.includes('smith') ||
          m.id.includes('path'),
      ),
    ).toBe(true)
    expect(methodsForSimPath('node-budget').some((m) => m.id.includes('node'))).toBe(true)
    expect(
      methodsForSimPath('smith').some((m) => m.id.includes('smith') || m.id.includes('impedance')),
    ).toBe(true)

    expect(
      bestConversionMethods('electromagnetic', 'electric', { k: 2, practicalOnly: true }).length,
    ).toBeGreaterThan(0)

    // 2026 research path gap-fills: Landauer rate floor, min ambient, TEG→cover
    const pLand = landauerBitRatePowerFloor(1e3, 300)
    expect(pLand).toBeGreaterThan(0)
    expect(pLand).toBeLessThan(1e-15)
    const ambMin = minAmbientForSelfPower({
      avgLoadPowerW: shortfall.avgLoadPowerW,
      eta: 0.25,
    })
    expect(ambMin).toBeGreaterThan(shortfall.avgLoadPowerW)
    const teg = composeTegSelfPower({
      teg: { Th: 340, Tc: 300, ZT: 1.2, heatInputW: 3e-3 },
      node: nodeBase,
    })
    expect(teg.ok).toBe(true)
    expect(teg.chain.harvestCoversLoad).toBe(true)

    // Round-2 2026 paths: Betz wind, S-param bound, edge EDP
    const betz = composeBetzSelfPower({
      rho: 1.2,
      area: 0.08,
      v: 9,
      Cp: BETZ_MAX,
      etaElec: 0.7,
      node: nodeBase,
    })
    expect(betz.ok && betz.belowBetz).toBe(true)
    expect(sParamPowerBound({ s11: 0.1, s21: Math.sqrt(0.99) }).passiveOk).toBe(true)
    const edp = edgeInferenceEdp({ nOps: 1e6, C: 1e-15, V: 0.8, fHz: 1e8 })
    expect(edp.ok && edp.EDP > 0).toBe(true)
  })
})
