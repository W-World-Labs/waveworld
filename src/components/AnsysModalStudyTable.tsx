import { useLocale } from '../lib/i18n'

export interface AnsysModalStudyTableData {
  frequenciesHz: readonly number[]
  frequenciesRadS: readonly number[]
  periodsS: readonly number[]
  eigenvalues: readonly number[]
  modalMass: readonly number[]
  participationFactors: readonly number[]
  effectiveMassRatio: readonly number[]
  modeShapes: readonly (readonly number[])[]
}

function format(value: number | undefined, locale: string): string {
  return value !== undefined && Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(value)
    : '—'
}

/** Shows only the modal values and two DOF shape components returned by the solver. */
export function AnsysModalStudyTable({ result }: { result: AnsysModalStudyTableData }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const headers = zh
    ? ['模态', '频率 / Hz', '角频率 / rad·s⁻¹', '周期 / s', '特征值', '模态质量', '参与因子', '有效质量比', '振型 DOF 1', '振型 DOF 2']
    : ['Mode', 'Frequency / Hz', 'Angular frequency / rad·s⁻¹', 'Period / s', 'Eigenvalue', 'Modal mass', 'Participation factor', 'Effective mass ratio', 'Mode shape DOF 1', 'Mode shape DOF 2']
  const tableName = zh ? 'ANSYS 模态研究返回结果' : 'ANSYS modal study returned results'

  return <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label={zh ? '模态结果表（可滚动）' : 'Modal results table (scrollable)'}>
    <table className="w-full min-w-[1100px] whitespace-nowrap text-right text-xs" aria-label={tableName}>
      <caption className="sr-only">{zh ? '每行对应一个求解器返回的模态；振型展示前两个自由度分量。' : 'One row per mode returned by the solver; mode shapes show the first two degree-of-freedom components.'}</caption>
      <thead className="sticky top-0 bg-panel text-slate-300"><tr>{headers.map((header) => <th key={header} scope="col" className="px-3 py-2 font-medium">{header}</th>)}</tr></thead>
      <tbody className="font-mono text-slate-300">
        {result.modeShapes.length ? result.modeShapes.map((shape, index) => <tr key={index} className="border-t border-edge">
          <th scope="row" className="px-3 py-2 font-normal">{index + 1}</th>
          <td className="px-3 py-2">{format(result.frequenciesHz[index], locale)}</td>
          <td className="px-3 py-2">{format(result.frequenciesRadS[index], locale)}</td>
          <td className="px-3 py-2">{format(result.periodsS[index], locale)}</td>
          <td className="px-3 py-2">{format(result.eigenvalues[index], locale)}</td>
          <td className="px-3 py-2">{format(result.modalMass[index], locale)}</td>
          <td className="px-3 py-2">{format(result.participationFactors[index], locale)}</td>
          <td className="px-3 py-2">{format(result.effectiveMassRatio[index], locale)}</td>
          <td className="px-3 py-2">{format(shape[0], locale)}</td>
          <td className="px-3 py-2">{format(shape[1], locale)}</td>
        </tr>) : <tr><td colSpan={headers.length} className="px-3 py-3 text-left">{zh ? '求解器未返回模态。' : 'No modes were returned by the solver.'}</td></tr>}
      </tbody>
    </table>
  </div>
}
