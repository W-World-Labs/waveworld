import { useLocale } from '../../lib/i18n'
import type { ExchangerStudyCase } from '../../lib/sim/exchanger-study-result'

const fields = [
  { key: 'UA', en: 'UA / W/K', zh: 'UA / W/K' },
  { key: 'NTU', en: 'NTU / 1', zh: 'NTU / 1' },
  { key: 'effectiveness', en: 'Effectiveness / 1', zh: '有效度 / 1' },
  { key: 'Q', en: 'Heat Q / W', zh: '热量 Q / W' },
  { key: 'T_hot_out', en: 'Hot outlet / K', zh: '热侧出口 / K' },
  { key: 'T_cold_out', en: 'Cold outlet / K', zh: '冷侧出口 / K' },
  { key: 'hotLoss', en: 'Hot loss / W', zh: '热侧放热 / W' },
  { key: 'coldGain', en: 'Cold gain / W', zh: '冷侧吸热 / W' },
] as const

type FieldKey = typeof fields[number]['key']

function format(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(value)
}

/** Displays the submitted UA samples and the corresponding native result fields. */
export function ExchangerStudyTable({ cases }: { cases: ExchangerStudyCase[] }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const validCases = cases.filter(item => fields.every(({ key }) => Number.isFinite(item[key as FieldKey])))

  return <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label={zh ? 'UA 参数研究结果表（可滚动）' : 'UA study results table (scrollable)'}>
    <table data-testid="exchanger-study-table" className="w-full whitespace-nowrap text-right text-xs" aria-label={zh ? '换热器 UA 参数研究结果' : 'Exchanger UA study results'}>
      <caption className="sr-only">{zh ? '每个 UA 采样点对应的原生稳态结果' : 'Native steady-state results for each UA sample'}</caption>
      <thead className="sticky top-0 bg-panel text-slate-300">
        <tr>{fields.map(field => <th key={field.key} scope="col" className="px-3 py-2 font-medium">{zh ? field.zh : field.en}</th>)}</tr>
      </thead>
      <tbody className="font-mono text-slate-300">
        {validCases.map((item, index) => <tr key={`${item.UA}-${index}`} className="border-t border-edge">
          {fields.map(({ key }) => <td key={key} className="px-3 py-2">{format(item[key as FieldKey], locale)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
}
