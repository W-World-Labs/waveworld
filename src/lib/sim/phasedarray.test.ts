import { describe, it, expect } from 'vitest'
import { arrayFactor, pattern, beamwidth3dB, gratingLobes, phasedArrayResult } from './phasedarray'

describe('相控阵波束成形 阵因子', () => {
  it('measures the requested lobe instead of a stronger sampled grating lobe', () => {
    const result = phasedArrayResult({ n: 12, dOverLambda: 1, steerDeg: 80 })
    expect(result.grating.length).toBeGreaterThan(0)
    expect(result.beamwidthClipped).toBe(true)
    expect(result.beamwidthDeg).toBeGreaterThan(15)
    expect(result.beamwidthDeg).toBeLessThan(25)
    expect(phasedArrayResult({ n: 2, dOverLambda: 0.25, steerDeg: 0 }).beamwidthDeg).toBe(180)
  })
  it('指向角处取归一化峰值 1', () => {
    // 任意 N、d/λ、steer：θ=steer 时所有元同相，AF=1
    expect(arrayFactor(0, 8, 0.5, 0)).toBeCloseTo(1, 9)
    expect(arrayFactor(30, 8, 0.5, 30)).toBeCloseTo(1, 9)
    expect(arrayFactor(-45, 12, 0.5, -45)).toBeCloseTo(1, 9)
  })

  it('阵因子始终在 0..1 之间', () => {
    const pat = pattern(10, 0.5, 20, 361)
    for (const p of pat) {
      expect(p.gain).toBeGreaterThanOrEqual(0)
      expect(p.gain).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('闭式黄金值：N=2,d/λ=0.5,steer=0 时 AF(θ)=|cos((π/2)sinθ)|', () => {
    // 两元 d=λ/2：ψ=π·sinθ，AF=|cos(ψ/2)|=|cos((π/2)sinθ)|
    for (const t of [0, 15, 30, 45, 60]) {
      const golden = Math.abs(Math.cos((Math.PI / 2) * Math.sin((t * Math.PI) / 180)))
      expect(arrayFactor(t, 2, 0.5, 0)).toBeCloseTo(golden, 6)
    }
    // θ=90° 时 AF=cos(π/2)=0（端射零点）
    expect(arrayFactor(90, 2, 0.5, 0)).toBeCloseTo(0, 6)
  })

  it('N 越大主瓣越窄（−3dB 波束宽度更小）', () => {
    const bw8 = beamwidth3dB(8, 0.5, 0)
    const bw16 = beamwidth3dB(16, 0.5, 0)
    const bw32 = beamwidth3dB(32, 0.5, 0)
    expect(bw16).toBeLessThan(bw8)
    expect(bw32).toBeLessThan(bw16)
    // 大致对应解析近似 0.886·λ/(N·d)（弧度），broadside N=16,d=0.5λ ≈ 6.3°
    expect(bw16).toBeGreaterThan(4)
    expect(bw16).toBeLessThan(9)
  })

  it('d≥1λ 时出现栅瓣，d=0.5λ 无栅瓣（broadside）', () => {
    // broadside, d=λ：sinθ=±1 → θ=±90° 出现栅瓣
    const lobes = gratingLobes(1.0, 0)
    expect(lobes.length).toBeGreaterThanOrEqual(1)
    // 这些方向阵因子也达到峰值 1
    for (const ang of lobes) {
      expect(arrayFactor(ang, 8, 1.0, 0)).toBeCloseTo(1, 6)
    }
    // d=λ/2 broadside：无可见栅瓣
    expect(gratingLobes(0.5, 0).length).toBe(0)
  })

  it('波束随 steer 移动：指向 30° 时峰值在 30° 而非 0°', () => {
    const at30 = arrayFactor(30, 16, 0.5, 30)
    const at0 = arrayFactor(0, 16, 0.5, 30)
    expect(at30).toBeCloseTo(1, 6)
    expect(at0).toBeLessThan(0.3)
  })
})
