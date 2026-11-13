/**
 * 显示光电 · LED/OLED/LCD 方法族 · 纯函数子算法入口。
 * 对应 method-display-opto：带隙→波长、马吕斯调制、可见光谱 RGB、OLED 混色。
 * 不编辑 methods.data；仅挂 DISPLAY_PARENT id 与真实 display 核心对接。
 */

import {
  bandgapToWavelength,
  wavelengthToBandgap,
  wavelengthToRGB,
  malus,
  mixRGB,
} from './display'

export const DISPLAY_PARENT = 'method-display-opto'

/** 与目录/注册表对齐的算法键（纯代码侧；methods.data 可后续挂接）。 */
export type DisplayAlgoId = 'bandgap-wl' | 'malus-lcd' | 'visible-rgb' | 'oled-mix'

export const DISPLAY_ALGO_METHOD_IDS: Record<DisplayAlgoId, string> = {
  'bandgap-wl': 'method-algo-display-bandgap',
  'malus-lcd': 'method-algo-display-malus',
  'visible-rgb': 'method-algo-display-rgb',
  'oled-mix': 'method-algo-display-oled-mix',
}

/**
 * LED 带隙样例：Eg=1.8 eV → λ≈689 nm；往返互逆。
 */
export function runBandgapSample(EgEv = 1.8): {
  EgEv: number
  nm: number
  EgBack: number
  roundtripNm: number
} {
  const nm = bandgapToWavelength(EgEv)
  const EgBack = wavelengthToBandgap(nm)
  const roundtripNm = bandgapToWavelength(wavelengthToBandgap(nm))
  return { EgEv, nm, EgBack, roundtripNm }
}

/**
 * LCD 马吕斯样例：θ=0 透过最大，θ=90 交叉消光 ≈0，θ=45 半功率。
 */
export function runMalusSample(I0 = 1): {
  I0: number
  I0deg: number
  I45: number
  I90: number
} {
  return {
    I0,
    I0deg: malus(I0, 0),
    I45: malus(I0, 45),
    I90: malus(I0, 90),
  }
}

/**
 * 可见光光谱 RGB：绿光 ~550 nm 的 G 通道应主导。
 */
export function runVisibleRgbSample(nm = 550): {
  nm: number
  rgb: [number, number, number]
  r: number
  g: number
  b: number
} {
  const rgb = wavelengthToRGB(nm)
  return { nm, rgb, r: rgb[0], g: rgb[1], b: rgb[2] }
}

/**
 * OLED 子像素加法混色（mixRGB）：白/黑/钳位代表样例。
 */
export function runOledMixSample(): {
  white: [number, number, number]
  black: [number, number, number]
  clamped: [number, number, number]
} {
  return {
    white: mixRGB(1, 1, 1),
    black: mixRGB(0, 0, 0),
    clamped: mixRGB(2, -1, 0.5),
  }
}

/** 统一分发：按子算法 id 跑代表样例。 */
export function runDisplayAlgo(id: DisplayAlgoId): unknown {
  switch (id) {
    case 'bandgap-wl':
      return runBandgapSample()
    case 'malus-lcd':
      return runMalusSample()
    case 'visible-rgb':
      return runVisibleRgbSample()
    case 'oled-mix':
      return runOledMixSample()
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}
