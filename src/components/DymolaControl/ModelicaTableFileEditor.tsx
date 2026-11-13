import { useEffect, useId, useState, type FormEvent } from 'react'

const MAX_QUERY_COUNT = 32
const MAX_QUERY_LENGTH = 64
const NUMERIC_QUERY = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const OUTPUT_COLUMN = /^\d+$/

export type ModelicaTableEditorStatus = {
  valid: boolean
  message: string
}

export type ModelicaTableFileEditorProps = {
  tableNames: string[]
  tableName: string
  outputColumn: string
  outputColumnMax?: number
  queries: string[]
  onTableNameChange: (tableName: string) => void
  onOutputColumnChange: (outputColumn: string) => void
  onQueriesChange: (queries: string[]) => void
  onStatusChange?: (status: ModelicaTableEditorStatus) => void
}

function isNumericQuery(query: string): boolean {
  const trimmed = query.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_QUERY_LENGTH && NUMERIC_QUERY.test(trimmed) && Number.isFinite(Number(trimmed))
}

/** Edits table selection and explicit numeric query text; it does not read or evaluate table files. */
export function ModelicaTableFileEditor({
  tableNames,
  tableName,
  outputColumn,
  outputColumnMax,
  queries,
  onTableNameChange,
  onOutputColumnChange,
  onQueriesChange,
  onStatusChange,
}: ModelicaTableFileEditorProps) {
  const id = useId()
  const [queryDraft, setQueryDraft] = useState('')
  const tableId = `${id}-table`
  const columnId = `${id}-column`
  const queryId = `${id}-query`
  const queryHelpId = `${id}-query-help`
  const selectedTableAvailable = tableNames.includes(tableName)
  const outputColumnNumber = Number(outputColumn)
  const outputColumnValid = OUTPUT_COLUMN.test(outputColumn) && Number.isSafeInteger(outputColumnNumber) && outputColumnNumber >= 1 && (outputColumnMax === undefined || outputColumnNumber <= outputColumnMax)
  const validQueries = queries.every(isNumericQuery)
  const valid = selectedTableAvailable && outputColumnValid && queries.length > 0 && validQueries
  const statusMessage = !selectedTableAvailable
    ? 'Choose an available table.'
    : !outputColumnValid
      ? outputColumnMax === undefined
        ? 'Enter an output column number of 1 or greater.'
        : `Enter an output column number from 1 to ${outputColumnMax}.`
      : queries.length === 0
          ? 'Add at least one numeric query.'
          : !validQueries
            ? 'Each query must be a finite number, such as 0, 1.5, or 2e-3.'
            : 'Table selection and queries are ready.'

  useEffect(() => {
    onStatusChange?.({ valid, message: statusMessage })
  }, [onStatusChange, statusMessage, valid])

  function addQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = queryDraft.trim()
    if (!isNumericQuery(query) || queries.length >= MAX_QUERY_COUNT) return
    onQueriesChange([...queries, query])
    setQueryDraft('')
  }

  function removeQuery(indexToRemove: number) {
    onQueriesChange(queries.filter((_, index) => index !== indexToRemove))
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-edge bg-surface p-4" data-testid="modelica-table-editor">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold">Modelica table query</h2>
        <p className="mt-1 text-sm text-slate-400">Choose a parsed table and enter explicit numeric queries. This editor does not parse files or calculate values.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={tableId} className="block text-sm">
          <span className="mb-1 block font-medium">Table</span>
          <select
            id={tableId}
            data-testid="modelica-table-select"
            value={selectedTableAvailable ? tableName : ''}
            onChange={(event) => onTableNameChange(event.currentTarget.value)}
            disabled={tableNames.length === 0}
            className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100"
          >
            <option value="" disabled>{tableNames.length === 0 ? 'No parsed tables available' : 'Choose a table'}</option>
            {tableNames.map((name, index) => <option key={`${name}-${index}`} value={name}>{name}</option>)}
          </select>
        </label>

        <label htmlFor={columnId} className="block text-sm">
          <span className="mb-1 block font-medium">Output column number</span>
          <input
            id={columnId}
            data-testid="modelica-table-output-column"
            type="number"
            value={outputColumn}
            min={1}
            max={outputColumnMax}
            step={1}
            onChange={(event) => onOutputColumnChange(event.currentTarget.value)}
            aria-invalid={!outputColumnValid}
            className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100"
          />
        </label>
      </div>

      <div>
        <h3 className="font-medium">Explicit numeric queries</h3>
        <p id={queryHelpId} className="mt-1 text-xs text-slate-400">Enter one finite number per query, up to {MAX_QUERY_COUNT} queries. Use decimal or scientific notation.</p>
        <form onSubmit={addQuery} className="mt-2 flex flex-wrap items-end gap-2">
          <label htmlFor={queryId} className="min-w-56 flex-1 text-sm">
            <span className="mb-1 block font-medium">Query value</span>
            <input
              id={queryId}
              data-testid="modelica-table-query-input"
              type="text"
              inputMode="decimal"
              value={queryDraft}
              maxLength={MAX_QUERY_LENGTH}
              aria-describedby={queryHelpId}
              aria-invalid={queryDraft.length > 0 && !isNumericQuery(queryDraft)}
              onChange={(event) => setQueryDraft(event.currentTarget.value)}
              className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100"
            />
          </label>
          <button
            type="submit"
            data-testid="modelica-table-query-add"
            disabled={!isNumericQuery(queryDraft) || queries.length >= MAX_QUERY_COUNT}
            className="btn border border-edge disabled:cursor-not-allowed disabled:opacity-50"
          >Add query</button>
        </form>

        <ul data-testid="modelica-table-query-list" aria-label="Explicit numeric queries" className="mt-3 flex flex-wrap gap-2">
          {queries.map((query, index) => (
            <li key={`${query}-${index}`} data-testid="modelica-table-query-item" className="flex items-center gap-2 rounded border border-edge bg-panel px-2 py-1 text-sm">
              <span aria-invalid={!isNumericQuery(query)}>{query}</span>
              <button
                type="button"
                data-testid={`modelica-table-query-remove-${index}`}
                aria-label={`Remove query ${query || index + 1}`}
                onClick={() => removeQuery(index)}
                className="rounded px-1 text-slate-400 hover:text-slate-100"
              >×</button>
            </li>
          ))}
          {queries.length === 0 && <li data-testid="modelica-table-query-empty" className="text-sm text-slate-500">No queries added.</li>}
        </ul>
      </div>

      <p data-testid="modelica-table-editor-status" role="status" aria-live="polite" className={`text-sm ${valid ? 'text-emerald-300' : 'text-amber-300'}`}>
        {statusMessage}
      </p>
    </section>
  )
}
