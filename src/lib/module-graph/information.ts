// 信息通道第一性原理 + 信道容量（claim-group 22）+ 数据处理不等式。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 核实）：
//  - 信道容量（bit rate）是传感器信息通道的关键 FoM，由动态范围 × 带宽共同决定，
//    把传感器建模成 Gaussian 广播信道（Zook & Schroeder, arXiv:0804.0814）。
//  - Landauer：擦除 1 bit 的最少耗散 = kT·ln2（地板，非天花板）。300K≈2.9e-21 J≈0.018 eV，
//    已实验验证（2012 首次测、2016 纳磁 bit 测得 4.2e-21 J @300K，仅高于下界 44%）。
//  - 数据处理不等式：后处理不增信息，传感器链最弱环决定整体信息量。
// 这些把 module.ts 的 INFORMATION_PRINCIPLES 占位补成可计算函数。

import { KB } from '../physics/constants'

/** Shannon 信道容量 C = B·log2(1+SNR)（bit/s）。
 *  SNR 用线性比（非 dB）。传感器视为 AWGN 信道。 */
export function shannonCapacity(bandwidthHz: number, snrLinear: number): number {
  return bandwidthHz * Math.log2(1 + snrLinear)
}

/** 由动态范围（最大/最小可测之比，线性）与带宽估信息 bit-rate 容量。
 *  动态范围决定可分辨层级数 ≈ log2(dynamicRange)，再 × 带宽。粗估（claim-group 22 的口径）。 */
export function sensorBitRate(dynamicRange: number, bandwidthHz: number): number {
  return bandwidthHz * Math.log2(dynamicRange)
}

/** dB → 线性比。 */
export const dbToLinear = (db: number) => 10 ** (db / 10)

/** Landauer 擦除 1 bit 能量地板 kT·ln2（J）。 */
export function landauerEnergy(T: number, k: number = KB): number {
  return k * T * Math.LN2
}

/** 信息热力学原理（陈述性，带数值锚）。 */
export const INFORMATION_THEORY = {
  /** 后处理不增信息（传感器链 ≯ 最弱环）。 */
  dataProcessingInequality: '后处理不能增加信息：传感器链整体信息量 ≤ 最弱 ETP 环节。',
  /** 300K 下擦除 1 bit 的 Landauer 地板（J）。 */
  landauer300K_J: landauerEnergy(300),
  /** 300K 下 Landauer 地板（eV）。 */
  landauer300K_eV: landauerEnergy(300) / 1.602176634e-19,
  /** 实验测得（2016 纳磁 bit @300K，高于下界 44%）：证明下界真实可达。 */
  landauerMeasured2016_J: 4.2e-21,
} as const
