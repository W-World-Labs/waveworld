import { describe, it, expect } from 'vitest'
import {
  RADAR_CELLS_PER_STEP,
  RADAR_METHOD_IDS,
  RADAR_PARENT,
  RADAR_RANGE_METHOD_ID,
  RADAR_SAMPLE_STRIDE,
  RADAR_TARGETS,
  RADAR_TX,
  radarEchoPeaks,
  radarMaxRange,
  radarPowerRatioDoubleRange,
  radarReceivedPower,
  radarWavelength,
  runRadarRangeSample,
  type RadarScene,
} from './radar-algos'
import { WasmRadar } from './wasm-fields'
import { methodById } from '../../data/methods/methods'

describe('雷达距离方程 · sensing 纯模块', () => {
  it('方法 id 常量与传感父族（radar simPath）', () => {
    expect(RADAR_PARENT).toBe('method-tdoa-trilateration')
    expect(RADAR_RANGE_METHOD_ID).toBe('method-algo-radar-range')
    expect(RADAR_METHOD_IDS).toEqual([RADAR_RANGE_METHOD_ID])
    const parent = methodById(RADAR_PARENT)
    expect(parent).toBeDefined()
    expect(parent!.kind).toBe('sensing')
    expect(parent!.simPaths).toContain('radar')
  })

  it('λ = c/f', () => {
    const c = 299_792_458
    expect(radarWavelength(c)).toBeCloseTo(1, 12)
    expect(radarWavelength(10e9)).toBeCloseTo(c / 10e9, 12)
  })

  it('R_max 解析：手算 (num/den)^(1/4)', () => {
    const p = {
      pt: 1000,
      gt: 1000,
      gr: 1000,
      lambda: 0.03,
      sigma: 1,
      sMin: 1e-12,
    }
    const num = p.pt * p.gt * p.gr * p.lambda * p.lambda * p.sigma
    const den = (4 * Math.PI) ** 3 * p.sMin
    const expected = (num / den) ** 0.25
    expect(radarMaxRange(p)).toBeCloseTo(expected, 10)
    expect(radarMaxRange(p)).toBeGreaterThan(0)
  })

  it('Pr(R_max) = Smin 闭合；R×2 → Pr/16', () => {
    const r = runRadarRangeSample()
    expect(r.methodId).toBe(RADAR_RANGE_METHOD_ID)
    expect(r.rMax).toBeGreaterThan(0)
    expect(r.prAtRmax).toBeCloseTo(r.sMin, 8)
    // 距离减半：R⁴ 因子 → Pr × 16
    expect(r.prAtHalf / r.prAtRmax).toBeCloseTo(16, 8)
    expect(r.ratioDouble).toBeCloseTo(radarPowerRatioDoubleRange(), 12)
    expect(r.ratioDouble).toBeCloseTo(1 / 16, 12)
  })

  it('雷达方程 R⁴ 与增益线性缩放', () => {
    const base = {
      pt: 100,
      gt: 10,
      gr: 10,
      lambda: 0.1,
      sigma: 2,
    }
    const p1 = radarReceivedPower(base, 1000)
    const p2 = radarReceivedPower(base, 2000)
    expect(p1 / p2).toBeCloseTo(16, 10)
    // Pt×4 → Pr×4
    const p3 = radarReceivedPower({ ...base, pt: 400 }, 1000)
    expect(p3 / p1).toBeCloseTo(4, 10)
  })

  it('非法参数抛错', () => {
    expect(() => radarMaxRange({ pt: 0, gt: 1, gr: 1, lambda: 1, sigma: 1, sMin: 1 })).toThrow()
    expect(() => radarReceivedPower({ pt: 1, gt: 1, gr: 1, lambda: 1, sigma: 1 }, 0)).toThrow()
    expect(() => radarWavelength(-1)).toThrow()
  })
})

describe('雷达波场 · TMz FDTD 场景（物理不变量）', () => {
  const wall = RADAR_TARGETS[0]
  const scene: RadarScene = {
    mode: 'pulse',
    steps: 400,
    probes: [
      { x: 36, y: 100 },          // 近发射源：直达脉冲
      { x: 110, y: 100 },         // 墙前方：直达 + 墙面回波
      null,
      { x: 140, y: 100 },         // 墙后阴影区
    ],
  }
  function run() {
    const owner = new WasmRadar(scene)
    while (owner.completed < scene.steps) owner.advance(Math.min(64, scene.steps - owner.completed))
    return owner
  }

  it('发射脉冲在探针迹线上产生真实回波', () => {
    const owner = run()
    const traces = owner.traces
    expect(traces[0].length).toBe(Math.ceil(scene.steps / RADAR_SAMPLE_STRIDE))
    expect(traces[2]).toEqual([])
    const direct = radarEchoPeaks(traces[0])
    expect(direct.length).toBeGreaterThanOrEqual(1)
    // 直达脉冲前沿在 (36-24)/c ≈ 24 步内到达
    expect(direct[0] * RADAR_SAMPLE_STRIDE).toBeLessThan(2 * (36 - RADAR_TX.x) / RADAR_CELLS_PER_STEP + 20)
  })

  it('墙面回波时延 = 往返距离 / c（2d/c）', () => {
    const owner = run()
    const trace = owner.traces[1]
    const peaks = radarEchoPeaks(trace)
    expect(peaks.length).toBeGreaterThanOrEqual(2)
    // 直达脉冲之后最强的后续偏移是墙面回波（最近的强反射体）。
    const direct = peaks[0]
    let echo = direct, best = 0
    trace.forEach((v, i) => {
      const a = Math.abs(v)
      if (i > direct + 12 && a > best) { best = a; echo = i }
    })
    const delaySteps = (echo - direct) * RADAR_SAMPLE_STRIDE
    // 探针在 x=110，墙面在 x=120：2·10/c = 40 步。FDTD 数值色散与
    // 双步采样给容差；旧标量波内核（c=√0.22≈0.469）也在此窗口。
    const expected = (2 * (wall.x0 - 110)) / RADAR_CELLS_PER_STEP
    expect(delaySteps).toBeGreaterThan(expected * 0.6)
    expect(delaySteps).toBeLessThan(expected * 1.6)
  })

  it('回波检测排序：墙前探针 pp 大于墙后阴影区', () => {
    const owner = run()
    const readout = owner.readout()
    expect(readout[1]).not.toBeNull()
    expect(readout[3]).not.toBeNull()
    // 大截面墙的阴影/反射使墙后探针的峰峰值小于墙前探针
    expect(readout[1]!.pp).toBeGreaterThan(readout[3]!.pp)
    expect(readout[2]).toBeNull()
  })

  it('脉冲通过后场能量被吸收边界耗散', () => {
    const owner = new WasmRadar(scene)
    owner.advance(60)
    const early = Math.max(...Array.from(owner.field, Math.abs))
    while (owner.completed < scene.steps) owner.advance(Math.min(64, scene.steps - owner.completed))
    const late = Math.max(...Array.from(owner.field, Math.abs))
    expect(early).toBeGreaterThan(0)
    expect(late).toBeLessThan(early)
  })

  it('radarEchoPeaks 对空迹线返回空检测', () => {
    expect(radarEchoPeaks([0, 0, 0])).toEqual([])
    expect(radarEchoPeaks([0, 1, 0, 0, 0, -0.5, 0])).toHaveLength(2)
  })
})
