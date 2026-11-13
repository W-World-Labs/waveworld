import { describe, it, expect } from 'vitest'
import {
  FVM_PARENT,
  METHOD_ALGO_FVM_ROE,
  FVM_L4_METHOD_IDS,
  burgersFlux,
  burgersRoeFlux,
  burgersRoeStep,
  burgersUpwindByRoeSpeed,
  hartenEntropyFix,
  roeAverageBurgers,
  runFvmRoeSample,
} from './fvm-l4-algos'
import { methodById } from '../../data/methods/methods'

describe('有限体积 L4 · Roe 近似 Riemann (Burgers 1D)', () => {
  it('方法 id 常量（roe 为未入库新 id）', () => {
    expect(FVM_PARENT).toBe('method-finite-volume')
    expect(METHOD_ALGO_FVM_ROE).toBe('method-algo-fvm-roe-stub')
    expect(FVM_L4_METHOD_IDS).toContain(METHOD_ALGO_FVM_ROE)
    expect(methodById(FVM_PARENT)).toBeDefined()
  })

  it('Roe 平均 â = (uL+uR)/2', () => {
    expect(roeAverageBurgers(1, 3)).toBeCloseTo(2, 12)
    expect(roeAverageBurgers(-1, 1)).toBeCloseTo(0, 12)
  })

  it('Harten 熵修正：|λ|≥ε 不变，|λ|<ε 抬升', () => {
    expect(hartenEntropyFix(0.5, 0.1)).toBeCloseTo(0.5, 12)
    expect(hartenEntropyFix(0.05, 0.1)).toBeGreaterThan(0.05)
    expect(hartenEntropyFix(0, 0.2)).toBeCloseTo(0.1, 12)
    expect(hartenEntropyFix(0.3, 0)).toBeCloseTo(0.3, 12)
  })

  it('相同左右态：Roe 通量 = 物理通量 ½u²', () => {
    const u = 1.2
    const F = burgersRoeFlux(u, u)
    expect(F).toBeCloseTo(burgersFlux(u), 12)
    expect(F).toBeCloseTo(0.5 * u * u, 12)
  })

  it('激波 Riemann 通量有限，并与迎风同号', () => {
    const uL = 1.5
    const uR = 0.2
    const Froe = burgersRoeFlux(uL, uR, 1e-3)
    const Fup = burgersUpwindByRoeSpeed(uL, uR)
    expect(Number.isFinite(Froe)).toBe(true)
    expect(Number.isFinite(Fup)).toBe(true)
    expect(Math.sign(Froe)).toBe(Math.sign(Fup))
    // Roe 公式显式
    const aHat = 0.5 * (uL + uR)
    const expected =
      0.5 * (0.5 * uL * uL + 0.5 * uR * uR) - 0.5 * Math.abs(aHat) * (uR - uL)
    // eps 很小，几乎等于无修正
    expect(burgersRoeFlux(uL, uR, 0)).toBeCloseTo(expected, 12)
  })

  it('sonic rarefaction：熵修正使 |â| 不塌到 0', () => {
    // uL < 0 < uR：稀散，â 可近 0
    const uL = -1
    const uR = 1
    const aHat = roeAverageBurgers(uL, uR)
    expect(Math.abs(aHat)).toBeLessThan(1e-12)
    const F0 = burgersRoeFlux(uL, uR, 0)
    const Feps = burgersRoeFlux(uL, uR, 0.2)
    // 无修正时粘性项为 0；有修正时多耗散
    expect(F0).toBeCloseTo(0.5 * (burgersFlux(uL) + burgersFlux(uR)), 12)
    expect(Math.abs(Feps - F0)).toBeGreaterThan(0)
  })

  it('burgersRoeStep 质量守恒（周期）', () => {
    const n = 64
    const dx = 1 / n
    const u = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      u[i] = i < n / 2 ? 1.2 : 0.3
    }
    const mass0 = [...u].reduce((a, b) => a + b, 0) * dx
    const dt = 0.3 * dx / 1.2
    let cur = new Float64Array(u)
    for (let s = 0; s < 30; s++) cur = new Float64Array(burgersRoeStep(cur, dx, dt, 1e-3))
    const massF = [...cur].reduce((a, b) => a + b, 0) * dx
    expect(Math.abs(massF - mass0)).toBeLessThan(1e-10)
    expect([...cur].every(Number.isFinite)).toBe(true)
  })

  it('runFvmRoeSample ok', () => {
    const r = runFvmRoeSample({ n: 128, cfl: 0.35, steps: 40 })
    expect(r.methodId).toBe(METHOD_ALGO_FVM_ROE)
    expect(r.familyId).toBe(FVM_PARENT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.fluxFinite).toBe(true)
    expect(r.consistentOk).toBe(true)
    expect(r.vsUpwindOk).toBe(true)
    expect(r.massErr).toBeLessThan(1e-10)
  })
})
