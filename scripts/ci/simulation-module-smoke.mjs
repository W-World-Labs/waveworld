// Browser lifecycle smoke only: small CPU work, no server and no numerical matrix.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const lammpsData = readFileSync('public/datasets/lammps-lj-2d.data', 'utf8');
const recordingCsv = readFileSync('public/datasets/mit-bih-100-10s.csv', 'utf8');
const spiceCsv = readFileSync('public/datasets/ngspice-rc-charge.csv', 'utf8');

const { outputFiles } = await build({
  stdin: {
    resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useEffect } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { PageHeader } from './src/components/PageHeader';
      import { SimulationModule } from './src/components/SimulationModule';
      import { SIM_CAPABILITY_CATALOG } from './src/lib/sim/simCapabilityCatalog';
      import { LocaleProvider } from './src/lib/i18n';
      import { useRunning, useRafLoop } from './src/lib/hooks';
      import { OpticsLab } from './src/pages/OpticsLab';
      import { Electromagnetic } from './src/pages/Electromagnetic';
      import { Fdtd } from './src/pages/Fdtd';
      import { EMWave3D } from './src/pages/EMWave3D';
      import { Antenna3D } from './src/pages/Antenna3D';
      import { AntennaPattern } from './src/pages/AntennaPattern';
      import { PhasedArray } from './src/pages/PhasedArray';
      import { SignalArray } from './src/pages/SignalArray';
      import { transientInputs, faradayInputs } from './scripts/ci/ode-fixture';
      import { signalArrayInputs } from './scripts/ci/signal-array-fixture';
      import { NLJD } from './src/pages/NLJD';
      import { RadarScope } from './src/pages/RadarScope';
      import { Localization } from './src/pages/Localization';
      import { TDOA } from './src/pages/TDOA';
      import { STM } from './src/pages/STM';
      import { AFM } from './src/pages/AFM';
      import { Laser } from './src/pages/Laser';
      import { Rlc } from './src/pages/Rlc';
      import { Mutual } from './src/pages/Mutual';
      import { Transient } from './src/pages/Transient';
      import { Faraday } from './src/pages/Faraday';
      import { SmithChart } from './src/pages/SmithChart';
      import { ECG } from './src/pages/ECG';
      import { EEG } from './src/pages/EEG';
      import { EMG } from './src/pages/EMG';
      import { Neuron } from './src/pages/Neuron';
      import { Ultrasound } from './src/pages/Ultrasound';
      import { BioPipeline } from './src/pages/BioPipeline';
      import { Sim } from './src/pages/Sim';
      import { Heaterfc } from './src/pages/Heaterfc';
      import { MD } from './src/pages/MD';
      import { Ising } from './src/pages/Ising';
      import { Vibration } from './src/pages/Vibration';
      import { Ripple } from './src/pages/Ripple';
      import { Convection } from './src/pages/Convection';
      import { Fluid } from './src/pages/Fluid';
      import { Display } from './src/pages/Display';
      import { Particles } from './src/pages/Particles';
      import { Sound } from './src/pages/Sound';
      import { computeModule, moduleComputeSteps, readModuleJobInput } from './src/lib/sim/module-compute';
      import { traceScene, opticsPreset, totalScreenPower } from './src/lib/lab/optics-lab';
      window.recordingCsv = ${JSON.stringify(recordingCsv)};
      window.lammpsData = ${JSON.stringify(lammpsData)};
      window.framesRun = 0; window.disposals = 0;
      window.expectedComputePaths = SIM_CAPABILITY_CATALOG.filter(c => ['cpu', 'webgpu-or-cpu'].includes(c.backend)).map(c => c.path).sort();
      window.submitted = []; window.canceled = []; window.holdJob = false;
      window.computeModule = computeModule;
      window.fetch = async (url, init) => {
        if (String(url).endsWith('/me')) return Response.json({user:{id:'fixture'}});
        if (String(url).endsWith('/datasets/lammps-lj-2d.data')) return new Response(window.lammpsData, { status: window.failLammps ? 503 : 200 });
        if (String(url).endsWith('/datasets/mit-bih-100-10s.csv')) return new Response(window.recordingCsv, { status: window.failRecording ? 503 : 200 });
        if (String(url).endsWith('/cancel')) {
          if (window.rejectCancel) return new Response('{}', { status: 503 });
          window.canceled.push(String(url)); return new Response('{}');
        }
        if (init?.method === 'POST') {
          const spec = JSON.parse(init.body).spec;
          window.submitted.push(spec);
          return Response.json({ job: { id: 'module-' + window.submitted.length } });
        }
        const input = readModuleJobInput(window.submitted.at(-1));
        return Response.json({ job: { status: window.holdJob ? 'running' : 'succeeded', result: {
          schemaVersion: 1, summary: { steps: moduleComputeSteps(input), wallTimeMs: 1 }, backend: { id: 'cpu' }, moduleResult: window.remoteReplay?.module === input.module ? window.remoteReplay : await computeModule(input),
        } } });
      };
      function Probe() {
        const { runningRef, toggle } = useRunning();
        useEffect(() => () => { window.disposals++; }, []);
        useRafLoop(async () => {
          if (window.failFrame) { window.failFrame = false; throw new Error('test solver failure'); }
          if (runningRef.current) window.framesRun++;
        }, []);
        return <button id="local-toggle" onClick={toggle}>local control</button>;
      }
      const root = createRoot(document.getElementById('root'));
      const pages = { 'optics-lab': OpticsLab, electromagnetic: Electromagnetic, sound: Sound, fdtd: Fdtd, emwave3d: EMWave3D, antenna3d: Antenna3D, antennapattern: AntennaPattern, laser: Laser, phasedarray: PhasedArray, nljd: NLJD, 'signal-array': SignalArray, radar: RadarScope, localization: Localization, tdoa: TDOA, stm: STM, afm: AFM, rlc: Rlc, mutual: Mutual, transient: Transient, faraday: Faraday, smith: SmithChart, ecg: ECG, eeg: EEG, emg: EMG, neuron: Neuron, ultrasound: Ultrasound, biopipeline: BioPipeline, sim: Sim, heaterfc: Heaterfc, md: MD, ising: Ising, vibration: Vibration, ripple: Ripple, convection: Convection, fluid: Fluid, display: Display, particles: Particles };
      window.mountModule = (path, optics = false) => root.render(
        <LocaleProvider><MemoryRouter><SimulationModule path={path}>
          {optics ? React.createElement(pages[path]) : <><PageHeader title="Probe" showMethods={false}/><Probe/></>}
        </SimulationModule></MemoryRouter></LocaleProvider>
      );
      window.opticsPower = totalScreenPower(traceScene(opticsPreset('mirror-bounce')));
      window.prepareOpticsReplay = async () => {
        const components = opticsPreset('malus'); components[0].label = 'Saved optics input';
        window.opticsImport = JSON.stringify({ version: 1, components });
        window.remoteReplay = await computeModule({ module: 'optics-lab', components });
        window.remoteOpticsPower = totalScreenPower(window.remoteReplay.trace).toFixed(3);
      };
      window.preparePlaneReplay = async path => {
        const input = path === 'emwave3d' ? { module: path, params: { waveNumber: 0.7, amplitude: 2.2, time: 1.25 } }
          : { module: path, params: path === 'sound' ? { frequencyHz: 1000, rho: 1000, c: 1480, pPeak: 2 }
            : { frequencyHz: 5e14, refractiveIndex: 1, ePeak: 1 }, timeSeconds: 0,
            xs: Array.from({ length: 200 }, (_, i) => (path === 'sound' ? 2 : 1) * i / 199) };
        window.remoteReplay = await computeModule(input);
      };
      window.prepareAntennaReplay = async path => {
        const params = path === 'phasedarray' ? { n: 12, dOverLambda: 1, steerDeg: 80 }
          : path === 'antenna3d' ? { frequencyHz: 2.4e9, ptDbm: 20, distM: 8, elevationDeg: 90, polarizationDeg: 90 }
          : { type: 'directional', frequencyHz: 2.4e9, ptDbm: 20, distM: 100, gtDbi: 6, grDbi: 6 };
        window.remoteReplay = await computeModule({ module: path, params });
      };
      window.prepareCircuitReplay = async path => { window.remoteReplay = await computeModule(path === 'faraday' ? faradayInputs[0] : transientInputs[0]); };
      window.prepareArrayReplay = async () => { window.remoteReplay = await computeModule(signalArrayInputs[3]); window.arrayImport = JSON.stringify(signalArrayInputs[3].scene); };
      window.prepareDetectionReplay = async path => {
        const input = path === 'laser' ? { module: path, pump: 1200, steps: 4 }
          : path === 'radar' ? { module: path, scene: { mode: 'pulse', steps: 5, probes: [{ x: 36, y: 100 }, { x: 110, y: 100 }, null, null] } }
          : { module: path, kind: 'corrosion' };
        window.remoteReplay = await computeModule(input);
      };
      window.mountModule('electromagnetic');
    `,
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
});
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: outputFiles[0].text });
  await page.waitForFunction(() => window.framesRun > 1);
  assert.ok(await page.evaluate(() => window.opticsPower > 0));
  const module = page.locator('[data-simulation-module="electromagnetic"]');
  await module.getByRole('button', { name: /暂停计算|Pause computation|暂停播放|Pause playback/ }).click();
  const paused = await page.evaluate(() => window.framesRun);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.framesRun), paused);
  await page.locator('#local-toggle').click();
  await page.waitForFunction((before) => window.framesRun > before, paused);
  await module.getByRole('button', { name: /重置模块|Reset module/ }).click();
  await page.waitForFunction(() => window.disposals === 1);
  await page.evaluate(() => { window.failFrame = true; });
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /test solver failure/);
  await page.waitForFunction(() => window.disposals === 2);
  await module.getByRole('button', { name: /重置模块|Reset module/ }).click();
  await page.locator('#local-toggle').waitFor();
  await page.evaluate(() => window.mountModule('optics-lab', true));
  const optics = page.locator('[data-simulation-module="optics-lab"]');
  await optics.locator('svg').first().waitFor();
  assert.equal(await optics.getByRole('button', { name: /暂停计算|Pause computation|暂停播放|Pause playback/ }).count(), 0);
  await optics.getByRole('button', { name: /重置模块|Reset module/, exact: true }).click();
  await optics.locator('svg').first().waitFor();
  await optics.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await optics.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
  await page.waitForFunction(() => document.querySelector('[data-optics-readout]')?.textContent.includes(window.opticsPower.toFixed(3)));
  const partCount = await page.evaluate(() => window.submitted.at(-1).model.inline.components.length);
  await optics.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await optics.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await optics.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => window.submitted.length === 2);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.components.length), partCount);
  for (const path of ['electromagnetic', 'sound']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const wave = page.locator('[data-simulation-module="' + path + '"]');
    await wave.locator('canvas').waitFor();
    const select = wave.locator('select').last();
    await select.selectOption(path === 'sound' ? 'water' : 'visible');
    await wave.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await wave.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await select.inputValue(), path === 'sound' ? 'water' : 'visible');
    assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.module), path);
    assert.match(await wave.innerText(), path === 'sound' ? /1\.480e\+0/ : /5\.996e-7/);
  }
  const sound = page.locator('[data-simulation-module="sound"]');
  // Changing parameters cancels the old run and immediately hides its result.
  await page.evaluate(() => { window.holdJob = true; });
  await sound.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/计算中|Running/));
  await sound.locator('select').last().selectOption('air');
  await page.waitForFunction(() => window.canceled.length > 0);
  assert.match(await sound.innerText(), /λ = —/);
  // A failed cancellation keeps a retry control and prevents another submission.
  await page.evaluate(() => { window.rejectCancel = true; });
  await sound.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/计算中|Running/));
  await sound.getByRole('button', { name: /停止任务|Stop job/ }).click();
  await sound.getByRole('alert').waitFor();
  assert.equal(await sound.locator('[data-compute-action="run"]').isDisabled(), true);
  await page.evaluate(() => { window.rejectCancel = false; });
  await sound.getByRole('button', { name: /停止任务|Stop job/ }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  await sound.getByRole('button', { name: /本机计算|Local compute/ }).click();
  assert.equal(await sound.locator('select').last().inputValue(), 'air');
  assert.equal(await page.getByRole('alert').count(), 0);
  // Actual FDTD page: no WebGPU globals required, same final pixels in both locations.
  await page.evaluate(() => {
    window.holdJob = false; window.fdtdAdapterRequests = 0;
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => { window.fdtdAdapterRequests++; return null; } } });
    window.mountModule('fdtd', true);
  });
  const fdtd = page.locator('[data-simulation-module="fdtd"]');
  await fdtd.getByRole('spinbutton', { name: /FDTD/ }).fill('2');
  await fdtd.locator('select').first().selectOption('cavity');
  await fdtd.locator('[data-fdtd-step="2"]').waitFor();
  assert.equal(await fdtd.locator('select').nth(1).inputValue(), 'point');
  const localImage = await fdtd.locator('canvas').evaluate(canvas => canvas.toDataURL());
  const adapterRequests = await page.evaluate(() => window.fdtdAdapterRequests);
  await fdtd.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await fdtd.locator('[data-fdtd-step="0"]').waitFor();
  assert.notEqual(await fdtd.locator('canvas').evaluate(canvas => canvas.toDataURL()), localImage);
  await fdtd.locator('[data-compute-action="run"]').click();
  await fdtd.locator('[data-fdtd-step="2"]').waitFor();
  assert.equal(await fdtd.locator('canvas').evaluate(canvas => canvas.toDataURL()), localImage);
  assert.equal(await page.evaluate(() => window.fdtdAdapterRequests), adapterRequests);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).run.maxSteps), 2);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'mixed');
  // Adding a source is a scene edit, invalidating the completed backend field.
  await fdtd.locator('canvas').click({ position: { x: 300, y: 300 } });
  await fdtd.locator('[data-fdtd-step="0"]').waitFor();
  await fdtd.locator('[data-compute-action="run"]').click();
  await fdtd.locator('[data-fdtd-step="2"]').waitFor();
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.sources.length), 2);
  await fdtd.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await fdtd.locator('[data-fdtd-step="2"]').waitFor();
  assert.equal(await fdtd.getByRole('spinbutton', { name: /FDTD/ }).inputValue(), '2');
  await page.evaluate(() => window.mountModule('display', true));
  const display = page.locator('[data-simulation-module="display"]');
  for (const mode of ['LED', 'OLED', 'LCD']) {
    await display.getByRole('button', { name: mode, exact: true }).click();
    if (mode === 'LED') await display.getByRole('slider', { name: 'Display bandgap', exact: true }).fill('1.6');
    if (mode === 'OLED') await display.getByRole('slider', { name: 'Display channel 1', exact: true }).fill('0');
    if (mode === 'LCD') await display.getByRole('slider', { name: 'Display rotation', exact: true }).fill('45');
    const local = await display.locator('[data-display-readout]').innerText();
    const pixels = await display.locator('canvas').evaluate(c => c.toDataURL());
    assert.equal(await display.getByRole('button', { name: /暂停计算|Pause computation/ }).count(), 0);
    await display.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.match(await display.locator('[data-display-readout]').innerText(), /—/);
    await display.locator('[data-compute-action="run"]').click();
    await display.locator('[data-display-mode="' + mode + '"]').waitFor();
    assert.equal(await display.locator('[data-display-readout]').innerText(), local);
    assert.equal(await display.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'float64');
    await display.getByRole('button', { name: /本机计算|Local compute/ }).click();
  }
  await display.getByRole('button', { name: 'LED', exact: true }).click();
  assert.equal(await display.getByRole('slider', { name: 'Display bandgap', exact: true }).inputValue(), '1.6');

  await page.evaluate(() => window.mountModule('particles', true));
  const particles = page.locator('[data-simulation-module="particles"]');
  await particles.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  const userModel = {
    species: [{ name: 'User alpha', count: 2, charge: 0.3, sigma: 0.6, epsilon: 0 }, { name: 'User beta', count: 1, charge: -0.6, sigma: 1.1, epsilon: 0 }],
    // 2D 导入体系：positions 为 N·2 个分量，须显式声明 dim（缺省为作业路径 3D）。
    positions: [1, 1, 3, 3, 6, 6], dim: 2, boxL: 10, temperature: 0.4, thermostat: false,
    epsR: 12, lambdaD: 3, kCoulomb: 0, seed: 11, steps: 5,
  };
  await particles.getByRole('textbox', { name: 'Particle model JSON' }).fill(JSON.stringify(userModel));
  await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
  assert.match(await particles.locator('[data-particles-readout]').innerText(), /—/);
  await particles.locator('[data-compute-action="run"]').click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.module), 'particles');
  assert.deepEqual(await page.evaluate(() => window.submitted.at(-1).model.inline.scene), userModel);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'mixed');
  const particleReadout = await particles.locator('[data-particles-readout]').innerText();
  const particlePixels = await particles.locator('canvas').evaluate(c => c.toDataURL());
  const particleRdf = await particles.locator('polyline').getAttribute('points');
  await particles.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await particles.locator('[data-particles-readout]').innerText(), particleReadout);
  assert.equal(await particles.locator('canvas').evaluate(c => c.toDataURL()), particlePixels);
  assert.equal(await particles.locator('polyline').getAttribute('points'), particleRdf);
  await particles.getByRole('slider', { name: /播放速度|Playback speed/ }).fill('4');
  await particles.getByRole('button', { name: /继续计算|Resume computation/ }).click();
  await particles.getByRole('button', { name: /继续计算|Resume computation/ }).waitFor();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await particles.locator('canvas').evaluate(c => c.toDataURL()), particlePixels);
  await particles.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await particles.getByRole('slider', { name: 'Particle temperature', exact: true }).fill('0.6');
  assert.equal(await particles.locator('[data-particles-step]').getAttribute('data-particles-step'), '');
  await particles.getByRole('textbox', { name: 'Particle model JSON' }).fill('{broken');
  await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
  await particles.getByRole('alert').waitFor();
  await particles.locator('[data-compute-action="run"]').click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.temperature), 0.6);

  // Initial WebGPU readback failure must dispose and restart the same user input on CPU.
  await page.evaluate(() => {
    window.particleDevicesDestroyed = 0; window.particleAdapters = 0;
    window.previousGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    window.previousUsage = globalThis.GPUBufferUsage; window.previousMapMode = globalThis.GPUMapMode;
    globalThis.GPUBufferUsage = { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, UNIFORM: 8, MAP_READ: 16 };
    globalThis.GPUMapMode = { READ: 1 };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => {
      window.particleAdapters++;
      return { requestDevice: async () => ({
        createBuffer: () => ({ destroy() {}, mapAsync: async () => { throw new Error('first readback failed'); } }),
        queue: { writeBuffer() {}, submit() {} },
        createShaderModule: () => ({}), createComputePipelineAsync: async () => ({ getBindGroupLayout() {} }),
        createBindGroup: () => ({}),
        createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), copyBufferToBuffer() {}, finish() {} }),
        destroy() { window.particleDevicesDestroyed++; },
      }) };
    } } });
  });
  // Editing/solving backend input never initializes a browser GPU device.
  await particles.getByRole('textbox', { name: 'Particle model JSON' }).fill(JSON.stringify(userModel));
  await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
  await particles.locator('[data-compute-action="run"]').click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await page.evaluate(() => window.particleAdapters), 0);
  await particles.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await page.evaluate(() => window.particleDevicesDestroyed), 1);
  assert.equal(await particles.locator('canvas').evaluate(c => c.toDataURL()), particlePixels);
  assert.equal(await particles.getByRole('alert').count(), 0);
  await page.evaluate(() => {
    if (window.previousGpu) Object.defineProperty(navigator, 'gpu', window.previousGpu); else delete navigator.gpu;
    if (window.previousUsage) globalThis.GPUBufferUsage = window.previousUsage; else delete globalThis.GPUBufferUsage;
    if (window.previousMapMode) globalThis.GPUMapMode = window.previousMapMode; else delete globalThis.GPUMapMode;
  });

  await particles.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await page.evaluate(() => { window.failLammps = true; });
  await particles.getByRole('button', { name: /载入 LAMMPS 示例|Load LAMMPS example/ }).click();
  await particles.getByRole('alert').waitFor();
  assert.match(await particles.getByRole('alert').innerText(), /503/);
  await page.evaluate(() => { window.failLammps = false; });
  await particles.getByRole('button', { name: /载入 LAMMPS 示例|Load LAMMPS example/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Particle input format"]').value === 'lammps');
  await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Particle input format"]').value === 'json');
  const imported = JSON.parse(await particles.getByRole('textbox', { name: 'Particle model JSON', exact: true }).inputValue());
  assert.equal(imported.species[0].count, 32); assert.equal(imported.velocities.length, 64);
  assert.equal(await particles.getByRole('slider', { name: 'Particle temperature', exact: true }).count(), 0);
  const modelPreview = await particles.locator('canvas').evaluate(c => c.toDataURL());
  assert.equal(await particles.locator('[data-particles-step]').getAttribute('data-particles-step'), '');
  await particles.locator('[data-compute-action="run"]').click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  const lammpsPixels = await particles.locator('canvas').evaluate(c => c.toDataURL());
  const lammpsReadout = await particles.locator('[data-particles-readout]').innerText();
  assert.notEqual(lammpsPixels, modelPreview);
  assert.deepEqual(await page.evaluate(() => window.submitted.at(-1).model.inline.scene), imported);
  await particles.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await particles.locator('[data-particles-step="5"]').waitFor();
  assert.equal(await particles.locator('canvas').evaluate(c => c.toDataURL()), lammpsPixels);
  assert.equal(await particles.locator('[data-particles-readout]').innerText(), lammpsReadout);
  await particles.getByLabel('Particle model file', { exact: true }).setInputFiles({ name: 'unsupported.data', mimeType: 'text/plain', buffer: Buffer.from(lammpsData.replace('units = lj', 'units = real')) });
  await page.waitForFunction(() => document.querySelector('[aria-label="Particle input format"]').value === 'lammps');
  await particles.getByRole('button', { name: /应用模型|Apply model/ }).click();
  await particles.getByRole('alert').waitFor();
  assert.match(await particles.getByRole('alert').innerText(), /units lj/);
  assert.equal(await particles.locator('[data-particles-readout]').innerText(), lammpsReadout);

  await page.evaluate(() => window.mountModule('fluid', true));
  const fluid = page.locator('[data-simulation-module="fluid"]');
  assert.equal(await fluid.locator('iframe').count(), 0);
  await fluid.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await fluid.getByRole('spinbutton', { name: 'Fluid steps', exact: true }).fill('3');
  await fluid.getByRole('slider', { name: 'Fluid viscosity', exact: true }).fill('0.00005');
  await fluid.getByRole('slider', { name: 'Fluid diffusion', exact: true }).fill('0.00001');
  await fluid.locator('canvas').click({ position: { x: 5, y: 5 } });
  assert.match(await fluid.locator('[data-fluid-readout]').innerText(), /—/);
  await fluid.locator('[data-compute-action="run"]').click();
  await fluid.locator('[data-fluid-step="3"]').waitFor();
  const fluidPixels = await fluid.locator('canvas').evaluate(c => c.toDataURL());
  const fluidReadout = await fluid.locator('[data-fluid-readout]').innerText();
  const fluidJobs = await page.evaluate(() => window.submitted.length);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.seeds.length), 2);
  await fluid.getByRole('combobox', { name: 'Fluid view', exact: true }).selectOption('speed');
  assert.notEqual(await fluid.locator('canvas').evaluate(c => c.toDataURL()), fluidPixels);
  assert.equal(await page.evaluate(() => window.submitted.length), fluidJobs);
  await fluid.getByRole('combobox', { name: 'Fluid view', exact: true }).selectOption('density');
  await fluid.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await fluid.locator('[data-fluid-step="3"]').waitFor();
  assert.equal(await fluid.locator('[data-fluid-readout]').innerText(), fluidReadout);
  assert.equal(await fluid.locator('canvas').evaluate(c => c.toDataURL()), fluidPixels);
  await fluid.getByRole('slider', { name: /播放速度|Playback speed/ }).fill('4');
  await fluid.getByRole('button', { name: /继续计算|Resume computation/ }).click();
  await fluid.getByRole('button', { name: /继续计算|Resume computation/ }).waitFor();
  await fluid.locator('[data-fluid-step="3"]').waitFor();
  assert.equal(await fluid.locator('[data-fluid-readout]').innerText(), fluidReadout);
  assert.equal(await fluid.locator('canvas').evaluate(c => c.toDataURL()), fluidPixels);
  await fluid.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await fluid.getByRole('slider', { name: 'Fluid decay', exact: true }).fill('0.99');
  assert.equal(await fluid.locator('[data-fluid-step]').getAttribute('data-fluid-step'), '');

  // A named example is editable input to the same fluid solver and backend transport.
  await fluid.getByRole('button', { name: /载入圆柱绕流示例|Load cylinder flow example/ }).click();
  await fluid.getByRole('slider', { name: 'Fluid inlet speed', exact: true }).fill('0.4');
  await fluid.getByRole('slider', { name: 'Fluid inlet dye', exact: true }).fill('2');
  await fluid.locator('summary').filter({ hasText: /编辑模型|Edit model/ }).click();
  await fluid.getByRole('combobox', { name: 'Fluid brush', exact: true }).selectOption('solid');
  await fluid.locator('canvas').click({ position: { x: 260, y: 250 } });
  const painted = await fluid.locator('canvas').evaluate(c => c.toDataURL());
  await fluid.getByRole('combobox', { name: 'Fluid brush', exact: true }).selectOption('erase');
  await fluid.locator('canvas').click({ position: { x: 260, y: 250 } });
  assert.notEqual(await fluid.locator('canvas').evaluate(c => c.toDataURL()), painted);
  await fluid.getByRole('combobox', { name: 'Fluid brush', exact: true }).selectOption('solid');
  await fluid.locator('canvas').click({ position: { x: 260, y: 250 } });
  await fluid.locator('[data-compute-action="run"]').click();
  await fluid.locator('[data-fluid-step="3"]').waitFor();
  const channelScene = await page.evaluate(() => window.submitted.at(-1).model.inline.scene);
  assert.equal(channelScene.inlet.speed, 0.4); assert.equal(channelScene.inlet.density, 2);
  assert.equal(channelScene.obstacle[5030], 1); assert.equal(channelScene.obstacle[5052], 1);
  const channelPixels = await fluid.locator('canvas').evaluate(c => c.toDataURL());
  const channelReadout = await fluid.locator('[data-fluid-readout]').innerText();
  await fluid.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await fluid.locator('[data-fluid-step="3"]').waitFor();
  assert.equal(await fluid.locator('canvas').evaluate(c => c.toDataURL()), channelPixels);
  assert.equal(await fluid.locator('[data-fluid-readout]').innerText(), channelReadout);
  await fluid.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await fluid.getByRole('button', { name: /清空初态|Clear initial state/ }).click();
  await fluid.getByRole('combobox', { name: 'Fluid boundary', exact: true }).selectOption('closed');
  assert.equal(await fluid.locator('[data-fluid-step]').getAttribute('data-fluid-step'), '');

  for (const path of ['ripple', 'convection']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const flow = page.locator('[data-simulation-module="' + path + '"]');
    const name = path === 'ripple' ? 'Ripple' : 'Convection', total = path === 'ripple' ? 3 : 2;
    const readout = flow.locator('[data-' + path + '-readout]'), done = flow.locator('[data-' + path + '-step="' + total + '"]');
    await flow.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await flow.getByRole('spinbutton', { name: name + ' steps', exact: true }).fill(String(total));
    await flow.getByRole('combobox', { name: name + (path === 'ripple' ? ' pulse' : ' drop'), exact: true }).selectOption(path === 'ripple' ? 'trough' : 'cold');
    await flow.locator('canvas').click({ position: { x: 5, y: 5 } });
    assert.match(await readout.innerText(), /—/);
    await flow.locator('[data-compute-action="run"]').click();
    await done.waitFor();
    assert.equal(await page.evaluate(() => window.submitted.at(-1).run.maxSteps), total);
    assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'mixed');
    const baseline = await readout.innerText();
    const pixels = await flow.locator('canvas').evaluate(c => c.toDataURL());
    if (path === 'convection') {
      const jobs = await page.evaluate(() => window.submitted.length);
      await flow.getByRole('combobox', { name: 'Convection view', exact: true }).selectOption('speed');
      assert.notEqual(await flow.locator('canvas').evaluate(c => c.toDataURL()), pixels);
      assert.equal(await readout.innerText(), baseline);
      await flow.getByRole('combobox', { name: 'Convection view', exact: true }).selectOption('temperature');
      assert.equal(await flow.locator('canvas').evaluate(c => c.toDataURL()), pixels);
      assert.equal(await page.evaluate(() => window.submitted.length), jobs);
    }
    await flow.getByRole('button', { name: /本机计算|Local compute/ }).click();
    await done.waitFor();
    assert.equal(await readout.innerText(), baseline);
    assert.equal(await flow.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    await flow.getByRole('slider', { name: /播放速度|Playback speed/ }).fill('4');
    await flow.getByRole('button', { name: /继续计算|Resume computation/ }).click();
    await flow.getByRole('button', { name: /继续计算|Resume computation/ }).waitFor();
    await done.waitFor();
    assert.equal(await readout.innerText(), baseline);
    assert.equal(await flow.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    await flow.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.match(await readout.innerText(), /—/);
    await flow.locator('[data-compute-action="run"]').click();
    await done.waitFor();
    await flow.getByRole('slider', { name: name + (path === 'ripple' ? ' damping' : ' buoyancy'), exact: true }).fill(path === 'ripple' ? '0.99' : '0.1');
    assert.equal(await readout.getAttribute('data-' + path + '-step'), '');
  }

  await page.evaluate(() => window.mountModule('ising', true));
  const ising = page.locator('[data-simulation-module="ising"]');
  await ising.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await ising.getByRole('combobox', { name: 'Ising size', exact: true }).selectOption('16');
  await ising.getByRole('combobox', { name: 'Ising initial state', exact: true }).selectOption('hot');
  await ising.getByRole('spinbutton', { name: 'Ising seed', exact: true }).fill('7');
  await ising.getByRole('spinbutton', { name: 'Ising burn-in', exact: true }).fill('1');
  await ising.getByRole('spinbutton', { name: 'Ising samples', exact: true }).fill('2');
  for (const sweep of [false, true]) {
    if (sweep) {
      await ising.getByRole('checkbox', { name: 'Ising temperature sweep', exact: true }).check();
      await ising.getByRole('spinbutton', { name: 'Ising temperature count', exact: true }).fill('2');
    }
    assert.equal(await ising.locator('[data-ising-step]').getAttribute('data-ising-step'), '');
    assert.match(await ising.locator('[data-ising-readout]').innerText(), /—/);
    await ising.locator('[data-compute-action="run"]').click();
    const total = sweep ? 6 : 3;
    await ising.locator('[data-ising-step="' + total + '"]').waitFor();
    const readout = await ising.locator('[data-ising-readout]').innerText();
    const pixels = await ising.locator('canvas').evaluate(c => c.toDataURL());
    const points = await ising.locator('circle').evaluateAll(cs => cs.map(c => [c.getAttribute('cx'), c.getAttribute('cy')]));
    assert.equal(points.length, sweep ? 3 : 2);
    assert.equal(await page.evaluate(() => window.submitted.at(-1).run.maxSteps), total);
    assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'float64');
    await ising.getByRole('button', { name: /本机计算|Local compute/ }).click();
    await ising.locator('[data-ising-step="' + total + '"]').waitFor();
    assert.equal(await ising.locator('[data-ising-readout]').innerText(), readout);
    assert.equal(await ising.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    assert.deepEqual(await ising.locator('circle').evaluateAll(cs => cs.map(c => [c.getAttribute('cx'), c.getAttribute('cy')])), points);
    await ising.getByRole('slider', { name: /播放速度|Playback speed/ }).fill('4');
    await ising.getByRole('button', { name: /继续计算|Resume computation/ }).click();
    await ising.getByRole('button', { name: /继续计算|Resume computation/ }).waitFor();
    await ising.locator('[data-ising-step="' + total + '"]').waitFor();
    assert.equal(await ising.locator('[data-ising-readout]').innerText(), readout);
    assert.equal(await ising.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    await ising.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  }

  await page.evaluate(() => window.mountModule('vibration', true));
  const vibration = page.locator('[data-simulation-module="vibration"]');
  await vibration.getByRole('spinbutton', { name: 'Vibration steps', exact: true }).fill('5');
  await vibration.getByRole('slider', { name: 'Vibration cursor', exact: true }).fill('5');
  await vibration.locator('[data-vibration-step="5"][data-vibration-cursor="5"]').waitFor();
  const vibrationReadout = await vibration.locator('[data-vibration-readout]').innerText();
  const vibrationPixels = await vibration.locator('canvas').evaluate(c => c.toDataURL());
  await vibration.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  assert.equal(await vibration.locator('[data-vibration-step]').getAttribute('data-vibration-step'), '');
  assert.match(await vibration.locator('[data-vibration-readout]').innerText(), /—/);
  await vibration.locator('[data-compute-action="run"]').click();
  await vibration.locator('[data-vibration-step="5"]').waitFor();
  assert.equal(await vibration.locator('[data-vibration-readout]').innerText(), vibrationReadout);
  assert.equal(await vibration.locator('canvas').evaluate(c => c.toDataURL()), vibrationPixels);
  const vibrationJobs = await page.evaluate(() => window.submitted.length);
  await vibration.getByRole('slider', { name: 'Vibration cursor', exact: true }).fill('1');
  assert.notEqual(await vibration.locator('[data-vibration-readout]').innerText(), vibrationReadout);
  await vibration.getByRole('slider', { name: /播放速度|Playback speed/ }).fill('4');
  await vibration.getByRole('button', { name: /播放结果|Replay result/ }).click();
  await vibration.locator('[data-vibration-cursor="5"]').waitFor();
  assert.equal(await vibration.locator('canvas').evaluate(c => c.toDataURL()), vibrationPixels);
  assert.equal(await page.evaluate(() => window.submitted.length), vibrationJobs);
  await vibration.getByRole('slider', { name: 'Vibration mass', exact: true }).fill('2');
  assert.equal(await vibration.locator('[data-vibration-step]').getAttribute('data-vibration-step'), '');
  await vibration.locator('[data-compute-action="run"]').click();
  await vibration.locator('[data-vibration-step="5"]').waitFor();
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.mass), 2);

  await page.evaluate(() => window.mountModule('md', true));
  const md = page.locator('[data-simulation-module="md"]');
  await md.getByRole('button', { name: /暂停计算|Pause computation/ }).click();
  const pausedMd = await md.locator('canvas').evaluate(c => c.toDataURL());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await md.locator('canvas').evaluate(c => c.toDataURL()), pausedMd);
  await md.getByRole('spinbutton', { name: 'MD steps', exact: true }).fill('5');
  await md.getByRole('combobox', { name: 'MD particles', exact: true }).selectOption('64');
  await md.locator('[data-md-step="5"]').waitFor();
  assert.equal(await md.getByRole('button', { name: /继续计算|Resume computation/ }).count(), 1);
  const mdBaseline = await md.locator('[data-md-readout]').innerText();
  const mdPixels = await md.locator('canvas').evaluate(c => c.toDataURL());
  const mdCurves = await md.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points')));
  // Different presentation cadence must not change thermostat batching or sample timestamps.
  await md.getByRole('slider', { name: /播放速度|Playback speed/ }).fill('4');
  await md.getByRole('button', { name: /继续计算|Resume computation/ }).click();
  await md.getByRole('button', { name: /继续计算|Resume computation/ }).waitFor();
  await md.locator('[data-md-step="5"]').waitFor();
  assert.equal(await md.locator('[data-md-readout]').innerText(), mdBaseline);
  assert.equal(await md.locator('canvas').evaluate(c => c.toDataURL()), mdPixels);
  for (const barostat of [false, true]) {
    if (barostat) {
      await md.getByRole('checkbox', { name: 'MD barostat', exact: true }).check();
      await md.locator('[data-md-step="5"]').waitFor();
    }
    const local = await md.locator('[data-md-readout]').innerText();
    const pixels = await md.locator('canvas').evaluate(c => c.toDataURL());
    const curves = await md.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points')));
    if (!barostat) assert.deepEqual(curves, mdCurves);
    await md.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.equal(await md.locator('[data-md-step]').getAttribute('data-md-step'), '');
    assert.match(await md.locator('[data-md-readout]').innerText(), /—/);
    await md.locator('[data-compute-action="run"]').click();
    await md.locator('[data-md-step="5"]').waitFor();
    // 作业路径是 3D（L=cbrt(N/0.4)），交互视图刻意保持 2D——两者物理量不同属设计。
    // 后端渲染对照页内 3D 参考（computeModule 的同一条 WASM 路径）。
    const remoteObs = await page.evaluate(async barostatFlag => {
      const r = await window.computeModule({ module: 'md', scene: { N: 64, temperature: 0.4, thermostat: true, barostat: barostatFlag, targetP: 0.5, tauP: 0.5, steps: 5, seed: 1 } });
      return r.result.observables;
    }, barostat);
    const remoteReadout = await md.locator('[data-md-readout]').innerText();
    for (const [key, digits] of [['T', 3], ['P', 3], ['L', 3], ['ρ', 3]]) {
      assert.match(remoteReadout, new RegExp(`${key}\\*${remoteObs[{ T: 'temperature', P: 'pressure', L: 'boxL', 'ρ': 'density' }[key]].toFixed(digits)}`));
    }
    assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'mixed');
    assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.barostat), barostat);
    assert.deepEqual(await page.evaluate(() => window.submitted.at(-1).model.inline.scene), { N: 64, temperature: 0.4, thermostat: true, barostat, targetP: 0.5, tauP: 0.5, steps: 5, seed: 1 });
    if (!barostat) {
      const count = await page.evaluate(() => window.submitted.length);
      await md.getByRole('combobox', { name: 'MD color', exact: true }).selectOption('tracer');
      await md.getByRole('checkbox', { name: 'MD scaled units', exact: true }).check();
      await md.locator('[data-md-scaled]').waitFor();
      assert.equal(await page.evaluate(() => window.submitted.length), count);
      assert.equal(await md.locator('[data-md-step]').getAttribute('data-md-step'), '5');
      assert.notEqual(await md.locator('canvas').evaluate(c => c.toDataURL()), pixels);
      await md.getByRole('combobox', { name: 'MD color', exact: true }).selectOption('speed');
      await md.getByRole('checkbox', { name: 'MD scaled units', exact: true }).uncheck();
    }
    await md.getByRole('button', { name: /本机计算|Local compute/ }).click();
    await md.locator('[data-md-step="5"]').waitFor();
  }
  await md.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await md.getByRole('spinbutton', { name: 'MD seed', exact: true }).fill('9');
  assert.equal(await md.locator('[data-md-step]').getAttribute('data-md-step'), '');
  await md.locator('[data-compute-action="run"]').click();
  await md.locator('[data-md-step="5"]').waitFor();
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.seed), 9);
  await md.getByRole('slider', { name: 'MD temperature', exact: true }).fill('0.6');
  assert.equal(await md.locator('[data-md-step]').getAttribute('data-md-step'), '');
  for (const path of ['sim', 'heaterfc']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    const tag = path === 'sim' ? 'heat' : 'heaterfc';
    const stepsLabel = path === 'sim' ? 'Heat steps' : 'Heat 1D steps';
    const paramLabel = path === 'sim' ? 'Heat diffusion ratio' : 'Heat 1D diffusivity';
    await scene.getByRole('button', { name: /暂停计算|Pause computation/ }).click();
    const pausedStep = await scene.locator('[data-' + tag + '-step]').getAttribute('data-' + tag + '-step');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await scene.locator('[data-' + tag + '-step]').getAttribute('data-' + tag + '-step'), pausedStep);
    await scene.getByRole('spinbutton', { name: stepsLabel, exact: true }).fill('5');
    if (path === 'sim') await scene.locator('canvas').click({ position: { x: 0, y: 0 } });
    await scene.locator('[data-' + tag + '-step="5"]').waitFor();
    assert.equal(await scene.getByRole('button', { name: /继续计算|Resume computation/ }).count(), 1);
    const local = await scene.locator('[data-' + tag + '-readout]').innerText();
    const pixels = await scene.locator('canvas').evaluate(c => c.toDataURL());
    const curves = await scene.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points')));
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.match(await scene.locator('[data-' + tag + '-readout]').innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await scene.locator('[data-' + tag + '-step="5"]').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await scene.locator('[data-' + tag + '-readout]').innerText(), local);
    assert.equal(await scene.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    assert.deepEqual(await scene.locator('polyline').evaluateAll(lines => lines.map(line => line.getAttribute('points'))), curves);
    assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'mixed');
    if (path === 'sim') assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.seeds.length), 4);
    await scene.getByRole('slider', { name: paramLabel, exact: true }).fill(path === 'sim' ? '0.1' : '1');
    assert.match(await scene.locator('[data-' + tag + '-readout]').innerText(), /—/);
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    await scene.locator('[data-' + tag + '-step="5"]').waitFor();
    assert.equal(await scene.getByRole('spinbutton', { name: stepsLabel, exact: true }).inputValue(), '5');
  }
  for (const path of ['emwave3d', 'antennapattern', 'antenna3d']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    await scene.locator('canvas').waitFor();
    if (path === 'emwave3d') {
      await scene.getByRole('button', { name: /暂停计算|Pause computation|暂停播放|Pause playback/ }).click();
      await scene.getByRole('spinbutton', { name: 'EM snapshot time' }).fill('1.25');
    }
    const before = path === 'emwave3d' ? '' : await scene.locator('[data-antenna-readout]').innerText();
    await scene.locator('canvas').evaluate(canvas => { window.previousCanvas = canvas; });
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    if (path !== 'emwave3d') assert.match(await scene.locator('[data-antenna-readout]').innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.module), path);
    assert.equal(await scene.locator('canvas').evaluate(canvas => canvas === window.previousCanvas), true);
    if (path === 'emwave3d') assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.params.time), 1.25);
    else assert.equal(await scene.locator('[data-antenna-readout]').innerText(), before);
    if (path === 'antenna3d') {
      // Null represents ideal zero reception and survives JSON; it is not a missing result.
      await scene.locator('input[type="range"]').last().fill('90');
      assert.match(await scene.locator('[data-antenna-readout]').innerText(), /—/);
      await scene.locator('[data-compute-action="run"]').click();
      await page.waitForFunction(() => document.querySelector('[data-antenna-readout]')?.textContent.includes('−∞'));
    }
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    assert.equal(await scene.locator('canvas').evaluate(canvas => canvas === window.previousCanvas), true);
  }
  // The actual laser page integrates four steps locally and displays the identical backend snapshot.
  await page.evaluate(() => window.mountModule('laser', true));
  const laser = page.locator('[data-simulation-module="laser"]');
  await laser.getByRole('spinbutton', { name: 'Laser steps' }).fill('4');
  await laser.locator('[data-laser-step="4"]').waitFor();
  const laserImages = await laser.locator('canvas').evaluateAll(canvases => canvases.map(c => c.toDataURL()));
  await laser.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await laser.locator('[data-laser-step="0"]').waitFor();
  await laser.locator('[data-compute-action="run"]').click();
  await laser.locator('[data-laser-step="4"]').waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await laser.locator('canvas').evaluateAll(canvases => canvases.map(c => c.toDataURL())), laserImages);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).run.maxSteps), 4);
  await laser.locator('input[type="range"]').fill('1200');
  await laser.locator('[data-laser-step="0"]').waitFor();
  await laser.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await laser.locator('[data-laser-step="4"]').waitFor();
  assert.equal(await laser.locator('input[type="range"]').inputValue(), '1200');
  for (const path of ['phasedarray', 'nljd']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    const readout = scene.locator('[data-' + path + '-readout]');
    await readout.waitFor();
    if (path === 'phasedarray') {
      await scene.locator('input[type="range"]').nth(1).fill('1');
      await scene.locator('input[type="range"]').last().fill('80');
      assert.match(await readout.innerText(), /截断|clipped/);
    } else await scene.getByRole('button', { name: /锈蚀假结|Corrosion false junction/ }).click();
    const local = await readout.innerText();
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.match(await readout.innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await readout.innerText(), local);
    if (path === 'nljd') {
      // Wave density is display-only, preserving the completed physical result.
      await scene.locator('input[type="range"]').fill('12');
      assert.equal(await readout.innerText(), local);
      assert.match(await scene.getByRole('status').innerText(), /已完成|Completed/);
      await scene.getByRole('button', { name: /纯金属|Metal \(linear\)/ }).click();
    } else await scene.locator('input[type="range"]').first().fill('4');
    assert.match(await readout.innerText(), /—/);
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
  }
  await page.evaluate(() => window.mountModule('radar', true));
  const radar = page.locator('[data-simulation-module="radar"]');
  await radar.getByRole('spinbutton', { name: 'Radar steps' }).fill('5');
  // Put a probe beside TX so the tiny fixture has a nonzero trace.
  await radar.locator('canvas').first().click({ position: { x: 24 * 2.4, y: 100 * 2.4 } });
  await radar.locator('[data-radar-step="5"]').waitFor();
  const radarPixels = await radar.locator('canvas').evaluateAll(canvases => canvases.map(c => c.toDataURL()));
  const radarReadout = await radar.locator('[data-radar-readout]').innerText();
  // Hiding then revealing channels must preserve the final field and probe locations.
  await radar.locator('select').selectOption('1');
  await radar.locator('select').selectOption('2');
  assert.equal(await radar.locator('[data-radar-step]').getAttribute('data-radar-step'), '5');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await radar.locator('canvas').evaluateAll(canvases => canvases.map(c => c.toDataURL())), radarPixels);
  await radar.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await radar.locator('[data-radar-step="0"]').waitFor();
  assert.match(await radar.locator('[data-radar-readout]').innerText(), /—/);
  await radar.locator('[data-compute-action="run"]').click();
  await radar.locator('[data-radar-step="5"]').waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await radar.locator('canvas').evaluateAll(canvases => canvases.map(c => c.toDataURL())), radarPixels);
  assert.equal(await radar.locator('[data-radar-readout]').innerText(), radarReadout);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'mixed');
  // Select channel four, then shrink to one: subsequent placement belongs to channel one.
  await radar.locator('select').selectOption('4');
  await radar.getByRole('button', { name: /^(通4|Ch4)$/ }).click();
  await radar.locator('select').selectOption('1');
  assert.equal(await radar.locator('[data-radar-step]').getAttribute('data-radar-step'), '5');
  await radar.locator('canvas').first().click({ position: { x: 479, y: 479 } });
  await radar.locator('[data-radar-step="0"]').waitFor();
  await radar.locator('[data-compute-action="run"]').click();
  await radar.locator('[data-radar-step="5"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.probes), [{ x: 199, y: 199 }, { x: 110, y: 100 }, null, null]);
  await radar.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await radar.locator('[data-radar-step="5"]').waitFor();
  assert.equal(await radar.getByRole('spinbutton', { name: 'Radar steps' }).inputValue(), '5');
  for (const path of ['localization', 'tdoa']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    const readout = scene.locator('[data-' + path + '-readout]');
    await scene.locator('canvas').click({ position: path === 'tdoa' ? { x: 1, y: 379 } : { x: 60, y: 60 } });
    const local = await readout.innerText();
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.match(await readout.innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await readout.innerText(), local);
    const input = await page.evaluate(() => window.submitted.at(-1).model.inline.scene);
    const placed = path === 'tdoa' ? input.source : input.target;
    const desired = path === 'tdoa' ? { x: 1, y: 379 } : { x: 60, y: 60 };
    // Browser pointer events round fractional viewport coordinates to CSS pixels.
    assert.ok(Math.hypot(placed.x - desired.x, placed.y - desired.y) < 1.5);
    await scene.getByRole('button', { name: /重新测量|New measurement/ }).click();
    assert.match(await readout.innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.seed), input.seed + 1);
    assert.deepEqual(await page.evaluate(() => {
      const scene = window.submitted.at(-1).model.inline.scene;
      return scene.source ?? scene.target;
    }), placed);
    const next = await readout.innerText();
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    assert.equal(await readout.innerText(), next);
    await scene.locator('canvas').click({ position: { x: 120, y: 100 } });
    assert.notEqual(await readout.innerText(), next);
  }
  for (const path of ['stm', 'afm']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    const readout = scene.locator('[data-' + path + '-readout]');
    await scene.getByRole('slider', { name: path.toUpperCase() + ' scan position' }).fill('120');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const localImage = await scene.locator('canvas').evaluate(c => c.toDataURL());
    const localReadout = await readout.innerText();
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.match(await readout.innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await readout.innerText(), localReadout);
    assert.equal(await scene.locator('canvas').evaluate(c => c.toDataURL()), localImage);
    if (path === 'stm') await scene.getByRole('button', { name: /模式：|Mode:/ }).click();
    else await scene.locator('input[type="range"]').nth(1).fill('10');
    assert.match(await readout.innerText(), /—/);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    // Reading a different point must not discard the completed full-line calculation.
    await scene.getByRole('slider', { name: path.toUpperCase() + ' scan position' }).fill(path === 'stm' ? '239' : '219');
    assert.match(await scene.getByRole('status').innerText(), /已完成|Completed/);
    const end = await readout.innerText();
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    assert.equal(await readout.innerText(), end);
  }
  for (const path of ['rlc', 'mutual', 'transient', 'faraday', 'smith']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    const readout = scene.locator('[data-' + path + '-readout]');
    await readout.waitFor();
    if (path === 'rlc' || path === 'mutual') await scene.getByRole('slider', { name: /计算步数|Compute steps/ }).fill('4');
    if (path !== 'smith') await scene.getByRole('slider', { name: path + ' cursor' }).fill(path === 'rlc' || path === 'mutual' ? '2' : '123');
    else {
      await scene.getByRole('button', { name: /^(短路|Short)$/ }).click();
      await scene.getByRole('slider', { name: /电长度|Elec. length/ }).fill('90');
      assert.match(await readout.innerText(), /∞/);
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const local = await readout.innerText();
    const pixels = await scene.locator('canvas').evaluateAll(cs => cs.map(c => c.toDataURL()));
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.equal(await readout.count(), 0);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await readout.innerText(), local);
    assert.deepEqual(await scene.locator('canvas').evaluateAll(cs => cs.map(c => c.toDataURL())), pixels);
    assert.equal(await page.evaluate(() => window.submitted.at(-1).requirements.precision), 'float64');
    if (path !== 'smith') {
      await scene.getByRole('slider', { name: path + ' cursor' }).fill('1');
      assert.match(await scene.getByRole('status').innerText(), /已完成|Completed/);
    }
    const reviewed = await readout.innerText();
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    assert.equal(await readout.innerText(), reviewed);
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    if (path === 'rlc') await scene.getByRole('slider', { name: /阻尼比|Damping ratio/ }).fill('0.2');
    else if (path === 'mutual') await scene.locator('input[type="range"]').first().fill('0.99');
    else if (path === 'transient') await scene.getByRole('button', { name: /^(电容放电|RC discharge)$/ }).click();
    else if (path === 'faraday') await scene.getByRole('slider', { name: /棒速|Rod speed/ }).fill('0');
    else await scene.getByRole('button', { name: /匹配 50|Match 50/ }).click();
    assert.equal(await readout.count(), 0);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    const changed = await readout.innerText();
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    assert.equal(await readout.innerText(), changed);
  }
  for (const path of ['ecg', 'eeg', 'emg', 'neuron', 'ultrasound', 'biopipeline']) {
    await page.evaluate(path => window.mountModule(path, true), path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    const readout = scene.locator('[data-' + path + '-readout]');
    await readout.waitFor();
    const label = { ecg: 'ECG', eeg: 'EEG', emg: 'EMG', neuron: 'Neuron', ultrasound: 'Ultrasound' }[path];
    if (['ecg', 'eeg', 'emg'].includes(path)) await scene.getByRole('spinbutton', { name: label + ' samples' }).fill('16');
    if (path === 'neuron') await scene.getByRole('spinbutton', { name: 'Neuron steps' }).fill('8');
    if (path !== 'biopipeline') await scene.getByRole('slider', { name: label + ' cursor' }).fill(path === 'neuron' ? '4' : path === 'ultrasound' ? '123' : '12');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const local = await readout.innerText(), pixels = await scene.locator('canvas').evaluate(c => c.toDataURL());
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    assert.equal(await readout.count(), 0);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await readout.innerText(), local);
    assert.equal(await scene.locator('canvas').evaluate(c => c.toDataURL()), pixels);
    if (['eeg', 'emg', 'biopipeline'].includes(path)) {
      await scene.getByRole('button', { name: /重新采样|Resample/ }).click();
    } else if (path === 'ecg') await scene.getByRole('slider', { name: /心率|Heart rate/ }).fill('90');
    else if (path === 'neuron') {
      await scene.getByRole('button', { name: /刺激一下|Stimulate/ }).click();
    } else await scene.locator('input[type="range"]').nth(1).fill('1.5');
    assert.equal(await readout.count(), 0);
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    if (path === 'neuron') assert.deepEqual(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.pulses), [4]);
    const changed = await readout.innerText();
    await scene.getByRole('button', { name: /本机计算|Local compute/ }).click();
    assert.equal(await readout.innerText(), changed);
  }
  // Real public ECG excerpt: load, change channel, replay, inspect, compute remotely, import and reject invalid files.
  await page.evaluate(() => window.mountModule('ecg', true));
  const recorded = page.locator('[data-simulation-module="ecg"]');
  await recorded.getByRole('button', { name: /加载公开心电样例|Load public ECG sample/ }).click();
  await recorded.locator('[data-recording-info]').waitFor();
  assert.match(await recorded.locator('[data-recording-info]').innerText(), /360 Hz/);
  await recorded.getByRole('combobox', { name: 'Recording channel' }).selectOption('1');
  await recorded.getByRole('button', { name: /^(继续|Resume)$/ }).click();
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="ECG cursor"]').value) > 5);
  await recorded.getByRole('button', { name: /^(暂停|Pause)$/ }).click();
  await recorded.getByRole('slider', { name: 'ECG cursor' }).fill('300');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const recordingReadout = await recorded.locator('[data-ecg-readout]').innerText();
  const recordingPixels = await recorded.locator('canvas').evaluate(c => c.toDataURL());
  assert.match(recordingReadout, /V5/);
  assert.doesNotMatch(recordingReadout, /bpm/);
  await recorded.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await recorded.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await recorded.locator('[data-ecg-readout]').innerText(), recordingReadout);
  assert.equal(await recorded.locator('canvas').evaluate(c => c.toDataURL()), recordingPixels);
  assert.equal(await page.evaluate(() => window.submitted.at(-1).model.inline.scene.recording.channels[1].values.length), 3600);
  await recorded.getByRole('button', { name: /^(继续|Resume)$/ }).click();
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="ECG cursor"]').value) > 305);
  await recorded.getByRole('button', { name: /^(暂停|Pause)$/ }).click();
  assert.match(await recorded.getByRole('status').innerText(), /已完成|Completed/);
  await recorded.getByRole('button', { name: /本机计算|Local compute/ }).click();
  await recorded.getByLabel('Import recording CSV').setInputFiles({ name: 'record.csv', mimeType: 'text/csv', buffer: Buffer.from(recordingCsv.replace('MIT-BIH 100 - first 10 seconds', 'Imported ECG')) });
  await page.waitForFunction(() => document.querySelector('[data-recording-info]')?.textContent.includes('Imported ECG'));
  await recorded.getByLabel('Import recording CSV').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('ECG\nNaN') });
  await recorded.getByRole('alert').waitFor();
  assert.match(await recorded.locator('[data-recording-info]').innerText(), /Imported ECG/);
  await recorded.getByLabel('Import recording CSV').setInputFiles({ name: 'ngspice-rc-charge.csv', mimeType: 'text/csv', buffer: Buffer.from(spiceCsv) });
  await page.waitForFunction(() => document.querySelector('[data-recording-info]')?.textContent.includes('ngspice RC charge (simulated)'));
  assert.match(await recorded.locator('[data-recording-info]').innerText(), /480 Hz.*241.*V/);
  await recorded.getByRole('slider', { name: 'ECG cursor' }).fill('240');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const spiceReadout = await recorded.locator('[data-ecg-readout]').innerText();
  const spicePixels = await recorded.locator('canvas').evaluate(c => c.toDataURL());
  assert.match(spiceReadout, /Vc/); assert.doesNotMatch(spiceReadout, /bpm/);
  await recorded.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await recorded.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await recorded.locator('[data-ecg-readout]').innerText(), spiceReadout);
  assert.equal(await recorded.locator('canvas').evaluate(c => c.toDataURL()), spicePixels);
  const spiceRecording = await page.evaluate(() => window.submitted.at(-1).model.inline.scene.recording);
  assert.equal(spiceRecording.sampleRate, 480); assert.equal(spiceRecording.unit, 'V');
  assert.equal(spiceRecording.channels[0].values.length, 241);
  await recorded.getByRole('button', { name: /返回合成波形|Synthetic waveform/ }).click();
  assert.equal(await recorded.locator('[data-recording-info]').count(), 0);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.prepareArrayReplay());
  await page.evaluate(() => { window.savedWebAssembly = WebAssembly; window.WebAssembly = undefined; window.mountModule('signal-array', true); });
  const spatial = page.locator('[data-simulation-module="signal-array"]');
  await spatial.getByRole('alert').filter({ hasText: 'WASM' }).waitFor();
  await spatial.locator('summary').first().click();
  await spatial.getByLabel('Import array model', { exact: true }).setInputFiles({ name: 'array.json', mimeType: 'application/json', buffer: Buffer.from(await page.evaluate(() => window.arrayImport)) });
  await spatial.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  await spatial.locator('[data-compute-action="run"]').click();
  await spatial.locator('[data-array-reconstruction="rank-deficient"]').waitFor();
  assert.equal(await spatial.getByRole('alert').count(), 0);
  assert.equal(await page.evaluate(() => window.WebAssembly), undefined);
  assert.match(await spatial.locator('[data-array-readout]').innerText(), /1 \/ 2/);
  assert.equal(await spatial.getByRole('img', { name: 'Sensor voltages', exact: true }).locator('rect').count(), 2);
  await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; window.remoteReplay = null; });
  assert.deepEqual(await page.evaluate(() => [...new Set(window.submitted.map(s => s.model.inline.module))].sort()), await page.evaluate(() => window.expectedComputePaths), 'Every local module in the capability catalog must exercise backend submission');
  // Missing local acceleration must leave parameters and backend submission usable.
  for (const [path, label, role = 'spinbutton'] of [['ripple', 'Ripple steps'], ['sim', 'Heat steps'], ['fdtd', /FDTD/], ['md', 'MD steps'], ['particles', 'Particle steps'], ['radar', 'Radar steps'], ['ising', 'Ising samples'], ['neuron', 'Neuron steps'], ['vibration', 'Vibration steps'], ['rlc', /计算步数|Compute steps/, 'slider'], ['mutual', /计算步数|Compute steps/, 'slider']]) {
    await page.evaluate(() => {
      window.savedWebAssembly = WebAssembly;
      window.WebAssembly = undefined;
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    });
    await page.evaluate(path => window.mountModule(path, true), path);
    const module = page.locator('[data-simulation-module="' + path + '"]');
    await module.getByRole('alert').filter({ hasText: 'WASM' }).waitFor();
    await module.getByRole(role, { name: label }).fill('2');
    await module.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await page.waitForFunction(path => document.querySelector('[data-simulation-module="' + path + '"]')?.getAttribute('data-compute-target') === 'backend', path);
    assert.equal(await module.getByRole(role, { name: label }).inputValue(), '2');
    assert.equal(await module.locator('[data-compute-action="run"]').isEnabled(), true);
    assert.equal(await module.getByRole('alert').count(), 0);
    await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; });
  }
  for (const path of ['electromagnetic', 'sound', 'emwave3d']) {
    await page.evaluate(path => window.preparePlaneReplay(path), path);
    await page.evaluate(path => { window.savedWebAssembly = WebAssembly; window.WebAssembly = undefined; window.mountModule(path, true); }, path);
    const wave = page.locator('[data-simulation-module="' + path + '"]');
    await wave.getByRole('alert').filter({ hasText: 'WASM' }).waitFor();
    await wave.locator('canvas').evaluate(c => c.sameCanvas = true);
    if (path === 'emwave3d') await wave.getByRole('spinbutton', { name: 'EM snapshot time' }).fill('1.25');
    else await wave.getByRole('combobox', { name: path === 'sound' ? /介质|Medium/ : /波段|Band/ }).selectOption(path === 'sound' ? 'water' : 'visible');
    await wave.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await wave.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await wave.getByRole('alert').count(), 0);
    assert.equal(await wave.locator('canvas').evaluate(c => c.sameCanvas), true);
    assert.equal(await page.evaluate(() => window.WebAssembly), undefined);
    const readout = await wave.locator('[data-' + path + '-readout]').innerText();
    assert.match(readout, path === 'sound' ? /1\.480e\+0/ : path === 'emwave3d' ? /t = 1\.25/ : /5\.996e-7/);
    await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; window.remoteReplay = null; });
  }
  for (const path of ['antennapattern', 'antenna3d', 'phasedarray']) {
    await page.evaluate(path => window.prepareAntennaReplay(path), path);
    await page.evaluate(path => { window.savedWebAssembly = WebAssembly; window.WebAssembly = undefined; window.mountModule(path, true); }, path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    await scene.getByRole('alert').filter({ hasText: 'WASM' }).waitFor();
    await scene.locator('canvas').evaluate(c => c.sameCanvas = true);
    if (path === 'antennapattern') await scene.getByRole('button', { name: /^(定向天线|Directional)$/ }).click();
    else if (path === 'antenna3d') await scene.getByRole('slider', { name: /极化失配|Pol. mismatch/ }).fill('90');
    else {
      await scene.getByRole('slider').nth(1).fill('1');
      await scene.getByRole('slider').nth(2).fill('80');
    }
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await scene.getByRole('alert').count(), 0);
    assert.equal(await scene.locator('canvas').evaluate(c => c.sameCanvas), true);
    assert.equal(await page.evaluate(() => window.WebAssembly), undefined);
    const text = await scene.locator(path === 'phasedarray' ? '[data-phasedarray-readout]' : '[data-antenna-readout]').innerText();
    assert.doesNotMatch(text, /—/);
    if (path === 'antenna3d') assert.match(text, /−∞/);
    if (path === 'phasedarray') assert.match(text, /截断|clipped/);
    await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; window.remoteReplay = null; });
  }
  for (const path of ['radar', 'laser', 'nljd']) {
    await page.evaluate(path => window.prepareDetectionReplay(path), path);
    await page.evaluate(path => { window.savedWebAssembly = WebAssembly; window.WebAssembly = undefined; window.mountModule(path, true); }, path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    await scene.getByRole('alert').filter({ hasText: 'WASM' }).first().waitFor();
    if (path === 'laser') {
      await scene.getByRole('slider').fill('1200');
      await scene.getByRole('spinbutton', { name: 'Laser steps' }).fill('4');
    } else if (path === 'radar') await scene.getByRole('spinbutton', { name: 'Radar steps' }).fill('5');
    else await scene.getByRole('button', { name: /锈蚀假结|Corrosion false/ }).click();
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await scene.getByRole('alert').count(), 0);
    assert.equal(await page.evaluate(() => window.WebAssembly), undefined);
    const text = await scene.locator('[data-' + path + '-readout]').innerText();
    if (path === 'radar') assert.equal(await scene.locator('[data-radar-step]').getAttribute('data-radar-step'), '5');
    else assert.doesNotMatch(text, /—/);
    if (path === 'nljd') assert.match(text, /锈蚀结模型|Corrosion model/);
    await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; window.remoteReplay = null; });
  }
  for (const path of ['transient', 'faraday']) {
    await page.evaluate(path => window.prepareCircuitReplay(path), path);
    await page.evaluate(path => { window.savedWebAssembly = WebAssembly; window.WebAssembly = undefined; window.mountModule(path, true); }, path);
    const scene = page.locator('[data-simulation-module="' + path + '"]');
    await scene.getByRole('alert').filter({ hasText: 'WASM' }).waitFor();
    await scene.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
    await scene.locator('[data-compute-action="run"]').click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.match(/已完成|Completed/));
    assert.equal(await scene.getByRole('alert').count(), 0);
    assert.equal(await page.evaluate(() => window.WebAssembly), undefined);
    assert.doesNotMatch(await scene.locator('[data-' + path + '-readout]').innerText(), /—/);
    await scene.getByRole('slider', { name: path + ' cursor' }).fill('45');
    assert.match(await scene.getByRole('status').innerText(), /已完成|Completed/);
    await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; window.remoteReplay = null; });
  }
  await page.evaluate(() => window.prepareOpticsReplay());
  await page.evaluate(() => { window.savedWebAssembly = WebAssembly; window.WebAssembly = undefined; window.mountModule('optics-lab', true); });
  const unavailableOptics = page.locator('[data-simulation-module="optics-lab"]');
  await unavailableOptics.getByRole('alert').filter({ hasText: 'WASM' }).waitFor();
  await unavailableOptics.getByRole('combobox', { name: /实验示例|Example/ }).selectOption('malus');
  assert.ok(await unavailableOptics.getByLabel('Optics scene', { exact: true }).locator('g').count() >= 4);
  await unavailableOptics.getByRole('button', { name: /后端计算$|Backend compute$/ }).click();
  assert.equal(await unavailableOptics.locator('[data-compute-action="run"]').isEnabled(), true);
  assert.equal(await unavailableOptics.getByRole('alert').count(), 0);
  await unavailableOptics.locator('input[type="file"]').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(await page.evaluate(() => window.opticsImport)) });
  await unavailableOptics.getByLabel('Optics scene', { exact: true }).locator('title').filter({ hasText: 'Saved optics input' }).waitFor({ state: 'attached' });
  await unavailableOptics.locator('[data-compute-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-optics-readout]')?.textContent.includes(window.remoteOpticsPower));
  assert.equal(await page.evaluate(() => window.WebAssembly), undefined);
  assert.equal(await unavailableOptics.getByRole('alert').count(), 0);
  await page.evaluate(() => { window.WebAssembly = window.savedWebAssembly; });
  assert.deepEqual(errors, []);
  console.log('Simulation module smoke passed: shared lifecycle, thirty-seven module compute switches, preserved 3D canvases, editable user particle models, identical fluid/display/particle/ripple/convection/Ising/vibration/MD/heat/FDTD/laser/radar/STM/AFM/circuit pixels, recorded ECG loading/import/replay, parameter preservation, cancellation and retry.');
} finally {
  await browser.close();
}
