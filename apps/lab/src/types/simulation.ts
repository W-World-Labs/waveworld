// 仿真参数与状态类型定义
import type { LbmDisplaySnapshot } from '@w-sim/solvers-lbm/d3q19';
import type { JobSpecV1, JobResultV1, LbmFanComponent, LbmGroundBoundary, LbmThermalResult, LbmThermalRegion, LbmThermalContact, MacFanComponent } from '@w-sim/contracts';
import type { MacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';

export interface WindTunnelParameters {
  flowMethod?: 'lbm' | 'mac';
  macGrid?: [number, number, number];
  macCharacteristicCells?: number;
  macOpenFaces?: number;
  macFans?: MacFanComponent[];
  fan: LbmFanComponent | null;
  // 流场参数
  inletVelocity: number; // m/s
  angleOfAttack: number; // 攻角（度）
  turbulenceIntensity: number; // %
  turbulenceModel: 'k-epsilon' | 'k-omega' | 'sst' | 'les-smagorinsky';
  smagorinskyCs: number; // Smagorinsky LES 常数（真实生效）
  
  // 网格参数
  gridResolution: number; // 网格分辨率（已弃用，见 gridPreset）
  gridPreset: 'fast' | 'standard' | 'fine' | 'ultra'; // 3D 网格预设
  modelResolution: 'coarse' | 'standard' | 'high'; // 模型在流域中的解析度
  latticeVelocity?: number; // 目标格子速度（默认 0.06；抬高可提升物理 Re 上限，马赫数误差增大）
  renderQuality: 'fine' | 'standard' | 'fast'; // 体渲染步进精度
  gridType: 'uniform' | 'adaptive';
  displayThreshold: number; // 体渲染显示阈值 0-0.5（削掉低于该比例的背景场）
  
  // 求解器参数
  timeStep: number; // 时间步长 (s)（只读派生，由单位换算决定）
  maxIterations: number;
  /** UI physical duration; resolved to maxSteps using shared physical units. */
  durationSeconds?: number;
  /** Legacy explicit frame count; only used when fieldFps is undefined. */
  fieldFrames?: number;
  /** Saved playback frames per physical second; 0/undefined keeps the final frame only. */
  fieldFps?: number;
  /** Playback spatial decimation per axis: 1 全分辨率, 2/4/8 块平均. */
  fieldStride?: 1 | 2 | 4 | 8;
  convergenceThreshold: number;
  
  // 物理参数
  fluidDensity: number; // kg/m³
  fluidViscosity: number; // Pa·s
  viscosityMode: 'physical' | 'stabilized-preview';
  
  // 边界条件
  ground?: LbmGroundBoundary;
  wallCondition: 'no-slip' | 'slip';
  outletPressure: number; // Pa

  // 同一守恒热求解器的两种热源边界
  thermalEnabled: boolean;
  thermalMode: 'fixed-temperature' | 'solid-power';
  dtSeconds: number;
  totalPowerW: number;
  solidDensityKgM3: number;
  solidSpecificHeatJkgK: number;
  solidConductivityWmK: number;
  thermalRegions: LbmThermalRegion[];
  thermalContacts: LbmThermalContact[];
  fluidSpecificHeatJkgK: number;
  fluidConductivityWmK: number;
  ambientTemp: number; // 环境温度 °C
  heatSourceTemp: number; // 热源温度 °C
}

export interface SimulationState {
  isRunning: boolean;
  isPaused: boolean;
  currentIteration: number;
  currentTime: number;
  convergenceHistory: number[];
  
  // 结果数据
  liftCoefficient: number | null;
  dragCoefficient: number | null;
  
  // 可视化状态
  visualizationMode: 'velocity' | 'pressure' | 'vorticity' | 'schlieren' | 'temperature';
  showStreamlines: boolean;
  showIsosurface: boolean;
  slicePlane: 'xy' | 'yz' | 'xz' | 'none';
  slicePosition: number; // 0-1
  showBoundary: boolean; // false = 渲染时裁掉最外 3 格边界作用层

  // 真实气动力系数历史（时序）
  cdHistory: number[];
  clHistory: number[];
  // 重置计数：递增触发求解器重建
  resetCount: number;
  playbackIndex: number; // -1 shows the final result
  isPlaying: boolean;
  playbackDuration: number;
  playbackLoop: boolean;
}

// 由单位换算派生的只读物理量
export interface DerivedQuantities {
  'mac-3d-v1'?: number;
  groundMode?: LbmGroundBoundary['mode'];
  groundClearanceM?: number;
  groundVelocityMps?: number;
  'lbm-ground-v1'?: number;
  'lbm-gauge-force-v1'?: number;
  precision?: string;
  viscosityMode?: 'physical' | 'stabilized-preview';
  requestedViscosityM2s?: number;
  simulatedViscosityM2s?: number;
  ambientC?: number;
  temperatureScaleC?: number;
  pressureScalePa?: number; // Saved multiplier: lattice gauge pressure → Pa.
  thermalDiffusivityPhysical?: number;
  dx: number; // 米/格
  dt: number; // 秒/步（真实物理时间步长）
  reynoldsPhysical: number; // 输入物性的目标雷诺数
  reynoldsLattice: number; // 模拟黏度对应的实际雷诺数
  referenceArea: number; // 参考面积 m²（迎风投影）
  cellCount: number; // 格子总数
  solidCells: number; // 实心格子数
}

export interface SimulationResults {
  thermal: LbmThermalResult | null;
  flowSnapshot: LbmDisplaySnapshot | MacFlowSnapshot | null;
  flowFrames: (LbmDisplaySnapshot | MacFlowSnapshot)[];
  job: { spec: JobSpecV1; result: JobResultV1 } | null;
  pressureField: Float32Array | null;
  velocityField: Float32Array | null;
  vorticityField: Float32Array | null;
  
  // 表面数据
  surfacePressure: Float32Array | null;
  surfaceShearStress: Float32Array | null;
  
  // 积分量
  forces: {
    lift: number | null;
    drag: number | null;
    side: number | null;
    /** 当前求解器未计算力矩时为 null。 */
    moment: [number, number, number] | null;
  };
}

export type SolverType = 'lbm' | 'navier-stokes' | 'potential';

export interface SolverConfig {
  type: SolverType;
  latticeType?: 'D2Q9' | 'D3Q15' | 'D3Q19' | 'D3Q27';
  relaxationTime?: number;
  reynoldsNumber?: number;
}

export interface GPUSimulationContext {
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  isInitialized: boolean;
  isSupported: boolean;
  errorMessage: string | null;
}

export interface SimulationSnapshot {
  timestamp: number;
  iteration: number;
  parameters: WindTunnelParameters;
  results: SimulationResults;
}
