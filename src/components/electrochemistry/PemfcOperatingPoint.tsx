import { useLocale } from '../../lib/i18n'
import type { PemfcStudyResult } from '../../lib/sim/pemfc-study-result'

type Props = { result: PemfcStudyResult }

/** Presents the native scalar evaluation separately from the sampled curve. */
export function PemfcOperatingPoint({ result }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const point = result.result
  const rows = [
    { label: zh ? '工作电流密度' : 'Operating current density', value: point.j, unit: 'A/cm²' },
    { label: zh ? '能斯特电压' : 'Nernst voltage', value: point.E_nernst, unit: 'V' },
    { label: zh ? '活化损失' : 'Activation loss', value: point.eta_act, unit: 'V' },
    { label: zh ? '欧姆损失' : 'Ohmic loss', value: point.eta_ohm, unit: 'V' },
    { label: zh ? '浓差损失' : 'Concentration loss', value: point.eta_conc, unit: 'V' },
    { label: zh ? '电池电压' : 'Cell voltage', value: point.V, unit: 'V' },
    { label: zh ? '功率密度' : 'Power density', value: point.powerDensity, unit: 'W/cm²' },
    { label: zh ? '电压效率' : 'Voltage efficiency', value: point.voltageEfficiency * 100, unit: '%' },
  ]

  return (
    <section id="pemfc-operating-point" data-testid="pemfc-operating-point" className="rounded-lg border border-edge bg-surface p-4 text-ink">
      <h3 className="text-base font-semibold">{zh ? '独立工作点' : 'Separate operating point'}</h3>
      <p className="mt-1 text-sm text-muted">
        {zh ? '以下标量结果对应指定的工作电流密度，与曲线采样点分别计算。' : 'These scalar results are evaluated at the specified operating current density, separately from the curve samples.'}
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map(({ label, value, unit }) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-edge pb-2">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-right text-sm font-medium tabular-nums">{value.toPrecision(5)} <span className="text-muted">{unit}</span></dd>
          </div>
        ))}
      </dl>
      {point.V === 0 && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {zh
            ? '原生模型将电池电压下限截为 0 V；此零电压是模型下限，不表示测量结果。'
            : 'The native model floors cell voltage at 0 V. This zero is the model floor, not a measured result.'}
        </p>
      )}
    </section>
  )
}
