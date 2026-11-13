import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_LEVELSET_ADVECT,
  METHOD_LEVEL_SET,
  advectLevelsetStep,
  godunovGradMag,
  interiorVolume,
  reinitializeSdf,
  runLevelsetAdvectSample,
  smoothSign,
} from './levelset-l2-algos'
import {
  reinitResidual,
  sampleCircleSdf,
} from './levelset-algos'
import { methodById } from '../../data/methods/methods'

describe('水平集 L2 · reinit + 常速平流', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(METHOD_LEVEL_SET).toBe('method-level-set')
    expect(METHOD_ALGO_LEVELSET_ADVECT).toBe('method-algo-levelset-advect')
    const m = methodById(METHOD_LEVEL_SET)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
  })

  it('smoothSign：零附近光滑，大 |φ| 逼近 ±1', () => {
    expect(smoothSign(0, 0.1)).toBeCloseTo(0, 12)
    expect(smoothSign(10, 0.1)).toBeCloseTo(1, 3)
    expect(smoothSign(-10, 0.1)).toBeCloseTo(-1, 3)
  })

  it('godunovGradMag：平坦梯度为 0', () => {
    expect(godunovGradMag(0, 0, 0, 0, 1)).toBe(0)
  })

  it('扭曲场 reinit 后 |∇φ| 均值残差下降', () => {
    const n = 49
    const { phi, dx, dy } = sampleCircleSdf(n, n, { cx: 0.5, cy: 0.5, R: 0.25 })
    // 人为缩放破坏 |∇φ|=1
    const warped = new Float64Array(phi.length)
    for (let i = 0; i < phi.length; i++) warped[i] = 1.8 * phi[i]!
    const before = reinitResidual(warped, n, n, dx, dy)
    const fixed = reinitializeSdf(warped, n, n, dx, dy, 80, 0.45)
    const after = reinitResidual(fixed, n, n, dx, dy)
    expect(before.meanRes).toBeGreaterThan(0.5)
    expect(after.meanRes).toBeLessThan(before.meanRes * 0.5)
    expect(after.meanRes).toBeLessThan(0.35)
  })

  it('常速平流一步：均匀场不变', () => {
    const n = 16
    const phi = new Float64Array(n * n).fill(1.2)
    const next = advectLevelsetStep(phi, n, n, 1 / n, 1 / n, 0.01, 1, 0)
    for (let i = 0; i < next.length; i++) expect(next[i]).toBeCloseTo(1.2, 10)
  })

  it('interiorVolume：大圆 > 小圆', () => {
    const n = 41
    const big = sampleCircleSdf(n, n, { R: 0.3 })
    const small = sampleCircleSdf(n, n, { R: 0.15 })
    const vb = interiorVolume(big.phi, n, n, big.dx, big.dy)
    const vs = interiorVolume(small.phi, n, n, small.dx, small.dy)
    expect(vb).toBeGreaterThan(vs)
    expect(vs).toBeGreaterThan(0)
  })

  it('runLevelsetAdvectSample：体积近似守恒、界面平移、有限', () => {
    const r = runLevelsetAdvectSample(57, { ux: 0.35, uy: 0.05, steps: 36, cfl: 0.35 })
    expect(r.methodId).toBe(METHOD_ALGO_LEVELSET_ADVECT)
    expect(r.familyId).toBe(METHOD_LEVEL_SET)
    expect(r.finite).toBe(true)
    expect(r.volRelErr).toBeLessThan(0.12)
    expect(r.meanGradResF).toBeLessThan(0.35)
    // 质心应向 +x 移动，误差相对位移量可接受
    expect(r.centroidShiftX).toBeGreaterThan(0)
    expect(r.shiftErr).toBeLessThan(Math.max(0.08, 0.35 * Math.abs(r.expectedShiftX)))
  })
})
