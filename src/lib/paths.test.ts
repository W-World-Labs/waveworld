import { describe, it, expect } from 'vitest'
import { buildPathGraph, findPaths, effForChain, isTransport } from './paths'
import { NODES } from '../data/ontology/nodes'
import { EDGES } from '../data/ontology/edges'

describe('findPaths', () => {
  const g = buildPathGraph(NODES, EDGES)

  it('直接转换 → 存在长度 1 的路径，效率=该边效率', () => {
    const paths = findPaths(g, 'electromagnetic', 'electric')
    expect(paths.length).toBeGreaterThan(0)
    const direct = paths.find((p) => p.hops.length === 1)
    expect(direct).toBeTruthy()
    expect(direct!.totalEff).toBeCloseTo(direct!.hops[0].eff, 12)
  })

  it('所有路径：起于 from、止于 to、无重复节点、效率=连乘、降序', () => {
    const paths = findPaths(g, 'nuclear', 'mechanical', { maxDepth: 4 })
    for (const p of paths) {
      expect(p.hops[0].from).toBe('nuclear')
      expect(p.hops[p.hops.length - 1].to).toBe('mechanical')
      const forms = [p.hops[0].from, ...p.hops.map((h) => h.to)]
      expect(new Set(forms).size).toBe(forms.length) // 无重复
      const prod = p.hops.reduce((a, h) => a * h.eff, 1)
      expect(p.totalEff).toBeCloseTo(prod, 12)
    }
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i - 1].totalEff).toBeGreaterThanOrEqual(paths[i].totalEff)
    }
  })

  it('限深生效', () => {
    const paths = findPaths(g, 'chemical', 'electric', { maxDepth: 2 })
    for (const p of paths) expect(p.hops.length).toBeLessThanOrEqual(2)
  })

  it('from===to 返回空', () => {
    expect(findPaths(g, 'thermal', 'thermal')).toHaveLength(0)
  })

  it('累积转换效率不超过 100%（COP 搬运型已封顶）', () => {
    const forms = NODES.filter((n) => !n.parent).map((n) => n.id)
    for (const a of forms) for (const b of forms) if (a !== b) {
      for (const p of findPaths(g, a, b, { maxDepth: 4 })) {
        expect(p.totalEff, `${a}→${b}`).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('isTransport 识别 COP 设备，effForChain 封顶 1.0', () => {
    const hp = EDGES.find((e) => e.id === 'electric-to-thermal-heatpump')
    expect(hp).toBeTruthy()
    expect(hp!.efficiency.max).toBeGreaterThan(1)   // COP 原值 >1
    expect(isTransport(hp!)).toBe(true)
    expect(effForChain(hp!)).toBeLessThanOrEqual(1) // 链路按 ≤100% 计
    // 普通转换边不受影响
    const conv = EDGES.find((e) => (e.efficiency.max ?? 0) <= 1 && !e.kind)!
    expect(isTransport(conv)).toBe(false)
    const mid = Math.min(1, ((conv.efficiency.min ?? conv.efficiency.max ?? 0) + (conv.efficiency.max ?? conv.efficiency.min ?? 0)) / 2)
    expect(effForChain(conv)).toBeCloseTo(mid, 9)
  })

  it('图连通性：每个顶层形式都能到达至少一个其它形式', () => {
    const forms = NODES.filter((n) => !n.parent).map((n) => n.id)
    for (const f of forms) {
      const reached = forms.filter((t) => t !== f && findPaths(g, f, t, { maxDepth: 4 }).length > 0)
      expect(reached.length, `${f} 应能到达其它形式`).toBeGreaterThan(0)
    }
  })
})
