import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import {
  computeChain,
  DEFAULT_INPUT,
  GPU_SPECS,
  MODEL_QUALITY,
  POWER_SOURCES,
  type ChainInput,
} from '../lib/energyChain'
import { termIdsForSimPath, termTitle } from '../lib/termGlossary'
import { pickLocaleString, useLocale } from '../lib/i18n'

const STAGES: Array<{
  key: keyof ReturnType<typeof computeChain>['stages']
  label: string
  labelEn: string
}> = [
  { key: 'raw_input', label: '原始能量', labelEn: 'Primary energy' },
  { key: 'after_gen', label: '发电', labelEn: 'Generation' },
  { key: 'after_grid', label: '升压电网', labelEn: 'Grid step-up' },
  { key: 'after_trans', label: '长途输电', labelEn: 'Long-haul transmission' },
  { key: 'after_dc', label: '数据中心（能效比）', labelEn: 'Data center (PUE)' },
  { key: 'after_gpu', label: '算力芯片', labelEn: 'Compute GPU' },
  { key: 'after_infer', label: '推理引擎', labelEn: 'Inference engine' },
  { key: 'effective', label: '有效解题能力', labelEn: 'Effective problem-solving' },
]

export function AiChain() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [input, setInput] = useState<ChainInput>(DEFAULT_INPUT)
  const r = useMemo(() => computeChain(input), [input])
  const set = (p: Partial<ChainInput>) => setInput((s) => ({ ...s, ...p }))
  const pageTerms = useMemo(() => termIdsForSimPath('ai-chain'), [])
  const mqName = pickLocaleString(
    r.input.model_quality_name,
    MODEL_QUALITY[r.input.model_quality_key]?.nameEn,
    locale,
  )

  return (
    <div>
      <PageHeader
        icon="🧠"
        title="从能量到令牌"
        subtitle="一焦耳原始能量，经发电、电网、输电、数据中心、算力芯片、推理引擎、模型质量的层层损耗，最终转化为多少“有效智能”？这是 AI 时代最根本的换能链。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读链路效率时' : 'When reading chain efficiency'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；含 PUE / 壁塞）' : '(hover for plain language; includes PUE / wall-plug)'}
        </span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="card h-fit space-y-4 p-5">
          <h2 className="text-sm font-semibold text-slate-300">
            ⚙️ {zh ? '参数配置' : 'Parameters'}
          </h2>

          <Select
            label={zh ? '能量来源' : 'Power source'}
            value={input.power_source}
            onChange={(v) => set({ power_source: v })}
            options={Object.entries(POWER_SOURCES).map(([k, v]) => [
              k,
              pickLocaleString(v.name, v.nameEn, locale),
            ])}
          />
          <Select
            label={zh ? '加速卡型号' : 'Accelerator'}
            value={input.gpu_key}
            onChange={(v) => set({ gpu_key: v })}
            options={Object.entries(GPU_SPECS).map(([k, v]) => [
              k,
              pickLocaleString(v.name, v.nameEn, locale),
            ])}
          />
          <Select
            label={zh ? '模型质量' : 'Model quality'}
            value={input.model_quality}
            onChange={(v) => set({ model_quality: v })}
            options={Object.entries(MODEL_QUALITY).map(([k, v]) => [
              k,
              pickLocaleString(v.name, v.nameEn, locale),
            ])}
          />
          <Range
            label={zh ? '芯片数量' : 'GPU count'}
            value={input.gpu_count}
            min={1}
            max={128}
            step={1}
            onChange={(v) => set({ gpu_count: v })}
            fmt={(v) => (zh ? `${v} 卡` : `${v} cards`)}
          />
          <Range
            label={zh ? '数据中心能效比' : 'Data-center PUE'}
            labelTitle={termTitle('pue', locale)}
            value={input.pue}
            min={1.0}
            max={2.5}
            step={0.05}
            onChange={(v) => set({ pue: v })}
            fmt={(v) => v.toFixed(2)}
          />
          <Range
            label={zh ? '电价（元/度）' : 'Electricity price (CNY/kWh)'}
            value={input.elec_price}
            min={0.1}
            max={1.5}
            step={0.01}
            onChange={(v) => set({ elec_price: v })}
            fmt={(v) => `¥${v.toFixed(2)}`}
          />
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-300">
              {zh ? '全链路能量流动' : 'End-to-end energy flow'}
            </h2>
            <div className="space-y-2">
              {STAGES.map((s, i) => {
                const v = r.stages[s.key]
                const isLast = s.key === 'effective'
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-right text-xs text-slate-400">
                      {zh ? s.label : s.labelEn}
                    </div>
                    <div className="relative h-7 flex-1 overflow-hidden rounded bg-edge/50">
                      <div
                        className={`h-full rounded ${isLast ? 'bg-ember' : 'bg-gradient-to-r from-wave to-glow'}`}
                        style={{ width: `${Math.max(v * 100, 1)}%` }}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-white/90">
                        {(v * 100).toFixed(1)}%
                      </span>
                    </div>
                    {i > 0 && (
                      <div className="w-12 shrink-0 text-xs text-slate-500">
                        ×{(v / r.stages[STAGES[i - 1].key]).toFixed(2)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-4 text-xs text-slate-400">
              {zh ? (
                <>
                  使用「{mqName}」时，每焦耳原始能量实际产生的有效解题能力为{' '}
                  <span className="font-semibold text-ember">{r.stage_pct.effective_from_raw}%</span>
                  （含全链路损耗）。
                </>
              ) : (
                <>
                  With “{mqName}”, each joule of primary energy yields{' '}
                  <span className="font-semibold text-ember">{r.stage_pct.effective_from_raw}%</span>
                  {' '}effective problem-solving capacity (full-chain losses included).
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label={zh ? '每令牌能耗' : 'Energy per token'}
              value={`${r.token_economics.j_per_token} J`}
            />
            <Stat
              label={zh ? '每百万令牌电耗' : 'kWh per 1M tokens'}
              value={`${r.token_economics.kwh_per_1m_tok} kWh`}
            />
            <Stat
              label={zh ? '每百万令牌成本' : 'Cost per 1M tokens'}
              value={`¥${r.token_economics.cost_cny_per_1m}`}
              accent
            />
            <Stat
              label={zh ? '每度电产出' : 'Tokens per kWh'}
              value={
                zh
                  ? `${(r.token_economics.tokens_per_kwh / 1e6).toFixed(2)}M 令牌`
                  : `${(r.token_economics.tokens_per_kwh / 1e6).toFixed(2)}M tokens`
              }
            />
            <Stat
              label={zh ? '单卡集群日成本' : 'Daily cluster cost'}
              value={`¥${r.token_economics.daily_cost_cny}`}
            />
            <Stat
              label={zh ? '每百万令牌碳排' : 'Carbon per 1M tokens'}
              value={`${r.token_economics.carbon_g_per_1m_tok} g`}
            />
          </div>

          <div className="card overflow-hidden">
            <h2 className="border-b border-edge px-5 py-3 text-sm font-semibold text-slate-300">
              {zh
                ? '跨电源对比（月预算 ¥10,000，固定当前硬件）'
                : 'Cross-source compare (¥10,000 / month budget, fixed hardware)'}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-400">
                  <tr className="[&>th]:px-4 [&>th]:py-2">
                    <th>{zh ? '电源' : 'Source'}</th>
                    <th>{zh ? '发电效率' : 'Gen η'}</th>
                    <th>{zh ? '电价' : 'Price'}</th>
                    <th>{zh ? '月产令牌' : 'Tokens / mo'}</th>
                    <th>{zh ? '碳排/百万令牌' : 'g CO₂ / 1M tok'}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.source_compare.map((s) => (
                    <tr
                      key={s.key}
                      className={`border-t border-edge/60 [&>td]:px-4 [&>td]:py-2 ${
                        s.is_selected ? 'bg-wave/10 text-white' : 'text-slate-300'
                      }`}
                    >
                      <td className="font-medium">
                        {pickLocaleString(s.name, s.nameEn, locale)}
                      </td>
                      <td>{s.gen_eff_pct}%</td>
                      <td>¥{s.cost_cn}</td>
                      <td>{s.tokens_million_per_month.toLocaleString()}M</td>
                      <td>{s.carbon_per_1m_tok_g} g</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      <select
        className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-slate-200 outline-none focus:border-wave"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  )
}

function Range({
  label,
  labelTitle,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string
  labelTitle?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt: (v: number) => string
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs text-slate-400">
        <span
          title={labelTitle}
          className={labelTitle ? 'cursor-help border-b border-dotted border-slate-600' : undefined}
        >
          {label}
        </span>
        <span className="font-mono text-slate-200">{fmt(value)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-wave"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ? 'text-ember' : 'text-white'}`}>{value}</div>
    </div>
  )
}
