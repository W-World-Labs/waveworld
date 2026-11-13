/**
 * 1D homogenization · effective conductivity (series / parallel).
 * Series (harmonic): 1/k_eff = Σ v_i/k_i
 * Parallel (arithmetic): k_eff = Σ v_i k_i
 * Volume fractions v_i ≥ 0, Σ v_i = 1.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · 1D homogenization / effective medium. */
export const METHOD_HOMOGENIZATION = 'method-homogenization'

/** Algo · series (harmonic-mean) effective conductivity. */
export const METHOD_ALGO_HOMOG_SERIES = 'method-algo-homog-series'

/** Algo · parallel (arithmetic-mean) effective conductivity. */
export const METHOD_ALGO_HOMOG_PARALLEL = 'method-algo-homog-parallel'

/** Parent alias (aligns with familyId). */
export const HOMOG_PARENT = METHOD_HOMOGENIZATION

export const HOMOG_METHOD_IDS = [
  METHOD_ALGO_HOMOG_SERIES,
  METHOD_ALGO_HOMOG_PARALLEL,
] as const

/** One layer: conductivity k > 0 and volume fraction v ≥ 0. */
export type HomogLayer = {
  /** Thermal / electrical conductivity (positive). */
  k: number
  /** Volume (or thickness) fraction; layers should sum to ~1. */
  v: number
}

/** Default two-layer stack: soft + stiff, equal volume. */
export const DEFAULT_LAYERS: readonly HomogLayer[] = [
  { k: 1, v: 0.5 },
  { k: 10, v: 0.5 },
]

/** Sum of volume fractions. */
export function volumeSum(layers: readonly HomogLayer[]): number {
  let s = 0
  for (const L of layers) s += L.v
  return s
}

/**
 * Validate layers: finite, k > 0, v ≥ 0, at least one layer, Σv ≈ 1.
 * Throws on hard errors; returns normalized copy when Σv is off but positive.
 */
export function normalizeLayers(
  layers: readonly HomogLayer[],
  tol = 1e-9,
): HomogLayer[] {
  if (!layers.length) throw new Error('layers must be non-empty')
  const out: HomogLayer[] = []
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]!
    if (!Number.isFinite(L.k) || L.k <= 0) {
      throw new Error(`layer ${i}: k must be finite and > 0`)
    }
    if (!Number.isFinite(L.v) || L.v < 0) {
      throw new Error(`layer ${i}: v must be finite and ≥ 0`)
    }
    out.push({ k: L.k, v: L.v })
  }
  const sum = volumeSum(out)
  if (!(sum > 0)) throw new Error('volume fractions must sum to > 0')
  if (Math.abs(sum - 1) > tol) {
    for (const L of out) L.v /= sum
  }
  return out
}

/**
 * Series (harmonic) effective conductivity:
 *   1/k_eff = Σ_i v_i / k_i
 * Heat/current through layers in series (1D stack).
 */
export function effectiveConductivitySeries(
  layers: readonly HomogLayer[],
): number {
  const L = normalizeLayers(layers)
  let inv = 0
  for (const layer of L) {
    inv += layer.v / layer.k
  }
  if (!(inv > 0) || !Number.isFinite(inv)) {
    throw new Error('series harmonic sum invalid')
  }
  return 1 / inv
}

/**
 * Parallel (arithmetic) effective conductivity:
 *   k_eff = Σ_i v_i k_i
 * Heat/current through layers side-by-side.
 */
export function effectiveConductivityParallel(
  layers: readonly HomogLayer[],
): number {
  const L = normalizeLayers(layers)
  let k = 0
  for (const layer of L) {
    k += layer.v * layer.k
  }
  if (!Number.isFinite(k) || k < 0) {
    throw new Error('parallel sum invalid')
  }
  return k
}

/**
 * Wiener bounds: for the same positive (k_i, v_i),
 * series (harmonic) ≤ parallel (arithmetic), with equality iff all k equal
 * (or a single effective phase).
 */
export function wienerBoundHolds(
  layers: readonly HomogLayer[],
  eps = 1e-12,
): boolean {
  const ks = effectiveConductivitySeries(layers)
  const kp = effectiveConductivityParallel(layers)
  return ks <= kp + eps
}

/** Single-phase: k_eff equals that k for both models. */
export function singlePhaseK(k: number): HomogLayer[] {
  return [{ k, v: 1 }]
}

/**
 * Representative series sample: harmonic mean of DEFAULT_LAYERS,
 * finite, positive, and ≤ parallel on the same stack.
 */
export function runHomogSeriesSample(
  opts: { layers?: readonly HomogLayer[] } = {},
): {
  layers: HomogLayer[]
  kSeries: number
  kParallel: number
  volumeSum: number
  /** series ≤ parallel (Wiener) */
  seriesLeqParallel: boolean
  /** matches closed form for two equal-v layers: 2/(1/k1+1/k2) */
  matchesTwoLayerHarmonic: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HOMOG_SERIES
  familyId: typeof METHOD_HOMOGENIZATION
} {
  const layers = normalizeLayers(opts.layers ?? DEFAULT_LAYERS)
  const kSeries = effectiveConductivitySeries(layers)
  const kParallel = effectiveConductivityParallel(layers)
  const vs = volumeSum(layers)
  const seriesLeqParallel = kSeries <= kParallel + 1e-12

  let matchesTwoLayerHarmonic = true
  if (layers.length === 2 && Math.abs(layers[0]!.v - 0.5) < 1e-12) {
    const k1 = layers[0]!.k
    const k2 = layers[1]!.k
    const closed = 2 / (1 / k1 + 1 / k2)
    matchesTwoLayerHarmonic = Math.abs(kSeries - closed) < 1e-12
  }

  const finite =
    Number.isFinite(kSeries) && Number.isFinite(kParallel) && kSeries > 0

  const ok =
    finite &&
    seriesLeqParallel &&
    matchesTwoLayerHarmonic &&
    Math.abs(vs - 1) < 1e-9

  return {
    layers,
    kSeries,
    kParallel,
    volumeSum: vs,
    seriesLeqParallel,
    matchesTwoLayerHarmonic,
    finite,
    ok,
    methodId: METHOD_ALGO_HOMOG_SERIES,
    familyId: METHOD_HOMOGENIZATION,
  }
}

/**
 * Representative parallel sample: arithmetic mean of DEFAULT_LAYERS,
 * finite, ≥ series on the same stack.
 */
export function runHomogParallelSample(
  opts: { layers?: readonly HomogLayer[] } = {},
): {
  layers: HomogLayer[]
  kSeries: number
  kParallel: number
  volumeSum: number
  seriesLeqParallel: boolean
  /** matches Σ v_i k_i for equal-v two-layer: (k1+k2)/2 */
  matchesTwoLayerArithmetic: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HOMOG_PARALLEL
  familyId: typeof METHOD_HOMOGENIZATION
} {
  const layers = normalizeLayers(opts.layers ?? DEFAULT_LAYERS)
  const kSeries = effectiveConductivitySeries(layers)
  const kParallel = effectiveConductivityParallel(layers)
  const vs = volumeSum(layers)
  const seriesLeqParallel = kSeries <= kParallel + 1e-12

  let matchesTwoLayerArithmetic = true
  if (layers.length === 2 && Math.abs(layers[0]!.v - 0.5) < 1e-12) {
    const closed = 0.5 * (layers[0]!.k + layers[1]!.k)
    matchesTwoLayerArithmetic = Math.abs(kParallel - closed) < 1e-12
  }

  const finite =
    Number.isFinite(kSeries) && Number.isFinite(kParallel) && kParallel > 0

  const ok =
    finite &&
    seriesLeqParallel &&
    matchesTwoLayerArithmetic &&
    Math.abs(vs - 1) < 1e-9

  return {
    layers,
    kSeries,
    kParallel,
    volumeSum: vs,
    seriesLeqParallel,
    matchesTwoLayerArithmetic,
    finite,
    ok,
    methodId: METHOD_ALGO_HOMOG_PARALLEL,
    familyId: METHOD_HOMOGENIZATION,
  }
}
