const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireRoot('esbuild');
const { chromium, expect } = requireRoot('@playwright/test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
(async () => {
 execFileSync(process.execPath,[root+'/apps/lab/scripts/prepare-model-decoders.mjs'],{cwd:root,timeout:10000});
 // Exercise the real production document policy even in this small CI harness.
 const policy=execFileSync(process.execPath,['--import','tsx','-e',`process.env.NODE_ENV='production';const {proxy}=require('./apps/lab/src/proxy.ts');console.log(proxy({headers:new Headers(),nextUrl:{pathname:'/lab'}}).headers.get('content-security-policy'))`],{cwd:root,encoding:'utf8',timeout:10000}).trim();
 const nonce=policy.match(/'nonce-([^']+)'/)[1];
 const built=await build({stdin:{resolveDir:root+'/apps/lab',loader:'tsx',contents:`
 import React from 'react';
 import {createRoot} from 'react-dom/client';
 import {useSimulationExecution} from './src/hooks/use-simulation-execution';
 import {useProjectPersistence} from './src/hooks/use-project-persistence';
 import {useSimulationStore} from './src/lib/stores/simulation-store';
 import {createWindTunnelModel,useProjectStore} from './src/lib/stores/project-store';
 import {ParameterPanel} from './src/components/panels/parameter-panel';
 import {ResultsPanel} from './src/components/panels/results-panel';
 import {FlowPlayback} from './src/components/visualization/flow-playback';
 import {ModelPreview} from './src/components/visualization/model-preview';
 import {createActiveLbmJobSpec,createLbmPreviewPlacement} from './src/lib/models/sim-session';
 import {PRESET_MODELS,loadPresetModel} from './src/lib/models/preset-models';
 import {parseModelFile} from './src/lib/models/parser';
 import {overlappingGeometry} from '../../scripts/ci/lbm-fixture';
 import {prepareLbmInput,runLbmWasm} from '../../src/lib/sim/lbm-compute';
 import {runBrowserCompute} from '../../src/lib/sim/browser-agent';
 import {prepareProductLbmUnits} from '@w-sim/solvers-lbm/d3q19';
 import {ModelUploader} from './src/components/upload/model-uploader';
 import {decodeModelGeometry,encodeModelGeometry} from './src/lib/models/geometry-contract';
 import {encodeFlowSnapshot,decodeFlowSnapshot,summarizeFlowSnapshot,FLOW_SNAPSHOT_V2_CONTENT_TYPE,FLOW_SNAPSHOT_KIND} from './src/lib/cfd/flow-snapshot';
 import {WindTunnelCanvas} from './src/components/visualization/wind-tunnel-canvas';
 const snapshot={nx:2,ny:2,nz:2,step:25,displayStride:3,uLattice:0.0625,hasPressure:true,display:Float32Array.from({length:24},(_,i)=>i/32),flags:new Uint32Array([0,0,0,1,0,0,0,0])};
 window.flowBytes=encodeFlowSnapshot(snapshot);window.flowContentType=FLOW_SNAPSHOT_V2_CONTENT_TYPE;window.flowKind=FLOW_SNAPSHOT_KIND;
 window.summarizeFlowSnapshot=summarizeFlowSnapshot;
 const metadata={id:'car',name:'Car',format:'stl',fileSize:100,vertexCount:3,faceCount:1};
 const geometry={vertices:new Float32Array([0,0,0,1.25,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])};
 window.initialModel={metadata,geometry};window.localModel={metadata,geometry:overlappingGeometry};
 useProjectStore.getState().addUploadedModel({metadata,geometry});
 useProjectStore.getState().setActiveModel(createWindTunnelModel(metadata));
 window.decodeGeometry=bytes=>Array.from(decodeModelGeometry(Uint8Array.from(bytes).buffer).vertices);
 // Keep a legacy step budget to prove the workbench uses physical duration instead.
 // Synthetic remote-response fixtures intentionally return only the final field.
 useSimulationStore.getState().updateParameters({maxIterations:25,durationSeconds:10,gridPreset:'fast',fieldFrames:1,fieldStride:1,fieldFps:0});
 window.sim=useSimulationStore;window.project=useProjectStore;window.parseModelFile=parseModelFile;
 window.auditShippedPresets=async()=>{
   const defaults={...useSimulationStore.getState().parameters,gridPreset:'standard',modelResolution:'standard',ground:undefined,angleOfAttack:0};
   const rows=[];
   for(const preset of PRESET_MODELS){
     let loaded;
     try{loaded=await loadPresetModel(preset);const {grid,transform}=createLbmPreviewPlacement({...defaults,...preset.defaultParameters},createWindTunnelModel(loaded.metadata),loaded.geometry);rows.push({id:preset.id,file:loaded.fromFile,warning:loaded.warning,grid,bounds:transform.bounds});}
     catch(error){rows.push({id:preset.id,file:loaded?.fromFile,error:String(error)})}
   }
   return rows;
 };
 window.checkPresetOrientation=async id=>{
   // Presets now ship *-solid.stl derivatives (b8006c9), so name the fetched blob with
   // its real extension — parseModelFile picks the decoder from the filename.
   const preset=PRESET_MODELS.find(p=>p.id===id), raw=await parseModelFile(new File([await(await fetch(preset.modelUrl)).arrayBuffer()],preset.modelUrl.split('/').pop()));
   const selected=useProjectStore.getState().uploadedModels.find(m=>m.metadata.id===id);
   const rotated=values=>Array.from(values,(_,i)=>id==='rocket'?(i%3===0?-values[i+1]:i%3===1?values[i-1]:values[i]):(i%3===0?values[i+2]:i%3===2?-values[i-2]:values[i]));
   return {vertices:rotated(raw.geometry.vertices).every((v,i)=>v===selected.geometry.vertices[i]),normals:rotated(raw.geometry.normals).every((v,i)=>v===selected.geometry.normals[i]),indices:Array.from(raw.geometry.indices).every((v,i)=>v===selected.geometry.indices[i]),sourceSize:raw.metadata.boundingBox.size,size:selected.metadata.boundingBox.size};
 };
 window.currentScene=()=>{
   const s=useSimulationStore.getState(),p=useProjectStore.getState(),m=p.uploadedModels.find(m=>m.metadata.id===p.activeModel?.id);
   const placement=createLbmPreviewPlacement(s.parameters,p.activeModel,m.geometry);
   return {spec:createActiveLbmJobSpec(s.parameters,p.activeModel),bounds:placement.transform.bounds,dx:placement.dx,vertices:Array.from(m.geometry.vertices)};
 };
 window.currentUnits=()=>{const s=window.currentScene().spec;return prepareProductLbmUnits(s,s.model.referenceLength).units};
 window.unitsForSpec=spec=>prepareProductLbmUnits(spec,spec.model.referenceLength??useProjectStore.getState().activeModel.sourceModel.boundingBox.size[0]).units;
 window.savedFrameHashes=()=>Promise.all(useSimulationStore.getState().results.flowFrames.map(async frame=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encodeFlowSnapshot(frame))))));
 window.expectedGroupedMask=()=>{
   const spec=createActiveLbmJobSpec(window.sim.getState().parameters,window.project.getState().activeModel);
   const geometry=decodeModelGeometry(encodeModelGeometry(overlappingGeometry));
   const grouped=prepareLbmInput(spec,geometry);
   const parity=prepareLbmInput(spec,{...geometry,solidTriangleCounts:undefined});
   return {flags:Array.from(grouped.flags),solidCells:grouped.lbm.solidCells,parityCells:parity.lbm.solidCells};
 };
 window.runThermal=async()=>{
   const state=useSimulationStore.getState(), project=useProjectStore.getState();
   const model=project.uploadedModels.find(m=>m.metadata.id===project.activeModel.id);
   const spec=createActiveLbmJobSpec({...state.parameters,durationSeconds:undefined,maxIterations:3},project.activeModel);
   spec.model={...spec.model,source:'artifact',artifactId:'00000000-0000-4000-8000-000000000001'};
   spec.outputs.fields=['velocity','temperature'];
   try {
     const {result,snapshot}=await runLbmWasm(spec,prepareLbmInput(spec,model.geometry));
     state.applyJobResult(result);
     const replay=decodeFlowSnapshot(encodeFlowSnapshot(snapshot));
     useSimulationStore.getState().updateResults({flowSnapshot:replay});
     return {spec,result,summary:summarizeFlowSnapshot(replay,result.derived)};
   } catch(error) { return {error:String(error)}; }
 };
 // The existing low-level API keeps CI numerical work at three steps. Never lower
 // the workbench duration or pass its 10-second request to a real solver.
 window.runShort=async()=>{
   const state=useSimulationStore.getState(),project=useProjectStore.getState();
   const model=project.uploadedModels.find(m=>m.metadata.id===project.activeModel.id);
   const spec=createActiveLbmJobSpec({...state.parameters,durationSeconds:undefined,maxIterations:3},project.activeModel);
   const {result,flows}=await runBrowserCompute(spec,{geometry:model.geometry,signal:new AbortController().signal});
   const frames=flows.map(flow=>decodeFlowSnapshot(flow));
   state.applyJobResult(result);state.updateResults({flowSnapshot:frames.at(-1),flowFrames:frames,job:{spec,result}});
   return result;
 };

 function Persistence(){const p=useProjectPersistence();window.persistence=p;return <p aria-label="项目保存状态">{p.error??(p.savedAt?'已保存':p.ready?'待保存':'恢复中')}</p>}
 // Thermal presets moved to the /cooling page selector (ba65912) and no longer render in
 // ModelUploader's preset tab. This mirrors CoolingPageContent.selectDevice so the smoke
 // still exercises the real loadPresetModel + store path via real button clicks.
 function ThermalPresets(){const [loading,setLoading]=React.useState(null);const [notice,setNotice]=React.useState(null);
  const select=async preset=>{const sim=useSimulationStore.getState();
   try{setLoading(preset.id);setNotice(null);
    sim.stopSimulation();sim.resetSimulation();sim.setGPUContext({errorMessage:null});
    const {metadata,geometry,fromFile,warning}=await loadPresetModel(preset,{signal:new AbortController().signal});
    for(const m of useProjectStore.getState().uploadedModels){if(PRESET_MODELS.some(p=>p.id===m.metadata.id)&&m.metadata.id!==preset.id)useProjectStore.getState().removeUploadedModel(m.metadata.id);}
    useProjectStore.getState().addUploadedModel({metadata,geometry});
    const {referenceArea:_a,referenceLength:_l,...dp}=preset.defaultParameters;
    // createLbmJobSpec forces physical viscosity for thermalEnabled jobs; do not pin it
    // here — a sticky 'physical' would leak into later non-thermal presets and trip the
    // tau>=0.505 admission gate (e.g. the 4.5 m car at Re~3e6 on a coarse grid).
    sim.updateParameters({...dp,angleOfAttack:dp.angleOfAttack??0,thermalEnabled:true,thermalMode:dp.thermalMode??'solid-power',inletVelocity:dp.inletVelocity??0,modelResolution:dp.modelResolution??'standard',gridPreset:dp.gridPreset??'fast',durationSeconds:10,fan:dp.fan??null,flowMethod:'lbm',macFans:[],thermalRegions:dp.thermalRegions??[],thermalContacts:dp.thermalContacts??[]});
    sim.setVisualizationMode('temperature');
    useProjectStore.getState().setActiveModel(createWindTunnelModel(metadata));
    if(!fromFile&&warning)setNotice({presetId:preset.id,text:'模型文件加载失败，已使用可运行的简化模型：'+warning});
    setLoading(null);
   }catch(error){setNotice({presetId:preset.id,text:String(error)});setLoading(null);}};
  return <div aria-label="散热预设模型">{PRESET_MODELS.filter(p=>p.defaultParameters.thermalEnabled).map(p=><div key={p.id} data-slot="card">{notice?.presetId===p.id&&<p>{notice.text}</p>}<button disabled={loading!==null} onClick={()=>void select(p)}>{p.name}</button></div>)}</div>}
 function App(){const e=useSimulationExecution();const s=useSimulationStore();const [showCanvas,setCanvas]=React.useState(false);const [showPanels,setPanels]=React.useState(false);const [showPreview,setPreview]=React.useState(false);const [showPersistence,setPersistence]=React.useState(false);window.mountPersistence=setPersistence;window.mountPreview=setPreview;window.mountPanels=setPanels;window.mountCanvas=setCanvas;window.execution=e;return <><button id="local" onClick={()=>e.setTarget('browser')}>local</button><button id="backend" onClick={()=>e.setTarget('backend')}>backend</button><button id="start" onClick={()=>e.start()}>start</button><button id="publish" onClick={()=>e.start(true)}>publish</button><button id="stop" onClick={()=>e.stop()}>stop</button><pre id="state">{JSON.stringify({target:e.target,status:e.status,error:e.error,iteration:s.state.currentIteration,cd:s.state.dragCoefficient,history:s.state.cdHistory,running:s.state.isRunning})}</pre>{showPersistence&&<Persistence/>}{showCanvas&&<div style={{width:400,height:240}}><WindTunnelCanvas/></div>}<ModelUploader/><ThermalPresets/>{showPanels&&<><ParameterPanel/><FlowPlayback/><ResultsPanel/></>}{showPreview&&<div style={{width:600,height:400}}><ModelPreview/></div>}</>}
 createRoot(document.getElementById('root')).render(<App/>);
 `},tsconfig:root+'/apps/lab/tsconfig.json',bundle:true,write:false,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_TUANLIU_BASE_PATH':'""'}});
 const worker=await build({entryPoints:[root+'/src/lib/sim/browser-agent.worker.ts'],bundle:true,write:false,format:'esm',define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.argv.includes('--webgpu')?['--enable-unsafe-webgpu']:[])]});
 try{
 const page=await browser.newPage();const errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 const waitFor=(predicate,arg,options={})=>expect.poll(()=>page.evaluate(predicate,arg),{timeout:options.timeout??5000}).toBeTruthy();
 const violations=[],decoderRequests=[],modelRequests=[];
 await page.exposeFunction('recordCspViolation',directive=>violations.push(directive));
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>window.recordCspViolation(event.violatedDirective)));
 const loadMain=()=>page.evaluate(nonce=>new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.nonce=nonce;script.type='module';script.src='/main.js';
  script.onload=resolve;script.onerror=()=>reject(new Error('CI bootstrap blocked'));document.head.append(script);
 }),nonce);
 await page.route('http://127.0.0.1:3000/**',async route=> {
  const url=route.request().url();
  if(url.endsWith('/main.js') || url.endsWith('/browser-agent.worker.ts')) return route.fulfill({contentType:'text/javascript',body:url.endsWith('/main.js')?built.outputFiles[0].text:worker.outputFiles[0].text+`
   const handleJob=self.onmessage;
   self.onmessage=event=>{if(event.data?.spec?.run?.maxSteps>3)throw new Error('CI forbids solving more than three steps');return handleJob(event)};
  `});
  const pathname=new URL(url).pathname;
  if(pathname.startsWith('/models/') || pathname.startsWith('/draco/')) {
   if(pathname.startsWith('/draco/'))decoderRequests.push(pathname);
   if(pathname.startsWith('/models/'))modelRequests.push(pathname);
   try{return route.fulfill({contentType:pathname.endsWith('.js')?'application/javascript':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream',body:await require('node:fs/promises').readFile(root+'/apps/lab/public'+pathname)});}
   catch{return route.fulfill({status:404,body:''});}
  }
  return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':policy},body:'<div id="root"></div>'});
 });
 await page.goto('http://127.0.0.1:3000');
 await page.evaluate(()=>{
  Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000001'});
  window.requests=[];window.gpuRequests=0;window.jobStatus='succeeded';
  const postMessage=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...args){
   if(message?.spec?.run.maxSteps>3){
    window.pendingWorkerSpec=structuredClone(message.spec);
    const reply=this.onmessage;
    window.replyToPendingWorker=data=>reply.call(this,{data});
    return; // Workbench contract/progress/cancellation fixture; no numerical steps.
   }
   return postMessage.call(this,message,...args);
  };
  window.gpuDraws=0;window.gpuComputePipelines=0;window.gpuWrites=[];window.gpuBuffers=[];
  window.nativeGpu=navigator.gpu;
  const context={configure(){},unconfigure(){},getCurrentTexture:()=>({createView:()=>({})})};
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgpu'?context:getContext.call(this,kind,...args)};
  const device={
   addEventListener(){},lost:new Promise(resolve=>{window.loseGpu=resolve}),
   createBuffer({size}){const buffer={size,destroyed:false,destroy(){this.destroyed=true}};window.gpuBuffers.push(buffer);return buffer},
   queue:{writeBuffer(buffer,offset,data,byteOffset=0,byteLength){window.gpuWrites.push(Array.from(data instanceof ArrayBuffer?new Float32Array(data,byteOffset,byteLength/4):data))},submit(){}},
   createShaderModule({code}){window.renderShaderCode=code;return{}},createBindGroupLayout(){return{}},createPipelineLayout(){return{}},createBindGroup(){return{}},
   createRenderPipeline(){return{getBindGroupLayout:()=>({})}},
   createComputePipeline(){window.gpuComputePipelines++;throw new Error('remote rendering must not create a solver')},
   createCommandEncoder(){return{beginRenderPass:()=>({setPipeline(){},setBindGroup(){},draw(){window.gpuDraws++},end(){}}),finish:()=>({})}},
  };
  Object.defineProperty(navigator,'gpu',{value:{getPreferredCanvasFormat:()=> 'bgra8unorm',requestAdapter:async()=>{window.gpuRequests++;return {limits:{},requestDevice:async()=>device}}},configurable:true});
  window.nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
   const url=typeof input==='string'?input:input.url;
   if(window.shippedModels && (url.includes('/models/') || url.includes('/draco/') || /^(blob:|data:)/.test(url))) return window.nativeFetch(input,init);
   if (url.includes('/models/') && !url.includes('manifest')) return new Response('', {status:404});
   if (url.includes('manifest')) return new Response('{}', {status:404});
   window.requests.push({url,credentials:init.credentials,method:init.method||'GET',body:typeof init.body==='string'?JSON.parse(init.body):null,bytes:init.body instanceof ArrayBuffer?Array.from(new Uint8Array(init.body)):null});
   if(url.endsWith('/me')) return window.anonymous ? new Response('{}',{status:401}) : Response.json({user:{id:'fixture'}});
   if(url.endsWith('/artifacts')) {
    if(window.holdUpload) return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    return Response.json({artifact:{id:'mesh-1'}});
   }
   if(url.endsWith('/cancel'))return new Response('{}');
   if(typeof init.body==='string' && JSON.parse(init.body).execution==='browser') return new Response('{}',{status:401});
   if(url.endsWith('/flow-1')) {
    const hash=await crypto.subtle.digest('SHA-256',window.flowBytes);
    const hex=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
    return new Response(window.flowBytes,{headers:{'Content-Type':window.flowContentType,'X-Artifact-SHA256':window.badFlowHash?'wrong':hex}});
   }
   if(init.method==='POST') return new Response(JSON.stringify({job:{id:'remote-1'}}));
   const submitted=window.requests.filter(r=>r.body?.spec).at(-1)?.body.spec;
   const coefficients=submitted?.parameters.inletVelocity!==0;
   const ground=submitted?.parameters.ground;
   const steps=window.shortRemoteResult?25:submitted.run.maxSteps,units=window.unitsForSpec(submitted);
   // This synthetic result tests the protocol/UI only; its final step and SI time
   // must match the submitted 10-second task, not an obsolete fixed 25-step task.
   new DataView(window.flowBytes).setUint32(16,steps,true);
   const result={schemaVersion:1,summary:{steps,...(coefficients?{cd:0.4,cl:0.1}:{}),dragN:12,liftN:3,wallTimeMs:1},derived:{dt:units.dt,precision:submitted?.requirements.precision,'lbm-pressure-field-v1':1,pressureScalePa:12.171342947845735,...(ground?{'lbm-ground-v1':1,groundMode:ground.mode,groundClearanceM:ground.clearanceM,groundVelocityMps:ground.mode==='moving'?submitted.parameters.inletVelocity:0}:{})},history:{step:[Math.max(1,steps-5),steps],dragN:[15,12],liftN:[6,3],...(coefficients?{cd:[0.5,0.4],cl:[0.2,0.1]}:{})},artifacts:[{artifactId:'flow-1',kind:window.flowKind,contentType:window.flowContentType,bytes:window.flowBytes.byteLength}]};
   return new Response(JSON.stringify({job:{status:window.jobStatus,progress:{step:5,total:submitted.run.maxSteps},result:window.jobStatus==='succeeded'?result:null}}));
  };
 });
 await loadMain();
 await waitFor(()=>!!window.execution);
 // Actual keyboard editing must retain incomplete drafts without changing physics.
 // Reuse this React 19 panel for workbench submission and a low-level short solve.
 await page.evaluate(()=>{window.numericInitialModel=window.project.getState().activeModel;window.numericInitialParameters=window.sim.getState().parameters;window.mountPanels(true)});
 const lengthInput=page.getByLabel('模型流向长度（m）',{exact:true});
 const commitNumber=async(field,value)=>{await field.fill(value);await field.press('Enter')};
 const replaceWithKeyboard=async(field,text)=>{await field.press('ControlOrMeta+A');await field.press('Backspace');if(text)await field.pressSequentially(text)};
 await expect(lengthInput).toHaveValue('4.5');
 await replaceWithKeyboard(lengthInput,'');
 await expect(lengthInput).toHaveValue('');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),4.5);
 await lengthInput.pressSequentially('4.6');
 await expect(lengthInput).toHaveValue('4.6');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),4.5);
 await lengthInput.press('Enter');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),4.6);
 for(const text of ['0.09','9e-2']) {
   await replaceWithKeyboard(lengthInput,text);
   await lengthInput.press('Enter');
   await expect(lengthInput).toHaveValue('0.09');
   assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),0.09);
 }
 await replaceWithKeyboard(lengthInput,'7.2');
 await lengthInput.press('Escape');
 await expect(lengthInput).toHaveValue('0.09');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),0.09);
 for(const text of ['', '1e', '-1', '0']) {
   await replaceWithKeyboard(lengthInput,text);
   await lengthInput.press('Tab');
   await expect(lengthInput).toHaveValue('0.09');
   assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),0.09);
 }
 const durationInput=page.locator('#run-duration');
 for(const text of ['', '1e', '-1', '0', '1', '3.5']) {
   await replaceWithKeyboard(durationInput,text);
   await durationInput.press('Enter');
   await expect(durationInput).toHaveValue('10');
   assert.equal(await page.evaluate(()=>window.sim.getState().parameters.durationSeconds),10);
   assert.equal(await page.evaluate(()=>window.sim.getState().parameters.maxIterations),25);
 }
 // The actual model selector must discard the previous model's unsubmitted draft.
 await replaceWithKeyboard(lengthInput,'8.2');
 await page.locator('[data-slot=card]').filter({has:page.getByText('台式机箱风道',{exact:true})}).getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='desktop-airflow');
 await expect(lengthInput).toHaveValue('0.45');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),0.45);
 await page.evaluate(()=>{window.sim.getState().updateParameters(window.numericInitialParameters);window.project.getState().setActiveModel(window.numericInitialModel);window.project.getState().removeUploadedModel('desktop-airflow');window.requests=[]});
 await expect(lengthInput).toHaveValue('4.5');
 await page.evaluate(()=>{
   window.anonymous=true;window.project.getState().addUploadedModel(window.localModel);
   window.numericSubmissions=[];window.numericPostMessage=Worker.prototype.postMessage;
   Worker.prototype.postMessage=function(...args){if(args[0]?.spec?.kind==='lbm-d3q19')window.numericSubmissions.push(structuredClone(args[0].spec));return window.numericPostMessage.apply(this,args)};
 });
 await replaceWithKeyboard(lengthInput,'4.6');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),4.5);
 console.log('PASS Lab numeric keyboard drafts: clear/retype 4.5→4.6, decimals/scientific notation, Enter/Escape, invalid/empty blur restore, minimum 10-second duration, model switch');
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='running'&&!!window.pendingWorkerSpec);
 const numericUnits=await page.evaluate(()=>window.currentUnits());
 assert.equal(await page.evaluate(()=>window.numericSubmissions.length),1);
 assert.equal(await page.evaluate(()=>window.numericSubmissions[0].model.referenceLength),4.6);
 assert.equal(await page.evaluate(()=>window.numericSubmissions[0].run.maxSteps),Math.ceil(10/numericUnits.dt));
 assert.equal(await page.evaluate(()=>window.pendingWorkerSpec.run.stopWhen),undefined);
 await page.evaluate(()=>window.replyToPendingWorker({type:'progress',progress:{step:3,total:window.pendingWorkerSpec.run.maxSteps}}));
 await waitFor(()=>window.sim.getState().state.currentIteration===3);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.currentTime),3*numericUnits.dt);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 await page.locator('#stop').click();
 await waitFor(()=>window.execution.status==='canceled');
 // Cancellation clears incomplete progress/results. Late Worker messages must
 // not restore either the old progress or a new completed-looking state.
 assert.deepEqual(await page.evaluate(()=>{const s=window.sim.getState().state;return [s.currentIteration,s.currentTime]}),[0,0]);
 await page.evaluate(()=>window.replyToPendingWorker({type:'progress',progress:{step:99,total:window.pendingWorkerSpec.run.maxSteps}}));
 assert.deepEqual(await page.evaluate(()=>{const s=window.sim.getState().state;return [s.currentIteration,s.currentTime]}),[0,0]);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 await page.evaluate(()=>window.runShort());
 assert.equal(await page.evaluate(()=>window.execution.error),null);
 assert.equal(await page.evaluate(()=>window.requests.length),0);
 assert.equal(await page.evaluate(()=>window.execution.jobId),null);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot.step),3);
 const groupedMask=await page.evaluate(()=>window.expectedGroupedMask());
 assert.ok(groupedMask.solidCells>groupedMask.parityCells);
 assert.deepEqual(await page.evaluate(()=>Array.from(window.sim.getState().results.flowSnapshot.flags)),groupedMask.flags);
 assert.equal(await page.evaluate(()=>Array.from(window.sim.getState().results.flowSnapshot.flags).filter(flag=>flag===1).length),groupedMask.solidCells);
 assert.equal(await page.evaluate(()=>Number.isFinite(window.sim.getState().state.dragCoefficient)),true);
 assert.equal(await page.evaluate(()=>window.numericSubmissions.length),2);
 assert.equal(await page.evaluate(()=>window.numericSubmissions[1].model.referenceLength),4.6);
 assert.equal(await page.evaluate(()=>window.numericSubmissions[1].run.maxSteps),3);
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.durationSeconds),10);
 await page.evaluate(()=>{window.numericFinalField=window.sim.getState().results.flowSnapshot});
 await replaceWithKeyboard(lengthInput,'8.2');
 await lengthInput.press('Escape');
 await replaceWithKeyboard(lengthInput,'');
 await lengthInput.press('Tab');
 await expect(lengthInput).toHaveValue('4.6');
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot===window.numericFinalField),true);
 await page.evaluate(()=>{Worker.prototype.postMessage=window.numericPostMessage;window.mountPanels(false)});
 console.log('PASS Lab start ordering: click commits 4.6 m to intercepted 10-second task; progress uses actual dt, late progress after cancellation is ignored; separate anonymous low-level 3-step Worker; zero API requests');
 if(process.argv.includes('--inputs-only')) {assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);return;}
 await page.locator('#publish').click();
 await waitFor(()=>window.execution.loginRequired);
 assert.equal(await page.evaluate(()=>window.requests.every(r=>r.method==='GET'&&r.url.endsWith('/me'))),true);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot.step),3);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot===window.numericFinalField),true);
 await page.evaluate(()=>window.project.getState().setActiveModel(window.numericInitialModel));
 await page.locator('#start').click();
 await page.locator('#stop').click();
 await waitFor(()=>window.execution.status==='canceled');
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 // Flow computation must survive the former 120-second cutoff and remain cancellable.
 // The long request stays intercepted; this check executes no numerical steps.
 await page.evaluate(()=>{window.flowDeadlines=0;window.nativeTimeout=window.setTimeout;window.setTimeout=(callback,ms,...args)=>{if(ms===120000)window.flowDeadlines++;return window.nativeTimeout(callback,ms===120000?0:ms,...args)}});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='running');
 await page.evaluate(()=>new Promise(resolve=>window.nativeTimeout(resolve,20)));
 assert.equal(await page.evaluate(()=>window.execution.status),'running');
 assert.equal(await page.evaluate(()=>window.flowDeadlines),0);
 await page.evaluate(()=>{window.setTimeout=window.nativeTimeout});
 await page.locator('#stop').click();
 await waitFor(()=>window.execution.status==='canceled');
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.job),null);
 assert.equal(await page.evaluate(()=>window.execution.jobId),null);
 await page.evaluate(()=>{window.anonymous=false;window.requests=[];window.project.getState().addUploadedModel(window.initialModel);});
 console.log('PASS anonymous Lab: real Worker 3-step WASM union matches WGM2/Host preparation with explicit overlapping solids, no HTTP, stopping, login before publishing/upload and retained local result');
 await page.locator('#backend').click();
 await waitFor(()=>window.execution.target==='backend');
 await page.evaluate(()=>{window.shortRemoteResult=true});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='failed');
 assert.match(await page.evaluate(()=>window.execution.error),/物理仿真尚未完成：仅计算 25 \/ /);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 await page.evaluate(()=>{window.shortRemoteResult=false});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 assert.equal(await page.evaluate(()=>window.gpuRequests),0);
 assert.equal(await page.evaluate(()=>window.requests.every(r=>r.url.startsWith('/host-api/api/v1/')&&r.credentials==='include')),true);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.dragCoefficient),0.4);
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().state.cdHistory),[0.5,0.4]);
 // Post-processing fixture only: nonuniform recorded times, more than the former
 // 200-sample display cap, signed small forces, and no additional solver work.
 await page.evaluate(()=>{
   const s=window.sim.getState();window.beforeForceChart={job:s.results.job,field:s.results.flowSnapshot,state:s.state};
   const step=[10,40,...Array.from({length:299},(_,i)=>100+i*20)];
   window.forceChartResult={...s.results.job.result,summary:{...s.results.job.result.summary,steps:step.at(-1)},derived:{...s.results.job.result.derived,dt:0.002},
     history:{step,cd:step.map((_,i)=>i===0?-1:i/300),cl:step.map(()=>0.25),dragN:step.map((_,i)=>i===0?-0.00001:i/100),liftN:step.map(()=>0.00003)}};
   s.updateResults({job:{...s.results.job,result:window.forceChartResult}});window.mountPanels(true);
 });
 const forceChart=page.getByLabel('气动力时序',{exact:true});
 await forceChart.getByRole('img',{name:/301 个采样点，无量纲/}).waitFor();
 const coordinates=await forceChart.locator('path[data-quantity="cd"]').getAttribute('d');
 assert.equal(coordinates.split(' ').length,301);
 const pointX=coordinates.split(' ').map(point=>Number(point.slice(1).split(',')[0]));
 assert.equal(pointX[0],64);assert.equal(pointX.at(-1),300);
 assert.equal(pointX[1],Number((64+236*(40-10)/(6060-10)).toFixed(2)));
 const sampleControl=forceChart.getByRole('slider',{name:'气动力采样点',exact:true});
 await sampleControl.press('Home');
 await expect(forceChart.getByLabel('气动力采样值',{exact:true})).toContainText('第 10 步 · 物理时间 0.0200000 s · 样本 1/301');
 await expect(forceChart.getByLabel('气动力采样值',{exact:true})).toContainText('Cd -1.0000 无量纲');
 await forceChart.getByRole('button',{name:'作用力（N）',exact:true}).click();
 await expect(forceChart.getByLabel('气动力采样值',{exact:true})).toContainText('阻力 -0.000010000 N');
 await sampleControl.press('End');
 await expect(forceChart.getByLabel('气动力采样值',{exact:true})).toContainText('第 6060 步 · 物理时间 12.1200 s · 样本 301/301');
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot===window.beforeForceChart.field),true);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.currentTime===window.beforeForceChart.state.currentTime),true);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.dragCoefficient),0.4);
 for(const invalid of ['dt','step','order','length','finite','non-array-step','non-array-series','null-series','sparse-step']) {
   await page.evaluate(invalid=>{
     const r=window.forceChartResult,broken={...r,history:{...r.history},derived:{...r.derived}};
     if(invalid==='dt')delete broken.derived.dt;
     if(invalid==='step')delete broken.history.step;
     if(invalid==='order')broken.history.step=[...r.history.step].reverse();
     if(invalid==='length')broken.history.dragN=[1];
     if(invalid==='finite')broken.history.dragN=r.history.dragN.map((v,i)=>i? v:NaN);
     if(invalid==='non-array-step')broken.history.step='123';
     if(invalid==='non-array-series')broken.history.dragN={length:r.history.step.length};
     if(invalid==='null-series')broken.history.dragN=null;
     if(invalid==='sparse-step'){broken.history.step=[...r.history.step];delete broken.history.step[1]}
     window.sim.getState().updateResults({job:{...window.beforeForceChart.job,result:broken}});
   },invalid);
   await expect(forceChart.getByText(/未保存有效的气动力时序/)).toBeVisible();
   assert.equal(await forceChart.getByRole('img').count(),0);
 }
 await page.evaluate(()=>{window.sim.getState().updateResults({job:window.beforeForceChart.job});window.mountPanels(false)});
 console.log('PASS complete force history: 301 saved samples, nonuniform physical-time axis from saved dt, coefficient/N selection, exact signed values, invalid metadata rejected, final field/statistics unchanged; zero extra numerical steps');
 const spec=await page.evaluate(()=>window.requests.find(r=>r.body?.spec).body.spec);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot.step),spec.run.maxSteps);
 assert.deepEqual(spec.requirements.backends,['cpu']);assert.equal(spec.requirements.precision,'mixed');
 const remoteUnits=await page.evaluate(spec=>window.unitsForSpec(spec),spec);
 assert.equal(spec.run.maxSteps,Math.ceil(10/remoteUnits.dt));assert.equal(spec.model.referenceLength,4.5);assert.equal(spec.model.source,'artifact');assert.equal(spec.model.artifactId,'mesh-1');
 assert.equal(await page.evaluate(()=>window.sim.getState().state.currentTime),spec.run.maxSteps*remoteUnits.dt);
 assert.deepEqual(spec.outputs.fields,['velocity','vorticity','pressure']);
 assert.deepEqual(await page.evaluate(()=>window.decodeGeometry(window.requests.find(r=>r.url.endsWith('/artifacts')).bytes)),[0,0,0,1.25,0,0,0,1,0]);
 await page.evaluate(()=>window.execution.setBackend('webgpu'));
 await waitFor(()=>window.execution.backend==='webgpu' && window.sim.getState().results.flowSnapshot===null);
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 const gpuSpec=await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).at(-1).body.spec);
 assert.deepEqual(gpuSpec.requirements.backends,['webgpu']);assert.equal(gpuSpec.requirements.precision,'float32');
 assert.deepEqual(gpuSpec.parameters,spec.parameters);assert.deepEqual(gpuSpec.model,spec.model);
 assert.equal(await page.evaluate(()=>window.gpuRequests),0);
 // Mount the actual volume renderer only after the remote field arrives. It uploads data and draws, never solves.
 await page.evaluate(()=>window.mountCanvas(true));
 await waitFor(()=>window.gpuDraws>0);
 if(process.argv.includes('--webgpu')) {
   const errors=await page.evaluate(async()=>{
     const adapter=await window.nativeGpu.requestAdapter();
     if(!adapter)throw new Error('Renderer WGSL validation requires a WebGPU adapter');
     const device=await adapter.requestDevice();
     try{return (await device.createShaderModule({code:window.renderShaderCode}).getCompilationInfo()).messages.filter(message=>message.type==='error').map(message=>message.message)}
     finally{device.destroy()}
   });
   assert.deepEqual(errors,[]);
 }
 assert.equal(await page.evaluate(()=>window.gpuWrites.filter(values=>values.length===36).at(-1)[29]),0);
 await page.evaluate(()=>{const s=window.sim.getState();window.savedDerived=s.derived;s.setDerived({...s.derived,'lbm-ground-v1':1,groundMode:'moving',groundClearanceM:0.08,groundVelocityMps:10})});
 await page.getByLabel('流场地面',{exact:true}).getByText(/移动地面.*10 m\/s.*0.08 m/).waitFor();
 await waitFor(()=>window.gpuWrites.filter(values=>values.length===36).at(-1)[29]===1);
 await page.evaluate(()=>window.sim.getState().setDerived(window.savedDerived));
 await waitFor(()=>window.gpuWrites.filter(values=>values.length===36).at(-1)[29]===0);
 assert.equal(await page.evaluate(()=>window.gpuComputePipelines),0);
 assert.equal(await page.evaluate(()=>window.sim.getState().gpuContext.errorMessage),null);
 assert.deepEqual(await page.evaluate(()=>window.gpuWrites.find(values=>values.length===24)),Array.from({length:24},(_,i)=>i/32));
 const draws=await page.evaluate(()=>window.gpuDraws);
 await page.evaluate(()=>{window.sim.getState().setVisualizationMode('vorticity');window.sim.getState().setSlicePlane('xy');window.sim.getState().setSlicePosition(0.25)});
 await waitFor(count=>window.gpuDraws>count,draws);
 await page.locator('canvas').dispatchEvent('wheel',{deltaY:100});
 assert.equal(await page.evaluate(()=>window.sim.getState().state.currentIteration),spec.run.maxSteps);
 const buffersBeforeResize=await page.evaluate(()=>window.gpuBuffers.length);
 const requestsBeforeResize=await page.evaluate(()=>window.requests.length);
 await page.locator('canvas').evaluate(canvas=>{canvas.style.width='100%';canvas.style.height='100%';canvas.parentElement.style.width='320px';canvas.parentElement.style.height='200px'});
 await waitFor(()=>document.querySelector('canvas').width===320*devicePixelRatio&&document.querySelector('canvas').height===200*devicePixelRatio);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.currentIteration),spec.run.maxSteps);
 assert.equal(await page.evaluate(()=>window.gpuBuffers.length),buffersBeforeResize);
 assert.equal(await page.evaluate(()=>window.requests.length),requestsBeforeResize);
 await page.evaluate(()=>window.mountCanvas(false));
 await waitFor(()=>window.gpuBuffers.every(buffer=>buffer.destroyed));
 // Losing the display device leaves WASM execution running and the saved field viewable.
 await page.evaluate(()=>{window.sim.getState().setComputeTarget('browser');window.sim.getState().setState({isRunning:true});window.loseGpu({message:'test display loss'})});
 await waitFor(()=>window.sim.getState().gpuContext.device===null);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.isRunning),true);
 await page.evaluate(()=>{window.sim.getState().setState({isRunning:false});window.sim.getState().setComputeTarget('backend');window.mountCanvas(true)});
 const slice=page.getByRole('img',{name:'二维流场剖面'});
 await slice.waitFor({state:'visible'});
 const pixelsBefore=await slice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
 assert.ok(pixelsBefore.some((value,i)=>i%4!==3&&value>0));
 await page.evaluate(()=>{window.sim.getState().setSlicePlane('yz');window.sim.getState().setSlicePosition(1)});
 await page.getByText(/YZ 剖面 100%/).waitFor();
 const pixelsAfter=await slice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
 assert.notDeepEqual(pixelsAfter,pixelsBefore);
 // A replayed thermal field keeps its saved Celsius scale, independently of current 25/60 inputs.
 await page.evaluate(()=>{
   const store=window.sim.getState(),snapshot=store.results.flowSnapshot;
   store.setDerived({...store.derived,ambientC:30,temperatureScaleC:10,thermalDiffusivityPhysical:0.00002});
   store.updateResults({flowSnapshot:{...snapshot,displayStride:4,hasPressure:true,display:new Float32Array(32).fill(0.5)}});
   store.setVisualizationMode('temperature');
 });
 await page.getByText(/温度峰值 35.0 °C/).waitFor();
 assert.deepEqual(await slice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,1,1).data)),[128,255,128,255]);
 await page.getByText(/色标蓝→红 30.0–40.0 °C，模型按温度着色/).waitFor();
 await page.evaluate(()=>{const s=window.sim.getState();window.savedDerived=s.derived;s.setDerived({...s.derived,'lbm-ground-v1':1,groundMode:'moving',groundClearanceM:0.08,groundVelocityMps:10})});
 await page.getByText(/Y=0 移动地面（黄线），速度 10 m\/s，最低点间隙 0.08 m/).waitFor();
 assert.deepEqual(await slice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,1,1).data)),[251,191,36,255]);
 await page.evaluate(()=>window.sim.getState().setDerived(window.savedDerived));
 await page.evaluate(()=>window.mountPanels(true));
 await expect(page.getByRole('combobox',{name:'物性模式',exact:true})).toContainText('流动演示（调整黏度）');
 await page.getByText('数值表示：FP32',{exact:true}).waitFor();
 const thermalCard=page.locator('[aria-label="最终流场结果"]');
 await thermalCard.getByText('流体温度范围',{exact:true}).waitFor();
 assert.equal(await thermalCard.getByText('35.00–35.00 °C',{exact:true}).count(),2);
 assert.equal(await thermalCard.getByText(/达到指定步数不代表已收敛/).isVisible(),true);
 await page.evaluate(()=>window.mountPanels(false));
 assert.equal(await page.evaluate(()=>window.gpuRequests),1);
 assert.equal(await page.evaluate(()=>window.gpuComputePipelines),0);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot.step),spec.run.maxSteps);
 await page.evaluate(()=>window.mountCanvas(false));
 // Display changes keep results; changed physics invalidates even a completed result.
 await page.evaluate(()=>window.sim.getState().updateParameters({renderQuality:'fast'}));
 assert.equal(await page.evaluate(()=>window.sim.getState().state.dragCoefficient),0.4);
 await page.evaluate(()=>window.sim.getState().updateParameters({inletVelocity:12}));
 await waitFor(()=>window.execution.status==='idle');
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().state.cdHistory),[]);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 await page.locator('#local').click();
 await waitFor(()=>window.execution.target==='browser');
 assert.equal(await page.evaluate(()=>window.sim.getState().state.currentIteration),0);
 await page.locator('#publish').click();
 await waitFor(()=>window.execution.status==='failed');
 assert.match(await page.evaluate(()=>window.execution.error),/发布计算任务需要登录/);
 assert.equal(await page.evaluate(()=>window.requests.find(r=>r.body?.execution==='browser').body.spec.requirements.precision),'float32');
 assert.equal(await page.evaluate(()=>window.gpuRequests),1);
 await page.locator('#stop').click();
 await page.locator('#backend').click();
 await waitFor(()=>window.execution.target==='backend');
 await page.evaluate(()=>{window.jobStatus='running'});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='running');
 assert.deepEqual(await page.evaluate(()=>{const s=window.sim.getState().state;return [s.currentIteration,s.currentTime]}),[5,5*(await page.evaluate(()=>window.currentUnits())).dt]);
 await page.locator('#stop').click();
 await waitFor(()=>window.execution.status==='canceled');
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.url.endsWith('/cancel')).length),1);
 assert.equal(await page.evaluate(()=>window.sim.getState().state.dragCoefficient),null);
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.url.endsWith('/artifacts')).length),1);
 // Actual uploader selects the parsed mesh; stopping its transfer never submits a job.
 await page.getByRole('tab',{name:'上传模型'}).click();
 await page.getByText('旧模型未记录边界检查，请重新导入').first().waitFor();
 await page.locator('input[type=file]').setInputFiles({name:'custom-car.stl',mimeType:'model/stl',buffer:Buffer.from('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test')});
 await waitFor(()=>window.project.getState().activeModel?.name.includes('custom-car'));
 await page.getByText('几何边界需检查',{exact:true}).waitFor();
 await page.getByText(/开口边 3 · 多面共边 0 · 方向冲突 0 · 退化面 0/).waitFor();
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.sourceModel.isWatertight),false);
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.id===window.project.getState().activeModel.sourceModel.id),true);
 const before=await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).length);
 await page.evaluate(()=>{window.holdUpload=true});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='uploading');
 await page.locator('#stop').click();
 await waitFor(()=>window.execution.status==='canceled');
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).length),before);
 // Never display a corrupted/stale downloaded result as a successful field.
 await page.evaluate(()=>{window.holdUpload=false;window.jobStatus='succeeded';window.badFlowHash=true});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='failed');
 assert.match(await page.evaluate(()=>window.execution.error),/校验失败/);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 assert.equal(await page.evaluate(()=>window.gpuComputePipelines),0);
 // Real preset selector and fan controls use the same submitted scene and reset completed results.
 await page.evaluate(()=>{window.badFlowHash=false;window.mountPanels(true)});
 await page.getByRole('tab',{name:'预设模型'}).click();
 // Uploaded-model cards also use data-slot=card inside the ScrollArea; preset clicks must
 // target only the selector cards, not the 已加载模型 list entries.
 const presetCard=name=>page.locator('xpath=//*[@data-slot="card"][not(ancestor::*[@data-slot="scroll-area-viewport"])]').filter({has:page.getByText(name,{exact:true})});
 await presetCard('台式机箱风道').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='desktop-airflow');
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.inletVelocity),0);
 assert.equal(await page.getByRole('switch',{name:'启用风扇'}).isChecked(),true);
 await page.getByRole('slider',{name:'风扇压升',exact:true}).press('ArrowRight');
 await waitFor(()=>window.sim.getState().parameters.fan?.pressureRisePa===21);
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 const fanSpec=await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).at(-1).body.spec);
 assert.deepEqual(fanSpec.parameters.fan,{center:[0.15,0.65,0.5],axis:'x',radiusM:0.06,pressureRisePa:21});
 assert.equal(fanSpec.model.referenceLength,0.45);
 assert.equal(fanSpec.parameters.inletVelocity,0);
 assert.equal(await page.getByText('本次结果未提供力系数。入口速度为 0 时系数不适用；作用力仍以 N 显示。').isVisible(),true);
 await expect(forceChart.getByRole('button',{name:'力系数',exact:true})).toBeDisabled();
 await forceChart.getByRole('img',{name:/2 个采样点，N/}).waitFor();
 await expect(forceChart.getByLabel('气动力采样值',{exact:true})).toContainText('阻力 12.000 N');
 await page.getByRole('switch',{name:'启用风扇'}).press('Space');
 await waitFor(()=>window.execution.status==='idle'&&window.sim.getState().results.flowSnapshot===null);
 await presetCard('笔记本风道（简化）').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='laptop-airflow');
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.fan.radiusM),0.01);
 await page.evaluate(()=>window.sim.getState().updateParameters({thermalEnabled:true}));
 await expect(page.getByRole('combobox',{name:'物性模式',exact:true})).toContainText('真实物性（网格须满足要求）');
 await expect(page.getByRole('combobox',{name:'物性模式',exact:true})).toBeDisabled();
 await page.getByRole('combobox',{name:'热源设置'}).click();
 await page.getByRole('option',{name:'材料导热与发热功率'}).click();
 await commitNumber(page.getByLabel('模型总发热功率 (W)',{exact:true}),'12');
 assert.deepEqual(await page.evaluate(()=>{const p=window.sim.getState().parameters;return [p.thermalMode,p.totalPowerW,p.dtSeconds]}),['solid-power',12,0.0001]);
 assert.equal(await page.getByLabel('默认固体导热系数 (W/m·K)',{exact:true}).inputValue(),'200');
 await page.evaluate(()=>window.sim.getState().updateResults({thermal:{mode:'solid-power',solidVolumeM3:0.000001,
   thermalEnergyJ:0.003,sourceEnergyJ:0.003,boundaryEnergyJ:0,energyResidualJ:0,maxAbsEnergyResidualJ:0,
   thermalSubsteps:1,solidMaxC:25.001,fluidMaxC:25}}));
 await page.evaluate(()=>window.sim.getState().setState({currentIteration:3}));
 await page.locator('[aria-label="热量收支"]').getByText('累计功率输入',{exact:true}).waitFor();
 await presetCard('厘米级发热块').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='heated-block');
 assert.deepEqual(await page.evaluate(()=>{const p=window.sim.getState().parameters;return [p.thermalMode,p.totalPowerW,p.inletVelocity,p.durationSeconds,p.solidConductivityWmK]}),['solid-power',10,0,10,200]);
 // Preserve all shipped heatsink physics; only the low-level CI step budget is short.
 await page.evaluate(()=>window.mountPersistence(true));
 await waitFor(()=>window.persistence?.ready);
 const modelRequestsBeforeHeatsink=modelRequests.length;
 await page.evaluate(()=>{window.shippedModels=true;window.anonymous=true;window.requests=[]});
 await presetCard('鳍片散热器').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='heatsink');
 assert.ok(modelRequests.slice(modelRequestsBeforeHeatsink).includes('/models/heatsink.stl'));
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.sourceModel.fileSize),require('node:fs').statSync(root+'/apps/lab/public/models/heatsink.stl').size);
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.durationSeconds),10);
 assert.equal(await page.evaluate(()=>window.currentScene().spec.parameters.dtSeconds),undefined);
 await expect(presetCard('鳍片散热器').filter({has:page.getByRole('button')})).not.toContainText('已使用可运行的简化模型');
 await page.evaluate(()=>window.execution.setBackend('cpu'));
 await page.locator('#local').click();
 await waitFor(()=>window.execution.target==='browser'&&window.execution.backend==='cpu');
 const heatsinkUnits=await page.evaluate(()=>window.currentUnits());
 await expect(durationInput).toHaveValue('10');
 const tenSeconds=await page.evaluate(()=>window.currentScene().spec);
 assert.equal(tenSeconds.run.maxSteps,Math.ceil(10/heatsinkUnits.dt));
 assert.ok(tenSeconds.run.maxSteps*heatsinkUnits.dt>=10&&(tenSeconds.run.maxSteps-1)*heatsinkUnits.dt<10);
 assert.deepEqual(await page.evaluate(()=>window.currentUnits()),heatsinkUnits);
 await expect(page.getByLabel('计算时长预估',{exact:true})).toContainText(tenSeconds.run.maxSteps.toLocaleString()+' 步');
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot),null);
 // The public workbench keeps its ten-second minimum even in the CI harness.
 await commitNumber(durationInput,String(3*heatsinkUnits.dt));
 await expect(durationInput).toHaveValue('10');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.run.maxSteps),tenSeconds.run.maxSteps);
 // The 保存流场回放 switch was replaced by the 回放帧率 select in 4201046; pin the frame
 // path directly so playback records three full-resolution frames — the preset select
 // resets parameters to the new fieldFps:30/fieldStride:4 defaults, and the slice
 // pixel-diff assertions below need the un-decimated field.
 await page.evaluate(()=>window.sim.getState().updateParameters({fieldFrames:3,fieldFps:undefined,fieldStride:1}));
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.fieldFrames),3);
 await page.evaluate(()=>{
   window.HeatsinkWorker=window.Worker;window.heatsinkWorkerStarts=0;window.heatsinkWorkerResults=[];window.heatsinkWorkerFrames=0;
   window.Worker=class extends window.HeatsinkWorker{
     constructor(...args){super(...args);window.heatsinkWorkerStarts++;this.addEventListener('message',({data})=>{if(data.type==='result')window.heatsinkWorkerResults.push(data.result);if(data.type==='frame')window.heatsinkWorkerFrames++})}
   };
 });
 await page.evaluate(()=>window.runShort());
 assert.equal(await page.evaluate(()=>window.execution.error),null);
 assert.equal(await page.evaluate(()=>window.execution.jobId),null);
 assert.equal(await page.evaluate(()=>window.requests.length),0);
 assert.equal(await page.evaluate(()=>window.heatsinkWorkerStarts),1);
 assert.equal(await page.evaluate(()=>window.heatsinkWorkerResults.length),1);
 assert.equal(await page.evaluate(()=>window.heatsinkWorkerFrames),3);
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().results.flowFrames.map(frame=>frame.step)),[1,2,3]);
 const frameHashes=await page.evaluate(()=>window.savedFrameHashes());
 assert.equal(new Set(frameHashes.map(hash=>hash.join(','))).size,3);
 const heatsink=await page.evaluate(()=>{
   const state=window.sim.getState(),snapshot=state.results.flowSnapshot;
   return {parameters:state.parameters,result:window.heatsinkWorkerResults[0],step:snapshot.step,stride:snapshot.displayStride,
     finite:Array.from(snapshot.display).every(Number.isFinite),cells:snapshot.flags.length,solidCells:Array.from(snapshot.flags).filter(flag=>flag!==0).length,
     summary:window.summarizeFlowSnapshot(snapshot,state.derived),forces:state.results.forces};
 });
 assert.equal(heatsink.parameters.gridPreset,'fast');
 assert.equal(heatsink.parameters.thermalMode,'fixed-temperature');
 assert.equal(heatsink.parameters.fluidDensity,1.225);
 assert.equal(heatsink.parameters.fluidViscosity,1.81e-5);
 assert.equal(heatsink.result.derived.engine,'rust-wasm');
 assert.equal(heatsink.result.derived.viscosityMode,'physical');
 assert.equal(heatsink.result.derived.dt,heatsinkUnits.dt);
 assert.ok(Math.abs(heatsink.result.derived.simulatedViscosityM2s/(1.81e-5/1.225)-1)<1e-12);
 assert.equal(heatsink.result.summary.steps,3);assert.equal(heatsink.step,3);assert.equal(heatsink.stride,4);assert.equal(heatsink.result.derived['lbm-pressure-field-v1'],1);
 assert.equal(heatsink.finite,true);assert.ok(heatsink.solidCells>0&&heatsink.solidCells<heatsink.cells);
 assert.ok(heatsink.summary.maxSpeedMps>0);
 assert.ok(heatsink.summary.fluidTemperatureC.max>25);
 assert.deepEqual(heatsink.summary.solidTemperatureC,{min:60,max:60});
 assert.deepEqual(heatsink.result.history.step,[3]);
 assert.equal(heatsink.result.summary.cd,undefined);assert.equal(heatsink.result.summary.cl,undefined);
 for(const key of ['dragN','liftN'])assert.ok(heatsink.result.history[key].length===1&&heatsink.result.history[key].every(Number.isFinite));
 assert.equal(heatsink.forces.drag,heatsink.result.history.dragN[0]);
 assert.equal(heatsink.forces.lift,heatsink.result.history.liftN[0]);
 await forceChart.getByRole('img',{name:/1 个采样点，N/}).waitFor();
 await expect(forceChart.getByRole('slider',{name:'气动力采样点',exact:true})).toBeDisabled();
 await expect(forceChart.getByLabel('气动力采样值',{exact:true})).toContainText(`阻力 ${heatsink.result.history.dragN[0].toPrecision(5)} N`);
 await page.getByLabel('最终流场结果',{exact:true}).getByText('60.00–60.00 °C',{exact:true}).waitFor();
 await page.getByLabel('最终流场结果',{exact:true}).getByText(/第 3 步/).waitFor();
 // Reuse this real three-step result: the report contains saved SI masses, not
 // quantities reconstructed from sparse display frames or the current inputs.
 const massBalance=heatsink.result.lbmMassBalance;
 assert.equal(massBalance?.scope,'internal-fluid-x');
 const massRows=[['初始质量','initialMassKg'],['最终质量','finalMassKg'],
   ['入口累计净流入','inletMassKg'],['出口累计净流出','outletMassKg'],
   ['碰撞累计质量变化','collisionMassChangeKg'],['累计收支残差','balanceResidualKg'],
   ['单步最大绝对残差','maxAbsStepBalanceResidualKg'],['边界层最终质量','boundaryFinalMassKg'],
   ['入口累计重构量','inletReconstructionMassKg'],['出口累计重构量','outletReconstructionMassKg']];
 for(const [,key] of massRows)assert.ok(Number.isFinite(massBalance[key]),key);
 const validationDetails=page.locator('details').filter({has:page.locator('summary').getByText('模型与验证范围',{exact:true})});
 const massReport=page.getByLabel('质量收支',{exact:true});
 assert.equal(await validationDetails.evaluate(details=>details.open),false);
 await expect(massReport).not.toBeVisible();
 await validationDetails.locator('summary').click();
 await expect(massReport).toContainText('覆盖第 1 至 3 步，包含预热阶段；不含进出口的数值边界层。');
 await expect(massReport).toContainText('内部流体质量收支（kg）');
 const expectedMassRows=massRows.map(([label,key])=>[label,massBalance[key].toExponential(4)]);
 const displayedMassRows=()=>massReport.locator('dl > div').evaluateAll(rows=>rows.map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]));
 assert.deepEqual(await displayedMassRows(),expectedMassRows);
 const savedMassText=await massReport.innerText();
 // Saved frames drive the actual 2D display while the final result card stays at step 3.
 await page.evaluate(()=>{window.sim.getState().setSlicePlane('xy');window.sim.getState().setSlicePosition(0.5);window.mountCanvas(true)});
 const replaySlice=page.getByRole('img',{name:'二维流场剖面'});
 await replaySlice.waitFor({state:'visible'});
 const finalPixels=await replaySlice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
 await page.getByRole('slider',{name:'回放帧',exact:true}).press('Home');
 await page.getByRole('slider',{name:'回放帧',exact:true}).press('ArrowRight');
 await expect(page.getByLabel('当前帧物理时刻',{exact:true})).toContainText('第 2 步 · 帧 2/3');
 const earlierPixels=await replaySlice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
 assert.notDeepEqual(earlierPixels,finalPixels);
 await page.getByLabel('最终流场结果',{exact:true}).getByText(/第 3 步/).waitFor();
 const playbackResources=await page.evaluate(()=>{
   window.playbackSteps=[];window.stopPlaybackAudit=window.sim.subscribe((next,previous)=>{if(next.state.playbackIndex!==previous.state.playbackIndex)window.playbackSteps.push(next.results.flowFrames[next.state.playbackIndex]?.step)});
   return {workers:window.heatsinkWorkerStarts,buffers:window.gpuBuffers.length,devices:window.gpuRequests,pipelines:window.gpuComputePipelines};
 });
 const playbackDurationInput=page.getByLabel('一轮播放用时（s）',{exact:true});
 const initialPlaybackDuration=await page.evaluate(()=>window.sim.getState().state.playbackDuration);
 await replaceWithKeyboard(playbackDurationInput,'');
 await expect(playbackDurationInput).toHaveValue('');
 assert.equal(await page.evaluate(()=>window.sim.getState().state.playbackDuration),initialPlaybackDuration);
 await playbackDurationInput.pressSequentially('0.6');
 await playbackDurationInput.press('Tab');
 assert.equal(await page.evaluate(()=>window.sim.getState().state.playbackDuration),0.6);
 await page.getByLabel('循环播放',{exact:true}).check();
 await replaceWithKeyboard(playbackDurationInput,'0.3');
 assert.equal(await page.evaluate(()=>window.sim.getState().state.playbackDuration),0.6);
 await page.getByRole('button',{name:'播放回放',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sim.getState().state.playbackDuration),0.3);
 await waitFor(()=>window.playbackSteps.filter(step=>step===1).length>=2);
 await page.getByRole('button',{name:'暂停回放',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sim.getState().state.isPlaying),false);
 assert.deepEqual(await page.evaluate(()=>({workers:window.heatsinkWorkerStarts,buffers:window.gpuBuffers.length,devices:window.gpuRequests,pipelines:window.gpuComputePipelines})),playbackResources);
 assert.deepEqual(await page.evaluate(()=>window.savedFrameHashes()),frameHashes);
 assert.equal(await page.evaluate(()=>window.sim.getState().results.flowSnapshot.step),3);
 assert.equal(await page.evaluate(()=>window.sim.getState().derived.dt),heatsinkUnits.dt);
 await page.getByRole('button',{name:'查看最终帧',exact:true}).click();
 await expect(page.getByLabel('当前帧物理时刻',{exact:true})).toContainText('第 3 步 · 帧 3/3');
 assert.deepEqual(await replaySlice.evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)),finalPixels);
 await page.evaluate(()=>{window.stopPlaybackAudit();return window.persistence.saveCurrentProject()});
 await expect(page.getByLabel('项目保存状态',{exact:true})).toContainText('已保存');
 const savedCalculation=await page.evaluate(()=>window.sim.getState().results.job);
 await page.evaluate(()=>window.mountPersistence(false));
 await page.getByLabel('项目保存状态',{exact:true}).waitFor({state:'detached'});
 await page.evaluate(()=>{window.sim.getState().clearResults();window.project.getState().setActiveModel(null);window.mountPersistence(true)});
 await waitFor(()=>window.persistence?.ready&&window.sim.getState().results.flowFrames.length===3);
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.id),'heatsink');
 assert.deepEqual(await page.evaluate(()=>window.savedFrameHashes()),frameHashes);
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().results.job),savedCalculation);
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().results.job.result.lbmMassBalance),massBalance);
 if(!await validationDetails.evaluate(details=>details.open))await validationDetails.locator('summary').click();
 assert.equal(await massReport.innerText(),savedMassText);
 assert.deepEqual(await displayedMassRows(),expectedMassRows);
 assert.equal(await page.evaluate(()=>window.heatsinkWorkerStarts),1);
 assert.equal(await page.evaluate(()=>window.requests.length),0);
 await page.getByLabel('最终流场结果',{exact:true}).getByText(/第 3 步/).waitFor();
 await page.evaluate(()=>{window.mountPersistence(false);window.mountCanvas(false)});
 await page.getByLabel('项目保存状态',{exact:true}).waitFor({state:'detached'});
 // Corrupted/legacy metadata are display fixtures only, never numerical evidence.
 // Persistence is unmounted so none can replace the verified saved calculation.
 await page.evaluate(()=>{const s=window.sim.getState();window.beforeMassDisplay={parameters:s.parameters,results:s.results,derived:s.derived,state:s.state}});
 for(const kind of ['absent','null','missing-field','nonfinite']){
   await page.evaluate(kind=>{
     const original=window.beforeMassDisplay.results.job,result={...original.result};
     if(kind==='absent')delete result.lbmMassBalance;
     else if(kind==='null')result.lbmMassBalance=null;
     else{result.lbmMassBalance={...result.lbmMassBalance};if(kind==='missing-field')delete result.lbmMassBalance.inletMassKg;else result.lbmMassBalance.balanceResidualKg=NaN}
     window.sim.getState().updateResults({job:{...original,result}});
   },kind);
   await expect(massReport).toHaveText(kind==='absent'?'本次结果未记录质量收支。':'本次质量收支记录不完整，无法显示。');
   await expect(massReport.locator('dd')).toHaveCount(0);
 }
 // A physics edit invalidates the result. If a historical result is viewed with
 // different current inputs, its recorded kg values must still remain exact.
 await page.evaluate(()=>{const s=window.beforeMassDisplay;window.sim.getState().updateResults(s.results);window.sim.getState().updateParameters({fluidDensity:s.parameters.fluidDensity*2})});
 assert.equal(await page.evaluate(()=>window.sim.getState().results.job),null);
 await expect(massReport).toHaveCount(0);
 await page.evaluate(()=>{const s=window.beforeMassDisplay;window.sim.setState({results:s.results,derived:s.derived,state:s.state})});
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.fluidDensity),heatsink.parameters.fluidDensity*2);
 if(!await validationDetails.evaluate(details=>details.open))await validationDetails.locator('summary').click();
 assert.deepEqual(await displayedMassRows(),expectedMassRows);
 await page.evaluate(()=>{const s=window.beforeMassDisplay;window.sim.getState().updateParameters(s.parameters);window.sim.setState({results:s.results,derived:s.derived,state:s.state})});
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().results.job),savedCalculation);
 assert.equal(await page.evaluate(()=>window.heatsinkWorkerStarts),1);
 assert.equal(await page.evaluate(()=>window.requests.length),0);
 console.log('PASS LBM mass report: real 3-step saved kg values, default disclosure, exact IDB restore, missing/corrupt records, physics invalidation and historical input independence; no additional solve');
 console.log('PASS shipped heatsink: anonymous low-level 3-step Worker/Rust/WASM, real temporal frames and force history, workbench retains 10-second minimum, looping/scrubbing without solving, exact IndexedDB field/result restore, zero API requests');
 await page.evaluate(()=>{window.Worker=window.HeatsinkWorker;window.shippedModels=false;window.anonymous=false});
 await page.evaluate(()=>window.sim.getState().updateParameters({fieldFrames:1,durationSeconds:10}));
 await page.locator('#backend').click();
 await waitFor(()=>window.execution.target==='backend');
 await page.evaluate(()=>window.execution.setBackend('webgpu'));
 await waitFor(()=>window.execution.backend==='webgpu');
 // Region controls feed the actual Rust/WASM solver; only three steps, then replay saved bytes.
 await presetCard('双材料导热与局部发热').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='thermal-assembly');
 await page.evaluate(()=>window.mountPreview(true));
 await page.getByLabel('部件区域预览').getByText('发热部件 · 10 W',{exact:true}).waitFor();
 await page.locator('summary').filter({hasText:'发热部件'}).click();
 await page.getByLabel('部件 1 名称',{exact:true}).fill('My heat source');
 await commitNumber(page.locator('#region-0-totalPowerW'),'12');
 await commitNumber(page.getByLabel('部件 1 x 终点 (%)',{exact:true}),'40');
 await commitNumber(page.getByLabel('部件 2 x 起点 (%)',{exact:true}),'40');
 await page.getByLabel('部件区域预览').getByText('My heat source · 12 W',{exact:true}).waitFor();
 const thermalResult=await page.evaluate(()=>window.runThermal());
 assert.equal(thermalResult.error,undefined,thermalResult.error);
 assert.equal(thermalResult.spec.parameters.thermalRegions[0].bounds.max[0],0.4);
 assert.ok(Math.abs(thermalResult.result.thermal.sourceEnergyJ-12*0.0001*3)<1e-12);
 const hotRegion=thermalResult.summary.solidRegions.find(region=>region.flag===5);
 const passiveRegion=thermalResult.summary.solidRegions.find(region=>region.flag===6);
 assert.ok(hotRegion.temperatureC.max>passiveRegion.temperatureC.max,JSON.stringify(thermalResult.summary.solidRegions));
 assert.ok(passiveRegion.temperatureC.max>25);
 const regionTable=page.getByRole('table',{name:'部件温度'});
 await regionTable.getByText('My heat source',{exact:true}).waitFor();
 assert.equal(await regionTable.getByRole('row').count(),thermalResult.summary.solidRegions.length+1);
 await page.getByRole('button',{name:'添加接触热阻',exact:true}).click();
 await waitFor(()=>window.sim.getState().results.flowSnapshot===null);
 await commitNumber(page.locator('#contact-0-resistance'),'0.001');
 const contactResult=await page.evaluate(()=>window.runThermal());
 assert.equal(contactResult.error,undefined,contactResult.error);
 assert.deepEqual(contactResult.spec.parameters.thermalContacts,[{first:1,second:2,resistanceM2KW:0.001}]);
 assert.equal(contactResult.result.thermal.sourceEnergyJ,thermalResult.result.thermal.sourceEnergyJ);
 const passiveContact=contactResult.summary.solidRegions.find(region=>region.flag===6);
 assert.ok(passiveContact.temperatureC.max>25 && passiveContact.temperatureC.max<passiveRegion.temperatureC.max);
 await page.getByRole('button',{name:'添加接触热阻',exact:true}).click();
 await page.getByRole('combobox',{name:'接触 2 第一部件',exact:true}).click();
 await page.getByRole('option',{name:'导热部件',exact:true}).click();
 const duplicate=await page.evaluate(()=>window.runThermal());
 assert.match(duplicate.error,/repeat.*pair/i);
 await page.getByRole('button',{name:'移除接触 2',exact:true}).click();

 if(process.env.WAVEWORLD_LAB_SCREENSHOT){
   const fs=require('node:fs'), cssDirectory=path.join(root,'apps/lab/.next/static/css');
   const css=fs.readdirSync(cssDirectory,{recursive:true}).filter(name=>name.endsWith('.css'))
     .map(name=>fs.readFileSync(path.join(cssDirectory,name),'utf8')).join('\n');
   await page.addStyleTag({content:css});
   await page.getByLabel('部件区域预览').locator('..').screenshot({path:process.env.WAVEWORLD_LAB_SCREENSHOT});
 }
 await page.getByRole('button',{name:'添加部件区域'}).click();
 await waitFor(()=>window.sim.getState().results.flowSnapshot===null);
 await page.getByLabel('部件 3 名称',{exact:true}).waitFor();
 const rejected=await page.evaluate(()=>window.runThermal());
 assert.match(rejected.error,/overlap/i);
 assert.equal(await page.getByLabel('部件 3 名称',{exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'移除部件 3',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.thermalRegions.length),2);
 // Deleting material 1 drops its pair and remaps a surviving default/material-2 pair.
 await page.getByRole('button',{name:'添加接触热阻',exact:true}).click();
 await page.getByRole('combobox',{name:'接触 2 第二部件',exact:true}).click();
 await page.getByRole('option',{name:'导热部件',exact:true}).click();
 await page.getByRole('button',{name:'移除部件 1',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.sim.getState().parameters.thermalContacts),[{first:0,second:1,resistanceM2KW:0}]);

 await page.evaluate(()=>window.mountPreview(false));
 await presetCard('简化汽车').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='car');
 assert.deepEqual(await page.evaluate(()=>{const p=window.sim.getState().parameters;return [p.fan,p.thermalEnabled,p.inletVelocity,p.thermalRegions,p.thermalContacts]}),[null,false,10,[],[]]);
 // Preset select resets to fieldFps:30 defaults; the backend fixture returns one frame.
 await page.evaluate(()=>window.sim.getState().updateParameters({fieldFps:0}));
 const groundSelect=page.getByRole('combobox',{name:'地面',exact:true});
 await expect(groundSelect).toContainText('无地面');
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.ground),undefined);
 await page.evaluate(()=>window.mountPreview(true));
 await expect(page.getByLabel('预览地面',{exact:true})).toContainText('无地面');
 await groundSelect.click();
 await page.getByRole('option',{name:'固定地面',exact:true}).click();
 await commitNumber(page.getByLabel('模型最低点距地面（m）',{exact:true}),'0.125');
 await expect(page.getByLabel('预览地面',{exact:true})).toContainText('固定地面 · 最低点间隙 0.125 m（含轮胎）');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wind-tunnel-simulation')).state.parameters.ground),{mode:'stationary',clearanceM:0.125});
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 assert.deepEqual(await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).at(-1).body.spec.parameters.ground),{mode:'stationary',clearanceM:0.125});
 await expect(page.getByLabel('本次地面',{exact:true})).toContainText('固定地面 · 速度 0 m/s');
 await groundSelect.click();
 await page.getByRole('option',{name:'随来流移动地面',exact:true}).click();
 await waitFor(()=>window.sim.getState().results.flowSnapshot===null);
 await expect(groundSelect).toContainText('随来流移动地面');
 await page.getByText('地面随来流沿 +X 以 10.0 m/s 移动。车轮仍不旋转。',{exact:true}).waitFor();
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 await expect(page.getByLabel('本次地面',{exact:true})).toContainText('随来流移动地面 · 速度 10 m/s');
 // Saved replay diagnostics take precedence over the still-selected moving-ground input.
 await page.evaluate(()=>{const s=window.sim.getState();s.setDerived({...s.derived,groundMode:'stationary',groundClearanceM:0.3,groundVelocityMps:0})});
 await expect(page.getByLabel('本次地面',{exact:true})).toContainText('固定地面 · 速度 0 m/s');
 await expect(page.getByLabel('本次地面',{exact:true})).toContainText('0.3 m（含轮胎）');
 await expect(groundSelect).toContainText('随来流移动地面');
 await presetCard('台式机箱风道').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='desktop-airflow');
 await expect(groundSelect).toContainText('无地面');
 assert.equal(await page.evaluate(()=>window.sim.getState().parameters.ground),undefined);
 await expect(page.getByLabel('预览地面',{exact:true})).toContainText('无地面');
 // Real shipped building STL: reject clipping before a worker, login, upload or task publication.
 await page.evaluate(()=>{window.shippedModels=true});
 await presetCard('简化高楼').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='building');
 // Preset select resets to fieldFps:30 defaults; the backend fixture returns one frame.
 await page.evaluate(()=>window.sim.getState().updateParameters({fieldFps:0}));
 const buildingScene=await page.evaluate(()=>window.currentScene());
 assert.equal(buildingScene.spec.parameters.modelResolution,'coarse');
 assert.equal(buildingScene.spec.model.referenceLength,0.8);
 assert.deepEqual(await page.evaluate(()=>window.project.getState().activeModel.sourceModel.boundingBox.size),[1.399999976158142,3.299999952316284,1.399999976158142]);
 await expect(presetCard('简化高楼').filter({has:page.getByRole('button')})).not.toContainText('已使用可运行的简化模型');
 const proportionSelect=page.getByRole('combobox',{name:'模型占域比例',exact:true});
 await proportionSelect.click();
 await page.getByRole('option',{name:'约 1/4 流域长度',exact:true}).press('Enter');
 await page.getByText(/^无法预览当前放置：.*模型占域比例/).waitFor();
 await expect(page.getByRole('alert').filter({hasText:'无法放置模型'})).toContainText('outside the simulation domain');
 await page.evaluate(()=>{window.requests=[];window.workerStarts=0;window.OriginalWorker=window.Worker;window.Worker=class extends window.OriginalWorker{constructor(...args){window.workerStarts++;super(...args)}}});
 for(const target of ['browser','backend']) {
  await page.evaluate(target=>window.execution.setTarget(target),target);
  for(const action of ['start','publish']) {
   await page.locator('#'+action).click();
   await waitFor(()=>window.execution.status==='failed');
   assert.match(await page.evaluate(()=>window.execution.error),/模型占域比例.*outside the simulation domain/);
   assert.equal(await page.evaluate(()=>window.sim.getState().state.isRunning),false);
  }
 }
 assert.equal(await page.evaluate(()=>window.requests.length),0);
 assert.equal(await page.evaluate(()=>window.workerStarts),0);
 assert.deepEqual(await page.evaluate(()=>Array.from(window.project.getState().uploadedModels.find(m=>m.metadata.id==='building').geometry.vertices)),buildingScene.vertices);
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.id),'building');
 await proportionSelect.click();
 await page.getByRole('option',{name:'约 1/6 流域长度',exact:true}).press('Enter');
 await page.getByLabel('当前网格配置',{exact:true}).waitFor();
 await expect(page.getByLabel('预览地面',{exact:true})).toContainText('无地面');
 await waitFor(()=>window.execution.status==='idle' && window.execution.error===null);
 await groundSelect.click();
 await page.getByRole('option',{name:'固定地面',exact:true}).press('Enter');
 await commitNumber(page.getByLabel('模型最低点距地面（m）',{exact:true}),'100');
 await page.getByText(/^无法预览当前放置：.*减小最低点间隙/).waitFor();
 await commitNumber(page.getByLabel('模型最低点距地面（m）',{exact:true}),'0');
 await expect(page.getByLabel('预览地面',{exact:true})).toContainText('固定地面 · 最低点间隙 0 m');
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).at(-1).body.spec.model.referenceLength),0.8);
 // Every catalog item uses its actual shipped file or its own procedural generator, with no solve.
 const presetAudit=await page.evaluate(()=>window.auditShippedPresets());
 assert.equal(presetAudit.length,30);
 // b8006c9 remeshed the open preset meshes into watertight *-solid.stl derivatives, so
 // every shipped preset now loads and places cleanly — including ares-rocket and x57.
 assert.deepEqual(presetAudit.filter(p=>p.error).map(p=>p.id),[],JSON.stringify(presetAudit.filter(p=>p.error)));
 assert.equal(presetAudit.find(p=>p.id==='ares-rocket').file,true);
 assert.equal(presetAudit.find(p=>p.id==='airplane-x57').file,true);
 assert.equal(presetAudit.filter(p=>p.file===false).length,9);
 assert.equal(presetAudit.some(p=>p.warning),false);
 for(const [id,name,length] of [['rocket','探测火箭（NASA）',8],['space-shuttle','航天飞机（NASA）',37]]) {
  await presetCard(name).getByRole('button').first().click();
  await waitFor(id=>window.project.getState().activeModel?.id===id,id);
  const pose=await page.evaluate(id=>window.checkPresetOrientation(id),id);
  assert.equal(pose.vertices,true);assert.equal(pose.normals,true);assert.equal(pose.indices,true);
  assert.equal(pose.size[0],pose.sourceSize[id==='rocket'?1:2]);
  assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceLength),length);
  await page.getByLabel('当前网格配置',{exact:true}).waitFor();
 }
 // The remeshed x57 loads cleanly now; feed a corrupt file to keep covering the
 // failed-preset-load path — the notice must appear and the previous model stays.
 await page.route('**/airplane-x57-solid.stl',route=>route.fulfill({body:'corrupt preset bytes',contentType:'application/octet-stream'}));
 await presetCard('NASA X-57 电动飞机').getByRole('button').first().click();
 await page.getByText(/无法加载原始模型「NASA X-57 电动飞机」/).waitFor();
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.id),'space-shuttle');
 await page.evaluate(()=>{window.Worker=window.OriginalWorker;window.shippedModels=false});
 // Real upload in millimetres: change physical scale without rewriting the imported buffer.
 await page.evaluate(()=>window.mountPersistence(true));
 await waitFor(()=>window.persistence?.ready);
 // Restoring the prior heatsink project can restore thermal inputs; this is a
 // geometry-scale wind-tunnel fixture, before assigning metres to the raw CAD.
 await page.evaluate(()=>window.sim.getState().updateParameters({fieldFrames:1,durationSeconds:10,thermalEnabled:false}));
 await page.getByRole('tab',{name:'上传模型'}).click({timeout:20000,force:true});
 const millimeterCar=Buffer.from(require('node:fs').readFileSync(path.join(root,'apps/lab/public/models/car.stl')));
 for(let triangle=0;triangle<millimeterCar.readUInt32LE(80);triangle++) for(let coordinate=0;coordinate<9;coordinate++) {
   const offset=84+triangle*50+12+coordinate*4;
   millimeterCar.writeFloatLE(millimeterCar.readFloatLE(offset)*1000,offset);
 }
 await page.locator('input[type=file]').setInputFiles({name:'car-millimeters.stl',mimeType:'model/stl',buffer:millimeterCar});
 await waitFor(()=>window.project.getState().activeModel?.name==='car-millimeters.stl');
 const importedVertices=await page.evaluate(()=>window.currentScene().vertices);
 await expect(page.getByLabel('模型流向长度（m）',{exact:true})).toHaveValue('4500');
 await commitNumber(page.getByLabel('模型流向长度（m）',{exact:true}),'4.5');
 await page.getByRole('combobox',{name:'气动力参考面积',exact:true}).click();
 await page.getByRole('option',{name:'指定参考面积',exact:true}).click({timeout:20000,force:true});
 await commitNumber(page.getByLabel('参考面积（m²）',{exact:true}),'2.2');
 await page.getByRole('combobox',{name:'模型占域比例',exact:true}).click();
 await page.getByRole('option',{name:'约 1/6 流域长度',exact:true}).press('Enter');
 await expect(page.getByRole('combobox',{name:'模型占域比例',exact:true})).toContainText('约 1/6 流域长度');
 await expect(page.getByLabel('当前网格配置',{exact:true})).toContainText('物理流域 X/Y/Z');
 await page.evaluate(()=>window.sim.getState().updateParameters({angleOfAttack:7,inletVelocity:0.02,fan:null,ground:{mode:'stationary',clearanceM:0.08}}));
 const physicalScene=await page.evaluate(()=>window.currentScene());
 assert.deepEqual(physicalScene.vertices,importedVertices);
 assert.equal(physicalScene.spec.model.referenceLength,4.5);
 assert.equal(physicalScene.spec.model.referenceArea,2.2);
 assert.ok(Math.abs(physicalScene.bounds.min[1]*physicalScene.dx-0.08)<1e-12);
 await page.locator('#start').click();
 await waitFor(()=>window.execution.status==='succeeded');
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.body?.spec).at(-1).body.spec.model.referenceLength),4.5);
 await commitNumber(page.getByLabel('模型流向长度（m）',{exact:true}),'4.6');
 await waitFor(()=>window.sim.getState().results.flowSnapshot===null);
 await commitNumber(page.getByLabel('模型流向长度（m）',{exact:true}),'4.5');
 await page.evaluate(()=>window.persistence.saveCurrentProject());
 await expect(page.getByLabel('项目保存状态',{exact:true})).toContainText('已保存');
 const savedProject=await page.evaluate(()=>window.project.getState().currentProject);
 assert.equal(savedProject.models[0].referenceLength,4.5);
 assert.equal(savedProject.models[0].referenceArea,2.2);
 await page.reload();
 await loadMain();
 await waitFor(()=>!!window.mountPersistence);
 await page.evaluate(()=>{window.mountPersistence(true);window.mountPanels(true);window.mountPreview(true)});
 await waitFor(()=>window.persistence?.ready);
 const reloaded=await page.evaluate(()=>window.currentScene());
 assert.deepEqual(reloaded.vertices,physicalScene.vertices);
 assert.deepEqual(reloaded.spec.parameters,physicalScene.spec.parameters);
 assert.deepEqual(reloaded.spec.model,physicalScene.spec.model);
 await expect(page.getByLabel('模型流向长度（m）',{exact:true})).toHaveValue('4.5');
 await expect(page.getByLabel('参考面积（m²）',{exact:true})).toHaveValue('2.2');
 // Open another existing-style project, then reopen the saved one through the same store action as Home.
 await page.evaluate(()=>{window.savedProject=window.project.getState().currentProject;window.project.getState().setCurrentProject({...window.savedProject,id:'other-project',models:[],parameters:{}})});
 await waitFor(()=>window.persistence.ready&&window.project.getState().activeModel===null);
 assert.deepEqual(await page.evaluate(()=>{const p=window.sim.getState().parameters;return [p.ground,p.fan,p.thermalEnabled]}),[undefined,null,false]);
 await page.evaluate(()=>window.project.getState().setCurrentProject(window.savedProject));
 await waitFor(()=>window.persistence.ready&&window.project.getState().activeModel?.referenceLength===4.5);
 assert.deepEqual(await page.evaluate(()=>window.currentScene().vertices),physicalScene.vertices);
 await page.getByRole('tab',{name:'预设模型'}).click();
 await presetCard('简化汽车').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='car');
 await expect(page.getByLabel('模型流向长度（m）',{exact:true})).toHaveValue('4.5');
 await expect(page.getByLabel('参考面积（m²）',{exact:true})).toHaveValue('2.5');
 await page.getByRole('combobox',{name:'气动力参考面积',exact:true}).click();
 await page.getByRole('option',{name:'自动：离散迎风投影',exact:true}).press('Enter');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceArea),undefined);
 await page.evaluate(()=>window.persistence.saveCurrentProject());
 assert.equal(await page.evaluate(()=>window.project.getState().currentProject.models[0].referenceArea),null);
 // An actual IndexedDB write failure is visible, and a retry persists the latest scene.
 await page.evaluate(()=>{
   window.originalTransaction=IDBDatabase.prototype.transaction;
   IDBDatabase.prototype.transaction=function(names,mode,...rest){
     if(mode==='readwrite')throw new DOMException('Fixture quota exhausted','QuotaExceededError');
     return window.originalTransaction.call(this,names,mode,...rest);
   };
 });
 await commitNumber(page.getByLabel('模型流向长度（m）',{exact:true}),'4.6');
 await page.evaluate(()=>window.persistence.saveCurrentProject());
 await expect(page.getByLabel('项目保存状态',{exact:true})).toContainText('保存项目失败');
 await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.originalTransaction;return window.persistence.saveCurrentProject()});
 await expect(page.getByLabel('项目保存状态',{exact:true})).toContainText('已保存');
 await page.reload();
 await loadMain();
 await waitFor(()=>!!window.mountPersistence);
 await page.evaluate(()=>{window.mountPersistence(true);window.mountPanels(true)});
 await waitFor(()=>window.persistence?.ready);
 await expect(page.getByLabel('模型流向长度（m）',{exact:true})).toHaveValue('4.6');
 await expect(page.getByRole('combobox',{name:'气动力参考面积',exact:true})).toContainText('自动：离散迎风投影');
 assert.equal(await page.evaluate(()=>window.currentScene().spec.model.referenceArea),undefined);
 // Leaving the Lab before the debounce expires still flushes the latest edited model.
 await commitNumber(page.getByLabel('模型流向长度（m）',{exact:true}),'4.7');
 await page.evaluate(()=>window.mountPersistence(false));
 await waitFor(()=>JSON.parse(localStorage.getItem('wind-tunnel-projects')).state.currentProject.models[0].referenceLength===4.7);
 await page.reload();
 await loadMain();
 await waitFor(()=>!!window.mountPersistence);
 await page.evaluate(()=>{window.mountPersistence(true);window.mountPanels(true)});
 await waitFor(()=>window.persistence?.ready);
 await expect(page.getByLabel('模型流向长度（m）',{exact:true})).toHaveValue('4.7');
 assert.equal(await page.evaluate(()=>window.project.getState().uploadedModels.find(m=>m.metadata.id===window.project.getState().activeModel.id).geometry.solidTriangleCounts.length),8);
 // A delayed import started in one project must not overwrite the next project's model.
 await page.getByRole('tab',{name:'上传模型'}).click();
 await page.evaluate(()=>{
   window.originalFileArrayBuffer=File.prototype.arrayBuffer;
   File.prototype.arrayBuffer=function(){
     if(this.name==='delayed-car.stl')return new Promise(resolve=>{window.releaseImport=()=>window.originalFileArrayBuffer.call(this).then(resolve)});
     return window.originalFileArrayBuffer.call(this);
   };
 });
 await page.locator('input[type=file]').setInputFiles({name:'delayed-car.stl',mimeType:'model/stl',buffer:millimeterCar});
 await waitFor(()=>!!window.releaseImport);
 await page.evaluate(()=>{const p=window.project.getState();p.setCurrentProject({...p.currentProject,id:'next-project',models:[],parameters:{}})});
 await waitFor(()=>window.persistence.ready&&window.project.getState().activeModel===null);
 await page.getByRole('tab',{name:'预设模型'}).click();
 await presetCard('球体').getByRole('button').first().click();
 await waitFor(()=>window.project.getState().activeModel?.id==='sphere');
 await page.evaluate(()=>window.releaseImport());
 await page.evaluate(()=>{File.prototype.arrayBuffer=window.originalFileArrayBuffer});
 assert.equal(await page.evaluate(()=>window.project.getState().activeModel.id),'sphere');
 // b8006c9 moved presets to *-solid.stl; the Draco-compressed NASA originals remain
 // in-tree as provenance — decode one so the glTF/Draco path stays exercised.
 await page.evaluate(async()=>{
  window.shippedModels=true;
  const res=await fetch('/models/rocket.glb');
  window.provenanceRocketSize=(await parseModelFile(new File([await res.arrayBuffer()],'rocket.glb'))).metadata.boundingBox.size;
  window.shippedModels=false;
 });
 assert.ok(decoderRequests.includes('/draco/draco_wasm_wrapper.js'));
 assert.ok(decoderRequests.includes('/draco/draco_decoder.wasm'));
 assert.deepEqual(violations,[]);
 assert.deepEqual(errors,[]);
 console.log('Execution switch smoke passed: mesh upload/reuse, renderer/camera/slices, ground controls/replay, physical scale and area, real IndexedDB project reload/reopen/atomic failure/retry/navigation flush, fan controls, zero-inlet results, real three-step multi-material/contact WASM heat/replay and cancellation.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
