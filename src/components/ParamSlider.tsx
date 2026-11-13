/**
 * 参数滑条：标签 + 值 + 单位 + range，与 useSyncedParam 的 set 对接。
 * 显示契约：名称=值[ 单位]（#2 step 3.4）。
 */
import { formatParamLabel } from './paramLabel'

export function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  onChange,
  ariaLabel,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  format?: (v: number) => string
  onChange: (v: number) => void
  ariaLabel?: string
}) {
  const shown = format ? format(value) : String(value)
  const text = formatParamLabel(label, shown, unit)
  return (
    <label className="flex items-center gap-2 text-slate-400">
      <span className="whitespace-nowrap">{text}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel ?? text}
      />
    </label>
  )
}
