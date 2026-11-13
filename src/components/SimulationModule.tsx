import { Component, lazy, Suspense, useCallback, useState, type ReactNode } from 'react'
import { SimulationModuleContext, useLocalRunning } from '../lib/hooks/useRunning'
import { simCapabilityByPath, type SimCapability } from '../lib/sim/simCapabilityCatalog'
import { oidcStartHref } from '../lib/hostApi'
import { useLocale } from '../lib/i18n'
import { ModuleComputeContext, useModuleExecution } from '../lib/hooks/useModuleCompute'

const RelatedMethods = lazy(() => import('./RelatedMethods').then((m) => ({ default: m.RelatedMethods })))

class ModuleErrorBoundary extends Component<
  { children: ReactNode; fail: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.fail(error) }
  render() { return this.state.failed ? null : this.props.children }
}

/** All catalog routes share lifecycle; their parameters, physics and displays stay local. */
export function SimulationModule({ path, children }: { path: string; children: ReactNode }) {
  const capability = simCapabilityByPath(path.replace(/^\/+|\/+$/g, ''))
  return capability
    ? <ModuleSession key={path} capability={capability}>{children}</ModuleSession>
    : <>{children}</>
}

function ModuleSession({ capability, children }: { capability: SimCapability; children: ReactNode }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const controls = useLocalRunning()
  const execution = useModuleExecution()
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])
  const local = capability.backend !== 'host-api' && capability.backend !== 'none'
  const reset = async () => {
    if (!(await execution.stop())) return
    execution.clear()
    setError(null)
    controls.setRunning(true)
    setGeneration((n) => n + 1)
  }
  const toolbar = local ? (

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-panel/60 p-3 text-sm text-slate-300" aria-label={zh ? '仿真控制' : 'Simulation controls'}>
          <span className="hidden font-medium text-slate-200 sm:inline">{zh ? '计算位置' : 'Compute location'}</span>
          <div role="group" aria-label={zh ? '计算位置' : 'Compute location'} className="flex gap-1 rounded-lg border border-edge p-1">
            <button type="button" aria-pressed={execution.target === 'browser'} className="btn aria-pressed:bg-cyan-500/15 aria-pressed:text-cyan-300"
              onClick={() => void execution.setTarget('browser')}>{zh ? '本机计算' : 'Local compute'}</button>
            <button type="button" aria-pressed={execution.target === 'backend'} disabled={!execution.connected} className="btn disabled:opacity-50 aria-pressed:bg-cyan-500/15 aria-pressed:text-cyan-300"
              onClick={() => void execution.setTarget('backend')}>
              {execution.connected ? (zh ? '后端计算' : 'Backend compute') : (zh ? '后端计算 · 待接入' : 'Backend compute · pending')}
            </button>
          </div>
          {execution.target === 'browser' && !execution.busy && !execution.result && capability.supportsPause && !error && <button type="button" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={controls.toggle}>
            {capability.pauseTarget === 'playback'
              ? controls.running ? (zh ? '暂停播放' : 'Pause playback') : (zh ? '继续播放' : 'Resume playback')
              : controls.running ? (zh ? '暂停计算' : 'Pause computation') : (zh ? '继续计算' : 'Resume computation')}
          </button>}
          {(execution.target === 'backend' || execution.browserAgent) && !error && <>
            <button type="button" data-compute-action="run" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50" disabled={execution.busy || execution.cancelPending || !execution.connected} onClick={() => void execution.start()}>{execution.target === 'browser' ? (zh ? '开始计算' : 'Start computation') : (zh ? '发布计算任务' : 'Publish compute task')}</button>
            {execution.target === 'browser' && <button type="button" className="btn border border-edge disabled:opacity-50" disabled={execution.busy || execution.cancelPending || !execution.connected} onClick={() => void execution.start(true)}>{zh ? '发布计算任务' : 'Publish compute task'}</button>}
            {(execution.busy || execution.cancelPending) && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '停止任务' : 'Stop job'}</button>}
            <span role="status">{({ idle: zh ? '待计算' : 'Ready', submitting: zh ? '提交中' : 'Submitting', queued: zh ? '排队中' : 'Queued', running: zh ? '计算中' : 'Running', succeeded: zh ? '已完成' : 'Completed', cancelled: zh ? '已取消' : 'Cancelled', canceling: zh ? '正在停止' : 'Stopping', failed: zh ? '失败' : 'Failed' } as Record<string, string>)[execution.status] ?? execution.status}</span>
            {execution.jobId && <a href={`/batch-jobs?job=${encodeURIComponent(execution.jobId)}`} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{zh ? '查看任务与结果' : 'View job and results'}</a>}
            <details className="text-sm text-slate-400"><summary className="cursor-pointer py-2">{zh ? '计算说明' : 'Calculation details'}</summary><span>{execution.target === 'browser' ? (zh ? '本机计算免登录，参数和结果保留在此设备。发布任务需登录；计算期间请保持页面打开。' : 'Local computation needs no login and keeps inputs and results on this device. Publishing a task requires login; keep this page open while computing.') : (zh ? '登录后发布任务，由后端计算并保存结果' : 'Sign in to publish a task; the backend computes and saves the result')} · {execution.precision && (execution.precision === 'mixed' ? (zh ? 'FP32 数据 / FP64 数值运算' : 'FP32 data / FP64 arithmetic') : 'FP64')}</span></details>
          </>}
          {(capability.supportsReset || error) && <button type="button" className="btn ml-auto text-slate-400 hover:bg-edge hover:text-white" onClick={reset}>{zh ? '重置模块' : 'Reset module'}</button>}
        </div>
  ) : null
  return (
    <section className={capability.path === 'windtunnel' ? 'h-full' : undefined} data-simulation-module={capability.path} data-compute-backend={capability.backend} data-compute-target={execution.target}>
      {execution.error && <div role="alert" className="mb-3 rounded-lg border border-red-400/30 p-3 text-sm text-red-300">{execution.error}{execution.loginRequired && <a className="ml-3 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
      {error ? <>{toolbar}<div role="alert" className="rounded-lg border border-red-400/30 p-4 text-sm text-red-300">
        {zh ? '计算已停止：' : 'Computation stopped: '}{error}
        {!local && <button type="button" className="ml-3 underline" onClick={reset}>{zh ? '重新加载' : 'Reload'}</button>}
      </div></> : <SimulationModuleContext.Provider value={{ ...controls, fail, toolbar }} key={generation}>
        <ModuleComputeContext.Provider value={execution}>
          <ModuleErrorBoundary fail={fail}>{children}{local && <Suspense fallback={null}><RelatedMethods /></Suspense>}</ModuleErrorBoundary>
        </ModuleComputeContext.Provider>
      </SimulationModuleContext.Provider>}
    </section>
  )
}
