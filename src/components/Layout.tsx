import { Link, Outlet, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { SimulationModule } from './SimulationModule'
import { useLocale } from '../lib/i18n'
import { resolvePageSurface } from '../lib/uiPageLayer'

const CommandPalette = lazy(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
)

export function Layout() {
  const { locale, setLocale, t } = useLocale()
  const zh = locale === 'zh'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteMounted, setPaletteMounted] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const { pathname, search } = useLocation()
  const surface = resolvePageSurface(pathname)
  const workspace = pathname === '/windtunnel'
  const links = [
    { to: '/d/sim', label: zh ? '仿真与计算' : 'Simulations', active: surface === 'simulation' },
    { to: '/my-projects', label: zh ? '我的项目' : 'My projects', active: pathname === '/my-projects' },
    { to: '/batch-jobs', label: zh ? '计算任务' : 'Compute jobs', active: pathname === '/batch-jobs' },
    { to: '/d/atlas', label: zh ? '资料库' : 'Library', active: surface === 'knowledge' || surface === 'apps' },
  ]

  const openPalette = () => {
    setMobileOpen(false)
    if (!paletteMounted) setPaletteMounted(true)
    else window.dispatchEvent(new Event('open-palette'))
  }

  useEffect(() => { setMobileOpen(false) }, [pathname, search])
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMobileOpen(false); menuRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])
  useEffect(() => {
    if (paletteMounted) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setMobileOpen(false)
        setPaletteMounted(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteMounted])

  return (
    <div className={workspace ? 'flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden' : 'mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-6'}>
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-cyan-300 p-3 text-slate-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        {zh ? '跳到主要内容' : 'Skip to content'}
      </a>
      <header className={`site-header shrink-0 ${workspace ? '' : '-mx-4 sm:-mx-6'}`} data-site-header>
        <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label={zh ? 'WaveWorld 首页' : 'WaveWorld home'} className="flex min-h-11 shrink-0 items-center gap-2 font-semibold text-white">
            <span className="text-2xl" aria-hidden="true">🌊</span>
            <span>WaveWorld</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label={zh ? '主导航' : 'Main navigation'}>
            {links.map((link) => <Link key={link.to} to={link.to} aria-current={link.active ? 'page' : undefined}
              className={`btn inline-flex items-center ${link.active ? 'bg-wave/20 text-white' : 'text-slate-300 hover:bg-panel hover:text-white'}`}>
              {link.label}
            </Link>)}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <button type="button" className="btn flex items-center gap-2 border border-edge text-slate-300 hover:bg-panel" onClick={openPalette} aria-label={zh ? '搜索仿真、应用与资料' : 'Search simulations, applications and references'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
              <span className="hidden sm:inline">{zh ? '搜索' : 'Search'}</span>
            </button>
            <button type="button" className="btn text-slate-300 hover:bg-panel" onClick={() => setLocale(zh ? 'en' : 'zh')}
              aria-label={zh ? 'Switch to English' : '切换到中文'}>{zh ? 'EN' : '中文'}</button>
            <button ref={menuRef} type="button" className="btn border border-edge text-slate-200 lg:hidden" onClick={() => setMobileOpen((o) => !o)}
              aria-label={zh ? '导航菜单' : 'Navigation menu'} aria-expanded={mobileOpen} aria-controls="mobile-navigation">
              <span aria-hidden="true">{mobileOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>
        {mobileOpen && <nav id="mobile-navigation" className="grid max-h-[70dvh] gap-1 overflow-y-auto border-t border-edge p-3 lg:hidden" aria-label={zh ? '主导航' : 'Main navigation'}>
          {links.map((link) => <Link key={link.to} to={link.to} aria-current={link.active ? 'page' : undefined}
            className={`btn flex items-center ${link.active ? 'bg-wave/20 text-white' : 'text-slate-300 hover:bg-panel'}`}>{link.label}</Link>)}
        </nav>}
      </header>
      <main id="main-content" tabIndex={-1} className={`min-w-0 flex-1 ${workspace ? 'min-h-0' : 'py-6 sm:py-8'}`} data-page-surface={surface}>
        <div className={workspace ? 'h-full w-full' : `mx-auto w-full ${pathname === '/matrix' ? 'max-w-7xl' : surface === 'knowledge' ? 'max-w-5xl' : 'max-w-6xl'}`}>
          <Suspense fallback={<div className="py-24 text-center text-sm text-slate-400">{t('loading')}</div>}>
            <SimulationModule path={pathname}><Outlet /></SimulationModule>
          </Suspense>
        </div>
      </main>
      {!workspace && <footer className="border-t border-edge py-6 text-center text-sm text-slate-400">
        WaveWorld · {zh ? '交互仿真与科学探索' : 'Interactive simulation and scientific exploration'}
      </footer>}
      {paletteMounted && <Suspense fallback={null}><CommandPalette /></Suspense>}
    </div>
  )
}
