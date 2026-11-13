// 显示与发光原理三合一 · 纯函数物理核心
// LED：电子-空穴复合越过带隙发光，光子能量 = 带隙 Eg，λ(nm)=1240/Eg(eV)
// OLED：有机激子复合，RGB 自发光子像素（混色见 mixRGB）
// LCD：非自发光，背光经偏振片 + 液晶旋光，按马吕斯定律调制亮度

/** 带隙(eV) → 发光波长(nm)。λ = hc/Eg ≈ 1240/Eg。 */
export function bandgapToWavelength(EgEv: number): number {
  return 1240 / EgEv
}

/** 发光波长(nm) → 带隙(eV)（逆运算）。 */
export function wavelengthToBandgap(nm: number): number {
  return 1240 / nm
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))

/**
 * 可见光波长(nm) → 近似 RGB(0..255)。
 * 经典 Bruton 算法：380..750nm 分段线性 + 端部强度衰减（gamma 0.8）。
 * 可见区外返回黑色 [0,0,0]。
 */
export function wavelengthToRGB(nm: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0

  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380)
    b = 1
  } else if (nm >= 440 && nm < 490) {
    g = (nm - 440) / (490 - 440)
    b = 1
  } else if (nm >= 490 && nm < 510) {
    g = 1
    b = -(nm - 510) / (510 - 490)
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510)
    g = 1
  } else if (nm >= 580 && nm < 645) {
    r = 1
    g = -(nm - 645) / (645 - 580)
  } else if (nm >= 645 && nm <= 750) {
    r = 1
  }

  // 端部强度衰减
  let factor = 1
  if (nm >= 380 && nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / (420 - 380)
  else if (nm >= 420 && nm < 701) factor = 1
  else if (nm >= 701 && nm <= 750) factor = 0.3 + (0.7 * (750 - nm)) / (750 - 700)
  else if (nm < 380 || nm > 750) factor = 0

  const gamma = 0.8
  const adj = (c: number): number => (c === 0 ? 0 : 255 * Math.pow(c * factor, gamma))
  return [clamp255(adj(r)), clamp255(adj(g)), clamp255(adj(b))]
}

/** 马吕斯定律：入射线偏振与检偏轴夹角 θ，I=I0*cos²θ；I0 为进入检偏器前的强度。 */
export function malus(I0: number, angleDeg: number): number {
  const rad = (angleDeg * Math.PI) / 180
  const c = Math.cos(rad)
  return I0 * c * c
}

/**
 * RGB 子像素加法混色（OLED 自发光）：各通道权重 0..1，输出 0..255。
 * weights 三元素分别为 R/G/B 子像素强度。
 */
export function mixRGB(wR: number, wG: number, wB: number): [number, number, number] {
  return [clamp255(wR * 255), clamp255(wG * 255), clamp255(wB * 255)]
}

export type DisplayScene =
  | { mode: 'LED'; bandgap: number }
  | { mode: 'OLED'; channels: [number, number, number] }
  | { mode: 'LCD'; rotationDeg: number }

/** Static ideal relations; no time animation, semiconductor transport or LC dynamics. */
export function displayResult(scene: DisplayScene) {
  if (scene.mode === 'LED') {
    const wavelengthNm = bandgapToWavelength(scene.bandgap)
    return { mode: scene.mode, wavelengthNm, rgb: wavelengthToRGB(wavelengthNm), inColorRange: wavelengthNm >= 380 && wavelengthNm <= 750 }
  }
  if (scene.mode === 'OLED') {
    const [r, g, b] = scene.channels
    return { mode: scene.mode, rgb: mixRGB(r, g, b), subpixels: [mixRGB(r, 0, 0), mixRGB(0, g, 0), mixRGB(0, 0, b)] }
  }
  // Crossed polarizers: rotation=0 remains blocked; 90° aligns with the analyzer.
  const transmission = malus(1, 90 - scene.rotationDeg)
  const anglesDeg = Array.from({ length: 91 }, (_, i) => i)
  return {
    mode: scene.mode, transmission, rgb: mixRGB(transmission, transmission, transmission),
    anglesDeg, transmissions: anglesDeg.map(angle => malus(1, 90 - angle)),
  }
}
