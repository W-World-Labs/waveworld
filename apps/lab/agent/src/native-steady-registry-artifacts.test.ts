import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { JobSpecV1 } from '@w-sim/contracts'
import { createAgentSolverRegistry } from './runners.ts'
import { invalidateNativeCudaProbeCache } from './backends/native-cuda.ts'

// This subprocess copies synthetic bytes only; it performs no numerical work.
test('steady 3D registry forwards the uploader and fails an automatic native delivery fault', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'steady-registry-files-'))
  const binary = path.join(root, 'synthetic-cli.mjs')
  await writeFile(binary, `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
if (process.argv.includes('--version')) {
  console.log(JSON.stringify({ version: 'synthetic-file-copy', features: ['thermal-3d-steady'] }))
} else {
  const resultPath = process.argv[process.argv.indexOf('--result') + 1]
  const field = Buffer.alloc(64)
  for (let i = 0; i < 8; i++) field.writeDoubleLE(20+i, i*8)
  const summary = { steps: 1, iterations: 1, wallTimeMs: 1, cellCount: 8,
    gridNx: 2, gridNy: 2, gridNz: 2, tMin: 20, tMax: 27,
    inputDigest: '0123456789abcdef0123456789abcdef' }
  const kpi = Buffer.from(JSON.stringify(summary))
  const dir = path.join(path.dirname(resultPath), 'artifacts')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'synthetic-field'), field)
  fs.writeFileSync(path.join(dir, 'synthetic-kpi'), kpi)
  fs.writeFileSync(resultPath, JSON.stringify({ schemaVersion: 1, summary,
    backend: { id: 'native-cuda', deviceName: 'synthetic file fixture' },
    artifacts: [{ artifactId: 'synthetic-field', kind: 'thermal-temperature-field', contentType: 'application/octet-stream', bytes: 64 },
      { artifactId: 'synthetic-kpi', kind: 'thermal-kpi-summary', contentType: 'application/json', bytes: kpi.length }],
    derived: { fieldArtifactId: 'synthetic-field', fieldFormat: 'float64-le-x-fastest-v1',
      fieldBytes: 64, cellCount: 8, temperatureUnit: 'C', fieldInline: 1, temperatureCsv: '20,21,22,23,24,25,26,27' } }))
}
`, { mode: 0o700 })
  const previous = { path: process.env.W_SIM_CUDA_PATH, backend: process.env.W_SIM_BACKEND }
  process.env.W_SIM_CUDA_PATH = binary
  process.env.W_SIM_BACKEND = 'auto'
  const spec = { schemaVersion: 1, kind: 'thermal-3d-steady', parameters: {
    dimension: 3, nx: 2, ny: 2, nz: 2, units: { temperature: 'C' },
  }, run: { maxSteps: 1 }, outputs: { fields: ['temperature'] } } as unknown as JobSpecV1
  try {
    invalidateNativeCudaProbeCache()
    const uploads: string[] = []
    const registry = createAgentSolverRegistry({ agentId: 'synthetic-registry', saveArtifact: async (kind, contentType, bytes) => {
      uploads.push(kind)
      return { artifactId: `host-${uploads.length}`, kind, contentType, bytes: bytes.byteLength, sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex') }
    } })
    const resolved = registry.resolve(spec)
    assert.equal(resolved.ok, true)
    if (!resolved.ok) throw new Error(resolved.message)
    const result = await resolved.runner.run(spec)
    assert.deepEqual(uploads, ['thermal-temperature-field', 'thermal-kpi-summary'])
    assert.equal(result.derived?.fieldArtifactId, 'host-1')
    const broken = createAgentSolverRegistry({ agentId: 'synthetic-upload-fault', saveArtifact: async () => { throw new Error('synthetic upload unavailable') } }).resolve(spec)
    assert.equal(broken.ok, true)
    if (!broken.ok) throw new Error(broken.message)
    await assert.rejects(broken.runner.run(spec), /synthetic upload unavailable/)
  } finally {
    if (previous.path === undefined) delete process.env.W_SIM_CUDA_PATH
    else process.env.W_SIM_CUDA_PATH = previous.path
    if (previous.backend === undefined) delete process.env.W_SIM_BACKEND
    else process.env.W_SIM_BACKEND = previous.backend
    invalidateNativeCudaProbeCache()
    await rm(root, { recursive: true, force: true })
  }
})
