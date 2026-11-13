import { expect, test, type Page, type Route } from '@playwright/test'

function nativeLensResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'lens-design',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
      result: {
        methodId: 'method-algo-lens-geometric-ray-trace',
        familyId: 'method-lens-design',
        backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'mock host' },
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

type Mode = 'queued' | 'remote-error' | 'deferred' | 'success'

async function mockJobs(page: Page, mode: Mode) {
  let releasePending: (() => void) | undefined
  const pendingResponse = new Promise<void>((resolve) => { releasePending = resolve })
  let deferredOnce = false
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: 'lens-study-job' } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      if (mode === 'deferred' && !deferredOnce) {
        deferredOnce = true
        await pendingResponse
        try {
          await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeLensResult() } } })
        } catch {
          // Editing the form aborts the request; releasing the gate still settles this handler.
        }
        return
      }
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
        return
      }
      if (mode === 'remote-error') {
        await route.fulfill({ status: 200, json: { job: { status: 'failed', error: { message: 'mock lens trace failure' } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeLensResult() } } })
    }
  })
  return { submissions, releasePending: () => releasePending?.() }
}

test.describe('OpticStudio lens study lifecycle', () => {
  test('cancels a queued trace and clears pending results', async ({ page }) => {
    const mock = await mockJobs(page, 'queued')
    await page.goto('/opticstudio')

    await page.getByTestId('lens-study-run').click()
    await expect(page.getByTestId('lens-study-cancel')).toBeVisible()
    await page.getByTestId('lens-study-cancel').click()
    await expect(page.getByTestId('lens-study-cancel')).toHaveCount(0)
    await expect(page.getByTestId('lens-study-results')).toHaveCount(0)
    await expect(page.getByTestId('lens-study-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.submissions[0]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'lens-design' },
      model: { source: 'inline', inline: { module: 'lens-design', method: 'geometric-ray-trace', backend: 'host' } },
    })
  })

  test('shows a remote job failure without rendering results', async ({ page }) => {
    const mock = await mockJobs(page, 'remote-error')
    await page.goto('/opticstudio')

    await page.getByTestId('lens-study-run').click()
    await expect(page.getByTestId('lens-study-error')).toContainText(/计算失败|calculation failed/i)
    await expect(page.getByTestId('lens-study-results')).toHaveCount(0)
    expect(mock.submissions).toHaveLength(1)
  })

  test('discards a late trace and old status after the prescription changes', async ({ page }) => {
    const mock = await mockJobs(page, 'deferred')
    await page.goto('/opticstudio')

    await page.getByTestId('lens-study-run').click()
    await expect(page.getByTestId('lens-study-cancel')).toBeVisible()
    await page.getByTestId('lens-ambient-index').fill('1.1')
    mock.releasePending()
    await expect(page.getByTestId('lens-study-results')).toHaveCount(0)
    await expect(page.getByTestId('lens-study-status')).not.toContainText('lens-study-job')
    await expect(page.getByTestId('lens-study-status')).toContainText(/idle/i)
    expect(mock.submissions).toHaveLength(1)
  })

  test('editing the prescription clears results from the submitted snapshot', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await page.goto('/opticstudio')

    await page.getByTestId('lens-study-run').click()
    await expect(page.getByTestId('lens-study-results')).toBeVisible()
    await page.getByTestId('lens-image-distance').fill('21')
    await expect(page.getByTestId('lens-study-results')).toHaveCount(0)
    await expect(page.getByTestId('lens-study-run')).toBeEnabled()
    expect(mock.submissions).toHaveLength(1)
  })
})
