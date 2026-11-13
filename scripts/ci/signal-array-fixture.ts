import type { SignalArrayScene } from '../../src/lib/sim/signal-array'

export function signalArrayScene(): SignalArrayScene {
  return { rows: 1, cols: 2, unit: 'kPa', input: [3, -2],
    sensing: [[2, 1], [1, -1]], bias: [0.5, -0.25],
    encoding: { kind: 'direct' }, noisePeakV: 0, seed: 7, regularization: 0 }
}
export const signalArrayInputs = [
  signalArrayScene(),
  { ...signalArrayScene(), encoding: { kind: 'hadamard' as const } },
  { ...signalArrayScene(), encoding: { kind: 'custom' as const, matrix: [[1, 0], [0, 1], [1, -1]] }, noisePeakV: 0.01 },
  { ...signalArrayScene(), encoding: { kind: 'custom' as const, matrix: [[1, 1]] } },
  { ...signalArrayScene(), encoding: { kind: 'custom' as const, matrix: [[1, 1]] }, regularization: 0.25 },
].map(scene => ({ module: 'signal-array' as const, scene }))

export const invalidSignalArrays = [
  { rows: 0 }, { cols: 65 }, { input: [1] }, { input: [1, null] }, { unit: ' ' },
  { sensing: [] }, { sensing: [[1, 0], [1]] }, { bias: [0] }, { seed: 4294967296 },
  { encoding: { kind: ['direct'] } }, { encoding: { kind: 'custom', matrix: [[1]] } },
  { sensing: [[1, 0], [0, 1], [1, 1]], bias: [0, 0, 0], encoding: { kind: 'hadamard' } },
  { regularization: -1 }, { noisePeakV: '0' },
  { readout: null }, { readout: {} },
  ...[
    { resistanceOhm: 0 }, { capacitanceF: 0 }, { dwellS: 0 }, { initialV: NaN },
    { resistanceOhm: 1e13 }, { capacitanceF: 2 }, { dwellS: 1001 }, { initialV: 1e7 },
  ].map(change => ({ readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-4, initialV: 0, ...change } })),
]

export const signalArrayRcInputs = [
  { ...signalArrayScene(), readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-6, initialV: 0.5 } },
  { ...signalArrayInputs[2].scene, readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-4, initialV: -2 } },
  { ...signalArrayInputs[3].scene, readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-5, initialV: 0 } },
  { ...signalArrayInputs[4].scene, readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-5, initialV: 0 } },
].map(scene => ({ module: 'signal-array' as const, scene }))
