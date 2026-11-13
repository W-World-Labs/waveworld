import type { ContextType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { ModuleComputeContext } from '../lib/hooks/useModuleCompute'
import { parseStarCcmTurboPoint, StarCcmTurboStudy } from './StarCcmTurboStudy'

function renderStudy(overrides: Record<string, unknown> = {}) {
  const execution = {
    target: 'backend' as const,
    setTarget: vi.fn(async () => {}),
    register: vi.fn(),
    reportLocalError: vi.fn(),
    connected: true,
    browserAgent: false,
    precision: 'f64',
    result: null,
    status: 'idle',
    error: null,
    loginRequired: false,
    jobId: null,
    busy: false,
    cancelPending: false,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => true),
    clear: vi.fn(),
    ...overrides,
  } as unknown as NonNullable<ContextType<typeof ModuleComputeContext>>

  const markup = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <MemoryRouter>
        <ModuleComputeContext.Provider value={execution}>
          <StarCcmTurboStudy />
        </ModuleComputeContext.Provider>
      </MemoryRouter>
    </LocaleProvider>,
  )
  return { markup, execution }
}

describe('STAR-CCM+ turbomachinery performance study UI', () => {
  it('renders the guided operating-point editor, fixed native Host input, and saved-results panel', () => {
    const { markup } = renderStudy()

    expect(markup).toContain('Turbomachinery performance study')
    expect(markup).toContain('aria-label="Study points"')
    expect(markup).toContain('aria-label="Native input"')
    expect(markup).toContain('Edit native input')
    expect(markup).toContain('sw-su2-turbo-metrics')
    expect(markup).toContain('&quot;backend&quot;: &quot;host&quot;')
    expect(markup).toContain('Point 1')
    expect(markup).toContain('12')
    expect(markup).toContain('Submit this point')
    expect(markup).toContain('aria-label="Study results"')
    expect(markup).toContain('Saved native results')
    expect(markup).toContain('Pressure ratio')
    expect(markup).toContain('Corrected mass flow')
    expect(markup).toContain('CSV')
    expect(markup).toContain('JSON')
  })

  it('shows the running status and cancellation control for a Host job', () => {
    const { markup } = renderStudy({ busy: true, status: 'running', jobId: 'job-turbo-1' })

    expect(markup).toContain('Job running…')
    expect(markup).toContain('Cancel job')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('running')
  })

  it('states the independent metrics scope and its STAR-CCM+ limitations', () => {
    const { markup } = renderStudy()

    expect(markup).toContain('independent W-Sim Host-f64 post-processing')
    expect(markup).toContain('ideal-gas metrics')
    expect(markup).toContain('does not invoke STAR-CCM+')
    expect(markup).toContain('interpolate a performance map')
    expect(markup).toContain('claim Siemens algorithm or numerical equivalence')
    expect(markup).toContain('does not solve flow')
  })

  it('accepts supported Host-f64 operating points and rejects module, backend, and unsupported-input changes', () => {
    const valid = {
      module: 'sw-su2-turbo-metrics',
      backend: 'host',
      kind: 'compressor',
      p_t1: 50000,
      T_t1: 400,
      p_t2: 100000,
      T_t2: 480,
      rpm: 10000,
    }

    expect(parseStarCcmTurboPoint(JSON.stringify(valid))).toMatchObject(valid)
    expect(parseStarCcmTurboPoint(JSON.stringify({ ...valid, module: 'sw-su2-flow' }))).toBeNull()
    expect(parseStarCcmTurboPoint(JSON.stringify({ ...valid, backend: 'cuda' }))).toBeNull()
    expect(parseStarCcmTurboPoint(JSON.stringify({ ...valid, vendorSolverMode: 'starccm' }))).toBeNull()
    expect(parseStarCcmTurboPoint(JSON.stringify({ ...valid, p_t1: 0 }))).toBeNull()
    expect(parseStarCcmTurboPoint(`${JSON.stringify(valid)}${' '.repeat(64 * 1024)}`)).toBeNull()
  })
})
