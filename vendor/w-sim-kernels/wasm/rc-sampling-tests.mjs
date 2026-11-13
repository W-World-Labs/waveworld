import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync}from'node:fs'
import{execFileSync}from'node:child_process'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{fileURLToPath}from'node:url'
const root=fileURLToPath(new URL('../../..',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'w-sim-rc-sampling-'))
const module=new WebAssembly.Module(Buffer.from(readFileSync(join(root,'packages/solvers-lbm/src/wasm-kernel.ts'),'utf8').match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1],'base64'))
const base={n:2,k:2,x:[2,-2],s:[1,0,0,1],bias:[0,0]},rc=[1,1,1,0],cases=[
 {...base,name:'unchanged static'}, {...base,name:'one tau/sign switch',rc},
 {...base,name:'sample noise',rc,noise:.5},
 {...base,name:'bias and initial voltage',x:[3,-4],s:[1,2,2,-1],bias:[2,-3],rc:[2,.5,.2,1.5]},
 {...base,name:'tiny dwell',x:[1,2],rc:[1e12,1,1e-12,0]},
 {...base,name:'large dwell',rc:[1e-3,1e-15,1e3,3]},
 {...base,name:'deficient',s:[1,2,2,4],rc,rank:1,status:1},
 {...base,name:'custom rectangular',kind:2,m:3,code:[1,0,0,1,1,1],rc:[1,.5,.1,0]},
 {...base,name:'hadamard ridge',kind:1,lambda:.1,rc},
 {...base,name:'invalid resistance',rc:[0,1,1,0],failure:3},
 {...base,name:'invalid initial voltage',rc:[1,1,1,NaN],failure:3},
]
const near=(a,b,t)=>assert(Math.abs(a-b)<=t,`${a} != ${b}, tolerance ${t}`)
try{const lib=join(scratch,'libw_sim_kernels.rlib'),native=join(scratch,'reference'),file=join(scratch,'input')
 execFileSync('rustc',[join(root,'crates/w-sim-kernels/src/lib.rs'),'--edition','2021','--crate-name','w_sim_kernels','--crate-type','rlib','-O','-C','panic=abort','-o',lib],{stdio:'inherit',timeout:60000})
 execFileSync('rustc',[fileURLToPath(new URL('./sensing-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${lib}`,'-O','-C','panic=abort','-o',native],{stdio:'inherit',timeout:60000})
 let cleanSamples
 for(const c of cases){const n=c.n,k=c.k,m=c.m??k,e=new WebAssembly.Instance(module).exports,cp=(e.heap_base()+7)&~7,rp=cp+40,table=rp+32,out=table+40;let end=out+64
  const alloc=(count,size=8)=>{end=(end+7)&~7;const p=end;end+=count*size;return p},xp=alloc(n),sp=alloc(k*n),bp=alloc(k),cc=c.kind===2?alloc(m*k):0,lengths=[m*k,k,m,n,n,(m+n)*n,m+n,n,m,m],pointers=lengths.map((len,i)=>alloc(len,i===7?4:8))
  if(end>e.memory.buffer.byteLength)e.memory.grow(Math.ceil((end-e.memory.buffer.byteLength)/65536));const bytes=new Uint8Array(e.memory.buffer),view=new DataView(e.memory.buffer),d=(p,count)=>new Float64Array(e.memory.buffer,p,count)
  const input=Buffer.alloc(40+8*(n+k*n+k+(cc?m*k:0))+4+(c.rc?32:0));[n,k,m,c.kind??0,0,0].forEach((v,i)=>input.writeUInt32LE(v,4*i));input.writeDoubleLE(c.noise??0,24);input.writeDoubleLE(c.lambda??0,32);let at=40
  for(const values of[c.x,c.s,c.bias,...(cc?[c.code]:[])])for(const v of values){input.writeDoubleLE(v,at);at+=8}input.writeUInt32LE(c.rc?1:0,at);at+=4;if(c.rc)for(const v of c.rc){input.writeDoubleLE(v,at);at+=8}
  bytes.set(input.subarray(0,40),cp);d(xp,n).set(c.x);d(sp,k*n).set(c.s);d(bp,k).set(c.bias);if(cc)d(cc,m*k).set(c.code);if(c.rc)d(rp,4).set(c.rc);pointers.forEach((p,i)=>view.setUint32(table+4*i,p,true))
  const run=()=>e.array_sense_sampled(cp,xp,sp,bp,cc,c.rc?rp:0,table,out),status=run();assert.equal(status,c.failure??0,c.name)
  const head=Buffer.alloc(4);head.writeUInt32LE(status);const slices=[[out,64],...pointers.map((p,i)=>[p,lengths[i]*(i===7?4:8)])],snapshot=()=>Buffer.concat([head,...slices.map(([p,n])=>Buffer.from(bytes.slice(p,p+n)))])
  const got=status?head:snapshot();writeFileSync(file,input);assert.deepEqual(got,execFileSync(native,[file],{timeout:10000}),`${c.name}: full native/WASM output/work exact`);if(status)continue
  const ideal=Array.from(d(pointers[8],m)),sampled=Array.from(d(pointers[9],m)),measured=Array.from(d(pointers[2],m)),x=Array.from(d(pointers[3],n)),settling=d(out+40,3)
  if(c.rc){const tau=c.rc[0]*c.rc[1],q=-Math.expm1(-c.rc[2]/tau),decay=Math.exp(-c.rc[2]/tau);near(settling[0],q,4e-16*Math.max(q,1e-300));assert.equal(settling[2],tau);let previous=c.rc[3];for(let i=0;i<m;i++){previous=decay*previous+q*ideal[i];near(sampled[i],previous,2e-14*Math.max(1e-300,Math.abs(previous),Math.abs(ideal[i])*q))}}
  else{assert.deepEqual(Array.from(settling),[1,0,0]);assert.deepEqual(ideal,sampled)}
  if(!c.noise)assert.deepEqual(measured,sampled);else for(let i=0;i<m;i++)assert(Math.abs(measured[i]-sampled[i])<=c.noise)
  if(c.name==='one tau/sign switch')cleanSamples=sampled;if(c.name==='sample noise')assert.deepEqual(sampled,cleanSamples,'measurement noise must not feed back into the capacitor')
  assert.equal(view.getUint32(out+24,true),c.rank??n);assert.equal(view.getUint32(out+28,true),c.status??(c.lambda?2:0))
  if(!c.lambda&&!c.noise&&!c.status)x.forEach((v,i)=>near(v,c.x[i],2e-13));if(c.status===1)assert.deepEqual(x,[0,0])
  assert.equal(run(),0);assert.deepEqual(snapshot(),got,'persistent owner scan reset exact')
  if(!c.rc){const before=Buffer.concat([Buffer.from(bytes.slice(out,out+40)),...slices.slice(1,9).map(([p,n])=>Buffer.from(bytes.slice(p,p+n)))]);assert.equal(e.array_sense(cp,xp,sp,bp,cc,table,out),0);assert.deepEqual(Buffer.concat([Buffer.from(bytes.slice(out,out+40)),...slices.slice(1,9).map(([p,n])=>Buffer.from(bytes.slice(p,p+n)))]),before,'legacy static export is the same numerical path')}
  const saved=Buffer.from(bytes.slice(cp,end));for(const call of[()=>e.array_sense_sampled(cp,xp,sp,bp,cc,rp+1,table,out),()=>e.array_sense_sampled(cp,xp,sp,bp,cc,rp,table,pointers[8]),()=>e.array_sense_sampled(cp,xp,sp,bp,cc,rp,table,e.memory.buffer.byteLength-8)])assert.equal(call(),2);assert.deepEqual(Buffer.from(bytes.slice(cp,end)),saved)
  view.setUint32(table+36,pointers[8],true);assert.equal(run(),2);view.setUint32(table+36,pointers[9],true)
  if(c.rc){for(const[index,value]of[[0,1e-4],[1,2],[2,0],[3,1e6+1]]){d(rp,4)[index]=value;assert.equal(run(),3);d(rp,4)[index]=c.rc[index]}}
 }
 console.log(`Serial RC sensing: ${cases.length} cases native/WASM exact, stable tiny/large dwell, filtered operator/baseline, no noise feedback, deficient/ridge/static compatibility and checked memory pass.`)
}finally{rmSync(scratch,{recursive:true,force:true})}
