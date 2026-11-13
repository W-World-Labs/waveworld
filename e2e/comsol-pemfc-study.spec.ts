import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'pemfc-polarization-study-job'

// This is a settlement fixture for the host boundary, not evidence from a
// running native solver or a comparison with COMSOL.
function settledNativePolarization() {
  const E_nernst = 1.1703765480706372
  const current = [0, 0.5, 1]
  const voltage = [E_nernst, 0.8818029808135259, 0.8]
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-comsol-pemfc',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        T: 353.15,
        pH2: 1,
        pO2: 0.21,
        pH2O: 1,
        E0: 1.229,
        E0T: 1.18225,
        j: 0.5,
        j0: 1e-4,
        alpha: 0.5,
        n: 2,
        R: 0.05,
        jLim: 2,
        thermalVoltage: 0.015217635,
        E_nernst,
        eta_act: 0.25919618067260647,
        eta_ohm: 0.025,
        eta_conc: 0.004377386584504772,
        V: voltage[1],
        powerDensity: 0.5 * voltage[1],
        voltageEfficiency: voltage[1] / E_nernst,
        curve: { current, voltage, power: current.map((density, index) => density * voltage[index]!) },
        units: 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2',
        method: 'polarization',
        ok: true,
        methodId: 'method-algo-pemfc-polarization',
        familyId: 'method-pemfc',
        scopeNote: 'Prescribed-condition algebraic PEMFC polarization study; zero voltage is a model floor.',
      },
    },
  }
}

async function mockAuthenticatedSettlement(page: Page) {
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
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: settledNativePolarization() } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

test.describe('COMSOL guided PEMFC polarization study', () => {
  test('submits a host study, displays native curve and operating point, and exports the saved study', async ({ page }) => {
    const submissions = await mockAuthenticatedSettlement(page)
    await page.goto('/comsol')
    // Three samples make the mocked native curve explicit: 0, 0.5, and 1 A/cm².
    await page.getByTestId('pemfc-points').fill('3')
    await page.getByTestId('pemfc-study-run').click()

    const results = page.getByTestId('pemfc-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('pemfc-study-status')).toContainText(new RegExp(`succeeded · job ${jobId}`, 'i'))
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText(/sampled maximum power/i)
    await expect(results).toContainText(/zero-voltage floor/i)
    await expect(page.getByTestId('pemfc-study-table').locator('tbody tr')).toHaveCount(3)
    await expect(page.getByTestId('pemfc-study-table').locator('tbody')).toContainText('0.881803')
    await expect(page.locator('#pemfc-study-plot')).toBeVisible()
    await expect(page.getByTestId('pemfc-operating-point')).toContainText('0.5')

    expect(submissions).toHaveLength(1)
    const spec = submissions[0] as {
      model: { inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    expect(spec.model.inline).toEqual({
      module: 'sw-comsol-pemfc',
      method: 'polarization',
      backend: 'host',
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
      points: 3,
      n: 2,
      E0: 1.229,
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)

    const csvDownload = page.waitForEvent('download')
    await page.getByTestId('pemfc-download-csv').click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('pemfc-polarization-study.csv')
    const csvPath = await csv.path()
    expect(csvPath).not.toBeNull()
    const csvContents = await readFile(csvPath!, 'utf8')
    expect(csvContents).toContain('"current_density_A_cm2","cell_voltage_V","power_density_W_cm2"')
    expect(csvContents).toContain('"0","1.1703765480706372","0"')
    expect(csvContents).toContain('"1","0.8","0.8"')

    const reportDownload = page.waitForEvent('download')
    await page.getByTestId('pemfc-download-json').click()
    const report = await reportDownload
    expect(report.suggestedFilename()).toBe('pemfc-polarization-study.json')
    const reportPath = await report.path()
    expect(reportPath).not.toBeNull()
    const savedReport = JSON.parse(await readFile(reportPath!, 'utf8')) as {
      schemaVersion: number
      jobId: string
      input: Record<string, unknown>
      result: { backend: { kind: string }; result: { curve: { current: number[] } } }
      boundaries: Record<string, unknown>
    }
    expect(savedReport.schemaVersion).toBe(1)
    expect(savedReport.jobId).toBe(jobId)
    expect(savedReport.input).toEqual(spec.model.inline)
    expect(savedReport.result.backend.kind).toBe('host-f64')
    expect(savedReport.result.result.curve.current).toEqual([0, 0.5, 1])
    expect(JSON.stringify(savedReport.boundaries)).toMatch(/not.*optimized|sampled.*maximum/i)
  })
})
