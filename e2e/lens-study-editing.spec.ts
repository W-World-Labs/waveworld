import { expect, test, type Page, type Route } from '@playwright/test'

type SubmittedJob = { spec: Record<string, any> }

function nativeResult(rays: Array<{ origin: number[]; direction: number[] }>) {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'lens-design',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'Host CPU' },
      result: {
        methodId: 'method-algo-lens-geometric-ray-trace',
        familyId: 'method-lens-design',
        rays: rays.map(ray => ({
          status: 'ok',
          opticalPathLength: 1,
          imageSpot: [0, 0],
          lastPosition: ray.origin,
          direction: ray.direction,
        })),
        validSpotCount: rays.length,
        imageCentroid: [0, 0],
        imageRmsRadius: 0,
        finite: true,
        ok: true,
      },
    },
  }
}

async function mockLensJobs(page: Page, submissions: SubmittedJob[]) {
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'lens-test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as SubmittedJob
      submissions.push(body)
      await route.fulfill({ status: 202, json: { job: { id: `lens-job-${submissions.length}` } } })
      return
    }
    const spec = submissions.at(-1)?.spec
    const input = spec?.model?.inline
    await route.fulfill({
      status: 200,
      json: { job: { status: 'succeeded', result: nativeResult(input?.rays ?? []) } },
    })
  })
}

test.describe('OpticStudio lens study editing', () => {
  test('adds and removes surfaces within 1..8 while keeping the final gap at zero', async ({ page }) => {
    await page.goto('/opticstudio')
    const editor = page.getByTestId('lens-surface-editor')
    const rows = editor.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(page.getByTestId('lens-thickness-1')).toHaveValue('0')

    for (let count = 3; count <= 8; count += 1) {
      await page.getByTestId('lens-add-surface').click()
      await expect(rows).toHaveCount(count)
      await expect(page.getByTestId(`lens-thickness-${count - 1}`)).toHaveValue('0')
      await expect(page.getByTestId(`lens-thickness-${count - 2}`)).toHaveValue('5')
    }
    await expect(page.getByTestId('lens-add-surface')).toBeDisabled()

    for (let count = 8; count > 1; count -= 1) {
      await page.getByTestId(`lens-remove-surface-${count - 1}`).click()
      await expect(rows).toHaveCount(count - 1)
      await expect(page.getByTestId(`lens-thickness-${count - 2}`)).toHaveValue('0')
    }
    await expect(page.getByTestId('lens-remove-surface-0')).toBeDisabled()
  })

  test('rejects a spherical radius at or inside its aperture and a blank numeric field before submission', async ({ page }) => {
    const submissions: SubmittedJob[] = []
    await mockLensJobs(page, submissions)
    await page.goto('/opticstudio')

    await page.getByTestId('lens-surface-type-0').selectOption('spherical')
    await page.getByTestId('lens-radius-0').fill('5')
    await page.getByTestId('lens-aperture-0').fill('5')
    await page.getByTestId('lens-study-run').click()
    await expect(page.getByTestId('lens-study-error')).toBeVisible()
    await expect(page.getByTestId('lens-study-error')).toContainText('radius')
    expect(submissions).toHaveLength(0)

    await page.getByTestId('lens-radius-0').fill('')
    await page.getByTestId('lens-aperture-0').fill('2')
    await page.getByTestId('lens-study-run').click()
    await expect(page.getByTestId('lens-study-error')).toBeVisible()
    expect(submissions).toHaveLength(0)
  })

  test('submits edited field and ring settings to the native trace and receives its ray count', async ({ page }) => {
    const submissions: SubmittedJob[] = []
    await mockLensJobs(page, submissions)
    await page.goto('/opticstudio')

    await page.getByTestId('lens-rings').fill('2')
    await page.getByTestId('lens-field-x').fill('7')
    await page.getByTestId('lens-field-y').fill('-3')
    await page.getByTestId('lens-study-run').click()

    const results = page.getByTestId('lens-study-results')
    await expect(results).toBeVisible()
    await expect(results).toContainText('w-sim-cuda-host')
    expect(submissions).toHaveLength(1)

    const spec = submissions[0]!.spec
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.name).toBe('lens-design')
    expect(spec.run).toEqual({ maxSteps: 1 })
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    const input = spec.model.inline
    expect(input).toMatchObject({ module: 'lens-design', method: 'geometric-ray-trace', backend: 'host' })
    expect(input.rays).toHaveLength(9)
    const expectedDirection = [Math.tan(7 * Math.PI / 180), Math.tan(-3 * Math.PI / 180), 1]
    for (const ray of input.rays) {
      expect(ray.direction[0]).toBeCloseTo(expectedDirection[0], 12)
      expect(ray.direction[1]).toBeCloseTo(expectedDirection[1], 12)
      expect(ray.direction[2]).toBe(1)
    }
    expect(input.surfaces).toHaveLength(2)
  })
})
