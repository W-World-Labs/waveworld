// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComsolMaterialTableEditor, type ComsolMaterialTableSnapshot } from './ComsolMaterialTableEditor'

let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const onSubmit = vi.fn<(snapshot: ComsolMaterialTableSnapshot) => void>()
  act(() => root.render(createElement(LocaleProvider, null, createElement(ComsolMaterialTableEditor, { onSubmit }))))
  return { container, onSubmit }
}

function control<T extends HTMLElement>(container: HTMLElement, name: string): T {
  const element = container.querySelector(`[aria-label="${name}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`missing control: ${name}`)
  return element as T
}

function changeValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function submit(container: HTMLElement) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === 'Validate and apply table')
  if (!(button instanceof HTMLElement)) throw new Error('missing validation button')
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
})

describe('COMSOL material table editor', () => {
  it('submits parsed rows and selected property evaluation settings', () => {
    const { container, onSubmit } = render()
    changeValue(control<HTMLTextAreaElement>(container, 'CSV text'), [
      'temperature_K,specific_heat_J_per_kgK',
      '280,410',
      '320,430',
    ].join('\n'))
    changeValue(control<HTMLSelectElement>(container, 'Material property'), 'specificHeat')
    changeValue(control<HTMLInputElement>(container, 'Evaluation temperature (K)'), '300')
    changeValue(control<HTMLSelectElement>(container, 'Interpolation'), 'pchip')
    changeValue(control<HTMLSelectElement>(container, 'Extrapolation'), 'linear')
    submit(container)

    expect(onSubmit).toHaveBeenCalledWith({
      propertyKind: 'specificHeat',
      meaning: 'Specific heat capacity',
      unit: 'J/(kg·K)',
      rows: [{ temperatureK: 280, value: 410 }, { temperatureK: 320, value: 430 }],
      evaluationTemperatureK: 300,
      interpolation: 'pchip',
      extrapolation: 'linear',
      csv: 'temperature_K,specific_heat_J_per_kgK\n280,410\n320,430',
    })
    expect(container.querySelector('[role="status"]')?.textContent).toContain('validated and submitted')
  })

  it('rejects a CSV property column that differs from the selected material property', () => {
    const { container, onSubmit } = render()
    changeValue(control<HTMLTextAreaElement>(container, 'CSV text'), 'temperature_K,conductivity_W_per_mK\n280,12\n320,10')
    changeValue(control<HTMLSelectElement>(container, 'Material property'), 'specificHeat')
    submit(container)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match')
  })

  it('rejects nonpositive or nonfinite evaluation temperatures', () => {
    const { container, onSubmit } = render()
    changeValue(control<HTMLTextAreaElement>(container, 'CSV text'), 'temperature_K,conductivity_W_per_mK\n280,12\n320,10')
    changeValue(control<HTMLInputElement>(container, 'Evaluation temperature (K)'), '0')
    submit(container)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('above 0 K')
  })
})
