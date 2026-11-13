import { describe, it, expect } from 'vitest'
import {
  fhnStep,
  simulate,
  peak,
  neuronResult,
  RESTING,
  NEURON_PULSE_STEPS,
  type FHN,
} from './neuron'

const DT = 0.05
const STEPS = 4000

describe('FitzHugh–Nagumo — 动作电位「全或无」', () => {
  it('阈下小电流(I=0.2)：v 不产生大幅尖峰（峰值仍为负）', () => {
    const trace = simulate(0.2, STEPS, DT)
    // 阈下刺激只让膜电位轻微去极化后回落，远达不到尖峰幅度
    expect(peak(trace)).toBeLessThan(0)
    expect(peak(trace)).toBeLessThan(1)
  })

  it('阈上电流(I=0.5)：触发明显尖峰（v 峰值 > 1）', () => {
    const trace = simulate(0.5, STEPS, DT)
    expect(peak(trace)).toBeGreaterThan(1)
  })

  it('全或无 + 不应期：尖峰后回落到静息附近（有恢复）', () => {
    const trace = simulate(0.5, STEPS, DT)
    const idxPeak = trace.indexOf(peak(trace))
    const tail = trace[trace.length - 1]
    // 尖峰之后膜电位显著下降，最终回到接近静息电位 RESTING.v
    expect(tail).toBeLessThan(peak(trace) - 1)
    expect(Math.abs(tail - RESTING.v)).toBeLessThan(0.2)
    expect(idxPeak).toBeGreaterThan(0)
  })

  it('单调阈值：阈上比阈下尖峰幅度大得多（全或无的跳变）', () => {
    const sub = peak(simulate(0.2, STEPS, DT))
    const supra = peak(simulate(0.5, STEPS, DT))
    expect(supra - sub).toBeGreaterThan(2)
  })

  it('fhnStep 是纯函数：不修改入参', () => {
    const s: FHN = { ...RESTING }
    const next = fhnStep(s, 0.5, DT)
    expect(s.v).toBe(RESTING.v)
    expect(s.w).toBe(RESTING.w)
    expect(next).not.toBe(s)
  })

  it('静息态(I=0)几乎不动：是稳定不动点', () => {
    const trace = simulate(0, 200, DT)
    expect(Math.abs(trace[trace.length - 1] - RESTING.v)).toBeLessThan(0.05)
  })
})

// 内核 upward 标志 / 脉冲窗口语义。断言全部是容差物理不变量（尖峰数、ISI 量级、
// 静息电位），不锁死具体轨迹 —— Euler→RK4 后尖峰时刻允许小幅移动。
describe('createNeuronScene — 脉冲注入与向上过零尖峰检测', () => {
  it('阈上脉冲(I=1.0)触发恰好一次尖峰，随后回到静息电位', () => {
    const r = neuronResult({ current: 1, steps: 3000, pulses: [0] })
    expect(r.spikes).toHaveLength(1)
    // 尖峰落在脉冲窗口附近（时刻可随积分器微调，只给宽窗口）
    expect(r.spikes[0]).toBeGreaterThan(0)
    expect(r.spikes[0]).toBeLessThan(NEURON_PULSE_STEPS + 100)
    expect(r.peak).toBeGreaterThan(1.5)
    expect(Math.abs(r.voltage[r.voltage.length - 1] - RESTING.v)).toBeLessThan(0.05)
  })

  it('阈下脉冲(I=0.2)不产生向上过零尖峰', () => {
    const r = neuronResult({ current: 0.2, steps: 3000, pulses: [0] })
    expect(r.spikes).toHaveLength(0)
    expect(r.peak).toBeLessThan(0)
  })

  it('重复脉冲序列：每脉冲一次尖峰，ISI ≈ 脉冲间隔（容差 ±15%）', () => {
    const spacing = 600
    const pulses = [0, spacing, 2 * spacing, 3 * spacing, 4 * spacing]
    const r = neuronResult({ current: 1, steps: 3000, pulses })
    expect(r.spikes).toHaveLength(pulses.length)
    for (let i = 1; i < r.spikes.length; i++) {
      const isi = r.spikes[i] - r.spikes[i - 1]
      expect(isi).toBeGreaterThan(spacing * 0.85)
      expect(isi).toBeLessThan(spacing * 1.15)
    }
  })

  it('spikes 与电压轨迹的向上过零自洽（与积分器无关的内核语义）', () => {
    const r = neuronResult({ current: 1, steps: 3000, pulses: [0, 600, 1200] })
    const crossings = r.voltage
      .map((v, i) => (i > 0 && r.voltage[i - 1] < 0 && v >= 0 ? i : -1))
      .filter((i) => i >= 0)
    expect(r.spikes).toEqual(crossings)
  })
})
