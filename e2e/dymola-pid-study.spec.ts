import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'dymola-pi-study-job'
const moduleName = 'sw-openmodelica-state-space-observers'

type Mode = 'success' | 'queued' | 'unauthenticated' | 'delayed-auth' | 'delayed-result'

function nativePiResult(input: Record<string, unknown>) {
  const times = input.times as number[]
  const samples = times.map((_, index) => [index === 0 ? 0 : index === 1 ? 1.25 : 3.5])
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      ok: true,
      module: moduleName,
      backend: 'w-sim-cuda-host',
      result: {
        method: 'state-space',
        methodId: 'method-openmodelica-state-space',
        discrete: false,
        finite: true,
        ok: true,
        times,
        y: samples,
      },
    },
  }
}

async function mockHost(page: Page, mode: Mode) {
  const submissions: Array<Record<string, unknown>> = []
  const cancellations: string[] = []
  let releasePending: (() => void) | undefined
  const pendingResponse = new Promise<void>(resolve => { releasePending = resolve })
  let deferredResult = false

  await page.route('**/api/v1/me', async route => {
    if (mode === 'unauthenticated') {
      await route.fulfill({ status: 401, json: { error: { message: 'Authentication required' } } })
      return
    }
    if (mode === 'delayed-auth') {
      await pendingResponse
      try {
        await route.fulfill({ status: 200, json: { user: { id: 'test-user' } } })
      } catch {
        // Reset aborts this auth request; releasing the mock gate settles it.
      }
      return
    }
    await route.fulfill({ status: 200, json: { user: { id: 'test-user' } } })
  })
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      submissions.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      cancellations.push(path)
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'queued' } } })
        return
      }
      if (mode === 'delayed-result' && !deferredResult) {
        deferredResult = true
        await pendingResponse
        try {
          const body = submissions.at(-1) as { spec?: { model?: { inline?: Record<string, unknown> } } } | undefined
          await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativePiResult(body?.spec?.model?.inline ?? {}) } } })
        } catch {
          // Editing the draft aborts the pending poll.
        }
        return
      }
      const body = submissions.at(-1) as { spec?: { model?: { inline?: Record<string, unknown> } } } | undefined
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativePiResult(body?.spec?.model?.inline ?? {}) } } })
      return
    }
    await route.fallback()
  })

  return { submissions, cancellations, releasePending: () => releasePending?.() }
}

async function openDymola(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
  await page.goto('/dymola')
}

test.describe('Dymola guided PI control study', () => {
  test('submits an authenticated bounded study, plots native samples, and exports the captured result', async ({ page }) => {
    const mock = await mockHost(page, 'success')
    await openDymola(page)

    await expect(page.getByTestId('pid-study-processGain')).toHaveValue('1')
    await page.getByTestId('pid-study-processGain').fill('2')
    await page.getByTestId('pid-study-timeConstant').fill('2')
    await page.getByTestId('pid-study-proportionalGain').fill('1.5')
    await page.getByTestId('pid-study-integralGain').fill('0.5')
    await page.getByTestId('pid-study-setpoint').fill('4')
    await page.getByTestId('pid-study-duration').fill('2')
    await page.getByTestId('pid-study-points').fill('3')
    await page.getByTestId('pid-study-run').click()

    const results = page.getByTestId('pid-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('pid-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(page.getByTestId('pid-study-plot')).toBeVisible()
    await expect(page.getByTestId('pid-study-plot').locator('circle')).toHaveCount(3)
    await expect(page.getByTestId('pid-study-table').locator('tbody tr')).toHaveCount(3)
    await expect(page.getByTestId('pid-study-table').locator('tbody')).toContainText('1.25')

    expect(mock.submissions).toHaveLength(1)
    const spec = mock.submissions[0] as {
      spec: {
        kind: string
        name: string
        model: { source: string; inline: Record<string, unknown> }
        requirements: { backends: string[] }
        run: { maxSteps: number }
      }
    }
    expect(spec.spec).toMatchObject({
      kind: 'waveworld-module',
      name: moduleName,
      model: {
        source: 'inline',
        inline: {
          module: moduleName,
          method: 'state-space',
          backend: 'host',
          A: [[-2, 0.5], [-1, 0]],
          B: [[1.5], [1]],
          C: [[1, 0]],
          D: [[0]],
          x0: [0, 0],
          u: [4],
          times: [0, 1, 2],
        },
      },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })

    const csvPromise = page.waitForEvent('download')
    await page.getByTestId('pid-study-download-csv').click()
    const csv = await csvPromise
    expect(csv.suggestedFilename()).toBe('dymola-pid-study.csv')
    const csvPath = await csv.path()
    expect(csvPath).not.toBeNull()
    const csvText = await readFile(csvPath!, 'utf8')
    expect(csvText).toContain('"time_s","output_dimensionless"')
    expect(csvText).toContain('"1","1.25"')

    const jsonPromise = page.waitForEvent('download')
    await page.getByTestId('pid-study-download-json').click()
    const json = await jsonPromise
    expect(json.suggestedFilename()).toBe('dymola-pid-study.json')
    const jsonPath = await json.path()
    expect(jsonPath).not.toBeNull()
    const report = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
      jobId: string
      input: Record<string, unknown>
      result: { times: number[]; output: number[] }
      scope: { excluded: string }
    }
    expect(report.jobId).toBe(jobId)
    expect(report.input).toEqual((spec.spec.model.inline))
    expect(report.result).toEqual({ backend: 'w-sim-cuda-host', methodId: 'method-openmodelica-state-space', times: [0, 1, 2], output: [0, 1.25, 3.5] })
    expect(report.scope.excluded).toMatch(/not a Dymola exchange or execution report/)

    await page.getByTestId('pid-study-setpoint').fill('5')
    await expect(results).toHaveCount(0)
    await expect(page.getByTestId('pid-study-run')).toBeEnabled()
    expect(mock.submissions).toHaveLength(1)
    await page.getByTestId('pid-study-reset').click()
    await expect(page.getByTestId('pid-study-processGain')).toHaveValue('1')
    await expect(page.getByTestId('pid-study-points')).toHaveValue('51')
  })

  test('rejects invalid field bounds, point counts, and an unsafe derived state-space horizon', async ({ page }) => {
    const mock = await mockHost(page, 'success')
    await openDymola(page)

    for (const [field, value] of [
      ['processGain', '10.1'],
      ['timeConstant', '0'],
      ['proportionalGain', '20.1'],
      ['integralGain', '-0.1'],
      ['setpoint', ''],
      ['points', '2.5'],
    ] as const) {
      await page.getByTestId(`pid-study-${field}`).fill(value)
      await expect(page.getByTestId('pid-study-run')).toBeDisabled()
      expect(mock.submissions).toHaveLength(0)
      await page.getByTestId('pid-study-reset').click()
    }

    await page.getByTestId('pid-study-duration').fill('100')
    await page.getByTestId('pid-study-run').click()
    await expect(page.getByTestId('pid-study-error')).toBeVisible()
    expect(mock.submissions).toHaveLength(0)
  })

  test('requires authentication and does not submit a private draft when signed out', async ({ page }) => {
    const mock = await mockHost(page, 'unauthenticated')
    await openDymola(page)
    await page.getByTestId('pid-study-run').click()
    await expect(page.getByTestId('pid-study-error')).toBeVisible()
    await expect(page.getByTestId('pid-study-results')).toHaveCount(0)
    expect(mock.submissions).toHaveLength(0)
  })

  test('cancels a queued host job without showing results', async ({ page }) => {
    const mock = await mockHost(page, 'queued')
    await openDymola(page)
    await page.getByTestId('pid-study-run').click()
    await expect(page.getByTestId('pid-study-cancel')).toBeVisible()
    await page.getByTestId('pid-study-cancel').click()
    await expect(page.getByTestId('pid-study-cancel')).toHaveCount(0)
    await expect(page.getByTestId('pid-study-results')).toHaveCount(0)
    await expect(page.getByTestId('pid-study-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
  })

  test('drops delayed authentication after reset and ignores late results after an edit', async ({ page }) => {
    const auth = await mockHost(page, 'delayed-auth')
    await openDymola(page)
    await page.getByTestId('pid-study-run').click()
    await expect(page.getByTestId('pid-study-status')).toContainText(/submitting/i)
    await page.getByTestId('pid-study-reset').click()
    auth.releasePending()
    await expect(page.getByTestId('pid-study-status')).toHaveText('idle')
    expect(auth.submissions).toHaveLength(0)

    const late = await mockHost(page, 'delayed-result')
    await page.reload()
    await page.getByTestId('pid-study-run').click()
    await expect(page.getByTestId('pid-study-cancel')).toBeVisible()
    await page.getByTestId('pid-study-setpoint').fill('2')
    late.releasePending()
    await expect(page.getByTestId('pid-study-results')).toHaveCount(0)
    await expect(page.getByTestId('pid-study-status')).toHaveText('idle')
    expect(late.submissions).toHaveLength(1)
  })
})
