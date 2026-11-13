/**
 * SPH L3 · 2D 弱可压缩（WCSPH）溃坝求解器（纯算法核）。
 * Monaghan 三次样条核（2D 归一化 σ=10/(7πh²)）+ Tait 状态方程
 * p = B((ρ/ρ0)^7 − 1)（自由表面取 p≥0 防拉伸失稳）+ 固定边界粒子 +
 * Monaghan 人工粘性 + Morris 层流粘性 + velocity-Verlet（KDK）积分。
 * 邻域搜索用均匀网格 cell list。method id 仅常量；catalog 接线在
 * methods.data/moduleRegistry。
 */
import { METHOD_SPH } from './sph-algos'

export { METHOD_SPH }

/** 三级 · 2D WCSPH 溃坝。 */
export const METHOD_ALGO_SPH_WCSPH_DAMBREAK = 'method-algo-sph-wcsph-dambreak'

export const SPH_L3_METHOD_IDS = [METHOD_ALGO_SPH_WCSPH_DAMBREAK] as const

/** 2D 三次样条核 W(r, h)：σ·f(q)，σ = 10/(7πh²)，q = r/h。 */
export function cubicSplineW2d(r: number, h: number): number {
  if (!(h > 0) || !Number.isFinite(r) || r < 0) return 0
  const q = r / h
  const ad = 10 / (7 * Math.PI * h * h)
  if (q < 1) return ad * (1 - 1.5 * q * q + 0.75 * q * q * q)
  if (q < 2) {
    const t = 2 - q
    return ad * 0.25 * t * t * t
  }
  return 0
}

/**
 * 2D 核梯度 ∇_i W_ij = (dW/dr)·(r_ij/r)。返回零向量于 r=0 或支撑外。
 */
export function cubicSplineGradW2d(
  dx: number,
  dy: number,
  h: number,
): { gx: number; gy: number } {
  const r2 = dx * dx + dy * dy
  if (!(h > 0) || r2 < 1e-18) return { gx: 0, gy: 0 }
  const r = Math.sqrt(r2)
  const q = r / h
  if (q >= 2) return { gx: 0, gy: 0 }
  const ad = 10 / (7 * Math.PI * h * h)
  const fp = q < 1 ? -3 * q + 2.25 * q * q : -0.75 * (2 - q) * (2 - q)
  const dWdr = (ad * fp) / h
  const gx = (dWdr * dx) / r
  const gy = (dWdr * dy) / r
  return { gx: gx === 0 ? 0 : gx, gy: gy === 0 ? 0 : gy }
}

export type SphDamBreak2dOptions = {
  /** 水箱宽/高（m）。 */
  tankWidth: number
  tankHeight: number
  /** 初始水柱宽/高（m），贴左下角。 */
  columnWidth: number
  columnHeight: number
  /** 参考密度 ρ0（kg/m³）。 */
  rho0: number
  /** 重力加速度大小（m/s²，−y 方向）。 */
  gravity: number
  /** 运动粘度 ν（m²/s，Morris 项）。 */
  kinematicViscosity: number
  /** 粒子间距 Δx（m），缺省 columnWidth/16。 */
  dx?: number
  /** 光滑长度 / Δx，缺省 1.5。 */
  hOverDx?: number
  /** 人工粘性 α，缺省 0.02。 */
  alpha?: number
  /** 人工粘性 β，缺省 0。 */
  beta?: number
  /** 声速 c0（m/s），缺省 10·√(2g·columnHeight)。 */
  soundSpeed?: number
  /** CFL 数 dt = cfl·h/c0，缺省 0.2。 */
  cfl?: number
  /** 模拟终止时刻（s）。 */
  tEnd: number
  /** 边界粒子层数，缺省 4。 */
  wallLayers?: number
}

export type SphDamBreak2dResult = {
  nFluid: number
  nTotal: number
  dx: number
  h: number
  dt: number
  steps: number
  t: number
  /** 初始/末态总机械能（PE+KE+EOS 内能，J，单位厚度）。 */
  energy0: number
  energyF: number
  /** 采样点最大 E/E0 —— 只允许耗散，应 ≤ 1+ε。 */
  energyMaxRatio: number
  /** 前锋 x（床面附近最右流体粒子）与无因次 x/a、t√(2g/a)。 */
  frontX: number
  frontNondimX: number
  nondimT: number
  /** 前锋是否随采样单调推进（容差 dx）。 */
  frontMonotone: boolean
  /** 柱顶高度 初/末。 */
  yTop0: number
  yTopF: number
  rhoMin: number
  rhoMax: number
  /** 越出边界粒子屏障（±wallLayers·dx 之外）的流体粒子数。 */
  escaped: number
  finite: boolean
}

type SphGrid = {
  head: Int32Array
  next: Int32Array
  nx: number
  ny: number
  x0: number
  y0: number
  cs: number
}

function buildGrid(
  X: Float64Array,
  Y: Float64Array,
  n: number,
  rc: number,
  x0: number,
  y0: number,
  w: number,
  hgt: number,
): SphGrid {
  const cs = rc
  const nx = Math.max(1, Math.ceil(w / cs))
  const ny = Math.max(1, Math.ceil(hgt / cs))
  const head = new Int32Array(nx * ny).fill(-1)
  const next = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((X[i]! - x0) / cs)))
    const cy = Math.min(ny - 1, Math.max(0, Math.floor((Y[i]! - y0) / cs)))
    const c = cy * nx + cx
    next[i] = head[c]!
    head[c] = i
  }
  return { head, next, nx, ny, x0, y0, cs }
}

function eachNeighbor(
  g: SphGrid,
  X: Float64Array,
  Y: Float64Array,
  i: number,
  fn: (j: number) => void,
): void {
  const cx = Math.min(g.nx - 1, Math.max(0, Math.floor((X[i]! - g.x0) / g.cs)))
  const cy = Math.min(g.ny - 1, Math.max(0, Math.floor((Y[i]! - g.y0) / g.cs)))
  for (let gy = Math.max(0, cy - 1); gy <= Math.min(g.ny - 1, cy + 1); gy++) {
    for (let gx = Math.max(0, cx - 1); gx <= Math.min(g.nx - 1, cx + 1); gx++) {
      for (let j = g.head[gy * g.nx + gx]!; j !== -1; j = g.next[j]!) {
        fn(j)
      }
    }
  }
}

/**
 * 2D WCSPH 溃坝：水柱贴左下角瞬时释放，重力 −y。
 * 边界粒子（左/右/下三面墙）固定不动，照常参与密度求和并由同一
 * Tait EOS 给压强 → 对靠近的流体粒子产生斥力；流体-壁面对也用
 * 人工粘性 + Morris 粘性（v_wall = 0）。上表面开放（对应上游
 * atmosphere patch）。
 */
export function solveSphDamBreak2d(opts: SphDamBreak2dOptions): SphDamBreak2dResult {
  const {
    tankWidth,
    tankHeight,
    columnWidth,
    columnHeight,
    rho0,
    gravity,
    kinematicViscosity: nu,
    tEnd,
  } = opts
  const dx = opts.dx ?? columnWidth / 16
  const h = (opts.hOverDx ?? 1.5) * dx
  const rc = 2 * h
  const alpha = opts.alpha ?? 0.02
  const beta = opts.beta ?? 0
  const c0 = opts.soundSpeed ?? 10 * Math.sqrt(2 * gravity * columnHeight)
  const cfl = opts.cfl ?? 0.2
  const wallLayers = opts.wallLayers ?? 4
  const eps = 0.01
  const B = (c0 * c0 * rho0) / 7
  const m = rho0 * dx * dx
  const dt = (cfl * h) / c0

  // 流体粒子：水柱晶格
  const px: number[] = []
  const py: number[] = []
  for (let i = 0; i < Math.round(columnWidth / dx); i++) {
    for (let j = 0; j < Math.round(columnHeight / dx); j++) {
      px.push((i + 0.5) * dx)
      py.push((j + 0.5) * dx)
    }
  }
  const nFluid = px.length
  // 边界粒子：wallLayers 层，三面墙
  for (let l = 1; l <= wallLayers; l++) {
    for (let x = -wallLayers * dx; x <= tankWidth + wallLayers * dx; x += dx) {
      px.push(x)
      py.push(-l * dx)
    }
    for (let y = -wallLayers * dx; y <= tankHeight; y += dx) {
      px.push(-l * dx)
      py.push(y)
      px.push(tankWidth + l * dx)
      py.push(y)
    }
  }
  const n = px.length
  const X = new Float64Array(px)
  const Y = new Float64Array(py)
  const VX = new Float64Array(n)
  const VY = new Float64Array(n)
  const VHX = new Float64Array(n)
  const VHY = new Float64Array(n)
  const RHO = new Float64Array(n)
  const P = new Float64Array(n)
  const AX = new Float64Array(n)
  const AY = new Float64Array(n)

  const pad = wallLayers * dx + rc
  const gx0 = -pad
  const gy0 = -pad
  const gw = tankWidth + 2 * pad
  const gh = tankHeight + 2 * pad

  const densityAndAccel = (
    vx: Float64Array,
    vy: Float64Array,
    doAccel: boolean,
  ): void => {
    const g = buildGrid(X, Y, n, rc, gx0, gy0, gw, gh)
    for (let i = 0; i < n; i++) {
      let rho = 0
      eachNeighbor(g, X, Y, i, (j) => {
        const ddx = X[i]! - X[j]!
        const ddy = Y[i]! - Y[j]!
        rho += m * cubicSplineW2d(Math.hypot(ddx, ddy), h)
      })
      RHO[i] = rho
      P[i] = Math.max(0, B * ((rho / rho0) ** 7 - 1))
    }
    if (!doAccel) return
    for (let i = 0; i < nFluid; i++) {
      let ax = 0
      let ay = -gravity
      const rhoi2 = RHO[i]! * RHO[i]!
      eachNeighbor(g, X, Y, i, (j) => {
        if (j === i) return
        const ddx = X[i]! - X[j]!
        const ddy = Y[i]! - Y[j]!
        const r2 = ddx * ddx + ddy * ddy
        if (r2 >= rc * rc || r2 < 1e-18) return
        const { gx, gy } = cubicSplineGradW2d(ddx, ddy, h)
        // 压强梯度（对称形，动量守恒对）
        const pterm = P[i]! / rhoi2 + P[j]! / (RHO[j]! * RHO[j]!)
        ax -= m * pterm * gx
        ay -= m * pterm * gy
        const dvx = vx[i]! - vx[j]!
        const dvy = vy[i]! - vy[j]!
        const vr = dvx * ddx + dvy * ddy
        if (vr < 0) {
          // Monaghan 人工粘性 Π_ij（仅接近对）
          const mu = (h * vr) / (r2 + eps * h * h)
          const rhoBar = 0.5 * (RHO[i]! + RHO[j]!)
          const PI = (-alpha * c0 * mu + beta * mu * mu) / rhoBar
          ax -= m * PI * gx
          ay -= m * PI * gy
        }
        // Morris 层流粘性：(μ_i+μ_j)=2νρ0，v_ij = v_i−v_j；
        // r·∇W<0 → 快粒子被减速
        const rDotGrad = ddx * gx + ddy * gy
        const morris =
          ((m * (2 * nu * rho0)) / (RHO[i]! * RHO[j]!)) *
          (rDotGrad / (r2 + eps * h * h))
        ax += morris * dvx
        ay += morris * dvy
      })
      AX[i] = ax
      AY[i] = ay
    }
  }

  // Tait EOS（p≥0 截断）对应的单位质量内能：u = ∫p/ρ² dρ，
  // ρ>ρ0 时 u = B(ρ⁶/(6ρ0⁷) + 1/ρ − 7/(6ρ0))；ρ≤ρ0 时 p=0 → u=0。
  const internalU = (rho: number): number => {
    if (!(rho > rho0)) return 0
    return B * (rho ** 6 / (6 * rho0 ** 7) + 1 / rho - 7 / (6 * rho0))
  }

  // 初始密度场 → t=0 总机械能 = 流体 PE + 全体 EOS 内能
  densityAndAccel(VX, VY, false)
  let energy0 = 0
  for (let i = 0; i < nFluid; i++) energy0 += m * gravity * Y[i]!
  for (let i = 0; i < n; i++) energy0 += m * internalU(RHO[i]!)
  let yTop0 = 0
  for (let i = 0; i < nFluid; i++) yTop0 = Math.max(yTop0, Y[i]!)

  let t = 0
  let steps = 0
  let energyMaxRatio = 0
  let frontMonotone = true
  let lastFront = 0
  const sampleEvery = Math.max(1, Math.round((tEnd / dt) / 40))
  let finite = true

  while (t < tEnd - 1e-12) {
    densityAndAccel(VX, VY, true)
    for (let i = 0; i < nFluid; i++) {
      VHX[i] = VX[i]! + 0.5 * dt * AX[i]!
      VHY[i] = VY[i]! + 0.5 * dt * AY[i]!
      X[i]! += VHX[i]! * dt
      Y[i]! += VHY[i]! * dt
    }
    densityAndAccel(VHX, VHY, true)
    for (let i = 0; i < nFluid; i++) {
      VX[i] = VHX[i]! + 0.5 * dt * AX[i]!
      VY[i] = VHY[i]! + 0.5 * dt * AY[i]!
    }
    t += dt
    steps++

    if (steps % sampleEvery === 0 || t >= tEnd - 1e-12) {
      let ke = 0
      let pe = 0
      let ue = 0
      let front = 0
      for (let i = 0; i < nFluid; i++) {
        if (!Number.isFinite(X[i]!) || !Number.isFinite(Y[i]!)) {
          finite = false
          continue
        }
        ke += 0.5 * m * (VX[i]! * VX[i]! + VY[i]! * VY[i]!)
        pe += m * gravity * Y[i]!
        // 前锋：近床面最右流体粒子
        if (Y[i]! < 0.05 * columnHeight && X[i]! > front) front = X[i]!
      }
      // EOS 内能计入流体与边界粒子（壁面可暂存弹性能）
      for (let i = 0; i < n; i++) ue += m * internalU(RHO[i]!)
      energyMaxRatio = Math.max(energyMaxRatio, (ke + pe + ue) / energy0)
      if (front + dx < lastFront) frontMonotone = false
      lastFront = Math.max(lastFront, front)
    }
  }

  let frontX = 0
  let yTopF = 0
  let rhoMin = Infinity
  let rhoMax = -Infinity
  let escaped = 0
  let ke = 0
  let pe = 0
  let ueF = 0
  const barrier = (wallLayers - 0.5) * dx
  for (let i = 0; i < nFluid; i++) {
    if (!Number.isFinite(X[i]!) || !Number.isFinite(Y[i]!)) {
      finite = false
      continue
    }
    if (Y[i]! < 0.05 * columnHeight && X[i]! > frontX) frontX = X[i]!
    yTopF = Math.max(yTopF, Y[i]!)
    if (
      X[i]! < -barrier ||
      X[i]! > tankWidth + barrier ||
      Y[i]! < -barrier ||
      Y[i]! > tankHeight + barrier
    ) {
      escaped++
    }
    ke += 0.5 * m * (VX[i]! * VX[i]! + VY[i]! * VY[i]!)
    pe += m * gravity * Y[i]!
    rhoMin = Math.min(rhoMin, RHO[i]!)
    rhoMax = Math.max(rhoMax, RHO[i]!)
  }
  for (let i = 0; i < n; i++) ueF += m * internalU(RHO[i]!)

  return {
    nFluid,
    nTotal: n,
    dx,
    h,
    dt,
    steps,
    t,
    energy0,
    energyF: ke + pe + ueF,
    energyMaxRatio,
    frontX,
    frontNondimX: frontX / columnWidth,
    nondimT: t * Math.sqrt((2 * gravity) / columnWidth),
    frontMonotone,
    yTop0,
    yTopF,
    rhoMin,
    rhoMax,
    escaped,
    finite,
  }
}

/**
 * 溃坝样例：0.1461 m × 0.292 m 水柱在 0.584 m 方箱内坍塌
 *（Martin–Moyce 无因次几何，同 OpenFOAM damBreak 教程）。
 * 断言：有限、能量只耗散不增生、前锋推进且柱顶下降、粒子不出箱。
 */
export function runSphDamBreakSample(opts?: {
  dx?: number
  tEnd?: number
}): {
  ok: boolean
  result: SphDamBreak2dResult
  methodId: typeof METHOD_ALGO_SPH_WCSPH_DAMBREAK
  familyId: typeof METHOD_SPH
} {
  const gravity = 9.81
  const columnWidth = 0.1461
  const columnHeight = 0.292
  const tEnd = opts?.tEnd ?? 0.2
  const result = solveSphDamBreak2d({
    tankWidth: 0.584,
    tankHeight: 0.584,
    columnWidth,
    columnHeight,
    rho0: 1000,
    gravity,
    kinematicViscosity: 1e-6,
    dx: opts?.dx ?? columnWidth / 16,
    tEnd,
  })
  // Ritter 干床解析上界：前锋速度 ≤ 2√(g·h0)，x ≤ a + 2√(g·h0)·t（+5%）。
  const ritterBoundX =
    columnWidth + 2 * Math.sqrt(gravity * columnHeight) * tEnd * 1.05
  const ok =
    result.finite &&
    result.escaped === 0 &&
    result.energyMaxRatio <= 1.001 &&
    result.energyF < result.energy0 &&
    result.frontMonotone &&
    result.frontNondimX > 1.1 &&
    result.frontX < ritterBoundX &&
    result.yTopF < result.yTop0 &&
    result.rhoMax < 1.15 * 1000 &&
    result.rhoMin > 0
  return {
    ok,
    result,
    methodId: METHOD_ALGO_SPH_WCSPH_DAMBREAK,
    familyId: METHOD_SPH,
  }
}
