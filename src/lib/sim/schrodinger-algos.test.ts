import { describe, it, expect } from 'vitest'
import {
  METHOD_SCHRODINGER,
  METHOD_ALGO_TDSE_SPLIT,
  METHOD_ALGO_TDSE_PROB,
  SCHRODINGER_METHOD_IDS,
  fourierMomenta,
  dftComplex1d,
  idftComplex1d,
  kineticStep,
  potentialPhase,
  splitOperatorStep,
  probabilityDensity,
  totalProbability,
  normalizeWavefunction,
  packetWidthRms,
  createGaussianPacket1d,
  runTdseSplitSample,
  runTdseProbSample,
} from './schrodinger-algos'

describe('Schrödinger · 1D TDSE split-operator teaching stubs', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_SCHRODINGER).toBe('method-schrodinger')
    expect(METHOD_ALGO_TDSE_SPLIT).toBe('method-algo-tdse-split')
    expect(METHOD_ALGO_TDSE_PROB).toBe('method-algo-tdse-prob')
    expect(SCHRODINGER_METHOD_IDS).toContain(METHOD_ALGO_TDSE_SPLIT)
    expect(SCHRODINGER_METHOD_IDS).toContain(METHOD_ALGO_TDSE_PROB)
  })

  it('fourierMomenta：k[0]=0，反对称', () => {
    const L = 2 * Math.PI
    const k = fourierMomenta(8, L)
    expect(k[0]).toBeCloseTo(0, 12)
    expect(k[1]).toBeCloseTo(1, 12)
    expect(k[7]).toBeCloseTo(-1, 12)
  })

  it('DFT 往返：实高斯近似还原', () => {
    const f = createGaussianPacket1d({ n: 32, L: 16, sigma: 1, normalize: true })
    const { re: Re, im: Im } = dftComplex1d(f.re, f.im)
    const inv = idftComplex1d(Re, Im)
    let maxErr = 0
    for (let i = 0; i < f.n; i++) {
      maxErr = Math.max(
        maxErr,
        Math.abs(inv.re[i]! - f.re[i]!),
        Math.abs(inv.im[i]! - f.im[i]!),
      )
    }
    expect(maxErr).toBeLessThan(1e-12)
  })

  it('自由动能传播：概率守恒，包宽增大', () => {
    const f = createGaussianPacket1d({ n: 128, L: 48, sigma: 1.5, k0: 0, normalize: true })
    const w0 = packetWidthRms(f.re, f.im, f.L)
    const p0 = totalProbability(f.re, f.im, f.dx)
    kineticStep(f.re, f.im, f.L, 6, 1)
    const wF = packetWidthRms(f.re, f.im, f.L)
    const pF = totalProbability(f.re, f.im, f.dx)
    expect(wF).toBeGreaterThan(w0 * 1.2)
    expect(Math.abs(pF - p0) / p0).toBeLessThan(1e-10)
  })

  it('势能相位：均匀 V 不改 |ψ|', () => {
    const f = createGaussianPacket1d({ n: 32, L: 16, sigma: 1, normalize: true })
    const p0 = totalProbability(f.re, f.im, f.dx)
    const rho0 = probabilityDensity(f.re, f.im)
    const V = new Float64Array(f.n)
    V.fill(0.7)
    potentialPhase(f.re, f.im, V, 1.5)
    const rho1 = probabilityDensity(f.re, f.im)
    for (let i = 0; i < f.n; i++) {
      expect(rho1[i]).toBeCloseTo(rho0[i]!, 12)
    }
    expect(totalProbability(f.re, f.im, f.dx)).toBeCloseTo(p0, 12)
  })

  it('split-operator 纯自由 ≡ 整步动能', () => {
    const a = createGaussianPacket1d({ n: 64, L: 32, sigma: 1.2, k0: 0.4, normalize: true })
    const b = createGaussianPacket1d({ n: 64, L: 32, sigma: 1.2, k0: 0.4, normalize: true })
    const dt = 0.8
    kineticStep(a.re, a.im, a.L, dt, 1)
    splitOperatorStep(b.re, b.im, b.L, dt, null, 1)
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

  it('normalizeWavefunction → P≈1；ρ≥0', () => {
    const f = createGaussianPacket1d({ n: 48, L: 20, sigma: 1, normalize: false })
    const raw = normalizeWavefunction(f.re, f.im, f.dx)
    expect(raw).toBeGreaterThan(0)
    expect(totalProbability(f.re, f.im, f.dx)).toBeCloseTo(1, 12)
    const rho = probabilityDensity(f.re, f.im)
    for (let i = 0; i < f.n; i++) {
      expect(rho[i]!).toBeGreaterThanOrEqual(0)
    }
  })

  it('runTdseSplitSample ok：自由包展宽 + 概率守恒', () => {
    const r = runTdseSplitSample({ n: 128, L: 48, sigma: 1.5, steps: 32, tTotal: 8 })
    expect(r.methodId).toBe(METHOD_ALGO_TDSE_SPLIT)
    expect(r.familyId).toBe(METHOD_SCHRODINGER)
    expect(r.finite).toBe(true)
    expect(r.probConserved).toBe(true)
    expect(r.widthGrew).toBe(true)
    expect(r.widthF).toBeGreaterThan(r.width0)
    expect(r.ok).toBe(true)
  })

  it('runTdseSplitSample withPotential：有限且 ok', () => {
    const r = runTdseSplitSample({
      n: 96,
      L: 40,
      sigma: 1.4,
      steps: 24,
      tTotal: 5,
      withPotential: true,
    })
    expect(r.finite).toBe(true)
    expect(r.probConserved).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.methodId).toBe(METHOD_ALGO_TDSE_SPLIT)
  })

  it('runTdseProbSample ok：归一 + 守恒', () => {
    const r = runTdseProbSample({ n: 96, L: 40, sigma: 1.2, steps: 20 })
    expect(r.methodId).toBe(METHOD_ALGO_TDSE_PROB)
    expect(r.familyId).toBe(METHOD_SCHRODINGER)
    expect(r.normalized).toBe(true)
    expect(r.conserved).toBe(true)
    expect(r.nonNegative).toBe(true)
    expect(r.prob0).toBeCloseTo(1, 10)
    expect(r.probF).toBeCloseTo(1, 10)
    expect(r.ok).toBe(true)
  })
})
