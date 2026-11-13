import { describe, expect, it } from 'vitest'
import {
  computeUsableHarvestPower,
  computeRfMismatchTax,
  computeEdgeSelfPowerChain,
  runEdgeSelfPowerChainSample,
  METHOD_ALGO_EDGE_SELF_POWER_CHAIN,
} from './edgeSelfPowerChain'
import { reflectionGamma, cReal, powerReflection } from './sim/impedance-match-algos'

describe('edgeSelfPowerChain · harvest stage', () => {
  it('usable = η · ambient; finite and ok', () => {
    const r = computeUsableHarvestPower({ ambientPowerW: 100e-6, eta: 0.25 })
    expect(r.ok).toBe(true)
    expect(r.usableHarvestPowerW).toBeCloseTo(25e-6, 15)
  })

  it('density × aperture path', () => {
    // 10 W/m² × 1 cm² = 1e-3 W ambient; η=0.1 → 100 µW
    const r = computeUsableHarvestPower({
      ambientPowerDensityWm2: 10,
      apertureM2: 1e-4,
      eta: 0.1,
    })
    expect(r.ok).toBe(true)
    expect(r.ambientPowerW).toBeCloseTo(1e-3, 12)
    expect(r.usableHarvestPowerW).toBeCloseTo(1e-4, 12)
  })

  it('monotonic in ambient and η', () => {
    const a = computeUsableHarvestPower({ ambientPowerW: 50e-6, eta: 0.2 })
    const bAmb = computeUsableHarvestPower({ ambientPowerW: 100e-6, eta: 0.2 })
    const bEta = computeUsableHarvestPower({ ambientPowerW: 50e-6, eta: 0.4 })
    expect(bAmb.usableHarvestPowerW).toBeGreaterThan(a.usableHarvestPowerW)
    expect(bEta.usableHarvestPowerW).toBeGreaterThan(a.usableHarvestPowerW)
  })

  it('rejects bad η / missing ambient', () => {
    expect(computeUsableHarvestPower({ ambientPowerW: 1e-4, eta: 1.5 }).ok).toBe(false)
    expect(computeUsableHarvestPower({ eta: 0.2 }).ok).toBe(false)
  })
})

describe('edgeSelfPowerChain · RF mismatch tax', () => {
  it('|Γ|=0 ⇒ delivered = incident, reflected = 0', () => {
    const r = computeRfMismatchTax({ incidentPowerW: 1e-3, gammaMag: 0 })
    expect(r.ok).toBe(true)
    expect(r.deliveredPowerW).toBeCloseTo(1e-3, 15)
    expect(r.reflectedPowerW).toBeCloseTo(0, 15)
    expect(r.powerReflection).toBeCloseTo(0, 15)
  })

  it('larger |Γ| ⇒ more loss / less delivered', () => {
    const a = computeRfMismatchTax({ incidentPowerW: 1e-3, gammaMag: 0.2 })
    const b = computeRfMismatchTax({ incidentPowerW: 1e-3, gammaMag: 0.6 })
    expect(b.reflectedPowerW).toBeGreaterThan(a.reflectedPowerW)
    expect(b.deliveredPowerW).toBeLessThan(a.deliveredPowerW)
    expect(b.powerReflection).toBeCloseTo(0.36, 12)
  })

  it('uses real powerReflection from impedance-match for complex ZL', () => {
    const Z0 = 50
    const ZL = { re: 100, im: 0 }
    const g = reflectionGamma(ZL, cReal(Z0))
    const pr = powerReflection(g)
    const r = computeRfMismatchTax({ incidentPowerW: 2e-3, ZL, Z0 })
    expect(r.ok).toBe(true)
    expect(r.powerReflection).toBeCloseTo(pr, 12)
    expect(r.reflectedPowerW).toBeCloseTo(2e-3 * pr, 12)
    expect(r.deliveredPowerW).toBeCloseTo(2e-3 * (1 - pr), 12)
  })
})

describe('edgeSelfPowerChain · composed chain', () => {
  const node = {
    sleepCurrentA: 2e-6,
    activeCurrentA: 5e-3,
    activeTimeS: 0.05,
    periodS: 60,
    supplyVoltageV: 3,
    batteryCapacityAh: 0.22,
    targetLifetimeS: 10 * 365.25 * 24 * 3600,
  }

  it('harvest above load ⇒ covers / infinite life', () => {
    const r = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 500e-6, eta: 0.2 }, // 100 µW usable >> ~18 µW load
      node,
    })
    expect(r.ok).toBe(true)
    expect(r.harvest.usableHarvestPowerW).toBeGreaterThan(r.avgLoadPowerW)
    expect(r.harvestCoversLoad).toBe(true)
    expect(r.node.lifetimeS).toBe(Infinity)
    expect(r.node.requiredCapacityAh).toBe(0)
  })

  it('harvest below load ⇒ shortfall, finite life, positive required capacity', () => {
    const r = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 20e-6, eta: 0.15 }, // 3 µW
      node,
    })
    expect(r.ok).toBe(true)
    expect(r.harvestCoversLoad).toBe(false)
    expect(r.netPowerW).toBeLessThan(0)
    expect(Number.isFinite(r.node.lifetimeS)).toBe(true)
    expect(r.node.lifetimeS).toBeGreaterThan(0)
    expect(r.node.requiredCapacityAh).toBeGreaterThan(0)
  })

  it('RF mismatch increases shortfall vs matched (load-share tax)', () => {
    const matched = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 80e-6, eta: 0.25 },
      node,
      rf: { gammaMag: 0, loadRfShare: 0.4 },
    })
    const bad = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 80e-6, eta: 0.25 },
      node,
      rf: { gammaMag: 0.7, loadRfShare: 0.4 },
    })
    expect(matched.ok && bad.ok).toBe(true)
    expect(bad.rfExtraLoadW).toBeGreaterThan(0)
    // worse net after mismatch waste
    expect(bad.netPowerW).toBeLessThan(matched.netPowerW)
    expect(bad.node.netPowerW).toBeGreaterThan(matched.node.netPowerW)
  })

  it('UI-reachable severe mismatch: RF waste not clamped when reflected > harvest', () => {
    // ambient=20µW η=0.5 → usable 10µW; |Γ|=0.95 share=0.8 on ~18µW load
    // incident ≈ 0.8·P_avg, reflected ≈ 0.9025·incident can exceed usable harvest
    const r = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 20e-6, eta: 0.5 },
      node,
      rf: { gammaMag: 0.95, loadRfShare: 0.8 },
    })
    expect(r.ok).toBe(true)
    expect(r.harvest.usableHarvestPowerW).toBeCloseTo(10e-6, 15)
    expect(r.rfExtraLoadW).toBeGreaterThan(r.effectiveHarvestPowerW)
    // Full drain: L + rfExtra − H  (must NOT understate by clamping H−rfExtra to 0)
    const expectedDrain = r.avgLoadPowerW + r.rfExtraLoadW - r.effectiveHarvestPowerW
    expect(expectedDrain).toBeGreaterThan(r.avgLoadPowerW) // worse than duty-only shortfall
    expect(r.node.netPowerW).toBeCloseTo(expectedDrain, 12)
    expect(r.netPowerW).toBeCloseTo(-expectedDrain, 12)
    expect(r.harvestCoversLoad).toBe(false)
    // Lifetime shorter than same chain without RF tax
    const noRf = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 20e-6, eta: 0.5 },
      node,
    })
    expect(r.node.lifetimeS).toBeLessThan(noRf.node.lifetimeS)
    expect(r.node.requiredCapacityAh).toBeGreaterThan(noRf.node.requiredCapacityAh!)
  })

  it('runEdgeSelfPowerChainSample ok', () => {
    const s = runEdgeSelfPowerChainSample()
    expect(s.methodId).toBe(METHOD_ALGO_EDGE_SELF_POWER_CHAIN)
    expect(s.ok).toBe(true)
    expect(s.monoHarvestOk).toBe(true)
    expect(s.rfTaxOk).toBe(true)
    expect(s.cover.harvestCoversLoad).toBe(true)
    expect(s.shortfall.harvestCoversLoad).toBe(false)
  })
})
