// src/lib/sim/params.test.ts
import { describe, it, expect } from 'vitest'
import { param, type ParameterSource } from './params'

describe('param 带来源参数工厂', () => {
  it('携带 value/unit/source/ontologyRef，计算用 .value', () => {
    const epsR: ParameterSource = param(24, '', '乙醇介电常数 @20°C (CRC Handbook)', 'node:chemical')
    expect(epsR.value).toBe(24)
    expect(epsR.unit).toBe('')
    expect(epsR.source).toContain('乙醇')
    expect(epsR.ontologyRef).toBe('node:chemical')
  })
  it('ontologyRef 可省略', () => {
    const dt = param(0.005, '约化', '速度 Verlet 稳定步长')
    expect(dt.value).toBe(0.005)
    expect(dt.ontologyRef).toBeUndefined()
  })
})
