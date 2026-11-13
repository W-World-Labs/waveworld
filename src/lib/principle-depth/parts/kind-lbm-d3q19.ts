import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_LBM_D3Q19: CalculationMethod = {
    id: 'kind-lbm-d3q19',
    titleZh: 'LBM D3Q19 流体（工程 kind）',
    titleEn: 'LBM D3Q19 fluid (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind lbm-d3q19：格子 Boltzmann D3Q19 工程路径；教学落到 BGK 粘度、格子权与 D2Q9 顶盖方腔。',
    summaryEn:
      'W-Sim kind lbm-d3q19: lattice-Boltzmann D3Q19 path; drills to BGK viscosity, weights, D2Q9 lid-driven cavity.',
    jobKinds: ['lbm-d3q19'],
    explainRoot: {
      id: 'lbm-root',
      layer: 'method',
      titleZh: '方法：LBM D3Q19',
      titleEn: 'Method: LBM D3Q19',
      bodyZh:
        '顶层工程计算方法：介观分布函数 f_i 经 collide–stream 演化，低 Mach 下逼近不可压 Navier–Stokes。工程三维为 D3Q19；二维教学常用 D2Q9 顶盖驱动方腔。数值实现归 @w-sim/solvers-lbm。',
      bodyEn:
        'Mesoscopic f_i collide–stream approximates NS at low Ma; eng D3Q19, teaching D2Q9 cavity; owned by @w-sim/solvers-lbm.',
      jobKinds: ['lbm-d3q19'],
      children: [
        {
          id: 'lbm-principle-bgk',
          layer: 'principle',
          titleZh: '原理：BGK 碰撞与流淌',
          titleEn: 'Principle: BGK collide & stream',
          bodyZh:
            '单松弛 BGK：f* = f − (f − f^eq)/τ；随后 f_i(x+e_i, t+1) ← f*_i(x,t)。τ 控制粘性；stream 沿离散速度迁移守恒质量/动量（无外力时）。',
          bodyEn:
            'BGK: f* = f − (f−f^eq)/τ then stream along e_i; τ sets viscosity; mass/momentum conserved without force.',
          children: [
            {
              id: 'lbm-foundation-viscosity',
              layer: 'foundation',
              titleZh: '基础式：ν = c_s² (τ − 1/2)',
              titleEn: 'Foundation: ν = c_s² (τ − 1/2)',
              bodyZh:
                '格子单位下运动粘度。D2Q9/D3Q19 常取 c_s² = 1/3。要求 τ > 1/2（ν>0）；τ 过近 1/2 数值噪声大，过大则过度耗散。',
              bodyEn:
                'Lattice kinematic viscosity; c_s²=1/3 on D2Q9/D3Q19; need τ>1/2.',
              formula: {
                expr: 'nu = cs2 * (tau - 0.5)',
                vars: {
                  nu: '运动粘度（格子单位）',
                  cs2: '格子声速平方 c_s²',
                  tau: '无量纲松弛时间 τ',
                },
                sample: { cs2: 1 / 3, tau: 1 },
                expected: (1 / 3) * (1 - 0.5),
                plainZh: '运动粘度等于格子声速平方乘以松弛时间减二分之一',
                plainEn: 'Kinematic viscosity is lattice sound-speed squared times (τ − 1/2)',
              },
            },
            {
              id: 'lbm-foundation-cs2',
              layer: 'foundation',
              titleZh: '基础：c_s² = 1/3',
              titleEn: 'Foundation: c_s² = 1/3',
              bodyZh:
                '标准 D2Q9 / D3Q19 等温格子声速平方。宏观压强 p = c_s² ρ；低 Mach |u| ≪ c_s 时才逼近不可压 NS。',
              bodyEn:
                'Standard D2Q9/D3Q19 isothermal c_s²; p=c_s²ρ; low-Ma needed for incompressible NS.',
              formula: {
                expr: 'cs2 = 1 / 3',
                vars: {
                  cs2: '格子声速平方 c_s²',
                },
                sample: {},
                expected: 1 / 3,
                plainZh: 'D2Q9/D3Q19 标准格子声速平方为三分之一',
                plainEn: 'Standard D2Q9/D3Q19 lattice sound-speed squared is 1/3',
              },
            },
            {
              id: 'lbm-foundation-bgk-update',
              layer: 'foundation',
              titleZh: '基础式：f* = f − (f − f_eq)/τ',
              titleEn: 'Foundation: f* = f − (f − f_eq)/τ',
              bodyZh:
                '单方向 BGK 碰撞。τ=1 时 f* = f_eq（一步松弛到平衡）。外力可在碰撞后叠加 Guo 等格式。',
              bodyEn:
                'Per-direction BGK; τ=1 → f*=f_eq in one step; forces via Guo-style schemes.',
              formula: {
                expr: 'f_star = f - (f - f_eq) / tau',
                vars: {
                  f_star: '碰撞后分布',
                  f: '碰撞前分布',
                  f_eq: '局部平衡分布',
                  tau: '松弛时间 τ',
                },
                sample: { f: 0.4, f_eq: 0.25, tau: 1 },
                expected: 0.25,
                plainZh: 'BGK 碰撞后分布向局部平衡态松弛',
                plainEn: 'BGK post-collision distribution relaxes toward local equilibrium',
              },
            },
          ],
        },
        {
          id: 'lbm-principle-moments',
          layer: 'principle',
          titleZh: '原理：宏观矩与平衡态',
          titleEn: 'Principle: macroscopic moments & equilibrium',
          bodyZh:
            '密度 ρ = Σ f_i，动量 ρu = Σ f_i e_i；f^eq 由 ρ、u 与权 w_i 构造，使 0–2 阶矩匹配可压/弱可压 NS 连续极限。',
          bodyEn:
            'ρ=Σf_i, ρu=Σf_i e_i; f^eq(ρ,u,w) matches low-order moments for NS limit.',
          children: [
            {
              id: 'lbm-foundation-rho',
              layer: 'foundation',
              titleZh: '基础式：ρ = Σ f_i（D2Q9 权分解）',
              titleEn: 'Foundation: ρ = Σ f_i (D2Q9 weight split)',
              bodyZh:
                '静止均匀平衡 f_i = ρ w_i 时，ρ 由 rest/cardinal/diagonal 三组恢复。D3Q19 同理扩展面心/体心方向。',
              bodyEn:
                'At rest f_i=ρ w_i; ρ recovered from rest/cardinal/diagonal groups; D3Q19 adds face/body sets.',
              formula: {
                expr: 'rho = f0 + 4 * f1 + 4 * f2',
                vars: {
                  rho: '宏观密度',
                  f0: '静止方向分布（=ρ w0）',
                  f1: '轴方向单支分布（=ρ w_card）',
                  f2: '对角方向单支分布（=ρ w_diag）',
                },
                sample: { f0: 4 / 9, f1: 1 / 9, f2: 1 / 36 },
                expected: 1,
                plainZh: '宏观密度等于各离散方向分布函数之和',
                plainEn: 'Macroscopic density is the sum of discrete-direction populations',
              },
            },
            {
              id: 'lbm-foundation-weights',
              layer: 'foundation',
              titleZh: '基础：D2Q9 权求和 = 1',
              titleEn: 'Foundation: D2Q9 weights sum to 1',
              bodyZh:
                'w0=4/9，4 个轴向 w=1/9，4 个对角 w=1/36；Σ w_i = 1 保证均匀静止态矩正确。D3Q19 权集不同但同样归一。',
              bodyEn:
                'D2Q9: 4/9 + 4×1/9 + 4×1/36 = 1; D3Q19 uses another normalized set.',
              formula: {
                expr: 'w_sum = w0 + 4 * w1 + 4 * w2',
                vars: {
                  w_sum: '权之和',
                  w0: '静止权 4/9',
                  w1: '轴向权 1/9',
                  w2: '对角权 1/36',
                },
                sample: { w0: 4 / 9, w1: 1 / 9, w2: 1 / 36 },
                expected: 1,
                plainZh: 'D2Q9 离散速度权之和必须为 1',
                plainEn: 'D2Q9 discrete-velocity weights must sum to 1',
              },
            },
            {
              id: 'lbm-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '低 Mach、弱可压/等温 BGK；高 Re 需足够分辨率或湍流模型。强可压、多相、非牛顿需扩展碰撞/力项。工程 smoke 覆盖质量守恒、粘度标定与腔流对称。',
              bodyEn:
                'Low-Ma isothermal BGK; high-Re needs resolution/turbulence; multiphase/non-Newtonian need extensions.',
            },
          ],
        },
        {
          id: 'lbm-principle-cavity',
          layer: 'principle',
          titleZh: '原理：D2Q9 顶盖驱动方腔',
          titleEn: 'Principle: D2Q9 lid-driven cavity',
          bodyZh:
            '经典 2D 基准：顶盖 U_lid、其余无滑移。Re = U L / ν 标定流态；稳态主涡/角涡位置与 Ghia 等参考对比。工程 D3Q19 可推广为 3D 腔，教学以 D2Q9 为主。',
          bodyEn:
            'Classic 2D benchmark: lid U, no-slip walls; Re=UL/ν; compare vortices to Ghia-class refs; eng may 3D-extend.',
          children: [
            {
              id: 'lbm-foundation-re',
              layer: 'foundation',
              titleZh: '基础式：Re = U L / ν',
              titleEn: 'Foundation: Re = U L / ν',
              bodyZh:
                '顶盖速度 U、腔边长 L（格子数）、运动粘度 ν 定义雷诺数。教学常用 Re~100；工程扫参可更高并检查网格收敛。',
              bodyEn:
                'Lid speed U, cavity size L, viscosity ν define Re; teaching often Re~100.',
              formula: {
                expr: 'Re = U * L / nu',
                vars: {
                  Re: '雷诺数 1',
                  U: '顶盖速度（格子单位）',
                  L: '腔特征长度（格子数）',
                  nu: '运动粘度（格子单位）',
                },
                sample: { U: 0.1, L: 100, nu: 1 / 6 },
                expected: 0.1 * 100 / (1 / 6),
                plainZh: '方腔雷诺数等于顶盖速度乘边长再除以运动粘度',
                plainEn: 'Cavity Reynolds number is lid speed times length over kinematic viscosity',
              },
            },
            {
              id: 'lbm-foundation-tau-from-re',
              layer: 'foundation',
              titleZh: '基础：由 Re 反推 τ',
              titleEn: 'Foundation: τ from Re',
              bodyZh:
                'ν = U L / Re，再 τ = ν/c_s² + 1/2。给定 U、L、Re 可唯一确定 BGK 松弛（固定 c_s²=1/3）。',
              bodyEn:
                'ν=UL/Re then τ=ν/c_s²+1/2; fixes BGK relaxation for given U,L,Re.',
              formula: {
                expr: 'tau = nu / cs2 + 0.5',
                vars: {
                  tau: '松弛时间 τ',
                  nu: '运动粘度（格子单位）',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { nu: 1 / 6, cs2: 1 / 3 },
                expected: (1 / 6) / (1 / 3) + 0.5,
                plainZh: '松弛时间由运动粘度与格子声速平方反推得到',
                plainEn: 'Relaxation time is recovered from viscosity and lattice sound-speed squared',
              },
            },
          ],
        },
        {
          id: 'lbm-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-lbm',
          titleEn: 'Engineering: solvers-lbm',
          bodyZh:
            'JobKind `lbm-d3q19` 由 @w-sim/solvers-lbm 拥有；经 kind-matrix 与 lab-kit 登记（force-channel eng dual / AM–GM–HM ladder S19bb + means dual S19be + dual envelope min/RMS/max S19bf + means dual L1/range S19bg + L1↔RMS/max dual S19bh + FullEnvelope/MinL1 dual S19bi + FullEnvelope/adjacent dual S19bj + cross-norm/triple-envelope S19bk 等 fixture）。Host claim 路径与 Tuanliu 提取政策见 EXTRACTION_PLAN。**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Owned by @w-sim/solvers-lbm; kind-matrix + lab-kit fixtures including force-channel eng dual / AM–GM–HM ladder S19bb + means dual S19be + dual envelope min/RMS/max S19bf + means dual L1/range S19bg + L1↔RMS/max dual S19bh + FullEnvelope/MinL1 dual S19bi + FullEnvelope/adjacent dual S19bj + cross-norm/triple-envelope S19bk + dualAdj triad/triangle-envelope S19bl + dual residual matrix dual-extracts/cross-norm dual residual matrix S19bm; see EXTRACTION_PLAN for Tuanliu policy; smoke residual expand ≠ eng DoD / Atlas graduation.',
          jobKinds: ['lbm-d3q19'],
        },
        {
          id: 'lbm-compose-note',
          layer: 'compose',
          titleZh: '合成视角：BGK 粘性 ∘ 格子矩 / 腔边界 ≈ LBM 方法',
          titleEn: 'Compose: BGK viscosity ∘ lattice moments / cavity BC ≈ LBM method',
          bodyZh:
            '科技树语义：更基础的「ν(τ)、c_s²、权/矩」与「无滑移/顶盖边界 / 体力通道」合成应在等价域复现顶层 LBM KPI（质量守恒、Re 标定、τ 链、Ma、权归一、力驱动通道 G 反演、f·Re、Guo 预因子、Ma–ν 链、D3Q19 权归一、通道 Re/水力直径、壁剪–G 力平衡、Guo 半步速度、f·Re 残差、Darcy f、压降等价、f·Re 四积 bulk/peak/cross 对、AM/GM/HM 均值梯、cross/matched harmonic·arithmetic residual、means dual、dual envelope min/RMS/max、means dual L1、envelope range、L1–envelope residual matrix、L1↔RMS/max dual、min–L1 envelope、envelope CV、min↔L1/min↔RMS dual、FullEnvelope residual matrix、adjacent dual residual matrix、cross-norm residual ladder、triple-envelope telescoping honesty、dualAdj triad / triangle-envelope honesty、dual residual matrix dual-extracts / cross-norm dual residual matrix）。对应 D2Q9 腔教学、力驱动通道与 D3Q19 工程双轨；数值 residual tip 桥接 @w-sim/solvers-lbm S19bb/S19be means dual + S19bf dual envelope min/RMS/max + S19bg means dual L1/range + S19bh L1↔RMS/max dual + min–L1 envelope + S19bi FullEnvelope/MinL1 dual residual matrix + S19bj FullEnvelope/adjacent dual residual matrix + S19bk cross-norm residual ladder / triple-envelope telescoping + S19bl dualAdj triad / triangle-envelope honesty + S19bm dual residual matrix dual-extracts / cross-norm dual residual matrix（landed；下接 S19bn）——**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Composing BGK ν(τ)+moments with lid/no-slip or body-force channel BC should reproduce mass, Re, τ-chain, Ma, weight-normalization, force-channel G recovery, f·Re, Guo prefactor, Ma–ν link, D3Q19 weights, channel Re/Dh, wall-shear–G balance, Guo half-step u, f·Re residual, Darcy f, pressure-gradient equivalence, f·Re quadruple products, AM/GM/HM mean-ladder honesty, means dual, dual envelope min/RMS/max, means dual L1, envelope range, L1–envelope residual matrix, L1↔RMS/max dual, min–L1 envelope, envelope CV, min↔L1/min↔RMS dual, FullEnvelope residual matrix, adjacent dual residual matrix, cross-norm residual ladder, and triple-envelope telescoping honesty, dualAdj triad / triangle-envelope honesty, dual residual matrix dual-extracts / cross-norm dual residual matrix KPIs; bridges @w-sim/solvers-lbm S19bb/S19be means dual + S19bf dual envelope min/RMS/max + S19bg means dual L1/range + S19bh L1↔RMS/max dual + min–L1 envelope + S19bi FullEnvelope/MinL1 dual residual matrix + S19bj FullEnvelope/adjacent dual residual matrix + S19bk cross-norm residual ladder / triple-envelope telescoping + S19bl dualAdj triad / triangle-envelope honesty + S19bm dual residual matrix dual-extracts / cross-norm dual residual matrix (landed; next S19bn) — smoke residual expand ≠ eng DoD / Atlas graduation.',
          children: [
            {
              id: 'lbm-compose-nu-tau',
              layer: 'foundation',
              titleZh: '合成：ν = c_s² (τ − 1/2)',
              titleEn: 'Compose: ν = c_s² (τ − 1/2)',
              bodyZh:
                '把松弛时间与格子声速合成运动粘度。BGK 粘性合同的核心；工程标定常由此反推 τ。',
              bodyEn:
                'Composes τ and c_s² into kinematic viscosity; core BGK viscosity contract.',
              formula: {
                expr: 'nu = cs2 * (tau - 0.5)',
                vars: {
                  nu: '运动粘度（格子单位）',
                  cs2: '格子声速平方 c_s²',
                  tau: '松弛时间 τ',
                },
                sample: { cs2: 1 / 3, tau: 1 },
                expected: (1 / 3) * (1 - 0.5),
                plainZh: '合成运动粘度等于格子声速平方乘松弛时间减二分之一',
                plainEn: 'Composed kinematic viscosity is c_s² times (τ − 1/2)',
              },
            },
            {
              id: 'lbm-compose-re-tau',
              layer: 'foundation',
              titleZh: '合成链：Re → ν → τ',
              titleEn: 'Compose chain: Re → ν → τ',
              bodyZh:
                '腔流标定：ν = U L / Re，再 τ = ν/c_s² + 1/2。算例 U=0.1、L=100、Re=60、c_s²=1/3 → ν=1/6、τ=1。',
              bodyEn:
                'Cavity chain: ν=UL/Re then τ=ν/c_s²+1/2; sample yields τ=1.',
              formula: {
                expr: 'tau = (U * L / Re) / cs2 + 0.5',
                vars: {
                  tau: '松弛时间 τ',
                  U: '顶盖速度（格子单位）',
                  L: '腔边长（格子数）',
                  Re: '雷诺数 1',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { U: 0.1, L: 100, Re: 60, cs2: 1 / 3 },
                expected: (0.1 * 100) / 60 / (1 / 3) + 0.5,
                plainZh: '由雷诺数与顶盖参数反推 BGK 松弛时间',
                plainEn: 'BGK relaxation time is recovered from Reynolds number and lid parameters',
              },
            },
            {
              id: 'lbm-compose-mass',
              layer: 'foundation',
              titleZh: '合成 KPI：质量守恒残差 |ρ_sum − ρ0|/ρ0',
              titleEn: 'Compose KPI: mass residual |ρ_sum − ρ0|/ρ0',
              bodyZh:
                '全域 Σ ρ 在无质量源/吸收边界时应守恒。算例完全守恒时残差为 0。',
              bodyEn:
                'Global Σρ conserved without mass sources; sample residual 0.',
              formula: {
                expr: 'res = abs(rho_sum - rho0) / abs(rho0)',
                vars: {
                  res: '质量相对残差 1',
                  rho_sum: '当前全域密度和',
                  rho0: '初始全域密度和',
                },
                sample: { rho_sum: 1, rho0: 1 },
                expected: 0,
                plainZh: '质量守恒残差在密度总和不变时应为零',
                plainEn: 'Mass residual is zero when total density is unchanged',
              },
            },
            {
              id: 'lbm-compose-weights',
              layer: 'foundation',
              titleZh: '合成：D2Q9 权归一 Σ w_i = 1',
              titleEn: 'Compose: D2Q9 weight normalization Σ w_i = 1',
              bodyZh:
                '权与矩合成的前提：静止+轴+对角权之和为 1，保证均匀静止平衡态 ρ 正确。',
              bodyEn:
                'Weight/moment compose requires Σw=1 so rest equilibrium recovers ρ.',
              formula: {
                expr: 'w_sum = w0 + 4 * w1 + 4 * w2',
                vars: {
                  w_sum: '权之和',
                  w0: '静止权 4/9',
                  w1: '轴向权 1/9',
                  w2: '对角权 1/36',
                },
                sample: { w0: 4 / 9, w1: 1 / 9, w2: 1 / 36 },
                expected: 1,
                plainZh: 'D2Q9 权归一合成要求离散速度权之和为 1',
                plainEn: 'D2Q9 weight compose requires discrete-velocity weights sum to 1',
              },
            },
            {
              id: 'lbm-compose-mach',
              layer: 'foundation',
              titleZh: '合成 KPI：Mach Ma = U / c_s',
              titleEn: 'Compose KPI: Mach Ma = U / c_s',
              bodyZh:
                '低 Ma 假设：顶盖/特征速度相对格子声速应 ≪1。算例 U=0.1、c_s=√(1/3) → Ma≈0.173。',
              bodyEn:
                'Low-Ma assumption: characteristic U ≪ c_s; sample Ma≈0.173.',
              formula: {
                expr: 'Ma = U / sqrt(cs2)',
                vars: {
                  Ma: 'Mach 数 1',
                  U: '特征速度（格子单位）',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { U: 0.1, cs2: 1 / 3 },
                expected: 0.1 / Math.sqrt(1 / 3),
                plainZh: 'Mach 数等于特征速度除以格子声速',
                plainEn: 'Mach number is characteristic speed over lattice sound speed',
              },
            },
            {
              id: 'lbm-compose-re-cavity',
              layer: 'foundation',
              titleZh: '合成：方腔 Re = U L / ν',
              titleEn: 'Compose: cavity Re = U L / ν',
              bodyZh:
                '把顶盖速度、腔边长与 BGK 粘度合成雷诺数，标定腔流 KPI 与参考解对比域。',
              bodyEn:
                'Composes lid speed, size, and BGK viscosity into Re for cavity KPI domain.',
              formula: {
                expr: 'Re = U * L / nu',
                vars: {
                  Re: '雷诺数 1',
                  U: '顶盖速度（格子单位）',
                  L: '腔边长（格子数）',
                  nu: '运动粘度（格子单位）',
                },
                sample: { U: 0.1, L: 100, nu: 1 / 6 },
                expected: 0.1 * 100 / (1 / 6),
                plainZh: '方腔雷诺数由顶盖速度、边长与运动粘度合成',
                plainEn: 'Cavity Reynolds number composes lid speed, length, and viscosity',
              },
            },
            {
              id: 'lbm-compose-pressure',
              layer: 'foundation',
              titleZh: '合成：宏观压 p = c_s² ρ',
              titleEn: 'Compose: macroscopic pressure p = c_s² ρ',
              bodyZh:
                '把格子声速平方与密度矩合成等温状态方程 p=c_s²ρ；低 Ma 弱可压极限下梯度 −∇p 进入动量方程。算例 c_s²=1/3、ρ=1 → p=1/3。',
              bodyEn:
                'Composes c_s² with density moment into isothermal p=c_s²ρ; sample p=1/3.',
              formula: {
                expr: 'p = cs2 * rho',
                vars: {
                  p: '宏观压强（格子单位）',
                  cs2: '格子声速平方 c_s²',
                  rho: '宏观密度',
                },
                sample: { cs2: 1 / 3, rho: 1 },
                expected: 1 / 3,
                plainZh: '等温格子宏观压强等于声速平方乘密度',
                plainEn: 'Isothermal lattice pressure is sound-speed squared times density',
              },
            },
            {
              id: 'lbm-compose-bgk-update',
              layer: 'foundation',
              titleZh: '合成：BGK 碰撞 f* = f − (f − f_eq)/τ',
              titleEn: 'Compose: BGK collision f* = f − (f − f_eq)/τ',
              bodyZh:
                '把分布、局部平衡与松弛时间合成碰撞后种群；与 stream 合成为 collide–stream 步进。τ=1 时一步到平衡。算例 f=0.4、f_eq=0.25、τ=1 → f*=0.25。',
              bodyEn:
                'Composes f, f_eq, τ into post-collision f*; with stream yields collide–stream; sample τ=1 → f*=f_eq.',
              formula: {
                expr: 'f_star = f - (f - f_eq) / tau',
                vars: {
                  f_star: '碰撞后分布',
                  f: '碰撞前分布',
                  f_eq: '局部平衡分布',
                  tau: '松弛时间 τ',
                },
                sample: { f: 0.4, f_eq: 0.25, tau: 1 },
                expected: 0.25,
                plainZh: 'BGK 碰撞后分布由当前种群向局部平衡态按松弛时间合成',
                plainEn:
                  'BGK post-collision population composes current f toward local equilibrium by τ',
              },
            },
            {
              id: 'lbm-compose-nu-from-re',
              layer: 'foundation',
              titleZh: '合成：ν = U L / Re（由 Re 标定）',
              titleEn: 'Compose: ν = U L / Re from Re calibration',
              bodyZh:
                '腔流标定链的前半：由目标雷诺数与顶盖参数反推运动粘度，再进入 τ=ν/c_s²+1/2。算例 U=0.1、L=100、Re=60 → ν=1/6。',
              bodyEn:
                'Front half of cavity chain: ν=UL/Re from target Re; sample ν=1/6.',
              formula: {
                expr: 'nu = U * L / Re',
                vars: {
                  nu: '运动粘度（格子单位）',
                  U: '顶盖速度（格子单位）',
                  L: '腔边长（格子数）',
                  Re: '雷诺数 1',
                },
                sample: { U: 0.1, L: 100, Re: 60 },
                expected: 0.1 * 100 / 60,
                plainZh: '运动粘度由顶盖速度、腔边长与目标雷诺数反推合成',
                plainEn:
                  'Kinematic viscosity composes from lid speed, cavity size, and target Reynolds number',
              },
            },
            {
              id: 'lbm-compose-rho-recover',
              layer: 'foundation',
              titleZh: '合成：密度矩 ρ = Σ f_i（权分解）',
              titleEn: 'Compose: density moment ρ = Σ f_i (weight split)',
              bodyZh:
                '把 rest/cardinal/diagonal 三组分布合成宏观密度；静止均匀平衡 f_i=ρ w_i 时恢复 ρ=1。连接 principle「矩」与 BGK 平衡构造。',
              bodyEn:
                'Composes rest/cardinal/diagonal populations into ρ; rest equilibrium recovers ρ=1.',
              formula: {
                expr: 'rho = f0 + 4 * f1 + 4 * f2',
                vars: {
                  rho: '宏观密度',
                  f0: '静止方向分布',
                  f1: '轴方向单支分布',
                  f2: '对角方向单支分布',
                },
                sample: { f0: 4 / 9, f1: 1 / 9, f2: 1 / 36 },
                expected: 1,
                plainZh: '宏观密度由各离散方向分布函数求和合成',
                plainEn: 'Macroscopic density composes as the sum of discrete-direction populations',
              },
            },
            {
              id: 'lbm-compose-tau-match',
              layer: 'foundation',
              titleZh: '合成 KPI：τ 链匹配残差 |τ − (ν/c_s²+1/2)|',
              titleEn: 'Compose KPI: τ-chain match residual |τ − (ν/c_s²+1/2)|',
              bodyZh:
                '粘度标定与 BGK 松弛应合同：给定 ν、c_s² 反推的 τ 与实现设定一致时残差为 0。算例 ν=1/6、c_s²=1/3、τ=1。',
              bodyEn:
                'Viscosity calibration must match BGK τ; residual 0 when τ=ν/c_s²+1/2; sample τ=1.',
              formula: {
                expr: 'res = abs(tau - (nu / cs2 + 0.5))',
                vars: {
                  res: 'τ 匹配绝对残差 1',
                  tau: '实现松弛时间 τ',
                  nu: '运动粘度（格子单位）',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { tau: 1, nu: 1 / 6, cs2: 1 / 3 },
                expected: 0,
                plainZh: '松弛时间与粘度标定合同的残差在匹配时应为零',
                plainEn:
                  'Residual between implemented τ and viscosity calibration is zero when matched',
              },
            },
            {
              id: 'lbm-compose-cs2',
              layer: 'foundation',
              titleZh: '合成：标准格子 c_s² = 1/3',
              titleEn: 'Compose: standard lattice c_s² = 1/3',
              bodyZh:
                'D2Q9/D3Q19 等温格子声速平方合同；与权/矩、p=c_s²ρ、ν(τ) 全链共用。算例常数 1/3。',
              bodyEn:
                'Standard D2Q9/D3Q19 isothermal c_s² contract shared by weights, p, and ν(τ); sample 1/3.',
              formula: {
                expr: 'cs2 = 1 / 3',
                vars: {
                  cs2: '格子声速平方 c_s²',
                },
                sample: {},
                expected: 1 / 3,
                plainZh: '标准 D2Q9/D3Q19 格子声速平方合成为三分之一',
                plainEn: 'Standard D2Q9/D3Q19 lattice sound-speed squared composes as one third',
              },
            },
            {
              id: 'lbm-compose-G-from-umax',
              layer: 'foundation',
              titleZh: '合成：力驱动通道 G 反演 G = 8 ν u_max / H²',
              titleEn: 'Compose: force-channel G recovery G = 8 ν u_max / H²',
              bodyZh:
                '平面 Poiseuille 通道：均匀体力 G、半高/高度 H 的无滑移平行板，峰值 u_max = G H²/(8ν)。工程 smoke 常由测得 u_max 反演 G 校验力项与粘度合同。算例 ν=1/6、u_max=0.1、H=50 → G=8νu_max/H²。',
              bodyEn:
                'Plane Poiseuille: body force G, height H → u_max=G H²/(8ν); recover G from peak velocity to check force/viscosity contract; sample ν=1/6, u_max=0.1, H=50.',
              formula: {
                expr: 'G = 8 * nu * u_max / (H * H)',
                vars: {
                  G: '单位质量体力（格子单位）',
                  nu: '运动粘度（格子单位）',
                  u_max: '通道中心峰值速度',
                  H: '通道高度（格子数）',
                },
                sample: { nu: 1 / 6, u_max: 0.1, H: 50 },
                expected: (8 * (1 / 6) * 0.1) / (50 * 50),
                plainZh: '力驱动通道体力由峰值速度、高度与运动粘度反演合成',
                plainEn:
                  'Force-channel body force recovers from peak velocity, height, and kinematic viscosity',
              },
            },
            {
              id: 'lbm-compose-umax-poiseuille',
              layer: 'foundation',
              titleZh: '合成：Poiseuille 峰值 u_max = G H² / (8 ν)',
              titleEn: 'Compose: Poiseuille peak u_max = G H² / (8 ν)',
              bodyZh:
                '与 G 反演对偶：给定体力与粘度合成解析峰值，对照 LBM 稳态剖面中心速度（force-channel eng residual）。算例 G=8ν·0.1/H²、ν=1/6、H=50 → u_max=0.1。',
              bodyEn:
                'Dual of G recovery: analytic peak from G,H,ν vs LBM centerline; sample yields u_max=0.1.',
              formula: {
                expr: 'u_max = G * H * H / (8 * nu)',
                vars: {
                  u_max: '通道中心峰值速度',
                  G: '单位质量体力（格子单位）',
                  H: '通道高度（格子数）',
                  nu: '运动粘度（格子单位）',
                },
                sample: {
                  G: (8 * (1 / 6) * 0.1) / (50 * 50),
                  H: 50,
                  nu: 1 / 6,
                },
                expected: 0.1,
                plainZh: '力驱动平行板通道峰值速度由体力、高度与粘度合成',
                plainEn:
                  'Force-driven parallel-plate peak velocity composes from body force, height, and viscosity',
              },
            },
            {
              id: 'lbm-compose-f-re',
              layer: 'foundation',
              titleZh: '合成 KPI：层流通道 f·Re = 24',
              titleEn: 'Compose KPI: laminar channel f·Re = 24',
              bodyZh:
                '平行板通道水力直径 D_h=2H、Re 基于截面平均速度时，Darcy 摩阻与雷诺数之积 f·Re=24（层流解析）。smoke 用测得 Δp/壁剪与 U_mean 合成 f 后验此合同。算例 f=0.4、Re=60 → f·Re=24。',
              bodyEn:
                'Parallel-plate channel with D_h=2H: laminar Darcy product f·Re=24; smoke checks friction from wall shear vs mean U; sample 0.4×60=24.',
              formula: {
                expr: 'f_Re = f * Re',
                vars: {
                  f_Re: '摩阻×雷诺积 1',
                  f: 'Darcy 摩阻系数 1',
                  Re: '基于平均速度与水力直径的雷诺数 1',
                },
                sample: { f: 0.4, Re: 60 },
                expected: 24,
                plainZh: '层流平行板通道摩阻与雷诺数之积合成为常数 24',
                plainEn:
                  'Laminar parallel-plate friction–Reynolds product composes to the constant 24',
              },
            },
            {
              id: 'lbm-compose-mach-nu',
              layer: 'foundation',
              titleZh: '合成链：Ma = Re ν / (L c_s)（Ma–ν 链）',
              titleEn: 'Compose chain: Ma = Re ν / (L c_s) (Mach–ν link)',
              bodyZh:
                '把 Re 标定、运动粘度与格子声速合成 Mach：U=Re ν/L，Ma=U/c_s。低 Ma 与 ν(τ) 同链约束顶盖/通道特征速度。算例 Re=60、ν=1/6、L=100、c_s²=1/3 → Ma=0.1/√(1/3)，与 lbm-compose-mach 一致。',
              bodyEn:
                'Links Re, ν, and c_s into Ma: U=Re ν/L, Ma=U/c_s; sample matches lid Ma≈0.173.',
              formula: {
                expr: 'Ma = Re * nu / (L * sqrt(cs2))',
                vars: {
                  Ma: 'Mach 数 1',
                  Re: '雷诺数 1',
                  nu: '运动粘度（格子单位）',
                  L: '特征长度（格子数）',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { Re: 60, nu: 1 / 6, L: 100, cs2: 1 / 3 },
                expected: (60 * (1 / 6)) / (100 * Math.sqrt(1 / 3)),
                plainZh: 'Mach 数由雷诺数、运动粘度、特征长度与格子声速合成',
                plainEn:
                  'Mach number composes from Reynolds number, viscosity, length, and lattice sound speed',
              },
            },
            {
              id: 'lbm-compose-guo-pref',
              layer: 'foundation',
              titleZh: '合成：Guo 力项预因子 (1 − 1/(2τ))',
              titleEn: 'Compose: Guo forcing prefactor (1 − 1/(2τ))',
              bodyZh:
                'Guo 外力格式离散方向力 F_i 的公共预因子 pref=1−1/(2τ)，保证半时间动量修正与 BGK 粘性一致；与 force-channel 体力注入同核。算例 τ=1 → pref=1/2。',
              bodyEn:
                'Guo discrete force shares pref=1−1/(2τ) for half-step momentum consistency with BGK; sample τ=1 → 1/2.',
              formula: {
                expr: 'pref = 1 - 1 / (2 * tau)',
                vars: {
                  pref: 'Guo 力项预因子 1',
                  tau: '松弛时间 τ',
                },
                sample: { tau: 1 },
                expected: 0.5,
                plainZh: 'Guo 外力预因子由松弛时间合成以保证动量修正与粘性一致',
                plainEn:
                  'Guo forcing prefactor composes from relaxation time for momentum–viscosity consistency',
              },
            },
            {
              id: 'lbm-compose-G-match-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：G 反演匹配残差 |G − 8νu_max/H²|',
              titleEn: 'Compose KPI: G-recovery match residual |G − 8νu_max/H²|',
              bodyZh:
                '实现体力与 Poiseuille 反演应合同：给定测得 u_max 与设定 G 一致时残差为 0。连接 force-channel eng residual 与粘度/力项标定。算例完全匹配 → res=0。',
              bodyEn:
                'Implemented G must match Poiseuille recovery from u_max; residual 0 when matched; links force-channel eng residual.',
              formula: {
                expr: 'res = abs(G - 8 * nu * u_max / (H * H))',
                vars: {
                  res: 'G 匹配绝对残差 1',
                  G: '实现单位质量体力',
                  nu: '运动粘度（格子单位）',
                  u_max: '测得峰值速度',
                  H: '通道高度（格子数）',
                },
                sample: {
                  G: (8 * (1 / 6) * 0.1) / (50 * 50),
                  nu: 1 / 6,
                  u_max: 0.1,
                  H: 50,
                },
                expected: 0,
                plainZh: '力驱动通道体力与峰值速度反演合同的残差在匹配时应为零',
                plainEn:
                  'Residual between implemented G and peak-velocity recovery is zero when matched',
              },
            },
            {
              id: 'lbm-compose-umean-poiseuille',
              layer: 'foundation',
              titleZh: '合成：截面平均 u_mean = (2/3) u_max',
              titleEn: 'Compose: section mean u_mean = (2/3) u_max',
              bodyZh:
                '平面 Poiseuille 抛物线剖面：平均速度为峰值的 2/3，进入 Re=u_mean D_h/ν 与 f·Re 标定。算例 u_max=0.1 → u_mean=1/15。',
              bodyEn:
                'Plane Poiseuille parabola: mean is 2/3 of peak; feeds Re and f·Re; sample u_max=0.1 → u_mean=1/15.',
              formula: {
                expr: 'u_mean = (2 / 3) * u_max',
                vars: {
                  u_mean: '截面平均速度',
                  u_max: '通道中心峰值速度',
                },
                sample: { u_max: 0.1 },
                expected: (2 / 3) * 0.1,
                plainZh: '力驱动平行板通道平均速度为峰值速度的三分之二',
                plainEn:
                  'Force-driven parallel-plate mean velocity is two thirds of the peak',
              },
            },
            {
              id: 'lbm-compose-d3q19-weights',
              layer: 'foundation',
              titleZh: '合成：D3Q19 权归一 w0+6w1+12w2 = 1',
              titleEn: 'Compose: D3Q19 weight normalization w0+6w1+12w2 = 1',
              bodyZh:
                '工程三维 D3Q19：静止 w0=1/3、6 个面心 w1=1/18、12 个棱边 w2=1/36；Σw=1 保证均匀静止平衡态 ρ 正确。与 D2Q9 权归一并列，桥接 solvers-lbm 工程轨。',
              bodyEn:
                'Eng D3Q19: rest 1/3, 6 face 1/18, 12 edge 1/36; Σw=1 for rest equilibrium; pairs with D2Q9 weight compose.',
              formula: {
                expr: 'w_sum = w0 + 6 * w1 + 12 * w2',
                vars: {
                  w_sum: '权之和 1',
                  w0: '静止权 1/3',
                  w1: '面心权 1/18',
                  w2: '棱边权 1/36',
                },
                sample: { w0: 1 / 3, w1: 1 / 18, w2: 1 / 36 },
                expected: 1,
                plainZh: 'D3Q19 离散速度权之和必须合成为 1',
                plainEn: 'D3Q19 discrete-velocity weights must compose to sum 1',
              },
            },
            {
              id: 'lbm-compose-tau-from-nu',
              layer: 'foundation',
              titleZh: '合成：τ = ν/c_s² + 1/2（由粘度）',
              titleEn: 'Compose: τ = ν/c_s² + 1/2 from viscosity',
              bodyZh:
                'ν(τ) 的对偶反演：给定运动粘度与格子声速平方合成 BGK 松弛。算例 ν=1/6、c_s²=1/3 → τ=1；与 lbm-compose-nu-tau / tau-match 合同。',
              bodyEn:
                'Dual of ν(τ): recover τ from ν and c_s²; sample τ=1; contracts nu-tau / tau-match.',
              formula: {
                expr: 'tau = nu / cs2 + 0.5',
                vars: {
                  tau: '松弛时间 τ',
                  nu: '运动粘度（格子单位）',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { nu: 1 / 6, cs2: 1 / 3 },
                expected: (1 / 6) / (1 / 3) + 0.5,
                plainZh: '松弛时间由运动粘度与格子声速平方反推合成',
                plainEn:
                  'Relaxation time composes from kinematic viscosity and lattice sound-speed squared',
              },
            },
            {
              id: 'lbm-compose-Dh',
              layer: 'foundation',
              titleZh: '合成：平行板水力直径 D_h = 2 H',
              titleEn: 'Compose: parallel-plate hydraulic diameter D_h = 2 H',
              bodyZh:
                '力驱动通道 Re 与 f·Re 标定用水力直径：无限宽平行板 D_h=2H。算例 H=50 → D_h=100，与腔边长量级对齐便于对照。',
              bodyEn:
                'Force-channel Re and f·Re use D_h=2H for infinite parallel plates; sample H=50 → D_h=100.',
              formula: {
                expr: 'Dh = 2 * H',
                vars: {
                  Dh: '水力直径（格子数）',
                  H: '通道高度（格子数）',
                },
                sample: { H: 50 },
                expected: 100,
                plainZh: '平行板通道水力直径合成为高度的两倍',
                plainEn: 'Parallel-plate hydraulic diameter composes as twice the channel height',
              },
            },
            {
              id: 'lbm-compose-Re-channel',
              layer: 'foundation',
              titleZh: '合成：通道 Re = u_mean D_h / ν',
              titleEn: 'Compose: channel Re = u_mean D_h / ν',
              bodyZh:
                '力驱动通道雷诺数：截面平均速度、水力直径与粘度合成。算例 u_mean=(2/3)·0.1、D_h=100、ν=1/6 → Re=40；进入 f·Re=24 时 f=0.6。',
              bodyEn:
                'Force-channel Re from mean speed, D_h, ν; sample Re=40; with f·Re=24 → f=0.6.',
              formula: {
                expr: 'Re = u_mean * Dh / nu',
                vars: {
                  Re: '通道雷诺数 1',
                  u_mean: '截面平均速度',
                  Dh: '水力直径（格子数）',
                  nu: '运动粘度（格子单位）',
                },
                sample: { u_mean: (2 / 3) * 0.1, Dh: 100, nu: 1 / 6 },
                expected: ((2 / 3) * 0.1 * 100) / (1 / 6),
                plainZh: '力驱动通道雷诺数由平均速度、水力直径与运动粘度合成',
                plainEn:
                  'Force-channel Reynolds number composes mean velocity, hydraulic diameter, and viscosity',
              },
            },
            {
              id: 'lbm-compose-wall-shear',
              layer: 'foundation',
              titleZh: '合成：壁剪 τ_w = ρ G H / 2（力平衡）',
              titleEn: 'Compose: wall shear τ_w = ρ G H / 2 (force balance)',
              bodyZh:
                '稳态平行板：两侧壁剪平衡体力 ρ G H（单位宽度、单位长度）。算例 ρ=1、G=8ν u_max/H²、H=50、ν=1/6、u_max=0.1 → τ_w=G H/2。',
              bodyEn:
                'Steady parallel plates: 2 τ_w = ρ G H per unit width/length; sample ρ=1, Poiseuille G → τ_w=G H/2.',
              formula: {
                expr: 'tau_w = rho * G * H / 2',
                vars: {
                  tau_w: '壁面剪应力（格子单位）',
                  rho: '宏观密度',
                  G: '单位质量体力',
                  H: '通道高度（格子数）',
                },
                sample: {
                  rho: 1,
                  G: (8 * (1 / 6) * 0.1) / (50 * 50),
                  H: 50,
                },
                expected: (1 * ((8 * (1 / 6) * 0.1) / (50 * 50)) * 50) / 2,
                plainZh: '力驱动通道壁面剪应力由密度、体力与高度力平衡合成',
                plainEn:
                  'Force-channel wall shear composes from density, body force, and height via force balance',
              },
            },
            {
              id: 'lbm-compose-dpdx',
              layer: 'foundation',
              titleZh: '合成：压降等价 −∂p/∂x = ρ G',
              titleEn: 'Compose: pressure-gradient equivalence −∂p/∂x = ρ G',
              bodyZh:
                '均匀体力 G 与恒定压降在不可压极限下等价驱动通道。算例 ρ=1、G=8ν u_max/H² → |dp/dx|=ρ G，连接 p=c_s²ρ 弱可压解释与 force-channel 工程。',
              bodyEn:
                'Uniform body force G ≡ constant −∇p at incompressible limit; sample |dp/dx|=ρG; links p=c_s²ρ and force-channel eng.',
              formula: {
                expr: 'dpdx = rho * G',
                vars: {
                  dpdx: '等价压降梯度幅值（格子单位）',
                  rho: '宏观密度',
                  G: '单位质量体力',
                },
                sample: {
                  rho: 1,
                  G: (8 * (1 / 6) * 0.1) / (50 * 50),
                },
                expected: (8 * (1 / 6) * 0.1) / (50 * 50),
                plainZh: '力驱动通道等价压降梯度等于密度乘单位质量体力',
                plainEn:
                  'Force-channel equivalent pressure gradient equals density times body force per mass',
              },
            },
            {
              id: 'lbm-compose-guo-u',
              layer: 'foundation',
              titleZh: '合成：Guo 半步速度 u = (j + F/2) / ρ',
              titleEn: 'Compose: Guo half-step velocity u = (j + F/2) / ρ',
              bodyZh:
                'Guo 外力格式宏观速度用半时间动量修正：F=ρG 时 u=(j+F/2)/ρ，与 pref=1−1/(2τ) 同核保证二阶准确。算例 j=0.09、F=0.02、ρ=1 → u=0.1。',
              bodyEn:
                'Guo macro velocity uses half-step momentum: u=(j+F/2)/ρ with F=ρG; pairs with pref; sample j=0.09,F=0.02,ρ=1 → u=0.1.',
              formula: {
                expr: 'u = (j + 0.5 * F) / rho',
                vars: {
                  u: '宏观速度（格子单位）',
                  j: '分布一阶矩 Σ f_i e_i',
                  F: '体力密度 ρG',
                  rho: '宏观密度',
                },
                sample: { j: 0.09, F: 0.02, rho: 1 },
                expected: (0.09 + 0.5 * 0.02) / 1,
                plainZh: 'Guo 格式宏观速度由动量矩与半步体力修正合成',
                plainEn:
                  'Guo macroscopic velocity composes momentum moment with half-step force correction',
              },
            },
            {
              id: 'lbm-compose-cs',
              layer: 'foundation',
              titleZh: '合成：格子声速 c_s = √c_s²',
              titleEn: 'Compose: lattice sound speed c_s = √c_s²',
              bodyZh:
                '由 c_s²=1/3 合成 c_s，进入 Ma=U/c_s 与低 Ma 闸门。算例 c_s²=1/3 → c_s=√(1/3)。',
              bodyEn:
                'Composes c_s from c_s²=1/3 for Ma=U/c_s and low-Ma gate; sample √(1/3).',
              formula: {
                expr: 'cs = sqrt(cs2)',
                vars: {
                  cs: '格子声速 c_s',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { cs2: 1 / 3 },
                expected: Math.sqrt(1 / 3),
                plainZh: '格子声速等于声速平方的平方根',
                plainEn: 'Lattice sound speed is the square root of sound-speed squared',
              },
            },
            {
              id: 'lbm-compose-f-re-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：f·Re 合同残差 |f·Re − 24|',
              titleEn: 'Compose KPI: f·Re contract residual |f·Re − 24|',
              bodyZh:
                '层流平行板解析 f·Re=24；测得摩阻×雷诺与 24 的绝对残差在匹配时为 0。算例 f=0.4、Re=60 → 完全匹配。',
              bodyEn:
                'Laminar parallel-plate analytic f·Re=24; residual 0 when matched; sample f=0.4, Re=60.',
              formula: {
                expr: 'res = abs(f * Re - 24)',
                vars: {
                  res: 'f·Re 绝对残差 1',
                  f: 'Darcy 摩阻系数 1',
                  Re: '通道雷诺数 1',
                },
                sample: { f: 0.4, Re: 60 },
                expected: 0,
                plainZh: '层流通道摩阻雷诺积与 24 合同的残差在匹配时应为零',
                plainEn:
                  'Residual of friction–Reynolds product versus 24 is zero when the laminar contract matches',
              },
            },
            {
              id: 'lbm-compose-umean-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：平均–峰值残差 |u_mean − (2/3)u_max|',
              titleEn: 'Compose KPI: mean–peak residual |u_mean − (2/3)u_max|',
              bodyZh:
                'Poiseuille 剖面合同：截面平均应为峰值的 2/3。算例 u_mean=1/15、u_max=0.1 → 残差 0；桥接 force-channel 剖面 smoke。',
              bodyEn:
                'Poiseuille profile contract: mean is 2/3 peak; sample residual 0; bridges force-channel profile smoke.',
              formula: {
                expr: 'res = abs(u_mean - (2 / 3) * u_max)',
                vars: {
                  res: '平均–峰值绝对残差 1',
                  u_mean: '截面平均速度',
                  u_max: '通道中心峰值速度',
                },
                sample: { u_mean: (2 / 3) * 0.1, u_max: 0.1 },
                expected: 0,
                plainZh: '通道平均速度与峰值三分之二合同的残差在匹配时应为零',
                plainEn:
                  'Residual between mean velocity and two-thirds peak is zero when the Poiseuille profile matches',
              },
            },
            {
              id: 'lbm-compose-f-darcy',
              layer: 'foundation',
              titleZh: '合成：Darcy 摩阻 f = 24 / Re',
              titleEn: 'Compose: Darcy friction f = 24 / Re',
              bodyZh:
                '由 f·Re=24 反演层流摩阻。算例通道 Re=40 → f=0.6；与 lbm-compose-Re-channel / f-re 对偶。',
              bodyEn:
                'Invert laminar f from f·Re=24; sample Re=40 → f=0.6; dual of Re-channel / f-re.',
              formula: {
                expr: 'f = 24 / Re',
                vars: {
                  f: 'Darcy 摩阻系数 1',
                  Re: '通道雷诺数 1',
                },
                sample: { Re: 40 },
                expected: 24 / 40,
                plainZh: '层流平行板 Darcy 摩阻等于 24 除以通道雷诺数',
                plainEn:
                  'Laminar parallel-plate Darcy friction is 24 divided by channel Reynolds number',
              },
            },
            {
              id: 'lbm-compose-force-density',
              layer: 'foundation',
              titleZh: '合成：体力密度 F = ρ G',
              titleEn: 'Compose: force density F = ρ G',
              bodyZh:
                '单位体积力 F 与单位质量体力 G 由密度合成；进入 Guo 半步 u 与离散力 F_i。算例 ρ=1、G=8ν u_max/H² → F=G。',
              bodyEn:
                'Volume force F=ρG feeds Guo half-step u and discrete F_i; sample ρ=1 → F=G.',
              formula: {
                expr: 'F = rho * G',
                vars: {
                  F: '体力密度（格子单位）',
                  rho: '宏观密度',
                  G: '单位质量体力',
                },
                sample: {
                  rho: 1,
                  G: (8 * (1 / 6) * 0.1) / (50 * 50),
                },
                expected: (8 * (1 / 6) * 0.1) / (50 * 50),
                plainZh: '体力密度等于宏观密度乘单位质量体力',
                plainEn: 'Force density equals macroscopic density times body force per mass',
              },
            },
            {
              id: 'lbm-compose-Q19',
              layer: 'foundation',
              titleZh: '合成：D3Q19 离散速度数 Q = 19',
              titleEn: 'Compose: D3Q19 discrete-velocity count Q = 19',
              bodyZh:
                '工程 kind 拓扑合同：1 静止 + 6 面心 + 12 棱边 = 19 个离散速度；与 D2Q9（Q=9）教学轨对照。算例常数 19。',
              bodyEn:
                'Eng kind topology: 1 rest + 6 face + 12 edge = 19 velocities; contrasts teaching D2Q9 Q=9; sample 19.',
              formula: {
                expr: 'Q = 1 + 6 + 12',
                vars: {
                  Q: '离散速度数 1',
                },
                sample: {},
                expected: 19,
                plainZh: 'D3Q19 离散速度数由静止、面心与棱边方向合成得 19',
                plainEn:
                  'D3Q19 discrete-velocity count composes rest, face, and edge directions to 19',
              },
            },
            {
              id: 'lbm-compose-tau-half-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：τ>1/2 正粘残差 max(0, 1/2−τ)',
              titleEn: 'Compose KPI: τ>1/2 positive-ν residual max(0, 1/2−τ)',
              bodyZh:
                'BGK 要求 τ>1/2 保证 ν>0。算例 τ=1 时残差 0；若 τ≤1/2 则残差为正，标记非法粘性。',
              bodyEn:
                'BGK needs τ>1/2 for ν>0; sample τ=1 → residual 0; τ≤1/2 yields positive residual.',
              formula: {
                expr: 'res = max(0, 0.5 - tau)',
                vars: {
                  res: 'τ 半界违规残差 1',
                  tau: '松弛时间 τ',
                },
                sample: { tau: 1 },
                expected: 0,
                plainZh: '松弛时间大于二分之一时正粘合同残差为零',
                plainEn:
                  'Positive-viscosity contract residual is zero when relaxation time exceeds one half',
              },
            },
            {
              id: 'lbm-compose-G-from-dpdx',
              layer: 'foundation',
              titleZh: '合成：G = (−∂p/∂x) / ρ（压降反演体力）',
              titleEn: 'Compose: G = (−∂p/∂x) / ρ (∇p → body force)',
              bodyZh:
                '压降驱动与体力驱动对偶：由等价压降梯度反演 G。算例 dpdx=ρG 匹配时 G=dpdx/ρ；与 lbm-compose-dpdx 合同。',
              bodyEn:
                'Dual of pressure–force equivalence: recover G from |∇p|; sample matches dpdx compose.',
              formula: {
                expr: 'G = dpdx / rho',
                vars: {
                  G: '单位质量体力',
                  dpdx: '压降梯度幅值（格子单位）',
                  rho: '宏观密度',
                },
                sample: {
                  dpdx: (8 * (1 / 6) * 0.1) / (50 * 50),
                  rho: 1,
                },
                expected: (8 * (1 / 6) * 0.1) / (50 * 50),
                plainZh: '单位质量体力由等价压降梯度与密度反演合成',
                plainEn:
                  'Body force per mass recovers from equivalent pressure gradient over density',
              },
            },
            {
              id: 'lbm-compose-eq-rest',
              layer: 'foundation',
              titleZh: '合成：静止平衡 f_eq,0 = w0 ρ',
              titleEn: 'Compose: rest equilibrium f_eq,0 = w0 ρ',
              bodyZh:
                'u=0 时平衡态 f_eq,i=w_i ρ；静止支路用 D2Q9 w0=4/9。算例 ρ=1 → f_eq,0=4/9；连接矩恢复与 BGK 碰撞。',
              bodyEn:
                'At rest f_eq,i=w_i ρ; rest branch uses D2Q9 w0=4/9; sample ρ=1 → 4/9; links moments and BGK.',
              formula: {
                expr: 'f_eq0 = w0 * rho',
                vars: {
                  f_eq0: '静止方向平衡分布',
                  w0: '静止权 4/9',
                  rho: '宏观密度',
                },
                sample: { w0: 4 / 9, rho: 1 },
                expected: 4 / 9,
                plainZh: '静止平衡分布等于静止权乘宏观密度',
                plainEn: 'Rest equilibrium population is rest weight times macroscopic density',
              },
            },
            {
              id: 'lbm-compose-guo-Fi-cardinal',
              layer: 'foundation',
              titleZh: '合成：Guo 轴向力支 F_i ∝ pref w (e·F)/c_s²',
              titleEn: 'Compose: Guo cardinal force branch F_i ∝ pref w (e·F)/c_s²',
              bodyZh:
                'Guo 离散力一阶支：沿轴向 e·F=|F| 时 F_i = pref · w · (e·F)/c_s²（略二阶 uF 项教学）。算例 pref=1/2、w=1/9、F=0.02、c_s²=1/3 → F_i=pref·w·F/cs2。',
              bodyEn:
                'Guo first-order cardinal branch F_i=pref·w·(e·F)/c_s² (omit uF term for teaching); sample pref=1/2,w=1/9,F=0.02,cs2=1/3.',
              formula: {
                expr: 'Fi = pref * w * F / cs2',
                vars: {
                  Fi: '轴向离散力贡献',
                  pref: 'Guo 预因子 1−1/(2τ)',
                  w: '轴向权 1/9',
                  F: '体力密度（与 e 对齐分量）',
                  cs2: '格子声速平方 c_s²',
                },
                sample: { pref: 0.5, w: 1 / 9, F: 0.02, cs2: 1 / 3 },
                expected: (0.5 * (1 / 9) * 0.02) / (1 / 3),
                plainZh: 'Guo 轴向离散力由预因子、权、体力与声速平方合成',
                plainEn:
                  'Guo cardinal discrete force composes prefactor, weight, force density, and sound-speed squared',
              },
            },
            {
              id: 'lbm-compose-f-re-product-bulk',
              layer: 'foundation',
              titleZh: '合成：p_bb = f_bulk · Re_bulk（匹配 bulk 积）',
              titleEn: 'Compose: p_bb = f_bulk · Re_bulk (matched bulk product)',
              bodyZh:
                '力通道 f·Re 四积之一：bulk 摩阻 × bulk 雷诺。层流金标 p_bb→12。算例 f_b=1.2、Re_b=10 → 12；桥接 S19ba/S19bb quadruple products。',
              bodyEn:
                'One of four f·Re products: bulk friction × bulk Re; laminar gold →12; sample 1.2×10=12; bridges S19ba/S19bb.',
              formula: {
                expr: 'p_bb = f_bulk * Re_bulk',
                vars: {
                  p_bb: '匹配 bulk f·Re 积 1',
                  f_bulk: 'bulk Darcy 摩阻 1',
                  Re_bulk: 'bulk 雷诺数 1',
                },
                sample: { f_bulk: 1.2, Re_bulk: 10 },
                expected: 12,
                plainZh: '匹配 bulk 摩阻雷诺积等于 bulk 摩阻乘 bulk 雷诺数',
                plainEn:
                  'Matched bulk friction–Reynolds product is bulk friction times bulk Reynolds number',
              },
            },
            {
              id: 'lbm-compose-f-re-product-peak',
              layer: 'foundation',
              titleZh: '合成：p_pp = f_peak · Re_peak（匹配 peak 积）',
              titleEn: 'Compose: p_pp = f_peak · Re_peak (matched peak product)',
              bodyZh:
                '四积对偶：peak 摩阻 × peak 雷诺。金标 p_pp→12。算例 f_p=0.8、Re_p=15 → 12；与 p_bb 匹配时 GM=HM=AM=12。',
              bodyEn:
                'Dual peak product f_peak×Re_peak; gold →12; sample 0.8×15=12; matched with p_bb yields AM=GM=HM=12.',
              formula: {
                expr: 'p_pp = f_peak * Re_peak',
                vars: {
                  p_pp: '匹配 peak f·Re 积 1',
                  f_peak: 'peak Darcy 摩阻 1',
                  Re_peak: 'peak 雷诺数 1',
                },
                sample: { f_peak: 0.8, Re_peak: 15 },
                expected: 12,
                plainZh: '匹配 peak 摩阻雷诺积等于 peak 摩阻乘 peak 雷诺数',
                plainEn:
                  'Matched peak friction–Reynolds product is peak friction times peak Reynolds number',
              },
            },
            {
              id: 'lbm-compose-f-re-product-cross-bp',
              layer: 'foundation',
              titleZh: '合成：p_bp = f_bulk · Re_peak（交叉 bulk–peak 积）',
              titleEn: 'Compose: p_bp = f_bulk · Re_peak (cross bulk–peak product)',
              bodyZh:
                '交叉四积：bulk 摩阻 × peak 雷诺。算例 1.2×15=18；与 p_pb 配对进入 AM/GM/HM 梯。桥接 S19bb cross means。',
              bodyEn:
                'Cross product bulk friction × peak Re; sample 18; pairs with p_pb into AM/GM/HM ladder; bridges S19bb.',
              formula: {
                expr: 'p_bp = f_bulk * Re_peak',
                vars: {
                  p_bp: '交叉 bulk–peak f·Re 积 1',
                  f_bulk: 'bulk Darcy 摩阻 1',
                  Re_peak: 'peak 雷诺数 1',
                },
                sample: { f_bulk: 1.2, Re_peak: 15 },
                expected: 18,
                plainZh: '交叉 bulk–peak 摩阻雷诺积等于 bulk 摩阻乘 peak 雷诺数',
                plainEn:
                  'Cross bulk–peak friction–Reynolds product is bulk friction times peak Reynolds number',
              },
            },
            {
              id: 'lbm-compose-f-re-product-cross-pb',
              layer: 'foundation',
              titleZh: '合成：p_pb = f_peak · Re_bulk（交叉 peak–bulk 积）',
              titleEn: 'Compose: p_pb = f_peak · Re_bulk (cross peak–bulk product)',
              bodyZh:
                '交叉四积对偶：peak 摩阻 × bulk 雷诺。算例 0.8×10=8；p_bp·p_pb=144=12·12 与匹配 GM 合同。',
              bodyEn:
                'Dual cross product peak friction × bulk Re; sample 8; p_bp·p_pb=144=12·12 matches matched GM identity.',
              formula: {
                expr: 'p_pb = f_peak * Re_bulk',
                vars: {
                  p_pb: '交叉 peak–bulk f·Re 积 1',
                  f_peak: 'peak Darcy 摩阻 1',
                  Re_bulk: 'bulk 雷诺数 1',
                },
                sample: { f_peak: 0.8, Re_bulk: 10 },
                expected: 8,
                plainZh: '交叉 peak–bulk 摩阻雷诺积等于 peak 摩阻乘 bulk 雷诺数',
                plainEn:
                  'Cross peak–bulk friction–Reynolds product is peak friction times bulk Reynolds number',
              },
            },
            {
              id: 'lbm-compose-AM',
              layer: 'foundation',
              titleZh: '合成：算术均值 AM = (a + b) / 2',
              titleEn: 'Compose: arithmetic mean AM = (a + b) / 2',
              bodyZh:
                'S19bb 均值梯顶端：交叉积对 (p_bp, p_pb) 的算术均值。算例 a=18、b=8 → AM=13；金标 12 时 AM 残差 |13−12|/12=1/12。',
              bodyEn:
                'Top of S19bb mean ladder: AM of cross products; sample 18,8 → 13; gold 12 → residual 1/12.',
              formula: {
                expr: 'AM = (a + b) / 2',
                vars: {
                  AM: '算术均值 1',
                  a: '第一积（如 p_bp）',
                  b: '第二积（如 p_pb）',
                },
                sample: { a: 18, b: 8 },
                expected: 13,
                plainZh: '算术均值等于两积之和的一半',
                plainEn: 'Arithmetic mean is half the sum of the two products',
              },
            },
            {
              id: 'lbm-compose-GM',
              layer: 'foundation',
              titleZh: '合成：几何均值 GM = √(a · b)',
              titleEn: 'Compose: geometric mean GM = √(a · b)',
              bodyZh:
                'S19ba/S19bb 几何层：交叉积对几何均值。算例 √(18·8)=12；与匹配 √(p_bb·p_pp) 代数同构时 GM 恒等。',
              bodyEn:
                'Geometric layer: √(a·b); sample √(18·8)=12; algebraically matches √(p_bb·p_pp) when products form a rectangle.',
              formula: {
                expr: 'GM = sqrt(a * b)',
                vars: {
                  GM: '几何均值 1',
                  a: '第一积',
                  b: '第二积',
                },
                sample: { a: 18, b: 8 },
                expected: 12,
                plainZh: '几何均值等于两积之积的平方根',
                plainEn: 'Geometric mean is the square root of the product of the two products',
              },
            },
            {
              id: 'lbm-compose-HM',
              layer: 'foundation',
              titleZh: '合成：调和均值 HM = 2 a b / (a + b)',
              titleEn: 'Compose: harmonic mean HM = 2 a b / (a + b)',
              bodyZh:
                'S19bb 调和层：H(a,b)=2ab/(a+b)。算例 a=18、b=8 → HM=288/26≈11.077；完成 AM≥GM≥HM 梯。',
              bodyEn:
                'Harmonic layer H=2ab/(a+b); sample 18,8 → 288/26; completes AM≥GM≥HM ladder.',
              formula: {
                expr: 'HM = 2 * a * b / (a + b)',
                vars: {
                  HM: '调和均值 1',
                  a: '第一积',
                  b: '第二积',
                },
                sample: { a: 18, b: 8 },
                expected: (2 * 18 * 8) / (18 + 8),
                plainZh: '调和均值等于两倍两积之积除以两积之和',
                plainEn:
                  'Harmonic mean is twice the product of the two values over their sum',
              },
            },
            {
              id: 'lbm-compose-AM-GM-HM-ladder',
              layer: 'foundation',
              titleZh: '合成 KPI：AM−HM 梯跨度（AM≥GM≥HM 诚实）',
              titleEn: 'Compose KPI: AM−HM ladder span (AM≥GM≥HM honesty)',
              bodyZh:
                '均值诚实：AM≥GM≥HM 时 AM−HM≥0。算例 AM=13、HM=288/26 → 跨度 13−288/26；匹配对 (12,12) 跨度为 0。桥接 S19bb ladder honesty。',
              bodyEn:
                'Mean honesty: AM−HM≥0 under AM≥GM≥HM; sample 13−288/26; matched (12,12) → 0; bridges S19bb ladder.',
              formula: {
                expr: 'span = AM - HM',
                vars: {
                  span: 'AM−HM 梯跨度 1',
                  AM: '算术均值',
                  HM: '调和均值',
                },
                sample: { AM: 13, HM: (2 * 18 * 8) / (18 + 8) },
                expected: 13 - (2 * 18 * 8) / (18 + 8),
                plainZh: '算术与调和均值之差给出 AM≥GM≥HM 诚实梯跨度',
                plainEn:
                  'Arithmetic-minus-harmonic span measures the AM≥GM≥HM honesty ladder',
              },
            },
            {
              id: 'lbm-compose-cross-geometric-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：交叉几何残差 |GM − 12| / 12',
              titleEn: 'Compose KPI: cross geometric residual |GM − 12| / 12',
              bodyZh:
                'S19ba 交叉几何诚实：|√(p_bp·p_pb)−12|/12。算例 GM=12 → 残差 0；匹配几何对偶同构。桥接 S19ba cross geometric。',
              bodyEn:
                'S19ba cross geometric honesty |√(p_bp·p_pb)−12|/12; sample GM=12 → 0; dual of matched geometric.',
              formula: {
                expr: 'res = abs(GM - 12) / 12',
                vars: {
                  res: '交叉几何相对残差 1',
                  GM: '交叉积几何均值',
                },
                sample: { GM: 12 },
                expected: 0,
                plainZh: '交叉几何残差等于几何均值相对金标 12 的偏差比',
                plainEn:
                  'Cross geometric residual is the relative deviation of GM from the gold product 12',
              },
            },
            {
              id: 'lbm-compose-cross-harmonic-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：交叉调和残差 |HM − 12| / 12',
              titleEn: 'Compose KPI: cross harmonic residual |HM − 12| / 12',
              bodyZh:
                'S19bb 交叉调和诚实：|H(p_bp,p_pb)−12|/12，几何层之后的均值封装。算例 HM=288/26 → |HM−12|/12；与 matched harmonic 对偶。',
              bodyEn:
                'S19bb cross harmonic |H(p_bp,p_pb)−12|/12 after geometric packaging; sample HM=288/26; dual of matched harmonic.',
              formula: {
                expr: 'res = abs(HM - 12) / 12',
                vars: {
                  res: '交叉调和相对残差 1',
                  HM: '交叉积调和均值',
                },
                sample: { HM: (2 * 18 * 8) / (18 + 8) },
                expected: Math.abs((2 * 18 * 8) / (18 + 8) - 12) / 12,
                plainZh: '交叉调和残差等于调和均值相对金标 12 的偏差比',
                plainEn:
                  'Cross harmonic residual is the relative deviation of HM from the gold product 12',
              },
            },
            {
              id: 'lbm-compose-matched-harmonic-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：匹配调和残差 |H(p_bb,p_pp) − 12| / 12',
              titleEn: 'Compose KPI: matched harmonic residual |H(p_bb,p_pp) − 12| / 12',
              bodyZh:
                'S19bb 匹配调和 extract：|H(p_bb,p_pp)−12|/12，交叉调和的 dual。算例 p_bb=p_pp=12 → H=12 → 残差 0。',
              bodyEn:
                'S19bb matched harmonic extract dual of cross harmonic; sample p_bb=p_pp=12 → residual 0.',
              formula: {
                expr: 'res = abs(HM_m - 12) / 12',
                vars: {
                  res: '匹配调和相对残差 1',
                  HM_m: '匹配积对 (p_bb,p_pp) 调和均值',
                },
                sample: { HM_m: 12 },
                expected: 0,
                plainZh: '匹配调和残差在 bulk/peak 积均等于 12 时为零',
                plainEn:
                  'Matched harmonic residual is zero when bulk and peak products both equal 12',
              },
            },
            {
              id: 'lbm-compose-cross-arithmetic-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：交叉算术残差 |AM − 12| / 12',
              titleEn: 'Compose KPI: cross arithmetic residual |AM − 12| / 12',
              bodyZh:
                'S19bb 交叉算术诚实：|(p_bp+p_pb)/2−12|/12，完成 AM 封装（对偶 matched arithmetic）。算例 AM=13 → 残差 1/12。',
              bodyEn:
                'S19bb cross arithmetic |(p_bp+p_pb)/2−12|/12 completes AM packaging; sample AM=13 → 1/12; dual of matched AM.',
              formula: {
                expr: 'res = abs(AM - 12) / 12',
                vars: {
                  res: '交叉算术相对残差 1',
                  AM: '交叉积算术均值',
                },
                sample: { AM: 13 },
                expected: Math.abs(13 - 12) / 12,
                plainZh: '交叉算术残差等于算术均值相对金标 12 的偏差比',
                plainEn:
                  'Cross arithmetic residual is the relative deviation of AM from the gold product 12',
              },
            },
            {
              id: 'lbm-compose-GM-identity-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：GM 恒等残差 |GM_cross − GM_matched|',
              titleEn: 'Compose KPI: GM identity residual |GM_cross − GM_matched|',
              bodyZh:
                '四积矩形合同：√(p_bp·p_pb) 应等于 √(p_bb·p_pp)。算例两者均为 12 → 残差 0；S19bb pure helper 金标。',
              bodyEn:
                'Quadruple rectangle: √(p_bp·p_pb)=√(p_bb·p_pp); sample both 12 → residual 0; S19bb pure-helper gold.',
              formula: {
                expr: 'res = abs(GM_cross - GM_matched)',
                vars: {
                  res: 'GM 恒等残差 1',
                  GM_cross: '交叉积几何均值',
                  GM_matched: '匹配积几何均值',
                },
                sample: { GM_cross: 12, GM_matched: 12 },
                expected: 0,
                plainZh: '交叉与匹配几何均值之差为零时四积 GM 恒等成立',
                plainEn:
                  'GM identity holds when cross and matched geometric means agree',
              },
            },
            {
              id: 'lbm-compose-matched-AM',
              layer: 'foundation',
              titleZh: '合成：匹配算术均值 AM_m = (p_bb + p_pp) / 2',
              titleEn: 'Compose: matched arithmetic mean AM_m = (p_bb + p_pp) / 2',
              bodyZh:
                '匹配积对算术均值；p_bb=p_pp=12 时 AM_m=12。算例 12、12 → 12；与交叉 AM 对偶闭合 S19bb AM 封装。',
              bodyEn:
                'Matched-pair AM; sample 12,12 → 12; dual of cross AM closes S19bb AM packaging.',
              formula: {
                expr: 'AM_m = (p_bb + p_pp) / 2',
                vars: {
                  AM_m: '匹配算术均值 1',
                  p_bb: 'bulk f·Re 积',
                  p_pp: 'peak f·Re 积',
                },
                sample: { p_bb: 12, p_pp: 12 },
                expected: 12,
                plainZh: '匹配算术均值等于 bulk 与 peak 摩阻雷诺积之和的一半',
                plainEn:
                  'Matched arithmetic mean is half the sum of bulk and peak friction–Reynolds products',
              },
            },
            {
              id: 'lbm-compose-AM-GM-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：AM−GM 间隙（非负诚实）',
              titleEn: 'Compose KPI: AM−GM gap (non-negative honesty)',
              bodyZh:
                'AM≥GM 时间隙 AM−GM≥0。算例 13−12=1；匹配等积时间隙 0。与 GM−HM 共同支撑 S19bb 梯。',
              bodyEn:
                'AM−GM≥0 under AM≥GM; sample 13−12=1; zero when equal; supports S19bb ladder with GM−HM.',
              formula: {
                expr: 'gap = AM - GM',
                vars: {
                  gap: 'AM−GM 间隙 1',
                  AM: '算术均值',
                  GM: '几何均值',
                },
                sample: { AM: 13, GM: 12 },
                expected: 1,
                plainZh: '算术与几何均值之差给出 AM≥GM 非负诚实间隙',
                plainEn:
                  'Arithmetic-minus-geometric gap is the non-negative AM≥GM honesty measure',
              },
            },
            {
              id: 'lbm-compose-GM-HM-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：GM−HM 间隙（非负诚实）',
              titleEn: 'Compose KPI: GM−HM gap (non-negative honesty)',
              bodyZh:
                'GM≥HM 时间隙 GM−HM≥0。算例 12−288/26；匹配等积时 0。完成 AM≥GM≥HM 下半梯。',
              bodyEn:
                'GM−HM≥0 under GM≥HM; sample 12−288/26; zero when equal; lower half of AM≥GM≥HM ladder.',
              formula: {
                expr: 'gap = GM - HM',
                vars: {
                  gap: 'GM−HM 间隙 1',
                  GM: '几何均值',
                  HM: '调和均值',
                },
                sample: { GM: 12, HM: (2 * 18 * 8) / (18 + 8) },
                expected: 12 - (2 * 18 * 8) / (18 + 8),
                plainZh: '几何与调和均值之差给出 GM≥HM 非负诚实间隙',
                plainEn:
                  'Geometric-minus-harmonic gap is the non-negative GM≥HM honesty measure',
              },
            },
            // S19bd/S19be force-channel means dual residual packaging (wave28 residual compose expand)
            {
              id: 'lbm-compose-matched-GM',
              layer: 'foundation',
              titleZh: '合成：匹配几何均值 GM_m = √(p_bb · p_pp)',
              titleEn: 'Compose: matched geometric mean GM_m = √(p_bb · p_pp)',
              bodyZh:
                'S19bd 匹配均值三元组：GM_m=√(p_bb·p_pp)。算例 p_bb=p_pp=12 → GM_m=12；与交叉 GM 代数同构时 dual→0。桥接 means dual packaging。',
              bodyEn:
                'S19bd matched means triad GM_m=√(p_bb·p_pp); sample 12,12 → 12; dual→0 when isomorphic to cross GM; bridges means dual packaging.',
              formula: {
                expr: 'GM_m = sqrt(p_bb * p_pp)',
                vars: {
                  GM_m: '匹配几何均值 1',
                  p_bb: 'bulk f·Re 积',
                  p_pp: 'peak f·Re 积',
                },
                sample: { p_bb: 12, p_pp: 12 },
                expected: 12,
                plainZh: '匹配几何均值等于 bulk 与 peak 摩阻雷诺积之积的平方根',
                plainEn:
                  'Matched geometric mean is the square root of the product of bulk and peak friction–Reynolds products',
              },
            },
            {
              id: 'lbm-compose-matched-HM',
              layer: 'foundation',
              titleZh: '合成：匹配调和均值 HM_m = 2 p_bb p_pp / (p_bb + p_pp)',
              titleEn: 'Compose: matched harmonic mean HM_m = 2 p_bb p_pp / (p_bb + p_pp)',
              bodyZh:
                'S19bd 匹配调和：HM_m=2 p_bb p_pp/(p_bb+p_pp)。算例 12、12 → 12；与交叉 HM 配对进入 means dual。',
              bodyEn:
                'S19bd matched harmonic HM_m; sample 12,12 → 12; pairs with cross HM into means dual.',
              formula: {
                expr: 'HM_m = 2 * p_bb * p_pp / (p_bb + p_pp)',
                vars: {
                  HM_m: '匹配调和均值 1',
                  p_bb: 'bulk f·Re 积',
                  p_pp: 'peak f·Re 积',
                },
                sample: { p_bb: 12, p_pp: 12 },
                expected: 12,
                plainZh: '匹配调和均值等于两倍 bulk·peak 积除以 bulk 与 peak 积之和',
                plainEn:
                  'Matched harmonic mean is twice the bulk·peak product over the sum of bulk and peak products',
              },
            },
            {
              id: 'lbm-compose-matched-means-AM-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：匹配算术残差 |AM_m − 12| / 12',
              titleEn: 'Compose KPI: matched arithmetic residual |AM_m − 12| / 12',
              bodyZh:
                'S19bd matched means residual matrix 对角入口：|AM_m−12|/12。金标匹配 p_bb=p_pp=12 → AM_m=12 → 残差 0。',
              bodyEn:
                'S19bd matched means residual matrix diagonal: |AM_m−12|/12; gold matched → 0.',
              formula: {
                expr: 'res = abs(AM_m - 12) / 12',
                vars: {
                  res: '匹配算术相对残差 1',
                  AM_m: '匹配算术均值',
                },
                sample: { AM_m: 12 },
                expected: 0,
                plainZh: '匹配算术残差等于匹配算术均值相对金标 12 的偏差比',
                plainEn:
                  'Matched arithmetic residual is the relative deviation of matched AM from the gold product 12',
              },
            },
            {
              id: 'lbm-compose-means-dual-AM',
              layer: 'foundation',
              titleZh: '合成 KPI：cross↔matched AM dual |AM_m − AM_c| / 12',
              titleEn: 'Compose KPI: cross↔matched AM dual |AM_m − AM_c| / 12',
              bodyZh:
                'S19bd/S19be means dual：d_AM=|AM_m−AM_c|/12。算例 AM_m=12、AM_c=13 → 1/12；桥接 force-channel means dual residual packaging。',
              bodyEn:
                'S19bd/S19be means dual d_AM=|AM_m−AM_c|/12; sample 12 vs 13 → 1/12; bridges force-channel means dual residual packaging.',
              formula: {
                expr: 'd_AM = abs(AM_m - AM_c) / 12',
                vars: {
                  d_AM: 'AM dual 相对残差 1',
                  AM_m: '匹配算术均值',
                  AM_c: '交叉算术均值',
                },
                sample: { AM_m: 12, AM_c: 13 },
                expected: 1 / 12,
                plainZh: '匹配与交叉算术均值之差的相对残差衡量 AM means dual',
                plainEn:
                  'Relative residual between matched and cross arithmetic means measures AM means dual honesty',
              },
            },
            {
              id: 'lbm-compose-means-dual-GM',
              layer: 'foundation',
              titleZh: '合成 KPI：cross↔matched GM dual |GM_m − GM_c| / 12',
              titleEn: 'Compose KPI: cross↔matched GM dual |GM_m − GM_c| / 12',
              bodyZh:
                'S19be GM dual 完成 AM/GM/HM 三元组：|GM_m−GM_c|/12。四积矩形合同时代数恒为 0。算例 GM_m=GM_c=12 → 0。',
              bodyEn:
                'S19be GM dual completes AM/GM/HM triad; algebraically 0 under product identity; sample matched → 0.',
              formula: {
                expr: 'd_GM = abs(GM_m - GM_c) / 12',
                vars: {
                  d_GM: 'GM dual 相对残差 1',
                  GM_m: '匹配几何均值',
                  GM_c: '交叉几何均值',
                },
                sample: { GM_m: 12, GM_c: 12 },
                expected: 0,
                plainZh: '匹配与交叉几何均值 dual 在四积矩形合同时代数为零',
                plainEn:
                  'Matched–cross geometric dual is algebraically zero under the quadruple product rectangle identity',
              },
            },
            {
              id: 'lbm-compose-means-dual-HM',
              layer: 'foundation',
              titleZh: '合成 KPI：cross↔matched HM dual |HM_m − HM_c| / 12',
              titleEn: 'Compose KPI: cross↔matched HM dual |HM_m − HM_c| / 12',
              bodyZh:
                'S19bd/S19be HM dual：|HM_m−HM_c|/12。算例 HM_m=12、HM_c=288/26 → |12−288/26|/12；与 AM dual 组成 envelope。',
              bodyEn:
                'S19bd/S19be HM dual |HM_m−HM_c|/12; sample 12 vs 288/26; pairs with AM dual into envelope.',
              formula: {
                expr: 'd_HM = abs(HM_m - HM_c) / 12',
                vars: {
                  d_HM: 'HM dual 相对残差 1',
                  HM_m: '匹配调和均值',
                  HM_c: '交叉调和均值',
                },
                sample: { HM_m: 12, HM_c: (2 * 18 * 8) / (18 + 8) },
                expected: Math.abs(12 - (2 * 18 * 8) / (18 + 8)) / 12,
                plainZh: '匹配与交叉调和均值之差的相对残差衡量 HM means dual',
                plainEn:
                  'Relative residual between matched and cross harmonic means measures HM means dual honesty',
              },
            },
            {
              id: 'lbm-compose-means-dual-max',
              layer: 'foundation',
              titleZh: '合成 KPI：means dual max max(d_AM,d_GM,d_HM)/12 包络',
              titleEn: 'Compose KPI: means dual max max(d_AM,d_GM,d_HM)/12 envelope',
              bodyZh:
                'S19be means dual residual max extract：max(|AM_m−AM_c|,|GM_m−GM_c|,|HM_m−HM_c|)/12。算例 max(1,0,|12−288/26|)/12=1/12；桥接 dual residual envelope。',
              bodyEn:
                'S19be means dual max extract max(abs duals)/12; sample max(1,0,|12−288/26|)/12=1/12; bridges dual residual envelope.',
              formula: {
                expr: 'd_max = max(abs_AM, abs_GM, abs_HM) / 12',
                vars: {
                  d_max: 'means dual 最大相对残差 1',
                  abs_AM: '|AM_m − AM_c| 绝对 dual',
                  abs_GM: '|GM_m − GM_c| 绝对 dual',
                  abs_HM: '|HM_m − HM_c| 绝对 dual',
                },
                sample: {
                  abs_AM: 1,
                  abs_GM: 0,
                  abs_HM: Math.abs(12 - (2 * 18 * 8) / (18 + 8)),
                },
                expected:
                  Math.max(1, 0, Math.abs(12 - (2 * 18 * 8) / (18 + 8))) / 12,
                plainZh: 'means dual 最大相对残差取三路绝对 dual 上确界再除以金标 12',
                plainEn:
                  'Means dual max relative residual is the upper envelope of three absolute duals over the gold product 12',
              },
            },
            {
              id: 'lbm-compose-means-dual-matrix-offdiag',
              layer: 'foundation',
              titleZh: '合成 KPI：means dual 矩阵非对角 |d_i − d_j| / 12',
              titleEn: 'Compose KPI: means dual matrix off-diagonal |d_i − d_j| / 12',
              bodyZh:
                'S19be means dual residual matrix：d 向量 (d_AM,d_GM,d_HM) 的相对残差矩阵非对角 max |d_i−d_j|/12。算例 d=(1,0,|12−288/26|) → |1−0|/12=1/12。',
              bodyEn:
                'S19be means dual residual matrix off-diagonal max |d_i−d_j|/12; sample |1−0|/12=1/12.',
              formula: {
                expr: 'res = abs(d_i - d_j) / 12',
                vars: {
                  res: 'dual 矩阵非对角相对残差 1',
                  d_i: '第 i 路绝对 dual（如 d_AM）',
                  d_j: '第 j 路绝对 dual（如 d_GM）',
                },
                sample: { d_i: 1, d_j: 0 },
                expected: 1 / 12,
                plainZh: 'means dual 残差矩阵非对角元衡量各 dual 路之间的相对离散',
                plainEn:
                  'Means dual residual matrix off-diagonal measures relative spread among dual absolute residuals',
              },
            },
            {
              id: 'lbm-compose-means-dual-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：meansDualHonest 联合门（0/1）',
              titleEn: 'Compose KPI: meansDualHonest joint gate (0/1)',
              bodyZh:
                'S19be packaging：matched means residual→0 ∧ GM dual→0 ∧ means dual max 在容差内 ∧ AM≥GM≥HM 梯诚实。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19be packaging: matched means residual→0 ∧ GM dual→0 ∧ dual max in tol ∧ AM≥GM≥HM ladder; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_match * c_GM * c_max * c_ladder',
                vars: {
                  gate: 'means dual 包装诚实门 0/1',
                  c_match: 'matched means residual 诚实 0/1',
                  c_GM: 'GM dual 代数零 诚实 0/1',
                  c_max: 'means dual max 容差 诚实 0/1',
                  c_ladder: 'AM≥GM≥HM 梯 诚实 0/1',
                },
                sample: { c_match: 1, c_GM: 1, c_max: 1, c_ladder: 1 },
                expected: 1,
                plainZh: 'means dual 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Means dual packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            // S19bf means dual envelope min/RMS/max + residual matrix (wave29 residual compose expand)
            {
              id: 'lbm-compose-means-dual-min',
              layer: 'foundation',
              titleZh: '合成 KPI：means dual min min(d_AM,d_GM,d_HM)/12 下包络',
              titleEn: 'Compose KPI: means dual min min(d_AM,d_GM,d_HM)/12 lower envelope',
              bodyZh:
                'S19bf dual envelope 下端：min(|AM_m−AM_c|,|GM_m−GM_c|,|HM_m−HM_c|)/12。算例 min(1,0,|12−288/26|)/12=0；与 dual max 组成 envelope 端点。',
              bodyEn:
                'S19bf dual envelope lower end min(abs duals)/12; sample min(1,0,|12−288/26|)/12=0; pairs with dual max as envelope ends.',
              formula: {
                expr: 'd_min = min(abs_AM, abs_GM, abs_HM) / 12',
                vars: {
                  d_min: 'means dual 最小相对残差 1',
                  abs_AM: '|AM_m − AM_c| 绝对 dual',
                  abs_GM: '|GM_m − GM_c| 绝对 dual',
                  abs_HM: '|HM_m − HM_c| 绝对 dual',
                },
                sample: {
                  abs_AM: 1,
                  abs_GM: 0,
                  abs_HM: Math.abs(12 - (2 * 18 * 8) / (18 + 8)),
                },
                expected:
                  Math.min(1, 0, Math.abs(12 - (2 * 18 * 8) / (18 + 8))) / 12,
                plainZh: 'means dual 最小相对残差取三路绝对 dual 下确界再除以金标 12',
                plainEn:
                  'Means dual min relative residual is the lower envelope of three absolute duals over the gold product 12',
              },
            },
            {
              id: 'lbm-compose-means-dual-rms',
              layer: 'foundation',
              titleZh: '合成 KPI：means dual RMS √((d_AM²+d_GM²+d_HM²)/3)/12',
              titleEn: 'Compose KPI: means dual RMS √((d_AM²+d_GM²+d_HM²)/3)/12',
              bodyZh:
                'S19bf dual envelope 能量中心：三路绝对 dual 的 RMS 再除以 12。算例 abs=(1,0,|12−288/26|) → RMS/12；桥接 dual residual energy envelope。',
              bodyEn:
                'S19bf dual envelope energy center: RMS of three absolute duals over 12; sample abs=(1,0,|12−288/26|); bridges dual residual energy envelope.',
              formula: {
                expr: 'd_rms = sqrt((abs_AM*abs_AM + abs_GM*abs_GM + abs_HM*abs_HM) / 3) / 12',
                vars: {
                  d_rms: 'means dual RMS 相对残差 1',
                  abs_AM: '|AM_m − AM_c| 绝对 dual',
                  abs_GM: '|GM_m − GM_c| 绝对 dual',
                  abs_HM: '|HM_m − HM_c| 绝对 dual',
                },
                sample: {
                  abs_AM: 1,
                  abs_GM: 0,
                  abs_HM: Math.abs(12 - (2 * 18 * 8) / (18 + 8)),
                },
                expected:
                  Math.sqrt(
                    (1 * 1 +
                      0 * 0 +
                      Math.pow(Math.abs(12 - (2 * 18 * 8) / (18 + 8)), 2)) /
                      3,
                  ) / 12,
                plainZh: 'means dual RMS 相对残差由三路绝对 dual 均方根再除以金标 12',
                plainEn:
                  'Means dual RMS relative residual is the root-mean-square of three absolute duals over the gold product 12',
              },
            },
            {
              id: 'lbm-compose-means-dual-envelope-span',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope span = (d_max − d_min) 双端跨度',
              titleEn: 'Compose KPI: envelope span = (d_max − d_min) dual span',
              bodyZh:
                'S19bf：dual 包络跨度 max_abs−min_abs 再 /12。算例 max=1、min=0 → span=1/12；紧致诚实包跨度→0。',
              bodyEn:
                'S19bf dual envelope span (max_abs−min_abs)/12; sample 1−0 → 1/12; tight honest pack → 0.',
              formula: {
                expr: 'span = (abs_max - abs_min) / 12',
                vars: {
                  span: 'means dual 包络相对跨度 1',
                  abs_max: '三路绝对 dual 上确界',
                  abs_min: '三路绝对 dual 下确界',
                },
                sample: { abs_max: 1, abs_min: 0 },
                expected: 1 / 12,
                plainZh: 'means dual 包络跨度等于绝对 dual 上下确界之差除以金标 12',
                plainEn:
                  'Means dual envelope span is the absolute dual upper-minus-lower bound over the gold product 12',
              },
            },
            {
              id: 'lbm-compose-means-dual-envelope-crest',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope crest = d_max / max(d_rms, ε)',
              titleEn: 'Compose KPI: envelope crest = d_max / max(d_rms, ε)',
              bodyZh:
                'S19bf 峰均比：绝对 dual 上确界相对 RMS。算例 abs_max=1、d_rms_abs=√((1+0+h²)/3) → crest=1/RMS_abs；诚实紧致包 crest→1。',
              bodyEn:
                'S19bf crest factor max_abs/RMS_abs; sample max=1 over RMS of (1,0,|12−288/26|); tight pack crest→1.',
              formula: {
                expr: 'crest = abs_max / max(rms_abs, eps)',
                vars: {
                  crest: 'means dual 包络峰均比 1',
                  abs_max: '三路绝对 dual 上确界',
                  rms_abs: '三路绝对 dual RMS',
                  eps: '防除零下界',
                },
                sample: {
                  abs_max: 1,
                  rms_abs: Math.sqrt(
                    (1 * 1 +
                      0 * 0 +
                      Math.pow(Math.abs(12 - (2 * 18 * 8) / (18 + 8)), 2)) /
                      3,
                  ),
                  eps: 1e-12,
                },
                expected:
                  1 /
                  Math.sqrt(
                    (1 * 1 +
                      0 * 0 +
                      Math.pow(Math.abs(12 - (2 * 18 * 8) / (18 + 8)), 2)) /
                      3,
                  ),
                plainZh: 'means dual 包络峰均比等于绝对 dual 上确界除以 RMS',
                plainEn:
                  'Means dual envelope crest is absolute dual upper bound over RMS of the three duals',
              },
            },
            {
              id: 'lbm-compose-envelope-matrix-diag',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope 残差矩阵对角 |e_i − e_i^ref| / 12',
              titleEn: 'Compose KPI: envelope residual matrix diagonal |e_i − e_i^ref| / 12',
              bodyZh:
                'S19bf envelope residual matrix 对角：对 (min,RMS,max) 向量相对参考。教学金标 e_min^ref=0 → |0−0|/12=0；桥接 dual envelope residual matrix。',
              bodyEn:
                'S19bf envelope residual matrix diagonal for (min,RMS,max) vs ref; gold e_min^ref=0 → 0; bridges dual envelope residual matrix.',
              formula: {
                expr: 'res = abs(e_i - e_i_ref) / 12',
                vars: {
                  res: 'envelope 矩阵对角相对残差 1',
                  e_i: '包络分量（min/RMS/max 绝对）',
                  e_i_ref: '参考包络分量',
                },
                sample: { e_i: 0, e_i_ref: 0 },
                expected: 0,
                plainZh: 'envelope 残差矩阵对角元衡量包络分量相对参考的偏差',
                plainEn:
                  'Envelope residual matrix diagonal measures envelope-component deviation from reference',
              },
            },
            {
              id: 'lbm-compose-envelope-matrix-offdiag',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope 残差矩阵非对角 |e_i − e_j| / 12',
              titleEn: 'Compose KPI: envelope residual matrix off-diagonal |e_i − e_j| / 12',
              bodyZh:
                'S19bf envelope residual matrix 非对角：min/RMS/max 分量两两差 /12。算例 e_max=1、e_min=0 → |1−0|/12=1/12；桥接 dual envelope spread。',
              bodyEn:
                'S19bf envelope residual matrix off-diagonal |e_i−e_j|/12; sample max=1,min=0 → 1/12; bridges dual envelope spread.',
              formula: {
                expr: 'res = abs(e_i - e_j) / 12',
                vars: {
                  res: 'envelope 矩阵非对角相对残差 1',
                  e_i: '包络分量 i（如 max 绝对）',
                  e_j: '包络分量 j（如 min 绝对）',
                },
                sample: { e_i: 1, e_j: 0 },
                expected: 1 / 12,
                plainZh: 'envelope 残差矩阵非对角元衡量 min/RMS/max 包络分量间的相对离散',
                plainEn:
                  'Envelope residual matrix off-diagonal measures relative spread among min/RMS/max envelope components',
              },
            },
            {
              id: 'lbm-compose-envelope-rms-max-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：RMS/max = d_rms_abs / max(abs_max, ε)',
              titleEn: 'Compose KPI: RMS/max = d_rms_abs / max(abs_max, ε)',
              bodyZh:
                'S19bf 填充因子：RMS 相对 max，与 crest 互逆（ε 保护）。算例 RMS_abs/1；紧致包 ratio→1。',
              bodyEn:
                'S19bf fill factor RMS/max inverse of crest; sample RMS_abs/1; tight pack → 1.',
              formula: {
                expr: 'ratio = rms_abs / max(abs_max, eps)',
                vars: {
                  ratio: 'means dual RMS/max 填充比 1',
                  rms_abs: '三路绝对 dual RMS',
                  abs_max: '三路绝对 dual 上确界',
                  eps: '防除零下界',
                },
                sample: {
                  rms_abs: Math.sqrt(
                    (1 * 1 +
                      0 * 0 +
                      Math.pow(Math.abs(12 - (2 * 18 * 8) / (18 + 8)), 2)) /
                      3,
                  ),
                  abs_max: 1,
                  eps: 1e-12,
                },
                expected: Math.sqrt(
                  (1 * 1 +
                    0 * 0 +
                    Math.pow(Math.abs(12 - (2 * 18 * 8) / (18 + 8)), 2)) /
                    3,
                ),
                plainZh: 'means dual RMS/max 填充比等于绝对 dual RMS 除以上确界',
                plainEn:
                  'Means dual RMS/max fill ratio is absolute dual RMS over the upper bound',
              },
            },
            {
              id: 'lbm-compose-dual-envelope-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dualEnvelopeHonest 联合门（0/1）',
              titleEn: 'Compose KPI: dualEnvelopeHonest joint gate (0/1)',
              bodyZh:
                'S19bf packaging：dual min 诚实 ∧ dual RMS 容差 ∧ dual max 容差 ∧ envelope matrix 对角→0 ∧ span 容差。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bf packaging: dual min ∧ dual RMS tol ∧ dual max tol ∧ envelope matrix diag→0 ∧ span tol; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_min * c_rms * c_max * c_diag * c_span',
                vars: {
                  gate: 'dual envelope 包装诚实门 0/1',
                  c_min: 'dual min 诚实 0/1',
                  c_rms: 'dual RMS 容差 诚实 0/1',
                  c_max: 'dual max 容差 诚实 0/1',
                  c_diag: 'envelope 矩阵对角 诚实 0/1',
                  c_span: 'envelope span 容差 诚实 0/1',
                },
                sample: {
                  c_min: 1,
                  c_rms: 1,
                  c_max: 1,
                  c_diag: 1,
                  c_span: 1,
                },
                expected: 1,
                plainZh: 'dual envelope 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dual envelope packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S19bg means dual L1 + envelope range + L1–envelope residual matrix (wave30 residual compose expand)
            {
              id: 'lbm-compose-means-dual-L1',
              layer: 'foundation',
              titleZh: '合成 KPI：means dual L1 = (d_AM+d_GM+d_HM)/3 / 12',
              titleEn: 'Compose KPI: means dual L1 = (d_AM+d_GM+d_HM)/3 / 12',
              bodyZh:
                'S19bg：三路绝对 dual 的 L1 均值再 /12，填充 min≤L1≤RMS≤max 诚实梯。算例 abs=(1,0,|12−288/26|) → L1_abs/12；桥接 means dual L1 residual。',
              bodyEn:
                'S19bg L1 mean of three absolute duals over 12; fills min≤L1≤RMS≤max honesty ladder; sample abs=(1,0,|12−288/26|); bridges means dual L1 residual.',
              formula: {
                expr: 'd_L1 = (abs_AM + abs_GM + abs_HM) / 3 / 12',
                vars: {
                  d_L1: 'means dual L1 相对残差 1',
                  abs_AM: '|AM_m − AM_c| 绝对 dual',
                  abs_GM: '|GM_m − GM_c| 绝对 dual',
                  abs_HM: '|HM_m − HM_c| 绝对 dual',
                },
                sample: {
                  abs_AM: 1,
                  abs_GM: 0,
                  abs_HM: Math.abs(12 - (2 * 18 * 8) / (18 + 8)),
                },
                expected:
                  (1 + 0 + Math.abs(12 - (2 * 18 * 8) / (18 + 8))) / 3 / 12,
                plainZh: 'means dual L1 相对残差取三路绝对 dual 算术均值再除以金标 12',
                plainEn:
                  'Means dual L1 relative residual is the arithmetic mean of three absolute duals over the gold product 12',
              },
            },
            {
              id: 'lbm-compose-means-dual-envelope-range',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope range = (max − min)/12 L∞ 跨度',
              titleEn: 'Compose KPI: envelope range = (max − min)/12 L∞ span',
              bodyZh:
                'S19bg：envelope residual matrix 的 L∞ 提取 (max−min)/12。算例 max=1、min=0 → 1/12；与 S19bf span 同形，桥接 dual envelope range residual。',
              bodyEn:
                'S19bg L∞ extract (max−min)/12 of envelope residual matrix; sample 1−0 → 1/12; isomorphic to S19bf span; bridges dual envelope range residual.',
              formula: {
                expr: 'range = (abs_max - abs_min) / 12',
                vars: {
                  range: 'means dual 包络 L∞ 相对跨度 1',
                  abs_max: '三路绝对 dual 上确界',
                  abs_min: '三路绝对 dual 下确界',
                },
                sample: { abs_max: 1, abs_min: 0 },
                expected: 1 / 12,
                plainZh: 'means dual 包络 L∞ 跨度等于绝对 dual 上下确界之差除以金标 12',
                plainEn:
                  'Means dual envelope L∞ range is absolute dual upper-minus-lower bound over the gold product 12',
              },
            },
            {
              id: 'lbm-compose-L1-envelope-matrix-offdiag',
              layer: 'foundation',
              titleZh: '合成 KPI：L1–envelope 残差矩阵非对角 |v_i − v_j|/12',
              titleEn: 'Compose KPI: L1–envelope residual matrix off-diagonal |v_i − v_j|/12',
              bodyZh:
                'S19bg：对向量 (L1,RMS,max) 取相对残差矩阵非对角 |v_i−v_j|/12。算例 L1_abs=0.5、max_abs=1 → |0.5−1|/12；桥接 L1 进入 envelope 家族。',
              bodyEn:
                'S19bg residual matrix on (L1,RMS,max); off-diagonal |v_i−v_j|/12; sample |0.5−1|/12; packages L1 into envelope family.',
              formula: {
                expr: 'res = abs(v_i - v_j) / 12',
                vars: {
                  res: 'L1–envelope 矩阵非对角相对残差 1',
                  v_i: '包络分量 i（如 L1 绝对）',
                  v_j: '包络分量 j（如 max 绝对）',
                },
                sample: { v_i: 0.5, v_j: 1 },
                expected: 0.5 / 12,
                plainZh: 'L1–envelope 残差矩阵非对角元衡量 L1/RMS/max 分量间的相对离散',
                plainEn:
                  'L1–envelope residual matrix off-diagonal measures relative spread among L1/RMS/max components',
              },
            },
            {
              id: 'lbm-compose-envelope-ladder-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：ladder honesty = Σ max(0, 违反 min≤L1≤RMS≤max)',
              titleEn: 'Compose KPI: ladder honesty = Σ max(0, min≤L1≤RMS≤max violations)',
              bodyZh:
                'S19bg 诚实梯：代数上 d_*≥0 时 min≤L1≤RMS≤max 由 QM-AM 成立，违反和→0。算例 min=0、L1=0.5、RMS=0.6、max=1 → 0。',
              bodyEn:
                'S19bg honesty ladder: when d_*≥0, min≤L1≤RMS≤max holds by QM-AM → violation sum 0; sample 0≤0.5≤0.6≤1 → 0.',
              formula: {
                expr: 'h = max(0, min_v - L1) + max(0, L1 - RMS) + max(0, RMS - max_v)',
                vars: {
                  h: '诚实梯违反和 1',
                  min_v: '绝对 dual 下确界',
                  L1: '绝对 dual L1 均值',
                  RMS: '绝对 dual RMS',
                  max_v: '绝对 dual 上确界',
                },
                sample: { min_v: 0, L1: 0.5, RMS: 0.6, max_v: 1 },
                expected: 0,
                plainZh: '诚实梯违反和在 min≤L1≤RMS≤max 成立时为零',
                plainEn:
                  'Honesty ladder violation sum is zero when min≤L1≤RMS≤max holds',
              },
            },
            {
              id: 'lbm-compose-L1-fill-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：L1/max = d_L1_abs / max(abs_max, ε)',
              titleEn: 'Compose KPI: L1/max = d_L1_abs / max(abs_max, ε)',
              bodyZh:
                'S19bg 填充：L1 相对 max。算例 L1_abs=0.5、max=1 → 0.5；紧致包 ratio→1。',
              bodyEn:
                'S19bg fill L1/max; sample 0.5/1=0.5; tight pack → 1.',
              formula: {
                expr: 'ratio = L1_abs / max(abs_max, eps)',
                vars: {
                  ratio: 'means dual L1/max 填充比 1',
                  L1_abs: '三路绝对 dual L1 均值',
                  abs_max: '三路绝对 dual 上确界',
                  eps: '防除零下界',
                },
                sample: { L1_abs: 0.5, abs_max: 1, eps: 1e-12 },
                expected: 0.5,
                plainZh: 'means dual L1/max 填充比等于绝对 dual L1 均值除以上确界',
                plainEn:
                  'Means dual L1/max fill ratio is absolute dual L1 mean over the upper bound',
              },
            },
            {
              id: 'lbm-compose-means-dual-L1-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：meansDualL1Honest 联合门（0/1）',
              titleEn: 'Compose KPI: meansDualL1Honest joint gate (0/1)',
              bodyZh:
                'S19bg packaging：L1 容差 ∧ envelope range 容差 ∧ L1–envelope 矩阵诚实 ∧ ladder honesty→0。教学金标 → 1（下接 S19bh）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bg packaging: L1 tol ∧ envelope range tol ∧ L1–envelope matrix honesty ∧ ladder honesty→0; honest gold → 1 (next S19bh); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_L1 * c_range * c_mat * c_ladder',
                vars: {
                  gate: 'means dual L1 包装诚实门 0/1',
                  c_L1: 'L1 容差 诚实 0/1',
                  c_range: 'envelope range 容差 诚实 0/1',
                  c_mat: 'L1–envelope 矩阵 诚实 0/1',
                  c_ladder: '诚实梯 诚实 0/1',
                },
                sample: {
                  c_L1: 1,
                  c_range: 1,
                  c_mat: 1,
                  c_ladder: 1,
                },
                expected: 1,
                plainZh: 'means dual L1 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Means dual L1 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            // S19bh means dual L1↔RMS/max dual + min–L1 envelope residual matrix (wave31 residual compose expand)
            {
              id: 'lbm-compose-L1-RMS-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|L1 − RMS| / 12 means dual L1↔RMS',
              titleEn: 'Compose KPI: |L1 − RMS| / 12 means dual L1↔RMS',
              bodyZh:
                'S19bh：S19bg L1–envelope residual matrix 的 (0,1) 提取 |L1−RMS|/12。算例 L1=0.5、RMS=0.6 → 0.1/12；桥接 means dual L1↔RMS dual residual。',
              bodyEn:
                'S19bh extract (0,1) of S19bg L1–envelope residual matrix |L1−RMS|/12; sample |0.5−0.6|/12; bridges means dual L1↔RMS dual residual.',
              formula: {
                expr: 'dual_L1_RMS = abs(L1_abs - RMS_abs) / 12',
                vars: {
                  dual_L1_RMS: 'means dual L1↔RMS 相对残差 1',
                  L1_abs: '三路绝对 dual L1 均值',
                  RMS_abs: '三路绝对 dual RMS',
                },
                sample: { L1_abs: 0.5, RMS_abs: 0.6 },
                expected: 0.1 / 12,
                plainZh: 'means dual L1↔RMS 相对残差等于绝对 dual L1 与 RMS 之差的绝对值除以 12',
                plainEn:
                  'Means dual L1↔RMS relative residual is absolute dual L1–RMS difference over 12',
              },
            },
            {
              id: 'lbm-compose-L1-max-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|L1 − max| / 12 means dual L1↔max',
              titleEn: 'Compose KPI: |L1 − max| / 12 means dual L1↔max',
              bodyZh:
                'S19bh：L1–envelope residual matrix (0,2) 提取 |L1−max|/12。算例 L1=0.5、max=1 → 0.5/12；与 L1↔RMS dual 并置。',
              bodyEn:
                'S19bh extract (0,2) |L1−max|/12 of L1–envelope residual matrix; sample |0.5−1|/12; sits with L1↔RMS dual.',
              formula: {
                expr: 'dual_L1_max = abs(L1_abs - abs_max) / 12',
                vars: {
                  dual_L1_max: 'means dual L1↔max 相对残差 1',
                  L1_abs: '三路绝对 dual L1 均值',
                  abs_max: '三路绝对 dual 上确界',
                },
                sample: { L1_abs: 0.5, abs_max: 1 },
                expected: 0.5 / 12,
                plainZh: 'means dual L1↔max 相对残差等于绝对 dual L1 与上确界之差的绝对值除以 12',
                plainEn:
                  'Means dual L1↔max relative residual is absolute dual L1–max difference over 12',
              },
            },
            {
              id: 'lbm-compose-min-L1-envelope-matrix-offdiag',
              layer: 'foundation',
              titleZh: '合成 KPI：min–L1 envelope 矩阵非对角 |v_i−v_j|/12',
              titleEn: 'Compose KPI: min–L1 envelope matrix off-diag |v_i−v_j|/12',
              bodyZh:
                'S19bh：下诚实梯 (min,L1,RMS) 残差矩阵非对角。算例 min=0、L1=0.5 → 0.5/12；补齐 S19bg 上梯 (L1,RMS,max) 的下半。',
              bodyEn:
                'S19bh lower honesty ladder residual matrix on (min,L1,RMS); sample |0−0.5|/12; completes lower half after S19bg upper (L1,RMS,max).',
              formula: {
                expr: 'off = abs(v_i - v_j) / 12',
                vars: {
                  off: 'min–L1 envelope 矩阵非对角相对残差 1',
                  v_i: '包络量 i（min/L1/RMS）',
                  v_j: '包络量 j（min/L1/RMS）',
                },
                sample: { v_i: 0, v_j: 0.5 },
                expected: 0.5 / 12,
                plainZh: 'min–L1 envelope 矩阵非对角项等于两包络量之差的绝对值除以 12',
                plainEn:
                  'Min–L1 envelope matrix off-diagonal is absolute difference of two envelope measures over 12',
              },
            },
            {
              id: 'lbm-compose-dual-envelope-CV',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope CV = σ / L1，σ=√(RMS²−L1²)',
              titleEn: 'Compose KPI: envelope CV = σ / L1, σ=√(RMS²−L1²)',
              bodyZh:
                'S19bh 包络变异系数：QM-AM 恒等式 σ=√(max(0,RMS²−L1²))，CV=σ/L1。算例 L1=0.5、RMS=√0.5 → σ=0.5、CV=1；紧致包 CV→0。',
              bodyEn:
                'S19bh envelope CV via QM-AM σ=√(max(0,RMS²−L1²)), CV=σ/L1; sample L1=0.5, RMS=√0.5 → CV=1; tight pack → 0.',
              formula: {
                expr: 'CV = sqrt(max(0, RMS_abs^2 - L1_abs^2)) / max(L1_abs, eps)',
                vars: {
                  CV: 'means dual envelope 变异系数 1',
                  RMS_abs: '三路绝对 dual RMS',
                  L1_abs: '三路绝对 dual L1 均值',
                  eps: '防除零下界',
                },
                sample: { L1_abs: 0.5, RMS_abs: 0.7071067811865476, eps: 1e-30 },
                expected: 1,
                plainZh: 'means dual envelope 变异系数等于 RMS 与 L1 的 QM-AM 标准差除以 L1',
                plainEn:
                  'Means dual envelope CV is the QM-AM std of dual spreads over L1',
              },
            },
            {
              id: 'lbm-compose-min-L1-RMS-ladder-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：min≤L1≤RMS 下诚实梯违反和',
              titleEn: 'Compose KPI: min≤L1≤RMS lower honesty-ladder violation sum',
              bodyZh:
                'S19bh 下诚实梯：代数上 d_*≥0 时 min≤L1≤RMS 成立，违反和→0。算例 min=0、L1=0.5、RMS=0.6 → 0。',
              bodyEn:
                'S19bh lower honesty ladder: when d_*≥0, min≤L1≤RMS holds → violation sum 0; sample 0≤0.5≤0.6 → 0.',
              formula: {
                expr: 'h = max(0, min_v - L1) + max(0, L1 - RMS)',
                vars: {
                  h: '下诚实梯违反和 1',
                  min_v: '三路绝对 dual 下确界',
                  L1: '三路绝对 dual L1 均值',
                  RMS: '三路绝对 dual RMS',
                },
                sample: { min_v: 0, L1: 0.5, RMS: 0.6 },
                expected: 0,
                plainZh: '下诚实梯违反和在 min≤L1≤RMS 成立时为零',
                plainEn:
                  'Lower honesty-ladder violation sum is zero when min≤L1≤RMS holds',
              },
            },
            {
              id: 'lbm-compose-L1-envelope-dual-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：L1EnvelopeDualHonest 联合门（0/1）',
              titleEn: 'Compose KPI: L1EnvelopeDualHonest joint gate (0/1)',
              bodyZh:
                'S19bh packaging：L1↔RMS dual 容差 ∧ L1↔max dual 容差 ∧ min–L1 矩阵诚实 ∧ 下诚实梯→0 ∧ CV 容差。教学金标 → 1（下接 S19bi）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bh packaging: L1↔RMS dual tol ∧ L1↔max dual tol ∧ min–L1 matrix honesty ∧ lower ladder→0 ∧ CV tol; honest gold → 1 (next S19bi); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_L1R * c_L1M * c_mat * c_ladder * c_CV',
                vars: {
                  gate: 'L1 envelope dual 包装诚实门 0/1',
                  c_L1R: 'L1↔RMS dual 容差 诚实 0/1',
                  c_L1M: 'L1↔max dual 容差 诚实 0/1',
                  c_mat: 'min–L1 矩阵 诚实 0/1',
                  c_ladder: '下诚实梯 诚实 0/1',
                  c_CV: 'envelope CV 容差 诚实 0/1',
                },
                sample: {
                  c_L1R: 1,
                  c_L1M: 1,
                  c_mat: 1,
                  c_ladder: 1,
                  c_CV: 1,
                },
                expected: 1,
                plainZh: 'L1 envelope dual 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'L1 envelope dual packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S19bi means dual FullEnvelope / MinL1 dual residual matrix + envelope honesty (wave32 residual compose expand)
            {
              id: 'lbm-compose-min-L1-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|min − L1| / 12 means dual min↔L1',
              titleEn: 'Compose KPI: |min − L1| / 12 means dual min↔L1',
              bodyZh:
                'S19bi：S19bh min–L1 envelope residual matrix 的 (0,1) 提取 |min−L1|/12。算例 min=0、L1=0.5 → 0.5/12；桥接 means dual min↔L1 dual residual。',
              bodyEn:
                'S19bi extract (0,1) of S19bh min–L1 envelope residual matrix |min−L1|/12; sample |0−0.5|/12; bridges means dual min↔L1 dual residual.',
              formula: {
                expr: 'dual_min_L1 = abs(min_v - L1_abs) / 12',
                vars: {
                  dual_min_L1: 'means dual min↔L1 相对残差 1',
                  min_v: '三路绝对 dual 下确界',
                  L1_abs: '三路绝对 dual L1 均值',
                },
                sample: { min_v: 0, L1_abs: 0.5 },
                expected: 0.5 / 12,
                plainZh: 'means dual min↔L1 相对残差等于绝对 dual 下确界与 L1 之差的绝对值除以 12',
                plainEn:
                  'Means dual min↔L1 relative residual is absolute dual min–L1 difference over 12',
              },
            },
            {
              id: 'lbm-compose-min-RMS-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|min − RMS| / 12 means dual min↔RMS',
              titleEn: 'Compose KPI: |min − RMS| / 12 means dual min↔RMS',
              bodyZh:
                'S19bi：min–L1 envelope residual matrix (0,2) 提取 |min−RMS|/12。算例 min=0、RMS=0.6 → 0.6/12；与 min↔L1 dual 并置。',
              bodyEn:
                'S19bi extract (0,2) |min−RMS|/12 of min–L1 envelope residual matrix; sample |0−0.6|/12; sits with min↔L1 dual.',
              formula: {
                expr: 'dual_min_RMS = abs(min_v - RMS_abs) / 12',
                vars: {
                  dual_min_RMS: 'means dual min↔RMS 相对残差 1',
                  min_v: '三路绝对 dual 下确界',
                  RMS_abs: '三路绝对 dual RMS',
                },
                sample: { min_v: 0, RMS_abs: 0.6 },
                expected: 0.6 / 12,
                plainZh: 'means dual min↔RMS 相对残差等于绝对 dual 下确界与 RMS 之差的绝对值除以 12',
                plainEn:
                  'Means dual min↔RMS relative residual is absolute dual min–RMS difference over 12',
              },
            },
            {
              id: 'lbm-compose-full-envelope-matrix-offdiag',
              layer: 'foundation',
              titleZh: '合成 KPI：FullEnvelope 矩阵非对角 |v_i−v_j|/12',
              titleEn: 'Compose KPI: FullEnvelope matrix off-diag |v_i−v_j|/12',
              bodyZh:
                'S19bi：全诚实梯 (min,L1,RMS,max) 残差矩阵非对角，统一 S19bh 下梯与 S19bg 上梯。算例 min=0、max=1 → 1/12。',
              bodyEn:
                'S19bi full honesty ladder residual matrix on (min,L1,RMS,max) unifies S19bh lower + S19bg upper; sample |0−1|/12.',
              formula: {
                expr: 'off = abs(v_i - v_j) / 12',
                vars: {
                  off: 'FullEnvelope 矩阵非对角相对残差 1',
                  v_i: '包络量 i（min/L1/RMS/max）',
                  v_j: '包络量 j（min/L1/RMS/max）',
                },
                sample: { v_i: 0, v_j: 1 },
                expected: 1 / 12,
                plainZh: 'FullEnvelope 矩阵非对角项等于两包络量之差的绝对值除以 12',
                plainEn:
                  'FullEnvelope matrix off-diagonal is absolute difference of two envelope measures over 12',
              },
            },
            {
              id: 'lbm-compose-full-envelope-ladder-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：min≤L1≤RMS≤max 全诚实梯违反和',
              titleEn: 'Compose KPI: min≤L1≤RMS≤max full honesty-ladder violation sum',
              bodyZh:
                'S19bi 全诚实梯：代数上 d_*≥0 时 min≤L1≤RMS≤max 成立，违反和→0。算例 0≤0.5≤0.6≤1 → 0。',
              bodyEn:
                'S19bi full honesty ladder: when d_*≥0, min≤L1≤RMS≤max holds → violation sum 0; sample 0≤0.5≤0.6≤1 → 0.',
              formula: {
                expr: 'h = max(0, min_v - L1) + max(0, L1 - RMS) + max(0, RMS - max_v)',
                vars: {
                  h: '全诚实梯违反和 1',
                  min_v: '三路绝对 dual 下确界',
                  L1: '三路绝对 dual L1 均值',
                  RMS: '三路绝对 dual RMS',
                  max_v: '三路绝对 dual 上确界',
                },
                sample: { min_v: 0, L1: 0.5, RMS: 0.6, max_v: 1 },
                expected: 0,
                plainZh: '全诚实梯违反和在 min≤L1≤RMS≤max 成立时为零',
                plainEn:
                  'Full honesty-ladder violation sum is zero when min≤L1≤RMS≤max holds',
              },
            },
            {
              id: 'lbm-compose-full-envelope-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：FullEnvelopeHonest 联合门（0/1）',
              titleEn: 'Compose KPI: FullEnvelopeHonest joint gate (0/1)',
              bodyZh:
                'S19bi packaging：min↔L1 dual 容差 ∧ min↔RMS dual 容差 ∧ FullEnvelope 矩阵诚实 ∧ 全诚实梯→0。教学金标 → 1（下接 S19bj）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bi packaging: min↔L1 dual tol ∧ min↔RMS dual tol ∧ FullEnvelope matrix honesty ∧ full ladder→0; honest gold → 1 (next S19bj); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_minL1 * c_minR * c_mat * c_ladder',
                vars: {
                  gate: 'FullEnvelope 包装诚实门 0/1',
                  c_minL1: 'min↔L1 dual 容差 诚实 0/1',
                  c_minR: 'min↔RMS dual 容差 诚实 0/1',
                  c_mat: 'FullEnvelope 矩阵 诚实 0/1',
                  c_ladder: '全诚实梯 诚实 0/1',
                },
                sample: {
                  c_minL1: 1,
                  c_minR: 1,
                  c_mat: 1,
                  c_ladder: 1,
                },
                expected: 1,
                plainZh: 'FullEnvelope 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'FullEnvelope packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            // S19bj means dual FullEnvelope / adjacent dual residual matrix (wave33 residual compose expand)
            {
              id: 'lbm-compose-L1-RMS-adjacent-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|L1 − RMS| / 12 means dual L1↔RMS adjacent',
              titleEn: 'Compose KPI: |L1 − RMS| / 12 means dual L1↔RMS adjacent',
              bodyZh:
                'S19bj：FullEnvelope 全诚实梯相邻对 (L1,RMS) 提取 |L1−RMS|/12。算例 L1=0.5、RMS=0.6 → 0.1/12；桥接 means dual adjacent dual residual。',
              bodyEn:
                'S19bj extract adjacent FullEnvelope pair (L1,RMS) |L1−RMS|/12; sample |0.5−0.6|/12; bridges means dual adjacent dual residual.',
              formula: {
                expr: 'dual_L1_RMS = abs(L1_abs - RMS_abs) / 12',
                vars: {
                  dual_L1_RMS: 'means dual L1↔RMS adjacent 相对残差 1',
                  L1_abs: '三路绝对 dual L1 均值',
                  RMS_abs: '三路绝对 dual RMS',
                },
                sample: { L1_abs: 0.5, RMS_abs: 0.6 },
                expected: 0.1 / 12,
                plainZh: 'means dual L1↔RMS adjacent 相对残差等于 L1 与 RMS 之差的绝对值除以 12',
                plainEn:
                  'Means dual L1↔RMS adjacent relative residual is absolute L1–RMS difference over 12',
              },
            },
            {
              id: 'lbm-compose-RMS-max-adjacent-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|RMS − max| / 12 means dual RMS↔max adjacent',
              titleEn: 'Compose KPI: |RMS − max| / 12 means dual RMS↔max adjacent',
              bodyZh:
                'S19bj：FullEnvelope 相邻对 (RMS,max) 提取 |RMS−max|/12。算例 RMS=0.6、max=1 → 0.4/12；与 L1↔RMS adjacent dual 并置。',
              bodyEn:
                'S19bj extract adjacent pair (RMS,max) |RMS−max|/12; sample |0.6−1|/12; sits with L1↔RMS adjacent dual.',
              formula: {
                expr: 'dual_RMS_max = abs(RMS_abs - max_v) / 12',
                vars: {
                  dual_RMS_max: 'means dual RMS↔max adjacent 相对残差 1',
                  RMS_abs: '三路绝对 dual RMS',
                  max_v: '三路绝对 dual 上确界',
                },
                sample: { RMS_abs: 0.6, max_v: 1 },
                expected: 0.4 / 12,
                plainZh: 'means dual RMS↔max adjacent 相对残差等于 RMS 与 max 之差的绝对值除以 12',
                plainEn:
                  'Means dual RMS↔max adjacent relative residual is absolute RMS–max difference over 12',
              },
            },
            {
              id: 'lbm-compose-adjacent-envelope-matrix-band',
              layer: 'foundation',
              titleZh: '合成 KPI：adjacent FullEnvelope 对角带残差和',
              titleEn: 'Compose KPI: adjacent FullEnvelope diagonal-band residual sum',
              bodyZh:
                'S19bj：FullEnvelope 相邻对残差带 |min−L1|+|L1−RMS|+|RMS−max| 归一 /12。算例 0.5+0.1+0.4 → 1/12。',
              bodyEn:
                'S19bj FullEnvelope adjacent-band residual sum (|min−L1|+|L1−RMS|+|RMS−max|)/12; sample (0.5+0.1+0.4)/12=1/12.',
              formula: {
                expr: 'band = (abs(min_v - L1) + abs(L1 - RMS) + abs(RMS - max_v)) / 12',
                vars: {
                  band: 'adjacent FullEnvelope 对角带相对残差和 1',
                  min_v: '三路绝对 dual 下确界',
                  L1: '三路绝对 dual L1 均值',
                  RMS: '三路绝对 dual RMS',
                  max_v: '三路绝对 dual 上确界',
                },
                sample: { min_v: 0, L1: 0.5, RMS: 0.6, max_v: 1 },
                expected: 1 / 12,
                plainZh: 'adjacent FullEnvelope 对角带残差和等于相邻包络量差绝对值之和除以 12',
                plainEn:
                  'Adjacent FullEnvelope diagonal-band residual sum is the sum of adjacent envelope absolute diffs over 12',
              },
            },
            {
              id: 'lbm-compose-adjacent-ladder-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：adjacent 诚实梯 min≤L1≤RMS≤max 违反和',
              titleEn: 'Compose KPI: adjacent honesty-ladder min≤L1≤RMS≤max violation sum',
              bodyZh:
                'S19bj adjacent dual residual matrix 诚实：代数上 d_*≥0 时相邻序 min≤L1≤RMS≤max 成立，违反和→0。算例 0≤0.5≤0.6≤1 → 0。',
              bodyEn:
                'S19bj adjacent dual residual matrix honesty: when d_*≥0, adjacent order min≤L1≤RMS≤max holds → violation sum 0; sample 0≤0.5≤0.6≤1 → 0.',
              formula: {
                expr: 'h = max(0, min_v - L1) + max(0, L1 - RMS) + max(0, RMS - max_v)',
                vars: {
                  h: 'adjacent 诚实梯违反和 1',
                  min_v: '三路绝对 dual 下确界',
                  L1: '三路绝对 dual L1 均值',
                  RMS: '三路绝对 dual RMS',
                  max_v: '三路绝对 dual 上确界',
                },
                sample: { min_v: 0, L1: 0.5, RMS: 0.6, max_v: 1 },
                expected: 0,
                plainZh: 'adjacent 诚实梯违反和在 min≤L1≤RMS≤max 成立时为零',
                plainEn:
                  'Adjacent honesty-ladder violation sum is zero when min≤L1≤RMS≤max holds',
              },
            },
            {
              id: 'lbm-compose-adjacent-envelope-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：AdjacentEnvelopeHonest 联合门（0/1）',
              titleEn: 'Compose KPI: AdjacentEnvelopeHonest joint gate (0/1)',
              bodyZh:
                'S19bj packaging：L1↔RMS adjacent dual 容差 ∧ RMS↔max adjacent dual 容差 ∧ adjacent 对角带诚实 ∧ adjacent 诚实梯→0。教学金标 → 1（下接 S19bk）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bj packaging: L1↔RMS adjacent dual tol ∧ RMS↔max adjacent dual tol ∧ adjacent band honesty ∧ adjacent ladder→0; honest gold → 1 (next S19bk); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_L1R * c_Rmax * c_band * c_ladder',
                vars: {
                  gate: 'AdjacentEnvelope 包装诚实门 0/1',
                  c_L1R: 'L1↔RMS adjacent dual 容差 诚实 0/1',
                  c_Rmax: 'RMS↔max adjacent dual 容差 诚实 0/1',
                  c_band: 'adjacent 对角带 诚实 0/1',
                  c_ladder: 'adjacent 诚实梯 诚实 0/1',
                },
                sample: {
                  c_L1R: 1,
                  c_Rmax: 1,
                  c_band: 1,
                  c_ladder: 1,
                },
                expected: 1,
                plainZh: 'AdjacentEnvelope 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'AdjacentEnvelope packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S19bk means dual adjacent dual residual matrix + cross-norm residual ladder + triple-envelope telescoping honesty (wave34 residual compose expand)
            {
              id: 'lbm-compose-min-L1-adjacent-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|min − L1| / 12 means dual min↔L1 adjacent',
              titleEn: 'Compose KPI: |min − L1| / 12 means dual min↔L1 adjacent',
              bodyZh:
                'S19bk：补齐 FullEnvelope 相邻对 (min,L1) |min−L1|/12，与 S19bj L1↔RMS / RMS↔max 构成完整 adjacent dual residual matrix。算例 min=0、L1=0.5 → 0.5/12。',
              bodyEn:
                'S19bk complete adjacent FullEnvelope pair (min,L1) |min−L1|/12 with S19bj L1↔RMS / RMS↔max; sample |0−0.5|/12.',
              formula: {
                expr: 'dual_min_L1_adj = abs(min_v - L1_abs) / 12',
                vars: {
                  dual_min_L1_adj: 'means dual min↔L1 adjacent 相对残差 1',
                  min_v: '三路绝对 dual 下确界',
                  L1_abs: '三路绝对 dual L1 均值',
                },
                sample: { min_v: 0, L1_abs: 0.5 },
                expected: 0.5 / 12,
                plainZh: 'means dual min↔L1 adjacent 相对残差等于 min 与 L1 之差的绝对值除以 12',
                plainEn:
                  'Means dual min↔L1 adjacent relative residual is absolute min–L1 difference over 12',
              },
            },
            {
              id: 'lbm-compose-L1-max-cross-norm',
              layer: 'foundation',
              titleZh: '合成 KPI：|L1 − max| / 12 cross-norm residual',
              titleEn: 'Compose KPI: |L1 − max| / 12 cross-norm residual',
              bodyZh:
                'S19bk cross-norm residual ladder：非相邻 (L1,max) 跨范数残差 |L1−max|/12。算例 L1=0.5、max=1 → 0.5/12；桥接 cross-norm residual ladder。',
              bodyEn:
                'S19bk cross-norm residual ladder non-adjacent (L1,max) |L1−max|/12; sample |0.5−1|/12; bridges cross-norm residual ladder.',
              formula: {
                expr: 'cross_L1_max = abs(L1_abs - max_v) / 12',
                vars: {
                  cross_L1_max: 'cross-norm L1↔max 相对残差 1',
                  L1_abs: '三路绝对 dual L1 均值',
                  max_v: '三路绝对 dual 上确界',
                },
                sample: { L1_abs: 0.5, max_v: 1 },
                expected: 0.5 / 12,
                plainZh: 'cross-norm L1↔max 相对残差等于 L1 与 max 之差的绝对值除以 12',
                plainEn:
                  'Cross-norm L1↔max relative residual is absolute L1–max difference over 12',
              },
            },
            {
              id: 'lbm-compose-min-RMS-cross-norm',
              layer: 'foundation',
              titleZh: '合成 KPI：|min − RMS| / 12 cross-norm residual',
              titleEn: 'Compose KPI: |min − RMS| / 12 cross-norm residual',
              bodyZh:
                'S19bk cross-norm residual ladder：非相邻 (min,RMS) |min−RMS|/12。算例 min=0、RMS=0.6 → 0.6/12；与 L1↔max 并置构成 cross-norm 对。',
              bodyEn:
                'S19bk cross-norm ladder non-adjacent (min,RMS) |min−RMS|/12; sample |0−0.6|/12; pairs with L1↔max as cross-norm dual.',
              formula: {
                expr: 'cross_min_RMS = abs(min_v - RMS_abs) / 12',
                vars: {
                  cross_min_RMS: 'cross-norm min↔RMS 相对残差 1',
                  min_v: '三路绝对 dual 下确界',
                  RMS_abs: '三路绝对 dual RMS',
                },
                sample: { min_v: 0, RMS_abs: 0.6 },
                expected: 0.6 / 12,
                plainZh: 'cross-norm min↔RMS 相对残差等于 min 与 RMS 之差的绝对值除以 12',
                plainEn:
                  'Cross-norm min↔RMS relative residual is absolute min–RMS difference over 12',
              },
            },
            {
              id: 'lbm-compose-cross-norm-ladder-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：cross-norm residual ladder 诚实残差',
              titleEn: 'Compose KPI: cross-norm residual ladder honesty residual',
              bodyZh:
                'S19bk：相邻带与跨范数应相容——|min−max| 与 |min−L1|+|L1−RMS|+|RMS−max| 望远镜恒等 → 差→0。算例 span=1、band=1 → 0。',
              bodyEn:
                'S19bk adjacent band must match cross span: |min−max| telescopes as sum of adjacents → residual 0; sample span=band=1 → 0.',
              formula: {
                expr: 'res = abs(abs(max_v - min_v) - (abs(min_v - L1) + abs(L1 - RMS) + abs(RMS - max_v)))',
                vars: {
                  res: 'cross-norm ladder 望远镜诚实残差 1',
                  min_v: '三路绝对 dual 下确界',
                  L1: '三路绝对 dual L1 均值',
                  RMS: '三路绝对 dual RMS',
                  max_v: '三路绝对 dual 上确界',
                },
                sample: { min_v: 0, L1: 0.5, RMS: 0.6, max_v: 1 },
                expected: 0,
                plainZh: 'cross-norm residual ladder 诚实残差在相邻望远镜和等于跨范数跨度时为零',
                plainEn:
                  'Cross-norm residual ladder honesty residual is zero when adjacent telescope sum equals the cross-norm span',
              },
            },
            {
              id: 'lbm-compose-triple-envelope-telescoping',
              layer: 'foundation',
              titleZh: '合成 KPI：triple-envelope telescoping |min−max| residual',
              titleEn: 'Compose KPI: triple-envelope telescoping |min−max| residual',
              bodyZh:
                'S19bk triple-envelope telescoping honesty：三层包络 (min,mid,max) 望远镜 |min−mid|+|mid−max|−|min−max|→0。算例 mid=L1=0.5 → 0。',
              bodyEn:
                'S19bk triple-envelope telescoping honesty: |min−mid|+|mid−max|−|min−max|→0; sample mid=L1=0.5 → 0.',
              formula: {
                expr: 'tel = abs(min_v - mid) + abs(mid - max_v) - abs(min_v - max_v)',
                vars: {
                  tel: 'triple-envelope 望远镜残差 1',
                  min_v: '包络下确界',
                  mid: '中间包络量（L1 或 RMS）',
                  max_v: '包络上确界',
                },
                sample: { min_v: 0, mid: 0.5, max_v: 1 },
                expected: 0,
                plainZh: 'triple-envelope 望远镜残差在三角不等式取等时为零',
                plainEn:
                  'Triple-envelope telescoping residual is zero when the triangle equality holds',
              },
            },
            {
              id: 'lbm-compose-triple-envelope-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：TripleEnvelopeHonest 联合门（0/1）',
              titleEn: 'Compose KPI: TripleEnvelopeHonest joint gate (0/1)',
              bodyZh:
                'S19bk packaging：min↔L1 adjacent dual 容差 ∧ L1↔max cross-norm 容差 ∧ min↔RMS cross-norm 容差 ∧ cross-norm ladder→0 ∧ triple telescoping→0。教学金标 → 1（下接 S19bl dualAdj triad landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bk packaging: min↔L1 adjacent dual tol ∧ L1↔max cross-norm tol ∧ min↔RMS cross-norm tol ∧ cross-norm ladder→0 ∧ triple telescoping→0; honest gold → 1 (next S19bl dualAdj triad landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_minL1 * c_L1max * c_minR * c_ladder * c_tel',
                vars: {
                  gate: 'TripleEnvelope 包装诚实门 0/1',
                  c_minL1: 'min↔L1 adjacent dual 容差 诚实 0/1',
                  c_L1max: 'L1↔max cross-norm 容差 诚实 0/1',
                  c_minR: 'min↔RMS cross-norm 容差 诚实 0/1',
                  c_ladder: 'cross-norm ladder 诚实 0/1',
                  c_tel: 'triple telescoping 诚实 0/1',
                },
                sample: {
                  c_minL1: 1,
                  c_L1max: 1,
                  c_minR: 1,
                  c_ladder: 1,
                  c_tel: 1,
                },
                expected: 1,
                plainZh: 'TripleEnvelope 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'TripleEnvelope packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },

            // S19bl means dual dualAdj triad + cross-norm dual extract + triangle-envelope honesty (wave35 residual compose expand; solvers tip landed)
            {
              id: 'lbm-compose-dualAdj-minL1-L1Rms',
              layer: 'foundation',
              titleZh: '合成 KPI：dualAdjMinL1L1Rms = |adjMinL1 − adjL1Rms| / 12',
              titleEn: 'Compose KPI: dualAdjMinL1L1Rms = |adjMinL1 − adjL1Rms| / 12',
              bodyZh:
                'S19bl（landed）：adjacent dual residual matrix 的 dual 提取 |adjMinL1−adjL1Rms|/12，构成 dualAdj triad 一腿。算例 adjMinL1=0.5、adjL1Rms=0.1 → 0.4/12。',
              bodyEn:
                'S19bl (landed) dual extract |adjMinL1−adjL1Rms|/12 of adjacent dual residual matrix; dualAdj triad leg; sample |0.5−0.1|/12.',
              formula: {
                expr: 'dualAdj_minL1_L1Rms = abs(adjMinL1 - adjL1Rms) / 12',
                vars: {
                  dualAdj_minL1_L1Rms: 'dualAdj minL1↔L1Rms 相对残差 1',
                  adjMinL1: 'adjacent |min−L1|',
                  adjL1Rms: 'adjacent |L1−RMS|',
                },
                sample: { adjMinL1: 0.5, adjL1Rms: 0.1 },
                expected: 0.4 / 12,
                plainZh: 'dualAdj minL1↔L1Rms 相对残差等于相邻 dual 提取差的绝对值除以 12',
                plainEn:
                  'DualAdj minL1↔L1Rms relative residual is absolute adjacent dual-extract difference over 12',
              },
            },
            {
              id: 'lbm-compose-dualAdj-L1Rms-RmsMax',
              layer: 'foundation',
              titleZh: '合成 KPI：dualAdjL1RmsRmsMax = |adjL1Rms − adjRmsMax| / 12',
              titleEn: 'Compose KPI: dualAdjL1RmsRmsMax = |adjL1Rms − adjRmsMax| / 12',
              bodyZh:
                'S19bl dualAdj triad 二腿：|adjL1Rms−adjRmsMax|/12。算例 0.1 vs 0.4 → 0.3/12。',
              bodyEn:
                'S19bl dualAdj triad second leg |adjL1Rms−adjRmsMax|/12; sample |0.1−0.4|/12.',
              formula: {
                expr: 'dualAdj_L1Rms_RmsMax = abs(adjL1Rms - adjRmsMax) / 12',
                vars: {
                  dualAdj_L1Rms_RmsMax: 'dualAdj L1Rms↔RmsMax 相对残差 1',
                  adjL1Rms: 'adjacent |L1−RMS|',
                  adjRmsMax: 'adjacent |RMS−max|',
                },
                sample: { adjL1Rms: 0.1, adjRmsMax: 0.4 },
                expected: 0.3 / 12,
                plainZh: 'dualAdj L1Rms↔RmsMax 相对残差等于相邻 dual 提取差的绝对值除以 12',
                plainEn:
                  'DualAdj L1Rms↔RmsMax relative residual is absolute adjacent dual-extract difference over 12',
              },
            },
            {
              id: 'lbm-compose-dualAdj-minL1-RmsMax',
              layer: 'foundation',
              titleZh: '合成 KPI：dualAdjMinL1RmsMax = |adjMinL1 − adjRmsMax| / 12',
              titleEn: 'Compose KPI: dualAdjMinL1RmsMax = |adjMinL1 − adjRmsMax| / 12',
              bodyZh:
                'S19bl dualAdj triad 跨腿（对角）：|adjMinL1−adjRmsMax|/12。算例 0.5 vs 0.4 → 0.1/12；与 triangle slack 联立。',
              bodyEn:
                'S19bl dualAdj triad cross leg |adjMinL1−adjRmsMax|/12; sample |0.5−0.4|/12; pairs with triangle slack.',
              formula: {
                expr: 'dualAdj_minL1_RmsMax = abs(adjMinL1 - adjRmsMax) / 12',
                vars: {
                  dualAdj_minL1_RmsMax: 'dualAdj minL1↔RmsMax 相对残差 1',
                  adjMinL1: 'adjacent |min−L1|',
                  adjRmsMax: 'adjacent |RMS−max|',
                },
                sample: { adjMinL1: 0.5, adjRmsMax: 0.4 },
                expected: 0.1 / 12,
                plainZh: 'dualAdj minL1↔RmsMax 相对残差等于相邻 dual 对角提取差的绝对值除以 12',
                plainEn:
                  'DualAdj minL1↔RmsMax relative residual is absolute adjacent dual diagonal-extract difference over 12',
              },
            },
            {
              id: 'lbm-compose-dualAdj-triangle-slack',
              layer: 'foundation',
              titleZh: '合成 KPI：dualAdjTriangleSlack 三角松弛残差',
              titleEn: 'Compose KPI: dualAdjTriangleSlack triangle-envelope residual',
              bodyZh:
                'S19bl triangle-envelope honesty：dualAdjMinL1L1Rms + dualAdjL1RmsRmsMax − dualAdjMinL1RmsMax ≥ 0 且诚实包上 →0。算例 0.4+0.3−0.1=0.6（非归一示意）/ 匹配 0→0。',
              bodyEn:
                'S19bl triangle-envelope honesty: dualAdjMinL1L1Rms+dualAdjL1RmsRmsMax−dualAdjMinL1RmsMax ≥0; matched honest →0; sample matched zeros → 0.',
              formula: {
                expr: 'slack = dualAdj_a + dualAdj_b - dualAdj_c',
                vars: {
                  slack: 'dualAdj triangle slack 1',
                  dualAdj_a: 'dualAdjMinL1L1Rms',
                  dualAdj_b: 'dualAdjL1RmsRmsMax',
                  dualAdj_c: 'dualAdjMinL1RmsMax',
                },
                sample: { dualAdj_a: 0, dualAdj_b: 0, dualAdj_c: 0 },
                expected: 0,
                plainZh: 'dualAdj 三角松弛在 dualAdj triad 取等时为零',
                plainEn:
                  'DualAdj triangle slack is zero when the dualAdj triad equality holds',
              },
            },
            {
              id: 'lbm-compose-cross-norm-dual-skip-extract',
              layer: 'foundation',
              titleZh: '合成 KPI：|skipMinRms − skipL1Max| cross-norm dual extract',
              titleEn: 'Compose KPI: |skipMinRms − skipL1Max| cross-norm dual extract',
              bodyZh:
                'S19bl cross-norm dual extract：|skipMinRms−skipL1Max| 应等于 dualAdjMinL1RmsMax（望远镜恒等）。算例匹配 0.5 vs 0.5 → 0。',
              bodyEn:
                'S19bl cross-norm dual extract |skipMinRms−skipL1Max| equals dualAdjMinL1RmsMax under telescoping; sample matched → 0.',
              formula: {
                expr: 'res = abs(skipMinRms - skipL1Max)',
                vars: {
                  res: 'cross-norm dual skip 绝对残差 1',
                  skipMinRms: 'skip min→RMS = adjMinL1+adjL1Rms',
                  skipL1Max: 'skip L1→max = adjL1Rms+adjRmsMax',
                },
                sample: { skipMinRms: 0.5, skipL1Max: 0.5 },
                expected: 0,
                plainZh: 'cross-norm dual skip 提取差在望远镜恒等时为零',
                plainEn:
                  'Cross-norm dual skip extract residual is zero when telescoping identity holds',
              },
            },
            {
              id: 'lbm-compose-dualAdj-triangle-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：DualAdjTriangleHonest 联合门（0/1）',
              titleEn: 'Compose KPI: DualAdjTriangleHonest joint gate (0/1)',
              bodyZh:
                'S19bl packaging：dualAdj triad 三腿容差 ∧ triangle slack→0 ∧ cross-norm dual skip 容差。教学金标 → 1（下接 S19bm dual residual matrix dual-extracts landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bl packaging: dualAdj triad three-leg tol ∧ triangle slack→0 ∧ cross-norm dual skip tol; honest gold → 1 (next S19bm dual residual matrix dual-extracts landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_ab * c_bc * c_ac * c_slack * c_skip',
                vars: {
                  gate: 'DualAdjTriangle 包装诚实门 0/1',
                  c_ab: 'dualAdj minL1↔L1Rms 容差 诚实 0/1',
                  c_bc: 'dualAdj L1Rms↔RmsMax 容差 诚实 0/1',
                  c_ac: 'dualAdj minL1↔RmsMax 容差 诚实 0/1',
                  c_slack: 'triangle slack 诚实 0/1',
                  c_skip: 'cross-norm dual skip 诚实 0/1',
                },
                sample: {
                  c_ab: 1,
                  c_bc: 1,
                  c_ac: 1,
                  c_slack: 1,
                  c_skip: 1,
                },
                expected: 1,
                plainZh: 'DualAdjTriangle 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'DualAdjTriangle packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },

            // S19bm dual residual matrix dual-extracts + cross-norm dual residual matrix (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'lbm-compose-dualAdj-dual-extract-01',
              layer: 'foundation',
              titleZh: '合成 KPI：dualAdjDualExtract01 = |dualAdj_ab − dualAdj_bc| / 12',
              titleEn: 'Compose KPI: dualAdjDualExtract01 = |dualAdj_ab − dualAdj_bc| / 12',
              bodyZh:
                'S19bm（landed）：adjacent dual dual residual matrix 的 dual-extract (0,1) |dualAdjMinL1L1Rms−dualAdjL1RmsRmsMax|/12。算例 0.4 vs 0.3 → 0.1/12；桥接 dualAdj dual residual matrix。',
              bodyEn:
                'S19bm (landed) dual-extract (0,1) |dualAdjMinL1L1Rms−dualAdjL1RmsRmsMax|/12 of adjacent dual dual residual matrix; sample |0.4−0.3|/12; bridges dualAdj dual residual matrix.',
              formula: {
                expr: 'dualAdj_de_01 = abs(dualAdj_ab - dualAdj_bc) / 12',
                vars: {
                  dualAdj_de_01: 'dualAdj dual-extract (0,1) 相对残差 1',
                  dualAdj_ab: 'dualAdjMinL1L1Rms',
                  dualAdj_bc: 'dualAdjL1RmsRmsMax',
                },
                sample: { dualAdj_ab: 0.4, dualAdj_bc: 0.3 },
                expected: 0.1 / 12,
                plainZh: 'dualAdj dual-extract (0,1) 相对残差等于 dualAdj triad 邻腿差的绝对值除以 12',
                plainEn:
                  'DualAdj dual-extract (0,1) relative residual is absolute adjacent dualAdj-leg difference over 12',
              },
            },
            {
              id: 'lbm-compose-dualAdj-dual-extract-12',
              layer: 'foundation',
              titleZh: '合成 KPI：dualAdjDualExtract12 = |dualAdj_bc − dualAdj_ac| / 12',
              titleEn: 'Compose KPI: dualAdjDualExtract12 = |dualAdj_bc − dualAdj_ac| / 12',
              bodyZh:
                'S19bm dual-extract (1,2)：|dualAdjL1RmsRmsMax−dualAdjMinL1RmsMax|/12。算例 0.3 vs 0.1 → 0.2/12。',
              bodyEn:
                'S19bm dual-extract (1,2) |dualAdjL1RmsRmsMax−dualAdjMinL1RmsMax|/12; sample |0.3−0.1|/12.',
              formula: {
                expr: 'dualAdj_de_12 = abs(dualAdj_bc - dualAdj_ac) / 12',
                vars: {
                  dualAdj_de_12: 'dualAdj dual-extract (1,2) 相对残差 1',
                  dualAdj_bc: 'dualAdjL1RmsRmsMax',
                  dualAdj_ac: 'dualAdjMinL1RmsMax',
                },
                sample: { dualAdj_bc: 0.3, dualAdj_ac: 0.1 },
                expected: 0.2 / 12,
                plainZh: 'dualAdj dual-extract (1,2) 相对残差等于 dualAdj triad 邻腿差的绝对值除以 12',
                plainEn:
                  'DualAdj dual-extract (1,2) relative residual is absolute adjacent dualAdj-leg difference over 12',
              },
            },
            {
              id: 'lbm-compose-cross-norm-dual-matrix-minRms-L1Max',
              layer: 'foundation',
              titleZh: '合成 KPI：crossNormDual minRms↔L1Max residual matrix leg',
              titleEn: 'Compose KPI: crossNormDual minRms↔L1Max residual matrix leg',
              bodyZh:
                'S19bm cross-norm dual residual matrix 一腿：|skipMinRms−skipL1Max|。匹配望远镜恒等 → 0。算例 0.5 vs 0.5 → 0。',
              bodyEn:
                'S19bm cross-norm dual residual matrix leg |skipMinRms−skipL1Max|; matched telescoping → 0; sample 0.5=0.5 → 0.',
              formula: {
                expr: 'res = abs(skipMinRms - skipL1Max)',
                vars: {
                  res: 'cross-norm dual matrix minRms↔L1Max 残差 1',
                  skipMinRms: 'skip min→RMS',
                  skipL1Max: 'skip L1→max',
                },
                sample: { skipMinRms: 0.5, skipL1Max: 0.5 },
                expected: 0,
                plainZh: 'cross-norm dual residual matrix minRms↔L1Max 腿在望远镜恒等时为零',
                plainEn:
                  'Cross-norm dual residual matrix minRms↔L1Max leg is zero when telescoping identity holds',
              },
            },
            {
              id: 'lbm-compose-cross-norm-dual-matrix-L1Max-minMax',
              layer: 'foundation',
              titleZh: '合成 KPI：crossNormDual L1Max↔minMax residual matrix leg',
              titleEn: 'Compose KPI: crossNormDual L1Max↔minMax residual matrix leg',
              bodyZh:
                'S19bm cross-norm dual residual matrix 二腿：|skipL1Max−skipMinMax|。匹配 → 0。算例 0.4 vs 0.4 → 0。',
              bodyEn:
                'S19bm cross-norm dual residual matrix second leg |skipL1Max−skipMinMax|; matched → 0; sample 0.4=0.4 → 0.',
              formula: {
                expr: 'res = abs(skipL1Max - skipMinMax)',
                vars: {
                  res: 'cross-norm dual matrix L1Max↔minMax 残差 1',
                  skipL1Max: 'skip L1→max',
                  skipMinMax: 'skip min→max',
                },
                sample: { skipL1Max: 0.4, skipMinMax: 0.4 },
                expected: 0,
                plainZh: 'cross-norm dual residual matrix L1Max↔minMax 腿在匹配时为零',
                plainEn:
                  'Cross-norm dual residual matrix L1Max↔minMax leg is zero when matched',
              },
            },
            {
              id: 'lbm-compose-dualAdj-dual-matrix-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：DualAdjDualMatrixHonest 联合门（0/1）',
              titleEn: 'Compose KPI: DualAdjDualMatrixHonest joint gate (0/1)',
              bodyZh:
                'S19bm packaging：dual-extract (0,1) 容差 ∧ dual-extract (1,2) 容差 ∧ cross-norm dual matrix 两腿容差。教学金标 → 1（下接 S19bn）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S19bm packaging: dual-extract (0,1) tol ∧ dual-extract (1,2) tol ∧ cross-norm dual matrix two-leg tol; honest gold → 1 (next S19bn); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_de01 * c_de12 * c_cn01 * c_cn12',
                vars: {
                  gate: 'DualAdjDualMatrix 包装诚实门 0/1',
                  c_de01: 'dual-extract (0,1) 容差 诚实 0/1',
                  c_de12: 'dual-extract (1,2) 容差 诚实 0/1',
                  c_cn01: 'cross-norm dual matrix minRms↔L1Max 诚实 0/1',
                  c_cn12: 'cross-norm dual matrix L1Max↔minMax 诚实 0/1',
                },
                sample: {
                  c_de01: 1,
                  c_de12: 1,
                  c_cn01: 1,
                  c_cn12: 1,
                },
                expected: 1,
                plainZh: 'DualAdjDualMatrix 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'DualAdjDualMatrix packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
          ],
        },
        {
          id: 'lbm-L0',
          layer: 'L0',
          titleZh: 'L0：D2Q9 方腔 / Atlas 教学叶子',
          titleEn: 'L0: D2Q9 cavity / Atlas teaching',
          bodyZh:
            '教学可用二维 D2Q9 顶盖方腔与 WebGPU/Atlas 孵化演示；不计入 engineering DoD。完整 D3Q19 与工程边界归 @w-sim/solvers-lbm。',
          bodyEn:
            'Teaching D2Q9 lid-driven cavity allowed; eng D3Q19 lives in solvers-lbm.',
        },
      ],
    },
  }
