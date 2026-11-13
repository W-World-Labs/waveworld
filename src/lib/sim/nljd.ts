// Shockley-junction NLJD model; all numerical results come from W-Sim Rust/WASM.
// The kernel drives a real junction equivalent circuit — Is·(e^{v/(nVt)}−1) with
// series Rs and parallel Cj — under a single-tone 915 MHz excitation, and
// measures the harmonic spectrum of the junction current by direct DFT.
// The two readout slots a2/a3 carry the device parameters: a2 = Is (A),
// a3 = nVt (V). Verdicts are measured thresholds on computed f2/f1, f3/f1.
import { WasmNljd } from './wasm-fields'

export interface Harmonics { f1: number; f2: number; f3: number }
export type JunctionKind = 'semiconductor' | 'corrosion' | 'metal'
const KINDS: JunctionKind[] = ['semiconductor', 'corrosion', 'metal']
function kindId(kind: JunctionKind) {
  const id = KINDS.indexOf(kind)
  if (id < 0) throw new Error('Unknown junction kind')
  return id
}
function amplitudes(values: Float64Array, offset = 0): Harmonics {
  return { f1: values[offset], f2: values[offset + 1], f3: values[offset + 2] }
}
/** Static Shockley response i = isSat·(e^{v/nVt} − 1) of a single junction. */
export function diodeResponse(v: number, isSat: number, nVt: number): number {
  return new WasmNljd().response(v, isSat, nVt)
}
/** DFT-measured harmonics of a generic one-way junction (Is, nVt) under the standard drive. */
export function harmonicAmplitudes(isSat: number, nVt: number): Harmonics {
  return amplitudes(new WasmNljd().amplitudes(isSat, nVt))
}
/** Device parameters of a target kind: a2 = Is (A), a3 = nVt (V); metal has none. */
export function junctionCoefficients(kind: JunctionKind): { a2: number; a3: number } {
  const r = new WasmNljd().coefficients(kindId(kind))
  return { a2: r[0], a3: r[1] }
}
export function harmonics(kind: JunctionKind): Harmonics { return amplitudes(new WasmNljd().harmonics(kindId(kind))) }
export function classify(h: Harmonics): JunctionKind { return KINDS[new WasmNljd().classify(h.f1, h.f2, h.f3)] }

/** Illustration density is a view setting, not physical frequency. */
export function nljdResult(kind: JunctionKind, owner = new WasmNljd()) {
  const r = owner.result(kindId(kind))
  return { coefficients: { a2: r[0], a3: r[1] }, harmonics: amplitudes(r, 2), relative: amplitudes(r, 5),
    verdict: KINDS[r[8]], transfer: Array.from(owner.transfer) }
}
