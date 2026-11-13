import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'abaqus-material-point-e2e'

const materialCard = `*MATERIAL, NAME=STEEL
*ELASTIC
210000, 0.3
*PLASTIC
250, 0
320, .02`

const strainIncrements = '[[0.002, 0, 0, 0, 0, 0]]'

function materialPointResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-calculix-plasticity',
      backend: { id: 'host-f64-sw-calculix-plasticity', deviceName: 'w-sim-cuda-host', precision: 'float64' },
      material: { E: 210000, nu: 0.3, yieldStress: 250, hardening: [[0, 250], [0.02, 320]] },
      history: [{
        step: 0,
        totalStrain: [0.002, 0, 0, 0, 0, 0],
        stress: [282.6923076923, 121.1538461538, 121.1538461538, 0, 0, 0],
        plasticStrain: [0, 0, 0, 0, 0, 0],
        equivalentPlasticStrain: 0,
        vonMises: 161.5384615385,
        yielded: false,
        plasticMultiplier: 0,
        plasticDissipationIncrement: 0,
        plasticDissipation: 0,
      }],
      summary: {
        steps: 1,
        yieldedSteps: 0,
        finalStress: [282.6923076923, 121.1538461538, 121.1538461538, 0, 0, 0],
        finalPlasticStrain: [0, 0, 0, 0, 0, 0],
        finalEquivalentPlasticStrain: 0,
        finalVonMises: 161.5384615385,
        finalPlasticDissipation: 0,
      },
    },
  }
}

async function mockHostJobs(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      submissions.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: materialPointResult() } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.describe('Abaqus standalone material-point card', () => {
  test('submits the supported elastic-plastic card and presents scoped host results', async ({ page }) => {
    const submissions = await mockHostJobs(page)
    await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
    await page.goto('/abaqus')

    const section = page.getByTestId('abaqus-material-point')
    await expect(section).toBeVisible()
    await section.getByTestId('abaqus-material-point-card').fill(materialCard)
    await section.getByTestId('abaqus-material-point-strains').fill(strainIncrements)
    await section.getByTestId('abaqus-material-point-run').click()

    const results = section.getByTestId('abaqus-material-point-results')
    await expect(results).toBeVisible()
    await expect(results).toContainText(/material.point|material point/i)
    await expect(results).toContainText(/does not model a structural mesh/i)
    await expect(results).toContainText(/282\.692|161\.538/)
    expect(submissions).toHaveLength(1)

    const downloadEvent = page.waitForEvent('download')
    await section.getByTestId('abaqus-material-point-results-download-json').click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toMatch(/material.point.*\.json$/i)
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    const report = JSON.parse(await readFile(downloadPath!, 'utf8')) as { jobId: string; result: Record<string, unknown> }
    expect(report.jobId).toBe(jobId)
    expect(report.result).toMatchObject({ module: 'sw-calculix-plasticity' })
  })

  test('rejects an out-of-scope material keyword without submitting a Host job', async ({ page }) => {
    const submissions = await mockHostJobs(page)
    await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
    await page.goto('/abaqus')

    const section = page.getByTestId('abaqus-material-point')
    await expect(section).toBeVisible()
    await section.getByTestId('abaqus-material-point-card').fill(`${materialCard}\n*DENSITY\n7800`)
    await section.getByTestId('abaqus-material-point-strains').fill(strainIncrements)
    await section.getByTestId('abaqus-material-point-run').click()

    await expect(section).toContainText(/unsupported.*\*DENSITY|\*DENSITY.*unsupported/i)
    await expect(section.getByTestId('abaqus-material-point-results')).toHaveCount(0)
    expect(submissions).toHaveLength(0)
  })
})
