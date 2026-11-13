/**
 * Bilingual PageHeader copy keyed by route path (no leading /).
 * Chinese remains the source of truth in page components; this table
 * supplies English without overwriting zh fields.
 */
export type PageHeaderCopy = {
  title: string
  titleEn: string
  subtitle?: string
  subtitleEn?: string
}

export const PAGE_HEADERS: Record<string, PageHeaderCopy> = {
  'signal-array': { title: '阵列感知与空间编解码', titleEn: 'Array sensing and spatial coding', subtitle: '编辑空间输入，查看传感信号、编码测量与重建误差。', subtitleEn: 'Edit spatial inputs and inspect sensor signals, encoded measurements and reconstruction error.' },
  afm: {
    title: '原子力显微镜',
    titleEn: 'Atomic force microscope',
    subtitle:
      '纳米针尖逐点扫过样品表面，针尖与原子之间的推拉力使悬臂微微偏转；偏转经激光杠杆放大、由光电探测器读出，逐行重建原子级形貌——「用力去看」原子。',
    subtitleEn:
      'A nanometer tip scans the surface; tip–atom forces deflect the cantilever, read out via optical lever, and rebuild atomic topography line by line—seeing atoms by force.',
  },
  'ai-chain': {
    title: '从能量到令牌',
    titleEn: 'From energy to tokens',
    subtitle:
      '一焦耳原始能量，经发电、电网、输电、数据中心、算力芯片、推理引擎、模型质量的层层损耗，最终转化为多少“有效智能”？这是 AI 时代最根本的换能链。',
    subtitleEn:
      'One joule of primary energy is thinned by generation, grid, transmission, data centers, chips, inference engines, and model quality—how much “useful intelligence” remains? The core conversion chain of the AI era.',
  },
  antenna3d: {
    title: '天线收发 · 3D',
    titleEn: 'Antenna TX/RX · 3D',
    subtitle:
      '原点处一根竖直半波偶极子向外辐射：紫色「甜甜圈」是它的三维方向图（赤道最强、沿轴为零），青色球面波前不断向外扩散。拖动滑块移动接收天线，实时读出链路预算下的接收功率。',
    subtitleEn:
      'A vertical half-wave dipole radiates from the origin: the purple torus is its 3D pattern (strongest at the equator, null on axis); cyan spherical wavefronts expand. Move the receive antenna and read link-budget power live.',
  },
  antennas: {
    title: '天线图鉴 · 尺寸随频率',
    titleEn: 'Antenna catalog · size vs frequency',
    subtitle:
      '天线尺寸由波长决定，通常取四分之一或半波长谐振。频率越低波长越长、天线越大——调频广播约 0.75 米，中波广播可到几十米（故改用磁棒环/长线），而 2.4G 无线只需几厘米。拖动频率或点选下方天线。',
    subtitleEn:
      'Antenna size follows wavelength—typically λ/4 or λ/2 resonance. Lower frequency means longer waves and larger antennas (FM ~0.75 m; medium wave tens of meters, hence loops/long-wires); 2.4 GHz needs only centimeters. Drag frequency or pick an antenna below.',
  },
  antennapattern: {
    title: '天线方向图 · 链路预算',
    titleEn: 'Antenna pattern · link budget',
    subtitle:
      '不同天线类型的辐射方向图（极坐标）：各向同性恒为 1、半波偶极子赤道面最强、定向天线主瓣集中。右侧做自由空间链路预算：距离每增 10 倍，路径损耗大约多 20 分贝。',
    subtitleEn:
      'Radiation patterns in polar form: isotropic is 1, half-wave dipole peaks in the equatorial plane, directive antennas concentrate the main lobe. Right: free-space link budget—~20 dB more path loss per 10× distance.',
  },
  apps: {
    title: '应用档案',
    titleEn: 'Application profiles',
    subtitle:
      '真实工程入口：从电站/探头/屏幕下钻到转换边与可试跑算法。页眉方法叙事说明列表、分层与换源/换汇；应用把方法嵌进用户故事。',
    subtitleEn:
      'Engineering entry: drill from plants, probes, and screens into conversion edges and try-run algorithms. Header method narrative covers lists, layers, and source/sink swaps; apps embed methods in user stories.',
  },
  biopipeline: {
    title: '生物电信号链路',
    titleEn: 'Bioelectric signal chain',
    subtitle:
      '从皮肤电极拾取的心电/肌电/脑电极其微弱，且混入基线漂移、工频干扰和宽带噪声。要看到干净波形，需经标准采集链路：差分放大 → 去基线 → 带通平滑 → 工频陷波 → 数字化显示。',
    subtitleEn:
      'Skin electrodes pick up weak ECG/EMG/EEG mixed with baseline drift, mains interference, and broadband noise. A standard chain cleans them: differential amp → de-baseline → bandpass → notch → digital display.',
  },
  controversies: {
    title: '争议与多解释',
    titleEn: 'Controversies & multi-explanations',
    subtitle:
      '不追求唯一正确模型：元层与前沿争议并列。页眉方法叙事说明卡片、共识徽章与关联节点；禁止静默删少数派。',
    subtitleEn:
      'No single true model: meta-level and frontier debates sit side by side. Header method narrative covers cards, consensus badges, and linked nodes; minority views are not silently dropped.',
  },
  convection: {
    title: '热对流 · 温差驱动流动',
    titleEn: 'Thermal convection · buoyant flow',
    subtitle:
      '设置初始冷热区域，计算温差平流和浮力驱动的速度场。',
    subtitleEn:
      'Set initial hot and cold regions; calculate temperature advection and buoyancy-driven velocity.',
  },
  converter: {
    title: '工程推荐目录',
    titleEn: 'Engineering catalog',
    subtitle:
      '工程向换能方案速查（效率/成熟度/材料）。与转换矩阵双轨并存：本页讲「有哪些工程方案」，矩阵讲「公式与㶲」；页眉方法叙事说明你在调什么。',
    subtitleEn:
      'Engineering conversion lookup (efficiency / maturity / materials). Dual track with the matrix: this page lists schemes; the matrix covers formulas and exergy. Header method narrative says what you are tuning.',
  },
  display: {
    title: '显示发光原理',
    titleEn: 'Display emission principles',
    subtitle:
      '三种显示发光机制：发光二极管靠电子-空穴复合越过带隙出光；有机发光用红绿蓝自发光子像素加法混色；液晶本身不发光，靠背光经偏振片与液晶扭转调制透过亮度。',
    subtitleEn:
      'Three emission mechanisms: LEDs radiate via electron–hole recombination across the band gap; OLEDs mix additive RGB subpixels; LCDs do not emit—they modulate backlight through polarizers and twisted liquid crystal.',
  },
  ecg: {
    title: '心电图',
    titleEn: 'Electrocardiogram (ECG)',
    subtitle:
      '心脏每次搏动都伴随有序的去极化与复极化：心房活动形成 P 波，心室去极化形成高大的 QRS 复合波，复极化形成圆钝的 T 波。按标准导联投影并随时间走纸，就是监护仪上熟悉的心电图。',
    subtitleEn:
      'Each beat follows ordered de/repolarization: P from atria, tall QRS from ventricular depolarization, rounded T from repolarization. Projected on standard leads and plotted vs time—the familiar bedside ECG.',
  },
  eeg: {
    title: '脑电节律',
    titleEn: 'EEG rhythms',
    subtitle:
      '头皮电极记录到的脑电，是千万个皮层神经元同步放电叠加出的微弱电位。习惯上按频率拆成五个节律：深睡 δ、困倦 θ、放松闭眼 α、清醒专注 β、高级认知 γ。',
    subtitleEn:
      'Scalp EEG is the summed weak potential of countless synchronized cortical neurons. By frequency: deep-sleep δ, drowsy θ, relaxed eyes-closed α, alert β, high cognition γ.',
  },
  emg: {
    title: '肌电图',
    titleEn: 'Electromyography (EMG)',
    subtitle:
      '肌肉收缩时，成百上千个运动单元各自发放动作电位，经皮肤电极叠加成高频、随机的毛刺信号——表面肌电的干涉模式。用力越大，被募集的单元越多、放电越快，幅度越高。',
    subtitleEn:
      'During contraction, hundreds of motor units fire; skin electrodes sum them into a high-frequency, noisy interference pattern—surface EMG. Harder effort recruits more units, fires faster, and raises amplitude.',
  },
  emwave3d: {
    title: '电磁波 · 3D',
    titleEn: 'EM wave · 3D',
    subtitle:
      '电场 E（红，沿 y）与磁场 B（蓝，沿 x）相互垂直、同相振荡，并一起沿 z 方向以光速传播——这就是「电磁能」的本来面目。拖动可旋转视角。',
    subtitleEn:
      'Electric field E (red, y) and magnetic field B (blue, x) oscillate in phase, mutually perpendicular, and travel along z at light speed—electromagnetic energy in the raw. Drag to orbit the view.',
  },
  faraday: {
    title: '电磁感应 · 法拉第',
    titleEn: 'Electromagnetic induction · Faraday',
    subtitle:
      '变化的磁通会在闭合回路中激起感应电动势，感应电流总反抗磁通的变化（楞次定律）。匀强磁场中匀速旋转的线圈，磁通与感应电动势相位相差四分之一周期——这正是交流发电机的原理。',
    subtitleEn:
      'Changing flux induces EMF in a closed loop; induced current opposes the change (Lenz). A coil spinning steadily in a uniform field has flux and EMF a quarter-cycle out of phase—the AC generator principle.',
  },
  fdtd: {
    title: '时域电磁场 · 麦克斯韦',
    titleEn: 'FDTD · Maxwell',
    subtitle:
      '在交错网格上积分麦克斯韦旋度方程，看电磁波在真空与介质中传播、反射、衍射与会聚。点击画布注入源，切换介质界面、双缝、透镜、谐振腔等经典算例——电磁能量的可计算验证。',
    subtitleEn:
      'Integrate Maxwell curl equations on a staggered grid: propagation, reflection, diffraction, and focusing in free space and media. Click to inject sources; switch interfaces, double slits, lenses, cavities—computable EM checks.',
  },
  fluid: {
    title: '二维流体 · 染料与速度场',
    titleEn: '2D fluid · dye and velocity',
    subtitle: '设置边界、障碍形状、染料与速度；在本机或后端计算二维流动。',
    subtitleEn: 'Set boundaries, obstacle geometry, dye and velocity; calculate 2D flow locally or on the backend.',
  },
  graph: {
    title: '能量本体图谱',
    titleEn: 'Energy ontology graph',
    subtitle:
      '一切能量传输都是节点与节点之间的连线。点击顶层能量，查看其子形态、转换边、可执行公式与学界共识。关联元争议见「争议与多解释」。',
    subtitleEn:
      'All energy transfer is links between nodes. Click a top-level form for subforms, conversion edges, executable formulas, and consensus. Meta-debates live under Controversies.',
  },
  heaterfc: {
    title: '一维热扩散',
    titleEn: '1D heat diffusion',
    subtitle:
      '观察冷热界面随时间展宽，将数值温度剖面与无限域误差函数解析解比较。',
    subtitleEn:
      'Observe a hot/cold interface spread over time and compare the numerical temperature profile with the infinite-domain erfc solution.',
  },
  ising: {
    title: '二维伊辛模型 · 蒙特卡洛',
    titleEn: '2D Ising · Monte Carlo',
    subtitle:
      '设置初态、预热与采样次数，比较有限格点的磁化统计和无限格点平衡参考。',
    subtitleEn:
      'Choose an initial state, burn-in and sample count; compare finite-lattice magnetization statistics with an infinite-lattice equilibrium reference.',
  },
  laser: {
    title: '激光原理 · 受激辐射与阈值',
    titleEn: 'Laser · stimulated emission & threshold',
    subtitle:
      '泵浦把原子抽运到高能级形成「粒子数反转」；腔内光子经受激辐射被相干放大、在两镜间往返。泵浦超过阈值时光子数雪崩式增长——起振，从输出镜射出激光。',
    subtitleEn:
      'Pumping builds population inversion; cavity photons amplify coherently via stimulated emission between mirrors. Above threshold, photon number avalanches—oscillation and output through the coupler.',
  },
  localization: {
    title: '三角/回波定位',
    titleEn: 'Trilateration / echo ranging',
    subtitle:
      '目标发出（或反射）的波前被多个锚点接收，各自测得一个距离；以锚点为圆心画测距圆，多圆交汇即目标位置。这正是卫星导航、声呐、雷达、室内定位的共同原理。',
    subtitleEn:
      'Wavefronts from a source (or echo) give each anchor a range; circles about anchors intersect at the target. Shared principle of GNSS, sonar, radar, and indoor ranging.',
  },
  md: {
    title: '分子动力学',
    titleEn: 'Molecular dynamics',
    subtitle:
      '从相同初态推进二维 Lennard–Jones 粒子，观察能量、压强、均方位移与径向分布。',
    subtitleEn:
      'Advance 2D Lennard–Jones particles from a reproducible initial state and inspect energy, pressure, mean-square displacement and radial distribution.',
  },
  matrix: {
    title: '能量转换矩阵',
    titleEn: 'Energy conversion matrix',
    subtitle: '从形式到形式的转换边、效率与公式一览。',
    subtitleEn: 'Conversion edges, efficiencies, and formulas from form to form at a glance.',
  },
  methods: {
    title: '基础方法 · 波世界',
    titleEn: 'Foundational methods · WaveWorld',
    subtitle:
      '一切计算步骤皆可模块化：方法族 → 算法/步进 → 更细原子。同一现象允许多学科并行模块并列，不裁决唯一真理。',
    subtitleEn:
      'Every compute step is modular: family → algorithm/step → finer atoms. Parallel multi-discipline modules may coexist for one phenomenon—no single truth is crowned.',
  },
  mutual: {
    title: '互感 · 变压器',
    titleEn: 'Mutual inductance · transformer',
    subtitle:
      '两个磁耦合的线圈构成变压器：初级电流变化经互感在次级感应出电动势。调耦合系数与匝比，给初级加正弦或阶跃激励，观察次级电流与传能效率。',
    subtitleEn:
      'Two magnetically coupled coils form a transformer: primary current change induces secondary EMF via mutual inductance. Tune coupling and turns ratio; drive sine or step and watch secondary current and transfer.',
  },
  nljd: {
    title: '非线性结探测',
    titleEn: 'Nonlinear junction detection',
    subtitle:
      '发射单频照射目标：半导体结（真电子器件）因强非线性再辐射二次谐波；锈蚀假结往往三次谐波更强；纯线性金属只回基频。比较频谱里二次与三次谐波强弱即可隔墙判别器件类型。',
    subtitleEn:
      'Illuminate with a single tone: semiconductor junctions re-radiate 2nd harmonic; rusty false junctions often favor 3rd; pure metal returns only the fundamental. Compare harmonics to classify through walls.',
  },
  neuron: {
    title: '神经电 · 动作电位',
    titleEn: 'Neuron · action potential',
    subtitle:
      '简化神经元模型再现动作电位的「全或无」：阈下刺激只让膜电位小幅去极化后回落；一旦越过阈值，便触发幅度固定的完整尖峰，随后进入不应期并恢复静息。',
    subtitleEn:
      'A simplified neuron shows all-or-none spikes: subthreshold stimuli only briefly depolarize; past threshold a fixed-amplitude spike fires, then refractory recovery to rest.',
  },
  'optics-lab': {
    title: '光学实验场',
    titleEn: 'Optics lab',
    subtitle: '可配置的几何光学仿真台：搭光路、调参数、读测量——站内标杆交互仿真。',
    subtitleEn:
      'Configurable geometric-optics bench: build paths, tune parameters, read measurements—the site’s flagship interactive sim.',
  },
  paths: {
    title: '能量转换路径',
    titleEn: 'Energy conversion paths',
    subtitle:
      '从一种能量到另一种，往往要经过多次转换。优化模式在能量图上求「累积效率最高」的全局最优路径，以及若干次优备选——把效率换成损耗代价后找最短路，避免被跳数截断漏解。',
    subtitleEn:
      'Form-to-form conversion often needs multiple hops. Optimize mode finds the global best cumulative-efficiency path (and near-bests) by shortest path on loss cost—no hop-count truncation surprises.',
  },
  particles: {
    title: '粒子与材料模型',
    titleEn: 'Particle and material models',
    subtitle: '输入物种、坐标与相互作用，或导入二维 LAMMPS 数据；PEDOT:PSS 是可编辑示例。',
    subtitleEn: 'Define species, coordinates and interactions, or import 2D LAMMPS data; PEDOT:PSS is an editable example.',
  },
  phasedarray: {
    title: '相控阵波束成形 · 电子扫描',
    titleEn: 'Phased-array beamforming · electronic scan',
    subtitle:
      '多个等距阵元排成一线，给每个阵元施加线性递增相移，无需机械转动即可让合成波束指向任意角度。右侧极坐标方向图实时显示主瓣、旁瓣与栅瓣。',
    subtitleEn:
      'Equally spaced elements get progressive phase shifts so the combined beam steers without mechanical motion. Right polar plot shows main lobe, sidelobes, and grating lobes live.',
  },
  phenomena: {
    title: '前沿现象 / 通路',
    titleEn: 'Frontier phenomena / pathways',
    subtitle:
      '被策展的多跳前沿换能通路——不是单条边，而是跨多个节点的科学故事。每个现象并呈多条竞争机理假说（虚线汇聚枢纽），并附真实工程/科研/临床档案。',
    subtitleEn:
      'Curated multi-hop frontier conversion stories—not single edges but multi-node narratives. Competing mechanism hypotheses meet at dashed hubs, with real engineering/research/clinical dossiers.',
  },
  radar: {
    title: '雷达回波 · 示波器',
    titleEn: 'Radar return · oscilloscope',
    subtitle:
      '发射源发出电磁脉冲，遇到墙、硅靶、金属电器反射，形成直达波与一次、二次回波（多径）。在左侧点击放置探针（最多四路），右侧示波器实时显示各探针波形。',
    subtitleEn:
      'A pulse radiates, reflects from walls, silicon, and metal—direct path plus multipath echoes. Click left to place up to four probes; the scope on the right shows each trace live.',
  },
  ripple: {
    title: '波纹水池 · 传播与叠加',
    titleEn: 'Ripple tank · propagation and superposition',
    subtitle:
      '设置初始波峰或波谷，从静止释放，观察二维波动传播和固定边界反射。',
    subtitleEn:
      'Set initial crests or troughs, release them from rest, and observe 2D propagation and reflection from fixed walls.',
  },
  rlc: {
    title: '谐振电路 · 阻尼',
    titleEn: 'RLC resonator · damping',
    subtitle:
      '串联谐振电路是二阶振荡系统：电感储磁能、电容储电能，二者来回倒腾形成振荡，电阻则把能量耗成热。阻尼比决定相态——欠阻尼振荡衰减、临界最快无过冲、过阻尼单调回落。',
    subtitleEn:
      'Series RLC is a second-order oscillator: L and C exchange energy while R dissipates heat. Damping ratio sets the regime—underdamped rings, critical returns fastest without overshoot, overdamped creeps home.',
  },
  smith: {
    title: '史密斯圆图 · 反射系数',
    titleEn: 'Smith chart · reflection coefficient',
    subtitle:
      '阻抗 z 经 Γ=(z−1)/(z+1) 折进单位圆盘：恒阻/恒抗变成圆族。拖动圆点或调 R、X，看驻波比与回波损耗；电长度滑条沿 |Γ| 圆顺时针旋转（朝向发生器）。',
    subtitleEn:
      'Impedance z folds into the unit disk via Γ=(z−1)/(z+1): constant-r/x become circle families. Drag the point or tune R,X for VSWR and return loss; electrical length rotates clockwise at fixed |Γ| (toward generator).',
  },
  stm: {
    title: '扫描隧道显微',
    titleEn: 'Scanning tunneling microscopy',
    subtitle:
      '把原子级锐利的金属针尖逼近导电表面到约一纳米，电子量子隧穿形成电流。间距每变化 0.1 纳米，电流就改变一个数量级——这种指数灵敏度让它能逐点「看见」单个原子的起伏。',
    subtitleEn:
      'An atomically sharp tip approaches a conductor to ~1 nm; tunnel current flows. ~0.1 nm gap change moves current by an order of magnitude—exponential sensitivity that maps atomic height point by point.',
  },
  sensing: {
    title: '传感 / 换能查找',
    titleEn: 'Sensing / conversion lookup',
    subtitle:
      '传感器 = 换能链。边缘自供电序优先俘能/换能器尺度；再链到节点功耗账本（采集能否盖住负载）与史密斯匹配。',
    subtitleEn:
      'Sensor = conversion chain. Edge self-power order prefers harvester scale; links to node budget (does harvest cover load?) and Smith matching.',
  },
  'node-budget': {
    title: '节点功耗账本 · 占空比寿命',
    titleEn: 'Node energy budget · duty-cycle life',
    subtitle:
      '睡眠/唤醒 → 平均功耗；对照采集功率判断自供电是否成立，并估寿命或所需 mAh。边缘计算自供电节点的算账页。',
    subtitleEn:
      'Sleep/wake → average power; check whether harvest covers the load (self-powered), then lifetime or required mAh. Ledger for edge self-powered nodes.',
  },
  sim: {
    title: '二维热扩散',
    titleEn: '2D heat diffusion',
    subtitle:
      '设置初始热区，观察热量在绝热边界内扩散。点击画布添加热区；编辑输入会从初始场重新计算。',
    subtitleEn:
      'Set initial hot regions and observe diffusion inside insulated walls. Click to add a region; editing inputs restarts from the initial field.',
  },
  tdoa: {
    title: '时差双曲线定位',
    titleEn: 'TDOA hyperbolic localization',
    subtitle:
      '多个接收机记录信号到达时间，时差乘以波速就是距离差。距离差固定的点落在一支双曲线上；多对双曲线交汇即信号源位置。无需知道发射时刻。',
    subtitleEn:
      'Receivers record arrival times; time difference × wave speed is range difference. Constant range-difference loci are hyperbolas; intersections locate the source—no need for transmit time.',
  },
  taxonomy: {
    title: '方法分类图谱',
    titleEn: 'Method taxonomy map',
    subtitle: '色点=方法类型 · 纵轴/半径=年代 · 丝线=先修关系。点击追溯学习路径；方向键切换节点。',
    subtitleEn:
      'Color = method kind · axis/radius = year · threads = prerequisites. Click for learning trails; arrow keys move selection.',
  },
  transducers: {
    title: '能量换能器百科',
    titleEn: 'Energy transducer encyclopedia',
    subtitle:
      '换能器是把一种能量形式转换为另一种的器件。可挂接本体节点；页眉方法叙事说明卡片、效率与图谱如何对应——未入本体的出口（如信息/智能）见争议页。',
    subtitleEn:
      'A transducer converts one energy form into another. Linkable to ontology nodes; header method narrative ties cards, efficiency, and graph. Outlets not yet in the ontology (e.g. information/intelligence) live under Controversies.',
  },
  transient: {
    title: '一阶暂态 · 充放电',
    titleEn: 'First-order transient · charge/discharge',
    subtitle:
      '单个储能元件与电阻组成一阶电路，对阶跃激励总是「单指数趋稳」：以时间常数为尺度从初值爬向终值。电容充电约一个时间常数到六成多、约五个可视为稳态。',
    subtitleEn:
      'One storage element plus resistance is first-order: step drive always approaches steady state as a single exponential set by the time constant (~63% in one τ, ~settled by five).',
  },
  ultrasound: {
    title: '超声 B 超成像',
    titleEn: 'Ultrasound B-mode imaging',
    subtitle:
      '超声脉冲射入组织，每遇到声阻抗不同的界面就反射出回波——阻抗差越大回波越强。把一条声束上的回波按深度排成线，横向扫描再按亮度拼成 B 超灰度图。',
    subtitleEn:
      'Pulses enter tissue; each acoustic-impedance interface returns an echo—larger contrast, stronger echo. Stack depth lines by brightness while scanning laterally to form the familiar B-mode gray image.',
  },
  windtunnel: {
    title: '三维风洞',
    titleEn: '3D wind tunnel',
    subtitle: '选择或导入模型，设置来流与边界条件，在本机或后端计算气流分布。',
    subtitleEn: 'Choose or import a model, set airflow and boundaries, and calculate flow fields locally or on the backend.',
  },
  'batch-jobs': {
    title: '批算任务',
    titleEn: 'Batch jobs',
    subtitle:
      '对接 Phase 1 宿主 API（默认 :3001）：查看任务状态、Cd/Cl 结果，并提交演示批算。',
    subtitleEn:
      'Talks to the Phase 1 host API (default :3001): list job status, Cd/Cl results, and submit a demo batch job.',
  },
  'my-projects': {
    title: '我的项目',
    titleEn: 'My projects',
    subtitle: '登录后管理个人风洞 / 批算项目：创建、归档、关联模型与任务。',
    subtitleEn:
      'Sign in to manage personal wind-tunnel / batch projects: create, archive, link models and jobs.',
  },
  comsol: {
    title: 'COMSOL 原生案例',
    titleEn: 'COMSOL native cases',
    subtitle: '选择 W-Sim 原生模块算例，检查输入与实现边界，再提交到共享计算任务。',
    subtitleEn: 'Choose a W-Sim native module case, review its inputs and implementation limits, then submit it to shared compute jobs.',
  },
  ansys: {
    title: 'Ansys 能力案例',
    titleEn: 'Ansys capability cases',
    subtitle: '按产品浏览 W-Sim 对应能力案例，检查输入与实现边界，再将所选案例提交到 Host 任务。',
    subtitleEn: 'Browse W-Sim cases mapped to Ansys product capabilities, review inputs and implementation limits, then submit the selected case to a Host job.',
  },
  abaqus: {
    title: 'Abaqus 能力案例',
    titleEn: 'Abaqus capability cases',
    subtitle: '按 Abaqus 功能浏览映射的 W-Sim 案例，检查输入与实现边界，再将所选案例提交到 Host 任务。',
    subtitleEn: 'Browse W-Sim cases mapped to Abaqus features, review inputs and implementation limits, then submit the selected case to a Host job.',
  },
  opticstudio: {
    title: 'Ansys Zemax OpticStudio 能力案例',
    titleEn: 'Ansys Zemax OpticStudio capability cases',
    subtitle: '按光学工作流浏览 W-Sim 原生案例，检查实际输入与限制，再提交到 Host 任务。',
    subtitleEn: 'Browse W-Sim native cases by optical workflow, review actual inputs and limits, then submit a Host job.',
  },
  dymola: {
    title: 'Dymola 能力案例',
    titleEn: 'Dymola capability cases',
    subtitle: '按 Dymola 功能浏览映射的 W-Sim 案例，检查输入与实现边界，再提交到 Host 任务。',
    subtitleEn: 'Browse W-Sim cases mapped to Dymola features, review inputs and implementation limits, then submit a Host job.',
  },
  'star-ccm': {
    title: 'STAR-CCM+ 能力案例',
    titleEn: 'STAR-CCM+ capability cases',
    subtitle: '按 Simcenter STAR-CCM+ 功能概念浏览映射的 W-Sim 案例，检查输入与实现边界，再提交到 Host 任务。',
    subtitleEn: 'Browse W-Sim cases mapped to Simcenter STAR-CCM+ feature concepts, review inputs and implementation limits, then submit a Host job.',
  },
  cst: {
    title: 'CST Studio Suite 能力案例',
    titleEn: 'CST Studio Suite capability cases',
    subtitle: '按电磁功能浏览映射的 W-Sim 案例，检查实际输入与实现限制，再提交到 Host 任务。',
    subtitleEn: 'Browse W-Sim cases mapped to electromagnetic capabilities, inspect actual inputs and limits, then submit a Host job.',
  },
  world: {
    title: '世界图 · 方法时序',
    titleEn: 'World map · method timeline',
    subtitle:
      '时间轴上的基础物理方法节点：公理年代 → 多学派透镜 → 站内可运行样板，并挂接能量本体。这是「把世界搬进系统」的时空骨架——可无限追加方法，不裁决唯一真理。',
    subtitleEn:
      'Foundational methods on a timeline: axiom year → multi-school lenses → runnable demos, linked to the energy ontology. A spacetime scaffold for “moving the world into the system”—open-ended, no single truth.',
  },
  sound: {
    title: '声波频谱',
    titleEn: 'Sound spectrum',
    subtitle: '从次声波到超声波，机械波在介质中以压缩与稀疏传递能量。',
    subtitleEn:
      'From infrasound to ultrasound—mechanical waves carry energy as compression and rarefaction in a medium.',
  },
  vibration: {
    title: '振动频谱',
    titleEn: 'Vibration spectrum',
    subtitle: '从量子涨落到天体振荡，振动是物质运动最普遍的语言。',
    subtitleEn:
      'From quantum fluctuations to stellar oscillations—vibration is matter’s most universal motion language.',
  },
  electromagnetic: {
    title: '电磁波谱',
    titleEn: 'Electromagnetic spectrum',
    subtitle: '从无线电到伽马射线，同一种电磁振动横跨 19 个数量级的频率。',
    subtitleEn:
      'From radio to gamma rays—the same electromagnetic oscillation spans ~19 orders of magnitude in frequency.',
  },
  article: {
    title: '世界是一个巨大的换能器',
    titleEn: 'The world is a vast transducer',
    subtitle:
      '从恒星核聚变到你眼前屏幕发出的光，宇宙的全部历史，都是能量在不同形式间不断转换的故事。',
    subtitleEn:
      'From stellar fusion to the light of the screen before you—the whole history of the cosmos is energy converting between forms.',
  },
}

export function pageHeaderForRoute(route: string): PageHeaderCopy | undefined {
  const base = route.split('/')[0] ?? route
  return PAGE_HEADERS[base] ?? PAGE_HEADERS[route]
}
