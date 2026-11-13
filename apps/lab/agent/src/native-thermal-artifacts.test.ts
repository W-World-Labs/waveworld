import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { materializeNativeThermalArtifacts, THERMAL_FIELD_FORMAT, THERMAL_FIELD_KIND, THERMAL_HISTORY_KIND, THERMAL_KPI_KIND } from './native-thermal-artifacts.ts'

const spec = { kind: 'thermal-3d-transient', parameters: { dimension: 1, nx: 2, ny: 1, nz: 1, units: { temperature: 'C' } } } as unknown as JobSpecV1
function makeField(values = [20, 40]): Buffer { const b = Buffer.alloc(values.length * 8); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b }
function makeResult(history: unknown = { step: [1], tMean: [30] }): JobResultV1 {
  const historyBytes = Buffer.from(JSON.stringify(history))
  return { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 2, gridNx: 2, gridNy: 1, gridNz: 1 }, history: history as JobResultV1['history'],
    artifacts: [
      { artifactId: 'field-local-123456', kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: 16 },
      { artifactId: 'history-local-123456', kind: THERMAL_HISTORY_KIND, contentType: 'application/json', bytes: historyBytes.length },
    ],
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: 2, fieldBytes: 16, fieldArtifactId: 'field-local-123456', historyArtifactId: 'history-local-123456', temperatureUnit: 'C', fieldInline: 1 } } as JobResultV1
}
async function fixture(field = makeField(), history = Buffer.from('{"step":[1],"tMean":[30]}')) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ww-native-thermal-'))
  await mkdir(path.join(dir, 'artifacts'))
  await writeFile(path.join(dir, 'artifacts', 'field-local-123456'), field)
  await writeFile(path.join(dir, 'artifacts', 'history-local-123456'), history)
  return dir
}

const steadySpec = {
  kind: 'thermal-3d-steady',
  parameters: { dimension: 3, nx: 2, ny: 2, nz: 2, lengthUnit: 'm', units: { temperature: 'C', length: 'm' } },
} as unknown as JobSpecV1
const steadyDigest = '0123456789abcdef0123456789abcdef'
function makeSteadyField(count: number): Buffer {
  const b = Buffer.alloc(count * 8)
  for (let i = 0; i < count; i++) b.writeDoubleLE(i === 0 ? -0 : 20 + i, i * 8)
  return b
}
function steadySummary(nx: number, ny: number, nz: number, values: number[]) {
  return { steps: 4, wallTimeMs: 2, gridNx: nx, gridNy: ny, gridNz: nz, cellCount: values.length,
    inputDigest: steadyDigest, tMin: Math.min(...values), tMax: Math.max(...values) }
}
function makeSteadyResult(nx = 2, ny = 2, nz = 2, field = makeSteadyField(nx * ny * nz), csv?: string): JobResultV1 {
  const values = Array.from({ length: nx * ny * nz }, (_, i) => i === 0 ? -0 : 20 + i)
  const summary = steadySummary(nx, ny, nz, values)
  const fieldId = 'steady-field-local-123456', kpiId = 'steady-kpi-local-123456'
  const fieldBytes = field.byteLength
  const kpiBytes = Buffer.from(JSON.stringify(summary))
  return {
    schemaVersion: 1,
    summary,
    artifacts: [
      { artifactId: fieldId, kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: fieldBytes },
      { artifactId: kpiId, kind: THERMAL_KPI_KIND, contentType: 'application/json', bytes: kpiBytes.length },
    ],
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: values.length, fieldBytes, fieldArtifactId: fieldId,
      temperatureUnit: 'C', fieldInline: values.length <= 256 ? 1 : 0,
      ...(values.length <= 256 ? { temperatureCsv: csv ?? values.map(v => Object.is(v, -0) ? '0' : String(v)).join(',') } : {}) },
  } as unknown as JobResultV1
}
async function steadyFixture(result: JobResultV1, field = makeSteadyField(8)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ww-native-thermal-steady-'))
  await mkdir(path.join(dir, 'artifacts'))
  const refs = result.artifacts ?? []
  const fieldRef = refs.find(a => a.kind === THERMAL_FIELD_KIND)!
  const kpiRef = refs.find(a => a.kind === THERMAL_KPI_KIND)!
  await writeFile(path.join(dir, 'artifacts', fieldRef.artifactId), field)
  await writeFile(path.join(dir, 'artifacts', kpiRef.artifactId), Buffer.from(JSON.stringify(result.summary)))
  return dir
}
function uploader(calls: string[] = []) {
  return async (kind: string, contentType: string, bytes: ArrayBuffer) => {
    calls.push(kind)
    const data = Buffer.from(bytes)
    return { artifactId: `host-${calls.length}-uuid`, kind, contentType, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }
  }
}

test('preflights native field and history then replaces local IDs with Host artifact IDs', async () => {
  const dir = await fixture(), calls: string[] = []
  try {
    const out = await materializeNativeThermalArtifacts(spec, makeResult(), dir, uploader(calls))
    assert.deepEqual(calls, [THERMAL_FIELD_KIND, THERMAL_HISTORY_KIND])
    assert.equal(out.derived?.fieldArtifactId, 'host-1-uuid')
    assert.equal(out.derived?.historyArtifactId, 'host-2-uuid')
    assert.deepEqual(out.artifacts?.map(a => a.artifactId), ['host-1-uuid', 'host-2-uuid'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('rejects bad dimensions, non-finite fields, altered history and missing uploader before upload', async () => {
  const dir = await fixture(), calls: string[] = []
  try {
    await assert.rejects(materializeNativeThermalArtifacts(spec, makeResult(), dir, undefined), /uploader/)
    const missingUnit = { ...spec, parameters: { ...spec.parameters, units: {} } } as unknown as JobSpecV1
    const invalidUnit = { ...spec, parameters: { ...spec.parameters, units: { temperature: 'F' } } } as unknown as JobSpecV1
    await assert.rejects(materializeNativeThermalArtifacts(missingUnit, makeResult(), dir, uploader(calls)), /temperature unit must be C or K/)
    await assert.rejects(materializeNativeThermalArtifacts(invalidUnit, makeResult(), dir, uploader(calls)), /temperature unit must be C or K/)
    await writeFile(path.join(dir, 'artifacts', 'field-local-123456'), makeField([20, NaN]))
    await assert.rejects(materializeNativeThermalArtifacts(spec, makeResult(), dir, uploader(calls)), /non-finite/)
    await writeFile(path.join(dir, 'artifacts', 'field-local-123456'), makeField())
    await writeFile(path.join(dir, 'artifacts', 'history-local-123456'), Buffer.from('{"step":[1],"tMean":[31]}'))
    await assert.rejects(materializeNativeThermalArtifacts(spec, makeResult(), dir, uploader(calls)), /does not equal/)
    assert.deepEqual(calls, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('rejects phantom local descriptors and abort before any artifact upload', async () => {
  const dir = await fixture(), calls: string[] = []
  try {
    const phantom = makeResult()
    phantom.artifacts = [...(phantom.artifacts ?? []), { artifactId: 'extra', kind: 'other', contentType: 'application/json', bytes: 2 }]
    await assert.rejects(materializeNativeThermalArtifacts(spec, phantom, dir, uploader(calls)), /exactly two/)
    const abort = new AbortController(); abort.abort()
    await assert.rejects(materializeNativeThermalArtifacts(spec, makeResult(), dir, uploader(calls), abort.signal), /abort/i)
    assert.deepEqual(calls, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('uses native dimension inference and gridN defaults without coercing strings', async () => {
  const inferredSpec = { kind: 'thermal-3d-transient', parameters: { dimension: null, lengthY: 1, nx: 4, ny: null, gridN: 3, units: { temperature: 'C' } } } as unknown as JobSpecV1
  const values = makeField(Array.from({ length: 12 }, (_, i) => 20 + i))
  const history = Buffer.from('{"step":[1],"tMean":[25.5]}')
  const dir = await fixture(values, history)
  const result = {
    ...makeResult({ step: [1], tMean: [25.5] }),
    summary: { steps: 1, wallTimeMs: 1, gridNx: 4, gridNy: 3, gridNz: 1 },
    artifacts: [
      { artifactId: 'field-local-123456', kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: 96 },
      { artifactId: 'history-local-123456', kind: THERMAL_HISTORY_KIND, contentType: 'application/json', bytes: history.length },
    ],
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, cellCount: 12, fieldBytes: 96, fieldArtifactId: 'field-local-123456', historyArtifactId: 'history-local-123456', temperatureUnit: 'C', fieldInline: 1 },
  } as unknown as JobResultV1
  try {
    await assert.doesNotReject(materializeNativeThermalArtifacts(inferredSpec, result, dir, uploader()))
    await assert.rejects(materializeNativeThermalArtifacts({ ...inferredSpec, parameters: { ...inferredSpec.parameters, nx: '4' } } as unknown as JobSpecV1, result, dir, uploader()), /safe integer/)
    const inactiveAxis = { ...inferredSpec, parameters: { ...inferredSpec.parameters, dimension: 2, nz: 'ignored when inactive' } } as unknown as JobSpecV1
    await assert.doesNotReject(materializeNativeThermalArtifacts(inactiveAxis, result, dir, uploader()))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('rejects symlink artifact input and mismatched upload acknowledgement', async () => {
  const dir = await fixture()
  try {
    const field = path.join(dir, 'artifacts', 'field-local-123456')
    await rm(field)
    await symlink(path.join(dir, 'artifacts', 'history-local-123456'), field)
    await assert.rejects(materializeNativeThermalArtifacts(spec, makeResult(), dir, uploader()), /regular file|ELOOP|symbolic link/)
    await rm(field)
    await writeFile(field, makeField())
    await assert.rejects(materializeNativeThermalArtifacts(spec, makeResult(), dir, async () => ({ artifactId: 'bad', kind: 'wrong', contentType: 'application/octet-stream', bytes: 16, sha256: '0'.repeat(64) })), /acknowledgement/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('materializes explicit 3D steady field and descriptor-selected KPI with exact summary', async () => {
  const result = makeSteadyResult(), field = makeSteadyField(8), dir = await steadyFixture(result, field), calls: string[] = []
  try {
    const out = await materializeNativeThermalArtifacts(steadySpec, result, dir, uploader(calls))
    assert.deepEqual(calls, [THERMAL_FIELD_KIND, THERMAL_KPI_KIND])
    assert.deepEqual(out.artifacts?.map(a => a.artifactId), ['host-1-uuid', 'host-2-uuid'])
    assert.equal(out.derived?.fieldArtifactId, 'host-1-uuid')
    assert.equal(out.derived?.kpiArtifactId, undefined)
    assert.deepEqual(out.summary, result.summary)
    assert.equal((out.summary as Record<string, unknown>).inputDigest, steadyDigest)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('steady 3D rejects missing KPI/field files, malformed CSV and inconsistent metadata before upload', async () => {
  const good = makeSteadyResult()
  const cases: Array<{ name: string; result: JobResultV1; field?: Buffer }> = [
    { name: 'missing field', result: good, field: Buffer.alloc(7) },
    { name: 'bad csv', result: makeSteadyResult(2, 2, 2, makeSteadyField(8), '0,21,22,23,24,25,26,28') },
    { name: 'bad digest', result: { ...good, summary: { ...good.summary, inputDigest: 'not-a-32-byte-digest' } } as JobResultV1 },
    { name: 'bad grid', result: { ...good, summary: { ...good.summary, gridNz: 3 } } as JobResultV1 },
    { name: 'bad extrema', result: { ...good, summary: { ...good.summary, tMax: 999 } } as JobResultV1 },
    { name: 'bad field byte metadata', result: { ...good, derived: { ...good.derived, fieldBytes: 63 } } as JobResultV1 },
  ]
  for (const item of cases) {
    const dir = await steadyFixture(item.result, item.field ?? makeSteadyField(8)), calls: string[] = []
    try {
      await assert.rejects(materializeNativeThermalArtifacts(steadySpec, item.result, dir, uploader(calls)), error => error instanceof Error, item.name)
      assert.deepEqual(calls, [], `${item.name} must fail before upload`)
    } finally { await rm(dir, { recursive: true, force: true }) }
  }

  const missingKpi = await steadyFixture(good)
  try {
    const kpiRef = good.artifacts!.find(a => a.kind === THERMAL_KPI_KIND)!
    await rm(path.join(missingKpi, 'artifacts', kpiRef.artifactId))
    const calls: string[] = []
    await assert.rejects(materializeNativeThermalArtifacts(steadySpec, good, missingKpi, uploader(calls)))
    assert.deepEqual(calls, [])
  } finally { await rm(missingKpi, { recursive: true, force: true }) }
})

test('spatial-chip uploads only native-cuda field and exact KPI artifacts with ordered die IDs', async () => {
  const digest = 'b'.repeat(32), values = Array(8).fill(298.15) as number[], field = Buffer.alloc(64)
  values.forEach((value, i) => field.writeDoubleLE(value, i * 8))
  const die = { id: 'die-A', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }
  const spatialSpec = { kind: 'electro-thermal-igbt', parameters: {
    mode: 'spatial-chip', dimension: 3, nx: 2, ny: 2, nz: 2, lengthX: 1, lengthY: 1, lengthZ: 1,
    units: { length: 'm', temperature: 'K' }, caseFace: 'front', boundaries: { front: { type: 'dirichlet', temperature: 298.15 } },
    dies: [die], maxIterations: 1, residualTol: 1e-12,
    coupling: { maxJunctionTempC: 180, maxIterations: 2, temperatureToleranceC: 1e-8, relativePowerTolerance: 1e-10 },
  } } as unknown as JobSpecV1
  const summary = {
    method: 'thermal-igbt-spatial-chip-v1', inputDigest: digest, cellCount: 8, gridNx: 2, gridNy: 2, gridNz: 2, dieCount: 1,
    converged: 1, convergenceStatus: 'converged', tMin: 298.15, tMax: 298.15, tjMaxC: 25, caseMeanC: 25,
    sourcePowerW: 1, totalLossW: 1, conductionLossW: 1, switchingLossW: 0, energyImbalance: 0, residual: 0,
    iterations: 1, steps: 1, wallTimeMs: 1, couplingIterations: 1, temperatureChangeC: 0, relativePowerChange: 0,
    heatFlowInW: -1, heatFlowLeftW: 0, heatFlowRightW: 0, heatFlowBottomW: 0, heatFlowTopW: 0, heatFlowFrontW: -1, heatFlowBackW: 0,
    die0JunctionMeanC: 25, die0JunctionMinC: 25, die0JunctionMaxC: 25, die0LossEvaluationTempC: 25,
    die0ConductionLossW: 1, die0SwitchingLossW: 0, die0TotalLossW: 1, die0EvaluatedLossW: 1,
  }
  const fieldId = 'local-igbt-field', kpiId = 'local-igbt-kpi'
  const artifacts = [
    { artifactId: fieldId, kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: field.length },
    { artifactId: kpiId, kind: THERMAL_KPI_KIND, contentType: 'application/json', bytes: Buffer.byteLength(JSON.stringify(summary)) },
  ]
  const result = { schemaVersion: 1, backend: { id: 'native-cuda' }, summary,
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, dimension: 3, lengthUnit: 'm', cellCount: 8, fieldBytes: 64,
      fieldArtifactId: fieldId, fieldInline: 1, temperatureCsv: values.join(','), temperatureUnit: 'K', inputDigest: digest, igbtDieIds: '["die-A"]' },
    artifacts } as unknown as JobResultV1
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ww-native-igbt-artifacts-'))
  await mkdir(path.join(dir, 'artifacts'))
  await writeFile(path.join(dir, 'artifacts', fieldId), field)
  await writeFile(path.join(dir, 'artifacts', kpiId), Buffer.from(JSON.stringify(summary)))
  try {
    const calls: string[] = []
    const output = await materializeNativeThermalArtifacts(spatialSpec, result, dir, uploader(calls))
    assert.deepEqual(calls, [THERMAL_FIELD_KIND, THERMAL_KPI_KIND])
    assert.equal(output.derived?.fieldArtifactId, 'host-1-uuid')
    assert.equal(output.derived?.igbtDieIds, '["die-A"]')
    assert.equal((output.derived as Record<string, unknown>).kpiArtifactId, undefined)
    assert.deepEqual(output.artifacts?.map(a => [a.artifactId, a.kind]), [['host-1-uuid', THERMAL_FIELD_KIND], ['host-2-uuid', THERMAL_KPI_KIND]])
    assert.deepEqual(output.summary, summary)
    await assert.rejects(materializeNativeThermalArtifacts(spatialSpec, { ...result, backend: { id: 'cpu' } } as JobResultV1, dir, uploader()), /native-cuda/)
    await assert.rejects(materializeNativeThermalArtifacts(spatialSpec, { ...result, derived: { ...result.derived, igbtDieIds: ['die-A'] } } as unknown as JobResultV1, dir, uploader()), /ordered die IDs/)
    await assert.rejects(materializeNativeThermalArtifacts(spatialSpec, { ...result, summary: { ...summary, die0EvaluatedLossW: Number.NaN } } as JobResultV1, dir, uploader()), /non-finite/)
    await assert.rejects(materializeNativeThermalArtifacts(spatialSpec, { ...result, summary: { ...summary, tjMaxC: 180.01 } } as JobResultV1, dir, uploader()), /exceeds the submitted limit/)
    for (const patch of [
      { temperatureChangeC: -1 }, { relativePowerChange: -1 }, { residual: -1 }, { residual: 1e-12 },
      { steps: 0 }, { steps: 1.5 }, { couplingIterations: 0 }, { couplingIterations: 2 },
      { iterations: 0 }, { iterations: 2 }, { wallTimeMs: -1 },
    ]) {
      await assert.rejects(materializeNativeThermalArtifacts(spatialSpec, { ...result, summary: { ...summary, ...patch } } as JobResultV1, dir, uploader()), /spatial-chip/)
    }
    const noDies = { ...spatialSpec, parameters: { ...spatialSpec.parameters as Record<string, unknown>, dies: [] } } as JobSpecV1
    await assert.rejects(materializeNativeThermalArtifacts(noDies, result, dir, uploader()), /counts or convergence/)
    const duplicateDies = { ...spatialSpec, parameters: { ...spatialSpec.parameters as Record<string, unknown>, dies: [die, die] } } as JobSpecV1
    await assert.rejects(materializeNativeThermalArtifacts(duplicateDies, result, dir, uploader()), /counts or convergence|ordered die IDs/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('legacy IGBT mode is not intercepted by spatial artifact materialization', async () => {
  const legacy = { kind: 'electro-thermal-igbt', parameters: { mode: 'foster' } } as unknown as JobSpecV1
  const result = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 } } as JobResultV1
  assert.equal(await materializeNativeThermalArtifacts(legacy, result, os.tmpdir(), undefined), result)
})

test('steady large fields declare no inline CSV and upload all field bytes', async () => {
  const nx = 7, ny = 7, nz = 7, field = makeSteadyField(nx * ny * nz)
  const result = makeSteadyResult(nx, ny, nz, field), dir = await steadyFixture(result, field), calls: string[] = []
  const largeSpec = { ...steadySpec, parameters: { ...steadySpec.parameters, nx, ny, nz } } as JobSpecV1
  try {
    const out = await materializeNativeThermalArtifacts(largeSpec, result, dir, uploader(calls))
    assert.equal((out.derived as Record<string, unknown>).fieldInline, 0)
    assert.equal((out.derived as Record<string, unknown>).temperatureCsv, undefined)
    assert.equal(calls.length, 2)
    assert.deepEqual(out.artifacts?.map(a => a.kind), [THERMAL_FIELD_KIND, THERMAL_KPI_KIND])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
