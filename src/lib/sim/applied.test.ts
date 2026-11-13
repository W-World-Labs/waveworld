import { describe, it, expect } from 'vitest'
import { trilaterate, dist, rangeResolution, type Pt } from './trilateration'
import { steadyPhotons, thresholdPump } from './laser'
import { ljForce, LJ_MIN, deflection, scanLine } from './afm'

describe('多边定位 trilateration', () => {
  const anchors: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]

  it('精确测距 → 精确还原目标', () => {
    const target = { x: 3.7, y: 6.2 }
    const ranges = anchors.map((a) => dist(a, target))
    const est = trilaterate(anchors, ranges)
    expect(est.x).toBeCloseTo(target.x, 6)
    expect(est.y).toBeCloseTo(target.y, 6)
  })

  it('含噪测距 → 估计接近真值', () => {
    const target = { x: 7, y: 2 }
    let seed = 1
    const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 0.2 }
    const ranges = anchors.map((a) => dist(a, target) + noise())
    const est = trilaterate(anchors, ranges)
    expect(dist(est, target)).toBeLessThan(0.5)
  })

  it('分辨率随频率提高（波长变短）', () => {
    expect(rangeResolution(1, 10)).toBeLessThan(rangeResolution(1, 2))
  })
})

describe('激光速率方程', () => {
  it('泵浦低于阈值 → 光子数近零；高于阈值 → 起振', () => {
    const Pth = thresholdPump()
    const below = steadyPhotons(Pth * 0.5)
    const above = steadyPhotons(Pth * 3)
    expect(below).toBeLessThan(1)
    expect(above).toBeGreaterThan(below * 20)
  })
  it('泵浦越强稳态输出越高（阈上单调）', () => {
    const Pth = thresholdPump()
    expect(steadyPhotons(Pth * 4)).toBeGreaterThan(steadyPhotons(Pth * 2))
  })
})

describe('AFM Lennard-Jones', () => {
  it('LJ 力：平衡点为零、近排斥、远吸引', () => {
    const d0 = LJ_MIN(1)
    expect(ljForce(d0, 1, 1)).toBeCloseTo(0, 6)
    expect(ljForce(d0 * 0.85, 1, 1)).toBeGreaterThan(0) // 近 → 排斥
    expect(ljForce(d0 * 1.5, 1, 1)).toBeLessThan(0)     // 远 → 吸引
  })
  it('悬臂偏转 = 力/劲度', () => {
    expect(deflection(8, 4)).toBeCloseTo(2, 9)
  })
  it('扫描：表面凸起处间距变小、力更强 → 偏转可分辨', () => {
    const surf = [0, 0, 0, 1, 1, 1, 0, 0]
    const z = scanLine(surf, 2.2, 5)
    expect(z.length).toBe(surf.length)
    expect(z.every((v) => Number.isFinite(v))).toBe(true)
    // 凸起处(高度1)与平地(高度0)的偏转应不同
    expect(z[4]).not.toBeCloseTo(z[0], 3)
  })
})
