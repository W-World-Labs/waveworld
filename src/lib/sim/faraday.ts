// 电磁感应 · 法拉第定律 / 楞次定律 —— 解析核心
//
// 法拉第电磁感应定律：闭合回路中的感应电动势等于其磁链 Φ_total = N·Φ 随时间
// 变化率的负值，楞次定律给出的负号表明感应电流总是反抗磁通的变化：
//     ε = −N · dΦ/dt                                （法拉第–楞次）
// 动生电动势（导体棒以速度 v 切割磁感线）：
//     ε = B · L · v                                 （motional EMF）
// 匀强磁场中匀速旋转的线圈，磁通按余弦变化、EMF 按正弦变化，相差 90°：
//     Φ(t) = N·B·A·cos(ωt),   ε(t) = −dΦ/dt = N·B·A·ω·sin(ωt)
//
// 纯函数、无副作用、无 DOM，供页面与测试复用。
// 参考：Halliday, Resnick & Walker《Fundamentals of Physics》(10th ed.) Ch.30
//       Faraday's Law of Induction；Griffiths《Introduction to Electrodynamics》Ch.7。

import { param } from './params'
import { WasmFaraday } from './wasm-fields'

/**
 * 真空磁导率 μ₀（此处仅作带来源常数登记，旋转/动生公式直接以 B 为输入不显式用到）。
 * 来源：CRC Handbook of Chemistry and Physics / SI 定义值。
 */
export const MU_0 = param(
  1.25663706212e-6,
  'T·m/A',
  'CRC Handbook of Chemistry and Physics, 真空磁导率 μ₀',
  'node:electromagnetic',
)

/**
 * 法拉第–楞次感应电动势 ε = −N · dΦ/dt。
 * @param dPhiDt 单匝磁通的时间变化率 dΦ/dt（Wb/s）
 * @param N      线圈匝数
 * @returns      感应电动势 ε（V）；负号体现楞次定律（反抗磁通变化）
 */
export function inducedEMF(dPhiDt: number, N: number, owner = new WasmFaraday()): number {
  return owner.induced(dPhiDt, N)
}

/**
 * 动生电动势 ε = B · L · v（导体棒以速度 v 垂直切割磁感线）。
 * @param B 磁感应强度（T）
 * @param L 棒在磁场中的有效长度（m）
 * @param v 棒的运动速率（m/s）
 * @returns 动生电动势 ε（V）
 */
export function motionalEMF(B: number, L: number, v: number, owner = new WasmFaraday()): number {
  return owner.motional(B, L, v)
}

/**
 * 匀强磁场中匀速旋转线圈的瞬时磁链 Φ(t) = N·B·A·cos(ωt)。
 * t=0 取线圈平面法线与 B 平行（磁通最大）。
 * @param t     时间（s）
 * @param N     匝数
 * @param B     磁感应强度（T）
 * @param A     单匝线圈面积（m²）
 * @param omega 角速度 ω（rad/s）
 * @returns     磁链 N·Φ（Wb）
 */
export function rotatingCoilFlux(t: number, N: number, B: number, A: number, omega: number, owner = new WasmFaraday()): number {
  return owner.coilFlux(t, N, B, A, omega)
}

/**
 * 旋转线圈的瞬时感应电动势 ε(t) = −dΦ/dt = N·B·A·ω·sin(ωt)。
 * 与磁通相差 90°，峰值电动势 ε_peak = N·B·A·ω。
 * @param t     时间（s）
 * @param N     匝数
 * @param B     磁感应强度（T）
 * @param A     单匝线圈面积（m²）
 * @param omega 角速度 ω（rad/s）
 * @returns     感应电动势 ε（V）
 */
export function rotatingCoilEMF(t: number, N: number, B: number, A: number, omega: number, owner = new WasmFaraday()): number {
  return owner.coilEmf(t, N, B, A, omega)
}

/** 旋转线圈峰值电动势 ε_peak = N·B·A·ω（V）。 */
export function peakEMF(N: number, B: number, A: number, omega: number, owner = new WasmFaraday()): number {
  return owner.peak(N, B, A, omega)
}

/**
 * 由离散磁链时间序列数值求感应 EMF：ε = −N · dΦ/dt。
 * 内部点用中心差分，端点用前向/后向差分。
 * @param flux 磁链（单匝磁通 Φ）时间序列；若序列已含匝数则传 N=1
 * @param dt   采样时间步（s）
 * @param N    匝数（默认 1）
 * @returns    与 flux 等长的感应 EMF 序列（V）
 */
export function emfFromFluxSeries(flux: readonly number[], dt: number, N = 1, owner = new WasmFaraday(flux.length)): number[] {
  return owner.series(flux, dt, N)
}

export type FaradayScene = { omega: number; B: number; N: number; A: number; vBar: number; bMot: number; lBar: number }
export const FARADAY_SAMPLES = 361
/** Two complete periods; playback only selects a position on the returned curves. */
export function faradayResult(scene: FaradayScene, owner = new WasmFaraday()) {
  return owner.solve(scene)
}
