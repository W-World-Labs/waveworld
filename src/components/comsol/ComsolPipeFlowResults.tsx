import type { ComsolPipeFlowDraft, ComsolPipeFlowInput } from '../../lib/sim/comsol-pipe-flow-input'
import type { ComsolPipeFlowResult } from '../../lib/sim/comsol-pipe-flow-result'
import { useLocale } from '../../lib/i18n'

type Props = {
  draft: ComsolPipeFlowDraft
  input: ComsolPipeFlowInput
  result: ComsolPipeFlowResult
  jobId: string | null
}

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '—'
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function csvCell(value: string | number): string {
  const text = String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** Displays only the bounded single-pipe host operation's returned result. */
export function ComsolPipeFlowResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const edge = result.result.edges[0]
  const [inlet, outlet] = result.result.nodes
  const points = [
    { label: zh ? '入口' : 'Inlet', pressure: inlet.pressure, x: 76 },
    { label: zh ? '出口' : 'Outlet', pressure: outlet.pressure, x: 244 },
  ]
  const min = Math.min(...points.map(point => point.pressure))
  const max = Math.max(...points.map(point => point.pressure))
  const yFor = (pressure: number) => max === min ? 78 : 138 - ((pressure - min) / (max - min)) * 116
  const rows: [string, string][] = [
    [zh ? '体积流量' : 'Flow rate', `${format(edge.flow)} m³/s`],
    [zh ? '平均速度' : 'Velocity', `${format(edge.velocity)} m/s`],
    ['Re', format(edge.reynolds)],
    [zh ? '流态' : 'Regime', edge.regime],
    [zh ? 'Darcy 摩擦因子' : 'Darcy friction factor', edge.frictionFactor === null ? (zh ? '未返回' : 'Not returned') : format(edge.frictionFactor)],
    [zh ? '水头损失' : 'Head loss', `${format(edge.headLoss)} m`],
    [zh ? '入口原生压力' : 'Native inlet pressure', `${format(inlet.pressure)} Pa`],
    [zh ? '出口原生压力' : 'Native outlet pressure', `${format(outlet.pressure)} Pa`],
    [zh ? '迭代次数' : 'Iterations', String(result.result.iterations)],
    [zh ? '最大能量残差' : 'Maximum energy residual', format(result.result.maxEnergyResidual)],
    [zh ? '最大质量残差' : 'Maximum mass residual', format(result.result.maxMassResidual)],
  ]
  const submittedRows: [string, string | number][] = [
    [zh ? '原生模块' : 'Native module', input.module],
    [zh ? '原生方法' : 'Native method', input.methodId],
    [zh ? '管道标识' : 'Pipe ID', edge.id],
    [zh ? '管长 (m)' : 'Pipe length (m)', draft.length],
    [zh ? '内径 (m)' : 'Inner diameter (m)', draft.diameter],
    [zh ? '密度 (kg/m³)' : 'Density (kg/m³)', draft.rho],
    [zh ? '动力黏度 (Pa·s)' : 'Dynamic viscosity (Pa·s)', draft.mu],
    [zh ? '入口压力 (Pa)' : 'Inlet pressure (Pa)', draft.inletPressure],
    [zh ? '出口压力 (Pa)' : 'Outlet pressure (Pa)', draft.outletPressure],
  ]
  const csv = [
    [zh ? '指标' : 'Metric', zh ? '原生返回值' : 'Native returned value'],
    ...submittedRows,
    ...rows,
  ].map(row => row.map(csvCell).join(',')).join('\r\n')
  const report = {
    schemaVersion: 1,
    jobId,
    draft,
    input,
    method: { id: result.result.methodId, familyId: result.result.familyId },
    backend: result.backend,
    result: result.result,
    scope: result.result.scopeNote,
    limits: [
      'This result is from the bounded single-pipe, two-boundary host operation.',
      'The plot shows only the two returned endpoint pressures; it does not reconstruct a spatial pressure field.',
      'Displayed result values are taken from the native response; no additional solver values are calculated.',
    ],
    provenance: { module: input.module, methodId: input.methodId, familyId: result.result.familyId, backend: result.backend },
  }

  return (
    <section data-testid="comsol-pipe-flow-results" aria-labelledby="comsol-pipe-flow-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="comsol-pipe-flow-results-title" className="text-lg font-semibold text-ink">{zh ? '管流原生结果' : 'Native pipe-flow results'}</h2>
          <p className="mt-1 break-all text-sm text-muted">
            {zh ? '后端：' : 'Backend: '}{result.backend.id} ({result.backend.kind}) · {result.backend.deviceName}
            {' · '}{zh ? '方法：' : 'Method: '}{result.result.methodId}
            {' · '}{zh ? '作业：' : 'Job: '}{jobId || (zh ? '不可用' : 'unavailable')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="comsol-pipe-flow-download-csv" className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface" onClick={() => download('comsol-pipe-flow-results.csv', csv, 'text/csv;charset=utf-8')}>
            {zh ? '下载 CSV' : 'Download CSV'}
          </button>
          <button type="button" data-testid="comsol-pipe-flow-download-json" className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface" onClick={() => download('comsol-pipe-flow-results.json', JSON.stringify(report, null, 2), 'application/json;charset=utf-8')}>
            {zh ? '下载 JSON' : 'Download JSON'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-edge p-3">
        <h3 className="font-medium text-ink">{zh ? '已提交条件' : 'Submitted conditions'}</h3>
        <dl className="mt-2 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-muted">{zh ? '管长' : 'Pipe length'}</dt><dd>{format(draft.length)} m</dd></div>
          <div><dt className="text-muted">{zh ? '内径' : 'Inner diameter'}</dt><dd>{format(draft.diameter)} m</dd></div>
          <div><dt className="text-muted">{zh ? '流体密度' : 'Fluid density'}</dt><dd>{format(draft.rho)} kg/m³</dd></div>
          <div><dt className="text-muted">{zh ? '动力黏度' : 'Dynamic viscosity'}</dt><dd>{format(draft.mu)} Pa·s</dd></div>
          <div><dt className="text-muted">{zh ? '入口压力' : 'Inlet pressure'}</dt><dd>{format(draft.inletPressure)} Pa</dd></div>
          <div><dt className="text-muted">{zh ? '出口压力' : 'Outlet pressure'}</dt><dd>{format(draft.outletPressure)} Pa</dd></div>
        </dl>
        <p className="mt-2 break-all text-xs text-muted">{zh ? '输入标识：' : 'Input operation: '}{input.module} · {input.methodId} · {input.backend}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <figure data-testid="comsol-pipe-flow-pressure-plot" className="rounded-lg border border-edge p-3" aria-labelledby="comsol-pipe-pressure-title">
          <figcaption id="comsol-pipe-pressure-title" className="font-medium text-ink">{zh ? '原生返回端点压力' : 'Native returned endpoint pressures'}</figcaption>
          <p className="mt-1 text-xs text-muted">{zh ? '仅显示入口和出口两个返回值；不重建空间压力场。' : 'Endpoints only; no spatial pressure field reconstruction.'}</p>
          <svg role="img" aria-label={zh ? '仅入口和出口的端点原生压力图' : 'Endpoint native pressure plot showing inlet and outlet only'} viewBox="0 0 320 180" className="mt-2 h-44 w-full">
            <line x1="42" y1="138" x2="278" y2="138" stroke="currentColor" className="text-edge" />
            {points.map(point => <g key={point.label}>
              <circle cx={point.x} cy={yFor(point.pressure)} r="6" fill="currentColor" className="text-wave" />
              <text x={point.x} y={yFor(point.pressure) - 12} textAnchor="middle" className="fill-current text-xs text-ink">{format(point.pressure)} Pa</text>
              <text data-node-label={point.label.toLowerCase()} x={point.x} y="162" textAnchor="middle" className="fill-current text-xs text-muted">{point.label}</text>
            </g>)}
          </svg>
        </figure>

        <div className="overflow-x-auto rounded-lg border border-edge">
          <table data-testid="comsol-pipe-flow-metrics" className="w-full text-left text-sm">
            <caption className="px-3 py-2 text-left font-medium text-ink">{zh ? '原生返回指标' : 'Native returned metrics'}</caption>
            <tbody>{rows.map(([label, value]) => <tr key={label} className="border-t border-edge">
              <th scope="row" className="px-3 py-2 font-normal text-muted">{label}</th>
              <td className="px-3 py-2 text-ink">{value}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>

      <aside className="rounded-lg border border-edge p-3 text-sm text-muted">
        <h3 className="font-medium text-ink">{zh ? '范围与限制' : 'Scope and limits'}</h3>
        <p className="mt-1">{result.result.scopeNote}</p>
        <p className="mt-1">{zh ? '这是单管段、两个边界节点的原生主机计算。图表只展示原生返回的入口和出口压力，不表示沿管道的空间分布。' : 'This is a native host calculation for one pipe and two boundary nodes. The plot shows only the returned inlet and outlet pressures and does not represent spatial variation along the pipe.'}</p>
      </aside>
    </section>
  )
}
