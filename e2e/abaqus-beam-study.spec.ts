import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'abaqus-b31-beam-e2e'

// Synthetic host-job settlement fixture only; it does not invoke CalculiX or Abaqus.
function nativeBeamResult(elements = 2) {
  const length = 2
  const nodes = Array.from({ length: elements + 1 }, (_, index) => ({
    index,
    x: length * index / elements,
    u: 0,
    v: -0.001 * index,
    theta: -0.001 * index,
  }))
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-calculix-timoshenko-beam',
      familyId: 'method-calculix-timoshenko-beam',
      methodId: 'method-algo-b31-timoshenko',
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      element: 'B31',
      elementNodes: 2,
      dofPerNode: 3,
      length,
      nElements: elements,
      nNodes: elements + 1,
      boundary: 'cantilever',
      shearParameter: 0.0078,
      bendingStiffness: 875000,
      shearStiffness: 336538461.53846157,
      shearCorrectionFactor: 5 / 6,
      shearArea: 0.004166666666666667,
      nodes,
      probe: { node: elements, x: length, v: nodes[elements]!.v, theta: nodes[elements]!.theta },
      maxDeflection: 0.002,
      maxMoment: 2000,
      reactions: [
        { node: 0, dof: 'u', value: 0 },
        { node: 0, dof: 'v', value: 1000 },
        { node: 0, dof: 'theta', value: 2000 },
      ],
      springForces: [],
      elements: Array.from({ length: elements }, (_, index) => ({
        index, nodes: [index, index + 1], endForces: [0, 1000, 2000, 0, -1000, 0],
      })),
      closedForm: { deflection: -0.002, rotation: -0.001, maxMoment: 2000 },
      ok: true,
    },
  }
}

type Mode = 'success' | 'failed' | 'queued'

async function mockJobs(page: Page, mode: Mode) {
  const submissions: Array<Record<string, unknown>> = []
  const cancellations: string[] = []
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
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      cancellations.push(path)
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      if (mode === 'queued') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'queued' } } })
      } else if (mode === 'failed') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'failed', error: { message: 'mock B31 study failure' } } } })
      } else {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeBeamResult() } } })
      }
      return
    }
    await route.fallback()
  })
  return { submissions, cancellations }
}

async function openAbaqus(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
  await page.goto('/abaqus')
  await expect(page.getByRole('heading', { name: /Abaqus capability cases/i })).toBeVisible()
  await expect(page.getByTestId('abaqus-beam-study')).toBeVisible()
  await expect(page.getByTestId('abaqus-beam-study')).toContainText(/W-Sim native host(?:-f64)? calculation/i)
}

test.describe('Abaqus-mapped B31 beam study', () => {
  test('submits a point-load snapshot, renders mocked native results, and exports the paired report', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await openAbaqus(page)
    await expect(page.getByTestId('abaqus-beam-load-type')).toHaveValue('point')
    await page.getByTestId('abaqus-beam-length').fill('2')
    await page.getByTestId('abaqus-beam-elements').fill('2')
    await page.getByTestId('abaqus-beam-load-value').fill('1250')
    await page.getByTestId('abaqus-beam-study-run').click()

    const results = page.getByTestId('abaqus-beam-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('abaqus-beam-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('W-Sim native host-f64 (CPU)')
    await expect(results).toContainText('No Abaqus execution')
    await expect(page.getByTestId('abaqus-beam-plot')).toBeVisible()
    await expect(page.getByTestId('abaqus-beam-element-forces-table')).toContainText('2,000')

    expect(mock.submissions).toHaveLength(1)
    const spec = mock.submissions[0] as { model: { inline: Record<string, unknown> }; requirements: { backends: string[] }; run: { maxSteps: number } }
    expect(spec.model.inline).toEqual({
      module: 'sw-calculix-timoshenko-beam', backend: 'host', element: 'B31',
      length: 2, elements: 2,
      section: { E: 210e9, A: 0.005, I: 4.166666666666667e-6, nu: 0.3, k: 5 / 6 },
      boundary: 'cantilever', load: { type: 'point', value: 1250, position: 2 },
    })
    expect(spec.requirements.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(1)

    const csvDownload = page.waitForEvent('download')
    await page.getByTestId('abaqus-beam-download-csv').click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('abaqus-b31-beam-study.csv')
    const csvPath = await csv.path()
    expect(csvPath).not.toBeNull()
    expect(await readFile(csvPath!, 'utf8')).toContain('"study_metadata"')

    const jsonDownload = page.waitForEvent('download')
    await results.getByTestId('abaqus-beam-download-json').click()
    const json = await jsonDownload
    expect(json.suggestedFilename()).toBe('abaqus-b31-beam-study.json')
    const jsonPath = await json.path()
    expect(jsonPath).not.toBeNull()
    const report = JSON.parse(await readFile(jsonPath!, 'utf8')) as { jobId: string; input: Record<string, unknown>; provenance: { solver: string } }
    expect(report.jobId).toBe(jobId)
    expect(report.provenance.solver).toBe('W-Sim native host-f64')
    expect(report.input).toEqual(spec.model.inline)

    await page.getByTestId('abaqus-beam-length').fill('3')
    await expect(results).toBeHidden()
  })

  test('switches to UDL and submits the distributed load in N/m', async ({ page }) => {
    const mock = await mockJobs(page, 'success')
    await openAbaqus(page)
    await page.getByTestId('abaqus-beam-length').fill('2')
    await page.getByTestId('abaqus-beam-elements').fill('2')
    await page.getByTestId('abaqus-beam-load-type').selectOption('udl')
    await page.getByTestId('abaqus-beam-load-value').fill('800')
    await page.getByTestId('abaqus-beam-study-run').click()
    await expect(page.getByTestId('abaqus-beam-results')).toBeVisible()
    const spec = mock.submissions[0] as { model: { inline: Record<string, unknown> } }
    expect(spec.model.inline).toMatchObject({
      module: 'sw-calculix-timoshenko-beam', backend: 'host', element: 'B31',
      load: { type: 'udl', value: 800 },
    })
    expect(spec.model.inline.load).not.toHaveProperty('position')
  })

  test('shows remote failure and cancels a queued mocked job', async ({ page }) => {
    const failed = await mockJobs(page, 'failed')
    await openAbaqus(page)
    await page.getByTestId('abaqus-beam-elements').fill('2')
    await page.getByTestId('abaqus-beam-study-run').click()
    await expect(page.getByTestId('abaqus-beam-study-error')).toContainText(/计算失败|calculation failed/i)
    await expect(page.getByTestId('abaqus-beam-results')).toHaveCount(0)
    expect(failed.submissions).toHaveLength(1)

    const queued = { submissions: [] as Array<Record<string, unknown>>, cancellations: [] as string[] }
    await page.unroute('**/api/v1/me')
    await page.unroute('**/api/v1/jobs**')
    await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
    await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
      if (request.method() === 'POST' && path === '/api/v1/jobs') {
        queued.submissions.push(request.postDataJSON() as Record<string, unknown>)
        await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      } else if (request.method() === 'GET') {
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'queued' } } })
      } else if (request.method() === 'POST' && path.endsWith('/cancel')) {
        queued.cancellations.push(path)
        await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'cancelled' } } })
      } else await route.fallback()
    })
    await page.getByTestId('abaqus-beam-study-run').click()
    await page.getByTestId('abaqus-beam-study-cancel').click()
    await expect(page.getByTestId('abaqus-beam-study-status')).toContainText(/cancelled/i)
    await expect(page.getByTestId('abaqus-beam-results')).toHaveCount(0)
    expect(queued.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
  })
})
