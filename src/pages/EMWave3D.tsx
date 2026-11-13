import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { createEmWave3D, EM_WAVE3D_SAMPLES as SAMPLES, EM_WAVE3D_RANGE as RANGE } from '../lib/sim/spectrum-runnable-algos'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { useLocale } from '../lib/i18n'

export function EMWave3D() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pageTerms = useMemo(() => termIdsForSimPath('emwave3d'), [])

  const mountRef = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0.7)
  const [amp, setAmp] = useState(2.2)
  const { running, runningRef, toggle, setRunning } = useRunning()
  const [time, setTime] = useState(0)
  const timeRef = useRef(time)
  const params = useMemo(() => ({ waveNumber: k, amplitude: amp, time }), [k, amp, time])
  const compute = useModuleCompute({ module: 'emwave3d', params }, () => ({ module: 'emwave3d', params: { ...params, time: timeRef.current } }))
  const remote = compute.result?.module === 'emwave3d' ? compute.result.fields : null
  const [frameError, setFrameError] = useState('')
  const renderRef = useRef({ params, snapshot: compute.snapshot, remote, frameError })
  renderRef.current = { params, snapshot: compute.snapshot, remote, frameError }
  useEffect(() => {
    setFrameError('')
    if (compute.snapshot) setRunning(false)
  }, [compute.snapshot, params])

  useEffect(() => {
    const mount = mountRef.current!
    const W = mount.clientWidth, H = 460
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000)
    camera.position.set(18, 10, 20)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(W, H)
    mount.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.6

    // 传播轴
    const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -RANGE), new THREE.Vector3(0, 0, RANGE)])
    scene.add(new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: 0x3a4663 })))
    // 箭头表示传播方向
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 16), new THREE.MeshBasicMaterial({ color: 0x64748b }))
    cone.position.set(0, 0, RANGE); cone.rotation.x = Math.PI / 2; scene.add(cone)

    const mkCurve = (color: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SAMPLES * 3), 3))
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, linewidth: 2 }))
      scene.add(line); return g
    }
    const mkVectors = (color: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SAMPLES * 2 * 3), 3))
      const seg = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }))
      scene.add(seg); return g
    }
    const eCurve = mkCurve(0xff5a5a), bCurve = mkCurve(0x5ab0ff)   // E 红（y 方向），B 蓝（x 方向）
    const eVec = mkVectors(0xff5a5a), bVec = mkVectors(0x5ab0ff)

    type Fields = { z: ArrayLike<number>; ey: ArrayLike<number>; cbx: ArrayLike<number> }
    const update = (fields: Fields) => {
      const ep = eCurve.attributes.position.array as Float32Array
      const bp = bCurve.attributes.position.array as Float32Array
      const ev = eVec.attributes.position.array as Float32Array
      const bv = bVec.attributes.position.array as Float32Array
      for (let i = 0; i < SAMPLES; i++) {
        const z = fields.z[i], ey = fields.ey[i], bx = fields.cbx[i]
        ep[i * 3] = 0; ep[i * 3 + 1] = ey; ep[i * 3 + 2] = z
        bp[i * 3] = bx; bp[i * 3 + 1] = 0; bp[i * 3 + 2] = z
        ev[i * 6] = 0; ev[i * 6 + 1] = 0; ev[i * 6 + 2] = z
        ev[i * 6 + 3] = 0; ev[i * 6 + 4] = ey; ev[i * 6 + 5] = z
        bv[i * 6] = 0; bv[i * 6 + 1] = 0; bv[i * 6 + 2] = z
        bv[i * 6 + 3] = bx; bv[i * 6 + 4] = 0; bv[i * 6 + 5] = z
      }
      ;[eCurve, bCurve, eVec, bVec].forEach((g) => (g.attributes.position.needsUpdate = true))
    }

    let disposed = false, last = 0, lastKey = ''
    let fields: Fields | null = null
    let kernel: ReturnType<typeof createEmWave3D> | null = null
    const animate = (now: number) => {
      if (disposed) return
      const dt = last ? (now - last) / 1000 : 0; last = now
      const current = renderRef.current
      let next: Fields | null = current.remote
      let changed = false
      if (!current.snapshot && !current.frameError) {
        if (runningRef.current) timeRef.current = Math.min(1e6, timeRef.current + dt * 2.5)
        const key = `${current.params.waveNumber}|${current.params.amplitude}|${timeRef.current}`
        if (key !== lastKey || !fields) {
          try {
            if (!kernel) kernel = createEmWave3D(current.params)
            kernel.parameters.set([current.params.waveNumber, current.params.amplitude, timeRef.current])
            kernel.read()
            next = { z: kernel.positions, ey: kernel.first, cbx: kernel.second }
            changed = true
            lastKey = key
          } catch (error) { setFrameError(String(error)); setRunning(false) }
        } else next = fields
      } else lastKey = ''
      if (changed || next !== fields) {
        fields = next
        for (const g of [eCurve, bCurve, eVec, bVec]) g.setDrawRange(0, fields ? g.attributes.position.count : 0)
        if (fields) update(fields)
      }
      controls.autoRotate = !current.snapshot
      controls.update(); renderer.render(scene, camera)
    }
    const stopLoop = startLoop(animate)

    const onResize = () => {
      const w = mount.clientWidth
      camera.aspect = w / H; camera.updateProjectionMatrix(); renderer.setSize(w, H)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true; stopLoop(); window.removeEventListener('resize', onResize)
      controls.dispose()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const m = mesh.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.())
        else if (m && 'dispose' in m) (m as THREE.Material).dispose()
      })
      renderer.dispose()
      if ('forceContextLoss' in renderer && typeof renderer.forceContextLoss === 'function') {
        renderer.forceContextLoss()
      }
      if (renderer.domElement.parentNode) mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div>
      <PageHeader
        icon="📡"
        title="电磁波 · 3D"
        subtitle="归一化平面波：电场 Ey（红）与 cBx（蓝）相互垂直，能流沿 +z。采用 c=1 的约化单位，拖动可旋转视角。"
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
      {frameError && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {frameError}</p>}
      <div className="toolbar mb-5">
        <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-0.5 text-xs text-fuchsia-300">
          {zh ? '三维交互渲染' : 'Interactive 3D render'}
        </span>
        <button disabled={compute.snapshot || !!frameError} onClick={toggle}
          className="btn border border-edge text-slate-300">
          {running ? (zh ? '⏸ 暂停' : '⏸ Pause') : zh ? '▶ 继续' : '▶ Resume'}
        </button>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '波数' : 'Wave number'} {k.toFixed(2)}
          <input type="range" min={0.3} max={1.6} step={0.05} value={k}
            onChange={(e) => { const v = Number(e.target.value); setK(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '振幅' : 'Amplitude'} {amp.toFixed(1)}
          <input type="range" min={0.5} max={4} step={0.1} value={amp}
            onChange={(e) => { const v = Number(e.target.value); setAmp(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '快照时刻（约化单位）' : 'Snapshot time (reduced units)'}
          <input aria-label="EM snapshot time" type="number" min={0} max={1e6} step={0.1} value={time}
            onChange={(e) => { const v = Math.max(0, Math.min(1e6, Number(e.target.value))); setTime(v); timeRef.current = v }} />
        </label>
        <span className="text-xs text-slate-600">
          {zh ? '拖动旋转 · 滚轮缩放' : 'Drag to orbit · wheel to zoom'}
        </span>
      </div>

      <div ref={mountRef} role="img" aria-label={zh ? '电磁波三维模拟画布' : 'EM wave 3D canvas'}
        className="stage mx-auto w-full max-w-3xl overflow-hidden" style={{ height: 460 }} />

      {compute.submittedInput?.module === 'emwave3d' && <p data-emwave3d-readout className="note font-mono">
        t = {compute.submittedInput.params.time}; λ = {remote?.wavelength}
      </p>}

      <p className="note">
        {zh
          ? '采用 Ey=A·sin(k(z−t))、cBx=−Ey，因此 E×H 指向 +z。图中磁场乘以 c 显示，不代表 E 与 B 的 SI 数值相等。改变波数保持约化波速 c=1；开始计算会捕获当前显示时刻，返回静态场快照。'
          : 'Ey=A·sin(k(z−t)), cBx=−Ey, so E×H points +z. B is displayed multiplied by c; E and B do not have equal SI values. Reduced wave speed stays c=1 as k changes. Compute and save captures the displayed time for a static field snapshot.'}
      </p>
    </div>
  )
}
