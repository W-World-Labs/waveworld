/**
 * 术语 chip：标签 + 统一 title/展开一句人话（KUX 靶 D）。
 */
import { useState } from 'react'
import { getTerm, type TermId } from '../lib/termGlossary'
import { pickLocaleString, useLocale } from '../lib/i18n'

type Props = {
  id: TermId
  /** 覆盖默认 label */
  label?: string
  className?: string
  /** compact：仅悬停 title；default：可点开一句 */
  mode?: 'compact' | 'expandable'
}

export function TermChip({ id, label, className = '', mode = 'expandable' }: Props) {
  const { locale } = useLocale()
  const t = getTerm(id)
  const [open, setOpen] = useState(false)
  const text = label ?? pickLocaleString(t.label, t.labelEn, locale)
  const plain = pickLocaleString(t.plainZh, t.plainEn, locale)
  const detail = t.detail
    ? pickLocaleString(t.detail, t.detailEn, locale)
    : undefined
  const title = detail ? `${plain} ${detail}` : plain

  if (mode === 'compact') {
    return (
      <span
        className={`cursor-help border-b border-dotted border-slate-500 text-slate-400 ${className}`}
        title={title}
        data-term={id}
      >
        {text}
      </span>
    )
  }

  return (
    <span className={`inline-flex max-w-full flex-col items-start ${className}`} data-term={id}>
      <button
        type="button"
        className="cursor-pointer rounded border border-edge/80 bg-edge/30 px-1.5 py-0.5 text-left text-[11px] text-slate-300 hover:border-wave/50 hover:text-slate-100"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {text}
        <span className="ml-1 text-slate-600" aria-hidden>
          {open ? '▾' : '?'}
        </span>
      </button>
      {open && (
        <span className="mt-0.5 max-w-md rounded border border-edge/50 bg-canvas/90 px-2 py-1 text-[10px] leading-snug text-slate-400">
          {plain}
          {detail ? <span className="mt-0.5 block text-slate-500">{detail}</span> : null}
        </span>
      )}
    </span>
  )
}
