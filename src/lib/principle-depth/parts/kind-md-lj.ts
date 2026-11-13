import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_MD_LJ: CalculationMethod = {
    id: 'kind-md-lj',
    titleZh: '分子动力学 LJ（工程 kind）',
    titleEn: 'Molecular dynamics LJ (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind md-batch：牛顿 MD + Lennard-Jones 对势；工程路径归 @w-sim/solvers-md。',
    summaryEn:
      'W-Sim kind md-batch: Newtonian MD + LJ pairs; owned by @w-sim/solvers-md.',
    jobKinds: ['md-batch'],
    explainRoot: {
      id: 'md-root',
      layer: 'method',
      titleZh: '方法：MD / LJ n-body',
      titleEn: 'Method: MD / LJ n-body',
      bodyZh:
        '顶层工程计算方法：粒子在对势力下按牛顿第二定律积分，输出能量、力与轨迹 KPI。数值实现归 @w-sim/solvers-md（Verlet / Langevin / PBC 等模式）。',
      bodyEn:
        'Particles integrate Newton under pair forces; owned by @w-sim/solvers-md.',
      jobKinds: ['md-batch'],
      children: [
        {
          id: 'md-principle-lj',
          layer: 'principle',
          titleZh: '原理：Lennard-Jones 对势',
          titleEn: 'Principle: Lennard-Jones pair potential',
          bodyZh:
            '短程排斥 ~ r⁻¹² 与长程吸引 ~ r⁻⁶ 合成经典对势；总势能是粒子对之和（可加 cutoff / 软化）。',
          bodyEn:
            'Repulsive r⁻¹² + attractive r⁻⁶; total U is sum of pairs (optional cutoff/softening).',
          children: [
            {
              id: 'md-foundation-lj-u',
              layer: 'foundation',
              titleZh: '基础式：U(r) = 4ε [(σ/r)¹² − (σ/r)⁶]',
              titleEn: 'Foundation: U(r) = 4ε [(σ/r)¹² − (σ/r)⁶]',
              bodyZh:
                'ε 为阱深，σ 为零势距。在 r_min = 2^(1/6) σ 处 U = −ε。要求 r>0、ε>0、σ>0。',
              bodyEn:
                'Well depth ε, zero-crossing σ; U(−ε) at r_min = 2^(1/6) σ.',
              formula: {
                expr: 'U = 4 * epsilon * ((sigma/r)**12 - (sigma/r)**6)',
                vars: {
                  U: '对势能 energy',
                  epsilon: '阱深 ε',
                  sigma: '特征长度 σ',
                  r: '粒子间距',
                },
                sample: {
                  epsilon: 1,
                  sigma: 1,
                  r: Math.pow(2, 1 / 6),
                },
                expected: -1,
                plainZh: 'LJ 对势能由 12–6 幂次与阱深、特征长度决定',
                plainEn: 'LJ pair energy from 12–6 powers with well depth and length scale',
              },
            },
            {
              id: 'md-foundation-lj-force',
              layer: 'foundation',
              titleZh: '基础：中心力 F = −dU/dr',
              titleEn: 'Foundation: central force F = −dU/dr',
              bodyZh:
                '径向力幅度 F(r) = (24ε/r) [2(σ/r)¹² − (σ/r)⁶]；正号为排斥。n-body 按 Newton III 成对累加。',
              bodyEn:
                'Radial magnitude F=(24ε/r)[2(σ/r)¹²−(σ/r)⁶]; pairs obey Newton III.',
              formula: {
                expr: 'F = (24 * epsilon / r) * (2 * (sigma/r)**12 - (sigma/r)**6)',
                vars: {
                  F: '径向力幅度',
                  epsilon: '阱深 ε',
                  sigma: '特征长度 σ',
                  r: '粒子间距',
                },
                sample: { epsilon: 1, sigma: 1, r: 1 },
                expected: 24,
                plainZh: '在 r=σ 处 LJ 径向力幅度为 24ε/σ',
                plainEn: 'At r=σ the LJ radial force magnitude is 24ε/σ',
              },
            },
            {
              id: 'md-foundation-lj-rmin',
              layer: 'foundation',
              titleZh: '基础式：r_min = 2^{1/6} σ',
              titleEn: 'Foundation: r_min = 2^{1/6} σ',
              bodyZh:
                '对势极小点：dU/dr = 0 时 r_min = 2^{1/6} σ ≈ 1.122 σ。此处吸引与排斥径向力相消，U(r_min) = −ε。',
              bodyEn:
                'Potential minimum at r_min = 2^{1/6} σ; force cancels and U = −ε.',
              formula: {
                expr: 'r_min = 2^(1/6) * sigma',
                vars: {
                  r_min: '势阱最小间距',
                  sigma: '特征长度 σ',
                },
                sample: { sigma: 1 },
                expected: Math.pow(2, 1 / 6),
                plainZh: 'LJ 势阱最小间距等于 2 的六分之一次方乘特征长度 σ',
                plainEn: 'LJ well minimum distance is 2^(1/6) times σ',
              },
            },
            {
              id: 'md-foundation-lj-well',
              layer: 'foundation',
              titleZh: '基础式：U(r_min) = −ε',
              titleEn: 'Foundation: U(r_min) = −ε',
              bodyZh:
                '阱深定义：在 r_min 处对势能恰好等于 −ε。工程/教学 smoke 常以 ε=1、σ=1 的约化单位自检。',
              bodyEn:
                'Well depth: U(r_min)=−ε; reduced units often take ε=σ=1.',
              formula: {
                expr: 'U_min = -epsilon',
                vars: {
                  U_min: '阱底对势能',
                  epsilon: '阱深 ε',
                },
                sample: { epsilon: 1 },
                expected: -1,
                plainZh: 'LJ 阱底对势能等于负的阱深 −ε',
                plainEn: 'LJ well-bottom pair energy equals minus the well depth −ε',
              },
            },
            {
              id: 'md-foundation-lj-sr6',
              layer: 'foundation',
              titleZh: '基础式：U = 4ε (s⁶)² − 4ε s⁶，s = σ/r',
              titleEn: 'Foundation: U = 4ε (s⁶)² − 4ε s⁶ with s=σ/r',
              bodyZh:
                '实现友好写法：先算 sr6 = (σ/r)⁶，则 U = 4ε (sr6² − sr6)。在 r=σ 时 sr6=1、U=0（零势距）。',
              bodyEn:
                'Implement as sr6=(σ/r)⁶ then U=4ε(sr6²−sr6); at r=σ, U=0.',
              formula: {
                expr: 'U = 4 * epsilon * (sr6 * sr6 - sr6)',
                vars: {
                  U: '对势能 energy',
                  epsilon: '阱深 ε',
                  sr6: '(σ/r)⁶ 中间量',
                },
                sample: { epsilon: 1, sr6: 1 },
                expected: 0,
                plainZh: '用 (σ/r)⁶ 中间量计算 LJ 对势能，在 r=σ 处为零',
                plainEn: 'LJ pair energy via (σ/r)⁶ intermediate; zero at r=σ',
              },
            },
            {
              id: 'md-foundation-lj-force-eq',
              layer: 'foundation',
              titleZh: '基础：r_min 处 F = 0',
              titleEn: 'Foundation: F(r_min) = 0',
              bodyZh:
                '在 r = 2^{1/6} σ 处 (σ/r)⁶ = 1/2，故 2(σ/r)¹² − (σ/r)⁶ = 0，径向力幅度为零（力学平衡点）。',
              bodyEn:
                'At r_min, (σ/r)⁶=1/2 so radial force magnitude vanishes (mechanical equilibrium).',
              formula: {
                expr: 'F_eq = (24 * epsilon / r_min) * (2 * sr12 - sr6)',
                vars: {
                  F_eq: '平衡点径向力',
                  epsilon: '阱深 ε',
                  r_min: '势阱最小间距',
                  sr12: '(σ/r_min)¹²',
                  sr6: '(σ/r_min)⁶',
                },
                sample: {
                  epsilon: 1,
                  r_min: Math.pow(2, 1 / 6),
                  sr12: 0.25,
                  sr6: 0.5,
                },
                expected: 0,
                plainZh: '在 LJ 势阱最小间距处径向力幅度为零',
                plainEn: 'Radial LJ force magnitude is zero at the potential minimum',
              },
            },
            {
              id: 'md-foundation-lj-pair-sum',
              layer: 'foundation',
              titleZh: '基础式：U_tot = Σ_{i<j} U(r_ij)',
              titleEn: 'Foundation: U_tot = Σ_{i<j} U(r_ij)',
              bodyZh:
                '经典对势总势能是无序对之和（等价 ½ Σ_i Σ_{j≠i}）。三粒子全连接时 U_tot = U12+U13+U23；算例取三对均在阱底 → U_tot = −3ε。',
              bodyEn:
                'Total pair energy is unordered pair sum; three particles at well bottoms → U_tot=−3ε.',
              formula: {
                expr: 'U_tot = U12 + U13 + U23',
                vars: {
                  U_tot: '系统对势总能',
                  U12: '对 1–2 势能',
                  U13: '对 1–3 势能',
                  U23: '对 2–3 势能',
                },
                sample: { U12: -1, U13: -1, U23: -1 },
                expected: -3,
                plainZh: '系统 LJ 对势总能等于各无序粒子对势能之和',
                plainEn: 'Total LJ pair energy is the sum over unordered particle pairs',
              },
            },
            {
              id: 'md-foundation-lj-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '成对可加、经典点粒子、可选截断/移位/长程尾修正；化学键/多体势/量子核需扩展。r→0 时 r⁻¹² 发散，实现需软化或邻域列表 + 最小镜像。工程 smoke 覆盖能量残差与 Newton III 力闭合。',
              bodyEn:
                'Pairwise classical points; bonds/many-body/quantum need extensions; eng smoke covers energy residual and force closure.',
            },
          ],
        },
        {
          id: 'md-principle-newton',
          layer: 'principle',
          titleZh: '原理：牛顿第二定律与积分',
          titleEn: 'Principle: Newton II & integrators',
          bodyZh:
            'm a = F；Verlet / velocity-Verlet 守恒性好；Langevin / BAOAB 引入热浴。温控/压控是控制层，叠在 LJ+Newton 之上。',
          bodyEn:
            'm a = F; Verlet conserves well; Langevin/BAOAB add thermostats.',
          children: [
            {
              id: 'md-foundation-verlet',
              layer: 'foundation',
              titleZh: '基础式：Verlet 位置步 x′ = x + v Δt + ½ a Δt²',
              titleEn: 'Foundation: Verlet position step x′ = x + v Δt + ½ a Δt²',
              bodyZh:
                'velocity-Verlet / 等价形式的位置更新。dt 需分辨最快振动；过大 dt 使能量漂移爆炸。工程 smoke 覆盖多步能量残差与力闭合。',
              bodyEn:
                'Position half of velocity-Verlet; dt must resolve fastest modes; smoke covers energy residual.',
              formula: {
                expr: 'x_new = x + v * dt + 0.5 * a * dt * dt',
                vars: {
                  x_new: '更新后坐标',
                  x: '当前坐标',
                  v: '速度',
                  a: '加速度 (= F/m)',
                  dt: '时间步',
                },
                sample: { x: 0, v: 1, a: -2, dt: 0.1 },
                expected: 0.09,
                plainZh: 'Verlet 位置步由当前坐标、速度与加速度二次展开得到',
                plainEn: 'Verlet position update from current x, v, and acceleration',
              },
            },
            {
              id: 'md-foundation-ke',
              layer: 'foundation',
              titleZh: '基础式：KE = ½ m v²',
              titleEn: 'Foundation: KE = ½ m v²',
              bodyZh:
                '单粒子平动动能。多体时 KE = Σ_i ½ m_i |v_i|²。与对势 U_tot 合成为守恒可观测量 E。',
              bodyEn:
                'Per-particle kinetic energy; many-body sums ½ m |v|²; with U_tot forms conserved E.',
              formula: {
                expr: 'KE = 0.5 * m * v * v',
                vars: {
                  KE: '动能 energy',
                  m: '质量',
                  v: '速率',
                },
                sample: { m: 2, v: 3 },
                expected: 9,
                plainZh: '平动动能等于二分之一质量乘速率平方',
                plainEn: 'Translational kinetic energy is one-half mass times speed squared',
              },
            },
            {
              id: 'md-foundation-etot',
              layer: 'foundation',
              titleZh: '基础式：E = KE + U_tot',
              titleEn: 'Foundation: E = KE + U_tot',
              bodyZh:
                '微正则（NVE）下总能量近似守恒：动能 + LJ 对势总能。工程 KPI 常报 |E(t)−E(0)|/|E(0)| 能量残差。',
              bodyEn:
                'NVE total energy ≈ KE + pair U; eng KPI often relative energy residual.',
              formula: {
                expr: 'E = KE + U_tot',
                vars: {
                  E: '总机械能',
                  KE: '动能',
                  U_tot: '对势总能',
                },
                sample: { KE: 9, U_tot: -1 },
                expected: 8,
                plainZh: '总机械能等于动能与 LJ 对势总能之和',
                plainEn: 'Total mechanical energy is kinetic plus LJ pair potential',
              },
            },
            {
              id: 'md-foundation-newton3',
              layer: 'foundation',
              titleZh: '基础：Newton III 力闭合 F_ij + F_ji = 0',
              titleEn: 'Foundation: Newton III F_ij + F_ji = 0',
              bodyZh:
                '中心力对势自动满足作用反作用；成对累加时总动量源项为零。smoke 校验 Σ F ≈ 0（除外力/热浴）。',
              bodyEn:
                'Central pair forces obey action–reaction; smoke checks ΣF≈0 absent external/thermostat forces.',
              formula: {
                expr: 'F_sum = F_ij + F_ji',
                vars: {
                  F_sum: '成对力之和',
                  F_ij: 'i→j 作用力分量',
                  F_ji: 'j→i 反作用分量',
                },
                sample: { F_ij: 24, F_ji: -24 },
                expected: 0,
                plainZh: 'LJ 中心力对满足作用力与反作用力之和为零',
                plainEn: 'LJ central pair forces sum to zero by Newton III',
              },
            },
          ],
        },
        {
          id: 'md-principle-nvt-npt',
          layer: 'principle',
          titleZh: '原理：NVT/NPT 系综与平衡诚实',
          titleEn: 'Principle: NVT/NPT ensemble & equilibration honesty',
          bodyZh:
            '温控（NVT）与压控（NPT）叠在 LJ+Newton 之上：瞬时动能温度与目标 T、压力与目标 P 在平衡窗内应诚实闭合。NVE 能量守恒不再是主 KPI；诚实合同改为 |T̄−T★|/T★、|P̄−P★|/|P★| 与速度/体积耦合残差。',
          bodyEn:
            'Thermostats (NVT) and barostats (NPT) sit atop LJ+Newton; equilibration honesty is |T̄−T★|/T★ and |P̄−P★|/|P★|, not NVE energy drift.',
          children: [
            {
              id: 'md-foundation-T-from-ke',
              layer: 'foundation',
              titleZh: '基础式：T = 2 KE / N_dof（约化 k_B=1）',
              titleEn: 'Foundation: T = 2 KE / N_dof (k_B=1)',
              bodyZh:
                '瞬时动能温度：KE = (N_dof/2) k_B T，约化 k_B=1 时 T=2 KE/N_dof。热浴以该 T 与目标 T★ 比较。',
              bodyEn:
                'Instantaneous kinetic temperature; reduced k_B=1 → T=2 KE/N_dof; thermostats compare to T★.',
              formula: {
                expr: 'T = 2 * KE / N_dof',
                vars: {
                  T: '瞬时动能温度（约化）',
                  KE: '总动能',
                  N_dof: '自由度数目',
                },
                sample: { KE: 150, N_dof: 297 },
                expected: (2 * 150) / 297,
                plainZh: '约化单位下瞬时温度等于 2 倍动能除以自由度',
                plainEn:
                  'Reduced-unit instantaneous temperature is twice kinetic energy over degrees of freedom',
              },
            },
            {
              id: 'md-foundation-Ndof',
              layer: 'foundation',
              titleZh: '基础式：N_dof = 3N − 3（去质心）',
              titleEn: 'Foundation: N_dof = 3N − 3 (COM removed)',
              bodyZh:
                '三维平动自由度常扣去 3 个质心动量约束（固定 COM）。算例 N=100 → N_dof=297。更严约束（去角动量等）另计。',
              bodyEn:
                '3D translational dof often subtract 3 COM constraints; sample N=100 → 297.',
              formula: {
                expr: 'N_dof = 3 * N - 3',
                vars: {
                  N_dof: '平动自由度',
                  N: '粒子数',
                },
                sample: { N: 100 },
                expected: 297,
                plainZh: '去质心后三维平动自由度等于 3N−3',
                plainEn:
                  'Translational degrees of freedom with COM removed equal 3N−3',
              },
            },
            {
              id: 'md-foundation-velocity-scale',
              layer: 'foundation',
              titleZh: '基础式：λ = √(T★ / T) 速度缩放',
              titleEn: 'Foundation: λ = √(T★ / T) velocity scale',
              bodyZh:
                '理想速度重标使瞬时温度一步到目标：v′=λ v，λ=√(T★/T)。Berendsen 等弱耦合用软化形式，避免一步过冲。',
              bodyEn:
                'Ideal velocity rescaling λ=√(T★/T); weak-coupling thermostats soften the scale.',
              formula: {
                expr: 'lambda = sqrt(T_target / T)',
                vars: {
                  lambda: '速度缩放因子',
                  T_target: '目标温度 T★',
                  T: '瞬时动能温度',
                },
                sample: { T_target: 1, T: 0.81 },
                expected: Math.sqrt(1 / 0.81),
                plainZh: '速度缩放因子等于目标温度与瞬时温度之比的平方根',
                plainEn:
                  'Velocity scale factor is the square root of target over instantaneous temperature',
              },
            },
            {
              id: 'md-foundation-berendsen-lambda',
              layer: 'foundation',
              titleZh: '基础式：Berendsen λ ≈ √(1 + (Δt/τ_T)(T★/T − 1))',
              titleEn: 'Foundation: Berendsen λ ≈ √(1 + (Δt/τ_T)(T★/T − 1))',
              bodyZh:
                '弱耦合热浴：时间常数 τ_T 控制向 T★ 弛豫。算例 Δt=0.001、τ_T=0.1、T★=1、T=0.81 → λ 略大于 1。',
              bodyEn:
                'Weak-coupling thermostat; τ_T sets relaxation toward T★.',
              formula: {
                expr: 'lambda = sqrt(1 + (dt / tau_T) * (T_target / T - 1))',
                vars: {
                  lambda: 'Berendsen 速度缩放因子',
                  dt: '时间步',
                  tau_T: '温度耦合时间常数',
                  T_target: '目标温度 T★',
                  T: '瞬时温度',
                },
                sample: { dt: 0.001, tau_T: 0.1, T_target: 1, T: 0.81 },
                expected: Math.sqrt(1 + (0.001 / 0.1) * (1 / 0.81 - 1)),
                plainZh: 'Berendsen 速度缩放由时间步、耦合时间与温度比合成',
                plainEn:
                  'Berendsen velocity scale composes from dt, coupling time, and temperature ratio',
              },
            },
            {
              id: 'md-foundation-T-residual',
              layer: 'foundation',
              titleZh: '基础 KPI：温度残差 |T̄ − T★| / T★',
              titleEn: 'Foundation KPI: temperature residual |T̄ − T★| / T★',
              bodyZh:
                'NVT 平衡诚实：平衡窗平均温度 T̄ 相对目标 T★ 的相对偏差应远小于工程阈值。算例 T̄=1.01、T★=1 → 1%。',
              bodyEn:
                'NVT equilibration honesty: window-mean T̄ vs T★ relative residual; sample 1%.',
              formula: {
                expr: 'res = abs(T_mean - T_target) / abs(T_target)',
                vars: {
                  res: '温度相对残差 1',
                  T_mean: '平衡窗平均温度',
                  T_target: '目标温度 T★',
                },
                sample: { T_mean: 1.01, T_target: 1 },
                expected: 0.01,
                plainZh: 'NVT 温度残差等于平衡窗平均温度相对目标温度的偏差比',
                plainEn:
                  'NVT temperature residual is the relative deviation of window-mean T from target',
              },
            },
            {
              id: 'md-foundation-P-ideal',
              layer: 'foundation',
              titleZh: '基础式：P_kin = N T / V（约化理想气体）',
              titleEn: 'Foundation: P_kin = N T / V (reduced ideal gas)',
              bodyZh:
                '约化 k_B=1 下动能压力量级 P_kin = N T / V。完整维里压力再加对力贡献 W/(3V)。',
              bodyEn:
                'Reduced ideal kinetic pressure P_kin=N T/V; full virial adds pair-force term.',
              formula: {
                expr: 'P_kin = N * T / V',
                vars: {
                  P_kin: '动能压力（约化）',
                  N: '粒子数',
                  T: '温度',
                  V: '体积',
                },
                sample: { N: 100, T: 1, V: 1000 },
                expected: 0.1,
                plainZh: '约化理想气体动能压力等于粒子数乘温度除以体积',
                plainEn:
                  'Reduced ideal kinetic pressure is particle count times temperature over volume',
              },
            },
            {
              id: 'md-foundation-P-virial',
              layer: 'foundation',
              titleZh: '基础式：P = (2 KE + W) / (3 V)',
              titleEn: 'Foundation: P = (2 KE + W) / (3 V)',
              bodyZh:
                '维里压力：动能 2KE 与对力维里 W=Σ r·F 合成。算例 KE=150、W=0、V=1000 → P=0.1（与理想气体一致）。',
              bodyEn:
                'Virial pressure from 2KE + pair virial W; sample KE=150,W=0,V=1000 → P=0.1.',
              formula: {
                expr: 'P = (2 * KE + W) / (3 * V)',
                vars: {
                  P: '维里压力（约化）',
                  KE: '总动能',
                  W: '对力维里 Σ r·F',
                  V: '体积',
                },
                sample: { KE: 150, W: 0, V: 1000 },
                expected: (2 * 150 + 0) / (3 * 1000),
                plainZh: '维里压力由 2 倍动能与对力维里除以 3 倍体积得到',
                plainEn:
                  'Virial pressure is twice kinetic energy plus pair virial over three times volume',
              },
            },
            {
              id: 'md-foundation-P-residual',
              layer: 'foundation',
              titleZh: '基础 KPI：压力残差 |P̄ − P★| / |P★|',
              titleEn: 'Foundation KPI: pressure residual |P̄ − P★| / |P★|',
              bodyZh:
                'NPT 平衡诚实：平衡窗平均压力 P̄ 相对目标 P★ 的相对偏差。算例 P̄=1.02、P★=1 → 2%。',
              bodyEn:
                'NPT equilibration honesty: window-mean P̄ vs P★; sample 2%.',
              formula: {
                expr: 'res = abs(P_mean - P_target) / abs(P_target)',
                vars: {
                  res: '压力相对残差 1',
                  P_mean: '平衡窗平均压力',
                  P_target: '目标压力 P★',
                },
                sample: { P_mean: 1.02, P_target: 1 },
                expected: 0.02,
                plainZh: 'NPT 压力残差等于平衡窗平均压力相对目标压力的偏差比',
                plainEn:
                  'NPT pressure residual is the relative deviation of window-mean P from target',
              },
            },
            {
              id: 'md-foundation-langevin-drag',
              layer: 'foundation',
              titleZh: '基础：Langevin 阻力 F_L = −γ m v',
              titleEn: 'Foundation: Langevin drag F_L = −γ m v',
              bodyZh:
                'Langevin / BAOAB 热浴的确定性阻尼项；随机力另加。算例 γ=1、m=1、v=2 → F_L=−2。',
              bodyEn:
                'Deterministic Langevin drag; stochastic force separate; sample −2.',
              formula: {
                expr: 'F_L = -gamma * m * v',
                vars: {
                  F_L: 'Langevin 阻尼力',
                  gamma: '摩擦系数 γ',
                  m: '质量',
                  v: '速度分量',
                },
                sample: { gamma: 1, m: 1, v: 2 },
                expected: -2,
                plainZh: 'Langevin 阻尼力等于负的摩擦系数乘质量乘速度',
                plainEn:
                  'Langevin drag force is minus friction coefficient times mass times velocity',
              },
            },
            {
              id: 'md-foundation-V-barostat',
              layer: 'foundation',
              titleZh: '基础：Berendsen 体积步 V′ ≈ V [1 − κ (Δt/τ_P)(P★ − P)]',
              titleEn: 'Foundation: Berendsen volume step V′ ≈ V [1 − κ (Δt/τ_P)(P★ − P)]',
              bodyZh:
                '弱耦合压控量级：体积向使 P→P★ 的方向缩放。算例 V=1000、κ=1、Δt/τ_P=0.01、P★=1、P=0.9 → V′=999。',
              bodyEn:
                'Weak-coupling barostat scale of volume toward P★; sample V′=999.',
              formula: {
                expr: 'V_new = V * (1 - kappa * (dt / tau_P) * (P_target - P))',
                vars: {
                  V_new: '更新后体积',
                  V: '当前体积',
                  kappa: '等温压缩率量级因子',
                  dt: '时间步',
                  tau_P: '压力耦合时间常数',
                  P_target: '目标压力 P★',
                  P: '瞬时压力',
                },
                sample: {
                  V: 1000,
                  kappa: 1,
                  dt: 0.001,
                  tau_P: 0.1,
                  P_target: 1,
                  P: 0.9,
                },
                expected: 1000 * (1 - 1 * (0.001 / 0.1) * (1 - 0.9)),
                plainZh: 'Berendsen 压控体积步由压缩率、耦合时间与压力偏差合成',
                plainEn:
                  'Berendsen barostat volume step composes compressibility, coupling time, and pressure error',
              },
            },
          ],
        },
        {
          id: 'md-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-md',
          titleEn: 'Engineering: solvers-md',
          bodyZh:
            'JobKind `md-batch` 由 @w-sim/solvers-md 拥有；经 kind-matrix 与 lab-kit 登记（lj-pair / PBC / cell-list / thermostat / triclinic honesty duals S29ac–S29ba + mad↔min/clad S29ca + max↔min/Cosine/Bray–Curtis plated S29cb 等 fixture）。**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Owned by @w-sim/solvers-md; kind-matrix + lab-kit fixtures including triclinic honesty duals S29ac–S29ba; smoke residual expand ≠ eng DoD / Atlas graduation.',
          jobKinds: ['md-batch'],
        },
        {
          id: 'md-compose-note',
          layer: 'compose',
          titleZh: '合成视角：LJ 对势 ∘ 牛顿积分 ∘ NVT/NPT 控制 ≈ MD 方法',
          titleEn: 'Compose: LJ pair ∘ Newton march ∘ NVT/NPT control ≈ MD method',
          bodyZh:
            '科技树语义：更基础的「Lennard-Jones 对势/对力/对势求和/阱底/sr6 实现/零势距」与「牛顿/Verlet 积分 + 动能 + a=F/m + 速度半步」及「NVT/NPT 温压控与平衡诚实」合成应在等价域复现顶层 MD KPI（NVE 能量残差 E=KE+U、Newton III 力平衡、Verlet 步进、温度与 KE–T 残差、r_min/U_min、对势求和、平衡点力残差、力尺度匹配、无序对数、速度缩放/Berendsen λ、T/P 残差、维里压力、体积耦合、Langevin 阻尼、三斜 h 盒 det/半间距/绝对邻格、维里对称、静水压、列表比、skin 重建门、μ 体积缩放、early/trailing dual T/P/V/剪切窗诚实残差）。对应 principle-bridge `eq-md-lj-newton` 与系综控制层；数值 residual tip 桥接 @w-sim/solvers-md triclinic honesty duals（S29ac–S29ba + S29ca mad↔min/Minkowski-4/Canberra/clad floors + S29cb max↔min/Cosine/Bray–Curtis plated honesty landed 等）——**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Composing LJ pair energy/force/well/sr6/zero-cross with Newton/Verlet+KE+a=F/m+velocity half-step and NVT/NPT control should reproduce energy residual, force-closure, Verlet, temperature/KE–T residual, r_min/U_min, pair-sum, equilibrium-force residual, force-scale match, pair-count, velocity/Berendsen scale, T/P residuals, virial pressure, volume coupling, Langevin drag, and triclinic h-box det/half-spacing/abs lattice/virial symmetry/hydrostatic/list-ratio/skin gate/μ volume/dual T·P·V·shear window honesty KPIs; see eq-md-lj-newton plus ensemble control; bridges @w-sim/solvers-md triclinic honesty duals (S29ac–S29ba + S29ca mad↔min/Minkowski-4/Canberra/clad floors + S29cb max↔min/Cosine/Bray–Curtis plated honesty landed) — smoke residual expand ≠ eng DoD / Atlas graduation.',
          children: [
            {
              id: 'md-compose-energy-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：相对能量残差 |E−E0|/|E0|',
              titleEn: 'Compose KPI: relative energy residual |E−E0|/|E0|',
              bodyZh:
                'NVE 金标量级：长时间积分后相对能量漂移应远小于 1。算例 |8.01−8|/8 = 0.00125 表示 0.125% 漂移（教学阈值，非工程阈值）。',
              bodyEn:
                'NVE gold: long-run relative energy drift ≪ 1; sample 0.125% is a teaching threshold only.',
              formula: {
                expr: 'res = abs(E - E0) / abs(E0)',
                vars: {
                  res: '相对能量残差 1',
                  E: '当前总能量',
                  E0: '初始总能量',
                },
                sample: { E: 8.01, E0: 8 },
                expected: Math.abs(8.01 - 8) / Math.abs(8),
                plainZh: '相对能量残差等于当前总能量相对初值的绝对偏差比',
                plainEn: 'Relative energy residual is |E−E0| over |E0|',
              },
            },
            {
              id: 'md-compose-pair-ke',
              layer: 'foundation',
              titleZh: '合成：E = KE + Σ_pairs U',
              titleEn: 'Compose: E = KE + Σ_pairs U',
              bodyZh:
                '把对势求和与动能拼回总能量：E = KE + U_tot。此式连接 principle「LJ 对势」与「Newton/积分」两侧，构成 MD 方法的可观测量合同。',
              bodyEn:
                'Reassembles pair-sum U with KE into conserved E; contracts LJ principle with Newton march.',
              formula: {
                expr: 'E = KE + U_pair',
                vars: {
                  E: '合成总能量',
                  KE: '动能',
                  U_pair: '对势求和',
                },
                sample: { KE: 4, U_pair: -3 },
                expected: 1,
                plainZh: 'MD 合成总能量等于动能加对势求和',
                plainEn: 'Composed MD total energy is kinetic plus pair-potential sum',
              },
            },
            {
              id: 'md-compose-force-closure',
              layer: 'foundation',
              titleZh: '合成 KPI：Newton III 力闭合 F₁₂ + F₂₁ = 0',
              titleEn: 'Compose KPI: Newton III force closure F₁₂ + F₂₁ = 0',
              bodyZh:
                '对势力反对称：粒子对作用力之和应为 0。算例完全闭合时残差为 0，连接 LJ 力与 Newton 原理。',
              bodyEn:
                'Pair forces are antisymmetric; residual 0 when closed; links LJ force to Newton III.',
              formula: {
                expr: 'res = F12 + F21',
                vars: {
                  res: '力闭合残差',
                  F12: '1→2 作用力',
                  F21: '2→1 作用力',
                },
                sample: { F12: 1.5, F21: -1.5 },
                expected: 0,
                plainZh: 'Newton 第三定律力闭合残差在作用反作用抵消时应为零',
                plainEn: 'Newton III force-closure residual is zero when action equals reaction',
              },
            },
            {
              id: 'md-compose-verlet',
              layer: 'foundation',
              titleZh: '合成：Verlet 位置步进 x′ = 2x − x_prev + a dt²',
              titleEn: 'Compose: Verlet step x′ = 2x − x_prev + a dt²',
              bodyZh:
                '把加速度（来自 LJ 力/质量）与两步位置合成下一位置。无速度显式存储的经典中心差分。',
              bodyEn:
                'Composes acceleration from LJ force/mass with two positions into next x; classic central-difference Verlet.',
              formula: {
                expr: 'x_new = 2 * x - x_prev + a * dt * dt',
                vars: {
                  x_new: '新位置',
                  x: '当前位置',
                  x_prev: '上一步位置',
                  a: '加速度',
                  dt: '时间步',
                },
                sample: { x: 0, x_prev: -0.1, a: -1, dt: 0.1 },
                expected: 2 * 0 - -0.1 + -1 * 0.1 * 0.1,
                plainZh: 'Verlet 合成下一步位置由当前/上步位置与加速度时间步给出',
                plainEn: 'Verlet composes next position from current/previous positions and a·dt²',
              },
            },
            {
              id: 'md-compose-temperature',
              layer: 'foundation',
              titleZh: '合成：动能温度 T ∝ KE / N_dof',
              titleEn: 'Compose: kinetic temperature T ∝ KE / N_dof',
              bodyZh:
                '把总动能与自由度合成瞬时温度量级：KE = (N_dof/2) k_B T（约化单位常取 k_B=1）。算例 KE=9、N_dof=6 → T=3。',
              bodyEn:
                'Composes KE and degrees of freedom into instantaneous T; reduced units k_B=1; sample T=3.',
              formula: {
                expr: 'T = 2 * KE / N_dof',
                vars: {
                  T: '动能温度（约化）',
                  KE: '总动能',
                  N_dof: '自由度数目',
                },
                sample: { KE: 9, N_dof: 6 },
                expected: 3,
                plainZh: '动能温度由总动能与自由度数目合成',
                plainEn: 'Kinetic temperature is composed from total kinetic energy and degrees of freedom',
              },
            },
            {
              id: 'md-compose-pair-force-scale',
              layer: 'foundation',
              titleZh: '合成：对力尺度 F ~ 24 ε/σ（r=σ）',
              titleEn: 'Compose: pair force scale F ~ 24 ε/σ at r=σ',
              bodyZh:
                '在 r=σ 处 LJ 径向力幅量级 24ε/σ，用于校验力实现与势参数一致。',
              bodyEn:
                'At r=σ LJ radial force magnitude is 24ε/σ; smoke-checks force vs potential params.',
              formula: {
                expr: 'F_scale = 24 * epsilon / sigma',
                vars: {
                  F_scale: '力尺度',
                  epsilon: '势阱深度 ε',
                  sigma: '特征长度 σ',
                },
                sample: { epsilon: 1, sigma: 1 },
                expected: 24,
                plainZh: 'r=σ 处 LJ 对力尺度等于 24ε/σ',
                plainEn: 'LJ pair force scale at r=σ is 24ε/σ',
              },
            },
            {
              id: 'md-compose-ke-from-mv',
              layer: 'foundation',
              titleZh: '合成：KE = ½ m v² 入能量链',
              titleEn: 'Compose: KE = ½ m v² into energy chain',
              bodyZh:
                '把质量与速率合成平动动能，再与对势 U 拼回守恒 E。算例 m=2、v=3 → KE=9，与 foundation-ke / etot 合同。',
              bodyEn:
                'Composes mass and speed into KE upstream of conserved E; sample m=2,v=3 → KE=9.',
              formula: {
                expr: 'KE = 0.5 * m * v * v',
                vars: {
                  KE: '动能 energy',
                  m: '质量',
                  v: '速率',
                },
                sample: { m: 2, v: 3 },
                expected: 9,
                plainZh: '动能由质量与速率合成，作为总能量链的动能侧输入',
                plainEn:
                  'Kinetic energy composes from mass and speed as the KE side of the total-energy chain',
              },
            },
            {
              id: 'md-compose-accel',
              layer: 'foundation',
              titleZh: '合成：a = F / m（Newton II）',
              titleEn: 'Compose: a = F / m (Newton II)',
              bodyZh:
                '把 LJ 对力与粒子质量合成加速度，供 Verlet / velocity-Verlet 位置更新。算例 F=24（r=σ 力尺度）、m=2 → a=12。',
              bodyEn:
                'Composes LJ force and mass into acceleration for Verlet; sample F=24, m=2 → a=12.',
              formula: {
                expr: 'a = F / m',
                vars: {
                  a: '加速度',
                  F: '净力',
                  m: '质量',
                },
                sample: { F: 24, m: 2 },
                expected: 12,
                plainZh: '加速度等于净力除以质量，连接 LJ 力与 Verlet 积分',
                plainEn:
                  'Acceleration is net force over mass, linking LJ force to Verlet integration',
              },
            },
            {
              id: 'md-compose-rmin',
              layer: 'foundation',
              titleZh: '合成：r_min = 2^{1/6} σ 入力零点链',
              titleEn: 'Compose: r_min = 2^{1/6} σ into force-zero chain',
              bodyZh:
                '材料长度尺度 σ 先合成势阱最小间距 r_min，再进入 F(r_min)=0 与 U=−ε 合同。约化 σ=1 → r_min=2^{1/6}。',
              bodyEn:
                'Composes σ into well minimum r_min upstream of F=0 and U=−ε; reduced σ=1 → 2^{1/6}.',
              formula: {
                expr: 'r_min = 2^(1/6) * sigma',
                vars: {
                  r_min: '势阱最小间距',
                  sigma: '特征长度 σ',
                },
                sample: { sigma: 1 },
                expected: Math.pow(2, 1 / 6),
                plainZh: '势阱最小间距由特征长度 σ 合成，作为力零点与阱深合同的上游',
                plainEn:
                  'Well minimum distance composes from σ as upstream of force-zero and well-depth contracts',
              },
            },
            {
              id: 'md-compose-well',
              layer: 'foundation',
              titleZh: '合成：U_min = −ε 阱深合同',
              titleEn: 'Compose: U_min = −ε well-depth contract',
              bodyZh:
                '把阱深参数 ε 合成阱底对势能；与 r_min 处 U(r) 金标对拍。算例 ε=1 → U_min=−1。',
              bodyEn:
                'Composes well-depth ε into bottom pair energy; gold-checks U(r_min); sample −1.',
              formula: {
                expr: 'U_min = -epsilon',
                vars: {
                  U_min: '阱底对势能',
                  epsilon: '阱深 ε',
                },
                sample: { epsilon: 1 },
                expected: -1,
                plainZh: '阱底对势能由阱深 ε 合成，等于 −ε',
                plainEn: 'Well-bottom pair energy composes from well depth as −ε',
              },
            },
            {
              id: 'md-compose-pair-sum',
              layer: 'foundation',
              titleZh: '合成：U_tot = Σ_pairs U 入总能',
              titleEn: 'Compose: U_tot = Σ_pairs U into total energy',
              bodyZh:
                '无序粒子对势能求和作为 U 侧输入，再与 KE 合成 E。三粒子全连接阱底算例 U12=U13=U23=−ε → U_tot=−3。',
              bodyEn:
                'Unordered pair-sum U feeds total E with KE; three well-bottom pairs → U_tot=−3ε.',
              formula: {
                expr: 'U_tot = U12 + U13 + U23',
                vars: {
                  U_tot: '系统对势总能',
                  U12: '对 1–2 势能',
                  U13: '对 1–3 势能',
                  U23: '对 2–3 势能',
                },
                sample: { U12: -1, U13: -1, U23: -1 },
                expected: -3,
                plainZh: '系统对势总能由各粒子对势能合成，再进入动能–势能守恒链',
                plainEn:
                  'Total pair energy composes from pair terms before the KE–PE conservation chain',
              },
            },
            {
              id: 'md-compose-force-eq-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：r_min 力残差 |F_eq| = 0',
              titleEn: 'Compose KPI: |F_eq| = 0 at r_min',
              bodyZh:
                '在 r_min 处径向力应精确为零。算例把 F_eq 直接作为残差，闭合时应为 0，连接 LJ 力与势阱几何。',
              bodyEn:
                'Radial force at r_min must vanish; sample residual is 0; links LJ force to well geometry.',
              formula: {
                expr: 'res = abs(F_eq)',
                vars: {
                  res: '平衡点力残差',
                  F_eq: 'r_min 处径向力',
                },
                sample: { F_eq: 0 },
                expected: 0,
                plainZh: '势阱最小间距处径向力残差应为零',
                plainEn: 'Radial-force residual at the well minimum should be zero',
              },
            },
            {
              id: 'md-compose-etot',
              layer: 'foundation',
              titleZh: '合成：E = KE + U_tot 守恒合同',
              titleEn: 'Compose: E = KE + U_tot conservation contract',
              bodyZh:
                '把动能侧与对势侧合成总机械能；NVE smoke 以 |E−E0|/|E0| 报残差。算例 KE=9、U_tot=−1 → E=8。',
              bodyEn:
                'Composes KE and pair U into total E; NVE smoke reports relative drift; sample E=8.',
              formula: {
                expr: 'E = KE + U_tot',
                vars: {
                  E: '总机械能',
                  KE: '动能',
                  U_tot: '对势总能',
                },
                sample: { KE: 9, U_tot: -1 },
                expected: 8,
                plainZh: '总机械能由动能与对势总能合成，构成 NVE 守恒合同',
                plainEn:
                  'Total mechanical energy composes from KE and pair U as the NVE conservation contract',
              },
            },
            {
              id: 'md-compose-sr6-u',
              layer: 'foundation',
              titleZh: '合成：U = 4ε (sr6² − sr6) 实现链',
              titleEn: 'Compose: U = 4ε (sr6² − sr6) implementation chain',
              bodyZh:
                '把中间量 sr6=(σ/r)⁶ 与阱深合成对势能：U=4ε(sr6²−sr6)。算例 sr6=1（r=σ）→ U=0，对接零势距与 foundation-sr6。',
              bodyEn:
                'Composes intermediate sr6=(σ/r)⁶ with ε into U=4ε(sr6²−sr6); sample sr6=1 → U=0 at zero-crossing.',
              formula: {
                expr: 'U = 4 * epsilon * (sr6 * sr6 - sr6)',
                vars: {
                  U: '对势能 energy',
                  epsilon: '阱深 ε',
                  sr6: '(σ/r)⁶ 中间量',
                },
                sample: { epsilon: 1, sr6: 1 },
                expected: 0,
                plainZh: 'LJ 对势能由 (σ/r)⁶ 中间量与阱深合成，便于实现与零势距自检',
                plainEn:
                  'LJ pair energy composes from the (σ/r)⁶ intermediate and well depth for implementation and zero-crossing checks',
              },
            },
            {
              id: 'md-compose-u-zero-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：零势距残差 |U(r=σ)| = 0',
              titleEn: 'Compose KPI: zero-crossing residual |U(r=σ)| = 0',
              bodyZh:
                '在 r=σ 处对势能应精确为零（零势距定义）。算例把 U_sigma 作为残差输入，闭合时为 0，连接 sr6 实现与势参数。',
              bodyEn:
                'Pair energy at r=σ must vanish (zero-crossing); sample residual 0; links sr6 implementation to potential params.',
              formula: {
                expr: 'res = abs(U_sigma)',
                vars: {
                  res: '零势距能量残差',
                  U_sigma: 'r=σ 处对势能',
                },
                sample: { U_sigma: 0 },
                expected: 0,
                plainZh: '特征长度 r=σ 处对势能残差应为零（零势距）',
                plainEn:
                  'Pair-energy residual at the characteristic length r=σ should be zero (zero-crossing)',
              },
            },
            {
              id: 'md-compose-v-half',
              layer: 'foundation',
              titleZh: '合成：速度半步 v′ = v + a Δt',
              titleEn: 'Compose: velocity half-step v′ = v + a Δt',
              bodyZh:
                '把加速度（来自 a=F/m）与时间步合成 velocity-Verlet 速度更新半步。算例 v=1、a=−2、dt=0.1 → v′=0.8，对接位置 Verlet 与动能链。',
              bodyEn:
                'Composes acceleration and dt into velocity-Verlet half-step; sample v=1,a=−2,dt=0.1 → 0.8; links position Verlet and KE.',
              formula: {
                expr: 'v_new = v + a * dt',
                vars: {
                  v_new: '更新后速度',
                  v: '当前速度',
                  a: '加速度',
                  dt: '时间步',
                },
                sample: { v: 1, a: -2, dt: 0.1 },
                expected: 0.8,
                plainZh: '速度半步由当前速度加加速度乘时间步合成，对接 Verlet 与动能',
                plainEn:
                  'Velocity half-step composes as current velocity plus acceleration times dt, linking Verlet and kinetic energy',
              },
            },
            {
              id: 'md-compose-ke-T-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：KE–温度残差 |2 KE / N_dof − T|',
              titleEn: 'Compose KPI: KE–temperature residual |2 KE / N_dof − T|',
              bodyZh:
                '约化 k_B=1 下瞬时温度合同 T=2 KE/N_dof。算例 KE=9、N_dof=6、T=3 → 残差 0，闭合 temperature 合成。',
              bodyEn:
                'With k_B=1, T=2 KE/N_dof; sample KE=9,N_dof=6,T=3 → residual 0; closes temperature composition.',
              formula: {
                expr: 'res = abs(2 * KE / N_dof - T)',
                vars: {
                  res: '动能–温度匹配残差',
                  KE: '总动能',
                  N_dof: '自由度数目',
                  T: '动能温度（约化）',
                },
                sample: { KE: 9, N_dof: 6, T: 3 },
                expected: 0,
                plainZh: '动能温度与 2·KE/N_dof 合同残差在匹配时应为零',
                plainEn:
                  'Kinetic-temperature residual against 2·KE/N_dof should be zero when matched',
              },
            },
            {
              id: 'md-compose-F-scale-match',
              layer: 'foundation',
              titleZh: '合成 KPI：力尺度匹配 |F − 24ε/σ| / (24ε/σ)',
              titleEn: 'Compose KPI: force-scale match |F − 24ε/σ| / (24ε/σ)',
              bodyZh:
                '在 r=σ 处实现力应等于 24ε/σ 量级合同。算例 F=24、ε=σ=1 → 相对残差 0，连接 pair-force-scale 与 foundation 力式。',
              bodyEn:
                'Implemented force at r=σ must match 24ε/σ; sample matched residual 0; links force-scale compose to foundation force.',
              formula: {
                expr: 'res = abs(F - 24 * epsilon / sigma) / abs(24 * epsilon / sigma)',
                vars: {
                  res: '力尺度相对残差 1',
                  F: '实现径向力幅度',
                  epsilon: '阱深 ε',
                  sigma: '特征长度 σ',
                },
                sample: { F: 24, epsilon: 1, sigma: 1 },
                expected: 0,
                plainZh: 'r=σ 处径向力相对 24ε/σ 的匹配残差在一致时应为零',
                plainEn:
                  'Relative residual of radial force against 24ε/σ at r=σ should be zero when consistent',
              },
            },
            {
              id: 'md-compose-n-pairs',
              layer: 'foundation',
              titleZh: '合成：无序对数 N_pairs = N(N−1)/2',
              titleEn: 'Compose: unordered pair count N_pairs = N(N−1)/2',
              bodyZh:
                '把粒子数合成无序对势求和项数，作为 U_tot=Σ U_ij 的组合上游。算例 N=3 → N_pairs=3（与三粒子 U12+U13+U23 对齐）。',
              bodyEn:
                'Composes particle count into unordered pair count upstream of U_tot; sample N=3 → 3 pairs.',
              formula: {
                expr: 'N_pairs = N * (N - 1) / 2',
                vars: {
                  N_pairs: '无序粒子对数',
                  N: '粒子数',
                },
                sample: { N: 3 },
                expected: 3,
                plainZh: '无序粒子对数由粒子数按组合数 N(N−1)/2 合成，作为对势求和上游',
                plainEn:
                  'Unordered pair count composes as N(N−1)/2 upstream of the pair-potential sum',
              },
            },
            {
              id: 'md-compose-Ndof',
              layer: 'foundation',
              titleZh: '合成：N_dof = 3N − 3 入温度链',
              titleEn: 'Compose: N_dof = 3N − 3 into temperature chain',
              bodyZh:
                '粒子数先合成去质心自由度，再进入 T=2 KE/N_dof 与 NVT 残差。算例 N=100 → N_dof=297。',
              bodyEn:
                'Composes N into COM-removed dof upstream of T and NVT residual; sample N=100 → 297.',
              formula: {
                expr: 'N_dof = 3 * N - 3',
                vars: {
                  N_dof: '平动自由度',
                  N: '粒子数',
                },
                sample: { N: 100 },
                expected: 297,
                plainZh: '自由度由粒子数按 3N−3 合成，作为动能温度与 NVT 诚实合同上游',
                plainEn:
                  'Degrees of freedom compose as 3N−3 from particle count upstream of kinetic T and NVT honesty',
              },
            },
            {
              id: 'md-compose-T-from-ke',
              layer: 'foundation',
              titleZh: '合成：T = 2 KE / N_dof 入热浴',
              titleEn: 'Compose: T = 2 KE / N_dof into thermostat',
              bodyZh:
                '把总动能与自由度合成瞬时温度，供速度缩放 / Berendsen / Langevin 比较 T★。算例 KE=150、N_dof=297 → T≈1.0101。',
              bodyEn:
                'Composes KE and N_dof into instantaneous T for thermostat vs T★; sample ≈1.0101.',
              formula: {
                expr: 'T = 2 * KE / N_dof',
                vars: {
                  T: '瞬时动能温度（约化）',
                  KE: '总动能',
                  N_dof: '自由度数目',
                },
                sample: { KE: 150, N_dof: 297 },
                expected: (2 * 150) / 297,
                plainZh: '瞬时温度由动能与自由度合成，进入 NVT 温控链',
                plainEn:
                  'Instantaneous temperature composes from KE and dof into the NVT thermostat chain',
              },
            },
            {
              id: 'md-compose-velocity-scale',
              layer: 'foundation',
              titleZh: '合成：λ = √(T★ / T) 速度缩放',
              titleEn: 'Compose: λ = √(T★ / T) velocity scale',
              bodyZh:
                '把目标温度与瞬时温度合成理想速度缩放因子，使一步重标后 T→T★。算例 T★=1、T=0.81 → λ=√(1/0.81)。',
              bodyEn:
                'Composes T★ and T into ideal velocity scale; sample √(1/0.81).',
              formula: {
                expr: 'lambda = sqrt(T_target / T)',
                vars: {
                  lambda: '速度缩放因子',
                  T_target: '目标温度 T★',
                  T: '瞬时动能温度',
                },
                sample: { T_target: 1, T: 0.81 },
                expected: Math.sqrt(1 / 0.81),
                plainZh: '速度缩放因子由目标温度与瞬时温度比的平方根合成',
                plainEn:
                  'Velocity scale factor composes as the square root of target over instantaneous temperature',
              },
            },
            {
              id: 'md-compose-v-rescale',
              layer: 'foundation',
              titleZh: '合成：v′ = λ v 施加速度缩放',
              titleEn: 'Compose: v′ = λ v apply velocity scale',
              bodyZh:
                '把缩放因子与当前速度合成热浴更新速度。算例 λ=√(1/0.81)、v=1 → v′=√(1/0.81)。',
              bodyEn:
                'Applies scale factor to velocity; sample λ=√(1/0.81), v=1.',
              formula: {
                expr: 'v_new = lambda * v',
                vars: {
                  v_new: '缩放后速度',
                  lambda: '速度缩放因子',
                  v: '当前速度',
                },
                sample: { lambda: Math.sqrt(1 / 0.81), v: 1 },
                expected: Math.sqrt(1 / 0.81),
                plainZh: '热浴速度更新等于缩放因子乘当前速度',
                plainEn:
                  'Thermostatted velocity update is the scale factor times current velocity',
              },
            },
            {
              id: 'md-compose-ke-after-scale',
              layer: 'foundation',
              titleZh: '合成：KE′ = λ² KE 缩放后动能',
              titleEn: 'Compose: KE′ = λ² KE after scale',
              bodyZh:
                '速度统一乘 λ 后动能乘 λ²，连接温度重标与 KE–T 合同。算例 λ²=1/0.81、KE=0.81 → KE′=1。',
              bodyEn:
                'Uniform velocity scale multiplies KE by λ²; sample λ²·0.81 → 1.',
              formula: {
                expr: 'KE_new = lambda * lambda * KE',
                vars: {
                  KE_new: '缩放后动能',
                  lambda: '速度缩放因子',
                  KE: '缩放前动能',
                },
                sample: { lambda: Math.sqrt(1 / 0.81), KE: 0.81 },
                expected: 1,
                plainZh: '速度缩放后动能等于 λ 平方乘原动能，对接温度重标',
                plainEn:
                  'Post-scale kinetic energy is λ squared times prior KE, linking temperature rescaling',
              },
            },
            {
              id: 'md-compose-berendsen-lambda',
              layer: 'foundation',
              titleZh: '合成：Berendsen λ 弱耦合温控',
              titleEn: 'Compose: Berendsen λ weak-coupling thermostat',
              bodyZh:
                '把 Δt、τ_T 与 T★/T 合成软缩放因子，避免一步过冲。算例 Δt=0.001、τ_T=0.1、T★=1、T=0.81。',
              bodyEn:
                'Composes dt, τ_T, and T★/T into soft scale; sample as foundation Berendsen.',
              formula: {
                expr: 'lambda = sqrt(1 + (dt / tau_T) * (T_target / T - 1))',
                vars: {
                  lambda: 'Berendsen 速度缩放因子',
                  dt: '时间步',
                  tau_T: '温度耦合时间常数',
                  T_target: '目标温度 T★',
                  T: '瞬时温度',
                },
                sample: { dt: 0.001, tau_T: 0.1, T_target: 1, T: 0.81 },
                expected: Math.sqrt(1 + (0.001 / 0.1) * (1 / 0.81 - 1)),
                plainZh: 'Berendsen 缩放因子由时间步、耦合时间与温度偏差合成',
                plainEn:
                  'Berendsen scale composes from time step, coupling time, and temperature error',
              },
            },
            {
              id: 'md-compose-T-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：NVT 温度残差 |T̄ − T★| / T★',
              titleEn: 'Compose KPI: NVT temperature residual |T̄ − T★| / T★',
              bodyZh:
                '平衡窗平均温度相对目标的相对偏差是 NVT 诚实主 KPI（非 NVE 能量漂移）。算例 T̄=1.01、T★=1 → 0.01。',
              bodyEn:
                'Window-mean T vs T★ relative residual is NVT honesty gold; sample 0.01.',
              formula: {
                expr: 'res = abs(T_mean - T_target) / abs(T_target)',
                vars: {
                  res: '温度相对残差 1',
                  T_mean: '平衡窗平均温度',
                  T_target: '目标温度 T★',
                },
                sample: { T_mean: 1.01, T_target: 1 },
                expected: 0.01,
                plainZh: 'NVT 平衡诚实温度残差由窗平均温度与目标温度合成',
                plainEn:
                  'NVT equilibration-honesty temperature residual composes window-mean T against target',
              },
            },
            {
              id: 'md-compose-T-window-mean',
              layer: 'foundation',
              titleZh: '合成：平衡窗 T̄ = (T1+T2+T3)/3',
              titleEn: 'Compose: equilibration window T̄ = (T1+T2+T3)/3',
              bodyZh:
                '把若干瞬时温度样本合成窗平均，再进入 T 残差 KPI。算例 0.99、1.01、1.03 → T̄=1.01。',
              bodyEn:
                'Composes instantaneous T samples into window mean upstream of residual; sample 1.01.',
              formula: {
                expr: 'T_mean = (T1 + T2 + T3) / 3',
                vars: {
                  T_mean: '平衡窗平均温度',
                  T1: '样本温度 1',
                  T2: '样本温度 2',
                  T3: '样本温度 3',
                },
                sample: { T1: 0.99, T2: 1.01, T3: 1.03 },
                expected: 1.01,
                plainZh: '平衡窗平均温度由若干瞬时温度样本算术平均合成',
                plainEn:
                  'Equilibration window-mean temperature composes as the arithmetic mean of instantaneous samples',
              },
            },
            {
              id: 'md-compose-langevin-drag',
              layer: 'foundation',
              titleZh: '合成：Langevin 阻尼 F_L = −γ m v',
              titleEn: 'Compose: Langevin drag F_L = −γ m v',
              bodyZh:
                '把摩擦系数、质量与速度合成阻尼力，与 LJ 力叠加后再 a=F/m。算例 γ=1、m=1、v=2 → F_L=−2。',
              bodyEn:
                'Composes γ, m, v into drag force added to LJ before a=F/m; sample −2.',
              formula: {
                expr: 'F_L = -gamma * m * v',
                vars: {
                  F_L: 'Langevin 阻尼力',
                  gamma: '摩擦系数 γ',
                  m: '质量',
                  v: '速度分量',
                },
                sample: { gamma: 1, m: 1, v: 2 },
                expected: -2,
                plainZh: 'Langevin 阻尼力由摩擦系数、质量与速度合成，叠加到 LJ 力',
                plainEn:
                  'Langevin drag composes from friction, mass, and velocity and stacks on LJ force',
              },
            },
            {
              id: 'md-compose-P-ideal',
              layer: 'foundation',
              titleZh: '合成：P_kin = N T / V 入压控',
              titleEn: 'Compose: P_kin = N T / V into barostat',
              bodyZh:
                '约化理想气体动能压力由 N、T、V 合成，作为 NPT 压力观测的动能侧。算例 N=100、T=1、V=1000 → 0.1。',
              bodyEn:
                'Composes N, T, V into kinetic pressure for NPT; sample 0.1.',
              formula: {
                expr: 'P_kin = N * T / V',
                vars: {
                  P_kin: '动能压力（约化）',
                  N: '粒子数',
                  T: '温度',
                  V: '体积',
                },
                sample: { N: 100, T: 1, V: 1000 },
                expected: 0.1,
                plainZh: '动能压力由粒子数、温度与体积合成，进入 NPT 压力观测',
                plainEn:
                  'Kinetic pressure composes from N, T, and V into the NPT pressure observable',
              },
            },
            {
              id: 'md-compose-P-virial',
              layer: 'foundation',
              titleZh: '合成：P = (2 KE + W) / (3 V) 维里压力',
              titleEn: 'Compose: P = (2 KE + W) / (3 V) virial pressure',
              bodyZh:
                '把动能与对力维里、体积合成瞬时压力，供 P 残差与 barostat。算例 KE=150、W=0、V=1000 → P=0.1。',
              bodyEn:
                'Composes KE, pair virial, and V into instantaneous P; sample 0.1.',
              formula: {
                expr: 'P = (2 * KE + W) / (3 * V)',
                vars: {
                  P: '维里压力（约化）',
                  KE: '总动能',
                  W: '对力维里 Σ r·F',
                  V: '体积',
                },
                sample: { KE: 150, W: 0, V: 1000 },
                expected: (2 * 150 + 0) / (3 * 1000),
                plainZh: '维里压力由动能、对力维里与体积合成，作为 NPT 诚实观测',
                plainEn:
                  'Virial pressure composes from KE, pair virial, and volume as the NPT honesty observable',
              },
            },
            {
              id: 'md-compose-P-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：NPT 压力残差 |P̄ − P★| / |P★|',
              titleEn: 'Compose KPI: NPT pressure residual |P̄ − P★| / |P★|',
              bodyZh:
                '平衡窗平均压力相对目标的相对偏差是 NPT 诚实主 KPI。算例 P̄=1.02、P★=1 → 0.02。',
              bodyEn:
                'Window-mean P vs P★ relative residual is NPT honesty gold; sample 0.02.',
              formula: {
                expr: 'res = abs(P_mean - P_target) / abs(P_target)',
                vars: {
                  res: '压力相对残差 1',
                  P_mean: '平衡窗平均压力',
                  P_target: '目标压力 P★',
                },
                sample: { P_mean: 1.02, P_target: 1 },
                expected: 0.02,
                plainZh: 'NPT 平衡诚实压力残差由窗平均压力与目标压力合成',
                plainEn:
                  'NPT equilibration-honesty pressure residual composes window-mean P against target',
              },
            },
            {
              id: 'md-compose-V-barostat',
              layer: 'foundation',
              titleZh: '合成：Berendsen 体积步 V′ 入 NPT',
              titleEn: 'Compose: Berendsen volume step V′ into NPT',
              bodyZh:
                '把体积、压缩率、耦合时间与压力偏差合成下一步体积。算例 V=1000、κ=1、Δt/τ_P=0.01、P★−P=0.1 → V′=999。',
              bodyEn:
                'Composes V, κ, τ_P, and pressure error into next volume; sample V′=999.',
              formula: {
                expr: 'V_new = V * (1 - kappa * (dt / tau_P) * (P_target - P))',
                vars: {
                  V_new: '更新后体积',
                  V: '当前体积',
                  kappa: '等温压缩率量级因子',
                  dt: '时间步',
                  tau_P: '压力耦合时间常数',
                  P_target: '目标压力 P★',
                  P: '瞬时压力',
                },
                sample: {
                  V: 1000,
                  kappa: 1,
                  dt: 0.001,
                  tau_P: 0.1,
                  P_target: 1,
                  P: 0.9,
                },
                expected: 1000 * (1 - 1 * (0.001 / 0.1) * (1 - 0.9)),
                plainZh: 'NPT 体积更新由压缩率、耦合时间与压力偏差合成',
                plainEn:
                  'NPT volume update composes compressibility, coupling time, and pressure error',
              },
            },
            {
              id: 'md-compose-rho',
              layer: 'foundation',
              titleZh: '合成：数密度 ρ = N / V',
              titleEn: 'Compose: number density ρ = N / V',
              bodyZh:
                '把粒子数与体积合成数密度，对接 P_kin=ρ T 与 NPT 密度报告。算例 N=100、V=1000 → ρ=0.1。',
              bodyEn:
                'Composes N and V into number density; sample 0.1; links P_kin=ρ T.',
              formula: {
                expr: 'rho = N / V',
                vars: {
                  rho: '数密度',
                  N: '粒子数',
                  V: '体积',
                },
                sample: { N: 100, V: 1000 },
                expected: 0.1,
                plainZh: '数密度由粒子数除以体积合成，对接动能压力与 NPT 密度',
                plainEn:
                  'Number density composes as N over V upstream of kinetic pressure and NPT density reports',
              },
            },
            {
              id: 'md-compose-L-box',
              layer: 'foundation',
              titleZh: '合成：立方盒边 L = V^{1/3}',
              titleEn: 'Compose: cubic box edge L = V^{1/3}',
              bodyZh:
                '各向同性 barostat 后体积合成边长，供 PBC 与最小镜像。算例 V=1000 → L=10。',
              bodyEn:
                'Composes volume into cubic edge after isotropic barostat; sample L=10.',
              formula: {
                expr: 'L = V ** (1 / 3)',
                vars: {
                  L: '立方盒边长',
                  V: '体积',
                },
                sample: { V: 1000 },
                expected: 10,
                plainZh: '立方周期盒边长由体积的立方根合成',
                plainEn:
                  'Cubic periodic box edge composes as the cube root of volume',
              },
            },
            {
              id: 'md-compose-P-rho-T',
              layer: 'foundation',
              titleZh: '合成：P_kin = ρ T 理想气体链闭合',
              titleEn: 'Compose: P_kin = ρ T ideal-gas chain closure',
              bodyZh:
                '数密度与温度合成动能压力，应与 N T / V 一致。算例 ρ=0.1、T=1 → P_kin=0.1。',
              bodyEn:
                'Composes density and T into kinetic pressure matching N T/V; sample 0.1.',
              formula: {
                expr: 'P_kin = rho * T',
                vars: {
                  P_kin: '动能压力（约化）',
                  rho: '数密度',
                  T: '温度',
                },
                sample: { rho: 0.1, T: 1 },
                expected: 0.1,
                plainZh: '动能压力亦可由数密度乘温度合成，与 N T/V 链闭合',
                plainEn:
                  'Kinetic pressure also composes as density times temperature, closing the N T/V chain',
              },
            },
            {
              id: 'md-compose-T-match-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：缩放后温度匹配 |T′ − T★|',
              titleEn: 'Compose KPI: post-scale temperature match |T′ − T★|',
              bodyZh:
                '理想速度重标后瞬时温度应等于目标。算例 T′=1、T★=1 → 残差 0，闭合 λ 与 KE′ 链。',
              bodyEn:
                'After ideal rescale T′ must equal T★; sample residual 0; closes λ and KE′ chain.',
              formula: {
                expr: 'res = abs(T_new - T_target)',
                vars: {
                  res: '缩放后温度匹配残差',
                  T_new: '缩放后瞬时温度',
                  T_target: '目标温度 T★',
                },
                sample: { T_new: 1, T_target: 1 },
                expected: 0,
                plainZh: '理想速度缩放后温度与目标匹配残差应为零',
                plainEn:
                  'Post-ideal-rescale temperature match residual against target should be zero',
              },
            },
            {
              id: 'md-compose-detH',
              layer: 'foundation',
              titleZh: '合成：三斜盒体积 V = det(h)（正交）',
              titleEn: 'Compose: triclinic box volume V = det(h) (orthogonal)',
              bodyZh:
                'h 列向量为晶格基矢；正交对角 h=diag(Lx,Ly,Lz) 时 det(h)=Lx Ly Lz。算例立方 L=10 → V=1000，与 md-compose-L-box 对偶，桥接 S29ac triclinic 体积合同。',
              bodyEn:
                'h columns are lattice vectors; orthogonal det=Lx Ly Lz; sample cubic L=10 → V=1000; dual of L-box; bridges S29ac volume contract.',
              formula: {
                expr: 'V = Lx * Ly * Lz',
                vars: {
                  V: '盒体积（约化）',
                  Lx: 'a 向边长',
                  Ly: 'b 向边长',
                  Lz: 'c 向边长',
                },
                sample: { Lx: 10, Ly: 10, Lz: 10 },
                expected: 1000,
                plainZh: '正交三斜盒体积由三边长乘积合成，等于 det(h)',
                plainEn:
                  'Orthogonal triclinic box volume composes as the product of edge lengths, equal to det(h)',
              },
            },
            {
              id: 'md-compose-half-spacing',
              layer: 'foundation',
              titleZh: '合成：立方半最小面间距 L/2',
              titleEn: 'Compose: cubic min half interplanar spacing L/2',
              bodyZh:
                '分数最小镜像安全截断上界：r_cut、r_list ≤ 半最小面间距。立方 h=diag(L,L,L) 时半间距=L/2。算例 L=10 → 5；桥接 triclinicMinHalfSpacing / S29ac 截断诚实。',
              bodyEn:
                'Safe fractional min-image cutoff bound is half min interplanar spacing; cubic → L/2; sample 5; bridges triclinicMinHalfSpacing / S29ac cutoff honesty.',
              formula: {
                expr: 'half = L / 2',
                vars: {
                  half: '半最小面间距',
                  L: '立方盒边长',
                },
                sample: { L: 10 },
                expected: 5,
                plainZh: '立方三斜盒半最小面间距合成为边长的一半，作为截断诚实上界',
                plainEn:
                  'Cubic triclinic min half-spacing composes as half the edge length for cutoff honesty',
              },
            },
            {
              id: 'md-compose-rCut-safe-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：截断安全残差 max(0, r_cut − half)',
              titleEn: 'Compose KPI: cutoff safety residual max(0, r_cut − half)',
              bodyZh:
                '分数最小镜像下 r_cut 不得超过半面间距；违规时残差为正。算例 r_cut=2.5、half=5 → 残差 0；桥接 S29ac 截断诚实门。',
              bodyEn:
                'Fractional min-image needs r_cut ≤ half-spacing; residual 0 when safe; sample r_cut=2.5, half=5; bridges S29ac cutoff honesty gate.',
              formula: {
                expr: 'res = max(0, r_cut - half)',
                vars: {
                  res: '截断越界残差',
                  r_cut: '对势截断半径',
                  half: '半最小面间距',
                },
                sample: { r_cut: 2.5, half: 5 },
                expected: 0,
                plainZh: '截断半径不超过半面间距时安全残差为零',
                plainEn:
                  'Cutoff safety residual is zero when r_cut does not exceed half interplanar spacing',
              },
            },
            {
              id: 'md-compose-abs-lattice-count',
              layer: 'foundation',
              titleZh: '合成：绝对邻格像数 (2·range+1)³',
              titleEn: 'Compose: absolute neighbour-lattice image count (2·range+1)³',
              bodyZh:
                '强剪切下绝对最小镜像在 n∈[−range,range]³ 邻格搜索。算例 range=1 → 27 像；桥接 S29af triclinicAbsoluteLatticeImageCount。',
              bodyEn:
                'Absolute min-image searches n∈[−range,range]³; sample range=1 → 27 images; bridges S29af lattice image count.',
              formula: {
                expr: 'n_img = (2 * range + 1) ** 3',
                vars: {
                  n_img: '邻格像总数',
                  range: '每轴搜索半径（整数）',
                },
                sample: { range: 1 },
                expected: 27,
                plainZh: '绝对最小镜像邻格像数合成为每轴二倍搜索半径加一的立方',
                plainEn:
                  'Absolute min-image lattice image count composes as the cube of twice range plus one',
              },
            },
            {
              id: 'md-compose-p-hydro',
              layer: 'foundation',
              titleZh: '合成：静水压 p = Tr(W) / (3 V)',
              titleEn: 'Compose: hydrostatic pressure p = Tr(W) / (3 V)',
              bodyZh:
                '三斜应力桩：静水压由维里张量迹与体积合成 p=Tr(W)/(3V)。算例 Wxx=Wyy=Wzz=100、V=1000 → p=0.1；桥接 triclinicPressureShearKpi / S29ah。',
              bodyEn:
                'Triclinic hydrostatic p from virial-trace over 3V; sample diagonals 100, V=1000 → p=0.1; bridges S29ah pressure–shear KPI.',
              formula: {
                expr: 'p = (Wxx + Wyy + Wzz) / (3 * V)',
                vars: {
                  p: '静水压（约化）',
                  Wxx: '维里张量 xx',
                  Wyy: '维里张量 yy',
                  Wzz: '维里张量 zz',
                  V: '盒体积',
                },
                sample: { Wxx: 100, Wyy: 100, Wzz: 100, V: 1000 },
                expected: 0.1,
                plainZh: '三斜静水压由维里张量迹除以三倍体积合成',
                plainEn:
                  'Triclinic hydrostatic pressure composes as the virial-tensor trace over three times volume',
              },
            },
            {
              id: 'md-compose-virial-sym-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：维里对称残差 |W_xy − W_yx|',
              titleEn: 'Compose KPI: virial symmetry residual |W_xy − W_yx|',
              bodyZh:
                '中心力对势维里张量应对称；反对称分量残差在匹配时为 0。算例 Wxy=Wyx=0.5 → 残差 0；桥接 triclinicVirialSymmetryResidual / S29ai 诚实 dual。',
              bodyEn:
                'Central-pair virial must be symmetric; residual 0 when matched; sample 0.5=0.5; bridges S29ai virial symmetry honesty dual.',
              formula: {
                expr: 'res = abs(Wxy - Wyx)',
                vars: {
                  res: '维里反对称残差',
                  Wxy: '维里张量 xy',
                  Wyx: '维里张量 yx',
                },
                sample: { Wxy: 0.5, Wyx: 0.5 },
                expected: 0,
                plainZh: '维里张量对称合同时反对称残差应为零',
                plainEn:
                  'Virial-tensor antisymmetry residual should be zero when the symmetry contract holds',
              },
            },
            {
              id: 'md-compose-cubic-match-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：立方–三斜最小镜像匹配 |d_tri − d_cub|',
              titleEn: 'Compose KPI: cubic–triclinic min-image match |d_tri − d_cub|',
              bodyZh:
                'h=diag(L,L,L) 时分数三斜最小镜像应恢复立方 minImageDelta。算例两者距离同为 1 → 残差 0；桥接 triclinicMatchesCubicMinImage / S29ac 诚实 dual。',
              bodyEn:
                'Cubic h recovers cubic min-image; sample matched distances → residual 0; bridges S29ac cubic–triclinic honesty dual.',
              formula: {
                expr: 'res = abs(d_tri - d_cub)',
                vars: {
                  res: '最小镜像距离匹配残差',
                  d_tri: '三斜分数最小镜像距离',
                  d_cub: '立方最小镜像距离',
                },
                sample: { d_tri: 1, d_cub: 1 },
                expected: 0,
                plainZh: '立方盒上三斜与立方最小镜像距离匹配残差应为零',
                plainEn:
                  'Residual between triclinic and cubic min-image distances should be zero on a cubic box',
              },
            },
            {
              id: 'md-compose-mu-volume',
              layer: 'foundation',
              titleZh: '合成：各向同性 μ 体积 V′ = μ³ V',
              titleEn: 'Compose: isotropic μ volume scale V′ = μ³ V',
              bodyZh:
                'h′=μ h 时体积按 μ³ 缩放（分数坐标不变）。算例 μ=1.01、V=1000 → V′≈1030.301；桥接 S29am/S29ap triclinic μ barostat stub。',
              bodyEn:
                'Isotropic h′=μh scales volume by μ³; sample μ=1.01,V=1000; bridges S29am/S29ap μ barostat stub.',
              formula: {
                expr: 'V_new = (mu ** 3) * V',
                vars: {
                  V_new: '缩放后体积',
                  mu: '各向同性尺度因子 μ',
                  V: '缩放前体积',
                },
                sample: { mu: 1.01, V: 1000 },
                expected: 1.01 ** 3 * 1000,
                plainZh: '各向同性 μ 缩放后体积合成为 μ 立方乘原体积',
                plainEn:
                  'Isotropic μ scale composes new volume as μ cubed times the prior volume',
              },
            },
            {
              id: 'md-compose-skin-gate-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Verlet skin 重建门 max(0, 2 δ_max − skin)',
              titleEn: 'Compose KPI: Verlet skin rebuild gate max(0, 2 δ_max − skin)',
              bodyZh:
                '经典 2·max|δ_i| > skin 时需重建邻表；未越界残差为 0。算例 δ_max=0.05、skin=0.3 → 残差 0；桥接 triclinicVerletListNeedsRebuild / S29ae–S29aj skin honesty。',
              bodyEn:
                'Rebuild when 2·max|δ| > skin; residual 0 when valid; sample δ_max=0.05, skin=0.3; bridges S29ae–S29aj skin honesty.',
              formula: {
                expr: 'res = max(0, 2 * d_max - skin)',
                vars: {
                  res: 'skin 越界重建残差',
                  d_max: '相对重建位的最大最小镜像位移',
                  skin: 'Verlet skin 厚度',
                },
                sample: { d_max: 0.05, skin: 0.3 },
                expected: 0,
                plainZh: '最大位移在 skin 预算内时 Verlet 重建门残差为零',
                plainEn:
                  'Verlet skin rebuild-gate residual is zero when max displacement stays within the skin budget',
              },
            },
            {
              id: 'md-compose-list-ratio',
              layer: 'foundation',
              titleZh: '合成：邻表密度比 n_listed / n_all',
              titleEn: 'Compose: neighbour-list density ratio n_listed / n_all',
              bodyZh:
                'cell/all-pairs 列表相对全对计数的 meanListRatio。算例 n_listed=12、n_all=45 → 比=0.266…；桥接 triclinicNeighborCountStats / S29ae。',
              bodyEn:
                'meanListRatio = nListed/nAll; sample 12/45; bridges S29ae neighbor-count KPIs.',
              formula: {
                expr: 'ratio = n_listed / n_all',
                vars: {
                  ratio: '列表/全对比',
                  n_listed: '列表中成对数',
                  n_all: '全对成对数',
                },
                sample: { n_listed: 12, n_all: 45 },
                expected: 12 / 45,
                plainZh: '邻表密度比由列表成对数除以全对成对数合成',
                plainEn:
                  'Neighbour-list density ratio composes listed pairs over all-pairs count',
              },
            },
            {
              id: 'md-compose-dual-T-window',
              layer: 'foundation',
              titleZh: '合成 KPI：双窗温度诚实 |T̄_e − T̄_t| / T★',
              titleEn: 'Compose KPI: dual-window T honesty |T̄_e − T̄_t| / T★',
              bodyZh:
                'early/trailing 温度窗均值相对目标的 dual 残差；速度重标稳态应≈0。算例 T̄_e=T̄_t=T★=1 → 0；桥接 S29ax dual T-window honesty floor（smoke≠eng DoD）。',
              bodyEn:
                'Dual early/trailing mean-T residual vs T★; velocity-rescale → ~0; sample matched; bridges S29ax dual T honesty (smoke≠eng).',
              formula: {
                expr: 'res = abs(T_early - T_trail) / T_star',
                vars: {
                  res: '双窗温度相对残差',
                  T_early: 'early 窗平均温度',
                  T_trail: 'trailing 窗平均温度',
                  T_star: '目标温度 T★',
                },
                sample: { T_early: 1, T_trail: 1, T_star: 1 },
                expected: 0,
                plainZh: 'early/trailing 温度窗均值一致时双窗诚实残差为零',
                plainEn:
                  'Dual-window temperature honesty residual is zero when early and trailing means match',
              },
            },
            {
              id: 'md-compose-dual-V-window',
              layer: 'foundation',
              titleZh: '合成 KPI：双窗体积诚实 |V̄_e − V̄_t| / V₀',
              titleEn: 'Compose KPI: dual-window volume honesty |V̄_e − V̄_t| / V₀',
              bodyZh:
                'early/trailing 体积窗相对初体积的 dual 残差；identity-μ 短轨迹应≈0。算例 V̄_e=V̄_t=V₀=1000 → 0；桥接 S29ax dual V honesty floor。',
              bodyEn:
                'Dual volume residual vs V₀; identity-μ short traj → ~0; sample matched; bridges S29ax dual V honesty.',
              formula: {
                expr: 'res = abs(V_early - V_trail) / V0',
                vars: {
                  res: '双窗体积相对残差',
                  V_early: 'early 窗平均体积',
                  V_trail: 'trailing 窗平均体积',
                  V0: '初体积 / 参考体积',
                },
                sample: { V_early: 1000, V_trail: 1000, V0: 1000 },
                expected: 0,
                plainZh: 'early/trailing 体积窗均值一致时双窗诚实残差为零',
                plainEn:
                  'Dual-window volume honesty residual is zero when early and trailing means match',
              },
            },
            {
              id: 'md-compose-dual-hydro-window',
              layer: 'foundation',
              titleZh: '合成 KPI：双窗静水压诚实 |P̄_e − P̄_t| / P★',
              titleEn: 'Compose KPI: dual-window hydrostatic honesty |P̄_e − P̄_t| / P★',
              bodyZh:
                'early/trailing 静水压窗 dual 残差；热噪声下为软 KPI。算例匹配 P̄=P★=0.1 → 0；桥接 S29ax dual hydro floor（soft doc，非硬门）。',
              bodyEn:
                'Dual hydrostatic residual; soft under virial noise; sample matched; bridges S29ax dual hydro floor (soft KPI).',
              formula: {
                expr: 'res = abs(P_early - P_trail) / P_star',
                vars: {
                  res: '双窗静水压相对残差',
                  P_early: 'early 窗平均静水压',
                  P_trail: 'trailing 窗平均静水压',
                  P_star: '目标/尺度静水压',
                },
                sample: { P_early: 0.1, P_trail: 0.1, P_star: 0.1 },
                expected: 0,
                plainZh: 'early/trailing 静水压窗均值一致时双窗诚实残差为零',
                plainEn:
                  'Dual-window hydrostatic honesty residual is zero when early and trailing means match',
              },
            },
            {
              id: 'md-compose-shear-norm',
              layer: 'foundation',
              titleZh: '合成：剪切范数 ‖s‖ = √(s_xy²+s_xz²+s_yz²)',
              titleEn: 'Compose: shear norm ‖s‖ = √(s_xy²+s_xz²+s_yz²)',
              bodyZh:
                '三斜剪应力 stub 的 Frobenius 型剪切范数。算例 sxy=0.03、sxz=syz=0 → ‖s‖=0.03；桥接 triclinicShearStressStub / dual shear-norm honesty。',
              bodyEn:
                'Shear-stress stub Frobenius-like norm; sample 0.03; bridges shear stub and dual shear-norm honesty.',
              formula: {
                expr: 'sn = sqrt(sxy * sxy + sxz * sxz + syz * syz)',
                vars: {
                  sn: '剪切范数',
                  sxy: '剪应力 xy',
                  sxz: '剪应力 xz',
                  syz: '剪应力 yz',
                },
                sample: { sxy: 0.03, sxz: 0, syz: 0 },
                expected: 0.03,
                plainZh: '三斜剪切范数由三个剪应力分量平方和的平方根合成',
                plainEn:
                  'Triclinic shear norm composes as the square root of the sum of squared off-diagonal stress components',
              },
            },
            {
              id: 'md-compose-dual-shear-norm',
              layer: 'foundation',
              titleZh: '合成 KPI：双窗剪切范数诚实 |‖s‖_e − ‖s‖_t|',
              titleEn: 'Compose KPI: dual-window shear-norm honesty |‖s‖_e − ‖s‖_t|',
              bodyZh:
                'early/trailing 剪切范数均值 dual 残差；identity-μ / γ=0 短轨迹应≈0。算例两者 0 → 残差 0；桥接 S29aw dual shear-norm honesty floor。',
              bodyEn:
                'Dual shear-norm residual; identity-μ/γ=0 → ~0; sample matched zeros; bridges S29aw dual shear-norm honesty.',
              formula: {
                expr: 'res = abs(sn_early - sn_trail)',
                vars: {
                  res: '双窗剪切范数残差',
                  sn_early: 'early 窗平均剪切范数',
                  sn_trail: 'trailing 窗平均剪切范数',
                },
                sample: { sn_early: 0, sn_trail: 0 },
                expected: 0,
                plainZh: 'early/trailing 剪切范数一致时双窗诚实残差为零',
                plainEn:
                  'Dual-window shear-norm honesty residual is zero when early and trailing means match',
              },
            },
            {
              id: 'md-compose-abs-frac-agree-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：绝对–分数最小镜像一致 |d_abs − d_frac|',
              titleEn: 'Compose KPI: absolute–fractional min-image agree |d_abs − d_frac|',
              bodyZh:
                '弱剪切且 r 小于半面间距时绝对与分数最小镜像应一致。算例 d_abs=d_frac=1.2 → 残差 0；桥接 triclinicAbsoluteAgreesWithFractional / S29af honesty dual。',
              bodyEn:
                'Mild shear below half-spacing: absolute agrees with fractional; sample matched; bridges S29af absolute–fractional honesty dual.',
              formula: {
                expr: 'res = abs(d_abs - d_frac)',
                vars: {
                  res: '绝对–分数距离残差',
                  d_abs: '绝对最小镜像距离',
                  d_frac: '分数最小镜像距离',
                },
                sample: { d_abs: 1.2, d_frac: 1.2 },
                expected: 0,
                plainZh: '弱剪切安全域内绝对与分数最小镜像距离一致时残差为零',
                plainEn:
                  'Absolute–fractional min-image residual is zero when distances agree in the safe mild-shear domain',
              },
            },
            {
              id: 'md-compose-h-scale',
              layer: 'foundation',
              titleZh: '合成：各向同性 h 边长 L′ = μ L',
              titleEn: 'Compose: isotropic h edge L′ = μ L',
              bodyZh:
                'h′=μ h 时立方边长线性缩放，分数坐标不变。算例 μ=1.01、L=10 → L′=10.1；与 μ 体积链 μ³ 并列，桥接 S29am h-matrix μ。',
              bodyEn:
                'Isotropic h′=μh scales edges linearly; sample μ=1.01,L=10 → 10.1; pairs with μ³ volume; bridges S29am h-matrix μ.',
              formula: {
                expr: 'L_new = mu * L',
                vars: {
                  L_new: '缩放后边长',
                  mu: '各向同性尺度因子 μ',
                  L: '缩放前边长',
                },
                sample: { mu: 1.01, L: 10 },
                expected: 10.1,
                plainZh: '各向同性 μ 缩放后盒边长合成为 μ 乘原边长',
                plainEn:
                  'Isotropic μ scale composes new box edge as μ times the prior edge',
              },
            },
            {
              id: 'md-compose-triple-T-window',
              layer: 'foundation',
              titleZh: '合成 KPI：三窗温度诚实 max(|T̄_e−T̄_m|,|T̄_m−T̄_t|)/T★',
              titleEn: 'Compose KPI: triple-window T honesty max(|T̄_e−T̄_m|,|T̄_m−T̄_t|)/T★',
              bodyZh:
                'early/mid/trailing 三窗温度 dual 扩展；速度重标稳态应≈0。算例三窗均 1、T★=1 → 0；桥接 S29ay triple T honesty floor（smoke≠eng）。',
              bodyEn:
                'Triple early/mid/trailing T residual; velocity-rescale → ~0; sample matched; bridges S29ay triple T honesty (smoke≠eng).',
              formula: {
                expr: 'res = max(abs(T_early - T_mid), abs(T_mid - T_trail)) / T_star',
                vars: {
                  res: '三窗温度相对残差',
                  T_early: 'early 窗平均温度',
                  T_mid: 'mid 窗平均温度',
                  T_trail: 'trailing 窗平均温度',
                  T_star: '目标温度 T★',
                },
                sample: { T_early: 1, T_mid: 1, T_trail: 1, T_star: 1 },
                expected: 0,
                plainZh: 'early/mid/trailing 温度窗一致时三窗诚实残差为零',
                plainEn:
                  'Triple-window temperature honesty residual is zero when early, mid, and trailing means match',
              },
            },
            {
              id: 'md-compose-abs-cell-U-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：绝对–cell 能量残差 |U_abs − U_cell| / |U_cell|',
              titleEn: 'Compose KPI: absolute–cell energy residual |U_abs − U_cell| / |U_cell|',
              bodyZh:
                '绝对 all-pairs 与分数 cell-list 能量应合同。算例 U_abs=U_cell=−12 → 残差 0；桥接 triclinicAbsoluteMatchesCellList / S29ai energy honesty dual。',
              bodyEn:
                'Absolute all-pairs U must match fractional cell-list; sample matched; bridges S29ai abs–cell energy honesty dual.',
              formula: {
                expr: 'res = abs(U_abs - U_cell) / abs(U_cell)',
                vars: {
                  res: '绝对–cell 相对能量残差',
                  U_abs: '绝对 all-pairs 总对势',
                  U_cell: '分数 cell-list 总对势',
                },
                sample: { U_abs: -12, U_cell: -12 },
                expected: 0,
                plainZh: '绝对 all-pairs 与 cell-list 对势能量一致时残差为零',
                plainEn:
                  'Absolute–cell pair-energy residual is zero when absolute all-pairs matches the cell list',
              },
            },

            // S29ca mad↔min dual gap + Minkowski-4 + Canberra + clad multi-window honesty floors (wave35 residual compose expand; solvers tip landed)
            {
              id: 'md-compose-mad-min-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：madMinGap = |MAD − min| 对偶间隙',
              titleEn: 'Compose KPI: madMinGap = |MAD − min| dual gap',
              bodyZh:
                'S29ca（landed）：成对 multi-window honesty 的 mad↔min 对偶间隙 |mad−min|。匹配等值 → 0。算例 mad=min=0 → 0；桥接 equilibrationHonestyMadMinGapResidual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S29ca (landed) mad↔min dual gap |mad−min| of pairwise multi-window honesty; matched equal → 0; sample zeros → 0; bridges equilibrationHonestyMadMinGapResidual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'madMinGap = abs(mad - pairwise_min)',
                vars: {
                  madMinGap: 'mad↔min 对偶间隙 1',
                  mad: '成对残差中位绝对偏差',
                  pairwise_min: '成对残差下确界',
                },
                sample: { mad: 0, pairwise_min: 0 },
                expected: 0,
                plainZh: 'mad↔min 对偶间隙等于 MAD 与成对下确界之差的绝对值',
                plainEn:
                  'Mad↔min dual gap is the absolute difference of MAD and pairwise minimum',
              },
            },
            {
              id: 'md-compose-minkowski4-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：Minkowski-4 M₄ = (Σ |D−e|⁴)^{1/4}',
              titleEn: 'Compose KPI: Minkowski-4 M₄ = (Σ |D−e|⁴)^{1/4}',
              bodyZh:
                'S29ca Minkowski-4 dual residual：logistic-CDF PIT 间距 smoke 的 L4 范数。匹配均匀间距 → 近 0。算例全零偏差 → 0；桥接 equilibrationHonestyMinkowski4Residual。',
              bodyEn:
                'S29ca Minkowski-4 dual residual L4 of logistic-CDF PIT spacings; matched uniform → ~0; sample zero deviations → 0; bridges equilibrationHonestyMinkowski4Residual.',
              formula: {
                expr: 'M4 = (abs(d1)^4 + abs(d2)^4 + abs(d3)^4)^(1/4)',
                vars: {
                  M4: 'Minkowski-4 dual 残差 1',
                  d1: '间距偏差 1',
                  d2: '间距偏差 2',
                  d3: '间距偏差 3',
                },
                sample: { d1: 0, d2: 0, d3: 0 },
                expected: 0,
                plainZh: 'Minkowski-4 dual 残差为间距偏差四次方和的四次方根',
                plainEn:
                  'Minkowski-4 dual residual is the fourth-root of the sum of fourth powers of spacing deviations',
              },
            },
            {
              id: 'md-compose-canberra-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：Canberra = Σ |D−e| / (|D| + e)',
              titleEn: 'Compose KPI: Canberra = Σ |D−e| / (|D| + e)',
              bodyZh:
                'S29ca Canberra relative-L1 dual：Σ |D−e|/(|D|+e) 间距 smoke。匹配 → 0。算例全零 → 0；桥接 equilibrationHonestyCanberraResidual。',
              bodyEn:
                'S29ca Canberra relative-L1 dual Σ |D−e|/(|D|+e) spacings smoke; matched → 0; sample zeros → 0; bridges equilibrationHonestyCanberraResidual.',
              formula: {
                expr: 'Can = abs(d1) / (abs(D1) + e) + abs(d2) / (abs(D2) + e)',
                vars: {
                  Can: 'Canberra dual 残差 1',
                  d1: '偏差 1',
                  d2: '偏差 2',
                  D1: '观测间距 1',
                  D2: '观测间距 2',
                  e: '期望间距',
                },
                sample: { d1: 0, d2: 0, D1: 0.25, D2: 0.25, e: 0.25 },
                expected: 0,
                plainZh: 'Canberra dual 残差为相对 L1 间距偏差之和',
                plainEn:
                  'Canberra dual residual is the sum of relative-L1 spacing deviations',
              },
            },
            {
              id: 'md-compose-clad-floors-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：clad multi-window honesty floors 联合门（0/1）',
              titleEn: 'Compose KPI: clad multi-window honesty floors joint gate (0/1)',
              bodyZh:
                'S29ca clad floors：sheathed multi-window 诚实 ∧ madMinGap 地板 ∧ Minkowski-4 地板 ∧ Canberra 地板。教学金标 → 1（下接 S29cb max↔min/Cosine/Bray–Curtis landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S29ca clad floors: sheathed multi-window honest ∧ madMinGap floor ∧ Minkowski-4 floor ∧ Canberra floor; honest gold → 1 (next S29cb max↔min/Cosine/Bray–Curtis landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_sheath * c_madMin * c_M4 * c_Can',
                vars: {
                  gate: 'clad multi-window honesty floors 门 0/1',
                  c_sheath: 'sheathed multi-window 诚实 0/1',
                  c_madMin: 'madMinGap 地板 诚实 0/1',
                  c_M4: 'Minkowski-4 地板 诚实 0/1',
                  c_Can: 'Canberra 地板 诚实 0/1',
                },
                sample: {
                  c_sheath: 1,
                  c_madMin: 1,
                  c_M4: 1,
                  c_Can: 1,
                },
                expected: 1,
                plainZh: 'clad multi-window honesty floors 门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Clad multi-window honesty floors gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            {
              id: 'md-compose-equilibration-clad-honest',
              layer: 'foundation',
              titleZh: '合成 KPI：equilibrationMultiWindowHonestClad（0/1）',
              titleEn: 'Compose KPI: equilibrationMultiWindowHonestClad (0/1)',
              bodyZh:
                'S29ca soft doc KPI：multi-window honest ∧ all residual floors clad。教学金标 → 1。**smoke residual ≠ eng DoD / 非 ok 硬门**。',
              bodyEn:
                'S29ca soft doc KPI: multi-window honest ∧ all residual floors clad; honest gold → 1; smoke residual ≠ eng DoD / not hard ok gate.',
              formula: {
                expr: 'clad = c_mw * c_floors',
                vars: {
                  clad: 'equilibration multi-window honest clad 0/1',
                  c_mw: 'multi-window 诚实 0/1',
                  c_floors: 'all residual floors clad 0/1',
                },
                sample: { c_mw: 1, c_floors: 1 },
                expected: 1,
                plainZh: 'equilibration multi-window honest clad 为 multi-window 与 floors clad 之积',
                plainEn:
                  'Equilibration multi-window honest clad is the product of multi-window honesty and floors-clad flags',
              },
            },

            // S29cb max↔min dual + Cosine dual + Bray–Curtis dual + plated multi-window honesty (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'md-compose-max-min-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：maxMinGap = |max − min| 对偶间隙',
              titleEn: 'Compose KPI: maxMinGap = |max − min| dual gap',
              bodyZh:
                'S29cb（landed）：成对 multi-window honesty 的 max↔min 对偶间隙 |max−min|（n=3 时等于 span）。匹配等值 → 0。算例 max=min=0 → 0；桥接 equilibrationHonestyMaxMinGapResidual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S29cb (landed) max↔min dual gap |max−min| of pairwise multi-window honesty (=span for n=3); matched equal → 0; sample zeros → 0; bridges equilibrationHonestyMaxMinGapResidual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'maxMinGap = abs(pairwise_max - pairwise_min)',
                vars: {
                  maxMinGap: 'max↔min 对偶间隙 1',
                  pairwise_max: '成对残差上确界',
                  pairwise_min: '成对残差下确界',
                },
                sample: { pairwise_max: 0, pairwise_min: 0 },
                expected: 0,
                plainZh: 'max↔min 对偶间隙等于成对上确界与下确界之差的绝对值',
                plainEn:
                  'Max↔min dual gap is the absolute difference of pairwise maximum and minimum',
              },
            },
            {
              id: 'md-compose-cosine-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：Cosine dual = 1 − cos(D, e·1)',
              titleEn: 'Compose KPI: Cosine dual = 1 − cos(D, e·1)',
              bodyZh:
                'S29cb Cosine dual residual：logistic-CDF PIT 间距 smoke 的 1−余弦相似度。匹配均匀间距 → 近 0。算例匹配 → 0；桥接 equilibrationHonestyCosineResidual。',
              bodyEn:
                'S29cb Cosine dual residual 1−cos(D, e·1) of logistic-CDF PIT spacings; matched uniform → ~0; sample matched → 0; bridges equilibrationHonestyCosineResidual.',
              formula: {
                expr: 'Cos = 1 - (dot / (norm_D * norm_e))',
                vars: {
                  Cos: 'Cosine dual 残差 1',
                  dot: 'D · e 内积',
                  norm_D: 'D 范数',
                  norm_e: 'e·1 范数',
                },
                sample: { dot: 1, norm_D: 1, norm_e: 1 },
                expected: 0,
                plainZh: 'Cosine dual 残差等于一减去间距向量与均匀参考的余弦相似度',
                plainEn:
                  'Cosine dual residual is one minus cosine similarity of spacing vector to the uniform reference',
              },
            },
            {
              id: 'md-compose-bray-curtis-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：Bray–Curtis = Σ |D−e| / Σ (D+e)',
              titleEn: 'Compose KPI: Bray–Curtis = Σ |D−e| / Σ (D+e)',
              bodyZh:
                'S29cb Bray–Curtis dual residual：Σ |D−e| / Σ(D+e) 间距 smoke。匹配 → 0。算例全零偏差 → 0；桥接 equilibrationHonestyBrayCurtisResidual。',
              bodyEn:
                'S29cb Bray–Curtis dual residual Σ |D−e|/Σ(D+e) spacings smoke; matched → 0; sample zero deviations → 0; bridges equilibrationHonestyBrayCurtisResidual.',
              formula: {
                expr: 'BC = (abs(d1) + abs(d2)) / (s1 + s2)',
                vars: {
                  BC: 'Bray–Curtis dual 残差 1',
                  d1: '偏差 1',
                  d2: '偏差 2',
                  s1: 'D1+e 和项 1',
                  s2: 'D2+e 和项 2',
                },
                sample: { d1: 0, d2: 0, s1: 0.5, s2: 0.5 },
                expected: 0,
                plainZh: 'Bray–Curtis dual 残差为绝对偏差和除以 (D+e) 和',
                plainEn:
                  'Bray–Curtis dual residual is the sum of absolute deviations over the sum of (D+e)',
              },
            },
            {
              id: 'md-compose-plated-floors-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：plated multi-window honesty floors 联合门（0/1）',
              titleEn: 'Compose KPI: plated multi-window honesty floors joint gate (0/1)',
              bodyZh:
                'S29cb plated floors：clad multi-window 诚实 ∧ maxMinGap 地板 ∧ Cosine 地板 ∧ Bray–Curtis 地板。教学金标 → 1（下接 S29cc）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S29cb plated floors: clad multi-window honest ∧ maxMinGap floor ∧ Cosine floor ∧ Bray–Curtis floor; honest gold → 1 (next S29cc); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_clad * c_maxMin * c_cos * c_bc',
                vars: {
                  gate: 'plated multi-window honesty floors 门 0/1',
                  c_clad: 'clad multi-window 诚实 0/1',
                  c_maxMin: 'maxMinGap 地板 诚实 0/1',
                  c_cos: 'Cosine 地板 诚实 0/1',
                  c_bc: 'Bray–Curtis 地板 诚实 0/1',
                },
                sample: {
                  c_clad: 1,
                  c_maxMin: 1,
                  c_cos: 1,
                  c_bc: 1,
                },
                expected: 1,
                plainZh: 'plated multi-window honesty floors 门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Plated multi-window honesty floors gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            {
              id: 'md-compose-equilibration-plated-honest',
              layer: 'foundation',
              titleZh: '合成 KPI：equilibrationMultiWindowHonestPlated（0/1）',
              titleEn: 'Compose KPI: equilibrationMultiWindowHonestPlated (0/1)',
              bodyZh:
                'S29cb soft doc KPI：multi-window honest ∧ all residual floors plated。教学金标 → 1。**smoke residual ≠ eng DoD / 非 ok 硬门**。',
              bodyEn:
                'S29cb soft doc KPI: multi-window honest ∧ all residual floors plated; honest gold → 1; smoke residual ≠ eng DoD / not hard ok gate.',
              formula: {
                expr: 'plated = c_mw * c_floors',
                vars: {
                  plated: 'equilibration multi-window honest plated 0/1',
                  c_mw: 'multi-window 诚实 0/1',
                  c_floors: 'all residual floors plated 0/1',
                },
                sample: { c_mw: 1, c_floors: 1 },
                expected: 1,
                plainZh: 'equilibration multi-window honest plated 为 multi-window 与 floors plated 之积',
                plainEn:
                  'Equilibration multi-window honest plated is the product of multi-window honesty and floors-plated flags',
              },
            },
          ],
        },
        {
          id: 'md-L0',
          layer: 'L0',
          titleZh: 'L0：粒子/势教学叶子',
          titleEn: 'L0: particle / potential teaching',
          bodyZh:
            '教学可用简化 2-body LJ 演示；不计入 engineering DoD。完整 n-body/PBC / triclinic honesty duals 归 solvers-md（S29 残差 tip，smoke≠eng DoD）。',
          bodyEn:
            'Teaching 2-body demos allowed; eng n-body / triclinic honesty duals live in solvers-md (S29 residual tip; smoke≠eng DoD).',
        },
      ],
    },
  }
