/**
 * 统一效率展示（KUX 靶 B）：数字 format + 可选条。
 */
import {
  efficiencyBarWidthPct,
  formatEfficiencyText,
  formatQuantityEfficiency,
  parseEfficiencyText,
} from '../lib/efficiencyFormat'
import { termTitle } from '../lib/termGlossary'
import { useLocale } from '../lib/i18n'

type QuantityProps = {
  mode: 'quantity'
  min?: number
  max?: number
  transport?: boolean
  note?: string
  showBar?: boolean
  className?: string
}

type TextProps = {
  mode: 'text'
  /** legacy conversions/transducers 字符串 */
  text: string
  showBar?: boolean
  className?: string
}

type Props = QuantityProps | TextProps

export function EfficiencyRange(props: Props) {
  const { locale } = useLocale()
  const showBar = props.showBar !== false
  const className = props.className ?? ''
  const zh = locale === 'zh'

  if (props.mode === 'text') {
    const label = formatEfficiencyText(props.text)
    const p = parseEfficiencyText(props.text)
    const transport = p.kind === 'cop'
    const width = p.ok ? efficiencyBarWidthPct(p.max ?? p.min, { transport }) : 0
    return (
      <div className={className}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span title={termTitle(transport ? 'cop' : 'eta', locale)}>
            {transport
              ? zh
                ? '性能系数 COP'
                : 'COP'
              : zh
                ? '典型效率'
                : 'Typical η'}
          </span>
          <span className={`font-mono ${transport ? 'text-sky-300' : 'text-ember'}`}>{label}</span>
        </div>
        {showBar && p.ok && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-edge/50">
            <div
              className={`h-full ${transport ? 'bg-gradient-to-r from-sky-500 to-cyan-300' : 'bg-gradient-to-r from-wave to-glow'}`}
              style={{ width: `${width}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  const transport = !!props.transport
  const label = formatQuantityEfficiency(props.min, props.max, { transport })
  const width = efficiencyBarWidthPct(props.max ?? props.min, { transport })

  return (
    <div className={className}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span title={termTitle(transport ? 'cop' : 'eta', locale)}>
          {transport ? (zh ? '性能系数 COP' : 'COP') : zh ? '效率 η' : 'Efficiency η'}
        </span>
        <span className={`font-mono ${transport ? 'text-sky-300' : 'text-ember'}`}>{label}</span>
        {transport && (
          <span
            className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300"
            title={`${termTitle('transport', locale)} ${termTitle('cop', locale)}`}
          >
            {zh ? '搬运·能效（COP，非 η 转换）' : 'Transport · COP (not η conversion)'}
          </span>
        )}
        {props.note && <span className="text-slate-500">· {props.note}</span>}
      </div>
      {showBar && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-edge/50">
          <div
            className={`h-full ${transport ? 'bg-gradient-to-r from-sky-500 to-cyan-300' : 'bg-gradient-to-r from-wave to-glow'}`}
            style={{ width: `${width}%` }}
          />
        </div>
      )}
    </div>
  )
}
