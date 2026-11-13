/**
 * Bounded, reference-only reader for the NM glass index in OpticStudio AGF.
 * Dispersion coefficients and the associated property records are preserved
 * as metadata; this module does not evaluate or otherwise interpret them.
 */

export const OPTICSTUDIO_AGF_MAX_BYTES = 4 * 1024 * 1024
export const OPTICSTUDIO_AGF_MAX_LINES = 100_000
export const OPTICSTUDIO_AGF_MAX_GLASSES = 20_000
export const OPTICSTUDIO_AGF_MAX_LINE_LENGTH = 4_096

export const OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE =
  'Associated AGF source record retained verbatim; this parser does not evaluate coefficients or properties.'

export type OpticStudioAgfGlassStatus =
  | 'standard'
  | 'preferred'
  | 'obsolete'
  | 'special'
  | 'melt'

export interface OpticStudioAgfMetadataRow {
  line: number
  tag: string
  raw: string
  scopeNote: typeof OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE
}

export interface OpticStudioAgfGlass {
  name: string
  formulaId: number
  milNumber: string
  nd: number
  vd: number
  excludeSubstitution: boolean
  statusId: number
  status: OpticStudioAgfGlassStatus
  meltFrequency?: number
  metadata: OpticStudioAgfMetadataRow[]
}

export interface OpticStudioAgfIssue {
  code: string
  message: string
  line?: number
}

export interface OpticStudioAgfParseResult {
  glasses: OpticStudioAgfGlass[]
  diagnostics: OpticStudioAgfIssue[]
  errors: OpticStudioAgfIssue[]
}

const STATUS_BY_ID: readonly OpticStudioAgfGlassStatus[] = [
  'standard',
  'preferred',
  'obsolete',
  'special',
  'melt',
]

const KNOWN_TAG_FIELD_COUNTS: Record<string, { min: number; max: number }> = {
  ED: { min: 5, max: 5 },
  CD: { min: 1, max: 10 },
  TD: { min: 7, max: 7 },
  MD: { min: 5, max: 5 },
  OD: { min: 6, max: 6 },
  LD: { min: 2, max: 2 },
  IT: { min: 3, max: 3 },
  BD: { min: 4, max: 4 },
}

function issue(code: string, message: string, line?: number): OpticStudioAgfIssue {
  return line === undefined ? { code, message } : { code, message, line }
}

function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      i += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

function finiteNumber(token: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
    return undefined
  }
  const value = Number(token)
  return Number.isFinite(value) ? value : undefined
}

/** Parse AGF catalog text into a bounded reference-index catalog. */
export function parseOpticStudioAgfGlass(
  text: string,
): OpticStudioAgfParseResult {
  const errors: OpticStudioAgfIssue[] = []
  const diagnostics: OpticStudioAgfIssue[] = []
  const glasses: OpticStudioAgfGlass[] = []
  const fail = (code: string, message: string, line?: number) => {
    errors.push(issue(code, message, line))
  }

  if (!isWellFormedUnicode(text)) {
    fail('invalid-unicode', 'Input contains an unpaired Unicode surrogate.')
    return { glasses: [], diagnostics, errors }
  }
  if (text.includes('\ufffd')) {
    fail('replacement-character', 'Input contains a Unicode replacement character; source encoding may be invalid.')
    return { glasses: [], diagnostics, errors }
  }
  if (text.indexOf('\ufeff', text.startsWith('\ufeff') ? 1 : 0) !== -1) {
    fail('unsupported-bom', 'A byte-order mark is only supported at the beginning of AGF text input.')
    return { glasses: [], diagnostics, errors }
  }
  if (new TextEncoder().encode(text).byteLength > OPTICSTUDIO_AGF_MAX_BYTES) {
    fail('input-too-large', `Input exceeds the ${OPTICSTUDIO_AGF_MAX_BYTES}-byte safety limit.`)
    return { glasses: [], diagnostics, errors }
  }
  // Count the BOM in the byte limit, then remove its non-semantic prefix.
  const source = text.startsWith('\ufeff') ? text.slice(1) : text
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(source)) {
    fail('unsupported-control-character', 'Input contains a disallowed control character.')
    return { glasses: [], diagnostics, errors }
  }

  const lines = source.split(/\r\n|\n|\r/)
  if (lines.length > OPTICSTUDIO_AGF_MAX_LINES) {
    fail('too-many-lines', `Input exceeds the ${OPTICSTUDIO_AGF_MAX_LINES}-line safety limit.`)
    return { glasses: [], diagnostics, errors }
  }

  const seenNames = new Set<string>()
  let current: OpticStudioAgfGlass | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const raw = lines[index]
    if (raw.length > OPTICSTUDIO_AGF_MAX_LINE_LENGTH) {
      fail('line-too-long', `Line exceeds the ${OPTICSTUDIO_AGF_MAX_LINE_LENGTH}-character safety limit.`, lineNumber)
      continue
    }

    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed.startsWith('!')) continue
    const separator = trimmed.search(/\s/u)
    if (separator < 0) {
      fail('malformed-record', 'Record is missing its tag payload.', lineNumber)
      continue
    }
    const tag = trimmed.slice(0, separator)
    const payload = trimmed.slice(separator).trim()
    if (!/^[A-Z]{2}$/.test(tag)) {
      fail('malformed-tag', 'Record tag must be exactly two uppercase ASCII letters.', lineNumber)
      continue
    }
    if (payload.length === 0) {
      fail('missing-tag-fields', `${tag} record has no data fields.`, lineNumber)
      continue
    }
    const fields = payload.split(/\s+/u)

    if (tag === 'NM') {
      if (fields.length !== 7 && fields.length !== 8) {
        fail('malformed-nm', 'NM requires name, formula ID, MIL number, N(d), V(d), exclude flag, status, and optional melt frequency.', lineNumber)
        continue
      }
      const [name, formulaText, milNumber, ndText, vdText, excludeText, statusText, meltText] = fields
      const formulaId = finiteNumber(formulaText)
      const milValid = /^[^\s]+$/u.test(milNumber)
      const nd = finiteNumber(ndText)
      const vd = finiteNumber(vdText)
      const exclude = excludeText === '0' || excludeText === '1' ? Number(excludeText) : undefined
      const statusId = finiteNumber(statusText)
      const meltFrequency = meltText === undefined ? undefined : finiteNumber(meltText)
      const foldedName = name.toLocaleLowerCase('en-US')
      if (
        !name ||
        formulaId === undefined || !Number.isInteger(formulaId) || formulaId < 1 || formulaId > 13 ||
        !milValid || nd === undefined || nd <= 0 || vd === undefined ||
        exclude === undefined || statusId === undefined || !Number.isInteger(statusId) ||
        statusId < 0 || statusId >= STATUS_BY_ID.length ||
        (meltText !== undefined &&
          (meltFrequency === undefined || !Number.isInteger(meltFrequency) || meltFrequency < 1 || meltFrequency > 5))
      ) {
        fail('malformed-nm', 'NM contains an invalid or missing field (formula 1–13, finite positive N(d), finite V(d), exclude 0/1, status 0–4, optional melt frequency 1–5).', lineNumber)
        continue
      }
      if (seenNames.has(foldedName)) {
        fail('duplicate-glass-name', `Duplicate glass name “${name}”.`, lineNumber)
        continue
      }
      if (glasses.length >= OPTICSTUDIO_AGF_MAX_GLASSES) {
        fail('too-many-glasses', `Input exceeds the ${OPTICSTUDIO_AGF_MAX_GLASSES}-glass safety limit.`, lineNumber)
        continue
      }
      seenNames.add(foldedName)
      current = {
        name,
        formulaId,
        milNumber,
        nd,
        vd,
        excludeSubstitution: exclude === 1,
        statusId,
        status: STATUS_BY_ID[statusId],
        ...(meltFrequency === undefined ? {} : { meltFrequency }),
        metadata: [],
      }
      glasses.push(current)
      continue
    }

    if (tag === 'CC') {
      if (fields.length === 0) fail('missing-tag-fields', 'CC record requires catalog comment text.', lineNumber)
      continue
    }

    if (tag === 'GC') {
      if (payload.length > 140) {
        fail('malformed-tag-fields', 'GC comment exceeds the documented 140-character limit.', lineNumber)
        continue
      }
      if (!current) {
        fail('orphan-record', 'GC record appears before any NM glass record.', lineNumber)
        continue
      }
      current.metadata.push({ line: lineNumber, tag, raw: trimmed, scopeNote: OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE })
      continue
    }

    const expected = KNOWN_TAG_FIELD_COUNTS[tag]
    if (expected) {
      if (fields.length < expected.min || fields.length > expected.max || fields.some((field) => finiteNumber(field) === undefined)) {
        fail('malformed-tag-fields', `${tag} requires ${expected.min === expected.max ? expected.min : `${expected.min}–${expected.max}`} finite numeric field(s).`, lineNumber)
        continue
      }
      if (!current) {
        fail('orphan-record', `${tag} record appears before any NM glass record.`, lineNumber)
        continue
      }
      current.metadata.push({ line: lineNumber, tag, raw: trimmed, scopeNote: OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE })
      continue
    }

    diagnostics.push(issue('unknown-tag', `Unrecognized AGF record tag “${tag}” was retained as unsupported metadata.`, lineNumber))
    if (current) current.metadata.push({ line: lineNumber, tag, raw: trimmed, scopeNote: OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE })
  }

  return { glasses: errors.length === 0 ? glasses : [], diagnostics, errors }
}
