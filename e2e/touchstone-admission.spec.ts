import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

const twoPort75Ohm = [
  '! measured-like fixture for Touchstone admission coverage',
  '# GHz S RI R 75',
  '1 0.2 0 0.8 0 0.7 0 0.1 0',
].join('\n')

async function mockSuccessfulSweep(page: Page, submitted: Array<Record<string, unknown>>) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      submitted.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 202, json: { job: { id: 'touchstone-job-1' } } })
      return
    }
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          job: {
            status: 'succeeded',
            result: {
              schemaVersion: 1,
              status: 'succeeded',
              summary: { steps: 1 },
              moduleResult: {
                module: 'vswr',
                operation: 'cst-s11-vswr-sweep',
                backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
                result: {
                  sampleCount: 1,
                  points: [{
                    frequencyHz: 1e9,
                    s11: [0.2, 0],
                    magnitude: 0.2,
                    vswr: 1.5,
                    returnLossDb: 13.979400086720375,
                    reflectedPowerFraction: 0.04,
                  }],
                  maxVswr: 1.5,
                  meanReflectedPowerFraction: 0.04,
                },
              },
            },
          },
        },
      })
      return
    }
    await route.fallback()
  })
}

test.describe('CST Touchstone admission', () => {
  test('rejects malformed Touchstone and unsupported extensions before any job submission', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockSuccessfulSweep(page, submitted)
    await page.goto('/cst')
    const file = page.getByTestId('touchstone-file')

    await file.setInputFiles({
      name: 'touchstone2.s2p',
      mimeType: 'text/plain',
      buffer: Buffer.from('[Version] 2.0\n# GHz S RI R 50\n[Number of Ports] 2\n[Noise Data]'),
    })
    await expect(page.getByTestId('touchstone-error')).toContainText(/Unsupported Touchstone 2\.x keyword or section "Noise Data"/)
    await expect(page.getByTestId('touchstone-analyze')).toBeDisabled()

    await file.setInputFiles({
      name: 'unsupported.s9p',
      mimeType: 'text/plain',
      buffer: Buffer.from('# GHz S RI R 50\n1 0.2 0 0.8 0 0.7 0 0.1 0'),
    })
    await expect(page.getByTestId('touchstone-error')).toContainText(/Choose a \.s1p through \.s8p file or a Touchstone 2\.x \.ts file with declared port metadata/)
    await expect(page.getByTestId('touchstone-preview')).toHaveCount(0)
    await expect(page.getByTestId('touchstone-analyze')).toBeDisabled()
    expect(submitted).toHaveLength(0)
  })

  for (const [label, s11Real] of [['active', '1.2'], ['total reflection', '1']] as const) {
    test(`parses ${label} S11 locally, then explains why VSWR analysis is unavailable`, async ({ page }) => {
      const submitted: Array<Record<string, unknown>> = []
      await mockSuccessfulSweep(page, submitted)
      await page.goto('/cst')
      await page.getByTestId('touchstone-file').setInputFiles({
        name: `${label.replaceAll(' ', '-')}.s1p`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`# GHz S RI R 50\n1 ${s11Real} 0`),
      })

      await expect(page.getByTestId('touchstone-preview')).toContainText('1-port')
      await expect(page.getByTestId('touchstone-analyze')).toBeEnabled()
      await page.getByTestId('touchstone-analyze').click()
      await expect(page.getByTestId('touchstone-error')).toContainText(/S11 magnitude at point 0 must be less than one for VSWR/)
      await expect(page.getByTestId('touchstone-analyze')).toBeEnabled()
      expect(submitted).toHaveLength(0)
    })
  }

  test('preserves two-port metadata and 75 Ω reference while analyzing unrenormalized S11', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockSuccessfulSweep(page, submitted)
    await page.goto('/cst')
    await page.getByTestId('touchstone-file').setInputFiles({
      name: 'fixture.s2p',
      mimeType: 'text/plain',
      buffer: Buffer.from(twoPort75Ohm),
    })

    const preview = page.getByTestId('touchstone-preview')
    await expect(preview).toContainText('2-port')
    await expect(preview).toContainText('RI')
    await expect(preview).toContainText('GHz')
    await expect(preview).toContainText('R 75 Ω')
    await expect(preview).toContainText('S11 only')

    await page.getByTestId('touchstone-analyze').click()
    const results = page.getByTestId('touchstone-results')
    await expect(results).toBeVisible()
    await expect(results).toContainText('common reference impedance 75 Ω · no renormalization applied')
    await expect(results).toContainText('w-sim-cuda-host')
    await expect(results).toContainText('13.9794')
    await expect(results.locator('tbody')).toContainText('0.2')
    expect(submitted).toHaveLength(1)
    const spec = submitted[0].spec as { model: { inline: Record<string, unknown> } }
    expect(spec.model.inline).toMatchObject({
      operation: 'cst-s11-vswr-sweep',
      frequenciesHz: [1e9],
      s11: [[0.2, 0]],
    })
    expect(spec.model.inline).not.toHaveProperty('referenceOhms')
  })
})
