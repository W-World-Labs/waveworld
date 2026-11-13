import { expect, test, type Page, type Route } from '@playwright/test'

function acResult(omega = 2 * Math.PI * 1000, nodeCount = 2) {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      ok: true,
      module: 'mna',
      backend: { id: 'host-f64-mna' },
      result: {
        methodId: 'method-algo-mna-ac',
        familyId: 'method-mna',
        omega,
        nodeMagnitudes: Array.from({ length: nodeCount }, (_, i) => 0.5 / (i + 1)),
        nodePhases: Array.from({ length: nodeCount }, () => 0),
        nodePhasesDeg: Array.from({ length: nodeCount }, () => 0),
      },
    },
  }
}

type JobMode = 'success' | 'failure-after-success'

async function mockAcJobs(page: Page, mode: JobMode) {
  const submissions: Array<Record<string, unknown>> = []
  const jobs = new Map<string, { omega: number; nodeCount: number; failed: boolean }>()
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      const id = `pspice-ac-${submissions.length}`
      const model = body.spec.model as { inline?: { omega?: number; circuit?: { nodes?: number } } } | undefined
      jobs.set(id, { omega: model?.inline?.omega ?? 2 * Math.PI * 1000, nodeCount: model?.inline?.circuit?.nodes ?? 2, failed: mode === 'failure-after-success' && submissions.length > 1 })
      await route.fulfill({ status: 202, json: { job: { id } } })
      return
    }
    if (request.method() === 'GET') {
      const id = path.split('/').at(-1) ?? ''
      const job = jobs.get(id)
      if (job?.failed) {
        await route.fulfill({ status: 200, json: { job: { status: 'failed', error: { message: 'mock PSpice AC host failure' } } } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: acResult(job?.omega, job?.nodeCount) } } })
      return
    }
    await route.fallback()
  })
  return { submissions }
}

test.describe('PSpice single-frequency AC admission', () => {
  test('blocks an out-of-range frequency and malformed component values before submission', async ({ page }) => {
    const { submissions } = await mockAcJobs(page, 'success')
    await page.goto('/rlc')

    const run = page.getByTestId('pspice-ac-run')
    const frequency = page.getByTestId('pspice-ac-frequency-hz')
    await frequency.fill('1000000000001')
    await expect(run).toBeDisabled()
    expect(submissions).toHaveLength(0)

    await frequency.fill('1000')
    await page.getByTestId('pspice-ac-resistor-1-ohms').fill('0')
    await expect(run).toBeEnabled()
    await run.click()
    await expect(page.getByRole('alert').last()).toBeVisible()
    await expect(page.getByTestId('pspice-ac-results')).toHaveCount(0)
    expect(submissions).toHaveLength(0)
  })

  test('clears a completed result as soon as frequency or circuit edits make it stale', async ({ page }) => {
    const { submissions } = await mockAcJobs(page, 'success')
    await page.goto('/rlc')
    const run = page.getByTestId('pspice-ac-run')

    await run.click()
    await expect(page.getByTestId('pspice-ac-results')).toBeVisible()
    await page.getByTestId('pspice-ac-frequency-hz').fill('2000')
    await expect(page.getByTestId('pspice-ac-results')).toHaveCount(0)

    await run.click()
    await expect(page.getByTestId('pspice-ac-results')).toBeVisible()
    await page.getByTestId('pspice-ac-resistor-1-ohms').fill('2000')
    await expect(page.getByTestId('pspice-ac-results')).toHaveCount(0)
    expect(submissions).toHaveLength(2)
  })

  test('shows an explicit host failure and never leaves the previous phasor table visible', async ({ page }) => {
    const { submissions } = await mockAcJobs(page, 'failure-after-success')
    await page.goto('/rlc')
    const run = page.getByTestId('pspice-ac-run')

    await run.click()
    await expect(page.getByTestId('pspice-ac-results')).toBeVisible()
    await run.click()
    await expect(page.getByRole('alert').last()).toContainText(/pspice-ac-2|计算失败/)
    await expect(page.getByTestId('pspice-ac-results')).toHaveCount(0)
    expect(submissions).toHaveLength(2)
  })
})
