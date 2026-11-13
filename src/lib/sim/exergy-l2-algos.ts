/**
 * 㶲分析二级 · 卡诺循环效率随热源温度 + Gouy–Stodola 损失功玩具。
 * W_lost = T₀ · S_gen；导入 lib/exergy 的 thermalExergyFactor / pathExergy。
 * method id 仅常量，不改 methods.data。
 */
import {
  T0,
  thermalExergyFactor,
  pathExergy,
  type ExergyHop,
} from '../exergy'

export { T0, thermalExergyFactor, pathExergy }

/** 父族 · 㶲分析。 */
export const EXERGY_L2_PARENT = 'method-exergy-analysis'

/** 二级 · Gouy–Stodola 损失功 / 卡诺对照。 */
export const METHOD_ALGO_EXERGY_LOST_WORK = 'method-algo-exergy-lost-work'

export const EXERGY_L2_METHOD_IDS = [METHOD_ALGO_EXERGY_LOST_WORK] as const

/**
 * 理想卡诺热机效率 η_C = 1 − T_c/T_h（T 用绝对温标）。
 * T_h ≤ T_c 时为 0。
 */
export function carnotEfficiency(T_h: number, T_c: number = T0): number {
  if (!(T_h > 0) || !(T_c > 0) || T_h <= T_c) return 0
  return 1 - T_c / T_h
}

/**
 * 与 thermalExergyFactor 对齐：死态 T_c = T₀ 时 η_C = φ_thermal(T_h)。
 */
export function carnotMatchesThermalFactor(T_h: number): boolean {
  const eta = carnotEfficiency(T_h, T0)
  const phi = thermalExergyFactor(T_h)
  return Math.abs(eta - phi) < 1e-12
}

/**
 * Gouy–Stodola：不可逆过程损失功 W_lost = T₀ · S_gen（J，教学标量）。
 * S_gen ≥ 0；可逆极限 S_gen→0 ⇒ W_lost→0。
 */
export function gouyStodolaLostWork(S_gen: number, T_env: number = T0): number {
  if (!(T_env > 0)) throw new Error('T_env must be positive')
  if (!Number.isFinite(S_gen) || S_gen < 0) {
    throw new Error('S_gen must be finite and ≥ 0')
  }
  return T_env * S_gen
}

/**
 * 热机玩具：从热源吸 Q_h，以效率 η 做功；熵产来自「实际 η 低于卡诺」的废热差额。
 * 可逆：η = η_C，S_gen = 0。
 * 不可逆：W_actual = η Q_h，W_rev = η_C Q_h，
 *   W_lost = W_rev − W_actual = T₀ S_gen
 *   ⇒ S_gen = (η_C − η) Q_h / T₀  （η ≤ η_C）
 */
export function heatEngineEntropyGen(
  Q_h: number,
  T_h: number,
  eta: number,
  T_c: number = T0,
): {
  etaCarnot: number
  W_actual: number
  W_rev: number
  W_lost: number
  S_gen: number
  Q_c: number
} {
  const etaCarnot = carnotEfficiency(T_h, T_c)
  const etaClamped = Math.max(0, Math.min(eta, etaCarnot))
  const W_actual = etaClamped * Q_h
  const W_rev = etaCarnot * Q_h
  const W_lost = W_rev - W_actual
  const S_gen = T_c > 0 ? W_lost / T_c : 0
  const Q_c = Q_h - W_actual
  return { etaCarnot, W_actual, W_rev, W_lost, S_gen, Q_c }
}

/**
 * 代表样例：
 * - 卡诺效率随 T_h 升高而升高，且 = thermalExergyFactor(T_h)
 * - 不可逆热机 W_lost = T₀ S_gen（Gouy–Stodola）
 * - 可逆极限 lost work → 0
 * - pathExergy 热→功路径暴露品位损失
 */
export function runExergyLostWorkSample(
  opts: {
    T_h?: number
    T_h_hi?: number
    Q_h?: number
    /** 实际热机效率（须 ≤ 卡诺） */
    etaActual?: number
  } = {},
): {
  T0: number
  T_h: number
  T_h_hi: number
  etaCarnot: number
  etaCarnotHi: number
  /** η(T_h) 随热源升温而增大 */
  carnotMonotone: boolean
  /** η_C(T_h) ≡ φ_thermal(T_h) */
  matchesPhi: boolean
  phi: number
  Q_h: number
  etaActual: number
  W_actual: number
  W_rev: number
  W_lost: number
  S_gen: number
  /** Gouy–Stodola 恒等式 |W_lost − T₀ S_gen| */
  gouyResidual: number
  /** 可逆：η=η_C 时 W_lost≈0 */
  W_lost_rev: number
  pathEnergyEff: number
  pathUsableWorkOut: number
  pathExergyEff: number
  methodId: typeof METHOD_ALGO_EXERGY_LOST_WORK
  familyId: typeof EXERGY_L2_PARENT
} {
  const T_h = opts.T_h ?? 600
  const T_h_hi = opts.T_h_hi ?? 900
  const Q_h = opts.Q_h ?? 1000
  const etaCarnot = carnotEfficiency(T_h, T0)
  const etaCarnotHi = carnotEfficiency(T_h_hi, T0)
  const etaActual = opts.etaActual ?? 0.35 * etaCarnot // 约为卡诺的 35%

  const irr = heatEngineEntropyGen(Q_h, T_h, etaActual, T0)
  const rev = heatEngineEntropyGen(Q_h, T_h, etaCarnot, T0)
  const W_lost_gs = gouyStodolaLostWork(irr.S_gen, T0)

  const formOf = (id: string) => id
  const hops: ExergyHop[] = [
    { eff: Math.min(etaActual, 0.99), from: 'thermal', to: 'mechanical' },
  ]
  const pe = pathExergy(hops, formOf)

  return {
    T0,
    T_h,
    T_h_hi,
    etaCarnot,
    etaCarnotHi,
    carnotMonotone: etaCarnotHi > etaCarnot,
    matchesPhi: carnotMatchesThermalFactor(T_h),
    phi: thermalExergyFactor(T_h),
    Q_h,
    etaActual: irr.W_actual / Q_h,
    W_actual: irr.W_actual,
    W_rev: irr.W_rev,
    W_lost: irr.W_lost,
    S_gen: irr.S_gen,
    gouyResidual: Math.abs(irr.W_lost - W_lost_gs),
    W_lost_rev: rev.W_lost,
    pathEnergyEff: pe.energyEff,
    pathUsableWorkOut: pe.usableWorkOut,
    pathExergyEff: pe.exergyEff,
    methodId: METHOD_ALGO_EXERGY_LOST_WORK,
    familyId: EXERGY_L2_PARENT,
  }
}
