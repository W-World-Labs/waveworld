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

/** Edits the prescribed kinetic and ohmic loss parameters for the PEMFC study. */
export function PemfcLossesEditor({ value, onChange }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const update = (patch: Partial<PemfcStudyDraft>) => onChange({ ...value, ...patch })

  return (
    <section data-testid="pemfc-losses-editor" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-ink">
          <span>{zh ? '交换电流密度 j₀ (A/cm²)' : 'Exchange current density j₀ (A/cm²)'}</span>
          <input id="pemfc-exchange-current" data-testid="pemfc-exchange-current" type="number" min={1e-8} max={0.1} step="any" value={displayNumber(value.j0)} onChange={event => update({ j0: numericValue(event.target.value) })} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '电荷转移系数 α (无量纲)' : 'Charge-transfer coefficient α (dimensionless)'}</span>
          <input id="pemfc-transfer-coefficient" data-testid="pemfc-transfer-coefficient" type="number" min={0.1} max={1} step="any" value={displayNumber(value.alpha)} onChange={event => update({ alpha: numericValue(event.target.value) })} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '比欧姆电阻 R (Ω·cm²)' : 'Area-specific ohmic resistance R (Ω·cm²)'}</span>
          <input id="pemfc-resistance" data-testid="pemfc-resistance" type="number" min={0} max={5} step="any" value={displayNumber(value.R)} onChange={event => update({ R: numericValue(event.target.value) })} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink">
          <span>{zh ? '极限电流密度 jₗᵢₘ (A/cm²)' : 'Limiting current density jₗᵢₘ (A/cm²)'}</span>
          <input id="pemfc-limiting-current" data-testid="pemfc-limiting-current" type="number" min={0.01} max={10} step="any" value={displayNumber(value.jLim)} onChange={event => update({ jLim: numericValue(event.target.value) })} className={fieldClass} />
        </label>
      </div>
      <p className="text-xs text-muted">
        {zh
          ? '该简化模型使用 Tafel 活化损失；引导范围要求正电流不低于 j₀，因此活化损失非负。原生模型将电池电压下限截为 0 V。'
          : 'This bounded model uses a Tafel activation loss and keeps positive current at or above j₀, so activation loss stays nonnegative. The native model floors cell voltage at 0 V.'}
      </p>
    </section>
  )
}
