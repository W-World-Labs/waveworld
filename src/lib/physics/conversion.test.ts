import { describe, it, expect } from 'vitest'
import { analyzeConversion, isValidComposition, conversionOutputs } from './conversion'
import { buildOptGraph, findOptimalPaths } from '../optimize'
import { NODES } from '../../data/ontology/nodes'
import { EDGES } from '../../data/ontology/edges'
import type { ConversionEdge } from '../../data/ontology/types'

const byId = new Map(NODES.map((n) => [n.id, n]))
const formOf = (id: string) => byId.get(id)?.parent ?? id
const forms = NODES.filter((n) => !n.parent).map((n) => n.id)

describe('单个转换契约（原子单元）', () => {
  it('全部 229 条边都是合法原子（在第一性原理上限内、无越界）', () => {
    const bad: string[] = []
    for (const e of EDGES) {
      const c = analyzeConversion(e, formOf)
      if (!c.valid) bad.push(`${c.id}: ${c.violations.join('; ')}`)
    }
    expect(bad, bad.join('\n')).toHaveLength(0)
  })

  it('守恒律按转换类正确声明：能量恒有；化学→电含电荷+化学计量；核/质能含重子-轻子数+质能', () => {
    const battery = EDGES.find((e) => e.from === 'chemical' && formOf(e.to) === 'electric')
    if (battery) {
      const c = analyzeConversion(battery, formOf)
      expect(c.requiredConservation).toContain('energy')
      expect(c.requiredConservation).toContain('charge')
      expect(c.requiredConservation).toContain('mass-stoichiometry')
    }
    const nuc = EDGES.find((e) => formOf(e.from) === 'nuclear')
    if (nuc) {
      const c = analyzeConversion(nuc, formOf)
      expect(c.requiredConservation).toContain('baryon-lepton-number')
      expect(c.requiredConservation).toContain('mass-energy')
    }
  })

  it('能力超第一性原理上限的原子被判非法（构造：thermal→electric 谎称 η=0.99）', () => {
    const fake: ConversionEdge = {
      id: 'fake', from: 'thermal', to: 'electric', name: 'x', principle: 'x',
      efficiency: { symbol: 'η', unit: '1', min: 0.9, max: 0.99 },
      lossMechanisms: [], consensus: { status: 'open' },
    }
    const c = analyzeConversion(fake, formOf)
    expect(c.valid).toBe(false)
    expect(c.withinLimit).toBe(false) // 超卡诺保守上限 0.851
  })

  it('搬运型(COP)原子不按 η 上限判，且 isTransport=true', () => {
    const hp = EDGES.find((e) => e.kind === 'transport')!
    const c = analyzeConversion(hp, formOf)
    expect(c.isTransport).toBe(true)
    expect(c.valid).toBe(true) // COP 不按 η 限
  })
})

describe('审计回归（B1–B5：契约判定器不再放行非法原子）', () => {
  const E = (over: Partial<ConversionEdge> & Pick<ConversionEdge, 'from' | 'to'>): ConversionEdge => ({
    id: 'x', name: 'x', principle: 'x', efficiency: { symbol: 'η', unit: '1', min: 0.5, max: 0.6 },
    lossMechanisms: [], consensus: { status: 'open' }, ...over,
  })

  it('B1：非搬运边 max>1（不可能的 >100% 电机）被判非法，不被 isTransport 抵消', () => {
    const c = analyzeConversion(E({ from: 'electric', to: 'mechanical', efficiency: { symbol: 'η', unit: '1', min: 0.8, max: 1.5 } }), formOf)
    expect(c.valid).toBe(false)
    expect(c.violations.join()).toMatch(/efficiency.max=1.5>1/)
  })

  it('B2：非搬运边峰值超第一性原理上限被判非法（thermal→electric 峰值 1.4）', () => {
    const c = analyzeConversion(E({ from: 'thermal', to: 'electric', efficiency: { symbol: 'η', unit: '1', min: 0.2, max: 1.4 } }), formOf)
    expect(c.valid).toBe(false)
  })

  it('B3：组合累积效率用封顶后能力连乘，恒 ≤1（单跳 COP 不泄漏成 5.5）', () => {
    const hp = EDGES.find((e) => e.kind === 'transport')!
    const comp = isValidComposition([{ from: hp.from, to: hp.to, edge: hp, eff: hp.efficiency.max ?? 5 }], formOf)
    expect(comp.cumulativeEta).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('B4：荒谬热泵 COP=110 超保守上界被判非法', () => {
    const c = analyzeConversion(E({ from: 'electric', to: 'thermal', kind: 'transport', efficiency: { symbol: 'COP', unit: '1', min: 90, max: 110 } }), formOf)
    expect(c.valid).toBe(false)
    expect(c.violations.join()).toMatch(/COP=110/)
  })

  it('B5：搬运型 COP<1 时能量不闭合，不假报 closes=true', () => {
    const r = conversionOutputs(E({ from: 'electric', to: 'thermal', kind: 'transport', efficiency: { symbol: 'COP', unit: '1', min: 0.5, max: 0.5 } }), formOf)
    expect(r.closes).toBe(false)
  })
})

describe('路径 = 单个转换的合法组合（涌现）', () => {
  const g = buildOptGraph(NODES, EDGES)

  it('优化器在所有可达顶层对上的最优路径都是合法组合（连续 + 全原子合法 + 累积=∏η）', () => {
    const bad: string[] = []
    for (const a of forms) for (const b of forms) if (a !== b) {
      const [p] = findOptimalPaths(g, a, b, { k: 1 })
      if (!p) continue
      const comp = isValidComposition(p.hops, formOf)
      if (!comp.valid) bad.push(`${a}→${b}: 连续=${comp.continuous} 全原子合法=${comp.allAtomsValid}`)
      if (Math.abs(comp.cumulativeEta - p.totalEff) > 1e-9) bad.push(`${a}→${b}: 累积效率不一致`)
    }
    expect(bad, bad.slice(0, 10).join('\n')).toHaveLength(0)
  })

  it('不连续的组合被判非法（构造：断裂链）', () => {
    const e1 = EDGES.find((e) => e.from === 'nuclear')!
    const e2 = EDGES.find((e) => e.from === 'chemical' && e.to !== e1.to)!
    const comp = isValidComposition([
      { from: e1.from, to: e1.to, edge: e1, eff: 0.5 },
      { from: e2.from, to: e2.to, edge: e2, eff: 0.5 }, // e2.from ≠ e1.to → 断裂
    ], formOf)
    expect(comp.continuous).toBe(false)
    expect(comp.valid).toBe(false)
  })
})
