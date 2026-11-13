import { describe, it, expect } from 'vitest'
import {
  FDTD_L4_PARENT,
  FDTD_L4_METHOD_IDS,
  METHOD_ALGO_FDTD_CPML,
  createFdtd1dCpml,
  fdtd1dCpmlEnergy,
  fdtd1dCpmlStep,
  injectGaussianECpml,
  matchedSigmaStar,
  pmlSigmaAt,
  runFdtdCpmlSample,
} from './fdtd-l4-algos'
import { methodById } from '../../data/methods/methods'

describe('FDTD L4 · 1D UPML/CPML-lite 吸收', () => {
  it('方法 id 常量（cpml 为未入库新 id）', () => {
    expect(FDTD_L4_PARENT).toBe('method-fdtd')
    expect(METHOD_ALGO_FDTD_CPML).toBe('method-algo-fdtd-cpml')
    expect(FDTD_L4_METHOD_IDS).toContain(METHOD_ALGO_FDTD_CPML)
    expect(methodById(FDTD_L4_PARENT)).toBeDefined()
    expect(methodById(FDTD_L4_PARENT)!.role).toBe('family')
  })

  it('pmlSigmaAt：内部 0，外缘最大', () => {
    const nE = 40
    const pml = 8
    const sMax = 1.5
    expect(pmlSigmaAt(20, nE, pml, sMax, 3)).toBe(0)
    expect(pmlSigmaAt(0, nE, pml, sMax, 3)).toBeCloseTo(sMax, 12)
    expect(pmlSigmaAt(nE - 1, nE, pml, sMax, 3)).toBeCloseTo(sMax, 12)
    expect(pmlSigmaAt(1, nE, pml, sMax, 3)).toBeLessThan(sMax)
    expect(pmlSigmaAt(1, nE, pml, sMax, 3)).toBeGreaterThan(0)
  })

  it('matchedSigmaStar：σ*/μ = σ/ε', () => {
    const eps = 2
    const mu = 3
    const sig = 0.4
    const star = matchedSigmaStar(sig, eps, mu)
    expect(star / mu).toBeCloseTo(sig / eps, 12)
  })

  it('PEC 腔：多步能量近似守恒', () => {
    const f = createFdtd1dCpml({ nE: 64, boundary: 'pec', S: 0.5 })
    injectGaussianECpml(f, 1, 4)
    const e0 = fdtd1dCpmlEnergy(f)
    for (let t = 0; t < 100; t++) fdtd1dCpmlStep(f)
    const ef = fdtd1dCpmlEnergy(f)
    expect(Math.abs(ef - e0) / e0).toBeLessThan(0.08)
  })

  it('CPML：脉冲出走后能量显著衰减', () => {
    const f = createFdtd1dCpml({
      nE: 128,
      boundary: 'cpml',
      pmlCells: 16,
      S: 0.5,
      sigmaScale: 1.2,
    })
    injectGaussianECpml(f, 1, 5)
    const e0 = fdtd1dCpmlEnergy(f)
    expect(e0).toBeGreaterThan(0)
    for (let t = 0; t < 220; t++) fdtd1dCpmlStep(f)
    const ef = fdtd1dCpmlEnergy(f)
    expect(Number.isFinite(ef)).toBe(true)
    expect(ef).toBeLessThan(e0 * 0.2)
    expect(ef).toBeGreaterThanOrEqual(0)
  })

  it('runFdtdCpmlSample：吸收层反射低于 PEC', () => {
    const r = runFdtdCpmlSample({ nE: 128, steps: 220, pmlCells: 16 })
    expect(r.methodId).toBe(METHOD_ALGO_FDTD_CPML)
    expect(r.familyId).toBe(FDTD_L4_PARENT)
    expect(r.finite).toBe(true)
    expect(r.lessReflection).toBe(true)
    expect(r.cpmlAbsorbed).toBe(true)
    expect(r.Efcpml).toBeLessThan(r.Efpec)
    expect(r.Efcpml).toBeLessThan(r.E0cpml)
    expect(r.ok).toBe(true)
  })
})
