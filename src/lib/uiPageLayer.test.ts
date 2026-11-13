import { describe, expect, it } from 'vitest'
import { resolvePageSurface, SURFACE_META } from './uiPageLayer'

describe('uiPageLayer', () => {
  it('home and domain hubs', () => {
    expect(resolvePageSurface('/')).toBe('home')
    expect(resolvePageSurface('/d/atlas')).toBe('knowledge')
    expect(resolvePageSurface('/d/sim')).toBe('simulation')
    expect(resolvePageSurface('/d/apps')).toBe('apps')
  })

  it('wind, optics, EM and thermal modules share a surface', () => {
    expect(resolvePageSurface('/methods')).toBe('knowledge')
    expect(resolvePageSurface('/matrix')).toBe('knowledge')
    expect(resolvePageSurface('/fdtd')).toBe('simulation')
    expect(resolvePageSurface('/optics-lab')).toBe('simulation')
    expect(resolvePageSurface('/sim')).toBe('simulation')
    expect(resolvePageSurface('/windtunnel')).toBe('simulation')
    expect(resolvePageSurface('/lab-cfd')).toBe('simulation')
    expect(resolvePageSurface('/batch-jobs')).toBe('ops')
    expect(resolvePageSurface('/comsol')).toBe('ops')
    expect(resolvePageSurface('/ansys')).toBe('ops')
    expect(resolvePageSurface('/abaqus')).toBe('ops')
    expect(resolvePageSurface('/opticstudio')).toBe('ops')
    expect(resolvePageSurface('/dymola')).toBe('ops')
    expect(resolvePageSurface('/star-ccm')).toBe('ops')
    expect(resolvePageSurface('/cst')).toBe('ops')
  })

  it('surfaces have metadata', () => {
    for (const meta of Object.values(SURFACE_META)) {
      expect(meta.labelZh.length).toBeGreaterThan(1)
      expect(meta.hubPath.startsWith('/')).toBe(true)
    }
  })
})
