/**
 * Edge self-powered **calculation chain** (pure teaching stages).
 *
 * Stages:
 *  1. ambient → usable harvest electrical power (η · ambient, or density × area)
 *  2. optional RF mismatch tax on a share of active/load power via |Γ|²
 *  3. compose with duty-cycle node budget (sleep/wake) → net power & cover
 *
 * Reuses nodeEnergyBudget cover semantics and impedance-match powerReflection.
 * No DOM. SI units: W, m², A, V, s, Ah.
 */

import {
  type Complex,
  cAbs,
  powerReflection,
  powerTransmission,
  reflectionGamma,
  cReal,
} from './sim/impedance-match-algos'
import {
  computeNodeEnergyBudget,
  type NodeBudgetInput,
  type NodeBudgetResult,
} from './nodeEnergyBudget'

export const METHOD_EDGE_CHAIN = 'method-node-energy-budget'
export const METHOD_ALGO_EDGE_SELF_POWER_CHAIN = 'method-algo-edge-self-power-chain'

// ─── Stage 1: ambient → usable harvest ─────────────────────────────────────

export type HarvestPowerInput = {
  /** Ambient available power at the harvester (W). Mutually exclusive path with density×area. */
  ambientPowerW?: number
  /** Ambient power density (W/m²), e.g. irradiance or vibration power density. */
  ambientPowerDensityWm2?: number
  /** Effective aperture / collection area (m²). Required if density is used. */
  apertureM2?: number
  /** Harvest conversion efficiency η ∈ [0, 1] (electrical out / ambient in). */
  eta: number
}

export type HarvestPowerResult = {
  ambientPowerW: number
  eta: number
  usableHarvestPowerW: number
  finite: boolean
  ok: boolean
}

/**
 * Usable electrical harvest power:
 *   P_usable = η · P_ambient
 *   P_ambient = ambientPowerW  OR  density · aperture
 */
export function computeUsableHarvestPower(input: HarvestPowerInput): HarvestPowerResult {
  const { eta } = input
  const nan: HarvestPowerResult = {
    ambientPowerW: NaN,
    eta: NaN,
    usableHarvestPowerW: NaN,
    finite: false,
    ok: false,
  }
  if (!Number.isFinite(eta) || eta < 0 || eta > 1) return nan

  let ambient = NaN
  if (input.ambientPowerW !== undefined) {
    if (!Number.isFinite(input.ambientPowerW) || input.ambientPowerW < 0) return nan
    ambient = input.ambientPowerW
  } else if (
    input.ambientPowerDensityWm2 !== undefined &&
    input.apertureM2 !== undefined
  ) {
    const d = input.ambientPowerDensityWm2
    const a = input.apertureM2
    if (!Number.isFinite(d) || !Number.isFinite(a) || d < 0 || a < 0) return nan
    ambient = d * a
  } else {
    return nan
  }

  const usable = eta * ambient
  const finite = Number.isFinite(usable) && Number.isFinite(ambient)
  return {
    ambientPowerW: ambient,
    eta,
    usableHarvestPowerW: usable,
    finite,
    ok: finite && usable >= 0,
  }
}

// ─── Stage 2: RF mismatch tax ──────────────────────────────────────────────

export type RfMismatchTaxInput = {
  /** Power subject to RF path (W), e.g. average TX share of load or incident RF budget. */
  incidentPowerW: number
  /**
   * Reflection coefficient magnitude |Γ| ∈ [0, 1], OR pass complex Γ via `gamma`.
   * Power reflection = |Γ|² from impedance-match-algos semantics.
   */
  gammaMag?: number
  /** Complex Γ; if set, overrides gammaMag for |Γ|² via powerReflection. */
  gamma?: Complex
  /** Physical ZL/Z0 for teaching: builds Γ via reflectionGamma (optional). */
  ZL?: Complex
  Z0?: number
}

export type RfMismatchTaxResult = {
  incidentPowerW: number
  gammaMag: number
  powerReflection: number
  powerTransmission: number
  reflectedPowerW: number
  deliveredPowerW: number
  finite: boolean
  ok: boolean
}

/**
 * RF mismatch tax: fraction |Γ|² of incident power is reflected (not delivered).
 * Matched |Γ|=0 ⇒ delivered = incident.
 */
export function computeRfMismatchTax(input: RfMismatchTaxInput): RfMismatchTaxResult {
  const nan: RfMismatchTaxResult = {
    incidentPowerW: NaN,
    gammaMag: NaN,
    powerReflection: NaN,
    powerTransmission: NaN,
    reflectedPowerW: NaN,
    deliveredPowerW: NaN,
    finite: false,
    ok: false,
  }

  const Pin = input.incidentPowerW
  if (!Number.isFinite(Pin) || Pin < 0) return nan

  let gamma: Complex
  if (input.gamma) {
    gamma = input.gamma
  } else if (input.ZL !== undefined && input.Z0 !== undefined) {
    gamma = reflectionGamma(input.ZL, cReal(input.Z0))
  } else if (input.gammaMag !== undefined) {
    const m = input.gammaMag
    if (!Number.isFinite(m) || m < 0 || m > 1) return nan
    gamma = { re: m, im: 0 } // pure real Γ with |Γ|=m (worst-case phase for magnitude)
  } else {
    return nan
  }

  const pr = powerReflection(gamma)
  const pt = powerTransmission(gamma)
  const mag = cAbs(gamma)
  if (!Number.isFinite(pr) || !Number.isFinite(pt) || !Number.isFinite(mag)) return nan
  // Passive clamp: |Γ|≤1 for teaching delivered power
  const prClamped = Math.min(1, Math.max(0, pr))
  const ptClamped = 1 - prClamped
  const reflected = Pin * prClamped
  const delivered = Pin * ptClamped
  const finite =
    Number.isFinite(reflected) && Number.isFinite(delivered) && Number.isFinite(mag)

  return {
    incidentPowerW: Pin,
    gammaMag: mag,
    powerReflection: prClamped,
    powerTransmission: ptClamped,
    reflectedPowerW: reflected,
    deliveredPowerW: delivered,
    finite,
    ok: finite,
  }
}

// ─── Stage 3: compose chain ────────────────────────────────────────────────

export type EdgeSelfPowerChainInput = {
  /** Ambient → usable harvest stage. */
  harvest: HarvestPowerInput
  /** Duty-cycle node (without harvestPowerW — filled from harvest stage). */
  node: Omit<NodeBudgetInput, 'harvestPowerW'>
  /**
   * Optional RF tax: applies |Γ|² loss to a share of average node load treated as RF path.
   * Effective harvest available for cover is reduced by reflected portion of rfIncident.
   * If `taxHarvest` is true (default false), tax is applied to usable harvest instead.
   */
  rf?: Omit<RfMismatchTaxInput, 'incidentPowerW'> & {
    /** Fraction of avg load attributed to RF TX path (0–1). Used if incidentPowerW omitted. */
    loadRfShare?: number
    /** Explicit incident power for RF tax (W). Overrides share of load. */
    incidentPowerW?: number
    /** If true, tax usable harvest; else tax RF share of load (default). */
    taxHarvest?: boolean
  }
}

export type EdgeSelfPowerChainResult = {
  harvest: HarvestPowerResult
  rfTax: RfMismatchTaxResult | null
  /** Effective continuous harvest power fed into the node budget (after optional harvest tax). */
  effectiveHarvestPowerW: number
  /** Extra average load from RF reflection waste when taxing load share (W). */
  rfExtraLoadW: number
  node: NodeBudgetResult
  avgLoadPowerW: number
  netPowerW: number
  harvestCoversLoad: boolean
  finite: boolean
  ok: boolean
}

/**
 * Compose ambient harvest + duty-cycle budget (+ optional RF mismatch tax).
 *
 * Default RF model: a share of average load is RF TX power; reflected fraction is
 * wasted and adds to effective load (or reduces delivered). Cover when
 * effectiveHarvest ≥ avgLoad (+ rf waste as modeled).
 */
export function computeEdgeSelfPowerChain(
  input: EdgeSelfPowerChainInput,
): EdgeSelfPowerChainResult {
  const harvest = computeUsableHarvestPower(input.harvest)
  if (!harvest.ok) {
    return {
      harvest,
      rfTax: null,
      effectiveHarvestPowerW: NaN,
      rfExtraLoadW: 0,
      node: computeNodeEnergyBudget({
        ...input.node,
        harvestPowerW: 0,
      }),
      avgLoadPowerW: NaN,
      netPowerW: NaN,
      harvestCoversLoad: false,
      finite: false,
      ok: false,
    }
  }

  // First pass: node without RF to get avg load for share-based RF incident
  const pre = computeNodeEnergyBudget({
    ...input.node,
    harvestPowerW: harvest.usableHarvestPowerW,
  })

  let rfTax: RfMismatchTaxResult | null = null
  let effectiveHarvest = harvest.usableHarvestPowerW
  let rfExtraLoadW = 0

  if (input.rf) {
    const share = input.rf.loadRfShare ?? 0
    const incident =
      input.rf.incidentPowerW !== undefined
        ? input.rf.incidentPowerW
        : Math.max(0, pre.avgPowerW * share)

    rfTax = computeRfMismatchTax({
      incidentPowerW: incident,
      gammaMag: input.rf.gammaMag,
      gamma: input.rf.gamma,
      ZL: input.rf.ZL,
      Z0: input.rf.Z0,
    })

    if (rfTax.ok) {
      if (input.rf.taxHarvest) {
        // Lose |Γ|² of harvest to mismatch before it powers the rail
        effectiveHarvest = harvest.usableHarvestPowerW * rfTax.powerTransmission
      } else {
        // Reflected TX energy is wasted as extra continuous load (never clamp away)
        rfExtraLoadW = rfTax.reflectedPowerW
      }
    }
  }

  // Full drain model: totalLoad = dutyAvg + rfExtra; netDrain = totalLoad − harvest
  // Do NOT clamp (H − rfExtra) to 0 — when rfExtra > H the battery must still fund the waste.
  const node = computeNodeEnergyBudget({
    ...input.node,
    harvestPowerW: effectiveHarvest,
    extraContinuousLoadW: rfExtraLoadW,
  })

  const avgLoad = node.avgPowerW
  // Chain netPowerW: surplus convention (positive when self-powered)
  const netSurplus = effectiveHarvest - avgLoad - rfExtraLoadW
  const covers = netSurplus >= -1e-15 && node.harvestCoversLoad

  const finite =
    harvest.finite &&
    node.finite &&
    Number.isFinite(effectiveHarvest) &&
    Number.isFinite(rfExtraLoadW) &&
    (rfTax === null || rfTax.finite)

  const ok =
    harvest.ok &&
    node.ok &&
    finite &&
    (rfTax === null || rfTax.ok)

  return {
    harvest,
    rfTax,
    effectiveHarvestPowerW: effectiveHarvest,
    rfExtraLoadW,
    node,
    avgLoadPowerW: avgLoad,
    netPowerW: netSurplus,
    harvestCoversLoad: covers,
    finite,
    ok,
  }
}

/**
 * Self-check sample: micro-ambient + piezo η, duty-cycle load, optional mismatch.
 */
export function runEdgeSelfPowerChainSample(): {
  cover: EdgeSelfPowerChainResult
  shortfall: EdgeSelfPowerChainResult
  matchedRf: EdgeSelfPowerChainResult
  mismatchedRf: EdgeSelfPowerChainResult
  monoHarvestOk: boolean
  rfTaxOk: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_EDGE_SELF_POWER_CHAIN
  familyId: typeof METHOD_EDGE_CHAIN
} {
  const nodeBase: Omit<NodeBudgetInput, 'harvestPowerW'> = {
    sleepCurrentA: 2e-6,
    activeCurrentA: 5e-3,
    activeTimeS: 0.05,
    periodS: 60,
    supplyVoltageV: 3,
    batteryCapacityAh: 0.22,
    targetLifetimeS: 10 * 365.25 * 24 * 3600,
  }

  // Cover: high ambient × η
  const cover = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: 200e-6, eta: 0.25 }, // 50 µW usable
    node: nodeBase,
  })

  // Shortfall: tiny ambient
  const shortfall = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: 20e-6, eta: 0.2 }, // 4 µW
    node: nodeBase,
  })

  const matchedRf = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: 100e-6, eta: 0.3 },
    node: nodeBase,
    rf: { gammaMag: 0, loadRfShare: 0.3 },
  })

  const mismatchedRf = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: 100e-6, eta: 0.3 },
    node: nodeBase,
    rf: { gammaMag: 0.5, loadRfShare: 0.3 },
  })

  // Monotonic harvest stage
  const h1 = computeUsableHarvestPower({ ambientPowerW: 1e-4, eta: 0.2 })
  const h2 = computeUsableHarvestPower({ ambientPowerW: 2e-4, eta: 0.2 })
  const h3 = computeUsableHarvestPower({ ambientPowerW: 1e-4, eta: 0.4 })
  const monoHarvestOk =
    h2.usableHarvestPowerW > h1.usableHarvestPowerW &&
    h3.usableHarvestPowerW > h1.usableHarvestPowerW

  const t0 = computeRfMismatchTax({ incidentPowerW: 1e-3, gammaMag: 0 })
  const t1 = computeRfMismatchTax({ incidentPowerW: 1e-3, gammaMag: 0.5 })
  const rfTaxOk =
    t0.ok &&
    t1.ok &&
    Math.abs(t0.deliveredPowerW - 1e-3) < 1e-15 &&
    t1.deliveredPowerW < t0.deliveredPowerW &&
    t1.reflectedPowerW > 0

  const ok =
    cover.ok &&
    cover.harvestCoversLoad &&
    shortfall.ok &&
    !shortfall.harvestCoversLoad &&
    monoHarvestOk &&
    rfTaxOk &&
    mismatchedRf.ok &&
    matchedRf.ok &&
    mismatchedRf.netPowerW < matchedRf.netPowerW &&
    mismatchedRf.rfExtraLoadW > matchedRf.rfExtraLoadW

  return {
    cover,
    shortfall,
    matchedRf,
    mismatchedRf,
    monoHarvestOk,
    rfTaxOk,
    ok,
    methodId: METHOD_ALGO_EDGE_SELF_POWER_CHAIN,
    familyId: METHOD_EDGE_CHAIN,
  }
}
