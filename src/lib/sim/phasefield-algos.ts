/**
 * 相场 Phase-field · 纯算法核（1D 教学 stub）。
 * Allen–Cahn 显式 FTCS + Cahn–Hilliard 化学势骨架。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 相场。 */
export const METHOD_PHASEFIELD = 'method-phasefield'

/** 子算法 · Allen–Cahn 梯度流。 */
export const METHOD_ALGO_ALLEN_CAHN = 'method-algo-allen-cahn'

/** 子算法 · Cahn–Hilliard 化学势 μ = f'(φ) − ε² φ_xx。 */
export const METHOD_ALGO_CAHN_HILLIARD_CHEM = 'method-algo-cahn-hilliard-chem'

export const PHASEFIELD_METHOD_IDS = [
  METHOD_ALGO_ALLEN_CAHN,
  METHOD_ALGO_CAHN_HILLIARD_CHEM,
] as const

/**
 * 双阱势导数 f'(φ) = φ³ − φ
 * （对应 f(φ) = (1/4)(φ² − 1)²）。
 */
export function doubleWellFp(phi: number): number {
  if (!Number.isFinite(phi)) return NaN
  return phi * phi * phi - phi
}

/**
 * 双阱势 f(φ) = (1/4)(φ² − 1)²。
 */
export function doubleWellF(phi: number): number {
  if (!Number.isFinite(phi)) return NaN
  const t = phi * phi - 1
  return 0.25 * t * t
}

/**
 * 1D 二阶中心差分 φ_xx（Neumann 零通量：ghost φ_{-1}=φ_1，φ_n=φ_{n-2}）。
 * 端点：φ_xx[0] = 2(φ_1−φ_0)/dx²。就地写 out，或返回新 Float64Array。
 */
export function laplacian1d(
  phi: ArrayLike<number>,
  dx: number,
  out?: Float64Array,
): Float64Array {
  const n = phi.length
  const res =
    out && out.length === n ? out : new Float64Array(n)
  if (n === 0 || !(dx > 0) || !Number.isFinite(dx)) {
    res.fill(0)
    return res
  }
  const invDx2 = 1 / (dx * dx)
  if (n === 1) {
    res[0] = 0
    return res
  }
  // Neumann：ghost 反射 → 2(邻点 − 本点)/dx²
  res[0] = (2 * (phi[1]! - phi[0]!)) * invDx2
  for (let i = 1; i < n - 1; i++) {
    res[i] = (phi[i + 1]! - 2 * phi[i]! + phi[i - 1]!) * invDx2
  }
  res[n - 1] = (2 * (phi[n - 2]! - phi[n - 1]!)) * invDx2
  return res
}

/**
 * Ginzburg–Landau 界面能（1D 梯形）：
 * E[φ] = Σ ( f(φ) + (ε²/2)(φ_x)² ) · dx
 * φ_x 用中心差分（端点前/后向）。
 */
export function interfaceEnergy1d(
  phi: ArrayLike<number>,
  dx: number,
  eps: number,
): number {
  const n = phi.length
  if (n === 0 || !(dx > 0) || !Number.isFinite(eps)) return 0
  const eps2 = eps * eps
  let E = 0
  for (let i = 0; i < n; i++) {
    const p = phi[i]!
    let dphi: number
    if (i === 0) {
      dphi = n > 1 ? (phi[1]! - p) / dx : 0
    } else if (i === n - 1) {
      dphi = (p - phi[n - 2]!) / dx
    } else {
      dphi = (phi[i + 1]! - phi[i - 1]!) / (2 * dx)
    }
    E += (doubleWellF(p) + 0.5 * eps2 * dphi * dphi) * dx
  }
  return E
}

/**
 * 化学势 μ = f'(φ) − ε² φ_xx。
 */
export function chemicalPotential1d(
  phi: ArrayLike<number>,
  dx: number,
  eps: number,
  out?: Float64Array,
): Float64Array {
  const n = phi.length
  const mu =
    out && out.length === n ? out : new Float64Array(n)
  if (n === 0) return mu
  const lap = laplacian1d(phi, dx)
  const eps2 = eps * eps
  for (let i = 0; i < n; i++) {
    mu[i] = doubleWellFp(phi[i]!) - eps2 * lap[i]!
  }
  return mu
}

/**
 * Allen–Cahn 显式 FTCS 单步：
 *   φ_t = M (ε² φ_xx − f'(φ))
 *   φ ← φ + dt · M · (ε² φ_xx − f'(φ))
 *
 * 稳定要求 dt 足够小（教学 stub，调用方负责）。
 */
export function allenCahnStep1d(
  phi: Float64Array,
  dx: number,
  dt: number,
  M: number,
  eps: number,
  out?: Float64Array,
): Float64Array {
  const n = phi.length
  const next =
    out && out.length === n ? out : new Float64Array(n)
  if (n === 0) return next
  const lap = laplacian1d(phi, dx)
  const eps2 = eps * eps
  for (let i = 0; i < n; i++) {
    const rhs = M * (eps2 * lap[i]! - doubleWellFp(phi[i]!))
    next[i] = phi[i]! + dt * rhs
  }
  return next
}

/**
 * Cahn–Hilliard 显式 FTCS 单步（常数迁移率 M）：
 *   μ = f'(φ) − ε² φ_xx
 *   φ_t = M μ_xx
 *   φ ← φ + dt · M · μ_xx
 *
 * 四阶抛物型，dt 须极小；教学 skeleton。
 */
export function cahnHilliardStep1d(
  phi: Float64Array,
  dx: number,
  dt: number,
  M: number,
  eps: number,
  out?: Float64Array,
): Float64Array {
  const n = phi.length
  const next =
    out && out.length === n ? out : new Float64Array(n)
  if (n === 0) return next
  const mu = chemicalPotential1d(phi, dx, eps)
  const muLap = laplacian1d(mu, dx)
  for (let i = 0; i < n; i++) {
    next[i] = phi[i]! + dt * M * muLap[i]!
  }
  return next
}

/** 场是否全部有限。 */
export function fieldAllFinite(phi: ArrayLike<number>): boolean {
  for (let i = 0; i < phi.length; i++) {
    if (!Number.isFinite(phi[i]!)) return false
  }
  return true
}

/** 场 min / max。 */
export function fieldMinMax(phi: ArrayLike<number>): {
  min: number
  max: number
} {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < phi.length; i++) {
    const v = phi[i]!
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = 0
  return { min, max }
}

/**
 * 1D tanh 界面初值：φ(x) = tanh((x − x0)/(√2 ε))。
 * 域 [0, L]，n 点。
 */
export function initTanhInterface1d(
  n: number,
  L: number,
  eps: number,
  x0?: number,
): Float64Array {
  const phi = new Float64Array(n)
  if (n < 1 || !(L > 0) || !(eps > 0)) return phi
  const dx = L / Math.max(n - 1, 1)
  const mid = x0 ?? L * 0.5
  const scale = Math.SQRT2 * eps
  for (let i = 0; i < n; i++) {
    const x = i * dx
    phi[i] = Math.tanh((x - mid) / scale)
  }
  return phi
}

/**
 * Allen–Cahn 样例：tanh 界面 + 小扰动 → 若干 FTCS 步。
 * - 界面能单调不增（数值容差）
 * - 序参量大致落在 [-1−δ, 1+δ]
 * - 场有限
 */
export function runAllenCahnSample(opts?: {
  n?: number
  L?: number
  eps?: number
  M?: number
  dt?: number
  steps?: number
}): {
  n: number
  dx: number
  dt: number
  steps: number
  energy0: number
  energyF: number
  energyDrop: number
  phiMin: number
  phiMax: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ALLEN_CAHN
  familyId: typeof METHOD_PHASEFIELD
} {
  const n = opts?.n ?? 96
  const L = opts?.L ?? 6
  const eps = opts?.eps ?? 0.15
  const M = opts?.M ?? 1
  // 显式 AC 稳定：dt ≲ dx²/(2 M ε²) 量级，再收紧
  const dx = L / Math.max(n - 1, 1)
  const dtSafe = 0.2 * (dx * dx) / Math.max(2 * M * eps * eps, 1e-30)
  const dt = opts?.dt ?? Math.min(5e-4, dtSafe)
  const steps = opts?.steps ?? 100

  const phi = initTanhInterface1d(n, L, eps)
  // 小幅确定性扰动以驱动松弛（纯 tanh 已近平衡，能量几乎不动）
  for (let i = 0; i < n; i++) {
    phi[i]! += 0.08 * Math.sin((2 * Math.PI * i) / n)
  }

  const energy0 = interfaceEnergy1d(phi, dx, eps)
  const buf = new Float64Array(n)
  for (let s = 0; s < steps; s++) {
    allenCahnStep1d(phi, dx, dt, M, eps, buf)
    for (let i = 0; i < n; i++) phi[i] = buf[i]!
  }
  const energyF = interfaceEnergy1d(phi, dx, eps)
  const energyDrop = energy0 - energyF
  const { min: phiMin, max: phiMax } = fieldMinMax(phi)
  const finite = fieldAllFinite(phi)
  // 序参量松散在 [-1.5, 1.5]；界面能应不增（显式步容差）
  const inBound = phiMin >= -1.5 && phiMax <= 1.5
  const energyOk = energyDrop >= -1e-6 && energyF < energy0 * 1.01 + 1e-9
  const ok =
    finite &&
    inBound &&
    Number.isFinite(energy0) &&
    Number.isFinite(energyF) &&
    energyOk &&
    energy0 > 0

  return {
    n,
    dx,
    dt,
    steps,
    energy0,
    energyF,
    energyDrop,
    phiMin,
    phiMax,
    finite,
    ok,
    methodId: METHOD_ALGO_ALLEN_CAHN,
    familyId: METHOD_PHASEFIELD,
  }
}

/**
 * Cahn–Hilliard 化学势样例：
 * - μ = f'(φ) − ε² φ_xx 在平衡 tanh 上应接近 0
 * - 可选：极小 dt 下一步仍有限、φ 大致 ∈[-1,1]
 * - 守恒：Σ φ 近似不变（一步）
 */
export function runCahnHilliardChemSample(opts?: {
  n?: number
  L?: number
  eps?: number
  M?: number
  dt?: number
  /** 是否做 CH 时间步（默认 true，一步） */
  doStep?: boolean
}): {
  n: number
  dx: number
  /** 平衡 tanh 上 |μ| 的 L∞ */
  maxAbsMu: number
  /** 均值 |μ| */
  meanAbsMu: number
  mass0: number
  mass1: number
  massErr: number
  phiMin: number
  phiMax: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CAHN_HILLIARD_CHEM
  familyId: typeof METHOD_PHASEFIELD
} {
  const n = opts?.n ?? 201
  const L = opts?.L ?? 10
  const eps = opts?.eps ?? 0.3
  const M = opts?.M ?? 1
  const doStep = opts?.doStep ?? true
  const dx = L / Math.max(n - 1, 1)
  // CH 四阶：dt ≲ dx⁴ / (M ε²) 量级
  const dtSafe =
    0.01 * Math.pow(dx, 4) / Math.max(M * Math.pow(eps, 2), 1e-30)
  const dt = opts?.dt ?? Math.min(1e-8, dtSafe)

  const phi = initTanhInterface1d(n, L, eps)
  const mu = chemicalPotential1d(phi, dx, eps)
  let maxAbsMu = 0
  let sumAbs = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(mu[i]!)
    if (a > maxAbsMu) maxAbsMu = a
    sumAbs += a
  }
  const meanAbsMu = n > 0 ? sumAbs / n : 0

  let mass0 = 0
  for (let i = 0; i < n; i++) mass0 += phi[i]!

  let phiAfter: Float64Array = phi
  if (doStep) {
    phiAfter = cahnHilliardStep1d(phi, dx, dt, M, eps)
  }
  let mass1 = 0
  for (let i = 0; i < n; i++) mass1 += phiAfter[i]!
  const massErr = Math.abs(mass1 - mass0) * dx
  const { min: phiMin, max: phiMax } = fieldMinMax(phiAfter)
  const finite = fieldAllFinite(phiAfter) && fieldAllFinite(mu)

  // 平衡 tanh 上 μ≈0；一步后质量守恒；φ 松散有界
  const ok =
    finite &&
    maxAbsMu < 0.12 &&
    meanAbsMu < 0.04 &&
    massErr < 1e-5 &&
    phiMin >= -1.5 &&
    phiMax <= 1.5

  return {
    n,
    dx,
    maxAbsMu,
    meanAbsMu,
    mass0,
    mass1,
    massErr,
    phiMin,
    phiMax,
    finite,
    ok,
    methodId: METHOD_ALGO_CAHN_HILLIARD_CHEM,
    familyId: METHOD_PHASEFIELD,
  }
}
