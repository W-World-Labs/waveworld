// 查看适配器存储缓冲上限
import { create } from 'webgpu';
const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('no adapter');
const keys = [
  'maxStorageBufferBindingSize',
  'maxBufferSize',
  'maxStorageBuffersPerShaderStage',
  'maxComputeWorkgroupSizeX',
  'maxComputeInvocationsPerWorkgroup',
];
for (const k of keys) {
  const v = (adapter.limits as any)[k];
  console.log(`${k}: ${v} ${typeof v === 'number' && v > 1e6 ? `(${(v / 1024 / 1024).toFixed(0)}MB)` : ''}`);
}
