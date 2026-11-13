import { expect, test, type Page, type Route } from '@playwright/test'

const jobId = 'coating-study-job'
const wavelengths = [400, 550, 700]

function nativeCoatingResult() {
  const spectrum = wavelengths.map((lambda, index) => ({
    lambda,
    Rs: 0.1 + index * 0.01,
    Ts: 0.8 - index * 0.01,
    As: 0.1,
    Rp: 0.12 + index * 0.01,
    Tp: 0.78 - index * 0.01,
    Ap: 0.1,
    R: 0.11 + index * 0.01,
    T: 0.79 - index * 0.01,
    A: 0.1,
    energyResidual: 0,
  }))
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-optics-thinfilm',
      backend: { id: 'w-sim-cuda-host', deviceName: 'w-sim-cuda-host' },
      result: {
        ok: true,
        methodId: 'method-algo-thinfilm-rt',
        familyId: 'method-sw-optics-thinfilm',
        polarization: 'unpolarized',
        spectrum,
      },
    },
  }
}

type Mode = 'queued' | 'remote-error' | 'deferred' | 'success'

async function mockJobs(page: Page, mode: Mode) {
  let releasePending: (() => void) | undefined
  const pendingResponse = new Promise<void>((resolve) => { releasePending = resolve })
  let deferredOnce = false
  const submissions: Array<Record<string, unknown>> = []
  const cancellations: string[] = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      cancellations.push(path)
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      if (mode === 'deferred' && !deferredOnce) {
        deferredOnce = true
        await pendingResponse
        try {
          await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeCoatingResult() } } })
        } catch {
          // Editing can abort the poll; releasing the gate still settles this handler.
        }
        return
      }
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'queued' } } })
        return
      }
      if (mode === 'remote-error') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'failed', error: { message: 'mock coating sweep failure' } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeCoatingResult() } } })
    }
  })
  return { submissions, cancellations, releasePending: () => releasePending?.() }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

test.describe('OpticStudio coating study lifecycle', () => {
  test('submits a bounded native sweep and renders only its mocked samples', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await page.goto('/opticstudio')

    await expect(page.getByTestId('coating-study')).toBeVisible()
    await page.getByTestId('coating-study-samples').fill('3')
    await page.getByTestId('coating-study-run').click()

    const results = page.getByTestId('coating-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('coating-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('deviceName: w-sim-cuda-host')
    await expect(page.getByTestId('coating-study-plot')).toBeVisible()
    await expect(page.getByTestId('coating-study-table').locator('tbody tr')).toHaveCount(3)
    const table = page.getByTestId('coating-study-table').locator('tbody')
    await expect(table).toContainText('400')
    await expect(table).toContainText('550')
    await expect(table).toContainText('700')
    await expect(table).toContainText('0.11')

    expect(mock.submissions).toHaveLength(1)
    expect(mock.submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-optics-thinfilm' },
      model: {
        source: 'inline',
        inline: {
          module: 'sw-optics-thinfilm',
          method: 'method-algo-thinfilm-rt',
          backend: 'host',
          wavelengths,
        },
      },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })
  })

  test('cancels a queued coating sweep and clears pending results', async ({ page }) => {
    const mock = await mockJobs(page, 'queued')
    await page.goto('/opticstudio')

    await page.getByTestId('coating-study-run').click()
    await expect(page.getByTestId('coating-study-cancel')).toBeVisible()
    await page.getByTestId('coating-study-cancel').click()
    await expect(page.getByTestId('coating-study-cancel')).toHaveCount(0)
    await expect(page.getByTestId('coating-study-results')).toHaveCount(0)
    await expect(page.getByTestId('coating-study-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
    expect(mock.submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-optics-thinfilm' },
      model: { inline: { module: 'sw-optics-thinfilm', method: 'method-algo-thinfilm-rt', backend: 'host' } },
      requirements: { backends: ['cuda'] },
    })
  })

  test('shows a remote coating failure without rendering results', async ({ page }) => {
    const mock = await mockJobs(page, 'remote-error')
    await page.goto('/opticstudio')

    await page.getByTestId('coating-study-run').click()
    await expect(page.getByTestId('coating-study-error')).toContainText(/计算失败|calculation failed/i)
    await expect(page.getByTestId('coating-study-results')).toHaveCount(0)
    expect(mock.submissions).toHaveLength(1)
  })

  test('discards a late sweep and old status after the study changes', async ({ page }) => {
    const mock = await mockJobs(page, 'deferred')
    await page.goto('/opticstudio')

    await page.getByTestId('coating-study-run').click()
    await expect(page.getByTestId('coating-study-cancel')).toBeVisible()
    await page.getByTestId('coating-study-start-wavelength').fill('410')
    mock.releasePending()
    await expect(page.getByTestId('coating-study-results')).toHaveCount(0)
    await expect(page.getByTestId('coating-study-status')).not.toContainText(jobId)
    await expect(page.getByTestId('coating-study-status')).toContainText(/idle/i)
    expect(mock.submissions).toHaveLength(1)
  })
})
