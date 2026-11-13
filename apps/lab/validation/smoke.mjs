import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);
const nav = { gpu: create([]) };
const adapter = await nav.gpu.requestAdapter();
if (!adapter) { console.error('no adapter'); process.exit(1); }
const info = adapter.info;
console.log('adapter ok:', info?.vendor, info?.architecture, info?.description || '');
const device = await adapter.requestDevice();
const mod = device.createShaderModule({ code: '@compute @workgroup_size(1) fn main() {}' });
console.log('shader module ok');
device.destroy();
console.log('SMOKE PASS');
