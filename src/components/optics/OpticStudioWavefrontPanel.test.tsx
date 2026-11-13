import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '../../lib/i18n'
import { OpticStudioWavefrontPanel } from './OpticStudioWavefrontPanel'

describe('OpticStudio sampled wavefront panel', () => {
  it('renders the WaveWorld CSV contract, bounded fit controls, and honest scope before import', () => {
    const markup = renderToStaticMarkup(<LocaleProvider><OpticStudioWavefrontPanel /></LocaleProvider>)

    expect(markup).toContain('Sampled wavefront Zernike fit')
    expect(markup).toContain('rho,thetaRadians,wavefront,weight')
    expect(markup).toContain('不是 OpticStudio 专有导出格式')
    expect(markup).toContain('type="number" min="1" max="10" step="1"')
    expect(markup).toContain('Submit sampled wavefront fit to Host')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('不是 OpticStudio Noll 编号')
  })
})
