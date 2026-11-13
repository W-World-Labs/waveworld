import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { SpectrumView } from '../components/SpectrumView'
import { PlayPauseButton } from '../components/PlayPauseButton'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { SOUND } from '../data/spectrum'
import { useLocale } from '../lib/i18n'
import { usePlayController, useRafLoop, useRunning, useSyncedParam } from '../lib/hooks'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import {
  createAcousticPlaneWave,
  readAcousticPlaneWave,
} from '../lib/sim/spectrum-runnable-algos'

const W = 720
const H = 280
const NX = 200

const MEDIA: Record<string, { rho: number; c: number; label: string; labelEn: string }> = {
  air: { rho: 1.2, c: 343, label: '空气', labelEn: 'Air' },
  water: { rho: 1000, c: 1480, label: '水', labelEn: 'Water' },
  steel: { rho: 7800, c: 5100, label: '钢', labelEn: 'Steel' },
}

export function Sound() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const xs = useMemo(() => {
    // 0..2 m teaching line
    const a = new Float64Array(NX)
    for (let i = 0; i < NX; i++) a[i] = (2 * i) / (NX - 1)
    return a
  }, [])

  const { running, runningRef, toggle, setRunning } = useRunning(true)
  const play = usePlayController(1)
  const fParam = useSyncedParam(1000)
  const pParam = useSyncedParam(2)
  const [medium, setMedium] = useState('air')
  const med = MEDIA[medium] ?? MEDIA.air
  const params = useMemo(() => ({ frequencyHz: fParam.value, rho: med.rho, c: med.c, pPeak: pParam.value }), [fParam.value, med, pParam.value])
  const input = useMemo(() => ({ module: 'sound' as const, params, timeSeconds: 0, xs: Array.from(xs) }), [params, xs])
  const compute = useModuleCompute(input, () => ({ ...input, timeSeconds: tRef.current }))
  const remote = compute.result?.module === 'sound' ? compute.result : null
  const kernelRef = useRef<ReturnType<typeof createAcousticPlaneWave> | null>(null)
  const [frameError, setFrameError] = useState('')
  const preview = useMemo(() => {
    if (compute.snapshot) return { read: remote?.observables, error: '' }
    try {
      if (kernelRef.current) kernelRef.current.parameters.set([params.frequencyHz, params.rho, params.c, params.pPeak, 0])
      else kernelRef.current = createAcousticPlaneWave(params, xs)
      return { read: readAcousticPlaneWave(kernelRef.current), error: '' }
    } catch (error) { return { read: undefined, error: error instanceof Error ? error.message : String(error) } }
  }, [compute.snapshot, remote, params, xs])
  const read = preview.read
  useEffect(() => { setFrameError(''); if (compute.snapshot) setRunning(false) }, [compute.snapshot, params])

  useRafLoop(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const f = fParam.ref.current
    const pPeak = pParam.ref.current
    const steps = !compute.snapshot && read?.ok && !frameError ? play.stepsThisFrame(runningRef.current) : 0
    const dt = 1 / (f * 40)
    for (let s = 0; s < steps; s++) tRef.current += dt

    let fields: { pressure: ArrayLike<number>; velocity: ArrayLike<number> } | null = compute.snapshot ? remote : null
    if (!compute.snapshot && read?.ok && !frameError && kernelRef.current) {
      try {
        kernelRef.current.sample(tRef.current)
        fields = { pressure: kernelRef.current.first, velocity: kernelRef.current.second }
      } catch (error) { setFrameError(String(error)); setRunning(false) }
    }

    ctx.fillStyle = '#05070f'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#1e293b'
    ctx.beginPath()
    ctx.moveTo(0, H * 0.35)
    ctx.lineTo(W, H * 0.35)
    ctx.moveTo(0, H * 0.75)
    ctx.lineTo(W, H * 0.75)
    ctx.stroke()

    if (!fields || !read?.ok) return
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
    drawTrace(fields.pressure, H * 0.35, '#34d399', Math.max(pPeak, 1e-9))
    drawTrace(fields.velocity, H * 0.75, '#a78bfa', Math.max(read.vPeak, 1e-12))

    ctx.fillStyle = '#94a3b8'
    ctx.font = '12px system-ui'
    ctx.fillText(zh ? '声压 p' : 'Pressure p', 10, 18)
    ctx.fillText(zh ? '质点速度 u' : 'Particle velocity u', 10, H * 0.55)
  }, [medium, compute.snapshot, remote, read, frameError])

  const fmt = (v: number | undefined, d = 3) => (v !== undefined && Number.isFinite(v) ? v.toExponential(d) : '—')

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          icon="🔊"
          title="声波频谱 · 行波演示"
          titleEn="Sound spectrum · traveling-wave demo"
          subtitle="声压与质点速度同相行波：换介质（Z=ρc）、频率与压强峰值，读波长、声阻抗与平均声强。"
          subtitleEn="Co-phase pressure & particle velocity: change medium (Z=ρc), f, p_peak; read λ, impedance, intensity."
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
            {zh ? '介质' : 'Medium'}
            <select
              className="rounded border border-edge bg-slate-900 px-2 py-1 text-slate-200"
              value={medium}
              onChange={(e) => {
                setMedium(e.target.value)
                tRef.current = 0
              }}
            >
              {Object.entries(MEDIA).map(([id, m]) => (
                <option key={id} value={id}>
                  {zh ? m.label : m.labelEn}
                </option>
              ))}
            </select>
          </label>
          <ParamSlider
            label={zh ? '频率 f' : 'Freq f'}
            value={fParam.value}
            min={200}
            max={4000}
            step={10}
            format={(v) => `${Math.round(v)} Hz`}
            onChange={fParam.set}
          />
          <ParamSlider
            label={zh ? '压强峰值' : 'p peak'}
            value={pParam.value}
            min={0.2}
            max={20}
            step={0.1}
            format={(v) => `${v.toFixed(1)} Pa`}
            onChange={pParam.set}
          />
        </div>

        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="mb-3 w-full max-w-4xl rounded-xl border border-white/10 bg-black"
          role="img"
          aria-label={zh ? '声波 p/u 行波画布' : 'Acoustic p/u traveling-wave canvas'}
        />

        <div data-sound-readout className="grid max-w-4xl gap-2 font-mono text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            {zh ? '介质' : 'Medium'}: {zh ? med.label : med.labelEn} (ρ={med.rho}, c={med.c})
          </div>
          <div>λ = {fmt(read?.wavelengthM, 3)} m</div>
          <div>Z = {fmt(read?.impedance, 3)} Pa·s/m</div>
          <div>u₀ = {fmt(read?.vPeak, 3)} m/s</div>
          <div>I = {fmt(read?.intensityWm2, 3)} W/m²</div>
        </div>
      </div>

      <SpectrumView spectrum={SOUND} />
    </div>
  )
}
