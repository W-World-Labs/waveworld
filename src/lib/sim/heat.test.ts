import { describe, it, expect } from 'vitest'
import { stepHeat2D, sum, STABLE_R } from './heat'

describe('stepHeat2D — 热扩散有限差分', () => {
  const W = 8, H = 8
  const center = () => {
    const u = new Float32Array(W * H)
    u[(H / 2) * W + W / 2] = 100
    return u
  }

  it('绝热边界下总热量守恒', () => {
    let u: Float32Array = center()
    const s0 = sum(u)
    for (let i = 0; i < 50; i++) u = stepHeat2D(u, W, H, STABLE_R)
    expect(sum(u)).toBeCloseTo(s0, 3)
  })

  it('热点向四邻扩散：中心降、邻格升', () => {
    const u = center()
    const ci = (H / 2) * W + W / 2
    const before = u[ci]
    const v = stepHeat2D(u, W, H, STABLE_R)
    expect(v[ci]).toBeLessThan(before)
    expect(v[ci - 1]).toBeGreaterThan(0)
    expect(v[ci + 1]).toBeGreaterThan(0)
    expect(v[ci - W]).toBeGreaterThan(0)
    expect(v[ci + W]).toBeGreaterThan(0)
  })

  it('稳定（r≤0.25）：满足极值原理，不超出原值域', () => {
    let u: Float32Array = center()
    let max = 100, min = 0
    for (let i = 0; i < 100; i++) {
      u = stepHeat2D(u, W, H, STABLE_R)
      const m = Math.max(...u), n = Math.min(...u)
      expect(m).toBeLessThanOrEqual(max + 1e-4)
      expect(n).toBeGreaterThanOrEqual(min - 1e-4)
      max = Math.max(max, m); min = Math.min(min, n)
    }
  })

  it('趋于均匀：长时间后方差下降', () => {
    let u: Float32Array = center()
    const variance = (a: Float32Array) => {
      const m = sum(a) / a.length
      return a.reduce((acc, x) => acc + (x - m) ** 2, 0) / a.length
    }
    const v0 = variance(u)
    for (let i = 0; i < 200; i++) u = stepHeat2D(u, W, H, STABLE_R)
    expect(variance(u)).toBeLessThan(v0)
  })
})
