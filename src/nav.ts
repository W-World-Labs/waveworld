// 目录数据：复用域、领域和条目类型，为仿真筛选、资料库和全局搜索提供内容。
// 四个主导航入口由 Layout 展示；物理领域作为目录中的同级筛选，不再逐层展开菜单。
// 旧域 key（ontology/field-wave/matter/life-device/lab）由 DomainHub 别名重定向。
// 文案：label/blurb 中文主字段；labelEn/blurbEn 英文（i18n，禁止覆盖中文）。

export type NavItem = {
  path: string
  label: string
  labelEn: string
  icon: string
  description?: string
  descriptionEn?: string
}

export type NavFacet = {
  label: string
  labelEn: string
  icon: string
  items: NavItem[]
}

export type NavDomain = {
  key: string
  label: string
  labelEn: string
  icon: string
  accent: string
  tag: string
  tagEn: string
  blurb: string
  blurbEn: string
  facets: NavFacet[]
}

export const DOMAINS: NavDomain[] = [
  {
    key: 'atlas',
    label: '资料库',
    labelEn: 'Library',
    icon: '🌐',
    accent: '#8b7bff',
    tag: '地图',
    tagEn: 'Atlas',
    blurb: '先认路：世界图与方法图谱看清能量怎么转，矩阵与路径帮你对照，再进仿真动手',
    blurbEn:
      'Orient first: world map and method taxonomy show how energy converts; matrix and paths for comparison, then sims.',
    facets: [
      {
        label: '总览',
        labelEn: 'Overview',
        icon: '🌐',
        items: [
          { path: 'world', label: '世界图 · 时序', labelEn: 'World map · timeline', icon: '🌐' },
          { path: 'taxonomy', label: '方法分类图谱', labelEn: 'Method taxonomy', icon: '🧬' },
          { path: 'methods', label: '基础方法', labelEn: 'Foundational methods', icon: '🧭' },
          { path: 'graph', label: '能量图谱', labelEn: 'Energy graph', icon: '🕸️' },
        ],
      },
      {
        label: '能量结构',
        labelEn: 'Energy structure',
        icon: '🔀',
        items: [
          { path: 'matrix', label: '转换矩阵', labelEn: 'Conversion matrix', icon: '🔀' },
          { path: 'paths', label: '转换路径', labelEn: 'Conversion paths', icon: '🛤️' },
          { path: 'phenomena', label: '前沿现象', labelEn: 'Frontier phenomena', icon: '🔬' },
          { path: 'controversies', label: '争议与多解释', labelEn: 'Controversies', icon: '⚖️' },
          {
            path: 'method-depth',
            label: '原理深度 · 脊梁视图',
            labelEn: 'Principle depth · spine view',
            icon: '🌳',
          },
        ],
      },
    ],
  },
  {
    key: 'sim',
    label: '仿真与计算',
    labelEn: 'Simulation',
    icon: '⚡',
    accent: '#3ad6ff',
    tag: '仿真',
    tagEn: 'Sim',
    blurb: '输入模型或数据，选择物理方法，在本机或后端计算并查看结果。',
    blurbEn:
      'Choose a physical method, supply a model or dataset, and compute locally or on the backend.',
    facets: [
      {
        label: '流体',
        labelEn: 'Fluids',
        icon: '🌊',
        items: [
          { path: 'windtunnel', label: '三维风洞', labelEn: '3D wind tunnel', icon: '🌬️',
            description: '选择或导入模型，观察周围气流；可在本机或后端计算。',
            descriptionEn: 'Choose or import a model and explore its airflow, with local or backend computation.' },
          { path: 'fluid', label: '二维流体', labelEn: '2D fluid', icon: '🌊' },
        ],
      },
      {
        label: '热',
        labelEn: 'Thermal',
        icon: '🌡️',
        items: [
          { path: 'sim', label: '二维热扩散', labelEn: '2D heat diffusion', icon: '🌡️' },
          { path: 'heaterfc', label: '一维热扩散', labelEn: '1D heat diffusion', icon: '🌡️' },
          { path: 'convection', label: '热对流', labelEn: 'Thermal convection', icon: '💧' },
        ],
      },
      {
        label: '光学',
        labelEn: 'Optics',
        icon: '🔬',
        items: [
          { path: 'optics-lab', label: '光学实验场', labelEn: 'Optics lab', icon: '🔬', description: '移动光源、镜子和透镜，观察反射、折射与聚焦。', descriptionEn: 'Move light sources, mirrors, and lenses to explore reflection, refraction, and focus.' },
          { path: 'laser', label: '激光', labelEn: 'Laser', icon: '🔦' },
          { path: 'display', label: '显示发光原理', labelEn: 'Display emission', icon: '💡' },
        ],
      },
      {
        label: '电磁',
        labelEn: 'Electromagnetics',
        icon: '📡',
        items: [
          { path: 'electromagnetic', label: '电磁波谱', labelEn: 'EM spectrum', icon: '📡' },
          { path: 'fdtd', label: '电磁波传播', labelEn: 'Electromagnetic wave propagation', icon: '📡', description: '放置介质与障碍，观察电磁波传播和反射。', descriptionEn: 'Place materials and obstacles, then observe wave propagation and reflection.' },
          { path: 'emwave3d', label: '电磁波 · 三维', labelEn: 'EM wave · 3D', icon: '📡' },
          { path: 'faraday', label: '法拉第感应', labelEn: 'Faraday induction', icon: '🧲' },
          { path: 'antenna3d', label: '天线收发 · 三维', labelEn: 'Antenna TX/RX · 3D', icon: '📡' },
          { path: 'antennapattern', label: '方向图 · 链路预算', labelEn: 'Pattern · link budget', icon: '📶' },
          { path: 'antennas', label: '天线图鉴', labelEn: 'Antenna catalog', icon: '📡' },
          { path: 'phasedarray', label: '相控阵', labelEn: 'Phased array', icon: '📡' },
          { path: 'smith', label: '史密斯圆图', labelEn: 'Smith chart', icon: '◎' },
        ],
      },
      {
        label: '电路',
        labelEn: 'Circuits',
        icon: '🔌',
        items: [
          { path: 'rlc', label: '谐振电路', labelEn: 'RLC resonator', icon: '🌀' },
          { path: 'transient', label: '充放电暂态', labelEn: 'Charge/discharge transient', icon: '📉' },
          { path: 'mutual', label: '互感', labelEn: 'Mutual inductance', icon: '🔗' },
        ],
      },
      {
        label: '声波与振动',
        labelEn: 'Acoustics and vibration',
        icon: '🔊',
        items: [
          { path: 'sound', label: '声波频谱', labelEn: 'Sound spectrum', icon: '🔊' },
          { path: 'vibration', label: '振动频谱', labelEn: 'Vibration spectrum', icon: '〰️' },
          { path: 'ripple', label: '波纹干涉', labelEn: 'Ripple interference', icon: '💦' },
          { path: 'ultrasound', label: '超声成像', labelEn: 'Ultrasound imaging', icon: '🩻' },
        ],
      },
      {
        label: '分子与材料',
        labelEn: 'Molecules and materials',
        icon: '⚛️',
        items: [
          { path: 'md', label: '分子动力学', labelEn: 'Molecular dynamics', icon: '⚛️' },
          { path: 'particles', label: '粒子与材料模型', labelEn: 'Particle and material models', icon: '🧪' },
          { path: 'ising', label: '伊辛模型 · 蒙特卡洛', labelEn: 'Ising · Monte Carlo', icon: '🧲' },
          { path: 'stm', label: '扫描隧道显微', labelEn: 'STM', icon: '⚛️' },
          { path: 'afm', label: '原子力显微', labelEn: 'AFM', icon: '🔬' },
        ],
      },
      {
        label: '信号与感知',
        labelEn: 'Signals and sensing',
        icon: '▦',
        items: [
          { path: 'signal-array', label: '阵列感知与编解码', labelEn: 'Array sensing and coding', icon: '▦', description: '配置空间输入、感知与编码矩阵，比较测量信号和重建结果。', descriptionEn: 'Configure spatial inputs, sensing and coding matrices; compare measurements and reconstruction.' },
          { path: 'ecg', label: '心电图与数据回放', labelEn: 'ECG and data replay', icon: '❤️', description: '加载公开心电记录或导入 CSV，切换通道、拖动时间查看波形。', descriptionEn: 'Load a public ECG recording or import CSV, switch channels, and scrub through the waveform.' },
          { path: 'emg', label: '肌电图', labelEn: 'EMG', icon: '💪' },
          { path: 'eeg', label: '脑电图', labelEn: 'EEG', icon: '🧠' },
          { path: 'neuron', label: '动作电位', labelEn: 'Action potential', icon: '⚡' },
          { path: 'biopipeline', label: '生物电链路', labelEn: 'Bioelectric pipeline', icon: '🔗' },
          { path: 'radar', label: '雷达回波', labelEn: 'Radar return', icon: '📶' },
          { path: 'localization', label: '三角定位', labelEn: 'Trilateration', icon: '🎯' },
          { path: 'tdoa', label: '时差定位', labelEn: 'TDOA', icon: '🎯' },
          { path: 'nljd', label: '非线性结探测', labelEn: 'NLJD', icon: '🔎' },
        ],
      },
      {
        label: '计算管理',
        labelEn: 'Compute management',
        icon: '📋',
        items: [
          { path: 'comsol', label: 'COMSOL 原生案例', labelEn: 'COMSOL native cases', icon: '🧩', description: '选择已接入的原生多物理场案例，检查参数并提交任务。', descriptionEn: 'Choose an admitted native multiphysics case, review its parameters, and submit a job.' },
          { path: 'ansys', label: 'Ansys 能力案例', labelEn: 'Ansys capability cases', icon: '🧩', description: '按产品筛选 W-Sim 对应能力案例并提交单项任务。', descriptionEn: 'Filter W-Sim capability cases by product and submit one job at a time.' },
          { path: 'abaqus', label: 'Abaqus 能力案例', labelEn: 'Abaqus capability cases', icon: '🧩', description: '按 Abaqus 功能筛选 W-Sim 对应案例并提交单项任务。', descriptionEn: 'Filter W-Sim cases mapped to Abaqus features and submit one job at a time.' },
          { path: 'opticstudio', label: 'OpticStudio 光学案例', labelEn: 'OpticStudio optics cases', icon: '🧩', description: '按光学工作流查看 W-Sim 原生案例，检查边界并提交单项任务。', descriptionEn: 'Browse W-Sim native cases by optical workflow, review limits, and submit one job at a time.' },
          { path: 'dymola', label: 'Dymola 能力案例', labelEn: 'Dymola capability cases', icon: '🧩', description: '按 Dymola 功能查看 W-Sim 映射案例并提交单项任务。', descriptionEn: 'Browse W-Sim cases mapped to Dymola features and submit one job at a time.' },
          { path: 'star-ccm', label: 'STAR-CCM+ 能力案例', labelEn: 'STAR-CCM+ capability cases', icon: '🧩', description: '按 Simcenter STAR-CCM+ 功能概念查看 W-Sim 映射案例并提交单项任务。', descriptionEn: 'Browse W-Sim cases mapped to Simcenter STAR-CCM+ feature concepts and submit one job at a time.' },
          { path: 'cst', label: 'CST Studio Suite 能力案例', labelEn: 'CST Studio Suite capability cases', icon: '🧩', description: '按电磁功能查看 W-Sim 映射案例并提交单项 Host 任务。', descriptionEn: 'Browse W-Sim cases mapped to electromagnetic capabilities and submit one Host job at a time.' },
          { path: 'batch-jobs', label: '计算任务', labelEn: 'Compute jobs', icon: '📋' },
          { path: 'my-projects', label: '我的项目', labelEn: 'My projects', icon: '📁' },
        ],
      },
    ],
  },
  {
    key: 'apps',
    label: '应用案例',
    labelEn: 'Applications',
    icon: '🔧',
    accent: '#ff9a4c',
    tag: '应用',
    tagEn: 'Apps',
    blurb: '工程速查：按目标能量形式找换能器与传感方案，再看应用档案与跨域叙事',
    blurbEn:
      'Engineering lookup: find transducers and sensing by target energy form, then app profiles and cross-domain narrative.',
    facets: [
      {
        label: '应用与工程参考',
        labelEn: 'Applications and engineering references',
        icon: '📖',
        items: [
          { path: 'apps', label: '应用案例', labelEn: 'Applications', icon: '🔧' },
          { path: 'transducers', label: '换能器百科', labelEn: 'Transducer encyclopedia', icon: '⚡' },
          { path: 'sensing', label: '传感/换能查找', labelEn: 'Sensing / conversion lookup', icon: '📡' },
          { path: 'node-budget', label: '节点功耗账本', labelEn: 'Node energy budget', icon: '🔋' },
          { path: 'converter', label: '工程推荐目录', labelEn: 'Engineering catalog', icon: '🔁' },
          { path: 'ai-chain', label: '能量→令牌链', labelEn: 'Energy → token chain', icon: '🧠' },
          { path: 'article', label: '世界是换能器', labelEn: 'World as transducer', icon: '📖' },
        ],
      },
    ],
  },
]

/** 旧一级域 → 新域（书签 /d/field-wave 等不 404） */
export const DOMAIN_ALIASES: Record<string, string> = {
  ontology: 'atlas',
  'field-wave': 'sim',
  matter: 'sim',
  'life-device': 'sim',
  lab: 'apps',
}

export type Leaf = NavItem
export type LeafEntry = Leaf & {
  domainKey: string
  domainLabel: string
  domainLabelEn: string
  domainIcon: string
  accent: string
  tag: string
  tagEn: string
  facetLabel: string
  facetLabelEn: string
  webgpu: boolean
}

/** 真正跑 WebGPU compute 加速的仿真（背后有 src/lib/webgpu/*.ts）。 */
export const WEBGPU_PATHS = new Set(['md', 'particles', 'fdtd', 'sim', 'paths'])

export const ALL_LEAVES: LeafEntry[] = DOMAINS.flatMap((d) =>
  d.facets.flatMap((f) =>
    f.items.map((it) => ({
      ...it,
      domainKey: d.key,
      domainLabel: d.label,
      domainLabelEn: d.labelEn,
      domainIcon: d.icon,
      accent: d.accent,
      tag: d.tag,
      tagEn: d.tagEn,
      facetLabel: f.label,
      facetLabelEn: f.labelEn,
      webgpu: WEBGPU_PATHS.has(it.path),
    })),
  ),
)

export const findDomain = (key: string) => {
  const k = DOMAIN_ALIASES[key] ?? key
  return DOMAINS.find((d) => d.key === k)
}
