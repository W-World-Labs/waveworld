import { describe, expect, it } from 'vitest'
import {
  landauerBitRatePowerFloor,
  landauerBitsEnergy,
  minAmbientForSelfPower,
  tegUsableElectricalPower,
  composeTegSelfPower,
  edgeInferenceEdp,
  sParamPowerBound,
  acousticPiezoReceive,
  composeBetzSelfPower,
  composeSqSelfPower,
  friisReceivedPower,
  rfRectifierDcPower,
  composeRfEhSelfPower,
  fuelCellStackEfficiency,
  fuelCellStandardNernst,
  photonCountSnr,
  heatExergyFactor,
  heatExergyUsableWork,
  radarEquationSnr,
  johnsonNyquistNoisePower,
  johnsonNyquistVoltageRms,
  wienDisplacementPeakWavelength,
  wienDisplacementTemperature,
  freeSpacePathLossDb,
  runResearch2026ClaimsSample,
  METHOD_ALGO_RESEARCH_2026,
  H2_HHV_J_PER_MOL,
} from './research2026Calcs'
import { KB } from './physics/constants'
import { E0_H2_O2, F_FARADAY } from './sim/fuelcell-algos'
import { BETZ_MAX } from './physics/limits'
import { WIEN_B } from './sim/stefan-boltzmann-algos'
import { fsplDb } from './sim/fspl-algos'
import { computeEdgeSelfPowerChain } from './edgeSelfPowerChain'
import { computeDetectorFoM, BLIP_DSTAR_JONES } from './module-graph/sensing'
import { thermoelectricEfficiency, carnotEfficiency } from './physics/limits'

describe('2026 research claims · T1 edge self-power cover (existing chain)', () => {
  it('usable harvest above load ⇒ cover; below ⇒ shortfall', () => {
    const node = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
      targetLifetimeS: 1e8,
    }
    const cover = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 200e-6, eta: 0.3 },
      node,
    })
    const short = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: 10e-6, eta: 0.2 },
      node,
    })
    expect(cover.ok && cover.harvestCoversLoad).toBe(true)
    expect(short.ok && !short.harvestCoversLoad).toBe(true)
    expect(cover.harvest.usableHarvestPowerW).toBeGreaterThan(cover.avgLoadPowerW)
    expect(short.harvest.usableHarvestPowerW).toBeLessThan(short.avgLoadPowerW)
  })
})

describe('2026 research claims · T2 detector D* vs BLIP (existing FoM)', () => {
  it('NEP/D* identity and BLIP veto for impossible claims', () => {
    // Realistic-ish: NEP = Sn/ℜ; D* = √(AΔf)/NEP stays under teaching BLIP
    const fom = computeDetectorFoM({
      responsivity: 0.5, // A/W
      noiseSpectralDensity: 1e-9, // A/√Hz → NEP = 2e-9 W/√Hz
      area: 0.01,
      bandwidth: 100,
    })
    expect(fom.NEP).toBeCloseTo(2e-9, 20)
    expect(fom.Dstar).toBeCloseTo(Math.sqrt(0.01 * 100) / 2e-9, 5)
    expect(fom.exceedsBLIP).toBe(false)
    expect(fom.Dstar).toBeLessThan(BLIP_DSTAR_JONES)

    // Insanely good responsivity → exceeds BLIP teaching ceiling
    const crazy = computeDetectorFoM({
      responsivity: 1e6,
      noiseSpectralDensity: 1e-15,
      area: 1,
      bandwidth: 1e6,
    })
    expect(crazy.exceedsBLIP).toBe(true)
    expect(crazy.Dstar).toBeGreaterThan(BLIP_DSTAR_JONES)
  })
})

describe('2026 research claims · T3 thermoelectric ZT ceiling (existing limits)', () => {
  it('η_TE ≤ Carnot and rises with ZT', () => {
    const Th = 360
    const Tc = 300
    const e0 = thermoelectricEfficiency(0.4, Tc, Th)
    const e1 = thermoelectricEfficiency(1.5, Tc, Th)
    const car = carnotEfficiency(Tc, Th)
    expect(e0).toBeLessThan(e1)
    expect(e1).toBeLessThanOrEqual(car + 1e-12)
    expect(e0).toBeLessThan(car)
  })
})

describe('2026 research claims · T4 Landauer bit-rate power floor (gap fill)', () => {
  it('P_min = R·kT·ln2; mono in R and T', () => {
    const p = landauerBitRatePowerFloor(1e6, 300) // 1 Mbit/s
    expect(p).toBeCloseTo(1e6 * KB * 300 * Math.LN2, 20)
    expect(landauerBitRatePowerFloor(2e6, 300)).toBeCloseTo(2 * p, 20)
    expect(landauerBitRatePowerFloor(1e6, 600)).toBeCloseTo(2 * p, 20)
    // 1 bit energy equals 1 bit/s power × 1 s
    expect(landauerBitsEnergy(1, 300)).toBeCloseTo(landauerBitRatePowerFloor(1, 300), 30)
  })

  it('real radios sit far above Landauer floor (order-of-magnitude claim)', () => {
    // 1 mW continuous radio ≫ Landauer for 1 kbit/s at 300K
    const floor = landauerBitRatePowerFloor(1e3, 300)
    expect(1e-3).toBeGreaterThan(floor * 1e10)
  })
})

describe('2026 research claims · T5 min ambient + TEG→chain (gap fill)', () => {
  it('minAmbientForSelfPower inverts η·P_amb ≥ load', () => {
    const load = 18.5e-6
    const eta = 0.25
    const amb = minAmbientForSelfPower({ avgLoadPowerW: load, eta })
    expect(amb).toBeCloseTo(load / eta, 15)
    // Feeding that ambient into the chain with same η should cover (no RF)
    const node = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
    }
    // Use slightly more than min for numerical margin on duty avg
    const chain = computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: amb * 1.05, eta },
      node,
    })
    expect(chain.ok).toBe(true)
    expect(chain.harvestCoversLoad).toBe(true)
  })

  it('tegUsableElectricalPower: Pe=η·Qh, η≤Carnot', () => {
    const r = tegUsableElectricalPower({ Th: 350, Tc: 300, ZT: 1, heatInputW: 0.05 })
    expect(r.ok).toBe(true)
    expect(r.belowCarnot).toBe(true)
    expect(r.usableElectricalW).toBeCloseTo(r.etaTE * 0.05, 12)
    expect(r.etaTE).toBeLessThanOrEqual(r.etaCarnot + 1e-12)
  })

  it('composeTegSelfPower covers micro node with enough heat/ZT', () => {
    const node = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
      targetLifetimeS: 1e8,
    }
    const cover = composeTegSelfPower({
      teg: { Th: 340, Tc: 300, ZT: 1.5, heatInputW: 2e-3 },
      node,
    })
    expect(cover.ok).toBe(true)
    expect(cover.chain.harvestCoversLoad).toBe(true)
    expect(cover.chain.harvest.usableHarvestPowerW).toBeCloseTo(
      cover.teg.usableElectricalW,
      10,
    )

    const short = composeTegSelfPower({
      teg: { Th: 305, Tc: 300, ZT: 0.2, heatInputW: 30e-6 },
      node,
    })
    expect(short.ok).toBe(true)
    expect(short.chain.harvestCoversLoad).toBe(false)
  })

  it('runResearch2026ClaimsSample ok', () => {
    const s = runResearch2026ClaimsSample()
    expect(s.methodId).toBe(METHOD_ALGO_RESEARCH_2026)
    expect(s.ok).toBe(true)
    expect(s.landauerMono).toBe(true)
    expect(s.tegCoverOk).toBe(true)
    expect(s.edpOk).toBe(true)
    expect(s.sParamOk).toBe(true)
    expect(s.acousticOk).toBe(true)
    expect(s.betzOk).toBe(true)
    expect(s.sqOk).toBe(true)
  })
})

describe('2026 research claims · T6–T10 expansion', () => {
  it('T6 edgeInferenceEdp: E∝V², EDP grows with V at fixed f', () => {
    const a = edgeInferenceEdp({ nOps: 1e5, C: 2e-15, V: 0.6, fHz: 5e7 })
    const b = edgeInferenceEdp({ nOps: 1e5, C: 2e-15, V: 1.2, fHz: 5e7 })
    expect(a.ok && b.ok).toBe(true)
    expect(b.E_op / a.E_op).toBeCloseTo(4, 10)
    expect(b.EDP).toBeGreaterThan(a.EDP)
    expect(a.t_d).toBeCloseTo(b.t_d, 12)
  })

  it('T7 sParamPowerBound: unitary lossless; over-unity rejected', () => {
    const u = sParamPowerBound({ s11: 0, s21: 1 })
    expect(u.passiveOk && u.unitaryFwd).toBe(true)
    const lossy = sParamPowerBound({ s11: 0.1, s21: 0.5 })
    expect(lossy.passiveOk).toBe(true)
    expect(lossy.unitaryFwd).toBe(false)
    expect(sParamPowerBound({ s11: 0.8, s21: 0.8 }).passiveOk).toBe(false)
  })

  it('T8 acousticPiezoReceive: R+T=1; match maximizes P_rx', () => {
    const m = acousticPiezoReceive({ Z1: 1.48e6, Z2: 1.48e6, incidentPowerW: 2e-3, etaPiezo: 0.2 })
    expect(m.ok && m.energyConserved).toBe(true)
    expect(m.R).toBeCloseTo(0, 12)
    expect(m.P_rx).toBeCloseTo(0.2 * 2e-3, 12)
    const hard = acousticPiezoReceive({ Z1: 1.48e6, Z2: 40e6, incidentPowerW: 2e-3, etaPiezo: 0.2 })
    expect(hard.ok).toBe(true)
    expect(hard.R + hard.T).toBeCloseTo(1, 12)
    expect(hard.P_rx).toBeLessThan(m.P_rx)
  })

  it('T9 composeBetzSelfPower: Cp≤Betz; cover with enough wind', () => {
    const node = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
    }
    const okCp = composeBetzSelfPower({
      rho: 1.225,
      area: 0.1,
      v: 10,
      Cp: BETZ_MAX,
      etaElec: 0.75,
      node,
    })
    expect(okCp.belowBetz).toBe(true)
    expect(okCp.P_ext / okCp.P_kin).toBeCloseTo(BETZ_MAX, 10)
    expect(okCp.chain.harvestCoversLoad).toBe(true)

    const over = composeBetzSelfPower({
      rho: 1.225,
      area: 0.1,
      v: 10,
      Cp: 0.8,
      etaElec: 0.75,
      node,
    })
    expect(over.belowBetz).toBe(false)
  })

  it('T10 composeSqSelfPower: SQ η in (0,0.45); large solar covers micro node', () => {
    const node = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
    }
    const r = composeSqSelfPower({ Eg_eV: 1.12, solarPowerW: 0.1, node })
    expect(r.ok).toBe(true)
    expect(r.etaSQ).toBeGreaterThan(0.25)
    expect(r.etaSQ).toBeLessThan(0.45)
    expect(r.chain.harvestCoversLoad).toBe(true)
  })

  it('T11 Friis: Pr ∝ 1/R² and ∝ 1/f²; invalid inputs → !ok', () => {
    const a = friisReceivedPower({ transmitPowerW: 1, frequencyHz: 2.4e9, rangeM: 1 })
    const b = friisReceivedPower({ transmitPowerW: 1, frequencyHz: 2.4e9, rangeM: 2 })
    expect(a.ok && b.ok).toBe(true)
    expect(b.receivedPowerW / a.receivedPowerW).toBeCloseTo(0.25, 12)
    const hiF = friisReceivedPower({ transmitPowerW: 1, frequencyHz: 4.8e9, rangeM: 1 })
    expect(hiF.receivedPowerW / a.receivedPowerW).toBeCloseTo(0.25, 12)
    expect(friisReceivedPower({ transmitPowerW: 1, frequencyHz: 0, rangeM: 1 }).ok).toBe(false)
  })

  it('T11 rectifier: |Γ| and η cut DC; composeRfEhSelfPower cover near vs far', () => {
    const pin = 1e-3
    const full = rfRectifierDcPower({ incidentPowerW: pin, gammaMag: 0, etaRect: 0.4 })
    const mis = rfRectifierDcPower({ incidentPowerW: pin, gammaMag: 0.5, etaRect: 0.4 })
    expect(full.ok && mis.ok).toBe(true)
    expect(full.dcPowerW).toBeCloseTo(0.4 * pin, 12)
    expect(mis.dcPowerW).toBeCloseTo(0.4 * (1 - 0.25) * pin, 12)

    const node = {
      sleepCurrentA: 2e-6,
      activeCurrentA: 5e-3,
      activeTimeS: 0.05,
      periodS: 60,
      supplyVoltageV: 3,
      batteryCapacityAh: 0.22,
    }
    const near = composeRfEhSelfPower({
      transmitPowerW: 1,
      frequencyHz: 915e6,
      rangeM: 0.3,
      etaRect: 0.5,
      node,
    })
    const far = composeRfEhSelfPower({
      transmitPowerW: 0.01,
      frequencyHz: 915e6,
      rangeM: 20,
      etaRect: 0.5,
      node,
    })
    expect(near.ok && far.ok).toBe(true)
    expect(near.chain.harvestCoversLoad).toBe(true)
    expect(far.chain.harvestCoversLoad).toBe(false)
  })

  it('runResearch2026ClaimsSample includes T11–T18', () => {
    const s = runResearch2026ClaimsSample()
    expect(s.rfEhOk).toBe(true)
    expect(s.fuelCellOk).toBe(true)
    expect(s.photonSnrOk).toBe(true)
    expect(s.heatExergyOk).toBe(true)
    expect(s.radarSnrOk).toBe(true)
    expect(s.johnsonOk).toBe(true)
    expect(s.wienOk).toBe(true)
    expect(s.fsplOk).toBe(true)
    expect(s.ok).toBe(true)
    expect(s.methodId).toBe(METHOD_ALGO_RESEARCH_2026)
  })

  it('T17 Wien λ_max T = b and inverse T', () => {
    const w = wienDisplacementPeakWavelength(300)
    expect(w.ok).toBe(true)
    expect(w.lambdaMaxM * 300).toBeCloseTo(WIEN_B, 12)
    const t = wienDisplacementTemperature(w.lambdaMaxM)
    expect(t.ok).toBe(true)
    expect(t.T).toBeCloseTo(300, 9)
    expect(wienDisplacementPeakWavelength(0).ok).toBe(false)
  })

  it('T18 freeSpacePathLossDb matches fsplDb and +6 dB per 2× distance', () => {
    const a = freeSpacePathLossDb({ distanceM: 500, frequencyHz: 2.4e9 })
    const b = freeSpacePathLossDb({ distanceM: 1000, frequencyHz: 2.4e9 })
    expect(a.ok && b.ok).toBe(true)
    expect(a.fsplDb).toBeCloseTo(fsplDb(500, 2.4e9), 12)
    expect(b.fsplDb - a.fsplDb).toBeCloseTo(20 * Math.log10(2), 12)
  })

  it('T16 Johnson–Nyquist P=kTB and V∝√R', () => {
    const p = johnsonNyquistNoisePower(290, 1e6)
    expect(p.ok).toBe(true)
    expect(p.powerW).toBeCloseTo(KB * 290 * 1e6, 20)
    const v50 = johnsonNyquistVoltageRms(290, 50, 1e6)
    const v200 = johnsonNyquistVoltageRms(290, 200, 1e6)
    expect(v50.ok && v200.ok).toBe(true)
    expect(v200.vRms / v50.vRms).toBeCloseTo(2, 12)
    expect(johnsonNyquistNoisePower(0, 1e6).ok).toBe(false)
  })

  it('T15 radarEquationSnr scales as 1/R^4', () => {
    const a = radarEquationSnr({
      transmitPowerW: 500,
      gainTx: 50,
      gainRx: 50,
      wavelengthM: 0.03,
      rcsM2: 2,
      rangeM: 5e3,
      systemTempK: 290,
      bandwidthHz: 1e6,
      loss: 1,
    })
    const b = radarEquationSnr({
      transmitPowerW: 500,
      gainTx: 50,
      gainRx: 50,
      wavelengthM: 0.03,
      rcsM2: 2,
      rangeM: 10e3,
      systemTempK: 290,
      bandwidthHz: 1e6,
      loss: 1,
    })
    expect(a.ok && b.ok).toBe(true)
    expect(a.snr / b.snr).toBeCloseTo(16, 9)
    expect(radarEquationSnr({ transmitPowerW: 1, wavelengthM: 0.1, rcsM2: 1, rangeM: 0 }).ok).toBe(
      false,
    )
  })

  it('T14 heatExergyFactor matches Carnot form; usable work ≤ η_ex Q', () => {
    const f = heatExergyFactor(600, 300)
    expect(f.ok).toBe(true)
    expect(f.etaEx).toBeCloseTo(0.5, 12)
    const w = heatExergyUsableWork({ heatJ: 200, Th: 400, T0: 300, etaConv: 0.8 })
    expect(w.ok).toBe(true)
    expect(w.etaEx).toBeCloseTo(0.25, 12)
    expect(w.Wmax).toBeCloseTo(50, 12)
    expect(w.W).toBeCloseTo(40, 12)
    expect(w.W).toBeLessThanOrEqual(w.Wmax)
    expect(heatExergyFactor(250, 300).ok).toBe(false)
  })

  it('T12 fuelCellStackEfficiency: η_stack ≤ η_rev; η_rev = nFE/ΔH', () => {
    const E = fuelCellStandardNernst()
    expect(E).toBeCloseTo(E0_H2_O2, 9)
    const r = fuelCellStackEfficiency({ nCells: 50, ENernst: E, VCell: 0.65, util: 0.85 })
    expect(r.ok).toBe(true)
    expect(r.etaStack).toBeLessThanOrEqual(r.etaRev + 1e-12)
    expect(r.etaRev).toBeCloseTo((2 * F_FARADAY * E) / H2_HHV_J_PER_MOL, 9)
    const illegal = fuelCellStackEfficiency({ nCells: 1, ENernst: E, VCell: E * 1.2, util: 1 })
    expect(illegal.ok).toBe(false)
  })

  it('T13 photonCountSnr: pure Poisson √N; dark/read reduce SNR', () => {
    const shot = photonCountSnr({ signalPhotons: 10_000, qe: 1 })
    expect(shot.ok && shot.shotLimited).toBe(true)
    expect(shot.snr).toBeCloseTo(100, 9)
    const dark = photonCountSnr({ signalPhotons: 10_000, darkPhotons: 10_000, qe: 1 })
    expect(dark.ok).toBe(true)
    expect(dark.snr).toBeCloseTo(10_000 / Math.sqrt(20_000), 9)
    expect(dark.snr).toBeLessThan(shot.snr)
    expect(photonCountSnr({ signalPhotons: -1 }).ok).toBe(false)
  })
})
