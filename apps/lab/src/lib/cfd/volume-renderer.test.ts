import assert from 'node:assert/strict';
import test from 'node:test';
import { VolumeRenderer, pressureScaleRoot } from './volume-renderer';

test('pressure normalization keeps tiny saved pressure ranges in finite split factors', () => {
  const root = pressureScaleRoot(1e20, 1e-20);
  assert.ok(Number.isFinite(root));
  assert.ok(root > 1e19 && root < 1e20);
  const subnormalLatticePressure = Math.fround(1e-40);
  const normalized = Math.fround(Math.fround(subnormalLatticePressure * root) * root) + 0.5;
  assert.ok(normalized > 0.99 && normalized < 1.01);
  assert.equal(pressureScaleRoot(1, 0), 0);
});

test('frame and pressure-range updates reuse the renderer pipeline and uniform', () => {
  const oldUsage = Object.getOwnPropertyDescriptor(globalThis, 'GPUBufferUsage');
  const oldStage = Object.getOwnPropertyDescriptor(globalThis, 'GPUShaderStage');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'GPUBufferUsage', { configurable: true, value: { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 } });
  Object.defineProperty(globalThis, 'GPUShaderStage', { configurable: true, value: { FRAGMENT: 1 } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { getPreferredCanvasFormat: () => 'rgba8unorm' } } });

  const writes: { buffer: { size: number }; data: ArrayBuffer | ArrayBufferView }[] = [];
  let shaderModuleCount = 0;
  let pipelineCount = 0;
  const device = {
    createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
    createShaderModule: ({ code }: { code: string }) => { shaderModuleCount++; assert.match(code, /rp\.pressure\.x/); return {}; },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => { pipelineCount++; return { getBindGroupLayout: () => ({}) }; },
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (buffer: { size: number }, _offset: number, data: ArrayBuffer | ArrayBufferView) => writes.push({ buffer, data }),
      submit() {},
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
      finish: () => ({}),
    }),
  };
  const context = {
    configure() {}, unconfigure() {},
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  const canvas = { width: 64, height: 64, getContext: () => context };
  const displayBuffer = { size: 64, destroy() {} };
  const flagsBuffer = { size: 32, destroy() {} };
  try {
    const renderer = new VolumeRenderer(
      device as never, canvas as never, { nx: 2, ny: 2, nz: 2 },
      { display: displayBuffer as never, flags: flagsBuffer as never }, 1, 2, [],
      { mac: false, hasTemperature: false, pressureOffset: 1, pressureScalePa: 0 },
    );
    const display = new Float32Array(16);
    const flags = new Uint32Array(8);
    const pressureRange = [-1e-20, 1e-20] as const;
    renderer.updateFrame(display, flags, {
      uInlet: 2,
      physicalRanges: [undefined, undefined, undefined, pressureRange],
      pressureScalePa: 1e20,
    });
    renderer.render(3);
    assert.equal(shaderModuleCount, 1);
    assert.equal(pipelineCount, 1);
    assert.equal(writes.length, 3);
    const uniform = writes[2]!.data as Float32Array;
    assert.equal(uniform.length, 36);
    assert.equal(uniform[32], pressureScaleRoot(1e20, 1e-20));
    renderer.destroy();
  } finally {
    if (oldUsage) Object.defineProperty(globalThis, 'GPUBufferUsage', oldUsage); else Reflect.deleteProperty(globalThis, 'GPUBufferUsage');
    if (oldStage) Object.defineProperty(globalThis, 'GPUShaderStage', oldStage); else Reflect.deleteProperty(globalThis, 'GPUShaderStage');
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
