import { loadDawn } from './load-dawn.ts';

const SOFTWARE_ADAPTER_PATTERN = /(llvmpipe|lavapipe|swiftshader|software raster|microsoft basic render|cpu\b)/i;
let globalsInstalled = false;

async function dawnGpu(): Promise<GPU> {
  const { create, globals } = loadDawn();
  if (!globalsInstalled) { Object.assign(globalThis, globals as object); globalsInstalled = true; }
  return create([]);
}

export interface PhotoGpuParameters {
  k_exc: number; k_f: number; k_isc: number; k_T: number; k_q: number; k_d: number;
  k_I: number; O2: number; substrate: number; cTot: number; dt: number;
}

export interface PhotoGpuTrajectory {
  deviceName: string;
  /** Packed [S0,S1,T1,singletO2] for steps 0..N, computed as f32 on the physical adapter. */
  states: Float32Array;
}

const SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> p: array<f32>;
@group(0) @binding(1) var<storage, read_write> states: array<vec4<f32>>;

fn deriv(s: vec4<f32>) -> vec4<f32> {
  let kTeff = p[3] + p[4] * p[7] + p[6] * p[8];
  return vec4<f32>(
    -p[0] * s.x + p[1] * s.y + kTeff * s.z,
    p[0] * s.x - (p[1] + p[2]) * s.y,
    p[2] * s.y - kTeff * s.z,
    p[4] * p[7] * s.z - p[5] * s.w
  );
}

@compute @workgroup_size(1)
fn main() {
  let steps = u32(p[11]);
  let dt = p[10];
  var state = vec4<f32>(p[9], 0.0, 0.0, 0.0);
  states[0] = state;
  for (var step = 1u; step <= steps; step = step + 1u) {
    let k1 = deriv(state);
    let k2 = deriv(state + 0.5 * dt * k1);
    let k3 = deriv(state + 0.5 * dt * k2);
    let k4 = deriv(state + dt * k3);
    state = state + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    states[step] = state;
  }
}`;

export async function runPhotoRk4OnPhysicalGpu(parameters: PhotoGpuParameters, steps: number): Promise<PhotoGpuTrajectory> {
  if (!Number.isInteger(steps) || steps <= 0) throw new Error('GPU RK4 steps must be a positive integer');
  if (steps > 1_000_000) throw new Error('GPU RK4 steps exceed safety limit');
  const values = [parameters.k_exc, parameters.k_f, parameters.k_isc, parameters.k_T, parameters.k_q,
    parameters.k_d, parameters.k_I, parameters.O2, parameters.substrate, parameters.cTot, parameters.dt, steps];
  if (values.some((value) => !Number.isFinite(value))) throw new Error('GPU RK4 parameters must be finite');

  const gpu = await dawnGpu();
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const deviceName = String((adapter as GPUAdapter & { info?: { device?: string } }).info?.device ?? 'dawn-webgpu');
  if (SOFTWARE_ADAPTER_PATTERN.test(deviceName)) throw new Error(`software adapter is not accepted as physical GPU: ${deviceName}`);
  const device = await adapter.requestDevice();
  const parameterBytes = new Float32Array(values);
  const outputBytes = (steps + 1) * 4 * Float32Array.BYTES_PER_ELEMENT;
  const parameterBuffer = device.createBuffer({ size: parameterBytes.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const outputBuffer = device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    device.queue.writeBuffer(parameterBuffer, 0, parameterBytes);
    const module = device.createShaderModule({ code: SHADER });
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parameterBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, outputBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    return { deviceName, states: new Float32Array(readback.getMappedRange().slice(0)) };
  } finally {
    if (readback.mapState === 'mapped') readback.unmap();
    parameterBuffer.destroy(); outputBuffer.destroy(); readback.destroy(); device.destroy();
  }
}
