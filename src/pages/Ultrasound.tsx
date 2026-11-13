import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { ultrasoundResult, US_MAX_DEPTH as MAX_DEPTH, US_SAMPLES as SAMPLES, US_LINES as NLINES, US_LAYERS as LAYERS, US_Z_VALUES as Z_VALUES } from '../lib/sim/ultrasound'
import { useLocale } from '../lib/i18n'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

const W = 640
const H = 380
export function Ultrasound() {
  const { runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('ultrasound'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [atten, setAtten] = useState(0.025)
  const [gain, setGain] = useState(1.0)
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ atten, gain }), [atten, gain])
  const compute = useModuleCompute({ module: 'ultrasound', scene })
  const data = useMemo(() => compute.target === 'browser' ? ultrasoundResult(scene)
    : compute.result?.module === 'ultrasound' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ data, target: compute.target })
  renderRef.current = { data, target: compute.target }
  const readout = data ? { lx: scanIndex / (NLINES - 1), rTop: data.coefficients[0], echoes: data.echoes[scanIndex] } : null
  const coefs = data?.coefficients.map((r, i) => ({ r, z1: Z_VALUES[i], z2: Z_VALUES[i + 1],
    name: zh ? `${LAYERS[i].name} → ${LAYERS[i + 1].name}` : `${LAYERS[i].nameEn} → ${LAYERS[i + 1].nameEn}` })) ?? []

  useEffect(() => {
    let disposed = false
    // 持久 B 模图缓存（逐线填充）
    const imgX = 30
    const imgW = 360
    const imgY = 36
    const imgH = 312

    const loop = () => {
      if (disposed) return
      const c = canvasRef.current
      if (!c) return
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      const { data, target } = renderRef.current
      if (!data) return
      if (runningRef.current && target === 'browser') scanRef.current = (scanRef.current + 1) % NLINES
      const li = Math.floor(scanRef.current); setScanIndex(li)
      const cols = data.field, a = cols.slice(li * SAMPLES, (li + 1) * SAMPLES)

      // —— 左：B 型灰度图（逐线扫描出来） ——
      const drawn = NLINES
      const colW = imgW / NLINES
      const rowH = imgH / SAMPLES
      for (let x = 0; x < drawn; x++) {
        for (let s = 0; s < SAMPLES; s++) {
          let v = cols[x * SAMPLES + s]
          v = Math.min(1, Math.pow(v * 2.4, 0.7)) // 固定幂律灰度映射（不是对数压缩）
          const g = Math.round(v * 255)
          if (g < 4) continue
          ctx.fillStyle = `rgb(${g},${g},${g})`
          ctx.fillRect(imgX + x * colW, imgY + s * rowH, colW + 0.6, rowH + 0.6)
        }
      }
      // 图框
      ctx.strokeStyle = '#26304a'
      ctx.strokeRect(imgX, imgY, imgW, imgH)
      // 当前扫描线高亮
      const sxNow = imgX + li * colW
      ctx.strokeStyle = 'rgba(124,92,255,0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sxNow, imgY)
      ctx.lineTo(sxNow, imgY + imgH)
      ctx.stroke()
      // 探头
      ctx.fillStyle = '#3ad6ff'
      ctx.fillRect(imgX, imgY - 10, imgW, 6)
      const en = !zhRef.current
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px sans-serif'
      ctx.fillText(en ? 'Linear array →' : '线阵探头 →', imgX, imgY - 14)
      ctx.fillText(
        en
          ? 'B-mode (lateral × depth; power-law grayscale)'
          : '亮度模灰度图（横向×深度，幂律灰度映射）',
        imgX,
        imgY + imgH + 16,
      )
      // 深度刻度
      ctx.fillStyle = '#64748b'
      ctx.font = '10px sans-serif'
      for (let d = 0; d <= MAX_DEPTH; d += 25) {
        const yy = imgY + (d / MAX_DEPTH) * imgH
        ctx.fillText(`${d}`, imgX - 22, yy + 3)
      }
      ctx.fillText(en ? 'depth' : '深度', imgX - 26, imgY - 4)

      // —— 右：当前 A 线波形（A 型扫描示波） ——
      const aX = imgX + imgW + 60
      const aW = 150
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px sans-serif'
      ctx.fillText(
        en ? 'A-line (echo amplitude vs depth)' : '幅度线（当前回波幅度对深度）',
        aX - 8,
        imgY - 14,
      )
      ctx.strokeStyle = '#1b2438'
      ctx.beginPath()
      ctx.moveTo(aX, imgY)
      ctx.lineTo(aX, imgY + imgH)
      ctx.stroke()
      let aMax = 1e-6
      for (let s = 0; s < SAMPLES; s++) aMax = Math.max(aMax, a[s])
      ctx.strokeStyle = '#3ad6ff'
      ctx.lineWidth = 1.3
      ctx.beginPath()
      for (let s = 0; s < SAMPLES; s++) {
        const yy = imgY + ((s + 0.5) / SAMPLES) * imgH
        const xx = aX + (a[s] / aMax) * aW
        s ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy)
      }
      ctx.stroke()
      // 衰减包络线（exp 参考）
      ctx.strokeStyle = 'rgba(255,138,76,0.45)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      for (let s = 0; s < SAMPLES; s++) {
        const env = data.envelope[s]
        const yy = imgY + ((s + 0.5) / SAMPLES) * imgH
        const xx = aX + env * aW
        s ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#ff8a4c'
      ctx.font = '10px sans-serif'
      ctx.fillText(
        en ? 'Attenuation envelope e^(−μd)' : '衰减包络 e^(−μd)',
        aX + 8,
        imgY + imgH + 16,
      )


    }
    const stopLoop = startLoop(loop)
    return () => {
      disposed = true
      stopLoop()
    }
  }, [])

  return (
    <div>
      <PageHeader
        icon="🩻"
        title="超声 B 超成像"
        subtitle="超声脉冲射入组织，每遇到声阻抗不同的界面就反射出回波——阻抗差越大回波越强。把一条声束上的回波按深度（往返时间）排成一条线，再让探头横向扫描、把多条线按亮度拼起来，就得到熟悉的 B 超灰度图。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读仿真时' : 'When reading the sim'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话）' : '(hover for plain language)'}
        </span>
        <Link to="/method-depth?m=method-acoustics-3d" className="text-wave/80 hover:text-wave">
          {zh ? '原理深度树 →' : 'Principle depth tree →'}
        </Link>
      </p>


      <div className="toolbar mb-5">
        <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs text-sky-300">
          {zh
            ? '声阻抗界面 · 回波 · A 线 → B 模'
            : 'Acoustic Z interfaces · echoes · A-line → B-mode'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '衰减' : 'Attenuation'} μ={atten.toFixed(3)}
          <input
            type="range"
            min={0}
            max={0.06}
            step={0.002}
            value={atten}
            onChange={(e) => {
              const v = Number(e.target.value)
              setAtten(v)
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '增益' : 'Gain'} ={gain.toFixed(2)}
          <input
            type="range"
            min={0.4}
            max={2}
            step={0.05}
            value={gain}
            onChange={(e) => {
              const v = Number(e.target.value)
              setGain(v)
            }}
          />
        </label>
      </div>

      <label className="toolbar mb-3">{zh ? '读图位置' : 'Read position'}
        <input aria-label="Ultrasound cursor" type="range" min={0} max={NLINES - 1} step={1} value={scanIndex}
          onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
      </label>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        role="img"
        aria-label={zh ? '超声成像模拟画布' : 'Ultrasound imaging canvas'}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '640/380' }}
      />

      {readout && <div data-ultrasound-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-1 font-mono text-xs text-slate-400">
        <span>
          {zh ? '扫描位置' : 'Scan'} x{' '}
          <span className="text-slate-300">{(readout.lx * 100).toFixed(0)}%</span>
        </span>
        <span>
          {zh ? '首界面' : 'First interface'} r{' '}
          <span className="text-sky-300">{readout.rTop.toFixed(3)}</span>
        </span>
        <span>
          {zh ? '阈值以上峰数' : 'Peaks above threshold'}{' '}
          <span className="text-violet-300">{readout.echoes}</span>
        </span>
      </div>}

      <div className="mx-auto mt-3 max-w-3xl rounded-lg border border-edge bg-black/20 p-3 font-mono text-xs text-slate-400">
        <div className="mb-1 text-slate-300">
          {zh
            ? '体模界面反射系数（由两侧声阻抗差决定）：'
            : 'Phantom interface reflection coeffs (from Z mismatch):'}
        </div>
        {coefs.map((c) => (
          <div key={c.name} className="flex justify-between">
            <span>{c.name}</span>
            <span>
              {zh ? '阻抗' : 'Z'} {c.z1.toFixed(2)}→{c.z2.toFixed(2)} ·{' '}
              <span className={c.r >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {zh ? '反射' : 'R'} {c.r.toFixed(4)}
              </span>
            </span>
          </div>
        ))}
        <div className="mt-1 flex justify-between text-slate-500">
          <span>{zh ? '囊肿（无回声 + 后壁增强）' : 'Cyst (anechoic + posterior enhance)'}</span>
          <span>{zh ? '囊液 1.48 ↔ 组织 1.65' : 'Fluid 1.48 ↔ tissue 1.65'}</span>
        </div>
      </div>

      <p className="note">
        {zh
          ? '脉冲回波卷积模型：反射率剖面由阻抗图逐点计算 r=(Z2−Z1)/(Z2+Z1)，与高斯窗正弦发射脉冲卷积；衰减按深度逐层累积 exp(−2∫α·f·d/c)，囊肿内囊液 α≈0 → 无回声暗区且后方回声增强（真实超声征象）。散斑由种子化亚分辨散射体产生，I/Q 解调包络后 −60dB 对数压缩。逐条 A 线拼接成 B 模灰度图。核心算法已测试验证。'
          : 'Pulse-echo convolution model: the reflectivity profile is computed pointwise from the impedance map, r=(Z2−Z1)/(Z2+Z1), and convolved with a Gaussian-windowed transmit pulse. Attenuation accumulates per layer as exp(−2∫α·f·d/c); cyst fluid has α≈0 → anechoic zone with posterior enhancement (a real ultrasound sign). Speckle comes from seeded sub-resolution scatterers, I/Q demodulated envelope, −60 dB log compression. Stacking A-lines builds B-mode. Core algorithm is tested.'}
      </p>
    </div>
  )
}
