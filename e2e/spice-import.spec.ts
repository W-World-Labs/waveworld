import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

const dividerDeck = '.title divider\nV1 in 0 10\nR1 in out 1k\nR2 out 0 3k\n.op\n.end'

const mnaInput = {
  module: 'mna',
  method: 'method-algo-mna-dc',
  circuit: {
    nodes: 2,
    vSources: [{ a: 1, b: 0, v: 10 }],
    resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
    capacitors: [],
    inductors: [],
    iSources: [],
    diodes: [],
  },
}

const mnaJobSpec = {
  schemaVersion: 1,
  kind: 'waveworld-module',
  parameters: { module: 'mna' },
  model: { source: 'inline', inline: mnaInput },
  run: { maxSteps: 1 },
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

function dcResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'mna',
      backend: { id: 'host-f64', precision: 'float64' },
      result: {
        methodId: 'method-algo-mna-dc',
        familyId: 'method-mna',
        converged: true,
        iterations: 2,
        residualNorm: 0,
        nodeVoltages: [10, 7.5],
      },
    },
  }
}

type MockMode = 'success' | 'dc-failure' | 'dc-pending'

async function mockJobs(page: Page, mode: MockMode, submitted: Array<Record<string, unknown>>) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: { model: { inline: Record<string, unknown> } } }
      submitted.push(body.spec)
      const index = submitted.length
      await route.fulfill({ status: 202, json: { job: { id: `job-${index}` } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      const id = path.split('/').at(-1)
      if (mode === 'dc-pending' && id === 'job-2') {
        await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
        return
      }
      if (mode === 'dc-failure' && id === 'job-2') {
        await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: { schemaVersion: 1, status: 'succeeded', summary: { steps: 1 }, moduleResult: { module: 'mna', backend: { id: 'host-f64' }, result: { methodId: 'method-algo-mna-dc', familyId: 'method-mna', converged: false } } } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: id === 'job-1' ? importResult() : dcResult() } } })
    }
  })
}

async function uploadDivider(page: Page) {
  await page.getByLabel('选择 SPICE 文件').setInputFiles({ name: 'divider.cir', mimeType: 'text/plain', buffer: Buffer.from(dividerDeck) })
  await expect(page.getByLabel('主网表文件')).toHaveValue('divider.cir')
  await page.getByRole('button', { name: '提交解析作业' }).click()
  await expect(page.getByRole('button', { name: '运行直流工作点' })).toBeEnabled()
}

test.describe('RLC page SPICE import and explicit DC operating point', () => {
  test('submits a separate native host DC job and displays its returned divider voltage', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, 'success', submitted)
    await page.goto('/rlc')
    await expect(page.getByRole('heading', { name: '导入 SPICE 网表' })).toBeVisible()
    await expect(page.getByLabel('谐振电路走纸模拟画布')).toBeAttached()
    await uploadDivider(page)

    await expect(page.getByText('解析状态: succeeded · 解析任务 job-1')).toBeVisible()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 MNA JobSpec' }).click()
    expect((await download).suggestedFilename()).toBe('waveworld-mna-job.json')
    expect(submitted).toHaveLength(1)

    await page.getByRole('button', { name: '运行直流工作点' }).click()
    await expect(page.getByText('out', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('7.5', { exact: true })).toBeVisible()
    await expect(page.getByText(/求解任务 job-2 · succeeded/)).toBeVisible()
    await expect(page.getByText(/求解器来源.*method-mna · method-algo-mna-dc/)).toBeVisible()
    await expect(page.getByText('解析状态: succeeded · 解析任务 job-1')).toBeVisible()
    await expect(page.getByLabel('谐振电路走纸模拟画布')).toBeAttached()
    expect(submitted).toHaveLength(2)
    expect(submitted[0]).toMatchObject({ kind: 'waveworld-module', parameters: { module: 'sw-ngspice-netlist' }, model: { source: 'inline', inline: { backend: 'host' } } })
    expect(submitted[1]).toMatchObject({ kind: 'waveworld-module', parameters: { module: 'mna' }, model: { source: 'inline', inline: { method: 'method-algo-mna-dc', backend: 'host' } } })
    expect((submitted[0] as { requirements?: { backends?: string[] } }).requirements?.backends).toEqual(['cuda'])
    expect((submitted[1] as { requirements?: { backends?: string[] } }).requirements?.backends).toEqual(['cuda'])
    expect(submitted[1]).not.toHaveProperty('mnaInput')
  })

  test('keeps import and export after solver failure', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, 'dc-failure', submitted)
    await page.goto('/rlc')
    await uploadDivider(page)
    await page.getByRole('button', { name: '运行直流工作点' }).click()
    await expect(page.getByRole('alert').last()).toContainText('did not converge')
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
    await expect(page.getByText('解析状态: succeeded · 解析任务 job-1')).toBeVisible()
  })

  test('cancels a pending DC job independently of the completed import', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, 'dc-pending', submitted)
    await page.goto('/rlc')
    await uploadDivider(page)
    await page.getByRole('button', { name: '运行直流工作点' }).click()
    await expect(page.getByRole('button', { name: '停止求解' })).toBeVisible()
    await page.getByRole('button', { name: '停止求解' }).click()
    await expect(page.getByText('求解任务 job-2 · cancelled')).toBeVisible()
    await expect(page.getByText('解析状态: succeeded · 解析任务 job-1')).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
  })

  test('does not restore a late solver result after the selected files change', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, 'dc-pending', submitted)
    await page.goto('/rlc')
    await uploadDivider(page)
    await page.getByRole('button', { name: '运行直流工作点' }).click()
    await expect(page.getByRole('button', { name: '停止求解' })).toBeVisible()
    await page.getByLabel('选择 SPICE 文件').setInputFiles({ name: 'replacement.cir', mimeType: 'text/plain', buffer: Buffer.from('.title replacement\nV2 a 0 3\nR3 a 0 1k\n.op\n.end') })
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '运行直流工作点' })).toHaveCount(0)
    await expect(page.getByText('7.5', { exact: true })).toHaveCount(0)
  })

  test('rejects transient analysis for DC while retaining MNA export', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockJobs(page, 'success', submitted)
    await page.goto('/rlc')
    await page.getByLabel('选择 SPICE 文件').setInputFiles({ name: 'transient.cir', mimeType: 'text/plain', buffer: Buffer.from('.title transient\nV1 in 0 10\nR1 in 0 1k\n.tran 1u 1m\n.end') })
    await page.getByRole('button', { name: '提交解析作业' }).click()
    await expect(page.getByRole('button', { name: '运行直流工作点' })).toBeDisabled()
    await expect(page.getByText(/仅支持带 .op 的线性 R\/V\/I 网表运行直流工作点/)).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
    expect(submitted).toHaveLength(1)
  })
})
