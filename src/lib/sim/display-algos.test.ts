import { describe, it, expect } from 'vitest'
import {
  DISPLAY_ALGO_METHOD_IDS,
  DISPLAY_PARENT,
  runBandgapSample,
  runDisplayAlgo,
  runMalusSample,
  runOledMixSample,
  runVisibleRgbSample,
  type DisplayAlgoId,
} from './display-algos'
import { methodById } from '../../data/methods/methods'

describe('显示光电方法族模块化（LED/OLED/LCD）', () => {
  it('DISPLAY_PARENT 对齐 method-display-opto', () => {
    expect(DISPLAY_PARENT).toBe('method-display-opto')
    const m = methodById(DISPLAY_PARENT)
    expect(m).toBeDefined()
    expect(m!.id).toBe(DISPLAY_PARENT)
  })

  it('runBandgapSample：Eg=1.8 eV → λ≈689 nm，互逆往返闭合', () => {
    const r = runBandgapSample(1.8)
    // 1240/1.8 ≈ 688.889
    expect(r.nm).toBeCloseTo(1240 / 1.8, 6)
    expect(r.nm).toBeCloseTo(689, 0)
    expect(r.EgBack).toBeCloseTo(1.8, 10)
    expect(r.roundtripNm).toBeCloseTo(r.nm, 6)
  })

  it('runMalusSample：θ=0 最大，θ=90 ≈0，θ=45 半功率', () => {
    const r = runMalusSample(1)
    expect(r.I0deg).toBeCloseTo(1, 9)
    expect(r.I90).toBeCloseTo(0, 9)
    expect(r.I45).toBeCloseTo(0.5, 9)
    expect(r.I0deg).toBeGreaterThan(r.I90)
  })

  it('runVisibleRgbSample：~550 nm 绿光 G 通道主导', () => {
    const r = runVisibleRgbSample(550)
    expect(r.rgb).toHaveLength(3)
    expect(r.g).toBeGreaterThan(r.r)
    expect(r.g).toBeGreaterThan(r.b)
    expect(r.g).toBeGreaterThan(200)
    for (const c of r.rgb) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(255)
    }
  })

  it('runOledMixSample：白/黑/钳位走真实 mixRGB', () => {
    const r = runOledMixSample()
    expect(r.white).toEqual([255, 255, 255])
    expect(r.black).toEqual([0, 0, 0])
    expect(r.clamped).toEqual([255, 0, 128])
  })

  it('runDisplayAlgo 分发覆盖全部子算法 id', () => {
    const ids = Object.keys(DISPLAY_ALGO_METHOD_IDS) as DisplayAlgoId[]
    expect(ids.length).toBe(4)
    for (const id of ids) {
      const out = runDisplayAlgo(id)
      expect(out).toBeTruthy()
      expect(typeof out).toBe('object')
    }
  })
})
