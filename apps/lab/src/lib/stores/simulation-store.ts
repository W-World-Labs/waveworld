import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HostClass, JobResultV1 } from '@w-sim/contracts';
import type {
  WindTunnelParameters,
  SimulationState,
  SimulationResults,
  SolverConfig,
  GPUSimulationContext,
  DerivedQuantities,
} from '@/types/simulation';

interface SimulationStore {
  computeTarget: HostClass;
  setComputeTarget: (target: HostClass) => void;
  computeBackend: 'cpu' | 'webgpu';
  setComputeBackend: (backend: 'cpu' | 'webgpu') => void;
  applyJobResult: (result: JobResultV1) => void;
  // GPU 上下文
  gpuContext: GPUSimulationContext;
  setGPUContext: (context: Partial<GPUSimulationContext>) => void;
  
  // 仿真参数
  parameters: WindTunnelParameters;
  updateParameters: (params: Partial<WindTunnelParameters>) => void;
  resetParameters: () => void;
  
  // 求解器配置
  solverConfig: SolverConfig;
  updateSolverConfig: (config: Partial<SolverConfig>) => void;
  
  // 仿真状态
  state: SimulationState;
  setState: (state: Partial<SimulationState>) => void;
  startSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  stopSimulation: () => void;
  resetSimulation: () => void;
  clearResults: () => void;
  
  // 结果数据
  results: SimulationResults;
  updateResults: (results: Partial<SimulationResults>) => void;

  // 派生物理量（单位换算结果，只读）
  derived: DerivedQuantities | null;
  setDerived: (derived: DerivedQuantities | null) => void;

  // 记录一次真实气动力读数（系数 + 历史 + 力）
  recordForces: (cd: number | undefined, cl: number | undefined, forces: SimulationResults['forces']) => void;
  
  // 可视化设置
  setVisualizationMode: (mode: SimulationState['visualizationMode']) => void;
  toggleStreamlines: () => void;
  toggleIsosurface: () => void;
  setSlicePlane: (plane: SimulationState['slicePlane']) => void;
  setSlicePosition: (position: number) => void;
}

const defaultParameters: WindTunnelParameters = {
  flowMethod: 'lbm', macGrid: [48, 24, 24], macCharacteristicCells: 16, macOpenFaces: 3, macFans: [],
  fan: null,
  inletVelocity: 10,
  angleOfAttack: 0,
  turbulenceIntensity: 5,
  turbulenceModel: 'les-smagorinsky',
  smagorinskyCs: 0.12,
  gridResolution: 256,
  gridPreset: 'standard',
  modelResolution: 'standard',
  renderQuality: 'standard',
  gridType: 'uniform',
  displayThreshold: 0.08,
  timeStep: 0.001,
  maxIterations: 10000,
  durationSeconds: 10,
  fieldFps: 30,
  fieldStride: 4,
  convergenceThreshold: 1e-6,
  fluidDensity: 1.225,
  fluidViscosity: 1.81e-5,
  viscosityMode: 'stabilized-preview',
  wallCondition: 'slip',
  outletPressure: 101325,
  thermalEnabled: false,
  thermalMode: 'fixed-temperature',
  dtSeconds: 0.0001,
  totalPowerW: 10,
  solidDensityKgM3: 2700,
  solidSpecificHeatJkgK: 900,
  solidConductivityWmK: 200,
  thermalRegions: [],
  thermalContacts: [],
  fluidSpecificHeatJkgK: 1005,
  fluidConductivityWmK: 0.026,
  ambientTemp: 25,
  heatSourceTemp: 60,
};

const defaultState: SimulationState = {
  isRunning: false,
  isPaused: false,
  currentIteration: 0,
  currentTime: 0,
  convergenceHistory: [],
  liftCoefficient: null,
  dragCoefficient: null,
  visualizationMode: 'velocity',
  showStreamlines: true,
  showIsosurface: false,
  slicePlane: 'none',
  slicePosition: 0.5,
  showBoundary: false,
  cdHistory: [],
  clHistory: [],
  resetCount: 0,
  playbackIndex: -1,
  isPlaying: false,
  playbackDuration: 10,
  playbackLoop: true,
};

const defaultResults: SimulationResults = {
  thermal: null,
  flowSnapshot: null,
  flowFrames: [],
  job: null,
  pressureField: null,
  velocityField: null,
  vorticityField: null,
  surfacePressure: null,
  surfaceShearStress: null,
  forces: {
    lift: null,
    drag: null,
    side: null,
    moment: null,
  },
};

const defaultSolverConfig: SolverConfig = {
  type: 'lbm',
  latticeType: 'D3Q19',
  relaxationTime: 0.6,
  reynoldsNumber: 1000,
};

// v1 → v2：四面外域边界默认改为自由滑移（镜面反射）。
// v3 → v4：回放开关从固定 16 帧改为物理帧率；旧的「关」（fieldFrames ≤ 1）映射为 0 fps。
export function migrateSimulationStore(persistedState: unknown, version: number): { parameters: WindTunnelParameters; solverConfig: SolverConfig } {
  const p = persistedState as { parameters?: WindTunnelParameters; solverConfig?: SolverConfig };
  if (version < 2 && p?.parameters) {
    p.parameters = { ...p.parameters, wallCondition: 'slip' };
  }
  if (version < 3 && p?.parameters) {
    p.parameters = { ...p.parameters, durationSeconds: Math.max(10, p.parameters.durationSeconds ?? 10) };
  }
  if (version < 4 && p?.parameters && p.parameters.fieldFps === undefined && p.parameters.fieldFrames !== undefined) {
    p.parameters = { ...p.parameters, fieldFps: p.parameters.fieldFrames > 1 ? 30 : 0 };
  }
  return p as { parameters: WindTunnelParameters; solverConfig: SolverConfig };
}

export const useSimulationStore = create<SimulationStore>()(
  persist(
    (set) => ({
      computeTarget: 'browser',
      setComputeTarget: (computeTarget) => set({ computeTarget }),
      computeBackend: 'cpu',
      setComputeBackend: (computeBackend) => set({ computeBackend }),
      applyJobResult: (result) => {
        const mac = result.derived?.['mac-3d-v1'] === 1;
        for (const key of mac ? ['steps'] as const : ['steps', 'dragN', 'liftN'] as const) {
          if (!Number.isFinite(result.summary?.[key])) throw new Error(`后端风洞结果缺少有效 ${key}`);
        }
        for (const key of ['cd', 'cl'] as const) {
          if (result.summary[key] !== undefined && !Number.isFinite(result.summary[key])) throw new Error(`后端风洞结果包含无效 ${key}`);
        }
        set((current) => ({
        state: {
          ...current.state,
          isRunning: false,
          isPaused: false,
          playbackIndex: -1,
          isPlaying: false,
          currentIteration: result.summary.steps,
          currentTime: result.summary.steps * (result.derived?.dt ?? 0),
          dragCoefficient: result.summary.cd ?? null,
          liftCoefficient: result.summary.cl ?? null,
          cdHistory: result.history?.cd ?? [],
          clHistory: result.history?.cl ?? [],
        },
        results: { ...defaultResults, thermal: result.thermal ?? null, forces: {
          drag: result.summary.dragN ?? null, lift: result.summary.liftN ?? null,
          side: typeof result.summary.sideN === 'number' && Number.isFinite(result.summary.sideN) ? result.summary.sideN : null,
          moment: null,
        } },
        derived: result.derived ? {
          'mac-3d-v1': mac ? 1 : undefined,
          groundMode: result.derived.groundMode,
          groundClearanceM: result.derived.groundClearanceM,
          groundVelocityMps: result.derived.groundVelocityMps,
          'lbm-ground-v1': typeof result.derived['lbm-ground-v1'] === 'number' ? result.derived['lbm-ground-v1'] : undefined,
          'lbm-gauge-force-v1': typeof result.derived['lbm-gauge-force-v1'] === 'number' ? result.derived['lbm-gauge-force-v1'] : undefined,
          precision: typeof result.derived.precision === 'string' ? result.derived.precision : undefined,
          viscosityMode: result.derived.viscosityMode === 'physical' || result.derived.viscosityMode === 'stabilized-preview' ? result.derived.viscosityMode : undefined,
          requestedViscosityM2s: typeof result.derived.requestedViscosityM2s === 'number' ? result.derived.requestedViscosityM2s : undefined,
          simulatedViscosityM2s: typeof result.derived.simulatedViscosityM2s === 'number' ? result.derived.simulatedViscosityM2s : undefined,
          ambientC: result.derived.ambientC,
          temperatureScaleC: result.derived.temperatureScaleC,
          pressureScalePa: typeof result.derived.pressureScalePa === 'number' ? result.derived.pressureScalePa : undefined,
          thermalDiffusivityPhysical: result.derived.thermalDiffusivityPhysical,
          dx: result.derived.dx ?? 0,
          dt: result.derived.dt ?? 0,
          referenceArea: result.derived.referenceArea ?? 0,
          cellCount: result.derived.cellCount ?? 0,
          reynoldsPhysical: result.summary.reynoldsPhysical ?? 0,
          reynoldsLattice: result.summary.reynoldsLattice ?? 0,
          solidCells: result.summary.solidCells ?? 0,
        } : null,
        }));
      },
      gpuContext: {
        device: null,
        context: null,
        isInitialized: false,
        isSupported: false,
        errorMessage: null,
      },
      setGPUContext: (context) =>
        set((state) => ({
          gpuContext: { ...state.gpuContext, ...context },
        })),
      
      parameters: defaultParameters,
      updateParameters: (params) =>
        set((state) => ({
          parameters: { ...state.parameters, ...params },
          ...(params.thermalEnabled === false && state.state.visualizationMode === 'temperature'
            ? { state: { ...state.state, visualizationMode: 'velocity' as const } }
            : {}),
        })),
      resetParameters: () => set({ parameters: defaultParameters }),
      
      solverConfig: defaultSolverConfig,
      updateSolverConfig: (config) =>
        set((state) => ({
          solverConfig: { ...state.solverConfig, ...config },
        })),
      
      state: defaultState,
      setState: (newState) =>
        set((state) => ({
          state: { ...state.state, ...newState },
        })),
      
      startSimulation: () =>
        set((state) => ({
          state: { ...state.state, isRunning: true, isPaused: false },
        })),
      
      pauseSimulation: () =>
        set((state) => ({
          state: { ...state.state, isPaused: true },
        })),
      
      resumeSimulation: () =>
        set((state) => ({
          state: { ...state.state, isPaused: false },
        })),
      
      stopSimulation: () =>
        set((state) => ({
          state: { ...state.state, isRunning: false, isPaused: false },
        })),
      
      resetSimulation: () =>
        set((state) => ({
          state: {
            ...defaultState,
            isRunning: false,
            resetCount: state.state.resetCount + 1, // 触发求解器重建
          },
          results: defaultResults,
          derived: null,
        })),

      results: defaultResults,
      clearResults: () =>
        set((state) => ({
          state: {
            ...state.state,
            currentIteration: 0,
            currentTime: 0,
            playbackIndex: -1,
            isPlaying: false,
            liftCoefficient: null,
            dragCoefficient: null,
            cdHistory: [],
            clHistory: [],
            convergenceHistory: [],
          },
          results: defaultResults,
          derived: null,
        })),
      updateResults: (newResults) =>
        set((state) => ({
          results: { ...state.results, ...newResults },
        })),

      derived: null,
      setDerived: (derived) => set({ derived }),

      recordForces: (cd, cl, forces) =>
        set((state) => ({
          state: {
            ...state.state,
            dragCoefficient: cd ?? null,
            liftCoefficient: cl ?? null,
            cdHistory: cd === undefined ? [] : [...state.state.cdHistory.slice(-299), cd],
            clHistory: cl === undefined ? [] : [...state.state.clHistory.slice(-299), cl],
          },
          results: { ...state.results, forces },
        })),
      
      setVisualizationMode: (mode) =>
        set((state) => ({
          state: { ...state.state, visualizationMode: mode },
        })),
      
      toggleStreamlines: () =>
        set((state) => ({
          state: { ...state.state, showStreamlines: !state.state.showStreamlines },
        })),
      
      toggleIsosurface: () =>
        set((state) => ({
          state: { ...state.state, showIsosurface: !state.state.showIsosurface },
        })),
      
      setSlicePlane: (plane) =>
        set((state) => ({
          state: { ...state.state, slicePlane: plane },
        })),
      
      setSlicePosition: (position) =>
        set((state) => ({
          state: { ...state.state, slicePosition: position },
        })),
    }),
    {
      name: 'wind-tunnel-simulation',
      version: 4,
      migrate: migrateSimulationStore,
      partialize: (state) => ({
        parameters: state.parameters,
        solverConfig: state.solverConfig,
      }),
      // 浅合并持久化参数到当前默认值：旧版本 localStorage 缺少的新字段用默认值补齐
      merge: (persisted, current) => {
        const p = persisted as Partial<SimulationStore> | undefined;
        return {
          ...current,
          ...p,
          parameters: { ...current.parameters, ...(p?.parameters ?? {}) },
          solverConfig: { ...current.solverConfig, ...(p?.solverConfig ?? {}) },
        };
      },
    }
  )
);
