import { useEffect, useMemo, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import {
  createSpiceDcJob,
  createSpiceDcSweepJob,
  createSpiceImportJob,
  readSpiceDcResult,
  readSpiceDcSweepResult,
  readSpiceImportResult,
  type MnaImport,
  type SpiceDcResult,
  type SpiceDcSweepResult,
} from '../../lib/sim/spice-import-adapter'
import {
  createSpiceTransientJob,
  getSpiceTransientInitialOptions,
  readSpiceTransientResult,
  supportsSpiceTransient,
  type SpiceTransientInitialOptions,
  type SpiceTransientInitialState,
} from '../../lib/sim/spice-transient-adapter'
import { SpiceDcSweepResults } from './SpiceDcSweepResults'
import { SpiceTransientResults } from './SpiceTransientResults'

const MAX_IMPORT_BYTES = 512 * 1024
const NETLIST_EXTENSIONS = /\.(cir|sp|spice|net)$/i
const RELEASED_WSIM_SPICE_IMPORT_PIN = 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14'

/** The released import pin rejects .ac before returning normalized MNA data. */
export function spiceAcImportPinError(netlist: string, zh = false): string | null {
  const hasAc = netlist.split(/\r?\n/).some((raw) => {
    const line = raw.split('$', 1)[0].trim()
    return /^\.ac(?:\s|$)/i.test(line)
  })
  if (!hasAc) return null
  return zh
    ? `当前发布的 W-Sim 网表导入版本 ${RELEASED_WSIM_SPICE_IMPORT_PIN} 不支持 .ac 网表导入。请使用本页结构化交流分析编辑器。`
    : `The released W-Sim netlist importer ${RELEASED_WSIM_SPICE_IMPORT_PIN} does not support .ac deck import. Use the structured AC editor on this page.`
}

function displayJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function downloadMnaJob(spec: unknown) {
  const href = URL.createObjectURL(new Blob([displayJson(spec)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'waveworld-mna-job.json'
  anchor.click()
  URL.revokeObjectURL(href)
}

export function supportsDcOperatingPoint(netlist: string, imported: MnaImport) {
  if (imported.mnaInput.method !== 'method-algo-mna-dc') return false
  const lines = netlist.split(/\r?\n/).map((line) => line.replace(/\$.*$/, '').trim()).filter(Boolean)
  const directives = lines.filter((line) => line.startsWith('.')).map((line) => line.toLowerCase().split(/\s+/)[0])
  if (directives.filter((directive) => directive === '.op').length !== 1) return false
  if (directives.some((directive) => !['.title', '.op', '.end'].includes(directive))) return false
  const elements = lines.filter((line) => !line.startsWith('.') && !line.startsWith('*'))
  return elements.length > 0 && elements.every((line) => /^[rvi]\S*\s/i.test(line) && !/\b(?:PULSE|SIN|EXP|PWL)\s*\(/i.test(line))
}

/** Keep sweep eligibility narrow; the adapter remains authoritative for circuit bounds and export integrity. */
export function supportsDcSweep(netlist: string, imported: MnaImport): boolean {
  if (imported.mnaInput.method !== 'method-algo-mna-dc-sweep') return false
  const lines = netlist.split(/\r?\n/).map((line) => line.replace(/\$.*$/, '').trim()).filter((line) => line && !line.startsWith('*'))
  const directives = lines.filter((line) => line.startsWith('.'))
  if (directives.filter((line) => line.toLowerCase().split(/\s+/)[0] === '.dc').length !== 1) return false
  if (directives.filter((line) => line.toLowerCase().split(/\s+/)[0] === '.end').length !== 1) return false
  if (directives.some((line) => !['.title', '.dc', '.end'].includes(line.toLowerCase().split(/\s+/)[0]))) return false
  const dc = directives.find((line) => line.toLowerCase().startsWith('.dc '))
  const match = dc?.match(/^\.dc\s+(\S+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/i)
  if (!match) return false
  const elements = lines.filter((line) => !line.startsWith('.'))
  if (!elements.length || !elements.every((line) => {
    if (!/^[rvi]\S*\s/i.test(line) || /\b(?:PULSE|SIN|EXP|PWL|AC)\b/i.test(line)) return false
    const fields = line.split(/\s+/)
    const kind = fields[0][0].toLowerCase()
    return kind === 'r' ? fields.length === 4
      : fields.length === 4 || (fields.length === 5 && fields[3].toUpperCase() === 'DC')
  })) return false
  const voltageSources = elements.filter((line) => /^v\S*\s/i.test(line))
  const sourceIndex = voltageSources.findIndex((line) => line.split(/\s+/)[0].toLowerCase() === match[1].toLowerCase())
  const sweep = (imported.mnaInput as Record<string, unknown>).sweep
  if (!sweep || typeof sweep !== 'object' || Array.isArray(sweep) || sourceIndex < 0) return false
  const expected = sweep as Record<string, unknown>
  const start = Number(match[2]); const stop = Number(match[3]); const increment = Number(match[4])
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(increment) || start >= stop || increment <= 0) return false
  const intervals = (stop - start) / increment
  if (!Number.isInteger(intervals)) return false
  if (expected.source !== sourceIndex || expected.start !== start || expected.stop !== stop || expected.steps !== intervals + 1) return false
  try { createSpiceDcSweepJob(imported); return true } catch { return false }
}

/** SPICE parser job and its MNA export stay independent from the RLC demonstration run. */
export function SpiceImportPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [files, setFiles] = useState<File[]>([])
  const [mainFile, setMainFile] = useState('')
  const [imported, setImported] = useState<MnaImport | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importStatus, setImportStatus] = useState('idle')
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [dcBusy, setDcBusy] = useState(false)
  const [dcStatus, setDcStatus] = useState('idle')
  const [dcJobId, setDcJobId] = useState<string | null>(null)
  const [dcError, setDcError] = useState<string | null>(null)
  const [dcResult, setDcResult] = useState<SpiceDcResult | null>(null)
  const [sweepBusy, setSweepBusy] = useState(false)
  const [sweepStatus, setSweepStatus] = useState('idle')
  const [sweepJobId, setSweepJobId] = useState<string | null>(null)
  const [sweepError, setSweepError] = useState<string | null>(null)
  const [sweepResult, setSweepResult] = useState<SpiceDcSweepResult | null>(null)
  const [transientBusy, setTransientBusy] = useState(false)
  const [transientStatus, setTransientStatus] = useState('idle')
  const [transientJobId, setTransientJobId] = useState<string | null>(null)
  const [transientError, setTransientError] = useState<string | null>(null)
  const [transientResult, setTransientResult] = useState<ReturnType<typeof readSpiceTransientResult> | null>(null)
  const [transientOutputNode, setTransientOutputNode] = useState('')
  const [initialNodeVoltages, setInitialNodeVoltages] = useState<Record<string, string>>({})
  const [initialInductorCurrents, setInitialInductorCurrents] = useState<Record<string, string>>({})
  const [submittedNetlist, setSubmittedNetlist] = useState('')
  const importAbortRef = useRef<AbortController | null>(null)
  const dcAbortRef = useRef<AbortController | null>(null)
  const sweepAbortRef = useRef<AbortController | null>(null)
  const transientAbortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const filesByName = useMemo(() => new Map(files.map((file) => [file.webkitRelativePath || file.name, file])), [files])
  const availableDecks = useMemo(() => files.filter((file) => NETLIST_EXTENSIONS.test(file.name)), [files])

  useEffect(() => () => {
    generationRef.current += 1
    importAbortRef.current?.abort()
    dcAbortRef.current?.abort()
    sweepAbortRef.current?.abort()
    transientAbortRef.current?.abort()
  }, [])

  const invalidate = () => {
    generationRef.current += 1
    importAbortRef.current?.abort(new DOMException('SPICE input changed', 'AbortError'))
    dcAbortRef.current?.abort(new DOMException('SPICE input changed', 'AbortError'))
    sweepAbortRef.current?.abort(new DOMException('SPICE input changed', 'AbortError'))
    transientAbortRef.current?.abort(new DOMException('SPICE input changed', 'AbortError'))
    importAbortRef.current = null
    dcAbortRef.current = null
    sweepAbortRef.current = null
    transientAbortRef.current = null
    setImported(null)
    setSubmittedNetlist('')
    setImportBusy(false)
    setImportStatus('idle')
    setImportJobId(null)
    setImportError(null)
    setDcBusy(false)
    setDcStatus('idle')
    setDcJobId(null)
    setDcError(null)
    setDcResult(null)
    setSweepBusy(false)
    setSweepStatus('idle')
    setSweepJobId(null)
    setSweepError(null)
    setSweepResult(null)
    setTransientBusy(false)
    setTransientStatus('idle')
    setTransientJobId(null)
    setTransientError(null)
    setTransientResult(null)
    setTransientOutputNode('')
    setInitialNodeVoltages({})
    setInitialInductorCurrents({})
  }

  const chooseFiles = (list: FileList | null) => {
    const next = list ? Array.from(list) : []
    invalidate()
    setFiles(next)
    const deck = next.find((file) => NETLIST_EXTENSIONS.test(file.name))
    setMainFile(deck ? deck.webkitRelativePath || deck.name : '')
  }

  const analyze = async () => {
    invalidate()
    const generation = generationRef.current
    setImportError(null)
    setImportJobId(null)
    const deck = filesByName.get(mainFile)
    if (!deck) { setImportError(zh ? '请选择 SPICE 主网表文件。' : 'Choose a SPICE deck file.'); return }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_IMPORT_BYTES) {
      setImportError(zh ? '文件总大小超过 512 KiB 限制。' : 'The selected files exceed the 512 KiB import limit.')
      return
    }
    setImportBusy(true)
    setImportStatus('submitting')
    const abort = new AbortController()
    importAbortRef.current = abort
    try {
      const [netlist, includePairs] = await Promise.all([
        deck.text(),
        Promise.all(files.filter((file) => file !== deck).map(async (file) => [file.webkitRelativePath || file.name, await file.text()] as const)),
      ])
      if (generation !== generationRef.current) return
      const pinError = spiceAcImportPinError([netlist, ...includePairs.map(([, text]) => text)].join('\n'), zh)
      if (pinError) {
        setImportStatus('failed')
        setImportError(pinError)
        return
      }
      const includes = Object.fromEntries(includePairs)
      const { input, spec } = createSpiceImportJob({ netlist, includes })
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(abort.signal)
      const result = await runRemoteJob(client, spec, {
        signal: abort.signal,
        onStatus: (id, next) => { if (generation === generationRef.current) { setImportJobId(id); setImportStatus(next) } },
      })
      if (generation !== generationRef.current) return
      setSubmittedNetlist(netlist)
      setImported(readSpiceImportResult(result as JobResultV1, input))
      setImportStatus('succeeded')
    } catch (cause) {
      if (abort.signal.aborted || generation !== generationRef.current) return
      setImportStatus('failed')
      setImportError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (importAbortRef.current === abort) importAbortRef.current = null
      if (generation === generationRef.current) setImportBusy(false)
    }
  }

  const runDc = async () => {
    if (!imported || !supportsDcOperatingPoint(submittedNetlist, imported)) return
    const currentImport = imported
    const submittedNodeMap = { ...currentImport.nodeMap }
    const generation = generationRef.current
    setDcError(null)
    setDcResult(null)
    setDcJobId(null)
    setDcStatus('submitting')
    setDcBusy(true)
    const abort = new AbortController()
    dcAbortRef.current = abort
    try {
      const { input, spec } = createSpiceDcJob(currentImport)
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(abort.signal)
      const result = await runRemoteJob(client, spec, {
        signal: abort.signal,
        onStatus: (id, next) => { if (generation === generationRef.current) { setDcJobId(id); setDcStatus(next) } },
      })
      if (generation !== generationRef.current) return
      setDcResult(readSpiceDcResult(result as JobResultV1, input, submittedNodeMap))
      setDcStatus('succeeded')
    } catch (cause) {
      if (abort.signal.aborted || generation !== generationRef.current) return
      setDcStatus('failed')
      setDcError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (dcAbortRef.current === abort) dcAbortRef.current = null
      if (generation === generationRef.current) setDcBusy(false)
    }
  }

  const runDcSweep = async () => {
    if (!imported || !supportsDcSweep(submittedNetlist, imported)) return
    const currentImport = imported
    const submittedNodeMap = { ...currentImport.nodeMap }
    const generation = generationRef.current
    setSweepError(null)
    setSweepResult(null)
    setSweepJobId(null)
    setSweepStatus('submitting')
    setSweepBusy(true)
    const abort = new AbortController()
    sweepAbortRef.current = abort
    try {
      const { input, spec } = createSpiceDcSweepJob(currentImport)
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(abort.signal)
      const result = await runRemoteJob(client, spec, {
        signal: abort.signal,
        onStatus: (id, next) => { if (!abort.signal.aborted && sweepAbortRef.current === abort && generation === generationRef.current) { setSweepJobId(id); setSweepStatus(next) } },
      })
      if (generation !== generationRef.current) return
      setSweepResult(readSpiceDcSweepResult(result as JobResultV1, input, submittedNodeMap))
      setSweepStatus('succeeded')
    } catch (cause) {
      if (abort.signal.aborted || generation !== generationRef.current) return
      setSweepStatus('failed')
      setSweepError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (sweepAbortRef.current === abort) {
        sweepAbortRef.current = null
        if (generation === generationRef.current) setSweepBusy(false)
      }
    }
  }

  const runTransient = async () => {
    if (!imported || !supportsSpiceTransient(submittedNetlist, imported)) return
    const currentImport = imported
    const submittedNodeMap = { ...currentImport.nodeMap }
    const outputNode = transientOutputNode || Object.keys(submittedNodeMap).find((name) => name !== '0') || ''
    const outputNodeIndex = submittedNodeMap[outputNode]
    if (typeof outputNodeIndex !== 'number' || !Number.isInteger(outputNodeIndex)) return
    const generation = generationRef.current
    setTransientError(null)
    setTransientResult(null)
    setTransientJobId(null)
    setTransientStatus('submitting')
    setTransientBusy(true)
    const abort = new AbortController()
    transientAbortRef.current = abort
    let runJobId: string | null = null
    try {
      const stateMap = (entries: Record<string, string>) => Object.fromEntries(
        Object.entries(entries).filter(([, value]) => value.trim() !== '').map(([name, value]) => [name, Number(value)]),
      )
      const initialState: SpiceTransientInitialState = {
        nodeVoltages: stateMap(initialNodeVoltages),
        inductorCurrents: stateMap(initialInductorCurrents),
      }
      const { input, spec } = createSpiceTransientJob(currentImport, outputNodeIndex, submittedNetlist, initialState)
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(abort.signal)
      const result = await runRemoteJob(client, spec, {
        signal: abort.signal,
        onStatus: (id, next) => {
          runJobId = id
          if (!abort.signal.aborted && transientAbortRef.current === abort && generation === generationRef.current) {
            setTransientJobId(id)
            setTransientStatus(next)
          }
        },
      })
      if (generation !== generationRef.current) return
      if (!runJobId) throw new Error('Transient job completed without a reported job ID')
      setTransientJobId(runJobId)
      setTransientResult(readSpiceTransientResult(result as JobResultV1, input, submittedNodeMap))
      setTransientStatus('succeeded')
    } catch (cause) {
      if (abort.signal.aborted || generation !== generationRef.current) return
      setTransientStatus('failed')
      setTransientError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (transientAbortRef.current === abort) {
        transientAbortRef.current = null
        if (generation === generationRef.current) setTransientBusy(false)
      }
    }
  }

  const stopImport = () => {
    importAbortRef.current?.abort(new DOMException('Import cancelled', 'AbortError'))
    setImportStatus('cancelled')
    setImportBusy(false)
  }

  const stopDc = () => {
    dcAbortRef.current?.abort(new DOMException('DC solve cancelled', 'AbortError'))
    setDcStatus('cancelled')
    setDcBusy(false)
  }

  const stopDcSweep = () => {
    sweepAbortRef.current?.abort(new DOMException('DC sweep cancelled', 'AbortError'))
    setSweepStatus('cancelled')
    setSweepBusy(false)
  }

  const stopTransient = () => {
    transientAbortRef.current?.abort(new DOMException('Transient solve cancelled', 'AbortError'))
    setTransientStatus('cancelled')
    setTransientBusy(false)
  }

  const transientNodes = imported ? Object.keys(imported.nodeMap).filter((name) => name !== '0') : []
  let transientInitialOptions: SpiceTransientInitialOptions | null = null
  if (imported && supportsSpiceTransient(submittedNetlist, imported)) {
    try { transientInitialOptions = getSpiceTransientInitialOptions(submittedNetlist, imported) } catch { /* eligibility already fails closed */ }
  }

  return (
    <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="spice-import-title">
      <div className="mb-3">
        <h2 id="spice-import-title" className="text-lg font-semibold text-slate-100">
          {zh ? '导入 SPICE 网表' : 'Import a SPICE netlist'}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
          {zh
            ? '上传支持的 R、C、L、独立 V/I 源网表，运行解析作业查看诊断并导出 MNA JobSpec。解析作业只做转换，不运行 MNA 求解器；不支持的器件、模型或分析会明确报错。'
            : 'Upload a supported R/C/L network with independent V/I sources, run the parser job to inspect diagnostics, then export an MNA JobSpec. The import job only converts the deck; it does not run the MNA solver. Unsupported devices, models, or analyses are reported.'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-sm text-slate-300">
          {zh ? 'SPICE 文件（可多选主网表和 include 文件）' : 'SPICE files (select a deck and any include files)'}
          <input
            type="file"
            accept=".cir,.sp,.spice,.net,.inc,.lib,.mod"
            multiple
            onChange={(event) => chooseFiles(event.currentTarget.files)}
            className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2 text-xs text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-wave/15 file:px-3 file:py-1 file:text-wave"
            aria-label={zh ? '选择 SPICE 文件' : 'Choose SPICE files'}
          />
        </label>
        <label className="min-w-56 text-sm text-slate-300">
          {zh ? '主网表' : 'Main deck'}
          <select
            value={mainFile}
            onChange={(event) => { invalidate(); setMainFile(event.target.value) }}
            disabled={availableDecks.length === 0}
            className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2 text-sm disabled:opacity-50"
            aria-label={zh ? '主网表文件' : 'Main deck file'}
          >
            {availableDecks.length === 0 && <option value="">{zh ? '先选择网表文件' : 'Choose files first'}</option>}
            {availableDecks.map((file) => {
              const name = file.webkitRelativePath || file.name
              return <option key={name} value={name}>{name}</option>
            })}
          </select>
        </label>
        <button type="button" onClick={() => void analyze()} disabled={importBusy || !mainFile}
          className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
          {importBusy ? (zh ? '解析作业运行中…' : 'Import job running…') : (zh ? '提交解析作业' : 'Submit import job')}
        </button>
        {importBusy && <button type="button" onClick={stopImport} className="btn border border-edge text-slate-300">{zh ? '停止解析' : 'Stop import'}</button>}
      </div>

      <div className="mt-2 text-xs text-slate-500">
        {files.length > 0 && <span>{zh ? `已选 ${files.length} 个文件 · ${(files.reduce((n, file) => n + file.size, 0) / 1024).toFixed(1)} KiB` : `${files.length} files selected · ${(files.reduce((n, file) => n + file.size, 0) / 1024).toFixed(1)} KiB`}</span>}
        <span className="ml-3">{zh ? '解析状态' : 'Import status'}: {importStatus}{importJobId && ` · ${zh ? '解析任务' : 'Import job'} ${importJobId}`}</span>
      </div>

      {importError && <div role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">
        {importError}
        {importError.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}
      </div>}

      {imported && <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-400/30 bg-emerald-950/15 p-3">
          <div>
            <p className="font-medium text-emerald-200">{zh ? 'MNA 输入已生成' : 'MNA input generated'}</p>
            <p className="text-xs text-slate-400">{zh ? '以下是导入器返回的 MNA 分析输入。可单独导出；直流工作点需要另行明确提交作业。' : 'This is the MNA input returned by the importer. Export is independent; a DC operating point requires a separate explicit job.'}</p>
          </div>
          <button type="button" onClick={() => downloadMnaJob(imported.mnaJobSpec)} className="btn border border-emerald-400/40 text-emerald-200">
            {zh ? '下载 MNA JobSpec' : 'Download MNA JobSpec'}
          </button>
        </div>
        <div className="rounded-lg border border-edge bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void runDc()} disabled={dcBusy || !supportsDcOperatingPoint(submittedNetlist, imported)} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
              {dcBusy ? (zh ? '直流工作点运行中…' : 'DC operating point running…') : (zh ? '运行直流工作点' : 'Run DC operating point')}
            </button>
            {dcBusy && <button type="button" onClick={stopDc} className="btn border border-edge text-slate-300">{zh ? '停止求解' : 'Stop solve'}</button>}
            <span className="text-xs text-slate-400">{dcJobId ? `${zh ? '求解任务' : 'DC job'} ${dcJobId} · ${dcStatus}` : `${zh ? '求解状态' : 'DC status'}: ${dcStatus}`}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" data-testid="spice-dc-sweep-run" onClick={() => void runDcSweep()} disabled={sweepBusy || !supportsDcSweep(submittedNetlist, imported)} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
              {sweepBusy ? (zh ? '直流扫描运行中…' : 'DC sweep running…') : (zh ? '运行直流扫描' : 'Run DC sweep')}
            </button>
            {sweepBusy && <button type="button" onClick={stopDcSweep} className="btn border border-edge text-slate-300">{zh ? '停止扫描' : 'Stop sweep'}</button>}
            <span className="text-xs text-slate-400">{sweepJobId ? `${zh ? '扫描任务' : 'Sweep job'} ${sweepJobId} · ${sweepStatus}` : `${zh ? '扫描状态' : 'Sweep status'}: ${sweepStatus}`}</span>
          </div>
          {!supportsDcOperatingPoint(submittedNetlist, imported) && <p className="mt-2 text-xs text-amber-300">{zh ? '仅支持带 .op 的线性 R/V/I 网表运行直流工作点；该限制不影响导出。' : 'DC run is limited to linear R/V/I decks with .op. Export remains available.'}</p>}
          {!supportsDcSweep(submittedNetlist, imported) && imported.mnaInput.method === 'method-algo-mna-dc-sweep' && <p className="mt-2 text-xs text-amber-300">{zh ? '仅支持单一独立电压源的线性 .dc 扫描（R/V/I 电路）；该限制不影响导出。' : 'Sweep run supports one independent voltage source in a linear R/V/I .dc deck. Export remains available.'}</p>}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-48 text-sm text-slate-300">
              {zh ? '瞬态输出节点' : 'Transient output node'}
              <select value={transientOutputNode || transientNodes[0] || ''} onChange={(event) => setTransientOutputNode(event.target.value)} disabled={transientNodes.length === 0 || transientBusy} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2 text-sm disabled:opacity-50">
                {transientNodes.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <button type="button" data-testid="spice-transient-run" onClick={() => void runTransient()} disabled={transientBusy || transientNodes.length === 0 || !supportsSpiceTransient(submittedNetlist, imported)} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
              {transientBusy ? (zh ? '瞬态分析运行中…' : 'Transient analysis running…') : (zh ? '运行瞬态分析' : 'Run transient analysis')}
            </button>
            {transientBusy && <button type="button" onClick={stopTransient} className="btn border border-edge text-slate-300">{zh ? '停止瞬态分析' : 'Stop transient'}</button>}
            <span className="text-xs text-slate-400">{transientJobId ? `${zh ? '瞬态任务' : 'Transient job'} ${transientJobId} · ${transientStatus}` : `${zh ? '瞬态状态' : 'Transient status'}: ${transientStatus}`}</span>
          </div>
          {transientInitialOptions && <div className="mt-3 space-y-3 rounded border border-edge p-3">
            <p className="text-xs text-slate-400">{zh
              ? '可选：设置 BE 求解器的显式初态。节点电压以地为参考；电感电流方向按网表端子顺序（第一个节点到第二个节点）。电容初始电压由两端节点电压差决定；BE 的电容模型不使用初始电容电流。首个 BE 步仍会施加独立源约束；不会先运行直流工作点。此处不是 .ic/.uic 卡。'
              : 'Optional: set the BE solver’s explicit starting state. Node voltages are relative to ground, and inductor current follows the card’s terminal order (first node to second). Capacitor initial voltage comes from its terminal node-voltage difference; the BE capacitor model does not use initial capacitor current. The first BE step still enforces independent-source constraints; no DC operating point is computed, and these fields do not interpret .ic or .uic cards.'}</p>
            {transientInitialOptions.nodeNames.map((name) => <label key={`v-${name}`} className="inline-flex items-center gap-2 pr-3 text-xs text-slate-300">
              <span>{zh ? `V(${name})₀ (V)` : `V(${name})₀ (V)`}</span>
              <input aria-label={`Initial voltage ${name}`} type="number" step="any" value={initialNodeVoltages[name] ?? ''} onChange={(event) => { setInitialNodeVoltages(current => ({ ...current, [name]: event.target.value })); setTransientResult(null); setTransientStatus('idle') }} disabled={transientBusy} className="w-28 rounded border border-edge bg-surface px-2 py-1" />
            </label>)}
            {transientInitialOptions.inductorNames.map((name) => <label key={`il-${name}`} className="inline-flex items-center gap-2 pr-3 text-xs text-slate-300">
              <span>{zh ? `I(${name})₀ (A)` : `I(${name})₀ (A)`}</span>
              <input aria-label={`Initial inductor current ${name}`} type="number" step="any" value={initialInductorCurrents[name] ?? ''} onChange={(event) => { setInitialInductorCurrents(current => ({ ...current, [name]: event.target.value })); setTransientResult(null); setTransientStatus('idle') }} disabled={transientBusy} className="w-28 rounded border border-edge bg-surface px-2 py-1" />
            </label>)}
          </div>}
          {!supportsSpiceTransient(submittedNetlist, imported) && <p className="mt-2 text-xs text-amber-300">{zh ? '瞬态分析仅支持 1–2000 步的固定步长 .tran、线性 R/C/L 和恒定独立源；.ic/.uic 卡仍不支持。' : 'Transient analysis supports fixed-step .tran decks of 1–2000 steps with linear R/C/L and constant independent sources. .ic/.uic cards remain unsupported.'}</p>}
          {dcError && <div role="alert" className="mt-2 text-sm text-red-300">{dcError}{dcError.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
          {sweepError && <div role="alert" className="mt-2 text-sm text-red-300">{sweepError}{sweepError.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
          {transientError && <div role="alert" className="mt-2 text-sm text-red-300">{transientError}{transientError.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
          {dcResult && <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>{zh ? '求解器来源' : 'Solver provenance'}: {dcResult.familyId} · {dcResult.methodId} · {displayJson(dcResult.backend)}</p>
            <p>{zh ? '迭代次数' : 'Iterations'}: {dcResult.iterations} · {zh ? '残差范数' : 'Residual norm'}: {dcResult.residualNorm}</p>
            <h3 className="font-medium">{zh ? '节点电压（V）' : 'Node voltages (V)'}</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">{Object.entries(dcResult.nodeVoltages).map(([name, voltage]) => <div key={name} className="contents"><dt>{name}</dt><dd>{voltage}</dd></div>)}</dl>
          </div>}
          {sweepResult && <SpiceDcSweepResults result={sweepResult} />}
          {transientResult && <SpiceTransientResults result={transientResult} jobId={transientJobId} />}
        </div>
        <details open>
          <summary className="cursor-pointer text-sm text-slate-300">{zh ? '解析诊断' : 'Import diagnostics'}</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap">{displayJson(imported.diagnostics)}</pre>
        </details>
        <details>
          <summary className="cursor-pointer text-sm text-slate-300">{zh ? '节点映射' : 'Node mapping'}</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap">{displayJson(imported.nodeMap)}</pre>
        </details>
        <details>
          <summary className="cursor-pointer text-sm text-slate-300">{zh ? 'MNA 输入预览' : 'MNA input preview'}</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap">{displayJson(imported.mnaInput)}</pre>
        </details>
      </div>}
    </section>
  )
}
