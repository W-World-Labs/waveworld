import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createSettlementClient, RemoteJobCancelError, runRemoteJob, TaskLoginRequiredError } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase } from '../hostApi'
import { createModuleJobSpec, isNativeModule, knownModuleComputePrecision, readModuleResult, type ModuleComputeInput, type ModuleComputeOutput } from '../sim/module-compute'
import { runBrowserCompute, runBrowserJob } from '../sim/browser-agent'

export const ModuleComputeContext = createContext<ReturnType<typeof useModuleExecution> | null>(null)

/** Pages register only serializable parameters; the surrounding module owns execution. */
export function useModuleCompute(input: ModuleComputeInput, captureInput?: () => ModuleComputeInput) {
  const context = useContext(ModuleComputeContext)
  const key = JSON.stringify(input)
  const register = context?.register
  const captureRef = useRef(captureInput)
  captureRef.current = captureInput
  const capture = useCallback(() => captureRef.current?.(), [])
  useEffect(() => {
    register?.(key, capture)
    return () => register?.(null)
  }, [register, key, capture])
  return {
    target: context?.target ?? 'browser',
    reportLocalError: context?.reportLocalError,
    snapshot: context?.target === 'backend' || !!context?.busy || !!context?.result,
    result: context?.result?.key === key ? context.result.output : null,
    submittedInput: context?.result?.key === key ? context.result.input : null,
  }
}

export function useModuleExecution() {
  const [target, setTargetState] = useState<'browser' | 'backend'>('browser')
  const [input, setInput] = useState<string | null>(null)
  const inputRef = useRef(input)
  const captureRef = useRef<(() => ModuleComputeInput | undefined) | undefined>(undefined)
  const [result, setResult] = useState<{ key: string; input: ModuleComputeInput; output: ModuleComputeOutput } | null>(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState<string | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef<{ abort: AbortController; done: Promise<void> } | null>(null)
  const cancelFailed = useRef<string | null>(null)
  const mounted = useRef(true)
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
    mounted.current = true
    return () => { mounted.current = false; active.current?.abort.abort() }
  }, [])
  const register = useCallback((key: string | null, capture?: () => ModuleComputeInput | undefined) => {
    captureRef.current = capture
    if (inputRef.current === key) return
    inputRef.current = key
    active.current?.abort.abort()
    setInput(key); setResult(null)
    if (!active.current && !cancelFailed.current) {
      setStatus('idle'); setError(null); setJobId(null); setLoginRequired(false)
    }
  }, [])
  const reportLocalError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])
  const stop = async (): Promise<boolean> => {
    const run = active.current
    if (run) { setStatus('canceling'); run.abort.abort(); await run.done }
    if (cancelFailed.current) {
      setBusy(true)
      try { await client.cancel(cancelFailed.current) }
      catch (cause) { setError(String(cause)); return false }
      finally { if (mounted.current) setBusy(false) }
      cancelFailed.current = null
      if (mounted.current) { setError(null); setStatus('cancelled') }
    }
    return true
  }
  const setTarget = async (next: 'browser' | 'backend') => {
    if (next === target || !(await stop()) || !mounted.current) return
    setTargetState(next); setResult(null); setError(null); setStatus('idle'); setJobId(null); setLoginRequired(false)
  }
  const start = async (publish = false) => {
    if (!inputRef.current || active.current || cancelFailed.current) return
    const key = inputRef.current
    let parameters: ModuleComputeInput
    let spec
    try { parameters = captureRef.current?.() ?? JSON.parse(key); spec = createModuleJobSpec(parameters) }
    catch (cause) { setError(String(cause)); return }
    const run = { abort: new AbortController(), done: Promise.resolve() }
    active.current = run
    const publishing = publish || target === 'backend'
    setBusy(true); setStatus(publishing ? 'submitting' : 'running'); setError(null); setJobId(null); setLoginRequired(false)
    run.done = (async () => {
      if (publishing) await client.requireUser(run.abort.signal)
      run.abort.signal.throwIfAborted()
      if (mounted.current) setResult(null)
      if (!publishing) return (await runBrowserCompute(spec, { signal: run.abort.signal })).result
      const execute = target === 'browser' ? runBrowserJob : runRemoteJob
      return execute(client, spec, {
        signal: run.abort.signal,
        onStatus: (id, next) => {
          if (!mounted.current || active.current !== run) return
          setJobId(id)
          if (!run.abort.signal.aborted) setStatus(next)
        },
      })
    })().then((raw) => {
      if (!mounted.current || active.current !== run || run.abort.signal.aborted || inputRef.current !== key) return
      setResult({ key, input: parameters, output: readModuleResult(raw, parameters) }); setStatus('succeeded')
    }).catch((cause) => {
      if (!mounted.current || active.current !== run) return
      if (run.abort.signal.aborted && cause === run.abort.signal.reason) setStatus('cancelled')
      else {
        if (cause instanceof RemoteJobCancelError) cancelFailed.current = cause.jobId
        setLoginRequired(cause instanceof TaskLoginRequiredError)
        setError(cause instanceof Error ? cause.message : String(cause)); setStatus('failed')
      }
    }).finally(() => {
      if (active.current !== run) return
      active.current = null
      if (mounted.current) setBusy(false)
    })
    await run.done
  }
  const clear = () => { setResult(null); setError(null); setStatus('idle'); setJobId(null); setLoginRequired(false) }
  const precision = input ? knownModuleComputePrecision(JSON.parse(input) as ModuleComputeInput) : null
  const browserAgent = input ? isNativeModule((JSON.parse(input) as ModuleComputeInput).module) : false
  return { target, setTarget, register, reportLocalError, connected: input !== null, browserAgent, precision, result, status, error, loginRequired, jobId, busy, cancelPending: !!cancelFailed.current, start, stop, clear }
}
