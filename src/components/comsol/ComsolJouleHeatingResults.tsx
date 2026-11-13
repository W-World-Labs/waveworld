import type { ComsolJouleHeatingDraft, ComsolJouleHeatingInput } from '../../lib/sim/comsol-joule-heating-input'
import type { ComsolJouleHeatingResult } from '../../lib/sim/comsol-joule-heating-result'
import { useLocale } from '../../lib/i18n'

type Props = {
  draft: ComsolJouleHeatingDraft
  input: ComsolJouleHeatingInput
  result: ComsolJouleHeatingResult
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
  return `"${String(value).replace(/"/g, '""')}"`
}

type Point = { x: number; y: number }

function ProfileChart({
  id,
  title,
  xLabel,
  yLabel,
  x,
  values,
  colorClass,
  zh,
}: {
  id: string
  title: string
  xLabel: string
  yLabel: string
  x: number[]
  values: number[]
  colorClass: string
  zh: boolean
}) {
  const finiteX = x.filter(Number.isFinite)
  const finiteY = values.filter(Number.isFinite)
  const xMin = Math.min(...finiteX)
  const xMax = Math.max(...finiteX)
  const yMin = Math.min(...finiteY)
  const yMax = Math.max(...finiteY)
  const plotLeft = 48
  const plotRight = 302
  const plotTop = 22
  const plotBottom = 146
  const points: Point[] = x.flatMap((xValue, index) => {
    const yValue = values[index]
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) return []
    const px = xMax === xMin ? (plotLeft + plotRight) / 2 : plotLeft + ((xValue - xMin) / (xMax - xMin)) * (plotRight - plotLeft)
    const py = yMax === yMin ? (plotTop + plotBottom) / 2 : plotBottom - ((yValue - yMin) / (yMax - yMin)) * (plotBottom - plotTop)
    return [{ x: px, y: py }]
  })
  const polyline = points.map(point => `${point.x},${point.y}`).join(' ')

  return (
    <figure data-testid={id} className="rounded-lg border border-edge p-3" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="font-medium text-ink">{title}</figcaption>
      <p className="mt-1 text-xs text-muted">
        {zh ? '显示求解器返回的离散样本；连线仅连接这些样本。' : 'Returned discrete samples; lines connect only those samples.'}
      </p>
      <svg role="img" aria-label={`${title}: ${yLabel} vs ${xLabel}`} viewBox="0 0 320 190" className="mt-2 h-48 w-full">
        <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} stroke="currentColor" className="text-edge" />
        <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke="currentColor" className="text-edge" />
        <text x={plotLeft - 4} y={plotTop + 4} textAnchor="end" className="fill-current text-[10px] text-muted">{format(yMax)}</text>
        <text x={plotLeft - 4} y={plotBottom} textAnchor="end" className="fill-current text-[10px] text-muted">{format(yMin)}</text>
        <text x={plotLeft} y="164" textAnchor="middle" className="fill-current text-[10px] text-muted">{format(xMin)}</text>
        <text x={plotRight} y="164" textAnchor="middle" className="fill-current text-[10px] text-muted">{format(xMax)}</text>
        <text x="174" y="184" textAnchor="middle" className="fill-current text-[10px] text-muted">{xLabel}</text>
        <text x="12" y="84" textAnchor="middle" transform="rotate(-90 12 84)" className="fill-current text-[10px] text-muted">{yLabel}</text>
        {points.length > 1 && <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="2" className={colorClass} />}
        {points.map((point, index) => <circle key={`${x[index]}-${index}`} cx={point.x} cy={point.y} r="3.5" fill="currentColor" className={colorClass} />)}
      </svg>
    </figure>
  )
}

/** Displays only validated values returned by the native DC Joule-heating operation. */
export function ComsolJouleHeatingResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const native = result.result
  const profile = native.profile
  const driveValue = draft.drive === 'current' ? `${format(draft.current)} A` : `${format(draft.voltage)} V`
  const submittedRows: Array<[string, string | number]> = [
    [zh ? '原生模块' : 'Native module', input.module],
    [zh ? '原生方法' : 'Native method', input.methodId],
    [zh ? '模式' : 'Mode', input.mode],
    [zh ? '驱动类型' : 'Drive', draft.drive],
    [zh ? '驱动值' : 'Drive value', driveValue],
    [zh ? '参考电导率 (S/m)' : 'Reference conductivity (S/m)', draft.sigma0],
    [zh ? '温度系数 (1/K)' : 'Temperature coefficient (1/K)', draft.alpha],
    [zh ? '参考温度 (K)' : 'Reference temperature (K)', draft.T_ref],
    [zh ? '热导率 (W/(m·K))' : 'Thermal conductivity (W/(m·K))', draft.k],
    [zh ? '长度 (m)' : 'Length (m)', draft.L],
    [zh ? '横截面积 (m²)' : 'Cross-sectional area (m²)', draft.area],
    [zh ? '左端温度 (K)' : 'Left boundary temperature (K)', draft.T_0],
    [zh ? '右端温度 (K)' : 'Right boundary temperature (K)', draft.T_L],
    [zh ? '提交样本数' : 'Submitted profile samples', draft.N],
  ]
  const profileRows = profile.x.map((x, index) => ({
    x,
    T: profile.T[index],
    V: profile.V[index],
    sigma: profile.sigma[index],
    E: profile.E[index],
    qDot: profile.qDot[index],
  }))
  const scopeNote = zh
    ? '此结果对应固定截面的一维稳态直流电流与传热模型，使用线性温度系数描述电导率。它不表示瞬态响应、横截面内的空间变化或更广泛的多物理场效应。'
    : 'This result represents a steady one-dimensional DC current and heat-transfer model with a fixed cross-section and a linear temperature coefficient for conductivity. It does not represent transient response, variation across the cross-section, or broader multiphysics effects.'
  const balanceRows: Array<[string, string]> = [
    [zh ? '驱动方式' : 'Drive mode', native.drive],
    [zh ? '电流' : 'Current', `${format(native.current)} A`],
    [zh ? '电压降' : 'Voltage drop', `${format(native.voltageDrop)} V`],
    [zh ? '平均电流密度' : 'Current density', `${format(native.currentDensity)} A/m²`],
    [zh ? '电阻' : 'Resistance', `${format(native.resistance)} Ω`],
    [zh ? '电功率' : 'Electrical power', `${format(native.power)} W`],
    [zh ? '焦耳热积分功率' : 'Integrated Joule generation', `${format(native.powerFromGeneration)} W`],
    [zh ? '功率残差' : 'Power residual', `${format(native.powerResidual)} W`],
    [zh ? '最大体积热源' : 'Maximum volumetric heat source', `${format(native.qDotMax)} W/m³`],
    [zh ? '平均体积热源' : 'Mean volumetric heat source', `${format(native.qDotMean)} W/m³`],
    [zh ? '体积热源积分' : 'Integrated generation per area', `${format(native.generationPerArea)} W/m²`],
    [zh ? '导热通量差' : 'Conduction per area', `${format(native.conductionPerArea)} W/m²`],
    [zh ? '能量平衡残差' : 'Energy balance residual', `${format(native.energyBalanceResidual)} W/m²`],
  ]
  const csv = [
    [zh ? '提交配置' : 'Submitted input', zh ? '值' : 'Value'],
    ...submittedRows,
    [zh ? '作业 ID' : 'Job ID', jobId || ''],
    [zh ? '后端' : 'Backend', `${result.backend.id} (${result.backend.kind})`],
    [zh ? '原生方法 ID' : 'Native method ID', native.methodId],
    [zh ? '结果族 ID' : 'Result family ID', native.familyId],
    ...balanceRows,
    [],
    ['x (m)', 'T (K)', 'V (V)', 'sigma (S/m)', 'E (V/m)', 'qDot (W/m³)'],
    ...profileRows.map(row => [row.x, row.T, row.V, row.sigma, row.E, row.qDot]),
  ].map(row => row.map(value => csvCell(value ?? '')).join(',')).join('\r\n')
  const report = {
    schemaVersion: 1,
    jobId,
    input,
    submittedDraft: draft,
    result: {
      module: input.module,
      backend: result.backend,
      result: native,
    },
    provenance: {
      module: input.module,
      methodId: native.methodId,
      familyId: native.familyId,
      backend: result.backend,
      backendKind: result.backend.kind,
      releasedPinSha: 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14',
    },
  }

  return (
    <section data-testid="comsol-joule-results" aria-labelledby="comsol-joule-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="comsol-joule-results-title" className="text-lg font-semibold text-ink">{zh ? '原生直流焦耳热结果' : 'Native DC Joule-heating results'}</h2>
          <p className="mt-1 break-all text-sm text-muted">
            {zh ? '后端：' : 'Backend: '}{result.backend.id} ({result.backend.kind}) · {result.backend.deviceName}
            {' · '}{zh ? '方法：' : 'Method: '}{native.methodId}
            {' · '}{zh ? '作业：' : 'Job: '}{jobId || (zh ? '不可用' : 'unavailable')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="comsol-joule-download-csv" className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface" onClick={() => download('comsol-joule-heating-results.csv', csv, 'text/csv;charset=utf-8')}>
            {zh ? '下载 CSV' : 'Download CSV'}
          </button>
          <button type="button" data-testid="comsol-joule-download-json" className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface" onClick={() => download('comsol-joule-heating-results.json', JSON.stringify(report, null, 2), 'application/json;charset=utf-8')}>
            {zh ? '下载 JSON' : 'Download JSON'}
          </button>
        </div>
      </div>

      <details open className="rounded-lg border border-edge p-3">
        <summary className="cursor-pointer font-medium text-ink">{zh ? '已提交输入快照' : 'Submitted input snapshot'}</summary>
        <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-muted">{zh ? '驱动' : 'Drive'}</dt><dd>{draft.drive === 'current' ? (zh ? '电流控制' : 'Current-controlled') : (zh ? '电压控制' : 'Voltage-controlled')}</dd></div>
          <div><dt className="text-muted">{zh ? '驱动值' : 'Drive value'}</dt><dd>{driveValue}</dd></div>
          <div><dt className="text-muted">{zh ? '参考电导率' : 'Reference conductivity'}</dt><dd>{format(draft.sigma0)} S/m</dd></div>
          <div><dt className="text-muted">{zh ? '电导率温度系数' : 'Conductivity temperature coefficient'}</dt><dd>{format(draft.alpha)} 1/K</dd></div>
          <div><dt className="text-muted">{zh ? '参考温度' : 'Reference temperature'}</dt><dd>{format(draft.T_ref)} K</dd></div>
          <div><dt className="text-muted">{zh ? '热导率' : 'Thermal conductivity'}</dt><dd>{format(draft.k)} W/(m·K)</dd></div>
          <div><dt className="text-muted">{zh ? '导体长度' : 'Conductor length'}</dt><dd>{format(draft.L)} m</dd></div>
          <div><dt className="text-muted">{zh ? '横截面积' : 'Cross-sectional area'}</dt><dd>{format(draft.area)} m²</dd></div>
          <div><dt className="text-muted">{zh ? '左右端温度' : 'Left / right boundary temperatures'}</dt><dd>{format(draft.T_0)} / {format(draft.T_L)} K</dd></div>
          <div><dt className="text-muted">{zh ? '请求样本数' : 'Requested samples'}</dt><dd>{draft.N}</dd></div>
        </dl>
        <p className="mt-2 break-all text-xs text-muted">{zh ? '提交标识：' : 'Submitted operation: '}{input.module} · {input.methodId} · {input.backend} · {input.mode}</p>
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileChart
          id="comsol-joule-profile-temperature"
          title={zh ? '原生温度剖面 T(x)' : 'Native temperature profile T(x)'}
          xLabel={zh ? '位置 x (m)' : 'Position x (m)'}
          yLabel={zh ? '温度 T (K)' : 'Temperature T (K)'}
          x={profile.x} values={profile.T} colorClass="text-orange-400" zh={zh}
        />
        <ProfileChart
          id="comsol-joule-profile-voltage"
          title={zh ? '原生电势剖面 V(x)' : 'Native voltage profile V(x)'}
          xLabel={zh ? '位置 x (m)' : 'Position x (m)'}
          yLabel={zh ? '电势 V (V)' : 'Voltage V (V)'}
          x={profile.x} values={profile.V} colorClass="text-cyan-400" zh={zh}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-edge">
        <table data-testid="comsol-joule-profile" className="w-full text-left text-sm">
          <caption className="px-3 py-2 text-left font-medium text-ink">{zh ? '原生返回剖面样本' : 'Native returned profile samples'}</caption>
          <thead><tr className="border-t border-edge text-muted">
            <th scope="col" className="px-3 py-2 font-medium">x (m)</th>
            <th scope="col" className="px-3 py-2 font-medium">T (K)</th>
            <th scope="col" className="px-3 py-2 font-medium">V (V)</th>
            <th scope="col" className="px-3 py-2 font-medium">σ (S/m)</th>
            <th scope="col" className="px-3 py-2 font-medium">E (V/m)</th>
            <th scope="col" className="px-3 py-2 font-medium">q̇ (W/m³)</th>
          </tr></thead>
          <tbody>{profileRows.map((row, index) => <tr key={`${row.x}-${index}`} className="border-t border-edge">
            <td data-testid="comsol-joule-x" className="px-3 py-2 text-ink">{format(row.x)}</td>
            <td data-testid="comsol-joule-T" className="px-3 py-2 text-ink">{format(row.T)}</td>
            <td data-testid="comsol-joule-V" className="px-3 py-2 text-ink">{format(row.V)}</td>
            <td className="px-3 py-2 text-ink">{format(row.sigma)}</td>
            <td className="px-3 py-2 text-ink">{format(row.E)}</td>
            <td className="px-3 py-2 text-ink">{format(row.qDot)}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div data-testid="comsol-joule-balance" className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full text-left text-sm">
          <caption className="px-3 py-2 text-left font-medium text-ink">{zh ? '原生功率与能量平衡' : 'Native power and energy balance'}</caption>
          <tbody>{balanceRows.map(([label, value]) => <tr key={label} className="border-t border-edge">
            <th scope="row" className="px-3 py-2 font-normal text-muted">{label}</th>
            <td className="px-3 py-2 text-ink">{value}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <aside className="rounded-lg border border-edge p-3 text-sm text-muted">
        <h3 className="font-medium text-ink">{zh ? '范围与限制' : 'Scope and limits'}</h3>
        <p className="mt-1">{scopeNote}</p>
        <p className="mt-1">{zh
          ? '图表和表格直接显示原生返回的离散 x、T、V 样本；连线只作视觉连接，不重算、插值或扩展空间场。'
          : 'The plots and table show the discrete x, T, and V samples returned by the native operation; lines only connect samples and do not recalculate, interpolate, or extend the fields.'}</p>
      </aside>
    </section>
  )
}

export default ComsolJouleHeatingResults
