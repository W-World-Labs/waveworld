import { describe, expect, it } from 'vitest'
import { EDGES } from '../data/ontology/edges'
import { appDisplayName, deviceDisplayName } from './deviceDisplay'

describe('deviceDisplayName', () => {
  it('zh returns Chinese', () => {
    expect(deviceDisplayName('磁控管', 'zh')).toBe('磁控管')
  })

  it('en maps common devices without CJK', () => {
    expect(deviceDisplayName('磁控管', 'en')).toMatch(/Magnetron/i)
    expect(deviceDisplayName('接收天线', 'en')).toMatch(/Antenna/i)
    expect(deviceDisplayName('光伏组件', 'en')).toMatch(/PV|module/i)
    expect(deviceDisplayName('磁控管', 'en')).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('en maps all edge.device labels without CJK', () => {
    const names = new Set<string>()
    for (const e of EDGES) {
      for (const d of e.device ?? []) {
        if (typeof d === 'string' && d.trim()) names.add(d)
      }
    }
    expect(names.size).toBeGreaterThan(100)
    let sample = 0
    for (const d of names) {
      const en = deviceDisplayName(d, 'en')
      expect(en, d).toBeTruthy()
      expect(en, d).not.toMatch(/[\u4e00-\u9fff]/)
      if (sample < 3 && en !== d) sample++
    }
    expect(sample).toBeGreaterThan(0)
  })
})

describe('appDisplayName', () => {
  it('zh returns Chinese', () => {
    expect(appDisplayName('无线传感器供电', 'zh')).toBe('无线传感器供电')
  })

  it('en maps common app tags without CJK', () => {
    const en = appDisplayName('无线传感器供电', 'en')
    expect(en).toMatch(/wireless|sensor|power/i)
    expect(en).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('en maps all edge.apps tags without CJK', () => {
    const names = new Set<string>()
    for (const e of EDGES) {
      for (const a of e.apps ?? []) {
        if (typeof a === 'string' && a.trim()) names.add(a)
      }
    }
    expect(names.size).toBeGreaterThan(100)
    for (const a of names) {
      const en = appDisplayName(a, 'en')
      expect(en, a).toBeTruthy()
      expect(en, a).not.toMatch(/[\u4e00-\u9fff]/)
      expect(en, a).not.toMatch(/^\/|\/$/)
    }
  })
})
