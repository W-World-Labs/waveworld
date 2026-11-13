/**
 * Tuanliu HQ Lab ↔ W-Sim kit adapter (w-sim #6 / S6-hqlabkit).
 *
 * Assembles {@link HqLabKit} **only** via `@w-sim/kit` `assembleHqLabKit`.
 * No local duplicate kit interface — product implements GeometryLoader /
 * SolverFactory / SettlementClient and composes them.
 *
 * Browser LBM lattice/step is owned by `@w-sim/solvers-lbm`; tuanliu keeps
 * canvas/session/kit wiring. Local sessions execute the shared WebGPU solver;
 * remote jobs use the same physical parameters through SettlementClient.
 */

import {
  assembleHqLabKit,
  type GeometryHandle,
  type GeometryLoader,
  type HqLabKit,
  type ParameterSchema,
  type ResultsSnapshot,
  type SettlementClient,
  type SolverFactory,
  type SolverSession,
} from '@w-sim/kit';
import {
  createHostCapabilityRegistry,
  LBM_GAUGE_FORCE_FEATURE,
  LBM_NEE_OUTLET_FEATURE,
  LBM_NEE_INLET_FEATURE,
  LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE,
  defaultJobSpec,
  type HostCapability,
  type HostCapabilityRegistry,
  type JobSpecV1,
} from '@w-sim/contracts';
import type { ModelGeometry, ModelMetadata } from '@/types/model';
import {
  generatePresetModel,
  loadPresetModel,
  PRESET_MODELS,
} from '@/lib/models/preset-models';
import {
  D3Q19Solver,
  prepareProductLbmLattice,
  type PreparedProductLbm,
} from '@w-sim/solvers-lbm/d3q19';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { createSettlementClient, type CreateSettlementClientOptions } from './settlement-client';

/** Catalog module id for tuanliu HQ fluid lab. */
export const TUANLIU_HQ_MODULE_ID = 'tuanliu';

/** Primary browser preview kind (matches JobSpec / capability registry). */
export const TUANLIU_LBM_KIND = 'lbm-d3q19';

/**
 * Host capability advertised for the Tuanliu browser WebGPU fluid path.
 * Registered through the shared contracts registry — not a product-named host kind.
 */
export const TUANLIU_BROWSER_FLUID_CAPABILITY: HostCapability = {
  id: 'tuanliu-browser-webgpu-fluid',
  hostClass: 'browser',
  backends: ['webgpu', 'webgpu-browser'],
  kinds: [TUANLIU_LBM_KIND],
  precision: ['float32'],
  features: ['webgpu', 'voxelization', LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE],
  maxVramMb: 512,
  outputs: ['forces', 'history', 'fields', 'kpis'],
  available: false,
};

export type LabSessionPhase =
  | 'idle'
  | 'prepared'
  | 'running'
  | 'paused'
  | 'cancelled'
  | 'failed'
  | 'disposed';

export type LabSessionDiagnostics = {
  phase: LabSessionPhase;
  kind: string;
  iteration: number;
  cancelled: boolean;
  failed: boolean;
  disposed: boolean;
  error?: string;
  solidCells?: number;
  grid?: { nx: number; ny: number; nz: number; characteristicCells: number };
};

type NativeGeomPayload = {
  geometry: ModelGeometry | null;
  metadata?: ModelMetadata;
  model?: JobSpecV1['model'];
};

/** Kit SolverSession + lab lifecycle surface (start/pause/cancel). */
export type TuanliuLabSolverSession = SolverSession & {
  readonly phase: LabSessionPhase;
  start(): void;
  pause(): void;
  cancel(): void;
  step(n?: number): Promise<void>;
  stop(): void;
  dispose(): void;
  getDiagnostics(): LabSessionDiagnostics;
  getPrepared(): PreparedProductLbm | null;
  getSolver(): D3Q19Solver | null;
};

export type TuanliuHqLabKit = HqLabKit & {
  /** Most recently created solver session (UI / tests). */
  lastSession(): TuanliuLabSolverSession | null;
  /** Capability descriptor this kit advertises. */
  readonly capability: HostCapability;
  /** Register `capability` on a host capability registry. */
  registerCapability(registry?: HostCapabilityRegistry): HostCapabilityRegistry;
};

export type AssembleTuanliuHqLabKitOptions = {
  settlement?: SettlementClient;
  /** Build HTTP settlement client when `settlement` omitted. */
  settlementOptions?: CreateSettlementClientOptions;
  /**
   * Prefer procedural preset geometry (no fetch). Default false in product;
   * tests should pass true for node smoke.
   */
  preferProceduralGeometry?: boolean;
  moduleId?: string;
  getDevice?: () => GPUDevice | null;
};

export function createTuanliuGeometryLoader(opts?: {
  preferProcedural?: boolean;
}): GeometryLoader {
  const preferProcedural = opts?.preferProcedural ?? false;

  return {
    async listPresets() {
      return PRESET_MODELS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      }));
    },

    async loadPreset(id: string): Promise<GeometryHandle> {
      const preset = PRESET_MODELS.find((p) => p.id === id);
      if (!preset) {
        throw new Error(`unknown preset: ${id}`);
      }

      let metadata: ModelMetadata;
      let geometry: ModelGeometry;

      if (preferProcedural) {
        const gen = generatePresetModel(id);
        metadata = gen.metadata;
        geometry = gen.geometry;
      } else {
        try {
          const loaded = await loadPresetModel(preset);
          metadata = loaded.metadata;
          geometry = loaded.geometry;
        } catch {
          const gen = generatePresetModel(id);
          metadata = gen.metadata;
          geometry = gen.geometry;
        }
      }

      const native: NativeGeomPayload = { geometry, metadata };
      return {
        id: metadata.id || id,
        name: metadata.name || preset.name,
        vertexCount: metadata.vertexCount,
        faceCount: metadata.faceCount,
        boundingBox: metadata.boundingBox
          ? {
              min: [
                metadata.boundingBox.min[0],
                metadata.boundingBox.min[1],
                metadata.boundingBox.min[2],
              ],
              max: [
                metadata.boundingBox.max[0],
                metadata.boundingBox.max[1],
                metadata.boundingBox.max[2],
              ],
            }
          : undefined,
        native,
      };
    },
  };
}

export function createTuanliuParameterSchema(): ParameterSchema {
  return {
    fields: [
      {
        key: 'viscosityMode',
        label: 'Viscosity mode',
        type: 'enum',
        options: [
          { value: 'stabilized-preview', label: 'Flow demonstration (adjusted viscosity)' },
          { value: 'physical', label: 'Physical viscosity (grid must resolve it)' },
        ],
        default: 'stabilized-preview',
      },
      {
        key: 'inletVelocity',
        label: 'Inlet velocity',
        type: 'number',
        min: 0,
        max: 100,
        step: 0.1,
        unit: 'm/s',
        default: 10,
      },
      {
        key: 'angleOfAttack',
        label: 'Angle of attack',
        type: 'number',
        min: -30,
        max: 30,
        step: 0.5,
        unit: 'deg',
        default: 0,
      },
      {
        key: 'gridPreset',
        label: 'Grid preset',
        type: 'enum',
        options: [
          { value: 'fast', label: 'Fast' },
          { value: 'standard', label: 'Standard' },
          { value: 'fine', label: 'Fine' },
        ],
        default: 'fast',
      },
      {
        key: 'modelResolution',
        label: 'Model resolution',
        type: 'enum',
        options: [
          { value: 'coarse', label: 'Coarse' },
          { value: 'standard', label: 'Standard' },
          { value: 'high', label: 'High' },
        ],
        default: 'coarse',
      },
    ],
  };
}

function createTuanliuSolverSession(
  kind: string, getDevice: () => GPUDevice | null,
): TuanliuLabSolverSession {
  let phase: LabSessionPhase = 'idle';
  let prepared: PreparedProductLbm | null = null;
  let solver: D3Q19Solver | null = null;
  let iteration = 0;
  let error: string | undefined;
  let cancelled = false;
  let disposed = false;

  const assertActive = () => {
    if (disposed || phase === 'disposed') {
      throw new Error('session disposed');
    }
  };

  const session: TuanliuLabSolverSession = {
    kind,

    get phase() {
      return phase;
    },

    async prepare(geometry, params) {
      assertActive();
      cancelled = false;
      error = undefined;
      solver?.destroy();
      solver = null;
      prepared = null;
      iteration = 0;
      try {
        const native = geometry.native as NativeGeomPayload | undefined;
        if (!native || !('geometry' in native)) {
          throw new Error('geometry handle missing native payload');
        }
        const device = getDevice();
        if (!device) throw new Error('WebGPU 尚未就绪，无法启动本机求解');
        const next = prepareProductLbmLattice(
          defaultJobSpec({ kind, parameters: params, model: native.model }), native.geometry,
        );
        solver = new D3Q19Solver(device, {
          nx: next.nx, ny: next.ny, nz: next.nz,
          uInlet: next.uInlet,
          tau: next.tau,
          smagorinskyCs: next.smagorinskyCs,
          turbulenceIntensity: next.turbulenceIntensity,
          freeSlipWalls: next.freeSlipWalls,
          groundVelocityLattice: next.groundVelocityLattice,
          flags: next.flags,
          thermal: next.thermal?.thermal,
          fan: next.fan,
        });
        prepared = next;
        phase = 'prepared';
      } catch (err) {
        phase = 'failed';
        error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },

    start() {
      assertActive();
      if (phase === 'failed') throw new Error(error ?? 'session failed');
      if (phase === 'cancelled') throw new Error('session cancelled');
      if (phase !== 'prepared' && phase !== 'paused' && phase !== 'running') {
        throw new Error(`cannot start from phase ${phase}`);
      }
      phase = 'running';
    },

    pause() {
      assertActive();
      if (phase === 'running') {
        phase = 'paused';
      }
    },

    async step(n = 1) {
      assertActive();
      if (phase === 'cancelled') throw new Error('session cancelled');
      if (phase === 'failed') throw new Error(error ?? 'session failed');
      if (phase === 'idle') {
        throw new Error('cannot step before prepare');
      }
      // Auto-start from prepared so kit step() alone advances preview.
      if (phase === 'prepared') {
        phase = 'running';
      }
      if (phase !== 'running' && phase !== 'paused') {
        throw new Error(`cannot step from phase ${phase}`);
      }
      if (!Number.isFinite(n) || n < 0) throw new Error('invalid step count');
      if (!solver) throw new Error('solver unavailable');
      const runningSolver = solver;
      const startedRunning = phase === 'running';
      try {
        for (let i = 0; i < Math.floor(n); i++) {
          await runningSolver.step();
          assertActive();
          if (cancelled) throw new Error('session cancelled');
          if (solver !== runningSolver) throw new Error('session model changed');
          iteration++;
          if (startedRunning && phase === 'paused') break;
        }
      } catch (err) {
        if (solver === runningSolver && !disposed && !cancelled) {
          phase = 'failed';
          error = err instanceof Error ? err.message : String(err);
        }
        throw err;
      }
    },

    stop() {
      if (disposed) return;
      if (phase === 'running' || phase === 'paused') {
        phase = 'paused';
      }
    },

    cancel() {
      if (disposed) return;
      cancelled = true;
      solver?.destroy();
      solver = null;
      prepared = null;
      phase = 'cancelled';
    },

    dispose() {
      if (disposed) return;
      solver?.destroy();
      solver = null;
      prepared = null;
      disposed = true;
      phase = 'disposed';
    },

    getDiagnostics() {
      return {
        phase,
        kind,
        iteration,
        cancelled,
        failed: phase === 'failed',
        disposed,
        error,
        solidCells: prepared?.solidCells,
        grid: prepared ? { nx: prepared.nx, ny: prepared.ny, nz: prepared.nz, characteristicCells: prepared.characteristicCells } : undefined,
      };
    },

    getPrepared() {
      return prepared;
    },
    getSolver() {
      return solver;
    },
  };

  return session;
}

export function createTuanliuSolverFactory(
  getDevice = () => useSimulationStore.getState().gpuContext.device,
): SolverFactory {
  return {
    supportedKinds() {
      return [TUANLIU_LBM_KIND];
    },
    create(kind: string): SolverSession {
      if (kind !== TUANLIU_LBM_KIND) {
        throw new Error(`unsupported kind: ${kind}`);
      }
      return createTuanliuSolverSession(kind, getDevice);
    },
  };
}

/**
 * Assemble the representative Tuanliu HQ lab kit from `@w-sim/kit`.
 * Settlement defaults to same-origin jobs API client.
 */
export function assembleTuanliuHqLabKit(
  opts: AssembleTuanliuHqLabKitOptions = {}
): TuanliuHqLabKit {
  const geometry = createTuanliuGeometryLoader({
    preferProcedural: opts.preferProceduralGeometry ?? false,
  });
  const getDevice = opts.getDevice ?? (() => useSimulationStore.getState().gpuContext.device);
  const baseFactory = createTuanliuSolverFactory(getDevice);
  let last: TuanliuLabSolverSession | null = null;

  const solver: SolverFactory = {
    supportedKinds: () => baseFactory.supportedKinds(),
    create(kind: string) {
      const session = baseFactory.create(kind) as TuanliuLabSolverSession;
      last = session;
      return session;
    },
  };

  const parameters = createTuanliuParameterSchema();
  const settlement =
    opts.settlement ?? createSettlementClient(opts.settlementOptions ?? {});

  // Authoritative seam — never re-declare HqLabKit locally.
  const kit = assembleHqLabKit({
    moduleId: opts.moduleId ?? TUANLIU_HQ_MODULE_ID,
    geometry,
    solver,
    parameters,
    settlement,
  });

  const getResults = (): ResultsSnapshot | null => {
    if (!last) return null;
    const d = last.getDiagnostics();
    if (d.phase === 'failed') {
      return {
        kpis: {},
        error: d.error,
        message: d.error,
      };
    }
    const { state, results } = useSimulationStore.getState();
    return {
      kpis: {
        iteration: { value: d.iteration, label: 'Iteration' },
        solidCells: { value: d.solidCells ?? 0, label: 'Solid cells' },
        ...(state.dragCoefficient !== null ? { cd: { value: state.dragCoefficient, label: 'Cd' } } : {}),
        ...(state.liftCoefficient !== null ? { cl: { value: state.liftCoefficient, label: 'Cl' } } : {}),
        ...(results.forces.drag !== null ? { drag: { value: results.forces.drag, label: 'Drag', unit: 'N' } } : {}),
        ...(results.forces.lift !== null ? { lift: { value: results.forces.lift, label: 'Lift', unit: 'N' } } : {}),
      },
      history: { cd: state.cdHistory, cl: state.clHistory },
      message: d.phase,
    };
  };

  const registerCapability = (
    registry?: HostCapabilityRegistry
  ): HostCapabilityRegistry => {
    return registerTuanliuBrowserCapability(registry, Boolean(getDevice()));
  };

  return {
    ...kit,
    visualization: {
      setQuantity(quantity) {
        if (quantity !== 'velocity' && quantity !== 'vorticity' && quantity !== 'temperature') {
          throw new Error(`unsupported quantity: ${quantity}`);
        }
        useSimulationStore.getState().setVisualizationMode(quantity);
      },
      setSlice(plane, position) {
        const store = useSimulationStore.getState();
        store.setSlicePlane(plane === 'x' ? 'yz' : plane === 'y' ? 'xz' : plane === 'z' ? 'xy' : 'none');
        if (position !== undefined) store.setSlicePosition(position);
      },
    },
    getResults,
    lastSession: () => last,
    get capability() {
      return { ...TUANLIU_BROWSER_FLUID_CAPABILITY, available: Boolean(getDevice()) };
    },
    registerCapability,
  };
}

/** Register browser fluid capability on a (new or existing) host registry. */
export function registerTuanliuBrowserCapability(
  registry?: HostCapabilityRegistry,
  available = Boolean(useSimulationStore.getState().gpuContext.device),
): HostCapabilityRegistry {
  const reg = registry ?? createHostCapabilityRegistry();
  const result = reg.register({ ...TUANLIU_BROWSER_FLUID_CAPABILITY, available }, {
    onCollision: 'override',
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return reg;
}

/**
 * Submit a JobSpec through the kit settlement surface (lab batch button path).
 * Prefer this over raw `fetch` so settlement stays on the W-Sim contract.
 */
export async function submitViaKitSettlement(
  kit: HqLabKit,
  spec: JobSpecV1
): Promise<{ jobId: string }> {
  if (!kit.settlement) {
    throw new Error('HqLabKit has no settlement client');
  }
  return kit.settlement.submit(spec);
}

/** Singleton kit for the live lab page (lazy). */
let labKitSingleton: TuanliuHqLabKit | null = null;

/**
 * Representative HQ lab entry: returns the assembled kit used by `/lab`.
 * Always produced by `assembleHqLabKit` under the hood.
 */
export function getTuanliuHqLabKit(): TuanliuHqLabKit {
  if (!labKitSingleton) {
    labKitSingleton = assembleTuanliuHqLabKit();
  }
  return labKitSingleton;
}

/** Test helper: drop singleton between cases. */
export function resetTuanliuHqLabKitForTests(): void {
  labKitSingleton = null;
}
