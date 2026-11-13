import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'exchanger-ua-study-job'

function nativeSweepResult() {
  const common = {
    model: 'steady-effectiveness-NTU',
    arrangement: 'counterflow',
    Chot: 100,
    Ccold: 100,
    Cmin: 100,
    Cmax: 100,
    Cr: 1,
    T_hot_in: 363.15,
    T_cold_in: 293.15,
    energyBalance: 'hotLoss == coldGain == Q',
    methodId: 'method-algo-sw-openmodelica-heat-exchanger',
    familyId: 'method-sw-openmodelica-heat-exchanger',
  }
  const rows = [
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
      // The native module reports its backend as a string.
      backend: 'w-sim-cuda-host',
      result: {
        model: 'steady-effectiveness-NTU-UA-parameter-sweep',
        parameter: 'UA',
        cases: rows.map(row => ({ ...common, ...row, hotLoss: row.Q, coldGain: row.Q })),
        methodId: 'method-algo-sw-openmodelica-heat-exchanger',
        familyId: 'method-sw-openmodelica-heat-exchanger',
      },
    },
  }
}

async function mockAuthenticatedHost(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec?: Record<string, unknown> }
      submissions.push(body.spec ?? body)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeSweepResult() } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

test.describe('Dymola guided exchanger UA study', () => {
  test('dispatches the default steady host sweep, renders native results, and downloads CSV and JSON', async ({ page }) => {
    const submissions = await mockAuthenticatedHost(page)
    await page.goto('/dymola')

    await page.getByTestId('exchanger-study-run').click()

    const results = page.getByTestId('exchanger-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('exchanger-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(page.getByTestId('exchanger-study-table').locator('tbody tr')).toHaveCount(3)
    await expect(page.getByTestId('exchanger-study-table').locator('tbody')).toContainText('3,500')
    await expect(page.getByTestId('exchanger-study-plot')).toBeVisible()
    await expect(page.getByTestId('exchanger-study-plot').locator('circle, polyline, path').first()).toBeVisible()

    const selector = page.getByTestId('exchanger-metric')
    await selector.selectOption('effectiveness')
    await expect(page.getByTestId('exchanger-study-plot')).toBeVisible()

    expect(submissions).toHaveLength(1)
    const spec = submissions[0] as {
      model: { inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    expect(spec.model.inline).toEqual({
      module: 'sw-openmodelica-heat-exchanger',
      backend: 'host',
      dynamic: false,
      arrangement: 'counterflow',
      Chot: 100,
      Ccold: 100,
      T_hot_in: 363.15,
      T_cold_in: 293.15,
      sweep_UA: [100, 200, 300],
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)

    const csvDownload = page.waitForEvent('download')
    await page.getByTestId('exchanger-download-csv').click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('exchanger-ua-study.csv')
    const csvPath = await csv.path()
    expect(csvPath).not.toBeNull()
    const csvContents = await readFile(csvPath!, 'utf8')
    expect(csvContents).toContain('"model","arrangement","Chot_W_per_K","Ccold_W_per_K","UA_W_per_K"')
    expect(csvContents).toContain('"steady-effectiveness-NTU","counterflow","100","100","100"')
    expect(csvContents).toContain('"hotLoss == coldGain == Q"')

    const reportDownload = page.waitForEvent('download')
    await page.getByTestId('exchanger-download-json').click()
    const report = await reportDownload
    expect(report.suggestedFilename()).toBe('exchanger-ua-study.json')
    const reportPath = await report.path()
    expect(reportPath).not.toBeNull()
    const reportContents = await readFile(reportPath!, 'utf8')
    const savedReport = JSON.parse(reportContents) as {
      schemaVersion: number
      jobId: string
      input: Record<string, unknown>
      result: { backend: string; cases: Array<{ UA: number; Q: number }> }
      draft: { arrangement: string; range: { points: number } }
      scope: { excluded: string }
    }
    expect(savedReport.schemaVersion).toBe(1)
    expect(savedReport.jobId).toBe(jobId)
    expect(savedReport.input).toEqual(spec.model.inline)
    expect(savedReport.result.backend).toBe('w-sim-cuda-host')
    expect(savedReport.result.cases.map(row => row.UA)).toEqual([100, 200, 300])
    expect(savedReport.result.cases.map(row => row.Q)).toEqual([3500, 14000 / 3, 5250])
    expect(savedReport.draft).toMatchObject({ arrangement: 'counterflow', range: { points: 3 } })
    expect(savedReport.scope.excluded).toMatch(/not a Dymola interchange format/)
  })
})
