import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type {
  IgbtSpatialChipJobParameters,
  IgbtSpatialDie,
  ThermalSteadyBoundary,
} from '@w-sim/contracts'
import { useLocale } from '../../lib/i18n'
import { buildIgbtSpatialJobSpec, createDefaultIgbtSpatialParameters } from '../../lib/sim/igbt-spatial-job'
import { submitSpatialIgbtJob, type HostJobSummary } from '../../lib/hostApi'

type Point3 = [number, number, number]
type Face = keyof IgbtSpatialChipJobParameters['boundaries']
type NumberFieldProps = { label: string; value: number; unit?: string; step?: number | 'any'; min?: number; max?: number; onChange(value: number): void }

function NumberField({ label, value, unit, step = 'any', min, max, onChange }: NumberFieldProps) {
  return <label className="grid gap-1 text-xs text-slate-300">{label}{unit && <span className="text-slate-500">({unit})</span>}
    <input type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.currentTarget.value === '' ? Number.NaN : Number(event.currentTarget.value))} className="min-h-10 w-full rounded border border-edge bg-canvas px-2 text-sm text-slate-100" />
  </label>
}

function updateAt<T extends object, K extends keyof T>(value: T, key: K, next: T[K]): T { return { ...value, [key]: next } }
function BoundsEditor({ title, bounds, onChange, zh }: { title: string; bounds: { min: Point3; max: Point3 }; onChange(value: { min: Point3; max: Point3 }): void; zh: boolean }) {
  const axisLabels = zh ? ['X', 'Y', 'Z'] : ['X', 'Y', 'Z']
  return <fieldset className="grid gap-2 rounded border border-edge p-3"><legend className="px-1 text-xs text-slate-400">{title}</legend>
    {(['min', 'max'] as const).map(edge => <div key={edge} className="grid grid-cols-3 gap-2">
      {bounds[edge].map((value, axis) => <NumberField key={`${edge}-${axis}`} label={`${edge === 'min' ? (zh ? '最小' : 'Min') : (zh ? '最大' : 'Max')} ${axisLabels[axis]}`} unit="m" value={value} onChange={next => {
        const point = [...bounds[edge]] as Point3; point[axis] = next
        onChange({ ...bounds, [edge]: point })
      }} />)}
    </div>)}
  </fieldset>
}

function BoundaryEditor({ face, boundary, onChange, zh }: { face: Face; boundary: ThermalSteadyBoundary; onChange(value: ThermalSteadyBoundary): void; zh: boolean }) {
  const names: Record<Face, string> = { left: zh ? '左面' : 'Left / x-min', right: zh ? '右面' : 'Right / x-max', bottom: zh ? '底面' : 'Bottom / y-min', top: zh ? '顶面' : 'Top / y-max', front: zh ? '前面' : 'Front / z-min', back: zh ? '后面' : 'Back / z-max' }
  return <fieldset className="grid gap-2 rounded border border-edge p-3"><legend className="px-1 text-xs text-slate-300">{names[face]}</legend>
    <select aria-label={`${face} boundary type`} value={boundary.type} onChange={event => {
      const type = event.currentTarget.value
      if (type === 'dirichlet') onChange({ type, temperature: 25 })
      else if (type === 'robin') onChange({ type, h: 20, ambientTemp: 25 })
      else if (type === 'neumann') onChange({ type, heatFlux: 0 })
      else onChange({ type: 'insulated' })
    }} className="min-h-10 rounded border border-edge bg-canvas px-2 text-sm">
      <option value="insulated">{zh ? '绝热' : 'Insulated'}</option><option value="dirichlet">Dirichlet</option><option value="neumann">Neumann</option><option value="robin">Robin</option>
    </select>
    {boundary.type === 'dirichlet' && <NumberField label={zh ? '表面温度' : 'Boundary temperature'} unit="°C" value={boundary.temperature} onChange={temperature => onChange({ ...boundary, temperature })} />}
    {boundary.type === 'neumann' && <NumberField label={zh ? '流入热通量' : 'Heat flux into chip'} unit="W/m²" value={boundary.heatFlux} onChange={heatFlux => onChange({ ...boundary, heatFlux })} />}
    {boundary.type === 'robin' && <div className="grid grid-cols-2 gap-2">
      <NumberField label="h" unit="W/(m²·K)" value={boundary.h ?? 20} onChange={h => onChange({ ...boundary, h })} />
      <NumberField label={zh ? '环境温度' : 'Ambient temperature'} unit="°C" value={boundary.ambientTemp ?? 25} onChange={ambientTemp => onChange({ ...boundary, ambientTemp })} />
    </div>}
  </fieldset>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-3 rounded-xl border border-edge p-4"><h3 className="font-semibold text-slate-100">{title}</h3>{children}</section>
}

export function IgbtSpatialJobForm() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const [parameters, setParameters] = useState(createDefaultIgbtSpatialParameters)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [job, setJob] = useState<HostJobSummary | null>(null)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const submitLockRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false; controllerRef.current?.abort(); controllerRef.current = null; submitLockRef.current = false }
  }, [])

  function edit(next: (current: IgbtSpatialChipJobParameters) => IgbtSpatialChipJobParameters) {
    const wasSubmitting = submitLockRef.current
    controllerRef.current?.abort(); controllerRef.current = null
    submitLockRef.current = false
    setBusy(false); setErrors([]); setJob(null)
    if (wasSubmitting) setSubmissionUncertain(true)
    setParameters(next)
  }
  function setParameter<K extends keyof IgbtSpatialChipJobParameters>(key: K, value: IgbtSpatialChipJobParameters[K]) {
    edit(current => updateAt(current, key, value))
  }
  const faces: Face[] = ['left', 'right', 'bottom', 'top', 'front', 'back']

  async function submit() {
    if (submitLockRef.current || busy) return
    const built = buildIgbtSpatialJobSpec(parameters)
    if (!built.ok) { setErrors(built.errors); return }
    const controller = new AbortController()
    submitLockRef.current = true
    controllerRef.current = controller
    setBusy(true); setErrors([]); setJob(null); setSubmissionUncertain(false)
    try {
      const submitted = await submitSpatialIgbtJob(built.spec, controller.signal)
      if (aliveRef.current && !controller.signal.aborted) setJob(submitted)
    } catch (error) {
      if (aliveRef.current && !controller.signal.aborted) {
        setErrors([error instanceof Error ? error.message : String(error)])
        setSubmissionUncertain(true)
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null; submitLockRef.current = false
        if (aliveRef.current) setBusy(false)
      }
    }
  }

  return <details className="mt-8 rounded-2xl border border-cyan-700/50 bg-slate-950/40 p-4" open>
    <summary className="cursor-pointer select-none text-lg font-semibold text-cyan-200">{zh ? 'IGBT 芯片空间电热任务' : 'IGBT chip spatial electro-thermal job'}</summary>
    <p className="mt-2 text-sm text-slate-400">{zh ? '该表单向统一 Host 提交 native-cuda 任务；提交前只做输入准入检查，不在浏览器求解。预填数据是合成示例，不是厂商数据或器件标定。温度用 °C、长度用 m、功率用 W。' : 'Submits a native-cuda job to the shared Host. Only input admission runs here; the browser does not solve it. Defaults are synthetic examples, not vendor data or device calibration. Units: °C, m, W.'}</p>

    <div className="mt-5 grid gap-5">
      <Section title={zh ? '芯片尺寸、网格与材料' : 'Chip dimensions, grid and materials'}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {(['lengthX', 'lengthY', 'lengthZ'] as const).map((key, index) => <NumberField key={key} label={zh ? `${['X', 'Y', 'Z'][index]} 方向长度` : `${['X', 'Y', 'Z'][index]} length`} unit="m" value={parameters[key]} onChange={value => setParameter(key, value)} />)}
          {(['nx', 'ny', 'nz'] as const).map((key, index) => <NumberField key={key} label={zh ? `${['X', 'Y', 'Z'][index]} 方向网格节点数` : `${['X', 'Y', 'Z'][index]} grid nodes`} step={1} min={2} max={128} value={parameters[key]} onChange={value => setParameter(key, value)} />)}
          <NumberField label={zh ? '基底导热率' : 'Base conductivity'} unit="W/(m·K)" value={parameters.conductivity} onChange={conductivity => setParameter('conductivity', conductivity)} />
        </div>
        <div className="grid gap-3">
          {(parameters.materials ?? []).map((material, index) => <div key={`material-${index}`} className="grid gap-2 rounded-lg border border-edge p-3">
            <div className="flex items-center justify-between"><strong className="text-sm">{zh ? `材料区 ${index + 1}` : `Material region ${index + 1}`}</strong><button type="button" className="text-xs text-red-300" onClick={() => setParameter('materials', parameters.materials!.filter((_, i) => i !== index))}>{zh ? '删除' : 'Remove'}</button></div>
            <input aria-label={`Material ${index + 1} name`} value={material.name} onChange={event => setParameter('materials', parameters.materials!.map((item, i) => i === index ? { ...item, name: event.currentTarget.value } : item))} className="min-h-10 rounded border border-edge bg-canvas px-2" />
            <NumberField label={zh ? '导热率' : 'Conductivity'} unit="W/(m·K)" value={material.conductivity} onChange={conductivity => setParameter('materials', parameters.materials!.map((item, i) => i === index ? { ...item, conductivity } : item))} />
            <BoundsEditor title={zh ? '材料包围盒' : 'Material box'} bounds={material.bounds} zh={zh} onChange={bounds => setParameter('materials', parameters.materials!.map((item, i) => i === index ? { ...item, bounds } : item))} />
          </div>)}
          <button type="button" className="btn border border-edge" disabled={(parameters.materials?.length ?? 0) + parameters.dies.length >= 64} onClick={() => setParameter('materials', [...(parameters.materials ?? []), { name: `${zh ? '材料区' : 'Material region'} ${(parameters.materials?.length ?? 0) + 1}`, bounds: { min: [0, 0, 0], max: [parameters.lengthX, parameters.lengthY, parameters.lengthZ] }, conductivity: parameters.conductivity }])}>{zh ? '添加导热材料区' : 'Add conductivity region'}</button>
        </div>
      </Section>

      <Section title={zh ? '六面边界条件' : 'Six face boundary conditions'}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{faces.map(face => <BoundaryEditor key={face} face={face} boundary={parameters.boundaries[face]} zh={zh} onChange={boundary => setParameter('boundaries', { ...parameters.boundaries, [face]: boundary })} />)}</div>
        <label className="grid max-w-sm gap-1 text-sm text-slate-300">{zh ? '器件散热所在 case 面' : 'Case / cooling face'}
          <select value={parameters.caseFace} onChange={event => setParameter('caseFace', event.currentTarget.value as IgbtSpatialChipJobParameters['caseFace'])} className="min-h-10 rounded border border-edge bg-canvas px-2">
            {faces.map(face => <option key={face} value={face}>{face}</option>)}
          </select>
        </label>
      </Section>

      <Section title={zh ? '芯片器件与损耗表' : 'Dies and loss tables'}>
        <p className="text-xs text-slate-400">{zh ? '运行工况与损耗表条件分别保存。修改运行工况不会改写损耗表条件；不匹配时准入会拒绝提交。' : 'The operating point and loss-table conditions are stored independently. Editing the operating point never rewrites table conditions; admission rejects mismatches.'}</p>
        {parameters.dies.map((die, dieIndex) => <DieEditor key={dieIndex} die={die} index={dieIndex} zh={zh} onChange={next => setParameter('dies', parameters.dies.map((item, i) => i === dieIndex ? next : item))} onRemove={() => setParameter('dies', parameters.dies.filter((_, i) => i !== dieIndex))} />)}
        <button type="button" className="btn border border-edge" disabled={parameters.dies.length >= 16 || parameters.dies.length + (parameters.materials?.length ?? 0) >= 64} onClick={() => {
          const index = parameters.dies.length + 1
          let id = `Q${index}`
          while (parameters.dies.some(die => die.id === id)) id = `Q${Number(id.slice(1)) + 1}`
          const op = { currentA: 1, voltageV: 400, gateResistanceOnOhm: 4, gateResistanceOffOhm: 4, dutyCycle: 0.4, switchingFrequencyHz: 1000 }
          const die: IgbtSpatialDie = { id, bounds: { min: [0, 0, 0], max: [parameters.lengthX / 2, parameters.lengthY / 2, parameters.lengthZ / 2] }, operatingPoint: op, lossTable: { operatingPoint: { currentA: op.currentA, voltageV: op.voltageV, gateResistanceOnOhm: op.gateResistanceOnOhm, gateResistanceOffOhm: op.gateResistanceOffOhm }, points: [{ temperatureC: 25, vceSatV: 1.1, eOnJ: 0.001, eOffJ: 0.0015 }, { temperatureC: 150, vceSatV: 1.5, eOnJ: 0.0018, eOffJ: 0.0025 }], source: 'synthetic-example-not-vendor-data' }, initialJunctionTempC: 25 }
          setParameter('dies', [...parameters.dies, die])
        }}>{zh ? '添加器件' : 'Add die'}</button>
      </Section>

      <Section title={zh ? '电热耦合与求解控制' : 'Electro-thermal coupling and solver controls'}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <NumberField label={zh ? '结温上限' : 'Maximum junction temperature'} unit="°C" value={parameters.coupling.maxJunctionTempC} onChange={value => setParameter('coupling', { ...parameters.coupling, maxJunctionTempC: value })} />
          <NumberField label={zh ? '耦合最大迭代' : 'Coupling max iterations'} step={1} min={1} max={200} value={parameters.coupling.maxIterations ?? 100} onChange={value => setParameter('coupling', { ...parameters.coupling, maxIterations: value })} />
          <NumberField label={zh ? '温度容差' : 'Temperature tolerance'} unit="°C" value={parameters.coupling.temperatureToleranceC ?? 1e-8} onChange={value => setParameter('coupling', { ...parameters.coupling, temperatureToleranceC: value })} />
          <NumberField label={zh ? '相对功率容差' : 'Relative power tolerance'} value={parameters.coupling.relativePowerTolerance ?? 1e-10} onChange={value => setParameter('coupling', { ...parameters.coupling, relativePowerTolerance: value })} />
          <NumberField label={zh ? '松弛系数' : 'Relaxation factor'} value={parameters.coupling.relaxationFactor ?? 1} onChange={value => setParameter('coupling', { ...parameters.coupling, relaxationFactor: value })} />
          <NumberField label={zh ? '内场残差容差' : 'Inner field residual tolerance'} value={parameters.residualTol ?? 1e-10} onChange={value => setParameter('residualTol', value)} />
          <NumberField label={zh ? '内场最大迭代' : 'Inner max iterations'} step={1} min={1} max={50_000} value={parameters.maxIterations ?? 50_000} onChange={value => setParameter('maxIterations', value)} />
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn border border-cyan-600 bg-cyan-950/50" disabled={busy} onClick={() => void submit()}>{busy ? (zh ? '提交中…' : 'Submitting…') : (zh ? '校验并提交到计算队列（原生 GPU）' : 'Validate and submit to compute queue (native GPU)')}</button>
        {job && <span className="text-sm text-emerald-300">{zh ? '任务已创建：' : 'Job created: '}<Link className="underline" to={`/batch-jobs?job=${encodeURIComponent(job.id)}`}>{job.id} · {job.status}</Link></span>}
      </div>
      {submissionUncertain && <p role="status" className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-100">{zh ? '提交状态未确认。Host 可能已接受任务；请先到计算任务核对，避免重复提交。' : 'Submission status is unconfirmed. The Host may have accepted the job; check the job queue before retrying to avoid duplicates.'} <Link className="underline" to="/batch-jobs">{zh ? '打开计算任务' : 'Open job queue'}</Link></p>}
      {!!errors.length && <div role="alert" className="rounded-lg border border-red-700/60 bg-red-950/30 p-3 text-sm text-red-200"><p>{zh ? '无法提交：' : 'Submission blocked:'}</p><ul className="mt-2 list-disc pl-5">{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
    </div>
  </details>
}

function DieEditor({ die, index, zh, onChange, onRemove }: { die: IgbtSpatialDie; index: number; zh: boolean; onChange(value: IgbtSpatialDie): void; onRemove(): void }) {
  const opFields: Array<[keyof IgbtSpatialDie['operatingPoint'], string, string]> = [
    ['currentA', zh ? '电流' : 'Current', 'A'], ['voltageV', zh ? '电压' : 'Voltage', 'V'],
    ['gateResistanceOnOhm', 'Rg(on)', 'Ω'], ['gateResistanceOffOhm', 'Rg(off)', 'Ω'],
    ['dutyCycle', zh ? '占空比' : 'Duty cycle', '0–1'], ['switchingFrequencyHz', zh ? '开关频率' : 'Switching frequency', 'Hz'],
  ]
  return <article className="grid gap-3 rounded-xl border border-edge bg-canvas/30 p-4">
    <div className="flex items-center justify-between"><h4 className="font-medium">{zh ? `器件 ${index + 1}` : `Die ${index + 1}`}</h4><button type="button" disabled={index === 0} className="text-xs text-red-300 disabled:opacity-40" onClick={onRemove}>{zh ? '删除器件' : 'Remove die'}</button></div>
    <label className="grid max-w-sm gap-1 text-xs text-slate-300">ID<input aria-label={`${zh ? '器件' : 'Die'} ${index + 1} ID`} value={die.id} onChange={event => onChange({ ...die, id: event.currentTarget.value })} className="min-h-10 rounded border border-edge bg-canvas px-2 text-sm" /></label>
    <BoundsEditor title={zh ? '器件包围盒' : 'Die box'} bounds={die.bounds} zh={zh} onChange={bounds => onChange({ ...die, bounds })} />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{opFields.map(([key, label, unit]) => <NumberField key={key} label={label} unit={unit} value={die.operatingPoint[key]} onChange={value => onChange({ ...die, operatingPoint: { ...die.operatingPoint, [key]: value } })} />)}</div>
    <fieldset className="grid gap-3 rounded border border-edge p-3"><legend className="px-1 text-xs text-slate-400">{zh ? '损耗表查表条件（独立于当前工况）' : 'Loss-table conditions (independent of current operating point)'}</legend>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{(['currentA', 'voltageV', 'gateResistanceOnOhm', 'gateResistanceOffOhm'] as const).map((key, conditionIndex) => <NumberField key={key} label={`${zh ? ['损耗表电流', '损耗表电压', '损耗表开通门极电阻', '损耗表关断门极电阻'][conditionIndex] : ['Loss-table current', 'Loss-table voltage', 'Loss-table turn-on gate resistance', 'Loss-table turn-off gate resistance'][conditionIndex]}`} unit={['A', 'V', 'Ω', 'Ω'][conditionIndex]} value={die.lossTable.operatingPoint[key]} onChange={value => onChange({ ...die, lossTable: { ...die.lossTable, operatingPoint: { ...die.lossTable.operatingPoint, [key]: value } } })} />)}</div>
      <label className="grid gap-1 text-xs text-slate-300">{zh ? '数据来源说明' : 'Data source note'}<input value={die.lossTable.source ?? ''} onChange={event => onChange({ ...die, lossTable: { ...die.lossTable, source: event.currentTarget.value } })} className="min-h-10 rounded border border-edge bg-canvas px-2 text-sm" /></label>
      {die.lossTable.points.map((point, pointIndex) => <div key={`point-${pointIndex}`} className="grid grid-cols-2 gap-2 rounded bg-slate-900/50 p-2 md:grid-cols-4">
        {([['temperatureC', zh ? '结温' : 'Junction temperature', '°C'], ['vceSatV', zh ? '饱和压降' : 'Saturation voltage', 'V'], ['eOnJ', zh ? '开通能量' : 'Turn-on energy', 'J'], ['eOffJ', zh ? '关断能量' : 'Turn-off energy', 'J']] as const).map(([key, label, unit]) => <NumberField key={key} label={label} unit={unit} value={point[key]} onChange={value => {
          const points = [...die.lossTable.points]; points[pointIndex] = { ...point, [key]: value }; onChange({ ...die, lossTable: { ...die.lossTable, points } })
        }} />)}
        {die.lossTable.points.length > 2 && <button type="button" className="text-left text-xs text-red-300" onClick={() => onChange({ ...die, lossTable: { ...die.lossTable, points: die.lossTable.points.filter((_, i) => i !== pointIndex) } })}>{zh ? '删除温度点' : 'Remove point'}</button>}
      </div>)}
      <button type="button" className="justify-self-start text-xs text-cyan-300" disabled={die.lossTable.points.length >= 64} onClick={() => {
        const last = die.lossTable.points[die.lossTable.points.length - 1]!
        onChange({ ...die, lossTable: { ...die.lossTable, points: [...die.lossTable.points, { ...last, temperatureC: last.temperatureC + 10 }] } })
      }}>{zh ? '添加温度点（最多64）' : 'Add temperature point (max 64)'}</button>
    </fieldset>
    <NumberField label={zh ? '初始结温' : 'Initial junction temperature'} unit="°C" value={die.initialJunctionTempC ?? die.lossTable.points[0]?.temperatureC ?? 25} onChange={initialJunctionTempC => onChange({ ...die, initialJunctionTempC })} />
  </article>
}
