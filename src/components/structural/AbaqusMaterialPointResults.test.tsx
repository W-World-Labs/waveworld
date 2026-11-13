// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AbaqusMaterialPointResults, type AbaqusMaterialPointInput } from './AbaqusMaterialPointResults'
import { parseAbaqusMaterialPointResult } from '../../lib/sim/abaqus-material-point-result'

const input: AbaqusMaterialPointInput = {
  module: 'sw-calculix-plasticity', E: 210e9, nu: 0.3, yieldStress: 250e6,
  hardeningCurve: [[0, 250e6], [0.1, 300e6]], strainIncrements: [[0.001, 0, 0, 0, 0, 0], [0.002, 0, 0, 0, 0, 0]],
}
const history = [0, 1].map((step) => ({
  step, totalStrain: [0.001 * step, 0, 0, 0, 0, 0], stress: [210e6, 0, 0, 0, 0, 0],
  plasticStrain: [0.0001 * (step + 1), 0, 0, 0, 0, 0], equivalentPlasticStrain: 0.0001 * (step + 1),
  vonMises: 210e6, yielded: step === 1,
}))
const raw = { module: 'sw-calculix-plasticity', history, summary: { steps: 2, yieldedSteps: 1, finalEquivalentPlasticStrain: 0.0002, finalVonMises: 210e6 }, diagnostic: 'ignored' }
const result = parseAbaqusMaterialPointResult(raw, 2)

let roots: Root[] = []
let containers: HTMLElement[] = []
afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  for (const container of containers) container.remove()
  containers = []
  vi.restoreAllMocks()
})

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(AbaqusMaterialPointResults, { result, input, jobId: 'job-material-1' }))))
  return container
}

describe('Abaqus material-point result', () => {
  it('validates complete sequential history and ignores unrelated output fields', () => {
    expect(result.history).toHaveLength(2)
    expect(result.module).toBe('sw-calculix-plasticity')
    expect(result.summary.yieldedSteps).toBe(1)
    expect(() => parseAbaqusMaterialPointResult({ ...raw, history: history.slice(0, 1) }, 2)).toThrow(/length/i)
    expect(() => parseAbaqusMaterialPointResult({ ...raw, module: 'other' }, 2)).toThrow(/module/i)
    expect(() => parseAbaqusMaterialPointResult({ ...raw, history: [{ ...history[0], step: 1 }, history[1]] }, 2)).toThrow(/sequential/i)
    expect(() => parseAbaqusMaterialPointResult({ ...raw, summary: { ...raw.summary, steps: 1 } }, 2)).toThrow(/summary/i)
    expect(() => parseAbaqusMaterialPointResult({ ...raw, history: [{ ...history[0], stress: [1, 2, 3, 4, 5, Number.NaN] }, history[1]] }, 2)).toThrow(/finite/i)
    expect(() => parseAbaqusMaterialPointResult({ ...raw, history: [{ ...history[0], plasticStrain: undefined }, history[1]] }, 2)).toThrow(/six components/i)
  })

  it('shows scope caveat, per-step history and final PEEQ and von Mises', () => {
    const container = render()
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')).not.toBeNull()
    expect(container.textContent).toContain('single material-point')
    expect(container.textContent).toContain('engineering convention')
    expect(container.textContent).toContain('11, 22, 33, 12, 13, 23')
    expect(container.textContent).toContain('PEEQ')
    expect(container.textContent).toContain('210000000')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('offers JSON and CSV downloads with the submitted job, input and result', () => {
    const create = vi.fn(() => 'blob:result')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: revoke })
    const container = render()
    for (const id of ['abaqus-material-point-results-download-json', 'abaqus-material-point-results-download-csv']) {
      const button = container.querySelector(`[data-testid="${id}"]`)
      expect(button).not.toBeNull()
      act(() => (button as HTMLButtonElement).click())
    }
    expect(create).toHaveBeenCalledTimes(2)
  })
})
