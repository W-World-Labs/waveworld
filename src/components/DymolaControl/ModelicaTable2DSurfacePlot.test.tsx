// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelicaTable2DSurfacePlot } from './ModelicaTable2DSurfacePlot'

let roots: Root[] = []
let containers: HTMLElement[] = []

function render(props: Parameters<typeof ModelicaTable2DSurfacePlot>[0]) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(ModelicaTable2DSurfacePlot, props))))
  return container
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
})

describe('Modelica 2-D table surface plot', () => {
  it('renders one accessible grid cell per supplied matrix entry with source coordinates and values', () => {
    const container = render({
      xAxis: [0, 2],
      yAxis: [10, 20],
      values: [[1, 4], [3, 8]],
      label: 'Pump map',
      xLabel: 'Flow',
      yLabel: 'Speed',
      valueLabel: 'Head',
    })
    const svg = container.querySelector('svg')
    const cells = Array.from(container.querySelectorAll('[data-testid="modelica-table-2d-cell"]'))

    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(svg?.textContent).toContain('Pump map')
    expect(cells).toHaveLength(4)
    expect(cells.map(cell => cell.querySelector('title')?.textContent)).toContain('Flow: 2; Speed: 20; Head: 8')
    expect(svg?.textContent).toContain('Flow')
    expect(svg?.textContent).toContain('Speed')
    expect(svg?.textContent).toContain('Head')
  })

  it('does not fill absent or non-finite matrix entries and bounds rendered axes', () => {
    const container = render({
      xAxis: Array.from({ length: 42 }, (_, index) => index),
      yAxis: [0, 1],
      values: [[5], [Number.NaN, 9]],
      label: 'Sparse table',
      xLabel: 'X',
      yLabel: 'Y',
      valueLabel: 'Z',
    })
    const cells = Array.from(container.querySelectorAll('[data-testid="modelica-table-2d-cell"]'))
    const description = container.querySelector('svg desc')?.textContent

    expect(cells).toHaveLength(80)
    expect(cells[1]?.querySelector('title')?.textContent).toContain('Z: —')
    expect(cells[40]?.querySelector('title')?.textContent).toContain('Z: —')
    expect(description).toContain('no values are interpolated')
    expect(description).toContain('first 40 samples')
  })
})
