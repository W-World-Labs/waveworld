import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

const dividerDeck = [
  '.title divider',
  'V1 in 0 DC 10',
  'R1 in out 1k',
  'R2 out 0 3k',
  '.dc V1 0 10 5',
  '.end',
].join('\n')

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

const exportedSpec = {
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
        import: {
          mnaInput,
          mnaJobSpec: exportedSpec,
          nodeMap: { '0': 0, in: 1, out: 2 },
          diagnostics: [],
        },
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

async function mockJobs(page: Page, submitted: Array<Record<string, unknown>>) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submitted.push(body.spec)
      const index = submitted.length
      await route.fulfill({ status: 202, json: { job: { id: `job-${index}` } } })
      return
    }
    if (request.method() === 'GET') {
      const id = path.split('/').at(-1)
      await route.fulfill({
        status: 200,
        json: { job: { status: 'succeeded', result: id === 'job-1' ? importResult() : sweepResult() } },
      })
    }
  })
}

test.describe('RLC page explicit SPICE linear DC sweep', () => {
  test('imports, submits a native sweep job, plots and tables the named node, then downloads CSV', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, submitted)
    await page.goto('/rlc')
    await expect(page.getByRole('heading', { name: '导入 SPICE 网表' })).toBeVisible()
    await page.getByLabel('选择 SPICE 文件').setInputFiles({
      name: 'divider-dc.cir',
      mimeType: 'text/plain',
      buffer: Buffer.from(dividerDeck),
    })
    await expect(page.getByLabel('主网表文件')).toHaveValue('divider-dc.cir')
    await page.getByRole('button', { name: '提交解析作业' }).click()
    await expect(page.getByTestId('spice-dc-sweep-run')).toBeEnabled()
    await expect(page.getByText('解析状态: succeeded · 解析任务 job-1')).toBeVisible()

    await page.getByTestId('spice-dc-sweep-run').click()
    const results = page.getByTestId('spice-dc-sweep-results')
    await expect(results).toBeVisible()
    await expect(page.getByText(/扫描任务 job-2 · succeeded/)).toBeVisible()

    const nodeSelector = results.getByTestId('spice-dc-sweep-node')
    await expect(nodeSelector).toBeVisible()
    await nodeSelector.selectOption('out')
    await expect(results.getByText('3.75', { exact: true })).toBeVisible()
    await expect(results.getByText('7.5', { exact: true })).toBeVisible()

    const download = page.waitForEvent('download')
    await results.getByTestId('spice-dc-sweep-csv').click()
    expect((await download).suggestedFilename()).toBe('spice-dc-sweep.csv')

    expect(submitted).toHaveLength(2)
    expect(submitted[0]).toMatchObject({ kind: 'waveworld-module', parameters: { module: 'sw-ngspice-netlist' }, model: { source: 'inline', inline: { backend: 'host' } } })
    expect(submitted[0].requirements).toEqual({ backends: ['cuda'] })
    expect(submitted[1]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'mna' },
      model: { source: 'inline', inline: { module: 'mna', method: mnaInput.method, backend: 'host', circuit: { nodes: 2, resistors: mnaInput.circuit.resistors, vSources: mnaInput.circuit.vSources }, sweep: mnaInput.sweep } },
      run: { maxSteps: 3 },
    })
    expect(submitted[1].requirements).toEqual({ backends: ['cuda'] })
    expect(submitted[1]).not.toHaveProperty('mnaInput')
    expect(submitted[1].model).not.toHaveProperty('backend')
  })
})
