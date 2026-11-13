import { describe, it, expect } from 'vitest'
import {
  METHOD_AD,
  METHOD_ALGO_AD_FORWARD,
  AD_PARENT,
  AD_METHOD_IDS,
  dual,
  dualConst,
  dualVar,
  dualAdd,
  dualSub,
  dualMul,
  dualDiv,
  dualScale,
  dualSin,
  dualCos,
  dualExp,
  dualSquare,
  forwardDiff,
  fSinX2,
  analyticSinX2,
  fExpSin,
  analyticExpSin,
  runAdForwardSample,
} from './ad-algos'

describe('AD · forward-mode dual numbers', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_AD).toBe('method-automatic-differentiation')
    expect(METHOD_ALGO_AD_FORWARD).toBe('method-algo-ad-forward')
    expect(AD_PARENT).toBe(METHOD_AD)
    expect(AD_METHOD_IDS).toContain(METHOD_ALGO_AD_FORWARD)
  })

  it('dualAdd / dualMul basics', () => {
    const a = dual(2, 1)
    const b = dual(3, 0)
    const s = dualAdd(a, b)
    expect(s.val).toBeCloseTo(5, 12)
    expect(s.der).toBeCloseTo(1, 12)
    const p = dualMul(a, b)
    expect(p.val).toBeCloseTo(6, 12)
    expect(p.der).toBeCloseTo(3, 12)
  })

  it('dualSub / dualDiv / dualScale / dualCos', () => {
    const a = dualVar(4)
    const b = dualConst(2)
    const d = dualDiv(a, b)
    expect(d.val).toBeCloseTo(2, 12)
    expect(d.der).toBeCloseTo(0.5, 12)
    const s = dualSub(a, b)
    expect(s.val).toBeCloseTo(2, 12)
    expect(s.der).toBeCloseTo(1, 12)
    const sc = dualScale(3, a)
    expect(sc.val).toBeCloseTo(12, 12)
    expect(sc.der).toBeCloseTo(3, 12)
    const c = dualCos(dualVar(0))
    expect(c.val).toBeCloseTo(1, 12)
    expect(c.der).toBeCloseTo(0, 12)
  })

  it('dualSin / dualExp chain', () => {
    const x = dualVar(0)
    const s = dualSin(x)
    expect(s.val).toBeCloseTo(0, 12)
    expect(s.der).toBeCloseTo(1, 12)
    const e = dualExp(x)
    expect(e.val).toBeCloseTo(1, 12)
    expect(e.der).toBeCloseTo(1, 12)
  })

  it('f(x)=sin(x^2) derivative matches 2x cos(x^2)', () => {
    const xs = [0.5, 1.0, 1.2, -0.8, 2.3]
    for (const x0 of xs) {
      const ad = forwardDiff(fSinX2, x0)
      const an = analyticSinX2(x0)
      expect(ad.value).toBeCloseTo(an.value, 12)
      expect(ad.derivative).toBeCloseTo(an.derivative, 12)
      expect(ad.derivative).toBeCloseTo(2 * x0 * Math.cos(x0 * x0), 12)
    }
  })

  it('dualSquare then sin equals fSinX2', () => {
    const x = dualVar(1.1)
    const y = dualSin(dualSquare(x))
    const z = fSinX2(x)
    expect(y.val).toBeCloseTo(z.val, 14)
    expect(y.der).toBeCloseTo(z.der, 14)
  })

  it('f(x)=exp(sin(x)) matches analytic', () => {
    const x0 = 0.9
    const ad = forwardDiff(fExpSin, x0)
    const an = analyticExpSin(x0)
    expect(ad.value).toBeCloseTo(an.value, 12)
    expect(ad.derivative).toBeCloseTo(an.derivative, 12)
  })

  it('runAdForwardSample: ok, methodId/familyId', () => {
    const r = runAdForwardSample({ x0: 1.2 })
    expect(r.methodId).toBe(METHOD_ALGO_AD_FORWARD)
    expect(r.familyId).toBe(METHOD_AD)
    expect(r.familyId).toBe('method-automatic-differentiation')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.absErrValue).toBeLessThan(1e-12)
    expect(r.absErrDerivative).toBeLessThan(1e-12)
    expect(r.derivative).toBeCloseTo(
      2 * r.x0 * Math.cos(r.x0 * r.x0),
      12,
    )
  })
})
