import { useState } from 'react'
import { useLocale } from '../../lib/i18n'
import { pemfcStudyCsv, pemfcStudyReport } from '../../lib/sim/pemfc-study-export'
import type { PemfcStudyDraft, PemfcPolarizationInput } from '../../lib/sim/pemfc-study-input'
import type { PemfcStudyResult } from '../../lib/sim/pemfc-study-result'
import { PemfcOperatingPoint } from './PemfcOperatingPoint'
import { PemfcStudyPlot, type PemfcPlotMetric } from './PemfcStudyPlot'
import { PemfcStudyTable } from './PemfcStudyTable'

type Props = {
  draft: PemfcStudyDraft
  input: PemfcPolarizationInput
  result: PemfcStudyResult
  jobId: string | null
}

function download(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Displays and exports the native PEMFC polarization study response. */
export function PemfcStudyResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [metric, setMetric] = useState<PemfcPlotMetric>('voltage')
  const curve = result.result.curve
  let sampledMaximumIndex = 0
  for (let index = 1; index < curve.power.length; index += 1) {
    if (curve.power[index] > curve.power[sampledMaximumIndex]) sampledMaximumIndex = index
  }
  const floorCount = curve.voltage.filter(voltage => voltage === 0).length

  return (
    <section id="pemfc-study-results" data-testid="pemfc-study-results" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink">{zh ? '极化研究结果' : 'Polarization study results'}</h2>
          <p className="mt-1 text-sm text-muted">
            {zh ? '后端：' : 'Backend: '}{result.backend.id} ({result.backend.kind}) · {result.backend.deviceName}
            {jobId ? ` · ${zh ? '作业' : 'Job'} ${jobId}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            id="pemfc-download-csv"
            data-testid="pemfc-download-csv"
            type="button"
            className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface"
            onClick={() => download('pemfc-polarization-study.csv', pemfcStudyCsv(result), 'text/csv;charset=utf-8')}
          >{zh ? '下载 CSV' : 'Download CSV'}</button>
          <button
            id="pemfc-download-json"
            data-testid="pemfc-download-json"
            type="button"
            className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface"
            onClick={() => download('pemfc-polarization-study.json', pemfcStudyReport({ draft, input, result, jobId }), 'application/json;charset=utf-8')}
          >{zh ? '下载研究报告 JSON' : 'Download study report JSON'}</button>
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-surface p-4">
        <h3 className="font-medium text-ink">{zh ? '已保存条件' : 'Saved conditions'}</h3>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-muted">{zh ? '温度' : 'Temperature'}</dt><dd className="text-ink">{draft.T} K</dd></div>
          <div><dt className="text-muted">{zh ? '氢气分压' : 'Hydrogen partial pressure'}</dt><dd className="text-ink">{draft.pH2} atm</dd></div>
          <div><dt className="text-muted">{zh ? '氧气分压' : 'Oxygen partial pressure'}</dt><dd className="text-ink">{draft.pO2} atm</dd></div>
          <div><dt className="text-muted">{zh ? '水蒸气分压' : 'Water vapor partial pressure'}</dt><dd className="text-ink">{draft.pH2O} atm</dd></div>
          <div><dt className="text-muted">{zh ? '面积比电阻' : 'Area-specific resistance'}</dt><dd className="text-ink">{draft.R} ohm cm²</dd></div>
          <div><dt className="text-muted">{zh ? '工作电流密度' : 'Operating current density'}</dt><dd className="text-ink">{draft.j} A/cm²</dd></div>
          <div><dt className="text-muted">{zh ? '扫描范围 / 点数' : 'Sweep range / points'}</dt><dd className="text-ink">0–{draft.imax} A/cm² / {draft.points}</dd></div>
          <div><dt className="text-muted">{zh ? '固定电子数 / 标准电位' : 'Fixed electron count / standard potential'}</dt><dd className="text-ink">n = 2 / E₀ = 1.229 V</dd></div>
        </dl>
      </div>

      <PemfcOperatingPoint result={result} />

      <div className="space-y-2">
        <label htmlFor="pemfc-metric" className="block text-sm font-medium text-ink">
          {zh ? '图表纵轴' : 'Plot metric'}
        </label>
        <select
          id="pemfc-metric"
          data-testid="pemfc-metric"
          value={metric}
          onChange={event => setMetric(event.target.value as PemfcPlotMetric)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink"
        >
          <option value="voltage">{zh ? '电压 (V)' : 'Voltage (V)'}</option>
          <option value="power">{zh ? '功率密度 (W/cm²)' : 'Power density (W/cm²)'}</option>
        </select>
        <PemfcStudyPlot result={result} metric={metric} />
      </div>

      <div className="rounded-xl border border-edge p-4">
        <h3 id="pemfc-sampled-max" data-testid="pemfc-sampled-max" className="font-medium text-ink">
          {zh ? '采样最大功率（非优化器结果）' : 'Sampled maximum power (not an optimizer result)'}
        </h3>
        <p className="mt-1 text-sm text-ink">
          {curve.power[sampledMaximumIndex]} W/cm² at {curve.current[sampledMaximumIndex]} A/cm², {curve.voltage[sampledMaximumIndex]} V.
          {' '}{zh ? '这是返回样本中的最大值。' : 'This is the maximum among returned samples only.'}
        </p>
        <p className="mt-2 text-sm text-muted">
          {zh ? `模型零电压下限样本：${floorCount}。` : `Samples at the model’s zero-voltage floor: ${floorCount}.`}
        </p>
      </div>

      <PemfcStudyTable result={result} />

      <aside className="space-y-2 rounded-xl border border-edge bg-surface p-4 text-sm text-muted">
        <h3 className="font-medium text-ink">{zh ? '模型范围与限制' : 'Model scope and limits'}</h3>
        <p>{result.result.scopeNote}</p>
        <p>{zh
          ? '这是使用固定温度、气体分压和面积比电阻的零维代数极化模型；不包含空间分布、多物理场耦合、参数拟合或膜性质计算。'
          : 'This is a zero-dimensional algebraic polarization model with prescribed temperature, gas partial pressures, and area-specific resistance. It does not model spatial fields, multiphysics coupling, parameter fitting, or membrane properties.'}</p>
        <p>{zh
          ? '原生模型将电压下限截断为 0 V。零电压样本会保留并标记为模型下限；电压效率为 V/E_Nernst，不是系统或燃料效率。最大功率仅是返回样本中的最大值。'
          : 'The native model floors cell voltage at 0 V. Zero-voltage samples are retained and represent that model floor. Voltage efficiency is V/E_Nernst, not system or fuel efficiency. Maximum power refers only to the returned samples.'}</p>
      </aside>
    </section>
  )
}
