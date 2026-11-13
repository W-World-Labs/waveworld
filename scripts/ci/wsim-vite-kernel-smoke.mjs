import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build, createServer, loadConfigFromFile } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TEMP = mkdtempSync(path.join(os.tmpdir(), 'waveworld-vite-wasm-smoke-'))
const FIXTURE = path.join(ROOT, 'scripts/ci/.wsim-vite-kernel-smoke')
const PRODUCTION = path.join(TEMP, 'production')
const loader = path.join(ROOT, 'node_modules/@w-sim/solvers-lbm/dist/wasm-kernel-loader.js').replaceAll('\\', '/')
mkdirSync(FIXTURE, { recursive: true })
writeFileSync(path.join(FIXTURE, 'index.html'), '<!doctype html><html><body><output id="status">loading</output><script type="module" src="./main.ts"></script></body></html>')
writeFileSync(path.join(FIXTURE, 'main.ts'), `
  import { instantiateWasmKernel } from ${JSON.stringify(loader)}
  const status = document.querySelector('#status')
  try {
    const kernel = instantiateWasmKernel()
    if (kernel.abi_version() !== 11) throw new Error('main WASM ABI mismatch')
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (data.error) throw new Error(data.error)
      if (data.abi !== 11) throw new Error('worker WASM ABI mismatch')
      status.textContent = 'main:11 worker:11'
      worker.terminate()
    }
    worker.onerror = event => { status.textContent = 'worker error: ' + event.message }
    worker.postMessage('instantiate')
  } catch (error) { status.textContent = String(error) }
`)
writeFileSync(path.join(FIXTURE, 'worker.ts'), `
  import { instantiateWasmKernel } from ${JSON.stringify(loader)}
  self.onmessage = () => {
    try { self.postMessage({ abi: instantiateWasmKernel().abi_version() }) }
    catch (error) { self.postMessage({ error: String(error) }) }
  }
`)

const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(ROOT, 'vite.config.ts'), 'silent')
if (!loaded) throw new Error('failed to load WaveWorld Vite config')
const config = loaded.config
let devServer
let browser
let productionServer
try {
  devServer = await createServer({
    ...config,
    configFile: false,
  root: ROOT,
    server: { ...config.server, host: '127.0.0.1', port: 0, strictPort: false },
  })
  await devServer.listen()
  const devPort = devServer.httpServer.address().port

  const outputDir = path.join(PRODUCTION, 'dist')
  await build({
    ...config,
    configFile: false,
    root: ROOT,
    base: '/',
    build: {
      ...config.build,
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: { ...config.build?.rollupOptions, input: path.join(FIXTURE, 'index.html') },
    },
  })
  const kernelFile = readdirSync(path.join(outputDir, 'assets')).find(name => /^wsim-lbm-kernel-[a-f0-9]{12}\.js$/.test(name))
  assert.ok(kernelFile, 'production build emits the SHA-256-named shared WASM kernel')
  const workerFile = readdirSync(path.join(outputDir, 'assets')).find(name => /^worker-[\w-]+\.js$/.test(name))
  assert.ok(workerFile, 'production build emits the module Worker')
  const workerSource = readFileSync(path.join(outputDir, 'assets', workerFile), 'utf8')
  const workerImport = workerSource.match(/from["']([^"']*wsim-lbm-kernel-[a-f0-9]{12}\.js)["']/)?.[1]
  assert.ok(workerImport, 'ES module Worker imports the shared kernel asset')
  assert.equal(new URL(workerImport, `https://waveworld.test/assets/${workerFile}`).pathname, `/assets/${kernelFile}`,
    'ES module Worker import resolves to the emitted shared kernel URL')

  productionServer = createHttpServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const filePath = path.resolve(outputDir, relative)
    if (!filePath.startsWith(`${outputDir}${path.sep}`) && filePath !== path.join(outputDir, 'index.html')) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = readFileSync(filePath)
      const type = filePath.endsWith('.html') ? 'text/html' : filePath.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
      response.writeHead(200, { 'content-type': `${type}; charset=utf-8` }).end(body)
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => productionServer.listen(0, '127.0.0.1', resolve))
  const productionPort = productionServer.address().port

  browser = await chromium.launch({ headless: true })
  for (const [environment, url] of [
    ['dev', `http://127.0.0.1:${devPort}/scripts/ci/.wsim-vite-kernel-smoke/index.html`],
    ['production', `http://127.0.0.1:${productionPort}/scripts/ci/.wsim-vite-kernel-smoke/index.html`],
  ]) {
    const page = await browser.newPage()
    const failures = []
    const requestedKernel = []
    const requested = []
    page.on('pageerror', error => failures.push(error.message))
    page.on('console', message => { if (message.type() === 'error') failures.push(`console: ${message.text()}`) })
    page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`))
    page.on('request', request => {
      requested.push(request.url())
      if (/\/assets\/wsim-lbm-kernel-[a-f0-9]{12}\.js/.test(request.url())) requestedKernel.push(request.url())
    })
    await page.goto(url)
    try { await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'main:11 worker:11', null, { timeout: 15_000 }) }
    catch {
      const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '<document unavailable>')
      throw new Error(`${environment} main/Worker did not finish; body=${bodyText} requests=${requested.join(',')} errors=${failures.join(' | ')}`)
    }
    assert.deepEqual(failures, [], `${environment} main and module Worker load their WASM imports`)
    if (environment === 'production') assert.ok(requestedKernel.length >= 1, 'production main/Worker fetches the external shared kernel asset')
    else assert.deepEqual(requestedKernel, [], 'dev serves inline package WASM without a dangling build-only asset URL')
    await page.close()
    console.log(`PASS Vite ${environment}: main and type=module Worker instantiate W-Sim WASM ABI 11`)
  }
} finally {
  await browser?.close()
  await devServer?.close()
  if (productionServer) await new Promise(resolve => productionServer.close(resolve))
  rmSync(TEMP, { recursive: true, force: true })
  rmSync(FIXTURE, { recursive: true, force: true })
}
