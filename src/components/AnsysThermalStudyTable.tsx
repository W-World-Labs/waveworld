import { useLocale } from '../lib/i18n'
import type { AnsysThermalStudyResult } from '../lib/sim/ansys-thermal-study-result'

function format(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(value)
}

/** Displays validated native nodal temperatures and reported heat-balance values. */
export function AnsysThermalStudyTable({
  result,
  nodePositionsM,
  externalNodeLabels,
}: {
  result: AnsysThermalStudyResult
  /** Submitted mesh x positions in the same order as result.result.temperatures. */
  nodePositionsM: number[]
  /** Imported APDL node IDs in the same order as result.result.temperatures. */
  externalNodeLabels?: readonly number[]
}) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const native = result.result
  const balance = native.heatBalance

  return <div className="space-y-4">
    <section aria-labelledby="ansys-thermal-nodes-heading">
      <h3 id="ansys-thermal-nodes-heading" className="mb-2 text-sm font-semibold text-slate-200">
        {zh ? '最终节点温度' : 'Final nodal temperatures'}
      </h3>
      <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={zh ? '节点温度表（可滚动）' : 'Nodal temperature table (scrollable)'}>
        <table className="w-full whitespace-nowrap text-right text-xs" aria-label={zh ? '原生返回的最终节点温度' : 'Native returned final nodal temperatures'}>
          <caption className="sr-only">{zh ? '按节点顺序显示提交网格位置和原生最终温度' : 'Submitted mesh positions and native final temperatures by node order'}</caption>
          <thead className="sticky top-0 bg-panel text-slate-300"><tr>
            <th scope="col" className="px-3 py-2 font-medium">{zh ? '节点' : 'Node'}</th>
            <th scope="col" className="px-3 py-2 font-medium">x / m</th>
            <th scope="col" className="px-3 py-2 font-medium">{zh ? '温度 / °C' : 'Temperature / °C'}</th>
          </tr></thead>
          <tbody className="font-mono text-slate-300">
            {native.temperatures.length ? native.temperatures.map((temperature, index) => <tr key={index} className="border-t border-edge">
              <th scope="row" className="px-3 py-2 font-normal">{externalNodeLabels?.[index] ?? index}</th>
              <td className="px-3 py-2">{Number.isFinite(nodePositionsM[index]) ? format(nodePositionsM[index], locale) : '—'}</td>
              <td className="px-3 py-2">{format(temperature, locale)}</td>
            </tr>) : <tr><td colSpan={3} className="px-3 py-3 text-left">{zh ? '原生结果未返回节点温度' : 'No nodal temperatures were returned by the native result'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="ansys-thermal-balance-heading">
      <h3 id="ansys-thermal-balance-heading" className="mb-2 text-sm font-semibold text-slate-200">
        {zh ? '报告的热量平衡' : 'Reported heat balance'}
      </h3>
      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {([
          [zh ? '热源总量 / W' : 'Source total / W', balance.sourceTotal],
          [zh ? 'Robin 边界热输入 / W' : 'Robin heat input / W', balance.robinHeatIn],
          [zh ? 'Dirichlet 边界热输入 / W' : 'Dirichlet heat input / W', balance.dirichletHeatIn],
          [zh ? '平衡残差 / W' : 'Balance residual / W', balance.balanceResidual],
          [zh ? '最大残差 / W' : 'Maximum residual / W', native.maxResidual],
        ] as Array<[string, number]>).map(([label, value]) => <div key={label} className="flex min-w-0 justify-between gap-3 rounded border border-edge px-3 py-2">
          <dt className="text-slate-400">{label}</dt>
          <dd className="shrink-0 font-mono text-slate-200">{format(value, locale)}</dd>
        </div>)}
      </dl>
    </section>
  </div>
}
