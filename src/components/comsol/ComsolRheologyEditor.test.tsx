// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComsolRheologyEditor } from './ComsolRheologyEditor'
import { createDefaultComsolRheologyDraft, type ComsolRheologyDraft } from '../../lib/sim/comsol-rheology-input'

let roots: Root[] = []
let containers: HTMLElement[] = []

function render(options: { draft?: ComsolRheologyDraft; disabled?: boolean } = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const onChange = vi.fn<(draft: ComsolRheologyDraft) => void>()
  const onSubmit = vi.fn<() => void>()
  act(() => root.render(createElement(LocaleProvider, null, createElement(ComsolRheologyEditor, {
    value: options.draft ?? createDefaultComsolRheologyDraft(), onChange, onSubmit, disabled: options.disabled,
  }))))
  return { container, onChange, onSubmit }
}

function control<T extends HTMLElement>(container: HTMLElement, name: string): T {
  const element = container.querySelector(`[aria-label="${name}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`missing control: ${name}`)
  return element as T
}

function changeValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function submit(container: HTMLElement) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === 'Validate and apply rheology model')
  if (!(button instanceof HTMLElement)) throw new Error('missing validation button')
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
})

describe('COMSOL rheology editor', () => {
  it('shows model-specific fields and emits controlled model changes', () => {
    const { container, onChange } = render()
    expect(Array.from(control<HTMLSelectElement>(container, 'Rheology model').options).map(option => option.value)).toEqual([
      'newtonian', 'power-law', 'carreau', 'bingham', 'herschel-bulkley',
    ])
    expect(control<HTMLInputElement>(container, 'Consistency index K (Pa·sⁿ)')).toBeTruthy()
    expect(container.querySelector('[aria-label="Dynamic viscosity (Pa·s)"]')).toBeNull()

    changeValue(control<HTMLSelectElement>(container, 'Rheology model'), 'newtonian')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'newtonian' }))
  })

  it('parses the app one-column CSV and retains its text in the controlled draft', () => {
    const { container, onChange } = render()
    changeValue(control<HTMLTextAreaElement>(container, 'Shear-rate CSV (one column)'), 'shearRate\n0\n0.5\n20')

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      csv: 'shearRate\n0\n0.5\n20',
      shearRates: [0, 0.5, 20],
    }))
  })

  it('validates a supported draft before requesting submission', () => {
    const { container, onSubmit } = render()
    submit(container)

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('validated and submitted')
  })

  it('rejects invalid CSV and clears stale parsed points', () => {
    const { container, onChange } = render()
    changeValue(control<HTMLTextAreaElement>(container, 'Shear-rate CSV (one column)'), 'shearRate,extra\n1,2')

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ csv: 'shearRate,extra\n1,2', shearRates: [] }))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('exactly one')
  })

  it('disables its controls while the study is running', () => {
    const { container } = render({ disabled: true })

    expect(control<HTMLSelectElement>(container, 'Rheology model').disabled).toBe(true)
    expect(control<HTMLTextAreaElement>(container, 'Shear-rate CSV (one column)').disabled).toBe(true)
    expect(Array.from(container.querySelectorAll('button')).every(button => button.disabled)).toBe(true)
  })
})
