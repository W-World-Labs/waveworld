/**
 * Visual launch of EVERY Sim-domain leaf against real Vite preview.
 * Path list is catalog/nav isomorphic — not a hand-trimmed sample.
 * Pure predicates live in src/lib/sim/simVisualLaunchContract.ts (#32 launch-contract-bar).
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import {
  SIM_VISUAL_ROUTES,
  assertSimVisualCoverageComplete,
  type SimVisualRoute,
} from './sim-visual-routes'
import {
  isBenignSimVisualConsole,
  isBenignSimVisualFailedResponseUrl,
  simVisibleStageSelector,
  SIM_VISIBLE_STAGE_ATTACHED_FALLBACK,
} from '../src/lib/sim/simVisualLaunchContract'

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
    if (isBenignSimVisualConsole(text)) return
    cap.consoleErrors.push(text)
  })
  page.on('response', (res) => {
    const status = res.status()
    if (status < 400) return
    const url = res.url()
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
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached' })
  await page.locator('#root').evaluate(async (root) => {
    const start = performance.now()
    while (performance.now() - start < 15_000) {
      if (root.childElementCount > 0 && (root.textContent?.trim().length ?? 0) > 0) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('#root 在超时内仍无可见内容（懒加载或渲染失败）')
  })
  await page.waitForTimeout(350)
}

/**
 * Visible stage for catalog hasVisibleStage leaves:
 * canvas / svg / iframe / role=img / .stage / [data-sim-stage]
 */
async function assertVisibleStage(page: Page, route: SimVisualRoute) {
  if (!route.hasVisibleStage) return
  const stage = page.locator(simVisibleStageSelector())
  const count = await stage.count()
  expect(
    count,
    `no visual stage on ${route.path} (tier=${route.tier} renderer=${route.renderer})`,
  ).toBeGreaterThan(0)
  // At least one stage node should be attached and have non-zero layout box when visible
  let anyVisible = false
  const n = Math.min(count, 8)
  for (let i = 0; i < n; i++) {
    const el = stage.nth(i)
    if (await el.isVisible().catch(() => false)) {
      anyVisible = true
      break
    }
  }
  // Some canvases start 0-size until layout; still require count > 0
  if (!anyVisible) {
    // Accept attached canvas even if temporarily not "visible" to a11y (WebGL)
    const attached = await page.locator(SIM_VISIBLE_STAGE_ATTACHED_FALLBACK).count()
    expect(
      attached,
      `stage present but not visible on ${route.path}`,
    ).toBeGreaterThan(0)
  }
}

test.describe('sim visual launch (all Sim leaves)', () => {
  test('visual list covers 100% catalog + Sim nav (isomorphic)', () => {
    const cov = assertSimVisualCoverageComplete()
    expect(cov.missingFromVisual, cov.missingFromVisual.join(',')).toEqual([])
    expect(cov.visualCount).toBe(cov.simNavCount)
    expect(cov.visualCount).toBe(cov.catalogCount)
    expect(cov.visualCount).toBeGreaterThanOrEqual(37)
    expect(SIM_VISUAL_ROUTES.length).toBe(cov.visualCount)
  })

  for (const route of SIM_VISUAL_ROUTES) {
    test(`sim ${route.tier} · ${route.label} → ${route.path}`, async ({ page }) => {
      const cap = attachCapture(page)

      const res = await page.goto(route.path, { waitUntil: 'commit' })
      expect(res, `no response: ${route.path}`).toBeTruthy()
      expect(res!.status(), `HTTP ${res!.status()} ${route.path}`).toBeLessThan(400)

      await settleRoute(page)

      // Non-empty paint in app root
      const textLen = await page.locator('#root').evaluate((r) => r.textContent?.trim().length ?? 0)
      expect(textLen, `empty root text on ${route.path}`).toBeGreaterThan(0)

      await assertVisibleStage(page, route)

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
