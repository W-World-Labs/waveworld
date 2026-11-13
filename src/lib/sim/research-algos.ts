/**
 * 研究骨架方法 · 纯函数 runners（无 sim 页面的 CATALOG 节点）。
 * 在仓库既有物理/数值内核上挂可测的最小真实数学，而非硬编码假返回值。
 *
 * 覆盖：ray-optics / spectral / kalman / FEM / LBM / BEM / PIC / DFT-electronic
 */
import { HBAR } from '../physics/constants'
import { fresnelReflection } from './fdtd'
import { powerAt } from './biodsp'
import { HeatField, sum } from './heat'
import { methodById } from '../../data/methods/methods'

// ── CATALOG method ids（与 methods.data 对齐，勿改 data 文件）────────────────

export const METHOD_RAY_OPTICS = 'method-ray-optics'
export const METHOD_SPECTRAL = 'method-spectral-method'
export const METHOD_KALMAN = 'method-kalman'
export const METHOD_FEM = 'method-fem'
export const METHOD_LBM = 'method-lattice-boltzmann'
export const METHOD_BEM = 'method-boundary-element'
export const METHOD_PIC = 'method-particle-in-cell'
export const METHOD_DFT_ELECTRONIC = 'method-dft-electronic'

/** 仍无 simPaths 的研究骨架（ray-optics 已挂 optics-lab，不再列入）。 */
export const RESEARCH_SKELETON_IDS = [
  METHOD_SPECTRAL,
  METHOD_KALMAN,
  METHOD_LBM,
  METHOD_BEM,
  METHOD_PIC,
  METHOD_DFT_ELECTRONIC,
] as const

export type ResearchSkeletonId = (typeof RESEARCH_SKELETON_IDS)[number]

/** 目录中是否登记且无 simPaths（研究骨架）。 */
export function isResearchSkeleton(id: string): boolean {
  const m = methodById(id)
  return !!m && !(m.simPaths?.length)
}

// ═══════════════════════════════════════════════════════════════════════════
// 几何光学 · 斯涅尔定律  n₁ sin θ₁ = n₂ sin θ₂
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 由入射角求折射角；|n1/n2·sin θ1| > 1 时全反射，返回 NaN。
 * θ 为弧度，相对法线。
 */
export function snellTheta2(n1: number, n2: number, theta1: number): number {
  if (!(n1 > 0) || !(n2 > 0)) throw new Error('indices must be positive')
  const s = (n1 / n2) * Math.sin(theta1)
  if (Math.abs(s) > 1) return Number.NaN
  return Math.asin(s)
}

/** 残差 n1 sinθ1 − n2 sinθ2（折射存在时应≈0）。 */
export function snellResidual(n1: number, n2: number, theta1: number, theta2: number): number {
  return n1 * Math.sin(theta1) - n2 * Math.sin(theta2)
}

/**
 * 代表样例：空气→玻璃 n=1→1.5，θ1=30°；并与正入射菲涅耳 |r| 并立校验（fdtd 内核）。
 */
export function runSnellSample(): {
  n1: number
  n2: number
  theta1: number
  theta2: number
  residual: number
  tir: boolean
  fresnelR: number
  methodId: typeof METHOD_RAY_OPTICS
} {
  const n1 = 1
  const n2 = 1.5
  const theta1 = Math.PI / 6 // 30°
  const theta2 = snellTheta2(n1, n2, theta1)
  const tir = !Number.isFinite(theta2)
  const residual = tir ? Number.NaN : snellResidual(n1, n2, theta1, theta2)
  // 非磁性介质 n=√ε → ε=n²；正入射反射幅值
  const fresnelR = fresnelReflection(n1 * n1, n2 * n2)
  return {
    n1,
    n2,
    theta1,
    theta2,
    residual,
    tir,
    fresnelR,
    methodId: METHOD_RAY_OPTICS,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 谱方法 · 离散傅里叶变换（短阵列纯 DFT，非 FFT）
// ═══════════════════════════════════════════════════════════════════════════

export type DftResult = {
  re: Float64Array
  im: Float64Array
  mag: Float64Array
}

/** 实序列长度-N 的朴素 DFT：X[k]=Σ_n x[n] exp(−2π i k n / N)。 */
export function dftReal(x: ArrayLike<number>): DftResult {
  const N = x.length
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const mag = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let rk = 0
    let ik = 0
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N
      const xn = x[n]
      rk += xn * Math.cos(ang)
      ik += xn * Math.sin(ang)
    }
    re[k] = rk
    im[k] = ik
    mag[k] = Math.hypot(rk, ik)
  }
  return { re, im, mag }
}

/** 在 mag 上找最大 bin（k=0..N-1）。 */
export function peakBin(mag: ArrayLike<number>): { k: number; mag: number } {
  let k = 0
  let m = mag[0] ?? 0
  for (let i = 1; i < mag.length; i++) {
    if (mag[i] > m) {
      m = mag[i]
      k = i
    }
  }
  return { k, mag: m }
}

/**
 * 正弦峰样例：x[n]=sin(2π k0 n/N)，谱峰应在 k0 与 N−k0；
 * 并用 biodsp.powerAt 对拍该频率能量 > 直流旁瓣。
 */
export function runDftPeakSample(): {
  N: number
  k0: number
  peakK: number
  peakMag: number
  mag0: number
  powerTone: number
  powerDc: number
  methodId: typeof METHOD_SPECTRAL
} {
  const N = 64
  const k0 = 5
  const x = new Float64Array(N)
  for (let n = 0; n < N; n++) x[n] = Math.sin((2 * Math.PI * k0 * n) / N)
  const { mag } = dftReal(x)
  const peak = peakBin(mag)
  // powerAt 用 fs=N、f=k0 → 周期频率匹配 bin k0
  const xs = Array.from(x)
  const powerTone = powerAt(xs, N, k0)
  const powerDc = powerAt(xs, N, 0)
  return {
    N,
    k0,
    peakK: peak.k,
    peakMag: peak.mag,
    mag0: mag[0],
    powerTone,
    powerDc,
    methodId: METHOD_SPECTRAL,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 卡尔曼滤波 · 1D 标量预测–更新
// ═══════════════════════════════════════════════════════════════════════════

export type Kalman1dState = { x: number; P: number }

/** 预测：x⁻ = F x，P⁻ = F P Fᵀ + Q（标量）。 */
export function kalman1dPredict(s: Kalman1dState, F: number, Q: number): Kalman1dState {
  return { x: F * s.x, P: F * s.P * F + Q }
}

/** 更新：K = P H / (H P H + R)，x ← x + K (z − H x)，P ← (1 − K H) P。 */
export function kalman1dUpdate(
  s: Kalman1dState,
  z: number,
  H: number,
  R: number,
): Kalman1dState {
  const y = z - H * s.x
  const S = H * s.P * H + R
  if (!(S > 0)) throw new Error('innovation covariance must be positive')
  const K = (s.P * H) / S
  return {
    x: s.x + K * y,
    P: (1 - K * H) * s.P,
  }
}

/**
 * 常值位置估计：真值 x=5，无过程噪声、测量噪声 R=0.25 的确定性量测 z=trueX。
 * 多步后估计逼近真值且 P 单调下降。
 */
export function runKalman1dSample(steps = 20): {
  estimate: number
  P: number
  P0: number
  trueX: number
  err: number
  methodId: typeof METHOD_KALMAN
} {
  const trueX = 5
  const F = 1
  const H = 1
  const Q = 1e-6
  const R = 0.25
  let s: Kalman1dState = { x: 0, P: 1 }
  const P0 = s.P
  for (let t = 0; t < steps; t++) {
    s = kalman1dPredict(s, F, Q)
    s = kalman1dUpdate(s, trueX, H, R)
  }
  return {
    estimate: s.x,
    P: s.P,
    P0,
    trueX,
    err: Math.abs(s.x - trueX),
    methodId: METHOD_KALMAN,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FEM · 1D Poisson −u″=1，u(0)=u(1)=0，线性元 + 三对角刚度
// 解析 u=x(1−x)/2，中点 1/8
// ═══════════════════════════════════════════════════════════════════════════

/** 解三对角（Thomas）：a 下对角、b 主对角、c 上对角、d 右端。 */
export function solveTridiag(a: number[], b: number[], c: number[], d: number[]): number[] {
  const n = b.length
  const cp = new Array<number>(n)
  const dp = new Array<number>(n)
  const x = new Array<number>(n)
  cp[0] = c[0] / b[0]
  dp[0] = d[0] / b[0]
  for (let i = 1; i < n; i++) {
    const denom = b[i] - a[i] * cp[i - 1]
    cp[i] = i < n - 1 ? c[i] / denom : 0
    dp[i] = (d[i] - a[i] * dp[i - 1]) / denom
  }
  x[n - 1] = dp[n - 1]
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1]
  return x
}

/**
 * 均匀网格线性元组装 K u = f：内部节点 i=1..M，h=1/(M+1)。
 * 刚度 (1/h)[1 −1; −1 1] 累加；载荷 f=1 → 节点荷载 h。
 */
export function runFemPoisson1dSample(M = 16): {
  midU: number
  analyticMid: number
  errMid: number
  maxU: number
  methodId: typeof METHOD_FEM
} {
  const h = 1 / (M + 1)
  const a = new Array(M).fill(0)
  const b = new Array(M).fill(0)
  const c = new Array(M).fill(0)
  const d = new Array(M).fill(0)
  for (let i = 0; i < M; i++) {
    b[i] = 2 / h
    d[i] = h // ∫ φ_i · 1 dx ≈ h
    if (i > 0) a[i] = -1 / h
    if (i < M - 1) c[i] = -1 / h
  }
  const u = solveTridiag(a, b, c, d)
  const midIdx = Math.floor(M / 2)
  const midU = u[midIdx]
  const xMid = (midIdx + 1) * h
  const analyticMid = (xMid * (1 - xMid)) / 2
  let maxU = 0
  for (const v of u) if (v > maxU) maxU = v
  return {
    midU,
    analyticMid,
    errMid: Math.abs(midU - analyticMid),
    maxU,
    methodId: METHOD_FEM,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LBM · D1Q3 BGK 单相密度，质量守恒 + 均匀平衡
// ═══════════════════════════════════════════════════════════════════════════

/**
 * D1Q3：e={−1,0,1}，w={1/6,2/3,1/6}，BGK 碰撞后迁移。
 * 返回初末总质量与松弛后的中点密度。
 */
export function runLbmD1q3Sample(steps = 40, tau = 1): {
  mass0: number
  massF: number
  rhoMid0: number
  rhoMidF: number
  methodId: typeof METHOD_LBM
} {
  const Nx = 32
  // f[q][i]
  const f = [
    new Float64Array(Nx), // e=-1
    new Float64Array(Nx), // e=0
    new Float64Array(Nx), // e=+1
  ]
  const w = [1 / 6, 2 / 3, 1 / 6]
  const e = [-1, 0, 1]
  // 初值：中心高斯密度的局部平衡
  for (let i = 0; i < Nx; i++) {
    const x = i - Nx / 2
    const rho = 1 + 0.5 * Math.exp(-(x * x) / 18)
    for (let q = 0; q < 3; q++) f[q][i] = w[q] * rho
  }
  const dens = () => {
    const rho = new Float64Array(Nx)
    let m = 0
    for (let i = 0; i < Nx; i++) {
      rho[i] = f[0][i] + f[1][i] + f[2][i]
      m += rho[i]
    }
    return { rho, m }
  }
  const { m: mass0, rho: r0 } = dens()
  const rhoMid0 = r0[Nx >> 1]
  const omega = 1 / tau
  const fNew = [new Float64Array(Nx), new Float64Array(Nx), new Float64Array(Nx)]
  for (let t = 0; t < steps; t++) {
    // collide
    for (let i = 0; i < Nx; i++) {
      const rho = f[0][i] + f[1][i] + f[2][i]
      for (let q = 0; q < 3; q++) {
        const feq = w[q] * rho // u=0 平衡
        f[q][i] += omega * (feq - f[q][i])
      }
    }
    // stream（周期）
    for (let q = 0; q < 3; q++) {
      for (let i = 0; i < Nx; i++) {
        const j = (i + e[q] + Nx) % Nx
        fNew[q][j] = f[q][i]
      }
    }
    for (let q = 0; q < 3; q++) f[q].set(fNew[q])
  }
  const { m: massF, rho: rF } = dens()
  return {
    mass0,
    massF,
    rhoMid0,
    rhoMidF: rF[Nx >> 1],
    methodId: METHOD_LBM,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BEM · 1D Poisson 基本解卷积：u(x)=∫ G(x,y) f(y) dy，G=|x−y|/2
// 与 FEM 解析同题 f=1 在自由空间对照；Dirichlet 修正用镜像简化为有界 [0,1]
// 此处用有限区间 Green（两端 Dirichlet 齐次）闭式：
//   G(x,y)= { x(1−y)  x≤y ;  y(1−x)  x≥y }
// 对 f=1：u(x)=∫G = x(1−x)/2 —— 与 FEM 同解析。
// ═══════════════════════════════════════════════════════════════════════════

/** 1D 有界区间 Dirichlet Green 核。 */
export function greenDirichlet1d(x: number, y: number): number {
  if (x <= y) return x * (1 - y)
  return y * (1 - x)
}

/** 梯形积分 ∫_0^1 G(x,y)·1 dy → u(x)。 */
export function bemPotentialAt(x: number, nQuad = 256): number {
  let s = 0
  const h = 1 / nQuad
  for (let i = 0; i <= nQuad; i++) {
    const y = i * h
    const w = i === 0 || i === nQuad ? 0.5 : 1
    s += w * greenDirichlet1d(x, y)
  }
  return s * h
}

export function runBemGreenSample(): {
  uMid: number
  analyticMid: number
  errMid: number
  methodId: typeof METHOD_BEM
} {
  const analyticMid = 0.125 // 1/8
  const uMid = bemPotentialAt(0.5, 400)
  return {
    uMid,
    analyticMid,
    errMid: Math.abs(uMid - analyticMid),
    methodId: METHOD_BEM,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIC · 1D 云单元（CIC）电荷沉积 + 场回插；粒子总电荷守恒
// ═══════════════════════════════════════════════════════════════════════════

/** CIC 沉积：粒子电荷 q 分配到格点。 */
export function cicDeposit(
  pos: ArrayLike<number>,
  charge: ArrayLike<number>,
  rho: Float64Array,
  dx: number,
): void {
  rho.fill(0)
  const Ng = rho.length
  for (let p = 0; p < pos.length; p++) {
    const xi = pos[p] / dx
    let i = Math.floor(xi)
    let f = xi - i
    // 周期
    i = ((i % Ng) + Ng) % Ng
    const i1 = (i + 1) % Ng
    rho[i] += charge[p] * (1 - f)
    rho[i1] += charge[p] * f
  }
}

/** 周期 1D 泊松：−φ″=ρ，FFT 风格的离散正弦通解用累加（零均值 ρ）。 */
export function poissonPeriodic1d(rho: Float64Array, dx: number): Float64Array {
  const n = rho.length
  // 离散： (φ_{i−1}−2φ_i+φ_{i+1})/dx² = −ρ_i  →  累加求 E 再积分 φ
  // 先求 E：dE/dx = ρ − mean（Gauss 定律）
  let mean = 0
  for (let i = 0; i < n; i++) mean += rho[i]
  mean /= n
  const E = new Float64Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += (rho[i] - mean) * dx
    E[i] = acc
  }
  // 去直流，使 ∫E=0
  let eMean = 0
  for (let i = 0; i < n; i++) eMean += E[i]
  eMean /= n
  for (let i = 0; i < n; i++) E[i] -= eMean
  return E
}

/** CIC gather：格点 E → 粒子。 */
export function cicGather(pos: ArrayLike<number>, E: Float64Array, dx: number): Float64Array {
  const Ng = E.length
  const out = new Float64Array(pos.length)
  for (let p = 0; p < pos.length; p++) {
    const xi = pos[p] / dx
    let i = Math.floor(xi)
    let f = xi - i
    i = ((i % Ng) + Ng) % Ng
    const i1 = (i + 1) % Ng
    out[p] = E[i] * (1 - f) + E[i1] * f
  }
  return out
}

export function runPicCicSample(): {
  Qparticles: number
  Qgrid: number
  chargeErr: number
  eFieldNorm: number
  methodId: typeof METHOD_PIC
} {
  const Ng = 32
  const L = 1
  const dx = L / Ng
  const Np = 8
  const pos = new Float64Array(Np)
  const q = new Float64Array(Np)
  for (let p = 0; p < Np; p++) {
    pos[p] = ((p + 0.5) / Np) * L
    q[p] = 1 / Np
  }
  const rho = new Float64Array(Ng)
  cicDeposit(pos, q, rho, dx)
  let Qparticles = 0
  for (let p = 0; p < Np; p++) Qparticles += q[p]
  let Qgrid = 0
  for (let i = 0; i < Ng; i++) Qgrid += rho[i]
  const E = poissonPeriodic1d(rho, dx)
  const Ep = cicGather(pos, E, dx)
  let eFieldNorm = 0
  for (let p = 0; p < Np; p++) eFieldNorm += Ep[p] * Ep[p]
  eFieldNorm = Math.sqrt(eFieldNorm)
  return {
    Qparticles,
    Qgrid,
    chargeErr: Math.abs(Qgrid - Qparticles),
    eFieldNorm,
    methodId: METHOD_PIC,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DFT 电子结构 · 1D 无限势阱基态密度 + 动能期望（Hohenberg–Kohn 式可观测量）
// ψ₀=√2 sin(πx)，ρ=ψ²，T=∫ ψ (−ħ²/2m ∇²)ψ；取 m=1、约化 ħ=HBAR 作尺度示范
// ═══════════════════════════════════════════════════════════════════════════

export function runDftElectronicSample(nQuad = 400): {
  densityNorm: number
  kinetic: number
  analyticT: number
  errT: number
  rhoMid: number
  methodId: typeof METHOD_DFT_ELECTRONIC
} {
  // 单位制：区间 [0,1]，m=1，用 ħ_eff 使能级可数值化；解析 T = (π² ħ²)/(2 m L²)
  const hbar = 1 // 教学约化：与 HBAR 并存仅作常数可达性校验
  void HBAR
  const L = 1
  const m = 1
  const h = L / nQuad
  let densityNorm = 0
  let kinetic = 0
  let rhoMid = 0
  for (let i = 0; i <= nQuad; i++) {
    const x = i * h
    const psi = Math.SQRT2 * Math.sin(Math.PI * x)
    const rho = psi * psi
    const w = i === 0 || i === nQuad ? 0.5 : 1
    densityNorm += w * rho
    // −ψ″ = π² ψ  →  T 密度 = (ħ²/2m) π² ψ²
    kinetic += w * ((hbar * hbar) / (2 * m)) * Math.PI * Math.PI * rho
    if (i === nQuad >> 1) rhoMid = rho
  }
  densityNorm *= h
  kinetic *= h
  const analyticT = ((Math.PI * Math.PI) * (hbar * hbar)) / (2 * m * L * L)
  return {
    densityNorm,
    kinetic,
    analyticT,
    errT: Math.abs(kinetic - analyticT),
    rhoMid,
    methodId: METHOD_DFT_ELECTRONIC,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 可选：用热扩散 FTCS 做 FEM 残差对照的连续介质步进（证明复用 heat 内核）
// ═══════════════════════════════════════════════════════════════════════════

/** 尖峰热扩散若干步后总热量守恒（与 heat-algos 同物理，挂在 FEM 连续介质先修链）。 */
export function runFemHeatLinkSample(): { sum0: number; sumF: number } {
  const W = 12
  const H = 12
  const u = new Float32Array(W * H)
  u[(H >> 1) * W + (W >> 1)] = 1
  const sum0 = sum(u)
  const heat = new HeatField(W, H, u)
  for (let i = 0; i < 20; i++) heat.step(0.2)
  return { sum0, sumF: sum(heat.field) }
}
