import { describe, it, expect } from 'vitest'
import { reflectionCoef, aline, ultrasoundResult, US_SAMPLES } from './ultrasound'

describe('reflectionCoef — 振幅反射系数', () => {
  it('Z2>Z1 → 正反射（黄金值：脂肪1.38→肝1.65 MRayl）', () => {
    const r = reflectionCoef(1.38, 1.65)
    expect(r).toBeGreaterThan(0)
    // (1.65-1.38)/(1.65+1.38) = 0.27/3.03 ≈ 0.0891
    expect(r).toBeCloseTo(0.0891, 3)
  })

  it('声阻抗相等 → 零反射（界面不可见）', () => {
    expect(reflectionCoef(1.5, 1.5)).toBe(0)
  })

  it('Z2<Z1 → 负反射，且 |r| 对称', () => {
    const rUp = reflectionCoef(1.0, 2.0)
    const rDown = reflectionCoef(2.0, 1.0)
    expect(rDown).toBeLessThan(0)
    expect(Math.abs(rDown)).toBeCloseTo(Math.abs(rUp), 6)
    // (2-1)/(2+1) = 1/3
    expect(rUp).toBeCloseTo(1 / 3, 6)
  })

  it('软组织↔骨大反射（黄金值：1.6→7.8 MRayl, r≈0.66）', () => {
    expect(reflectionCoef(1.6, 7.8)).toBeCloseTo(0.6596, 3)
  })
})

// aline 输出是对数压缩灰度：v = (20·log10(env) + 60)/60，env 峰值 ≈ |r|·e^{−A(d)}
// 其中 A(d) = 2∫α 为双程衰减。两个深度回波的灰度差 Δv = 20·log10(env比)/60。
const DB_PER_GRAY = 20 / 60

describe('aline — 脉冲回波卷积 A 线（对数压缩包络）', () => {
  const maxDepth = 100
  const samples = 200

  it('界面深度附近有回波峰，无界面处为黑', () => {
    const a = aline([{ depth: 50, r: 0.5 }], maxDepth, samples, 0)
    const peakIdx = a.indexOf(Math.max(...a))
    // 峰位落在界面对应格 ±一个脉宽内
    expect(Math.abs(peakIdx - (50 / (maxDepth / samples) - 0.5))).toBeLessThanOrEqual(8)
    expect(a[peakIdx]).toBeGreaterThan(0.8) // env≈0.5 → −6 dB → 0.9
    const farIdx = Math.round(10 / (maxDepth / samples) - 0.5)
    expect(a[farIdx]).toBe(0) // 远离界面无回波 → 低于动态范围下限
  })

  it('更深的界面回波更弱（双程衰减 exp(−2αd)）', () => {
    const a = aline(
      [
        { depth: 20, r: 0.5 },
        { depth: 80, r: 0.5 },
      ],
      maxDepth,
      samples,
      0.02,
    )
    const peakNear = Math.max(...a.slice(0, samples / 2))
    const peakFar = Math.max(...a.slice(samples / 2))
    expect(peakFar).toBeGreaterThan(0)
    expect(peakFar).toBeLessThan(peakNear)
    // 包络比 = exp(−2·0.02·(80−20)) = e^{−2.4}；灰度差 = 20·log10(e^{2.4})/60
    expect(peakNear - peakFar).toBeCloseTo(2.4 * Math.LOG10E * DB_PER_GRAY, 1)
  })

  it('回波峰幅度 ∝ |r|：阻抗反差越大界面越亮', () => {
    const aLow = aline([{ depth: 40, r: 0.2 }], maxDepth, samples, 0)
    const aHigh = aline([{ depth: 40, r: 0.6 }], maxDepth, samples, 0)
    const pLow = Math.max(...aLow)
    const pHigh = Math.max(...aHigh)
    // 灰度差 = 20·log10(0.6/0.2)/60 = 20·log10(3)/60
    expect(pHigh - pLow).toBeCloseTo(DB_PER_GRAY * Math.log10(3), 1)
    // 更大阻抗差 → 单调更亮
    const aMid = aline([{ depth: 40, r: 0.4 }], maxDepth, samples, 0)
    expect(Math.max(...aMid)).toBeGreaterThan(pLow)
    expect(Math.max(...aMid)).toBeLessThan(pHigh)
  })

  it('逐材料衰减：低吸收路径上深部回波更亮', () => {
    const uniform = aline([{ depth: 80, r: 0.5 }], maxDepth, samples, 0.02)
    const lowPath = aline([{ depth: 80, r: 0.5 }], maxDepth, samples, (d) => (d > 40 ? 0 : 0.02))
    expect(Math.max(...lowPath)).toBeGreaterThan(Math.max(...uniform))
  })

  it('范围外界面被忽略，输出非负且 ≤1', () => {
    const a = aline([{ depth: 200, r: 0.9 }], maxDepth, samples, 0)
    expect(Math.max(...a)).toBe(0)
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0)
    const b = aline([{ depth: 40, r: 0.9 }], maxDepth, samples, 0)
    expect(Math.max(...b)).toBeLessThanOrEqual(1)
  })
})

describe('ultrasoundResult — B 模场景', () => {
  const scene = { atten: 0.025, gain: 1.0, seed: 7 }

  it('输出形状与既有契约一致', () => {
    const r = ultrasoundResult(scene)
    expect(r.field).toHaveLength(200 * US_SAMPLES)
    expect(r.echoes).toHaveLength(200)
    expect(r.envelope).toHaveLength(US_SAMPLES)
    expect(r.coefficients).toHaveLength(3)
    expect(r.field.every((v) => v >= 0 && v <= 1)).toBe(true)
    expect(r.envelope.every((v) => v >= 0 && v <= 1)).toBe(true)
  })

  it('散斑由场景 seed 播种：同 seed 全等，异 seed 不同', () => {
    const a = ultrasoundResult({ atten: 0.02, gain: 1, seed: 42 })
    const b = ultrasoundResult({ atten: 0.02, gain: 1, seed: 42 })
    expect(a.field).toEqual(b.field)
    const c = ultrasoundResult({ atten: 0.02, gain: 1, seed: 43 })
    expect(c.field).not.toEqual(a.field)
  })

  it('囊肿内部无回声（暗区），囊壁有回波', () => {
    const r = ultrasoundResult({ atten: 0.02, gain: 1, seed: 3 })
    // 囊肿中心线 lx≈0.62 → line ≈ 123；内部深度 42–68 mm
    const line = 123
    const at = (d: number) => r.field[line * US_SAMPLES + Math.round(d / (100 / US_SAMPLES) - 0.5)]!
    const interior = at(55)
    const wall = at(42)
    expect(interior).toBeLessThan(0.05)
    expect(wall).toBeGreaterThan(interior)
  })

  it('囊液低吸收 → 囊肿后方组织更亮（后方增强）', () => {
    const r = ultrasoundResult({ atten: 0.012, gain: 1, seed: 5 })
    const mean = (line: number, d0: number, d1: number) => {
      const s0 = Math.round(d0 / (100 / US_SAMPLES))
      const s1 = Math.round(d1 / (100 / US_SAMPLES))
      let acc = 0
      for (let s = s0; s < s1; s++) acc += r.field[line * US_SAMPLES + s]!
      return acc / (s1 - s0)
    }
    // 穿过囊肿的线（lx≈0.62, line 123）其后方 71–77 mm 平均亮度
    // 高于未穿囊肿的线（lx≈0.2, line 40）同深度组织
    expect(mean(123, 71, 77)).toBeGreaterThan(mean(40, 71, 77))
  })
})
