import { describe, expect, it } from 'vitest'
import { buildCoatingStudyCsv, buildCoatingStudyReport } from './coating-study-export'
import { createCoatingStudyJob, createDefaultCoatingStudyDraft } from './coating-study-input'
import type { CoatingStudyResult, CoatingSweepSample } from './coating-study-result'

const draft = {
  ...createDefaultCoatingStudyDraft(),
  startWavelength: 400,
  stopWavelength: 700,
  samples: 3,
  polarization: 's' as const,
  layers: [{ n: 2.1, k: 0.02, d: 99.5 }],
}
const { input } = createCoatingStudyJob(draft)

function sample(lambda: number, offset: number): CoatingSweepSample {
  const Rs = 0.1 + offset
  const Ts = 0.8 - offset
  const Rp = 0.2 + offset
  const Tp = 0.7 - offset
  return {
    lambda,
    Rs,
    Ts,
    As: 1 - Rs - Ts,
    Rp,
    Tp,
    Ap: 1 - Rp - Tp,
    R: (Rs + Rp) / 2,
    T: (Ts + Tp) / 2,
    A: 1 - (Rs + Rp + Ts + Tp) / 2,
    energyResidual: 0,
  }
}

const result: CoatingStudyResult = {
  backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
  spectrum: [sample(400, 0), sample(550, 0.01), sample(700, 0.02)],
}

describe('coating study exports', () => {
  it('writes a stable CSV header and only returned sweep values in submitted wavelength order', () => {
    const csv = buildCoatingStudyCsv(input, result)
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('wavelength_nm,R,T,A,Rs,Ts,As,Rp,Tp,Ap')
    expect(lines).toHaveLength(result.spectrum.length + 1)
    expect(lines.slice(1).map(line => line.split(',').map(Number))).toEqual(result.spectrum.map(row => [
      row.lambda, row.Rs, row.Ts, row.As, row.Rs, row.Ts, row.As, row.Rp, row.Tp, row.Ap,
    ]))
    expect(lines.slice(1).map(line => Number(line.split(',')[0]))).toEqual(input.wavelengths)
    expect(csv.endsWith('\n')).toBe(true)
  })

  it('rejects sweep snapshots whose row count or wavelengths do not match submitted input', () => {
    expect(() => buildCoatingStudyCsv(input, { ...result, spectrum: result.spectrum.slice(0, 2) })).toThrow(/row count/i)
    expect(() => buildCoatingStudyCsv(input, {
      ...result,
      spectrum: [result.spectrum[0]!, sample(551, 0.01), result.spectrum[2]!],
    })).toThrow(/wavelength mismatch/i)
    expect(() => buildCoatingStudyReport(draft, input, {
      ...result,
      spectrum: [result.spectrum[0]!, sample(551, 0.01), result.spectrum[2]!],
    }, 'job-coating-1')).toThrow(/wavelength mismatch/i)
  })

  it('deterministically binds the draft, exact submitted input, result, job id, and claim limits', () => {
    const report = buildCoatingStudyReport(draft, input, result, 'job-coating-1')
    expect(buildCoatingStudyReport(draft, input, result, 'job-coating-1')).toBe(report)

    const parsed = JSON.parse(report)
    expect(parsed).toMatchObject({ schemaVersion: '1.0', jobId: 'job-coating-1', draft, input, result })
    expect(parsed.claimLimits).toEqual({
      commercialVendor: 'No commercial-vendor affiliation, certification, or endorsement is claimed.',
      parity: 'No parity with commercial software or independent reference is claimed.',
      gpu: 'No GPU execution or GPU validation is claimed; the submitted backend is host.',
    })
    expect(report.endsWith('\n')).toBe(true)
  })
})
