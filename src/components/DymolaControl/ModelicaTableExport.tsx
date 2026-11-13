import { useLocale } from '../../lib/i18n'

type CsvTable = {
  columns: readonly string[]
  rows: readonly (readonly unknown[])[]
}

type Props = {
  input: unknown
  provenance: unknown
  result: unknown
  /** Optional result table; when omitted, CSV is generated from the result shape. */
  csv?: CsvTable
  filename?: string
}

const SECRET_KEY = /(?:secret|token|password|passwd|authorization|cookie|api[-_]?key|credential)/i

function safeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const output = value.map((entry) => safeValue(entry, seen))
    seen.delete(value)
    return output
  }
  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (SECRET_KEY.test(key)) continue
    const sanitized = safeValue((value as Record<string, unknown>)[key], seen)
    if (sanitized !== undefined) output[key] = sanitized
  }
  seen.delete(value)
  return output
}

/** Stable JSON for reproducible downloads; secret-like fields are omitted. */
export function serializeModelicaTableReport(args: { input: unknown; provenance: unknown; result: unknown }): string {
  return `${JSON.stringify({ schemaVersion: 1, input: safeValue(args.input), provenance: safeValue(args.provenance), result: safeValue(args.result) }, null, 2)}\n`
}

function csvCell(value: unknown): string {
  const safe = safeValue(value)
  const text = safe === undefined || safe === null ? '' : typeof safe === 'object' ? JSON.stringify(safe) : String(safe)
  const spreadsheetSafe = /^[\t\r ]*[=+@-]/.test(text) ? `'${text}` : text
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`
}

function flatten(value: unknown, path = 'result', rows: [string, unknown][] = []): [string, unknown][] {
  const safe = safeValue(value)
  if (Array.isArray(safe)) {
    safe.forEach((entry, index) => flatten(entry, `${path}[${index}]`, rows))
  } else if (safe && typeof safe === 'object') {
    const entries = Object.entries(safe as Record<string, unknown>)
    if (entries.length === 0) rows.push([path, {}])
    for (const [key, entry] of entries) flatten(entry, `${path}.${key}`, rows)
  } else {
    rows.push([path, safe])
  }
  return rows
}

function resultTable(result: unknown): CsvTable {
  const safe = safeValue(result)
  if (Array.isArray(safe) && safe.length > 0 && safe.every((row) => Array.isArray(row))) {
    const rows = safe as unknown[][]
    const width = Math.max(...rows.map((row) => row.length))
    return { columns: Array.from({ length: width }, (_, index) => `column_${index + 1}`), rows }
  }
  if (Array.isArray(safe) && safe.length > 0 && safe.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    const rows = safe as Record<string, unknown>[]
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
    return { columns, rows: rows.map((row) => columns.map((column) => row[column])) }
  }
  if (safe && typeof safe === 'object' && !Array.isArray(safe)) {
    const record = safe as Record<string, unknown>
    const arrays = Object.entries(record).filter(([, value]) => Array.isArray(value)) as [string, unknown[]][]
    if (arrays.length > 0 && arrays.every(([, values]) => values.length === arrays[0][1].length)) {
      const columns = Object.keys(record).sort()
      return {
        columns,
        rows: Array.from({ length: arrays[0][1].length }, (_, index) => columns.map((column) => {
          const value = record[column]
          return Array.isArray(value) ? value[index] : value
        })),
      }
    }
  }
  return { columns: ['path', 'value'], rows: flatten(safe) }
}

export function modelicaResultCsv(result: unknown, table?: CsvTable): string {
  const data = table ?? resultTable(result)
  return [data.columns.map(csvCell).join(','), ...data.rows.map((row) => data.columns.map((_, index) => csvCell(row[index])).join(','))].join('\r\n') + '\r\n'
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Export a caller-supplied submitted input, provenance, and result without running a solver or parsing files. */
export function ModelicaTableExport({ input, provenance, result, csv, filename = 'modelica-table-result' }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  return (
    <div className="flex flex-wrap gap-2" aria-label={zh ? '导出 Modelica 结果' : 'Export Modelica result'}>
      <button type="button" className="btn border border-edge" onClick={() => download(`${filename}.csv`, modelicaResultCsv(result, csv), 'text/csv;charset=utf-8')}>
        {zh ? '下载 CSV' : 'Download CSV'}
      </button>
      <button type="button" className="btn border border-edge" onClick={() => download(`${filename}.json`, serializeModelicaTableReport({ input, provenance, result }), 'application/json;charset=utf-8')}>
        {zh ? '下载 JSON 报告' : 'Download JSON report'}
      </button>
    </div>
  )
}
