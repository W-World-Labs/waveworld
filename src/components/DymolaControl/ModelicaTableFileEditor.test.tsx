// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelicaTableFileEditor } from './ModelicaTableFileEditor'

let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  const props = {
    tableNames: ['plant-output.mat', 'controller-output.mat'],
    tableName: 'plant-output.mat',
    outputColumn: '2',
    queries: ['0', '1.5'],
    onTableNameChange: vi.fn(),
    onOutputColumnChange: vi.fn(),
    onQueriesChange: vi.fn(),
  }

  act(() => root.render(createElement(LocaleProvider, null, createElement(ModelicaTableFileEditor, props))))
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

describe('Modelica table file editor', () => {
  it('exposes the controlled table, output column, and existing numeric queries accessibly', () => {
    const { container } = render()
    const table = byLabel<HTMLSelectElement>(container, 'Table', 'select')
    const outputColumn = byLabel<HTMLInputElement>(container, 'Output column number', 'input')

    expect(table.value).toBe('plant-output.mat')
    expect(Array.from(table.options, option => option.value)).toEqual(['', 'plant-output.mat', 'controller-output.mat'])
    expect(outputColumn.value).toBe('2')
    expect(container.querySelector('[data-testid="modelica-table-query-list"]')?.textContent).toContain('0')
    expect(container.querySelector('[data-testid="modelica-table-query-list"]')?.textContent).toContain('1.5')
  })

  it('reports table and string output-column edits, and adds a numeric query through the form', () => {
    const { container, props } = render()

    changeValue(byLabel<HTMLSelectElement>(container, 'Table', 'select'), 'controller-output.mat')
    changeValue(byLabel<HTMLInputElement>(container, 'Output column number', 'input'), '4')
    changeValue(byLabel<HTMLInputElement>(container, 'Query value', 'input'), '3.25')
    const addQuery = container.querySelector('[data-testid="modelica-table-query-add"]')
    if (!(addQuery instanceof HTMLElement)) throw new Error('missing Add query button')
    act(() => addQuery.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(props.onTableNameChange).toHaveBeenCalledWith('controller-output.mat')
    expect(props.onOutputColumnChange).toHaveBeenCalledWith('4')
    expect(props.onQueriesChange).toHaveBeenCalledWith(['0', '1.5', '3.25'])
  })
})
