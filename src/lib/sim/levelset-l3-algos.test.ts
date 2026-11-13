import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_LEVELSET_CURVATURE,
  METHOD_LEVEL_SET,
  meanCurvatureAt,
  runLevelsetCurvatureSample,
  sampleCurvatureNearInterface,
} from './levelset-l3-algos'
import { sampleCircleSdf } from './levelset-algos'
import { methodById } from '../../data/methods/methods'

describe('水平集 L3 · 平均曲率 κ from φ', () => {
  it('方法 id 对齐 level-set catalog', () => {
    expect(METHOD_LEVEL_SET).toBe('method-level-set')
    expect(METHOD_ALGO_LEVELSET_CURVATURE).toBe('method-algo-levelset-curvature')
    expect(methodById(METHOD_LEVEL_SET)).toBeDefined()
    expect(methodById(METHOD_ALGO_LEVELSET_CURVATURE)?.parentId).toBe(
      METHOD_LEVEL_SET,
    )
  })

  it('圆 SDF 界面附近 κ ≈ 1/R', () => {
    const R = 0.3
    const n = 81
    const { phi, dx, dy } = sampleCircleSdf(n, n, { cx: 0.5, cy: 0.5, R })
    const { meanK, samples } = sampleCurvatureNearInterface(
      phi,
      n,
      n,
      dx,
      dy,
      2.5 * dx,
    )
    expect(samples).toBeGreaterThan(10)
    expect(meanK).toBeCloseTo(1 / R, 1)
  })

  it('单点曲率在界面为正（外法向 / 圆）', () => {
    const R = 0.25
    const n = 65
    const { phi, dx, dy } = sampleCircleSdf(n, n, { cx: 0.5, cy: 0.5, R })
    // 界面附近一点：cx+R
    const i = Math.round((0.5 + R) / dx)
    const j = Math.round(0.5 / dy)
    const k = meanCurvatureAt(phi, n, n, dx, dy, i, j)
    expect(k).toBeGreaterThan(0)
    expect(Math.abs(k - 1 / R) / (1 / R)).toBeLessThan(0.35)
  })

  it('runLevelsetCurvatureSample ok', () => {
    const r = runLevelsetCurvatureSample({ n: 73, R: 0.27 })
    expect(r.methodId).toBe(METHOD_ALGO_LEVELSET_CURVATURE)
    expect(r.familyId).toBe(METHOD_LEVEL_SET)
    expect(r.ok).toBe(true)
    expect(r.relErr).toBeLessThan(0.15)
    expect(r.meanK).toBeGreaterThan(0)
  })
})
