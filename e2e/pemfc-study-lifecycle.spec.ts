import { expect, test, type Page, type Route } from '@playwright/test'

const jobId = 'pemfc-study-e2e'
const scopeNote = 'Bounded zero-dimensional PEMFC polarization study.'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

function nativeStudyResult() {
  const current = Array.from({ length: 21 }, (_, index) => index / 20)
  const voltage = current.map(value => value === 0 ? 1 : value <= 0.5 ? 0.75 : 0.6)
  const power = current.map((value, index) => value * voltage[index])
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1, wallTimeMs: 1 },
    backend: { id: 'w-sim-cuda' },
    moduleResult: {
      module: 'sw-comsol-pemfc',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        T: 353.15, pH2: 1, pO2: 0.21, pH2O: 1,
        E0: 1.229, E0T: 1.18225, j: 0.5, j0: 1e-4, alpha: 0.5,
        n: 2, R: 0.05, jLim: 2, thermalVoltage: 0.03043,
        E_nernst: 1, eta_act: 0.2, eta_ohm: 0.025, eta_conc: 0.025,
        V: 0.75, powerDensity: 0.375, voltageEfficiency: 0.75,
        curve: { current, voltage, power },
        units: 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2',
        method: 'polarization', ok: true,
        methodId: 'method-algo-pemfc-polarization', familyId: 'method-pemfc', scopeNote,
      },
    },
  }
}

type Mode = 'success' | 'queued' | 'delayed-result'

async function mockJobs(page: Page, mode: Mode) {
  let releasePending: (() => void) | undefined
  let notifyPending: (() => void) | undefined
  const pendingResponse = new Promise<void>(resolve => { releasePending = resolve })
  const pendingStarted = new Promise<void>(resolve => { notifyPending = resolve })
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
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'queued' } } })
        return
      }
      if (mode === 'delayed-result' && !deferredOnce) {
        deferredOnce = true
        notifyPending?.()
        await pendingResponse
        try {
          await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeStudyResult() } } })
        } catch {
          // The lifecycle action can abort this poll; releasing the gate settles the handler.
        }
        return
      }
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeStudyResult() } } })
    }
  })
  return { submissions, cancellations, pendingStarted, releasePending: () => releasePending?.() }
}

test.describe('PEMFC polarization study lifecycle', () => {
  test('editing the draft clears results from its completed submitted snapshot', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await page.goto('/comsol')

    await page.getByTestId('pemfc-study-run').click()
    await expect(page.getByTestId('pemfc-study-results')).toBeVisible()
    await page.getByTestId('pemfc-operating-current').fill('0.4')
    await expect(page.getByTestId('pemfc-study-results')).toHaveCount(0)
    await expect(page.getByTestId('pemfc-study-run')).toBeEnabled()
    expect(mock.submissions).toHaveLength(1)
    expect(mock.submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-comsol-pemfc' },
      model: { source: 'inline', inline: { module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', T: 353.15, pH2: 1, pO2: 0.21, pH2O: 1, j: 0.5, imax: 1, points: 21 } },
    })
  })

  test('reset clears a completed result and restores the default draft', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await page.goto('/comsol')

    await page.getByTestId('pemfc-study-run').click()
    await expect(page.getByTestId('pemfc-study-results')).toBeVisible()
    await page.getByTestId('pemfc-study-reset').click()
    await expect(page.getByTestId('pemfc-study-results')).toHaveCount(0)
    await expect(page.getByTestId('pemfc-study-status')).toHaveText('Status: idle')
    await expect(page.getByTestId('pemfc-operating-current')).toHaveValue('0.5')
    expect(mock.submissions).toHaveLength(1)
  })

  test('cancelling an active poll aborts and ignores its late result', async ({ page }) => {
    const mock = await mockJobs(page, 'delayed-result')
    await page.goto('/comsol')

    await page.getByTestId('pemfc-study-run').click()
    await expect(page.getByTestId('pemfc-study-cancel')).toBeVisible()
    await mock.pendingStarted
    await page.getByTestId('pemfc-study-cancel').click()
    mock.releasePending()
    await expect(page.getByTestId('pemfc-study-cancel')).toHaveCount(0)
    await expect(page.getByTestId('pemfc-study-results')).toHaveCount(0)
    await expect(page.getByTestId('pemfc-study-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
  })

  test('unmounting while a poll is pending prevents the stale result from reappearing', async ({ page }) => {
    const mock = await mockJobs(page, 'delayed-result')
    await page.goto('/comsol')

    await page.getByTestId('pemfc-study-run').click()
    await expect(page.getByTestId('pemfc-study-cancel')).toBeVisible()
    await mock.pendingStarted
    await page.goto('/opticstudio')
    mock.releasePending()
    await page.goto('/comsol')
    await expect(page.getByTestId('pemfc-study-results')).toHaveCount(0)
    await expect(page.getByTestId('pemfc-study-status')).toHaveText('Status: idle')
    expect(mock.submissions).toHaveLength(1)
  })
})
