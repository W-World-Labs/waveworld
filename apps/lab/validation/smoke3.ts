// smoke3: 无头校验体渲染器 WGSL 可编译、渲染管线可创建
// 直接复用 src/lib/cfd/volume-renderer.ts 的真实 shader 代码（不构造类，避免依赖 canvas）
import { create } from 'webgpu';
import { VolumeRenderer } from '../src/lib/cfd/volume-renderer.js';

const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('no adapter');
const device = await adapter.requestDevice();

device.addEventListener?.('uncapturederror', (e: any) => {
  console.error('UNCAPTURED:', e.error?.message ?? e);
});

// 通过原型拿到私有方法的真实 WGSL
const code = (VolumeRenderer.prototype as any).getShaderCode.call({});

const module = device.createShaderModule({ code });
const info = await module.getCompilationInfo();
let hasError = false;
for (const m of info.messages) {
  console.log(`[${m.type}] ${m.lineNum}:${m.linePos} ${m.message}`);
  if (m.type === 'error') hasError = true;
}
if (hasError) {
  console.log('SMOKE3 FAIL');
  process.exit(1);
}

// 与浏览器一致的管线结构（macOS 首选格式 bgra8unorm）
// GPUShaderStage.FRAGMENT = 2
const FRAG = 2;
const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: FRAG, buffer: { type: 'uniform' } },
    { binding: 1, visibility: FRAG, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: FRAG, buffer: { type: 'read-only-storage' } },
  ],
});
const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: { module, entryPoint: 'vertexMain' },
  fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'bgra8unorm' as GPUTextureFormat }] },
  primitive: { topology: 'triangle-list' },
});
console.log('pipeline created:', !!pipeline);
console.log('SMOKE3 PASS');
