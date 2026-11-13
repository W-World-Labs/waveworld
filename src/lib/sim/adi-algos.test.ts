import { describe, it, expect } from 'vitest'
import {
  METHOD_ADI,
  METHOD_ALGO_ADI_HEAT,
  METHOD_ALGO_ADI_SWEEP,
  ADI_PARENT,
  ADI_METHOD_IDS,
  norm2,
  maxAbs,
  energyL2,
  gaussianIC2d,
  sineModeIC2d,
  discreteSigma,
  prAmplification,
  adiHalfStepX,
  adiHalfStepY,
  peacemanRachfordStep,
  integrateAdiHeat,
  runAdiHeatSample,
  runAdiSweepSample,
} from './adi-algos'

describe('ADI · Peaceman–Rachford 2D heat', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ADI).toBe('method-adi')
    expect(METHOD_ALGO_ADI_HEAT).toBe('method-algo-adi-heat')
    expect(METHOD_ALGO_ADI_SWEEP).toBe('method-algo-adi-sweep')
    expect(ADI_PARENT).toBe(METHOD_ADI)
    expect(ADI_METHOD_IDS).toContain(METHOD_ALGO_ADI_HEAT)
    expect(ADI_METHOD_IDS).toContain(METHOD_ALGO_ADI_SWEEP)
  })

  describe('IC / norms / discrete mode factor', () => {
    it('gaussianIC2d: interior positive, boundary 0', () => {
      const n = 16
      const u = gaussianIC2d(n)
      expect(u.length).toBe(n * n)
      for (let i = 0; i < n; i++) {
        expect(u[i]).toBe(0)
        expect(u[(n - 1) * n + i]).toBe(0)
        expect(u[i * n]).toBe(0)
        expect(u[i * n + (n - 1)]).toBe(0)
      }
      expect(maxAbs(u)).toBeGreaterThan(0.5)
      expect(norm2(u)).toBeGreaterThan(0)
    })

    it('sineModeIC2d: (1,1) mode max at center-ish, boundary 0', () => {
      const n = 17
      const u = sineModeIC2d(n, 1, 1)
      const mid = ((n - 1) / 2) | 0
      expect(u[mid * n + mid]).toBeCloseTo(1, 10)
      expect(u[0]).toBeCloseTo(0, 14)
      expect(u[n - 1]).toBeCloseTo(0, 14)
    })

    it('discreteSigma / prAmplification: σ < 0, |g| < 1 for r > 0', () => {
      const n = 16
      const s = discreteSigma(n, 1)
      expect(s).toBeLessThan(0)
      // continuous limit ≈ −π² h²
      const h = 1 / (n - 1)
      expect(s).toBeCloseTo(-4 * Math.sin((Math.PI * h) / 2) ** 2, 14)
      const g = prAmplification(n, 0.5, 1, 1)
      expect(g).toBeGreaterThan(0)
      expect(g).toBeLessThan(1)
    })
  })

  describe('half-steps and full PR', () => {
    it('adiHalfStepX / Y: flat interior with 0 boundary stays finite; boundary fixed', () => {
      const n = 12
      const u = new Float64Array(n * n)
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) u[j * n + i] = 1
      }
      const ux = adiHalfStepX(u, n, 0.3)
      const uy = adiHalfStepY(u, n, 0.3)
      for (let i = 0; i < n; i++) {
        expect(ux[i]).toBe(0)
        expect(uy[i]).toBe(0)
        expect(ux[(n - 1) * n + i]).toBe(0)
        expect(uy[(n - 1) * n + i]).toBe(0)
      }
      expect(ux.every(Number.isFinite)).toBe(true)
      expect(uy.every(Number.isFinite)).toBe(true)
    })

    it('peacemanRachfordStep: Gaussian max and energy drop; large r finite', () => {
      const n = 16
      const h = 1 / (n - 1)
      const u0 = gaussianIC2d(n)
      const max0 = maxAbs(u0)
      const e0 = energyL2(u0, n, h)
      const u1 = peacemanRachfordStep(u0, n, 0.4)
      expect(maxAbs(u1)).toBeLessThan(max0)
      expect(energyL2(u1, n, h)).toBeLessThan(e0)
      expect(u1.every(Number.isFinite)).toBe(true)

      const big = peacemanRachfordStep(u0, n, 2.5)
      expect(big.every(Number.isFinite)).toBe(true)
      expect(maxAbs(big)).toBeLessThan(max0)
    })

    it('sine mode multi-step amplitude ≈ discrete PR factor', () => {
      const n = 16
      const r = 0.5
      const steps = 6
      const u0 = sineModeIC2d(n, 1, 1)
      const u = integrateAdiHeat(u0, n, r, steps)
      const ratio = maxAbs(u) / maxAbs(u0)
      const theory = Math.pow(prAmplification(n, r, 1, 1), steps)
      expect(Math.abs(ratio - theory) / theory).toBeLessThan(0.05)
      expect(ratio).toBeLessThan(1)
    })

    it('PR = Y∘X composition', () => {
      const n = 14
      const r = 0.7
      const u0 = gaussianIC2d(n)
      const pr = peacemanRachfordStep(u0, n, r)
      const mid = adiHalfStepX(u0, n, r)
      const full = adiHalfStepY(mid, n, r)
      let err = 0
      for (let i = 0; i < pr.length; i++) {
        err = Math.max(err, Math.abs(pr[i]! - full[i]!))
      }
      expect(err).toBeLessThan(1e-14)
    })
  })

  describe('run samples', () => {
    it('runAdiHeatSample: ok, energy/max drop, mode rate loose', () => {
      const r = runAdiHeatSample()
      expect(r.methodId).toBe(METHOD_ALGO_ADI_HEAT)
      expect(r.familyId).toBe(METHOD_ADI)
      expect(r.familyId).toBe('method-adi')
      expect(r.n).toBe(16)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.maxDropped).toBe(true)
      expect(r.energyDropped).toBe(true)
      expect(r.boundaryOk).toBe(true)
      expect(r.maxAfter).toBeLessThan(r.max0)
      expect(r.energyAfter).toBeLessThan(r.energy0)
      expect(r.largeR.finite).toBe(true)
      expect(r.largeR.maxDropped).toBe(true)
      expect(r.mode.ampAfter).toBeLessThan(r.mode.amp0)
      expect(r.mode.relErr).toBeLessThan(0.15)
    })

    it('runAdiSweepSample: ok, composition, monotone energy', () => {
      const r = runAdiSweepSample()
      expect(r.methodId).toBe(METHOD_ALGO_ADI_SWEEP)
      expect(r.familyId).toBe(METHOD_ADI)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.compositionMatch).toBe(true)
      expect(r.compositionErr).toBeLessThan(1e-14)
      expect(r.energyMonotone).toBe(true)
      expect(r.afterX.boundaryOk).toBe(true)
      expect(r.afterXY.boundaryOk).toBe(true)
      expect(r.modeRelErr).toBeLessThan(0.15)
      expect(r.energySequence.length).toBe(r.sweeps + 1)
    })
  })
})
