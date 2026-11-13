import { expect, test, type Page, type Route } from '@playwright/test'

const frequencyHz = 60

function acResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'mna',
      backend: { id: 'host-f64-mna' },
      result: {
        methodId: 'method-algo-mna-ac',
        familyId: 'method-mna',
        omega: 2 * Math.PI * frequencyHz,
        nodeMagnitudes: [10, 7.5],
        nodePhases: [0, -0.25],
        nodePhasesDeg: [0, -14.32394487827058],
      },
    },
  }
}

async function mockJobs(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: 'pspice-ac-job' } } })
      return
    }
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: acResult() } } })
    }
  })
  return submissions
}

test.describe('RLC guided PSpice AC lifecycle', () => {
  test('runs a structured single-frequency phasor study, exports results and clears stale results on edits', async ({ page }) => {
    const submissions = await mockJobs(page)
    await page.goto('/rlc')

    await expect(page.locator('#pspice-ac-editor')).toBeVisible()
    await page.locator('#pspice-ac-frequency-hz').fill(String(frequencyHz))
    await page.locator('#pspice-ac-node-count').fill('2')
    await page.locator('#pspice-ac-resistor-1-a').selectOption('1')
    await page.locator('#pspice-ac-resistor-1-b').selectOption('2')
    await page.locator('#pspice-ac-resistor-1-ohms').fill('1000')
    await page.locator('#pspice-ac-resistor-2-a').selectOption('2')
    await page.locator('#pspice-ac-resistor-2-b').selectOption('0')
    await page.locator('#pspice-ac-resistor-2-ohms').fill('3000')
    await page.locator('#pspice-ac-source-1-a').selectOption('1')
    await page.locator('#pspice-ac-source-1-b').selectOption('0')
    await page.locator('#pspice-ac-source-1-volts').fill('10')

    await page.locator('#pspice-ac-run').click()
    const results = page.getByTestId('pspice-ac-results')
    await expect(results).toBeVisible()
    await expect(results.getByTestId('pspice-ac-table')).toContainText('N2')
    await expect(results.getByTestId('pspice-ac-table')).toContainText('7.5')
    await expect(results).toContainText('method-algo-mna-ac')
    await expect(results).toContainText('host-f64-mna')

    const csvDownload = page.waitForEvent('download')
    await page.getByTestId('pspice-ac-csv').click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('pspice-ac-results.csv')
    const csvPath = await csv.path()
    expect(csvPath).toBeTruthy()
    const csvText = await import('node:fs/promises').then(({ readFile }) => readFile(csvPath!, 'utf8'))
    expect(csvText).toContain('frequency_hz')
    expect(csvText).toContain('"N2"')
    expect(csvText).toContain('"7.5"')

    const jsonDownload = page.waitForEvent('download')
    await page.getByTestId('pspice-ac-job-json').click()
    const jobJson = await jsonDownload
    expect(jobJson.suggestedFilename()).toMatch(/\.json$/)
    const jsonPath = await jobJson.path()
    expect(jsonPath).toBeTruthy()
    const exportedText = await import('node:fs/promises').then(({ readFile }) => readFile(jsonPath!, 'utf8'))
    const exported = JSON.parse(exportedText) as Record<string, unknown>
    expect(JSON.stringify(exported)).toContain('pspice-ac-job')
    expect(JSON.stringify(exported)).toContain('host-f64-mna')

    expect(submissions).toHaveLength(1)
    expect(JSON.stringify(submissions[0])).toContain('method-algo-mna-ac')
    const submittedModel = submissions[0].model as { inline: { omega: number } }
    expect(submittedModel.inline.omega).toBeCloseTo(2 * Math.PI * frequencyHz)

    await page.locator('#pspice-ac-resistor-1-ohms').fill('2000')
    await expect(results).toHaveCount(0)
    await expect(page.getByTestId('pspice-ac-job-json')).toHaveCount(0)

    await page.locator('#pspice-ac-frequency-hz').fill('0')
    await expect(page.locator('#pspice-ac-run')).toBeDisabled()
    expect(submissions).toHaveLength(1)
  })
})
