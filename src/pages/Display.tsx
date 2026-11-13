import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { displayResult, type DisplayScene } from '../lib/sim/display'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const W = 640, H = 380
type Result = ReturnType<typeof displayResult>
const rgbStr = (rgb: number[]) => 'rgb(' + rgb.join(',') + ')'

export function Display() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<DisplayScene['mode']>('LED')
  const [bandgap, setBandgap] = useState(2)
  const [channels, setChannels] = useState<[number, number, number]>([1, 0.6, 0.2])
  const [rotationDeg, setRotationDeg] = useState(0)
  const scene = useMemo<DisplayScene>(() => mode === 'LED' ? { mode, bandgap }
    : mode === 'OLED' ? { mode, channels } : { mode, rotationDeg }, [mode, bandgap, channels, rotationDeg])
  const compute = useModuleCompute({ module: 'display', scene })
  const result = useMemo(() => compute.target === 'browser' ? displayResult(scene)
    : compute.result?.module === 'display' ? compute.result.result : null, [scene, compute.target, compute.result])
  useEffect(() => { drawDisplay(canvasRef.current, scene, result, zh) }, [scene, result, zh])

  return <div>
    <PageHeader icon="💡" title="显示与发光 · 理想模型" titleEn="Display and emission · ideal models"
      subtitle="计算带隙对应波长、数字 RGB 混色，以及交叉偏振片的理想透过率。"
      subtitleEn="Calculate bandgap wavelength, digital RGB mixing and ideal transmission through crossed polarizers." />
    <div className="toolbar mb-4">
      {(['LED', 'OLED', 'LCD'] as const).map(value => <button key={value} aria-pressed={mode === value}
        onClick={() => setMode(value)} className={'btn border ' + (mode === value ? 'border-cyan-400 text-cyan-300' : 'border-edge text-slate-300')}>{value}</button>)}
      {mode === 'LED' && <ParamSlider label={zh ? '带隙 Eg (eV)' : 'Bandgap Eg (eV)'} ariaLabel="Display bandgap" value={bandgap} min={1.6} max={3.4} step={0.02} onChange={setBandgap} />}
      {mode === 'OLED' && channels.map((value, i) => <ParamSlider key={i} label={['R', 'G', 'B'][i]} ariaLabel={'Display channel ' + i}
        value={value} min={0} max={1} step={0.02} onChange={v => setChannels(old => {
          const next = [...old] as typeof old; next[i] = v; return next
        })} />)}
      {mode === 'LCD' && <ParamSlider label={zh ? '偏振旋转角 φ (°)' : 'Polarization rotation φ (°)'} ariaLabel="Display rotation"
        value={rotationDeg} min={0} max={90} step={1} onChange={setRotationDeg} />}
    </div>
    <canvas ref={canvasRef} width={W} height={H} role="img"
      aria-label={zh ? '显示器理想模型计算结果' : 'Ideal display model result'}
      className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '640/380' }} />
    <div data-display-readout data-display-mode={result?.mode ?? ''} className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center gap-5 rounded-xl border border-edge p-4 text-sm text-slate-300">
      <span className="inline-block h-8 w-8 rounded border border-edge" style={result ? { background: rgbStr(result.rgb) } : undefined} aria-hidden />
      <span>{zh ? '输出 RGB' : 'Output RGB'}: {result?.rgb.join(', ') ?? '—'}</span>
      {mode === 'LED' && <span>λ ≈ {result?.mode === 'LED' ? result.wavelengthNm.toFixed(2) : '—'} nm</span>}
      {mode === 'LCD' && <span>I / I₀ = {result?.mode === 'LCD' ? result.transmission.toFixed(6) : '—'}</span>}
    </div>
    {result?.mode === 'LED' && !result.inColorRange && <p className="note mt-3">{zh
      ? '波长超出当前 380–750 nm 的颜色映射范围，黑色色块表示无法用此映射显示，不表示器件没有发光。'
      : 'The wavelength is outside this 380–750 nm color mapping. A black swatch means this mapping cannot display it, not that emission is absent.'}</p>}
    {mode === 'LCD' && <div className="mx-auto mt-4 max-w-3xl rounded-xl border border-edge p-4">
      <div className="mb-2 text-sm text-slate-400">{zh ? '交叉偏振：I/I₀ = sin²φ' : 'Crossed polarizers: I/I₀ = sin²φ'}</div>
      <svg viewBox="0 0 480 140" className="block w-full" role="img" aria-label={zh ? '偏振旋转与透过率曲线' : 'Polarization rotation and transmission curve'}>
        <path d="M 28 8 V 116 H 464" fill="none" stroke="#475569" />
        {result?.mode === 'LCD' && <>
          <polyline points={result.anglesDeg.map((angle, i) => (28 + angle / 90 * 430) + ',' + (116 - result.transmissions[i] * 102)).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={2} />
          <circle cx={28 + rotationDeg / 90 * 430} cy={116 - result.transmission * 102} r={4} fill="#fbbf24" />
        </>}
        <text x={7} y={16} fill="#94a3b8" fontSize={11}>1</text><text x={7} y={117} fill="#94a3b8" fontSize={11}>0</text>
        <text x={28} y={134} fill="#94a3b8" fontSize={11}>0°</text><text x={432} y={134} fill="#94a3b8" fontSize={11}>90°</text>
      </svg>
    </div>}
    <p className="note mt-4">{mode === 'LED' ? (zh
      ? '采用 λ≈1240/Eg 的光子能量关系和近似波长到 RGB 映射；不计算载流子输运、光谱线宽或发光效率。'
      : 'Uses the photon-energy relation λ≈1240/Eg and an approximate wavelength-to-RGB mapping; carrier transport, linewidth and emission efficiency are not calculated.')
      : mode === 'OLED' ? (zh
        ? '通道值直接映射为 8 位数字 RGB。色块用于加法混色示意，不是实测光谱、亮度或器件效率。'
        : 'Channel values map directly to 8-bit digital RGB. The swatch illustrates additive mixing, not measured spectra, luminance or device efficiency.')
        : (zh
          ? '起偏轴竖直、检偏轴水平。φ 是理想偏振旋转角，检偏失配角为 90°−φ；0° 暗，90° 亮。I₀ 指起偏后强度，不包含第一片对非偏振背光的损失。本页不解算液晶取向、电压响应或双折射。'
          : 'Vertical polarizer, horizontal analyzer. Ideal polarization rotation φ leaves an analyzer mismatch of 90°−φ: dark at 0°, bright at 90°. I₀ is the intensity after the first polarizer, excluding its loss from unpolarized backlight. LC orientation, voltage response and birefringence are not solved.')}</p>
  </div>
}

function drawDisplay(canvas: HTMLCanvasElement | null, scene: DisplayScene, data: Result | null, zh: boolean) {
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#070912'; ctx.fillRect(0, 0, W, H)
  if (!data || data.mode !== scene.mode) return
  ctx.font = '13px system-ui'; ctx.lineWidth = 2
  const caption = (text: string, x: number, y: number) => { ctx.fillStyle = '#94a3b8'; ctx.fillText(text, x, y) }
  if (scene.mode === 'LED' && data.mode === 'LED') {
    ctx.strokeStyle = '#64748b'; ctx.beginPath()
    ctx.moveTo(55, 88); ctx.lineTo(280, 88); ctx.moveTo(55, 265); ctx.lineTo(280, 265); ctx.stroke()
    caption(zh ? '导带' : 'Conduction band', 55, 72); caption(zh ? '价带' : 'Valence band', 55, 290)
    ctx.strokeStyle = '#22d3ee'; ctx.beginPath(); ctx.moveTo(125, 100); ctx.lineTo(125, 248)
    ctx.moveTo(118, 239); ctx.lineTo(125, 248); ctx.lineTo(132, 239); ctx.stroke()
    caption('Eg = ' + scene.bandgap.toFixed(2) + ' eV', 156, 175)
    caption(zh ? '能量差示意，非按比例' : 'Energy gap, not to scale', 55, 330)
    ctx.fillStyle = rgbStr(data.rgb); ctx.beginPath(); ctx.arc(465, 175, 56, 0, 2 * Math.PI); ctx.fill()
    ctx.strokeStyle = '#94a3b8'; ctx.stroke()
    caption('λ ≈ ' + data.wavelengthNm.toFixed(1) + ' nm', 395, 273)
    caption(zh ? '近似颜色' : 'Approximate color', 410, 299)
  } else if (scene.mode === 'OLED' && data.mode === 'OLED') {
    caption(zh ? '数字 RGB 子像素' : 'Digital RGB subpixels', 55, 65)
    data.subpixels.forEach((rgb, i) => {
      const x = 75 + i * 86
      ctx.fillStyle = rgbStr(rgb); ctx.fillRect(x, 100, 48, 180)
      ctx.strokeStyle = '#475569'; ctx.strokeRect(x, 100, 48, 180)
      caption(['R', 'G', 'B'][i] + ' ' + scene.channels[i].toFixed(2), x, 308)
    })
    ctx.fillStyle = rgbStr(data.rgb); ctx.fillRect(420, 140, 96, 96)
    ctx.strokeStyle = '#94a3b8'; ctx.strokeRect(420, 140, 96, 96)
    caption(zh ? '混色结果' : 'Mixed result', 420, 288)
  } else if (scene.mode === 'LCD' && data.mode === 'LCD') {
    caption(zh ? '起偏后 I₀' : 'After polarizer: I₀', 28, 55)
    for (let y = 100; y < 280; y += 30) {
      ctx.strokeStyle = '#a78bfa'; ctx.beginPath(); ctx.moveTo(76, y); ctx.lineTo(76, y + 16); ctx.stroke()
      ctx.strokeStyle = '#fb923c'; ctx.beginPath(); ctx.moveTo(334, y + 8); ctx.lineTo(356, y + 8); ctx.stroke()
    }
    caption(zh ? '竖直起偏轴' : 'Vertical axis', 35, 308)
    caption(zh ? '水平检偏轴' : 'Horizontal axis', 290, 308)
    caption('φ = ' + scene.rotationDeg.toFixed(0) + '°', 181, 78)
    for (let i = 0; i < 5; i++) {
      const angle = scene.rotationDeg * Math.PI / 180 * i / 4, y = 110 + i * 36
      const dx = 14 * Math.sin(angle), dy = 14 * Math.cos(angle)
      ctx.strokeStyle = '#22d3ee'; ctx.beginPath(); ctx.moveTo(218 - dx, y - dy); ctx.lineTo(218 + dx, y + dy); ctx.stroke()
    }
    ctx.fillStyle = rgbStr(data.rgb); ctx.fillRect(450, 140, 92, 92)
    ctx.strokeStyle = '#94a3b8'; ctx.strokeRect(450, 140, 92, 92)
    caption('I/I₀ = ' + data.transmission.toFixed(3), 440, 288)
  }
}
