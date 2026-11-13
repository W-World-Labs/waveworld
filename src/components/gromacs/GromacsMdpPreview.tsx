import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createModuleJobSpec, readModuleJobInput, readModuleResult, type SwModuleInput } from '../../lib/sim/module-compute'

const MODULE_ID = 'sw-gromacs-inputdeck' as const
const MAX_MDP_BYTES = 512 * 1024
const OUTPUT_KEYS = ['nstxout', 'nstvout', 'nstfout', 'nstlog', 'nstenergy', 'nstxtcout']

type MdpSummary = {
  nEntries: number
  cppDirectives: number
  duplicateKeys: number
  integrator: string | null
  dtPs: number | null
  nsteps: number | null
  tinitPs: number | null
  outputKeys: Array<{ key: string; nst: number }>
}
type RunPlan = {
  integrator: string | null
  dtPs: number | null
  nsteps: number | null
  tinitPs: number | null
  totalTimePs: number | null
  natoms: number | null
  outputs: Array<{ key: string; nst: number; frames: number | null }>
}
type Saved = { source: string; summary: MdpSummary; plan: RunPlan; jobId: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function preflight(source: string, zh: boolean): string | null {
  const entries = new Map<string, string>()
  for (const [index, raw] of source.split('\n').entries()) {
    const code = raw.replace(/\r$/, '').split(';', 1)[0].trim()
    if (!code || code.startsWith('#')) continue
    const equals = code.indexOf('=')
    if (equals < 0) return zh ? `第 ${index + 1} 行不是“key = value”格式。` : `Line ${index + 1} is not a 'key = value' pair.`
    if (!code.slice(0, equals).trim()) return zh ? `第 ${index + 1} 行的键为空。` : `Line ${index + 1} has an empty key.`
    const key = code.slice(0, equals).trim().toLowerCase()
    const value = code.slice(equals + 1).trim()
    const previous = entries.get(key)
    if (previous !== undefined && previous !== value) {
      return zh
        ? `第 ${index + 1} 行的 ${key} 与较早的值冲突；请在提交前解决重复项。`
        : `Line ${index + 1} has a conflicting duplicate for ${key}; resolve it before submitting.`
    }
    entries.set(key, value)
  }
  for (const key of ['dt', 'tinit', ...OUTPUT_KEYS]) {
    const raw = entries.get(key)
    if (raw === undefined || raw === '') continue
    if (!Number.isFinite(Number(raw))) return zh ? `${key} 必须是有限数值。` : `${key} must be a finite number.`
  }
  for (const key of ['nsteps', ...OUTPUT_KEYS]) {
    const raw = entries.get(key)
    if (raw === undefined || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || value > Number.MAX_SAFE_INTEGER) {
      return zh ? `${key} 必须是非负安全整数。` : `${key} must be a non-negative safe integer.`
    }
  }
  return null
}

function parseResult(value: unknown): { summary: MdpSummary; plan: RunPlan } {
  if (!isRecord(value) || value.methodId !== 'method-gromacs-deck-ingest' || value.familyId !== 'family-gromacs-inputdeck' ||
      value.ok !== true || !Array.isArray(value.diagnostics) || !isRecord(value.files) || !isRecord(value.files.mdp) || !isRecord(value.runPlan)) {
    throw new Error('The native result did not contain a valid GROMACS MDP setup preview.')
  }
  const mdp = value.files.mdp
  const plan = value.runPlan
  if (!isCount(mdp.nEntries) || !isCount(mdp.cppDirectives) || !isCount(mdp.duplicateKeys) ||
      !(mdp.integrator === null || typeof mdp.integrator === 'string') || !isFiniteOrNull(mdp.dtPs) ||
      !(mdp.nsteps === null || isCount(mdp.nsteps)) || !isFiniteOrNull(mdp.tinitPs) || !Array.isArray(mdp.outputKeys)) {
    throw new Error('The native GROMACS MDP summary has an unsupported shape; refusing to render it.')
  }
  const outputKeys = mdp.outputKeys.map(item => {
    if (!isRecord(item) || typeof item.key !== 'string' || !OUTPUT_KEYS.includes(item.key) || !isCount(item.nst)) {
      throw new Error('The native GROMACS MDP output summary is invalid.')
    }
    return { key: item.key, nst: item.nst }
  })
  if (!(plan.integrator === null || typeof plan.integrator === 'string') || !isFiniteOrNull(plan.dtPs) ||
      !(plan.nsteps === null || isCount(plan.nsteps)) || !isFiniteOrNull(plan.tinitPs) || !isFiniteOrNull(plan.totalTimePs) ||
      !(plan.natoms === null || isCount(plan.natoms)) || !Array.isArray(plan.outputs)) {
    throw new Error('The native GROMACS run plan has an unsupported shape; refusing to render it.')
  }
  const outputs = plan.outputs.map(item => {
    if (!isRecord(item) || typeof item.key !== 'string' || !OUTPUT_KEYS.includes(item.key) || !isCount(item.nst) ||
        !(item.frames === null || isCount(item.frames))) throw new Error('The native GROMACS run-plan output is invalid.')
    return { key: item.key, nst: item.nst, frames: item.frames }
  })
  return {
    summary: { nEntries: mdp.nEntries, cppDirectives: mdp.cppDirectives, duplicateKeys: mdp.duplicateKeys, integrator: mdp.integrator, dtPs: mdp.dtPs, nsteps: mdp.nsteps, tinitPs: mdp.tinitPs, outputKeys },
    plan: { integrator: plan.integrator, dtPs: plan.dtPs, nsteps: plan.nsteps, tinitPs: plan.tinitPs, totalTimePs: plan.totalTimePs, natoms: plan.natoms, outputs },
  }
}

export function GromacsMdpPreview() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const label = (en: string, cn: string) => zh ? cn : en
  const [source, setSource] = useState('')
  const [fileName, setFileName] = useState('')
  const [saved, setSaved] = useState<Saved | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1; controllerRef.current?.abort(); controllerRef.current = null }
  }, [])

  const reset = (text: string, name = '') => {
    generation.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false); setStatus('idle'); setError(null); setSaved(null); setSource(text); setFileName(name)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mdp')) { setError(label('Choose a .mdp parameter file.', '请选择 .mdp 参数文件。')); return }
    if (file.size > MAX_MDP_BYTES) { setError(label('The file exceeds the 512 KiB limit.', '文件超过 512 KiB 限制。')); return }
    try {
      const text = await file.text()
      if (new Blob([text]).size > MAX_MDP_BYTES) throw new Error(label('The file exceeds the 512 KiB limit.', '文件超过 512 KiB 限制。'))
      reset(text, file.name)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const run = async () => {
    if (busy || !source.trim() || new Blob([source]).size > MAX_MDP_BYTES) return
    const issue = preflight(source, zh)
    if (issue) { setError(issue); setStatus('failed'); setSaved(null); return }
    const current = ++generation.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true); setSaved(null); setError(null); setStatus('submitting')
    const input: SwModuleInput = { module: MODULE_ID, backend: 'host', mdp: source }
    let jobSpec: ReturnType<typeof createModuleJobSpec>
    try {
      jobSpec = createModuleJobSpec(input)
      readModuleJobInput(jobSpec)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); setStatus('failed'); setBusy(false); controllerRef.current = null; return
    }
    let jobId: string | null = null
    const isCurrent = () => mounted.current && generation.current === current && controllerRef.current === controller
    try {
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
      if (!isCurrent()) return
      const remote = await runRemoteJob(client, jobSpec, { signal: controller.signal, onStatus: (id, next) => { if (isCurrent()) { jobId = id; setStatus(next) } } })
      if (!isCurrent()) return
      const output = readModuleResult(remote as JobResultV1, input)
      if (!isRecord(output) || output.module !== MODULE_ID) throw new Error('The native result module identity did not match the requested GROMACS operation.')
      const parsed = parseResult(output.result)
      if (!isCurrent()) return
      setSaved({ source, ...parsed, jobId }); setStatus('succeeded')
    } catch (cause) {
      if (!isCurrent() || controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause)); setStatus('failed')
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; if (mounted.current && generation.current === current) setBusy(false) }
    }
  }

  const cancel = () => {
    generation.current += 1
    controllerRef.current?.abort(new DOMException('GROMACS MDP preview cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false); setStatus('cancelled'); setSaved(null)
  }
  const size = new Blob([source]).size
  const plan = saved?.plan

  return <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="gromacs-mdp-preview-title">
    <header className="mb-4">
      <h2 id="gromacs-mdp-preview-title" className="text-lg font-semibold">{label('GROMACS .mdp run-control preview', 'GROMACS .mdp 运行控制预览')}</h2>
      <p className="mt-1 text-sm text-slate-500">{label('Submits an MDP-only request to the existing sw-gromacs-inputdeck Host operation and displays its bounded run-control summary. This does not create a .tpr or run molecular dynamics.', '将仅含 MDP 的请求提交至现有 sw-gromacs-inputdeck Host 操作，并显示有界运行控制摘要。本功能不会生成 .tpr 或运行分子动力学。')}</p>
    </header>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <label className="text-sm">{label('Import .mdp', '导入 .mdp')}<input className="ml-2 max-w-full text-sm" type="file" accept=".mdp,text/plain" onChange={event => void importFile(event)} /></label>
      {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
      <span className="text-xs text-slate-500">{(size / 1024).toFixed(1)} KiB · {label('512 KiB file cap; shared 1 MiB serialized Host submission cap', '文件上限 512 KiB；Host 序列化提交上限 1 MiB')}</span>
    </div>
    <label className="block text-sm font-medium" htmlFor="gromacs-mdp-source">{label('Parameter file text', '参数文件文本')}</label>
    <textarea id="gromacs-mdp-source" className="mt-1 min-h-48 w-full rounded-lg border border-edge bg-background p-3 font-mono text-xs" value={source} maxLength={MAX_MDP_BYTES} spellCheck={false} onChange={event => reset(event.target.value)} />
    <p className="mt-1 text-xs text-slate-500">{label('The released reader accepts key = value lines, semicolon comments and skipped preprocessor directives. It summarizes integrator, dt, nsteps, tinit and selected output cadence keys. Other MDP options are counted but not validated against a GROMACS release.', '已发布读取器接受 key = value 行、分号注释并跳过预处理指令。它汇总 integrator、dt、nsteps、tinit 和指定输出频率；其他 MDP 选项仅计数，不会按特定 GROMACS 版本校验。')}</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="btn bg-cyan-300 text-slate-950 disabled:opacity-50" onClick={() => void run()} disabled={busy || !source.trim() || size > MAX_MDP_BYTES}>{busy ? label('Submitting…', '提交中…') : label('Prepare preview on Host', '在 Host 准备预览')}</button>
      {busy && <button type="button" className="btn border border-edge" onClick={cancel}>{label('Cancel request', '取消请求')}</button>}
      <span role="status">{status}</span>
      {saved?.jobId && <a className="text-sm text-cyan-300 underline" href={`/batch-jobs?job=${encodeURIComponent(saved.jobId)}`}>{label('View Host job', '查看 Host 任务')}</a>}
    </div>
    {plan && saved && <section className="mt-4 rounded-lg border border-edge bg-slate-950/30 p-3" aria-label={label('GROMACS MDP setup summary', 'GROMACS MDP 设置摘要')}>
      <h3 className="font-semibold">{label('Run-control summary', '运行控制摘要')}</h3>
      <p className="mt-1 text-xs text-slate-400">Host job {saved.jobId ?? '—'} · {saved.summary.nEntries} {label('unique keys', '个唯一键')} · {saved.summary.cppDirectives} {label('directives', '条指令')} · {saved.summary.duplicateKeys} {label('duplicate keys', '个重复键')}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {[[label('Integrator', '积分器'), plan.integrator], ['dt (ps)', plan.dtPs], ['nsteps', plan.nsteps], ['tinit (ps)', plan.tinitPs], [label('Total time (ps)', '总时间 (ps)'), plan.totalTimePs], [label('Atoms', '原子数'), plan.natoms]].map(([name, value]) => <div key={String(name)} className="rounded border border-edge/70 p-2"><dt className="text-xs text-slate-400">{name}</dt><dd className="break-words font-mono">{value ?? '—'}</dd></div>)}
      </dl>
      <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr className="text-slate-400"><th className="px-2 py-1">{label('Output key', '输出键')}</th><th className="px-2 py-1">nst</th><th className="px-2 py-1">{label('Frames', '帧数')}</th></tr></thead><tbody>{plan.outputs.map(output => <tr key={output.key} className="border-t border-edge/70"><td className="px-2 py-1 font-mono">{output.key}</td><td className="px-2 py-1">{output.nst}</td><td className="px-2 py-1">{output.frames ?? '—'}</td></tr>)}</tbody></table></div>
      <button type="button" className="mt-3 text-xs text-cyan-300 underline" onClick={() => { const url = URL.createObjectURL(new Blob([saved.source], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'input.mdp'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0) }}>{label('Download exact imported MDP', '下载原始 MDP')}</button>
    </section>}
  </section>
}
