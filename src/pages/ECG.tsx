import { useRunning } from '../lib/hooks/useRunning'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { ParamSlider } from '../components/ParamSlider'
import { useRafLoop, useSyncedParam } from '../lib/hooks'
import { ecgResult, type EcgScene } from '../lib/sim/ecg'
import { useLocale } from '../lib/i18n'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

import { parseSignalCsv, RECORDING_MAX_BYTES, type SignalRecording } from '../lib/signal-recording'
import { PlayPauseButton } from '../components/PlayPauseButton'

const EXAMPLE_URL = `${import.meta.env.BASE_URL ?? '/'}datasets/mit-bih-100-10s.csv`
const W = 720, H = 360
const N = W // ring buffer 长度（每像素一个样本）

export function ECG() {
  const { running, runningRef, setRunning } = useRunning()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('ecg'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hr = useSyncedParam(75)
  const [samples, setSamples] = useState(1440)
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0), lastRef = useRef(0)
  const [recording, setRecording] = useState<SignalRecording | null>(null), [channel, setChannel] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null), [loading, setLoading] = useState(false)
  const loadRef = useRef<AbortController | null>(null)
  const count = recording ? recording.channels[channel].values.length : samples
  const scene = useMemo<EcgScene>(() => recording ? { recording, channel } : { hr: hr.value, samples }, [recording, channel, hr.value, samples])
  const compute = useModuleCompute({ module: 'ecg', scene })
  const read = useMemo(() => compute.target === 'browser' ? ecgResult(scene)
    : compute.result?.module === 'ecg' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ read, target: compute.target })
  renderRef.current = { read, target: compute.target }

  useEffect(() => () => { loadRef.current?.abort(); loadRef.current = null }, [])
  const previousTarget = useRef(compute.target)
  useEffect(() => {
    if (previousTarget.current !== compute.target) { previousTarget.current = compute.target; setRunning(false) }
  }, [compute.target, setRunning])
  const loadCsv = async (file?: File) => {
    loadRef.current?.abort()
    const controller = new AbortController(); loadRef.current = controller
    setLoading(true); setLoadError(null)
    const timer = setTimeout(() => controller.abort(new Error('Recording download timed out')), 15000)
    try {
      if (file && file.size > RECORDING_MAX_BYTES) throw new Error('Recording exceeds 4 MiB')
      const text = file ? await file.text() : await (async () => {
        const response = await fetch(EXAMPLE_URL, { signal: controller.signal })
        if (!response.ok) throw new Error(`Recording download failed (${response.status})`)
        return response.text()
      })()
      controller.signal.throwIfAborted()
      const next = parseSignalCsv(text)
      setRecording(next); setChannel(0); scanRef.current = 0; setScanIndex(0); setRunning(false)
    } catch (cause) {
      if (loadRef.current === controller) setLoadError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      clearTimeout(timer)
      if (loadRef.current === controller) setLoading(false)
    }
  }
  const synthetic = () => {
    loadRef.current?.abort(); loadRef.current = null; setLoading(false); setLoadError(null)
    setRecording(null); setChannel(0); scanRef.current = 0; setScanIndex(0); setRunning(false)
  }

  useRafLoop(() => {
    const now = performance.now()
    const elapsed = lastRef.current ? Math.min(0.05, (now - lastRef.current) / 1000) : 0
    lastRef.current = now
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
    const { read, target } = renderRef.current
    if (!read) return
    if (runningRef.current && (target === 'browser' || read.source === 'recording')) scanRef.current += elapsed * read.sampleRate
    scanRef.current = Math.min(scanRef.current, read.values.length - 1)
    const si = Math.floor(scanRef.current); setScanIndex(si)
    if (si === read.values.length - 1 && runningRef.current) setRunning(false)
    const recent = read.values.slice(Math.max(0, si - N + 1), si + 1)
    const buf = Array(N - recent.length).fill(0).concat(recent)

    // —— 背景：监护仪深色 + 心电方格（粗/细网格）——
    ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
    const small = 12 // 细格 (~1mm)
    const big = small * 5 // 粗格 (~5mm)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(124,92,255,0.07)'
    ctx.beginPath()
    for (let x = 0; x <= W; x += small) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    for (let y = 0; y <= H; y += small) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke()
    ctx.strokeStyle = 'rgba(124,92,255,0.18)'
    ctx.beginPath()
    for (let x = 0; x <= W; x += big) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    for (let y = 0; y <= H; y += big) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke()

    // 基线参考
    const baseY = H * 0.62
    const fullScale = read.source === 'recording' ? Math.max(0.001, ...buf.map(Math.abs)) : 1
    const scale = read.source === 'recording' ? H * 0.38 / fullScale : 150
    ctx.strokeStyle = 'rgba(120,140,180,0.16)'
    ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(W, baseY); ctx.stroke()

    // —— 滚动心电波形（导联 II，绿色荧光描线）——
    ctx.strokeStyle = '#3ad6ff'
    ctx.lineWidth = 2
    ctx.shadowColor = '#3ad6ff'
    ctx.shadowBlur = 6
    ctx.beginPath()
    for (let x = 0; x < N; x++) {
      const y = baseY - buf[x] * scale
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    // 扫描光点（最新样本处）
    const tipY = baseY - buf[N - 1] * scale
    ctx.fillStyle = '#7c5cff'
    ctx.beginPath(); ctx.arc(N - 1, tipY, 3.5, 0, Math.PI * 2); ctx.fill()

    // PQRST 标注（在画面右侧最近一个 R 峰附近）
    const en = !zhRef.current
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
    ctx.fillText(read.source === 'recording' ? read.label : en ? 'Lead II' : '导联 II', 10, 18)
    ctx.fillText(`+${fullScale.toPrecision(3)} ${read.unit}`, 10, baseY - fullScale * scale - 2)
    ctx.fillStyle = '#ff8a4c'
    ctx.fillText(`${read.sampleRate} ${en ? 'samples/s' : '次/秒'}`, W - 120, 18)

  }, [])

  return (
    <div>
      <PageHeader
        icon="❤️"
        title="心电图"
        subtitle="心脏每次搏动都伴随有序的去极化与复极化：心房活动形成 P 波，心室去极化形成高大的 QRS 复合波，复极化形成圆钝的 T 波。本页按典型导联 II 形态合成 PQRST 波形，显示有限时段的信号；没有求解心脏电场或真实导联投影。拖动心率滑块，看波形如何随心跳疏密变化。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读仿真时' : 'When reading the sim'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话）' : '(hover for plain language)'}
        </span>
      </p>


      <div className="toolbar mb-3">
        <button className="btn border border-edge" disabled={loading} onClick={() => void loadCsv()}>{loading ? (zh ? '加载中' : 'Loading') : (zh ? '加载公开心电样例' : 'Load public ECG sample')}</button>
        <label className="btn border border-edge">{zh ? '导入记录 CSV' : 'Import recording CSV'}
          <input aria-label="Import recording CSV" type="file" accept=".csv,text/csv" disabled={loading}
            onChange={e => { const file = e.target.files?.[0]; if (file) void loadCsv(file); e.target.value = '' }} />
        </label>
        <a className="underline" href={EXAMPLE_URL} download>{zh ? '下载 CSV 样例' : 'Download sample CSV'}</a>
        {recording && <button className="btn border border-edge" onClick={synthetic}>{zh ? '返回合成波形' : 'Synthetic waveform'}</button>}
      </div>
      {loadError && <div role="alert" className="mb-3 text-red-300">{loadError}</div>}
      {recording && <div data-recording-info className="mb-3 space-y-2 text-sm text-slate-400">
        <div>{recording.name} · {recording.sampleRate} Hz · {count} {zh ? '点' : 'samples'} · {(count / recording.sampleRate).toFixed(2)} s · {recording.unit}</div>
        <label>{zh ? '通道' : 'Channel'} <select aria-label="Recording channel" value={channel}
          onChange={e => { setChannel(Number(e.target.value)); scanRef.current = 0; setScanIndex(0); setRunning(false) }}>
          {recording.channels.map((ch, i) => <option key={ch.name} value={i}>{ch.name}</option>)}
        </select></label>
        <PlayPauseButton running={running} onToggle={() => {
          if (scanRef.current >= count - 1) { scanRef.current = 0; setScanIndex(0) }
          setRunning(!running)
        }} />
        {recording.source && <a className="ml-3 underline" href={recording.source} target="_blank" rel="noreferrer">{zh ? '数据来源' : 'Dataset source'}</a>}
        {recording.license && <a className="ml-3 underline" href={recording.license} target="_blank" rel="noreferrer">{zh ? '数据许可' : 'Dataset license'}</a>}
        <p>{zh ? '原始记录按采样率回放；选择后端并开始计算会发送记录，计算均值和均方根。' : 'Replay follows the recorded sample rate. Starting backend computation sends the recording to calculate mean and RMS.'}</p>
      </div>}
      {!recording && <div className="toolbar mb-5">
        <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs text-violet-300">
          {zh ? '心电波形 · 导联 II · 生物电' : 'ECG · lead II · bioelectric'}
        </span>
        <ParamSlider
          label={zh ? '心率' : 'Heart rate'}
          value={hr.value}
          min={40}
          max={180}
          step={1}
          unit={zh ? '次/分' : 'bpm'}
          onChange={hr.set}
        />
        <button
          type="button"
          onClick={() => hr.set(60)}
          className="btn border border-edge text-slate-300"
        >
          {zh ? '静息 60' : 'Rest 60'}
        </button>
        <button
          type="button"
          onClick={() => hr.set(150)}
          className="btn border border-edge text-slate-300"
        >
          {zh ? '运动 150' : 'Exercise 150'}
        </button>
      </div>}

      <div className="toolbar mb-3">
        {!recording && <label>{zh ? '采样点数' : 'Samples'}
          <input aria-label="ECG samples" type="number" min={8} max={2000} value={samples}
            onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 8 && n <= 2000) { setSamples(n); scanRef.current = 0; setScanIndex(0) } }} />
        </label>}
        <label>{zh ? '读图位置' : 'Read position'}
          <input aria-label="ECG cursor" type="range" min={0} max={count - 1} step={1} value={scanIndex}
            onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
        </label>
      </div>
      <canvas ref={canvasRef} width={W} height={H}
        role="img" aria-label={zh ? '心电图模拟画布' : 'ECG canvas'}
        className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '720/360' }} />

      {read && <div data-ecg-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>t = {(scanIndex / read.sampleRate).toFixed(3)} s</span>
        <span>{read.label} = {read.values[scanIndex].toFixed(3)} {read.unit}</span>
        {read.bpm !== null && <span>{zh ? '设定心率' : 'Preset HR'} {read.bpm} bpm · R–R {(read.rr! * 1000).toFixed(0)} ms</span>}
        <span>{zh ? '片段均值' : 'Segment mean'} {read.mean.toFixed(3)} {read.unit}</span>
        <span>RMS {read.rms.toFixed(3)} {read.unit}</span>
      </div>}

      {!recording && <p className="note">
        {zh
          ? '合成方法：在归一化心动周期相位上叠加五个高斯钟形脉冲——主尖峰（R）最高，两侧小负偏（Q、S），主峰前小正波（P）、主峰后圆钝正波（T）；整体以心跳间期 = 60/心率 为周期重复。核心算法已测试验证（主峰为全局最大、波形周期性、P→R→T 时间次序）。'
          : 'Synthesis: five Gaussians on normalized beat phase—tall R, small negative Q/S, pre-R P and post-R T; period = 60/HR. Tests cover global R peak, periodicity, and P→R→T order.'}
      </p>}
    </div>
  )
}
