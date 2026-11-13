// New model: small hand-derived inverse/ridge/orthogonal references, not an old
// JS implementation or a second production QR solver. Native/WASM compare bytes.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const root=fileURLToPath(new URL('../../..',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'w-sim-sensing-'))
const bytes=Buffer.from(readFileSync(join(root,'packages/solvers-lbm/src/wasm-kernel.ts'),'utf8').match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1],'base64')
const module=new WebAssembly.Module(bytes),near=(a,b,t=1e-13)=>assert(Math.abs(a-b)<=t,`${a} != ${b}, tolerance ${t}`)
const original=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/sensing-static-original.json.gz',import.meta.url))))
const identity=n=>Array.from({length:n*n},(_,i)=>+(Math.floor(i/n)===i%n))
const cases=[
 {name:'hand inverse and bias',n:2,k:2,x:[4,-2],s:[1,2,3,5],bias:[7,-3],expectX:[4,-2],expectY:[7,-1],rank:2,status:0},
 {name:'normalized Sylvester 4',n:4,k:4,kind:1,x:[1,2,3,4],s:identity(4),bias:[0,0,0,0],expectX:[1,2,3,4],expectY:[5,-1,-2,0],rank:4,status:0},
 {name:'custom rectangular',n:2,k:3,m:4,kind:2,x:[2,-1],s:[1,0,0,1,1,1],bias:[.25,-.5,1],custom:[1,0,0,0,1,0,0,0,1,1,-1,1],expectX:[2,-1],expectY:[2.25,-1.5,2,5.75],rank:2,status:0},
 {name:'deficient',n:2,k:2,x:[3,4],s:[1,2,2,4],bias:[0,0],expectY:[11,22],rank:1,status:1},
 {name:'underdetermined',n:2,k:1,x:[3,4],s:[1,2],bias:[1],expectY:[12],rank:1,status:1},
 {name:'underdetermined ridge',n:2,k:1,x:[3,4],s:[1,2],bias:[1],lambda:1,expectX:[11/6,22/6],rank:1,status:2},
 {name:'diagonal ridge',n:2,k:2,x:[4,-2],s:[2,0,0,3],bias:[0,0],lambda:2,expectX:[8/3,-18/11],rank:2,status:2},
 {name:'zero rank',n:2,k:2,x:[3,4],s:[0,0,0,0],bias:[1,2],expectY:[1,2],rank:0,status:1},
 {name:'zero rank regularized',n:2,k:2,x:[3,4],s:[0,0,0,0],bias:[1,2],lambda:1,expectX:[0,0],rank:0,status:2},
 {name:'identity noise seed0',n:2,k:2,x:[2,-3],s:identity(2),bias:[4,-2],noise:.5,rank:2,status:0,seed:0},
 {name:'identity noise seedmax',n:2,k:2,x:[2,-3],s:identity(2),bias:[4,-2],noise:.5,rank:2,status:0,seed:0xffffffff},
 {name:'overdetermined noise',n:2,k:3,x:[2,-1],s:[1,0,0,1,1,1],bias:[1,-1,2],noise:.25,rank:2,status:0,seed:17},
 {name:'near collinear',n:2,k:2,x:[1,-1],s:[1,1,1,1+1e-8],bias:[0,0],expectX:[1,-1],tolerance:1e-7,rank:2,status:0},
 {name:'custom bounded maximum',n:1,k:1,m:1,kind:2,x:[1e6],s:[1e6],bias:[1e6],custom:[1e6],noise:1e6,lambda:1e6,rank:1,status:2},
 {name:'dimension one Hadamard',n:1,k:1,kind:1,x:[-2],s:[3],bias:[1],expectX:[-2],rank:1,status:0},
 {name:'back substitution overflow',n:1,k:1,x:[0],s:[Number.MIN_VALUE],bias:[0],noise:1,failure:4},
 {name:'unresolvable regularization',n:2,k:2,x:[3,4],s:[1,2,2,4],bias:[0,0],lambda:1e-30,failure:5},
 {name:'smallest positive regularization at zero sensing',n:2,k:2,x:[3,4],s:[0,0,0,0],bias:[0,0],lambda:Number.MIN_VALUE,expectX:[0,0],rank:0,status:2},
]
// One sparse capacity smoke, no iteration/convergence loop. C=[I;I], S=I.
cases.push({name:'maximum dimensions',n:64,k:64,m:128,kind:2,x:Array.from({length:64},(_,i)=>i/64),s:identity(64),bias:Array(64).fill(0),custom:[...identity(64),...identity(64)],expectX:Array.from({length:64},(_,i)=>i/64),rank:64,status:0})
try{
 const lib=join(scratch,'libw_sim_kernels.rlib'),native=join(scratch,'reference'),file=join(scratch,'input')
 execFileSync('rustc',[join(root,'crates/w-sim-kernels/src/lib.rs'),'--edition','2021','--crate-name','w_sim_kernels','--crate-type','rlib','-O','-C','panic=abort','-o',lib],{stdio:'inherit',timeout:60000})
 execFileSync('rustc',[fileURLToPath(new URL('./sensing-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${lib}`,'-O','-C','panic=abort','-o',native],{stdio:'inherit',timeout:60000})
 for(const c of cases){
  const e=new WebAssembly.Instance(module).exports,cp=(e.heap_base()+7)&~7,table=cp+40,out=table+32,n=c.n,k=c.k,m=c.m??k
  let end=out+40;const region=count=>{const p=end;end+=count*8;return p}
  const xp=region(n),sp=region(k*n),bp=region(k),cc=c.kind===2?region(m*k):0
  const lengths=[m*k,k,m,n,n,(m+n)*n,m+n],pointers=lengths.map(region);pointers.push(end);end+=n*4
  if(end>e.memory.buffer.byteLength)e.memory.grow(Math.ceil((end-e.memory.buffer.byteLength)/65536))
  const mem=new Uint8Array(e.memory.buffer),view=new DataView(e.memory.buffer),d=(at,count)=>new Float64Array(e.memory.buffer,at,count)
  const input=Buffer.alloc(40+8*(n+k*n+k+(cc?m*k:0)))
  ;[n,k,m,c.kind??0,c.seed??0,0].forEach((v,i)=>input.writeUInt32LE(v,i*4));input.writeDoubleLE(c.noise??0,24);input.writeDoubleLE(c.lambda??0,32)
  let at=40;for(const a of[c.x,c.s,c.bias,...(cc?[c.custom]:[])])for(const v of a){input.writeDoubleLE(v,at);at+=8}
  mem.set(input.subarray(0,40),cp);d(xp,n).set(c.x);d(sp,k*n).set(c.s);d(bp,k).set(c.bias);if(cc)d(cc,m*k).set(c.custom)
  pointers.forEach((p,i)=>view.setUint32(table+i*4,p,true));lengths.forEach((count,i)=>d(pointers[i],count).fill(7));new Uint32Array(e.memory.buffer,pointers[7],n).fill(7)
  const run=()=>e.array_sense(cp,xp,sp,bp,cc,table,out),status=run()
  assert.equal(status,c.failure??0,c.name)
  const slices=[[out,40],...lengths.map((count,i)=>[pointers[i],count*8]),[pointers[7],n*4]],head=Buffer.alloc(4);head.writeUInt32LE(status)
  const got=status?head:Buffer.concat([head,...slices.map(([p,count])=>Buffer.from(mem.slice(p,p+count)))])
  const golden=original.cases.find(record=>record.name===c.name);assert.equal(got.length,golden.size);assert.equal(createHash('sha256').update(got).digest('hex'),golden.sha256,'original static core output/work unchanged')
  writeFileSync(file,input);assert.deepEqual(got,execFileSync(native,[file],{timeout:10000}),`${c.name}: complete native/WASM output/work byte parity`)
  if(status)continue
  const rank=view.getUint32(out+24,true),resultStatus=view.getUint32(out+28,true),y=d(pointers[2],m),x=d(pointers[3],n),error=d(pointers[4],n)
  assert.equal(rank,c.rank,c.name);assert.equal(resultStatus,c.status,c.name)
  if(c.expectY)assert.deepEqual(Array.from(y),c.expectY,c.name)
  if(c.expectX)c.expectX.forEach((v,i)=>near(x[i],v,c.tolerance??1e-13))
  if(resultStatus===1){assert(x.every(v=>Object.is(v,0)));assert(error.every(v=>Object.is(v,0)));assert.deepEqual(Array.from(d(out,2)),[0,0])}
  if(c.name.startsWith('identity noise')){for(let i=0;i<n;i++){near(x[i],y[i]-c.bias[i]);assert(Math.abs(error[i])<=c.noise)}}
  if(c.name==='overdetermined noise'){
   // Solve the 2x2 analytic system [[2,1],[1,2]] x = [z0+z2,z1+z2].
   const z=Array.from(y,(v,i)=>v-c.bias[i]);near(x[0],(2*z[0]-z[1]+z[2])/3);near(x[1],(-z[0]+2*z[1]+z[2])/3)
  }
  if(resultStatus!==1){const rmse=Math.sqrt(Array.from(error).reduce((s,v)=>s+v*v,0)/n);near(d(out,1)[0],rmse,1e-12*Math.max(1,rmse))}
  assert.equal(run(),0);assert.deepEqual(Buffer.concat([head,...slices.map(([p,count])=>Buffer.from(mem.slice(p,p+count)))]),got,`${c.name}: owner reuse resets output and seed`)
  const snapshot=Buffer.from(mem.slice(cp,end));for(const call of[
   ()=>e.array_sense(0,xp,sp,bp,cc,table,out),()=>e.array_sense(cp+1,xp,sp,bp,cc,table,out),
   ()=>e.array_sense(cp,xp+1,sp,bp,cc,table,out),()=>e.array_sense(cp,xp,sp,xp,cc,table,out),
   ()=>e.array_sense(cp,xp,sp,bp,cc,table,pointers[0]),()=>e.array_sense(cp,xp,sp,bp,cc,table,e.memory.buffer.byteLength-8),
   ()=>e.array_sense(cp,xp,sp,bp,cc,table+1,out),
  ])assert.equal(call(),2)
  assert.deepEqual(Buffer.from(mem.slice(cp,end)),snapshot,'invalid regions fail before mutation')
  view.setUint32(table+12,pointers[4],true);assert.equal(run(),2);view.setUint32(table+12,pointers[3],true)
  view.setUint32(cp+20,1,true);assert.equal(run(),7);view.setUint32(cp+20,0,true)
  view.setUint32(cp,65,true);assert.equal(run(),1);view.setUint32(cp,n,true)
  d(xp,1)[0]=NaN;assert.equal(run(),4);d(xp,1)[0]=1e6+1;assert.equal(run(),3);d(xp,1)[0]=c.x[0]
  view.setFloat64(cp+32,-1,true);assert.equal(run(),3);view.setFloat64(cp+32,c.lambda??0,true)
  if(cc){d(cc,1)[0]=Infinity;assert.equal(run(),4);d(cc,1)[0]=c.custom[0];assert.equal(e.array_sense(cp,xp,sp,bp,0,table,out),2)}
  else assert.equal(e.array_sense(cp,xp,sp,bp,sp,table,out),2)
 }
 console.log(`Array sensing: ${cases.length} independent small/capacity cases; native/WASM all output and QR-work bytes exact; hand inverse, normalized H4, rectangular/noisy least squares, deficient/null and ridge semantics, reset, memory/bounds/nonfinite/overflow checks pass.`)
}finally{rmSync(scratch,{recursive:true,force:true})}
