/**
 * 仿真 ↔ 方法叙事（KUX 靶 F）。
 * 纯函数：从 methods 目录组装「人话四件套」与控件映射；不改 algo。
 */
import type { FoundationalMethod, MethodModuleRole } from '../data/methods/types'
import { methodById } from '../data/methods/methods'
import { energyDisplayName } from './energyAlias'
import { KIND_LABEL, KIND_LABEL_EN } from '../data/methods/kindMeta'
import type { Locale } from './i18n/types'
import { localizedName, pickLocaleString } from './i18n/display'
import { CONTROL_HINTS_EN } from './controlHints.en'

export const ROLE_LABEL: Record<MethodModuleRole, string> = {
  family: '方法族',
  algorithm: '算法',
  step: '步骤',
  'parallel-variant': '并行解释',
}

export const ROLE_LABEL_EN: Record<MethodModuleRole, string> = {
  family: 'Family',
  algorithm: 'Algorithm',
  step: 'Step',
  'parallel-variant': 'Parallel variant',
}

export function roleLabel(m: FoundationalMethod, locale: Locale = 'zh'): string {
  const key: MethodModuleRole = m.role ?? (m.parentId ? 'step' : 'family')
  return pickLocaleString(ROLE_LABEL[key], ROLE_LABEL_EN[key], locale)
}

/** 控件 → 方法步骤（旗舰 sim 显式挂接；其它 path 可空）。 */
export interface SimControlHint {
  /** 界面上用户在碰什么（中文主字段） */
  control: string
  /** English control label for i18n */
  controlEn?: string
  methodId: string
  /** 一句：你在调的是哪一步（中文） */
  note: string
  /** English note for i18n */
  noteEn?: string
}

const CONTROL_HINTS: Readonly<Record<string, readonly SimControlHint[]>> = {
  ripple: [
    {
      control: '阻尼滑条',
      methodId: 'method-algo-wave-leapfrog',
      note: '调大阻尼：波高每步被多削一点，涟漪更快平息（蛙跳耗散项）',
    },
    {
      control: '点击 / 拖动画布',
      methodId: 'method-algo-wave-poke',
      note: '在水面点一下 = 投下一块「波源」，向四周散开涟漪',
    },
    {
      control: '播放速度',
      methodId: 'method-algo-wave-leapfrog',
      note: '只改「看」的节奏：每帧多算几步，方程本身不变',
    },
    {
      control: '硬壁反射（固定边界）',
      methodId: 'method-algo-wave-obstacle',
      note: '池壁不让波穿出去，反射回来叠成驻波与回波',
    },
  ],
  'optics-lab': [
    {
      control: '镜面 / 透镜位姿',
      methodId: 'method-algo-snell',
      note: '挪镜子/透镜：折射角由界面两侧折射率（斯涅尔）决定',
    },
    {
      control: '折射率 / 介质参数',
      methodId: 'method-fresnel-snell',
      note: '改介质：透过与反射各拿多少光，由菲涅耳关系分配',
    },
    {
      control: '屏上功率读数',
      methodId: 'method-algo-fresnel-r',
      note: '看屏上功率：正入射时反射走多少、透过多少的直觉账',
    },
    {
      control: '搭光路预设',
      methodId: 'method-ray-optics',
      note: '选预设：像搭积木一样拼光线折反路径',
    },
  ],
  fdtd: [
    {
      control: '场演化 / 播放',
      methodId: 'method-algo-yee-update',
      note: '按播放：电场与磁场在网格上错开半格交替更新，像跳棋推进电磁波',
    },
    {
      control: '源激励',
      methodId: 'method-algo-fdtd-source',
      note: '加源：把波形「轻轻叠」进网格，而不是硬改写场点',
    },
    {
      control: '边界选择（Mur / PEC）',
      methodId: 'method-algo-fdtd-bnd-mur',
      note: '边界二选一：Mur 尽量吸走出射波，PEC 像金属壁全反射',
    },
    {
      control: 'CFL / 稳定性',
      methodId: 'method-algo-fdtd-cfl',
      note: '时间步太大场会指数发散；步长须与格子间距匹配，才稳',
    },
    {
      control: '能量监视',
      methodId: 'method-algo-fdtd-energy-monitor',
      note: '盯总能量：看场是在守恒、耗散，还是被源持续注入',
    },
  ],
  md: [
    {
      control: '粒子运动 / 积分',
      methodId: 'method-algo-velocity-verlet',
      note: '粒子怎么走：力→半步速度→挪位置→用新力再校正（速度 Verlet）',
    },
    {
      control: '相互作用势',
      methodId: 'method-algo-lj-pair',
      note: '粒子怎么互相推拉：靠得太近猛斥、稍远微吸（Lennard-Jones）',
    },
    {
      control: '温度 / 恒温',
      methodId: 'method-algo-rescale-thermostat',
      note: '钉住温度：按目标 T 重标定速度，动能不乱跑',
    },
    {
      control: '邻居列表',
      methodId: 'method-algo-cell-list',
      note: '加速搜邻居：用格子链表，避免每对粒子都暴力算一遍',
    },
  ],
  rlc: [
    {
      control: '阻尼比 ζ',
      methodId: 'method-algo-series-rlc',
      note: 'ζ 小会振、ζ≈1 刚好不振、ζ 大则慢慢爬到位（串联 RLC 阻尼分区）',
    },
    {
      control: '相平面 / 走纸轨迹',
      methodId: 'method-algo-rlc-euler',
      note: '同一电路用更糙的欧拉步进画轨迹，可与精细 RK4 对拍误差',
    },
    {
      control: '初始储能',
      methodId: 'method-lumped-circuit',
      note: '电容上有多少伏、电感里有多少安：这是电路状态的起点',
    },
  ],
  laser: [
    {
      control: '泵浦强度',
      methodId: 'method-algo-laser-threshold',
      note: '泵浦够猛才「出光」：低于阈值几乎只有自发辐射',
    },
    {
      control: '时间演化',
      methodId: 'method-algo-laser-step',
      note: '一步演化：反转粒子数与光子数互相推拉（速率方程）',
    },
    {
      control: '稳态读数',
      methodId: 'method-algo-laser-steady',
      note: '等足够久：光子数落在稳定值，对应连续输出亮度',
    },
  ],
  ising: [
    {
      control: '温度 T',
      methodId: 'method-algo-mc-metropolis-accept',
      note: '越热越敢翻：能量升一点也可能接受，温度越高越敢翻坏牌（Metropolis）',
    },
    {
      control: '自旋翻转扫掠',
      methodId: 'method-algo-mc-propose-flip',
      note: '每次先「提议」翻一颗自旋，再决定接不接受',
    },
    {
      control: '热浴更新（对照）',
      methodId: 'method-algo-mc-heatbath',
      note: '另一条路：直接从条件分布抽新自旋，不必走 Metropolis',
    },
    {
      control: 'Onsager 精确解对拍',
      methodId: 'method-algo-onsager-exact',
      note: '二维 Ising 有解析磁化：用来检查蒙特卡洛有没有算歪',
    },
  ],
  fluid: [
    {
      control: '染料 / 速度平流',
      methodId: 'method-algo-fluid-advect',
      note: '染料跟着流体走：沿轨迹回溯取样（半拉格朗日平流）',
    },
    {
      control: '粘性扩散',
      methodId: 'method-algo-fluid-diffuse',
      note: '粘性把尖剪切抹平：速度场被「抹糊」一点',
    },
    {
      control: '不可压缩投影',
      methodId: 'method-algo-fluid-project',
      note: '解压力：把速度投影到近似不可压（散度≈0）',
    },
    {
      control: '整帧管线',
      methodId: 'method-algo-fluid-pipeline',
      note: '一帧顺序：扩散 → 投影 → 平流（Stable Fluids 组装）',
    },
  ],
  ultrasound: [
    {
      control: '声阻抗 / 界面',
      methodId: 'method-algo-us-reflection',
      note: '组织界面差越大，回波越强（声阻抗差定反射）',
    },
    {
      control: 'A 线脉冲回波',
      methodId: 'method-algo-us-aline',
      note: '单条深度线：发出脉冲→听回波→时间轴就是深度',
    },
    {
      control: 'B 模图像拼图',
      methodId: 'method-algo-us-bmode-compose',
      note: '多条 A 线排成一排，拼成灰度截面图',
    },
  ],
  phasedarray: [
    {
      control: '阵元相位 / 指向',
      methodId: 'method-algo-array-factor',
      note: '改各阵元相位：主波束往哪指（阵列因子）',
    },
    {
      control: '方向图读数',
      methodId: 'method-algo-array-pattern',
      note: '看方向图：主瓣多宽、旁瓣多高',
    },
  ],
  antennapattern: [
    {
      control: '方向图绘制',
      methodId: 'method-algo-array-pattern',
      note: '各观测角上相对增益：天线「朝哪边更灵敏」',
    },
    {
      control: '链路预算对照',
      methodId: 'method-algo-friis-link',
      note: '距离与频率如何一起吃掉功率（Friis 链路）',
    },
  ],
  antennas: [
    {
      control: '链路 / 增益参数',
      methodId: 'method-algo-friis-link',
      note: '距离越远、频率越高，同一发射功率到接收端越弱；天线增益可补一点',
    },
    {
      control: '波束概念',
      methodId: 'method-array-beamforming',
      note: '波束成形总览：阵列如何「指」向目标、链路如何串起来',
    },
  ],
  antenna3d: [
    {
      control: '三维方向图',
      methodId: 'method-algo-array-pattern',
      note: '在立体角上画增益：天线朝哪边更灵敏',
    },
    {
      control: '波束成形族',
      methodId: 'method-array-beamforming',
      note: '阵列指向 + 链路预算同一方法族',
    },
  ],
  stm: [
    {
      control: '隧穿电流',
      methodId: 'method-algo-stm-tunnel',
      note: '针尖离样品稍近一点，电流指数暴涨（隧穿距离极敏感）',
    },
    {
      control: '恒高扫描',
      methodId: 'method-algo-stm-const-height',
      note: '高度钉死：只读电流 I(x,y) 画图，像「扫电导地图」',
    },
    {
      control: '恒流反馈',
      methodId: 'method-algo-stm-const-current',
      note: '电流钉死：靠上下调针尖高度，高度轨迹就是形貌',
    },
  ],
  afm: [
    {
      control: '针尖力 / 偏转',
      methodId: 'method-algo-afm-lj',
      note: '针尖与样品之间的推拉力让悬臂弯，弯多少≈力多大',
    },
    {
      control: '扫描探针族',
      methodId: 'method-spm',
      note: 'STM/AFM 都是「针尖近场扫表面」这一族',
    },
  ],
  tdoa: [
    {
      control: '到达时差',
      methodId: 'method-algo-tdoa-locate',
      note: '谁先听到、差多少时间 → 双曲线交会估位置',
    },
    {
      control: '定位方法族',
      methodId: 'method-tdoa-trilateration',
      note: '时差定位与三角测距的总览入口',
    },
  ],
  localization: [
    {
      control: '多锚测距',
      methodId: 'method-algo-trilateration',
      note: '几个已知锚点的距离圆（球）交会，交出坐标',
    },
    {
      control: '时差通道',
      methodId: 'method-algo-tdoa-locate',
      note: '没有绝对距离时：用到达时差也能定位',
    },
  ],
  'ai-chain': [
    {
      control: 'PUE 滑条',
      methodId: 'method-algo-pue-factor',
      note: '机房总用电 ÷ IT 用电：PUE 越高，制冷/配电浪费越多',
    },
    {
      control: '电源 / 全链路效率',
      methodId: 'method-algo-eta-product',
      note: '发电→输电→GPU→推理：每一级效率连乘才到 token',
    },
    {
      control: 'Token 经济读数',
      methodId: 'method-algo-token-throughput',
      note: '焦耳与 token 吞吐怎么换算：能量账看到推理产出',
    },
  ],
  faraday: [
    {
      control: '磁通变化 / 感应',
      methodId: 'method-algo-faraday',
      note: '磁通变化越快，感应电动势越大：线圈两端电压跟着变',
    },
    {
      control: '集总电路框架',
      methodId: 'method-lumped-circuit',
      note: '感应电动势落在 R-L 回路里，像多了一节「电压源」',
    },
  ],
  mutual: [
    {
      control: '耦合系数 / 互感',
      methodId: 'method-algo-mutual',
      note: '两线圈磁通交链越紧，互感越大，像变压器耦合',
    },
    {
      control: '集总电路族',
      methodId: 'method-lumped-circuit',
      note: '互感是集总网络里连接两个回路的一条「磁边」',
    },
  ],
  transient: [
    {
      control: 'RC/RL 时间常数',
      methodId: 'method-algo-rc-rl-transient',
      note: '充放电快慢看时间常数：大约过几个时间常数就到稳态',
    },
    {
      control: '集总电路族',
      methodId: 'method-lumped-circuit',
      note: '暂态就是电压电流随时间爬升或掉落的整条曲线',
    },
  ],
  heaterfc: [
    {
      control: '半无限体温升曲线',
      methodId: 'method-algo-heat-erfc',
      note: '表面突然加热后，温度往深处渗：erfc 给出 T(x,t) 解析曲线',
    },
    {
      control: '热扩散族',
      methodId: 'method-heat-ftcs',
      note: '对照数值热扩散：网格 FTCS 与解析 erfc 可对拍',
    },
  ],
  nljd: [
    {
      control: '非线性多项式',
      methodId: 'method-algo-nljd-poly',
      note: '结的 I–V 不是直线：非线性会「搓」出谐波',
    },
    {
      control: '2f/3f 分类',
      methodId: 'method-algo-nljd-classify',
      note: '看二次/三次谐波比，用来猜是什么类型的结',
    },
  ],
  particles: [
    {
      control: '分子积分步进',
      methodId: 'method-algo-velocity-verlet',
      note: '分子怎么走：与通用 MD 同一套速度 Verlet 积分核',
    },
    {
      control: '物种与相互作用',
      methodId: 'method-algo-ff-pedot',
      note: '由用户给出 LJ、电荷和屏蔽参数；材料名称不决定求解方法',
    },
  ],
  eeg: [
    {
      control: '节律频带',
      methodId: 'method-algo-eeg-rhythm',
      note: 'α/β 等频带：教学用脑电节律波形',
    },
    {
      control: '工频陷波等 DSP',
      methodId: 'method-algo-dsp-notch',
      note: '抠掉 50/60 Hz 市电哼声，干净看脑电',
    },
  ],
  ecg: [
    {
      control: '导联波形',
      methodId: 'method-algo-ecg-wave',
      note: '拼出 P-QRS-T：心电特征波的形态合成',
    },
    {
      control: '工频陷波',
      methodId: 'method-algo-dsp-notch',
      note: '心电链路同样要去市电干扰',
    },
  ],
  emg: [
    {
      control: '肌电信号',
      methodId: 'method-algo-emg-signal',
      note: '许多运动单元叠在一起，看起来像噪声状电位',
    },
    {
      control: 'DSP 链路',
      methodId: 'method-algo-biodsp-pipeline',
      note: '滤波 → 整流 → 包络：把毛刺电位收成可用包络',
    },
  ],
  neuron: [
    {
      control: '兴奋参数',
      methodId: 'method-algo-fhn-neuron',
      note: '尖峰怎么起、怎么恢复：FitzHugh–Nagumo 两变量教学模型',
    },
    {
      control: '生物电族',
      methodId: 'method-bioelectric',
      note: '从膜电位到宏电极记录的一整族方法',
    },
  ],
  sound: [
    {
      control: '声频谱条带',
      methodId: 'method-algo-spectrum-sound',
      note: '看可听声：各频率带上能量多高，对应音色与响度直觉',
    },
    {
      control: '频谱观测族',
      methodId: 'method-spectrum-viewer',
      note: '同一套「频谱透镜」：声、振、电磁都能这样扫一眼',
    },
    {
      control: '频带对比',
      methodId: 'method-wave-fd',
      note: '波动频域视角：先修波动有限差，再读谱线含义',
    },
  ],
  vibration: [
    {
      control: '振动频谱',
      methodId: 'method-algo-spectrum-vibration',
      note: '看机械振动：哪些频带在抖、能量集中在哪',
    },
    {
      control: '频谱观测族',
      methodId: 'method-spectrum-viewer',
      note: '与声波、电磁波共用同一套频谱观测壳',
    },
    {
      control: '与声波对照',
      methodId: 'method-algo-spectrum-sound',
      note: '振动常耦合发声：可对照声谱看「抖」如何变成「响」',
    },
  ],
  windtunnel: [
    {
      control: '来流 / 平流',
      methodId: 'method-algo-fluid-advect',
      note: '染料跟着风走：速度场把墨迹往下游吹',
    },
    {
      control: '障碍物',
      methodId: 'method-algo-fluid-obstacle',
      note: '放块固体：气流不能穿墙，绕流与尾迹从这里来',
    },
    {
      control: '投影保不可压',
      methodId: 'method-algo-fluid-project',
      note: '修正速度：让截面上近似不可压（散度≈0），避免「凭空造流体」',
    },
  ],
  convection: [
    {
      control: '浮力驱动',
      methodId: 'method-algo-fluid-buoyancy',
      note: '热的地方变轻往上浮：温度差变成体积力（Boussinesq）',
    },
    {
      control: '平流–投影管线',
      methodId: 'method-algo-fluid-pipeline',
      note: '整帧仍按「扩散→投影→平流」组装，只是多了浮力项',
    },
    {
      control: '粘性扩散',
      methodId: 'method-algo-fluid-diffuse',
      note: '动量被粘性抹平：尖剪切会慢慢变钝',
    },
  ],
  emwave3d: [
    {
      control: '3D 场更新',
      methodId: 'method-algo-yee-update',
      note: '三维里仍是：电场与磁场交错蛙跳，与 2D FDTD 同一核',
    },
    {
      control: 'CFL 约束',
      methodId: 'method-algo-fdtd-cfl',
      note: '三维网格也要：时间步太大数值会炸',
    },
    {
      control: '源与边界直觉',
      methodId: 'method-algo-fdtd-source',
      note: '加源/看边界：与平面 FDTD 同一套软源与开放/反射思路',
    },
  ],
  radar: [
    {
      control: '距离方程',
      methodId: 'method-algo-radar-range',
      note: '目标越远回波越弱：功率大致随距离四次方掉下去',
    },
    {
      control: '定位对照',
      methodId: 'method-algo-tdoa-locate',
      note: '多站听时差：也可用到达时间差估位置（与测距雷达对照）',
    },
    {
      control: '链路损耗对照',
      methodId: 'method-algo-friis-link',
      note: '自由空间链路：距离与频率如何一起吃掉功率（Friis）',
    },
  ],
  display: [
    {
      control: 'LED 波长',
      methodId: 'method-algo-led-bandgap',
      note: '改带隙≈改颜色：半导体禁带宽度定发光波长尺度',
    },
    {
      control: 'LCD 偏振调制',
      methodId: 'method-algo-lcd-malus',
      note: '拧偏振角：透过亮暗按马吕斯变化，液晶屏靠这个调灰阶',
    },
    {
      control: 'OLED 混色',
      methodId: 'method-algo-oled-mix',
      note: 'RGB 子像素按比例发光，合成你看到的屏幕颜色',
    },
  ],
  /** 知识页（非仿真叶子，但仍挂 methods 叙事） */
  matrix: [
    {
      control: '选「从→到」格子',
      methodId: 'method-path-efficiency',
      note: '点一格：看「这种能量」直接变成「那种能量」有哪些路径',
    },
    {
      control: '效率条 / COP 徽章',
      methodId: 'method-algo-exergy-efficiency',
      note: '效率问「能量还剩多少」；㶲效率问「还能做多少有用功」——两套尺子',
    },
    {
      control: '公式块（人话 + 算例）',
      methodId: 'method-algo-exergy-carnot',
      note: '热变功时：品位 φ 与卡诺尺度帮你读公式结果',
    },
    {
      control: '按效率排序',
      methodId: 'method-algo-path-mc-eta',
      note: '同一对能量形式有多条路时，按效率区间比谁更划算',
    },
  ],
  paths: [
    {
      control: '源 / 目标能量',
      methodId: 'method-path-efficiency',
      note: '选定 A→B：在图上找中间要经过哪些转换',
    },
    {
      control: '效率最优模式',
      methodId: 'method-algo-path-dijkstra-stub',
      note: '找「损耗最少」的链路：用效率权重求累积最省路径',
    },
    {
      control: '浏览全部模式',
      methodId: 'method-algo-path-dfs',
      note: '枚举可能链路：先对照多种走法，不急着全局最优',
    },
    {
      control: '能量账 / 㶲行',
      methodId: 'method-exergy-analysis',
      note: '100 份投入：还剩多少能量 vs 还剩多少可用功',
    },
    {
      control: '蒙特卡洛稳健性',
      methodId: 'method-algo-path-mc-eta',
      note: '效率有区间时：随机抽几次，看整条路径效率分布稳不稳',
    },
  ],
  graph: [
    {
      control: '点选顶层能量',
      methodId: 'method-path-efficiency',
      note: '点开一种能量：看它的子形态与进/出转换边',
    },
    {
      control: '转换边卡片',
      methodId: 'method-algo-path-dfs',
      note: '每条边是图上的箭头：可接着搜更长路径',
    },
    {
      control: '关联争议',
      methodId: 'method-path-efficiency',
      note: '分类有争议时：节点/边旁挂「多解释」入口',
    },
  ],
  phenomena: [
    {
      control: '现象步骤轴',
      methodId: 'method-photosensitization-kinetics',
      note: '把光/声敏化拆成可挂能量边的步骤轴',
    },
    {
      control: 'Jablonski 壳',
      methodId: 'method-algo-photo-jablonski',
      note: '电子态怎么跳：速率方程教学壳（吸收、荧光、系间窜越）',
    },
    {
      control: 'SDT 并行假说',
      methodId: 'method-variant-sdt-cavitation',
      note: '空化 / 声致发光 / 压电 等说法并立，本页不裁定唯一真理',
    },
  ],
  converter: [
    {
      control: '源 / 目标能量下拉',
      methodId: 'method-path-efficiency',
      note: '先选源能量再选目标：与矩阵同一「从什么到什么」思维，底层编号可不相同',
    },
    {
      control: '方案卡片效率条',
      methodId: 'method-algo-path-mc-eta',
      note: '卡片上的效率区间与矩阵同一套读法，方便对照工程数',
    },
    {
      control: '材料与成熟度标签',
      methodId: 'method-path-efficiency',
      note: '成熟 / 新兴 / 研究中只是工程落地叙事，不裁决谁更「物理正确」',
    },
    {
      control: '链到转换矩阵',
      methodId: 'method-exergy-analysis',
      note: '要公式、㶲与共识时跳到本体矩阵；本页不静默合并 electrical/electric',
    },
  ],
  transducers: [
    {
      control: '换能器卡片 from→to',
      methodId: 'method-path-efficiency',
      note: '每一张卡是一种器件级换能通道，对应能量图上的一条边/一类边',
    },
    {
      control: '本体节点链接',
      methodId: 'method-path-efficiency',
      note: '可点进能量本体节点；信息/智能等尚未入本体的出口见争议页',
    },
    {
      control: '典型效率条',
      methodId: 'method-algo-path-mc-eta',
      note: '百科效率区间与矩阵同一套读法，数字怎么显示保持一致',
    },
    {
      control: '应用标签',
      methodId: 'method-exergy-analysis',
      note: '应用场景帮你判断「能做功」的语境，不只看焦耳数字',
    },
  ],
  apps: [
    {
      control: '应用家族列表',
      methodId: 'method-path-efficiency',
      note: '每个应用把换能链嵌进用户故事；同家族=换源或换汇的并立入口',
    },
    {
      control: '下钻到 level',
      methodId: 'method-path-efficiency',
      note: '每一层可挂转换边与方法，一直钻到能试跑的算法为止',
    },
    {
      control: '目标能量 from→to',
      methodId: 'method-exergy-analysis',
      note: '目标接口是能量形式对；效率与品位要一起看才不会误判废热',
    },
    {
      control: '同族换源/换汇',
      methodId: 'method-path-efficiency',
      note: '深层方法可复用，表层能量接口重接——多解释并存',
    },
  ],
  controversies: [
    {
      control: '争议卡片 / 观点列表',
      methodId: 'method-path-efficiency',
      note: '多 viewpoint 并列；禁止静默删少数派或合并成「唯一正确」',
    },
    {
      control: '共识徽章',
      methodId: 'method-path-efficiency',
      note: '已确立 / 约定 / 有争议 / 开放：只描述共识状态，不裁决谁对谁错',
    },
    {
      control: '关联能量节点',
      methodId: 'method-exergy-analysis',
      note: '争议常挂在能量形式边界上（如热品位、信息是否算能）',
    },
    {
      control: '层标签 meta/conventional/frontier',
      methodId: 'method-path-efficiency',
      note: '分类层争议与前沿未闭合问题分层展示，避免混为一谈',
    },
  ],
  methods: [
    {
      control: '方法目录浏览',
      methodId: 'method-path-efficiency',
      note: '基础方法脊梁：族 / 算法 / 步骤 / 并行变体 四级角色',
    },
    {
      control: '按 kind 筛选',
      methodId: 'method-path-efficiency',
      note: '波动·粒子·连续介质…是透镜分类，不是互斥真理',
    },
    {
      control: '链到仿真 / 世界图',
      methodId: 'method-path-efficiency',
      note: '方法可挂到具体仿真页：点进去就能拧旋钮对拍',
    },
  ],
  taxonomy: [
    {
      control: '分类图谱泳道',
      methodId: 'method-path-efficiency',
      note: '按学科 kind 排方法树：父子是细分，不是互相覆盖',
    },
    {
      control: '先修依赖边',
      methodId: 'method-path-efficiency',
      note: '学习路径：掌握 A 宜先会 B，与物理转换边正交',
    },
    {
      control: '并行变体组',
      methodId: 'method-path-efficiency',
      note: '同一槽位可挂多套解释：界面并列展示，不静默抹掉分歧',
    },
  ],
  world: [
    {
      control: '世界图 / 时序',
      methodId: 'method-path-efficiency',
      note: '方法与能量节点的时空编排视图，运营层非唯一教义',
    },
    {
      control: '选中方法节点',
      methodId: 'method-path-efficiency',
      note: '下钻到算法步骤与可试跑样板',
    },
    {
      control: '年代锚点',
      methodId: 'method-path-efficiency',
      note: '年代是教学时序锚点，不是谁更重要或更正确的裁决',
    },
  ],
  sensing: [
    {
      control: '被测能量形式',
      methodId: 'method-path-efficiency',
      note: '传感器 = 把被测形式一步（或几步）换成可读电信号的换能链',
    },
    {
      control: '取能效率序 / 可落地序',
      methodId: 'method-algo-path-mc-eta',
      note: '取能看 ∏η；选型看成熟度——两种排序意图不同',
    },
    {
      control: '换能路径卡片',
      methodId: 'method-exergy-analysis',
      note: '效率与终态品位一起看，避免把低品位热当高品位功',
    },
    {
      control: '器件 / 产品型号',
      methodId: 'method-path-efficiency',
      note: '来自本体边的 device/products，与转换矩阵同一数据脊梁',
    },
  ],
}

export function controlHintsForSim(path: string): readonly SimControlHint[] {
  const p = path.replace(/^\//, '').split('/')[0] ?? ''
  const base = CONTROL_HINTS[p] ?? []
  const en = CONTROL_HINTS_EN[p]
  if (!en?.length) return base
  return base.map((h, i) => {
    const e = en[i]
    return e ? { ...h, controlEn: e.controlEn, noteEn: e.noteEn } : h
  })
}

export interface MethodNarrativeCard {
  method: FoundationalMethod
  /** 叫什么 */
  title: string
  /** 干什么 */
  summary: string
  /** 典型式 / 基础 */
  foundations: string[]
  /** 和谁有关 */
  related: string[]
  role: string
  kindLabel: string
  parentName?: string
}

export function toNarrativeCard(m: FoundationalMethod, locale: Locale = 'zh'): MethodNarrativeCard {
  const related: string[] = []
  for (const nid of m.relatedNodeIds ?? []) {
    related.push(energyDisplayName(nid))
  }
  const parent = m.parentId ? methodById(m.parentId) : undefined
  return {
    method: m,
    title: localizedName(m, locale),
    summary: pickLocaleString(m.summary, m.summaryEn, locale),
    foundations: m.foundations.slice(0, 4),
    related,
    role: roleLabel(m, locale),
    kindLabel: pickLocaleString(KIND_LABEL[m.kind], KIND_LABEL_EN[m.kind], locale),
    parentName: parent ? localizedName(parent, locale) : undefined,
  }
}

/** 族优先，再算法，再步骤；同 role 按名称。 */
export function sortMethodsForSim(methods: FoundationalMethod[]): FoundationalMethod[] {
  const rank = (m: FoundationalMethod) => {
    const r = m.role ?? (m.parentId ? 'step' : 'family')
    if (r === 'family') return 0
    if (r === 'algorithm') return 1
    if (r === 'parallel-variant') return 2
    return 3
  }
  return [...methods].sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    return a.name.localeCompare(b.name, 'zh')
  })
}

export function familyMethods(methods: FoundationalMethod[]): FoundationalMethod[] {
  return methods.filter((m) => (m.role ?? (!m.parentId ? 'family' : 'step')) === 'family' || !m.parentId)
}

export function stepMethods(methods: FoundationalMethod[]): FoundationalMethod[] {
  return methods.filter((m) => {
    const r = m.role ?? (m.parentId ? 'step' : 'family')
    return r === 'step' || r === 'algorithm' || r === 'parallel-variant'
  })
}
