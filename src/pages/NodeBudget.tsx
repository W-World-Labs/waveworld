import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { computeNodeEnergyBudget } from '../lib/nodeEnergyBudget'
import { computeEdgeSelfPowerChain } from '../lib/edgeSelfPowerChain'
import { useLocale } from '../lib/i18n'

function fmtPower(w: number): string {
  if (!Number.isFinite(w)) return '—'
  const abs = Math.abs(w)
  if (abs < 1e-6) return `${(w * 1e9).toFixed(2)} nW`
  if (abs < 1e-3) return `${(w * 1e6).toFixed(2)} µW`
  if (abs < 1) return `${(w * 1e3).toFixed(2)} mW`
  return `${w.toFixed(3)} W`
}

function fmtCurrent(a: number): string {
  if (!Number.isFinite(a)) return '—'
  const abs = Math.abs(a)
  if (abs < 1e-6) return `${(a * 1e9).toFixed(1)} nA`
  if (abs < 1e-3) return `${(a * 1e6).toFixed(2)} µA`
  if (abs < 1) return `${(a * 1e3).toFixed(2)} mA`
  return `${a.toFixed(3)} A`
}

function fmtLifetime(s: number): string {
  if (s === Infinity) return '∞ (harvest covers)'
  if (!Number.isFinite(s)) return '—'
  const y = s / (365.25 * 24 * 3600)
  if (y >= 1) return `${y.toFixed(2)} yr`
  const d = s / (24 * 3600)
  if (d >= 1) return `${d.toFixed(1)} d`
  const h = s / 3600
  return `${h.toFixed(1)} h`
}

/**
 * Duty-cycle energy budget for ultra-low-power sensor nodes.
 * Pure calc in nodeEnergyBudget; this page only binds controls + pathway links.
 */
export function NodeBudget() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pageTerms = useMemo(() => termIdsForSimPath('node-budget'), [])

  // UI uses practical units; convert to SI for the lib.
  const [sleepUa, setSleepUa] = useState(2)
  const [activeMa, setActiveMa] = useState(5)
  const [activeMs, setActiveMs] = useState(50)
  const [periodS, setPeriodS] = useState(60)
  const [volt, setVolt] = useState(3)
  const [capacityMah, setCapacityMah] = useState(220)
  const [harvestUw, setHarvestUw] = useState(0)
  const [targetYears, setTargetYears] = useState(10)
  // Full chain stages (ambient → η → usable harvest + optional RF tax)
  const [useChain, setUseChain] = useState(true)
  const [ambientUw, setAmbientUw] = useState(100)
  const [etaPct, setEtaPct] = useState(25)
  const [gammaMag, setGammaMag] = useState(0)
  const [rfSharePct, setRfSharePct] = useState(20)

  const nodeFields = useMemo(
    () => ({
      sleepCurrentA: sleepUa * 1e-6,
      activeCurrentA: activeMa * 1e-3,
      activeTimeS: activeMs * 1e-3,
      periodS,
      supplyVoltageV: volt,
      batteryCapacityAh: capacityMah * 1e-3,
      targetLifetimeS: targetYears * 365.25 * 24 * 3600,
    }),
    [sleepUa, activeMa, activeMs, periodS, volt, capacityMah, targetYears],
  )

  const chain = useMemo(() => {
    if (!useChain) return null
    return computeEdgeSelfPowerChain({
      harvest: { ambientPowerW: ambientUw * 1e-6, eta: etaPct / 100 },
      node: nodeFields,
      rf: { gammaMag, loadRfShare: rfSharePct / 100 },
    })
  }, [useChain, ambientUw, etaPct, gammaMag, rfSharePct, nodeFields])

  const r = useMemo(() => {
    if (chain?.ok) return chain.node
    return computeNodeEnergyBudget({
      ...nodeFields,
      harvestPowerW: harvestUw * 1e-6,
    })
  }, [chain, nodeFields, harvestUw])

  return (
    <div>
      <PageHeader
        icon="🔋"
        title="节点功耗账本 · 占空比寿命"
        titleEn="Node energy budget · duty-cycle life"
        subtitle="睡眠电流 × 周期 + 唤醒能耗 → 平均功耗；对照电池容量与采集功率，估算寿命或所需容量。面向野外超低功耗传感节点的第一本算账。"
        subtitleEn="Sleep current × period + wake energy → average power; compare battery capacity and harvest power for lifetime or required Ah. First ledger for field ULP sensor nodes."
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读节点能耗时' : 'When reading node energy'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
      </p>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link to="/sensing" className="btn border border-edge text-slate-300">
          {zh ? '← 传感/换能候选' : '← Sensing candidates'}
        </Link>
        <Link to="/smith" className="btn border border-edge text-slate-300">
          {zh ? '史密斯圆图 · 匹配' : 'Smith chart · match'}
        </Link>
        <Link to="/matrix" className="btn border border-edge text-slate-300">
          {zh ? '转换矩阵 · 供能路径' : 'Matrix · supply paths'}
        </Link>
        <Link to="/paths" className="btn border border-edge text-slate-300">
          {zh ? '转换路径' : 'Conversion paths'}
        </Link>
      </div>

      <div className="toolbar mb-5 flex flex-wrap items-center gap-4">
        <ParamSlider
          label={zh ? '睡眠电流' : 'Sleep I'}
          value={sleepUa}
          min={0.1}
          max={50}
          step={0.1}
          unit="µA"
          format={(v) => v.toFixed(1)}
          onChange={setSleepUa}
        />
        <ParamSlider
          label={zh ? '唤醒电流' : 'Active I'}
          value={activeMa}
          min={0.1}
          max={50}
          step={0.1}
          unit="mA"
          format={(v) => v.toFixed(1)}
          onChange={setActiveMa}
        />
        <ParamSlider
          label={zh ? '唤醒时长' : 'Active t'}
          value={activeMs}
          min={1}
          max={500}
          step={1}
          unit="ms"
          format={(v) => String(v)}
          onChange={setActiveMs}
        />
        <ParamSlider
          label={zh ? '周期' : 'Period'}
          value={periodS}
          min={1}
          max={3600}
          step={1}
          unit="s"
          format={(v) => String(v)}
          onChange={setPeriodS}
        />
        <ParamSlider
          label={zh ? '电压' : 'V'}
          value={volt}
          min={1.5}
          max={5}
          step={0.1}
          unit="V"
          format={(v) => v.toFixed(1)}
          onChange={setVolt}
        />
        <ParamSlider
          label={zh ? '电池容量' : 'Capacity'}
          value={capacityMah}
          min={10}
          max={5000}
          step={10}
          unit="mAh"
          format={(v) => String(v)}
          onChange={setCapacityMah}
        />
        {!useChain && (
          <ParamSlider
            label={zh ? '采集功率' : 'Harvest P'}
            value={harvestUw}
            min={0}
            max={200}
            step={1}
            unit="µW"
            format={(v) => String(v)}
            onChange={setHarvestUw}
          />
        )}
        <ParamSlider
          label={zh ? '目标寿命' : 'Target life'}
          value={targetYears}
          min={1}
          max={20}
          step={1}
          unit={zh ? '年' : 'yr'}
          format={(v) => String(v)}
          onChange={setTargetYears}
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={useChain}
            onChange={(e) => setUseChain(e.target.checked)}
          />
          {zh ? '计算链：环境→η→采集 + RF 税' : 'Chain: ambient→η→harvest + RF tax'}
        </label>
      </div>

      {useChain && (
        <div className="toolbar mb-5 flex flex-wrap items-center gap-4">
          <ParamSlider
            label={zh ? '环境功率' : 'Ambient P'}
            value={ambientUw}
            min={1}
            max={500}
            step={1}
            unit="µW"
            format={(v) => String(v)}
            onChange={setAmbientUw}
          />
          <ParamSlider
            label={zh ? '采集效率 η' : 'Harvest η'}
            value={etaPct}
            min={1}
            max={80}
            step={1}
            unit="%"
            format={(v) => String(v)}
            onChange={setEtaPct}
          />
          <ParamSlider
            label={zh ? '|Γ| 失配' : '|Γ| mismatch'}
            value={gammaMag}
            min={0}
            max={0.95}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={setGammaMag}
          />
          <ParamSlider
            label={zh ? '射频占负载' : 'RF share of load'}
            value={rfSharePct}
            min={0}
            max={80}
            step={5}
            unit="%"
            format={(v) => String(v)}
            onChange={setRfSharePct}
          />
        </div>
      )}

      {chain?.ok && (
        <div className="mx-auto mb-3 max-w-3xl rounded-lg border border-wave/30 bg-wave/5 p-3 font-mono text-xs text-slate-400">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-cyan-500/80">
            {zh ? '计算链各级' : 'Chain stages'}
          </div>
          <div>
            {zh ? '可用采集' : 'Usable harvest'}{' '}
            <span className="text-cyan-300">
              {fmtPower(chain.harvest.usableHarvestPowerW)}
            </span>
            {' = '}
            η{(chain.harvest.eta * 100).toFixed(0)}% × {fmtPower(chain.harvest.ambientPowerW)}
          </div>
          {chain.rfTax && (
            <div>
              RF |Γ|={chain.rfTax.gammaMag.toFixed(2)} →{' '}
              {zh ? '反射浪费' : 'reflected waste'}{' '}
              <span className="text-rose-300">{fmtPower(chain.rfExtraLoadW)}</span>
              {' · '}
              {zh ? '可用采集' : 'P_usable'}{' '}
              <span className="text-amber-300">{fmtPower(chain.effectiveHarvestPowerW)}</span>
            </div>
          )}
          <div>
            {zh ? '链盈余（采集−负载−RF税）' : 'Chain surplus (H−L−RF)'}{' '}
            <span className={chain.netPowerW >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
              {fmtPower(chain.netPowerW)}
            </span>
            {' · '}
            {chain.harvestCoversLoad
              ? zh
                ? '自供电成立'
                : 'self-powered OK'
              : zh
                ? '采集不足'
                : 'harvest shortfall'}
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-edge bg-black/30 p-4 font-mono text-xs text-slate-400">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            {zh ? '平均负载' : 'Average load'}
          </div>
          <div>
            {zh ? '占空比' : 'Duty'}{' '}
            <span className="text-cyan-300">{(r.dutyCycle * 100).toFixed(3)}%</span>
          </div>
          <div>
            {zh ? '平均电流' : 'I_avg'}{' '}
            <span className="text-violet-300">{fmtCurrent(r.avgCurrentA)}</span>
          </div>
          <div>
            {zh ? '平均功耗' : 'P_avg'}{' '}
            <span className="text-amber-300">{fmtPower(r.avgPowerW)}</span>
          </div>
          <div>
            {zh ? '净功耗（−采集）' : 'P_net (−harvest)'}{' '}
            <span className={r.netPowerW <= 0 ? 'text-emerald-300' : 'text-rose-300'}>
              {fmtPower(r.netPowerW)}
            </span>
          </div>
          <div>
            {zh ? '自供电（采集盖住负载）' : 'Self-powered (harvest covers)'}{' '}
            <span className={r.harvestCoversLoad ? 'text-emerald-300' : 'text-rose-300'}>
              {r.harvestCoversLoad
                ? zh
                  ? '是 · 不耗电池'
                  : 'Yes · no battery drain'
                : zh
                  ? '否 · 需电池/更大采集'
                  : 'No · need battery / more harvest'}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-edge bg-black/30 p-4 font-mono text-xs text-slate-400">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            {zh ? '寿命与容量' : 'Life & capacity'}
          </div>
          <div>
            {zh ? '估算寿命' : 'Est. life'}{' '}
            <span className="text-emerald-300">{fmtLifetime(r.lifetimeS)}</span>
          </div>
          <div>
            {zh ? `目标 ${targetYears} 年所需容量` : `Ah for ${targetYears} yr`}{' '}
            <span className="text-yellow-200">
              {Number.isFinite(r.requiredCapacityAh)
                ? `${(r.requiredCapacityAh * 1000).toFixed(1)} mAh`
                : '—'}
            </span>
          </div>
          <div>
            {zh ? '每周期能量' : 'E / cycle'}{' '}
            <span className="text-slate-200">
              {Number.isFinite(r.energyPerCycleJ)
                ? `${(r.energyPerCycleJ * 1e6).toFixed(2)} µJ`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      <p className="note mt-6">
        {zh
          ? '模型：占空比账本 E_cycle/T → P_avg。计算链打开时：P_usable=η·P_ambient；RF 税用 |Γ|² 损耗负载中的射频份额，有效采集 = P_usable − P_reflected_share。P_net≤0 时自供电成立。已单测：环境/η 单调、Γ=0 无税、盖住/不足寿命。'
          : 'Model: duty-cycle E_cycle/T → P_avg. With chain on: P_usable=η·P_ambient; RF tax uses |Γ|² on the RF share of load so effective harvest shrinks. P_net≤0 ⇒ self-powered. Unit-tested: ambient/η mono, matched RF, cover/shortfall life.'}
      </p>
    </div>
  )
}
