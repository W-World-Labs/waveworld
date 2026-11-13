import { loadDawn } from './load-dawn.ts';
import { runBatchLbm, type BatchProgress, type RunBatchOptions } from '@w-sim/solvers-lbm';
import type { ModelGeometry } from '../../../src/types/model.ts';
import type { JobResultV1, JobSpecV1 } from '../../../src/types/task.ts';

let gpuReady = false;

const SOFTWARE_ADAPTER_PATTERN = /(llvmpipe|lavapipe|swiftshader|software raster|microsoft basic render|cpu\b)/i;

export function isSoftwareGpuAdapterName(name: string): boolean {
  return SOFTWARE_ADAPTER_PATTERN.test(name);
}

export async function ensureDawnGpu(): Promise<GPU> {
  const { create, globals } = loadDawn();
  if (!gpuReady) {
    Object.assign(globalThis, globals as object);
    gpuReady = true;
  }
  const nav = { gpu: create([]) } as { gpu: GPU };
  return nav.gpu;
}

export async function probeDawn(): Promise<{ ok: boolean; deviceName?: string; reason?: string }> {
  try {
    const gpu = await ensureDawnGpu();
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'no adapter' };
    const device = await adapter.requestDevice();
    const name =
      (adapter as GPUAdapter & { info?: { device?: string } }).info?.device || 'dawn';
    device.destroy();
    if (isSoftwareGpuAdapterName(String(name))) {
      return { ok: false, deviceName: String(name), reason: `software adapter is not a physical GPU: ${name}` };
    }
    return { ok: true, deviceName: String(name) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function runWithDawn(input: {
  spec: JobSpecV1;
  geometry: ModelGeometry | null;
  agentId: string;
  onProgress?: (p: BatchProgress) => void | Promise<void>;
  signal?: AbortSignal;
  onDisplaySnapshot?: RunBatchOptions['onDisplaySnapshot'];
}): Promise<JobResultV1> {
  const gpu = await ensureDawnGpu();
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const adapterName = (adapter as GPUAdapter & { info?: { device?: string } }).info?.device ?? 'dawn-webgpu';
  if (isSoftwareGpuAdapterName(String(adapterName))) throw new Error(`software adapter is not accepted as WebGPU: ${adapterName}`);

  const raised: Record<string, number> = {};
  try {
    const { maxStorageBufferBindingSize, maxBufferSize, maxStorageBuffersPerShaderStage } =
      adapter.limits;
    if (maxStorageBufferBindingSize > 128 * 1024 * 1024) {
      raised.maxStorageBufferBindingSize = maxStorageBufferBindingSize;
      raised.maxBufferSize = maxBufferSize;
    }
    if (maxStorageBuffersPerShaderStage >= 10) {
      raised.maxStorageBuffersPerShaderStage = maxStorageBuffersPerShaderStage;
    }
  } catch {
    /* default limits */
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredLimits: raised });
  } catch {
    device = await adapter.requestDevice();
  }

  device.addEventListener('uncapturederror', (e) => {
    console.error('[webgpu]', (e as GPUUncapturedErrorEvent).error.message);
  });

  const deviceName = adapterName;

  try {
    return await runBatchLbm({
      device,
      geometry: input.geometry,
      spec: input.spec,
      agentId: input.agentId,
      backendId: 'webgpu-dawn',
      deviceName: String(deviceName),
      onProgress: input.onProgress,
      onDisplaySnapshot: input.onDisplaySnapshot,
      signal: input.signal,
    });
  } finally {
    device.destroy();
  }
}
