// src/lib/sim/pedotpss.ts
// Phase 2 物理核心：PEDOT:PSS @ 乙醇 电荷层（屏蔽库仑 + 载流子跳跃 + 相分离）。
// 复用 md.ts 的 LJ/Verlet/PBC；总力 = LJ + 屏蔽库仑（同 {u,fOverR} 形态相加）。
// 约化单位 ε=σ=m=k_B=1，rc=2.5；ε0 吸收进可调库仑常数 kCoulomb。
import { rng } from '../mc'
import type { ParticleScene } from './particles'

/** 四类粒子。PEDOT⁺ 导电主链 / PSS⁻ 过量聚阴离子 / counterion⁺ 反离子 / ethanol 中性。 */
export type ParticleKind = 'PEDOT' | 'PSS' | 'COUNTERION' | 'ETHANOL'

export interface KindSpec { q: number; eps: number; sigma: number }

/** 物种 → {电荷 q, LJ eps/sigma}。本次 eps=sigma=1 仅以 q 区分；eps/sigma 留 Phase 3 异质化。 */
export const KIND_TABLE: Record<ParticleKind, KindSpec> = {
  PEDOT: { q: +1, eps: 1, sigma: 1 },
  PSS: { q: -1, eps: 1, sigma: 1 },
  COUNTERION: { q: +1, eps: 1, sigma: 1 },
  ETHANOL: { q: 0, eps: 1, sigma: 1 },
}

/** 渲染/判定用的数值枚举（与 KIND_TABLE 键对齐，顺序固定）。 */
export const KIND_INDEX: ParticleKind[] = ['PEDOT', 'PSS', 'COUNTERION', 'ETHANOL']

/** 代表性物种 LJ（约化到参考 σ_ref=0.355nm/ε_ref/kB=125.8K；不是经标定的聚合物力场）。
 * 来自 materials.data.json：PEDOT/PSS=OPLS 芳/磺酸 S、COUNTERION=Na⁺(Joung–Cheatham)、ETHANOL=粗粒化。
 * fidelity=qualitative（粗粒化物种映射）。 */
const SIGMA_REF_NM = 0.355, EPS_REF_K = 125.8
export const SPECIES_LJ: Record<ParticleKind, { sigmaStar: number; epsStar: number; source: string }> = {
  PEDOT: { sigmaStar: 0.355 / SIGMA_REF_NM, epsStar: 125.8 / EPS_REF_K, source: 'OPLS-AA 噻吩环 S (opls_633)；参考物种' },
  PSS: { sigmaStar: 0.355 / SIGMA_REF_NM, epsStar: 125.8 / EPS_REF_K, source: 'OPLS-AA 磺酸 S (opls_474) 代表聚阴离子' },
  COUNTERION: { sigmaStar: 0.24393 / SIGMA_REF_NM, epsStar: 44 / EPS_REF_K, source: 'Na⁺ Joung–Cheatham 2008（小离子）' },
  ETHANOL: { sigmaStar: 0.43 / SIGMA_REF_NM, epsStar: 80 / EPS_REF_K, source: '乙醇粗粒化近似（~0.43nm，溶剂珠）' },
}

/** 按 kind 数组构建 per-particle 约化 σ* 与 ε* 数组（喂 computeChargedForces 的 sigma/eps 可选参数）。 */
export function speciesSigmaEps(kind: ParticleKind[]): { sigma: Float32Array; eps: Float32Array } {
  const N = kind.length
  const sigma = new Float32Array(N), eps = new Float32Array(N)
  for (let i = 0; i < N; i++) { const s = SPECIES_LJ[kind[i]]; sigma[i] = s.sigmaStar; eps[i] = s.epsStar }
  return { sigma, eps }
}

/** Soft-core floor on r² for Coulomb (avoids 1/r and 1/r³ blow-up at near-overlap). */
const R2_MIN = 1e-8

/**
 * Debye–Hückel 屏蔽库仑成对项。
 * U_c(r) = C·exp(−r/λD)/r，C = kCoulomb·qi·qj/epsR（含符号：同号>0 斥、异号<0 吸）。
 * F = −dU/dr = C·exp(−r/λD)·(1/(λD·r) + 1/r²)，fOverR = F/r。
 * 与 ljPair 同 {u,fOverR} 约定：力向量 = fOverR·d。
 * r² 下限 R2_MIN；epsR/lambdaD 下限 1e-6（soft-core，CPU/GPU 对齐）。
 */
export function screenedCoulomb(
  r2: number, qi: number, qj: number, epsR: number, lambdaD: number, kCoulomb = 1,
): { u: number; fOverR: number } {
  if (r2 <= 0) return { u: 0, fOverR: 0 }
  const r2c = Math.max(r2, R2_MIN)
  const r = Math.sqrt(r2c)
  const epsRc = Math.max(epsR, 1e-6)
  const lambdaDc = Math.max(lambdaD, 1e-6)
  const C = (kCoulomb * qi * qj) / epsRc
  const e = Math.exp(-r / lambdaDc)
  const u = (C * e) / r
  const fOverR = C * e * (1 / (lambdaDc * r2c) + 1 / (r * r2c))
  return { u, fOverR }
}

/** 电荷层全参数：由「溶剂滑块」驱动 epsR/lambdaD；跳跃/洗出门控。 */
export interface PedotPssParams {
  kCoulomb: number; epsR: number; lambdaD: number
  hopDistMax: number; hopBeta: number; hopAttempt: number
  solvationEpsR: number; washoutBeta: number
}

/** hopRate 门控子参数：距离阈值 distMax、能量惩罚系数 beta(≈1/kT)、前因子 attempt(≤1)。 */
export interface HopParams { distMax: number; beta: number; attempt: number }

/** 载流子跳跃概率（纯函数）：dist≥distMax→0；否则 attempt·exp(−beta·max(0,dE))。 */
export function hopRate(dist: number, dE: number, params: HopParams): number {
  if (dist >= params.distMax) return 0
  const penalty = dE <= 0 ? 0 : dE
  return params.attempt * Math.exp(-params.beta * penalty)
}

/** 对单个候选跳跃做一次可种子化伯努利判定。r 为 mc.ts rng(seed) 风格的 ()=>number∈[0,1)。 */
export function tryHop(dist: number, dE: number, params: HopParams, r: () => number): boolean {
  return r() < hopRate(dist, dE, params)
}

/** 电荷层附加状态（与 MdState 平行，按粒子索引对齐）。 */
export interface ChargeState {
  kind: ParticleKind[]
  charge: Float32Array   // 当前电荷（随跳跃变化，但 Σ 守恒）
  solvated: Uint8Array   // 溶剂化标记 0/1
  baseline: Float32Array // 各粒子基线电荷（KIND_TABLE.q），跳跃供出判据
}

/** 由物种列表构造电荷态（charge 初始 = baseline = KIND_TABLE.q）。 */
export function makeChargeState(kind: ParticleKind[]): ChargeState {
  const N = kind.length
  const charge = new Float32Array(N)
  const baseline = new Float32Array(N)
  for (let i = 0; i < N; i++) { const q = KIND_TABLE[kind[i]].q; charge[i] = q; baseline[i] = q }
  return { kind, charge, solvated: new Uint8Array(N), baseline }
}

/**
 * 一次载流子跳跃扫描（CPU 侧，每若干步调一次）：对每个 charge>baseline 的 PEDOT，
 * 在 hopDistMax 内找一个 PEDOT 受体，按 tryHop 门控转移 +1（守恒）。
 * dE 近似用屏蔽库仑能量差代理（供受体邻域），教学体系用简化 dE=0（有利）+ 距离门控为主。
 * 返回 {hops, netDisplacement}（净电荷位移标量，电导代理）。
 */
export function carrierHopStep(
  pos: Float32Array, st: ChargeState, L: number, N: number, dim: number,
  params: PedotPssParams, r: () => number,
): { hops: number; netDisplacement: number } {
  const hop: HopParams = { distMax: params.hopDistMax, beta: params.hopBeta, attempt: params.hopAttempt }
  let hops = 0, netDisplacement = 0
  for (let i = 0; i < N; i++) {
    if (st.kind[i] !== 'PEDOT' || st.charge[i] <= st.baseline[i]) continue
    for (let j = 0; j < N; j++) {
      if (j === i || st.kind[j] !== 'PEDOT') continue
      let r2 = 0
      for (let k = 0; k < dim; k++) {
        let dk = pos[i * dim + k] - pos[j * dim + k]
        dk -= L * Math.round(dk / L)
        r2 += dk * dk
      }
      const dist = Math.sqrt(r2)
      // dE 简化：受体电荷越高越不利（库仑排斥代理）
      const dE = Math.max(0, st.charge[j] - st.baseline[j])
      if (tryHop(dist, dE, hop, r)) {
        st.charge[i] -= 1; st.charge[j] += 1
        hops++; netDisplacement += dist
        break // 一个供体一次只跳一次
      }
    }
  }
  return { hops, netDisplacement }
}

/** 相分离度：target 子集的最大连通簇尺寸 / target 总数 ∈ [0,1]（union-find，最小镜像）。 */
export function phaseSeparationDegree(
  pos: Float32Array, kind: ParticleKind[], L: number, N: number, dim: number,
  target: ParticleKind, rCluster: number,
): number {
  const idx: number[] = []
  for (let i = 0; i < N; i++) if (kind[i] === target) idx.push(i)
  const M = idx.length
  if (M === 0) return 0
  const parent = idx.map((_, k) => k)
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  const rc2 = rCluster * rCluster
  for (let a = 0; a < M; a++) {
    for (let b = a + 1; b < M; b++) {
      let r2 = 0
      for (let k = 0; k < dim; k++) {
        let dk = pos[idx[a] * dim + k] - pos[idx[b] * dim + k]
        dk -= L * Math.round(dk / L)
        r2 += dk * dk
      }
      if (r2 < rc2) { parent[find(a)] = find(b) }
    }
  }
  const size = new Map<number, number>()
  let maxSize = 0
  for (let a = 0; a < M; a++) { const root = find(a); const s = (size.get(root) ?? 0) + 1; size.set(root, s); if (s > maxSize) maxSize = s }
  return maxSize / M
}

/** 溶剂化洗出（纯函数）：epsR≥solvationEpsR 时把 COUNTERION/PSS 标记 solvated=1。 */
export function phaseSeparation(st: ChargeState, params: PedotPssParams): { solvated: Uint8Array; washed: number } {
  const N = st.kind.length
  const solvated = new Uint8Array(N)
  let washed = 0
  const strong = params.epsR >= params.solvationEpsR
  for (let i = 0; i < N; i++) {
    if (strong && (st.kind[i] === 'COUNTERION' || st.kind[i] === 'PSS')) { solvated[i] = 1; washed++ }
  }
  st.solvated.set(solvated)
  return { solvated, washed }
}

/** 电导代理：累计净载流子位移 / 累计时间（∝ 漂移迁移率）。time≤0 返回 0。 */
export function netCarrierDisplacementRate(cumNetDisplacement: number, elapsedTime: number): number {
  if (elapsedTime <= 0) return 0
  return cumNetDisplacement / elapsedTime
}

/**
 * 按比例生成物种数组（种子化）。配比：PEDOT 25% / PSS 40%(过量) / COUNTERION 20% / ETHANOL 15%。
 * 用 rng 洗牌使空间分布随机（晶格位由 md.ts initLattice 给定）。
 */
export function initSpecies(N: number, seed = 1): ParticleKind[] {
  const r = rng(seed)
  const nPedot = Math.max(1, Math.round(N * 0.25))
  const nPss = Math.max(1, Math.round(N * 0.40))
  const nCounter = Math.max(0, Math.round(N * 0.20))
  const kinds: ParticleKind[] = []
  for (let i = 0; i < nPedot; i++) kinds.push('PEDOT')
  for (let i = 0; i < nPss; i++) kinds.push('PSS')
  for (let i = 0; i < nCounter; i++) kinds.push('COUNTERION')
  while (kinds.length < N) kinds.push('ETHANOL')
  kinds.length = N
  // Fisher–Yates 洗牌（种子化）
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
  }
  return kinds
}

/** Demonstration input only. The particle solver does not know any of these names. */
export function pedotParticleScene(N = 400): ParticleScene {
  const kinds = initSpecies(N)
  return {
    species: KIND_INDEX.map(name => ({ name, count: kinds.filter(k => k === name).length,
      charge: KIND_TABLE[name].q, sigma: SPECIES_LJ[name].sigmaStar, epsilon: SPECIES_LJ[name].epsStar })),
    boxL: Math.sqrt(N), temperature: 0.5, thermostat: true,
    epsR: 80, lambdaD: 2, kCoulomb: 1, steps: 120, seed: 1,
  }
}
