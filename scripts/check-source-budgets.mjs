#!/usr/bin/env node
/** Fail if catalog parts grow past per-file caps, or barrels re-monolith (#86 / #96). */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BARRELS = [
  ['src/data/methods/methods.data.ts', 120],
  ['src/data/applications/applications.data.ts', 200],
  ['src/lib/principle-depth/registry.ts', 120],
]

const PART_DIRS = [
  'src/data/methods/parts',
  'src/data/applications/parts',
  'src/lib/principle-depth/parts',
]

const PART_MAX = 4000
const REQUIRED_PARTS = [
  'src/data/methods/parts/wave.ts',
  'src/data/applications/parts/app-solar-cell.ts',
  'src/lib/principle-depth/parts/kind-lbm-d3q19.ts',
]

let failed = false

function countLines(rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8')
  return text.split(/\n/).length
}

for (const [rel, max] of BARRELS) {
  const lines = countLines(rel)
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  const ok = lines <= max && src.includes("from './parts/")
  console.log(`${ok ? 'ok' : 'FAIL'} barrel ${rel}: ${lines} / ${max}`)
  if (!ok) failed = true
}

for (const rel of REQUIRED_PARTS) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.log(`FAIL missing required part ${rel}`)
    failed = true
  }
}

for (const dir of PART_DIRS) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) {
    console.log(`FAIL missing parts dir ${dir}`)
    failed = true
    continue
  }
  const files = fs.readdirSync(abs).filter((n) => n.endsWith('.ts'))
  if (files.length < 3) {
    console.log(`FAIL ${dir}: only ${files.length} part files`)
    failed = true
  }
  for (const name of files) {
    const rel = `${dir}/${name}`
    const lines = countLines(rel)
    const ok = lines <= PART_MAX
    if (!ok || lines > PART_MAX - 200) {
      console.log(`${ok ? 'ok' : 'FAIL'} part ${rel}: ${lines} / ${PART_MAX}`)
    }
    if (!ok) failed = true
  }
  console.log(`ok ${dir}: ${files.length} files, each <= ${PART_MAX}`)
}

const testRel = 'src/lib/principle-depth/principle-depth.test.ts'
const testLines = countLines(testRel)
const testMax = 5500
const testOk = testLines <= testMax
console.log(`${testOk ? 'ok' : 'FAIL'} ${testRel}: ${testLines} / ${testMax}`)
if (!testOk) failed = true

if (failed) process.exit(1)
