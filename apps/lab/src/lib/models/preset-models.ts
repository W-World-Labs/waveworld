// 预设演示模型生成器
//
// 加载口径（loadPresetModel）：public/models/ 下有对应文件时优先用真实模型文件，
// 没有则回落到程序化生成。文件命名见 PRESET_MODELS 的 modelUrl，下载与制作要求见
// public/models/README.md。

import type { ModelGeometry, ModelMetadata, PresetModel } from '../../types/model';
import { assertGeometryContract, inspectGeometryTopology } from './geometry-contract';
import { parseModelFile } from './parser';

/** Resolve public asset path under Next basePath (e.g. /app/lab/models/…). */
export function publicAssetUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = (process.env.NEXT_PUBLIC_TUANLIU_BASE_PATH || '').replace(/\/$/, '');
  return `${base}${path}`;
}

export const PRESET_MODELS: PresetModel[] = [
  {
    id: 'naca0012',
    name: 'NACA 0012 翼型',
    category: 'airfoil',
    description: '经典对称翼型，常用于风洞试验',
    thumbnailUrl: '/models/naca0012.png',
    modelUrl: '/models/naca0012.stl',
    defaultParameters: {
      angleOfAttack: 5,
      referenceArea: 1.0,
      referenceLength: 1.0,
    },
  },
  {
    id: 'cylinder',
    name: '圆柱体',
    category: 'custom',
    description: '基础流体力学验证模型',
    thumbnailUrl: '/models/cylinder.png',
    modelUrl: '/models/cylinder.stl',
    defaultParameters: {
      referenceArea: 0.785,
      referenceLength: 1.0,
    },
  },
  {
    id: 'sphere',
    name: '球体',
    category: 'custom',
    description: '三维绕流经典案例',
    thumbnailUrl: '/models/sphere.png',
    modelUrl: '/models/sphere.stl',
    defaultParameters: {
      referenceArea: 0.785,
      referenceLength: 1.0,
    },
  },
  {
    id: 'car',
    name: '简化汽车',
    category: 'vehicle',
    description: '汽车空气动力学分析',
    thumbnailUrl: '/models/car.png',
    modelUrl: '/models/car.stl',
    defaultParameters: {
      referenceArea: 2.5,
      referenceLength: 4.5,
    },
  },
  {
    id: 'airplane',
    name: '简化飞机',
    category: 'vehicle',
    description: '飞机整机气动分析',
    thumbnailUrl: '/models/airplane.png',
    modelUrl: '/models/airplane.stl',
    defaultParameters: {
      referenceArea: 20.0,
      referenceLength: 10.0,
    },
  },
  {
    id: 'ahmed-body',
    name: 'Ahmed 车体',
    category: 'vehicle',
    description: '自有教学近似几何；不是标准 Ahmed 参考网格或验证依据',
    thumbnailUrl: '/models/ahmed.png',
    modelUrl: '/models/ahmed.stl',
    defaultParameters: {
      referenceArea: 1.2,
      referenceLength: 1.0,
    },
  },
  {
    id: 'onera-m6',
    name: 'ONERA M6 机翼',
    category: 'airfoil',
    description: '跨声速机翼标准验证算例（半模）',
    thumbnailUrl: '/models/onera-m6.png',
    modelUrl: '/models/onera-m6.stl',
    defaultParameters: {
      angleOfAttack: 3.06,
      referenceArea: 0.7532,
      referenceLength: 0.64607,
    },
  },
  {
    id: 'desktop-airflow',
    name: '台式机箱风道',
    category: 'custom',
    description: '前后开口、机箱壁和内部挡块；内置恒压风扇，先观察风道与绕流',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.45,
      thermalEnabled: false,
      inletVelocity: 0,
      modelResolution: 'high',
      fan: { center: [0.15, 0.65, 0.5], axis: 'x', radiusM: 0.06, pressureRisePa: 20 },
    },
  },
  {
    id: 'laptop-airflow',
    name: '笔记本风道（简化）',
    category: 'custom',
    description: '薄型风道与内部挡块；内置恒压风扇，用于基础气流演示',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.32,
      thermalEnabled: false,
      inletVelocity: 0,
      modelResolution: 'high',
      fan: { center: [0.15, 0.5, 0.5], axis: 'x', radiusM: 0.01, pressureRisePa: 15 },
    },
  },
  {
    id: 'server-chassis',
    name: '服务器机箱（结构示例）',
    category: 'custom',
    description: '贯通前后开口、主板、双处理器散热片、内存与电源；加厚组件用于风道起始演示，未标定真实服务器风扇与热参数',
    thumbnailUrl: '/models/server-chassis.png',
    modelUrl: '/models/server-chassis.stl',
    defaultParameters: {
      thermalEnabled: false,
      inletVelocity: 1,
      viscosityMode: 'stabilized-preview',
      referenceArea: 0.036,
      referenceLength: 0.45,
      gridPreset: 'fast',
      modelResolution: 'high',
      angleOfAttack: 0,
      turbulenceIntensity: 0,
    },
  },
  {
    id: 'server-thermal',
    name: '服务器机箱散热（分区功耗）',
    category: 'custom',
    description: '与 server-chassis 相同的 20 组结构；双 CPU、内存与电源按分区固体功率发热，铝散热片与机箱导热，CPU—散热片间含界面热阻，尾部低压演示风扇驱动气流；默认计算 10 秒能量收支，受粗网格格子速度上限约束、非真实散热标定',
    thumbnailUrl: '/models/server-chassis.png',
    modelUrl: '',
    defaultParameters: {
      referenceArea: 0.036,
      referenceLength: 0.45,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'high',
      angleOfAttack: 0, turbulenceIntensity: 0,
      ambientTemp: 25, totalPowerW: 0, dtSeconds: 0.014,
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 200,
      // 区域 bounds 归一化到整机包围盒 x∈[-0.225,0.225]、y∈[0,0.09]、z∈[-0.2,0.2]，
      // 各自恰好覆盖一个结构组件：处理器封装、散热片组（均热板+鳍片）、内存条、电源。
      thermalRegions: [
        { name: 'CPU 0', bounds: { min: [0.5222, 0.2667, 0.1875], max: [0.6556, 0.4, 0.3625] }, totalPowerW: 60,
          solidDensityKgM3: 2330, solidSpecificHeatJkgK: 700, solidConductivityWmK: 120 },
        { name: '散热片 0', bounds: { min: [0.4889, 0.4, 0.15], max: [0.6889, 0.7333, 0.4] }, totalPowerW: 0,
          solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 167 },
        { name: 'CPU 1', bounds: { min: [0.5222, 0.2667, 0.6375], max: [0.6556, 0.4, 0.8125] }, totalPowerW: 60,
          solidDensityKgM3: 2330, solidSpecificHeatJkgK: 700, solidConductivityWmK: 120 },
        { name: '散热片 1', bounds: { min: [0.4889, 0.4, 0.6], max: [0.6889, 0.7333, 0.85] }, totalPowerW: 0,
          solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 167 },
        { name: '内存 0', bounds: { min: [0.3889, 0.2667, 0.0725], max: [0.7444, 0.5333, 0.1025] }, totalPowerW: 8,
          solidDensityKgM3: 1800, solidSpecificHeatJkgK: 800, solidConductivityWmK: 40 },
        { name: '内存 1', bounds: { min: [0.3889, 0.2667, 0.8975], max: [0.7444, 0.5333, 0.9275] }, totalPowerW: 8,
          solidDensityKgM3: 1800, solidSpecificHeatJkgK: 800, solidConductivityWmK: 40 },
        { name: '电源', bounds: { min: [0.7667, 0.1333, 0.7375], max: [0.9889, 0.6889, 0.9625] }, totalPowerW: 40,
          solidDensityKgM3: 4000, solidSpecificHeatJkgK: 600, solidConductivityWmK: 50 },
      ],
      // CPU 顶面与散热片底面共享体素面；界面热阻按 TIM 量级设置。
      thermalContacts: [
        { first: 1, second: 2, resistanceM2KW: 0.0002 },
        { first: 3, second: 4, resistanceM2KW: 0.0002 },
      ],
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
      // 尾部排气风扇：物理空气黏性 + 0.45 m 机箱要求 dt≥~12 ms 才能满足 tau≥0.505，
      // 格子速度上限 0.2 随之限制可解析风速；0.003 Pa 压升对应约 0.07 m/s 演示气流。
      fan: { center: [0.9444, 0.5, 0.5], axis: 'x', radiusM: 0.03, pressureRisePa: 0.003 },
    },
  },
  {
    id: 'desktop-thermal',
    name: '台式机箱散热（分区功耗）',
    category: 'custom',
    description: '与台式机箱风道相同的前后开口机箱；CPU 区 100W、显卡区 120W、上部电源区 80W 分区发热，前进后出风扇驱动气流，机箱壁按钢板导热；默认 10 秒能量收支，演示量级非整机散热标定',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.45,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'high',
      angleOfAttack: 0, turbulenceIntensity: 0,
      ambientTemp: 25, totalPowerW: 0, dtSeconds: 0.014,
      // 机箱壁与未覆盖挡块：钢板近似。
      solidDensityKgM3: 7850, solidSpecificHeatJkgK: 500, solidConductivityWmK: 50,
      // 区域 bounds 归一化到整机包围盒 x∈[-0.225,0.225]、y∈[0,0.45]、z∈[-0.11,0.11]；
      // CPU 与显卡区沿 z 平分主板/显卡挡块，电源区覆盖上部挡块。
      thermalRegions: [
        { name: 'CPU 区', bounds: { min: [0.5333, 0.0333, 0.1364], max: [0.8667, 0.2556, 0.5] }, totalPowerW: 100,
          solidDensityKgM3: 1800, solidSpecificHeatJkgK: 800, solidConductivityWmK: 40 },
        { name: '显卡区', bounds: { min: [0.5333, 0.0333, 0.5], max: [0.8667, 0.2556, 0.8636] }, totalPowerW: 120,
          solidDensityKgM3: 1800, solidSpecificHeatJkgK: 800, solidConductivityWmK: 40 },
        { name: '电源/上部组件', bounds: { min: [0.4667, 0.4111, 0.0682], max: [0.6444, 0.6111, 0.3864] }, totalPowerW: 80,
          solidDensityKgM3: 4000, solidSpecificHeatJkgK: 600, solidConductivityWmK: 50 },
      ],
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
      fan: { center: [0.15, 0.65, 0.5], axis: 'x', radiusM: 0.06, pressureRisePa: 0.003 },
    },
  },
  {
    id: 'laptop-thermal',
    name: '笔记本散热（分区功耗）',
    category: 'custom',
    description: '与笔记本风道相同的薄型机壳；SoC 区与电池区按分区功率发热，鼓风风扇驱动气流；默认 10 秒能量收支，演示量级非整机散热标定',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.32,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'high',
      angleOfAttack: 0, turbulenceIntensity: 0,
      ambientTemp: 25, totalPowerW: 0, dtSeconds: 0.01,
      // 机壳与未覆盖挡块：铝合金近似。
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 160,
      // 区域 bounds 归一化到整机包围盒 x∈[-0.16,0.16]、y∈[0,0.035]、z∈[-0.12,0.12]。
      thermalRegions: [
        { name: 'SoC/处理器区', bounds: { min: [0.4688, 0.1714, 0.3958], max: [0.625, 0.4571, 0.6042] }, totalPowerW: 15,
          solidDensityKgM3: 2330, solidSpecificHeatJkgK: 700, solidConductivityWmK: 120 },
        { name: '电池区', bounds: { min: [0.6641, 0.1429, 0.0729], max: [0.8672, 0.3714, 0.3854] }, totalPowerW: 2,
          solidDensityKgM3: 2500, solidSpecificHeatJkgK: 900, solidConductivityWmK: 30 },
      ],
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
      fan: { center: [0.15, 0.5, 0.5], axis: 'x', radiusM: 0.01, pressureRisePa: 0.003 },
    },
  },
  {
    id: 'phone-thermal',
    name: '手机散热（无风扇自然对流）',
    category: 'custom',
    description: '150×75×8 mm 封闭薄板机身；SoC 与电池按分区功率发热，外壳铝板导热，外部空气由浮力驱动自然对流；无风扇。机身厚度仅约 2 个格点，器件功率按足印投影到该范围内的实体体素（亚网格等效热源）。默认 10 秒能量收支，未含辐射换热，演示量级非整机散热标定',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.15,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'high',
      angleOfAttack: 0, turbulenceIntensity: 0,
      ambientTemp: 25, totalPowerW: 0, dtSeconds: 0.01,
      // 外壳与未覆盖区域：铝合金近似。
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 160,
      // 区域 bounds 归一化到整机包围盒 x∈[-0.075,0.075]、y∈[0,0.008]、z∈[-0.0375,0.0375]；
      // 机身厚度仅 ~2 格点，y 向取全厚度投影，功率注入足印内已解析的实体体素。
      thermalRegions: [
        { name: 'SoC', bounds: { min: [0.16, 0, 0.1533], max: [0.24, 1, 0.3133] }, totalPowerW: 5,
          solidDensityKgM3: 2330, solidSpecificHeatJkgK: 700, solidConductivityWmK: 120 },
        { name: '电池', bounds: { min: [0.3667, 0, 0.2333], max: [0.9, 1, 0.9] }, totalPowerW: 1,
          solidDensityKgM3: 2500, solidSpecificHeatJkgK: 900, solidConductivityWmK: 30 },
      ],
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
    },
  },
  {
    id: 'tablet-thermal',
    name: '平板散热（无风扇自然对流）',
    category: 'custom',
    description: '250×170×7 mm 封闭薄板机身；SoC 与电池按分区功率发热，外壳铝板导热，外部空气由浮力驱动自然对流；无风扇。机身厚度约 1 个格点，器件功率按足印投影到外壳体素（亚网格等效热源）。默认 10 秒能量收支，未含辐射换热，演示量级非整机散热标定',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.25,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'high',
      angleOfAttack: 0, turbulenceIntensity: 0,
      ambientTemp: 25, totalPowerW: 0, dtSeconds: 0.01,
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 160,
      // 区域 bounds 归一化到整机包围盒 x∈[-0.125,0.125]、y∈[0,0.007]、z∈[-0.085,0.085]；
      // 机身厚度仅 ~1 格点，y 向取全厚度投影，功率注入足印内的外壳体素。
      thermalRegions: [
        { name: 'SoC', bounds: { min: [0.148, 0, 0.1882], max: [0.212, 1, 0.2824] }, totalPowerW: 8,
          solidDensityKgM3: 2330, solidSpecificHeatJkgK: 700, solidConductivityWmK: 120 },
        { name: '电池', bounds: { min: [0.3, 0, 0.2647], max: [0.86, 1, 0.8529] }, totalPowerW: 2,
          solidDensityKgM3: 2500, solidSpecificHeatJkgK: 900, solidConductivityWmK: 30 },
      ],
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
    },
  },
  {
    id: 'heatsink',
    name: '鳍片散热器',
    category: 'custom',
    description: '9 cm 直鳍片散热器，表面 60°C、环境 25°C；默认计算 10 秒自然对流过程，非稳态散热结论',
    thumbnailUrl: '/models/heatsink.png',
    modelUrl: '/models/heatsink.stl',
    defaultParameters: {
      thermalEnabled: true,
      thermalMode: 'fixed-temperature',
      inletVelocity: 0,
      referenceArea: 0.002,
      referenceLength: 0.09,
      gridPreset: 'fast',
      modelResolution: 'standard',
      ambientTemp: 25,
      heatSourceTemp: 60,
    },
  },
  {
    id: 'cube',
    name: '立方体',
    category: 'custom',
    description: '基础钝体绕流验证（边长 1 m）',
    thumbnailUrl: '/models/cube.png',
    modelUrl: '/models/cube.stl',
    defaultParameters: {
      referenceArea: 1.0,
      referenceLength: 1.0,
    },
  },
  {
    id: 'heated-block',
    name: '厘米级发热块',
    category: 'custom',
    description: '10 mm 均匀材料立方体、10 W 总功率；默认计算 10 秒导热与能量收支，非稳态散热结论',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.01, referenceArea: 0.0001,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'coarse',
      angleOfAttack: 0, turbulenceIntensity: 0,
      ambientTemp: 25, totalPowerW: 10, dtSeconds: 0.0001,
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 200,
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
    },
  },
  {
    id: 'thermal-assembly',
    name: '双材料导热与局部发热',
    category: 'custom',
    description: '10 mm 模型分为相接的发热部件和导热部件；分别设置材料，10 W 只输入发热部件',
    thumbnailUrl: '',
    modelUrl: '',
    defaultParameters: {
      referenceLength: 0.01, referenceArea: 0.0001,
      thermalEnabled: true, thermalMode: 'solid-power', inletVelocity: 0,
      gridPreset: 'fast', modelResolution: 'coarse',
      angleOfAttack: 0, turbulenceIntensity: 0, ambientTemp: 25, totalPowerW: 0, dtSeconds: 0.0001,
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 200,
      thermalRegions: [
        { name: '发热部件', bounds: { min: [0, 0, 0], max: [0.35, 1, 1] }, totalPowerW: 10,
          solidDensityKgM3: 2500, solidSpecificHeatJkgK: 700, solidConductivityWmK: 40 },
        { name: '导热部件', bounds: { min: [0.35, 0, 0], max: [1, 1, 1] }, totalPowerW: 0,
          solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 200 },
      ],
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, fluidSpecificHeatJkgK: 1005, fluidConductivityWmK: 0.026,
    },
  },
  {
    id: 'cone',
    name: '圆锥体',
    category: 'custom',
    description: '锥形钝体，观察尖端与底部分离',
    thumbnailUrl: '/models/cone.png',
    modelUrl: '/models/cone.stl',
    defaultParameters: {
      referenceArea: 0.785,
      referenceLength: 1.5,
    },
  },
  {
    id: 'building',
    name: '简化高楼',
    category: 'building',
    description: '高层建筑绕流与尾流演示',
    thumbnailUrl: '/models/building.png',
    modelUrl: '/models/building.stl',
    defaultParameters: {
      referenceArea: 2.4,
      referenceLength: 0.8,
      inletVelocity: 15,
      modelResolution: 'coarse',
    },
  },
  {
    id: 'drivaer-lite',
    name: '轿车（简化）',
    category: 'vehicle',
    description: '带轮毂/后视镜的简化轿车外形',
    thumbnailUrl: '/models/drivaer-lite.png',
    modelUrl: '/models/drivaer-lite.stl',
    defaultParameters: {
      referenceArea: 2.2,
      referenceLength: 4.6,
      inletVelocity: 30,
    },
  },
  {
    id: 'milk-truck',
    name: '牛奶车',
    category: 'vehicle',
    description: 'Khronos 示例 CesiumMilkTruck · 体素重网格水密版',
    thumbnailUrl: '/models/milk-truck.png',
    modelUrl: '/models/milk-truck-solid.stl',
    defaultParameters: {
      referenceArea: 4.0,
      referenceLength: 5.0,
      inletVelocity: 20,
    },
  },
  {
    id: 'duck',
    name: '橡皮鸭（glTF）',
    category: 'custom',
    description: 'Khronos Duck 示例模型，趣味绕流演示',
    thumbnailUrl: '/models/duck.png',
    modelUrl: '/models/duck.glb',
    defaultParameters: {
      referenceArea: 0.5,
      referenceLength: 1.0,
    },
  },
  // —— 2026-07 扩充：网上下载 / 自建（见 public/models/README.md）——
  {
    id: 'toy-car',
    name: '玩具汽车',
    category: 'vehicle',
    description: 'Khronos ToyCar 示例 · 体素重网格水密版',
    thumbnailUrl: '/models/toy-car.png',
    modelUrl: '/models/toy-car-solid.stl',
    defaultParameters: {
      referenceArea: 1.8,
      referenceLength: 3.5,
      inletVelocity: 25,
    },
  },
  {
    id: 'bicycle',
    name: '自行车',
    category: 'vehicle',
    description: '双轮自行车外形（Y-up 风洞向 · 体素重网格水密版）',
    thumbnailUrl: '/models/bicycle.png',
    modelUrl: '/models/bicycle-solid.stl',
    defaultParameters: {
      referenceArea: 0.45,
      referenceLength: 1.8,
      inletVelocity: 12,
    },
  },
  {
    id: 'rocket',
    name: '探测火箭（NASA）',
    category: 'vehicle',
    description: 'NASA Explorer Jupiter-C · 公共域 · 已将原 +Y 鼻尖方向转至 −X',
    thumbnailUrl: '/models/rocket.png',
    modelUrl: '/models/rocket-solid.stl',
    defaultParameters: {
      referenceArea: 1.5,
      referenceLength: 8.0,
      inletVelocity: 80,
      angleOfAttack: 0,
    },
  },
  {
    id: 'ares-rocket',
    name: 'Ares I 运载火箭（NASA）',
    category: 'vehicle',
    description: 'NASA Ares 1 · 主箭体水密重网格，已烘焙 −X 朝向与 90m 尺度（游离装配件未含）',
    thumbnailUrl: '/models/ares-rocket.png',
    modelUrl: '/models/ares-rocket-solid.stl',
    defaultParameters: {
      referenceArea: 12.0,
      referenceLength: 90.0,
      inletVelocity: 100,
    },
  },
  {
    id: 'space-shuttle',
    name: '航天飞机（NASA）',
    category: 'vehicle',
    description: 'NASA Space Shuttle (A) · 公共域 · 已将原 −Z 机鼻方向转至 −X',
    thumbnailUrl: '/models/space-shuttle.png',
    modelUrl: '/models/space-shuttle-solid.stl',
    defaultParameters: {
      referenceArea: 250.0,
      referenceLength: 37.0,
      inletVelocity: 60,
      angleOfAttack: 5,
    },
  },
  {
    id: 'airplane-x57',
    name: 'NASA X-57 电动飞机',
    category: 'vehicle',
    description: 'NASA X-57 Maxwell · 减面 + 体素重网格水密版（原文件超展开上限）',
    thumbnailUrl: '/models/airplane-x57.png',
    modelUrl: '/models/airplane-x57-solid.stl',
    defaultParameters: {
      referenceArea: 14.0,
      referenceLength: 9.0,
      inletVelocity: 45,
      angleOfAttack: 3,
    },
  },
];

export function generatePresetModel(presetId: string): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const model = generatePreset(presetId);
  Object.assign(model.metadata, inspectGeometryTopology(model.geometry));
  return model;
}

function generatePreset(presetId: string): { metadata: ModelMetadata; geometry: ModelGeometry } {
  switch (presetId) {
    case 'naca0012':
      return generateNACA0012();
    case 'cylinder':
      return generateCylinder();
    case 'sphere':
      return generateSphere();
    case 'car':
      return generateCar();
    case 'airplane':
      return generateAirplane();
    case 'ahmed-body':
      return generateAhmedBody();
    case 'heatsink':
      return generateHeatSink();
    case 'onera-m6':
      return generateOneraM6();
    case 'server-chassis':
      return generateServerChassis();
    case 'server-thermal':
      return generateServerChassis('server-thermal', '服务器机箱散热（分区功耗）');
    case 'desktop-airflow':
    case 'laptop-airflow':
      return generateComputerAirflow(presetId);
    case 'desktop-thermal':
    case 'laptop-thermal': {
      // 与风道预设共享几何；散热语义全部由 defaultParameters 提供。
      const thermal = generateComputerAirflow(presetId === 'desktop-thermal' ? 'desktop-airflow' : 'laptop-airflow');
      thermal.metadata.id = presetId;
      thermal.metadata.name = presetId === 'desktop-thermal' ? '台式机箱散热（分区功耗）' : '笔记本散热（分区功耗）';
      return thermal;
    }
    case 'phone-thermal':
    case 'tablet-thermal':
      return generateClosedDevice(presetId);
    case 'cube':
      return generateCube();
    case 'heated-block':
      return generateCube(0.01, 'heated-block', '厘米级发热块');
    case 'thermal-assembly':
      return generateCube(0.01, 'thermal-assembly', '双材料导热与局部发热');
    case 'cone':
      return generateCone();
    case 'building':
      return generateBuilding();
    case 'drivaer-lite':
      return generateDrivAerLite();
    case 'bicycle':
    case 'toy-car':
    case 'milk-truck':
    case 'duck':
    case 'rocket':
    case 'ares-rocket':
    case 'space-shuttle':
    case 'airplane-x57':
      throw new Error(`预设「${presetId}」仅支持原始文件，没有对应的程序化模型`);
    default:
      throw new Error(`未知的预设模型: ${presetId}`);
  }
}

export type LoadPresetOptions = {
  onProgress?: (progress: number) => void;
  /** Cancel in-flight fetch when the user switches presets mid-load. */
  signal?: AbortSignal;
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  if (name === 'AbortError') return true;
  // Node undici / some polyfills use DOMException code 20
  const code = (err as { code?: number | string }).code;
  return code === 20 || code === 'ABORT_ERR';
}

// 文件优先；失败后仅可回退到同款程序化模型，其余保留具体加载错误。
// 用户切换模型触发 abort 时向上抛出 AbortError，不回退程序化、不写 warning。
export async function loadPresetModel(
  preset: PresetModel,
  onProgressOrOptions?: ((progress: number) => void) | LoadPresetOptions,
  maybeSignal?: AbortSignal
): Promise<{ metadata: ModelMetadata; geometry: ModelGeometry; fromFile: boolean; warning?: string }> {
  const options: LoadPresetOptions =
    typeof onProgressOrOptions === 'function'
      ? { onProgress: onProgressOrOptions, signal: maybeSignal }
      : onProgressOrOptions ?? {};
  const onProgress = options.onProgress;
  const signal = options.signal;

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  let warning: string | undefined;
  if (preset.modelUrl) {
    try {
      // One GET is the source of truth. The old selector fired a HEAD for every
      // preset on mount, creating an avoidable request storm and aborted probes.
      // Build-time public/models/manifest.json lists shipped files without probes.
      onProgress?.(5);
      // 与 models-manifest 一致必须有界：多数调用方（lab/page、hq-lab-adapter、
      // sim-session）不传 signal，挂起的连接会让加载 Promise 永久 pending。
      // 超时走 TimeoutError → 程序化回退 warning，不会误判为用户 abort。
      const res = await fetch(publicAssetUrl(preset.modelUrl), {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) throw new Error('模型地址返回了 HTML，而不是模型文件');
      const blob = await res.blob();
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      const fileName = preset.modelUrl.split('/').pop() ?? `${preset.id}.stl`;
      const file = new File([blob], fileName);
      // parseModelFile 内含 assertGeometryContract；失败走 catch → 程序化回退
      const parsed = await parseModelFile(file, onProgress);
      const { applyPresetSolidGroups, loadModelsManifest } = await import('./models-manifest');
      const manifest = await loadModelsManifest(signal);
      if (!manifest) throw new Error('模型清单缺失或版本过旧，无法确认实体分组');
      const geometry = await applyPresetSolidGroups(parsed.geometry, await file.arrayBuffer(), manifest?.files.find(entry => entry.file === fileName));
      const metadata = parsed.metadata;
      if (geometry !== parsed.geometry) Object.assign(metadata, inspectGeometryTopology(geometry));
      // Explicit poses of these shipped scenes, not a longest-bounding-axis heuristic.
      // Jupiter-C nose +Y -> -X (Rz +90°); shuttle nose -Z -> -X (Ry +90°).
      if (preset.id === 'rocket' || preset.id === 'space-shuttle') {
        for (const coordinates of [geometry.vertices, geometry.normals]) {
          for (let i = 0; i < coordinates.length; i += 3) {
            const x = coordinates[i];
            if (preset.id === 'rocket') {
              coordinates[i] = -coordinates[i + 1]; coordinates[i + 1] = x;
            } else {
              coordinates[i] = coordinates[i + 2]; coordinates[i + 2] = -x;
            }
          }
        }
        metadata.boundingBox = computeBoundingBox(geometry.vertices);
      }
      signal?.throwIfAborted();
      // 覆写 id/name，保持与预设选择器/存储口径一致
      metadata.id = preset.id;
      metadata.name = preset.name;
      return { metadata, geometry, fromFile: true };
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        throw err instanceof Error ? err : new DOMException('The operation was aborted.', 'AbortError');
      }
      console.warn(`预设模型文件加载失败: ${preset.modelUrl}`, err);
      warning = err instanceof Error ? err.message : String(err);
    }
  }
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  let generated: ReturnType<typeof generatePresetModel>;
  try { generated = generatePresetModel(preset.id); }
  catch (error) { throw new Error(`无法加载原始模型「${preset.name}」：${warning ?? (error instanceof Error ? error.message : String(error))}`); }
  const { metadata, geometry } = generated;
  // Procedural meshes should always satisfy the contract; assert so regressions surface.
  try {
    assertGeometryContract(geometry);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`程序化预设「${preset.id}」未通过几何契约: ${detail}`);
  }
  onProgress?.(100);
  return { metadata, geometry, fromFile: false, warning };
}

// 由顶点数组计算包围盒
function computeBoundingBox(vertices: ArrayLike<number>): ModelMetadata['boundingBox'] {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

// 生成 metadata（计数与包围盒从实际几何计算）
function makeMetadata(id: string, name: string, vertices: number[], indices: number[]): ModelMetadata {
  return {
    id,
    name,
    format: 'stl',
    fileSize: vertices.length * 4,
    uploadDate: new Date(),
    vertexCount: vertices.length / 3,
    faceCount: indices.length / 3,
    boundingBox: computeBoundingBox(vertices),
    isWatertight: false, // Checked once by generatePresetModel after geometry construction.
    hasNormals: true,
    hasUVs: false,
    manifoldEdges: 0,
    nonManifoldEdges: 0,
  };
}

// NACA 0012 翼型（封闭挤出实体，可体素化）
function generateNACA0012(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const n = 40; // 每面 40 段（余弦聚类加密前后缘）
  const thickness = 0.12;
  const span = 0.5;

  const yt = (x: number) =>
    (thickness / 0.2) * (
      0.2969 * Math.sqrt(x) -
      0.1260 * x -
      0.3516 * x * x +
      0.2843 * x * x * x -
      0.1015 * x * x * x * x
    );

  // 翼型轮廓：后缘 → 上表面 → 前缘 → 下表面 → 后缘（闭合）
  const outline: Array<[number, number]> = [];
  for (let i = n; i >= 0; i--) {
    const x = 0.5 * (1 - Math.cos((i / n) * Math.PI));
    outline.push([x, yt(x)]);
  }
  for (let i = 1; i < n; i++) {
    const x = 0.5 * (1 - Math.cos((i / n) * Math.PI));
    outline.push([x, -yt(x)]);
  }
  const m = outline.length;

  const vertices: number[] = [];
  const indices: number[] = [];

  // 前后两圈顶点
  for (const [x, y] of outline) vertices.push(x, y, 0);
  for (const [x, y] of outline) vertices.push(x, y, span);

  // 侧面
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    indices.push(i, j, m + j);
    indices.push(i, m + j, m + i);
  }

  // 端盖（以轮廓质心为中心的扇形三角化）
  let ccx = 0, ccy = 0;
  for (const [x, y] of outline) { ccx += x; ccy += y; }
  ccx /= m; ccy /= m;
  const frontCenter = vertices.length / 3;
  vertices.push(ccx, ccy, 0);
  const backCenter = vertices.length / 3;
  vertices.push(ccx, ccy, span);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    indices.push(frontCenter, j, i);
    indices.push(backCenter, m + i, m + j);
  }

  const geometry: ModelGeometry = {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(vertices.length),
    indices: new Uint32Array(indices),
  };

  return { metadata: makeMetadata('naca0012', 'NACA 0012 翼型', vertices, indices), geometry };
}

// 圆柱体
function generateCylinder(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const segments = 32;
  const radius = 0.5;
  const height = 2.0;
  
  // 侧面顶点
  for (let i = 0; i <= segments; i++) {
    const angle = (i % segments / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    // 底部
    vertices.push(x, y, 0);
    // 顶部
    vertices.push(x, y, height);
  }
  
  // 侧面三角形
  for (let i = 0; i < segments; i++) {
    const bottomLeft = i * 2;
    const topLeft = i * 2 + 1;
    const bottomRight = (i + 1) * 2;
    const topRight = (i + 1) * 2 + 1;
    
    indices.push(bottomLeft, bottomRight, topLeft);
    indices.push(topLeft, bottomRight, topRight);
  }
  
  // 底面
  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) % segments / segments) * Math.PI * 2;
    
    const x1 = Math.cos(angle1) * radius;
    const y1 = Math.sin(angle1) * radius;
    const x2 = Math.cos(angle2) * radius;
    const y2 = Math.sin(angle2) * radius;
    
    const v1 = vertices.length / 3;
    vertices.push(x1, y1, 0);
    const v2 = vertices.length / 3;
    vertices.push(x2, y2, 0);
    
    indices.push(bottomCenter, v2, v1);
  }
  
  // 顶面
  const topCenter = vertices.length / 3;
  vertices.push(0, 0, height);
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) % segments / segments) * Math.PI * 2;
    
    const x1 = Math.cos(angle1) * radius;
    const y1 = Math.sin(angle1) * radius;
    const x2 = Math.cos(angle2) * radius;
    const y2 = Math.sin(angle2) * radius;
    
    const v1 = vertices.length / 3;
    vertices.push(x1, y1, height);
    const v2 = vertices.length / 3;
    vertices.push(x2, y2, height);
    
    indices.push(topCenter, v1, v2);
  }
  
  const geometry: ModelGeometry = {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(vertices.length),
    indices: new Uint32Array(indices),
  };
  
  const metadata: ModelMetadata = {
    id: 'cylinder',
    name: '圆柱体',
    format: 'stl',
    fileSize: vertices.length * 4,
    uploadDate: new Date(),
    vertexCount: vertices.length / 3,
    faceCount: indices.length / 3,
    boundingBox: {
      min: [-0.5, -0.5, 0],
      max: [0.5, 0.5, 2.0],
      center: [0, 0, 1.0],
      size: [1.0, 1.0, 2.0],
    },
    isWatertight: false, // Checked once by generatePresetModel after geometry construction.
    hasNormals: true,
    hasUVs: false,
    manifoldEdges: 0,
    nonManifoldEdges: 0,
  };
  
  return { metadata, geometry };
}

// 球体
function generateSphere(radius = 0.5, widthSegments = 32, heightSegments = 16, center: [number, number, number] = [0, 0, 0]): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const phi = v * Math.PI;
    
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const theta = x === widthSegments ? 0 : u * Math.PI * 2;
      const radial = y === 0 || y === heightSegments ? 0 : Math.sin(phi);
      
      const px = -radius * Math.cos(theta) * radial;
      const py = radius * Math.cos(phi);
      const pz = radius * Math.sin(theta) * radial;
      
      vertices.push(px + center[0], py + center[1], pz + center[2]);
    }
  }
  
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      
      if (y > 0) indices.push(a, b, a + 1);
      if (y < heightSegments - 1) indices.push(b, b + 1, a + 1);
    }
  }
  
  const geometry: ModelGeometry = {
    vertices: new Float32Array(vertices),
    normals: Float32Array.from(vertices, (value, i) => (value - center[i % 3]) / radius),
    indices: new Uint32Array(indices),
  };
  
  const metadata = makeMetadata('sphere', '球体', vertices, indices);

  return { metadata, geometry };
}

// 简化汽车
function generateCar(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [], indices: number[] = [];
  const L = 4.5, W = 1.8, H = 0.55;
  appendBox(vertices, indices, 0, H / 2 + 0.15, 0, L, H, W * 0.95);
  appendBox(vertices, indices, -0.15, H + 0.15 + 0.28, 0, L * 0.48, 0.55, W * 0.88);
  appendBox(vertices, indices, -L * 0.32, 0.15 + 0.32, 0, L * 0.28, 0.35, W * 0.9);
  appendBox(vertices, indices, L * 0.32, 0.15 + 0.38, 0, L * 0.22, 0.4, W * 0.9);
  for (const [x, z] of [[-1.4, -W / 2], [-1.4, W / 2], [1.35, -W / 2], [1.35, W / 2]]) {
    const first = vertices.length;
    appendCylinderX(vertices, indices, -0.22 / 2, 0.22 / 2, 0.32, 0.32, 0, 16);
    // Rigid +90° rotation about Y puts the wheel axle along vehicle width Z.
    for (let i = first; i < vertices.length; i += 3) {
      const axial = vertices[i];
      vertices[i] = x + vertices[i + 2];
      vertices[i + 2] = z - axial;
    }
  }
  return { metadata: makeMetadata('car', '简化汽车', vertices, indices), geometry: {
    vertices: new Float32Array(vertices), normals: new Float32Array(vertices.length), indices: new Uint32Array(indices),
    solidTriangleCounts: new Uint32Array([12, 12, 12, 12, 64, 64, 64, 64]),
  } };
}

// 简化飞机（封闭实体：带端盖机身 + 有厚度的机翼/尾翼）
function generateAirplane(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [], indices: number[] = [];
  appendCylinderX(vertices, indices, -5, 5, 0.55, 0, 0, 20);
  const nose = generateSphere(0.55, 16, 10, [-5, 0, 0]).geometry;
  const base = vertices.length / 3;
  vertices.push(...nose.vertices);
  indices.push(...Array.from(nose.indices, index => index + base));
  appendBox(vertices, indices, 0.2, -0.05, 0, 2.2, 0.18, 12);
  appendBox(vertices, indices, 4.2, 0.1, 0, 1.0, 0.12, 4.2);
  appendBox(vertices, indices, 4.2, 0.9, 0, 1.0, 1.5, 0.12);
  appendCylinderX(vertices, indices, -0.6, 1.0, 0.28, -0.45, -2.5, 12);
  appendCylinderX(vertices, indices, -0.6, 1.0, 0.28, -0.45, 2.5, 12);
  return { metadata: makeMetadata('airplane', '简化飞机', vertices, indices), geometry: {
    vertices: new Float32Array(vertices), normals: new Float32Array(vertices.length), indices: new Uint32Array(indices),
    solidTriangleCounts: new Uint32Array([80, 288, 12, 12, 12, 48, 48]),
  } };
}

// Ahmed 车体
function generateAhmedBody(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  
  // Ahmed 车体标准尺寸
  const length = 1.044;
  const width = 0.389;
  const height = 0.288;
  const slantAngle = 25; // 度
  
  // 简化：长方体 + 斜面
  vertices.push(
    // 底面
    0, -width/2, 0,
    length, -width/2, 0,
    length, width/2, 0,
    0, width/2, 0,
    // 顶面前部
    0, -width/2, height,
    length * 0.7, -width/2, height,
    length * 0.7, width/2, height,
    0, width/2, height,
    // 斜面后部
    length, -width/2, height * 0.5,
    length, width/2, height * 0.5
  );
  
  // 三角形
  indices.push(
    // 底面
    0, 2, 1, 0, 3, 2,
    // 顶面前部
    4, 5, 6, 4, 6, 7,
    // 前面
    0, 1, 5, 0, 5, 4,
    // 左面
    1, 2, 8, 1, 8, 5,
    // 右面
    3, 0, 4, 3, 4, 7,
    // 斜面
    5, 8, 9, 5, 9, 6,
    // 后面
    2, 3, 7, 2, 7, 6, 2, 6, 9, 2, 9, 8
  );
  
  const geometry: ModelGeometry = {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(vertices.length),
    indices: new Uint32Array(indices),
  };
  
  const metadata: ModelMetadata = {
    id: 'ahmed-body',
    name: 'Ahmed 车体',
    format: 'stl',
    fileSize: vertices.length * 4,
    uploadDate: new Date(),
    vertexCount: vertices.length / 3,
    faceCount: indices.length / 3,
    boundingBox: {
      min: [0, -0.1945, 0],
      max: [1.044, 0.1945, 0.288],
      center: [0.522, 0, 0.144],
      size: [1.044, 0.389, 0.288],
    },
    isWatertight: false, // Checked once by generatePresetModel after geometry construction.
    hasNormals: true,
    hasUVs: false,
    manifoldEdges: 0,
    nonManifoldEdges: 0,
  };
  
  return { metadata, geometry };
}

// 鳍片散热器（底座 + 6 片直鳍，鳍片与底座恰好相接不重叠，适配逐 z 切片体素化）
// 朝向：长轴沿 x，鳍片向 +y 立起（浮力上升方向），鳍面平行 x-y 平面，
// 鳍间形成竖直通道，自然对流与强制对流（沿 x）都适用。
// 尺寸按标准网格可解析性选取：90mm 长底座，鳍厚 4.5mm ≈ 2 格（标准解析度）。
function generateHeatSink(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];

  const L = 0.09;       // 底座长（x），即特征长度
  const W = 0.063;      // 底座宽（z）
  const T_BASE = 0.007; // 底座厚
  const H_FIN = 0.025;  // 鳍片高
  const T_FIN = 0.0045; // 鳍片厚
  const N_FIN = 6;
  const PITCH = 0.0105; // 鳍距（间隙 6mm）

  // 底座（y ∈ [0, T_BASE]）
  appendBox(vertices, indices, 0, T_BASE / 2, 0, L, T_BASE, W);

  // 鳍片组居中，底面与底座顶面共面相接（y ∈ [T_BASE, T_BASE + H_FIN]）
  const pack = N_FIN * T_FIN + (N_FIN - 1) * (PITCH - T_FIN);
  for (let k = 0; k < N_FIN; k++) {
    const z0 = -pack / 2 + k * PITCH;
    appendBox(vertices, indices, 0, T_BASE + H_FIN / 2, z0 + T_FIN / 2, L, H_FIN, T_FIN);
  }

  const geometry: ModelGeometry = {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(vertices.length),
    solidTriangleCounts: new Uint32Array(indices.length / 36).fill(12),
    indices: new Uint32Array(indices),
  };

  return { metadata: makeMetadata('heatsink', '鳍片散热器', vertices, indices), geometry };
}

// 追加封闭长方体（中心 + 尺寸）— 供多个生成器复用
function appendBox(
  vertices: number[],
  indices: number[],
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number
) {
  const base = vertices.length / 3;
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  vertices.push(
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1
  );
  indices.push(
    base + 0, base + 3, base + 2, base + 0, base + 2, base + 1,
    base + 4, base + 5, base + 6, base + 4, base + 6, base + 7,
    base + 0, base + 1, base + 5, base + 0, base + 5, base + 4,
    base + 3, base + 6, base + 2, base + 3, base + 7, base + 6,
    base + 0, base + 4, base + 7, base + 0, base + 7, base + 3,
    base + 1, base + 2, base + 6, base + 1, base + 6, base + 5
  );
}

function appendCylinderX(vertices: number[], indices: number[], x0: number, x1: number, r: number, cy: number, cz: number, seg: number) {
  const base = vertices.length / 3;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    vertices.push(x0, cy + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    vertices.push(x1, cy + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    indices.push(base + i, base + j, base + seg + j);
    indices.push(base + i, base + seg + j, base + seg + i);
  }
  const c0 = vertices.length / 3;
  vertices.push(x0, cy, cz);
  const c1 = vertices.length / 3;
  vertices.push(x1, cy, cz);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    indices.push(c0, base + j, base + i);
    indices.push(c1, base + seg + i, base + seg + j);
  }
}


// ONERA M6 半模（程序化回落：30° 前缘后掠 + 梯形 + NACA 近似厚度）
function generateOneraM6(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const semiSpan = 1.1963;
  const rootChord = 0.8059;
  const tipChord = 0.4532;
  const sweepLE = (30 * Math.PI) / 180;
  const sections = 12;
  const n = 28;
  const t = 0.098;
  const yt = (x: number) =>
    (t / 0.2) * (
      0.2969 * Math.sqrt(Math.max(0, x)) -
      0.1260 * x -
      0.3516 * x * x +
      0.2843 * x * x * x -
      0.1015 * x * x * x * x
    );

  const sectionPts = (chord: number, leX: number, z: number) => {
    const pts: Array<[number, number, number]> = [];
    for (let i = n; i >= 0; i--) {
      const u = 0.5 * (1 - Math.cos((i / n) * Math.PI));
      pts.push([leX + u * chord, yt(u) * chord, z]);
    }
    for (let i = 1; i < n; i++) {
      const u = 0.5 * (1 - Math.cos((i / n) * Math.PI));
      pts.push([leX + u * chord, -yt(u) * chord, z]);
    }
    return pts;
  };

  const rings: Array<Array<[number, number, number]>> = [];
  for (let s = 0; s <= sections; s++) {
    const eta = s / sections;
    const z = eta * semiSpan;
    const chord = rootChord * (1 - eta) + tipChord * eta;
    const leX = Math.tan(sweepLE) * z;
    rings.push(sectionPts(chord, leX, z));
  }
  const mRing = rings[0].length;
  for (const ring of rings) {
    for (const p of ring) vertices.push(...p);
  }
  for (let s = 0; s < sections; s++) {
    const b0 = s * mRing;
    const b1 = (s + 1) * mRing;
    for (let i = 0; i < mRing; i++) {
      const j = (i + 1) % mRing;
      indices.push(b0 + i, b0 + j, b1 + j);
      indices.push(b0 + i, b1 + j, b1 + i);
    }
  }
  // 简单端盖
  for (const [base, reverse] of [[0, true], [sections * mRing, false]] as const) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < mRing; i++) {
      cx += vertices[(base + i) * 3];
      cy += vertices[(base + i) * 3 + 1];
      cz += vertices[(base + i) * 3 + 2];
    }
    cx /= mRing; cy /= mRing; cz /= mRing;
    const c = vertices.length / 3;
    vertices.push(cx, cy, cz);
    for (let i = 0; i < mRing; i++) {
      const j = (i + 1) % mRing;
      if (reverse) indices.push(c, base + j, base + i);
      else indices.push(c, base + i, base + j);
    }
  }

  return {
    metadata: makeMetadata('onera-m6', 'ONERA M6 机翼', vertices, indices),
    geometry: {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(vertices.length),
      indices: new Uint32Array(indices),
    },
  };
}

/** Open-ended ducts keep interior cells connected; boxes are simplified obstacles, not thermal materials. */
function generateComputerAirflow(id: 'desktop-airflow' | 'laptop-airflow'): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const laptop = id === 'laptop-airflow';
  const [L, H, D, t] = laptop ? [0.32, 0.035, 0.24, 0.004] : [0.45, 0.45, 0.22, 0.012];
  const vertices: number[] = [];
  const indices: number[] = [];
  // Four walls; ends along x remain open. Adjacent wall boxes only touch.
  appendBox(vertices, indices, 0, t / 2, 0, L, t, D);
  appendBox(vertices, indices, 0, H - t / 2, 0, L, t, D);
  appendBox(vertices, indices, 0, H / 2, -D / 2 + t / 2, L, H - 2 * t, t);
  appendBox(vertices, indices, 0, H / 2, D / 2 - t / 2, L, H - 2 * t, t);
  if (laptop) {
    appendBox(vertices, indices, 0.015, 0.011, 0, 0.05, 0.01, 0.05);
    appendBox(vertices, indices, 0.085, 0.009, -0.065, 0.065, 0.008, 0.075);
  } else {
    appendBox(vertices, indices, 0.09, 0.065, 0, 0.15, 0.10, 0.16);
    appendBox(vertices, indices, 0.025, 0.23, -0.06, 0.08, 0.09, 0.07);
  }
  return {
    metadata: makeMetadata(id, laptop ? '笔记本风道（简化）' : '台式机箱风道', vertices, indices),
    geometry: { vertices: new Float32Array(vertices), normals: new Float32Array(vertices.length), indices: new Uint32Array(indices),
      solidTriangleCounts: new Uint32Array(indices.length / 36).fill(12) },
  };
}

// 封闭薄板机身（手机/平板）：六面机壳 + 内部 SoC 与电池挡块；内部空气被密封，
// 散热经外壳导热 + 外部空气浮力对流。几何与 thermalRegions 的归一化 bounds 对齐。
function generateClosedDevice(id: 'phone-thermal' | 'tablet-thermal'): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const phone = id === 'phone-thermal';
  const [L, H, D, t] = phone ? [0.15, 0.008, 0.075, 0.0015] : [0.25, 0.007, 0.17, 0.0015];
  const vertices: number[] = [];
  const indices: number[] = [];
  // Six closed walls; ends along x are sealed too (fanless device).
  appendBox(vertices, indices, 0, t / 2, 0, L, t, D);
  appendBox(vertices, indices, 0, H - t / 2, 0, L, t, D);
  appendBox(vertices, indices, 0, H / 2, -D / 2 + t / 2, L - 2 * t, H - 2 * t, t);
  appendBox(vertices, indices, 0, H / 2, D / 2 - t / 2, L - 2 * t, H - 2 * t, t);
  appendBox(vertices, indices, -L / 2 + t / 2, H / 2, 0, t, H - 2 * t, D - 2 * t);
  appendBox(vertices, indices, L / 2 - t / 2, H / 2, 0, t, H - 2 * t, D - 2 * t);
  if (phone) {
    // SoC 12×3×12 mm 与电池 80×3.5×50 mm，位于密封腔内。
    appendBox(vertices, indices, -0.045, 0.003, -0.02, 0.012, 0.003, 0.012);
    appendBox(vertices, indices, 0.02, 0.00325, 0.005, 0.08, 0.0035, 0.05);
  } else {
    // SoC 16×2.6×16 mm 与电池 140×2.6×100 mm。
    appendBox(vertices, indices, -0.08, 0.0028, -0.045, 0.016, 0.0026, 0.016);
    appendBox(vertices, indices, 0.02, 0.0028, 0.01, 0.14, 0.0026, 0.1);
  }
  return {
    metadata: makeMetadata(id, phone ? '手机散热（无风扇自然对流）' : '平板散热（无风扇自然对流）', vertices, indices),
    geometry: { vertices: new Float32Array(vertices), normals: new Float32Array(vertices.length), indices: new Uint32Array(indices),
      solidTriangleCounts: new Uint32Array(indices.length / 36).fill(12) },
  };
}

// Open-ended structural example. Dimensions are deliberately thick enough for the fast grid;
// this is not an Olympus CAD model or a calibrated server thermal assembly.
// server-thermal shares the identical mesh; only metadata id/name differ.
function generateServerChassis(id = 'server-chassis', name = '服务器机箱（结构示例）'): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const L = 0.45, H = 0.09, D = 0.4, t = 0.012;
  appendBox(vertices, indices, 0, t / 2, 0, L, t, D);
  appendBox(vertices, indices, 0, H - t / 2, 0, L, t, D);
  appendBox(vertices, indices, 0, H / 2, -D / 2 + t / 2, L, H - 2 * t, t);
  appendBox(vertices, indices, 0, H / 2, D / 2 - t / 2, L, H - 2 * t, t);
  // No front/rear plate: adding boxes over a plate never cuts ventilation holes.
  appendBox(vertices, indices, 0.04, 0.018, 0, 0.22, 0.012, 0.36); // motherboard
  for (const z of [-0.09, 0.09]) {
    appendBox(vertices, indices, -0.145, 0.024, z, 0.11, 0.024, 0.12); // drive bay
    appendBox(vertices, indices, 0.04, 0.03, z, 0.06, 0.012, 0.07); // processor package
    appendBox(vertices, indices, 0.04, 0.042, z, 0.09, 0.012, 0.10); // heat spreader
    for (const offset of [-0.036, 0, 0.036]) {
      // 12 mm fins, 24 mm clear spacing; gaps run with the flow along X.
      appendBox(vertices, indices, 0.04, 0.057, z + offset, 0.09, 0.018, 0.012);
    }
  }
  for (const z of [-0.165, 0.165]) {
    appendBox(vertices, indices, 0.03, 0.036, z, 0.16, 0.024, 0.012); // memory bank
  }
  appendBox(vertices, indices, 0.17, 0.037, 0.14, 0.10, 0.05, 0.09); // power supply
  return {
    metadata: makeMetadata(id, name, vertices, indices),
    geometry: {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(vertices.length),
      solidTriangleCounts: new Uint32Array(indices.length / 36).fill(12),
      indices: new Uint32Array(indices),
    },
  };
}

function generateCube(size = 1, id = 'cube', name = '立方体'): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  appendBox(vertices, indices, 0, 0, 0, size, size, size);
  return {
    metadata: makeMetadata(id, name, vertices, indices),
    geometry: {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(vertices.length),
      indices: new Uint32Array(indices),
    },
  };
}

function generateCone(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const seg = 36;
  const r = 0.5;
  const xApex = -0.75, xBase = 0.75;
  vertices.push(xApex, 0, 0);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    vertices.push(xBase, Math.cos(a) * r, Math.sin(a) * r);
  }
  const cBase = vertices.length / 3;
  vertices.push(xBase, 0, 0);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    indices.push(0, 1 + j, 1 + i);
    indices.push(cBase, 1 + i, 1 + j);
  }
  return {
    metadata: makeMetadata('cone', '圆锥体', vertices, indices),
    geometry: {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(vertices.length),
      indices: new Uint32Array(indices),
    },
  };
}

function generateBuilding(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  appendBox(vertices, indices, 0, 1.5, 0, 0.8, 3.0, 0.8);
  appendBox(vertices, indices, 0, 0.2, 0, 1.4, 0.4, 1.4);
  appendBox(vertices, indices, 0, 3.15, 0, 0.55, 0.3, 0.55);
  return {
    metadata: makeMetadata('building', '简化高楼', vertices, indices),
    geometry: {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(vertices.length),
      solidTriangleCounts: new Uint32Array(indices.length / 36).fill(12),
      indices: new Uint32Array(indices),
    },
  };
}

function generateDrivAerLite(): { metadata: ModelMetadata; geometry: ModelGeometry } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const L = 4.6, W = 1.9;
  appendBox(vertices, indices, 0.1, 0.45, 0, L * 0.9, 0.7, W * 0.95);
  appendBox(vertices, indices, -0.2, 1.0, 0, L * 0.5, 0.7, W * 0.9);
  appendBox(vertices, indices, -L * 0.35, 0.55, 0, 0.9, 0.45, W * 0.9);
  appendBox(vertices, indices, L * 0.35, 0.55, 0, 0.7, 0.45, W * 0.9);
  appendBox(vertices, indices, -0.5, 0.95, W * 0.52, 0.15, 0.1, 0.12);
  appendBox(vertices, indices, -0.5, 0.95, -W * 0.52, 0.15, 0.1, 0.12);
  // 与分发 STL 相同的封闭圆柱组件
  for (const [x, z] of [[-1.4, -0.75], [-1.4, 0.75], [1.4, -0.75], [1.4, 0.75]] as const) {
    appendCylinderX(vertices, indices, x - 0.12, x + 0.12, 0.35, 0.35, z, 14);
  }
  return {
    metadata: makeMetadata('drivaer-lite', '轿车（简化）', vertices, indices),
    geometry: {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(vertices.length),
      solidTriangleCounts: new Uint32Array([12, 12, 12, 12, 12, 12, 56, 56, 56, 56]),
      indices: new Uint32Array(indices),
    },
  };
}
