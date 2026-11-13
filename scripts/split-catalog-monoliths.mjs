#!/usr/bin/env node
/**
 * One-shot / idempotent split of mega catalog arrays into parts/ (#86 / #96).
 * Re-run is a no-op when barrels already import ./parts/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function extractArrayItems(src, exportName) {
  const marker = `export const ${exportName}`
  const start = src.indexOf(marker)
  if (start < 0) throw new Error(`export ${exportName} not found`)
  // Prefer `= [` so `FoundationalMethod[]` / `CalculationMethod[]` is not treated as the array.
  const eqBracket = src.indexOf('= [', start)
  const bracket = eqBracket >= 0 ? eqBracket + 2 : src.indexOf('[', start)
  if (bracket < 0) throw new Error(`array for ${exportName} not found`)
  const items = []
  let i = bracket + 1
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] === ',') {
      i++
      continue
    }
    if (src.startsWith('//', i)) {
      const eol = src.indexOf('\n', i)
      i = eol < 0 ? src.length : eol + 1
      continue
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (src[i] === ']') {
      return { items, header: src.slice(0, bracket + 1), footerStart: i }
    }
    if (src[i] !== '{') {
      i++
      continue
    }
    const objStart = i
    let depth = 0
    let inStr = null
    let escape = false
    for (; i < src.length; i++) {
      const c = src[i]
      if (inStr) {
        if (escape) {
          escape = false
          continue
        }
        if (c === '\\') {
          escape = true
          continue
        }
        if (c === inStr) inStr = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          i++
          items.push(src.slice(objStart, i).trim())
          break
        }
      }
    }
  }
  throw new Error(`unterminated array ${exportName}`)
}

function firstField(objSrc, field) {
  const m = objSrc.match(new RegExp(`(?:^|\\n)\\s*${field}:\\s*'([^']+)'`))
  return m ? m[1] : null
}

function exportIdent(id) {
  const raw = id.replace(/[^a-zA-Z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(raw) ? raw : `id_${raw}`
}

function writeFile(rel, text) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`)
}

function splitMethods() {
  const rel = 'src/data/methods/methods.data.ts'
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  if (src.includes("from './parts/")) {
    console.log('skip methods (already split)')
    return
  }
  const { items } = extractArrayItems(src, 'METHODS')
  if (items.length < 20) throw new Error(`methods split too small: ${items.length}`)
  const byKind = new Map()
  const order = []
  for (const item of items) {
    const id = firstField(item, 'id')
    const kind = firstField(item, 'kind') || 'unknown'
    if (!id) throw new Error('method object missing id')
    if (!byKind.has(kind)) {
      byKind.set(kind, [])
      order.push(kind)
    }
    byKind.get(kind).push({ id, item })
  }
  const imports = ["import type { FoundationalMethod } from './types'"]
  const spreads = []
  for (const kind of order) {
    const rows = byKind.get(kind)
    const ident = `METHODS_${kind.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
    const body = [
      "import type { FoundationalMethod } from '../types'",
      '',
      `export const ${ident}: FoundationalMethod[] = [`,
      rows.map((r) => `  ${r.item.replace(/\n/g, '\n  ')},`).join('\n'),
      ']',
      '',
    ].join('\n')
    writeFile(`src/data/methods/parts/${kind}.ts`, body)
    imports.push(`import { ${ident} } from './parts/${kind}'`)
    spreads.push(`  ...${ident},`)
  }
  writeFile(
    rel,
    [
      '/**',
      ' * Methods catalog barrel (#86 / #96).',
      ' * Edit a single kind in `parts/<kind>.ts` — do not re-monolith this file.',
      ' */',
      imports.join('\n'),
      '',
      'export const METHODS: FoundationalMethod[] = [',
      ...spreads,
      ']',
      '',
    ].join('\n'),
  )
  console.log(`methods: ${items.length} items → ${order.length} kind parts`)
}

function splitApplications() {
  const rel = 'src/data/applications/applications.data.ts'
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  if (src.includes("from './parts/")) {
    console.log('skip applications (already split)')
    return
  }
  const { items } = extractArrayItems(src, 'APPLICATIONS')
  if (items.length < 10) throw new Error(`applications split too small: ${items.length}`)
  const imports = ["import type { ApplicationProfile } from './types'"]
  const names = []
  for (const item of items) {
    const id = firstField(item, 'id')
    if (!id) throw new Error('application object missing id')
    const ident = exportIdent(id)
    writeFile(
      `src/data/applications/parts/${id}.ts`,
      [
        "import type { ApplicationProfile } from '../types'",
        '',
        `export const ${ident}: ApplicationProfile = ${item}`,
        '',
      ].join('\n'),
    )
    imports.push(`import { ${ident} } from './parts/${id}'`)
    names.push(ident)
  }
  writeFile(
    rel,
    [
      '/**',
      ' * Applications catalog barrel (#86 / #96).',
      ' * Edit one application in `parts/<id>.ts`.',
      ' */',
      imports.join('\n'),
      '',
      'export const APPLICATIONS: ApplicationProfile[] = [',
      names.map((n) => `  ${n},`).join('\n'),
      ']',
      '',
    ].join('\n'),
  )
  console.log(`applications: ${items.length} parts`)
}

function splitRegistry() {
  const rel = 'src/lib/principle-depth/registry.ts'
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  if (src.includes("from './parts/")) {
    console.log('skip registry (already split)')
    return
  }
  const { items, footerStart } = extractArrayItems(src, 'CALCULATION_METHODS')
  if (items.length < 5) throw new Error(`registry split too small: ${items.length}`)
  const footer = src.slice(footerStart + 1) // after closing ]
  const imports = []
  const spreads = []
  for (const item of items) {
    const id = firstField(item, 'id')
    if (!id) throw new Error('calculation method missing id')
    const ident = `CALCULATION_${exportIdent(id).toUpperCase()}`
    const needsAlfven = item.includes('alfvenExpected') || item.includes('METHOD_ALFVEN')
    const header = needsAlfven
      ? [
          "import type { CalculationMethod } from '../types'",
          'import {',
          '  METHOD_ALFVEN,',
          '  METHOD_ALGO_ALFVEN_V,',
          '  MU0,',
          '  DEFAULT_B,',
          '  DEFAULT_RHO,',
          '  alfvenSpeed,',
          "} from '../../sim/alfven-algos'",
          '',
          'const alfvenExpected = alfvenSpeed(DEFAULT_B, DEFAULT_RHO, MU0)',
          '',
        ]
      : ["import type { CalculationMethod } from '../types'", '']
    writeFile(
      `src/lib/principle-depth/parts/${id}.ts`,
      [...header, `export const ${ident}: CalculationMethod = ${item}`, ''].join('\n'),
    )
    imports.push(`import { ${ident} } from './parts/${id}'`)
    spreads.push(`  ${ident},`)
  }
  writeFile(
    rel,
    [
      '/**',
      ' * Seed calculation methods + principle trees (#86 / #96).',
      ' * Full residual trees live in `parts/<id>.ts`. Product UI uses PRODUCT_CALCULATION_METHODS.',
      ' */',
      "import type { CalculationMethod } from './types'",
      'import {',
      '  PRODUCT_CALCULATION_METHODS,',
      '  resolveDepthSpineId,',
      '  DEPTH_LEGACY_TO_SPINE,',
      "} from '../../data/methods/depthTrees.product'",
      imports.join('\n'),
      '',
      '/** Built-in methods for parallel multi-depth explain UI. */',
      'export const CALCULATION_METHODS: CalculationMethod[] = [',
      ...spreads,
      ']',
      footer.replace(/^\s*/, '\n'),
    ].join('\n'),
  )
  console.log(`registry: ${items.length} parts`)
}

splitMethods()
splitApplications()
splitRegistry()
console.log('split-catalog-monoliths done')
