/**
 * Parabolic Equation (PE) · split-step Fourier (SSF) for range-marching
 * acoustics / EM envelopes.
 * Narrow-angle PE: ∂ψ/∂r = (i/(2k0)) ∂²ψ/∂z² + i k0 (n−1) ψ
 * SSF: half diffraction (Fourier) + phase refraction + half diffraction
 * (BPM-like form, range coordinate r, transverse z).
 * method id constants only — no methods.data / registry / edges.
 */

/** Parent family · parabolic equation. */
export const METHOD_PE = 'method-parabolic-equation'

/** Algorithm · split-step Fourier PE. */
export const METHOD_ALGO_PE_SSF = 'method-algo-pe-ssf'

export const PE_METHOD_IDS = [METHOD_ALGO_PE_SSF] as const

/** Complex field on a 1D transverse grid. */
export interface ComplexField1d {
  readonly n: number
  /** Transverse domain length L (periodic, z ∈ [−L/2, L/2)). */
  readonly L: number
  readonly dz: number
  readonly re: Float64Array
  readonly im: Float64Array
}

/**
 * Fourier transverse wavenumbers κ_m for physical length L.
 * m=0..n−1 maps to [−⌊(n−1)/2⌋ .. ⌊n/2⌋].
 */
export function transverseWaveNumbers(n: number, L: number): Float64Array {
  if (!(n >= 2) || !Number.isInteger(n)) {
    throw new Error('transverseWaveNumbers: n integer ≥ 2')
  }
  if (!(L > 0)) throw new Error('transverseWaveNumbers: L > 0')
  const kappa = new Float64Array(n)
  for (let m = 0; m < n; m++) {
    const k = m <= n / 2 ? m : m - n
    kappa[m] = (2 * Math.PI * k) / L
  }
  return kappa
}

/** Naive complex DFT: X[k]=Σ_n x[n] exp(−2π i k n / N). */
export function dftComplex1d(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (n < 2 || im.length !== n) throw new Error('dftComplex1d: length mismatch / need ≥ 2')
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

/** Inverse DFT with 1/N. */
export function idftComplex1d(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (n < 2 || im.length !== n) throw new Error('idftComplex1d: length mismatch / need ≥ 2')
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    let rj = 0
    let ij = 0
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k * j) / n
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const Xr = re[k]!
      const Xi = im[k]!
      rj += Xr * c - Xi * s
      ij += Xr * s + Xi * c
    }
    outRe[j] = rj / n
    outIm[j] = ij / n
  }
  return { re: outRe, im: outIm }
}

/**
 * PE diffraction half/full step in Fourier space (narrow-angle):
 * ψ̂(κ) ← ψ̂(κ) · exp(i · κ² · Δr / (2 k0))
 * e^{−iωt} convention; unitary → power conserved in free space.
 */
export function peDiffractionStep(
  re: Float64Array,
  im: Float64Array,
  L: number,
  k0: number,
  dr: number,
): void {
  if (!(k0 > 0)) throw new Error('peDiffractionStep: k0 > 0')
  const n = re.length
  if (im.length !== n) throw new Error('peDiffractionStep: length mismatch')
  const { re: Re, im: Im } = dftComplex1d(re, im)
  const kappa = transverseWaveNumbers(n, L)
  for (let m = 0; m < n; m++) {
    const κ = kappa[m]!
    // phase φ = + κ² dr / (2 k0)
    const phi = ((κ * κ) * dr) / (2 * k0)
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const ur = Re[m]!
    const ui = Im[m]!
    // exp(i φ) · (ur + i ui)
    Re[m] = ur * c - ui * s
    Im[m] = ur * s + ui * c
  }
  const inv = idftComplex1d(Re, Im)
  re.set(inv.re)
  im.set(inv.im)
}

/**
 * Refraction phase screen: ψ ← ψ · exp(i · k0 · (n−1) · dr).
 * deltaN[i] = n(z_i) − 1; missing / null → homogeneous (no phase).
 */
export function peRefractionPhase(
  re: Float64Array,
  im: Float64Array,
  k0: number,
  dr: number,
  deltaN?: ArrayLike<number> | null,
): void {
  if (!deltaN || deltaN.length !== re.length) return
  const n = re.length
  if (im.length !== n) throw new Error('peRefractionPhase: length mismatch')
  for (let i = 0; i < n; i++) {
    const phi = k0 * deltaN[i]! * dr
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const ur = re[i]!
    const ui = im[i]!
    // exp(i φ) · (ur + i ui)
    re[i] = ur * c - ui * s
    im[i] = ur * s + ui * c
  }
}

/**
 * Split-step Fourier PE one range step:
 * half diffraction → full refraction → half diffraction.
 * Homogeneous n≡1 (deltaN null) ≡ full diffraction step.
 */
export function splitStepPeSsf(
  re: Float64Array,
  im: Float64Array,
  L: number,
  k0: number,
  dr: number,
  deltaN?: ArrayLike<number> | null,
): void {
  const half = 0.5 * dr
  peDiffractionStep(re, im, L, k0, half)
  peRefractionPhase(re, im, k0, dr, deltaN)
  peDiffractionStep(re, im, L, k0, half)
}

/**
 * Transverse Gaussian beam: ψ(z) = A exp(−z²/w0²) (real initial envelope).
 */
export function createGaussianBeam1d(opts?: {
  n?: number
  L?: number
  w0?: number
  amp?: number
}): ComplexField1d {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 20
  const w0 = opts?.w0 ?? 1.2
  const amp = opts?.amp ?? 1
  if (!(n >= 8) || !Number.isInteger(n)) throw new Error('createGaussianBeam1d: n integer ≥ 8')
  if (!(L > 0) || !(w0 > 0)) throw new Error('createGaussianBeam1d: L,w0 > 0')
  const dz = L / n
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * dz - L / 2
    const r = z / w0
    re[i] = amp * Math.exp(-r * r)
    im[i] = 0
  }
  return { n, L, dz, re, im }
}

/** Power proxy P = Σ |ψ|² · dz. */
export function beamPower(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  dz: number,
): number {
  let s = 0
  const n = re.length
  for (let i = 0; i < n; i++) {
    const ur = re[i]!
    const ui = im[i]!
    s += ur * ur + ui * ui
  }
  return s * dz
}

/**
 * Intensity second-moment half-width:
 * w_rms = 2 √(⟨z²⟩ − ⟨z⟩²) ≈ w0 for |ψ|² ∝ exp(−2 z²/w0²).
 */
export function beamWidthRms(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  L: number,
): number {
  const n = re.length
  const dz = L / n
  let p = 0
  let mz = 0
  let mzz = 0
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * dz - L / 2
    const ur = re[i]!
    const ui = im[i]!
    const I = ur * ur + ui * ui
    p += I
    mz += I * z
    mzz += I * z * z
  }
  if (p <= 0) return 0
  mz /= p
  mzz /= p
  const varZ = Math.max(0, mzz - mz * mz)
  return 2 * Math.sqrt(varZ)
}

/** Rayleigh range z_R = k0 · w0² / 2. */
export function rayleighRange(k0: number, w0: number): number {
  return (k0 * w0 * w0) / 2
}

/**
 * Sample: free-space Gaussian advances in range via PE-SSF;
 * beam spreads (diffraction); power conserved loosely;
 * optional weak refractive screen still finite + power-safe.
 */
export function runPeSsfSample(opts?: {
  n?: number
  L?: number
  w0?: number
  k0?: number
  /** Total range (default ~ 1.5 z_R). */
  rTotal?: number
  steps?: number
  /** Weak quadratic index screen Δn ∝ −z². */
  withRefraction?: boolean
}): {
  n: number
  L: number
  w0: number
  k0: number
  rTotal: number
  steps: number
  zR: number
  width0: number
  widthF: number
  power0: number
  powerF: number
  widthGrew: boolean
  powerConserved: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PE_SSF
  familyId: typeof METHOD_PE
} {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 24
  const w0 = opts?.w0 ?? 1.5
  const k0 = opts?.k0 ?? 2 * Math.PI
  const zR = rayleighRange(k0, w0)
  const rTotal = opts?.rTotal ?? 1.5 * zR
  const steps = opts?.steps ?? 24
  const withRefraction = opts?.withRefraction ?? false

  const field = createGaussianBeam1d({ n, L, w0, amp: 1 })
  const { re, im, dz } = field
  const width0 = beamWidthRms(re, im, L)
  const power0 = beamPower(re, im, dz)

  const dr = rTotal / steps
  let deltaN: Float64Array | null = null
  if (withRefraction) {
    deltaN = new Float64Array(n)
    const alpha = 0.002 / (w0 * w0)
    for (let i = 0; i < n; i++) {
      const z = (i + 0.5) * dz - L / 2
      deltaN[i] = -alpha * z * z
    }
  }

  for (let s = 0; s < steps; s++) {
    splitStepPeSsf(re, im, L, k0, dr, deltaN)
  }

  const widthF = beamWidthRms(re, im, L)
  const powerF = beamPower(re, im, dz)

  let finite =
    Number.isFinite(width0) &&
    Number.isFinite(widthF) &&
    Number.isFinite(power0) &&
    Number.isFinite(powerF)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(re[i]!) || !Number.isFinite(im[i]!)) finite = false
  }

  const widthGrew = widthF > width0 * 1.05
  const powerConserved =
    Math.abs(powerF - power0) / Math.max(power0, 1e-30) < 0.02
  const ok =
    finite &&
    powerConserved &&
    (withRefraction ? widthF > 0 : widthF > width0 * 1.15)

  return {
    n,
    L,
    w0,
    k0,
    rTotal,
    steps,
    zR,
    width0,
    widthF,
    power0,
    powerF,
    widthGrew,
    powerConserved,
    finite,
    ok,
    methodId: METHOD_ALGO_PE_SSF,
    familyId: METHOD_PE,
  }
}
