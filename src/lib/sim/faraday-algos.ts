/**
 * 法拉第感应方法 · 一级算法样例入口（纯函数）。
 * 对应 method-algo-faraday；委托 faraday.ts 核心，不重实现。
 */
import { WasmFaraday } from './wasm-fields'
import {
  emfFromFluxSeries,
  inducedEMF,
  motionalEMF,
  peakEMF,
  rotatingCoilEMF,
  rotatingCoilFlux,
} from './faraday'

/** 与 methods.data 对齐的算法节点 id。 */
export const FARADAY_METHOD_ID = 'method-algo-faraday'

/** 父族（集总电路族下的感应演示）。 */
export const FARADAY_PARENT = 'method-lumped-circuit'

/**
 * 法拉第–楞次感应样例：线性 dΦ/dt 与楞次符号。
 * ε = −N · dΦ/dt；dΦ/dt>0 ⇒ ε<0。
 */
export function runInducedEmfSample(): {
  emf: number
  dPhiDt: number
  N: number
  lenzSign: boolean
} {
  const dPhiDt = 2.5
  const N = 12
  const emf = inducedEMF(dPhiDt, N)
  return {
    emf,
    dPhiDt,
    N,
    lenzSign: emf < 0 && dPhiDt > 0,
  }
}

/**
 * 动生电动势样例：ε = B·L·v，对 v 线性。
 */
export function runMotionalEmfSample(): {
  e0: number
  e1: number
  e2: number
  B: number
  L: number
} {
  const B = 0.5
  const L = 0.2
  return {
    e0: motionalEMF(B, L, 0),
    e1: motionalEMF(B, L, 2),
    e2: motionalEMF(B, L, 4),
    B,
    L,
  }
}

/**
 * 旋转线圈样例：峰值 ε_peak = N·B·A·ω，磁通/EMF 相差 90°。
 * 同时用磁链序列数值差分对拍解析 EMF。
 */
export function runRotatingCoilSample(): {
  peak: number
  flux0: number
  emf0: number
  fluxQuarter: number
  emfQuarter: number
  numRelErrMax: number
} {
  const owner = new WasmFaraday()
  const N = 200
  const B = 0.3
  const A = 0.01
  const omega = 2 * Math.PI * 50
  const peak = peakEMF(N, B, A, omega, owner)
  const flux0 = rotatingCoilFlux(0, N, B, A, omega, owner)
  const emf0 = rotatingCoilEMF(0, N, B, A, omega, owner)
  const tQuarter = Math.PI / 2 / omega
  const fluxQuarter = rotatingCoilFlux(tQuarter, N, B, A, omega, owner)
  const emfQuarter = rotatingCoilEMF(tQuarter, N, B, A, omega, owner)

  // 短序列数值对拍
  const dt = 1e-5
  const n = 200
  const flux = Array.from({ length: n }, (_, i) =>
    rotatingCoilFlux(i * dt, N, B, A, omega, owner),
  )
  const emfNum = emfFromFluxSeries(flux, dt, 1, owner)
  let numRelErrMax = 0
  for (let i = 1; i < n - 1; i++) {
    const analytic = rotatingCoilEMF(i * dt, N, B, A, omega, owner)
    const rel = Math.abs(emfNum[i]! - analytic) / peak
    if (rel > numRelErrMax) numRelErrMax = rel
  }

  return {
    peak,
    flux0,
    emf0,
    fluxQuarter,
    emfQuarter,
    numRelErrMax,
  }
}

/**
 * 统一分发：法拉第方法代表样例（感应 EMF 为主入口）。
 */
export function runFaradaySample(): {
  induced: ReturnType<typeof runInducedEmfSample>
  motional: ReturnType<typeof runMotionalEmfSample>
  coil: ReturnType<typeof runRotatingCoilSample>
} {
  return {
    induced: runInducedEmfSample(),
    motional: runMotionalEmfSample(),
    coil: runRotatingCoilSample(),
  }
}
