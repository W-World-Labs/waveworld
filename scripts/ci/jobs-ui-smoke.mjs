import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Task navigation/download/cancellation only: no solver, production data or listening port.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { LocaleProvider } from './src/lib/i18n';
import { BatchJobs } from './src/pages/BatchJobs';
createRoot(document.getElementById('root')).render(<LocaleProvider><BrowserRouter><BatchJobs/></BrowserRouter></LocaleProvider>);
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' } });
const ids = Array.from({length:10},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const base = { createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', progress: null, error: null, status: 'succeeded', agentId: 'compute-test' };
// Saved 51-DOF fixture exercises field browsing above the former inline cutoff; no solver runs here.
const nodeIds=Array.from({length:17},(_,i)=>100+i*10), elementIds=Array.from({length:16},(_,i)=>700+i);
const structuralDerived={elementType:'beam2d',fieldInline:1,lengthUnit:'m',stressUnit:'Pa',strainUnit:'1',bendingMomentUnit:'N*m',stressRecoveryStatus:'section-modulus-required',
 nodeIdsCsv:nodeIds.join(','),nodePositionsCsv:nodeIds.flatMap((_,i)=>[i/16,0,0]).join(','),elementIdsCsv:elementIds.join(','),elementConnectivityCsv:elementIds.flatMap((_,i)=>[nodeIds[i],nodeIds[i+1]]).join(','),
 dofNamesCsv:'ux,uy,rz',displacementUnitsCsv:'m,m,rad',reactionUnitsCsv:'N,N,N*m',displacementCsv:nodeIds.flatMap((_,i)=>[0,-i*1e-5,-i*1e-6]).join(','),reactionCsv:nodeIds.flatMap((_,i)=>[0,i===0?100:0,i===0?100:0]).join(','),
 elementLengthMCsv:elementIds.map(()=>0.0625).join(','),elementAxialStressCsv:elementIds.map(()=>0).join(','),elementAxialStrainCsv:elementIds.map(()=>0).join(','),elementBendingMoment1NmCsv:elementIds.map((_,i)=>100-i*6.25).join(','),elementBendingMoment2NmCsv:elementIds.map((_,i)=>-100+(i+1)*6.25).join(','),elementMaxBendingMomentNmCsv:elementIds.map((_,i)=>100-i*6.25).join(','),elementBendingStressPaCsv:elementIds.map((_,i)=>i===15?'':600000-i*37500).join(',')};
const structuralJob={...base,id:ids[3],name:'Saved structural beam',kind:'structural-static',spec:{schemaVersion:1,kind:'structural-static',parameters:{elementType:'beam2d'},run:{maxSteps:1}},result:{schemaVersion:1,summary:{steps:1,wallTimeMs:1,nodeCount:17,elementCount:16,dofCount:51,maxDisplacementM:0.00016,maxReactionN:100,maxReactionMomentNm:100,maxBendingMomentNm:100},derived:structuralDerived,artifacts:[]}};
const jobs = [
 { ...base, id: ids[0], name: 'Saved circuit', kind: 'waveworld-module', spec: { schemaVersion: 1, kind: 'waveworld-module', parameters: { module: 'rlc' }, run: { maxSteps: 2 } }, result: { schemaVersion: 1, summary: { steps: 2, wallTimeMs: 1 }, derived: { engine: 'rust-native' }, moduleResult: { module: 'rlc', result: { dt: 0.01, states: [{q:1,i:0},{q:0.9,i:-0.1},{q:0.8,i:-0.2}] } } }, compute: { provider: 'w-compute', phase: 'stopped', instanceId: 'instance-1', error: null } },
 { ...base, id: ids[1], name: 'Saved thermal flow', kind: 'lbm-d3q19', spec: { schemaVersion:1, kind:'lbm-d3q19', parameters:{}, run:{maxSteps:3} }, result: { schemaVersion:1, summary:{steps:3,wallTimeMs:2,cd:0.2}, history:{step:[1,2,3],cd:[0.1,0.2,0.2]}, thermal:{solidMaxC:31,fluidMaxC:26,sourceEnergyJ:0.0021}, artifacts:[{artifactId:'field-test',kind:'lbm-display',contentType:'application/octet-stream',bytes:4}] } },
 { ...base, id: ids[2], name: 'Active optical job', kind:'waveworld-module', status:'running', spec:{schemaVersion:1,kind:'waveworld-module',parameters:{module:'optics-lab'},run:{maxSteps:3}}, progress:{step:1,total:3}, result:null },
 structuralJob,
 {...structuralJob,id:ids[4],name:'Legacy structural beam',result:{...structuralJob.result,derived:{elementType:'beam2d',fieldInline:0},artifacts:[{artifactId:'structural-u-012345abcdef',kind:'structural-displacement-field',contentType:'application/octet-stream',bytes:408}]}},
 {...structuralJob,id:ids[5],name:'Misaligned structural field',result:{...structuralJob.result,derived:{...structuralDerived,displacementCsv:structuralDerived.displacementCsv+',0'}}},
 {...structuralJob,id:ids[6],name:'Malformed structural CSV',result:{...structuralJob.result,derived:{...structuralDerived,reactionCsv:','+structuralDerived.reactionCsv.split(',').slice(1).join(',')}}},
 {...structuralJob,id:ids[7],name:'Wrong structural units',result:{...structuralJob.result,derived:{...structuralDerived,displacementUnitsCsv:'m,m,m'}}},
 {...structuralJob,id:ids[8],name:'Missing connectivity node',result:{...structuralJob.result,derived:{...structuralDerived,elementConnectivityCsv:'9999,'+structuralDerived.elementConnectivityCsv.split(',').slice(1).join(',')}}},
 {...structuralJob,id:ids[9],name:'Saved analytic plate',result:{schemaVersion:1,summary:{steps:1,wallTimeMs:1,method:'structural-kirchhoff-plate-analytic-v1',centerDeflectionM:0.0003,flexuralRigidityNm:100},artifacts:[]}},
];
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({viewport:{width:1280,height:900}});
 await page.addInitScript(() => localStorage.setItem('waveworld_user_token', 'usr_fixture'));
 let signedIn=true, cancelError=false, writes=0, downloads=0, delayCircuit=false;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://jobs.test/**',async route=>{
  const request=route.request(), url=new URL(request.url());
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/main.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
  if(url.pathname.startsWith('/api/')){
   assert.equal(request.headers().authorization, 'Bearer usr_fixture');
   if(request.method()!=='GET')writes++;
   if(!signedIn)return json({error:'unauthorized'},401);
   if(url.pathname==='/api/v1/jobs')return json({jobs});
   if(url.pathname==='/api/v1/artifacts/field-test'){downloads++;return route.fulfill({contentType:'application/octet-stream',body:Buffer.from('WVF1')});}
   const match=url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)(\/cancel)?$/);
   if(match){
    const job=jobs.find(j=>j.id===match[1]);if(!job)return json({error:'not_found'},404);
    if(match[2]){if(cancelError)return json({error:'unavailable'},503);job.status='cancelled';return json({job});}
    if(delayCircuit&&job.id===ids[0])await new Promise(resolve=>setTimeout(resolve,300));
    return json({job});
   }
   return json({error:'unexpected'},500);
  }
  return route.fulfill({contentType:'text/html',body:'<html lang="zh"><div id="root"></div><script src="/main.js"></script></html>'});
 });
 await page.goto('http://jobs.test/batch-jobs?job='+ids[0]);
 await expect(page.getByRole('region',{name:'已保存的计算结果'})).toBeVisible();
 await expect(page.getByRole('img',{name:'电荷 / C, 时间 / s'})).toBeVisible();
 await expect(page.getByText('实例已停止，工作盘保留；存储费用独立计算。')).toBeVisible();
 assert.equal(await page.getByRole('columnheader',{name:'Cd',exact:true}).count(),0);
 await page.getByRole('combobox').selectOption({label:'电流 / A'});
 await expect(page.locator('output')).toHaveText('-0.2');
 const manifestDownload=page.waitForEvent('download');
 await page.getByRole('button',{name:'下载参数与结果'}).click();
 const manifest=JSON.parse(readFileSync(await (await manifestDownload).path(),'utf8'));
 assert.deepEqual(manifest.spec,jobs[0].spec);assert.deepEqual(manifest.result,jobs[0].result);assert.equal(writes,0);
 await page.getByRole('button',{name:/Saved thermal flow/}).click();
 await expect(page.getByText('固体最高温度 / °C')).toBeVisible();
 const fieldDownload=page.waitForEvent('download');await page.getByRole('button',{name:/下载 流场文件/}).click();
 assert.equal(readFileSync(await (await fieldDownload).path(),'utf8'),'WVF1');assert.equal(downloads,1);
 await page.getByRole('button',{name:/Saved structural beam/}).click();
 await expect(page.getByText(/CPU · Float64 · 小规模线弹性静力分析/)).toBeVisible();
 await expect(page.getByText(/梁最大应力未计算/)).toBeVisible();
 assert.equal(await page.getByRole('img').count(),0);
 await expect(page.getByRole('table',{name:'节点结果'})).not.toBeVisible();
 await expect(page.getByRole('table',{name:'单元结果'})).not.toBeVisible();
 await page.locator('summary').filter({hasText:'节点结果 (17)'}).click();
 const nodeTable=page.getByRole('table',{name:'节点结果'});
 await expect(nodeTable).toBeVisible();await expect(nodeTable.getByRole('row')).toHaveCount(18);
 await expect(nodeTable.getByRole('columnheader',{name:'位移 uy / m',exact:true})).toBeVisible();
 await expect(nodeTable.getByRole('columnheader',{name:'转角 rz / rad',exact:true})).toBeVisible();
 await expect(nodeTable.getByRole('columnheader',{name:'反力 Fy / N',exact:true})).toBeVisible();
 await expect(nodeTable.getByRole('columnheader',{name:'反力矩 Mz / N*m',exact:true})).toBeVisible();
 assert.deepEqual(await nodeTable.getByRole('row').nth(1).getByRole('cell').allTextContents(),['100','0','0','0','0','0','0','0','100','100']);
 const nodesDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载节点结果 CSV'}).click();
 const nodesCsv=readFileSync(await(await nodesDownload).path(),'utf8').trimEnd().split('\n');
 assert.equal(nodesCsv.length,18);assert.equal(nodesCsv[0],'nodeId,x (m),y (m),z (m),ux (m),uy (m),rz (rad),reaction_ux (N),reaction_uy (N),reaction_rz (N*m)');
 assert.deepEqual(nodesCsv.at(-1).split(',').map(Number),[260,1,0,0,0,-16*1e-5,-16*1e-6,0,0,0]);
 await page.locator('summary').filter({hasText:'单元结果 (16)'}).click();
 const elementTable=page.getByRole('table',{name:'单元结果'});
 await expect(elementTable).toBeVisible();await expect(elementTable.getByRole('row')).toHaveCount(17);
 await expect(elementTable.getByRole('columnheader',{name:'最大绝对弯矩 / N*m',exact:true})).toBeVisible();
 await expect(elementTable.getByRole('row').last().getByRole('cell').last()).toHaveText('—');
 const elementsDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载单元结果 CSV'}).click();
 const elementsCsv=readFileSync(await(await elementsDownload).path(),'utf8').trimEnd().split('\n');
 assert.equal(elementsCsv.length,17);assert.equal(elementsCsv[0],'elementId,n1,n2,characteristicLength (m),axialStress (Pa),axialStrain (1),endMoment1 (N*m),endMoment2 (N*m),maxAbsMoment (N*m),bendingStress (Pa)');
 assert.deepEqual(elementsCsv[1].split(',').map(Number),[700,100,110,0.0625,0,0,100,-93.75,100,600000]);assert.equal(elementsCsv.at(-1).split(',').at(-1),'');
 const structuralDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载参数与结果'}).click();
 assert.deepEqual(JSON.parse(readFileSync(await(await structuralDownload).path(),'utf8')).result,structuralJob.result);
 assert.equal(downloads,1);assert.equal(writes,0);
 await page.getByRole('button',{name:/Legacy structural beam/}).click();
 await expect(page.getByText(/此结果未保存完整的节点坐标/)).toBeVisible();
 assert.equal(await page.getByRole('button',{name:/下载.*(?:CSV|structural-displacement-field)/}).count(),0);
 for(const name of ['Misaligned structural field','Malformed structural CSV','Wrong structural units','Missing connectivity node']){
  await page.getByRole('button',{name:new RegExp(name)}).click();
  await expect(page.getByText(/已保存场数据的数值、长度、节点对应关系或单位不一致/)).toBeVisible();
  assert.equal(await page.getByRole('table').count(),0);assert.equal(await page.getByRole('button',{name:/下载.*CSV/}).count(),0);
 }
 await page.getByRole('button',{name:/Saved analytic plate/}).click();
 await expect(page.getByText(/此算例提供中心挠度、弯曲刚度等汇总/)).toBeVisible();
 await expect(page.getByText('中心挠度 / m',{exact:true})).toBeVisible();
 assert.equal(await page.getByText(/此结果未保存完整的节点坐标/).count(),0);
 assert.equal(await page.getByRole('table').count(),0);
 assert.equal(writes,0);
 await page.getByRole('button',{name:/Active optical job/}).click();
 await expect(page.getByRole('button',{name:'取消任务',exact:true})).toBeVisible();
 cancelError=true;await page.getByRole('button',{name:'取消任务',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('取消请求未确认');
 cancelError=false;await page.getByRole('button',{name:'取消任务',exact:true}).click();
 await expect(page.getByRole('region',{name:'任务详情'})).toContainText('已取消');assert.equal(writes,2);
 delayCircuit=true;
 await page.getByRole('button',{name:/Saved circuit/}).click();
 await page.getByRole('button',{name:/Saved thermal flow/}).click();
 await expect(page.getByRole('region',{name:'任务详情'})).toContainText('Saved thermal flow');
 await page.waitForTimeout(400);await expect(page.getByRole('region',{name:'任务详情'})).not.toContainText('Saved circuit');
 await page.goto('http://jobs.test/batch-jobs?job=00000000-0000-4000-8000-999999999999');
 await expect(page.getByRole('alert')).toContainText('无法打开此任务');
 signedIn=false;await page.goto('http://jobs.test/batch-jobs?job='+ids[0]);
 const login=page.getByRole('link',{name:'使用 W-ID 登录'});await expect(login).toBeVisible();
 assert.equal(new URL(await login.getAttribute('href'),'http://jobs.test').searchParams.get('returnTo'),'/batch-jobs?job='+ids[0]);
 assert.equal(await page.getByRole('button',{name:/Saved circuit/}).count(),0);assert.equal(writes,2);
 assert.deepEqual(errors,[]);
 console.log('PASS task details, stored ODE/thermal/51-DOF structural results, node/element CSV and JSON downloads, legacy/malformed fields, cancellation/error, stale response isolation, missing-job and login return URL');
} finally {await browser.close();}
