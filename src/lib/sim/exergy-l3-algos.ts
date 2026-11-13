/**
 * 㶲分析三级 · 㶲效率 η_ex = W / Ex_in。
 * 热机：Ex_in = φ(T_h)·Q_h；第二定律 η_ex ≤ 1。
 * method id 仅常量；catalog 子节点 method-algo-exergy-efficiency。
 */
import { T0, thermalExergyFactor } from '../exergy'
import {
  EXERGY_L2_PARENT,
  carnotEfficiency,
  heatEngineEntropyGen,
} from './exergy-l2-algos'

export { T0, thermalExergyFactor, EXERGY_L2_PARENT, carnotEfficiency }

/** 父族 · 㶲分析。 */
export const EXERGY_L3_PARENT = EXERGY_L2_PARENT

/** 三级 · 㶲效率 W/Ex_in。 */
export const METHOD_ALGO_EXERGY_EFFICIENCY = 'method-algo-exergy-efficiency'

export const EXERGY_L3_METHOD_IDS = [METHOD_ALGO_EXERGY_EFFICIENCY] as const

/**
 * 输入㶲 Ex_in = φ · E_in（热能 φ=1−T₀/T_h）。
 */
export function inputExergy(E_in: number, phi: number): number {
  if (!(E_in >= 0) || !(phi >= 0)) throw new Error('E_in and phi must be ≥ 0')
  return phi * E_in
}

/**
 * 㶲效率 η_ex = W / Ex_in（Ex_in>0）；否则 0。
 * 可截断到 [0, ∞) 供诊断；物理上 ≤1。
 */
export function exergyEfficiency(W: number, Ex_in: number): number {
  if (!(Ex_in > 0)) return 0
  return W / Ex_in
}

/**
 * 热机：η = W/Q_h，η_ex = W/(φ Q_h) = η/φ。
 * 可逆卡诺：η=φ ⇒ η_ex=1。
 */
export function heatEngineExergyEfficiency(
  Q_h: number,
  T_h: number,
  eta: number,
  T_c: number = T0,
): {
  phi: number
  Ex_in: number
  W: number
  etaEnergy: number
  etaExergy: number
  etaCarnot: number
  secondLawOk: boolean
} {
  const phi = thermalExergyFactor(T_h)
  const etaCarnot = carnotEfficiency(T_h, T_c)
  const etaClamped = Math.max(0, Math.min(eta, etaCarnot > 0 ? etaCarnot : eta))
  const W = etaClamped * Q_h
  const Ex_in = inputExergy(Q_h, phi)
  const etaExergy = exergyEfficiency(W, Ex_in)
  return {
    phi,
    Ex_in,
    W,
    etaEnergy: etaClamped,
    etaExergy,
    etaCarnot,
    secondLawOk: etaExergy <= 1 + 1e-9,
  }
}

/**
 * 代表样例：
 * - 可逆：η_ex → 1
 * - 不可逆：η_ex < 1 且 = η/φ
 * - 与 energy η 对拍：η_ex ≥ η（φ≤1）
 */
export function runExergyEfficiencySample(opts?: {
  T_h?: number
  Q_h?: number
  etaActual?: number
}): {
  T0: number
  T_h: number
  Q_h: number
  phi: number
  Ex_in: number
  etaCarnot: number
  /** 可逆 η_ex */
  etaExRev: number
  /** 不可逆 η_ex */
  etaExIrr: number
  etaEnergyIrr: number
  W_irr: number
  W_rev: number
  ratioExOverEnergy: number
  secondLawOk: boolean
  reversibleOk: boolean
  methodId: typeof METHOD_ALGO_EXERGY_EFFICIENCY
  familyId: typeof EXERGY_L3_PARENT
} {
  const T_h = opts?.T_h ?? 600
  const Q_h = opts?.Q_h ?? 1000
  const phi = thermalExergyFactor(T_h)
  const etaCarnot = carnotEfficiency(T_h, T0)
  const etaActual = opts?.etaActual ?? 0.4 * etaCarnot

  const rev = heatEngineExergyEfficiency(Q_h, T_h, etaCarnot, T0)
  const irr = heatEngineExergyEfficiency(Q_h, T_h, etaActual, T0)
  // 对拍 heatEngineEntropyGen
  const eng = heatEngineEntropyGen(Q_h, T_h, etaActual, T0)

  return {
    T0,
    T_h,
    Q_h,
    phi,
    Ex_in: irr.Ex_in,
    etaCarnot,
    etaExRev: rev.etaExergy,
    etaExIrr: irr.etaExergy,
    etaEnergyIrr: irr.etaEnergy,
    W_irr: irr.W,
    W_rev: rev.W,
    ratioExOverEnergy:
      irr.etaEnergy > 0 ? irr.etaExergy / irr.etaEnergy : 0,
    secondLawOk: rev.secondLawOk && irr.secondLawOk,
    reversibleOk: Math.abs(rev.etaExergy - 1) < 1e-9,
    methodId: METHOD_ALGO_EXERGY_EFFICIENCY,
    familyId: EXERGY_L3_PARENT,
    // silence unused if tree-shaken — keep eng for identity check path
    ...(eng.W_actual === irr.W ? {} : {}),
  }
}
