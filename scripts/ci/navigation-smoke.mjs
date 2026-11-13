import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// Exercise navigation, filtering and progressive disclosure without running a solver.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LocaleProvider } from './src/lib/i18n';
import { Layout } from './src/components/Layout';
import { DomainHub } from './src/pages/DomainHub';
import { Applications } from './src/pages/Applications';
import { ApplicationDetail } from './src/pages/ApplicationDetail';
createRoot(document.getElementById('root')).render(<LocaleProvider><BrowserRouter><Routes><Route element={<Layout/>}>
<Route path="/d/:key" element={<DomainHub/>}/><Route path="/apps" element={<Applications/>}/><Route path="/apps/:id" element={<ApplicationDetail/>}/>
</Route></Routes></BrowserRouter></LocaleProvider>);` }, bundle: true, write: false, format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' } });
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror', e=>errors.push(e.message));
 await page.route('**/*', route => route.request().isNavigationRequest()
  ? route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module">'+bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>'})
  : route.abort());
 await page.goto('https://waveworld.test/d/sim');
 await page.getByRole('heading',{name:'仿真与计算',exact:true}).waitFor();
 const nav=page.getByRole('navigation',{name:'主导航'}).first();
 assert.deepEqual(await nav.getByRole('link').allTextContents(),['仿真与计算','我的项目','计算任务','资料库']);
 const links=await page.locator('main section a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
 assert.equal(links.length,new Set(links).size);assert(!links.includes('/my-projects')&&!links.includes('/batch-jobs'));
 await page.getByLabel('搜索名称或关键词').fill('FDTD');
 assert.equal(await page.locator('main section a').count(),1);
 assert.equal(await page.locator('main section a').getAttribute('href'),'/fdtd');
 await page.getByLabel('搜索名称或关键词').fill('no-such-physics-123');
 await page.getByRole('heading',{name:'没有找到匹配的内容'}).waitFor();
 await page.getByRole('button',{name:'清除搜索和筛选'}).click();
 await page.getByRole('button',{name:'热',exact:true}).click();
 assert.equal(await page.locator('main section a').count(),3);
 await nav.getByRole('link',{name:'资料库',exact:true}).click();
 await page.getByLabel('搜索名称或关键词').fill('光伏');
 assert(await page.locator('main a[href="/apps/app-solar-cell"]').count());
 await page.locator('main a[href="/apps/app-solar-cell"]').click();
 await page.getByRole('heading',{name:'太阳能电池 / 光伏',exact:true}).waitFor();
 assert.equal(await nav.locator('[aria-current="page"]').count(),1);
 assert.equal(await nav.locator('[aria-current="page"]').innerText(),'资料库');
 assert.equal(await page.locator('details[open]').count(),0);
 assert(!await page.locator('main').innerText().then(t=>/图上最优路径|η≈|试跑模块|产品锚点|分级下钻/.test(t)));
 assert.equal(await page.locator('#application-part').count(),0);
 await page.getByText('查看原理与参考资料',{exact:true}).click();
 await page.getByLabel('查看哪个部分').selectOption('1');
 assert((await page.locator('main').innerText()).includes('串/并联'));
 await page.getByText('查看原理与参考资料',{exact:true}).click();
 await page.getByLabel('可打开的基础实验').selectOption('transient');
 assert.equal(await page.getByRole('link',{name:'打开实验 →',exact:true}).getAttribute('href'),'/transient');
 await page.keyboard.press('Control+k');
 await page.getByRole('combobox',{name:'搜索入口'}).fill('太阳能电池');
 const result=page.getByRole('option').filter({hasText:'太阳能电池 / 光伏'});
 assert(await result.count());await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'导航菜单'}).click();
 assert.equal(await page.locator('#mobile-navigation a').count(),4);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#mobile-navigation').count(),0);
 assert.deepEqual(errors,[]);console.log('Navigation smoke passed: four destinations, search, subject filters, application links, disclosure, keyboard and mobile menu.');
} finally {await browser.close();}
