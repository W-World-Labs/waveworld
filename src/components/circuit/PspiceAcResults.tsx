import type { PspiceAcResult } from '../../lib/sim/pspice-ac-adapter'
import type { PspiceAcSweepResultRow } from '../../lib/sim/pspice-ac-sweep'
import { useLocale } from '../../lib/i18n/LocaleContext'

type Props = { result: PspiceAcResult; sweepResults?: readonly PspiceAcSweepResultRow[] }

function formatNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '—'
}

function csvCell(value: string | number) {
  const text = String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(result: PspiceAcResult) {
  const rows = [
    ['frequency_hz', 'omega_rad_per_s', 'node', 'magnitude_v', 'phase_rad', 'phase_deg'],
    ...Object.entries(result.nodePhasors).map(([node, phasor]) => [
      result.frequencyHz,
      result.omega,
      node,
      phasor.magnitude,
      phasor.phaseRad,
      phasor.phaseDeg,
    ]),
  ]
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'pspice-ac-results.csv'
  anchor.click()
  URL.revokeObjectURL(href)
}

/** Present the single-frequency linear AC phasors returned by the adapter. */
export function PspiceAcResults({ result, sweepResults }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  if (sweepResults !== undefined) {
    const rows = sweepResults.map((row) => ({
      frequencyHz: row.frequencyHz,
      result: row.result,
    })).sort((a, b) => a.frequencyHz - b.frequencyHz)
    const nodes = [...new Set(rows.flatMap(({ result: rowResult }) => Object.keys(rowResult.nodePhasors)))].sort((a, b) => a.localeCompare(b))
    const width = 760
    const height = 340
    const left = 70
    const right = 18
    const plotWidth = width - left - right
    const top = 25
    const panelHeight = 112
    const gap = 42
    const bottom = top + panelHeight * 2 + gap
    const frequencies = rows.map((row) => row.frequencyHz).filter((frequency) => frequency > 0 && Number.isFinite(frequency))
    const minLog = Math.log10(Math.min(...frequencies))
    const maxLog = Math.log10(Math.max(...frequencies))
    const xFor = (frequency: number) => left + (maxLog === minLog ? 0.5 : (Math.log10(frequency) - minLog) / (maxLog - minLog)) * plotWidth
    const magnitudeMax = Math.max(1e-12, ...rows.flatMap(({ result: rowResult }) => nodes.map((node) => rowResult.nodePhasors[node]?.magnitude ?? 0)))
    const phaseAbsMax = Math.max(180, ...rows.flatMap(({ result: rowResult }) => nodes.map((node) => Math.abs(rowResult.nodePhasors[node]?.phaseDeg ?? 0))))
    const colors = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2', '#be123c', '#4f46e5']
    const line = (node: string, kind: 'magnitude' | 'phaseDeg') => rows
      .filter(({ frequencyHz }) => frequencyHz > 0 && Number.isFinite(frequencyHz))
      .map(({ frequencyHz, result: rowResult }) => {
        const value = rowResult.nodePhasors[node]?.[kind] ?? 0
        const scaled = kind === 'magnitude'
          ? top + panelHeight - (value / magnitudeMax) * panelHeight
          : top + panelHeight + gap + panelHeight / 2 - (value / phaseAbsMax) * (panelHeight / 2)
        return `${xFor(frequencyHz)},${scaled}`
      }).join(' ')

    return (
      <section data-testid="pspice-ac-results" aria-labelledby="pspice-ac-results-title" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 id="pspice-ac-results-title" className="text-lg font-semibold">{zh ? 'PSpice AC 扫频结果' : 'PSpice AC sweep results'}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">{zh ? '主机 f64 线性 MNA 相量结果' : 'Host f64 linear MNA phasor results'}</p>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="pspice-ac-sweep-plot-title pspice-ac-sweep-plot-desc" className="min-w-[600px] w-full">
            <title id="pspice-ac-sweep-plot-title">{zh ? 'AC 扫频幅值与相位图' : 'AC sweep magnitude and phase plot'}</title>
            <desc id="pspice-ac-sweep-plot-desc">{zh ? '横轴为对数频率，分别显示每个节点的电压幅值和相位。' : 'Logarithmic frequency on the horizontal axis; voltage magnitude and phase are shown for each node.'}</desc>
            {[0, 1].map((panel) => {
              const y = top + panel * (panelHeight + gap)
              return <g key={panel}>
                <line x1={left} y1={y} x2={width - right} y2={y} stroke="currentColor" opacity=".25" />
                <line x1={left} y1={y + panelHeight} x2={width - right} y2={y + panelHeight} stroke="currentColor" opacity=".45" />
                <line x1={left} y1={y} x2={left} y2={y + panelHeight} stroke="currentColor" opacity=".45" />
                <text x="5" y={y + 14} fontSize="12">{panel === 0 ? (zh ? '幅值 (V)' : 'Magnitude (V)') : (zh ? '相位 (度)' : 'Phase (degrees)')}</text>
              </g>
            })}
            {rows.filter(({ frequencyHz }) => frequencyHz > 0 && Number.isFinite(frequencyHz)).map(({ frequencyHz }, index) => <g key={`tick-${index}`}>
              <line x1={xFor(frequencyHz)} y1={top} x2={xFor(frequencyHz)} y2={bottom - 8} stroke="currentColor" opacity=".12" />
              <text x={xFor(frequencyHz)} y={height - 4} textAnchor="middle" fontSize="11">{formatNumber(frequencyHz)} Hz</text>
            </g>)}
            {nodes.map((node, index) => <g key={node}>
              <polyline points={line(node, 'magnitude')} fill="none" stroke={colors[index % colors.length]} strokeWidth="2" />
              <polyline points={line(node, 'phaseDeg')} fill="none" stroke={colors[index % colors.length]} strokeWidth="2" strokeDasharray="5 3" />
            </g>)}
          </svg>
        </div>
        <ul aria-label={zh ? '节点图例' : 'Node legend'} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {nodes.map((node, index) => <li key={node} className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />{node}</li>)}
          <li>{zh ? '实线：幅值；虚线：相位' : 'Solid: magnitude; dashed: phase'}</li>
        </ul>
        <div className="overflow-x-auto">
          <table data-testid="pspice-ac-sweep-table" className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{zh ? '每个频率下各节点的 AC 电压幅值和相位' : 'AC voltage magnitude and phase for each node at every frequency'}</caption>
            <thead><tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="px-3 py-2">{zh ? '频率 (Hz)' : 'Frequency (Hz)'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '节点' : 'Node'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '幅值 (V)' : 'Magnitude (V)'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '相位 (度)' : 'Phase (degrees)'}</th>
            </tr></thead>
            <tbody>{rows.flatMap(({ frequencyHz, result: rowResult }) => Object.entries(rowResult.nodePhasors).sort(([a], [b]) => a.localeCompare(b)).map(([node, phasor]) => <tr key={`${frequencyHz}-${node}`} className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-3 py-2 tabular-nums">{formatNumber(frequencyHz)}</td>
              <th scope="row" className="px-3 py-2 font-medium">{node}</th>
              <td className="px-3 py-2 tabular-nums">{formatNumber(phasor.magnitude)}</td>
              <td className="px-3 py-2 tabular-nums">{formatNumber(phasor.phaseDeg)}°</td>
            </tr>))}</tbody>
          </table>
        </div>
      </section>
    )
  }
  const nodes = Object.entries(result.nodePhasors).sort(([a], [b]) => a.localeCompare(b))
  const backend = typeof result.backend === 'string'
    ? result.backend
    : Object.entries(result.backend).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')

  return (
    <section
      data-testid="pspice-ac-results"
      aria-labelledby="pspice-ac-results-title"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="pspice-ac-results-title" className="text-lg font-semibold">
          {zh ? 'PSpice AC 分析结果' : 'PSpice AC analysis results'}
        </h3>
        <button
          type="button"
          data-testid="pspice-ac-csv"
          onClick={() => downloadCsv(result)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
        >
          {zh ? '下载 CSV' : 'Download CSV'}
        </button>
      </div>

      <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium">{zh ? '方法' : 'Method'}</dt>
        <dd>{result.methodId} ({result.familyId})</dd>
        <dt className="font-medium">{zh ? '频率' : 'Frequency'}</dt>
        <dd className="tabular-nums">{formatNumber(result.frequencyHz)} Hz · ω = {formatNumber(result.omega)} rad/s</dd>
        <dt className="font-medium">{zh ? '后端' : 'Backend'}</dt>
        <dd className="break-all">{backend || (zh ? '无后端信息' : 'No backend details')}</dd>
      </dl>

      <p data-testid="pspice-ac-limit" className="rounded bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        {zh
          ? '范围限制：仅单一频点；使用主机 f64 精度的线性 MNA。'
          : 'Scope limit: one frequency point only; host f64 linear MNA.'}
      </p>

      <div className="overflow-x-auto">
        <table data-testid="pspice-ac-table" className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            {zh ? '各节点的 AC 电压相量' : 'AC voltage phasors for each node'}
          </caption>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="px-3 py-2">{zh ? '节点' : 'Node'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '幅值 (V)' : 'Magnitude (V)'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '相位 (度)' : 'Phase (degrees)'}</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map(([name, phasor]) => (
              <tr key={name} data-testid="pspice-ac-row" className="border-b border-slate-100 dark:border-slate-800">
                <th scope="row" className="px-3 py-2 font-medium">{name}</th>
                <td className="px-3 py-2 tabular-nums">{formatNumber(phasor.magnitude)}</td>
                <td className="px-3 py-2 tabular-nums">{formatNumber(phasor.phaseDeg)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
