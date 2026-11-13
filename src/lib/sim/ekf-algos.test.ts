import { describe, it, expect } from 'vitest'
import {
  METHOD_ALGO_KALMAN_1D,
  METHOD_KALMAN,
  METHOD_KALMAN_EKF,
  ekfLinearPredict,
  ekfLinearUpdate,
  ekfPredictGeneral,
  ekfUpdateGeneral,
  runEkfLinearSample,
  runEkfNonlinearSample,
} from './ekf-algos'
import { methodById } from '../../data/methods/methods'

describe('扩展卡尔曼 · 1D 线性 z=x+noise', () => {
  it('方法 id 常量对齐目录', () => {
    expect(METHOD_KALMAN).toBe('method-kalman')
    expect(METHOD_KALMAN_EKF).toBe('method-kalman-ekf')
    expect(METHOD_ALGO_KALMAN_1D).toBe('method-algo-kalman-1d')
    const fam = methodById(METHOD_KALMAN)
    expect(fam).toBeDefined()
    expect(fam!.role).toBe('family')
    expect(methodById(METHOD_KALMAN_EKF)?.parentId).toBe(METHOD_KALMAN)
    expect(methodById(METHOD_ALGO_KALMAN_1D)?.parentId).toBe(METHOD_KALMAN)
  })

  it('线性预测：F=1,Q=0 时状态与方差不变', () => {
    const s = ekfLinearPredict({ x: 2, P: 0.5 }, 1, 0)
    expect(s.x).toBeCloseTo(2, 12)
    expect(s.P).toBeCloseTo(0.5, 12)
  })

  it('线性更新：z=x 时估计贴近量测且 P 收缩', () => {
    const s0 = { x: 0, P: 1 }
    const s1 = ekfLinearUpdate(s0, 5, 1, 0.25)
    expect(s1.x).toBeGreaterThan(0)
    expect(s1.x).toBeLessThan(5)
    expect(s1.P).toBeLessThan(s0.P)
    // K = 1/(1+0.25)=0.8 → x=0.8*5=4
    expect(s1.x).toBeCloseTo(4, 10)
    expect(s1.P).toBeCloseTo(0.2, 10)
  })

  it('一般 EKF：h(x)=x,H=1 与线性更新一致', () => {
    const s0 = { x: 1, P: 2 }
    const z = 3
    const R = 0.5
    const lin = ekfLinearUpdate(s0, z, 1, R)
    const gen = ekfUpdateGeneral(s0, z, (x) => x, 1, R)
    expect(gen.x).toBeCloseTo(lin.x, 12)
    expect(gen.P).toBeCloseTo(lin.P, 12)
  })

  it('一般预测 f(x)=x 与线性 F=1 一致', () => {
    const s0 = { x: 1.5, P: 0.8 }
    const lin = ekfLinearPredict(s0, 1, 0.01)
    const gen = ekfPredictGeneral(s0, (x) => x, 1, 0.01)
    expect(gen.x).toBeCloseTo(lin.x, 12)
    expect(gen.P).toBeCloseTo(lin.P, 12)
  })

  it('runEkfLinearSample：估计跟踪真值、P 收缩', () => {
    const r = runEkfLinearSample({ steps: 40, trueX: 4, x0: 0, P0: 1 })
    expect(r.methodId).toBe(METHOD_KALMAN_EKF)
    expect(r.familyId).toBe(METHOD_KALMAN)
    expect(r.algoId).toBe(METHOD_ALGO_KALMAN_1D)
    expect(r.priorErr).toBeGreaterThan(2)
    expect(r.improved).toBe(true)
    expect(r.Pshrunk).toBe(true)
    expect(r.err).toBeLessThan(0.5)
    expect(r.estimate).toBeCloseTo(r.trueX, 0)
    expect(r.P).toBeLessThan(r.P0)
  })

  it('runEkfNonlinearSample：包装 pf 非线性 EKF 仍收敛', () => {
    const r = runEkfNonlinearSample(30)
    expect(r.methodId).toBe(METHOD_KALMAN_EKF)
    expect(r.err).toBeLessThan(0.5)
    expect(r.P).toBeLessThan(r.P0)
  })
})
