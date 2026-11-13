import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { JobSpecV1 } from '@w-sim/contracts'
import { THERMAL_LAB_KIT } from '@w-sim/solvers-thermal'
import { createAgentSolverRegistry } from './runners.ts'
import { invalidateNativeCudaProbeCache } from './backends/native-cuda.ts'

const spatialFeature = 'thermal-igbt-spatial-chip-v1'
const spatialMode = THERMAL_LAB_KIT.modes.find(mode => mode.hostCapability.features?.includes(spatialFeature))!
const spatialSpec = spatialMode.defaultFixture() as JobSpecV1

async function withFakeNativeFeatures<T>(features: string[], run: () => T): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ww-agent-cuda-probe-'))
  const binary = path.join(dir, 'w-sim-cuda')
  await writeFile(binary, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ version: 'synthetic-probe', features })}'\n`)
  await chmod(binary, 0o755)
  const previousPath = process.env.W_SIM_CUDA_PATH
  process.env.W_SIM_CUDA_PATH = binary
  invalidateNativeCudaProbeCache()
  try { return run() }
  finally {
    if (previousPath === undefined) delete process.env.W_SIM_CUDA_PATH
    else process.env.W_SIM_CUDA_PATH = previousPath
    invalidateNativeCudaProbeCache()
    await rm(dir, { recursive: true, force: true })
  }
}

test('spatial-chip capability is absent without its exact native feature and legacy descriptor cannot claim it', async () => {
  await withFakeNativeFeatures(['electro-thermal-igbt'], () => {
    const registry = createAgentSolverRegistry({ agentId: 'synthetic-capability' })
    assert.equal(registry.get('w-sim-thermal-igbt-spatial-native-cuda'), undefined)
    const legacy = registry.get('w-sim-thermal-igbt-cpu')
    assert.ok(legacy)
    assert.equal(legacy.createRunner().canRun(spatialSpec), false)
    assert.equal(legacy.features?.includes(spatialFeature), false)
    const resolved = registry.resolve(spatialSpec)
    assert.equal(resolved.ok, false)
    assert.equal(legacy.createRunner().canRun({ ...spatialSpec, parameters: { mode: 'foster' } }), true)
  })
})

test('spatial-chip capability registers only when the exact feature is probed', async () => {
  await withFakeNativeFeatures([spatialFeature], () => {
    const registry = createAgentSolverRegistry({ agentId: 'synthetic-capability' })
    const spatial = registry.get('w-sim-thermal-igbt-cpu')
    assert.ok(spatial)
    assert.ok(spatial.features?.includes(spatialFeature))
    assert.deepEqual(spatial.outputs, ['history', 'kpis', 'fields'])
    assert.ok(spatial.backends.includes('native-cuda'))
    const resolved = registry.resolve(spatialSpec)
    assert.ok(resolved.ok)
    if (resolved.ok) assert.equal(resolved.runner.canRun(spatialSpec), true)
  })
})
