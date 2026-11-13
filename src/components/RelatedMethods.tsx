import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { methodsForSimPath, methodById } from '../data/methods/methods'
import {
  controlHintsForSim,
  familyMethods,
  sortMethodsForSim,
  stepMethods,
  toNarrativeCard,
} from '../lib/simMethodNarrative'
import { localizedName, pickLocaleString, useLocale } from '../lib/i18n'
import { TermChip } from './TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'

/**
 * 仿真页方法叙事（KUX 靶 F/D）— 视觉层级：次要语境（L4），默认折叠。
 * 经 PageHeader 自动挂到各页；不与主画布抢戏。
 */
export function RelatedMethods() {
  const { locale } = useLocale()
  const { pathname } = useLocation()
  const path = pathname.replace(/^\//, '').split('/')[0] ?? ''
  const methods = useMemo(() => sortMethodsForSim(methodsForSimPath(path)), [path])
  const hints = useMemo(() => controlHintsForSim(path), [path])
  const pageTerms = useMemo(() => termIdsForSimPath(path), [path])
  const [open, setOpen] = useState(false)
  const zh = locale === 'zh'

  if (methods.length === 0) {
    if (pageTerms.length === 0) return null
    return (
      <div className="page-context mx-auto mb-4 max-w-3xl" data-layer="secondary">
        <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-slate-400">
          <span className="text-slate-400">{zh ? '本页术语' : 'Page terms'}</span>
          {pageTerms.map((id) => (
            <TermChip key={id} id={id} mode="compact" />
          ))}
        </p>
      </div>
    )
  }

  const families = familyMethods(methods)
  const steps = stepMethods(methods)
  const primary = families[0] ?? methods[0]
  const primaryCard = toNarrativeCard(primary, locale)

  return (
    <div className="page-context mb-3" data-layer="secondary">
      <div className="rounded-lg border border-edge bg-panel/25 px-3">
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-slate-300 hover:text-white"
          onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span>{zh ? '原理与计算方法' : 'Principles and calculation methods'}</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
        {open && (
          <div className="space-y-3 border-t border-edge pb-3 pt-3">
            <Link to={`/world?m=${encodeURIComponent(primary.id)}`} className="text-sm font-medium text-cyan-300 hover:underline">{primaryCard.title}</Link>
            <p className="text-sm leading-relaxed text-slate-300">{primaryCard.summary}</p>
            <div className="grid gap-1.5 text-sm text-slate-400 sm:grid-cols-2">
              <div>
                <span className="text-slate-400">
                  {zh ? '基础 / 典型式 · ' : 'Foundations · '}
                </span>
                {primaryCard.foundations.join(' · ') || '—'}
              </div>
              <div>
                <span className="text-slate-400">
                  {zh ? '关联能量 · ' : 'Related energy · '}
                </span>
                {primaryCard.related.length > 0
                  ? primaryCard.related.join(zh ? '、' : ', ')
                  : '—'}
                {primaryCard.parentName ? (
                  <span className="text-slate-400">
                    {' '}
                    · {zh ? '父级' : 'parent'} {primaryCard.parentName}
                  </span>
                ) : null}
              </div>
            </div>

            {pageTerms.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                <span className="text-slate-400">{zh ? '本页术语' : 'Page terms'}</span>
                {pageTerms.map((id) => (
                  <TermChip key={id} id={id} mode="compact" />
                ))}
              </div>
            )}

            {hints.length > 0 && (
              <div className="rounded-lg border border-wave/20 bg-wave/5 px-2.5 py-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-wave/80">
                  {zh ? '你在调的是哪一步' : 'Which step you are tuning'}
                </div>
                <ul className="space-y-1">
                  {hints.map((h) => {
                    const m = methodById(h.methodId)
                    return (
                      <li
                        key={`${h.control}-${h.methodId}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-sm"
                      >
                        <span className="font-medium text-slate-300">
                          {pickLocaleString(h.control, h.controlEn, locale)}
                        </span>
                        <span className="text-slate-400">→</span>
                        {m ? (
                          <Link
                            to={`/world?m=${encodeURIComponent(m.id)}`}
                            className="text-wave/90 hover:underline"
                          >
                            {localizedName(m, locale)}
                          </Link>
                        ) : (
                          <span className="text-slate-400">{h.methodId}</span>
                        )}
                        <span className="text-slate-400">
                          {pickLocaleString(h.note, h.noteEn, locale)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {steps.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400">
                  {zh ? '可下钻步骤' : 'Drill-down steps'}
                </span>
                {steps.map((m) => {
                  const card = toNarrativeCard(m, locale)
                  return (
                    <Link
                      key={m.id}
                      to={`/world?m=${encodeURIComponent(m.id)}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-edge bg-canvas/50 px-2 py-0.5 text-sm text-slate-300 transition-colors hover:border-wave/50 hover:text-wave"
                      title={`${card.summary}${card.foundations.length ? ` · ${card.foundations.join(zh ? '；' : '; ')}` : ''}`}
                    >
                      <span aria-hidden>{m.icon}</span>
                      <span className="truncate">{localizedName(m, locale)}</span>
                      <span className="text-[9px] text-slate-400">{card.role}</span>
                    </Link>
                  )
                })}
              </div>
            )}

            {families.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-t border-edge/50 pt-2">
                {families.slice(1).map((m) => {
                  const card = toNarrativeCard(m, locale)
                  return (
                    <Link
                      key={m.id}
                      to={`/world?m=${encodeURIComponent(m.id)}`}
                      className="text-sm text-slate-400 hover:text-wave"
                      title={card.summary}
                    >
                      {m.icon} {localizedName(m, locale)}
                    </Link>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              <Link to="/taxonomy" className="hover:text-wave">
                {zh ? '分类图谱 →' : 'Taxonomy →'}
              </Link>
              <Link to="/methods" className="hover:text-wave">
                {zh ? '全部方法 →' : 'All methods →'}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
