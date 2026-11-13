import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'comsol-joule-heating-study-job'

// Host settlement fixture only. It exercises the native-result transport and
// UI contract; it is not output from a running native solver.
function settledJouleHeating() {
  const voltageDrop = 0.008651008070168416
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-comsol-joule-heating-b',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        mode: 'joule',
        drive: 'current',
        current: 10,
        voltageDrop,
        currentDensity: 1e7,
        eFieldMean: voltageDrop / 0.05,
        resistance: 0.0008651008070168416,
        resistanceNominal: 0.0008620689655172414,
        resistanceRatio: 1.0035169361395362,
        power: 10 * voltageDrop,
        powerFromGeneration: 0.08651008070168417,
        powerResidual: 0,
        qDotMax: 1733100,
        qDotMean: 1730201.6140336835,
        sigma0: 5.8e7,
        sigmaMean: 57904785.385,
        alpha: 0.0039,
        tRef: 293.15,
        thermalConductivity: 400,
        length: 0.05,
        area: 1e-6,
        T0: 293.15,
        TL: 293.15,
        Tmax: 294.5029047390168,
        TmaxX: 0.025,
        selfHeating: true,
        beta: 4.100042051929004,
        generationPerArea: 86510.08070168417,
        conductionPerArea: 86510.08070168417,
        energyBalanceResidual: 0,
        profile: {
          x: [0, 0.025, 0.05],
          T: [293.15, 294.5029047390168, 293.15],
          V: [0, -0.004325504035084208, -voltageDrop],
          sigma: [58000000, 57700000, 58000000],
          E: [172.4, 172.9, 172.4],
          qDot: [1724137.9310344828, 1733100, 1724137.9310344828],
        },
        ok: true,
        methodId: 'method-algo-comsol-joule-heating-1d-coupled',
        familyId: 'method-comsol-joule-heating',
      },
    },
  }
}

type Mode = 'success' | 'queued'

async function mockAuthenticatedSettlement(page: Page, mode: Mode = 'success') {
  const submissions: Array<Record<string, unknown>> = []
  const cancellations: string[] = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec?: Record<string, unknown> }
      submissions.push(body.spec ?? body as unknown as Record<string, unknown>)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      cancellations.push(path)
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      const job = mode === 'queued'
        ? { id: jobId, status: 'queued' }
        : { id: jobId, status: 'succeeded', result: settledJouleHeating() }
      await route.fulfill({ status: 200, json: { job } })
      return
    }
    await route.fallback()
  })
  return { submissions, cancellations }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

test.describe('COMSOL Joule heating study', () => {
  test('submits an authenticated native study, displays x/T/V and energy balance, and exports provenance', async ({ page }) => {
    const mock = await mockAuthenticatedSettlement(page)
    await page.goto('/comsol')

    const study = page.getByTestId('comsol-joule-study')
    await expect(study).toBeVisible()
    await page.getByTestId('comsol-joule-current').fill('10')
    await page.getByTestId('comsol-joule-samples').fill('3')
    await page.getByTestId('comsol-joule-run').click()

    const results = page.getByTestId('comsol-joule-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('comsol-joule-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('host-f64')
    await expect(results).toContainText('method-algo-comsol-joule-heating-1d-coupled')

    const profile = page.getByTestId('comsol-joule-profile')
    await expect(profile).toBeVisible()
    await expect(profile.locator('tbody tr')).toHaveCount(3)
    await expect(profile.locator('tbody')).toContainText(/0\.025.*294\.5029.*-0\.0043255/s)
    await expect(profile.locator('tbody')).toContainText(/0\.05.*293\.15.*-0\.0086510/s)
    const balance = page.getByTestId('comsol-joule-balance')
    await expect(balance).toBeVisible()
    await expect(balance).toContainText(/generation/i)
    await expect(balance).toContainText(/conduction/i)
    await expect(balance).toContainText(/energy balance residual/i)

    expect(mock.submissions).toHaveLength(1)
    const spec = mock.submissions[0] as {
      kind: string
      parameters: { module: string }
      model: { source: string; inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    expect(spec).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-comsol-joule-heating-b' },
      model: {
        source: 'inline',
        inline: {
          module: 'sw-comsol-joule-heating-b',
          mode: 'joule',
          methodId: 'method-algo-comsol-joule-heating-1d-coupled',
          backend: 'host',
          current: 10,
          sigma0: 5.8e7,
          alpha: 0.0039,
          T_ref: 293.15,
          k: 400,
          L: 0.05,
          area: 1e-6,
          T_0: 293.15,
          T_L: 293.15,
          N: 3,
        },
      },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })

    const csvDownloadEvent = page.waitForEvent('download')
    await page.getByTestId('comsol-joule-download-csv').click()
    const csvDownload = await csvDownloadEvent
    expect(csvDownload.suggestedFilename()).toBe('comsol-joule-heating-results.csv')
    const csvPath = await csvDownload.path()
    expect(csvPath).not.toBeNull()
    const csv = await readFile(csvPath!, 'utf8')
    expect(csv).toContain('x')
    expect(csv).toContain('T')
    expect(csv).toContain('V')
    expect(csv).toContain('0.025')
    expect(csv).toContain('294.5029047390168')

    const jsonDownloadEvent = page.waitForEvent('download')
    await page.getByTestId('comsol-joule-download-json').click()
    const jsonDownload = await jsonDownloadEvent
    expect(jsonDownload.suggestedFilename()).toBe('comsol-joule-heating-results.json')
    const jsonPath = await jsonDownload.path()
    expect(jsonPath).not.toBeNull()
    const snapshot = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
      schemaVersion: number
      jobId: string
      input: Record<string, unknown>
      result: { module: string; backend: { id: string; kind: string }; result: { profile: { x: number[]; T: number[]; V: number[]; sigma: number[]; E: number[]; qDot: number[] }; energyBalanceResidual: number; methodId: string } }
      provenance: Record<string, unknown>
    }
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.jobId).toBe(jobId)
    expect(snapshot.input).toEqual(spec.model.inline)
    expect(snapshot.result.module).toBe('sw-comsol-joule-heating-b')
    expect(snapshot.result.backend).toEqual({ id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' })
    expect(snapshot.result.result.profile).toEqual({
      x: [0, 0.025, 0.05],
      T: [293.15, 294.5029047390168, 293.15],
      V: [0, -0.004325504035084208, -0.008651008070168416],
      sigma: [58000000, 57700000, 58000000],
      E: [172.4, 172.9, 172.4],
      qDot: [1724137.9310344828, 1733100, 1724137.9310344828],
    })
    expect(snapshot.result.result.energyBalanceResidual).toBe(0)
    expect(snapshot.result.result.methodId).toBe('method-algo-comsol-joule-heating-1d-coupled')
    expect(JSON.stringify(snapshot.provenance)).toMatch(/sw-comsol-joule-heating-b|w-sim-cuda-host|host-f64|method-algo-comsol-joule-heating-1d-coupled/)
  })

  test('cancels a queued native job without exposing a result', async ({ page }) => {
    const mock = await mockAuthenticatedSettlement(page, 'queued')
    await page.goto('/comsol')
    await page.getByTestId('comsol-joule-run').click()
    await expect(page.getByTestId('comsol-joule-cancel')).toBeVisible()
    await page.getByTestId('comsol-joule-cancel').click()
    await expect(page.getByTestId('comsol-joule-cancel')).toHaveCount(0)
    await expect(page.getByTestId('comsol-joule-results')).toHaveCount(0)
    await expect(page.getByTestId('comsol-joule-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
    expect(mock.submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'sw-comsol-joule-heating-b' },
      model: { inline: { module: 'sw-comsol-joule-heating-b', mode: 'joule', backend: 'host' } },
    })
  })
})
