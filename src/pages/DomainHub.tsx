import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { DOMAIN_ALIASES, findDomain } from '../nav'
import { APPLICATIONS } from '../data/applications/applications'
import { pickLocaleString, useLocale } from '../lib/i18n'
import { pageHeaderForRoute } from '../lib/i18n/pageHeaders'

export function DomainHub() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const { key } = useParams<{ key: string }>()
  const [params, setParams] = useSearchParams()
  if (key && DOMAIN_ALIASES[key]) return <Navigate to={`/d/${DOMAIN_ALIASES[key]}`} replace />
  if (key === 'apps') return <Navigate to="/apps" replace />
  const d = key ? findDomain(key) : undefined
  if (!d) return <Navigate to="/" replace />

  const query = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const subjects = d.key === 'sim'
    ? d.facets.map((facet) => ({ ...facet, items: facet.items.filter((item) => !['batch-jobs', 'my-projects'].includes(item.path)) })).filter((facet) => facet.items.length)
    : [...d.facets, ...(findDomain('apps')?.facets ?? [])]
  const selected = subjects.some((_, i) => String(i) === category) ? category : ''
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const facets = subjects.map((facet, index) => ({ ...facet, index, items: [...facet.items, ...(d.key === 'atlas' && words.length && index === subjects.length - 1
    ? APPLICATIONS.map((app) => ({ path: `apps/${app.id}`, label: app.name, labelEn: app.nameEn ?? app.name, icon: app.icon, description: app.blurb, descriptionEn: app.blurbEn })) : [])].filter((item) => {
    const copy = pageHeaderForRoute(item.path)
    const text = [item.label, item.labelEn, item.path, item.description ?? copy?.subtitle, item.descriptionEn ?? copy?.subtitleEn].join(' ').toLocaleLowerCase()
    return (selected === '' || selected === String(index)) && words.every((word) => text.includes(word))
  }) })).filter((facet) => facet.items.length)
  const count = facets.reduce((sum, facet) => sum + facet.items.length, 0)
  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-bold text-white">{d.key === 'sim' ? (zh ? '仿真与计算' : 'Simulations') : (zh ? '资料库' : 'Library')}</h1>
        <p className="mt-3 text-base text-slate-300">{d.key === 'sim'
          ? zh ? '选择一个实验开始。可以按名称搜索，也可以按领域浏览。' : 'Choose an experiment. Search by name or browse by subject.'
          : d.key === 'atlas'
            ? zh ? '查找应用案例、物理原理和计算方法。' : 'Find applications, physical principles and numerical methods.'
            : zh ? '了解科学原理如何用于传感器、电子设备和能源系统。' : 'Discover how science is used in sensors, electronic devices, and energy systems.'}</p>
      </header>
      <div className="space-y-4 rounded-xl border border-edge bg-panel/60 p-4">
        <label className="block" htmlFor="catalog-search">
          <span className="mb-2 block text-sm font-medium text-slate-200">{zh ? '搜索名称或关键词' : 'Search names or keywords'}</span>
          <input id="catalog-search" type="search" value={query} onChange={(event) => update('q', event.target.value)}
            placeholder={d.key === 'sim' ? zh ? '例如：风洞、光学、心电、FDTD' : 'Try wind tunnel, optics, ECG, FDTD' : zh ? '输入你想了解的内容' : 'What would you like to explore?'}
            className="min-h-11 w-full rounded-lg border border-slate-600 bg-canvas px-3 text-base text-white placeholder:text-slate-400" />
        </label>
        {subjects.length > 1 && <div role="group" aria-label={zh ? '按领域筛选' : 'Filter by subject'} className="hidden flex-wrap gap-2 sm:flex">
          <button type="button" aria-pressed={selected === ''} onClick={() => update('category', '')} className="btn border border-edge text-slate-300 aria-pressed:border-cyan-300/60 aria-pressed:bg-cyan-300/10 aria-pressed:text-cyan-200">{zh ? '全部' : 'All'}</button>
          {subjects.map((facet, i) => <button key={facet.label} type="button" aria-pressed={selected === String(i)} onClick={() => update('category', String(i))}
            className="btn border border-edge text-slate-300 aria-pressed:border-cyan-300/60 aria-pressed:bg-cyan-300/10 aria-pressed:text-cyan-200">{pickLocaleString(facet.label, facet.labelEn, locale)}</button>)}
        </div>}
        {subjects.length > 1 && <label className="flex items-center gap-3 text-sm text-slate-300 sm:hidden" htmlFor="catalog-subject">
          {zh ? '领域' : 'Subject'}
          <select id="catalog-subject" value={selected} onChange={(event) => update('category', event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-canvas px-3 text-base text-slate-200">
            <option value="">{zh ? '全部领域' : 'All subjects'}</option>
            {subjects.map((facet, i) => <option key={facet.label} value={String(i)}>{pickLocaleString(facet.label, facet.labelEn, locale)}</option>)}
          </select>
        </label>}
      </div>
      <p className="text-sm text-slate-400" role="status">{zh ? `${count} 个${d.key === 'sim' ? '实验与工具' : '条目'}` : `${count} results`}</p>
      {count === 0 && <div className="rounded-xl border border-edge p-8 text-center"><h2 className="text-lg text-white">{zh ? '没有找到匹配的内容' : 'No matching entries'}</h2><p className="mt-2 text-slate-400">{zh ? '试试更短的关键词，或清除筛选查看全部内容。' : 'Try a shorter keyword, or clear the filters to see everything.'}</p><button type="button" className="btn mt-4 bg-cyan-300 text-slate-950" onClick={() => setParams({}, { replace: true })}>{zh ? '清除搜索和筛选' : 'Clear search and filters'}</button></div>}
      {facets.map((facet) => <section key={facet.label} id={`facet-${encodeURIComponent(facet.label)}`} className="scroll-mt-24">
        <h2 className="mb-4 text-lg font-semibold text-white">{pickLocaleString(facet.label, facet.labelEn, locale)} <span className="ml-2 text-sm font-normal text-slate-400">{facet.items.length}</span></h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facet.items.map((item) => {
            const copy = pageHeaderForRoute(item.path)
            const description = item.description ?? copy?.subtitle
            return <Link key={item.path} to={`/${item.path}`} className="group flex items-start gap-3 rounded-xl border border-edge bg-panel/60 p-4 transition-colors hover:border-cyan-300/50 hover:bg-panel">
              <span className="mt-0.5 text-2xl" aria-hidden="true">{item.icon}</span>
              <span className="min-w-0 flex-1"><span className="block text-base font-semibold leading-snug text-slate-100">{pickLocaleString(item.label, item.labelEn, locale)}</span>
                {description && <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400">{pickLocaleString(description, item.descriptionEn ?? copy?.subtitleEn, locale)}</span>}
              </span><span className="text-cyan-300" aria-hidden="true">→</span>
            </Link>
          })}
        </div>
      </section>)}
    </div>
  )
}
