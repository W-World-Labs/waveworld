import { describe, it, expect } from 'vitest'
import {
  METHOD_PE,
  METHOD_ALGO_PE_SSF,
  PE_METHOD_IDS,
  transverseWaveNumbers,
  dftComplex1d,
  idftComplex1d,
  peDiffractionStep,
  peRefractionPhase,
  splitStepPeSsf,
  createGaussianBeam1d,
  beamPower,
  beamWidthRms,
  rayleighRange,
  runPeSsfSample,
} from './pe-algos'

describe('PE · split-step Fourier (parabolic equation)', () => {
  it('method id constants (family / algo may be unregistered)', () => {
    expect(METHOD_PE).toBe('method-parabolic-equation')
    expect(METHOD_ALGO_PE_SSF).toBe('method-algo-pe-ssf')
    expect(PE_METHOD_IDS).toContain(METHOD_ALGO_PE_SSF)
  })

  it('transverseWaveNumbers: κ antisymmetric, DC 0', () => {
    const L = 2 * Math.PI
    const κ = transverseWaveNumbers(8, L)
    expect(κ[0]).toBeCloseTo(0, 12)
    expect(κ[1]).toBeCloseTo(1, 12)
    expect(κ[7]).toBeCloseTo(-1, 12)
  })

  it('DFT round-trip: real Gaussian restored', () => {
    const f = createGaussianBeam1d({ n: 32, L: 10, w0: 1 })
    const { re: Re, im: Im } = dftComplex1d(f.re, f.im)
    const inv = idftComplex1d(Re, Im)
    let maxErr = 0
    for (let i = 0; i < f.n; i++) {
      maxErr = Math.max(
        maxErr,
        Math.abs(inv.re[i]! - f.re[i]!),
        Math.abs(inv.im[i]!),
      )
    }
    expect(maxErr).toBeLessThan(1e-12)
  })

  it('free-space diffraction: power conserved, width grows', () => {
    const f = createGaussianBeam1d({ n: 128, L: 24, w0: 1.5 })
    const k0 = 2 * Math.PI
    const zR = rayleighRange(k0, 1.5)
    const w0m = beamWidthRms(f.re, f.im, f.L)
    const p0 = beamPower(f.re, f.im, f.dz)
    peDiffractionStep(f.re, f.im, f.L, k0, 1.2 * zR)
    const wF = beamWidthRms(f.re, f.im, f.L)
    const pF = beamPower(f.re, f.im, f.dz)
    expect(wF).toBeGreaterThan(w0m * 1.2)
    expect(Math.abs(pF - p0) / p0).toBeLessThan(1e-10)
  })

  it('refraction: uniform phase leaves |ψ| unchanged', () => {
    const f = createGaussianBeam1d({ n: 32, L: 8, w0: 1 })
    const deltaN = new Float64Array(f.n)
    deltaN.fill(0.05)
    const p0 = beamPower(f.re, f.im, f.dz)
    peRefractionPhase(f.re, f.im, 2 * Math.PI, 1.0, deltaN)
    expect(beamPower(f.re, f.im, f.dz)).toBeCloseTo(p0, 12)
  })

  it('split-step free space ≡ full diffraction step', () => {
    const a = createGaussianBeam1d({ n: 64, L: 20, w0: 1.2 })
    const b = createGaussianBeam1d({ n: 64, L: 20, w0: 1.2 })
    const k0 = 2 * Math.PI
    const dr = 0.8
    peDiffractionStep(a.re, a.im, a.L, k0, dr)
    splitStepPeSsf(b.re, b.im, b.L, k0, dr, null)
    let maxErr = 0
    for (let i = 0; i < a.n; i++) {
      maxErr = Math.max(
        maxErr,
        Math.abs(a.re[i]! - b.re[i]!),
        Math.abs(a.im[i]! - b.im[i]!),
      )
    }
    expect(maxErr).toBeLessThan(1e-10)
  })

  it('runPeSsfSample ok: diffraction spreading + power conserved', () => {
    const r = runPeSsfSample({ n: 128, L: 24, w0: 1.5, steps: 20 })
    expect(r.methodId).toBe(METHOD_ALGO_PE_SSF)
    expect(r.familyId).toBe(METHOD_PE)
    expect(r.familyId).toBe('method-parabolic-equation')
    expect(r.finite).toBe(true)
    expect(r.powerConserved).toBe(true)
    expect(r.widthGrew).toBe(true)
    expect(r.widthF).toBeGreaterThan(r.width0)
    expect(r.ok).toBe(true)
  })

  it('runPeSsfSample withRefraction: finite + ok', () => {
    const r = runPeSsfSample({
      n: 96,
      L: 20,
      w0: 1.4,
      steps: 16,
      withRefraction: true,
    })
    expect(r.finite).toBe(true)
    expect(r.powerConserved).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.methodId).toBe(METHOD_ALGO_PE_SSF)
    expect(r.familyId).toBe(METHOD_PE)
  })
})
