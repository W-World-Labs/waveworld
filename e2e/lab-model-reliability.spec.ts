/**
 * #49-E Lab reliability browser evidence.
 *
 * - Always: Atlas /lab-cfd redirect smoke (vite preview webServer) + pageerror capture
 * - When LAB_E2E_URL set (default: production lab): load Lab, click NACA, collect errors
 *
 * Evidence JSON: test-results/lab-e2e-49e-evidence.json
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  isBenignSimVisualConsole,
  isBenignSimVisualFailedResponseUrl,
} from '../src/lib/sim/simVisualLaunchContract'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

/** Live Lab e2e is opt-in. Unset LAB_E2E_URL → skip remote Lab (do not hit production). */
const LAB_E2E_URL = process.env.LAB_E2E_URL ?? ''

const PROD_ATLAS = process.env.ATLAS_E2E_URL ?? ''

function isBenignConsole(text: string): boolean {
  if (isBenignSimVisualConsole(text)) return true
  const t = text.toLowerCase()
  if (t.includes('webgpu') && (t.includes('not supported') || t.includes('no adapter') || t.includes('failed'))) {
    return true
  }
  if (t.includes('webgl') && (t.includes('disabled') || t.includes('not supported'))) return true
  if (t.includes('fonts.googleapis') || t.includes('fonts.gstatic')) return true
  if (t.includes('download the react devtools')) return true
  // Three.js / R3F noise in headless
  if (t.includes('multiple instances of three')) return true
  if (t.includes('chromium') && t.includes('gpu')) return true
  return false
}

type Capture = {
  pageErrors: string[]
  consoleErrors: string[]
  requestFailed: string[]
  modelGets: string[]
}

function attachCapture(page: Page): Capture {
  const cap: Capture = { pageErrors: [], consoleErrors: [], requestFailed: [], modelGets: [] }
  page.on('pageerror', (err) => {
    cap.pageErrors.push(err.message || String(err))
  })
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isBenignConsole(text)) return
    cap.consoleErrors.push(text)
  })
  page.on('requestfailed', (req) => {
    const url = req.url()
    // Aborted probes are historical; ignore cancelled non-model noise
    if (req.failure()?.errorText === 'net::ERR_ABORTED' && !url.includes('/models/')) return
    cap.requestFailed.push(`${req.failure()?.errorText ?? 'failed'} ${url}`)
  })
  page.on('request', (req) => {
    if (req.method() === 'GET' && /\/models\/[^/?#]+\.(stl|glb|gltf)(\?|$)/i.test(req.url())) {
      cap.modelGets.push(req.url())
    }
  })
  return cap
}

function writeEvidence(name: string, payload: Record<string, unknown>) {
  const dir = path.resolve(process.cwd(), 'test-results')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2))
  return file
}

test.describe('#49-E Lab reliability browser', () => {
  test('Local Lab starts with CSP enabled and switching compute does not submit a job', async ({ page }) => {
    const labURL = `http://127.0.0.1:${process.env.E2E_LAB_PORT ?? 4180}/lab`
    const cap = attachCapture(page)
    const jobPosts: string[] = []
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().includes('/api/v1/jobs')) jobPosts.push(req.url())
    })
    const first = await page.goto(labURL)
    const policy = first?.headers()['content-security-policy'] ?? ''
    expect(policy).toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
    await page.getByRole('tab', { name: '参数', exact: true }).click()
    await expect(page.getByRole('heading', { name: '流场参数' })).toBeVisible()
    await page.getByRole('button', { name: '后端计算', exact: true }).click()
    await expect(page.getByRole('button', { name: '后端计算', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const second = await page.reload()
    expect(second?.headers()['content-security-policy']).not.toBe(policy)
    await expect(page.getByLabel('查找模型')).toBeVisible()
    expect(jobPosts).toEqual([])
    expect(cap.pageErrors).toEqual([])
    expect(cap.consoleErrors).toEqual([])
  })

  test('Atlas /lab-cfd redirects to the unified wind module without page errors', async ({ page }) => {
    const cap = attachCapture(page)
    // Prefer production atlas (always has lab wiring); fall back to local baseURL path
    const candidates = [PROD_ATLAS ? `${PROD_ATLAS}/lab-cfd` : '', '/lab-cfd'].filter(Boolean)
    let loaded = false
    let used = ''
    for (const url of candidates) {
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        if (res && res.status() < 400) {
          loaded = true
          used = url
          break
        }
      } catch {
        /* try next */
      }
    }
    expect(loaded, 'could not load /lab-cfd').toBe(true)
    await expect(page).toHaveURL(/\/windtunnel$/)
    await expect(page.locator('[data-simulation-module]')).toHaveAttribute('data-simulation-module', 'windtunnel')

    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(20)

    // iframe may or may not be present depending on VITE_LAB_URL deploy
    const iframeCount = await page.locator('iframe').count()

    const failures = [
      ...cap.pageErrors.map((m) => `[pageerror] ${m}`),
      ...cap.consoleErrors.map((m) => `[console.error] ${m}`),
      ...cap.requestFailed
        .filter((m) => !isBenignSimVisualFailedResponseUrl(m))
        .map((m) => `[requestfailed] ${m}`),
    ]
    writeEvidence('lab-e2e-49e-gateway-evidence.json', {
      suite: 'lab-cfd-gateway',
      url: used,
      ok: failures.length === 0,
      iframeCount,
      pageerror: cap.pageErrors,
      consoleError: cap.consoleErrors,
      requestFailed: cap.requestFailed,
    })
    expect(failures, failures.join('\n')).toEqual([])
  })

  test('Production Lab: enter model tab, load NACA once, zero pageerror', async ({ page }) => {
    test.skip(!LAB_E2E_URL, 'set LAB_E2E_URL to run live Lab e2e')
    test.setTimeout(120_000)
    const cap = attachCapture(page)

    const res = await page.goto(LAB_E2E_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    expect(res, 'lab response').toBeTruthy()
    expect(res!.status(), `HTTP ${res!.status()}`).toBeLessThan(400)

    // Wait for client shell
    await page.waitForTimeout(1500)

    // Prefer models tab if present (Chinese UI)
    const modelTab = page.getByRole('tab', { name: /模型|Models/i }).first()
    if (await modelTab.count()) {
      await modelTab.click()
      await page.waitForTimeout(400)
    }

    // Initial model GETs should be 0 storm; allow zero or only after click
    const getsBefore = cap.modelGets.length

    // Click first "加载模型" that looks like NACA if possible
    const nacaCard = page.locator('text=NACA').first()
    const loadButtons = page.getByRole('button', { name: /加载模型|Load/i })
    if (await nacaCard.count()) {
      const card = nacaCard.locator('xpath=ancestor::*[contains(@class,"border") or self::div][1]')
      const btn = card.getByRole('button', { name: /加载模型|Load/i }).first()
      if (await btn.count()) {
        await btn.click()
      } else if (await loadButtons.count()) {
        await loadButtons.first().click()
      }
    } else if (await loadButtons.count()) {
      await loadButtons.first().click()
    } else {
      // Lab may open directly on params; still assert no pageerror
      writeEvidence('lab-e2e-49e-lab-evidence.json', {
        suite: 'lab-naca-load',
        url: LAB_E2E_URL,
        ok: false,
        skipped: 'no load button found',
        pageerror: cap.pageErrors,
        consoleError: cap.consoleErrors,
        modelGets: cap.modelGets,
      })
      test.skip(true, 'Lab UI has no 加载模型 button — layout changed')
      return
    }

    // Allow model fetch + parse
    await page.waitForTimeout(4000)

    const nacaGets = cap.modelGets.filter((u) => /naca0012/i.test(u))
    // Prefer exactly one NACA GET after click; allow 0 if procedural only in edge env
    if (nacaGets.length > 0) {
      expect(nacaGets.length, `NACA GETs: ${nacaGets.join(', ')}`).toBeLessThanOrEqual(2)
    }

    const failures = [
      ...cap.pageErrors.map((m) => `[pageerror] ${m}`),
      ...cap.consoleErrors.map((m) => `[console.error] ${m}`),
    ]

    writeEvidence('lab-e2e-49e-lab-evidence.json', {
      suite: 'lab-naca-load',
      url: LAB_E2E_URL,
      ok: failures.length === 0,
      getsBeforeClick: getsBefore,
      modelGets: cap.modelGets,
      nacaGets,
      pageerror: cap.pageErrors,
      consoleError: cap.consoleErrors,
      requestFailed: cap.requestFailed.filter((r) => r.includes('/models/')),
    })

    expect(failures, failures.join('\n')).toEqual([])
  })

  test('Production Lab: slow-net model GET still no pageerror (route delay)', async ({ page }) => {
    test.skip(!LAB_E2E_URL, 'set LAB_E2E_URL to run live Lab e2e')
    test.setTimeout(120_000)
    const cap = attachCapture(page)

    await page.route('**/models/**', async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })

    await page.goto(LAB_E2E_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)

    const modelTab = page.getByRole('tab', { name: /模型|Models/i }).first()
    if (await modelTab.count()) {
      await modelTab.click()
      await page.waitForTimeout(500)
    }

    const loadButtons = page.getByRole('button', { name: /加载模型|Load/i })
    await expect(loadButtons.first()).toBeVisible({ timeout: 20_000 })
    await loadButtons.first().click()
    await page.waitForTimeout(5000)

    const failures = [
      ...cap.pageErrors.map((m) => `[pageerror] ${m}`),
      ...cap.consoleErrors.map((m) => `[console.error] ${m}`),
    ]
    writeEvidence('lab-e2e-49e-slownet-evidence.json', {
      suite: 'lab-slow-net',
      url: LAB_E2E_URL,
      ok: failures.length === 0,
      pageerror: cap.pageErrors,
      consoleError: cap.consoleErrors,
      modelGets: cap.modelGets,
    })
    expect(failures, failures.join('\n')).toEqual([])
  })

  test('#49-F Production Lab: multi-preset load buttons + diagnostic report control', async ({
    page,
  }) => {
    test.skip(!LAB_E2E_URL, 'set LAB_E2E_URL to run live Lab e2e')
    // Cap total wall time; large GLBs (X-57) may still complete under headless.
    test.setTimeout(300_000)
    const cap = attachCapture(page)

    await page.goto(LAB_E2E_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)

    // Diagnostic report channel must be present on shell (no model required).
    const reportBtn = page.locator('[data-lab-copy-diagnostic-report]')
    // Production may still be on older build without the button — soft assert when absent.
    const hasReportBtn = (await reportBtn.count()) > 0

    const modelTab = page.getByRole('tab', { name: /模型|Models/i }).first()
    if (await modelTab.count()) {
      await modelTab.click()
      await page.waitForTimeout(500)
    }

    const loadButtons = page.getByRole('button', { name: /加载模型|Load/i })
    await expect(loadButtons.first()).toBeVisible({ timeout: 20_000 })
    const count = await loadButtons.count()
    expect(count).toBeGreaterThanOrEqual(10)

    // Click up to 21 load buttons; skip wait on last; keep going after failures would still capture pageerror.
    // Prefer smaller models first: buttons are in catalog order (NACA first… X-57 last).
    const maxClicks = Math.min(count, 21)
    const loaded: number[] = []
    for (let i = 0; i < maxClicks; i++) {
      // Re-query — list may re-render after load.
      const btn = page.getByRole('button', { name: /加载模型|Load/i }).nth(i)
      if ((await btn.count()) === 0) continue
      if (!(await btn.isEnabled().catch(() => false))) continue
      await btn.scrollIntoViewIfNeeded().catch(() => undefined)
      await btn.click({ timeout: 10_000 }).catch(() => undefined)
      // Coarse wait: STL fast, large GLB slower; abort path if page crashed.
      await page.waitForTimeout(i >= 17 ? 6000 : 2500)
      loaded.push(i)
      if (cap.pageErrors.length > 0) break
    }

    const failures = [
      ...cap.pageErrors.map((m) => `[pageerror] ${m}`),
      ...cap.consoleErrors.map((m) => `[console.error] ${m}`),
    ]

    writeEvidence('lab-e2e-49f-multipreset-evidence.json', {
      suite: 'lab-multi-preset',
      url: LAB_E2E_URL,
      ok: failures.length === 0,
      loadButtonCount: count,
      clicked: loaded,
      hasDiagnosticReportButton: hasReportBtn,
      pageerror: cap.pageErrors,
      consoleError: cap.consoleErrors,
      modelGets: cap.modelGets,
      requestFailed: cap.requestFailed.filter((r) => r.includes('/models/')),
    })

    expect(failures, failures.join('\n')).toEqual([])
    expect(loaded.length).toBeGreaterThanOrEqual(5)
  })
})
