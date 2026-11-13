import { describe, it, expect } from 'vitest'
import { TRANSDUCERS } from './transducers'
import { NODES } from './ontology/nodes'

const ids = new Set(NODES.map((n) => n.id))

describe('transducers · 本体挂接', () => {
  it('若声明 fromNodeId/toNodeId 则必须 ∈ NODES', () => {
    for (const t of TRANSDUCERS) {
      if (t.fromNodeId) expect(ids.has(t.fromNodeId), `${t.name} fromNodeId=${t.fromNodeId}`).toBe(true)
      if (t.toNodeId) expect(ids.has(t.toNodeId), `${t.name} toNodeId=${t.toNodeId}`).toBe(true)
    }
  })

  it('算力推理引擎：电能挂接、信息不挂接（保留分类争议）', () => {
    // 原名含 GPU，现为「算力推理引擎」；以 icon / 电能→信息 叙事定位
    const compute =
      TRANSDUCERS.find((t) => t.name.includes('算力') || t.name.includes('GPU')) ??
      TRANSDUCERS.find((t) => t.icon === '🧠' && t.fromNodeId === 'electric' && !t.toNodeId)
    expect(compute?.fromNodeId).toBe('electric')
    expect(compute?.toNodeId).toBeUndefined()
  })
})
