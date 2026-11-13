/**
 * 二维波动方程 FD 方法族 · Laplacian / 蛙跳 CFL 纯函数样例入口。
 * 对应 method-wave-fd；装配 wave.ts 的 laplacian 与 Wave 解算器。
 */
import { Wave, laplacian } from './wave'

export const WAVE_PARENT = 'method-wave-fd'

const IX = (x: number, y: number, N: number) => x + y * N

/**
 * 已知正弦基模场上的离散 Laplacian。
 * u = sin(π x/(N-1)) sin(π y/(N-1))：峰值处曲率为负；
 * lap/u 应接近连续极限 −2 (π/(N-1))²（单位格距）。
 */
export function runLaplacianSineSample(N = 33): {
  uPeak: number
  lapPeak: number
  ratio: number
  continuousRatio: number
  uniformLap: number
} {
  const u = new Float32Array(N * N)
  const L = N - 1
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      u[IX(x, y, N)] = Math.sin((Math.PI * x) / L) * Math.sin((Math.PI * y) / L)
    }
  }
  const cx = Math.floor(N / 2)
  const cy = Math.floor(N / 2)
  const uPeak = u[IX(cx, cy, N)]!
  const lapPeak = laplacian(u, cx, cy, N)
  const ratio = lapPeak / uPeak
  // 连续 ∇² sin(kx)sin(ky) = −(k²+k²)u，k=π/L
  const continuousRatio = -2 * (Math.PI / L) ** 2

  const flat = new Float32Array(N * N).fill(1)
  const uniformLap = laplacian(flat, cx, cy, N)

  return { uPeak, lapPeak, ratio, continuousRatio, uniformLap }
}

/**
 * 蛙跳一步残差 + CFL 安全系数下能量有界。
 * residualMax：对内点 |u_next − (2u − u_prev + a ∇²u)·damp| 的最大值（应≈0 浮点级）。
 */
export function runWaveCflSample(steps = 25): {
  a: number
  energy0: number
  energyF: number
  residualMax: number
  finite: boolean
} {
  const N = 40
  const a = 0.25 // CFL: a ≤ 0.5
  const damp = 1
  const w = new Wave(N, { a, damp })
  w.poke(N / 2, N / 2, 2, 4)
  const energy0 = w.energy()

  // 单步残差：复制当前/前一时刻，step 后对照更新式
  const uBefore = new Float32Array(w.u)
  const uPrevBefore = new Float32Array(w.uPrev)
  w.step()
  let residualMax = 0
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const k = IX(x, y, N)
      const expected =
        (2 * uBefore[k]! - uPrevBefore[k]! + a * laplacian(uBefore, x, y, N)) * damp
      const err = Math.abs(w.u[k]! - expected)
      if (err > residualMax) residualMax = err
    }
  }

  for (let s = 1; s < steps; s++) w.step()
  const energyF = w.energy()
  return {
    a,
    energy0,
    energyF,
    residualMax,
    finite: Number.isFinite(energyF) && energyF >= 0,
  }
}
