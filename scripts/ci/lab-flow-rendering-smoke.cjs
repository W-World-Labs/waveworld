// Small real WebGPU/2D rendering checks; no solver or listening server.
// Optional --native-dir PATH displays two already-completed native frames.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');
const { chromium, expect } = requireRoot('@playwright/test');
const sharp = createRequire(path.join(root, 'apps/lab/package.json'))('sharp');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

(async () => {
  const startedAt = performance.now();
  const output = path.resolve(option('--out-dir') ?? path.join(root, '.runtime/postprocess-review/rendering-smoke'));
  await fs.mkdir(output, { recursive: true });
  const nativeDir = option('--native-dir');
  const localFiles = new Map();
  let native;
  if (nativeDir) {
    const directory = path.resolve(nativeDir);
    const jobBytes = await fs.readFile(path.join(directory, 'job.json'));
    const resultBytes = await fs.readFile(path.join(directory, 'result.json'));
    const job = JSON.parse(jobBytes), envelope = JSON.parse(resultBytes);
    const validation = JSON.parse(await fs.readFile(path.join(directory, 'validation.json')));
    assert.equal(envelope.status, 'succeeded'); assert.equal(envelope.result.summary.steps, job.spec.run.maxSteps);
    assert.equal(validation.jobSha256, hash(jobBytes)); assert.equal(validation.resultSha256, hash(resultBytes));
    const selected = [envelope.files[0], envelope.files.at(-1)];
    for (const file of selected) {
      assert.match(file.name, /^flow(?:-\d+)?\.bin$/);
      const bytes = await fs.readFile(path.join(directory, file.name));
      assert.equal(hash(bytes), validation.frames.find(frame => frame.name === file.name).sha256);
      localFiles.set(`/data/${file.name}`, bytes);
    }
    native = { spec: job.spec, result: envelope.result, selected, validation };
  }
  const built = await build({ stdin: { resolveDir: path.join(root, 'apps/lab'), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ResultsPanel} from './src/components/panels/results-panel';
    import {WindTunnelCanvas} from './src/components/visualization/wind-tunnel-canvas';
    import {VolumeRenderer} from './src/lib/cfd/volume-renderer';
    import {useSimulationStore} from './src/lib/stores/simulation-store';
    import {decodeFlowSnapshot,summarizeFlowSnapshot} from './src/lib/cfd/flow-snapshot';
    import {assertMacFlowSnapshot} from './src/lib/cfd/mac-flow-snapshot';
    window.sim=useSimulationStore; window.renderCalls=[];
    const originalRender=VolumeRenderer.prototype.render;
    VolumeRenderer.prototype.render=function(mode,quality,view){window.renderCalls.push({mode,quality,view});return originalRender.call(this,mode,quality,view)};
    window.setFixture=({method='lbm',speed=0,inlet=0,reference=.1,mode='velocity',maskTemperature=25,materialTemperature=60,uniformTemperature,pressure=5,pressureExtent=10,threshold=.08,savePressure=mode==='pressure',thermal=mode==='temperature',pressureScale=1000,solidPressure=0,frames=false})=>{
      const mac=method==='mac',n=16,cells=n*n*n,stride=mac?(thermal?5:4):2+Number(thermal)+Number(savePressure);
      const pressureOffset=mac?3:stride-1;
      const values=new Float32Array(cells*stride),flags=new Uint32Array(cells);
      for(let i=0;i<cells;i++){
        if(mac){values[i*stride]=speed*.6;values[i*stride+1]=speed*.8;}else values[i*stride]=speed;
        if(mac||savePressure)values[i*stride+pressureOffset]=mac?pressure:pressure/pressureScale;
        if(thermal)values[i*stride+(mac?4:2)]=mac?(uniformTemperature??25):((uniformTemperature??25)-25)/35;
      }
      // A fixed reference sample keeps the MAC color range constant.
      if(mac&&!thermal){values[0]=reference;values[1]=0;}
      if(mac||savePressure){values[pressureOffset]=mac?-pressureExtent:-pressureExtent/pressureScale;values[(cells-1)*stride+pressureOffset]=mac?pressureExtent:pressureExtent/pressureScale;}
      if(thermal&&uniformTemperature===undefined){
        for(let z=6;z<=9;z++)for(let y=6;y<=9;y++)for(let x=2;x<=9;x++){
          if(x===5)continue;const i=x+n*(y+n*z),mask=x>=6;
          flags[i]=mac?(mask?1:4):2;
          values[i*stride+(mac?4:2)]=mac?(mask?maskTemperature:materialTemperature):(materialTemperature-25)/35;
        }
        if(mac){flags[0]=2;values[4]=80;}
      }
      if(savePressure&&solidPressure!==0){const cell=7+n*(7+n*7);flags[cell]=1;values[cell*stride+pressureOffset]=solidPressure/(mac?1:pressureScale);}
      if(mac)for(let i=0;i<cells;i++)if(flags[i])values[i*stride+3]=0;
      const frame={nx:n,ny:n,nz:n,step:1,displayStride:stride,flags,...(mac?{fields:values}:{display:values,uLattice:reference,...(savePressure?{hasPressure:true}:{})})};
      if(mac)assertMacFlowSnapshot(frame);
      const derived={dx:.01,dt:.01,ambientC:25,temperatureScaleC:35,...(!mac&&savePressure?{pressureScalePa:pressureScale}:{}),...(mac?{'mac-3d-v1':1}:{})};
      const result={summary:{steps:1,dragN:0,liftN:0},derived};
      const spec={schemaVersion:1,kind:mac?'mac-3d':'lbm-d3q19',parameters:{inletVelocity:inlet},run:{maxSteps:1},outputs:{}};
      const s=useSimulationStore.getState();
      s.updateParameters({inletVelocity:9,displayThreshold:threshold,renderQuality:'standard'});
      s.applyJobResult(result);const earlier={...frame,step:1,...(mac?{fields:values.slice()}:{display:values.slice()})};
      if(frames){frame.step=3;result.summary.steps=3;spec.run.maxSteps=3;const prior=mac?earlier.fields:earlier.display;for(let i=0;i<cells;i++)if(!flags[i])prior[i*stride+pressureOffset]=-5/(mac?1:pressureScale);}
      s.updateResults({flowSnapshot:frame,flowFrames:frames?[earlier,frame]:[frame],job:{spec,result}});
      s.setState({visualizationMode:mode,slicePlane:'none',slicePosition:.5,showBoundary:true});
      return {fixture:'synthetic display values only; not a computed result',method,mode,speed,inlet,reference};
    };
    window.setNative=async({name,spec,result})=>{
      const frame=decodeFlowSnapshot(await(await fetch('/data/'+name)).arrayBuffer());
      const s=useSimulationStore.getState();s.applyJobResult(result);
      // This isolated canvas checks two selected frames, not a full replay sequence.
      s.updateResults({flowSnapshot:frame,flowFrames:[frame],job:{spec,result}});
      s.setState({visualizationMode:'velocity',showBoundary:false});
      return {step:frame.step,summary:summarizeFlowSnapshot(frame,result.derived)};
    };
    window.fallback=()=>{const s=useSimulationStore.getState();window.keptDevice=s.gpuContext.device;s.setGPUContext({device:null,isInitialized:false,errorMessage:'Synthetic test selects the existing 2D fallback'})};
    window.restoreGpu=()=>useSimulationStore.getState().setGPUContext({device:window.keptDevice,isInitialized:true,isSupported:true,errorMessage:null});
    window.settle=async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const d=useSimulationStore.getState().gpuContext.device;if(d)await d.queue.onSubmittedWorkDone()};
    createRoot(document.getElementById('root')).render(<><WindTunnelCanvas/><div style={{display:'none'}}><ResultsPanel/></div></>);
  ` }, bundle: true, write: false, format: 'esm', jsx: 'automatic', tsconfig: path.join(root, 'apps/lab/tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' } });
  const report = { scope: 'Display-only synthetic fixtures and optional completed native frame reads. No CFD, no service, no upload.',
    pageErrors: [], gpuErrors: [], networkViolations: [], checks: [], solverStepsExecuted: 0 };
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'] });
  const page = await browser.newPage({ viewport: { width: 660, height: 540 } });
  report.environment = { node: process.version, chromium: browser.version(), requestedBackend: 'SwiftShader / Vulkan',
    webgpuRequired: true, nativeFramesOptional: !!nativeDir };
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.gpuErrors.push(message.text()); });
  await page.addInitScript(() => { Worker.prototype.postMessage = () => { throw Error('Rendering check forbids solver Workers'); }; });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'http://127.0.0.1') {
      report.networkViolations.push({ method: request.method(), origin: url.origin, path: url.pathname }); return route.abort();
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}#root{width:640px;height:480px}.w-full{width:100%}.h-full{height:100%}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.min-h-0{min-height:0}</style><div id="root"></div><script type="module" src="/app.js"></script>' });
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: built.outputFiles[0].text });
    if (localFiles.has(url.pathname)) return route.fulfill({ contentType: 'application/octet-stream', body: localFiles.get(url.pathname) });
    report.networkViolations.push({ method: request.method(), path: url.pathname }); return route.abort();
  });
  try {
    await page.goto('http://127.0.0.1/');
    await expect.poll(() => page.evaluate(() => typeof window.setFixture)).toBe('function');
    const pixels = async label => {
      await page.evaluate(() => window.settle());
      const canvas = page.locator('canvas:visible'); await expect(canvas).toHaveCount(1);
      const png = await canvas.screenshot({ path: path.join(output, `${label}.png`) });
      const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const data = decoded.data, bg = [...data.subarray(0, 3)];
      let changed = 0, red = 0, green = 0, blue = 0, neutral = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] !== bg[0] || data[i + 1] !== bg[1] || data[i + 2] !== bg[2]) {
        changed++; red += data[i]; green += data[i + 1]; blue += data[i + 2];
        if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 30 && data[i] > 30) neutral++;
      }
      const total = red + green + blue - changed * (bg[0] + bg[1] + bg[2]);
      const tint = total > 0 ? [red - changed * bg[0], green - changed * bg[1], blue - changed * bg[2]].map(value => value / total) : null;
      return { label, sha256: hash(data), width: decoded.info.width, height: decoded.info.height, changed, red, green, blue, neutral, tint };
    };
    const fixture = async (label, args) => {
      await page.evaluate(args => window.setFixture(args), args);
      await expect.poll(() => page.evaluate(() => !!window.sim.getState().gpuContext.device), { timeout: 20000 }).toBe(true);
      const actual = await pixels(label); report.checks.push(actual); return actual;
    };
    const zero = await fixture('lbm-zero', { speed: 0 });
    assert.equal(zero.changed, 0, 'No-inlet stationary fluid must be transparent, not a red volume');
    const low = await fixture('lbm-low', { speed: .025 });
    const high = await fixture('lbm-high', { speed: .075 });
    assert.ok(low.changed > 0 && low.blue > low.red, 'Low actual speed must use the blue side of the speed scale');
    assert.ok(high.changed > 0 && high.red > high.blue, 'High actual speed must use the red side of the same scale');
    const inlet = await fixture('lbm-uniform-real-inlet', { speed: .1, inlet: .1, reference: .2 });
    assert.equal(inlet.changed, 0, 'Uniform saved inlet remains transparent even when the stability reference differs');
    assert.equal(await page.evaluate(() => window.renderCalls.at(-1).view.inletVelocityLattice), .1, 'Read the saved job inlet, not the current control value 9');
    const wake = await fixture('lbm-slow-wake', { speed: .05, inlet: .1, reference: .2 });
    assert.ok(wake.changed > 0 && wake.blue > wake.red, 'A visible slow wake must retain its actual low-speed color');
    const macLow = await fixture('mac-low', { method: 'mac', speed: .025 });
    assert.ok(macLow.changed > 0 && macLow.blue > macLow.red, 'MAC and LBM agree on the low-speed color');
    for (const [label, args] of [['temperature', { mode: 'temperature', uniformTemperature: 42.5 }], ['pressure', { method: 'mac', mode: 'pressure' }]]) {
      const a = await fixture(`${label}-threshold08`, { ...args, threshold: .08 });
      const b = await fixture(`${label}-threshold30`, { ...args, threshold: .3 });
      assert.ok(label==='temperature' ? a.green>a.red&&a.green>a.blue&&b.green>b.red&&b.green>b.blue : a.red>a.blue&&b.red>b.blue,
        `${label}: the same physical scalar must keep its color under both opacity thresholds`);
      assert.ok(a.tint.every((value, i) => Math.abs(value - b.tint[i]) < .02), `${label}: changing opacity must preserve the physical color hue`);
    }
    const pressureNegative = await fixture('lbm-pressure-negative', { mode:'pressure', pressure:-5, frames:true });
    const pressurePositive = await fixture('lbm-pressure-positive', { mode:'pressure', pressure:5, frames:true });
    assert.ok(pressureNegative.changed>0 && pressureNegative.blue>pressureNegative.red, 'Negative real saved pressure remains visible on the blue side');
    assert.ok(pressurePositive.changed>0 && pressurePositive.red>pressurePositive.blue, 'Positive pressure uses the red side of the same signed Pa scale');
    for (const pressureScale of [1e40, 1e80, 1e-40, 1e-300]) {
      const extreme = await fixture('lbm-pressure-scale-'+pressureScale, {mode:'pressure',pressureScale,pressure:pressureScale*.005,pressureExtent:pressureScale*.01});
      assert.equal(extreme.sha256,pressurePositive.sha256,'The same lattice pressure keeps its GPU colors when the saved Pa scale exceeds FP32 range');
    }
    const zeroPressure = await fixture('lbm-pressure-zero-large-scale',{mode:'pressure',pressureScale:1e300,pressure:0,pressureExtent:0});
    assert.equal(zeroPressure.changed,0,'Zero pressure stays transparent without an infinite normalization coefficient');
    await fixture('lbm-pressure-positive-restored', {mode:'pressure',pressure:5,frames:true});
    await expect(page.getByLabel('表压色标')).toContainText('-10.0–10.0 Pa');
    const fixedLegend=await page.getByLabel('表压色标').textContent();
    const savedRange=await page.getByLabel('流体表压范围',{exact:true}).textContent();
    assert.equal(await page.evaluate(()=>window.sim.getState().derived.pressureScalePa),1000);
    await page.evaluate(()=>window.sim.getState().setState({playbackIndex:0}));
    const firstPressure=await pixels('lbm-pressure-first-frame');
    assert.notEqual(firstPressure.sha256,pressurePositive.sha256, 'Scrubbing changes pressure pixels');
    assert.equal(await page.getByLabel('表压色标').textContent(),fixedLegend, 'Pressure color bounds remain fixed across frames');
    assert.equal(await page.getByLabel('流体表压范围',{exact:true}).textContent(),savedRange, 'Final statistics do not follow the playback frame');
    await page.evaluate(()=>{const s=window.sim.getState();window.sim.setState({derived:{...s.derived,pressureScalePa:7},parameters:{...s.parameters,fluidDensity:9000}})});
    assert.equal((await pixels('lbm-pressure-saved-units')).sha256,firstPressure.sha256,'Current controls and copied display units cannot overwrite the saved pressure conversion');
    assert.equal(await page.getByLabel('流体表压范围',{exact:true}).textContent(),savedRange);
    const thermalPressure = await fixture('lbm-thermal-pressure', {mode:'pressure', thermal:true, uniformTemperature:42.5, pressure:5});
    await expect(page.getByText('流体温度范围',{exact:true})).toHaveCount(1);
    const coldPressure = await fixture('lbm-cold-pressure', {mode:'pressure', pressure:5});
    await expect(page.getByText('流体温度范围',{exact:true})).toHaveCount(0);
    assert.equal(thermalPressure.sha256,coldPressure.sha256, 'Identical pressure has identical GPU pixels for cold stride3 and thermal stride4 layouts');
    await fixture('lbm-pressure-solid-extreme', {mode:'pressure', pressure:.5, solidPressure:90000});
    await expect(page.getByLabel('表压色标')).toContainText('-10.0–10.0 Pa');
    await expect(page.getByLabel('流体表压范围',{exact:true})).toContainText('-10.00–10.00 Pa');
    const solidExtreme=await pixels('lbm-pressure-solid-extreme-a');
    assert.ok(solidExtreme.neutral>0,'Pressure solids remain visibly gray');
    await fixture('lbm-pressure-solid-other', {mode:'pressure', pressure:.5, solidPressure:-90000});
    assert.equal((await pixels('lbm-pressure-solid-extreme-b')).sha256,solidExtreme.sha256, 'Solid padding is excluded from pressure interpolation, color and statistics');
    for(const thermal of [false,true]) {
      await page.evaluate(thermal=>window.setFixture({mode:'pressure',savePressure:false,thermal}),thermal);
      await expect(page.getByRole('status')).toContainText('未保存可用的表压场');
      await expect(page.locator('canvas:visible')).toHaveCount(0);
      await expect(page.getByLabel('流体表压范围',{exact:true})).toContainText('未保存表压场');
    }
    await page.evaluate(()=>{window.setFixture({mode:'pressure'});const s=window.sim.getState();const result={...s.results.job.result,derived:{...s.results.job.result.derived,pressureScalePa:undefined}};s.updateResults({job:{...s.results.job,result}})});
    await expect(page.getByRole('status')).toContainText('未保存可用的表压场');
    await expect(page.getByLabel('流体表压范围',{exact:true})).toContainText('缺少保存单位');
    const maskCold = await fixture('mac-mask-padding25', { method: 'mac', mode: 'temperature', maskTemperature: 25 });
    const maskHot = await fixture('mac-mask-padding80', { method: 'mac', mode: 'temperature', maskTemperature: 80 });
    assert.equal(maskCold.sha256, maskHot.sha256, 'MAC insulated padding must not change solid color or neighboring interpolation');
    assert.ok(maskHot.neutral > 0, 'The insulated solid remains visibly neutral');
    const materialChanged = await fixture('mac-material40', { method: 'mac', mode: 'temperature', maskTemperature: 80, materialTemperature: 40 });
    assert.notEqual(materialChanged.sha256, maskHot.sha256, 'Real material temperature must still affect the GPU rendering');
    const lbmThermalA = await fixture('lbm-material40', { mode: 'temperature', materialTemperature: 40 });
    const lbmThermalB = await fixture('lbm-material60', { mode: 'temperature', materialTemperature: 60 });
    assert.notEqual(lbmThermalA.sha256, lbmThermalB.sha256, 'LBM thermal solids retain their real temperature coloring');
    const lbmCombined=await fixture('lbm-temperature-with-pressure',{mode:'temperature',savePressure:true,materialTemperature:60});
    assert.equal(lbmCombined.sha256,lbmThermalB.sha256,'Adding the pressure channel does not change legacy LBM temperature pixels');
    await page.evaluate(() => window.fallback());
    const fallbackFixture = async (label, args) => { await page.evaluate(args => window.setFixture(args), args); const actual = await pixels(label); report.checks.push(actual); return actual; };
    const center2d = () => page.getByLabel('二维流场剖面').evaluate(canvas => [...canvas.getContext('2d').getImageData(7, 7, 1, 1).data]);
    for (const method of ['lbm', 'mac']) {
      await fallbackFixture(`${method}-low2d`, { method, speed: .025 });
      const rgba = await center2d();
      assert.ok(rgba.every((value, i) => Math.abs(value - [0, 128, 255, 255][i]) <= 1), `${method}: 2D low speed uses the same blue color scale as 3D`);
    }
    await fallbackFixture('lbm-overrange2d', { speed: .15 });
    assert.deepEqual(await center2d(), [128, 0, 0, 255], 'Out-of-range speed saturates at the same red endpoint as 3D, not black');
    for(const method of ['lbm','mac']) {
      await fallbackFixture(method+'-negative-pressure2d',{method,mode:'pressure',pressure:-5});
      assert.deepEqual(await center2d(),[0,128,255,255],method+': -5 Pa uses 25% of the fixed -10..10 Pa color scale');
      await fallbackFixture(method+'-positive-pressure2d',{method,mode:'pressure',pressure:5});
      assert.deepEqual(await center2d(),[255,128,0,255],method+': +5 Pa uses 75% of the same signed scale');
    }
    await fallbackFixture('lbm-thermal-pressure2d',{mode:'pressure',thermal:true,pressure:5});
    await expect(page.locator('#root')).toContainText('表压峰值');
    for (const pressureScale of [1e40,1e80,1e-40,1e-300]) {
      await fallbackFixture('lbm-pressure-scale2d-'+pressureScale,{mode:'pressure',pressureScale,pressure:pressureScale*.005,pressureExtent:pressureScale*.01});
      assert.deepEqual(await center2d(),[255,128,0,255],'The 2D pressure colors retain the actual tiny or large Pa range');
    }
    await fallbackFixture('lbm-pressure-zero2d',{mode:'pressure',pressureScale:1e300,pressure:0,pressureExtent:0});
    assert.deepEqual(await center2d(),[128,255,128,255],'Zero pressure uses the neutral center of the signed 2D scale');
    await fallbackFixture('lbm-thermal-with-pressure2d',{mode:'temperature',savePressure:true,materialTemperature:60});
    assert.deepEqual(await center2d(),[128,0,0,255], 'Stride4 LBM temperature still comes from offset2');
    await fallbackFixture('lbm-cold-pressure-vorticity2d',{mode:'vorticity',savePressure:true,pressure:5});
    assert.deepEqual(await center2d(),[0,0,128,255], 'Cold stride3 pressure is never confused with vorticity or temperature');
    const mask2dA = await fallbackFixture('mac-mask2d-padding25', { method: 'mac', mode: 'temperature', maskTemperature: 25 });
    const mask2dB = await fallbackFixture('mac-mask2d-padding80', { method: 'mac', mode: 'temperature', maskTemperature: 80 });
    assert.equal(mask2dA.sha256, mask2dB.sha256);
    assert.deepEqual(await center2d(), [180, 180, 180, 255]);
    await expect(page.locator('#root')).toContainText('绝热掩膜灰色（温度未计算）');
    const material2d = await fallbackFixture('mac-material2d40', { method: 'mac', mode: 'temperature', materialTemperature: 40 });
    assert.notEqual(material2d.sha256, mask2dB.sha256);
    await page.evaluate(() => window.restoreGpu());
    if (native) {
      report.native = { jobId: native.validation.jobId, steps: native.result.summary.steps,
        physicalSeconds: native.validation.physicalSeconds, renders: [] };
      for (const file of native.selected) {
        const read = await page.evaluate(input => window.setNative(input), { name: file.name, spec: native.spec, result: native.result });
        const rendered = await pixels(`native-step${file.step}`);
        assert.equal(await page.evaluate(() => window.renderCalls.at(-1).view.inletVelocityLattice), 0);
        report.native.renders.push({ ...read, ...rendered });
      }
      const [first, last] = report.native.renders;
      assert.ok(first.changed > 0 && first.neutral > 0, 'The real near-stationary first frame still shows the solid model');
      assert.ok(last.changed > first.changed && last.sha256 !== first.sha256, 'The real final flow adds visible moving fluid');
    }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.gpuErrors, []); assert.deepEqual(report.networkViolations, []);
    report.passed = true;
  } catch (error) {
    report.failure = String(error); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error;
  } finally {
    await browser.close(); report.browserClosed = true;
    report.wallTimeMs = performance.now() - startedAt;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log('PASS real WebGPU/2D speed and signed pressure colors, saved units and frame range, legacy missing pressure, thermal layouts, solid masking; zero solver steps');
})().catch(error => { console.error(error); process.exitCode = 1; });
