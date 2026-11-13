import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

const sweepDeck = '.title divider\nV1 in 0 10\nR1 in out 1k\nR2 out 0 3k\n.dc V1 0 10 5\n.end'

const mnaInput = {
  module: 'mna',
  method: 'method-algo-mna-dc-sweep',
  circuit: {
    nodes: 2,
    resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
    capacitors: [],
    inductors: [],
    vSources: [{ a: 1, b: 0, v: 10 }],
    iSources: [],
    diodes: [],
  },
  sweep: { source: 0, start: 0, stop: 10, steps: 3 },
}

const mnaJobSpec = {
  schemaVersion: 1,
  kind: 'waveworld-module',
  parameters: { module: 'mna' },
  model: { source: 'inline', inline: mnaInput },
  run: { maxSteps: 3 },
  outputs: {},
}

function importResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-ngspice-netlist',
      backend: { id: 'host-f64' },
      result: {
        ok: true,
        methodId: 'method-ngspice-netlist-to-mna',
        import: { mnaInput, mnaJobSpec, nodeMap: { '0': 0, in: 1, out: 2 }, diagnostics: [] },
      },
    },
  }
}

function sweepResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 3 },
    moduleResult: {
      module: 'mna',
      backend: { id: 'host-f64', precision: 'float64' },
      result: {
        methodId: 'method-algo-mna-dc-sweep',
        familyId: 'method-mna',
        sweepSource: 0,
        points: [
          { value: 0, nodeVoltages: [0, 0] },
          { value: 5, nodeVoltages: [5, 3.75] },
          { value: 10, nodeVoltages: [10, 7.5] },
        ],
      },
    },
  }
}

type SweepMode = 'failure' | 'pending' | 'deferred'

async function mockJobs(page: Page, mode: SweepMode) {
  let releaseLateResult: (() => void) | undefined
  const lateResultReady = new Promise<void>((resolve) => { releaseLateResult = resolve })
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      const id = submissions.length === 1 ? 'import-job' : 'sweep-job'
      await route.fulfill({ status: 202, json: { job: { id } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      const id = path.split('/').at(-1)
      if (id === 'sweep-job' && mode === 'failure') {
        await route.fulfill({ status: 200, json: { job: { status: 'failed', error: { message: 'mock sweep failure' } } } })
        return
      }
      if (id === 'sweep-job' && mode === 'pending') {
        await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
        return
      }
      if (id === 'sweep-job' && mode === 'deferred') {
        await lateResultReady
        try {
          await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: sweepResult() } } })
        } catch {
          // File selection aborts this request; resolving the gate still lets the route handler settle.
        }
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: importResult() } } })
    }
  })
  return { submissions, releaseLateResult: () => releaseLateResult?.() }
}

async function importSweep(page: Page, deck = sweepDeck) {
  await page.getByLabel('选择 SPICE 文件').setInputFiles({ name: 'divider.cir', mimeType: 'text/plain', buffer: Buffer.from(deck) })
  await page.getByRole('button', { name: '提交解析作业' }).click()
  await expect(page.getByTestId('spice-dc-sweep-run')).toBeVisible()
}

test.describe('RLC page SPICE DC sweep lifecycle', () => {
  test('keeps import and MNA export available when a sweep job fails', async ({ page }) => {
    const { submissions } = await mockJobs(page, 'failure')
    await page.goto('/rlc')
    await importSweep(page)

    await page.getByTestId('spice-dc-sweep-run').click()
    await expect(page.getByRole('alert').last()).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
    await expect(page.getByText('解析状态: succeeded · 解析任务 import-job')).toBeVisible()
    await expect(page.getByTestId('spice-dc-sweep-results')).toHaveCount(0)
    expect(submissions).toHaveLength(2)
    expect(submissions[1]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'mna' },
      model: { source: 'inline', inline: { module: 'mna', method: mnaInput.method, backend: 'host', circuit: { nodes: 2, resistors: mnaInput.circuit.resistors, vSources: mnaInput.circuit.vSources }, sweep: mnaInput.sweep } },
      run: { maxSteps: 3 },
    })
  })

  test('cancels a queued sweep while preserving the completed import and export', async ({ page }) => {
    const { submissions } = await mockJobs(page, 'pending')
    await page.goto('/rlc')
    await importSweep(page)

    await page.getByTestId('spice-dc-sweep-run').click()
    await expect(page.getByRole('button', { name: '停止扫描' })).toBeVisible()
    await page.getByRole('button', { name: '停止扫描' }).click()
    await expect(page.getByText(/扫描任务 sweep-job · cancelled/)).toBeVisible()
    await expect(page.getByText('解析状态: succeeded · 解析任务 import-job')).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
    await expect(page.getByTestId('spice-dc-sweep-results')).toHaveCount(0)
    expect(submissions).toHaveLength(2)
  })

  test('discards a late sweep response after the selected deck changes', async ({ page }) => {
    const mock = await mockJobs(page, 'deferred')
    await page.goto('/rlc')
    await importSweep(page)

    await page.getByTestId('spice-dc-sweep-run').click()
    await expect(page.getByRole('button', { name: '停止扫描' })).toBeVisible()
    await page.getByLabel('选择 SPICE 文件').setInputFiles({
      name: 'replacement.cir',
      mimeType: 'text/plain',
      buffer: Buffer.from('.title replacement\nV2 a 0 3\nR3 a 0 1k\n.op\n.end'),
    })
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toHaveCount(0)
    await expect(page.getByTestId('spice-dc-sweep-results')).toHaveCount(0)
    mock.releaseLateResult()
    await expect(page.getByTestId('spice-dc-sweep-run')).toHaveCount(0)
    await expect(page.getByTestId('spice-dc-sweep-results')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toHaveCount(0)
    expect(mock.submissions).toHaveLength(2)
  })

  test('leaves MNA export available when the deck adds an unsupported analysis directive', async ({ page }) => {
    const { submissions } = await mockJobs(page, 'failure')
    await page.goto('/rlc')
    await importSweep(page, sweepDeck.replace('.end', 'C1 out 0 1u\n.end'))

    await expect(page.getByTestId('spice-dc-sweep-run')).toBeDisabled()
    await expect(page.getByText(/仅支持单一独立电压源的线性 .dc 扫描/)).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
    expect(submissions).toHaveLength(1)
  })
})
