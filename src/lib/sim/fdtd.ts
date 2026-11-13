// src/lib/sim/fdtd.ts
// 2D FDTD（有限差分时域）麦克斯韦场核心 —— TMz 模式，约化单位 c = ε₀ = μ₀ = Δx = 1。
//
// 物理与离散（Yee 网格，蛙跳/leapfrog 时间推进）：
//   TMz 模式只保留 (Ez, Hx, Hy) 三个分量。Ez 定义在格心 (i,j)，磁场错位半格：
//   Hx 在 (i, j+½)、Hy 在 (i+½, j)。每个完整步先更新 H 再更新 E（半步交错）。
//
//   ∂Hx/∂t = −(1/μ)·∂Ez/∂y  →  Hx[i,j] -= (dt/μ)·(Ez[i,j+1] − Ez[i,j])
//   ∂Hy/∂t = +(1/μ)·∂Ez/∂x  →  Hy[i,j] += (dt/μ)·(Ez[i+1,j] − Ez[i,j])
//   ∂Ez/∂t = (1/ε)·(∂Hy/∂x − ∂Hx/∂y)
//          →  Ez[i,j] += (dt/ε[i,j])·((Hy[i,j] − Hy[i−1,j]) − (Hx[i,j] − Hx[i,j−1]))
//
//   稳定性 CFL（2D）：c·dt·√(1/Δx² + 1/Δy²) ≤ 1。约化 Δx=Δy=c=1 给出
//   dt ≤ 1/√2。取 Courant 数 S<1，dt = S/√2。S>1 超 CFL → 拒绝执行。
//
//   边界：一阶 Mur ABC（'mur'/'mur1'，吸收正入射波）、二阶 Mur ABC（'mur2'，
//   含切向二阶差分项，宽角吸收）、CFS-PML 卷积完全匹配层（'cpml'，最强吸收）
//   或 PEC（'pec'，边界 Ez=0，全反射）。mur/mur1/pec 走 Rust/WASM 内核；
//   mur2/cpml 需要额外边界态（E^{n-1} 历史 / ψ 卷积量），现行 WASM ABI 不能
//   携带，暂由本文件的 CpuFdtd 以同一递推逐步镜像执行。
//   介质：逐格相对介电常数 epsR 场（缺省 1）。可选 PEC 掩膜把若干格 Ez 强制 0。
//
//   平铺索引 idx = j*Nx + i；Rust/WASM 为共同 CPU 实现，WebGPU 使用 FP32。
//
// 纯计算、原地更新、无 DOM、无副作用（除传入 Float32Array 的就地修改）。
// 参考：A. Taflove & S. Hagness,《Computational Electrodynamics: The FDTD Method》
//       (3rd ed., Artech House) Ch.3（Yee 算法）、Ch.4（CFL）、Ch.6（Mur ABC）。
//       D. M. Sullivan,《Electromagnetic Simulation Using the FDTD Method》(2nd ed.)。

import { param } from './params'
import { WasmFdtd } from './wasm-fields'

/** Courant 数缺省值 S=0.5（< 1，2D CFL 稳定）。
 * 来源：Taflove & Hagness, FDTD Method 3rd ed., Ch.4 CFL 稳定性判据（2D 上界 1/√2）。 */
export const COURANT_DEFAULT = param(
  0.5,
  '约化（无量纲 Courant 数）',
  'Taflove & Hagness, Computational Electrodynamics: The FDTD Method, 3rd ed., Ch.4',
  'node:electromagnetic',
)

/** 约化真空磁导率 μ = 1（c = ε₀ = μ₀ = Δx = 1 约化单位制）。
 * 来源：FDTD 标准约化（normalized）单位制，见 Sullivan, FDTD Method 2nd ed., Ch.1。 */
export const MU_REDUCED = param(
  1,
  '约化',
  'Sullivan, Electromagnetic Simulation Using the FDTD Method, 2nd ed., Ch.1（约化单位 μ=ε₀=c=1）',
  'node:electromagnetic',
)

/** 边界选择：'mur'/'mur1' 一阶 Mur；'mur2' 二阶 Mur（Taflove §6.4.2，含切向
 * 二阶差分，宽角）；'cpml' CFS-PML 卷积匹配层（Roden–Gedney，最强）；
 * 'pec' 金属壁。'mur1' 是 'mur' 的显式别名，二者同一路径。 */
export type FdtdBoundary = 'mur' | 'mur1' | 'mur2' | 'cpml' | 'pec'

/** 默认边界取最强吸收 CPML。 */
export const FDTD_BOUNDARY_DEFAULT: FdtdBoundary = 'cpml'

/** CPML 层每侧格数（小网格自动收拢到 (n-2)/2）。 */
const CPML_CELLS = 10
/** σ、κ 多项式渐变阶 m（Taflove §7.5.2）。 */
const CPML_ORDER = 3
/** 外壁 κ_max；1 即只做 σ 坐标拉伸。 */
const CPML_KAPPA_MAX = 1
/** σ_max = 0.8·(m+1)/(η·Δx)，约化单位 η=√(μ/ε)=1、Δx=1。 */
const CPML_SIGMA_MAX = 0.8 * (CPML_ORDER + 1)
/** 复频移 α_max：PML 内界面最大，向外线性降至外壁 0。 */
const CPML_ALPHA_MAX = 0.24

/** Roden–Gedney 递推卷积系数对：depth 为深入层内格数（外壁=layer，界面→0）。 */
function cpmlBc(depth: number, layer: number, dt: number): [number, number] {
  const t = depth / layer
  const grading = t * t * t // CPML_ORDER = 3
  const sigma = CPML_SIGMA_MAX * grading
  const kappa = 1 + (CPML_KAPPA_MAX - 1) * grading
  const alpha = CPML_ALPHA_MAX * (1 - t)
  const b = Math.exp(-(sigma / kappa + alpha) * dt)
  const denominator = sigma * kappa + kappa * kappa * alpha
  return [b, denominator > 0 ? (sigma * (b - 1)) / denominator : 0]
}

/** f64 运算、f32 落盘，与 Rust field_value 同语义；非有限值即停。 */
function storeF32(v: number): number {
  const s = Math.fround(v)
  if (!Number.isFinite(s)) throw new Error('non-finite field')
  return s
}

/**
 * 纯 JS 镜像 Rust `step_fdtd`/`step_fdtd_ex` 的场类：同一更新次序
 * （H → CPML H 修正 → E → CPML E 修正 → PEC 掩膜 → 边界 → 历史平移），
 * f32 存储、f64 算术。承载 mur2 的 E^{n-1} 边界/内格历史和 cpml 的四个
 * 全网格 ψ 卷积态——现行 WASM ABI 只有四条 prev_* 边界历史，带不动这些
 * 额外状态，所以 mur2/cpml 由本类推进；mur/pec 也能跑（供对照）。
 */
export class CpuFdtd {
  readonly eps: Float32Array
  readonly Ez: Float32Array
  readonly Hx: Float32Array
  readonly Hy: Float32Array
  readonly prevLeft: Float32Array
  readonly prevRight: Float32Array
  readonly prevBottom: Float32Array
  readonly prevTop: Float32Array
  /** mur2 的 E^{n-1}：四条边界 + 四条内邻格，按边定长。 */
  readonly m2Left: Float32Array | null
  readonly m2Right: Float32Array | null
  readonly m2Bottom: Float32Array | null
  readonly m2Top: Float32Array | null
  readonly m2LeftIn: Float32Array | null
  readonly m2RightIn: Float32Array | null
  readonly m2BottomIn: Float32Array | null
  readonly m2TopIn: Float32Array | null
  /** cpml 的四个全网格 ψ；层外保持零（200×200 约 640 kB）。 */
  readonly psiEzX: Float32Array | null
  readonly psiEzY: Float32Array | null
  readonly psiHxY: Float32Array | null
  readonly psiHyX: Float32Array | null
  readonly pecMask: Uint8Array | null
  readonly cMur: number
  /** 有效边界模式（'mur1' 归一为 'mur'）。 */
  readonly boundary: FdtdBoundary
  constructor(readonly Nx: number, readonly Ny: number, readonly dt: number, readonly mu: number,
    boundary: FdtdBoundary, eps?: Float32Array, mask?: Uint8Array | null) {
    const count = Nx * Ny
    if (![Nx, Ny].every(n => Number.isSafeInteger(n) && n >= 3) || count > 16_777_216 ||
        (eps && eps.length !== count) || (mask && mask.length !== count)) throw new Error('Invalid FDTD grid or material buffer')
    if (!(dt > 0) || !(mu > 0) || !Number.isFinite(dt) || !Number.isFinite(mu) ||
        (boundary !== 'mur' && boundary !== 'mur1' && boundary !== 'mur2' &&
         boundary !== 'cpml' && boundary !== 'pec')) throw new Error('Invalid FDTD coefficients or boundary')
    const minimumEps = eps ? eps.reduce((minimum, value) => Math.min(minimum, value), Infinity) : 1
    const courantSquared = (dt / mu) * (dt / minimumEps) * 2
    if (!(minimumEps > 0) || (eps && !eps.every(Number.isFinite)) || !Number.isFinite(courantSquared) || courantSquared > 1) throw new Error('FDTD coefficients exceed CFL stability bounds')
    this.boundary = boundary === 'mur1' ? 'mur' : boundary
    this.eps = new Float32Array(count); this.Ez = new Float32Array(count)
    this.Hx = new Float32Array(count); this.Hy = new Float32Array(count)
    this.prevLeft = new Float32Array(Ny); this.prevRight = new Float32Array(Ny)
    this.prevBottom = new Float32Array(Nx); this.prevTop = new Float32Array(Nx)
    if (eps) this.eps.set(eps); else this.eps.fill(1)
    this.pecMask = mask ? new Uint8Array(count) : null
    if (mask) this.pecMask!.set(mask)
    if (this.boundary === 'mur2') {
      this.m2Left = new Float32Array(Ny); this.m2Right = new Float32Array(Ny)
      this.m2Bottom = new Float32Array(Nx); this.m2Top = new Float32Array(Nx)
      this.m2LeftIn = new Float32Array(Ny); this.m2RightIn = new Float32Array(Ny)
      this.m2BottomIn = new Float32Array(Nx); this.m2TopIn = new Float32Array(Nx)
    } else {
      this.m2Left = this.m2Right = this.m2Bottom = this.m2Top =
        this.m2LeftIn = this.m2RightIn = this.m2BottomIn = this.m2TopIn = null
    }
    if (this.boundary === 'cpml') {
      this.psiEzX = new Float32Array(count); this.psiEzY = new Float32Array(count)
      this.psiHxY = new Float32Array(count); this.psiHyX = new Float32Array(count)
    } else {
      this.psiEzX = this.psiEzY = this.psiHxY = this.psiHyX = null
    }
    this.cMur = (dt - 1) / (dt + 1)
  }
  step() {
    const { Nx: nx, Ny: ny, dt, mu, Ez: ez, Hx: hx, Hy: hy, eps } = this
    const coef = dt / mu
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        const dy = j + 1 < ny ? ez[k + nx] - ez[k] : 0
        hx[k] = storeF32(hx[k] - coef * dy)
        const dx = i + 1 < nx ? ez[k + 1] - ez[k] : 0
        hy[k] = storeF32(hy[k] + coef * dx)
      }
    }
    if (this.boundary === 'cpml') this.cpmlH(coef)
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i
        const curl = (hy[k] - hy[k - 1]) - (hx[k] - hx[k - nx])
        ez[k] = storeF32(ez[k] + (dt / eps[k]) * curl)
      }
    }
    if (this.boundary === 'cpml') this.cpmlE()
    if (this.pecMask) {
      const m = this.pecMask
      for (let k = 0; k < ez.length; k++) if (m[k] !== 0) ez[k] = 0
    }
    switch (this.boundary) {
      case 'pec': case 'cpml': {
        // PEC 外墙；cpml 以此作为层的 PEC 背衬。
        for (let i = 0; i < nx; i++) { ez[i] = 0; ez[(ny - 1) * nx + i] = 0 }
        for (let j = 0; j < ny; j++) { ez[j * nx] = 0; ez[j * nx + nx - 1] = 0 }
        break
      }
      case 'mur2': this.mur2Boundary(); break
      default: this.murBoundary()
    }
    if (this.boundary === 'mur' || this.boundary === 'mur1' || this.boundary === 'mur2') {
      for (let j = 0; j < ny; j++) {
        this.prevLeft[j] = ez[j * nx + 1]; this.prevRight[j] = ez[j * nx + nx - 2]
      }
      for (let i = 0; i < nx; i++) {
        this.prevBottom[i] = ez[nx + i]; this.prevTop[i] = ez[(ny - 2) * nx + i]
      }
    }
  }
  /** ψ_hy_x / ψ_hx_y：先按 ∂Ez 更新 ψ，再修正 H（镜像 Rust H 段之后的 CPML 段）。 */
  private cpmlH(coef: number) {
    const { Nx: nx, Ny: ny, dt, Ez: ez, Hx: hx, Hy: hy } = this
    const px = Math.min(CPML_CELLS, (nx - 2) >> 1), py = Math.min(CPML_CELLS, (ny - 2) >> 1)
    const psiHyX = this.psiHyX!, psiHxY = this.psiHxY!
    if (px > 0) {
      for (let i = 0; i < px; i++) {
        const [b, c] = cpmlBc(px - i - 0.5, px, dt)
        for (let j = 0; j < ny; j++) {
          const k = j * nx + i
          const d = i + 1 < nx ? ez[k + 1] - ez[k] : 0
          const psi = storeF32(b * psiHyX[k] + c * d)
          psiHyX[k] = psi
          hy[k] = storeF32(hy[k] + coef * psi)
        }
      }
      const rs = nx - 1 - px
      for (let i = rs; i < nx; i++) {
        const [b, c] = cpmlBc(i + 0.5 - rs, px, dt)
        for (let j = 0; j < ny; j++) {
          const k = j * nx + i
          const d = i + 1 < nx ? ez[k + 1] - ez[k] : 0
          const psi = storeF32(b * psiHyX[k] + c * d)
          psiHyX[k] = psi
          hy[k] = storeF32(hy[k] + coef * psi)
        }
      }
    }
    if (py > 0) {
      for (let j = 0; j < py; j++) {
        const [b, c] = cpmlBc(py - j - 0.5, py, dt)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i
          const d = j + 1 < ny ? ez[k + nx] - ez[k] : 0
          const psi = storeF32(b * psiHxY[k] + c * d)
          psiHxY[k] = psi
          hx[k] = storeF32(hx[k] - coef * psi)
        }
      }
      const ts = ny - 1 - py
      for (let j = ts; j < ny; j++) {
        const [b, c] = cpmlBc(j + 0.5 - ts, py, dt)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i
          const d = j + 1 < ny ? ez[k + nx] - ez[k] : 0
          const psi = storeF32(b * psiHxY[k] + c * d)
          psiHxY[k] = psi
          hx[k] = storeF32(hx[k] - coef * psi)
        }
      }
    }
  }
  /** ψ_ez_x / ψ_ez_y：按 ∂H 更新 ψ，再修正 Ez（只在内格，镜像 Rust E 段之后）。 */
  private cpmlE() {
    const { Nx: nx, Ny: ny, dt, Hx: hx, Hy: hy, Ez: ez, eps } = this
    const px = Math.min(CPML_CELLS, (nx - 2) >> 1), py = Math.min(CPML_CELLS, (ny - 2) >> 1)
    const psiEzX = this.psiEzX!, psiEzY = this.psiEzY!
    if (px > 0) {
      for (let i = 1; i < Math.min(px, nx - 1); i++) {
        const [b, c] = cpmlBc(px - i, px, dt)
        for (let j = 1; j < ny - 1; j++) {
          const k = j * nx + i
          const d = hy[k] - hy[k - 1]
          const psi = storeF32(b * psiEzX[k] + c * d)
          psiEzX[k] = psi
          ez[k] = storeF32(ez[k] + (dt / eps[k]) * psi)
        }
      }
      const rs = nx - 1 - px
      for (let i = Math.max(rs + 1, 1); i < nx - 1; i++) {
        const [b, c] = cpmlBc(i - rs, px, dt)
        for (let j = 1; j < ny - 1; j++) {
          const k = j * nx + i
          const d = hy[k] - hy[k - 1]
          const psi = storeF32(b * psiEzX[k] + c * d)
          psiEzX[k] = psi
          ez[k] = storeF32(ez[k] + (dt / eps[k]) * psi)
        }
      }
    }
    if (py > 0) {
      for (let j = 1; j < Math.min(py, ny - 1); j++) {
        const [b, c] = cpmlBc(py - j, py, dt)
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i
          const d = hx[k] - hx[k - nx]
          const psi = storeF32(b * psiEzY[k] + c * d)
          psiEzY[k] = psi
          ez[k] = storeF32(ez[k] - (dt / eps[k]) * psi)
        }
      }
      const ts = ny - 1 - py
      for (let j = Math.max(ts + 1, 1); j < ny - 1; j++) {
        const [b, c] = cpmlBc(j - ts, py, dt)
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i
          const d = hx[k] - hx[k - nx]
          const psi = storeF32(b * psiEzY[k] + c * d)
          psiEzY[k] = psi
          ez[k] = storeF32(ez[k] - (dt / eps[k]) * psi)
        }
      }
    }
  }
  /** 一阶 Mur（'mur'/'mur1'）：与 WASM 内核逐字同序。 */
  private murBoundary() {
    const { Nx: nx, Ny: ny, Ez: ez } = this
    const c = this.cMur
    for (let j = 0; j < ny; j++) {
      const lb = j * nx
      ez[lb] = storeF32(this.prevLeft[j] + c * (ez[lb + 1] - ez[lb]))
      const rb = lb + nx - 1
      ez[rb] = storeF32(this.prevRight[j] + c * (ez[rb - 1] - ez[rb]))
    }
    for (let i = 0; i < nx; i++) {
      ez[i] = storeF32(this.prevBottom[i] + c * (ez[nx + i] - ez[i]))
      const top = (ny - 1) * nx + i
      ez[top] = storeF32(this.prevTop[i] + c * (ez[top - nx] - ez[top]))
    }
  }
  /** 二阶 Mur（'mur2'）：Taflove §6.4.2，含切向二阶差分 k3 项；
   *  角点退回一阶（二阶模板跨两条边混时间层会放大）。 */
  private mur2Boundary() {
    const { Nx: nx, Ny: ny, dt, Ez: ez } = this
    const k1 = (dt - 1) / (dt + 1), k2 = 2 / (dt + 1), k3 = dt * dt / (2 * (dt + 1))
    const { prevLeft: pl, prevRight: pr, prevBottom: pb, prevTop: pt } = this
    const l2 = this.m2Left!, r2 = this.m2Right!, b2 = this.m2Bottom!, t2 = this.m2Top!
    const l2i = this.m2LeftIn!, r2i = this.m2RightIn!, b2i = this.m2BottomIn!, t2i = this.m2TopIn!
    // 沿边向上推进，滚动携带刚被覆盖的边界格 E^n 值供切向差分。
    let lbPrev = ez[0], rbPrev = ez[nx - 1]
    for (let j = 1; j < ny - 1; j++) {
      const lb = j * nx
      const eBnd = ez[lb], eInN = pl[j]
      const tang = ez[lb + nx] - 2 * eBnd + lbPrev + pl[j + 1] - 2 * eInN + pl[j - 1]
      lbPrev = eBnd
      ez[lb] = storeF32(-l2i[j] + k1 * (ez[lb + 1] + l2[j]) + k2 * (eBnd + eInN) + k3 * tang)
      l2[j] = eBnd; l2i[j] = eInN
      const rb = lb + nx - 1
      const eBndR = ez[rb], eInNR = pr[j]
      const tangR = ez[rb + nx] - 2 * eBndR + rbPrev + pr[j + 1] - 2 * eInNR + pr[j - 1]
      rbPrev = eBndR
      ez[rb] = storeF32(-r2i[j] + k1 * (ez[rb - 1] + r2[j]) + k2 * (eBndR + eInNR) + k3 * tangR)
      r2[j] = eBndR; r2i[j] = eInNR
    }
    let bbPrev = ez[0], tbPrev = ez[(ny - 1) * nx]
    for (let i = 1; i < nx - 1; i++) {
      const eBnd = ez[i], eInN = pb[i]
      const tang = ez[i + 1] - 2 * eBnd + bbPrev + pb[i + 1] - 2 * eInN + pb[i - 1]
      bbPrev = eBnd
      ez[i] = storeF32(-b2i[i] + k1 * (ez[nx + i] + b2[i]) + k2 * (eBnd + eInN) + k3 * tang)
      b2[i] = eBnd; b2i[i] = eInN
      const top = (ny - 1) * nx + i
      const eBndT = ez[top], eInNT = pt[i]
      const tangT = ez[top + 1] - 2 * eBndT + tbPrev + pt[i + 1] - 2 * eInNT + pt[i - 1]
      tbPrev = eBndT
      ez[top] = storeF32(-t2i[i] + k1 * (ez[top - nx] + t2[i]) + k2 * (eBndT + eInNT) + k3 * tangT)
      t2[i] = eBndT; t2i[i] = eInNT
    }
    for (const i of [0, nx - 1]) {
      ez[i] = storeF32(pb[i] + k1 * (ez[nx + i] - ez[i]))
      const top = (ny - 1) * nx + i
      ez[top] = storeF32(pt[i] + k1 * (ez[top - nx] - ez[top]))
    }
  }
  inject(x: number, y: number, amplitude: number) {
    if (![x, y].every(Number.isSafeInteger) || x < 0 || x >= this.Nx || y < 0 || y >= this.Ny) throw new Error('Invalid FDTD source coordinates')
    if (!Number.isFinite(amplitude)) throw new Error('Invalid FDTD source amplitude')
    const k = y * this.Nx + x
    this.Ez[k] = storeF32(this.Ez[k] + amplitude)
  }
  energy() {
    const { Ez: ez, Hx: hx, Hy: hy, eps, mu } = this
    let sum = 0
    for (let k = 0; k < ez.length; k++) sum += eps[k] * ez[k] * ez[k] + mu * (hx[k] * hx[k] + hy[k] * hy[k])
    const energy = 0.5 * sum
    if (!Number.isFinite(energy)) throw new Error('non-finite field')
    return energy
  }
}

/** 场类型：WASM 内核路径（mur/mur1/pec）或本文件 CPU 镜像（mur2/cpml）。 */
export type FdtdField = WasmFdtd | CpuFdtd

export interface CreateFieldOpts {
  /** Courant 数 S（缺省 0.5）。dt = S/√2。 */
  S?: number
  /** 约化磁导率 μ（缺省 1）。 */
  mu?: number
  /** 边界（缺省 'cpml'，最强吸收；'mur'/'mur1' 一阶 Mur、'mur2' 二阶、'pec' 金属壁）。 */
  boundary?: FdtdBoundary
  /** 初始逐格 εR（缺省全 1）；长度需为 Nx·Ny。 */
  eps?: Float32Array
  /** PEC 掩膜（缺省无）。 */
  pecMask?: Uint8Array | null
}

/** 平铺索引：idx = j·Nx + i。 */
export function idxOf(Nx: number, i: number, j: number): number {
  return j * Nx + i
}

/** 分配零场，eps 缺省全 1，dt = S/√2；mur/mur1/pec 走 WASM，mur2/cpml 走 CpuFdtd。 */
export function createField(Nx: number, Ny: number, opts?: CreateFieldOpts): FdtdField {
  const S = opts?.S ?? COURANT_DEFAULT.value
  const mu = opts?.mu ?? MU_REDUCED.value
  const boundary: FdtdBoundary = opts?.boundary ?? FDTD_BOUNDARY_DEFAULT
  const dt = S / Math.SQRT2 // 2D CFL 上界对应 S=1
  if (boundary === 'mur' || boundary === 'mur1' || boundary === 'pec')
    return new WasmFdtd(Nx, Ny, dt, mu, boundary === 'mur1' ? 'mur' : boundary, opts?.eps, opts?.pecMask)
  return new CpuFdtd(Nx, Ny, dt, mu, boundary, opts?.eps, opts?.pecMask)
}

/** 场单步：WASM 内核或 CpuFdtd 镜像，同一更新次序。 */
export function fdtdStep(f: FdtdField): void { f.step() }

/** Soft source addition uses the same FP64 addition and FP32 store on both targets. */
export function injectSoftSource(f: FdtdField, ix: number, iy: number, value: number): void { f.inject(ix, iy, value) }

export function totalEnergy(f: FdtdField): number { return f.energy() }

/** 归一化高斯脉冲：峰值 1 在 t=t0，半宽由 spread 控制。 */
export function gaussianPulse(t: number, t0: number, spread: number): number {
  const x = (t - t0) / spread
  return Math.exp(-0.5 * x * x)
}

/** 连续正弦源 sin(ω·t)（约化时间步）。 */
export function sineCW(t: number, omega: number): number {
  return Math.sin(omega * t)
}

/** 正入射菲涅耳反射系数幅值 |r| = |(√ε₁ − √ε₂)/(√ε₁ + √ε₂)|（非磁性介质 μ_r=1）。
 * 来源：Griffiths, Introduction to Electrodynamics 4th ed., Ch.9 正入射反射系数。 */
export function fresnelReflection(eps1: number, eps2: number): number {
  const n1 = Math.sqrt(eps1)
  const n2 = Math.sqrt(eps2)
  return Math.abs((n1 - n2) / (n1 + n2))
}

// Shared product scenes used by the browser and the task Agent.
export const FDTD_NX = 200, FDTD_NY = 200
const NX = FDTD_NX, NY = FDTD_NY
export interface FdtdScene {
  preset: FdtdPresetId
  boundary: FdtdBoundary
  shape: SourceShape
  time: SourceTime
  omega: number // source phase increment in radians per lattice step
  steps: number
  sources: Array<{ i: number; j: number }>
}

export function defaultFdtdSources(preset: FdtdPresetId): FdtdScene['sources'] {
  return [{ i: preset === 'cavity' ? Math.floor(NX / 2) : Math.floor(NX * 0.15), j: Math.floor(NY / 2) }]
}

/** Sources begin at step zero in both locations; editing a scene starts a new field. */
export function injectFdtdSceneSources(scene: FdtdScene, step: number, inject: (i: number, j: number, amplitude: number) => void): void {
  const amplitude = fdtdSourceAmplitude(scene, step)
  if (amplitude === 0) return
  for (const source of scene.sources) {
    if (scene.shape === 'line') {
      for (let j = 1; j < NY - 1; j++) inject(source.i, j, amplitude)
    } else inject(source.i, source.j, amplitude)
  }
}
/** One source timeline for interactive GPU, Rust/WASM and prepared native jobs. */
export function fdtdSourceAmplitude(scene: Pick<FdtdScene, 'time' | 'omega'>, step: number): number {
  if (scene.time === 'pulse' && step >= 60) return 0
  return scene.time === 'cw' ? sineCW(step, scene.omega) : gaussianPulse(step, 20, 8) * sineCW(step, scene.omega)
}

/** Prepare serializable materials and excitation once, without duplicating presets in Rust. */
export function prepareFdtdInput(scene: FdtdScene) {
  const preset = FDTD_PRESETS.find(p => p.id === scene.preset)
  if (!preset) throw new Error('Unknown FDTD preset')
  return {
    nx: FDTD_NX, ny: FDTD_NY, dt: COURANT_DEFAULT.value / Math.SQRT2, mu: MU_REDUCED.value,
    eps: Array.from(preset.eps?.() ?? new Float32Array(FDTD_NX * FDTD_NY).fill(1)),
    pecMask: preset.pec ? Array.from(preset.pec()) : null,
    amplitudes: Array.from({ length: scene.steps }, (_, step) => fdtdSourceAmplitude(scene, step)),
  }
}

export type SourceShape = 'point' | 'line'      // 点源圆波 / 线源平面波
export type SourceTime = 'pulse' | 'cw'         // 高斯脉冲 / 正弦连续波
export type FdtdPresetId = 'free' | 'interface' | 'doubleslit' | 'lens' | 'cavity'

interface Preset {
  id: FdtdPresetId
  label: string
  labelEn: string
  /** 逐格 εR；缺省（undefined）全 1。 */
  eps?: () => Float32Array
  /** PEC 掩膜；缺省无。 */
  pec?: () => Uint8Array
  /** 该预设建议的默认边界。 */
  boundary: FdtdBoundary
  /** 介质界面预设的两侧 εR（用于菲涅耳叙事卡）。 */
  fresnelEps?: [number, number]
  /** 一句话物理说明。 */
  hint: string
  hintEn: string
}

const idx = (i: number, j: number) => j * NX + i

// ---------- 预设算例构造 ----------
const INTERFACE_X = Math.round(NX * 0.55) // 介质界面 / 透镜参考线
const EPS2 = 4                            // 右半 / 透镜介电常数（n=2）

function epsInterface(): Float32Array {
  const e = new Float32Array(NX * NY)
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) e[idx(i, j)] = i >= INTERFACE_X ? EPS2 : 1
  return e
}

function epsLens(): Float32Array {
  // 平凸介质透镜：竖直平面在 x=cx，凸面朝向左侧源，焦聚平面波。
  const e = new Float32Array(NX * NY).fill(1)
  const cx = Math.round(NX * 0.55)
  const cy = NY / 2
  const apo = NY * 0.32       // 半口径
  const R = NY * 0.9          // 凸面曲率半径
  for (let j = 0; j < NY; j++) {
    const dy = j - cy
    if (Math.abs(dy) > apo) continue
    // 凸面 x 坐标：圆弧 x = cx − (√(R²−dy²) − √(R²−apo²))
    const surf = cx - (Math.sqrt(R * R - dy * dy) - Math.sqrt(R * R - apo * apo))
    for (let i = 0; i < NX; i++)
      if (i >= surf && i <= cx) e[idx(i, j)] = EPS2
  }
  return e
}

function pecDoubleSlit(): Uint8Array {
  // 竖直 PEC 挡板（x=barrier）开两条窄缝。
  const m = new Uint8Array(NX * NY)
  const bx = Math.round(NX * 0.45)
  const cy = NY / 2
  const gap = Math.round(NY * 0.11) // 两缝中心间距的一半
  const half = 3                    // 缝半宽
  for (let j = 0; j < NY; j++) {
    const inSlit =
      Math.abs(j - (cy - gap)) <= half || Math.abs(j - (cy + gap)) <= half
    if (!inSlit) { m[idx(bx, j)] = 1; m[idx(bx + 1, j)] = 1 }
  }
  return m
}

function pecCavity(): Uint8Array {
  // 矩形 PEC 腔：四壁挡板（留内部空腔），波在内部多次反射形成驻波。
  const m = new Uint8Array(NX * NY)
  const lo = Math.round(NX * 0.18), hi = Math.round(NX * 0.82)
  for (let j = lo; j <= hi; j++) { m[idx(lo, j)] = 1; m[idx(hi, j)] = 1 }
  for (let i = lo; i <= hi; i++) { m[idx(i, lo)] = 1; m[idx(i, hi)] = 1 }
  return m
}

export const FDTD_PRESETS: Preset[] = [
  {
    id: 'free',
    label: '自由空间',
    labelEn: 'Free space',
    boundary: 'cpml',
    hint: '均匀真空 + 吸波边界：脉冲外行不反射，是其它算例的参照。',
    hintEn: 'Uniform vacuum + absorbing walls: outgoing pulses leave without reflection—baseline for other cases.',
  },
  {
    id: 'interface',
    label: '介质界面（介电阶跃）',
    labelEn: 'Dielectric interface',
    boundary: 'cpml',
    eps: epsInterface,
    fresnelEps: [1, EPS2],
    hint: `左真空 εR=1、右介质 εR=${EPS2}（折射率 n=2）。平面波正入射在界面部分反射、部分透射。`,
    hintEn: `Vacuum εR=1 on the left, dielectric εR=${EPS2} (n=2) on the right. A normally incident plane wave partially reflects and transmits.`,
  },
  {
    id: 'doubleslit',
    label: '双缝衍射',
    labelEn: 'Double slit',
    boundary: 'cpml',
    pec: pecDoubleSlit,
    hint: '金属挡板开双缝：平面波过缝后两子波相干，下游出现明暗干涉条纹。',
    hintEn: 'PEC barrier with two slits: post-slit coherent wavelets form bright/dark fringes downstream.',
  },
  {
    id: 'lens',
    label: '介质透镜',
    labelEn: 'Dielectric lens',
    boundary: 'cpml',
    eps: epsLens,
    fresnelEps: [1, EPS2],
    hint: `平凸介质透镜（εR=${EPS2}）：平面波经透镜相位延迟会聚，右侧出现焦斑。`,
    hintEn: `Plano-convex dielectric lens (εR=${EPS2}): phase delay focuses a plane wave; a focal spot appears on the right.`,
  },
  {
    id: 'cavity',
    label: '金属壁谐振腔',
    labelEn: 'Metal cavity',
    boundary: 'pec',
    pec: pecCavity,
    hint: '封闭金属矩形腔：内部源激发的波被四壁全反射，叠加成驻波（谐振模式）。',
    hintEn: 'Closed metal box: interior sources reflect off four walls and form standing-wave cavity modes.',
  },
]
