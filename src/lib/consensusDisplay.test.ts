import { describe, expect, it } from 'vitest'
import { EDGES } from '../data/ontology/edges'
import { NODES } from '../data/ontology/nodes'
import { consensusSummary, viewpointStance } from './consensusDisplay'

describe('consensusSummary / viewpointStance', () => {
  it('zh returns Chinese node consensus', () => {
    const n = NODES.find((x) => x.id === 'electric')!
    expect(consensusSummary(n.consensus, 'zh')).toMatch(/坡印廷|能量/)
    const v = n.consensus.viewpoints![0]
    expect(viewpointStance(v, 'zh')).toMatch(/能量|电磁场/)
  })

  it('en returns English node consensus without CJK', () => {
    const n = NODES.find((x) => x.id === 'electric')!
    const s = consensusSummary(n.consensus, 'en')!
    expect(s).toMatch(/Poynting|circuit/i)
    expect(s).not.toMatch(/[\u4e00-\u9fff]/)
    const stance = viewpointStance(n.consensus.viewpoints![0], 'en')
    expect(stance).toMatch(/Poynting|energy|field/i)
    expect(stance).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('merged edges carry consensus summaryEn for most edges', () => {
    const withSum = EDGES.filter((e) => e.consensus.summary)
    const withEn = withSum.filter((e) => e.consensus.summaryEn)
    expect(withEn.length / withSum.length).toBeGreaterThan(0.9)
    const sample = withEn[0]
    const en = consensusSummary(sample.consensus, 'en')!
    expect(en).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('edge viewpoints get stanceEn without CJK or generic filler', () => {
    const stances = EDGES.flatMap((e) => e.consensus.viewpoints ?? [])
    expect(stances.length).toBeGreaterThan(20)
    for (const v of stances) {
      const en = viewpointStance(v, 'en')
      expect(en, v.stance).toBeTruthy()
      expect(en, v.stance).not.toMatch(/[\u4e00-\u9fff]/)
      expect(en, v.stance).not.toMatch(/Competing interpretive stance/i)
      expect(en, v.stance).not.toMatch(/Classification \/ ontology boundary/i)
    }
  })
})
