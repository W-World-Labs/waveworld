import { describe, it, expect } from 'vitest'
import {
  SEM_L2_PARENT,
  METHOD_ALGO_SEM_LUMPED_MASS,
  SEM_L2_METHOD_IDS,
  assembleConsistentMass1d,
  assembleLumpedMass1d,
  assembleLumpedMass1dDirect,
  frobeniusDiff,
  linNodes1d,
  quadraticForm,
  runSemLumpedMassSample,
  sampleOnNodes,
} from './sem-l2-algos'
import { SEM_PARENT } from './sem-algos'
import { methodById } from '../../data/methods/methods'

describe('SEM L2 · 1D 线性元质量对角集中', () => {
  it('方法 id 常量（lumped-mass 为未入库新 id）', () => {
    expect(SEM_L2_PARENT).toBe('method-spectral-element')
    expect(SEM_L2_PARENT).toBe(SEM_PARENT)
    expect(METHOD_ALGO_SEM_LUMPED_MASS).toBe('method-algo-sem-lumped-mass')
    expect(SEM_L2_METHOD_IDS).toContain(METHOD_ALGO_SEM_LUMPED_MASS)
    expect(methodById(SEM_L2_PARENT)).toBeDefined()
  })

  it('一致质量：两端对角 h/3，内部 2h/3；非对角 h/6', () => {
    const nElem = 4
    const { n, h, M } = assembleConsistentMass1d(nElem)
    expect(n).toBe(5)
    // 边界节点只参与 1 个单元 → 对角 h/3
    expect(M[0]!).toBeCloseTo(h / 3, 12)
    expect(M[(n - 1) * n + (n - 1)]!).toBeCloseTo(h / 3, 12)
    // 内部：两单元 → 2h/3
    expect(M[1 * n + 1]!).toBeCloseTo((2 * h) / 3, 12)
    expect(M[0 * n + 1]!).toBeCloseTo(h / 6, 12)
  })

  it('行和集中 ≡ 直接 (h/2)I 组装', () => {
    const a = assembleLumpedMass1d(8)
    const b = assembleLumpedMass1dDirect(8)
    expect(frobeniusDiff(a.M, b.M)).toBeLessThan(1e-14)
    // 内部对角 = h，边界 = h/2
    const { n, h } = a
    expect(a.M[0]!).toBeCloseTo(h / 2, 12)
    expect(a.M[1 * n + 1]!).toBeCloseTo(h, 12)
  })

  it('全 1 向量二次型 = 1（仿射精确）', () => {
    const nElem = 10
    const cons = assembleConsistentMass1d(nElem)
    const lump = assembleLumpedMass1d(nElem)
    const ones = new Float64Array(cons.n)
    ones.fill(1)
    expect(quadraticForm(cons.M, ones, cons.n)).toBeCloseTo(1, 12)
    expect(quadraticForm(lump.M, ones, lump.n)).toBeCloseTo(1, 12)
  })

  it('sin 插值 FE 函数：lumping 二次型偏离精确 ‖uh‖²', () => {
    const nElem = 20
    const { x, n } = linNodes1d(nElem)
    const u = sampleOnNodes((xi) => Math.sin(Math.PI * xi), x)
    const qc = quadraticForm(assembleConsistentMass1d(nElem).M, u, n)
    const ql = quadraticForm(assembleLumpedMass1d(nElem).M, u, n)
    // Mc 给出分段线性 uh 的精确 L²；Ml 为近似
    expect(Math.abs(ql - qc)).toBeGreaterThan(1e-4)
    expect(qc).toBeGreaterThan(0.4)
    expect(qc).toBeLessThan(0.6)
  })

  it('runSemLumpedMassSample：lumping 误差可测', () => {
    const r = runSemLumpedMassSample(16)
    expect(r.methodId).toBe(METHOD_ALGO_SEM_LUMPED_MASS)
    expect(r.familyId).toBe(SEM_L2_PARENT)
    expect(r.lumpMatch).toBe(true)
    expect(r.relFrobDiff).toBeGreaterThan(0.05)
    expect(r.lumpingQuadErr).toBeGreaterThan(1e-4)
    expect(r.lumpingRelErr).toBeGreaterThan(1e-3)
    expect(r.onesConsistent).toBeCloseTo(1, 10)
    expect(r.onesLumped).toBeCloseTo(1, 10)
  })
})
