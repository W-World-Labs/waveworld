import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { createModuleJobSpec, readModuleResult, type ModuleComputeInput } from '../../lib/sim/module-compute'
import { listModelicaTextTableNames, MODELICA_TEXT_TABLE_MAX_BYTES, parseModelicaTextTable } from '../../lib/sim/modelica-text-table'
import { MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS, selectModelicaTextTable2D } from '../../lib/sim/modelica-text-table-2d'
import { ModelicaTableExport } from './ModelicaTableExport'
import { ModelicaTableFileEditor } from './ModelicaTableFileEditor'
import { ModelicaTablePlot } from './ModelicaTablePlot'
import { ModelicaTable2DEditor, type ModelicaTable2DExtrapolation } from './ModelicaTable2DEditor'
import { ModelicaTable2DSurfacePlot } from './ModelicaTable2DSurfacePlot'

const MODULE_ID = 'sw-openmodelica-table' as const
const MAX_FILE_BYTES = MODELICA_TEXT_TABLE_MAX_BYTES
const MAX_KNOTS = 4096

type NativeTableResult = {
  nKnots: number
  nColumns: number
  icol: number
  uMin: number
  uMax: number
  smoothness: string
  extrapolation: string
  u: number[]
  y: number[]
  der: number[]
  methodId: string
  familyId: string
}

type NativeTable2DResult = {
  operation: 'bilinear2d'
  nU1: number
  nU2: number
  extrapolation: string
  uv: [number, number][]
  y: number[]
  dyDu1: number[]
  dyDu2: number[]
  methodId: string
  familyId: string
}

type TableMode = '1d' | '2d'

type CapturedRunBase = {
  input: ModuleComputeInput
  sourceFile: string
  tableName: string
  provenance: unknown
}

type CapturedRun = (CapturedRunBase & { mode: '1d'; result: NativeTableResult }) |
  (CapturedRunBase & { mode: '2d'; result: NativeTable2DResult })

function clearFileInput(event: ChangeEvent<HTMLInputElement>) {
  event.currentTarget.value = ''
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'modelica-table'
}

/**
 * Parses a bounded Modelica #1 text table in the browser, then submits its
 * selected matrix to W-Sim's existing native table operations. This panel
 * contains no interpolation or local numerical solver.
 */
export function ModelicaTableFilePanel() {
  const [sourceFile, setSourceFile] = useState('')
  const [text, setText] = useState('')
  const [tableNames, setTableNames] = useState<string[]>([])
  const [tableName, setTableName] = useState('')
  const [mode, setMode] = useState<TableMode>('1d')
  const [outputColumn, setOutputColumn] = useState('1')
  const [queries, setQueries] = useState<string[]>([])
  const [queries2d, setQueries2d] = useState<{ u1: string; u2: string }[]>([])
  const [extrapolation2d, setExtrapolation2d] = useState<ModelicaTable2DExtrapolation>('linear')
  const [editorValid, setEditorValid] = useState(false)
  const [editorMessage, setEditorMessage] = useState('Choose a parsed table and enter explicit queries.')
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captured, setCaptured] = useState<CapturedRun | null>(null)
  const generationRef = useRef(0)
  const fileReadRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const selectedMatrix = useMemo(() => {
    if (!text || !tableName || !tableNames.includes(tableName)) return null
    try { return parseModelicaTextTable(text, tableName) }
    catch { return null }
  }, [tableName, tableNames, text])
  const selectedSurfaceResult = useMemo(() => {
    if (!text || !tableName || !tableNames.includes(tableName)) return { surface: null, error: null }
    try { return { surface: selectModelicaTextTable2D(text, tableName), error: null } }
    catch (cause) { return { surface: null, error: cause instanceof Error ? cause.message : String(cause) } }
  }, [tableName, tableNames, text])
  const selectedSurface = selectedSurfaceResult.surface
  const selectedMatrixError = useMemo(() => {
    if (!selectedMatrix) return tableNames.length > 0 ? 'The selected matrix is unavailable.' : null
    if (selectedMatrix.rows < 2 || selectedMatrix.rows > MAX_KNOTS) return `The selected matrix must contain 2 to ${MAX_KNOTS} rows.`
    if (selectedMatrix.columns < 2) return 'The selected matrix needs an abscissa column and at least one output column.'
    for (let index = 1; index < selectedMatrix.rows; index += 1) {
      if (selectedMatrix.values[index]![0]! <= selectedMatrix.values[index - 1]![0]!) {
        return 'Abscissae must be strictly ascending; duplicate abscissae are rejected.'
      }
    }
    return null
  }, [selectedMatrix, tableNames.length])
  const maxOutputColumn = selectedMatrix ? selectedMatrix.columns - 1 : undefined

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Modelica table panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidateRun = (reason: string) => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException(reason, 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setJobId(null)
    setCaptured(null)
    setError(null)
    setStatus('idle')
  }

  const loadFile = async (file: File | undefined) => {
    const fileGeneration = ++fileReadRef.current
    invalidateRun('Modelica table file changed')
    setFileError(null)
    setSourceFile('')
    setText('')
    setTableNames([])
    setTableName('')
    setOutputColumn('1')
    setQueries([])
    setQueries2d([])
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`File exceeds the ${MAX_FILE_BYTES}-byte limit.`)
      return
    }
    try {
      const contents = await file.text()
      if (!mountedRef.current || fileGeneration !== fileReadRef.current) return
      const names = listModelicaTextTableNames(contents)
      if (names.length === 0) throw new Error('The #1 file contains no named double matrices.')
      setSourceFile(file.name)
      setText(contents)
      setTableNames(names)
      setTableName(names[0]!)
    } catch (cause) {
      if (!mountedRef.current || fileGeneration !== fileReadRef.current) return
      setFileError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const reportEditorStatus = useCallback(({ valid, message }: { valid: boolean; message: string }) => {
    setEditorValid(valid)
    setEditorMessage(message)
  }, [])

  const updateTable = (next: string) => {
    invalidateRun('Modelica table selection changed')
    setTableName(next)
    setOutputColumn('1')
  }
  const updateColumn = (next: string) => {
    invalidateRun('Modelica output column changed')
    setOutputColumn(next)
  }
  const updateQueries = (next: string[]) => {
    invalidateRun('Modelica table queries changed')
    setQueries(next)
  }

  const updateMode = (next: TableMode) => {
    if (next === mode) return
    invalidateRun('Modelica table mode changed')
    setMode(next)
    setEditorValid(false)
  }
  const updateQueries2d = (next: { u1: string; u2: string }[]) => {
    invalidateRun('Modelica 2-D table queries changed')
    setQueries2d(next)
  }
  const updateExtrapolation2d = (next: ModelicaTable2DExtrapolation) => {
    invalidateRun('Modelica 2-D extrapolation changed')
    setExtrapolation2d(next)
  }

  const run = async () => {
    if (busy || !editorValid) return
    let input: ModuleComputeInput
    let validateResponse: (payload: Record<string, unknown>, backend: unknown) => { result: NativeTableResult | NativeTable2DResult; provenance: unknown }
    if (mode === '2d') {
      if (!selectedSurface || !selectedMatrix) {
        setError(selectedSurfaceResult.error ?? 'The selected matrix is unavailable as a 2-D table.')
        setStatus('invalid')
        return
      }
      const uv = queries2d.map(({ u1, u2 }) => [Number(u1), Number(u2)] as [number, number])
      if (uv.length === 0 || uv.length > 32 || uv.some(([u1, u2]) => !Number.isFinite(u1) || !Number.isFinite(u2))) {
        setError('Enter between 1 and 32 explicit finite (u1, u2) queries.')
        setStatus('invalid')
        return
      }
      input = structuredClone({
        module: MODULE_ID,
        operation: 'bilinear2d',
        backend: 'host' as const,
        table2d: selectedMatrix.values,
        uv,
        extrapolation: extrapolation2d,
      }) as ModuleComputeInput
      validateResponse = (payload, backend) => {
        const raw = payload.result as Partial<NativeTable2DResult> | undefined
        const samples = [raw?.y, raw?.dyDu1, raw?.dyDu2]
        const returnedUv = raw?.uv
        if (!raw || raw.operation !== 'bilinear2d' || raw.nU1 !== selectedSurface.u1.length || raw.nU2 !== selectedSurface.u2.length ||
          raw.extrapolation !== extrapolation2d || raw.methodId !== 'method-combi-table-2d-bilinear' || raw.familyId !== 'method-table-interpolation' ||
          !Array.isArray(returnedUv) || returnedUv.length !== uv.length || returnedUv.some((pair, index) => !Array.isArray(pair) || pair.length !== 2 || pair[0] !== uv[index]![0] || pair[1] !== uv[index]![1]) ||
          samples.some(values => !Array.isArray(values) || values.length !== uv.length || values.some(value => !Number.isFinite(value))) ||
          !backend || typeof backend !== 'object' || (backend as { id?: unknown }).id !== 'w-sim-cuda-host') {
          throw new Error('Native 2-D table response does not match the submitted queries or contains invalid samples.')
        }
        return { result: raw as NativeTable2DResult, provenance: { backend, methodId: raw.methodId, familyId: raw.familyId } }
      }
    } else {
      if (!selectedMatrix) return
      if (selectedMatrixError) {
        setError(selectedMatrixError)
        setStatus('invalid')
        return
      }
      const icol = Number(outputColumn)
      const queryValues = queries.map(Number)
      if (!Number.isSafeInteger(icol) || icol < 1 || icol >= selectedMatrix.columns || queryValues.some(value => !Number.isFinite(value))) {
        setError('Check the selected output column and finite numeric queries.')
        setStatus('invalid')
        return
      }
      input = structuredClone({
        module: MODULE_ID,
        backend: 'host' as const,
        table: selectedMatrix.values,
        u: queryValues,
        icol,
      }) as ModuleComputeInput
      validateResponse = (payload, backend) => {
        const raw = payload.result as Partial<NativeTableResult> | undefined
        if (!raw || !Array.isArray(raw.u) || !Array.isArray(raw.y) || !Array.isArray(raw.der) ||
          raw.u.length !== queryValues.length || raw.y.length !== queryValues.length || raw.der.length !== queryValues.length ||
          raw.u.some((value, index) => value !== queryValues[index]) ||
          [...raw.u, ...raw.y, ...raw.der].some(value => !Number.isFinite(value)) ||
          raw.icol !== icol || raw.nKnots !== selectedMatrix.rows || raw.nColumns !== selectedMatrix.columns - 1 ||
          !Number.isFinite(raw.uMin) || !Number.isFinite(raw.uMax) || raw.uMin! >= raw.uMax! ||
          raw.methodId !== 'method-algo-combi-table-1d' || raw.familyId !== 'method-table-interpolation' ||
          !['constant', 'linear', 'akima', 'monotone'].includes(String(raw.smoothness)) ||
          !['hold', 'linear', 'periodic', 'error'].includes(String(raw.extrapolation)) ||
          !backend || typeof backend !== 'object' || (backend as { id?: unknown }).id !== 'w-sim-cuda-host') {
          throw new Error('Native table response does not match the submitted queries or contains invalid samples.')
        }
        return { result: raw as NativeTableResult, provenance: { backend, methodId: raw.methodId, familyId: raw.familyId } }
      }
    }

    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setStatus('submitting')
    setJobId(null)
    setError(null)
    setCaptured(null)
    try {
      const freezeDeep = (value: unknown): void => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
        Object.freeze(value)
        for (const child of Object.values(value)) freezeDeep(child)
      }
      freezeDeep(input)
      const frozenInput = input
      const spec = createModuleJobSpec(frozenInput)
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(controller.signal)
      if (!current(generation, controller)) return
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (current(generation, controller)) {
            setJobId(id)
            setStatus(next)
          }
        },
      })
      if (!current(generation, controller)) return
      const payload = readModuleResult(remote as JobResultV1, frozenInput) as unknown as Record<string, unknown>
      const backend = payload.backend
      const validated = validateResponse(payload, backend)
      if (!current(generation, controller)) return
      setCaptured(mode === '2d' ? {
        input: frozenInput,
        sourceFile,
        tableName,
        mode: '2d',
        result: validated.result as NativeTable2DResult,
        provenance: validated.provenance,
      } : {
        input: frozenInput,
        sourceFile,
        tableName,
        mode: '1d',
        result: validated.result as NativeTableResult,
        provenance: validated.provenance,
      })
      setStatus('succeeded')
    } catch (cause) {
      if (!current(generation, controller) || controller.signal.aborted) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (current(generation)) setBusy(false)
      }
    }
  }

  const cancel = () => {
    invalidateRun('Modelica table job cancelled')
    setStatus('cancelled')
  }

  const csv = captured ? captured.mode === '2d' ? {
    columns: ['query u1', 'query u2', 'value y', 'partial dy/du1', 'partial dy/du2'],
    rows: (captured.result as NativeTable2DResult).uv.map(([u1, u2], index) => [u1, u2,
      (captured.result as NativeTable2DResult).y[index], (captured.result as NativeTable2DResult).dyDu1[index], (captured.result as NativeTable2DResult).dyDu2[index]]),
  } : {
    columns: ['query u', 'value y', 'derivative dy/du'],
    rows: (captured.result as NativeTableResult).u.map((value, index) => [value, (captured.result as NativeTableResult).y[index], (captured.result as NativeTableResult).der[index]]),
  } : undefined

  return <section className="mt-6 space-y-4 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="modelica-table-file-title" data-testid="modelica-table-file-panel">
    <header>
      <h2 id="modelica-table-file-title" className="text-lg font-semibold text-slate-100">Modelica #1 table file query</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        Select a standard text file, named double matrix, and explicit queries. The browser reuses the bounded #1 parser; authenticated Host jobs submit the selected matrix to W-Sim native host-f64 table operations. Interpolation and both partial derivatives run natively, never in this page. The 1-D mode remains the default; the 2-D mode maps the documented matrix layout for CombiTable2Dv. This does not read Dymola projects or claim CombiTimeTable event behavior or Dymola/FMI/vendor parity.
      </p>
    </header>

    <label className="block max-w-sm text-sm text-slate-300">
      <span className="mb-1 block font-medium">Lookup dimension</span>
      <select data-testid="modelica-table-mode" value={mode} onChange={event => updateMode(event.currentTarget.value as TableMode)} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100">
        <option value="1d">1-D table (default)</option>
        <option value="2d">2-D table (CombiTable2Dv)</option>
      </select>
    </label>

    <label className="block text-sm text-slate-300">
      <span className="mb-2 block font-medium">Modelica table text file (.txt)</span>
      <input
        data-testid="modelica-table-file-input"
        type="file"
        accept=".txt,text/plain"
        onChange={event => { void loadFile(event.currentTarget.files?.[0]); clearFileInput(event) }}
        className="block max-w-full text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:font-medium file:text-slate-950"
      />
    </label>
    {sourceFile && <p data-testid="modelica-table-file-name" className="text-sm text-slate-400">Loaded: {sourceFile}</p>}
    {fileError && <p role="alert" data-testid="modelica-table-file-error" className="rounded border border-red-400/40 p-3 text-sm text-red-300">{fileError}</p>}

    {mode === '1d' && <ModelicaTableFileEditor
      tableNames={tableNames}
      tableName={tableName}
      outputColumn={outputColumn}
      outputColumnMax={maxOutputColumn}
      queries={queries}
      onTableNameChange={updateTable}
      onOutputColumnChange={updateColumn}
      onQueriesChange={updateQueries}
      onStatusChange={reportEditorStatus}
    />}

    {mode === '2d' && <label className="block max-w-sm text-sm text-slate-300">
      <span className="mb-1 block font-medium">Named Modelica matrix</span>
      <select data-testid="modelica-table-select" value={tableNames.includes(tableName) ? tableName : ''} onChange={event => updateTable(event.currentTarget.value)} disabled={tableNames.length === 0} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100">
        <option value="" disabled>{tableNames.length === 0 ? 'No parsed tables available' : 'Choose a table'}</option>
        {tableNames.map((name, index) => <option key={`${name}-${index}`} value={name}>{name}</option>)}
      </select>
    </label>}

    {mode === '2d' && selectedSurface && <ModelicaTable2DEditor
      tableName={selectedSurface.name}
      u1Min={selectedSurface.u1[0]!}
      u1Max={selectedSurface.u1[selectedSurface.u1.length - 1]!}
      u2Min={selectedSurface.u2[0]!}
      u2Max={selectedSurface.u2[selectedSurface.u2.length - 1]!}
      queries={queries2d}
      extrapolation={extrapolation2d}
      onQueriesChange={updateQueries2d}
      onExtrapolationChange={updateExtrapolation2d}
      onStatusChange={reportEditorStatus}
    />}

    {mode === '1d' && selectedMatrix && <p data-testid="modelica-table-file-dimensions" className="text-xs text-slate-400">
      {selectedMatrix.name}: {selectedMatrix.rows} rows × {selectedMatrix.columns} columns; native 1-D limit is {MAX_KNOTS} knots.
    </p>}
    {mode === '1d' && selectedMatrixError && tableNames.length > 0 && <p role="alert" data-testid="modelica-table-file-table-error" className="text-sm text-amber-300">{selectedMatrixError}</p>}
    {mode === '2d' && selectedSurface && <>
      <p data-testid="modelica-table-2d-dimensions" className="text-xs text-slate-400">{selectedSurface.name}: {selectedSurface.u1.length} u1 knots × {selectedSurface.u2.length} u2 knots; maximum {MODELICA_TEXT_TABLE_2D_MAX_AXIS_KNOTS} knots per axis.</p>
      <ModelicaTable2DSurfacePlot xAxis={selectedSurface.u2} yAxis={selectedSurface.u1} values={selectedSurface.values} label="Imported Modelica table surface" xLabel="u2" yLabel="u1" valueLabel="table value" />
    </>}
    {mode === '2d' && selectedSurfaceResult.error && tableNames.length > 0 && <p role="alert" data-testid="modelica-table-file-table-error" className="text-sm text-amber-300">{selectedSurfaceResult.error}</p>}

    <div className="flex flex-wrap items-center gap-3">
      <button data-testid="modelica-table-run" type="button" onClick={() => void run()} disabled={busy || !editorValid || (mode === '1d' ? !selectedMatrix || !!selectedMatrixError : !selectedSurface)} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">Submit authenticated Host query</button>
      {busy && <button data-testid="modelica-table-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">Cancel query</button>}
      <span data-testid="modelica-table-job-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · Job ${jobId}` : ''}</span>
    </div>
    {!editorValid && tableNames.length > 0 && <p className="text-sm text-amber-300">{editorMessage}</p>}
    {error && <div data-testid="modelica-table-job-error" role="alert" className="rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>Sign in</a>}</div>}

    {captured && captured.mode === '1d' && <section data-testid="modelica-table-result" className="space-y-4 rounded-xl border border-edge p-4" aria-label="Native Modelica table result">
      <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
        <p>Source matrix: <strong>{captured.tableName}</strong></p>
        <p>Output column (1-based): <strong>{captured.result.icol}</strong></p>
        <p>Native method: <strong>{captured.result.methodId}</strong></p>
        <p>Returned smoothness / extrapolation: <strong>{captured.result.smoothness} / {captured.result.extrapolation}</strong></p>
        <p>Host backend: <strong>{String((captured.provenance as { backend?: { id?: string } }).backend?.id ?? 'reported in result')}</strong></p>
        <p>Knots: <strong>{captured.result.nKnots}</strong>; selected matrix has {selectedMatrix?.columns ?? 'captured'} columns.</p>
      </div>
      <ModelicaTablePlot xSamples={captured.result.u} ySamples={captured.result.y} label="Native table query values" xLabel="Query u" yLabel="Value y" />
      <div className="overflow-x-auto">
        <table data-testid="modelica-table-result-grid" className="w-full border-collapse text-sm">
          <caption className="pb-2 text-left text-slate-300">Native returned samples</caption>
          <thead><tr>{['u', 'y', 'dy/du'].map(label => <th key={label} scope="col" className="border border-edge px-2 py-1 text-left">{label}</th>)}</tr></thead>
          <tbody>{captured.result.u.map((u, index) => <tr key={`${u}-${index}`}>
            <td className="border border-edge px-2 py-1">{u}</td>
            <td className="border border-edge px-2 py-1">{captured.result.y[index]}</td>
            <td className="border border-edge px-2 py-1">{captured.result.der[index]}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ModelicaTableExport
        input={{ sourceFile: captured.sourceFile, tableName: captured.tableName, nativeInput: captured.input }}
        provenance={captured.provenance}
        result={captured.result}
        csv={csv}
        filename={`waveworld-${safeFilename(captured.tableName)}-table-result`}
      />
    </section>}
    {captured && captured.mode === '2d' && <section data-testid="modelica-table-result" className="space-y-4 rounded-xl border border-edge p-4" aria-label="Native Modelica 2-D table result">
      <div className="space-y-1 text-sm text-slate-300">
        <p>Source matrix: <strong>{captured.tableName}</strong></p>
        <p>Native method: <strong>{(captured.result as NativeTable2DResult).methodId}</strong></p>
        <p>Returned extrapolation: <strong>{(captured.result as NativeTable2DResult).extrapolation}</strong></p>
        <p>Host backend: <strong>{String((captured.provenance as { backend?: { id?: string } }).backend?.id ?? 'reported in result')}</strong></p>
        <p>Grid: <strong>{(captured.result as NativeTable2DResult).nU1} u1 knots × {(captured.result as NativeTable2DResult).nU2} u2 knots</strong>; native bilinear values and partial derivatives.</p>
      </div>
      <div className="overflow-x-auto">
        <table data-testid="modelica-table-2d-result-table" className="w-full border-collapse text-sm">
          <thead><tr>{['u1', 'u2', 'y', 'dy/du1', 'dy/du2'].map(label => <th key={label} scope="col" className="border border-edge px-2 py-1 text-left">{label}</th>)}</tr></thead>
          <tbody>{(captured.result as NativeTable2DResult).uv.map(([u1, u2], index) => <tr key={`${u1}-${u2}-${index}`}>
            {[u1, u2, (captured.result as NativeTable2DResult).y[index], (captured.result as NativeTable2DResult).dyDu1[index], (captured.result as NativeTable2DResult).dyDu2[index]].map((value, cell) => <td key={cell} className="border border-edge px-2 py-1">{value}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <ModelicaTableExport
        input={{ sourceFile: captured.sourceFile, tableName: captured.tableName, nativeInput: captured.input }}
        provenance={captured.provenance}
        result={captured.result}
        csv={csv}
        filename={`waveworld-${safeFilename(captured.tableName)}-table-2d-result`}
      />
    </section>}
  </section>
}
