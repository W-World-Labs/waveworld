import { signalArrayInputs, signalArrayRcInputs } from './signal-array-fixture';
import { detectionInputs, detectionEdgeInputs } from './detection-fixture';
import { antennaInputs, antennaEdgeInputs } from './antenna-fixture';
import { planeInputs, extremePlaneInputs } from './plane-fixture';
import { opticsScene } from './optics-fixture';
// Real browser Worker + WASM + Host route handlers/SQLite, with no listening port.
import assert from 'node:assert/strict';
import { fluidScene, convectionScene } from './fluid-fixture';
import { isingScene } from './ising-fixture';
import { rlcScene, mutualScene, neuronScene, vibrationScene, transientInputs, faradayInputs } from './ode-fixture';
import { particleScene } from './particle-fixture';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { computeModule, createModuleJobSpec, readModuleResult, type ModuleComputeInput } from '../../src/lib/sim/module-compute';
import { lbmGeometry, lbmSpec, groundSpec, fanGeometry, fanSpec, thermalSpec, solidPowerSpec, thermalRegionsSpec, thermalContactsSpec } from './lbm-fixture';
import { prepareLbmInput, runLbmWasm } from '../../src/lib/sim/lbm-compute';
import { encodeModelGeometry } from '../../apps/lab/src/lib/models/geometry-contract';
import { encodeFlowSnapshotV3, decodeFlowSnapshot, decodeFlowSequence, decompressSequenceBlob, FLOW_SEQUENCE_KIND, type LbmDisplaySnapshot } from '../../apps/lab/src/lib/cfd/flow-snapshot';
import { LBM_FIELD_HISTORY_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE } from '@w-sim/contracts';

const bufferBytes = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

// Raw tsx driver: playwright.config.ts is never loaded here, so expect
// falls back to the 5s library default. Align with the suite's declared
// expect.timeout (10s) — bounded, still fails closed on a stalled sim.
expect.configure({ timeout: 10_000 });

async function main() {
  const includeGpu = process.argv.includes('--webgpu');
  const origin = `${includeGpu ? 'https' : 'http'}://waveworld.test`;
  const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-browser-smoke-'));
  process.env.TASK_DB_PATH = path.join(directory, 'tasks.db');
  process.env.ARTIFACT_ROOT = path.join(directory, 'artifacts');
  process.env.W_COMPUTE_ENABLED = '1';
  process.env.JOB_REQUIRE_AUTH = '1';
  process.env.ARTIFACT_REQUIRE_AUTH = '1';
  const routes = {
    me: (await import('../../apps/host/src/app/api/v1/me/route')).GET,
    submit: (await import('../../apps/host/src/app/api/v1/jobs/route')).POST,
    heartbeat: (await import('../../apps/host/src/app/api/v1/jobs/[id]/heartbeat/route')).POST,
    complete: (await import('../../apps/host/src/app/api/v1/jobs/[id]/complete/route')).POST,
    fail: (await import('../../apps/host/src/app/api/v1/jobs/[id]/fail/route')).POST,
    cancel: (await import('../../apps/host/src/app/api/v1/jobs/[id]/cancel/route')).POST,
    detail: (await import('../../apps/host/src/app/api/v1/jobs/[id]/route')).GET,
  };
  const service = await import('../../apps/host/src/lib/tasks/service');
  const { resetRateLimitsForTests } = await import('../../apps/host/src/lib/rate-limit');
  const artifacts = await import('../../apps/host/src/lib/tasks/artifacts');
  const upload = (await import('../../apps/host/src/app/api/v1/artifacts/route')).POST;
  const { getSqlite } = await import('../../apps/host/src/lib/tasks/db');
  const common = { bundle: true, write: false, format: 'esm' as const, jsx: 'automatic' as const,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' } };
  const [mainBundle, workerBundle] = await Promise.all([
    build({ ...common, stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { LocaleProvider } from './src/lib/i18n';
      import { SimulationModule } from './src/components/SimulationModule';
      import { Fdtd } from './src/pages/Fdtd';
      import { MD } from './src/pages/MD';
      import { Particles } from './src/pages/Particles';
      import { Fluid as FluidPage } from './src/pages/Fluid';
      import { Convection } from './src/pages/Convection';
      import { Ising } from './src/pages/Ising';
      import { Rlc } from './src/pages/Rlc';
      import { Electromagnetic } from './src/pages/Electromagnetic';
      import { Sound } from './src/pages/Sound';
      import { EMWave3D } from './src/pages/EMWave3D';
      import { AntennaPattern } from './src/pages/AntennaPattern';
      import { Antenna3D } from './src/pages/Antenna3D';
      import { PhasedArray } from './src/pages/PhasedArray';
      import { RadarScope } from './src/pages/RadarScope';
      import { Laser } from './src/pages/Laser';
      import { NLJD } from './src/pages/NLJD';
      import { Transient } from './src/pages/Transient';
      import { Faraday } from './src/pages/Faraday';
      import { SignalArray } from './src/pages/SignalArray';
      import { OpticsLab } from './src/pages/OpticsLab';
      import { Mutual } from './src/pages/Mutual';
      import { Neuron } from './src/pages/Neuron';
      import { Vibration } from './src/pages/Vibration';
      import { runBrowserCompute, runBrowserJob } from './src/lib/sim/browser-agent';
      import { createSettlementClient } from './apps/lab/src/lib/w-sim/settlement-client';
      import { lbmGeometry, fanGeometry } from './scripts/ci/lbm-fixture';
      import { WasmLbm } from './src/lib/sim/wasm-fields';
      import { D3Q19Solver } from '@w-sim/solvers-lbm/d3q19';
      window.probeLbmBoundary = async (config, initial, solidCell, steps, accumulatedForce = 0, corruptDonor = null) => {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('Boundary smoke requires a WebGPU adapter');
        const device = await adapter.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: 8 } });
        const flags = new Uint8Array(config.nx * config.ny * config.nz);
        if (solidCell !== null) flags[solidCell] = config.thermal ? 2 : 1;
        const wasm = new WasmLbm(config, flags);
        const gpu = new D3Q19Solver(device, { ...config, flags });
        // Test-only access to existing buffers; no public solver hooks are added.
        try {
          if (initial) {
            wasm.distributions.set(initial);
            device.queue.writeBuffer(gpu.f0Buffer, 0, new Float32Array(initial));
          }
          if (accumulatedForce) device.queue.writeBuffer(gpu.forceBuffer, 48, new Float32Array([accumulatedForce, 0, 0, 0]));
          let stats;
          const force = [0, 0, 0];
          for (let step = 0; step < steps; step++) {
            stats = wasm.step();
            if (corruptDonor) {
              // Synthetic fault injection into the existing buffer after stream;
              // this is not asserted to be reachable from ordinary product inputs.
              gpu.dispatch(gpu.collidePipeline); gpu.dispatch(gpu.streamPipeline);
              device.queue.writeBuffer(gpu.f0Buffer, ((corruptDonor === 'inlet' ? 1 : config.nx-2) + config.nx*(2+config.ny*2))*19*4, new Float32Array(19));
              gpu.dispatch(gpu.boundaryPipeline); gpu.dispatch(gpu.macrosPipeline); gpu.dispatch(gpu.massPipeline, true);
            } else await gpu.step();
            stats.obstacleForce.forEach((value, axis) => force[axis] += value);
          }
          if (!corruptDonor) gpu.visualize();
          const gpuForce = await gpu.readForces(), clearedForce = await gpu.readForces();
          return {
            wasm: { f: Array.from(wasm.distributions), post: Array.from(wasm.post), display: Array.from(wasm.readDisplay()), thermal: stats.thermal, force },
            gpu: { f: Array.from(await gpu.readField(gpu.f0Buffer, 19)), post: Array.from(await gpu.readField(gpu.f1Buffer, 19)),
              display: Array.from(await gpu.readDisplay()), thermal: gpu.getThermalStats(), force: gpuForce, clearedForce },
          };
        } finally { gpu.destroy(); device.destroy(); }
      };
      window.mountModule = path => {
        const element = document.createElement('div'); document.body.append(element);
        const root = createRoot(element);
        window.unmountModule = () => { root.unmount(); element.remove(); };
        root.render(React.createElement(LocaleProvider, null, React.createElement(MemoryRouter, null,
          React.createElement(SimulationModule, { path }, React.createElement(({ md: MD, fdtd: Fdtd, particles: Particles, fluid: FluidPage, convection: Convection, ising: Ising, rlc: Rlc, mutual: Mutual, neuron: Neuron, vibration: Vibration, 'optics-lab': OpticsLab, electromagnetic: Electromagnetic, sound: Sound, emwave3d: EMWave3D, antennapattern: AntennaPattern, antenna3d: Antenna3D, phasedarray: PhasedArray, radar: RadarScope, laser: Laser, nljd: NLJD, 'signal-array': SignalArray, transient: Transient, faraday: Faraday })[path])))));
      };
      window.executeLocal = async (spec, cancel = false, scale) => {
        const control = new AbortController();
        const progressSteps = [];
        const geometry = scale ? { ...lbmGeometry, vertices: lbmGeometry.vertices.map((value, index) => value * scale[index % 3]) } : lbmGeometry;
        return runBrowserCompute(spec, { signal: control.signal, geometry: spec.kind === 'lbm-d3q19' ? geometry : undefined,
          onProgress: progress => { progressSteps.push(progress.step); if (cancel) control.abort(); }
        }).then(({ result, flows }) => ({ result, flowBytes: flows?.at(-1)?.byteLength, flowHeaders: flows.map(flow => { const view = new DataView(flow); return { magic: view.getUint32(0, true), stride: view.getUint32(20, true), channels: view.getUint32(28, true) }; }) })).catch(error => ({ error: String(error), progressSteps }));
      };
      window.execute = async (spec, cancel) => {
        const control = new AbortController();
        let updates = 0;
        return runBrowserJob(createSettlementClient(), spec, { signal: control.signal, geometry: spec.kind === 'lbm-d3q19' ? (spec.parameters.fan ? fanGeometry : lbmGeometry) : undefined,
          onStatus: (id, status, progress) => { window.jobId = id; if (cancel !== false && status === 'running' && (cancel === 'after-first-chunk' ? ++updates >= 2 : progress.step >= (typeof cancel === 'number' ? cancel : 8))) control.abort(); }
        }).then(result => ({ result })).catch(error => ({ error: String(error) }));
      };
    ` } }),
    build({ ...common, entryPoints: ['src/lib/sim/browser-agent.worker.ts'] }),
  ]);
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
    ...(includeGpu ? { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
  });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let workerCount = 0, apiRequests = 0;
    let signedIn = false;
    let expireLease = false;
    let lastSubmittedId: string | undefined;
    let uploadLeaseCase: { expireSecond: boolean; uploads: number; renewed: number; completes: number;
      pending?: { jobId: string; release: () => void } } | undefined;
    await context.route(`${origin}/**`, async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname === '/main.js' || url.pathname.endsWith('/browser-agent.worker.ts')) {
        return route.fulfill({ contentType: 'text/javascript', body: (url.pathname === '/main.js' ? mainBundle : workerBundle).outputFiles![0].text,
          headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'" } });
      }
      if (url.pathname === '/datasets/lammps-lj-2d.data') return route.fulfill({ contentType: 'text/plain', body: readFileSync('public/datasets/lammps-lj-2d.data', 'utf8') });
      if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<script type="module" src="/main.js"></script>' });
      apiRequests++;
      const request = new Request(req.url(), { method: req.method(), headers: { ...req.headers(), ...(signedIn ? { 'x-user-id': 'browser-smoke' } : {}) },
        ...(req.method() === 'GET' ? {} : { body: new Uint8Array(req.postDataBuffer() ?? Buffer.alloc(0)) }) });
      const parts = url.pathname.split('/'), id = parts[4], action = parts[5];
      const uploadCase = uploadLeaseCase;
      if (uploadCase && action === 'complete') uploadCase.completes++;
      if (uploadCase && url.pathname === '/api/v1/artifacts' && ['lbm-display', FLOW_SEQUENCE_KIND].includes(request.headers.get('x-artifact-kind') ?? '')) {
        uploadCase.uploads++;
        const jobId = request.headers.get('x-job-id')!;
        if (uploadCase.expireSecond && uploadCase.uploads === 1) {
          getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', jobId);
        }
        // Hold each real upload until a subsequent real Host heartbeat responds.
        const renewed = await new Promise<boolean>(resolve => {
          const deadline = setTimeout(() => { uploadCase.pending = undefined; resolve(false); }, 2000);
          uploadCase.pending = { jobId, release: () => { clearTimeout(deadline); uploadCase.pending = undefined; resolve(true); } };
        });
        if (!renewed) return route.fulfill({ status: 504, body: 'No heartbeat while uploading the recorded field' });
      }
      if (expireLease && action === 'heartbeat') {
        expireLease = false;
        getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);
      }
      const response = url.pathname === '/api/v1/me' ? await routes.me(request) : url.pathname === '/api/v1/artifacts' ? await upload(request) : url.pathname === '/api/v1/jobs' ? await routes.submit(request)
        : await routes[(action ?? 'detail') as Exclude<keyof typeof routes, 'submit'>](request, { params: Promise.resolve({ id }) });
      if (uploadCase?.pending?.jobId === id && action === 'heartbeat') {
        if (response.ok) uploadCase.renewed++;
        uploadCase.pending.release();
      }
      if (url.pathname === '/api/v1/jobs' && response.status === 201) lastSubmittedId = (await response.clone().json()).job.id;
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('worker', () => workerCount++);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const checkUploadLease = async () => {
      const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
        ownerUserId: 'browser-smoke', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
      const spec = lbmSpec(model.id);
      spec.outputs.fieldFrames = 3;
      spec.requirements = { ...spec.requirements, features: [...(spec.requirements?.features ?? []), LBM_FIELD_HISTORY_FEATURE] };
      await page.evaluate(() => {
        const w = window as any;
        w.leaseNativeTimeout = window.setTimeout;
        w.setTimeout = (callback: TimerHandler, ms?: number, ...args: any[]) => w.leaseNativeTimeout(callback, ms === 5000 ? 25 : ms, ...args);
      });
      try {
        for (const expireSecond of [false, true]) {
          uploadLeaseCase = { expireSecond, uploads: 0, renewed: 0, completes: 0 };
          const previousWorkers = workerCount;
          const outcome = await page.evaluate(spec => (window as any).execute(spec, false), spec);
          const id = await page.evaluate(() => (window as any).jobId), job = service.getJob(id)!;
          assert.equal(workerCount - previousWorkers, 1, 'one real three-step Worker per published job');
          if (expireSecond) {
            assert.ok(outcome.error); assert.equal(outcome.result, undefined);
            assert.equal(job.status, 'queued'); assert.equal(job.result, null);
            // 帧历史按单条 lbm-display-seq 序列上传：lease 在其唯一上传心跳中过期，
            // 该上传被 Host 拒收——序列是原子的，不保留半批帧。
            assert.equal(uploadLeaseCase.uploads, 1); assert.equal(uploadLeaseCase.renewed, 0);
            assert.equal(uploadLeaseCase.completes, 0);
            assert.equal(artifacts.listArtifacts(id).filter(item => item.kind === FLOW_SEQUENCE_KIND).length, 0);
          } else {
            assert.equal(outcome.error, undefined, outcome.error);
            assert.equal(job.status, 'succeeded'); assert.equal(job.compute, undefined);
            assert.equal(outcome.result.summary.steps, 3);
            assert.equal(outcome.result.derived.engine, 'rust-wasm');
            assert.equal(uploadLeaseCase.uploads, 1); assert.equal(uploadLeaseCase.renewed, 1);
            assert.equal(uploadLeaseCase.completes, 1);
            assert.equal(outcome.result.artifacts.length, 1);
            const seq = outcome.result.artifacts[0];
            assert.equal(seq.kind, FLOW_SEQUENCE_KIND);
            const stored = artifacts.readArtifactBytes(seq.artifactId)!;
            assert.equal(stored.meta.ownerUserId, 'browser-smoke'); assert.equal(stored.meta.jobId, id);
            const frames = decodeFlowSequence(await decompressSequenceBlob(bufferBytes(stored.data)));
            assert.deepEqual(frames.map((frame: { step: number }) => frame.step), [1, 2, 3]);
            assert.notDeepEqual(frames[0].display, frames[1].display);
            assert.notDeepEqual(frames[1].display, frames[2].display);
          }
        }
      } finally {
        uploadLeaseCase?.pending?.release(); uploadLeaseCase = undefined;
        await page.evaluate(() => { window.setTimeout = (window as any).leaseNativeTimeout; });
      }
      assert.deepEqual(errors, []);
      resetRateLimitsForTests();
      console.log('PASS real 3-step published field history: batched sequence upload renews the lease once; expiry before the single upload rejects it atomically and no partial frames are preserved');
    };
    if (process.argv.includes('--upload-lease-only')) { signedIn = true; await checkUploadLease(); return; }
    const localInput = { module: 'rlc' as const, scene: { ...rlcScene(), steps: 3 } };
    const local = await page.evaluate(spec => (window as any).executeLocal(spec), createModuleJobSpec(localInput));
    assert.equal(local.error, undefined, local.error);
    assert.deepEqual(readModuleResult(local.result, localInput), await computeModule(localInput));
    const localFlow = lbmSpec();
    localFlow.outputs.fields!.push('pressure');
    localFlow.requirements!.features!.push(LBM_PRESSURE_FIELD_FEATURE);
    localFlow.model = { source: 'inline', inline: { modelId: 'local-cube' }, referenceLength: 1 };
    const localField = await page.evaluate(spec => (window as any).executeLocal(spec), localFlow);
    assert.equal(localField.error, undefined, localField.error); assert.equal(localField.result.summary.steps, 3); assert.ok(localField.flowBytes > 32);
    assert.equal(localField.result.derived[LBM_GAUGE_FORCE_FEATURE], 1);
    assert.equal(localField.result.derived[LBM_NEE_OUTLET_FEATURE], 1);
    assert.equal(localField.result.derived[LBM_NEE_INLET_FEATURE], 1);
    assert.equal(localField.result.derived[LBM_MASS_BALANCE_FEATURE], 1);
    assert.equal(localField.result.derived[LBM_PRESSURE_FIELD_FEATURE], 1);
    assert.deepEqual(localField.flowHeaders, [{ magic: 0x32465657, stride: 3, channels: 2 }]);
    assert.equal(localField.result.lbmMassBalance.scope, 'internal-fluid-x');
    const localReference = await runLbmWasm(localFlow, prepareLbmInput(localFlow, lbmGeometry));
    assert.deepEqual(localField.result.lbmMassBalance, localReference.result.lbmMassBalance);
    for (const backend of includeGpu ? ['cpu', 'webgpu-browser'] as const : ['cpu'] as const) {
      for (const [scale, message] of [
        [[1, 10, 1], /outside the simulation domain/],
        [[0, 1, 1], /X.*span|streamwise|X.*extent/i],
        [[1, 1, 0.00001], /nonzero solid voxel volume/i],
      ] as const) {
        const invalid = { ...localFlow, parameters: { ...localFlow.parameters, angleOfAttack: 0 },
          requirements: { ...localFlow.requirements, backends: [backend], precision: backend === 'cpu' ? 'mixed' : 'float32' } };
        const outcome = await page.evaluate(({ spec, scale }) => (window as any).executeLocal(spec, false, scale), { spec: invalid, scale });
        assert.match(outcome.error ?? '', message); assert.equal(outcome.result, undefined); assert.equal(outcome.flowBytes, undefined);
        assert.ok(outcome.progressSteps.every((step: number) => step === 0));
      }
    }
    assert.equal(apiRequests, 0);
    console.log('PASS invalid model geometry: WASM/WebGPU reject clipping, zero X span and unresolved solids before any solver step or API call');
    if (includeGpu) {
      const gpuLocal = { ...localFlow, requirements: { ...localFlow.requirements, backends: ['webgpu-browser' as const], precision: 'float32' as const } };
      const gpuField = await page.evaluate(spec => (window as any).executeLocal(spec), gpuLocal);
      assert.equal(gpuField.error, undefined, gpuField.error); assert.equal(gpuField.result.backend.id, 'webgpu-browser');
      assert.equal(gpuField.result.summary.steps, 3); assert.ok(gpuField.flowBytes > 32);
      assert.equal(gpuField.result.derived[LBM_GAUGE_FORCE_FEATURE], 1);
      assert.equal(gpuField.result.derived[LBM_NEE_OUTLET_FEATURE], 1);
      assert.equal(gpuField.result.derived[LBM_NEE_INLET_FEATURE], 1);
      assert.equal(gpuField.result.derived[LBM_MASS_BALANCE_FEATURE], 1);
      assert.equal(gpuField.result.derived[LBM_PRESSURE_FIELD_FEATURE], 1);
      assert.deepEqual(gpuField.flowHeaders, localField.flowHeaders);
      assert.equal(gpuField.result.derived.pressureScalePa, localReference.result.derived?.pressureScalePa);
      assert.equal(gpuField.result.lbmMassBalance.scope, 'internal-fluid-x');
      for (const [key, value] of Object.entries(gpuField.result.lbmMassBalance)) {
        if (key !== 'scope') assert.ok(typeof value === 'number' && Number.isFinite(value), key);
      }
      // Nonuniform populations expose the lost tangential displacement that a
      // uniform inlet fixture cannot detect. Only 175 cells and one time step.
      const directions = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
        [1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],
        [0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
      const config = { nx: 7, ny: 5, nz: 5, tau: 1, uInlet: .04, smagorinskyCs: 0, turbulenceIntensity: 0, freeSlipWalls: true };
      const cell = (x: number, y: number, z: number) => x + config.nx * (y + config.ny * z);
      const initial = Array.from({ length: 175 * 19 }, (_, index) => {
        const i = Math.floor(index / 19), q = index % 19;
        const rho = 1 + .002 * (i % 7) + .001 * (Math.floor(i / 7) % 5) + .003 * Math.floor(i / 35);
        const cu = directions[q][0] * config.uInlet;
        return Math.fround(rho * (q === 0 ? 1/3 : q < 7 ? 1/18 : 1/36) * (1 + 3*cu + 4.5*cu*cu - 1.5*config.uInlet**2));
      });
      const closeFields = (actual: number[], expected: number[], tolerance: number, label: string) => {
        assert.equal(actual.length, expected.length);
        actual.forEach((value, i) => assert.ok(Number.isFinite(value) && Math.abs(value - expected[i]) <= tolerance,
          `${label}[${i}]: ${value} vs ${expected[i]}`));
      };
      for (const freeSlipWalls of [true, false]) {
        const probe = await page.evaluate(({ config, initial }) => (window as any).probeLbmBoundary(config, initial, null, 1),
          { config: { ...config, freeSlipWalls }, initial });
        let reflected = 0;
        for (let z = 0; z < 5; z++) for (let y = 0; y < 5; y++) for (let x = 1; x < 6; x++) {
          directions.forEach((direction, q) => {
            const source = [x, y, z].map((value, axis) => value - direction[axis]);
            if (source[1] >= 0 && source[1] < 5 && source[2] >= 0 && source[2] < 5) return;
            // Independent mirrored extension of the half-cell wall: only the
            // coordinates crossing a wall fold, leaving tangential travel intact.
            const incoming = [...direction];
            for (const axis of [1, 2]) if (source[axis] < 0 || source[axis] >= 5) {
              source[axis] = source[axis] < 0 ? -1 - source[axis] : 9 - source[axis];
              incoming[axis] *= -1;
            }
            const donorQ = directions.findIndex(c => c.every((value, axis) => value === (freeSlipWalls ? incoming[axis] : -direction[axis])));
            const donor = freeSlipWalls ? cell(source[0], source[1], source[2]) : cell(x, y, z);
            for (const backend of ['wasm', 'gpu']) assert.equal(probe[backend].f[cell(x,y,z)*19+q], probe[backend].post[donor*19+donorQ],
              `${backend} ${freeSlipWalls ? 'slip' : 'no-slip'} boundary (${x},${y},${z}) direction ${direction}`);
            reflected++;
          });
        }
        assert.ok(reflected > 100);
        closeFields(probe.gpu.f, probe.wasm.f, 2e-7, 'GPU/WASM populations');
      }
      // Pressure outlet: preserve interior velocity and non-equilibrium stress.
      // Independent one-step oracles use equilibrium initial populations, so
      // collision leaves them unchanged and only streaming contributes here.
      for (const mode of ['shear', 'pressure'] as const) {
        const outletInitial = Array.from({ length: 175 * 19 }, (_, index) => {
          const i = Math.floor(index / 19), q = index % 19, x = i % 7, y = Math.floor(i / 7) % 5;
          const rho = mode === 'pressure' && x === 4 ? 1.03 : 1;
          const ux = config.uInlet + (mode === 'shear' ? .003 * (y - 2) : 0), cu = directions[q][0] * ux;
          return Math.fround(rho * (q === 0 ? 1/3 : q < 7 ? 1/18 : 1/36) * (1 + 3*cu + 4.5*cu*cu - 1.5*ux*ux));
        });
        const probe = await page.evaluate(({ config, initial }) => (window as any).probeLbmBoundary(config, initial, null, 1),
          { config: { ...config, tau: .8 }, initial: outletInitial });
        const addedMass = .03 * (1 + 3*config.uInlet + 3*config.uInlet**2) / 6;
        const expectedUx = mode === 'pressure' ? (config.uInlet + addedMass) / (1 + addedMass) : config.uInlet;
        const expectedShear = mode === 'shear' ? -.003/3 : 0;
        const measured: Record<string, { rho: number; ux: number; shear: number }> = {};
        for (const backend of ['wasm', 'gpu'] as const) {
          const f = probe[backend].f.slice(cell(6,2,2)*19, (cell(6,2,2)+1)*19);
          const rho = f.reduce((sum: number, value: number) => sum + value, 0);
          const velocity = [0,1,2].map(axis => f.reduce((sum: number, value: number, q: number) => sum + value*directions[q][axis], 0)/rho);
          const shear = f.reduce((sum: number, value: number, q: number) => sum + value*directions[q][0]*directions[q][1], 0) - rho*velocity[0]*velocity[1];
          closeFields([rho, ...velocity, shear], [1, expectedUx, 0, 0, expectedShear], 2e-7, `${backend} ${mode} pressure outlet`);
          measured[backend] = { rho, ux: velocity[0], shear };
        }
        closeFields(probe.gpu.f, probe.wasm.f, 2e-7, `${mode} outlet GPU/WASM populations`);
        console.log('NEE outlet oracle', JSON.stringify({ mode, cells: 175, steps: 1, tolerance: 2e-7, expected: { rho: 1, ux: expectedUx, shear: expectedShear }, measured }));
      }
      console.log('PASS tiny pressure outlet: one-step shear stress and pressure-driven velocity preserved, reference density held, real WebGPU and Rust/WASM');
      // Independent streamed velocity-inlet oracles: rho is copied from the
      // current neighbor while prescribed velocity replaces its first moment.
      for (const mode of ['shear', 'pressure'] as const) {
        const inletInitial = Array.from({ length: 175 * 19 }, (_, index) => {
          const q = index % 19, x = Math.floor(index / 19) % 7;
          const rho = mode === 'pressure' && x === 2 ? 1.03 : 1;
          const uy = mode === 'shear' ? .003*x : 0, ux = config.uInlet;
          const cu = directions[q][0]*ux + directions[q][1]*uy;
          return Math.fround(rho*(q === 0 ? 1/3 : q < 7 ? 1/18 : 1/36)*(1 + 3*cu + 4.5*cu*cu - 1.5*(ux*ux+uy*uy)));
        });
        const probe = await page.evaluate(({ config, initial }) => (window as any).probeLbmBoundary(config, initial, null, 1),
          { config: { ...config, tau: .8 }, initial: inletInitial });
        const delta = mode === 'pressure' ? .03*(1-3*config.uInlet+3*config.uInlet**2)/6 : 0;
        const expectedRho = 1+delta, expectedShear = mode === 'shear' ? .003*(config.uInlet**2-1/3) : 0;
        const measured: Record<string, { rho: number; ux: number; shear: number }> = {};
        for (const backend of ['wasm', 'gpu'] as const) {
          const f = probe[backend].f.slice(cell(0,2,2)*19, (cell(0,2,2)+1)*19);
          const rho = f.reduce((sum: number, value: number) => sum+value, 0);
          const velocity = [0,1,2].map(axis => f.reduce((sum: number, value: number, q: number) => sum+value*directions[q][axis], 0)/rho);
          const shear = f.reduce((sum: number, value: number, q: number) => sum+value*directions[q][0]*directions[q][1], 0)-rho*velocity[0]*velocity[1];
          // The enforced per-population GPU/WASM bound below contributes 19ε
          // to density; the independent WASM oracle contributes one further ε.
          // This triangle-inequality budget is independent of observed GPU output.
          closeFields([rho], [expectedRho], (backend === 'gpu' ? 20 : 1)*2e-7, `${backend} ${mode} inlet density`);
          const donor = probe[backend].f.slice(cell(1,2,2)*19, (cell(1,2,2)+1)*19);
          const donorRho = donor.reduce((sum: number, value: number) => sum+value, 0);
          // Separate acceptance of this small case's reconstruction from upstream
          // FP32 collision error; these are not universal WGSL error guarantees.
          closeFields([rho], [donorRho], 2e-7, `${backend} ${mode} inlet/donor mass`);
          closeFields([...velocity, shear], [config.uInlet, 0, 0, expectedShear], 2e-7, `${backend} ${mode} velocity inlet`);
          measured[backend] = { rho, ux: velocity[0], shear };
        }
        closeFields(probe.gpu.f, probe.wasm.f, 2e-7, `${mode} inlet GPU/WASM populations`);
        console.log('NEE inlet oracle', JSON.stringify({ mode, cells: 175, steps: 1, populationTolerance: 2e-7, gpuDensitySumBudget: 4e-6, inletDonorMassTolerance: 2e-7, expected: { rho: expectedRho, ux: config.uInlet, shear: expectedShear }, measured }));
      }
      for (const boundary of ['inlet', 'outlet'] as const) {
        const corrupt = await page.evaluate(({ config, boundary }) => (window as any).probeLbmBoundary(config, null, null, 1, 0, boundary)
          .then(() => null).catch((error: unknown) => String(error)), { config: { ...config, tau: .8 }, boundary });
        assert.match(corrupt ?? '', /GPU numerical failure/);
      }
      console.log('PASS synthetic zero-density inlet/outlet donor: same-step GPU force readback rejects numerical failure without requiring field output');
      // A heater and local fan beside the wall produce nonuniform thermal mass
      // and energy immediately; no convergence run is needed to check transport.
      const thermal = { gravityPerKelvin: 0, dtSeconds: .0001, ambientC: 25, fixedSurfaceC: 50,
        dxMeters: .01, fluidDensity: 1, fluidSpecificHeat: 1000, fluidConductivity: 1,
        solidDensity: 0, solidSpecificHeat: 0, solidConductivity: 0, totalPowerW: 0,
        mode: 'fixed-temperature', maxSubsteps: 32, temperatureScaleC: 25 };
      for (const groundVelocityLattice of [0, config.uInlet]) {
        const probe = await page.evaluate(config => (window as any).probeLbmBoundary(config, null, null, 1),
          { ...config, groundVelocityLattice });
        for (const backend of ['wasm', 'gpu']) {
          const i = cell(3, 0, 2), post = probe[backend].post.slice(i*19, (i+1)*19), f = probe[backend].f.slice(i*19, (i+1)*19);
          const rho = post.reduce((a: number, b: number) => a+b, 0);
          for (const q of [3,7,10,15,17]) {
            const opposite = directions.findIndex(c => c.every((value, axis) => value === -directions[q][axis]));
            const expected = post[opposite] + 6*(q < 7 ? 1/18 : 1/36)*rho*directions[q][0]*groundVelocityLattice;
            assert.ok(Math.abs(f[q]-expected)<2e-8, `${backend} ground incoming population ${q}`);
          }
          const mass = f.reduce((a: number, b: number) => a+b, 0);
          const ux = f.reduce((sum: number, value: number, q: number) => sum+value*directions[q][0], 0)/mass;
          assert.ok(Math.abs(mass-rho)<2e-7, `${backend} ground has no net mass injection`);
          // This is the first fluid center, half a cell above the wall, not the wall velocity.
          const expectedUx = groundVelocityLattice === 0 ? config.uInlet*2/3 : config.uInlet;
          assert.ok(Math.abs(ux-expectedUx)<1e-7, `${backend} first-step ground momentum`);
        }
        closeFields(probe.gpu.f, probe.wasm.f, 2e-7, 'ground populations');
      }
      // One solid voxel touches y=0: the exposed surface lacks its lower face.
      // Gauge pressure removes only rho_ref=1, not an actual pressure difference.
      const contactCell = cell(3, 0, 2), contactConfig = { ...config, uInlet: 0, groundVelocityLattice: 0 };
      const restingContact = await page.evaluate(({ config, solid }) => (window as any).probeLbmBoundary(config, null, solid, 5),
        { config: contactConfig, solid: contactCell });
      console.log(JSON.stringify({ case: 'wall-contact-rest', steps: 5, wasmForce: restingContact.wasm.force, webgpuForce: restingContact.gpu.force }));
      for (const [axis, key] of ['fx', 'fy', 'fz'].entries()) {
        // Per-step FP32 population/reduction roundoff; fixed absolute lattice-force
        // tolerance, independent of a near-zero result or an arbitrary force scale.
        assert.ok(Math.abs(restingContact.wasm.force[axis]) <= 5 * 2e-7, `resting wall-contact WASM ${key}: ${restingContact.wasm.force[axis]}`);
        assert.ok(Math.abs(restingContact.gpu.force[key]) <= 5 * 2e-7, `resting wall-contact WebGPU ${key}: ${restingContact.gpu.force[key]}`);
        assert.ok(Math.abs(restingContact.gpu.force[key] - restingContact.wasm.force[axis]) <= 5 * 2e-7);
      }
      const pressureDelta = 1 / 32;
      for (const pressure of ['uniform-offset', 'left-right'] as const) {
        const populations = Array.from({ length: 175 * 19 }, (_, index) => {
          const x = Math.floor(index / 19) % 7, q = index % 19;
          const rho = 1 + pressureDelta * (pressure === 'uniform-offset' ? 1 : x < 3 ? 1 : x > 3 ? -1 : 0);
          return Math.fround(rho * (q === 0 ? 1 / 3 : q < 7 ? 1 / 18 : 1 / 36));
        });
        const probe = await page.evaluate(({ config, initial, solid }) => (window as any).probeLbmBoundary(config, initial, solid, 1),
          { config: contactConfig, initial: populations, solid: contactCell });
        // At rest p=rho/3. Upper exposed links sum to 1/6, hence Fy=-delta/3.
        // Each exposed x side has one axial plus three diagonal links: 5/36.
        // Their pressure difference produces Fx=2*(5/36)*(rho_left-rho_right).
        const expected = pressure === 'uniform-offset' ? [0, -pressureDelta / 3, 0] : [5 * pressureDelta / 9, 0, 0];
        console.log(JSON.stringify({ case: `wall-contact-${pressure}`, steps: 1, expectedForce: expected, wasmForce: probe.wasm.force, webgpuForce: probe.gpu.force }));
        for (const [axis, key] of ['fx', 'fy', 'fz'].entries()) {
          assert.ok(Math.abs(probe.wasm.force[axis] - expected[axis]) <= 2e-7, `${pressure} WASM ${key}: ${probe.wasm.force[axis]} vs ${expected[axis]}`);
          assert.ok(Math.abs(probe.gpu.force[key] - expected[axis]) <= 2e-7, `${pressure} WebGPU ${key}: ${probe.gpu.force[key]} vs ${expected[axis]}`);
        }
        closeFields(probe.gpu.f, probe.wasm.f, 2e-7, `${pressure} populations`);
        assert.deepEqual(probe.gpu.clearedForce, { fx: 0, fy: 0, fz: 0, massBalance: null });
      }
      console.log('PASS tiny wall-contact gauge force: five zero-flow steps near zero; one-step uniform/left-right pressure differences retain their analytic forces in real WebGPU and Rust/WASM');
      const thermalProbe = await page.evaluate(config => (window as any).probeLbmBoundary(config, null, 45, 5),
        { ...config, thermal, fan: { center: [3.5, 2, 2], normal: [1, 0, 0], radiusCells: 1, accelerationLattice: .003 } });
      closeFields(thermalProbe.gpu.f, thermalProbe.wasm.f, 3e-7, 'thermal populations');
      closeFields(thermalProbe.gpu.display, thermalProbe.wasm.display, 2e-5, 'thermal display');
      assert.ok(thermalProbe.wasm.thermal.fluidMaxC > 25, 'heat reaches the fluid');
      for (const key of ['thermalEnergyJ', 'sourceEnergyJ', 'boundaryEnergyJ', 'solidMaxC', 'fluidMaxC']) {
        const target = thermalProbe.wasm.thermal[key], actual = thermalProbe.gpu.thermal[key];
        assert.ok(Math.abs(actual - target) <= 1e-8 + Math.abs(target)*5e-5, `near-wall thermal ${key}: ${actual} vs ${target}`);
      }
      for (const backend of ['wasm', 'gpu']) assert.ok(Math.abs(thermalProbe[backend].thermal.energyResidualJ) < 1e-8, `${backend} near-wall energy balance`);
      const groundThermal = await page.evaluate(config => (window as any).probeLbmBoundary(config, null, 45, 5),
        { ...config, thermal, groundVelocityLattice: config.uInlet });
      closeFields(groundThermal.gpu.f, groundThermal.wasm.f, 3e-7, 'moving-ground thermal populations');
      closeFields(groundThermal.gpu.display, groundThermal.wasm.display, 2e-5, 'moving-ground thermal display');
      for (const backend of ['wasm', 'gpu']) assert.ok(Math.abs(groundThermal[backend].thermal.energyResidualJ) < 1e-8, `${backend} adiabatic moving-ground balance`);
      for (const [uInlet, accumulatedForce, steps, withHeat] of [[.04, 2147.45, 1, false], [1e-7, 0, 1, false], [.04, 0, 5, false], [.04, 2147.45, 1, true]] as const) {
        const forceProbe = await page.evaluate(({ config, accumulatedForce, steps }) => (window as any).probeLbmBoundary(config, null, 87, steps, accumulatedForce),
          { config: { ...config, uInlet, ...(withHeat ? { thermal } : {}) }, accumulatedForce, steps });
        const actual = forceProbe.gpu.force, expected = forceProbe.wasm.force;
        // FP32 distributions and workgroup additions round on each step;
        // the native/WASM reference accumulates its per-step force in FP64.
        const tolerance = accumulatedForce ? 5e-4 : steps * 2e-7;
        for (const [axis, key] of ['fx', 'fy', 'fz'].entries()) assert.ok(Math.abs(actual[key] - expected[axis] - (axis === 0 ? Math.fround(accumulatedForce) : 0)) <= tolerance,
          `GPU force ${key} should preserve FP32 magnitude: ${actual[key]} vs ${expected[axis]}`);
        assert.deepEqual(forceProbe.gpu.clearedForce, { fx: 0, fy: 0, fz: 0, massBalance: null });
        if (accumulatedForce) assert.ok(actual.fx > 2147.483647, 'force must not wrap at the old i32 limit');
        if (uInlet < 1e-6) assert.ok(actual.fx > 0 && actual.fx < 1e-6, 'sub-micro lattice force must not be quantized to zero');
      }
      console.log('PASS tiny real WebGPU/WASM: nonuniform slip/no-slip face and corner transport, five-step near-wall fan/heater energy balance');
      console.log('PASS tiny real WebGPU/WASM: stationary/moving ground populations, mass and first-step momentum; five-step adiabatic thermal transport');
      console.log('PASS tiny real WebGPU/WASM force: large cumulative and sub-micro forces, partial workgroups, five-step accumulation, thermal path and snapshot clear');
    }
    const stopped = await page.evaluate(spec => (window as any).executeLocal(spec, true), createModuleJobSpec(localInput));
    assert.ok(stopped.error); assert.equal(apiRequests, 0);
    assert.equal((getSqlite().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n, 0);
    await page.evaluate(() => (window as any).mountModule('fdtd'));
    const anonymousModule = page.locator('[data-simulation-module="fdtd"]');
    await anonymousModule.getByRole('spinbutton', { name: /FDTD/ }).fill('3');
    await anonymousModule.getByRole('button', { name: /开始计算|Start computation/ }).click();
    await expect(anonymousModule.getByRole('status')).toHaveText(/已完成|Completed/);
    assert.equal(apiRequests, 0);
    for (const location of ['browser', 'backend']) {
      if (location === 'backend') await anonymousModule.getByRole('button', { name: /后端计算|Backend compute/ }).click();
      await anonymousModule.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(anonymousModule.getByRole('alert')).toContainText('发布计算任务需要登录');
      await expect(anonymousModule.getByRole('link', { name: /登录|Sign in/ })).toHaveAttribute('href', /auth\/oidc\/start/);
    }
    assert.equal((getSqlite().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n, 0);
    for (const execution of [undefined, 'browser']) {
      assert.equal(await page.evaluate(async body => (await fetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status,
        { spec: createModuleJobSpec(localInput), execution }), 401);
    }
    assert.equal(await page.evaluate(async () => (await fetch('/api/v1/artifacts', { method: 'POST', body: 'private model' })).status), 401);
    assert.deepEqual(errors, []);
    await page.evaluate(() => (window as any).unmountModule());
    console.log('PASS anonymous real Worker/WASM: 3-step RLC and in-memory flow, cancellation, FDTD UI, no uploads/jobs; publishing requires login');
    if (process.argv.includes('--auth-only')) return;
    signedIn = true;
    await checkUploadLease();
    workerCount = 0;

    await page.waitForFunction(() => typeof (window as any).execute === 'function');
    const samples: ModuleComputeInput[] = [
      { module: 'ripple', scene: { damping: 0.998, steps: 5, seeds: [{ x: 90, y: 90, radius: 3, amount: -1.37 }] } },
      { module: 'sim', scene: { r: 0.2, steps: 5, seeds: [{ x: 0, y: 0, radius: 3, amount: 71.23 }] } },
      { module: 'fdtd', scene: { preset: 'interface', boundary: 'mur', shape: 'point', time: 'cw', omega: 0.3, steps: 3, sources: [{ i: 109, j: 1 }] } },
    ];
    samples.push(...[false, true].map(barostat => ({ module: 'md' as const, scene: { N: 64, temperature: 0.4, thermostat: true, barostat, targetP: 0.5, tauP: 0.5, steps: 9, seed: 3 } })));
    samples.push({ module: 'particles', scene: particleScene() }, { module: 'fluid', scene: fluidScene() }, { module: 'convection', scene: convectionScene() }, { module: 'ising', scene: isingScene() });
    samples.push({ module: 'rlc', scene: rlcScene() }, { module: 'mutual', scene: mutualScene() },
      { module: 'neuron', scene: neuronScene() }, { module: 'vibration', scene: vibrationScene() });
    samples.push({ module: 'optics-lab', components: opticsScene() }, ...planeInputs, ...extremePlaneInputs, ...antennaInputs, antennaEdgeInputs[2], antennaEdgeInputs[5], ...detectionInputs, ...detectionEdgeInputs, ...signalArrayInputs, ...signalArrayRcInputs, ...transientInputs, ...faradayInputs);
    for (const input of samples) {
      // Each fixture family has a fresh test quota; production rate limits stay unchanged.
      if (input === detectionInputs[0] || input === signalArrayInputs[0]) resetRateLimitsForTests();
      const outcome = await page.evaluate(spec => (window as any).execute(spec, false), createModuleJobSpec(input));
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.result.derived.engine, 'rust-wasm');
      // Host transports JSON numbers, which cannot retain JavaScript's -0 sign.
      // The kernel ABI suite separately requires exact native/WASM f64 bits.
      assert.deepEqual(readModuleResult(outcome.result, input), JSON.parse(JSON.stringify(await computeModule(input))));
      const id = await page.evaluate(() => (window as any).jobId);
      assert.equal(service.getJob(id)?.status, 'succeeded');
      assert.equal(service.getJob(id)?.compute, undefined);
    }
    const interruptInput = { module: 'fdtd' as const, scene: { preset: 'cavity' as const, boundary: 'pec' as const, shape: 'point' as const, time: 'pulse' as const, omega: 0.3, steps: 16, sources: [{ i: 100, j: 100 }] } };
    const cancelled = await page.evaluate(spec => (window as any).execute(spec, true), createModuleJobSpec(interruptInput));
    assert.ok(cancelled.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    assert.equal(workerCount, samples.length + 1);
    resetRateLimitsForTests();
    const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
      ownerUserId: 'browser-smoke', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
    const spec = lbmSpec(model.id);
    spec.outputs.fields!.push('pressure');
    spec.requirements!.features!.push(LBM_PRESSURE_FIELD_FEATURE);
    spec.model!.referenceArea = 0.5;
    const preparedWind = prepareLbmInput(spec, lbmGeometry);
    const millimetreCoordinates = prepareLbmInput(spec, { ...lbmGeometry, vertices: lbmGeometry.vertices.map(value => value * 1000) });
    assert.deepEqual(millimetreCoordinates, preparedWind, 'explicit physical length preserves the same lattice for metre and millimetre mesh coordinates');
    const wind = await page.evaluate(spec => (window as any).execute(spec, false), spec);
    assert.equal(wind.error, undefined, wind.error);
    const windJob = service.getJob(await page.evaluate(() => (window as any).jobId))!;
    assert.equal(windJob.status, 'succeeded'); assert.equal(windJob.compute, undefined);
    // 流场帧现在打包为单个压缩 lbm-display-seq artifact（V3 量化存储）：
    // 解出序列后与经同样 V3 量化往返的参考快照比对。
    const expectFlowFrames = async (artifactId: string, snapshots: LbmDisplaySnapshot[]) => {
      const blob = artifacts.readArtifactBytes(artifactId)!;
      const bytes = bufferBytes(blob.data);
      let frames: LbmDisplaySnapshot[];
      try {
        frames = decodeFlowSequence(await decompressSequenceBlob(bytes));
      } catch (error) {
        writeFileSync(`/tmp/flow-artifact-${artifactId}.bin`, blob.data);
        console.error(`flow artifact ${artifactId}: ${blob.data.byteLength}B magic=${blob.data.subarray(0, 8).toString('hex')} → /tmp/flow-artifact-${artifactId}.bin`);
        throw error;
      }
      assert.deepEqual(frames, snapshots.map(s => decodeFlowSnapshot(encodeFlowSnapshotV3(s))));
    };
    const field = artifacts.readArtifactBytes(wind.result.artifacts[0].artifactId)!;
    const reference = await runLbmWasm(spec, preparedWind);
    await expectFlowFrames(wind.result.artifacts[0].artifactId, [reference.snapshot!]);
    assert.equal(field.meta.contentType, 'application/vnd.waveworld.lbm-display-seq-v1');
    assert.equal(wind.result.derived.pressureScalePa, reference.result.derived?.pressureScalePa);
    assert.deepEqual(wind.result.history, reference.result.history);
    assert.equal(field.meta.ownerUserId, 'browser-smoke'); assert.equal(field.meta.jobId, windJob.id);
    const groundInput = groundSpec(model.id);
    groundInput.run = { ...groundInput.run, forceSampleEvery: 3, warmupSteps: 2 };
    const ground = await page.evaluate(spec => (window as any).execute(spec, false), groundInput);
    assert.equal(ground.error, undefined, ground.error);
    const groundReference = await runLbmWasm(groundInput, prepareLbmInput(groundInput, lbmGeometry));
    assert.deepEqual(ground.result.history.step, [3]);
    assert.deepEqual(ground.result.history, groundReference.result.history);
    await expectFlowFrames(ground.result.artifacts[0].artifactId, [groundReference.snapshot!]);
    for (const key of ['groundMode', 'groundClearanceM', 'groundVelocityMps', 'lbm-ground-v1']) {
      assert.equal(ground.result.derived[key], groundReference.result.derived?.[key]);
    }
    const fanModel = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
      ownerUserId: 'browser-smoke', data: new Uint8Array(encodeModelGeometry(fanGeometry)) });
    const fanInput = fanSpec(fanModel.id);
    const fan = await page.evaluate(spec => (window as any).execute(spec, false), fanInput);
    assert.equal(fan.error, undefined, fan.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.compute, undefined);
    const fanReference = await runLbmWasm(fanInput, prepareLbmInput(fanInput, fanGeometry));
    await expectFlowFrames(fan.result.artifacts[0].artifactId, [fanReference.snapshot!]);
    assert.ok(fanReference.snapshot!.display.some((value, i) => i % 2 === 0 && value > 0));
    const thermalInput = thermalSpec(fanModel.id);
    const thermal = await page.evaluate(spec => (window as any).execute(spec, false), thermalInput);
    assert.equal(thermal.error, undefined, thermal.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.compute, undefined);
    const thermalReference = await runLbmWasm(thermalInput, prepareLbmInput(thermalInput, fanGeometry));
    await expectFlowFrames(thermal.result.artifacts[0].artifactId, [thermalReference.snapshot!]);
    assert.equal(thermal.result.derived.ambientC, 25); assert.equal(thermal.result.derived.temperatureScaleC, 35);
    assert.deepEqual(thermal.result.thermal, thermalReference.result.thermal);
    const powerInput = solidPowerSpec(model.id);
    const power = await page.evaluate(spec => (window as any).execute(spec, false), powerInput);
    assert.equal(power.error, undefined, power.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.compute, undefined);
    const powerReference = await runLbmWasm(powerInput, prepareLbmInput(powerInput, lbmGeometry));
    assert.deepEqual(power.result.thermal, powerReference.result.thermal);
    await expectFlowFrames(power.result.artifacts[0].artifactId, [powerReference.snapshot!]);
    const regionsInput = thermalRegionsSpec(model.id);
    const regions = await page.evaluate(spec => (window as any).execute(spec, false), regionsInput);
    assert.equal(regions.error, undefined, regions.error);
    const regionsReference = await runLbmWasm(regionsInput, prepareLbmInput(regionsInput, lbmGeometry));
    assert.deepEqual(regions.result.thermal, regionsReference.result.thermal);
    await expectFlowFrames(regions.result.artifacts[0].artifactId, [regionsReference.snapshot!]);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.compute, undefined);
    const contactsInput = thermalContactsSpec(model.id);
    const contacts = await page.evaluate(spec => (window as any).execute(spec, false), contactsInput);
    assert.equal(contacts.error, undefined, contacts.error);
    const contactsReference = await runLbmWasm(contactsInput, prepareLbmInput(contactsInput, lbmGeometry));
    assert.deepEqual(contacts.result.thermal, contactsReference.result.thermal);
    await expectFlowFrames(contacts.result.artifacts[0].artifactId, [contactsReference.snapshot!]);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.compute, undefined);
    if (includeGpu) {
      for (const [input, expected] of [[thermalInput, thermalReference], [powerInput, powerReference], [regionsInput, regionsReference], [contactsInput, contactsReference], [spec, reference], [groundInput, groundReference]] as const) {
        const gpuSpec = { ...input, requirements: { ...input.requirements, backends: ['webgpu-browser' as const], precision: 'float32' as const } };
        const outcome = await page.evaluate(spec => (window as any).execute(spec, false), gpuSpec);
        assert.equal(outcome.error, undefined, outcome.error);
        assert.equal(outcome.result.derived.precision, 'float32');
        assert.equal(outcome.result.backend.id, 'webgpu-browser');
        for (const key of ['viscosityMode', 'requestedViscosityM2s', 'simulatedViscosityM2s'] as const) {
          assert.equal(outcome.result.derived[key], expected.result.derived?.[key]);
        }
        for (const key of ['cd', 'cl'] as const) {
          assert.equal(key in outcome.result.summary, input.parameters.inletVelocity > 0);
          assert.equal(key in outcome.result.history, input.parameters.inletVelocity > 0);
        }
        for (const key of ['dragN', 'liftN', 'sideN']) {
          assert.equal(outcome.result.history[key].length, expected.result.history!.step.length);
          assert.ok(outcome.result.history[key].every(Number.isFinite));
        }
        const gpuJob = service.getJob(await page.evaluate(() => (window as any).jobId))!;
        assert.equal(gpuJob.status, 'succeeded'); assert.equal(gpuJob.compute, undefined);
        const file = artifacts.readArtifactBytes(outcome.result.artifacts[0].artifactId)!;
        assert.equal(file.meta.ownerUserId, 'browser-smoke'); assert.equal(file.meta.jobId, gpuJob.id);
        const actual = decodeFlowSequence(await decompressSequenceBlob(bufferBytes(file.data))).at(-1)!;
        assert.equal(actual.step, expected.snapshot!.step);
        assert.equal(actual.displayStride, expected.snapshot!.displayStride);
        assert.deepEqual(actual.flags, expected.snapshot!.flags);
        // 存储帧经 V3 u8 量化：期望值先做同样量化往返，再按量化步长给容差。
        const expectedQ = decodeFlowSnapshot(encodeFlowSnapshotV3(expected.snapshot!));
        const stride = actual.displayStride;
        const quantum: number[] = [];
        for (let c = 0; c < stride; c++) {
          let min = Infinity, max = -Infinity;
          for (let i = c; i < actual.display.length; i += stride) {
            if (actual.display[i]! < min) min = actual.display[i]!;
            if (actual.display[i]! > max) max = actual.display[i]!;
          }
          quantum[c] = (max - min) / 255;
        }
        let maxFieldDifference = 0;
        actual.display.forEach((value, index) => {
          const difference = Math.abs(value - expectedQ.display[index]);
          maxFieldDifference = Math.max(maxFieldDifference, difference);
          assert.ok(Number.isFinite(value) && difference <= 1.5 * quantum[index % stride]! + 1e-6,
            `GPU field mismatch at ${index}: ${value} vs ${expectedQ.display[index]}`);
        });
        if (expected.result.thermal) {
          for (const key of ['thermalEnergyJ', 'sourceEnergyJ', 'boundaryEnergyJ', 'solidMaxC', 'fluidMaxC'] as const) {
            const target = expected.result.thermal[key], actual = outcome.result.thermal[key];
            assert.ok(Math.abs(actual - target) <= 1e-8 + Math.abs(target) * 5e-5, `GPU thermal ${key}: ${actual} vs ${target}`);
          }
        }
        console.log(JSON.stringify({ backend: outcome.result.backend, mode: outcome.result.thermal?.mode ?? 'isothermal',
          steps: actual.step, maxFieldDifference, thermal: outcome.result.thermal }));
      }
      const gpuSpec = { ...powerInput, requirements: { ...powerInput.requirements, backends: ['webgpu-browser' as const], precision: 'float32' as const, thermal: true } };
      const cancelled = await page.evaluate(spec => (window as any).execute(spec, 1), gpuSpec);
      assert.ok(cancelled.error);
      const cancelledId = await page.evaluate(() => (window as any).jobId);
      assert.equal(service.getJob(cancelledId)?.status, 'cancelled');
      assert.equal(artifacts.listArtifacts(cancelledId).some(item => item.kind === 'lbm-display'), false);
      console.log('PASS real browser WebGPU jobs, saved owned flow/energy, Rust reference tolerance and cancellation before publication');
    }
    expireLease = true;
    const lost = await page.evaluate(spec => (window as any).execute(spec, false), createModuleJobSpec(samples[0]));
    assert.ok(lost.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'queued');
    resetRateLimitsForTests();
    // Exercise the real product's browser-Agent button and saved field renderer.
    await page.evaluate(() => { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); (window as any).mountModule('fdtd'); });
    const module = page.locator('[data-simulation-module="fdtd"]');
    await module.getByRole('spinbutton', { name: /FDTD/ }).fill('3');
    await module.locator('select').first().selectOption('cavity');
    await module.locator('[data-fdtd-step="3"]').waitFor();
    const preview = await module.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    const compute = module.getByRole('button', { name: /发布计算任务|Publish compute task/ });
    await compute.click();
    await expect(module.getByRole('status')).toHaveText(/已完成|Completed/);
    assert.ok(lastSubmittedId);
    const saved = service.getJob(lastSubmittedId)!;
    assert.equal(saved.status, 'succeeded'); assert.equal(saved.compute, undefined);
    assert.equal(saved.result?.derived?.engine, 'rust-wasm');
    assert.equal((saved.result as any).moduleResult.module, 'fdtd');
    assert.equal(await module.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()), preview);
    await module.getByRole('spinbutton', { name: /FDTD/ }).fill('2');
    await expect(module.getByRole('status')).toHaveText(/待计算|Ready/);
    assert.equal(await module.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
    console.log('PASS FDTD product UI: local preview, real WASM Agent save, identical saved canvas and invalidation after editing');
    await page.evaluate(() => (window as any).mountModule('md'));
    const md = page.locator('[data-simulation-module="md"]');
    await md.getByRole('spinbutton', { name: 'MD steps', exact: true }).fill('9');
    await md.getByRole('combobox', { name: 'MD particles', exact: true }).selectOption('64');
    await md.locator('[data-md-step="9"]').waitFor();
    const mdPreview = await md.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    const mdReadout = await md.locator('[data-md-readout]').innerText();
    const mdCurves = await md.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points')));
    await md.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
    await expect(md.getByRole('status').filter({ hasText: /已完成|Completed/ }))
      .toHaveText(/已完成|Completed/);
    const mdSaved = service.getJob(lastSubmittedId!)!;
    assert.equal(mdSaved.status, 'succeeded'); assert.equal(mdSaved.compute, undefined);
    assert.equal(mdSaved.result?.derived?.engine, 'rust-wasm');
    assert.equal((mdSaved.result as any).moduleResult.module, 'md');
    // 作业路径是 3D（L=cbrt(N/ρ)），交互视图刻意保持 2D——像素/曲线本就不同属设计；
    // 发布结果的读数对照页内 3D computeModule 参考（同一条 WASM 路径）。
    const mdRemote = await computeModule((mdSaved.spec as any).model.inline);
    const mdRemoteObs = (mdRemote as any).result.observables;
    const mdRemoteReadout = await md.locator('[data-md-readout]').innerText();
    for (const [label, value] of [['T*', mdRemoteObs.temperature], ['P*', mdRemoteObs.pressure], ['L*', mdRemoteObs.boxL], ['ρ*', mdRemoteObs.density]] as const) {
      assert.match(mdRemoteReadout, new RegExp(`${label.replace('*', '\\*')}${value.toFixed(3)}`));
    }
    assert.notEqual(await md.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()), mdPreview);
    assert.notEqual(await md.locator('[data-md-readout]').innerText(), mdReadout);
    assert.notDeepEqual(await md.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points'))), mdCurves);
    await md.getByRole('spinbutton', { name: 'MD seed', exact: true }).fill('2');
    await expect(md.getByRole('status').filter({ hasText: /待计算|Ready/ }))
      .toHaveText(/待计算|Ready/);
    assert.equal(await md.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
    const mdCancel = { module: 'md' as const, scene: { N: 64, temperature: 0.4, thermostat: true, barostat: false, targetP: 0.5, tauP: 0.5, steps: 16, seed: 3 } };
    const cancelledMd = await page.evaluate(spec => (window as any).execute(spec, 4), createModuleJobSpec(mdCancel));
    assert.ok(cancelledMd.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS MD real WASM Agent, identical saved particles/readout/curves, parameter invalidation and cancellation');
    for (const path of ['fluid', 'convection'] as const) {
      await page.evaluate(path => (window as any).mountModule(path), path);
      const module = page.locator(`[data-simulation-module="${path}"]`);
      await module.getByRole('spinbutton', { name: path === 'fluid' ? 'Fluid steps' : 'Convection steps', exact: true }).fill('3');
      await module.locator(`[data-${path}-step="3"]`).waitFor();
      const preview = await module.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
      const readout = await module.locator(`[data-${path}-readout]`).innerText();
      await module.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(module.getByRole('status')).toHaveText(/已完成|Completed/);
      const saved = service.getJob(lastSubmittedId!)!;
      assert.equal(saved.status, 'succeeded'); assert.equal(saved.compute, undefined);
      assert.equal(saved.result?.derived?.engine, 'rust-wasm');
      assert.equal((saved.result as any).moduleResult.module, path);
      assert.equal(await module.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()), preview);
      assert.equal(await module.locator(`[data-${path}-readout]`).innerText(), readout);
      await module.getByRole('spinbutton', { name: path === 'fluid' ? 'Fluid steps' : 'Convection steps', exact: true }).fill('2');
      await expect(module.getByRole('status')).toHaveText(/待计算|Ready/);
      assert.equal(await module.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
    }
    console.log('PASS fluid/convection product UI: actual WASM Agent save, identical canvas/readout and invalidation after editing');

    await page.evaluate(() => (window as any).mountModule('ising'));
    const ising = page.locator('[data-simulation-module="ising"]');
    await ising.getByRole('combobox', { name: 'Ising size', exact: true }).selectOption('16');
    await ising.getByRole('combobox', { name: 'Ising initial state', exact: true }).selectOption('hot');
    await ising.getByRole('spinbutton', { name: 'Ising burn-in', exact: true }).fill('1');
    await ising.getByRole('spinbutton', { name: 'Ising samples', exact: true }).fill('2');
    await ising.getByRole('checkbox', { name: 'Ising temperature sweep', exact: true }).check();
    await ising.getByRole('spinbutton', { name: 'Ising temperature count', exact: true }).fill('3');
    await ising.locator('[data-ising-step="9"]').waitFor();
    const isingCanvas = await ising.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    const isingReadout = await ising.locator('[data-ising-readout]').innerText();
    const isingCurve = await ising.locator('svg[aria-label="Ising magnetization curve"]').innerHTML();
    await ising.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
    await expect(ising.getByRole('status')).toHaveText(/已完成|Completed/);
    const savedIsing = service.getJob(lastSubmittedId!)!;
    assert.equal(savedIsing.status, 'succeeded'); assert.equal(savedIsing.compute, undefined);
    assert.equal(savedIsing.result?.derived?.engine, 'rust-wasm');
    assert.equal(savedIsing.result?.derived?.precision, 'float64');
    assert.equal(await ising.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()), isingCanvas);
    assert.equal(await ising.locator('[data-ising-readout]').innerText(), isingReadout);
    assert.equal(await ising.locator('svg[aria-label="Ising magnetization curve"]').innerHTML(), isingCurve);
    await ising.getByRole('spinbutton', { name: 'Ising seed', exact: true }).fill('2');
    await expect(ising.getByRole('status')).toHaveText(/待计算|Ready/);
    assert.equal(await ising.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
    const cancelledIsing = await page.evaluate(spec => (window as any).execute(spec, 8),
      createModuleJobSpec({ module: 'ising', scene: { ...isingScene(), temperatures: [2], burnIn: 0, samples: 17 } }));
    assert.ok(cancelledIsing.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS Ising real WASM Agent, seeded temperature scan, saved lattice/readout/curve, invalidation and cancellation');

    // Independent UI cases share a fake client IP; isolate them from the preceding job matrix.
    // Host route tests separately verify the production submission limit.
    resetRateLimitsForTests();
    for (const path of ['rlc', 'mutual', 'neuron', 'vibration'] as const) {
      await page.evaluate(path => (window as any).mountModule(path), path);
      const module = page.locator(`[data-simulation-module="${path}"]`);
      const steps = path === 'rlc' || path === 'mutual'
        ? module.getByRole('slider', { name: /计算步数|Compute steps/ })
        : module.getByRole('spinbutton', { name: path === 'neuron' ? 'Neuron steps' : 'Vibration steps', exact: true });
      await steps.fill('9');
      if (path === 'neuron') await module.getByRole('button', { name: /刺激一下|Stimulate/ }).click();
      const cursor = module.getByRole('slider', { name: path === 'rlc' || path === 'mutual' ? `${path} cursor` : path === 'neuron' ? 'Neuron cursor' : 'Vibration cursor', exact: true });
      await cursor.fill('9');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const pixels = await module.locator('canvas').evaluateAll(canvases => canvases.map(c => (c as HTMLCanvasElement).toDataURL()));
      const readout = await module.locator(`[data-${path}-readout]`).innerText();
      await module.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(module.getByRole('status')).toHaveText(/已完成|Completed/).catch(async cause => {
        throw new Error(`${path}: ${(await module.getByRole('alert').allTextContents()).join('; ')}; host=${service.getJob(lastSubmittedId!)?.error}`, { cause });
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const saved = service.getJob(lastSubmittedId!)!;
      assert.equal(saved.status, 'succeeded'); assert.equal(saved.compute, undefined);
      assert.equal(saved.result?.derived?.engine, 'rust-wasm'); assert.equal(saved.result?.derived?.precision, 'float64');
      assert.deepEqual(await module.locator('canvas').evaluateAll(canvases => canvases.map(c => (c as HTMLCanvasElement).toDataURL())), pixels, path);
      assert.equal(await module.locator(`[data-${path}-readout]`).innerText(), readout, path);
      const savedId = lastSubmittedId;
      const replay = module.getByRole('button', { name: path === 'vibration' ? /播放结果|Replay result/ : /继续|Resume/ });
      const replayCursors = await replay.evaluate(async button => {
        const cursor = button.closest('[data-simulation-module]')!.querySelector<HTMLInputElement>('input[aria-label$="cursor"]')!;
        (button as HTMLButtonElement).click();
        const values: number[] = [];
        for (let frame = 0; frame < 8; frame++) {
          await new Promise(requestAnimationFrame); values.push(Number(cursor.value));
        }
        return values;
      });
      assert.ok(replayCursors.some(value => value > 0 && value < 9), `${path} replay restarts from the end`);
      await expect(cursor).toHaveValue('9');
      await cursor.fill('0');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.notDeepEqual(await module.locator('canvas').evaluateAll(canvases => canvases.map(c => (c as HTMLCanvasElement).toDataURL())), pixels, `${path} saved replay cursor`);
      assert.equal(lastSubmittedId, savedId, 'replay must not create another compute job');
      await steps.fill('8');
      await expect(module.getByRole('status')).toHaveText(/待计算|Ready/);
      assert.equal(await module.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
      const input = samples.find(input => input.module === path)!;
      const cancelInput = { ...input, scene: { ...(input as any).scene, steps: 17 } } as ModuleComputeInput;
      const cancelled = await page.evaluate(spec => (window as any).execute(spec, 8), createModuleJobSpec(cancelInput));
      assert.ok(cancelled.error);
      assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    }
    console.log('PASS four ODE product pages: saved Rust/WASM curves and readout, replay without recompute, edit invalidation and cancellation');

    await page.evaluate(() => (window as any).mountModule('optics-lab'));
    const optics = page.locator('[data-simulation-module="optics-lab"]');
    await optics.getByRole('combobox', { name: /实验示例|Example/ }).selectOption('beamsplit');
    const rays = await optics.getByLabel('Optics scene', { exact: true }).innerHTML();
    const opticsReadout = await optics.locator('[data-optics-readout]').innerText();
    await optics.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
    await expect(optics.getByRole('status')).toHaveText(/已完成|Completed/);
    const opticsJob = service.getJob(lastSubmittedId!)!;
    assert.equal(opticsJob.result?.derived?.engine, 'rust-wasm');
    assert.equal(opticsJob.result?.derived?.precision, 'float64');
    assert.equal(opticsJob.compute, undefined);
    assert.equal(await optics.getByLabel('Optics scene', { exact: true }).innerHTML(), rays);
    assert.equal(await optics.locator('[data-optics-readout]').innerText(), opticsReadout);
    await optics.getByRole('combobox', { name: /实验示例|Example/ }).selectOption('malus');
    await expect(optics.getByRole('status')).toHaveText(/待计算|Ready/);
    assert.equal(await optics.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
    const manySources = Array.from({ length: 32 }, (_, i) => ({ ...opticsScene()[0], id: `source-${i}` }));
    const opticsCancel = await page.evaluate(spec => (window as any).execute(spec, 'after-first-chunk'),
      createModuleJobSpec({ module: 'optics-lab', components: [...manySources, opticsScene()[4]] }));
    assert.ok(opticsCancel.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS optics: actual WASM Agent save, identical rays/readout, edit invalidation and mid-trace cancellation');

    for (const path of ['electromagnetic', 'sound', 'emwave3d'] as const) {
      await page.evaluate(path => (window as any).mountModule(path), path);
      const wave = page.locator(`[data-simulation-module="${path}"]`);
      await wave.locator('canvas').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await wave.getByRole('button', { name: /暂停计算|Pause computation|暂停播放|Pause playback/ }).click();
      if (path === 'emwave3d') await wave.getByRole('spinbutton', { name: 'EM snapshot time' }).fill('1.25');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const pixels = path === 'emwave3d' ? '' : await wave.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
      const readout = path === 'emwave3d' ? '' : await wave.locator(`[data-${path}-readout]`).innerText();
      await wave.locator('canvas').evaluate(c => (c as any).sameCanvas = true);
      await wave.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(wave.getByRole('status')).toHaveText(/已完成|Completed/);
      const saved = service.getJob(lastSubmittedId!)!;
      const input = (saved.spec.model as any).inline as ModuleComputeInput;
      assert.equal(saved.compute, undefined);
      assert.equal(saved.result?.derived?.engine, 'rust-wasm');
      assert.equal(saved.result?.derived?.precision, 'float64');
      assert.deepEqual(readModuleResult(saved.result!, input), await computeModule(input));
      if (input.module === 'emwave3d') {
        assert.equal(input.params.time, 1.25);
        await expect(wave.locator('[data-emwave3d-readout]')).toContainText('t = 1.25');
      } else {
        assert.ok('timeSeconds' in input && input.timeSeconds > 0, 'save must capture the displayed time instead of zero');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await wave.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL()), pixels);
        assert.equal(await wave.locator(`[data-${path}-readout]`).innerText(), readout);
      }
      assert.equal(await wave.locator('canvas').evaluate(c => (c as any).sameCanvas), true);
      if (path === 'emwave3d') await wave.getByRole('spinbutton', { name: 'EM snapshot time' }).fill('2');
      else await wave.getByRole('combobox', { name: path === 'sound' ? /介质|Medium/ : /波段|Band/ }).selectOption(path === 'sound' ? 'water' : 'visible');
      await expect(wave.getByRole('status')).toHaveText(/待计算|Ready/);
      assert.equal(await wave.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
      const cancelled = await page.evaluate(spec => (window as any).execute(spec, 0), createModuleJobSpec(planeInputs.find(i => i.module === path)!));
      assert.ok(cancelled.error);
      assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    }
    console.log('PASS three plane-wave pages: captured displayed time, actual FP64 WASM Agent, saved canvas/readout, invalidation and cancellation');

    for (const path of ['antennapattern', 'antenna3d', 'phasedarray'] as const) {
      await page.evaluate(path => (window as any).mountModule(path), path);
      const scene = page.locator(`[data-simulation-module="${path}"]`);
      await scene.locator('canvas').waitFor();
      if (path === 'antennapattern') await scene.getByRole('button', { name: /^(定向天线|Directional)$/ }).click();
      else if (path === 'antenna3d') await scene.getByRole('slider', { name: /极化失配|Pol. mismatch/ }).fill('90');
      else {
        await scene.getByRole('slider').nth(1).fill('1');
        await scene.getByRole('slider').nth(2).fill('80');
      }
      await scene.getByRole('button', { name: /暂停播放|Pause playback/ }).click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const readout = scene.locator(path === 'phasedarray' ? '[data-phasedarray-readout]' : '[data-antenna-readout]');
      const before = await readout.innerText();
      const pixels = path === 'antenna3d' ? null : await scene.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
      await scene.locator('canvas').evaluate(c => (c as any).sameCanvas = true);
      await scene.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(scene.getByRole('status')).toHaveText(/已完成|Completed/);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const saved = service.getJob(lastSubmittedId!)!, input = (saved.spec.model as any).inline as ModuleComputeInput;
      assert.equal(saved.compute, undefined);
      assert.equal(saved.result?.derived?.engine, 'rust-wasm');
      assert.equal(saved.result?.derived?.precision, 'float64');
      assert.deepEqual(readModuleResult(saved.result!, input), JSON.parse(JSON.stringify(await computeModule(input))));
      assert.equal(await readout.innerText(), before);
      if (pixels) assert.equal(await scene.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL()), pixels);
      else assert.match(before, /−∞/);
      assert.equal(await scene.locator('canvas').evaluate(c => (c as any).sameCanvas), true);
      // Saved display is stable; a parameter edit invalidates the completed result.
      await scene.getByRole('slider').first().fill(path === 'phasedarray' ? '8' : path === 'antenna3d' ? '1000000000' : '25');
      await expect(scene.getByRole('status')).toHaveText(/待计算|Ready/);
      assert.equal(await scene.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
      const cancelled = await page.evaluate(spec => (window as any).execute(spec, 0), createModuleJobSpec(antennaInputs.find(i => i.module === path)!));
      assert.ok(cancelled.error);
      assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    }
    console.log('PASS antenna/array pages: Rust/WASM Agent, saved patterns/readouts, ideal null link, clipped lobe, preserved canvas, edit invalidation and cancellation');

    resetRateLimitsForTests();
    for (const path of ['radar', 'laser', 'nljd'] as const) {
      await page.evaluate(path => (window as any).mountModule(path), path);
      const scene = page.locator(`[data-simulation-module="${path}"]`);
      await scene.locator('canvas').first().waitFor();
      if (path === 'radar') {
        await scene.getByRole('spinbutton', { name: 'Radar steps' }).fill('5');
        await scene.locator('canvas').first().click({ position: { x: 24 * 2.4, y: 100 * 2.4 } });
        await scene.locator('[data-radar-step="5"]').waitFor();
      } else if (path === 'laser') {
        await scene.getByRole('slider').fill('1200');
        await scene.getByRole('spinbutton', { name: 'Laser steps' }).fill('4');
        await scene.locator('[data-laser-step="4"]').waitFor();
      } else {
        await scene.getByRole('button', { name: /锈蚀假结|Corrosion false/ }).click();
        await scene.getByRole('button', { name: /暂停播放|Pause playback/ }).click();
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const readout = scene.locator(`[data-${path}-readout]`), before = await readout.innerText();
      const pixels = await scene.locator('canvas').evaluateAll(canvases => canvases.map(c => (c as HTMLCanvasElement).toDataURL()));
      await scene.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(scene.getByRole('status')).toHaveText(/已完成|Completed/);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const saved = service.getJob(lastSubmittedId!)!, input = (saved.spec.model as any).inline as ModuleComputeInput;
      assert.equal(saved.compute, undefined);
      assert.equal(saved.result?.derived?.engine, 'rust-wasm');
      assert.equal(saved.result?.derived?.precision, path === 'radar' ? 'mixed' : 'float64');
      assert.deepEqual(readModuleResult(saved.result!, input), JSON.parse(JSON.stringify(await computeModule(input))));
      assert.equal(await readout.innerText(), before);
      assert.deepEqual(await scene.locator('canvas').evaluateAll(canvases => canvases.map(c => (c as HTMLCanvasElement).toDataURL())), pixels);
      if (path === 'radar') {
        await scene.locator('select').selectOption('1');
        await expect(scene.getByRole('status')).toHaveText(/已完成|Completed/);
        await scene.getByRole('spinbutton', { name: 'Radar steps' }).fill('6');
      } else if (path === 'laser') await scene.getByRole('slider').fill('1600');
      else {
        await scene.getByRole('slider').fill('10');
        await expect(scene.getByRole('status')).toHaveText(/已完成|Completed/);
        await scene.getByRole('button', { name: /纯金属|Metal \(linear\)/ }).click();
      }
      await expect(scene.getByRole('status')).toHaveText(/待计算|Ready/);
      const cancelled = await page.evaluate(spec => (window as any).execute(spec, 0), createModuleJobSpec(detectionInputs.find(i => i.module === path)!));
      assert.ok(cancelled.error);
      assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    }
    console.log('PASS radar/laser/NLJD pages: shared Rust/WASM Agent, saved fields and readouts, view-only edits, invalidation and cancellation');

    resetRateLimitsForTests();
    await page.evaluate(() => (window as any).mountModule('signal-array'));
    const arrayScene = page.locator('[data-simulation-module="signal-array"]');
    await arrayScene.locator('[data-array-reconstruction="solved"]').waitFor();
    await arrayScene.getByRole('spinbutton', { name: 'Array paint value' }).fill('2');
    await arrayScene.getByRole('button', { name: /^Input cell 1,1:/ }).click();
    await arrayScene.getByLabel('Array readout circuit', { exact: true }).selectOption('rc');
    await arrayScene.locator('[data-array-settling]').waitFor();
    for (const mode of ['solved', 'rank-deficient', 'regularized']) {
      if (mode === 'rank-deficient') {
        await arrayScene.getByRole('button', { name: /行列读出示例|Row\/column example/ }).click();
        await arrayScene.getByLabel('Array readout circuit', { exact: true }).selectOption('rc');
      }
      if (mode === 'regularized') await arrayScene.getByRole('spinbutton', { name: 'Array regularization' }).fill('0.25');
      await arrayScene.locator('[data-array-reconstruction="' + mode + '"]').waitFor();
      const before = await arrayScene.locator('[data-array-readout]').innerText();
      const shapes = await arrayScene.locator('svg').evaluateAll(nodes => nodes.map(n => n.outerHTML));
      await arrayScene.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(arrayScene.getByRole('status')).toHaveText(/已完成|Completed/);
      const saved = service.getJob(lastSubmittedId!)!, input = (saved.spec.model as any).inline as ModuleComputeInput;
      assert.equal(saved.result?.derived?.engine, 'rust-wasm');
      assert.equal(saved.result?.derived?.precision, 'float64');
      assert.deepEqual(readModuleResult(saved.result!, input), JSON.parse(JSON.stringify(await computeModule(input))));
      assert.equal(await arrayScene.locator('[data-array-readout]').innerText(), before);
      assert.deepEqual(await arrayScene.locator('svg').evaluateAll(nodes => nodes.map(n => n.outerHTML)), shapes);
    }
    await arrayScene.locator('details:has(textarea) > summary').click();
    await arrayScene.getByLabel('Import array model', { exact: true }).setInputFiles({ name: 'array.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(signalArrayInputs[2].scene)) });
    await expect(arrayScene.getByRole('status')).toHaveText(/待计算|Ready/);
    await arrayScene.locator('[data-array-reconstruction="solved"]').waitFor();
    const imported = await arrayScene.locator('[data-array-readout]').innerText();
    await arrayScene.getByRole('textbox', { name: 'Array model JSON' }).fill('{"rows":0}');
    await arrayScene.getByRole('button', { name: /应用模型|Apply model/ }).click();
    await arrayScene.getByRole('alert').waitFor();
    assert.equal(await arrayScene.locator('[data-array-readout]').innerText(), imported);
    const arrayCancelled = await page.evaluate(spec => (window as any).execute(spec, 0), createModuleJobSpec(signalArrayInputs[0]));
    assert.ok(arrayCancelled.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS spatial-array page: paint, rank deficiency, ridge, saved SVG/readouts, custom import, invalid-input preservation and cancellation');

    await page.evaluate(() => (window as any).mountModule('transient'));
    const transient = page.locator('[data-simulation-module="transient"]');
    await transient.locator('[data-transient-readout]').waitFor();
    await transient.getByRole('slider', { name: 'transient cursor' }).fill('48');
    const transientText = await transient.locator('[data-transient-readout]').innerText();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const transientPixels = await transient.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
    await transient.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
    await expect(transient.getByRole('status')).toHaveText(/已完成|Completed/);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await transient.locator('[data-transient-readout]').innerText(), transientText);
    assert.equal(await transient.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL()), transientPixels);
    const transientJob = service.getJob(lastSubmittedId!)!;
    assert.equal(transientJob.result?.derived?.engine, 'rust-wasm');
    assert.deepEqual(readModuleResult(transientJob.result!, (transientJob.spec.model as any).inline), JSON.parse(JSON.stringify(await computeModule((transientJob.spec.model as any).inline))));
    await transient.getByRole('slider', { name: 'transient cursor' }).fill('96');
    await expect(transient.getByRole('status')).toHaveText(/已完成|Completed/);
    await transient.getByRole('slider').first().fill('6');
    await expect(transient.getByRole('status')).toHaveText(/待计算|Ready/);
    const transientCancelled = await page.evaluate(spec => (window as any).execute(spec, 0), createModuleJobSpec(transientInputs[1]));
    assert.ok(transientCancelled.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS transient page: real WASM Agent, exact saved curve and readout, cursor preservation, invalidation and cancellation');

    await page.evaluate(() => (window as any).mountModule('faraday'));
    const faraday = page.locator('[data-simulation-module="faraday"]');
    await faraday.locator('[data-faraday-readout]').waitFor();
    await faraday.getByRole('slider', { name: 'faraday cursor' }).fill('45');
    const faradayText = await faraday.locator('[data-faraday-readout]').innerText();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const faradayPixels = await faraday.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
    await faraday.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
    await expect(faraday.getByRole('status')).toHaveText(/已完成|Completed/);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await faraday.locator('[data-faraday-readout]').innerText(), faradayText);
    assert.equal(await faraday.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL()), faradayPixels);
    const faradayJob = service.getJob(lastSubmittedId!)!;
    assert.equal(faradayJob.result?.derived?.engine, 'rust-wasm');
    assert.deepEqual(readModuleResult(faradayJob.result!, (faradayJob.spec.model as any).inline), JSON.parse(JSON.stringify(await computeModule((faradayJob.spec.model as any).inline))));
    await faraday.getByRole('slider', { name: 'faraday cursor' }).fill('90');
    await expect(faraday.getByRole('status')).toHaveText(/已完成|Completed/);
    await faraday.getByRole('slider').first().fill('3');
    await expect(faraday.getByRole('status')).toHaveText(/已完成|Completed/);
    await faraday.getByRole('slider', { name: /棒速|Rod speed/ }).fill('3');
    await expect(faraday.getByRole('status')).toHaveText(/待计算|Ready/);
    const faradayCancelled = await page.evaluate(spec => (window as any).execute(spec, 0), createModuleJobSpec(faradayInputs[0]));
    assert.ok(faradayCancelled.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS Faraday page: Rust/WASM Agent, exact saved curves/readout, cursor preservation, invalidation and cancellation');


    await page.evaluate(() => (window as any).mountModule('particles'));
    const particles = page.locator('[data-simulation-module="particles"]');
    await particles.getByRole('textbox', { name: 'Particle model JSON', exact: true }).fill(JSON.stringify(particleScene()));
    await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
    for (const imported of [false, true]) {
      if (imported) {
        await particles.getByRole('button', { name: /载入 LAMMPS 示例|Load LAMMPS example/ }).click();
        await expect(particles.getByLabel('Particle input format', { exact: true })).toHaveValue('lammps');
        await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
      }
      await particles.locator('[data-particles-step="' + (imported ? 5 : 7) + '"]').waitFor();
      const pixels = await particles.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
      const readout = await particles.locator('[data-particles-readout]').innerText();
      const curves = await particles.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points')));
      await particles.getByRole('button', { name: /发布计算任务|Publish compute task/ }).click();
      await expect(particles.getByRole('status')).toHaveText(/已完成|Completed/);
      const saved = service.getJob(lastSubmittedId!)!;
      assert.equal(saved.status, 'succeeded'); assert.equal(saved.compute, undefined);
      assert.equal(saved.result?.derived?.engine, 'rust-wasm');
      assert.equal((saved.result as any).moduleResult.module, 'particles');
      assert.equal(await particles.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()), pixels);
      assert.equal(await particles.locator('[data-particles-readout]').innerText(), readout);
      assert.deepEqual(await particles.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points'))), curves);
    }
    await particles.getByRole('spinbutton', { name: 'Particle steps', exact: true }).fill('6');
    await expect(particles.getByRole('status')).toHaveText(/待计算|Ready/);
    assert.equal(await particles.getByRole('link', { name: /查看任务与实例状态|View job and instance status/ }).count(), 0);
    const particleCancel = { module: 'particles' as const, scene: { ...particleScene(), steps: 16 } };
    const cancelledParticles = await page.evaluate(spec => (window as any).execute(spec, 4), createModuleJobSpec(particleCancel));
    assert.ok(cancelledParticles.error);
    assert.equal(service.getJob(await page.evaluate(() => (window as any).jobId))?.status, 'cancelled');
    console.log('PASS custom mixture and LAMMPS import: real WASM Agent, saved particles/readout/RDF, invalidation and cancellation');
    assert.deepEqual(errors, []);
    console.log('PASS real browser WASM wave/heat/FDTD/MD/particles/wind/power Workers, exact flow/thermal account, Host leases/results, cancellation, stale-result rejection, no managed allocation');
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
