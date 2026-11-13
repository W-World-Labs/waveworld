/**
 * 2026 research-target calcs · pure teaching kernels that close path gaps:
 *  - Landauer continuous power floor for telemetry / edge bit rates
 *  - Min ambient power for self-powered cover (inverse harvest)
 *  - TEG ZT efficiency → usable electrical power → optional self-power chain
 *
 * Reuses thermoelectricEfficiency (physics/limits) and computeEdgeSelfPowerChain.
 */

import { KB, QE } from './physics/constants'
import { BETZ_MAX, carnotEfficiency, thermoelectricEfficiency } from './physics/limits'
import { sqEfficiency } from './physics/sq'
import { windPower, windPowerExtracted } from './sim/wind-algos'
import { F_FARADAY, nernstVoltage, E0_H2_O2 } from './sim/fuelcell-algos'
import { radarPr } from './sim/radar-equation-algos'
import { wienPeakWavelength, WIEN_B } from './sim/stefan-boltzmann-algos'
import { fsplDb } from './sim/fspl-algos'
import {
  computeEdgeSelfPowerChain,
  type EdgeSelfPowerChainInput,
  type EdgeSelfPowerChainResult,
} from './edgeSelfPowerChain'
import type { NodeBudgetInput } from './nodeEnergyBudget'

export const METHOD_RESEARCH_2026 = 'method-node-energy-budget'
export const METHOD_ALGO_RESEARCH_2026 = 'method-algo-research-2026-claims'

// ─── T4: Landauer continuous power floor ───────────────────────────────────

/**
 * Minimum average power to irreversibly process/erase bits at rate R (bit/s):
 *   P_min = R · k_B · T · ln 2
 * Floor only — real radios/MCUs are many orders above.
 */
export function landauerBitRatePowerFloor(
  rateBitsPerSec: number,
  temperatureK = 300,
  k: number = KB,
): number {
  if (
    !Number.isFinite(rateBitsPerSec) ||
    !Number.isFinite(temperatureK) ||
    !Number.isFinite(k) ||
    rateBitsPerSec < 0 ||
    !(temperatureK > 0) ||
    !(k > 0)
  ) {
    return NaN
  }
  return rateBitsPerSec * k * temperatureK * Math.LN2
}

/** Energy floor for N bits: N · kT ln2 (J). */
export function landauerBitsEnergy(nBits: number, temperatureK = 300, k: number = KB): number {
  if (!Number.isFinite(nBits) || nBits < 0) return NaN
  return landauerBitRatePowerFloor(nBits, temperatureK, k) // same formula with R=N for 1 s erasure budget
}

// ─── T5a: inverse ambient for cover ────────────────────────────────────────

/**
 * Minimum ambient power such that η·P_amb ≥ totalLoad (duty + optional RF extra).
 *   P_amb,min = totalLoad / η
 */
export function minAmbientForSelfPower(opts: {
  avgLoadPowerW: number
  eta: number
  /** Extra continuous load (e.g. RF mismatch waste), W. */
  rfExtraLoadW?: number
}): number {
  const { avgLoadPowerW, eta, rfExtraLoadW = 0 } = opts
  if (
    !Number.isFinite(avgLoadPowerW) ||
    !Number.isFinite(eta) ||
    !Number.isFinite(rfExtraLoadW) ||
    avgLoadPowerW < 0 ||
    rfExtraLoadW < 0 ||
    !(eta > 0) ||
    eta > 1
  ) {
    return NaN
  }
  return (avgLoadPowerW + rfExtraLoadW) / eta
}

// ─── T5b: TEG heat → usable electrical ─────────────────────────────────────

export type TegUsableInput = {
  /** Hot side temperature (K). */
  Th: number
  /** Cold side temperature (K). */
  Tc: number
  /** Dimensionless figure of merit ZT (≥ 0). */
  ZT: number
  /** Heat input rate at hot side (W). */
  heatInputW: number
}

export type TegUsableResult = {
  etaTE: number
  etaCarnot: number
  usableElectricalW: number
  finite: boolean
  ok: boolean
  /** Claim: η_TE ≤ η_Carnot (within numerical tol). */
  belowCarnot: boolean
}

/**
 * Thermoelectric generator: η_TE from ZT (Ioffe/Goldsmid form) then P_e = η · Q_h.
 * Asserts η_TE ≤ Carnot on finite positive inputs.
 */
export function tegUsableElectricalPower(input: TegUsableInput): TegUsableResult {
  const { Th, Tc, ZT, heatInputW } = input
  const nan: TegUsableResult = {
    etaTE: NaN,
    etaCarnot: NaN,
    usableElectricalW: NaN,
    finite: false,
    ok: false,
    belowCarnot: false,
  }
  if (
    !Number.isFinite(Th) ||
    !Number.isFinite(Tc) ||
    !Number.isFinite(ZT) ||
    !Number.isFinite(heatInputW) ||
    !(Th > Tc) ||
    !(Tc > 0) ||
    ZT < 0 ||
    heatInputW < 0
  ) {
    return nan
  }
  const etaTE = thermoelectricEfficiency(ZT, Tc, Th)
  const etaC = carnotEfficiency(Tc, Th)
  if (!Number.isFinite(etaTE) || !Number.isFinite(etaC)) return nan
  const Pe = etaTE * heatInputW
  const belowCarnot = etaTE <= etaC + 1e-12
  return {
    etaTE,
    etaCarnot: etaC,
    usableElectricalW: Pe,
    finite: true,
    ok: belowCarnot && Pe >= 0,
    belowCarnot,
  }
}

// ─── T5c: TEG → edge self-power composition ────────────────────────────────

export type TegSelfPowerInput = {
  teg: TegUsableInput
  node: Omit<NodeBudgetInput, 'harvestPowerW' | 'extraContinuousLoadW'>
  /** Optional RF tax share / |Γ| as in edge self-power chain. */
  rf?: EdgeSelfPowerChainInput['rf']
}

export type TegSelfPowerResult = {
  teg: TegUsableResult
  chain: EdgeSelfPowerChainResult
  /** Ambient ambient power for chain = heatInput (thermal side); η = η_TE. */
  ok: boolean
}

/**
 * Feed TEG usable electrical power into the edge self-power chain as harvest η path:
 *   P_usable = η_TE · Q_h  ⇒  cover check vs duty-cycle load.
 */
export function composeTegSelfPower(input: TegSelfPowerInput): TegSelfPowerResult {
  const teg = tegUsableElectricalPower(input.teg)
  if (!teg.ok) {
    return {
      teg,
      chain: computeEdgeSelfPowerChain({
        harvest: { ambientPowerW: 0, eta: 0 },
        node: input.node,
        rf: input.rf,
      }),
      ok: false,
    }
  }
  // Represent as ambient=Q_h, eta=η_TE so chain stage 1 matches P_e
  const chain = computeEdgeSelfPowerChain({
    harvest: {
      ambientPowerW: input.teg.heatInputW,
      eta: teg.etaTE,
    },
    node: input.node,
    rf: input.rf,
  })
  const ok =
    teg.ok &&
    chain.ok &&
    Math.abs(chain.harvest.usableHarvestPowerW - teg.usableElectricalW) <
      1e-12 * Math.max(1, teg.usableElectricalW)

  return { teg, chain, ok }
}

// ─── T6: Edge inference energy–delay product ───────────────────────────────

export type EdgeInferenceEdpInput = {
  /** Number of ops per inference. */
  nOps: number
  /** Effective switched capacitance (F). */
  C: number
  /** Supply voltage (V). */
  V: number
  /** Clock frequency (Hz). */
  fHz: number
}

/**
 * Teaching CV² floor per op; E_inf = N·C·V²; t_d = N/f; EDP = E_inf · t_d.
 * Lower V cuts energy (∝V²) but stretches delay if f is fixed (here f is input).
 */
export function edgeInferenceEdp(input: EdgeInferenceEdpInput): {
  E_op: number
  E_inf: number
  t_d: number
  EDP: number
  ok: boolean
} {
  const { nOps, C, V, fHz } = input
  const bad = { E_op: NaN, E_inf: NaN, t_d: NaN, EDP: NaN, ok: false }
  if (
    ![nOps, C, V, fHz].every(Number.isFinite) ||
    !(nOps > 0) ||
    !(C > 0) ||
    !(V > 0) ||
    !(fHz > 0)
  ) {
    return bad
  }
  const E_op = C * V * V
  const E_inf = nOps * E_op
  const t_d = nOps / fHz
  return { E_op, E_inf, t_d, EDP: E_inf * t_d, ok: true }
}

// ─── T7: Passive 2-port S power bound ──────────────────────────────────────

/**
 * Lossless teaching bound: |S11|² + |S21|² ≤ 1 (equality for unitary lossless).
 * Optional reverse port if s12/s22 provided.
 */
export function sParamPowerBound(opts: {
  s11: number
  s21: number
  s12?: number
  s22?: number
}): {
  sumFwd: number
  sumRev: number | null
  passiveOk: boolean
  unitaryFwd: boolean
  ok: boolean
} {
  const { s11, s21, s12, s22 } = opts
  if (![s11, s21].every(Number.isFinite) || s11 < 0 || s21 < 0) {
    return { sumFwd: NaN, sumRev: null, passiveOk: false, unitaryFwd: false, ok: false }
  }
  const sumFwd = s11 * s11 + s21 * s21
  let sumRev: number | null = null
  if (s12 !== undefined && s22 !== undefined) {
    if (![s12, s22].every(Number.isFinite) || s12 < 0 || s22 < 0) {
      return { sumFwd, sumRev: NaN, passiveOk: false, unitaryFwd: false, ok: false }
    }
    sumRev = s12 * s12 + s22 * s22
  }
  const passiveOk = sumFwd <= 1 + 1e-12 && (sumRev === null || sumRev <= 1 + 1e-12)
  const unitaryFwd = Math.abs(sumFwd - 1) < 1e-9
  return { sumFwd, sumRev, passiveOk, unitaryFwd, ok: passiveOk }
}

// ─── T8: Acoustic intensity match → piezo receive ──────────────────────────

/**
 * Normal-incidence intensity reflection/transmission between Z1→Z2:
 *   R = ((Z2−Z1)/(Z2+Z1))²,  T = 1−R = 4 Z1 Z2 / (Z1+Z2)²
 * Received electrical upper teaching bound: P_rx ≤ η_piezo · T · P_inc
 */
export function acousticPiezoReceive(opts: {
  Z1: number
  Z2: number
  incidentPowerW: number
  etaPiezo: number
}): {
  R: number
  T: number
  P_rx: number
  energyConserved: boolean
  ok: boolean
} {
  const { Z1, Z2, incidentPowerW: Pin, etaPiezo } = opts
  const bad = { R: NaN, T: NaN, P_rx: NaN, energyConserved: false, ok: false }
  if (
    ![Z1, Z2, Pin, etaPiezo].every(Number.isFinite) ||
    !(Z1 > 0) ||
    !(Z2 > 0) ||
    Pin < 0 ||
    etaPiezo < 0 ||
    etaPiezo > 1
  ) {
    return bad
  }
  const r = (Z2 - Z1) / (Z2 + Z1)
  const R = r * r
  const T = 1 - R
  const P_rx = etaPiezo * T * Pin
  const energyConserved = Math.abs(R + T - 1) < 1e-12
  return { R, T, P_rx, energyConserved, ok: energyConserved && P_rx >= 0 }
}

// ─── T9: Betz wind → self-power cover ──────────────────────────────────────

export type BetzSelfPowerInput = {
  rho: number
  area: number
  v: number
  /** Power coefficient; must be ≤ BETZ_MAX for belowBetz=true. */
  Cp: number
  /** Electrical conversion after extraction (generator/rectifier). */
  etaElec: number
  node: Omit<NodeBudgetInput, 'harvestPowerW' | 'extraContinuousLoadW'>
  rf?: EdgeSelfPowerChainInput['rf']
}

/**
 * Kinetic power ½ρAv³; extractable Cp·P_kin with Cp ≤ 16/27; then η_elec into cover chain.
 */
export function composeBetzSelfPower(input: BetzSelfPowerInput): {
  P_kin: number
  P_ext: number
  belowBetz: boolean
  chain: EdgeSelfPowerChainResult
  ok: boolean
} {
  const { rho, area, v, Cp, etaElec, node, rf } = input
  const P_kin = windPower(rho, area, v)
  const P_ext = windPowerExtracted(rho, area, v, Cp)
  const belowBetz = Number.isFinite(Cp) && Cp <= BETZ_MAX + 1e-12 && Cp >= 0
  if (!Number.isFinite(P_kin) || !Number.isFinite(P_ext) || !Number.isFinite(etaElec) || etaElec < 0 || etaElec > 1) {
    return {
      P_kin: NaN,
      P_ext: NaN,
      belowBetz: false,
      chain: computeEdgeSelfPowerChain({ harvest: { ambientPowerW: 0, eta: 0 }, node, rf }),
      ok: false,
    }
  }
  // Ambient = extracted kinetic; η = electrical conversion after rotor
  const chain = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: P_ext, eta: etaElec },
    node,
    rf,
  })
  return {
    P_kin,
    P_ext,
    belowBetz,
    chain,
    ok: chain.ok && belowBetz,
  }
}

// ─── T10: SQ solar → self-power (uses existing sqEfficiency) ────────────────

/**
 * Single-junction SQ η(Eg) × incident solar power → usable electric → cover chain.
 * Eg in eV; P_solar in W on the cell.
 */
export function composeSqSelfPower(opts: {
  Eg_eV: number
  solarPowerW: number
  node: Omit<NodeBudgetInput, 'harvestPowerW' | 'extraContinuousLoadW'>
  rf?: EdgeSelfPowerChainInput['rf']
}): {
  etaSQ: number
  usableW: number
  chain: EdgeSelfPowerChainResult
  ok: boolean
} {
  const { Eg_eV, solarPowerW, node, rf } = opts
  if (!Number.isFinite(Eg_eV) || !Number.isFinite(solarPowerW) || !(Eg_eV > 0) || solarPowerW < 0) {
    return {
      etaSQ: NaN,
      usableW: NaN,
      chain: computeEdgeSelfPowerChain({ harvest: { ambientPowerW: 0, eta: 0 }, node, rf }),
      ok: false,
    }
  }
  const etaSQ = sqEfficiency(Eg_eV * QE)
  if (!Number.isFinite(etaSQ) || etaSQ < 0) {
    return {
      etaSQ: NaN,
      usableW: NaN,
      chain: computeEdgeSelfPowerChain({ harvest: { ambientPowerW: 0, eta: 0 }, node, rf }),
      ok: false,
    }
  }
  const chain = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: solarPowerW, eta: etaSQ },
    node,
    rf,
  })
  return {
    etaSQ,
    usableW: etaSQ * solarPowerW,
    chain,
    ok: chain.ok && Math.abs(chain.harvest.usableHarvestPowerW - etaSQ * solarPowerW) < 1e-9 * Math.max(1, solarPowerW),
  }
}

// ─── T12: Fuel-cell stack efficiency ceiling ────────────────────────────────

/** HHV of H₂ combustion (J/mol) — teaching LHV/HHV table value. */
export const H2_HHV_J_PER_MOL = 285_830

/**
 * Reversible electrical work per mole / HHV heat:
 *   η_rev = (n F E) / ΔH_HHV
 * Claim: η_rev ∈ (0,1] for physical E, ΔH>0.
 */
export function fuelCellReversibleEfficiency(opts: {
  ENernst: number
  deltaH_J_per_mol?: number
  nElectrons?: number
}): { etaRev: number; ok: boolean } {
  const { ENernst, deltaH_J_per_mol: dH = H2_HHV_J_PER_MOL, nElectrons: n = 2 } = opts
  if (
    ![ENernst, dH, n].every(Number.isFinite) ||
    !(ENernst > 0) ||
    !(dH > 0) ||
    !(n > 0)
  ) {
    return { etaRev: NaN, ok: false }
  }
  const etaRev = (n * F_FARADAY * ENernst) / dH
  return { etaRev, ok: Number.isFinite(etaRev) && etaRev > 0 && etaRev <= 1 + 1e-9 }
}

/**
 * Stack teaching efficiency:
 *   η_v = V_cell / E_nernst  (≤1 when operating below OCV)
 *   η_stack = η_rev · η_v · util
 * Claim: η_stack ≤ η_rev (voltage & util never increase the reversible ceiling).
 */
export function fuelCellStackEfficiency(opts: {
  nCells: number
  ENernst: number
  VCell: number
  /** Fuel utilization ∈ (0,1]. */
  util: number
  deltaH_J_per_mol?: number
  nElectrons?: number
}): {
  etaRev: number
  etaVoltage: number
  etaStack: number
  VStack: number
  belowRevLimit: boolean
  ok: boolean
} {
  const { nCells, ENernst, VCell, util } = opts
  const bad = {
    etaRev: NaN,
    etaVoltage: NaN,
    etaStack: NaN,
    VStack: NaN,
    belowRevLimit: false,
    ok: false,
  }
  if (
    ![nCells, ENernst, VCell, util].every(Number.isFinite) ||
    !(nCells >= 1) ||
    !(ENernst > 0) ||
    VCell < 0 ||
    !(util > 0) ||
    util > 1
  ) {
    return bad
  }
  const { etaRev, ok: revOk } = fuelCellReversibleEfficiency({
    ENernst,
    deltaH_J_per_mol: opts.deltaH_J_per_mol,
    nElectrons: opts.nElectrons,
  })
  if (!revOk) return bad
  const etaVoltage = VCell / ENernst
  const etaStack = etaRev * etaVoltage * util
  const belowRevLimit = etaStack <= etaRev + 1e-12
  return {
    etaRev,
    etaVoltage,
    etaStack,
    VStack: nCells * VCell,
    belowRevLimit,
    ok: Number.isFinite(etaStack) && belowRevLimit && etaVoltage <= 1 + 1e-9,
  }
}

/** Standard H2/O2 Nernst at unit activities (re-export convenience). */
export function fuelCellStandardNernst(T = 298.15): number {
  return nernstVoltage(E0_H2_O2, T, 1, 1, 1, 2)
}

// ─── T13: Photon-count SNR (shot-noise + dark + read) ───────────────────────

/**
 * Detected-signal SNR for photon counting / imaging:
 *   S = qe · N_sig
 *   SNR = S / √(S + N_dark + σ_read²)
 * Pure Poisson (dark=0, read=0): SNR = √S (shot-limited).
 */
export function photonCountSnr(opts: {
  signalPhotons: number
  darkPhotons?: number
  readNoiseE?: number
  qe?: number
}): {
  signalElectrons: number
  snr: number
  shotLimited: boolean
  ok: boolean
} {
  const {
    signalPhotons: Nsig,
    darkPhotons: Nd = 0,
    readNoiseE: R = 0,
    qe = 1,
  } = opts
  const bad = { signalElectrons: NaN, snr: NaN, shotLimited: false, ok: false }
  if (
    ![Nsig, Nd, R, qe].every(Number.isFinite) ||
    Nsig < 0 ||
    Nd < 0 ||
    R < 0 ||
    qe < 0 ||
    qe > 1
  ) {
    return bad
  }
  const S = qe * Nsig
  const varTot = S + Nd + R * R
  if (!(varTot > 0) && S === 0) {
    return { signalElectrons: 0, snr: 0, shotLimited: true, ok: true }
  }
  if (!(varTot > 0)) return bad
  const snr = S / Math.sqrt(varTot)
  const shotLimited = S > 0 && Nd + R * R <= 1e-12 * S
  return {
    signalElectrons: S,
    snr,
    shotLimited,
    ok: Number.isFinite(snr) && snr >= 0,
  }
}

// ─── T14: Heat exergy quality factor (Carnot-like) ──────────────────────────

/**
 * Thermal exergy / heat quality factor relative to environment T0:
 *   η_ex = 1 − T0 / Th    (Th > T0 > 0, absolute temperatures)
 * Identical form to Carnot efficiency for a heat engine between Th and T0.
 * Claim: 0 < η_ex < 1; usable work ≤ η_ex · Q_h.
 */
export function heatExergyFactor(Th: number, T0: number): {
  etaEx: number
  ok: boolean
} {
  if (![Th, T0].every(Number.isFinite) || !(T0 > 0) || !(Th > T0)) {
    return { etaEx: NaN, ok: false }
  }
  const etaEx = 1 - T0 / Th
  return {
    etaEx,
    ok: Number.isFinite(etaEx) && etaEx > 0 && etaEx < 1,
  }
}

/**
 * Usable work upper bound from heat Qh at Th vs environment T0:
 *   W_max = η_ex · Q_h
 * Optional conversion efficiency η_conv ∈ (0,1] multiplies: W = η_ex · η_conv · Q_h
 * Claim: W ≤ η_ex · Q_h ≤ Q_h
 */
export function heatExergyUsableWork(opts: {
  heatJ: number
  Th: number
  T0: number
  /** Secondary conversion efficiency after exergy (e.g. generator). Default 1. */
  etaConv?: number
}): {
  etaEx: number
  Wmax: number
  W: number
  belowExergyLimit: boolean
  ok: boolean
} {
  const { heatJ, Th, T0, etaConv = 1 } = opts
  const bad = {
    etaEx: NaN,
    Wmax: NaN,
    W: NaN,
    belowExergyLimit: false,
    ok: false,
  }
  if (
    ![heatJ, Th, T0, etaConv].every(Number.isFinite) ||
    heatJ < 0 ||
    !(etaConv > 0) ||
    etaConv > 1
  ) {
    return bad
  }
  const { etaEx, ok: exOk } = heatExergyFactor(Th, T0)
  if (!exOk) return bad
  const Wmax = etaEx * heatJ
  const W = Wmax * etaConv
  const belowExergyLimit = W <= Wmax + 1e-12 && Wmax <= heatJ + 1e-12
  return {
    etaEx,
    Wmax,
    W,
    belowExergyLimit,
    ok: Number.isFinite(W) && belowExergyLimit,
  }
}

// ─── T15: Radar equation SNR (thermal noise) ────────────────────────────────

/**
 * Single-pulse radar SNR (teaching):
 *   SNR = P_r / (k T_s B_n L)
 * where P_r is monostatic radar equation power (radarPr).
 * Claim: SNR scales as 1/R^4 at fixed other parameters.
 */
export function radarEquationSnr(opts: {
  transmitPowerW: number
  gainTx?: number
  gainRx?: number
  wavelengthM: number
  rcsM2: number
  rangeM: number
  /** System noise temperature (K). */
  systemTempK?: number
  /** Noise bandwidth (Hz). */
  bandwidthHz?: number
  /** System loss factor L ≥ 1. */
  loss?: number
}): {
  prW: number
  noiseW: number
  snr: number
  ok: boolean
} {
  const {
    transmitPowerW: Pt,
    gainTx: Gt = 1,
    gainRx: Gr = 1,
    wavelengthM: lambda,
    rcsM2: sigma,
    rangeM: R,
    systemTempK: Ts = 290,
    bandwidthHz: Bn = 1e6,
    loss: L = 1,
  } = opts
  const bad = { prW: NaN, noiseW: NaN, snr: NaN, ok: false }
  if (
    ![Pt, Gt, Gr, lambda, sigma, R, Ts, Bn, L].every(Number.isFinite) ||
    !(Ts > 0) ||
    !(Bn > 0) ||
    !(L >= 1)
  ) {
    return bad
  }
  const prW = radarPr(Pt, Gt, Gr, lambda, sigma, R)
  if (!Number.isFinite(prW) || prW < 0) return bad
  const noiseW = KB * Ts * Bn * L
  if (!(noiseW > 0)) return bad
  const snr = prW / noiseW
  return { prW, noiseW, snr, ok: Number.isFinite(snr) && snr >= 0 }
}

// ─── T16: Johnson–Nyquist thermal noise ─────────────────────────────────────

/**
 * Available thermal noise power in bandwidth B at temperature T:
 *   P_n = k_B · T · B
 */
export function johnsonNyquistNoisePower(T: number, bandwidthHz: number): {
  powerW: number
  ok: boolean
} {
  if (![T, bandwidthHz].every(Number.isFinite) || !(T > 0) || !(bandwidthHz > 0)) {
    return { powerW: NaN, ok: false }
  }
  const powerW = KB * T * bandwidthHz
  return { powerW, ok: Number.isFinite(powerW) && powerW > 0 }
}

/**
 * Open-circuit Johnson–Nyquist RMS voltage across resistance R:
 *   V_n = √(4 k_B T R B)
 * Claim: V_n scales as √R and √B at fixed T.
 */
export function johnsonNyquistVoltageRms(
  T: number,
  resistanceOhm: number,
  bandwidthHz: number,
): { vRms: number; ok: boolean } {
  if (
    ![T, resistanceOhm, bandwidthHz].every(Number.isFinite) ||
    !(T > 0) ||
    !(resistanceOhm > 0) ||
    !(bandwidthHz > 0)
  ) {
    return { vRms: NaN, ok: false }
  }
  const vRms = Math.sqrt(4 * KB * T * resistanceOhm * bandwidthHz)
  return { vRms, ok: Number.isFinite(vRms) && vRms > 0 }
}

// ─── T17: Wien displacement law ─────────────────────────────────────────────

/**
 * Peak wavelength of blackbody spectral radiance (Wien):
 *   λ_max = b / T
 * Uses shared WIEN_B from stefan-boltzmann-algos.
 */
export function wienDisplacementPeakWavelength(T: number): {
  lambdaMaxM: number
  ok: boolean
} {
  const lambdaMaxM = wienPeakWavelength(T)
  return {
    lambdaMaxM,
    ok: Number.isFinite(lambdaMaxM) && lambdaMaxM > 0,
  }
}

/** Invert Wien: T = b / λ_max. */
export function wienDisplacementTemperature(lambdaMaxM: number): {
  T: number
  ok: boolean
} {
  if (!Number.isFinite(lambdaMaxM) || !(lambdaMaxM > 0)) {
    return { T: NaN, ok: false }
  }
  const T = WIEN_B / lambdaMaxM
  return { T, ok: Number.isFinite(T) && T > 0 }
}

// ─── T18: Free-space path loss (dB) ─────────────────────────────────────────

/**
 * FSPL in dB via shipped fsplDb (SI d,f).
 * Claim: +6.02 dB when distance doubles (20 log10 2).
 */
export function freeSpacePathLossDb(opts: {
  distanceM: number
  frequencyHz: number
}): { fsplDb: number; ok: boolean } {
  const L = fsplDb(opts.distanceM, opts.frequencyHz)
  return { fsplDb: L, ok: Number.isFinite(L) }
}

// ─── T11: Friis RF link → rectifier RF-EH → self-power cover ───────────────

/** Vacuum speed of light (m/s) for free-space wavelength. */
const C0 = 299_792_458

/**
 * Friis free-space received RF power (isotropic teaching form with gains):
 *   P_r = P_t · G_t · G_r · (λ / (4π R))²
 *   λ = c / f
 * Gains are linear (not dB). Distance R > 0, frequency f > 0.
 */
export function friisReceivedPower(opts: {
  transmitPowerW: number
  frequencyHz: number
  rangeM: number
  /** Transmit antenna gain (linear ≥ 0). Default 1. */
  gainTx?: number
  /** Receive antenna gain (linear ≥ 0). Default 1. */
  gainRx?: number
}): {
  wavelengthM: number
  pathGain: number
  receivedPowerW: number
  ok: boolean
} {
  const { transmitPowerW: Pt, frequencyHz: f, rangeM: R, gainTx: Gt = 1, gainRx: Gr = 1 } = opts
  const bad = { wavelengthM: NaN, pathGain: NaN, receivedPowerW: NaN, ok: false }
  if (
    ![Pt, f, R, Gt, Gr].every(Number.isFinite) ||
    Pt < 0 ||
    !(f > 0) ||
    !(R > 0) ||
    Gt < 0 ||
    Gr < 0
  ) {
    return bad
  }
  const lambda = C0 / f
  const pathGain = (lambda / (4 * Math.PI * R)) ** 2
  const Pr = Pt * Gt * Gr * pathGain
  const ok = Number.isFinite(Pr) && Pr >= 0
  return { wavelengthM: lambda, pathGain, receivedPowerW: Pr, ok }
}

/**
 * RF energy-harvest DC after conjugate match + rectifier:
 *   P_available = (1 − |Γ|²) · P_inc   (power delivered past mismatch)
 *   P_dc = η_rect · P_available
 * |Γ| ∈ [0,1]; η_rect ∈ [0,1]. Teaching upper bound — no diode threshold model.
 */
export function rfRectifierDcPower(opts: {
  incidentPowerW: number
  /** Reflection magnitude |Γ|; 0 = perfect match. */
  gammaMag?: number
  /** Rectifier RF→DC efficiency. */
  etaRect: number
}): {
  matchFactor: number
  availableRfW: number
  dcPowerW: number
  ok: boolean
} {
  const { incidentPowerW: Pin, gammaMag = 0, etaRect } = opts
  const bad = { matchFactor: NaN, availableRfW: NaN, dcPowerW: NaN, ok: false }
  if (
    ![Pin, gammaMag, etaRect].every(Number.isFinite) ||
    Pin < 0 ||
    gammaMag < 0 ||
    gammaMag > 1 ||
    etaRect < 0 ||
    etaRect > 1
  ) {
    return bad
  }
  const matchFactor = 1 - gammaMag * gammaMag
  const availableRfW = matchFactor * Pin
  const dcPowerW = etaRect * availableRfW
  return { matchFactor, availableRfW, dcPowerW, ok: Number.isFinite(dcPowerW) && dcPowerW >= 0 }
}

export type RfEhSelfPowerInput = {
  transmitPowerW: number
  frequencyHz: number
  rangeM: number
  gainTx?: number
  gainRx?: number
  /** |Γ| at harvester port. Default 0. */
  gammaMag?: number
  etaRect: number
  node: Omit<NodeBudgetInput, 'harvestPowerW' | 'extraContinuousLoadW'>
  /** Optional extra RF tax on the *node* TX path (separate from EH match). */
  rf?: EdgeSelfPowerChainInput['rf']
}

/**
 * T11 claim chain: Friis P_r → match×rectifier DC → edge self-power cover.
 * Ambient for the chain is received RF power; η is matchFactor · η_rect so
 * usable = η · P_r = P_dc.
 */
export function composeRfEhSelfPower(input: RfEhSelfPowerInput): {
  friis: ReturnType<typeof friisReceivedPower>
  rect: ReturnType<typeof rfRectifierDcPower>
  usableDcW: number
  chain: EdgeSelfPowerChainResult
  ok: boolean
} {
  const friis = friisReceivedPower({
    transmitPowerW: input.transmitPowerW,
    frequencyHz: input.frequencyHz,
    rangeM: input.rangeM,
    gainTx: input.gainTx,
    gainRx: input.gainRx,
  })
  if (!friis.ok) {
    return {
      friis,
      rect: { matchFactor: NaN, availableRfW: NaN, dcPowerW: NaN, ok: false },
      usableDcW: NaN,
      chain: computeEdgeSelfPowerChain({ harvest: { ambientPowerW: 0, eta: 0 }, node: input.node, rf: input.rf }),
      ok: false,
    }
  }
  const rect = rfRectifierDcPower({
    incidentPowerW: friis.receivedPowerW,
    gammaMag: input.gammaMag,
    etaRect: input.etaRect,
  })
  if (!rect.ok) {
    return {
      friis,
      rect,
      usableDcW: NaN,
      chain: computeEdgeSelfPowerChain({ harvest: { ambientPowerW: 0, eta: 0 }, node: input.node, rf: input.rf }),
      ok: false,
    }
  }
  // η_eff = P_dc / P_r = matchFactor · η_rect (0 when P_r=0)
  const etaEff =
    friis.receivedPowerW > 0 ? rect.dcPowerW / friis.receivedPowerW : 0
  const chain = computeEdgeSelfPowerChain({
    harvest: { ambientPowerW: friis.receivedPowerW, eta: etaEff },
    node: input.node,
    rf: input.rf,
  })
  return {
    friis,
    rect,
    usableDcW: rect.dcPowerW,
    chain,
    ok: chain.ok && Math.abs(chain.harvest.usableHarvestPowerW - rect.dcPowerW) < 1e-12 * Math.max(1, rect.dcPowerW),
  }
}

/**
 * Self-check sample for registry / research targets T4–T11.
 */
export function runResearch2026ClaimsSample(): {
  landauerMono: boolean
  minAmbientOk: boolean
  tegCarnotOk: boolean
  tegCoverOk: boolean
  edpOk: boolean
  sParamOk: boolean
  acousticOk: boolean
  betzOk: boolean
  sqOk: boolean
  rfEhOk: boolean
  fuelCellOk: boolean
  photonSnrOk: boolean
  heatExergyOk: boolean
  radarSnrOk: boolean
  johnsonOk: boolean
  wienOk: boolean
  fsplOk: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RESEARCH_2026
  familyId: typeof METHOD_RESEARCH_2026
} {
  // T4: higher bit rate → higher power floor; 300K 1 bit/s = kT ln2
  const p1 = landauerBitRatePowerFloor(1, 300)
  const p1k = landauerBitRatePowerFloor(1e3, 300)
  const landauerMono =
    Number.isFinite(p1) &&
    p1k > p1 &&
    Math.abs(p1 - KB * 300 * Math.LN2) < 1e-30

  // T5a: inverse ambient
  const load = 20e-6
  const eta = 0.25
  const ambMin = minAmbientForSelfPower({ avgLoadPowerW: load, eta })
  const minAmbientOk =
    Math.abs(ambMin - load / eta) < 1e-18 &&
    ambMin * eta >= load - 1e-18

  // T5b: TEG ≤ Carnot, ZT helps
  const lowZ = tegUsableElectricalPower({ Th: 350, Tc: 300, ZT: 0.5, heatInputW: 0.1 })
  const hiZ = tegUsableElectricalPower({ Th: 350, Tc: 300, ZT: 2, heatInputW: 0.1 })
  const tegCarnotOk =
    lowZ.ok &&
    hiZ.ok &&
    lowZ.belowCarnot &&
    hiZ.belowCarnot &&
    hiZ.etaTE > lowZ.etaTE &&
    hiZ.usableElectricalW > lowZ.usableElectricalW

  // T5c: large heat + good ZT covers micro node; tiny heat does not
  const node = {
    sleepCurrentA: 2e-6,
    activeCurrentA: 5e-3,
    activeTimeS: 0.05,
    periodS: 60,
    supplyVoltageV: 3,
    batteryCapacityAh: 0.22,
    targetLifetimeS: 10 * 365.25 * 24 * 3600,
  }
  const cover = composeTegSelfPower({
    teg: { Th: 340, Tc: 300, ZT: 1.2, heatInputW: 5e-3 },
    node,
  })
  const short = composeTegSelfPower({
    teg: { Th: 310, Tc: 300, ZT: 0.3, heatInputW: 50e-6 },
    node,
  })
  const tegCoverOk =
    cover.ok &&
    cover.chain.harvestCoversLoad &&
    short.ok &&
    !short.chain.harvestCoversLoad

  // T6 EDP
  const edpLo = edgeInferenceEdp({ nOps: 1e6, C: 1e-15, V: 0.5, fHz: 1e8 })
  const edpHi = edgeInferenceEdp({ nOps: 1e6, C: 1e-15, V: 1.0, fHz: 1e8 })
  const edpOk = edpLo.ok && edpHi.ok && edpHi.E_inf > edpLo.E_inf && edpHi.EDP > edpLo.EDP

  // T7 S-param
  const sOk = sParamPowerBound({ s11: 0.2, s21: Math.sqrt(1 - 0.04) })
  const sBad = sParamPowerBound({ s11: 0.9, s21: 0.9 })
  const sParamOk = sOk.ok && sOk.unitaryFwd && !sBad.passiveOk

  // T8 acoustic
  const ac = acousticPiezoReceive({ Z1: 1.5e6, Z2: 1.5e6, incidentPowerW: 1e-3, etaPiezo: 0.1 })
  const acMis = acousticPiezoReceive({ Z1: 1.5e6, Z2: 30e6, incidentPowerW: 1e-3, etaPiezo: 0.1 })
  const acousticOk =
    ac.ok &&
    ac.R < 1e-12 &&
    acMis.ok &&
    acMis.R > 0.5 &&
    acMis.P_rx < ac.P_rx

  // T9 Betz
  const betz = composeBetzSelfPower({
    rho: 1.2,
    area: 0.05,
    v: 8,
    Cp: BETZ_MAX,
    etaElec: 0.7,
    node,
  })
  const betzOver = composeBetzSelfPower({
    rho: 1.2,
    area: 0.05,
    v: 8,
    Cp: 0.9, // above Betz
    etaElec: 0.7,
    node,
  })
  const betzOk = betz.ok && betz.belowBetz && !betzOver.belowBetz && betz.P_ext <= betz.P_kin * BETZ_MAX + 1e-9

  // T10 SQ solar
  const sq = composeSqSelfPower({ Eg_eV: 1.1, solarPowerW: 0.05, node })
  const sqTiny = composeSqSelfPower({ Eg_eV: 1.1, solarPowerW: 20e-6, node })
  const sqOk = sq.ok && sq.etaSQ > 0.2 && sq.etaSQ < 0.45 && sqTiny.ok && !sqTiny.chain.harvestCoversLoad

  // T11 Friis RF-EH: near + high Pt covers micro node; far/weak does not; 1/R² path
  const rfNear = composeRfEhSelfPower({
    transmitPowerW: 1,
    frequencyHz: 915e6,
    rangeM: 0.3,
    etaRect: 0.5,
    gammaMag: 0,
    node,
  })
  const rfFar = composeRfEhSelfPower({
    transmitPowerW: 0.01,
    frequencyHz: 915e6,
    rangeM: 20,
    etaRect: 0.5,
    gammaMag: 0,
    node,
  })
  const pathRatio =
    friisReceivedPower({ transmitPowerW: 1, frequencyHz: 2.4e9, rangeM: 2 }).receivedPowerW /
    friisReceivedPower({ transmitPowerW: 1, frequencyHz: 2.4e9, rangeM: 1 }).receivedPowerW
  const rfEhOk =
    rfNear.ok &&
    rfFar.ok &&
    rfNear.chain.harvestCoversLoad &&
    !rfFar.chain.harvestCoversLoad &&
    Math.abs(pathRatio - 0.25) < 1e-9

  // T12 fuel cell: η_stack ≤ η_rev; standard Nernst ≈ E0
  const Estd = fuelCellStandardNernst()
  const fcFull = fuelCellStackEfficiency({
    nCells: 100,
    ENernst: Estd,
    VCell: 0.7,
    util: 0.9,
  })
  const fcOver = fuelCellStackEfficiency({
    nCells: 1,
    ENernst: Estd,
    VCell: Estd * 1.1, // illegal teaching > OCV
    util: 1,
  })
  const fuelCellOk =
    fcFull.ok &&
    fcFull.belowRevLimit &&
    fcFull.etaStack < fcFull.etaRev &&
    !fcOver.ok &&
    Math.abs(Estd - E0_H2_O2) < 1e-9

  // T13 photon SNR: √N Poisson; dark noise reduces SNR
  const snrShot = photonCountSnr({ signalPhotons: 100, qe: 1 })
  const snrDark = photonCountSnr({ signalPhotons: 100, darkPhotons: 100, qe: 1 })
  const photonSnrOk =
    snrShot.ok &&
    snrShot.shotLimited &&
    Math.abs(snrShot.snr - 10) < 1e-9 &&
    snrDark.ok &&
    snrDark.snr < snrShot.snr

  // T14 heat exergy: η_ex = 1 − T0/Th; W ≤ η_ex Q
  const hex = heatExergyUsableWork({ heatJ: 100, Th: 600, T0: 300, etaConv: 0.5 })
  const hexBad = heatExergyFactor(300, 300)
  const heatExergyOk =
    hex.ok &&
    Math.abs(hex.etaEx - 0.5) < 1e-12 &&
    Math.abs(hex.Wmax - 50) < 1e-12 &&
    Math.abs(hex.W - 25) < 1e-12 &&
    hex.belowExergyLimit &&
    !hexBad.ok

  // T15 radar SNR ∝ 1/R^4
  const r1 = radarEquationSnr({
    transmitPowerW: 1e3,
    gainTx: 100,
    gainRx: 100,
    wavelengthM: 0.1,
    rcsM2: 1,
    rangeM: 1e3,
  })
  const r2 = radarEquationSnr({
    transmitPowerW: 1e3,
    gainTx: 100,
    gainRx: 100,
    wavelengthM: 0.1,
    rcsM2: 1,
    rangeM: 2e3,
  })
  const radarSnrOk =
    r1.ok &&
    r2.ok &&
    r1.snr > r2.snr &&
    Math.abs(r1.snr / r2.snr - 16) < 1e-6

  // T16 Johnson–Nyquist: P = kTB; V ∝ √R
  const jnP = johnsonNyquistNoisePower(300, 1e6)
  const jnV1 = johnsonNyquistVoltageRms(300, 50, 1e6)
  const jnV4 = johnsonNyquistVoltageRms(300, 200, 1e6)
  const johnsonOk =
    jnP.ok &&
    Math.abs(jnP.powerW - KB * 300 * 1e6) < 1e-30 &&
    jnV1.ok &&
    jnV4.ok &&
    Math.abs(jnV4.vRms / jnV1.vRms - 2) < 1e-9

  // T17 Wien: λ T = b
  const wSun = wienDisplacementPeakWavelength(5772)
  const tBack = wienDisplacementTemperature(wSun.lambdaMaxM)
  const wienOk =
    wSun.ok &&
    tBack.ok &&
    Math.abs(wSun.lambdaMaxM * 5772 - WIEN_B) < 1e-15 &&
    Math.abs(tBack.T - 5772) < 1e-6

  // T18 FSPL +6 dB per distance doubling
  const L1 = freeSpacePathLossDb({ distanceM: 1e3, frequencyHz: 1e9 })
  const L2 = freeSpacePathLossDb({ distanceM: 2e3, frequencyHz: 1e9 })
  const fsplOk =
    L1.ok &&
    L2.ok &&
    Math.abs(L2.fsplDb - L1.fsplDb - 20 * Math.log10(2)) < 1e-9

  const ok =
    landauerMono &&
    minAmbientOk &&
    tegCarnotOk &&
    tegCoverOk &&
    edpOk &&
    sParamOk &&
    acousticOk &&
    betzOk &&
    sqOk &&
    rfEhOk &&
    fuelCellOk &&
    photonSnrOk &&
    heatExergyOk &&
    radarSnrOk &&
    johnsonOk &&
    wienOk &&
    fsplOk

  return {
    landauerMono,
    minAmbientOk,
    tegCarnotOk,
    tegCoverOk,
    edpOk,
    sParamOk,
    acousticOk,
    betzOk,
    sqOk,
    rfEhOk,
    fuelCellOk,
    photonSnrOk,
    heatExergyOk,
    radarSnrOk,
    johnsonOk,
    wienOk,
    fsplOk,
    ok,
    methodId: METHOD_ALGO_RESEARCH_2026,
    familyId: METHOD_RESEARCH_2026,
  }
}
