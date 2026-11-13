import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'lens-study-job'

function geometricTraceResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'lens-design',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'CPU' },
      result: {
        module: 'lens-design',
        methodId: 'method-algo-lens-geometric-ray-trace',
        familyId: 'method-lens-design',
        rays: [
          { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, 0], lastPosition: [0, 0, 25], direction: [0, 0, 1] },
          { status: 'ok', opticalPathLength: 37.5, imageSpot: [1, 0], lastPosition: [1, 0, 25], direction: [0, 0, 1] },
          { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, 1], lastPosition: [0, 1, 25], direction: [0, 0, 1] },
          { status: 'ok', opticalPathLength: 37.5, imageSpot: [-1, 0], lastPosition: [-1, 0, 25], direction: [0, 0, 1] },
          { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, -1], lastPosition: [0, -1, 25], direction: [0, 0, 1] },
        ],
        validSpotCount: 5,
        imageCentroid: [0, 0],
        imageRmsRadius: Math.sqrt(0.8),
        finite: true,
        ok: true,
      },
    },
  }
}

async function mockAuthenticatedHost(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
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
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: geometricTraceResult() } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

test.describe('OpticStudio centered lens study', () => {
  test('traces the default plane plate and exports the saved native input and result', async ({ page }) => {
    const submissions = await mockAuthenticatedHost(page)
    await page.goto('/opticstudio')

    await page.getByTestId('lens-study-run').click()

    const results = page.getByTestId('lens-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('lens-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(page.getByTestId('lens-spot-plot').locator('circle')).toHaveCount(5)
    await expect(results).toContainText('5 / 5')
    await expect(results).toContainText('0.894427')
    await expect(page.getByTestId('lens-ray-table').locator('tbody tr')).toHaveCount(5)
    await expect(page.getByTestId('lens-ray-table').locator('tbody')).toContainText('37.5')

    expect(submissions).toHaveLength(1)
    const spec = submissions[0] as {
      model: { inline: Record<string, unknown> }
      requirements: { backends: string[] }
      run: { maxSteps: number }
    }
    expect(spec.model.inline).toMatchObject({
      module: 'lens-design',
      method: 'geometric-ray-trace',
      backend: 'host',
      surfaces: [
        { type: 'plane', n1: 1, n2: 1.5, aperture: 5, thickness: 5 },
        { type: 'plane', n1: 1.5, n2: 1, aperture: 5, thickness: 0 },
      ],
      imageDistance: 20,
    })
    const submittedInput = spec.model.inline
    expect(submittedInput.rays).toHaveLength(5)
    const rays = submittedInput.rays as Array<{ origin: number[]; direction: number[] }>
    const expectedOrigins = [[0, 0, -10], [1, 0, -10], [0, 1, -10], [-1, 0, -10], [0, -1, -10]]
    rays.forEach((ray, index) => {
      ray.origin.forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(expectedOrigins[index]![axis]!, 12))
      expect(ray.direction).toEqual([0, 0, 1])
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)

    const csvDownload = page.waitForEvent('download')
    await page.getByTestId('lens-rays-csv').click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('waveworld-lens-rays.csv')
    const csvPath = await csv.path()
    expect(csvPath).not.toBeNull()
    const csvContents = await readFile(csvPath!, 'utf8')
    expect(csvContents).toContain('"ray_index","status","optical_path_length_mm"')
    expect(csvContents).toContain('"0","ok","37.5","0","0","0","0","25"')
    expect(csvContents).toContain('"4","ok","37.5","0","-1","0","-1","25"')

    const reportDownload = page.waitForEvent('download')
    await page.getByTestId('lens-study-report').click()
    const report = await reportDownload
    expect(report.suggestedFilename()).toBe('waveworld-lens-study.json')
    const reportPath = await report.path()
    expect(reportPath).not.toBeNull()
    const reportContents = await readFile(reportPath!, 'utf8')
    const savedReport = JSON.parse(reportContents) as {
      jobId: string
      input: { module: string; method: string; rays: unknown[]; surfaces: unknown[] }
      result: { validSpotCount: number; imageRmsRadius: number }
      draft: { imageDistance: number }
      metadata: { notes: string[] }
    }
    expect(savedReport.jobId).toBe(jobId)
    expect(savedReport.input).toEqual(submittedInput)
    expect(savedReport.result.validSpotCount).toBe(5)
    expect(savedReport.result.imageRmsRadius).toBeCloseTo(Math.sqrt(0.8), 12)
    expect(savedReport.draft.imageDistance).toBe(20)
    expect(savedReport.metadata.notes.join(' ')).toMatch(/not produced or validated by OpticStudio/)
  })
})
