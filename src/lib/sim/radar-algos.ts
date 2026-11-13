/**
 * 雷达计算：距离方程与 RadarScope 共用的 2D TMz Yee FDTD 场景。
 * 波场页为约化单位教学模型，内核跑真实麦克斯韦更新（Ez/Hx/Hy 蛙跳、
 * 逐目标介电常数、PEC、海绵吸收边界、TX 软源），不使用解析 R_max：
 *
 *   R_max = [ Pt Gt Gr λ² σ / ((4π)³ S_min) ]^(1/4)
 *
 * 单基地常取 Gt=Gr=G。method id 仅常量，不改 methods.data。
 */

import { WasmRadar, WasmRadarMath } from './wasm-fields'


/** 挂靠传感定位族（radar simPath 已在该族）。 */
export const RADAR_PARENT = 'method-tdoa-trilateration'

/**
 * 雷达距离方程（仅常量，未来可挂目录）。
 * kind: sensing
 */
export const RADAR_RANGE_METHOD_ID = 'method-algo-radar-range'

export const RADAR_METHOD_IDS = [RADAR_RANGE_METHOD_ID] as const

export type RadarRangeParams = {
  /** 发射功率 Pt (W) */
  pt: number
  /** 发射增益 Gt（线性，非 dB） */
  gt: number
  /** 接收增益 Gr（线性） */
  gr: number
  /** 波长 λ (m) */
  lambda: number
  /** 目标 RCS σ (m²) */
  sigma: number
  /** 最小可检测信号功率 S_min (W) */
  sMin: number
}

/**
 * 雷达距离方程给出的最大探测距离 R_max (m)。
 * R_max = (Pt Gt Gr λ² σ / ((4π)³ Smin))^(1/4)
 */
export function radarMaxRange(p: RadarRangeParams): number {
  const owner = new WasmRadarMath()
  owner.params.set([p.pt, p.gt, p.gr, p.lambda, p.sigma, p.sMin])
  return owner.range()
}

/**
 * 给定距离 R 时的接收回波功率 Pr (W)（单程往返自由空间雷达方程）：
 * Pr = Pt Gt Gr λ² σ / ((4π)³ R⁴)
 */
export function radarReceivedPower(p: Omit<RadarRangeParams, 'sMin'>, rangeM: number): number {
  const owner = new WasmRadarMath()
  owner.params.set([p.pt, p.gt, p.gr, p.lambda, p.sigma, 0])
  return owner.power(rangeM)
}

/** 由频率求波长 λ = c/f。 */
export function radarWavelength(freqHz: number): number {
  return new WasmRadarMath().wavelength(freqHz)
}

/**
 * 距离加倍时回波功率比：Pr(2R)/Pr(R) = 1/16（−12 dB）。
 */
export function radarPowerRatioDoubleRange(): number {
  return new WasmRadarMath().doubleRatio()
}

/**
 * 代表样例：X 波段 10 GHz，Pt=1 kW，G=30 dBi，σ=1 m²，Smin=1e-12 W。
 * 校验 Pr(R_max) = Smin 闭合，以及 R×2 → Pr/16。
 */
export function runRadarRangeSample(): {
  freqHz: number
  lambda: number
  pt: number
  gLin: number
  sigma: number
  sMin: number
  rMax: number
  prAtRmax: number
  prAtHalf: number
  prAtDouble: number
  ratioDouble: number
  methodId: typeof RADAR_RANGE_METHOD_ID
} {
  const freqHz = 10e9 // X-band
  const lambda = radarWavelength(freqHz)
  const pt = 1000 // W
  const gDb = 30
  const gLin = 10 ** (gDb / 10)
  const sigma = 1 // m²
  const sMin = 1e-12 // W
  const params: RadarRangeParams = {
    pt,
    gt: gLin,
    gr: gLin,
    lambda,
    sigma,
    sMin,
  }
  const rMax = radarMaxRange(params)
  const base = { pt, gt: gLin, gr: gLin, lambda, sigma }
  const prAtRmax = radarReceivedPower(base, rMax)
  const prAtHalf = radarReceivedPower(base, rMax / 2)
  const prAtDouble = radarReceivedPower(base, rMax * 2)
  return {
    freqHz,
    lambda,
    pt,
    gLin,
    sigma,
    sMin,
    rMax,
    prAtRmax,
    prAtHalf,
    prAtDouble,
    ratioDouble: prAtDouble / prAtRmax,
    methodId: RADAR_RANGE_METHOD_ID,
  }
}

// TMz FDTD teaching scene shared by the scope page and the Agent. The kernel
// runs the Yee leapfrog at Courant number 0.5, so c = 0.5 cells/step and a
// target at distance d echoes after 2d/0.5 = 4d steps.
export const RADAR_N = 200, RADAR_BUFFER = 256, RADAR_SAMPLE_STRIDE = 2
/** Wave speed in reduced units (cells per step), for echo-delay bookkeeping. */
export const RADAR_CELLS_PER_STEP = 0.5
export const RADAR_TX = { x: 24, y: RADAR_N / 2 }
export const RADAR_TARGETS = [
  { x0: 120, y0: 30, x1: 128, y1: 170, epsR: 4, pec: false, label: '墙', labelEn: 'Wall' },
  { x0: 150, y0: 50, x1: 162, y1: 66, epsR: 12, pec: false, label: '硅靶', labelEn: 'Si target' },
  { x0: 158, y0: 130, x1: 174, y1: 150, epsR: Infinity, pec: true, label: '金属电器', labelEn: 'Metal appliance' },
]
export type RadarProbe = { x: number; y: number } | null
export interface RadarScene { mode: 'pulse' | 'cw'; steps: number; probes: RadarProbe[] }

/** Renderer-only geometry, also usable for saved results when WASM is unavailable. */
export function radarObstacleMask(): Uint8Array {
  const mask = new Uint8Array(RADAR_N * RADAR_N)
  for (const t of RADAR_TARGETS) for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) mask[x + y * RADAR_N] = 1
  return mask
}
/**
 * Threshold detection on an actual Ez probe trace: contiguous runs where |Ez|
 * exceeds `thresholdFraction` of the trace peak, returned as the step index of
 * each run's maximum. These are real detected echoes (direct-path leakage
 * included), not a synthetic surrogate.
 */
export function radarEchoPeaks(trace: number[], thresholdFraction = 0.2): number[] {
  const peak = trace.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (!(peak > 0)) return []
  const limit = thresholdFraction * peak
  const peaks: number[] = []
  let runPeak = 0, runAt = -1
  const flush = () => { if (runAt >= 0) peaks.push(runAt); runAt = -1; runPeak = 0 }
  trace.forEach((v, i) => {
    const a = Math.abs(v)
    if (a > limit) { if (a > runPeak) { runPeak = a; runAt = i } } else flush()
  })
  flush()
  return peaks
}
/** Rendering and job serialization read the shared core's final buffers. */
export function radarResult(owner: WasmRadar) {
  return { nx: RADAR_N, steps: owner.completed, sampleStride: RADAR_SAMPLE_STRIDE,
    field: Array.from(owner.field), traces: owner.traces, readout: owner.readout() }
}
