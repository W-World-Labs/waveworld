import { describe, expect, it } from 'vitest'
import { quantityNote } from './quantityDisplay'

describe('quantityNote', () => {
  it('zh returns original note', () => {
    expect(quantityNote('电功率 P=UI', 'zh')).toBe('电功率 P=UI')
  })

  it('en maps common notes without CJK', () => {
    const n = quantityNote('电功率 P=UI', 'en')
    expect(n).toMatch(/power|P=UI/i)
    expect(n).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('en maps thermal exergy note', () => {
    const n = quantityNote(
      '绝对温度决定㶲品位：可用功因子 φ=1−T₀/T（T₀≈298K）。室温废热 φ→0、燃烧高温 φ→~0.85——故热能是低品位能量，不能与电能等量齐观',
      'en',
    )
    expect(n).toMatch(/exergy|availability|φ/i)
    expect(n).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('en no longer uses stub placeholders for common notes', () => {
    const samples = [
      '人耳标称听觉频带',
      '太阳有效辐射温度',
      '每次 氘氚聚变释放能量',
      'C-C 单键',
      'Pu-238 比功率 ≈ 0.54 W/g(热)',
    ]
    for (const zh of samples) {
      const n = quantityNote(zh, 'en')
      expect(n, zh).toBeTruthy()
      expect(n!, zh).not.toMatch(/[\u4e00-\u9fff]/)
      expect(n!, zh).not.toMatch(/^quantity note$/i)
      expect(n!.length, zh).toBeGreaterThan(6)
    }
  })
})
