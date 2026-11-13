import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const jobId = 'comsol-pipe-flow-study-job'
const length = 12
const diameter = 0.04
const rho = 1000
const mu = 0.001
const inletPressure = 100002
const outletPressure = 100000

// Host settlement fixture only. This is not output from a running native solver.
function settledPipeFlow() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-comsol-pipe-flow',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        rho,
        mu,
        g: 9.80665,
        iterations: 4,
        maxEnergyResidual: 0,
        maxMassResidual: 0,
        nodeCount: 2,
        edgeCount: 1,
        nodes: [
          { id: 'inlet', pressure: inletPressure, head: inletPressure / (rho * 9.80665), z: 0, demand: 0, boundary: true },
          { id: 'outlet', pressure: outletPressure, head: outletPressure / (rho * 9.80665), z: 0, demand: 0, boundary: true },
        ],
        edges: [{
          id: 'pipe', from: 'inlet', to: 'outlet', length, hydraulicDiameter: diameter,
          flow: 0.00001, velocity: 0.007957747154594767, reynolds: 318.30988618379064,
          rheology: 'Newtonian', frictionFactor: 0.20106192982974676, regime: 'laminar', headLoss: (inletPressure - outletPressure) / (rho * 9.80665),
        }],
        ok: true,
        methodId: 'method-algo-pipe-flow-1d',
        familyId: 'method-pipe-flow-1d',
        scopeNote: 'Steady incompressible single phase flow in a fixed single pipe; host f64 result fixture.',
      },
    },
  }
}

type Mode = 'success' | 'queued'

async function mockAuthenticatedSettlement(page: Page, mode: Mode = 'success') {
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
      const job = mode === 'queued'
        ? { id: jobId, status: 'queued' }
        : { id: jobId, status: 'succeeded', result: settledPipeFlow() }
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

test.describe('COMSOL guided single-pipe flow study', () => {
  test('submits editable geometry and fluid boundaries, captures native provenance, and exports the snapshot', async ({ page }) => {
    const mock = await mockAuthenticatedSettlement(page)
    await page.goto('/comsol')

    const study = page.getByTestId('comsol-pipe-flow-study')
    await expect(study).toBeVisible()
    await page.getByTestId('comsol-pipe-flow-length').fill(String(length))
    await page.getByTestId('comsol-pipe-flow-diameter').fill(String(diameter))
    await page.getByTestId('comsol-pipe-flow-rho').fill(String(rho))
    await page.getByTestId('comsol-pipe-flow-mu').fill(String(mu))
    await page.getByTestId('comsol-pipe-flow-inletPressure').fill(String(inletPressure))
    await page.getByTestId('comsol-pipe-flow-outletPressure').fill(String(outletPressure))
    await page.getByTestId('comsol-pipe-flow-run').click()

    const results = page.getByTestId('comsol-pipe-flow-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('comsol-pipe-flow-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('host-f64')
    await expect(results).toContainText('method-algo-pipe-flow-1d')
    await expect(page.getByTestId('comsol-pipe-flow-metrics').locator('tbody tr')).toHaveCount(11)
    await expect(page.getByTestId('comsol-pipe-flow-metrics').locator('tbody')).toContainText('laminar')
    await expect(page.getByTestId('comsol-pipe-flow-pressure-plot')).toBeVisible()
    await expect(page.getByTestId('comsol-pipe-flow-pressure-plot').locator('[data-node-label="inlet"]')).toContainText('Inlet')
    await expect(page.getByTestId('comsol-pipe-flow-pressure-plot').locator('[data-node-label="outlet"]')).toContainText('Outlet')
    await expect(page.getByTestId('comsol-pipe-flow-pressure-plot').locator('[data-node-label]')).toHaveCount(2)

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
      parameters: { module: 'sw-comsol-pipe-flow' },
      model: {
        source: 'inline',
        inline: {
          module: 'sw-comsol-pipe-flow',
          methodId: 'method-algo-pipe-flow-1d',
          backend: 'host',
          rho,
          mu,
          nodes: [{ id: 'inlet', pressure: inletPressure }, { id: 'outlet', pressure: outletPressure }],
          edges: [{ id: 'pipe', from: 'inlet', to: 'outlet', length, diameter }],
        },
      },
      requirements: { backends: ['cuda'] },
      run: { maxSteps: 1 },
    })

    const csvDownloadEvent = page.waitForEvent('download')
    await page.getByTestId('comsol-pipe-flow-download-csv').click()
    const csvDownload = await csvDownloadEvent
    expect(csvDownload.suggestedFilename()).toBe('comsol-pipe-flow-results.csv')
    const csvPath = await csvDownload.path()
    expect(csvPath).not.toBeNull()
    const csv = await readFile(csvPath!, 'utf8')
    expect(csv).toContain('pipe')
    expect(csv).toContain('inlet')
    expect(csv).toContain('outlet')
    expect(csv).toContain(String(length))

    const jsonDownloadEvent = page.waitForEvent('download')
    await page.getByTestId('comsol-pipe-flow-download-json').click()
    const jsonDownload = await jsonDownloadEvent
    expect(jsonDownload.suggestedFilename()).toBe('comsol-pipe-flow-results.json')
    const jsonPath = await jsonDownload.path()
    expect(jsonPath).not.toBeNull()
    const snapshot = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
      schemaVersion: number
      jobId: string
      input: Record<string, unknown>
      result: { methodId: string; nodes: Array<{ id: string }>; edges: Array<{ id: string }> }
      backend: { id: string; kind: string }
      provenance: Record<string, unknown>
    }
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.jobId).toBe(jobId)
    expect(snapshot.input).toEqual(spec.model.inline)
    expect(snapshot.backend).toEqual({ id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' })
    expect(snapshot.result.methodId).toBe('method-algo-pipe-flow-1d')
    expect(snapshot.result.nodes.map(node => node.id)).toEqual(['inlet', 'outlet'])
    expect(snapshot.result.edges.map(edge => edge.id)).toEqual(['pipe'])
    expect(JSON.stringify(snapshot.provenance)).toMatch(/w-sim-cuda-host|host-f64|method-algo-pipe-flow-1d/)
  })

  test('cancels a queued host job without exposing a result', async ({ page }) => {
    const mock = await mockAuthenticatedSettlement(page, 'queued')
    await page.goto('/comsol')
    await page.getByTestId('comsol-pipe-flow-run').click()
    await expect(page.getByTestId('comsol-pipe-flow-cancel')).toBeVisible()
    await page.getByTestId('comsol-pipe-flow-cancel').click()
    await expect(page.getByTestId('comsol-pipe-flow-cancel')).toHaveCount(0)
    await expect(page.getByTestId('comsol-pipe-flow-results')).toHaveCount(0)
    await expect(page.getByTestId('comsol-pipe-flow-status')).toContainText(/cancelled/i)
    expect(mock.submissions).toHaveLength(1)
    expect(mock.cancellations).toEqual([`/api/v1/jobs/${jobId}/cancel`])
    expect(mock.submissions[0]).toMatchObject({
      parameters: { module: 'sw-comsol-pipe-flow' },
      model: { inline: { module: 'sw-comsol-pipe-flow', methodId: 'method-algo-pipe-flow-1d', backend: 'host' } },
    })
  })
})
