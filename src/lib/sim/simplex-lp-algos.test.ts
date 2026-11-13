import { describe, it, expect } from 'vitest'
import {
  METHOD_LP,
  METHOD_ALGO_SIMPLEX,
  LP_PARENT,
  LP_METHOD_IDS,
  makeDefaultLp2,
  assertLpStandard,
  buildTableau,
  selectEnterCol,
  selectLeaveRow,
  pivot,
  simplexMax,
  objectiveValue,
  primalFeasibility,
  runSimplexSample,
} from './simplex-lp-algos'

describe('Simplex LP · tableau pivot teaching max', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LP).toBe('method-linear-programming')
    expect(METHOD_ALGO_SIMPLEX).toBe('method-algo-simplex')
    expect(LP_PARENT).toBe(METHOD_LP)
    expect(LP_METHOD_IDS).toContain(METHOD_ALGO_SIMPLEX)
  })

  it('assertLpStandard / makeDefaultLp2 dims', () => {
    const lp = makeDefaultLp2()
    expect(assertLpStandard(lp)).toEqual({ n: 2, m: 3 })
    expect(lp.c).toEqual([3, 5])
    expect(() =>
      assertLpStandard({ c: [1], A: [[1]], b: [-1] }),
    ).toThrow()
  })

  it('buildTableau: A|I|b and −c obj row', () => {
    const lp = makeDefaultLp2()
    const { tableau, basic, n, m } = buildTableau(lp)
    expect(n).toBe(2)
    expect(m).toBe(3)
    expect(tableau.length).toBe(4)
    expect(tableau[0]!.length).toBe(2 + 3 + 1)
    expect(basic).toEqual([2, 3, 4]) // slacks
    // obj row starts −c
    expect(tableau[3]![0]).toBeCloseTo(-3, 12)
    expect(tableau[3]![1]).toBeCloseTo(-5, 12)
    expect(tableau[3]![5]).toBeCloseTo(0, 12)
  })

  it('selectEnterCol picks most negative; selectLeaveRow ratio test', () => {
    const lp = makeDefaultLp2()
    const { tableau } = buildTableau(lp)
    const enter = selectEnterCol(tableau)
    expect(enter).toBe(1) // x2 has −5
    const leave = selectLeaveRow(tableau, enter)
    expect(leave).toBe(1) // 12/2 = 6 tightest among positive
  })

  it('single pivot improves objective RHS', () => {
    const lp = makeDefaultLp2()
    const { tableau } = buildTableau(lp)
    const enter = selectEnterCol(tableau)
    const leave = selectLeaveRow(tableau, enter)
    expect(enter).toBeGreaterThanOrEqual(0)
    expect(leave).toBeGreaterThanOrEqual(0)
    pivot(tableau, leave!, enter!)
    // after first pivot z should be 30 at (0,6)
    const z = tableau[tableau.length - 1]![tableau[0]!.length - 1]!
    expect(z).toBeCloseTo(30, 10)
  })

  it('simplexMax: default LP optimal (2,6) z=36', () => {
    const lp = makeDefaultLp2()
    const r = simplexMax(lp)
    expect(r.status).toBe('optimal')
    expect(r.objective).toBeCloseTo(36, 10)
    expect(r.x[0]).toBeCloseTo(2, 10)
    expect(r.x[1]).toBeCloseTo(6, 10)
    expect(objectiveValue(lp.c, r.x)).toBeCloseTo(36, 10)
    const feas = primalFeasibility(lp, r.x)
    expect(feas.maxViolation).toBeLessThan(1e-10)
    expect(feas.minX).toBeGreaterThanOrEqual(-1e-12)
    expect(r.pivots).toBeGreaterThan(0)
    // reduced costs all ≥ 0 at opt
    const obj = r.tableau[r.tableau.length - 1]!
    for (let j = 0; j < obj.length - 1; j++) {
      expect(obj[j]!).toBeGreaterThanOrEqual(-1e-10)
    }
  })

  it('simplexMax: unbounded ray detected', () => {
    // max x  s.t. −x ≤ −1 is rejected by assert; use max x+y, x−y ≤ 1, −x+y ≤ 1 wait bounded
    // max x  s.t. −x ≤ 1 (always true for x≥−1 but we need b≥0): −x ≤ 1 ⇒ free ray +x
    const lp = {
      c: [1, 1],
      A: [[-1, 0]],
      b: [1],
    }
    const r = simplexMax(lp)
    expect(r.status).toBe('unbounded')
  })

  it('simplexMax: trivial single-var max x s.t. x ≤ 5', () => {
    const lp = { c: [2], A: [[1]], b: [5] }
    const r = simplexMax(lp)
    expect(r.status).toBe('optimal')
    expect(r.x[0]).toBeCloseTo(5, 10)
    expect(r.objective).toBeCloseTo(10, 10)
  })

  it('runSimplexSample: ok, familyId method-linear-programming', () => {
    const r = runSimplexSample()
    expect(r.methodId).toBe(METHOD_ALGO_SIMPLEX)
    expect(r.familyId).toBe(METHOD_LP)
    expect(r.familyId).toBe('method-linear-programming')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.status).toBe('optimal')
    expect(r.objective).toBeCloseTo(36, 10)
    expect(r.zErr).toBeLessThan(1e-8)
    expect(r.x[0]).toBeCloseTo(2, 8)
    expect(r.x[1]).toBeCloseTo(6, 8)
    expect(r.pivots).toBeGreaterThan(0)
    expect(r.maxViolation).toBeLessThan(1e-8)
  })
})
