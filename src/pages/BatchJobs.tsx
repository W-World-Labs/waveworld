import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { JobResultView } from '../components/JobResultView'
import { useLocale } from '../lib/i18n'
import { cancelHostJob, fetchHostJob, fetchHostJobs, isHostAuthError, oidcStartHref, type HostJobDetail, type HostJobSummary } from '../lib/hostApi'
import { ALL_LEAVES } from '../nav'
import { ABAQUS_NATIVE_CASES } from '../data/abaqusCases'
import { OPTICSTUDIO_NATIVE_CASES } from '../data/opticstudioCases'
import { DYMOLA_NATIVE_CASES } from '../data/dymolaCases'
import { STAR_CCM_NATIVE_CASES } from '../data/starCcmCases'
import { CST_NATIVE_CASES } from '../data/cstCases'
import { matchesNativeSoftwareOperation } from '../components/NativeSoftwareCases'
import { isNativeAlgorithmInput } from '../lib/sim/module-compute'

const active = (job: Pick<HostJobSummary, 'status'>) => ['queued', 'leased', 'running', 'cancelling'].includes(job.status)
const pending = (job: HostJobSummary) => active(job) || !!job.compute && job.compute.phase !== 'stopped'
const statuses: Record<string, [string, string]> = {
  queued: ['排队中', 'Queued'], leased: ['准备计算', 'Preparing'], running: ['计算中', 'Running'],
  cancelling: ['正在取消', 'Cancelling'], succeeded: ['已完成', 'Completed'], failed: ['失败', 'Failed'], cancelled: ['已取消', 'Cancelled'],
}
function statusClass(status: string) {
  return status === 'succeeded' ? 'text-emerald-300 bg-emerald-500/10' : status === 'failed' ? 'text-red-300 bg-red-500/10' : active({ status }) ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400 bg-edge/50'
}
function executor(job: HostJobSummary, zh: boolean) {
  if (job.agentId?.startsWith('browser-')) return zh ? '浏览器计算' : 'Browser compute'
  if (job.compute) return zh ? '云端计算' : 'Cloud compute'
  return zh ? '后端计算' : 'Backend compute'
}

export function nativeModuleWorkspacePath(moduleId: unknown, inlineInput?: unknown): string | null {
  if (typeof moduleId !== 'string') return null
  if (moduleId.startsWith('sw-comsol-')) return 'comsol'
  if (moduleId.startsWith('sw-ansys-')) return 'ansys'
  if (ABAQUS_NATIVE_CASES.some(example => example.module === moduleId)) return 'abaqus'
  const dymolaMatch = inlineInput && typeof inlineInput === 'object' && DYMOLA_NATIVE_CASES.some(example => example.module === moduleId && matchesNativeSoftwareOperation(example, inlineInput))
  if (dymolaMatch) return 'dymola'
  const starCcmMatch = inlineInput && typeof inlineInput === 'object' && STAR_CCM_NATIVE_CASES.some(example => example.module === moduleId && matchesNativeSoftwareOperation(example, inlineInput))
  if (starCcmMatch) return 'star-ccm'
  const cstMatch = inlineInput && typeof inlineInput === 'object' && CST_NATIVE_CASES.some(example => example.module === moduleId && matchesNativeSoftwareOperation(example, inlineInput))
  if (cstMatch) return 'cst'
  if (inlineInput && typeof inlineInput === 'object' && !Array.isArray(inlineInput)) {
    const input = inlineInput as Record<string, unknown>
    const exactCase = OPTICSTUDIO_NATIVE_CASES.some(example =>
      example.module === moduleId && matchesNativeSoftwareOperation(example, input),
    )
    if (exactCase && (moduleId.startsWith('sw-optics-') || isNativeAlgorithmInput(input))) return 'opticstudio'
  }
  return null
}

/** One task center for every solver. Details use the saved run, never demo resubmission. */
export function BatchJobs() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const [params, setParams] = useSearchParams(), selectedId = params.get('job')
  const [jobs, setJobs] = useState<HostJobSummary[]>([]), [detail, setDetail] = useState<HostJobDetail | null>(null)
  const [error, setError] = useState<string | null>(null), [detailError, setDetailError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false), [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0), [cancelling, setCancelling] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const [showInputs, setShowInputs] = useState(false)
  useEffect(() => { heading.current?.focus() }, [selectedId])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true); setError(null); setDetailError(null)
    const refresh = async () => {
      const [list, selected] = await Promise.allSettled([
        fetchHostJobs(undefined, controller.signal),
        selectedId ? fetchHostJob(selectedId, undefined, null, controller.signal) : Promise.resolve(null),
      ])
      if (controller.signal.aborted) return
      const denied = list.status === 'rejected' && isHostAuthError(list.reason)
      setAuthRequired(denied)
      if (list.status === 'fulfilled') { setJobs(list.value); setError(null) }
      else { if (denied) setJobs([]); setError(denied ? null : (zh ? '任务列表更新失败，请重试。' : 'Could not update jobs. Please retry.')) }
      if (selected.status === 'fulfilled' && !denied) { setDetail(selected.value); setDetailError(null) }
      else {
        setDetail(null)
        setDetailError(denied ? null : (zh ? '无法打开此任务。它可能不存在，或当前账号没有访问权限。' : 'This job is unavailable or your account does not have access.'))
      }
      setLoading(false)
      if (!denied && (list.status === 'fulfilled' && list.value.some(pending) || selected.status === 'fulfilled' && selected.value && pending(selected.value))) {
        timer = setTimeout(() => void refresh(), 4000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [selectedId, revision, zh])

  const job = detail?.id === selectedId ? detail : null
  const moduleId = job?.kind === 'waveworld-module' ? job.spec.parameters.module : job?.kind === 'lbm-d3q19' ? 'windtunnel' : null
  const inlineInput = job?.spec.model?.inline
  const module = ALL_LEAVES.find(leaf => leaf.path === moduleId)
  const modulePath = nativeModuleWorkspacePath(moduleId, inlineInput) ?? module?.path
  const cancel = async () => {
    if (!job || cancelling) return
    setCancelling(true); setDetailError(null)
    try { await cancelHostJob(job.id); setRevision(value => value + 1) }
    catch { setDetailError(zh ? '取消请求未确认，请重试。任务状态将在刷新后显示。' : 'Cancellation was not confirmed. Retry or refresh the job status.') }
    finally { setCancelling(false) }
  }
  const status = (value: string) => statuses[value]?.[zh ? 0 : 1] ?? value
  return <div className="space-y-5" data-sim-stage="batch-jobs">
    <PageHeader title="计算任务" titleEn="Compute jobs" subtitle="查看计算进度、结果和使用的参数。" subtitleEn="Review progress, saved results, and the inputs used for each run." icon="📋" showMethods={false} />
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Link to="/" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200">{zh ? '选择仿真' : 'Choose a simulation'}</Link>
      <Link to="/my-projects" className="btn border border-edge">{zh ? '我的项目' : 'My projects'}</Link>
      <button type="button" className="btn ml-auto border border-edge disabled:opacity-50" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? (zh ? '更新中…' : 'Updating…') : (zh ? '刷新' : 'Refresh')}</button>
    </div>
    {authRequired ? <div className="rounded-xl border border-edge p-6 text-sm text-slate-300">
      <p>{zh ? '登录后查看已发布的任务。本机仿真无需登录。' : 'Sign in to view published jobs. Local simulations need no login.'}</p>
      <a className="btn mt-4 inline-flex bg-cyan-700 text-white" href={oidcStartHref('/batch-jobs' + (selectedId ? `?job=${encodeURIComponent(selectedId)}` : ''))}>{zh ? '使用 W-ID 登录' : 'Sign in with W-ID'}</a>
    </div> : <>
      {error && <p role="alert" className="rounded-lg border border-red-400/30 p-3 text-sm text-red-300">{error}</p>}
      <div className={`grid min-w-0 gap-5 ${selectedId ? 'xl:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]' : ''}`}>
        <section aria-label={zh ? '任务列表' : 'Jobs'} className="min-w-0 space-y-2">
          <p className="text-xs text-slate-500">{zh ? '最近 50 个任务 · 进行中的任务自动更新' : 'Latest 50 jobs · Active jobs update automatically'}</p>
          {!loading && jobs.length === 0 && !error && <div className="rounded-xl border border-dashed border-edge p-8 text-sm text-slate-400">{zh ? '还没有发布任务。选择仿真、设置参数后，点击「发布计算任务」。' : 'No published jobs yet. Choose a simulation, set its inputs, then publish a compute task.'}</div>}
          {jobs.map(item => <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => setParams({ job: item.id })} className="w-full rounded-xl border border-edge p-4 text-left hover:bg-edge/30 aria-pressed:border-cyan-400/60 aria-pressed:bg-cyan-500/5">
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="break-words font-medium text-slate-200">{item.name || item.id.slice(0, 8)}</span><span className={`rounded-full px-2 py-1 text-xs ${statusClass(item.status)}`}>{status(item.status)}</span></div>
            <p className="mt-2 text-xs text-slate-400">{executor(item, zh)} · {new Date(item.updatedAt).toLocaleString(locale)}</p>
            <p className="mt-2 text-sm text-slate-400">{zh ? '完成步数' : 'Completed steps'}: {item.result?.summary?.steps ?? item.progress?.step ?? '—'}{active(item) && item.progress?.total ? ` / ${item.progress.total}` : ''}</p>
            {item.compute?.phase === 'stopping' && <p className="mt-2 text-xs text-amber-300">{zh ? '正在确认实例停止…' : 'Confirming instance shutdown…'}</p>}
          </button>)}
        </section>
        {selectedId && <section className="order-first min-w-0 rounded-xl border border-edge p-4 sm:p-6 xl:order-none" aria-label={zh ? '任务详情' : 'Job details'}>
          <div className="mb-4 flex items-center justify-between gap-3"><h2 ref={heading} tabIndex={-1} className="font-semibold text-slate-200 outline-none">{zh ? '任务详情' : 'Job details'}</h2><button className="btn text-slate-400" onClick={() => setParams({})}>{zh ? '收起' : 'Close'}</button></div>
          {detailError && <p role="alert" className="mb-4 text-sm text-red-300">{detailError}</p>}
          {loading && !job && <p role="status" className="text-sm text-slate-400">{zh ? '正在读取任务…' : 'Loading job…'}</p>}
          {job && <div className="space-y-5">
            <div><h3 className="break-words text-lg text-slate-100">{job.name || job.id}</h3><p className="mt-2 text-sm text-slate-400">{status(job.status)} · {executor(job, zh)}{module && ` · ${zh ? module.label : module.labelEn}`}</p></div>
            {job.compute && <p className="rounded-lg bg-edge/40 p-3 text-sm text-slate-300" data-compute-phase={job.compute.phase}>
              {job.compute.phase === 'stopped'
                ? job.compute.instanceId ? (zh ? '实例已停止，工作盘保留；存储费用独立计算。' : 'Instance stopped and workspace retained; storage is billed separately.') : (zh ? '任务已结束，没有创建计算实例。' : 'The job ended without creating an instance.')
                : job.compute.phase === 'stopping' ? (zh ? '计算已结束，正在确认实例停止。' : 'Computation ended. Confirming instance shutdown.') : (zh ? '任务由云端实例执行。' : 'This task runs on a cloud instance.')}
              {job.compute.error && <span className="mt-2 block text-amber-300">{job.compute.error}</span>}
            </p>}
            {job.error && <p role="alert" className="break-words text-sm text-red-300">{job.error}</p>}
            {active(job) && <div className="space-y-3">
              {job.progress && <p role="status" className="text-sm text-slate-300">{zh ? '计算进度' : 'Progress'}: {job.progress.step ?? 0} / {job.progress.total ?? job.spec.run.maxSteps as number}{job.progress.message && ` · ${job.progress.message}`}</p>}
              <button type="button" className="btn border border-red-400/40 text-red-300 disabled:opacity-50" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? (zh ? '正在取消…' : 'Cancelling…') : (zh ? '取消任务' : 'Cancel job')}</button>
            </div>}
            {job.status === 'succeeded' && job.result && <JobResultView key={job.id} job={job} />}
            {modulePath && <Link className="inline-flex min-h-11 items-center text-sm text-cyan-300 underline" to={`/${modulePath}`}>{modulePath === 'opticstudio' ? (zh ? '打开 OpticStudio 光学案例目录' : 'Open OpticStudio optics cases') : modulePath === 'cst' ? (zh ? '打开 CST Studio Suite 案例目录' : 'Open CST Studio Suite cases') : module ? (zh ? `打开${module.label}，配置新的计算` : `Open ${module.labelEn} to configure another run`) : modulePath === 'ansys' ? (zh ? '打开 Ansys 案例目录' : 'Open Ansys case workspace') : (zh ? '打开 COMSOL 案例目录' : 'Open COMSOL case workspace')}</Link>}
            {job.kind === 'path-experiment' && <Link className="text-sm text-cyan-300 underline" to={`/path-experiments?jobs=${encodeURIComponent(job.id)}`}>{zh ? '查看路径实验与证据' : 'View experiment and evidence'}</Link>}
            <details className="text-sm text-slate-400" onToggle={event => setShowInputs(event.currentTarget.open)}><summary className="cursor-pointer py-2">{zh ? '本次输入参数' : 'Inputs used for this run'}</summary>{showInputs && <pre className="max-h-80 overflow-auto rounded bg-edge/30 p-3 text-xs">{JSON.stringify(job.spec, null, 2)}</pre>}</details>
            <details className="text-sm text-slate-500"><summary className="cursor-pointer py-2">{zh ? '执行记录' : 'Execution record'}</summary><dl className="mt-2 space-y-2 break-all"><div><dt>{zh ? '任务编号' : 'Job ID'}</dt><dd>{job.id}</dd></div><div><dt>{zh ? '提交时间' : 'Submitted'}</dt><dd>{new Date(job.createdAt).toLocaleString(locale)}</dd></div>{job.result?.derived && <div><dt>{zh ? '执行引擎' : 'Engine'}</dt><dd>{String(job.result.derived.engine ?? '—')}</dd></div>}</dl></details>
          </div>}
        </section>}
      </div>
    </>}
  </div>
}
