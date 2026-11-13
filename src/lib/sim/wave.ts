// 2D 波动方程 u_tt = c²∇²u 的显式蛙跳（leapfrog）解算器。CPU Rust/WASM，供波纹水池与雷达。
// u_next = (2u − u_prev + a·∇²u)·damp，a = c²·dt²/dx²（CFL: a ≤ 0.5 稳定）。固定边界（u=0）→ 反射。
import { WasmFields } from './wasm-fields'

const IX = (x: number, y: number, N: number) => x + y * N

export function laplacian(u: Float32Array, x: number, y: number, N: number): number {
  const c = u[IX(x, y, N)]
  const l = x > 0 ? u[IX(x - 1, y, N)] : c
  const r = x < N - 1 ? u[IX(x + 1, y, N)] : c
  const up = y > 0 ? u[IX(x, y - 1, N)] : c
  const dn = y < N - 1 ? u[IX(x, y + 1, N)] : c
  return l + r + up + dn - 4 * c
}

export class Wave {
  private readonly fields: WasmFields
  readonly N: number
  a: number; damp: number
  obstacle: Uint8Array | null = null
  constructor(N: number, opts: { a?: number; damp?: number } = {}) {
    if (N < 3) throw new Error('Wave grid must be at least 3 × 3')
    this.N = N
    this.a = opts.a ?? 0.25
    this.damp = opts.damp ?? 0.999
    this.fields = new WasmFields(N, N)
  }
  get u() { return this.fields.current }
  set u(value: Float32Array) {
    if (value.length !== this.N * this.N) throw new Error('Invalid wave field length')
    this.fields.current.set(value)
  }
  get uPrev() { return this.fields.next }
  set uPrev(value: Float32Array) {
    if (value.length !== this.N * this.N) throw new Error('Invalid wave field length')
    this.fields.next.set(value)
  }
  get engine(): 'wasm' { return 'wasm' }
  /** 内部硬反射体（1=固体，u 强制 0）→ 产生回波/多径。 */
  setObstacle(mask: Uint8Array) {
    if (mask.length !== this.N * this.N) throw new Error('Invalid obstacle mask length')
    this.obstacle = mask
  }
  /** 在 (x,y) 半径 r 内施加位移扰动（同时写 u 与 uPrev → 零初速度，从静止释放）。 */
  poke(x: number, y: number, r: number, amt: number) {
    this.fields.seedWave(x, y, r, amt)
  }
  step() {
    const f = this.fields
    if (this.obstacle) {
      if (this.obstacle.length !== this.N * this.N) throw new Error('Invalid obstacle mask length')
      f.mask.set(this.obstacle)
    }
    f.swap(f.exports.step(f.current.byteOffset, f.next.byteOffset, this.N, this.a, this.damp,
      this.obstacle ? f.mask.byteOffset : 0))
  }
  energy(): number {
    let e = 0
    for (let i = 0; i < this.u.length; i++) e += this.u[i] * this.u[i]
    return e
  }
}

export const RIPPLE_N = 180
export type RippleScene = {
  damping: number
  steps: number
  seeds: { x: number; y: number; radius: number; amount: number }[]
}

export function defaultRippleSeeds(): RippleScene['seeds'] {
  return [-28, 28].map(offset => ({ x: RIPPLE_N / 2 + offset, y: RIPPLE_N / 2, radius: 2, amount: 6 }))
}

/** Finite displacement pulses at rest, not sustained monochromatic sources. */
export function createRippleScene(scene: RippleScene) {
  const wave = new Wave(RIPPLE_N, { a: 0.25, damp: scene.damping })
  for (const seed of scene.seeds) wave.poke(seed.x, seed.y, seed.radius, seed.amount)
  return wave
}

export function rippleResult(field: ArrayLike<number>, steps: number) {
  let peak = 0, squared = 0
  for (let i = 0; i < field.length; i++) {
    peak = Math.max(peak, Math.abs(field[i]))
    squared += field[i] ** 2
  }
  // RMS displacement is not the wave's kinetic + potential energy.
  return { nx: RIPPLE_N, steps, field: Array.from(field), peak, rms: Math.sqrt(squared / field.length) }
}
