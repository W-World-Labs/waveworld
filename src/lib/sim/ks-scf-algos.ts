/**
 * Kohn–Sham SCF 教学玩具 · 密度混合残差范数。
 * 对应 method-algo-ks-scf；挂 method-dft-electronic 族。
 * 非真实 KS-DFT：用简单非线性映射模拟「输出密度」，线性混合迭代。
 */
import { METHOD_DFT_ELECTRONIC } from './research-algos'

/** 父族 · 电子 DFT。 */
export const KS_SCF_PARENT = METHOD_DFT_ELECTRONIC

/** 子算法 · KS-SCF 密度混合残差。 */
export const KS_SCF_ID = 'method-algo-ks-scf'

/** 子算法 · LDA 交换能密度桩（Dirac / Slater）。 */
export const LDA_EXCHANGE_ID = 'method-algo-lda-exchange'

/** 目录并立桩 id（与 lda-exchange 同核）。 */
export const LDA_EXCHANGE_STUB_ID = 'method-algo-exchange-lda-stub'

/**
 * Dirac–Slater 交换预因子 C_x = (3/4)(3/π)^{1/3}，
 * ε_x[ρ] = −C_x ρ^{1/3}，v_x = δ(ρ ε_x)/δρ = −(4/3) C_x ρ^{1/3}。
 */
export const LDA_CX = (3 / 4) * Math.pow(3 / Math.PI, 1 / 3)

/**
 * 玩具「KS 映射」：ρ_out[i] ∝ √ρ_in[i] + ε 正弦调制后归一化为 N_elec。
 * 固定点附近光滑；初值偏离时残差可下降。
 */
export function toyKsMap(rhoIn: Float64Array, nElec: number): Float64Array {
  const n = rhoIn.length
  const out = new Float64Array(n)
  let s = 0
  for (let i = 0; i < n; i++) {
    const r = Math.max(rhoIn[i]!, 0)
    const mod = 0.05 * Math.sin((2 * Math.PI * i) / n)
    out[i] = Math.sqrt(r + 1e-12) + 0.1 + mod
    if (out[i]! < 0) out[i] = 0
    s += out[i]!
  }
  if (s <= 0) throw new Error('toyKsMap: non-positive density sum')
  const scale = nElec / s
  for (let i = 0; i < n; i++) out[i]! *= scale
  return out
}

/** L2 残差 ‖ρ_out − ρ_in‖₂。 */
export function densityResidualNorm(rhoIn: ArrayLike<number>, rhoOut: ArrayLike<number>): number {
  if (rhoIn.length !== rhoOut.length) throw new Error('length mismatch')
  let s = 0
  for (let i = 0; i < rhoIn.length; i++) {
    const d = rhoOut[i]! - rhoIn[i]!
    s += d * d
  }
  return Math.sqrt(s)
}

/**
 * 简单密度混合一步：ρ_next = α ρ_out + (1−α) ρ_in。
 */
export function densityMix(
  rhoIn: Float64Array,
  rhoOut: Float64Array,
  alpha: number,
): Float64Array {
  if (!(alpha > 0 && alpha <= 1)) throw new Error('alpha in (0,1]')
  const n = rhoIn.length
  const next = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    next[i] = alpha * rhoOut[i]! + (1 - alpha) * rhoIn[i]!
  }
  return next
}

/**
 * 代表样例：均匀初密度 → 若干次混合 SCF；残差应下降且电荷守恒。
 */
export function runKsScfSample(opts?: {
  n?: number
  nElec?: number
  alpha?: number
  steps?: number
}): {
  n: number
  nElec: number
  alpha: number
  steps: number
  residual0: number
  residualF: number
  residualDecreased: boolean
  chargeErr: number
  methodId: typeof KS_SCF_ID
  familyId: typeof KS_SCF_PARENT
} {
  const n = opts?.n ?? 16
  const nElec = opts?.nElec ?? 1
  const alpha = opts?.alpha ?? 0.35
  const steps = opts?.steps ?? 12
  let rho = new Float64Array(n)
  // 初值：轻微偏斜均匀
  for (let i = 0; i < n; i++) rho[i] = nElec / n + 0.02 * Math.cos((2 * Math.PI * i) / n)
  // 归一
  let s0 = 0
  for (let i = 0; i < n; i++) s0 += rho[i]!
  for (let i = 0; i < n; i++) rho[i]! *= nElec / s0

  const out0 = toyKsMap(rho, nElec)
  const residual0 = densityResidualNorm(rho, out0)

  for (let t = 0; t < steps; t++) {
    const rhoOut = toyKsMap(rho, nElec)
    rho = new Float64Array(densityMix(rho, rhoOut, alpha))
    // 再归一电荷
    let s = 0
    for (let i = 0; i < n; i++) s += rho[i]!
    for (let i = 0; i < n; i++) rho[i]! *= nElec / s
  }
  const outF = toyKsMap(rho, nElec)
  const residualF = densityResidualNorm(rho, outF)
  let charge = 0
  for (let i = 0; i < n; i++) charge += rho[i]!
  return {
    n,
    nElec,
    alpha,
    steps,
    residual0,
    residualF,
    residualDecreased: residualF < residual0,
    chargeErr: Math.abs(charge - nElec),
    methodId: KS_SCF_ID,
    familyId: KS_SCF_PARENT,
  }
}

/** 交换能密度 ε_x(ρ) = −C_x ρ^{1/3}（ρ>0）。 */
export function ldaExchangeEnergyDensity(rho: number): number {
  if (!(rho >= 0) || !Number.isFinite(rho)) {
    throw new Error('ldaExchangeEnergyDensity: rho must be finite ≥ 0')
  }
  if (rho === 0) return 0
  return -LDA_CX * Math.pow(rho, 1 / 3)
}

/** 交换势 v_x = −(4/3) C_x ρ^{1/3}。 */
export function ldaExchangePotential(rho: number): number {
  if (!(rho >= 0) || !Number.isFinite(rho)) {
    throw new Error('ldaExchangePotential: rho must be finite ≥ 0')
  }
  if (rho === 0) return 0
  return -(4 / 3) * LDA_CX * Math.pow(rho, 1 / 3)
}

/**
 * 网格上 E_x ≈ Σ ρ_i ε_x(ρ_i) Δx（1D 均匀格，Δx=1/n 域长 1）。
 * 返回能量、势样本与 v_x / ε_x = 4/3 一致性校验。
 */
export function runLdaExchangeSample(opts?: {
  n?: number
  nElec?: number
}): {
  n: number
  nElec: number
  Cx: number
  Ex: number
  /** 均匀密度 ρ=nElec 时解析 E_x = −C_x nElec^{4/3}（Δx 求和域长 1） */
  ExUniformAnalytic: number
  ExErr: number
  vxOverExRatio: number
  ratioOk: boolean
  methodId: typeof LDA_EXCHANGE_ID
  familyId: typeof KS_SCF_PARENT
} {
  const n = opts?.n ?? 32
  const nElec = opts?.nElec ?? 1
  const rho = nElec // 均匀密度，域长 1 → ∫ρ = nElec
  const dx = 1 / n
  // 均匀：每格 ρ_i = nElec（体密度），Σ ρ ε Δx = ρ ε · 1
  const ex = ldaExchangeEnergyDensity(rho)
  const vx = ldaExchangePotential(rho)
  let Ex = 0
  for (let i = 0; i < n; i++) Ex += rho * ex * dx
  const ExUniformAnalytic = -LDA_CX * Math.pow(nElec, 4 / 3)
  const ratio = ex === 0 ? 0 : vx / ex
  return {
    n,
    nElec,
    Cx: LDA_CX,
    Ex,
    ExUniformAnalytic,
    ExErr: Math.abs(Ex - ExUniformAnalytic),
    vxOverExRatio: ratio,
    ratioOk: Math.abs(ratio - 4 / 3) < 1e-12,
    methodId: LDA_EXCHANGE_ID,
    familyId: KS_SCF_PARENT,
  }
}
