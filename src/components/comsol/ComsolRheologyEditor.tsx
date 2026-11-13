import { useState } from 'react'
import { useLocale } from '../../lib/i18n'
import { COMSOL_RHEOLOGY_MAX_CSV_BYTES, parseComsolRheologyCsv, type ComsolRheologyDraft } from '../../lib/sim/comsol-rheology-input'

type Props = {
  value: ComsolRheologyDraft
  onChange: (draft: ComsolRheologyDraft) => void
  onSubmit: () => void
  disabled?: boolean
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink disabled:opacity-60'
const models: Array<{ value: ComsolRheologyDraft['model']; label: [string, string] }> = [
  { value: 'newtonian', label: ['牛顿流体', 'Newtonian'] },
  { value: 'power-law', label: ['幂律', 'Power law'] },
  { value: 'carreau', label: ['Carreau', 'Carreau'] },
  { value: 'bingham', label: ['宾汉', 'Bingham'] },
  { value: 'herschel-bulkley', label: ['Herschel–Bulkley', 'Herschel–Bulkley'] },
]

type NumericKey = 'viscosity' | 'K' | 'n' | 'mu0' | 'muInf' | 'lambda' | 'muP' | 'tauY' | 'regularizationM'
type Parameter = { key: NumericKey; label: [string, string]; unit: string; min: number; max: number; step?: string }
const parameterDefinitions: Record<ComsolRheologyDraft['model'], Parameter[]> = {
  newtonian: [
    { key: 'viscosity', label: ['动力黏度', 'Dynamic viscosity'], unit: 'Pa·s', min: 1e-12, max: 1e6 },
  ],
  'power-law': [
    { key: 'K', label: ['稠度系数 K', 'Consistency index K'], unit: 'Pa·sⁿ', min: 1e-12, max: 1e6 },
    { key: 'n', label: ['流动行为指数 n', 'Flow behavior index n'], unit: '—', min: 0.01, max: 5 },
  ],
  carreau: [
    { key: 'mu0', label: ['零剪切黏度 μ₀', 'Zero-shear viscosity μ₀'], unit: 'Pa·s', min: 1e-12, max: 1e6 },
    { key: 'muInf', label: ['无限剪切黏度 μ∞', 'Infinite-shear viscosity μ∞'], unit: 'Pa·s', min: 0, max: 1e6 },
    { key: 'lambda', label: ['时间常数 λ', 'Time constant λ'], unit: 's', min: 1e-12, max: 1e6 },
    { key: 'n', label: ['流动行为指数 n', 'Flow behavior index n'], unit: '—', min: 0.01, max: 1 },
  ],
  bingham: [
    { key: 'muP', label: ['塑性黏度 μₚ', 'Plastic viscosity μₚ'], unit: 'Pa·s', min: 1e-12, max: 1e6 },
    { key: 'tauY', label: ['屈服应力 τᵧ', 'Yield stress τᵧ'], unit: 'Pa', min: 1e-12, max: 1e8 },
    { key: 'regularizationM', label: ['正则化参数 m', 'Regularization parameter m'], unit: 's', min: 1e-12, max: 1e6 },
  ],
  'herschel-bulkley': [
    { key: 'K', label: ['稠度系数 K', 'Consistency index K'], unit: 'Pa·sⁿ', min: 1e-12, max: 1e6 },
    { key: 'n', label: ['流动行为指数 n', 'Flow behavior index n'], unit: '—', min: 0.01, max: 5 },
    { key: 'tauY', label: ['屈服应力 τᵧ', 'Yield stress τᵧ'], unit: 'Pa', min: 1e-12, max: 1e8 },
    { key: 'regularizationM', label: ['正则化参数 m', 'Regularization parameter m'], unit: 's', min: 1e-12, max: 1e6 },
  ],
}

function readNumber(raw: string) { return raw.trim() === '' ? Number.NaN : Number(raw) }

/** Configure one supported generalized-Newtonian rheology and its shear-rate sample points. */
export function ComsolRheologyEditor({ value: draft, onChange, onSubmit, disabled = false }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const update = (patch: Partial<ComsolRheologyDraft>) => {
    onChange({ ...draft, ...patch })
    setError('')
    setSubmitted(false)
  }
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const updateCsv = (csv: string) => {
    try {
      const shearRates = parseComsolRheologyCsv(csv)
      update({ csv, shearRates })
    } catch (cause) {
      update({ csv, shearRates: [] })
      setError(cause instanceof Error ? cause.message : (zh ? '无法解析剪切速率 CSV。' : 'Could not parse shear-rate CSV.'))
    }
  }

  const onFile = async (file?: File) => {
    if (!file) return
    if (file.size > COMSOL_RHEOLOGY_MAX_CSV_BYTES) {
      setError(zh ? `CSV 文件不能超过 ${COMSOL_RHEOLOGY_MAX_CSV_BYTES.toLocaleString()} 字节。` : `CSV files must not exceed ${COMSOL_RHEOLOGY_MAX_CSV_BYTES.toLocaleString()} bytes.`)
      return
    }
    updateCsv(await file.text())
  }

  const parameters = parameterDefinitions[draft.model]
  const validateAndSubmit = () => {
    setError('')
    setSubmitted(false)
    let shearRates = draft.shearRates
    if (draft.csv.trim()) {
      try {
        shearRates = parseComsolRheologyCsv(draft.csv)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : (zh ? '无法解析剪切速率 CSV。' : 'Could not parse shear-rate CSV.'))
        return
      }
    }
    for (const parameter of parameters) {
      const value = draft[parameter.key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) {
        setError(zh
          ? `${parameter.label[0]} 必须是 ${parameter.min} 到 ${parameter.max} 之间的有限数值。`
          : `${parameter.label[1]} must be a finite value from ${parameter.min} to ${parameter.max}.`)
        return
      }
    }
    if (draft.model === 'carreau' && draft.muInf >= draft.mu0) {
      setError(zh ? '无限剪切黏度必须低于零剪切黏度。' : 'Infinite-shear viscosity must be lower than zero-shear viscosity.')
      return
    }
    if (shearRates.length < 1 || shearRates.length > 256 || shearRates.some(rate => !Number.isFinite(rate) || rate < 0)) {
      setError(zh ? '剪切速率点须为 1–256 个大于或等于 0 的有限数值。' : 'Provide 1–256 finite shear-rate points at or above 0 s⁻¹.')
      return
    }
    setSubmitted(true)
    onSubmit()
  }

  return <section id="comsol-rheology-editor" data-testid="comsol-rheology-editor" className="space-y-5 rounded-xl border border-edge bg-surface p-4" aria-labelledby="comsol-rheology-editor-title">
    <div>
      <h2 id="comsol-rheology-editor-title" className="text-lg font-semibold text-ink">{zh ? '非牛顿流变模型' : 'Generalized Newtonian rheology'}</h2>
      <p className="mt-1 text-sm text-muted">{zh ? '选择黏度模型，填写对应参数，并提供用于计算的剪切速率点。' : 'Choose a viscosity model, set its parameters, and provide shear-rate points for evaluation.'}</p>
    </div>
    <label className="block text-sm text-ink"><span>{zh ? '流变模型' : 'Rheology model'}</span>
      <select aria-label={zh ? '流变模型' : 'Rheology model'} value={draft.model} disabled={disabled} onChange={event => update({ model: event.currentTarget.value as ComsolRheologyDraft['model'] })} className={fieldClass}>
        {models.map(model => <option key={model.value} value={model.value}>{model.label[zh ? 0 : 1]}</option>)}
      </select>
    </label>
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink">{zh ? '模型参数' : 'Model parameters'}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {parameters.map(parameter => {
          const label = `${parameter.label[zh ? 0 : 1]} (${parameter.unit})`
          const value = draft[parameter.key]
          return <label key={parameter.key} className="block text-sm text-ink"><span>{label}</span>
            <input type="number" min={parameter.min} max={parameter.max} step={parameter.step ?? 'any'} aria-label={label} value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={event => update({ [parameter.key]: readNumber(event.currentTarget.value) })} className={fieldClass} />
          </label>
        })}
      </div>
      {(draft.model === 'bingham' || draft.model === 'herschel-bulkley') && <p className="text-xs text-muted">{zh ? '屈服模型使用显式正则化参数。' : 'Yield-stress models use the explicit regularization parameter shown above.'}</p>}
    </fieldset>
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-ink">{zh ? '剪切速率点' : 'Shear-rate points'}</h3>
        <p className="mt-1 text-xs text-muted">{zh ? '剪切速率单位为 s⁻¹，数值须有限且大于或等于 0，最多 256 点。' : 'Shear rate uses s⁻¹; values must be finite and at or above 0, with at most 256 points.'}</p>
      </div>
      <label className="block text-sm text-ink">{zh ? '导入 CSV 文件' : 'Upload CSV file'}
        <input type="file" accept=".csv,text/csv" disabled={disabled} onChange={event => { void onFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded file:border file:border-edge file:bg-surface file:px-3 file:py-2" />
      </label>
      <label className="block text-sm text-ink"><span>{zh ? '剪切速率 CSV（单列）' : 'Shear-rate CSV (one column)'}</span>
        <textarea aria-label={zh ? '剪切速率 CSV（单列）' : 'Shear-rate CSV (one column)'} value={draft.csv} disabled={disabled} onChange={event => updateCsv(event.currentTarget.value)} spellCheck={false} rows={5} className="mt-1 block w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100" />
      </label>
      <p className="text-xs text-muted" aria-live="polite">{zh ? `已解析 ${draft.shearRates.length} 个剪切速率点` : `${draft.shearRates.length} shear-rate points parsed`}</p>
      {draft.shearRates.length > 0 && <ol aria-label={zh ? '剪切速率点列表' : 'Shear-rate point list'} className="grid gap-2 sm:grid-cols-2">
        {draft.shearRates.map((rate, index) => <li key={index} className="rounded border border-edge px-3 py-2 text-sm text-ink">{index + 1}. {rate} s⁻¹</li>)}
      </ol>}
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!error && submitted && <p role="status" className="text-sm text-emerald-300">{zh ? '流变输入已验证并提交。' : 'Rheology inputs validated and submitted.'}</p>}
    <button type="button" disabled={disabled} onClick={validateAndSubmit} className="rounded-lg border border-edge bg-panel px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">{zh ? '验证并应用流变模型' : 'Validate and apply rheology model'}</button>
  </section>
}

export default ComsolRheologyEditor
