import { describe, it, expect } from 'vitest'
import {
  bandgapToWavelength,
  wavelengthToBandgap,
  wavelengthToRGB,
  malus,
  mixRGB,
} from './display'

describe('显示与发光 · 物理核心', () => {
  it('带隙 → 波长：Eg=2eV → ≈620nm (橙红)', () => {
    expect(bandgapToWavelength(2)).toBeCloseTo(620, 6)
    // GaN 蓝光 Eg≈3.4eV → ≈365nm；红光 Eg≈1.9eV → ≈653nm
    expect(bandgapToWavelength(3.4)).toBeCloseTo(364.7, 1)
    expect(bandgapToWavelength(1.9)).toBeCloseTo(652.6, 1)
  })

  it('波长 ↔ 带隙 互逆', () => {
    expect(wavelengthToBandgap(620)).toBeCloseTo(2, 9)
    expect(bandgapToWavelength(wavelengthToBandgap(532))).toBeCloseTo(532, 6)
  })

  it('马吕斯定律：cos²θ 黄金值', () => {
    expect(malus(1, 0)).toBeCloseTo(1, 9)
    expect(malus(1, 90)).toBeCloseTo(0, 9)
    expect(malus(1, 45)).toBeCloseTo(0.5, 9)
    expect(malus(1, 60)).toBeCloseTo(0.25, 9)
    // I0 缩放
    expect(malus(200, 45)).toBeCloseTo(100, 9)
  })

  it('波长 → RGB：可见区返回有限的 0..255 整数', () => {
    for (const nm of [400, 450, 500, 550, 600, 650, 700]) {
      const rgb = wavelengthToRGB(nm)
      expect(rgb).toHaveLength(3)
      for (const c of rgb) {
        expect(Number.isFinite(c)).toBe(true)
        expect(Number.isInteger(c)).toBe(true)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(255)
      }
    }
  })

  it('波长 → RGB：定性颜色正确（蓝/绿/红主导通道）', () => {
    const blue = wavelengthToRGB(460)
    expect(blue[2]).toBeGreaterThan(blue[0]) // B > R
    const green = wavelengthToRGB(530)
    expect(green[1]).toBeGreaterThan(green[0]) // G > R
    expect(green[1]).toBeGreaterThan(green[2]) // G > B
    const red = wavelengthToRGB(680)
    expect(red[0]).toBeGreaterThan(red[1]) // R > G
    expect(red[0]).toBeGreaterThan(red[2]) // R > B
  })

  it('可见区外波长 → 黑色 [0,0,0]', () => {
    expect(wavelengthToRGB(300)).toEqual([0, 0, 0])
    expect(wavelengthToRGB(900)).toEqual([0, 0, 0])
  })

  it('RGB 子像素混色：白(1,1,1)=255, 全黑=0, 钳位', () => {
    expect(mixRGB(1, 1, 1)).toEqual([255, 255, 255])
    expect(mixRGB(0, 0, 0)).toEqual([0, 0, 0])
    expect(mixRGB(2, -1, 0.5)).toEqual([255, 0, 128])
  })
})
