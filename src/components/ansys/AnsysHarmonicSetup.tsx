import { useEffect, useState } from 'react'
import { useLocale } from '../../lib/i18n'
import type { AnsysHarmonicModeDraft, AnsysHarmonicStudyDraft } from '../../lib/sim/ansys-harmonic-study-input'

type Props = {
  draft: AnsysHarmonicStudyDraft
  onChange: (next: AnsysHarmonicStudyDraft) => void
  validationMessage?: string
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'
const MAX_MODES = 8
const MAX_DOFS = 16
const MAX_POINTS = 201

function numberValue(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw)
}

function finiteText(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

/** Edits bounded SDOF or modal harmonic inputs; it does not compute a response. */
export function AnsysHarmonicSetup({ draft, onChange, validationMessage }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [startText, setStartText] = useState(() => finiteText(draft.startFrequency))
  const [endText, setEndText] = useState(() => finiteText(draft.endFrequency))
  const [pointsText, setPointsText] = useState(() => String(draft.points))

  useEffect(() => {
    setStartText(finiteText(draft.startFrequency))
    setEndText(finiteText(draft.endFrequency))
    setPointsText(String(draft.points))
  }, [draft.startFrequency, draft.endFrequency, draft.points])

  const updateSweep = (key: 'startFrequency' | 'endFrequency' | 'points', raw: string) => {
    if (key === 'startFrequency') setStartText(raw)
    if (key === 'endFrequency') setEndText(raw)
    if (key === 'points') setPointsText(raw)
    onChange({ ...draft, [key]: numberValue(raw) })
  }

  const updateDampingKind = (kind: string) => {
    if (draft.system === 'sdof') {
      const damping: AnsysHarmonicStudyDraft & { system: 'sdof' } = { ...draft, damping: kind === 'none' ? { kind: 'none' } : { kind: kind as 'ratio' | 'coefficient', value: 0.05 } }
      onChange(damping)
      return
    }
    const damping = kind === 'none' ? { kind: 'none' as const }
      : kind === 'ratio' ? { kind: 'ratio' as const, value: 0.05 }
        : { kind: 'rayleigh' as const, alpha: 0, beta: 0 }
    onChange({ ...draft, damping })
  }

  const dofCount = draft.system === 'modal' ? draft.force.length : 0
  const updateMode = (index: number, patch: Partial<AnsysHarmonicModeDraft>) => {
    if (draft.system !== 'modal') return
    onChange({ ...draft, modes: draft.modes.map((mode, modeIndex) => modeIndex === index ? { ...mode, ...patch } : mode) })
  }
  const changeDofs = (raw: string) => {
    if (draft.system !== 'modal') return
    const count = Number(raw)
    if (!Number.isInteger(count) || count < 1 || count > MAX_DOFS) return
    onChange({
      ...draft,
      force: Array.from({ length: count }, (_, index) => draft.force[index] ?? 0),
      modes: draft.modes.map(mode => ({ ...mode, shape: Array.from({ length: count }, (_, index) => mode.shape[index] ?? 0) })),
    })
  }

  return <section id="ansys-harmonic-inputs" data-testid="ansys-harmonic-inputs" className="space-y-4 rounded-xl border border-edge bg-surface p-4" aria-labelledby="ansys-harmonic-setup-title">
    <header>
      <h2 id="ansys-harmonic-setup-title" className="text-lg font-semibold text-ink">{zh ? '谐响应输入' : 'Harmonic response setup'}</h2>
      <p className="mt-1 text-sm text-muted">{zh ? '配置单自由度系统或模态数据与频率扫描。此编辑器只准备输入，不计算响应。' : 'Configure an SDOF system or modal data and frequency sweep. This editor prepares inputs; it does not compute the response.'}</p>
    </header>

    <label className="block text-sm text-ink" htmlFor="ansys-harmonic-system">{zh ? '系统类型' : 'System type'}
      <select id="ansys-harmonic-system" data-testid="ansys-harmonic-system" value={draft.system} onChange={event => {
        if (event.currentTarget.value === 'modal') onChange({ system: 'modal', modes: [{ frequencyHz: 5, shape: [1] }], force: [1], damping: { kind: 'none' }, startFrequency: draft.startFrequency, endFrequency: draft.endFrequency, points: draft.points, freqUnit: draft.freqUnit })
        else onChange({ system: 'sdof', mass: 1, stiffness: 1000, force: 1, damping: { kind: 'ratio', value: 0.05 }, startFrequency: draft.startFrequency, endFrequency: draft.endFrequency, points: draft.points, freqUnit: draft.freqUnit })
      }} className={fieldClass}>
        <option value="sdof">{zh ? '单自由度 (SDOF)' : 'Single degree of freedom (SDOF)'}</option>
        <option value="modal">{zh ? '模态叠加' : 'Modal superposition'}</option>
      </select>
    </label>

    {draft.system === 'sdof' ? <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink">{zh ? '单自由度参数' : 'SDOF parameters'}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ['mass', zh ? '质量 (kg)' : 'Mass (kg)', 0],
          ['stiffness', zh ? '刚度 (N/m)' : 'Stiffness (N/m)', 0],
          ['force', zh ? '力幅值 (N)' : 'Force amplitude (N)', -1e12],
        ] as const).map(([key, label, min]) => <label key={key} className="block text-sm text-ink" htmlFor={`ansys-harmonic-${key}`}><span>{label}</span>
          <input id={`ansys-harmonic-${key}`} data-testid={`ansys-harmonic-${key}`} type="number" min={min} max={1e12} step="any" value={finiteText(draft[key])} onChange={event => onChange({ ...draft, [key]: numberValue(event.currentTarget.value) })} className={fieldClass} />
        </label>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink" htmlFor="ansys-harmonic-damping-kind">{zh ? '阻尼模型' : 'Damping model'}
          <select id="ansys-harmonic-damping-kind" data-testid="ansys-harmonic-damping-kind" value={draft.damping.kind} onChange={event => updateDampingKind(event.currentTarget.value)} className={fieldClass}>
            <option value="none">{zh ? '无' : 'None'}</option><option value="ratio">{zh ? '阻尼比' : 'Damping ratio'}</option><option value="coefficient">{zh ? '粘性阻尼系数' : 'Viscous damping coefficient'}</option>
          </select>
        </label>
        {draft.damping.kind !== 'none' && <label className="block text-sm text-ink" htmlFor="ansys-harmonic-damping-value">{draft.damping.kind === 'ratio' ? (zh ? '阻尼比' : 'Damping ratio') : (zh ? '阻尼系数 (N·s/m)' : 'Damping coefficient (N·s/m)')}
          <input id="ansys-harmonic-damping-value" data-testid="ansys-harmonic-damping-value" type="number" min="0" max={draft.damping.kind === 'ratio' ? 1000 : 1e12} step="any" value={finiteText(draft.damping.value)} onChange={event => { if (draft.damping.kind !== 'none') onChange({ ...draft, damping: { ...draft.damping, value: numberValue(event.currentTarget.value) } }) }} className={fieldClass} />
        </label>}
      </div>
    </fieldset> : <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink">{zh ? '模态参数' : 'Modal parameters'}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink" htmlFor="ansys-harmonic-dofs">{zh ? '自由度数 (1–16)' : 'Degrees of freedom (1–16)'}
          <input id="ansys-harmonic-dofs" data-testid="ansys-harmonic-dofs" type="number" min="1" max={MAX_DOFS} step="1" value={dofCount} onChange={event => changeDofs(event.currentTarget.value)} className={fieldClass} />
        </label>
        <label className="block text-sm text-ink" htmlFor="ansys-harmonic-mode-count">{zh ? `模态数 (1–${MAX_MODES})` : `Mode count (1–${MAX_MODES})`}
          <select id="ansys-harmonic-mode-count" data-testid="ansys-harmonic-mode-count" value={draft.modes.length} onChange={event => {
            const count = Number(event.currentTarget.value)
            onChange({ ...draft, modes: Array.from({ length: count }, (_, index) => draft.modes[index] ?? { frequencyHz: 5 + index * 5, shape: Array.from({ length: dofCount }, (_, dof) => dof === index % dofCount ? 1 : 0) }) })
          }} className={fieldClass}>{Array.from({ length: MAX_MODES }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" id="ansys-harmonic-force-vector" role="group" aria-label={zh ? '力向量 (N)' : 'Force vector (N)'}>
        {draft.force.map((force, index) => <label key={index} className="block text-sm text-ink" htmlFor={`ansys-harmonic-force-${index}`}><span>{zh ? `F${index + 1} (N)` : `F${index + 1} (N)`}</span>
          <input id={`ansys-harmonic-force-${index}`} data-testid={`ansys-harmonic-force-${index}`} type="number" min={-1e12} max={1e12} step="any" value={finiteText(force)} onChange={event => onChange({ ...draft, force: draft.force.map((current, item) => item === index ? numberValue(event.currentTarget.value) : current) })} className={fieldClass} />
        </label>)}
      </div>
      <div className="space-y-3">
        {draft.modes.map((mode, modeIndex) => <fieldset key={modeIndex} className="rounded-lg border border-edge p-3">
          <legend className="px-1 text-sm font-medium">{zh ? `模态 ${modeIndex + 1}` : `Mode ${modeIndex + 1}`}</legend>
          <div className="grid gap-3 sm:grid-cols-1">
            <label className="block text-sm text-ink" htmlFor={`ansys-harmonic-mode-${modeIndex}-frequency`}>{zh ? '固有频率 (Hz)' : 'Natural frequency (Hz)'}
              <input id={`ansys-harmonic-mode-${modeIndex}-frequency`} data-testid={`ansys-harmonic-mode-${modeIndex}-frequency`} type="number" min="0" max={1e9} step="any" value={finiteText(mode.frequencyHz)} onChange={event => updateMode(modeIndex, { frequencyHz: numberValue(event.currentTarget.value) })} className={fieldClass} />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {mode.shape.map((shape, dofIndex) => <label key={dofIndex} className="block text-sm text-ink" htmlFor={`ansys-harmonic-mode-${modeIndex}-shape-${dofIndex}`}>{zh ? `振型 φ${dofIndex + 1}` : `Shape φ${dofIndex + 1}`}
              <input id={`ansys-harmonic-mode-${modeIndex}-shape-${dofIndex}`} data-testid={`ansys-harmonic-mode-${modeIndex}-shape-${dofIndex}`} type="number" min={-1e6} max={1e6} step="any" value={finiteText(shape)} onChange={event => updateMode(modeIndex, { shape: mode.shape.map((current, item) => item === dofIndex ? numberValue(event.currentTarget.value) : current) })} className={fieldClass} />
            </label>)}
          </div>
        </fieldset>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm text-ink" htmlFor="ansys-harmonic-damping-kind">{zh ? '阻尼模型' : 'Damping model'}
          <select id="ansys-harmonic-damping-kind" data-testid="ansys-harmonic-damping-kind" value={draft.damping.kind} onChange={event => updateDampingKind(event.currentTarget.value)} className={fieldClass}>
            <option value="none">{zh ? '无' : 'None'}</option><option value="ratio">{zh ? '统一阻尼比' : 'Uniform damping ratio'}</option><option value="rayleigh">Rayleigh</option>
          </select>
        </label>
        {draft.damping.kind === 'ratio' && <label className="block text-sm text-ink" htmlFor="ansys-harmonic-damping-value">{zh ? '阻尼比' : 'Damping ratio'}
          <input id="ansys-harmonic-damping-value" data-testid="ansys-harmonic-damping-value" type="number" min="0" max="1000" step="any" value={finiteText(draft.damping.value)} onChange={event => { if (draft.damping.kind === 'ratio') onChange({ ...draft, damping: { ...draft.damping, value: numberValue(event.currentTarget.value) } }) }} className={fieldClass} />
        </label>}
        {draft.damping.kind === 'rayleigh' && <>
          <label className="block text-sm text-ink" htmlFor="ansys-harmonic-rayleigh-alpha">{zh ? 'Rayleigh α' : 'Rayleigh α'}<input id="ansys-harmonic-rayleigh-alpha" data-testid="ansys-harmonic-rayleigh-alpha" type="number" min="0" max={1e12} step="any" value={finiteText(draft.damping.alpha)} onChange={event => { if (draft.damping.kind === 'rayleigh') onChange({ ...draft, damping: { ...draft.damping, alpha: numberValue(event.currentTarget.value) } }) }} className={fieldClass} /></label>
          <label className="block text-sm text-ink" htmlFor="ansys-harmonic-rayleigh-beta">{zh ? 'Rayleigh β' : 'Rayleigh β'}<input id="ansys-harmonic-rayleigh-beta" data-testid="ansys-harmonic-rayleigh-beta" type="number" min="0" max={1e12} step="any" value={finiteText(draft.damping.beta)} onChange={event => { if (draft.damping.kind === 'rayleigh') onChange({ ...draft, damping: { ...draft.damping, beta: numberValue(event.currentTarget.value) } }) }} className={fieldClass} /></label>
        </>}
      </div>
    </fieldset>}

    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink">{zh ? '频率扫描' : 'Frequency sweep'}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ['startFrequency', zh ? '起始频率' : 'Start frequency', startText],
          ['endFrequency', zh ? '结束频率' : 'End frequency', endText],
          ['points', zh ? `点数 (2–${MAX_POINTS})` : `Points (2–${MAX_POINTS})`, pointsText],
        ] as const).map(([key, label, value]) => <label key={key} className="block text-sm text-ink" htmlFor={`ansys-harmonic-${key}`}><span>{label}</span>
          <input id={`ansys-harmonic-${key}`} data-testid={`ansys-harmonic-${key}`} type="number" min={key === 'points' ? 2 : 0} max={key === 'points' ? MAX_POINTS : 1e9} step={key === 'points' ? 1 : 'any'} value={value} onChange={event => updateSweep(key, event.currentTarget.value)} className={fieldClass} />
        </label>)}
        <label className="block text-sm text-ink" htmlFor="ansys-harmonic-frequency-unit">{zh ? '频率单位' : 'Frequency unit'}
          <select id="ansys-harmonic-frequency-unit" data-testid="ansys-harmonic-frequency-unit" value={draft.freqUnit} onChange={event => onChange({ ...draft, freqUnit: event.currentTarget.value as AnsysHarmonicStudyDraft['freqUnit'] })} className={fieldClass}><option value="hz">Hz</option><option value="rads">rad/s</option></select>
        </label>
      </div>
      <p className="text-xs text-muted">{zh ? `线性扫描，频率点数为 2–${MAX_POINTS}。` : `Linear sweep with 2–${MAX_POINTS} frequency points.`}</p>
    </fieldset>
    {validationMessage && <p role="alert" data-testid="ansys-harmonic-validation" className="rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{validationMessage}</p>}
  </section>
}
