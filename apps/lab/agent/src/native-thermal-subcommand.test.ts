import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { JobSpecV1 } from '@w-sim/contracts'
import { runNativeCudaSubcommand } from './backends/native-cuda.ts'
import { THERMAL_FIELD_KIND, THERMAL_HISTORY_KIND, THERMAL_KPI_KIND } from './native-thermal-artifacts.ts'

const spec = {
  schemaVersion: 1,
  kind: 'thermal-3d-transient',
  parameters: { dimension: 2, nx: 17, ny: 17, nz: 1, units: { temperature: 'C' } },
  run: { maxSteps: 1 }, outputs: { history: true },
} as unknown as JobSpecV1

async function fakeCli(root: string, mode: 'valid' | 'missing-field' | 'missing-history' = 'valid'): Promise<string> {
  const binary = path.join(root, `fake-w-sim-cuda-${mode}.mjs`)
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const mode = ${JSON.stringify(mode)}
const resultPath = process.argv[process.argv.indexOf('--result') + 1]
const work = path.dirname(resultPath)
const artifacts = path.join(work, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const fieldId = 'native-field-synthetic-1'
const historyId = 'native-history-synthetic-1'
const count = 17 * 17
const field = Buffer.alloc(count * 8)
for (let i = 0; i < count; i++) field.writeDoubleLE(20 + i / 100, i * 8)
const mean = Array.from({ length: count }, (_, i) => 20 + i / 100).reduce((a, b) => a + b, 0) / count
const history = Buffer.from(JSON.stringify({ step: [1], tMean: [mean] }))
if (mode !== 'missing-field') fs.writeFileSync(path.join(artifacts, fieldId), field)
if (mode !== 'missing-history') fs.writeFileSync(path.join(artifacts, historyId), history)
fs.writeFileSync(resultPath, JSON.stringify({
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1, gridNx: 17, gridNy: 17, gridNz: 1 },
  history: { step: [1], tMean: [mean] },
  artifacts: [
    { artifactId: fieldId, kind: 'thermal-temperature-field', contentType: 'application/octet-stream', bytes: field.length },
    { artifactId: historyId, kind: 'thermal-history', contentType: 'application/json', bytes: history.length },
  ],
  derived: { fieldFormat: 'float64-le-x-fastest-v1', fieldArtifactId: fieldId, historyArtifactId: historyId,
    cellCount: count, fieldBytes: field.length, fieldInline: 0, temperatureUnit: 'C' },
}))
`
  await writeFile(binary, script, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

async function setup(mode: 'valid' | 'missing-field' | 'missing-history' = 'valid') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ww-native-thermal-subcommand-'))
  const workDir = path.join(root, 'work')
  await mkdir(workDir)
  return { root, workDir, binary: await fakeCli(root, mode) }
}

async function fakeProgressCli(root: string): Promise<string> {
  const binary = path.join(root, 'fake-w-sim-cuda-progress.mjs')
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const resultPath = process.argv[process.argv.indexOf('--result') + 1]
fs.writeFileSync(path.join(path.dirname(path.dirname(path.dirname(resultPath))), 'child.pid'), String(process.pid))
process.stdout.write(JSON.stringify({ step: 1, total: 100 }) + '\\n')
setInterval(() => {}, 1000)
`
  await writeFile(binary, script, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

const steadySpec = {
  schemaVersion: 1,
  kind: 'thermal-3d-steady',
  parameters: { dimension: 3, nx: 2, ny: 2, nz: 2, lengthUnit: 'm', units: { temperature: 'C', length: 'm' } },
} as unknown as JobSpecV1

type SteadyMode = 'valid' | 'missing-field' | 'missing-kpi' | 'bad-csv' | 'bad-metadata'
async function fakeSteadyCli(root: string, mode: SteadyMode = 'valid'): Promise<string> {
  const binary = path.join(root, `fake-w-sim-cuda-steady-${mode}.mjs`)
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const mode = ${JSON.stringify(mode)}
const resultPath = process.argv[process.argv.indexOf('--result') + 1]
const work = path.dirname(resultPath)
const artifacts = path.join(work, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const fieldId = 'steady-field-synthetic-1'
const kpiId = 'steady-kpi-synthetic-1'
const values = [-0, 21, 22, 23, 24, 25, 26, 27]
const field = Buffer.alloc(values.length * 8)
for (let i = 0; i < values.length; i++) field.writeDoubleLE(values[i], i * 8)
const summary = { steps: 4, wallTimeMs: 2, gridNx: 2, gridNy: 2, gridNz: mode === 'bad-metadata' ? 1 : 2,
  cellCount: 8, inputDigest: '0123456789abcdef0123456789abcdef', tMin: 0, tMax: 27 }
const csv = mode === 'bad-csv' ? '20,21,22,23,24,25,26,27' : '0,21,22,23,24,25,26,27'
const result = {
  schemaVersion: 1,
  summary,
  artifacts: [
    { artifactId: fieldId, kind: 'thermal-temperature-field', contentType: 'application/octet-stream', bytes: field.length },
    { artifactId: kpiId, kind: 'thermal-kpi-summary', contentType: 'application/json', bytes: Buffer.byteLength(JSON.stringify(summary)) },
  ],
  derived: { fieldFormat: 'float64-le-x-fastest-v1', fieldArtifactId: fieldId, cellCount: 8, fieldBytes: field.length,
    fieldInline: 1, temperatureUnit: 'C', temperatureCsv: csv },
}
if (mode !== 'missing-field') fs.writeFileSync(path.join(artifacts, fieldId), field)
if (mode !== 'missing-kpi') fs.writeFileSync(path.join(artifacts, kpiId), JSON.stringify(summary))
fs.writeFileSync(resultPath, JSON.stringify(result))
`
  await writeFile(binary, script, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

async function setupSteady(mode: SteadyMode = 'valid') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ww-native-thermal-steady-'))
  const workDir = path.join(root, 'work')
  await mkdir(workDir)
  return { root, workDir, binary: await fakeSteadyCli(root, mode) }
}

const igbtSpec = {
  schemaVersion: 1, kind: 'electro-thermal-igbt',
  parameters: { mode: 'spatial-chip', dimension: 3, nx: 2, ny: 2, nz: 2, lengthX: 1, lengthY: 1, lengthZ: 1,
    units: { length: 'm', temperature: 'K' }, caseFace: 'front', boundaries: { front: { type: 'dirichlet', temperature: 298.15 } },
    dies: [{ id: 'die-A', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }],
    coupling: { maxJunctionTempC: 180, temperatureToleranceC: 1e-8, relativePowerTolerance: 1e-10 } },
  run: { maxSteps: 50000 }, outputs: { fields: ['temperature'] },
} as unknown as JobSpecV1

async function fakeIgbtCli(root: string): Promise<string> {
  const binary = path.join(root, 'fake-w-sim-cuda-igbt.mjs')
  const summary = {
    method: 'thermal-igbt-spatial-chip-v1', inputDigest: 'c'.repeat(32), cellCount: 8, gridNx: 2, gridNy: 2, gridNz: 2, dieCount: 1,
    converged: 1, convergenceStatus: 'converged', tMin: 298.15, tMax: 298.15, tjMaxC: 25, caseMeanC: 25,
    sourcePowerW: 1, totalLossW: 1, conductionLossW: 1, switchingLossW: 0, energyImbalance: 0, residual: 0,
    iterations: 1, steps: 1, wallTimeMs: 1, couplingIterations: 1, temperatureChangeC: 0, relativePowerChange: 0,
    heatFlowInW: -1, heatFlowLeftW: 0, heatFlowRightW: 0, heatFlowBottomW: 0, heatFlowTopW: 0, heatFlowFrontW: -1, heatFlowBackW: 0,
    die0JunctionMeanC: 25, die0JunctionMinC: 25, die0JunctionMaxC: 25, die0LossEvaluationTempC: 25,
    die0ConductionLossW: 1, die0SwitchingLossW: 0, die0TotalLossW: 1, die0EvaluatedLossW: 1,
  }
  const result = {
    schemaVersion: 1, backend: { id: 'native-cuda' }, summary,
    derived: { fieldFormat: 'float64-le-x-fastest-v1', dimension: 3, lengthUnit: 'm', cellCount: 8, fieldBytes: 64,
      fieldArtifactId: 'local-igbt-field', fieldInline: 1, temperatureCsv: Array(8).fill('298.15').join(','), temperatureUnit: 'K',
      inputDigest: 'c'.repeat(32), igbtDieIds: '["die-A"]' },
    artifacts: [
      { artifactId: 'local-igbt-field', kind: THERMAL_FIELD_KIND, contentType: 'application/octet-stream', bytes: 64 },
      { artifactId: 'local-igbt-kpi', kind: THERMAL_KPI_KIND, contentType: 'application/json', bytes: Buffer.byteLength(JSON.stringify(summary)) },
    ],
  }
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const resultPath = process.argv[process.argv.indexOf('--result') + 1]
const artifacts = path.join(path.dirname(resultPath), 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const field = Buffer.alloc(64); for (let i = 0; i < 8; i++) field.writeDoubleLE(298.15, i * 8)
fs.writeFileSync(path.join(artifacts, 'local-igbt-field'), field)
fs.writeFileSync(path.join(artifacts, 'local-igbt-kpi'), ${JSON.stringify(JSON.stringify(summary))})
fs.writeFileSync(resultPath, ${JSON.stringify(JSON.stringify(result))})
`
  await writeFile(binary, script, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

function ack(kind: string, contentType: string, bytes: ArrayBuffer, artifactId: string) {
  const data = Buffer.from(bytes)
  return { artifactId, kind, contentType, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }
}

async function assertClean(workDir: string) {
  assert.deepEqual(await readdir(workDir), [], 'native work directory should be removed after success or failure')
}

test('thermal-ss entry uploads synthetic artifacts before cleanup and returns Host IDs', async () => {
  const env = await setup(), uploads: Array<{ kind: string; bytes: Buffer; artifactId: string; workExists: boolean }> = []
  try {
    const result = await runNativeCudaSubcommand('thermal-ss', spec, {
      binary: env.binary, workDir: env.workDir,
      saveArtifact: async (kind, contentType, bytes) => {
        const dirs = await readdir(env.workDir)
        assert.equal(dirs.length, 1)
        const artifactPath = path.join(env.workDir, dirs[0]!, 'artifacts')
        assert.deepEqual((await readdir(artifactPath)).sort(), ['native-field-synthetic-1', 'native-history-synthetic-1'])
        uploads.push({ kind, bytes: Buffer.from(bytes), artifactId: `host-${uploads.length + 1}`, workExists: true })
        return ack(kind, contentType, bytes, `host-${uploads.length}`)
      },
    })
    assert.deepEqual(uploads.map(x => x.kind), [THERMAL_FIELD_KIND, THERMAL_HISTORY_KIND])
    assert.ok(uploads.every(x => x.workExists))
    assert.equal(uploads[0]!.bytes.byteLength, 17 * 17 * 8)
    assert.equal(result.derived?.fieldArtifactId, 'host-1')
    assert.equal(result.derived?.historyArtifactId, 'host-2')
    assert.deepEqual(result.artifacts?.map(a => a.artifactId), ['host-1', 'host-2'])
    assert.equal(result.derived?.fieldFormat, 'float64-le-x-fastest-v1')
    await assertClean(env.workDir)
  } finally { await rm(env.root, { recursive: true, force: true }) }
})

test('missing native files and missing uploader fail closed and clean the work directory', async () => {
  const missingField = await setup('missing-field')
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, { binary: missingField.binary, workDir: missingField.workDir,
      saveArtifact: async (kind, contentType, bytes) => ack(kind, contentType, bytes, 'host-artifact') }), /invalid size|ENOENT/)
    await assertClean(missingField.workDir)
  } finally { await rm(missingField.root, { recursive: true, force: true }) }

  const missingHistory = await setup('missing-history')
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, { binary: missingHistory.binary, workDir: missingHistory.workDir,
      saveArtifact: async (kind, contentType, bytes) => ack(kind, contentType, bytes, 'host-artifact') }), /invalid size|ENOENT/)
    await assertClean(missingHistory.workDir)
  } finally { await rm(missingHistory.root, { recursive: true, force: true }) }

  const noUploader = await setup()
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, { binary: noUploader.binary, workDir: noUploader.workDir }), /uploader/)
    await assertClean(noUploader.workDir)
  } finally { await rm(noUploader.root, { recursive: true, force: true }) }
})

test('bad upload acknowledgement and cancellation never publish a result and clean the work directory', async () => {
  const badAck = await setup()
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, { binary: badAck.binary, workDir: badAck.workDir,
      saveArtifact: async (kind, contentType, bytes) => ({ ...ack(kind, contentType, bytes, 'host-wrong'), bytes: 0 }) }), /acknowledgement/)
    await assertClean(badAck.workDir)
  } finally { await rm(badAck.root, { recursive: true, force: true }) }

  const cancelled = await setup(), controller = new AbortController(), sent: string[] = []
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, { binary: cancelled.binary, workDir: cancelled.workDir,
      saveArtifact: async (kind, contentType, bytes) => {
        sent.push(kind)
        controller.abort()
        return ack(kind, contentType, bytes, 'host-cancelled')
      },
    }, controller.signal), /abort/i)
    assert.deepEqual(sent, [THERMAL_FIELD_KIND], 'abort after first upload must prevent subsequent publication')
    await assertClean(cancelled.workDir)
  } finally { await rm(cancelled.root, { recursive: true, force: true }) }
})

test('spawn failure removes the abort listener and cleans the isolated work directory', async () => {
  const env = await setup()
  const controller = new AbortController()
  const signal = controller.signal
  const add = signal.addEventListener.bind(signal) as (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
  const remove = signal.removeEventListener.bind(signal) as (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void
  let abortListenersAdded = 0
  let abortListenersRemoved = 0
  signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'abort') abortListenersAdded++
    return add(type, listener, options)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'abort') abortListenersRemoved++
    return remove(type, listener, options)
  }) as typeof signal.removeEventListener
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, {
      binary: path.join(env.root, 'missing-native-cli'), workDir: env.workDir,
      saveArtifact: async (kind, contentType, bytes) => ack(kind, contentType, bytes, 'unused'),
    }, controller.signal))
    assert.equal(abortListenersAdded, 1)
    assert.equal(abortListenersRemoved, 1)
    await assertClean(env.workDir)
  } finally { await rm(env.root, { recursive: true, force: true }) }
})

test('progress cancellation kills the synthetic child before artifact upload and cleans its run directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ww-native-cancel-process-'))
  const workDir = path.join(root, 'work')
  await mkdir(workDir)
  const binary = await fakeProgressCli(root)
  const controller = new AbortController()
  let progressCount = 0
  let uploadCount = 0
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', spec, {
      binary, workDir,
      saveArtifact: async (kind, contentType, bytes) => {
        uploadCount++
        return ack(kind, contentType, bytes, 'unexpected-upload')
      },
    }, controller.signal, () => {
      progressCount++
      controller.abort(new DOMException('synthetic cancellation', 'AbortError'))
    }), /abort/i)
    assert.equal(progressCount, 1, 'the child must send a real JSONL progress line before cancellation')
    assert.equal(uploadCount, 0, 'the cancelled child must not publish result artifacts')
    const childPid = Number((await readFile(path.join(root, 'child.pid'), 'utf8')).trim())
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0)
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' }, 'the child must be gone after abort settles')
    await assertClean(workDir)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('thermal-ss uploads the steady field and descriptor-selected KPI before cleanup', async () => {
  const env = await setupSteady(), uploads: Array<{ kind: string; bytes: Buffer }> = []
  try {
    const result = await runNativeCudaSubcommand('thermal-ss', steadySpec, {
      binary: env.binary, workDir: env.workDir,
      saveArtifact: async (kind, contentType, bytes) => {
        const dirs = await readdir(env.workDir)
        assert.equal(dirs.length, 1)
        uploads.push({ kind, bytes: Buffer.from(bytes) })
        return ack(kind, contentType, bytes, `steady-host-${uploads.length}`)
      },
    })
    assert.deepEqual(uploads.map(x => x.kind), [THERMAL_FIELD_KIND, THERMAL_KPI_KIND])
    assert.equal(uploads[0]!.bytes.byteLength, 8 * 8)
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => uploads[0]!.bytes.readDoubleLE(i * 8)), [-0, 21, 22, 23, 24, 25, 26, 27])
    assert.deepEqual(result.artifacts?.map(a => a.artifactId), ['steady-host-1', 'steady-host-2'])
    assert.equal(result.derived?.fieldArtifactId, 'steady-host-1')
    assert.equal(result.derived?.kpiArtifactId, undefined)
    assert.deepEqual(JSON.parse(uploads[1]!.bytes.toString('utf8')), result.summary)
    const summary = result.summary as Record<string, unknown>
    assert.equal(summary.inputDigest, '0123456789abcdef0123456789abcdef')
    assert.deepEqual([summary.cellCount, summary.gridNx, summary.gridNy, summary.gridNz], [8, 2, 2, 2])
    assert.equal(summary.tMin, 0)
    assert.equal(summary.tMax, 27)
    assert.ok(Number.isFinite(summary.tMin) && Number.isFinite(summary.tMax))
    await assertClean(env.workDir)
  } finally { await rm(env.root, { recursive: true, force: true }) }
})

test('steady missing files, malformed field metadata/CSV, bad acknowledgement, and cancellation fail closed', async () => {
  for (const mode of ['missing-field', 'missing-kpi', 'bad-csv', 'bad-metadata'] as const) {
    const env = await setupSteady(mode)
    try {
      await assert.rejects(runNativeCudaSubcommand('thermal-ss', steadySpec, {
        binary: env.binary, workDir: env.workDir,
        saveArtifact: async (kind, contentType, bytes) => ack(kind, contentType, bytes, `steady-host-${mode}`),
      }))
      await assertClean(env.workDir)
    } finally { await rm(env.root, { recursive: true, force: true }) }
  }

  const badAck = await setupSteady()
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', steadySpec, {
      binary: badAck.binary, workDir: badAck.workDir,
      saveArtifact: async (kind, contentType, bytes) => ({ ...ack(kind, contentType, bytes, 'steady-bad-ack'), bytes: 0 }),
    }), /acknowledgement/)
    await assertClean(badAck.workDir)
  } finally { await rm(badAck.root, { recursive: true, force: true }) }

  const noUploader = await setupSteady()
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', steadySpec, { binary: noUploader.binary, workDir: noUploader.workDir }), /uploader/)
    await assertClean(noUploader.workDir)
  } finally { await rm(noUploader.root, { recursive: true, force: true }) }

  const cancelled = await setupSteady(), controller = new AbortController(), sent: string[] = []
  try {
    await assert.rejects(runNativeCudaSubcommand('thermal-ss', steadySpec, {
      binary: cancelled.binary, workDir: cancelled.workDir,
      saveArtifact: async (kind, contentType, bytes) => {
        sent.push(kind); controller.abort(); return ack(kind, contentType, bytes, 'steady-cancelled')
      },
    }, controller.signal), /abort/i)
    assert.deepEqual(sent, [THERMAL_FIELD_KIND])
    await assertClean(cancelled.workDir)
  } finally { await rm(cancelled.root, { recursive: true, force: true }) }
})

test('spatial-chip subcommand uploads native field and KPI before temp cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ww-native-igbt-subcommand-'))
  const workDir = path.join(root, 'work'); await mkdir(workDir)
  const binary = await fakeIgbtCli(root), uploaded: string[] = []
  try {
    const result = await runNativeCudaSubcommand('thermal-ss', igbtSpec, { binary, workDir,
      saveArtifact: async (kind, contentType, bytes) => {
        assert.equal((await readdir(workDir)).length, 1, 'native output files must still exist during upload')
        uploaded.push(kind)
        return ack(kind, contentType, bytes, `igbt-host-${uploaded.length}`)
      },
    })
    assert.deepEqual(uploaded, [THERMAL_FIELD_KIND, THERMAL_KPI_KIND])
    assert.deepEqual(result.artifacts?.map(ref => ref.artifactId), ['igbt-host-1', 'igbt-host-2'])
    assert.equal(result.derived?.fieldArtifactId, 'igbt-host-1')
    assert.equal(result.derived?.igbtDieIds, '["die-A"]')
    assert.deepEqual(await readdir(workDir), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})
