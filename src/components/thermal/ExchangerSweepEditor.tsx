import type { ChangeEvent } from 'react'
import { useLocale } from '../../lib/i18n'
import { createExchangerUaValues, type ExchangerSweepRange } from '../../lib/sim/exchanger-sweep-range'

export interface ExchangerSweepEditorProps {
  value: ExchangerSweepRange
  onChange: (next: ExchangerSweepRange) => void
}

function numericValue(raw: string, valueAsNumber: number): number {
  return raw === '' ? Number.NaN : valueAsNumber
}

export function ExchangerSweepEditor({ value, onChange }: ExchangerSweepEditorProps) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const updateNumber = (key: 'start' | 'end' | 'points', event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, [key]: numericValue(event.currentTarget.value, event.currentTarget.valueAsNumber) })
  }

  let preview: number[] | null = null
  let previewError: string | null = null
  try {
    preview = createExchangerUaValues(value)
  } catch (error) {
    previewError = error instanceof Error ? error.message : (zh ? '范围无效' : 'Invalid sweep range')
  }

  const fields = [
    { id: 'exchanger-ua-start', key: 'start' as const, label: zh ? 'UA 起始值' : 'UA start', min: 1e-6, max: 1e9, step: 'any' },
    { id: 'exchanger-ua-end', key: 'end' as const, label: zh ? 'UA 结束值' : 'UA end', min: 1e-6, max: 1e9, step: 'any' },
    { id: 'exchanger-ua-points', key: 'points' as const, label: zh ? '采样点' : 'Points', min: 2, max: 64, step: 1 },
  ]

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <legend className="px-1 text-sm font-semibold">{zh ? 'UA 扫描' : 'UA sweep'}</legend>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
        {zh ? 'UA 单位为 W/K；温度输入与输出使用 K。采样点数为 2–64。' : 'UA is in W/K; temperatures use K. Choose 2–64 sample points.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(({ id, key, label, min, max, step }) => (
          <div key={id}>
            <label className="mb-1 block text-sm" htmlFor={id}>{label} <span className="text-slate-500">({key === 'points' ? (zh ? '个' : 'count') : 'W/K'})</span></label>
            <input
              id={id}
              data-testid={id}
              type="number"
              min={min}
              max={max}
              step={step}
              value={Number.isFinite(value[key]) ? value[key] : ''}
              onChange={(event) => updateNumber(key, event)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </div>
        ))}
        <div>
          <label className="mb-1 block text-sm" htmlFor="exchanger-ua-spacing">{zh ? '采样间距' : 'Spacing'}</label>
          <select
            id="exchanger-ua-spacing"
            data-testid="exchanger-ua-spacing"
            value={value.spacing}
            onChange={(event) => onChange({ ...value, spacing: event.currentTarget.value as ExchangerSweepRange['spacing'] })}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="linear">{zh ? '线性' : 'Linear'}</option>
            <option value="log">{zh ? '对数' : 'Logarithmic'}</option>
          </select>
        </div>
      </div>
      <div className="mt-3 text-sm" aria-live="polite">
        <span className="font-medium">{zh ? '采样预览：' : 'Sample preview: '}</span>
        {preview
          ? <output>{preview.map((sample) => `${sample} W/K`).join(', ')}</output>
          : <span role="alert" className="text-red-700 dark:text-red-300">{previewError}</span>}
      </div>
    </fieldset>
  )
}
