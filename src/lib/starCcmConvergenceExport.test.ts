import { describe, expect, it } from 'vitest'
import { createStarCcmConvergenceExportContents } from './starCcmConvergenceExport'

describe('createStarCcmConvergenceExportContents', () => {
  it('packages caller input, imported iteration labels, series, and native diagnostic with explicit app provenance', () => {
    const output = createStarCcmConvergenceExportContents({
      importedInput: { source: 'user-import', note: 'baseline' },
      iterationLabels: ['001', 2],
      series: [{ name: 'continuity, residual', values: [0.5, null] }],
      nativeDiagnosticResult: { method: 'convergence', converged: false },
    })

    expect(JSON.parse(output.json)).toMatchObject({
      importedInput: { source: 'user-import', note: 'baseline' },
      iterationLabels: ['001', 2],
      nativeDiagnosticResult: { method: 'convergence', converged: false },
      provenance: {
        history: expect.stringContaining('User-imported'),
        diagnostic: expect.stringContaining('sw-ansys-report'),
        vendorValidation: expect.stringContaining('No STAR-CCM+ execution'),
      },
    })
    expect(output.csv).toContain('WaveWorld app-defined convergence table; not a STAR-CCM+ native CSV/export.')
    expect(output.csv).toContain('"continuity, residual"')
    expect(output.csv).toContain('history,001,"continuity, residual",0.5,')
    expect(output.csv).toContain('history,2,"continuity, residual",,')
    expect(output.report.schema).toBe('waveworld.starccm-convergence-report.v1')
  })

  it('rejects malformed or oversized history before creating the CSV', () => {
    expect(() => createStarCcmConvergenceExportContents({
      importedInput: {},
      iterationLabels: [1],
      series: [{ name: 'residual', values: [] }],
      nativeDiagnosticResult: {},
    })).toThrow(/one value per imported iteration label/)

    expect(() => createStarCcmConvergenceExportContents({
      importedInput: {},
      iterationLabels: Array.from({ length: 5_001 }, (_, index) => index),
      series: [],
      nativeDiagnosticResult: {},
    })).toThrow(/at most 5000 imported iterations/)
  })
})
