/**
 * Ultra-low-power sensor **node energy budget** (pure teaching calc).
 *
 * Models one periodic duty cycle: long sleep at I_sleep, short wake at I_active
 * for t_active, period T. Optional continuous harvest/supply power offsets drain.
 * Lifetime from battery capacity when net power > 0.
 *
 * No DOM. Units SI: A, V, s, W, J, Ah.
 */

/** Method id · duty-cycle node energy budget (teaching). */
export const METHOD_NODE_BUDGET = 'method-node-energy-budget'
export const METHOD_ALGO_NODE_DUTY = 'method-algo-node-duty-budget'

export type NodeBudgetInput = {
  /** Sleep / standby current (A). */
  sleepCurrentA: number
  /** Active / wake current (A). */
  activeCurrentA: number
  /** Active duration per period (s). */
  activeTimeS: number
  /** Full period (s). Must be > 0 and ≥ activeTimeS. */
  periodS: number
  /** Rail voltage (V). Used for power and capacity conversions. */
  supplyVoltageV: number
  /** Battery capacity (Ah); omit if only average power is needed. */
  batteryCapacityAh?: number
  /** Continuous average harvest / supply power into the rail (W). */
  harvestPowerW?: number
  /**
   * Extra continuous load beyond the duty-cycle average (W), e.g. RF mismatch waste.
   * Added to P_avg for net drain / lifetime; must be ≥ 0.
   */
  extraContinuousLoadW?: number
  /** Optional design target lifetime (s) → required capacity. */
  targetLifetimeS?: number
}

export type NodeBudgetResult = {
  dutyCycle: number
  sleepTimeS: number
  energyPerCycleJ: number
  avgCurrentA: number
  /** Duty-cycle average power only (excludes extraContinuousLoadW). */
  avgPowerW: number
  /** Duty-cycle + extra continuous load (W). */
  totalLoadPowerW: number
  harvestPowerW: number
  /** Drain power: totalLoad − harvest (≥ 0 when battery is drawn). */
  netPowerW: number
  /**
   * True when continuous harvest covers total load (P_net ≤ 0).
   * Self-powered edge node is energy-feasible without drawing the battery.
   */
  harvestCoversLoad: boolean
  /** Lifetime (s) from capacity when net drain > 0; +∞ if harvest covers; NaN if no capacity. */
  lifetimeS: number
  /** Capacity (Ah) needed for targetLifetimeS at this net drain; NaN if unused/invalid. */
  requiredCapacityAh: number
  finite: boolean
  ok: boolean
}

function finitePos(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x) && x >= 0)
}

/**
 * Average power / lifetime for a duty-cycled node.
 *
 *   E_cycle = V · (I_sleep · t_sleep + I_active · t_active)
 *   P_avg   = E_cycle / T
 *   P_net   = P_avg − P_harvest
 *   life    = (C_Ah · V) / P_net   when P_net > 0
 */
export function computeNodeEnergyBudget(input: NodeBudgetInput): NodeBudgetResult {
  const {
    sleepCurrentA: Is,
    activeCurrentA: Ia,
    activeTimeS: ta,
    periodS: T,
    supplyVoltageV: V,
    batteryCapacityAh: C,
    harvestPowerW: Ph = 0,
    targetLifetimeS: Tlife,
  } = input

  const nan: NodeBudgetResult = {
    dutyCycle: NaN,
    sleepTimeS: NaN,
    energyPerCycleJ: NaN,
    avgCurrentA: NaN,
    avgPowerW: NaN,
    totalLoadPowerW: NaN,
    harvestPowerW: NaN,
    netPowerW: NaN,
    harvestCoversLoad: false,
    lifetimeS: NaN,
    requiredCapacityAh: NaN,
    finite: false,
    ok: false,
  }

  const Pextra = input.extraContinuousLoadW ?? 0

  if (!finitePos(Is, Ia, ta, T, V) || !(T > 0) || !(V > 0) || ta > T + 1e-15) {
    return nan
  }
  if (!Number.isFinite(Ph) || Ph < 0) return nan
  if (!Number.isFinite(Pextra) || Pextra < 0) return nan
  if (C !== undefined && (!Number.isFinite(C) || C < 0)) return nan
  if (Tlife !== undefined && (!Number.isFinite(Tlife) || Tlife <= 0)) return nan

  const tSleep = T - ta
  const duty = ta / T
  const eCycle = V * (Is * tSleep + Ia * ta)
  const pAvg = eCycle / T
  const iAvg = pAvg / V
  const pTotalLoad = pAvg + Pextra
  // Drain: positive when battery is drawn (total load exceeds harvest)
  const pNet = pTotalLoad - Ph

  let lifetimeS = NaN
  if (C !== undefined) {
    if (pNet <= 0) {
      lifetimeS = Infinity
    } else {
      // E_batt (J) = C_Ah · 3600 · V
      lifetimeS = (C * 3600 * V) / pNet
    }
  }

  let requiredCapacityAh = NaN
  if (Tlife !== undefined) {
    if (pNet <= 0) {
      requiredCapacityAh = 0
    } else {
      requiredCapacityAh = (pNet * Tlife) / (3600 * V)
    }
  }

  const finite =
    Number.isFinite(duty) &&
    Number.isFinite(pAvg) &&
    Number.isFinite(iAvg) &&
    Number.isFinite(pNet) &&
    Number.isFinite(pTotalLoad)

  const ok =
    finite &&
    duty >= 0 &&
    duty <= 1 &&
    pAvg >= 0 &&
    (C === undefined || Number.isFinite(lifetimeS) || lifetimeS === Infinity)

  const harvestCoversLoad = pNet <= 0

  return {
    dutyCycle: duty,
    sleepTimeS: tSleep,
    energyPerCycleJ: eCycle,
    avgCurrentA: iAvg,
    avgPowerW: pAvg,
    totalLoadPowerW: pTotalLoad,
    harvestPowerW: Ph,
    netPowerW: pNet,
    harvestCoversLoad,
    lifetimeS,
    requiredCapacityAh,
    finite,
    ok,
  }
}

/** Whether continuous harvest covers average node load (self-power feasible). */
export function harvestCoversLoad(r: Pick<NodeBudgetResult, 'netPowerW' | 'harvestCoversLoad'>): boolean {
  if (typeof r.harvestCoversLoad === 'boolean') return r.harvestCoversLoad
  return Number.isFinite(r.netPowerW) && r.netPowerW <= 0
}

/**
 * Self-check sample: µA sleep, mA wake, 1% duty → finite µW-class average;
 * more sleep current → higher avg power; harvest that covers → infinite life.
 */
export function runNodeDutyBudgetSample(opts?: Partial<NodeBudgetInput>): {
  result: NodeBudgetResult
  monoOk: boolean
  coverOk: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_NODE_DUTY
  familyId: typeof METHOD_NODE_BUDGET
} {
  const base: NodeBudgetInput = {
    sleepCurrentA: opts?.sleepCurrentA ?? 2e-6,
    activeCurrentA: opts?.activeCurrentA ?? 5e-3,
    activeTimeS: opts?.activeTimeS ?? 0.05,
    periodS: opts?.periodS ?? 60,
    supplyVoltageV: opts?.supplyVoltageV ?? 3.0,
    batteryCapacityAh: opts?.batteryCapacityAh ?? 0.2,
    harvestPowerW: opts?.harvestPowerW ?? 0,
    targetLifetimeS: opts?.targetLifetimeS ?? 10 * 365.25 * 24 * 3600,
  }
  const result = computeNodeEnergyBudget(base)

  // Monotonicity: higher sleep current → higher avg power, shorter life
  const hiSleep = computeNodeEnergyBudget({ ...base, sleepCurrentA: base.sleepCurrentA * 3 })
  const monoOk =
    hiSleep.avgPowerW > result.avgPowerW &&
    Number.isFinite(hiSleep.lifetimeS) &&
    Number.isFinite(result.lifetimeS) &&
    hiSleep.lifetimeS < result.lifetimeS

  // Harvest covering average power → infinite life
  const cover = computeNodeEnergyBudget({
    ...base,
    harvestPowerW: result.avgPowerW * 1.05,
  })
  const coverOk = cover.lifetimeS === Infinity && cover.netPowerW < 0

  const ok = result.ok && result.avgPowerW > 0 && monoOk && coverOk

  return {
    result,
    monoOk,
    coverOk,
    ok,
    methodId: METHOD_ALGO_NODE_DUTY,
    familyId: METHOD_NODE_BUDGET,
  }
}
