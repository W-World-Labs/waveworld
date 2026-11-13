// 分子动力学仿真：WebGPU FP32 或 Rust/WASM CPU，同一 MdSim 接口。
// WGSL 与 src/lib/sim/md.ts 使用同一 LJ 力和 Verlet 格式（浮点结果允许舍入差异）；GPU 上每粒子分摊势能/维里到
// storage buffer，CPU 求和归约（沿用 mcSim 的 GPU-per-item + CPU-reduce 模式）。
// 维度约定：交互视图保持 2D（GPU 核为 vec2，页面按 x,y 渲染）；preferCpu=true 的作业/后端路径
// 为真实 3D（共享 Rust 内核，保序 cell 邻表）。请求 dim=3 总是落在 CPU 上——GPU 不会伪装成 3D。
import {
  initLattice, temperature,
  MD_DT as DT, MD_BATCH_STEPS, mdBoxLength, type MdState, type MdScene,
  type MdObservables, type MdFrame, type MdHistory,
} from '../sim/md'
import { writeGpuBuffer } from './writeBuffer'

export interface MdSim {
  backend: 'webgpu' | 'cpu'
  /** NPT 压浴是否真正生效（GPU 后端当前为 false）。 */
  readonly supportsBarostat: boolean
  readonly N: number
  readonly L: number
  readonly dim: 2 | 3
  /** 推进一批 1–4 个 Verlet 步；批次大小参与控温。 */
  step(steps: number): Promise<void>
  /** 设恒温器目标温度；传 NaN 关闭恒温器（跑 NVE）。 */
  setTemperature(T: number): void
  /** 设 Berendsen 压浴目标压强 Ptarget 与弛豫时间 τ_P；Ptarget=NaN 关闭（跑 NVT/NVE）。仅 supportsBarostat 时生效。 */
  setBarostat(Ptarget: number, tauP: number): void
  /** 读当前位置（回绕，长度 N·dim）、逐粒子速度幅值 speed（长度 N）与观测量。 */
  read(): Promise<MdFrame>
  destroy(): void
}

export interface MdConfig {
  N: number; L: number; T0: number; seed?: number
  /** 强制 CPU（作业路径 / NPT / 中途 GPU 失败热切换时用）。 */
  preferCpu?: boolean
  /** 2（默认，交互视图）或 3（作业/WASM 路径）。GPU 仅支持 2D，dim=3 总是 CPU。 */
  dim?: 2 | 3
}

/**
 * Shared scene setup; the existing barostat runs only on CPU.
 * preferCpu=true is the job/WASM path and is real 3D. The interactive call
 * keeps the legacy 2D box (ρ=0.8 area density) so the 2D view is unchanged;
 * callers that need a 2D CPU sim explicitly may pass dim.
 */
export async function createMdScene(scene: MdScene, preferCpu = false, dim: 2 | 3 = preferCpu ? 3 : 2): Promise<MdSim> {
  const L = dim === 3 ? mdBoxLength(scene.N) : Math.sqrt(scene.N / 0.8)
  const sim = await createMdSim({ N: scene.N, L, T0: scene.temperature, seed: scene.seed, preferCpu: preferCpu || scene.barostat, dim })
  sim.setTemperature(scene.thermostat ? scene.temperature : NaN)
  sim.setBarostat(scene.barostat ? scene.targetP : NaN, scene.tauP)
  return sim
}

/** Keep thermostat batches and samples identical regardless of RAF cadence or compute location. */
export async function advanceMdScene(sim: MdSim, scene: MdScene, completed: number, history: MdHistory) {
  const count = Math.min(MD_BATCH_STEPS, scene.steps - completed)
  if (count <= 0) throw new Error('MD scene is already complete')
  await sim.step(count)
  const frame = await sim.read()
  if (![...Object.values(frame.observables), ...frame.pos, ...frame.speed].every(Number.isFinite)) throw new Error('MD integration diverged; reduce temperature or pressure coupling')
  if (frame.observables.boxL <= 5) throw new Error('MD box is too small for the 2.5 cutoff; reduce pressure coupling')
  const steps = completed + count
  history.push({ step: steps, time: steps * DT, msd: frame.observables.msd })
  return { steps, frame }
}

// ---------- CPU 后端 ----------
class CpuMdSim implements MdSim {
  backend = 'cpu' as const
  readonly supportsBarostat = true
  readonly dim: 2 | 3
  private st: MdState
  private Ttarget = NaN
  private barostatP = NaN
  private barostatTau = 1

  constructor(cfg: MdConfig) {
    this.dim = cfg.dim ?? 2
    this.st = initLattice(cfg.N, cfg.L, this.dim, cfg.T0, cfg.seed ?? 1)
  }
  get N() { return this.st.N }
  get L() { return this.st.L }
  async step(steps: number) {
    this.st.batch(steps, this.Ttarget, { Ptarget: this.barostatP, tauP: this.barostatTau, dt: DT })
  }
  setTemperature(T: number) { this.Ttarget = T }
  setBarostat(Ptarget: number, tauP: number) { this.barostatP = Ptarget; this.barostatTau = tauP }
  async read() { return this.st.read() }
  destroy() {}
}

// ---------- WebGPU 后端 ----------
// Params 布局（8×f32 = 32B）：[n, L, rc2, shift, dt, half, tScale, pad]
function ljShiftJs(rc2: number): number {
  const inv6 = 1 / (rc2 * rc2 * rc2)
  return 4 * (inv6 * inv6 - inv6)
}

const FORCE_WGSL = /* wgsl */ `
struct Params { n:f32, L:f32, rc2:f32, shift:f32, dt:f32, half:f32, tScale:f32, pad:f32 };
@group(0) @binding(0) var<storage, read> pos: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> force: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> pe: array<f32>;
@group(0) @binding(3) var<storage, read_write> vir: array<f32>;
@group(0) @binding(4) var<uniform> p: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let N = u32(p.n);
  if (i >= N) { return; }
  let L = p.L; let pi = pos[i];
  var f = vec2<f32>(0.0, 0.0); var pesum = 0.0; var virsum = 0.0;
  for (var j = 0u; j < N; j = j + 1u) {
    if (j == i) { continue; }
    var d = pi - pos[j];
    d = d - L * round(d / L);          // 最小镜像（镜像 md.ts: dk -= L*round(dk/L)）
    let r2 = dot(d, d);
    if (r2 < p.rc2 && r2 > 0.0) {
      let inv2 = 1.0 / r2;
      let inv6 = inv2 * inv2 * inv2;
      let inv12 = inv6 * inv6;
      let u = 4.0 * (inv12 - inv6) - p.shift;
      let fOverR = 24.0 * inv2 * (2.0 * inv12 - inv6);
      f = f + fOverR * d;
      pesum = pesum + 0.5 * u;          // 每对 ½（i、j 各记一半 → Σ=总势能）
      virsum = virsum + 0.5 * fOverR * r2;
    }
  }
  force[i] = f; pe[i] = pesum; vir[i] = virsum;
}
`

const INTA_WGSL = /* wgsl */ `
struct Params { n:f32, L:f32, rc2:f32, shift:f32, dt:f32, half:f32, tScale:f32, pad:f32 };
@group(0) @binding(0) var<storage, read_write> pos: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> force: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> posU: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> p: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= u32(p.n)) { return; }
  var v = vel[i] + p.half * force[i];   // v += ½a·dt
  vel[i] = v;
  let dx = v * p.dt;
  posU[i] = posU[i] + dx;               // 未回绕累积
  var x = pos[i] + dx;
  x = x - p.L * floor(x / p.L);         // 回绕到 [0,L)（镜像 md.ts floor 写法）
  pos[i] = x;
}
`

const INTB_WGSL = /* wgsl */ `
struct Params { n:f32, L:f32, rc2:f32, shift:f32, dt:f32, half:f32, tScale:f32, pad:f32 };
@group(0) @binding(0) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> force: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> p: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= u32(p.n)) { return; }
  vel[i] = (vel[i] + p.half * force[i]) * p.tScale; // v += ½a·dt 后恒温缩放
}
`

class GpuMdSim implements MdSim {
  backend = 'webgpu' as const
  readonly supportsBarostat = false
  readonly dim = 2 as const
  private Ttarget = NaN
  private lastT: number
  private pos0: Float32Array
  private frame: MdFrame | null = null
  constructor(
    public readonly N: number, public readonly L: number,
    private device: GPUDevice,
    private buf: {
      pos: GPUBuffer; vel: GPUBuffer; force: GPUBuffer; posU: GPUBuffer
      pe: GPUBuffer; vir: GPUBuffer; params: GPUBuffer; staging: GPUBuffer
    },
    private pipe: { force: GPUComputePipeline; intA: GPUComputePipeline; intB: GPUComputePipeline },
    private bind: { force: GPUBindGroup; intA: GPUBindGroup; intB: GPUBindGroup },
    T0: number, posUInit: Float32Array,
  ) {
    this.lastT = T0
    this.pos0 = posUInit.slice()
  }

  setTemperature(T: number) { this.Ttarget = T }
  // NPT 仅 CPU 路径（方案 A：GPU 力核/积分核零改动，盒缩放需 GPU 坐标回写留后续）。
  setBarostat(_Ptarget: number, _tauP: number) { void _Ptarget; void _tauP }

  private writeParams(tScale: number) {
    const rc2 = 2.5 * 2.5
    // [n, L, rc2, shift, dt, half, tScale, pad]
    writeGpuBuffer(this.device.queue, this.buf.params, 0, new Float32Array([
      this.N, this.L, rc2, ljShiftJs(rc2), DT, 0.5 * DT, tScale, 0,
    ]))
  }

  async step(steps: number) {
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > MD_BATCH_STEPS) throw new Error('MD batches require 1–4 steps')
    // tScale 在 intB 核每步施加，故必须取整批缩放的 ^(1/steps)（与 CPU 后端镜像，防 s^steps 过冲发散）。
    this.frame = null
    const sBatch = Number.isNaN(this.Ttarget) || this.lastT <= 0
      ? 1 : Math.sqrt(this.Ttarget / this.lastT)
    const tScale = steps > 0 && sBatch !== 1 ? Math.pow(sBatch, 1 / steps) : 1
    this.writeParams(tScale)
    const wg = Math.ceil(this.N / 64)
    const enc = this.device.createCommandEncoder()
    const run = (pipe: GPUComputePipeline, bind: GPUBindGroup) => {
      const pass = enc.beginComputePass()
      pass.setPipeline(pipe); pass.setBindGroup(0, bind)
      pass.dispatchWorkgroups(wg); pass.end()
    }
    for (let k = 0; k < steps; k++) {
      run(this.pipe.intA, this.bind.intA)   // v½ + x + posU + wrap（用旧力）
      run(this.pipe.force, this.bind.force) // 新力 + 分摊 pe/vir
      run(this.pipe.intB, this.bind.intB)   // v½（新力）+ 恒温缩放
    }
    // Submit this ordered batch and its readback together. Reuse the same snapshot
    // for the thermostat and renderer until the next batch changes GPU state.
    this.frame = await this.readGpu(enc)
    this.lastT = this.frame.observables.temperature
  }

  async read() {
    this.frame ??= await this.readGpu()
    // Callers own their arrays; editing a readout must not mutate the cached state.
    return { pos: this.frame.pos.slice(), speed: this.frame.speed.slice(), observables: { ...this.frame.observables } }
  }

  private async readGpu(enc = this.device.createCommandEncoder()) {
    const N = this.N
    // 一次性把 pos/posU/vel(各 N*8) + pe/vir(各 N*4) 拷到 staging 不同 offset
    let off = 0
    const cp = (src: GPUBuffer, bytes: number) => { enc.copyBufferToBuffer(src, 0, this.buf.staging, off, bytes); off += bytes }
    cp(this.buf.pos, N * 8); cp(this.buf.posU, N * 8); cp(this.buf.vel, N * 8)
    cp(this.buf.pe, N * 4); cp(this.buf.vir, N * 4)
    this.device.queue.submit([enc.finish()])
    await this.buf.staging.mapAsync(GPUMapMode.READ)
    const ab = this.buf.staging.getMappedRange().slice(0)
    this.buf.staging.unmap()
    const f32 = new Float32Array(ab)
    const pos = f32.subarray(0, N * 2).slice()
    const posU = f32.subarray(N * 2, N * 4)
    const vel = f32.subarray(N * 4, N * 6)
    const peArr = f32.subarray(N * 6, N * 7)
    const virArr = f32.subarray(N * 7, N * 8)
    let ke = 0, potential = 0, virial = 0
    const speed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const vx = vel[i * 2], vy = vel[i * 2 + 1]
      speed[i] = Math.sqrt(vx * vx + vy * vy)
      ke += vx * vx + vy * vy
    }
    ke *= 0.5
    for (let i = 0; i < N; i++) { potential += peArr[i]; virial += virArr[i] }
    const T = (2 * ke) / (2 * N)
    const V = this.L * this.L
    let m = 0
    for (let i = 0; i < N * 2; i++) { const d = posU[i] - this.pos0[i]; m += d * d }
    const observables: MdObservables = {
      temperature: T, kinetic: ke, potential, total: ke + potential,
      pressure: (N / V) * T + virial / (2 * V), msd: m / N,
      boxL: this.L, volume: V, density: N / V, // GPU 后端无 NPT：盒长恒定
    }
    return { pos, speed, observables }
  }

  destroy() {
    this.frame = null
    Object.values(this.buf).forEach((b) => b.destroy())
    this.device.destroy()
  }
}

/** 创建 MD 仿真：能用 WebGPU 就用（大 N），否则 Rust/WASM CPU（不可用时显式报错）。preferCpu 或 dim=3 强制 CPU。 */
export async function createMdSim(cfg: MdConfig): Promise<MdSim> {
  // The WGSL kernels below are vec2-only; a 3D request never touches them.
  if (cfg.preferCpu || cfg.dim === 3) return new CpuMdSim(cfg)
  let ownedDevice: GPUDevice | undefined
  try {
    const gpu = navigator.gpu
    if (!gpu) return new CpuMdSim(cfg)
    const adapter = await gpu.requestAdapter()
    if (!adapter) return new CpuMdSim(cfg)
    const device = await adapter.requestDevice()
    ownedDevice = device
    const { N, L } = cfg
    // CPU 端 initLattice 产生自洽初态（含一次力），直接上传 GPU。
    const st = initLattice(N, L, 2, cfg.T0, cfg.seed ?? 1)
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    const mkUp = (data: Float32Array, usage: GPUFlagsConstant) => {
      const b = device.createBuffer({ size: Math.max(8, data.byteLength), usage })
      writeGpuBuffer(device.queue, b, 0, data); return b
    }
    const pos = mkUp(st.pos, S)
    const vel = mkUp(st.vel, S)
    const force = mkUp(st.force, S)
    const posU = mkUp(st.posUnwrapped, S)
    const pe = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const vir = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const staging = device.createBuffer({ size: N * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    const buf = { pos, vel, force, posU, pe, vir, params, staging }
    const mod = (code: string) => device.createShaderModule({ code })
    const pp = (code: string) => device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod(code), entryPoint: 'main' } })
    const [forcePipe, intA, intB] = await Promise.all([pp(FORCE_WGSL), pp(INTA_WGSL), pp(INTB_WGSL)])
    const pipe = { force: forcePipe, intA, intB }
    const bg = (pipeline: GPUComputePipeline, entries: { binding: number; buffer: GPUBuffer }[]) =>
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: entries.map((e) => ({ binding: e.binding, resource: { buffer: e.buffer } })) })
    const bind = {
      force: bg(pipe.force, [{ binding: 0, buffer: pos }, { binding: 1, buffer: force }, { binding: 2, buffer: pe }, { binding: 3, buffer: vir }, { binding: 4, buffer: params }]),
      intA: bg(pipe.intA, [{ binding: 0, buffer: pos }, { binding: 1, buffer: vel }, { binding: 2, buffer: force }, { binding: 3, buffer: posU }, { binding: 4, buffer: params }]),
      intB: bg(pipe.intB, [{ binding: 0, buffer: vel }, { binding: 1, buffer: force }, { binding: 2, buffer: params }]),
    }
    // Initialize per-particle potential/virial so a read before the first step is valid.
    const rc2 = 2.5 * 2.5
    writeGpuBuffer(device.queue, params, 0, new Float32Array([N, L, rc2, ljShiftJs(rc2), DT, 0.5 * DT, 1, 0]))
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipe.force); pass.setBindGroup(0, bind.force)
    pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end()
    device.queue.submit([encoder.finish()])
    return new GpuMdSim(N, L, device, buf, pipe, bind, temperature(st.vel, N, 2), st.posUnwrapped)
  } catch {
    ownedDevice?.destroy()
    return new CpuMdSim(cfg)
  }
}
