import { useMemo, useState } from 'react'
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
import { fetchHostJobResult, getStoredUserToken, hostApiBase, type HostJobDetail } from '../../lib/hostApi'
import { downloadThermalFieldArtifact, downloadThermalKpiSummaryArtifact, exportThermalFieldDirectory, type ThermalFieldDownload, type ThermalKpiSummaryDownload } from '../../../apps/lab/src/lib/w-sim/thermal-field-artifact'
import { isFrameExportSupported } from '../../../apps/lab/src/lib/cfd/frame-export'

type LoadedField = { field: ThermalFieldDownload; kpi?: ThermalKpiSummaryDownload; spec: JobSpecV1; result: JobResultV1 }

const steadyFaceHeatFlows = [
  ['heatFlowLeftW', '左面', 'Left face'],
  ['heatFlowRightW', '右面', 'Right face'],
  ['heatFlowBottomW', '底面', 'Bottom face'],
  ['heatFlowTopW', '顶面', 'Top face'],
  ['heatFlowFrontW', '前面', 'Front face'],
  ['heatFlowBackW', '后面', 'Back face'],
] as const
const couplingMetrics = [
  ['temperatureChangeC', '温度变化', 'Temperature change', '°C'],
  ['relativePowerChange', '损耗相对变化', 'Relative loss change', ''],
  ['residual', '温度场更新残差', 'Thermal-field update residual', '°C'],
  ['energyImbalance', '能量不平衡', 'Energy imbalance', 'W'],
] as const

function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function igbtSpatialSpec(spec: JobSpecV1): boolean {
  const parameters = spec.parameters as Record<string, unknown>
  return spec.kind === 'electro-thermal-igbt' && parameters.mode === 'spatial-chip' && parameters.dimension === 3
}
function orderedIgbtDieIds(result: JobResultV1): string[] {
  const ids = (result.derived as Record<string, unknown> | undefined)?.igbtDieIds
  if (typeof ids !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(ids)
    return Array.isArray(parsed) && parsed.every(id => typeof id === 'string') ? parsed : []
  } catch { return [] }
}
function displayNumber(value: number): string { return Number(value.toPrecision(6)).toLocaleString(undefined, { maximumSignificantDigits: 6 }) }

/** Read the persisted field; opening this panel never submits or recomputes a job. */
export function ThermalFieldResult({ job, zh }: { job: HostJobDetail; zh: boolean }) {
  const [loaded, setLoaded] = useState<LoadedField | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exported, setExported] = useState(false)
  const format = (job.result?.derived as Record<string, unknown> | undefined)?.fieldFormat
  const temperatureRange = useMemo(() => {
    if (!loaded) return null
    let min = Infinity, max = -Infinity
    for (const value of loaded.field.values) { min = Math.min(min, value); max = Math.max(max, value) }
    return { min, max }
  }, [loaded])
  const steadySummary = loaded?.kpi?.summary
  const steadyMethod = steadySummary?.method === 'thermal-steady-fv-regions-v1'
    ? (zh ? '稳态材料区域（有限体积）' : 'Regional finite-volume steady state')
    : steadySummary?.method === 'thermal-steady-fd-gs-v1'
      ? (zh ? '均匀材料稳态' : 'Uniform-material steady state')
      : steadySummary?.method === 'thermal-igbt-spatial-chip-v1'
        ? (zh ? '空间电热芯片模型' : 'Spatial electro-thermal chip model')
        : typeof steadySummary?.method === 'string' ? steadySummary.method : undefined
  const faceHeatFlows = steadyFaceHeatFlows.filter(([key]) => finiteNumber(steadySummary?.[key]))
  const spatialIgbt = loaded ? igbtSpatialSpec(loaded.spec) && steadySummary?.method === 'thermal-igbt-spatial-chip-v1' : false
  const igbtDieIds = spatialIgbt && loaded ? orderedIgbtDieIds(loaded.result) : []
  async function readField(): Promise<LoadedField> {
    if (loaded) return loaded
    const saved = await fetchHostJobResult(job.id)
    if (saved.jobId !== job.id || saved.status !== 'succeeded' || (job.specFingerprint && saved.specFingerprint !== job.specFingerprint)) throw new Error(zh ? '已保存结果与任务不匹配' : 'Saved result does not match this job')
    const result = saved.result as unknown as JobResultV1, spec = job.spec as unknown as JobSpecV1
    const steady3d = spec.kind === 'thermal-3d-steady' && (spec.parameters as Record<string, unknown>).dimension === 3
    const spatial = igbtSpatialSpec(spec)
    const fieldRefs = result.artifacts?.filter(a => a.kind === 'thermal-temperature-field' && a.artifactId === result.derived?.fieldArtifactId) ?? []
    const ref = fieldRefs.length === 1 ? fieldRefs[0] : undefined
    const meta = ref && saved.artifacts.find(a => a.id === ref.artifactId)
    if (!ref || !meta || meta.jobId !== job.id || meta.kind !== ref.kind || meta.bytes !== ref.bytes || meta.contentType !== ref.contentType || typeof meta.sha256 !== 'string') throw new Error(zh ? '任务缺少完整温度场文件' : 'The complete temperature field is missing')
    const token = getStoredUserToken()
    const field = await downloadThermalFieldArtifact({ baseUrl: hostApiBase(), jobId: job.id,
      artifact: ref, expectedSha256: meta.sha256, spec, result, signal: AbortSignal.timeout(30_000),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined })
    let kpi: ThermalKpiSummaryDownload | undefined
    if (steady3d || spatial) {
      const kpiRefs = result.artifacts?.filter(a => a.kind === 'thermal-kpi-summary') ?? []
      const kpiRef = kpiRefs.length === 1 ? kpiRefs[0] : undefined
      const kpiMeta = kpiRef && saved.artifacts.find(a => a.id === kpiRef.artifactId)
      if (!kpiRef || !kpiMeta || kpiMeta.jobId !== job.id || kpiMeta.kind !== kpiRef.kind || kpiMeta.bytes !== kpiRef.bytes || kpiMeta.contentType !== kpiRef.contentType || typeof kpiMeta.sha256 !== 'string') throw new Error(zh ? '任务缺少完整稳态 KPI 文件' : 'The saved steady KPI summary is missing')
      kpi = await downloadThermalKpiSummaryArtifact({ baseUrl: hostApiBase(), jobId: job.id,
        artifact: kpiRef, expectedSha256: kpiMeta.sha256, spec, result, signal: AbortSignal.timeout(30_000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined })
    }
    const value = { field, ...(kpi ? { kpi } : {}), spec, result }
    setLoaded(value)
    return value
  }
  async function act(exportFiles: boolean) {
    setBusy(true); setError(null); setExported(false)
    try {
      // Directory selection must occur during the user gesture, before downloading.
      const dir = exportFiles ? await window.showDirectoryPicker!({ mode: 'readwrite' }) : null
      const value = await readField()
      if (dir) {
        await exportThermalFieldDirectory({ dir, runName: `thermal-${job.id}`, ...value, signal: AbortSignal.timeout(30_000) })
        setExported(true)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-3 rounded-xl border border-edge p-4" aria-label={zh ? '完整温度场' : 'Complete temperature field'}>
    <h4 className="text-sm text-slate-200">{zh ? '完整温度场' : 'Complete temperature field'}</h4>
    {format !== 'float64-le-x-fastest-v1' ? <p className="text-sm text-slate-400">{zh ? '此结果未保存可校验的完整温度场。' : 'This result did not save a verifiable complete temperature field.'}</p> : <>
      <p className="text-sm text-slate-400">{job.kind === 'electro-thermal-igbt'
        ? (zh ? '读取已保存的空间温度场与电热汇总；导出保留场数据、完整KPI、参数、结果和校验清单。' : 'Read the saved spatial temperature field and electro-thermal summary. Export preserves the field, complete KPI summary, inputs, result and integrity manifest.')
        : job.kind === 'thermal-3d-steady'
          ? (zh ? '读取已保存的三维温度节点与 KPI JSON；导出同时包含场数据、KPI、参数、结果和校验清单。' : 'Read the saved 3D temperature field and KPI JSON. Export includes both artifacts, inputs, result and an integrity manifest.')
        : (zh ? '读取已保存的全部节点；导出包含温度场、参数、结果和校验清单。' : 'Read every saved node. Export includes the field, inputs, result and integrity manifest.')}</p>
      <button className="btn mr-2 border border-edge disabled:opacity-50" disabled={busy} onClick={() => void act(false)}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '读取完整温度场' : 'Read complete field')}</button>
      <button className="btn border border-edge disabled:opacity-50" disabled={busy || !isFrameExportSupported()} onClick={() => void act(true)}>{zh ? '导出完整温度场' : 'Export complete field'}</button>
      {!isFrameExportSupported() && <p className="text-xs text-slate-400">{zh ? '目录导出需要支持本地目录写入的浏览器，如 Chrome 或 Edge。' : 'Directory export requires a browser with local directory support, such as Chrome or Edge.'}</p>}
      {loaded && <div role="status" className="space-y-1 text-sm text-slate-300">
        <p>{zh ? '已校验' : 'Verified'} {loaded.field.nx} × {loaded.field.ny} × {loaded.field.nz} · {loaded.field.values.length} {zh ? '个节点' : 'nodes'} · {loaded.field.unit} · {zh ? '温度范围' : 'temperature range'} {temperatureRange?.min.toPrecision(6)}–{temperatureRange?.max.toPrecision(6)} {loaded.field.unit}{exported && (zh ? ' · 已导出' : ' · Exported')}</p>
        {spatialIgbt && <p>{zh ? '计算域尺寸' : 'Domain size'} · {displayNumber(loaded.field.lengthX!)} × {displayNumber(loaded.field.lengthY!)} × {displayNumber(loaded.field.lengthZ!)} {loaded.field.lengthUnit}</p>}
        <p>{zh ? '输入摘要' : 'Input digest'} · {loaded.field.inputDigest ?? (zh ? '旧结果未保存' : 'not saved by this legacy result')}</p>
        {loaded.kpi && <p>{zh ? '已校验保存的 KPI 摘要' : 'Saved KPI summary verified'} · {loaded.kpi.inputDigest}</p>}
        {loaded.kpi && steadyMethod && <p>{zh ? '方法' : 'Method'} · {steadyMethod}</p>}
        {spatialIgbt && steadySummary && <>
          {igbtDieIds.map((id, index) => {
            const metric = (suffix: string) => steadySummary[`die${index}${suffix}`]
            const pairs = [
              ['结温均值', 'Junction mean', 'JunctionMeanC', '°C'],
              ['结温最低值', 'Junction minimum', 'JunctionMinC', '°C'],
              ['结温最高值', 'Junction maximum', 'JunctionMaxC', '°C'],
              ['损耗评估温度', 'Loss evaluation temperature', 'LossEvaluationTempC', '°C'],
              ['本轮已使用总损耗', 'Loss used this coupling iteration', 'TotalLossW', 'W'],
              ['当前温度重新评估总损耗', 'Loss reevaluated at current temperature', 'EvaluatedLossW', 'W'],
            ] as const
            return <div key={`${id}-${index}`} className="rounded-lg bg-edge/30 p-3">
              <p className="font-medium">{zh ? '器件' : 'Die'} · {id}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {pairs.map(([zhLabel, enLabel, suffix, unit]) => finiteNumber(metric(suffix)) && <div key={suffix} className="flex justify-between gap-2">
                  <dt>{zh ? zhLabel : enLabel}</dt><dd>{displayNumber(metric(suffix) as number)} {unit}</dd>
                </div>)}
              </dl>
            </div>
          })}
          <p>{zh ? '耦合变化量与热平衡' : 'Coupling changes and heat balance'}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {couplingMetrics.map(([key, zhLabel, enLabel, unit]) => finiteNumber(steadySummary[key]) && <div key={key} className="flex justify-between gap-2">
              <dt>{zh ? zhLabel : enLabel}</dt><dd>{displayNumber(steadySummary[key] as number)}{unit ? ` ${unit}` : ''}</dd>
            </div>)}
          </dl>
        </>}
        {loaded.kpi && faceHeatFlows.length > 0 && <>
          <p>{zh ? '热流正值表示流入计算域，负值表示流出（W）。' : 'Positive heat flow enters the domain; negative heat flow leaves it (W).'}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {faceHeatFlows.map(([key, zhLabel, enLabel]) => <div key={key} className="flex justify-between gap-2">
              <dt>{zh ? zhLabel : enLabel}</dt><dd>{String(steadySummary?.[key])} W</dd>
            </div>)}
          </dl>
        </>}
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </div>
}
