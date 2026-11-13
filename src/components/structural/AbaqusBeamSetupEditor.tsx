import { useEffect, useState } from 'react'
import type { AbaqusBeamStudyDraft } from '../../lib/sim/abaqus-beam-study-input'
import { useLocale } from '../../lib/i18n'

type Props = {
  value: AbaqusBeamStudyDraft
  onChange: (next: AbaqusBeamStudyDraft) => void
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'

function numericText(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

function numericValue(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw)
}

/** Edits beam geometry and mesh size; the study uses a fixed cantilever at x=0. */
export function AbaqusBeamSetupEditor({ value, onChange }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [lengthText, setLengthText] = useState(() => numericText(value.length))
  const [elementsText, setElementsText] = useState(() => numericText(value.elements))

  useEffect(() => setLengthText(numericText(value.length)), [value.length])
  useEffect(() => setElementsText(numericText(value.elements)), [value.elements])

  return (
    <section data-testid="abaqus-beam-setup-editor" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-ink">
          <span>{zh ? '梁长 L (m)' : 'Beam length L (m)'}</span>
          <input
            id="abaqus-beam-length"
            data-testid="abaqus-beam-length"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={lengthText}
            onChange={event => {
              const raw = event.target.value
              setLengthText(raw)
              onChange({ ...value, length: numericValue(raw) })
            }}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? 'B31 单元数' : 'B31 element count'}</span>
          <input
            id="abaqus-beam-elements"
            data-testid="abaqus-beam-elements"
            type="number"
            min="1"
            max="2048"
            step="1"
            inputMode="numeric"
            value={elementsText}
            onChange={event => {
              const raw = event.target.value
              setElementsText(raw)
              onChange({ ...value, elements: numericValue(raw) })
            }}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="rounded-lg border border-edge bg-surface/50 p-3 text-sm text-ink" data-testid="abaqus-beam-boundary">
        <p className="font-medium">{zh ? '边界条件：悬臂梁' : 'Boundary condition: cantilever'}</p>
        <p className="mt-1 text-muted">
          {zh
            ? 'x = 0 端完全固定（平移与转动均约束）；x = L 端自由。此研究固定使用该边界。'
            : 'The x = 0 end is fully fixed (translation and rotation constrained); the x = L end is free. This study uses this boundary condition.'}
        </p>
      </div>
      <p className="text-xs text-muted">
        {zh
          ? '梁长须为有限正数；单元数为 1–2048 的整数。清空数值会保留为空并使输入无效。'
          : 'Length must be a finite positive number; element count must be an integer from 1 to 2048. Clearing a numeric field keeps it blank and makes the input invalid.'}
      </p>
    </section>
  )
}
