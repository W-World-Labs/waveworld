import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ALL_LEAVES, DOMAINS } from '../nav'
import { APPLICATIONS } from '../data/applications/applications'
import { PHENOMENA } from '../data/ontology/phenomena'
import { pickLocaleString, useLocale, type Locale } from '../lib/i18n'

/**
 * ⌘K / Ctrl-K 命令面板：对模型 / 域枢纽 / 现象 / 首页做模糊检索 + 完整键盘导航（↑↓/⏎/Esc）。
 * 正交直达通道，绕开三层漏斗。由 window 'open-palette' 事件或快捷键唤起（与顶栏按钮解耦）。
 */

type PaletteItem = {
  to: string
  label: string
  labelEn?: string
  icon: string
  accent: string
  domainLabel: string
  domainLabelEn?: string
  facetLabel: string
  facetLabelEn?: string
  tag: string
  tagEn?: string
  keywords?: string // extra searchable text (both languages)
}

function buildCatalog(): PaletteItem[] {
  const home: PaletteItem = {
    to: '/',
    label: '首页',
    labelEn: 'Home',
    icon: '🏠',
    accent: '#94a3b8',
    domainLabel: '着陆',
    domainLabelEn: 'Landing',
    facetLabel: '入口',
    facetLabelEn: 'Entry',
    tag: '首页',
    tagEn: 'Home',
    keywords: 'home landing index 主页',
  }

  const domains: PaletteItem[] = DOMAINS.map((d) => ({
    to: `/d/${d.key}`,
    label: d.label,
    labelEn: d.labelEn,
    icon: d.icon,
    accent: d.accent,
    domainLabel: d.label,
    domainLabelEn: d.labelEn,
    facetLabel: '域枢纽',
    facetLabelEn: 'Domain hub',
    tag: d.tag,
    tagEn: d.tagEn,
    keywords: `${d.key} ${d.labelEn} ${d.blurbEn}`,
  }))

  const leaves: PaletteItem[] = ALL_LEAVES.map((l) => ({
    to: `/${l.path}`,
    label: l.label,
    labelEn: l.labelEn,
    icon: l.icon,
    accent: l.accent,
    domainLabel: l.domainLabel,
    domainLabelEn: l.domainLabelEn,
    facetLabel: l.facetLabel,
    facetLabelEn: l.facetLabelEn,
    tag: l.tag,
    tagEn: l.tagEn,
    keywords: `${l.path} ${l.labelEn} ${l.description ?? ''} ${l.descriptionEn ?? ''}`,
  }))

  const phenomena: PaletteItem[] = PHENOMENA.map((p) => ({
    to: `/phenomena/${p.id}`,
    label: p.name,
    labelEn: p.nameEn,
    icon: p.icon ?? '🔬',
    accent: '#8b7bff',
    domainLabel: '前沿现象',
    domainLabelEn: 'Phenomena',
    facetLabel: p.domain ?? '现象',
    facetLabelEn: p.domain ?? 'Phenomenon',
    tag: '现象',
    tagEn: 'Phenomenon',
    keywords: [p.id, p.nameEn, p.summary].filter(Boolean).join(' '),
  }))

  const applications: PaletteItem[] = APPLICATIONS.map((app) => ({
    to: `/apps/${app.id}`, label: app.name, labelEn: app.nameEn, icon: app.icon, accent: '#ff9a4c',
    domainLabel: '应用案例', domainLabelEn: 'Application', facetLabel: '', facetLabelEn: '', tag: '',
    keywords: [app.name, app.nameEn, app.blurb, app.blurbEn].filter(Boolean).join(' '),
  }))
  return [home, ...domains, ...leaves, ...applications, ...phenomena]
}

const CATALOG = buildCatalog()

function displayItem(item: PaletteItem, locale: Locale) {
  return {
    label: pickLocaleString(item.label, item.labelEn, locale),
    domainLabel: pickLocaleString(item.domainLabel, item.domainLabelEn, locale),
    facetLabel: pickLocaleString(item.facetLabel, item.facetLabelEn, locale),
    tag: pickLocaleString(item.tag, item.tagEn, locale),
  }
}

function matches(item: PaletteItem, s: string): boolean {
  return (
    item.label.toLowerCase().includes(s) ||
    (item.labelEn?.toLowerCase().includes(s) ?? false) ||
    item.to.toLowerCase().includes(s) ||
    item.domainLabel.toLowerCase().includes(s) ||
    (item.domainLabelEn?.toLowerCase().includes(s) ?? false) ||
    item.facetLabel.toLowerCase().includes(s) ||
    (item.facetLabelEn?.toLowerCase().includes(s) ?? false) ||
    item.tag.toLowerCase().includes(s) ||
    (item.tagEn?.toLowerCase().includes(s) ?? false) ||
    (item.keywords?.toLowerCase().includes(s) ?? false)
  )
}

export function CommandPalette() {
  // Layout 仅在首次唤起时挂载本组件，故初始 open=true；之后由自身 ⌘K / open-palette 接管
  const { locale } = useLocale()
  const [open, setOpen] = useState(true)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const prevFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden' // 锁背景滚动
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(id)
      document.body.style.overflow = ''
      prevFocus?.focus?.() // 关闭后归还焦点（导航场景元素仍在，无害）
    }
  }, [open])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return CATALOG
    return CATALOG.filter((item) => matches(item, s))
  }, [q])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [active])

  if (!open) return null

  const go = (i: number) => {
    const r = results[i]
    if (!r) return
    setOpen(false)
    navigate(r.to)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(active) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/75 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={locale === 'en' ? 'Search simulations, applications and references' : '搜索仿真、应用与资料'}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault()
          if (document.activeElement === inputRef.current) closeRef.current?.focus()
          else inputRef.current?.focus()
        }
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-edge bg-panel/95 shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <span className="text-slate-500" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              locale === 'en'
                ? 'Search simulations, applications, or references…'
                : '搜索仿真、应用或资料…'
            }
            className="w-full bg-transparent py-3.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
            aria-label={locale === 'en' ? 'Search entries' : '搜索入口'}
            role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-result-${active}` : undefined}
          />
          <button ref={closeRef} type="button" className="btn shrink-0 text-slate-300 hover:bg-edge" onClick={() => setOpen(false)} aria-label={locale === 'en' ? 'Close search' : '关闭搜索'}>{locale === 'en' ? 'Close' : '关闭'}</button>
        </div>
        <div id="search-results" role="listbox" aria-label={locale === 'en' ? 'Search results' : '搜索结果'} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              {locale === 'en' ? 'No matches' : '无匹配的入口'}
            </div>
          )}
          {results.map((r, i) => {
            const shown = displayItem(r, locale)
            return (
              <button
                key={r.to}
                id={`search-result-${i}`} role="option" aria-selected={i === active}
                ref={i === active ? activeRef : null}
                tabIndex={-1}
                onClick={() => go(i)}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  i === active ? 'bg-edge/70' : 'hover:bg-edge/40'
                }`}
              >
                <span className="w-6 text-center text-lg" aria-hidden="true">{r.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{shown.label}</span>
                <span className="hidden shrink-0 text-xs text-slate-400 sm:block">
                  {shown.facetLabel || shown.domainLabel}
                </span>
              </button>
            )
          })}
        </div>
        <div className="readout flex items-center justify-between border-t border-edge px-4 py-2">
          <span>{results.length} / {CATALOG.length}</span>
          <span>
            {locale === 'en' ? '↑↓ select · ⏎ go · ESC close' : '↑↓ 选择 · ⏎ 跳转 · ESC 关闭'}
          </span>
        </div>
      </div>
    </div>
  )
}
