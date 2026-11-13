import { describe, expect, it } from 'vitest'
import { METHODS } from '../data/methods/methods'
import { methodFoundation, methodSchoolStance } from './methodDisplay'

describe('methodFoundation', () => {
  it('zh returns Chinese source', () => {
    expect(methodFoundation('麦克斯韦方程组', 'zh')).toBe('麦克斯韦方程组')
  })

  it('en maps common foundations without CJK', () => {
    expect(methodFoundation('麦克斯韦方程组', 'en')).toMatch(/Maxwell/i)
    expect(methodFoundation('时间步须满足 库朗 稳定', 'en')).toMatch(/CFL/i)
    expect(methodFoundation('麦克斯韦方程组', 'en')).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('en maps all method foundations without CJK', () => {
    const seen = new Set<string>()
    for (const m of METHODS) {
      for (const f of m.foundations ?? []) {
        if (f.trim()) seen.add(f)
      }
    }
    expect(seen.size).toBeGreaterThan(100)
    for (const f of seen) {
      const en = methodFoundation(f, 'en')
      expect(en, f).toBeTruthy()
      expect(en, f).not.toMatch(/[\u4e00-\u9fff]/)
      expect(en, f).not.toBe('Foundation')
      expect(en, f).not.toBe('Method foundation')
    }
  })

  it('smith chart foundations resolve in English without CJK leak', () => {
    const smith = METHODS.find((m) => m.id === 'method-algo-smith-chart')
    expect(smith, 'method-algo-smith-chart').toBeDefined()
    const foundations = smith!.foundations ?? []
    expect(foundations.length).toBeGreaterThanOrEqual(3)
    for (const f of foundations) {
      const en = methodFoundation(f, 'en')
      expect(en, f).not.toMatch(/[\u4e00-\u9fff]/)
      expect(en, f).not.toBe(f)
    }
    expect(methodFoundation('莫比乌斯 Γ', 'en')).toMatch(/M[oö]bius|Gamma|Γ/i)
    expect(methodFoundation('恒阻圆', 'en')).toMatch(/resistance|circle|Smith/i)
    expect(methodFoundation('线长旋转', 'en')).toMatch(/length|rotation|Γ/i)
  })
})

describe('methodSchoolStance', () => {
  it('en maps curated school stances', () => {
    const s = methodSchoolStance(
      { stance: '显式 叶氏 + 默尔/完美匹配层 边界是工程主流。' },
      'en',
    )
    expect(s).toMatch(/Yee|PML|Mur/i)
    expect(s).not.toMatch(/[\u4e00-\u9fff]/)
  })
})

describe('methodSchoolNote', () => {
  it('en maps school notes without CJK', async () => {
    const { methodSchoolNote } = await import('./methodDisplay')
    const n = methodSchoolNote({ note: '本站样板为显式路径' }, 'en')
    expect(n).toMatch(/explicit|demo|path/i)
    expect(n).not.toMatch(/[\u4e00-\u9fff]/)
    expect(methodSchoolNote({ note: '本站样板为显式路径' }, 'zh')).toBe('本站样板为显式路径')
  })
})
