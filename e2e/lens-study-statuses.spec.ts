import { expect, test, type Page, type Route } from '@playwright/test'

type RayStatus = 'ok' | 'vignetted' | 'invalid_geometry' | 'total_internal_reflection'
type Mode = 'partial' | 'all-failed' | 'malformed'

const fiveRayStatuses: RayStatus[] = ['ok', 'ok', 'ok', 'vignetted', 'total_internal_reflection']
const spots: Array<[number, number] | null> = [[0, 0], [1, 0], [0, 1], null, null]
const centroid: [number, number] = [1 / 3, 1 / 3]
const rmsRadius = 2 / 3

/** A transport fixture shaped like the native w-sim result envelope. It never invokes a solver. */
function nativeJobResult(mode: Mode) {
  const statuses: RayStatus[] = mode !== 'all-failed'
    ? fiveRayStatuses
    : ['vignetted', 'invalid_geometry', 'total_internal_reflection', 'vignetted', 'invalid_geometry']
  const imageSpots = mode !== 'all-failed' ? spots : [null, null, null, null, null]
  const rays = statuses.map((status, index) => ({
    status,
    opticalPathLength: 30 + index,
    imageSpot: imageSpots[index],
    lastPosition: [index, index / 2, 25],
    direction: [0, 0, 1],
  }))
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1, wallTimeMs: 1 },
    backend: { id: 'w-sim-cuda', agentId: 'mock-native-agent' },
    moduleResult: {
      module: 'lens-design',
      id: 'lens-design',
      ok: true,
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'mock host' },
      result: {
        module: 'lens-design',
        backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'mock host' },
        methodId: 'method-algo-lens-geometric-ray-trace',
        familyId: 'method-lens-design',
        rays,
        validSpotCount: mode === 'malformed' ? 4 : mode === 'partial' ? 3 : 0,
        imageCentroid: mode === 'partial' ? centroid : null,
        imageRmsRadius: mode === 'partial' ? rmsRadius : null,
        finite: true,
        ok: true,
      },
      meta: {},
    },
  }
}

async function mockNativeJobs(page: Page, mode: Mode) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'e2e-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: 'lens-study-e2e' } } })
      return
    }
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: { job: { id: 'lens-study-e2e', status: 'succeeded', result: nativeJobResult(mode) } },
      })
      return
    }
    await route.fulfill({ status: 200, json: { job: { id: 'lens-study-e2e', status: 'cancelled' } } })
  })
  return submissions
}

async function submitDefaultStudy(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
  await page.goto('/opticstudio')
  await page.getByTestId('lens-study-run').click()
}

test.describe('OpticStudio lens study native ray statuses', () => {
  test('plots only successful native spots and reports vignette/TIR counts', async ({ page }) => {
    const submissions = await mockNativeJobs(page, 'partial')
    await submitDefaultStudy(page)

    const results = page.getByTestId('lens-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('lens-spot-plot').locator('circle')).toHaveCount(3)
    await expect(results).toContainText(/3\s*\/\s*5/)
    await expect(results).toContainText(/vignetted:\s*1/i)
    await expect(results).toContainText(/total_internal_reflection:\s*1/i)
    await expect(page.getByTestId('lens-ray-table')).toContainText(/total_internal_reflection/i)
    expect(submissions).toHaveLength(1)
    const inline = (submissions[0].model as { inline: Record<string, unknown> }).inline
    expect(inline).toMatchObject({ module: 'lens-design', method: 'geometric-ray-trace', backend: 'host' })
    expect(inline.rays).toHaveLength(5)
  })

  test('keeps all-failed spot metrics undefined instead of showing a perfect zero RMS', async ({ page }) => {
    const submissions = await mockNativeJobs(page, 'all-failed')
    await submitDefaultStudy(page)

    const results = page.getByTestId('lens-study-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('lens-spot-plot').locator('circle')).toHaveCount(0)
    await expect(results).toContainText(/0\s*\/\s*5/)
    await expect(results).toContainText(/centroid/i)
    await expect(results).toContainText(/RMS radius/i)
    await expect(results).toContainText(/No valid image spots/i)
    const rms = results.locator('dl > div').filter({ hasText: 'RMS radius' }).locator('dd')
    await expect(rms).toHaveText('—')
    expect(submissions).toHaveLength(1)
  })

  test('rejects a malformed native payload visibly and renders no results', async ({ page }) => {
    const submissions = await mockNativeJobs(page, 'malformed')
    await submitDefaultStudy(page)

    await expect(page.getByTestId('lens-study-error')).toBeVisible()
    await expect(page.getByTestId('lens-study-results')).toHaveCount(0)
    expect(submissions).toHaveLength(1)
  })
})
