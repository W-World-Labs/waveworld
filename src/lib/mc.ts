// 路径效率蒙特卡洛（纯 CPU 核心，供 TDD 与无 GPU 兜底）。
// 每条边效率有区间 [min,max]，真实效率不确定。对每条路径做 N 次抽样：
// 各跳 η ~ U[min,max]，累积效率 = 连乘；得到分布（均值/分位），用于稳健排序。

export interface McHop { min: number; max: number }
export interface McPath { hops: McHop[] }
export interface McStat { mean: number; p10: number; p50: number; p90: number; min: number; max: number }

/** 确定性 RNG（mulberry32），同种子可复现。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 统计量（均值 + p10/p50/p90 + 极值）。 */
export function mcStats(vals: Float32Array | number[]): McStat {
  const n = vals.length
  if (n === 0) return { mean: 0, p10: 0, p50: 0, p90: 0, min: 0, max: 0 }
  let mean = 0
  for (let i = 0; i < n; i++) mean += vals[i]
  mean /= n
  const sorted = Float32Array.from(vals).sort()
  const q = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))]
  return { mean, p10: q(0.1), p50: q(0.5), p90: q(0.9), min: sorted[0], max: sorted[n - 1] }
}

/** 单条路径的 N 次累积效率抽样。
 *  每跳先规范化区间：非负、min/max 交换可互换、非有限 → 0。
 *  Paths UI 经 chainEffInterval 把 COP 封顶到 1 再入 MC；此处仍允许 max>1 的原始 COP 抽样。 */
export function samplePath(path: McPath, N: number, r: () => number): Float32Array {
  const out = new Float32Array(N)
  for (let t = 0; t < N; t++) {
    let prod = 1
    for (const h of path.hops) {
      const lo = Math.max(0, Math.min(h.min, h.max))
      const hi = Math.max(lo, Math.max(h.min, h.max))
      let u = lo + (hi - lo) * r()
      if (!Number.isFinite(u)) u = 0
      prod *= u
    }
    out[t] = prod
  }
  return out
}

/** 对多条路径做蒙特卡洛，返回每条的统计量（CPU）。 */
export function monteCarloCPU(paths: McPath[], N: number, seed = 1): McStat[] {
  const r = rng(seed)
  return paths.map((p) => mcStats(samplePath(p, N, r)))
}
