/**
 * 朗肯循环 · 纯算法教学 stub。
 * 理想卡诺式热效率 η = 1 − T_c/T_h；可选过热因子抬高有效热源温度。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 朗肯循环。 */
export const METHOD_RANKINE = 'method-rankine'

/** 子算法 · 热效率（卡诺/朗肯教学）。 */
export const METHOD_ALGO_RANKINE_ETA = 'method-algo-rankine-eta'

export const RANKINE_METHOD_IDS = [METHOD_ALGO_RANKINE_ETA] as const

/**
 * 理想卡诺/朗肯教学效率：
 *   η = 1 − T_c / T_h
 *
 * T 为绝对温标 (K)。要求 T_h 严格大于 T_c 且二者均正，否则 NaN。
 * 真实朗肯 η 通常低于此上界；本 stub 用该式作理想基准。
 */
export function rankineIdealEta(T_h: number, T_c: number): number {
  if (
    !Number.isFinite(T_h) ||
    !Number.isFinite(T_c) ||
    !(T_h > 0) ||
    !(T_c > 0) ||
    !(T_h > T_c)
  ) {
    return NaN
  }
  return 1 - T_c / T_h
}

/**
 * 过热修正：有效热源温度
 *   T_h_eff = T_h · (1 + s)
 *
 * s ≥ 0 为无量纲过热因子（教学）；s=0 退化为饱和/无过热。
 * s 为负或非法温标时 NaN。
 */
export function rankineSuperheatTh(T_h: number, superheatFactor: number): number {
  if (
    !Number.isFinite(T_h) ||
    !Number.isFinite(superheatFactor) ||
    !(T_h > 0) ||
    !(superheatFactor >= 0)
  ) {
    return NaN
  }
  return T_h * (1 + superheatFactor)
}

/**
 * 带过热的教学效率：
 *   η = 1 − T_c / T_h_eff
 *   T_h_eff = T_h · (1 + s)
 *
 * s=0 时等于 rankineIdealEta(T_h, T_c)。
 */
export function rankineEtaWithSuperheat(
  T_h: number,
  T_c: number,
  superheatFactor = 0,
): number {
  const T_eff = rankineSuperheatTh(T_h, superheatFactor)
  if (!Number.isFinite(T_eff)) return NaN
  return rankineIdealEta(T_eff, T_c)
}

/**
 * 效率样例：理想 η=1−Tc/Th；过热抬升 η；Tc=Th → 非法；单调。
 */
export function runRankineEtaSample(opts?: {
  T_h?: number
  T_c?: number
  superheatFactor?: number
}): {
  T_h: number
  T_c: number
  superheatFactor: number
  etaIdeal: number
  etaSuper: number
  T_h_eff: number
  etaEqualT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RANKINE_ETA
  familyId: typeof METHOD_RANKINE
} {
  // 典型蒸汽：锅炉 ~800 K，冷凝 ~300 K
  const T_h = opts?.T_h ?? 800
  const T_c = opts?.T_c ?? 300
  const superheatFactor = opts?.superheatFactor ?? 0.15

  const etaIdeal = rankineIdealEta(T_h, T_c)
  const T_h_eff = rankineSuperheatTh(T_h, superheatFactor)
  const etaSuper = rankineEtaWithSuperheat(T_h, T_c, superheatFactor)
  // 非法：等温度
  const etaEqualT = rankineIdealEta(T_h, T_h)

  const finite =
    Number.isFinite(etaIdeal) &&
    Number.isFinite(etaSuper) &&
    Number.isFinite(T_h_eff)

  const formulaOk =
    Math.abs(etaIdeal - (1 - T_c / T_h)) < 1e-14 &&
    Math.abs(etaSuper - (1 - T_c / T_h_eff)) < 1e-14
  const boundsOk = etaIdeal > 0 && etaIdeal < 1 && etaSuper > 0 && etaSuper < 1
  const superLift = etaSuper > etaIdeal
  const equalIllegal = !Number.isFinite(etaEqualT)
  const zeroSuper =
    Math.abs(rankineEtaWithSuperheat(T_h, T_c, 0) - etaIdeal) < 1e-14

  const ok =
    finite && formulaOk && boundsOk && superLift && equalIllegal && zeroSuper

  return {
    T_h,
    T_c,
    superheatFactor,
    etaIdeal,
    etaSuper,
    T_h_eff,
    etaEqualT,
    finite,
    ok,
    methodId: METHOD_ALGO_RANKINE_ETA,
    familyId: METHOD_RANKINE,
  }
}
