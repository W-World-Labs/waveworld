/**
 * 间断有限元 DG 1D 教学桩 · 局部质量矩阵 + 线性平流迎风数值通量。
 * method id 仅常量，不改 methods.data / registry / edges。
 *
 * 参考元 ξ∈[−1,1]；物理单元长度 h，Jacobian J = h/2。
 * 线性平流 u_t + a u_x = 0：界面数值通量 F* = a · u_upwind。
 */

/** 父族 · Discontinuous Galerkin（未入库）。 */
export const METHOD_DG = 'method-dg'

/** 子算法 · 参考/物理元局部质量矩阵。 */
export const METHOD_ALGO_DG_MASS_LOCAL = 'method-algo-dg-mass-local'

/** 子算法 · 线性平流迎风界面通量。 */
export const METHOD_ALGO_DG_UPWIND_FLUX = 'method-algo-dg-upwind-flux'

export const DG_METHOD_IDS = [
  METHOD_ALGO_DG_MASS_LOCAL,
  METHOD_ALGO_DG_UPWIND_FLUX,
] as const

/** 行主序 2×2 稠密矩阵。 */
export type Mat2 = [number, number, number, number]

/**
 * 节点 Lagrange P1 参考质量矩阵（ξ∈[−1,1]，节点 ±1）：
 *   φ₀=(1−ξ)/2, φ₁=(1+ξ)/2
 *   M_ref = ∫ φ_i φ_j dξ = [[2/3, 1/3], [1/3, 2/3]]
 */
export function localMassMatrixP1Ref(): Mat2 {
  return [2 / 3, 1 / 3, 1 / 3, 2 / 3]
}

/**
 * 物理单元长度 h 上的节点 P1 局部质量：M = (h/2) M_ref
 *   = [[h/3, h/6], [h/6, h/3]]
 * （与 1D 线性元一致质量单元块相同；DG 中不跨单元组装。）
 */
export function localMassMatrixP1(h: number): Mat2 {
  if (!(h > 0) || !Number.isFinite(h)) throw new Error('h must be positive finite')
  const s = h / 2
  const Mr = localMassMatrixP1Ref()
  return [s * Mr[0]!, s * Mr[1]!, s * Mr[2]!, s * Mr[3]!]
}

/**
 * 模态 Legendre P1 参考质量（ξ∈[−1,1]）：ψ₀=1, ψ₁=ξ
 *   M_ref = diag(2, 2/3)
 * 物理：M = (h/2) M_ref = diag(h, h/3)
 */
export function localMassMatrixModalP1(h: number): Mat2 {
  if (!(h > 0) || !Number.isFinite(h)) throw new Error('h must be positive finite')
  return [h, 0, 0, h / 3]
}

/** 行主序 2×2 二次型 vᵀ M v。 */
export function quadraticForm2(M: Mat2, v0: number, v1: number): number {
  const Mv0 = M[0]! * v0 + M[1]! * v1
  const Mv1 = M[2]! * v0 + M[3]! * v1
  return v0 * Mv0 + v1 * Mv1
}

/**
 * 2×2 对称矩阵 SPD 检验：对角 > 0 且 det > 0（主子式）。
 */
export function isSpd2x2(M: Mat2, tol = 1e-14): boolean {
  const a = M[0]!
  const b = 0.5 * (M[1]! + M[2]!)
  const c = M[3]!
  return a > tol && c > tol && a * c - b * b > tol
}

/**
 * 线性平流 u_t + a u_x = 0 的迎风数值通量：
 *   F*(uL, uR; a) = a · u_upwind
 * a>0 → 左态；a<0 → 右态；a=0 → 0。
 */
export function dgUpwindFlux(uL: number, uR: number, a: number): number {
  if (a > 0) return a * uL
  if (a < 0) return a * uR
  return 0
}

/**
 * P0 单元弱形式残差（体积项为零）：
 *   h û_t + (F*_R − F*_L) = 0
 * 返回 R = F*_R − F*_L，使 û_t = −R/h。
 *
 * @param uLeft  左邻单元（或外迹）值
 * @param u      本单元均值
 * @param uRight 右邻单元（或外迹）值
 * @param a      平流速度
 */
export function dgWeakResidualP0(
  uLeft: number,
  u: number,
  uRight: number,
  a: number,
): number {
  const FL = dgUpwindFlux(uLeft, u, a)
  const FR = dgUpwindFlux(u, uRight, a)
  return FR - FL
}

/**
 * 单单元 P0 显式 Euler 一步：u ← u − (dt/h)(F*_R − F*_L)。
 */
export function dgElementStepP0(
  uLeft: number,
  u: number,
  uRight: number,
  a: number,
  h: number,
  dt: number,
): number {
  if (!(h > 0) || !Number.isFinite(h)) throw new Error('h must be positive finite')
  const R = dgWeakResidualP0(uLeft, u, uRight, a)
  return u - (dt / h) * R
}

/**
 * 节点 P1 单单元弱形式体积刚度贡献（行主序 2×2）：
 *   S_ij = −a ∫_K φ_j ∂_x φ_i dx
 * 参考元：∂_ξ φ₀=−1/2, ∂_ξ φ₁=+1/2；∂_x = (2/h) ∂_ξ。
 *   S = −a · [[−1/2, −1/2], [1/2, 1/2]] = a · [[1/2, 1/2], [−1/2, −1/2]]
 * （与 h 无关：体积导数与 Jacobian 相消。）
 */
export function dgVolumeStiffnessP1(a: number): Mat2 {
  const s = a / 2
  return [s, s, -s, -s]
}

/**
 * 节点 P1 单单元弱残差向量 R，使 M û_t + R = 0：
 *   R = S u + [ −F*_L · φ_i(left) + F*_R · φ_i(right) ]_i
 * 节点 φ₀(left)=1, φ₁(right)=1。
 *
 * @param u0,u1 本单元左右节点自由度
 * @param uLext 左界面外迹（邻单元右节点或外推）
 * @param uRext 右界面外迹
 */
export function dgWeakResidualP1(
  u0: number,
  u1: number,
  uLext: number,
  uRext: number,
  a: number,
): [number, number] {
  const S = dgVolumeStiffnessP1(a)
  const FL = dgUpwindFlux(uLext, u0, a)
  const FR = dgUpwindFlux(u1, uRext, a)
  const R0 = S[0]! * u0 + S[1]! * u1 - FL
  const R1 = S[2]! * u0 + S[3]! * u1 + FR
  return [R0, R1]
}

/**
 * 局部质量矩阵样例：节点 P1 与模态 P1 均 SPD、对角正；
 * 节点块与经典 (h/3,h/6) 一致。
 */
export function runDgMassLocalSample(h = 0.25): {
  h: number
  Mnodal: Mat2
  Mmodal: Mat2
  Mref: Mat2
  diagPositive: boolean
  spdNodal: boolean
  spdModal: boolean
  /** 节点对角 = h/3 */
  nodalDiagOk: boolean
  /** 节点非对角 = h/6 */
  nodalOffOk: boolean
  /** 模态对角 (h, h/3) */
  modalDiagOk: boolean
  /** 随机向量二次型 > 0 */
  quadPositive: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DG_MASS_LOCAL
  familyId: typeof METHOD_DG
} {
  const Mref = localMassMatrixP1Ref()
  const Mnodal = localMassMatrixP1(h)
  const Mmodal = localMassMatrixModalP1(h)

  const nodalDiagOk =
    Math.abs(Mnodal[0]! - h / 3) < 1e-12 && Math.abs(Mnodal[3]! - h / 3) < 1e-12
  const nodalOffOk =
    Math.abs(Mnodal[1]! - h / 6) < 1e-12 && Math.abs(Mnodal[2]! - h / 6) < 1e-12
  const modalDiagOk =
    Math.abs(Mmodal[0]! - h) < 1e-12 &&
    Math.abs(Mmodal[3]! - h / 3) < 1e-12 &&
    Math.abs(Mmodal[1]!) < 1e-12 &&
    Math.abs(Mmodal[2]!) < 1e-12

  const diagPositive =
    Mnodal[0]! > 0 && Mnodal[3]! > 0 && Mmodal[0]! > 0 && Mmodal[3]! > 0

  const spdNodal = isSpd2x2(Mnodal)
  const spdModal = isSpd2x2(Mmodal)

  const q1 = quadraticForm2(Mnodal, 1, -0.7)
  const q2 = quadraticForm2(Mmodal, 0.3, 1.1)
  const quadPositive = q1 > 0 && q2 > 0

  const ok =
    diagPositive &&
    spdNodal &&
    spdModal &&
    nodalDiagOk &&
    nodalOffOk &&
    modalDiagOk &&
    quadPositive

  return {
    h,
    Mnodal,
    Mmodal,
    Mref,
    diagPositive,
    spdNodal,
    spdModal,
    nodalDiagOk,
    nodalOffOk,
    modalDiagOk,
    quadPositive,
    ok,
    methodId: METHOD_ALGO_DG_MASS_LOCAL,
    familyId: METHOD_DG,
  }
}

/**
 * 迎风通量样例：正/负波速取正确侧；P0 残差一步有限。
 */
export function runDgUpwindFluxSample(opts?: {
  uL?: number
  uR?: number
  aPos?: number
  aNeg?: number
}): {
  uL: number
  uR: number
  aPos: number
  aNeg: number
  fluxPos: number
  fluxNeg: number
  /** a>0 时 F* = a·uL */
  choosesLeft: boolean
  /** a<0 时 F* = a·uR */
  choosesRight: boolean
  residualP0: number
  stepP0: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DG_UPWIND_FLUX
  familyId: typeof METHOD_DG
} {
  const uL = opts?.uL ?? 2
  const uR = opts?.uR ?? 5
  const aPos = opts?.aPos ?? 1.5
  const aNeg = opts?.aNeg ?? -2

  const fluxPos = dgUpwindFlux(uL, uR, aPos)
  const fluxNeg = dgUpwindFlux(uL, uR, aNeg)
  const choosesLeft = Math.abs(fluxPos - aPos * uL) < 1e-14
  const choosesRight = Math.abs(fluxNeg - aNeg * uR) < 1e-14

  // 三单元玩具：左 1、中 3、右 0，a>0 → 残差 = a(3−1)=2a
  const a = aPos
  const residualP0 = dgWeakResidualP0(1, 3, 0, a)
  const h = 0.5
  const dt = 0.1 * h / Math.max(Math.abs(a), 1e-12)
  const stepP0 = dgElementStepP0(1, 3, 0, a, h, dt)
  const finite = Number.isFinite(residualP0) && Number.isFinite(stepP0)

  const expectedR = a * 3 - a * 1 // FR − FL = a·u − a·uLeft
  const residualOk = Math.abs(residualP0 - expectedR) < 1e-12

  const ok = choosesLeft && choosesRight && finite && residualOk

  return {
    uL,
    uR,
    aPos,
    aNeg,
    fluxPos,
    fluxNeg,
    choosesLeft,
    choosesRight,
    residualP0,
    stepP0,
    finite,
    ok,
    methodId: METHOD_ALGO_DG_UPWIND_FLUX,
    familyId: METHOD_DG,
  }
}
