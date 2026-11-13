/** Exact module/selector pairs for native-only host-f64 operations. */
export const OPTICSTUDIO_NATIVE_OPERATIONS = [
  { module: 'abbe-number', key: 'operation', value: 'glass-partial-dispersion' },
  { module: 'beer-lambert', key: 'operation', value: 'material-transmission' },
  { module: 'bpm', key: 'operation', value: 'hard-aperture' },
  { module: 'bpm-l2', key: 'operation', value: 'gaussian-q' },
  { module: 'brewster-malus', key: 'operation', value: 'polarization-chain' },
  { module: 'cauchy-dispersion', key: 'selector', value: 'dispersion-curve' },
  { module: 'fabry-perot', key: 'methodId', value: 'method-algo-fp-spectrum' },
  { module: 'faraday-rotation', key: 'algo', value: 'method-algo-faraday-analyzer-transmission' },
  { module: 'fiber', key: 'methodId', value: 'method-algo-fiber-fresnel-interface' },
  { module: 'fresnel-snell', key: 'operation', value: 'fresnel-power-coefficients' },
  { module: 'goos-hanchen', key: 'operation', value: 'polarization-artmann' },
  { module: 'laser', key: 'operation', value: 'gaussian-beam-free-space' },
  { module: 'lens-design', key: 'method', value: 'geometric-ray-trace' },
  { module: 'mach-zehnder', key: 'operation', value: 'coherent-detection' },
  { module: 'michelson', key: 'algo', value: 'detector-line' },
  { module: 'mtf', key: 'operation', value: 'incoherent-lsf' },
  { module: 'numerical-aperture', key: 'operation', value: 'aperture-design' },
  { module: 'optics-l2', key: 'method', value: 'fresnel-oblique' },
  { module: 'sellmeier', key: 'method', value: 'method-algo-sellmeier-group-index' },
  { module: 'sellmeier', key: 'method', value: 'method-algo-sellmeier-n-multi' },
  { module: 'strehl', key: 'analysis', value: 'pupil-coherent-strehl' },
  { module: 'tmm', key: 'algo', value: 'fresnel-interface' },
  { module: 'young-grating', key: 'operation', value: 'coherent-grating-profile' },
  { module: 'zernike', key: 'operation', value: 'weighted-fit' },
] as const

/** CST entries are added from the finalized per-module wave metadata. */
export const CST_NATIVE_OPERATIONS = [
  { module: 'abcd-twoport', key: 'operation', value: 'cst-abcd-to-s' },
  { module: 'antenna-l2', key: 'operation', value: 'cst-array-factor' },
  { module: 'array', key: 'operation', value: 'cst-array-excitation-pattern' },
  { module: 'bioheat', key: 'operation', value: 'cst-rf-loss-heating' },
  { module: 'circuit', key: 'operation', value: 'cst-series-rlc-sweep' },
  { module: 'circuit-l2', key: 'operation', value: 'cst-series-rlc-reflection-sweep' },
  { module: 'cole-cole', key: 'operation', value: 'cst-cole-cole-complex-permittivity' },
  { module: 'coulomb-biot', key: 'operation', value: 'cst-finite-current-segment-field' },
  { module: 'debye-plasma', key: 'operation', value: 'cst-cold-plasma-dielectric' },
  { module: 'em-dispersive', key: 'operation', value: 'cst-dispersive-mur-open-line' },
  { module: 'em-eigenmode', key: 'operation', value: 'cst-epsilon-eigenmodes' },
  { module: 'em-fdtd-conformal-edges', key: 'operation', value: 'cst-conformal-permittivity-tensor' },
  { module: 'em-fdtd-graded-mesh', key: 'operation', value: 'cst-graded-mesh-quality' },
  { module: 'faraday', key: 'operation', value: 'cst-surface-flux-emf' },
  { module: 'fdtd', key: 'operation', value: 'cst-time-domain-sparams' },
  { module: 'fdtd-l2', key: 'operation', value: 'cst-tmz-power-flux-monitor' },
  { module: 'fdtd-l3', key: 'operation', value: 'cst-fdtd-field-monitor-spectrum' },
  { module: 'fdtd-l4', key: 'operation', value: 'cst-time-domain-port-s11' },
  { module: 'fem-edge', key: 'operation', value: 'cst-tet-epsilon-mass' },
  { module: 'fields', key: 'operation', value: 'cst-field-monitor-power' },
  { module: 'helmholtz', key: 'operation', value: 'cst-robin-boundary' },
  { module: 'impedance-match', key: 'operation', value: 'cst-quarter-wave-transformer' },
  { module: 'johnson-nyquist', key: 'operation', value: 'cst-thermal-noise-spectrum' },
  { module: 'larmor', key: 'operation', value: 'cst-cyclotron-orbit' },
  { module: 'lorentz-cyclotron', key: 'operation', value: 'cst-relativistic-cyclotron' },
  { module: 'mna', key: 'operation', value: 'cst-port-impedance-sweep' },
  { module: 'mna', key: 'method', value: 'method-algo-mna-ac' },
  { module: 'mna', key: 'method', value: 'method-algo-mna-dc' },
  { module: 'mna', key: 'method', value: 'method-algo-mna-dc-sweep' },
  { module: 'mna', key: 'method', value: 'method-algo-mna-transient-be' },
  { module: 'mom', key: 'operation', value: 'cst-wire-far-field' },
  { module: 'mom-antenna', key: 'operation', value: 'cst-antenna-array-factor' },
  { module: 'noise-figure', key: 'operation', value: 'cst-friis-cascade' },
  { module: 'peec', key: 'operation', value: 'cst-peec-multibranch-response' },
  { module: 'pic-l2', key: 'operation', value: 'cst-boris-push' },
  { module: 'pic-l3', key: 'operation', value: 'cst-periodic-electrostatic-pic' },
  { module: 'plane-wave', key: 'operation', value: 'cst-uniform-plane-wave' },
  { module: 'poynting', key: 'operation', value: 'cst-time-harmonic-surface-power' },
  { module: 'richardson-thermionic', key: 'operation', value: 'cst-planar-diode-space-charge-limit' },
  { module: 'rollett-k', key: 'operation', value: 'cst-two-port-stability' },
  { module: 's-parameters', key: 'operation', value: 'cst-connected-network' },
  { module: 'skin-effect', key: 'operation', value: 'cst-finite-slab-surface-impedance' },
  { module: 'steinmetz', key: 'operation', value: 'cst-harmonic-core-loss' },
  { module: 'transmission-line', key: 'operation', value: 'cst-quarter-wave-transformer' },
  { module: 'vswr', key: 'operation', value: 'cst-s11-vswr-sweep' },
  { module: 'waveguide-modes', key: 'operation', value: 'cst-waveguide-electric-field-samples' },
  { module: 'zmatrix', key: 'operation', value: 'cst-zmatrix-to-sparameters' },
] as const

export const NATIVE_ALGORITHM_OPERATIONS = [...OPTICSTUDIO_NATIVE_OPERATIONS, ...CST_NATIVE_OPERATIONS] as const

type NativeOperation = typeof NATIVE_ALGORITHM_OPERATIONS[number]
export type NativeAlgorithmInput = {
  [Operation in NativeOperation as Operation['module']]: {
    module: Operation['module']
    backend: 'host'
  } & { [Key in Operation['key']]: Operation['value'] } & Record<string, unknown>
}[NativeOperation['module']]

export function isNativeAlgorithmInput(value: unknown): value is NativeAlgorithmInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (input.backend !== 'host') return false
  // MNA has separate released CST and native SPICE operations. Supplying both
  // selectors is ambiguous even when one of them matches a registered pair.
  if (input.module === 'mna' && input.operation !== undefined && input.method !== undefined) return false
  return NATIVE_ALGORITHM_OPERATIONS.some(operation =>
    input.module === operation.module && input[operation.key] === operation.value)
}

export function hasNativeAlgorithmSelector(value: Record<string, unknown>): boolean {
  return NATIVE_ALGORITHM_OPERATIONS.some(operation =>
    value.module === operation.module && value[operation.key] === operation.value)
}

/** Keep the legacy laser teaching input separate from the new native operation. */
export function isNativeAlgorithmModule(module: unknown): boolean {
  return NATIVE_ALGORITHM_OPERATIONS.some(operation => operation.module === module)
}
