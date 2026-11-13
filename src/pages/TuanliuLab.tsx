import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale } from '../lib/i18n'
import { fullLabPageUrl } from '../lib/hostApi'
import { Link } from 'react-router-dom'

/** Wind tunnel is a peer simulation module; the separate renderer stays internal. */
export function TuanliuLab() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const labUrl = fullLabPageUrl()
  const frame = useRef<HTMLIFrameElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [height, setHeight] = useState(760)
  const embeddedUrl = useMemo(() => {
    if (!labUrl) return null
    const url = new URL(labUrl, window.location.origin)
    url.searchParams.set('embedded', '1')
    return url
  }, [labUrl])

  useEffect(() => {
    if (!embeddedUrl) return
    setStatus('loading')
    const timeout = window.setTimeout(() => setStatus('failed'), 15_000)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== embeddedUrl.origin || event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (data?.type !== 'waveworld:workspace-ready' || !Number.isFinite(data.height)) return
      window.clearTimeout(timeout)
      setHeight(Math.max(200, Math.min(6000, Math.ceil(data.height))) + 2)
      setStatus('ready')
    }
    window.addEventListener('message', onMessage)
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', onMessage) }
  }, [embeddedUrl, attempt])

  return (
    <div className="flex h-full min-h-0 flex-col" data-sim-stage="wind-tunnel" data-hq-module="tuanliu">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 border-b border-edge px-4 text-sm">
        <Link to="/d/sim" className="inline-flex min-h-11 items-center text-slate-400 hover:text-cyan-300">{zh ? '← 仿真目录' : '← Simulations'}</Link>
        <h1 className="font-semibold text-white">{zh ? '三维风洞工作台' : '3D wind tunnel workspace'}</h1>
        <Link to="/method-depth?m=method-lattice-boltzmann" className="ml-auto inline-flex min-h-11 items-center text-slate-400 hover:text-cyan-300">{zh ? '原理与方法' : 'Method reference'}</Link>
      </div>
      {embeddedUrl ? <>
        {status === 'loading' && <p role="status" className="px-4 py-2 text-sm text-slate-400">{zh ? '正在加载模型与计算控件…' : 'Loading model and compute controls…'}</p>}
        {status === 'failed' && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200">
          <span>{zh ? '风洞模块暂时无法加载。' : 'The wind tunnel module could not load.'}</span>
          <button type="button" className="btn border border-edge" onClick={() => setAttempt(n => n + 1)}>{zh ? '重新加载' : 'Reload'}</button>
        </div>}
        <iframe ref={frame} key={attempt} title={zh ? '风洞模型、计算与结果' : 'Wind tunnel model, computation and results'}
          src={embeddedUrl.href} className="block w-full shrink-0 border-0 bg-canvas lg:min-h-0 lg:flex-1 lg:!h-full" style={{ height }} />
      </> : <div className="rounded-xl border border-amber-500/25 p-3">
        <p role="status" className="mb-3 text-sm text-amber-200">{zh ? '三维风洞尚未连接。也可以打开二维流体模块，编辑绕流示例。' : '3D wind tunnel is not connected. You can open the 2D fluid module and edit a flow example.'}</p>
        <Link to="/fluid?preset=cylinder" className="btn border border-edge">{zh ? '打开二维流体示例' : 'Open 2D fluid example'}</Link>
      </div>}
    </div>
  )
}
