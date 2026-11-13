import type { ChangeEvent } from 'react'
import { useLocale } from '../../lib/i18n'
import type { LensRayBundleOptions } from '../../lib/sim/lens-ray-bundle'

export interface LensBundleEditorProps {
  value: LensRayBundleOptions
  onChange: (next: LensRayBundleOptions) => void
}

type BundleControl = {
  key: keyof LensRayBundleOptions
  testId: string
  label: string
  unit: string
  min: number
  max: number
  step: number
}

const controls: BundleControl[] = [
  { key: 'launchDistance', testId: 'lens-launch-distance', label: 'Launch distance', unit: 'mm', min: 0.001, max: 10_000, step: 0.1 },
  { key: 'launchRadius', testId: 'lens-launch-radius', label: 'Launch radius', unit: 'mm', min: 0.001, max: 1_000, step: 0.1 },
  { key: 'rings', testId: 'lens-rings', label: 'Rings', unit: 'count', min: 1, max: 4, step: 1 },
  { key: 'spokes', testId: 'lens-spokes', label: 'Spokes per ring', unit: 'count', min: 4, max: 16, step: 1 },
  { key: 'fieldXDeg', testId: 'lens-field-x', label: 'X field angle', unit: '°', min: -30, max: 30, step: 0.1 },
  { key: 'fieldYDeg', testId: 'lens-field-y', label: 'Y field angle', unit: '°', min: -30, max: 30, step: 0.1 },
]

export function LensBundleEditor({ value, onChange }: LensBundleEditorProps) {
  const { locale } = useLocale()
  const zh = locale === 'zh'

  const update = (key: keyof LensRayBundleOptions, event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value
    // An empty field remains invalid (NaN) so validation can explain it; it must not become zero.
    const nextValue = raw === '' ? Number.NaN : event.currentTarget.valueAsNumber
    onChange({ ...value, [key]: nextValue })
  }

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <legend className="px-1 text-sm font-semibold">{zh ? '光线束' : 'Ray bundle'}</legend>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
        {zh
          ? '在透镜前的发射平面上按等权重中心与环采样；这不是入瞳瞄准。'
          : 'Equal-weight center and ring sampling on the launch plane; this is not pupil aiming.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {controls.map((control) => {
          const id = `lens-bundle-${control.key}`
          const label = zh
            ? ({
                launchDistance: '发射距离',
                launchRadius: '发射半径',
                rings: '环数',
                spokes: '每环光线数',
                fieldXDeg: 'X 视场角',
                fieldYDeg: 'Y 视场角',
              } as const)[control.key]
            : control.label
          const unit = zh && control.unit === 'count' ? '个' : control.unit
          return (
            <div key={control.key}>
              <label className="mb-1 block text-sm" htmlFor={id}>
                {label} <span className="text-slate-500">({unit})</span>
              </label>
              <input
                id={id}
                data-testid={control.testId}
                type="number"
                min={control.min}
                max={control.max}
                step={control.step}
                value={Number.isFinite(value[control.key]) ? value[control.key] : ''}
                onChange={(event) => update(control.key, event)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
              <span className="sr-only">
                {zh ? `范围 ${control.min} 至 ${control.max} ${unit}` : `Range ${control.min} to ${control.max} ${unit}`}
              </span>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
