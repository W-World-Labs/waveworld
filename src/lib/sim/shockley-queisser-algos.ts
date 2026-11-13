/**
 * Shockley–Queisser single-junction limit · pure teaching toy.
 * Approximate η(Eg) from blackbody detailed balance (de Vos undiluted)
 * or a stepwise AM1.5-like spectrum shell.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Shockley–Queisser detailed-balance limit. */
export const METHOD_SQ = 'method-shockley-queisser'

/** Algo · scan η vs bandgap Eg (blackbody / stepwise toy). */
export const METHOD_ALGO_SQ_LIMIT = 'method-algo-sq-limit'

/** Parent alias (aligns with familyId). */
export const SQ_PARENT = METHOD_SQ

export const SQ_METHOD_IDS = [METHOD_ALGO_SQ_LIMIT] as const

/** SI constants (local copies; algo is self-contained). */
export const H = 6.62607015e-34
export const C = 299792458
export const KB = 1.380649e-23
export const QE = 1.602176634e-19
export const SIGMA = 5.670374419e-8

/** Default sun / cell temperatures (K). */
export const TS_DEFAULT = 5778
export const TC_DEFAULT = 300

/**
 * Stepwise AM1.5-like toy bins: mid-energy (eV) + irradiance (W/m²).
 * IR-lightened so a simple radiative shell peaks near ~1.1–1.3 eV.
 */
export type SpectrumBin = { eV: number; power: number }

export const AM15_STEP_BINS: readonly SpectrumBin[] = [
  { eV: 0.6, power: 20 },
  { eV: 0.8, power: 45 },
  { eV: 0.95, power: 70 },
  { eV: 1.1, power: 95 },
  { eV: 1.2, power: 100 },
  { eV: 1.3, power: 95 },
  { eV: 1.4, power: 85 },
  { eV: 1.55, power: 70 },
  { eV: 1.75, power: 55 },
  { eV: 2.0, power: 40 },
  { eV: 2.3, power: 25 },
  { eV: 2.7, power: 12 },
  { eV: 3.2, power: 5 },
]

/** Incident power Pin = Σ power_i (W/m²). */
export function incidentPower(bins: readonly SpectrumBin[] = AM15_STEP_BINS): number {
  let p = 0
  for (const b of bins) p += b.power
  return p
}

/** Blackbody photon number spectral density b(E,T) [1/(m²·s·J)], E in J. */
export function planckPhotonFlux(E: number, T: number): number {
  if (!(E > 0) || !(T > 0)) return 0
  const x = E / (KB * T)
  const denom = Math.expm1(x)
  if (!Number.isFinite(denom) || denom <= 0) return 0
  return ((2 * Math.PI) / (H ** 3 * C ** 2)) * (E * E) / denom
}

/** Trapezoid ∫_a^b f dE. */
function integrate(f: (E: number) => number, a: number, b: number, n: number): number {
  if (!(b > a) || !(n >= 1)) return 0
  const h = (b - a) / n
  let s = 0.5 * (f(a) + f(b))
  for (let i = 1; i < n; i++) s += f(a + i * h)
  return s * h
}

/** Photon flux ∫_Eg^∞ b(E,T) dE (tail cut at Eg+28 kT). */
export function photonFluxAbove(Eg: number, T: number, n = 400): number {
  const lo = Math.max(Eg, 1e-30)
  const top = lo + 28 * KB * T
  return integrate((E) => planckPhotonFlux(E, T), lo, top, n)
}

/**
 * Blackbody SQ efficiency at bandgap Eg (Joules):
 * max_V [ V · q · (N_abs − N0 exp(qV/kTc)) ] / (σ Ts⁴)
 * Coarse V scan — teaching toy, not publication-grade quadrature.
 */
export function sqEtaBlackbody(
  Eg_J: number,
  Ts = TS_DEFAULT,
  Tc = TC_DEFAULT,
  nFlux = 600,
  nV = 160,
): number {
  if (!(Eg_J > 0)) return 0
  const Nabs = photonFluxAbove(Eg_J, Ts, nFlux)
  const N0 = photonFluxAbove(Eg_J, Tc, nFlux)
  const Pin = SIGMA * Ts ** 4
  if (!(Pin > 0) || !(Nabs > 0)) return 0
  const Vmax = Eg_J / QE
  let best = 0
  for (let i = 1; i < nV; i++) {
    const V = (i / nV) * Vmax
    const J = QE * (Nabs - N0 * Math.exp((QE * V) / (KB * Tc)))
    if (J <= 0) continue
    const P = V * J
    if (P > best) best = P
  }
  const eta = best / Pin
  return Number.isFinite(eta) && eta > 0 ? eta : 0
}

/** Blackbody SQ η with Eg in eV. */
export function sqEtaBlackbody_eV(
  Eg_eV: number,
  Ts = TS_DEFAULT,
  Tc = TC_DEFAULT,
): number {
  return sqEtaBlackbody(Eg_eV * QE, Ts, Tc)
}

/** Photon flux of a stepwise bin (1/(m²·s)). */
export function binPhotonFlux(bin: SpectrumBin): number {
  if (!(bin.eV > 0) || !(bin.power >= 0)) return 0
  return bin.power / (bin.eV * QE)
}

/** Jsc (A/m²) for step-EQE absorption edge on stepwise bins. */
export function jscFromSpectrum(
  Eg_eV: number,
  bins: readonly SpectrumBin[] = AM15_STEP_BINS,
): number {
  if (!(Eg_eV > 0)) return 0
  let n = 0
  for (const b of bins) {
    if (b.eV + 1e-15 >= Eg_eV) n += binPhotonFlux(b)
  }
  return QE * n
}

/** Radiative dark current toy J0 ∝ exp(−Eg/kT) (A/m²). */
export function j0Radiative(Eg_eV: number, Tc = TC_DEFAULT, j00 = 1.2e7): number {
  if (!(Eg_eV > 0) || !(Tc > 0)) return Infinity
  const kT_eV = (KB * Tc) / QE
  return j00 * Math.exp(-Eg_eV / kT_eV)
}

/** Ideal-diode Voc (V), clamped to [0, Eg/q]. */
export function vocIdeal(
  Jsc: number,
  J0: number,
  Eg_eV: number,
  Tc = TC_DEFAULT,
): number {
  if (!(Jsc > 0) || !(J0 > 0)) return 0
  const kT_q = (KB * Tc) / QE
  const Voc = kT_q * Math.log(Jsc / J0 + 1)
  if (!Number.isFinite(Voc) || Voc < 0) return 0
  return Math.min(Voc, Eg_eV)
}

/** Green-style fill-factor toy from Voc / thermal voltage. */
export function fillFactor(Voc: number, Tc = TC_DEFAULT): number {
  if (!(Voc > 0)) return 0
  const vt = (KB * Tc) / QE
  const v = Voc / vt
  if (!(v > 1e-6)) return 0
  const ff0 = (v - Math.log(v + 0.72)) / (v + 1)
  if (!Number.isFinite(ff0)) return 0
  return Math.min(1, Math.max(0, ff0))
}

/** Stepwise-spectrum SQ-like η(Eg_eV) = Jsc·Voc·FF / Pin. */
export function sqEtaStepwise(
  Eg_eV: number,
  bins: readonly SpectrumBin[] = AM15_STEP_BINS,
  Tc = TC_DEFAULT,
): number {
  const Pin = incidentPower(bins)
  if (!(Pin > 0) || !(Eg_eV > 0)) return 0
  const Jsc = jscFromSpectrum(Eg_eV, bins)
  const J0 = j0Radiative(Eg_eV, Tc)
  const Voc = vocIdeal(Jsc, J0, Eg_eV, Tc)
  const FF = fillFactor(Voc, Tc)
  const eta = (Jsc * Voc * FF) / Pin
  return Number.isFinite(eta) && eta > 0 ? eta : 0
}

/** Default η(Eg_eV): blackbody detailed-balance toy. */
export function sqEta(Eg_eV: number, mode: 'blackbody' | 'stepwise' = 'blackbody'): number {
  return mode === 'stepwise' ? sqEtaStepwise(Eg_eV) : sqEtaBlackbody_eV(Eg_eV)
}

/**
 * Sweep Eg on a uniform grid; return max η and argmax.
 */
export function sweepSqEta(
  opts: {
    egMin?: number
    egMax?: number
    n?: number
    mode?: 'blackbody' | 'stepwise'
  } = {},
): {
  eg: Float64Array
  eta: Float64Array
  etaMax: number
  egOpt: number
  iMax: number
} {
  const egMin = opts.egMin ?? 0.6
  const egMax = opts.egMax ?? 2.2
  const n = opts.n ?? 33
  const mode = opts.mode ?? 'blackbody'
  if (!(n >= 2) || !(egMax > egMin)) {
    throw new Error('sweepSqEta: need n≥2 and egMax>egMin')
  }
  const eg = new Float64Array(n)
  const eta = new Float64Array(n)
  let etaMax = -1
  let egOpt = egMin
  let iMax = 0
  for (let i = 0; i < n; i++) {
    const e = egMin + ((egMax - egMin) * i) / (n - 1)
    const h = sqEta(e, mode)
    eg[i] = e
    eta[i] = h
    if (h > etaMax) {
      etaMax = h
      egOpt = e
      iMax = i
    }
  }
  return { eg, eta, etaMax, egOpt, iMax }
}

/**
 * Representative sample: blackbody SQ limit.
 * Expect max η loosely in the 1.1–1.4 eV bandgap window.
 */
export function runSqLimitSample(
  opts: {
    egMin?: number
    egMax?: number
    n?: number
    mode?: 'blackbody' | 'stepwise'
    egOptLo?: number
    egOptHi?: number
  } = {},
): {
  Pin: number
  etaMax: number
  egOpt: number
  etaLo: number
  etaMid: number
  etaHi: number
  unimodal: boolean
  egInWindow: boolean
  etaPlausible: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SQ_LIMIT
  familyId: typeof METHOD_SQ
} {
  const mode = opts.mode ?? 'blackbody'
  const egOptLo = opts.egOptLo ?? 1.0
  const egOptHi = opts.egOptHi ?? 1.5
  const sw = sweepSqEta({
    egMin: opts.egMin ?? 0.6,
    egMax: opts.egMax ?? 2.2,
    n: opts.n ?? 33,
    mode,
  })
  const Pin =
    mode === 'stepwise'
      ? incidentPower()
      : SIGMA * TS_DEFAULT ** 4
  const etaLo = sqEta(0.7, mode)
  const etaMid = sqEta(1.2, mode)
  const etaHi = sqEta(2.0, mode)
  const unimodal = etaMid > etaLo && etaMid > etaHi
  const egInWindow = sw.egOpt >= egOptLo && sw.egOpt <= egOptHi
  // Undiluted blackbody SQ ~0.40–0.42; stepwise toy lower — keep loose.
  const etaPlausible =
    mode === 'blackbody'
      ? sw.etaMax > 0.30 && sw.etaMax < 0.50
      : sw.etaMax > 0.12 && sw.etaMax < 0.45
  const finite =
    Number.isFinite(sw.etaMax) &&
    Number.isFinite(sw.egOpt) &&
    Number.isFinite(etaLo) &&
    Number.isFinite(etaMid) &&
    Number.isFinite(etaHi) &&
    Number.isFinite(Pin)
  const ok = finite && unimodal && egInWindow && etaPlausible && sw.etaMax > 0

  return {
    Pin,
    etaMax: sw.etaMax,
    egOpt: sw.egOpt,
    etaLo,
    etaMid,
    etaHi,
    unimodal,
    egInWindow,
    etaPlausible,
    finite,
    ok,
    methodId: METHOD_ALGO_SQ_LIMIT,
    familyId: METHOD_SQ,
  }
}
