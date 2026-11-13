import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const jobId = 'ansys-sdof-harmonic-response-e2e'

// Host settlement fixture matching W-Sim 335bbc13,
// crates/w-sim-cuda/src/module/sw_ansys_harmonic_response.rs. Deliberately
// distinctive response values prove the UI/export preserve supplied output,
// rather than solving the submitted inputs again in the browser.
function settledNativeResponse() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-ansys-harmonic-response',
      familyId: 'method-ansys-harmonic-response',
      methodId: 'method-mode-superposition',
      method: 'mode-superposition',
      system: 'sdof',
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      freqUnit: 'hz', nDof: 1, nModes: 1, excitation: 'force', dofs: [0], nPoints: 3, modes: null,
      sdof: {
        mass: 1, stiffness: 100, dampingCoefficient: 1, dampingRatio: 0.05,
        naturalFrequencyHz: 1.5915494309189535, naturalFrequencyRads: 10, staticResponse: 0.01,
      },
      sweep: [
        { freqHz: 0, freqRads: 0, response: [{ re: 0.000125, im: 0 }], amplitude: [0.000125], phaseDeg: [0] },
        { freqHz: 7.5, freqRads: 47.12388980384689, response: [{ re: 0.000042, im: -0.000019 }], amplitude: [0.000046098], phaseDeg: [-24.3] },
        { freqHz: 15, freqRads: 94.24777960769379, response: [{ re: -0.000011, im: -0.000073 }], amplitude: [0.000073824], phaseDeg: [-98.6] },
      ],
      peak: { frequencyHz: [0], amplitude: [0.000125] },
      ok: true,
    },
  }
}

async function mockNativeSettlement(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  const capturedResult = settledNativeResponse()
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
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: capturedResult } } })
      return
    }
    await route.fallback()
  })
  return { submissions, capturedResult }
}

test.describe('Ansys guided SDOF harmonic response', () => {
  test('validates guided controls and submits the host SDOF contract', async ({ page }) => {
    const { submissions } = await mockNativeSettlement(page)
    await page.goto('/ansys')
    await page.getByTestId('ansys-harmonic-tab').click()

    const mass = page.getByTestId('ansys-harmonic-mass')
    const stiffness = page.getByTestId('ansys-harmonic-stiffness')
    const damping = page.getByTestId('ansys-harmonic-damping-value')
    const force = page.getByTestId('ansys-harmonic-force')
    const startFrequency = page.getByTestId('ansys-harmonic-startFrequency')
    const endFrequency = page.getByTestId('ansys-harmonic-endFrequency')
    const points = page.getByTestId('ansys-harmonic-points')
    const run = page.getByTestId('ansys-harmonic-submit')

    await expect(mass).toHaveValue('1')
    await expect(stiffness).toHaveValue('1000')
    await expect(damping).toHaveValue('0.05')
    await expect(force).toHaveValue('1')
    await expect(startFrequency).toHaveValue('0')
    await expect(endFrequency).toHaveValue('15')
    await expect(points).toHaveValue('4')
    await expect(run).toBeEnabled()

    await mass.fill('0')
    await expect(run).toBeDisabled()
    await expect(page.getByTestId('ansys-harmonic-validation')).toContainText(/mass must be finite and in \[5e-324, 1000000000000\]/i)
    await mass.fill('1')

    await stiffness.fill('-1')
    await expect(run).toBeDisabled()
    await stiffness.fill('0')
    await expect(run).toBeDisabled()
    await stiffness.fill('100')

    await damping.fill('-0.01')
    await expect(run).toBeDisabled()
    await damping.fill('0')
    await expect(run).toBeEnabled()
    await damping.fill('0.05')

    await force.fill('')
    await expect(run).toBeDisabled()
    await force.fill('1')

    await startFrequency.fill('-1')
    await expect(run).toBeDisabled()
    await startFrequency.fill('0')
    await endFrequency.fill('')
    await expect(run).toBeDisabled()
    await endFrequency.fill('15')
    await endFrequency.fill('-1')
    await expect(run).toBeDisabled()
    await endFrequency.fill('15')
    await points.fill('0')
    await expect(run).toBeDisabled()
    await points.fill('202')
    await expect(run).toBeDisabled()
    await points.fill('1')
    await expect(run).toBeDisabled()
    await points.fill('2')
    await expect(run).toBeEnabled()
    await points.fill('3')
    await run.click()

    await expect(page.getByTestId('ansys-harmonic-result')).toBeVisible()
    expect(submissions).toHaveLength(1)
    const spec = submissions[0] as {
      model: { inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    expect(spec.model.inline).toEqual({
      module: 'sw-ansys-harmonic-response',
      system: 'sdof',
      backend: 'host',
      mass: 1,
      stiffness: 100,
      dampingRatio: 0.05,
      force: 1,
      freqs: [0, 7.5, 15],
      freqUnit: 'hz',
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)
  })

  test('presents and exports the captured native response without recomputing it', async ({ page }) => {
    const { submissions, capturedResult } = await mockNativeSettlement(page)
    await page.goto('/ansys')
    await page.getByTestId('ansys-harmonic-tab').click()
    await page.getByTestId('ansys-harmonic-stiffness').fill('100')
    await page.getByTestId('ansys-harmonic-endFrequency').fill('15')
    await page.getByTestId('ansys-harmonic-points').fill('3')
    await page.getByTestId('ansys-harmonic-submit').click()

    const results = page.getByTestId('ansys-harmonic-result')
    await expect(results).toBeVisible()
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('0.000046098')
    await expect(results).toContainText('0.000073824')
    await expect(results).toContainText('-0.000073')
    await expect(results).toContainText('-98.6')
    await expect(results.getByRole('heading', { name: 'Sweep peaks' })).toBeVisible()
    await expect(results.getByRole('listitem')).toHaveText('DOF 0: 0.000125 at 0 Hz')
    await expect(results).toContainText('15')
    await expect(results).toContainText('0.000073824')
    expect(submissions).toHaveLength(1)

    const downloadEvent = page.waitForEvent('download')
    await page.getByTestId('ansys-harmonic-download-json').click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toMatch(/^ansys-harmonic-response\.json$/i)
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    const report = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
      jobId: string
      submittedInput: Record<string, unknown>
      result: unknown
    }
    expect(report.jobId).toBe(jobId)
    expect(report.submittedInput).toEqual((submissions[0] as { model: { inline: unknown } }).model.inline)
    expect(report.result).toEqual(capturedResult.moduleResult)
  })
})
