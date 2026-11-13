import { create, globals } from 'webgpu';
Object.assign(globalThis, globals as object);
const nav = { gpu: create([]) } as { gpu: GPU };
import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';

const adapter = await nav.gpu.requestAdapter();
const device = await adapter.requestDevice();
device.addEventListener('uncapturederror', (e: Event) => {
  console.error('UNCAPTURED:', (e as GPUUncapturedErrorEvent).error.message);
});
const nx = 64, ny = 32, nz = 32;
const solver = new D3Q19Solver(device, {
  nx, ny, nz, uInlet: 0.06, tau: 0.6, smagorinskyCs: 0.1,
  turbulenceIntensity: 0.01, freeSlipWalls: false,
  flags: new Uint8Array(nx * ny * nz),
});
for (let i = 0; i < 500; i++) solver.step();
solver.visualize();
const f = await solver.readForces();
console.log('forces:', f);
await device.queue.onSubmittedWorkDone();
console.log('SMOKE2 PASS');
solver.destroy();
device.destroy();
