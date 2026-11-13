/**
 * Radix-2 Cooley–Tukey FFT · complex length N=2^p (teaching stub).
 * In-place butterfly + bit-reversal; matches naive DFT within tol;
 * inverse round-trip. Parent family method-fft (not spectral).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · FFT (standalone; not method-spectral-method). */
export const METHOD_FFT = 'method-fft'

/** Algo · radix-2 Cooley–Tukey. */
export const METHOD_ALGO_FFT_RADIX2 = 'method-algo-fft-radix2'

/** Parent alias (aligns with familyId). */
export const FFT_PARENT = METHOD_FFT

export const FFT_METHOD_IDS = [METHOD_ALGO_FFT_RADIX2] as const

/** Teaching max length for naive DFT cross-check. */
export const FFT_MAX_N = 256

/** N is power of two and ≥ 2. */
export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0
}

/** log2(n) for n = 2^p, p ≥ 1. */
export function log2Pow2(n: number): number {
  if (!isPowerOfTwo(n)) throw new Error('log2Pow2: need power-of-2 ≥ 2')
  let p = 0
  let v = n
  while (v > 1) {
    v >>= 1
    p++
  }
  return p
}

/**
 * Bit-reverse permutation in place (re, im equal length N=2^p).
 */
export function bitReversePermute(
  re: Float64Array,
  im: Float64Array,
): void {
  const n = re.length
  if (im.length !== n || !isPowerOfTwo(n)) {
    throw new Error('bitReversePermute: length power-of-2 match')
  }
  const bits = log2Pow2(n)
  for (let i = 0; i < n; i++) {
    let j = 0
    let x = i
    for (let b = 0; b < bits; b++) {
      j = (j << 1) | (x & 1)
      x >>= 1
    }
    if (j > i) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
}

/**
 * In-place radix-2 Cooley–Tukey FFT.
 * sign = −1 forward (DFT convention X[k]=Σ x exp(−2π i k n / N)),
 * sign = +1 inverse without 1/N (caller scales).
 * Mutates re, im.
 */
export function fftRadix2InPlace(
  re: Float64Array,
  im: Float64Array,
  sign: -1 | 1 = -1,
): void {
  const n = re.length
  if (im.length !== n) throw new Error('fftRadix2InPlace: length mismatch')
  if (!isPowerOfTwo(n)) throw new Error('fftRadix2InPlace: N must be 2^p ≥ 2')
  if (n > FFT_MAX_N) throw new Error(`fftRadix2InPlace: N ≤ ${FFT_MAX_N}`)

  bitReversePermute(re, im)

  // stages: len = 2, 4, ..., n
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang0 = (sign * 2 * Math.PI) / len
    // twiddle w = exp(i · ang0 · k) stepped via recurrence
    for (let start = 0; start < n; start += len) {
      let wr = 1
      let wi = 0
      const c = Math.cos(ang0)
      const s = Math.sin(ang0)
      for (let k = 0; k < half; k++) {
        const i0 = start + k
        const i1 = i0 + half
        const tr = wr * re[i1]! - wi * im[i1]!
        const ti = wr * im[i1]! + wi * re[i1]!
        const ur = re[i0]!
        const ui = im[i0]!
        re[i0] = ur + tr
        im[i0] = ui + ti
        re[i1] = ur - tr
        im[i1] = ui - ti
        // w *= exp(i ang0)
        const nwr = wr * c - wi * s
        wi = wr * s + wi * c
        wr = nwr
      }
    }
  }
}

/**
 * Out-of-place forward FFT (copies input, does not mutate).
 * Returns new re/im of length N.
 */
export function fftRadix2(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (im.length !== n) throw new Error('fftRadix2: length mismatch')
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    outRe[i] = re[i]!
    outIm[i] = im[i]!
  }
  fftRadix2InPlace(outRe, outIm, -1)
  return { re: outRe, im: outIm }
}

/**
 * Out-of-place inverse FFT with 1/N scaling.
 */
export function ifftRadix2(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (im.length !== n) throw new Error('ifftRadix2: length mismatch')
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    outRe[i] = re[i]!
    outIm[i] = im[i]!
  }
  fftRadix2InPlace(outRe, outIm, +1)
  const inv = 1 / n
  for (let i = 0; i < n; i++) {
    outRe[i]! *= inv
    outIm[i]! *= inv
  }
  return { re: outRe, im: outIm }
}

/**
 * Naive complex DFT: X[k]=Σ_n x[n] exp(−2π i k n / N).
 * Reference for FFT accuracy tests.
 */
export function dftComplexNaive(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (n < 2 || im.length !== n) {
    throw new Error('dftComplexNaive: length mismatch / need ≥ 2')
  }
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let rk = 0
    let ik = 0
    for (let j = 0; j < n; j++) {
      const ang = (-2 * Math.PI * k * j) / n
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const xr = re[j]!
      const xi = im[j]!
      rk += xr * c - xi * s
      ik += xr * s + xi * c
    }
    outRe[k] = rk
    outIm[k] = ik
  }
  return { re: outRe, im: outIm }
}

/** max |u_i − v_i| over complex pairs (re/im). */
export function maxAbsDiffComplex(
  aRe: ArrayLike<number>,
  aIm: ArrayLike<number>,
  bRe: ArrayLike<number>,
  bIm: ArrayLike<number>,
): number {
  const n = aRe.length
  if (aIm.length !== n || bRe.length !== n || bIm.length !== n) {
    throw new Error('maxAbsDiffComplex: length mismatch')
  }
  let m = 0
  for (let i = 0; i < n; i++) {
    const er = Math.abs(aRe[i]! - bRe[i]!)
    const ei = Math.abs(aIm[i]! - bIm[i]!)
    if (er > m) m = er
    if (ei > m) m = ei
  }
  return m
}

/**
 * Representative sample: FFT vs naive DFT + inverse round-trip.
 * Parent family method-fft.
 */
export function runFftRadix2Sample(opts?: {
  /** length, power of 2, default 32 */
  N?: number
  /** bin for pure tone test */
  k0?: number
}): {
  N: number
  k0: number
  dftMaxErr: number
  roundTripMaxErr: number
  /** |X[k0]| peak (real cosine → real-ish bin) */
  peakMag: number
  peakK: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FFT_RADIX2
  familyId: typeof METHOD_FFT
} {
  const N = opts?.N ?? 32
  const k0 = opts?.k0 ?? 3
  if (!isPowerOfTwo(N) || N > FFT_MAX_N) {
    throw new Error(`runFftRadix2Sample: need power-of-2 2…${FFT_MAX_N}`)
  }
  if (!(k0 >= 1 && k0 < N / 2)) {
    throw new Error('runFftRadix2Sample: k0 in 1..N/2−1')
  }

  // complex signal: cos + i sin at bin k0, plus small DC and noise-like ramp
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    const ang = (2 * Math.PI * k0 * n) / N
    re[n] = Math.cos(ang) + 0.1 + 0.01 * n
    im[n] = Math.sin(ang) - 0.05 * Math.cos((2 * Math.PI * 2 * n) / N)
  }

  const naive = dftComplexNaive(re, im)
  const fft = fftRadix2(re, im)
  const dftMaxErr = maxAbsDiffComplex(fft.re, fft.im, naive.re, naive.im)

  const back = ifftRadix2(fft.re, fft.im)
  const roundTripMaxErr = maxAbsDiffComplex(back.re, back.im, re, im)

  let peakK = 0
  let peakMag = 0
  let finite = true
  for (let k = 0; k < N; k++) {
    const mr = fft.re[k]!
    const mi = fft.im[k]!
    if (!Number.isFinite(mr) || !Number.isFinite(mi)) finite = false
    const mag = Math.hypot(mr, mi)
    if (mag > peakMag) {
      peakMag = mag
      peakK = k
    }
  }

  const ok =
    dftMaxErr < 1e-9 &&
    roundTripMaxErr < 1e-10 &&
    peakK === k0 &&
    peakMag > N * 0.5 &&
    finite

  return {
    N,
    k0,
    dftMaxErr,
    roundTripMaxErr,
    peakMag,
    peakK,
    finite,
    ok,
    methodId: METHOD_ALGO_FFT_RADIX2,
    familyId: METHOD_FFT,
  }
}
