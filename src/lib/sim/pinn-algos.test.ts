import { describe, it, expect } from 'vitest'
import {
  METHOD_PINN,
  METHOD_ALGO_PINN_RESIDUAL,
  PINN_METHOD_IDS,
  norm2,
  collocationPoints,
  sineBasis,
  sineBasisHarmonicResidual,
  trialSineSeries,
  residualHarmonicOscillator,
  residualVectorHarmonic,
  residualL2,
  residualHeatProduct,
  polyBasisHarmonicResidual,
  solveDenseGauss,
  residualDesignMatrix,
  fitWeightsNormalEq,
  residualGradientStep,
  runPinnResidualSample,
} from './pinn-algos'

describe('PINN · physics-informed residual teaching', () => {
  it('method id constants (family / algo may be unregistered)', () => {
    expect(METHOD_PINN).toBe('method-pinn')
    expect(METHOD_ALGO_PINN_RESIDUAL).toBe('method-algo-pinn-residual')
    expect(PINN_METHOD_IDS).toContain(METHOD_ALGO_PINN_RESIDUAL)
  })

  it('collocationPoints: interior of [0, π], ordered', () => {
    const xs = collocationPoints(5)
    expect(xs.length).toBe(5)
    expect(xs[0]!).toBeGreaterThan(0)
    expect(xs[4]!).toBeLessThan(Math.PI)
    for (let i = 1; i < 5; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
  })

  it('exact mode sin(x): residual ≈ 0', () => {
    const w = new Float64Array([1, 0, 0])
    const xs = collocationPoints(16)
    const r = residualVectorHarmonic(xs, w)
    expect(norm2(r)).toBeLessThan(1e-12)
    expect(residualL2(xs, w)).toBeLessThan(1e-12)
    expect(residualHarmonicOscillator(Math.PI / 3, w)).toBeCloseTo(0, 12)
  })

  it('higher harmonic sin(2x): residual = (1−4) sin(2x)', () => {
    const w = new Float64Array([0, 1, 0])
    const x = Math.PI / 4
    expect(sineBasisHarmonicResidual(1, x)).toBeCloseTo((1 - 4) * Math.sin(2 * x), 12)
    expect(residualHarmonicOscillator(x, w)).toBeCloseTo(-3 * Math.sin(2 * x), 12)
    expect(trialSineSeries(x, w)).toBeCloseTo(Math.sin(2 * x), 12)
    expect(sineBasis(0, x)).toBeCloseTo(Math.sin(x), 14)
  })

  it('polluted weights: residual L2 large', () => {
    const w = new Float64Array([0.4, 0.5, 0.3])
    const xs = collocationPoints(24)
    expect(residualL2(xs, w)).toBeGreaterThan(0.2)
  })

  it('poly basis residual: x² → 2 + x²', () => {
    const x = 0.7
    expect(polyBasisHarmonicResidual(2, x)).toBeCloseTo(2 + x * x, 12)
    expect(polyBasisHarmonicResidual(0, x)).toBeCloseTo(1, 12)
    expect(polyBasisHarmonicResidual(1, x)).toBeCloseTo(x, 12)
  })

  it('heat product residual: exact α_k = ν m² → 0', () => {
    const nu = 0.3
    const w = new Float64Array([1, 0.5])
    const alphas = new Float64Array([nu * 1, nu * 4])
    expect(residualHeatProduct(0.8, 0.2, w, alphas, nu)).toBeCloseTo(0, 12)
    const bad = new Float64Array([nu, 0]) // wrong second rate
    expect(Math.abs(residualHeatProduct(0.8, 0.2, w, bad, nu))).toBeGreaterThan(1e-6)
  })

  it('solveDenseGauss: 2×2', () => {
    const A = new Float64Array([2, 1, 1, 2])
    const b = new Float64Array([4, 5])
    const x = solveDenseGauss(A, b, 2)
    expect(x[0]).toBeCloseTo(1, 12)
    expect(x[1]).toBeCloseTo(2, 12)
  })

  it('residualDesignMatrix: columns match L[φ_k]', () => {
    const xs = collocationPoints(8)
    const A = residualDesignMatrix(xs, 3)
    for (let i = 0; i < 8; i++) {
      for (let k = 0; k < 3; k++) {
        expect(A[i * 3 + k]!).toBeCloseTo(sineBasisHarmonicResidual(k, xs[i]!), 12)
      }
    }
  })

  it('fitWeightsNormalEq: residual drops vs polluted start; near pure mode', () => {
    const w0 = new Float64Array([0.4, 0.55, 0.35])
    const xs = collocationPoints(24)
    const r0 = residualL2(xs, w0)
    const w1 = fitWeightsNormalEq({ nColloc: 24, m: 3, lambda: 25 })
    const r1 = residualL2(xs, w1)
    expect(r1).toBeLessThan(r0 * 0.5)
    // y(π/2) ≈ 1 → fundamental weight near 1
    expect(Math.abs(w1[0]!)).toBeGreaterThan(0.5)
    expect(Math.abs(w1[1]!)).toBeLessThan(0.25)
  })

  it('residualGradientStep: one step decreases residual (loose)', () => {
    const w0 = new Float64Array([0.4, 0.55, 0.35])
    const xs = collocationPoints(24)
    const r0 = residualL2(xs, w0)
    const w1 = residualGradientStep(w0, { nColloc: 24, lr: 0.35, lambda: 0 })
    const r1 = residualL2(xs, w1)
    expect(r1).toBeLessThan(r0)
  })

  it('runPinnResidualSample ok: residual decreases after one fit step', () => {
    const r = runPinnResidualSample()
    expect(r.methodId).toBe(METHOD_ALGO_PINN_RESIDUAL)
    expect(r.familyId).toBe(METHOD_PINN)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.residual1).toBeLessThan(r.residual0)
    expect(r.ok).toBe(true)
  })

  it('runPinnResidualSample mode=gd ok', () => {
    const r = runPinnResidualSample({ mode: 'gd' })
    expect(r.mode).toBe('gd')
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.methodId).toBe(METHOD_ALGO_PINN_RESIDUAL)
  })
})

