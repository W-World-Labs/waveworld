// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EpwFileSelection, type EpwFileSelection as Selection } from './EpwFileSelection'
import { EpwWeatherResults, type EpwWeatherResult, type EpwWeatherSource } from './EpwWeatherResults'
import { EPW_MAX_FILE_BYTES, preflightEpwNativeGaps, readEpwFile } from '../../lib/epw-validation'

let roots: Root[] = []
let containers: HTMLElement[] = []

function mount(element: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, element)))
  return container
}

function chooseFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing EPW file input')
  act(() => {
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

const result: EpwWeatherResult = {
  ok: true,
  backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'CPU' },
  module: 'sw-energyplus-epw',
  method: 'method-epw-parse',
  location: { city: 'Synthetic Station', latitude: 40, longitude: -105 },
  leapYear: false,
  designConditionCount: 0,
  typicalExtremePeriodCount: 0,
  groundTemperatures: { depths: [], monthly: [] },
  dataPeriods: { count: 1, recordsPerHour: 1, periods: [] },
  rowCount: 1,
  annualComplete: false,
  variables: [],
  summaries: { dryBulb: { mean: 5, min: 5, max: 5 } },
}

const source: EpwWeatherSource = {
  identity: { name: 'synthetic.epw', sizeBytes: 100, lastModifiedMs: 1_700_000_000_000, mediaType: 'text/plain' },
  provenance: { kind: 'local-file-picker', relativePath: 'weather/synthetic.epw' },
  sha256: 'a'.repeat(64),
}

const epwHeaders = [
  'LOCATION,Synthetic,Test,US,TMY,123,40,-105,-7,1600',
  'DESIGN CONDITIONS,0',
  'TYPICAL/EXTREME PERIODS,0',
  'GROUND TEMPERATURES,0',
  'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
  'COMMENTS1,synthetic test input',
  'COMMENTS2,not vendor data',
  'DATA PERIODS,1,1,Data,Sunday,1/1,12/31',
]

function epwRecord(overrides: Record<number, string | number> = {}) {
  const fields: Array<string | number> = [2024, 1, 1, 1, 60, '0', ...Array<number>(29).fill(0)]
  for (const [column, value] of Object.entries(overrides)) fields[Number(column)] = value
  return fields.join(',')
}

describe('EnergyPlus EPW weather-file workflow', () => {
  it('reads bounded file bytes unchanged and retains source metadata', async () => {
    const raw = 'EPW raw text\r\nwith exact line endings'
    const file = new File([raw], 'station.epw', { type: 'text/plain', lastModified: 1234 })

    const imported = await readEpwFile(file)

    expect(imported.text).toBe(raw)
    expect(imported.source).toEqual({
      name: 'station.epw',
      sizeBytes: file.size,
      mediaType: 'text/plain',
      lastModified: 1234,
    })
  })

  it('rejects an oversized file before reading its text', async () => {
    const file = new File(['x'], 'oversized.epw')
    Object.defineProperty(file, 'size', { value: EPW_MAX_FILE_BYTES + 1 })
    const readText = vi.spyOn(file, 'text')

    await expect(readEpwFile(file)).rejects.toThrow(/EPW file exceeds/)
    expect(readText).not.toHaveBeenCalled()
  })

  it('rejects EPW missing-value sentinels before handing raw text to the native parser', () => {
    const text = [...epwHeaders, epwRecord({ 6: 99.9 })].join('\n')
    expect(() => preflightEpwNativeGaps(text)).toThrow(/EPW line 9: field 7 is missing/)
  })

  it('keeps legitimate bounded TMY chronology valid and rejects duplicate timestamps', () => {
    const januaryEnd = epwRecord({ 0: 2001, 1: 1, 2: 31, 3: 24 })
    const februaryStart = epwRecord({ 0: 2004, 1: 2, 2: 1, 3: 1 })
    expect(() => preflightEpwNativeGaps([...epwHeaders, januaryEnd, februaryStart].join('\n'))).not.toThrow()
    expect(() => preflightEpwNativeGaps([...epwHeaders, januaryEnd, januaryEnd].join('\n'))).toThrow(/hourly timestamps must be contiguous/)
    expect(() => preflightEpwNativeGaps([...epwHeaders, januaryEnd, epwRecord({ 1: 2, 2: 1, 3: 3 })].join('\n'))).toThrow(/hourly timestamps must be contiguous/)
  })

  it('passes selected raw EPW files and local provenance to its caller without parsing', () => {
    const onSelectionChange = vi.fn<(files: Selection[]) => void>()
    const container = mount(createElement(EpwFileSelection, { onSelectionChange }))
    const file = new File(['raw EPW bytes, untouched'], 'synthetic.epw', { type: 'text/plain', lastModified: 123 })

    chooseFiles(container, [file])

    expect(onSelectionChange).toHaveBeenCalledOnce()
    const selected = onSelectionChange.mock.calls[0]?.[0]?.[0]
    expect(selected?.file).toBe(file)
    expect(selected?.identity).toMatchObject({ name: 'synthetic.epw', sizeBytes: file.size, lastModifiedMs: 123, mediaType: 'text/plain' })
    expect(selected?.provenance).toEqual({ kind: 'local-file-picker', relativePath: null })
    expect(container.textContent).toContain('Files are passed to the caller without parsing')
  })

  it('rejects non-EPW files and more than four files before handoff', () => {
    const onSelectionChange = vi.fn<(files: Selection[]) => void>()
    const container = mount(createElement(EpwFileSelection, { onSelectionChange }))

    chooseFiles(container, [new File(['x'], 'weather.csv')])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not an .epw file')
    expect(onSelectionChange).toHaveBeenLastCalledWith([])

    chooseFiles(container, Array.from({ length: 5 }, (_, i) => new File(['x'], `${i}.epw`)))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('at most 4')
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })

  it('shows native summaries, provenance, and incomplete-annual status while stating the workflow boundary', () => {
    const container = mount(createElement(EpwWeatherResults, { result, source }))

    expect(container.querySelector('[data-testid="epw-weather-results"]')?.textContent).toContain('w-sim-cuda-host')
    expect(container.textContent).toContain('method-epw-parse')
    expect(container.textContent).toContain('local-file-picker: weather/synthetic.epw')
    expect(container.textContent).toContain('Incomplete')
    expect(container.textContent).toContain('This view does not calculate building loads, energy use, or weather time-series values')
    expect(container.querySelector('[data-testid="epw-weather-summary-table"]')?.textContent).toContain('dryBulb')
  })

  it('exports the returned weather result with source provenance and an explicit no-building-results scope', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:epw-report')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const container = mount(createElement(EpwWeatherResults, { result, source }))

    act(() => container.querySelector('[data-testid="epw-weather-download-json"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    const report = JSON.parse(await blob.text()) as Record<string, any>
    expect(report).toMatchObject({
      reportType: 'energyplus-epw-weather-stage',
      source: { identity: { name: 'synthetic.epw' }, provenance: { kind: 'local-file-picker', relativePath: 'weather/synthetic.epw' } },
      result: { module: 'sw-energyplus-epw', method: 'method-epw-parse', annualComplete: false, rowCount: 1 },
    })
    expect(report.scope).toMatch(/no building energy simulation results/)
    expect(click).toHaveBeenCalledOnce()
  })
})
