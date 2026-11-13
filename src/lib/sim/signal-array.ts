import { WasmSignalArray } from './wasm-fields'

/** Static calibrated response: sensor volts = sensing × input + bias. */
export interface SignalArrayScene {
  rows: number
  cols: number
  unit: string
  input: number[]
  sensing: number[][]
  bias: number[]
  encoding: { kind: 'direct' | 'hadamard' } | { kind: 'custom'; matrix: number[][] }
  noisePeakV: number
  seed: number
  regularization: number
  /** One shared RC node, sampled after each code row; input is held for the entire scan. */
  readout?: { resistanceOhm: number; capacitanceF: number; dwellS: number; initialV: number }
}
export interface SignalArrayResult {
  encoding: number[][]
  sensorV: number[]
  measuredV: number[]
  reconstructed: number[] | null
  error: number[] | null
  rank: number
  rankTolerance: number
  status: 'solved' | 'regularized' | 'rank-deficient'
  rmse: number | null
  residualRmsV: number | null
  /** Absent on saved results created before RC readout support. */
  idealV?: number[]
  sampledV?: number[]
  settlingFraction?: number
  readoutTauS?: number
}

/** Editable example data, not a fixed material or a mechanical constitutive model. */
export function signalArrayExample(rowColumn = false): SignalArrayScene {
  return { rows: 4, cols: 4, unit: 'a.u.',
    input: [0, 0, 0, 0, 0, 1, 0.5, 0, 0, 0.5, 1, 0, 0, 0, 0, 0],
    sensing: Array.from({ length: 16 }, (_, i) => Array.from({ length: 16 }, (_, j) => i === j ? 1 : 0)),
    bias: Array(16).fill(0), encoding: rowColumn ? { kind: 'custom', matrix:
      Array.from({ length: 8 }, (_, channel) => Array.from({ length: 16 }, (_, cell) =>
        (channel < 4 ? Math.floor(cell / 4) === channel : cell % 4 === channel - 4) ? 1 : 0)) }
      : { kind: 'hadamard' }, noisePeakV: 0, seed: 1, regularization: 0 }
}

export function signalArrayMeasurements(scene: SignalArrayScene) {
  return scene.encoding.kind === 'custom' ? scene.encoding.matrix.length : scene.sensing.length
}

export function signalArrayResult(scene: SignalArrayScene, owner = new WasmSignalArray()): SignalArrayResult {
  return owner.solve(scene)
}
