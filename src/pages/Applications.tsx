import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { applicationsGroupedByFamily } from '../data/applications/applications'
import { formName } from '../lib/applications'
import { localizedName, pickLocaleString, useLocale } from '../lib/i18n'

export function Applications() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const groups = applicationsGroupedByFamily().map((group) => ({
    ...group,
    apps: group.apps.filter((app) => `${app.name} ${app.nameEn ?? ''} ${app.blurb} ${app.blurbEn ?? ''}`.toLocaleLowerCase().includes(needle)),
  })).filter((group) => group.apps.length > 0)

  return (
    <div>
      <PageHeader icon="🔧" title="应用案例" titleEn="Applications"
        subtitle="选择研究对象，查看相关基础实验与原理。" subtitleEn="Choose an application to find related basic experiments and principles." showMethods={false} showBreadcrumb={false} />
      <label htmlFor="application-search" className="mb-2 block text-sm text-slate-300">{zh ? '查找应用' : 'Find an application'}</label>
      <input id="application-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder={zh ? '例如：光伏、超声、传感器' : 'For example: solar, ultrasound, sensors'}
        className="mb-6 min-h-12 w-full rounded-lg border border-edge bg-panel px-4 text-base text-slate-200 sm:max-w-lg" />
      {groups.length === 0 && <p role="status" className="py-8 text-sm text-slate-400">{zh ? '没有找到匹配的应用，试试其他关键词。' : 'No matching applications. Try another keyword.'}</p>}
      <div className="space-y-8">
        {groups.map((group) => <section key={group.familyId ?? 'other'}>
          <h2 className="mb-3 text-sm font-medium text-slate-300">{pickLocaleString(group.label, group.labelEn, locale)}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.apps.map((app) => <Link key={app.id} to={`/apps/${app.id}`} className="group rounded-xl border border-edge bg-panel/40 p-5 hover:border-wave/50 hover:bg-panel/70">
              <h3 className="flex items-center gap-3 font-semibold text-white group-hover:text-wave"><span className="text-2xl" aria-hidden="true">{app.icon}</span>{localizedName(app, locale)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">{formName(app.goal.from, locale)} → {formName(app.goal.to, locale)}</p>
              <span className="mt-4 inline-flex min-h-8 items-center text-sm text-wave">{zh ? '查看实验与原理' : 'Explore experiments and principles'} →</span>
            </Link>)}
          </div>
        </section>)}
      </div>
    </div>
  )
}
