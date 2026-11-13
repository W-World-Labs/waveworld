import type { PemfcStudyDraft } from '../../lib/sim/pemfc-study-input'
import { useLocale } from '../../lib/i18n'

type Props = {
  value: PemfcStudyDraft
  onChange: (next: PemfcStudyDraft) => void
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'

function numericValue(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw)
}

function displayNumber(value: number): number | '' {
  return Number.isFinite(value) ? value : ''
}

/** Edits prescribed temperature and gas partial pressures for the PEMFC study. */
export function PemfcConditionsEditor({ value, onChange }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const update = (patch: Partial<PemfcStudyDraft>) => onChange({ ...value, ...patch })

  return (
    <section data-testid="pemfc-conditions-editor" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-ink">
          <span>{zh ? '工作温度 (K)' : 'Operating temperature (K)'}</span>
          <input
            id="pemfc-temperature"
            data-testid="pemfc-temperature"
            type="number"
            min={273.15}
            max={393.15}
            step="any"
            value={displayNumber(value.T)}
            onChange={event => update({ T: numericValue(event.target.value) })}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '氢气分压 (atm)' : 'Hydrogen partial pressure (atm)'}</span>
          <input
            id="pemfc-hydrogen-pressure"
            data-testid="pemfc-hydrogen-pressure"
            type="number"
            min={0.01}
            max={10}
            step="any"
            value={displayNumber(value.pH2)}
            onChange={event => update({ pH2: numericValue(event.target.value) })}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '氧气分压 (atm)' : 'Oxygen partial pressure (atm)'}</span>
          <input
            id="pemfc-oxygen-pressure"
            data-testid="pemfc-oxygen-pressure"
            type="number"
            min={0.01}
            max={10}
            step="any"
            value={displayNumber(value.pO2)}
            onChange={event => update({ pO2: numericValue(event.target.value) })}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '水蒸气分压 (atm)' : 'Water vapor partial pressure (atm)'}</span>
          <input
            id="pemfc-water-pressure"
            data-testid="pemfc-water-pressure"
            type="number"
            min={0.01}
            max={10}
            step="any"
            value={displayNumber(value.pH2O)}
            onChange={event => update({ pH2O: numericValue(event.target.value) })}
            className={fieldClass}
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        {zh
          ? '温度范围为 273.15–393.15 K；各气体分压范围为 0.01–10 atm。输入的是固定分压，不是相对湿度；这些条件在整个极化扫描中保持不变。'
          : 'Temperature range: 273.15–393.15 K. Each gas partial pressure: 0.01–10 atm. Enter prescribed partial pressure, not relative humidity; these conditions stay fixed across the polarization sweep.'}
      </p>
    </section>
  )
}
