import type { ComsolPipeFlowDraft } from '../../lib/sim/comsol-pipe-flow-input'
import { useLocale } from '../../lib/i18n'

type Props = {
  value: ComsolPipeFlowDraft
  onChange: (value: ComsolPipeFlowDraft) => void
  disabled?: boolean
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink disabled:opacity-60'
const limits: Record<keyof ComsolPipeFlowDraft, { min: number; max: number; step: string }> = {
  length: { min: 0.000001, max: 10000, step: '0.1' },
  diameter: { min: 0.000001, max: 10, step: '0.001' },
  rho: { min: 0.000001, max: 20000, step: '0.1' },
  mu: { min: 0.000001, max: 1000, step: 'any' },
  inletPressure: { min: 0, max: 100000000, step: '100' },
  outletPressure: { min: 0, max: 100000000, step: '100' },
}

const fields: Array<{ key: keyof ComsolPipeFlowDraft; unit: string; label: [string, string] }> = [
  { key: 'length', unit: 'm', label: ['管道长度', 'Pipe length'] },
  { key: 'diameter', unit: 'm', label: ['内径', 'Inner diameter'] },
  { key: 'rho', unit: 'kg/m³', label: ['流体密度', 'Fluid density'] },
  { key: 'mu', unit: 'Pa·s', label: ['动力黏度', 'Dynamic viscosity'] },
  { key: 'inletPressure', unit: 'Pa', label: ['入口压力', 'Inlet pressure'] },
  { key: 'outletPressure', unit: 'Pa', label: ['出口压力', 'Outlet pressure'] },
]

function readNumber(raw: string) { return raw.trim() === '' ? Number.NaN : Number(raw) }

/** Guided fields for the fixed, one-dimensional circular-pipe flow operation. */
export function ComsolPipeFlowEditor({ value, onChange, disabled = false }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pressureOrderInvalid = Number.isFinite(value.inletPressure) && Number.isFinite(value.outletPressure) && value.inletPressure <= value.outletPressure

  return (
    <section id="comsol-pipe-flow-editor" data-testid="comsol-pipe-flow-editor" className="space-y-5 rounded-xl border border-edge bg-surface p-4" aria-labelledby="comsol-pipe-flow-editor-title">
      <div>
        <h2 id="comsol-pipe-flow-editor-title" className="text-lg font-semibold text-ink">{zh ? '圆管流动研究' : 'Circular pipe-flow study'}</h2>
        <p className="mt-1 text-sm text-muted">
          {zh
            ? '固定为一根水平圆形牛顿流体管道，由入口压力驱动流向出口。输入介质密度、动力黏度及边界压力；结果中的流动状态由求解器判定。'
            : 'Fixed case: one horizontal circular pipe carrying a Newtonian fluid, driven forward by inlet pressure toward the outlet. Set fluid properties and boundary pressures; the solver reports the resulting flow regime.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, unit, label }) => {
          const title = `${label[zh ? 0 : 1]} (${unit})`
          const { min, max, step } = limits[key]
          return <label key={key} className="block text-sm text-ink">
            <span>{title}</span>
            <input
              id={`comsol-pipe-flow-${key}`}
              data-testid={`comsol-pipe-flow-${key}`}
              aria-label={title}
              type="number"
              min={min}
              max={max}
              step={step}
              value={Number.isFinite(value[key]) ? value[key] : ''}
              disabled={disabled}
              onChange={event => onChange({ ...value, [key]: readNumber(event.target.value) })}
              className={fieldClass}
            />
          </label>
        })}
      </div>
      <p className="text-xs text-muted">
        {zh
          ? '长度范围 (0, 10,000] m；内径 (0, 10] m；密度 (0, 20,000] kg/m³；动力黏度 (0, 1,000] Pa·s；压力 0–100,000,000 Pa，且入口压力必须高于出口压力。'
          : 'Ranges: length (0, 10,000] m; inner diameter (0, 10] m; density (0, 20,000] kg/m³; dynamic viscosity (0, 1,000] Pa·s; pressures 0–100,000,000 Pa, with inlet pressure above outlet pressure.'}
      </p>
      {pressureOrderInvalid && <p role="alert" className="text-sm text-red-300">{zh ? '入口压力必须高于出口压力。' : 'Inlet pressure must exceed outlet pressure.'}</p>}
    </section>
  )
}

export default ComsolPipeFlowEditor
