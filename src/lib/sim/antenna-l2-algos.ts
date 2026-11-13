/**
 * 天线 / 链路二级算法 · 方向性、方向图峰值、Friis 距离律。
 * 委托 antennalink / antenna / antennatypes 纯核心；
 * method id 对齐 method-array-beamforming 子模块（不改 methods.data）。
 */
import {
  directivityDb,
  friisLink,
  pattern2D,
  type AntennaType,
} from './antennalink'
import { friisReceivedDbm, freeSpacePathLoss } from './antenna'
import { wavelength, ANTENNAS } from './antennatypes'
import { childrenOf } from '../../data/methods/methods'

/** 父族 · 相控阵 / 链路。 */
export const ANTENNA_L2_PARENT = 'method-array-beamforming'

/** 子模块 · 阵列因子。 */
export const ANTENNA_ARRAY_FACTOR_ID = 'method-algo-array-factor'

/** 子模块 · 方向图 / 波束宽度。 */
export const ANTENNA_PATTERN_ID = 'method-algo-array-pattern'

/** 子模块 · Friis 自由空间链路。 */
export const ANTENNA_FRIIS_ID = 'method-algo-friis-link'

/** 子模块 · 阵列方向图路径（与 Friis 并立）。 */
export const ANTENNA_PATTERN_VIEW_ID = 'method-algo-array-pattern-view'

export const ANTENNA_L2_METHOD_IDS = [
  ANTENNA_ARRAY_FACTOR_ID,
  ANTENNA_PATTERN_ID,
  ANTENNA_FRIIS_ID,
  ANTENNA_PATTERN_VIEW_ID,
] as const

/** 目录中 array 族子节点数量。 */
export function antennaChildCount(): number {
  return childrenOf(ANTENNA_L2_PARENT).length
}

// ═══════════════════════════════════════════════════════════════════════════
// Samples
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 方向性 dBi 样例：isotropic < dipole < directional。
 */
export function runDirectivitySample(): {
  iso: number
  dip: number
  dir: number
  ordered: boolean
  methodId: typeof ANTENNA_PATTERN_ID
} {
  const iso = directivityDb('isotropic')
  const dip = directivityDb('dipole')
  const dir = directivityDb('directional')
  return {
    iso,
    dip,
    dir,
    ordered: iso < dip && dip < dir,
    methodId: ANTENNA_PATTERN_ID,
  }
}

/**
 * 方向图 2D 峰值：dipole 在 θ=π/2，directional 在 θ=0，isotropic 恒 1。
 */
export function runPatternPeakSample(): {
  dipPeak: number
  dipAxis: number
  dirPeak: number
  dirBack: number
  iso: number
  methodId: typeof ANTENNA_PATTERN_VIEW_ID
} {
  return {
    dipPeak: pattern2D('dipole', Math.PI / 2),
    dipAxis: pattern2D('dipole', 0),
    dirPeak: pattern2D('directional', 0),
    dirBack: pattern2D('directional', Math.PI),
    iso: pattern2D('isotropic', 1.0),
    methodId: ANTENNA_PATTERN_VIEW_ID,
  }
}

/**
 * Friis 对距离：距离加倍 → FSPL +6 dB、Pr −6 dB（自由空间）。
 * 同时对照 antenna.friisReceivedDbm 与 antennalink.friisLink。
 */
export function runFriisVsDistanceSample(
  d0 = 10,
  freqHz = 2.4e9,
  ptDbm = 20,
  gtDbi = 2.15,
  grDbi = 2.15,
): {
  d0: number
  d1: number
  fspl0: number
  fspl1: number
  dFspl: number
  pr0: number
  pr1: number
  dPr: number
  prViaAntenna: number
  methodId: typeof ANTENNA_FRIIS_ID
} {
  const d1 = 2 * d0
  const a = friisLink(ptDbm, gtDbi, grDbi, freqHz, d0)
  const b = friisLink(ptDbm, gtDbi, grDbi, freqHz, d1)
  const prViaAntenna = friisReceivedDbm(ptDbm, gtDbi, grDbi, freqHz, d0)
  return {
    d0,
    d1,
    fspl0: a.fsplDb,
    fspl1: b.fsplDb,
    dFspl: b.fsplDb - a.fsplDb,
    pr0: a.prDbm,
    pr1: b.prDbm,
    dPr: a.prDbm - b.prDbm,
    prViaAntenna,
    methodId: ANTENNA_FRIIS_ID,
  }
}

/**
 * 图鉴波长样例：Wi-Fi 2.45 GHz 的 λ 与 c/f 一致（antennatypes 用 c=3e8）。
 */
export function runCatalogWavelengthSample(): {
  fHz: number
  lambda: number
  expected: number
  catalogId: string
  gainDbi: number
} {
  const entry = ANTENNAS.find((a) => a.id === 'wifi24')!
  const fHz = entry.fMHz * 1e6
  const lambda = wavelength(fHz)
  return {
    fHz,
    lambda,
    expected: 3e8 / fHz,
    catalogId: entry.id,
    gainDbi: entry.gainDbi,
  }
}

/** 导出类型再导出，便于 runner 标注。 */
export type { AntennaType }

/** FSPL 直通（便于测试 golden）。 */
export { freeSpacePathLoss }
