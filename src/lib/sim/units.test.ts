import { describe, it, expect } from 'vitest'
import { makeScale, tStarToKelvin, kelvinToTStar, reducedLengthToNm, reducedTimeToPs, type LjScale } from './units'

const AR: LjScale = { sigma_nm: 0.3405, epsilon_kJmol: 0.9961, mass_amu: 39.948 }

describe('units: LJ reduced↔SI 换算', () => {
  it('makeScale 派生 τ[ps] = σ√(m/ε)，k_B 标度', () => {
    const s = makeScale(AR)
    // Ar τ = 0.3405·√(39.948/0.9961) ≈ 2.156 ps
    expect(s.tau_ps).toBeCloseTo(0.3405 * Math.sqrt(39.948 / 0.9961), 6)
    expect(s.tau_ps).toBeGreaterThan(2.0); expect(s.tau_ps).toBeLessThan(2.3)
  })
  it('T*=1 → T = ε/k_B = 119.8 K（Ar）', () => {
    expect(tStarToKelvin(1, makeScale(AR))).toBeCloseTo(0.9961 / 0.0083145, 3)
  })
  it('温度往返一致：K→T*→K 不变', () => {
    const s = makeScale(AR)
    expect(kelvinToTStar(tStarToKelvin(0.85, s), s)).toBeCloseTo(0.85, 9)
  })
  it('长度/时间标度：r*=1→σ nm；t*=1→τ ps', () => {
    const s = makeScale(AR)
    expect(reducedLengthToNm(1, s)).toBeCloseTo(0.3405, 9)
    expect(reducedTimeToPs(1, s)).toBeCloseTo(s.tau_ps, 9)
  })
})

// 追加到 units.test.ts
import { diffusionReducedToNm2PerPs, pressureReducedToSI, N_A } from './units'

describe('units: 扩散系数约化→nm²/ps', () => {
  it('D[nm²/ps] = D*·σ²/τ（Ar）', () => {
    const s = makeScale(AR)
    // D*=1 → σ²/τ = 0.3405²/τ_Ar
    const expected = (0.3405 * 0.3405) / s.tau_ps
    expect(diffusionReducedToNm2PerPs(1, s)).toBeCloseTo(expected, 9)
  })
})

describe('units: 约化压强→SI（带维度）', () => {
  it('P*=0 → 0；线性于 P*', () => {
    expect(pressureReducedToSI(0, AR, 3)).toBe(0)
    expect(pressureReducedToSI(2, AR, 3)).toBeCloseTo(2 * pressureReducedToSI(1, AR, 3), 9)
  })
  it('3D：P_Pa = P*·ε/σ³（Ar，量级 ~数十 MPa）', () => {
    const epsJ = (0.9961e3) / N_A
    const sigmaM = 0.3405e-9
    const expected = (1 * epsJ) / Math.pow(sigmaM, 3)
    expect(pressureReducedToSI(1, AR, 3) / expected).toBeCloseTo(1, 9)
    // 量级护栏：LJ 约化 P*≈1 对 Ar 约 4×10⁷ Pa（数十 MPa）
    expect(pressureReducedToSI(1, AR, 3)).toBeGreaterThan(1e7)
    expect(pressureReducedToSI(1, AR, 3)).toBeLessThan(1e8)
  })
  it('2D 面压（N/m）≠ 3D（Pa）：相差一个 1/σ 因子', () => {
    const p2 = pressureReducedToSI(1, AR, 2) // ε/σ²，N/m
    const p3 = pressureReducedToSI(1, AR, 3) // ε/σ³，Pa
    expect(p3 / p2).toBeCloseTo(1 / (0.3405e-9), 3) // 比值 = 1/σ[m]
  })
})
