import { describe, it, expect } from 'vitest'
import {
  FVM_PARENT,
  METHOD_ALGO_FVM_LIMITER,
  burgersFlux,
  burgersLfFlux,
  burgersShockSpeed,
  minmod,
  minmodSlopes,
  runFvmLimiterSample,
  burgersMinmodStep,
} from './fvm-l2-algos'
import { sumMass } from './fvm-algos'
import { methodById } from '../../data/methods/methods'

describe('有限体积 L2 · minmod + Burgers 激波', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(FVM_PARENT).toBe('method-finite-volume')
    expect(METHOD_ALGO_FVM_LIMITER).toBe('method-algo-fvm-limiter')
    const m = methodById(FVM_PARENT)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
  })

  it('minmod：同号取小绝对值，异号为 0', () => {
    expect(minmod(2, 3)).toBe(2)
    expect(minmod(-4, -1)).toBe(-1)
    expect(minmod(2, -3)).toBe(0)
    expect(minmod(0, 5)).toBe(0)
  })

  it('Burgers LF：uL=uR 时等于 f(u)', () => {
    expect(burgersLfFlux(2, 2)).toBeCloseTo(burgersFlux(2), 12)
  })

  it('激波速度 Rankine–Hugoniot s=(uL+uR)/2', () => {
    expect(burgersShockSpeed(1.5, 0.5)).toBeCloseTo(1, 12)
  })

  it('均匀场斜率全 0，一步后不变', () => {
    const u = new Float64Array(32).fill(0.7)
    const s = minmodSlopes(u, 1 / 32)
    for (let i = 0; i < 32; i++) expect(s[i]).toBe(0)
    const next = burgersMinmodStep(u, 1 / 32, 0.001)
    for (let i = 0; i < 32; i++) expect(next[i]).toBeCloseTo(0.7, 10)
    expect(sumMass(next)).toBeCloseTo(sumMass(u), 10)
  })

  it('runFvmLimiterSample：熵激波位置与质量守恒', () => {
    const r = runFvmLimiterSample({ n: 160, uL: 1.4, uR: 0.3, cfl: 0.35, steps: 80 })
    expect(r.methodId).toBe(METHOD_ALGO_FVM_LIMITER)
    expect(r.familyId).toBe(FVM_PARENT)
    expect(r.entropyOk).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.massErr).toBeLessThan(1e-10)
    // 激波位置误差：几个网格以内
    expect(r.posErr).toBeLessThan(4 / r.n)
    expect(r.shockPosF).toBeGreaterThan(r.shockPos0)
  })
})
