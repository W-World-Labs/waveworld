import { useState } from 'react'
import { useLocale } from '../../lib/i18n'
import { COMSOL_MATERIAL_TABLE_MAX_BYTES, readComsolMaterialTable } from '../../lib/sim/comsol-material-table'

export type ComsolMaterialPropertyKind = 'conductivity' | 'specificHeat'
export type ComsolMaterialInterpolation = 'linear' | 'pchip'
export type ComsolMaterialExtrapolation = 'constant' | 'linear'

export type ComsolMaterialTableSnapshot = {
  propertyKind: ComsolMaterialPropertyKind
  meaning: string
  unit: 'W/(m·K)' | 'J/(kg·K)'
  rows: Array<{ temperatureK: number; value: number }>
  evaluationTemperatureK: number
  interpolation: ComsolMaterialInterpolation
  extrapolation: ComsolMaterialExtrapolation
  csv: string
}

type Props = {
  onSubmit: (snapshot: ComsolMaterialTableSnapshot) => void
  disabled?: boolean
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink disabled:opacity-60'

function readNumber(raw: string) {
  return raw.trim() === '' ? Number.NaN : Number(raw)
}

/** Import and configure a temperature-dependent COMSOL material property table. */
export function ComsolMaterialTableEditor({ onSubmit, disabled = false }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [csv, setCsv] = useState('')
  const [propertyKind, setPropertyKind] = useState<ComsolMaterialPropertyKind>('conductivity')
  const [temperature, setTemperature] = useState('293.15')
  const [interpolation, setInterpolation] = useState<ComsolMaterialInterpolation>('linear')
  const [extrapolation, setExtrapolation] = useState<ComsolMaterialExtrapolation>('constant')
  const [error, setError] = useState('')
  const [validated, setValidated] = useState(false)

  const propertyMeaning = propertyKind === 'conductivity'
    ? (zh ? '导热系数' : 'Thermal conductivity')
    : (zh ? '比热容' : 'Specific heat capacity')
  const unit = propertyKind === 'conductivity' ? 'W/(m·K)' : 'J/(kg·K)'

  const updateCsv = (value: string) => {
    setCsv(value)
    setError('')
    setValidated(false)
  }

  const onFile = async (file?: File) => {
    if (!file) return
    if (file.size > COMSOL_MATERIAL_TABLE_MAX_BYTES) {
      setError(zh
        ? `CSV 文件超过 ${COMSOL_MATERIAL_TABLE_MAX_BYTES.toLocaleString()} 字节限制。`
        : `CSV file exceeds the ${COMSOL_MATERIAL_TABLE_MAX_BYTES.toLocaleString()}-byte limit.`)
      return
    }
    updateCsv(await file.text())
  }

  const validateAndSubmit = () => {
    setError('')
    setValidated(false)
    let rows: ComsolMaterialTableSnapshot['rows']
    try {
      const table = readComsolMaterialTable(csv)
      if (table.property !== propertyKind) {
        throw new Error(zh
          ? 'CSV 属性列与所选材料属性不匹配。'
          : 'The CSV property column does not match the selected material property.')
      }
      rows = table.rows.map(([temperatureK, value]) => ({ temperatureK, value }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '无法解析 CSV。' : 'Could not parse CSV.'))
      return
    }
    const evaluationTemperatureK = readNumber(temperature)
    if (!Number.isFinite(evaluationTemperatureK) || evaluationTemperatureK <= 0) {
      setError(zh ? '评估温度必须是大于 0 K 的有限数值。' : 'Evaluation temperature must be a finite value above 0 K.')
      return
    }
    const snapshot: ComsolMaterialTableSnapshot = {
      propertyKind,
      meaning: propertyMeaning,
      unit,
      rows: rows.map(row => ({ temperatureK: row.temperatureK, value: row.value })),
      evaluationTemperatureK,
      interpolation,
      extrapolation,
      csv,
    }
    setValidated(true)
    onSubmit(snapshot)
  }

  return <section data-testid="comsol-material-table-editor" className="space-y-4 rounded-xl border border-edge bg-surface p-4" aria-labelledby="comsol-material-table-title">
    <div>
      <h2 id="comsol-material-table-title" className="text-lg font-semibold text-ink">{zh ? 'COMSOL 材料属性表' : 'COMSOL material property table'}</h2>
      <p className="mt-1 text-sm text-muted">{zh ? '导入或粘贴温度相关材料属性 CSV，并设置求值选项。' : 'Import or paste a temperature-dependent material property CSV and choose evaluation settings.'}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm text-ink"><span>{zh ? '材料属性' : 'Material property'}</span>
        <select aria-label={zh ? '材料属性' : 'Material property'} value={propertyKind} disabled={disabled} onChange={event => { setPropertyKind(event.currentTarget.value as ComsolMaterialPropertyKind); setError(''); setValidated(false) }} className={fieldClass}>
          <option value="conductivity">{zh ? '导热系数' : 'Thermal conductivity'} (W/(m·K))</option>
          <option value="specificHeat">{zh ? '比热容' : 'Specific heat capacity'} (J/(kg·K))</option>
        </select>
      </label>
      <label className="block text-sm text-ink"><span>{zh ? '评估温度 (K)' : 'Evaluation temperature (K)'}</span>
        <input aria-label={zh ? '评估温度 (K)' : 'Evaluation temperature (K)'} type="number" min="0" step="any" value={temperature} disabled={disabled} onChange={event => { setTemperature(event.currentTarget.value); setError(''); setValidated(false) }} className={fieldClass} />
      </label>
      <label className="block text-sm text-ink"><span>{zh ? '插值方法' : 'Interpolation'}</span>
        <select aria-label={zh ? '插值方法' : 'Interpolation'} value={interpolation} disabled={disabled} onChange={event => { setInterpolation(event.currentTarget.value as ComsolMaterialInterpolation); setValidated(false) }} className={fieldClass}>
          <option value="linear">{zh ? '线性' : 'Linear'}</option><option value="pchip">PCHIP</option>
        </select>
      </label>
      <label className="block text-sm text-ink"><span>{zh ? '外推方法' : 'Extrapolation'}</span>
        <select aria-label={zh ? '外推方法' : 'Extrapolation'} value={extrapolation} disabled={disabled} onChange={event => { setExtrapolation(event.currentTarget.value as ComsolMaterialExtrapolation); setValidated(false) }} className={fieldClass}>
          <option value="constant">{zh ? '常数' : 'Constant'}</option><option value="linear">{zh ? '线性' : 'Linear'}</option>
        </select>
      </label>
    </div>
    <label className="block text-sm text-ink">{zh ? '选择 CSV 文件' : 'Choose CSV file'}
      <input type="file" accept=".csv,text/csv" disabled={disabled} onChange={event => { void onFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded file:border file:border-edge file:bg-surface file:px-3 file:py-2" />
    </label>
    <label className="block text-sm text-ink">{zh ? 'CSV 文本' : 'CSV text'}
      <textarea aria-label={zh ? 'CSV 文本' : 'CSV text'} value={csv} disabled={disabled} onChange={event => updateCsv(event.currentTarget.value)} spellCheck={false} rows={8} className="mt-1 block w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100" />
    </label>
    <p className="text-xs text-muted">{zh ? `当前属性：${propertyMeaning}（${unit}）。温度列使用 K。` : `Selected property: ${propertyMeaning} (${unit}). The temperature column uses K.`}</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!error && validated && <p role="status" className="text-sm text-emerald-300">{zh ? '材料表已验证并提交。' : 'Material table validated and submitted.'}</p>}
    <button type="button" disabled={disabled} onClick={validateAndSubmit} className="rounded-lg border border-edge bg-panel px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">{zh ? '验证并应用材料表' : 'Validate and apply table'}</button>
  </section>
}

export default ComsolMaterialTableEditor
