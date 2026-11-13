// src/lib/sim/rdf.ts
// 径向分布函数 g(r)：成对距离直方图按理想气体密度归一（结构分析标准输出）。
// 纯函数后处理，只读回绕坐标 pos（吃 mdSim.read().pos），与积分器/力核解耦。
// 口径约定：只遍历 i<j 计一次成对距离，归一时乘 2 还原「每中心粒子」对数。

export interface RdfResult {
  r: Float32Array      // 每 bin 中心半径 (k+0.5)·dr
  g: Float32Array      // 归一后 g(r)
  nBins: number
  rMax: number
  pairCount: number    // 落入 [0,rMax) 的成对计数（校验用）
}

/** dim=2 环面积 / dim=3 球壳体积。 */
function shellVolume(rIn: number, rOut: number, dim: number): number {
  if (dim === 2) return Math.PI * (rOut * rOut - rIn * rIn)
  return (4 / 3) * Math.PI * (rOut * rOut * rOut - rIn * rIn * rIn)
}

/** 单组分 g(r)。O(N²) 最小镜像成对距离直方图 + 理想气体归一。rMax 软钳到 L/2。 */
export function radialDistribution(
  pos: Float32Array, L: number, N: number, dim: number, nBins: number, rMax: number,
): RdfResult {
  const rm = Math.min(rMax, L / 2) // 最小镜像有效域
  const dr = rm / nBins
  const hist = new Float64Array(nBins)
  let pairCount = 0
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let r2 = 0
      for (let k = 0; k < dim; k++) {
        let dk = pos[i * dim + k] - pos[j * dim + k]
        dk -= L * Math.round(dk / L) // 周期最小镜像
        r2 += dk * dk
      }
      if (r2 <= 0) continue
      const rr = Math.sqrt(r2)
      if (rr >= rm) continue
      hist[Math.floor(rr / dr)]++
      pairCount++
    }
  }
  const V = Math.pow(L, dim)
  const rho = N / V
  const r = new Float32Array(nBins)
  const g = new Float32Array(nBins)
  for (let k = 0; k < nBins; k++) {
    const rIn = k * dr, rOut = (k + 1) * dr
    const shell = shellVolume(rIn, rOut, dim)
    r[k] = (k + 0.5) * dr
    g[k] = shell > 0 ? (2 * hist[k] / N) / (rho * shell) : 0
  }
  return { r, g, nBins, rMax: rm, pairCount }
}

/**
 * 物种分辨 g_ab(r)。species 为物种枚举编码（吃 particleSim.read().kind）。
 * a===b：同种 i<j 对，乘 2 还原；a≠b：跨种有序对（a 中心看 b 邻居），不乘 2。
 * N_a 或 N_b 为 0 时早返回全 0。
 */
export function radialDistributionAB(
  pos: Float32Array, species: Uint8Array, a: number, b: number,
  L: number, N: number, dim: number, nBins: number, rMax: number,
): RdfResult {
  const rm = Math.min(rMax, L / 2)
  const dr = rm / nBins
  const hist = new Float64Array(nBins)
  let Na = 0, Nb = 0
  for (let i = 0; i < N; i++) { if (species[i] === a) Na++; if (species[i] === b) Nb++ }
  const r = new Float32Array(nBins), g = new Float32Array(nBins)
  for (let k = 0; k < nBins; k++) r[k] = (k + 0.5) * dr
  if (Na === 0 || Nb === 0) return { r, g, nBins, rMax: rm, pairCount: 0 }
  const same = a === b
  let pairCount = 0
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const match = same
        ? (species[i] === a && species[j] === a)
        : ((species[i] === a && species[j] === b) || (species[i] === b && species[j] === a))
      if (!match) continue
      let r2 = 0
      for (let k = 0; k < dim; k++) {
        let dk = pos[i * dim + k] - pos[j * dim + k]
        dk -= L * Math.round(dk / L)
        r2 += dk * dk
      }
      if (r2 <= 0) continue
      const rr = Math.sqrt(r2)
      if (rr >= rm) continue
      hist[Math.floor(rr / dr)]++
      pairCount++
    }
  }
  const V = Math.pow(L, dim)
  const rhoB = Nb / V
  const factor = same ? 2 : 1 // 同种乘 2 还原；异种已是有序中心-邻居口径
  for (let k = 0; k < nBins; k++) {
    const rIn = k * dr, rOut = (k + 1) * dr
    const shell = shellVolume(rIn, rOut, dim)
    g[k] = shell > 0 ? (factor * hist[k] / Na) / (rhoB * shell) : 0
  }
  return { r, g, nBins, rMax: rm, pairCount }
}
