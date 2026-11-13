// Shared Rust Stable Fluids kernel. This file owns WASM buffers and scene inputs.
import { instantiateWasmKernel, type WasmKernelExports } from '@w-sim/solvers-lbm/d3q19'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export function IX(x: number, y: number, N: number): number { return clamp(x, 0, N - 1) + clamp(y, 0, N - 1) * N }
function check(status: number) {
  if (status !== 0) throw new Error(`Rust fluid kernel rejected the input or numerical state (${status})`)
}

type FluidOptions = { dt?: number; visc?: number; diff?: number; iter?: number; thermal?: boolean; buoyancy?: number; ambient?: number; inletSpeed?: number }
type FluidSource = { inlet?: { density: number; spacing: number; width: number }; decay?: number; cooling?: number }

/** One memory owner and ten persistent f32 fields; no per-step field allocation or transfer. */
export class Fluid {
  readonly N: number; dt: number; visc: number; diff: number; iter: number
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vx0: Float32Array; readonly vy0: Float32Array
  readonly dens: Float32Array; readonly dens0: Float32Array; readonly p: Float32Array; readonly div: Float32Array; readonly temp: Float32Array
  inletSpeed?: number
  thermal: boolean; buoyancy: number; ambient: number
  readonly kernel: WasmKernelExports
  readonly config: number
  private readonly fields: number
  private readonly source: number
  private readonly view: DataView
  private readonly stats: Float64Array
  private readonly mask: Uint8Array
  private hasObstacle = false
  constructor(N: number, opts: FluidOptions = {}) {
    if (!Number.isInteger(N) || N < 3 || N > 1024) throw new Error('Invalid or oversized fluid grid')
    this.N = N; this.dt = opts.dt ?? 0.1; this.visc = opts.visc ?? 0; this.diff = opts.diff ?? 0
    this.iter = opts.iter ?? 12; this.inletSpeed = opts.inletSpeed
    this.thermal = opts.thermal ?? false; this.buoyancy = opts.buoyancy ?? 0; this.ambient = opts.ambient ?? 0
    this.kernel = instantiateWasmKernel()
    const count = N * N
    this.config = this.kernel.memory.grow(Math.ceil((208 + count * 41) / 65536)) * 65536
    this.fields = this.config + 64; this.source = this.config + 112
    const memory = this.kernel.memory.buffer
    this.view = new DataView(memory, this.config, 208)
    this.stats = new Float64Array(memory, this.config + 160, 6)
    const arrays = Array.from({ length: 10 }, (_, i) => new Float32Array(memory, this.config + 208 + i * count * 4, count))
    ;[this.vx, this.vy, this.vx0, this.vy0, this.dens, this.dens0, this.p, this.div, , this.temp] = arrays
    arrays.forEach((field, i) => this.view.setUint32(64 + i * 4, field.byteOffset, true))
    this.mask = new Uint8Array(memory, this.config + 208 + count * 40, count)
    this.configure()
  }
  /** Preserve the existing mutable parameter API; the numeric core validates coefficients. */
  configure() {
    if (!Number.isInteger(this.N) || this.N * this.N !== this.vx.length || !Number.isInteger(this.iter) || this.iter < 0 || this.iter > 4096) throw new Error('Invalid fluid dimensions or iteration count')
    this.view.setUint32(0, this.N, true); this.view.setUint32(4, this.iter, true)
    this.view.setUint32(8, Number(this.thermal), true); this.view.setUint32(12, Number(this.inletSpeed !== undefined), true)
    this.view.setFloat64(16, this.dt, true); this.view.setFloat64(24, this.visc, true); this.view.setFloat64(32, this.diff, true)
    this.view.setFloat64(40, this.buoyancy, true); this.view.setFloat64(48, this.ambient, true); this.view.setFloat64(56, this.inletSpeed ?? 0, true)
    this.view.setUint32(104, this.hasObstacle ? this.mask.byteOffset : 0, true)
  }
  get obstacle(): Uint8Array | null { return this.hasObstacle ? this.mask : null }
  setObstacle(mask: Uint8Array) {
    if (mask.length !== this.mask.length || mask.some(value => value > 1)) throw new Error('Invalid fluid obstacle mask')
    this.mask.set(mask); this.hasObstacle = true; this.configure()
  }
  addDensity(x: number, y: number, amt: number) { this.dens[IX(x, y, this.N)] += amt }
  addTemp(x: number, y: number, amt: number) { this.temp[IX(x, y, this.N)] += amt }
  addVelocity(x: number, y: number, ax: number, ay: number) {
    const i = IX(x, y, this.N); this.vx[i] += ax; this.vy[i] += ay
  }
  applyObstacle() { this.configure(); check(this.kernel.fluid_apply(this.config, this.fields, 1)) }
  applyBuoyancy() { this.configure(); check(this.kernel.fluid_apply(this.config, this.fields, 0)) }
  step() { this.configure(); check(this.kernel.fluid_step(this.config, this.fields, 0)) }
  advance(source: FluidSource) {
    this.configure()
    this.view.setUint32(112, Number(!!source.inlet), true)
    this.view.setFloat64(120, source.inlet?.density ?? 0, true)
    this.view.setFloat64(128, source.inlet?.spacing ?? 0, true); this.view.setFloat64(136, source.inlet?.width ?? 0, true)
    this.view.setFloat64(144, source.decay ?? 1, true); this.view.setFloat64(152, source.cooling ?? 1, true)
    check(this.kernel.fluid_step(this.config, this.fields, this.source))
  }
  read() {
    this.configure()
    check(this.kernel.fluid_read(this.config, this.vx.byteOffset, this.vy.byteOffset, this.dens.byteOffset, this.temp.byteOffset, 1, this.stats.byteOffset))
    return { peakDensity: this.stats[0], meanDensity: this.stats[1], maxSpeed: this.stats[2],
      minTemperature: this.stats[3], maxTemperature: this.stats[4], gridDivergence: this.stats[5],
      // Solver bookkeeping the kernel parks in div's unused ghost cells.
      projectionSweeps: this.div[0], projectionResidual: this.div[1] }
  }
}

// Existing teaching APIs copy only at their call boundary; stepping above uses owned views.
function copy(field: Float32Array, values: ArrayLike<number>) {
  if (field.length !== values.length) throw new Error('Fluid field length mismatch')
  field.set(values)
}
export function setBnd(b: number, x: Float32Array, N: number, inletSpeed?: number) {
  const f = new Fluid(N, { inletSpeed }); copy(f.dens, x)
  check(f.kernel.fluid_set_boundary(f.config, b, f.dens.byteOffset)); x.set(f.dens)
}
export function linSolve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number, iter: number, N: number, inletSpeed?: number) {
  const f = new Fluid(N, { iter, inletSpeed }); copy(f.dens, x); copy(f.dens0, x0)
  check(f.kernel.fluid_linear_solve(f.config, b, f.dens.byteOffset, f.dens0.byteOffset, a, c)); x.set(f.dens)
}
export function diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number, iter: number, N: number, inletSpeed?: number) {
  const f = new Fluid(N, { dt, iter, inletSpeed }); copy(f.dens, x); copy(f.dens0, x0)
  check(f.kernel.fluid_diffuse(f.config, b, f.dens.byteOffset, f.dens0.byteOffset, diff)); x.set(f.dens)
}
export function project(vx: Float32Array, vy: Float32Array, p: Float32Array, div: Float32Array, iter: number, N: number, inletSpeed?: number) {
  const f = new Fluid(N, { iter, inletSpeed }); copy(f.vx, vx); copy(f.vy, vy); copy(f.p, p); copy(f.div, div)
  check(f.kernel.fluid_project(f.config, f.vx.byteOffset, f.vy.byteOffset, f.p.byteOffset, f.div.byteOffset))
  vx.set(f.vx); vy.set(f.vy); p.set(f.p); div.set(f.div)
}
export function advect(b: number, d: Float32Array, d0: Float32Array, vx: Float32Array, vy: Float32Array, dt: number, N: number, inletSpeed?: number) {
  const f = new Fluid(N, { dt, inletSpeed }); copy(f.dens, d); copy(f.dens0, d0); copy(f.vx, vx); copy(f.vy, vy)
  check(f.kernel.fluid_advect(f.config, b, f.dens.byteOffset, f.dens0.byteOffset, f.vx.byteOffset, f.vy.byteOffset)); d.set(f.dens)
}
export function maxDivergence(vx: ArrayLike<number>, vy: ArrayLike<number>, N: number, margin = 1): number {
  if (!Number.isInteger(margin) || margin < 0 || margin > N) throw new Error('Invalid divergence margin')
  const f = new Fluid(N); copy(f.vx, vx); copy(f.vy, vy)
  const out = f.config + 160
  check(f.kernel.fluid_max_divergence(f.vx.byteOffset, f.vy.byteOffset, N, margin, out))
  return new Float64Array(f.kernel.memory.buffer, out, 1)[0]
}
function fieldStats(fluid: { vx: ArrayLike<number>; vy: ArrayLike<number>; dens?: ArrayLike<number>; temp?: ArrayLike<number> }, n: number) {
  if (fluid instanceof Fluid) return fluid.read()
  const f = new Fluid(n); copy(f.vx, fluid.vx); copy(f.vy, fluid.vy)
  if (fluid.dens) copy(f.dens, fluid.dens)
  if (fluid.temp) copy(f.temp, fluid.temp)
  return f.read()
}

export const FLUID_N = 100
export const FLUID_DT = 0.12
export type FluidScene = {
  viscosity: number; diffusion: number; rotation: number; decay: number; steps: number
  seeds: { x: number; y: number; radius: number; density: number; vx: number; vy: number }[]
  inlet?: { speed: number; density: number; spacing: number; width: number }
  obstacle?: number[]
}
export function defaultFluidSeeds(): FluidScene['seeds'] {
  return [{ x: FLUID_N / 2, y: FLUID_N / 2, radius: 4, density: 60, vx: 0, vy: 0 }]
}

/** User initial conditions and boundaries; named examples are assembled by the caller. */
export function createFluidScene(scene: FluidScene) {
  // iter only caps the residual-checked implicit diffusion sweep; 24 covers
  // the maximum allowed viscosity with headroom, and early exit keeps cost
  // proportional to the actual residual.
  const fluid = new Fluid(FLUID_N, { dt: FLUID_DT, iter: 24, visc: scene.viscosity, diff: scene.diffusion, inletSpeed: scene.inlet?.speed })
  for (let y = 1; y < FLUID_N - 1; y++) for (let x = 1; x < FLUID_N - 1; x++) {
    fluid.addVelocity(x, y, (scene.inlet?.speed ?? 0) + (y - FLUID_N / 2) * scene.rotation, -(x - FLUID_N / 2) * scene.rotation)
  }
  for (const seed of scene.seeds) {
    for (let dy = -seed.radius; dy <= seed.radius; dy++) for (let dx = -seed.radius; dx <= seed.radius; dx++) {
      const x = seed.x + dx, y = seed.y + dy
      if (dx * dx + dy * dy > seed.radius * seed.radius || x < 1 || y < 1 || x >= FLUID_N - 1 || y >= FLUID_N - 1) continue
      fluid.addDensity(x, y, seed.density); fluid.addVelocity(x, y, seed.vx, seed.vy)
    }
  }
  if (scene.obstacle) { fluid.setObstacle(Uint8Array.from(scene.obstacle)); fluid.applyObstacle() }
  if (scene.inlet) {
    check(fluid.kernel.fluid_set_boundary(fluid.config, 1, fluid.vx.byteOffset))
    check(fluid.kernel.fluid_set_boundary(fluid.config, 2, fluid.vy.byteOffset))
  }
  return fluid
}

/** Dye decay belongs to each solver step, never to the rendering frame. */
export function stepFluidScene(fluid: Fluid, scene: Pick<FluidScene, 'decay' | 'inlet'>) {
  fluid.advance({ inlet: scene.inlet, decay: scene.decay })
}

export function fluidResult(fluid: { dens: ArrayLike<number>; vx: ArrayLike<number>; vy: ArrayLike<number>; obstacle?: ArrayLike<number> | null }, steps: number) {
  const stats = fieldStats(fluid, FLUID_N)
  return {
    nx: FLUID_N, steps, dt: FLUID_DT, time: steps * FLUID_DT,
    density: Array.from(fluid.dens), vx: Array.from(fluid.vx), vy: Array.from(fluid.vy),
    ...(fluid.obstacle ? { solid: Array.from(fluid.obstacle) } : {}),
    peakDensity: stats.peakDensity, meanDensity: stats.meanDensity, maxSpeed: stats.maxSpeed,
    // True discrete divergence of the stored velocity (backward difference, in
    // grid-velocity units). The projection drives it to ~n·residual; cells at
    // solid boundaries legitimately keep nonzero divergence from impinging flow.
    gridDivergence: stats.gridDivergence,
    // Solver bookkeeping only exists for a live Fluid owner; field-only callers
    // (e.g. result validation) get undefined and JSON transport drops the keys.
    projectionSweeps: fluid instanceof Fluid ? stats.projectionSweeps : undefined,
    projectionResidual: fluid instanceof Fluid ? stats.projectionResidual : undefined,
  }
}

export const CONVECTION_N = 110
export const CONVECTION_DT = 0.1
export const CONVECTION_COOLING = 0.997
export type ConvectionScene = {
  buoyancy: number
  steps: number
  initialDrop: boolean
  seeds: { x: number; y: number; hot: boolean }[]
}

export function createConvectionScene(scene: ConvectionScene) {
  const fluid = new Fluid(CONVECTION_N, { dt: CONVECTION_DT, iter: 14, thermal: true, buoyancy: scene.buoyancy, ambient: 0 })
  if (scene.initialDrop) {
    for (let y = 8; y < 14; y++) for (let x = CONVECTION_N / 2 - 3; x <= CONVECTION_N / 2 + 3; x++) {
      fluid.addTemp(x, y, 90)
      fluid.addVelocity(x, y, 0, 0.6)
    }
  }
  for (const seed of scene.seeds) {
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const x = seed.x + i, y = seed.y + j
      // Clip deposits to interior cells; boundary cells belong to setBnd.
      if (i * i + j * j > 9 || x < 1 || y < 1 || x >= CONVECTION_N - 1 || y >= CONVECTION_N - 1) continue
      fluid.addTemp(x, y, seed.hot ? 90 : -90)
      fluid.addVelocity(x, y, 0, seed.hot ? 0.4 : -0.2)
    }
  }
  return fluid
}

/** Cooling belongs to each integration step, independent of browser frame grouping. */
export function stepConvectionScene(fluid: Fluid) {
  fluid.advance({ cooling: CONVECTION_COOLING })
}

export function convectionResult(fluid: { temp: ArrayLike<number>; vx: ArrayLike<number>; vy: ArrayLike<number> }, steps: number) {
  const stats = fieldStats(fluid, CONVECTION_N)
  return {
    nx: CONVECTION_N, steps, dt: CONVECTION_DT, time: steps * CONVECTION_DT,
    temperature: Array.from(fluid.temp), vx: Array.from(fluid.vx), vy: Array.from(fluid.vy),
    minTemperature: stats.minTemperature, maxTemperature: stats.maxTemperature, maxSpeed: stats.maxSpeed,
    // True discrete divergence of the stored velocity (backward difference, in
    // grid-velocity units); the projection converges it to ~n·residual.
    gridDivergence: stats.gridDivergence,
    projectionSweeps: fluid instanceof Fluid ? stats.projectionSweeps : undefined,
    projectionResidual: fluid instanceof Fluid ? stats.projectionResidual : undefined,
  }
}
