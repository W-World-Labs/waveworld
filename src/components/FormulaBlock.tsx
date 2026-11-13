/**
 * 公式人话块（KUX 靶 C）：先人话 → 变量表 → 算例 → 机器 expr 次要。
 */
import type { Formula } from '../data/ontology/types'
import {
  explainFormula,
  formatSampleNumber,
  type FormulaWithPlain,
} from '../lib/formulaExplain'
import { pickLocaleString, useLocale } from '../lib/i18n'

type Props = {
  formula: Formula | FormulaWithPlain
  /** compact：图谱卡片；default：矩阵详情 */
  density?: 'default' | 'compact'
  className?: string
}

export function FormulaBlock({ formula, density = 'default', className = '' }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const v = explainFormula(formula, locale)
  const compact = density === 'compact'
  const plain = pickLocaleString(v.plainZh, v.plainEn, locale)

  return (
    <div
      className={`rounded-lg border border-edge/60 bg-edge/20 ${compact ? 'p-2' : 'p-3'} ${className}`}
      data-formula-block
    >
      <div className={`text-slate-200 ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className="mr-1.5 text-slate-500">
          {compact
            ? zh
              ? '式'
              : 'Eq'
            : zh
              ? '这个公式在算'
              : 'This formula computes'}
        </span>
        {plain}
      </div>

      {v.vars.length > 0 && (
        <div className={`mt-2 overflow-x-auto ${compact ? 'text-[10px]' : 'text-xs'}`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-slate-500">
                <th className="pr-2 font-normal">{zh ? '符号' : 'Symbol'}</th>
                <th className="pr-2 font-normal">{zh ? '含义 / 单位' : 'Meaning / unit'}</th>
                {v.hasSample && <th className="font-normal">{zh ? '本例' : 'Sample'}</th>}
              </tr>
            </thead>
            <tbody>
              {v.vars.map((row) => (
                <tr key={row.symbol} className="border-t border-edge/40 text-slate-300">
                  <td className="py-0.5 pr-2 font-mono text-wave">{row.symbol}</td>
                  <td className="py-0.5 pr-2 text-slate-400">{row.meaning}</td>
                  {v.hasSample && (
                    <td className="py-0.5 font-mono text-slate-300">
                      {row.sample != null ? formatSampleNumber(row.sample) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.hasSample && v.expected != null && (
        <div className={`mt-2 font-mono text-ember ${compact ? 'text-[10px]' : 'text-xs'}`}>
          {zh ? '本例结果' : 'Sample result'}
          {v.lhs ? <span className="text-slate-500">（{v.lhs}）</span> : null}
          {' = '}
          {formatSampleNumber(v.expected)}
        </div>
      )}

      <details className={`mt-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-400">
          {zh ? '机器表达式（校验用）' : 'Machine expression (for checks)'}
        </summary>
        <code className="mt-1 block break-all font-mono text-wave/90">{v.expr}</code>
      </details>
    </div>
  )
}
