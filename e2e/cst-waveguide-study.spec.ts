import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'cst-waveguide-study-job'

function nativeFieldResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'waveguide-modes',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        operation: 'cst-waveguide-electric-field-samples',
        familyId: 'method-waveguide-modes',
        family: 'TE',
        m: 1,
        n: 0,
        frequencyHz: 10e9,
        cutoffHz: 6.557140376e9,
        betaRadPerM: 157.08,
        normalization: 'peak Hz = 1 A/m',
        fieldSamples: [
          { x: 0.01143, y: 0.00508, exMagnitude: 0, eyMagnitude: 188.37, ezMagnitude: 0 },
          { x: 0, y: 0.00508, exMagnitude: 0, eyMagnitude: 0, ezMagnitude: 0 },
        ],
        finite: true,
        ok: true,
      },
    },
  }
}

type Mode = 'success' | 'queued' | 'unauthenticated'

async function mockHost(page: Page, mode: Mode) {
  const submissions: Array<Record<string, unknown>> = []
  const cancellations: string[] = []
  await page.route('**/api/v1/me', route => {
    if (mode === 'unauthenticated') {
      return route.fulfill({ status: 401, json: { error: { message: 'Authentication required' } } })
    }
    return route.fulfill({ status: 200, json: { user: { id: 'test-user' } } })
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
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      cancellations.push(path)
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      const job = mode === 'queued'
        ? { id: jobId, status: 'queued' }
        : { id: jobId, status: 'succeeded', result: nativeFieldResult() }
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

test.describe('CST rectangular waveguide electric-field study', () => {
  test('submits bounded samples, renders the native host result, and downloads CSV', async ({ page }) => {
    const mock = await mockHost(page, 'success')
    await page.goto('/cst')

    const study = page.getByTestId('cst-waveguide-study')
    await expect(study).toBeVisible()
    // The panel takes cross-section dimensions in meters and frequency in Hz;
    // TE10 is the default mode, while these explicit values make the request visible.
    await page.getByTestId('cst-waveguide-a').fill('0.02286')
    await page.getByTestId('cst-waveguide-b').fill('0.01016')
    await page.getByTestId('cst-waveguide-family').selectOption('TE')
    await page.getByTestId('cst-waveguide-m').fill('1')
    await page.getByTestId('cst-waveguide-n').fill('0')
    await page.getByTestId('cst-waveguide-frequency').fill('10000000000')
    const sampleCoordinates = '0.01143, 0.00508\n0, 0.00508'
    await page.getByTestId('cst-waveguide-samples').fill(sampleCoordinates)
    await page.getByTestId('cst-waveguide-run').click()

    const results = page.getByTestId('cst-waveguide-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('cst-waveguide-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText(/f=10(?:[,\u00a0\u202f ]?000){3} Hz/)
    await expect(page.getByTestId('cst-waveguide-plot')).toBeVisible()
    await expect(page.getByTestId('cst-waveguide-plot').locator('circle, polyline, path').first()).toBeVisible()
    await expect(page.getByTestId('cst-waveguide-table').locator('tbody tr')).toHaveCount(2)
    await expect(page.getByTestId('cst-waveguide-table').locator('tbody')).toContainText('188.37')

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
      parameters: { module: 'waveguide-modes' },
      model: {
        source: 'inline',
        inline: {
          module: 'waveguide-modes',
          backend: 'host',
          operation: 'cst-waveguide-electric-field-samples',
          a: 0.02286,
          b: 0.01016,
          family: 'TE',
          m: 1,
          n: 0,
          frequency: 10e9,
          fieldSamples: sampleCoordinates.split('\n').map(row => {
            const [x, y] = row.split(',').map(value => Number(value.trim()))
            return { x, y }
          }),
        },
      },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })

    const downloadEvent = page.waitForEvent('download')
    await page.getByTestId('cst-waveguide-download-csv').click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('cst-waveguide-electric-field-samples.csv')
    const csvPath = await download.path()
    expect(csvPath).not.toBeNull()
    const csv = await readFile(csvPath!, 'utf8')
    expect(csv).toContain('exMagnitude')
    expect(csv).toContain('eyMagnitude')
    expect(csv).toContain('188.37')

    await page.getByTestId('cst-waveguide-frequency').fill('11000000000')
    await expect(results).toHaveCount(0)
    await expect(page.getByTestId('cst-waveguide-run')).toBeEnabled()
    expect(mock.submissions).toHaveLength(1)
  })

  test('cancels a queued host job without exposing results', async ({ page }) => {
    const mock = await mockHost(page, 'queued')
    await page.goto('/cst')
    await page.getByTestId('cst-waveguide-run').click()
    await expect(page.getByTestId('cst-waveguide-cancel')).toBeVisible()
    await page.getByTestId('cst-waveguide-cancel').click()
    await expect(page.getByTestId('cst-waveguide-cancel')).toHaveCount(0)
    await expect(page.getByTestId('cst-waveguide-results')).toHaveCount(0)
    await expect(page.getByTestId('cst-waveguide-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
    expect(mock.submissions[0]).toMatchObject({
      parameters: { module: 'waveguide-modes' },
      model: { inline: { operation: 'cst-waveguide-electric-field-samples', backend: 'host' } },
    })
  })

  test('keeps an unauthenticated draft local and shows an authentication error', async ({ page }) => {
    const mock = await mockHost(page, 'unauthenticated')
    await page.goto('/cst')
    await page.getByTestId('cst-waveguide-run').click()
    await expect(page.getByTestId('cst-waveguide-error')).toBeVisible()
    await expect(page.getByTestId('cst-waveguide-results')).toHaveCount(0)
    expect(mock.submissions).toHaveLength(0)
    expect(mock.cancellations).toHaveLength(0)
  })
})
