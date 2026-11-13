// Shared Rust 2D periodic Ising kernel: exact i8 spins/u32 PRNG, f64 arithmetic.
import { instantiateWasmKernel, type WasmKernelExports } from '@w-sim/solvers-lbm/d3q19'

function check(status: number) {
  if (status !== 0) throw new Error(`Rust Ising kernel rejected the input or numerical state (${status})`)
}
function scalarKernel() {
  const kernel = instantiateWasmKernel(), offset = kernel.memory.grow(1) * 65536
  return { kernel, offset, values: new Float64Array(kernel.memory.buffer, offset, 2) }
}

/** Batch reference evaluation shares one temporary memory owner for charts/validation. */
export function onsagerReferences(temperatures: readonly number[]): number[] {
  const scalar = scalarKernel()
  return temperatures.map(T => {
    check(scalar.kernel.ising_reference(T, scalar.offset))
    return scalar.values[1]
  })
}
export function onsagerTc(): number {
  const scalar = scalarKernel()
  check(scalar.kernel.ising_reference(1, scalar.offset))
  return scalar.values[0]
}
export function onsagerMagnetization(T: number): number { return onsagerReferences([T])[0] }

export type IsingPoint = {
  temperature: number; samples: number; meanM: number | null; meanAbsM: number | null
  meanEnergy: number | null; specificHeat: number | null; susceptibility: number | null; reference: number
}

/** Each state owns its spins, random stream and moments; stepping never copies the lattice. */
export class IsingState {
  readonly N: number
  readonly spins: Int8Array
  readonly kernel: WasmKernelExports
  private readonly config: number
  private readonly random: number
  private readonly moments: number
  private readonly view: DataView
  private readonly stats: Float64Array
  constructor(readonly L: number, public T: number, seed: number, hot: boolean) {
    if (!Number.isInteger(L) || L < 2 || L > 1024) throw new Error('Invalid or oversized Ising lattice')
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || typeof hot !== 'boolean') throw new Error('Invalid Ising initial state')
    this.N = L * L
    this.kernel = instantiateWasmKernel()
    this.config = this.kernel.memory.grow(Math.ceil((152 + this.N) / 65536)) * 65536
    this.random = this.config + 16; this.moments = this.config + 24
    this.view = new DataView(this.kernel.memory.buffer, this.config, 16)
    this.stats = new Float64Array(this.kernel.memory.buffer, this.config + 72, 10)
    this.spins = new Int8Array(this.kernel.memory.buffer, this.config + 152, this.N)
    this.configure()
    check(this.kernel.ising_init(this.config, this.spins.byteOffset, this.random, seed, Number(hot)))
  }
  private configure() {
    this.view.setUint32(0, this.L, true); this.view.setFloat64(8, this.T, true)
  }
  readonly rand = (): number => {
    check(this.kernel.ising_next(this.random, this.stats.byteOffset))
    return this.stats[0]
  }
  sweep(algorithm: 0 | 1, sample = false, reset = false) {
    this.configure()
    check(this.kernel.ising_sweep(this.config, this.spins.byteOffset, this.random, this.moments, algorithm, Number(sample), Number(reset)))
  }
  delta(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.N) throw new Error('Invalid Ising spin index')
    this.configure()
    check(this.kernel.ising_delta(this.config, this.spins.byteOffset, index, this.stats.byteOffset))
    return this.stats[0]
  }
  read() {
    this.configure()
    check(this.kernel.ising_read(this.config, this.spins.byteOffset, this.moments, this.stats.byteOffset))
    const samples = this.stats[2]
    const current: IsingPoint = { temperature: this.T, samples,
      meanM: samples ? this.stats[3] : null, meanAbsM: samples ? this.stats[4] : null,
      meanEnergy: samples ? this.stats[5] : null, specificHeat: samples > 1 ? this.stats[6] : null,
      susceptibility: samples > 1 ? this.stats[7] : null, reference: this.stats[8] }
    return { magnetization: this.stats[0], energy: this.stats[1], current }
  }
}

export function initIsing(L: number, T: number, seed = 1, hot = true): IsingState { return new IsingState(L, T, seed, hot) }
export function deltaE(st: IsingState, idx: number): number { return st.delta(idx) }
export function metropolisSweep(st: IsingState): void { st.sweep(0) }
export function heatbathSweep(st: IsingState): void { st.sweep(1) }
export function magnetization(st: IsingState): number { return st.read().magnetization }
export function energyPerSpin(st: IsingState): number { return st.read().energy }

function fluctuation(mean: number, mean2: number, N: number, T: number, kind: 0 | 1): number {
  if (!Number.isInteger(N) || N < 1 || N > 0xffffffff) throw new Error('Invalid Ising spin count')
  const scalar = scalarKernel()
  check(scalar.kernel.ising_fluctuation(mean, mean2, N, T, kind, scalar.offset))
  return scalar.values[0]
}
export function specificHeat(meanE: number, meanE2: number, N: number, T: number): number { return fluctuation(meanE, meanE2, N, T, 0) }
export function susceptibility(meanM: number, meanM2: number, N: number, T: number): number { return fluctuation(meanM, meanM2, N, T, 1) }

export type IsingScene = {
  size: number; temperatures: number[]; seed: number; hot: boolean
  burnIn: number; samples: number
}
export const isingSceneSteps = (scene: IsingScene) => scene.temperatures.length * (scene.burnIn + scene.samples)
export type IsingExperiment = { state: IsingState; steps: number; points: IsingPoint[] }

export function createIsingScene(scene: IsingScene): IsingExperiment {
  return { state: initIsing(scene.size, scene.temperatures[0], scene.seed, scene.hot), steps: 0, points: [] }
}

/** Temperature scheduling is product glue; Rust performs the sweep and moment update. */
export function stepIsingScene(run: IsingExperiment, scene: IsingScene): void {
  if (run.steps >= isingSceneSteps(scene)) throw new Error('Ising scene is already complete')
  const period = scene.burnIn + scene.samples, phase = run.steps % period
  run.state.T = scene.temperatures[Math.floor(run.steps / period)]
  run.state.sweep(0, phase >= scene.burnIn, phase === 0)
  run.steps++
  if (phase === period - 1) run.points.push(run.state.read().current)
}

export function isingResult(run: IsingExperiment) {
  return { size: run.state.L, steps: run.steps, spins: Array.from(run.state.spins),
    ...run.state.read(), points: run.points.slice() }
}
