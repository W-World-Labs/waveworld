import { describe, it, expect } from 'vitest'
import { radiantPowerFromPlanck, sqMaxEfficiency, sqEfficiency } from './sq'
import { SIGMA, QE } from './constants'

describe('Shockley-Queisser 细致平衡（数值）', () => {
  it('积分器自校验：∫E·b dE ≈ σT⁴（Planck→Stefan-Boltzmann，1% 内）', () => {
    for (const T of [3000, 5778]) {
      const got = radiantPowerFromPlanck(T)
      const expected = SIGMA * T ** 4
      expect(Math.abs(got - expected) / expected, `T=${T}`).toBeLessThan(0.01)
    }
  })

  it('单结最大效率落在 de Vos 无稀释黑体口径 ~0.40–0.42，最优带隙 ~0.9–1.4eV', () => {
    const { etaMax, EgOpt_eV } = sqMaxEfficiency(5778, 300)
    expect(etaMax).toBeGreaterThan(0.40)
    expect(etaMax).toBeLessThan(0.42)
    expect(EgOpt_eV).toBeGreaterThan(0.9)
    expect(EgOpt_eV).toBeLessThan(1.4)
  })

  it('效率随带隙先增后减（存在内部最优，非单调）', () => {
    const lo = sqEfficiency(0.5 * QE), mid = sqEfficiency(1.1 * QE), hi = sqEfficiency(2.4 * QE)
    expect(mid).toBeGreaterThan(lo)
    expect(mid).toBeGreaterThan(hi)
  })
})
