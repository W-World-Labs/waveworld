import { instantiateWasmKernel, type WasmKernelExports as KernelExports, type PreparedProductLbm } from '@w-sim/solvers-lbm/d3q19'
import type { MdFrame, MdHistory } from './md'
import type { BarostatParams } from './barostat'
import type { ScreeningParams } from './interactions'
import type { LaserParams, LaserState } from './laser'
import type { RadarScene } from './radar-algos'
import type { SignalArrayScene, SignalArrayResult } from './signal-array'
import type { RcParams, TransientScene } from './transient'
import type { FaradayScene } from './faraday'

function instantiateKernel(): KernelExports {
  try {
    return instantiateWasmKernel()
  } catch {
    throw new Error('此环境无法运行 WASM 计算内核，请启用 WebAssembly 或使用后端计算')
  }
}

function check(status: number) {
  if (status !== 0) {
    const reasons = ['', 'invalid dimensions', 'invalid memory or buffer length', 'invalid coefficient',
      'non-finite field', 'invalid density or velocity', 'unsupported physics', 'unsupported ABI',
      'optics trace exceeded 20000 processed rays; reduce lasers or splitters']
    throw new Error(`Simulation stopped: ${reasons[status] ?? 'W-Sim kernel rejected the state'}`)
  }
}

function seedArguments(x: number, y: number, radius: number) {
  if (![x, y, radius].every(Number.isSafeInteger) || x < -2147483648 || x > 2147483647 ||
      y < -2147483648 || y > 2147483647 || radius < 0 || radius > 0xffffffff) throw new Error('Invalid seed coordinates')
}

/** One reusable RC/RL snapshot, scalar helpers and first-order integration state. */
export class WasmTransient {
  private readonly kernel = instantiateKernel()
  private readonly config: DataView
  private readonly firstOrder: Float64Array
  private readonly values: Float64Array
  private readonly readout: Float64Array
  private readonly state: Float64Array
  constructor() {
    const base = this.kernel.memory.grow(1) * 65536, memory = this.kernel.memory.buffer
    this.config = new DataView(memory, base, 40)
    this.firstOrder = new Float64Array(memory, base + 40, 4)
    this.values = new Float64Array(memory, base + 72, 241)
    this.readout = new Float64Array(memory, base + 2000, 3)
    this.state = new Float64Array(memory, base + 2024, 1)
  }
  tauRC(r: number, c: number) {
    check(this.kernel.transient_tau_rc(r, c, this.readout.byteOffset)); return this.readout[0]
  }
  tauRL(l: number, r: number) {
    check(this.kernel.transient_tau_rl(l, r, this.readout.byteOffset)); return this.readout[0]
  }
  charge(t: number, v: number, r: number, c: number) {
    check(this.kernel.transient_charge(t, v, r, c, this.readout.byteOffset)); return this.readout[0]
  }
  discharge(t: number, v: number, r: number, c: number) {
    check(this.kernel.transient_discharge(t, v, r, c, this.readout.byteOffset)); return this.readout[0]
  }
  current(t: number, v: number, r: number, l: number) {
    check(this.kernel.transient_current(t, v, r, l, this.readout.byteOffset)); return this.readout[0]
  }
  step(voltage: number, p: RcParams, dt: number) {
    this.firstOrder.set([p.V, p.R, p.C, dt]); this.state[0] = voltage
    check(this.kernel.transient_step(this.firstOrder.byteOffset, this.state.byteOffset)); return this.state[0]
  }
  solve(scene: TransientScene) {
    const mode = ['rc-charge', 'rc-discharge', 'rl'].indexOf(scene.mode)
    if (mode < 0) throw new Error('Invalid transient mode')
    this.config.setUint32(0, mode, true); this.config.setUint32(4, 0, true)
    ;[scene.v0, scene.r, scene.c, scene.l].forEach((v, i) => this.config.setFloat64(8 + i * 8, v, true))
    check(this.kernel.transient_result(this.config.byteOffset, this.values.byteOffset, this.readout.byteOffset))
    return { values: Array.from(this.values), tau: this.readout[0], yMax: this.readout[1], steady: this.readout[2], unit: mode === 2 ? 'A' as const : 'V' as const }
  }
}

/** Reusable induction curves and scalar readouts. Size series capacity at construction. */
export class WasmFaraday {
  private readonly kernel = instantiateKernel()
  private readonly config: Float64Array
  private readonly flux: Float64Array
  private readonly emf: Float64Array
  private readonly readout: Float64Array
  constructor(seriesCapacity = 361) {
    const count = Math.max(361, seriesCapacity)
    if (!Number.isSafeInteger(count) || count > 0xffffffff) throw new Error('Invalid flux series length')
    const base = this.kernel.memory.grow(Math.ceil((96 + count * 16) / 65536)) * 65536
    const memory = this.kernel.memory.buffer
    this.config = new Float64Array(memory, base, 7)
    this.flux = new Float64Array(memory, base + 56, count)
    this.emf = new Float64Array(memory, base + 56 + count * 8, count)
    this.readout = new Float64Array(memory, base + 56 + count * 16, 5)
  }
  induced(rate: number, turns: number) {
    check(this.kernel.faraday_induced(rate, turns, this.readout.byteOffset)); return this.readout[0]
  }
  motional(b: number, length: number, velocity: number) {
    check(this.kernel.faraday_motional(b, length, velocity, this.readout.byteOffset)); return this.readout[0]
  }
  coilFlux(t: number, n: number, b: number, area: number, omega: number) {
    check(this.kernel.faraday_flux(t, n, b, area, omega, this.readout.byteOffset)); return this.readout[0]
  }
  coilEmf(t: number, n: number, b: number, area: number, omega: number) {
    check(this.kernel.faraday_emf(t, n, b, area, omega, this.readout.byteOffset)); return this.readout[0]
  }
  peak(n: number, b: number, area: number, omega: number) {
    check(this.kernel.faraday_peak(n, b, area, omega, this.readout.byteOffset)); return this.readout[0]
  }
  series(flux: readonly number[], dt: number, turns: number) {
    if (flux.length > this.flux.length) throw new Error('Flux series exceeds owner capacity')
    this.flux.set(flux)
    check(this.kernel.faraday_series(flux.length ? this.flux.byteOffset : 0, flux.length, dt, turns, flux.length ? this.emf.byteOffset : 0))
    return Array.from(this.emf.subarray(0, flux.length))
  }
  solve(scene: FaradayScene) {
    this.config.set([scene.omega, scene.B, scene.N, scene.A, scene.vBar, scene.bMot, scene.lBar])
    check(this.kernel.faraday_result(this.config.byteOffset, this.flux.byteOffset, this.emf.byteOffset, this.readout.byteOffset))
    return { flux: Array.from(this.flux.subarray(0, 361)), emf: Array.from(this.emf.subarray(0, 361)),
      peak: this.readout[0], linkage: this.readout[1], motionalEmf: this.readout[2], frequency: this.readout[3], period: this.readout[4] }
  }
}

/** Fixed-capacity caller-owned buffers; response, coding and QR run only in Rust. */
export class WasmSignalArray {
  private readonly kernel = instantiateKernel()
  private readonly config: DataView
  private readonly table: Uint32Array
  private readonly readout: DataView
  private readonly rcConfig: Float64Array
  private readonly input: Float64Array
  private readonly sensing: Float64Array
  private readonly bias: Float64Array
  private readonly custom: Float64Array
  private readonly encoding: Float64Array
  private readonly sensor: Float64Array
  private readonly measured: Float64Array
  private readonly ideal: Float64Array
  private readonly sampled: Float64Array
  private readonly reconstructed: Float64Array
  private readonly error: Float64Array
  constructor() {
    const base = this.kernel.memory.grow(5) * 65536, memory = this.kernel.memory.buffer
    this.config = new DataView(memory, base, 40)
    this.table = new Uint32Array(memory, base + 40, 10)
    this.readout = new DataView(memory, base + 80, 64)
    this.rcConfig = new Float64Array(memory, base + 144, 4)
    let offset = base + 176
    const floats = (length: number) => {
      const buffer = new Float64Array(memory, offset, length)
      offset += length * 8
      return buffer
    }
    this.input = floats(64); this.sensing = floats(4096); this.bias = floats(64)
    this.custom = floats(8192); this.encoding = floats(8192); this.sensor = floats(64)
    this.measured = floats(128); this.reconstructed = floats(64); this.error = floats(64)
    const qr = floats(192 * 64), rhs = floats(192)
    this.ideal = floats(128); this.sampled = floats(128)
    const permutation = new Uint32Array(memory, offset, 64)
    this.table.set([this.encoding, this.sensor, this.measured, this.reconstructed, this.error, qr, rhs, permutation, this.ideal, this.sampled].map(a => a.byteOffset))
  }
  solve(scene: SignalArrayScene): SignalArrayResult {
    const n = scene.rows * scene.cols, k = scene.sensing.length
    const m = scene.encoding.kind === 'custom' ? scene.encoding.matrix.length : k
    if (!Number.isInteger(n) || n < 1 || n > 64 || k < 1 || k > 64 || m < 1 || m > 128 ||
      scene.input.length !== n || scene.bias.length !== k || scene.sensing.some(row => row.length !== n) ||
      (scene.encoding.kind === 'custom' && scene.encoding.matrix.some(row => row.length !== k))) throw new Error('Invalid array dimensions')
    if (!Number.isInteger(scene.seed) || scene.seed < 0 || scene.seed > 4294967295) throw new Error('Invalid array seed')
    const kind = ['direct', 'hadamard', 'custom'].indexOf(scene.encoding.kind)
    if (kind < 0) throw new Error('Invalid array encoding')
    ;[n, k, m, kind, scene.seed, 0].forEach((v, i) => this.config.setUint32(4 * i, v, true))
    this.config.setFloat64(24, scene.noisePeakV, true); this.config.setFloat64(32, scene.regularization, true)
    this.input.set(scene.input); scene.sensing.forEach((row, i) => this.sensing.set(row, i * n)); this.bias.set(scene.bias)
    if (scene.encoding.kind === 'custom') scene.encoding.matrix.forEach((row, i) => this.custom.set(row, i * k))
    if (scene.readout) this.rcConfig.set([scene.readout.resistanceOhm, scene.readout.capacitanceF, scene.readout.dwellS, scene.readout.initialV])
    const code = this.kernel.array_sense_sampled(this.config.byteOffset, this.input.byteOffset, this.sensing.byteOffset, this.bias.byteOffset,
      kind === 2 ? this.custom.byteOffset : 0, scene.readout ? this.rcConfig.byteOffset : 0, this.table.byteOffset, this.readout.byteOffset)
    if (code === 5) throw new Error('Array regularized matrix is numerically rank deficient in FP64; check calibration scale or regularization')
    check(code)
    const status = this.readout.getUint32(28, true), solved = status !== 1
    return { encoding: Array.from({ length: m }, (_, i) => Array.from(this.encoding.subarray(i * k, (i + 1) * k))),
      sensorV: Array.from(this.sensor.subarray(0, k)), measuredV: Array.from(this.measured.subarray(0, m)),
      idealV: Array.from(this.ideal.subarray(0, m)), sampledV: Array.from(this.sampled.subarray(0, m)),
      settlingFraction: this.readout.getFloat64(40, true), readoutTauS: this.readout.getFloat64(56, true),
      reconstructed: solved ? Array.from(this.reconstructed.subarray(0, n)) : null,
      error: solved ? Array.from(this.error.subarray(0, n)) : null,
      rank: this.readout.getUint32(24, true), rankTolerance: this.readout.getFloat64(16, true),
      status: status === 1 ? 'rank-deficient' : status === 2 ? 'regularized' : 'solved',
      rmse: solved ? this.readout.getFloat64(0, true) : null, residualRmsV: solved ? this.readout.getFloat64(8, true) : null }
  }
}

/** Persistent FP64 rate-equation state and characteristics from the Rust core. */
export class WasmLaser {
  private readonly kernel = instantiateKernel()
  readonly config: Float64Array
  readonly state: Float64Array
  readonly curve: Float64Array
  readonly readout: Float64Array
  constructor() {
    const base = this.kernel.memory.grow(1) * 65536, memory = this.kernel.memory.buffer
    this.config = new Float64Array(memory, base, 6)
    this.state = new Float64Array(memory, base + 48, 2)
    this.readout = new Float64Array(memory, base + 64, 3)
    this.curve = new Float64Array(memory, base + 88, 102)
  }
  configure(p: LaserParams, pump = 0, dt = 0.02) { this.config.set([p.tauN, p.tauC, p.B, p.spont, pump, dt]) }
  setState(s: LaserState) { this.state.set([s.N, s.S]) }
  snapshot(): LaserState { return { N: this.state[0], S: this.state[1] } }
  advance(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('Invalid laser chunk')
    check(this.kernel.laser_advance(this.config.byteOffset, this.state.byteOffset, count))
  }
  threshold() { check(this.kernel.laser_threshold(this.config.byteOffset, this.readout.byteOffset)); return this.readout[0] }
  steady(pump: number) { check(this.kernel.laser_steady(this.config.byteOffset, pump, this.readout.byteOffset)); return this.readout[0] }
  characteristics(pump: number) {
    check(this.kernel.laser_characteristics(this.config.byteOffset, pump, this.curve.byteOffset, this.readout.byteOffset))
    return { threshold: this.readout[0], pumpMax: this.readout[1], steadyPhotons: this.readout[2],
      curve: Array.from({ length: 51 }, (_, i) => ({ p: this.curve[2 * i], s: this.curve[2 * i + 1] })) }
  }
}

export class WasmNljd {
  private readonly kernel = instantiateKernel()
  readonly readout: Float64Array
  readonly transfer: Float64Array
  constructor() {
    const base = this.kernel.memory.grow(1) * 65536, memory = this.kernel.memory.buffer
    this.readout = new Float64Array(memory, base, 9)
    this.transfer = new Float64Array(memory, base + 72, 81)
  }
  result(kind: number) { check(this.kernel.nljd_result(kind, this.transfer.byteOffset, this.readout.byteOffset)); return this.readout }
  coefficients(kind: number) { check(this.kernel.nljd_coefficients(kind, this.readout.byteOffset)); return this.readout }
  harmonics(kind: number) { check(this.kernel.nljd_harmonics(kind, this.readout.byteOffset)); return this.readout }
  amplitudes(a2: number, a3: number) { check(this.kernel.nljd_harmonic_amplitudes(a2, a3, this.readout.byteOffset)); return this.readout }
  response(v: number, a2: number, a3: number) { check(this.kernel.nljd_response(v, a2, a3, this.readout.byteOffset)); return this.readout[0] }
  classify(f1: number, f2: number, f3: number) {
    this.readout.set([f1, f2, f3])
    check(this.kernel.nljd_classify(this.readout.byteOffset, this.readout.byteOffset + 24))
    return new DataView(this.readout.buffer, this.readout.byteOffset + 24, 4).getUint32(0, true)
  }
}

/** Two persistent wave fields and four bounded trace rings, all advanced in Rust. */
export class WasmRadar {
  private readonly kernel = instantiateKernel()
  private readonly config: Uint32Array
  private readonly state: Uint32Array
  private readonly fields: [Float32Array, Float32Array]
  readonly mask: Uint8Array
  private readonly ring: Float64Array
  private readonly channels: Float64Array
  constructor(scene: RadarScene) {
    const base = this.kernel.memory.grow(6) * 65536, memory = this.kernel.memory.buffer
    this.config = new Uint32Array(memory, base, 8)
    this.state = new Uint32Array(memory, base + 32, 10)
    this.channels = new Float64Array(memory, base + 72, 12)
    this.fields = [new Float32Array(memory, base + 168, 40000), new Float32Array(memory, base + 160168, 40000)]
    this.mask = new Uint8Array(memory, base + 320168, 40000)
    this.ring = new Float64Array(memory, base + 360168, 1024)
    this.reset(scene)
  }
  reset(scene: RadarScene) {
    if (!Number.isInteger(scene.steps) || scene.steps < 1 || scene.steps > 2000 ||
      !['pulse', 'cw'].includes(scene.mode) || scene.probes.length !== 4 || scene.probes.some(p => p !== null &&
        (!Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= 200 || p.y >= 200))) throw new Error('Invalid radar scene')
    this.config.set([scene.steps, scene.mode === 'cw' ? 1 : 0, ...scene.probes.map(p => p ? p.x + 200 * p.y : 0xffffffff), 0, 0])
    check(this.kernel.radar_init(this.config.byteOffset, this.state.byteOffset, this.fields[0].byteOffset,
      this.fields[1].byteOffset, this.mask.byteOffset, this.ring.byteOffset))
  }
  get completed() { return this.state[0] }
  get field() { return this.fields[this.state[1]] }
  advance(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('Invalid radar chunk')
    check(this.kernel.radar_advance(this.config.byteOffset, this.state.byteOffset, this.fields[0].byteOffset,
      this.fields[1].byteOffset, this.mask.byteOffset, this.ring.byteOffset, count))
  }
  get traces() {
    return Array.from({ length: 4 }, (_, ch) => Array.from({ length: this.state[2 + ch] },
      (_, i) => this.ring[ch * 256 + (this.state[6 + ch] + i) % 256]))
  }
  readout() {
    check(this.kernel.radar_read(this.state.byteOffset, this.ring.byteOffset, this.channels.byteOffset))
    return Array.from({ length: 4 }, (_, ch) => this.channels[3 * ch + 2] ? { v: this.channels[3 * ch], pp: this.channels[3 * ch + 1] } : null)
  }
}

export class WasmRadarMath {
  private readonly kernel = instantiateKernel()
  readonly params: Float64Array
  private readonly out: Float64Array
  constructor() {
    const base = this.kernel.memory.grow(1) * 65536, memory = this.kernel.memory.buffer
    this.params = new Float64Array(memory, base, 6)
    this.out = new Float64Array(memory, base + 48, 1)
  }
  range() { check(this.kernel.radar_max_range(this.params.byteOffset, this.out.byteOffset)); return this.out[0] }
  power(range: number) { check(this.kernel.radar_received_power(this.params.byteOffset, range, this.out.byteOffset)); return this.out[0] }
  wavelength(frequency: number) { check(this.kernel.radar_wavelength(frequency, this.out.byteOffset)); return this.out[0] }
  doubleRatio() { check(this.kernel.radar_power_ratio(this.out.byteOffset)); return this.out[0] }
}

/** One WASM instance per field: two persistent buffers, no per-step allocation. */
export class WasmFields {
  readonly exports: KernelExports
  current: Float32Array
  next: Float32Array
  readonly mask: Uint8Array
  constructor(readonly width: number, readonly height: number) {
    const count = width * height
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || count > 16_777_216) {
      throw new Error('Invalid or oversized simulation grid')
    }
    try {
      this.exports = instantiateKernel()
      const memory = this.exports.memory
      const offset = memory.grow(Math.ceil(count * 9 / 65536)) * 65536
      this.current = new Float32Array(memory.buffer, offset, count)
      this.next = new Float32Array(memory.buffer, offset + count * 4, count)
      this.mask = new Uint8Array(memory.buffer, offset + count * 8, count)
    } catch {
      throw new Error('此环境无法运行 WASM 计算内核，请启用 WebAssembly 或使用后端计算')
    }
  }
  swap(status: number) {
    check(status)
    const previous = this.current
    this.current = this.next
    this.next = previous
  }
  heat(r: number) {
    this.swap(this.exports.heat(this.current.byteOffset, this.next.byteOffset, this.width, this.height, r))
  }
  seedWave(x: number, y: number, radius: number, amount: number) {
    seedArguments(x, y, radius)
    check(this.exports.seed_wave(this.current.byteOffset, this.next.byteOffset, this.width, x, y, radius, amount))
  }
  seedHeat(x: number, y: number, radius: number, amount: number) {
    seedArguments(x, y, radius)
    check(this.exports.seed_heat(this.current.byteOffset, this.width, this.height, x, y, radius, amount))
  }
}

/** Persistent Yee fields and Mur history; numerical updates live in W-Sim Rust. */
export class WasmFdtd {
  private readonly kernel: KernelExports
  private readonly config: DataView
  private readonly energyValue: Float64Array
  readonly eps: Float32Array
  readonly Ez: Float32Array
  readonly Hx: Float32Array
  readonly Hy: Float32Array
  readonly prevLeft: Float32Array
  readonly prevRight: Float32Array
  readonly prevBottom: Float32Array
  readonly prevTop: Float32Array
  readonly pecMask: Uint8Array | null
  readonly cMur: number
  constructor(readonly Nx: number, readonly Ny: number, readonly dt: number, readonly mu: number,
    public boundary: 'mur' | 'pec', eps?: Float32Array, mask?: Uint8Array | null) {
    const count = Nx * Ny
    if (![Nx, Ny].every(n => Number.isSafeInteger(n) && n >= 3) || count > 16_777_216 ||
        (eps && eps.length !== count) || (mask && mask.length !== count)) throw new Error('Invalid FDTD grid or material buffer')
    if (!(dt > 0) || !(mu > 0) || !Number.isFinite(dt) || !Number.isFinite(mu) ||
        (boundary !== 'mur' && boundary !== 'pec')) throw new Error('Invalid FDTD coefficients or boundary')
    const minimumEps = eps ? eps.reduce((minimum, value) => Math.min(minimum, value), Infinity) : 1
    const courantSquared = (dt / mu) * (dt / minimumEps) * 2
    if (!(minimumEps > 0) || (eps && !eps.every(Number.isFinite)) || !Number.isFinite(courantSquared) || courantSquared > 1) throw new Error('FDTD coefficients exceed CFL stability bounds')
    this.kernel = instantiateKernel()
    const bytes = 40 + (count * 4 + 2 * Nx + 2 * Ny) * 4 + (mask ? count : 0)
    const offset = this.kernel.memory.grow(Math.ceil(bytes / 65536)) * 65536
    const memory = this.kernel.memory.buffer
    this.config = new DataView(memory, offset, 32)
    this.config.setUint32(0, Nx, true); this.config.setUint32(4, Ny, true)
    this.config.setFloat64(16, dt, true); this.config.setFloat64(24, mu, true)
    this.energyValue = new Float64Array(memory, offset + 32, 1)
    let next = offset + 40
    const field = (length: number) => { const view = new Float32Array(memory, next, length); next += length * 4; return view }
    this.Ez = field(count); this.Hx = field(count); this.Hy = field(count); this.eps = field(count)
    this.prevLeft = field(Ny); this.prevRight = field(Ny); this.prevBottom = field(Nx); this.prevTop = field(Nx)
    if (eps) this.eps.set(eps); else this.eps.fill(1)
    this.pecMask = mask ? new Uint8Array(memory, next, count) : null
    if (mask) this.pecMask!.set(mask)
    this.cMur = (dt - 1) / (dt + 1)
  }
  step() {
    if (this.boundary !== 'mur' && this.boundary !== 'pec') throw new Error('Invalid FDTD boundary')
    this.config.setUint32(8, this.boundary === 'pec' ? 1 : 0, true)
    check(this.kernel.fdtd_step(this.config.byteOffset, this.eps.byteOffset, this.pecMask?.byteOffset ?? 0,
      this.Ez.byteOffset, this.Hx.byteOffset, this.Hy.byteOffset,
      this.prevLeft.byteOffset, this.prevRight.byteOffset, this.prevBottom.byteOffset, this.prevTop.byteOffset))
  }
  inject(x: number, y: number, amplitude: number) {
    if (![x, y].every(Number.isSafeInteger) || x < 0 || x >= this.Nx || y < 0 || y >= this.Ny) throw new Error('Invalid FDTD source coordinates')
    check(this.kernel.fdtd_source(this.Ez.byteOffset, this.Nx, this.Ny, x, y, amplitude))
  }
  energy() {
    this.config.setUint32(8, this.boundary === 'pec' ? 1 : 0, true)
    check(this.kernel.fdtd_energy(this.config.byteOffset, this.eps.byteOffset, this.Ez.byteOffset,
      this.Hx.byteOffset, this.Hy.byteOffset, this.energyValue.byteOffset))
    return this.energyValue[0]
  }
}

function mdConfig(memory: ArrayBuffer, offset: number, N: number, dim: number, rc: number) {
  if (!Number.isSafeInteger(N) || N < 1 || N > 65536 || (dim !== 2 && dim !== 3)) throw new Error('Invalid MD dimensions')
  const config = new DataView(memory, offset, 32)
  config.setUint32(0, N, true); config.setUint32(4, dim, true)
  config.setFloat64(16, 1, true); config.setFloat64(24, rc, true)
  return config
}

export type ParticleInteractions = ScreeningParams & { charge: Float32Array; sigma: Float32Array; eps: Float32Array }

/** Persistent particle buffers; force, integration, baths and readout share the native Rust kernel. */
export class WasmMd {
  private readonly kernel: KernelExports
  private readonly config: DataView
  private readonly scalars: Float64Array
  private readonly bath: DataView
  private readonly stats: Float64Array
  private readonly scale: Float64Array
  private readonly forces: Float32Array
  private readonly pos0: Float32Array
  private readonly speed: Float32Array
  private readonly screening: DataView
  private readonly particles?: Pick<ParticleInteractions, 'charge' | 'sigma' | 'eps'>
  readonly pos: Float32Array
  readonly vel: Float32Array
  readonly posUnwrapped: Float32Array
  constructor(readonly N: number, L: number, readonly dim: number, readonly rc: number,
    pos: Float32Array, vel: Float32Array, interactions?: ParticleInteractions) {
    if (!Number.isSafeInteger(N) || N < 1 || N > 65536 || (dim !== 2 && dim !== 3) ||
        pos.length !== N * dim || vel.length !== N * dim ||
        (interactions && [interactions.charge, interactions.sigma, interactions.eps].some(field => field.length !== N))) throw new Error('Invalid MD particle buffers')
    this.kernel = instantiateKernel()
    const offset = this.kernel.memory.grow(Math.ceil((224 + N * dim * 20 + N * (interactions ? 16 : 4)) / 65536)) * 65536
    const memory = this.kernel.memory.buffer
    this.config = mdConfig(memory, offset, N, dim, rc)
    this.scalars = new Float64Array(memory, offset + 32, 4); this.L = L
    this.bath = new DataView(memory, offset + 64, 48)
    this.stats = new Float64Array(memory, offset + 112, 10)
    this.scale = new Float64Array(memory, offset + 192, 1)
    this.screening = new DataView(memory, offset + 200, 24)
    let next = offset + 224
    const field = () => { const view = new Float32Array(memory, next, N * dim); next += N * dim * 4; return view }
    this.pos = field(); this.vel = field(); this.forces = field(); this.posUnwrapped = field(); this.pos0 = field()
    this.speed = new Float32Array(memory, next, N); next += N * 4
    if (interactions) {
      this.particles = { charge: new Float32Array(memory, next, N), sigma: new Float32Array(memory, next + N * 4, N), eps: new Float32Array(memory, next + N * 8, N) }
      for (const key of ['charge', 'sigma', 'eps'] as const) this.particles[key].set(interactions[key])
      ;[interactions.epsR, interactions.lambdaD, interactions.kCoulomb].forEach((v, i) => this.screening.setFloat64(i * 8, v, true))
    }
    this.pos.set(pos); this.vel.set(vel); this.pos0.set(pos)
    if (this.particles) check(this.kernel.particles_init(this.config.byteOffset, this.scalars.byteOffset, this.screening.byteOffset,
      this.pos.byteOffset, this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset,
      this.particles.charge.byteOffset, this.particles.sigma.byteOffset, this.particles.eps.byteOffset))
    else check(this.kernel.md_init(this.config.byteOffset, this.scalars.byteOffset, this.pos.byteOffset,
      this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset))
  }
  get L() { return this.scalars[0] }
  set L(value: number) { this.scalars[0] = value }
  get potential() { return this.scalars[1] }
  set potential(value: number) { this.scalars[1] = value }
  get virial() { return this.scalars[2] }
  set virial(value: number) { this.scalars[2] = value }
  get force() { return this.forces }
  set force(value: Float32Array) {
    if (value.length !== this.forces.length) throw new Error('Invalid MD force buffer')
    this.forces.set(value)
  }
  step(dt: number) {
    this.config.setFloat64(16, dt, true)
    if (this.particles) check(this.kernel.particles_step(this.config.byteOffset, this.scalars.byteOffset, this.screening.byteOffset,
      this.pos.byteOffset, this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset,
      this.particles.charge.byteOffset, this.particles.sigma.byteOffset, this.particles.eps.byteOffset))
    else check(this.kernel.md_step(this.config.byteOffset, this.scalars.byteOffset, this.pos.byteOffset,
      this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset))
  }
  private setBath(temperature: number, p: BarostatParams) {
    this.config.setFloat64(16, p.dt, true)
    this.bath.setUint32(0, (Number.isNaN(temperature) ? 0 : 1) | (Number.isNaN(p.Ptarget) || !(p.tauP > 0) ? 0 : 2), true)
    ;[Number.isNaN(temperature) ? 0 : temperature, Number.isNaN(p.Ptarget) ? 0 : p.Ptarget,
      p.tauP > 0 ? p.tauP : 1, p.kappaT ?? 1, p.maxScale ?? 0.02].forEach((v, i) => this.bath.setFloat64(8 + i * 8, v, true))
  }
  batch(steps: number, temperature: number, p: BarostatParams) {
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > 4) throw new Error('MD batches require 1–4 steps')
    this.setBath(temperature, p)
    if (this.particles) {
      if (!Number.isNaN(p.Ptarget)) throw new Error('Pressure control is unavailable for particle mixtures')
      check(this.kernel.particles_batch(this.config.byteOffset, this.scalars.byteOffset, this.screening.byteOffset,
        this.pos.byteOffset, this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset,
        this.particles.charge.byteOffset, this.particles.sigma.byteOffset, this.particles.eps.byteOffset,
        Number.isNaN(temperature) ? 0 : temperature, Number(!Number.isNaN(temperature)), steps))
    } else check(this.kernel.md_batch(this.config.byteOffset, this.scalars.byteOffset, this.bath.byteOffset,
      this.pos.byteOffset, this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset, steps))
  }
  barostat(p: BarostatParams) {
    if (Number.isNaN(p.Ptarget) || !(p.tauP > 0)) return 1
    if (this.particles) throw new Error('Pressure control is unavailable for particle mixtures')
    this.setBath(NaN, p)
    check(this.kernel.md_barostat(this.config.byteOffset, this.scalars.byteOffset, this.bath.byteOffset,
      this.pos.byteOffset, this.vel.byteOffset, this.forces.byteOffset, this.posUnwrapped.byteOffset, this.scale.byteOffset))
    return this.scale[0]
  }
  read(): MdFrame {
    if (this.particles) check(this.kernel.particles_read(this.config.byteOffset, this.scalars.byteOffset, this.pos0.byteOffset,
      this.vel.byteOffset, this.posUnwrapped.byteOffset, this.particles.charge.byteOffset, this.speed.byteOffset, this.stats.byteOffset))
    else check(this.kernel.md_read(this.config.byteOffset, this.scalars.byteOffset, this.pos0.byteOffset,
      this.vel.byteOffset, this.posUnwrapped.byteOffset, this.speed.byteOffset, this.stats.byteOffset))
    const [temperature, kinetic, potential, total, pressure, msd, boxL, volume, density] = this.stats
    return { pos: this.pos.slice(), speed: this.speed.slice(), observables: { temperature, kinetic, potential, total, pressure, msd, boxL, volume, density } }
  }
  readParticles() {
    if (!this.particles) throw new Error('Particle mixture properties are required')
    const frame = this.read()
    return { ...frame, observables: { ...frame.observables, totalCharge: this.stats[9] } }
  }
}

/** Standalone force evaluation also accepts coordinates translated by whole periodic boxes. */
export function computeMdForces(pos: Float32Array, L: number, N: number, dim: number, rc: number, interactions?: ParticleInteractions) {
  if (pos.length !== N * dim || (interactions && [interactions.charge, interactions.sigma, interactions.eps].some(field => field.length !== N))) throw new Error('Invalid MD position or interaction buffer')
  const kernel = instantiateKernel()
  const offset = kernel.memory.grow(Math.ceil((88 + pos.length * 8 + (interactions ? N * 12 : 0)) / 65536)) * 65536
  const memory = kernel.memory.buffer, config = mdConfig(memory, offset, N, dim, rc)
  const state = new Float64Array(memory, offset + 32, 4); state[0] = L
  const positions = new Float32Array(memory, offset + 88, pos.length); positions.set(pos)
  const force = new Float32Array(memory, offset + 88 + pos.length * 4, pos.length)
  if (interactions) {
    const screening = new DataView(memory, offset + 64, 24)
    ;[interactions.epsR, interactions.lambdaD, interactions.kCoulomb].forEach((v, i) => screening.setFloat64(i * 8, v, true))
    const start = offset + 88 + pos.length * 8
    const charge = new Float32Array(memory, start, N), sigma = new Float32Array(memory, start + N * 4, N), eps = new Float32Array(memory, start + N * 8, N)
    charge.set(interactions.charge); sigma.set(interactions.sigma); eps.set(interactions.eps)
    check(kernel.particles_force(config.byteOffset, state.byteOffset, screening.byteOffset, positions.byteOffset, force.byteOffset,
      charge.byteOffset, sigma.byteOffset, eps.byteOffset))
  } else check(kernel.md_force(config.byteOffset, state.byteOffset, positions.byteOffset, force.byteOffset))
  return { force, potential: state[1], virial: state[2] }
}

/** Snapshot RDF and finite-window diffusion use the same Rust analysis on both executors. */
export function analyzeMd(frame: MdFrame, history: MdHistory, bins: number, fitDiffusion: boolean) {
  const kernel = instantiateKernel(), N = frame.speed.length
  if (!Number.isSafeInteger(bins) || bins < 1 || bins > 65536 || frame.pos.length !== N * 2 || history.length > 2001) throw new Error('Invalid MD analysis buffers')
  const offset = kernel.memory.grow(Math.ceil((120 + frame.pos.length * 4 + bins * 16 + history.length * 16) / 65536)) * 65536
  const memory = kernel.memory.buffer, config = mdConfig(memory, offset, N, 2, 2.5)
  const state = new Float64Array(memory, offset + 32, 4); state[0] = frame.observables.boxL
  const rdfStats = new Float64Array(memory, offset + 64, 2), fit = new Float64Array(memory, offset + 80, 5)
  let next = offset + 120
  const pos = new Float32Array(memory, next, frame.pos.length); pos.set(frame.pos); next += pos.byteLength
  const hist = new Float64Array(memory, next, bins); next += hist.byteLength
  const r = new Float32Array(memory, next, bins); next += r.byteLength
  const g = new Float32Array(memory, next, bins); next += g.byteLength
  const times = new Float64Array(memory, next, history.length); next += times.byteLength
  const msd = new Float64Array(memory, next, history.length)
  check(kernel.md_rdf(config.byteOffset, state.byteOffset, pos.byteOffset, bins, state[0] / 2,
    hist.byteOffset, r.byteOffset, g.byteOffset, rdfStats.byteOffset))
  let diffusion = null
  if (fitDiffusion) {
    history.forEach((p, i) => { times[i] = p.time; msd[i] = p.msd })
    check(kernel.md_diffusion(times.byteOffset, msd.byteOffset, history.length, 2, 0.2, fit.byteOffset))
    const [D, slope, intercept, r2, nFit] = fit
    diffusion = { D, slope, intercept, r2, nFit }
  }
  return { rdf: { r, g }, diffusion }
}

export type WasmLbmConfig = {
  nx: number; ny: number; nz: number; tau: number; uInlet: number
  smagorinskyCs: number; turbulenceIntensity: number; freeSlipWalls: boolean
  groundVelocityLattice?: number
  boundary?: 'wind-tunnel' | 'periodic' | 'closed'
  pressureField?: boolean
  fan?: PreparedProductLbm['fan']
  thermal?: NonNullable<PreparedProductLbm['thermal']>['thermal']
}

/** D3Q19 buffers and ABI only; all collision, propagation and forces live in Rust. */
export class WasmLbm {
  private readonly exports: KernelExports
  private readonly configOffset: number
  private readonly post: Float32Array
  private readonly energy: Float64Array | undefined
  private readonly nextEnergy: Float64Array | undefined
  private readonly thermalMass: Float64Array | undefined
  readonly temperature: Float64Array | undefined
  private readonly stats: Float64Array
  private readonly display: Float32Array
  private readonly pressureField: boolean
  readonly flags: Uint8Array
  readonly distributions: Float32Array
  readonly velocity: Float32Array
  readonly density: Float32Array
  private steps = 0
  constructor(config: WasmLbmConfig, flags: Uint8Array) {
    const { nx, ny, nz } = config, count = nx * ny * nz
    if (![nx, ny, nz].every(n => Number.isSafeInteger(n) && n >= 3) || count > 2097152 || flags.length !== count) {
      throw new Error('Invalid or oversized D3Q19 grid')
    }
    this.exports = instantiateKernel()
    this.pressureField = config.pressureField === true
    const flagsBytes = Math.ceil(count / 8) * 8
    const offset = this.exports.memory.grow(Math.ceil((2040 + flagsBytes + count * ((config.thermal ? 212 : 176) + (this.pressureField ? 4 : 0))) / 65536)) * 65536
    this.configOffset = offset
    const memory = this.exports.memory.buffer, view = new DataView(memory, offset, 1888)
    const boundary = ['wind-tunnel', 'periodic', 'closed'].indexOf(config.boundary ?? 'wind-tunnel')
    if (boundary < 0) throw new Error('Unsupported D3Q19 boundary')
    ;[nx, ny, nz, boundary, Number(config.freeSlipWalls)].forEach((n, i) => view.setUint32(i * 4, n, true))
    ;[config.tau, config.uInlet, config.smagorinskyCs, config.turbulenceIntensity].forEach((n, i) => view.setFloat64(24 + i * 8, n, true))
    view.setUint32(56, 11, true)
    if (config.groundVelocityLattice !== undefined) {
      view.setUint32(244, 1, true)
      view.setFloat64(248, config.groundVelocityLattice, true)
    }
    if (config.fan) {
      view.setUint32(20, 1, true)
      ;[...config.fan.center, config.fan.radiusCells, ...config.fan.normal, config.fan.accelerationLattice]
        .forEach((n, i) => view.setFloat64(64 + i * 8, n, true))
    }
    if (config.thermal) {
      view.setUint32(60, 1, true)
      const t = config.thermal
      ;[t.gravityPerKelvin, t.dtSeconds, t.ambientC, t.fixedSurfaceC, t.dxMeters,
        t.fluidDensity, t.fluidSpecificHeat, t.fluidConductivity, t.solidDensity,
        t.solidSpecificHeat, t.solidConductivity, t.totalPowerW]
        .forEach((n, i) => view.setFloat64(128 + i * 8, n, true))
      view.setUint32(224, t.mode === 'solid-power' ? 1 : 0, true)
      view.setUint32(228, t.maxSubsteps, true)
      view.setFloat64(232, t.temperatureScaleC, true)
      const materials = t.materials ?? []
      if (materials.length > 16) throw new Error('At most 16 thermal regions are supported')
      view.setUint32(240, materials.length, true)
      materials.forEach((material, index) => {
        ;[material.density, material.specificHeat, material.conductivity, material.totalPowerW]
          .forEach((value, field) => view.setFloat64(256 + index * 32 + field * 8, value, true))
      })
      for (const contact of t.contacts ?? []) {
        const lo = Math.min(contact.first, contact.second), hi = Math.max(contact.first, contact.second)
        if (![lo, hi].every(Number.isInteger) || lo < 0 || hi > materials.length || lo === hi ||
            !Number.isFinite(contact.resistanceM2KW) || contact.resistanceM2KW < 0) throw new Error('Invalid thermal contact')
        const pair = hi * (hi - 1) / 2 + lo, maskOffset = 768 + Math.floor(pair / 32) * 4, bit = 1 << (pair % 32)
        const mask = view.getUint32(maskOffset, true)
        if (mask & bit) throw new Error('Duplicate thermal contact')
        view.setUint32(maskOffset, mask | bit, true)
        view.setFloat64(800 + pair * 8, contact.resistanceM2KW, true)
      }
    }
    this.stats = new Float64Array(memory, offset + 1888, 19)
    this.flags = new Uint8Array(memory, offset + 2040, count)
    this.flags.set(flags)
    let dataOffset = offset + 2040 + flagsBytes
    this.distributions = new Float32Array(memory, dataOffset, count * 19); dataOffset += count * 19 * 4
    this.post = new Float32Array(memory, dataOffset, count * 19); dataOffset += count * 19 * 4
    this.velocity = new Float32Array(memory, dataOffset, count * 3); dataOffset += count * 3 * 4
    this.density = new Float32Array(memory, dataOffset, count)
    dataOffset += count * 4
    if (config.thermal) {
      this.energy = new Float64Array(memory, dataOffset, count); dataOffset += count * 8
      this.nextEnergy = new Float64Array(memory, dataOffset, count); dataOffset += count * 8
      this.temperature = new Float64Array(memory, dataOffset, count); dataOffset += count * 8
      this.thermalMass = new Float64Array(memory, dataOffset, count); dataOffset += count * 8
    }
    this.display = new Float32Array(memory, dataOffset, count * (2 + Number(!!config.thermal) + Number(this.pressureField)))
    check(this.exports.d3q19_init(offset, this.flags.byteOffset, this.distributions.byteOffset, this.post.byteOffset, this.velocity.byteOffset, this.density.byteOffset,
      this.energy?.byteOffset ?? 0, this.nextEnergy?.byteOffset ?? 0, this.temperature?.byteOffset ?? 0, this.thermalMass?.byteOffset ?? 0))
  }
  step() {
    if (this.steps >= 0xffffffff) throw new Error('D3Q19 step limit reached')
    check(this.exports.d3q19_step(this.configOffset, this.flags.byteOffset, this.distributions.byteOffset,
      this.post.byteOffset, this.velocity.byteOffset, this.density.byteOffset, this.energy?.byteOffset ?? 0, this.nextEnergy?.byteOffset ?? 0,
      this.temperature?.byteOffset ?? 0, this.thermalMass?.byteOffset ?? 0, this.steps + 1, this.stats.byteOffset))
    this.steps++
    return { step: this.steps, obstacleForce: [this.stats[0], this.stats[1], this.stats[2]] as const, mass: this.stats[3], maxSpeed: this.stats[4],
      massBalance: { bulkMassBefore: this.stats[12], bulkMassAfter: this.stats[13], inletNetMass: this.stats[14],
        outletNetMass: this.stats[15], collisionMassChange: this.stats[16], inletReplacementMass: this.stats[17], outletReplacementMass: this.stats[18] },
      thermal: this.energy ? { thermalEnergyJ: this.stats[5], sourceEnergyJ: this.stats[6], boundaryEnergyJ: this.stats[7],
        energyResidualJ: this.stats[8], solidMaxC: this.stats[9], fluidMaxC: this.stats[10], thermalSubsteps: this.stats[11] } : undefined }
  }
  readDisplay() {
    check(this.exports.d3q19_display(this.configOffset, this.velocity.byteOffset, this.flags.byteOffset, this.temperature?.byteOffset ?? 0,
      this.pressureField ? this.distributions.byteOffset : 0, this.display.byteOffset))
    return this.display
  }
}

/** Persistent FP64 state and append-only trajectories for the four existing ODE modules. */
export class WasmOde {
  readonly kernel = instantiateKernel()
  readonly parameters: Float64Array
  readonly state: Float64Array
  readonly values: Float64Array
  readonly shares: Float64Array
  readonly upward: Uint8Array
  readonly curveOmega: Float64Array
  readonly curveAmplitude: Float64Array
  private readonly readout: Float64Array
  private readonly pulses: Uint32Array
  readonly kind: 'rlc' | 'mutual' | 'vibration' | 'neuron'
  readonly capacity: number
  readonly columns: number
  completed = 0
  constructor(options: { kind: WasmOde['kind']; parameters: number[]; initial: number[]; capacity: number; pulses?: number[]; curvePoints?: number }) {
    const { kind, parameters, initial, capacity, pulses = [], curvePoints = 0 } = options
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 1_000_000 ||
      !Number.isInteger(curvePoints) || curvePoints < 0 || curvePoints > 1_000_000 ||
      parameters.length !== ({ rlc: 5, mutual: 8, vibration: 6, neuron: 3 })[kind] ||
      initial.length !== (kind === 'mutual' ? 4 : 2) || ![...parameters, ...initial].every(Number.isFinite) ||
      pulses.length > 64 || pulses.some((value, i) => !Number.isInteger(value) || value < 0 || value > 0xffffffff || (i > 0 && value <= pulses[i - 1]))) {
      throw new Error('Invalid ODE configuration or trajectory size')
    }
    this.kind = kind; this.capacity = capacity; this.columns = kind === 'neuron' ? 1 : 2
    const count = capacity + 1, bytes = 160 + count * (this.columns + 1) * 8 + curvePoints * 16 + pulses.length * 4
    const base = this.kernel.memory.grow(Math.ceil(bytes / 65536)) * 65536, memory = this.kernel.memory.buffer
    this.parameters = new Float64Array(memory, base, parameters.length); this.parameters.set(parameters)
    this.state = new Float64Array(memory, base + 64, initial.length); this.state.set(initial)
    this.readout = new Float64Array(memory, base + 96, 6)
    this.values = new Float64Array(memory, base + 160, count * this.columns)
    this.values.set(initial.slice(0, this.columns))
    this.shares = new Float64Array(memory, this.values.byteOffset + this.values.byteLength, count)
    this.upward = new Uint8Array(memory, this.shares.byteOffset, count)
    this.curveOmega = new Float64Array(memory, this.shares.byteOffset + this.shares.byteLength, curvePoints)
    this.curveAmplitude = new Float64Array(memory, this.curveOmega.byteOffset + this.curveOmega.byteLength, curvePoints)
    this.pulses = new Uint32Array(memory, this.curveAmplitude.byteOffset + this.curveAmplitude.byteLength, pulses.length); this.pulses.set(pulses)
  }
  advance(count: number, sine = false, omega = 0) {
    if (!Number.isInteger(count) || count < 1 || count > this.capacity - this.completed) throw new Error('Invalid ODE advance count')
    const config = this.parameters.byteOffset, state = this.state.byteOffset
    const out = this.values.byteOffset + (this.completed + 1) * this.columns * 8
    if (this.kind === 'rlc') check(this.kernel.rlc_advance(config, state, count, out))
    else if (this.kind === 'mutual') check(this.kernel.mutual_advance(config, state, this.completed, count, Number(sine), omega, out, this.shares.byteOffset + (this.completed + 1) * 8))
    else if (this.kind === 'vibration') check(this.kernel.oscillator_advance(config, state, this.completed, count, out))
    else check(this.kernel.neuron_advance(config, state, this.pulses.length ? this.pulses.byteOffset : 0, this.pulses.length, this.completed, count, out, this.upward.byteOffset + this.completed + 1))
    this.completed += count
  }
  step(time = 0) {
    const config = this.parameters.byteOffset, state = this.state.byteOffset
    if (this.kind === 'rlc') check(this.kernel.rlc_step(config, state))
    else if (this.kind === 'mutual') check(this.kernel.mutual_step(config, state))
    else if (this.kind === 'vibration') check(this.kernel.oscillator_step(config, state, time))
    else check(this.kernel.neuron_step(config, state))
  }
  read() {
    const config = this.parameters.byteOffset, state = this.state.byteOffset, out = this.readout.byteOffset
    if (this.kind === 'rlc') check(this.kernel.rlc_read(config, state, out))
    else if (this.kind === 'mutual') check(this.kernel.mutual_read(config, state, out))
    else if (this.kind === 'vibration') check(this.kernel.oscillator_read(config, out))
    else check(this.kernel.ode_peak(this.values.byteOffset, this.completed + 1, out))
    return this.readout
  }
  oscillatorAmplitude(omega: number) {
    check(this.kernel.oscillator_amplitude(this.parameters.byteOffset, omega, this.readout.byteOffset))
    return this.readout[0]
  }
  oscillatorOmega0(mass: number, stiffness: number) {
    check(this.kernel.oscillator_omega0(mass, stiffness, this.readout.byteOffset))
    return this.readout[0]
  }
  resonance(min: number, max: number) {
    check(this.kernel.oscillator_curve(this.parameters.byteOffset, min, max, this.curveOmega.length, this.curveOmega.byteOffset, this.curveAmplitude.byteOffset))
    return { omega: this.curveOmega, amp: this.curveAmplitude, ok: true }
  }
}

const OPTICS_KINDS = ['laser', 'mirror', 'lens', 'interface', 'screen', 'blocker', 'polarizer', 'splitter'] as const
function writeOpticsComponent(view: DataView, offset: number, c: import('../lab/optics-lab').OpticsComponent) {
  const kind = OPTICS_KINDS.indexOf(c.kind)
  if (kind < 0) throw new Error('Unknown optics component')
  view.setUint32(offset, kind, true); view.setUint32(offset + 4, 0, true)
  const values = [c.x, c.y, c.rot, c.length, c.power ?? 1, c.wavelengthNm ?? 635,
    c.focalLength ?? 140, c.n ?? 1.5, c.polAngleDeg ?? c.rot, c.splitT ?? 0.5]
  values.forEach((value, i) => view.setFloat64(offset + 8 + i * 8, value, true))
}

/** Small public geometry helpers do not allocate the full ray-tracing workspace. */
export class WasmOpticsMath {
  private readonly kernel = instantiateKernel()
  private readonly base = this.kernel.memory.grow(1) * 65536
  private readonly view = new DataView(this.kernel.memory.buffer)
  private readonly out = new Float64Array(this.kernel.memory.buffer, this.base + 128, 6)
  unit(rot: number) { check(this.kernel.optics_unit(rot, this.out.byteOffset)); return { dx: this.out[0], dy: this.out[1] } }
  normalize(dx: number, dy: number) { check(this.kernel.optics_normalize(dx, dy, this.out.byteOffset)); return { dx: this.out[0], dy: this.out[1] } }
  reflect(dx: number, dy: number, nx: number, ny: number) {
    check(this.kernel.optics_reflect(dx, dy, nx, ny, this.out.byteOffset)); return { dx: this.out[0], dy: this.out[1] }
  }
  refract(dx: number, dy: number, nx: number, ny: number, n1: number, n2: number) {
    check(this.kernel.optics_refract(dx, dy, nx, ny, n1, n2, this.out.byteOffset))
    return this.out[2] ? { dx: this.out[0], dy: this.out[1] } : null
  }
  incidence(dx: number, dy: number, nx: number, ny: number) {
    check(this.kernel.optics_incidence(dx, dy, nx, ny, this.out.byteOffset)); return this.out[0]
  }
  malus(pol: number | undefined, axis: number) {
    check(this.kernel.optics_malus(pol ?? 0, Number(pol !== undefined), axis, this.out.byteOffset)); return this.out[0]
  }
  segment(c: import('../lab/optics-lab').OpticsComponent) {
    writeOpticsComponent(this.view, this.base, c)
    check(this.kernel.optics_segment(this.base, this.out.byteOffset))
    const [x0, y0, x1, y1, nx, ny] = this.out
    return { x0, y0, x1, y1, nx, ny }
  }
  intersection(ox: number, oy: number, dx: number, dy: number, seg: import('../lab/optics-lab').SegmentGeom, eps: number) {
    new Float64Array(this.kernel.memory.buffer, this.base, 6).set([seg.x0, seg.y0, seg.x1, seg.y1, seg.nx, seg.ny])
    check(this.kernel.optics_intersection(ox, oy, dx, dy, this.base, eps, this.out.byteOffset))
    const [t, s, x, y, valid] = this.out
    return valid ? { t, s, x, y } : null
  }
  seed(components: import('../lab/optics-lab').OpticsComponent[]) {
    if (components.length > 64) throw new Error('At most 64 optics components are supported')
    components.forEach((c, i) => writeOpticsComponent(this.view, this.base + i * 88, c))
    const rays = this.base + 64 * 88, countPtr = rays + 64 * 9 * 64
    check(this.kernel.optics_seed(this.base, components.length, rays, 64 * 9, countPtr))
    return Array.from({ length: this.view.getUint32(countPtr, true) }, (_, i) => {
      const offset = rays + i * 64, v = new Float64Array(this.kernel.memory.buffer, offset, 7)
      return { x: v[0], y: v[1], dx: v[2], dy: v[3], intensity: v[4], wavelengthNm: v[5],
        bounces: this.view.getUint32(offset + 56, true), ...(this.view.getUint32(offset + 60, true) ? { polDeg: v[6] } : {}) }
    })
  }
}

/** One owner per trace/job or mounted editor; reset reuses its bounded memory. */
export class WasmOptics {
  private readonly kernel = instantiateKernel()
  private readonly base: number
  readonly view: DataView
  readonly config: Uint32Array
  readonly state: Uint32Array
  readonly segments: number
  readonly hits: number
  readonly events: number
  readonly profiles: number
  readonly bins: Float64Array
  private readonly components: number
  private readonly table: Uint32Array
  constructor(readonly screenBins = 48) {
    if (!Number.isInteger(screenBins) || screenBins < 1 || screenBins > 4096) throw new Error('Invalid screen bin count')
    const bytes = 80 + 64 * (88 + 48 + 32 + screenBins * 8) + 20576 * 64 + 20000 * (48 + 48 + 80)
    this.base = this.kernel.memory.grow(Math.ceil(bytes / 65536)) * 65536
    const memory = this.kernel.memory.buffer
    this.view = new DataView(memory)
    this.config = new Uint32Array(memory, this.base, 4)
    this.state = new Uint32Array(memory, this.base + 16, 8)
    this.table = new Uint32Array(memory, this.base + 48, 8)
    this.components = this.base + 80
    const geoms = this.components + 64 * 88, stack = geoms + 64 * 48
    this.segments = stack + 20576 * 64
    this.hits = this.segments + 20000 * 48
    this.events = this.hits + 20000 * 48
    this.profiles = this.events + 20000 * 80
    this.bins = new Float64Array(memory, this.profiles + 64 * 32, 64 * screenBins)
    this.table.set([geoms, stack, this.segments, this.hits, this.events, this.profiles, this.bins.byteOffset, 0])
  }
  reset(components: import('../lab/optics-lab').OpticsComponent[], maxBounces = 28) {
    if (components.length > 64 || !Number.isInteger(maxBounces) || maxBounces < 0 || maxBounces > 20000) throw new Error('Invalid optics scene size or bounce limit')
    components.forEach((c, i) => writeOpticsComponent(this.view, this.components + i * 88, c))
    this.config.set([components.length, maxBounces, this.screenBins, 0])
    check(this.kernel.optics_init(this.config.byteOffset, this.components, this.state.byteOffset, this.table.byteOffset))
  }
  advance(budget = 128) {
    check(this.kernel.optics_advance(this.config.byteOffset, this.components, this.state.byteOffset, this.table.byteOffset, budget))
  }
  read() { check(this.kernel.optics_read(this.config.byteOffset, this.state.byteOffset, this.table.byteOffset)) }
  get done() { return this.state[1] === 0 }
  get processed() { return this.state[0] }
}

/** FP64 plane-wave samples share one allocation across frames and parameter updates. */
export class WasmPlane {
  private readonly kernel = instantiateKernel()
  readonly parameters: Float64Array
  readonly readout: Float64Array
  readonly positions: Float64Array
  readonly first: Float64Array
  readonly second: Float64Array
  constructor(readonly kind: 'electromagnetic' | 'sound' | 'emwave3d', count: number) {
    if (!Number.isInteger(count) || count < 0 || count > 1_000_000 || (kind === 'emwave3d' && count !== 140)) throw new Error('Invalid plane-wave sample count')
    const base = this.kernel.memory.grow(Math.ceil((80 + count * 24) / 65536)) * 65536, memory = this.kernel.memory.buffer
    this.parameters = new Float64Array(memory, base, kind === 'electromagnetic' ? 4 : kind === 'sound' ? 5 : 3)
    this.readout = new Float64Array(memory, base + 40, 5)
    this.positions = new Float64Array(memory, base + 80, count)
    this.first = new Float64Array(memory, base + 80 + count * 8, count)
    this.second = new Float64Array(memory, base + 80 + count * 16, count)
  }
  read() {
    if (this.kind === 'electromagnetic') check(this.kernel.plane_em_read(this.parameters.byteOffset, this.readout.byteOffset))
    else if (this.kind === 'sound') check(this.kernel.plane_acoustic_read(this.parameters.byteOffset, this.readout.byteOffset))
    else check(this.kernel.plane_em3d(this.parameters.byteOffset, this.positions.byteOffset, this.first.byteOffset, this.second.byteOffset, this.readout.byteOffset))
    return this.readout
  }
  sample(time: number) {
    if (this.kind === 'emwave3d') { this.parameters[2] = time; this.read(); return }
    const sample = this.kind === 'electromagnetic' ? this.kernel.plane_em_sample : this.kernel.plane_acoustic_sample
    check(sample(this.parameters.byteOffset, time, this.positions.byteOffset, this.positions.length, this.first.byteOffset, this.second.byteOffset))
  }
}

/** Antenna/array snapshots reuse their configuration and output buffers across edits. */
export class WasmAntenna {
  private readonly kernel = instantiateKernel()
  readonly config: DataView
  readonly parameters: Float64Array
  readonly readout: Float64Array
  readonly pattern: Float64Array
  readonly powers: Float64Array
  readonly scan: Float64Array
  readonly phases: Float64Array
  readonly grating: Float64Array
  constructor(readonly kind: 'antennapattern' | 'antenna3d' | 'phasedarray', samples = 361) {
    if (!Number.isInteger(samples) || samples < 2 || samples > 1_000_000) throw new Error('Invalid antenna sample count')
    const array = kind === 'phasedarray', length = array ? samples * 2 : kind === 'antenna3d' ? 49 : 361
    const powers = kind === 'antennapattern' ? 121 : 0, scan = array ? 4002 : 0, phases = array ? 48 : 0, grating = array ? 20 : 0
    const base = this.kernel.memory.grow(Math.ceil((96 + (length + powers + scan + phases + grating) * 8) / 65536)) * 65536
    const memory = this.kernel.memory.buffer
    this.config = new DataView(memory, base, 64)
    this.parameters = new Float64Array(memory, base, array ? 2 : 5)
    this.readout = new Float64Array(memory, base + 64, 4)
    this.pattern = new Float64Array(memory, base + 96, length)
    this.powers = new Float64Array(memory, this.pattern.byteOffset + this.pattern.byteLength, powers)
    this.scan = new Float64Array(memory, this.powers.byteOffset + this.powers.byteLength, scan)
    this.phases = new Float64Array(memory, this.scan.byteOffset + this.scan.byteLength, phases)
    this.grating = new Float64Array(memory, this.phases.byteOffset + this.phases.byteLength, grating)
  }
  read() {
    const config = this.config.byteOffset, pattern = this.pattern.byteOffset, out = this.readout.byteOffset
    if (this.kind === 'antennapattern') check(this.kernel.antenna_link(config, pattern, this.powers.byteOffset, out))
    else if (this.kind === 'antenna3d') check(this.kernel.antenna_3d(config, pattern, out))
    else {
      if (this.pattern.length !== 722) throw new Error('Array snapshot needs 361 samples')
      check(this.kernel.array_result(config, pattern, this.scan.byteOffset, this.phases.byteOffset, this.grating.byteOffset, out))
    }
    return this.readout
  }
  patternAt(type: number, theta: number) { check(this.kernel.antenna_pattern(type, theta, this.readout.byteOffset)); return this.readout[0] }
  directivity(type: number) { check(this.kernel.antenna_directivity(type, this.readout.byteOffset)); return this.readout[0] }
  beamwidth(type: number) { check(this.kernel.antenna_beamwidth(type, this.readout.byteOffset)); return this.readout[0] }
  friis() { check(this.kernel.antenna_friis(this.config.byteOffset, this.readout.byteOffset)); return this.readout }
  polarization(theta: number) { check(this.kernel.antenna_polarization(theta, this.readout.byteOffset)); return this.readout[0] }
  dipolePower(theta: number) { check(this.kernel.antenna_dipole_power(theta, this.readout.byteOffset)); return this.readout[0] }
  arrayFactor(theta: number) { check(this.kernel.array_factor(this.config.byteOffset, theta, this.readout.byteOffset)); return this.readout[0] }
  arrayPattern() { check(this.kernel.array_pattern(this.config.byteOffset, this.pattern.length / 2, this.pattern.byteOffset)); return this.pattern }
  arrayBeamwidth() {
    check(this.kernel.array_beamwidth(this.config.byteOffset, this.pattern.byteOffset, this.pattern.length / 2, this.readout.byteOffset))
    return this.readout[0]
  }
  gratingLobes(d: number, steer: number) {
    check(this.kernel.array_grating(d, steer, this.grating.byteOffset, this.readout.byteOffset))
    const count = new DataView(this.readout.buffer, this.readout.byteOffset, 4).getUint32(0, true)
    return this.grating.subarray(0, count)
  }
}
