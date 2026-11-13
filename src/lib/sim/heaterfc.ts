// 瞬态热扩散（热方程 ∂T/∂t = κ ∂²T/∂x²）的显式 FTCS 解 + 误差函数解析解对拍。
// 经典精确解：阶跃初值（x<x0 处 T=1、x>x0 处 T=0）→ T(x,t)=½·erfc((x−x0)/(2√(κt)))。
// 数值解有时空离散误差；有限域固定端点与无限域解析参考也可能不同。

export const HEAT_1D_M = 201, HEAT_1D_L = 10, HEAT_1D_X0 = 5
export type Heat1DScene = { kappa: number; steps: number }

/** 误差函数 erf（Abramowitz & Stegun 7.1.26 有理逼近，|误差|<1.5e-7）。 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return sign * y
}

/** 互补误差函数 erfc(x)=1−erf(x)。 */
export function erfc(x: number): number {
  return 1 - erf(x)
}

/** 阶跃初值热扩散的解析解：T(x,t)=½·erfc((x−x0)/(2√(κt)))（x<x0 起初热 T=1）。 */
export function heatStepSolution(x: number, t: number, kappa: number, x0: number): number {
  if (t <= 0) return x < x0 ? 1 : x > x0 ? 0 : 0.5
  return 0.5 * erfc((x - x0) / (2 * Math.sqrt(kappa * t)))
}

/** 扩散长度 √(κt)（界面展宽 ∝ √t 的标度）。 */
export function diffusionLength(t: number, kappa: number): number {
  return Math.sqrt(kappa * t)
}

export interface Heat1D {
  M: number          // 格点数
  L: number          // 物理长度
  dx: number
  kappa: number
  dt: number
  r: number          // 稳定数 κ·dt/dx²（≤0.5 稳定）
  x0: number         // 初始界面位置
  T: Float32Array
  t: number
}

/** 1D 阶跃初值热扩散，CFL 自动取 r=0.4 选 dt。
 *  t0=0：从锐利阶跃起（页面演示用，视觉冲击）；t0>0：从解析 erfc(t0) 起（已平滑、网格可解析，严格对拍用）。 */
export function initHeat1D(M: number, L: number, kappa: number, x0: number, t0 = 0): Heat1D {
  const dx = L / (M - 1)
  const r = 0.4
  const dt = (r * dx * dx) / kappa
  const T = new Float32Array(M)
  if (t0 > 0) {
    for (let i = 0; i < M; i++) T[i] = heatStepSolution(i * dx, t0, kappa, x0)
  } else {
    for (let i = 0; i < M; i++) T[i] = i * dx < x0 ? 1 : i * dx > x0 ? 0 : 0.5
  }
  return { M, L, dx, kappa, dt, r, x0, T, t: t0 }
}

/** 一步 FTCS：T_i += r·(T_{i+1}−2T_i+T_{i−1})。两端 Dirichlet 固定为远场值（1/0）。 */
export function ftcsStep(h: Heat1D): void {
  const { M, r, T } = h
  const next = new Float32Array(M)
  next[0] = T[0]; next[M - 1] = T[M - 1] // 远场 Dirichlet（界面未到边界前 = 无限域）
  for (let i = 1; i < M - 1; i++) next[i] = T[i] + r * (T[i + 1] - 2 * T[i] + T[i - 1])
  h.T = next
  h.t += h.dt
}

/** 当前数值剖面与解析解的最大偏差（对拍护栏量化指标）。 */
export function maxErfcError(h: Heat1D): number {
  let m = 0
  for (let i = 0; i < h.M; i++) {
    const err = Math.abs(h.T[i] - heatStepSolution(i * h.dx, h.t, h.kappa, h.x0))
    if (err > m) m = err
  }
  return m
}

export function heat1DResult(h: Heat1D, steps: number) {
  return {
    steps, time: h.t, dt: h.dt, temperatures: Array.from(h.T),
    reference: Array.from({ length: h.M }, (_, i) => heatStepSolution(i * h.dx, h.t, h.kappa, h.x0)),
    diffusionLength: diffusionLength(h.t, h.kappa), maxError: maxErfcError(h),
  }
}
