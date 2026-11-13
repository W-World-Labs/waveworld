import { useEffect, useId, useState, type FormEvent } from 'react'

const MAX_QUERY_COUNT = 32
const MAX_QUERY_LENGTH = 64
const NUMERIC_QUERY = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export type ModelicaTable2DQuery = { u1: string; u2: string }
export type ModelicaTable2DExtrapolation = 'linear' | 'hold' | 'error'
export type ModelicaTable2DEditorStatus = { valid: boolean; message: string }

export type ModelicaTable2DEditorProps = {
  tableName: string
  u1Min: number
  u1Max: number
  u2Min: number
  u2Max: number
  queries: ModelicaTable2DQuery[]
  extrapolation: ModelicaTable2DExtrapolation
  onQueriesChange: (queries: ModelicaTable2DQuery[]) => void
  onExtrapolationChange: (extrapolation: ModelicaTable2DExtrapolation) => void
  onStatusChange?: (status: ModelicaTable2DEditorStatus) => void
}

function isFiniteQuery(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_QUERY_LENGTH && NUMERIC_QUERY.test(trimmed) && Number.isFinite(Number(trimmed))
}

/** Edits explicit CombiTable2Dv query pairs and extrapolation metadata; it performs no interpolation. */
export function ModelicaTable2DEditor({
  tableName,
  u1Min,
  u1Max,
  u2Min,
  u2Max,
  queries,
  extrapolation,
  onQueriesChange,
  onExtrapolationChange,
  onStatusChange,
}: ModelicaTable2DEditorProps) {
  const id = useId()
  const [u1Draft, setU1Draft] = useState('')
  const [u2Draft, setU2Draft] = useState('')
  const u1Id = `${id}-u1`
  const u2Id = `${id}-u2`
  const extrapolationId = `${id}-extrapolation`
  const helpId = `${id}-help`
  const validQueries = queries.length > 0 && queries.length <= MAX_QUERY_COUNT && queries.every(query => isFiniteQuery(query.u1) && isFiniteQuery(query.u2))
  const valid = Boolean(tableName) && validQueries && ['linear', 'hold', 'error'].includes(extrapolation)
  const statusMessage = !tableName
    ? 'Choose a table before querying.'
    : queries.length === 0
      ? 'Add at least one explicit (u1, u2) query.'
      : queries.length > MAX_QUERY_COUNT
        ? `Use no more than ${MAX_QUERY_COUNT} query pairs.`
        : !validQueries
          ? 'Each query coordinate must be a finite number, such as 0, 1.5, or 2e-3.'
          : 'Explicit query pairs are ready.'

  useEffect(() => {
    onStatusChange?.({ valid, message: statusMessage })
  }, [onStatusChange, statusMessage, valid])

  function addQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isFiniteQuery(u1Draft) || !isFiniteQuery(u2Draft) || queries.length >= MAX_QUERY_COUNT) return
    onQueriesChange([...queries, { u1: u1Draft.trim(), u2: u2Draft.trim() }])
    setU1Draft('')
    setU2Draft('')
  }

  function removeQuery(indexToRemove: number) {
    onQueriesChange(queries.filter((_, index) => index !== indexToRemove))
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-edge bg-surface p-4" data-testid="modelica-table-2d-editor">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold">CombiTable2Dv query</h2>
        <p className="mt-1 text-sm text-slate-400">Enter explicit finite (u1, u2) pairs for {tableName || 'the selected table'}. This editor does not calculate interpolated values.</p>
        <p className="mt-1 text-xs text-slate-400" data-testid="modelica-table-2d-axis-ranges">
          u1: {u1Min} to {u1Max}; u2: {u2Min} to {u2Max}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={u1Id} className="block text-sm">
          <span className="mb-1 block font-medium">u1 query</span>
          <input id={u1Id} data-testid="modelica-table-u1-query-input" type="text" inputMode="decimal" value={u1Draft} maxLength={MAX_QUERY_LENGTH} aria-describedby={helpId} aria-invalid={u1Draft.length > 0 && !isFiniteQuery(u1Draft)} onChange={event => setU1Draft(event.currentTarget.value)} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100" />
        </label>
        <label htmlFor={u2Id} className="block text-sm">
          <span className="mb-1 block font-medium">u2 query</span>
          <input id={u2Id} data-testid="modelica-table-u2-query-input" type="text" inputMode="decimal" value={u2Draft} maxLength={MAX_QUERY_LENGTH} aria-describedby={helpId} aria-invalid={u2Draft.length > 0 && !isFiniteQuery(u2Draft)} onChange={event => setU2Draft(event.currentTarget.value)} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100" />
        </label>
      </div>

      <p id={helpId} className="text-xs text-slate-400">Enter up to {MAX_QUERY_COUNT} pairs. Coordinates may be outside the displayed table-axis ranges; extrapolation behavior is selected below.</p>
      <form data-testid="modelica-table-u2-query-add" onSubmit={addQuery}>
        <button type="submit" data-testid="modelica-table-u1-query-add" disabled={!isFiniteQuery(u1Draft) || !isFiniteQuery(u2Draft) || queries.length >= MAX_QUERY_COUNT} className="btn border border-edge disabled:cursor-not-allowed disabled:opacity-50">Add query pair</button>
      </form>

      <ul data-testid="modelica-table-2d-query-list" aria-label="Explicit (u1, u2) query pairs" className="flex flex-wrap gap-2">
        {queries.map((query, index) => (
          <li key={`${query.u1}-${query.u2}-${index}`} data-testid="modelica-table-2d-query-item" className="flex items-center gap-2 rounded border border-edge bg-panel px-2 py-1 text-sm">
            <span aria-invalid={!isFiniteQuery(query.u1) || !isFiniteQuery(query.u2)}>({query.u1}, {query.u2})</span>
            <button type="button" data-testid={`modelica-table-2d-query-remove-${index}`} aria-label={`Remove query pair ${index + 1}`} onClick={() => removeQuery(index)} className="rounded px-1 text-slate-400 hover:text-slate-100">×</button>
          </li>
        ))}
        {queries.length === 0 && <li data-testid="modelica-table-2d-query-empty" className="text-sm text-slate-500">No query pairs added.</li>}
      </ul>

      <label htmlFor={extrapolationId} className="block text-sm">
        <span className="mb-1 block font-medium">Extrapolation</span>
        <select id={extrapolationId} data-testid="modelica-table-2d-extrapolation" value={extrapolation} onChange={event => onExtrapolationChange(event.currentTarget.value as ModelicaTable2DExtrapolation)} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100">
          <option value="linear">linear</option>
          <option value="hold">hold</option>
          <option value="error">error</option>
        </select>
      </label>

      <p data-testid="modelica-table-2d-editor-status" role="status" aria-live="polite" className={`text-sm ${valid ? 'text-emerald-300' : 'text-amber-300'}`}>{statusMessage}</p>
    </section>
  )
}
