import type { ChangeEvent } from 'react'
import { useLocale } from '../../lib/i18n'
import type { PemfcStudyDraft } from '../../lib/sim/pemfc-study-input'

export interface PemfcSweepEditorProps {
  value: PemfcStudyDraft
  onChange: (next: PemfcStudyDraft) => void
}

function numericValue(raw: string, valueAsNumber: number): number {
  return raw === '' ? Number.NaN : valueAsNumber
}

export function PemfcSweepEditor({ value, onChange }: PemfcSweepEditorProps) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const update = (key: 'j' | 'imax' | 'points', event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, [key]: numericValue(event.currentTarget.value, event.currentTarget.valueAsNumber) })
  }

  const fields = [
    {
      id: 'pemfc-operating-current',
      key: 'j' as const,
      label: zh ? '工作电流密度' : 'Operating current density',
      unit: 'A/cm²',
      min: 0,
      max: Number.isFinite(value.imax) ? value.imax : 10,
      step: 'any',
    },
    {
      id: 'pemfc-max-current',
      key: 'imax' as const,
      label: zh ? '扫描最大电流密度' : 'Sweep maximum current density',
      unit: 'A/cm²',
      min: 0.001,
      max: 10,
      step: 'any',
    },
    {
      id: 'pemfc-points',
      key: 'points' as const,
      label: zh ? '曲线采样点数' : 'Curve sample points',
      unit: zh ? '个' : 'count',
      min: 2,
      max: 201,
      step: 1,
    },
  ]

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <legend className="px-1 text-sm font-semibold">{zh ? '极化曲线扫描' : 'Polarization sweep'}</legend>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
        {zh
          ? '工作点电流独立于曲线采样位置；曲线从 0 扫描到最大电流密度，采样等间距。n=2、E₀=1.229 V 固定。'
          : 'The operating current is evaluated separately and need not lie on a curve sample. The curve samples evenly from 0 to the maximum current density. n=2 and E₀=1.229 V are fixed.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(({ id, key, label, unit, min, max, step }) => (
          <div key={id}>
            <label className="mb-1 block text-sm" htmlFor={id}>
              {label} <span className="text-slate-500">({unit})</span>
            </label>
            <input
              id={id}
              data-testid={id}
              type="number"
              min={min}
              max={max}
              step={step}
              value={Number.isFinite(value[key]) ? value[key] : ''}
              onChange={(event) => update(key, event)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
            <span className="sr-only">
              {zh ? `范围 ${min} 至 ${max} ${unit}` : `Range ${min} to ${max} ${unit}`}
            </span>
          </div>
        ))}
      </div>
    </fieldset>
  )
}
