// src/lib/sim/diffusion.ts
// 扩散系数 D（Einstein 关系）：对 (t, MSD) 线性拟合斜率，D = slope/(2·dim)。
// 纯函数后处理，吃页面已累积的 msdHist + 时间轴，零新仿真状态、不碰 core。

/** 最小二乘线性拟合 y=slope·x+intercept，附 r²。 */
export function linearFit(x: ArrayLike<number>, y: ArrayLike<number>): { slope: number; intercept: number; r2: number; n: number } {
  const n = x.length
  if (n < 2) return { slope: 0, intercept: n === 1 ? y[0] : 0, r2: 0, n }
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; syy += y[i] * y[i] }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  const ssTot = syy - (sy * sy) / n
  const ssRes = syy - intercept * sy - slope * sxy
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
  return { slope, intercept, r2, n }
}

/** Einstein 扩散系数：拟合 (t, MSD) 扩散段斜率，D = slope/(2·dim)。
 * skipFraction：跳过前段弹道/瞬态（默认 0.2）只拟合尾部扩散段。 */
export function diffusionEinstein(
  t: ArrayLike<number>, msd: ArrayLike<number>, dim: number, opts?: { skipFraction?: number },
): { D: number; slope: number; intercept: number; r2: number; nFit: number } {
  const skip = opts?.skipFraction ?? 0.2
  const n = Math.min(t.length, msd.length)
  const start = Math.floor(n * skip)
  const xs: number[] = [], ys: number[] = []
  for (let i = start; i < n; i++) { xs.push(t[i]); ys.push(msd[i]) }
  const f = linearFit(xs, ys)
  return { D: f.slope / (2 * dim), slope: f.slope, intercept: f.intercept, r2: f.r2, nFit: xs.length }
}
