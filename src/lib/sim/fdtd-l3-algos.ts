/**
 * FDTD 三级 · 1D Yee + 电导损耗 σ。
 * ∂H/∂t = −(1/μ) ∂E/∂x
 * ∂E/∂t = −(1/ε) ∂H/∂x − (σ/ε) E
 * 离散采用时间平均损耗形式（ca, cb），无源时能量单调衰减。
 * method id 仅常量，不改 methods.data / edges。
 */

/** 父族 method-fdtd。 */
export const FDTD_L3_PARENT = 'method-fdtd'

/** 三级 · 1D 电导损耗 Yee。 */
export const METHOD_ALGO_FDTD_CONDUCTIVITY = 'method-algo-fdtd-conductivity'

export const FDTD_L3_METHOD_IDS = [METHOD_ALGO_FDTD_CONDUCTIVITY] as const

export interface Fdtd1dConductive {
  /** 电场格点数（E 在整数点 0..nE−1）。 */
  readonly nE: number
  /** 磁场格点数 = nE−1（错位半格；开域/Dirichlet 边界）。 */
  readonly nH: number
  readonly dx: number
  readonly dt: number
  readonly eps: number
  readonly mu: number
  /** 电导率 σ ≥ 0。 */
  readonly sigma: number
  /** E 更新系数 ca = (1 − σ dt/(2ε)) / (1 + σ dt/(2ε))。 */
  readonly ca: number
  /** E 更新系数 cb = (dt/ε) / (1 + σ dt/(2ε)) / dx。 */
  readonly cb: number
  /** H 更新系数 ch = dt/(μ dx)。 */
  readonly ch: number
  /** 电场 E_i^n。 */
  readonly E: Float64Array
  /** 磁场 H_{i+1/2}^{n+1/2}。 */
  readonly H: Float64Array
}

export interface CreateFdtd1dOpts {
  /** 电场格数（缺省 64）。 */
  nE?: number
  /** 空间步（缺省 1）。 */
  dx?: number
  /** Courant 数 S = c dt/dx，1D 上界 1（缺省 0.5）。 */
  S?: number
  eps?: number
  mu?: number
  /** 电导率（缺省 0）。 */
  sigma?: number
}

/**
 * 分配 1D 导电 Yee 场。约化 c=1/√(εμ)；dt = S · dx · √(εμ) 的倒数形式：
 * dt = S · dx · √(μ ε) 不对 — c = 1/√(με)，dt = S dx / c = S dx √(με)。
 */
export function createFdtd1dConductive(opts?: CreateFdtd1dOpts): Fdtd1dConductive {
  const nE = opts?.nE ?? 64
  const dx = opts?.dx ?? 1
  const S = opts?.S ?? 0.5
  const eps = opts?.eps ?? 1
  const mu = opts?.mu ?? 1
  const sigma = opts?.sigma ?? 0
  const c = 1 / Math.sqrt(mu * eps)
  const dt = (S * dx) / c
  const loss = (sigma * dt) / (2 * eps)
  const den = 1 + loss
  const ca = (1 - loss) / den
  const cb = dt / eps / den / dx
  const ch = dt / (mu * dx)
  return {
    nE,
    nH: nE - 1,
    dx,
    dt,
    eps,
    mu,
    sigma,
    ca,
    cb,
    ch,
    E: new Float64Array(nE),
    H: new Float64Array(nE - 1),
  }
}

/**
 * 半步更新 H：H_{i+1/2} ← H − ch (E_{i+1} − E_i)。
 * 开边界：边界 E 固定 0（PEC 端），H 仅内部。
 */
export function fdtd1dUpdateH(f: Fdtd1dConductive): void {
  const { E, H, ch, nH } = f
  for (let i = 0; i < nH; i++) {
    H[i] = H[i]! - ch * (E[i + 1]! - E[i]!)
  }
}

/**
 * 全步更新 E（含电导）：内部
 * E_i ← ca E_i − cb (H_{i+1/2} − H_{i−1/2})
 * 端点 E_0 = E_{n−1} = 0（PEC）。
 */
export function fdtd1dUpdateE(f: Fdtd1dConductive): void {
  const { E, H, ca, cb, nE } = f
  // 内部 1..nE-2
  for (let i = 1; i < nE - 1; i++) {
    E[i] = ca * E[i]! - cb * (H[i]! - H[i - 1]!)
  }
  E[0] = 0
  E[nE - 1] = 0
}

/** 完整 Yee 一步：先 H 后 E。 */
export function fdtd1dStep(f: Fdtd1dConductive): void {
  fdtd1dUpdateH(f)
  fdtd1dUpdateE(f)
}

/**
 * 电磁能量代理：Σ ½ ε E² Δx + ½ μ H² Δx（H 段同样用 dx）。
 * 1D 腔离散能量。
 */
export function fdtd1dEnergy(f: Fdtd1dConductive): number {
  const { E, H, eps, mu, dx, nE, nH } = f
  let se = 0
  for (let i = 0; i < nE; i++) se += E[i]! * E[i]!
  let sh = 0
  for (let i = 0; i < nH; i++) sh += H[i]! * H[i]!
  return 0.5 * eps * se * dx + 0.5 * mu * sh * dx
}

/** 中心高斯脉冲初值（E），H=0。 */
export function injectGaussianE(f: Fdtd1dConductive, amp = 1, width = 4): void {
  const { E, nE } = f
  const cx = (nE - 1) / 2
  for (let i = 1; i < nE - 1; i++) {
    const d = (i - cx) / width
    E[i] = amp * Math.exp(-0.5 * d * d)
  }
  E[0] = 0
  E[nE - 1] = 0
}

/**
 * 样例：同初值 σ=0 vs σ>0；
 * 有损能量衰减，无损能量近似守恒（PEC 腔）。
 */
export function runFdtdConductivitySample(opts?: {
  nE?: number
  steps?: number
  sigma?: number
  S?: number
}): {
  nE: number
  steps: number
  sigma: number
  E0loss: number
  Efloss: number
  E0lossless: number
  Eflossless: number
  /** 有损：末能量 < 初能量 */
  lossDecayed: boolean
  /** 有损：能量序列近似单调下降（允许数值微颤） */
  lossMonotone: boolean
  /** 无损：相对能量漂移小 */
  losslessConserved: boolean
  /** 有损末能量显著低于无损 */
  lossLessThanLossless: boolean
  finite: boolean
  methodId: typeof METHOD_ALGO_FDTD_CONDUCTIVITY
  familyId: typeof FDTD_L3_PARENT
} {
  const nE = opts?.nE ?? 64
  const steps = opts?.steps ?? 120
  const sigma = opts?.sigma ?? 0.05
  const S = opts?.S ?? 0.5

  const run = (sig: number) => {
    const f = createFdtd1dConductive({ nE, S, sigma: sig, eps: 1, mu: 1, dx: 1 })
    injectGaussianE(f, 1, 5)
    const E0 = fdtd1dEnergy(f)
    let maxE = E0
    let upCount = 0
    let prev = E0
    for (let t = 0; t < steps; t++) {
      fdtd1dStep(f)
      const e = fdtd1dEnergy(f)
      if (e > maxE) maxE = e
      // 半步交错能量代理可有 O(ε) 微颤；计显著上升步数
      if (e > prev * (1 + 1e-6) + 1e-12) upCount++
      prev = e
    }
    const Ef = fdtd1dEnergy(f)
    let finite = Number.isFinite(E0) && Number.isFinite(Ef)
    for (let i = 0; i < f.nE; i++) {
      if (!Number.isFinite(f.E[i]!)) finite = false
    }
    for (let i = 0; i < f.nH; i++) {
      if (!Number.isFinite(f.H[i]!)) finite = false
    }
    // 有损：末能量低于初值，且显著上升步占比很小
    const monotone = Ef <= E0 * (1 + 1e-9) && upCount <= Math.max(2, Math.floor(steps * 0.05))
    return { E0, Ef, maxE, monotone, finite }
  }

  const loss = run(sigma)
  const free = run(0)

  const lossDecayed = loss.Ef < loss.E0 * 0.9
  const losslessConserved =
    Math.abs(free.Ef - free.E0) / Math.max(free.E0, 1e-30) < 0.08
  const lossLessThanLossless = loss.Ef < free.Ef * 0.9

  return {
    nE,
    steps,
    sigma,
    E0loss: loss.E0,
    Efloss: loss.Ef,
    E0lossless: free.E0,
    Eflossless: free.Ef,
    lossDecayed,
    lossMonotone: loss.monotone,
    losslessConserved,
    lossLessThanLossless,
    finite: loss.finite && free.finite,
    methodId: METHOD_ALGO_FDTD_CONDUCTIVITY,
    familyId: FDTD_L3_PARENT,
  }
}
