import type { PidStudyDraft, PidStudyInput } from '../../lib/sim/dymola-pid-study-input'
import { pidStudyCsv, pidStudyReport } from '../../lib/sim/dymola-pid-study-export'
import type { PidStudyResult } from '../../lib/sim/dymola-pid-study-result'
import { useLocale } from '../../lib/i18n'
import { PidStudyPlot } from './PidStudyPlot'
import { PidStudyTable } from './PidStudyTable'

type Props = {
  draft: PidStudyDraft
  input: PidStudyInput
  result: PidStudyResult
  jobId: string | null
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

/** Displays returned native PI samples alongside their submitted configuration snapshot. */
export function PidStudyResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'

  return (
    <section data-testid="pid-study-results" aria-labelledby="pid-study-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pid-study-results-title" className="text-lg font-semibold">{zh ? 'PI 控制研究结果' : 'PI control study results'}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {zh ? '原生状态空间 PI 一阶响应；图表和表格显示 Host 返回的样本。' : 'Native state-space PI first-order response; the plot and table show samples returned by Host.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="pid-study-download-csv" className="btn border border-edge" onClick={() => download('dymola-pid-study.csv', pidStudyCsv(result), 'text/csv;charset=utf-8')}>
            {zh ? '下载 CSV' : 'Download CSV'}
          </button>
          <button type="button" data-testid="pid-study-download-json" className="btn border border-edge" onClick={() => download('dymola-pid-study.json', pidStudyReport({ draft, input, result, jobId }), 'application/json;charset=utf-8')}>
            {zh ? '下载 JSON 报告' : 'Download JSON report'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <p className="rounded border border-edge p-3 text-sm" aria-label={zh ? '实际原生后端来源' : 'Actual native backend provenance'}>
          <span className="text-slate-400">{zh ? '实际后端：' : 'Actual backend: '}</span>
          <strong className="font-medium text-slate-100">{zh ? '原生 Host f64' : 'Native Host f64'}</strong>
          <span className="mt-1 block break-all text-xs text-slate-400">{zh ? '返回标识：' : 'Returned backend identifier: '}{result.backend || '—'}</span>
        </p>
        <p className="rounded border border-edge p-3 text-sm">
          <span className="text-slate-400">{zh ? '提交任务：' : 'Submitted job: '}</span>
          <span className="font-medium text-slate-100">{jobId || (zh ? '不可用' : 'unavailable')}</span>
        </p>
      </div>

      <details className="rounded border border-edge p-3" open>
        <summary className="cursor-pointer text-sm font-medium">{zh ? '已提交配置快照' : 'Submitted configuration snapshot'}</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-slate-400">{zh ? '过程增益' : 'Process gain'}</dt><dd>{draft.processGain}</dd></div>
          <div><dt className="text-slate-400">{zh ? '时间常数' : 'Time constant'}</dt><dd>{draft.timeConstant} s</dd></div>
          <div><dt className="text-slate-400">{zh ? '比例增益' : 'Proportional gain'}</dt><dd>{draft.proportionalGain}</dd></div>
          <div><dt className="text-slate-400">{zh ? '积分增益' : 'Integral gain'}</dt><dd>{draft.integralGain} 1/s</dd></div>
          <div><dt className="text-slate-400">{zh ? '设定值' : 'Setpoint'}</dt><dd>{draft.setpoint}</dd></div>
          <div><dt className="text-slate-400">{zh ? '时长' : 'Duration'}</dt><dd>{draft.duration} s</dd></div>
          <div><dt className="text-slate-400">{zh ? '样本数' : 'Samples'}</dt><dd>{draft.points}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">{zh ? '提交的求解时间网格：' : 'Submitted solver time grid: '}{input.times.length} {zh ? '个样本' : 'samples'} · {input.times[0]}–{input.times[input.times.length - 1]} s</p>
        <pre className="mt-3 max-h-64 overflow-auto rounded bg-panel p-3 text-xs text-slate-300">{JSON.stringify(input, null, 2)}</pre>
      </details>

      <PidStudyPlot times={result.times} output={result.output} />
      <PidStudyTable times={result.times} output={result.output} />
    </section>
  )
}
