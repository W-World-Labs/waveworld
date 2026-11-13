/**
 * FDTD 四级 · 1D UPML / CPML-lite 吸收边界。
 * 域两端分级电导 σ(x) + 阻抗匹配磁导 σ*，吸收外行脉冲；
 * 相对 PEC 全反射，残余能量显著降低。
 * method id 仅常量，不改 methods.data / registry / edges。
 */

/** 父族 method-fdtd。 */
export const FDTD_L4_PARENT = 'method-fdtd'

/** 四级 · 1D CPML / UPML-lite 吸收层。 */
export const METHOD_ALGO_FDTD_CPML = 'method-algo-fdtd-cpml'

export const FDTD_L4_METHOD_IDS = [METHOD_ALGO_FDTD_CPML] as const

export type Fdtd1dBoundaryKind = 'pec' | 'cpml'

export interface Fdtd1dCpml {
  readonly nE: number
  readonly nH: number
  readonly dx: number
  readonly dt: number
  readonly eps: number
  readonly mu: number
  /** PML 单侧厚度（格点数，E 侧）。 */
  readonly pmlCells: number
  /** 多项式阶数 m（缺省 3）。 */
  readonly m: number
  readonly boundary: Fdtd1dBoundaryKind
  /** 各 E 格点 ca[i] = (1−loss)/(1+loss)。 */
  readonly ca: Float64Array
  /** 各 E 格点 cb[i] = (dt/ε)/(1+loss)/dx。 */
  readonly cb: Float64Array
  /** 各 H 格点 ch_a[i]（磁损耗前因子）。 */
  readonly cha: Float64Array
  /** 各 H 格点 ch_b[i] = (dt/μ)/(1+loss*)/dx。 */
  readonly chb: Float64Array
  readonly E: Float64Array
  readonly H: Float64Array
}

export interface CreateFdtd1dCpmlOpts {
  nE?: number
  dx?: number
  /** Courant 数 S = c dt/dx（1D 上界 1，缺省 0.5）。 */
  S?: number
  eps?: number
  mu?: number
  /** 单侧 PML 厚度（格）；pec 时忽略。 */
  pmlCells?: number
  /** 分级多项式阶。 */
  m?: number
  /** 最大电导倍数（相对理论最优；缺省 1）。 */
  sigmaScale?: number
  boundary?: Fdtd1dBoundaryKind
}

/**
 * 多项式分级电导：距外边界深度 d∈[0,dMax] 时
 * σ = σ_max · ((dMax−d)/dMax)^m ；内部 σ=0。
 * d 为「到吸收外缘的距离」用 (pmlCells−1−localIndex) 表达。
 */
export function pmlSigmaAt(
  cellIndex: number,
  nE: number,
  pmlCells: number,
  sigmaMax: number,
  m: number,
): number {
  if (pmlCells <= 0 || sigmaMax <= 0) return 0
  if (cellIndex < pmlCells) {
    // 左层：index 0 最外缘
    const t = (pmlCells - cellIndex) / pmlCells
    return sigmaMax * Math.pow(t, m)
  }
  if (cellIndex >= nE - pmlCells) {
    // 右层：nE-1 最外缘
    const local = cellIndex - (nE - pmlCells)
    const t = (local + 1) / pmlCells
    return sigmaMax * Math.pow(t, m)
  }
  return 0
}

/**
 * H 半格点磁损耗 sigma_star：两侧 E 格 sigma 平均后按匹配
 * sigma_star/mu = sigma/eps，故 sigma_star_H = sigma_avg * mu/eps。
 */
export function matchedSigmaStar(sigmaAvg: number, eps: number, mu: number): number {
  return sigmaAvg * (mu / eps)
}

/**
 * 分配 1D Yee + 两端 UPML/CPML-lite 系数。
 * σ_max 取 Taflove 经验：σ_max ≈ 0.8 (m+1) / (η Δx)，η=√(μ/ε)。
 */
export function createFdtd1dCpml(opts?: CreateFdtd1dCpmlOpts): Fdtd1dCpml {
  const nE = opts?.nE ?? 128
  const dx = opts?.dx ?? 1
  const S = opts?.S ?? 0.5
  const eps = opts?.eps ?? 1
  const mu = opts?.mu ?? 1
  const pmlCells = opts?.pmlCells ?? 12
  const m = opts?.m ?? 3
  const sigmaScale = opts?.sigmaScale ?? 1
  const boundary = opts?.boundary ?? 'cpml'
  if (!(nE >= 16) || !Number.isInteger(nE)) {
    throw new Error('createFdtd1dCpml: nE integer ≥ 16')
  }
  const c = 1 / Math.sqrt(mu * eps)
  const dt = (S * dx) / c

  // Taflove 经验：σ_max ≈ 0.8 (m+1) / (η Δx)，η=√(μ/ε)
  const eta = Math.sqrt(mu / eps)
  const sigmaMax =
    boundary === 'cpml' ? sigmaScale * (0.8 * (m + 1)) / (eta * dx) : 0

  const nH = nE - 1
  const ca = new Float64Array(nE)
  const cb = new Float64Array(nE)
  const cha = new Float64Array(nH)
  const chb = new Float64Array(nH)

  for (let i = 0; i < nE; i++) {
    const sig =
      boundary === 'cpml' ? pmlSigmaAt(i, nE, pmlCells, sigmaMax, m) : 0
    const loss = (sig * dt) / (2 * eps)
    const den = 1 + loss
    ca[i] = (1 - loss) / den
    cb[i] = dt / eps / den / dx
  }

  for (let i = 0; i < nH; i++) {
    // H 在 i+1/2：两侧 E 的 σ 平均
    const sL =
      boundary === 'cpml' ? pmlSigmaAt(i, nE, pmlCells, sigmaMax, m) : 0
    const sR =
      boundary === 'cpml' ? pmlSigmaAt(i + 1, nE, pmlCells, sigmaMax, m) : 0
    const sigStar = matchedSigmaStar(0.5 * (sL + sR), eps, mu)
    const loss = (sigStar * dt) / (2 * mu)
    const den = 1 + loss
    cha[i] = (1 - loss) / den
    chb[i] = dt / mu / den / dx
  }

  return {
    nE,
    nH,
    dx,
    dt,
    eps,
    mu,
    pmlCells: boundary === 'cpml' ? pmlCells : 0,
    m,
    boundary,
    ca,
    cb,
    cha,
    chb,
    E: new Float64Array(nE),
    H: new Float64Array(nH),
  }
}

/** 半步 H：H ← cha H − chb (E_{i+1}−E_i)。 */
export function fdtd1dCpmlUpdateH(f: Fdtd1dCpml): void {
  const { E, H, cha, chb, nH } = f
  for (let i = 0; i < nH; i++) {
    H[i] = cha[i]! * H[i]! - chb[i]! * (E[i + 1]! - E[i]!)
  }
}

/**
 * 全步 E：内部 E ← ca E − cb (H_i − H_{i−1})。
 * PEC：端点强制 0；CPML：端点也用损耗更新（外无通量 H 外推 0）。
 */
export function fdtd1dCpmlUpdateE(f: Fdtd1dCpml): void {
  const { E, H, ca, cb, nE, boundary } = f
  // 内部
  for (let i = 1; i < nE - 1; i++) {
    E[i] = ca[i]! * E[i]! - cb[i]! * (H[i]! - H[i - 1]!)
  }
  if (boundary === 'pec') {
    E[0] = 0
    E[nE - 1] = 0
  } else {
    // 外边界：单侧，把域外 H 视为 0
    E[0] = ca[0]! * E[0]! - cb[0]! * (H[0]! - 0)
    E[nE - 1] = ca[nE - 1]! * E[nE - 1]! - cb[nE - 1]! * (0 - H[nE - 2]!)
  }
}

/** 完整一步：H 后 E。 */
export function fdtd1dCpmlStep(f: Fdtd1dCpml): void {
  fdtd1dCpmlUpdateH(f)
  fdtd1dCpmlUpdateE(f)
}

/** 电磁能量代理 Σ ½εE²dx + ½μH²dx。 */
export function fdtd1dCpmlEnergy(f: Fdtd1dCpml): number {
  const { E, H, eps, mu, dx, nE, nH } = f
  let se = 0
  for (let i = 0; i < nE; i++) se += E[i]! * E[i]!
  let sh = 0
  for (let i = 0; i < nH; i++) sh += H[i]! * H[i]!
  return 0.5 * eps * se * dx + 0.5 * mu * sh * dx
}

/** 中心高斯脉冲 E 初值。 */
export function injectGaussianECpml(f: Fdtd1dCpml, amp = 1, width = 4): void {
  const { E, nE } = f
  const cx = (nE - 1) / 2
  for (let i = 0; i < nE; i++) {
    const d = (i - cx) / width
    E[i] = amp * Math.exp(-0.5 * d * d)
  }
  if (f.boundary === 'pec') {
    E[0] = 0
    E[nE - 1] = 0
  }
}

/**
 * 样例：同初值高斯脉冲 · CPML 吸收 vs PEC 全反射。
 * 脉冲出走后 CPML 残余能量应显著低于 PEC。
 */
export function runFdtdCpmlSample(opts?: {
  nE?: number
  steps?: number
  pmlCells?: number
  S?: number
  width?: number
}): {
  nE: number
  steps: number
  pmlCells: number
  E0cpml: number
  E0pec: number
  Efcpml: number
  Efpec: number
  /** CPML 末能量明显低于 PEC */
  lessReflection: boolean
  /** CPML 相对初值衰减 */
  cpmlAbsorbed: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FDTD_CPML
  familyId: typeof FDTD_L4_PARENT
} {
  const nE = opts?.nE ?? 128
  const steps = opts?.steps ?? 220
  const pmlCells = opts?.pmlCells ?? 16
  const S = opts?.S ?? 0.5
  const width = opts?.width ?? 5

  const run = (boundary: Fdtd1dBoundaryKind) => {
    const f = createFdtd1dCpml({
      nE,
      S,
      pmlCells,
      boundary,
      eps: 1,
      mu: 1,
      dx: 1,
      m: 3,
      sigmaScale: 1.2,
    })
    injectGaussianECpml(f, 1, width)
    const E0 = fdtd1dCpmlEnergy(f)
    for (let t = 0; t < steps; t++) fdtd1dCpmlStep(f)
    const Ef = fdtd1dCpmlEnergy(f)
    let finite = Number.isFinite(E0) && Number.isFinite(Ef)
    for (let i = 0; i < f.nE; i++) {
      if (!Number.isFinite(f.E[i]!)) finite = false
    }
    for (let i = 0; i < f.nH; i++) {
      if (!Number.isFinite(f.H[i]!)) finite = false
    }
    return { E0, Ef, finite }
  }

  const cpml = run('cpml')
  const pec = run('pec')

  // 出走时间：中心到边界 ~ nE/2 格，c=1，dt=S → 约 (nE/2)/S 步
  const lessReflection = cpml.Ef < pec.Ef * 0.35
  const cpmlAbsorbed = cpml.Ef < cpml.E0 * 0.25
  const finite = cpml.finite && pec.finite
  const ok = finite && lessReflection && cpmlAbsorbed

  return {
    nE,
    steps,
    pmlCells,
    E0cpml: cpml.E0,
    E0pec: pec.E0,
    Efcpml: cpml.Ef,
    Efpec: pec.Ef,
    lessReflection,
    cpmlAbsorbed,
    finite,
    ok,
    methodId: METHOD_ALGO_FDTD_CPML,
    familyId: FDTD_L4_PARENT,
  }
}
