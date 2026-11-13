import { describe, expect, it } from 'vitest'
import { EDGES } from '../data/ontology/edges'
import { lossDisplayDesc, lossDisplayName } from './lossDisplay'

describe('lossDisplayName / lossDisplayDesc', () => {
  it('zh returns Chinese source fields', () => {
    const e = EDGES.find((x) => x.id === 'em-radio-to-electric-rectenna')
    const l = e!.lossMechanisms.find((x) => x.name.includes('阻抗'))!
    expect(lossDisplayName(l, 'zh')).toBe(l.name)
    expect(lossDisplayDesc(l, 'zh')).toBe(l.desc)
  })

  it('en returns curated English without CJK for common losses', () => {
    const e = EDGES.find((x) => x.id === 'em-radio-to-electric-rectenna')
    const l = e!.lossMechanisms.find((x) => x.name === '阻抗失配')!
    const name = lossDisplayName(l, 'en')
    const desc = lossDisplayDesc(l, 'en')
    expect(name).toMatch(/impedance|mismatch/i)
    expect(name).not.toMatch(/[\u4e00-\u9fff]/)
    expect(desc).not.toMatch(/[\u4e00-\u9fff]/)
    expect(desc.length).toBeGreaterThan(8)
  })

  it('covers all unique loss names in EN without CJK or stub labels', () => {
    const names = new Set<string>()
    for (const e of EDGES) {
      for (const l of e.lossMechanisms) names.add(l.name)
    }
    expect(names.size).toBeGreaterThan(100)
    for (const name of names) {
      const en = lossDisplayName({ name }, 'en')
      expect(en, name).toBeTruthy()
      expect(en, name).not.toMatch(/[\u4e00-\u9fff]/)
      expect(en, name).not.toBe('Loss')
      expect(en, name).not.toMatch(/^\/|\/$/)
      const desc = lossDisplayDesc({ name, desc: '占位' }, 'en')
      expect(desc, name).not.toMatch(/[\u4e00-\u9fff]/)
      expect(desc, name).not.toMatch(/residual loss channel/i)
    }
  })
})
