import type { LensStudyDraft, LensTraceInput } from '../../lib/sim/lens-study-input'
import type { LensStudyResult } from '../../lib/sim/lens-study-result'
import { buildLensRayCsv, buildLensStudyReport } from '../../lib/sim/lens-study-export'
import { useLocale } from '../../lib/i18n'
import { LensRayTable } from './LensRayTable'

type Props = {
  draft: LensStudyDraft
  input: LensTraceInput
  result: LensStudyResult
  jobId: string | null
}

const width = 640
const height = 360
const pad = 44

function number(value: number, digits = 6): string {
  return Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : '—'
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function backendLabel(backend: Record<string, unknown>): string {
  return Object.entries(backend)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ')
}

/** Displays native image-plane spots and returned metrics from the submitted snapshot. */
export function LensStudyResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const spots = result.rays.flatMap((ray, index) =>
    ray.status === 'ok' && ray.imageSpot && ray.imageSpot.every(Number.isFinite)
      ? [{ index, x: ray.imageSpot[0], y: ray.imageSpot[1] }]
      : [],
  )

  // A shared symmetric extent gives x and y the same physical mm-per-pixel scale.
  const extent = spots.reduce((max, spot) => Math.max(max, Math.abs(spot.x), Math.abs(spot.y)), result.imageCentroid
    ? Math.max(Math.abs(result.imageCentroid[0]), Math.abs(result.imageCentroid[1]))
    : 0)
  const scaleExtent = extent > 0 ? extent * 1.12 : 1
  const plotSize = Math.min(width - pad * 2, height - pad * 2)
  const centerX = width / 2
  const centerY = height / 2
  const coordX = (value: number) => centerX + value / scaleExtent * plotSize / 2
  const coordY = (value: number) => centerY - value / scaleExtent * plotSize / 2
  const actualBackend = backendLabel(result.backend)
  const statusCounts = result.rays.reduce<Record<string, number>>((counts, ray) => {
    counts[ray.status] = (counts[ray.status] ?? 0) + 1
    return counts
  }, {})

  return (
    <section data-testid="lens-study-results" aria-labelledby="lens-study-results-title" className="mt-6 space-y-4 rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="lens-study-results-title" className="text-lg font-semibold">{zh ? '聚焦处方结果' : 'Lens study results'}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {zh ? '等权重有限光线束的几何追迹；图中只显示原生返回的有效像点。' : 'Geometric trace of an equally weighted finite ray bundle; only native successful image spots are plotted.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="lens-rays-csv" className="btn border border-edge" onClick={() => download('waveworld-lens-rays.csv', buildLensRayCsv(input, result), 'text/csv;charset=utf-8')}>
            {zh ? '下载光线 CSV' : 'Download rays CSV'}
          </button>
          <button type="button" data-testid="lens-study-report" className="btn border border-edge" onClick={() => download('waveworld-lens-study.json', buildLensStudyReport(draft, input, result, jobId), 'application/json;charset=utf-8')}>
            {zh ? '下载研究报告 JSON' : 'Download study report JSON'}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400" aria-label={zh ? '原生后端来源' : 'Native backend provenance'}>
        {zh ? '实际后端：' : 'Actual backend: '}{actualBackend || (zh ? '来源不可用' : 'provenance unavailable')}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <figure className="min-w-0">
          <svg data-testid="lens-spot-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={zh ? '像面有效光线散点图，x 和 y 使用相同毫米比例' : 'Image-plane successful-ray scatter plot with equal x and y millimeter scale'} className="h-72 w-full rounded border border-edge text-slate-400">
            <rect x={centerX - plotSize / 2} y={centerY - plotSize / 2} width={plotSize} height={plotSize} fill="none" stroke="currentColor" opacity="0.25" />
            <line x1={centerX - plotSize / 2} x2={centerX + plotSize / 2} y1={centerY} y2={centerY} stroke="currentColor" opacity="0.35" />
            <line x1={centerX} x2={centerX} y1={centerY - plotSize / 2} y2={centerY + plotSize / 2} stroke="currentColor" opacity="0.35" />
            <text x={centerX} y={height - 8} textAnchor="middle" fontSize="12" fill="currentColor">x (mm)</text>
            <text x="14" y={centerY} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 14 ${centerY})`}>y (mm)</text>
            {spots.map((spot) => (
              <circle key={spot.index} cx={coordX(spot.x)} cy={coordY(spot.y)} r="4" fill="#38bdf8">
                <title>{`Ray ${spot.index + 1}: (${number(spot.x)}, ${number(spot.y)}) mm`}</title>
              </circle>
            ))}
            {result.imageCentroid && result.imageCentroid.every(Number.isFinite) && (
              <g aria-label={zh ? '原生像点质心' : 'Native image centroid'}>
                <line x1={coordX(result.imageCentroid[0]) - 7} x2={coordX(result.imageCentroid[0]) + 7} y1={coordY(result.imageCentroid[1])} y2={coordY(result.imageCentroid[1])} stroke="#fb923c" strokeWidth="2" />
                <line x1={coordX(result.imageCentroid[0])} x2={coordX(result.imageCentroid[0])} y1={coordY(result.imageCentroid[1]) - 7} y2={coordY(result.imageCentroid[1]) + 7} stroke="#fb923c" strokeWidth="2" />
              </g>
            )}
          </svg>
          <figcaption className="mt-1 text-xs text-slate-500">
            {zh ? '坐标单位为 mm；横纵轴采用相同物理比例。橙色十字为原生质心。' : 'Coordinates are in mm with the same physical scale on both axes. The orange cross is the native centroid.'}
          </figcaption>
        </figure>

        <dl className="grid content-start grid-cols-1 gap-3 text-sm">
          <div className="rounded border border-edge p-3">
            <dt className="text-slate-400">{zh ? '有效像点' : 'Valid image spots'}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{result.validSpotCount} / {input.rays.length}</dd>
          </div>
          <div className="rounded border border-edge p-3">
            <dt className="text-slate-400">{zh ? '像点质心 (mm)' : 'Image centroid (mm)'}</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {result.imageCentroid ? `(${number(result.imageCentroid[0])}, ${number(result.imageCentroid[1])})` : '—'}
            </dd>
          </div>
          <div className="rounded border border-edge p-3">
            <dt className="text-slate-400">{zh ? '均方根半径 (mm)' : 'RMS radius (mm)'}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{result.imageRmsRadius === null ? '—' : number(result.imageRmsRadius)}</dd>
          </div>
          <div className="rounded border border-edge p-3">
            <dt className="text-slate-400">{zh ? '光线状态计数' : 'Ray status counts'}</dt>
            <dd className="mt-1 space-y-1 tabular-nums">
              {Object.entries(statusCounts).map(([status, count]) => <div key={status}>{status}: {count}</div>)}
            </dd>
          </div>
        </dl>
      </div>

      {result.validSpotCount === 0 && (
        <p role="status" className="rounded border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {zh ? '没有有效像点；质心和 RMS 半径未定义。' : 'No valid image spots; centroid and RMS radius are undefined.'}
        </p>
      )}

      <LensRayTable result={result} />
    </section>
  )
}
