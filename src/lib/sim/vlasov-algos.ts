/**
 * 1D Vlasov–Poisson 玩具 · 相空间网格流 + 周期泊松。
 * 父族 method-vlasov（新族，不入库）；子算法仅常量，不改 catalog / registry / edges。
 */

/** 父族 · 1D Vlasov 动力学。 */
export const METHOD_VLASOV = 'method-vlasov'

/** 子算法 · 相空间 x 方向流（半拉格朗日 / 迎风）。 */
export const METHOD_ALGO_VLASOV_STREAM = 'method-algo-vlasov-stream'

/** 子算法 · 1D Vlasov–Poisson：ρ→φ→E。 */
export const METHOD_ALGO_VLASOV_POISSON_1D = 'method-algo-vlasov-poisson-1d'

export const VLASOV_METHOD_IDS = [
  METHOD_ALGO_VLASOV_STREAM,
  METHOD_ALGO_VLASOV_POISSON_1D,
] as const

/** 相空间网格：f[ix * Nv + iv]，x∈[0,Lx)、v∈[vmin,vmax)。 */
export type VlasovGrid = {
  Nx: number
  Nv: number
  Lx: number
  vmin: number
  vmax: number
  dx: number
  dv: number
  /** 长度 Nx·Nv 的行主序分布。 */
  f: Float64Array
}

/**
 * 构造均匀相空间网格并填零分布。
 */
export function createVlasovGrid(
  Nx: number,
  Nv: number,
  Lx = 1,
  vmin = -1,
  vmax = 1,
): VlasovGrid {
  if (!(Nx >= 2 && Nv >= 2)) throw new Error('createVlasovGrid: Nx,Nv ≥ 2')
  if (!(Lx > 0 && vmax > vmin)) throw new Error('createVlasovGrid: bad domain')
  return {
    Nx,
    Nv,
    Lx,
    vmin,
    vmax,
    dx: Lx / Nx,
    dv: (vmax - vmin) / Nv,
    f: new Float64Array(Nx * Nv),
  }
}

/** 单元中心速度 v_j = vmin + (j+½) dv。 */
export function velocityAt(g: VlasovGrid, iv: number): number {
  return g.vmin + (iv + 0.5) * g.dv
}

/** 单元中心位置 x_i = (i+½) dx。 */
export function positionAt(g: VlasovGrid, ix: number): number {
  return (ix + 0.5) * g.dx
}

/** 总质量 M = Σ f · dx · dv（相空间元面积）。 */
export function phaseMass(g: VlasovGrid): number {
  let s = 0
  const { f } = g
  for (let i = 0; i < f.length; i++) s += f[i]!
  return s * g.dx * g.dv
}

/** 分布是否全有限。 */
export function phaseFinite(g: VlasovGrid): boolean {
  const { f } = g
  for (let i = 0; i < f.length; i++) {
    if (!Number.isFinite(f[i]!)) return false
  }
  return true
}

/**
 * 高斯 blob：f ∝ exp(−(x−x0)²/(2σx²) − (v−v0)²/(2σv²))，可选归一化总质量。
 */
export function depositGaussianBlob(
  g: VlasovGrid,
  x0: number,
  v0: number,
  sigx: number,
  sigv: number,
  mass = 1,
): void {
  const { Nx, Nv, dx, dv, f } = g
  const inv2sx = 1 / (2 * sigx * sigx)
  const inv2sv = 1 / (2 * sigv * sigv)
  let s = 0
  for (let ix = 0; ix < Nx; ix++) {
    const x = positionAt(g, ix)
    let dxw = x - x0
    // 周期最近像
    if (dxw > g.Lx * 0.5) dxw -= g.Lx
    if (dxw < -g.Lx * 0.5) dxw += g.Lx
    const wx = Math.exp(-dxw * dxw * inv2sx)
    for (let iv = 0; iv < Nv; iv++) {
      const v = velocityAt(g, iv)
      const dvw = v - v0
      const val = wx * Math.exp(-dvw * dvw * inv2sv)
      f[ix * Nv + iv] = val
      s += val
    }
  }
  const scale = s > 0 ? mass / (s * dx * dv) : 0
  if (scale !== 1) {
    for (let i = 0; i < f.length; i++) f[i]! *= scale
  }
}

/**
 * 周期线性插值：在 x 处读一行（固定 iv）的 f。
 * 格点取单元中心；x 映射到 [0,Lx)。
 */
export function sampleFxPeriodic(g: VlasovGrid, x: number, iv: number): number {
  const { Nx, Nv, dx, Lx, f } = g
  let xp = ((x % Lx) + Lx) % Lx
  // 单元中心坐标：idx = x/dx − ½
  const xi = xp / dx - 0.5
  let i0 = Math.floor(xi)
  const frac = xi - i0
  i0 = ((i0 % Nx) + Nx) % Nx
  const i1 = (i0 + 1) % Nx
  return f[i0 * Nv + iv]! * (1 - frac) + f[i1 * Nv + iv]! * frac
}

/**
 * 半拉格朗日 x 流：∂f/∂t + v ∂f/∂x = 0。
 * f*(x,v) = f(x − v Δt, v)，周期 BC + 线性插值；就地更新。
 */
export function streamSemiLagrangian(g: VlasovGrid, dt: number): void {
  const { Nx, Nv, f } = g
  const next = new Float64Array(Nx * Nv)
  for (let iv = 0; iv < Nv; iv++) {
    const v = velocityAt(g, iv)
    for (let ix = 0; ix < Nx; ix++) {
      const x = positionAt(g, ix)
      next[ix * Nv + iv] = sampleFxPeriodic(g, x - v * dt, iv)
    }
  }
  f.set(next)
}

/**
 * 一阶迎风 x 流（周期）：
 * v>0：f_i ← f_i − c (f_i − f_{i−1})，c = v dt/dx
 * v<0：f_i ← f_i − c (f_{i+1} − f_i)，c = v dt/dx（c 负）
 * 要求 |v| dt/dx ≤ 1（调用方保证或自行截断）。
 */
export function streamUpwind(g: VlasovGrid, dt: number): void {
  const { Nx, Nv, dx, f } = g
  const next = new Float64Array(Nx * Nv)
  for (let iv = 0; iv < Nv; iv++) {
    const v = velocityAt(g, iv)
    const c = (v * dt) / dx
    for (let ix = 0; ix < Nx; ix++) {
      const i = ix * Nv + iv
      const fi = f[i]!
      if (c >= 0) {
        const im = (((ix - 1) % Nx) + Nx) % Nx
        next[i] = fi - c * (fi - f[im * Nv + iv]!)
      } else {
        const ip = (ix + 1) % Nx
        next[i] = fi - c * (f[ip * Nv + iv]! - fi)
      }
    }
  }
  f.set(next)
}

/**
 * 数密度 n(x) = ∫ f dv ≈ Σ_v f · dv。
 * 返回长度 Nx 的数组。
 */
export function densityFromF(g: VlasovGrid): Float64Array {
  const { Nx, Nv, dv, f } = g
  const n = new Float64Array(Nx)
  for (let ix = 0; ix < Nx; ix++) {
    let s = 0
    const base = ix * Nv
    for (let iv = 0; iv < Nv; iv++) s += f[base + iv]!
    n[ix] = s * dv
  }
  return n
}

/**
 * 电荷密度 ρ = n − n0。
 * n0 默认 ⟨n⟩（准中性去直流，周期泊松可解）。
 */
export function chargeDensity(
  n: Float64Array,
  n0?: number,
): { rho: Float64Array; n0: number } {
  const Nx = n.length
  let mean = 0
  for (let i = 0; i < Nx; i++) mean += n[i]!
  mean /= Math.max(Nx, 1)
  const bg = n0 ?? mean
  const rho = new Float64Array(Nx)
  for (let i = 0; i < Nx; i++) rho[i] = n[i]! - bg
  return { rho, n0: bg }
}

/**
 * 周期 1D 泊松：−φ″ = ρ，⟨ρ⟩=0 时可解；φ 去直流 ⟨φ⟩=0。
 * 中心差分 (φ_{i−1} − 2φ_i + φ_{i+1})/dx² = −ρ_i。
 * 用实傅里叶级数（DFT）在偶数 N 上精确解二阶差分。
 */
export function poissonPeriodicFd1d(
  rho: Float64Array,
  dx: number,
): { phi: Float64Array; E: Float64Array } {
  const N = rho.length
  if (N < 2) {
    return { phi: new Float64Array(N), E: new Float64Array(N) }
  }

  // 去直流（数值噪声）
  let mean = 0
  for (let i = 0; i < N; i++) mean += rho[i]!
  mean /= N
  const rhs = new Float64Array(N)
  for (let i = 0; i < N; i++) rhs[i] = rho[i]! - mean

  // 实 DFT（O(N²) 玩具）：差分特征值 −λ_k = 2(1−cos θ)/dx²，φ̂=ρ̂/(−λ_k)
  const phi = new Float64Array(N)
  const twoPiN = (2 * Math.PI) / N
  for (let k = 1; k < N; k++) {
    const theta = twoPiN * k
    const denom = (2 * (1 - Math.cos(theta))) / (dx * dx)
    if (denom < 1e-30) continue
    let re = 0
    let im = 0
    for (let j = 0; j < N; j++) {
      const ang = theta * j
      re += rhs[j]! * Math.cos(ang)
      im -= rhs[j]! * Math.sin(ang) // e^{-iθ}
    }
    re /= N
    im /= N
    const pre = re / denom
    const pim = im / denom
    for (let j = 0; j < N; j++) {
      const ang = theta * j
      // φ += Re( (pre + i pim) e^{iθj} )
      phi[j]! += pre * Math.cos(ang) - pim * Math.sin(ang)
    }
  }

  // 去直流
  let pMean = 0
  for (let i = 0; i < N; i++) pMean += phi[i]!
  pMean /= N
  for (let i = 0; i < N; i++) phi[i]! -= pMean

  // E = −dφ/dx 中心差分（周期）
  const E = new Float64Array(N)
  const inv2dx = 1 / (2 * dx)
  for (let i = 0; i < N; i++) {
    const ip = (i + 1) % N
    const im = (i - 1 + N) % N
    E[i] = -(phi[ip]! - phi[im]!) * inv2dx
  }
  return { phi, E }
}

/**
 * 完整一步：n=∫f dv → ρ=n−n0 → φ,E。
 */
export function vlasovPoissonFields(
  g: VlasovGrid,
  n0?: number,
): {
  n: Float64Array
  rho: Float64Array
  n0: number
  phi: Float64Array
  E: Float64Array
} {
  const n = densityFromF(g)
  const { rho, n0: bg } = chargeDensity(n, n0)
  const { phi, E } = poissonPeriodicFd1d(rho, g.dx)
  return { n, rho, n0: bg, phi, E }
}

/**
 * 电场 L2 范数 √(Σ E² dx)。
 */
export function fieldL2(E: Float64Array, dx: number): number {
  let s = 0
  for (let i = 0; i < E.length; i++) s += E[i]! * E[i]!
  return Math.sqrt(s * dx)
}

/**
 * 流样例：正速度高斯 blob 半拉格朗日若干步。
 * - 质量近似守恒
 * - 质心向 +x 漂移
 * ok：有限 + 质量相对误差松 + 质心移动
 */
export function runVlasovStreamSample(opts?: {
  Nx?: number
  Nv?: number
  dt?: number
  steps?: number
  v0?: number
}): {
  mass0: number
  massF: number
  massRelErr: number
  xMean0: number
  xMeanF: number
  drifted: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VLASOV_STREAM
  familyId: typeof METHOD_VLASOV
} {
  const Nx = opts?.Nx ?? 48
  const Nv = opts?.Nv ?? 32
  const dt = opts?.dt ?? 0.02
  const steps = opts?.steps ?? 20
  const v0 = opts?.v0 ?? 0.4

  const g = createVlasovGrid(Nx, Nv, 1, -1, 1)
  depositGaussianBlob(g, 0.3, v0, 0.06, 0.12, 1)
  const mass0 = phaseMass(g)
  const xMean0 = densityCentroid(g)

  for (let s = 0; s < steps; s++) streamSemiLagrangian(g, dt)

  const massF = phaseMass(g)
  const xMeanF = densityCentroid(g)
  const massRelErr =
    Math.abs(massF - mass0) / Math.max(Math.abs(mass0), 1e-30)
  const finite = phaseFinite(g) && Number.isFinite(massF)
  // 期望漂移 ≈ v0 * steps * dt（周期最近像）
  const expected = v0 * steps * dt
  let dxm = xMeanF - xMean0
  if (dxm > 0.5) dxm -= 1
  if (dxm < -0.5) dxm += 1
  const drifted = dxm > expected * 0.3 && dxm > 1e-3
  const ok = finite && massRelErr < 0.08 && drifted

  return {
    mass0,
    massF,
    massRelErr,
    xMean0,
    xMeanF,
    drifted,
    finite,
    ok,
    methodId: METHOD_ALGO_VLASOV_STREAM,
    familyId: METHOD_VLASOV,
  }
}

/** 密度质心 ⟨x⟩_n（周期 [0,Lx) 用复数均值）。 */
export function densityCentroid(g: VlasovGrid): number {
  const n = densityFromF(g)
  const { Nx, Lx, dx } = g
  let cx = 0
  let sy = 0
  for (let i = 0; i < Nx; i++) {
    const ang = (2 * Math.PI * positionAt(g, i)) / Lx
    cx += n[i]! * Math.cos(ang) * dx
    sy += n[i]! * Math.sin(ang) * dx
  }
  const ang = Math.atan2(sy, cx)
  let x = (ang / (2 * Math.PI)) * Lx
  if (x < 0) x += Lx
  return x
}

/**
 * Vlasov–Poisson 样例：局域密度峰 → 非零 E，质量守恒，场有限。
 * 不做完整 v 推进；仅流 + 泊松诊断（或纯泊松于初值）。
 */
export function runVlasovPoisson1dSample(opts?: {
  Nx?: number
  Nv?: number
  dt?: number
  steps?: number
}): {
  mass0: number
  massF: number
  massRelErr: number
  eL2: number
  rhoMax: number
  phiMax: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VLASOV_POISSON_1D
  familyId: typeof METHOD_VLASOV
} {
  const Nx = opts?.Nx ?? 48
  const Nv = opts?.Nv ?? 32
  const dt = opts?.dt ?? 0.015
  const steps = opts?.steps ?? 12

  const g = createVlasovGrid(Nx, Nv, 1, -1.2, 1.2)
  // 局域峰（非均匀）→ 非平凡 ρ
  depositGaussianBlob(g, 0.45, 0.15, 0.07, 0.15, 1)
  const mass0 = phaseMass(g)

  for (let s = 0; s < steps; s++) streamSemiLagrangian(g, dt)

  const { rho, phi, E } = vlasovPoissonFields(g)
  const massF = phaseMass(g)
  const massRelErr =
    Math.abs(massF - mass0) / Math.max(Math.abs(mass0), 1e-30)
  const eL2 = fieldL2(E, g.dx)
  let rhoMax = 0
  let phiMax = 0
  for (let i = 0; i < rho.length; i++) {
    rhoMax = Math.max(rhoMax, Math.abs(rho[i]!))
    phiMax = Math.max(phiMax, Math.abs(phi[i]!))
  }
  const finite =
    phaseFinite(g) &&
    Number.isFinite(massF) &&
    Number.isFinite(eL2) &&
    Number.isFinite(phiMax)
  // 非均匀密度应产生非零场
  const ok = finite && massRelErr < 0.1 && eL2 > 1e-6 && rhoMax > 0

  return {
    mass0,
    massF,
    massRelErr,
    eL2,
    rhoMax,
    phiMax,
    finite,
    ok,
    methodId: METHOD_ALGO_VLASOV_POISSON_1D,
    familyId: METHOD_VLASOV,
  }
}
