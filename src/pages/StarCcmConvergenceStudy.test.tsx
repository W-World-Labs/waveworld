import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { StarCcm } from './StarCcm'

describe('STAR-CCM+ convergence study page integration', () => {
  it('renders the residual-history CSV input and convergence analysis control', () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en">
        <MemoryRouter>
          <StarCcm />
        </MemoryRouter>
      </LocaleProvider>,
    )

    expect(markup).toContain('STAR-CCM+ convergence study')
    expect(markup).toContain('Residual history CSV')
    expect(markup).toContain('Analyze convergence history')
  })
})
