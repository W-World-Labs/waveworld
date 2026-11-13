/**
 * 格子玻尔兹曼三级 · D1Q3 反弹壁面（bounce-back）+ 可选 MRT 骨架。
 * 壁面节点反转种群 → 不可渗透、质量守恒玩具。
 * method id 仅常量，不改 methods.data / moduleRegistry。
 */
import {
  LBM_L2_PARENT,
  D1Q3_E,
  D1Q3_W,
  createD1q3,
  densityAt,
  velocityAt,
  totalMass,
  initEquilibrium,
  bgkCollide,
  type LbmD1q3State,
} from './lbm-l2-algos'

export {
  LBM_L2_PARENT,
  D1Q3_E,
  D1Q3_W,
  createD1q3,
  densityAt,
  velocityAt,
  totalMass,
  initEquilibrium,
  bgkCollide,
}
export type { LbmD1q3State }

/** 父族（与 methods.data 中 lattice-boltzmann 对齐）。 */
export const LBM_L3_PARENT = LBM_L2_PARENT

/** 三级 · 全路径 / 节点反弹边界（bounce-back）。 */
export const METHOD_ALGO_LBM_BOUNCE_BACK = 'method-algo-lbm-bounce-back'

/**
 * 三级 · MRT 碰撞骨架（教学 stub：矩空间对角松弛后反变换）。
 * 未入库；与 BGK 在 τ 等价时可退化为单松弛。
 */
export const METHOD_ALGO_LBM_MRT_STUB = 'method-algo-lbm-mrt-stub'

export const LBM_L3_METHOD_IDS = [
  METHOD_ALGO_LBM_BOUNCE_BACK,
  METHOD_ALGO_LBM_MRT_STUB,
] as const

/**
 * 静止壁面 bounce-back（节点 full-way）：
 * 反转 e=±1 后投影到 u=0：f_{+} = f_{-} = (f_{+}+f_{-})/2。
 * 质量守恒；宏观速度严格 0；静止 q=1 不变。原地修改。
 */
export function bounceBackAtWalls(
  f: LbmD1q3State,
  wallNodes: ReadonlyArray<number>,
): void {
  for (const i of wallNodes) {
    if (i < 0 || i >= f[0]!.length) continue
    const avg = 0.5 * (f[0]![i]! + f[2]![i]!)
    f[0]![i] = avg
    f[2]![i] = avg
  }
}

/**
 * 纯反转（无投影）：q=0 ↔ q=2。u → −u，质量守恒。
 */
export function reversePopulationsAt(
  f: LbmD1q3State,
  nodes: ReadonlyArray<number>,
): void {
  for (const i of nodes) {
    if (i < 0 || i >= f[0]!.length) continue
    const left = f[0]![i]!
    f[0]![i] = f[2]![i]!
    f[2]![i] = left
  }
}

/**
 * 带端点 bounce-back 的迁移（域边界反弹）：
 * f_q(x) → f_q(x+e_q)；越界则反转为 f_{−q} 留在源节点。
 * 随后端点做静止壁投影（u=0，不可渗透）。
 * 不修改入参；返回新分布。质量守恒。
 */
export function streamBounceBackEnds(f: LbmD1q3State): LbmD1q3State {
  const Nx = f[0]!.length
  if (Nx < 3) throw new Error('streamBounceBackEnds: need Nx ≥ 3')
  const out = createD1q3(Nx)

  for (let i = 0; i < Nx; i++) out[1]![i] = f[1]![i]!

  // e = −1 (q=0)：向左；越出左端 → 反弹为 e=+1
  for (let i = 0; i < Nx; i++) {
    const val = f[0]![i]!
    const j = i - 1
    if (j < 0) out[2]![i]! += val
    else out[0]![j]! += val
  }

  // e = +1 (q=2)：向右；越出右端 → 反弹为 e=−1
  for (let i = 0; i < Nx; i++) {
    const val = f[2]![i]!
    const j = i + 1
    if (j >= Nx) out[0]![i]! += val
    else out[2]![j]! += val
  }

  bounceBackAtWalls(out, [0, Nx - 1])
  return out
}

/**
 * 单步：全场 BGK 碰撞 + 端点 bounce-back 迁移。
 * 入参只读；返回新状态。
 */
export function stepD1q3BounceBack(
  f: LbmD1q3State,
  tau: number,
): LbmD1q3State {
  const cur: LbmD1q3State = [
    new Float64Array(f[0]!),
    new Float64Array(f[1]!),
    new Float64Array(f[2]!),
  ]
  bgkCollide(cur, tau)
  return streamBounceBackEnds(cur)
}

/**
 * D1Q3 MRT 碰撞 stub（原地）：
 * 矩 m = M f，松弛 m* = m − S (m − m_eq)，f ← M^{−1} m*。
 * D1Q3 标准 M：密度、动量、能量矩；S = diag(0, s_j, s_e)。
 * s_j = 1/τ 时动量松弛与 BGK 对齐；s_e 可独立。
 */
export function mrtCollideStub(
  f: LbmD1q3State,
  tau: number,
  sEnergy = 1,
): void {
  if (!(tau > 0)) throw new Error('mrtCollideStub: tau must be positive')
  const sJ = 1 / tau
  const sE = sEnergy
  const Nx = f[0]!.length
  for (let i = 0; i < Nx; i++) {
    const f0 = f[0]![i]!
    const f1 = f[1]![i]!
    const f2 = f[2]![i]!
    // m0 = ρ = f0+f1+f2
    // m1 = j  = −f0 + f2
    // m2 = e  = f0 − 2 f1 + f2  （能量型）
    const m0 = f0 + f1 + f2
    const m1 = -f0 + f2
    const m2 = f0 - 2 * f1 + f2
    const rho = m0
    const u = rho === 0 ? 0 : m1 / rho
    // 平衡矩
    const m0eq = rho
    const m1eq = rho * u
    // 能量平衡 ~ ρ(−1 + 3 u²) 的简化 stub：u=0 时 m2eq = −ρ
    const m2eq = rho * (-1 + 3 * u * u)
    // 守恒矩 m0 不松弛；m1eq≡m1 时动量亦不改；仅能量矩按 s_e 松弛
    const m0n = m0eq
    const m1n = m1 - sJ * (m1 - m1eq)
    const m2n = m2 - sE * (m2 - m2eq)
    // M^{-1}: f1=(m0−m2)/3, f0=(m0−m1−f1)/2, f2=(m0+m1−f1)/2
    const f1n = (m0n - m2n) / 3
    const f0n = (m0n - m1n - f1n) / 2
    const f2n = (m0n + m1n - f1n) / 2
    f[0]![i] = f0n
    f[1]![i] = f1n
    f[2]![i] = f2n
  }
}

/**
 * bounce-back 样例：两端壁面 D1Q3，中心高斯密度，若干步。
 * 质量守恒；壁面 |u|≈0（不可渗透）；内部密度仍有限。
 */
export function runLbmBounceBackSample(
  steps = 40,
  tau = 1,
  Nx = 32,
): {
  Nx: number
  steps: number
  mass0: number
  massF: number
  massErr: number
  massConserved: boolean
  /** 左/右壁面宏观速度绝对值 */
  uLeft: number
  uRight: number
  /** 壁面不可渗透：两端 |u| 足够小 */
  wallImpermeable: boolean
  /** 内部最大 |u|（可非零） */
  maxInteriorU: number
  finite: boolean
  methodId: typeof METHOD_ALGO_LBM_BOUNCE_BACK
  familyId: typeof LBM_L3_PARENT
} {
  if (Nx < 5) throw new Error('runLbmBounceBackSample: Nx ≥ 5')
  const rho = new Float64Array(Nx)
  const mid = (Nx - 1) / 2
  for (let i = 0; i < Nx; i++) {
    const x = i - mid
    rho[i] = 1 + 0.4 * Math.exp(-(x * x) / (2 * 3 * 3))
  }
  // 壁面密度钉在 1，速度 0 平衡
  rho[0] = 1
  rho[Nx - 1] = 1

  let f = createD1q3(Nx)
  initEquilibrium(f, rho)
  bounceBackAtWalls(f, [0, Nx - 1])

  const mass0 = totalMass(f)
  for (let t = 0; t < steps; t++) f = stepD1q3BounceBack(f, tau)
  const massF = totalMass(f)
  const massErr = Math.abs(massF - mass0)

  const uLeft = Math.abs(velocityAt(f, 0))
  const uRight = Math.abs(velocityAt(f, Nx - 1))
  let maxInteriorU = 0
  let finite = Number.isFinite(mass0) && Number.isFinite(massF)
  for (let i = 0; i < Nx; i++) {
    const u = velocityAt(f, i)
    const r = densityAt(f, i)
    if (!Number.isFinite(u) || !Number.isFinite(r)) finite = false
    if (i > 0 && i < Nx - 1) {
      const au = Math.abs(u)
      if (au > maxInteriorU) maxInteriorU = au
    }
  }

  const wallImpermeable = uLeft < 1e-12 && uRight < 1e-12
  const massConserved = massErr / Math.max(mass0, 1e-30) < 1e-10

  return {
    Nx,
    steps,
    mass0,
    massF,
    massErr,
    massConserved,
    uLeft,
    uRight,
    wallImpermeable,
    maxInteriorU,
    finite,
    methodId: METHOD_ALGO_LBM_BOUNCE_BACK,
    familyId: LBM_L3_PARENT,
  }
}

/**
 * MRT stub 样例：均匀平衡态碰撞不破坏；质量守恒。
 */
export function runLbmMrtStubSample(
  Nx = 16,
  tau = 1,
): {
  mass0: number
  massF: number
  massErr: number
  massConserved: boolean
  finite: boolean
  methodId: typeof METHOD_ALGO_LBM_MRT_STUB
  familyId: typeof LBM_L3_PARENT
} {
  const rho = new Float64Array(Nx)
  rho.fill(1)
  const f = createD1q3(Nx)
  initEquilibrium(f, rho)
  // 微扰非平衡
  for (let i = 0; i < Nx; i++) {
    f[0]![i]! *= 0.9
    f[2]![i]! *= 1.1
  }
  const mass0 = totalMass(f)
  mrtCollideStub(f, tau, 1)
  const massF = totalMass(f)
  const massErr = Math.abs(massF - mass0)
  return {
    mass0,
    massF,
    massErr,
    massConserved: massErr / Math.max(mass0, 1e-30) < 1e-10,
    finite: Number.isFinite(mass0) && Number.isFinite(massF),
    methodId: METHOD_ALGO_LBM_MRT_STUB,
    familyId: LBM_L3_PARENT,
  }
}
