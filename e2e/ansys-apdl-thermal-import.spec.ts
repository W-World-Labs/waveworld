import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const jobId = 'ansys-apdl-thermal-import-e2e'

// A small literal APDL deck with deliberately nonsequential labels and element
// orientation. Import should order the native mesh by x while keeping labels
// 7, 3, and 99 attached to the corresponding returned rows.
const apdlDeck = `/PREP7
ET,1,LINK33
R,1,0.001
MP,KXX,1,10
N,7,0,0,0
N,3,0.25,0,0
N,99,1,0,0
TYPE,1
REAL,1
MAT,1
E,7,3
EN,20,3,99
FINISH
/SOLU
ANTYPE,STATIC
D,7,TEMP,100
D,99,TEMP,0
F,3,HEAT,2
SOLVE
FINISH`

function settledNativeResponse() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-ansys-thermal-fem',
      method: 'method-algo-thermal-fem-theta',
      family: 'method-ansys-mechanical-thermal',
      scope: 'W-Sim host-f64 one-dimensional steady thermal bar result',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        analysis: 'steady',
        element: 'bar',
        dimension: 1,
        nNodes: 3,
        nElements: 2,
        temperatures: [100, 50, 0],
        minTemperature: 0,
        maxTemperature: 100,
        meanTemperature: 50,
        reactions: [-1, 0, 1],
        heatBalance: { sourceTotal: 0, robinHeatIn: 0, dirichletHeatIn: 0, balanceResidual: 0 },
        maxResidual: 0,
      },
    },
  }
}

async function mockNativeSettlement(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  const authenticatedChecks: string[] = []
  const capturedResult = settledNativeResponse()
  await page.route('**/api/v1/me', async route => {
    authenticatedChecks.push(route.request().method())
    await route.fulfill({ status: 200, json: { user: { id: 'test-user' } } })
  })
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
  return { submissions, authenticatedChecks, capturedResult }
}

test.describe('Ansys MAPDL APDL thermal-bar import', () => {
  test('imports the supported deck, runs its native mesh, keeps external labels, and downloads the report', async ({ page }) => {
    const { submissions, authenticatedChecks, capturedResult } = await mockNativeSettlement(page)
    await page.goto('/ansys')
    await page.getByTestId('ansys-thermal-tab').click()

    const source = page.getByTestId('ansys-apdl-source')
    const parse = page.getByTestId('ansys-apdl-parse')
    const preview = page.getByTestId('ansys-apdl-preview')
    const selectImport = page.getByTestId('ansys-apdl-submit')
    await source.fill(apdlDeck)
    await parse.click()

    await expect(preview).toBeVisible()
    const previewNativeInput = page.getByTestId('ansys-apdl-native-input')
    const previewLabels = page.getByTestId('ansys-apdl-external-labels')
    await expect(previewNativeInput).toContainText('sw-ansys-thermal-fem')
    await expect(previewNativeInput).toContainText('0.25')
    await expect(previewNativeInput).toContainText('0.001')
    await expect(previewLabels).toHaveText('[\n  7,\n  3,\n  99\n]')
    await expect(selectImport).toBeEnabled()

    await selectImport.click()
    const run = page.getByTestId('ansys-apdl-run')
    await expect(run).toBeEnabled()
    await run.click()

    const results = page.getByTestId('ansys-thermal-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('ansys-thermal-study-status')).toContainText(jobId)
    await expect(results).toContainText('sw-ansys-thermal-fem')
    await expect(results).toContainText('100')
    await expect(results).toContainText('50')
    await expect(results).toContainText('0')

    const table = page.getByRole('table', { name: 'Native returned final nodal temperatures' })
    await expect(table).toBeVisible()
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0).locator('th')).toHaveText('7')
    await expect(rows.nth(1).locator('th')).toHaveText('3')
    await expect(rows.nth(2).locator('th')).toHaveText('99')

    expect(authenticatedChecks).toContain('GET')
    expect(submissions).toHaveLength(1)
    const spec = submissions[0] as {
      model: { inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    const nativeInput = spec.model.inline
    expect(nativeInput).toMatchObject({
      module: 'sw-ansys-thermal-fem',
      backend: 'host',
      analysis: 'steady',
      dimension: 1,
      mesh: {
        element: 'bar',
        nodes: [[0], [0.25], [1]],
        elements: [[0, 1], [1, 2]],
      },
      conductivity: 10,
      thickness: 0.001,
      dirichlet: [{ node: 0, temperature: 100 }, { node: 2, temperature: 0 }],
      sources: [0, 2, 0],
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)

    const downloadEvent = page.waitForEvent('download')
    await page.getByTestId('ansys-thermal-study-download-json').click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toMatch(/ansys.*thermal.*\.json$/i)
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    const report = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
      jobId: string
      input: Record<string, unknown>
      sourceApdl?: string
      externalNodeLabels?: number[]
      nativeResult: { result: { temperatures: number[] } }
    }
    expect(report.jobId).toBe(jobId)
    expect(report.input).toEqual(nativeInput)
    expect(report.sourceApdl).toContain('MP,KXX,1,10')
    expect(report.externalNodeLabels).toEqual([7, 3, 99])
    expect(report.nativeResult.result.temperatures).toEqual(capturedResult.moduleResult.result.temperatures)
  })

  test('rejects an unsupported command and cannot submit a partial import', async ({ page }) => {
    const { submissions } = await mockNativeSettlement(page)
    await page.goto('/ansys')
    await page.getByTestId('ansys-thermal-tab').click()

    await page.getByTestId('ansys-apdl-source').fill(apdlDeck.replace('SOLVE\nFINISH', '*SET,TEMPERATURE,100\nSOLVE\nFINISH'))
    await page.getByTestId('ansys-apdl-parse').click()

    await expect(page.getByTestId('ansys-apdl-error')).toBeVisible()
    await expect(page.getByTestId('ansys-apdl-error')).toContainText(/unsupported|unrecognized/i)
    await expect(page.getByTestId('ansys-apdl-submit')).toHaveCount(0)
    await expect(page.getByTestId('ansys-apdl-preview')).toHaveCount(0)
    expect(submissions).toHaveLength(0)
  })
})
