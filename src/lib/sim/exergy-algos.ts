/**
 * 㶲 / 可用功分析 · 纯函数样例（委托 lib/exergy）。
 * method-exergy-analysis 族；不改 methods.data。
 */
import {
  thermalExergyFactor,
  exergyFactor,
  pathExergy,
  T0,
  THERMAL_DISPLAY_T,
} from '../exergy'

export const EXERGY_PARENT = 'method-exergy-analysis'
export const EXERGY_CARNOT_ID = 'method-algo-exergy-carnot'

/**
 * 代表样例：卡诺因子、各形式 φ、热→功路径㶲效率。
 */
export function runExergySample(): {
  T0: number
  carnot600: number
  carnotDisplay: number
  electric: number
  thermal: number
  chemical: number
  pathEnergyEff: number
  pathUsableWorkOut: number
  pathExergyEff: number
  methodId: typeof EXERGY_PARENT
} {
  const formOf = (id: string) => id
  const hops = [
    { eff: 0.4, from: 'thermal', to: 'mechanical' },
    { eff: 0.9, from: 'mechanical', to: 'electric' },
  ]
  const pe = pathExergy(hops, formOf)
  return {
    T0,
    carnot600: thermalExergyFactor(600),
    carnotDisplay: thermalExergyFactor(THERMAL_DISPLAY_T),
    electric: exergyFactor('electric'),
    thermal: exergyFactor('thermal'),
    chemical: exergyFactor('chemical'),
    pathEnergyEff: pe.energyEff,
    pathUsableWorkOut: pe.usableWorkOut,
    pathExergyEff: pe.exergyEff,
    methodId: EXERGY_PARENT,
  }
}

/**
 * 子算法 · 卡诺㶲因子原子 φ=1−T₀/T。
 * 校验：T≤T₀ → 0；T→∞ → 1；600K 介于其间。
 */
export function runCarnotExergySample(): {
  T0: number
  phi300: number
  phi600: number
  phiInf: number
  monotone: boolean
  methodId: typeof EXERGY_CARNOT_ID
} {
  const phi300 = thermalExergyFactor(300) // ≈T0 → ~0
  const phi600 = thermalExergyFactor(600)
  const phiInf = thermalExergyFactor(1e6)
  return {
    T0,
    phi300,
    phi600,
    phiInf,
    monotone: phi300 <= phi600 && phi600 <= phiInf,
    methodId: EXERGY_CARNOT_ID,
  }
}
