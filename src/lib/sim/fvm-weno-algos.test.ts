import { describe, it, expect } from 'vitest'
import {
  FVM_PARENT,
  FVM_WENO_METHOD_IDS,
  FVM_WENO_PARENT,
  METHOD_ALGO_FVM_WENO3,
  runFvmWeno3Sample,
  sineCellAverages,
  sineFaceExact,
  totalVariation,
  weno3Left,
  weno3LeftAll,
  weno3Right,
  weno3RightAll,
} from './fvm-weno-algos'
import { methodById } from '../../data/methods/methods'

describe('有限体积 · WENO3 界面重构', () => {
  it('方法 id 常量（weno3 为未入库新 id）', () => {
    expect(FVM_PARENT).toBe('method-finite-volume')
    expect(FVM_WENO_PARENT).toBe('method-finite-volume')
    expect(METHOD_ALGO_FVM_WENO3).toBe('method-algo-fvm-weno3')
    expect(FVM_WENO_METHOD_IDS).toContain(METHOD_ALGO_FVM_WENO3)
    expect(methodById(FVM_PARENT)).toBeDefined()
    expect(methodById(FVM_PARENT)!.role).toBe('family')
  })

  it('均匀场：左右态等于常数', () => {
    const u = new Float64Array(16).fill(2.5)
    for (let i = 0; i < 16; i++) {
      expect(weno3Left(u, i)).toBeCloseTo(2.5, 12)
      expect(weno3Right(u, i)).toBeCloseTo(2.5, 12)
    }
  })

  it('线性场（周期三角波局部）：有限且无 NaN', () => {
    const n = 32
    const u = new Float64Array(n)
    for (let i = 0; i < n; i++) u[i] = i
    // 非周期线性不适合全局，仅检查单点局部光滑段
    const mid = weno3Left(u, 10)
    expect(Number.isFinite(mid)).toBe(true)
    expect(Number.isNaN(mid)).toBe(false)
  })

  it('光滑正弦：重构 ≈ 精确界面值', () => {
    const n = 64
    const u = sineCellAverages(n)
    const exact = sineFaceExact(n)
    let maxL = 0
    let maxR = 0
    for (let i = 0; i < n; i++) {
      maxL = Math.max(maxL, Math.abs(weno3Left(u, i) - exact[i]!))
      maxR = Math.max(maxR, Math.abs(weno3Right(u, i) - exact[i]!))
    }
    // WENO3 光滑区三阶；n=64 时 max 误差应远小于 1e-2
    expect(maxL).toBeLessThan(5e-3)
    expect(maxR).toBeLessThan(5e-3)
  })

  it('间断阶跃：无 NaN，TVB-ish', () => {
    const n = 64
    const u = new Float64Array(n)
    for (let i = 0; i < n; i++) u[i] = i < n / 2 ? 1 : -1
    const L = weno3LeftAll(u)
    const R = weno3RightAll(u)
    expect(L.every(Number.isFinite)).toBe(true)
    expect(R.every(Number.isFinite)).toBe(true)
    const tv0 = totalVariation(u)
    expect(totalVariation(L)).toBeLessThanOrEqual(4 * tv0 + 1e-9)
    expect(totalVariation(R)).toBeLessThanOrEqual(4 * tv0 + 1e-9)
    // 跳变幅度有界：不过冲到 |v|≫1
    let maxAbs = 0
    for (let i = 0; i < n; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(L[i]!), Math.abs(R[i]!))
    }
    expect(maxAbs).toBeLessThan(3)
  })

  it('runFvmWeno3Sample：光滑误差小 + 间断 TVB', () => {
    const r = runFvmWeno3Sample({ nSmooth: 64, nDisc: 80 })
    expect(r.methodId).toBe(METHOD_ALGO_FVM_WENO3)
    expect(r.familyId).toBe(FVM_WENO_PARENT)
    expect(r.leftMaxErr).toBeLessThan(5e-3)
    expect(r.rightMaxErr).toBeLessThan(5e-3)
    expect(r.discFinite).toBe(true)
    expect(r.tvbOk).toBe(true)
    expect(r.tv0).toBeGreaterThan(0)
  })
})
