import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { parseTouchstone } from './touchstone'
import { readTouchstoneVswrResult } from './touchstone-vswr'

const network = parseTouchstone(
  '! simple measured-like test fixture (not vendor data)\n' +
  '# GHz S RI R 50\n' +
  '1 0 0 0.8 0 0.8 0 0.1 0\n' +
  '2 0.2 0 0.7 0 0.7 0 0.1 0\n' +
  '3 0 0.5 0.6 0 0.6 0 0.1 0\n',
  'fixture.s2p',
)

const points = [
  { frequencyHz: 1e9, s11: [0, 0], magnitude: 0, vswr: 1, returnLossDb: null, reflectedPowerFraction: 0 },
  { frequencyHz: 2e9, s11: [0.2, 0], magnitude: 0.2, vswr: 1.5, returnLossDb: 13.979400086720375, reflectedPowerFraction: 0.04 },
  { frequencyHz: 3e9, s11: [0, 0.5], magnitude: 0.5, vswr: 3, returnLossDb: 6.020599913279624, reflectedPowerFraction: 0.25 },
]

// Match the native wrapper payload exactly: moduleResult contains module,
// operation, backend provenance, and the operation's result object.
const nativeResult = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'vswr',
    operation: 'cst-s11-vswr-sweep',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
    result: {
      sampleCount: points.length,
      points,
      maxVswr: 3,
      meanReflectedPowerFraction: 0.09666666666666666,
      ...overrides,
    },
  },
})

const read = (result: unknown = nativeResult(), submitted = network) =>
  readTouchstoneVswrResult(result as JobResultV1, submitted)

describe('Touchstone VSWR result adapter', () => {
  it('maps the actual native wrapper response and preserves native provenance', () => {
    expect(read()).toEqual({
      points: [
        { ...points[0], s11: [0, 0] },
        { ...points[1], s11: [0.2, 0] },
        { ...points[2], s11: [0, 0.5] },
      ],
      maxVswr: 3,
      meanReflectedPowerFraction: 0.09666666666666666,
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
    })
  })

  it('rejects mismatched module, operation, or native backend provenance', () => {
    const base = nativeResult()
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, module: 'other' } })).toThrow(/module/)
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, operation: 'vswr-teaching' } })).toThrow(/operation/)
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, backend: { id: 'w-sim-cuda-host', kind: 'cuda-f64' } } })).toThrow(/backend/)
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, backend: { id: 'host-f64', kind: 'host-f64' } } })).toThrow(/backend/)
  })

  it('rejects a sample count or point dimension that differs from the submitted network', () => {
    expect(() => read(nativeResult({ sampleCount: 2 }))).toThrow(/sample count/)
    expect(() => read(nativeResult({ points: points.slice(0, 2) }))).toThrow(/point dimensions/)
    expect(() => read(nativeResult({ points: [...points, points[2]] }))).toThrow(/point dimensions/)
  })

  it('requires each returned coordinate and S11 pair to match the submitted Touchstone point', () => {
    expect(() => read(nativeResult({ points: [{ ...points[0], frequencyHz: 1.1e9 }, ...points.slice(1)] }))).toThrow(/frequency.*match/)
    expect(() => read(nativeResult({ points: [{ ...points[0], s11: [0.01, 0] }, ...points.slice(1)] }))).toThrow(/S11.*match/)
    expect(() => read(nativeResult({ points: [{ ...points[0], s11: [0] }, ...points.slice(1)] }))).toThrow(/dimensions/)
  })

  it('rejects non-finite and physically inconsistent metrics', () => {
    expect(() => read(nativeResult({ points: [{ ...points[0], magnitude: Number.NaN }, ...points.slice(1)] }))).toThrow(/finite/)
    expect(() => read(nativeResult({ points: [{ ...points[1], vswr: Number.POSITIVE_INFINITY }, points[0], points[2]] }))).toThrow(/finite/)
    expect(() => read(nativeResult({ points: [{ ...points[1], reflectedPowerFraction: 1.1 }, points[0], points[2]] }))).toThrow(/range|finite/)
    expect(() => read(nativeResult({ points: [{ ...points[1], returnLossDb: null }, points[0], points[2]] }))).toThrow(/finite|return loss/)
    expect(() => read(nativeResult({ maxVswr: Number.NaN }))).toThrow(/finite/)
    expect(() => read(nativeResult({ meanReflectedPowerFraction: -0.1 }))).toThrow(/range|finite/)
  })

  it('accepts null return loss only for an ideal match', () => {
    expect(read().points[0].returnLossDb).toBeNull()
    expect(() => read(nativeResult({ points: [{ ...points[0], returnLossDb: 0 }, ...points.slice(1)] }))).toThrow(/null.*ideal match|ideal match/)
    expect(() => read(nativeResult({ points: [{ ...points[1], returnLossDb: null }, points[0], points[2]] }))).toThrow(/finite|return loss/)
  })

  it('rejects a submitted network whose S11 identity differs from the analyzed result', () => {
    const changed = structuredClone(network)
    changed.points[1].s[0] = [0.3, 0]
    expect(() => read(nativeResult(), changed)).toThrow(/S11.*match/)
  })
})
