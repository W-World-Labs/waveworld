import { describe, it, expect } from 'vitest'
import {
  METHOD_BFGS,
  METHOD_ALGO_BFGS_UPDATE,
  BFGS_PARENT,
  BFGS_METHOD_IDS,
  norm2,
  dot,
  denseMatVec,
  makeQuadraticObjective,
  makeRosenbrockLite,
  makeSpdQuadraticSystem,
  armijoLineSearch,
  bfgsUpdateH,
  bfgsMinimize,
  runBfgsUpdateSample,
} from './bfgs-algos'

describe('BFGS · quasi-Newton update + Armijo', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BFGS).toBe('method-bfgs')
    expect(METHOD_ALGO_BFGS_UPDATE).toBe('method-algo-bfgs-update')
    expect(BFGS_PARENT).toBe(METHOD_BFGS)
    expect(BFGS_METHOD_IDS).toContain(METHOD_ALGO_BFGS_UPDATE)
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

  it('quadratic objective: grad = A x − b, min at x*', () => {
    const sys = makeSpdQuadraticSystem(3)
    const obj = makeQuadraticObjective(sys.A, sys.b, 3)
    const g = new Float64Array(3)
    obj.grad(sys.xTrue, g)
    expect(norm2(g)).toBeLessThan(1e-12)
    expect(obj.f(sys.xTrue)).toBeLessThan(obj.f(new Float64Array([0, 0, 0])))
  })

  it('Rosenbrock-lite: min near (1,1), f≈0', () => {
    const ros = makeRosenbrockLite(10)
    const xmin = new Float64Array([1, 1])
    expect(ros.f(xmin)).toBeCloseTo(0, 12)
    const g = new Float64Array(2)
    ros.grad(xmin, g)
    expect(norm2(g)).toBeLessThan(1e-12)
  })

  it('Armijo accepts unit step on steepest descent for quadratic bowl', () => {
    const A = new Float64Array([2, 0, 0, 2])
    const b = new Float64Array([0, 0])
    const obj = makeQuadraticObjective(A, b, 2)
    const x = new Float64Array([1, 1])
    const g = new Float64Array(2)
    obj.grad(x, g)
    const p = new Float64Array([-g[0]!, -g[1]!])
    const fx = obj.f(x)
    const alpha = armijoLineSearch(obj, x, p, g, fx, { alpha0: 1 })
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThanOrEqual(1)
  })

  it('bfgsUpdateH: rank-2 update keeps H finite and SPD-ish on y·s>0', () => {
    const n = 2
    const H = new Float64Array([1, 0, 0, 1])
    const s = new Float64Array([0.5, -0.2])
    const y = new Float64Array([1, 0.4])
    expect(dot(y, s)).toBeGreaterThan(0)
    expect(bfgsUpdateH(H, s, y, n)).toBe(true)
    for (let i = 0; i < H.length; i++) expect(Number.isFinite(H[i]!)).toBe(true)
    // skip when curvature fails
    expect(bfgsUpdateH(H, s, new Float64Array([-1, 0]), n)).toBe(false)
  })

  it('BFGS: SPD quadratic residual/gradient drops to near x*', () => {
    const sys = makeSpdQuadraticSystem(5)
    const obj = makeQuadraticObjective(sys.A, sys.b, 5)
    const x0 = new Float64Array(5)
    x0.fill(0)
    const r = bfgsMinimize(obj, { x0, maxIter: 30, tol: 1e-12 })
    expect(r.gradNorms.length).toBeGreaterThan(1)
    expect(r.gradNorms[r.gradNorms.length - 1]!).toBeLessThan(
      r.gradNorms[0]! * 1e-6,
    )
    for (let i = 0; i < 5; i++) {
      expect(r.x[i]).toBeCloseTo(1, 6)
    }
    expect(r.converged).toBe(true)
  })

  it('BFGS: Rosenbrock-lite gradient drops', () => {
    const ros = makeRosenbrockLite(10)
    const r = bfgsMinimize(ros, {
      x0: new Float64Array([-1.2, 1]),
      maxIter: 80,
      tol: 1e-10,
    })
    expect(r.gradNorms[r.gradNorms.length - 1]!).toBeLessThan(
      r.gradNorms[0]! * 1e-3,
    )
    expect(r.fValues[r.fValues.length - 1]!).toBeLessThan(1e-4)
    expect(r.x[0]).toBeCloseTo(1, 2)
    expect(r.x[1]).toBeCloseTo(1, 2)
  })

  it('runBfgsUpdateSample: ok, residual drop, methodId/familyId', () => {
    const r = runBfgsUpdateSample({ n: 6, tol: 1e-10 })
    expect(r.methodId).toBe(METHOD_ALGO_BFGS_UPDATE)
    expect(r.familyId).toBe(METHOD_BFGS)
    expect(r.familyId).toBe('method-bfgs')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.gradF).toBeLessThan(r.grad0)
    expect(r.maxErr).toBeLessThan(1e-5)
    expect(r.rosenGradF).toBeLessThan(r.rosenGrad0)
    expect(r.iterations).toBeGreaterThan(0)
  })
})
