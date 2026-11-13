import { describe, it, expect } from 'vitest'
import { tdoaLocate, hyperbolaPoints, dist, tdoaResult, TDOA_ANCHORS, type Pt } from './tdoa'

describe('tdoaLocate — TDOA 双曲线定位', () => {
  it('disambiguates the outside-hull source using all receiver residuals', () => {
    // Selecting the smaller R0 root put this source near RX0, over 100 px away.
    for (const source of [{ x: 0, y: 380 }, { x: 640, y: 0 }, ...TDOA_ANCHORS]) {
      expect(tdoaResult({ source, noise: 0, seed: 11 }).err).toBeLessThan(1e-6)
    }
  })
  const anchors: Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
  ]
  const exactDiffs = (src: Pt): number[] => {
    const r0 = dist(src, anchors[0])
    return anchors.map((a) => dist(src, a) - r0)
  }

  it('精确距离差应还原真实信号源(中部)', () => {
    const src: Pt = { x: 37, y: 62 }
    const est = tdoaLocate(anchors, exactDiffs(src))
    expect(Math.abs(est.x - src.x)).toBeLessThan(1e-4)
    expect(Math.abs(est.y - src.y)).toBeLessThan(1e-4)
  })

  it('另一个源位置同样精确还原', () => {
    const src: Pt = { x: 80, y: 20 }
    const est = tdoaLocate(anchors, exactDiffs(src))
    expect(dist(est, src)).toBeLessThan(1e-4)
  })

  it('仅用 3 锚点也能定位', () => {
    const a3 = anchors.slice(0, 3)
    const src: Pt = { x: 25, y: 40 }
    const r0 = dist(src, a3[0])
    const diffs = a3.map((a) => dist(src, a) - r0)
    const est = tdoaLocate(a3, diffs)
    expect(dist(est, src)).toBeLessThan(1e-4)
  })
})

describe('hyperbolaPoints — 双曲线采样', () => {
  const a0: Pt = { x: -50, y: 0 }
  const ai: Pt = { x: 50, y: 0 }

  it('distance difference equal to the baseline is a ray, not an empty constraint', () => {
    for (const dr of [-100, 100]) {
      const points = hyperbolaPoints(a0, ai, dr, 4, 120)
      expect(points).toHaveLength(5)
      for (const p of points) expect(dist(p, ai) - dist(p, a0)).toBeCloseTo(dr, 10)
    }
  })

  it('采样点应满足约束 |P-ai|-|P-a0|=Δr', () => {
    const dr = 40
    const pts = hyperbolaPoints(a0, ai, dr, 30, 120)
    expect(pts.length).toBeGreaterThan(10)
    for (const p of pts) {
      const got = dist(p, ai) - dist(p, a0)
      expect(Math.abs(got - dr)).toBeLessThan(0.5)
    }
  })

  it('负距离差时另一支同样满足约束', () => {
    const dr = -60
    const pts = hyperbolaPoints(a0, ai, dr, 30, 120)
    expect(pts.length).toBeGreaterThan(10)
    for (const p of pts) {
      const got = dist(p, ai) - dist(p, a0)
      expect(Math.abs(got - dr)).toBeLessThan(0.5)
    }
  })

  it('距离差超过基线时无实双曲线(空集)', () => {
    const pts = hyperbolaPoints(a0, ai, 500, 30, 120)
    expect(pts.length).toBe(0)
  })
})
