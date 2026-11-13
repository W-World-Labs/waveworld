import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { createThermalFieldExportFiles, downloadThermalFieldArtifact, downloadThermalKpiSummaryArtifact, exportThermalFieldDirectory, THERMAL_FIELD_FORMAT, THERMAL_FIELD_KIND } from './thermal-field-artifact'

const inputDigest = '0123456789abcdef0123456789abcdef'
const spec = { kind: 'thermal-3d-transient', parameters: { dimension: 1, nx: 2, ny: 1, nz: 1, units: { temperature: 'C' } } } as unknown as JobSpecV1
const data = new ArrayBuffer(16); const view = new DataView(data); view.setFloat64(0, 20, true); view.setFloat64(8, 40, true)
const digest = createHash('sha256').update(new Uint8Array(data)).digest('hex')
const artifact = { artifactId: 'host-random-field-1', kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: data.byteLength }
const result = { schemaVersion: 1, summary: { steps: 10, wallTimeMs: 1, tMin: 20, tMax: 40, inputDigest }, derived: { fieldFormat: THERMAL_FIELD_FORMAT, fieldArtifactId: artifact.artifactId, fieldBytes: 16, cellCount: 2, temperatureUnit: 'C' } } as unknown as JobResultV1
type CapturedSpatial = {
  spec: Record<string, unknown>
  result: {
    artifacts: Array<{ artifactId: string; kind: string; contentType: string; bytes: number }>
    derived: Record<string, unknown> & { igbtDieIds: string[] | string; temperatureCsv: string }
    summary: Record<string, unknown> & { inputDigest: string }
    [key: string]: unknown
  }
}
function fetchResponse(headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'content-length': '16', 'x-artifact-sha256': digest }, body: ArrayBuffer = data) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), new RegExp(`${artifact.artifactId}\\?jobId=job-1`))
    assert.equal(init?.credentials, 'include')
    const authorization = new Headers(init?.headers).get('authorization')
    if (authorization !== null) assert.equal(authorization, 'Bearer synthetic')
    return new Response(body, { status: 200, headers })
  }
}

test('downloads authenticated raw bytes, verifies Host and local digest, then exports directory bundle files', async () => {
  const field = await downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: digest, spec, result, signal: new AbortController().signal, headers: { authorization: 'Bearer synthetic' }, fetchImpl: fetchResponse() })
  assert.deepEqual([...field.values], [20, 40])
  assert.equal(field.sha256, digest)
  const files = createThermalFieldExportFiles({ field, spec, result })
  assert.deepEqual(files.map(f => f.name), ['temperature.f64le', 'spec.json', 'result.json', 'manifest.json'])
  assert.deepEqual([...new Uint8Array(files[0]!.data as ArrayBuffer)], [...new Uint8Array(data)])
  assert.match(String(files[3]!.data), /"layout": "x-fastest"/)
  const written = new Map<string, string | ArrayBuffer>()
  function directory(prefix = ''): FileSystemDirectoryHandle {
    return { async getDirectoryHandle(name: string) { return directory(prefix ? `${prefix}/${name}` : name) }, async getFileHandle(name: string) {
      const key = prefix ? `${prefix}/${name}` : name
      return { async createWritable() { return { async write(content: string | BufferSource) { written.set(key, typeof content === 'string' ? content : content instanceof ArrayBuffer ? content : content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer) }, async close() {} } } }
    } } as unknown as FileSystemDirectoryHandle
  }
  await exportThermalFieldDirectory({ dir: directory(), runName: 'transient-run', field, spec, result, signal: new AbortController().signal })
  assert.equal(written.size, 4)
  assert.equal((written.get('transient-run/temperature.f64le') as ArrayBuffer).byteLength, 16)
  const legacyResult = { ...result, summary: { steps: 10, wallTimeMs: 1, tMin: 20, tMax: 40 } } as unknown as JobResultV1
  const legacyField = await downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: digest, spec, result: legacyResult, signal: new AbortController().signal, fetchImpl: fetchResponse() })
  assert.equal(legacyField.inputDigest, undefined)
})

test('rejects missing digest, wrong byte count, altered response bytes and non-finite values', async () => {
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: 'not-a-sha', spec, result, signal: new AbortController().signal, fetchImpl: fetchResponse() }), /SHA/)
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: digest, spec, result, signal: new AbortController().signal, fetchImpl: fetchResponse({ 'content-type': 'application/octet-stream', 'content-length': '16' }) }), /SHA-256/)
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: '0'.repeat(64), spec, result, signal: new AbortController().signal, fetchImpl: fetchResponse() }), /不一致/)
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact: { ...artifact, bytes: 8 }, expectedSha256: digest, spec, result, signal: new AbortController().signal, fetchImpl: fetchResponse() }), /不匹配/)
  const altered = new ArrayBuffer(16); new DataView(altered).setFloat64(0, 21, true)
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: digest, spec, result, signal: new AbortController().signal, fetchImpl: fetchResponse(undefined, altered) }), /SHA-256/)
  const infinite = new ArrayBuffer(16); new DataView(infinite).setFloat64(0, Infinity, true)
  const infiniteHash = createHash('sha256').update(new Uint8Array(infinite)).digest('hex')
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: infiniteHash, spec, result, signal: new AbortController().signal, fetchImpl: fetchResponse({ 'content-type': 'application/octet-stream', 'content-length': '16', 'x-artifact-sha256': infiniteHash }, infinite) }), /不是有限数/)
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: digest, spec: { ...spec, parameters: { ...spec.parameters, nx: '2' } } as unknown as JobSpecV1, result, signal: new AbortController().signal, fetchImpl: fetchResponse() }), /integer/)
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'job-1', artifact, expectedSha256: digest, spec, result, signal: aborted.signal, fetchImpl: fetchResponse() }), /abort/i)
})

test('downloads fields for inferred dimensions using gridN aliases', async () => {
  const inferredSpec = { kind: 'thermal-3d-transient', parameters: { dimension: null, lengthY: 1, nx: 3, ny: null, gridN: 2, units: { temperature: 'K' } } } as unknown as JobSpecV1
  const raw = new ArrayBuffer(6 * 8), view = new DataView(raw)
  for (let i = 0; i < 6; i++) view.setFloat64(i * 8, 280 + i, true)
  const sha = createHash('sha256').update(new Uint8Array(raw)).digest('hex')
  const ref = { artifactId: 'inferred-field', kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: 48 }
  const inferredDigest = 'fedcba9876543210fedcba9876543210'
  const inferredRef = { ...ref, artifactId: 'host-random-inferred-field' }
  const inferredResult = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1, inputDigest: inferredDigest }, derived: { fieldFormat: THERMAL_FIELD_FORMAT, fieldArtifactId: inferredRef.artifactId, fieldBytes: 48, cellCount: 6, temperatureUnit: 'K' } } as unknown as JobResultV1
  const loaded = await downloadThermalFieldArtifact({ jobId: 'job-1', artifact: inferredRef, expectedSha256: sha, spec: inferredSpec, result: inferredResult, signal: new AbortController().signal,
    fetchImpl: async () => new Response(raw, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '48', 'x-artifact-sha256': sha } }) })
  assert.equal(loaded.nx, 3); assert.equal(loaded.ny, 2); assert.equal(loaded.nz, 1)
  assert.deepEqual([...loaded.values], [280, 281, 282, 283, 284, 285])
  const explicit2d = { ...inferredSpec, parameters: { ...inferredSpec.parameters, dimension: 2, nz: 'ignored when inactive' } } as unknown as JobSpecV1
  const loaded2d = await downloadThermalFieldArtifact({ jobId: 'job-1', artifact: inferredRef, expectedSha256: sha, spec: explicit2d, result: inferredResult, signal: new AbortController().signal,
    fetchImpl: async () => new Response(raw, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '48', 'x-artifact-sha256': sha } }) })
  assert.equal(loaded2d.nz, 1)
})

test('reads and exports a saved 3D steady field plus the exact native KPI summary JSON', async () => {
  const steadySpec = { kind: 'thermal-3d-steady', parameters: {
    dimension: 3, gridN: 2, lengthX: 1, lengthY: 2, lengthZ: 3,
    units: { temperature: 'C', length: 'm' },
  } } as unknown as JobSpecV1
  const steadyDigest = '89abcdef0123456789abcdef01234567'
  const fieldBytes = new ArrayBuffer(8 * 8), fieldView = new DataView(fieldBytes)
  for (let i = 0; i < 8; i++) fieldView.setFloat64(i * 8, 300 + i, true)
  const fieldHash = createHash('sha256').update(new Uint8Array(fieldBytes)).digest('hex')
  const fieldArtifact = { artifactId: 'host-random-steady-field', kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: fieldBytes.byteLength }
  const summary = { steps: 18, tMin: 300, tMax: 307, inputDigest: steadyDigest, cellCount: 8, gridNx: 2, gridNy: 2, gridNz: 2, temperatureUnit: 'C' }
  const kpiBytes = new TextEncoder().encode(JSON.stringify(summary)).buffer
  const kpiHash = createHash('sha256').update(new Uint8Array(kpiBytes)).digest('hex')
  const kpiArtifact = { artifactId: 'host-random-steady-kpi', kind: 'thermal-kpi-summary', contentType: 'application/json', bytes: kpiBytes.byteLength }
  const result = { schemaVersion: 1, summary, derived: { fieldFormat: THERMAL_FIELD_FORMAT, fieldArtifactId: fieldArtifact.artifactId, fieldBytes: fieldBytes.byteLength, cellCount: 8, temperatureUnit: 'C' }, artifacts: [fieldArtifact, kpiArtifact] } as unknown as JobResultV1
  const field = await downloadThermalFieldArtifact({
    jobId: 'steady-job', artifact: fieldArtifact, expectedSha256: fieldHash, spec: steadySpec, result, signal: new AbortController().signal,
    fetchImpl: async (url) => {
      assert.match(String(url), new RegExp(`${fieldArtifact.artifactId}\\?jobId=steady-job`))
      return new Response(fieldBytes, { headers: { 'content-type': fieldArtifact.contentType, 'content-length': String(fieldArtifact.bytes), 'x-artifact-sha256': fieldHash } })
    },
  })
  const kpi = await downloadThermalKpiSummaryArtifact({
    jobId: 'steady-job', artifact: kpiArtifact, spec: steadySpec, result, expectedSha256: kpiHash, signal: new AbortController().signal,
    fetchImpl: async (url) => {
      assert.match(String(url), new RegExp(`${kpiArtifact.artifactId}\\?jobId=steady-job`))
      return new Response(kpiBytes, { headers: { 'content-type': kpiArtifact.contentType, 'content-length': String(kpiArtifact.bytes), 'x-artifact-sha256': kpiHash } })
    },
  })
  assert.equal(field.inputDigest, steadyDigest)
  assert.deepEqual([...field.values], [300, 301, 302, 303, 304, 305, 306, 307])
  assert.equal(kpi.inputDigest, steadyDigest)
  assert.deepEqual(kpi.summary, summary)
  const files = createThermalFieldExportFiles({ field, kpi, spec: steadySpec, result })
  assert.deepEqual(files.map(file => file.name), ['temperature.f64le', 'thermal-kpi-summary.json', 'spec.json', 'result.json', 'manifest.json'])
  assert.deepEqual([...new Uint8Array(files[1]!.data as ArrayBuffer)], [...new Uint8Array(kpiBytes)])
  const manifest = JSON.parse(String(files[4]!.data))
  assert.deepEqual(manifest.dimensions, { nx: 2, ny: 2, nz: 2 })
  assert.equal(manifest.inputDigest, steadyDigest)
  assert.deepEqual(manifest.kpi, { file: 'thermal-kpi-summary.json', bytes: kpiBytes.byteLength, sha256: kpiHash })
})

test('reads the retained spatial IGBT capture, binds its full field and KPI, and exports them unchanged', async () => {
  const fixture = new URL('../../../../../src/components/thermal/fixtures/igbt-spatial-single-die-robin-c/', import.meta.url)
  const captured = JSON.parse(readFileSync(new URL('native.json', fixture), 'utf8')) as CapturedSpatial
  const fieldRaw = readFileSync(new URL('temperature.f64le', fixture))
  const kpiRaw = readFileSync(new URL('summary.json', fixture))
  const fieldBytes = fieldRaw.buffer.slice(fieldRaw.byteOffset, fieldRaw.byteOffset + fieldRaw.byteLength) as ArrayBuffer
  const kpiBytes = kpiRaw.buffer.slice(kpiRaw.byteOffset, kpiRaw.byteOffset + kpiRaw.byteLength) as ArrayBuffer
  const hash = (bytes: ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
  const fieldHash = hash(fieldBytes), kpiHash = hash(kpiBytes)
  const nativeField = captured.result.artifacts.find(item => item.kind === THERMAL_FIELD_KIND)
  const nativeKpi = captured.result.artifacts.find(item => item.kind === 'thermal-kpi-summary')
  assert.ok(nativeField); assert.ok(nativeKpi)
  const fieldArtifact = { ...nativeField, artifactId: 'host-capture-field-id' }
  const kpiArtifact = { ...nativeKpi, artifactId: 'host-capture-kpi-id' }
  // The archived producer capture predates the string-shaped die-ID field. This protocol-only transform
  // preserves all saved physics/KPI/field bytes and matches the current public result contract.
  const result = {
    ...captured.result,
    artifacts: [fieldArtifact, kpiArtifact],
    derived: { ...captured.result.derived, fieldArtifactId: fieldArtifact.artifactId, igbtDieIds: JSON.stringify(captured.result.derived.igbtDieIds) },
  } as unknown as JobResultV1
  const spec = captured.spec as unknown as JobSpecV1
  const headers = (artifact: typeof fieldArtifact, digest: string) => ({ 'content-type': artifact.contentType, 'content-length': String(artifact.bytes), 'x-artifact-sha256': digest })
  const fetchImpl: typeof fetch = async url => {
    const isField = String(url).includes(fieldArtifact.artifactId)
    return new Response(isField ? fieldBytes : kpiBytes, { status: 200, headers: headers(isField ? fieldArtifact : kpiArtifact, isField ? fieldHash : kpiHash) })
  }
  const field = await downloadThermalFieldArtifact({ jobId: 'igbt-capture-job', artifact: fieldArtifact, expectedSha256: fieldHash, spec, result, signal: new AbortController().signal, fetchImpl })
  const kpi = await downloadThermalKpiSummaryArtifact({ jobId: 'igbt-capture-job', artifact: kpiArtifact, expectedSha256: kpiHash, spec, result, signal: new AbortController().signal, fetchImpl })
  assert.equal(field.values.length, 60)
  assert.deepEqual([...field.values], captured.result.derived.temperatureCsv.split(',').map(Number))
  assert.equal(field.sha256, fieldHash)
  assert.equal(kpi.sha256, kpiHash)
  assert.deepEqual(kpi.summary, captured.result.summary)
  const files = createThermalFieldExportFiles({ field, kpi, spec, result })
  assert.deepEqual(files.map(file => file.name), ['temperature.f64le', 'thermal-kpi-summary.json', 'spec.json', 'result.json', 'manifest.json'])
  assert.deepEqual(files[0]?.data, fieldBytes)
  assert.deepEqual(files[1]?.data, kpiBytes)
  const manifest = JSON.parse(String(files[4]?.data))
  assert.equal(manifest.method, 'thermal-igbt-spatial-chip-v1')
  assert.equal(manifest.inputDigest, captured.result.summary.inputDigest)
  assert.deepEqual(manifest.dimensions, { nx: 5, ny: 4, nz: 3 })
})

test('rejects spatial IGBT summary identity or ordered die-ID changes before fetching artifacts', async () => {
  const fixture = new URL('../../../../../src/components/thermal/fixtures/igbt-spatial-single-die-robin-c/', import.meta.url)
  const captured = JSON.parse(readFileSync(new URL('native.json', fixture), 'utf8')) as CapturedSpatial
  const raw = readFileSync(new URL('temperature.f64le', fixture)), bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const nativeField = captured.result.artifacts.find(item => item.kind === THERMAL_FIELD_KIND)
  assert.ok(nativeField)
  const artifact = { ...nativeField, artifactId: 'host-field' }
  const digest = createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
  const result = { ...captured.result, artifacts: [artifact], derived: { ...captured.result.derived, fieldArtifactId: artifact.artifactId, igbtDieIds: '["wrong-die"]' } } as unknown as JobResultV1
  let requests = 0
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'igbt-job', artifact, expectedSha256: digest, spec: captured.spec as unknown as JobSpecV1, result, signal: new AbortController().signal, fetchImpl: async () => { requests++; return new Response(bytes) } }), /die ID顺序/)
  assert.equal(requests, 0)
})

test('accepts spatial IGBT result protocol payloads for 9 and 16 dies, and rejects 17 before fetching', async () => {
  const fixture = new URL('../../../../../src/components/thermal/fixtures/igbt-spatial-single-die-robin-c/', import.meta.url)
  const captured = JSON.parse(readFileSync(new URL('native.json', fixture), 'utf8')) as CapturedSpatial
  const parameters = captured.spec.parameters as Record<string, unknown>
  const baseDies = parameters.dies as Array<Record<string, unknown>>
  const templateDie = baseDies[0]!
  const nativeField = captured.result.artifacts.find(item => item.kind === THERMAL_FIELD_KIND)!
  const artifact = { ...nativeField, artifactId: 'host-random-many-die-field' }
  const raw = readFileSync(new URL('temperature.f64le', fixture))
  const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const digest = createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
  const dieSuffixes = ['JunctionMeanC', 'JunctionMinC', 'JunctionMaxC', 'LossEvaluationTempC', 'ConductionLossW', 'SwitchingLossW', 'TotalLossW', 'EvaluatedLossW']

  for (const count of [9, 16]) {
    const ids = Array.from({ length: count }, (_, index) => `die-${index + 1}`)
    const dies = ids.map(id => ({ ...templateDie, id }))
    const summary: Record<string, unknown> = { ...captured.result.summary, dieCount: count }
    for (let index = 0; index < count; index++) for (const suffix of dieSuffixes) {
      summary[`die${index}${suffix}`] = captured.result.summary[`die0${suffix}`]
    }
    const spec = { ...captured.spec, parameters: { ...parameters, dies } } as unknown as JobSpecV1
    const result = {
      ...captured.result, summary, artifacts: [artifact],
      derived: { ...captured.result.derived, fieldArtifactId: artifact.artifactId, igbtDieIds: JSON.stringify(ids) },
    } as unknown as JobResultV1
    let requests = 0
    await assert.rejects(downloadThermalFieldArtifact({ jobId: `igbt-${count}-die`, artifact, expectedSha256: digest, spec, result, signal: new AbortController().signal, fetchImpl: async () => {
      requests++
      return new Response(null, { status: 503 })
    } }), /Host 下载失败 HTTP 503/)
    assert.equal(requests, 1, `${count}-die saved payload should pass admission and request its field`)
  }

  const ids17 = Array.from({ length: 17 }, (_, index) => `die-${index + 1}`)
  const summary17: Record<string, unknown> = { ...captured.result.summary, dieCount: 17 }
  for (let index = 0; index < 17; index++) for (const suffix of dieSuffixes) summary17[`die${index}${suffix}`] = captured.result.summary[`die0${suffix}`]
  const spec17 = { ...captured.spec, parameters: { ...parameters, dies: ids17.map(id => ({ ...templateDie, id })) } } as unknown as JobSpecV1
  const result17 = { ...captured.result, summary: summary17, artifacts: [artifact], derived: { ...captured.result.derived, fieldArtifactId: artifact.artifactId, igbtDieIds: JSON.stringify(ids17) } } as unknown as JobResultV1
  let requests17 = 0
  await assert.rejects(downloadThermalFieldArtifact({ jobId: 'igbt-17-die', artifact, expectedSha256: digest, spec: spec17, result: result17, signal: new AbortController().signal, fetchImpl: async () => {
    requests17++
    return new Response(null, { status: 503 })
  } }), /die清单无效/)
  assert.equal(requests17, 0)
})
