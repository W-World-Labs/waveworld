import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const touchstone = [
  '! simple measured-like test fixture (not vendor data)',
  '# GHz S RI R 50',
  '1 0 0 0.8 0 0.8 0 0.1 0',
  '2 0.2 0 0.7 0 0.7 0 0.1 0',
  '3 0 0.5 0.6 0 0.6 0 0.1 0',
].join('\n')

const s11 = [[0, 0], [0.2, 0], [0, 0.5]]
const frequenciesHz = [1e9, 2e9, 3e9]

function nativeResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'vswr',
      operation: 'cst-s11-vswr-sweep',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
      result: {
        sampleCount: 3,
        points: [
          { frequencyHz: 1e9, s11: [0, 0], magnitude: 0, vswr: 1, returnLossDb: null, reflectedPowerFraction: 0 },
          { frequencyHz: 2e9, s11: [0.2, 0], magnitude: 0.2, vswr: 1.5, returnLossDb: 13.979400086720375, reflectedPowerFraction: 0.04 },
          { frequencyHz: 3e9, s11: [0, 0.5], magnitude: 0.5, vswr: 3, returnLossDb: 6.020599913279624, reflectedPowerFraction: 0.25 },
        ],
        maxVswr: 3,
        meanReflectedPowerFraction: 0.09666666666666666,
      },
    },
  }
}

async function mockJobs(page: Page, submitted: Array<Record<string, unknown>>) {
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submitted.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: 'job-touchstone' } } })
      return
    }
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeResult() } } })
    }
  })
}

test.describe('CST Touchstone S11 import and analysis', () => {
  test('accepts a three-port file and previews S11-only scope without submitting analysis', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, submitted)
    await page.goto('/cst')

    await page.getByTestId('touchstone-file').setInputFiles({
      name: 'three-port-fixture.s3p',
      mimeType: 'text/plain',
      // Synthetic Touchstone 1.0 three-port matrix: three pairs on each data row.
      buffer: Buffer.from([
        '# GHz S RI R 50',
        '1 0.2 0 0.1 0 0.1 0',
        '0.8 0 0.1 0 0.1 0',
        '0.7 0 0.1 0 0.6 0',
      ].join('\n')),
    })

    const preview = page.getByTestId('touchstone-preview')
    await expect(preview).toContainText('three-port-fixture.s3p')
    await expect(preview).toContainText('3-port')
    await expect(preview).toContainText('S11 only')
    await expect(preview).toContainText('S21 and all-port network analysis are not provided')
    expect(submitted).toHaveLength(0)
  })

  test('previews a two-port file, explicitly submits the native S11 job, and displays and exports returned values', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, submitted)
    await page.goto('/cst')

    await page.getByTestId('touchstone-file').setInputFiles({
      name: 'measured-like.s2p',
      mimeType: 'text/plain',
      buffer: Buffer.from(touchstone),
    })
    const preview = page.getByTestId('touchstone-preview')
    await expect(preview).toContainText('measured-like.s2p')
    await expect(preview).toContainText('2-port')
    await expect(preview).toContainText('RI')
    await expect(preview).toContainText('R 50 Ω')
    await expect(preview).toContainText('3 points')
    await expect(preview).toContainText('S11 only')
    expect(submitted).toHaveLength(0)

    await page.getByTestId('touchstone-analyze').click()
    const results = page.getByTestId('touchstone-results')
    await expect(results).toBeVisible()
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('∞ (ideal match)')
    await expect(results).toContainText('13.9794')
    await expect(results).toContainText('6.0206')
    await expect(results.locator('tbody tr')).toHaveCount(3)

    const metric = results.getByTestId('touchstone-metric')
    await metric.selectOption('returnLossDb')
    await expect(results.getByRole('img', { name: 'Return loss (dB) plot' })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await results.getByTestId('touchstone-csv').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('waveworld-touchstone-s11.csv')
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv).toBe([
      '"frequency_hz","s11_real","s11_imag","magnitude","vswr","return_loss_db","reflected_power_fraction","reference_ohms"',
      '"1000000000","0","0","0","1","Infinity","0","50"',
      '"2000000000","0.2","0","0.2","1.5","13.979400086720375","0.04","50"',
      '"3000000000","0","0.5","0.5","3","6.020599913279624","0.25","50"',
      '',
    ].join('\r\n'))

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toEqual({
      schemaVersion: 1,
      kind: 'waveworld-module',
      name: 'vswr',
      parameters: { module: 'vswr' },
      model: {
        source: 'inline',
        inline: {
          module: 'vswr', backend: 'host', operation: 'cst-s11-vswr-sweep', frequenciesHz, s11,
        },
      },
      run: { maxSteps: 1 },
      outputs: {},
      requirements: { backends: ['cuda'] },
    })
  })
})
