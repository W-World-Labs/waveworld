import { describe, it, expect } from 'vitest'
import {
  rlcStep,
  resonantFreq,
  dampingRatio,
  qualityFactor,
  energy,
  simulate,
  type RlcState,
} from './rlc'

// 计数 i(t) 的过零次数，用于估算振荡周期/判别欠阻尼
function zeroCrossings(trace: RlcState[], key: 'i' | 'q'): number[] {
  const idx: number[] = []
  for (let n = 1; n < trace.length; n++) {
    const a = trace[n - 1][key]
    const b = trace[n][key]
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) idx.push(n)
  }
  return idx
}

describe('RLC — 谐振角频率（无阻尼 R=0）', () => {
  it('① 自由振荡角频率 ≈ ω₀=1/√(LC)（用 i(t) 过零周期估算，容差几 %）', () => {
    const L = 1, C = 1, R = 0
    const w0 = resonantFreq(L, C)
    expect(w0).toBeCloseTo(1, 9) // 1/sqrt(1)=1

    const dt = 0.002
    const steps = 30000
    // 从 q=q0, i=0 起跑（电容储能、电流为零）
    const trace = simulate({ q: 1, i: 0 }, { L, R, C, V: 0 }, dt, steps)

    // i(t) 的相邻同向过零间隔 = 半周期；连续两个间隔合为一个完整周期
    const crossings = zeroCrossings(trace, 'i')
    expect(crossings.length).toBeGreaterThan(4)
    // 取多个完整周期求平均（过零点间隔 * 2 * dt）
    const first = crossings[0]
    const last = crossings[crossings.length - 1]
    const halfPeriods = crossings.length - 1
    const measuredPeriod = ((last - first) / halfPeriods) * 2 * dt
    const theoryPeriod = (2 * Math.PI) / w0
    expect(Math.abs(measuredPeriod - theoryPeriod) / theoryPeriod).toBeLessThan(0.03)
  })
})

describe('RLC — 阻尼判据 ζ', () => {
  it('② 欠阻尼 ζ<1：i(t) 出现正负振荡（多次过零）', () => {
    const L = 1, C = 1, R = 0.2
    const z = dampingRatio(R, L, C)
    expect(z).toBeLessThan(1)
    const trace = simulate({ q: 1, i: 0 }, { L, R, C, V: 0 }, 0.005, 8000)
    const crossings = zeroCrossings(trace, 'i')
    // 欠阻尼振荡 → i 反复变号
    expect(crossings.length).toBeGreaterThan(3)
  })

  it('② 过阻尼 ζ>1：i(t) 单调回落、不反复过冲（过零至多一次）', () => {
    const L = 1, C = 1, R = 4
    const z = dampingRatio(R, L, C)
    expect(z).toBeGreaterThan(1)
    const trace = simulate({ q: 1, i: 0 }, { L, R, C, V: 0 }, 0.002, 12000)
    const crossings = zeroCrossings(trace, 'i')
    expect(crossings.length).toBeLessThanOrEqual(1)
  })

  it('② 临界阻尼 ζ≈1：无振荡（过零至多一次）', () => {
    const L = 1, C = 1
    // ζ=1 → R = 2*sqrt(L/C)
    const R = 2 * Math.sqrt(L / C)
    const z = dampingRatio(R, L, C)
    expect(z).toBeCloseTo(1, 6)
    const trace = simulate({ q: 1, i: 0 }, { L, R, C, V: 0 }, 0.002, 12000)
    const crossings = zeroCrossings(trace, 'i')
    expect(crossings.length).toBeLessThanOrEqual(1)
  })
})

describe('RLC — 能量守恒（R=0）', () => {
  it('③ R=0 时 E=½L·i²+½q²/C 守恒（多步漂移 < 2%）', () => {
    const L = 2, C = 0.5, R = 0
    const dt = 0.001
    const trace = simulate({ q: 1, i: 0 }, { L, R, C, V: 0 }, dt, 20000)
    const E0 = energy(trace[0], { L, C })
    let maxDrift = 0
    for (const s of trace) {
      const E = energy(s, { L, C })
      maxDrift = Math.max(maxDrift, Math.abs(E - E0) / E0)
    }
    expect(maxDrift).toBeLessThan(0.02)
  })
})

describe('RLC — 欠阻尼包络衰减', () => {
  it('④ 峰值序列比值 ≈ e^(−(R/2L)·ΔT_period)（衰减常数对得上）', () => {
    const L = 1, C = 1, R = 0.1
    const dt = 0.002
    const trace = simulate({ q: 1, i: 0 }, { L, R, C, V: 0 }, dt, 40000)

    // 在 q(t) 上找局部正峰（同号相邻峰，间隔为一个周期 T）
    const peaks: { idx: number; val: number }[] = []
    for (let n = 1; n < trace.length - 1; n++) {
      const a = trace[n - 1].q, b = trace[n].q, c = trace[n + 1].q
      if (b > a && b >= c && b > 0) peaks.push({ idx: n, val: b })
    }
    expect(peaks.length).toBeGreaterThan(3)

    // 相邻正峰间隔 ≈ 一个阻尼振荡周期
    const T = (peaks[1].idx - peaks[0].idx) * dt
    const expectedRatio = Math.exp(-(R / (2 * L)) * T)
    const measuredRatio = peaks[1].val / peaks[0].val
    expect(Math.abs(measuredRatio - expectedRatio) / expectedRatio).toBeLessThan(0.05)
  })
})

describe('RLC — 直流阶跃稳态', () => {
  it('⑤ 长时间后 q → C·V，i → 0', () => {
    const L = 1, C = 0.5, R = 1, V = 3
    const dt = 0.002
    const traj = simulate({ q: 0, i: 0 }, { L, R, C, V }, dt, 30000)
    const final = traj[traj.length - 1]
    expect(final.q).toBeCloseTo(C * V, 2) // = 1.5
    expect(Math.abs(final.i)).toBeLessThan(1e-3)
  })
})

describe('RLC — 品质因数与纯函数性质', () => {
  it('Q = √(L/C)/R', () => {
    // qualityFactor(R, L, C)：R=2, L=4, C=1 → √(4/1)/2 = 1
    expect(qualityFactor(2, 4, 1)).toBeCloseTo(Math.sqrt(4 / 1) / 2, 9)
  })

  it('ζ 与 Q 互为倒数关系：ζ = 1/(2Q)', () => {
    const R = 0.5, L = 1, C = 1
    const z = dampingRatio(R, L, C)
    const Q = qualityFactor(R, L, C)
    expect(z).toBeCloseTo(1 / (2 * Q), 9)
  })

  it('rlcStep 是纯函数：不修改入参，返回新对象', () => {
    const s: RlcState = { q: 1, i: 0 }
    const p = { L: 1, R: 0.5, C: 1, V: 0 }
    const next = rlcStep(s, p, 0.01)
    expect(s.q).toBe(1)
    expect(s.i).toBe(0)
    expect(next).not.toBe(s)
  })
})
