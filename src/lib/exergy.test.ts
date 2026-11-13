import { describe, it, expect } from 'vitest'
import { thermalExergyFactor, exergyFactor, pathExergy, T0, FORM_EXERGY_FACTOR } from './exergy'

const id = (x: string) => x // 玩具图中节点 id 即顶层形式

describe('thermalExergyFactor（卡诺㶲因子 1−T₀/T）', () => {
  it('T≤T₀ → 0（与环境同温的热无可用功）', () => {
    expect(thermalExergyFactor(T0)).toBe(0)
    expect(thermalExergyFactor(200)).toBe(0)
  })
  it('T=2·T₀ → 0.5；高温趋近 1', () => {
    expect(thermalExergyFactor(2 * T0)).toBeCloseTo(0.5, 12)
    expect(thermalExergyFactor(1e6)).toBeGreaterThan(0.999)
  })
  it('随温度单调增', () => {
    expect(thermalExergyFactor(400)).toBeLessThan(thermalExergyFactor(800))
  })
})

describe('exergyFactor（按形式）', () => {
  it('功品位形式≈1、热能<1', () => {
    expect(exergyFactor('electric')).toBe(1)
    expect(exergyFactor('mechanical')).toBe(1)
    expect(exergyFactor('thermal')).toBeLessThan(0.6)
    expect(exergyFactor('thermal')).toBeGreaterThan(0)
    expect(exergyFactor('chemical')).toBeCloseTo(0.9, 12)
  })
})

describe('pathExergy（暴露可用功销毁）', () => {
  it('电→热阻性加热：能量 100% 但可用功≪100%（破“Joule 即 Joule”）', () => {
    const r = pathExergy([{ eff: 1, from: id('electric'), to: id('thermal') }], id)
    expect(r.energyEff).toBeCloseTo(1, 12)
    expect(r.usableWorkOut).toBeCloseTo(FORM_EXERGY_FACTOR.thermal, 12) // = energyEff·φ_end
    expect(r.usableWorkOut).toBeLessThan(0.6) // 大部分可用功已销毁
    expect(r.hops[0].secondLawViolation).toBe(false) // 降级合法，不违反二定律
  })

  it('热→功(电) 用保守卡诺界判违反：真实热机(η≤~0.85)不误报，η>界才告警', () => {
    const ok = pathExergy([{ eff: 0.5, from: id('thermal'), to: id('electric') }], id) // 真实热机量级
    expect(ok.hops[0].secondLawViolation).toBe(false)
    const bad = pathExergy([{ eff: 0.95, from: id('thermal'), to: id('electric') }], id) // 超保守卡诺界(~0.85)
    expect(bad.hops[0].secondLawViolation).toBe(true)
  })

  it('望远镜消去：固定端点全程㶲效率 = ∏η·φ_end/φ_start', () => {
    // electric →(η0.9) thermal →(η0.3) mechanical
    const r = pathExergy([
      { eff: 0.9, from: id('electric'), to: id('thermal') },
      { eff: 0.3, from: id('thermal'), to: id('mechanical') },
    ], id)
    expect(r.energyEff).toBeCloseTo(0.27, 12)
    expect(r.exergyEff).toBeCloseTo(0.27 * (exergyFactor('mechanical') / exergyFactor('electric')), 12)
  })
})
