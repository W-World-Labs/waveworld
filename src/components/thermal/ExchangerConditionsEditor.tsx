import type { ExchangerStudyDraft } from '../../lib/sim/exchanger-study-input'
import { useLocale } from '../../lib/i18n'

type Props = {
  value: ExchangerStudyDraft
  onChange: (value: ExchangerStudyDraft) => void
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'

function numericValue(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw)
}

function displayNumber(value: number): number | '' {
  return Number.isFinite(value) ? value : ''
}

/** Edits the fixed exchanger arrangement and inlet conditions for a UA sweep. */
export function ExchangerConditionsEditor({ value, onChange }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const update = (patch: Partial<ExchangerStudyDraft>) => onChange({ ...value, ...patch })

  return (
    <section data-testid="exchanger-conditions-editor" className="space-y-4">
      <label className="block text-sm text-ink">
        <span>{zh ? '流动布置' : 'Arrangement'}</span>
        <select
          id="exchanger-arrangement"
          data-testid="exchanger-arrangement"
          value={value.arrangement}
          onChange={event => update({ arrangement: event.target.value as ExchangerStudyDraft['arrangement'] })}
          className={fieldClass}
        >
          <option value="counterflow">{zh ? '逆流' : 'Counterflow'}</option>
          <option value="parallel">{zh ? '并流' : 'Parallel flow'}</option>
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-ink">
          <span>{zh ? '热侧热容量率 (W/K)' : 'Hot-side heat capacity rate (W/K)'}</span>
          <input id="exchanger-hot-capacity" data-testid="exchanger-hot-capacity" type="number" step="any" value={displayNumber(value.Chot)} onChange={event => update({ Chot: numericValue(event.target.value) })} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '冷侧热容量率 (W/K)' : 'Cold-side heat capacity rate (W/K)'}</span>
          <input id="exchanger-cold-capacity" data-testid="exchanger-cold-capacity" type="number" step="any" value={displayNumber(value.Ccold)} onChange={event => update({ Ccold: numericValue(event.target.value) })} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '热侧入口温度 (K)' : 'Hot-side inlet temperature (K)'}</span>
          <input id="exchanger-hot-inlet" data-testid="exchanger-hot-inlet" type="number" step="any" value={displayNumber(value.T_hot_in)} onChange={event => update({ T_hot_in: numericValue(event.target.value) })} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '冷侧入口温度 (K)' : 'Cold-side inlet temperature (K)'}</span>
          <input id="exchanger-cold-inlet" data-testid="exchanger-cold-inlet" type="number" step="any" value={displayNumber(value.T_cold_in)} onChange={event => update({ T_cold_in: numericValue(event.target.value) })} className={fieldClass} />
        </label>
      </div>
      <p className="text-xs text-muted">{zh ? '入口温度以 K 输入；两侧入口温度固定于整个 UA 扫描。' : 'Enter inlet temperatures in K. Both inlet temperatures stay fixed across the UA sweep.'}</p>
    </section>
  )
}
