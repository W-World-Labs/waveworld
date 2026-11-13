import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'pemfc-results-job'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const input = {
  module: 'sw-comsol-pemfc',
  method: 'polarization',
  backend: 'host',
  n: 2,
  E0: 1.229,
  T: 353.15,
  pH2: 1,
  pO2: 0.21,
  pH2O: 1,
  j0: 1e-4,
  alpha: 0.5,
  R: 0.05,
  jLim: 2,
  j: 0.5,
  imax: 1,
  points: 5,
}

function mockPolarizationResult() {
  const current = [0, 0.25, 0.5, 0.75, 1]
  const voltage = [1.2, 0.9, 0.5, 0, 0]
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      ok: true,
      module: 'sw-comsol-pemfc',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        ...input,
        E0T: 1.21,
        thermalVoltage: 0.0304,
        E_nernst: 1.2,
        eta_act: 0.1,
        eta_ohm: 0.2,
        eta_conc: 0.4,
        V: 0.5,
        powerDensity: 0.25,
        voltageEfficiency: 0.5 / 1.2,
        curve: { current, voltage, power: current.map((density, index) => density * voltage[index]!) },
        units: 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2',
        method: 'polarization',
        ok: true,
        methodId: 'method-algo-pemfc-polarization',
        familyId: 'method-pemfc',
        scopeNote: 'Mock native polarization samples for the bounded PEMFC model.',
      },
    },
  }
}

async function mockHostJob(page: Page) {
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
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: mockPolarizationResult() } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.describe('PEMFC polarization result disclosures', () => {
  test('renders mocked model-floor samples and preserves them in CSV and JSON exports', async ({ page }) => {
    const submissions = await mockHostJob(page)
    await page.goto('/comsol')
    await page.getByTestId('pemfc-points').fill('5')
    await page.getByTestId('pemfc-study-run').click()

    const results = page.getByTestId('pemfc-study-results')
    await expect(results).toBeVisible()
    await expect(results.getByTestId('pemfc-operating-point')).toContainText('0.50000 V')
    await expect(results.getByTestId('pemfc-sampled-max')).toContainText(/not an optimizer result/i)
    await expect(results.getByText('Samples at the model’s zero-voltage floor: 2.')).toBeVisible()

    const plot = results.locator('#pemfc-study-plot')
    await expect(plot).toBeVisible()
    await expect(plot.locator('polyline')).toBeVisible()
    await results.getByTestId('pemfc-metric').selectOption('power')
    await expect(plot.getByRole('img', { name: /power density by current density/i })).toBeVisible()

    const table = results.getByTestId('pemfc-study-table')
    await expect(table.locator('tbody tr')).toHaveCount(5)
    await expect(table.locator('tbody')).toContainText('model voltage floor')
    await expect(table.locator('tbody tr').filter({ hasText: 'model voltage floor' })).toHaveCount(2)
    await expect(results).toContainText('The native model floors cell voltage at 0 V')
    await expect(results).toContainText('not system or fuel efficiency')

    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-comsol-pemfc' },
      model: { source: 'inline', inline: { ...input } },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })

    const csvPromise = page.waitForEvent('download')
    await results.getByTestId('pemfc-download-csv').click()
    const csv = await csvPromise
    expect(csv.suggestedFilename()).toBe('pemfc-polarization-study.csv')
    const csvContents = await readFile((await csv.path())!, 'utf8')
    expect(csvContents).toContain('"current_density_A_cm2","cell_voltage_V","power_density_W_cm2"')
    expect(csvContents).toContain('"0.75","0","0"')
    expect(csvContents).toContain('"1","0","0"')

    const jsonPromise = page.waitForEvent('download')
    await results.getByTestId('pemfc-download-json').click()
    const report = await jsonPromise
    expect(report.suggestedFilename()).toBe('pemfc-polarization-study.json')
    const reportContents = await readFile((await report.path())!, 'utf8')
    const savedReport = JSON.parse(reportContents) as {
      jobId: string
      result: { result: { curve: { voltage: number[] } } }
      sampledMaximumPower: { interpretation: string }
      boundaries: { voltageFloor: string; efficiency: string; export: string }
    }
    expect(savedReport.jobId).toBe(jobId)
    expect(savedReport.result.result.curve.voltage).toEqual([1.2, 0.9, 0.5, 0, 0])
    expect(savedReport.sampledMaximumPower.interpretation).toMatch(/not optimized or a continuous maximum/i)
    expect(savedReport.boundaries.voltageFloor).toMatch(/Zero-voltage samples are retained and indicate the model floor/i)
    expect(savedReport.boundaries.efficiency).toMatch(/not system or fuel efficiency/i)
    expect(savedReport.boundaries.export).toMatch(/not a \.mph file or COMSOL interchange format/i)
  })
})
