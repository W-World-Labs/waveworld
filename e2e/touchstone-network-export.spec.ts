import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('waveworld-locale', 'en'))
})

function pair(port: number, row: number, col: number) {
  return [Number(`${port}${row}${col}`) / 1000, Number(`${port}${row}${col}`) / 10000] as const
}

function complex(port: number, row: number, col: number) {
  const [re, im] = pair(port, row, col)
  return { re, im }
}

function touchstoneFixture(ports: number, pointCount = 2) {
  const records: string[] = []
  for (let frequency = 1; frequency <= pointCount; frequency += 1) {
    if (ports <= 2) {
      const coordinates: Array<[number, number]> = ports === 2
        ? [[1, 1], [2, 1], [1, 2], [2, 2]]
        : [[1, 1]]
      const values = coordinates.flatMap(([row, col]) => pair(frequency, row, col))
      records.push(`${frequency} ${values.join(' ')}`)
      continue
    }

    for (let row = 1; row <= ports; row += 1) {
      const values = Array.from({ length: ports }, (_, index) => pair(frequency, row, index + 1))
      for (let start = 0; start < values.length; start += 4) {
        const chunk = values.slice(start, start + 4).flat()
        const startsRecord = row === 1 && start === 0
        records.push(`${startsRecord ? `${frequency} ` : ''}${chunk.join(' ')}`)
      }
    }
  }
  return `# GHz S RI R 50\n${records.join('\n')}`
}

function expectedSweep(ports: number) {
  return [1, 2].map((frequency) => {
    const cells = Array.from({ length: ports * ports }, (_, index) => complex(frequency, Math.floor(index / ports) + 1, index % ports + 1))
    if (ports === 1) return cells[0]
    return Array.from({ length: ports }, (_, row) => cells.slice(row * ports, (row + 1) * ports))
  })
}

function nativeResult(input: Record<string, unknown>) {
  const ports = input.ports as number
  const freqUnit = input.freqUnit as string
  const format = input.format as string
  const ref = input.ref as number
  const freqs = input.freqs as number[]
  const scale = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }[freqUnit as 'HZ' | 'KHZ' | 'MHZ' | 'GHZ']
  const optionText = `# ${freqUnit} S ${format} R ${ref}`
  const rowsPerPoint = ports > 2 ? ports : 1
  const dataLines = freqs.flatMap(frequency => Array.from({ length: rowsPerPoint }, (_, row) => {
    const pairCount = ports > 2 ? ports : ports * ports
    const pairs = Array.from({ length: pairCount }, () => format === 'DB' ? '-20 0' : '0.1 0')
    return `${row === 0 ? `${frequency / scale} ` : ''}${pairs.join(' ')}`
  }))
  const touchstone = [`! synthetic native result`, optionText, ...dataLines].join('\n') + '\n'
  const lines = touchstone.trimEnd().split('\n').length
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1 },
    moduleResult: {
      module: 'sw-ansys-touchstone',
      familyId: 'method-ansys-touchstone',
      methodId: 'method-algo-touchstone-export',
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      touchstone,
      ports,
      param: 'S',
      format,
      freqUnit,
      ref,
      nPoints: freqs.length,
      freqMinHz: freqs[0],
      freqMaxHz: freqs[freqs.length - 1],
      bytes: new TextEncoder().encode(touchstone).byteLength,
      lines,
      ok: true,
    },
  }
}

async function mockJobs(page: Page) {
  const submissions: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { user: { id: 'test-user' } } }))
  await page.route(/\/api\/v1\/jobs(?:\/|$)/, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/host-api/, '')
    if (request.method() === 'POST' && path === '/api/v1/jobs') {
      const body = request.postDataJSON() as { spec: Record<string, unknown> }
      submissions.push(body.spec)
      await route.fulfill({ status: 202, json: { job: { id: `touchstone-network-${submissions.length}` } } })
      return
    }
    if (request.method() === 'GET') {
      const spec = submissions.at(-1)
      const input = (spec?.model as { inline: Record<string, unknown> }).inline
      await route.fulfill({ status: 200, json: { job: { status: 'succeeded', result: nativeResult(input) } } })
      return
    }
    await route.fallback()
  })
  return submissions
}

test.describe('CST Touchstone complete-network export', () => {
  test('preserves the full imported matrix in supported native jobs and exports selected options with provenance', async ({ page }) => {
    const submissions = await mockJobs(page)
    await page.goto('/cst')

    for (let ports = 1; ports <= 4; ports += 1) {
      await page.getByTestId('touchstone-file').setInputFiles({
        name: `matrix.s${ports}p`,
        mimeType: 'text/plain',
        buffer: Buffer.from(touchstoneFixture(ports)),
      })
      await expect(page.getByTestId('touchstone-preview')).toContainText(`${ports}-port`)
      await page.getByTestId('touchstone-network-frequency-unit').selectOption(ports === 4 ? 'MHZ' : 'GHZ')
      await page.getByTestId('touchstone-network-format').selectOption(ports === 4 ? 'DB' : 'RI')
      await expect(page.getByTestId('touchstone-network-reference')).toContainText('R 50 Ω')

      await page.getByTestId('touchstone-network-export').click()
      await expect(page.getByTestId('touchstone-network-result')).toBeVisible()
      expect(submissions).toHaveLength(ports)

      const submitted = submissions[ports - 1] as {
        kind: string
        name: string
        parameters: { module: string }
        model: { source: string; inline: Record<string, unknown> }
        run: { maxSteps: number }
        requirements: { backends: string[] }
      }
      expect(submitted).toMatchObject({
        kind: 'waveworld-module',
        name: 'sw-ansys-touchstone',
        parameters: { module: 'sw-ansys-touchstone' },
        model: { source: 'inline' },
        run: { maxSteps: 1 },
        requirements: { backends: ['cuda'] },
      })
      expect(submitted.model.inline).toEqual({
        module: 'sw-ansys-touchstone',
        backend: 'host',
        method: 'touchstone',
        ports,
        freqUnit: ports === 4 ? 'MHZ' : 'GHZ',
        param: 'S',
        format: ports === 4 ? 'DB' : 'RI',
        ref: 50,
        freqs: [1e9, 2e9],
        sweep: expectedSweep(ports),
      })
      if (ports === 2) {
        const sweep = submitted.model.inline.sweep as Array<Array<Array<{ re: number; im: number }>>>
        expect(sweep[0]).toEqual([
          [complex(1, 1, 1), complex(1, 1, 2)],
          [complex(1, 2, 1), complex(1, 2, 2)],
        ])
        expect(sweep[0][0][1]).not.toEqual(sweep[0][1][0])
      }
      await expect(page.getByTestId('touchstone-network-result')).toContainText('w-sim-cuda-host')
      await expect(page.getByTestId('touchstone-network-result')).toContainText('method-algo-touchstone-export')

      const downloadPromise = page.waitForEvent('download')
      await page.getByTestId('touchstone-network-download').click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe(`network-${ports}port.s${ports}p`)
      const content = await readFile((await download.path())!, 'utf8')
      expect(content).toContain(`# ${ports === 4 ? 'MHZ S DB R 50' : 'GHZ S RI R 50'}`)
      expect(content.trim().split('\n')).toHaveLength(2 + (ports > 2 ? ports : 1) * 2)
    }
  })

  test('continues importing 5–8 ports while explaining native export limits without submitting a job', async ({ page }) => {
    const submissions = await mockJobs(page)
    await page.goto('/cst')

    for (let ports = 5; ports <= 8; ports += 1) {
      await page.getByTestId('touchstone-file').setInputFiles({
        name: `large-matrix.s${ports}p`,
        mimeType: 'text/plain',
        buffer: Buffer.from(touchstoneFixture(ports)),
      })
      await expect(page.getByTestId('touchstone-preview')).toContainText(`${ports}-port`)
      await expect(page.getByTestId('touchstone-preview')).toContainText('2 points')
      await expect(page.getByTestId('touchstone-analyze')).toBeEnabled()
      await expect(page.getByTestId('touchstone-network-limit')).toContainText(/Complete network export supports up to 4 ports/)
      await expect(page.getByTestId('touchstone-network-export')).toBeDisabled()
      expect(submissions).toHaveLength(0)
    }
  })

  test('blocks an over-budget complete-network export while leaving imported S11 analysis available', async ({ page }) => {
    const submissions = await mockJobs(page)
    await page.goto('/cst')
    await page.getByTestId('touchstone-file').setInputFiles({
      name: 'budget-limit.s4p',
      mimeType: 'text/plain',
      buffer: Buffer.from(touchstoneFixture(4, 513)),
    })

    await expect(page.getByTestId('touchstone-preview')).toContainText('513 points')
    await expect(page.getByTestId('touchstone-network-budget-limit')).toContainText(/8192 matrix elements/)
    await expect(page.getByTestId('touchstone-network-budget-limit')).toContainText(/4-port networks allow at most 512 points/)
    await expect(page.getByTestId('touchstone-network-export')).toBeDisabled()
    await expect(page.getByTestId('touchstone-analyze')).toBeEnabled()
    expect(submissions).toHaveLength(0)
  })
})
