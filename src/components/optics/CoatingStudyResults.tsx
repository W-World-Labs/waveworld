import type { CoatingStudyDraft, CoatingStudyInput } from '../../lib/sim/coating-study-input'
import type { CoatingStudyResult } from '../../lib/sim/coating-study-result'
import { useLocale } from '../../lib/i18n'

type Props = {
  draft: CoatingStudyDraft
  input: CoatingStudyInput
  result: CoatingStudyResult
  jobId: string | null
  onDownloadCsv: () => void
  onDownloadJson: () => void
}

const width = 720
const height = 320
const pad = { left: 52, right: 18, top: 18, bottom: 38 }

function number(value: number, digits = 6): string {
  return Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : '—'
}

function backendLabel(backend: CoatingStudyResult['backend']): string {
  return Object.entries(backend)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ')
}

/** Shows only wavelength samples and optical coefficients returned by the native backend. */
export function CoatingStudyResults({ draft, input, result, jobId, onDownloadCsv, onDownloadJson }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const samples = result.spectrum
  const wavelengths = samples.map((sample) => sample.lambda)
  const minWavelength = wavelengths.length ? Math.min(...wavelengths) : 0
  const maxWavelength = wavelengths.length ? Math.max(...wavelengths) : 1
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const x = (lambda: number) => pad.left + (lambda - minWavelength) / (maxWavelength - minWavelength || 1) * plotWidth
  const y = (value: number) => pad.top + (1 - value) * plotHeight
  const selected = (sample: (typeof samples)[number], key: 'R' | 'T' | 'A') => {
    if (input.polarization === 's') return sample[`${key}s` as 'Rs' | 'Ts' | 'As']
    if (input.polarization === 'p') return sample[`${key}p` as 'Rp' | 'Tp' | 'Ap']
    return sample[key]
  }
  const curves = [
    { key: 'R' as const, color: '#38bdf8', label: zh ? '反射率 R' : 'Reflectance R' },
    { key: 'T' as const, color: '#4ade80', label: zh ? '透射率 T' : 'Transmittance T' },
    { key: 'A' as const, color: '#fb923c', label: zh ? '吸收率 A' : 'Absorptance A' },
  ]
  const actualBackend = backendLabel(result.backend)

  return (
    <section data-testid="coating-study-results" aria-labelledby="coating-study-results-title" className="mt-6 space-y-4 rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="coating-study-results-title" className="text-lg font-semibold">{zh ? '薄膜镀层结果' : 'Coating study results'}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {zh ? '曲线仅连接原生返回的波长样本；未生成额外波长点。' : 'Curves connect only wavelength samples returned by the native backend; no additional wavelength points are generated.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="coating-study-csv" className="btn border border-edge" onClick={onDownloadCsv}>{zh ? '下载 CSV' : 'Download CSV'}</button>
          <button type="button" data-testid="coating-study-json" className="btn border border-edge" onClick={onDownloadJson}>{zh ? '下载研究报告 JSON' : 'Download study report JSON'}</button>
        </div>
      </div>

      <p className="text-xs text-slate-400" aria-label={zh ? '原生后端来源' : 'Native backend provenance'}>
        {zh ? '原生后端来源：' : 'Native backend provenance: '}{actualBackend || (zh ? '来源不可用' : 'provenance unavailable')}
        {jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}
      </p>

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="text-slate-400">{zh ? '波长范围' : 'Wavelength range'}: </span>{number(draft.startWavelength)}–{number(draft.stopWavelength)} nm</div>
        <div><span className="text-slate-400">{zh ? '偏振' : 'Polarization'}: </span>{input.polarization}</div>
        <div><span className="text-slate-400">{zh ? '入射角' : 'Incidence angle'}: </span>{number(input.theta)}°</div>
        <div><span className="text-slate-400">{zh ? '原生样本数' : 'Native samples'}: </span>{samples.length}</div>
      </div>

      <figure className="min-w-0">
        <svg data-testid="coating-study-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={zh ? '原生返回的波长反射、透射和吸收曲线' : 'Wavelength reflectance, transmittance, and absorptance from native returned samples'} className="h-72 w-full rounded border border-edge text-slate-400">
          {[0, 0.25, 0.5, 0.75, 1].map((value) => (
            <g key={value}>
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.2" />
              <text x={pad.left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="currentColor">{value.toFixed(2)}</text>
            </g>
          ))}
          <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="currentColor" opacity="0.5" />
          <text x={pad.left + plotWidth / 2} y={height - 8} textAnchor="middle" fontSize="12" fill="currentColor">{zh ? '波长 (nm)' : 'Wavelength (nm)'}</text>
          {curves.map((curve) => (
            <polyline
              key={curve.key}
              fill="none"
              stroke={curve.color}
              strokeWidth="2"
              points={samples.map((sample) => `${x(sample.lambda)},${y(selected(sample, curve.key))}`).join(' ')}
            />
          ))}
          {curves.map((curve) => (
            <g key={`${curve.key}-legend`} transform={`translate(${pad.left + (curve.key === 'R' ? 0 : curve.key === 'T' ? 170 : 360)},${pad.top + 2})`}>
              <line x1="0" x2="20" y1="0" y2="0" stroke={curve.color} strokeWidth="3" />
              <text x="26" y="4" fontSize="12" fill="currentColor">{curve.label}</text>
            </g>
          ))}
        </svg>
        <figcaption className="mt-1 text-xs text-slate-500">
          {zh ? '纵轴为所选偏振对应的功率系数，范围 0–1；点按原生样本顺序连接。' : 'The vertical axis shows power coefficients for the selected polarization, from 0 to 1; samples are connected in native order.'}
        </figcaption>
      </figure>

      <div className="overflow-x-auto rounded border border-edge">
        <table data-testid="coating-study-table" className="w-full min-w-[900px] text-right text-sm tabular-nums">
          <caption className="sr-only">{zh ? '原生薄膜光谱结果' : 'Native thin-film spectrum results'}</caption>
          <thead className="bg-slate-900/40 text-xs text-slate-400">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">nm</th>
              <th scope="col" className="px-3 py-2">{zh ? '所选 R' : 'Selected R'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '所选 T' : 'Selected T'}</th>
              <th scope="col" className="px-3 py-2">{zh ? '所选 A' : 'Selected A'}</th>
              {(['Rs', 'Ts', 'As', 'Rp', 'Tp', 'Ap'] as const).map((key) => <th scope="col" key={key} className="px-3 py-2">{key}</th>)}
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, index) => (
                <tr key={`${sample.lambda}-${index}`} data-testid="coating-study-row" className="border-t border-edge/60">
                <th scope="row" className="px-3 py-2 text-left font-medium">{number(sample.lambda)}</th>
                <td className="px-3 py-2">{number(selected(sample, 'R'))}</td>
                <td className="px-3 py-2">{number(selected(sample, 'T'))}</td>
                <td className="px-3 py-2">{number(selected(sample, 'A'))}</td>
                {([sample.Rs, sample.Ts, sample.As, sample.Rp, sample.Tp, sample.Ap] as const).map((value, cell) => <td key={cell} className="px-3 py-2">{number(value)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
