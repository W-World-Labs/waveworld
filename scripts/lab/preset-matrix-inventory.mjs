#!/usr/bin/env node
/**
 * LAB #49 auto residual: inventory all PRESET_MODELS with modelUrl on disk.
 * Done (checkable): count≥21, every modelUrl file exists under public/models,
 * each size in (0, 50MB], JSON report to stdout.
 *
 * Usage:
 *   node scripts/lab/preset-matrix-inventory.mjs
 *   LAB_MODELS_DIR=/path/to/public/models node scripts/lab/preset-matrix-inventory.mjs
 *
 * Exit 0 only when matrix is complete; non-zero on missing/oversized files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const wwRoot = path.resolve(__dirname, '../..')
const modelsDir =
  process.env.LAB_MODELS_DIR ||
  path.join(wwRoot, 'apps/lab/public/models')

// Load PRESET_MODELS via ts transpile-free path: read the source export with a
// minimal regex parse so we do not require tsx in ops probes.
const presetSrcPath = path.join(
  wwRoot,
  'apps/lab/src/lib/models/preset-models.ts',
)
const src = fs.readFileSync(presetSrcPath, 'utf8')
const idRe = /id:\s*'([^']+)'/g
const urlRe = /modelUrl:\s*'([^']+)'/g
const ids = [...src.matchAll(idRe)].map((m) => m[1])
const urls = [...src.matchAll(urlRe)].map((m) => m[1])
// Pair sequentially: each preset block has id then modelUrl (optional).
// Better: split by objects
const blocks = src.split(/\{\s*\n\s*id:/).slice(1)
const presets = []
for (const block of blocks) {
  const idM = block.match(/^\s*'([^']+)'/)
  const urlM = block.match(/modelUrl:\s*'([^']+)'/)
  if (!idM) continue
  presets.push({ id: idM[1], modelUrl: urlM?.[1] ?? null })
}

const withFile = presets.filter((p) => p.modelUrl)
const MAX_BYTES = 50 * 1024 * 1024
const rows = []
let missing = 0
let oversized = 0
for (const p of withFile) {
  const fileName = p.modelUrl.split('/').pop()
  const filePath = path.join(modelsDir, fileName)
  const exists = fs.existsSync(filePath)
  let size = 0
  if (exists) size = fs.statSync(filePath).size
  if (!exists) missing++
  if (exists && (size <= 0 || size > MAX_BYTES)) oversized++
  rows.push({
    id: p.id,
    file: fileName,
    exists,
    sizeBytes: size,
    ok: exists && size > 0 && size <= MAX_BYTES,
  })
}

const ok = missing === 0 && oversized === 0 && withFile.length >= 21
const report = {
  ok,
  schema: 'waveworld.lab-preset-matrix-inventory/v1',
  modelsDir,
  presetTotal: presets.length,
  withModelUrl: withFile.length,
  missing,
  oversized,
  floor: 21,
  rows,
}

console.log(JSON.stringify(report, null, 2))
if (!ok) {
  console.error(
    `FAIL: matrix incomplete withModelUrl=${withFile.length} missing=${missing} oversized=${oversized}`,
  )
  process.exit(1)
}
console.error(
  `OK: ${withFile.length} file presets present under ${modelsDir} (floor≥21)`,
)
