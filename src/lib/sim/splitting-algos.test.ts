import { describe, it, expect } from 'vitest'
import {
  METHOD_SPLITTING,
  METHOD_ALGO_LIE_TROTTER,
  METHOD_ALGO_STRANG,
  SPLITTING_PARENT,
  SPLITTING_METHOD_IDS,
  DEFAULT_COMMUTING,
  DEFAULT_NONCOMMUTING,
  norm2,
  maxAbsDiff,
  applyExpA,
  applyExpB,
  exactFlow,
  lieTrotterStep,
  strangStep,
  integrateLieTrotter,
  integrateStrang,
  runLieTrotterSample,
  runStrangSample,
} from './splitting-algos'

describe('Operator splitting · Lie–Trotter / Strang', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SPLITTING).toBe('method-operator-splitting')
    expect(METHOD_ALGO_LIE_TROTTER).toBe('method-algo-lie-trotter')
    expect(METHOD_ALGO_STRANG).toBe('method-algo-strang')
    expect(SPLITTING_PARENT).toBe(METHOD_SPLITTING)
    expect(SPLITTING_METHOD_IDS).toContain(METHOD_ALGO_LIE_TROTTER)
    expect(SPLITTING_METHOD_IDS).toContain(METHOD_ALGO_STRANG)
  })

  it('norm2 / applyExpA / applyExpB basics', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    const u: [number, number] = [1, 0]
    const rot = applyExpA(u, Math.PI / 2, { omega: 1, lambda: 0, mu: 0 })
    expect(rot[0]).toBeCloseTo(0, 12)
    expect(rot[1]).toBeCloseTo(1, 12)
    const sc = applyExpB([2, 3], 1, { omega: 0, lambda: Math.log(2), mu: 0 })
    expect(sc[0]).toBeCloseTo(4, 12)
    expect(sc[1]).toBeCloseTo(3, 12)
  })

  it('commuting isotropic scaling: Lie–Trotter ≈ exact', () => {
    const u0: [number, number] = [1, 0.7]
    const T = 1.25
    const nSteps = 8
    const r = integrateLieTrotter(u0, T, nSteps, DEFAULT_COMMUTING)
    expect(r.finite).toBe(true)
    expect(r.err).toBeLessThan(1e-10)
    const s = integrateStrang(u0, T, nSteps, DEFAULT_COMMUTING)
    expect(s.err).toBeLessThan(1e-10)
  })

  it('noncommuting: Strang error below Lie–Trotter for same Δt', () => {
    const u0: [number, number] = [1, 0.5]
    const T = 1
    const nSteps = 20
    const lt = integrateLieTrotter(u0, T, nSteps, DEFAULT_NONCOMMUTING)
    const st = integrateStrang(u0, T, nSteps, DEFAULT_NONCOMMUTING)
    expect(lt.err).toBeGreaterThan(1e-8)
    expect(st.err).toBeLessThan(lt.err)
    // single-step operators preserve finite state
    const u1 = lieTrotterStep(u0, T / nSteps, DEFAULT_NONCOMMUTING)
    const u2 = strangStep(u0, T / nSteps, DEFAULT_NONCOMMUTING)
    expect(Number.isFinite(u1[0]) && Number.isFinite(u1[1])).toBe(true)
    expect(Number.isFinite(u2[0]) && Number.isFinite(u2[1])).toBe(true)
  })

  it('Strang order loosely better under refinement (≈ O(Δt²) vs O(Δt))', () => {
    const u0: [number, number] = [1, 0.5]
    const T = 1
    const n = 16
    const lt1 = integrateLieTrotter(u0, T, n, DEFAULT_NONCOMMUTING)
    const lt2 = integrateLieTrotter(u0, T, n * 2, DEFAULT_NONCOMMUTING)
    const st1 = integrateStrang(u0, T, n, DEFAULT_NONCOMMUTING)
    const st2 = integrateStrang(u0, T, n * 2, DEFAULT_NONCOMMUTING)
    const ltRatio = lt1.err / Math.max(lt2.err, 1e-30)
    const stRatio = st1.err / Math.max(st2.err, 1e-30)
    // Lie–Trotter ~ order 1 → ratio ~ 2; Strang ~ order 2 → ratio ~ 4
    expect(ltRatio).toBeGreaterThan(1.5)
    expect(stRatio).toBeGreaterThan(ltRatio * 1.2)
    expect(stRatio).toBeGreaterThan(3)
  })

  it('exactFlow matches expm composition at t=0 and short time', () => {
    const u0: [number, number] = [0.8, -0.3]
    const z = exactFlow(u0, 0, DEFAULT_NONCOMMUTING)
    expect(maxAbsDiff(z, u0)).toBeLessThan(1e-14)
    const short = exactFlow(u0, 1e-4, DEFAULT_NONCOMMUTING)
    expect(norm2(short)).toBeGreaterThan(0)
    expect(Number.isFinite(short[0]) && Number.isFinite(short[1])).toBe(true)
  })

  it('runLieTrotterSample: ok, familyId, Strang lower error', () => {
    const r = runLieTrotterSample({ nSteps: 24 })
    expect(r.methodId).toBe(METHOD_ALGO_LIE_TROTTER)
    expect(r.familyId).toBe(METHOD_SPLITTING)
    expect(r.familyId).toBe('method-operator-splitting')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.strangLowerError).toBe(true)
    expect(r.errStrang).toBeLessThan(r.err)
    expect(r.commutingErr).toBeLessThan(1e-10)
  })

  it('runStrangSample: ok, lower than Lie–Trotter, refine improves', () => {
    const r = runStrangSample({ nSteps: 16 })
    expect(r.methodId).toBe(METHOD_ALGO_STRANG)
    expect(r.familyId).toBe(METHOD_SPLITTING)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.lowerThanLieTrotter).toBe(true)
    expect(r.err).toBeLessThan(r.errLieTrotter)
    expect(r.refineRatio).toBeGreaterThan(2.5)
    expect(r.orderHint).toBeGreaterThan(1.3)
  })
})
