import { describe, expect, it } from 'vitest'
import {
  efficiencyBarWidthPct,
  formatEfficiencyText,
  formatPercent,
  formatQuantityEfficiency,
  parseEfficiencyText,
} from './efficiencyFormat'

describe('efficiencyFormat — KUX 靶 B', () => {
  it('formatPercent 把 0–1 收成 %', () => {
    expect(formatPercent(0.15)).toBe('15%')
    expect(formatPercent(0.05)).toMatch(/%/)
  })

  it('formatQuantityEfficiency 本体 η 区间', () => {
    expect(formatQuantityEfficiency(0.05, 0.15)).toBe('5% – 15%')
    expect(formatQuantityEfficiency(0.2, 0.2)).toBe('20%')
  })

  it('formatQuantityEfficiency transport 用 COP', () => {
    expect(formatQuantityEfficiency(2, 4, { transport: true })).toMatch(/×/)
  })

  it('parse 5-15% / 5–15%', () => {
    const a = parseEfficiencyText('5-15%')
    expect(a.ok).toBe(true)
    expect(a.min).toBeCloseTo(0.05)
    expect(a.max).toBeCloseTo(0.15)
    expect(formatEfficiencyText('15-47%')).toMatch(/15%/)
  })

  it('parse > 95%', () => {
    const p = parseEfficiencyText('> 95%')
    expect(p.ok).toBe(true)
    expect(p.min).toBeCloseTo(0.95)
  })

  it('解析失败保留原串', () => {
    expect(formatEfficiencyText('取决于工况')).toBe('取决于工况')
  })

  it('bar 宽度 η 与 COP 不炸', () => {
    expect(efficiencyBarWidthPct(0.47)).toBeCloseTo(47)
    expect(efficiencyBarWidthPct(3, { transport: true })).toBeLessThanOrEqual(100)
  })

  it('formatCop 与 formatPercent 是跨页唯一推荐出口', () => {
    expect(formatPercent(0.774)).toMatch(/%/)
    expect(formatPercent(0.02)).toMatch(/%/)
  })
})
