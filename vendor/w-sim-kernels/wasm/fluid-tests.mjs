// Captured reference fields, real WASM and native exact parity; no TS solver
// retained. Goldens were re-captured from the e447b93a convergent-SOR kernel —
// see the `note` field in fixtures/fluid-original-ts.json.gz.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../..',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'w-sim-fluid-'));
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/fluid-original-ts.json.gz',import.meta.url))));
const generated=readFileSync(join(root,'packages/solvers-lbm/src/wasm-kernel.ts'),'utf8');
const bytes=Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1],'base64');
const module=new WebAssembly.Module(bytes);assert.equal(WebAssembly.Module.imports(module).length,0);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function params(c){const p=Buffer.alloc(64);p.writeUInt32LE(c.n,0);p.writeUInt32LE(c.iterations,4);p.writeUInt32LE(c.thermal?1:0,8);p.writeUInt32LE(c.inletSpeed===undefined?0:1,12);for(const[key,offset]of [['dt',16],['viscosity',24],['diffusion',32],['buoyancy',40],['ambient',48],['inletSpeed',56]])p.writeDoubleLE(c[key]??0,offset);return p;}
function source(s){const p=Buffer.alloc(48);p.writeDoubleLE(s?.densityDecay??1,32);p.writeDoubleLE(s?.temperatureCooling??1,40);if(s?.dye){p.writeUInt32LE(1,0);for(const[key,offset]of [['density',8],['spacing',16],['width',24]])p.writeDoubleLE(s.dye[key],offset);}return p;}
try{
 const lib=join(scratch,'libw_sim_kernels.rlib'),native=join(scratch,'reference');
 const rustc=args=>execFileSync('rustc',args,{stdio:'inherit',timeout:60000});
 rustc([join(root,'crates/w-sim-kernels/src/lib.rs'),'--edition','2021','--crate-name','w_sim_kernels','--crate-type','rlib','-O','-C','panic=abort','-o',lib]);
 rustc([fileURLToPath(new URL('./fluid-reference.rs',import.meta.url)),'--edition','2021','--extern',`w_sim_kernels=${lib}`,'-O','-C','panic=abort','-o',native]);
 for(const c of [...fixture.cases,...fixture.helpers]){
  const n=c.config.n*c.config.n,header=Buffer.alloc(12);header.writeUInt32LE(c.steps,0);header.writeUInt32LE(c.source?1:0,4);header.writeUInt32LE(c.mask?1:0,8);
  const initial=fixture.keys.map(k=>Buffer.from(c.initial[k],'base64')),mask=c.mask?Buffer.from(c.mask,'base64'):Buffer.alloc(n),config=params(c.config),src=source(c.source);
  const input=join(scratch,'input');writeFileSync(input,Buffer.concat([header,config,src,mask,...initial]));
  const expected=execFileSync(native,[input,...(c.kind?[c.kind,String(c.b)]:[])],{timeout:10000,maxBuffer:2*1024*1024});
  const e=new WebAssembly.Instance(module).exports;assert.equal(e.abi_version(),11);
  let at=(e.heap_base()+7)&~7;const cp=at,table=cp+64,sp=cp+112,stats=cp+160,data=cp+208,end=data+40*n+n;
  if(end>e.memory.buffer.byteLength)e.memory.grow(Math.ceil((end-e.memory.buffer.byteLength)/65536));
  const memory=new Uint8Array(e.memory.buffer),v=new DataView(e.memory.buffer);memory.set(config,cp);memory.set(src,sp);
  const ptrs=initial.map((bytes,i)=>{const p=data+i*4*n;memory.set(bytes,p);v.setUint32(table+i*4,p,true);return p;});const mp=data+40*n;memory.set(mask,mp);v.setUint32(table+40,c.mask?mp:0,true);
  for(let i=0;i<c.steps;i++)assert.equal(e.fluid_step(cp,table,c.source?sp:0),0,`${c.name} step`);
  if(c.kind){
   const code=c.kind==='set_boundary'?e.fluid_set_boundary(cp,c.b,ptrs[4]):c.kind==='linear_solve'?e.fluid_linear_solve(cp,c.b,ptrs[4],ptrs[5],.3,2):c.kind==='diffuse'?e.fluid_diffuse(cp,c.b,ptrs[4],ptrs[5],.003):c.kind==='project'?e.fluid_project(cp,ptrs[0],ptrs[1],ptrs[6],ptrs[7]):c.kind==='advect'?e.fluid_advect(cp,c.b,ptrs[4],ptrs[5],ptrs[0],ptrs[1]):e.fluid_apply(cp,table,c.kind==='apply_buoyancy'?0:1);
   assert.equal(code,0,c.name);
  }
  for(let k=0;k<10;k++){
   const got=Buffer.from(memory.slice(ptrs[k],ptrs[k]+4*n));assert.equal(hash(got),c.expected[fixture.keys[k]],`${c.name} ${fixture.keys[k]} golden exact`);
   assert.deepEqual(got,expected.subarray(k*4*n,(k+1)*4*n),`${c.name} ${fixture.keys[k]} native/WASM`);
  }
  assert.equal(e.fluid_read(cp,ptrs[0],ptrs[1],ptrs[4],ptrs[9],1,stats),0);
  assert.deepEqual(Buffer.from(memory.slice(stats,stats+48)),expected.subarray(40*n),`${c.name} stats native/WASM exact`);
  if(c.stats)for(let k=0;k<6;k++){const got=v.getFloat64(stats+k*8,true),want=c.stats[k];assert(Math.abs(got-want)<=2e-14*Math.max(1,Math.abs(want)),`${c.name} stats ${k} golden`);}
  assert.equal(e.fluid_max_divergence(ptrs[0],ptrs[1],c.config.n,1,stats),0);if(c.stats)assert.equal(v.getFloat64(stats,true),c.stats[5]);
  assert.equal(e.fluid_step(cp+4,table,0),2);assert.equal(e.fluid_step(cp,table,cp),7);
  v.setUint32(table+4,ptrs[0],true);assert.equal(e.fluid_step(cp,table,0),2);v.setUint32(table+4,ptrs[1],true);
  v.setUint32(table+40,ptrs[0],true);assert.equal(e.fluid_step(cp,table,0),2);v.setUint32(table+40,c.mask?mp:0,true);
  v.setFloat32(ptrs[8],NaN,true);assert.equal(e.fluid_step(cp,table,0),4);v.setFloat32(ptrs[8],0,true);
  v.setFloat64(cp+16,-1,true);assert.equal(e.fluid_step(cp,table,0),3);v.setFloat64(cp+16,c.config.dt,true);
  v.setUint32(cp+4,4097,true);assert.equal(e.fluid_step(cp,table,0),3);v.setUint32(cp+4,c.config.iterations,true);
  v.setUint32(sp+4,1,true);assert.equal(e.fluid_step(cp,table,sp),7);v.setUint32(sp+4,0,true);
  assert.equal(e.fluid_project(cp,ptrs[0],ptrs[0],ptrs[6],ptrs[7]),2);
  assert.equal(e.fluid_linear_solve(cp,0,ptrs[4],ptrs[4],1,4),2);
  assert.equal(e.fluid_advect(cp,0,ptrs[4],ptrs[4],ptrs[0],ptrs[1]),2);
  assert.equal(e.fluid_advect(cp,1,ptrs[2],ptrs[0],ptrs[0],ptrs[1]),0,'readonly alias allowed');
  assert.equal(e.fluid_set_boundary(cp,4,ptrs[4]),6);
  assert.equal(e.fluid_read(cp,ptrs[0],ptrs[1],ptrs[4],ptrs[9],1,ptrs[0]),2);
  assert.equal(e.fluid_read(cp,ptrs[0],ptrs[0],ptrs[4],ptrs[4],1,stats),0,'readonly statistical aliases allowed');
  assert.equal(e.fluid_max_divergence(ptrs[0],ptrs[0],c.config.n,0,stats),0);
  assert.equal(e.fluid_apply(cp,table,2),6);
  v.setUint32(sp,1,true);v.setFloat64(sp+16,0,true);assert.equal(e.fluid_step(cp,table,sp),3);
  assert.equal(e.fluid_linear_solve(cp,0,ptrs[4],ptrs[5],1,0),3);
  assert.equal(e.fluid_diffuse(cp,0,ptrs[4],ptrs[5],-1),3);
  assert.equal(e.fluid_max_divergence(ptrs[0],ptrs[1],c.config.n,c.config.n+1,stats),1);
 }
 console.log('Stable Fluids: golden ten-field hashes exact for N8/9/12 ×3 and product N100/110 ×2 plus ten teaching helper fixtures; native/WASM fields + six stats exact; invalid memory/configuration rejected.');
}finally{rmSync(scratch,{recursive:true,force:true});}
