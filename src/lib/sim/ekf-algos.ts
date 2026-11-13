/**
 * 扩展卡尔曼 EKF · 纯算法（1D 线性量测 z=x+noise；并包装 pf-algos 非线性 EKF）。
 * 对应 method-kalman-ekf / method-algo-kalman-1d / method-kalman。
 * 线性时 H=1，EKF 退化为标准卡尔曼；估计跟踪真值、P 收缩。
 * 不修改 methods.data。
 */

import {
  EKF_METHOD_ID as PF_EKF_METHOD_ID,
  EKF_PARENT as PF_EKF_PARENT,
  type Ekf1dState,
  ekfPredict as pfEkfPredict,
  ekfUpdate as pfEkfUpdate,
  runEkfSample as pfRunEkfSample,
} from './pf-algos'

/** 父族 · 卡尔曼。 */
export const METHOD_KALMAN = 'method-kalman'
/** @deprecated alias */
export const EKF_PARENT = METHOD_KALMAN

/** 并行变体 · EKF。 */
export const METHOD_KALMAN_EKF = 'method-kalman-ekf'
export const EKF_METHOD_ID = METHOD_KALMAN_EKF

/** 线性 1D 子算法（与目录 method-algo-kalman-1d 对齐）。 */
export const METHOD_ALGO_KALMAN_1D = 'method-algo-kalman-1d'

/** EKF 雅可比线性化原子（目录 method-algo-ekf-linear）。 */
export const METHOD_ALGO_EKF_LINEAR = 'method-algo-ekf-linear'

/** 再导出 pf-algos 非线性 EKF 符号，便于 registry / 对拍。 */
export {
  PF_EKF_METHOD_ID,
  PF_EKF_PARENT,
  type Ekf1dState,
  pfEkfPredict,
  pfEkfUpdate,
  pfRunEkfSample,
}

export type EkfLinearState = { x: number; P: number }

/**
 * 线性预测：x⁻ = F x，P⁻ = F P F + Q。
 * （EKF 在 f 为线性时 F=∂f/∂x 为常数。）
 */
export function ekfLinearPredict(s: EkfLinearState, F: number, Q: number): EkfLinearState {
  return { x: F * s.x, P: F * s.P * F + Q }
}

/**
 * 线性更新（量测 z = H x + v）：标准卡尔曼增益。
 * 对 z=x+noise 取 H=1。
 */
export function ekfLinearUpdate(
  s: EkfLinearState,
  z: number,
  H: number,
  R: number,
): EkfLinearState {
  const y = z - H * s.x
  const S = H * s.P * H + R
  if (!(S > 0)) throw new Error('EKF innovation covariance must be positive')
  const K = (s.P * H) / S
  return {
    x: s.x + K * y,
    P: (1 - K * H) * s.P,
  }
}

/**
 * 一般 1D EKF 预测：x⁻=f(x)，P⁻=F P F + Q，F=∂f/∂x。
 */
export function ekfPredictGeneral(
  s: EkfLinearState,
  f: (x: number) => number,
  F: number,
  Q: number,
): EkfLinearState {
  return { x: f(s.x), P: F * s.P * F + Q }
}

/**
 * 一般 1D EKF 更新：h(x)，H=∂h/∂x。
 */
export function ekfUpdateGeneral(
  s: EkfLinearState,
  z: number,
  h: (x: number) => number,
  H: number,
  R: number,
): EkfLinearState {
  const y = z - h(s.x)
  const S = H * s.P * H + R
  if (!(S > 0)) throw new Error('EKF innovation covariance must be positive')
  const K = (s.P * H) / S
  return {
    x: s.x + K * y,
    P: (1 - K * H) * s.P,
  }
}

/**
 * 1D 线性 EKF 样例：常值状态真值 trueX，量测 z=x+噪声（确定性小扰动）。
 * 多步后 |est−true| 小于先验误差，P 单调不增于 P0。
 */
export function runEkfLinearSample(
  opts: {
    steps?: number
    trueX?: number
    x0?: number
    P0?: number
    Q?: number
    R?: number
    F?: number
    H?: number
  } = {},
): {
  estimate: number
  trueX: number
  err: number
  priorErr: number
  P: number
  P0: number
  improved: boolean
  Pshrunk: boolean
  methodId: typeof METHOD_KALMAN_EKF
  familyId: typeof METHOD_KALMAN
  algoId: typeof METHOD_ALGO_KALMAN_1D
} {
  const steps = opts.steps ?? 30
  const trueX = opts.trueX ?? 4
  const F = opts.F ?? 1
  const H = opts.H ?? 1
  const Q = opts.Q ?? 1e-6
  const R = opts.R ?? 0.25
  let s: EkfLinearState = {
    x: opts.x0 ?? 0,
    P: opts.P0 ?? 1,
  }
  const P0 = s.P
  const priorErr = Math.abs(s.x - trueX)

  for (let t = 0; t < steps; t++) {
    s = ekfLinearPredict(s, F, Q)
    // 确定性伪噪声：幅度 √R 的小正弦，可复现
    const z = trueX + Math.sqrt(R) * 0.05 * Math.sin(t + 0.3)
    s = ekfLinearUpdate(s, z, H, R)
  }

  const err = Math.abs(s.x - trueX)
  return {
    estimate: s.x,
    trueX,
    err,
    priorErr,
    P: s.P,
    P0,
    improved: err < priorErr,
    Pshrunk: s.P < P0,
    methodId: METHOD_KALMAN_EKF,
    familyId: METHOD_KALMAN,
    algoId: METHOD_ALGO_KALMAN_1D,
  }
}

/**
 * 包装 pf-algos 非线性 z=x² EKF 样例（并立校验）。
 */
export function runEkfNonlinearSample(steps = 25) {
  return pfRunEkfSample(steps)
}

/**
 * EKF 雅可比线性化原子：对 h(x)=x² 用 H=2x 做一步更新，P 收缩。
 */
export function runEkfJacobianSample(): {
  x0: number
  x1: number
  P0: number
  P1: number
  H: number
  Pshrunk: boolean
  methodId: typeof METHOD_ALGO_EKF_LINEAR
  familyId: typeof METHOD_KALMAN
} {
  const trueX = 2
  let s: EkfLinearState = { x: 1.2, P: 1 }
  const P0 = s.P
  const x0 = s.x
  // f=id → F=1；h=x² → H=2x
  s = ekfPredictGeneral(s, (x) => x, 1, 1e-6)
  const H = 2 * s.x
  s = ekfUpdateGeneral(s, trueX * trueX, (x) => x * x, H, 0.1)
  return {
    x0,
    x1: s.x,
    P0,
    P1: s.P,
    H,
    Pshrunk: s.P < P0,
    methodId: METHOD_ALGO_EKF_LINEAR,
    familyId: METHOD_KALMAN,
  }
}
