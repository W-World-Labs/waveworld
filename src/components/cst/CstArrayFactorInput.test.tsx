import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CstArrayFactorInput, type CstArrayFactorInputValue } from './CstArrayFactorInput'

const value: CstArrayFactorInputValue = {
  module: 'antenna-l2', backend: 'host', operation: 'cst-array-factor', freqHz: 1e9,
  positionsM: [[0, 0, 0], [0.15, 0, 0]], weights: [[1, 0], [0.5, -0.25]],
  directionsRad: [[Math.PI / 3, Math.PI / 4]],
}

describe('CstArrayFactorInput', () => {
  it('renders the native array-factor fields with explicit units and scope', () => {
    const markup = renderToStaticMarkup(<CstArrayFactorInput value={value} onChange={vi.fn()} />)
    expect(markup).toContain('Frequency (Hz)')
    expect(markup).toContain('Element 2 z (m)')
    expect(markup).toContain('Element 2 weight imaginary')
    expect(markup).toContain('Direction 1 theta (degrees)')
    expect(markup).toContain('Isotropic, uncoupled point elements only')
    expect(markup).toContain('then stored in radians')
    expect(markup).toContain('up to 256 elements and 1,048,576 position-direction evaluations')
    expect(markup).toContain('Up to 4,096 directions are allowed')
  })

  it('disables editing controls when the request is disabled', () => {
    const markup = renderToStaticMarkup(<CstArrayFactorInput value={value} disabled onChange={vi.fn()} />)
    expect(markup).toContain('aria-label="Frequency (Hz)"')
    expect(markup).toMatch(/aria-label="Remove element 1"[^>]*disabled(?:="")?/)
    expect(markup).toContain('Add element</button>')
  })

  it('shows controlled row values and keeps remove controls for rows', () => {
    const markup = renderToStaticMarkup(<CstArrayFactorInput value={value} onChange={vi.fn()} />)
    expect(markup).toContain('value="0.15"')
    expect(markup).toContain('value="0.5"')
    expect(markup).toContain('value="-0.25"')
    expect(markup).toContain('aria-label="Remove direction 1"')
  })

  it('exposes theta and phi boundaries on the degree inputs', () => {
    const markup = renderToStaticMarkup(<CstArrayFactorInput value={value} onChange={vi.fn()} />)
    expect(markup).toContain('aria-label="Direction 1 theta (degrees)"')
    expect(markup).toContain('aria-label="Direction 1 phi (degrees)"')
    expect(markup).toContain('min="0" max="180"')
    expect(markup).toContain('min="-180" max="180"')
  })
})
