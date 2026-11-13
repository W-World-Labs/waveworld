import { useState } from 'react'
import type { ExchangerStudyDraft, ExchangerSweepInput } from '../../lib/sim/exchanger-study-input'
import { exchangerStudyCsv, exchangerStudyReport } from '../../lib/sim/exchanger-study-export'
import type { ExchangerStudyResult } from '../../lib/sim/exchanger-study-result'
import { useLocale } from '../../lib/i18n'
import { ExchangerStudyPlot, type ExchangerPlotMetric } from './ExchangerStudyPlot'
import { ExchangerStudyTable } from './ExchangerStudyTable'

type Props = {
  draft: ExchangerStudyDraft
  input: ExchangerSweepInput
  result: ExchangerStudyResult
  jobId: string | null
}

const metrics: { value: ExchangerPlotMetric; unit: string; en: string; zh: string }[] = [
  { value: 'Q', unit: 'W', en: 'Heat transfer Q', zh: '传热量 Q' },
  { value: 'effectiveness', unit: '1', en: 'Effectiveness', zh: '有效度' },
  { value: 'T_hot_out', unit: 'K', en: 'Hot outlet temperature', zh: '热侧出口温度' },
  { value: 'T_cold_out', unit: 'K', en: 'Cold outlet temperature', zh: '冷侧出口温度' },
]

function format(value: number, digits = 8): string {
  return Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : '—'
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Shows the submitted snapshot alongside the independently returned native host results. */
export function ExchangerStudyResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [metric, setMetric] = useState<ExchangerPlotMetric>('Q')
  const selectedMetric = metrics.find(item => item.value === metric) ?? metrics[0]

  return (
    <section data-testid="exchanger-study-results" aria-labelledby="exchanger-study-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="exchanger-study-results-title" className="text-lg font-semibold">{zh ? '换热器 UA 扫描结果' : 'Exchanger UA study results'}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {zh ? '图表和表格直接显示已提交扫描对应的原生返回结果。' : 'The plot and table show native results for the submitted sweep.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="exchanger-download-csv" className="btn border border-edge" onClick={() => download('exchanger-ua-study.csv', exchangerStudyCsv(result), 'text/csv;charset=utf-8')}>
            {zh ? '下载 CSV' : 'Download CSV'}
          </button>
          <button type="button" data-testid="exchanger-download-json" className="btn border border-edge" onClick={() => download('exchanger-ua-study.json', exchangerStudyReport({ draft, input, result, jobId }), 'application/json;charset=utf-8')}>
            {zh ? '下载 JSON 报告' : 'Download JSON report'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <p className="rounded border border-edge p-3 text-sm" aria-label={zh ? '实际原生后端来源' : 'Actual native backend provenance'}>
          <span className="text-slate-400">{zh ? '实际后端：' : 'Actual backend: '}</span>
          <strong className="font-medium text-slate-100">{zh ? '原生 host-f64（CPU）' : 'Native host-f64 (CPU)'}</strong>
          <span className="mt-1 block break-all text-xs text-slate-400">{zh ? '返回标识：' : 'Returned backend identifier: '}{result.backend || '—'}</span>
        </p>
        <p className="rounded border border-edge p-3 text-sm">
          <span className="text-slate-400">{zh ? '提交快照任务：' : 'Submitted snapshot job: '}</span>
          <span className="font-medium text-slate-100">{jobId || (zh ? '不可用' : 'unavailable')}</span>
        </p>
      </div>

      <details className="rounded border border-edge p-3" open>
        <summary className="cursor-pointer text-sm font-medium">{zh ? '已提交配置快照' : 'Submitted configuration snapshot'}</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-slate-400">{zh ? '流型' : 'Arrangement'}</dt><dd>{input.arrangement === 'counterflow' ? (zh ? '逆流' : 'Counterflow') : (zh ? '并流' : 'Parallel')}</dd></div>
          <div><dt className="text-slate-400">{zh ? '热侧热容流率' : 'Hot capacity rate'}</dt><dd>{format(input.Chot)} W/K</dd></div>
          <div><dt className="text-slate-400">{zh ? '冷侧热容流率' : 'Cold capacity rate'}</dt><dd>{format(input.Ccold)} W/K</dd></div>
          <div><dt className="text-slate-400">{zh ? '热侧入口温度' : 'Hot inlet temperature'}</dt><dd>{format(input.T_hot_in)} K</dd></div>
          <div><dt className="text-slate-400">{zh ? '冷侧入口温度' : 'Cold inlet temperature'}</dt><dd>{format(input.T_cold_in)} K</dd></div>
          <div><dt className="text-slate-400">{zh ? 'UA 扫描点' : 'Submitted UA sweep'}</dt><dd className="break-words">{input.sweep_UA.map(value => format(value)).join(', ')} W/K</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          {zh ? '编辑器快照：' : 'Editor snapshot: '}{draft.range.spacing} · {format(draft.range.start)}–{format(draft.range.end)} W/K · {draft.range.points} {zh ? '点' : 'points'}
        </p>
      </details>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-sm" htmlFor="exchanger-metric">
          <span className="text-slate-300">{zh ? '图表指标' : 'Plot metric'}</span>
          <select id="exchanger-metric" data-testid="exchanger-metric" value={metric} onChange={event => setMetric(event.target.value as ExchangerPlotMetric)} className="min-w-56 rounded border border-edge bg-panel px-3 py-2 text-slate-100">
            {metrics.map(item => <option key={item.value} value={item.value}>{zh ? item.zh : item.en} ({item.unit})</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-400">{zh ? '横轴：UA (W/K)；纵轴：' : 'X axis: UA (W/K); Y axis: '}{zh ? selectedMetric.zh : selectedMetric.en} ({selectedMetric.unit})</p>
      </div>
      <ExchangerStudyPlot cases={result.cases} metric={metric} />
      <ExchangerStudyTable cases={result.cases} />
    </section>
  )
}
