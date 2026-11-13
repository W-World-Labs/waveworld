import { useLocale } from '../../lib/i18n'

export type ComsolMaterialTableSnapshot = {
  propertyKind: string
  propertyUnit: string
  rows: ReadonlyArray<{ temperatureK: number; value: number }>
  temperatureK: number
  interpolation: string
  extrapolation: string
  sourceCsv?: string
  nativeInput?: unknown
  jobId?: string | null
}

type Props = {
  snapshot: ComsolMaterialTableSnapshot
  /** Native operation response. It is deliberately validated at this display boundary. */
  result: unknown
}

type NativeResult = { value: number; derivative: number; temperature: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSnapshot(value: unknown): value is ComsolMaterialTableSnapshot {
  if (!isRecord(value) || typeof value.propertyKind !== 'string' || typeof value.propertyUnit !== 'string' ||
      typeof value.temperatureK !== 'number' || !Number.isFinite(value.temperatureK) ||
      typeof value.interpolation !== 'string' || typeof value.extrapolation !== 'string' ||
      !Array.isArray(value.rows)) return false
  return value.rows.every((knot) => isRecord(knot) && typeof knot.temperatureK === 'number' && Number.isFinite(knot.temperatureK) &&
    typeof knot.value === 'number' && Number.isFinite(knot.value))
}

function validateResult(payload: unknown, snapshot: ComsolMaterialTableSnapshot): NativeResult | 'unsupported' | null {
  if (!isRecord(payload)) return null
  if (payload.status === 'unsupported' || payload.supported === false) return 'unsupported'
  const value = isRecord(payload.moduleResult) ? payload.moduleResult : payload
  const native = isRecord(value.result) ? value.result : value
  if (native.status === 'unsupported' || native.supported === false) return 'unsupported'
  const expectedMethod = snapshot.interpolation === 'linear'
    ? 'method-algo-piecewise-linear'
    : snapshot.interpolation === 'pchip' ? 'method-algo-piecewise-cubic' : null
  if (native.ok !== true || native.methodId !== expectedMethod || native.extrapolation !== snapshot.extrapolation ||
      typeof native.value !== 'number' || !Number.isFinite(native.value) || native.value <= 0 ||
      typeof native.derivative !== 'number' || !Number.isFinite(native.derivative) ||
      typeof native.temperature !== 'number' || !Number.isFinite(native.temperature) || native.temperature !== snapshot.temperatureK) return null
  return { value: native.value, derivative: native.derivative, temperature: native.temperature }
}

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '—'
}

function downloadSnapshot(snapshot: unknown, result: unknown): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return
  const url = URL.createObjectURL(new Blob([JSON.stringify({ snapshot, result }, null, 2)], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'comsol-material-table-result.json'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Displays submitted material-table knots with values returned by the native operation. */
export function ComsolMaterialTableResults({ snapshot, result }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const validSnapshot = isSnapshot(snapshot)
  const native = validateResult(result, snapshot)
  const unsupported = native === 'unsupported'

  return (
    <section data-testid="comsol-material-table-results" aria-labelledby="comsol-material-table-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="comsol-material-table-results-title" className="text-lg font-semibold text-ink">{zh ? '材料表原生结果' : 'Native material-table result'}</h2>
          <p className="mt-1 text-sm text-muted">{zh ? '显示提交的材料表和原生操作返回的评估值与导数。' : 'Submitted material table alongside the property and derivative returned by the native operation.'}</p>
        </div>
        <button type="button" data-testid="comsol-material-table-download-json" className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface" onClick={() => downloadSnapshot(snapshot, result)}>
          {zh ? '下载 JSON 快照' : 'Download JSON snapshot'}
        </button>
      </div>

      {!validSnapshot ? (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-ink">{zh ? '提交快照无效，无法显示材料表。' : 'Invalid submitted snapshot; the material table cannot be displayed.'}</p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-edge p-3"><dt className="text-sm text-muted">{zh ? '属性' : 'Property'}</dt><dd className="mt-1 font-medium text-ink">{snapshot.propertyKind} ({snapshot.propertyUnit || (zh ? '无单位' : 'unitless')})</dd></div>
            <div className="rounded-lg border border-edge p-3"><dt className="text-sm text-muted">{zh ? '评估温度' : 'Evaluation temperature'}</dt><dd className="mt-1 font-medium text-ink">{format(snapshot.temperatureK)} K</dd></div>
            <div className="rounded-lg border border-edge p-3"><dt className="text-sm text-muted">{zh ? '插值 / 外推' : 'Interpolation / extrapolation'}</dt><dd className="mt-1 font-medium text-ink">{snapshot.interpolation} / {snapshot.extrapolation}</dd></div>
          </dl>

          {unsupported ? (
            <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-ink">{zh ? '原生操作明确报告此材料表不受支持。' : 'The native operation explicitly reported this material table as unsupported.'}</p>
          ) : native === null ? (
            <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-ink">{zh ? '原生输出无效或格式不受支持；未显示数值。' : 'Invalid or unsupported native output; no result values are displayed.'}</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-edge p-3"><dt className="text-sm text-muted">{zh ? '原生返回属性值' : 'Native returned property'}</dt><dd className="mt-1 font-mono font-semibold text-ink">{format(native.value)} {snapshot.propertyUnit}</dd><dd className="text-xs text-muted">{zh ? '返回温度' : 'Returned temperature'}: {format(native.temperature)} K</dd></div>
              <div className="rounded-lg border border-edge p-3"><dt className="text-sm text-muted">{zh ? '原生返回温度导数' : 'Native returned temperature derivative'}</dt><dd className="mt-1 font-mono font-semibold text-ink">{format(native.derivative)} {snapshot.propertyUnit}/K</dd></div>
            </dl>
          )}

          <div className="overflow-x-auto rounded-lg border border-edge">
            <table className="w-full text-left text-sm">
              <caption className="px-3 py-2 text-left font-medium text-ink">{zh ? '已提交的原始温度节点' : 'Original submitted temperature knots'}</caption>
              <thead className="bg-surface text-muted"><tr><th scope="col" className="px-3 py-2 font-medium">{zh ? '温度 (K)' : 'Temperature (K)'}</th><th scope="col" className="px-3 py-2 font-medium">{snapshot.propertyKind} ({snapshot.propertyUnit})</th></tr></thead>
              <tbody>{snapshot.rows.map((knot, index) => <tr key={`${knot.temperatureK}-${index}`} className="border-t border-edge"><td className="px-3 py-2 font-mono text-ink">{format(knot.temperatureK)}</td><td className="px-3 py-2 font-mono text-ink">{format(knot.value)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted">{zh ? '节点按提交顺序原样显示；界面不会执行插值或计算导数。' : 'Knots are shown in submitted order; this view does not interpolate or calculate derivatives.'}</p>
        </>
      )}
    </section>
  )
}
