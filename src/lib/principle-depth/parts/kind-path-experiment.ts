import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_PATH_EXPERIMENT: CalculationMethod = {
    id: 'kind-path-experiment',
    titleZh: '路径实验 / 光敏动力学（工程 kind）',
    titleEn: 'Path experiment / photosensitization (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind path-experiment：Jablonski 三线态→ROS 速率方程 + RK4/稳态对拍 + 不确定性/技能分残差链；工程路径归 @w-sim/solvers-path-experiment（smoke，未 Atlas 毕业）。',
    summaryEn:
      'W-Sim kind path-experiment: Jablonski T1→ROS ODEs + RK4/steady gold + uncertainty/skill residual chain; owned by @w-sim/solvers-path-experiment (smoke, not Atlas-graduated).',
    jobKinds: ['path-experiment'],
    simMethodIds: ['method-photosensitization-kinetics'],
    explainRoot: {
      id: 'path-root',
      layer: 'method',
      titleZh: '方法：路径实验 / 光敏动力学',
      titleEn: 'Method: path experiment / photosensitization',
      bodyZh:
        '顶层工程计算方法：给定 Jablonski 速率与氧/底物池，积分敏化剂电子态与 ¹O2 池，输出稳态占比、生成率与不确定性 KPI。数值核心在 WaveWorld photosensitization（RK4 + 解析稳态）与 @w-sim/solvers-path-experiment 残差链。',
      bodyEn:
        'Integrate Jablonski electronic states + ¹O2 pool; KPIs from steady φ_T, generation, and uncertainty/skill residuals; solvers-path-experiment owns eng path.',
      jobKinds: ['path-experiment'],
      simMethodIds: ['method-photosensitization-kinetics'],
      children: [
        {
          id: 'path-principle-jablonski',
          layer: 'principle',
          titleZh: '原理：Jablonski 速率与解析稳态',
          titleEn: 'Principle: Jablonski rates & analytic steady state',
          bodyZh:
            'S0↔S1↔T1 循环 + Type II 能量转移生成 ¹O2。令 k_T,eff、a、b 后稳态闭式：S0_ss、S1_ss、T1_ss、¹O2_ss 与守恒 S0+S1+T1=C_tot。',
          bodyEn:
            'S0↔S1↔T1 cycle + Type II → ¹O2; closed steady state via k_T,eff, a, b; conservation of sensitizer.',
          children: [
            {
              id: 'path-foundation-kteff',
              layer: 'foundation',
              titleZh: '基础式：k_T,eff = k_T + k_q [³O2] + k_I [sub]',
              titleEn: 'Foundation: k_T,eff = k_T + k_q [³O2] + k_I [sub]',
              bodyZh:
                'T1 总失活伪一级率：氧无关磷光/失活 + Type II 猝灭 + Type I 底物道。默认算例 k_T,eff = 0.2+1.5+0.3 = 2。',
              bodyEn:
                'Pseudo-first-order T1 loss: O2-independent + Type II + Type I; sample defaults → 2.',
              formula: {
                expr: 'kTeff = k_T + k_q * O2 + k_I * substrate',
                vars: {
                  kTeff: 'T1 总失活率 1/s',
                  k_T: '氧无关失活率 1/s',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  k_I: 'Type I 速率常数',
                  substrate: '底物浓度',
                },
                sample: {
                  k_T: 0.2,
                  k_q: 1.5,
                  O2: 1,
                  k_I: 0.3,
                  substrate: 1,
                },
                expected: 2,
                plainZh: '三线态总失活率等于氧无关、Type II 与 Type I 三道伪一级率之和',
                plainEn: 'Triplet total decay is the sum of O2-independent, Type II, and Type I rates',
              },
            },
            {
              id: 'path-foundation-a',
              layer: 'foundation',
              titleZh: '基础式：a = k_exc / (k_f + k_isc)',
              titleEn: 'Foundation: a = k_exc / (k_f + k_isc)',
              bodyZh:
                'S1 稳态相对 S0 的分支比：激发率相对 S1 总出射（荧光/内转换 + ISC）。默认 a = 0.5/5 = 0.1。',
              bodyEn:
                'Steady S1/S0 branch ratio; sample a = 0.5/5 = 0.1.',
              formula: {
                expr: 'a = k_exc / (k_f + k_isc)',
                vars: {
                  a: 'S1/S0 稳态比参数 1',
                  k_exc: '激发率 1/s',
                  k_f: '荧光/内转换率 1/s',
                  k_isc: '系间窜越率 1/s',
                },
                sample: { k_exc: 0.5, k_f: 2, k_isc: 3 },
                expected: 0.1,
                plainZh: '稳态参数 a 等于激发率除以 S1 总出射率',
                plainEn: 'Steady parameter a is excitation over total S1 outflow',
              },
            },
            {
              id: 'path-foundation-b',
              layer: 'foundation',
              titleZh: '基础式：b = k_isc / k_T,eff',
              titleEn: 'Foundation: b = k_isc / k_T,eff',
              bodyZh:
                'T1 相对 S1 的稳态比参数：ISC 进料相对 T1 总失活。默认 b = 3/2 = 1.5。',
              bodyEn:
                'Steady T1/S1 parameter; sample b = 3/2 = 1.5.',
              formula: {
                expr: 'b = k_isc / kTeff',
                vars: {
                  b: 'T1/S1 稳态比参数 1',
                  k_isc: '系间窜越率 1/s',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: { k_isc: 3, kTeff: 2 },
                expected: 1.5,
                plainZh: '稳态参数 b 等于 ISC 率除以 T1 总失活率',
                plainEn: 'Steady parameter b is ISC rate over total T1 decay',
              },
            },
            {
              id: 'path-foundation-S0ss',
              layer: 'foundation',
              titleZh: '基础式：S0_ss = C_tot / (1 + a + a b)',
              titleEn: 'Foundation: S0_ss = C_tot / (1 + a + a b)',
              bodyZh:
                '基态稳态浓度。默认 C_tot=1、a=0.1、b=1.5 → 分母 1.25 → S0_ss=0.8。',
              bodyEn:
                'Steady ground state; defaults → S0_ss = 0.8.',
              formula: {
                expr: 'S0_ss = cTot / (1 + a + a * b)',
                vars: {
                  S0_ss: '基态稳态浓度',
                  cTot: '总敏化剂浓度',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                },
                sample: { cTot: 1, a: 0.1, b: 1.5 },
                expected: 0.8,
                plainZh: '基态稳态浓度由总敏化剂与 a、b 分支参数决定',
                plainEn: 'Steady S0 from total sensitizer and branch parameters a, b',
              },
            },
            {
              id: 'path-foundation-S1ss',
              layer: 'foundation',
              titleZh: '基础式：S1_ss = a · S0_ss',
              titleEn: 'Foundation: S1_ss = a · S0_ss',
              bodyZh:
                '单线态激发态稳态。默认 a·0.8 = 0.08。',
              bodyEn: 'Steady S1 = a S0; sample 0.08.',
              formula: {
                expr: 'S1_ss = a * S0_ss',
                vars: {
                  S1_ss: 'S1 稳态浓度',
                  a: 'S1/S0 参数',
                  S0_ss: '基态稳态浓度',
                },
                sample: { a: 0.1, S0_ss: 0.8 },
                expected: 0.08,
                plainZh: 'S1 稳态浓度等于参数 a 乘基态稳态浓度',
                plainEn: 'Steady S1 equals a times steady S0',
              },
            },
            {
              id: 'path-foundation-T1ss',
              layer: 'foundation',
              titleZh: '基础式：T1_ss = a b · S0_ss',
              titleEn: 'Foundation: T1_ss = a b · S0_ss',
              bodyZh:
                '三线态稳态浓度。默认 0.1·1.5·0.8 = 0.12。',
              bodyEn: 'Steady T1 = a b S0; sample 0.12.',
              formula: {
                expr: 'T1_ss = a * b * S0_ss',
                vars: {
                  T1_ss: 'T1 稳态浓度',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                  S0_ss: '基态稳态浓度',
                },
                sample: { a: 0.1, b: 1.5, S0_ss: 0.8 },
                expected: 0.12,
                plainZh: 'T1 稳态浓度等于 a b 乘基态稳态浓度',
                plainEn: 'Steady T1 equals a times b times steady S0',
              },
            },
            {
              id: 'path-foundation-phiT',
              layer: 'foundation',
              titleZh: '基础式：φ_T,ss = T1_ss / C_tot',
              titleEn: 'Foundation: φ_T,ss = T1_ss / C_tot',
              bodyZh:
                '稳态三线态占比。默认 T1_ss/C_tot = 0.12。亦可写 φ_T = a b / (1+a+a b)。',
              bodyEn:
                'Steady triplet fraction; sample 0.12; equiv. ab/(1+a+ab).',
              formula: {
                expr: 'phiT = T1_ss / cTot',
                vars: {
                  phiT: '稳态三线态占比 1',
                  T1_ss: 'T1 稳态浓度',
                  cTot: '总敏化剂浓度',
                },
                sample: { T1_ss: 0.12, cTot: 1 },
                expected: 0.12,
                plainZh: '稳态三线态占比等于 T1 稳态浓度除以总敏化剂',
                plainEn: 'Steady triplet fraction is T1_ss over total sensitizer',
              },
            },
            {
              id: 'path-foundation-gen',
              layer: 'foundation',
              titleZh: '基础式：G_ss = k_q [³O2] T1_ss',
              titleEn: 'Foundation: G_ss = k_q [³O2] T1_ss',
              bodyZh:
                '稳态 ¹O2 生成率。默认 1.5·1·0.12 = 0.18。',
              bodyEn: 'Steady ¹O2 generation; sample 0.18.',
              formula: {
                expr: 'G_ss = k_q * O2 * T1_ss',
                vars: {
                  G_ss: '¹O2 生成率 1/s',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  T1_ss: 'T1 稳态浓度',
                },
                sample: { k_q: 1.5, O2: 1, T1_ss: 0.12 },
                expected: 0.18,
                plainZh: '稳态单线态氧生成率等于 Type II 猝灭率乘 T1 稳态浓度',
                plainEn: 'Steady ¹O2 generation is Type II quench rate times steady T1',
              },
            },
            {
              id: 'path-foundation-O1ss',
              layer: 'foundation',
              titleZh: '基础式：¹O2_ss = G_ss / k_d',
              titleEn: 'Foundation: ¹O2_ss = G_ss / k_d',
              bodyZh:
                '单线态氧池稳态：生成与衰减平衡。默认 0.18/5 = 0.036。',
              bodyEn: 'Steady ¹O2 pool G/k_d; sample 0.036.',
              formula: {
                expr: 'O1_ss = G_ss / k_d',
                vars: {
                  O1_ss: '¹O2 稳态浓度',
                  G_ss: '¹O2 生成率 1/s',
                  k_d: '¹O2 衰减率 1/s',
                },
                sample: { G_ss: 0.18, k_d: 5 },
                expected: 0.036,
                plainZh: '单线态氧稳态浓度等于生成率除以衰减率',
                plainEn: 'Steady ¹O2 concentration is generation over decay rate',
              },
            },
            {
              id: 'path-foundation-conservation',
              layer: 'foundation',
              titleZh: '基础：守恒 S0 + S1 + T1 = C_tot',
              titleEn: 'Foundation: conservation S0 + S1 + T1 = C_tot',
              bodyZh:
                '敏化剂在三电子态间循环，¹O2 自成一池。默认稳态 0.8+0.08+0.12 = 1。',
              bodyEn:
                'Sensitizer conserved across electronic states; ¹O2 separate; sample sum=1.',
              formula: {
                expr: 'c_sum = S0 + S1 + T1',
                vars: {
                  c_sum: '三态浓度和',
                  S0: '基态浓度',
                  S1: 'S1 浓度',
                  T1: 'T1 浓度',
                },
                sample: { S0: 0.8, S1: 0.08, T1: 0.12 },
                expected: 1,
                plainZh: '敏化剂三电子态浓度之和等于总浓度守恒量',
                plainEn: 'Sum of three electronic-state concentrations equals total sensitizer',
              },
            },
            {
              id: 'path-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '伪一级氧/底物池、Type II 为主、线性速率；不含完整 PDT 组织光传输、耗氧耦合或药代。工程 smoke 以 RK4 末态对解析稳态 + 不确定性/技能分残差链（S20h…S20aj）为护栏，非 eng-complete / 未 Atlas 毕业。',
              bodyEn:
                'Pseudo-first-order pools, Type-II-led linear rates; no full tissue optics/PK; smoke = RK4 vs steady + skill residual chain, not eng-complete.',
            },
          ],
        },
        {
          id: 'path-principle-branches',
          layer: 'principle',
          titleZh: '原理：T1 分支 Type II / Type I / 失活',
          titleEn: 'Principle: T1 branches Type II / Type I / deactivation',
          bodyZh:
            'T1 去激三道伪一级率归一：氧 ↑ 抬升 Type II 占比并抢占 Type I 与氧无关失活。',
          bodyEn:
            'Normalized T1 exit channels; higher O2 raises Type II share.',
          children: [
            {
              id: 'path-foundation-typeII',
              layer: 'foundation',
              titleZh: '基础式：f_II = k_q [³O2] / k_T,eff',
              titleEn: 'Foundation: f_II = k_q [³O2] / k_T,eff',
              bodyZh:
                'Type II 分支占比。默认 1.5/2 = 0.75。',
              bodyEn: 'Type II branch fraction; sample 0.75.',
              formula: {
                expr: 'f_II = k_q * O2 / kTeff',
                vars: {
                  f_II: 'Type II 分支占比 1',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: { k_q: 1.5, O2: 1, kTeff: 2 },
                expected: 0.75,
                plainZh: 'Type II 分支占比等于氧猝灭伪一级率除以 T1 总失活率',
                plainEn: 'Type II branch fraction is O2 quench rate over total T1 decay',
              },
            },
            {
              id: 'path-foundation-typeI',
              layer: 'foundation',
              titleZh: '基础式：f_I = k_I [sub] / k_T,eff',
              titleEn: 'Foundation: f_I = k_I [sub] / k_T,eff',
              bodyZh:
                'Type I 分支占比。默认 0.3/2 = 0.15。',
              bodyEn: 'Type I branch fraction; sample 0.15.',
              formula: {
                expr: 'f_I = k_I * substrate / kTeff',
                vars: {
                  f_I: 'Type I 分支占比 1',
                  k_I: 'Type I 速率常数',
                  substrate: '底物浓度',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: { k_I: 0.3, substrate: 1, kTeff: 2 },
                expected: 0.15,
                plainZh: 'Type I 分支占比等于底物道伪一级率除以 T1 总失活率',
                plainEn: 'Type I branch fraction is substrate channel over total T1 decay',
              },
            },
            {
              id: 'path-foundation-deact',
              layer: 'foundation',
              titleZh: '基础式：f_d = k_T / k_T,eff',
              titleEn: 'Foundation: f_d = k_T / k_T,eff',
              bodyZh:
                '氧无关失活分支占比。默认 0.2/2 = 0.1。',
              bodyEn: 'O2-independent deactivation fraction; sample 0.1.',
              formula: {
                expr: 'f_d = k_T / kTeff',
                vars: {
                  f_d: '氧无关失活占比 1',
                  k_T: '氧无关失活率 1/s',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: { k_T: 0.2, kTeff: 2 },
                expected: 0.1,
                plainZh: '氧无关失活分支占比等于 k_T 除以 T1 总失活率',
                plainEn: 'Deactivation branch fraction is k_T over total T1 decay',
              },
            },
            {
              id: 'path-foundation-branch-sum',
              layer: 'foundation',
              titleZh: '基础：f_II + f_I + f_d = 1',
              titleEn: 'Foundation: f_II + f_I + f_d = 1',
              bodyZh:
                '三道分支归一闭合。默认 0.75+0.15+0.1 = 1。',
              bodyEn: 'Three branches sum to 1; sample 1.',
              formula: {
                expr: 'f_sum = f_II + f_I + f_d',
                vars: {
                  f_sum: '分支占比之和',
                  f_II: 'Type II 占比',
                  f_I: 'Type I 占比',
                  f_d: '失活占比',
                },
                sample: { f_II: 0.75, f_I: 0.15, f_d: 0.1 },
                expected: 1,
                plainZh: 'T1 三道分支占比之和必须等于 1',
                plainEn: 'Type II, Type I, and deactivation fractions must sum to one',
              },
            },
          ],
        },
        {
          id: 'path-principle-rk4-skill',
          layer: 'principle',
          titleZh: '原理：RK4 对拍与不确定性技能分',
          titleEn: 'Principle: RK4 gold & uncertainty skill scores',
          bodyZh:
            '经典 RK4 推进轨迹，长时间末态对解析稳态；集合预测上 CRPS/技能分 skill=1−score/score_ref 构成 S20 残差链尖端（至 S20aj）。',
          bodyEn:
            'RK4 trajectories gold against analytic steady state; ensemble skill = 1 − score/score_ref along S20 residual tip.',
          children: [
            {
              id: 'path-foundation-rk4-step',
              layer: 'foundation',
              titleZh: '基础式：y′ = y + (Δt/6)(k1+2k2+2k3+k4)',
              titleEn: 'Foundation: y′ = y + (Δt/6)(k1+2k2+2k3+k4)',
              bodyZh:
                '经典 RK4 单步。算例 y=0、Δt=0.1、四斜率均为 1 → y′=0.1。',
              bodyEn:
                'Classic RK4 step; sample y=0, dt=0.1, all k=1 → 0.1.',
              formula: {
                expr: 'y_new = y + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)',
                vars: {
                  y_new: '更新后状态分量',
                  y: '当前状态分量',
                  dt: '时间步',
                  k1: 'RK4 斜率 k1',
                  k2: 'RK4 斜率 k2',
                  k3: 'RK4 斜率 k3',
                  k4: 'RK4 斜率 k4',
                },
                sample: { y: 0, dt: 0.1, k1: 1, k2: 1, k3: 1, k4: 1 },
                expected: 0.1,
                plainZh: 'RK4 单步用四斜率加权平均推进状态',
                plainEn: 'RK4 advances state with a weighted average of four slopes',
              },
            },
            {
              id: 'path-foundation-ss-residual',
              layer: 'foundation',
              titleZh: '基础 KPI：相对稳态残差 |T1−T1_ss|/T1_ss',
              titleEn: 'Foundation KPI: relative steady residual |T1−T1_ss|/T1_ss',
              bodyZh:
                'RK4 末态对解析 T1_ss 的相对偏差。算例 |0.12012−0.12|/0.12 = 0.001。',
              bodyEn:
                'Relative end-state error vs analytic T1_ss; sample 0.001.',
              formula: {
                expr: 'res = abs(T1 - T1_ss) / abs(T1_ss)',
                vars: {
                  res: '相对稳态残差 1',
                  T1: '数值末态 T1',
                  T1_ss: '解析稳态 T1',
                },
                sample: { T1: 0.12012, T1_ss: 0.12 },
                expected: 0.001,
                plainZh: '相对稳态残差等于数值 T1 相对解析稳态的绝对偏差比',
                plainEn: 'Relative steady residual is |T1−T1_ss| over |T1_ss|',
              },
            },
            {
              id: 'path-foundation-skill',
              layer: 'foundation',
              titleZh: '基础式：skill = 1 − score / score_ref',
              titleEn: 'Foundation: skill = 1 − score / score_ref',
              bodyZh:
                '通用技能分：预报评分相对参考（气候/朴素）改进比例。score 越小越好时 skill∈(−∞,1]；算例 1−0.2/0.5 = 0.6。对应 solvers 残差链 CRPS/Brier/log-skill 等（S20ab…S20aj）。',
              bodyEn:
                'Generic skill vs reference score; sample 0.6; maps CRPS/Brier/log-skill residual chain.',
              formula: {
                expr: 'skill = 1 - score / score_ref',
                vars: {
                  skill: '技能分 1',
                  score: '预报评分（越小越好）',
                  score_ref: '参考评分',
                },
                sample: { score: 0.2, score_ref: 0.5 },
                expected: 0.6,
                plainZh: '技能分等于一减去预报评分与参考评分之比',
                plainEn: 'Skill score is one minus forecast score over reference score',
              },
            },
            {
              id: 'path-foundation-crps-skill',
              layer: 'foundation',
              titleZh: '基础式：CRPS skill = 1 − CRPS / CRPS_ref',
              titleEn: 'Foundation: CRPS skill = 1 − CRPS / CRPS_ref',
              bodyZh:
                '连续排序概率评分的技能化：集合预报相对气候参考。算例 CRPS=0.08、CRPS_ref=0.2 → skill=0.6。',
              bodyEn:
                'CRPS skill vs climatology; sample 0.6.',
              formula: {
                expr: 'crps_skill = 1 - CRPS / CRPS_ref',
                vars: {
                  crps_skill: 'CRPS 技能分 1',
                  CRPS: '集合 CRPS',
                  CRPS_ref: '参考 CRPS',
                },
                sample: { CRPS: 0.08, CRPS_ref: 0.2 },
                expected: 0.6,
                plainZh: 'CRPS 技能分等于一减去集合 CRPS 与参考 CRPS 之比',
                plainEn: 'CRPS skill is one minus ensemble CRPS over reference CRPS',
              },
            },
          ],
        },
        {
          id: 'path-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-path-experiment',
          titleEn: 'Engineering: solvers-path-experiment',
          bodyZh:
            'JobKind `path-experiment` 由 @w-sim/solvers-path-experiment 拥有；WaveWorld Host/golden 路径挂 photosensitization-rk4 与稳态模型。包成熟度 smoke，残差尖端 S20bq（midTailGap/interDecileGap + rangePercentileTailIdentityAbs after S20bp upperTailGap/lowerTailGap + rangeIqrIdentityAbs dual；S20bp tail 恒等），未 Atlas 毕业、不计 eng DoD。',
          bodyEn:
            'Owned by @w-sim/solvers-path-experiment; Host golden wires photosensitization-rk4; smoke tip S20bq midTailGap/interDecileGap + rangePercentileTailIdentityAbs after S20bp upperTailGap/lowerTailGap + rangeIqrIdentityAbs dual; not Atlas/eng DoD.',
          jobKinds: ['path-experiment'],
        },
        {
          id: 'path-compose-note',
          layer: 'compose',
          titleZh: '合成视角：Jablonski 稳态 ∘ RK4/技能分 ≈ 路径实验方法',
          titleEn: 'Compose: Jablonski steady ∘ RK4/skill ≈ path-experiment method',
          bodyZh:
            '科技树语义：更基础的「k_T,eff / a / b / S0·S1 稳态 / f_II / RK4 单步 / skill·残差 / V-measure·AMI·ARI 聚类技能 / skill envelope min·RMS·max / envelope CV·skew·rmsMinGap / envelope kurtosis·maxMinGap / envelope MAD·IQR·medianMeanGap / percentile p90−p10·rangeIqrGap / rangePercentileGap·percentileIqrGap / upperTailGap·lowerTailGap·rangeIqrIdentityAbs / midTailGap·interDecileGap·rangePercentileTailIdentityAbs」与「Type II 生成两路合同」合成应在等价域复现顶层 path-experiment KPI（守恒、φ_T、G_ss 两路闭合、¹O2、稳态残差、技能分、分支归一、V-measure、AMI skill、ARI skill、quinqueviguple/sexviguple mean skill、skill dual max residual、skill envelope ordered honesty、envelope 高阶矩、excess kurtosis、max↔min dual、MAD/IQR dual、median↔mean gap、percentile gap、rangeIqrGap dual、rangePercentileGap、percentileIqrGap dual、upperTailGap、lowerTailGap、rangeIqrIdentityAbs、midTailGap、interDecileGap、rangePercentileTailIdentityAbs）。数值 residual tip 桥接 @w-sim/solvers-path-experiment S20bh V-measure/AMI quinqueviguple + S20bi V-measure/ARI sexviguple skill expand + S20bj skill envelope min/RMS dual of max + S20bk envelope CV/skew + rmsMinGap + S20bl envelope kurtosis + maxMinGap/maxRmsGap dual residual + S20bm MAD/IQR + medianMeanGap dual residual + S20bn percentile p90−p10 + rangeIqrGap dual residual + S20bo rangePercentileGap / percentileIqrGap dual residual + S20bp upperTailGap/lowerTailGap + rangeIqrIdentityAbs + S20bq midTailGap/interDecileGap + rangePercentileTailIdentityAbs（landed；下接 S20br）——**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Composing kTeff/a/b/S0·S1/f_II/RK4/skill residual + V-measure/AMI/ARI clustering skills + skill envelope min·RMS·max + envelope CV·skew·rmsMinGap + envelope kurtosis·maxMinGap + envelope MAD·IQR·medianMeanGap + percentile p90−p10·rangeIqrGap + rangePercentileGap·percentileIqrGap + upperTailGap·lowerTailGap·rangeIqrIdentityAbs + midTailGap·interDecileGap·rangePercentileTailIdentityAbs + dual G paths should reproduce conservation, φ_T, G closure, ¹O2, residual, skill, branch, V-measure, AMI skill, ARI skill, quinqueviguple/sexviguple mean skill, skill dual max residual, skill envelope ordered honesty, envelope higher-moment, excess kurtosis, max↔min dual, MAD/IQR dual, median↔mean gap, percentile gap, rangeIqrGap dual, rangePercentileGap, percentileIqrGap dual, upperTailGap, lowerTailGap, rangeIqrIdentityAbs, midTailGap, interDecileGap, and rangePercentileTailIdentityAbs KPIs; bridges @w-sim/solvers-path-experiment S20bh V-measure/AMI quinqueviguple + S20bi V-measure/ARI sexviguple skill expand + S20bj skill envelope min/RMS dual of max + S20bk envelope CV/skew + rmsMinGap + S20bl envelope kurtosis + maxMinGap/maxRmsGap dual residual + S20bm MAD/IQR + medianMeanGap dual residual + S20bn percentile p90−p10 + rangeIqrGap dual residual + S20bo rangePercentileGap / percentileIqrGap dual residual + S20bp upperTailGap/lowerTailGap + rangeIqrIdentityAbs + S20bq midTailGap/interDecileGap + rangePercentileTailIdentityAbs (landed; next S20br) — smoke residual expand ≠ eng DoD / Atlas graduation.',
          children: [
            {
              id: 'path-compose-phi-from-ab',
              layer: 'foundation',
              titleZh: '合成：φ_T = a b / (1 + a + a b)',
              titleEn: 'Compose: φ_T = a b / (1 + a + a b)',
              bodyZh:
                '把 a、b 直接合成三线态占比，无需先写 S0。默认 0.1·1.5 / 1.25 = 0.12，与 T1_ss/C_tot 合同。',
              bodyEn:
                'φ_T from a,b alone; sample 0.12 contracts with T1_ss/C_tot.',
              formula: {
                expr: 'phiT = (a * b) / (1 + a + a * b)',
                vars: {
                  phiT: '稳态三线态占比 1',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                },
                sample: { a: 0.1, b: 1.5 },
                expected: 0.12,
                plainZh: '稳态三线态占比可由 a、b 直接合成，无需先算各态浓度',
                plainEn: 'Steady triplet fraction composes directly from a and b',
              },
            },
            {
              id: 'path-compose-G-from-T1',
              layer: 'foundation',
              titleZh: '合成：G_ss = k_q [³O2] · φ_T · C_tot',
              titleEn: 'Compose: G_ss = k_q [³O2] · φ_T · C_tot',
              bodyZh:
                '把占比与总浓度合成生成率：G = k_q O2 φ_T C_tot。默认 1.5·1·0.12·1 = 0.18。',
              bodyEn:
                'Generation from quench, φ_T, and C_tot; sample 0.18.',
              formula: {
                expr: 'G_ss = k_q * O2 * phiT * cTot',
                vars: {
                  G_ss: '¹O2 生成率 1/s',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  phiT: '稳态三线态占比',
                  cTot: '总敏化剂浓度',
                },
                sample: { k_q: 1.5, O2: 1, phiT: 0.12, cTot: 1 },
                expected: 0.18,
                plainZh: '单线态氧生成率由 Type II 猝灭、三线态占比与总浓度合成',
                plainEn: '¹O2 generation composes quench rate, triplet fraction, and total concentration',
              },
            },
            {
              id: 'path-compose-skill-vs-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：技能分与稳态残差并置',
              titleEn: 'Compose KPI: skill alongside steady residual',
              bodyZh:
                '教学合同：动力学路径用 res=|T1−T1_ss|/|T1_ss|，集合路径用 skill=1−score/score_ref。算例 skill 与 (1−res) 在 res=0.001 时接近 0.999（示意尺度，非同一量纲强制相等）。',
              bodyEn:
                'Dynamics residual and ensemble skill sit side-by-side; sample 1−0.001=0.999 as teaching juxtaposition only.',
              formula: {
                expr: 'one_minus_res = 1 - res',
                vars: {
                  one_minus_res: '1 − 相对残差（教学并置）',
                  res: '相对稳态残差 1',
                },
                sample: { res: 0.001 },
                expected: 0.999,
                plainZh: '教学上可将 1 减相对稳态残差与技能分并置对照',
                plainEn: 'Teaching juxtaposition: one minus relative residual sits beside skill scores',
              },
            },
            {
              id: 'path-compose-T1ss-from-ab',
              layer: 'foundation',
              titleZh: '合成：T1_ss = a b C_tot / (1 + a + a b)',
              titleEn: 'Compose: T1_ss = a b C_tot / (1 + a + a b)',
              bodyZh:
                '把 a、b 与总浓度直接合成三线态稳态浓度：T1_ss = φ_T C_tot = a b C_tot/(1+a+a b)。默认 a=0.1、b=1.5、C_tot=1 → T1_ss=0.12，与 S0→S1→T1 链合同。',
              bodyEn:
                'Composes a,b,C_tot into steady T1; sample 0.12 contracts with S0→S1→T1 chain.',
              formula: {
                expr: 'T1_ss = (a * b * cTot) / (1 + a + a * b)',
                vars: {
                  T1_ss: 'T1 稳态浓度',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                  cTot: '总敏化剂浓度',
                },
                sample: { a: 0.1, b: 1.5, cTot: 1 },
                expected: 0.12,
                plainZh: '三线态稳态浓度可由 a、b 与总浓度直接合成',
                plainEn: 'Steady T1 composes directly from a, b, and total concentration',
              },
            },
            {
              id: 'path-compose-O1ss-from-phi',
              layer: 'foundation',
              titleZh: '合成：¹O2_ss = k_q [³O2] φ_T C_tot / k_d',
              titleEn: 'Compose: ¹O2_ss = k_q [³O2] φ_T C_tot / k_d',
              bodyZh:
                '把 Type II 猝灭、三线态占比、总浓度与 ¹O2 衰减合成单线态氧池稳态：¹O2_ss = G_ss/k_d = k_q O2 φ_T C_tot / k_d。默认 1.5·1·0.12·1/5 = 0.036。',
              bodyEn:
                'Composes quench, φ_T, C_tot, and k_d into steady ¹O2; sample 0.036.',
              formula: {
                expr: 'O1_ss = k_q * O2 * phiT * cTot / k_d',
                vars: {
                  O1_ss: '¹O2 稳态浓度',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  phiT: '稳态三线态占比',
                  cTot: '总敏化剂浓度',
                  k_d: '¹O2 衰减率 1/s',
                },
                sample: { k_q: 1.5, O2: 1, phiT: 0.12, cTot: 1, k_d: 5 },
                expected: 0.036,
                plainZh: '单线态氧稳态由 Type II 猝灭、三线态占比、总浓度与衰减率合成',
                plainEn:
                  'Steady ¹O2 composes Type II quench, triplet fraction, total concentration, and decay',
              },
            },
            {
              id: 'path-compose-phi-from-rates',
              layer: 'foundation',
              titleZh: '合成：φ_T 从原始速率链',
              titleEn: 'Compose: φ_T from raw rate chain',
              bodyZh:
                '把激发/出射/ISC/T1 失活合成：a=k_exc/(k_f+k_isc)、kTeff=k_T+k_q O2+k_I sub、b=k_isc/kTeff，再 φ_T=a b/(1+a+a b)。默认算例 → 0.12，闭合 Jablonski 速率→占比合同。',
              bodyEn:
                'Full chain a,b from raw rates then φ_T; sample defaults → 0.12.',
              formula: {
                expr: 'phiT = (a * b) / (1 + a + a * b)',
                vars: {
                  phiT: '稳态三线态占比 1',
                  a: 'S1/S0 = k_exc/(k_f+k_isc)',
                  b: 'T1/S1 = k_isc/kTeff',
                },
                sample: {
                  // a = 0.5/(2+3)=0.1, b = 3/2=1.5 from default rates
                  a: 0.5 / (2 + 3),
                  b: 3 / 2,
                },
                expected: 0.12,
                plainZh: '稳态三线态占比由原始速率导出的 a、b 合成',
                plainEn: 'Steady triplet fraction composes from a and b derived from raw rates',
              },
            },
            {
              id: 'path-compose-G-from-fII',
              layer: 'foundation',
              titleZh: '合成：G_ss = f_II · k_T,eff · T1_ss',
              titleEn: 'Compose: G_ss = f_II · k_T,eff · T1_ss',
              bodyZh:
                '把 Type II 分支占比与 T1 总失活、三线态浓度合成生成率：f_II·kTeff = k_q O2，故 G = f_II kTeff T1_ss。默认 0.75·2·0.12 = 0.18，与 k_q O2 T1 合同。',
              bodyEn:
                'Composes branch fraction with kTeff and T1 into generation; sample 0.18 contracts with k_q O2 T1.',
              formula: {
                expr: 'G_ss = f_II * kTeff * T1_ss',
                vars: {
                  G_ss: '¹O2 生成率 1/s',
                  f_II: 'Type II 分支占比 1',
                  kTeff: 'T1 总失活率 1/s',
                  T1_ss: 'T1 稳态浓度',
                },
                sample: { f_II: 0.75, kTeff: 2, T1_ss: 0.12 },
                expected: 0.18,
                plainZh: '单线态氧生成率由 Type II 分支占比、T1 总失活率与 T1 稳态浓度合成',
                plainEn:
                  '¹O2 generation composes Type II branch fraction, total T1 decay, and steady T1',
              },
            },
            {
              id: 'path-compose-conservation-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：守恒残差 |S0+S1+T1−C_tot|/C_tot',
              titleEn: 'Compose KPI: conservation residual |S0+S1+T1−C_tot|/C_tot',
              bodyZh:
                '敏化剂三态守恒合同：相对残差应→0。算例稳态 0.8+0.08+0.12 对 C_tot=1 → 残差 0；RK4 末态若漂移则抬升该 KPI。',
              bodyEn:
                'Sensitizer conservation residual →0 at steady; sample exact sum → 0; RK4 drift raises KPI.',
              formula: {
                expr: 'res = abs(S0 + S1 + T1 - cTot) / abs(cTot)',
                vars: {
                  res: '守恒相对残差 1',
                  S0: '基态浓度',
                  S1: 'S1 浓度',
                  T1: 'T1 浓度',
                  cTot: '总敏化剂浓度',
                },
                sample: { S0: 0.8, S1: 0.08, T1: 0.12, cTot: 1 },
                expected: 0,
                plainZh: '敏化剂三电子态守恒相对残差在稳态合同下应为零',
                plainEn:
                  'Relative residual of three-state sensitizer conservation is zero at the steady contract',
              },
            },
            {
              id: 'path-compose-branch-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：分支归一残差 |f_II+f_I+f_d−1|',
              titleEn: 'Compose KPI: branch-sum residual |f_II+f_I+f_d−1|',
              bodyZh:
                'T1 三道伪一级分支必须归一。算例 0.75+0.15+0.1 → 残差 0；参数改写后若未重算 kTeff 则残差抬升。',
              bodyEn:
                'Three T1 exit fractions must sum to 1; sample residual 0; stale kTeff raises residual.',
              formula: {
                expr: 'res = abs(f_II + f_I + f_d - 1)',
                vars: {
                  res: '分支归一绝对残差 1',
                  f_II: 'Type II 占比',
                  f_I: 'Type I 占比',
                  f_d: '失活占比',
                },
                sample: { f_II: 0.75, f_I: 0.15, f_d: 0.1 },
                expected: 0,
                plainZh: 'T1 三道分支占比之和相对 1 的绝对残差在归一合同时为零',
                plainEn:
                  'Absolute residual of Type II + Type I + deactivation fractions from unity is zero when normalized',
              },
            },
            {
              id: 'path-compose-ab-from-rates',
              layer: 'foundation',
              titleZh: '合成：a、b 由速率参数',
              titleEn: 'Compose: a, b from rate parameters',
              bodyZh:
                '先合成 a=k_exc/(k_f+k_isc)、b=k_isc/kTeff（kTeff 已含氧/底物）。算例 a·b = 0.1·1.5 = 0.15，是 φ_T 分子；再除以 (1+a+a b) 得占比。',
              bodyEn:
                'Composes a and b from rates; sample product a·b=0.15 feeds φ_T numerator.',
              formula: {
                expr: 'ab = a * b',
                vars: {
                  ab: 'a·b 乘积（φ_T 分子）',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                },
                sample: { a: 0.1, b: 1.5 },
                expected: 0.15,
                plainZh: '稳态参数 a 与 b 的乘积构成三线态占比的分子',
                plainEn: 'Product of steady parameters a and b forms the triplet-fraction numerator',
              },
            },
            {
              id: 'path-compose-kteff',
              layer: 'foundation',
              titleZh: '合成：k_T,eff = k_T + k_q[³O2] + k_I[sub]',
              titleEn: 'Compose: k_T,eff = k_T + k_q[³O2] + k_I[sub]',
              bodyZh:
                '把氧无关失活、Type II 猝灭与 Type I 底物道三伪一级率合成 T1 总失活。默认 0.2+1.5+0.3 = 2，再入 b 与 f_II。',
              bodyEn:
                'Composes three pseudo-first-order T1 exits into kTeff; sample 2 feeds b and f_II.',
              formula: {
                expr: 'kTeff = k_T + k_q * O2 + k_I * substrate',
                vars: {
                  kTeff: 'T1 总失活率 1/s',
                  k_T: '氧无关失活率 1/s',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  k_I: 'Type I 速率常数',
                  substrate: '底物浓度',
                },
                sample: {
                  k_T: 0.2,
                  k_q: 1.5,
                  O2: 1,
                  k_I: 0.3,
                  substrate: 1,
                },
                expected: 2,
                plainZh: '三线态总失活率由氧无关、Type II 与 Type I 三道伪一级率合成',
                plainEn:
                  'Triplet total decay composes O2-independent, Type II, and Type I rates',
              },
            },
            {
              id: 'path-compose-a-from-rates',
              layer: 'foundation',
              titleZh: '合成：a = k_exc / (k_f + k_isc)',
              titleEn: 'Compose: a = k_exc / (k_f + k_isc)',
              bodyZh:
                '把激发与 S1 出射（荧光/内转换 + ISC）合成稳态参数 a。默认 0.5/(2+3)=0.1，再入 φ_T 与 S0 链。',
              bodyEn:
                'Composes excitation and S1 outflow into a; sample 0.1 into φ_T/S0 chain.',
              formula: {
                expr: 'a = k_exc / (k_f + k_isc)',
                vars: {
                  a: 'S1/S0 稳态比参数 1',
                  k_exc: '激发率 1/s',
                  k_f: '荧光/内转换率 1/s',
                  k_isc: '系间窜越率 1/s',
                },
                sample: { k_exc: 0.5, k_f: 2, k_isc: 3 },
                expected: 0.1,
                plainZh: '稳态参数 a 由激发率与 S1 总出射率合成',
                plainEn: 'Steady parameter a composes excitation over total S1 outflow',
              },
            },
            {
              id: 'path-compose-b-from-rates',
              layer: 'foundation',
              titleZh: '合成：b = k_isc / k_T,eff',
              titleEn: 'Compose: b = k_isc / k_T,eff',
              bodyZh:
                '把 ISC 进料与合成后的 kTeff 合成稳态参数 b。默认 3/2=1.5，与 a 乘积构成 φ_T 分子。',
              bodyEn:
                'Composes ISC and kTeff into b; sample 1.5; a·b feeds φ_T numerator.',
              formula: {
                expr: 'b = k_isc / kTeff',
                vars: {
                  b: 'T1/S1 稳态比参数 1',
                  k_isc: '系间窜越率 1/s',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: { k_isc: 3, kTeff: 2 },
                expected: 1.5,
                plainZh: '稳态参数 b 由 ISC 率与 T1 总失活率合成',
                plainEn: 'Steady parameter b composes ISC rate over total T1 decay',
              },
            },
            {
              id: 'path-compose-S0ss-from-ab',
              layer: 'foundation',
              titleZh: '合成：S0_ss = C_tot / (1 + a + a b)',
              titleEn: 'Compose: S0_ss = C_tot / (1 + a + a b)',
              bodyZh:
                '把 a、b 与总浓度合成基态稳态。默认 C_tot=1、a=0.1、b=1.5 → S0=0.8，与 S1=a S0、T1=a b S0 合同。',
              bodyEn:
                'Composes a,b,C_tot into steady S0; sample 0.8 contracts with S1/T1 chain.',
              formula: {
                expr: 'S0_ss = cTot / (1 + a + a * b)',
                vars: {
                  S0_ss: '基态稳态浓度',
                  cTot: '总敏化剂浓度',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                },
                sample: { cTot: 1, a: 0.1, b: 1.5 },
                expected: 0.8,
                plainZh: '基态稳态浓度由总敏化剂与 a、b 分支参数合成',
                plainEn: 'Steady S0 composes total sensitizer with branch parameters a and b',
              },
            },
            {
              id: 'path-compose-S1ss-from-ab',
              layer: 'foundation',
              titleZh: '合成：S1_ss = a C_tot / (1 + a + a b)',
              titleEn: 'Compose: S1_ss = a C_tot / (1 + a + a b)',
              bodyZh:
                '把 a、b、C_tot 直接合成 S1 稳态（= a S0_ss）。默认 a·1/1.25 = 0.08，闭合 Jablonski 中间态。',
              bodyEn:
                'Composes a,b,C_tot into steady S1 (=a S0); sample 0.08 closes intermediate state.',
              formula: {
                expr: 'S1_ss = (a * cTot) / (1 + a + a * b)',
                vars: {
                  S1_ss: 'S1 稳态浓度',
                  a: 'S1/S0 参数',
                  b: 'T1/S1 参数',
                  cTot: '总敏化剂浓度',
                },
                sample: { a: 0.1, b: 1.5, cTot: 1 },
                expected: 0.08,
                plainZh: 'S1 稳态浓度可由 a、b 与总浓度直接合成',
                plainEn: 'Steady S1 composes directly from a, b, and total concentration',
              },
            },
            {
              id: 'path-compose-fII-from-rates',
              layer: 'foundation',
              titleZh: '合成：f_II = k_q [³O2] / k_T,eff',
              titleEn: 'Compose: f_II = k_q [³O2] / k_T,eff',
              bodyZh:
                '把 Type II 猝灭伪一级率与 kTeff 合成分支占比。默认 1.5/2=0.75，再入 G=f_II kTeff T1。',
              bodyEn:
                'Composes quench rate over kTeff into f_II; sample 0.75 into dual-G path.',
              formula: {
                expr: 'f_II = k_q * O2 / kTeff',
                vars: {
                  f_II: 'Type II 分支占比 1',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: { k_q: 1.5, O2: 1, kTeff: 2 },
                expected: 0.75,
                plainZh: 'Type II 分支占比由氧猝灭伪一级率与 T1 总失活率合成',
                plainEn:
                  'Type II branch fraction composes O2 quench rate over total T1 decay',
              },
            },
            {
              id: 'path-compose-rk4-step',
              layer: 'foundation',
              titleZh: '合成：RK4 单步 y′ = y + (Δt/6)(k1+2k2+2k3+k4)',
              titleEn: 'Compose: RK4 step y′ = y + (Δt/6)(k1+2k2+2k3+k4)',
              bodyZh:
                '把四斜率与时间步合成经典 RK4 推进；教学算例 y=0、Δt=0.1、全斜率 1 → y′=0.1，再与稳态残差 KPI 并置。',
              bodyEn:
                'Composes four slopes and dt into classic RK4; sample 0.1 sits with residual KPI.',
              formula: {
                expr: 'y_new = y + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)',
                vars: {
                  y_new: '更新后状态分量',
                  y: '当前状态分量',
                  dt: '时间步',
                  k1: 'RK4 斜率 k1',
                  k2: 'RK4 斜率 k2',
                  k3: 'RK4 斜率 k3',
                  k4: 'RK4 斜率 k4',
                },
                sample: { y: 0, dt: 0.1, k1: 1, k2: 1, k3: 1, k4: 1 },
                expected: 0.1,
                plainZh: 'RK4 单步由四斜率加权平均与时间步合成状态推进',
                plainEn:
                  'RK4 step composes four weighted slopes with dt into the state update',
              },
            },
            {
              id: 'path-compose-ss-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：相对稳态残差 |T1−T1_ss|/|T1_ss|',
              titleEn: 'Compose KPI: relative steady residual |T1−T1_ss|/|T1_ss|',
              bodyZh:
                '把 RK4 末态 T1 与解析 T1_ss 合成相对残差 KPI。算例 |0.12012−0.12|/0.12=0.001，与 skill 并置。',
              bodyEn:
                'Composes numerical end-state vs analytic T1_ss into residual KPI; sample 0.001 beside skill.',
              formula: {
                expr: 'res = abs(T1 - T1_ss) / abs(T1_ss)',
                vars: {
                  res: '相对稳态残差 1',
                  T1: '数值末态 T1',
                  T1_ss: '解析稳态 T1',
                },
                sample: { T1: 0.12012, T1_ss: 0.12 },
                expected: 0.001,
                plainZh: '相对稳态残差由数值 T1 与解析稳态合成，衡量 RK4 对拍',
                plainEn:
                  'Relative steady residual composes numerical T1 vs analytic steady for RK4 gold',
              },
            },
            {
              id: 'path-compose-skill',
              layer: 'foundation',
              titleZh: '合成：skill = 1 − score / score_ref',
              titleEn: 'Compose: skill = 1 − score / score_ref',
              bodyZh:
                '把预报评分与参考评分合成技能分（越小越好类评分）。算例 1−0.2/0.5=0.6；CRPS/Brier/log-skill 同形。',
              bodyEn:
                'Composes forecast vs reference score into skill; sample 0.6; same shape for CRPS/Brier/log.',
              formula: {
                expr: 'skill = 1 - score / score_ref',
                vars: {
                  skill: '技能分 1',
                  score: '预报评分（越小越好）',
                  score_ref: '参考评分',
                },
                sample: { score: 0.2, score_ref: 0.5 },
                expected: 0.6,
                plainZh: '技能分由预报评分与参考评分之比合成',
                plainEn: 'Skill score composes as one minus forecast over reference score',
              },
            },
            {
              id: 'path-compose-G-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：G 两路闭合 |k_q O2 T1 − f_II kTeff T1|',
              titleEn: 'Compose KPI: dual-G closure |k_q O2 T1 − f_II kTeff T1|',
              bodyZh:
                'Type II 生成两路应合同：G=k_q O2 T1 与 G=f_II kTeff T1（因 f_II=k_q O2/kTeff）。算例两侧均为 0.18 → 残差 0。',
              bodyEn:
                'Dual generation paths must match; sample both 0.18 → residual 0 when f_II contracts.',
              formula: {
                expr: 'res = abs(k_q * O2 * T1_ss - f_II * kTeff * T1_ss)',
                vars: {
                  res: 'G 两路绝对残差 1/s',
                  k_q: 'Type II 猝灭常数',
                  O2: '基态氧浓度',
                  T1_ss: 'T1 稳态浓度',
                  f_II: 'Type II 分支占比',
                  kTeff: 'T1 总失活率 1/s',
                },
                sample: {
                  k_q: 1.5,
                  O2: 1,
                  T1_ss: 0.12,
                  f_II: 0.75,
                  kTeff: 2,
                },
                expected: 0,
                plainZh: '单线态氧生成两路（猝灭直算与分支占比）闭合时残差应为零',
                plainEn:
                  'Dual ¹O2 generation paths (direct quench vs branch fraction) residual is zero when closed',
              },
            },
            {
              id: 'path-compose-phi-match-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：φ_T 两路闭合 |ab/(1+a+ab) − T1/C_tot|',
              titleEn: 'Compose KPI: φ_T dual closure |ab/(1+a+ab) − T1/C_tot|',
              bodyZh:
                '占比两路应合同：φ=ab/(1+a+ab) 与 φ=T1_ss/C_tot。算例两侧 0.12 → 残差 0。',
              bodyEn:
                'Triplet fraction dual paths must match; sample both 0.12 → residual 0.',
              formula: {
                expr: 'res = abs(phi_ab - T1_ss / cTot)',
                vars: {
                  res: 'φ_T 两路绝对残差 1',
                  phi_ab: '由 a、b 合成的三线态占比',
                  T1_ss: 'T1 稳态浓度',
                  cTot: '总敏化剂浓度',
                },
                sample: { phi_ab: 0.12, T1_ss: 0.12, cTot: 1 },
                expected: 0,
                plainZh: '三线态占比由 a·b 闭式与 T1/C_tot 两路合成时应闭合为零残差',
                plainEn:
                  'Triplet-fraction residual between ab closed form and T1/C_tot is zero when closed',
              },
            },
            {
              id: 'path-compose-O1-from-G',
              layer: 'foundation',
              titleZh: '合成：¹O2_ss = G_ss / k_d',
              titleEn: 'Compose: ¹O2_ss = G_ss / k_d',
              bodyZh:
                '把生成率与 ¹O2 衰减合成氧池稳态。默认 G=0.18、k_d=5 → 0.036，与 k_q O2 φ_T C_tot/k_d 合同。',
              bodyEn:
                'Composes generation over decay into ¹O2 pool; sample 0.036 contracts with quench path.',
              formula: {
                expr: 'O1_ss = G_ss / k_d',
                vars: {
                  O1_ss: '¹O2 稳态浓度',
                  G_ss: '¹O2 生成率 1/s',
                  k_d: '¹O2 衰减率 1/s',
                },
                sample: { G_ss: 0.18, k_d: 5 },
                expected: 0.036,
                plainZh: '单线态氧稳态由生成率与衰减率合成',
                plainEn: 'Steady ¹O2 composes generation rate over decay rate',
              },
            },
            {
              id: 'path-compose-crps-skill',
              layer: 'foundation',
              titleZh: '合成：CRPS skill = 1 − CRPS / CRPS_ref',
              titleEn: 'Compose: CRPS skill = 1 − CRPS / CRPS_ref',
              bodyZh:
                '把集合 CRPS 与气候参考合成 CRPS 技能分。算例 1−0.08/0.2=0.6，与通用 skill 同形，对接 S20 残差链。',
              bodyEn:
                'Composes ensemble CRPS vs climatology into skill; sample 0.6; same shape as generic skill.',
              formula: {
                expr: 'crps_skill = 1 - CRPS / CRPS_ref',
                vars: {
                  crps_skill: 'CRPS 技能分 1',
                  CRPS: '集合 CRPS',
                  CRPS_ref: '参考 CRPS',
                },
                sample: { CRPS: 0.08, CRPS_ref: 0.2 },
                expected: 0.6,
                plainZh: 'CRPS 技能分由集合 CRPS 与参考 CRPS 合成',
                plainEn: 'CRPS skill composes ensemble CRPS over reference CRPS',
              },
            },
            // S20bh V-measure / AMI quinqueviguple skill residual packaging (wave28 residual compose expand)
            {
              id: 'path-compose-v-measure',
              layer: 'foundation',
              titleZh: '合成：V = 2 h c / (h + c) V-measure',
              titleEn: 'Compose: V = 2 h c / (h + c) V-measure',
              bodyZh:
                'S20bh 聚类诚实入口：V-measure 为同质度 h 与完整度 c 的调和均值。算例 h=0.9、c=0.8 → V=1.44/1.7≈0.847；桥接 AMI/NMI skill expand。',
              bodyEn:
                'S20bh clustering honesty entry: V-measure is harmonic mean of homogeneity h and completeness c; sample 0.9,0.8 → ≈0.847; bridges AMI/NMI skill expand.',
              formula: {
                expr: 'V = 2 * h * c / (h + c)',
                vars: {
                  V: 'V-measure 1',
                  h: '同质度 homogeneity 1',
                  c: '完整度 completeness 1',
                },
                sample: { h: 0.9, c: 0.8 },
                expected: (2 * 0.9 * 0.8) / (0.9 + 0.8),
                plainZh: 'V-measure 等于同质度与完整度之积的两倍除以二者之和',
                plainEn:
                  'V-measure is twice the product of homogeneity and completeness over their sum',
              },
            },
            {
              id: 'path-compose-v-measure-skill',
              layer: 'foundation',
              titleZh: '合成：V-skill = 1 − (1−V) / (1−V_ref)',
              titleEn: 'Compose: V-skill = 1 − (1−V) / (1−V_ref)',
              bodyZh:
                '把 V-measure 损失 1−V 相对参考合成技能分。算例 V=0.8、V_ref=0.5 → 1−0.2/0.5=0.6；与 CRPS/Brier skill 同形。',
              bodyEn:
                'Composes V-measure loss 1−V vs reference into skill; sample V=0.8, V_ref=0.5 → 0.6; same shape as CRPS/Brier skill.',
              formula: {
                expr: 'V_skill = 1 - (1 - V) / (1 - V_ref)',
                vars: {
                  V_skill: 'V-measure 技能分 1',
                  V: '预报 V-measure 1',
                  V_ref: '参考 V-measure 1',
                },
                sample: { V: 0.8, V_ref: 0.5 },
                expected: 0.6,
                plainZh: 'V-measure 技能分由预报与参考 V 的损失比合成',
                plainEn:
                  'V-measure skill composes from forecast and reference V-measure losses',
              },
            },
            {
              id: 'path-compose-ami-skill',
              layer: 'foundation',
              titleZh: '合成：AMI skill = 1 − score_AMI / score_ref',
              titleEn: 'Compose: AMI skill = 1 − score_AMI / score_ref',
              bodyZh:
                'S20bh quinqueviguple 末端：调整互信息技能分与通用 skill 同形。算例 1−0.2/0.5=0.6；与 NMI/V-measure 组成 clustering dual。',
              bodyEn:
                'S20bh quinqueviguple tip: AMI skill same shape as generic skill; sample 0.6; pairs with NMI/V-measure clustering dual.',
              formula: {
                expr: 'ami_skill = 1 - score_AMI / score_ref',
                vars: {
                  ami_skill: 'AMI 技能分 1',
                  score_AMI: 'AMI 损失评分（越小越好）',
                  score_ref: '参考评分',
                },
                sample: { score_AMI: 0.2, score_ref: 0.5 },
                expected: 0.6,
                plainZh: 'AMI 技能分由 AMI 损失评分与参考评分之比合成',
                plainEn:
                  'AMI skill composes as one minus AMI loss score over reference score',
              },
            },
            {
              id: 'path-compose-nmi-skill',
              layer: 'foundation',
              titleZh: '合成：NMI skill = 1 − score_NMI / score_ref',
              titleEn: 'Compose: NMI skill = 1 − score_NMI / score_ref',
              bodyZh:
                '归一化互信息技能分；与 AMI skill 匹配时 dual residual→0。算例 0.6；桥接 S20bg NMI → S20bh AMI expand。',
              bodyEn:
                'NMI skill; matched with AMI skill → dual residual 0; sample 0.6; bridges S20bg NMI → S20bh AMI expand.',
              formula: {
                expr: 'nmi_skill = 1 - score_NMI / score_ref',
                vars: {
                  nmi_skill: 'NMI 技能分 1',
                  score_NMI: 'NMI 损失评分（越小越好）',
                  score_ref: '参考评分',
                },
                sample: { score_NMI: 0.2, score_ref: 0.5 },
                expected: 0.6,
                plainZh: 'NMI 技能分由 NMI 损失评分与参考评分之比合成',
                plainEn:
                  'NMI skill composes as one minus NMI loss score over reference score',
              },
            },
            {
              id: 'path-compose-v-ami-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|V_skill − AMI_skill| V↔AMI dual 残差',
              titleEn: 'Compose KPI: |V_skill − AMI_skill| V↔AMI dual residual',
              bodyZh:
                'S20bh clustering dual：V-measure skill 与 AMI skill 应紧致。算例两者 0.6 → 残差 0；容差内为诚实。',
              bodyEn:
                'S20bh clustering dual: V-measure skill vs AMI skill; sample matched 0.6 → 0; honesty within tol.',
              formula: {
                expr: 'res = abs(V_skill - ami_skill)',
                vars: {
                  res: 'V↔AMI dual 绝对残差 1',
                  V_skill: 'V-measure 技能分 1',
                  ami_skill: 'AMI 技能分 1',
                },
                sample: { V_skill: 0.6, ami_skill: 0.6 },
                expected: 0,
                plainZh: 'V-measure 与 AMI 技能分之差的绝对值衡量聚类 dual 诚实',
                plainEn:
                  'Absolute difference of V-measure and AMI skills measures clustering dual honesty',
              },
            },
            {
              id: 'path-compose-nmi-ami-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|NMI_skill − AMI_skill| NMI↔AMI dual 残差',
              titleEn: 'Compose KPI: |NMI_skill − AMI_skill| NMI↔AMI dual residual',
              bodyZh:
                'NMI 与 AMI 技能 dual：匹配诚实包残差→0。算例两侧 0.6 → 0；与 V↔AMI dual 并置。',
              bodyEn:
                'NMI↔AMI skill dual; matched honest pack → 0; sample 0.6; sits with V↔AMI dual.',
              formula: {
                expr: 'res = abs(nmi_skill - ami_skill)',
                vars: {
                  res: 'NMI↔AMI dual 绝对残差 1',
                  nmi_skill: 'NMI 技能分 1',
                  ami_skill: 'AMI 技能分 1',
                },
                sample: { nmi_skill: 0.6, ami_skill: 0.6 },
                expected: 0,
                plainZh: 'NMI 与 AMI 技能分之差的绝对值衡量互信息 dual 诚实',
                plainEn:
                  'Absolute difference of NMI and AMI skills measures mutual-information dual honesty',
              },
            },
            {
              id: 'path-compose-quinqueviguple-mean-skill',
              layer: 'foundation',
              titleZh: '合成：mean_skill = (Σ skill_i) / 25 quinqueviguple 均值',
              titleEn: 'Compose: mean_skill = (Σ skill_i) / 25 quinqueviguple mean',
              bodyZh:
                'S20bh：25 路技能（Brier…AMI）算术均值。教学金标全 0.6 → mean=0.6；桥接 mean quinqueviguple skill KPI。',
              bodyEn:
                'S20bh mean of 25 skills (Brier…AMI); teaching gold all 0.6 → mean 0.6; bridges mean quinqueviguple skill KPI.',
              formula: {
                expr: 'mean_skill = skill_sum / 25',
                vars: {
                  mean_skill: 'quinqueviguple 平均技能分 1',
                  skill_sum: '25 路技能分之和 1',
                },
                sample: { skill_sum: 0.6 * 25 },
                expected: 0.6,
                plainZh: 'quinqueviguple 平均技能分等于二十五路技能分之和除以 25',
                plainEn:
                  'Quinqueviguple mean skill is the sum of twenty-five skill scores divided by 25',
              },
            },
            {
              id: 'path-compose-skill-dual-max-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：max_ij |skill_i − skill_j| 技能 dual 上确界',
              titleEn: 'Compose KPI: max_ij |skill_i − skill_j| skill dual upper bound',
              bodyZh:
                'S20bh：quinqueviguple 内最大成对技能差。紧致诚实包 → 0。算例 skill 全等 → 0；松散包抬升残差。',
              bodyEn:
                'S20bh max pairwise skill spread among quinqueviguple; tight honest pack → 0; sample all-equal → 0.',
              formula: {
                expr: 'res = max_ij_abs_skill_diff',
                vars: {
                  res: '技能 dual 最大绝对差 1',
                  max_ij_abs_skill_diff: '成对 |skill_i−skill_j| 上确界 1',
                },
                sample: { max_ij_abs_skill_diff: 0 },
                expected: 0,
                plainZh: '技能 dual 上确界取 quinqueviguple 内成对技能差之最大',
                plainEn:
                  'Skill dual upper bound is the maximum pairwise absolute skill difference in the quinqueviguple',
              },
            },
            {
              id: 'path-compose-v-measure-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：vMeasureHonest 联合门（0/1）',
              titleEn: 'Compose KPI: vMeasureHonest joint gate (0/1)',
              bodyZh:
                'S20bh packaging：V-skill 诚实 ∧ AMI skill 诚实 ∧ V↔AMI dual→0 ∧ NMI↔AMI dual→0 ∧ skill dual max→0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bh packaging: V-skill ∧ AMI skill ∧ V↔AMI dual→0 ∧ NMI↔AMI dual→0 ∧ skill dual max→0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_V * c_AMI * c_VA * c_NA * c_max',
                vars: {
                  gate: 'V-measure 包装诚实门 0/1',
                  c_V: 'V-skill 诚实 0/1',
                  c_AMI: 'AMI skill 诚实 0/1',
                  c_VA: 'V↔AMI dual 诚实 0/1',
                  c_NA: 'NMI↔AMI dual 诚实 0/1',
                  c_max: 'skill dual max 诚实 0/1',
                },
                sample: { c_V: 1, c_AMI: 1, c_VA: 1, c_NA: 1, c_max: 1 },
                expected: 1,
                plainZh: 'V-measure 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'V-measure packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S20bi V-measure sexviguple skill dual residual packaging (wave29 residual compose expand)
            {
              id: 'path-compose-ari-skill',
              layer: 'foundation',
              titleZh: '合成：ARI skill = 1 − score_ARI / score_ref',
              titleEn: 'Compose: ARI skill = 1 − score_ARI / score_ref',
              bodyZh:
                'S20bi sexviguple 第 26 路：调整兰德指数技能分与通用 skill 同形。算例 1−0.2/0.5=0.6；与 V/AMI/NMI 组成 clustering sexviguple。',
              bodyEn:
                'S20bi sexviguple tip skill #26: ARI skill same shape as generic skill; sample 0.6; pairs with V/AMI/NMI into clustering sexviguple.',
              formula: {
                expr: 'ari_skill = 1 - score_ARI / score_ref',
                vars: {
                  ari_skill: 'ARI 技能分 1',
                  score_ARI: 'ARI 损失评分（越小越好）',
                  score_ref: '参考评分',
                },
                sample: { score_ARI: 0.2, score_ref: 0.5 },
                expected: 0.6,
                plainZh: 'ARI 技能分由 ARI 损失评分与参考评分之比合成',
                plainEn:
                  'ARI skill composes as one minus ARI loss score over reference score',
              },
            },
            {
              id: 'path-compose-v-ari-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|V_skill − ARI_skill| V↔ARI dual 残差',
              titleEn: 'Compose KPI: |V_skill − ARI_skill| V↔ARI dual residual',
              bodyZh:
                'S20bi clustering dual：V-measure skill 与 ARI skill 应紧致。算例两者 0.6 → 残差 0；容差内为诚实。',
              bodyEn:
                'S20bi clustering dual: V-measure skill vs ARI skill; sample matched 0.6 → 0; honesty within tol.',
              formula: {
                expr: 'res = abs(V_skill - ari_skill)',
                vars: {
                  res: 'V↔ARI dual 绝对残差 1',
                  V_skill: 'V-measure 技能分 1',
                  ari_skill: 'ARI 技能分 1',
                },
                sample: { V_skill: 0.6, ari_skill: 0.6 },
                expected: 0,
                plainZh: 'V-measure 与 ARI 技能分之差的绝对值衡量聚类 dual 诚实',
                plainEn:
                  'Absolute difference of V-measure and ARI skills measures clustering dual honesty',
              },
            },
            {
              id: 'path-compose-ami-ari-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|AMI_skill − ARI_skill| AMI↔ARI dual 残差',
              titleEn: 'Compose KPI: |AMI_skill − ARI_skill| AMI↔ARI dual residual',
              bodyZh:
                'S20bi：AMI 与 ARI 技能 dual；匹配诚实包残差→0。算例两侧 0.6 → 0；与 V↔ARI dual 并置。',
              bodyEn:
                'S20bi AMI↔ARI skill dual; matched honest pack → 0; sample 0.6; sits with V↔ARI dual.',
              formula: {
                expr: 'res = abs(ami_skill - ari_skill)',
                vars: {
                  res: 'AMI↔ARI dual 绝对残差 1',
                  ami_skill: 'AMI 技能分 1',
                  ari_skill: 'ARI 技能分 1',
                },
                sample: { ami_skill: 0.6, ari_skill: 0.6 },
                expected: 0,
                plainZh: 'AMI 与 ARI 技能分之差的绝对值衡量互信息–兰德 dual 诚实',
                plainEn:
                  'Absolute difference of AMI and ARI skills measures mutual-information–Rand dual honesty',
              },
            },
            {
              id: 'path-compose-nmi-ari-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|NMI_skill − ARI_skill| NMI↔ARI dual 残差',
              titleEn: 'Compose KPI: |NMI_skill − ARI_skill| NMI↔ARI dual residual',
              bodyZh:
                'S20bi NMI↔ARI dual 闭合 sexviguple 聚类四角。算例 0.6 vs 0.6 → 0。',
              bodyEn:
                'S20bi NMI↔ARI dual closes clustering quartet of sexviguple; sample matched → 0.',
              formula: {
                expr: 'res = abs(nmi_skill - ari_skill)',
                vars: {
                  res: 'NMI↔ARI dual 绝对残差 1',
                  nmi_skill: 'NMI 技能分 1',
                  ari_skill: 'ARI 技能分 1',
                },
                sample: { nmi_skill: 0.6, ari_skill: 0.6 },
                expected: 0,
                plainZh: 'NMI 与 ARI 技能分之差的绝对值衡量归一互信息–兰德 dual 诚实',
                plainEn:
                  'Absolute difference of NMI and ARI skills measures normalized-MI–Rand dual honesty',
              },
            },
            {
              id: 'path-compose-sexviguple-mean-skill',
              layer: 'foundation',
              titleZh: '合成：mean_skill = (Σ skill_i) / 26 sexviguple 均值',
              titleEn: 'Compose: mean_skill = (Σ skill_i) / 26 sexviguple mean',
              bodyZh:
                'S20bi：26 路技能（Brier…ARI）算术均值。教学金标全 0.6 → mean=0.6；桥接 mean sexviguple skill KPI。',
              bodyEn:
                'S20bi mean of 26 skills (Brier…ARI); teaching gold all 0.6 → mean 0.6; bridges mean sexviguple skill KPI.',
              formula: {
                expr: 'mean_skill = skill_sum / 26',
                vars: {
                  mean_skill: 'sexviguple 平均技能分 1',
                  skill_sum: '26 路技能分之和 1',
                },
                sample: { skill_sum: 0.6 * 26 },
                expected: 0.6,
                plainZh: 'sexviguple 平均技能分等于二十六路技能分之和除以 26',
                plainEn:
                  'Sexviguple mean skill is the sum of twenty-six skill scores divided by 26',
              },
            },
            {
              id: 'path-compose-sexviguple-skill-dual-max',
              layer: 'foundation',
              titleZh: '合成 KPI：max_ij |skill_i − skill_j| sexviguple dual 上确界',
              titleEn: 'Compose KPI: max_ij |skill_i − skill_j| sexviguple dual upper bound',
              bodyZh:
                'S20bi：sexviguple 内最大成对技能差。紧致诚实包 → 0。算例 skill 全等 → 0；松散包抬升残差。',
              bodyEn:
                'S20bi max pairwise skill spread among sexviguple; tight honest pack → 0; sample all-equal → 0.',
              formula: {
                expr: 'res = max_ij_abs_skill_diff',
                vars: {
                  res: 'sexviguple 技能 dual 最大绝对差 1',
                  max_ij_abs_skill_diff: '成对 |skill_i−skill_j| 上确界 1',
                },
                sample: { max_ij_abs_skill_diff: 0 },
                expected: 0,
                plainZh: 'sexviguple 技能 dual 上确界取二十六路内成对技能差之最大',
                plainEn:
                  'Sexviguple skill dual upper bound is the maximum pairwise absolute skill difference in the sexviguple',
              },
            },
            {
              id: 'path-compose-sexviguple-skill-rms-spread',
              layer: 'foundation',
              titleZh: '合成 KPI：RMS_spread = √(mean (skill_i − mean)²) 技能离散',
              titleEn: 'Compose KPI: RMS_spread = √(mean (skill_i − mean)²) skill dispersion',
              bodyZh:
                'S20bi sexviguple 技能 RMS 离散。紧致诚实包 → 0。算例全等 skill → 0；桥接 dual max 的能量中心。',
              bodyEn:
                'S20bi sexviguple skill RMS dispersion; tight honest pack → 0; sample all-equal → 0; energy center of dual max.',
              formula: {
                expr: 'rms_spread = sqrt(mean_sq_dev)',
                vars: {
                  rms_spread: 'sexviguple 技能 RMS 离散 1',
                  mean_sq_dev: '技能相对均值的均方差 1',
                },
                sample: { mean_sq_dev: 0 },
                expected: 0,
                plainZh: 'sexviguple 技能 RMS 离散等于技能相对均值均方差的平方根',
                plainEn:
                  'Sexviguple skill RMS spread is the square root of mean squared skill deviation from the mean',
              },
            },
            {
              id: 'path-compose-v-measure-sexviguple-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：vMeasureSexvigupleHonest 联合门（0/1）',
              titleEn: 'Compose KPI: vMeasureSexvigupleHonest joint gate (0/1)',
              bodyZh:
                'S20bi packaging：V-skill 诚实 ∧ ARI skill 诚实 ∧ V↔ARI dual→0 ∧ AMI↔ARI dual→0 ∧ NMI↔ARI dual→0 ∧ sexviguple dual max→0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bi packaging: V-skill ∧ ARI skill ∧ V↔ARI dual→0 ∧ AMI↔ARI dual→0 ∧ NMI↔ARI dual→0 ∧ sexviguple dual max→0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_V * c_ARI * c_VA * c_AA * c_NA * c_max',
                vars: {
                  gate: 'V-measure sexviguple 包装诚实门 0/1',
                  c_V: 'V-skill 诚实 0/1',
                  c_ARI: 'ARI skill 诚实 0/1',
                  c_VA: 'V↔ARI dual 诚实 0/1',
                  c_AA: 'AMI↔ARI dual 诚实 0/1',
                  c_NA: 'NMI↔ARI dual 诚实 0/1',
                  c_max: 'sexviguple dual max 诚实 0/1',
                },
                sample: {
                  c_V: 1,
                  c_ARI: 1,
                  c_VA: 1,
                  c_AA: 1,
                  c_NA: 1,
                  c_max: 1,
                },
                expected: 1,
                plainZh: 'V-measure sexviguple 包装诚实门为六个子诚实标志之积，全真时为 1',
                plainEn:
                  'V-measure sexviguple packaging honesty gate is the product of six sub-honesty flags; all-true yields 1',
              },
            },
            // S20bj skill envelope min/RMS dual of max residual packaging (wave30 residual compose expand)
            {
              id: 'path-compose-skill-min-abs-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：min_ij |skill_i − skill_j| sexviguple 最近对偶',
              titleEn: 'Compose KPI: min_ij |skill_i − skill_j| sexviguple nearest dual',
              bodyZh:
                'S20bj：sexviguple 内最小成对技能差（max dual 的对偶）。紧致诚实包 → 0。算例 skill 全等 → 0；桥接 skillMinAbsDiff26。',
              bodyEn:
                'S20bj min pairwise skill spread among sexviguple (dual of max); tight honest pack → 0; sample all-equal → 0; bridges skillMinAbsDiff26.',
              formula: {
                expr: 'min_abs = min_ij_abs_skill_diff',
                vars: {
                  min_abs: 'sexviguple 技能 dual 最小绝对差 1',
                  min_ij_abs_skill_diff: '成对 |skill_i−skill_j| 下确界 1',
                },
                sample: { min_ij_abs_skill_diff: 0 },
                expected: 0,
                plainZh: 'sexviguple 技能 dual 下确界取二十六路内成对技能差之最小',
                plainEn:
                  'Sexviguple skill dual lower bound is the minimum pairwise absolute skill difference in the sexviguple',
              },
            },
            {
              id: 'path-compose-skill-rms-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：rms_diff = √(mean_{i<j} (skill_i − skill_j)²) 包络',
              titleEn: 'Compose KPI: rms_diff = √(mean_{i<j} (skill_i − skill_j)²) envelope',
              bodyZh:
                'S20bj：sexviguple 成对技能差 L2 包络（max dual 的能量中心）。紧致诚实包 → 0。算例全等 skill → 0；桥接 skillRmsDiff26。',
              bodyEn:
                'S20bj L2 envelope of pairwise skill diffs (energy center of max dual); tight honest pack → 0; sample all-equal → 0; bridges skillRmsDiff26.',
              formula: {
                expr: 'rms_diff = sqrt(mean_pair_sq_diff)',
                vars: {
                  rms_diff: 'sexviguple 技能成对 RMS 差 1',
                  mean_pair_sq_diff: '成对 (skill_i−skill_j)² 均值 1',
                },
                sample: { mean_pair_sq_diff: 0 },
                expected: 0,
                plainZh: 'sexviguple 技能成对 RMS 差等于成对技能差均方的平方根',
                plainEn:
                  'Sexviguple skill pairwise RMS diff is the square root of mean squared pairwise skill difference',
              },
            },
            {
              id: 'path-compose-skill-envelope-ordered',
              layer: 'foundation',
              titleZh: '合成 KPI：min ≤ rms ≤ max 包络序诚实残差',
              titleEn: 'Compose KPI: min ≤ rms ≤ max envelope-order honesty residual',
              bodyZh:
                'S20bj 包络序：代数上 min≤rms≤max 应成立。算例 min=0、rms=0、max=0 → 违反和 0；桥接 typeIIEnvelopeOrdered。',
              bodyEn:
                'S20bj envelope order: min≤rms≤max algebraically; sample all-zero → violation sum 0; bridges typeIIEnvelopeOrdered.',
              formula: {
                expr: 'h = max(0, min_abs - rms_diff) + max(0, rms_diff - max_abs)',
                vars: {
                  h: '包络序违反和 1',
                  min_abs: '成对技能差下确界 1',
                  rms_diff: '成对技能差 RMS 1',
                  max_abs: '成对技能差上确界 1',
                },
                sample: { min_abs: 0, rms_diff: 0, max_abs: 0 },
                expected: 0,
                plainZh: '技能包络序违反和在 min≤rms≤max 成立时为零',
                plainEn:
                  'Skill envelope-order violation sum is zero when min≤rms≤max holds',
              },
            },
            {
              id: 'path-compose-skill-envelope-span',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope span = max_abs − min_abs 双端跨度',
              titleEn: 'Compose KPI: envelope span = max_abs − min_abs dual span',
              bodyZh:
                'S20bj：技能成对差包络跨度 max−min。紧致诚实包 → 0。算例全等 → 0；松散包抬升 span。',
              bodyEn:
                'S20bj pairwise skill-diff envelope span max−min; tight honest pack → 0; sample all-equal → 0; loose pack raises span.',
              formula: {
                expr: 'span = max_abs - min_abs',
                vars: {
                  span: '技能包络双端跨度 1',
                  max_abs: '成对技能差上确界 1',
                  min_abs: '成对技能差下确界 1',
                },
                sample: { max_abs: 0, min_abs: 0 },
                expected: 0,
                plainZh: '技能包络跨度等于成对技能差上下确界之差',
                plainEn:
                  'Skill envelope span is the upper-minus-lower bound of pairwise skill differences',
              },
            },
            {
              id: 'path-compose-skill-envelope-crest',
              layer: 'foundation',
              titleZh: '合成 KPI：envelope crest = max_abs / max(rms_diff, ε)',
              titleEn: 'Compose KPI: envelope crest = max_abs / max(rms_diff, ε)',
              bodyZh:
                'S20bj 峰均比：max 相对 rms。紧致包 max=rms=0 时教学取 crest=1（ε 保护下约定诚实金标）。算例 max=0.02、rms=0.01 → 2。',
              bodyEn:
                'S20bj crest max/rms; tight pack uses teaching gold crest=1 under ε; sample 0.02/0.01=2.',
              formula: {
                expr: 'crest = max_abs / max(rms_diff, eps)',
                vars: {
                  crest: '技能包络峰均比 1',
                  max_abs: '成对技能差上确界 1',
                  rms_diff: '成对技能差 RMS 1',
                  eps: '防除零下界',
                },
                sample: { max_abs: 0.02, rms_diff: 0.01, eps: 1e-12 },
                expected: 2,
                plainZh: '技能包络峰均比等于成对技能差上确界除以 RMS',
                plainEn:
                  'Skill envelope crest is pairwise skill-diff upper bound over RMS',
              },
            },
            {
              id: 'path-compose-skill-envelope-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeHonest joint gate (0/1)',
              bodyZh:
                'S20bj packaging：min≤cap ∧ rms≤cap ∧ max≤cap ∧ 包络序诚实 ∧ span 容差。教学金标 → 1（下接 S20bk）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bj packaging: min≤cap ∧ rms≤cap ∧ max≤cap ∧ envelope order honesty ∧ span tol; honest gold → 1 (next S20bk); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_min * c_rms * c_max * c_ord * c_span',
                vars: {
                  gate: 'skill envelope 包装诚实门 0/1',
                  c_min: 'minAbsDiff 容差 诚实 0/1',
                  c_rms: 'rmsDiff 容差 诚实 0/1',
                  c_max: 'maxAbsDiff 容差 诚实 0/1',
                  c_ord: '包络序 诚实 0/1',
                  c_span: 'envelope span 容差 诚实 0/1',
                },
                sample: {
                  c_min: 1,
                  c_rms: 1,
                  c_max: 1,
                  c_ord: 1,
                  c_span: 1,
                },
                expected: 1,
                plainZh: 'skill envelope 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S20bk skill envelope CV/skew + rmsMinGap dual residual packaging (wave31 residual compose expand)
            {
              id: 'path-compose-skill-mean-abs-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：mean_abs = mean_{i<j} |skill_i − skill_j|',
              titleEn: 'Compose KPI: mean_abs = mean_{i<j} |skill_i − skill_j|',
              bodyZh:
                'S20bk 包络一阶矩：sexviguple 成对技能差均值。紧致诚实包 → 0。算例全等 skill → 0；桥接 skillMeanAbsDiff26。',
              bodyEn:
                'S20bk envelope first moment: mean pairwise skill abs-diff among sexviguple; tight honest pack → 0; sample all-equal → 0; bridges skillMeanAbsDiff26.',
              formula: {
                expr: 'mean_abs = mean_pair_abs_diff',
                vars: {
                  mean_abs: 'sexviguple 技能成对平均绝对差 1',
                  mean_pair_abs_diff: '成对 |skill_i−skill_j| 均值 1',
                },
                sample: { mean_pair_abs_diff: 0 },
                expected: 0,
                plainZh: 'sexviguple 技能成对平均绝对差等于成对技能差绝对值的算术均值',
                plainEn:
                  'Sexviguple skill mean pairwise abs-diff is the arithmetic mean of pairwise absolute skill differences',
              },
            },
            {
              id: 'path-compose-skill-cv-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：cv_diff = std(|Δ|) / mean(|Δ|) 包络变异系数',
              titleEn: 'Compose KPI: cv_diff = std(|Δ|) / mean(|Δ|) envelope CV',
              bodyZh:
                'S20bk：成对 |skill_i−skill_j| 的 CV。紧致诚实包 mean=0 时教学取 cv=0。算例 std=0.02、mean=0.01 → 2；桥接 skillCvDiff26。',
              bodyEn:
                'S20bk CV of pairwise |skill diffs|; tight pack uses teaching gold cv=0 when mean=0; sample 0.02/0.01=2; bridges skillCvDiff26.',
              formula: {
                expr: 'cv_diff = std_abs / max(mean_abs, eps)',
                vars: {
                  cv_diff: '技能包络变异系数 1',
                  std_abs: '成对 |Δ| 总体标准差 1',
                  mean_abs: '成对 |Δ| 均值 1',
                  eps: '防除零下界',
                },
                sample: { std_abs: 0.02, mean_abs: 0.01, eps: 1e-12 },
                expected: 2,
                plainZh: '技能包络变异系数等于成对绝对差标准差除以均值',
                plainEn:
                  'Skill envelope CV is the std of pairwise abs-diffs over their mean',
              },
            },
            {
              id: 'path-compose-skill-skew-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：skew_diff 成对 |Δ| 总体偏度',
              titleEn: 'Compose KPI: skew_diff population skew of pairwise |Δ|',
              bodyZh:
                'S20bk：成对绝对技能差总体偏度。紧致诚实包 → 0。算例全等 skill → 0；桥接 skillSkewDiff26。',
              bodyEn:
                'S20bk population skew of pairwise abs skill diffs; tight honest pack → 0; sample all-equal → 0; bridges skillSkewDiff26.',
              formula: {
                expr: 'skew_diff = mean_cubed_dev / max(std_abs^3, eps)',
                vars: {
                  skew_diff: '技能包络偏度 1',
                  mean_cubed_dev: '成对 |Δ| 三阶中心矩 1',
                  std_abs: '成对 |Δ| 总体标准差 1',
                  eps: '防除零下界',
                },
                sample: { mean_cubed_dev: 0, std_abs: 0, eps: 1e-12 },
                expected: 0,
                plainZh: '技能包络偏度等于成对绝对差三阶中心矩除以标准差立方',
                plainEn:
                  'Skill envelope skew is the third central moment of pairwise abs-diffs over std cubed',
              },
            },
            {
              id: 'path-compose-skill-rms-min-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：rmsMinGap = rms_diff − min_abs min↔rms dual',
              titleEn: 'Compose KPI: rmsMinGap = rms_diff − min_abs min↔rms dual',
              bodyZh:
                'S20bk dual residual：包络序下 rms≥min → gap≥0。紧致诚实包 → 0。算例 rms=0.02、min=0.01 → 0.01；桥接 skillRmsMinGap26。',
              bodyEn:
                'S20bk dual residual: under envelope order rms≥min → gap≥0; tight honest pack → 0; sample 0.02−0.01=0.01; bridges skillRmsMinGap26.',
              formula: {
                expr: 'rms_min_gap = rms_diff - min_abs',
                vars: {
                  rms_min_gap: 'min↔rms dual 间隙 1',
                  rms_diff: '成对技能差 RMS 1',
                  min_abs: '成对技能差下确界 1',
                },
                sample: { rms_diff: 0.02, min_abs: 0.01 },
                expected: 0.01,
                plainZh: 'min↔rms dual 间隙等于成对技能差 RMS 减去下确界',
                plainEn:
                  'Min↔rms dual gap is pairwise skill-diff RMS minus the lower bound',
              },
            },
            {
              id: 'path-compose-skill-max-rms-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：maxRmsGap = max_abs − rms_diff max↔rms dual',
              titleEn: 'Compose KPI: maxRmsGap = max_abs − rms_diff max↔rms dual',
              bodyZh:
                'S20bk 上 dual：包络序 max≥rms → gap≥0。紧致诚实包 → 0。算例 max=0.03、rms=0.02 → 0.01；与 rmsMinGap 组成双端 dual。',
              bodyEn:
                'S20bk upper dual: max≥rms → gap≥0; tight honest pack → 0; sample 0.03−0.02=0.01; pairs with rmsMinGap as dual ends.',
              formula: {
                expr: 'max_rms_gap = max_abs - rms_diff',
                vars: {
                  max_rms_gap: 'max↔rms dual 间隙 1',
                  max_abs: '成对技能差上确界 1',
                  rms_diff: '成对技能差 RMS 1',
                },
                sample: { max_abs: 0.03, rms_diff: 0.02 },
                expected: 0.01,
                plainZh: 'max↔rms dual 间隙等于成对技能差上确界减去 RMS',
                plainEn:
                  'Max↔rms dual gap is pairwise skill-diff upper bound minus RMS',
              },
            },
            {
              id: 'path-compose-skill-envelope-moments-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeMomentsHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeMomentsHonest joint gate (0/1)',
              bodyZh:
                'S20bk packaging：mean_abs 容差 ∧ cv 容差 ∧ |skew| 容差 ∧ rmsMinGap 容差 ∧ maxRmsGap 容差。教学金标 → 1（下接 S20bl）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bk packaging: mean_abs tol ∧ cv tol ∧ |skew| tol ∧ rmsMinGap tol ∧ maxRmsGap tol; honest gold → 1 (next S20bl); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_mean * c_cv * c_skew * c_rmin * c_rmax',
                vars: {
                  gate: 'skill envelope moments 包装诚实门 0/1',
                  c_mean: 'meanAbsDiff 容差 诚实 0/1',
                  c_cv: 'cvDiff 容差 诚实 0/1',
                  c_skew: 'skewDiff 容差 诚实 0/1',
                  c_rmin: 'rmsMinGap 容差 诚实 0/1',
                  c_rmax: 'maxRmsGap 容差 诚实 0/1',
                },
                sample: {
                  c_mean: 1,
                  c_cv: 1,
                  c_skew: 1,
                  c_rmin: 1,
                  c_rmax: 1,
                },
                expected: 1,
                plainZh: 'skill envelope moments 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope moments packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S20bl skill envelope kurtosis + maxMinGap/maxRmsGap dual residual packaging (wave32 residual compose expand)
            {
              id: 'path-compose-skill-kurtosis-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：kurtosis_diff 成对 |Δ| 超额峰度',
              titleEn: 'Compose KPI: kurtosis_diff excess kurtosis of pairwise |Δ|',
              bodyZh:
                'S20bl：成对绝对技能差总体超额峰度（Gaussian→0）。紧致诚实包 → 0。算例全等 skill → 0；桥接 skillKurtosisDiff26。',
              bodyEn:
                'S20bl population excess kurtosis of pairwise abs skill diffs (Gaussian→0); tight honest pack → 0; sample all-equal → 0; bridges skillKurtosisDiff26.',
              formula: {
                expr: 'kurtosis_diff = mean_fourth_dev / max(std_abs^4, eps) - 3',
                vars: {
                  kurtosis_diff: '技能包络超额峰度 1',
                  mean_fourth_dev: '成对 |Δ| 四阶中心矩 1',
                  std_abs: '成对 |Δ| 总体标准差 1',
                  eps: '防除零下界',
                },
                sample: { mean_fourth_dev: 0, std_abs: 0, eps: 1e-12 },
                expected: 0,
                plainZh: '技能包络超额峰度等于成对绝对差四阶中心矩除以标准差四次方再减 3',
                plainEn:
                  'Skill envelope excess kurtosis is the fourth central moment of pairwise abs-diffs over std to the fourth, minus 3',
              },
            },
            {
              id: 'path-compose-skill-max-min-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：maxMinGap = max_abs − min_abs max↔min dual',
              titleEn: 'Compose KPI: maxMinGap = max_abs − min_abs max↔min dual',
              bodyZh:
                'S20bl dual residual：包络序 max≥min → gap≥0。紧致诚实包 → 0。算例 max=0.03、min=0.01 → 0.02；桥接 skillMaxMinGap26。',
              bodyEn:
                'S20bl dual residual: under envelope order max≥min → gap≥0; tight honest pack → 0; sample 0.03−0.01=0.02; bridges skillMaxMinGap26.',
              formula: {
                expr: 'max_min_gap = max_abs - min_abs',
                vars: {
                  max_min_gap: 'max↔min dual 间隙 1',
                  max_abs: '成对技能差上确界 1',
                  min_abs: '成对技能差下确界 1',
                },
                sample: { max_abs: 0.03, min_abs: 0.01 },
                expected: 0.02,
                plainZh: 'max↔min dual 间隙等于成对技能差上确界减去下确界',
                plainEn:
                  'Max↔min dual gap is pairwise skill-diff upper bound minus lower bound',
              },
            },
            {
              id: 'path-compose-skill-max-rms-gap-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：maxRmsGap dual residual 再包装',
              titleEn: 'Compose KPI: maxRmsGap dual residual re-package',
              bodyZh:
                'S20bl 上 dual 再包装：maxRmsGap=max−rms 与 maxMinGap 组成 max 端 dual 对。紧致诚实包 → 0。算例 max=0.03、rms=0.02 → 0.01。',
              bodyEn:
                'S20bl upper dual re-package: maxRmsGap=max−rms pairs with maxMinGap as max-end dual; tight honest pack → 0; sample 0.03−0.02=0.01.',
              formula: {
                expr: 'max_rms_gap = max_abs - rms_diff',
                vars: {
                  max_rms_gap: 'max↔rms dual 间隙 1',
                  max_abs: '成对技能差上确界 1',
                  rms_diff: '成对技能差 RMS 1',
                },
                sample: { max_abs: 0.03, rms_diff: 0.02 },
                expected: 0.01,
                plainZh: 'max↔rms dual 间隙再包装等于成对技能差上确界减去 RMS',
                plainEn:
                  'Max↔rms dual gap re-package is pairwise skill-diff upper bound minus RMS',
              },
            },
            {
              id: 'path-compose-skill-envelope-kurtosis-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeKurtosisHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeKurtosisHonest joint gate (0/1)',
              bodyZh:
                'S20bl packaging：|kurtosis| 容差 ∧ maxMinGap 容差 ∧ maxRmsGap 容差。教学金标 → 1（下接 S20bm）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bl packaging: |kurtosis| tol ∧ maxMinGap tol ∧ maxRmsGap tol; honest gold → 1 (next S20bm); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_kurt * c_mmin * c_mrms',
                vars: {
                  gate: 'skill envelope kurtosis 包装诚实门 0/1',
                  c_kurt: 'kurtosisDiff 容差 诚实 0/1',
                  c_mmin: 'maxMinGap 容差 诚实 0/1',
                  c_mrms: 'maxRmsGap 容差 诚实 0/1',
                },
                sample: {
                  c_kurt: 1,
                  c_mmin: 1,
                  c_mrms: 1,
                },
                expected: 1,
                plainZh: 'skill envelope kurtosis 包装诚实门为三个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope kurtosis packaging honesty gate is the product of three sub-honesty flags; all-true yields 1',
              },
            },
            // S20bm skill envelope MAD/IQR + medianMeanGap dual residual packaging (wave33 residual compose expand)
            {
              id: 'path-compose-skill-mad-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：MAD_diff 成对 |Δ| 中位数绝对偏差',
              titleEn: 'Compose KPI: MAD_diff median absolute deviation of pairwise |Δ|',
              bodyZh:
                'S20bm：成对绝对技能差的中位数绝对偏差（robust scale）。紧致诚实包 → 0。算例全等 skill → 0；桥接 skillMadDiff26。',
              bodyEn:
                'S20bm median absolute deviation of pairwise abs skill diffs (robust scale); tight honest pack → 0; sample all-equal → 0; bridges skillMadDiff26.',
              formula: {
                expr: 'MAD = median(abs(x_i - median_x))',
                vars: {
                  MAD: '技能包络中位数绝对偏差 1',
                  x_i: '成对 |Δ| 样本',
                  median_x: '成对 |Δ| 中位数 1',
                },
                sample: { x_i: 0, median_x: 0 },
                expected: 0,
                plainZh: '技能包络 MAD 等于成对绝对差相对中位数的中位数绝对偏差',
                plainEn:
                  'Skill envelope MAD is the median absolute deviation of pairwise abs-diffs about their median',
              },
            },
            {
              id: 'path-compose-skill-iqr-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：IQR_diff = Q3 − Q1 成对 |Δ| 四分位距',
              titleEn: 'Compose KPI: IQR_diff = Q3 − Q1 pairwise |Δ| interquartile range',
              bodyZh:
                'S20bm dual residual：成对绝对技能差四分位距。紧致诚实包 → 0。算例 Q3=0.03、Q1=0.01 → 0.02；桥接 skillIqrDiff26。',
              bodyEn:
                'S20bm dual residual: IQR of pairwise abs skill diffs; tight honest pack → 0; sample 0.03−0.01=0.02; bridges skillIqrDiff26.',
              formula: {
                expr: 'IQR = Q3 - Q1',
                vars: {
                  IQR: '技能包络四分位距 1',
                  Q3: '成对 |Δ| 上四分位 1',
                  Q1: '成对 |Δ| 下四分位 1',
                },
                sample: { Q3: 0.03, Q1: 0.01 },
                expected: 0.02,
                plainZh: '技能包络 IQR 等于成对绝对差上四分位减去下四分位',
                plainEn:
                  'Skill envelope IQR is the upper minus lower quartile of pairwise abs-diffs',
              },
            },
            {
              id: 'path-compose-skill-median-mean-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：medianMeanGap = |median − mean| dual residual',
              titleEn: 'Compose KPI: medianMeanGap = |median − mean| dual residual',
              bodyZh:
                'S20bm dual residual：成对 |Δ| 中位数与均值间隙。对称/紧致诚实包 → 0。算例 median=0.02、mean=0.025 → 0.005；桥接 skillMedianMeanGap26。',
              bodyEn:
                'S20bm dual residual: |median−mean| of pairwise abs-diffs; symmetric/tight honest pack → 0; sample |0.02−0.025|=0.005; bridges skillMedianMeanGap26.',
              formula: {
                expr: 'median_mean_gap = abs(median_abs - mean_abs)',
                vars: {
                  median_mean_gap: 'median↔mean dual 间隙 1',
                  median_abs: '成对技能差中位数 1',
                  mean_abs: '成对技能差均值 1',
                },
                sample: { median_abs: 0.02, mean_abs: 0.025 },
                expected: 0.005,
                plainZh: 'median↔mean dual 间隙等于成对技能差中位数与均值之差的绝对值',
                plainEn:
                  'Median↔mean dual gap is absolute difference of pairwise skill-diff median and mean',
              },
            },
            {
              id: 'path-compose-skill-mad-iqr-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|MAD − IQR/1.349| MAD/IQR dual residual',
              titleEn: 'Compose KPI: |MAD − IQR/1.349| MAD/IQR dual residual',
              bodyZh:
                'S20bm MAD/IQR dual packaging：正态标度下 MAD≈IQR/1.349；紧致诚实包两侧→0 → dual→0。算例 MAD=0、IQR=0 → 0。',
              bodyEn:
                'S20bm MAD/IQR dual packaging: under Gaussian scale MAD≈IQR/1.349; tight honest pack both→0 → dual→0; sample MAD=0,IQR=0 → 0.',
              formula: {
                expr: 'res = abs(MAD - IQR / 1.349)',
                vars: {
                  res: 'MAD/IQR dual 绝对残差 1',
                  MAD: '技能包络 MAD 1',
                  IQR: '技能包络 IQR 1',
                },
                sample: { MAD: 0, IQR: 0 },
                expected: 0,
                plainZh: 'MAD 与 IQR/1.349 之差的绝对值衡量 MAD/IQR dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of MAD and IQR/1.349 measures MAD/IQR dual residual packaging honesty',
              },
            },
            {
              id: 'path-compose-skill-envelope-robust-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeRobustHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeRobustHonest joint gate (0/1)',
              bodyZh:
                'S20bm packaging：MAD 容差 ∧ IQR 容差 ∧ medianMeanGap 容差 ∧ MAD/IQR dual→0。教学金标 → 1（下接 S20bn）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bm packaging: MAD tol ∧ IQR tol ∧ medianMeanGap tol ∧ MAD/IQR dual→0; honest gold → 1 (next S20bn); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_mad * c_iqr * c_mmg * c_dual',
                vars: {
                  gate: 'skill envelope robust 包装诚实门 0/1',
                  c_mad: 'MAD 容差 诚实 0/1',
                  c_iqr: 'IQR 容差 诚实 0/1',
                  c_mmg: 'medianMeanGap 容差 诚实 0/1',
                  c_dual: 'MAD/IQR dual 诚实 0/1',
                },
                sample: {
                  c_mad: 1,
                  c_iqr: 1,
                  c_mmg: 1,
                  c_dual: 1,
                },
                expected: 1,
                plainZh: 'skill envelope robust 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope robust packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S20bn skill envelope percentile gap p90−p10 + rangeIqrGap dual residual of maxMin↔IQR (wave34 residual compose expand)
            {
              id: 'path-compose-skill-p90-p10-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：p90 − p10 百分位间隙 dual residual',
              titleEn: 'Compose KPI: p90 − p10 percentile gap dual residual',
              bodyZh:
                'S20bn：成对 |Δ| 的 p90−p10 百分位跨度（robust range）。紧致诚实包 → 0。算例 p90=0.04、p10=0.01 → 0.03；桥接 skillPercentileGap26。',
              bodyEn:
                'S20bn p90−p10 percentile span of pairwise abs-diffs (robust range); tight honest pack → 0; sample 0.04−0.01=0.03; bridges skillPercentileGap26.',
              formula: {
                expr: 'p90_p10_gap = p90 - p10',
                vars: {
                  p90_p10_gap: '技能包络百分位间隙 1',
                  p90: '成对 |Δ| 第 90 百分位 1',
                  p10: '成对 |Δ| 第 10 百分位 1',
                },
                sample: { p90: 0.04, p10: 0.01 },
                expected: 0.03,
                plainZh: '技能包络百分位间隙等于成对绝对差第 90 百分位减去第 10 百分位',
                plainEn:
                  'Skill envelope percentile gap is the 90th minus 10th percentile of pairwise abs-diffs',
              },
            },
            {
              id: 'path-compose-skill-range-iqr-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：rangeIqrGap = |maxMinGap − IQR| dual residual',
              titleEn: 'Compose KPI: rangeIqrGap = |maxMinGap − IQR| dual residual',
              bodyZh:
                'S20bn dual residual of maxMin↔IQR：|maxMinGap−IQR|。紧致诚实包两侧→0 → gap→0。算例 maxMin=0.05、IQR=0.02 → 0.03；桥接 skillRangeIqrGap26。',
              bodyEn:
                'S20bn dual residual of maxMin↔IQR: |maxMinGap−IQR|; tight honest pack both→0 → gap→0; sample |0.05−0.02|=0.03; bridges skillRangeIqrGap26.',
              formula: {
                expr: 'range_iqr_gap = abs(max_min_gap - IQR)',
                vars: {
                  range_iqr_gap: 'maxMin↔IQR dual 间隙 1',
                  max_min_gap: 'max↔min 全距 1',
                  IQR: '成对 |Δ| 四分位距 1',
                },
                sample: { max_min_gap: 0.05, IQR: 0.02 },
                expected: 0.03,
                plainZh: 'maxMin↔IQR dual 间隙等于全距与四分位距之差的绝对值',
                plainEn:
                  'MaxMin↔IQR dual gap is the absolute difference of full range and interquartile range',
              },
            },
            {
              id: 'path-compose-skill-maxmin-iqr-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：maxMin/IQR scale dual residual',
              titleEn: 'Compose KPI: maxMin/IQR scale dual residual',
              bodyZh:
                'S20bn scale dual：正态下 maxMin≈k·IQR；紧致诚实包两侧→0 → dual 残差用 |maxMin−IQR| 再包装。算例 0 vs 0 → 0。',
              bodyEn:
                'S20bn scale dual: under tight pack maxMin and IQR both→0 → dual residual 0; sample matched zeros → 0.',
              formula: {
                expr: 'res = abs(max_min_gap - IQR)',
                vars: {
                  res: 'maxMin/IQR scale dual 绝对残差 1',
                  max_min_gap: 'max↔min 全距 1',
                  IQR: '成对 |Δ| 四分位距 1',
                },
                sample: { max_min_gap: 0, IQR: 0 },
                expected: 0,
                plainZh: 'maxMin 与 IQR 之差的绝对值衡量 maxMin↔IQR dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of maxMinGap and IQR measures maxMin↔IQR dual residual packaging honesty',
              },
            },
            {
              id: 'path-compose-skill-percentile-range-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|p90−p10 − maxMinGap| percentile↔range dual',
              titleEn: 'Compose KPI: |p90−p10 − maxMinGap| percentile↔range dual',
              bodyZh:
                'S20bn percentile↔range dual packaging：p90−p10 与 maxMin 应对齐于紧致包。算例 0.03 vs 0.03 → 0。',
              bodyEn:
                'S20bn percentile↔range dual packaging: p90−p10 should align with maxMin on tight pack; sample matched 0.03 → 0.',
              formula: {
                expr: 'res = abs(p90_p10_gap - max_min_gap)',
                vars: {
                  res: 'percentile↔range dual 绝对残差 1',
                  p90_p10_gap: 'p90−p10 百分位间隙 1',
                  max_min_gap: 'max↔min 全距 1',
                },
                sample: { p90_p10_gap: 0.03, max_min_gap: 0.03 },
                expected: 0,
                plainZh: 'p90−p10 与 maxMin 之差的绝对值衡量 percentile↔range dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of p90−p10 and maxMinGap measures percentile↔range dual residual packaging honesty',
              },
            },
            {
              id: 'path-compose-skill-envelope-percentile-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopePercentileHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopePercentileHonest joint gate (0/1)',
              bodyZh:
                'S20bn packaging：p90−p10 容差 ∧ rangeIqrGap 容差 ∧ maxMin/IQR dual→0 ∧ percentile↔range dual→0。教学金标 → 1（下接 S20bo rangePercentileGap landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bn packaging: p90−p10 tol ∧ rangeIqrGap tol ∧ maxMin/IQR dual→0 ∧ percentile↔range dual→0; honest gold → 1 (next S20bo rangePercentileGap landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_p9010 * c_riq * c_dual * c_pr',
                vars: {
                  gate: 'skill envelope percentile 包装诚实门 0/1',
                  c_p9010: 'p90−p10 容差 诚实 0/1',
                  c_riq: 'rangeIqrGap 容差 诚实 0/1',
                  c_dual: 'maxMin/IQR dual 诚实 0/1',
                  c_pr: 'percentile↔range dual 诚实 0/1',
                },
                sample: {
                  c_p9010: 1,
                  c_riq: 1,
                  c_dual: 1,
                  c_pr: 1,
                },
                expected: 1,
                plainZh: 'skill envelope percentile 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope percentile packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S20bo skill envelope rangePercentileGap + percentileIqrGap dual residual (wave35 residual compose expand; solvers tip landed)
            {
              id: 'path-compose-skill-range-percentile-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：rangePercentileGap = maxMin − (p90−p10)',
              titleEn: 'Compose KPI: rangePercentileGap = maxMin − (p90−p10)',
              bodyZh:
                'S20bo（landed）：rangePercentileGap = maxMinGap − percentileGap（p90−p10）。紧致诚实包两侧→0 → gap→0。算例 maxMin=0.05、p90−p10=0.03 → 0.02；桥接 skillRangePercentileGap26。',
              bodyEn:
                'S20bo (landed) rangePercentileGap = maxMinGap − percentileGap (p90−p10); tight honest pack both→0 → gap→0; sample 0.05−0.03=0.02; bridges skillRangePercentileGap26.',
              formula: {
                expr: 'range_percentile_gap = max_min_gap - p90_p10_gap',
                vars: {
                  range_percentile_gap: 'maxMin↔percentile dual 间隙 1',
                  max_min_gap: 'max↔min 全距 1',
                  p90_p10_gap: 'p90−p10 百分位间隙 1',
                },
                sample: { max_min_gap: 0.05, p90_p10_gap: 0.03 },
                expected: 0.02,
                plainZh: 'rangePercentileGap 等于全距减去 p90−p10 百分位间隙',
                plainEn:
                  'RangePercentileGap is the full range minus the p90−p10 percentile span',
              },
            },
            {
              id: 'path-compose-skill-percentile-iqr-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：percentileIqrGap = (p90−p10) − IQR',
              titleEn: 'Compose KPI: percentileIqrGap = (p90−p10) − IQR',
              bodyZh:
                'S20bo dual residual of percentile↔IQR：percentileIqrGap = percentileGap − IQR。紧致诚实包两侧→0 → gap→0。算例 p90−p10=0.03、IQR=0.01 → 0.02；桥接 skillPercentileIqrGap26。',
              bodyEn:
                'S20bo dual residual of percentile↔IQR: percentileIqrGap = percentileGap − IQR; tight honest pack both→0 → gap→0; sample 0.03−0.01=0.02; bridges skillPercentileIqrGap26.',
              formula: {
                expr: 'percentile_iqr_gap = p90_p10_gap - IQR',
                vars: {
                  percentile_iqr_gap: 'percentile↔IQR dual 间隙 1',
                  p90_p10_gap: 'p90−p10 百分位间隙 1',
                  IQR: '成对 |Δ| 四分位距 1',
                },
                sample: { p90_p10_gap: 0.03, IQR: 0.01 },
                expected: 0.02,
                plainZh: 'percentileIqrGap 等于 p90−p10 百分位间隙减去四分位距',
                plainEn:
                  'PercentileIqrGap is the p90−p10 percentile span minus the interquartile range',
              },
            },
            {
              id: 'path-compose-skill-range-iqr-identity',
              layer: 'foundation',
              titleZh: '合成 KPI：rangeIqr = rangePercentile + percentileIqr 恒等',
              titleEn: 'Compose KPI: rangeIqr = rangePercentile + percentileIqr identity',
              bodyZh:
                'S20bo 望远镜恒等：rangeIqrGap 应等于 rangePercentileGap + percentileIqrGap。算例 0.02+0.02=0.04 vs 0.04 → 0。',
              bodyEn:
                'S20bo telescope identity: rangeIqrGap equals rangePercentileGap + percentileIqrGap; sample 0.02+0.02 vs 0.04 → 0.',
              formula: {
                expr: 'res = abs(range_iqr_gap - (range_percentile_gap + percentile_iqr_gap))',
                vars: {
                  res: 'range↔percentile↔IQR 望远镜恒等残差 1',
                  range_iqr_gap: 'maxMin−IQR 间隙 1',
                  range_percentile_gap: 'maxMin−percentile 间隙 1',
                  percentile_iqr_gap: 'percentile−IQR 间隙 1',
                },
                sample: {
                  range_iqr_gap: 0.04,
                  range_percentile_gap: 0.02,
                  percentile_iqr_gap: 0.02,
                },
                expected: 0,
                plainZh: 'rangeIqr 与 rangePercentile+percentileIqr 望远镜恒等时残差为零',
                plainEn:
                  'RangeIqr telescope residual is zero when rangeIqr equals rangePercentile plus percentileIqr',
              },
            },
            {
              id: 'path-compose-skill-range-percentile-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：|rangePercentileGap| dual residual packaging',
              titleEn: 'Compose KPI: |rangePercentileGap| dual residual packaging',
              bodyZh:
                'S20bo scale dual packaging：紧致诚实包上 rangePercentileGap→0。算例 0 → 0。',
              bodyEn:
                'S20bo scale dual packaging: tight honest pack rangePercentileGap→0; sample 0 → 0.',
              formula: {
                expr: 'res = abs(range_percentile_gap)',
                vars: {
                  res: 'rangePercentileGap 绝对包装残差 1',
                  range_percentile_gap: 'maxMin−percentile 间隙 1',
                },
                sample: { range_percentile_gap: 0 },
                expected: 0,
                plainZh: 'rangePercentileGap 的绝对值衡量 range↔percentile dual residual packaging 诚实',
                plainEn:
                  'Absolute rangePercentileGap measures range↔percentile dual residual packaging honesty',
              },
            },
            {
              id: 'path-compose-skill-envelope-range-percentile-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeRangePercentileHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeRangePercentileHonest joint gate (0/1)',
              bodyZh:
                'S20bo packaging：rangePercentileGap 容差 ∧ percentileIqrGap 容差 ∧ telescope 恒等 ∧ |rangePercentile|→0。教学金标 → 1（下接 S20bp upper/lower tail + rangeIqrIdentityAbs landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bo packaging: rangePercentileGap tol ∧ percentileIqrGap tol ∧ telescope identity ∧ |rangePercentile|→0; honest gold → 1 (next S20bp upper/lower tail + rangeIqrIdentityAbs landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_rp * c_pi * c_tel * c_abs',
                vars: {
                  gate: 'skill envelope rangePercentile 包装诚实门 0/1',
                  c_rp: 'rangePercentileGap 容差 诚实 0/1',
                  c_pi: 'percentileIqrGap 容差 诚实 0/1',
                  c_tel: 'telescope 恒等 诚实 0/1',
                  c_abs: 'rangePercentile 绝对 诚实 0/1',
                },
                sample: {
                  c_rp: 1,
                  c_pi: 1,
                  c_tel: 1,
                  c_abs: 1,
                },
                expected: 1,
                plainZh: 'skill envelope rangePercentile 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope rangePercentile packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S20bp skill envelope upperTailGap/lowerTailGap + rangeIqrIdentityAbs dual residual (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'path-compose-skill-upper-tail-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：upperTailGap = max − p90',
              titleEn: 'Compose KPI: upperTailGap = max − p90',
              bodyZh:
                'S20bp（landed）：upperTailGap = maxAbsDiff − p90AbsDiff。紧致诚实包两侧→0 → gap→0。算例 max=0.05、p90=0.03 → 0.02；桥接 skillUpperTailGap26。',
              bodyEn:
                'S20bp (landed) upperTailGap = maxAbsDiff − p90AbsDiff; tight honest pack both→0 → gap→0; sample 0.05−0.03=0.02; bridges skillUpperTailGap26.',
              formula: {
                expr: 'upper_tail_gap = max_abs - p90_abs',
                vars: {
                  upper_tail_gap: 'max↔p90 上尾 dual 间隙 1',
                  max_abs: 'max abs-diff 1',
                  p90_abs: 'p90 abs-diff 1',
                },
                sample: { max_abs: 0.05, p90_abs: 0.03 },
                expected: 0.02,
                plainZh: 'upperTailGap 等于最大绝对差减去 p90 绝对差',
                plainEn:
                  'UpperTailGap is the max absolute difference minus the p90 absolute difference',
              },
            },
            {
              id: 'path-compose-skill-lower-tail-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：lowerTailGap = p10 − min',
              titleEn: 'Compose KPI: lowerTailGap = p10 − min',
              bodyZh:
                'S20bp dual residual of lower tail：lowerTailGap = p10AbsDiff − minAbsDiff。紧致诚实包两侧→0 → gap→0。算例 p10=0.02、min=0.01 → 0.01；桥接 skillLowerTailGap26。',
              bodyEn:
                'S20bp dual residual of lower tail: lowerTailGap = p10AbsDiff − minAbsDiff; tight honest pack both→0 → gap→0; sample 0.02−0.01=0.01; bridges skillLowerTailGap26.',
              formula: {
                expr: 'lower_tail_gap = p10_abs - min_abs',
                vars: {
                  lower_tail_gap: 'p10↔min 下尾 dual 间隙 1',
                  p10_abs: 'p10 abs-diff 1',
                  min_abs: 'min abs-diff 1',
                },
                sample: { p10_abs: 0.02, min_abs: 0.01 },
                expected: 0.01,
                plainZh: 'lowerTailGap 等于 p10 绝对差减去最小绝对差',
                plainEn:
                  'LowerTailGap is the p10 absolute difference minus the min absolute difference',
              },
            },
            {
              id: 'path-compose-skill-range-percentile-tail-identity',
              layer: 'foundation',
              titleZh: '合成 KPI：rangePercentile = upperTail + lowerTail 恒等',
              titleEn: 'Compose KPI: rangePercentile = upperTail + lowerTail identity',
              bodyZh:
                'S20bp 恒等：rangePercentileGap 应等于 upperTailGap + lowerTailGap。算例 0.02+0.01=0.03 vs 0.03 → 0。',
              bodyEn:
                'S20bp identity: rangePercentileGap equals upperTailGap + lowerTailGap; sample 0.02+0.01 vs 0.03 → 0.',
              formula: {
                expr: 'res = abs(range_percentile_gap - (upper_tail_gap + lower_tail_gap))',
                vars: {
                  res: 'rangePercentile↔tail 恒等残差 1',
                  range_percentile_gap: 'maxMin−percentile 间隙 1',
                  upper_tail_gap: 'max−p90 间隙 1',
                  lower_tail_gap: 'p10−min 间隙 1',
                },
                sample: {
                  range_percentile_gap: 0.03,
                  upper_tail_gap: 0.02,
                  lower_tail_gap: 0.01,
                },
                expected: 0,
                plainZh: 'rangePercentile 与 upperTail+lowerTail 恒等时残差为零',
                plainEn:
                  'RangePercentile tail identity residual is zero when rangePercentile equals upperTail plus lowerTail',
              },
            },
            {
              id: 'path-compose-skill-range-iqr-identity-abs',
              layer: 'foundation',
              titleZh: '合成 KPI：rangeIqrIdentityAbs = |rangeIqr − (rangePercentile + percentileIqr)|',
              titleEn: 'Compose KPI: rangeIqrIdentityAbs = |rangeIqr − (rangePercentile + percentileIqr)|',
              bodyZh:
                'S20bp absolute residual honesty of S20bo identity：rangeIqrIdentityAbs。匹配恒等 → 0。算例 |0.04−(0.02+0.02)|=0；桥接 skillRangeIqrIdentityAbs26。',
              bodyEn:
                'S20bp absolute residual honesty of S20bo identity: rangeIqrIdentityAbs; matched identity → 0; sample |0.04−(0.02+0.02)|=0; bridges skillRangeIqrIdentityAbs26.',
              formula: {
                expr: 'range_iqr_identity_abs = abs(range_iqr_gap - (range_percentile_gap + percentile_iqr_gap))',
                vars: {
                  range_iqr_identity_abs: 'rangeIqr 恒等绝对残差 1',
                  range_iqr_gap: 'maxMin−IQR 间隙 1',
                  range_percentile_gap: 'maxMin−percentile 间隙 1',
                  percentile_iqr_gap: 'percentile−IQR 间隙 1',
                },
                sample: {
                  range_iqr_gap: 0.04,
                  range_percentile_gap: 0.02,
                  percentile_iqr_gap: 0.02,
                },
                expected: 0,
                plainZh: 'rangeIqrIdentityAbs 等于 rangeIqr 与 rangePercentile+percentileIqr 之差的绝对值',
                plainEn:
                  'RangeIqrIdentityAbs is the absolute difference of rangeIqr and rangePercentile plus percentileIqr',
              },
            },
            {
              id: 'path-compose-skill-envelope-tail-identity-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeTailIdentityHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeTailIdentityHonest joint gate (0/1)',
              bodyZh:
                'S20bp packaging：upperTailGap 容差 ∧ lowerTailGap 容差 ∧ tail 恒等 ∧ rangeIqrIdentityAbs→0。教学金标 → 1（下接 S20bq midTail/interDecile + rangePercentileTailIdentityAbs landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bp packaging: upperTailGap tol ∧ lowerTailGap tol ∧ tail identity ∧ rangeIqrIdentityAbs→0; honest gold → 1 (next S20bq midTail/interDecile + rangePercentileTailIdentityAbs landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_up * c_lo * c_tail * c_riq',
                vars: {
                  gate: 'skill envelope tail-identity 包装诚实门 0/1',
                  c_up: 'upperTailGap 容差 诚实 0/1',
                  c_lo: 'lowerTailGap 容差 诚实 0/1',
                  c_tail: 'tail 恒等 诚实 0/1',
                  c_riq: 'rangeIqrIdentityAbs 诚实 0/1',
                },
                sample: {
                  c_up: 1,
                  c_lo: 1,
                  c_tail: 1,
                  c_riq: 1,
                },
                expected: 1,
                plainZh: 'skill envelope tail-identity 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope tail-identity packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S20bq skill envelope midTailGap/interDecileGap + rangePercentileTailIdentityAbs dual residual (wave37 residual compose expand; bridges wave36 tip; solvers tip landed)
            {
              id: 'path-compose-skill-mid-tail-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：midTailGap = maxMin − upperTail − lowerTail',
              titleEn: 'Compose KPI: midTailGap = maxMin − upperTail − lowerTail',
              bodyZh:
                'S20bq（landed）：midTailGap = maxMinGap − upperTailGap − lowerTailGap。p10/p90 尾外的中心体 dual residual。紧致诚实包两侧→0 → gap→0。算例 maxMin=0.04、upper=0.02、lower=0.01 → 0.01；桥接 skillMidTailGap26。',
              bodyEn:
                'S20bq (landed) midTailGap = maxMinGap − upperTailGap − lowerTailGap; dual residual of central body between p10/p90 tails; tight honest pack both→0 → gap→0; sample 0.04−0.02−0.01=0.01; bridges skillMidTailGap26.',
              formula: {
                expr: 'mid_tail_gap = max_min_gap - upper_tail_gap - lower_tail_gap',
                vars: {
                  mid_tail_gap: 'maxMin−upper−lower 中心体 dual 间隙 1',
                  max_min_gap: 'max↔min 全距 1',
                  upper_tail_gap: 'max−p90 上尾间隙 1',
                  lower_tail_gap: 'p10−min 下尾间隙 1',
                },
                sample: {
                  max_min_gap: 0.04,
                  upper_tail_gap: 0.02,
                  lower_tail_gap: 0.01,
                },
                expected: 0.01,
                plainZh: 'midTailGap 等于全距减去上尾间隙再减去下尾间隙',
                plainEn:
                  'MidTailGap is the full range minus upper tail gap minus lower tail gap',
              },
            },
            {
              id: 'path-compose-skill-inter-decile-gap',
              layer: 'foundation',
              titleZh: '合成 KPI：interDecileGap = p90 − p10',
              titleEn: 'Compose KPI: interDecileGap = p90 − p10',
              bodyZh:
                'S20bq dual residual of inter-decile span：interDecileGap = p90AbsDiff − p10AbsDiff。诚实时等于 percentileGap。紧致诚实包两侧→0 → gap→0。算例 p90=0.03、p10=0.02 → 0.01；桥接 skillInterDecileGap26。',
              bodyEn:
                'S20bq dual residual of inter-decile span: interDecileGap = p90AbsDiff − p10AbsDiff; equals percentileGap when honest; tight honest pack both→0 → gap→0; sample 0.03−0.02=0.01; bridges skillInterDecileGap26.',
              formula: {
                expr: 'inter_decile_gap = p90_abs - p10_abs',
                vars: {
                  inter_decile_gap: 'p90↔p10 十分位 dual 间隙 1',
                  p90_abs: 'p90 abs-diff 1',
                  p10_abs: 'p10 abs-diff 1',
                },
                sample: { p90_abs: 0.03, p10_abs: 0.02 },
                expected: 0.01,
                plainZh: 'interDecileGap 等于 p90 绝对差减去 p10 绝对差',
                plainEn:
                  'InterDecileGap is the p90 absolute difference minus the p10 absolute difference',
              },
            },
            {
              id: 'path-compose-skill-mid-inter-decile-identity',
              layer: 'foundation',
              titleZh: '合成 KPI：midTail ≈ interDecile ≈ percentileGap 恒等',
              titleEn: 'Compose KPI: midTail ≈ interDecile ≈ percentileGap identity',
              bodyZh:
                'S20bq 恒等：midTailGap 应等于 interDecileGap 且等于 percentileGap。算例 0.01 vs 0.01 vs 0.01 → 0。',
              bodyEn:
                'S20bq identity: midTailGap equals interDecileGap equals percentileGap; sample 0.01 vs 0.01 vs 0.01 → 0.',
              formula: {
                expr: 'res = abs(mid_tail_gap - inter_decile_gap) + abs(inter_decile_gap - percentile_gap)',
                vars: {
                  res: 'midTail↔interDecile↔percentile 恒等残差 1',
                  mid_tail_gap: 'maxMin−upper−lower 中心体间隙 1',
                  inter_decile_gap: 'p90−p10 十分位间隙 1',
                  percentile_gap: 'p90−p10 百分位间隙 1',
                },
                sample: {
                  mid_tail_gap: 0.01,
                  inter_decile_gap: 0.01,
                  percentile_gap: 0.01,
                },
                expected: 0,
                plainZh: 'midTail 与 interDecile 与 percentileGap 恒等时残差为零',
                plainEn:
                  'MidTail–interDecile–percentile identity residual is zero when all three match',
              },
            },
            {
              id: 'path-compose-skill-range-percentile-tail-identity-abs',
              layer: 'foundation',
              titleZh: '合成 KPI：rangePercentileTailIdentityAbs = |rangePercentile − (upper + lower)|',
              titleEn: 'Compose KPI: rangePercentileTailIdentityAbs = |rangePercentile − (upper + lower)|',
              bodyZh:
                'S20bq absolute residual honesty of S20bp identity：rangePercentileTailIdentityAbs。匹配恒等 → 0。算例 |0.03−(0.02+0.01)|=0；桥接 skillRangePercentileTailIdentityAbs26。',
              bodyEn:
                'S20bq absolute residual honesty of S20bp identity: rangePercentileTailIdentityAbs; matched identity → 0; sample |0.03−(0.02+0.01)|=0; bridges skillRangePercentileTailIdentityAbs26.',
              formula: {
                expr: 'range_percentile_tail_identity_abs = abs(range_percentile_gap - (upper_tail_gap + lower_tail_gap))',
                vars: {
                  range_percentile_tail_identity_abs: 'rangePercentile↔tail 恒等绝对残差 1',
                  range_percentile_gap: 'maxMin−percentile 间隙 1',
                  upper_tail_gap: 'max−p90 间隙 1',
                  lower_tail_gap: 'p10−min 间隙 1',
                },
                sample: {
                  range_percentile_gap: 0.03,
                  upper_tail_gap: 0.02,
                  lower_tail_gap: 0.01,
                },
                expected: 0,
                plainZh: 'rangePercentileTailIdentityAbs 等于 rangePercentile 与 upperTail+lowerTail 之差的绝对值',
                plainEn:
                  'RangePercentileTailIdentityAbs is the absolute difference of rangePercentile and upperTail plus lowerTail',
              },
            },
            {
              id: 'path-compose-skill-envelope-mid-inter-decile-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：skillEnvelopeMidInterDecileHonest 联合门（0/1）',
              titleEn: 'Compose KPI: skillEnvelopeMidInterDecileHonest joint gate (0/1)',
              bodyZh:
                'S20bq packaging：midTailGap 容差 ∧ interDecileGap 容差 ∧ mid↔inter 恒等 ∧ rangePercentileTailIdentityAbs→0。教学金标 → 1（下接 S20br）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S20bq packaging: midTailGap tol ∧ interDecileGap tol ∧ mid↔inter identity ∧ rangePercentileTailIdentityAbs→0; honest gold → 1 (next S20br); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_mid * c_id * c_ident * c_rpta',
                vars: {
                  gate: 'skill envelope mid/inter-decile 包装诚实门 0/1',
                  c_mid: 'midTailGap 容差 诚实 0/1',
                  c_id: 'interDecileGap 容差 诚实 0/1',
                  c_ident: 'mid↔inter 恒等 诚实 0/1',
                  c_rpta: 'rangePercentileTailIdentityAbs 诚实 0/1',
                },
                sample: {
                  c_mid: 1,
                  c_id: 1,
                  c_ident: 1,
                  c_rpta: 1,
                },
                expected: 1,
                plainZh: 'skill envelope mid/inter-decile 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Skill envelope mid/inter-decile packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
          ],
        },
        {
          id: 'path-L0',
          layer: 'L0',
          titleZh: 'L0：光敏 / 三线态教学叶子',
          titleEn: 'L0: photosensitization / triplet teaching',
          bodyZh:
            '教学可用默认参数稳态闭式与单步 RK4 演示；不计入 engineering DoD。完整 path-experiment 残差链与 Host golden 归 solvers-path-experiment / Host。',
          bodyEn:
            'Teaching steady closed forms + RK4 step allowed; eng residual chain lives in solvers-path-experiment / Host.',
        },
      ],
    },
  }
