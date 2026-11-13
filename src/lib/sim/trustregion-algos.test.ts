import { describe, it, expect } from 'vitest'
import {
  METHOD_TRUST_REGION,
  METHOD_ALGO_TR_CAUCHY,
  TRUST_REGION_PARENT,
  TRUST_REGION_METHOD_IDS,
  norm2,
  dot,
  denseMatVec,
  quadraticValue,
  quadraticGrad,
  makeSpdQuadraticSystem,
  cauchyPoint,
  cauchyStep,
  cauchyTrustRegionMinimize,
  runTrCauchySample,
} from './trustregion-algos'

describe('Trust-region · Cauchy point', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_TRUST_REGION).toBe('method-trust-region')
    expect(METHOD_ALGO_TR_CAUCHY).toBe('method-algo-tr-cauchy')
    expect(TRUST_REGION_PARENT).toBe(METHOD_TRUST_REGION)
    expect(TRUST_REGION_METHOD_IDS).toContain(METHOD_ALGO_TR_CAUCHY)
  })

  it('norm2 / dot / denseMatVec basics', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    expect(dot([1, 2], [3, 4])).toBeCloseTo(11, 12)
    const A = [2, 0, 0, 3]
    const y = new Float64Array(2)
    denseMatVec(A, 2, [1, 1], y)
    expect(y[0]).toBeCloseTo(2, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('quadratic: grad = A x − b, min at x*', () => {
    const sys = makeSpdQuadraticSystem(3)
    const g = new Float64Array(3)
    quadraticGrad(sys.A, sys.b, 3, sys.xTrue, g)
    expect(norm2(g)).toBeLessThan(1e-12)
    const fStar = quadraticValue(sys.A, sys.b, 3, sys.xTrue)
    const f0 = quadraticValue(sys.A, sys.b, 3, new Float64Array([0, 0, 0]))
    expect(fStar).toBeLessThan(f0)
  })

  it('cauchyPoint: zero gradient → zero step', () => {
    const g = new Float64Array([0, 0])
    const B = new Float64Array([2, 0, 0, 2])
    const r = cauchyPoint(g, B, 1)
    expect(r.stepNorm).toBe(0)
    expect(r.s[0]).toBe(0)
    expect(r.s[1]).toBe(0)
    expect(r.modelReduction).toBe(0)
  })

  it('cauchyPoint: step stays inside Δ; model reduction ≥ 0', () => {
    const g = new Float64Array([3, 4]) // ||g||=5
    const B = new Float64Array([2, 0, 0, 2]) // B = 2 I
    const delta = 1
    const r = cauchyPoint(g, B, delta)
    expect(r.stepNorm).toBeLessThanOrEqual(delta + 1e-12)
    expect(r.modelReduction).toBeGreaterThanOrEqual(-1e-14)
    // direction −g
    expect(r.s[0]! / g[0]!).toBeLessThan(0)
    expect(r.s[1]! / g[1]!).toBeLessThan(0)
  })

  it('cauchyPoint: small Δ → on boundary (steepest descent full radius)', () => {
    // gBg = g·(2I)g = 2||g||² > 0; for tiny Δ, τ* = min(1, ||g||³/(Δ gBg)) = 1
    // so step hits boundary
    const g = new Float64Array([1, 0])
    const B = new Float64Array([2, 0, 0, 2])
    const delta = 0.05
    const r = cauchyPoint(g, B, delta)
    expect(r.onBoundary).toBe(true)
    expect(r.stepNorm).toBeCloseTo(delta, 10)
    expect(r.tau).toBeCloseTo(1, 12)
  })

  it('cauchyPoint: large Δ → interior critical point along −g', () => {
    // unconstrained min along −g: τ_u = ||g||³ / (Δ gBg) may be < 1 when Δ large
    // s = − (||g||² / gBg) g when interior (classic steepest-descent step for quad)
    const g = new Float64Array([2, 0])
    const B = new Float64Array([4, 0, 0, 4]) // B=4I, gBg = 16
    // gNorm=2, gNorm³=8, for Δ=10: 8/(10*16)=0.05 < 1 → interior
    const r = cauchyPoint(g, B, 10)
    expect(r.onBoundary).toBe(false)
    expect(r.tau).toBeLessThan(1)
    // s = − (||g||²/gBg) g = −(4/16)*g = −0.25 g
    expect(r.s[0]).toBeCloseTo(-0.5, 10)
    expect(r.s[1]).toBeCloseTo(0, 10)
  })

  it('cauchyStep reduces quadratic f inside trust ball', () => {
    const sys = makeSpdQuadraticSystem(4)
    const x = new Float64Array([0, 0, 0, 0])
    const g = new Float64Array(4)
    quadraticGrad(sys.A, sys.b, 4, x, g)
    const f0 = quadraticValue(sys.A, sys.b, 4, x)
    const delta = 0.5
    const { xNew, cauchy } = cauchyStep(x, g, sys.A, delta)
    const f1 = quadraticValue(sys.A, sys.b, 4, xNew)
    expect(f1).toBeLessThan(f0)
    expect(cauchy.stepNorm).toBeLessThanOrEqual(delta + 1e-12)
    expect(cauchy.modelReduction).toBeGreaterThan(0)
  })

  it('cauchyTrustRegionMinimize: f and grad drop toward x*', () => {
    const sys = makeSpdQuadraticSystem(5)
    const x0 = new Float64Array(5)
    x0.fill(0)
    const r = cauchyTrustRegionMinimize(sys.A, sys.b, 5, {
      x0,
      delta0: 1,
      maxIter: 60,
      tol: 1e-10,
    })
    expect(r.fValues.length).toBeGreaterThan(1)
    expect(r.fValues[r.fValues.length - 1]!).toBeLessThan(r.fValues[0]!)
    expect(r.gradNorms[r.gradNorms.length - 1]!).toBeLessThan(
      r.gradNorms[0]! * 1e-4,
    )
    for (let i = 0; i < 5; i++) {
      expect(r.x[i]).toBeCloseTo(1, 4)
    }
  })

  it('runTrCauchySample: ok, f reduces, methodId/familyId', () => {
    const r = runTrCauchySample()
    expect(r.methodId).toBe(METHOD_ALGO_TR_CAUCHY)
    expect(r.familyId).toBe(METHOD_TRUST_REGION)
    expect(r.familyId).toBe('method-trust-region')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.fDecreased).toBe(true)
    expect(r.fF).toBeLessThan(r.f0)
    expect(r.residualDecreased).toBe(true)
    expect(r.singleWithinRadius).toBe(true)
    expect(r.singleStepNorm).toBeLessThanOrEqual(r.singleDelta + 1e-12)
    expect(r.singleModelReduction).toBeGreaterThanOrEqual(-1e-14)
  })
})
