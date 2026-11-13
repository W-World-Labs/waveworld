/**
 * Sim-domain capability catalog (#8).
 * Single source of structural acceptance metadata for each Sim nav leaf.
 * Must stay isomorphic with `ALL_LEAVES` where `domainKey === 'sim'`.
 *
 * HQ module upgrade (P5-G): `tier` / `hqModuleId` / `hqKind` mark progressive
 * replacement of L0 demos with tuanliu-class 3D modules.
 *
 * Tier / HqKind authority: `@w-sim/contracts` (W-Sim engine plane).
 *
 * Product honesty (B0 · #51): catalog `tier` maps to L0 teaching vs L2
 * engineering Lab labels — never market `legacy` as engineering CFD/EM.
 * Policy: W-Sim `docs/ATLAS_L0_POLICY.md` · WaveWorld `docs/hq-sim-modules.md`.
 *
 * After S-solvers package land: `@w-sim/solvers-*` may exist at smoke maturity for
 * thermal / em-fdtd / acoustics / md / lbm / structural / path-experiment / … —
 * that does **not** promote catalog leaves to engineering or count as Atlas
 * graduation. Numerical residuals (S27at 3D dual ±x CPML-ψ, S19aa Ghia Re5000 stub,
 * S26aj SuperLU, S28aq dual ±y mur2-t, S24x duty CV/MAD, export native-range, … ·
 * prior S27as dual 2D ψ / S26ai shell expand / S29ah abs skin-pressure /
 * S20aj log-skill dual (after S20ai Brier/slope dual · S20x avg-rank) /
 * S28ap dual ±x mur2-t / S19z U/V floors / S24w skew-kurt / If-Range ·
 * w-sim path tip `e616ca4`) deepen package **smoke** capability only — still not
 * eng DoD / not catalog graduation.
 * W-Sim owns solver package maturity and release inventory. This catalog only
 * describes the WaveWorld presentation surface and its current honesty tier.
 */

import type { SimLayer, SimTier, HqKind } from '@w-sim/contracts'

export type { SimLayer, SimTier, HqKind }

export type SimMode = 'stepped' | 'parametric' | 'interactive' | 'gateway' | 'catalog'
export type SimRenderer = 'canvas2d' | 'three' | 'svg' | 'dom' | 'iframe' | 'mixed'
export type SimBackend = 'cpu' | 'webgpu-or-cpu' | 'host-api' | 'none'

export type SimCapability = {
  path: string
  mode: SimMode
  renderer: SimRenderer
  backend: SimBackend
  /** Engine / page module id (for humans + structural tests). */
  engine: string
  /** Stable visible stage (canvas/three/dom panel) expected on first paint. */
  hasVisibleStage: boolean
  supportsPause: boolean
  /** Whether pausing stops the solver or only the display of an already computed result. */
  pauseTarget?: 'compute' | 'playback'
  supportsReset: boolean
  /**
   * If true, first content requires a user click (bad for #5/#8).
   * Must be false for spectrum + FDTD after production fixes.
   */
  requiresClickForContent: boolean
  /** Progressive upgrade tier (P5-G / hq-sim-modules). */
  tier: SimTier
  /** HQ module id when tier is hq or gateway points at a module. */
  hqModuleId?: string
  /** field | instrument | gateway — see docs/hq-sim-modules.md */
  hqKind?: HqKind
}

function cap(
  path: string,
  partial: Omit<SimCapability, 'path' | 'tier'> & { tier?: SimTier },
): SimCapability {
  const tier: SimTier =
    partial.tier ??
    (partial.mode === 'gateway' || partial.mode === 'catalog' ? 'gateway' : 'legacy')
  return { path, ...partial, tier }
}

/**
 * Catalog rows — one per Sim leaf path.
 * When adding a nav sim leaf, add a row here in the same commit.
 */
export const SIM_CAPABILITY_CATALOG: readonly SimCapability[] = [
  cap('optics-lab', {
    mode: 'interactive',
    renderer: 'svg',
    backend: 'cpu',
    engine: 'src/lib/lab/optics-lab.ts',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('electromagnetic', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/spectrum-runnable-algos.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'em-fdtd',
    hqKind: 'field',
  }),
  cap('sound', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/spectrum-runnable-algos.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'acoustics',
    hqKind: 'field',
  }),
  cap('vibration', {
    mode: 'stepped',
    pauseTarget: 'playback',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/spectrum-runnable-algos.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'acoustics',
    hqKind: 'field',
  }),
  cap('ripple', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/wave.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'acoustics',
    hqKind: 'field',
  }),
  cap('fdtd', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'webgpu-or-cpu',
    engine: 'src/lib/sim/fdtd.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'em-fdtd',
    hqKind: 'field',
  }),
  cap('emwave3d', {
    mode: 'stepped',
    renderer: 'three',
    backend: 'cpu',
    engine: 'src/lib/sim/spectrum-runnable-algos.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'em-fdtd',
    hqKind: 'field',
  }),
  cap('antenna3d', {
    mode: 'parametric',
    renderer: 'three',
    backend: 'cpu',
    engine: 'src/lib/sim/antenna.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'antenna',
    hqKind: 'field',
  }),
  cap('antennapattern', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/antennalink.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'antenna',
    hqKind: 'field',
  }),
  cap('antennas', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'none',
    engine: 'src/pages/AntennaCatalog.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'antenna',
    hqKind: 'gateway',
  }),
  cap('phasedarray', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/phasedarray.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'antenna',
    hqKind: 'field',
  }),
  cap('faraday', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/faraday.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('rlc', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/rlc.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('mutual', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/mutual.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('transient', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/transient.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('smith', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/smith-chart.ts',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('md', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'webgpu-or-cpu',
    engine: 'src/lib/sim/md.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'md',
    hqKind: 'field',
  }),
  cap('particles', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'webgpu-or-cpu',
    engine: 'src/lib/sim/particles.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'md',
    hqKind: 'field',
  }),
  cap('ising', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/ising.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'md',
    hqKind: 'field',
  }),
  cap('fluid', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/fluid.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'tuanliu',
    hqKind: 'field',
  }),
  cap('windtunnel', {
    // 3D flow workspace; old ?legacy=1 links redirect to the unified 2D fluid example.
    mode: 'interactive',
    renderer: 'iframe',
    backend: 'host-api',
    engine: 'src/pages/WindTunnel.tsx',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'hq',
    hqModuleId: 'tuanliu',
    hqKind: 'field',
  }),
  cap('batch-jobs', {
    mode: 'gateway',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/BatchJobs.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('comsol', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/Comsol.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('ansys', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/Ansys.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('abaqus', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/Abaqus.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('opticstudio', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/OpticStudio.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('dymola', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/Dymola.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('star-ccm', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/StarCcm.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('cst', {
    mode: 'catalog',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/Cst.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('my-projects', {
    mode: 'gateway',
    renderer: 'dom',
    backend: 'host-api',
    engine: 'src/pages/MyProjects.tsx',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: false,
    requiresClickForContent: false,
    tier: 'gateway',
    hqModuleId: 'gateway',
    hqKind: 'gateway',
  }),
  cap('convection', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/fluid.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'thermal',
    hqKind: 'field',
  }),
  cap('sim', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'webgpu-or-cpu',
    engine: 'src/lib/webgpu/heatSim.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'thermal',
    hqKind: 'field',
  }),
  cap('heaterfc', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/heaterfc.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'thermal',
    hqKind: 'field',
  }),
  cap('ecg', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/ecg.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('emg', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/emg.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('eeg', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/eeg.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('neuron', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/neuron.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('biopipeline', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/biodsp.ts',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('ultrasound', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/ultrasound.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'acoustics',
    hqKind: 'field',
  }),
  cap('stm', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/spm-algos.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('afm', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/afm.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('signal-array', {
    mode: 'parametric', renderer: 'svg', backend: 'cpu', engine: 'src/lib/sim/signal-array.ts',
    hasVisibleStage: true, supportsPause: false, supportsReset: true, requiresClickForContent: false,
    tier: 'legacy', hqModuleId: 'instrument', hqKind: 'instrument',
  }),
  cap('radar', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/radar-algos.ts',
    hasVisibleStage: true,
    supportsPause: true,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('localization', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/trilateration.ts',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('tdoa', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/tdoa.ts',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('nljd', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/nljd.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('laser', {
    mode: 'stepped',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/laser.ts',
    hasVisibleStage: true,
    supportsPause: true,
    pauseTarget: 'playback',
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
  cap('display', {
    mode: 'parametric',
    renderer: 'canvas2d',
    backend: 'cpu',
    engine: 'src/lib/sim/display.ts',
    hasVisibleStage: true,
    supportsPause: false,
    supportsReset: true,
    requiresClickForContent: false,
    tier: 'legacy',
    hqModuleId: 'instrument',
    hqKind: 'instrument',
  }),
] as const

export function simCapabilityByPath(path: string): SimCapability | undefined {
  return SIM_CAPABILITY_CATALOG.find((c) => c.path === path)
}

export function simCatalogPaths(): string[] {
  return SIM_CAPABILITY_CATALOG.map((c) => c.path)
}

// ─── Catalog tier product honesty (B0 · #51) ────────────────────────────────

/**
 * Product-facing honesty for one catalog tier.
 * Distinct from upgrade `SimTier`: this is what UI/docs/tests must call the leaf.
 */
export type CatalogTierHonesty = {
  /** Catalog upgrade tier. */
  tier: SimTier
  /** Platform layer L0–L3 (W-Sim contracts SimLayer). */
  productLayer: SimLayer
  /** Short English product role (Host/Atlas copy). */
  shortEn: string
  /** Full English title. */
  titleEn: string
  /** Honest one-line English blurb — no overclaim. */
  blurbEn: string
  /** True: pedagogy / orientation only; not solver DoD credit. */
  isTeachingOnly: boolean
  /**
   * True only for live HQ Lab defaults that may count toward engineering
   * product surfaces (still not W-Sim solvers-* DoD by itself).
   */
  isEngineeringCredit: boolean
}

/**
 * Stable labels for catalog tiers. Gateway is refined per-path in
 * `catalogTierHonestyFor` (Lab gateway vs batch settlement).
 */
export const SIM_TIER_PRODUCT_LABELS: Readonly<
  Record<Exclude<SimTier, 'gateway'>, CatalogTierHonesty> & {
    gateway: Omit<CatalogTierHonesty, 'productLayer' | 'shortEn' | 'titleEn' | 'blurbEn'> & {
      tier: 'gateway'
      isTeachingOnly: false
      isEngineeringCredit: false
    }
  }
> = {
  legacy: {
    tier: 'legacy',
    productLayer: 'L0',
    shortEn: 'teaching',
    titleEn: 'L0 · Browser teaching demos',
    blurbEn:
      'Atlas Sims catalog leaf (2D / simple demo). Teaching and orientation only — not engineering CFD/EM settlement.',
    isTeachingOnly: true,
    isEngineeringCredit: false,
  },
  hq: {
    tier: 'hq',
    productLayer: 'L2',
    shortEn: 'engineering Lab',
    titleEn: 'L2 · Engineering HQ Lab',
    blurbEn:
      '3D flow workspace with model inputs and compute controls. Old ?legacy=1 links redirect to the editable 2D fluid example.',
    isTeachingOnly: false,
    isEngineeringCredit: true,
  },
  gateway: {
    tier: 'gateway',
    isTeachingOnly: false,
    isEngineeringCredit: false,
  },
}

/** Job, project, and native-module gateways → L3 workflow surfaces (not L0 teaching). */
const L3_GATEWAY_PATHS = new Set(['batch-jobs', 'my-projects', 'comsol', 'ansys', 'abaqus', 'opticstudio', 'dymola', 'star-ccm', 'cst'])

/**
 * Honest product layer + labels for a catalog row (and optional path refinement).
 * - `legacy` → L0 teaching (never engineering credit)
 * - `hq` → L2 engineering Lab
 * - `gateway` → L2 Lab entry (antennas) or L3 batch boards
 */
export function catalogTierHonestyFor(
  tier: SimTier,
  path?: string,
): CatalogTierHonesty {
  if (tier === 'legacy') return { ...SIM_TIER_PRODUCT_LABELS.legacy }
  if (tier === 'hq') return { ...SIM_TIER_PRODUCT_LABELS.hq }
  // gateway
  if (path && L3_GATEWAY_PATHS.has(path)) {
    return {
      tier: 'gateway',
      productLayer: 'L3',
      shortEn: 'batch',
      titleEn: 'L3 · Batch / settlement gateway',
      blurbEn:
        'Jobs / projects board gateway. Settlement plane entry — not browser teaching demos.',
      isTeachingOnly: false,
      isEngineeringCredit: false,
    }
  }
  return {
    tier: 'gateway',
    productLayer: 'L2',
    shortEn: 'Lab gateway',
    titleEn: 'L2 · Lab / catalog gateway',
    blurbEn:
      'Gateway into an HQ Lab family or catalog UI. Not an L0 leaf demo; not by itself engineering DoD credit.',
    isTeachingOnly: false,
    isEngineeringCredit: false,
  }
}

/** Convenience: honesty for a full catalog capability row. */
export function simCapabilityHonesty(c: Pick<SimCapability, 'path' | 'tier'>): CatalogTierHonesty {
  return catalogTierHonestyFor(c.tier, c.path)
}

/**
 * Structural honesty gate for the whole catalog (unit + sim-catalog track).
 * Throws if any row would mislabel L0 teaching as engineering or reverse.
 * Also: package land ≠ graduation — ungraduated W-Sim package families must not
 * silently promote catalog leaves off L0 teaching (except tuanliu product-presentation HQ).
 */
export function assertCatalogTierHonesty(
  rows: readonly Pick<SimCapability, 'path' | 'tier' | 'hqModuleId' | 'hqKind'>[] = SIM_CAPABILITY_CATALOG,
): void {
  for (const c of rows) {
    const h = simCapabilityHonesty(c)
    if (c.tier === 'legacy') {
      if (h.productLayer !== 'L0' || !h.isTeachingOnly || h.isEngineeringCredit) {
        throw new Error(
          `/${c.path}: tier=legacy must be L0 teaching only (got layer=${h.productLayer}, teaching=${h.isTeachingOnly}, eng=${h.isEngineeringCredit})`,
        )
      }
      if (!/teach/i.test(h.shortEn) && !/teach/i.test(h.titleEn)) {
        throw new Error(`/${c.path}: legacy honesty must say teaching`)
      }
    }
    if (c.tier === 'hq') {
      if (h.productLayer !== 'L2' || h.isTeachingOnly || !h.isEngineeringCredit) {
        throw new Error(
          `/${c.path}: tier=hq must be L2 engineering Lab (got layer=${h.productLayer}, teaching=${h.isTeachingOnly}, eng=${h.isEngineeringCredit})`,
        )
      }
      if (!c.hqModuleId) {
        throw new Error(`/${c.path}: tier=hq requires hqModuleId`)
      }
      // Must not sound like L0 teaching-only
      if (/^L0\b/i.test(h.titleEn) || (h.shortEn === 'teaching' && !/lab/i.test(h.titleEn))) {
        throw new Error(`/${c.path}: hq honesty must not read as L0 teaching-only`)
      }
    }
    if (c.tier === 'gateway') {
      if (h.isTeachingOnly || h.isEngineeringCredit) {
        throw new Error(`/${c.path}: gateway is neither pure teaching leaf nor engineering credit alone`)
      }
      if (L3_GATEWAY_PATHS.has(c.path) && h.productLayer !== 'L3') {
        throw new Error(`/${c.path}: batch gateway must map to L3`)
      }
      if (!L3_GATEWAY_PATHS.has(c.path) && h.productLayer !== 'L2') {
        throw new Error(`/${c.path}: non-batch gateway must map to L2 Lab gateway`)
      }
    }
  }
}

/** Paths that remain L0 teaching leaves (catalog tier=legacy). */
export function l0TeachingCatalogPaths(
  rows: readonly Pick<SimCapability, 'path' | 'tier'>[] = SIM_CAPABILITY_CATALOG,
): string[] {
  return rows.filter((c) => c.tier === 'legacy').map((c) => c.path).sort()
}

/** Paths whose default route is L2 engineering HQ Lab (catalog tier=hq). */
export function l2EngineeringCatalogPaths(
  rows: readonly Pick<SimCapability, 'path' | 'tier'>[] = SIM_CAPABILITY_CATALOG,
): string[] {
  return rows.filter((c) => c.tier === 'hq').map((c) => c.path).sort()
}

/**
 * Catalog-driven L0 smoke set (B0 · #51 ← #32 · residual full-parity):
 * every catalog `tier=legacy` teaching leaf — CI structural regression.
 * Never include `tier=hq` engineering defaults. New legacy rows must join this
 * list in the same commit (assertL0SmokeSampleHonesty enforces full parity).
 *
 * Families covered: thermal · EM/FDTD · spectrum · wave · MD · bio · RF ·
 * circuit · optics · acoustic · antenna · ultrasound · Ising/stat-mech ·
 * laser · SPM · induction · mutual · neuron/EMG · circuit-transient · display
 */
export const L0_SMOKE_SAMPLE_PATHS = [
  'signal-array',
  // prior sample (B0-catalog-tier-honesty)
  'sim',
  'fdtd',
  'electromagnetic',
  'ripple',
  'md',
  'ecg',
  'biopipeline',
  'heaterfc',
  'radar',
  // B0-l0-smoke-paths-expand (+5)
  'sound',
  'convection',
  'smith',
  'rlc',
  'emwave3d',
  // B0-l0-smoke-paths-expand-sprint2 (+5)
  'optics-lab',
  'ultrasound',
  'phasedarray',
  'ising',
  'laser',
  // B0-l0-smoke-paths-expand-sprint3 (+5)
  'vibration',
  'antenna3d',
  'eeg',
  'afm',
  'faraday',
  // B0-l0-smoke-paths-expand-sprint4 (+5)
  'emg',
  'neuron',
  'stm',
  'transient',
  'mutual',
  // B0-l0-smoke-paths-expand-sprint5 (+6 → full legacy cover)
  'antennapattern',
  'particles',
  'localization',
  'tdoa',
  'nljd',
  'fluid',
  'display',
  // wave-unify parity (563da10): signal-array/biopipeline/fluid/particles in,
  // pedotpss leaf retired → full legacy cover again (37)
] as const

export type L0SmokeSamplePath = (typeof L0_SMOKE_SAMPLE_PATHS)[number]

/**
 * Structural gate for the L0 smoke set itself:
 * every entry must be a catalog legacy (teaching) leaf — never HQ engineering —
 * and every catalog legacy leaf must appear (full-parity residual).
 * Throws on drift (path missing, tier≠legacy, eng credit, or incomplete cover).
 */
export function assertL0SmokeSampleHonesty(
  sample: readonly string[] = L0_SMOKE_SAMPLE_PATHS,
  rows: readonly Pick<SimCapability, 'path' | 'tier'>[] = SIM_CAPABILITY_CATALOG,
): void {
  const byPath = new Map(rows.map((c) => [c.path, c]))
  const engineering = new Set(l2EngineeringCatalogPaths(rows))
  const teaching = l0TeachingCatalogPaths(rows)
  if (sample.length < 30) {
    // Anti-shrink floor (full legacy set is 37 — parity enforced below; never drop below 30)
    throw new Error(
      `L0 smoke sample must keep ≥30 teaching paths (got ${sample.length}); do not shrink`,
    )
  }
  // Full-parity residual: every catalog legacy leaf must be smoke-gated
  const sampleSet = new Set(sample)
  for (const path of teaching) {
    if (!sampleSet.has(path)) {
      throw new Error(
        `L0 smoke sample missing teaching leaf /${path}; full legacy coverage required (add path with new catalog legacy row)`,
      )
    }
  }
  for (const path of sample) {
    const c = byPath.get(path)
    if (!c) {
      throw new Error(`L0 smoke sample /${path}: missing from capability catalog`)
    }
    if (c.tier !== 'legacy') {
      throw new Error(
        `L0 smoke sample /${path}: must be tier=legacy teaching (got tier=${c.tier})`,
      )
    }
    if (engineering.has(path)) {
      throw new Error(
        `L0 smoke sample /${path}: must not be L2 engineering HQ default`,
      )
    }
    const h = simCapabilityHonesty(c)
    if (h.productLayer !== 'L0' || !h.isTeachingOnly || h.isEngineeringCredit) {
      throw new Error(
        `L0 smoke sample /${path}: honesty must be L0 teaching only (layer=${h.productLayer}, teaching=${h.isTeachingOnly}, eng=${h.isEngineeringCredit})`,
      )
    }
  }
}
