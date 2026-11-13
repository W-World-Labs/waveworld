/**
 * 格子玻尔兹曼二级算法 · D1Q3 BGK 碰撞 + 迁移。
 * 质量守恒；可选非零宏观速度平衡。method id 仅常量，不改 methods.data。
 */

/** 父族（与 methods.data 中 lattice-boltzmann 对齐）。 */
export const LBM_L2_PARENT = 'method-lattice-boltzmann'

/** 一级 · D1Q3 完整步进（碰撞+迁移）。 */
export const LBM_L2_D1Q3_ID = 'method-algo-lbm-d1q3'

/**
 * 二级 · BGK 碰撞原子（仅常量，不写 methods.data）。
 */
export const LBM_L2_BGK_COLLIDE_ID = 'method-algo-lbm-bgk-collide'

/** 二级 · Guo 外力源项（主 id）。 */
export const LBM_L2_GUO_FORCE_ID = 'method-algo-lbm-guo-force'

/** 目录并立 id（与 method-algo-lbm-force-guo 同核）。 */
export const LBM_L2_FORCE_GUO_ID = 'method-algo-lbm-force-guo'

export const LBM_L2_METHOD_IDS = [
  LBM_L2_D1Q3_ID,
  LBM_L2_BGK_COLLIDE_ID,
  LBM_L2_GUO_FORCE_ID,
  LBM_L2_FORCE_GUO_ID,
] as const

/** D1Q3 离散速度 e = {−1, 0, +1}。 */
export const D1Q3_E = [-1, 0, 1] as const

/** D1Q3 权重 w = {1/6, 2/3, 1/6}。 */
export const D1Q3_W = [1 / 6, 2 / 3, 1 / 6] as const

/** 分布 f[q][i]，q=0..2 对应 e={−1,0,+1}。 */
export type LbmD1q3State = Float64Array[]

/** 分配 Nx 格点的 D1Q3 分布（零）。 */
export function createD1q3(Nx: number): LbmD1q3State {
  return [new Float64Array(Nx), new Float64Array(Nx), new Float64Array(Nx)]
}

/**
 * 局部平衡 feq_q = w_q · ρ · (1 + 3 e_q u + (9/2)(e_q u)² − (3/2) u²)
 * （D1Q3 标准二阶展开；u=0 时退化为 w·ρ）。
 */
export function feqD1q3(rho: number, u: number, q: number): number {
  const e = D1Q3_E[q]!
  const eu = e * u
  return D1Q3_W[q]! * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u * u)
}

/** 格点宏观密度 ρ = Σ_q f_q。 */
export function densityAt(f: LbmD1q3State, i: number): number {
  return f[0]![i]! + f[1]![i]! + f[2]![i]!
}

/** 格点宏观动量 j = Σ_q e_q f_q；u = j/ρ（ρ=0 时 u=0）。 */
export function velocityAt(f: LbmD1q3State, i: number): number {
  const j = -f[0]![i]! + f[2]![i]!
  const rho = densityAt(f, i)
  return rho === 0 ? 0 : j / rho
}

/** 全场总质量 Σ_i ρ_i。 */
export function totalMass(f: LbmD1q3State): number {
  const Nx = f[0]!.length
  let m = 0
  for (let i = 0; i < Nx; i++) m += densityAt(f, i)
  return m
}

/**
 * 以给定密度场（及可选均匀/局部速度）初始化为局部平衡。
 * uField 缺省则 u≡0。
 */
export function initEquilibrium(
  f: LbmD1q3State,
  rho: ArrayLike<number>,
  uField?: ArrayLike<number>,
): void {
  const Nx = f[0]!.length
  for (let i = 0; i < Nx; i++) {
    const r = rho[i]!
    const u = uField ? uField[i]! : 0
    for (let q = 0; q < 3; q++) f[q]![i] = feqD1q3(r, u, q)
  }
}

/**
 * BGK 碰撞（原地）：f ← f + ω (f^eq − f)，ω = 1/τ。
 * 用当前格点 (ρ,u) 重建平衡；τ≤0 抛错。
 */
export function bgkCollide(f: LbmD1q3State, tau: number): void {
  if (!(tau > 0)) throw new Error('tau must be positive')
  const omega = 1 / tau
  const Nx = f[0]!.length
  for (let i = 0; i < Nx; i++) {
    const rho = densityAt(f, i)
    const u = velocityAt(f, i)
    for (let q = 0; q < 3; q++) {
      const feq = feqD1q3(rho, u, q)
      f[q]![i]! += omega * (feq - f[q]![i]!)
    }
  }
}

/**
 * 周期迁移（stream）：f_q(x) → f_q(x + e_q)。
 * 不修改入参；返回新分布。
 */
export function streamPeriodic(f: LbmD1q3State): LbmD1q3State {
  const Nx = f[0]!.length
  const out = createD1q3(Nx)
  for (let q = 0; q < 3; q++) {
    const e = D1Q3_E[q]!
    for (let i = 0; i < Nx; i++) {
      const j = (((i + e) % Nx) + Nx) % Nx
      out[q]![j] = f[q]![i]!
    }
  }
  return out
}

/** 单步：BGK 碰撞 + 周期迁移。返回新状态。 */
export function stepD1q3(f: LbmD1q3State, tau: number): LbmD1q3State {
  // 碰撞原地写 f 的拷贝，保持入参只读语义
  const cur: LbmD1q3State = [
    new Float64Array(f[0]!),
    new Float64Array(f[1]!),
    new Float64Array(f[2]!),
  ]
  bgkCollide(cur, tau)
  return streamPeriodic(cur)
}

/** 中心高斯密度峰，均值约 1 + A。 */
export function gaussianDensity(Nx: number, amp = 0.5, sigma = 3): Float64Array {
  const rho = new Float64Array(Nx)
  const mid = Nx / 2
  for (let i = 0; i < Nx; i++) {
    const x = i - mid
    rho[i] = 1 + amp * Math.exp(-(x * x) / (2 * sigma * sigma))
  }
  return rho
}

/**
 * BGK 碰撞样例：初值非平衡（均匀 ρ 但 f 偏置），碰撞后逼近 feq，质量守恒。
 * methodId → method-algo-lbm-bgk-collide。
 */
export function runLbmBkgSample(
  Nx = 32,
  tau = 1,
): {
  mass0: number
  massF: number
  massErr: number
  /** 碰撞前 Σ|f−feq| */
  nonEq0: number
  /** 碰撞后 Σ|f−feq|（应显著下降） */
  nonEqF: number
  relaxed: boolean
  methodId: typeof LBM_L2_BGK_COLLIDE_ID
} {
  const f = createD1q3(Nx)
  // 人为非平衡：q=2 超载、q=0 欠载，ρ 仍≈1
  for (let i = 0; i < Nx; i++) {
    f[0]![i] = D1Q3_W[0]! * 0.5
    f[1]![i] = D1Q3_W[1]!
    f[2]![i] = D1Q3_W[2]! * 1.5 + 0.05 * Math.sin((2 * Math.PI * i) / Nx)
  }
  // 归一使平均密度≈1
  const mRaw = totalMass(f)
  const scale = Nx / mRaw
  for (let q = 0; q < 3; q++) for (let i = 0; i < Nx; i++) f[q]![i]! *= scale

  const nonEq = (state: LbmD1q3State) => {
    let s = 0
    for (let i = 0; i < Nx; i++) {
      const rho = densityAt(state, i)
      const u = velocityAt(state, i)
      for (let q = 0; q < 3; q++) s += Math.abs(state[q]![i]! - feqD1q3(rho, u, q))
    }
    return s
  }

  const mass0 = totalMass(f)
  const nonEq0 = nonEq(f)
  bgkCollide(f, tau)
  const massF = totalMass(f)
  const nonEqF = nonEq(f)

  return {
    mass0,
    massF,
    massErr: Math.abs(massF - mass0),
    nonEq0,
    nonEqF,
    relaxed: nonEqF < nonEq0 * 0.5,
    methodId: LBM_L2_BGK_COLLIDE_ID,
  }
}

/**
 * 完整 D1Q3 流场样例：高斯密度峰 + 可选均匀平流 u0，碰撞–迁移若干步。
 * 质量守恒；u0=0 时尖峰摊平；u0≠0 时超额密度质心沿 +x 漂移
 * （短时步内可追踪；长时扩散后峰摊平，COM 仅作参考）。
 * methodId → method-algo-lbm-d1q3。
 */
export function runLbmStreamSample(
  steps = 40,
  tau = 1,
  u0 = 0,
  Nx = 32,
): {
  mass0: number
  massF: number
  massErr: number
  rhoMid0: number
  rhoMidF: number
  /** 超额密度 (ρ−⟨ρ⟩) 质心（格点坐标）初末 */
  com0: number
  comF: number
  /** 有平流时 com 应沿 +x 增加（周期意义下用有符号最短位移） */
  comDrift: number
  /** 平均宏观速度（末态） */
  uMean: number
  peakedFlattened: boolean
  methodId: typeof LBM_L2_D1Q3_ID
} {
  const rho0 = gaussianDensity(Nx, 0.5, 3)
  const uField = new Float64Array(Nx)
  uField.fill(u0)
  let f = createD1q3(Nx)
  initEquilibrium(f, rho0, uField)

  /** 周期盒上超额密度 ρ−ρ̄ 的相位质心（格点坐标）。 */
  const com = (state: LbmD1q3State) => {
    const rhoBar = totalMass(state) / Nx
    let cx = 0
    let sy = 0
    let wSum = 0
    for (let i = 0; i < Nx; i++) {
      const w = Math.max(0, densityAt(state, i) - rhoBar)
      const th = (2 * Math.PI * i) / Nx
      cx += w * Math.cos(th)
      sy += w * Math.sin(th)
      wSum += w
    }
    if (wSum === 0) return Nx / 2
    let ang = Math.atan2(sy, cx)
    if (ang < 0) ang += 2 * Math.PI
    return (ang / (2 * Math.PI)) * Nx
  }

  const mass0 = totalMass(f)
  const rhoMid0 = densityAt(f, Nx >> 1)
  const com0 = com(f)

  for (let t = 0; t < steps; t++) f = stepD1q3(f, tau)

  const massF = totalMass(f)
  const rhoMidF = densityAt(f, Nx >> 1)
  const comF = com(f)
  // 周期最短漂移
  let comDrift = comF - com0
  if (comDrift > Nx / 2) comDrift -= Nx
  if (comDrift < -Nx / 2) comDrift += Nx

  let uMean = 0
  for (let i = 0; i < Nx; i++) uMean += velocityAt(f, i)
  uMean /= Nx

  return {
    mass0,
    massF,
    massErr: Math.abs(massF - mass0),
    rhoMid0,
    rhoMidF,
    com0,
    comF,
    comDrift,
    uMean,
    peakedFlattened: u0 === 0 ? rhoMidF < rhoMid0 : true,
    methodId: LBM_L2_D1Q3_ID,
  }
}

/**
 * Guo 外力离散（D1Q3，Δt=1，c_s²=1/3）：
 * F_q = w_q (1 − 1/(2τ)) [ 3(e_q − u) + 9 e_q (e_q u) ] F_body
 * （1D 标量体力 F_body；保证 Σ_q F_q = 0，动量注入与体力同向）。
 */
export function guoForceD1q3(
  rho: number,
  u: number,
  Fbody: number,
  tau: number,
): [number, number, number] {
  if (!(tau > 0)) throw new Error('guoForceD1q3: tau must be positive')
  // rho 未直接进入 Guo 一阶力项；保留接口以便扩展 / 半力速度修正调用方使用
  void rho
  const pref = 1 - 1 / (2 * tau)
  const out: [number, number, number] = [0, 0, 0]
  for (let q = 0; q < 3; q++) {
    const e = D1Q3_E[q]!
    const bracket = 3 * (e - u) + 9 * e * (e * u)
    out[q] = D1Q3_W[q]! * pref * bracket * Fbody
  }
  return out
}

/** Σ_q F_q（应≈0，外力不注质量）。 */
export function guoForceMassSum(Fq: ArrayLike<number>): number {
  let s = 0
  for (let q = 0; q < Fq.length; q++) s += Fq[q]!
  return s
}

/** Σ_q e_q F_q（动量注入速率）。 */
export function guoForceMomentumSum(Fq: ArrayLike<number>): number {
  let s = 0
  for (let q = 0; q < Fq.length; q++) s += D1Q3_E[q]! * Fq[q]!
  return s
}

/**
 * Guo 力项样例：均匀 ρ、u 与体力 F；质量源为 0，动量源与 F 同号且与 (1−1/2τ) 成比。
 * methodId → method-algo-lbm-guo-force。
 */
export function runLbmGuoForceSample(opts?: {
  rho?: number
  u?: number
  Fbody?: number
  tau?: number
}): {
  rho: number
  u: number
  Fbody: number
  tau: number
  Fq: [number, number, number]
  massSource: number
  momentumSource: number
  massConserved: boolean
  momentumAligned: boolean
  methodId: typeof LBM_L2_GUO_FORCE_ID
} {
  const rho = opts?.rho ?? 1
  const u = opts?.u ?? 0.05
  const Fbody = opts?.Fbody ?? 1e-3
  const tau = opts?.tau ?? 1
  const Fq = guoForceD1q3(rho, u, Fbody, tau)
  const massSource = guoForceMassSum(Fq)
  const momentumSource = guoForceMomentumSum(Fq)
  return {
    rho,
    u,
    Fbody,
    tau,
    Fq,
    massSource,
    momentumSource,
    massConserved: Math.abs(massSource) < 1e-12,
    momentumAligned: momentumSource * Fbody > 0,
    methodId: LBM_L2_GUO_FORCE_ID,
  }
}
