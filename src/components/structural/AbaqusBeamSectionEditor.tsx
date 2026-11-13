import type { ChangeEvent } from 'react'
import { useLocale } from '../../lib/i18n'
import type { AbaqusBeamStudyDraft } from '../../lib/sim/abaqus-beam-study-input'

type Props = {
  value: AbaqusBeamStudyDraft
  onChange: (next: AbaqusBeamStudyDraft) => void
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'

const fields = [
  { key: 'E', unit: 'Pa', label: 'Young’s modulus', labelZh: '杨氏模量' },
  { key: 'A', unit: 'm²', label: 'Cross-sectional area', labelZh: '截面积' },
  { key: 'I', unit: 'm⁴', label: 'Second moment of area', labelZh: '截面二次矩' },
  { key: 'nu', unit: '—', label: 'Poisson’s ratio', labelZh: '泊松比' },
  { key: 'k', unit: '—', label: 'Shear correction factor', labelZh: '剪切修正系数' },
] as const

function numericValue(event: ChangeEvent<HTMLInputElement>): number {
  return event.currentTarget.value === '' ? Number.NaN : event.currentTarget.valueAsNumber
}

function displayNumber(value: number): number | '' {
  return Number.isFinite(value) ? value : ''
}

/** Edits the uniform elastic section parameters used by the B31 study. */
export function AbaqusBeamSectionEditor({ value, onChange }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'

  return (
    <fieldset data-testid="abaqus-beam-section-editor" className="space-y-4">
      <legend className="text-sm font-semibold text-ink">{zh ? '均匀梁截面' : 'Uniform beam section'}</legend>
      <p className="text-xs text-muted">
        {zh
          ? '线弹性、均匀材料参数；面积惯性矩按弯曲轴输入。'
          : 'Use one uniform linear-elastic section; enter the area moment about the bending axis.'}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(({ key, unit, label, labelZh }) => {
          const id = `abaqus-beam-section-${key}`
          return (
            <label key={key} htmlFor={id} className="block text-sm text-ink">
              <span>{zh ? labelZh : label} ({unit})</span>
              <input
                id={id}
                data-testid={id}
                type="number"
                step="any"
                value={displayNumber(value.section[key])}
                onChange={event => onChange({
                  ...value,
                  section: { ...value.section, [key]: numericValue(event) },
                })}
                className={fieldClass}
              />
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted">
        {zh
          ? '所有数值须为有限正数；泊松比和剪切修正系数须处于验证器允许范围内。清空字段可暂存为空并由提交验证提示。'
          : 'Values must be finite and positive; Poisson’s ratio and the shear correction factor must satisfy the input validator. A cleared field stays blank and is reported on validation.'}
      </p>
    </fieldset>
  )
}
