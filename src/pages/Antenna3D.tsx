import { WasmAntenna } from '../lib/sim/wasm-fields'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { antenna3DResult, ANTENNA_POLAR_SEGMENTS } from '../lib/sim/antenna'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const SEG_U = 64 // 方位向分段
const SEG_V = ANTENNA_POLAR_SEGMENTS // 俯仰向分段
const DIR_SCALE = 6 // 方向图半径缩放

export function Antenna3D() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pageTerms = useMemo(() => termIdsForSimPath('antenna3d'), [])

  const mountRef = useRef<HTMLDivElement>(null)

  const [freq, setFreq] = useState(2.4e9)
  const [pt, setPt] = useState(20)
  const [dist, setDist] = useState(8)
  const [elev, setElev] = useState(90)
  const [pol, setPol] = useState(0)

  const params = useMemo(() => ({ frequencyHz: freq, ptDbm: pt, distM: dist, elevationDeg: elev, polarizationDeg: pol }), [freq, pt, dist, elev, pol])
  const compute = useModuleCompute({ module: 'antenna3d', params })
  const kernelRef = useRef<WasmAntenna | null>(null)
  const { runningRef } = useRunning()
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'antenna3d' ? compute.result.result : null, error: '' }
    try {
      kernelRef.current ??= new WasmAntenna('antenna3d')
      return { data: antenna3DResult(params, kernelRef.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [params, compute.snapshot, compute.result])
  const data = preview.data
  const renderRef = useRef({ params, data, snapshot: compute.snapshot })
  renderRef.current = { params, data, snapshot: compute.snapshot }

  useEffect(() => {
    const mount = mountRef.current!
    const W = mount.clientWidth, H = 460
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000)
    camera.position.set(14, 9, 16)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(W, H)
    mount.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dl = new THREE.DirectionalLight(0xffffff, 0.8)
    dl.position.set(10, 18, 12); scene.add(dl)

    // 竖直偶极子杆（沿 y 轴）
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 5, 16),
      new THREE.MeshStandardMaterial({ color: 0xff8a4c, emissive: 0x301400 }),
    )
    scene.add(rod)
    const feed = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd9b0 }),
    )
    scene.add(feed)

    // 3D 辐射方向图（环面/甜甜圈）——球面网格按 dipoleFieldPattern(θ) 位移
    // 约定：天线沿 y 轴 → θ 为与 y 轴夹角（θ=π/2 在 xz 赤道最强）
    const patGeo = new THREE.SphereGeometry(1, SEG_U, SEG_V)
    const posAttr = patGeo.attributes.position as THREE.BufferAttribute
    const baseDir: THREE.Vector3[] = []
    const colors = new Float32Array(posAttr.count * 3)
    for (let i = 0; i < posAttr.count; i++) {
      baseDir.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).normalize())
    }
    patGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const buildPattern = (pattern: number[]) => {
      for (let i = 0; i < posAttr.count; i++) {
        const d = baseDir[i]
        const f = pattern[Math.floor(i / (SEG_U + 1))]
        const r = f * DIR_SCALE + 0.001
        posAttr.setXYZ(i, d.x * r, d.y * r, d.z * r)
        // 颜色按强度：弱→蓝青、强→紫橙
        const t = f
        colors[i * 3] = 0.25 + 0.65 * t       // R
        colors[i * 3 + 1] = 0.35 + 0.25 * t   // G
        colors[i * 3 + 2] = 0.95 - 0.55 * t   // B
      }
      posAttr.needsUpdate = true
      ;(patGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true
      patGeo.computeVertexNormals()
    }
    const patMesh = new THREE.Mesh(
      patGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide, metalness: 0.1, roughness: 0.7,
        emissive: 0x120c2a, emissiveIntensity: 0.4,
      }),
    )
    scene.add(patMesh)
    const patWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(patGeo),
      new THREE.LineBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.12 }),
    )
    scene.add(patWire)

    // 向外扩散的半透明球面波前（多个，alpha 渐隐循环）
    const WAVES = 4
    const wave: THREE.Mesh[] = []
    for (let i = 0; i < WAVES; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 40, 24),
        new THREE.MeshBasicMaterial({
          color: 0x3ad6ff, transparent: true, opacity: 0.0,
          wireframe: true,
        }),
      )
      scene.add(m); wave.push(m)
    }

    // 接收天线标记（位置由 距离/俯仰角 控制）
    const rxGroup = new THREE.Group()
    const rxRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x3ad6ff, emissive: 0x06222e }),
    )
    rxGroup.add(rxRod)
    const rxBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x3ad6ff, emissive: 0x0a3a4a }),
    )
    rxGroup.add(rxBall)
    scene.add(rxGroup)
    // 收发连线
    const linkGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(),
    ])
    const link = new THREE.Line(linkGeo, new THREE.LineDashedMaterial({
      color: 0x9aa4bf, dashSize: 0.4, gapSize: 0.3,
    }))
    scene.add(link)

    const placeRx = () => {
      const thetaRad = (renderRef.current.params.elevationDeg * Math.PI) / 180 // 与 y 轴夹角
      const rScene = THREE.MathUtils.clamp(renderRef.current.params.distM, 1, 18)
      // 方位固定在 +x 平面（φ=0）：x=r·sinθ, y=r·cosθ
      const x = rScene * Math.sin(thetaRad)
      const y = rScene * Math.cos(thetaRad)
      rxGroup.position.set(x, y, 0)
      const lp = linkGeo.attributes.position.array as Float32Array
      lp[0] = 0; lp[1] = 0; lp[2] = 0
      lp[3] = x; lp[4] = y; lp[5] = 0
      linkGeo.attributes.position.needsUpdate = true
      link.computeLineDistances()
    }
    placeRx()

    let lastData: ReturnType<typeof antenna3DResult> | null = null
    let t = 0, disposed = false, last = 0
    const animate = (now: number) => {
      if (disposed) return
      const dt = last ? (now - last) / 1000 : 0; last = now
      if (!renderRef.current.snapshot && runningRef.current) t += dt
      const current = renderRef.current.data
      patMesh.visible = patWire.visible = rxGroup.visible = link.visible = !!current
      for (const m of wave) m.visible = !!current
      if (current !== lastData) {
        lastData = current
        if (current) {
          buildPattern(current.pattern)
          patWire.geometry.dispose()
          patWire.geometry = new THREE.WireframeGeometry(patGeo)
          placeRx()
        }
      }
      // 波前扩散
      for (let i = 0; i < WAVES; i++) {
        const phase = (t * 0.6 + i / WAVES) % 1 // 0..1
        const r = phase * (DIR_SCALE + 6)
        wave[i].scale.setScalar(Math.max(r, 0.001))
        ;(wave[i].material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - phase)
      }
      controls.update(); renderer.render(scene, camera)
    }
    const stopLoop = startLoop(animate)

    const onResize = () => {
      const w = mount.clientWidth
      camera.aspect = w / H; camera.updateProjectionMatrix(); renderer.setSize(w, H)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true; stopLoop()
      window.removeEventListener('resize', onResize)
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
        title="天线收发 · 3D"
        subtitle="原点处一根竖直半波偶极子向外辐射：紫色「甜甜圈」是它的三维方向图（赤道最强、沿轴为零），青色球面波前不断向外扩散。拖动滑块移动接收天线，实时读出链路预算下的接收功率。"
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


      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}
      <div className="toolbar mb-5">
        <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-0.5 text-xs text-fuchsia-300">
          {zh ? '三维交互渲染' : 'Interactive 3D'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '频率' : 'Freq'} {(freq / 1e9).toFixed(2)} GHz
          <input type="range" min={0.3e9} max={6e9} step={0.1e9} value={freq}
            onChange={(e) => { const v = Number(e.target.value); setFreq(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '发射功率' : 'Pt'} {pt} dBm
          <input type="range" min={-10} max={40} step={1} value={pt}
            onChange={(e) => { const v = Number(e.target.value); setPt(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '距离' : 'Range'} {dist} m
          <input type="range" min={1} max={18} step={0.5} value={dist}
            onChange={(e) => { const v = Number(e.target.value); setDist(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '俯仰' : 'Elevation'} {elev}°
          <input type="range" min={5} max={175} step={1} value={elev}
            onChange={(e) => { const v = Number(e.target.value); setElev(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '极化失配' : 'Pol. mismatch'} {pol}°
          <input type="range" min={0} max={90} step={1} value={pol}
            onChange={(e) => { const v = Number(e.target.value); setPol(v) }} />
        </label>
      </div>

      <div data-antenna-readout className="mb-4 flex flex-wrap justify-center gap-3 text-sm">
        <span className="rounded-md border border-edge px-3 py-1 text-slate-300">
          {zh ? '接收功率' : 'Pr'}{' '}
          <b style={{ color: '#3ad6ff' }}>{data ? data.prDbm === null ? '−∞' : data.prDbm.toFixed(1) : '—'} dBm</b>
        </span>
        <span className="rounded-md border border-edge px-3 py-1 text-slate-300">
          {zh ? '自由空间路径损耗' : 'FSPL'}{' '}
          <b style={{ color: '#ff8a4c' }}>{data?.fsplDb.toFixed(1) ?? '—'} dB</b>
        </span>
        <span className="rounded-md border border-edge px-3 py-1 text-slate-300">
          {zh ? '极化损耗因子' : 'PLF'}{' '}
          <b style={{ color: '#7c5cff' }}>{data?.plf.toFixed(3) ?? '—'}</b>
        </span>
      </div>

      <div ref={mountRef} role="img" aria-label={zh ? '天线收发三维模拟画布' : 'Antenna TX/RX 3D canvas'}
        className="stage mx-auto w-full max-w-3xl overflow-hidden" style={{ height: 460 }} />

      <p className="note">
        {zh
          ? '方向图来自已测试验证的偶极子场方向函数：俯仰 90°（垂直天线轴）最强、沿轴为零，因此呈环面而非球面。接收功率按弗里斯传输公式计算，自由空间路径损耗随距离/频率每 ×10 增加 20 dB，并叠加方向性加权与极化失配损耗；正交极化或轴向零点显示 −∞ dBm（理想接收功率为零）。球面波前仅作示意，不用于求解。'
          : 'The pattern uses a tested dipole field function: strongest at θ=90° (broadside), null on axis—a torus, not a sphere. Received power follows Friis; FSPL grows +20 dB per decade of range or frequency, with pattern weighting and polarization mismatch. Orthogonal polarization or axial nulls give −∞ dBm (ideal zero power). Expanding wavefronts are illustrative only.'}
      </p>
    </div>
  )
}
