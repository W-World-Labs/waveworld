import { describe, it, expect } from 'vitest'
import { evalExpr } from '../formula'
import {
  PHYSICS_LIMITS, carnotEfficiency, curzonAhlborn, thermoelectricEfficiency,
  thermalCarnotExergy, petelaExergy, landauerFloor, unifiedEtaBound, BETZ_MAX,
} from './limits'

describe('第一性原理限值目录（canonical 向量回归）', () => {
  it('每条闭式上限 evalExpr(expr, sample) ≈ expected（相对容差内）', () => {
    const fails: string[] = []
    for (const L of PHYSICS_LIMITS) {
      if (!L.closedForm || !L.expr) continue
      const got = evalExpr(L.expr, L.sample)
      const rel = Math.abs(got - L.expected) / Math.max(Math.abs(L.expected), 1e-30)
      if (!Number.isFinite(got) || rel > Math.max(L.tol, 1e-9)) {
        fails.push(`${L.name}: expr=${L.expr} expected=${L.expected} got=${got} rel=${rel}`)
      }
    }
    expect(fails, fails.join('\n')).toHaveLength(0)
  })

  it('目录非空且 name 唯一、各有支配定律', () => {
    expect(PHYSICS_LIMITS.length).toBeGreaterThanOrEqual(25)
    const names = PHYSICS_LIMITS.map((l) => l.name)
    expect(new Set(names).size).toBe(names.length)
    for (const L of PHYSICS_LIMITS) expect(L.governingLaw.length).toBeGreaterThan(0)
  })

  it('热机上限有序：Curzon-Ahlborn < 卡诺；Otto/Brayton ≤ 卡诺', () => {
    expect(curzonAhlborn(300, 900)).toBeLessThan(carnotEfficiency(300, 900))
    expect(evalExpr('1 - r^(1-g)', { r: 8, g: 1.4 })).toBeLessThanOrEqual(carnotEfficiency(300, 900) + 1e-9)
  })

  it('卡诺单调：温差越大效率越高；T_h→∞ 趋近 1', () => {
    expect(carnotEfficiency(300, 600)).toBeLessThan(carnotEfficiency(300, 1200))
    expect(carnotEfficiency(300, 1e9)).toBeGreaterThan(0.999)
  })

  it('辐射㶲(Petela) 比同温卡诺紧（更小）', () => {
    expect(petelaExergy(5778, 298)).toBeLessThan(thermalCarnotExergy(5778, 298))
    expect(petelaExergy(5778, 298)).toBeGreaterThan(0.9)
  })

  it('热电效率随 ZT 增、且 ≤ 同温卡诺', () => {
    expect(thermoelectricEfficiency(0.5, 300, 600)).toBeLessThan(thermoelectricEfficiency(3, 300, 600))
    expect(thermoelectricEfficiency(1, 300, 600)).toBeLessThan(carnotEfficiency(300, 600))
  })

  it('Landauer 地板正、随 T 增；Betz=16/27', () => {
    expect(landauerFloor(1.380649e-23, 300)).toBeGreaterThan(0)
    expect(landauerFloor(1.380649e-23, 600)).toBeCloseTo(2 * landauerFloor(1.380649e-23, 300), 30)
    expect(BETZ_MAX).toBeCloseTo(0.5925925925925926, 12)
  })

  it('统一界：降级边 clamp 到 1；升级边 = φ_from/φ_to', () => {
    expect(unifiedEtaBound(1, 0.4)).toBe(1)           // 电→热：第一定律兜底
    expect(unifiedEtaBound(0.4, 1)).toBeCloseTo(0.4, 12) // 热(φ0.4)→功：卡诺界
  })
})
