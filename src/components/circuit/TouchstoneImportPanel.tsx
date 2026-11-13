import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { parseTouchstone, type TouchstoneNetwork } from '../../lib/sim/touchstone'
import { createTouchstoneVswrJob, readTouchstoneVswrResult, type TouchstoneVswrResult } from '../../lib/sim/touchstone-vswr'
import { createTouchstoneNetworkExportJob, readTouchstoneNetworkExportResult, type TouchstoneNetworkExportOptions, type TouchstoneNetworkExportResult } from '../../lib/sim/touchstone-network-export'
import { TouchstoneVswrResults } from './TouchstoneVswrResults'

const TOUCHSTONE_FILE = /(?:\.s[1-8]p|\.ts)$/i
const TOUCHSTONE_NETWORK_EXPORT_BUDGET = 8192
const TOUCHSTONE_NETWORK_EXPORT_MAX_POINTS = 4096

export function TouchstoneImportPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [network, setNetwork] = useState<TouchstoneNetwork | null>(null)
  const [previewName, setPreviewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TouchstoneVswrResult | null>(null)
  const [submittedNetwork, setSubmittedNetwork] = useState<TouchstoneNetwork | null>(null)
  const [networkFormat, setNetworkFormat] = useState<TouchstoneNetworkExportOptions['format']>('RI')
  const [networkFrequencyUnit, setNetworkFrequencyUnit] = useState<TouchstoneNetworkExportOptions['frequencyUnit']>('GHZ')
  const [networkExport, setNetworkExport] = useState<TouchstoneNetworkExportResult | null>(null)
  const [networkExportSnapshot, setNetworkExportSnapshot] = useState<{ sourceFileName: string; sourceReferenceOhms: number; options: TouchstoneNetworkExportOptions } | null>(null)
  const [networkExportJobId, setNetworkExportJobId] = useState<string | null>(null)
  const [networkExportBusy, setNetworkExportBusy] = useState(false)
  const [networkExportStatus, setNetworkExportStatus] = useState('idle')
  const [networkExportError, setNetworkExportError] = useState<string | null>(null)
  const referenceImpedancesOhms = network?.referenceImpedancesOhms
  const hasNonuniformReferenceImpedances = Boolean(
    referenceImpedancesOhms && referenceImpedancesOhms.length > 1 &&
    referenceImpedancesOhms.some((impedance) => impedance !== referenceImpedancesOhms[0]),
  )
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Touchstone panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Touchstone input changed', 'AbortError'))
    controllerRef.current = null
    setNetwork(null)
    setPreviewName('')
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setResult(null)
    setSubmittedNetwork(null)
    setNetworkExport(null)
    setNetworkExportSnapshot(null)
    setNetworkExportJobId(null)
    setNetworkExportBusy(false)
    setNetworkExportStatus('idle')
    setNetworkExportError(null)
  }

  const chooseFile = async (file: File | undefined) => {
    invalidate()
    if (!file) return
    const generation = generationRef.current
    setPreviewName(file.name)
    if (!TOUCHSTONE_FILE.test(file.name)) {
      setError(zh ? '请选择 .s1p 至 .s8p 文件，或带有端口元数据的 Touchstone 2.x .ts 文件。' : 'Choose a .s1p through .s8p file or a Touchstone 2.x .ts file with declared port metadata.')
      setStatus('failed')
      return
    }
    try {
      const text = await file.text()
      if (!current(generation)) return
      const parsed = parseTouchstone(text, file.name)
      if (!current(generation)) return
      setNetwork(parsed)
      setNetworkFrequencyUnit(parsed.frequencyUnit.toUpperCase() as TouchstoneNetworkExportOptions['frequencyUnit'])
      setNetworkFormat(parsed.format)
      setStatus('ready')
    } catch (cause) {
      if (!current(generation)) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('failed')
    }
  }

  const analyze = async () => {
    if (!network || busy || networkExportBusy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const snapshot: TouchstoneNetwork = {
      ...network,
      ...(network.referenceImpedancesOhms ? { referenceImpedancesOhms: [...network.referenceImpedancesOhms] } : {}),
      points: network.points.map((point) => ({
        frequencyHz: point.frequencyHz,
        s: point.s.map((pair) => [pair[0], pair[1]] as [number, number]),
      })),
    }
    setSubmittedNetwork(snapshot)
    setResult(null)
    setError(null)
    setJobId(null)
    setStatus('submitting')
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const { spec } = createTouchstoneVswrJob(snapshot)
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
          if (current(generation, controller)) { setJobId(id); setStatus(next) }
        },
      })
      if (!current(generation, controller)) return
      const parsedResult = readTouchstoneVswrResult(remote as JobResultV1, snapshot)
      if (!current(generation, controller)) return
      setResult(parsedResult)
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
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Touchstone analysis cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setResult(null)
    setSubmittedNetwork(null)
  }

  const exportNetwork = async () => {
    if (!network || hasNonuniformReferenceImpedances || network.ports > 4 || network.points.length > Math.min(TOUCHSTONE_NETWORK_EXPORT_MAX_POINTS, Math.floor(TOUCHSTONE_NETWORK_EXPORT_BUDGET / (network.ports * network.ports))) || busy || networkExportBusy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const snapshot: TouchstoneNetwork = {
      ...network,
      ...(network.referenceImpedancesOhms ? { referenceImpedancesOhms: [...network.referenceImpedancesOhms] } : {}),
      points: network.points.map(point => ({
        frequencyHz: point.frequencyHz,
        s: point.s.map(pair => [pair[0], pair[1]] as [number, number]),
      })),
    }
    const options: TouchstoneNetworkExportOptions = {
      frequencyUnit: networkFrequencyUnit,
      format: networkFormat,
    }
    setNetworkExport(null)
    setNetworkExportSnapshot({ sourceFileName: snapshot.fileName, sourceReferenceOhms: snapshot.referenceOhms, options })
    setNetworkExportError(null)
    setNetworkExportJobId(null)
    setNetworkExportStatus('submitting')
    setNetworkExportBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const { input, spec } = createTouchstoneNetworkExportJob(snapshot, options)
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
          if (current(generation, controller)) { setNetworkExportJobId(id); setNetworkExportStatus(next) }
        },
      })
      if (!current(generation, controller)) return
      const parsed = readTouchstoneNetworkExportResult(remote as JobResultV1, input)
      if (!current(generation, controller)) return
      setNetworkExport(parsed)
      setNetworkExportStatus('succeeded')
    } catch (cause) {
      if (!current(generation, controller) || controller.signal.aborted) return
      setNetworkExportStatus('failed')
      setNetworkExportError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (current(generation)) setNetworkExportBusy(false)
      }
    }
  }

  const cancelNetworkExport = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Touchstone network export cancelled', 'AbortError'))
    controllerRef.current = null
    setNetworkExportBusy(false)
    setNetworkExportStatus('cancelled')
    setNetworkExportJobId(null)
    setNetworkExport(null)
    setNetworkExportSnapshot(null)
  }

  const changeNetworkOption = (update: () => void) => {
    if (networkExportBusy) cancelNetworkExport()
    setNetworkExport(null)
    setNetworkExportError(null)
    update()
  }

  return (
    <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="touchstone-import-title">
      <div className="mb-3">
        <h2 id="touchstone-import-title" className="text-lg font-semibold text-slate-100">{zh ? '导入 Touchstone S 参数' : 'Import Touchstone S-parameters'}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
          {zh
            ? '本地预览受限的 Touchstone 1.0 与 2.0/2.1 子集，支持 .s1p 至 .s8p 和带显式端口数的 2.x .ts 文件，包括 Full、Lower 与 Upper 矩阵格式；Lower/Upper 声明按对称矩阵处理。S11 分析会明确提交已登录的 Host 作业，仅计算 VSWR、回波损耗和反射功率；另可对最多 4 端口提交完整网络 Touchstone 导出作业。此功能不调用 CST 求解器。'
            : 'Preview a bounded Touchstone 1.0 and 2.0/2.1 subset locally for .s1p through .s8p and Touchstone 2.x .ts files with a declared port count, including Full, Lower, and Upper matrix formats; Lower and Upper declarations are interpreted as symmetric matrices. S11 analysis explicitly submits an authenticated Host job for VSWR, return loss, and reflected power; a separate job can export complete network data for up to four ports. Neither workflow invokes the CST solver.'}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          {zh ? '合成示例：' : 'Synthetic examples: '}
          <a className="underline text-wave" href="/datasets/touchstone-example.s1p" download>touchstone-example.s1p</a>
          <span> · </span>
          <a className="underline text-wave" href="/datasets/touchstone-example.s2p" download>touchstone-example.s2p</a>
          <span> · </span>
          <a className="underline text-wave" href="/datasets/touchstone2-example.s2p" download>touchstone2-example.s2p</a>
          <span> · </span>
          <a className="underline text-wave" href="/datasets/touchstone2-example.s3p" download>touchstone2-example.s3p</a>
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-sm text-slate-300">
          {zh ? 'Touchstone 文件' : 'Touchstone file'}
          <input
            data-testid="touchstone-file"
            type="file"
            accept=".s1p,.s2p,.s3p,.s4p,.s5p,.s6p,.s7p,.s8p,.ts"
            onChange={(event) => { void chooseFile(event.currentTarget.files?.[0]) }}
            className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2 text-xs text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-wave/15 file:px-3 file:py-1 file:text-wave"
            aria-label={zh ? '选择 Touchstone 文件' : 'Choose Touchstone file'}
          />
        </label>
        <button data-testid="touchstone-analyze" type="button" onClick={() => void analyze()} disabled={!network || busy || networkExportBusy}
          className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? (zh ? '分析作业运行中…' : 'Analysis running…') : 'Analyze S11'}
        </button>
        {busy && <button data-testid="touchstone-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">Cancel analysis</button>}
      </div>

      {network && <div className="mt-4 rounded-lg border border-edge bg-surface p-3">
        <h3 className="text-sm font-semibold text-slate-200">{zh ? '完整网络 Touchstone 导出' : 'Complete network Touchstone export'}</h3>
        <p className="mt-1 text-xs text-slate-400">{zh ? '将导入的完整 S 矩阵提交到已登录的 Host 作业，并下载经验证的原生 .sNp 输出。导出保留来源参考阻抗，不执行重归一化。' : 'Submit the imported full S-matrix to an authenticated Host job and download its validated native .sNp output. The export preserves the source reference impedance and does not renormalize.'}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-300">{zh ? '频率单位' : 'Frequency unit'}
            <select data-testid="touchstone-network-frequency-unit" value={networkFrequencyUnit} onChange={event => changeNetworkOption(() => setNetworkFrequencyUnit(event.target.value as TouchstoneNetworkExportOptions['frequencyUnit']))} className="mt-1 block rounded border border-edge bg-panel p-2">
              {(['HZ', 'KHZ', 'MHZ', 'GHZ'] as const).map(unit => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-300">{zh ? '复数格式' : 'Complex format'}
            <select data-testid="touchstone-network-format" value={networkFormat} onChange={event => changeNetworkOption(() => setNetworkFormat(event.target.value as TouchstoneNetworkExportOptions['format']))} className="mt-1 block rounded border border-edge bg-panel p-2">
              {(['RI', 'MA', 'DB'] as const).map(format => <option key={format} value={format}>{format}</option>)}
            </select>
          </label>
          <p data-testid="touchstone-network-reference" className="text-xs text-slate-300">
            {zh ? '保留来源参考阻抗' : 'Source reference retained'}: {hasNonuniformReferenceImpedances
              ? <>{referenceImpedancesOhms?.map((impedance, index) => <span key={index}>{index > 0 ? ' · ' : ''}P{index + 1} R {impedance} Ω</span>)} · {zh ? 'S11 使用端口 1' : 'S11 uses port 1'}</>
              : <>R {network.referenceOhms} Ω</>}
          </p>
          <button data-testid="touchstone-network-export" type="button" onClick={() => void exportNetwork()} disabled={hasNonuniformReferenceImpedances || network.ports > 4 || network.points.length > Math.min(TOUCHSTONE_NETWORK_EXPORT_MAX_POINTS, Math.floor(TOUCHSTONE_NETWORK_EXPORT_BUDGET / (network.ports * network.ports))) || busy || networkExportBusy} className="btn border border-cyan-300 text-cyan-200 disabled:opacity-50">
            {networkExportBusy ? (zh ? '网络导出作业运行中…' : 'Network export running…') : (zh ? '导出完整网络' : 'Export complete network')}
          </button>
          {networkExportBusy && <button data-testid="touchstone-network-cancel" type="button" onClick={cancelNetworkExport} className="btn border border-edge text-slate-300">{zh ? '取消导出' : 'Cancel export'}</button>}
        </div>
        {network.ports > 4 && <p className="mt-2 text-xs text-amber-300" data-testid="touchstone-network-limit">{zh ? '完整网络导出最多支持 4 个端口；1 至 8 端口的 S11 分析仍可用。' : 'Complete network export supports up to 4 ports; S11 analysis remains available for 1 through 8 ports.'}</p>}
        {hasNonuniformReferenceImpedances && <p className="mt-2 text-xs text-amber-300" data-testid="touchstone-network-reference-limit">{zh ? '完整网络原生导出要求所有端口使用相同参考阻抗；当前文件的各端口参考阻抗不同。S11 分析仍可用。' : 'Native complete-network export requires the same reference impedance on every port; this file has nonuniform per-port references. S11 analysis remains available.'}</p>}
        {network.ports <= 4 && network.points.length > Math.min(TOUCHSTONE_NETWORK_EXPORT_MAX_POINTS, Math.floor(TOUCHSTONE_NETWORK_EXPORT_BUDGET / (network.ports * network.ports))) && <p className="mt-2 text-xs text-amber-300" data-testid="touchstone-network-budget-limit">{zh ? `完整网络导出预算为 ${TOUCHSTONE_NETWORK_EXPORT_BUDGET} 个矩阵元素；${network.ports} 端口最多支持 ${Math.min(TOUCHSTONE_NETWORK_EXPORT_MAX_POINTS, Math.floor(TOUCHSTONE_NETWORK_EXPORT_BUDGET / (network.ports * network.ports)))} 个频点，当前文件有 ${network.points.length} 个。S11 分析仍可用。` : `Complete network export is limited to ${TOUCHSTONE_NETWORK_EXPORT_BUDGET} matrix elements; ${network.ports}-port networks allow at most ${Math.min(TOUCHSTONE_NETWORK_EXPORT_MAX_POINTS, Math.floor(TOUCHSTONE_NETWORK_EXPORT_BUDGET / (network.ports * network.ports)))} points, and this file has ${network.points.length}. S11 analysis remains available.`}</p>}
        <p data-testid="touchstone-network-status" className="mt-2 text-xs text-slate-400" aria-live="polite">
          {zh ? '状态' : 'Status'}: {networkExportStatus}{networkExportJobId && ` · ${zh ? '任务' : 'Job'} ${networkExportJobId}`}
        </p>
        {networkExportError && <p role="alert" className="mt-2 text-sm text-red-300">{networkExportError}{networkExportError.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</p>}
        {networkExport && networkExportSnapshot && <div data-testid="touchstone-network-result" className="mt-3 rounded border border-edge p-3 text-xs text-slate-300">
          <p>{zh ? '来源' : 'Source'}: {networkExportSnapshot.sourceFileName} · {zh ? '请求' : 'Requested'}: {networkExportSnapshot.options.frequencyUnit} / {networkExportSnapshot.options.format} / R {networkExportSnapshot.sourceReferenceOhms} Ω</p>
          <p>{networkExport.ports}-port · {networkExport.param} · {networkExport.format} · {networkExport.freqUnit} · R {networkExport.ref} Ω · {networkExport.nPoints} points</p>
          <p className="mt-1">{networkExport.freqMinHz}–{networkExport.freqMaxHz} Hz · {networkExport.bytes} bytes · {networkExport.backend.deviceName} ({networkExport.backend.id}) · {networkExport.methodId}</p>
          <a data-testid="touchstone-network-download" className="mt-2 inline-block underline text-wave" href={`data:text/plain;charset=utf-8,${encodeURIComponent(networkExport.touchstone)}`} download={`network-${networkExport.ports}port.s${networkExport.ports}p`}>{zh ? '下载' : 'Download'} network-{networkExport.ports}port.s{networkExport.ports}p</a>
        </div>}
      </div>}
      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        {previewName && <span>{previewName} · </span>}{zh ? '状态' : 'Status'}: {status}{jobId && ` · ${zh ? '任务' : 'Job'} ${jobId}`}
      </p>

      {network && <div data-testid="touchstone-preview" className="mt-3 rounded-lg border border-edge bg-surface p-3 text-sm text-slate-300">
        <p>{network.fileName} · {network.ports}-port · {network.format} · {network.frequencyUnit} · {hasNonuniformReferenceImpedances
          ? <>{zh ? '端口参考阻抗' : 'Port refs'}: {referenceImpedancesOhms?.map((impedance, index) => <span key={index}>{index > 0 ? ' · ' : ''}P{index + 1} R {impedance} Ω</span>)} · {zh ? 'S11 使用端口 1' : 'S11 uses port 1'}</>
          : <>R {network.referenceOhms} Ω</>} · {network.points.length} {zh ? '个频点' : 'points'}</p>
        {network.ports > 1 && <p className="mt-1 text-xs text-amber-300">{zh ? '仅分析 S11；不提供 S21 或全端口网络分析。' : 'S11 only; S21 and all-port network analysis are not provided.'}</p>}
      </div>}

      {error && <div data-testid="touchstone-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">
        {error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}
      </div>}
      {result && submittedNetwork && <TouchstoneVswrResults network={submittedNetwork} result={result} />}
    </section>
  )
}
