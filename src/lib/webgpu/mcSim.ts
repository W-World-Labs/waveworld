// 路径效率蒙特卡洛的 WebGPU 批量加速（GPU 并行抽样，CPU 归约统计）。
// 无 WebGPU 时回退 src/lib/mc.ts 的纯 CPU 实现。
import { mcStats, monteCarloCPU, type McPath, type McStat } from '../mc'
import { writeGpuBuffer } from './writeBuffer'

const WGSL = /* wgsl */ `
struct P { N: u32, K: u32, seed: u32, totalHops: u32 };
@group(0) @binding(0) var<storage, read> mins: array<f32>;
@group(0) @binding(1) var<storage, read> maxs: array<f32>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read> lens: array<u32>;
@group(0) @binding(4) var<storage, read_write> products: array<f32>;
@group(0) @binding(5) var<uniform> p: P;

fn pcg(n: u32) -> u32 {
  var h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.N * p.K) { return; }
  let k = i / p.N;
  var state = pcg(i ^ (p.seed * 2654435761u));
  let off = offsets[k];
  let len = lens[k];
  var prod = 1.0;
  for (var h = 0u; h < len; h = h + 1u) {
    state = pcg(state);
    let u = f32(state) / 4294967296.0;
    let lo = mins[off + h];
    let hi = maxs[off + h];
    prod = prod * (lo + (hi - lo) * u);
  }
  products[i] = prod;
}
`

export async function monteCarloGPU(paths: McPath[], N: number): Promise<McStat[] | null> {
  const gpu = navigator.gpu
  if (!gpu || paths.length === 0) return null
  const adapter = await gpu.requestAdapter()
  if (!adapter) return null
  const device: GPUDevice = await adapter.requestDevice()

  const K = paths.length
  const offsets = new Uint32Array(K)
  const lens = new Uint32Array(K)
  const minsArr: number[] = [], maxsArr: number[] = []
  for (let k = 0; k < K; k++) {
    offsets[k] = minsArr.length
    lens[k] = paths[k].hops.length
    for (const h of paths[k].hops) { minsArr.push(h.min); maxsArr.push(h.max) }
  }
  const mins = Float32Array.from(minsArr.length ? minsArr : [0])
  const maxs = Float32Array.from(maxsArr.length ? maxsArr : [0])
  const total = N * K

  const mk = (data: Float32Array | Uint32Array): GPUBuffer => {
    const b = device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    writeGpuBuffer(device.queue, b, 0, data)
    return b
  }
  const bMins = mk(mins), bMaxs = mk(maxs), bOff = mk(offsets), bLens = mk(lens)
  const bProd = device.createBuffer({
    size: total * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const bParams = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  writeGpuBuffer(device.queue, bParams, 0, new Uint32Array([N, K, (Math.floor(N * 2654435.761) ^ 0x9e3779b9) >>> 0, mins.length]))
  const staging = device.createBuffer({
    size: total * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })

  const module = device.createShaderModule({ code: WGSL })
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bMins } }, { binding: 1, resource: { buffer: bMaxs } },
      { binding: 2, resource: { buffer: bOff } }, { binding: 3, resource: { buffer: bLens } },
      { binding: 4, resource: { buffer: bProd } }, { binding: 5, resource: { buffer: bParams } },
    ],
  })
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind)
  pass.dispatchWorkgroups(Math.ceil(total / 64))
  pass.end()
  enc.copyBufferToBuffer(bProd, 0, staging, 0, total * 4)
  device.queue.submit([enc.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const all = new Float32Array(staging.getMappedRange().slice(0))
  staging.unmap()
  ;[bMins, bMaxs, bOff, bLens, bProd, bParams, staging].forEach((b) => b.destroy())

  // CPU 归约：每条路径切片求统计
  return paths.map((_, k) => mcStats(all.subarray(k * N, (k + 1) * N)))
}

/** 统一入口：能用 GPU 就用（N 可很大），否则 CPU（限 N 保持响应）。 */
export async function runMonteCarlo(paths: McPath[], N: number): Promise<{ backend: 'webgpu' | 'cpu'; stats: McStat[] }> {
  try {
    const g = await monteCarloGPU(paths, N)
    if (g) return { backend: 'webgpu', stats: g }
  } catch { /* fall through */ }
  return { backend: 'cpu', stats: monteCarloCPU(paths, Math.min(N, 50000)) }
}
