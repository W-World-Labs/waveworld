import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { materializeNativeThermalArtifacts, THERMAL_FIELD_FORMAT, THERMAL_FIELD_KIND, THERMAL_HISTORY_KIND, THERMAL_KPI_KIND } from '../../lab/agent/src/native-thermal-artifacts.ts'
import { TaskApiClient } from '../../lab/agent/src/client.ts'
import { downloadThermalFieldArtifact, downloadThermalKpiSummaryArtifact, exportThermalFieldDirectory } from '../../lab/src/lib/w-sim/thermal-field-artifact.ts'

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-thermal-artifact-route-'))
const previousEnv = new Map(['NODE_ENV', 'JOB_REQUIRE_AUTH', 'ARTIFACT_REQUIRE_AUTH', 'TASK_DB_PATH', 'ARTIFACT_ROOT'].map(name => [name, process.env[name]]))
Object.assign(process.env, { NODE_ENV: 'test' })
process.env.JOB_REQUIRE_AUTH = '1'
process.env.ARTIFACT_REQUIRE_AUTH = '1'
process.env.TASK_DB_PATH = path.join(directory, 'tasks.db')
process.env.ARTIFACT_ROOT = path.join(directory, 'artifact-store')

function restoreEnv(name: string): void {
  const value = previousEnv.get(name)
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const bearerPost = (url: string, token: string, body?: unknown, extra: Record<string, string> = {}) => new Request(url, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, ...extra, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

type Routes = {
  submit: typeof import('../src/app/api/v1/jobs/route').POST
  claim: typeof import('../src/app/api/v1/jobs/[id]/claim/route').POST
  heartbeat: typeof import('../src/app/api/v1/jobs/[id]/heartbeat/route').POST
  complete: typeof import('../src/app/api/v1/jobs/[id]/complete/route').POST
  fail: typeof import('../src/app/api/v1/jobs/[id]/fail/route').POST
  cancel: typeof import('../src/app/api/v1/jobs/[id]/cancel/route').POST
  getResult: typeof import('../src/app/api/v1/jobs/[id]/result/route').GET
  artifactPost: typeof import('../src/app/api/v1/artifacts/route').POST
  artifactGet: typeof import('../src/app/api/v1/artifacts/[id]/route').GET
  registerAgent: typeof import('../src/lib/tasks/auth-agent').registerAgent
  devLogin: typeof import('../src/lib/user-auth').devLogin
}
let routes: Routes

async function identities(name: string) {
  const user = await routes.devLogin({ name: `${name}-owner`, workspaceId: 'thermal-artifact-route-test' })
  const other = await routes.devLogin({ name: `${name}-other`, workspaceId: 'thermal-artifact-route-other' })
  const registered = await routes.registerAgent({ name: `${name}-agent`, capabilities: { backends: ['cpu', 'cuda', 'native-cuda'], kinds: ['thermal-3d-transient', 'thermal-3d-steady', 'electro-thermal-igbt'], features: ['thermal-igbt-spatial-chip-v1'] } })
  return { user, other, registered }
}

function syntheticSpec(name: string): JobSpecV1 {
  return {
    schemaVersion: 1, kind: 'thermal-3d-transient', name,
    parameters: {
      dimension: 2, lengthX: 1, lengthY: 1, nx: 17, ny: 17, nz: 1, conductivity: 1, density: 1, specificHeat: 1,
      initialTemp: 25, ambientTemp: 25,
      units: { length: 'm', temperature: 'C', conductivity: 'W/(m K)', power: 'W', heatFlux: 'W/m2' },
      boundaries: {}, integrator: 'explicit', dt: 0.01, nSteps: 1,
    },
    run: { maxSteps: 1 }, outputs: { history: true }, requirements: { backends: ['cpu'] },
  } as unknown as JobSpecV1
}

function syntheticResult(spec: JobSpecV1, localFieldId = 'thermal-T-synthetic123', localHistoryId = 'thermal-hist-synthetic123') {
  const values = new Float64Array(17 * 17)
  for (let i = 0; i < values.length; i++) values[i] = 20 + i / 16
  const fieldBytes = Buffer.alloc(values.length * 8)
  values.forEach((value, i) => fieldBytes.writeDoubleLE(value, i * 8))
  const history = { step: [1], tMin: [20], tMax: [36], tMean: [28] }
  const historyBytes = Buffer.from(JSON.stringify(history))
  const result = {
    schemaVersion: 1,
    summary: { steps: 1, wallTimeMs: 1, gridNx: 17, gridNy: 17, gridNz: 1, tMin: 20, tMax: 38 },
    history,
    backend: { id: 'cpu-thermal-transient' },
    artifacts: [
      { artifactId: localFieldId, kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: fieldBytes.byteLength },
      { artifactId: localHistoryId, kind: THERMAL_HISTORY_KIND, contentType: 'application/json', bytes: historyBytes.byteLength },
    ],
    derived: {
      fieldFormat: THERMAL_FIELD_FORMAT, fieldArtifactId: localFieldId, historyArtifactId: localHistoryId,
      fieldBytes: fieldBytes.byteLength, cellCount: 17 * 17, fieldInline: 0, temperatureUnit: 'C',
    },
  } as unknown as JobResultV1
  return { result, fieldBytes, historyBytes }
}

function syntheticSteadySpec(name: string): JobSpecV1 {
  return {
    schemaVersion: 1, kind: 'thermal-3d-steady', name,
    parameters: {
      dimension: 3, lengthX: 1, lengthY: 1, lengthZ: 1, nx: 3, ny: 3, nz: 3,
      conductivity: 10, density: 1000, specificHeat: 1000, sourcePowerW: 0,
      units: { length: 'm', temperature: 'C', conductivity: 'W/(m K)', power: 'W', heatFlux: 'W/m2' },
      boundaries: { left: { type: 'dirichlet', value: 20 }, right: { type: 'dirichlet', value: 20 },
        front: { type: 'dirichlet', value: 20 }, back: { type: 'dirichlet', value: 20 },
        bottom: { type: 'dirichlet', value: 20 }, top: { type: 'dirichlet', value: 20 } },
      backend: 'native-cuda', integrator: 'steady-fd-gs',
    },
    run: { maxSteps: 4 }, outputs: { fields: ['temperature'], kpis: true }, requirements: { backends: ['native-cuda'] },
  } as unknown as JobSpecV1
}

function syntheticSteadyResult(spec: JobSpecV1, localFieldId = 'thermal-T-steady-local', localKpiId = 'thermal-kpi-steady-local') {
  const values = new Float64Array(27).fill(20)
  const fieldBytes = Buffer.alloc(values.length * 8)
  values.forEach((value, i) => fieldBytes.writeDoubleLE(value, i * 8))
  const digest = 'a'.repeat(32)
  const summary = { steps: 4, wallTimeMs: 2, tMin: 20, tMax: 20, tjMaxC: 20, residual: 0, energyImbalance: 0,
    heatFlowInW: 0, sourcePowerW: 0, iterations: 4, gridNx: 3, gridNy: 3, gridNz: 3, cellCount: 27,
    converged: 1, analyticalMaxAbsError: 0, inputDigest: digest, solverPackage: '@w-sim/solvers-thermal', solverVersion: '0.1.0',
    contractVersion: 1, method: 'thermal-steady-fd-gs-v1', precision: 'float64', runtimeMs: 2, convergenceStatus: 'converged', warningCount: 0 }
  const kpiBytes = Buffer.from(JSON.stringify(summary))
  const result = {
    schemaVersion: 1, summary, backend: { id: 'native-cuda', provenance: { modelImplementationSha256: digest, dependencyLockSha256: digest } },
    artifacts: [
      { artifactId: localFieldId, kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: fieldBytes.byteLength },
      { artifactId: localKpiId, kind: THERMAL_KPI_KIND, contentType: 'application/json', bytes: kpiBytes.byteLength },
    ],
    derived: { fieldFormat: THERMAL_FIELD_FORMAT, dimension: 3, fieldArtifactId: localFieldId, fieldBytes: fieldBytes.byteLength,
      cellCount: values.length, fieldInline: 1, temperatureCsv: Array.from(values).join(','), temperatureUnit: 'C', lengthUnit: 'm' },
  } as unknown as JobResultV1
  return { result, fieldBytes, kpiBytes }
}

async function submitAndClaim(name: string, spec: JobSpecV1, identitiesValue: Awaited<ReturnType<typeof identities>>, testClientIp?: string) {
  // Each fixture is a separate client; keep the normal submission rate limit.
  const clientIp = testClientIp ?? `198.51.100.${1 + createHash('sha256').update(name).digest()[0]! % 254}`
  const submitted = await routes.submit(new Request('http://localhost/api/v1/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identitiesValue.user.token}`, 'X-Real-IP': clientIp },
    body: JSON.stringify({ spec }),
  }))
  assert.equal(submitted.status, 201, await submitted.clone().text())
  const jobId = (await submitted.json() as { job: { id: string } }).job.id
  const claimed = await routes.claim(bearerPost(`http://localhost/api/v1/jobs/${jobId}/claim`, identitiesValue.registered.token), ctx(jobId))
  assert.equal(claimed.status, 200, await claimed.clone().text())
  return jobId
}

async function writeNativeArtifacts(root: string, fieldId: string, historyId: string, field: Buffer, history: Buffer) {
  const dir = path.join(root, 'native-result')
  await mkdir(path.join(dir, 'artifacts'), { recursive: true })
  await writeFile(path.join(dir, 'artifacts', fieldId), field)
  await writeFile(path.join(dir, 'artifacts', historyId), history)
  return dir
}

async function materializeWithTaskApi(jobId: string, token: string, spec: JobSpecV1, result: JobResultV1, resultDir: string, signal?: AbortSignal, testClientIp?: string, afterUpload?: () => void) {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    if (testClientIp) headers.set('X-Real-IP', testClientIp)
    const request = new Request(url, { method: init?.method ?? 'GET', headers,
      ...(init?.body === undefined ? {} : { body: init.body as BodyInit }), ...(init?.signal ? { signal: init.signal } : {}) })
    if (url.pathname === '/api/v1/artifacts') {
      calls.push('artifact')
      return routes.artifactPost(request)
    }
    const match = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/heartbeat$/)
    if (match) {
      calls.push('heartbeat')
      return routes.heartbeat(request, ctx(decodeURIComponent(match[1]!)))
    }
    throw new Error(`unexpected TaskApiClient request ${url.pathname}`)
  }
  try {
    const client = new TaskApiClient('http://localhost', token)
    const settled = await materializeNativeThermalArtifacts(spec, result, resultDir,
      async (kind, contentType, bytes, artifactSignal) => {
        const ack = await client.uploadArtifact(jobId, kind, contentType, bytes, artifactSignal)
        afterUpload?.()
        return ack
      }, signal)
    return { settled, calls }
  } finally { globalThis.fetch = originalFetch }
}

async function complete(jobId: string, token: string, result: JobResultV1) {
  return routes.complete(bearerPost(`http://localhost/api/v1/jobs/${jobId}/complete`, token, { result }), ctx(jobId))
}

async function roundtripSteadyCapture(caseName: string, spec: JobSpecV1, original: JobResultV1, fieldBytes: Buffer, kpiBytes: Buffer, replayEvidenceDir?: string, testClientIp?: string) {
  const fieldLocalId = original.derived?.fieldArtifactId
  const kpiLocalId = original.artifacts?.find(a => a.kind === THERMAL_KPI_KIND)?.artifactId
  assert.equal(typeof fieldLocalId, 'string', `${caseName}: field artifact id missing`)
  assert.equal(typeof kpiLocalId, 'string', `${caseName}: KPI artifact id missing`)
  const who = await identities(`thermal-steady-${caseName}`)
  const jobId = await submitAndClaim(`thermal-steady-${caseName}`, spec, who, testClientIp)
  const source = await writeNativeArtifacts(directory, String(fieldLocalId), String(kpiLocalId), fieldBytes, kpiBytes)
  const upload = await materializeWithTaskApi(jobId, who.registered.token, spec, original, source, undefined, testClientIp)
  assert.deepEqual(upload.calls, ['heartbeat', 'artifact', 'heartbeat', 'artifact'], `${caseName}: TaskApiClient must upload both artifacts under a heartbeat lease`)
  const settled = upload.settled
  const completed = await complete(jobId, who.registered.token, settled)
  assert.equal(completed.status, 200, `${caseName}: ${await completed.clone().text()}`)
  const retry = await complete(jobId, who.registered.token, settled)
  assert.equal(retry.status, 200, `${caseName}: duplicate complete should remain idempotent`)

  const resultResponse = await routes.getResult(new Request(`http://localhost/api/v1/jobs/${jobId}/result`, { headers: { Authorization: `Bearer ${who.user.token}` } }), ctx(jobId))
  assert.equal(resultResponse.status, 200, `${caseName}: saved result GET failed`)
  const saved = await resultResponse.json() as { jobId: string; status: string; result: JobResultV1; artifacts: Array<{ id: string; jobId: string; sha256: string; bytes: number; kind: string; contentType: string }> }
  assert.equal(saved.jobId, jobId); assert.equal(saved.status, 'succeeded')
  assert.equal(saved.result.summary?.method, original.summary?.method, `${caseName}: solver method was not preserved`)
  assert.deepEqual(saved.result.summary, original.summary, `${caseName}: saved summary changed during Host settlement`)
  if (original.summary?.method === 'thermal-steady-fv-regions-v1' || original.summary?.method === 'thermal-igbt-spatial-chip-v1') {
    for (const face of ['heatFlowLeftW', 'heatFlowRightW', 'heatFlowFrontW', 'heatFlowBackW', 'heatFlowBottomW', 'heatFlowTopW']) {
      const expected = (original.summary as Record<string, unknown>)[face]
      assert.equal(typeof expected, 'number', `${caseName}: captured regional summary lacks ${face}`)
      assert.ok(Number.isFinite(expected), `${caseName}: captured ${face} is non-finite`)
      assert.equal((saved.result.summary as Record<string, unknown>)[face], expected, `${caseName}: saved ${face} changed`)
    }
  }
  if (original.summary?.method === 'thermal-igbt-spatial-chip-v1') {
    assert.equal(saved.result.derived?.igbtDieIds, original.derived?.igbtDieIds, `${caseName}: die identity order changed during settlement`)
    assert.equal(typeof saved.result.derived?.igbtDieIds, 'string')
    assert.deepEqual(JSON.parse(saved.result.derived!.igbtDieIds as string), (spec.parameters as { dies: Array<{ id: string }> }).dies.map(die => die.id))
  }
  const fieldRef = saved.result.artifacts!.find(a => a.kind === THERMAL_FIELD_KIND && a.artifactId === saved.result.derived?.fieldArtifactId)
  const kpiRef = saved.result.artifacts!.find(a => a.kind === THERMAL_KPI_KIND)
  assert.ok(fieldRef, `${caseName}: saved field ref missing`); assert.ok(kpiRef, `${caseName}: saved KPI ref missing`)
  const fieldMeta = saved.artifacts.find(a => a.id === fieldRef.artifactId)
  const kpiMeta = saved.artifacts.find(a => a.id === kpiRef.artifactId)
  assert.ok(fieldMeta?.sha256, `${caseName}: saved field SHA missing`); assert.ok(kpiMeta?.sha256, `${caseName}: saved KPI SHA missing`)
  const fetchSaved: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const id = new URL(url).pathname.split('/').at(-1)!
    return routes.artifactGet(new Request(url, { headers: init?.headers }), ctx(decodeURIComponent(id)))
  }
  const signal = new AbortController().signal
  const field = await downloadThermalFieldArtifact({ baseUrl: 'http://localhost', jobId, artifact: fieldRef, expectedSha256: fieldMeta.sha256,
    spec, result: saved.result, signal, headers: { Authorization: `Bearer ${who.user.token}` }, fetchImpl: fetchSaved })
  const kpi = await downloadThermalKpiSummaryArtifact({ baseUrl: 'http://localhost', jobId, artifact: kpiRef, expectedSha256: kpiMeta.sha256,
    spec, result: saved.result, signal, headers: { Authorization: `Bearer ${who.user.token}` }, fetchImpl: fetchSaved })
  assert.deepEqual(Buffer.from(field.bytes), fieldBytes, `${caseName}: downloaded field differs from producer bytes`)
  assert.deepEqual(Buffer.from(kpi.bytes), kpiBytes, `${caseName}: downloaded KPI differs from producer bytes`)
  assert.equal(kpi.summary.inputDigest, saved.result.summary?.inputDigest)

  const exportRoot = path.join(directory, `steady-export-${caseName}`)
  await exportThermalFieldDirectory({ dir: tempDirectoryHandle(exportRoot), runName: 'thermal-steady', field, kpi, spec, result: saved.result, signal })
  const bundle = path.join(exportRoot, 'thermal-steady')
  const exportedField = readFileSync(path.join(bundle, 'temperature.f64le'))
  const exportedKpi = readFileSync(path.join(bundle, 'thermal-kpi-summary.json'))
  const exportedManifest = readFileSync(path.join(bundle, 'manifest.json'))
  const manifest = JSON.parse(exportedManifest.toString('utf8')) as { dimensions: { nx: number; ny: number; nz: number }; sha256: string; kpi: { sha256: string } }
  assert.deepEqual(exportedField, fieldBytes); assert.deepEqual(exportedKpi, kpiBytes)
  assert.equal(manifest.sha256, fieldMeta.sha256); assert.equal(manifest.kpi.sha256, kpiMeta.sha256)
  assert.deepEqual([manifest.dimensions.nx, manifest.dimensions.ny, manifest.dimensions.nz], [saved.result.summary!.gridNx, saved.result.summary!.gridNy, saved.result.summary!.gridNz])
  if (replayEvidenceDir) {
    const evidenceCase = path.join(replayEvidenceDir, caseName)
    await mkdir(evidenceCase, { recursive: true })
    const exportedSpec = readFileSync(path.join(bundle, 'spec.json'))
    const exportedResult = readFileSync(path.join(bundle, 'result.json'))
    await Promise.all([
      writeFile(path.join(evidenceCase, 'temperature.f64le'), exportedField), writeFile(path.join(evidenceCase, 'thermal-kpi-summary.json'), exportedKpi),
      writeFile(path.join(evidenceCase, 'spec.json'), exportedSpec), writeFile(path.join(evidenceCase, 'result.json'), exportedResult), writeFile(path.join(evidenceCase, 'manifest.json'), exportedManifest),
      writeFile(path.join(evidenceCase, 'verification.json'), JSON.stringify({ caseName, jobId, status: saved.status,
        sourceArtifactIds: { field: fieldLocalId, kpi: kpiLocalId }, savedArtifactIds: { field: fieldMeta.id, kpi: kpiMeta.id },
        sourceFieldSha256: createHash('sha256').update(fieldBytes).digest('hex'), sourceKpiSha256: createHash('sha256').update(kpiBytes).digest('hex'),
        savedFieldSha256: fieldMeta.sha256, savedKpiSha256: kpiMeta.sha256,
        exportedFieldSha256: createHash('sha256').update(exportedField).digest('hex'), exportedKpiSha256: createHash('sha256').update(exportedKpi).digest('hex'),
        exportedSpecSha256: createHash('sha256').update(exportedSpec).digest('hex'), exportedResultSha256: createHash('sha256').update(exportedResult).digest('hex'),
        manifestSha256: createHash('sha256').update(exportedManifest).digest('hex'), dimensions: manifest.dimensions,
        method: saved.result.summary?.method,
        regionalFaceHeatFlowW: ['thermal-steady-fv-regions-v1', 'thermal-igbt-spatial-chip-v1'].includes(String(saved.result.summary?.method)) ? Object.fromEntries(
          ['heatFlowLeftW', 'heatFlowRightW', 'heatFlowFrontW', 'heatFlowBackW', 'heatFlowBottomW', 'heatFlowTopW'].map(face => [face, (saved.result.summary as Record<string, unknown>)[face]])
        ) : undefined }, null, 2) + '\n'),
    ])
  }
}

function tempDirectoryHandle(root: string): FileSystemDirectoryHandle {
  const createDirectory = (base: string): FileSystemDirectoryHandle => ({
    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
      const child = path.join(base, name)
      if (options?.create) await mkdir(child, { recursive: true })
      return createDirectory(child)
    },
    async getFileHandle(name: string) {
      const file = path.join(base, name)
      return { async createWritable() {
        return { async write(data: string | BufferSource) {
          const bytes = typeof data === 'string' ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          await writeFile(file, bytes)
        }, async close() {} }
      } }
    },
  } as unknown as FileSystemDirectoryHandle)
  mkdirSync(root, { recursive: true })
  return createDirectory(root)
}

describe('native thermal full-field artifact delivery over Host routes', () => {
  before(async () => {
    const [submit, claim, heartbeatRoute, completeRoute, fail, cancel, resultRoute, artifactRoute, artifactById, auth, userAuth] = await Promise.all([
      import('../src/app/api/v1/jobs/route.ts'), import('../src/app/api/v1/jobs/[id]/claim/route.ts'),
      import('../src/app/api/v1/jobs/[id]/heartbeat/route.ts'),
      import('../src/app/api/v1/jobs/[id]/complete/route.ts'), import('../src/app/api/v1/jobs/[id]/fail/route.ts'), import('../src/app/api/v1/jobs/[id]/cancel/route.ts'),
      import('../src/app/api/v1/jobs/[id]/result/route.ts'), import('../src/app/api/v1/artifacts/route.ts'),
      import('../src/app/api/v1/artifacts/[id]/route.ts'), import('../src/lib/tasks/auth-agent.ts'), import('../src/lib/user-auth.ts'),
    ])
    routes = { submit: submit.POST, claim: claim.POST, heartbeat: heartbeatRoute.POST, complete: completeRoute.POST, fail: fail.POST, cancel: cancel.POST, getResult: resultRoute.GET,
      artifactPost: artifactRoute.POST, artifactGet: artifactById.GET, registerAgent: auth.registerAgent, devLogin: userAuth.devLogin }
  })

  after(() => {
    rmSync(directory, { recursive: true, force: true })
    for (const name of previousEnv.keys()) restoreEnv(name)
  })

  it('uploads synthetic 17x17 field/history, completes idempotently, reloads verified bytes and exports a real directory bundle', async () => {
    const who = await identities('thermal-roundtrip')
    const spec = syntheticSpec('thermal roundtrip'), jobId = await submitAndClaim('thermal-roundtrip', spec, who)
    const local = syntheticResult(spec)
    const source = await writeNativeArtifacts(directory, 'thermal-T-synthetic123', 'thermal-hist-synthetic123', local.fieldBytes, local.historyBytes)
    const upload = await materializeWithTaskApi(jobId, who.registered.token, spec, local.result, source)
    const settled = upload.settled
    assert.deepEqual(upload.calls, ['heartbeat', 'artifact', 'heartbeat', 'artifact'], 'TaskApiClient must heartbeat before both real artifact POSTs')
    const firstComplete = await complete(jobId, who.registered.token, settled)
    assert.equal(firstComplete.status, 200, await firstComplete.clone().text())
    const firstBody = await firstComplete.json() as { job: { status: string; result: JobResultV1 } }
    assert.equal(firstBody.job.status, 'succeeded')
    const retry = await complete(jobId, who.registered.token, settled)
    assert.equal(retry.status, 200, await retry.clone().text())

    const resultResponse = await routes.getResult(new Request(`http://localhost/api/v1/jobs/${jobId}/result`, { headers: { Authorization: `Bearer ${who.user.token}` } }), ctx(jobId))
    assert.equal(resultResponse.status, 200, await resultResponse.clone().text())
    const loaded = await resultResponse.json() as { jobId: string; result: JobResultV1; artifacts: Array<{ id: string; sha256: string; bytes: number; kind: string; contentType: string }> }
    assert.equal(loaded.jobId, jobId)
    const fieldRef = loaded.result.artifacts!.find(a => a.kind === THERMAL_FIELD_KIND)!
    const fieldMeta = loaded.artifacts.find(a => a.id === fieldRef.artifactId)!
    assert.ok(fieldMeta.sha256)
    const downloaded = await downloadThermalFieldArtifact({ baseUrl: 'http://localhost', jobId, artifact: fieldRef, expectedSha256: fieldMeta.sha256,
      spec, result: loaded.result, signal: new AbortController().signal, headers: { Authorization: `Bearer ${who.user.token}` },
      fetchImpl: async (url, init) => routes.artifactGet(new Request(url, { headers: init?.headers }), ctx(fieldRef.artifactId)) })
    assert.equal(downloaded.sha256, fieldMeta.sha256)
    assert.deepEqual([...downloaded.values], Array.from({ length: 17 * 17 }, (_, i) => 20 + i / 16))

    const exportRoot = path.join(directory, 'user-export')
    await exportThermalFieldDirectory({ dir: tempDirectoryHandle(exportRoot), runName: 'thermal-257', field: downloaded,
      spec, result: loaded.result, signal: new AbortController().signal })
    const exportedBytes = readFileSync(path.join(exportRoot, 'thermal-257', 'temperature.f64le'))
    assert.deepEqual(exportedBytes, local.fieldBytes)
    const manifest = JSON.parse(readFileSync(path.join(exportRoot, 'thermal-257', 'manifest.json'), 'utf8')) as { sha256: string; bytes: number; dimensions: { nx: number } }
    assert.equal(manifest.sha256, createHash('sha256').update(local.fieldBytes).digest('hex'))
    assert.equal(manifest.bytes, local.fieldBytes.byteLength)
    assert.equal(manifest.dimensions.nx, 17)
    assert.equal(JSON.parse(readFileSync(path.join(exportRoot, 'thermal-257', 'result.json'), 'utf8')).summary.tMax, 38)

    const fieldUrl = `http://localhost/api/v1/artifacts/${fieldRef.artifactId}?jobId=${jobId}`
    const anonymous = await routes.artifactGet(new Request(fieldUrl), ctx(fieldRef.artifactId))
    assert.equal(anonymous.status, 401)
    const otherUser = await routes.artifactGet(new Request(fieldUrl, { headers: { Authorization: `Bearer ${who.other.token}` } }), ctx(fieldRef.artifactId))
    assert.ok(otherUser.status === 403 || otherUser.status === 404)
  })

  it('uploads synthetic explicit-3D steady field/KPI, then reloads both saved artifacts and exports them together', async () => {
    const spec = syntheticSteadySpec('steady KPI roundtrip')
    const local = syntheticSteadyResult(spec)
    await roundtripSteadyCapture('synthetic-steady', spec, local.result, local.fieldBytes, local.kpiBytes)
  })

  it('replays all captured explicit-3D steady field/KPI artifacts through real Host routes without solving', { skip: !process.env.THERMAL_STEADY_ARTIFACT_CAPTURE_ROOT }, async () => {
    const captureRoot = process.env.THERMAL_STEADY_ARTIFACT_CAPTURE_ROOT!
    const replayEvidenceDir = process.env.THERMAL_STEADY_ARTIFACT_REPLAY_EVIDENCE_DIR
    if (replayEvidenceDir) await mkdir(replayEvidenceDir, { recursive: true })
    const entries = (await readdir(captureRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort()
    const selected: Array<{ caseName: string; caseDir: string; spec: JobSpecV1; result: JobResultV1 }> = []
    for (const caseName of entries) {
      const caseDir = path.join(captureRoot, caseName)
      let wrapper: Record<string, unknown>
      try { wrapper = JSON.parse(await readFile(path.join(caseDir, 'native.json'), 'utf8')) as Record<string, unknown> }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const spec = wrapper.spec as JobSpecV1 | undefined
      const result = wrapper.result as JobResultV1 | undefined
      if (spec?.kind === 'thermal-3d-steady' && (spec.parameters as Record<string, unknown> | undefined)?.dimension === 3) {
        assert.ok(result, `${caseName}: 3D steady capture has no result`)
        selected.push({ caseName, caseDir, spec, result })
      }
    }
    assert.equal(selected.length, 18, 'real evidence set must contain exactly 18 explicit-3D steady cases (16 inline and 2 larger fields)')
    let small = 0, large = 0
    for (const { caseName, caseDir, spec, result } of selected) {
      const fieldId = result.derived?.fieldArtifactId
      const kpiId = result.artifacts?.find(a => a.kind === THERMAL_KPI_KIND)?.artifactId
      assert.equal(typeof fieldId, 'string', `${caseName}: field artifact reference missing`)
      assert.equal(typeof kpiId, 'string', `${caseName}: KPI artifact reference missing`)
      const fieldBytes = await readFile(path.join(caseDir, 'artifacts', String(fieldId)))
      const kpiBytes = await readFile(path.join(caseDir, 'artifacts', String(kpiId)))
      const cellCount = Number(result.derived?.cellCount)
      assert.equal(fieldBytes.byteLength, cellCount * 8, `${caseName}: field raw byte count differs from declared cells`)
      assert.equal(kpiBytes.byteLength, result.artifacts!.find(a => a.artifactId === kpiId)!.bytes, `${caseName}: KPI raw byte count differs from descriptor`)
      if (cellCount <= 256) small++; else large++
      await roundtripSteadyCapture(caseName, spec, result, fieldBytes, kpiBytes, replayEvidenceDir)
    }
    assert.equal(small, 16, 'steady capture set should contain sixteen inline field cases')
    assert.equal(large, 2, 'steady capture set should contain two non-inline field cases')
  })

  it('replays saved regional-material and uniform 3D steady captures through authenticated Host storage without solving', { skip: !process.env.THERMAL_STEADY_MATERIAL_ARTIFACT_CAPTURE_ROOT }, async () => {
    const captureRoot = process.env.THERMAL_STEADY_MATERIAL_ARTIFACT_CAPTURE_ROOT!
    const replayEvidenceDir = process.env.THERMAL_STEADY_MATERIAL_ARTIFACT_REPLAY_EVIDENCE_DIR
    const expectedCount = Number(process.env.THERMAL_STEADY_MATERIAL_ARTIFACT_EXPECTED_COUNT ?? '39')
    assert.ok(expectedCount === 39 || expectedCount === 43, 'expected capture count must be the initial 39 or final 43 case set')
    if (replayEvidenceDir) await mkdir(replayEvidenceDir, { recursive: true })
    const entries = (await readdir(captureRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort()
    const selected: Array<{ caseName: string; caseDir: string; spec: JobSpecV1; result: JobResultV1 }> = []
    for (const caseName of entries) {
      const caseDir = path.join(captureRoot, caseName)
      let wrapper: Record<string, unknown>
      try { wrapper = JSON.parse(await readFile(path.join(caseDir, 'native.json'), 'utf8')) as Record<string, unknown> }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const spec = wrapper.spec as JobSpecV1 | undefined
      const result = wrapper.result as JobResultV1 | undefined
      if (spec?.kind === 'thermal-3d-steady' && (spec.parameters as Record<string, unknown> | undefined)?.dimension === 3) {
        assert.ok(result, `${caseName}: explicit-3D native wrapper has no result`)
        selected.push({ caseName, caseDir, spec, result })
      }
    }
    assert.equal(selected.length, expectedCount, `material capture set must contain ${expectedCount} explicit-3D field/KPI pairs`)
    const byMethod = new Map<string, number>()
    let inlineCount = 0, nonInlineCount = 0
    for (let index = 0; index < selected.length; index++) {
      const { caseName, caseDir, spec, result } = selected[index]!
      const fieldId = result.derived?.fieldArtifactId
      const fieldRef = result.artifacts?.find(a => a.kind === THERMAL_FIELD_KIND && a.artifactId === fieldId)
      const kpiRef = result.artifacts?.find(a => a.kind === THERMAL_KPI_KIND)
      assert.equal(typeof fieldId, 'string', `${caseName}: field artifact reference missing`)
      assert.ok(fieldRef, `${caseName}: field descriptor does not match derived reference`)
      assert.ok(kpiRef, `${caseName}: KPI descriptor missing`)
      const fieldBytes = await readFile(path.join(caseDir, 'artifacts', fieldId as string))
      const kpiBytes = await readFile(path.join(caseDir, 'artifacts', kpiRef.artifactId))
      const expectedFieldBytes = Number(result.derived?.cellCount) * 8
      assert.equal(fieldBytes.byteLength, expectedFieldBytes, `${caseName}: captured field bytes do not equal declared f64 shape`)
      assert.equal(fieldRef.bytes, fieldBytes.byteLength, `${caseName}: field descriptor byte count mismatch`)
      assert.equal(kpiRef.bytes, kpiBytes.byteLength, `${caseName}: KPI descriptor byte count mismatch`)
      const files = JSON.parse(await readFile(path.join(caseDir, 'artifact-files.json'), 'utf8')) as Array<{ path: string; bytes: number; sha256: string }>
      for (const [relative, bytes] of [[`artifacts/${fieldId}`, fieldBytes], [`artifacts/${kpiRef.artifactId}`, kpiBytes]] as const) {
        const record = files.find(item => item.path === relative)
        assert.ok(record, `${caseName}: artifact-files.json is missing ${relative}`)
        assert.equal(record.bytes, bytes.byteLength, `${caseName}: captured byte manifest size differs for ${relative}`)
        assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'), `${caseName}: captured byte manifest SHA differs for ${relative}`)
      }
      const method = String(result.summary?.method)
      byMethod.set(method, (byMethod.get(method) ?? 0) + 1)
      if (Number(result.derived?.cellCount) <= 256) inlineCount++; else nonInlineCount++
      const clientIp = `198.51.100.${index + 1}`
      await roundtripSteadyCapture(caseName, spec, result, fieldBytes, kpiBytes, replayEvidenceDir, clientIp)
    }
    const regionalCount = expectedCount === 39 ? 33 : 37
    assert.equal(byMethod.get('thermal-steady-fv-regions-v1'), regionalCount, 'all expected regional-material steady cases must replay')
    assert.equal(byMethod.get('thermal-steady-fd-gs-v1'), 6, 'all six legacy uniform 3D cases must replay')
    assert.equal(byMethod.size, 2, 'capture set contains an unexpected 3D steady method')
    assert.equal(inlineCount + nonInlineCount, expectedCount)
    if (expectedCount === 39) {
      assert.equal(inlineCount, 37); assert.equal(nonInlineCount, 2)
    } else {
      assert.equal(inlineCount, 40); assert.equal(nonInlineCount, 3, 'final set includes the 7³ regional non-inline field')
    }
  })

  it('replays all saved spatial IGBT field/KPI captures through authenticated Host storage and export without solving', { skip: !process.env.IGBT_SPATIAL_ARTIFACT_CAPTURE_ROOT }, async () => {
    const captureRoot = process.env.IGBT_SPATIAL_ARTIFACT_CAPTURE_ROOT!
    const replayEvidenceDir = process.env.IGBT_SPATIAL_ARTIFACT_REPLAY_EVIDENCE_DIR
    const entries = (await readdir(captureRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    let positives = 0, negatives = 0, small = 0, large = 0
    const binaries = new Set<string>()
    for (const caseName of entries) {
      const caseDir = path.join(captureRoot, caseName)
      if (caseName.startsWith('negative-')) {
        const rejected = JSON.parse(await readFile(path.join(caseDir, 'native-error.json'), 'utf8'))
        assert.equal(rejected.artifactsCreated, false, `${caseName}: failed capture must not claim artifact files`)
        assert.equal(rejected.successResult, null)
        assert.deepEqual(rejected.failure.artifacts, [])
        negatives++
        continue
      }
      const captured = JSON.parse(await readFile(path.join(caseDir, 'native.json'), 'utf8')) as {
        spec: JobSpecV1; result: JobResultV1; sourceBinarySha256: string
      }
      const { spec, result } = captured
      assert.equal(spec.kind, 'electro-thermal-igbt')
      assert.equal((spec.parameters as { mode?: string }).mode, 'spatial-chip')
      assert.deepEqual(spec.requirements?.backends, ['native-cuda'], `${caseName}: replay must use the actual native product request`)
      assert.ok(spec.requirements?.features?.includes('thermal-igbt-spatial-chip-v1'))
      assert.equal(result.summary?.method, 'thermal-igbt-spatial-chip-v1')
      assert.equal(result.backend?.id, 'native-cuda')
      assert.match(captured.sourceBinarySha256, /^[a-f0-9]{64}$/)
      binaries.add(captured.sourceBinarySha256)
      const fieldId = result.derived?.fieldArtifactId
      const fieldRef = result.artifacts?.find(artifact => artifact.kind === THERMAL_FIELD_KIND && artifact.artifactId === fieldId)
      const kpiRef = result.artifacts?.find(artifact => artifact.kind === THERMAL_KPI_KIND)
      assert.ok(fieldRef && kpiRef, `${caseName}: both saved artifact descriptors are required`)
      const fieldBytes = await readFile(path.join(caseDir, 'artifacts', fieldRef.artifactId))
      const kpiBytes = await readFile(path.join(caseDir, 'artifacts', kpiRef.artifactId))
      const files = JSON.parse(await readFile(path.join(caseDir, 'artifact-files.json'), 'utf8')) as Array<{ path: string; bytes: number; sha256: string }>
      for (const [ref, bytes] of [[fieldRef, fieldBytes], [kpiRef, kpiBytes]] as const) {
        const record = files.find(file => file.path === `artifacts/${ref.artifactId}`)
        assert.ok(record, `${caseName}: captured artifact SHA ledger entry missing`)
        assert.equal(ref.bytes, bytes.byteLength)
        assert.equal(record.bytes, bytes.byteLength)
        assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'))
      }
      assert.deepEqual(JSON.parse(kpiBytes.toString('utf8')), result.summary, `${caseName}: producer KPI must equal the complete summary`)
      const count = Number(result.derived?.cellCount)
      assert.equal(fieldBytes.byteLength, count * 8)
      if (count <= 256) small++; else large++
      await roundtripSteadyCapture(`igbt-${caseName}`, spec, result, fieldBytes, kpiBytes, replayEvidenceDir, `203.0.113.${positives + 1}`)
      positives++
    }
    assert.equal(positives, 11, 'all eleven new-producer spatial IGBT captures must replay')
    assert.equal(negatives, 9, 'all nine native failures must remain explicit')
    assert.equal(small, 10); assert.equal(large, 1)
    assert.equal(binaries.size, 1, 'all positive files must come from the same frozen native producer')
  })

  it('replays the seven frozen IGBT boundary positives, including the exact 75-cell UI default, without solving', { skip: !process.env.IGBT_BOUNDARY_ARTIFACT_CAPTURE_ROOT || !process.env.IGBT_BOUNDARY_ARTIFACT_INPUT_ROOT }, async () => {
    // This is deliberately a separate capture root from the original 11-case
    // spatial matrix above; neither test may silently absorb the other's cases.
    const captureRoot = process.env.IGBT_BOUNDARY_ARTIFACT_CAPTURE_ROOT!
    const inputRoot = process.env.IGBT_BOUNDARY_ARTIFACT_INPUT_ROOT!
    const replayEvidenceDir = process.env.IGBT_BOUNDARY_ARTIFACT_REPLAY_EVIDENCE_DIR
    const plan = JSON.parse(await readFile(path.join(inputRoot, 'manifest.json'), 'utf8')) as {
      caseCounts: { positive: number; negative: number }
      cases: Array<{ id: string; file: string; kind: string; specSha256: string }>
      positiveCases: Array<{ id: string; file: string; specSha256: string; spec: JobSpecV1 }>
    }
    assert.equal(plan.caseCounts.positive, 7, 'frozen boundary plan must declare exactly seven positive cases')
    assert.equal(plan.caseCounts.negative, 4, 'frozen boundary plan must retain four separate negative cases')
    assert.equal(plan.positiveCases.length, plan.caseCounts.positive)
    const positiveIds = plan.positiveCases.map(item => item.id).sort()
    assert.equal(new Set(positiveIds).size, 7, 'positive plan case IDs must be unique')
    const records = new Map(plan.cases.map(record => [record.id, record]))
    for (const planned of plan.positiveCases) {
      const record = records.get(planned.id)
      assert.ok(record, `${planned.id}: positive case is missing from manifest case index`)
      assert.equal(record.kind, 'positive', `${planned.id}: plan/index classification differs`)
      assert.equal(record.file, planned.file)
      assert.equal(record.specSha256, planned.specSha256)
    }
    if (replayEvidenceDir) await mkdir(replayEvidenceDir, { recursive: true })
    const entries = (await readdir(captureRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    const capturedPositiveIds: string[] = []
    for (const caseName of entries) {
      if (caseName.startsWith('negative-')) continue
      try { await readFile(path.join(captureRoot, caseName, 'native.json')); capturedPositiveIds.push(caseName) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    assert.deepEqual(capturedPositiveIds, positiveIds, 'separate boundary capture root must contain exactly the seven planned positive cases')

    const binaries = new Set<string>()
    for (let index = 0; index < plan.positiveCases.length; index++) {
      const planned = plan.positiveCases[index]!
      const caseDir = path.join(captureRoot, planned.id)
      const wrapper = JSON.parse(await readFile(path.join(caseDir, 'native.json'), 'utf8')) as {
        spec: JobSpecV1; result: JobResultV1; sourceBinarySha256: string
      }
      const specBytes = await readFile(path.join(inputRoot, planned.file))
      assert.equal(createHash('sha256').update(specBytes).digest('hex'), planned.specSha256, `${planned.id}: frozen input spec SHA mismatch`)
      const specFromFile = JSON.parse(specBytes.toString('utf8')) as JobSpecV1
      assert.deepEqual(specFromFile, planned.spec, `${planned.id}: manifest spec differs from retained input bytes`)
      assert.deepEqual(wrapper.spec, specFromFile, `${planned.id}: native capture does not use the exact planned spec`)
      const { spec, result } = wrapper
      assert.equal(spec.kind, 'electro-thermal-igbt')
      assert.equal((spec.parameters as { mode?: string }).mode, 'spatial-chip')
      assert.deepEqual(spec.requirements?.backends, ['native-cuda'])
      assert.ok(spec.requirements?.features?.includes('thermal-igbt-spatial-chip-v1'))
      assert.equal(result.summary?.method, 'thermal-igbt-spatial-chip-v1')
      assert.equal(result.backend?.id, 'native-cuda')
      assert.match(wrapper.sourceBinarySha256, /^[a-f0-9]{64}$/)
      binaries.add(wrapper.sourceBinarySha256)
      const fieldId = result.derived?.fieldArtifactId
      const fieldRef = result.artifacts?.find(artifact => artifact.kind === THERMAL_FIELD_KIND && artifact.artifactId === fieldId)
      const kpiRef = result.artifacts?.find(artifact => artifact.kind === THERMAL_KPI_KIND)
      assert.ok(fieldRef && kpiRef, `${planned.id}: both saved field and KPI references are required`)
      const fieldBytes = await readFile(path.join(caseDir, 'artifacts', fieldRef.artifactId))
      const kpiBytes = await readFile(path.join(caseDir, 'artifacts', kpiRef.artifactId))
      const artifactFiles = JSON.parse(await readFile(path.join(caseDir, 'artifact-files.json'), 'utf8')) as Array<{ path: string; bytes: number; sha256: string }>
      for (const [reference, bytes] of [[fieldRef, fieldBytes], [kpiRef, kpiBytes]] as const) {
        const entry = artifactFiles.find(file => file.path === `artifacts/${reference.artifactId}`)
        assert.ok(entry, `${planned.id}: artifact byte ledger is missing ${reference.artifactId}`)
        assert.equal(reference.bytes, bytes.byteLength)
        assert.equal(entry.bytes, bytes.byteLength)
        assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'))
      }
      assert.deepEqual(JSON.parse(kpiBytes.toString('utf8')), result.summary, `${planned.id}: saved KPI payload differs from the full producer summary`)
      assert.equal(Number(result.derived?.cellCount), Number(result.summary?.gridNx) * Number(result.summary?.gridNy) * Number(result.summary?.gridNz))
      assert.equal(fieldBytes.byteLength, Number(result.derived?.cellCount) * 8)
      if (planned.id === 'bound-form-default') {
        assert.deepEqual([result.summary?.gridNx, result.summary?.gridNy, result.summary?.gridNz], [5, 5, 3])
        assert.equal(result.derived?.cellCount, 75)
        assert.equal(fieldBytes.byteLength, 600, 'the actual Wave form default must round-trip all 75 float64 temperatures')
      }
      await roundtripSteadyCapture(`igbt-bound-${planned.id}`, spec, result, fieldBytes, kpiBytes, replayEvidenceDir, `198.51.100.${101 + index}`)
    }
    assert.equal(binaries.size, 1, 'all seven boundary positives must come from one frozen native producer')
  })

  it('keeps spatial IGBT cancellation terminal before upload and after a real field upload ACK', { skip: !process.env.IGBT_SPATIAL_ARTIFACT_CAPTURE_ROOT }, async () => {
    const captureDir = path.join(process.env.IGBT_SPATIAL_ARTIFACT_CAPTURE_ROOT!, 'single-die-robin-c')
    const captured = JSON.parse(await readFile(path.join(captureDir, 'native.json'), 'utf8')) as { spec: JobSpecV1; result: JobResultV1 }
    const fieldId = captured.result.derived!.fieldArtifactId as string
    const kpiId = captured.result.artifacts!.find(artifact => artifact.kind === THERMAL_KPI_KIND)!.artifactId
    const field = await readFile(path.join(captureDir, 'artifacts', fieldId))
    const kpi = await readFile(path.join(captureDir, 'artifacts', kpiId))
    const { getJob } = await import('../src/lib/tasks/service.ts')
    const { getSqlite } = await import('../src/lib/tasks/db.ts')
    for (const stage of ['before-upload', 'after-first-upload'] as const) {
      const who = await identities(`spatial-cancel-${stage}`)
      const jobId = await submitAndClaim(`spatial-cancel-${stage}`, captured.spec, who)
      const resultDir = await writeNativeArtifacts(directory, fieldId, kpiId, field, kpi)
      const controller = new AbortController()
      let acknowledgedUploads = 0
      if (stage === 'before-upload') controller.abort()
      await assert.rejects(materializeWithTaskApi(jobId, who.registered.token, captured.spec, captured.result, resultDir, controller.signal, undefined, () => {
        acknowledgedUploads++
        controller.abort()
      }), /abort/i)
      assert.equal(acknowledgedUploads, stage === 'before-upload' ? 0 : 1)
      const stored = getSqlite().prepare('SELECT kind, sha256 FROM artifacts WHERE job_id = ?').all(jobId) as Array<{ kind: string; sha256: string }>
      assert.equal(stored.length, acknowledgedUploads)
      if (stored.length) {
        assert.equal(stored[0]!.kind, THERMAL_FIELD_KIND)
        assert.equal(stored[0]!.sha256, createHash('sha256').update(field).digest('hex'))
      }
      const cancelled = await routes.cancel(bearerPost(`http://localhost/api/v1/jobs/${jobId}/cancel`, who.user.token), ctx(jobId))
      assert.equal(cancelled.status, 200, await cancelled.clone().text())
      assert.equal(getJob(jobId)?.status, 'cancelled')
      assert.ok(!getJob(jobId)?.result, 'a partial artifact upload is not a successful result')
      const lateComplete = await complete(jobId, who.registered.token, captured.result)
      const lateFail = await routes.fail(bearerPost(`http://localhost/api/v1/jobs/${jobId}/fail`, who.registered.token, { error: 'late native SIGKILL', retryable: false }), ctx(jobId))
      assert.equal(lateComplete.status, 409)
      assert.equal(lateFail.status, 409)
      assert.equal(getJob(jobId)?.status, 'cancelled')
      if (process.env.IGBT_CANCEL_SETTLEMENT_EVIDENCE_DIR) {
        await mkdir(process.env.IGBT_CANCEL_SETTLEMENT_EVIDENCE_DIR, { recursive: true })
        await writeFile(path.join(process.env.IGBT_CANCEL_SETTLEMENT_EVIDENCE_DIR, `cancel-${stage}.json`), JSON.stringify({
          stage, jobId, status: getJob(jobId)?.status, acknowledgedUploads, storedArtifactKinds: stored.map(artifact => artifact.kind),
          retainedPartialArtifactIsDiagnosticOnly: stored.length === 1, resultStored: Boolean(getJob(jobId)?.result),
          lateCompleteStatus: lateComplete.status, lateFailStatus: lateFail.status,
          sourceFieldSha256: createHash('sha256').update(field).digest('hex'), solverExecuted: false,
        }, null, 2) + '\n')
      }
    }
  })

  it('settles captured spatial IGBT inner/outer failures and native wall timeout without successful results', { skip: !process.env.IGBT_SPATIAL_ARTIFACT_CAPTURE_ROOT || !process.env.IGBT_TIMEOUT_CAPTURE_FILE }, async () => {
    const captureRoot = process.env.IGBT_SPATIAL_ARTIFACT_CAPTURE_ROOT!
    const cases = [
      path.join(captureRoot, 'negative-reject-inner-thermal-exhaustion', 'native-error.json'),
      path.join(captureRoot, 'negative-reject-outer-coupling-exhaustion', 'native-error.json'),
      process.env.IGBT_TIMEOUT_CAPTURE_FILE!,
    ]
    const { getJob } = await import('../src/lib/tasks/service.ts')
    const { getSqlite } = await import('../src/lib/tasks/db.ts')
    for (const file of cases) {
      const bytes = await readFile(file)
      const failure = JSON.parse(bytes.toString('utf8')) as {
        spec: JobSpecV1; errorCode: string; artifactsCreated: boolean; successResult: unknown
        failure: { status: string; artifacts: unknown[]; error: { message: string } }
      }
      assert.equal(failure.artifactsCreated, false); assert.equal(failure.successResult, null)
      assert.equal(failure.failure.status, 'failed'); assert.deepEqual(failure.failure.artifacts, [])
      const who = await identities(`spatial-fail-${failure.errorCode}`)
      const jobId = await submitAndClaim(`spatial-fail-${failure.errorCode}`, failure.spec, who)
      const failed = await routes.fail(bearerPost(`http://localhost/api/v1/jobs/${jobId}/fail`, who.registered.token, {
        error: failure.failure.error.message, retryable: false,
      }), ctx(jobId))
      assert.equal(failed.status, 200, await failed.clone().text())
      assert.equal(getJob(jobId)?.status, 'failed')
      assert.ok(!getJob(jobId)?.result)
      const stored = getSqlite().prepare('SELECT kind FROM artifacts WHERE job_id = ?').all(jobId)
      assert.equal(stored.length, 0)
      const phantom = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'native-cuda' } } as JobResultV1
      const lateComplete = await complete(jobId, who.registered.token, phantom)
      assert.equal(lateComplete.status, 409)
      assert.equal(getJob(jobId)?.status, 'failed')
      if (process.env.IGBT_CANCEL_SETTLEMENT_EVIDENCE_DIR) {
        await mkdir(process.env.IGBT_CANCEL_SETTLEMENT_EVIDENCE_DIR, { recursive: true })
        await writeFile(path.join(process.env.IGBT_CANCEL_SETTLEMENT_EVIDENCE_DIR, `fail-${failure.errorCode}.json`), JSON.stringify({
          jobId, status: getJob(jobId)?.status, errorCode: failure.errorCode, failureCaptureSha256: createHash('sha256').update(bytes).digest('hex'),
          artifactCount: stored.length, resultStored: Boolean(getJob(jobId)?.result), lateCompleteStatus: lateComplete.status, solverExecuted: false,
        }, null, 2) + '\n')
      }
    }
  })

  it('keeps fail-closed preflight, cancellation, mismatched ownership and corrupt bytes from completing a job', async () => {
    const who = await identities('thermal-fail-closed')
    const spec = syntheticSpec('thermal fail closed')
    const local = syntheticResult(spec)
    const phantom = { ...local.result, artifacts: [...local.result.artifacts!, { artifactId: 'phantom', kind: 'unexpected', contentType: 'application/json', bytes: 1 }] } as JobResultV1
    const source = await writeNativeArtifacts(directory, 'thermal-T-synthetic123', 'thermal-hist-synthetic123', local.fieldBytes, local.historyBytes)
    let uploadCount = 0
    await assert.rejects(materializeNativeThermalArtifacts(spec, phantom, source, async () => { uploadCount++; throw new Error('unexpected uploader call') }), /exactly two/)
    assert.equal(uploadCount, 0)
    await assert.rejects(materializeNativeThermalArtifacts(spec, local.result, source, async () => { throw new Error('synthetic upload fault') }), /synthetic upload fault/)

    const jobId = await submitAndClaim('thermal-cancelled', spec, who)
    const cancelled = new AbortController(); cancelled.abort()
    await assert.rejects(materializeWithTaskApi(jobId, who.registered.token, spec, local.result, source, cancelled.signal), /abort/i)
    const cancelResponse = await routes.cancel(new Request(`http://localhost/api/v1/jobs/${jobId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${who.user.token}` } }), ctx(jobId))
    assert.equal(cancelResponse.status, 200, await cancelResponse.clone().text())
    assert.equal((await complete(jobId, who.registered.token, local.result)).status, 409)

    const tamperId = await submitAndClaim('thermal-corrupt', spec, who)
    const corruptSource = await writeNativeArtifacts(directory, 'thermal-T-synthetic123', 'thermal-hist-synthetic123', local.fieldBytes, local.historyBytes)
    const saved = (await materializeWithTaskApi(tamperId, who.registered.token, spec, local.result, corruptSource)).settled
    const { getSqlite } = await import('../src/lib/tasks/db.ts')
    const row = getSqlite().prepare('SELECT id, storage_key, owner_user_id FROM artifacts WHERE job_id = ? AND kind = ?').get(tamperId, THERMAL_FIELD_KIND) as { id: string; storage_key: string; owner_user_id: string }
    getSqlite().prepare('UPDATE artifacts SET owner_user_id = ? WHERE id = ?').run('other-user', row.id)
    const wrongOwner = await complete(tamperId, who.registered.token, saved)
    assert.equal(wrongOwner.status, 400, await wrongOwner.clone().text())
    getSqlite().prepare('UPDATE artifacts SET owner_user_id = ? WHERE id = ?').run(who.user.user.id, row.id)
    const absolute = path.join(process.env.ARTIFACT_ROOT!, row.storage_key)
    writeFileSync(absolute, Buffer.alloc(local.fieldBytes.byteLength, 0x7f))
    const corrupt = await complete(tamperId, who.registered.token, saved)
    assert.equal(corrupt.status, 400, await corrupt.clone().text())
  })

  it('rejects contradictory small inline temperatures before settlement and allows a corrected retry', async () => {
    const who = await identities('thermal-inline-integrity')
    const spec: JobSpecV1 = {
      schemaVersion: 1, kind: 'thermal-3d-transient', name: 'small inline integrity',
      parameters: {
        dimension: 2, lengthX: 1, lengthY: 1, nx: 4, ny: 4, conductivity: 1, density: 1, specificHeat: 1,
        units: { length: 'm', temperature: 'C', conductivity: 'W/(m·K)', power: 'W', heatFlux: 'W/m^2' },
        boundaries: { left: { type: 'insulated' }, right: { type: 'insulated' }, bottom: { type: 'insulated' }, top: { type: 'insulated' } },
        initialTemp: 25, dt: 0.001, nSteps: 1, backend: 'host',
      },
      run: { maxSteps: 1 }, outputs: { history: true, fields: ['temperature'] }, requirements: { thermal: true },
    }
    const temperatures = Array.from({ length: 16 }, (_, i) => 20 + i)
    const fieldBytes = Buffer.alloc(temperatures.length * 8)
    temperatures.forEach((value, i) => fieldBytes.writeDoubleLE(value, i * 8))
    const history = { step: [1], tMin: [20], tMax: [35], tMean: [27.5] }
    const historyBytes = Buffer.from(JSON.stringify(history))
    const localFieldId = 'thermal-T-inline-integrity', localHistoryId = 'thermal-hist-inline-integrity'
    const original: JobResultV1 = {
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1, gridNx: 4, gridNy: 4, gridNz: 1, tMin: 20, tMax: 35 },
      history, backend: { id: 'cpu-thermal-transient' },
      derived: { fieldFormat: THERMAL_FIELD_FORMAT, fieldArtifactId: localFieldId, historyArtifactId: localHistoryId,
        fieldBytes: fieldBytes.byteLength, cellCount: 16, fieldInline: 1, temperatureUnit: 'C', temperatureCsv: temperatures.join(',') },
      artifacts: [
        { artifactId: localFieldId, kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: fieldBytes.byteLength },
        { artifactId: localHistoryId, kind: THERMAL_HISTORY_KIND, contentType: 'application/json', bytes: historyBytes.byteLength },
      ],
    }
    const browserAttempt = await routes.submit(new Request('http://localhost/api/v1/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.user.token}` },
      body: JSON.stringify({ spec, execution: 'browser' }),
    }))
    assert.equal(browserAttempt.status, 400, await browserAttempt.clone().text())
    const jobId = await submitAndClaim('thermal-inline-integrity', spec, who)
    const source = await writeNativeArtifacts(directory, localFieldId, localHistoryId, fieldBytes, historyBytes)
    const settled = (await materializeWithTaskApi(jobId, who.registered.token, spec, original, source)).settled
    const { getJob } = await import('../src/lib/tasks/service.ts')
    for (const temperatureCsv of [undefined, '20,,22', temperatures.slice(1).join(','), [...temperatures].reverse().join(','),
      ['NaN', ...temperatures.slice(1)].join(','), [20.0000000001, ...temperatures.slice(1)].join(',')]) {
      const bad = { ...settled, derived: { ...settled.derived, temperatureCsv } }
      const rejected = await complete(jobId, who.registered.token, bad)
      assert.equal(rejected.status, 400, await rejected.clone().text())
      assert.equal(getJob(jobId)?.status, 'running', 'a rejected inline field must not settle or fail the active lease')
      assert.ok(!getJob(jobId)?.result)
    }
    const completed = await complete(jobId, who.registered.token, settled)
    assert.equal(completed.status, 200, await completed.clone().text())
    const retry = await complete(jobId, who.registered.token, settled)
    assert.equal(retry.status, 200, await retry.clone().text())
    assert.equal(getJob(jobId)?.status, 'succeeded')
  })

  it('can replay already captured native transient cases through the same real Host routes without solving', { skip: !process.env.THERMAL_ARTIFACT_CAPTURE_ROOT }, async () => {
    const captureRoot = process.env.THERMAL_ARTIFACT_CAPTURE_ROOT!
    const cases = await readdir(captureRoot, { withFileTypes: true })
    const entries = cases.filter(e => e.isDirectory()).map(e => e.name).sort()
    assert.ok(entries.length > 0, 'capture root must contain case directories')
    const positives: string[] = [], expectedNegatives: string[] = []
    for (const caseName of entries) {
      const caseDir = path.join(captureRoot, caseName)
      try { await readFile(path.join(caseDir, 'native-error.json')); expectedNegatives.push(caseName); continue }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      try { await readFile(path.join(caseDir, 'native.json')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${caseName}: expected native.json or native-error.json`); throw error }
      positives.push(caseName)
    }
    assert.equal(positives.length, 8, 'capture evidence must contain all eight positive cases')
    assert.equal(expectedNegatives.length, 2, 'capture evidence must explicitly mark both expected negative cases')
    const replayEvidenceDir = process.env.THERMAL_ARTIFACT_REPLAY_EVIDENCE_DIR
    if (replayEvidenceDir) await mkdir(replayEvidenceDir, { recursive: true })
    for (const caseName of positives) {
      const caseDir = path.join(captureRoot, caseName)
      const wrapper = JSON.parse(await readFile(path.join(caseDir, 'native.json'), 'utf8')) as Record<string, unknown>
      const spec = (wrapper.spec ?? (wrapper.job as Record<string, unknown> | undefined)?.spec) as JobSpecV1
      const rawResult = wrapper.result ?? (wrapper.job as Record<string, unknown> | undefined)?.result
      assert.ok(spec && rawResult && spec.kind === 'thermal-3d-transient', `${caseName}: native.json must embed exact spec and result`)
      const original = rawResult as JobResultV1
      const fieldLocalId = original.derived?.fieldArtifactId
      const historyLocalId = original.derived?.historyArtifactId
      assert.equal(typeof fieldLocalId, 'string', `${caseName}: field artifact id missing`)
      assert.equal(typeof historyLocalId, 'string', `${caseName}: history artifact id missing`)
      const fieldBytes = await readFile(path.join(caseDir, 'artifacts', String(fieldLocalId)))
      const historyBytes = await readFile(path.join(caseDir, 'artifacts', String(historyLocalId)))
      const sourceSpecSha256 = createHash('sha256').update(JSON.stringify(spec)).digest('hex')
      const sourceFieldSha256 = createHash('sha256').update(fieldBytes).digest('hex')
      const who = await identities(`thermal-capture-${caseName}`)
      const jobId = await submitAndClaim(`thermal-capture-${caseName}`, spec, who)
      const resultDir = await writeNativeArtifacts(directory, String(fieldLocalId), String(historyLocalId), fieldBytes, historyBytes)
      const settled = (await materializeWithTaskApi(jobId, who.registered.token, spec, original, resultDir)).settled
      const completeResponse = await complete(jobId, who.registered.token, settled)
      assert.equal(completeResponse.status, 200, `${caseName}: ${await completeResponse.clone().text()}`)
      const resultResponse = await routes.getResult(new Request(`http://localhost/api/v1/jobs/${jobId}/result`, { headers: { Authorization: `Bearer ${who.user.token}` } }), ctx(jobId))
      assert.equal(resultResponse.status, 200, `${caseName}: saved result GET failed`)
      const saved = await resultResponse.json() as { jobId: string; status: string; result: JobResultV1; artifacts: Array<{ id: string; jobId: string; sha256: string; bytes: number; kind: string; contentType: string }> }
      assert.equal(saved.jobId, jobId); assert.equal(saved.status, 'succeeded')
      const savedFieldRef = saved.result.artifacts!.find(a => a.kind === THERMAL_FIELD_KIND && a.artifactId === saved.result.derived?.fieldArtifactId)
      assert.ok(savedFieldRef, `${caseName}: completed result omitted field reference`)
      const savedMeta = saved.artifacts.find(a => a.id === savedFieldRef.artifactId)
      assert.ok(savedMeta, `${caseName}: saved result omitted field metadata`)
      assert.equal(savedMeta.jobId, jobId); assert.equal(savedMeta.kind, THERMAL_FIELD_KIND)
      assert.equal(savedMeta.bytes, fieldBytes.byteLength); assert.equal(savedMeta.contentType, 'application/octet-stream')
      const downloaded = await downloadThermalFieldArtifact({ baseUrl: 'http://localhost', jobId, artifact: savedFieldRef,
        expectedSha256: savedMeta.sha256, spec, result: saved.result, signal: new AbortController().signal,
        headers: { Authorization: `Bearer ${who.user.token}` },
        fetchImpl: async (url, init) => routes.artifactGet(new Request(url, { headers: init?.headers }), ctx(savedFieldRef.artifactId)) })
      assert.equal(downloaded.sha256, savedMeta.sha256, `${caseName}: downloaded field SHA differs from saved metadata`)
      assert.deepEqual(Buffer.from(downloaded.bytes), fieldBytes, `${caseName}: saved artifact bytes differ from captured native bytes`)

      const exportRoot = path.join(directory, `export-${caseName}`)
      await exportThermalFieldDirectory({ dir: tempDirectoryHandle(exportRoot), runName: `thermal-${caseName}`, field: downloaded,
        spec, result: saved.result, signal: new AbortController().signal })
      const bundleDir = path.join(exportRoot, `thermal-${caseName}`)
      const exportedBytes = readFileSync(path.join(bundleDir, 'temperature.f64le'))
      const exportedSpec = readFileSync(path.join(bundleDir, 'spec.json'))
      const exportedResult = readFileSync(path.join(bundleDir, 'result.json'))
      const manifestBytes = readFileSync(path.join(bundleDir, 'manifest.json'))
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as { format: string; fieldFormat: string; bytes: number; sha256: string; dimensions: { nx: number; ny: number; nz: number }; temperatureUnit: string }
      assert.deepEqual(exportedBytes, fieldBytes, `${caseName}: exported field bytes differ from native capture`)
      assert.equal(createHash('sha256').update(exportedBytes).digest('hex'), savedMeta.sha256, `${caseName}: exported SHA differs from saved metadata`)
      assert.equal(manifest.format, 'waveworld-thermal-field-export-v1')
      assert.equal(manifest.fieldFormat, THERMAL_FIELD_FORMAT); assert.equal(manifest.bytes, fieldBytes.byteLength)
      assert.equal(manifest.sha256, savedMeta.sha256); assert.equal(manifest.temperatureUnit, 'C')
      assert.deepEqual([manifest.dimensions.nx, manifest.dimensions.ny, manifest.dimensions.nz], [saved.result.summary!.gridNx, saved.result.summary!.gridNy, saved.result.summary!.gridNz])
      assert.deepEqual(JSON.parse(exportedSpec.toString('utf8')), spec)
      assert.deepEqual(JSON.parse(exportedResult.toString('utf8')), saved.result)

      if (replayEvidenceDir) {
        const evidenceCase = path.join(replayEvidenceDir, caseName)
        await mkdir(evidenceCase, { recursive: true })
        await Promise.all([
          writeFile(path.join(evidenceCase, 'temperature.f64le'), exportedBytes),
          writeFile(path.join(evidenceCase, 'spec.json'), exportedSpec),
          writeFile(path.join(evidenceCase, 'result.json'), exportedResult),
          writeFile(path.join(evidenceCase, 'manifest.json'), manifestBytes),
          writeFile(path.join(evidenceCase, 'verification.json'), JSON.stringify({
            caseName, sourceSpecSha256, sourceFieldSha256, savedMetaSha256: savedMeta.sha256,
            exportedFieldSha256: createHash('sha256').update(exportedBytes).digest('hex'),
            exportedSpecSha256: createHash('sha256').update(exportedSpec).digest('hex'),
            exportedResultSha256: createHash('sha256').update(exportedResult).digest('hex'),
            manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
            jobId, sourceArtifactIds: { field: fieldLocalId, history: historyLocalId },
            savedArtifactIds: { field: savedMeta.id }, dimensions: manifest.dimensions,
            bytes: exportedBytes.byteLength, status: saved.status,
          }, null, 2) + '\n'),
        ])
      }
    }
  })
})
