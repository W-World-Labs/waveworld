import { describe, it, expect } from 'vitest'
import {
  OPTICS_CRITICAL_ID,
  OPTICS_FRESNEL_ID,
  OPTICS_L2_METHOD_IDS,
  OPTICS_L2_PARENT,
  OPTICS_SNELL_ID,
  criticalAngle,
  fresnelAmplitudeAbsViaEps,
  fresnelAmplitudeR,
  fresnelPowerR,
  fresnelPowerT,
  isTotalInternalReflection,
  runCriticalAngleSample,
  runFresnelNormalSample,
} from './optics-l2-algos'
import { fresnelReflection } from './fdtd'
import { methodById } from '../../data/methods/methods'

describe('几何光学 L2 · 菲涅耳 / 临界角', () => {
  it('方法 id 常量对齐 ray-optics / snell 目录', () => {
    expect(OPTICS_L2_PARENT).toBe('method-ray-optics')
    expect(OPTICS_SNELL_ID).toBe('method-algo-snell')
    expect(OPTICS_FRESNEL_ID).toBe('method-algo-fresnel-normal')
    expect(OPTICS_CRITICAL_ID).toBe('method-algo-critical-angle')
    expect(OPTICS_L2_METHOD_IDS).toHaveLength(3)
    expect(methodById(OPTICS_L2_PARENT)).toBeDefined()
    expect(methodById(OPTICS_SNELL_ID)?.parentId).toBe(OPTICS_L2_PARENT)
  })

  it('正入射功率反射率 R=((n1−n2)/(n1+n2))²', () => {
    // 空气→玻璃：|r|=0.2，R=0.04
    expect(fresnelAmplitudeR(1, 1.5)).toBeCloseTo(-0.2, 12)
    expect(fresnelPowerR(1, 1.5)).toBeCloseTo(0.04, 12)
    expect(fresnelPowerT(1, 1.5)).toBeCloseTo(0.96, 12)
    // 相同介质无反射
    expect(fresnelPowerR(1.33, 1.33)).toBeCloseTo(0, 15)
    // 互换界面 |R| 相同
    expect(fresnelPowerR(1.5, 1)).toBeCloseTo(fresnelPowerR(1, 1.5), 12)
  })

  it('与 fdtd.fresnelReflection 交叉：|r| 一致', () => {
    const n1 = 1
    const n2 = 1.5
    const absR = Math.abs(fresnelAmplitudeR(n1, n2))
    expect(absR).toBeCloseTo(fresnelReflection(n1 * n1, n2 * n2), 12)
    expect(absR).toBeCloseTo(fresnelAmplitudeAbsViaEps(n1, n2), 12)
    // ε=1→4 → n=1→2，|r|=1/3
    expect(Math.abs(fresnelAmplitudeR(1, 2))).toBeCloseTo(fresnelReflection(1, 4), 12)
  })

  it('runFresnelNormalSample：R=0.04 且与 fdtd 对拍', () => {
    const r = runFresnelNormalSample()
    expect(r.methodId).toBe(OPTICS_FRESNEL_ID)
    expect(r.R).toBeCloseTo(0.04, 12)
    expect(r.T + r.R).toBeCloseTo(1, 12)
    expect(Math.abs(r.r)).toBeCloseTo(r.absRViaFdtd, 12)
    expect(r.R).toBeCloseTo(r.absRViaFdtd * r.absRViaFdtd, 12)
  })

  it('临界角：玻璃→空气 θc=arcsin(1/1.5)', () => {
    const tc = criticalAngle(1.5, 1)
    expect(tc).toBeCloseTo(Math.asin(1 / 1.5), 12)
    // 疏→密无 TIR
    expect(Number.isNaN(criticalAngle(1, 1.5))).toBe(true)
    expect(isTotalInternalReflection(1, 1.5, Math.PI / 2)).toBe(false)
    // 恰在临界角：TIR（≥）
    expect(isTotalInternalReflection(1.5, 1, tc)).toBe(true)
    expect(isTotalInternalReflection(1.5, 1, tc - 0.01)).toBe(false)
  })

  it('runCriticalAngleSample：45° 全反，30° 可透', () => {
    const r = runCriticalAngleSample()
    expect(r.methodId).toBe(OPTICS_CRITICAL_ID)
    expect(r.thetaCdeg).toBeCloseTo((Math.asin(1 / 1.5) * 180) / Math.PI, 8)
    expect(r.tirAt45).toBe(true)
    expect(r.tirAt30).toBe(false)
  })
})
