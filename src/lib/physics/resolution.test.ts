import { describe, it, expect } from 'vitest'
import { conversionOutputs } from './conversion'
import { composeSubChain, subChainConsistentWith, PV_SUBCHAIN } from './subchain'
import { NODES } from '../../data/ontology/nodes'
import { EDGES } from '../../data/ontology/edges'

const byId = new Map(NODES.map((n) => [n.id, n]))
const formOf = (id: string) => byId.get(id)?.parent ?? id

describe('能量去向闭合（第一定律：产物 + 热）', () => {
  it('光伏 = 电磁波→电 + 热，份额和=1', () => {
    const pv = EDGES.find((e) => e.id === 'radiant-to-electric-photovoltaic')!
    const { outputs, closes } = conversionOutputs(pv, formOf)
    expect(closes).toBe(true)
    const product = outputs.find((o) => o.role === 'product')!
    const heat = outputs.find((o) => o.role === 'loss-heat')!
    expect(product.form).toBe('electric')
    expect(heat.form).toBe('thermal')
    expect(product.fraction + heat.fraction).toBeCloseTo(1, 9)
    expect(heat.fraction).toBeGreaterThan(0) // 大部分入射能量成为热——内部去向清晰
  })

  it('所有转换边能量去向闭合(Σ=1)；transport 记 ambientDraw=COP−1>0', () => {
    for (const e of EDGES) {
      const r = conversionOutputs(e, formOf)
      expect(r.closes, e.id).toBe(true)
      if (e.kind === 'transport') expect(r.ambientDraw, e.id).toBeGreaterThan(0)
      else expect(r.ambientDraw).toBe(0)
    }
  })
})

describe('多分辨率：现象 ⇄ 详细微观链路 且一致', () => {
  it('光伏子链组合 η ≈ 0.283，连续、起止为 电磁波→电', () => {
    const c = composeSubChain(PV_SUBCHAIN.steps)
    expect(c.eta).toBeCloseTo(0.9 * 0.62 * 0.65 * 0.78, 9)
    expect(c.eta).toBeGreaterThan(0.25)
    expect(c.eta).toBeLessThan(0.32)
    expect(c.continuous).toBe(true)
    expect(c.startForm).toBe('electromagnetic')
    expect(c.endForm).toBe('electric')
  })

  it('子链与现象级边 radiant-to-electric-photovoltaic 一致：组合 η 落在其区间内、端点相符', () => {
    const pv = EDGES.find((e) => e.id === PV_SUBCHAIN.phenomenonId)!
    const k = subChainConsistentWith(pv, PV_SUBCHAIN, formOf)
    expect(k.withinRange).toBe(true)   // 0.283 ∈ [0.06, 0.476]
    expect(k.continuous).toBe(true)
    expect(k.endpointsMatch).toBe(true)
  })

  it('子链每个微步都标注了损耗去向(lossTo)——内部去向可细分', () => {
    for (const s of PV_SUBCHAIN.steps) expect(typeof s.lossTo).toBe('string')
    // 热化/电压/收集三步损耗去向为热，反射吸收步去向为电磁(透射/反射)
    expect(PV_SUBCHAIN.steps.filter((s) => s.lossTo === 'thermal').length).toBe(3)
  })
})
