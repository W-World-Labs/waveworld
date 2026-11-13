import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import {
  sensorsFor,
  sensorsForSelfPower,
  sensingOutput,
  sensingMethodDetailUrl,
  SENSING_OUTPUTS,
  ENERGY_FORMS,
  formName,
  methodTransducerScale,
  type ConversionMethod,
  type MaturityTier,
  type TransducerScale,
} from '../lib/applications'
import { formatPercent } from '../lib/efficiencyFormat'
import { termIdsForSimPath } from '../lib/termGlossary'
import {
  deviceDisplayName,
  edgeDisplayName,
  edgePrinciple,
  pickLocaleString,
  useLocale,
} from '../lib/i18n'

const SCALE_BADGE: Record<
  TransducerScale,
  { label: string; labelEn: string; cls: string }
> = {
  transducer: {
    label: '换能器尺度',
    labelEn: 'Transducer scale',
    cls: 'bg-emerald-500/15 text-emerald-300',
  },
  industrial: {
    label: '工业机电',
    labelEn: 'Industrial EM',
    cls: 'bg-amber-500/15 text-amber-300',
  },
  plant: {
    label: '电厂/并网',
    labelEn: 'Plant / grid',
    cls: 'bg-rose-500/15 text-rose-300',
  },
  unknown: {
    label: '尺度未判',
    labelEn: 'Scale unknown',
    cls: 'bg-slate-500/15 text-slate-400',
  },
}

const pct = formatPercent
const MATURITY: Record<MaturityTier, { label: string; labelEn: string; cls: string }> = {
  mature: {
    label: '成熟/商用',
    labelEn: 'Mature / commercial',
    cls: 'bg-emerald-500/15 text-emerald-300',
  },
  demonstration: {
    label: '示范/原型',
    labelEn: 'Demo / prototype',
    cls: 'bg-amber-500/15 text-amber-300',
  },
  experimental: {
    label: '实验/研究',
    labelEn: 'Experimental / research',
    cls: 'bg-sky-500/15 text-sky-300',
  },
  unknown: {
    label: '未标注',
    labelEn: 'Unlabeled',
    cls: 'bg-slate-500/15 text-slate-400',
  },
}

export function Sensing() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [stimulus, setStimulus] = useState('mechanical')
  const [outputId, setOutputId] = useState<'electrical' | 'optical'>('electrical')
  const [practicalOnly, setPracticalOnly] = useState(false)
  const [intent, setIntent] = useState<'harvest' | 'measure' | 'self-power'>('self-power')
  const output = sensingOutput(outputId)
  const effectiveIntent = outputId === 'optical' ? 'measure' : intent
  const sensors = useMemo(() => {
    if (effectiveIntent === 'self-power') {
      return sensorsForSelfPower(stimulus, { practicalOnly })
    }
    return sensorsFor(stimulus, {
      practicalOnly,
      intent: effectiveIntent,
      readout: output.readoutForm,
    })
  }, [stimulus, practicalOnly, effectiveIntent, output.readoutForm])
  const stim = ENERGY_FORMS.find((f) => f.id === stimulus)
  const pageTerms = useMemo(() => termIdsForSimPath('sensing'), [])

  return (
    <div>
      <PageHeader
        icon="📡"
        title="传感 / 换能查找"
        subtitle="传感链 = 被测输入 → 物理响应 → 可观察输出。电信号是常用读出，不是必经终点；发光的亮度、颜色、光谱也可直接成为结果。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读传感效率时' : 'When reading sensing efficiency'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">
            {zh ? '被测能量形式' : 'Measurand energy form'}
          </span>
          <select
            value={stimulus}
            onChange={(e) => setStimulus(e.target.value)}
            className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200"
          >
            {ENERGY_FORMS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.icon} {formName(f.id, locale)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-500">→</span>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">{zh ? '可观察输出' : 'Observable output'}</span>
          <select
            value={outputId}
            onChange={(e) => {
              const next = e.target.value as 'electrical' | 'optical'
              setOutputId(next)
              if (next === 'optical') setIntent('measure')
            }}
            className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200"
          >
            {SENSING_OUTPUTS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.id === 'optical' ? '💡' : '⚡'} {zh ? candidate.label : candidate.labelEn}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded border border-edge text-xs">
            <button
              onClick={() => setIntent('self-power')}
              disabled={outputId === 'optical'}
              className={`px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${effectiveIntent === 'self-power' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}
              title={
                zh
                  ? '边缘自供电：取能视角但优先换能器/俘能尺度，抑制电厂级发电机'
                  : 'Edge self-power: harvest view but harvester-scale first; demote plant generators'
              }
            >
              {zh ? '边缘自供电' : 'Edge self-power'}
            </button>
            <button
              onClick={() => setIntent('harvest')}
              disabled={outputId === 'optical'}
              className={`px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${effectiveIntent === 'harvest' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}
              title={
                zh
                  ? '按换能效率排序（取能/能量收集视角；可为电厂级）'
                  : 'Sort by conversion η (harvest view; plant-scale may lead)'
              }
            >
              {zh ? '取能效率序' : 'Harvest η order'}
            </button>
            <button
              onClick={() => setIntent('measure')}
              className={`px-2.5 py-1 ${effectiveIntent === 'measure' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}
              title={
                zh
                  ? '尺度→成熟度→η；抑制电厂/并网发电机（测量仍缺 SNR 等 FoM）'
                  : 'Scale→maturity→η; demote plant/grid generators (SNR FoMs still pending)'
              }
            >
              {zh ? '测量/可落地序' : 'Measure / deploy order'}
            </button>
          </div>
          <label
            className="flex items-center gap-1.5 text-slate-400"
            title={
              zh
                ? '只保留全程成熟/示范的可落地换能器'
                : 'Only mature/demo transducers end-to-end'
            }
          >
            <input
              type="checkbox"
              checked={practicalOnly}
              onChange={(e) => setPracticalOnly(e.target.checked)}
              className="accent-wave"
            />
            {zh ? '只看可落地' : 'Deployable only'}
          </label>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-wave/20 bg-wave/5 p-3 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">{zh ? '实际可读量' : 'Observable quantities'}：</span>
          {(zh ? output.observables : output.observablesEn).map((observable) => (
            <span key={observable} className="rounded-full bg-wave/15 px-2 py-0.5 text-wave">
              {observable}
            </span>
          ))}
        </div>
        <p className="mt-2">{zh ? output.directReadout : output.directReadoutEn}</p>
        <p className="mt-1 text-slate-500">{zh ? output.optionalAcquisition : output.optionalAcquisitionEn}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="self-center text-slate-500">
          {zh ? '边缘自供电通路：' : 'Edge self-power path:'}
        </span>
        <Link
          to="/node-budget"
          className="rounded-full border border-edge bg-black/20 px-2.5 py-1 text-slate-300 hover:border-wave/40"
        >
          🔋 {zh ? '节点功耗账本 · 采集能否盖住负载' : 'Node budget · harvest cover?'}
        </Link>
        <Link
          to="/smith"
          className="rounded-full border border-edge bg-black/20 px-2.5 py-1 text-slate-300 hover:border-wave/40"
        >
          ◎ {zh ? '史密斯圆图 · RF 匹配' : 'Smith · RF match'}
        </Link>
        <Link
          to="/matrix"
          className="rounded-full border border-edge bg-black/20 px-2.5 py-1 text-slate-300 hover:border-wave/40"
        >
          🔀 {zh ? '转换矩阵 · 供能' : 'Matrix · supply'}
        </Link>
        <Link
          to="/paths"
          className="rounded-full border border-edge bg-black/20 px-2.5 py-1 text-slate-300 hover:border-wave/40"
        >
          🛤️ {zh ? '转换路径' : 'Paths'}
        </Link>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-slate-300">
        {zh
          ? `感知「${stim?.icon} ${stim ? formName(stim.id, locale) : ''}」的换能器：${sensors.length} 种（${
              effectiveIntent === 'self-power'
                ? '自供电：尺度→η'
                : effectiveIntent === 'measure'
                  ? '测量序：尺度→成熟度→η'
                  : '取能序：η'
            }）`
          : `Transducers for “${stim?.icon} ${stim ? formName(stim.id, locale) : ''}”: ${sensors.length} (${
              effectiveIntent === 'self-power'
                ? 'self-power: scale→η'
                : effectiveIntent === 'measure'
                  ? 'measure: scale→maturity→η'
                  : 'harvest: η'
            })`}
      </h3>

      {sensors.length === 0 ? (
        <p className="text-sm text-slate-500">
          {zh
            ? `未找到${practicalOnly ? '可落地的' : ''}直接换能器，试着关掉约束或换一种能量形式。`
            : `No ${practicalOnly ? 'deployable ' : ''}direct transducers found—relax filters or pick another energy form.`}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sensors.map((m, i) => (
            <SensorCard key={m.edgeIds[0] ?? i} m={m} best={i === 0} />
          ))}
        </div>
      )}

      <div className="mt-5 max-w-2xl space-y-2 border-t border-edge pt-3 text-xs text-slate-500">
        {zh ? (
          <>
            {outputId === 'optical' ? (
              <p>
                <span className="text-slate-400">直接发光也是完整的测量出口</span>：亮度可对应反应速率或浓度，
                颜色/光谱可对应物种或状态，寿命与空间图样也能携带信息。若只需目视判断，链条可在光学输出结束；
                只有需要记录、定量或自动分析时，才继续接相机、光谱仪或光电探测器。
              </p>
            ) : (
              <p>
                <span className="text-slate-400">取能换能器 vs 测量传感器</span>：本表列的是把能量形式转成电的
                <span className="text-slate-300">换能/取能器件</span>，「取能效率序」按能量转换效率 η 排序。
                但<span className="text-slate-300">测量用传感器</span>的选型看灵敏度/响应度/QE/NEP/带宽/噪声，与能量效率无关——
                这些 FoM 指标与纯探测器件正在规划接入。「测量/可落地序」按成熟度优先并抑制电厂/并网发电机。
              </p>
            )}
            <p>
              效率为典型能量转换效率（区间中点，宽区间见原边数据）。标「距上限」者受第一性原理上限约束（如热→电受卡诺限）。
              标 <span className="text-rose-300">⚠</span> 者机理/数值有争议或未解，谨慎选用。
            </p>
          </>
        ) : (
          <>
            {outputId === 'optical' ? (
              <p>
                <span className="text-slate-400">Direct light is a complete measurement output</span>: brightness can
                encode rate or concentration; color/spectrum can identify species or state; lifetime and spatial pattern
                also carry information. The chain may end at visible observation. Add a camera, spectrometer, or
                photodetector only when recording, quantification, or automation is needed.
              </p>
            ) : (
              <p>
                <span className="text-slate-400">Harvest transducers vs measurement sensors</span>: this table lists{' '}
                <span className="text-slate-300">energy-conversion / harvest devices</span> that turn a form into electricity;
                “harvest η order” sorts by conversion η. Real sensors are selected by sensitivity, responsivity, QE, NEP,
                bandwidth, and noise—not energy η. “Measure / deploy order” prioritizes maturity and demotes plant/grid
                generators.
              </p>
            )}
            <p>
              Efficiency is typical conversion η (midpoint of ranges; see edge data for width). “To limit” marks
              first-principles ceilings (e.g. thermal→electric Carnot).{' '}
              <span className="text-rose-300">⚠</span> means contested/open mechanism or numbers—use carefully.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function SensorCard({ m, best }: { m: ConversionMethod; best: boolean }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const mat = MATURITY[m.maturity]
  const scale = methodTransducerScale(m)
  const scaleBadge = SCALE_BADGE[scale]
  const principle = m.hops[0]?.edge ? edgePrinciple(m.hops[0].edge, locale) : ''
  const hop0 = m.hops[0]?.edge
  const name = hop0
    ? edgeDisplayName(hop0, locale)
    : m.formChain.map((id) => formName(id, locale)).join('→')
  const chainLabel = m.formChain.map((id) => formName(id, locale)).join(' → ')
  return (
    <Link
      to={sensingMethodDetailUrl(m)}
      className="card group block p-4 transition hover:-translate-y-0.5 hover:border-wave/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-wave"
      aria-label={`${zh ? '查看完整机理' : 'View full mechanism'}：${name}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="flex-1 text-sm font-semibold text-white">{name}</h4>
        {best && (
          <span className="rounded bg-glow/15 px-2 py-0.5 text-[10px] text-glow">
            {zh ? '当前序最优' : 'Top in order'}
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${scaleBadge.cls}`}
          title={zh ? '器件物理尺度（测量序会抑制电厂级）' : 'Device physical scale (measure order demotes plant)'}
        >
          {pickLocaleString(scaleBadge.label, scaleBadge.labelEn, locale)}
        </span>
        {(m.consensus === 'contested' || m.consensus === 'open') && (
          <span
            className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300"
            title={
              zh
                ? '机理/数值存在争议或未解，谨慎选用'
                : 'Mechanism/numbers contested or open—use carefully'
            }
          >
            ⚠ {m.consensus === 'open' ? (zh ? '未解' : 'Open') : zh ? '有争议' : 'Contested'}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${mat.cls}`}>
          {pickLocaleString(mat.label, mat.labelEn, locale)}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-wave/15 px-2 py-0.5 text-wave">{chainLabel}</span>
        <span className="font-mono text-ember">η {pct(m.efficiency)}</span>
        {m.limit && (
          <span className="text-slate-500" title={zh ? m.limit.law : m.limit.lawEn}>
            · {zh ? '距上限' : 'to limit'} {pct(m.limit.fraction)}
          </span>
        )}
      </div>
      {principle && <p className="mb-2 line-clamp-3 text-xs text-slate-400">{principle}</p>}
      {m.devices.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {m.devices.slice(0, 4).map((d) => (
            <span key={d} className="rounded-full bg-edge/60 px-2 py-0.5 text-[11px] text-slate-300">
              {deviceDisplayName(d, locale)}
            </span>
          ))}
        </div>
      )}
      {m.products.length > 0 && (
        <div className="border-t border-edge/60 pt-2 text-[11px] text-slate-500">
          {zh ? '产品：' : 'Products: '}
          {m.products
            .slice(0, 3)
            .map((p) => [p.vendor, p.model].filter(Boolean).join(' '))
            .join(zh ? '、' : ', ')}
        </div>
      )}
      <div className="mt-3 border-t border-edge/60 pt-2 text-right text-[11px] text-wave/70 group-hover:text-wave">
        {zh ? '查看完整机理、公式与损耗 →' : 'Full mechanism, equations & losses →'}
      </div>
    </Link>
  )
}
