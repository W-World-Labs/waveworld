import { useContext, type ReactNode } from 'react'
import { SimulationModuleContext } from '../lib/hooks/useRunning'
import { Link, useLocation } from 'react-router-dom'
import { pickLocaleString, useLocale } from '../lib/i18n'
import { pageHeaderForRoute } from '../lib/i18n/pageHeaders'
import { ALL_LEAVES } from '../nav'
import { RelatedMethods } from './RelatedMethods'
import { resolvePageSurface, SURFACE_META } from '../lib/uiPageLayer'

/** Shared page identity; optional context is disclosed separately from the experiment. */
export function PageHeader({
  title,
  titleEn,
  subtitle,
  subtitleEn,
  icon,
  kicker,
  showMethods = true,
  showBreadcrumb = true,
  preMethods,
}: {
  title: string
  /** Optional English title; falls back to route registry then nav leaf. */
  titleEn?: string
  subtitle?: string
  subtitleEn?: string
  icon?: string
  kicker?: string
  /** 默认 true：在页眉下展示关联基础方法芯片 */
  showMethods?: boolean
  showBreadcrumb?: boolean
  /** 插在标题与 RelatedMethods 之间（如访问路径地图） */
  preMethods?: ReactNode
}) {
  const { locale } = useLocale()
  const module = useContext(SimulationModuleContext)
  const { pathname } = useLocation()
  const route = pathname.replace(/^\//, '')
  const surface = resolvePageSurface(pathname)
  const surfaceMeta = SURFACE_META[surface]
  // Exact match first; nested routes (e.g. /phenomena/sdt) fall back to longest prefix leaf path
  const leaf =
    ALL_LEAVES.find((l) => l.path === route) ??
    ALL_LEAVES.filter((l) => route === l.path || route.startsWith(l.path + '/')).sort(
      (a, b) => b.path.length - a.path.length,
    )[0]
  const accent = leaf?.accent ?? surfaceMeta.accent
  const reg = pageHeaderForRoute(route)

  const displayTitle = pickLocaleString(
    title,
    titleEn ?? reg?.titleEn ?? leaf?.labelEn,
    locale,
  )
  const displaySubtitle = (() => {
    const zh = subtitle ?? reg?.subtitle
    if (!zh) return undefined
    return pickLocaleString(zh, subtitleEn ?? reg?.subtitleEn, locale)
  })()

  return (
    <>
      <header className="page-header mb-4" data-page-surface={surface}>
        {leaf && showBreadcrumb && <nav className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-400" aria-label={locale === 'zh' ? '当前位置' : 'Breadcrumb'}>
          <Link to={leaf.domainKey === 'sim' ? '/d/sim' : '/d/atlas'} className="inline-flex min-h-9 items-center hover:text-cyan-300">← {leaf.domainKey === 'sim' ? (locale === 'zh' ? '仿真目录' : 'Simulation catalog') : (locale === 'zh' ? '资料库' : 'Library')}</Link>
        </nav>}
        <h1 className="flex items-center gap-3 text-2xl font-bold text-white sm:text-3xl">
          {icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${accent}1a` }} aria-hidden="true">{icon}</span>}
          <span>{displayTitle}</span>
        </h1>
        {displaySubtitle && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">{displaySubtitle}</p>}
        {kicker && !leaf && <p className="mt-2 text-sm text-slate-400">{kicker}</p>}
      </header>
      {module?.toolbar}
      {preMethods && <details className="page-secondary mb-3 rounded-lg border border-edge px-3">
        <summary className="min-h-11 cursor-pointer py-2.5 text-sm text-slate-300">{locale === 'zh' ? '相关实验与访问说明' : 'Related experiments and access information'}</summary>
        <div className="pb-3">{preMethods}</div>
      </details>}
      {showMethods && !module && <RelatedMethods />}
    </>
  )
}
