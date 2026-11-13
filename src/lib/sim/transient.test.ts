import { describe, it, expect } from 'vitest'
import { WasmTransient } from './wasm-fields'
import {
  rcCharge,
  rcDischarge,
  rlCurrent,
  timeConstantRC,
  timeConstantRL,
  firstOrderStep,
  transientResult,
  type RcState,
} from './transient'

describe('RC/RL 一阶暂态 — 解析 + 数值对拍', () => {
  const V0 = 5
  const R = 1000 // Ω
  const C = 1e-6 // F
  const L = 0.5 // H

  it('① 时间常数 τ=RC 与 τ=L/R 正确', () => {
    expect(timeConstantRC(R, C)).toBeCloseTo(R * C, 12)
    expect(timeConstantRC(1000, 1e-6)).toBeCloseTo(1e-3, 12)
    expect(timeConstantRL(L, R)).toBeCloseTo(L / R, 12)
    expect(timeConstantRL(0.5, 1000)).toBeCloseTo(5e-4, 12)
  })

  it('② t=τ 时 rcCharge 达 63.2%·V0（±0.5%）', () => {
    const tau = timeConstantRC(R, C)
    const v = rcCharge(tau, V0, R, C)
    const frac = v / V0
    expect(frac).toBeCloseTo(0.6321, 3)
    expect(Math.abs(frac - 0.6321) / 0.6321).toBeLessThan(0.005)
  })

  it('③ t=5τ 接近稳态(>99%)', () => {
    const tau = timeConstantRC(R, C)
    const v = rcCharge(5 * tau, V0, R, C)
    expect(v / V0).toBeGreaterThan(0.99)
    // RL 同理：i 接近稳态 V0/R
    const tauL = timeConstantRL(L, R)
    const iSteady = V0 / R
    expect(rlCurrent(5 * tauL, V0, R, L) / iSteady).toBeGreaterThan(0.99)
  })

  it('④ 放电 t=τ 落到 36.8%', () => {
    const tau = timeConstantRC(R, C)
    const v = rcDischarge(tau, V0, R, C)
    const frac = v / V0
    expect(frac).toBeCloseTo(0.3679, 3)
    expect(Math.abs(frac - 0.3679) / 0.3679).toBeLessThan(0.005)
  })

  it('充电与放电互补：charge + discharge = V0（任意 t）', () => {
    const tau = timeConstantRC(R, C)
    for (const t of [0, 0.3 * tau, tau, 2 * tau, 4 * tau]) {
      expect(rcCharge(t, V0, R, C) + rcDischarge(t, V0, R, C)).toBeCloseTo(V0, 9)
    }
  })

  it('⑤ 数值积分轨迹 ≈ 解析曲线（多点容差<1%）', () => {
    const tau = timeConstantRC(R, C)
    const dt = tau / 500
    const p = { V: V0, R, C }
    const owner = new WasmTransient()
    let st: RcState = { Vc: 0 } // 充电：从 0 起
    let t = 0
    // 在若干检查点比对数值积分与解析解
    const checkAt = [0.5, 1, 2, 3, 5].map((k) => k * tau)
    let ci = 0
    while (ci < checkAt.length) {
      st = firstOrderStep(st, p, dt, owner)
      t += dt
      if (t >= checkAt[ci]) {
        const exact = rcCharge(t, V0, R, C)
        const rel = Math.abs(st.Vc - exact) / Math.max(Math.abs(exact), 1e-9)
        expect(rel).toBeLessThan(0.01)
        ci++
      }
    }
  })

  it('数值积分稳态收敛到电源电压 V', () => {
    const tau = timeConstantRC(R, C)
    const dt = tau / 200
    const p = { V: V0, R, C }
    const owner = new WasmTransient()
    let st: RcState = { Vc: 0 }
    for (let i = 0; i < 200 * 12; i++) st = firstOrderStep(st, p, dt, owner)
    expect(st.Vc).toBeCloseTo(V0, 3)
  })

  it('t=0 时各解析式取边界值', () => {
    expect(rcCharge(0, V0, R, C)).toBeCloseTo(0, 12)
    expect(rcDischarge(0, V0, R, C)).toBeCloseTo(V0, 12)
    expect(rlCurrent(0, V0, R, L)).toBeCloseTo(0, 12)
  })
  it('快照覆盖 0..5τ，游标 τ 对应第 48 个采样间隔', () => {
    const owner = new WasmTransient()
    for (const mode of ['rc-charge', 'rc-discharge', 'rl'] as const) {
      const result = transientResult({ mode, v0: V0, r: R, c: C, l: L }, owner)
      const scale = mode === 'rl' ? V0 / R : V0
      expect(result.values).toHaveLength(241)
      expect(result.unit).toBe(mode === 'rl' ? 'A' : 'V')
      expect(result.tau).toBeCloseTo(mode === 'rl' ? L / R : R * C, 12)
      expect(result.values[0]).toBe(mode === 'rc-discharge' ? V0 : 0)
      expect(result.values[48] / scale).toBeCloseTo(mode === 'rc-discharge' ? Math.exp(-1) : 1 - Math.exp(-1), 12)
      expect(result.values[240] / scale).toBeCloseTo(mode === 'rc-discharge' ? Math.exp(-5) : 1 - Math.exp(-5), 12)
    }
  })
})
