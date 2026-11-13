import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'zh'))
})

const rlcDeck = [
  '.title series RLC transient',
  'V1 in 0 DC 10',
  'R1 in mid 10',
  'L1 mid out 1m',
  'C1 out 0 1u',
  '.tran 100u 1m',
  '.end',
].join('\n')

const mnaInput = {
  module: 'mna',
  method: 'method-algo-mna-transient-be',
  circuit: {
    nodes: 3,
    resistors: [{ a: 1, b: 2, r: 10 }],
    capacitors: [{ a: 3, b: 0, c: 1e-6 }],
    inductors: [{ a: 2, b: 3, l: 1e-3 }],
    vSources: [{ a: 1, b: 0, v: 10 }],
    iSources: [],
    diodes: [],
  },
  dt: 1e-4,
  steps: 10,
}

const mnaJobSpec = {
  schemaVersion: 1,
  kind: 'waveworld-module',
  parameters: { module: 'mna' },
  model: { source: 'inline', inline: mnaInput },
  run: { maxSteps: 10 },
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
          mnaJobSpec,
          nodeMap: { '0': 0, in: 1, mid: 2, out: 3 },
          diagnostics: [],
        },
      },
    },
  }
}

function transientResult() {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 10 },
    moduleResult: {
      module: 'mna',
      backend: { id: 'host-f64', precision: 'float64' },
      result: {
        methodId: 'method-algo-mna-transient-be',
        familyId: 'method-mna',
        scheme: 'be',
        dt: 1e-4,
        steps: 10,
        outputNode: 3,
        finalNodeVoltages: [10, 9, 8],
        finalCapacitorCurrents: [0.008],
        finalInductorCurrents: [0.1],
        outputWaveform: [0.8, 1.6, 2.4, 3.2, 4, 4.8, 5.6, 6.4, 7.2, 8],
        finalOutput: 8,
        newtonIterations: 10,
        converged: true,
      },
    },
  }
}

type TransientMode = 'success' | 'pending' | 'deferred'

async function mockJobs(page: Page, mode: TransientMode) {
  let releaseLateResult: (() => void) | undefined
  const lateResultReady = new Promise<void>((resolve) => { releaseLateResult = resolve })
  const submitted: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submitted.push(body.spec)
      const id = submitted.length === 1 ? 'import-job' : 'transient-job'
      await route.fulfill({ status: 202, json: { job: { id } } })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/cancel')) {
      await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
      return
    }
    if (request.method() === 'GET') {
      const id = path.split('/').at(-1)
      if (id === 'transient-job' && mode === 'pending') {
        await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
        return
      }
      if (id === 'transient-job' && mode === 'deferred') {
        await lateResultReady
        try {
          await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: transientResult() } } })
        } catch {
          // Selecting another deck aborts this request; let the handler settle after the gate opens.
        }
        return
      }
      await route.fulfill({
        status: 200,
        json: { job: { status: 'succeeded', result: id === 'import-job' ? importResult() : transientResult() } },
      })
    }
  })
  return { submitted, releaseLateResult: () => releaseLateResult?.() }
}

async function importDeck(page: Page) {
  await page.getByLabel('选择 SPICE 文件').setInputFiles({
    name: 'series-rlc-tran.cir',
    mimeType: 'text/plain',
    buffer: Buffer.from(rlcDeck),
  })
  await page.getByRole('button', { name: '提交解析作业' }).click()
  await expect(page.getByTestId('spice-transient-run')).toBeEnabled()
  await expect(page.getByText('解析状态: succeeded · 解析任务 import-job')).toBeVisible()
}

test.describe('RLC page SPICE transient lifecycle', () => {
  test('imports a constant-source RLC deck, runs native BE MNA and captures the selected node report', async ({ page }) => {
    const { submitted } = await mockJobs(page, 'success')
    await page.goto('/rlc')
    await importDeck(page)

    const outputNode = page.getByLabel('瞬态输出节点')
    await expect(outputNode).toHaveValue('in')
    await outputNode.selectOption('out')
    await page.getByTestId('spice-transient-run').click()

    const results = page.getByTestId('spice-transient-results')
    await expect(results).toBeVisible()
    await expect(results.getByText('transient-job', { exact: true })).toBeVisible()
    await expect(results.getByText('method-algo-mna-transient-be (method-mna)', { exact: true })).toBeVisible()
    await expect(results.getByText('out', { exact: true })).toBeVisible()
    await expect(results.getByText('0.0001 s · 10 步', { exact: true })).toBeVisible()
    await expect(results.getByRole('img', { name: '节点 out 的电压随时间变化' })).toBeVisible()
    await expect(results.getByTestId('spice-transient-table').locator('tbody tr')).toHaveCount(10)
    await expect(results.getByTestId('spice-transient-table').getByText('8', { exact: true })).toBeVisible()

    const csvDownload = page.waitForEvent('download')
    await results.getByTestId('spice-transient-csv').click()
    expect((await csvDownload).suggestedFilename()).toBe('spice-transient.csv')

    const jsonDownload = page.waitForEvent('download')
    await results.getByTestId('spice-transient-json').click()
    const reportDownload = await jsonDownload
    expect(reportDownload.suggestedFilename()).toBe('spice-transient.json')
    const report = JSON.parse(await readFile(await reportDownload.path() as string, 'utf8')) as Record<string, unknown>
    expect(report).toMatchObject({
      jobId: 'transient-job',
      methodId: 'method-algo-mna-transient-be',
      familyId: 'method-mna',
      scheme: 'be',
      dt: 1e-4,
      steps: 10,
      outputNode: 3,
      nodeName: 'out',
      finalNodeVoltages: { '0': 0, in: 10, mid: 9, out: 8 },
      finalOutput: 8,
      converged: true,
      backend: { id: 'host-f64', precision: 'float64' },
    })
    expect(report.samples).toHaveLength(10)
    for (const [index, sample] of (report.samples as Array<{ time: number; value: number }>).entries()) {
      expect(sample.time).toBeCloseTo((index + 1) * 1e-4, 12)
      expect(sample.value).toBeCloseTo((index + 1) * 0.8, 12)
    }

    expect(submitted).toHaveLength(2)
    expect(submitted[0]).toMatchObject({ kind: 'waveworld-module', parameters: { module: 'sw-ngspice-netlist' }, model: { source: 'inline', inline: { module: 'sw-ngspice-netlist', method: 'method-ngspice-netlist-to-mna', backend: 'host', netlist: rlcDeck } } })
    expect(submitted[0]).toMatchObject({ model: { source: 'inline', inline: { netlist: rlcDeck } } })
    expect(submitted[0]).toHaveProperty('requirements.backends', ['cuda'])
    expect(submitted[1]).toMatchObject({
      kind: 'waveworld-module',
      parameters: { module: 'mna' },
      model: { source: 'inline', inline: { ...mnaInput, backend: 'host', outputNode: 3 } },
      run: { maxSteps: 10 },
    })
    expect(submitted[1]).toHaveProperty('requirements.backends', ['cuda'])
    expect(submitted[1]).not.toHaveProperty('mnaInput')
  })

  test('cancels a queued transient job while preserving the completed import', async ({ page }) => {
    const { submitted } = await mockJobs(page, 'pending')
    await page.goto('/rlc')
    await importDeck(page)
    await page.getByTestId('spice-transient-run').click()
    await expect(page.getByRole('button', { name: '停止瞬态分析' })).toBeVisible()
    await page.getByRole('button', { name: '停止瞬态分析' }).click()
    await expect(page.getByText('瞬态任务 transient-job · cancelled')).toBeVisible()
    await expect(page.getByText('解析状态: succeeded · 解析任务 import-job')).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toBeEnabled()
    await expect(page.getByTestId('spice-transient-results')).toHaveCount(0)
    expect(submitted).toHaveLength(2)
  })

  test('discards a late transient result after the selected deck changes', async ({ page }) => {
    const mock = await mockJobs(page, 'deferred')
    await page.goto('/rlc')
    await importDeck(page)
    await page.getByTestId('spice-transient-run').click()
    await expect(page.getByRole('button', { name: '停止瞬态分析' })).toBeVisible()
    await page.getByLabel('选择 SPICE 文件').setInputFiles({
      name: 'replacement.cir',
      mimeType: 'text/plain',
      buffer: Buffer.from('.title replacement\nV2 a 0 DC 3\nR3 a 0 1k\n.op\n.end'),
    })
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toHaveCount(0)
    await expect(page.getByTestId('spice-transient-results')).toHaveCount(0)
    mock.releaseLateResult()
    await expect(page.getByTestId('spice-transient-run')).toHaveCount(0)
    await expect(page.getByTestId('spice-transient-results')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '下载 MNA JobSpec' })).toHaveCount(0)
    expect(mock.submitted).toHaveLength(2)
  })
})
