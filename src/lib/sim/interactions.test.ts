import { describe, it, expect } from 'vitest'
import { computeChargedForces } from './interactions'
import { computeForces } from './md'

const params = { epsR: 2, lambdaD: 2, kCoulomb: 3 }

describe('shared Rust particle forces', () => {
  it('neutral unit species reduce to homogeneous LJ', () => {
    const pos = new Float32Array([2, 2, 3, 2.2, 2.5, 3, 4, 4])
    const got = computeChargedForces(pos, new Float32Array(4), 10, 4, 2, 2.5, params)
    const reference = computeForces(pos, 10, 4, 2, 2.5)
    expect(got).toEqual(reference)
  })
  it('an opposite-charge pair has the analytic screened attraction and equal/opposite force', () => {
    const pos = new Float32Array([1, 1, 2, 1])
    const got = computeChargedForces(pos, new Float32Array([1, -1]), 10, 2, 2, 2.5, params,
      new Float32Array([1, 1]), new Float32Array(2))
    expect(got.potential).toBeCloseTo(-1.5 * Math.exp(-0.5), 12)
    expect(got.virial).toBeCloseTo(-2.25 * Math.exp(-0.5), 12)
    expect(got.force[0]).toBeCloseTo(2.25 * Math.exp(-0.5), 6)
    expect(got.force[2]).toBe(-got.force[0])
    expect(got.force[1]).toBe(0); expect(got.force[3]).toBe(0)
  })
  it('rejects incomplete mixtures and overlapping particles', () => {
    const pos = new Float32Array([1, 1, 1, 1]), charge = new Float32Array([1, -1])
    expect(() => computeChargedForces(pos, charge, 10, 2, 2, 2.5, params, new Float32Array(2))).toThrow(/Both sigma and epsilon/)
    expect(() => computeChargedForces(pos, charge, 10, 2, 2, 2.5, params)).toThrow(/Simulation stopped/)
  })
})
