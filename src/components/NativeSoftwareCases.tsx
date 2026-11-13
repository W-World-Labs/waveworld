import { useContext, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from './PageHeader'
import { useLocale } from '../lib/i18n'
import { ModuleComputeContext, useModuleCompute } from '../lib/hooks/useModuleCompute'
import { createModuleJobSpec, isNativeAlgorithmInput, type ModuleComputeInput, type NativeAlgorithmInput, type SwModuleInput } from '../lib/sim/module-compute'

export interface NativeSoftwareCase {
  file: string
  module: string
  product?: string
  mappedFeature?: string
  selectorChecks?: readonly { path: string; equals?: string | number | boolean; present?: true }[]
  abaqusFeature?: string
  opticStudioFeature?: string
  summary: string
  selector: string
  input: { module: string; [key: string]: unknown }
  exampleName: string
  limitations: string | string[]
  sourceUrls?: string[]
}

interface NativeSoftwareCasesProps<T extends NativeSoftwareCase> {
  cases: readonly T[]
  prefix: string
  software: string
  title: string
  titleEn: string
  subtitle: string
  subtitleEn: string
  scopeZh: string
  scopeEn: string
  searchPlaceholderZh: string
  searchPlaceholderEn: string
  showProductFilter?: boolean
  /** Filter caption; defaults to the historic Ansys wording for compatibility. */
  productFilterLabel?: { zh: string; en: string; ariaLabel: string }
  /** Optional exact allowlist for catalogs sharing a module namespace. */
  allowedModules?: ReadonlySet<string>
  submitLabelZh?: string
  submitLabelEn?: string
  submitAriaLabel?: string
}

export function parseNativeSoftwareEditorInput(raw: string, expectedModule: string, prefix: string): SwModuleInput | null
export function parseNativeSoftwareEditorInput(raw: string, expectedModule: string, prefix: string, allowedModules?: ReadonlySet<string>): ModuleComputeInput | null
export function parseNativeSoftwareEditorInput(raw: string, expectedModule: string, prefix: string, allowedModules: ReadonlySet<string> | undefined, expectedInput: NativeSoftwareCase['input'], selectorChecks?: NativeSoftwareCase['selectorChecks']): ModuleComputeInput | null
export function parseNativeSoftwareEditorInput(raw: string, expectedModule: string, prefix: string, allowedModules?: ReadonlySet<string>, expectedInput?: NativeSoftwareCase['input'], selectorChecks?: NativeSoftwareCase['selectorChecks']): ModuleComputeInput | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (record.module !== expectedModule || (allowedModules ? !allowedModules.has(expectedModule) : !expectedModule.startsWith(prefix))) return null
    if (expectedInput && (record.backend !== 'host' || !(selectorChecks?.length ? matchesSelectorChecks(record, selectorChecks) : matchesNativeSelector(expectedInput, record)))) return null
    if (!expectedModule.startsWith(prefix)) {
      const curatedOpenSourceCase = !!expectedInput
        && !!selectorChecks?.length
        && (expectedModule.startsWith('sw-openfoam-') || expectedModule.startsWith('sw-su2-'))
        && record.backend === 'host'
        && matchesSelectorChecks(record, selectorChecks)
      const curatedElectromagneticCase = !!expectedInput
        && !!selectorChecks?.length
        && isCuratedEmModule(expectedModule)
        && record.backend === 'host'
        && matchesSelectorChecks(record, selectorChecks)
      const curatedOpticsCase = !!expectedInput
        && !!selectorChecks?.length
        && expectedModule.startsWith('sw-optics-')
        && record.backend === 'host'
        && matchesSelectorChecks(record, selectorChecks)
      return allowedModules && allowedModules.has(expectedModule) && (curatedOpenSourceCase || curatedElectromagneticCase
        || curatedOpticsCase || (!!expectedInput && matchesNativeSelector(expectedInput, record)) || isNativeAlgorithmInput(record))
        ? record as NativeAlgorithmInput
        : null
    }
    const backend = record.backend ?? 'host'
    if (backend !== 'host' && backend !== 'auto' && backend !== 'cuda') return null
    return { ...record, backend } as SwModuleInput
  } catch {
    return null
  }
}

export function createNativeSoftwareJobInput(example: NativeSoftwareCase, raw: string, prefix: string): SwModuleInput
export function createNativeSoftwareJobInput(example: NativeSoftwareCase, raw: string, prefix: string, allowedModules?: ReadonlySet<string>): ModuleComputeInput
export function createNativeSoftwareJobInput(example: NativeSoftwareCase, raw: string, prefix: string, allowedModules?: ReadonlySet<string>): ModuleComputeInput {
  const input = example.mappedFeature || example.opticStudioFeature
    ? parseNativeSoftwareEditorInput(raw, example.module, prefix, allowedModules, example.input, example.selectorChecks)
    : parseNativeSoftwareEditorInput(raw, example.module, prefix, allowedModules)
  if (!input) throw new Error(`Input must be valid JSON for the selected ${example.module} native module.`)
  return input
}

function matchesNativeSelector(expectedInput: NativeSoftwareCase['input'], candidate: Record<string, unknown>): boolean {
  const keys = ['operation', 'op', 'method', 'analysis', 'selector', 'algo', 'methodId'].filter(key => typeof expectedInput[key] === 'string')
  return keys.length > 0 && keys.every(key => candidate[key] === expectedInput[key])
}

function valuesAtPath(value: unknown, path: string): unknown[] {
  const [segment, ...rest] = path.split('.')
  if (!segment) return []
  const array = segment.endsWith('[]')
  const key = array ? segment.slice(0, -2) : segment
  if (!value || typeof value !== 'object' || !(key in value)) return []
  const found = (value as Record<string, unknown>)[key]
  if (array) return Array.isArray(found) ? found.flatMap(item => rest.length ? valuesAtPath(item, rest.join('.')) : [item]) : []
  return rest.length ? valuesAtPath(found, rest.join('.')) : [found]
}

function matchesSelectorChecks(input: Record<string, unknown>, checks: NonNullable<NativeSoftwareCase['selectorChecks']>): boolean {
  return checks.length > 0 && checks.every(check => {
    const values = valuesAtPath(input, check.path)
    if (check.present) return values.some(value => value !== undefined && value !== null)
    return check.equals !== undefined && values.some(value => value === check.equals)
  })
}

export function matchesNativeSoftwareOperation(example: NativeSoftwareCase, input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const actual = input as Record<string, unknown>
  if (actual.module !== example.module) return false
  const expected = example.input as Record<string, unknown>
  if (actual.backend !== 'host') return false
  if (example.selectorChecks?.length) {
    if (!matchesSelectorChecks(actual, example.selectorChecks)) return false
  } else {
    const keys = example.module.startsWith('sw-openmodelica-')
      ? ['operation', 'op', 'method', 'analysis', 'selector', 'algo', 'methodId', 'mode', 'problem', 'task', 'action', 'workflow']
      : ['operation', 'op', 'method', 'analysis', 'selector', 'algo', 'methodId']
    const declared = example.selector.match(/^([A-Za-z][A-Za-z0-9_]*)=(.+)$/)
    const selector = declared?.[1] ?? keys.find(key => typeof expected[key] === 'string')
    if (!selector || actual[selector] !== expected[selector]) return false
    if (declared && String(expected[selector]) !== declared[2]) return false
  }
  const curatedOpenSourceCase = !!example.mappedFeature
    && !!example.selectorChecks?.length
    && (example.module.startsWith('sw-openfoam-') || example.module.startsWith('sw-su2-'))
  const curatedElectromagneticCase = !!example.mappedFeature
    && !!example.selectorChecks?.length
    && isCuratedEmModule(example.module)
  if (example.module.startsWith('sw-openfoam-') || example.module.startsWith('sw-su2-')) return curatedOpenSourceCase
  if (isCuratedEmModule(example.module)) return curatedElectromagneticCase
  return !!example.opticStudioFeature || example.module.startsWith('sw-optics-') || example.module.startsWith('sw-openmodelica-') || isNativeAlgorithmInput(input)
}

function isCuratedEmModule(module: string): boolean {
  return module.startsWith('sw-em-') || module.startsWith('sw-emfdtd-')
}

/** Retained export for existing OpticStudio callers/tests. */
export const matchesOpticStudioNativeOperation = matchesNativeSoftwareOperation

/** Reports use the captured submitted input and case identity, never current editor state. */
export function createNativeSoftwareResultReport(
  example: NativeSoftwareCase,
  submittedInput: ModuleComputeInput,
  result: unknown,
  jobId: string | null,
): string {
  if (submittedInput.module !== example.module) throw new Error('Submitted input does not match the submitted case.')
  return JSON.stringify({
    jobId,
    case: { exampleName: example.exampleName, module: example.module, selector: example.selector },
    spec: createModuleJobSpec(submittedInput),
    submittedInput,
    result,
    limitations: example.limitations,
  }, null, 2)
}

function downloadReport(name: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function NativeSoftwareCases<T extends NativeSoftwareCase>(props: NativeSoftwareCasesProps<T>) {
  const { cases, prefix, software, title, titleEn, subtitle, subtitleEn, scopeZh, scopeEn,
    searchPlaceholderZh, searchPlaceholderEn, showProductFilter = false, productFilterLabel,
    submitLabelZh, submitLabelEn, submitAriaLabel, allowedModules } = props
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [selectedName, setSelectedName] = useState(cases[0]?.exampleName ?? '')
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState('all')
  const [rawInput, setRawInput] = useState(() => cases[0] ? JSON.stringify(cases[0].input, null, 2) : '{}')
  const [submittedCaseName, setSubmittedCaseName] = useState<string | null>(null)
  const selected = cases.find(example => example.exampleName === selectedName) ?? cases[0]
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return cases.filter(example => (product === 'all' || example.product === product)
      && (!needle || [example.product ?? '', example.mappedFeature ?? '', example.abaqusFeature ?? '', example.opticStudioFeature ?? '', example.module, example.summary, example.selector, example.exampleName]
        .some(value => value.toLowerCase().includes(needle))))
  }, [cases, product, query])
  const selectorInput = selected?.mappedFeature || selected?.opticStudioFeature ? selected.input : undefined
  const parseSelectedInput = (raw: string) => selected
    ? selectorInput
      ? parseNativeSoftwareEditorInput(raw, selected.module, prefix, allowedModules, selectorInput, selected?.selectorChecks)
      : parseNativeSoftwareEditorInput(raw, selected.module, prefix, allowedModules)
    : null
  const editorInput = parseSelectedInput(rawInput)
  const input = editorInput ?? parseSelectedInput(selected ? JSON.stringify(selected.input) : '{}')
  const compute = useModuleCompute(input ?? { module: `${prefix}unavailable` as `sw-${string}`, backend: 'host' })
  const execution = useContext(ModuleComputeContext)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  const chooseCase = (exampleName: string) => {
    const next = cases.find(example => example.exampleName === exampleName)
    if (!next) return
    setSelectedName(next.exampleName)
    setRawInput(JSON.stringify(next.input, null, 2))
  }
  const submit = () => {
    if (!selected || !editorInput || execution?.target !== 'backend' || execution.busy) return
    try {
      createNativeSoftwareJobInput(selected, rawInput, prefix, allowedModules)
      setSubmittedCaseName(selected.exampleName)
      void execution.start(true)
    } catch (cause) {
      execution.reportLocalError(cause)
    }
  }
  const output = compute.result
  const submittedInput = compute.submittedInput
  const submittedCase = submittedCaseName ? cases.find(item => item.exampleName === submittedCaseName) : undefined
  const downloadResult = () => {
    if (!submittedCase || !submittedInput || !output) return
    const safeName = submittedCase.exampleName.replace(/[^a-z0-9-]/gi, '_')
    downloadReport(`waveworld-${safeName}-result.json`, createNativeSoftwareResultReport(submittedCase, submittedInput, output, execution?.jobId ?? null))
  }

  return <div className="space-y-5" data-sim-stage={software.toLowerCase()}>
    <PageHeader title={title} titleEn={titleEn} subtitle={subtitle} subtitleEn={subtitleEn} icon="🧩" showMethods={false} />
    <section className="rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4 text-sm leading-relaxed text-slate-300" aria-label={zh ? `${software} 使用范围` : `${software} scope`}>
      {zh ? scopeZh : scopeEn}
    </section>

    {!selected ? <p role="status" className="rounded-xl border border-edge p-5 text-sm text-slate-400">{zh ? `当前没有可用的 ${software} 原生案例。` : `No ${software} native cases are available.`}</p> : <>
      <div className="grid gap-5 xl:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.4fr)]">
        <section className="space-y-4 rounded-xl border border-edge bg-panel/40 p-4" aria-label={zh ? '选择案例' : 'Choose a case'}>
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block font-medium">{zh ? '搜索原生模块与算例' : 'Search native modules and cases'}</span>
            <input value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-edge bg-slate-950 px-3 py-2 text-slate-100" placeholder={zh ? searchPlaceholderZh : searchPlaceholderEn} />
          </label>
          {showProductFilter && <label className="block text-sm text-slate-300">
            <span className="mb-2 block font-medium">{zh ? productFilterLabel?.zh ?? 'Ansys 产品' : productFilterLabel?.en ?? 'Ansys product'}</span>
            <select aria-label={productFilterLabel?.ariaLabel ?? 'Ansys product filter'} value={product} onChange={event => setProduct(event.target.value)} className="min-h-11 w-full rounded-lg border border-edge bg-slate-950 px-3 text-slate-100">
              <option value="all">{zh ? '所有产品' : 'All products'}</option>
              {[...new Set(cases.map(item => item.product).filter((value): value is string => !!value))].sort().map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>}
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block font-medium">{zh ? `${software} 能力 / 算例` : `${software} capability / case`}</span>
            <select aria-label={`${software} capability`} value={filtered.some(example => example.exampleName === selected.exampleName) ? selected.exampleName : ''} onChange={event => chooseCase(event.target.value)} className="min-h-11 w-full rounded-lg border border-edge bg-slate-950 px-3 text-slate-100">
              {!filtered.some(example => example.exampleName === selected.exampleName) && <option value="">{zh ? '此筛选下没有当前选项' : 'Current case is outside this filter'}</option>}
            {(() => {
              const groups = new Map<string, T[]>()
              for (const example of filtered) {
                const workflow = example.product ?? example.mappedFeature ?? example.opticStudioFeature ?? ''
                const bucket = groups.get(workflow) ?? []
                bucket.push(example)
                groups.set(workflow, bucket)
              }
              if (!filtered.some(example => example.mappedFeature || example.opticStudioFeature)) return filtered.map(example => <option key={example.exampleName} value={example.exampleName}>{example.product ? `${example.product} · ` : ''}{example.module} — {example.selector}</option>)
              return [...groups].map(([workflow, examples]) => <optgroup key={workflow || 'other'} label={workflow || (zh ? '其他能力' : 'Other capabilities')}>
                {examples.map(example => <option key={example.exampleName} value={example.exampleName}>{example.product ? `${example.product} · ` : ''}{example.module} — {example.selector}</option>)}
              </optgroup>)
            })()}
            </select>
            <span className="mt-2 block text-xs text-slate-500">{zh ? `${filtered.length} 个可选原生算例` : `${filtered.length} native cases available`}</span>
          </label>
          <div className="rounded-lg border border-edge bg-slate-950/50 p-3">
            <p className="font-medium text-slate-100">{selected.summary}</p>
            {selected.abaqusFeature && <p className="mt-2 text-xs text-slate-400"><span className="font-semibold">{zh ? '映射的 Abaqus 功能：' : 'Mapped Abaqus feature: '}</span>{selected.abaqusFeature}</p>}
            {selected.mappedFeature && <p className="mt-2 text-xs text-slate-400"><span className="font-semibold">{zh ? `映射的 ${software} 功能：` : `Mapped ${software} feature: `}</span>{selected.mappedFeature}</p>}
            {selected.opticStudioFeature && <p className="mt-2 text-xs text-slate-400"><span className="font-semibold">{zh ? '光学工作流：' : 'Optical workflow: '}</span>{selected.opticStudioFeature}</p>}
            <p className="mt-2 text-sm text-cyan-200">{selected.selector}</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-500">{selected.module}</p>
            {!!selected.limitations && <p className="mt-3 text-xs leading-relaxed text-amber-200/90"><span className="font-semibold">{zh ? '当前边界：' : 'Current limits: '}</span>{Array.isArray(selected.limitations) ? selected.limitations.join('；') : selected.limitations}</p>}
            {selected.sourceUrls?.length ? <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">{selected.sourceUrls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-cyan-300 underline">{zh ? `${software} 文档来源` : `${software} documentation source`}</a>)}</div> : null}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-edge bg-panel/40 p-4" aria-label={zh ? '算例参数' : 'Case inputs'}>
          <div><h2 className="font-semibold text-slate-100">{zh ? '检查并编辑输入' : 'Review and edit inputs'}</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">{zh ? '输入以原生模块 JSON 保存；模块名固定为所选能力。提交前会由原生模块再次校验。' : 'Inputs are saved as native-module JSON. The module ID is pinned to the selected capability and validated again by the native module on submission.'}</p></div>
          <label className="block text-sm text-slate-300"><span className="sr-only">{zh ? `${software} 输入` : `${software} input`}</span><textarea aria-label={`${software} input`} value={rawInput} onChange={event => setRawInput(event.target.value)} spellCheck={false} rows={18} className="min-h-[24rem] w-full resize-y rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100" /></label>
          {!editorInput && <p role="alert" className="rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200">{zh ? '输入 JSON 无效，或 module 与所选能力不匹配。请修正后再提交。' : 'The JSON is invalid or its module does not match the selected capability. Fix it before submitting.'}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-label={submitAriaLabel ?? `Submit to ${software}`} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!editorInput || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit}>{execution?.busy ? (zh ? '任务提交中…' : 'Submitting job…') : (zh ? submitLabelZh ?? `提交 ${software} 任务` : submitLabelEn ?? `Submit ${software} job`)}</button>
            {execution?.busy && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '停止任务' : 'Stop job'}</button>}
            {execution?.status && <span role="status" className="text-sm text-slate-400">{execution.status}</span>}
            {execution?.jobId && (!allowedModules || allowedModules.has(selected.module)) && submittedCase?.module === selected.module && (!(selected.mappedFeature || selected.opticStudioFeature) || matchesNativeSoftwareOperation(submittedCase, submittedInput)) && <Link to={`/batch-jobs?job=${encodeURIComponent(execution.jobId)}`} className="text-sm text-cyan-300 underline">{zh ? '查看任务状态与已保存结果' : 'View job status and saved results'}</Link>}
          </div>
        </section>
      </div>
      {output && submittedCase && submittedInput && <section className="space-y-3 rounded-xl border border-emerald-400/20 bg-emerald-950/10 p-4" aria-label={zh ? `${software} 结果` : `${software} result`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-emerald-100">{zh ? '已保存的模块结果' : 'Saved module result'}</h2><p className="mt-1 text-xs text-slate-400">{zh ? `提交案例：${submittedCase.exampleName}；查看不会重新运行计算。` : `Submitted case: ${submittedCase.exampleName}. Viewing does not rerun computation.`}</p></div><button type="button" aria-label="Download result" className="btn border border-edge" onClick={downloadResult}>{zh ? '下载结果报告 JSON' : 'Download result report JSON'}</button></div>
        <details className="rounded-lg border border-edge bg-slate-950/60 p-3"><summary className="min-h-10 cursor-pointer py-2 text-sm text-slate-300">{zh ? '查看完整结果 JSON' : 'Inspect full result JSON'}</summary><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(output, null, 2)}</pre></details>
      </section>}
    </>}
  </div>
}
