// User-defined particle dynamics: heterogeneous LJ + screened Coulomb.
// Materials are input data; the solver uses only numeric per-particle properties.
// 维度约定与 mdSim 一致：交互视图为 2D（vec2 WGSL 核 + x,y 渲染）；
// preferCpu=true 的作业/WASM 路径是真实 3D（共享 Rust 内核 + 保序 cell 邻表）。
import { temperature, MD_DT as DT, MD_BATCH_STEPS } from '../sim/md'
import { WasmMd } from '../sim/wasm-fields'
import type { ScreeningParams } from '../sim/interactions'
import { particleCount, particleProperties, initialParticleState, type ParticleScene, type ParticleFrame } from '../sim/particles'
import { writeGpuBuffer } from './writeBuffer'

export interface ParticleSim {
  backend: 'webgpu' | 'cpu'
  readonly N: number; readonly L: number; readonly dim: 2 | 3
  step(steps: number): Promise<void>
  setTemperature(T: number): void
  read(): Promise<ParticleFrame>
  destroy(): void
}

const RC = 2.5

/** preferCpu=true is the job/WASM path (real 3D); the interactive view stays 2D. */
export async function createParticleScene(scene: ParticleScene, preferCpu = false, dim: 2 | 3 = scene.dim ?? (preferCpu ? 3 : 2)) {
  const sim = await createParticleSim(scene, preferCpu, dim)
  sim.setTemperature(scene.thermostat ? scene.temperature : NaN)
  return sim
}

export async function advanceParticleScene(sim: ParticleSim, scene: ParticleScene, completed: number) {
  const count = Math.min(MD_BATCH_STEPS, scene.steps - completed)
  if (count <= 0) throw new Error('Particle scene is already complete')
  await sim.step(count)
  const frame = await sim.read()
  if (![...Object.values(frame.observables), ...frame.pos, ...frame.speed].every(Number.isFinite)) throw new Error('Particle integration diverged; reduce temperature')
  return { frame, steps: completed + count }
}

// ---------- CPU 后端 ----------
class CpuParticleSim implements ParticleSim {
  backend = 'cpu' as const
  readonly dim: 2 | 3
  private st: WasmMd
  private cs: ReturnType<typeof initialParticleState>
  private Ttarget = NaN
  constructor(cfg: ParticleScene, dim: 2 | 3) {
    this.dim = dim
    this.cs = initialParticleState(cfg, dim)
    this.st = new WasmMd(this.cs.kind.length, cfg.boxL, dim, RC, this.cs.pos, this.cs.vel, { ...cfg, ...this.cs })
  }
  get N() { return this.st.N }
  get L() { return this.st.L }
  setTemperature(T: number) { this.Ttarget = T }
  async step(steps: number) {
    this.st.batch(steps, this.Ttarget, { Ptarget: NaN, tauP: 1, dt: DT })
  }
  async read(): Promise<ParticleFrame> {
    return { ...this.st.readParticles(), kind: this.cs.kind.slice(), charge: this.cs.charge.slice() }
  }
  destroy() {}
}

// ---------- WGSL 三核（仅 2D；Params 12 槽 48B） ----------
function ljShiftJs(rc2: number): number { const inv6 = 1 / (rc2 * rc2 * rc2); return 4 * (inv6 * inv6 - inv6) }

const PARAMS_STRUCT = `struct Params { n:f32, L:f32, rc2:f32, shift:f32, dt:f32, half:f32, tScale:f32, kC:f32, epsR:f32, lambdaD:f32, pad0:f32, pad1:f32 };`

const FORCE_WGSL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> pos: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> force: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> pe: array<f32>;
@group(0) @binding(3) var<storage, read_write> vir: array<f32>;
@group(0) @binding(4) var<uniform> p: Params;
@group(0) @binding(5) var<storage, read> q: array<f32>;
@group(0) @binding(6) var<storage, read> sig: array<f32>;
@group(0) @binding(7) var<storage, read> eps: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let N = u32(p.n);
  if (i >= N) { return; }
  let L = p.L; let pi = pos[i]; let qi = q[i];
  var f = vec2<f32>(0.0, 0.0); var pesum = 0.0; var virsum = 0.0;
  for (var j = 0u; j < N; j = j + 1u) {
    if (j == i) { continue; }
    var d = pi - pos[j];
    d = d - L * round(d / L);
    let r2 = dot(d, d);
    if (r2 < p.rc2 && r2 > 0.0) {
      // Lorentz–Berthelot 混合 + 异质 LJ（与 Rust 粒子核一致）。
      let sij = (sig[i] + sig[j]) * 0.5;
      let sigma2 = sij * sij;
      let epsij = sqrt(eps[i] * eps[j]);
      let sr2 = sigma2 / r2;
      let sr6 = sr2 * sr2 * sr2;
      let sr12 = sr6 * sr6;
      let srC2 = sigma2 / p.rc2;
      let srC6 = srC2 * srC2 * srC2;
      let shiftH = 4.0 * epsij * (srC6 * srC6 - srC6);
      let uLj = 4.0 * epsij * (sr12 - sr6) - shiftH;
      let fLj = (24.0 * epsij / r2) * (2.0 * sr12 - sr6);
      // 屏蔽库仑 soft-core（与 Rust 粒子核对齐：r2/epsR/lambdaD 下限）。
      let r2c = max(r2, 1e-8);
      let r = sqrt(r2c);
      let epsR = max(p.epsR, 1e-6);
      let lambdaD = max(p.lambdaD, 1e-6);
      let C = p.kC * qi * q[j] / epsR;
      let e = exp(-r / lambdaD);
      let uC = C * e / r;
      let fC = C * e * (1.0 / (lambdaD * r2c) + 1.0 / (r * r2c));
      let fOverR = fLj + fC;
      f = f + fOverR * d;
      pesum = pesum + 0.5 * (uLj + uC);
      virsum = virsum + 0.5 * fOverR * r2;
    }
  }
  force[i] = f; pe[i] = pesum; vir[i] = virsum;
}
`

const INTA_WGSL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read_write> pos: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> force: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> posU: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> p: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= u32(p.n)) { return; }
  var v = vel[i] + p.half * force[i];
  vel[i] = v;
  let dx = v * p.dt;
  posU[i] = posU[i] + dx;
  var x = pos[i] + dx;
  x = x - p.L * floor(x / p.L);
  pos[i] = x;
}
`

const INTB_WGSL = /* wgsl */ `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> force: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> p: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= u32(p.n)) { return; }
  vel[i] = (vel[i] + p.half * force[i]) * p.tScale;
}
`

// ---------- GPU 后端 ----------
class GpuParticleSim implements ParticleSim {
  backend = 'webgpu' as const
  readonly dim = 2 as const
  private Ttarget = NaN
  private lastT: number
  private pos0: Float32Array
  private cs: ReturnType<typeof particleProperties>
  private params: ScreeningParams
  private frame: ParticleFrame | null = null
  constructor(
    public readonly N: number, public readonly L: number,
    private device: GPUDevice,
    private buf: {
      pos: GPUBuffer; vel: GPUBuffer; force: GPUBuffer; posU: GPUBuffer
      pe: GPUBuffer; vir: GPUBuffer; q: GPUBuffer; sig: GPUBuffer; eps: GPUBuffer
      params: GPUBuffer; staging: GPUBuffer
    },
    private pipe: { force: GPUComputePipeline; intA: GPUComputePipeline; intB: GPUComputePipeline },
    private bind: { force: GPUBindGroup; intA: GPUBindGroup; intB: GPUBindGroup },
    T0: number, posUInit: Float32Array, cs: ReturnType<typeof particleProperties>, params: ScreeningParams,
  ) {
    this.lastT = T0; this.pos0 = posUInit.slice(); this.cs = cs; this.params = params
  }

  setTemperature(T: number) { this.Ttarget = T }

  private writeParams(tScale: number) {
    const rc2 = RC * RC
    writeGpuBuffer(this.device.queue, this.buf.params, 0, new Float32Array([
      this.N, this.L, rc2, ljShiftJs(rc2), DT, 0.5 * DT, tScale,
      this.params.kCoulomb, this.params.epsR, this.params.lambdaD, 0, 0,
    ]))
  }

  async step(steps: number) {
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > MD_BATCH_STEPS) throw new Error('MD batches require 1–4 steps')
    // tScale 每步施加 → 取整批缩放 ^(1/steps)（与 CPU 后端镜像，防 s^steps 过冲发散）。
    this.frame = null
    const sBatch = Number.isNaN(this.Ttarget) || this.lastT <= 0 ? 1 : Math.sqrt(this.Ttarget / this.lastT)
    const tScale = steps > 0 && sBatch !== 1 ? Math.pow(sBatch, 1 / steps) : 1
    this.writeParams(tScale)
    const wg = Math.ceil(this.N / 64)
    const enc = this.device.createCommandEncoder()
    const run = (pipe: GPUComputePipeline, bind: GPUBindGroup) => {
      const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(wg); pass.end()
    }
    for (let k = 0; k < steps; k++) {
      run(this.pipe.intA, this.bind.intA)
      run(this.pipe.force, this.bind.force)
      run(this.pipe.intB, this.bind.intB)
    }
    this.frame = await this.readGpu(enc)
    this.lastT = this.frame.observables.temperature
  }

  async read() {
    this.frame ??= await this.readGpu()
    return { pos: this.frame.pos.slice(), speed: this.frame.speed.slice(), kind: this.frame.kind.slice(), charge: this.frame.charge.slice(), observables: { ...this.frame.observables } }
  }

  private async readGpu(enc = this.device.createCommandEncoder()) {
    const N = this.N
    let off = 0
    const cp = (src: GPUBuffer, bytes: number) => { enc.copyBufferToBuffer(src, 0, this.buf.staging, off, bytes); off += bytes }
    cp(this.buf.pos, N * 8); cp(this.buf.posU, N * 8); cp(this.buf.vel, N * 8); cp(this.buf.pe, N * 4); cp(this.buf.vir, N * 4)
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
    for (let i = 0; i < N; i++) { const vx = vel[i * 2], vy = vel[i * 2 + 1]; speed[i] = Math.sqrt(vx * vx + vy * vy); ke += vx * vx + vy * vy }
    ke *= 0.5
    for (let i = 0; i < N; i++) { potential += peArr[i]; virial += virArr[i] }
    const T = (2 * ke) / (2 * N)
    const V = this.L * this.L
    let m = 0
    for (let i = 0; i < N * 2; i++) { const dd = posU[i] - this.pos0[i]; m += dd * dd }
    const observables: ParticleFrame['observables'] = {
      temperature: T, kinetic: ke, potential, total: ke + potential,
      pressure: (N / V) * T + virial / (2 * V), msd: m / N,
      boxL: this.L, volume: V, density: N / V, // NVT：盒长恒定
      totalCharge: this.cs.charge.reduce((sum, q) => sum + q, 0),
    }
    return { pos, speed, kind: this.cs.kind.slice(), charge: this.cs.charge.slice(), observables }
  }

  destroy() { this.frame = null; Object.values(this.buf).forEach(b => b.destroy()); this.device.destroy() }
}

async function createParticleSim(cfg: ParticleScene, preferCpu: boolean, dim: 2 | 3): Promise<ParticleSim> {
  // The WGSL kernels below are vec2-only; a 3D request never touches them.
  if (preferCpu || dim === 3) return new CpuParticleSim(cfg, dim)
  let ownedDevice: GPUDevice | undefined
  try {
    const gpu = navigator.gpu
    if (!gpu) return new CpuParticleSim(cfg, dim)
    const adapter = await gpu.requestAdapter()
    if (!adapter) return new CpuParticleSim(cfg, dim)
    const device = await adapter.requestDevice()
    ownedDevice = device
    const N = particleCount(cfg), L = cfg.boxL
    const cs = initialParticleState(cfg, dim)
    const st = new WasmMd(N, L, 2, RC, cs.pos, cs.vel, { ...cfg, ...cs })
    const params = cfg, se = cs
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    const mkUp = (data: Float32Array, usage: GPUFlagsConstant) => {
      const b = device.createBuffer({ size: Math.max(8, data.byteLength), usage })
      writeGpuBuffer(device.queue, b, 0, data); return b
    }
    const pos = mkUp(st.pos, S), vel = mkUp(st.vel, S), force = mkUp(st.force, S), posU = mkUp(st.posUnwrapped, S)
    const q = mkUp(cs.charge, S)
    const sig = mkUp(se.sigma, S)
    const eps_b = mkUp(se.eps, S)
    const pe = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const vir = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const params_b = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) // 12×f32
    const staging = device.createBuffer({ size: N * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    const buf = { pos, vel, force, posU, pe, vir, q, sig, eps: eps_b, params: params_b, staging }
    const mod = (code: string) => device.createShaderModule({ code })
    const pp = (code: string) => device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod(code), entryPoint: 'main' } })
    const [forcePipe, intA, intB] = await Promise.all([pp(FORCE_WGSL), pp(INTA_WGSL), pp(INTB_WGSL)])
    const pipe = { force: forcePipe, intA, intB }
    const bg = (pipeline: GPUComputePipeline, entries: { binding: number; buffer: GPUBuffer }[]) =>
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: entries.map((e) => ({ binding: e.binding, resource: { buffer: e.buffer } })) })
    const bind = {
      force: bg(pipe.force, [{ binding: 0, buffer: pos }, { binding: 1, buffer: force }, { binding: 2, buffer: pe }, { binding: 3, buffer: vir }, { binding: 4, buffer: params_b }, { binding: 5, buffer: q }, { binding: 6, buffer: sig }, { binding: 7, buffer: eps_b }]),
      intA: bg(pipe.intA, [{ binding: 0, buffer: pos }, { binding: 1, buffer: vel }, { binding: 2, buffer: force }, { binding: 3, buffer: posU }, { binding: 4, buffer: params_b }]),
      intB: bg(pipe.intB, [{ binding: 0, buffer: vel }, { binding: 1, buffer: force }, { binding: 2, buffer: params_b }]),
    }
    // Initial GPU potential/virial must be available before the first integration step.
    const rc2 = RC * RC
    writeGpuBuffer(device.queue, params_b, 0, new Float32Array([N, L, rc2, ljShiftJs(rc2), DT, 0.5 * DT, 1, params.kCoulomb, params.epsR, params.lambdaD, 0, 0]))
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass()
    pass.setPipeline(pipe.force); pass.setBindGroup(0, bind.force); pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end()
    device.queue.submit([encoder.finish()])
    return new GpuParticleSim(N, L, device, buf, pipe, bind, temperature(st.vel, N, 2), st.posUnwrapped, cs, params)
  } catch {
    ownedDevice?.destroy()
    return new CpuParticleSim(cfg, dim)
  }
}
