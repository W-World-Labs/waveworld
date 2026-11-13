/**
 * Monte Carlo radiative transfer · 1D slab photon random walk (toy).
 * Absorption / scattering albedo; estimate slab transmission T.
 * method id 仅常量，不改 methods.data / moduleRegistry / edges.
 */

/** 父族 · 蒙特卡洛辐射传输。 */
export const METHOD_MCRT = 'method-mcrt'

/** 子算法 · 1D slab 光子随机游走。 */
export const METHOD_ALGO_MCRT_WALK = 'method-algo-mcrt-walk'

export const MCRT_METHOD_IDS = [METHOD_ALGO_MCRT_WALK] as const

/** 父族别名（与 familyId 对齐）。 */
export const MCRT_PARENT = METHOD_MCRT

/** 确定性 RNG（mulberry32），同种子可复现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type PhotonFate = 'transmitted' | 'reflected' | 'absorbed' | 'truncated'

export type WalkResult = {
  fate: PhotonFate
  interactions: number
  pathLength: number
}

export type McrtSlabParams = {
  /** 几何厚度 L > 0 */
  L: number
  /** 吸收系数 σ_a ≥ 0 */
  sigmaA: number
  /** 散射系数 σ_s ≥ 0 */
  sigmaS: number
  /** 最大碰撞次数（防止纯散射死循环） */
  maxInteractions?: number
}

/**
 * 消光 κ = σ_a + σ_s；单反照率 ω = σ_s / κ（κ=0 时 ω=0）。
 */
export function extinction(sigmaA: number, sigmaS: number): number {
  return sigmaA + sigmaS
}

export function albedo(sigmaA: number, sigmaS: number): number {
  const k = extinction(sigmaA, sigmaS)
  return k > 0 ? sigmaS / k : 0
}

/**
 * 纯吸收、法向入射的解析透射：T = exp(−κ L)。
 * 散射为 0 时 MC 应逼近此值。
 */
export function pureAbsorptionTransmission(kappa: number, L: number): number {
  if (!(L >= 0) || !(kappa >= 0)) {
    throw new Error('pureAbsorptionTransmission: need L≥0, κ≥0')
  }
  return Math.exp(-kappa * L)
}

/**
 * 单光子 1D slab 随机游走。
 * 自 x=0、μ=+1 入射；自由程 s=−ln(ξ)/κ；
 * 碰撞处以 ω 散射（各向同性 μ′=2ξ−1）、以 1−ω 吸收；
 * x≥L 透射，x≤0 反射。
 */
export function walkPhoton1d(
  p: McrtSlabParams,
  rand: () => number,
): WalkResult {
  const L = p.L
  const sigmaA = p.sigmaA
  const sigmaS = p.sigmaS
  const maxIt = p.maxInteractions ?? 10_000
  if (!(L > 0)) throw new Error('walkPhoton1d: L must be > 0')
  if (!(sigmaA >= 0) || !(sigmaS >= 0)) {
    throw new Error('walkPhoton1d: coefficients must be ≥ 0')
  }
  const kappa = extinction(sigmaA, sigmaS)
  const omega = albedo(sigmaA, sigmaS)

  // 真空（κ=0）：无相互作用，直接透射
  if (!(kappa > 0)) {
    return { fate: 'transmitted', interactions: 0, pathLength: L }
  }

  let x = 0
  let mu = 1
  let interactions = 0
  let pathLength = 0

  for (;;) {
    // 自由程（指数分布）
    const xi = Math.max(rand(), 1e-16)
    const s = -Math.log(xi) / kappa
    const xNew = x + mu * s
    pathLength += s

    if (xNew >= L) {
      // 飞出右边界：剩余几何距离
      const ds = (L - x) / Math.abs(mu)
      pathLength += ds - s
      return { fate: 'transmitted', interactions, pathLength }
    }
    if (xNew <= 0) {
      const ds = x / Math.abs(mu)
      pathLength += ds - s
      return { fate: 'reflected', interactions, pathLength }
    }

    x = xNew
    interactions++
    if (interactions > maxIt) {
      return { fate: 'truncated', interactions, pathLength }
    }

    // 吸收 vs 散射（ω=0 时恒吸收，避免 rand=0 伪散射）
    if (!(omega > 0) || rand() >= omega) {
      return { fate: 'absorbed', interactions, pathLength }
    }
    // 各向同性散射：μ ∈ (−1,1) 均匀（避免 μ=0 停滞）
    let muNew = 2 * rand() - 1
    if (Math.abs(muNew) < 1e-12) muNew = muNew >= 0 ? 1e-12 : -1e-12
    mu = muNew
  }
}

export type TransmissionEstimate = {
  T: number
  R: number
  A: number
  truncatedFrac: number
  nPhotons: number
  transmitted: number
  reflected: number
  absorbed: number
  truncated: number
  kappa: number
  omega: number
  L: number
}

/**
 * 多样本 MC 估计 slab 透射 T、反射 R、吸收 A（截断单独计）。
 * T+R+A+truncatedFrac ≈ 1。
 */
export function estimateTransmission(
  p: McrtSlabParams,
  nPhotons: number,
  seed = 1,
): TransmissionEstimate {
  if (!(nPhotons > 0) || !Number.isFinite(nPhotons)) {
    throw new Error('estimateTransmission: nPhotons must be positive finite')
  }
  const n = Math.floor(nPhotons)
  const rand = mulberry32(seed)
  let transmitted = 0
  let reflected = 0
  let absorbed = 0
  let truncated = 0
  for (let i = 0; i < n; i++) {
    const w = walkPhoton1d(p, rand)
    if (w.fate === 'transmitted') transmitted++
    else if (w.fate === 'reflected') reflected++
    else if (w.fate === 'absorbed') absorbed++
    else truncated++
  }
  const inv = 1 / n
  return {
    T: transmitted * inv,
    R: reflected * inv,
    A: absorbed * inv,
    truncatedFrac: truncated * inv,
    nPhotons: n,
    transmitted,
    reflected,
    absorbed,
    truncated,
    kappa: extinction(p.sigmaA, p.sigmaS),
    omega: albedo(p.sigmaA, p.sigmaS),
    L: p.L,
  }
}

/**
 * 代表样例：中等光学厚度 + 部分散射的 1D slab 随机游走。
 * T 有限且 ∈ (0,1)；纯吸收 MC 逼近 exp(−κL)。
 */
export function runMcrtWalkSample(
  opts: {
    L?: number
    sigmaA?: number
    sigmaS?: number
    nPhotons?: number
    seed?: number
  } = {},
): {
  T: number
  R: number
  A: number
  truncatedFrac: number
  kappa: number
  omega: number
  L: number
  pureAbsT: number
  pureAbsMcT: number
  pureAbsErr: number
  T_in_open_unit: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MCRT_WALK
  familyId: typeof METHOD_MCRT
} {
  const L = opts.L ?? 1
  const sigmaA = opts.sigmaA ?? 0.6
  const sigmaS = opts.sigmaS ?? 0.4
  const nPhotons = opts.nPhotons ?? 4000
  const seed = opts.seed ?? 42

  const est = estimateTransmission(
    { L, sigmaA, sigmaS, maxInteractions: 20_000 },
    nPhotons,
    seed,
  )

  // 纯吸收对照（同 κ=σ_a+σ_s 但全部吸收）
  const kappa = est.kappa
  const pureAbsT = pureAbsorptionTransmission(kappa, L)
  const pureAbsMc = estimateTransmission(
    { L, sigmaA: kappa, sigmaS: 0, maxInteractions: 100 },
    Math.min(nPhotons, 6000),
    seed + 7,
  )
  const pureAbsErr = Math.abs(pureAbsMc.T - pureAbsT)

  const finite =
    Number.isFinite(est.T) &&
    Number.isFinite(est.R) &&
    Number.isFinite(est.A) &&
    Number.isFinite(pureAbsMc.T)

  const T_in_open_unit = est.T > 0 && est.T < 1

  // 有散射时 T 应 ≥ 纯吸收（路径可绕行但仍可透出，吸收更少）
  // 此处主要约束：T∈(0,1)、有限、纯吸收 MC 逼近解析、截断很少
  const ok =
    finite &&
    T_in_open_unit &&
    est.truncatedFrac < 0.02 &&
    pureAbsErr < 0.03 &&
    est.T + est.R + est.A + est.truncatedFrac > 0.99 &&
    est.T + est.R + est.A + est.truncatedFrac < 1.01

  return {
    T: est.T,
    R: est.R,
    A: est.A,
    truncatedFrac: est.truncatedFrac,
    kappa,
    omega: est.omega,
    L,
    pureAbsT,
    pureAbsMcT: pureAbsMc.T,
    pureAbsErr,
    T_in_open_unit,
    finite,
    ok,
    methodId: METHOD_ALGO_MCRT_WALK,
    familyId: METHOD_MCRT,
  }
}
