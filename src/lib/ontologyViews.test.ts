import { describe, it, expect } from 'vitest'
import { controversiesBoundToNode, allControversies } from './ontologyViews'
import { CONTROVERSIES } from '../data/ontology/controversies'

describe('ontologyViews · 多解释查询', () => {
  it('allControversies 非空且与数据源一致', () => {
    expect(allControversies().length).toBe(CONTROVERSIES.length)
    expect(allControversies().length).toBeGreaterThanOrEqual(3)
  })

  it('controversiesBoundToNode(mass) 含质能相关争议', () => {
    const list = controversiesBoundToNode('mass')
    expect(list.some((c) => c.id === 'mass-energy-distinct' || c.id === 'negative-energy')).toBe(true)
  })

  it('未绑定节点不误报绑定争议', () => {
    // 选一个极不可能出现在 relatedNodeIds 的假 id
    expect(controversiesBoundToNode('__no_such_node__')).toHaveLength(0)
  })
})
