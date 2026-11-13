// Captured reference values are retained; stepping is Rust in both targets.
// Neuron goldens were re-captured from the e447b93a RK4 kernel — see `note`
// in fixtures/ode-original-ts.json.gz.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {execFileSync} from 'node:child_process';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../..',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'w-sim-ode-'));
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ode-original-ts.json.gz',import.meta.url))));
const generated=readFileSync(join(root,'packages/solvers-lbm/src/wasm-kernel.ts'),'utf8');const module=new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1],'base64'));
const cases=[];const maxError=[0,0,0,0];
for(const f of fixture.rlc)cases.push({kind:0,p:[f.p.L,f.p.R,f.p.C,f.p.V,f.dt],initial:[f.initial.q,f.initial.i],states:f.states.map(s=>[s.q,s.i]),stats:[...f.stats.slice(0,3).map(x=>x??0),f.stats[3],f.energy.at(-1),f.stats[2]===null?0:1]});
for(const f of fixture.mutual)cases.push({kind:1,p:[f.p.L1,f.p.L2,f.p.M,f.p.R1,f.p.R2,f.p.V1,f.p.V2,f.dt],initial:[f.initial.i1,f.initial.i2],states:f.states.map(s=>[s.i1,s.i2]),stats:f.stats});
for(const f of fixture.oscillator)cases.push({kind:2,p:[f.p.mass,f.p.stiffness,f.p.damping,f.p.driveAmp,f.p.driveOmega,f.dt],t:f.t,initial:[f.initial.x,f.initial.v],states:f.states.map(s=>[s.x,s.v]),stats:[f.omega0,f.amplitude],curve:f.curve,min:.2,max:7});
for(const f of fixture.neuron)cases.push({kind:3,p:[f.current,f.dt,30],initial:[f.initial.v,f.initial.w],states:f.states.map(s=>[s.v,s.w])});
for(const{kind,scene:s,result:r}of fixture.scenes){
 if(kind==='rlc')cases.push({kind:0,batch:true,p:[1,2*s.zeta,1,s.drive==='step'?1:0,.01],initial:[s.drive==='energy'?1:0,0],states:r.states.map(s=>[s.q,s.i]),stats:[r.w0,r.z,r.Q??0]});
 if(kind==='mutual')cases.push({kind:1,batch:true,p:[1,s.n**2,s.k*s.n,2,4,10,0,1/240],mode:s.mode==='sine'?1:0,omega:4*Math.PI,initial:[0,0],states:r.states.map(s=>[s.i1,s.i2]),shares:r.secondaryShare,stats:[r.k,r.n,10*r.n,r.substeps,r.secondaryShare.at(-1)]});
 if(kind==='vibration')cases.push({kind:2,batch:true,p:[s.mass,s.stiffness,s.damping,1,2*Math.PI*s.driveFrequency,1/240],initial:[0,0],states:r.states.map(s=>[s.x,s.v]),stats:[r.omega0,r.amplitude],curve:{omega:r.resonance.omega,amp:r.resonance.amplitude},min:Math.max(.1,r.omega0*.2),max:r.omega0*2.5});
 if(kind==='neuron')cases.push({kind:3,batch:true,p:[s.current,.06,54],initial:[-1.2,-.6],steps:s.steps,voltage:r.voltage,pulses:s.pulses,spikes:r.spikes,peak:r.peak});
}
try{
 const lib=join(scratch,'libw_sim_kernels.rlib'),native=join(scratch,'reference');const rustc=args=>execFileSync('rustc',args,{stdio:'inherit',timeout:60000});rustc([join(root,'crates/w-sim-kernels/src/lib.rs'),'--edition','2021','--crate-name','w_sim_kernels','--crate-type','rlib','-O','-C','panic=abort','-o',lib]);rustc([fileURLToPath(new URL('./ode-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${lib}`,'-O','-C','panic=abort','-o',native]);
 for(const c of cases){
  const n=c.steps??c.states.length-1,count=c.curve?.omega.length??0,input=Buffer.alloc(160+(c.pulses?.length??0)*4);for(const[offset,value]of [[0,c.kind],[4,Number(c.batch??false)],[8,n],[12,0],[16,c.mode??0],[20,c.pulses?.length??0],[56,count]])input.writeUInt32LE(value,offset);for(const[offset,value]of [[24,c.t??0],[32,c.mode?c.omega:0],[40,c.min??0],[48,c.max??0]])input.writeDoubleLE(value,offset);for(const[i,v]of c.p.entries())input.writeDoubleLE(v,64+i*8);for(const[i,v]of c.initial.entries())input.writeDoubleLE(v,128+i*8);for(const[i,v]of(c.pulses??[]).entries())input.writeUInt32LE(v,160+i*4);
  const file=join(scratch,'input');writeFileSync(file,input);const expected=execFileSync(native,[file],{timeout:10000});
  const e=new WebAssembly.Instance(module).exports,cp=(e.heap_base()+7)&~7,state=cp+64,out=cp+96,aux=out+n*16,stats=aux+n*8,omega=stats+48,amp=omega+count*8,pulses=amp+count*8,flags=pulses+Math.ceil((c.pulses?.length??0)/2)*8,peakBuffer=(flags+n+7)&~7,end=peakBuffer+(n+1)*8;
  if(end>e.memory.buffer.byteLength)e.memory.grow(Math.ceil((end-e.memory.buffer.byteLength)/65536));
  const memory=new Uint8Array(e.memory.buffer),v=new DataView(e.memory.buffer),doubles=(p,n)=>new Float64Array(e.memory.buffer,p,n);memory.set(input.subarray(64,160),cp);memory.set(input.subarray(160),pulses);
  const step=()=>c.kind===0?e.rlc_step(cp,state):c.kind===1?e.mutual_step(cp,state):c.kind===2?e.oscillator_step(cp,state,c.t??0):e.neuron_step(cp,state);
  const batch=(start,len,op=out,ap=aux,fp=flags)=>c.kind===0?e.rlc_advance(cp,state,len,op):c.kind===1?e.mutual_advance(cp,state,start,len,c.mode??0,c.mode?c.omega:0,op,ap):c.kind===2?e.oscillator_advance(cp,state,start,len,op):e.neuron_advance(cp,state,c.pulses?.length?pulses:0,c.pulses?.length??0,start,len,op,fp);
  if(c.batch){let completed=0;for(const amount of [1,Math.min(2,n-1),n-3].filter(x=>x>0)){assert.equal(batch(completed,amount,out+completed*(c.kind===3?8:16),aux+completed*8,flags+completed),0);completed+=amount;}assert.equal(completed,n)}
  else for(let i=0;i<n;i++){assert.equal(c.kind===2?e.oscillator_step(cp,state,c.t+i*c.p[5]):step(),0);doubles(out+i*16,2).set(doubles(state,2));}
  if(c.kind===0)assert.equal(e.rlc_read(cp,state,stats),0);
  if(c.kind===1)assert.equal(e.mutual_read(cp,state,stats),0);
  if(c.kind===2){assert.equal(e.oscillator_read(cp,stats),0);assert.equal(e.oscillator_curve(cp,c.min,c.max,count,omega,amp),0);}
  const values=c.kind===3?[c.initial[0],...(c.batch?doubles(out,n):Array.from({length:n},(_,i)=>doubles(out+i*16,2)[0]))]:[];
  if(c.kind===3){doubles(peakBuffer,n+1).set(values);assert.equal(e.ode_peak(peakBuffer,n+1,stats),0);}
  const chunks=[[state,c.kind===1?32:16],[out,n*(c.kind===3&&c.batch?8:16)],...(c.kind===1&&c.batch?[[aux,n*8]]:[]),[stats,[48,40,16,8][c.kind]],...(c.kind===2?[[omega,count*8],[amp,count*8]]:[]),...(c.kind===3&&c.batch?[[flags,n]]:[])];
  const got=Buffer.concat(chunks.map(([p,n])=>Buffer.from(memory.slice(p,p+n))));assert.deepEqual(got,expected,`kind${c.kind}/batch${c.batch}: native/WASM all state, trajectory, statistics exact`);
  const compare=(got,want,label)=>{assert.equal(got.length,want.length);for(let i=0;i<want.length;i++){const error=Math.abs(got[i]-want[i]);maxError[c.kind]=Math.max(maxError[c.kind],error);if(c.kind===0||c.kind===3)assert.equal(got[i],want[i],label);else assert(error<=2e-13*Math.max(1,Math.abs(want[i])),`${label}[${i}]: ${got[i]} != ${want[i]}`)}};
  if(c.states)compare(Array.from(doubles(out,n*2)),c.states.slice(1).flat(),'old JS trajectory');
  if(c.stats)compare(Array.from(doubles(stats,c.stats.length)),c.stats,'old JS readout');
  if(c.shares)compare(Array.from(doubles(aux,n)),c.shares.slice(1),'old JS dissipation share');
  if(c.curve){compare(Array.from(doubles(omega,count)),c.curve.omega,'old JS resonance frequencies');compare(Array.from(doubles(amp,count)),c.curve.amp,'old JS resonance amplitudes');}
  if(c.voltage){compare(values,c.voltage,'old JS voltage');assert.equal(doubles(stats,1)[0],c.peak);assert.deepEqual(Array.from(memory.slice(flags,flags+n)).flatMap((flag,i)=>flag?[i+1]:[]),c.spikes);}
  // ABI range, alignment and alias failure before exposing writable slices.
  const s0=Buffer.from(memory.slice(state,state+32));
  const malformed=[()=>e.rlc_step(cp,cp),()=>e.mutual_step(cp,state+1),()=>e.oscillator_step(cp,state+1,0),()=>e.neuron_step(cp,cp),()=>e.rlc_advance(cp,state,1,state),()=>e.mutual_advance(cp,state,0,1,0,0,out,out),()=>e.oscillator_advance(cp,state,0,1,cp),()=>e.neuron_advance(cp,state,state,1,0,1,out,flags),()=>e.rlc_read(cp,state,state),()=>e.mutual_read(cp,state,cp),()=>e.oscillator_read(cp,cp),()=>e.oscillator_curve(cp,1,2,2,omega,omega),()=>e.ode_peak(state,2,state),()=>e.oscillator_omega0(1,1,e.memory.buffer.byteLength-4)];for(const call of malformed)assert.equal(call(),2);
  assert.deepEqual(Buffer.from(memory.slice(state,state+32)),s0);
  assert.equal(e.rlc_advance(cp,state,0,out),1);assert.equal(e.mutual_advance(cp,state,0,0,0,0,out,aux),1);assert.equal(e.oscillator_advance(cp,state,0,0,out),1);assert.equal(e.neuron_advance(cp,state,0,0,0,0,out,flags),1);assert.equal(e.oscillator_curve(cp,1,2,1,omega,amp),1);assert.equal(e.ode_peak(state,0,stats),1);
  const old=doubles(state,1)[0];doubles(state,1)[0]=NaN;assert.equal(step(),4);doubles(state,1)[0]=old;
  const at=[4,7,5,1][c.kind],h=doubles(cp,8)[at];doubles(cp,8)[at]=0;assert.equal(step(),3);doubles(cp,8)[at]=h;
  if(c.kind===2){assert.equal(e.oscillator_step(cp,state,1e20),0);assert.equal(e.oscillator_amplitude(cp,-1,stats),3);assert.equal(e.oscillator_omega0(0,1,stats),3);assert.equal(e.oscillator_curve(cp,2,1,count,omega,amp),3);}
  if(c.kind===0){const l=doubles(cp,1)[0];doubles(cp,1)[0]=0;assert.equal(step(),3);doubles(cp,1)[0]=l;assert.equal(e.rlc_read(cp,state,stats+1),2);}
  if(c.kind===1){assert.equal(e.mutual_advance(cp,state,0,1,2,0,out,aux),7);assert.equal(e.mutual_advance(cp,state,0xffffffff,1,0,0,out,aux),1);assert.equal(e.mutual_advance(cp,state,0,1,0,1,out,aux),3);const r=doubles(cp+24,1)[0];doubles(cp+24,1)[0]=-1;assert.equal(step(),3);doubles(cp+24,1)[0]=r;}
  if(c.kind===2){assert.equal(e.oscillator_advance(cp,state,0xffffffff,1,out),1);const k=doubles(cp+8,1)[0];doubles(cp+8,1)[0]=-1;assert.equal(step(),3);doubles(cp+8,1)[0]=k;}
  if(c.kind===3){assert.equal(e.neuron_advance(cp,state,pulses,0,0,1,out,flags),2);assert.equal(e.neuron_advance(cp,state,0,1,0,1,out,flags),2);assert.equal(e.neuron_advance(cp,state,0,0,0xffffffff,1,out,flags),1);const span=doubles(cp+16,1)[0];doubles(cp+16,1)[0]=.5;assert.equal(step(),3);doubles(cp+16,1)[0]=span;doubles(peakBuffer,1)[0]=NaN;assert.equal(e.ode_peak(peakBuffer,1,stats),4);}
  if(c.batch){memory.set(input.subarray(128,160),state);assert.equal(batch(0,n),0);const unchunked=Buffer.concat(chunks.map(([p,n])=>Buffer.from(memory.slice(p,p+n))));assert.deepEqual(unchunked.subarray(0,c.kind===1?32:16),expected.subarray(0,c.kind===1?32:16),'chunk-independent final state');}
 }
 console.log(`ODE: ${cases.length} original-JS cases and chunked native/WASM trajectories/readouts exact; max old-JS absolute differences RLC/mutual/oscillator/neuron=${maxError.join('/')}; invalid memory/config/state rejected.`);
}finally{rmSync(scratch,{recursive:true,force:true});}
