// src/lib/sim/rdf.test.ts
import { describe, it, expect } from 'vitest'
import { radialDistribution, radialDistributionAB } from './rdf'
import { rng } from '../mc'

describe('radialDistribution: 单组分 g(r)', () => {
  it('理想气体（均匀随机）g(r) 中段 ≈ 1', () => {
    const dim = 2, N = 600, L = 30
    const r = rng(7)
    const pos = new Float32Array(N * dim)
    for (let i = 0; i < N * dim; i++) pos[i] = r() * L
    const { r: rr, g } = radialDistribution(pos, L, N, dim, 60, L / 2)
    // 取中段 bin（避开 r→0 噪声与边界）平均 ≈ 1
    let sum = 0, cnt = 0
    for (let k = 0; k < g.length; k++) if (rr[k] > 2 && rr[k] < L / 2 - 1) { sum += g[k]; cnt++ }
    expect(sum / cnt).toBeCloseTo(1, 1) // |avg-1| < 0.05 量级
  })
  it('两粒子相距 r0 时只在对应 bin 非零，解析值匹配', () => {
    const dim = 2, N = 2, L = 20
    const r0 = 3.0
    const pos = new Float32Array([5, 5, 5 + r0, 5])
    const nBins = 40, rMax = L / 2
    const dr = rMax / nBins
    const { g } = radialDistribution(pos, L, N, dim, nBins, rMax)
    const kHit = Math.floor(r0 / dr)
    // 该 bin g = (2·1/N)/(ρ·shell)，ρ=N/V，shell=π(r_out²−r_in²)
    const V = L * L, rho = N / V
    const rIn = kHit * dr, rOut = (kHit + 1) * dr
    const shell = Math.PI * (rOut * rOut - rIn * rIn)
    const expected = (2 * 1 / N) / (rho * shell)
    expect(g[kHit]).toBeCloseTo(expected, 4)
    for (let k = 0; k < nBins; k++) if (k !== kHit) expect(g[k]).toBe(0)
  })
  it('rMax 软钳到 L/2（传 L 等同传 L/2，不重复计数）', () => {
    const dim = 2, N = 2, L = 20
    const pos = new Float32Array([2, 2, 5, 2])
    const a = radialDistribution(pos, L, N, dim, 30, L)
    const b = radialDistribution(pos, L, N, dim, 30, L / 2)
    expect(a.pairCount).toBe(b.pairCount)
  })
})

describe('radialDistribution: LJ 第一配位峰', () => {
  it('弛豫后液态第一峰落在 1.05~1.30（≈2^(1/6)σ）', async () => {
    const { initLattice, velocityVerlet } = await import('./md')
    const st = initLattice(64, 9, 2, 0.4, 5)
    for (let s = 0; s < 200; s++) velocityVerlet(st, 0.004)
    const { r, g } = radialDistribution(st.pos, st.L, st.N, 2, 80, st.L / 2)
    let kMax = 0
    for (let k = 1; k < g.length; k++) if (g[k] > g[kMax]) kMax = k
    expect(r[kMax]).toBeGreaterThan(1.0)
    expect(r[kMax]).toBeLessThan(1.35)
  })
})

describe('radialDistributionAB: 物种分辨 g_ab(r)', () => {
  it('a===b 全同种退化为单组分 g(r)（口径护栏）', () => {
    const dim = 2, N = 4, L = 20
    const pos = new Float32Array([2, 2, 5, 2, 8, 2, 11, 2])
    const species = new Uint8Array([0, 0, 0, 0]) // 全同种 0
    const ab = radialDistributionAB(pos, species, 0, 0, L, N, dim, 30, L / 2)
    const single = radialDistribution(pos, L, N, dim, 30, L / 2)
    for (let k = 0; k < ab.g.length; k++) expect(ab.g[k]).toBeCloseTo(single.g[k], 6)
  })
  it('缺席物种返回全 0、不抛错', () => {
    const dim = 2, N = 2, L = 20
    const pos = new Float32Array([2, 2, 5, 2])
    const species = new Uint8Array([0, 0]) // 无物种 1
    const ab = radialDistributionAB(pos, species, 0, 1, L, N, dim, 30, L / 2)
    expect(ab.pairCount).toBe(0)
    for (let k = 0; k < ab.g.length; k++) expect(ab.g[k]).toBe(0)
  })
  it('相分离佐证：PEDOT 聚簇 → g_00 第一峰 >1', () => {
    const dim = 2, N = 6, L = 30
    // 3 个物种0聚成簇，3 个物种1 远离
    const pos = new Float32Array([5, 5, 6, 5, 5, 6, 20, 20, 21, 20, 20, 21])
    const species = new Uint8Array([0, 0, 0, 1, 1, 1])
    const g00 = radialDistributionAB(pos, species, 0, 0, L, N, dim, 40, L / 2)
    let kMax = 0
    for (let k = 1; k < g00.g.length; k++) if (g00.g[k] > g00.g[kMax]) kMax = k
    expect(g00.g[kMax]).toBeGreaterThan(1)
  })
})
