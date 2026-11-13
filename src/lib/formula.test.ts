// src/lib/formula.test.ts
import { describe, it, expect } from 'vitest'
import { evalExpr } from './formula'

describe('evalExpr — 已知物理算例黄金值', () => {
  it('焦耳损耗 P = I^2 * R，I=2,R=3 → 12W', () => {
    expect(evalExpr('P_loss = I^2 * R', { I: 2, R: 3 })).toBeCloseTo(12, 9)
  })

  it('光子能量 E = h*f，h=6.626e-34,f=6e14 → 3.9756e-19 J', () => {
    expect(evalExpr('E_photon = h*f', { h: 6.626e-34, f: 6e14 })).toBeCloseTo(3.9756e-19, 22)
  })

  it('菲涅耳反射 R=((n1-n2)/(n1+n2))^2，n1=1,n2=1.5 → 0.04', () => {
    expect(evalExpr('R = ((n1-n2)/(n1+n2))^2', { n1: 1, n2: 1.5 })).toBeCloseTo(0.04, 9)
  })

  it('一元负号优先级低于幂：-2^2=-4、-x^2(x=3)=-9，而非 (-2)^2=4', () => {
    expect(evalExpr('-2^2', {})).toBeCloseTo(-4, 12)
    expect(evalExpr('-x^2', { x: 3 })).toBeCloseTo(-9, 12)
    expect(evalExpr('2^-3', {})).toBeCloseTo(0.125, 12) // 指数中的负号仍正确绑定
    expect(evalExpr('2^2^3', {})).toBeCloseTo(256, 9)    // 幂右结合
    expect(evalExpr('-2*3', {})).toBeCloseTo(-6, 12)
  })

  it('一元负号与括号：-(2+3)*2 → -10', () => {
    expect(evalExpr('-(2+3)*2', {})).toBeCloseTo(-10, 9)
  })

  it('缺变量抛错', () => {
    expect(() => evalExpr('a*b', { a: 1 })).toThrow()
  })

  it('除零抛错', () => {
    expect(() => evalExpr('1/0', {})).toThrow(/除零/)
    expect(() => evalExpr('a/b', { a: 1, b: 0 })).toThrow(/除零/)
  })

  it('栈下溢抛错', () => {
    // 一元负号无操作数
    expect(() => evalExpr('-', {})).toThrow()
    // 二元算子缺操作数
    expect(() => evalExpr('1+', {})).toThrow()
    expect(() => evalExpr('*2', {})).toThrow()
  })

  it('函数 sqrt/exp/ln/abs', () => {
    expect(evalExpr('sqrt(16)', {})).toBeCloseTo(4, 9)
    expect(evalExpr('exp(0)', {})).toBeCloseTo(1, 9)
    expect(evalExpr('abs(-3)', {})).toBeCloseTo(3, 9)
    expect(evalExpr('2*ln(e)', {})).toBeCloseTo(2, 9) // e=Euler 常数 → ln(e)=1
  })

  it('常数 pi 与 e；变量优先于常数 e', () => {
    expect(evalExpr('2*pi', {})).toBeCloseTo(2 * Math.PI, 9)
    expect(evalExpr('e', {})).toBeCloseTo(Math.E, 9)
    expect(evalExpr('e', { e: 1.602e-19 })).toBeCloseTo(1.602e-19, 25) // 变量 e（电子电荷）覆盖常数
  })

  it('Richardson 热电子发射 J=A*T^2*exp(-phi/(k*T))', () => {
    const v = { A: 1.2e6, T: 2000, phi: 4.5, k: 8.617e-5 }
    // 手算交叉校验：指数 = -4.5/(8.617e-5*2000) = -26.111 → J≈1.2e6*4e6*exp(-26.111)
    const got = evalExpr('J = A*T^2*exp(-phi/(k*T))', v)
    expect(got).toBeGreaterThan(0)
    expect(Number.isFinite(got)).toBe(true)
  })

  it('热电效率 eta=(1-T_c/T_h)*(sqrt(1+ZT)-1)/(sqrt(1+ZT)+T_c/T_h)', () => {
    const got = evalExpr('eta = (1 - T_c / T_h) * (sqrt(1 + ZT) - 1) / (sqrt(1 + ZT) + T_c / T_h)', { T_c: 300, T_h: 600, ZT: 1 })
    expect(got).toBeGreaterThan(0)
    expect(got).toBeLessThan(1)
  })
})
