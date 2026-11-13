'use client'

import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, RemoteJobCancelError, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase } from '../../lib/hostApi'
import { createModuleJobSpec, readModuleResult, type ModuleComputeInput } from '../../lib/sim/module-compute'
import { preflightEpwNativeGaps, readEpwFile } from '../../lib/epw-validation'
import { EpwFileSelection, type EpwFileSelection as SelectedEpwFile } from './EpwFileSelection'
import { EpwWeatherResults, type EpwWeatherResult, type EpwWeatherSource } from './EpwWeatherResults'

const MODULE_ID = 'sw-energyplus-epw' as const
const METHOD_PARSE = 'method-epw-parse' as const
const MAX_INLINE_MODEL_CHARS = 1 << 20

/** Bounded EPW file import through the existing native parser and Host job flow. */
export function EpwWeatherWorkflow() {
  const [files, setFiles] = useState<SelectedEpwFile[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [captured, setCaptured] = useState<{ result: EpwWeatherResult; source: EpwWeatherSource } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [client] = useState(() => createSettlementClient({
    baseUrl: hostApiBase(),
    fetchImpl: (url, init) => {
      const headers = new Headers(init?.headers)
      const token = getStoredUserToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return fetch(url, { ...init, headers })
    },
  }))
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const [cancelFailedJob, setCancelFailedJob] = useState<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [])

  const onSelectionChange = (next: SelectedEpwFile[]) => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setFiles(next)
    setSelectedIndex(0)
    setCaptured(null)
    setError(null)
    setStatus('idle')
    setJobId(null)
  }

  const parseWeather = async () => {
    const selected = files[selectedIndex]
    if (!selected || busy || cancelFailedJob) return
    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    const isCurrent = () => mountedRef.current && generationRef.current === generation && controllerRef.current === controller
    setBusy(true)
    setError(null)
    setCaptured(null)
    setStatus('reading')
    setJobId(null)
    try {
      const imported = await readEpwFile(selected.file)
      preflightEpwNativeGaps(imported.text)
      const input = {
        module: MODULE_ID,
        method: METHOD_PARSE,
        backend: 'host' as const,
        text: imported.text,
      } as ModuleComputeInput
      if (JSON.stringify(input).length > MAX_INLINE_MODEL_CHARS) {
        throw new Error('This EPW exceeds the native job inline-input limit after JSON encoding. Choose a smaller weather file.')
      }

      const spec = createModuleJobSpec(input)
      setStatus('authenticating')
      await client.requireUser(controller.signal)
      if (!isCurrent()) return
      setStatus('submitting')
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (!isCurrent()) return
          setJobId(id)
          setStatus(next)
        },
      })
      if (!isCurrent()) return
      const native = readModuleResult(remote as JobResultV1, input) as unknown as EpwWeatherResult
      if (native.module !== MODULE_ID || native.method !== METHOD_PARSE || native.ok !== true ||
        native.backend?.id !== 'w-sim-cuda-host' || !native.summaries || !Number.isInteger(native.rowCount)) {
        throw new Error('Native EPW response does not match the submitted parser operation.')
      }
      const source: EpwWeatherSource = {
        identity: {
          name: imported.source.name,
          sizeBytes: imported.source.sizeBytes,
          lastModifiedMs: imported.source.lastModified,
          mediaType: imported.source.mediaType,
        },
        provenance: selected.provenance,
      }
      if (!isCurrent()) return
      setCaptured({ result: native, source })
      setStatus('succeeded')
    } catch (cause) {
      if (!isCurrent()) return
      if (cause instanceof RemoteJobCancelError) setCancelFailedJob(cause.jobId)
      else if (controller.signal.aborted) { setStatus('cancelled'); return }
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
      controller.abort(new DOMException('EPW import cancelled', 'AbortError'))
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

  return <section className="mt-6 space-y-4 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="epw-weather-workflow-title" data-testid="epw-weather-workflow">
    <header>
      <h2 id="epw-weather-workflow-title" className="text-lg font-semibold text-slate-100">EnergyPlus EPW weather preparation</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        Import local EPW weather files, apply the documented missing-value and hourly chronology preflight, then submit the raw file to W-Sim's existing native EPW parser. This prepares weather data only; it does not run a building or Modelica simulation, HVAC system, or annual energy calculation. The native job transport also has a 1 MiB serialized-input limit.
      </p>
    </header>
    <EpwFileSelection onSelectionChange={onSelectionChange} />
    {files.length > 1 && <label className="block max-w-xl text-sm text-slate-300">
      <span className="mb-1 block font-medium">File to process / 处理文件</span>
      <select value={selectedIndex} onChange={event => {
        generationRef.current += 1
        controllerRef.current?.abort()
        controllerRef.current = null
        setBusy(false)
        setSelectedIndex(Number(event.currentTarget.value))
        setCaptured(null)
        setError(null)
        setStatus('idle')
        setJobId(null)
      }} className="w-full rounded border border-edge bg-panel px-3 py-2 text-slate-100">
        {files.map((file, index) => <option value={index} key={`${file.identity.name}:${file.identity.lastModifiedMs}:${index}`}>{file.identity.name}</option>)}
      </select>
    </label>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn border border-edge" onClick={() => { void parseWeather() }} disabled={!files[selectedIndex] || busy || !!cancelFailedJob}>
        {busy ? 'Processing…' : 'Parse selected EPW with native operation'}
      </button>
      {(busy || cancelFailedJob) && <button type="button" className="btn border border-edge" onClick={() => { void cancel() }}>
        {cancelFailedJob ? 'Retry job cancellation' : 'Cancel'}
      </button>}
      <span role="status" className="text-sm text-slate-400">Status: {status}{jobId ? ` · Job ${jobId}` : ''}</span>
    </div>
    {error && <p role="alert" className="rounded border border-red-400/40 p-3 text-sm text-red-300">{error}</p>}
    {captured && <EpwWeatherResults result={captured.result} source={captured.source} />}
  </section>
}
