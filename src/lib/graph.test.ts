// src/lib/graph.test.ts
import { describe, it, expect } from 'vitest'
import { buildGraph } from './graph'
import { NODES } from '../data/ontology/nodes'
import { EDGES } from '../data/ontology/edges'

describe('buildGraph', () => {
  const g = buildGraph(NODES, EDGES)
  const descendants = (id: string) => {
    const result = new Set<string>([id]); const queue = [id]
    while (queue.length) for (const child of g.childrenOf(queue.shift()!)) {
      if (!result.has(child.id)) { result.add(child.id); queue.push(child.id) }
    }
    return result
  }

  it('topLevels 只含无 parent 的节点', () => {
    expect(g.topLevels.every((n) => !n.parent)).toBe(true)
    expect(g.topLevels.length).toBe(9) // radiant 已并入 electromagnetic 子树(10→9)
  })
  it('childrenOf(electromagnetic) 返回 8 个直接子节点（7 频段 + radiant）', () => {
    expect(g.childrenOf('electromagnetic')).toHaveLength(8)
  })
  it('edgesOf(node) 同时含进出边', () => {
    // electromagnetic 既有出边（→电/热…）也可能有入边
    const em = g.edgesOf('electromagnetic')
    expect(em.length).toBeGreaterThan(0)
    const emSub = descendants('electromagnetic')
    expect(em.every((e) => emSub.has(e.from) || emSub.has(e.to))).toBe(true)
  })

  it('edgesOf(electric) 含 el-current/el-field 子节点边，多于仅精确匹配 electric', () => {
    const exactOnly = EDGES.filter((e) => e.from === 'electric' || e.to === 'electric')
    const of = g.edgesOf('electric')
    expect(of.length).toBeGreaterThan(exactOnly.length)
    // 子树边：from/to 为 electric 或任一直接子节点（el-current/el-field/el-static）
    const sub = descendants('electric')
    expect(of.every((e) => sub.has(e.from) || sub.has(e.to))).toBe(true)
    expect(of.some((e) => e.from === 'el-current' || e.to === 'el-current')).toBe(true)
    expect(of.some((e) => e.from === 'el-field' || e.to === 'el-field')).toBe(true)
  })
  it('全量数据后 9 个顶层类均已填充（有子节点或边）', () => {
    for (const n of g.topLevels) {
      expect(g.isFilled(n.id), `${n.id} 应已填充`).toBe(true)
    }
  })
})
