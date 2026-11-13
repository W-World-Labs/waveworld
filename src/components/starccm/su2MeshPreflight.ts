/** Bounded, text-only preflight for the narrow ASCII SU2 mesh upload path. */
export const MAX_SU2_MESH_SOURCE_BYTES = 1024 * 1024
export const SU2_PREFLIGHT_MAX_LINE_BYTES = 16 * 1024
export const SU2_PREFLIGHT_MAX_POINTS = 262_144
export const SU2_PREFLIGHT_MAX_ELEMENTS = 262_144
export const SU2_PREFLIGHT_MAX_MARKERS = 4096

export type Su2MeshPreflightResult =
  | {
      ok: true
      normalizedText: string
      report: { ndime: 2 | 3; nodeCount: number; elementCount: number; markerCount: number; tags: string[] }
    }
  | { ok: false; error: string }

const ELEMENT_WIDTHS: Readonly<Record<number, number>> = {
  1: 1, 3: 2, 5: 3, 9: 4, 10: 4, 12: 8, 13: 6, 14: 5,
}
const INTEGER = /^\d+$/
const NUMBER = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/

interface Line { text: string; index: number }

function isIgnorable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('%')
}

function nextData(lines: string[], cursor: { value: number }, what: string): Line {
  while (cursor.value < lines.length && isIgnorable(lines[cursor.value])) cursor.value++
  if (cursor.value >= lines.length) throw new Error(`Missing ${what}`)
  const index = cursor.value++
  return { text: lines[index].trim(), index }
}

function header(line: string, name: string): number {
  const match = line.match(new RegExp(`^${name}\\s*=\\s*(\\d+)\\s*$`, 'i'))
  if (!match) throw new Error(`Expected ${name}= <count>`)
  const value = Number(match[1])
  if (!Number.isSafeInteger(value)) throw new Error(`${name} count is out of range`)
  return value
}

function tokens(line: string): string[] {
  return line.trim().split(/\s+/)
}

function validateElement(line: string, pointCount: number, ndime: number): void {
  const parts = tokens(line)
  if (!INTEGER.test(parts[0] ?? '')) throw new Error('Element type must be an integer')
  const code = Number(parts[0])
  const width = ELEMENT_WIDTHS[code]
  if (width === undefined) throw new Error(`Unsupported VTK linear element code ${parts[0]}`)
  if (width === 4 && code === 9 && ndime < 2) throw new Error('Element dimension exceeds NDIME')
  if ((code === 10 || code === 12 || code === 13 || code === 14) && ndime < 3) throw new Error('Element dimension exceeds NDIME')
  // SU2 permits an optional trailing element index.
  if (parts.length !== width + 1 && parts.length !== width + 2) throw new Error(`Wrong token count for VTK element ${code}`)
  for (const token of parts.slice(1, width + 1)) {
    if (!INTEGER.test(token) || Number(token) >= pointCount) throw new Error('Element node index is invalid or out of range')
  }
  if (parts.length === width + 2 && !INTEGER.test(parts[width + 1])) throw new Error('Element index must be a non-negative integer')
}

/**
 * Validate only canonical ASCII NDIME/NPOIN/NELEM/NMARK SU2 meshes and reorder
 * the two middle blocks to the section order consumed by the pinned importer.
 * No mesh values are synthesized or rewritten.
 */
export function preflightSu2MeshSource(source: string): Su2MeshPreflightResult {
  try {
    if (typeof source !== 'string') throw new Error('Mesh source must be text')
    if (source.length === 0) throw new Error('Mesh source is empty')
    if (utf8ByteLengthUpToLimit(source) > MAX_SU2_MESH_SOURCE_BYTES) throw new Error('Mesh exceeds the 1 MiB upload limit')
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i)
      if (code > 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
        throw new Error('Mesh must be ASCII text')
      }
    }
    const lfOnly = source.replace(/\r\n/g, '')
    if (lfOnly.includes('\r') || (source.includes('\r\n') && lfOnly.includes('\n'))) {
      throw new Error('Mesh must use consistent LF or CRLF line endings')
    }
    const lines = source.split(/\r?\n/)
    if (lines.some(line => line.length > SU2_PREFLIGHT_MAX_LINE_BYTES)) throw new Error('Mesh contains a line over the 16 KiB limit')
    // Exclude a possible terminal empty split while retaining original line endings.
    if (lines[lines.length - 1] === '') lines.pop()
    const cursor = { value: 0 }
    const ndimeLine = nextData(lines, cursor, 'NDIME header')
    const ndime = header(ndimeLine.text, 'NDIME')
    if (ndime !== 2 && ndime !== 3) throw new Error('NDIME must be 2 or 3')

    const firstSection = nextData(lines, cursor, 'NPOIN or NELEM header')
    const firstName = firstSection.text.match(/^([A-Za-z]+)\s*=/)?.[1]?.toUpperCase()
    if (firstName !== 'NPOIN' && firstName !== 'NELEM') throw new Error('Expected NPOIN or NELEM section')
    let pointHeader: Line
    let elementHeader: Line
    let pointCount: number
    let elementCount: number
    const pointFirst = firstName === 'NPOIN'
    let elementRows: string[] = []
    let pointRows: string[] = []
    if (pointFirst) {
      pointHeader = firstSection
      pointCount = header(pointHeader.text, 'NPOIN')
      if (pointCount < 1 || pointCount > SU2_PREFLIGHT_MAX_POINTS) throw new Error(`NPOIN must be between 1 and ${SU2_PREFLIGHT_MAX_POINTS}`)
      pointRows = readRows(lines, cursor, pointCount, 'point')
      elementHeader = nextData(lines, cursor, 'NELEM header')
      elementCount = header(elementHeader.text, 'NELEM')
      if (elementCount < 1 || elementCount > SU2_PREFLIGHT_MAX_ELEMENTS) throw new Error(`NELEM must be between 1 and ${SU2_PREFLIGHT_MAX_ELEMENTS}`)
      elementRows = readRows(lines, cursor, elementCount, 'element')
    } else {
      elementHeader = firstSection
      elementCount = header(elementHeader.text, 'NELEM')
      if (elementCount < 1 || elementCount > SU2_PREFLIGHT_MAX_ELEMENTS) throw new Error(`NELEM must be between 1 and ${SU2_PREFLIGHT_MAX_ELEMENTS}`)
      elementRows = readRows(lines, cursor, elementCount, 'element')
      pointHeader = nextData(lines, cursor, 'NPOIN header')
      pointCount = header(pointHeader.text, 'NPOIN')
      if (pointCount < 1 || pointCount > SU2_PREFLIGHT_MAX_POINTS) throw new Error(`NPOIN must be between 1 and ${SU2_PREFLIGHT_MAX_POINTS}`)
      pointRows = readRows(lines, cursor, pointCount, 'point')
    }
    for (let i = 0; i < pointRows.length; i++) {
      const row = tokens(pointRows[i])
      if (row.length !== ndime && row.length !== ndime + 1) throw new Error(`Point ${i} has the wrong coordinate count`)
      for (const token of row.slice(0, ndime)) {
        if (!NUMBER.test(token) || !Number.isFinite(Number(token))) throw new Error(`Point ${i} has a non-finite or invalid coordinate`)
      }
      if (row.length === ndime + 1 && !INTEGER.test(row[ndime])) throw new Error(`Point ${i} index must be a non-negative integer`)
    }
    for (let i = 0; i < elementRows.length; i++) validateElement(elementRows[i], pointCount, ndime)

    const markerHeader = nextData(lines, cursor, 'NMARK header')
    const markerCount = header(markerHeader.text, 'NMARK')
    if (markerCount > SU2_PREFLIGHT_MAX_MARKERS) throw new Error(`NMARK exceeds ${SU2_PREFLIGHT_MAX_MARKERS}`)
    const tags: string[] = []
    for (let marker = 0; marker < markerCount; marker++) {
      const tag = nextData(lines, cursor, `marker ${marker} tag`).text
      if (!/^MARKER_TAG\s*=\s*\S.*$/i.test(tag)) throw new Error('Expected MARKER_TAG= <name>')
      tags.push(tag.replace(/^MARKER_TAG\s*=\s*/i, ''))
      const markerElementHeader = nextData(lines, cursor, `marker ${marker} element header`)
      const markerElements = header(markerElementHeader.text, 'MARKER_ELEMS')
      if (markerElements > SU2_PREFLIGHT_MAX_ELEMENTS) throw new Error('Marker element count exceeds the element cap')
      for (let i = 0; i < markerElements; i++) validateElement(nextData(lines, cursor, `marker ${marker} element ${i}`).text, pointCount, ndime)
    }
    const trailing = nextDataOptional(lines, cursor)
    if (trailing) throw new Error('Unknown or trailing SU2 section/data is not supported')

    // Keep every source line in its original block. Only the NELEM and NPOIN
    // blocks move; line contents (including comments) remain byte-for-byte.
    const newline = source.includes('\r\n') ? '\r\n' : '\n'
    const original = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '').split('\n')
    const pointStart = pointHeader.index
    const elementStart = elementHeader.index
    const markerStart = markerHeader.index
    const prefix = original.slice(0, pointStart)
    const pointBlock = original.slice(pointStart, elementStart)
    const elementBlock = original.slice(elementStart, markerStart)
    const markerBlock = original.slice(markerStart)
    const normalizedLf = (pointFirst ? [...prefix, ...elementBlock, ...pointBlock, ...markerBlock] : original).join('\n')
      + (source.endsWith('\n') ? '\n' : '')
    const normalizedText = pointFirst
      ? (newline === '\n' ? normalizedLf : normalizedLf.replace(/\n/g, newline))
      : source
    return { ok: true, normalizedText, report: { ndime, nodeCount: pointCount, elementCount, markerCount, tags } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid SU2 mesh' }
  }
}

function utf8ByteLengthUpToLimit(source: string): number {
  let bytes = 0
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    const pairedSurrogate = code >= 0xd800 && code <= 0xdbff && i + 1 < source.length
      && source.charCodeAt(i + 1) >= 0xdc00 && source.charCodeAt(i + 1) <= 0xdfff
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : pairedSurrogate ? 4 : 3
    if (bytes > MAX_SU2_MESH_SOURCE_BYTES) return bytes
    if (pairedSurrogate) i++
  }
  return bytes
}

function readRows(lines: string[], cursor: { value: number }, count: number, label: string): string[] {
  const rows: string[] = []
  for (let i = 0; i < count; i++) rows.push(nextData(lines, cursor, `${label} ${i}`).text)
  return rows
}

function nextDataOptional(lines: string[], cursor: { value: number }): Line | null {
  while (cursor.value < lines.length && isIgnorable(lines[cursor.value])) cursor.value++
  if (cursor.value >= lines.length) return null
  const index = cursor.value++
  return { text: lines[index].trim(), index }
}
