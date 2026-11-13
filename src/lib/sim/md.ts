// 分子动力学场景与单位辅助函数（约化 Lennard-Jones 单位 ε=σ=m=k_B=1）。
// 求解与统计使用共享 Rust/WASM 内核（速度 Verlet + 保序 cell 邻表）；WebGPU 是另行验证的 FP32 路径。
// 作业/服务端路径为 3D；dim 参数仍允许 2D，供交互预览与单元测试使用。
// LJ：U(r)=4(r⁻¹²−r⁻⁶)，截断 rc=2.5σ 并能量平移使 U(rc)=0。
import { rng } from '../mc'
import { instantiateWasmKernel } from '@w-sim/solvers-lbm/d3q19'
import { WasmMd, computeMdForces } from './wasm-fields'

export const MD_DT = 0.005
// The existing thermostat rescales per batch. This cadence is physics, not playback speed.
export const MD_BATCH_STEPS = 4
export const MD_RDF_BINS = 60
export const MD_PARTICLE_COUNTS = [64, 256, 1024, 2048] as const
/** Job/WASM path default 3D number density ρ* (liquid-like for a clear g(r)). */
export const MD_DENSITY = 0.4
/** Job-path cubic box length L = (N/ρ*)^(1/3). */
export const mdBoxLength = (N: number) => Math.cbrt(N / MD_DENSITY)
// The cell-list force evaluation is ~O(N·neighbors), so the honest step budget
// scales ~1/N, not 1/N². 131072/2048 = 64 keeps the largest scene at the old cap.
export const mdMaxSteps = (N: number) => Math.min(2000, Math.floor(131072 / N))

export type MdScene = {
  N: number; temperature: number; thermostat: boolean; barostat: boolean
  targetP: number; tauP: number; steps: number; seed: number
}
export interface MdObservables {
  temperature: number; kinetic: number; potential: number
  total: number; pressure: number; msd: number
  boxL: number; volume: number; density: number
}
export type MdFrame = { pos: Float32Array; speed: Float32Array; observables: MdObservables }
export type MdHistory = Array<{ step: number; time: number; msd: number }>

/**
 * Snapshot RDF/diffusion analysis, dimension-inferred from the frame
 * (`pos.length === N·dim`). Same Rust `md_rdf`/`md_diffusion` calls and the
 * same linear-memory layout as `analyzeMd` in wasm-fields.ts, which remains
 * 2D-only for its other callers; 3D frames need `dim` in the kernel config
 * and the `2·dim` Einstein factor.
 */
export function analyzeMdFrame(frame: MdFrame, history: MdHistory, bins: number, fitDiffusion: boolean) {
  const N = frame.speed.length
  const dim = frame.pos.length === N * 3 ? 3 : frame.pos.length === N * 2 ? 2 : 0
  if (dim === 0 || !Number.isSafeInteger(bins) || bins < 1 || bins > 65536 || history.length > 2001) {
    throw new Error('Invalid MD analysis buffers')
  }
  let kernel
  try {
    kernel = instantiateWasmKernel()
  } catch {
    throw new Error('此环境无法运行 WASM 计算内核，请启用 WebAssembly 或使用后端计算')
  }
  const offset = kernel.memory.grow(Math.ceil((136 + frame.pos.length * 4 + bins * 16 + history.length * 16) / 65536)) * 65536
  const memory = kernel.memory.buffer
  const config = new DataView(memory, offset, 32)
  config.setUint32(0, N, true); config.setUint32(4, dim, true)
  config.setFloat64(16, 1, true); config.setFloat64(24, 2.5, true)
  const state = new Float64Array(memory, offset + 32, 4); state[0] = frame.observables.boxL
  const rdfStats = new Float64Array(memory, offset + 64, 2), fit = new Float64Array(memory, offset + 80, 5)
  let next = offset + 120
  const align8 = (v: number) => (v + 7) & ~7
  const pos = new Float32Array(memory, next, frame.pos.length); pos.set(frame.pos); next = align8(next + pos.byteLength)
  const hist = new Float64Array(memory, next, bins); next += hist.byteLength
  const r = new Float32Array(memory, next, bins); next += r.byteLength
  const g = new Float32Array(memory, next, bins); next = align8(next + g.byteLength)
  const times = new Float64Array(memory, next, history.length); next += times.byteLength
  const msdSeries = new Float64Array(memory, next, history.length)
  if (kernel.md_rdf(config.byteOffset, state.byteOffset, pos.byteOffset, bins, state[0] / 2,
    hist.byteOffset, r.byteOffset, g.byteOffset, rdfStats.byteOffset) !== 0) {
    throw new Error('Simulation stopped: radial distribution rejected the frame')
  }
  let diffusion = null
  if (fitDiffusion) {
    history.forEach((p, i) => { times[i] = p.time; msdSeries[i] = p.msd })
    if (kernel.md_diffusion(times.byteOffset, msdSeries.byteOffset, history.length, dim, 0.2, fit.byteOffset) !== 0) {
      throw new Error('Simulation stopped: diffusion fit rejected the history')
    }
    const [D, slope, intercept, r2, nFit] = fit
    diffusion = { D, slope, intercept, r2, nFit }
  }
  return { rdf: { r, g }, diffusion }
}

/** Snapshot analysis uses the actual current box and integration times on both locations. */
export function mdResult(frame: MdFrame, steps: number, history: MdHistory, barostat: boolean) {
  const { rdf, diffusion } = analyzeMdFrame(frame, history, MD_RDF_BINS, !barostat && history.length >= 4)
  return {
    steps, dt: MD_DT, time: steps * MD_DT,
    pos: Array.from(frame.pos), speed: Array.from(frame.speed), observables: frame.observables,
    history: history.slice(), rdf: { r: Array.from(rdf.r), g: Array.from(rdf.g) },
    // Affine box rescaling contributes to raw MSD. Do not report it as self-diffusion.
    diffusion,
  }
}

/** 截断半径平方对应的能量平移量 U_shift=4(rc⁻¹²−rc⁻⁶)。 */
function ljShift(rc2: number): number {
  const inv6 = 1 / (rc2 * rc2 * rc2)
  return 4 * (inv6 * inv6 - inv6)
}

/** 给定距离平方，返回势能 u 与 F/r（fOverR）。r²≥rc² 归零。 */
export function ljPair(r2: number, rc2: number): { u: number; fOverR: number } {
  if (r2 >= rc2 || r2 <= 0) return { u: 0, fOverR: 0 }
  const inv2 = 1 / r2
  const inv6 = inv2 * inv2 * inv2
  const inv12 = inv6 * inv6
  const u = 4 * (inv12 - inv6) - ljShift(rc2)
  const fOverR = 24 * inv2 * (2 * inv12 - inv6)
  return { u, fOverR }
}

/** 周期盒子内的单组分 LJ 成对力由共享 Rust 内核计算。 */
export const computeForces = computeMdForces

/** 动能 ½Σmv²（约化 m=1）。 */
export function kineticEnergy(vel: Float32Array): number {
  let s = 0
  for (let i = 0; i < vel.length; i++) s += vel[i] * vel[i]
  return 0.5 * s
}

/** 瞬时温度 T = 2·KE/(dim·N)（约化 k_B=1）。 */
export function temperature(vel: Float32Array, N: number, dim: number): number {
  return (2 * kineticEnergy(vel)) / (dim * N)
}

/** 速度重标定恒温器：v *= √(Ttarget/Tcurrent)（原地）。Tcurrent≤0 时不缩放。 */
export function rescaleThermostat(vel: Float32Array, Ttarget: number, Tcurrent: number): void {
  if (Tcurrent <= 0 || !(Ttarget >= 0)) return
  const s = Math.sqrt(Ttarget / Tcurrent)
  for (let i = 0; i < vel.length; i++) vel[i] *= s
}

/** MD 体系状态（约化单位）。velocityVerlet/恒温器原地修改本对象。 */
export type MdState = WasmMd

/** 标准正态抽样（Box–Muller，用同一 uniform RNG）。 */
function gaussian(r: () => number): number {
  let u1 = r()
  if (u1 < 1e-12) u1 = 1e-12
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r())
}

/** 晶格初始化：方形/简单立方 + 扰动 + Maxwell 速度（零动量校正）。 */
export function initialParticles(N: number, L: number, dim: number, T0: number, seed: number) {
  if (!Number.isSafeInteger(N) || N < 1 || N > 65536 || (dim !== 2 && dim !== 3) || !(L > 0) || !Number.isFinite(L) || !(T0 >= 0) || !Number.isFinite(T0)) throw new Error('Invalid MD initial state')
  const r = rng(seed)
  const perSide = Math.ceil(Math.pow(N, 1 / dim))
  const a = L / perSide
  const pos = new Float32Array(N * dim)
  for (let i = 0; i < N; i++) {
    let rem = i
    for (let k = 0; k < dim; k++) {
      const cell = rem % perSide
      rem = Math.floor(rem / perSide)
      let x = (cell + 0.5) * a + (r() - 0.5) * 0.01 * a
      x = ((x % L) + L) % L
      pos[i * dim + k] = x
    }
  }
  const vel = new Float32Array(N * dim)
  const sigma = Math.sqrt(T0) // 约化：每分量方差 = k_B·T/m = T0
  for (let i = 0; i < N * dim; i++) vel[i] = sigma * gaussian(r)
  // 零动量校正（逐分量）
  for (let k = 0; k < dim; k++) {
    let mean = 0
    for (let i = 0; i < N; i++) mean += vel[i * dim + k]
    mean /= N
    for (let i = 0; i < N; i++) vel[i * dim + k] -= mean
  }
  return { pos, vel }
}

/** Random preparation is shared by the browser and Host; the executor receives exact f32 arrays. */
export function prepareMdInput(scene: MdScene) {
  const boxL = mdBoxLength(scene.N)
  const { pos, vel } = initialParticles(scene.N, boxL, 3, scene.temperature, scene.seed)
  return { n: scene.N, dim: 3, boxL, dt: MD_DT, rc: 2.5, pos: Array.from(pos), vel: Array.from(vel) }
}

export function initLattice(N: number, L: number, dim: number, T0: number, seed = 1): MdState {
  const { pos, vel } = initialParticles(N, L, dim, T0, seed)
  return new WasmMd(N, L, dim, 2.5, pos, vel)
}

/** 原地推进共享 Rust 速度 Verlet 内核。 */
export function velocityVerlet(state: MdState, dt: number): void {
  state.step(dt)
}

/** 维里压强 P = ρ·T + virial/(dim·V)，ρ=N/V，V=L^dim（约化）。 */
export function pressure(N: number, L: number, dim: number, T: number, virial: number): number {
  const V = Math.pow(L, dim)
  const rho = N / V
  return rho * T + virial / (dim * V)
}

/** 均方位移 (1/N)·Σ|posUnwrapped−pos0|²（需未回绕轨迹）。 */
export function msd(pos0: Float32Array, posUnwrapped: Float32Array, N: number): number {
  let s = 0
  for (let i = 0; i < posUnwrapped.length; i++) {
    const d = posUnwrapped[i] - pos0[i]
    s += d * d
  }
  return s / N
}
