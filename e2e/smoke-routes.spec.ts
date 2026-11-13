import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { SMOKE_ROUTES } from './routes'
import { FORMAL_RADAR_BINDING } from '../scripts/ci/assert-formal-spa.mjs'
import {
  isBenignSimVisualConsole,
  isBenignSimVisualFailedResponseUrl,
} from '../src/lib/sim/simVisualLaunchContract'

/** 可忽略的控制台噪声（非应用崩溃）。 */
function isBenignConsole(text: string): boolean {
  if (isBenignSimVisualConsole(text)) return true
  const t = text.toLowerCase()
  // 无头环境无 WebGPU 适配器属预期，应用有 CPU 兜底
  if (t.includes('webgpu') && (t.includes('not supported') || t.includes('failed to get') || t.includes('no adapter'))) {
    return true
  }
  // Chromium 无头 WebGL 警告
  if (t.includes('webgl') && (t.includes('disabled') || t.includes('not supported'))) return true
  // 第三方字体偶发失败不挡烟雾
  if (t.includes('fonts.googleapis.com') || t.includes('fonts.gstatic.com')) return true
  // React Router future flags 等 info 误标
  if (t.includes('react router future flag')) return true
  return false
}

type Capture = {
  pageErrors: string[]
  consoleErrors: string[]
  badResponses: string[]
  failedRequests: string[]
}

function attachCapture(page: Page): Capture {
  const cap: Capture = { pageErrors: [], consoleErrors: [], badResponses: [], failedRequests: [] }
  page.on('pageerror', (err) => {
    cap.pageErrors.push(err.message || String(err))
  })
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isBenignConsole(text)) return
    cap.consoleErrors.push(text)
  })
  page.on('response', (res) => {
    const status = res.status()
    if (status < 400) return
    const url = res.url()
    // Optional Host APIs are not part of the static preview process. Assets
    // and all other requests remain fail-closed below.
    if (isBenignSimVisualFailedResponseUrl(url)) return
    const ct = res.headers()['content-type'] ?? ''
    const isAsset =
      /\.(js|mjs|css|wasm|json|map)(\?|$)/i.test(url) ||
      ct.includes('javascript') ||
      ct.includes('css') ||
      ct.includes('wasm')
    if (isAsset || url.includes('/assets/')) {
      cap.badResponses.push(`${status} ${url}`)
    }
  })
  page.on('requestfailed', (req) => {
    const url = req.url()
    if (isBenignSimVisualFailedResponseUrl(url)) return
    cap.failedRequests.push(`${req.failure()?.errorText ?? 'failed'} ${url}`)
  })
  return cap
}

async function settleRoute(page: Page) {
  // 懒加载 chunk + 首帧 React 提交；避免 networkidle（仿真 rAF 永不 idle）
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached' })
  // 等 Layout 壳或页面标题区出现（空挂/Suspense 永久转圈会超时）
  await page.locator('#root').evaluate(async (root) => {
    const start = performance.now()
    while (performance.now() - start < 12_000) {
      if (root.childElementCount > 0 && (root.textContent?.trim().length ?? 0) > 0) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('#root 在超时内仍无可见内容（懒加载或渲染失败）')
  })
  // 给 lazy import 与首帧 effect 一点时间抛错
  await page.waitForTimeout(400)
}

test.describe('路由烟雾（无头 Chromium 真渲染）', () => {
  test.beforeEach(async ({ page }) => {
    // Route rendering must not depend on the external telemetry network.
    // check:formal-spa separately validates the production bootstrap URL and
    // binding attributes. Application asset/request failures still fail below.
    await page.route(FORMAL_RADAR_BINDING.bootstrapUrl, route => route.fulfill({
      contentType: 'text/javascript', body: '/* External Radar telemetry isolated for route smoke. */',
    }))
  })

  for (const route of SMOKE_ROUTES) {
    test(`${route.label} → ${route.path}`, async ({ page }) => {
      const cap = attachCapture(page)

      const res = await page.goto(route.path, { waitUntil: 'commit' })
      expect(res, `无响应: ${route.path}`).toBeTruthy()
      // preview 对 SPA 路径应 200（_redirects / historyApiFallback 式由 vite preview 处理）
      expect(res!.status(), `HTTP ${res!.status()} ${route.path}`).toBeLessThan(400)

      await settleRoute(page)

      // 致命：未捕获异常 / 控制台 error / 关键资源失败
      const failures = [
        ...cap.pageErrors.map((m) => `[pageerror] ${m}`),
        ...cap.consoleErrors.map((m) => `[console.error] ${m}`),
        ...cap.badResponses.map((m) => `[response] ${m}`),
        ...cap.failedRequests.map((m) => `[requestfailed] ${m}`),
      ]
      expect(failures, failures.join('\n')).toEqual([])
    })
  }
})

test('烟雾清单覆盖全部导航叶子', () => {
  // 防止 routes.ts 与 router 脱节时静默漏路径
  expect(SMOKE_ROUTES.length).toBeGreaterThanOrEqual(40)
  const paths = new Set(SMOKE_ROUTES.map((r) => r.path))
  expect(paths.has('/')).toBe(true)
  expect(paths.has('/fluid')).toBe(true) // 曾因 export 名错误整页空白
  expect(paths.has('/fdtd')).toBe(true)
  expect(paths.has('/md')).toBe(true)
})
