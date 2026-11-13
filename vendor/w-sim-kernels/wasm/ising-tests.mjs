// Golden observations only: no retained JS Ising/RNG numerical implementation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../..',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'w-sim-ising-'));
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ising-original-ts.json.gz',import.meta.url))));
const generated=readFileSync(join(root,'packages/solvers-lbm/src/wasm-kernel.ts'),'utf8');
const module=new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1],'base64'));
const close=(got,want,label)=>assert(Math.abs(got-want)<=3e-11,`${label}: ${got} vs ${want}`);
let maxReferenceDifference=0;
try {
 const lib=join(scratch,'libw_sim_kernels.rlib'),native=join(scratch,'reference');
 const rustc=args=>execFileSync('rustc',args,{stdio:'inherit',timeout:60000});
 rustc([join(root,'crates/w-sim-kernels/src/lib.rs'),'--edition','2021','--crate-name','w_sim_kernels','--crate-type','rlib','-O','-C','panic=abort','-o',lib]);
 rustc([fileURLToPath(new URL('./ising-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${lib}`,'-O','-C','panic=abort','-o',native]);
 const cases=[...fixture.cases.map(c=>({...c,steps:c.steps.map(s=>({...s,sample:0,reset:0}))})),...fixture.scenes.map(c=>({
  ...c.scene,algorithm:0,initial:{spins:Buffer.from(c.steps[0].result.spins).toString('base64'),rng:c.steps[0].rng},
  steps:c.steps.slice(1).map((s,i)=>({temperature:s.result.current.temperature,spins:Buffer.from(s.result.spins).toString('base64'),rng:s.rng,magnetization:s.result.magnetization,energy:s.result.energy,reference:s.result.current.reference,sample:Number(i%(c.scene.burnIn+c.scene.samples)>=c.scene.burnIn),reset:Number(i%(c.scene.burnIn+c.scene.samples)===0),moments:s.moments,point:s.result.current}))
 }))];
 for(const c of cases){
  const n=c.size*c.size,e=new WebAssembly.Instance(module).exports,cp=(e.heap_base()+7)&~7,rng=cp+16,mom=cp+24,out=cp+72,spins=cp+152,end=spins+n;
  if(end>e.memory.buffer.byteLength)e.memory.grow(Math.ceil((end-e.memory.buffer.byteLength)/65536));
  const v=new DataView(e.memory.buffer),memory=new Uint8Array(e.memory.buffer);
  v.setUint32(cp,c.size,true);v.setFloat64(cp+8,c.steps[0].temperature,true);
  const input=Buffer.alloc(32+c.steps.length*16);input.writeUInt32LE(c.size,0);input.writeUInt32LE(c.seed,4);input.writeUInt32LE(Number(c.hot),8);input.writeUInt32LE(c.algorithm,12);input.writeUInt32LE(c.steps.length,16);input.writeDoubleLE(c.steps[0].temperature,24);
  for(const[i,s]of c.steps.entries()){const p=32+i*16;input.writeDoubleLE(s.temperature,p);input.writeUInt32LE(s.sample,p+8);input.writeUInt32LE(s.reset,p+12);}
  const file=join(scratch,'input');writeFileSync(file,input);const expected=execFileSync(native,[file],{timeout:10000,maxBuffer:2*1024*1024});
  const row=n+4+48+80;
  function check(step,golden){
   assert.equal(e.ising_read(cp,spins,mom,out),0);
   const got=Buffer.concat([Buffer.from(memory.slice(spins,spins+n)),Buffer.from(memory.slice(rng,rng+4)),Buffer.from(memory.slice(mom,mom+48)),Buffer.from(memory.slice(out,out+80))]);
   assert.deepEqual(got,expected.subarray(step*row,(step+1)*row),`${c.size}/${c.algorithm}/${step}: native/WASM spins/RNG/moments/readout exact`);
   assert.deepEqual(Buffer.from(memory.slice(spins,spins+n)),Buffer.from(golden.spins,'base64'),'old JS spins exact');assert.equal(v.getUint32(rng,true),golden.rng,'old JS RNG exact');
   if(golden.energy!==undefined){assert.equal(v.getFloat64(out,true),golden.magnetization);assert.equal(v.getFloat64(out+8,true),golden.energy);close(v.getFloat64(out+64,true),golden.reference,'reference');maxReferenceDifference=Math.max(maxReferenceDifference,Math.abs(v.getFloat64(out+64,true)-golden.reference));}
   if(golden.moments){assert.deepEqual(Array.from(new Float64Array(e.memory.buffer,mom,6)),Object.values(golden.moments),'old JS moment sums exact');
    const p=golden.point;assert.deepEqual(Array.from(new Float64Array(e.memory.buffer,out+16,6)),[p.samples,p.meanM??0,p.meanAbsM??0,p.meanEnergy??0,p.specificHeat??0,p.susceptibility??0],'old JS fluctuations and null encoding exact');}
  }
  assert.equal(e.ising_init(cp,spins,rng,c.seed,Number(c.hot)),0);check(0,c.initial);
  for(const[i,s]of c.steps.entries()){v.setFloat64(cp+8,s.temperature,true);assert.equal(e.ising_sweep(cp,spins,rng,mom,c.algorithm,s.sample,s.reset),0);check(i+1,s);}
  const tc=fixture.tc,bits=new BigUint64Array(new Float64Array([tc]).buffer);bits[0]--;const near=new Float64Array(bits.buffer)[0];
  const references=[-1,0,2.2250738585072014e-308,.5,1,2,2.2,tc-1e-6,near,tc,Number.MAX_VALUE];
  for(const[i,t]of references.entries()){assert.equal(e.ising_reference(t,out),0);assert.equal(v.getFloat64(out,true),tc);assert.deepEqual(Buffer.from(memory.slice(out+8,out+16)),expected.subarray(row*(c.steps.length+1)+i*8,row*(c.steps.length+1)+(i+1)*8),'reference native/WASM exact');}
  for(const[t,want]of fixture.references){assert.equal(e.ising_reference(t,out),0);const got=v.getFloat64(out+8,true);close(got,want,'old reference curve');maxReferenceDifference=Math.max(maxReferenceDifference,Math.abs(got-want));}
  // Fail before mutation on invalid dimensions, alias, range and state.
  for(const call of [()=>e.ising_init(cp,cp,rng,0,1),()=>e.ising_init(cp+4,spins,rng,0,1),()=>e.ising_sweep(cp,spins,spins,mom,0,0,0),()=>e.ising_sweep(cp,spins,rng,spins,0,0,0),()=>e.ising_sweep(cp,spins,rng,0,0,1,0),()=>e.ising_read(cp,spins,mom,mom),()=>e.ising_read(cp,spins,mom,spins),()=>e.ising_delta(cp,spins,0,cp),()=>e.ising_next(rng,rng),()=>e.ising_reference(2,e.memory.buffer.byteLength-8),()=>e.ising_read(cp,spins,0,out)])assert.equal(call(),2);
  for(const[t,code]of [[0,3],[-1,3],[NaN,3],[Infinity,3]]){v.setFloat64(cp+8,t,true);assert.equal(e.ising_sweep(cp,spins,rng,mom,0,0,0),code);}v.setFloat64(cp+8,2,true);
  for(const size of [0,1,46341,0xffffffff]){v.setUint32(cp,size,true);assert.equal(e.ising_sweep(cp,spins,rng,mom,0,0,0),1);}v.setUint32(cp,c.size,true);
  v.setUint32(cp+4,1,true);assert.equal(e.ising_sweep(cp,spins,rng,mom,0,0,0),7);v.setUint32(cp+4,0,true);
  assert.equal(e.ising_init(cp,spins,rng,0,2),7);assert.equal(e.ising_sweep(cp,spins,rng,mom,2,0,0),7);assert.equal(e.ising_sweep(cp,spins,rng,mom,0,2,0),7);assert.equal(e.ising_sweep(cp,spins,rng,mom,0,0,2),7);
  const spin=memory[spins];memory[spins]=0;assert.equal(e.ising_sweep(cp,spins,rng,mom,0,0,0),5);memory[spins]=spin;
  const count=v.getFloat64(mom,true);for(const bad of [NaN,Infinity]){v.setFloat64(mom,bad,true);assert.equal(e.ising_sweep(cp,spins,rng,mom,0,0,0),4);}v.setFloat64(mom,.5,true);assert.equal(e.ising_read(cp,spins,mom,out),5);v.setFloat64(mom,count,true);
  assert.equal(e.ising_delta(cp,spins,n,out),1);assert.equal(e.ising_delta(cp,spins,0,out),0);assert.equal(e.ising_reference(NaN,out),4);assert.equal(e.ising_reference(Infinity,out),4);
  for(const kind of [0,1]){assert.equal(e.ising_fluctuation(1,2,64,2,kind,out),0);assert.equal(v.getFloat64(out,true),kind?32:16);}
  assert.equal(e.ising_fluctuation(0,1,64,0,0,out),3);assert.equal(e.ising_fluctuation(NaN,1,64,2,0,out),4);assert.equal(e.ising_fluctuation(0,1,64,2,2,out),7);
  // rand() advances precisely one persistent draw, also across u32 rollover.
  for(const seed of [0,0xffffffff]){v.setUint32(rng,seed,true);assert.equal(e.ising_next(rng,out),0);assert.equal(v.getUint32(rng,true),(seed+0x6d2b79f5)>>>0);assert(v.getFloat64(out,true)>=0&&v.getFloat64(out,true)<1);}
  assert.equal(e.ising_sweep(cp,spins,rng,0,0,0,0),0,'optional moments for unobserved helper');
 }
 console.log(`Ising: ${cases.length} captured hot/cold/seed0/u32max/changing-T cases, both algorithms; old spins/RNG/moments exact, native/WASM entire state and references exact; max old-reference absolute difference ${maxReferenceDifference}; bad memory/configuration/state rejected.`);
} finally {rmSync(scratch,{recursive:true,force:true});}
