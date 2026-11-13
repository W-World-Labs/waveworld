import { useLocale } from '../../lib/i18n'
import type { PemfcStudyResult } from '../../lib/sim/pemfc-study-result'

function format(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(value)
}

/** Shows only the native curve samples; zero-voltage samples are retained and identified. */
export function PemfcStudyTable({ result }: { result: PemfcStudyResult }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const { current, voltage, power } = result.result.curve

  return (
    <div
      className="max-h-96 overflow-auto"
      tabIndex={0}
      role="region"
      aria-label={zh ? 'PEMFC 极化曲线结果表（可滚动）' : 'PEMFC polarization results table (scrollable)'}
    >
      <table
        id="pemfc-study-table"
        data-testid="pemfc-study-table"
        className="w-full whitespace-nowrap text-right text-xs"
        aria-label={zh ? 'PEMFC 极化曲线采样结果' : 'PEMFC polarization curve samples'}
      >
        <caption className="sr-only">
          {zh ? '原生返回的电流密度、电池电压和功率密度采样值' : 'Native current density, cell voltage, and power density samples'}
        </caption>
        <thead className="sticky top-0 bg-panel text-slate-300">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">{zh ? '电流密度 / A/cm²' : 'Current density / A/cm²'}</th>
            <th scope="col" className="px-3 py-2 font-medium">{zh ? '电池电压 / V' : 'Cell voltage / V'}</th>
            <th scope="col" className="px-3 py-2 font-medium">{zh ? '功率密度 / W/cm²' : 'Power density / W/cm²'}</th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-300">
          {current.map((density, index) => (
            <tr key={`${density}-${index}`} className="border-t border-edge">
              <td className="px-3 py-2">{format(density, locale)}</td>
              <td className="px-3 py-2">
                {format(voltage[index], locale)}
                {voltage[index] === 0 && (
                  <span className="ml-2 font-sans text-amber-600 dark:text-amber-400">
                    {zh ? '模型电压下限' : 'model voltage floor'}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">{format(power[index], locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
