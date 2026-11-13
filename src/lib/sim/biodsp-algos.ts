/**
 * 生物电 DSP 二级算法模块 · 去直流 / 滑动平均 / 工频陷波。
 * 对应 method-algo-biodsp-pipeline 下的 step 子节点；一律委托 biodsp.ts 纯函数，不重实现。
 */
import {
  amplify,
  mean,
  movingAverage,
  notch,
  powerAt,
  removeDC,
  variance,
} from './biodsp'

/** 二级管线父节点（未来挂 method-algo-biodsp-pipeline 子 step）。 */
export const BIO_DSP_PARENT = 'method-algo-biodsp-pipeline'

const FS = 1000

/** 合成：直流偏置 + 5 Hz 主信号 + 50 Hz 工频。 */
function makeBioSignal(n: number, fs = FS): number[] {
  const x = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const t = i / fs
    x[i] =
      2.0 +
      1.0 * Math.sin(2 * Math.PI * 5 * t) +
      0.8 * Math.sin(2 * Math.PI * 50 * t)
  }
  return x
}

/** 确定性伪随机 ∈ [-0.5, 0.5)。 */
function seededNoise(seed0: number): () => number {
  let seed = seed0
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
}

/**
 * 去直流样例：含偏置信号经 removeDC 后均值≈0；
 * 可选 amplify 后方差按 gain² 放大（shipped amplify/variance）。
 */
export function runRemoveDcSample(): {
  meanBefore: number
  meanAfter: number
  varRaw: number
  varAmplified: number
  gain: number
} {
  const x = makeBioSignal(2000)
  const meanBefore = mean(x)
  const y = removeDC(x)
  const gain = 100
  const amp = amplify(y, gain)
  return {
    meanBefore,
    meanAfter: mean(y),
    varRaw: variance(y),
    varAmplified: variance(amp),
    gain,
  }
}

/**
 * 滑动平均样例：以高频噪声为主的信号经 movingAverage 后方差明显下降。
 * （弱缓变分量保证非零均值功率，但噪声主导方差。）
 */
export function runMovingAverageSample(win = 21): {
  varBefore: number
  varAfter: number
  length: number
  win: number
} {
  const n = 1500
  const rnd = seededNoise(12345)
  const x = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    // 噪声主导：窗平滑应大幅压低方差（与 biodsp.test 同口径）
    x[i] = 0.1 * Math.sin((2 * Math.PI * 3 * i) / FS) + 0.8 * rnd()
  }
  const y = movingAverage(x, win)
  return {
    varBefore: variance(x),
    varAfter: variance(y),
    length: y.length,
    win,
  }
}

/**
 * 工频陷波样例：50 Hz 能量大幅衰减，5 Hz 主信号基本保留（shipped notch/powerAt）。
 */
export function runNotchSample(fs = FS): {
  pow50Before: number
  pow50After: number
  pow5Before: number
  pow5After: number
} {
  const x = makeBioSignal(2000, fs)
  const y = notch(x, fs, 50)
  return {
    pow50Before: powerAt(x, fs, 50),
    pow50After: powerAt(y, fs, 50),
    pow5Before: powerAt(x, fs, 5),
    pow5After: powerAt(y, fs, 5),
  }
}
