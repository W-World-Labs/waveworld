import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { JobRecord, JobResultV1, JobSpecV1 } from '../../types/task'
import type { StoredArtifact } from './artifacts'
import { THERMAL_FIELD_FORMAT, THERMAL_FIELD_KIND, THERMAL_HISTORY_KIND, THERMAL_KPI_KIND, validateThermalArtifacts, validateThermalTransientArtifacts } from './thermal-artifacts'

const spec = { kind: 'thermal-3d-transient', parameters: { dimension: 1, nx: 2, ny: 1, nz: 1, units: { temperature: 'C' } } } as unknown as JobSpecV1
const job = { id: 'job-1', agentId: 'agent-1', createdBy: 'user-1', projectId: 'project-1', spec } as Pick<JobRecord, 'id' | 'agentId' | 'createdBy' | 'projectId' | 'spec'>
const field = Buffer.alloc(16); field.writeDoubleLE(20, 0); field.writeDoubleLE(40, 8)
const history = Buffer.from('{"step":[1],"tMean":[30]}')
function stored(id: string, kind: string, contentType: string, data: Buffer, patch: Partial<StoredArtifact> = {}): StoredArtifact {
  return { id, jobId: job.id, projectId: job.projectId!, ownerUserId: job.createdBy!, kind, contentType, bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'), storageKey: `${id}.bin`, createdAt: '2026-10-15T00:00:00Z', ...patch }
}
const meta = [stored('host-field-id', THERMAL_FIELD_KIND, 'application/octet-stream', field), stored('host-history-id', THERMAL_HISTORY_KIND, 'application/json', history)]
const result = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 2, gridNx: 2, gridNy: 1, gridNz: 1, tMin: 20, tMax: 40 }, history: { step: [1], tMean: [30] },
  derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: 2, fieldBytes: 16, fieldArtifactId: meta[0]!.id, historyArtifactId: meta[1]!.id, temperatureUnit: 'C', fieldInline: 1, temperatureCsv: '20,40' },
  artifacts: meta.map(m => ({ artifactId: m.id, kind: m.kind, contentType: m.contentType, bytes: m.bytes })) } as unknown as JobResultV1
function lookup(records = meta) { return (id: string) => { const i = records.findIndex(m => m.id === id); return i < 0 ? null : { meta: records[i]!, data: i === 0 ? field : history } } }

test('accepts complete field/history bytes attached to the leased job and verifies SHA/extrema synchronously', () => {
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: lookup() }))
})

test('requires small inline CSV to match every stored f64 value in order', () => {
  for (const temperatureCsv of [undefined, 20, '', '20,', ',40', '20,,40', '20', '40,20', '20,40,60', '20,NaN', '20,Infinity', '20,1e999', '0x14,40', '0b10100,40', '20,41']) {
    const invalid = { ...result, derived: { ...result.derived, temperatureCsv } } as unknown as JobResultV1
    assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result: invalid, lookup: lookup() }), /inline temperature CSV/)
  }
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result: { ...result, derived: { ...result.derived, temperatureCsv: '20.0,40.000' } } as JobResultV1, lookup: lookup() }))
  const negativeZeroField = Buffer.from(field); negativeZeroField.writeDoubleLE(-0, 0)
  const zeroMeta = [stored('negative-zero-field', THERMAL_FIELD_KIND, 'application/octet-stream', negativeZeroField), meta[1]!]
  const zeroResult = { ...result, derived: { ...result.derived, fieldArtifactId: zeroMeta[0]!.id, temperatureCsv: '0,40' }, summary: { ...result.summary, tMin: 0 }, artifacts: result.artifacts!.map(a => a.kind === THERMAL_FIELD_KIND ? { ...a, artifactId: zeroMeta[0]!.id } : a) } as JobResultV1
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result: zeroResult, lookup: id => id === zeroMeta[0]!.id ? { meta: zeroMeta[0]!, data: negativeZeroField } : { meta: zeroMeta[1]!, data: history } }))
  const kelvinJob = { ...job, spec: { ...spec, parameters: { ...spec.parameters, units: { temperature: 'K' } } } as unknown as JobSpecV1 }
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job: kelvinJob, agentId: 'agent-1', result: { ...result, derived: { ...result.derived, temperatureUnit: 'K' } } as JobResultV1, lookup: lookup() }))
})

test('requires and accepts the full inline CSV at the 256-cell limit', () => {
  const values = Buffer.alloc(256 * 8)
  for (let i = 0; i < 256; i++) values.writeDoubleLE(i + 0.5, i * 8)
  const csv = Array.from({ length: 256 }, (_, i) => String(i + 0.5)).join(',')
  const largeHistory = Buffer.from('{"step":[1]}')
  const inlineJob = { ...job, spec: { ...spec, parameters: { dimension: 2, nx: 16, ny: 16, units: { temperature: 'C' } } } as unknown as JobSpecV1 }
  const records = [
    stored('inline256-field', THERMAL_FIELD_KIND, 'application/octet-stream', values),
    stored('inline256-history', THERMAL_HISTORY_KIND, 'application/json', largeHistory),
  ]
  const inlineResult = { schemaVersion: 1, summary: { gridNx: 16, gridNy: 16, gridNz: 1, tMin: 0.5, tMax: 255.5 }, history: { step: [1] },
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: 256, fieldBytes: values.length, fieldArtifactId: records[0]!.id, historyArtifactId: records[1]!.id, temperatureUnit: 'C', fieldInline: 1, temperatureCsv: csv },
    artifacts: records.map(m => ({ artifactId: m.id, kind: m.kind, contentType: m.contentType, bytes: m.bytes })) } as unknown as JobResultV1
  const inlineLookup = (id: string) => { const index = records.findIndex(item => item.id === id); return index < 0 ? null : { meta: records[index]!, data: index === 0 ? values : largeHistory } }
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job: inlineJob, agentId: 'agent-1', result: inlineResult, lookup: inlineLookup }))
  assert.throws(() => validateThermalTransientArtifacts({ job: inlineJob, agentId: 'agent-1', result: { ...inlineResult, derived: { ...inlineResult.derived, temperatureCsv: csv.replace(',1.5', ',1.6') } } as JobResultV1, lookup: inlineLookup }), /differs from field/)
})

test('rejects missing or unsupported temperature units and mismatched summary field metadata', () => {
  for (const temperature of [undefined, 'F']) {
    const invalidJob = { ...job, spec: { ...spec, parameters: { ...spec.parameters, units: temperature === undefined ? {} : { temperature } } } as unknown as JobSpecV1 }
    assert.throws(() => validateThermalTransientArtifacts({ job: invalidJob, agentId: 'agent-1', result, lookup: lookup() }), /field metadata/)
  }
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result: { ...result, summary: { ...result.summary, gridNx: 3 } } as JobResultV1, lookup: lookup() }), /grid dimensions/)
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result: { ...result, derived: { ...result.derived, fieldInline: 0 } } as JobResultV1, lookup: lookup() }), /inline field/)
  const largeSpec = { kind: 'thermal-3d-transient', parameters: { dimension: 2, nx: 17, ny: 17, units: { temperature: 'C' } } } as unknown as JobSpecV1
  const largeJob = { ...job, spec: largeSpec }
  const largeField = Buffer.alloc(17 * 17 * 8); for (let i = 0; i < 17 * 17; i++) largeField.writeDoubleLE(25, i * 8)
  const largeHistory = Buffer.from('{"step":[1],"tMean":[25]}')
  const largeMeta = [stored('large-field-id', THERMAL_FIELD_KIND, 'application/octet-stream', largeField), stored('large-history-id', THERMAL_HISTORY_KIND, 'application/json', largeHistory)]
  const largeResult = { schemaVersion: 1, summary: { gridNx: 17, gridNy: 17, gridNz: 1, tMin: 25, tMax: 25 }, history: { step: [1], tMean: [25] },
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: 289, fieldBytes: largeField.length, fieldArtifactId: largeMeta[0]!.id, historyArtifactId: largeMeta[1]!.id, temperatureUnit: 'C', fieldInline: 0 },
    artifacts: largeMeta.map(m => ({ artifactId: m.id, kind: m.kind, contentType: m.contentType, bytes: m.bytes })) } as unknown as JobResultV1
  const largeLookup = (id: string) => { const index = largeMeta.findIndex(item => item.id === id); return index < 0 ? null : { meta: largeMeta[index]!, data: index === 0 ? largeField : largeHistory } }
  assert.throws(() => validateThermalTransientArtifacts({ job: largeJob, agentId: 'agent-1', result: { ...largeResult, derived: { ...largeResult.derived, temperatureCsv: '25' } } as JobResultV1, lookup: largeLookup }), /inline field/)
})

test('rejects wrong agent, detached artifact, wrong owner/project, altered digest, non-finite field and history mismatch', () => {
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-2', result, lookup: lookup() }), /agent/)
  const detached = [stored(meta[0]!.id, meta[0]!.kind, meta[0]!.contentType, field, { jobId: 'other-job' }), meta[1]!]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: lookup(detached) }), /attached to this job/)
  const wrongOwner = [stored(meta[0]!.id, meta[0]!.kind, meta[0]!.contentType, field, { ownerUserId: 'other-user' }), meta[1]!]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: lookup(wrongOwner) }), /ownership scope/)
  const wrongProject = [stored(meta[0]!.id, meta[0]!.kind, meta[0]!.contentType, field, { projectId: 'other-project' }), meta[1]!]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: lookup(wrongProject) }), /ownership scope/)
  const shortField = [stored(meta[0]!.id, meta[0]!.kind, meta[0]!.contentType, field, { bytes: 8 }), meta[1]!]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: lookup(shortField) }), /metadata differs/)
  const wrongDescriptor = { ...result, artifacts: [{ ...result.artifacts![0]!, bytes: 8 }, result.artifacts![1]!] } as JobResultV1
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result: wrongDescriptor, lookup: lookup() }), /metadata differs/)
  const badDigest = [stored(meta[0]!.id, meta[0]!.kind, meta[0]!.contentType, field, { sha256: '0'.repeat(64) }), meta[1]!]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: lookup(badDigest) }), /SHA-256/)
  const badField = Buffer.from(field); badField.writeDoubleLE(Infinity, 8)
  const nonFinite = [stored(meta[0]!.id, meta[0]!.kind, meta[0]!.contentType, badField), meta[1]!]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: id => ({ meta: id === meta[0]!.id ? nonFinite[0]! : nonFinite[1]!, data: id === meta[0]!.id ? badField : history }) }), /non-finite/)
  const otherHistory = Buffer.from('{"step":[1],"tMean":[31]}')
  const mismatch = [meta[0]!, stored(meta[1]!.id, meta[1]!.kind, meta[1]!.contentType, otherHistory)]
  assert.throws(() => validateThermalTransientArtifacts({ job, agentId: 'agent-1', result, lookup: id => ({ meta: id === meta[0]!.id ? mismatch[0]! : mismatch[1]!, data: id === meta[0]!.id ? field : otherHistory }) }), /differs from completed/)
})

test('accepts native inferred dimensions and gridN defaults', () => {
  const inferredSpec = { kind: 'thermal-3d-transient', parameters: { dimension: null, lengthY: 1, nx: 4, ny: null, gridN: 3, units: { temperature: 'C' } } } as unknown as JobSpecV1
  const inferredJob = { ...job, spec: inferredSpec }
  const values = Buffer.alloc(4 * 3 * 8)
  for (let i = 0; i < 12; i++) values.writeDoubleLE(20 + i, i * 8)
  const hist = Buffer.from('{"step":[1],"tMean":[25.5]}')
  const records = [stored('default-field-id', THERMAL_FIELD_KIND, 'application/octet-stream', values), stored('default-history-id', THERMAL_HISTORY_KIND, 'application/json', hist)]
  const defaultResult = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1, gridNx: 4, gridNy: 3, gridNz: 1, tMin: 20, tMax: 31 },
    history: { step: [1], tMean: [25.5] }, derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: 12, fieldBytes: 96, fieldArtifactId: records[0]!.id, historyArtifactId: records[1]!.id, temperatureUnit: 'C', fieldInline: 1, temperatureCsv: Array.from({ length: 12 }, (_, i) => String(20 + i)).join(',') },
    artifacts: records.map(m => ({ artifactId: m.id, kind: m.kind, contentType: m.contentType, bytes: m.bytes })) } as unknown as JobResultV1
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job: inferredJob, agentId: 'agent-1', result: defaultResult, lookup: id => {
    const index = records.findIndex(item => item.id === id)
    return index < 0 ? null : { meta: records[index]!, data: index === 0 ? values : hist }
  } }))
  const inactiveJob = { ...inferredJob, spec: { ...inferredSpec, parameters: { ...inferredSpec.parameters, dimension: 2, nz: 'ignored when inactive' } } as unknown as JobSpecV1 }
  assert.doesNotThrow(() => validateThermalTransientArtifacts({ job: inactiveJob, agentId: 'agent-1', result: defaultResult, lookup: id => {
    const index = records.findIndex(item => item.id === id)
    return index < 0 ? null : { meta: records[index]!, data: index === 0 ? values : hist }
  } }))
})

test('validates explicit 3D steady field plus exact attached KPI summary', () => {
  const steadySpec = { kind: 'thermal-3d-steady', parameters: { dimension: 3, nx: 2, ny: 2, nz: 2, units: { length: 'm', temperature: 'C' } } } as unknown as JobSpecV1
  const steadyJob = { ...job, spec: steadySpec }
  const values = Buffer.alloc(8 * 8)
  for (let i = 0; i < 8; i++) values.writeDoubleLE(20 + i, i * 8)
  const fieldId = 'host-steady-field', kpiId = 'host-steady-kpi'
  const digest = 'a'.repeat(32)
  const summary = { steps: 4, wallTimeMs: 2, tMin: 20, tMax: 27, tjMaxC: 27, residual: 1e-9, energyImbalance: 0,
    heatFlowInW: -8, sourcePowerW: 8, iterations: 4, gridNx: 2, gridNy: 2, gridNz: 2, cellCount: 8,
    converged: 1, analyticalMaxAbsError: -1, inputDigest: digest, solverPackage: '@w-sim/solvers-thermal', solverVersion: '0.1.0',
    contractVersion: 1, method: 'thermal-steady-fd-gs-v1', precision: 'float64', runtimeMs: 2, convergenceStatus: 'converged', warningCount: 0 }
  const kpiBytes = Buffer.from(JSON.stringify(summary))
  const records = [
    stored(fieldId, THERMAL_FIELD_KIND, 'application/octet-stream', values),
    stored(kpiId, THERMAL_KPI_KIND, 'application/json', kpiBytes),
  ]
  const steadyResult = { schemaVersion: 1, summary, derived: { fieldFormat: THERMAL_FIELD_FORMAT, dimension: 3, cellCount: 8, fieldBytes: 64,
    fieldArtifactId: fieldId, fieldInline: 1, temperatureCsv: '20,21,22,23,24,25,26,27', temperatureUnit: 'C', lengthUnit: 'm' },
    artifacts: records.map(m => ({ artifactId: m.id, kind: m.kind, contentType: m.contentType, bytes: m.bytes })),
    backend: { id: 'native-cuda', provenance: { modelImplementationSha256: digest, dependencyLockSha256: digest } } } as unknown as JobResultV1
  const steadyLookup = (id: string) => { const index = records.findIndex(item => item.id === id); return index < 0 ? null : { meta: records[index]!, data: index === 0 ? values : kpiBytes } }
  assert.doesNotThrow(() => validateThermalArtifacts({ job: steadyJob, agentId: 'agent-1', result: steadyResult, lookup: steadyLookup }))
  assert.throws(() => validateThermalArtifacts({ job: steadyJob, agentId: 'agent-1', result: { ...steadyResult, artifacts: [] } as JobResultV1, lookup: steadyLookup }), /references are incomplete/)
  assert.throws(() => validateThermalArtifacts({ job: steadyJob, agentId: 'agent-1', result: { ...steadyResult, summary: { ...summary, gridNz: 3 } } as JobResultV1, lookup: steadyLookup }), /grid dimensions/)
  assert.throws(() => validateThermalArtifacts({ job: steadyJob, agentId: 'agent-1', result: { ...steadyResult, summary: { ...summary, residual: 2e-9 } } as JobResultV1, lookup: steadyLookup }), /KPI summary artifact differs/)
  const missingHeatKpi = { ...summary, sourcePowerW: null }
  const missingHeatKpiBytes = Buffer.from(JSON.stringify(missingHeatKpi))
  const missingHeatKpiRecords = [records[0]!, stored(kpiId, THERMAL_KPI_KIND, 'application/json', missingHeatKpiBytes)]
  const missingHeatKpiResult = { ...steadyResult, summary: missingHeatKpi,
    artifacts: steadyResult.artifacts!.map(a => a.kind === THERMAL_KPI_KIND ? { ...a, bytes: missingHeatKpiBytes.length } : a) } as unknown as JobResultV1
  assert.throws(() => validateThermalArtifacts({ job: steadyJob, agentId: 'agent-1', result: missingHeatKpiResult, lookup: id => {
    const index = missingHeatKpiRecords.findIndex(item => item.id === id)
    return index < 0 ? null : { meta: missingHeatKpiRecords[index]!, data: index === 0 ? values : missingHeatKpiBytes }
  } }), /sourcePowerW is missing or non-finite/)
  const legacy2dJob = { ...steadyJob, spec: { ...steadySpec, parameters: { ...steadySpec.parameters, dimension: 2 } } as unknown as JobSpecV1 }
  assert.doesNotThrow(() => validateThermalArtifacts({ job: legacy2dJob, agentId: 'agent-1', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, derived: { fieldInline: 0 } } as JobResultV1, lookup: () => null }))

  const largeCount = 17 * 16 * 2
  const largeSpec = { kind: 'thermal-3d-steady', parameters: { dimension: 3, nx: 17, ny: 16, nz: 2, units: { length: 'm', temperature: 'K' } } } as unknown as JobSpecV1
  const largeJob = { ...steadyJob, spec: largeSpec }
  const largeField = Buffer.alloc(largeCount * 8)
  for (let i = 0; i < largeCount; i++) largeField.writeDoubleLE(273.15, i * 8)
  const largeSummary = { ...summary, gridNx: 17, gridNy: 16, gridNz: 2, cellCount: largeCount, tMin: 273.15, tMax: 273.15, tjMaxC: 0 }
  const largeKpiBytes = Buffer.from(JSON.stringify(largeSummary))
  const largeRecords = [stored('host-large-steady-field', THERMAL_FIELD_KIND, 'application/octet-stream', largeField), stored('host-large-steady-kpi', THERMAL_KPI_KIND, 'application/json', largeKpiBytes)]
  const largeResult = { ...steadyResult, summary: largeSummary, derived: { ...steadyResult.derived, cellCount: largeCount, fieldBytes: largeField.length,
    fieldArtifactId: largeRecords[0]!.id, fieldInline: 0, temperatureCsv: undefined, temperatureUnit: 'K' },
    artifacts: largeRecords.map(m => ({ artifactId: m.id, kind: m.kind, contentType: m.contentType, bytes: m.bytes })) } as JobResultV1
  const largeLookup = (id: string) => { const index = largeRecords.findIndex(item => item.id === id); return index < 0 ? null : { meta: largeRecords[index]!, data: index === 0 ? largeField : largeKpiBytes } }
  assert.doesNotThrow(() => validateThermalArtifacts({ job: largeJob, agentId: 'agent-1', result: largeResult, lookup: largeLookup }))
  assert.throws(() => validateThermalArtifacts({ job: largeJob, agentId: 'agent-1', result: { ...largeResult, derived: { ...largeResult.derived, temperatureCsv: '273.15' } } as JobResultV1, lookup: largeLookup }), /inline field/)
})

test('validates spatial-chip native field, exact KPI, ordered die IDs and convergence against submitted controls', () => {
  const digest = 'c'.repeat(32), fieldBytes = Buffer.alloc(8 * 8)
  for (let i = 0; i < 8; i++) fieldBytes.writeDoubleLE(298.15, i * 8)
  const die = { id: 'die-A', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }
  const igbtSpec = { kind: 'electro-thermal-igbt', parameters: {
    mode: 'spatial-chip', dimension: 3, nx: 2, ny: 2, nz: 2, lengthX: 1, lengthY: 1, lengthZ: 1,
    units: { length: 'm', temperature: 'K' }, caseFace: 'front', boundaries: { front: { type: 'dirichlet', temperature: 298.15 } },
    dies: [die], maxIterations: 1, residualTol: 1e-12,
    coupling: { maxJunctionTempC: 180, maxIterations: 2, temperatureToleranceC: 1e-8, relativePowerTolerance: 1e-10 },
  } } as unknown as JobSpecV1
  const igbtJob = { ...job, spec: igbtSpec }
  const summary = {
    method: 'thermal-igbt-spatial-chip-v1', inputDigest: digest, cellCount: 8, gridNx: 2, gridNy: 2, gridNz: 2, dieCount: 1,
    converged: 1, convergenceStatus: 'converged', tMin: 298.15, tMax: 298.15, tjMaxC: 25, caseMeanC: 25,
    sourcePowerW: 1, totalLossW: 1, conductionLossW: 1, switchingLossW: 0, energyImbalance: 0, residual: 0,
    iterations: 1, steps: 1, wallTimeMs: 1, couplingIterations: 1, temperatureChangeC: 0, relativePowerChange: 0,
    heatFlowInW: -1, heatFlowLeftW: 0, heatFlowRightW: 0, heatFlowBottomW: 0, heatFlowTopW: 0, heatFlowFrontW: -1, heatFlowBackW: 0,
    die0JunctionMeanC: 25, die0JunctionMinC: 25, die0JunctionMaxC: 25, die0LossEvaluationTempC: 25,
    die0ConductionLossW: 1, die0SwitchingLossW: 0, die0TotalLossW: 1, die0EvaluatedLossW: 1,
  }
  const fieldId = 'host-igbt-field', kpiId = 'host-igbt-kpi', kpiBytes = Buffer.from(JSON.stringify(summary))
  const records = [
    stored(fieldId, THERMAL_FIELD_KIND, 'application/octet-stream', fieldBytes),
    stored(kpiId, THERMAL_KPI_KIND, 'application/json', kpiBytes),
  ]
  const igbtResult = { schemaVersion: 1, backend: { id: 'native-cuda' }, summary,
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, dimension: 3, lengthUnit: 'm', cellCount: 8, fieldBytes: 64,
      fieldArtifactId: fieldId, fieldInline: 1, temperatureCsv: Array(8).fill('298.15').join(','), temperatureUnit: 'K', inputDigest: digest, igbtDieIds: '["die-A"]' },
    artifacts: records.map(record => ({ artifactId: record.id, kind: record.kind, contentType: record.contentType, bytes: record.bytes })) } as unknown as JobResultV1
  const igbtLookup = (id: string) => {
    const index = records.findIndex(record => record.id === id)
    return index < 0 ? null : { meta: records[index]!, data: index === 0 ? fieldBytes : kpiBytes }
  }
  assert.doesNotThrow(() => validateThermalArtifacts({ job: igbtJob, agentId: 'agent-1', result: igbtResult, lookup: igbtLookup }))
  assert.throws(() => validateThermalArtifacts({ job: igbtJob, agentId: 'agent-1', result: { ...igbtResult, backend: { id: 'cpu' } } as JobResultV1, lookup: igbtLookup }), /native-cuda/)
  assert.throws(() => validateThermalArtifacts({ job: igbtJob, agentId: 'agent-1', result: { ...igbtResult, derived: { ...igbtResult.derived, igbtDieIds: ['die-A'] } } as unknown as JobResultV1, lookup: igbtLookup }), /ordered die IDs/)
  assert.throws(() => validateThermalArtifacts({ job: igbtJob, agentId: 'agent-1', result: { ...igbtResult, summary: { ...summary, relativePowerChange: 2e-10 } } as JobResultV1, lookup: igbtLookup }), /convergence metrics/)
  const rejectsSpatialVariant = (nextSummary: Record<string, unknown>, nextSpec = igbtSpec, dieIds = ['die-A']) => {
    const bytes = Buffer.from(JSON.stringify(nextSummary))
    const variantRecords = [records[0]!, stored(kpiId, THERMAL_KPI_KIND, 'application/json', bytes)]
    const variantResult = { ...igbtResult, summary: nextSummary, derived: { ...igbtResult.derived, igbtDieIds: JSON.stringify(dieIds) },
      artifacts: igbtResult.artifacts!.map(ref => ref.kind === THERMAL_KPI_KIND ? { ...ref, bytes: bytes.length } : ref) } as unknown as JobResultV1
    assert.throws(() => validateThermalArtifacts({ job: { ...igbtJob, spec: nextSpec }, agentId: 'agent-1', result: variantResult,
      lookup: id => { const i = variantRecords.findIndex(record => record.id === id); return i < 0 ? null : { meta: variantRecords[i]!, data: i === 0 ? fieldBytes : bytes } } }), /spatial-chip/)
  }
  for (const patch of [
    { temperatureChangeC: -1 }, { relativePowerChange: -1 }, { residual: -1 }, { residual: 1e-12 },
    { steps: 0 }, { steps: 1.5 }, { couplingIterations: 0 }, { couplingIterations: 2 },
    { iterations: 0 }, { iterations: 2 }, { wallTimeMs: -1 },
  ]) rejectsSpatialVariant({ ...summary, ...patch })
  rejectsSpatialVariant({ ...summary, dieCount: 0 }, { ...igbtSpec, parameters: { ...igbtSpec.parameters as Record<string, unknown>, dies: [] } } as JobSpecV1, [])
  rejectsSpatialVariant({ ...summary, dieCount: 2, die1JunctionMeanC: 25, die1JunctionMinC: 25, die1JunctionMaxC: 25,
    die1LossEvaluationTempC: 25, die1ConductionLossW: 1, die1SwitchingLossW: 0, die1TotalLossW: 1, die1EvaluatedLossW: 1 },
  { ...igbtSpec, parameters: { ...igbtSpec.parameters as Record<string, unknown>, dies: [die, die] } } as JobSpecV1, ['die-A', 'die-A'])
  const missingFinite = { ...summary, die0EvaluatedLossW: null }
  const malformedBytes = Buffer.from(JSON.stringify(missingFinite))
  const malformedRecords = [records[0]!, stored(kpiId, THERMAL_KPI_KIND, 'application/json', malformedBytes)]
  const malformedResult = { ...igbtResult, summary: missingFinite,
    artifacts: igbtResult.artifacts!.map(ref => ref.kind === THERMAL_KPI_KIND ? { ...ref, bytes: malformedBytes.length } : ref) } as unknown as JobResultV1
  assert.throws(() => validateThermalArtifacts({ job: igbtJob, agentId: 'agent-1', result: malformedResult, lookup: id => {
    const index = malformedRecords.findIndex(record => record.id === id)
    return index < 0 ? null : { meta: malformedRecords[index]!, data: index === 0 ? fieldBytes : malformedBytes }
  } }), /die0EvaluatedLossW is missing or non-finite/)
  assert.doesNotThrow(() => validateThermalArtifacts({ job: { ...igbtJob, spec: { ...igbtSpec, parameters: { ...igbtSpec.parameters, mode: 'foster' } } as unknown as JobSpecV1 }, agentId: 'agent-1', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 } } as JobResultV1, lookup: () => null }))
})
