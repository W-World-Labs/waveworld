import { describe, expect, it } from 'vitest'
import { productModel, productSpec, productVendor } from './productDisplay'

const CJK = /[\u4e00-\u9fff]/

describe('productSpec', () => {
  it('zh returns Chinese source', () => {
    expect(productSpec({ spec: '紫外固化' }, 'zh')).toBe('紫外固化')
  })

  it('en maps curated specs without CJK', () => {
    const s = productSpec({ spec: '紫外固化' }, 'en')
    expect(s).toMatch(/UV|curing/i)
    expect(s).not.toMatch(CJK)
  })

  it('en prefers inline specEn over overlay map', () => {
    expect(
      productSpec({ spec: '紫外固化', specEn: 'UV cure (inline)' }, 'en'),
    ).toBe('UV cure (inline)')
  })

  it('en hides unmapped CJK specs', () => {
    expect(productSpec({ spec: '尚未收录的中文规格串XYZ' }, 'en')).toBeUndefined()
  })

  it('en keeps pure Latin/numeric specs', () => {
    expect(productSpec({ spec: '915 MHz, 50 Ω' }, 'en')).toBe('915 MHz, 50 Ω')
  })

  it('near-full overlay map covers long technical specs', () => {
    const samples = [
      '²³⁸PuO₂，约 2000 Wth → ~110 We（好奇号/毅力号）',
      '全身 正电子发射断层，探测 511 keV 湮灭光子对',
      '联合循环效率 >64%（化学能→电）',
    ]
    for (const zh of samples) {
      const en = productSpec({ spec: zh }, 'en')
      expect(en, zh).toBeTruthy()
      expect(en!, zh).not.toMatch(CJK)
    }
  })

  it('covers every CJK product.spec in data (no EN CJK fallback hide)', async () => {
    const { EDGES } = await import('../data/ontology/edges')
    let checked = 0
    for (const e of EDGES) {
      for (const prod of e.products ?? []) {
        if (!prod.spec || !CJK.test(prod.spec)) continue
        const en = productSpec(prod, 'en')
        expect(en, `${e.id}: ${prod.spec}`).toBeTruthy()
        expect(en!, `${e.id}: ${prod.spec}`).not.toMatch(CJK)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })
})

describe('productVendor', () => {
  it('zh returns Chinese source', () => {
    expect(productVendor({ vendor: '通用' }, 'zh')).toBe('通用')
  })

  it('en maps generic vendors without CJK', () => {
    const v = productVendor({ vendor: '通用' }, 'en')
    expect(v).toMatch(/generic/i)
    expect(v).not.toMatch(CJK)
  })

  it('covers every CJK product.vendor in data', async () => {
    const { EDGES } = await import('../data/ontology/edges')
    let checked = 0
    for (const e of EDGES) {
      for (const prod of e.products ?? []) {
        if (!prod.vendor || !CJK.test(prod.vendor)) continue
        const en = productVendor(prod, 'en')
        expect(en, `${e.id}: ${prod.vendor}`).toBeTruthy()
        expect(en!, `${e.id}: ${prod.vendor}`).not.toMatch(CJK)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(400)
  })
})

describe('productModel', () => {
  it('zh returns Chinese source', () => {
    expect(productModel({ model: '动圈扬声器' }, 'zh')).toBe('动圈扬声器')
  })

  it('en maps curated models without CJK', () => {
    const m = productModel({ model: '动圈扬声器' }, 'en')
    expect(m).toMatch(/moving-coil|loudspeaker|speaker/i)
    expect(m).not.toMatch(CJK)
  })

  it('en falls back to Chinese when unmapped', () => {
    expect(productModel({ model: '尚未映射的中文型号XYZ' }, 'en')).toBe(
      '尚未映射的中文型号XYZ',
    )
  })

  it('covers every CJK product.model in data without residual CJK', async () => {
    const { EDGES } = await import('../data/ontology/edges')
    let checked = 0
    for (const e of EDGES) {
      for (const prod of e.products ?? []) {
        if (!prod.model || !CJK.test(prod.model)) continue
        const en = productModel(prod, 'en')
        expect(en, `${e.id}: ${prod.model}`).toBeTruthy()
        expect(en, `${e.id}: ${prod.model}`).not.toMatch(CJK)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(900)
  })
})
