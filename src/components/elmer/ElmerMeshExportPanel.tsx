import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, RemoteJobCancelError, runRemoteJob, TaskLoginRequiredError } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { createModuleJobSpec, readModuleResult } from '../../lib/sim/module-compute'
import {
  buildElmerMeshExportFiles,
  ELMER_MESH_CONVERT_MODULE,
  parseElmerMeshInput,
  type ElmerMeshExportFiles,
} from './elmerMeshExport'

const DEFAULT_INPUT = {
  module: ELMER_MESH_CONVERT_MODULE,
  backend: 'host',
  nodes: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  elements: [{ elmer: 504, body: 1, nodes: [1, 2, 3, 4] }],
}

function downloadText(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ElmerMeshExportPanel() {
  const [rawInput, setRawInput] = useState(() => JSON.stringify(DEFAULT_INPUT, null, 2))
  const [captured, setCaptured] = useState<{ files: ElmerMeshExportFiles; jobId: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [cancelFailedJob, setCancelFailedJob] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const [client] = useState(() => createSettlementClient({
    baseUrl: hostApiBase(),
    fetchImpl: (url, init) => {
      const headers = new Headers(init?.headers)
      const token = getStoredUserToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return fetch(url, { ...init, headers })
    },
  }))

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [])

  const resetForEdit = (value: string) => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setRawInput(value)
    setCaptured(null)
    setError(null)
    setLoginRequired(false)
    setStatus('idle')
    setJobId(null)
  }

  const input = parseElmerMeshInput(rawInput)

  const submit = async () => {
    if (!input || busy || cancelFailedJob) return
    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    const isCurrent = () => mountedRef.current && generationRef.current === generation && controllerRef.current === controller
    setBusy(true)
    setCaptured(null)
    setError(null)
    setLoginRequired(false)
    setStatus('authenticating')
    setJobId(null)

    try {
      const spec = createModuleJobSpec(input)
      await client.requireUser(controller.signal)
      if (!isCurrent()) return
      setStatus('submitting')
      let submittedJobId: string | null = null
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (!isCurrent()) return
          submittedJobId = id
          setJobId(id)
          setStatus(next)
        },
      })
      if (!isCurrent()) return
      const operationResult = readModuleResult(remote as JobResultV1, input)
      const files = buildElmerMeshExportFiles(operationResult)
      setCaptured({ files, jobId: submittedJobId })
      setStatus('succeeded')
    } catch (cause) {
      if (!isCurrent()) return
      if (cause instanceof RemoteJobCancelError) setCancelFailedJob(cause.jobId)
      else if (controller.signal.aborted) { setStatus('cancelled'); return }
      setLoginRequired(cause instanceof TaskLoginRequiredError)
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (mountedRef.current && generationRef.current === generation) setBusy(false)
      }
    }
  }

  const cancel = async () => {
    const controller = controllerRef.current
    if (controller) {
      setStatus('canceling')
      controller.abort(new DOMException('Elmer mesh export cancelled', 'AbortError'))
      return
    }
    const failedJob = cancelFailedJob
    if (!failedJob) return
    setBusy(true)
    try {
      await client.cancel(failedJob)
      setCancelFailedJob(null)
      setError(null)
      setStatus('cancelled')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return <section className="mt-4 space-y-4 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="elmer-mesh-export-title" data-testid="elmer-mesh-export-panel">
    <header>
      <h2 id="elmer-mesh-export-title" className="text-lg font-semibold text-slate-100">ElmerGrid native mesh export</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        Submit prepared JSON to the existing native ElmerGrid conversion operation, then download its Elmer mesh files. This export contains no boundary elements: `mesh.header` declares zero and `mesh.boundary` is empty. It does not import an Elmer mesh or run ElmerSolver.
      </p>
    </header>
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block font-medium">Prepared native operation JSON</span>
      <textarea
        data-testid="elmer-mesh-json-input"
        aria-label="Elmer mesh converter JSON input"
        value={rawInput}
        onChange={event => resetForEdit(event.currentTarget.value)}
        spellCheck={false}
        rows={18}
        className="min-h-[22rem] w-full resize-y rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100"
      />
    </label>
    <p className="text-xs text-slate-500">Input and projected mesh output are each limited to 5,000,000 rows; native inline JSON is limited to 1 MiB. Boundary parent IDs are not generated.</p>
    {!input && <p role="alert" className="rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200">Input must be valid bounded JSON for `{ELMER_MESH_CONVERT_MODULE}` with backend `host`.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button data-testid="elmer-mesh-submit" type="button" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!input || busy || !!cancelFailedJob} onClick={() => { void submit() }}>
        {busy ? 'Submitting…' : 'Submit to native Host'}
      </button>
      {(busy || cancelFailedJob) && <button type="button" className="btn border border-edge" onClick={() => { void cancel() }}>
        {cancelFailedJob ? 'Retry cancellation' : 'Cancel'}
      </button>}
      <span role="status" className="text-sm text-slate-400">Status: {status}{jobId ? ` · Job ${jobId}` : ''}</span>
      {jobId && <a className="text-sm text-cyan-300 underline" href={`/batch-jobs?job=${encodeURIComponent(jobId)}`}>View saved job</a>}
    </div>
    {error && <p role="alert" className="rounded border border-red-400/40 p-3 text-sm text-red-300">{error}{loginRequired && <a className="ml-3 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>Sign in</a>}</p>}
    {captured && <section className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-3" aria-label="Elmer mesh export files">
      <div>
        <h3 className="font-semibold text-emerald-100">Validated four-file text export</h3>
        <p className="mt-1 text-xs text-slate-400">The native Host response was checked, the missing type counts were reconstructed, and the unused node partition index is set to -1.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['mesh.header', 'mesh.nodes', 'mesh.elements', 'mesh.boundary'] as const).map(file => <button
          key={file}
          data-testid={`elmer-mesh-download-${file.split('.')[1]}`}
          type="button"
          className="btn border border-edge text-sm"
          onClick={() => downloadText(file, captured.files[file])}
        >Download {file}{file === 'mesh.boundary' ? ' (empty)' : ''}</button>)}
      </div>
      <details className="rounded border border-edge bg-slate-950/50 p-3">
        <summary className="cursor-pointer text-sm text-slate-300">Inspect generated header</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-slate-300">{captured.files['mesh.header']}</pre>
      </details>
    </section>}
  </section>
}
