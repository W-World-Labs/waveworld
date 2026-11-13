import { describe, it, expect } from 'vitest'
import {
  METHOD_LATTICE_GAS,
  METHOD_ALGO_HPP_COLLIDE,
  METHOD_ALGO_HPP_STREAM,
  LATTICE_GAS_PARENT,
  LATTICE_GAS_METHOD_IDS,
  HPP_E,
  HPP_Q,
  createHpp,
  hppIdx,
  densityAt,
  totalMass,
  densityVariance,
  hppCollide,
  hppStream,
  hppStep,
  seedHeadOnPairs,
  seedDensityPeak,
  runHppCollideSample,
  runHppStreamSample,
} from './latticegas-algos'

describe('HPP lattice gas · collide + stream', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LATTICE_GAS).toBe('method-lattice-gas')
    expect(METHOD_ALGO_HPP_COLLIDE).toBe('method-algo-hpp-collide')
    expect(METHOD_ALGO_HPP_STREAM).toBe('method-algo-hpp-stream')
    expect(LATTICE_GAS_PARENT).toBe(METHOD_LATTICE_GAS)
    expect(LATTICE_GAS_METHOD_IDS).toContain(METHOD_ALGO_HPP_COLLIDE)
    expect(LATTICE_GAS_METHOD_IDS).toContain(METHOD_ALGO_HPP_STREAM)
  })

  it('HPP velocity set: 4 dirs, opposite pairs sum to 0', () => {
    expect(HPP_Q).toBe(4)
    expect(HPP_E).toHaveLength(4)
    expect(HPP_E[0]![0] + HPP_E[2]![0]).toBe(0)
    expect(HPP_E[1]![1] + HPP_E[3]![1]).toBe(0)
  })

  it('hppCollide: exclusive head-on right+left → up+down', () => {
    const f = createHpp(4, 4)
    const k = hppIdx(1, 1, 4)
    f[0]![k] = 1
    f[2]![k] = 1
    const m0 = totalMass(f)
    hppCollide(f)
    expect(f[0]![k]).toBe(0)
    expect(f[2]![k]).toBe(0)
    expect(f[1]![k]).toBe(1)
    expect(f[3]![k]).toBe(1)
    expect(Math.abs(totalMass(f) - m0)).toBeLessThan(1e-15)
  })

  it('hppCollide: exclusive up+down → right+left; dual pair unchanged', () => {
    const f = createHpp(4, 4)
    const k = hppIdx(2, 2, 4)
    f[1]![k] = 1
    f[3]![k] = 1
    hppCollide(f)
    expect(f[0]![k]).toBe(1)
    expect(f[2]![k]).toBe(1)
    expect(f[1]![k]).toBe(0)
    expect(f[3]![k]).toBe(0)

    // all four occupied: no exclusive pair → unchanged
    const g = createHpp(2, 2)
    const t = 0
    for (let q = 0; q < 4; q++) g[q]![t] = 1
    hppCollide(g)
    for (let q = 0; q < 4; q++) expect(g[q]![t]).toBe(1)
  })

  it('hppStream: periodic neighbor shift + mass conserved', () => {
    const nx = 8
    const ny = 6
    const f = createHpp(nx, ny)
    f[0]![hppIdx(0, 0, nx)] = 1 // +x → (1,0)
    f[1]![hppIdx(3, 5, nx)] = 1 // +y wraps → (3,0)
    f[2]![hppIdx(0, 2, nx)] = 1 // −x wraps → (7,2)
    f[3]![hppIdx(4, 0, nx)] = 1 // −y wraps → (4,5)
    const m0 = totalMass(f)
    const g = hppStream(f, nx, ny)
    expect(g[0]![hppIdx(1, 0, nx)]).toBe(1)
    expect(g[1]![hppIdx(3, 0, nx)]).toBe(1)
    expect(g[2]![hppIdx(7, 2, nx)]).toBe(1)
    expect(g[3]![hppIdx(4, 5, nx)]).toBe(1)
    expect(Math.abs(totalMass(g) - m0)).toBeLessThan(1e-15)
  })

  it('seed + multi-step: mass conserved, density variance not increasing forever', () => {
    const nx = 16
    const ny = 16
    let f = createHpp(nx, ny)
    seedDensityPeak(f, nx, ny, 2)
    const m0 = totalMass(f)
    const v0 = densityVariance(f)
    expect(m0).toBeGreaterThan(0)
    for (let t = 0; t < 20; t++) f = hppStep(f, nx, ny)
    expect(Math.abs(totalMass(f) - m0)).toBeLessThan(1e-12)
    expect(densityVariance(f)).toBeLessThanOrEqual(v0 + 1e-9)
  })

  it('runHppCollideSample: ok, mass conserved, flip', () => {
    const r = runHppCollideSample()
    expect(r.methodId).toBe(METHOD_ALGO_HPP_COLLIDE)
    expect(r.familyId).toBe(METHOD_LATTICE_GAS)
    expect(r.familyId).toBe('method-lattice-gas')
    expect(r.ok).toBe(true)
    expect(r.flipped).toBe(true)
    expect(r.massErr).toBeLessThan(1e-12)
    expect(r.pairs0).toBeGreaterThan(0)
    expect(r.pairsVertF).toBe(r.pairs0)
  })

  it('runHppStreamSample: ok, mass conserved, optional flatness', () => {
    const r = runHppStreamSample({ steps: 40 })
    expect(r.methodId).toBe(METHOD_ALGO_HPP_STREAM)
    expect(r.familyId).toBe(METHOD_LATTICE_GAS)
    expect(r.ok).toBe(true)
    expect(r.streamOk).toBe(true)
    expect(r.massErr).toBeLessThan(1e-12)
    expect(r.densityFlattened).toBe(true)
    expect(r.varF).toBeLessThan(r.var0)
  })

  it('densityAt / seedHeadOnPairs helpers', () => {
    const f = createHpp(8, 8)
    seedHeadOnPairs(f, 8, 8, 1)
    const k = hppIdx(4, 4, 8)
    expect(densityAt(f, k)).toBe(2)
  })
})
