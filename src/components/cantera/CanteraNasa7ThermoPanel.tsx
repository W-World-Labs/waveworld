import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createModuleJobSpec, readModuleResult } from '../../lib/sim/module-compute'
import {
  createCanteraNasaPolyNativeInput,
  parseCanteraNasaPolyPreparedText,
  validateCanteraNasaPolyNativeOutput,
  type CanteraNasaPolyEvaluation,
  type CanteraNasaPolyNativeInput,
  type CanteraNasaPolyPreparedRecord,
} from '../../lib/sim/cantera-nasa7-prepared'

const O2_PREPARED_RECORD = {
  name: 'O2',
  model: 'nasa7',
  'temperature-ranges': [200, 1000, 3500],
  data: [
    [3.782456360, -2.996734160e-3, 9.847302010e-6, -9.681295090e-9, 3.243728370e-12, -1.063943560e3, 3.657675730],
    [3.282537840, 1.483087540e-3, -7.579666690e-7, 2.094705550e-10, -2.167177940e-14, -1.088457720e3, 5.453231290],
  ],
  source: { file: 'Cantera v3.2.0 test/data/ideal-gas.yaml', species: 'O2' },
}

const ALCL3_NASA9_PREPARED_RECORD = {
  name: 'ALCL3',
  model: 'nasa9',
  'temperature-ranges': [200, 1000, 6000],
  data: [
    [77506.0097, -1440.779717, 14.01744141, -0.00638163124, 5.87167472e-6, -2.908872278e-9, 5.99405089e-13, -65793.4318, -44.94017799],
    [-137863.0916, -55.7920729, 10.04190387, -1.682165339e-5, 3.72466466e-9, -4.27552678e-13, 1.982341329e-17, -73434.0747, -20.45130429],
  ],
  source: { file: 'Cantera v2.6.0 test/data/nasa9-test.yaml', species: 'ALCL3' },
}

type CompletedStudy = {
  record: CanteraNasaPolyPreparedRecord
  preparedJson: string
  temperature: number
  input: CanteraNasaPolyNativeInput
  output: unknown
  evaluations: CanteraNasaPolyEvaluation[]
  jobId: string | null
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(9)).toString() : '—'
}

/** Imports prepared NASA7/NASA9 species JSON and submits it through the authenticated native Host job path. */
export function CanteraNasa7ThermoPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const label = (en: string, cn: string) => zh ? cn : en
  const [preparedJson, setPreparedJson] = useState(() => JSON.stringify(O2_PREPARED_RECORD, null, 2))
  const [sourceFilename, setSourceFilename] = useState('Cantera v3.2.0 test/data/ideal-gas.yaml · O2')
  const [record, setRecord] = useState<CanteraNasaPolyPreparedRecord | null>(null)
  const [temperature, setTemperature] = useState('300')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [study, setStudy] = useState<CompletedStudy | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Cantera thermo panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const isCurrent = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const importPrepared = (raw = preparedJson, fallbackFile = sourceFilename) => {
    setError(null)
    setStudy(null)
    try {
      const parsed = parseCanteraNasaPolyPreparedText(raw, fallbackFile)
      setRecord(parsed)
      const requested = parsed.initialTemperature ?? 300
      setTemperature(String(Math.max(parsed.ranges[0], Math.min(parsed.ranges[parsed.ranges.length - 1], requested))))
      setStatus('prepared')
      return true
    } catch (cause) {
      setRecord(null)
      setStatus('invalid-input')
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  const loadExample = () => {
    const raw = JSON.stringify(O2_PREPARED_RECORD, null, 2)
    setPreparedJson(raw)
    setSourceFilename('Cantera v3.2.0 test/data/ideal-gas.yaml · O2')
    importPrepared(raw, 'Cantera v3.2.0 test/data/ideal-gas.yaml · O2')
  }

  const loadNasa9Example = () => {
    const raw = JSON.stringify(ALCL3_NASA9_PREPARED_RECORD, null, 2)
    setPreparedJson(raw)
    setSourceFilename('Cantera v2.6.0 test/data/nasa9-test.yaml · ALCL3')
    importPrepared(raw, 'Cantera v2.6.0 test/data/nasa9-test.yaml · ALCL3')
  }

  const readPreparedFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 65536) {
      setRecord(null)
      setStatus('invalid-input')
      setError(label('Prepared JSON must be at most 64 KiB.', '准备好的 JSON 不得超过 64 KiB。'))
      return
    }
    try {
      const raw = await file.text()
      setPreparedJson(raw)
      setSourceFilename(file.name)
      importPrepared(raw, file.name)
    } catch (cause) {
      setRecord(null)
      setStatus('invalid-input')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const submit = async () => {
    if (!record || busy) return
    const selectedTemperature = Number(temperature)
    let input: CanteraNasaPolyNativeInput
    try {
      input = createCanteraNasaPolyNativeInput(record, selectedTemperature)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('invalid-input')
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    const capturedRecord: CanteraNasaPolyPreparedRecord = record
    const capturedJson = preparedJson
    setStudy(null)
    setJobId(null)
    setError(null)
    setBusy(true)
    setStatus('submitting')
    const controller = new AbortController()
    controllerRef.current = controller
    let submittedJobId: string | null = null
    try {
      const spec = createModuleJobSpec(input)
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
      if (!isCurrent(generation, controller)) return
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (!isCurrent(generation, controller)) return
          submittedJobId = id
          setJobId(id)
          setStatus(next)
        },
      })
      if (!isCurrent(generation, controller)) return
      const output = readModuleResult(remote as JobResultV1, input)
      const evaluations = validateCanteraNasaPolyNativeOutput(output, input)
      if (!isCurrent(generation, controller)) return
      setStudy({ record: capturedRecord, preparedJson: capturedJson, temperature: selectedTemperature, input, output, evaluations, jobId: submittedJobId })
      setStatus('succeeded')
    } catch (cause) {
      if (!isCurrent(generation, controller) || controller.signal.aborted) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (isCurrent(generation)) setBusy(false)
      }
    }
  }

  const cancel = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Cantera thermo job cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setStudy(null)
  }

  const validTemperature = record !== null && Number.isFinite(Number(temperature))
    && Number(temperature) >= record.ranges[0] && Number(temperature) <= record.ranges[record.ranges.length - 1]

  return <section data-testid="cantera-nasa7-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="cantera-nasa7-title">
    <div className="mb-4">
      <h2 id="cantera-nasa7-title" className="text-lg font-semibold text-ink">{label('Cantera NASA species thermo', 'Cantera NASA 物种热力学')}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted">{label(
    'Import one prepared NASA7 or multi-range NASA9 species record, select a temperature, and submit the existing sw-cantera-nasa-poly operation to the authenticated W-Sim Host job path.',
    '导入一个准备好的 NASA7 或多区间 NASA9 物种记录，选择温度，并通过已认证的 W-Sim Host 作业路径提交现有 sw-cantera-nasa-poly 操作。',
      )}</p>
      <p className="mt-2 text-xs text-muted">{label(
    'This page accepts prepared JSON, not raw YAML. It sends one named species’ ranges and coefficients; it does not load phases, reactions, transport, or a full mechanism, and it does not represent COMSOL interoperability.',
    '此页面接收准备好的 JSON，不直接解析原始 YAML。仅发送单个指定物种的温度范围和系数；不加载 Cantera 相、反应、输运或完整机理，也不表示与 COMSOL 的互操作性。',
      )}</p>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <button type="button" data-testid="cantera-nasa7-load-example" onClick={loadExample} disabled={busy} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface">{label('Load O2 example', '加载 O2 示例')}</button>
      <button type="button" data-testid="cantera-nasa9-load-example" onClick={loadNasa9Example} disabled={busy} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface">{label('Load ALCL3 NASA9 example', '加载 ALCL3 NASA9 示例')}</button>
      <label className="text-sm text-ink">{label('Import prepared JSON', '导入准备好的 JSON')}
        <input data-testid="cantera-nasa7-file" type="file" accept=".json,application/json" disabled={busy} onChange={event => void readPreparedFile(event.currentTarget.files?.[0])} className="ml-2 max-w-[min(100%,22rem)] text-xs text-muted" />
      </label>
    </div>
    <label className="mt-4 block text-sm font-medium text-ink" htmlFor="cantera-nasa7-prepared-json">{label('Prepared NASA7 / NASA9 JSON', '准备好的 NASA7 / NASA9 JSON')}</label>
    <textarea id="cantera-nasa7-prepared-json" data-testid="cantera-nasa7-prepared-json" value={preparedJson} disabled={busy} onChange={event => {
      setPreparedJson(event.target.value)
      setRecord(null)
      setStudy(null)
      setStatus('edited')
      setError(null)
    }} rows={12} spellCheck={false} className="mt-2 w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-cyan-100" />
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" data-testid="cantera-nasa7-import" disabled={busy} onClick={() => importPrepared()} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface">{label('Validate prepared record', '校验准备好的记录')}</button>
      {record && <span data-testid="cantera-nasa7-source" className="text-xs text-muted">{label('Source', '来源')}: {record.sourceFile || sourceFilename} · {record.name}</span>}
    </div>

    {record && <div className="mt-4 rounded-lg border border-edge p-3">
      <h3 className="font-semibold text-ink">{label('Prepared species record', '准备好的物种记录')}: {record.name} · {record.model.toUpperCase()}</h3>
      <p className="mt-1 text-xs text-muted">{label('Temperature ranges (K)', '温度范围 (K)')}: {record.ranges.join(' · ')}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left text-xs text-muted">
        <thead><tr className="border-b border-edge"><th className="p-2">{label('Range (K)', '范围 (K)')}</th>{Array.from({ length: record.model === 'nasa7' ? 7 : 9 }, (_, i) => <th className="p-2" key={i}>a{i + 1}</th>)}</tr></thead>
        <tbody>{record.coefficients.map((row, index) => <tr className="border-b border-edge/60" key={index}>
          <th className="p-2 font-medium">{record.ranges[index]}–{record.ranges[index + 1]}</th>
          {row.map((value, i) => <td className="p-2 font-mono" key={i}>{value.toExponential(9)}</td>)}
        </tr>)}</tbody>
      </table></div>
      <label className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink">
        <span>{label('Selected temperature (K)', '所选温度 (K)')}</span>
        <input data-testid="cantera-nasa7-temperature" aria-label={`Cantera ${record.model.toUpperCase()} selected temperature (K)`} type="number" min={record.ranges[0]} max={record.ranges[record.ranges.length - 1]} step="any" value={temperature}
          onChange={event => setTemperature(event.target.value)} className="min-h-11 w-36 rounded border border-edge bg-slate-950 px-3 font-mono" />
        <span className="text-xs text-muted">{record.ranges[0]}–{record.ranges[record.ranges.length - 1]} K</span>
      </label>
      <h4 className="mb-2 mt-4 text-sm font-semibold text-ink">{label('Native input preview', '原生输入预览')}</h4>
      <pre data-testid="cantera-nasa7-native-input" className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-cyan-100"><code>{JSON.stringify(validTemperature ? createCanteraNasaPolyNativeInput(record, Number(temperature)) : null, null, 2)}</code></pre>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" data-testid="cantera-nasa7-submit" disabled={!validTemperature || busy} onClick={() => void submit()} className="rounded-lg bg-wave px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{busy ? label('Submitting…', '正在提交…') : label('Submit Host job', '提交 Host 作业')}</button>
        {busy && <button type="button" data-testid="cantera-nasa7-cancel" onClick={cancel} className="rounded-lg border border-edge px-4 py-2 text-sm text-ink">{label('Cancel job', '取消作业')}</button>}
        {!getStoredUserToken() && <a data-testid="cantera-nasa7-login" className="text-sm text-wave underline" href={oidcStartHref(typeof window === 'undefined' ? '/comsol' : `${window.location.pathname}${window.location.search}`)}>{label('Sign in to submit a Host job', '登录后提交 Host 作业')}</a>}
      </div>
    </div>}

    <p data-testid="cantera-nasa7-status" className="mt-3 text-xs text-muted" aria-live="polite">{label(`Status: ${status}${jobId ? ` · Job ${jobId}` : ''}`, `状态：${status}${jobId ? ` · 作业 ${jobId}` : ''}`)}</p>
    {error && <p role="alert" data-testid="cantera-nasa7-error" className="mt-2 text-sm text-red-400">{error}</p>}

    {study && <section data-testid="cantera-nasa7-results" aria-labelledby="cantera-nasa7-results-title" className="mt-5 rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 id="cantera-nasa7-results-title" className="text-base font-semibold text-ink">{label(`Native ${study.record.model.toUpperCase()} thermo result`, `原生 ${study.record.model.toUpperCase()} 热力学结果`)}</h3>
          <p className="mt-1 text-xs text-muted">{label('Captured source', '记录来源')}: {study.record.sourceFile || sourceFilename} · {study.record.sourceSpecies || study.record.name}; {label('job', '作业')} {study.jobId ?? '—'}</p></div>
        <button type="button" data-testid="cantera-nasa7-export" onClick={() => downloadJson(`cantera-${study.record.model}-native-result.json`, {
          source: { file: study.record.sourceFile || sourceFilename, species: study.record.sourceSpecies || study.record.name },
          preparedSourceJson: study.preparedJson,
          selectedTemperatureK: study.temperature,
          submittedInput: study.input,
          jobId: study.jobId,
          nativeResult: study.output,
        })} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface">{label('Export provenance, prepared JSON, input and result', '导出来源信息、准备 JSON、输入和结果')}</button>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-edge"><table className="w-full text-left text-sm">
        <thead className="bg-surface text-muted"><tr><th className="px-3 py-2">T (K)</th><th className="px-3 py-2">cp (J/mol/K)</th><th className="px-3 py-2">h (J/mol)</th><th className="px-3 py-2">s (J/mol/K)</th></tr></thead>
        <tbody>{study.evaluations.map((evaluation, index) => <tr key={`${evaluation.T}-${index}`} className="border-t border-edge">
          <td className="px-3 py-2 font-mono text-ink">{format(evaluation.T)}</td><td className="px-3 py-2 font-mono text-ink">{format(evaluation.cp)}</td><td className="px-3 py-2 font-mono text-ink">{format(evaluation.h)}</td><td className="px-3 py-2 font-mono text-ink">{format(evaluation.s)}</td>
        </tr>)}</tbody>
      </table></div>
      <details className="mt-3"><summary className="cursor-pointer text-sm text-muted">{label('Show native evaluation fields', '查看原生评估字段')}</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-cyan-100"><code>{JSON.stringify(study.evaluations, null, 2)}</code></pre></details>
      <p className="mt-3 text-xs text-muted">{label('Values are returned by the selected native W-Sim operation; this panel does not evaluate polynomial equations in the browser.', '数值由所选 W-Sim 原生操作返回；此面板不会在浏览器中计算多项式。')}</p>
    </section>}
  </section>
}

export default CanteraNasa7ThermoPanel
