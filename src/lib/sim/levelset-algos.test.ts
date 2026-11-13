import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_SDF_CIRCLE,
  METHOD_LEVEL_SET,
  reinitResidual,
  runSdfCircleSample,
  sampleCircleSdf,
  signedDistanceCircle,
} from './levelset-algos'
import { methodById } from '../../data/methods/methods'

describe('水平集 · 圆符号距离 SDF', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(METHOD_LEVEL_SET).toBe('method-level-set')
    expect(METHOD_ALGO_SDF_CIRCLE).toBe('method-algo-sdf-circle')
    const m = methodById(METHOD_LEVEL_SET)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
  })

  it('圆心 / 界面 / 外部符号正确', () => {
    const cx = 0
    const cy = 0
    const R = 2
    expect(signedDistanceCircle(0, 0, cx, cy, R)).toBeCloseTo(-2, 12)
    expect(signedDistanceCircle(R, 0, cx, cy, R)).toBeCloseTo(0, 12)
    expect(signedDistanceCircle(0, R, cx, cy, R)).toBeCloseTo(0, 12)
    expect(signedDistanceCircle(3, 0, cx, cy, R)).toBeCloseTo(1, 12)
    expect(signedDistanceCircle(0, 4, cx, cy, R)).toBeCloseTo(2, 12)
  })

  it('理想圆 SDF 的 |∇φ|≈1（重新初始化残差小）', () => {
    const n = 81
    const { phi, dx, dy } = sampleCircleSdf(n, n, {
      cx: 0.5,
      cy: 0.5,
      R: 0.25,
    })
    const { maxRes, meanRes, samples } = reinitResidual(phi, n, n, dx, dy)
    expect(samples).toBeGreaterThan(0)
    // 中心差分在光滑区极准；圆心奇点邻域抬高 max，mean 仍应很小
    expect(meanRes).toBeLessThan(0.05)
    expect(maxRes).toBeLessThan(1.5)
  })

  it('runSdfCircleSample：中心负、界面≈0', () => {
    const r = runSdfCircleSample(65)
    expect(r.methodId).toBe(METHOD_ALGO_SDF_CIRCLE)
    expect(r.familyId).toBe(METHOD_LEVEL_SET)
    expect(r.phiCenter).toBeCloseTo(-r.R, 5)
    expect(r.phiCenter).toBeLessThan(0)
    expect(Math.abs(r.phiInterface)).toBeLessThan(1e-12)
    expect(r.meanGradRes).toBeLessThan(0.08)
  })
})
