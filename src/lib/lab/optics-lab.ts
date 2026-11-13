import { WasmOptics, WasmOpticsMath } from '../sim/wasm-fields'

/**
 * Optics Lab · flagship 2D ray-optics engine (pure, no DOM).
 * Laws: reflection, Snell (+TIR), thin lens, Malus polarizer, 50/50 splitter.
 * Intensities use real Fresnel physics in the trace kernel: dielectric
 * surfaces apply angle-resolved R_s/R_p (polarized rays weight by the
 * E-field dial angle about the beam axis; unpolarized use (R_s+R_p)/2),
 * TIR reflects at R=1, mirrors carry a protected-silver coating R≈0.94,
 * and splitter legs conserve incident power minus a small coating loss.
 * Emits interaction events + screen intensity profiles for the lab UI.
 */

export type OpticsKind =
  | 'laser'
  | 'mirror'
  | 'lens'
  | 'interface'
  | 'screen'
  | 'blocker'
  | 'polarizer'
  | 'splitter'

export interface OpticsComponent {
  id: string
  kind: OpticsKind
  x: number
  y: number
  /** Degrees; laser emit dir / surface normal / polarizer transmission axis. */
  rot: number
  length: number
  power?: number
  wavelengthNm?: number
  focalLength?: number
  /** Absolute n of the dielectric: interface medium, lens glass, polarizer sheet (air n=1 outside). */
  n?: number
  /** Polarizer transmission axis absolute angle (deg); default = rot. */
  polAngleDeg?: number
  /** Splitter transmission fraction [0,1]; default 0.5. */
  splitT?: number
  /** Blocker is one wall of a slit plate; gaps between such walls are Huygens sources. */
  slitPlate?: boolean
  /** Mirror used as Lloyd's mirror: UI Huygens uses the real source + virtual image. */
  lloydMirror?: boolean
  /** Blocker edge/obstacle: UI Huygens samples the open aperture beside it. */
  edgeWave?: boolean
  /** Interface half of a Fresnel biprism; UI Huygens uses two virtual sources. */
  biprism?: boolean
  /** Splitter that recombines a Mach–Zehnder pair; UI Huygens uses one virtual source per arm. */
  machZehnder?: boolean
  /** Interface plate of an air wedge; UI Huygens samples the midline with equal-thickness phase. */
  newtonRings?: boolean
  /** Splitter of a Fabry–Pérot cavity pair; UI Huygens uses a decaying virtual-source train. */
  fabryPerot?: boolean
  /** Splitter of a wave-model Michelson; UI Huygens uses one phased virtual source per arm. */
  michelsonWave?: boolean
  /** Blocker wall of a Fresnel zone plate; open even half-wave zones focus the Huygens sources. */
  zonePlate?: boolean
  label?: string
}

export interface OpticsRay {
  x: number
  y: number
  dx: number
  dy: number
  intensity: number
  wavelengthNm: number
  bounces: number
  /** Linear polarization angle (deg), undefined = unpolarized. */
  polDeg?: number
}

export interface RayHit {
  x: number
  y: number
  componentId: string
  kind: OpticsKind
  intensity: number
  wavelengthNm: number
  /** Position along screen segment [0,1]. */
  s?: number
}

export interface RaySegment {
  x0: number
  y0: number
  x1: number
  y1: number
  intensity: number
  wavelengthNm: number
}

/** Logged interaction for measurement panel / pedagogy. */
export interface OpticsEvent {
  type: 'reflect' | 'refract' | 'tir' | 'lens' | 'polarize' | 'split' | 'screen' | 'block'
  componentId: string
  componentKind: OpticsKind
  x: number
  y: number
  intensityIn: number
  intensityOut?: number
  thetaIDeg?: number
  thetaTDeg?: number
  note?: string
}

export interface ScreenProfile {
  componentId: string
  /** Binned power along aperture, length = bins. */
  bins: Float64Array
  total: number
  peakBin: number
  peakS: number
}

export interface TraceResult {
  segments: RaySegment[]
  hits: RayHit[]
  screenPower: Record<string, number>
  events: OpticsEvent[]
  profiles: ScreenProfile[]
}

export const SCENE_W = 960
export const SCENE_H = 560
export const MAX_BOUNCES = 28
export const MAX_RAYS_PER_LASER = 9
export const SCREEN_BINS = 48

let _idSeq = 0
export function newOpticsId(prefix = 'opt'): string {
  _idSeq += 1
  return `${prefix}-${_idSeq}-${Math.random().toString(36).slice(2, 7)}`
}

export function resetOpticsIdSeq(n = 0) {
  _idSeq = n
}

// ── math ────────────────────────────────────────────────────

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}

export function rad2deg(r: number): number {
  return (r * 180) / Math.PI
}

export function unitFromRot(rotDeg: number): { dx: number; dy: number } {
  return new WasmOpticsMath().unit(rotDeg)
}
export function tangentFromRot(rotDeg: number): { tx: number; ty: number } {
  const n = unitFromRot(rotDeg)
  return { tx: -n.dy, ty: n.dx }
}
export function normalize(dx: number, dy: number): { dx: number; dy: number } {
  return new WasmOpticsMath().normalize(dx, dy)
}
export function reflect(dx: number, dy: number, nx: number, ny: number): { dx: number; dy: number } {
  return new WasmOpticsMath().reflect(dx, dy, nx, ny)
}
export function refract(dx: number, dy: number, nx: number, ny: number, n1: number, n2: number): { dx: number; dy: number } | null {
  return new WasmOpticsMath().refract(dx, dy, nx, ny, n1, n2)
}
export function incidenceAngleDeg(dx: number, dy: number, nx: number, ny: number): number {
  return new WasmOpticsMath().incidence(dx, dy, nx, ny)
}
export function malusFactor(polDeg: number | undefined, axisDeg: number): number {
  return new WasmOpticsMath().malus(polDeg, axisDeg)
}

/**
 * Fresnel power coefficients at a dielectric boundary — the same formulas the
 * trace kernel applies per surface. `r` is the unpolarized teaching
 * reflectance (rs+rp)/2; `t = 1 − r` is the transmitted share carried by the
 * traced refracted leg (the specular leg is reported, not drawn).
 * Display/analysis mirror of kernel physics; the kernel owns traced power.
 */
export function fresnelCoefficients(
  n1: number,
  n2: number,
  thetaIDeg: number,
  thetaTDeg: number,
): { rs: number; rp: number; r: number; t: number } {
  const ci = Math.cos(deg2rad(thetaIDeg))
  const ct = Math.cos(deg2rad(thetaTDeg))
  const rs = ((n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)) ** 2
  const rp = ((n1 * ct - n2 * ci) / (n1 * ct + n2 * ci)) ** 2
  const r = (rs + rp) / 2
  return { rs, rp, r, t: 1 - r }
}

export function wavelengthToRgb(nm: number): [number, number, number] {
  const w = Math.max(380, Math.min(780, nm))
  let r = 0
  let g = 0
  let b = 0
  if (w < 440) {
    r = -(w - 440) / (440 - 380)
    b = 1
  } else if (w < 490) {
    g = (w - 440) / (490 - 440)
    b = 1
  } else if (w < 510) {
    g = 1
    b = -(w - 510) / (510 - 490)
  } else if (w < 580) {
    r = (w - 510) / (580 - 510)
    g = 1
  } else if (w < 645) {
    r = 1
    g = -(w - 645) / (645 - 580)
  } else {
    r = 1
  }
  let factor = 1
  if (w < 420) factor = 0.3 + (0.7 * (w - 380)) / (420 - 380)
  else if (w > 700) factor = 0.3 + (0.7 * (780 - w)) / (780 - 700)
  const gamma = (c: number) => Math.round(255 * Math.pow(Math.max(0, c * factor), 0.8))
  return [gamma(r), gamma(g), gamma(b)]
}

// ── geometry ────────────────────────────────────────────────

export interface SegmentGeom {
  x0: number
  y0: number
  x1: number
  y1: number
  nx: number
  ny: number
}

export function componentSegment(c: OpticsComponent): SegmentGeom {
  return new WasmOpticsMath().segment(c)
}
export function raySegmentHit(ox: number, oy: number, dx: number, dy: number, seg: SegmentGeom, eps = 1e-4): { t: number; s: number; x: number; y: number } | null {
  return new WasmOpticsMath().intersection(ox, oy, dx, dy, seg, eps)
}

// ── factories ───────────────────────────────────────────────

export function defaultComponent(kind: OpticsKind, x: number, y: number): OpticsComponent {
  const base = { id: newOpticsId(kind), kind, x, y, rot: 0, length: 80 }
  switch (kind) {
    case 'laser':
      return { ...base, rot: 0, length: 40, power: 1, wavelengthNm: 635, label: '激光' }
    case 'mirror':
      return { ...base, rot: 180, length: 110, label: '平面镜' }
    case 'lens':
      return { ...base, rot: 0, length: 120, focalLength: 140, label: '薄透镜' }
    case 'interface':
      return { ...base, rot: 0, length: 160, n: 1.5, label: '折射面' }
    case 'screen':
      return { ...base, rot: 180, length: 140, label: '光屏' }
    case 'blocker':
      return { ...base, rot: 180, length: 100, label: '挡板' }
    case 'polarizer':
      return { ...base, rot: 0, length: 100, polAngleDeg: 0, label: '偏振片' }
    case 'splitter':
      return { ...base, rot: 135, length: 90, splitT: 0.5, label: '分束器' }
  }
}

export type OpticsPresetId =
  | 'empty'
  | 'mirror-bounce'
  | 'lens-focus'
  | 'refraction'
  | 'periscope'
  | 'double-mirror'
  | 'malus'
  | 'beamsplit'
  | 'lab-bench'
  | 'tir'
  | 'fiber'
  | 'retroreflector'
  | 'optical-lever'
  | 'kepler'
  | 'galileo'
  | 'microscope'
  | 'crossed-polars'
  | 'michelson'
  | 'young-double-slit'
  | 'young-one-blocked'
  | 'young-two-color'
  | 'single-slit'
  | 'triple-slit'
  | 'diffraction-grating'
  | 'lloyd-mirror'
  | 'fresnel-biprism'
  | 'knife-edge'
  | 'poisson-spot'
  | 'mach-zehnder'
  | 'newton-rings'
  | 'fabry-perot'
  | 'michelson-wave'
  | 'zone-plate'

function place(kind: OpticsKind, x: number, y: number, patch: Partial<OpticsComponent> = {}): OpticsComponent {
  return { ...defaultComponent(kind, x, y), ...patch }
}

export function opticsPreset(id: OpticsPresetId): OpticsComponent[] {
  resetOpticsIdSeq(0)
  switch (id) {
    case 'empty':
      return [defaultComponent('laser', 80, SCENE_H / 2)]
    case 'mirror-bounce': {
      const L = defaultComponent('laser', 80, 280)
      L.wavelengthNm = 532
      const M = defaultComponent('mirror', 560, 280)
      M.rot = 135
      const S = defaultComponent('screen', 560, 460)
      S.rot = 270
      return [L, M, S]
    }
    case 'lens-focus': {
      const L = defaultComponent('laser', 70, SCENE_H / 2)
      L.wavelengthNm = 450
      const lens = defaultComponent('lens', 400, SCENE_H / 2)
      lens.focalLength = 150
      const scr = defaultComponent('screen', 400 + 150 + 50, SCENE_H / 2)
      scr.rot = 180
      return [L, lens, scr]
    }
    case 'refraction': {
      const L = defaultComponent('laser', 90, 200)
      L.rot = 28
      L.wavelengthNm = 590
      const face = defaultComponent('interface', 420, 300)
      face.n = 1.5
      face.length = 220
      const scr = defaultComponent('screen', 780, 360)
      scr.rot = 180
      return [L, face, scr]
    }
    case 'periscope': {
      const L = defaultComponent('laser', 70, 130)
      L.wavelengthNm = 635
      const m1 = defaultComponent('mirror', 320, 130)
      m1.rot = 135
      const m2 = defaultComponent('mirror', 320, 420)
      m2.rot = 315
      const scr = defaultComponent('screen', 600, 420)
      scr.rot = 180
      return [L, m1, m2, scr]
    }
    case 'double-mirror': {
      const L = defaultComponent('laser', 100, 280)
      L.rot = 12
      L.wavelengthNm = 480
      const m1 = defaultComponent('mirror', 760, 180)
      m1.rot = 150
      const m2 = defaultComponent('mirror', 760, 420)
      m2.rot = 210
      const scr = defaultComponent('screen', 140, 440)
      scr.rot = 0
      return [L, m1, m2, scr]
    }
    case 'malus': {
      // Plate normals stay +x (face the beam); only polAngleDeg sets Malus axis.
      const L = defaultComponent('laser', 80, SCENE_H / 2)
      L.wavelengthNm = 635
      const p1 = defaultComponent('polarizer', 280, SCENE_H / 2)
      p1.rot = 0
      p1.polAngleDeg = 0
      p1.label = '起偏 0°'
      const p2 = defaultComponent('polarizer', 520, SCENE_H / 2)
      p2.rot = 0
      p2.polAngleDeg = 45
      p2.label = '检偏 45°'
      const scr = defaultComponent('screen', 780, SCENE_H / 2)
      scr.rot = 180
      return [L, p1, p2, scr]
    }
    case 'beamsplit': {
      // Plate normal 135°: transmit +x, reflect toward +y (up on canvas y-down is actually...
      // SVG y grows downward; +y is down. rot=45 normal → reflect +x to −y = up.
      const L = defaultComponent('laser', 100, 300)
      L.wavelengthNm = 532
      const sp = defaultComponent('splitter', 420, 300)
      sp.rot = 45
      sp.splitT = 0.5
      const s1 = defaultComponent('screen', 740, 300)
      s1.rot = 180
      s1.label = '透射屏'
      const s2 = defaultComponent('screen', 420, 80)
      s2.rot = 90 // face downward toward reflected beam from below
      s2.label = '反射屏'
      return [L, sp, s1, s2]
    }
    case 'lab-bench': {
      // Full teaching bench: laser → pol → lens → interface → screen
      const L = defaultComponent('laser', 60, 300)
      L.wavelengthNm = 560
      L.power = 1.2
      const pol = defaultComponent('polarizer', 200, 300)
      pol.polAngleDeg = 0
      const lens = defaultComponent('lens', 380, 300)
      lens.focalLength = 160
      const face = defaultComponent('interface', 560, 320)
      face.rot = 15
      face.n = 1.33
      face.label = '水 n=1.33'
      const scr = defaultComponent('screen', 820, 340)
      scr.rot = 180
      return [L, pol, lens, face, scr]
    }
    case 'tir':
      // From the dense side (left of a +x normal) above the glass-air critical angle.
      return [
        place('laser', 380, 250, { rot: 50, wavelengthNm: 532, label: '玻璃中入射' }),
        place('interface', 520, 300, { rot: 0, n: 1.5, length: 280, label: '玻璃→空气' }),
        place('screen', 420, 530, { rot: 270, length: 260, label: '全反射屏' }),
      ]
    case 'fiber':
      return [
        place('laser', 70, 210, { rot: 18, wavelengthNm: 850, label: '入纤' }),
        place('interface', 480, 160, { rot: 270, n: 1.46, length: 720, label: '纤芯上壁' }),
        place('interface', 480, 400, { rot: 90, n: 1.46, length: 720, label: '纤芯下壁' }),
        place('screen', 880, 280, { rot: 180, label: '出射屏' }),
      ]
    case 'retroreflector':
      return [
        place('laser', 80, 220, { rot: 16, wavelengthNm: 635, label: '入射' }),
        place('mirror', 620, 240, { rot: 135, length: 130, label: '直角镜 1' }),
        place('mirror', 620, 400, { rot: 225, length: 130, label: '直角镜 2' }),
        place('screen', 40, 80, { rot: 0, length: 180, label: '返回屏' }),
      ]
    case 'optical-lever':
      return [
        place('laser', 70, 140, { rot: 12, wavelengthNm: 532, label: '探针光' }),
        place('mirror', 420, 200, { rot: 118, length: 70, label: '微摆镜' }),
        place('screen', 820, 420, { rot: 200, length: 200, label: '远处光屏' }),
      ]
    case 'kepler':
      return [
        place('laser', 60, SCENE_H / 2, { wavelengthNm: 560, label: '物方' }),
        place('lens', 280, SCENE_H / 2, { focalLength: 160, length: 140, label: '物镜 f=160' }),
        place('lens', 280 + 160 + 90, SCENE_H / 2, { focalLength: 90, length: 110, label: '目镜 f=90' }),
        place('screen', 780, SCENE_H / 2, { rot: 180, label: '像方屏' }),
      ]
    case 'galileo':
      return [
        place('laser', 60, SCENE_H / 2, { wavelengthNm: 532, label: '物方' }),
        place('lens', 300, SCENE_H / 2, { focalLength: 180, length: 140, label: '物镜 f=180' }),
        place('lens', 300 + 180 - 70, SCENE_H / 2, { focalLength: -70, length: 100, label: '凹目镜 f=−70' }),
        place('screen', 820, SCENE_H / 2, { rot: 180, label: '虚像方向' }),
      ]
    case 'microscope':
      return [
        place('laser', 70, SCENE_H / 2, { wavelengthNm: 450, power: 1.1, label: '照明' }),
        place('lens', 260, SCENE_H / 2, { focalLength: 55, length: 90, label: '物镜' }),
        place('lens', 260 + 55 + 120, SCENE_H / 2, { focalLength: 110, length: 120, label: '目镜' }),
        place('screen', 800, SCENE_H / 2, { rot: 180, label: '观察屏' }),
      ]
    case 'crossed-polars':
      return [
        place('laser', 80, SCENE_H / 2, { wavelengthNm: 635, label: '光源' }),
        place('polarizer', 300, SCENE_H / 2, { rot: 0, polAngleDeg: 0, label: '起偏 0°' }),
        place('polarizer', 540, SCENE_H / 2, { rot: 0, polAngleDeg: 90, label: '检偏 90°' }),
        place('screen', 780, SCENE_H / 2, { rot: 180, label: '消光屏' }),
      ]
    case 'michelson':
      return [
        place('laser', 70, 300, { wavelengthNm: 532, label: '入射' }),
        place('splitter', 400, 300, { rot: 45, splitT: 0.5, label: '分束镜' }),
        place('mirror', 720, 300, { rot: 180, length: 100, label: '臂 A 端镜' }),
        place('mirror', 400, 110, { rot: 90, length: 100, label: '臂 B 端镜' }),
        place('screen', 400, 520, { rot: 270, length: 160, label: '探测屏' }),
      ]
    case 'young-double-slit':
      return youngLayout(2, 36, 10, 532)
    case 'young-one-blocked': {
      const comps = youngLayout(2, 36, 10, 532)
      // Close the lower slit (pitch 36, rot 180 → tangent (0,−1)).
      comps.push(
        place('blocker', 340, SCENE_H / 2 + 18, {
          rot: 180,
          length: 12,
          slitPlate: true,
          label: '遮缝',
        }),
      )
      return comps
    }
    case 'young-two-color': {
      const comps = youngLayout(2, 36, 10, 450)
      comps[0].wavelengthNm = 450
      comps[0].y = SCENE_H / 2 - 10
      comps[0].label = '蓝 450 nm'
      const red = place('laser', 70, SCENE_H / 2 + 10, { wavelengthNm: 650, label: '红 650 nm' })
      return [comps[0], red, ...comps.slice(1)]
    }
    case 'single-slit':
      return youngLayout(1, 40, 16, 450)
    case 'triple-slit':
      return youngLayout(3, 28, 8, 532)
    case 'diffraction-grating':
      return youngLayout(5, 22, 6, 560)
    case 'lloyd-mirror':
      return [
        place('laser', 80, 350, { rot: 12, wavelengthNm: 532, label: '实光源' }),
        place('mirror', 500, 410, { rot: 270, length: 700, lloydMirror: true, label: '劳埃德镜' }),
        place('screen', 850, 240, { rot: 180, length: 300, label: '干涉屏' }),
      ]
    case 'fresnel-biprism':
      return [
        place('laser', 70, SCENE_H / 2, { wavelengthNm: 560, label: '光源' }),
        place('interface', 380, 180, { rot: 12, n: 1.5, length: 200, biprism: true, label: '双棱镜上' }),
        place('interface', 380, 380, { rot: -12, n: 1.5, length: 200, biprism: true, label: '双棱镜下' }),
        place('screen', 840, SCENE_H / 2, { rot: 180, length: 240, label: '干涉屏' }),
      ]
    case 'knife-edge':
      return [
        place('laser', 70, SCENE_H / 2, { wavelengthNm: 532, label: '相干光源' }),
        place('blocker', 340, 420, { rot: 180, length: 280, edgeWave: true, label: '直边' }),
        place('screen', 820, SCENE_H / 2, { rot: 180, length: 280, label: '衍射屏' }),
      ]
    case 'poisson-spot':
      return [
        place('laser', 70, SCENE_H / 2, { wavelengthNm: 532, label: '相干光源' }),
        place('blocker', 400, SCENE_H / 2, { rot: 180, length: 36, edgeWave: true, label: '小障碍' }),
        place('screen', 820, SCENE_H / 2, { rot: 180, length: 240, label: '衍射屏' }),
      ]
    case 'mach-zehnder':
      // Rectangular loop: BS1 splits +x → +x / −y; two 45° mirrors fold the arms
      // onto BS2, whose two output ports (+x and −y) each get a screen.
      return [
        place('laser', 70, 400, { wavelengthNm: 532, label: '激光' }),
        place('splitter', 300, 400, { rot: 45, splitT: 0.5, label: '分束镜 1' }),
        place('mirror', 640, 400, { rot: 45, length: 110, label: '臂镜 A' }),
        place('mirror', 300, 120, { rot: 45, length: 110, label: '臂镜 B' }),
        place('splitter', 640, 120, { rot: 45, splitT: 0.5, machZehnder: true, label: '合束镜' }),
        place('screen', 880, 120, { rot: 180, length: 160, label: '输出屏 1' }),
        place('screen', 640, 40, { rot: 90, length: 140, label: '输出屏 2' }),
      ]
    case 'newton-rings':
      // Air wedge: two interfaces touching at the left end, opening ≈3° to the
      // right. Equal-thickness fringes on the transmission screen — the 2D
      // cross-section analog of Newton's rings.
      return [
        place('laser', 90, 150, { rot: 32, wavelengthNm: 590, label: '钠光' }),
        place('interface', 450, 300, { rot: 90, n: 1.5, length: 300, newtonRings: true, label: '平玻璃' }),
        place('interface', 450, 292, { rot: 267, n: 1.5, length: 300, newtonRings: true, label: '楔形膜上板' }),
        place('screen', 470, 390, { rot: 270, length: 320, label: '等厚条纹屏' }),
      ]
    case 'fabry-perot':
      // Two high-R splitters face each other across an 80 px cavity; the beam
      // bounces inside and each partial transmission reaches the screen.
      return [
        place('laser', 70, 300, { wavelengthNm: 650, label: '激光' }),
        place('splitter', 400, 300, { rot: 180, splitT: 0.3, fabryPerot: true, label: '腔镜 1' }),
        place('splitter', 480, 300, { rot: 180, splitT: 0.3, fabryPerot: true, label: '腔镜 2' }),
        place('screen', 820, 300, { rot: 180, length: 260, label: '透射屏' }),
      ]
    case 'michelson-wave':
      // Same arms as the geometric 'michelson' layout, but the splitter also
      // carries the wave model: each returning arm becomes one virtual source
      // beside the splitter, phased by its round-trip length 2L, so the two
      // sources interfere on the downward detector screen.
      return [
        place('laser', 70, 300, { wavelengthNm: 532, label: '激光' }),
        place('splitter', 400, 300, { rot: 45, splitT: 0.5, michelsonWave: true, label: '分束·合束镜' }),
        place('mirror', 720, 300, { rot: 180, length: 100, label: '臂 A 端镜' }),
        place('mirror', 400, 110, { rot: 90, length: 100, label: '臂 B 端镜' }),
        place('screen', 400, 520, { rot: 270, length: 160, label: '干涉屏' }),
      ]
    case 'zone-plate': {
      // Fresnel amplitude zone plate: even half-wave zones are left open for
      // f = 240 px, so plane-wave Huygens sources arrive at the axial focus in
      // phase and burn a bright spot into the screen there. The probe beam is
      // offset upward so the geometric fan clips the first absorbing ring, and
      // the screen sits half a profile bin off axis (L/96 ≈ 2.3 px) so the
      // diffraction-limited spot lands mid-bin instead of straddling two.
      const lambda = 532
      const focusPx = 240
      return [
        place('laser', 70, SCENE_H / 2 + 30, { wavelengthNm: lambda, label: '平面波源' }),
        ...makeZonePlate(340, SCENE_H / 2, 180, focusPx, lambda, 4),
        place('screen', 340 + focusPx, SCENE_H / 2 + 2.3, { rot: 180, length: 220, label: '焦屏' }),
      ]
    }
  }
}

/** Teaching scale: 200 nm → 1 scene pixel, so a 140 px screen shows several fringes. */
export function opticsWavelengthPx(wavelengthNm: number): number {
  return Math.max(1.5, wavelengthNm / 200)
}

export function makeSlitPlate(
  x: number,
  y: number,
  rot: number,
  slits: number,
  pitch: number,
  width: number,
): OpticsComponent[] {
  const t = tangentFromRot(rot)
  const halfW = width / 2
  const span = ((slits - 1) * pitch) / 2 + halfW + 80
  const openings = Array.from({ length: slits }, (_, i) => (i - (slits - 1) / 2) * pitch)
  const cuts: { a: number; b: number }[] = []
  let cursor = -span
  for (const along of openings) {
    cuts.push({ a: cursor, b: along - halfW })
    cursor = along + halfW
  }
  cuts.push({ a: cursor, b: span })
  return cuts
    .filter((cut) => cut.b - cut.a > 6)
    .map((cut, i) => {
      const mid = (cut.a + cut.b) / 2
      return place('blocker', x + t.tx * mid, y + t.ty * mid, {
        rot,
        length: cut.b - cut.a,
        label: `狭缝板-${i + 1}`,
        slitPlate: true,
      })
    })
}

/**
 * Fresnel amplitude zone plate: blocker walls cover the odd half-wave zones
 * for a plane wave focused at focusPx, so the open even zones act like slit
 * openings whose Huygens wavelets all arrive at the focus within λ/2.
 * Zone boundary a_m solves √(f² + a²) − f = mλ/2.
 */
export function makeZonePlate(
  x: number,
  y: number,
  rot: number,
  focusPx: number,
  wavelengthNm: number,
  zonePairs = 3,
): OpticsComponent[] {
  const t = tangentFromRot(rot)
  const lambdaPx = opticsWavelengthPx(wavelengthNm)
  const boundary = (m: number) => Math.sqrt(m * lambdaPx * focusPx + (m * m * lambdaPx * lambdaPx) / 4)
  const openings: { a: number; b: number }[] = []
  for (let j = 0; j <= zonePairs; j++) {
    const lo = boundary(2 * j)
    const hi = boundary(2 * j + 1)
    if (hi - lo < 3.5) break
    if (lo < 1e-6) openings.push({ a: -hi, b: hi })
    else openings.push({ a: -hi, b: -lo }, { a: lo, b: hi })
  }
  if (!openings.length) return []
  const span = Math.max(...openings.map((o) => Math.max(Math.abs(o.a), Math.abs(o.b)))) + 80
  const sorted = [...openings].sort((p, q) => p.a - q.a)
  const cuts: { a: number; b: number }[] = []
  let cursor = -span
  for (const open of sorted) {
    cuts.push({ a: cursor, b: open.a })
    cursor = open.b
  }
  cuts.push({ a: cursor, b: span })
  // Outer rings are thinner than slit-plate walls; keep cuts down to 4 px so
  // narrow closed zones are not merged into the open ones beside them.
  return cuts
    .filter((cut) => cut.b - cut.a > 4)
    .map((cut, i) => {
      const mid = (cut.a + cut.b) / 2
      return place('blocker', x + t.tx * mid, y + t.ty * mid, {
        rot,
        length: cut.b - cut.a,
        label: `波带片-${i + 1}`,
        slitPlate: true,
        zonePlate: true,
      })
    })
}

function youngLayout(slits: number, pitch: number, width: number, wavelengthNm: number): OpticsComponent[] {
  const plateX = 340
  const plateY = SCENE_H / 2
  const laser = place('laser', 70, plateY, { wavelengthNm, label: '相干光源' })
  const plate = makeSlitPlate(plateX, plateY, 180, slits, pitch, width)
  const screen = place('screen', 820, plateY, { rot: 180, length: 220, label: '干涉屏' })
  return [laser, ...plate, screen]
}

export interface SlitOpening {
  x: number
  y: number
  width: number
  tx: number
  ty: number
}

export interface HuygensSource {
  x: number
  y: number
  amplitude: number
  wavelengthNm: number
  phase: number
}

export function slitOpenings(components: OpticsComponent[]): SlitOpening[] {
  const plate = components.filter((c) => c.kind === 'blocker' && c.slitPlate)
  if (plate.length < 2) return []
  const t = tangentFromRot(plate[0].rot)
  const sorted = [...plate].sort((a, b) => a.x * t.tx + a.y * t.ty - (b.x * t.tx + b.y * t.ty))
  const cx = sorted.reduce((s, c) => s + c.x, 0) / sorted.length
  const cy = sorted.reduce((s, c) => s + c.y, 0) / sorted.length
  const originAlong = cx * t.tx + cy * t.ty
  const ox = cx - originAlong * t.tx
  const oy = cy - originAlong * t.ty
  const openings: SlitOpening[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const endA = a.x * t.tx + a.y * t.ty + a.length / 2
    const startB = b.x * t.tx + b.y * t.ty - b.length / 2
    const width = startB - endA
    if (width <= 2) continue
    const along = (endA + startB) / 2
    openings.push({
      x: ox + along * t.tx,
      y: oy + along * t.ty,
      width,
      tx: t.tx,
      ty: t.ty,
    })
  }
  return openings
}

function sampleAperture(opening: SlitOpening, amplitude: number, wavelengthNm: number): HuygensSource[] {
  const lambdaPx = opticsWavelengthPx(wavelengthNm)
  const n = Math.max(5, Math.min(17, Math.round(opening.width / Math.max(1.8, lambdaPx * 0.45))))
  const amp = amplitude / n
  const out: HuygensSource[] = []
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5
    out.push({
      x: opening.x + t * opening.width * opening.tx,
      y: opening.y + t * opening.width * opening.ty,
      amplitude: amp,
      wavelengthNm,
      phase: 0,
    })
  }
  return out
}

function reflectPoint(x: number, y: number, seg: SegmentGeom): { x: number; y: number } {
  const d = (x - seg.x0) * seg.nx + (y - seg.y0) * seg.ny
  return { x: x - 2 * d * seg.nx, y: y - 2 * d * seg.ny }
}

function sampleOpenAperture(
  blockers: OpticsComponent[],
  amplitude: number,
  wavelengthNm: number,
): HuygensSource[] {
  if (!blockers.length) return []
  const t = tangentFromRot(blockers[0].rot)
  const cx = blockers.reduce((s, c) => s + c.x, 0) / blockers.length
  const cy = blockers.reduce((s, c) => s + c.y, 0) / blockers.length
  const originAlong = cx * t.tx + cy * t.ty
  const ox = cx - originAlong * t.tx
  const oy = cy - originAlong * t.ty
  const occupied = blockers.map((c) => {
    const along = c.x * t.tx + c.y * t.ty
    return { a: along - c.length / 2, b: along + c.length / 2 }
  })
  const step = Math.max(2.2, opticsWavelengthPx(wavelengthNm) * 0.5)
  const corners = [0, SCENE_W * t.tx, SCENE_H * t.ty, SCENE_W * t.tx + SCENE_H * t.ty]
  const minAlong = Math.min(...corners)
  const maxAlong = Math.max(...corners)
  const points: HuygensSource[] = []
  for (let along = minAlong; along <= maxAlong; along += step) {
    if (occupied.some((iv) => along >= iv.a && along <= iv.b)) continue
    points.push({ x: ox + along * t.tx, y: oy + along * t.ty, amplitude: 1, wavelengthNm, phase: 0 })
  }
  const amp = amplitude / Math.sqrt(Math.max(1, points.length))
  return points.map((p) => ({ ...p, amplitude: amp }))
}

export function huygensSources(components: OpticsComponent[]): HuygensSource[] {
  const lasers = components.filter((c) => c.kind === 'laser')
  const fallbackNm = lasers[0]?.wavelengthNm ?? 532
  const fallbackP = lasers[0]?.power ?? 1
  const waves = new Map<number, number>()
  if (lasers.length) {
    for (const laser of lasers) {
      const nm = laser.wavelengthNm ?? 532
      waves.set(nm, (waves.get(nm) ?? 0) + (laser.power ?? 1))
    }
  } else {
    waves.set(fallbackNm, fallbackP)
  }

  const openings = slitOpenings(components)
  if (openings.length >= 1) {
    const out: HuygensSource[] = []
    for (const [nm, power] of waves) {
      for (const opening of openings) out.push(...sampleAperture(opening, power, nm))
    }
    return out
  }

  const lloyd = components.find((c) => c.kind === 'mirror' && c.lloydMirror)
  if (lloyd && lasers[0]) {
    const laser = lasers[0]
    const nm = laser.wavelengthNm ?? 532
    const amp = laser.power ?? 1
    const image = reflectPoint(laser.x, laser.y, componentSegment(lloyd))
    return [
      { x: laser.x, y: laser.y, amplitude: amp, wavelengthNm: nm, phase: 0 },
      { x: image.x, y: image.y, amplitude: amp, wavelengthNm: nm, phase: Math.PI },
    ]
  }

  const edges = components.filter((c) => c.kind === 'blocker' && c.edgeWave)
  if (edges.length) return sampleOpenAperture(edges, fallbackP, fallbackNm)

  const prism = components.filter((c) => c.kind === 'interface' && c.biprism)
  if (prism.length >= 2 && lasers[0]) {
    const laser = lasers[0]
    const nm = laser.wavelengthNm ?? 532
    const amp = laser.power ?? 1
    const px = prism.reduce((s, c) => s + c.x, 0) / prism.length
    const py = prism.reduce((s, c) => s + c.y, 0) / prism.length
    const t = tangentFromRot(laser.rot)
    const d = 26
    return [
      { x: px + t.tx * d, y: py + t.ty * d, amplitude: amp, wavelengthNm: nm, phase: 0 },
      { x: px - t.tx * d, y: py - t.ty * d, amplitude: amp, wavelengthNm: nm, phase: 0 },
    ]
  }

  // Mach–Zehnder: the combiner sees one virtual source on each input arm,
  // a short distance g upstream — close enough to resolve fringes on either port.
  const mz = components.find((c) => c.kind === 'splitter' && c.machZehnder)
  if (mz) {
    const arms = components
      .filter((c) => c.kind === 'mirror')
      .map((c) => ({ c, d: Math.hypot(c.x - mz.x, c.y - mz.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
    if (arms.length === 2) {
      return arms.map(({ c, d }) => {
        const u = normalize(c.x - mz.x, c.y - mz.y)
        const g = Math.min(30, d / 3)
        return {
          x: mz.x + u.dx * g,
          y: mz.y + u.dy * g,
          amplitude: fallbackP,
          wavelengthNm: fallbackNm,
          phase: 0,
        }
      })
    }
  }

  // Michelson (wave model): the same splitter recombines both returning arms,
  // so each arm contributes one virtual source a short distance along its axis.
  // Unlike Mach–Zehnder the sources carry the round-trip phase 4πL/λ, which is
  // why sliding an end mirror by λ/4 flips every fringe on the detector.
  const mi = components.find((c) => c.kind === 'splitter' && c.michelsonWave)
  if (mi) {
    const lambdaPx = opticsWavelengthPx(fallbackNm)
    const arms = components
      .filter((c) => c.kind === 'mirror')
      .map((c) => ({ c, d: Math.hypot(c.x - mi.x, c.y - mi.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
    if (arms.length === 2) {
      return arms.map(({ c, d }) => {
        const u = normalize(c.x - mi.x, c.y - mi.y)
        const g = Math.min(30, d / 3)
        return {
          x: mi.x + u.dx * g,
          y: mi.y + u.dy * g,
          amplitude: fallbackP,
          wavelengthNm: fallbackNm,
          phase: (4 * Math.PI * d) / lambdaPx,
        }
      })
    }
  }

  // Newton wedge: sources on the midline between two interfaces carry the
  // equal-thickness phase 4π·gap/λ plus the π reflection flip, so the contact
  // point is dark and each λ/2 of extra gap adds a band.
  const wedge = components.filter((c) => c.kind === 'interface' && c.newtonRings)
  if (wedge.length >= 2) {
    const lambdaPx = opticsWavelengthPx(fallbackNm)
    const a = componentSegment(wedge[0])
    const b = componentSegment(wedge[1])
    const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0)
    const n = Math.max(9, Math.min(121, Math.round(len / 3)))
    const out: HuygensSource[] = []
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n
      const px = a.x0 + s * (a.x1 - a.x0)
      const py = a.y0 + s * (a.y1 - a.y0)
      const d = (px - b.x0) * b.nx + (py - b.y0) * b.ny
      out.push({
        x: px - (b.nx * d) / 2,
        y: py - (b.ny * d) / 2,
        amplitude: fallbackP / Math.sqrt(n),
        wavelengthNm: fallbackNm,
        phase: Math.PI + (4 * Math.PI * Math.abs(d)) / lambdaPx,
      })
    }
    return out
  }

  // Fabry–Pérot: each transmitted beam is one round trip 2d older, so the
  // output equals a train of virtual sources spaced 2d behind the exit plate
  // with amplitudes decaying by the cavity reflectance R = 1 − splitT.
  const fp = components.filter((c) => c.kind === 'splitter' && c.fabryPerot)
  if (fp.length >= 2 && lasers[0]) {
    const laser = lasers[0]
    const nm = laser.wavelengthNm ?? 532
    const dir = unitFromRot(laser.rot)
    const proj = (c: OpticsComponent) => (c.x - laser.x) * dir.dx + (c.y - laser.y) * dir.dy
    const sorted = [...fp].sort((p, q) => proj(p) - proj(q))
    const exit = sorted[sorted.length - 1]
    const gap = Math.abs(proj(exit) - proj(sorted[0]))
    if (gap > 4) {
      const reflect = Math.max(0.05, Math.min(0.98, 1 - (exit.splitT ?? 0.5)))
      const train: HuygensSource[] = []
      let norm = 0
      for (let m = 0; m < 10; m++) {
        const amp = Math.pow(reflect, m)
        if (m > 0 && amp < 0.05) break
        norm += amp * amp
        train.push({
          x: exit.x - dir.dx * 2 * gap * m,
          y: exit.y - dir.dy * 2 * gap * m,
          amplitude: amp,
          wavelengthNm: nm,
          phase: 0,
        })
      }
      const scale = (laser.power ?? 1) / Math.sqrt(Math.max(norm, 1e-9))
      return train.map((s) => ({ ...s, amplitude: s.amplitude * scale }))
    }
  }

  return []
}

export function huygensBins(sources: HuygensSource[], screen: SegmentGeom, bins: number): Float64Array {
  const out = new Float64Array(bins)
  if (!sources.length || bins < 2) return out
  const groups = new Map<number, HuygensSource[]>()
  for (const source of sources) {
    const key = Math.round(source.wavelengthNm)
    const group = groups.get(key)
    if (group) group.push(source)
    else groups.set(key, [source])
  }
  for (const group of groups.values()) {
    const lambdaPx = opticsWavelengthPx(group[0].wavelengthNm)
    if (lambdaPx <= 0) continue
    const k = (2 * Math.PI) / lambdaPx
    for (let i = 0; i < bins; i++) {
      const s = (i + 0.5) / bins
      const px = screen.x0 + s * (screen.x1 - screen.x0)
      const py = screen.y0 + s * (screen.y1 - screen.y0)
      let re = 0
      let im = 0
      for (const o of group) {
        const r = Math.hypot(px - o.x, py - o.y)
        const dist = r < 1e-6 ? 1e-6 : r
        const amp = o.amplitude / Math.sqrt(dist)
        const phase = k * dist + o.phase
        re += amp * Math.cos(phase)
        im += amp * Math.sin(phase)
      }
      out[i] += re * re + im * im
    }
  }
  return out
}

/** Replace geometric screen deposits with Huygens interference when wave sources exist. */
export function decorateHuygens(trace: TraceResult, components: OpticsComponent[]): TraceResult {
  const sources = huygensSources(components)
  if (sources.length < 1) return trace
  const screens = components.filter((c) => c.kind === 'screen')
  if (!screens.length) return trace
  const profiles: ScreenProfile[] = screens.map((screen) => {
    const bins = huygensBins(sources, componentSegment(screen), SCREEN_BINS)
    let total = 0
    let peak = -1
    let peakBin = 0
    for (let i = 0; i < bins.length; i++) {
      total += bins[i]
      if (bins[i] > peak) {
        peak = bins[i]
        peakBin = i
      }
    }
    return { componentId: screen.id, bins, total, peakBin, peakS: (peakBin + 0.5) / SCREEN_BINS }
  })
  const screenPower: Record<string, number> = {}
  for (const profile of profiles) screenPower[profile.componentId] = profile.total
  return { ...trace, profiles, screenPower }
}

export function sampleHuygensField(
  components: OpticsComponent[],
  nx = 72,
  ny = 40,
): { x0: number; y0: number; x1: number; y1: number; nx: number; ny: number; values: Float64Array } | null {
  const sources = huygensSources(components)
  const screen = components.find((c) => c.kind === 'screen')
  if (sources.length < 1 || !screen) return null
  const upstream = sources.map((s) => s.x).filter((x) => x < screen.x - 20)
  let x0 = (upstream.length ? Math.min(...upstream) : Math.min(...sources.map((s) => s.x))) + 8
  const x1 = screen.x
  let y0 = 24
  let y1 = SCENE_H - 24
  const lloyd = components.find((c) => c.kind === 'mirror' && c.lloydMirror)
  const laser = components.find((c) => c.kind === 'laser')
  if (lloyd && laser) {
    const seg = componentSegment(lloyd)
    const top = Math.min(seg.y0, seg.y1)
    const bot = Math.max(seg.y0, seg.y1)
    if (Math.abs(seg.ny) > 0.7) {
      if (laser.y < top) y1 = Math.min(y1, top - 2)
      else y0 = Math.max(y0, bot + 2)
    }
    x0 = Math.max(x0, Math.min(seg.x0, seg.x1) + 8)
  }
  if (!(x1 > x0 + 20) || !(y1 > y0 + 20)) return null
  const values = new Float64Array(nx * ny)
  const groups = new Map<number, HuygensSource[]>()
  for (const source of sources) {
    const key = Math.round(source.wavelengthNm)
    const group = groups.get(key)
    if (group) group.push(source)
    else groups.set(key, [source])
  }
  const kByNm = new Map<number, number>()
  for (const [nm, group] of groups) kByNm.set(nm, (2 * Math.PI) / opticsWavelengthPx(group[0].wavelengthNm))
  for (let j = 0; j < ny; j++) {
    const py = y0 + ((j + 0.5) / ny) * (y1 - y0)
    for (let i = 0; i < nx; i++) {
      const px = x0 + ((i + 0.5) / nx) * (x1 - x0)
      let intensity = 0
      for (const [nm, group] of groups) {
        const k = kByNm.get(nm) ?? 0
        let re = 0
        let im = 0
        for (const o of group) {
          const r = Math.hypot(px - o.x, py - o.y)
          const dist = r < 1e-6 ? 1e-6 : r
          const amp = o.amplitude / Math.sqrt(dist)
          const phase = k * dist + o.phase
          re += amp * Math.cos(phase)
          im += amp * Math.sin(phase)
        }
        intensity += re * re + im * im
      }
      values[j * nx + i] = intensity
    }
  }
  return { x0, y0, x1, y1, nx, ny, values }
}

/** Teaching scale Δy ≈ λD/d from the two dominant sources (slits, Lloyd, biprism). */
export function fringeScale(components: OpticsComponent[]): {
  dPx: number
  DPx: number
  lambdaPx: number
  spacingPx: number
} | null {
  const screen = components.find((c) => c.kind === 'screen')
  const laser = components.find((c) => c.kind === 'laser')
  if (!screen || !laser) return null
  const lambdaPx = opticsWavelengthPx(laser.wavelengthNm ?? 532)
  const openings = slitOpenings(components)
  let a: { x: number; y: number } | undefined
  let b: { x: number; y: number } | undefined
  if (openings.length >= 2) {
    a = openings[0]
    b = openings[1]
  } else {
    const sources = huygensSources(components)
    if (sources.length === 2) {
      a = sources[0]
      b = sources[1]
    }
  }
  if (!a || !b) return null
  const dPx = Math.hypot(a.x - b.x, a.y - b.y)
  if (dPx < 1) return null
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const DPx = Math.hypot(screen.x - mx, screen.y - my)
  if (DPx < 1) return null
  return { dPx, DPx, lambdaPx, spacingPx: (lambdaPx * DPx) / dPx }
}

// Numerical tracing and geometry are owned by W-Sim; this layer maps IDs and UI notes.
export function seedRaysFromLasers(components: OpticsComponent[]): OpticsRay[] {
  return new WasmOpticsMath().seed(components)
}
export function createOpticsTrace(components: OpticsComponent[], opts?: { maxBounces?: number; screenBins?: number }) {
  const run = new WasmOptics(opts?.screenBins ?? SCREEN_BINS)
  run.reset(components, opts?.maxBounces ?? MAX_BOUNCES)
  return run
}
export function readOpticsTrace(run: WasmOptics, components: OpticsComponent[]): TraceResult {
  run.read()
  const { view } = run
  const f = (offset: number) => view.getFloat64(offset, true)
  const u = (offset: number) => view.getUint32(offset, true)
  const segments: RaySegment[] = Array.from({ length: run.state[2] }, (_, i) => {
    const p = run.segments + i * 48
    return { x0: f(p), y0: f(p + 8), x1: f(p + 16), y1: f(p + 24), intensity: f(p + 32), wavelengthNm: f(p + 40) }
  })
  const hits: RayHit[] = Array.from({ length: run.state[3] }, (_, i) => {
    const p = run.hits + i * 48, c = components[u(p)]
    return { componentId: c.id, kind: c.kind, x: f(p + 8), y: f(p + 16), intensity: f(p + 24), wavelengthNm: f(p + 32), s: f(p + 40) }
  })
  const types: OpticsEvent['type'][] = ['reflect', 'refract', 'tir', 'lens', 'polarize', 'split', 'screen', 'block']
  const events: OpticsEvent[] = Array.from({ length: run.state[4] }, (_, i) => {
    const p = run.events + i * 80, type = types[u(p)], c = components[u(p + 4)], mask = u(p + 12)
    const thetaI = f(p + 48), thetaT = f(p + 56), a = f(p + 64), b = f(p + 72)
    // Applied power ratio reported by the kernel (Fresnel T, coating R, …).
    const applied = mask & 1 && f(p + 32) > 0 ? `${((f(p + 40) / f(p + 32)) * 100).toFixed(1)}%` : ''
    const note = type === 'reflect' ? `反射 θᵢ≈${thetaI.toFixed(1)}° · 保护银膜 R=${applied}`
      : type === 'tir' ? `全反射 TIR θᵢ≈${thetaI.toFixed(1)}° · R=100%`
      : type === 'refract' ? `折射 n ${a.toFixed(2)}→${b.toFixed(2)}  θᵢ≈${thetaI.toFixed(1)}° θₜ≈${thetaT.toFixed(1)}° · 菲涅耳 T=${applied}`
      : type === 'lens' ? `薄透镜 f=${Math.round(a)} h=${b.toFixed(1)} · 双面膜 T=${applied}`
      : type === 'polarize' ? mask & 8 ? `起偏 · 透射 ${(a * 100).toFixed(0)}% → pol=${b.toFixed(0)}°` : `马吕斯 cos²Δ=${a.toFixed(3)}  轴=${b.toFixed(0)}°`
      : type === 'split' ? `分束 T=${(a * 100).toFixed(0)}% / R=${(b * 100).toFixed(0)}%`
      : type === 'screen' ? '光屏沉积' : '遮光吸收'
    return { type, componentId: c.id, componentKind: c.kind, x: f(p + 16), y: f(p + 24), intensityIn: f(p + 32),
      ...(mask & 1 ? { intensityOut: f(p + 40) } : {}), ...(mask & 2 ? { thetaIDeg: thetaI } : {}),
      ...(mask & 4 ? { thetaTDeg: thetaT } : {}), note }
  })
  const screenPower: Record<string, number> = {}
  const profiles: ScreenProfile[] = Array.from({ length: run.state[5] }, (_, i) => {
    const p = run.profiles + i * 32, index = u(p), componentId = components[index].id
    screenPower[componentId] = f(p + 8)
    return { componentId, peakBin: u(p + 4), total: f(p + 16), peakS: f(p + 24),
      bins: run.bins.slice(index * run.screenBins, (index + 1) * run.screenBins) }
  })
  return { segments, hits, events, screenPower, profiles }
}
export function traceScene(components: OpticsComponent[], opts?: { maxBounces?: number; screenBins?: number }): TraceResult {
  const run = createOpticsTrace(components, opts)
  while (!run.done) run.advance()
  return readOpticsTrace(run, components)
}

export function totalScreenPower(result: TraceResult): number {
  let s = 0
  // Profile order survives JSON object-key reordering by a native serializer.
  for (const profile of result.profiles) s += result.screenPower[profile.componentId]
  return s
}

// ── scene I/O ───────────────────────────────────────────────

export interface OpticsScene {
  version: 1
  components: OpticsComponent[]
  presetId?: OpticsPresetId
}

export function serializeScene(
  components: OpticsComponent[],
  presetId?: OpticsPresetId,
): string {
  const scene: OpticsScene = { version: 1, components, presetId }
  return JSON.stringify(scene, null, 2)
}

export function parseScene(json: string): OpticsComponent[] {
  const raw = JSON.parse(json) as OpticsScene
  if (!raw || !Array.isArray(raw.components)) throw new Error('invalid scene')
  return raw.components.map((c) => ({
    ...c,
    id: c.id || newOpticsId(c.kind),
  }))
}

// ── UI catalog ──────────────────────────────────────────────

export const OPTICS_PALETTE: {
  kind: OpticsKind
  label: string
  labelEn: string
  icon: string
  blurb: string
  blurbEn: string
}[] = [
  { kind: 'laser', label: '激光', labelEn: 'Laser', icon: '🔦', blurb: '光源 · 波长/功率/扇束', blurbEn: 'Source · λ / power / fan' },
  { kind: 'mirror', label: '平面镜', labelEn: 'Plane mirror', icon: '🪞', blurb: '反射定律 · 保护银膜 R≈94%', blurbEn: 'Reflection · protected-silver R≈94%' },
  { kind: 'lens', label: '薄透镜', labelEn: 'Thin lens', icon: '🔍', blurb: '焦距可调 · 双面菲涅耳损耗', blurbEn: 'Focal length · two-face Fresnel loss' },
  { kind: 'interface', label: '折射面', labelEn: 'Refracting interface', icon: '💧', blurb: '斯涅尔+菲涅耳 · 全反射', blurbEn: 'Snell + Fresnel · TIR' },
  { kind: 'polarizer', label: '偏振片', labelEn: 'Polarizer', icon: '⬛', blurb: '马吕斯 · 透射随夹角', blurbEn: 'Malus · angle-dependent T' },
  { kind: 'splitter', label: '分束器', labelEn: 'Beam splitter', icon: '⬡', blurb: 'T/R 可调 · 功率守恒', blurbEn: 'Adjustable T/R · power-conserving' },
  { kind: 'screen', label: '光屏', labelEn: 'Screen', icon: '📟', blurb: '功率 + 强度剖面', blurbEn: 'Power + intensity profile' },
  { kind: 'blocker', label: '挡板', labelEn: 'Blocker', icon: '🧱', blurb: '遮光吸收', blurbEn: 'Absorbs light' },
]

export type OpticsPresetGroupId = 'geometry' | 'medium' | 'lens' | 'polarization' | 'wave'

export const OPTICS_PRESET_GROUPS: {
  id: OpticsPresetGroupId
  label: string
  labelEn: string
}[] = [
  { id: 'geometry', label: '反射与几何', labelEn: 'Reflection' },
  { id: 'medium', label: '折射与介质', labelEn: 'Refraction' },
  { id: 'lens', label: '透镜仪器', labelEn: 'Lenses' },
  { id: 'polarization', label: '偏振与分束', labelEn: 'Polarization' },
  { id: 'wave', label: '波动光学', labelEn: 'Wave optics' },
]

export const OPTICS_PRESETS: {
  id: OpticsPresetId
  group: OpticsPresetGroupId
  label: string
  labelEn: string
  blurb: string
  blurbEn: string
  goal?: string
  goalEn?: string
}[] = [
  {
    id: 'mirror-bounce',
    group: 'geometry',
    label: '反射定律',
    labelEn: 'Law of reflection',
    blurb: '激光 → 斜镜 → 光屏',
    blurbEn: 'Laser → tilted mirror → screen',
    goal: '观察入射角=反射角；移动镜子改变光路',
    goalEn: 'Check i = r; move the mirror to change the path',
  },
  {
    id: 'lens-focus',
    group: 'lens',
    label: '薄透镜聚焦',
    labelEn: 'Thin-lens focus',
    blurb: '平行束经凸透镜会聚',
    blurbEn: 'Parallel beam through a convex lens',
    goal: '调节焦距，使光斑落在光屏上最亮',
    goalEn: 'Tune focal length so the screen spot is brightest',
  },
  {
    id: 'refraction',
    group: 'medium',
    label: '斯涅尔折射',
    labelEn: "Snell's law",
    blurb: '斜入射进入介质',
    blurbEn: 'Oblique incidence into a medium',
    goal: '对照右侧事件栏的 θᵢ / θₜ 与 n₁sinθ₁=n₂sinθₜ',
    goalEn: 'Match θᵢ / θₜ in the event log to n₁sinθ₁=n₂sinθₜ',
  },
  {
    id: 'malus',
    group: 'polarization',
    label: '马吕斯定律',
    labelEn: "Malus's law",
    blurb: '双偏振片透射',
    blurbEn: 'Two polarizers in series',
    goal: '旋转检偏器，光屏功率应按 cos²Δ 变化',
    goalEn: 'Rotate the analyzer; screen power should follow cos²Δ',
  },
  {
    id: 'beamsplit',
    group: 'polarization',
    label: '分束实验',
    labelEn: 'Beam splitter',
    blurb: '50/50 分光到两屏',
    blurbEn: '50/50 split onto two screens',
    goal: '两屏功率之和 ≈ 入射功率（损耗后）',
    goalEn: 'Sum of two screens ≈ incident power (after loss)',
  },
  {
    id: 'periscope',
    group: 'geometry',
    label: '潜望镜',
    labelEn: 'Periscope',
    blurb: '双镜折转',
    blurbEn: 'Two-mirror fold',
    goal: '保持两镜 45° 关系，把光送到下方光屏',
    goalEn: 'Keep mirrors at 45° to send light to the lower screen',
  },
  {
    id: 'lab-bench',
    group: 'medium',
    label: '综合光具座',
    labelEn: 'Teaching bench',
    blurb: '偏振+透镜+折射',
    blurbEn: 'Polarizer + lens + refraction',
    goal: '完整光路台：调每一级观察事件日志',
    goalEn: 'Full bench: tune each stage and watch the event log',
  },
  {
    id: 'double-mirror',
    group: 'geometry',
    label: '多镜反射',
    labelEn: 'Multi-bounce',
    blurb: '两镜弹射',
    blurbEn: 'Two-mirror bounce',
    goal: '多跳反射练习',
    goalEn: 'Practice multi-bounce paths',
  },
  {
    id: 'tir',
    group: 'medium',
    label: '全反射',
    labelEn: 'Total internal reflection',
    blurb: '玻璃→空气超过临界角',
    blurbEn: 'Glass → air above critical angle',
    goal: '临界角 arcsin(1/n)；大于临界角只剩全反射事件',
    goalEn: 'Critical angle arcsin(1/n); only TIR events above it',
  },
  {
    id: 'fiber',
    group: 'medium',
    label: '光纤导光',
    labelEn: 'Fiber waveguide',
    blurb: '纤芯上下壁全反射',
    blurbEn: 'TIR between core walls',
    goal: '增大入射角直到出射屏变亮，对应数值孔径',
    goalEn: 'Increase launch angle until the output screen brightens (NA)',
  },
  {
    id: 'retroreflector',
    group: 'geometry',
    label: '直角反射器',
    labelEn: 'Corner reflector',
    blurb: '两镜 90° 原路返回',
    blurbEn: 'Two mirrors at 90° send the beam back',
    goal: '入射方向变一点，返回束仍大致平行回去',
    goalEn: 'Nudge the incident angle; the return beam stays nearly parallel',
  },
  {
    id: 'optical-lever',
    group: 'geometry',
    label: '光杠杆',
    labelEn: 'Optical lever',
    blurb: '微转镜 × 远屏放大',
    blurbEn: 'Tiny mirror rotation, distant screen',
    goal: '只转镜子几度，远处光斑移动被放大',
    goalEn: 'A few degrees on the mirror move the distant spot a lot',
  },
  {
    id: 'kepler',
    group: 'lens',
    label: '开普勒望远镜',
    labelEn: 'Keplerian telescope',
    blurb: '物镜 + 目镜（两凸）',
    blurbEn: 'Objective + eyepiece (two convex)',
    goal: '两镜间隔 ≈ f物+f目；平行光仍近似平行出射',
    goalEn: 'Spacing ≈ f_obj + f_eye; collimated in, nearly collimated out',
  },
  {
    id: 'galileo',
    group: 'lens',
    label: '伽利略望远镜',
    labelEn: 'Galilean telescope',
    blurb: '凸物镜 + 凹目镜',
    blurbEn: 'Convex objective + diverging eyepiece',
    goal: '间隔 ≈ f物−|f目|；正立、较短镜筒',
    goalEn: 'Spacing ≈ f_obj − |f_eye|; erect image, short tube',
  },
  {
    id: 'microscope',
    group: 'lens',
    label: '复显微镜',
    labelEn: 'Compound microscope',
    blurb: '短焦物镜 + 目镜',
    blurbEn: 'Short-f objective + eyepiece',
    goal: '物镜在前焦附近形成中间像，目镜再放大',
    goalEn: 'Objective forms an intermediate image; eyepiece magnifies it',
  },
  {
    id: 'crossed-polars',
    group: 'polarization',
    label: '正交偏振',
    labelEn: 'Crossed polarizers',
    blurb: '起偏 0° × 检偏 90°',
    blurbEn: 'Polarizer 0° × analyzer 90°',
    goal: '光屏应接近消光；把检偏转到 0° 即复明',
    goalEn: 'Screen nearly dark; turning the analyzer to 0° restores light',
  },
  {
    id: 'michelson',
    group: 'polarization',
    label: '迈克尔逊光路',
    labelEn: 'Michelson layout',
    blurb: '分束 + 两臂端镜',
    blurbEn: 'Splitter + two arm mirrors',
    goal: '几何光路：两臂都应接到光。本引擎不做干涉条纹',
    goalEn: 'Geometric arms both receive light. This engine does not form fringes',
  },
  {
    id: 'young-double-slit',
    group: 'wave',
    label: '杨氏双缝',
    labelEn: "Young's double slit",
    blurb: '两缝相干 · 屏上明暗条纹',
    blurbEn: 'Two slits · bright/dark fringes',
    goal: '条纹间距 ≈ λD/d。改波长或缝距，条纹会跟着变。几何光线只穿过缝，条纹来自惠更斯叠加。',
    goalEn: 'Fringe spacing ≈ λD/d. Change λ or slit pitch to move the fringes. Rays only go through the gaps; the pattern is Huygens superposition.',
  },
  {
    id: 'young-one-blocked',
    group: 'wave',
    label: '遮一缝对照',
    labelEn: 'One slit blocked',
    blurb: '挡住一条缝 · 干涉消失',
    blurbEn: 'Cover one slit · fringes vanish',
    goal: '只剩单缝衍射包络。对照杨氏双缝：相干需要两条打开的缝。',
    goalEn: 'Only the single-slit envelope remains. Compare with Young: two open slits are required for interference.',
  },
  {
    id: 'young-two-color',
    group: 'wave',
    label: '双色双缝',
    labelEn: 'Two-color double slit',
    blurb: '蓝+红两套条纹叠加',
    blurbEn: 'Blue + red fringe systems overlay',
    goal: '不同 λ 的条纹间距不同，非相干叠加。红光条纹更疏。',
    goalEn: 'Different λ give different spacing; the colors add in intensity. Red fringes are coarser.',
  },
  {
    id: 'single-slit',
    group: 'wave',
    label: '单缝衍射',
    labelEn: 'Single-slit diffraction',
    blurb: '单缝展宽中央亮纹',
    blurbEn: 'Single opening, broad central lobe',
    goal: '缝越窄中央亮纹越宽。这是惠更斯对缝内多源的叠加，不是几何投影。',
    goalEn: 'A narrower slit widens the central lobe. Huygens sum inside the opening, not a geometric shadow.',
  },
  {
    id: 'triple-slit',
    group: 'wave',
    label: '三缝干涉',
    labelEn: 'Triple slit',
    blurb: '三缝 · 主极大之间有次极大',
    blurbEn: 'Three slits · secondary maxima',
    goal: 'N=3 时主极大之间出现较弱次极大，是光栅的教学中间步。',
    goalEn: 'For N=3 a weaker secondary maximum sits between principals — the teaching step toward a grating.',
  },
  {
    id: 'diffraction-grating',
    group: 'wave',
    label: '多缝衍射光栅',
    labelEn: 'Diffraction grating',
    blurb: '五缝 · 主极大更锐',
    blurbEn: 'Five slits · sharper principal maxima',
    goal: '缝数增多时主极大变细。仍是标量惠更斯，不做闪耀效率。',
    goalEn: 'More slits sharpen principal maxima. Scalar Huygens only; no blaze efficiency.',
  },
  {
    id: 'lloyd-mirror',
    group: 'wave',
    label: '劳埃德镜',
    labelEn: "Lloyd's mirror",
    blurb: '实光源 + 镜面虚光源',
    blurbEn: 'Real source + virtual image',
    goal: '反射带 π 相位，镜面处是暗纹。条纹仍 ≈ λD/d，d 是实源到虚源的距离。',
    goalEn: 'Reflection adds a π phase, so the fringe on the mirror is dark. Spacing is still ≈ λD/d with d the real–virtual separation.',
  },
  {
    id: 'fresnel-biprism',
    group: 'wave',
    label: '菲涅耳双棱镜',
    labelEn: 'Fresnel biprism',
    blurb: '两半棱镜形成两个虚光源',
    blurbEn: 'Two prism halves, two virtual sources',
    goal: '不靠狭缝，靠折射造出两个相干虚源。几何光线走棱镜，条纹仍是惠更斯双源。',
    goalEn: 'Two coherent virtual sources from refraction, not slits. Rays show the prism; fringes are still two-source Huygens.',
  },
  {
    id: 'knife-edge',
    group: 'wave',
    label: '直边衍射',
    labelEn: 'Knife-edge diffraction',
    blurb: '半无限挡板 · 几何影里有光',
    blurbEn: 'Half-plane · light in the geometric shadow',
    goal: '开口一侧的惠更斯源在几何影区仍有振荡。不是锐截止的影子。',
    goalEn: 'Huygens sources along the open half-plane oscillate into the geometric shadow. The edge is not a sharp cutoff.',
  },
  {
    id: 'poisson-spot',
    group: 'wave',
    label: '小障碍衍射',
    labelEn: 'Obstacle diffraction',
    blurb: '细挡板影心偏亮（二维泊松亮线）',
    blurbEn: 'Bright line in the 2D shadow (Arago analog)',
    goal: '两侧边缘子波在影轴等光程相长。三维圆屏才是泊松亮斑；这里是二维亮线。',
    goalEn: 'Edge wavelets are in phase on the shadow axis. The 3D Arago spot is a circular obstacle; this 2D analog is a bright line.',
  },
  {
    id: 'mach-zehnder',
    group: 'wave',
    label: '马赫–曾德干涉仪',
    labelEn: 'Mach–Zehnder interferometer',
    blurb: '双分束 + 双臂镜 · 两路输出',
    blurbEn: 'Two splitters + two arm mirrors · two outputs',
    goal: '几何光线走完整矩形回路，两路输出屏都亮。惠更斯模型用合束镜两臂上的虚源叠加出条纹。',
    goalEn: 'Rays complete the rectangular loop and both output ports light up. The Huygens model superposes one virtual source per arm at the combiner.',
  },
  {
    id: 'newton-rings',
    group: 'wave',
    label: '楔形膜等厚干涉',
    labelEn: 'Newton-wedge fringes',
    blurb: '两板夹出空气楔 · 等厚条纹',
    blurbEn: 'Air wedge between plates · equal-thickness fringes',
    goal: '接触端是暗纹（半波损失），厚度每增 λ/2 多一条纹。二维楔形膜是牛顿环的截面类比。',
    goalEn: 'The contact edge is dark (half-wave loss); each extra λ/2 of thickness adds a band. The 2D wedge is the cross-section analog of Newton rings.',
  },
  {
    id: 'fabry-perot',
    group: 'wave',
    label: '法布里–珀罗腔',
    labelEn: 'Fabry–Pérot cavity',
    blurb: '平行高反腔镜 · 透射等倾条纹',
    blurbEn: 'Parallel high-R plates · equal-inclination fringes',
    goal: '腔内多次反射在事件栏留下一串分束事件；惠更斯模型等效为衰减虚源串，屏上见等倾条纹。',
    goalEn: 'Cavity round trips fill the event log with split events; the Huygens model is a decaying virtual-source train giving equal-inclination fringes.',
  },
  {
    id: 'michelson-wave',
    group: 'wave',
    label: '迈克尔逊干涉',
    labelEn: 'Michelson interference',
    blurb: '分束两臂回程 · 屏上等效双源条纹',
    blurbEn: 'Two returning arms · two-source fringes',
    goal: '与几何版同一光路，但干涉屏改用惠更斯叠加：每臂一个虚源，相位含 2×臂长。移动端镜 λ/4 条纹反相。',
    goalEn: 'Same arms as the geometric layout, but the detector uses Huygens superposition: one virtual source per arm phased by 2× arm length. Slide an end mirror λ/4 to invert the fringes.',
  },
  {
    id: 'zone-plate',
    group: 'wave',
    label: '菲涅耳波带片',
    labelEn: 'Fresnel zone plate',
    blurb: '半波带通光片 · 轴向聚焦',
    blurbEn: 'Half-wave zones · axial focus',
    goal: '只开放偶数半波带，各带子波在焦点同相叠加成亮斑。几何光线只穿过透明带；焦斑来自惠更斯叠加。',
    goalEn: 'Only the even half-wave zones are open, so their wavelets add in phase at the focus. Rays just pass the clear zones; the focal spot is Huygens superposition.',
  },
  {
    id: 'empty',
    group: 'geometry',
    label: '空白台',
    labelEn: 'Empty bench',
    blurb: '自由搭建',
    blurbEn: 'Free build',
    goal: '从元件库添加器件',
    goalEn: 'Add components from the palette',
  },
]

/** Experiment checklist helpers. */
export function experimentHints(
  presetId: OpticsPresetId | undefined,
  locale: 'zh' | 'en' = 'zh',
): string[] {
  const p = OPTICS_PRESETS.find((x) => x.id === presetId)
  const zh = locale === 'zh'
  if (!p?.goal) {
    return zh
      ? ['拖拽元件 · 右侧调参 · 观察光线与事件日志']
      : ['Drag components · edit on the right · watch rays & events']
  }
  const goal = zh ? p.goal : (p.goalEn ?? p.goal)
  const tips = zh
    ? 'Delete 删除选中 · ←→ 旋转 · ↑↓ 微调位置'
    : 'Delete removes selection · ←→ rotate · ↑↓ nudge'
  return [goal, tips]
}
