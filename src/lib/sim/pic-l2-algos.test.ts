import { describe, it, expect } from 'vitest'
import {
  PIC_L2_PARENT,
  PIC_L2_CIC_ID,
  PIC_L2_PUSH_ID,
  PIC_L2_METHOD_IDS,
  cicDeposit,
  poissonPeriodic1d,
  poissonDirichlet1d,
  cicGather,
  pushParticles,
  totalCharge,
  gridChargeSum,
  runPicCicSample,
  runPicPushSample,
} from './pic-l2-algos'

describe('PIC L2 · CIC + 泊松 + 推进', () => {
  it('方法 id 常量（push 为未入库新 id）', () => {
    expect(PIC_L2_PARENT).toBe('method-particle-in-cell')
    expect(PIC_L2_CIC_ID).toBe('method-algo-pic-cic')
    expect(PIC_L2_PUSH_ID).toBe('method-algo-pic-push')
    expect(PIC_L2_METHOD_IDS).toContain(PIC_L2_PUSH_ID)
    expect(PIC_L2_METHOD_IDS).toContain(PIC_L2_CIC_ID)
  })

  it('cicDeposit：电荷守恒（周期）', () => {
    const Ng = 16
    const dx = 1 / Ng
    const rho = new Float64Array(Ng)
    const pos = [0.1, 0.55, 0.99]
    const q = [0.3, 0.5, 0.2]
    cicDeposit(pos, q, rho, dx)
    expect(Math.abs(gridChargeSum(rho) - totalCharge(q))).toBeLessThan(1e-12)
  })

  it('cicDeposit：格点中心粒子全部落入单格', () => {
    const Ng = 8
    const dx = 1 / Ng
    const rho = new Float64Array(Ng)
    // x = 3.0 * dx → 精确落在格点 3
    cicDeposit([3 * dx], [1], rho, dx)
    expect(rho[3]).toBeCloseTo(1, 12)
    let others = 0
    for (let i = 0; i < Ng; i++) if (i !== 3) others += rho[i]!
    expect(others).toBeCloseTo(0, 12)
  })

  it('poissonPeriodic1d：均匀 ρ → E≈0', () => {
    const rho = new Float64Array(16)
    rho.fill(1)
    const E = poissonPeriodic1d(rho, 1 / 16)
    let maxAbs = 0
    for (let i = 0; i < E.length; i++) maxAbs = Math.max(maxAbs, Math.abs(E[i]!))
    expect(maxAbs).toBeLessThan(1e-12)
  })

  it('poissonDirichlet1d：有限且边界 φ=0', () => {
    const n = 17
    const dx = 1 / (n - 1)
    const rho = new Float64Array(n)
    rho.fill(1)
    const { phi, E } = poissonDirichlet1d(rho, dx)
    expect(phi[0]).toBe(0)
    expect(phi[n - 1]).toBe(0)
    expect(E.every(Number.isFinite)).toBe(true)
    // −φ″=1，u=x(1−x)/2 中点 0.125 量级
    const mid = n >> 1
    expect(phi[mid]!).toBeGreaterThan(0.05)
  })

  it('cicGather 与 deposit 互逆权重', () => {
    const Ng = 8
    const dx = 1 / Ng
    const E = new Float64Array(Ng)
    for (let i = 0; i < Ng; i++) E[i] = i
    // 半格点：应线性插值
    const pos = [(2 + 0.25) * dx]
    const Ep = cicGather(pos, E, dx)
    expect(Ep[0]).toBeCloseTo(2 * 0.75 + 3 * 0.25, 10)
  })

  it('pushParticles：零场自由流', () => {
    const pos = new Float64Array([0.1])
    const vel = new Float64Array([0.2])
    pushParticles(pos, vel, [0], [1], 0.5, 1)
    expect(pos[0]).toBeCloseTo(0.1 + 0.2 * 0.5, 12)
    expect(vel[0]).toBeCloseTo(0.2, 12)
  })

  it('runPicCicSample：粒子电荷 = 网格电荷总和', () => {
    const r = runPicCicSample()
    expect(r.methodId).toBe(PIC_L2_CIC_ID)
    expect(r.chargeErr).toBeLessThan(1e-12)
    expect(r.Qparticles).toBeCloseTo(1, 12)
    expect(Number.isFinite(r.eFieldNorm)).toBe(true)
  })

  it('runPicPushSample free：匀速漂移', () => {
    const r = runPicPushSample('free', 40, 0.02)
    expect(r.methodId).toBe(PIC_L2_PUSH_ID)
    expect(r.freeStreamOk).toBe(true)
    expect(r.mode).toBe('free')
  })

  it('runPicPushSample attract：正粒子移向负电荷', () => {
    const r = runPicPushSample('attract', 50, 0.02)
    expect(r.methodId).toBe(PIC_L2_PUSH_ID)
    expect(r.movedToward).toBe(true)
    expect(r.chargeErr).toBeLessThan(1e-10)
    expect(r.xF).not.toBe(r.x0)
  })
})
