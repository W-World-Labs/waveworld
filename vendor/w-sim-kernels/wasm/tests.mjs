// Real WASM memory/ABI checks plus tiny native/WASM field parity. No dependencies.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/lib.rs', import.meta.url));
const abi = fileURLToPath(new URL('./abi.rs', import.meta.url));
const reference = fileURLToPath(new URL('./native-reference.rs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-wasm-abi-'));
function rustc(args) {
  execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
}
try {
  const nativeLib = join(scratch, 'libw_sim_native.rlib');
  const wasmLib = join(scratch, 'libw_sim_wasm.rlib');
  const native = join(scratch, 'native-reference');
  const wasm = join(scratch, 'kernels.wasm');
  const libraryArgs = [source, '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort'];
  rustc([...libraryArgs, '-o', nativeLib]);
  rustc([reference, '--edition', '2021', '--extern', `w_sim_kernels=${nativeLib}`, '-O', '-C', 'panic=abort', '-o', native]);
  const expected = JSON.parse(execFileSync(native, [], { encoding: 'utf8', timeout: 10000 }));
  rustc([...libraryArgs, '--target', 'wasm32-unknown-unknown', '-o', wasmLib]);
  rustc([abi, '--edition', '2021', '--target', 'wasm32-unknown-unknown', '--crate-type', 'cdylib',
    '--extern', `w_sim_kernels=${wasmLib}`, '-O', '-C', 'panic=abort', '-C', 'link-arg=-zstack-size=16384', '-o', wasm]);
  const module = new WebAssembly.Module(readFileSync(wasm));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const { exports: e } = new WebAssembly.Instance(module);
  assert.equal(e.abi_version(), 11);
  let cursor = e.heap_base();
  e.memory.grow(4);
  function alloc(bytes, alignment = 8) {
    cursor = Math.ceil(cursor / alignment) * alignment;
    const address = cursor;
    cursor += bytes;
    assert(cursor <= e.memory.buffer.byteLength);
    return address;
  }
  const floats = (ptr, len) => new Float32Array(e.memory.buffer, ptr, len);
  const bits = (ptr, len) => Array.from(new Uint32Array(e.memory.buffer, ptr, len));
  let wave = alloc(49 * 4), previous = alloc(49 * 4);
  const mask = alloc(49);
  new Uint8Array(e.memory.buffer, mask, 49)[25] = 1;
  assert.equal(e.seed_wave(wave, previous, 7, 2, 3, 2, 1.3), 0);
  for (let i = 0; i < 5; i++) {
    assert.equal(e.step(wave, previous, 7, .25, .997, mask), 0);
    [wave, previous] = [previous, wave];
  }
  assert.deepEqual(bits(wave, 49), expected.wave);
  let heat = alloc(35 * 4), next = alloc(35 * 4);
  assert.equal(e.seed_heat(heat, 7, 5, 0, 3, 2, 1.3), 0);
  for (let i = 0; i < 5; i++) {
    assert.equal(e.heat(heat, next, 7, 5, .23), 0);
    [heat, next] = [next, heat];
  }
  assert.deepEqual(bits(heat, 35), expected.heat);

  // Rejected memory inputs must not trap or change a valid output buffer.
  const oldNext = bits(next, 35);
  const end = e.memory.buffer.byteLength;
  for (const ptr of [0, e.heap_base() - 4, heat + 1, end - 4, 0xfffffffc]) {
    assert.equal(e.heat(ptr, next, 7, 5, .23), 2);
  }
  assert.equal(e.heat(heat, heat, 7, 5, .23), 2);
  assert.equal(e.heat(heat, heat + 4, 7, 5, .23), 2);
  assert.equal(e.step(wave, previous, 7, .25, .997, wave), 2);
  assert.equal(e.seed_wave(wave, wave, 7, 3, 3, 1, 1), 2);
  assert.equal(e.seed_heat(next, 0, 5, 0, 0, 1, 1), 1);
  assert.equal(e.heat(heat, next, 0xffffffff, 0xffffffff, .23), 1);
  assert.equal(e.heat(heat, next, 7, 5, .26), 3);
  assert.deepEqual(bits(next, 35), oldNext);
  assert.equal(e.seed_heat(next, 7, 5, 0, 0, 1, Infinity), 4);

  const params = alloc(1888), flags = alloc(60), f = alloc(60 * 19 * 4);
  const post = alloc(60 * 19 * 4), velocity = alloc(60 * 3 * 4), density = alloc(60 * 4);
  const stats = alloc(152);
  const statsGuard = alloc(8);new Uint8Array(e.memory.buffer,statsGuard,8).fill(0xa5);
  const p = new DataView(e.memory.buffer, params, 1888);
  for (const [offset, value] of [[0, 5], [4, 4], [8, 3], [12, 0], [16, 0], [56, 11]]) p.setUint32(offset, value, true);
  for (const [offset, value] of [[24, .8], [32, .04], [40, .12], [48, .01]]) p.setFloat64(offset, value, true);
  const flagView = new Uint8Array(e.memory.buffer, flags, 60);
  flagView[32] = 1;
  const init = () => e.d3q19_init(params, flags, f, post, velocity, density, 0, 0, 0, 0);
  const step = (index = 1, output = stats) => e.d3q19_step(params, flags, f, post, velocity, density, 0, 0, 0, 0, index, output);
  assert.equal(init(), 0);
  for (let i = 1; i <= 5; i++) assert.equal(step(i), 0);
  for (const [name, ptr, len] of [['f', f, 60 * 19], ['post', post, 60 * 19], ['velocity', velocity, 60 * 3], ['density', density, 60]]) {
    assert.deepEqual(bits(ptr, len), expected[name], `${name} native/WASM bits`);
  }
  assert.deepEqual(Array.from(new Float64Array(e.memory.buffer, stats, 5)), expected.stats);
  assert(new Uint8Array(e.memory.buffer,statsGuard,8).every(v=>v===0xa5),'152-byte stats write guard');
  assert.equal(step(1, flags),2,'expanded stats must not alias inputs');
  assert.equal(step(1,e.memory.buffer.byteLength-96),2,'old 96-byte end-of-memory stats rejected');
  const display = alloc(60 * 2 * 4);
  assert.equal(e.d3q19_display(params,velocity,flags,0,0,display), 0);
  assert.deepEqual(bits(display, 120), expected.display);
  assert.equal(e.d3q19_display(params,velocity,flags,0,0,velocity), 2);
  p.setUint32(16, 1, true);
  for (const name of ['isothermal-slip','isothermal-ground-stationary','isothermal-ground-moving']) {
  const enabled=name.includes('-ground-');
  p.setUint32(244,enabled?1:0,true);p.setFloat64(248,name.endsWith('moving')?.04:0,true);
  const slipReference = JSON.parse(execFileSync(native, [name], { encoding: 'utf8', timeout: 10000 }));
  assert.equal(init(), 0);
  for (let i = 1; i <= 5; i++) assert.equal(step(i), 0);
  for (const [name, ptr, len] of [['f', f, 1140], ['post', post, 1140], ['velocity', velocity, 180], ['density', density, 60]]) {
    assert.deepEqual(bits(ptr, len), slipReference[name], `specular transport ${name} native/WASM bits`);
  }
  assert.deepEqual(Array.from(new Float64Array(e.memory.buffer, stats, 5)), slipReference.stats);
  }
  p.setUint32(244,2,true);assert.equal(init(),7);p.setUint32(244,0,true);
  for(const speed of [-0,.01,NaN]) {p.setFloat64(248,speed,true);assert.equal(init(),7);}
  p.setUint32(244,1,true);
  for(const speed of [-.01,.2,.199999999,Infinity,NaN]) {p.setFloat64(248,speed,true);assert.equal(init(),3);}
  p.setUint32(244,0,true);p.setFloat64(248,0,true);
  p.setUint32(16, 0, true);
  const meshVertices=[1,1,1, 3,1,1, 3,3,1, 1,3,1, 1,1,3, 3,1,3, 3,3,3, 1,3,3];
  const meshIndices=[0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0];
  const vertexPtr=alloc(meshVertices.length*4), indexPtr=alloc(meshIndices.length*4), meshFlags=alloc(96), scratchPtr=alloc(60*8), meshCounts=alloc(8);
  floats(vertexPtr,24).set(meshVertices);
  new Uint32Array(e.memory.buffer,indexPtr,36).set(meshIndices);
  assert.equal(e.voxelize(vertexPtr,8,indexPtr,12,6,4,4,meshFlags,scratchPtr,meshCounts),0);
  assert.deepEqual(Array.from(new Uint8Array(e.memory.buffer,meshFlags,96)),expected.meshFlags);
  assert.deepEqual(bits(meshCounts,2),expected.meshCounts);
  assert.equal(e.voxelize(vertexPtr,8,indexPtr,12,6,4,4,meshFlags,indexPtr,meshCounts),2);
  new Uint32Array(e.memory.buffer,indexPtr,36)[0]=8;
  assert.equal(e.voxelize(vertexPtr,8,indexPtr,12,6,4,4,meshFlags,scratchPtr,meshCounts),5);
  assert.equal(e.voxelize(0,0,0,0,6,4,4,meshFlags,0,meshCounts),11);
  assert.deepEqual(bits(meshCounts,2),expected.meshCounts);
  new Uint32Array(e.memory.buffer,indexPtr,36).set(meshIndices);
  // Open z tube formerly had identical flags to the closed box. Both exports
  // now reject it before writing flags/counts, including with explicit groups.
  const tubeGroups=alloc(4,4);new Uint32Array(e.memory.buffer,tubeGroups,1)[0]=8;
  assert.equal(e.voxelize(vertexPtr,8,indexPtr+48,8,6,4,4,meshFlags,scratchPtr,meshCounts),11);
  assert.equal(e.voxelize_solids(vertexPtr,8,indexPtr+48,8,tubeGroups,1,6,4,4,meshFlags,scratchPtr,meshCounts),11);
  new Uint32Array(e.memory.buffer,indexPtr,3).set([0,0,1]);
  assert.equal(e.voxelize(vertexPtr,8,indexPtr,1,6,4,4,meshFlags,scratchPtr,meshCounts),11);
  assert.deepEqual(Array.from(new Uint8Array(e.memory.buffer,meshFlags,96)),expected.meshFlags);
  assert.deepEqual(bits(meshCounts,2),expected.meshCounts);
  new Uint32Array(e.memory.buffer,indexPtr,36).set(meshIndices);
  assert.equal(e.voxelize(vertexPtr,8,indexPtr,12,6,4,4,meshFlags,scratchPtr,meshCounts),0);
  const solidVertices=[2,2,2,10,2,2,10,10,2,2,10,2,2,2,10,10,2,10,10,10,10,2,10,10,
    6,4,3,14,4,3,14,12,3,6,12,3,6,4,11,14,4,11,14,12,11,6,12,11];
  const solidIndices=[...meshIndices,...meshIndices.map(i=>i+8)];
  const solidV=alloc(solidVertices.length*4), solidI=alloc(solidIndices.length*4), solidGroups=alloc(8,4);
  const solidF=alloc(18*16*14), solidScratch=alloc(120*8), solidOut=alloc(8,4);
  floats(solidV,solidVertices.length).set(solidVertices);
  new Uint32Array(e.memory.buffer,solidI,solidIndices.length).set(solidIndices);
  const groupCounts=new Uint32Array(e.memory.buffer,solidGroups,2);groupCounts.set([12,12]);
  const grouped=(ptr=solidGroups,len=2)=>e.voxelize_solids(solidV,16,solidI,24,ptr,len,18,16,14,solidF,solidScratch,solidOut);
  assert.equal(grouped(),0);
  const solidReference=JSON.parse(execFileSync(native,['solid-geometry'],{encoding:'utf8',timeout:10000}));
  const solidBits=()=>Array.from(new Uint8Array(e.memory.buffer,solidF,18*16*14));
  assert.deepEqual(solidBits(),solidReference.flags,'overlapping solids native/WASM full flags');
  assert.deepEqual(bits(solidOut,2),[1051,95]);
  assert.deepEqual(bits(solidOut,2),solidReference.counts);
  for(const bad of [solidGroups+1,0,solidF,solidI,solidScratch,solidOut,e.memory.buffer.byteLength-4]){
    assert.equal(grouped(bad),2,'solid membership memory must be valid and disjoint');
  }
  assert.equal(grouped(solidGroups,0xffffffff),2);
  for(const values of [[0,24],[12,11],[12,13],[0xffffffff,1]]){
    groupCounts.set(values);assert.equal(grouped(),5);
    assert.deepEqual(solidBits(),solidReference.flags,'bad partition rejected before flag writes');
    assert.deepEqual(bits(solidOut,2),solidReference.counts);
  }
  groupCounts.set([24,0]);assert.equal(grouped(solidGroups,1),0);
  assert.deepEqual(bits(solidOut,2),[946,95]);
  const singleBoundary=solidBits();
  assert.equal(grouped(0,0),0);assert.deepEqual(solidBits(),singleBoundary);
  assert.equal(e.voxelize(solidV,16,solidI,24,18,16,14,solidF,solidScratch,solidOut),0);
  assert.deepEqual(solidBits(),singleBoundary,'legacy ABI is the same single-boundary implementation');
  groupCounts.set([12,12]);
  const lastTriangle=new Uint32Array(e.memory.buffer,solidI+(solidIndices.length-3)*4,3);
  [lastTriangle[0],lastTriangle[2]]=[lastTriangle[2],lastTriangle[0]];
  assert.equal(grouped(),11,'all solid sets must validate before any flags/counts are written');
  assert.deepEqual(solidBits(),singleBoundary);assert.deepEqual(bits(solidOut,2),[946,95]);
  [lastTriangle[0],lastTriangle[2]]=[lastTriangle[2],lastTriangle[0]];
  assert.equal(grouped(),0);assert.deepEqual(solidBits(),solidReference.flags);
  console.log('Geometry: closed explicit union and single-set native/WASM flags/counts; open/empty/degenerate/inconsistent boundary rejection before writes, invalid partitions and alias/bounds checks pass.');
  const regionFlags=alloc(125),regionMatrix=alloc(96),regionBounds=alloc(96),regionCounts=alloc(68);
  const regionView=new Uint8Array(e.memory.buffer,regionFlags,125);regionView.fill(4);regionView[0]=0;
  new Float64Array(e.memory.buffer,regionMatrix,12).set([0,.2,0,0,-.2,0,0,1,0,0,.2,0]);
  new Float64Array(e.memory.buffer,regionBounds,12).set([0,0,0,.5,1,1,.5,0,0,1,1,1]);
  assert.equal(e.thermal_regions(regionFlags,5,5,5,regionMatrix,regionBounds,2,regionCounts),0);
  assert.deepEqual(Array.from(regionView),expected.regionFlags);
  assert.deepEqual(Array.from(new Uint32Array(e.memory.buffer,regionCounts,17)),expected.regionCounts);
  for(const call of [()=>e.thermal_regions(regionFlags,5,5,5,regionMatrix,regionBounds,2,regionFlags),()=>e.thermal_regions(regionFlags,5,5,5,regionMatrix,regionMatrix,2,regionCounts),()=>e.thermal_regions(regionFlags,5,5,5,regionMatrix+1,regionBounds,2,regionCounts)])assert.equal(call(),2);
  regionView.fill(4);new Float64Array(e.memory.buffer,regionBounds,12)[3]=.6;
  assert.equal(e.thermal_regions(regionFlags,5,5,5,regionMatrix,regionBounds,2,regionCounts),5);
  assert(regionView.every(f=>f===4));
  assert.equal(e.thermal_regions(regionFlags,5,5,5,regionMatrix,0,0,regionCounts),0);
  const stateBeforeBadCalls = bits(f, 60 * 19);
  assert.equal(e.d3q19_init(params + 4, flags, f, post, velocity, density, 0, 0, 0, 0), 2);
  assert.equal(e.d3q19_init(params, flags, f, f, velocity, density, 0, 0, 0, 0), 2);
  assert.equal(e.d3q19_init(params, flags, f, post, f, density, 0, 0, 0, 0), 2);
  assert.equal(e.d3q19_init(params, params, f, post, velocity, density, 0, 0, 0, 0), 2);
  assert.equal(step(1, f), 2);
  assert.equal(step(1, end - 8), 2);
  assert.equal(step(1, stats + 4), 2);
  p.setUint32(56, 10, true); assert.equal(init(), 7); p.setUint32(56, 11, true);
  p.setUint32(20, 2, true); assert.equal(init(), 6); p.setUint32(20, 0, true);
  p.setFloat64(64, 1, true); assert.equal(init(), 7); p.setFloat64(64, 0, true);
  p.setFloat64(120, -0, true); assert.equal(init(), 7); p.setFloat64(120, 0, true);
  p.setUint32(60, 2, true); assert.equal(init(), 6); p.setUint32(60, 0, true);
  p.setUint32(12, 3, true); assert.equal(init(), 6); p.setUint32(12, 0, true);
  p.setUint32(16, 2, true); assert.equal(init(), 6); p.setUint32(16, 0, true);
  flagView[32] = 2; assert.equal(init(), 6); flagView[32] = 1;
  p.setFloat64(24, .5, true); assert.equal(init(), 3); p.setFloat64(24, .8, true);
  p.setFloat64(128, -0, true); assert.equal(init(), 7); p.setFloat64(128, 0, true);
  assert.equal(e.d3q19_init(params, flags, f, post, velocity, density, f, 0, 0, 0), 2);
  assert.deepEqual(bits(f, 60 * 19), stateBeforeBadCalls);
  floats(f, 60 * 19)[0] = NaN;
  assert.equal(step(), 4);
  // Rotated fan on the same tiny grid, with zero inlet and a shielded solid.
  p.setUint32(20, 1, true);
  for (const [offset, value] of [[32, 0], [48, 0], [64, 2.5], [72, 2], [80, 1.5], [88, .5], [96, .6], [104, .8], [112, 0], [120, .001]]) p.setFloat64(offset, value, true);
  assert.equal(init(), 0);
  for (let i = 1; i <= 5; i++) assert.equal(step(i), 0);
  for (const [name, ptr, len] of [['fanF', f, 60 * 19], ['fanPost', post, 60 * 19], ['fanVelocity', velocity, 60 * 3], ['fanDensity', density, 60]]) {
    assert.deepEqual(bits(ptr, len), expected[name], `${name} native/WASM bits`);
  }
  assert.deepEqual(Array.from(new Float64Array(e.memory.buffer, stats, 5)), expected.fanStats);
  assert(expected.fanStats[4] > 0, 'zero-inlet fan produces flow');
  const fanBeforeBadCalls = bits(f, 60 * 19);
  p.setFloat64(96, 1, true); assert.equal(init(), 3); p.setFloat64(96, .6, true);
  p.setFloat64(88, .49, true); assert.equal(init(), 3); p.setFloat64(88, .5, true);
  p.setUint32(20, 0, true); assert.equal(step(), 7); p.setUint32(20, 1, true);
  assert.deepEqual(bits(f, 60 * 19), fanBeforeBadCalls);
  const energy=alloc(60*8), nextEnergy=alloc(60*8), temperature=alloc(60*8), mass=alloc(60*8), thermalDisplay=alloc(60*3*4);
  const doubles=(ptr,len)=>new Float64Array(e.memory.buffer,ptr,len);
  const thermalInit=()=>e.d3q19_init(params,flags,f,post,velocity,density,energy,nextEnergy,temperature,mass);
  const thermalStep=(i=1)=>e.d3q19_step(params,flags,f,post,velocity,density,energy,nextEnergy,temperature,mass,i,stats);
  for (const name of ['power','fixed','power-slip','fixed-slip','power-ground-stationary','power-ground-moving','fixed-ground-stationary','fixed-ground-moving','power-regions-contact','power-regions-contact-zero','power-regions','power-regions-only']) {
    const fixed=name.startsWith('fixed'), ground=name.includes('-ground-'), slip=name.endsWith('slip')||ground;
    p.setFloat64(32,slip?.02:0,true);p.setUint32(16,slip?1:0,true);
    const ref=JSON.parse(execFileSync(native,[name],{encoding:'utf8',timeout:10000}));
    p.setUint32(60,1,true);
    for (const [offset,value] of [[128,.001],[136,.01],[144,25],[152,fixed?35:0],[160,.1],[168,1],[176,10],[184,.01],[192,fixed?0:2],[200,fixed?0:20],[208,fixed?0:.1],[216,fixed?0:.2],[232,fixed?10:1]]) p.setFloat64(offset,value,true);
    p.setUint32(224,fixed?0:1,true);p.setUint32(228,128,true);
    flagView.fill(0);flagView[32]=fixed?2:4;flagView[22]=3;
    new Uint8Array(e.memory.buffer,params+240,1648).fill(0);
    p.setUint32(244,ground?1:0,true);p.setFloat64(248,name.endsWith('moving')?.02:0,true);
    if(name.includes('regions')) {
      p.setUint32(240,2,true);
      for(const [i,m]of [[4,5,.2,.3],[3,30,.05,0]].entries())new Float64Array(e.memory.buffer,params+256+i*32,4).set(m);
      if(name==='power-regions-only'){p.setFloat64(216,0,true);flagView[32]=5;flagView[37]=6;}else{flagView[33]=5;flagView[34]=6;}
    }
    if(name.includes('contact')) {
      p.setUint32(768,5,true);p.setFloat64(800,name.endsWith('-zero')?0:.5,true);p.setFloat64(816,name.endsWith('-zero')?0:2,true);
    }
    assert.equal(thermalInit(),0);
    assert.equal(doubles(temperature,60)[32],fixed?10:0);
    for (let i=1;i<=3;i++) assert.equal(thermalStep(i),0);
    assert.equal(e.d3q19_display(params,velocity,flags,temperature,0,thermalDisplay),0);
    const pressureDisplay=alloc(60*4*4);
    assert.equal(e.d3q19_display(params,velocity,flags,temperature,f,pressureDisplay),0);
    assert.deepEqual(bits(pressureDisplay,60*4),ref.thermal.pressureDisplay,'thermal pressure frame native/WASM bits');
    for (const [name,ptr,len] of [['f',f,1140],['post',post,1140],['velocity',velocity,180],['density',density,60],['display',thermalDisplay,180]]) {
      assert.deepEqual(bits(ptr,len),ref.thermal[name], `thermal ${name} native/WASM bits`);
    }
    for (const [name,ptr] of [['energy',energy],['nextEnergy',nextEnergy],['temperature',temperature],['mass',mass]]) {
      assert.deepEqual(Array.from(doubles(ptr,60)),ref.thermal[name], `thermal ${name} native/WASM f64`);
    }
    assert.deepEqual(Array.from(doubles(stats,12)),ref.thermal.stats);
  }
  const thermalBefore=bits(f,1140);
  const contactsMask=alloc(20);
  assert.equal(e.thermal_contact_faces(flags,5,4,3,0,contactsMask),0);assert.equal(new Uint32Array(e.memory.buffer,contactsMask,5)[0],4);
  assert.equal(e.thermal_contact_faces(flags,5,4,3,0,flags),2);
  assert.equal(e.thermal_contact_faces(flags,5,4,3,2,contactsMask),1);
  assert.equal(e.thermal_contact_faces(flags,5,4,3,0,contactsMask+1),2);
  p.setUint32(788,1,true);assert.equal(thermalInit(),7);p.setUint32(788,0,true);
  p.setUint32(784,256,true);assert.equal(thermalInit(),7);p.setUint32(784,0,true);
  p.setFloat64(800,-0,true);assert.equal(thermalInit(),7);p.setFloat64(800,0,true);
  p.setUint32(768,1,true);assert.equal(thermalInit(),5);p.setUint32(768,4,true);
  p.setFloat64(816,-1,true);assert.equal(thermalInit(),3);p.setFloat64(816,NaN,true);assert.equal(thermalInit(),3);p.setFloat64(816,0,true);
  p.setUint32(768,8,true);assert.equal(thermalInit(),3);p.setUint32(768,0,true);
  // Palette count, reserved words and unused slots cannot silently alter material mapping.
  p.setUint32(240,17,true);assert.equal(thermalInit(),7);p.setUint32(240,2,true);
  p.setUint32(244,2,true);assert.equal(thermalInit(),7);p.setUint32(244,0,true);
  p.setFloat64(320,-0,true);assert.equal(thermalInit(),7);p.setFloat64(320,0,true);
  p.setFloat64(256,0,true);assert.equal(thermalInit(),3);p.setFloat64(256,4,true);
  p.setFloat64(216,1,true);assert.equal(thermalInit(),5);p.setFloat64(216,0,true);
  const regionFlag=flagView[33];flagView[33]=7;assert.equal(thermalInit(),6);flagView[33]=regionFlag;
  // Restore the original fixed-slip state for the existing coefficient checks.
  new Uint8Array(e.memory.buffer,params+240,1648).fill(0);flagView[32]=2;flagView[33]=0;flagView[37]=0;p.setUint32(224,0,true);p.setFloat64(152,35,true);
  p.setFloat64(192,0,true);p.setFloat64(200,0,true);p.setFloat64(208,0,true);p.setFloat64(216,0,true);p.setFloat64(232,10,true);
  assert.equal(init(),2);
  assert.equal(e.d3q19_init(params,flags,f,post,velocity,density,energy,energy,temperature,mass),2);
  assert.equal(e.d3q19_init(params,flags,f,post,velocity,density,energy,nextEnergy,f,mass),2);
  assert.equal(e.d3q19_init(params,flags,f,post,velocity,density,energy,nextEnergy,temperature,mass+4),2);
  assert.equal(e.d3q19_init(params,flags,f,post,velocity,density,energy,nextEnergy,temperature,temperature),2);
  assert.equal(e.d3q19_display(params,velocity,flags,temperature,0,temperature),2);
  p.setFloat64(136,0,true);assert.equal(thermalInit(),3);p.setFloat64(136,.01,true);
  p.setUint32(224,2,true);assert.equal(thermalInit(),6);p.setUint32(224,0,true);
  p.setUint32(228,0,true);assert.equal(thermalInit(),3);p.setUint32(228,128,true);
  p.setFloat64(152,25,true);assert.equal(thermalInit(),3);p.setFloat64(152,35,true);
  doubles(energy,60)[0]=NaN;assert.equal(thermalStep(),4);doubles(energy,60)[0]=0;
  assert.deepEqual(bits(f,1140),thermalBefore);
  // Disabled thermal configuration must be entirely zero, including the tail.
  new Uint8Array(e.memory.buffer,params+128,112).fill(0);p.setUint32(60,0,true);
  p.setUint32(228,1,true);assert.equal(init(),7);p.setUint32(228,0,true);
  p.setFloat64(232,-0,true);assert.equal(init(),7);p.setFloat64(232,0,true);
  // FDTD captures the removed TypeScript arithmetic/order and checks both native
  // and WASM against it; source waveform generation is deliberately not repeated.
  const fdtdNative=join(scratch,'fdtd-reference');
  rustc([fileURLToPath(new URL('./fdtd-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${nativeLib}`,'-O','-C','panic=abort','-o',fdtdNative]);
  const fdtdGolden=JSON.parse(readFileSync(new URL('./fdtd-reference.json',import.meta.url),'utf8'));
  const fc=alloc(32),feps=alloc(80),fmask=alloc(20),ez=alloc(80),hx=alloc(80),hy=alloc(80);
  const left=alloc(16),right=alloc(16),bottom=alloc(20),top=alloc(20),fdtdEnergy=alloc(8);
  const fp=new DataView(e.memory.buffer,fc,32);
  fp.setUint32(0,5,true);fp.setUint32(4,4,true);fp.setFloat64(16,.25,true);fp.setFloat64(24,1.5,true);
  const advanceFdtd=()=>e.fdtd_step(fc,feps,fmask,ez,hx,hy,left,right,bottom,top);
  for(const [boundary,name]of ['mur','pec'].entries()){
    const nativeResult=JSON.parse(execFileSync(fdtdNative,[name],{encoding:'utf8',timeout:10000}));
    assert.deepEqual(nativeResult,fdtdGolden[name],`native ${name} matches original TS Yee fields/history/energy`);
    fp.setUint32(8,boundary,true);
    for(let i=0;i<20;i++){
      floats(feps,20)[i]=i%5>=3?2:1;
      floats(ez,20)[i]=(i%5-2)*.125;floats(hx,20)[i]=(i%3-1)*.0625;floats(hy,20)[i]=(i%4-2)*.03125;
    }
    const mask=new Uint8Array(e.memory.buffer,fmask,20);mask.fill(0);mask[0]=1;mask[7]=1;mask[12]=2;
    for(let j=0;j<4;j++){floats(left,4)[j]=(j-1)*.01;floats(right,4)[j]=j*.02;}
    for(let i=0;i<5;i++){floats(bottom,5)[i]=(i-2)*.015;floats(top,5)[i]=i*.01;}
    for(const amplitude of [.3,-.2,.05]){
      assert.equal(e.fdtd_source(ez,5,4,1,2,amplitude),0);
      assert.equal(advanceFdtd(),0);
    }
    for(const [key,ptr,n]of [['ez',ez,20],['hx',hx,20],['hy',hy,20],['left',left,4],['right',right,4],['bottom',bottom,5],['top',top,5]]){
      assert.deepEqual(bits(ptr,n),nativeResult[key],`${name} ${key} native/WASM bits`);
    }
    assert.equal(e.fdtd_energy(fc,feps,ez,hx,hy,fdtdEnergy),0);
    assert.equal(new Float64Array(e.memory.buffer,fdtdEnergy,1)[0],nativeResult.energy);
  }
  const fdtdBefore=[bits(ez,20),bits(hx,20),bits(hy,20)];
  for(const call of [
    ()=>e.fdtd_step(fc,feps,fmask,ez,ez,hy,left,right,bottom,top),
    ()=>e.fdtd_step(fc,feps,fmask,ez,hx,hy,left,left,bottom,top),
    ()=>e.fdtd_step(fc,feps,fmask,ez,hx,hy,left,right,left,top),
    ()=>e.fdtd_step(fc,ez,fmask,ez,hx,hy,left,right,bottom,top),
    ()=>e.fdtd_step(fc,feps,ez,ez,hx,hy,left,right,bottom,top),
    ()=>e.fdtd_step(fc,feps,fmask,fc,hx,hy,left,right,bottom,top),
    ()=>e.fdtd_step(fc,feps,fmask,ez+1,hx,hy,left,right,bottom,top),
    ()=>e.fdtd_step(fc,feps,fmask,ez,hx,hy,left,right,bottom,e.memory.buffer.byteLength-4),
    ()=>e.fdtd_step(0,feps,fmask,ez,hx,hy,left,right,bottom,top),
    ()=>e.fdtd_energy(fc,feps,ez,hx,hy,ez),
  ])assert.equal(call(),2,'bad FDTD memory must return status rather than trap');
  fp.setUint32(12,1,true);assert.equal(advanceFdtd(),7);fp.setUint32(12,0,true);
  fp.setUint32(8,2,true);assert.equal(advanceFdtd(),6);fp.setUint32(8,1,true);
  fp.setUint32(0,2,true);assert.equal(advanceFdtd(),1);fp.setUint32(0,5,true);
  fp.setFloat64(16,2,true);assert.equal(advanceFdtd(),3);fp.setFloat64(16,.25,true);
  fp.setFloat64(24,0,true);assert.equal(advanceFdtd(),3);fp.setFloat64(24,1.5,true);
  const epsilon=floats(feps,20)[0];floats(feps,20)[0]=.001;assert.equal(advanceFdtd(),3);floats(feps,20)[0]=epsilon;
  const history=floats(top,5)[0];floats(top,5)[0]=NaN;assert.equal(advanceFdtd(),4);floats(top,5)[0]=history;
  assert.equal(e.fdtd_source(ez,5,4,5,0,1),1);
  assert.equal(e.fdtd_source(ez,5,4,0,0,NaN),4);
  assert.equal(e.fdtd_source(ez,5,4,0,0,Number.MAX_VALUE),4);
  assert.deepEqual([bits(ez,20),bits(hx,20),bits(hy,20)],fdtdBefore,'invalid FDTD inputs do not modify fields');
  assert.equal(e.fdtd_step(fc,feps,0,ez,hx,hy,left,right,bottom,top),0,'mask is optional');
  console.log('TMz FDTD: original TS/native/WASM mixed-precision fields, histories, source and energy match; CFL/finite/length/alignment/alias checks pass.');
  const mdNative=join(scratch,'md-reference');
  rustc([fileURLToPath(new URL('./md-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${nativeLib}`,'-O','-C','panic=abort','-o',mdNative]);
  const mdGolden=JSON.parse(readFileSync(new URL('./md-reference.json',import.meta.url),'utf8'));
  const mc=alloc(32),ms=alloc(32),mb=alloc(48),mp=alloc(48),mv=alloc(48),mf=alloc(48),mu=alloc(48),m0=alloc(48),mSpeed=alloc(16),mStats=alloc(72),mh=alloc(64),mr=alloc(32),mg=alloc(32),mRdf=alloc(16),mTimes=alloc(32),mMsd=alloc(32),mDiff=alloc(40),mScale=alloc(8);
  const cp=new DataView(e.memory.buffer,mc,32),bp=new DataView(e.memory.buffer,mb,48);
  cp.setUint32(0,4,true);cp.setFloat64(16,.005,true);cp.setFloat64(24,2.5,true);
  bp.setFloat64(24,.8,true);bp.setFloat64(32,1,true);bp.setFloat64(40,.02,true);
  const initMd=()=>e.md_init(mc,ms,mp,mv,mf,mu);
  const batchMd=(count)=>e.md_batch(mc,ms,mb,mp,mv,mf,mu,count);
  const readMd=()=>e.md_read(mc,ms,m0,mv,mu,mSpeed,mStats);
  const compareFinite=(a,b,label)=>{
    assert(Number.isFinite(a)&&Number.isFinite(b));
    assert(Math.abs(a-b)<=2e-14*Math.max(1,Math.abs(b)),`${label}: ${a} != ${b}`);
  };
  for(const name of ['nve','nvt','npt','npt3']){
    const nativeResult=JSON.parse(execFileSync(mdNative,[name],{encoding:'utf8',timeout:10000}));
    const golden=mdGolden[name],dim=golden.dim,len=4*dim;
    // Roots/3D integer powers can alter f64 low bits relative to libm Math.pow;
    // these small migration fixtures retain every stored f32 field bit.
    for(const key of ['initialPos','initialVel','pos','vel','force','unwrapped','speed','r','g'])assert.deepEqual(nativeResult[key],golden[key],`${name} ${key} matches original TS`);
    for(const key of ['state','stats','rdf','diffusion'])nativeResult[key].forEach((v,i)=>compareFinite(v,golden[key][i],`${name} original TS ${key}[${i}]`));
    cp.setUint32(4,dim,true);doubles(ms,4).set([8,0,0,0]);
    new Uint32Array(e.memory.buffer,mp,len).set(golden.initialPos);new Uint32Array(e.memory.buffer,m0,len).set(golden.initialPos);new Uint32Array(e.memory.buffer,mv,len).set(golden.initialVel);
    bp.setUint32(0,name==='nve'?0:name==='nvt'?1:3,true);bp.setFloat64(8,name==='nve'?0:.4,true);bp.setFloat64(16,name.startsWith('npt')?.15:0,true);
    assert.equal(initMd(),0);let completed=0;let at=0;
    for(const count of [4,1,2,3]){
      assert.equal(batchMd(count),0);assert.equal(readMd(),0);completed+=count;
      doubles(mTimes,4)[at]=completed*.005;doubles(mMsd,4)[at]=doubles(mStats,9)[5];
      assert.deepEqual({time:doubles(mTimes,4)[at],msd:doubles(mMsd,4)[at]},nativeResult.history[at]);at++;
    }
    for(const [key,ptr,n]of [['pos',mp,len],['vel',mv,len],['force',mf,len],['unwrapped',mu,len],['speed',mSpeed,4]])assert.deepEqual(bits(ptr,n),nativeResult[key],`${name} native/WASM ${key}`);
    assert.deepEqual(Array.from(doubles(ms,4)),nativeResult.state,`${name} native/WASM scalar bits`);
    assert.deepEqual(Array.from(doubles(mStats,9)),nativeResult.stats);
    assert.equal(e.md_rdf(mc,ms,mp,8,doubles(ms,4)[0]/2,mh,mr,mg,mRdf),0);
    assert.deepEqual(bits(mr,8),nativeResult.r);assert.deepEqual(bits(mg,8),nativeResult.g);assert.deepEqual(Array.from(doubles(mRdf,2)),nativeResult.rdf);
    assert.equal(e.md_diffusion(mTimes,mMsd,4,dim,.2,mDiff),0);assert.deepEqual(Array.from(doubles(mDiff,5)),nativeResult.diffusion);
  }
  const mdBefore=[bits(mp,12),bits(mv,12),bits(mf,12),bits(mu,12),Array.from(doubles(ms,4))];
  for(const call of [
    ()=>e.md_init(mc,ms,mp,mp,mf,mu),
    ()=>e.md_step(mc,ms,mp,mv,mp,mu),
    ()=>e.md_batch(mc,ms,mb,mp,mv,mf,mp,1),
    ()=>e.md_force(mc,mc,mp,mf),
    ()=>e.md_force(mc,ms,mp,mp),
    ()=>e.md_force(mc,ms,mp+1,mf),
    ()=>e.md_force(mc,ms,e.memory.buffer.byteLength-4,mf),
    ()=>e.md_barostat(mc,ms,mb,mp,mv,mf,mu,ms),
    ()=>e.md_read(mc,ms,m0,mv,mu,mv,mStats),
    ()=>e.md_read(mc,ms,m0,mv,mu,mSpeed,ms),
    ()=>e.md_rdf(mc,ms,mp,8,4,mh,mh,mg,mRdf),
    ()=>e.md_diffusion(mTimes,mTimes,4,2,.2,mDiff),
    ()=>e.md_diffusion(mTimes,mMsd,4,2,.2,mTimes),
  ])assert.equal(call(),2,'invalid MD alias/range rejected without trap');
  for(const count of [0,5,50])assert.equal(batchMd(count),3);
  cp.setUint32(4,4,true);assert.equal(initMd(),6);cp.setUint32(4,3,true);
  cp.setUint32(8,1,true);assert.equal(initMd(),7);cp.setUint32(8,0,true);
  bp.setUint32(4,1,true);assert.equal(batchMd(1),7);bp.setUint32(4,0,true);
  bp.setUint32(0,4,true);assert.equal(batchMd(1),7);bp.setUint32(0,3,true);
  bp.setFloat64(8,-1,true);assert.equal(batchMd(1),3);bp.setFloat64(8,.4,true);
  const coordinate=floats(mp,12)[0];floats(mp,12)[0]=NaN;assert.equal(initMd(),4);floats(mp,12)[0]=coordinate;
  cp.setFloat64(16,0,true);assert.equal(initMd(),3);cp.setFloat64(16,.005,true);
  assert.deepEqual([bits(mp,12),bits(mv,12),bits(mf,12),bits(mu,12),Array.from(doubles(ms,4))],mdBefore);
  bp.setFloat64(24,Infinity,true);assert.equal(e.md_barostat(mc,ms,mb,mp,mv,mf,mu,mScale),0);assert.equal(doubles(mScale,1)[0],1);
  assert.deepEqual([bits(mp,12),bits(mv,12),bits(mf,12),bits(mu,12),Array.from(doubles(ms,4))],mdBefore);
  assert.equal(e.md_force(mc,ms,mp,mf),0);assert.deepEqual(bits(mf,12),mdBefore[2]);
  assert.equal(e.md_step(mc,ms,mp,mv,mf,mu),0);
  assert.equal(e.md_diffusion(0,0,0,2,.2,mDiff),0);assert.deepEqual(Array.from(doubles(mDiff,5)),[0,0,0,0,0]);
  console.log('MD: native/WASM NVE/NVT/NPT, 2D/3D, 1–4 step batches, complete fields/stats/RDF/diffusion match exactly; original TS fixture and ABI memory checks pass.');
  {
  const particlesNative=join(scratch,'particles-reference');
  rustc([fileURLToPath(new URL('./particles-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${nativeLib}`,'-O','-C','panic=abort','-o',particlesNative]);
  const particlesGolden=JSON.parse(readFileSync(new URL('./particles-reference.json',import.meta.url),'utf8'));
  const screening=alloc(24),charge=alloc(16),sigma=alloc(16),epsilon=alloc(16),particleStats=alloc(80);
  const screen=doubles(screening,3);
  const initParticles=()=>e.particles_init(mc,ms,screening,mp,mv,mf,mu,charge,sigma,epsilon);
  const batchParticles=(count,target=0,enabled=0)=>e.particles_batch(mc,ms,screening,mp,mv,mf,mu,charge,sigma,epsilon,target,enabled,count);
  const readParticles=()=>e.particles_read(mc,ms,m0,mv,mu,charge,mSpeed,particleStats);
  let maxParticleScalarDifference=0;
  for(const name of ['nve','nvt','neutral','no-coulomb','three']){
    const nativeResult=JSON.parse(execFileSync(particlesNative,[name],{encoding:'utf8',timeout:10000}));
    const golden=particlesGolden[name],dim=golden.dim,len=4*dim;
    for(const key of ['initialPos','initialVel','charge','sigma','epsilon','pos','vel','force','unwrapped','speed','r','g'])assert.deepEqual(nativeResult[key],golden[key],`${name} particles ${key} matches original TS`);
    for(const key of ['state','stats','rdf'])nativeResult[key].forEach((v,i)=>{
      compareFinite(v,golden[key][i],`${name} particles original TS ${key}[${i}]`);
      maxParticleScalarDifference=Math.max(maxParticleScalarDifference,Math.abs(v-golden[key][i]));
    });
    cp.setUint32(4,dim,true);doubles(ms,4).set([8,0,0,0]);screen.set([3.2,.9,name==='no-coulomb'?0:.7]);
    for(const [ptr,key]of [[mp,'initialPos'],[m0,'initialPos'],[mv,'initialVel'],[charge,'charge'],[sigma,'sigma'],[epsilon,'epsilon']])new Uint32Array(e.memory.buffer,ptr,golden[key].length).set(golden[key]);
    assert.equal(initParticles(),0);let completed=0,at=0;
    for(const count of [4,1,2,3]){
      assert.equal(batchParticles(count,name==='nvt'?.4:0,name==='nvt'?1:0),0);assert.equal(readParticles(),0);completed+=count;
      assert.deepEqual({time:completed*.005,msd:doubles(particleStats,10)[5]},nativeResult.history[at++]);
    }
    for(const [key,ptr,n]of [['pos',mp,len],['vel',mv,len],['force',mf,len],['unwrapped',mu,len],['speed',mSpeed,4]])assert.deepEqual(bits(ptr,n),nativeResult[key],`${name} particles native/WASM ${key}`);
    assert.deepEqual(Array.from(doubles(ms,4)),nativeResult.state);
    assert.deepEqual(Array.from(doubles(particleStats,10)),nativeResult.stats);
    assert.equal(e.md_rdf(mc,ms,mp,8,4,mh,mr,mg,mRdf),0);
    assert.deepEqual(bits(mr,8),nativeResult.r);assert.deepEqual(bits(mg,8),nativeResult.g);assert.deepEqual(Array.from(doubles(mRdf,2)),nativeResult.rdf);
  }
  const particleSnapshot=()=>[bits(mp,12),bits(mv,12),bits(mf,12),bits(mu,12),Array.from(doubles(ms,4))];
  const particleBefore=particleSnapshot();
  for(const call of [
    ()=>e.particles_init(mc,ms,screening,mp,mv,mf,mu,0,sigma,epsilon),
    ()=>e.particles_init(mc,ms,mc,mp,mv,mf,mu,charge,sigma,epsilon),
    ()=>e.particles_step(mc,ms,screening,mp,mv,mf,mu,mf,sigma,epsilon),
    ()=>e.particles_batch(mc,ms,screening,mp,mv,mf,mu,charge,charge,epsilon,0,0,1),
    ()=>e.particles_force(mc,ms,screening,mp,mf,charge,sigma,sigma),
    ()=>e.particles_force(mc,ms,screening,mp,mf,charge+1,sigma,epsilon),
    ()=>e.particles_force(mc,ms,screening,mp,mf,charge,sigma,e.memory.buffer.byteLength-4),
    ()=>e.particles_read(mc,ms,m0,mv,mu,charge,charge,particleStats),
    ()=>e.particles_read(mc,ms,m0,mv,mu,charge,mSpeed,ms),
    ()=>e.particles_force(mc,ms,screening,mp,screening,charge,sigma,epsilon),
  ])assert.equal(call(),2,'particle memory validation must reject before mutation');
  for(const count of [0,5,50])assert.equal(batchParticles(count),3);
  assert.equal(batchParticles(1,0,2),7);assert.equal(batchParticles(1,NaN,0),7);assert.equal(batchParticles(1,-0,0),7);
  assert.equal(batchParticles(1,-1,1),3);assert.equal(batchParticles(1,Infinity,1),3);
  for(const [ptr,bad]of [[charge,NaN],[sigma,0],[sigma,-1],[epsilon,-1]]){
    const previous=floats(ptr,4)[0];floats(ptr,4)[0]=bad;assert.equal(initParticles(),Number.isNaN(bad)?4:3);floats(ptr,4)[0]=previous;
  }
  for(const [i,bad]of [[0,NaN],[1,Infinity],[2,-1]]){const previous=screen[i];screen[i]=bad;assert.equal(initParticles(),3);screen[i]=previous;}
  assert.deepEqual(particleSnapshot(),particleBefore);
  assert.equal(e.particles_force(mc,ms,screening,mp,mf,charge,sigma,epsilon),0);assert.deepEqual(particleSnapshot(),particleBefore);
  assert.equal(e.particles_step(mc,ms,screening,mp,mv,mf,mu,charge,sigma,epsilon),0);
  const stepped=particleSnapshot();
  for(const [i,ptr]of [mp,mv,mf,mu].entries())new Uint32Array(e.memory.buffer,ptr,12).set(particleBefore[i]);doubles(ms,4).set(particleBefore[4]);
  assert.equal(batchParticles(1),0);assert.deepEqual(particleSnapshot(),stepped);
  console.log(`Particles: native/WASM NVE/NVT, mixed/neutral charges, zero Coulomb, 2D/3D and 1–4-step batches match all fields/statistics/RDF bits; original TS f32 exact, max scalar difference ${maxParticleScalarDifference}; invalid memory/parameters rejected.`);
  }
  // Independent 175-cell pressure-force oracles. No production geometry or force reducer reused.
  for (const scenario of ['rest-grounded', 'rest-closed-surface', 'pressure-plus', 'pressure-minus', 'pressure-gradient']) {
    const gauge = new WebAssembly.Instance(module).exports;
    gauge.memory.grow(2);
    let head = gauge.heap_base();
    const take = bytes => { head = Math.ceil(head / 8) * 8; const ptr = head; head += bytes; return ptr; };
    const n = 175, cp = take(1888), mask = take(n), pop = take(n * 19 * 4), post = take(n * 19 * 4), vel = take(n * 3 * 4), rho = take(n * 4), stats = take(152);
    const view = new DataView(gauge.memory.buffer, cp, 1888);
    for (const [offset, value] of [[0,7],[4,5],[8,5],[12,0],[16,1],[56,11],[244,1]]) view.setUint32(offset,value,true);
    view.setFloat64(24,.8,true);
    const flags = new Uint8Array(gauge.memory.buffer,mask,n);
    const pressure = scenario.startsWith('pressure-');
    if (pressure) flags[3+7*5*2] = 1;
    else for(let x=2;x<=4;x++) for(let y=scenario==='rest-grounded'?0:2;y<=(scenario==='rest-grounded'?1:3);y++) flags[x+7*(y+5*2)]=1;
    assert.equal(gauge.d3q19_init(cp,mask,pop,post,vel,rho,0,0,0,0),0);
    if(pressure) {
      const f = new Float32Array(gauge.memory.buffer,pop,n*19);
      for(let cell=0;cell<n;cell++) {
        const density = scenario==='pressure-plus'?1+1/32:scenario==='pressure-minus'?1-1/32:cell%7<3?1+1/32:cell%7>3?1-1/32:1;
        for(let q=0;q<19;q++)f[cell*19+q]=density*(q===0?1/3:q<7?1/18:1/36);
      }
    }
    for(let step=1;step<=(pressure?1:2);step++) {
      assert.equal(gauge.d3q19_step(cp,mask,pop,post,vel,rho,0,0,0,0,step,stats),0);
      const force=Array.from(new Float64Array(gauge.memory.buffer,stats,3));
      const expected=scenario==='pressure-plus'?[0,-1/96,0]:scenario==='pressure-minus'?[0,1/96,0]:scenario==='pressure-gradient'?[5/288,0,0]:[0,0,0];
      if(pressure)force.forEach((v,axis)=>assert(Math.abs(v-expected[axis])<2e-7,scenario+' gauge force'));
      else assert.deepEqual(force,expected,scenario+' exact rest gauge force');
    }
  }
  // Public ABI inlet cases: independent moments and complete native/WASM bits.
  for (const scenario of ['inlet-shear', 'inlet-density', 'inlet-blocked']) {
    const kernel = new WebAssembly.Instance(module).exports;
    kernel.memory.grow(3);
    let head = kernel.heap_base();
    const take = bytes => { head = Math.ceil(head / 8) * 8; const ptr = head; head += bytes; return ptr; };
    const n=175, cp=take(1888), mask=take(n), pop=take(n*19*4), post=take(n*19*4), vel=take(n*3*4), rho=take(n*4), stats=take(152);
    const config=new DataView(kernel.memory.buffer,cp,1888);
    for(const [offset,value] of [[0,7],[4,5],[8,5],[16,1],[56,11]])config.setUint32(offset,value,true);
    config.setFloat64(24,.8,true);config.setFloat64(32,.04,true);
    const init=()=>kernel.d3q19_init(cp,mask,pop,post,vel,rho,0,0,0,0);
    const step=()=>kernel.d3q19_step(cp,mask,pop,post,vel,rho,0,0,0,0,1,stats);
    assert.equal(init(),0);
    const flags=new Uint8Array(kernel.memory.buffer,mask,n), f=new Float32Array(kernel.memory.buffer,pop,n*19);
    if(scenario==='inlet-blocked'){
      flags[1+7*(2+5*2)]=1;
      const before=f.slice();assert.equal(step(),5);assert.deepEqual(f,before);
      assert.equal(init(),5);assert.deepEqual(f,before);
      flags[7*(2+5*2)]=1;assert.equal(init(),0);assert.equal(step(),0);continue;
    }
    const c=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
    for(let cell=0;cell<n;cell++){
      const density=scenario==='inlet-density'&&cell%7===2?1.03:1;
      const u=[.04,scenario==='inlet-shear'?.003*(cell%7):0,0];
      for(let q=0;q<19;q++){
        const w=q===0?1/3:q<7?1/18:1/36, cu=c[q].reduce((a,d,i)=>a+d*u[i],0), u2=u.reduce((a,v)=>a+v*v,0);
        f[cell*19+q]=w*density*(1+3*cu+4.5*cu*cu-1.5*u2);
      }
    }
    assert.equal(step(),0);
    const oracle=JSON.parse(execFileSync(native,[scenario],{encoding:'utf8',timeout:10000}));
    for(const [name,ptr,len] of [['f',pop,n*19],['post',post,n*19],['velocity',vel,n*3],['density',rho,n]]){
      assert.deepEqual(Array.from(new Uint32Array(kernel.memory.buffer,ptr,len)),oracle[name],scenario+' '+name+' native/WASM bits');
    }
    assert.deepEqual(Array.from(new Float64Array(kernel.memory.buffer,stats,5)),oracle.stats);
    assert.deepEqual(Array.from(new Float64Array(kernel.memory.buffer,stats+96,7)),oracle.massBalance,'seven independently measured native/WASM mass terms');
    const pressureFrame=take(n*3*4);
    assert.equal(kernel.d3q19_display(cp,vel,mask,0,pop,pressureFrame),0);
    assert.deepEqual(Array.from(new Uint32Array(kernel.memory.buffer,pressureFrame,n*3)),oracle.pressureDisplay,'current-stream pressure frame native/WASM bits');
    const inlet=7*(2+5*2), u=new Float32Array(kernel.memory.buffer,vel,n*3), density=new Float32Array(kernel.memory.buffer,rho,n);
    const extra=scenario==='inlet-density'?.03*(1-3*.04+3*.04**2)/6:0;
    assert(Math.abs(density[inlet]-(1+extra))<1e-7);
    assert(Math.abs(u[inlet*3]-.04)<3e-8 && Math.abs(u[inlet*3+1])<1e-8);
    let xy=0;for(let q=0;q<19;q++)xy+=c[q][0]*c[q][1]*f[inlet*19+q];
    assert(Math.abs(xy-density[inlet]*u[inlet*3]*u[inlet*3+1]-(scenario==='inlet-shear'?.003*(.04**2-1/3):0))<1e-8);
  }
  // Independent outlet moments/heat oracles, 175 cells and one step each.
  for (const scenario of ['shear', 'density-pulse', 'blocked-neighbor', 'hot-outflow', 'ambient-inflow', 'inlet-hot-backflow', 'inlet-ambient-flow']) {
    const kernel = new WebAssembly.Instance(module).exports;
    kernel.memory.grow(3);
    let head = kernel.heap_base();
    const take = bytes => { head = Math.ceil(head / 8) * 8; const ptr = head; head += bytes; return ptr; };
    const n=175, cp=take(1888), mask=take(n), pop=take(n*19*4), post=take(n*19*4), vel=take(n*3*4), rho=take(n*4), stats=take(152);
    const inletThermal=scenario.startsWith('inlet-');
    const thermal=inletThermal||scenario==='hot-outflow'||scenario==='ambient-inflow';
    const energy=thermal?take(n*8):0, next=thermal?take(n*8):0, temperature=thermal?take(n*8):0, mass=thermal?take(n*8):0;
    const config=new DataView(kernel.memory.buffer,cp,1888);
    for(const [offset,value] of [[0,7],[4,5],[8,5],[16,1],[56,11]]) config.setUint32(offset,value,true);
    config.setFloat64(24,.8,true);config.setFloat64(32,.04,true);
    if(thermal){
      for(const [offset,value] of [[60,1],[224,1],[228,128]])config.setUint32(offset,value,true);
      for(const [offset,value] of [[136,.01],[144,25],[160,.1],[168,1],[176,10],[184,.01],[192,2],[200,20],[208,.1],[232,1]])config.setFloat64(offset,value,true);
    }
    const flags=new Uint8Array(kernel.memory.buffer,mask,n);
    if(thermal)flags[inletThermal?6:0]=4;
    const init=()=>kernel.d3q19_init(cp,mask,pop,post,vel,rho,energy,next,temperature,mass);
    const step=()=>kernel.d3q19_step(cp,mask,pop,post,vel,rho,energy,next,temperature,mass,1,stats);
    assert.equal(init(),0);
    const f=new Float32Array(kernel.memory.buffer,pop,n*19);
    if(scenario==='blocked-neighbor'){
      flags[5+7*(2+5*2)]=1;
      const before=f.slice();assert.equal(step(),5);assert.deepEqual(f,before);
      assert.equal(init(),5);assert.deepEqual(f,before);continue;
    }
    const c=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
    const delta=scenario==='ambient-inflow'||scenario==='inlet-ambient-flow'?-.3:inletThermal?.3:.03;
    for(let cell=0;cell<n;cell++){
      const ux=.04+(scenario==='shear'?.003*(Math.floor(cell/7)%5-2):0);
      const density=cell%7===(inletThermal?1:thermal?5:4)&&scenario!=='shear'?1+delta:1;
      for(let q=0;q<19;q++){
        const w=q===0?1/3:q<7?1/18:1/36, cu=c[q][0]*ux;
        f[cell*19+q]=w*density*(1+3*cu+4.5*cu*cu-1.5*ux*ux);
      }
      if(thermal&&flags[cell]===0){
        const m=f.slice(cell*19,(cell+1)*19).reduce((a,b)=>a+b,0)*.001;
        new Float64Array(kernel.memory.buffer,mass,n)[cell]=m;
        new Float64Array(kernel.memory.buffer,energy,n)[cell]=(inletThermal?cell%7===1:cell%7>=4)?m*10*3:0;
      }
    }
    const before=thermal?new Float64Array(kernel.memory.buffer,energy,n).reduce((a,b)=>a+b,0):0;
    assert.equal(step(),0);
    const velocity=new Float32Array(kernel.memory.buffer,vel,n*3), density=new Float32Array(kernel.memory.buffer,rho,n);
    const inner=5+7*(2+5*2), outlet=inner+1;
    assert(Math.abs(density[outlet]-1)<1e-7,'fixed outlet density');
    if(inletThermal){
      const output=new Float64Array(kernel.memory.buffer,stats,12),u=.04;
      const into=u-delta*(1-3*u+3*u*u)/6,out=u+delta*(1+3*u+3*u*u)/6;
      const remaining=1+delta-Math.max(-into,0)-Math.max(out,0),streamedRho=1+delta+into-out;
      const mixed=3*remaining/streamedRho;
      const expected=-25*.001*10*3*Math.max(-into,0)-25*.01*(.01*.1)*mixed;
      assert.equal(output[11],1,'one thermal substep');
      assert(Math.abs(output[7]-expected)<1e-7,'analytic warm inlet backflow/conduction');
      assert(Math.abs(output[5]-before-expected)<1e-7,'total sensible energy budget');
      assert(Math.abs(output[8])<2e-14,'inlet energy ledger residual');
      const m=new Float64Array(kernel.memory.buffer,mass,n),energyView=new Float64Array(kernel.memory.buffer,energy,n);
      for(let i=0;i<n;i+=7){assert(Math.abs(m[i]-.001*streamedRho)<1e-10);assert.equal(energyView[i],0)}
    }else if(thermal){
      const output=new Float64Array(kernel.memory.buffer,stats,12);
      const outward=.04+delta*(1+3*.04+3*.04**2)/6;
      const expected=-25*.001*10*3*Math.max(outward,0);
      assert(Math.abs(output[7]-expected)<1e-7,'analytic ambient/hot outlet energy');
      assert(Math.abs(output[5]-before-expected)<1e-7,'analytic total sensible energy');
      assert(Math.abs(output[8])<2e-14,'energy ledger residual');
      for(let i=6;i<n;i+=7)assert(Math.abs(new Float64Array(kernel.memory.buffer,mass,n)[i]-.001)<1e-10);
    }else{
      const a=.03*(1+3*.04+3*.04**2)/6;
      const expected=scenario==='shear'?.04:(.04+a)/(1+a);
      for(const cell of [inner,outlet]){
        assert(Math.abs(velocity[cell*3]-expected)<3e-8,'current-stream analytic velocity');
        let pxy=0;for(let q=0;q<19;q++)pxy+=c[q][0]*c[q][1]*f[cell*19+q];
        const stress=pxy-density[cell]*velocity[cell*3]*velocity[cell*3+1];
        assert(Math.abs(stress-(scenario==='shear'?-.001:0))<1e-8,'streamed analytic shear moment');
      }
    }
  }
  // Zero-step, independently constructed binary-exact pressure oracles.
  {
    const k=new WebAssembly.Instance(module).exports;k.memory.grow(2);let cursor=k.heap_base();
    const take=n=>{cursor=(cursor+7)&~7;const p=cursor;cursor+=n;return p;};
    const n=63,cp=take(1888),mask=take(n),velocity=take(n*3*4),pop=take(n*19*4),frame=take(n*3*4),guard=take(8);
    const config=new DataView(k.memory.buffer,cp,1888);
    for(const [offset,value]of [[0,7],[4,3],[8,3],[16,1],[56,11]])config.setUint32(offset,value,true);
    config.setFloat64(24,.8,true);
    const flags=new Uint8Array(k.memory.buffer,mask,n),f=new Float32Array(k.memory.buffer,pop,n*19),u=new Float32Array(k.memory.buffer,velocity,n*3);
    const reference=Array.from({length:19},(_,q)=>Math.fround(q===0?1/3:q<7?1/18:1/36));
    for(let cell=0;cell<n;cell++)f.set(reference,cell*19);
    flags[6]=1;u[5*3]=.04;f[19]+=3/1024;f[38]-=3/1024;f[3*19+1]+=3*2**-27;f[3*19+2]+=3*2**-27;
    for(const q of [7,8])f[4*19+q]+=2**-20;for(const q of [9,10])f[4*19+q]-=2**-20;
    new Uint8Array(k.memory.buffer,guard,8).fill(0xa5);
    const before=f.slice();const show=(p=pop,out=frame)=>k.d3q19_display(cp,velocity,mask,0,p,out);
    assert.equal(show(),0);const output=new Float32Array(k.memory.buffer,frame,n*3);
    assert.deepEqual(Array.from({length:7},(_,i)=>output[i*3+2]),[0,1/1024,-1/1024,2**-26,0,0,0]);
    assert.deepEqual(f,before);assert(new Uint8Array(k.memory.buffer,guard,8).every(v=>v===0xa5));
    const legacy=take(n*2*4);assert.equal(show(0,legacy),0);const old=new Float32Array(k.memory.buffer,legacy,n*2);
    for(let cell=0;cell<n;cell++)assert.deepEqual(output.slice(cell*3,cell*3+2),old.slice(cell*2,cell*2+2));
    for(const invalid of [1,pop+1,k.memory.buffer.byteLength-4])assert.equal(show(invalid),2);
    assert.equal(show(pop,pop),2);assert.equal(show(pop,velocity),2);
    assert.equal(show(pop,k.memory.buffer.byteLength-n*2*4),2,'pressure needs 3N, not old 2N floats');
    f[0]=NaN;assert.equal(show(),4);assert(Number.isNaN(f[0]));f[0]=reference[0];assert.equal(show(),0);
    config.setUint32(56,10,true);assert.equal(show(),7);config.setUint32(56,11,true);assert.equal(show(),0);
  }
  console.log('WASM ABI11: native/WASM wave, heat, isothermal/fan D3Q19 fields, gauge pressure-force and non-equilibrium inlet/outlet oracles, conservative solid-power/fixed-wall heat and display match exactly; invalid memory/configuration checks passed.');

} finally {
  rmSync(scratch, { recursive: true, force: true });
}

await import('./fluid-tests.mjs');
await import('./mac-projection-tests.mjs');
await import('./fan-curve-tests.mjs');
await import('./mac-step-tests.mjs');
await import('./mac-thermal-tests.mjs');

await import('./mac-fan-tests.mjs');
await import('./mac-fields-tests.mjs');

await import('./ising-tests.mjs');

await import('./ode-tests.mjs');

await import('./optics-tests.mjs');

await import('./plane-tests.mjs');

await import('./antenna-tests.mjs');

await import('./detection-tests.mjs');

await import('./sensing-tests.mjs');

await import('./rc-sampling-tests.mjs');
await import('./transient-tests.mjs');

await import('./faraday-tests.mjs');

await import('./thermal-tests.mjs');

await import('./geometry-tests.mjs');

await import('./d3q19-tests.mjs');

await import('./md-tests.mjs');

await import('./fdtd-tests.mjs');
