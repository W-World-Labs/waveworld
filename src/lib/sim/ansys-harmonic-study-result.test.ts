import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import type { AnsysHarmonicStudyInput } from './ansys-harmonic-study-input'
import { parseAnsysHarmonicNativeOutput, parseAnsysHarmonicStudyResult } from './ansys-harmonic-study-result'

const sdofInput: AnsysHarmonicStudyInput = {
  module: 'sw-ansys-harmonic-response', backend: 'host', system: 'sdof', mass: 2, stiffness: 200,
  dampingRatio: 0.05, force: 3, freqs: [0, 5, 10], freqUnit: 'hz',
}

const modalInput: AnsysHarmonicStudyInput = {
  module: 'sw-ansys-harmonic-response', backend: 'host', system: 'modal',
  modes: [
    { frequencyHz: 5, shape: [1, 0], dampingRatio: 0.05 },
    { frequencyHz: 10, shape: [0, 1] },
  ],
  force: [1, 0], dampingRatio: 0.1, freqs: [0, 5, 10], freqUnit: 'hz',
}

const sdofNative = (overrides: Record<string, unknown> = {}) => ({
  module: 'sw-ansys-harmonic-response', familyId: 'method-ansys-harmonic-response', methodId: 'method-mode-superposition',
  backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' }, method: 'mode-superposition', system: 'sdof',
  freqUnit: 'hz', nDof: 1, nModes: 1, excitation: 'force', dofs: [0], nPoints: 3, modes: null,
  sdof: {
    mass: 2, stiffness: 200, dampingCoefficient: 2, dampingRatio: 0.05,
    naturalFrequencyHz: 1.5915494309189535, naturalFrequencyRads: 10, staticResponse: 0.015,
  },
  sweep: [
    { freqHz: 0, freqRads: 0, response: [{ re: 0.015, im: 0 }], amplitude: [0.015], phaseDeg: [0] },
    { freqHz: 5, freqRads: 31.41592653589793, response: [{ re: 0.01, im: -0.02 }], amplitude: [0.022360679775], phaseDeg: [-63.43494882] },
    { freqHz: 10, freqRads: 62.83185307179586, response: [{ re: -0.005, im: -0.01 }], amplitude: [0.0111803398875], phaseDeg: [-116.56505118] },
  ],
  peak: { amplitude: [0.022360679775], frequencyHz: [5] }, ok: true,
  ...overrides,
})

const modalNative = (overrides: Record<string, unknown> = {}) => ({
  module: 'sw-ansys-harmonic-response', familyId: 'method-ansys-harmonic-response', methodId: 'method-mode-superposition',
  backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' }, method: 'mode-superposition', system: 'modal',
  freqUnit: 'hz', nDof: 2, nModes: 2, excitation: 'force', dofs: [0, 1], nPoints: 3,
  modes: [
    { frequencyHz: 5, frequencyRads: 31.41592653589793, dampingRatio: 0.05, participationFactor: null },
    { frequencyHz: 10, frequencyRads: 62.83185307179586, dampingRatio: 0.1, participationFactor: null },
  ],
  sdof: null,
  sweep: [
    { freqHz: 0, freqRads: 0, response: [{ re: 0.1, im: 0 }, { re: 0.05, im: 0 }], amplitude: [0.1, 0.05], phaseDeg: [0, 0] },
    { freqHz: 5, freqRads: 31.41592653589793, response: [{ re: 0.2, im: -0.1 }, { re: 0.1, im: -0.05 }], amplitude: [0.22360679775, 0.111803398875], phaseDeg: [-26.565, -26.565] },
    { freqHz: 10, freqRads: 62.83185307179586, response: [{ re: 0.05, im: -0.01 }, { re: 0.3, im: -0.2 }], amplitude: [0.050990195136, 0.360555127546], phaseDeg: [-11.31, -33.69] },
  ],
  peak: { amplitude: [0.22360679775, 0.360555127546], frequencyHz: [5, 10] }, ok: true,
  ...overrides,
})

const envelope = (payload: unknown): JobResultV1 => ({
  schemaVersion: 1, status: 'succeeded', summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'w-sim-cuda' }, moduleResult: payload,
} as JobResultV1)

describe('ANSYS harmonic response result parser', () => {
  it('accepts a Host SDOF result and preserves native per-DOF arrays', () => {
    const parsed = parseAnsysHarmonicStudyResult(envelope(sdofNative()), sdofInput)
    expect(parsed.familyId).toBe('method-ansys-harmonic-response')
    expect(parsed.backend).toMatchObject({ id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' })
    expect(parsed.sweep[1]).toMatchObject({ response: [{ re: 0.01, im: -0.02 }], amplitude: [0.022360679775] })
    expect(parsed.peak).toEqual({ amplitude: [0.022360679775], frequencyHz: [5] })
  })

  it('accepts modal output and validates returned mode metadata and dimensions', () => {
    const parsed = parseAnsysHarmonicNativeOutput(modalNative(), modalInput)
    expect(parsed.system).toBe('modal')
    expect(parsed.nDof).toBe(2)
    expect(parsed.modes).toEqual(modalNative().modes)
    expect(parsed.sweep[2].amplitude).toEqual([0.050990195136, 0.360555127546])
  })

  it('normalizes no damping and coefficient damping metadata for SDOF studies', () => {
    const undampedInput = { ...sdofInput, dampingRatio: undefined }
    const undamped = { ...sdofNative(), sdof: { ...sdofNative().sdof, dampingCoefficient: 0, dampingRatio: 0 } }
    expect(parseAnsysHarmonicNativeOutput(undamped, undampedInput).sdof?.dampingRatio).toBe(0)
    const coefficientInput = { ...sdofInput, dampingRatio: undefined, damping: 2 }
    expect(parseAnsysHarmonicNativeOutput(sdofNative(), coefficientInput).sdof?.dampingCoefficient).toBe(2)
  })

  it('rejects mismatched identity, backend, excitation, and damping metadata', () => {
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ module: 'other' }), sdofInput)).toThrow(/identity/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ backend: { id: 'native-cuda', kind: 'gpu', deviceName: 'GPU' } }), sdofInput)).toThrow(/backend provenance/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ excitation: 'base-acceleration' }), sdofInput)).toThrow(/identity/)
    expect(() => parseAnsysHarmonicNativeOutput({ ...sdofNative(), sdof: { ...sdofNative().sdof, dampingRatio: 0.1 } }, sdofInput)).toThrow(/damping ratio/)
    expect(() => parseAnsysHarmonicNativeOutput(modalNative({ modes: [{ ...modalNative().modes[0], dampingRatio: 0.2 }, modalNative().modes[1]] }), modalInput)).toThrow(/damping metadata/)
  })

  it('rejects unknown or missing native keys and invalid result dimensions', () => {
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ extra: 1 }), sdofInput)).toThrow(/unknown or missing/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ sdof: undefined }), sdofInput)).toThrow(/must be an object/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ nDof: 2 }), sdofInput)).toThrow(/dimensions/)
    expect(() => parseAnsysHarmonicNativeOutput(modalNative({ dofs: [0] }), modalInput)).toThrow(/exactly 2/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ nPoints: 2 }), sdofInput)).toThrow(/point count/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ modes: [] }), sdofInput)).toThrow(/null modal metadata/)
  })

  it('rejects malformed frequency rows, response dimensions, and non-finite values', () => {
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ sweep: [] }), sdofInput)).toThrow(/sweep dimensions/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ sweep: [sdofNative().sweep[0], { ...sdofNative().sweep[1], freqHz: 6 }, sdofNative().sweep[2]] }), sdofInput)).toThrow(/frequency grid/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ sweep: [sdofNative().sweep[0], { ...sdofNative().sweep[1], amplitude: [Number.NaN] }, sdofNative().sweep[2]] }), sdofInput)).toThrow(/finite/)
    expect(() => parseAnsysHarmonicNativeOutput(modalNative({ sweep: [modalNative().sweep[0], { ...modalNative().sweep[1], response: [{ re: 1, im: 0 }] }, modalNative().sweep[2]] }), modalInput)).toThrow(/selected DOFs/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ sweep: [sdofNative().sweep[0], { ...sdofNative().sweep[1], response: [{ re: 1, im: Number.POSITIVE_INFINITY }] }, sdofNative().sweep[2]] }), sdofInput)).toThrow(/finite/)
  })

  it('requires per-DOF peak vectors to match the returned sweep maxima', () => {
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ peak: { amplitude: [0.01], frequencyHz: [0] } }), sdofInput)).toThrow(/peak amplitude/)
    expect(() => parseAnsysHarmonicNativeOutput(sdofNative({ peak: { amplitude: [0.022360679775], frequencyHz: [0] } }), sdofInput)).toThrow(/peak frequency/)
    expect(() => parseAnsysHarmonicNativeOutput(modalNative({ peak: { amplitude: [0.22360679775], frequencyHz: [5] } }), modalInput)).toThrow(/exactly 2/)
  })
})
