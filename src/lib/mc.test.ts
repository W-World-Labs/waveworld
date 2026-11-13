import { describe, it, expect } from 'vitest'
import { rng, mcStats, samplePath, monteCarloCPU, type McPath } from './mc'

describe('蒙特卡洛路径稳健性', () => {
  it('RNG 确定性 + 落在 [0,1)', () => {
    const a = rng(42), b = rng(42)
    for (let i = 0; i < 5; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('mcStats 分位/均值正确', () => {
    const v = Array.from({ length: 101 }, (_, i) => i / 100) // 0..1
    const s = mcStats(v)
    expect(s.mean).toBeCloseTo(0.5, 2)
    expect(s.p50).toBeCloseTo(0.5, 2)
    expect(s.p10).toBeCloseTo(0.1, 2)
    expect(s.p90).toBeCloseTo(0.9, 2)
    expect(s.min).toBeCloseTo(0, 6)
    expect(s.max).toBeCloseTo(1, 6)
  })

  it('均值 ≈ 各跳中点连乘（独立均匀 E[∏U]=∏E[U]）', () => {
    const path: McPath = { hops: [{ min: 0.2, max: 0.4 }, { min: 0.6, max: 1.0 }] }
    const stat = mcStats(samplePath(path, 20000, rng(7)))
    const analytic = 0.3 * 0.8 // 中点连乘
    expect(stat.mean).toBeCloseTo(analytic, 2)
    expect(stat.p10).toBeLessThan(stat.p50)
    expect(stat.p50).toBeLessThan(stat.p90)
  })

  it('monteCarloCPU 多路径 + 同种子复现', () => {
    const paths: McPath[] = [
      { hops: [{ min: 0.8, max: 0.9 }] },
      { hops: [{ min: 0.5, max: 0.6 }, { min: 0.9, max: 0.95 }] },
    ]
    const a = monteCarloCPU(paths, 5000, 11)
    const b = monteCarloCPU(paths, 5000, 11)
    expect(a[0].mean).toBe(b[0].mean)
    expect(a.length).toBe(2)
    expect(a[0].mean).toBeGreaterThan(a[1].mean) // 单跳高效率 > 两跳
  })

  it('空 hops → 连乘恒为 1；N=0 → 空数组', () => {
    const emptyHops = samplePath({ hops: [] }, 8, rng(1))
    expect(emptyHops.length).toBe(8)
    for (let i = 0; i < emptyHops.length; i++) expect(emptyHops[i]).toBe(1)
    expect(samplePath({ hops: [{ min: 0.5, max: 0.6 }] }, 0, rng(1)).length).toBe(0)
  })

  it('max>1（原始 COP）仍可抽样；交换 min/max 与 NaN 安全', () => {
    // 文档：Paths 经 chainEffInterval 封顶到 1；此处允许 raw COP>1
    const cop = samplePath({ hops: [{ min: 2, max: 4 }] }, 2000, rng(3))
    const s = mcStats(cop)
    expect(s.mean).toBeCloseTo(3, 1)
    expect(s.min).toBeGreaterThanOrEqual(2)
    expect(s.max).toBeLessThanOrEqual(4)

    const swapped = samplePath({ hops: [{ min: 0.8, max: 0.2 }] }, 3000, rng(5))
    expect(mcStats(swapped).mean).toBeCloseTo(0.5, 1)

    const bad = samplePath({ hops: [{ min: NaN, max: NaN }] }, 4, rng(9))
    for (let i = 0; i < bad.length; i++) {
      expect(Number.isFinite(bad[i])).toBe(true)
      expect(bad[i]).toBe(0)
    }
  })
})
