import { describe, expect, it } from 'vitest'
import { maturityLabel } from './maturityDisplay'

describe('maturityLabel', () => {
  it('zh returns original free text', () => {
    expect(maturityLabel('商用', 'zh')).toBe('商用')
    expect(maturityLabel('示范/小批量商用', 'zh')).toBe('示范/小批量商用')
  })

  it('en maps common Chinese maturity labels', () => {
    expect(maturityLabel('商用', 'en')).toMatch(/commercial|Mature/i)
    expect(maturityLabel('示范', 'en')).toMatch(/Demo|prototype/i)
    expect(maturityLabel('实验', 'en')).toMatch(/Experimental|research/i)
    expect(maturityLabel('实验室', 'en')).toMatch(/Lab|experimental/i)
  })

  it('en leaves Latin labels intact', () => {
    expect(maturityLabel('mature', 'en')).toBe('mature')
    expect(maturityLabel('commercial', 'en')).toBe('commercial')
  })

  it('en maps mixed app maturity strings without leftover CJK', () => {
    const samples = [
      '商用 / 实验室标配',
      '示范 / 研究（微功率）',
      '量子计算商用早期 / 研究前沿',
      '航天商用 / 在轨主流电推进',
    ]
    for (const s of samples) {
      const out = maturityLabel(s, 'en')
      expect(out, s).not.toMatch(/[\u4e00-\u9fff]/)
      expect(out.length).toBeGreaterThan(4)
    }
  })
})
