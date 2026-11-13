import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const jobId = 'ansys-modal-study-e2e'

// Distinctive captured native values make the UI and export checks prove that
// the completed Host result is presented without a local re-solve.
function settledNativeResponse() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-ansys-modal',
      familyId: 'method-ansys-modal-analysis',
      methodId: 'method-block-lanczos',
      method: 'block-lanczos',
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      n: 2,
      numModes: 2,
      solver: { algorithm: 'block-lanczos', converged: true, residual: 0, tolerance: 1e-10 },
      eigenvalues: [100, 400],
      frequenciesHz: [1.5915494309189535, 3.183098861837907],
      frequenciesRadS: [10, 20],
      periodsS: [0.6283185307179586, 0.3141592653589793],
      modeShapes: [[1, 0], [0, 1]],
      modalMass: [1, 1],
      participationFactors: [1, 0],
      effectiveMass: [1, 0],
      effectiveMassRatio: [1, 1],
      massNormalized: true,
      system: { type: 'explicit', n: 2 },
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

test.describe('Ansys guided modal study', () => {
  test('submits the explicit 2x2 Host contract and presents captured native results', async ({ page }) => {
    const { submissions, capturedResult } = await mockNativeSettlement(page)
    await page.goto('/ansys')
    await page.getByTestId('ansys-modal-tab').click()

    await expect(page.getByTestId('ansys-modal-k11')).toHaveValue('1000')
    await expect(page.getByTestId('ansys-modal-k12')).toHaveValue('0')
    await expect(page.getByTestId('ansys-modal-k22')).toHaveValue('1000')
    await expect(page.getByTestId('ansys-modal-m11')).toHaveValue('1')
    await expect(page.getByTestId('ansys-modal-m12')).toHaveValue('0')
    await expect(page.getByTestId('ansys-modal-m22')).toHaveValue('1')
    await expect(page.getByTestId('ansys-modal-study-run')).toBeEnabled()

    await page.getByTestId('ansys-modal-k11').fill('100')
    await page.getByTestId('ansys-modal-k12').fill('0')
    await page.getByTestId('ansys-modal-k22').fill('400')
    await page.getByTestId('ansys-modal-study-run').click()

    const results = page.getByTestId('ansys-modal-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('ansys-modal-study-status')).toContainText(jobId)
    await expect(results).toContainText('host-f64 · cpu · w-sim-cuda-host')
    await expect(results).toContainText('method-block-lanczos · sw-ansys-modal')
    await expect(results).toContainText('1.591549')
    await expect(results).toContainText('3.183099')
    await expect(results).toContainText('0.6283185')
    await expect(results).toContainText('0.3141593')
    await expect(results).toContainText('100')
    await expect(results).toContainText('400')
    await expect(results).toContainText('1')
    await expect(page.getByRole('img', { name: 'Returned modal frequencies' })).toBeVisible()
    const table = page.getByRole('table', { name: 'ANSYS modal study returned results' })
    await expect(table).toBeVisible()
    await expect(table).toContainText('Mode shape DOF 1')
    await expect(table).toContainText('Mode shape DOF 2')
    await expect(table.locator('tbody')).toContainText('1.591549')
    await expect(table.locator('tbody')).toContainText('3.183099')
    await expect(table.locator('tbody')).toContainText('0.6283185')
    await expect(table.locator('tbody')).toContainText('0.3141593')
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).locator('td').nth(7)).toHaveText('1')
    await expect(rows.nth(0).locator('td').nth(8)).toHaveText('0')
    await expect(rows.nth(1).locator('td').nth(7)).toHaveText('0')
    await expect(rows.nth(1).locator('td').nth(8)).toHaveText('1')

    expect(submissions).toHaveLength(1)
    const spec = submissions[0] as {
      model: { inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    expect(spec.model.inline).toEqual({
      module: 'sw-ansys-modal',
      backend: 'host',
      method: 'block-lanczos',
      stiffness: [[100, 0], [0, 400]],
      mass: [[1, 0], [0, 1]],
      direction: [1, 0],
      numModes: 2,
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)
    await expect(results).toContainText('host-f64')

    const csvEvent = page.waitForEvent('download')
    await page.getByTestId('ansys-modal-study-download-csv').click()
    const csvDownload = await csvEvent
    expect(csvDownload.suggestedFilename()).toBe('ansys-modal-study.csv')
    const csvPath = await csvDownload.path()
    expect(csvPath).not.toBeNull()
    const csv = await readFile(csvPath!, 'utf8')
    expect(csv).toContain('"eigenvalue","frequency_Hz","angular_frequency_rad_s","period_s"')
    expect(csv).toContain('"100","1.5915494309189535","10","0.6283185307179586"')
    expect(csv).toContain('"400","3.183098861837907","20","0.3141592653589793"')

    const jsonEvent = page.waitForEvent('download')
    await page.getByTestId('ansys-modal-study-download-json').click()
    const jsonDownload = await jsonEvent
    expect(jsonDownload.suggestedFilename()).toBe('ansys-modal-study.json')
    const jsonPath = await jsonDownload.path()
    expect(jsonPath).not.toBeNull()
    const report = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
      schemaVersion: number
      jobId: string
      modulePin: string
      input: Record<string, unknown>
      result: Record<string, unknown>
      scopeDisclaimer: string
    }
    expect(report.schemaVersion).toBe(1)
    expect(report.jobId).toBe(jobId)
    expect(report.modulePin).toMatch(/^[a-f0-9]{40}$/)
    expect(report.input).toEqual(spec.model.inline)
    expect(report.result).toMatchObject(capturedResult.moduleResult)
    expect(report.result).toMatchObject({ backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' } })
    expect(report.scopeDisclaimer).toContain('does not represent an ANSYS Mechanical project')
  })

  test('fails closed for a non-positive-definite stiffness matrix', async ({ page }) => {
    const { submissions } = await mockNativeSettlement(page)
    await page.goto('/ansys')
    await page.getByTestId('ansys-modal-tab').click()

    await page.getByTestId('ansys-modal-k11').fill('1')
    await page.getByTestId('ansys-modal-k12').fill('2')
    await page.getByTestId('ansys-modal-k22').fill('1')

    await expect(page.getByTestId('ansys-modal-validation')).toContainText(/stiffness matrix must be positive definite/i)
    await expect(page.getByTestId('ansys-modal-study-run')).toBeDisabled()
    expect(submissions).toHaveLength(0)
  })
})
