/**
 * 水平集二级算法 · Godunov 重新初始化 + 常速平流。
 * 扩展 levelset-algos 的 SDF / 残差：|∇φ|→1 的伪时间 reinit，
 * 以及 φ_t + u·∇φ = 0 下界面平移与内部体积近似守恒。
 * method id 仅常量，不改 methods.data。
 */
import {
  METHOD_LEVEL_SET,
  reinitResidual,
  sampleCircleSdf,
  signedDistanceCircle,
} from './levelset-algos'

export { METHOD_LEVEL_SET }

/** 二级 · 常速场水平集平流。 */
export const METHOD_ALGO_LEVELSET_ADVECT = 'method-algo-levelset-advect'

export const LEVELSET_L2_METHOD_IDS = [METHOD_ALGO_LEVELSET_ADVECT] as const

/** 符号函数（Sussman）：s = φ / √(φ² + ε²)。 */
export function smoothSign(phi: number, eps: number): number {
  return phi / Math.sqrt(phi * phi + eps * eps)
}

/**
 * Godunov 型 |∇φ| 估计（2D）：
 * 正向推进 (s≥0) 用迎风差分取 max(a⁺,−b⁺) 等；
 * 负向 (s<0) 对换。见 Sussman / Osher–Fedkiw reinit。
 */
export function godunovGradMag(
  a: number,
  b: number,
  c: number,
  d: number,
  s: number,
): number {
  // a = D⁻x, b = D⁺x, c = D⁻y, d = D⁺y
  let ap: number
  let am: number
  let cp: number
  let cm: number
  if (s >= 0) {
    ap = Math.max(a, 0)
    am = Math.min(b, 0)
    cp = Math.max(c, 0)
    cm = Math.min(d, 0)
  } else {
    ap = Math.max(b, 0)
    am = Math.min(a, 0)
    cp = Math.max(d, 0)
    cm = Math.min(c, 0)
  }
  return Math.hypot(
    Math.max(ap * ap, am * am),
    Math.max(cp * cp, cm * cm),
  )
}

/**
 * 单步 Godunov reinit：φ ← φ − dτ · S(φ0) · (|∇φ| − 1)。
 * 边界用单侧差分，全域更新（避免边界冻结污染 |∇φ|）。
 */
export function godunovReinitStep(
  phi: Float64Array,
  phi0: Float64Array,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  dtau: number,
): Float64Array {
  const out = new Float64Array(phi.length)
  const eps = Math.max(dx, dy)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const p = phi[k]!
      // 单侧 / 中心：边界取可用方向
      const im = i > 0 ? i - 1 : i
      const ip = i < nx - 1 ? i + 1 : i
      const jm = j > 0 ? j - 1 : j
      const jp = j < ny - 1 ? j + 1 : j
      const pim = phi[j * nx + im]!
      const pip = phi[j * nx + ip]!
      const pjm = phi[jm * nx + i]!
      const pjp = phi[jp * nx + i]!
      // 若 i 为边界，两侧索引塌缩 → 该向差分为 0
      const DmX = i > 0 ? (p - pim) / dx : (pip - p) / dx
      const DpX = i < nx - 1 ? (pip - p) / dx : (p - pim) / dx
      const DmY = j > 0 ? (p - pjm) / dy : (pjp - p) / dy
      const DpY = j < ny - 1 ? (pjp - p) / dy : (p - pjm) / dy
      const s = smoothSign(phi0[k]!, eps)
      const g = godunovGradMag(DmX, DpX, DmY, DpY, s)
      out[k] = p - dtau * s * (g - 1)
    }
  }
  return out
}

/**
 * 对非 SDF 场做若干 reinit 步，使 |∇φ| 更接近 1。
 * 伪时间总长约覆盖数个特征距离；CFL 用 min(dx,dy)。
 */
export function reinitializeSdf(
  phi: Float64Array,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  steps = 40,
  cfl = 0.45,
): Float64Array {
  const dtau = cfl * Math.min(dx, dy)
  const phi0 = new Float64Array(phi)
  let cur: Float64Array = new Float64Array(phi)
  for (let s = 0; s < steps; s++) {
    cur = new Float64Array(godunovReinitStep(cur, phi0, nx, ny, dx, dy, dtau))
  }
  return cur
}

/**
 * 常速平流一步（1 阶迎风）：φ_t + ux φ_x + uy φ_y = 0。
 * 周期/Dirichlet：边界用单侧差分。
 */
export function advectLevelsetStep(
  phi: Float64Array,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  dt: number,
  ux: number,
  uy: number,
): Float64Array {
  const out = new Float64Array(phi.length)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const p = phi[k]!
      let dphix: number
      let dphiy: number
      if (ux >= 0) {
        const im = Math.max(0, i - 1)
        dphix = (p - phi[j * nx + im]!) / dx
      } else {
        const ip = Math.min(nx - 1, i + 1)
        dphix = (phi[j * nx + ip]! - p) / dx
      }
      if (uy >= 0) {
        const jm = Math.max(0, j - 1)
        dphiy = (p - phi[jm * nx + i]!) / dy
      } else {
        const jp = Math.min(ny - 1, j + 1)
        dphiy = (phi[jp * nx + i]! - p) / dy
      }
      out[k] = p - dt * (ux * dphix + uy * dphiy)
    }
  }
  return out
}

/** 内部体积近似：∑ H_ε(−φ) · dx·dy（光滑 Heaviside）。 */
export function interiorVolume(
  phi: ArrayLike<number>,
  _nx: number,
  _ny: number,
  dx: number,
  dy: number,
  eps?: number,
): number {
  const e = eps ?? Math.max(dx, dy)
  let v = 0
  const cell = dx * dy
  for (let k = 0; k < phi.length; k++) {
    const z = -phi[k]!
    // H_ε(z): 1 if z>ε, 0 if z<−ε, smooth in between
    let h: number
    if (z > e) h = 1
    else if (z < -e) h = 0
    else h = 0.5 * (1 + z / e + Math.sin((Math.PI * z) / e) / Math.PI)
    v += h * cell
  }
  return v
}

/**
 * 样例：圆 SDF 在常速 (ux,uy) 下平流，偶发 reinit；
 * 界面中心平移 ≈ u·T，内部体积相对误差小，|∇φ| 均值残差有界。
 */
export function runLevelsetAdvectSample(
  n = 65,
  opts?: { ux?: number; uy?: number; steps?: number; cfl?: number },
): {
  n: number
  ux: number
  uy: number
  steps: number
  vol0: number
  volF: number
  volRelErr: number
  meanGradRes0: number
  meanGradResF: number
  /** 界面沿 x 的平移量估计（质心位移）。 */
  centroidShiftX: number
  expectedShiftX: number
  shiftErr: number
  finite: boolean
  methodId: typeof METHOD_ALGO_LEVELSET_ADVECT
  familyId: typeof METHOD_LEVEL_SET
} {
  const ux = opts?.ux ?? 0.4
  const uy = opts?.uy ?? 0.1
  const steps = opts?.steps ?? 40
  const cfl = opts?.cfl ?? 0.4
  const R = 0.22
  const cx = 0.35
  const cy = 0.5
  const { phi, dx, dy } = sampleCircleSdf(n, n, { cx, cy, R })
  const vol0 = interiorVolume(phi, n, n, dx, dy)
  const { meanRes: meanGradRes0 } = reinitResidual(phi, n, n, dx, dy)

  const dt = (cfl * Math.min(dx, dy)) / Math.max(Math.hypot(ux, uy), 1e-12)
  let cur: Float64Array = new Float64Array(phi)
  for (let s = 0; s < steps; s++) {
    cur = new Float64Array(advectLevelsetStep(cur, n, n, dx, dy, dt, ux, uy))
    // 每几步轻量 reinit，抑制 |∇φ| 漂移
    if ((s + 1) % 8 === 0) {
      cur = new Float64Array(reinitializeSdf(cur, n, n, dx, dy, 5, 0.45))
    }
  }
  // 终态 reinit 清理
  cur = new Float64Array(reinitializeSdf(cur, n, n, dx, dy, 15, 0.45))

  const volF = interiorVolume(cur, n, n, dx, dy)
  const { meanRes: meanGradResF } = reinitResidual(cur, n, n, dx, dy)

  // 质心：对 H(−φ) 加权
  let mx = 0
  let my = 0
  let mass = 0
  const e = Math.max(dx, dy)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const z = -cur[j * n + i]!
      let h: number
      if (z > e) h = 1
      else if (z < -e) h = 0
      else h = 0.5 * (1 + z / e + Math.sin((Math.PI * z) / e) / Math.PI)
      if (h <= 0) continue
      const x = i * dx
      const y = j * dy
      mx += h * x
      my += h * y
      mass += h
    }
  }
  const cxF = mass > 0 ? mx / mass : cx
  const T = steps * dt
  const expectedShiftX = ux * T
  const centroidShiftX = cxF - cx
  const shiftErr = Math.abs(centroidShiftX - expectedShiftX)

  let finite = Number.isFinite(volF) && Number.isFinite(meanGradResF)
  for (let i = 0; i < cur.length; i++) {
    if (!Number.isFinite(cur[i]!)) {
      finite = false
      break
    }
  }

  return {
    n,
    ux,
    uy,
    steps,
    vol0,
    volF,
    volRelErr: vol0 > 0 ? Math.abs(volF - vol0) / vol0 : 0,
    meanGradRes0,
    meanGradResF,
    centroidShiftX,
    expectedShiftX,
    shiftErr,
    finite,
    methodId: METHOD_ALGO_LEVELSET_ADVECT,
    familyId: METHOD_LEVEL_SET,
  }
}

/** 辅助：圆 SDF 在网格上的解析对照（导出便于测试）。 */
export { signedDistanceCircle, reinitResidual, sampleCircleSdf }
