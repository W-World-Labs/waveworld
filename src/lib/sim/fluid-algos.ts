/**
 * Stable Fluids 方法族 · 扩散 / 平流 / 投影 子模块。
 */
import { IX, advect, diffuse, project } from './fluid'
import { childrenOf } from '../../data/methods/methods'

export const FLUID_PARENT = 'method-ns-stable-fluids'

export const FLUID_CHILD_IDS = [
  'method-algo-fluid-diffuse',
  'method-algo-fluid-advect',
  'method-algo-fluid-project',
  'method-algo-fluid-pipeline',
] as const

function zeros(N: number) {
  return new Float32Array(N * N)
}

/** 内部平均绝对散度（与 fluid.test 同度量）。 */
function meanAbsDiv(vx: Float32Array, vy: Float32Array, N: number): number {
  let s = 0
  let n = 0
  for (let j = 2; j < N - 2; j++) {
    for (let i = 2; i < N - 2; i++) {
      s += Math.abs(
        0.5 *
          (vx[IX(i + 1, j, N)] -
            vx[IX(i - 1, j, N)] +
            vy[IX(i, j + 1, N)] -
            vy[IX(i, j - 1, N)]),
      )
      n++
    }
  }
  return s / n
}

/** 投影：低频光滑散度场经 project 后平均 |div| 大幅下降。 */
export function runProjectSample(): { div0: number; divF: number } {
  const N = 32
  const vx = zeros(N)
  const vy = zeros(N)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      vx[IX(i, j, N)] = Math.sin((Math.PI * i) / N)
      vy[IX(i, j, N)] = Math.sin((Math.PI * j) / N)
    }
  }
  const div0 = meanAbsDiv(vx, vy, N)
  const p = zeros(N)
  const div = zeros(N)
  project(vx, vy, p, div, 400, N)
  const divF = meanAbsDiv(vx, vy, N)
  return { div0, divF }
}

/** 平流：标量斑块被均匀速度平移后质量近似守恒。 */
export function runAdvectSample(): { sum0: number; sumF: number } {
  const N = 32
  const d0 = zeros(N)
  const d = zeros(N)
  const vx = zeros(N)
  const vy = zeros(N)
  vx.fill(0.5)
  for (let j = 10; j < 14; j++)
    for (let i = 10; i < 14; i++) d0[i + j * N] = 1
  let sum0 = 0
  for (let i = 0; i < d0.length; i++) sum0 += d0[i]
  advect(0, d, d0, vx, vy, 0.1, N)
  let sumF = 0
  for (let i = 0; i < d.length; i++) sumF += d[i]
  return { sum0, sumF }
}

/** 扩散：尖峰摊平，总和守恒（近似）。 */
export function runDiffuseSample(): { peak0: number; peakF: number; sumRatio: number } {
  const N = 24
  const x0 = zeros(N)
  const x = zeros(N)
  x0[(N / 2) + (N / 2) * N] = 1
  let sum0 = 0
  let peak0 = 0
  for (let i = 0; i < x0.length; i++) {
    sum0 += x0[i]
    if (x0[i] > peak0) peak0 = x0[i]
  }
  x.set(x0)
  diffuse(0, x, x0, 0.1, 0.1, 96, N)
  let sumF = 0
  let peakF = 0
  for (let i = 0; i < x.length; i++) {
    sumF += x[i]
    if (x[i] > peakF) peakF = x[i]
  }
  return { peak0, peakF, sumRatio: sumF / sum0 }
}

export function fluidChildCount(): number {
  return childrenOf(FLUID_PARENT).length
}
