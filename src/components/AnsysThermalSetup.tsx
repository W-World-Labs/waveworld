import { useLocale } from '../lib/i18n'
import type { AnsysThermalStudyDraft } from '../lib/sim/ansys-thermal-study-input'

type NumericDraftKey = 'nodeCount' | 'lengthM' | 'crossSectionAreaM2' | 'conductivityWPerMK' | 'volumetricSourceWPerM3' | 'leftTemperatureC' | 'rightTemperatureC' | 'initialTemperatureC' | 'densityKgPerM3' | 'specificHeatJPerKgK' | 'timeStepS' | 'steps' | 'theta'

type Props = {
  draft: AnsysThermalStudyDraft
  onChange: (draft: AnsysThermalStudyDraft) => void
  disabled?: boolean
}

function numericValue(value: string): number {
  return value === '' ? Number.NaN : Number(value)
}

export function AnsysThermalSetup({ draft, onChange, disabled = false }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const copy = zh ? {
    title: 'Ansys 热传导研究设置',
    description: '一维均匀截面杆的有限元热传导输入。温度为端点定温；不表示三维几何或实体模型。',
    analysis: '分析类型', steady: '稳态', transient: '瞬态',
    nodeCount: '节点数', lengthM: '杆长 (m)', areaM2: '横截面积 (m²)', conductivity: '导热系数 (W/(m·K))', source: '体积热源 (W/m³)',
    left: '左端温度 (°C)', right: '右端温度 (°C)', initial: '初始温度 (°C)', density: '密度 (kg/m³)', heat: '比热容 (J/(kg·K))',
    dt: '时间步长 (s)', steps: '时间步数', theta: 'Theta 参数', capacity: '容量矩阵', consistent: '一致容量矩阵', lumped: '集中容量矩阵',
    steadyLegend: '稳态一维均匀杆输入', transientLegend: '瞬态热学属性和时间设置',
  } : {
    title: 'Ansys thermal study setup',
    description: 'Finite element thermal input for a 1D uniform bar. Temperatures are fixed at the endpoints; this does not represent 3D geometry or a solid model.',
    analysis: 'Analysis type', steady: 'Steady', transient: 'Transient',
    nodeCount: 'Node count', lengthM: 'Bar length (m)', areaM2: 'Cross-section area (m²)', conductivity: 'Thermal conductivity (W/(m·K))', source: 'Volumetric heat source (W/m³)',
    left: 'Left endpoint temperature (°C)', right: 'Right endpoint temperature (°C)', initial: 'Initial temperature (°C)', density: 'Density (kg/m³)', heat: 'Specific heat capacity (J/(kg·K))',
    dt: 'Time step (s)', steps: 'Time steps', theta: 'Theta parameter', capacity: 'Capacity matrix', consistent: 'Consistent capacity', lumped: 'Lumped capacity',
    steadyLegend: 'Steady 1D uniform bar inputs', transientLegend: 'Transient thermal properties and time settings',
  }
  const updateNumber = (key: NumericDraftKey, value: string) => {
    if (key === 'volumetricSourceWPerM3' && value === '') {
      const next = { ...draft }
      delete next.volumetricSourceWPerM3
      onChange(next)
      return
    }
    onChange({ ...draft, [key]: numericValue(value) })
  }
  const numberInput = (key: NumericDraftKey, label: string, step: string, min?: number) => <label key={key} className="text-sm text-slate-300">{label}
    <input type="number" step={step} min={min} value={Number.isFinite(draft[key]) ? draft[key] : ''} disabled={disabled} onChange={event => updateNumber(key, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-slate-100 disabled:opacity-50" />
  </label>

  return <section className="space-y-4 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="ansys-thermal-setup-title">
    <header>
      <h2 id="ansys-thermal-setup-title" className="text-lg font-semibold text-slate-100">{copy.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">{copy.description}</p>
    </header>

    <label className="block text-sm text-slate-300">{copy.analysis}
      <select value={draft.analysis} disabled={disabled} onChange={event => onChange({ ...draft, analysis: event.currentTarget.value as AnsysThermalStudyDraft['analysis'] })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-slate-100 disabled:opacity-50">
        <option value="steady">{copy.steady}</option>
        <option value="transient">{copy.transient}</option>
      </select>
    </label>

    <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">{copy.steadyLegend}</legend>
      {numberInput('nodeCount', copy.nodeCount, '1', 2)}
      {numberInput('lengthM', copy.lengthM, 'any', 0)}
      {numberInput('crossSectionAreaM2', copy.areaM2, 'any', 0)}
      {numberInput('conductivityWPerMK', copy.conductivity, 'any', 0)}
      {numberInput('volumetricSourceWPerM3', copy.source, 'any')}
      {numberInput('leftTemperatureC', copy.left, 'any')}
      {numberInput('rightTemperatureC', copy.right, 'any')}
    </fieldset>

    {draft.analysis === 'transient' && <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">{copy.transientLegend}</legend>
      {numberInput('initialTemperatureC', copy.initial, 'any')}
      {numberInput('densityKgPerM3', copy.density, 'any', 0)}
      {numberInput('specificHeatJPerKgK', copy.heat, 'any', 0)}
      {numberInput('timeStepS', copy.dt, 'any', 0)}
      {numberInput('steps', copy.steps, '1', 1)}
      {numberInput('theta', copy.theta, 'any', 0)}
      <label className="text-sm text-slate-300">{copy.capacity}
        <select value={draft.capacity} disabled={disabled} onChange={event => onChange({ ...draft, capacity: event.currentTarget.value as AnsysThermalStudyDraft['capacity'] })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-slate-100 disabled:opacity-50">
          <option value="consistent">{copy.consistent}</option>
          <option value="lumped">{copy.lumped}</option>
        </select>
      </label>
    </fieldset>}
  </section>
}
