/**
 * Run after building the selected Next app: node scripts/ci/next-csp-smoke.mjs lab|host
 * Lab embed check expects a build with WAVEWORLD_LAB_BASE_PATH=/app/lab.
 * Render through its real production middleware and request handler in memory;
 * Playwright consumes the resulting headers/HTML without a listening test server.
 * Load real models (including compressed GLB) and operate controls. Never start a solver or job.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Socket } from 'node:net'
import { extname, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'

const appName = process.argv[2]
assert.ok(['lab', 'host'].includes(appName), 'Specify lab or host (already built)')
process.env.NODE_ENV = 'production'
const dir = resolve('apps', appName)
const requireApp = createRequire(dir + '/package.json')
const next = requireApp('next')
const { createRequestResponseMocks } = requireApp('next/dist/server/lib/mock-request')
const { config } = JSON.parse(await readFile(dir + '/.next/required-server-files.json', 'utf8'))
const basePath = config.basePath || ''
if (appName === 'lab') process.env.WAVEWORLD_LAB_BASE_PATH = basePath
const origin = 'https://waveworld-ui.test'
const app = next({ dev: false, dir, hostname: 'waveworld-ui.test', port: 3000 })
await app.prepare()
const handler = app.getRequestHandler()
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })

async function documentResponse(path) {
  const chunks = []
  const { req, res } = createRequestResponseMocks({
    url: path,
    headers: { host: 'waveworld-ui.test', 'x-forwarded-proto': 'https' },
    socket: new Socket(),
    resWriter: chunk => { chunks.push(Buffer.from(chunk)); return true },
  })
  await handler(req, res)
  assert.equal(res.statusCode, 200, `document ${path}`)
  const headers = Object.fromEntries(Object.entries(res.getHeaders()).map(([key, value]) => [key, String(value)]))
  const policy = headers['content-security-policy']
  assert.match(policy, /'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-/)
  if (appName === 'lab') {
    assert.match(policy, /script-src[^;]*'wasm-unsafe-eval'/)
    assert.match(policy, /connect-src 'self' blob:(?:;|$)/)
  } else {
    assert.doesNotMatch(policy, /'wasm-unsafe-eval'/)
    assert.match(policy, /connect-src 'self'(?:;|$)/)
  }
  assert.match(headers['cache-control'], /no-store/)
  return { status: res.statusCode, headers, body: Buffer.concat(chunks) }
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const errors = [], mutations = [], decoderRequests = [], modelRequests = []
  let jobReads = 0
  let injectUntrusted = false
  await context.addInitScript(() => {
    window.cspViolations = []
    window.modelDecoding = { blobFetches: 0, imageBitmaps: 0, solverMessages: 0 }
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective))
    const fetch = window.fetch
    window.fetch = async function (...args) {
      const response = await fetch.apply(this, args)
      const url = typeof args[0] === 'string' ? args[0] : args[0].url
      if (url?.startsWith('blob:') && response.ok) window.modelDecoding.blobFetches++
      return response
    }
    const createImageBitmap = window.createImageBitmap
    window.createImageBitmap = async function (...args) {
      const bitmap = await createImageBitmap.apply(this, args)
      if (args[0] instanceof Blob && args[0].type.startsWith('image/') && bitmap.width > 0 && bitmap.height > 0) window.modelDecoding.imageBitmaps++
      return bitmap
    }
    const postMessage = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (...args) {
      if (args[0]?.spec) {
        window.modelDecoding.solverMessages++
        throw new Error('CSP smoke must not start a simulation worker')
      }
      return postMessage.apply(this, args)
    }
  })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    // Existing font/telemetry dependencies do not participate in module behavior.
    if (['https://radar.myfastools.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) {
      return route.fulfill({ contentType: url.origin === 'https://fonts.googleapis.com' ? 'text/css' : 'application/javascript', body: '' })
    }
    assert.equal(url.origin, origin, 'UI must not fetch external resources')
    if (appName === 'lab' && ['/lab-cfd', '/windtunnel'].includes(url.pathname)) {
      const policy = (await readFile('public/_headers', 'utf8')).match(/Content-Security-Policy:\s*([^\n]+)/)[1]
      return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': policy }, body: await readFile('dist/index.html') })
    }
    if (appName === 'lab' && url.pathname.startsWith('/assets/')) {
      return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: await readFile('dist' + url.pathname) })
    }
    const path = url.pathname.slice(basePath.length)
    if (path.startsWith('/draco/')) decoderRequests.push(url.href)
    if (path.endsWith('.glb')) modelRequests.push(path)
    if (route.request().method() !== 'GET') mutations.push(path)
    if (path.startsWith('/api/')) {
      if (path.startsWith('/api/v1/jobs')) jobReads++
      return route.fulfill({ json: { jobs: [], ok: true } })
    }
    if (route.request().isNavigationRequest()) {
      const response = await documentResponse(url.pathname + url.search)
      if (injectUntrusted) response.body = Buffer.from(response.body.toString().replace('</body>', '<script>window.untrustedInlineRan = true</script></body>'))
      return route.fulfill(response)
    }
    const assetPath = path.replace(/^\/ww-next\//, '/')
    const file = assetPath.startsWith('/_next/static/')
      ? dir + '/.next/' + assetPath.slice('/_next/'.length)
      : dir + '/public' + assetPath
    const contentType = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream'
    try { return await route.fulfill({ contentType, body: await readFile(file) }) }
    catch { return route.fulfill({ status: 404, body: '' }) }
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const url = origin + basePath + (appName === 'lab' ? '/lab' : '/jobs')
  const first = await page.goto(url)
  if (appName === 'lab') {
    await page.getByLabel('查找模型').fill('汽车')
    await page.locator('[data-slot=card]').filter({ has: page.getByText('简化汽车', { exact: true }) }).getByRole('button').first().click()
    await page.getByText('当前模型：简化汽车', { exact: true }).waitFor()
    await page.getByLabel('查找模型').fill('探测火箭')
    await page.locator('[data-slot=card]').filter({ has: page.getByText('探测火箭（NASA）', { exact: true }) }).getByRole('button').first().click()
    await page.getByText('当前模型：探测火箭（NASA）', { exact: true }).waitFor()
    assert.deepEqual(modelRequests, ['/models/rocket.glb'])
    assert.deepEqual([...new Set(decoderRequests)].sort(), [
      origin + basePath + '/draco/draco_decoder.wasm',
      origin + basePath + '/draco/draco_wasm_wrapper.js',
    ])
    const decoding = await page.evaluate(() => window.modelDecoding)
    assert.ok(decoding.blobFetches > 0, 'GLB embedded texture must be fetched through its real blob URL')
    assert.ok(decoding.imageBitmaps > 0, 'GLB embedded texture must decode successfully')
    assert.equal(decoding.solverMessages, 0)
    await page.getByRole('button', { name: '后端计算', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '后端计算', exact: true }).getAttribute('aria-pressed'), 'true')
    await expect(page.getByLabel('计算设备', { exact: true })).toHaveValue('cpu')
    await page.getByLabel('计算设备', { exact: true }).selectOption('webgpu')
    await page.getByText('后端 WebGPU Agent · FP32', { exact: true }).waitFor()
    await page.getByLabel('计算设备', { exact: true }).selectOption('cpu')
    await page.getByText('后端 Rust Agent · 混合精度', { exact: true }).waitFor()
    assert.match(await page.locator('#flow-results').innerText(), /尚未计算/)
    await page.getByRole('tab', { name: '参数', exact: true }).click()
    await page.getByRole('heading', { name: '流场参数' }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  } else {
    await page.locator('table').waitFor()
    await expect.poll(() => jobReads).toBeGreaterThan(0)
    const reads = jobReads
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect.poll(() => jobReads).toBeGreaterThan(reads)
  }
  assert.deepEqual(await page.evaluate(() => window.cspViolations), [])
  assert.equal(await page.evaluate(() => window.modelDecoding.solverMessages), 0)
  assert.deepEqual(errors, [])
  const second = await page.reload()
  assert.notEqual(first.headers()['content-security-policy'], second.headers()['content-security-policy'])
  await (appName === 'lab' ? page.getByLabel('查找模型') : page.getByRole('button', { name: 'Refresh', exact: true })).waitFor()
  assert.deepEqual(await page.evaluate(() => window.cspViolations), [])
  injectUntrusted = true
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.cspViolations.length)).toBeGreaterThan(0)
  assert.equal(await page.evaluate(() => window.untrustedInlineRan), undefined)
  assert.deepEqual(mutations, [])
  assert.deepEqual(errors, [])
  if (appName === 'lab') {
    injectUntrusted = false
    await page.goto(origin + '/lab-cfd')
    const embedded = page.frameLocator('iframe')
    await embedded.getByLabel('查找模型').fill('汽车')
    await embedded.locator('[data-slot=card]').filter({ has: page.getByText('简化汽车', { exact: true }) }).getByRole('button').first().click()
    await embedded.getByText('当前模型：简化汽车', { exact: true }).waitFor()
    await page.getByRole('status').filter({ hasText: '正在加载模型与计算控件' }).waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1)
    assert.equal(await embedded.getByRole('heading', { level: 1 }).count(), 0)
    assert.equal(await embedded.getByRole('group', { name: '计算位置', exact: true }).count(), 1)
    assert.equal(await page.locator('[data-simulation-module]').getAttribute('data-simulation-module'), 'windtunnel')
    assert.equal(await page.locator('#main-content').getAttribute('data-page-surface'), 'simulation')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(async () => {
        const frameHeight = await page.locator('iframe').evaluate(el => el.clientHeight)
        const contentHeight = await embedded.locator('.lab-workspace').evaluate(el => el.scrollHeight)
        return Math.abs(frameHeight - contentHeight)
      }).toBeLessThanOrEqual(2)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    }
    await embedded.getByRole('button', { name: '后端计算', exact: true }).click()
    assert.equal(await embedded.getByRole('button', { name: '后端计算', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [])
    assert.deepEqual(await embedded.locator('body').evaluate(() => window.cspViolations), [])
    assert.equal(await embedded.locator('body').evaluate(() => window.modelDecoding.solverMessages), 0)
    assert.deepEqual(mutations, [])
    assert.deepEqual(errors, [])
    console.log('PASS unified wind module: one page title, one compute switch, hydrated embed, desktop/mobile height and same module navigation')
  }
  if (appName === 'lab') console.log('PASS real compressed NASA GLB: same-origin Draco WASM worker and embedded blob texture decoded under production CSP')
  console.log(`PASS ${appName}: production CSP, hydration, controls, fresh nonce on reload, untrusted script blocked; no solver/job started`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await app.close()
}
