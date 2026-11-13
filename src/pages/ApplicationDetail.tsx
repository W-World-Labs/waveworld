import { Link, useParams, Navigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { applicationById, flattenLevels, levelAtPath, familyVariants } from '../data/applications/applications'
import { methodById } from '../data/methods/methods'
import { EDGES } from '../data/ontology/edges'
import { formName } from '../lib/applications'
import { edgeDisplayName, edgePrinciple, localizedName, pickLocaleString, useLocale } from '../lib/i18n'
import { simCapabilityByPath } from '../lib/sim/simCapabilityCatalog'
import { ALL_LEAVES } from '../nav'

export function ApplicationDetail() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const { id } = useParams<{ id: string }>()
  const app = id ? applicationById(id) : undefined
  const [part, setPart] = useState(0)
  const [experiment, setExperiment] = useState('')
  const [showReference, setShowReference] = useState(false)
  const levels = useMemo(() => app ? flattenLevels(app) : [], [app])
  const experiments = useMemo(() => {
    const paths = new Set(levels.flatMap(({ level }) => level.simPaths ?? []))
    return ALL_LEAVES.filter((leaf) => {
      if (!paths.has(leaf.path)) return false
      const capability = simCapabilityByPath(leaf.path)
      return capability && capability.backend !== 'none' && capability.mode !== 'catalog' && capability.mode !== 'gateway'
    })
  }, [levels])

  useEffect(() => {
    setPart(0)
    setExperiment('')
    setShowReference(false)
  }, [id])

  if (!app) return <Navigate to="/apps" replace />
  const selected = experiments.find((item) => item.path === experiment)
  const level = levelAtPath(app, levels[part]?.path ?? []) ?? app.levels[0]
  const variants = familyVariants(app)
  const label = (item: { label: string; labelEn: string }) => pickLocaleString(item.label, item.labelEn, locale)

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/apps" className="mb-4 inline-flex min-h-11 items-center text-sm text-slate-400 hover:text-wave">
        ← {zh ? '应用案例' : 'Applications'}
      </Link>
      <PageHeader
        icon={app.icon}
        title={localizedName(app, locale)}
        titleEn={app.nameEn}
        subtitle={`${formName(app.goal.from, locale)} → ${formName(app.goal.to, locale)}`}
        subtitleEn={`${formName(app.goal.from, locale)} → ${formName(app.goal.to, locale)}`}
        showMethods={false} showBreadcrumb={false}
      />

      <section className="rounded-2xl border border-edge bg-panel/50 p-5 sm:p-6" aria-labelledby="application-experiment-title">
        <h2 id="application-experiment-title" className="text-lg font-semibold text-white">
          {zh ? '从一个具体问题开始' : 'Start with one concrete question'}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
          {zh
            ? '选择一个基础实验，进入后设置参数，再查看计算结果。'
            : 'Choose a basic experiment, set its inputs, then inspect the calculated result.'}
        </p>
        {experiments.length > 0 ? (
          <div className="mt-5">
            <label htmlFor="application-experiment" className="mb-2 block text-sm text-slate-200">
              {zh ? '可打开的基础实验' : 'Available basic experiments'}
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <select id="application-experiment" value={experiment} onChange={(event) => setExperiment(event.target.value)}
                className="min-h-12 min-w-0 flex-1 rounded-lg border border-edge bg-canvas px-3 text-base text-slate-200">
                <option value="">{zh ? '选择实验…' : 'Choose an experiment…'}</option>
                {experiments.map((item) => <option key={item.path} value={item.path}>{label(item)}</option>)}
              </select>
              {selected ? (
                <Link to={`/${selected.path}`} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-cyan-300 px-5 font-medium text-slate-950 hover:bg-cyan-200">
                  {zh ? '打开实验' : 'Open experiment'} →
                </Link>
              ) : (
                <button type="button" disabled className="min-h-12 shrink-0 rounded-lg bg-slate-700 px-5 font-medium text-slate-400 disabled:cursor-not-allowed">
                  {zh ? '打开实验' : 'Open experiment'} →
                </button>
              )}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              {zh
                ? '这些工具分别研究局部物理过程；尚未组成此应用的完整仿真，不能据此给出整机性能。'
                : 'These tools study individual physical processes. They are not an integrated simulation of this application and do not predict whole-system performance.'}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            {zh ? '此应用尚未接入可直接打开的仿真实验。可以先查看下方原理资料。' : 'No directly accessible experiment is linked to this application yet. Its reference material is available below.'}
          </p>
        )}
      </section>

      <details className="mt-5 rounded-xl border border-edge" open={showReference} onToggle={(event) => setShowReference(event.currentTarget.open)}>
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-200">
          {zh ? '查看原理与参考资料' : 'Principles and reference material'}
        </summary>
        {showReference && <div className="space-y-5 border-t border-edge p-5 sm:p-6">
          <div>
            <label htmlFor="application-part" className="mb-2 block text-sm text-slate-300">
              {zh ? '查看哪个部分' : 'Part to explore'}
            </label>
            <select id="application-part" value={part} onChange={(event) => setPart(Number(event.target.value))}
              className="min-h-11 w-full rounded-lg border border-edge bg-canvas px-3 text-sm text-slate-200">
              {levels.map(({ level: item }, index) => <option key={item.id} value={index}>{localizedName(item, locale)}</option>)}
            </select>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{pickLocaleString(level.summary, level.summaryEn, locale)}</p>
          </div>
          {!!level.edgeIds?.length && <section>
            <h3 className="mb-2 text-sm font-medium text-slate-200">{zh ? '工作原理' : 'How it works'}</h3>
            <ul className="space-y-3 text-sm text-slate-400">
              {level.edgeIds.map((edgeId) => {
                const edge = EDGES.find((item) => item.id === edgeId)
                return edge ? <li key={edgeId}><span className="text-slate-300">{edgeDisplayName(edge, locale)}</span><p className="mt-1 leading-relaxed">{edgePrinciple(edge, locale)}</p></li> : null
              })}
            </ul>
          </section>}
          {!!level.methodIds?.length && <section>
            <h3 className="mb-2 text-sm font-medium text-slate-200">{zh ? '相关方法资料' : 'Related methods'}</h3>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {level.methodIds.map((methodId) => {
                const method = methodById(methodId)
                return method ? <li key={methodId}><Link to={`/world?m=${encodeURIComponent(methodId)}`} className="inline-flex min-h-11 items-center text-wave hover:underline">{localizedName(method, locale)}</Link></li> : null
              })}
            </ul>
          </section>}
          {!!variants.length && <section className="border-t border-edge pt-4">
            <h3 className="mb-2 text-sm font-medium text-slate-200">{zh ? '相关应用' : 'Related applications'}</h3>
            <div className="flex flex-wrap gap-3">{variants.map((item) => <Link key={item.id} to={`/apps/${item.id}`} className="inline-flex min-h-11 items-center text-sm text-wave hover:underline">{localizedName(item, locale)} →</Link>)}</div>
          </section>}
        </div>}
      </details>
    </div>
  )
}
