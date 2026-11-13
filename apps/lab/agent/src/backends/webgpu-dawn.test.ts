import assert from 'node:assert/strict';
import test from 'node:test';
import { isSoftwareGpuAdapterName } from './webgpu-dawn.ts';

test('software Vulkan adapters are never advertised as physical GPU', () => {
  for (const name of ['llvmpipe-llvm-19-1-7-256-bits-', 'lavapipe', 'Google SwiftShader', 'CPU raster']) {
    assert.equal(isSoftwareGpuAdapterName(name), true, name);
  }
  for (const name of ['intel-r-hd-graphics-p630-kbl-gt2-', 'NVIDIA RTX 4090', 'AMD Radeon PRO W7800']) {
    assert.equal(isSoftwareGpuAdapterName(name), false, name);
  }
});
