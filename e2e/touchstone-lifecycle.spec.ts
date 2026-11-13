import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const touchstone = [
  '! simple measured-like test fixture (not vendor data)',
  '# GHz S RI R 50',
  '1 0 0 0.8 0 0.8 0 0.1 0',
  '2 0.2 0 0.7 0 0.7 0 0.1 0',
  '3 0 0.5 0.6 0 0.6 0 0.1 0',
].join('\n')

const replacement = '# MHz S RI R 50\n10 0.1 0\n20 0.2 0'

function nativeVswrResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'vswr',
      operation: 'cst-s11-vswr-sweep',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
      result: {
        sampleCount: 3,
        points: [
          { frequencyHz: 1e9, s11: [0, 0], magnitude: 0, vswr: 1, returnLossDb: null, reflectedPowerFraction: 0 },
          { frequencyHz: 2e9, s11: [0.2, 0], magnitude: 0.2, vswr: 1.5, returnLossDb: 13.979400086720375, reflectedPowerFraction: 0.04 },
          { frequencyHz: 3e9, s11: [0, 0.5], magnitude: 0.5, vswr: 3, returnLossDb: 6.020599913279624, reflectedPowerFraction: 0.25 },
        ],
        maxVswr: 3,
        meanReflectedPowerFraction: 0.09666666666666666,
      },
    },
  }
}

type Mode = 'success' | 'failure' | 'queued' | 'deferred'

async function mockJobs(page: Page, mode: Mode) {
  let releasePending: (() => void) | undefined
  const pendingResponse = new Promise<void>((resolve) => { releasePending = resolve })
  const submissions: Array<Record<string, unknown>> = []
  let deferredOnce = false
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: 'touchstone-job' } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      if (mode === 'deferred' && !deferredOnce) {
        deferredOnce = true
        await pendingResponse
        try {
          await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeVswrResult() } } })
        } catch {
          // File selection aborts the request; release still settles the mocked route.
        }
        return
      }
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
        return
      }
      if (mode === 'failure') {
        await route.fulfill({ status: 200, json: { job: { status: 'failed', error: { message: 'mock Touchstone failure' } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeVswrResult() } } })
    }
  })
  return { submissions, releasePending: () => releasePending?.() }
}

async function chooseTouchstone(page: Page, name = 'fixture.s2p', contents = touchstone) {
  await page.getByTestId('touchstone-file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(contents) })
  await expect(page.getByTestId('touchstone-preview')).toContainText(name)
}

test.describe('CST Touchstone S11 analysis lifecycle', () => {
  test('cancels a queued native job and clears its pending results', async ({ page }) => {
    const mock = await mockJobs(page, 'queued')
    await page.goto('/cst')
    await chooseTouchstone(page)

    await page.getByTestId('touchstone-analyze').click()
    await expect(page.getByTestId('touchstone-cancel')).toBeVisible()
    await page.getByTestId('touchstone-cancel').click()
    await expect(page.getByTestId('touchstone-cancel')).toHaveCount(0)
    await expect(page.getByTestId('touchstone-results')).toHaveCount(0)
    await expect(page.locator('section[aria-labelledby="touchstone-import-title"]')).toContainText(/cancelled/)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.submissions[0]).toMatchObject({ model: { inline: { module: 'vswr', backend: 'host', operation: 'cst-s11-vswr-sweep' } } })
  })

  test('reports a failed native response without rendering results', async ({ page }) => {
    const mock = await mockJobs(page, 'failure')
    await page.goto('/cst')
    await chooseTouchstone(page)

    await page.getByTestId('touchstone-analyze').click()
    await expect(page.getByTestId('touchstone-error')).toBeVisible()
    await expect(page.getByTestId('touchstone-results')).toHaveCount(0)
    expect(mock.submissions).toHaveLength(1)
  })

  test('ignores a late response and status after the selected file changes', async ({ page }) => {
    const mock = await mockJobs(page, 'deferred')
    await page.goto('/cst')
    await chooseTouchstone(page)

    await page.getByTestId('touchstone-analyze').click()
    await expect(page.getByTestId('touchstone-cancel')).toBeVisible()
    await page.getByTestId('touchstone-file').setInputFiles({ name: 'replacement.s1p', mimeType: 'text/plain', buffer: Buffer.from(replacement) })
    await expect(page.getByTestId('touchstone-preview')).toContainText('replacement.s1p')
    mock.releasePending()
    await expect(page.getByTestId('touchstone-results')).toHaveCount(0)
    await expect(page.locator('section[aria-labelledby="touchstone-import-title"]')).toContainText(/idle/)
    await expect(page.locator('section[aria-labelledby="touchstone-import-title"]')).not.toContainText('touchstone-job')
    expect(mock.submissions).toHaveLength(1)
  })

  test('replacing a completed file clears its old preview and results', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await page.goto('/cst')
    await chooseTouchstone(page)

    await page.getByTestId('touchstone-analyze').click()
    await expect(page.getByTestId('touchstone-results')).toBeVisible()
    await page.getByTestId('touchstone-file').setInputFiles({ name: 'replacement.s1p', mimeType: 'text/plain', buffer: Buffer.from(replacement) })
    await expect(page.getByTestId('touchstone-preview')).toContainText('replacement.s1p')
    await expect(page.getByTestId('touchstone-preview')).not.toContainText('fixture.s2p')
    await expect(page.getByTestId('touchstone-results')).toHaveCount(0)
    await expect(page.getByTestId('touchstone-analyze')).toBeEnabled()
    expect(mock.submissions).toHaveLength(1)
  })
})
