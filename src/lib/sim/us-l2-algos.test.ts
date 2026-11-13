import { describe, it, expect } from 'vitest'
import {
  US_L2_ALINE_ID,
  US_L2_BMODE_COMPOSE_ID,
  US_L2_METHOD_IDS,
  US_L2_PARENT,
  US_L2_REFLECTION_ID,
  boundariesAtLx,
  bmodeEnergy,
  composeBmode,
  countBmodePeaks,
  runBmodeComposeSample,
} from './us-l2-algos'
import { reflectionCoef } from './ultrasound'

describe('超声 L2 · B 模多线合成', () => {
  it('方法 id 常量对齐目录（compose 为未入库新 id）', () => {
    expect(US_L2_PARENT).toBe('method-b-mode-ultrasound')
    expect(US_L2_REFLECTION_ID).toBe('method-algo-us-reflection')
    expect(US_L2_ALINE_ID).toBe('method-algo-us-aline')
    expect(US_L2_BMODE_COMPOSE_ID).toBe('method-algo-us-bmode-compose')
    expect(US_L2_METHOD_IDS).toContain(US_L2_BMODE_COMPOSE_ID)
  })

  it('boundariesAtLx：分层反射与 reflectionCoef 一致；中心有囊肿壁', () => {
    const edge = boundariesAtLx(0.0, 100)
    const mid = boundariesAtLx(0.5, 100)
    // 三层界面
    expect(edge.length).toBe(3)
    expect(edge[0]!.r).toBeCloseTo(reflectionCoef(1.5, 1.38), 12)
    // 中心多一条囊肿壁
    expect(mid.length).toBe(4)
  })

  it('composeBmode：维度 nLines×samples，能量有限、峰存在', () => {
    const nLines = 24
    const samples = 100
    const m = composeBmode(nLines, samples, 100, 0.02)
    expect(m.length).toBe(nLines * samples)
    const e = bmodeEnergy(m)
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThan(0)
    expect(countBmodePeaks(m, nLines, samples)).toBeGreaterThan(0)
  })

  it('runBmodeComposeSample：维度、能量有限、峰存在', () => {
    const r = runBmodeComposeSample()
    expect(r.methodId).toBe(US_L2_BMODE_COMPOSE_ID)
    expect(r.length).toBe(r.nLines * r.samples)
    expect(r.finite).toBe(true)
    expect(r.energy).toBeGreaterThan(0)
    expect(r.peaks).toBeGreaterThan(0)
  })
})
