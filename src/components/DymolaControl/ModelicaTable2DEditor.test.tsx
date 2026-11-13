// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelicaTable2DEditor } from './ModelicaTable2DEditor'

let roots: Root[] = []
let containers: HTMLElement[] = []

function render(queries = [{ u1: '300', u2: '5' }]) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const props = {
    tableName: 'temperature-grid.mat',
    u1Min: 250,
    u1Max: 400,
    u2Min: 1,
    u2Max: 20,
    queries,
    extrapolation: 'hold' as const,
    onQueriesChange: vi.fn(),
    onExtrapolationChange: vi.fn(),
  }
  act(() => root.render(createElement(LocaleProvider, null, createElement(ModelicaTable2DEditor, props))))
  return { container, props }
}

function byLabel<T extends HTMLElement>(container: HTMLElement, label: string, selector: string): T {
  const labelElement = Array.from(container.querySelectorAll('label')).find(element => element.querySelector('span')?.textContent?.trim() === label)
  const element = labelElement?.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`missing labeled control: ${label}`)
  return element as T
}

function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
})

describe('Modelica 2D table editor', () => {
  it('shows table axis metadata and explicit query pairs without evaluating them', () => {
    const { container } = render()

    expect(container.textContent).toContain('temperature-grid.mat')
    expect(container.querySelector('[data-testid="modelica-table-2d-axis-ranges"]')?.textContent).toContain('u1: 250 to 400')
    expect(container.querySelector('[data-testid="modelica-table-2d-axis-ranges"]')?.textContent).toContain('u2: 1 to 20')
    expect(container.querySelector('[data-testid="modelica-table-2d-query-list"]')?.textContent).toContain('(300, 5)')
    expect(container.querySelector('[data-testid="modelica-table-2d-extrapolation"]')?.textContent).toContain('linear')
    expect(container.querySelector('[data-testid="modelica-table-2d-extrapolation"]')?.textContent).toContain('hold')
    expect(container.querySelector('[data-testid="modelica-table-2d-extrapolation"]')?.textContent).toContain('error')
  })

  it('emits finite explicit coordinate pairs and extrapolation choices through controlled callbacks', () => {
    const { container, props } = render()
    changeValue(byLabel<HTMLInputElement>(container, 'u1 query', 'input'), '3.25e2')
    changeValue(byLabel<HTMLInputElement>(container, 'u2 query', 'input'), '-1.5')
    const add = container.querySelector('[data-testid="modelica-table-u1-query-add"]')
    if (!(add instanceof HTMLElement)) throw new Error('missing Add query pair button')
    act(() => add.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    changeValue(byLabel<HTMLSelectElement>(container, 'Extrapolation', 'select'), 'error')

    expect(props.onQueriesChange).toHaveBeenCalledWith([{ u1: '300', u2: '5' }, { u1: '3.25e2', u2: '-1.5' }])
    expect(props.onExtrapolationChange).toHaveBeenCalledWith('error')
  })

  it('does not add non-finite coordinate values or more than 32 pairs', () => {
    const { container } = render(Array.from({ length: 32 }, (_, index) => ({ u1: String(index), u2: String(index) })))
    const u1 = byLabel<HTMLInputElement>(container, 'u1 query', 'input')
    const u2 = byLabel<HTMLInputElement>(container, 'u2 query', 'input')
    const add = container.querySelector('[data-testid="modelica-table-u1-query-add"]')
    if (!(add instanceof HTMLButtonElement)) throw new Error('missing Add query pair button')

    changeValue(u1, 'Infinity')
    changeValue(u2, '1')
    expect(add.disabled).toBe(true)

    expect(add.disabled).toBe(true)
  })
})
