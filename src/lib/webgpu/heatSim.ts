// 2D 热扩散仿真：WebGPU compute shader（GPU 优先）或 Rust/WASM CPU。
// 两路后端实现同一 HeatSim 接口；WGSL 与 src/lib/sim/heat.ts 的格式逐字镜像。
import { HeatField, seedHeat2D } from '../sim/heat'
import { writeGpuBuffer } from './writeBuffer'

export interface HeatSim {
  backend: 'webgpu' | 'cpu'
  readonly W: number
  readonly H: number
  /** 在 (x,y) 半径 radius 内注入热量。 */
  seed(x: number, y: number, radius: number, amount: number): void
  /** 推进 iterations 步（扩散系数 r ≤ 0.25 稳定）。 */
  step(r: number, iterations: number): Promise<void>
  /** 取当前场（行优先 W×H）用于渲染。 */
  field(): Promise<Float32Array>
  dispose(): void
}

const WGSL = /* wgsl */ `
struct Params { dims: vec2<f32>, r: f32, _pad: f32 };
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let W = u32(p.dims.x); let H = u32(p.dims.y);
  let x = gid.x; let y = gid.y;
  if (x >= W || y >= H) { return; }
  let idx = y * W + x;
  let c = inp[idx];
  // 绝热边界：越界取自身（select 两分支都求值，故用安全索引避免越界）
  let xm = select(x, x - 1u, x > 0u);
  let xp = select(x, x + 1u, x < W - 1u);
  let ym = select(y, y - 1u, y > 0u);
  let yp = select(y, y + 1u, y < H - 1u);
  let n = inp[ym * W + x];
  let s = inp[yp * W + x];
  let w = inp[y * W + xm];
  let e = inp[y * W + xp];
  outp[idx] = c + p.r * (n + s + w + e - 4.0 * c);
}
`

// ---------- CPU 后端 ----------
class CpuHeatSim implements HeatSim {
  backend = 'cpu' as const
  private heat: HeatField
  constructor(public readonly W: number, public readonly H: number) {
    this.heat = new HeatField(W, H)
  }
  seed(x: number, y: number, radius: number, amount: number) {
    this.heat.seed({ x, y, radius, amount })
  }
  async step(r: number, iterations: number) {
    for (let k = 0; k < iterations; k++) this.heat.step(r)
  }
  async field() { return this.heat.field }
  dispose() {}
}

// ---------- WebGPU 后端 ----------
class GpuHeatSim implements HeatSim {
  backend = 'webgpu' as const
  private shadow: Float32Array
  /** true = GPU 已 step、shadow 尚未从 GPU 回读。 */
  private dirty = false
  /** seed() 在 dirty 时入队，step/field 前 flush。 */
  private pendingSeeds: Array<{ x: number; y: number; radius: number; amount: number }> = []

  constructor(
    public readonly W: number, public readonly H: number,
    private device: GPUDevice,
    private bufA: GPUBuffer,
    private bufB: GPUBuffer,
    private params: GPUBuffer,
    private pipeline: GPUComputePipeline,
    private staging: GPUBuffer,
  ) {
    this.shadow = new Float32Array(W * H)
  }

  /** 仅改 shadow（圆盘热源），不写 GPU。 */
  private applySeed(x: number, y: number, radius: number, amount: number) {
    seedHeat2D(this.shadow, this.W, this.H, { x, y, radius, amount })
  }

  /** 从 GPU bufA 回读到 shadow。 */
  private async pullField() {
    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(this.bufA, 0, this.staging, 0, this.shadow.byteLength)
    this.device.queue.submit([enc.finish()])
    await this.staging.mapAsync(GPUMapMode.READ)
    this.shadow = new Float32Array(this.staging.getMappedRange().slice(0))
    this.staging.unmap()
    this.dirty = false
  }

  /** 若有 pending seeds：必要时先 pull，再 apply 并整缓冲写回 bufA。 */
  private async flushSeeds() {
    if (this.pendingSeeds.length === 0) return
    if (this.dirty) await this.pullField()
    for (const s of this.pendingSeeds) this.applySeed(s.x, s.y, s.radius, s.amount)
    this.pendingSeeds = []
    writeGpuBuffer(this.device.queue, this.bufA, 0, this.shadow)
    this.dirty = false
  }

  seed(x: number, y: number, radius: number, amount: number) {
    // 同步 API：shadow 仍与 GPU 一致时可立即写；否则入队，避免用过期影子覆盖已扩散场。
    if (this.dirty) {
      this.pendingSeeds.push({ x, y, radius, amount })
      return
    }
    this.applySeed(x, y, radius, amount)
    writeGpuBuffer(this.device.queue, this.bufA, 0, this.shadow)
  }

  async step(r: number, iterations: number) {
    await this.flushSeeds()
    writeGpuBuffer(this.device.queue, this.params, 0, new Float32Array([this.W, this.H, r, 0]))
    for (let k = 0; k < iterations; k++) {
      const bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.bufA } },
          { binding: 1, resource: { buffer: this.bufB } },
          { binding: 2, resource: { buffer: this.params } },
        ],
      })
      const enc = this.device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, bind)
      pass.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8))
      pass.end()
      this.device.queue.submit([enc.finish()])
      ;[this.bufA, this.bufB] = [this.bufB, this.bufA] // ping-pong
    }
    this.dirty = true
  }

  async field() {
    if (this.dirty) await this.pullField()
    if (this.pendingSeeds.length > 0) {
      for (const s of this.pendingSeeds) this.applySeed(s.x, s.y, s.radius, s.amount)
      this.pendingSeeds = []
      writeGpuBuffer(this.device.queue, this.bufA, 0, this.shadow)
    }
    return this.shadow
  }

  dispose() {
    this.bufA.destroy()
    this.bufB.destroy()
    this.params.destroy()
    this.staging.destroy()
    this.device.destroy()
  }
}

/** 创建热扩散仿真：能用 WebGPU 就用，否则 Rust/WASM CPU；两者不可用时明确报错。 */
export async function createHeatSim(W: number, H: number, opts?: { preferCpu?: boolean }): Promise<HeatSim> {
  if (opts?.preferCpu) return new CpuHeatSim(W, H)
  let ownedDevice: GPUDevice | undefined
  try {
    const gpu = navigator.gpu
    if (!gpu) return new CpuHeatSim(W, H)
    const adapter = await gpu.requestAdapter()
    if (!adapter) return new CpuHeatSim(W, H)
    const device = await adapter.requestDevice()
    ownedDevice = device
    const n = W * H
    const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    const mk = (usage: number) => device.createBuffer({ size: n * 4, usage })
    const bufA = mk(storageUsage)
    const bufB = mk(storageUsage)
    writeGpuBuffer(device.queue, bufA, 0, new Float32Array(n))
    const params = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const staging = device.createBuffer({
      size: n * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
    const module = device.createShaderModule({ code: WGSL })
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    return new GpuHeatSim(W, H, device, bufA, bufB, params, pipeline, staging)
  } catch {
    ownedDevice?.destroy()
    return new CpuHeatSim(W, H)
  }
}
