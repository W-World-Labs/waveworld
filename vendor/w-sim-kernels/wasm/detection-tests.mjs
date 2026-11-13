// Captured scene/source/readout fixtures, shared native/WASM execution only.
// Goldens were re-captured from the e447b93a kernel rewrite (radar TMz FDTD,
// laser RK4, nljd Shockley junction + DFT); see `note` in the fixture.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../..',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'w-sim-detection-'))
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/detection-original-ts.json.gz',import.meta.url))))
const binary=Buffer.from(readFileSync(join(root,'packages/solvers-lbm/src/wasm-kernel.ts'),'utf8').match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1],'base64'),module=new WebAssembly.Module(binary)
const kinds=['semiconductor','corrosion','metal'],params=p=>[p.tauN,p.tauC,p.B,p.spont],cases=[]
for(const f of fixture.radar)cases.push({op:0,f})
for(const f of fixture.range)cases.push({op:1,f,p:[f.p.pt,f.p.gt,f.p.gr,f.p.lambda,f.p.sigma,f.p.sMin]})
for(const f of fixture.laser)cases.push({op:2,f,p:[...params(f.p),f.pump,f.dt,...[f.states[0].N,f.states[0].S]]})
for(const f of fixture.characteristics)cases.push({op:3,f,p:[1,.05,.02,1e-4,f.pump]})
for(const f of fixture.nljd)cases.push({op:4,f,kind:kinds.indexOf(f.kind)})
for(const f of fixture.nonlinear)cases.push({op:5,f,p:[f.a2,f.a3]})
for(const f of fixture.classify)cases.push({op:6,f,p:[f.h.f1,f.h.f2,f.h.f3]})
let maxRange=0,maxSteady=0
try{
 const lib=join(scratch,'libw_sim_kernels.rlib'),native=join(scratch,'reference'),file=join(scratch,'input')
 execFileSync('rustc',[join(root,'crates/w-sim-kernels/src/lib.rs'),'--edition','2021','--crate-name','w_sim_kernels','--crate-type','rlib','-O','-C','panic=abort','-o',lib],{stdio:'inherit',timeout:60000})
 execFileSync('rustc',[fileURLToPath(new URL('./detection-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${lib}`,'-O','-C','panic=abort','-o',native],{stdio:'inherit',timeout:60000})
 for(const c of cases){
  const e=new WebAssembly.Instance(module).exports,cp=(e.heap_base()+7)&~7,state=cp+64,out=cp+112,data=cp+208,f0=data,f1=f0+160000,mask=f1+160000,traces=mask+40000,end=traces+8192
  if(c.op===0&&end>e.memory.buffer.byteLength)e.memory.grow(Math.ceil((end-e.memory.buffer.byteLength)/65536))
  const bytes=new Uint8Array(e.memory.buffer),view=new DataView(e.memory.buffer),d=(p,n)=>new Float64Array(e.memory.buffer,p,n),words=(p,n)=>new Uint32Array(e.memory.buffer,p,n)
  const input=Buffer.alloc(c.op===0?88+320000+8192:80);input.writeUInt32LE(c.op,0);input.writeUInt32LE(c.kind??(c.op===2?c.f.states.length-1:0),4);(c.p??[]).forEach((v,i)=>input.writeDoubleLE(v,16+i*8))
  let chunks,got
  if(c.op===0){
   const s=c.f.scene;input.writeUInt32LE(s.steps,16);input.writeUInt32LE(s.mode==='cw'?1:0,20);s.probes.forEach((p,i)=>input.writeUInt32LE(p?p.x+p.y*200:0xffffffff,24+i*4));bytes.set(input.subarray(16,48),cp)
   if(c.f.initial){const init=c.f.initial;input.writeUInt32LE(1,8);input.writeUInt32LE(init.completed,48);init.traces.forEach((trace,ch)=>{input.writeUInt32LE(trace.length,56+ch*4);trace.forEach((v,i)=>input.writeDoubleLE(v,88+320000+ch*2048+i*8))});Buffer.from(init.field,'base64').copy(input,88);Buffer.from(init.previous,'base64').copy(input,88+160000)}
   const reset=()=>{assert.equal(e.radar_init(cp,state,f0,f1,mask,traces),0);if(c.f.initial){bytes.set(input.subarray(48,88),state);bytes.set(input.subarray(88,88+320000),f0);bytes.set(input.subarray(88+320000),traces)}}
   const advance=n=>e.radar_advance(cp,state,f0,f1,mask,traces,n)
   reset();while(words(state,1)[0]<s.steps)assert.equal(advance(Math.min(2,s.steps-words(state,1)[0])),0)
   assert.equal(e.radar_read(state,traces,out),0);chunks=[[state,40],[f0,320000],[mask,40000],[traces,8192],[out,96]]
   got=Buffer.concat(chunks.map(([p,n])=>Buffer.from(bytes.slice(p,p+n))))
   const current=words(state,2)[1]===0?f0:f1,previous=current===f0?f1:f0
   assert.deepEqual(Buffer.from(bytes.slice(current,current+160000)),Buffer.from(c.f.field,'base64'),'old JS radar current f32 bits')
   assert.deepEqual(Buffer.from(bytes.slice(previous,previous+160000)),Buffer.from(c.f.previous,'base64'),'old JS radar previous f32 bits')
   assert.deepEqual(Buffer.from(bytes.slice(mask,mask+40000)),Buffer.from(fixture.mask,'base64'),'original fixed obstacle geometry')
   const lengths=words(state+8,4),heads=words(state+24,4),chronological=Array.from({length:4},(_,ch)=>Array.from({length:lengths[ch]},(_,i)=>d(traces,1024)[ch*256+(heads[ch]+i)%256]))
   assert.deepEqual(chronological,c.f.traces,'old JS chronological trace values and sample count')
   assert.deepEqual(Array.from(d(out,12)),c.f.readout.flatMap(r=>r?[r.v,r.pp,1]:[0,0,0]))
   reset();while(words(state,1)[0]<s.steps)assert.equal(advance(Math.min(8,s.steps-words(state,1)[0])),0);assert.equal(e.radar_read(state,traces,out),0);assert.deepEqual(Buffer.concat(chunks.map(([p,n])=>Buffer.from(bytes.slice(p,p+n)))),got,'2-step and 8-step chunks exact')
   const snapshot=Buffer.from(bytes.slice(cp,end));for(const call of [()=>e.radar_init(cp,state,f0,f0,mask,traces),()=>e.radar_init(cp,state+1,f0,f1,mask,traces),()=>e.radar_advance(cp,state,f0,f1,mask,f0,1),()=>e.radar_read(state,traces,state),()=>e.radar_read(state,traces,e.memory.buffer.byteLength-8),()=>e.radar_mask(0)])assert.equal(call(),2)
   assert.deepEqual(Buffer.from(bytes.slice(cp,end)),snapshot,'invalid memory rejects before mutation')
   assert.equal(advance(1),5);assert.equal(advance(0),1);assert.equal(advance(65),1);view.setUint32(cp+24,1,true);assert.equal(advance(1),7);view.setUint32(cp+24,0,true)
   view.setUint32(state+24,256,true);assert.equal(e.radar_read(state,traces,out),5)
   assert.equal(e.radar_init(cp,state,f0,f1,mask,traces),0);assert(words(state,10).every(x=>x===0));assert(new Float32Array(e.memory.buffer,f0,80000).every(x=>Object.is(x,0)));assert(d(traces,1024).every(x=>Object.is(x,0)))
   new Float32Array(e.memory.buffer,f0,1)[0]=NaN;assert.equal(advance(1),4);assert.equal(words(state,1)[0],0)
   view.setUint32(cp+8,40000,true);assert.equal(e.radar_init(cp,state,f0,f1,mask,traces),3)
  }else{
   bytes.set(input.subarray(16),cp)
   if(c.op===1){assert.equal(e.radar_max_range(cp,out),0);const r=d(out,1)[0];for(const[i,range]of[r/2,r,r*2].entries())assert.equal(e.radar_received_power(cp,range,out+8+i*8),0);got=Buffer.from(bytes.slice(out,out+32));for(const[i,v]of[c.f.r,...c.f.powers].entries()){const error=Math.abs(d(out,4)[i]-v)/Math.max(Math.abs(v),1e-300);maxRange=Math.max(maxRange,error);assert(error<3e-15)}assert.equal(e.radar_wavelength(299792458,out),0);assert.equal(d(out,1)[0],1);assert.equal(e.radar_power_ratio(out),0);assert.equal(d(out,1)[0],1/16);assert.equal(e.radar_max_range(cp,cp),2);assert.equal(e.radar_received_power(cp,0,out),3);assert.equal(e.radar_wavelength(Infinity,out),3)}
   if(c.op===2){bytes.set(input.subarray(64,80),state);const parts=[Buffer.from(bytes.slice(state,state+16))];for(let i=1;i<c.f.states.length;i++){assert.equal(e.laser_step(cp,state),0);parts.push(Buffer.from(bytes.slice(state,state+16)));assert.deepEqual(Array.from(d(state,2)),[c.f.states[i].N,c.f.states[i].S],'old JS laser step exact')}
    assert.equal(e.laser_threshold(cp,out),0);assert.equal(e.laser_steady(cp,c.f.pump,out+8),0);parts.push(Buffer.from(bytes.slice(out,out+16)));got=Buffer.concat(parts);assert.equal(d(out,1)[0],c.f.threshold);const error=Math.abs(d(out+8,1)[0]-c.f.steady);maxSteady=Math.max(maxSteady,error);assert(error<=3e-13*Math.max(1,Math.abs(c.f.steady)))
    const final=Buffer.from(bytes.slice(state,state+16));bytes.set(input.subarray(64,80),state);assert.equal(e.laser_advance(cp,state,2),0);assert.equal(e.laser_advance(cp,state,3),0);assert.deepEqual(Buffer.from(bytes.slice(state,state+16)),final,'laser partial batches exact')
    for(const call of[()=>e.laser_step(cp,cp),()=>e.laser_advance(cp,state+1,1),()=>e.laser_threshold(cp,cp),()=>e.laser_steady(cp,1,cp)])assert.equal(call(),2)
    assert.equal(e.laser_advance(cp,state,0),1);assert.equal(e.laser_advance(cp,state,65537),1);d(cp,1)[0]=0;assert.equal(e.laser_step(cp,state),3);bytes.set(input.subarray(16,64),cp);d(state,1)[0]=NaN;assert.equal(e.laser_step(cp,state),4)
   }
   if(c.op===3){assert.equal(e.laser_characteristics(cp,c.f.pump,data,out),0);got=Buffer.concat([Buffer.from(bytes.slice(out,out+24)),Buffer.from(bytes.slice(data,data+816))]);const want=[c.f.result.threshold,c.f.result.pumpMax,c.f.result.steadyPhotons,...c.f.result.curve.flatMap(p=>[p.p,p.s])];want.forEach((v,i)=>{const error=Math.abs(got.readDoubleLE(i*8)-v);maxSteady=Math.max(maxSteady,error);assert(error<=3e-13*Math.max(1,Math.abs(v)))});assert.equal(e.laser_characteristics(cp,c.f.pump,data,data),2);assert.equal(e.laser_characteristics(cp,NaN,data,out),3)}
   if(c.op===4){assert.equal(e.nljd_result(c.kind,data,out),0);got=Buffer.concat([Buffer.from(bytes.slice(out,out+72)),Buffer.from(bytes.slice(data,data+648))]);const r=c.f.result,want=[r.coefficients.a2,r.coefficients.a3,r.harmonics.f1,r.harmonics.f2,r.harmonics.f3,r.relative.f1,r.relative.f2,r.relative.f3,kinds.indexOf(r.verdict),...r.transfer];assert.deepEqual(want.map((_,i)=>got.readDoubleLE(i*8)),want,'old JS NLJD complete exact');assert.equal(e.nljd_coefficients(c.kind,out),0);assert.equal(e.nljd_harmonics(c.kind,out+16),0);assert.deepEqual(Buffer.from(bytes.slice(out,out+40)),got.subarray(0,40));assert.equal(e.nljd_result(c.kind,data,data),2);assert.equal(e.nljd_result(3,data,out),3)}
   if(c.op===5){assert.equal(e.nljd_harmonic_amplitudes(...c.p,out),0);for(const[i,x]of[-2,-1,0,.5,2].entries())assert.equal(e.nljd_response(x,...c.p,out+24+i*8),0);got=Buffer.from(bytes.slice(out,out+64));assert.deepEqual(Array.from(d(out,8)).map(x=>x===0?0:x),[c.f.h.f1,c.f.h.f2,c.f.h.f3,...c.f.values]);assert.equal(e.nljd_response(Number.MAX_VALUE,1,1,out),4);assert.equal(e.nljd_harmonic_amplitudes(NaN,1,out),4)}
   if(c.op===6){assert.equal(e.nljd_classify(cp,out),0);got=Buffer.from(bytes.slice(out,out+4));assert.equal(got.readUInt32LE(),kinds.indexOf(c.f.result));assert.equal(e.nljd_classify(cp,cp),2);d(cp+8,1)[0]=-1;assert.equal(e.nljd_classify(cp,out),3)}
  }
  writeFileSync(file,input);const expected=execFileSync(native,[file],{timeout:10000});assert.deepEqual(got,expected,`native/WASM all buffers/statistics exact, operation${c.op}`)
 }
 console.log(`Detection: ${cases.length} captured cases native/WASM exact, including complete Radar fields/rings/readout/reset/2-vs8-step chunks and Laser partial batches. Old JS Radar f32/traces and Laser trajectories/NLJD exact; max range relative error=${maxRange}, max Laser steady absolute error=${maxSteady}. Illegal memory/state/parameters/overflow checks pass.`)
}finally{rmSync(scratch,{recursive:true,force:true})}
