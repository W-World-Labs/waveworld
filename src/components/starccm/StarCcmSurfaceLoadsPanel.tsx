import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleComputeContext, useModuleCompute } from '../../lib/hooks/useModuleCompute'
import { useLocale } from '../../lib/i18n'
import type { ModuleComputeOutput } from '../../lib/sim/module-compute'
import { buildStarCcmSurfaceLoadsInput, createStarCcmSurfaceLoadsReport, createStarCcmSurfaceLoadsSummaryCsv, STAR_CCM_SURFACE_LOADS_MAX_INPUT_BYTES, type StarCcmSurfaceLoadsInput, type StarCcmSurfaceLoadsSettings } from '../../lib/star-ccm-surface-loads'
import { parseStarCcmSurfaceLoadsCsv, STAR_CCM_SURFACE_LOADS_CSV_COLUMNS, STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES, STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS, type StarCcmSurfaceLoadRow } from '../../lib/star-ccm-surface-loads-csv'

const SAMPLE_CSV = `${STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.join(',')}\r\n1,0,0,1,100000,0,0,0,0,0,0\r\n`
const FALLBACK_INPUT: StarCcmSurfaceLoadsInput = {
  module: 'sw-su2-force-coeffs-b', backend: 'host', method: 'surface', dimension: 3,
  rhoFreestream: 1, velocityFreestream: 1, refArea: 1, refLength: 1,
  refOriginMoment: [0, 0, 0], aoa: 0, sideslip: 0,
  faces: [{ areaX: 1, areaY: 0, areaZ: 0, pressure: 0, tauX: 0, tauY: 0, tauZ: 0, x: 0, y: 0, z: 0 }],
}
const DEFAULT_FIELDS = {
  pressureReferencePa: '0', rhoFreestream: '1.225', velocityFreestream: '100',
  refArea: '1', refLength: '1', dimension: '3', originX: '0', originY: '0', originZ: '0', aoa: '0', sideslip: '0',
}

type Fields = typeof DEFAULT_FIELDS
type SavedReport = { input: StarCcmSurfaceLoadsInput; rows: StarCcmSurfaceLoadRow[]; sourceCsv: string; settings: StarCcmSurfaceLoadsSettings; output: ModuleComputeOutput; jobId: string }

function numberField(fields: Fields, key: keyof Fields): number | null {
  const value = fields[key].trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function settingsFromFields(fields: Fields): StarCcmSurfaceLoadsSettings | null {
  const keys = ['pressureReferencePa', 'rhoFreestream', 'velocityFreestream', 'refArea', 'refLength', 'originX', 'originY', 'originZ', 'aoa', 'sideslip'] as const
  const values = Object.fromEntries(keys.map(key => [key, numberField(fields, key)])) as Record<typeof keys[number], number | null>
  if (Object.values(values).some(value => value === null)) return null
  const { pressureReferencePa, rhoFreestream, velocityFreestream, refArea, refLength, originX, originY, originZ, aoa, sideslip } = values as Record<typeof keys[number], number>
  const dimension = fields.dimension === '2' ? 2 : fields.dimension === '3' ? 3 : null
  if (!dimension || rhoFreestream <= 0 || velocityFreestream <= 0 || refArea <= 0 || refLength <= 0) return null
  return { pressureReferencePa, rhoFreestream, velocityFreestream, refArea, refLength, dimension, refOriginMoment: [originX, originY, originZ], aoa, sideslip }
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function surfaceResultRows(output: ModuleComputeOutput): Array<{ metric: string; value: string; unit: string }> {
  const result = (output as unknown as Record<string, unknown>).result
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const values = result as Record<string, unknown>
  const rows: Array<{ metric: string; value: string; unit: string }> = []
  const vectors: Array<[string, string, string]> = [
    ['pressureForce', 'Pressure force', 'N'], ['viscousForce', 'Viscous force', 'N'], ['force', 'Total force', 'N'], ['moment', 'Moment about reference origin', 'N·m'],
  ]
  for (const [field, label, unit] of vectors) {
    const vector = values[field]
    if (!vector || typeof vector !== 'object' || Array.isArray(vector)) continue
    for (const axis of ['x', 'y', 'z']) {
      const value = (vector as Record<string, unknown>)[axis]
      if (typeof value === 'number' && Number.isFinite(value)) rows.push({ metric: `${label} ${axis.toUpperCase()}`, value: String(value), unit })
    }
  }
  for (const key of ['CFx', 'CFy', 'CFz', 'CD', 'CL', 'CSF', 'CSide', 'CMx', 'CMy', 'CMz', 'CEff', 'faceCount']) {
    const value = values[key]
    if (typeof value === 'number' && Number.isFinite(value)) rows.push({ metric: key, value: String(value), unit: key === 'faceCount' ? 'faces' : '—' })
  }
  return rows
}

export function StarCcmSurfaceLoadsPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [csv, setCsv] = useState('')
  const [rows, setRows] = useState<StarCcmSurfaceLoadRow[] | null>(null)
  const [fields, setFields] = useState<Fields>(DEFAULT_FIELDS)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedReport | null>(null)
  const pending = useRef<{ input: string; sourceCsv: string; rows: StarCcmSurfaceLoadRow[]; settings: StarCcmSurfaceLoadsSettings } | null>(null)
  const settings = useMemo(() => settingsFromFields(fields), [fields])
  const parsedInput = useMemo(() => {
    if (!rows || !settings) return null
    if (settings.dimension === 2 && (settings.refOriginMoment[2] !== 0 || rows.some(row => row.areaZ_m2 !== 0 || row.shearForceZ_N !== 0 || row.centroidZ_m !== 0))) return null
    try {
      const input = buildStarCcmSurfaceLoadsInput(rows, settings)
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > STAR_CCM_SURFACE_LOADS_MAX_INPUT_BYTES) return null
      return input
    } catch { return null }
  }, [rows, settings])
  const compute = useModuleCompute(parsedInput ?? FALLBACK_INPUT, () => parsedInput ?? FALLBACK_INPUT)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  useEffect(() => {
    const submission = pending.current
    if (execution?.status === 'succeeded' && compute.result && compute.submittedInput && execution.jobId && submission) {
      if (JSON.stringify(compute.submittedInput) !== submission.input) return
      const output = compute.result as ModuleComputeOutput
      const input = compute.submittedInput as StarCcmSurfaceLoadsInput
      setSaved({ input, rows: submission.rows, sourceCsv: submission.sourceCsv, settings: submission.settings, output, jobId: execution.jobId })
      setNotice(zh ? `已保存 Host 任务 ${execution.jobId} 的载荷报告。` : `Saved surface-load report from Host job ${execution.jobId}.`)
      pending.current = null
    }
    if (execution?.status === 'failed' || execution?.status === 'cancelled') pending.current = null
  }, [compute.result, compute.submittedInput, execution?.jobId, execution?.status, zh])

  const parseCsv = (value: string) => {
    setCsv(value)
    setRows(null)
    setError('')
    setNotice('')
    try {
      const parsed = parseStarCcmSurfaceLoadsCsv(value)
      setRows(parsed)
      setNotice(zh ? `已读取 ${parsed.length} 个面样本。` : `Loaded ${parsed.length} face samples.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onFile = async (file?: File) => {
    if (!file) return
    if (file.size > STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES) {
      parseCsv('')
      setError(zh ? 'CSV 超过 512 KiB 限制。' : 'CSV exceeds the 512 KiB limit.')
      return
    }
    parseCsv(await file.text())
  }

  const submit = () => {
    if (!parsedInput || !rows || !settings || !execution || execution.target !== 'backend' || !execution.connected || execution.busy || execution.cancelPending) return
    pending.current = { input: JSON.stringify(parsedInput), sourceCsv: csv, rows, settings }
    setSaved(null)
    setNotice('')
    void execution.start(true)
  }

  return <section className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-label={zh ? '表面载荷报告' : 'Surface-load report'}>
    <div>
      <h2 className="font-semibold">{zh ? '导入表面压力与剪切力' : 'Imported surface pressure and shear loads'}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-300">{zh
        ? '导入有界的应用自定义 CSV，提交所选面的采样值到现有 W-Sim sw-su2-force-coeffs-b method=surface Host 操作。计算只在原生任务中进行。'
        : 'Import a bounded app-defined CSV and submit selected surface samples to the existing W-Sim sw-su2-force-coeffs-b method=surface Host operation. Integration runs in the native job.'}</p>
    </div>
    <div className="rounded border border-edge bg-slate-950/50 p-3 text-xs leading-relaxed text-slate-300">
      <p>{zh ? '这不是 STAR-CCM+ 导出格式或 .sim 导入器。面积向量为已定向的 Cartesian 面积向量 (m²)，压力载荷为 −(p −参考压力)×面积向量。剪切列是每个面已经积分的 Cartesian 力分量 (N)，会直接作为黏性力传递，不会再次乘面积。质心、力矩原点使用同一坐标系，长度单位为 m。' : 'This is not a STAR-CCM+ export format or .sim importer. Area components are oriented Cartesian area vectors (m²); pressure load is −(p − reference pressure) × area vector. Shear columns are already integrated Cartesian force components per face (N), passed through as viscous force without another area multiplication. Centroids and moment origin share a Cartesian frame in m.'}</p>
      <p className="mt-1 text-slate-400">{zh ? '法向方向会改变压力力符号；开放表面的压力参考值相当于背面压力。参考压力差、面积/法向方向、剪切力符号、力矩原点和系数参考量由调用者负责。' : 'Normal direction changes the pressure-force sign. On an open surface, the pressure reference acts like backside pressure. The caller is responsible for the pressure difference, area/normal orientation, shear-force sign, moment origin, and coefficient reference values.'}</p>
    </div>
    <div className="space-y-2 rounded border border-edge p-3 text-xs text-slate-300">
      <p className="font-medium">{zh ? '固定列格式' : 'Fixed column format'}</p>
      <code className="block break-all font-mono">{STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.join(',')}</code>
      <p>{zh ? '严格 UTF-8 CSV；列顺序不可变。限制：512 KiB、5,000 个面。数值不得缺失或非有限；faceId 必须唯一且为正整数。2D 模式只接受 XY 平面数据，所有 Z 面积/力/质心分量及原点 Z 必须为 0。' : 'Strict UTF-8 CSV with fixed column order. Limits: 512 KiB and 5,000 faces. Values must be present and finite; faceId must be a unique positive integer. 2D mode is restricted to the XY plane: all Z area, force, centroid, and origin components must be zero.'}</p>
      <button type="button" className="underline" onClick={() => download('waveworld-surface-load-sample.csv', SAMPLE_CSV, 'text/csv;charset=utf-8')}>{zh ? '下载 CSV 样例' : 'Download sample CSV'}</button>
    </div>
    <label className="block text-sm text-slate-300">{zh ? '选择 CSV 文件' : 'Choose CSV file'}
      <input type="file" accept=".csv,text/csv" disabled={execution?.busy} onChange={event => { void onFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border file:border-edge file:bg-surface file:px-3 file:py-2" />
    </label>
    <label className="block text-sm text-slate-300">{zh ? '或粘贴 CSV 文本' : 'Or paste CSV text'}
      <textarea aria-label={zh ? '粘贴表面载荷 CSV' : 'Paste surface-load CSV'} value={csv} disabled={execution?.busy} onChange={event => parseCsv(event.currentTarget.value)} spellCheck={false} rows={6} className="mt-1 block w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100" />
    </label>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-slate-300">{zh ? '压力参考值 (Pa)' : 'Pressure reference (Pa)'}<input type="number" step="any" value={fields.pressureReferencePa} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, pressureReferencePa: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '自由流密度 (kg/m³)' : 'Freestream density (kg/m³)'}<input type="number" min="0" step="any" value={fields.rhoFreestream} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, rhoFreestream: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '自由流速度 (m/s)' : 'Freestream speed (m/s)'}<input type="number" min="0" step="any" value={fields.velocityFreestream} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, velocityFreestream: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '参考面积 (m²)' : 'Reference area (m²)'}<input type="number" min="0" step="any" value={fields.refArea} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, refArea: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '参考长度 (m)' : 'Reference length (m)'}<input type="number" min="0" step="any" value={fields.refLength} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, refLength: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '维度' : 'Dimension'}<select value={fields.dimension} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, dimension: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm"><option value="3">3D</option><option value="2">2D</option></select></label>
      {(['originX', 'originY', 'originZ', 'aoa', 'sideslip'] as const).map(key => <label key={key} className="text-xs text-slate-300">{({ originX: 'Moment origin X (m)', originY: 'Moment origin Y (m)', originZ: 'Moment origin Z (m)', aoa: 'Angle of attack (°)', sideslip: 'Sideslip (°)' })[key]}<input type="number" step="any" value={fields[key]} disabled={execution?.busy} onChange={event => setFields(current => ({ ...current, [key]: event.currentTarget.value }))} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>)}
    </div>
    {(!settings || (settings.dimension === 2 && rows && (settings.refOriginMoment[2] !== 0 || rows.some(row => row.areaZ_m2 !== 0 || row.shearForceZ_N !== 0 || row.centroidZ_m !== 0)))) && <p role="alert" className="text-sm text-amber-200">{zh ? '参数无效：参考量必须为正，其他设置必须为有限值；2D 模式要求所有 Z 分量及原点 Z 为 0。' : 'Invalid settings: reference quantities must be positive and other settings finite; 2D mode requires all Z components and origin Z to be zero.'}</p>}
    {rows && <div className="space-y-2">
      <p className="text-xs text-emerald-300">{zh ? `已解析 ${rows.length}/${STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS} 个面样本。` : `Parsed ${rows.length}/${STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS} face samples.`}</p>
      <div className="max-h-64 overflow-auto rounded border border-edge"><table className="min-w-full text-left text-xs"><caption className="sr-only">Imported surface samples</caption><thead className="sticky top-0 bg-slate-900 text-slate-300"><tr>{['Face ID', 'Area vector (m²)', 'Pressure (Pa)', 'Shear force (N)', 'Centroid (m)'].map(label => <th key={label} scope="col" className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map(row => <tr key={row.faceId} className="border-t border-edge/70"><td className="px-2 py-1">{row.faceId}</td><td className="px-2 py-1">{`${row.areaX_m2}, ${row.areaY_m2}, ${row.areaZ_m2}`}</td><td className="px-2 py-1">{row.pressure_Pa}</td><td className="px-2 py-1">{`${row.shearForceX_N}, ${row.shearForceY_N}, ${row.shearForceZ_N}`}</td><td className="px-2 py-1">{`${row.centroidX_m}, ${row.centroidY_m}, ${row.centroidZ_m}`}</td></tr>)}</tbody></table></div>
      {rows.length > 100 && <p className="text-xs text-slate-400">{zh ? '表格预览显示前 100 行；完整原始 CSV 和全部解析行包含在 JSON 报告中。' : 'Table preview shows the first 100 rows; the JSON report contains the full source CSV and all parsed rows.'}</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn bg-cyan-300 text-slate-950 disabled:opacity-50" onClick={submit} disabled={!parsedInput || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending}>{execution?.busy ? (zh ? '任务提交中…' : 'Submitting…') : (zh ? '提交表面载荷报告到 Host' : 'Submit surface-load report to Host')}</button>
      {execution?.jobId && <a className="text-sm text-cyan-300 underline" href={`/batch-jobs?job=${encodeURIComponent(execution.jobId)}`}>{zh ? '查看已保存任务' : 'View saved job'}</a>}
    </div>
    {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
    {execution?.error && <p role="alert" className="text-sm text-rose-300">{execution.error}</p>}
    {saved && <section className="space-y-3 rounded-lg border border-edge bg-slate-950/30 p-3" aria-label={zh ? '已保存表面载荷结果' : 'Saved surface-load result'}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{zh ? '已保存的原生报告' : 'Saved native report'}</h3><p className="text-xs text-slate-400">{saved.rows.length} faces · Host job {saved.jobId}</p></div><div className="flex gap-2"><button type="button" className="btn border border-edge" onClick={() => download('waveworld-starccm-surface-loads.json', JSON.stringify(createStarCcmSurfaceLoadsReport({ jobId: saved.jobId, sourceCsv: saved.sourceCsv, rows: saved.rows, settings: saved.settings, submittedInput: saved.input, result: saved.output }), null, 2), 'application/json;charset=utf-8')}>{zh ? 'JSON 报告' : 'JSON report'}</button><button type="button" className="btn border border-edge" onClick={() => download('waveworld-starccm-surface-loads-summary.csv', createStarCcmSurfaceLoadsSummaryCsv(saved.output), 'text/csv;charset=utf-8')}>{zh ? '结果 CSV' : 'Result CSV'}</button></div></div>
      <div className="overflow-x-auto rounded border border-edge"><table className="min-w-full text-left text-xs"><caption className="sr-only">Host returned surface-load forces, moments, and coefficients</caption><thead className="bg-slate-900 text-slate-300"><tr><th scope="col" className="px-2 py-2">{zh ? '指标' : 'Metric'}</th><th scope="col" className="px-2 py-2">{zh ? '数值' : 'Value'}</th><th scope="col" className="px-2 py-2">{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{surfaceResultRows(saved.output).map(row => <tr key={row.metric} className="border-t border-edge/70"><th scope="row" className="px-2 py-1 font-normal">{row.metric}</th><td className="px-2 py-1 font-mono">{row.value}</td><td className="px-2 py-1">{row.unit}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-slate-400">{zh ? 'JSON 报告保留原始 CSV、解析表、压力参考值、实际提交输入和 Host 返回结果。' : 'The JSON report preserves the original CSV, parsed table, pressure reference, exact submitted input, and Host result.'}</p>
    </section>}
  </section>
}
