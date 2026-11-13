import { describe, it, expect } from 'vitest'
import {
  METHOD_KALMAN,
  METHOD_ALGO_RTS_SMOOTH,
  RTS_PARENT,
  RTS_METHOD_IDS,
  kfPredict1d,
  kfUpdate1d,
  kfForward1d,
  rtsSmooth1d,
  mse1d,
  minVarGap,
  runRtsSmoothSample,
} from './rts-algos'

describe('RTS Kalman smoother · 1D linear', () => {
  it('方法 id 常量对齐 method-kalman 族', () => {
    expect(METHOD_KALMAN).toBe('method-kalman')
    expect(METHOD_ALGO_RTS_SMOOTH).toBe('method-algo-rts-smooth')
    expect(RTS_PARENT).toBe(METHOD_KALMAN)
    expect(RTS_METHOD_IDS).toContain(METHOD_ALGO_RTS_SMOOTH)
  })

  it('kfPredict1d: F=1,Q=0 保持状态', () => {
    const s = kfPredict1d({ x: 2, P: 0.5 }, 1, 0)
    expect(s.x).toBeCloseTo(2, 12)
    expect(s.P).toBeCloseTo(0.5, 12)
  })

  it('kfUpdate1d: z 量测拉近估计且 P 收缩', () => {
    const s0 = { x: 0, P: 1 }
    const s1 = kfUpdate1d(s0, 5, 1, 0.25)
    expect(s1.x).toBeCloseTo(4, 10)
    expect(s1.P).toBeCloseTo(0.2, 10)
    expect(s1.P).toBeLessThan(s0.P)
  })

  it('kfForward1d + rtsSmooth1d: 终端平滑=滤波; 方差不大于滤波', () => {
    const z = new Float64Array([1, 1.2, 0.8, 1.1, 0.9, 1.05, 0.95, 1])
    const fwd = kfForward1d(z, { x0: 0, P0: 1, F: 1, Q: 0.05, R: 0.25 })
    const sm = rtsSmooth1d(fwd, 1)
    const N = z.length
    expect(sm.xSmooth[N - 1]).toBeCloseTo(fwd.xFilt[N - 1]!, 12)
    expect(sm.pSmooth[N - 1]).toBeCloseTo(fwd.pFilt[N - 1]!, 12)
    const gap = minVarGap(fwd.pFilt, sm.pSmooth)
    expect(gap).toBeGreaterThanOrEqual(-1e-12)
    // 内部点：平滑方差应更紧（至少平均更小）
    let meanF = 0
    let meanS = 0
    for (let i = 0; i < N; i++) {
      meanF += fwd.pFilt[i]!
      meanS += sm.pSmooth[i]!
    }
    expect(meanS).toBeLessThanOrEqual(meanF + 1e-12)
  })

  it('rtsSmooth1d: 长度不足拒绝', () => {
    expect(() =>
      rtsSmooth1d({
        xPred: new Float64Array(1),
        pPred: new Float64Array(1),
        xFilt: new Float64Array(1),
        pFilt: new Float64Array(1),
      }),
    ).toThrow()
  })

  it('mse1d / minVarGap 基本正确', () => {
    expect(mse1d([1, 2], [1, 2])).toBeCloseTo(0, 12)
    expect(mse1d([1, 3], [1, 1])).toBeCloseTo(2, 12)
    expect(minVarGap([1, 2], [0.5, 1.5])).toBeCloseTo(0.5, 12)
  })

  it('runRtsSmoothSample: ok, familyId method-kalman, 平滑方差 ≤ 滤波', () => {
    const r = runRtsSmoothSample({ N: 48 })
    expect(r.methodId).toBe(METHOD_ALGO_RTS_SMOOTH)
    expect(r.familyId).toBe(METHOD_KALMAN)
    expect(r.ok).toBe(true)
    expect(r.varSmootherLeFilter).toBe(true)
    expect(r.meanPsmooth).toBeLessThanOrEqual(r.meanPfilt + 1e-12)
    expect(r.minVarGap).toBeGreaterThanOrEqual(-1e-12)
    expect(r.N).toBe(48)
  })

  it('runRtsSmoothSample 默认参数亦 ok', () => {
    const r = runRtsSmoothSample()
    expect(r.ok).toBe(true)
    expect(r.familyId).toBe('method-kalman')
  })
})
