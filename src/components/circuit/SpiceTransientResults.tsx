import type { SpiceTransientResult } from '../../lib/sim/spice-transient-adapter'
import { useLocale } from '../../lib/i18n/LocaleContext'

type Props = { result: SpiceTransientResult; jobId: string | null }

const CHART = { left: 64, right: 660, top: 22, bottom: 250 }

function formatNumber(value: number) {
  return Number(value.toPrecision(8)).toString()
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function download(name: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

/** Show and export only the transient samples returned by the host adapter. */
export function SpiceTransientResults({ result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const times = result.samples.map((sample) => sample.time)
  const voltages = result.samples.map((sample) => sample.value)
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const minVoltage = Math.min(0, ...voltages)
  const maxVoltage = Math.max(0, ...voltages)
  const timeSpan = maxTime - minTime || 1
  const voltageSpan = maxVoltage - minVoltage || 1
  const x = (time: number) => CHART.left + ((time - minTime) / timeSpan) * (CHART.right - CHART.left)
  const y = (voltage: number) => CHART.bottom - ((voltage - minVoltage) / voltageSpan) * (CHART.bottom - CHART.top)
  const path = result.samples.map((sample, index) => `${index === 0 ? 'M' : 'L'} ${x(sample.time)} ${y(sample.value)}`).join(' ')

  function exportCsv() {
    const rows = [
      ['time_s', `voltage_${result.nodeName}_v`],
      ...result.samples.map((sample) => [sample.time, sample.value] as const),
    ]
    download('spice-transient.csv', rows.map((row) => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
  }

  function exportJson() {
    const report = {
      jobId,
      methodId: result.methodId,
      familyId: result.familyId,
      scheme: result.scheme,
      dt: result.dt,
      steps: result.steps,
      outputNode: result.outputNode,
      nodeName: result.nodeName,
      initial: result.initial,
      samples: result.samples,
      finalNodeVoltages: result.finalNodeVoltages,
      finalCapacitorCurrents: result.finalCapacitorCurrents,
      finalInductorCurrents: result.finalInductorCurrents,
      finalOutput: result.finalOutput,
      newtonIterations: result.newtonIterations,
      converged: result.converged,
      backend: result.backend,
    }
    download('spice-transient.json', JSON.stringify(report, null, 2), 'application/json;charset=utf-8')
  }

  return (
    <section data-testid="spice-transient-results" aria-labelledby="spice-transient-results-title" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="spice-transient-results-title" className="text-lg font-semibold">
          {zh ? 'SPICE 瞬态分析结果' : 'SPICE transient analysis results'}
        </h3>
        <div className="flex gap-2">
          <button type="button" data-testid="spice-transient-csv" onClick={exportCsv} className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
            {zh ? '下载 CSV' : 'Download CSV'}
          </button>
          <button type="button" data-testid="spice-transient-json" onClick={exportJson} className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
            {zh ? '下载 JSON' : 'Download JSON'}
          </button>
        </div>
      </div>

      <p data-testid="spice-transient-limit" className="rounded bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        {zh
          ? '范围限制：仅支持恒定独立源和最多 2000 个固定步长；使用后向欧拉（BE）。初态可显式设置节点电压和电感支路电流；不会计算直流初始工作点。.ic/.uic 卡、自适应步长及脉冲/正弦源不支持。'
          : 'Scope limits: constant independent sources and at most 2000 fixed steps with backward Euler (BE). Node voltages and inductor branch currents can be set explicitly; no DC operating point is computed. .ic/.uic cards, adaptive stepping, and pulse/sinusoidal sources are unsupported.'}
      </p>

      <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium">{zh ? '任务' : 'Job'}</dt><dd className="break-all">{jobId ?? (zh ? '未报告' : 'Not reported')}</dd>
        <dt className="font-medium">{zh ? '方法' : 'Method'}</dt><dd>{result.methodId} ({result.familyId})</dd>
        <dt className="font-medium">{zh ? '输出节点' : 'Output node'}</dt><dd>{result.nodeName}</dd>
        <dt className="font-medium">{zh ? '时间步长' : 'Time step'}</dt><dd className="tabular-nums">{formatNumber(result.dt)} s · {result.steps} {zh ? '步' : 'steps'}</dd>
        <dt className="font-medium">{zh ? '显式初态' : 'Explicit initial state'}</dt><dd className="break-all font-mono text-xs">{JSON.stringify(result.initial ?? { zeroState: true })}</dd>
      </dl>

      <div className="overflow-x-auto rounded border border-slate-200 p-2 dark:border-slate-700">
        <svg viewBox="0 0 700 300" role="img" aria-label={zh ? `节点 ${result.nodeName} 的电压随时间变化` : `Voltage at node ${result.nodeName} versus time`} className="h-auto min-w-[520px] w-full">
          <line x1={CHART.left} y1={CHART.bottom} x2={CHART.right} y2={CHART.bottom} stroke="currentColor" opacity=".55" />
          <line x1={CHART.left} y1={CHART.top} x2={CHART.left} y2={CHART.bottom} stroke="currentColor" opacity=".55" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" />
          {result.samples.map((sample, index) => <circle key={`${sample.time}-${index}`} cx={x(sample.time)} cy={y(sample.value)} r="2.5" fill="#2563eb" />)}
          <text x={(CHART.left + CHART.right) / 2} y="288" textAnchor="middle" fontSize="12">{zh ? '时间 (s)' : 'Time (s)'}</text>
          <text x="14" y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="12" transform={`rotate(-90 14 ${(CHART.top + CHART.bottom) / 2})`}>{zh ? `节点 ${result.nodeName} 电压 (V)` : `Node ${result.nodeName} voltage (V)`}</text>
          <text x={CHART.left} y="270" textAnchor="middle" fontSize="11">{formatNumber(minTime)}</text>
          <text x={CHART.right} y="270" textAnchor="middle" fontSize="11">{formatNumber(maxTime)}</text>
          <text x="58" y={CHART.bottom} textAnchor="end" fontSize="11">{formatNumber(minVoltage)}</text>
          <text x="58" y={CHART.top + 4} textAnchor="end" fontSize="11">{formatNumber(maxVoltage)}</text>
        </svg>
      </div>

      <div className="overflow-x-auto">
        <table data-testid="spice-transient-table" className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{zh ? '捕获的时间和节点电压样本' : 'Captured time and node voltage samples'}</caption>
          <thead><tr className="border-b border-slate-200 dark:border-slate-700">
            <th scope="col" className="px-3 py-2">{zh ? '时间 (s)' : 'Time (s)'}</th>
            <th scope="col" className="px-3 py-2">{zh ? `节点 ${result.nodeName} 电压 (V)` : `Node ${result.nodeName} voltage (V)`}</th>
          </tr></thead>
          <tbody>{result.samples.map((sample, index) => <tr key={`${sample.time}-${index}`} className="border-b border-slate-100 dark:border-slate-800">
            <td className="px-3 py-2 tabular-nums">{formatNumber(sample.time)}</td>
            <td className="px-3 py-2 tabular-nums">{formatNumber(sample.value)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}
