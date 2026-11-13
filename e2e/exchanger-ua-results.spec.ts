import { expect, test, type Page, type Route } from '@playwright/test'

const jobId = 'exchanger-ua-study-job'
const sweepUa = [100, 200, 300]

type Conditions = { arrangement: 'counterflow' | 'parallel'; Chot: number; Ccold: number; T_hot_in: number; T_cold_in: number }

function caseFor(conditions: Conditions, UA: number) {
  const Cmin = Math.min(conditions.Chot, conditions.Ccold)
  const Cmax = Math.max(conditions.Chot, conditions.Ccold)
  const Cr = Cmin / Cmax
  const NTU = UA / Cmin
  const effectiveness = Cr === 1 ? NTU / (1 + NTU) : NTU / (1 + NTU)
  const Q = effectiveness * Cmin * (conditions.T_hot_in - conditions.T_cold_in)
  const T_hot_out = conditions.T_hot_in - Q / conditions.Chot
  const T_cold_out = conditions.T_cold_in + Q / conditions.Ccold
  return {
    model: 'steady-effectiveness-NTU',
    arrangement: conditions.arrangement,
    Chot: conditions.Chot,
    Ccold: conditions.Ccold,
    UA,
    Cmin,
    Cmax,
    Cr,
    NTU,
    effectiveness,
    T_hot_in: conditions.T_hot_in,
    T_cold_in: conditions.T_cold_in,
    Q,
    T_hot_out,
    T_cold_out,
    hotLoss: conditions.Chot * (conditions.T_hot_in - T_hot_out),
    coldGain: conditions.Ccold * (T_cold_out - conditions.T_cold_in),
    energyBalance: 'hotLoss == coldGain == Q',
    methodId: 'method-algo-sw-openmodelica-heat-exchanger',
    familyId: 'method-sw-openmodelica-heat-exchanger',
  }
}

function exchangerResult(conditions: Conditions) {
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
        cases: sweepUa.map(UA => caseFor(conditions, UA)),
        methodId: 'method-algo-sw-openmodelica-heat-exchanger',
        familyId: 'method-sw-openmodelica-heat-exchanger',
      },
    },
  }
}

type Malformation = 'count' | 'order' | 'backend' | 'nan'

function malformedResult(conditions: Conditions, malformed: Malformation) {
  const result = exchangerResult(conditions)
  const native = result.moduleResult as unknown as { backend: string; result: { cases: Array<Record<string, unknown>> } }
  if (malformed === 'count') native.result.cases.pop()
  if (malformed === 'order') [native.result.cases[0], native.result.cases[1]] = [native.result.cases[1]!, native.result.cases[0]!]
  if (malformed === 'backend') native.backend = 'unexpected-backend'
  if (malformed === 'nan') native.result.cases[1]!.Q = Number.NaN
  return result
}

async function mockJobs(page: Page, malformed?: Malformation) {
  const submissions: Array<Record<string, unknown>> = []
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
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      const inline = submissions[0]?.model && (submissions[0].model as { inline?: Record<string, unknown> }).inline
      const conditions = (inline ?? {}) as Conditions
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: malformed ? malformedResult(conditions, malformed) : exchangerResult(conditions) } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

test.describe('Dymola bounded exchanger UA study results', () => {
  test('shows native counterflow crossover results and exports the captured study', async ({ page }) => {
    const submissions = await mockJobs(page)
    await page.goto('/dymola')
    await page.getByTestId('exchanger-study-run').click()

    const results = page.getByTestId('exchanger-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('exchanger-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results.getByTestId('exchanger-study-plot').locator('circle')).toHaveCount(3)
    await expect(results.getByTestId('exchanger-study-table').locator('tbody tr')).toHaveCount(3)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('345.65')
    await expect(results).toContainText('310.65')

    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-openmodelica-heat-exchanger' },
      model: { source: 'inline', inline: { module: 'sw-openmodelica-heat-exchanger', backend: 'host', dynamic: false, arrangement: 'counterflow', sweep_UA: sweepUa } },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })

    const csvPromise = page.waitForEvent('download')
    await results.getByTestId('exchanger-download-csv').click()
    expect((await csvPromise).suggestedFilename()).toBe('exchanger-ua-study.csv')
    const jsonPromise = page.waitForEvent('download')
    await results.getByTestId('exchanger-download-json').click()
    expect((await jsonPromise).suggestedFilename()).toBe('exchanger-ua-study.json')
  })

  test('accepts equal inlet temperatures and displays the valid zero-heat flat curve', async ({ page }) => {
    await mockJobs(page)
    await page.goto('/dymola')
    await page.getByTestId('exchanger-hot-inlet').fill('293.15')
    await page.getByTestId('exchanger-study-run').click()

    const results = page.getByTestId('exchanger-study-results')
    await expect(results).toBeVisible()
    await expect(results.getByTestId('exchanger-study-table').locator('tbody tr')).toHaveCount(3)
    await expect(results.getByTestId('exchanger-study-table')).toContainText('0')
  })

  for (const malformed of ['count', 'order', 'backend', 'nan'] as const) {
    test(`fails closed for malformed native ${malformed} payloads`, async ({ page }) => {
      await mockJobs(page, malformed)
      await page.goto('/dymola')
      await page.getByTestId('exchanger-study-run').click()

      await expect(page.getByTestId('exchanger-study-error')).toBeVisible()
      await expect(page.getByTestId('exchanger-study-results')).toHaveCount(0)
      await expect(page.getByTestId('exchanger-download-csv')).toHaveCount(0)
      await expect(page.getByTestId('exchanger-download-json')).toHaveCount(0)
    })
  }
})
