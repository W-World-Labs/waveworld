import { expect, test, type Page, type Route } from '@playwright/test'

const jobId = 'exchanger-ua-study-e2e'

type InlineInput = {
  module: 'sw-openmodelica-heat-exchanger'
  backend: 'host'
  dynamic: false
  arrangement: 'counterflow' | 'parallel'
  Chot: number
  Ccold: number
  T_hot_in: number
  T_cold_in: number
  sweep_UA: number[]
}

function nativeResult(input: InlineInput) {
  const Cmin = Math.min(input.Chot, input.Ccold)
  const Cmax = Math.max(input.Chot, input.Ccold)
  const Cr = Cmin / Cmax
  const cases = input.sweep_UA.map(UA => {
    const NTU = UA / Cmin
    const effectiveness = input.arrangement === 'parallel'
      ? (1 - Math.exp(-NTU * (1 + Cr))) / (1 + Cr)
      : NTU / (1 + NTU)
    const Q = effectiveness * Cmin * (input.T_hot_in - input.T_cold_in)
    const T_hot_out = input.T_hot_in - Q / input.Chot
    const T_cold_out = input.T_cold_in + Q / input.Ccold
    return {
      model: 'steady-effectiveness-NTU',
      arrangement: input.arrangement,
      Chot: input.Chot,
      Ccold: input.Ccold,
      UA,
      Cmin,
      Cmax,
      Cr,
      NTU,
      effectiveness,
      T_hot_in: input.T_hot_in,
      T_cold_in: input.T_cold_in,
      Q,
      T_hot_out,
      T_cold_out,
      hotLoss: Q,
      coldGain: Q,
      energyBalance: 'hotLoss == coldGain == Q',
      methodId: 'method-algo-sw-openmodelica-heat-exchanger',
      familyId: 'method-sw-openmodelica-heat-exchanger',
    }
  })

  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      ok: true,
      module: 'sw-openmodelica-heat-exchanger',
      backend: 'w-sim-cuda-host',
      result: {
        model: 'steady-effectiveness-NTU-UA-parameter-sweep',
        parameter: 'UA',
        cases,
        methodId: 'method-algo-sw-openmodelica-heat-exchanger',
        familyId: 'method-sw-openmodelica-heat-exchanger',
      },
    },
  }
}

async function mockAuthenticatedHost(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'exchanger-e2e-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      submissions.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 202, json: { job: { id: jobId } } })
      return
    }
    if (request.method() === 'GET' && path.endsWith(`/${jobId}`)) {
      const submission = submissions.at(-1) as { spec?: { model?: { inline?: InlineInput } } } | undefined
      const input = submission?.spec?.model?.inline
      if (!input) {
        await route.fulfill({ status: 500, json: { error: 'mock expected a submitted exchanger input' } })
        return
      }
      await route.fulfill({ status: 200, json: { job: { id: jobId, status: 'succeeded', result: nativeResult(input) } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

async function openDymola(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
  await page.goto('/dymola')
}

test.describe('Dymola bounded exchanger UA admission', () => {
  test('previews linear and logarithmic sampling and rejects invalid point counts without submitting', async ({ page }) => {
    const submissions = await mockAuthenticatedHost(page)
    await openDymola(page)

    const preview = page.locator('fieldset').filter({ has: page.getByTestId('exchanger-ua-spacing') }).locator('output')
    await expect(preview).toContainText('100 W/K, 200 W/K, 300 W/K')

    await page.getByTestId('exchanger-ua-start').fill('100')
    await page.getByTestId('exchanger-ua-end').fill('400')
    await page.getByTestId('exchanger-ua-spacing').selectOption('log')
    const logarithmicSamples = (await preview.textContent())!.match(/[\d.]+(?= W\/K)/g)!.map(Number)
    expect(logarithmicSamples).toHaveLength(3)
    expect(logarithmicSamples[0]).toBeCloseTo(100, 10)
    expect(logarithmicSamples[1]).toBeCloseTo(200, 10)
    expect(logarithmicSamples[2]).toBeCloseTo(400, 10)

    await page.getByTestId('exchanger-ua-points').fill('64')
    await expect(preview).toBeVisible()
    await expect(preview).not.toContainText('Invalid')
    const samplesAtLimit = (await preview.textContent())!.split(', ')
    expect(samplesAtLimit).toHaveLength(64)

    for (const invalidPoints of ['1', '65', '2.5', '']) {
      await page.getByTestId('exchanger-ua-points').fill(invalidPoints)
      await page.getByTestId('exchanger-study-run').click()
      await expect(page.getByTestId('exchanger-study-error')).toBeVisible()
      expect(submissions).toHaveLength(0)
    }
  })

  test('rejects invalid capacity, temperature, blank, and UA range fields before submission', async ({ page }) => {
    const submissions = await mockAuthenticatedHost(page)
    await openDymola(page)

    const rejectWithoutSubmission = async () => {
      await page.getByTestId('exchanger-study-run').click()
      await expect(page.getByTestId('exchanger-study-error')).toBeVisible()
      expect(submissions).toHaveLength(0)
    }

    await page.getByTestId('exchanger-hot-capacity').fill('0')
    await rejectWithoutSubmission()
    await page.getByTestId('exchanger-hot-capacity').fill('100')

    await page.getByTestId('exchanger-hot-inlet').fill('290')
    await rejectWithoutSubmission()
    await page.getByTestId('exchanger-hot-inlet').fill('363.15')

    await page.getByTestId('exchanger-cold-capacity').fill('')
    await rejectWithoutSubmission()
    await page.getByTestId('exchanger-cold-capacity').fill('100')

    await page.getByTestId('exchanger-ua-start').fill('400')
    await page.getByTestId('exchanger-ua-end').fill('300')
    await rejectWithoutSubmission()
    await page.getByTestId('exchanger-ua-start').fill('')
    await rejectWithoutSubmission()
  })

  test('submits a valid parallel log sweep and displays only the mocked native cases', async ({ page }) => {
    const submissions = await mockAuthenticatedHost(page)
    await openDymola(page)

    await page.getByTestId('exchanger-arrangement').selectOption('parallel')
    await page.getByTestId('exchanger-ua-start').fill('100')
    await page.getByTestId('exchanger-ua-end').fill('400')
    await page.getByTestId('exchanger-ua-points').fill('3')
    await page.getByTestId('exchanger-ua-spacing').selectOption('log')
    await page.getByTestId('exchanger-study-run').click()

    await expect(page.getByTestId('exchanger-study-results')).toBeVisible()
    await expect(page.getByTestId('exchanger-study-status')).toContainText(`succeeded · Job ${jobId}`)
    await expect(page.getByTestId('exchanger-study-table').locator('tbody tr')).toHaveCount(3)
    expect(submissions).toHaveLength(1)

    const body = submissions[0] as {
      spec: {
        kind: string
        name: string
        run: { maxSteps: number }
        requirements: { backends: string[] }
        model: { inline: InlineInput }
      }
    }
    expect(body.spec.kind).toBe('waveworld-module')
    expect(body.spec.name).toBe('sw-openmodelica-heat-exchanger')
    expect(body.spec.run).toEqual({ maxSteps: 1 })
    expect(body.spec.requirements).toEqual({ backends: ['cuda'] })
    expect(body.spec.model.inline).toMatchObject({
      module: 'sw-openmodelica-heat-exchanger',
      backend: 'host',
      dynamic: false,
      arrangement: 'parallel',
      Chot: 100,
      Ccold: 100,
      T_hot_in: 363.15,
      T_cold_in: 293.15,
    })
    expect(body.spec.model.inline.sweep_UA).toHaveLength(3)
    expect(body.spec.model.inline.sweep_UA[0]).toBe(100)
    expect(body.spec.model.inline.sweep_UA[1]).toBeCloseTo(200, 10)
    expect(body.spec.model.inline.sweep_UA[2]).toBe(400)
    await expect(page.getByTestId('exchanger-study-results')).toContainText('Native host-f64 (CPU)')
  })
})
