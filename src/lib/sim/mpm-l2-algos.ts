/**
 * MPM L2 · USL 应力/变形更新（纯算法核）。
 * 1D 线弹性：由网格速度梯度更新粒子变形梯度 F 与应力 σ。
 * USL（Update Stress Last）：F ← (1 + dt L) F，σ = E (F − 1)。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */
import { METHOD_MPM, particleNodeWeights } from './mpm-algos'

export { METHOD_MPM, particleNodeWeights }

/** 子算法 · USL 风格粒子变形/应力更新。 */
export const METHOD_ALGO_MPM_USL_STRESS = 'method-algo-mpm-usl-stress'

export const MPM_L2_METHOD_IDS = [METHOD_ALGO_MPM_USL_STRESS] as const

/** 1D 物质点（USL）：质量、位置、速度、变形梯度 F、Cauchy 应力 σ。 */
export type MpmUslParticle1d = {
  m: number
  x: number
  v: number
  /** 变形梯度（1D 标量，参考态 F=1）。 */
  F: number
  /** Cauchy 应力（1D）。 */
  sigma: number
}

/**
 * 1D 线性 hat 形函数梯度 ∂N_i/∂x：
 *   ξ = (x − x_i)/h  →  N = 1−|ξ|  (|ξ|<1)
 *   ∂N/∂x = −sign(ξ)/h  (|ξ|<1, ξ≠0)；ξ=0 时取 0（左右节点用两侧梯度）。
 *
 * 单元内粒子：iL 得 −1/h，iR 得 +1/h。
 */
export function hatWeightGrad(
  x_p: number,
  nodeIndex: number,
  h: number,
  x0 = 0,
): number {
  if (!(h > 0) || !Number.isFinite(x_p) || !Number.isFinite(x0)) return 0
  const x_i = x0 + nodeIndex * h
  const xi = (x_p - x_i) / h
  if (!Number.isFinite(xi) || Math.abs(xi) >= 1 - 1e-15) return 0
  if (Math.abs(xi) < 1e-15) return 0
  return -Math.sign(xi) / h
}

/**
 * 粒子处速度梯度 L = ∂v/∂x = Σ_i v_i ∂N_i/∂x。
 * 线性 hat：单元内 L = (v_R − v_L)/h（与常数/线性网格速度一致）。
 */
export function particleVelocityGradient1d(
  x_p: number,
  nodeVelocity: ArrayLike<number>,
  h: number,
  x0 = 0,
): number {
  const nNodes = nodeVelocity.length
  if (nNodes < 1 || !(h > 0) || !Number.isFinite(x_p)) return 0
  const { iL, iR, wL, wR } = particleNodeWeights(x_p, nNodes, h, x0)
  // 退化为单节点（边界）：梯度不可用 → 0
  if (iL === iR || (wL <= 0 && wR <= 0)) return 0
  const gL = hatWeightGrad(x_p, iL, h, x0)
  const gR = hatWeightGrad(x_p, iR, h, x0)
  // 恰在节点上 hatWeightGrad 为 0：用单元内解析 (vR−vL)/h
  if (gL === 0 && gR === 0) {
    return (nodeVelocity[iR]! - nodeVelocity[iL]!) / h
  }
  let L = 0
  if (wL > 0) L += nodeVelocity[iL]! * gL
  if (wR > 0) L += nodeVelocity[iR]! * gR
  return L
}

/**
 * USL 一步：由速度梯度更新变形梯度与线弹性应力。
 *
 *   F^{n+1} = (1 + dt · L) F^n
 *   σ = E · (F − 1)     （工程应变 e = F−1）
 *
 * 可选体积/密度缩放：J = F（1D），ρ = ρ0 / max(J, ε)。
 * 返回新状态；不修改入参粒子。
 */
export function uslUpdateStress1d(
  particle: MpmUslParticle1d,
  L: number,
  dt: number,
  E: number,
  opts?: {
    /** 参考密度；给出则返回 rho = rho0 / |F|。 */
    rho0?: number
    /** F 下限夹持，防止翻转/奇异，默认 1e-8。 */
    Fmin?: number
  },
): {
  F: number
  sigma: number
  /** 体积比 J = F（1D） */
  J: number
  rho: number | null
  strain: number
} {
  const Fmin = opts?.Fmin ?? 1e-8
  const F0 = Number.isFinite(particle.F) ? particle.F : 1
  let F = (1 + dt * L) * F0
  if (!Number.isFinite(F)) F = F0
  if (F < Fmin) F = Fmin
  const strain = F - 1
  const sigma = E * strain
  const J = F
  const rho0 = opts?.rho0
  const rho =
    rho0 !== undefined && rho0 > 0 && Number.isFinite(rho0)
      ? rho0 / Math.max(Math.abs(J), Fmin)
      : null
  return { F, sigma, J, rho, strain }
}

/**
 * 批量 USL：对每个粒子由网格速度求 L，再更新 F/σ；可选写回。
 */
export function uslUpdateParticles1d(
  particles: ReadonlyArray<MpmUslParticle1d>,
  nodeVelocity: ArrayLike<number>,
  h: number,
  dt: number,
  E: number,
  x0 = 0,
  opts?: { rho0?: number; Fmin?: number },
): MpmUslParticle1d[] {
  const out: MpmUslParticle1d[] = new Array(particles.length)
  for (let p = 0; p < particles.length; p++) {
    const part = particles[p]!
    const L = particleVelocityGradient1d(part.x, nodeVelocity, h, x0)
    const u = uslUpdateStress1d(part, L, dt, E, opts)
    out[p] = {
      m: part.m,
      x: part.x,
      v: part.v,
      F: u.F,
      sigma: u.sigma,
    }
  }
  return out
}

/**
 * 由粒子应力向网格散射内力（1D USL 力装配教学原子）：
 *   f_i ← − Σ_p V_p σ_p ∂N_i/∂x
 * V_p = V0 · F（1D 体积 = 参考长度 × F）；默认 V0=m/ρ0 或显式 V0。
 */
export function p2gInternalForce1d(
  particles: ReadonlyArray<MpmUslParticle1d>,
  nNodes: number,
  h: number,
  x0 = 0,
  opts?: {
    /** 参考体积/长度；缺省 1。 */
    V0?: number | ArrayLike<number>
  },
): Float64Array {
  const f = new Float64Array(nNodes)
  const defaultV0 = 1
  for (let p = 0; p < particles.length; p++) {
    const part = particles[p]!
    if (!Number.isFinite(part.sigma) || !Number.isFinite(part.x)) continue
    let V0 = defaultV0
    if (opts?.V0 !== undefined) {
      V0 = typeof opts.V0 === 'number' ? opts.V0 : opts.V0[p]!
    }
    if (!(V0 > 0) || !Number.isFinite(V0)) continue
    const F = Number.isFinite(part.F) && part.F > 0 ? part.F : 1
    const Vp = V0 * F
    const { iL, iR, wL, wR } = particleNodeWeights(part.x, nNodes, h, x0)
    const gL = hatWeightGrad(part.x, iL, h, x0)
    const gR = hatWeightGrad(part.x, iR, h, x0)
    // 节点上梯度为 0 时用单元解析梯度
    let dNL = gL
    let dNR = gR
    if (gL === 0 && gR === 0 && iL !== iR) {
      dNL = -1 / h
      dNR = 1 / h
    }
    if (wL > 0) f[iL]! -= Vp * part.sigma * dNL
    if (wR > 0 && iR !== iL) f[iR]! -= Vp * part.sigma * dNR
  }
  return f
}

/**
 * USL 应力样例：
 * - 均匀拉伸速度场 v=ε̇ x → L=ε̇，F 与 σ 解析可检；
 * - 刚体平移 L=0 → F、σ 不变；
 * - 线性场梯度精确。
 */
export function runMpmUslStressSample(opts?: {
  nNodes?: number
  h?: number
  x0?: number
  dt?: number
  E?: number
  /** 均匀应变率 ε̇ */
  strainRate?: number
}): {
  nParticles: number
  nNodes: number
  h: number
  dt: number
  E: number
  strainRate: number
  /** 均匀拉伸：max |F − (1+ε̇ dt)| */
  stretchFErr: number
  /** 均匀拉伸：max |σ − E·ε̇·dt|（F0=1） */
  stretchStressErr: number
  /** 刚体平移后 F 保持 1 */
  rigidFErr: number
  /** 刚体平移 σ 保持 0 */
  rigidStressErr: number
  /** 速度梯度相对解析 max |L − ε̇| */
  gradErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MPM_USL_STRESS
  familyId: typeof METHOD_MPM
} {
  const nNodes = opts?.nNodes ?? 17
  const h = opts?.h ?? 1
  const x0 = opts?.x0 ?? 0
  const dt = opts?.dt ?? 0.01
  const E = opts?.E ?? 100
  const strainRate = opts?.strainRate ?? 0.5

  // 粒子放在网格内部
  const xs = [x0 + 2.25 * h, x0 + 5.0 * h, x0 + 8.75 * h, x0 + 11.5 * h]
  const particles0: MpmUslParticle1d[] = xs.map((x) => ({
    m: 1,
    x,
    v: 0,
    F: 1,
    sigma: 0,
  }))

  // 均匀应变率：v_i = ε̇ · (x_i − x0)
  const nodeV = new Float64Array(nNodes)
  for (let i = 0; i < nNodes; i++) {
    nodeV[i] = strainRate * (x0 + i * h - x0)
  }

  let gradErr = 0
  for (const part of particles0) {
    const L = particleVelocityGradient1d(part.x, nodeV, h, x0)
    const e = Math.abs(L - strainRate)
    if (e > gradErr) gradErr = e
  }

  const updated = uslUpdateParticles1d(particles0, nodeV, h, dt, E, x0)
  const Fexact = 1 + strainRate * dt
  const sigmaExact = E * (Fexact - 1)
  let stretchFErr = 0
  let stretchStressErr = 0
  let finite = true
  for (const p of updated) {
    if (!Number.isFinite(p.F) || !Number.isFinite(p.sigma)) finite = false
    stretchFErr = Math.max(stretchFErr, Math.abs(p.F - Fexact))
    stretchStressErr = Math.max(stretchStressErr, Math.abs(p.sigma - sigmaExact))
  }

  // 刚体平移：常速度场
  const nodeVRigid = new Float64Array(nNodes)
  nodeVRigid.fill(1.25)
  const rigid = uslUpdateParticles1d(particles0, nodeVRigid, h, dt, E, x0)
  let rigidFErr = 0
  let rigidStressErr = 0
  for (const p of rigid) {
    if (!Number.isFinite(p.F) || !Number.isFinite(p.sigma)) finite = false
    rigidFErr = Math.max(rigidFErr, Math.abs(p.F - 1))
    rigidStressErr = Math.max(rigidStressErr, Math.abs(p.sigma - 0))
  }

  const ok =
    finite &&
    gradErr < 1e-12 &&
    stretchFErr < 1e-12 &&
    stretchStressErr < 1e-12 &&
    rigidFErr < 1e-12 &&
    rigidStressErr < 1e-12

  return {
    nParticles: particles0.length,
    nNodes,
    h,
    dt,
    E,
    strainRate,
    stretchFErr,
    stretchStressErr,
    rigidFErr,
    rigidStressErr,
    gradErr,
    finite,
    ok,
    methodId: METHOD_ALGO_MPM_USL_STRESS,
    familyId: METHOD_MPM,
  }
}
