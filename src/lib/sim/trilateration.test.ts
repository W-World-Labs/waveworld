import { describe, it, expect } from 'vitest'
import { trilaterate, dist, type Pt } from './trilateration'

describe('trilaterate — 多边定位', () => {
  it('已知 3 锚点精确距离应还原目标点', () => {
    const anchors: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]
    const target: Pt = { x: 40, y: 30 }
    const ranges = anchors.map((a) => dist(a, target))
    const est = trilaterate(anchors, ranges)
    expect(dist(est, target)).toBeLessThan(1e-6)
  })

  it('空锚点 / 过少锚点 / ranges 不足 → 安全回退', () => {
    expect(trilaterate([], [])).toEqual({ x: 0, y: 0 })
    expect(trilaterate([{ x: 1, y: 2 }], [5])).toEqual({ x: 1, y: 2 })
    expect(trilaterate(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [1, 1],
    )).toEqual({ x: 0, y: 0 })
    // ranges 比 anchors 短
    expect(trilaterate(
      [{ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
      [1, 1],
    )).toEqual({ x: 3, y: 4 })
  })

  it('共线锚点 det≈0 → 回退到锚点 0', () => {
    const anchors: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]
    const ranges = [5, 5, 15]
    const est = trilaterate(anchors, ranges)
    expect(est).toEqual({ x: 0, y: 0 })
  })
})
