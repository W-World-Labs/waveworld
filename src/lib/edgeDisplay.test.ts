import { describe, expect, it } from 'vitest'
import { EDGES } from '../data/ontology/edges'
import {
  edgeDisplayName,
  edgeEfficiencyNote,
  edgePrinciple,
  prettifyEdgeId,
} from './edgeDisplay'

describe('edgeDisplayName', () => {
  it('zh returns Chinese name', () => {
    const e = EDGES.find((x) => x.id === 'thermal-to-electric-thermoelectric')
    expect(e).toBeTruthy()
    expect(edgeDisplayName(e!, 'zh')).toMatch(/热电|塞贝克/)
  })

  it('en prefers curated nameEn map', () => {
    const e = EDGES.find((x) => x.id === 'thermal-to-electric-thermoelectric')
    expect(edgeDisplayName(e!, 'en')).toMatch(/Thermoelectric|Seebeck/i)
  })

  it('en falls back to prettified id when unmapped', () => {
    const fake = { id: 'foo-to-bar-demo', name: '中文名', nameEn: undefined }
    expect(edgeDisplayName(fake, 'en')).toBe(prettifyEdgeId('foo-to-bar-demo'))
    expect(edgeDisplayName(fake, 'en')).toMatch(/→/)
  })

  it('merged EDGES carry nameEn for mapped ids', () => {
    const e = EDGES.find((x) => x.id === 'mechanical-to-electric-generator')
    expect(e?.nameEn).toMatch(/generator/i)
  })

  it('expanded map covers common electric / radiant edges', () => {
    expect(edgeDisplayName(
      EDGES.find((x) => x.id === 'electric-to-visible-led')!,
      'en',
    )).toMatch(/LED/i)
    expect(edgeDisplayName(
      EDGES.find((x) => x.id === 'radiant-to-electric-photovoltaic')!,
      'en',
    )).toMatch(/Photo/i)
  })
})

describe('edgePrinciple', () => {
  it('zh returns Chinese principle', () => {
    const e = EDGES.find((x) => x.id === 'electric-to-thermal-joule')
    expect(e).toBeTruthy()
    expect(edgePrinciple(e!, 'zh')).toMatch(/焦耳|电阻|热/)
  })

  it('en returns English principle without CJK', () => {
    const e = EDGES.find((x) => x.id === 'electric-to-thermal-joule')
    const p = edgePrinciple(e!, 'en')
    expect(p).toMatch(/Joule|resistive|heat/i)
    expect(p).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('merged EDGES carry principleEn', () => {
    const e = EDGES.find((x) => x.id === 'thermal-to-electric-thermoelectric')
    expect(e?.principleEn).toBeTruthy()
    expect(e!.principleEn!).not.toMatch(/[\u4e00-\u9fff]/)
  })
})

describe('edgeEfficiencyNote', () => {
  it('zh returns Chinese note', () => {
    const e = EDGES.find((x) => x.id === 'electric-to-thermal-joule')
    expect(e?.efficiency.note).toBeTruthy()
    expect(edgeEfficiencyNote(e!, 'zh')).toBe(e!.efficiency.note)
  })

  it('en returns English note without CJK when mapped', () => {
    const e = EDGES.find((x) => x.id === 'electric-to-thermal-joule')
    const n = edgeEfficiencyNote(e!, 'en')
    expect(n).toBeTruthy()
    expect(n!).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
