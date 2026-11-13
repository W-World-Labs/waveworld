// 传感器/探测器图质（Figure of Merit）定量层。
// 采纳来源（deep-research wf_f4ad4c5c-d8b claim-group 0/2/5，high-confidence 核实）：
//  - responsivity ℜ：RMS 输出 / RMS 输入功率，单位 A/W 或 V/W。
//  - NEP（噪声等效功率）= 噪声电流(或电压)/ℜ，单位 W/√Hz；是「输出=噪声」时的入射功率。
//  - D = 1/NEP（W⁻¹）；D*（比探测率）= √(A·Δf)/NEP = ℜ·√A/Sn，单位 Jones = cm·√Hz/W，
//    归一掉探测器面积 A 与带宽 Δf，便于跨器件比较。
//  - BLIP（背景极限）D* 上限 = 1.8×10¹⁰ Jones（300K、半球视场、波长无关响应）——第一性原理天花板。
//  - QE（量子效率）是抬升 D* 的关键旋钮（把所有非背景噪声压到最低后，QE 越高 D* 越大）。
//  - FoM 条件相关：必须在同一频率/条件下测，否则 D* 估错（→ 绑 conditions）。
// 关键：能量 η 不表征测量传感器性能；measure 视角用这套 FoM（见 applications.ts sensorsFor measure 分支）。

import { KB } from '../physics/constants'

/** 单位。 */
export const JONES = 'cm·√Hz/W'             // D* 的单位（Jones）
export const NEP_UNIT = 'W/√Hz'

/** 探测器图质输入（条件绑定的器件参数）。 */
export interface DetectorFoMInput {
  responsivity: number          // ℜ，A/W 或 V/W（输出电流/电压 per 输入光功率）
  noiseSpectralDensity: number  // Sn，A/√Hz 或 V/√Hz（噪声谱密度）
  area: number                  // A，cm²（光敏面积）
  bandwidth: number             // Δf，Hz
  /** 噪声电压/电流（RMS）；若直接给 Sn 则可由 responsivity 推 NEP。 */
  noiseRMS?: number             // Vn 或 in（与 responsivity 同口径的噪声 RMS）
  quantumEfficiency?: number    // QE ∈ [0,1]
}

/** 计算结果。 */
export interface DetectorFoM {
  NEP: number                    // W/√Hz
  D: number                      // W⁻¹
  Dstar: number                  // Jones (cm·√Hz/W)
  quantumEfficiency?: number
  /** 相对 BLIP 天花板的达成度（fraction = D* / 1.8e10）。>1 表示声称值超过第一性原理上限（可疑）。 */
  blipFraction: number
  exceedsBLIP: boolean
}

/** BLIP D* 第一性原理天花板（300K、半球视场、波长无关）。源：claim-group 5。 */
export const BLIP_DSTAR_JONES = 1.8e10

/** 由器件参数算 NEP：优先 NEP = noiseRMS/ℜ，否则 NEP = Sn/ℜ。 */
export function computeNEP(inp: DetectorFoMInput): number {
  if (inp.noiseRMS != null) return inp.noiseRMS / inp.responsivity
  return inp.noiseSpectralDensity / inp.responsivity
}

/** 算全套 FoM。 */
export function computeDetectorFoM(inp: DetectorFoMInput): DetectorFoM {
  const NEP = computeNEP(inp)
  const D = 1 / NEP
  const Dstar = Math.sqrt(inp.area * inp.bandwidth) / NEP
  const blipFraction = Dstar / BLIP_DSTAR_JONES
  return {
    NEP, D, Dstar,
    quantumEfficiency: inp.quantumEfficiency,
    blipFraction,
    exceedsBLIP: blipFraction > 1 + 1e-6,
  }
}

/** D* 的另一等价式 ℜ·√A/Sn（无显式 NEP 时）。 */
export function dStarFromResponsivity(responsivity: number, area: number, noiseSpectralDensity: number): number {
  return (responsivity * Math.sqrt(area)) / noiseSpectralDensity
}

// ===== Landauer 地板（信息热力学，claim-group 3/7）=====
/** 擦除 1 bit 的最少耗散能量地板 E = kT·ln2（J）。 */
export function landauerPerBit(T: number, k: number = KB): number {
  return k * T * Math.LN2
}

/** 300K 下的 Landauer 地板（J）。≈2.87×10⁻²¹ J ≈ 0.018 eV。 */
export const LANDAUER_300K_J = landauerPerBit(300)
/** eV 转换（1 eV = 1.602176634e-19 J）。 */
export const EV_JOULE = 1.602176634e-19
/** 300K 下 Landauer 地板的 eV 值（≈0.018 eV）。 */
export const LANDAUER_300K_EV = LANDAUER_300K_J / EV_JOULE
