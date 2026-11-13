import { describe, it, expect } from 'vitest'
import {
  computeDetectorFoM, BLIP_DSTAR_JONES, dStarFromResponsivity,
  landauerPerBit, LANDAUER_300K_J, LANDAUER_300K_EV,
} from './sensing'
import { shannonCapacity, sensorBitRate, dbToLinear, landauerEnergy, INFORMATION_THEORY } from './information'
import { incidenceMatrix, isPInvariant, isTInvariant, isConservative, type PetriNet } from './petri'
import { crnDynamics, massActionRates, isConservationLaw, asPortHamiltonian, type ChemicalReactionNetwork } from './crn'
import { powerWithinConstraint, type SarefPowerConstraint, DATA_SOURCES } from './ontologies'
import { masonGain, forwardPaths, type SignalFlowGraph } from './signal-flow'

// ===== 案例 1：光电探测器 D* 计算与 BLIP 第一性原理上限检测（sensing）=====
describe('传感器 FoM：D* / NEP / BLIP 上限', () => {
  it('NEP = noise/ℜ；D = 1/NEP；D* = √(A·Δf)/NEP', () => {
    // ℜ=0.5 A/W，噪声 1e-12 A/√Hz，A=1 cm²，Δf=1 Hz
    const f = computeDetectorFoM({ responsivity: 0.5, noiseSpectralDensity: 1e-12, area: 1, bandwidth: 1 })
    expect(f.NEP).toBeCloseTo(2e-12, 30)        // 1e-12/0.5
    expect(f.D).toBeCloseTo(5e11, 0)
    expect(f.Dstar).toBeCloseTo(5e11, 0)         // √(1·1)/2e-12 = 5e11
  })
  it('D* 等价式 ℜ·√A/Sn 与主式一致', () => {
    expect(dStarFromResponsivity(0.5, 1, 1e-12)).toBeCloseTo(5e11, 0)
  })
  it('低于 BLIP 上限的探测器：exceedsBLIP=false', () => {
    // NEP=1e-10, A=1, Δf=1 → D*=1e10 < 1.8e10
    const f = computeDetectorFoM({ responsivity: 1, noiseSpectralDensity: 1e-10, area: 1, bandwidth: 1 })
    expect(f.Dstar).toBeCloseTo(1e10, 0)
    expect(f.exceedsBLIP).toBe(false)
    expect(f.blipFraction).toBeLessThan(1)
  })
  it('声称 D* 超 BLIP 上限 → 标记可疑（第一性原理闸门）', () => {
    // D*=5e11 > 1.8e10 → 背景极限条件下物理不可达，须标红
    const f = computeDetectorFoM({ responsivity: 0.5, noiseSpectralDensity: 1e-12, area: 1, bandwidth: 1 })
    expect(f.exceedsBLIP).toBe(true)
    expect(f.blipFraction).toBeGreaterThan(1)
  })
  it('BLIP 常量 = 1.8e10 Jones', () => {
    expect(BLIP_DSTAR_JONES).toBe(1.8e10)
  })
})

// ===== 案例 2：Landauer 信息热力学地板 =====
describe('Landauer：擦除 1 bit 的能量地板', () => {
  it('E = kT·ln2', () => {
    expect(landauerPerBit(300)).toBeCloseTo(1.380649e-23 * 300 * Math.LN2, 30)
  })
  it('300K ≈ 2.87e-21 J ≈ 0.018 eV', () => {
    expect(LANDAUER_300K_J).toBeCloseTo(2.87e-21, 2)         // 2.8709...e-21
    expect(LANDAUER_300K_EV).toBeCloseTo(0.018, 3)            // 0.01793
  })
  it('2016 纳磁实验测值 4.2e-21 J 高于下界 ~46%', () => {
    const measured = INFORMATION_THEORY.landauerMeasured2016_J
    expect(measured).toBeGreaterThan(LANDAUER_300K_J)
    expect((measured - LANDAUER_300K_J) / LANDAUER_300K_J).toBeGreaterThan(0.4)
  })
  it('landauerEnergy(information.ts) 与 sensing.ts 单一真源一致', () => {
    expect(landauerEnergy(300)).toBe(LANDAUER_300K_J)
  })
})

// ===== 案例 3：Shannon 信道容量 + 传感器 bit-rate =====
describe('信息通道容量', () => {
  it('Shannon C = B·log2(1+SNR)：B=1kHz, SNR=1023 → C=10000 bit/s', () => {
    expect(shannonCapacity(1000, 1023)).toBeCloseTo(1000 * 10, -2)   // log2(1024)=10
  })
  it('电话线经典：B=3kHz, 30dB(线性1000) → C≈30 kbit/s', () => {
    expect(shannonCapacity(3000, dbToLinear(30))).toBeCloseTo(30000, -3)
  })
  it('传感器 bit-rate = B·log2(dynamicRange)', () => {
    expect(sensorBitRate(1024, 1)).toBeCloseTo(10, 6)   // log2(1024)=10
  })
})

// ===== 案例 4：2H₂ + O₂ → 2H₂O 的 Petri 网（claim-group 11）=====
describe('Petri 网：2H₂+O₂→2H₂O 的守恒律', () => {
  // place 0=H₂, 1=O₂, 2=H₂O；transition 0=反应
  const net: PetriNet = {
    places: ['H2', 'O2', 'H2O'], transitions: ['r'],
    consumes: [{ place: 0, transition: 0, weight: 2 }, { place: 1, transition: 0, weight: 1 }],
    produces: [{ place: 2, transition: 0, weight: 2 }],
  }
  it('关联矩阵 = 化学计量矩阵 [-2,-1,+2]^T', () => {
    const Γ = incidenceMatrix(net)
    expect(Γ).toEqual([[-2], [-1], [2]])
  })
  it('P-不变量：H 守恒 [2,0,2] → Γ^T·y=0', () => {
    expect(isPInvariant(net, [2, 0, 2]).invariant).toBe(true)
  })
  it('P-不变量：O 守恒 [0,2,1] → Γ^T·y=0', () => {
    expect(isPInvariant(net, [0, 2, 1]).invariant).toBe(true)
  })
  it('非守恒向量 [1,1,1] → 不是 P-不变量', () => {
    expect(isPInvariant(net, [1, 1, 1]).invariant).toBe(false)
  })
  it('分子总数不守恒 → 不 conservative（全正 P-不变量不存在）', () => {
    // 反应把 3 分子变 2 分子，任何全正加权和都会变 → 不 conservative
    expect(isConservative(net, [1, 1, 1])).toBe(false)
  })
})

describe('Petri 网：可逆 A⇌B 的 T-不变量（稳态循环）', () => {
  // place 0=A,1=B；transition 0=A→B, 1=B→A
  const net: PetriNet = {
    places: ['A', 'B'], transitions: ['fwd', 'rev'],
    consumes: [{ place: 0, transition: 0, weight: 1 }, { place: 1, transition: 1, weight: 1 }],
    produces: [{ place: 1, transition: 0, weight: 1 }, { place: 0, transition: 1, weight: 1 }],
  }
  it('T-不变量 [1,1]：走一轮 fwd+rev 回到原态', () => {
    expect(isTInvariant(net, [1, 1]).invariant).toBe(true)
  })
  it('[1,0] 不是 T-不变量（单向不回原态）', () => {
    expect(isTInvariant(net, [1, 0]).invariant).toBe(false)
  })
})

// ===== 案例 5：CRN 动力学 + port-Hamiltonian 桥（claim-group 17）=====
describe('CRN：质量作用动力学 ẋ=S·v 与 pH 桥', () => {
  // A→B，S=[[-1],[+1]]
  const crn: ChemicalReactionNetwork = {
    species: ['A', 'B'], reactions: ['r'],
    S: [[-1], [1]], rateConstants: [0.5], gibbsPotential: [-1e3, -2e3],
  }
  it('massAction 速率 v = k·[A]', () => {
    expect(massActionRates(crn, [2, 0])).toEqual([0.5 * 2])
  })
  it('ẋ = S·v：A 减、B 增', () => {
    const dx = crnDynamics(crn, [2, 0])
    expect(dx[0]).toBeCloseTo(-1, 9)   // -1·(0.5·2)
    expect(dx[1]).toBeCloseTo(1, 9)
  })
  it('A⇌B 总量守恒律 [1,1]（S^T·y=0）', () => {
    const reversible: ChemicalReactionNetwork = {
      species: ['A', 'B'], reactions: ['fwd', 'rev'],
      S: [[-1, 1], [1, -1]],
    }
    expect(isConservationLaw(reversible, [1, 1])).toBe(true)
  })
  it('asPortHamiltonian：构造保证 isPortHamiltonian=true，effort=−S^T·μ', () => {
    const ph = asPortHamiltonian(crn, [2, 0])
    expect(ph.isPortHamiltonian).toBe(true)
    // effort = −S^T·μ = −(−1·(−1e3) + ...) ：reaction 0: −[(-1)·(-1e3) + 1·(-2e3)] = −(1e3 − 2e3) = +1e3
    expect(ph.effort[0]).toBeCloseTo(1e3, -1)
  })
})

// ===== 案例 6：SAREF4ENER 功率约束信封（claim-group 20）=====
describe('SAREF4ENER PowerConstraint', () => {
  const c: SarefPowerConstraint = { kind: 'contractual', powerW: 1000, startStep: 0, endStep: 10 }
  it('时段内、功率低于限 → 合规', () => {
    expect(powerWithinConstraint({ powerW: 800, step: 5 }, c)).toBe(true)
  })
  it('时段内、功率超限 → 违规', () => {
    expect(powerWithinConstraint({ powerW: 1200, step: 5 }, c)).toBe(false)
  })
  it('时段外不受此约束 → 合规', () => {
    expect(powerWithinConstraint({ powerW: 5000, step: 20 }, c)).toBe(true)
  })
})

// ===== 案例 7：信号流图 Mason 增益（本轮未核实项，标注）=====
describe('信号流图 Mason 增益', () => {
  it('纯链 x→y(2)→z(3)：T = 6', () => {
    const g: SignalFlowGraph = { nodes: ['x', 'y', 'z'], edges: [{ from: 'x', to: 'y', gain: 2 }, { from: 'y', to: 'z', gain: 3 }] }
    expect(masonGain(g, 'x', 'z')).toBeCloseTo(6, 9)
    expect(forwardPaths(g, 'x', 'z')).toHaveLength(1)
  })
  it('带单环 a→b(2), b→a(0.1)：T = 2/(1-0.2) = 2.5', () => {
    const g: SignalFlowGraph = { nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', gain: 2 }, { from: 'b', to: 'a', gain: 0.1 }] }
    expect(masonGain(g, 'a', 'b')).toBeCloseTo(2.5, 9)
  })
})

// ===== 数据源登记：核实状态可机读（ontologies）=====
describe('数据源 ingest 指针的核实状态', () => {
  it('OntoRXN/SAREF/EMMO 本轮已核实', () => {
    const v = DATA_SOURCES.filter((d) => d.verified).map((d) => d.name)
    expect(v).toEqual(expect.arrayContaining(['OntoRXN', 'SAREF4ENER', 'EMMO']))
  })
  it('NIST/NREL/SysML 本轮未核实（caveats 固化）', () => {
    const unv = DATA_SOURCES.filter((d) => !d.verified).map((d) => d.name)
    expect(unv).toEqual(expect.arrayContaining(['NIST thermochemistry (WebBook)', 'NREL device efficiency', 'SysML']))
  })
})
