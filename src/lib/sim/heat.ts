// 2D 热扩散显式有限差分（FTCS）解算器（共享 Rust/WASM CPU 内核）。
// 离散热方程：u_t = α ∇²u。更新式 u' = u + r·(上+下+左+右 − 4u)，r = α·dt/dx²。
// 绝热(Neumann)边界：界外邻居取自身（反射）→ 总热量守恒。稳定条件 r ≤ 0.25。
// WGSL compute shader（src/lib/webgpu/heatSim.ts）镜像同一格式。

import { WasmFields } from './wasm-fields'

export const STABLE_R = 0.25
export const HEAT_W = 192, HEAT_H = 120
export type HeatSeed = { x: number; y: number; radius: number; amount: number }
export type HeatScene = { r: number; steps: number; seeds: HeatSeed[] }

export function defaultHeatSeeds(): HeatSeed[] {
  return [
    { x: HEAT_W / 2, y: HEAT_H / 2, radius: 8, amount: 80 },
    { x: HEAT_W / 4, y: HEAT_H / 3, radius: 5, amount: 60 },
    { x: HEAT_W * 3 / 4, y: HEAT_H * 2 / 3, radius: 5, amount: 60 },
  ]
}

/** Initial heat deposit, shared by CPU and GPU shadow fields. No continuous source. */
export function seedHeat2D(field: Float32Array, W: number, H: number, seed: HeatSeed): void {
  const heat = new HeatField(W, H, field)
  heat.seed(seed)
  field.set(heat.field)
}

export function heatFieldResult(field: Float32Array, steps: number) {
  let peak = 0
  for (const value of field) peak = Math.max(peak, value)
  return { width: HEAT_W, height: HEAT_H, steps, field: Array.from(field), peak, total: sum(field) }
}

/** Persistent buffers for CPU simulations; the field view changes after each step. */
export class HeatField {
  private readonly fields: WasmFields
  constructor(readonly W: number, readonly H: number, initial?: Float32Array) {
    this.fields = new WasmFields(W, H)
    if (initial) {
      if (initial.length !== W * H) throw new Error('Invalid heat field length')
      this.fields.current.set(initial)
    }
  }
  get field() { return this.fields.current }
  seed({ x, y, radius, amount }: HeatSeed) { this.fields.seedHeat(x, y, radius, amount) }
  step(r: number) { this.fields.heat(r) }
}

/** 单步推进，返回独立新场（不修改入参）。批算和动画复用 HeatField。 */
export function stepHeat2D(u: Float32Array, W: number, H: number, r: number): Float32Array {
  const heat = new HeatField(W, H, u)
  heat.step(r)
  return heat.field.slice()
}

export function sum(u: Float32Array): number {
  let s = 0
  for (let i = 0; i < u.length; i++) s += u[i]
  return s
}
