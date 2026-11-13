import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_LEVELSET_REINIT,
  METHOD_LEVEL_SET,
  LEVELSET_L4_METHOD_IDS,
  godunovGradMag1d,
  gradMagResidual1d,
  reinitialize1d,
  reinitStep1d,
  runLevelsetReinitSample,
  sample1dSignedDistance,
  smoothSign,
} from './levelset-l4-algos'
import { methodById } from '../../data/methods/methods'

describe('水平集 L4 · SDF reinit / redistancing', () => {
  it('方法 id 常量（reinit 为未入库新 id）', () => {
    expect(METHOD_LEVEL_SET).toBe('method-level-set')
    expect(METHOD_ALGO_LEVELSET_REINIT).toBe('method-algo-levelset-reinit')
    expect(LEVELSET_L4_METHOD_IDS).toContain(METHOD_ALGO_LEVELSET_REINIT)
    expect(methodById(METHOD_LEVEL_SET)).toBeDefined()
  })

  it('smoothSign：零附近光滑，大 |φ| 逼近 ±1', () => {
    expect(smoothSign(0, 0.1)).toBeCloseTo(0, 12)
    expect(smoothSign(10, 0.1)).toBeCloseTo(1, 3)
    expect(smoothSign(-10, 0.1)).toBeCloseTo(-1, 3)
  })

  it('godunovGradMag1d：平坦梯度为 0', () => {
    expect(godunovGradMag1d(0, 0, 1)).toBe(0)
    expect(godunovGradMag1d(0, 0, -1)).toBe(0)
  })

  it('解析 1D SDF：|dφ/dx|≈1', () => {
    const { phi, dx, x0 } = sample1dSignedDistance(65, { x0: 0.5 })
    const r = gradMagResidual1d(phi, dx, { skipBand: 2 * dx, x0 })
    expect(r.meanAbsGrad).toBeCloseTo(1, 10)
    expect(r.meanRes).toBeLessThan(1e-12)
  })

  it('缩放扰动后 reinit 使 |dφ/dx| 回到 ≈1', () => {
    const n = 101
    const { phi, dx, x0 } = sample1dSignedDistance(n, { x0: 0.5 })
    const scale = 3
    const pert = new Float64Array(n)
    for (let i = 0; i < n; i++) pert[i] = scale * phi[i]!

    const cfl = 0.45
    const steps = Math.ceil(0.55 / (cfl * dx)) + 10
    const maxDist = 0.35
    const r0 = gradMagResidual1d(pert, dx, { skipBand: 3 * dx, maxDist, x0 })
    expect(r0.meanAbsGrad).toBeCloseTo(scale, 1)

    const out = reinitialize1d(pert, dx, steps, cfl)
    const rF = gradMagResidual1d(out, dx, { skipBand: 3 * dx, maxDist, x0 })
    expect(Math.abs(rF.meanAbsGrad - 1)).toBeLessThan(0.15)
    expect(rF.meanRes).toBeLessThan(r0.meanRes * 0.5)
    // 零等值面附近：符号从负到正
    const mid = (n / 2) | 0
    expect(out[mid - 4]!).toBeLessThan(0)
    expect(out[mid + 4]!).toBeGreaterThan(0)
  })

  it('reinitStep1d 单步：平坦非单位场向 |g|=1 推进', () => {
    // 常值斜率 2：φ = 2(x−0.5)
    const n = 33
    const { dx } = sample1dSignedDistance(n)
    const phi0 = new Float64Array(n)
    for (let i = 0; i < n; i++) phi0[i] = 2 * (i * dx - 0.5)
    const next = reinitStep1d(phi0, phi0, dx, 0.3 * dx)
    // 中点 |φ| 小；远离界面处 |φ| 应略减小（梯度向 1 收缩）
    const iFar = n - 3
    expect(Math.abs(next[iFar]!)).toBeLessThan(Math.abs(phi0[iFar]!))
    expect(next.every(Number.isFinite)).toBe(true)
  })

  it('runLevelsetReinitSample ok', () => {
    const r = runLevelsetReinitSample({ n: 129, scale: 2.5 })
    expect(r.methodId).toBe(METHOD_ALGO_LEVELSET_REINIT)
    expect(r.familyId).toBe(METHOD_LEVEL_SET)
    expect(r.ok).toBe(true)
    expect(r.improved).toBe(true)
    expect(r.nearUnit).toBe(true)
    expect(r.finite).toBe(true)
    expect(Math.abs(r.meanAbsGradF - 1)).toBeLessThan(0.15)
  })
})
