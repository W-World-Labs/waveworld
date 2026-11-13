import { describe, it, expect } from 'vitest'
import { wavelength, quarterWave, halfWave, ANTENNAS, fmt } from './antennatypes'

describe('天线尺寸 · 频率反比', () => {
  it('波长 λ=c/f 黄金值', () => {
    expect(wavelength(100e6)).toBeCloseTo(3, 6)       // FM 100MHz → 3m
    expect(wavelength(2.45e9)).toBeCloseTo(0.1224, 3) // 2.4G → 12.2cm
    expect(wavelength(1e6)).toBeCloseTo(300, 3)       // AM 1MHz → 300m
  })

  it('FM ¼ 波约 0.75m，AM ¼ 波达 75m（故 AM 用磁棒/长线）', () => {
    expect(quarterWave(100e6)).toBeCloseTo(0.75, 3)
    expect(quarterWave(1e6)).toBeCloseTo(75, 1)
    expect(halfWave(2.45e9)).toBeCloseTo(0.0612, 3)   // 2.4G 半波 ~6cm
  })

  it('频率越高天线越小（¼波单调减）', () => {
    expect(quarterWave(5.8e9)).toBeLessThan(quarterWave(2.45e9))
    expect(quarterWave(2.45e9)).toBeLessThan(quarterWave(100e6))
  })

  it('图鉴按频率递增、字段完整', () => {
    for (let i = 1; i < ANTENNAS.length; i++) expect(ANTENNAS[i].fMHz).toBeGreaterThanOrEqual(ANTENNAS[i - 1].fMHz)
    for (const a of ANTENNAS) {
      expect(a.fMHz).toBeGreaterThan(0)
      expect(a.name.length).toBeGreaterThan(0)
      expect(typeof a.gainDbi).toBe('number')
    }
    // 覆盖用户点名的天线
    const ids = ANTENNAS.map((a) => a.id)
    for (const id of ['wifi24', 'wifi58', 'zwave', 'fm', 'am', 'phased']) expect(ids).toContain(id)
  })

  it('尺寸格式化 km/m/cm', () => {
    expect(fmt(75)).toContain('m')
    expect(fmt(0.03)).toContain('cm')
    expect(fmt(2000)).toContain('km')
  })
})
