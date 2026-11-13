import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { SpectrumView } from '../components/SpectrumView'
import { PlayPauseButton } from '../components/PlayPauseButton'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { ELECTROMAGNETIC } from '../data/spectrum'
import { useLocale } from '../lib/i18n'
import { usePlayController, useRafLoop, useRunning, useSyncedParam } from '../lib/hooks'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import {
  createEmPlaneWave,
  readEmPlaneWave,
} from '../lib/sim/spectrum-runnable-algos'

const W = 720
const H = 280
const NX = 200

/** Band presets map to representative frequencies (Hz). */
const BAND_FREQ: Record<string, number> = {
  radio: 100e6,
  microwave: 2.4e9,
  ir: 3e13,
  visible: 5e14,
  uv: 1e15,
  xray: 3e17,
  gamma: 1e19,
}

export function Electromagnetic() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const xs = useMemo(() => {
    const a = new Float64Array(NX)
    for (let i = 0; i < NX; i++) a[i] = i / (NX - 1) // normalized 0..1 m teaching length
    return a
  }, [])

  const { running, runningRef, toggle, setRunning } = useRunning(true)
  const play = usePlayController(1)
  const nParam = useSyncedParam(1.0)
  const eParam = useSyncedParam(1.0)
  const [band, setBand] = useState('microwave')
  const [freqHz, setFreqHz] = useState(BAND_FREQ.microwave)
  const params = useMemo(() => ({ frequencyHz: freqHz, refractiveIndex: nParam.value, ePeak: eParam.value }), [freqHz, nParam.value, eParam.value])
  const input = useMemo(() => ({ module: 'electromagnetic' as const, params, timeSeconds: 0, xs: Array.from(xs) }), [params, xs])
  const compute = useModuleCompute(input, () => ({ ...input, timeSeconds: tRef.current }))
  const remote = compute.result?.module === 'electromagnetic' ? compute.result : null
  const kernelRef = useRef<ReturnType<typeof createEmPlaneWave> | null>(null)
  const [frameError, setFrameError] = useState('')
  const preview = useMemo(() => {
    if (compute.snapshot) return { read: remote?.observables, error: '' }
    try {
      if (kernelRef.current) kernelRef.current.parameters.set([params.frequencyHz, params.refractiveIndex, params.ePeak, 0])
      else kernelRef.current = createEmPlaneWave(params, xs)
      return { read: readEmPlaneWave(kernelRef.current), error: '' }
    } catch (error) { return { read: undefined, error: error instanceof Error ? error.message : String(error) } }
  }, [compute.snapshot, remote, params, xs])
  const read = preview.read
  useEffect(() => { setFrameError(''); if (compute.snapshot) setRunning(false) }, [compute.snapshot, params])

  useRafLoop(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const ePeak = eParam.ref.current
    const steps = !compute.snapshot && read?.ok && !frameError ? play.stepsThisFrame(runningRef.current) : 0
    // Teaching time scale: map frame steps to seconds so many cycles are visible
    const dt = 1 / (freqHz * 40)
    for (let s = 0; s < steps; s++) tRef.current += dt

    let fields: { E: ArrayLike<number>; B: ArrayLike<number> } | null = compute.snapshot ? remote : null
    if (!compute.snapshot && read?.ok && !frameError && kernelRef.current) {
      try {
        kernelRef.current.sample(tRef.current)
        fields = { E: kernelRef.current.first, B: kernelRef.current.second }
      } catch (error) { setFrameError(String(error)); setRunning(false) }
    }

    ctx.fillStyle = '#05070f'
    ctx.fillRect(0, 0, W, H)
    // mid lines
    ctx.strokeStyle = '#1e293b'
    ctx.beginPath()
    ctx.moveTo(0, H * 0.35)
    ctx.lineTo(W, H * 0.35)
    ctx.moveTo(0, H * 0.75)
    ctx.lineTo(W, H * 0.75)
    ctx.stroke()

    if (!fields || !read?.ok) return
    // E (cyan) top, B (amber) bottom — same phase, scaled
    const drawTrace = (arr: ArrayLike<number>, y0: number, color: string, scale: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < NX; i++) {
        const x = (i / (NX - 1)) * W
        const y = y0 - (arr[i] / scale) * (H * 0.22)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    drawTrace(fields.E, H * 0.35, '#22d3ee', Math.max(ePeak, 1e-9))
    drawTrace(fields.B, H * 0.75, '#fbbf24', Math.max(read.bPeak, 1e-12))

    ctx.fillStyle = '#94a3b8'
    ctx.font = '12px system-ui'
    ctx.fillText(zh ? 'E (横向)' : 'E (transverse)', 10, 18)
    ctx.fillText(zh ? 'B (横向)' : 'B (transverse)', 10, H * 0.55)
  }, [freqHz, band, compute.snapshot, remote, read, frameError])

  const fmt = (v: number | undefined, d = 3) => (v !== undefined && Number.isFinite(v) ? v.toExponential(d) : '—')

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          icon="📡"
          title="电磁波谱 · 平面波演示"
          titleEn="EM spectrum · plane-wave demo"
          subtitle="横电磁波：调波段/折射率/场强，看 E 与 B 同相行波、波长、相速、波阻抗与平均强度。"
          subtitleEn="TEM plane wave: tune band / n / amplitude; watch co-phase E & B, λ, phase velocity, impedance, intensity."
        />

        {(preview.error || frameError) && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error || frameError}</p>}

        <div className="toolbar mb-4 flex flex-wrap items-center gap-2">
          {!compute.snapshot && <><PlayPauseButton running={running} onToggle={toggle} />
          <button
            type="button"
            className="btn border border-edge text-slate-300"
            onClick={() => {
              tRef.current = 0
            }}
          >
            {zh ? '↺ 相位重置' : '↺ Reset phase'}
          </button>
          <SpeedControl value={play.playSpeed} onChange={play.setPlaySpeed} /></>}
          <label className="flex items-center gap-1 text-xs text-slate-400">
            {zh ? '波段' : 'Band'}
            <select
              className="rounded border border-edge bg-slate-900 px-2 py-1 text-slate-200"
              value={band}
              onChange={(e) => {
                const id = e.target.value
                setBand(id)
                setFreqHz(BAND_FREQ[id] ?? BAND_FREQ.microwave)
                tRef.current = 0
              }}
            >
              <option value="radio">{zh ? '无线电' : 'Radio'}</option>
              <option value="microwave">{zh ? '微波' : 'Microwave'}</option>
              <option value="ir">{zh ? '红外' : 'IR'}</option>
              <option value="visible">{zh ? '可见光' : 'Visible'}</option>
              <option value="uv">{zh ? '紫外' : 'UV'}</option>
            </select>
          </label>
          <ParamSlider
            label={zh ? '折射率 n' : 'Index n'}
            value={nParam.value}
            min={1}
            max={2.5}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={nParam.set}
          />
          <ParamSlider
            label={zh ? 'E 峰值' : 'E peak'}
            value={eParam.value}
            min={0.1}
            max={5}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={eParam.set}
          />
        </div>

        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="mb-3 w-full max-w-4xl rounded-xl border border-white/10 bg-black"
          role="img"
          aria-label={zh ? '电磁波 E/B 行波画布' : 'EM E/B traveling-wave canvas'}
        />

        <div data-electromagnetic-readout className="grid max-w-4xl gap-2 font-mono text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            f = {fmt(freqHz, 2)} Hz
          </div>
          <div>
            λ = {fmt(read?.wavelengthM, 3)} m
          </div>
          <div>
            v_p = {fmt(read?.phaseVelocity, 3)} m/s
          </div>
          <div>
            η = {fmt(read?.impedance, 3)} Ω
          </div>
          <div>
            B₀ = {fmt(read?.bPeak, 3)} T
          </div>
          <div>
            ⟨S⟩ = {fmt(read?.intensityWm2, 3)} W/m²
          </div>
        </div>
      </div>

      <SpectrumView spectrum={ELECTROMAGNETIC} />
    </div>
  )
}
