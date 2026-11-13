import { useMemo, useState } from 'react'
import type { HostJobDetail } from '../lib/hostApi'
import { fetchHostArtifact } from '../lib/hostApi'
import { useLocale } from '../lib/i18n'
import { readStructuralFields, type StructuralTable } from '../lib/structuralResult'
import { ThermalFieldResult } from './thermal/ThermalFieldResult'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const format = (value: number) => Number(value.toPrecision(6)).toLocaleString(undefined, { maximumSignificantDigits: 6 })
const labels: Record<string, [string, string]> = {
  cd: ['阻力系数 Cd', 'Drag coefficient Cd'], cl: ['升力系数 Cl', 'Lift coefficient Cl'],
  reynoldsPhysical: ['目标雷诺数 Re', 'Requested Reynolds number'], reynoldsLattice: ['实际雷诺数 Re', 'Simulated Reynolds number'],
  dragN: ['阻力 / N', 'Drag / N'], liftN: ['升力 / N', 'Lift / N'], sideN: ['侧向力 / N', 'Side force / N'],
  solidMaxC: ['固体最高温度 / °C', 'Maximum solid temperature / °C'], fluidMaxC: ['流体最高温度 / °C', 'Maximum fluid temperature / °C'],
  sourceEnergyJ: ['累计热源输入 / J', 'Cumulative source energy / J'], thermalEnergyJ: ['相对热能 / J', 'Relative thermal energy / J'],
  energyResidualJ: ['能量收支残差 / J', 'Energy balance residual / J'],
  maxStressPa: ['最大应力 / Pa', 'Maximum stress / Pa'], maxDisplacementM: ['最大位移 / m', 'Maximum displacement / m'],
  maxReactionN: ['最大反力分量 / N', 'Maximum reaction force component / N'], maxReactionMomentNm: ['最大反力矩 / N·m', 'Maximum reaction moment / N·m'],
  maxAxialStressPa: ['最大绝对轴向应力 / Pa', 'Maximum absolute axial stress / Pa'], maxBendingMomentNm: ['最大绝对弯矩 / N·m', 'Maximum absolute bending moment / N·m'],
  centerDeflectionM: ['中心挠度 / m', 'Center deflection / m'], flexuralRigidityNm: ['弯曲刚度 / N·m', 'Flexural rigidity / N·m'],
}

const fieldLabels: Record<string, [string, string]> = {
  nodeId: ['节点 ID', 'Node ID'], elementId: ['单元 ID', 'Element ID'],
  ux: ['位移 ux', 'Displacement ux'], uy: ['位移 uy', 'Displacement uy'], uz: ['位移 uz', 'Displacement uz'], rz: ['转角 rz', 'Rotation rz'],
  reaction_ux: ['反力 Fx', 'Reaction Fx'], reaction_uy: ['反力 Fy', 'Reaction Fy'], reaction_uz: ['反力 Fz', 'Reaction Fz'], reaction_rz: ['反力矩 Mz', 'Reaction Mz'],
  axialStress: ['轴向应力', 'Axial stress'], axialStrain: ['轴向应变', 'Axial strain'],
  characteristicLength: ['特征长度', 'Characteristic length'], area: ['面积', 'Area'], volume: ['体积', 'Volume'],
  endMoment1: ['端 1 弯矩', 'End 1 moment'], endMoment2: ['端 2 弯矩', 'End 2 moment'], maxAbsMoment: ['最大绝对弯矩', 'Maximum absolute moment'], bendingStress: ['最大弯曲应力', 'Maximum bending stress'],
}

function StructuralFieldTable({ table, name, title, jobId, zh }: { table: StructuralTable; name: string; title: string; jobId: string; zh: boolean }) {
  return <details className="min-w-0 rounded-xl border border-edge p-4">
    <summary className="cursor-pointer text-sm text-slate-200">{title} ({table.rows.length})</summary>
    <button className="btn my-3 border border-edge" onClick={() => download(`waveworld-${jobId}-${name}.csv`, new Blob([
      [table.columns.map(column => `${column.key}${column.unit ? ` (${column.unit})` : ''}`).join(','), ...table.rows.map(row => row.map(value => value == null ? '' : Object.is(value, -0) ? '-0' : String(value)).join(','))].join('\n') + '\n',
    ], { type: 'text/csv;charset=utf-8' }))}>{zh ? `下载${title} CSV` : `Download ${title.toLowerCase()} CSV`}</button>
    <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={zh ? `${title}表格滚动区域` : `Scrollable ${title.toLowerCase()}`}>
      <table className="w-full whitespace-nowrap text-right text-xs" aria-label={title}>
        <thead className="sticky top-0 bg-panel text-slate-300"><tr>{table.columns.map(column => <th key={column.key} scope="col" className="px-3 py-2 font-medium">{fieldLabels[column.key]?.[zh ? 0 : 1] ?? column.key}{column.unit && ` / ${column.unit}`}</th>)}</tr></thead>
        <tbody className="font-mono text-slate-300">{table.rows.map(row => <tr key={row[0]} className="border-t border-edge">{row.map((value, i) => <td key={i} className="px-3 py-2">{value == null ? '—' : table.columns[i].unit ? format(value) : String(value)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Read saved values only. Opening a result must never run a solver or submit a job. */
export function JobResultView({ job }: { job: HostJobDetail }) {
  const { locale } = useLocale(), zh = locale === 'zh'
  const [selected, setSelected] = useState(0), [sample, setSample] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null)
  const [showData, setShowData] = useState(false)
  const result = record(job.result), summary = record(result.summary), thermal = record(result.thermal), derived = record(result.derived)
  const module = record(result.moduleResult), data = record(module.result)
  const structural = job.kind === 'structural-static'
  const kirchhoff = structural && (summary.method === 'structural-kirchhoff-plate-analytic-v1' || record(result.backend).id === 'cpu-structural-kirchhoff')
  const fields = useMemo(() => structural && !kirchhoff ? readStructuralFields(record(record(job.result).derived)) : null, [job.result, structural, kirchhoff])
  const curves = useMemo(() => {
    const series: { key: string; x: number[]; y: number[]; name: string; axis: string }[] = []
    const add = (key: string, x: unknown, y: unknown, name: string, axis: string) => {
      if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.length > 0 && x.every(finite) && y.every(finite)) series.push({ key, x, y, name, axis })
    }
    const history = record(result.history)
    for (const [key, values] of Object.entries(history)) {
      if (key !== 'step') add(key, history.step, values, labels[key]?.[zh ? 0 : 1] ?? key, zh ? '计算步' : 'Step')
    }
    if (Array.isArray(data.states)) {
      const rows = data.states.map(record), dt = module.module === 'rlc' && finite(data.dt) ? data.dt : null
      const x = rows.map((_, i) => dt === null ? i : i * dt)
      for (const key of Object.keys(rows[0] ?? {})) {
        const name = module.module === 'rlc' ? ({ q: zh ? '电荷 / C' : 'Charge / C', i: zh ? '电流 / A' : 'Current / A' } as Record<string, string>)[key] : key
        add(key, x, rows.map(row => row[key]), name ?? key, dt === null ? (zh ? '采样序号' : 'Sample index') : (zh ? '时间 / s' : 'Time / s'))
      }
    }
    if (module.module === 'transient' && finite(data.tau) && Array.isArray(data.values) && data.values.length > 1) {
      const tau = data.tau
      add('transient', data.values.map((_, i, values) => i / (values.length - 1) * 5 * tau), data.values, `${zh ? '响应' : 'Response'} / ${data.unit ?? ''}`, zh ? '时间 / s' : 'Time / s')
    }
    return series
  }, [job.result, zh])
  const curve = curves[selected] ?? curves[0]
  const at = curve ? Math.min(sample ?? curve.x.length - 1, curve.x.length - 1) : 0
  const metrics = Object.entries({ ...summary, ...thermal }).filter(([key, value]) => labels[key] && finite(value)) as [string, number][]
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts.map(record).filter(artifact => !structural || !/^structural-(?:u|s|kpi)-[0-9a-f]{12}$/.test(String(artifact.artifactId))) : []
  const getArtifact = async (id: string, kind: string) => {
    setBusy(id); setError(null)
    try { download(`${job.id}-${kind.replace(/[^a-z0-9-]/gi, '_')}.bin`, await fetchHostArtifact(id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  let points = '', yMin = 0, yMax = 0
  if (curve) {
    yMin = curve.y.reduce((a, b) => Math.min(a, b), Infinity)
    yMax = curve.y.reduce((a, b) => Math.max(a, b), -Infinity)
    const xMin = curve.x.reduce((a, b) => Math.min(a, b), Infinity), xMax = curve.x.reduce((a, b) => Math.max(a, b), -Infinity)
    const stride = Math.max(1, Math.ceil(curve.x.length / 1200))
    points = curve.y.flatMap((y, i) => i % stride && i !== curve.y.length - 1 ? [] : [`${24 + (curve.x[i] - xMin) / (xMax - xMin || 1) * 652},${yMin === yMax ? 120 : 220 - (y - yMin) / (yMax - yMin) * 200}`]).join(' ')
  }
  return <section className="space-y-4" aria-label={zh ? '已保存的计算结果' : 'Saved computation result'}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-100">{zh ? '计算结果' : 'Results'}</h3>
      <button className="btn border border-edge" onClick={() => download(`waveworld-${job.id}.json`, new Blob([JSON.stringify({ jobId: job.id, spec: job.spec, result: job.result, specFingerprint: job.specFingerprint }, null, 2)], { type: 'application/json' }))}>{zh ? '下载参数与结果' : 'Download inputs and results'}</button>
    </div>
    <p className="text-sm text-slate-400">{zh ? '显示本次任务保存的结果，查看不会重新计算。' : 'These are the saved results of this run. Viewing does not recompute them.'}</p>
    {job.kind === 'lbm-d3q19' && <div className="rounded-lg border border-edge p-3 text-sm text-slate-300" aria-label={zh ? '本次物性' : 'Saved fluid properties'}>
      <p className="mb-2">{zh ? '作用力和系数是最近采样区间的平均；流场显示最后一步。' : 'Forces and coefficients average the latest sampling interval; the field shows the final step.'}</p>
      <p className="mb-2" aria-label={zh ? '受力参考' : 'Force reference'}>{derived['lbm-gauge-force-v1'] === 1
        ? (zh ? '气动力已扣除参考静压，地面反力单独排除。' : 'Aerodynamic forces exclude reference static pressure and the separate ground reaction.')
        : (zh ? '此结果未记录参考静压修正；贴地模型的升力可能含参考静压载荷，请重新计算后比较。' : 'This result does not record reference-pressure correction. Lift on a ground-contacting model may include reference static-pressure load; recompute before comparing.')}</p>
      <p>{derived.viscosityMode === 'stabilized-preview'
        ? (zh ? '流动演示（调整黏度）：必要时提高了模拟黏度，降低实际雷诺数；本结果不能当作目标工况的风阻预测。LES 不会恢复目标雷诺数。' : 'Flow demonstration (adjusted viscosity): simulated viscosity may have been increased, reducing Reynolds number. This is not a drag prediction for the requested physical case. LES does not restore the requested Reynolds number.')
        : derived.viscosityMode === 'physical' ? (zh ? '真实物性：本次使用输入黏度。' : 'Physical mode: this run used the requested viscosity.')
          : (zh ? '此结果未记录物性模式，无法确认是否调整过黏度。' : 'This result did not save its viscosity mode; viscosity adjustment cannot be confirmed.')}</p>
      {finite(derived.requestedViscosityM2s) && finite(derived.simulatedViscosityM2s) && <p className="mt-2">{zh ? '运动黏度：输入' : 'Kinematic viscosity: requested'} {format(derived.requestedViscosityM2s)} / {zh ? '模拟' : 'simulated'} {format(derived.simulatedViscosityM2s)} m²/s</p>}
      {!finite(summary.cd) && !finite(summary.cl) && <p className="mt-2">{zh ? '本次未提供力系数。入口速度为 0 时系数不适用，作用力仍以 N 显示。' : 'Force coefficients are unavailable for this run. They are undefined at zero inlet velocity; forces are still reported in N.'}</p>}
    </div>}
    {job.kind === 'lbm-d3q19' && <div className="rounded-lg border border-edge p-3 text-sm text-slate-300" aria-label={zh ? '本次地面' : 'Saved ground boundary'}>
      {derived['lbm-ground-v1'] === 1 && (derived.groundMode === 'moving' || derived.groundMode === 'stationary') ? <>
        <p>{derived.groundMode === 'moving' ? (zh ? '随来流移动地面' : 'Ground moving with the inlet flow') : (zh ? '固定地面' : 'Stationary ground')}
          {' · '}{zh ? '速度' : 'Velocity'} {finite(derived.groundVelocityMps) ? format(derived.groundVelocityMps) : '—'} m/s (+X)</p>
        <p className="mt-2">{zh ? '模型最低点距地面' : 'Lowest model point above ground'} {finite(derived.groundClearanceM) ? format(derived.groundClearanceM) : '—'} m {zh ? '（含轮胎，不是底盘间隙）。' : '(including tires, not underbody clearance).'}</p>
        <p className="mt-2">{zh ? '车轮不旋转；热计算中地面绝热，不计算黏性耗散生热。' : 'Wheels do not rotate. Thermal runs use an adiabatic ground and omit viscous heating.'}</p>
      </> : <p>{zh ? '本次未设置道路地面，模型位于流域中心偏上游。' : 'No road ground was configured; the model is centered vertically and placed upstream of the domain center.'}</p>}
    </div>}
    {derived.stressRecoveryStatus === 'section-modulus-required' && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{zh
      ? '梁最大应力未计算：需要为每个对称截面提供截面模量 Z（m³）。已有位移、轴向应力和弯矩结果仍可查看。'
      : 'Maximum beam stress is unavailable: supply section modulus Z (m³) for every symmetric cross section. Displacement, axial stress and bending moments remain available.'}</p>}
    {(job.kind === 'thermal-3d-transient' || (job.kind === 'thermal-3d-steady' && job.spec.parameters.dimension === 3) || (job.kind === 'electro-thermal-igbt' && job.spec.parameters.mode === 'spatial-chip')) && <ThermalFieldResult key={job.id} job={job} zh={zh} />}
    {metrics.length > 0 && <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([key, value]) => <div key={key} className="rounded-lg bg-edge/40 p-3"><dt className="text-xs text-slate-400">{labels[key][zh ? 0 : 1]}</dt><dd className="mt-1 font-mono text-lg text-slate-100">{format(value)}</dd></div>)}</dl>}
    {kirchhoff && <p className="text-sm text-slate-400">{zh ? 'CPU · Float64 · Kirchhoff 简支方板解析算例。此算例提供中心挠度、弯曲刚度等汇总，不输出节点与单元场表。' : 'CPU · Float64 · Analytic Kirchhoff simply supported square plate. This case provides summary values such as center deflection and flexural rigidity, without nodal or element fields.'}</p>}
    {fields && <div className="min-w-0 space-y-3" aria-label={zh ? '结构场数据' : 'Structural fields'}>
      <p className="text-sm text-slate-400">{zh
        ? 'CPU · Float64 · 小规模线弹性静力分析。当前支持杆、二维梁、CST 三角形与 tet4 四面体；上限 96 节点、256 单元、288 自由度。结果不代表已通过工程设计验证。'
        : 'CPU · Float64 · Small linear-elastic static analysis: bars, 2D beams, CST triangles and tet4 tetrahedra; up to 96 nodes, 256 elements and 288 DOFs. These results do not establish engineering design validation.'}</p>
      {derived.elementType === 'cst' && <p className="text-sm text-slate-300">CST · {derived.continuumKind === 'plane-stress' ? (zh ? '平面应力' : 'Plane stress') : derived.continuumKind === 'plane-strain' ? (zh ? '平面应变' : 'Plane strain') : (zh ? '结果未记录平面假设' : 'Plane assumption was not saved')}</p>}
      {'unavailable' in fields ? <p role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-200">{fields.unavailable === 'missing'
        ? (zh ? '此结果未保存完整的节点坐标、连接关系或场数据，无法还原对应表格。可下载原始参数与结果；查看不会重新计算。' : 'This result did not save complete node coordinates, connectivity or field data, so aligned tables cannot be recovered. Download the original inputs and results; viewing does not recompute them.')
        : (zh ? '已保存场数据的数值、长度、节点对应关系或单位不一致，无法可靠显示表格。可下载原始参数与结果检查。' : 'Saved field values, lengths, node references or units are inconsistent. Tables cannot be displayed reliably. Download the original inputs and results for inspection.')}</p> : <>
        <p className="text-xs text-slate-400">{zh ? '节点采用全局坐标与自由度；单元连接关系使用原始节点 ID。应变单位为 1，γ 为工程剪应变；— 表示未计算。CSV 保留已保存的数值精度。' : 'Nodes use global coordinates and DOFs; connectivity uses original node IDs. Strain is dimensionless (1); γ denotes engineering shear strain. — means unavailable. CSV preserves the saved numeric precision.'}</p>
        <StructuralFieldTable table={fields.nodes} name="nodes" title={zh ? '节点结果' : 'Node results'} jobId={job.id} zh={zh} />
        <StructuralFieldTable table={fields.elements} name="elements" title={zh ? '单元结果' : 'Element results'} jobId={job.id} zh={zh} />
      </>}
    </div>}
    {curve && <div className="rounded-xl border border-edge p-4" aria-label={zh ? '结果曲线' : 'Result chart'}>
      <label className="flex items-center gap-3 text-sm">{zh ? '查看曲线' : 'View series'}<select className="min-h-11 rounded border border-edge bg-panel px-2" value={selected} onChange={event => { setSelected(Number(event.target.value)); setSample(null) }}>{curves.map((item, i) => <option key={i} value={i}>{item.name}</option>)}</select></label>
      <svg viewBox="0 0 700 240" className="my-3 w-full" role="img" aria-label={`${curve.name}, ${curve.axis}`}>
        <path d="M24 20V220H676" fill="none" stroke="#475569" />
        <polyline points={points} fill="none" stroke="#67e8f9" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-xs text-slate-400"><span>{zh ? '最小' : 'Min'} {format(yMin)}</span><span>{curve.axis}</span><span>{zh ? '最大' : 'Max'} {format(yMax)}</span></div>
      <label className="mt-4 block text-sm text-slate-300">{curve.axis}: {format(curve.x[at])} · {curve.name}: <output>{format(curve.y[at])}</output><input aria-label={zh ? '查看采样点' : 'Inspect sample'} type="range" className="mt-2 w-full" min={0} max={curve.x.length - 1} value={at} onChange={event => setSample(Number(event.target.value))} /></label>
    </div>}
    {artifacts.length > 0 && <div className="space-y-2"><h4 className="text-sm text-slate-300">{zh ? '结果文件' : 'Result files'}</h4>{artifacts.filter(a => typeof a.artifactId === 'string').map(a => {
      const step = a.kind === 'lbm-display' && finite(a.step) ? a.step : null
      const time = step !== null && finite(derived.dt) && derived.dt > 0 ? step * derived.dt : null
      return <button key={String(a.artifactId)} disabled={busy !== null} className="btn mr-2 border border-edge disabled:opacity-50" onClick={() => void getArtifact(String(a.artifactId), `${String(a.kind ?? 'result')}${step === null ? '' : `-step-${step}`}`)}>{busy === a.artifactId ? (zh ? '下载中…' : 'Downloading…') : `${zh ? '下载' : 'Download'} ${a.kind === 'lbm-display' ? (zh ? '流场文件' : 'Flow field') : String(a.kind ?? 'result')}`}{step !== null && ` · ${zh ? '步' : 'step'} ${step}`}{time !== null && ` · ${format(time)} s`} {finite(a.bytes) && `(${format(a.bytes / 1024)} KiB)`}</button>
    })}</div>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <details className="text-sm text-slate-400" onToggle={event => setShowData(event.currentTarget.open)}><summary className="cursor-pointer py-2">{zh ? '完整结果数据' : 'Full result data'}</summary>{showData && <pre className="max-h-80 overflow-auto rounded bg-edge/30 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}</details>
  </section>
}
