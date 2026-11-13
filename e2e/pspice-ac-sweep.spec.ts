import { expect, test, type Page, type Route } from '@playwright/test'

function acResult(omega: number, nodeCount = 2) {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'mna',
      backend: { id: 'host-f64-mna' },
      result: {
        methodId: 'method-algo-mna-ac',
        familyId: 'method-mna',
        omega,
        nodeMagnitudes: Array.from({ length: nodeCount }, (_, i) => 1 / (i + 1)),
        nodePhases: Array.from({ length: nodeCount }, (_, i) => i ? -0.25 : 0),
        nodePhasesDeg: Array.from({ length: nodeCount }, (_, i) => i ? -14.32394487827058 : 0),
      },
    },
  }
}

async function mockJobs(page: Page, failAt?: number) {
  const submissions: Array<Record<string, unknown>> = []
  const jobs = new Map<string, { omega: number; nodeCount: number; failed: boolean }>()
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      const id = `pspice-ac-sweep-${submissions.length}`
      const model = body.spec.model as { inline?: { omega?: number; circuit?: { nodes?: number } } } | undefined
      jobs.set(id, { omega: model?.inline?.omega ?? 2 * Math.PI * 1000, nodeCount: model?.inline?.circuit?.nodes ?? 2, failed: submissions.length === failAt })
      await route.fulfill({ status: 202, json: { job: { id } } })
      return
    }
    if (request.method() === 'GET') {
      const id = path.split('/').at(-1) ?? ''
      const job = jobs.get(id)
      if (job?.failed) {
        await route.fulfill({ status: 200, json: { job: { status: 'failed', error: { message: 'mock AC sweep point failure' } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: acResult(job?.omega ?? 2 * Math.PI * 1000, job?.nodeCount) } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.describe('RLC guided PSpice AC frequency sweep', () => {
  test('keeps optional sweep off by default and submits the default single-frequency study', async ({ page }) => {
    const submissions = await mockJobs(page)
    await page.goto('/rlc')

    const sweepEnabled = page.getByTestId('pspice-ac-sweep-enabled')
    await expect(sweepEnabled).not.toBeChecked()
    await expect(page.getByTestId('pspice-ac-frequency-hz')).toHaveValue('1000')

    await page.getByTestId('pspice-ac-run').click()
    await expect(page.getByTestId('pspice-ac-results')).toBeVisible()
    expect(submissions).toHaveLength(1)
    expect(JSON.stringify(submissions[0])).toContain('method-algo-mna-ac')
    expect(JSON.stringify(submissions[0])).toContain('1000')
    expect(submissions[0]).not.toHaveProperty('sweep')
  })

  test('submits a bounded logarithmic plan sequentially and keeps partial native phasor rows on failure', async ({ page }) => {
    const submissions = await mockJobs(page, 3)
    await page.goto('/rlc')

    await page.getByTestId('pspice-ac-sweep-enabled').check()
    await expect(page.getByTestId('pspice-ac-sweep-scale')).toHaveValue('log')
    await page.getByTestId('pspice-ac-sweep-start-hz').fill('10')
    await page.getByTestId('pspice-ac-sweep-stop-hz').fill('1000')
    await page.getByTestId('pspice-ac-sweep-points').fill('3')
    await expect(page.getByTestId('pspice-ac-run')).toBeEnabled()
    await page.getByTestId('pspice-ac-run').click()

    const results = page.getByTestId('pspice-ac-results')
    await expect(results).toBeVisible()
    await expect(results.getByRole('img', { name: 'AC 扫频幅值与相位图' })).toBeVisible()
    const table = results.getByTestId('pspice-ac-sweep-table')
    await expect(table.locator('tbody tr')).toHaveCount(6)
    await expect(table).toContainText('10')
    await expect(table).toContainText('100')
    await expect(table.locator('tbody tr td:first-child')).toHaveText(['10', '10', '10', '100', '100', '100'])
    await expect(page.getByRole('alert').last()).toContainText(/计算失败|calculation failed/i)

    expect(submissions).toHaveLength(3)
    for (const spec of submissions) {
      expect(JSON.stringify(spec)).toContain('method-algo-mna-ac')
      expect(JSON.stringify(spec)).not.toContain('ac-sweep')
    }
    const frequencies = submissions.map(spec => {
      const model = spec.model as { inline?: { omega?: number } }
      return (model.inline?.omega ?? 0) / (2 * Math.PI)
    })
    expect(frequencies[0]).toBeCloseTo(10)
    expect(frequencies[1]).toBeCloseTo(100)
    expect(frequencies[2]).toBeCloseTo(1000)
  })

  test('cancels the active point, retains the completed row, and submits no later point', async ({ page }) => {
    const submissions: Array<Record<string, unknown>> = []
    const jobs = new Map<string, number>()
    let releaseSecondStatus!: () => void
    let markSecondStatusHeld!: () => void
    const secondStatusHeld = new Promise<void>(resolve => { markSecondStatusHeld = resolve })
    const cancelRequests: string[] = []
    await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
    await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
      if (request.method() === 'POST' && path === '/api/v1/jobs') {
        const body = request.postDataJSON() as { spec: Record<string, unknown> }
        submissions.push(body.spec)
        const id = `pspice-ac-cancel-${submissions.length}`
        const model = body.spec.model as { inline?: { omega?: number } } | undefined
        jobs.set(id, model?.inline?.omega ?? 2 * Math.PI * 1000)
        await route.fulfill({ status: 202, json: { job: { id } } })
        return
      }
      if (request.method() === 'POST' && path.endsWith('/cancel')) {
        cancelRequests.push(path)
        await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
        return
      }
      if (request.method() === 'GET') {
        const id = path.split('/').at(-1) ?? ''
        if (id === 'pspice-ac-cancel-2') {
          markSecondStatusHeld()
          await new Promise<void>(resolve => { releaseSecondStatus = resolve })
          await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
          return
        }
        const omega = jobs.get(id) ?? 2 * Math.PI * 1000
        await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: acResult(omega) } } })
        return
      }
      await route.fallback()
    })
    await page.goto('/rlc')
    await page.getByTestId('pspice-ac-sweep-enabled').check()
    await page.getByTestId('pspice-ac-sweep-start-hz').fill('10')
    await page.getByTestId('pspice-ac-sweep-stop-hz').fill('1000')
    await page.getByTestId('pspice-ac-sweep-points').fill('3')
    await page.getByTestId('pspice-ac-run').click()

    await secondStatusHeld
    expect(submissions).toHaveLength(2)
    const cancelRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/pspice-ac-cancel-2/cancel'))
    await page.getByTestId('pspice-ac-cancel').click()
    releaseSecondStatus()
    await cancelRequest

    await expect(page.getByText(/1 个.*频点|频点.*1 个/)).toBeVisible()
    const table = page.getByTestId('pspice-ac-sweep-table')
    await expect(table.locator('tbody tr')).toHaveCount(3)
    await expect(table).toContainText('10')
    await expect(table.locator('tbody tr td:first-child')).toHaveText(['10', '10', '10'])
    expect(cancelRequests).toHaveLength(1)
    expect(submissions).toHaveLength(2)
  })

  test('clears completed rows when sweep inputs change and discards the pending point response', async ({ page }) => {
    const submissions: Array<Record<string, unknown>> = []
    const jobs = new Map<string, number>()
    let releaseSecondStatus!: () => void
    let markSecondStatusHeld!: () => void
    const secondStatusHeld = new Promise<void>(resolve => { markSecondStatusHeld = resolve })
    const cancelRequests: string[] = []
    await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
    await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
      if (request.method() === 'POST' && path === '/api/v1/jobs') {
        const body = request.postDataJSON() as { spec: Record<string, unknown> }
        submissions.push(body.spec)
        const id = `pspice-ac-stale-${submissions.length}`
        const model = body.spec.model as { inline?: { omega?: number } } | undefined
        jobs.set(id, model?.inline?.omega ?? 2 * Math.PI * 1000)
        await route.fulfill({ status: 202, json: { job: { id } } })
        return
      }
      if (request.method() === 'POST' && path.endsWith('/cancel')) {
        cancelRequests.push(path)
        await route.fulfill({ status: 200, json: { job: { status: 'cancelled' } } })
        return
      }
      if (request.method() === 'GET') {
        const id = path.split('/').at(-1) ?? ''
        if (id === 'pspice-ac-stale-2') {
          markSecondStatusHeld()
          await new Promise<void>(resolve => { releaseSecondStatus = resolve })
          await route.fulfill({ status: 200, json: { job: { status: 'queued' } } })
          return
        }
        const omega = jobs.get(id) ?? 2 * Math.PI * 1000
        await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: acResult(omega) } } })
        return
      }
      await route.fallback()
    })
    await page.goto('/rlc')
    await page.getByTestId('pspice-ac-sweep-enabled').check()
    await page.getByTestId('pspice-ac-sweep-start-hz').fill('10')
    await page.getByTestId('pspice-ac-sweep-stop-hz').fill('1000')
    await page.getByTestId('pspice-ac-sweep-points').fill('3')
    await page.getByTestId('pspice-ac-run').click()

    await secondStatusHeld
    expect(submissions).toHaveLength(2)
    await expect(page.getByTestId('pspice-ac-sweep-table').locator('tbody tr')).toHaveCount(3)
    const cancelRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/pspice-ac-stale-2/cancel'))
    await page.getByTestId('pspice-ac-sweep-stop-hz').fill('2000')
    await expect(page.getByTestId('pspice-ac-results')).toHaveCount(0)
    releaseSecondStatus()
    await cancelRequest

    await expect(page.getByTestId('pspice-ac-results')).toHaveCount(0)
    expect(cancelRequests).toHaveLength(1)
    expect(submissions).toHaveLength(2)
  })
})
