import { describe, it, expect } from 'vitest'
import {
  FEM_L2_PARENT,
  FEM_L2_POISSON_1D_ID,
  FEM_L2_ASSEMBLE_ID,
  FEM_L2_MASS_MATRIX_ID,
  FEM_L2_METHOD_IDS,
  solveTridiag,
  assemblePoisson1d,
  assembleMass1d,
  solvePoisson1d,
  analyticPoisson1d,
  runFemAssembleSample,
  runFemPoisson1dSample,
  runFemMassMatrixSample,
} from './fem-l2-algos'

describe('FEM L2 · 1D Poisson 线性元', () => {
  it('方法 id 常量（assemble 为未入库新 id）', () => {
    expect(FEM_L2_PARENT).toBe('method-fem')
    expect(FEM_L2_POISSON_1D_ID).toBe('method-algo-fem-poisson-1d')
    expect(FEM_L2_ASSEMBLE_ID).toBe('method-algo-fem-assemble')
    expect(FEM_L2_METHOD_IDS).toContain(FEM_L2_ASSEMBLE_ID)
    expect(FEM_L2_METHOD_IDS).toContain(FEM_L2_POISSON_1D_ID)
  })

  it('solveTridiag：对角系统精确', () => {
    // [2 1; 1 2][x;y]=[4;5] → x=1,y=2
    const x = solveTridiag([0, 1], [2, 2], [1, 0], [4, 5])
    expect(x[0]).toBeCloseTo(1, 10)
    expect(x[1]).toBeCloseTo(2, 10)
  })

  it('assemblePoisson1d：三对角结构正确', () => {
    const M = 4
    const sys = assemblePoisson1d(M, 1)
    expect(sys.h).toBeCloseTo(1 / 5, 12)
    expect(sys.b[0]).toBeCloseTo(2 / sys.h, 12)
    expect(sys.a[1]).toBeCloseTo(-1 / sys.h, 12)
    expect(sys.c[0]).toBeCloseTo(-1 / sys.h, 12)
    expect(sys.d[0]).toBeCloseTo(sys.h, 12)
    expect(sys.a[0]).toBe(0)
    expect(sys.c[M - 1]).toBe(0)
  })

  it('analyticPoisson1d：中点 1/8', () => {
    expect(analyticPoisson1d(0.5, 1)).toBeCloseTo(0.125, 12)
    expect(analyticPoisson1d(0, 1)).toBe(0)
    expect(analyticPoisson1d(1, 1)).toBe(0)
  })

  it('solvePoisson1d：中点逼近解析解', () => {
    const { u, h } = solvePoisson1d(32, 1)
    const midIdx = Math.floor(32 / 2)
    const x = (midIdx + 1) * h
    expect(u[midIdx]).toBeCloseTo(analyticPoisson1d(x, 1), 3)
  })

  it('runFemAssembleSample：组装校验 + 中点误差', () => {
    const r = runFemAssembleSample(32, 1)
    expect(r.methodId).toBe(FEM_L2_ASSEMBLE_ID)
    expect(r.diagOk).toBe(true)
    expect(r.offDiagOk).toBe(true)
    expect(r.loadOk).toBe(true)
    expect(r.errMid).toBeLessThan(1e-3)
    expect(r.midU).toBeCloseTo(0.125, 2)
    expect(r.maxU).toBeGreaterThan(0.1)
  })

  it('runFemPoisson1dSample：中点 u≈x(1−x)/2', () => {
    const r = runFemPoisson1dSample(32)
    expect(r.methodId).toBe(FEM_L2_POISSON_1D_ID)
    expect(r.errMid).toBeLessThan(1e-3)
    expect(r.midU).toBeCloseTo(0.125, 2)
    expect(r.maxU).toBeGreaterThan(0.1)
  })

  it('assembleMass1d：主对角 2h/3、副对角 h/6', () => {
    const M = 5
    const sys = assembleMass1d(M)
    expect(sys.b[0]).toBeCloseTo((2 * sys.h) / 3, 12)
    expect(sys.a[1]).toBeCloseTo(sys.h / 6, 12)
    expect(sys.c[0]).toBeCloseTo(sys.h / 6, 12)
  })

  it('runFemMassMatrixSample：结构 + SPD', () => {
    expect(FEM_L2_METHOD_IDS).toContain(FEM_L2_MASS_MATRIX_ID)
    const r = runFemMassMatrixSample(16)
    expect(r.methodId).toBe(FEM_L2_MASS_MATRIX_ID)
    expect(r.diagOk).toBe(true)
    expect(r.offDiagOk).toBe(true)
    expect(r.diagonallyDominant).toBe(true)
    expect(r.spdSample).toBe(true)
    expect(r.onesQuadratic).toBeGreaterThan(0)
  })
})
