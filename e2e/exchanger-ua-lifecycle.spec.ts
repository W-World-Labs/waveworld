import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const jobId = 'exchanger-ua-study-job'

function nativeStudyResult() {
  const cases = [
    { UA: 100, NTU: 1, effectiveness: 0.5, Q: 3500, T_hot_out: 328.15, T_cold_out: 328.15 },
    { UA: 200, NTU: 2, effectiveness: 2 / 3, Q: 14000 / 3, T_hot_out: 363.15 - 140 / 3, T_cold_out: 293.15 + 140 / 3 },
    { UA: 300, NTU: 3, effectiveness: 0.75, Q: 5250, T_hot_out: 310.65, T_cold_out: 345.65 },
  ]
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      ok: true,
      module: 'sw-openmodelica-heat-exchanger',
      backend: 'w-sim-cuda-host',
      result: {
        model: 'steady-effectiveness-NTU-UA-parameter-sweep',
        parameter: 'UA',
        methodId: 'method-algo-sw-openmodelica-heat-exchanger',
        familyId: 'method-sw-openmodelica-heat-exchanger',
        cases: cases.map(row => ({
          model: 'steady-effectiveness-NTU', arrangement: 'counterflow', Chot: 100, Ccold: 100,
          ...row, Cmin: 100, Cmax: 100, Cr: 1,
          T_hot_in: 363.15, T_cold_in: 293.15,
          hotLoss: row.Q, coldGain: row.Q,
          energyBalance: 'hotLoss == coldGain == Q',
          methodId: 'method-algo-sw-openmodelica-heat-exchanger',
          familyId: 'method-sw-openmodelica-heat-exchanger',
        })),
      },
    },
  }
}

type Mode = 'queued' | 'failed' | 'delayed-auth' | 'delayed-result' | 'success'

async function mockJobs(page: Page, mode: Mode) {
  let releasePending: (() => void) | undefined
  const pendingResponse = new Promise<void>(resolve => { releasePending = resolve })
  let deferredOnce = false
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', async (route) => {
    if (mode === 'delayed-auth') {
      await pendingResponse
      try {
        await route.fulfill({ status: 200, json: { user: { id: 'test-user' } } })
      } catch {
        // Reset aborts authentication; releasing the gate still settles the mock handler.
      }
      return
    }
    await route.fulfill({ status: 200, json: { user: { id: 'test-user' } } })
  })
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
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      if (mode === 'delayed-result' && !deferredOnce) {
        deferredOnce = true
        await pendingResponse
        try {
          await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeStudyResult() } } })
        } catch {
          // Editing the draft aborts the poll; releasing the gate still settles this handler.
        }
        return
      }
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
        return
      }
      if (mode === 'failed') {
        await route.fulfill({ status: 200, json: { job: { status: 'failed', error: { message: 'mock exchanger study failure' } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeStudyResult() } } })
    }
  })
  return { submissions, releasePending: () => releasePending?.() }
}

test.describe('Dymola exchanger UA study lifecycle', () => {
  test('cancels a queued study and keeps existing generic Dymola cases available', async ({ page }) => {
    const mock = await mockJobs(page, 'queued')
    await page.goto('/dymola')

    await expect(page.getByTestId('exchanger-study-run')).toBeVisible()
    await expect(page.getByLabel('Dymola input')).toBeVisible()
    await expect(page.getByText(/native cases available/i)).toBeVisible()
    await page.getByTestId('exchanger-study-run').click()
    await expect(page.getByTestId('exchanger-study-cancel')).toBeVisible()
    await page.getByTestId('exchanger-study-cancel').click()
    await expect(page.getByTestId('exchanger-study-cancel')).toHaveCount(0)
    await expect(page.getByTestId('exchanger-study-results')).toHaveCount(0)
    await expect(page.getByTestId('exchanger-study-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-openmodelica-heat-exchanger' },
      model: { source: 'inline', inline: { module: 'sw-openmodelica-heat-exchanger', backend: 'host', dynamic: false, sweep_UA: [100, 200, 300] } },
    })
  })

  test('shows a remote failure without rendering results', async ({ page }) => {
    const mock = await mockJobs(page, 'failed')
    await page.goto('/dymola')
    await page.getByTestId('exchanger-study-run').click()
    await expect(page.getByTestId('exchanger-study-error')).toContainText(/计算失败|calculation failed/i)
    await expect(page.getByTestId('exchanger-study-results')).toHaveCount(0)
    expect(mock.submissions).toHaveLength(1)
  })

  test('discards delayed authentication after reset', async ({ page }) => {
    const mock = await mockJobs(page, 'delayed-auth')
    await page.goto('/dymola')
    await page.getByTestId('exchanger-study-run').click()
    await expect(page.getByTestId('exchanger-study-status')).toContainText(/submitting/i)
    await page.getByTestId('exchanger-study-reset').click()
    mock.releasePending()
    await expect(page.getByTestId('exchanger-study-results')).toHaveCount(0)
    await expect(page.getByTestId('exchanger-study-status')).toHaveText('idle')
    expect(mock.submissions).toHaveLength(0)
  })

  test('discards a late result and old status after an input edit', async ({ page }) => {
    const mock = await mockJobs(page, 'delayed-result')
    await page.goto('/dymola')
    await page.getByTestId('exchanger-study-run').click()
    await expect(page.getByTestId('exchanger-study-cancel')).toBeVisible()
    await page.getByTestId('exchanger-hot-capacity').fill('125')
    mock.releasePending()
    await expect(page.getByTestId('exchanger-study-results')).toHaveCount(0)
    await expect(page.getByTestId('exchanger-study-status')).not.toContainText(jobId)
    await expect(page.getByTestId('exchanger-study-status')).toHaveText('idle')
    expect(mock.submissions).toHaveLength(1)
  })

  test('clears completed results when the study draft changes', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await page.goto('/dymola')
    await page.getByTestId('exchanger-study-run').click()
    await expect(page.getByTestId('exchanger-study-results')).toBeVisible()
    await page.getByTestId('exchanger-ua-end').fill('400')
    await expect(page.getByTestId('exchanger-study-results')).toHaveCount(0)
    await expect(page.getByTestId('exchanger-study-run')).toBeEnabled()
    expect(mock.submissions).toHaveLength(1)
  })
})
