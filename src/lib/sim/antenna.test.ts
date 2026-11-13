import { describe, it, expect } from 'vitest'
import { WasmAntenna } from './wasm-fields'
import { antennaLinkResult } from './antennalink'
import { phasedArrayResult } from './phasedarray'
import {
  dipoleFieldPattern,
  dipolePowerPattern,
  freeSpacePathLoss,
  friisReceivedDbm,
  polarizationLoss,
  antenna3DResult,
} from './antenna'

describe('半波偶极子方向图', () => {
  it('θ=π/2（垂直于天线轴）处取最大值 1', () => {
    expect(dipolePowerPattern(Math.PI / 2)).toBeCloseTo(1, 9)
    expect(dipoleFieldPattern(Math.PI / 2)).toBeCloseTo(1, 9)
  })

  it('θ→0 与 θ→π（沿天线轴）功率趋于 0', () => {
    expect(dipolePowerPattern(0)).toBeCloseTo(0, 9)
    expect(dipolePowerPattern(Math.PI)).toBeCloseTo(0, 9)
    expect(dipolePowerPattern(0.01)).toBeLessThan(1e-3)
  })

  it('功率方向图在 0..1 之间，且 θ=π/2 为全局最大', () => {
    const run = new WasmAntenna('antenna3d'), peak = dipolePowerPattern(Math.PI / 2, run)
    for (let i = 1; i < 180; i++) {
      const p = dipolePowerPattern((i * Math.PI) / 180, run)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(peak + 1e-9)
    }
  })
})

describe('shared antenna memory and result semantics', () => {
  it('reuses WASM outputs while preserving previously returned snapshots', () => {
    const link = new WasmAntenna('antennapattern'), dipole = new WasmAntenna('antenna3d'), array = new WasmAntenna('phasedarray')
    const cases = [
      { run: link, sample: (changed: boolean) => antennaLinkResult({ type: changed ? 'directional' : 'isotropic', ptDbm: 20, gtDbi: 6, grDbi: 6, frequencyHz: 2.4e9, distM: 100 }, link) },
      { run: dipole, sample: (changed: boolean) => antenna3DResult({ frequencyHz: 2.4e9, ptDbm: 20, distM: 8, elevationDeg: 90, polarizationDeg: changed ? 90 : 0 }, dipole) },
      { run: array, sample: (changed: boolean) => phasedArrayResult({ n: 12, dOverLambda: changed ? 1 : 0.5, steerDeg: changed ? 80 : 20 }, array) },
    ]
    for (const { run, sample } of cases) {
      const before = sample(false), saved = structuredClone(before), pattern = run.pattern, memory = pattern.buffer
      const after = sample(true)
      expect(run.pattern).toBe(pattern); expect(run.pattern.buffer).toBe(memory)
      expect(after).not.toEqual(before); expect(before).toEqual(saved)
    }
  })
  it('represents ideal zero power with null and rejects invalid numerical inputs', () => {
    const params = { frequencyHz: 2.4e9, ptDbm: 20, distM: 8, elevationDeg: 90, polarizationDeg: 0 }
    expect(antenna3DResult({ ...params, polarizationDeg: 90 }).prDbm).toBeNull()
    expect(antenna3DResult({ ...params, elevationDeg: 0 }).prDbm).toBeNull()
    expect(() => antenna3DResult({ ...params, frequencyHz: NaN })).toThrow()
    expect(() => freeSpacePathLoss(Infinity, 1)).toThrow()
    expect(() => phasedArrayResult({ n: 49, dOverLambda: 0.5, steerDeg: 0 })).toThrow()
    expect(() => phasedArrayResult({ n: 2.5, dOverLambda: 0.5, steerDeg: 0 })).toThrow()
  })
})

describe('自由空间路径损耗 FSPL', () => {
  it('距离 ×10 → 损耗 +20 dB', () => {
    const a = freeSpacePathLoss(1e9, 100)
    const b = freeSpacePathLoss(1e9, 1000)
    expect(b - a).toBeCloseTo(20, 6)
  })

  it('频率 ×10 → 损耗 +20 dB', () => {
    const a = freeSpacePathLoss(1e9, 500)
    const b = freeSpacePathLoss(1e10, 500)
    expect(b - a).toBeCloseTo(20, 6)
  })

  it('随距离单调增大', () => {
    let prev = -Infinity
    for (const d of [1, 10, 100, 1000, 10000]) {
      const v = freeSpacePathLoss(2.4e9, d)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })
})

describe('Friis 接收功率', () => {
  it('随距离单调下降', () => {
    let prev = Infinity
    for (const d of [1, 10, 100, 1000]) {
      const v = friisReceivedDbm(20, 2, 2, 2.4e9, d)
      expect(v).toBeLessThan(prev)
      prev = v
    }
  })

  it('Pr = Pt + Gt + Gr − FSPL（与闭式一致）', () => {
    const f = 900e6, d = 1000
    const expected = 30 + 5 + 3 - freeSpacePathLoss(f, d)
    expect(friisReceivedDbm(30, 5, 3, f, d)).toBeCloseTo(expected, 9)
  })
})

describe('极化失配损耗', () => {
  it('对齐(0)=1，正交(π/2)=0', () => {
    expect(polarizationLoss(0)).toBeCloseTo(1, 9)
    expect(polarizationLoss(Math.PI / 2)).toBeCloseTo(0, 9)
  })

  it('45° 失配 → 0.5（半功率）', () => {
    expect(polarizationLoss(Math.PI / 4)).toBeCloseTo(0.5, 9)
  })
})
