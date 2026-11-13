import { describe, it, expect } from 'vitest'
import {
  METHOD_NELDER_MEAD,
  METHOD_ALGO_NM_SIMPLEX,
  NELDER_MEAD_PARENT,
  NELDER_MEAD_METHOD_IDS,
  norm2,
  denseMatVec,
  makeQuadraticObjective,
  makeRosenbrockLite,
  makeSpdQuadraticSystem,
  initialSimplex,
  simplexSize,
  nmMinimize,
  runNmSimplexSample,
} from './neldermead-algos'

describe('Nelder–Mead · simplex reflection / expand / contract / shrink', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_NELDER_MEAD).toBe('method-nelder-mead')
    expect(METHOD_ALGO_NM_SIMPLEX).toBe('method-algo-nm-simplex')
    expect(NELDER_MEAD_PARENT).toBe(METHOD_NELDER_MEAD)
    expect(NELDER_MEAD_METHOD_IDS).toContain(METHOD_ALGO_NM_SIMPLEX)
  })

  it('norm2 / denseMatVec basics', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    const A = [2, 0, 0, 3]
    const y = new Float64Array(2)
    denseMatVec(A, 2, [1, 1], y)
    expect(y[0]).toBeCloseTo(2, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('initialSimplex: n+1 verts, size > 0', () => {
    const x0 = new Float64Array([1, 2, 3])
    const s = initialSimplex(x0, 0.1)
    expect(s.length).toBe(4)
    expect(s[0]![0]).toBeCloseTo(1, 12)
    expect(simplexSize(s)).toBeGreaterThan(0)
  })

  it('quadratic objective: min at x*, f lower than at 0', () => {
    const sys = makeSpdQuadraticSystem(3)
    const obj = makeQuadraticObjective(sys.A, sys.b, 3)
    expect(obj.f(sys.xTrue)).toBeLessThan(obj.f(new Float64Array([0, 0, 0])))
  })

  it('Rosenbrock-lite: min near (1,1), f≈0', () => {
    const ros = makeRosenbrockLite(10)
    const xmin = new Float64Array([1, 1])
    expect(ros.f(xmin)).toBeCloseTo(0, 12)
  })

  it('NM: SPD quadratic f decreases toward x*', () => {
    const sys = makeSpdQuadraticSystem(4)
    const obj = makeQuadraticObjective(sys.A, sys.b, 4)
    const x0 = new Float64Array(4)
    x0.fill(0)
    const r = nmMinimize(obj, { x0, step: 0.25, maxIter: 300, xTol: 1e-10 })
    expect(r.fValues.length).toBeGreaterThan(1)
    expect(r.fValues[r.fValues.length - 1]!).toBeLessThan(r.fValues[0]!)
    for (let i = 0; i < 4; i++) {
      expect(r.x[i]).toBeCloseTo(1, 4)
    }
    expect(r.converged || r.size < 1e-6).toBe(true)
  })

  it('NM: Rosenbrock-lite f decreases to near 0', () => {
    const ros = makeRosenbrockLite(10)
    const r = nmMinimize(ros, {
      x0: new Float64Array([-1.2, 1]),
      step: 0.5,
      maxIter: 600,
      xTol: 1e-11,
      fTol: 1e-14,
    })
    expect(r.fValues[r.fValues.length - 1]!).toBeLessThan(r.fValues[0]!)
    expect(r.fValues[r.fValues.length - 1]!).toBeLessThan(1e-4)
    expect(r.x[0]).toBeCloseTo(1, 2)
    expect(r.x[1]).toBeCloseTo(1, 2)
  })

  it('runNmSimplexSample: ok, f drop, methodId/familyId', () => {
    const r = runNmSimplexSample({ n: 3, maxIter: 300 })
    expect(r.methodId).toBe(METHOD_ALGO_NM_SIMPLEX)
    expect(r.familyId).toBe(METHOD_NELDER_MEAD)
    expect(r.familyId).toBe('method-nelder-mead')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.fDecreased).toBe(true)
    expect(r.fF).toBeLessThan(r.f0)
    expect(r.maxErr).toBeLessThan(1e-4)
    expect(r.rosenFF).toBeLessThan(r.rosenF0)
    expect(r.rosenFF).toBeLessThan(1e-4)
    expect(r.iterations).toBeGreaterThan(0)
    expect(r.evaluations).toBeGreaterThan(r.iterations)
  })
})
