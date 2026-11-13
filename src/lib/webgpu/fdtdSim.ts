// 2D FDTD（TMz 麦克斯韦场）仿真：WebGPU compute（GPU 优先）或 Rust/WASM CPU（兜底），同一 FdtdSim 接口。
// WGSL 更新核与 W-Sim Rust 的离散方程采用 FP32 实现（同 Yee 索引 idx=j·Nx+i、同 dt/ε、
// 同 Mur 一阶 ABC / PEC 边界、同 PEC 掩膜）。GPU 不可用或任何初始化失败时静默回退 CPU。
//
// GPU 单步与 CPU fdtdStep 同序：updateH → updateE(+pecMask) → applyBoundary → cachePrev。
// 源注入（软源 Ez += value）在步间用 writeBuffer 直改 Ez（与 CPU injectSoftSource 等价）。
import {
  createField, fdtdStep, injectSoftSource,
  type FdtdField, type FdtdBoundary, type CreateFieldOpts,
} from '../sim/fdtd'
import { writeGpuBuffer } from './writeBuffer'

/** read() 返回的元信息（与 CPU/GPU 后端一致）。 */
export interface FdtdMeta {
  Nx: number
  Ny: number
  dt: number
  boundary: FdtdBoundary
  backend: 'webgpu' | 'cpu'
}

export interface FdtdSim {
  backend: 'webgpu' | 'cpu'
  readonly Nx: number
  readonly Ny: number
  /** 推进 steps 个完整 FDTD 步（H→E→边界）。源在步间已注入。 */
  step(steps: number): Promise<void>
  /** 读当前 Ez 场（行优先 Nx×Ny，idx=j·Nx+i）与元信息。 */
  read(): Promise<{ Ez: Float32Array; meta: FdtdMeta }>
  /** 软源：在格 (ix,iy) 叠加注入 value（Ez += value，下一次 step 前生效）。 */
  injectSource(ix: number, iy: number, value: number): void
  /** setSource 是 injectSource 的别名（语义同：软源叠加注入）。 */
  setSource(ix: number, iy: number, value: number): void
  destroy(): void
}

export interface FdtdConfig {
  Nx: number
  Ny: number
  /** Courant 数 S（缺省同 createField）。 */
  S?: number
  /** 约化磁导率 μ（缺省 1）。 */
  mu?: number
  /** 边界（缺省 'mur'）。 */
  boundary?: FdtdBoundary
  /** 初始逐格 εR（缺省全 1）；长度需为 Nx·Ny。 */
  eps?: Float32Array
  /** PEC 掩膜（缺省无）。 */
  pecMask?: Uint8Array | null
  /** 强制 CPU（中途 GPU 失败热切换）。 */
  preferCpu?: boolean
}

function fieldOpts(cfg: FdtdConfig): CreateFieldOpts {
  return { S: cfg.S, mu: cfg.mu, boundary: cfg.boundary, eps: cfg.eps, pecMask: cfg.pecMask }
}

// ---------- CPU 后端 ----------
// fdtd.ts 仅适配 Rust/WASM（fdtdStep/injectSoftSource），不保留 JS 数值推进。
class CpuFdtdSim implements FdtdSim {
  backend = 'cpu' as const
  readonly Nx: number
  readonly Ny: number
  private f: FdtdField

  constructor(cfg: FdtdConfig) {
    this.Nx = cfg.Nx
    this.Ny = cfg.Ny
    this.f = createField(cfg.Nx, cfg.Ny, fieldOpts(cfg))
  }

  async step(steps: number) {
    for (let k = 0; k < steps; k++) fdtdStep(this.f)
  }

  injectSource(ix: number, iy: number, value: number) {
    injectSoftSource(this.f, ix, iy, value)
  }
  setSource(ix: number, iy: number, value: number) {
    this.injectSource(ix, iy, value)
  }

  async read() {
    const meta: FdtdMeta = {
      Nx: this.Nx, Ny: this.Ny, dt: this.f.dt, boundary: this.f.boundary, backend: 'cpu',
    }
    return { Ez: this.f.Ez.slice(), meta }
  }

  destroy() {}
}

// ---------- WebGPU 后端 ----------
// Params 布局（uniform，8×f32=32B）：[Nx, Ny, coef(=dt/μ), cMur, boundary(0=mur,1=pec), pad, pad, pad]
// （dt/ε 在 E 核里逐格除以 eps[idx]；coef=dt/μ 对应 updateH 的 dt/mu。）

const UPDATE_H_WGSL = /* wgsl */ `
struct Params { nx:f32, ny:f32, coef:f32, cmur:f32, bnd:f32, p0:f32, p1:f32, p2:f32 };
@group(0) @binding(0) var<storage, read> Ez: array<f32>;
@group(0) @binding(1) var<storage, read_write> Hx: array<f32>;
@group(0) @binding(2) var<storage, read_write> Hy: array<f32>;
@group(0) @binding(3) var<uniform> p: Params;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let Nx = u32(p.nx); let Ny = u32(p.ny);
  let i = gid.x; let j = gid.y;
  if (i >= Nx || j >= Ny) { return; }
  let idx = j * Nx + i;
  // ∂Ez/∂y：Ez[i,j+1] − Ez[i,j]（最高行无 j+1 邻居则 0）
  var dEzdy = 0.0;
  if (j + 1u < Ny) { dEzdy = Ez[idx + Nx] - Ez[idx]; }
  Hx[idx] = Hx[idx] - p.coef * dEzdy;
  // ∂Ez/∂x：Ez[i+1,j] − Ez[i,j]（最高列无 i+1 邻居则 0）
  var dEzdx = 0.0;
  if (i + 1u < Nx) { dEzdx = Ez[idx + 1u] - Ez[idx]; }
  Hy[idx] = Hy[idx] + p.coef * dEzdx;
}
`

// updateE：仅更新内点 i,j∈[1,N−1)；curlH=(Hy[idx]−Hy[idx−1])−(Hx[idx]−Hx[idx−Nx])；
// Ez += (dt/ε)·curlH（这里把 dt 折进 epsInv = dt/ε，预乘后上传）。再应用 PEC 掩膜。
const UPDATE_E_WGSL = /* wgsl */ `
struct Params { nx:f32, ny:f32, coef:f32, cmur:f32, bnd:f32, p0:f32, p1:f32, p2:f32 };
@group(0) @binding(0) var<storage, read_write> Ez: array<f32>;
@group(0) @binding(1) var<storage, read> Hx: array<f32>;
@group(0) @binding(2) var<storage, read> Hy: array<f32>;
@group(0) @binding(3) var<storage, read> epsInv: array<f32>; // = dt / eps[idx]
@group(0) @binding(4) var<storage, read> pecMask: array<u32>; // 0=非PEC，非0=PEC（强制0）
@group(0) @binding(5) var<uniform> p: Params;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let Nx = u32(p.nx); let Ny = u32(p.ny);
  let i = gid.x; let j = gid.y;
  if (i >= Nx || j >= Ny) { return; }
  let idx = j * Nx + i;
  if (i >= 1u && i < Nx - 1u && j >= 1u && j < Ny - 1u) {
    let curlH = (Hy[idx] - Hy[idx - 1u]) - (Hx[idx] - Hx[idx - Nx]);
    Ez[idx] = Ez[idx] + epsInv[idx] * curlH;
  }
  if (pecMask[idx] != 0u) { Ez[idx] = 0.0; }
}
`

// applyBoundary：bnd=1 → PEC（边界 Ez=0）；bnd=0 → 一阶 Mur ABC，逐字镜像 fdtd.ts。
// prev* 缓存四边「内一格」上一时刻值；本核读 prev* 写边界 Ez，并在末尾把当前内一格刷回 prev*。
// 用单 workgroup（1×1 dispatch）串行扫四边，保证写边界与刷 prev 的读写次序与 CPU 一致。
const APPLY_BND_WGSL = /* wgsl */ `
struct Params { nx:f32, ny:f32, coef:f32, cmur:f32, bnd:f32, p0:f32, p1:f32, p2:f32 };
@group(0) @binding(0) var<storage, read_write> Ez: array<f32>;
@group(0) @binding(1) var<storage, read_write> prevLeft: array<f32>;
@group(0) @binding(2) var<storage, read_write> prevRight: array<f32>;
@group(0) @binding(3) var<storage, read_write> prevBottom: array<f32>;
@group(0) @binding(4) var<storage, read_write> prevTop: array<f32>;
@group(0) @binding(5) var<uniform> p: Params;
@compute @workgroup_size(1)
fn main() {
  let Nx = u32(p.nx); let Ny = u32(p.ny);
  if (p.bnd > 0.5) {
    // PEC：上下两行 + 左右两列 Ez=0
    for (var i = 0u; i < Nx; i = i + 1u) {
      Ez[i] = 0.0;
      Ez[(Ny - 1u) * Nx + i] = 0.0;
    }
    for (var j = 0u; j < Ny; j = j + 1u) {
      Ez[j * Nx] = 0.0;
      Ez[j * Nx + Nx - 1u] = 0.0;
    }
    return;
  }
  let c = p.cmur;
  // 左/右沿 x 外推（镜像 fdtd.ts）
  for (var j = 0u; j < Ny; j = j + 1u) {
    let lb = j * Nx; let li = j * Nx + 1u;
    Ez[lb] = prevLeft[j] + c * (Ez[li] - Ez[lb]);
    let rb = j * Nx + (Nx - 1u); let ri = j * Nx + (Nx - 2u);
    Ez[rb] = prevRight[j] + c * (Ez[ri] - Ez[rb]);
  }
  // 下/上沿 y 外推
  for (var i = 0u; i < Nx; i = i + 1u) {
    let bb = i; let bi = Nx + i;
    Ez[bb] = prevBottom[i] + c * (Ez[bi] - Ez[bb]);
    let tb = (Ny - 1u) * Nx + i; let ti = (Ny - 2u) * Nx + i;
    Ez[tb] = prevTop[i] + c * (Ez[ti] - Ez[tb]);
  }
  // 缓存内一格当前值供下一步作 prev（与 fdtd.ts 末尾一致）
  for (var j = 0u; j < Ny; j = j + 1u) {
    prevLeft[j] = Ez[j * Nx + 1u];
    prevRight[j] = Ez[j * Nx + (Nx - 2u)];
  }
  for (var i = 0u; i < Nx; i = i + 1u) {
    prevBottom[i] = Ez[Nx + i];
    prevTop[i] = Ez[(Ny - 2u) * Nx + i];
  }
}
`

// WebGPU 资源句柄（类型来自 @webgpu/types，见 vite-env.d.ts）。
interface GpuBuffers {
  Ez: GPUBuffer
  Hx: GPUBuffer
  Hy: GPUBuffer
  epsInv: GPUBuffer
  pecMask: GPUBuffer
  prevLeft: GPUBuffer
  prevRight: GPUBuffer
  prevBottom: GPUBuffer
  prevTop: GPUBuffer
  params: GPUBuffer
  staging: GPUBuffer
}

interface GpuPipes {
  h: GPUComputePipeline
  e: GPUComputePipeline
  bnd: GPUComputePipeline
}

interface GpuBinds {
  h: GPUBindGroup
  e: GPUBindGroup
  bnd: GPUBindGroup
}

class GpuFdtdSim implements FdtdSim {
  backend = 'webgpu' as const
  readonly Nx: number
  readonly Ny: number
  private dt: number
  private boundary: FdtdBoundary
  // Ez 的 CPU 影子：注入前若 shadowStale 则先 pullEz 再叠加；step 后标记 stale。
  private shadow: Float32Array
  /** 同步 injectSource 排队的软源，在 step/read 前 flush 到 GPU。 */
  private pendingInjects: Array<{ ix: number; iy: number; value: number }> = []
  /** true = GPU Ez 已推进、shadow 尚未回读同步。 */
  private shadowStale = false

  constructor(
    cfg: FdtdConfig,
    private device: GPUDevice,
    private buf: GpuBuffers,
    private pipe: GpuPipes,
    private bind: GpuBinds,
    dt: number,
  ) {
    this.Nx = cfg.Nx
    this.Ny = cfg.Ny
    this.dt = dt
    this.boundary = cfg.boundary ?? 'mur'
    this.shadow = new Float32Array(cfg.Nx * cfg.Ny)
  }

  /** 从 GPU 回读 Ez 覆盖 shadow（不返回场，仅同步影子）。 */
  private async pullEz() {
    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(this.buf.Ez, 0, this.buf.staging, 0, this.shadow.byteLength)
    this.device.queue.submit([enc.finish()])
    await this.buf.staging.mapAsync(GPUMapMode.READ)
    this.shadow = new Float32Array(this.buf.staging.getMappedRange().slice(0))
    this.buf.staging.unmap()
    this.shadowStale = false
  }

  /** 将 pendingInjects 叠加到最新 Ez 并单格 writeBuffer；shadowStale 时先 pull。 */
  private async flushInjects() {
    if (this.pendingInjects.length === 0) return
    if (this.shadowStale) await this.pullEz()
    for (const { ix, iy, value } of this.pendingInjects) {
      const idx = iy * this.Nx + ix
      this.shadow[idx] += value
      writeGpuBuffer(this.device.queue, this.buf.Ez, idx * 4, this.shadow.subarray(idx, idx + 1))
    }
    this.pendingInjects = []
  }

  async step(steps: number) {
    const wgx = Math.ceil(this.Nx / 8)
    const wgy = Math.ceil(this.Ny / 8)
    for (let k = 0; k < steps; k++) {
      // 每步前 flush 软源，保证 inject→step 多轮时叠加在最新 GPU 场上。
      await this.flushInjects()
      const enc = this.device.createCommandEncoder()
      const run2d = (pipe: GPUComputePipeline, bind: GPUBindGroup) => {
        const pass = enc.beginComputePass()
        pass.setPipeline(pipe)
        pass.setBindGroup(0, bind)
        pass.dispatchWorkgroups(wgx, wgy)
        pass.end()
      }
      run2d(this.pipe.h, this.bind.h)
      run2d(this.pipe.e, this.bind.e)
      // 边界核单 workgroup 串行扫四边（与 CPU 顺序一致）
      const bp = enc.beginComputePass()
      bp.setPipeline(this.pipe.bnd)
      bp.setBindGroup(0, this.bind.bnd)
      bp.dispatchWorkgroups(1)
      bp.end()
      this.device.queue.submit([enc.finish()])
      this.shadowStale = true
    }
  }

  injectSource(ix: number, iy: number, value: number) {
    // 同步 API：只入队，真正写 GPU 在 step/read 的 flushInjects 里完成。
    // 避免在 shadowStale 时用过期影子 += 再 writeBuffer 覆盖已演化场。
    this.pendingInjects.push({ ix, iy, value })
  }
  setSource(ix: number, iy: number, value: number) {
    this.injectSource(ix, iy, value)
  }

  async read() {
    await this.flushInjects()
    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(this.buf.Ez, 0, this.buf.staging, 0, this.shadow.byteLength)
    this.device.queue.submit([enc.finish()])
    await this.buf.staging.mapAsync(GPUMapMode.READ)
    const Ez = new Float32Array(this.buf.staging.getMappedRange().slice(0))
    this.buf.staging.unmap()
    // 同步影子，保证下次 flush 在最新场上叠加。
    this.shadow = Ez.slice()
    this.shadowStale = false
    const meta: FdtdMeta = {
      Nx: this.Nx, Ny: this.Ny, dt: this.dt, boundary: this.boundary, backend: 'webgpu',
    }
    return { Ez, meta }
  }

  destroy() {
    const b = this.buf
    b.Ez.destroy(); b.Hx.destroy(); b.Hy.destroy()
    b.epsInv.destroy(); b.pecMask.destroy()
    b.prevLeft.destroy(); b.prevRight.destroy(); b.prevBottom.destroy(); b.prevTop.destroy()
    b.params.destroy(); b.staging.destroy()
    this.device.destroy()
  }
}

/** 创建 FDTD 仿真：优先 WebGPU，否则 Rust/WASM；两者不可用时明确报错。preferCpu 强制 CPU。 */
export async function createFdtdSim(cfg: FdtdConfig): Promise<FdtdSim> {
  if (cfg.preferCpu) return new CpuFdtdSim(cfg)
  let ownedDevice: GPUDevice | null = null
  try {
    const gpu = navigator.gpu
    if (!gpu) return new CpuFdtdSim(cfg)
    const adapter = await gpu.requestAdapter()
    if (!adapter) return new CpuFdtdSim(cfg)
    const device = await adapter.requestDevice()
    ownedDevice = device

    const STORAGE_SRC_DST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    const STORAGE_DST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    const UNIFORM_DST = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    const MAPREAD_DST = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST

    const { Nx, Ny } = cfg
    const n = Nx * Ny
    // 借纯核心算 dt/cMur/eps（保证与 CPU 后端逐字一致），再上传 GPU。
    const f = createField(Nx, Ny, fieldOpts(cfg))
    const dt = f.dt

    // epsInv = dt / eps[idx]（预乘 dt，E 核里直接乘 curlH）。
    const epsInvArr = new Float32Array(n)
    for (let k = 0; k < n; k++) epsInvArr[k] = dt / f.eps[k]
    // pecMask 上传为 u32 数组（WGSL array<u32>）。
    const maskArr = new Uint32Array(n)
    if (f.pecMask) for (let k = 0; k < n; k++) maskArr[k] = f.pecMask[k] !== 0 ? 1 : 0

    const mkF32 = (data: Float32Array, usage: GPUBufferUsageFlags): GPUBuffer => {
      const b = device.createBuffer({ size: Math.max(4, data.byteLength), usage })
      writeGpuBuffer(device.queue, b, 0, data)
      return b
    }
    const mkU32 = (data: Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer => {
      const b = device.createBuffer({ size: Math.max(4, data.byteLength), usage })
      writeGpuBuffer(device.queue, b, 0, data)
      return b
    }

    const buf: GpuBuffers = {
      Ez: mkF32(f.Ez, STORAGE_SRC_DST),
      Hx: mkF32(f.Hx, STORAGE_SRC_DST),
      Hy: mkF32(f.Hy, STORAGE_SRC_DST),
      epsInv: mkF32(epsInvArr, STORAGE_DST),
      pecMask: mkU32(maskArr, STORAGE_DST),
      prevLeft: mkF32(f.prevLeft, STORAGE_SRC_DST),
      prevRight: mkF32(f.prevRight, STORAGE_SRC_DST),
      prevBottom: mkF32(f.prevBottom, STORAGE_SRC_DST),
      prevTop: mkF32(f.prevTop, STORAGE_SRC_DST),
      params: device.createBuffer({ size: 32, usage: UNIFORM_DST }),
      staging: device.createBuffer({ size: n * 4, usage: MAPREAD_DST }),
    }

    // Params：[Nx, Ny, coef(=dt/μ), cMur, boundary, 0,0,0]
    const bnd = (cfg.boundary ?? 'mur') === 'pec' ? 1 : 0
    writeGpuBuffer(device.queue, buf.params, 0, new Float32Array([
      Nx, Ny, dt / f.mu, f.cMur, bnd, 0, 0, 0,
    ]))

    const mod = (code: string): GPUShaderModule => device.createShaderModule({ code })
    const pp = (code: string) =>
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod(code), entryPoint: 'main' } })
    const [h, e, bndPipeline] = await Promise.all([pp(UPDATE_H_WGSL), pp(UPDATE_E_WGSL), pp(APPLY_BND_WGSL)])
    const pipe: GpuPipes = { h, e, bnd: bndPipeline }

    const bg = (
      pipeline: GPUComputePipeline,
      entries: { binding: number; buffer: GPUBuffer }[],
    ): GPUBindGroup =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: entries.map((e) => ({ binding: e.binding, resource: { buffer: e.buffer } })),
      })

    const bind: GpuBinds = {
      h: bg(pipe.h, [
        { binding: 0, buffer: buf.Ez }, { binding: 1, buffer: buf.Hx },
        { binding: 2, buffer: buf.Hy }, { binding: 3, buffer: buf.params },
      ]),
      e: bg(pipe.e, [
        { binding: 0, buffer: buf.Ez }, { binding: 1, buffer: buf.Hx },
        { binding: 2, buffer: buf.Hy }, { binding: 3, buffer: buf.epsInv },
        { binding: 4, buffer: buf.pecMask }, { binding: 5, buffer: buf.params },
      ]),
      bnd: bg(pipe.bnd, [
        { binding: 0, buffer: buf.Ez }, { binding: 1, buffer: buf.prevLeft },
        { binding: 2, buffer: buf.prevRight }, { binding: 3, buffer: buf.prevBottom },
        { binding: 4, buffer: buf.prevTop }, { binding: 5, buffer: buf.params },
      ]),
    }

    return new GpuFdtdSim(cfg, device, buf, pipe, bind, dt)
  } catch {
    ownedDevice?.destroy()
    return new CpuFdtdSim(cfg)
  }
}
