/**
 * Lab model ↔ simulation session lifecycle (CPU side).
 *
 * Covers the non-WebGPU stages of:
 *   load → start (voxelize / prepare) → stop → swap model
 *
 * UI and node:test smoke share this so failures return local recovery results
 * instead of uncaught throws that could escalate to a page-level boundary.
 */

import type { ModelGeometry, ModelMetadata, PresetModel, WindTunnelModel } from '@/types/model';
import type { WindTunnelParameters } from '@/types/simulation';
import type { FluidJobSpecV1, JobSpecV1, MacJobSpecV1 } from '@w-sim/contracts';
import { LBM_FIELD_HISTORY_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, MAC_3D_FEATURE, validateMacJobSpec } from '@w-sim/contracts';
import { voxelizeModel, type VoxelizationResult } from '@w-sim/solvers-lbm/d3q19';
import { GRID_PRESETS, MODEL_RESOLUTIONS, type GridPreset } from '@w-sim/solvers-lbm/d3q19';
import { createLbmModelTransform, prepareProductLbmUnits } from '@w-sim/solvers-lbm/d3q19';
import { assertGeometryContract, GeometryContractError } from './geometry-contract';
import { generatePresetModel, loadPresetModel, PRESET_MODELS } from './preset-models';

export const LBM_FORCE_SAMPLE_EVERY = 20;

/** Playback fps → requested frame count over the physical duration; fieldStride passes through. */
export function resolveFieldOutputs(parameters: WindTunnelParameters, durationSeconds: number): { fieldFrames: number; fieldStride?: 1 | 2 | 4 | 8 } {
  const stride = parameters.fieldStride ?? 1;
  const fps = parameters.fieldFps;
  const frames = fps === undefined ? (parameters.fieldFrames ?? 1)
    : fps <= 0 ? 1 : Math.min(4096, Math.max(2, Math.round(fps * durationSeconds)));
  return { fieldFrames: frames, ...(stride > 1 ? { fieldStride: stride } : {}) };
}

/** Same model and thermal region inputs; each method admits its own boundaries. */
export function createActiveFlowJobSpec(parameters: WindTunnelParameters, activeModel: WindTunnelModel | null, backend: 'cpu' | 'webgpu' = 'cpu'): FluidJobSpecV1 | MacJobSpecV1 {
  if (parameters.flowMethod !== 'mac') return createActiveLbmJobSpec(parameters, activeModel, backend);
  if (backend !== 'cpu') throw new Error('MAC 目前使用 CPU / WASM FP64，请选择 CPU');
  const model = createActiveLbmJobSpec({ ...parameters, durationSeconds: undefined }, activeModel).model!;
  model.referenceLength ??= activeModel!.sourceModel.boundingBox.size[0];
  const maxSteps = parameters.durationSeconds === undefined ? parameters.maxIterations : Math.ceil(parameters.durationSeconds / parameters.dtSeconds);
  const spec: MacJobSpecV1 = {
    schemaVersion: 1, kind: 'mac-3d', name: activeModel!.name, model,
    parameters: {
      grid: parameters.macGrid ?? [48, 24, 24], characteristicCells: parameters.macCharacteristicCells ?? 16,
      dtSeconds: parameters.dtSeconds, fluidDensity: parameters.fluidDensity, fluidViscosity: parameters.fluidViscosity,
      openFaces: parameters.macOpenFaces ?? 3, fans: parameters.macFans ?? [],
      thermalEnabled: parameters.thermalEnabled,
      ...(parameters.thermalEnabled ? {
        thermalMode: parameters.thermalMode, ambientTemp: parameters.ambientTemp,
        fluidSpecificHeatJkgK: parameters.fluidSpecificHeatJkgK, fluidConductivityWmK: parameters.fluidConductivityWmK,
        ...(parameters.thermalMode === 'solid-power' ? {
          totalPowerW: parameters.totalPowerW, solidDensityKgM3: parameters.solidDensityKgM3,
          solidSpecificHeatJkgK: parameters.solidSpecificHeatJkgK, solidConductivityWmK: parameters.solidConductivityWmK,
          thermalRegions: parameters.thermalRegions, thermalContacts: parameters.thermalContacts,
        } : { heatSourceTemp: parameters.heatSourceTemp }),
      } : {}),
    },
    run: { maxSteps },
    outputs: { history: true, forces: false, fields: ['velocity', 'pressure', ...(parameters.thermalEnabled ? ['temperature'] : [])],
      ...resolveFieldOutputs(parameters, maxSteps * parameters.dtSeconds) },
    requirements: { backends: ['cpu'], precision: 'float64', features: [MAC_3D_FEATURE], thermal: parameters.thermalEnabled || undefined },
  };
  const check = validateMacJobSpec(spec);
  if (!check.ok) throw new Error(check.message);
  return spec;
}

/** One scene description for the local session and the remote job. */
export function createActiveLbmJobSpec(parameters: WindTunnelParameters, activeModel: WindTunnelModel | null, backend: 'cpu' | 'webgpu' = 'cpu'): FluidJobSpecV1 {
  if (!activeModel) throw new Error('请先选择模型');
  const id = activeModel.sourceModel?.id ?? activeModel.id;
  const preset = PRESET_MODELS.find((item) => item.id === id);
  const model: JobSpecV1['model'] = preset ? {
    source: 'preset', presetId: preset.id,
    referenceLength: preset.defaultParameters?.referenceLength,
    referenceArea: preset.defaultParameters?.referenceArea,
  } : { source: 'inline', inline: { modelId: id } };
  if (activeModel.referenceLength !== undefined) model.referenceLength = activeModel.referenceLength;
  if (activeModel.referenceArea !== undefined) model.referenceArea = activeModel.referenceArea ?? undefined;
  if (model.referenceLength !== undefined && (!Number.isFinite(model.referenceLength) || model.referenceLength <= 0)) throw new Error('模型流向长度必须为正数（m）');
  if (model.referenceArea !== undefined && (!Number.isFinite(model.referenceArea) || model.referenceArea <= 0)) throw new Error('参考面积必须为正数（m²）');
  const spec = { ...createLbmJobSpec(parameters, model, parameters.maxIterations, backend), name: activeModel.name };
  if (parameters.durationSeconds !== undefined) {
    if (!Number.isFinite(parameters.durationSeconds) || parameters.durationSeconds <= 0) throw new Error('物理时长必须是正数（s）');
    const length = model.referenceLength ?? activeModel.sourceModel.boundingBox.size[0];
    const { units } = prepareProductLbmUnits(spec, length);
    const steps = Math.ceil(parameters.durationSeconds / units.dt);
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > 1000000) throw new Error('目标物理时长超过单次 1,000,000 步上限，请检查网格分辨率和时间步');
    spec.run = { ...spec.run, maxSteps: steps, warmupSteps: Math.min(200, Math.floor(steps / 4)) };
  }
  return spec;
}

/** 实时和批算共用同一份物理参数；显示参数不进入求解输入。 */
export function createLbmJobSpec(
  parameters: WindTunnelParameters,
  model?: JobSpecV1['model'],
  maxSteps = parameters.maxIterations,
  backend: 'cpu' | 'webgpu' = 'cpu',
): FluidJobSpecV1 {
  return {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    model,
    parameters: {
      ...(parameters.ground ? { ground: parameters.ground } : {}),
      ...(parameters.fan ? { fan: parameters.fan } : {}),
      inletVelocity: parameters.inletVelocity,
      angleOfAttack: parameters.angleOfAttack,
      turbulenceIntensity: parameters.turbulenceIntensity,
      smagorinskyCs: parameters.smagorinskyCs,
      fluidDensity: parameters.fluidDensity,
      fluidViscosity: parameters.fluidViscosity,
      viscosityMode: parameters.thermalEnabled ? 'physical' : parameters.viscosityMode,
      ...(parameters.latticeVelocity !== undefined ? { latticeVelocity: parameters.latticeVelocity } : {}),
      wallCondition: parameters.wallCondition,
      gridPreset: parameters.gridPreset,
      modelResolution: parameters.modelResolution,
      thermalEnabled: parameters.thermalEnabled,
      ambientTemp: parameters.ambientTemp,
      heatSourceTemp: parameters.heatSourceTemp,
      ...(parameters.thermalEnabled ? {
        thermalMode: parameters.thermalMode,
        fluidSpecificHeatJkgK: parameters.fluidSpecificHeatJkgK,
        fluidConductivityWmK: parameters.fluidConductivityWmK,
        ...(parameters.thermalMode === 'solid-power' ? {
          dtSeconds: parameters.dtSeconds, totalPowerW: parameters.totalPowerW,
          solidDensityKgM3: parameters.solidDensityKgM3,
          solidSpecificHeatJkgK: parameters.solidSpecificHeatJkgK,
          solidConductivityWmK: parameters.solidConductivityWmK,
          ...(parameters.thermalRegions?.length ? { thermalRegions: parameters.thermalRegions } : {}),
          ...(parameters.thermalContacts?.length ? { thermalContacts: parameters.thermalContacts } : {}),
        } : {}),
      } : {}),
    },
    run: {
      maxSteps,
      forceSampleEvery: LBM_FORCE_SAMPLE_EVERY,
      warmupSteps: Math.min(200, Math.floor(maxSteps / 4)),
    },
    outputs: { forces: true, history: true, fields: ['velocity', 'vorticity', 'pressure', ...(parameters.thermalEnabled ? ['temperature'] : [])],
      ...resolveFieldOutputs(parameters, parameters.durationSeconds ?? 10) },
    requirements: {
      backends: [backend],
      precision: backend === 'cpu' ? 'mixed' : 'float32',
      thermal: parameters.thermalEnabled || undefined,
      features: [LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, ...(resolveFieldOutputs(parameters, parameters.durationSeconds ?? 10).fieldFrames > 1 ? [LBM_FIELD_HISTORY_FEATURE] : [])],
    },
  };
}

export type SimSessionPhase =
  | 'idle'
  | 'loaded'
  | 'prepared'
  | 'stopped'
  | 'error';

export type LocalFailureKind = 'load' | 'contract' | 'prepare' | 'unknown';

export type LocalFailure = {
  kind: LocalFailureKind;
  code: string;
  message: string;
  /** True when UI should show a card/boundary warning and allow retry/swap. */
  recoverable: true;
};

export type PreparedSim = {
  modelId: string;
  modelName: string;
  fromFile: boolean;
  warning?: string;
  metadata: ModelMetadata;
  geometry: ModelGeometry;
  voxel: VoxelizationResult;
  grid: { nx: number; ny: number; nz: number; characteristicCells: number };
};

export type SessionOk = {
  ok: true;
  phase: Exclude<SimSessionPhase, 'error' | 'idle'>;
  prepared: PreparedSim;
};

export type SessionErr = {
  ok: false;
  phase: 'error';
  failure: LocalFailure;
  /** Optional procedural fallback when load failed but recovery succeeded. */
  recovered?: PreparedSim;
};

export type SessionResult = SessionOk | SessionErr;

export type PrepareOptions = {
  gridPresetId?: GridPreset['id'];
  modelResolutionId?: 'coarse' | 'standard' | 'high';
  angleOfAttackDeg?: number;
};

function gridFor(opts: PrepareOptions = {}) {
  const preset =
    GRID_PRESETS.find((p) => p.id === (opts.gridPresetId ?? 'fast')) ?? GRID_PRESETS[0];
  const modelRes =
    MODEL_RESOLUTIONS.find((r) => r.id === (opts.modelResolutionId ?? 'coarse')) ??
    MODEL_RESOLUTIONS[0];
  const characteristicCells = Math.max(8, Math.round(preset.nx * modelRes.ratio));
  return {
    nx: preset.nx,
    ny: preset.ny,
    nz: preset.nz,
    characteristicCells,
  };
}

/** Preview uses the solver's placement without voxelizing or admitting the physical case. */
export function createLbmPreviewPlacement(parameters: WindTunnelParameters, activeModel: WindTunnelModel, geometry: ModelGeometry) {
  const mac = parameters.flowMethod === 'mac';
  const [nx, ny, nz] = parameters.macGrid ?? [48, 24, 24];
  const grid = mac ? { nx, ny, nz, characteristicCells: parameters.macCharacteristicCells ?? 16 }
    : gridFor({ gridPresetId: parameters.gridPreset, modelResolutionId: parameters.modelResolution });
  const model = createActiveLbmJobSpec({ ...parameters, durationSeconds: undefined }, activeModel).model;
  const referenceLength = model?.referenceLength ?? activeModel.sourceModel.boundingBox.size[0];
  const dx = referenceLength / grid.characteristicCells;
  try {
    const transform = createLbmModelTransform({ geometry, ...grid, angleOfAttackDeg: mac ? 0 : parameters.angleOfAttack,
      ...(!mac && parameters.ground ? { groundClearanceCells: parameters.ground.clearanceM / dx } : {}),
    });
    return { grid, dx, transform, referenceLength, referenceArea: model?.referenceArea };
  } catch (cause) {
    throw new Error(`无法放置模型。请检查模型几何、减小“模型占域比例”或调整攻角；若模型方向不符，请在建模软件中将流向对齐 X 后重新导入。${parameters.ground ? '已启用地面时，还可减小最低点间隙。' : ''}原始信息：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function localFailure(
  kind: LocalFailureKind,
  code: string,
  message: string
): LocalFailure {
  return { kind, code, message, recoverable: true };
}

/**
 * Voxelize geometry for a sim start. Never throws — returns a local failure.
 * Uses a small grid by default so node smoke stays fast.
 */
export function prepareSimulation(
  modelId: string,
  modelName: string,
  geometry: ModelGeometry,
  metadata: ModelMetadata,
  opts: PrepareOptions & { fromFile?: boolean; warning?: string } = {}
): SessionResult {
  try {
    assertGeometryContract(geometry);
  } catch (err) {
    const code = err instanceof GeometryContractError ? err.code : 'contract';
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      phase: 'error',
      failure: localFailure('contract', code, message),
    };
  }

  const g = gridFor(opts);
  try {
    const voxel = voxelizeModel({
      geometry,
      nx: g.nx,
      ny: g.ny,
      nz: g.nz,
      characteristicCells: g.characteristicCells,
      angleOfAttackDeg: opts.angleOfAttackDeg ?? 0,
    });
    // Empty solid after voxelize is a soft signal (open meshes still mark surface).
    // Hard-fail only if flags buffer is missing (should not happen).
    if (!voxel.flags || voxel.flags.length !== g.nx * g.ny * g.nz) {
      return {
        ok: false,
        phase: 'error',
        failure: localFailure('prepare', 'voxel_buffer', '体素化结果缓冲区无效'),
      };
    }
    return {
      ok: true,
      phase: 'prepared',
      prepared: {
        modelId,
        modelName,
        fromFile: opts.fromFile ?? false,
        warning: opts.warning,
        metadata,
        geometry,
        voxel,
        grid: g,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      phase: 'error',
      failure: localFailure('prepare', 'voxelize', `体素化/仿真准备失败: ${message}`),
    };
  }
}

/** Mark session stopped (CPU bookkeeping for smoke / store wiring). */
export function stopSimulationSession(prepared: PreparedSim): SessionOk {
  return {
    ok: true,
    phase: 'stopped',
    prepared,
  };
}

/**
 * Load a preset by id (file-first, procedural fallback), returning local errors.
 * Optional injectLoadError forces the file path to fail so recovery is testable.
 */
export async function loadPresetForSession(
  presetId: string,
  options?: {
    injectLoadError?: string;
    onProgress?: (p: number) => void;
  }
): Promise<
  | {
      ok: true;
      phase: 'loaded';
      metadata: ModelMetadata;
      geometry: ModelGeometry;
      fromFile: boolean;
      warning?: string;
      preset: PresetModel;
    }
  | SessionErr
> {
  const preset = PRESET_MODELS.find((p) => p.id === presetId);
  if (!preset) {
    return {
      ok: false,
      phase: 'error',
      failure: localFailure('load', 'unknown_preset', `未知预设: ${presetId}`),
    };
  }

  if (options?.injectLoadError) {
    // Simulate fetch/parse failure then recover via procedural (same as loadPresetModel catch).
    try {
      const { metadata, geometry } = generatePresetModel(preset.id);
      assertGeometryContract(geometry);
      return {
        ok: true,
        phase: 'loaded',
        metadata,
        geometry,
        fromFile: false,
        warning: options.injectLoadError,
        preset,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        phase: 'error',
        failure: localFailure(
          'load',
          'load_recovery_failed',
          `加载失败且程序化回退不可用: ${message}`
        ),
      };
    }
  }

  try {
    const loaded = await loadPresetModel(preset, options?.onProgress);
    return {
      ok: true,
      phase: 'loaded',
      metadata: loaded.metadata,
      geometry: loaded.geometry,
      fromFile: loaded.fromFile,
      warning: loaded.warning,
      preset,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      phase: 'error',
      failure: localFailure('load', 'load_failed', message),
    };
  }
}

/**
 * Full CPU smoke: load A → prepare (start) → stop → load B → prepare.
 * Used by automated tests; mirrors Lab user path without WebGPU.
 */
export async function runLoadStartStopSwap(
  firstPresetId: string,
  secondPresetId: string,
  opts: PrepareOptions = {}
): Promise<
  | {
      ok: true;
      first: PreparedSim;
      second: PreparedSim;
      stopped: true;
    }
  | SessionErr & { step: 'load1' | 'prepare1' | 'load2' | 'prepare2' }
> {
  const load1 = await loadPresetForSession(firstPresetId);
  if (!load1.ok) return { ...load1, step: 'load1' };

  const prep1 = prepareSimulation(
    load1.metadata.id,
    load1.metadata.name,
    load1.geometry,
    load1.metadata,
    {
      ...opts,
      fromFile: load1.fromFile,
      warning: load1.warning,
      angleOfAttackDeg: load1.preset.defaultParameters?.angleOfAttack,
    }
  );
  if (!prep1.ok) return { ...prep1, step: 'prepare1' };

  const stopped = stopSimulationSession(prep1.prepared);
  if (stopped.phase !== 'stopped') {
    return {
      ok: false,
      phase: 'error',
      step: 'prepare1',
      failure: localFailure('unknown', 'stop', '停止会话失败'),
    };
  }

  const load2 = await loadPresetForSession(secondPresetId);
  if (!load2.ok) return { ...load2, step: 'load2' };

  const prep2 = prepareSimulation(
    load2.metadata.id,
    load2.metadata.name,
    load2.geometry,
    load2.metadata,
    {
      ...opts,
      fromFile: load2.fromFile,
      warning: load2.warning,
      angleOfAttackDeg: load2.preset.defaultParameters?.angleOfAttack,
    }
  );
  if (!prep2.ok) return { ...prep2, step: 'prepare2' };

  return {
    ok: true,
    first: prep1.prepared,
    second: prep2.prepared,
    stopped: true,
  };
}

/**
 * Inject a prepare-time failure (bad geometry) and prove recovery via procedural
 * fallback for the same preset — models local UI recovery without page crash.
 */
export function injectPrepareFailureThenRecover(
  presetId: string,
  opts: PrepareOptions = {}
): SessionResult {
  const bad: ModelGeometry = {
    vertices: new Float32Array([Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const fakeMeta: ModelMetadata = {
    id: presetId,
    name: 'injected-bad',
    format: 'stl',
    fileSize: 0,
    uploadDate: new Date(),
    vertexCount: 3,
    faceCount: 1,
    boundingBox: {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      size: [0, 0, 0],
    },
    isWatertight: false,
    hasNormals: true,
    hasUVs: false,
    manifoldEdges: 0,
    nonManifoldEdges: 0,
  };

  const failed = prepareSimulation(presetId, 'injected-bad', bad, fakeMeta, opts);
  if (failed.ok) {
    return {
      ok: false,
      phase: 'error',
      failure: localFailure(
        'unknown',
        'inject_missed',
        '注入的坏几何应失败但 prepare 返回 ok'
      ),
    };
  }

  // Local recovery: procedural preset for the same id (UI card would show the error then retry).
  try {
    const { metadata, geometry } = generatePresetModel(presetId);
    const recovered = prepareSimulation(
      metadata.id,
      metadata.name,
      geometry,
      metadata,
      { ...opts, fromFile: false, warning: failed.failure.message }
    );
    if (!recovered.ok) return recovered;
    return {
      ok: false,
      phase: 'error',
      failure: failed.failure,
      recovered: recovered.prepared,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      phase: 'error',
      failure: localFailure(
        'load',
        'recovery_failed',
        `注入失败后回退不可用: ${message}`
      ),
    };
  }
}
