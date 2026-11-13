import { describe, expect, it } from 'vitest'
import { bytesToBase64, evidenceBinding, mapPathExperimentView, parseCalibrationCsv, parseCompareJobIds } from './pathExperimentView'
import type { HostPathExperimentResult, HostPathExperimentSpec } from './hostApi'

const spec: HostPathExperimentSpec = {
  experimentId: 'ir-ros-1', title: 'Ir ROS',
  materials: [{ id: 'ir', name: 'Ir complex', role: 'sensitizer', source: { kind: 'literature', citation: 'paper' } }],
  steps: [{ id: 'isc', label: 'ISC', mechanism: 'S1 → T1', inputs: ['S1'], outputs: ['T1'], hypothesis: { status: 'candidate', description: 'ultrasound coupled', sources: [{ kind: 'assumption' }] } }],
  parameters: { frequency: { value: 1, unit: 'MHz', source: { kind: 'measured' } } },
  model: { id: 'photo-kinetics', version: '2' },
  provenance: { createdAt: '2026-01-01T00:00:00Z', software: { name: 'WaveWorld', version: '3' } },
}
const result: HostPathExperimentResult = {
  experimentId: 'ir-ros-1', modelVersion: '2',
  outputs: { tripletYield: { value: 0.72, source: { kind: 'computed' } } },
  provenance: { computedAt: '2026-01-02T00:00:00Z', engineVersion: 'engine-1' },
}

describe('path experiment compare references', () => {
  it('deduplicates valid stable ids and rejects embedded payload syntax', () => {
    expect(parseCompareJobIds(' job-a,job-b,job-a,eyJmb28iOiJiYXIifQ==,bad/id ')).toEqual(['job-a', 'job-b'])
  })
})

describe('path experiment field mapping', () => {
  it('exposes materials, hypotheses, evidence, parameters and authoritative outputs', () => {
    const view = mapPathExperimentView(spec, result)
    expect(view.materials[0].source.kind).toBe('literature')
    expect(view.steps[0].hypothesis.status).toBe('candidate')
    expect(view.steps[0].hypothesis.sources[0].kind).toBe('assumption')
    expect(view.parameters.frequency.source.kind).toBe('measured')
    expect(view.outputs.tripletYield.value).toBe(0.72)
    expect(view.resultProvenance?.engineVersion).toBe('engine-1')
  })

  it('rejects output mapping when experiment ids differ', () => {
    const view = mapPathExperimentView(spec, { ...result, experimentId: 'other' })
    expect(view.resultMatchesSpec).toBe(false)
    expect(view.outputs).toEqual({})
  })

  it('maps imported evidence into an audit-ready parameter source', () => {
    const source = evidenceBinding({ id: 'ev-1', kind: 'measured', title: 'O2.csv', artifactId: 'a-1', sha256: 'a'.repeat(64), contentType: 'text/csv', bytes: 3, metadata: {}, ownerUserId: 'u', projectId: null, createdAt: '2026-01-01T00:00:00Z' }, 'row=2,column=O2', 'value * 0.001')
    expect(source).toMatchObject({ kind: 'measured', evidenceId: 'ev-1', sha256: 'a'.repeat(64), locator: 'row=2,column=O2', transform: 'value * 0.001' })
  })

  it('encodes imported file bytes without text transcoding', () => {
    expect(bytesToBase64(new Uint8Array([0, 255, 10]))).toBe('AP8K')
  })

  it('parses finite calibration CSV observations and rejects malformed rows', () => {
    expect(parseCalibrationCsv('time,T1,singletO2\n0,0,0\n0.1,0.2,0.03\n')).toEqual({ time: [0, 0.1], T1: [0, 0.2], singletO2: [0, 0.03] })
    expect(parseCalibrationCsv('time,T1\n0,nope\n')).toBeNull()
    expect(parseCalibrationCsv('sample,value\na,1\n')).toBeNull()
  })

  it.each([
    'time,T1\n0,1\n1,',
    'time,T1\n0,1\n,2',
    'time,singletO2\n0,1\n1,  ',
    'time,T1,singletO2\n0,1,2\n1,,3',
    'time,T1,singletO2\n0,1,2\n1,3',
  ])('rejects missing calibration measurements without inventing zeros: %s', (csv) => {
    expect(parseCalibrationCsv(csv)).toBeNull()
  })

  it('preserves explicit zero and scientific-notation calibration measurements', () => {
    expect(parseCalibrationCsv('time,T1,singletO2\n 0 , 0 , 0 \n1e-3,2e-4,0\n'))
      .toEqual({ time: [0, 0.001], T1: [0, 0.0002], singletO2: [0, 0] })
  })
})
