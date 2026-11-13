import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import {
  type OpticsComponent,
  type OpticsKind,
  type OpticsPresetId,
  type OpticsEvent,
  SCENE_W,
  SCENE_H,
  OPTICS_PALETTE,
  OPTICS_PRESETS,
  OPTICS_PRESET_GROUPS,
  defaultComponent,
  opticsPreset,
  totalScreenPower,
  wavelengthToRgb,
  serializeScene,
  parseScene,
  experimentHints,
  decorateHuygens,
  sampleHuygensField,
  makeSlitPlate,
  fringeScale,
} from '../lib/lab/optics-lab'
import { pickLocaleString, useLocale } from '../lib/i18n'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { restoreOpticsTrace, validateModuleInput } from '../lib/sim/module-compute'
import { createOpticsTrace, readOpticsTrace } from '../lib/lab/optics-lab'

type DragMode =
  | null
  | { mode: 'move'; id: string; ox: number; oy: number; cx: number; cy: number }
  | { mode: 'rotate'; id: string }

const SNAP = 10

function kindIcon(kind: OpticsKind): string {
  return OPTICS_PALETTE.find((p) => p.kind === kind)?.icon ?? '•'
}

function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP
}

export function OpticsLab() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [components, setComponents] = useState<OpticsComponent[]>(() =>
    opticsPreset('mirror-bounce'),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragMode>(null)
  const [presetId, setPresetId] = useState<OpticsPresetId>('mirror-bounce')
  const [snapOn, setSnapOn] = useState(true)
  const [showEvents, setShowEvents] = useState(false)
  const [, setHistory] = useState<OpticsComponent[][]>([])
  const historyRef = useRef<OpticsComponent[][]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const selected = components.find((c) => c.id === selectedId) ?? null
  const compute = useModuleCompute({ module: 'optics-lab', components })
  const traceRef = useRef<ReturnType<typeof createOpticsTrace> | null>(null)
  const preview = useMemo(() => {
    if (compute.snapshot) {
      const result = compute.result
      const raw = result?.module === 'optics-lab' ? restoreOpticsTrace(result.trace) : null
      return { trace: raw ? decorateHuygens(raw, components) : null, error: '' }
    }
    try {
      validateModuleInput({ module: 'optics-lab', components })
      if (traceRef.current) traceRef.current.reset(components)
      else traceRef.current = createOpticsTrace(components)
      while (!traceRef.current.done) traceRef.current.advance()
      return { trace: decorateHuygens(readOpticsTrace(traceRef.current, components), components), error: '' }
    } catch (error) {
      return { trace: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [components, compute.snapshot, compute.result])
  const trace = preview.trace ?? { segments: [], hits: [], events: [], profiles: [], screenPower: {} }
  const screenPow = totalScreenPower(trace)
  const hasResult = preview.trace !== null
  const hints = experimentHints(presetId, locale)
  const recentEvents = useMemo(
    () => [...trace.events].reverse().slice(0, 12),
    [trace.events],
  )
  const selectedProfile = useMemo(() => {
    if (!selected || selected.kind !== 'screen') return null
    return trace.profiles.find((p) => p.componentId === selected.id) ?? null
  }, [selected, trace.profiles])
  const waveField = useMemo(() => sampleHuygensField(components), [components])
  const waveMax = useMemo(() => {
    if (!waveField) return 0
    let m = 0
    for (const v of waveField.values) if (v > m) m = v
    return m
  }, [waveField])
  const fringe = useMemo(() => fringeScale(components), [components])

  const pushHistory = useCallback((prev: OpticsComponent[]) => {
    historyRef.current = [...historyRef.current.slice(-24), prev.map((c) => ({ ...c }))]
    setHistory(historyRef.current)
  }, [])

  const clientToScene = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * SCENE_W,
      y: ((clientY - r.top) / r.height) * SCENE_H,
    }
  }, [])

  const commit = useCallback(
    (next: OpticsComponent[] | ((p: OpticsComponent[]) => OpticsComponent[])) => {
      setComponents((prev) => {
        pushHistory(prev)
        return typeof next === 'function' ? next(prev) : next
      })
    },
    [pushHistory],
  )

  const addKind = (kind: OpticsKind) => {
    const c = defaultComponent(
      kind,
      SCENE_W * 0.42 + Math.random() * 50,
      SCENE_H * 0.42 + Math.random() * 40,
    )
    commit((prev) => [...prev, c])
    setSelectedId(c.id)
  }

  const addDoubleSlitPlate = () => {
    const plate = makeSlitPlate(SCENE_W * 0.38, SCENE_H / 2, 180, 2, 36, 10)
    commit((prev) => [...prev, ...plate])
    setSelectedId(plate[0]?.id ?? null)
  }

  const loadPreset = (id: OpticsPresetId) => {
    const next = opticsPreset(id)
    commit(next)
    setPresetId(id)
    setSelectedId(next[0]?.id ?? null)
  }

  const updateSelected = (patch: Partial<OpticsComponent>) => {
    if (!selectedId) return
    commit((prev) => prev.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)))
  }

  const removeSelected = () => {
    if (!selectedId) return
    commit((prev) => prev.filter((c) => c.id !== selectedId))
    setSelectedId(null)
  }

  const undo = () => {
    const h = historyRef.current
    if (!h.length) return
    const prev = h[h.length - 1]
    historyRef.current = h.slice(0, -1)
    setHistory(historyRef.current)
    setComponents(prev)
  }

  const exportJson = () => {
    const blob = new Blob([serializeScene(components, presetId)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `optics-lab-${presetId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = (file: File) => {
    file.text().then((t) => {
      try {
        const comps = parseScene(t)
        commit(comps)
        setSelectedId(comps[0]?.id ?? null)
      } catch {
        alert(zh ? '场景文件无法解析' : 'Could not parse scene file')
      }
    }).catch(() => {
      alert(zh ? '场景文件无法读取' : 'Could not read scene file')
    })
  }

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (!selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
        return
      }
      const step = e.shiftKey ? 5 : 1
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        updateSelected({
          rot: ((selected?.rot ?? 0) - step + 360) % 360,
        })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        updateSelected({
          rot: ((selected?.rot ?? 0) + step) % 360,
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        updateSelected({ y: Math.max(20, (selected?.y ?? 0) - step) })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        updateSelected({ y: Math.min(SCENE_H - 20, (selected?.y ?? 0) + step) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected, components])

  const onPointerDownComp = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    e.preventDefault()
    const c = components.find((x) => x.id === id)
    if (!c) return
    setSelectedId(id)
    const p = clientToScene(e.clientX, e.clientY)
    setDrag({ mode: 'move', id, ox: p.x, oy: p.y, cx: c.x, cy: c.y })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerDownRotate = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    e.preventDefault()
    setSelectedId(id)
    setDrag({ mode: 'rotate', id })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = clientToScene(e.clientX, e.clientY)
    if (drag.mode === 'move') {
      let nx = drag.cx + (p.x - drag.ox)
      let ny = drag.cy + (p.y - drag.oy)
      if (snapOn) {
        nx = snap(nx)
        ny = snap(ny)
      }
      nx = Math.max(20, Math.min(SCENE_W - 20, nx))
      ny = Math.max(20, Math.min(SCENE_H - 20, ny))
      setComponents((prev) =>
        prev.map((c) => (c.id === drag.id ? { ...c, x: nx, y: ny } : c)),
      )
    } else if (drag.mode === 'rotate') {
      const c = components.find((x) => x.id === drag.id)
      if (!c) return
      const ang = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI
      const rot = snapOn ? snap(ang) : ang
      setComponents((prev) =>
        prev.map((x) => (x.id === drag.id ? { ...x, rot: ((rot % 360) + 360) % 360 } : x)),
      )
    }
  }

  const onPointerUp = () => {
    if (drag) {
      // snapshot once per drag end into history
      setHistory((h) => h) // no-op structure; movement already live — push on next commit
    }
    setDrag(null)
  }

  return (
    <div className="pb-10">
      <PageHeader
        icon="🔬"
        title="光学实验场"
        subtitle={hints[0]}
        subtitleEn={hints[0]}
        showMethods={false}
      />

      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}

      <section className="card mx-auto mb-3 max-w-6xl p-3" aria-label={zh ? '一键实验台' : 'One-click benches'}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">{zh ? '一键配置知名实验' : 'One-click famous setups'}</h2>
          <p className="text-xs text-slate-400">
            {zh ? '点击卡片立即摆好光源与器件，可再拖动微调。' : 'A click places sources and optics; drag to fine-tune.'}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {OPTICS_PRESET_GROUPS.map((group) => (
            <div key={group.id}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {pickLocaleString(group.label, group.labelEn, locale)}
              </h3>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {OPTICS_PRESETS.filter((preset) => preset.group === group.id).map((preset) => {
                  const on = presetId === preset.id
                  return (
                    <li key={preset.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        className={`w-full rounded-lg border px-2 py-1.5 text-left text-sm transition ${
                          on ? 'border-wave/50 bg-wave/10 text-wave' : 'border-edge/70 bg-canvas/40 text-slate-200 hover:border-wave/40'
                        }`}
                        onClick={() => loadPreset(preset.id)}
                      >
                        <span className="block font-medium">{pickLocaleString(preset.label, preset.labelEn, locale)}</span>
                        <span className="block text-xs leading-snug text-slate-400">
                          {pickLocaleString(preset.blurb, preset.blurbEn, locale)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Toolbar */}
      <div className="toolbar mb-3 max-w-6xl !justify-start gap-2 overflow-x-auto">
        <label className="flex items-center gap-2 text-slate-300">
          {zh ? '实验示例' : 'Example'}
          <select aria-label={zh ? '实验示例' : 'Example'} value={presetId} onChange={(event) => loadPreset(event.target.value as OpticsPresetId)}
            className="min-h-11 rounded-lg border border-slate-600 bg-canvas px-3 text-base text-white">
            {OPTICS_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{pickLocaleString(preset.label, preset.labelEn, locale)}</option>)}
          </select>
        </label>
        <span className="mx-1 h-5 w-px shrink-0 bg-edge" />
        <button type="button" className="btn shrink-0 border border-edge text-slate-300" onClick={undo}>
          {zh ? '撤销' : 'Undo'}
        </button>
        <button
          type="button"
          className={`btn shrink-0 border ${snapOn ? 'border-wave/40 text-wave' : 'border-edge text-slate-400'}`}
          onClick={() => setSnapOn((s) => !s)}
        >
          {zh ? '网格吸附' : 'Snap'} {snapOn ? (zh ? '开' : 'on') : zh ? '关' : 'off'}
        </button>
        <details className="sm:ml-auto">
          <summary className="min-h-11 cursor-pointer py-2.5 text-sm text-slate-400">{zh ? '场景文件与清空' : 'Scene files and clear'}</summary>
          <div className="flex flex-wrap gap-2 pb-1">
            <button type="button" className="btn shrink-0 border border-edge text-slate-300" onClick={exportJson}>
              {zh ? '导出场景' : 'Export'}
            </button>
            <button
              type="button"
              className="btn shrink-0 border border-edge text-slate-300"
              onClick={() => fileRef.current?.click()}
            >
              {zh ? '导入' : 'Import'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importJson(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="btn shrink-0 border border-edge/80 text-slate-400 hover:text-rose-300"
              onClick={() => {
                commit([])
                setSelectedId(null)
                setPresetId('empty')
              }}
            >
              {zh ? '清空' : 'Clear'}
            </button>
          </div>
        </details>
      </div>

      <div className="mx-auto grid max-w-6xl gap-3 lg:grid-cols-[180px_minmax(0,1fr)_240px]">
        {/* Palette */}
        <aside className="card order-3 max-h-[70vh] overflow-y-auto p-3 lg:order-1">
          <h2 className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
            {zh ? '元件库' : 'Palette'}
          </h2>
          <ul className="flex flex-col gap-1">
            {OPTICS_PALETTE.map((item) => (
              <li key={item.kind}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-lg border border-edge/70 bg-canvas/40 px-2 py-1.5 text-left text-sm transition hover:border-wave/40 hover:bg-panel"
                  onClick={() => addKind(item.kind)}
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  <span>
                    <span className="block font-medium text-slate-100">
                      {pickLocaleString(item.label, item.labelEn, locale)}
                    </span>
                    <span className="block text-xs leading-snug text-slate-400">
                      {pickLocaleString(item.blurb, item.blurbEn, locale)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-2 flex w-full items-start gap-2 rounded-lg border border-wave/30 bg-wave/5 px-2 py-1.5 text-left text-sm transition hover:border-wave/50"
            onClick={addDoubleSlitPlate}
          >
            <span className="text-base leading-none">▥</span>
            <span>
              <span className="block font-medium text-slate-100">{zh ? '双缝板' : 'Double-slit plate'}</span>
              <span className="block text-xs leading-snug text-slate-400">
                {zh ? '一键放上带两缝的挡板' : 'Drop a two-slit barrier'}
              </span>
            </span>
          </button>
          <div className="mt-3 space-y-1 border-t border-edge/50 pt-2 text-xs leading-relaxed text-slate-400">
            <p>
              {zh
                ? '拖拽移动 · 蓝点拖旋转 · 右侧调参'
                : 'Drag to move · blue handle rotates · edit on right'}
            </p>
            <p>
              {zh ? '方法脊梁：' : 'Methods: '}
              <Link className="text-wave/90 hover:underline" to="/methods">
                {zh ? '斯涅尔 / 菲涅耳 / 马吕斯' : 'Snell / Fresnel / Malus'}
              </Link>
            </p>
            <p>
              {zh ? '对照：' : 'Compare: '}
              <Link className="text-wave/90 hover:underline" to="/ripple">
                {zh ? '波纹' : 'Ripple'}
              </Link>
              {' · '}
              <Link className="text-wave/90 hover:underline" to="/fdtd">
                {zh ? '时域电磁双缝' : 'FDTD double slit'}
              </Link>
              {' · '}
              <Link className="text-wave/90 hover:underline" to="/laser">
                {zh ? '激光' : 'Laser'}
              </Link>
            </p>
          </div>
        </aside>

        {/* Stage */}
        <div className="min-w-0 order-1 lg:order-2">
          <div className="stage relative overflow-hidden border border-edge/80 bg-[#070b14] shadow-[0_0_40px_rgba(58,214,255,0.08)]">
            <svg
              ref={svgRef}
              aria-label="Optics scene"
              viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
              className="mx-auto block h-auto w-full touch-none select-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerDown={() => setSelectedId(null)}
            >
              <defs>
                <pattern id="lab-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path
                    d="M 20 0 L 0 0 0 20"
                    fill="none"
                    stroke="rgba(100,120,160,0.1)"
                    strokeWidth="1"
                  />
                </pattern>
                <radialGradient id="lab-glow" cx="50%" cy="40%" r="60%">
                  <stop offset="0%" stopColor="rgba(58,214,255,0.06)" />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>
              </defs>
              <rect width={SCENE_W} height={SCENE_H} fill="url(#lab-grid)" />
              <rect width={SCENE_W} height={SCENE_H} fill="url(#lab-glow)" />

              {/* Optical bench frame */}
              <rect
                x={12}
                y={12}
                width={SCENE_W - 24}
                height={SCENE_H - 24}
                fill="none"
                stroke="rgba(148,163,184,0.15)"
                strokeWidth={1}
                rx={4}
              />

              {waveField && waveMax > 0 && Array.from({ length: waveField.ny }, (_, j) => {
                const py = waveField.y0 + (j / waveField.ny) * (waveField.y1 - waveField.y0)
                const h = (waveField.y1 - waveField.y0) / waveField.ny
                return Array.from({ length: waveField.nx }, (_, i) => {
                  const v = waveField.values[j * waveField.nx + i] / waveMax
                  if (v < 0.04) return null
                  const px = waveField.x0 + (i / waveField.nx) * (waveField.x1 - waveField.x0)
                  const w = (waveField.x1 - waveField.x0) / waveField.nx
                  return (
                    <rect
                      key={`w-${i}-${j}`}
                      x={px}
                      y={py}
                      width={w + 0.4}
                      height={h + 0.4}
                      fill={`rgba(56,189,248,${Math.min(0.55, v * 0.7)})`}
                    />
                  )
                })
              })}

              {trace.segments.map((s, i) => {
                const [r, g, b] = wavelengthToRgb(s.wavelengthNm)
                const a = Math.min(0.95, 0.22 + s.intensity * 0.75)
                return (
                  <line
                    key={`ray-${i}`}
                    x1={s.x0}
                    y1={s.y0}
                    x2={s.x1}
                    y2={s.y1}
                    stroke={`rgba(${r},${g},${b},${a})`}
                    strokeWidth={1.4 + s.intensity * 1.8}
                    strokeLinecap="round"
                  />
                )
              })}

              {trace.hits
                .filter((h) => h.kind === 'screen')
                .map((h, i) => {
                  const [r, g, b] = wavelengthToRgb(h.wavelengthNm)
                  return (
                    <circle
                      key={`hit-${i}`}
                      cx={h.x}
                      cy={h.y}
                      r={2.5 + h.intensity * 5}
                      fill={`rgba(${r},${g},${b},0.9)`}
                    />
                  )
                })}

              {components.map((c) => (
                <ComponentGlyph
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onPointerDown={(e) => onPointerDownComp(e, c.id)}
                  onPointerDownRotate={(e) => onPointerDownRotate(e, c.id)}
                />
              ))}
            </svg>
          </div>

          {/* Readouts */}
          <div data-optics-readout className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-slate-400">
            <span>
              {zh ? '元件' : 'Parts'}{' '}
              <strong className="text-slate-200">{components.length}</strong>
            </span>
            <span>
              {zh ? '光线段' : 'Ray segs'}{' '}
              <strong className="text-slate-200">{hasResult ? trace.segments.length : '—'}</strong>
            </span>
            <span>
              {zh ? '事件' : 'Events'}{' '}
              <strong className="text-slate-200">{hasResult ? trace.events.length : '—'}</strong>
            </span>
            <span>
              {zh ? '光屏总功率' : 'Screen power'}{' '}
              <strong className="text-wave">{hasResult ? screenPow.toFixed(3) : '—'}</strong>
            </span>
            {waveField && (
              <span className="text-sky-300/90">
                {zh ? '惠更斯干涉已叠加到光屏' : 'Huygens interference on the screen'}
              </span>
            )}
            {fringe && (
              <span>
                Δy ≈ λD/d{' '}
                <strong className="text-slate-200">{fringe.spacingPx.toFixed(0)} px</strong>
              </span>
            )}
          </div>

          {/* Screen intensity profile */}
          {selectedProfile && (
            <div className="card mt-3 p-3">
              <div className="mb-1 text-center text-xs uppercase tracking-wider text-slate-400">
                {zh ? '光屏强度剖面' : 'Screen intensity profile'}
              </div>
              <ScreenProfileChart profile={selectedProfile} />
            </div>
          )}
        </div>

        {/* Inspector + events */}
        <aside className="order-2 flex max-h-[75vh] lg:order-3 flex-col gap-3 overflow-y-auto">
          <div className="card p-3">
            <h2 className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
              {zh ? '属性' : 'Properties'}
            </h2>
            {!selected ? (
              <p className="text-center text-sm text-slate-400">
                {zh ? '选中元件以编辑参数' : 'Select a part to edit'}
              </p>
            ) : (
              <Inspector
                selected={selected}
                screenPower={hasResult ? trace.screenPower[selected.id] ?? 0 : null}
                onChange={updateSelected}
                onDelete={removeSelected}
              />
            )}
          </div>

          <div className="card flex min-h-0 flex-1 flex-col p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {zh ? '物理事件' : 'Physics events'}
              </h2>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-wave"
                onClick={() => setShowEvents((s) => !s)}
              >
                {showEvents ? (zh ? '收起' : 'Hide') : zh ? '展开' : 'Show'}
              </button>
            </div>
            {showEvents && (
              <ul className="space-y-1.5 overflow-y-auto text-xs leading-snug">
                {recentEvents.length === 0 && (
                  <li className="text-slate-600">
                    {zh ? '尚无相互作用' : 'No interactions yet'}
                  </li>
                )}
                {recentEvents.map((ev, i) => (
                  <EventRow key={`${ev.componentId}-${i}`} ev={ev} />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <p className="note mb-4">{zh ? '拖动元件移动位置，拖动蓝点旋转；点击元件调整参数。物理事件可展开查看入射角、折射角和光功率。' : 'Drag a component to move it, or its blue handle to rotate it. Select a component to edit its parameters. Expand physical events to inspect angles and optical power.'}</p>
    </div>
  )
}

function Inspector({
  selected,
  screenPower,
  onChange,
  onDelete,
}: {
  selected: OpticsComponent
  screenPower: number | null
  onChange: (p: Partial<OpticsComponent>) => void
  onDelete: () => void
}) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pal = OPTICS_PALETTE.find((p) => p.kind === selected.kind)
  const title =
    selected.label ??
    (pal ? pickLocaleString(pal.label, pal.labelEn, locale) : selected.kind)
  return (
    <div className="space-y-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-100">
          {kindIcon(selected.kind)} {title}
        </span>
        <button
          type="button"
          className="btn border border-rose-500/40 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-500/10"
          onClick={onDelete}
        >
          {zh ? '删除' : 'Delete'}
        </button>
      </div>

      <Slider
        label={zh ? '旋转 (°)' : 'Rotation (°)'}
        min={0}
        max={359}
        value={((selected.rot % 360) + 360) % 360}
        onChange={(v) => onChange({ rot: v })}
        display={`${Math.round(((selected.rot % 360) + 360) % 360)}°`}
      />
      <Slider
        label={zh ? '孔径' : 'Aperture'}
        min={24}
        max={240}
        value={selected.length}
        onChange={(v) => onChange({ length: v })}
        display={`${Math.round(selected.length)}`}
      />

      {selected.kind === 'laser' && (
        <>
          <Slider
            label={zh ? '波长 (nm)' : 'Wavelength (nm)'}
            min={400}
            max={700}
            value={selected.wavelengthNm ?? 635}
            onChange={(v) => onChange({ wavelengthNm: v })}
            display={`${selected.wavelengthNm ?? 635}`}
          />
          <Slider
            label={zh ? '功率' : 'Power'}
            min={0.1}
            max={2}
            step={0.05}
            value={selected.power ?? 1}
            onChange={(v) => onChange({ power: v })}
            display={(selected.power ?? 1).toFixed(2)}
          />
        </>
      )}

      {selected.kind === 'lens' && (
        <Slider
          label={zh ? '焦距（负值为凹透镜）' : 'Focal length (negative = diverging)'}
          min={-360}
          max={360}
          value={selected.focalLength ?? 140}
          onChange={(v) => onChange({ focalLength: v === 0 ? 1 : v })}
          display={`${Math.round(selected.focalLength ?? 140)}${(selected.focalLength ?? 140) < 0 ? (zh ? ' 凹' : ' div.') : (zh ? ' 凸' : ' conv.')}`}
        />
      )}

      {selected.kind === 'interface' && (
        <Slider
          label={zh ? '折射率' : 'Index n'}
          min={1.05}
          max={2.4}
          step={0.01}
          value={selected.n ?? 1.5}
          onChange={(v) => onChange({ n: v })}
          display={(selected.n ?? 1.5).toFixed(2)}
        />
      )}

      {selected.kind === 'polarizer' && (
        <Slider
          label={zh ? '透振轴 (°)' : 'Polarizer axis (°)'}
          min={0}
          max={179}
          value={selected.polAngleDeg ?? selected.rot}
          onChange={(v) => onChange({ polAngleDeg: v })}
          display={`${Math.round(selected.polAngleDeg ?? selected.rot)}°`}
        />
      )}

      {selected.kind === 'splitter' && (
        <Slider
          label={zh ? '透射比' : 'Transmission'}
          min={0}
          max={1}
          step={0.05}
          value={selected.splitT ?? 0.5}
          onChange={(v) => onChange({ splitT: v })}
          display={`${Math.round((selected.splitT ?? 0.5) * 100)}%`}
        />
      )}

      {selected.kind === 'screen' && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-100/90">
          {zh ? '本屏功率' : 'Screen power'}{' '}
          <strong className="text-wave">{screenPower?.toFixed(3) ?? '—'}</strong>
        </p>
      )}
      {selected.slitPlate && !selected.zonePlate && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '狭缝板一段。缝隙是惠更斯源，光屏显示干涉条纹。' : 'One wall of a slit plate. Gaps are Huygens sources; the screen shows fringes.'}
        </p>
      )}
      {selected.lloydMirror && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '劳埃德镜：虚光源在镜面另一侧，反射带 π 相位。' : "Lloyd's mirror: virtual source across the glass; reflection adds π phase."}
        </p>
      )}
      {selected.edgeWave && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '直边/障碍：开口一侧的惠更斯源产生衍射。' : 'Knife-edge / obstacle: Huygens sources fill the open aperture.'}
        </p>
      )}
      {selected.biprism && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '菲涅耳双棱镜半块：折射形成两个虚光源。' : 'Fresnel biprism half: refraction makes two virtual sources.'}
        </p>
      )}
      {selected.machZehnder && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '马赫–曾德合束镜：两臂各取一个虚源，在两路输出屏上叠加成条纹。' : 'Mach–Zehnder combiner: one virtual source per arm interferes on both output screens.'}
        </p>
      )}
      {selected.newtonRings && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '楔形膜板面：膜中线上一串等厚相位源，接触端为暗纹。' : 'Wedge plate: phased sources along the film midline; the contact edge is dark.'}
        </p>
      )}
      {selected.fabryPerot && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '法布里–珀罗腔镜：多次反射等效为腔后一串衰减虚源。' : 'Fabry–Pérot plate: round trips act as a decaying train of virtual sources.'}
        </p>
      )}
      {selected.michelsonWave && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '迈克尔逊波动模型：每臂回程光等效为分束镜旁一个虚源，相位含 2×臂长，移动端镜条纹移动。' : 'Wave-model Michelson: each returning arm acts as one virtual source phased by 2× arm length; sliding an end mirror shifts the fringes.'}
        </p>
      )}
      {selected.zonePlate && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs text-sky-100/90">
          {zh ? '菲涅耳波带片挡环：开放偶数半波带，惠更斯子波在焦点同相叠加成亮斑。' : 'Fresnel zone-plate ring: even half-wave zones stay open, so wavelets add in phase at the focus.'}
        </p>
      )}

      <p className="text-xs text-slate-600">
        {zh ? '位置' : 'Pos'} ({Math.round(selected.x)}, {Math.round(selected.y)})
      </p>
    </div>
  )
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  display,
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  display: string
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-slate-300">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </label>
  )
}

const EVENT_TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  refract: { zh: '折射', en: 'Refract' },
  tir: { zh: '全反射', en: 'TIR' },
  reflect: { zh: '反射', en: 'Reflect' },
  polarize: { zh: '偏振', en: 'Polarize' },
  split: { zh: '分束', en: 'Split' },
  lens: { zh: '透镜', en: 'Lens' },
  absorb: { zh: '吸收', en: 'Absorb' },
  screen: { zh: '光屏', en: 'Screen' },
  block: { zh: '遮挡', en: 'Block' },
}

function EventRow({ ev }: { ev: OpticsEvent }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const typeLab = EVENT_TYPE_LABEL[ev.type]
  const color =
    ev.type === 'refract' || ev.type === 'tir'
      ? 'text-cyan-300/90'
      : ev.type === 'reflect'
        ? 'text-sky-300/90'
        : ev.type === 'polarize'
          ? 'text-violet-300/90'
          : ev.type === 'split'
            ? 'text-emerald-300/90'
            : ev.type === 'lens'
              ? 'text-indigo-300/90'
              : 'text-slate-400'
  return (
    <li className={`rounded border border-edge/40 bg-canvas/40 px-2 py-1 ${color}`}>
      <span className="text-[9px] opacity-70">
        {typeLab ? (zh ? typeLab.zh : typeLab.en) : ev.type}
      </span>
      <span className="mt-0.5 block text-slate-300">{ev.note ?? '—'}</span>
    </li>
  )
}

function ScreenProfileChart({
  profile,
}: {
  profile: { bins: Float64Array; total: number; peakS: number }
}) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const max = Math.max(...profile.bins, 1e-9)
  const w = 320
  const h = 56
  const n = profile.bins.length
  const pts = Array.from(profile.bins)
    .map((v, i) => {
      const x = (i / (n - 1)) * w
      const y = h - 4 - (v / max) * (h - 10)
      return `${x},${y}`
    })
    .join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mx-auto block h-14 w-full max-w-md">
        <polyline
          fill="none"
          stroke="#3ad6ff"
          strokeWidth={1.5}
          points={pts}
        />
        <line
          x1={profile.peakS * w}
          y1={0}
          x2={profile.peakS * w}
          y2={h}
          stroke="rgba(251,191,36,0.5)"
          strokeDasharray="3 2"
        />
      </svg>
      <p className="text-center text-xs text-slate-400">
        {zh ? '峰值位置' : 'Peak at'} {profile.peakS.toFixed(2)} ·{' '}
        {zh ? '总功率' : 'power'} {profile.total.toFixed(3)}
      </p>
    </div>
  )
}

function ComponentGlyph({
  c,
  selected,
  onPointerDown,
  onPointerDownRotate,
}: {
  c: OpticsComponent
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPointerDownRotate: (e: React.PointerEvent) => void
}) {
  const half = c.length / 2
  const stroke = selected ? '#3ad6ff' : '#94a3b8'
  const sw = selected ? 2.8 : 2
  let body: ReactNode = <line x1={0} y1={-half} x2={0} y2={half} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
  let accent: ReactNode = null
  if (c.kind === 'laser') {
    const [r, g, b] = wavelengthToRgb(c.wavelengthNm ?? 635)
    accent = <>
      <circle r={9} fill={`rgb(${r},${g},${b})`} opacity={0.92} />
      <line x1={0} y1={0} x2={24} y2={0} stroke={`rgb(${r},${g},${b})`} strokeWidth={3.5} strokeLinecap="round" />
    </>
    body = null
  } else if (c.kind === 'mirror') {
    accent = <>{[-0.35, 0, 0.35].map((k, i) =>
      <line key={i} x1={0} y1={half * k} x2={9} y2={half * k} stroke={stroke} strokeWidth={1.4} />,
    )}</>
  } else if (c.kind === 'lens') {
    accent = <ellipse rx={7} ry={half} fill="none" stroke={stroke} strokeWidth={sw} />
    body = null
  } else if (c.kind === 'interface') {
    accent = <text x={16} y={0} transform={`rotate(${-c.rot} 16 0)`} fill="#64748b" fontSize={11} textAnchor="middle">
      n={(c.n ?? 1.5).toFixed(2)}
    </text>
  } else if (c.kind === 'polarizer') {
    accent = <line x1={-14} y1={0} x2={14} y2={0} transform={`rotate(${(c.polAngleDeg ?? c.rot) - c.rot})`} stroke="#a78bfa" strokeWidth={2} />
  } else if (c.kind === 'splitter') {
    accent = <circle r={5} fill="none" stroke="#34d399" strokeWidth={1.5} />
  } else if (c.kind === 'screen') {
    body = <line x1={0} y1={-half} x2={0} y2={half} stroke="#fbbf24" strokeWidth={sw + 1.2} strokeLinecap="round" />
  } else if (c.kind === 'blocker') {
    body = <line x1={0} y1={-half} x2={0} y2={half} stroke="#64748b" strokeWidth={sw + 2.5} strokeLinecap="square" />
  }

  return (
    <g transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`} style={{ cursor: 'grab' }} onPointerDown={onPointerDown}>
      <line x1={0} y1={-half} x2={0} y2={half} stroke="transparent" strokeWidth={20} strokeLinecap="round" />
      {body}
      {accent}
      {selected && <>
        <circle r={5} fill="none" stroke="#3ad6ff" strokeWidth={1.5} />
        <line x1={0} y1={0} x2={half + 18} y2={0} stroke="rgba(58,214,255,0.45)" strokeWidth={1} strokeDasharray="3 2" />
        <circle cx={half + 18} cy={0} r={7} fill="#0b1220" stroke="#3ad6ff" strokeWidth={2}
          style={{ cursor: 'grab' }} onPointerDown={onPointerDownRotate} />
      </>}
      <title>{c.label ?? c.kind}</title>
    </g>
  )
}
