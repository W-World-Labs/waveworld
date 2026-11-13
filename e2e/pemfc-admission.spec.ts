import { expect, test, type Page, type Route } from '@playwright/test'

const jobId = 'pemfc-admission-unexpected-job'

async function mockSettlement(page: Page) {
  const settlements: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'pemfc-e2e-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      settlements.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'failed', error: 'unexpected invalid-study settlement' } } })
      return
    }
    await route.fallback()
  })
  return settlements
}

async function openPemfc(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
  await page.goto('/comsol')
  await expect(page.getByTestId('pemfc-study-run')).toBeVisible()
}

test.describe('PEMFC study admission', () => {
  test('rejects invalid fields, sample counts, and Tafel guard violations before settlement', async ({ page }) => {
    const settlements = await mockSettlement(page)
    await openPemfc(page)

    const rejectLocally = async (testId: string, value: string, message: RegExp, restore: string) => {
      await page.getByTestId(testId).fill(value)
      await page.getByTestId('pemfc-study-run').click()
      await expect(page.getByTestId('pemfc-study-error')).toContainText(message)
      expect(settlements).toHaveLength(0)
      await page.getByTestId(testId).fill(restore)
    }

    await rejectLocally('pemfc-temperature', '250', /T \(K\).*finite and in/i, '353.15')
    await rejectLocally('pemfc-hydrogen-pressure', '0', /pH2 \(atm\).*finite and in/i, '1')
    await rejectLocally('pemfc-exchange-current', '0', /j0 \(A\/cm\^2\).*finite and in/i, '0.0001')
    await rejectLocally('pemfc-transfer-coefficient', '0', /alpha.*finite and in/i, '0.5')
    await rejectLocally('pemfc-resistance', '-0.1', /R \(ohm cm\^2\).*finite and in/i, '0.05')
    await rejectLocally('pemfc-limiting-current', '0', /jLim \(A\/cm\^2\).*finite and in/i, '2')

    await rejectLocally('pemfc-points', '1', /points.*finite and in/i, '21')
    await rejectLocally('pemfc-points', '2.5', /points must be an integer/i, '21')

    await rejectLocally('pemfc-operating-current', '0.00001', /j must be zero or at least j0 for the Tafel model/i, '0.5')

    await page.getByTestId('pemfc-operating-current').fill('0')
    await page.getByTestId('pemfc-max-current').fill('0.001')
    await page.getByTestId('pemfc-study-run').click()
    await expect(page.getByTestId('pemfc-study-error')).toContainText(/first positive curve sample must be at least j0 for the Tafel model/i)
    expect(settlements).toHaveLength(0)
  })
})
