import { describe, it, expect } from 'vitest'
import {
  METHOD_SCHRODINGER,
  METHOD_ALGO_TDSE_IMAG,
  SCHRODINGER_L2_METHOD_IDS,
  SCHRODINGER_L2_PARENT,
  kineticStepImag,
  potentialDampImag,
  splitOperatorImagStep,
  expectationEnergy,
  harmonicPotential1d,
  runTdseImagSample,
} from './schrodinger-l2-algos'
import {
  createGaussianPacket1d,
  normalizeWavefunction,
  totalProbability,
  fourierMomenta,
  dftComplex1d,
} from './schrodinger-algos'

describe('Schrödinger L2 · TDSE imaginary-time', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_SCHRODINGER).toBe('method-schrodinger')
    expect(METHOD_ALGO_TDSE_IMAG).toBe('method-algo-tdse-imag')
    expect(SCHRODINGER_L2_PARENT).toBe(METHOD_SCHRODINGER)
    expect(SCHRODINGER_L2_METHOD_IDS).toContain(METHOD_ALGO_TDSE_IMAG)
  })

  it('kineticStepImag：高 k 衰减、概率下降', () => {
    const f = createGaussianPacket1d({
      n: 64,
      L: 32,
      sigma: 0.8,
      k0: 0,
      normalize: true,
    })
    const p0 = totalProbability(f.re, f.im, f.dx)
    kineticStepImag(f.re, f.im, f.L, 2, 1)
    const p1 = totalProbability(f.re, f.im, f.dx)
    expect(p1).toBeLessThan(p0 * 0.99)
    expect(p1).toBeGreaterThan(0)
  })

  it('kineticStepImag：平面波 k 模按 exp(−Tτ) 缩放', () => {
    const n = 32
    const L = 2 * Math.PI
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    // 单模式 m=1：ψ_j = exp(i · 2π j / n) → k = 1
    for (let j = 0; j < n; j++) {
      const ang = (2 * Math.PI * j) / n
      re[j] = Math.cos(ang)
      im[j] = Math.sin(ang)
    }
    const { re: R0, im: I0 } = dftComplex1d(re, im)
    const amp0 = Math.hypot(R0[1]!, I0[1]!)
    const tau = 0.5
    const kArr = fourierMomenta(n, L)
    const T = (kArr[1]! * kArr[1]!) / 2
    kineticStepImag(re, im, L, tau, 1)
    const { re: R1, im: I1 } = dftComplex1d(re, im)
    const amp1 = Math.hypot(R1[1]!, I1[1]!)
    expect(amp1 / amp0).toBeCloseTo(Math.exp(-T * tau), 10)
  })

  it('potentialDampImag：V 大处振幅更小', () => {
    const n = 16
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    re.fill(1)
    const V = new Float64Array(n)
    for (let i = 0; i < n; i++) V[i] = i
    potentialDampImag(re, im, V, 1)
    expect(re[0]!).toBeCloseTo(1, 12)
    expect(re[n - 1]!).toBeLessThan(re[0]!)
    expect(re[n - 1]!).toBeCloseTo(Math.exp(-(n - 1)), 10)
  })

  it('expectationEnergy：自由高斯动能 > 0；谐振子总能量 > 动能', () => {
    const f = createGaussianPacket1d({
      n: 96,
      L: 20,
      sigma: 1.2,
      k0: 0,
      normalize: true,
    })
    const eFree = expectationEnergy(f.re, f.im, f.L, null, 1)
    expect(eFree).toBeGreaterThan(0)
    const V = harmonicPotential1d(f.n, f.L, 1)
    const eHO = expectationEnergy(f.re, f.im, f.L, V, 1)
    expect(eHO).toBeGreaterThan(eFree)
  })

  it('虚时自由演化：动能下降', () => {
    const f = createGaussianPacket1d({
      n: 96,
      L: 24,
      sigma: 1,
      k0: 0,
      normalize: true,
    })
    const e0 = expectationEnergy(f.re, f.im, f.L, null, 1)
    for (let s = 0; s < 20; s++) {
      splitOperatorImagStep(f.re, f.im, f.L, 0.1, null, 1)
      normalizeWavefunction(f.re, f.im, f.dx)
    }
    const eF = expectationEnergy(f.re, f.im, f.L, null, 1)
    expect(eF).toBeLessThan(e0 * 0.5)
  })

  it('虚时谐振子：能量下降', () => {
    const n = 128
    const L = 24
    const f = createGaussianPacket1d({
      n,
      L,
      sigma: 2.5,
      x0: 0.5,
      k0: 0,
      normalize: true,
    })
    const V = harmonicPotential1d(n, L, 1)
    const e0 = expectationEnergy(f.re, f.im, L, V, 1)
    for (let s = 0; s < 30; s++) {
      splitOperatorImagStep(f.re, f.im, L, 0.1, V, 1)
      normalizeWavefunction(f.re, f.im, f.dx)
    }
    const eF = expectationEnergy(f.re, f.im, L, V, 1)
    expect(eF).toBeLessThan(e0)
    expect(eF).toBeGreaterThan(0)
  })

  it('runTdseImagSample ok：能量下降、归一、family 对齐', () => {
    const r = runTdseImagSample()
    expect(r.methodId).toBe(METHOD_ALGO_TDSE_IMAG)
    expect(r.familyId).toBe(METHOD_SCHRODINGER)
    expect(r.finite).toBe(true)
    expect(r.energyDecreased).toBe(true)
    expect(r.energyF).toBeLessThan(r.energy0)
    expect(r.energyDropRel).toBeGreaterThan(0.02)
    expect(r.probF).toBeCloseTo(1, 10)
    expect(r.ok).toBe(true)
  })

  it('runTdseImagSample 自由粒子（kappa=0）能量下降', () => {
    const r = runTdseImagSample({
      kappa: 0,
      sigma: 1,
      tauTotal: 3,
      steps: 30,
    })
    expect(r.ok).toBe(true)
    expect(r.energyDecreased).toBe(true)
    expect(r.energyF).toBeLessThan(r.energy0)
  })
})
