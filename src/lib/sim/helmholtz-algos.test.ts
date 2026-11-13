import { describe, it, expect } from 'vitest'
import {
  METHOD_HELMHOLTZ,
  METHOD_ALGO_HELMHOLTZ_FD,
  HELMHOLTZ_METHOD_IDS,
  analyticHelmholtzSine1d,
  applyHelmholtz1d,
  assembleHelmholtz1d,
  helmholtzEigenmode1d,
  maxAbs,
  norm2,
  residualHelmholtz1d,
  runHelmholtzFdSample,
  solveHelmholtzFd,
  solveTridiag,
} from './helmholtz-algos'

describe('Helmholtz 1D · 有限差分', () => {
  it('方法 id 常量（family / algo 可未入库）', () => {
    expect(METHOD_HELMHOLTZ).toBe('method-helmholtz')
    expect(METHOD_ALGO_HELMHOLTZ_FD).toBe('method-algo-helmholtz-fd')
    expect(HELMHOLTZ_METHOD_IDS).toContain(METHOD_ALGO_HELMHOLTZ_FD)
  })

  it('solveTridiag：对角系统精确', () => {
    const x = solveTridiag([0, 1], [2, 2], [1, 0], [4, 5])
    expect(x[0]).toBeCloseTo(1, 10)
    expect(x[1]).toBeCloseTo(2, 10)
  })

  it('assembleHelmholtz1d：三对角结构', () => {
    const M = 4
    const L = 1
    const k = 0
    const sys = assembleHelmholtz1d(M, L, k, 1)
    const invh2 = 1 / (sys.h * sys.h)
    expect(sys.h).toBeCloseTo(1 / 5, 12)
    expect(sys.b[0]).toBeCloseTo(-2 * invh2 + k * k, 12)
    expect(sys.a[1]).toBeCloseTo(invh2, 12)
    expect(sys.c[0]).toBeCloseTo(invh2, 12)
    expect(sys.d[0]).toBe(1)
    expect(sys.a[0]).toBe(0)
    expect(sys.c[M - 1]).toBe(0)
  })

  it('analyticHelmholtzSine1d：端点 u=0，f 与 k 一致', () => {
    const L = 1
    const k = 2
    expect(analyticHelmholtzSine1d(0, L, k).u).toBeCloseTo(0, 12)
    expect(analyticHelmholtzSine1d(L, L, k).u).toBeCloseTo(0, 12)
    const mid = analyticHelmholtzSine1d(0.5, L, k)
    expect(mid.u).toBeCloseTo(1, 12)
    const kp = Math.PI / L
    expect(mid.f).toBeCloseTo(k * k - kp * kp, 12)
  })

  it('solveHelmholtzFd：逼近正弦特解', () => {
    const M = 64
    const L = 1
    const k = 2
    const h = L / (M + 1)
    const f = new Float64Array(M)
    for (let i = 0; i < M; i++) {
      f[i] = analyticHelmholtzSine1d((i + 1) * h, L, k).f
    }
    const { u } = solveHelmholtzFd(M, L, k, f)
    expect(u[0]).toBe(0)
    expect(u[M + 1]).toBe(0)
    let maxErr = 0
    for (let i = 0; i < M; i++) {
      const exact = analyticHelmholtzSine1d((i + 1) * h, L, k).u
      maxErr = Math.max(maxErr, Math.abs(u[i + 1]! - exact))
    }
    expect(maxErr).toBeLessThan(1e-3)
  })

  it('helmholtzEigenmode1d：k = mπ/L，端点 0', () => {
    const { u, k, h, mode } = helmholtzEigenmode1d(33, 1, 2)
    expect(mode).toBe(2)
    expect(k).toBeCloseTo((2 * Math.PI) / 1, 12)
    expect(u[0]).toBe(0)
    expect(u[u.length - 1]).toBe(0)
    expect(h).toBeCloseTo(1 / 32, 12)
    expect(maxAbs(u)).toBeGreaterThan(0.9)
  })

  it('本征模离散残差小', () => {
    const n = 65
    const L = 1
    const { u, k, h } = helmholtzEigenmode1d(n, L, 1)
    const Au = new Float64Array(n)
    applyHelmholtz1d(u, k, h, Au)
    const rel = norm2(Au) / norm2(u)
    expect(rel).toBeLessThan(0.02)
  })

  it('residualHelmholtz1d：精确数值解残差近 0', () => {
    const M = 32
    const L = 1
    const k = 1.5
    const h = L / (M + 1)
    const fInt = new Float64Array(M)
    for (let i = 0; i < M; i++) {
      fInt[i] = analyticHelmholtzSine1d((i + 1) * h, L, k).f
    }
    const { u } = solveHelmholtzFd(M, L, k, fInt)
    const fFull = new Float64Array(M + 2)
    for (let i = 0; i < M; i++) fFull[i + 1] = fInt[i]!
    const r = residualHelmholtz1d(u, fFull, k, h)
    expect(norm2(r)).toBeLessThan(1e-10)
  })

  it('runHelmholtzFdSample ok', () => {
    const r = runHelmholtzFdSample({ M: 64, L: 1, k: 2, mode: 1 })
    expect(r.methodId).toBe(METHOD_ALGO_HELMHOLTZ_FD)
    expect(r.familyId).toBe(METHOD_HELMHOLTZ)
    expect(r.finite).toBe(true)
    expect(r.solveAccurate).toBe(true)
    expect(r.modeResidualSmall).toBe(true)
    expect(r.maxSolveErr).toBeLessThan(1e-2)
    expect(r.residualSolve).toBeLessThan(1e-6)
    expect(r.ok).toBe(true)
  })
})
