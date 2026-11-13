import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_STRUCTURAL_MINDLIN: CalculationMethod = {
    id: 'kind-structural-mindlin',
    titleZh: 'Mindlin 板 / 结构 FOSD（工程 kind）',
    titleEn: 'Mindlin plate / structural FOSD (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind structural-static：Mindlin–Reissner 一阶剪切可变形板（FOSD）解析/ smoke 路径；工程归 @w-sim/solvers-structural。',
    summaryEn:
      'W-Sim kind structural-static: Mindlin–Reissner first-order shear-deformable (FOSD) plate path; owned by @w-sim/solvers-structural.',
    jobKinds: ['structural-static'],
    explainRoot: {
      id: 'mindlin-root',
      layer: 'method',
      titleZh: '方法：Mindlin 板 / FOSD',
      titleEn: 'Method: Mindlin plate / FOSD',
      bodyZh:
        '顶层工程计算方法：在薄→中厚板域用 Mindlin–Reissner 一阶剪切理论（横向位移 w + 独立转动 φ），相对 Kirchhoff 增加横向剪应变自由度。数值/解析 smoke 归 @w-sim/solvers-structural（structural-static）。',
      bodyEn:
        'Mindlin–Reissner FOSD adds independent rotations and transverse shear vs Kirchhoff; owned by @w-sim/solvers-structural.',
      jobKinds: ['structural-static'],
      children: [
        {
          id: 'mindlin-principle-kinematics',
          layer: 'principle',
          titleZh: '原理：FOSD 运动学与刚度',
          titleEn: 'Principle: FOSD kinematics & stiffness',
          bodyZh:
            '板中面法线变形后仍直但不垂直中面：γ_xz ≈ φ_x + ∂w/∂x 等。弯曲刚度由 D，横向剪切刚度 S = κ G t；薄极限 S→∞ 时退回 Kirchhoff。',
          bodyEn:
            'Normals remain straight but not normal to mid-surface; bending D + shear S=κGt; thin limit recovers Kirchhoff.',
          children: [
            {
              id: 'mindlin-foundation-D',
              layer: 'foundation',
              titleZh: '基础式：D = E t³ / (12 (1 − ν²))',
              titleEn: 'Foundation: D = E t³ / (12 (1 − ν²))',
              bodyZh:
                '各向同性板弯曲刚度（flexural rigidity）。E 杨氏模量，t 厚度，ν 泊松比。要求 |ν|<1、t>0、E>0。',
              bodyEn:
                'Isotropic plate flexural rigidity; require |ν|<1, t>0, E>0.',
              formula: {
                expr: 'D = E * t^3 / (12 * (1 - nu^2))',
                vars: {
                  D: '弯曲刚度 N·m',
                  E: '杨氏模量 Pa',
                  t: '板厚 m',
                  nu: '泊松比 1',
                },
                sample: { E: 2.1e11, t: 0.01, nu: 0.3 },
                expected: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                plainZh: '板弯曲刚度由弹性模量、厚度与泊松比决定',
                plainEn: 'Plate flexural rigidity from E, thickness, and Poisson ratio',
              },
            },
            {
              id: 'mindlin-foundation-G',
              layer: 'foundation',
              titleZh: '基础式：G = E / (2 (1 + ν))',
              titleEn: 'Foundation: G = E / (2 (1 + ν))',
              bodyZh:
                '各向同性剪切模量。Mindlin 横向剪应变能与 G 成正比；与 κ、t 合成为 S。',
              bodyEn:
                'Isotropic shear modulus; transverse shear energy scales with G.',
              formula: {
                expr: 'G = E / (2 * (1 + nu))',
                vars: {
                  G: '剪切模量 Pa',
                  E: '杨氏模量 Pa',
                  nu: '泊松比 1',
                },
                sample: { E: 2.1e11, nu: 0.3 },
                expected: 2.1e11 / (2 * (1 + 0.3)),
                plainZh: '各向同性剪切模量等于 E 除以 2(1+ν)',
                plainEn: 'Isotropic shear modulus is E over 2(1+ν)',
              },
            },
            {
              id: 'mindlin-foundation-S',
              layer: 'foundation',
              titleZh: '基础式：S = κ G t',
              titleEn: 'Foundation: S = κ G t',
              bodyZh:
                '横向剪切刚度。κ 为剪切修正因子（矩形截面常取 5/6）。S 越大剪切越硬，越接近 Kirchhoff。',
              bodyEn:
                'Transverse shear stiffness; κ≈5/6 for rectangular section; large S → Kirchhoff.',
              formula: {
                expr: 'S = kappa * G * t',
                vars: {
                  S: '横向剪切刚度 N/m',
                  kappa: '剪切修正因子 1',
                  G: '剪切模量 Pa',
                  t: '板厚 m',
                },
                sample: { kappa: 5 / 6, G: 2.1e11 / (2 * 1.3), t: 0.01 },
                expected: (5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01,
                plainZh: '横向剪切刚度等于剪切修正因子乘剪切模量乘厚度',
                plainEn: 'Transverse shear stiffness is κ times G times thickness',
              },
            },
            {
              id: 'mindlin-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '线性小挠度、一阶剪切（γ 沿厚均匀）、各向同性或特殊正交各向异性；不含大挠度、塑性、接触与完整 FEM 壳网格。厚板 t/a ≳ 0.2 时剪切超差为 KPI；薄极限 t/a→0 应复现 Kirchhoff。',
              bodyEn:
                'Linear FOSD; no large deflection/plasticity/contact/full shell FEM; thin limit recovers Kirchhoff.',
            },
          ],
        },
        {
          id: 'mindlin-principle-shear',
          layer: 'principle',
          titleZh: '原理：Mindlin 相对 Kirchhoff 的剪切软化',
          titleEn: 'Principle: Mindlin shear softening vs Kirchhoff',
          bodyZh:
            'Navier 级数中 Mindlin 模态幅相对 Kirchhoff 乘剪切因子 (1 + D π² k / S)，k = m²/a² + n²/b²。厚板 |w_M| > |w_K|；薄板 w_M ≈ w_K。',
          bodyEn:
            'Navier Mindlin amplitudes gain factor (1+Dπ²k/S) over Kirchhoff; thick softens, thin matches.',
          children: [
            {
              id: 'mindlin-foundation-shear-factor',
              layer: 'foundation',
              titleZh: '基础式：f = 1 + D π² k / S',
              titleEn: 'Foundation: f = 1 + D π² k / S',
              bodyZh:
                'FOSD 剪切放大因子。W_mn^M = W_mn^K · f。S→∞ 或 t→0 时 f→1，退回薄板 Kirchhoff 级数。',
              bodyEn:
                'FOSD shear amplification; W_mn^M = W_mn^K · f; f→1 recovers Kirchhoff.',
              formula: {
                expr: 'f = 1 + D * pi^2 * k / S',
                vars: {
                  f: '剪切放大因子 1',
                  D: '弯曲刚度 N·m',
                  k: '波数组合 m²/a²+n²/b² 1/m²',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.09)),
                  k: 2 / Math.pow(1, 2),
                  S: (5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01,
                },
                expected:
                  1 +
                  ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.09)) *
                    Math.PI *
                    Math.PI *
                    (2 / Math.pow(1, 2))) /
                    ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01),
                plainZh: 'Mindlin 模态幅相对 Kirchhoff 的剪切放大因子',
                plainEn: 'Shear amplification of Mindlin modal amplitude vs Kirchhoff',
              },
            },
            {
              id: 'mindlin-foundation-circ-w',
              layer: 'foundation',
              titleZh: '基础式：固支圆板 w_max = q R⁴/(64 D) + q R²/(4 S)',
              titleEn: 'Foundation: clamped circular w_max = q R⁴/(64 D) + q R²/(4 S)',
              bodyZh:
                '均匀面压 q 下 Mindlin 固支圆板中心挠度：第一项 Kirchhoff 弯曲，第二项纯剪切。薄极限仅保留 q R⁴/(64 D)。',
              bodyEn:
                'Clamped circular under uniform q: Kirchhoff bend term + pure shear; thin drops shear.',
              formula: {
                expr: 'w_max = q * R^4 / (64 * D) + q * R^2 / (4 * S)',
                vars: {
                  w_max: '中心挠度 m',
                  q: '均布面压 Pa',
                  R: '半径 m',
                  D: '弯曲刚度 N·m',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  q: 1000,
                  R: 0.5,
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.09)),
                  S: (5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01,
                },
                expected:
                  (1000 * Math.pow(0.5, 4)) /
                    (64 * ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.09)))) +
                  (1000 * Math.pow(0.5, 2)) /
                    (4 * ((5 / 6) * (2.1e11 / (2 * 1.3)) * 0.01)),
                plainZh: '固支圆板中心挠度等于弯曲项与剪切项之和',
                plainEn: 'Clamped circular center deflection is bending plus shear terms',
              },
            },
            {
              id: 'mindlin-foundation-kappa',
              layer: 'foundation',
              titleZh: '基础：κ 默认 5/6',
              titleEn: 'Foundation: default κ = 5/6',
              bodyZh:
                '矩形截面剪切修正因子常取 κ = 5/6。κ 增大 → S 增大 → 剪切超差减小；工程 smoke 含 κ 扫描残差。',
              bodyEn:
                'Rectangular κ=5/6; larger κ stiffens shear; smoke includes κ sweeps.',
              formula: {
                expr: 'kappa = 5 / 6',
                vars: {
                  kappa: '剪切修正因子 1',
                },
                sample: {},
                expected: 5 / 6,
                plainZh: '矩形截面 Mindlin 默认剪切修正因子为 5/6',
                plainEn: 'Default Mindlin shear correction for rectangular section is 5/6',
              },
            },
          ],
        },
        {
          id: 'mindlin-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-structural',
          titleEn: 'Engineering: solvers-structural',
          bodyZh:
            'JobKind `structural-static` 由 @w-sim/solvers-structural 拥有；Mindlin 板解析/KPI smoke（Navier、固支圆、条带、forced-harmonic 等）与 bar/beam/CST/tet4 FEM smoke 同包；经 kind-matrix 与 lab-kit 登记（energy↔peak dual-path packaging S26bu + half-power/energy Q×κ S26bw + Q×thickness S26bx + Q×thickness×κ S26by + Q×thickness×κ rotary dual + aspect×κ S26bz + Q×aspect×κ/thickness rotary dual S26ca + Q×aspect×thickness rotary dual-path honesty S26cb + dual-path expand |w|↔energy S26cc + thickness×κ dual-path honesty S26cd + thickness×κ dual-path expand |w|↔energy Q S26ce 等 fixture）。**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Owned by @w-sim/solvers-structural; Mindlin analytic smoke + FEM bar/beam/CST/tet4; kind-matrix + lab-kit fixtures including energy↔peak dual-path packaging S26bu + half-power/energy Q×κ S26bw + Q×thickness S26bx + Q×thickness×κ S26by + Q×thickness×κ rotary dual + aspect×κ S26bz + Q×aspect×κ/thickness rotary dual S26ca + Q×aspect×thickness rotary dual-path honesty S26cb + dual-path expand |w|↔energy S26cc + thickness×κ dual-path honesty S26cd + thickness×κ dual-path expand |w|↔energy Q S26ce; smoke residual expand ≠ eng DoD / Atlas graduation.',
          jobKinds: ['structural-static'],
        },
        {
          id: 'mindlin-compose-note',
          layer: 'compose',
          titleZh: '合成视角：Kirchhoff 弯曲 ∘ 剪切修正 ≈ Mindlin FOSD',
          titleEn: 'Compose: Kirchhoff bend ∘ shear correction ≈ Mindlin FOSD',
          bodyZh:
            '科技树语义：更基础的「弯曲刚度 D / Kirchhoff 级数 / 面密度 ρt / 模态波数 k / 转动惯量 I_ρ」与「横向剪切 S、κ、剪切放大 f、特征长度 ℓ、阻尼 ζ 半功率带宽 Δω、Q 峰因子、长细比 a/t、|w|/能量 peak-factor、双路径 joint 包装、半功率/能量 Q×κ 矩阵、半功率/能量 Q×厚度矩阵、半功率/能量 Q×厚度×κ 矩阵、thickness×κ rotary dual、aspect×κ Q 三元组、aspect×κ rotary dual、aspect×thickness rotary dual、aspect×thickness rotary dual-path honesty、aspect×thickness dual-path expand |w|↔energy packaging、thickness×κ dual-path honesty packaging」合成应在等价域复现顶层 Mindlin 挠度与能量 KPI（薄极限重合、厚板剪切超差、Mindlin 频散降频残差、共振半功率 Q、峰一致性、固支圆弯曲+剪切、κ 灵敏度、SDOF 峰频、joint dual-path max/mean/parity、rotary 降频、Q_w×κ / Q_E×κ / Q 一致性×κ、ω↑κ 单调、Q_w×t / Q_E×t / 厚度单调、Q×t×κ 三元组、rotary↓ω、Q×aspect×κ、Q×aspect×κ rotary、Q×aspect×thickness rotary、dual-path honesty、dual-path expand packaging、thickness×κ dual-path honesty packaging）。对应 foundation 的 D、S、剪切放大因子与固支圆闭式；数值 residual tip 桥接 @w-sim/solvers-structural Mindlin smoke S26bu energy↔peak dual residual packaging + S26bw half-power/energy Q×κ residual + S26bx half-power/energy Q×thickness residual + S26by half-power/energy Q×thickness×κ residual + S26bz Q×thickness×κ rotary dual + aspect×κ residual + S26ca Q×aspect×κ/thickness rotary dual residual + S26cb Q×aspect×thickness rotary dual-path honesty + S26cc dual-path expand |w|↔energy packaging + S26cd thickness×κ dual-path honesty packaging + S26ce thickness×κ dual-path expand |w|↔energy Q packaging（landed；下接 S26cf）——**smoke residual expand ≠ eng DoD / Atlas graduation**。完整 FEM 壳网格仍属 #26/#38 残差。',
          bodyEn:
            'Composing Kirchhoff D-series + ρt + modal k + rotary I_ρ + shear S/κ/f + ℓ + damping half-power Δω/Q + aspect a/t + |w|/energy peak-factors + joint dual-path packaging + half-power/energy Q×κ matrix + half-power/energy Q×thickness matrix + half-power/energy Q×thickness×κ matrix + thickness×κ rotary dual + aspect×κ Q trio + aspect×κ rotary dual + aspect×thickness rotary dual + aspect×thickness rotary dual-path honesty + aspect×thickness dual-path expand |w|↔energy packaging + thickness×κ dual-path honesty packaging should reproduce Mindlin w/energy KPIs (thin match, thick shear excess, ω dispersion residual, half-power Q, peak consistency, circular bend+shear, κ sensitivity, SDOF peak-freq, joint dual-path max/mean/parity, rotary drop, Q_w×κ / Q_E×κ / Q consistency×κ, ω↑κ monotone, Q_w×t / Q_E×t / thickness monotone, Q×t×κ trio, rotary↓ω, Q×aspect×κ, Q×aspect×κ rotary, Q×aspect×thickness rotary, dual-path honesty, dual-path expand packaging, thickness×κ dual-path honesty packaging); bridges @w-sim/solvers-structural Mindlin residual tip S26bu energy↔peak dual packaging + S26bw half-power/energy Q×κ residual + S26bx half-power/energy Q×thickness residual + S26by half-power/energy Q×thickness×κ residual + S26bz Q×thickness×κ rotary dual + aspect×κ residual + S26ca Q×aspect×κ/thickness rotary dual residual + S26cb Q×aspect×thickness rotary dual-path honesty + S26cc dual-path expand |w|↔energy packaging + S26cd thickness×κ dual-path honesty packaging + S26ce thickness×κ dual-path expand |w|↔energy Q packaging (landed; next S26cf) — smoke residual expand ≠ eng DoD / Atlas graduation; full shell FEM remains residual.',
          children: [
            {
              id: 'mindlin-compose-wM-shear',
              layer: 'foundation',
              titleZh: '合成：w_M = w_K · (1 + D π² k / S)',
              titleEn: 'Compose: w_M = w_K · (1 + D π² k / S)',
              bodyZh:
                '把 Kirchhoff 模态挠度 w_K 与 FOSD 剪切放大因子合成 Mindlin 幅：W_mn^M = W_mn^K · f，f = 1 + D π² k / S，k = m²/a² + n²/b²。算例 E=210 GPa、t=0.01、a=b=1、m=n=1 → f≈1.00056，剪切略软。',
              bodyEn:
                'Composes Kirchhoff modal w_K with FOSD shear factor f=1+Dπ²k/S into Mindlin amplitude; sample SS plate m=n=1 softens slightly.',
              formula: {
                expr: 'w_M = w_K * (1 + D * pi^2 * k / S)',
                vars: {
                  w_M: 'Mindlin 模态挠度 m',
                  w_K: 'Kirchhoff 模态挠度 m',
                  D: '弯曲刚度 N·m',
                  pi: '圆周率',
                  k: '波数组合 m²/a²+n²/b² 1/m²',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  w_K: 1e-5,
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  pi: Math.PI,
                  k: 2 / Math.pow(1, 2),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                },
                expected:
                  1e-5 *
                  (1 +
                    (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
                      Math.PI *
                      Math.PI *
                      (2 / Math.pow(1, 2))) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)),
                plainZh:
                  'Mindlin 挠度由 Kirchhoff 挠度乘以剪切放大因子合成',
                plainEn:
                  'Mindlin deflection composes Kirchhoff deflection times the shear amplification factor',
              },
            },
            {
              id: 'mindlin-compose-D',
              layer: 'foundation',
              titleZh: '合成：D = E t³ / (12 (1 − ν²))',
              titleEn: 'Compose: D = E t³ / (12 (1 − ν²))',
              bodyZh:
                '把材料 (E,ν) 与几何 t 合成弯曲刚度 D，作为 Kirchhoff 级数与 Mindlin 剪切因子的公共弯曲支路。算例钢 E=2.1e11、ν=0.3、t=0.01 → D≈1.923×10⁴ N·m。',
              bodyEn:
                'Composes material (E,ν) and thickness into flexural rigidity D shared by Kirchhoff series and Mindlin shear factor.',
              formula: {
                expr: 'D = E * t^3 / (12 * (1 - nu^2))',
                vars: {
                  D: '弯曲刚度 N·m',
                  E: '杨氏模量 Pa',
                  t: '板厚 m',
                  nu: '泊松比 1',
                },
                sample: { E: 2.1e11, t: 0.01, nu: 0.3 },
                expected: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                plainZh: '弯曲刚度由弹性模量、厚度立方与泊松比合成',
                plainEn:
                  'Flexural rigidity composes Young modulus, thickness cubed, and Poisson ratio',
              },
            },
            {
              id: 'mindlin-compose-S',
              layer: 'foundation',
              titleZh: '合成：S = κ G t，G = E / (2 (1 + ν))',
              titleEn: 'Compose: S = κ G t with G = E / (2 (1 + ν))',
              bodyZh:
                '把各向同性剪切模量 G=E/(2(1+ν)) 与 κ、t 合成横向剪切刚度 S=κ G t。矩形截面默认 κ=5/6。算例 E=2.1e11、ν=0.3、t=0.01 → S≈6.731×10⁸ N/m。',
              bodyEn:
                'Composes isotropic G from E,ν then S=κGt; rectangular κ=5/6; sample steel plate t=0.01.',
              formula: {
                expr: 'S = kappa * (E / (2 * (1 + nu))) * t',
                vars: {
                  S: '横向剪切刚度 N/m',
                  kappa: '剪切修正因子 1',
                  E: '杨氏模量 Pa',
                  nu: '泊松比 1',
                  t: '板厚 m',
                },
                sample: { kappa: 5 / 6, E: 2.1e11, nu: 0.3, t: 0.01 },
                expected: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                plainZh:
                  '横向剪切刚度由剪切修正因子、由 E 与 ν 合成的剪切模量及厚度相乘得到',
                plainEn:
                  'Transverse shear stiffness composes κ, isotropic G from E and ν, and thickness',
              },
            },
            {
              id: 'mindlin-compose-thin-limit',
              layer: 'foundation',
              titleZh: '合成 KPI：薄极限残差 |w_M − w_K| / |w_K| → 0',
              titleEn: 'Compose KPI: thin-limit residual |w_M − w_K| / |w_K| → 0',
              bodyZh:
                '薄极限合同：相对残差 |w_M−w_K|/|w_K| = |f−1| = D π² k / S。因 D∝t³、S∝t，残差∝t² → 0。算例 t=1e−4、a=b=1、m=n=1 → 残差 ≈ 5.6×10⁻⁸ ≪ 1。',
              bodyEn:
                'Thin-limit KPI: |w_M−w_K|/|w_K|=Dπ²k/S ∝ t²→0; sample t=1e-4 yields residual ~5.6e-8.',
              formula: {
                expr: 'res = abs(D * pi^2 * k / S)',
                vars: {
                  res: '薄极限相对残差 1',
                  D: '弯曲刚度 N·m',
                  pi: '圆周率',
                  k: '波数组合 m²/a²+n²/b² 1/m²',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(1e-4, 3)) / (12 * (1 - 0.3 * 0.3)),
                  pi: Math.PI,
                  k: 2 / Math.pow(1, 2),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 1e-4,
                },
                expected: Math.abs(
                  (((2.1e11 * Math.pow(1e-4, 3)) / (12 * (1 - 0.3 * 0.3))) *
                    Math.PI *
                    Math.PI *
                    (2 / Math.pow(1, 2))) /
                    ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 1e-4),
                ),
                plainZh:
                  '薄板极限下 Mindlin 与 Kirchhoff 挠度相对残差应趋于零',
                plainEn:
                  'Relative residual between Mindlin and Kirchhoff deflection vanishes in the thin-plate limit',
              },
            },
            {
              id: 'mindlin-compose-omega',
              layer: 'foundation',
              titleZh: '合成：简支板固有频 ω = π² √(D/ρt) · k',
              titleEn: 'Compose: SS plate natural ω = π² √(D/ρt) · k',
              bodyZh:
                '把弯曲刚度 D 与面密度 ρt 合成 Kirchhoff 简支矩形板 (m,n) 模态角频率：ω = π² √(D/(ρ t)) (m²/a²+n²/b²)。Mindlin 厚板会再经剪切软化略降频；教学先用薄板合成。算例钢 ρ=7850、t=0.01、a=b=1、m=n=1。',
              bodyEn:
                'Composes D and areal density ρt into SS Kirchhoff modal ω; thick Mindlin softens further; teaching sample steel plate.',
              formula: {
                expr: 'omega = pi^2 * sqrt(D / (rho * t)) * k',
                vars: {
                  omega: '固有角频率 rad/s',
                  pi: '圆周率',
                  D: '弯曲刚度 N·m',
                  rho: '质量密度 kg/m³',
                  t: '板厚 m',
                  k: '波数组合 m²/a²+n²/b² 1/m²',
                },
                sample: {
                  pi: Math.PI,
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  rho: 7850,
                  t: 0.01,
                  k: 2 / Math.pow(1, 2),
                },
                expected:
                  Math.PI *
                  Math.PI *
                  Math.sqrt(
                    ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                      (7850 * 0.01),
                  ) *
                  (2 / Math.pow(1, 2)),
                plainZh:
                  '简支矩形板固有角频率由弯曲刚度、面密度与模态波数组合合成',
                plainEn:
                  'Simply-supported plate natural frequency composes flexural rigidity, areal density, and modal wave-number sum',
              },
            },
            {
              id: 'mindlin-compose-circ-w',
              layer: 'foundation',
              titleZh: '合成：固支圆板 w_max = q R⁴/(64 D) + q R²/(4 S)',
              titleEn: 'Compose: clamped circular w_max = q R⁴/(64 D) + q R²/(4 S)',
              bodyZh:
                '把均布面压 q、半径 R、弯曲刚度 D 与剪切刚度 S 合成 Mindlin 固支圆板中心挠度（弯曲项 + 剪切项）。薄极限仅保留 q R⁴/(64 D)。算例 q=1000、R=0.5、钢 t=0.01。',
              bodyEn:
                'Composes q,R,D,S into clamped circular center deflection (bend+shear); thin drops shear; sample steel plate.',
              formula: {
                expr: 'w_max = q * R^4 / (64 * D) + q * R^2 / (4 * S)',
                vars: {
                  w_max: '中心挠度 m',
                  q: '均布面压 Pa',
                  R: '半径 m',
                  D: '弯曲刚度 N·m',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  q: 1000,
                  R: 0.5,
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                },
                expected:
                  (1000 * Math.pow(0.5, 4)) /
                    (64 * ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)))) +
                  (1000 * Math.pow(0.5, 2)) /
                    (4 * ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)),
                plainZh: '固支圆板中心挠度由弯曲项与剪切项合成',
                plainEn:
                  'Clamped circular center deflection composes bending and shear contributions',
              },
            },
            {
              id: 'mindlin-compose-shear-fraction',
              layer: 'foundation',
              titleZh: '合成 KPI：剪切挠度占比 w_s / w_max',
              titleEn: 'Compose KPI: shear deflection fraction w_s / w_max',
              bodyZh:
                '把纯剪切项 w_s=q R²/(4 S) 与总挠度合成占比，衡量 FOSD 相对 Kirchhoff 的剪切贡献。薄板占比→0；厚板抬升。算例钢 t=0.01、R=0.5 时剪切占比很小。',
              bodyEn:
                'Fraction of center deflection from pure shear; thin →0, thick rises; sample thin steel plate.',
              formula: {
                expr: 'frac = w_s / w_max',
                vars: {
                  frac: '剪切挠度占比 1',
                  w_s: '纯剪切挠度 m',
                  w_max: '总中心挠度 m',
                },
                sample: {
                  w_s:
                    (1000 * Math.pow(0.5, 2)) /
                    (4 * ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)),
                  w_max:
                    (1000 * Math.pow(0.5, 4)) /
                      (64 *
                        ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)))) +
                    (1000 * Math.pow(0.5, 2)) /
                      (4 * ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)),
                },
                expected: (() => {
                  const ws =
                    (1000 * Math.pow(0.5, 2)) /
                    (4 * ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01))
                  const wmax =
                    (1000 * Math.pow(0.5, 4)) /
                      (64 *
                        ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)))) +
                    ws
                  return ws / wmax
                })(),
                plainZh: '剪切挠度占总中心挠度的比例衡量 Mindlin 相对 Kirchhoff 的剪切贡献',
                plainEn:
                  'Shear share of center deflection measures Mindlin shear contribution vs Kirchhoff',
              },
            },
            {
              id: 'mindlin-compose-thick-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：厚板剪切超差 |f−1| = D π² k / S',
              titleEn: 'Compose KPI: thick-plate shear excess |f−1| = D π² k / S',
              bodyZh:
                '厚板合同：相对 Kirchhoff 的剪切超差 |w_M−w_K|/|w_K| = D π² k / S。因 D∝t³、S∝t，超差∝t²；算例 t=0.1、a=b=1、m=n=1 时超差显著大于薄极限。',
              bodyEn:
                'Thick-plate KPI: shear excess Dπ²k/S ∝ t²; sample t=0.1 is much larger than thin limit.',
              formula: {
                expr: 'excess = abs(D * pi^2 * k / S)',
                vars: {
                  excess: '厚板剪切相对超差 1',
                  D: '弯曲刚度 N·m',
                  pi: '圆周率',
                  k: '波数组合 m²/a²+n²/b² 1/m²',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(0.1, 3)) / (12 * (1 - 0.3 * 0.3)),
                  pi: Math.PI,
                  k: 2 / Math.pow(1, 2),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.1,
                },
                expected: Math.abs(
                  (((2.1e11 * Math.pow(0.1, 3)) / (12 * (1 - 0.3 * 0.3))) *
                    Math.PI *
                    Math.PI *
                    (2 / Math.pow(1, 2))) /
                    ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.1),
                ),
                plainZh: '厚板 Mindlin 相对 Kirchhoff 的剪切超差随厚度平方增长',
                plainEn:
                  'Thick-plate Mindlin shear excess over Kirchhoff grows with thickness squared',
              },
            },
            {
              id: 'mindlin-compose-G-from-E',
              layer: 'foundation',
              titleZh: '合成：G = E/(2(1+ν)) 入 S 链',
              titleEn: 'Compose: G = E/(2(1+ν)) into S chain',
              bodyZh:
                '材料 (E,ν) 先合成各向同性剪切模量 G，再进入 S=κ G t。算例 E=2.1e11、ν=0.3 → G≈8.077e10 Pa，与 mindlin-compose-S 上游合同。',
              bodyEn:
                'Composes isotropic G from E,ν as upstream of S=κGt; sample steel G≈8.077e10 Pa.',
              formula: {
                expr: 'G = E / (2 * (1 + nu))',
                vars: {
                  G: '剪切模量 Pa',
                  E: '杨氏模量 Pa',
                  nu: '泊松比 1',
                },
                sample: { E: 2.1e11, nu: 0.3 },
                expected: 2.1e11 / (2 * (1 + 0.3)),
                plainZh: '各向同性剪切模量由弹性模量与泊松比合成，作为横向剪切刚度上游',
                plainEn:
                  'Isotropic shear modulus composes from E and ν as upstream of transverse shear stiffness',
              },
            },
            {
              id: 'mindlin-compose-kappa',
              layer: 'foundation',
              titleZh: '合成：κ = 5/6 矩形截面剪切修正',
              titleEn: 'Compose: κ = 5/6 rectangular shear correction',
              bodyZh:
                '矩形截面默认剪切修正因子 κ=5/6 直接进入 S=κ G t。与 foundation-kappa 合同；完整截面形函数修正仍属 FEM 残差。',
              bodyEn:
                'Default rectangular shear correction κ=5/6 feeds S=κGt; contracts foundation-kappa; full section-shape κ remains FEM residual.',
              formula: {
                expr: 'kappa = 5 / 6',
                vars: {
                  kappa: '剪切修正因子 1',
                },
                sample: {},
                expected: 5 / 6,
                plainZh: '矩形截面 Mindlin 默认剪切修正因子为 5/6，进入横向剪切刚度合成',
                plainEn:
                  'Default Mindlin shear correction for rectangular section is 5/6 into transverse shear stiffness',
              },
            },
            {
              id: 'mindlin-compose-f-shear',
              layer: 'foundation',
              titleZh: '合成：f = 1 + D π² k / S 剪切放大因子',
              titleEn: 'Compose: f = 1 + D π² k / S shear amplification',
              bodyZh:
                '把 D、S 与模态波数 k 合成 FOSD 剪切放大因子 f，再入 w_M=w_K·f 与 ω_M=ω_K/√f。算例钢 t=0.01、a=b=1、m=n=1 → f≈1.00056。',
              bodyEn:
                'Composes D,S,k into FOSD shear factor f upstream of w_M and ω_M; sample thin steel SS plate f≈1.00056.',
              formula: {
                expr: 'f = 1 + D * pi^2 * k / S',
                vars: {
                  f: '剪切放大因子 1',
                  D: '弯曲刚度 N·m',
                  pi: '圆周率',
                  k: '波数组合 m²/a²+n²/b² 1/m²',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  pi: Math.PI,
                  k: 2 / Math.pow(1, 2),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                },
                expected:
                  1 +
                  (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
                    Math.PI *
                    Math.PI *
                    (2 / Math.pow(1, 2))) /
                    ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                plainZh:
                  'FOSD 剪切放大因子由弯曲刚度、波数组合与横向剪切刚度合成',
                plainEn:
                  'FOSD shear amplification composes flexural rigidity, wave-number sum, and transverse shear stiffness',
              },
            },
            {
              id: 'mindlin-compose-areal-mu',
              layer: 'foundation',
              titleZh: '合成：μ = ρ t 面密度入频散链',
              titleEn: 'Compose: μ = ρ t areal density into dispersion chain',
              bodyZh:
                '把体密度 ρ 与板厚 t 合成面密度 μ=ρt，再进入 ω∝√(D/μ)。算例钢 ρ=7850、t=0.01 → μ=78.5 kg/m²。',
              bodyEn:
                'Composes bulk density and thickness into areal mass μ upstream of modal ω; sample steel μ=78.5 kg/m².',
              formula: {
                expr: 'mu = rho * t',
                vars: {
                  mu: '面密度 kg/m²',
                  rho: '质量密度 kg/m³',
                  t: '板厚 m',
                },
                sample: { rho: 7850, t: 0.01 },
                expected: 7850 * 0.01,
                plainZh: '板面密度由体密度与厚度合成，作为固有频率链的质量侧输入',
                plainEn:
                  'Plate areal density composes from bulk density and thickness as the mass side of the natural-frequency chain',
              },
            },
            {
              id: 'mindlin-compose-omega-mindlin',
              layer: 'foundation',
              titleZh: '合成：ω_M = ω_K / √f Mindlin 剪切软化频',
              titleEn: 'Compose: ω_M = ω_K / √f Mindlin shear-softened frequency',
              bodyZh:
                '把 Kirchhoff 模态角频率 ω_K 与剪切放大因子 f 合成 Mindlin 降频：ω_M = ω_K / √f（f=1+Dπ²k/S）。薄板 f→1 ⇒ ω_M→ω_K。算例钢 t=0.01、a=b=1、m=n=1。',
              bodyEn:
                'Composes Kirchhoff ω_K with shear factor f into Mindlin ω_M=ω_K/√f; thin f→1 recovers Kirchhoff; sample steel plate.',
              formula: {
                expr: 'omega_M = omega_K / sqrt(f)',
                vars: {
                  omega_M: 'Mindlin 固有角频率 rad/s',
                  omega_K: 'Kirchhoff 固有角频率 rad/s',
                  f: '剪切放大因子 1',
                },
                sample: {
                  omega_K:
                    Math.PI *
                    Math.PI *
                    Math.sqrt(
                      ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                        (7850 * 0.01),
                    ) *
                    (2 / Math.pow(1, 2)),
                  f:
                    1 +
                    (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
                      Math.PI *
                      Math.PI *
                      (2 / Math.pow(1, 2))) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                },
                expected: (() => {
                  const omegaK =
                    Math.PI *
                    Math.PI *
                    Math.sqrt(
                      ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                        (7850 * 0.01),
                    ) *
                    2
                  const f =
                    1 +
                    (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
                      Math.PI *
                      Math.PI *
                      2) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)
                  return omegaK / Math.sqrt(f)
                })(),
                plainZh:
                  'Mindlin 模态角频率由 Kirchhoff 频率除以剪切放大因子的平方根合成',
                plainEn:
                  'Mindlin modal frequency composes as Kirchhoff frequency over square root of the shear amplification factor',
              },
            },
            {
              id: 'mindlin-compose-omega-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：板频散残差 |ω_K − ω_M| / ω_K',
              titleEn: 'Compose KPI: plate dispersion residual |ω_K − ω_M| / ω_K',
              bodyZh:
                'Mindlin 相对 Kirchhoff 的频散降频残差 res = 1 − 1/√f。薄板 →0；厚板抬升。算例钢 t=0.01 残差极小；与 thin-limit 挠度残差同源 f−1。',
              bodyEn:
                'Dispersion residual 1−1/√f; thin→0, thick rises; sample thin steel tiny; shares f with deflection thin-limit.',
              formula: {
                expr: 'res = abs(omega_K - omega_M) / abs(omega_K)',
                vars: {
                  res: '频散相对残差 1',
                  omega_K: 'Kirchhoff 固有角频率 rad/s',
                  omega_M: 'Mindlin 固有角频率 rad/s',
                },
                sample: (() => {
                  const omegaK =
                    Math.PI *
                    Math.PI *
                    Math.sqrt(
                      ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                        (7850 * 0.01),
                    ) *
                    2
                  const f =
                    1 +
                    (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
                      Math.PI *
                      Math.PI *
                      2) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)
                  const omegaM = omegaK / Math.sqrt(f)
                  return { omega_K: omegaK, omega_M: omegaM }
                })(),
                expected: (() => {
                  const f =
                    1 +
                    (((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) *
                      Math.PI *
                      Math.PI *
                      2) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)
                  return 1 - 1 / Math.sqrt(f)
                })(),
                plainZh:
                  'Mindlin 相对 Kirchhoff 的板模态频散相对残差衡量剪切软化降频',
                plainEn:
                  'Relative plate-mode dispersion residual between Mindlin and Kirchhoff measures shear-softened frequency drop',
              },
            },
            {
              id: 'mindlin-compose-zeta-peak',
              layer: 'foundation',
              titleZh: '合成：共振峰因子 Q = 1/(2 ζ)',
              titleEn: 'Compose: resonance peak factor Q = 1/(2 ζ)',
              bodyZh:
                '把模态阻尼比 ζ 合成 forced-harmonic 共振位移放大峰 Q≈1/(2ζ)。算例 ζ=0.05 → Q=10；与 Mindlin 模态刚度链并列教学，完整 forced-harmonic smoke 归 solvers-structural。',
              bodyEn:
                'Composes modal damping ζ into resonance peak Q≈1/(2ζ); sample ζ=0.05 → Q=10; full forced-harmonic smoke in solvers-structural.',
              formula: {
                expr: 'Q = 1 / (2 * zeta)',
                vars: {
                  Q: '共振位移放大峰 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 1 / (2 * 0.05),
                plainZh: '小阻尼共振峰位移放大因子由阻尼比合成，约等于 1/(2ζ)',
                plainEn:
                  'Lightly damped resonance displacement peak composes from damping ratio as about 1/(2ζ)',
              },
            },
            {
              id: 'mindlin-compose-aspect',
              layer: 'foundation',
              titleZh: '合成 KPI：长细比 a/t 与薄/厚分界',
              titleEn: 'Compose KPI: aspect a/t and thin/thick boundary',
              bodyZh:
                '把板边长 a 与厚度 t 合成长细比 AR=a/t。工程粗分：AR≳20 倾向薄板 Kirchhoff，AR≲10 剪切不可忽略。算例 a=1、t=0.01 → AR=100（薄）；t=0.1 → AR=10（厚边界）。',
              bodyEn:
                'Composes span a and thickness into aspect AR=a/t; AR≳20 thin/Kirchhoff-leaning, AR≲10 shear-important; samples 100 and 10.',
              formula: {
                expr: 'AR = a / t',
                vars: {
                  AR: '长细比 a/t 1',
                  a: '板边长 m',
                  t: '板厚 m',
                },
                sample: { a: 1, t: 0.01 },
                expected: 100,
                plainZh:
                  '板长细比等于边长除以厚度，用于判断薄极限与 Mindlin 剪切是否可忽略',
                plainEn:
                  'Plate aspect ratio is span over thickness, classifying thin limit vs Mindlin shear importance',
              },
            },
            {
              id: 'mindlin-compose-char-length',
              layer: 'foundation',
              titleZh: '合成：特征长度 ℓ = √(D/S) 剪切尺度',
              titleEn: 'Compose: characteristic length ℓ = √(D/S) shear scale',
              bodyZh:
                '把弯曲刚度 D 与剪切刚度 S 合成剪切特征长度 ℓ=√(D/S)。因 D∝t³、S∝t，ℓ∝t；与波长/边长比衡量剪切软化强弱。算例钢 t=0.01 → ℓ≈√(D/S)。',
              bodyEn:
                'Composes D and S into shear length ℓ=√(D/S)∝t; ratio to span gauges shear softening; sample steel t=0.01.',
              formula: {
                expr: 'ell = sqrt(D / S)',
                vars: {
                  ell: '剪切特征长度 m',
                  D: '弯曲刚度 N·m',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                },
                expected: Math.sqrt(
                  ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                    ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                ),
                plainZh:
                  '剪切特征长度由弯曲刚度与横向剪切刚度之比开方合成，尺度与板厚同阶',
                plainEn:
                  'Shear characteristic length composes as square root of D over S and scales with plate thickness',
              },
            },
            {
              id: 'mindlin-compose-k-modal',
              layer: 'foundation',
              titleZh: '合成：k = m²/a² + n²/b² 模态波数',
              titleEn: 'Compose: k = m²/a² + n²/b² modal wave-number sum',
              bodyZh:
                '把简支矩形板模态指标 (m,n) 与边长 a,b 合成波数组合 k，进入 f、ω 与超差链。算例 m=n=1、a=b=1 → k=2。',
              bodyEn:
                'Composes SS plate mode indices (m,n) and spans into k upstream of f, ω, excess; sample m=n=1,a=b=1 → k=2.',
              formula: {
                expr: 'k = m^2 / a^2 + n^2 / b^2',
                vars: {
                  k: '波数组合 1/m²',
                  m: 'x 向半波数 1',
                  n: 'y 向半波数 1',
                  a: 'x 边长 m',
                  b: 'y 边长 m',
                },
                sample: { m: 1, n: 1, a: 1, b: 1 },
                expected: 2,
                plainZh: '简支板模态波数组合由半波数平方除以边长平方再相加合成',
                plainEn:
                  'Simply-supported modal wave-number sum composes half-wave indices squared over span squares',
              },
            },
            {
              id: 'mindlin-compose-DS-ratio',
              layer: 'foundation',
              titleZh: '合成：D/S = ℓ² 弯曲–剪切比',
              titleEn: 'Compose: D/S = ℓ² bend–shear ratio',
              bodyZh:
                '弯曲与横向剪切刚度之比等于剪切特征长度平方。算例钢 t=0.01 → D/S = ℓ²，与 mindlin-compose-char-length 合同。',
              bodyEn:
                'Ratio D/S equals shear length squared; sample steel t=0.01 contracts char-length.',
              formula: {
                expr: 'ratio = D / S',
                vars: {
                  ratio: 'D/S 比 m²',
                  D: '弯曲刚度 N·m',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                },
                expected:
                  ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                  ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                plainZh: '弯曲–剪切刚度比等于特征长度平方，连接 D、S 与 f 放大链',
                plainEn:
                  'Bend–shear stiffness ratio equals characteristic length squared, linking D, S, and the f amplification chain',
              },
            },
            {
              id: 'mindlin-compose-f-from-ell',
              layer: 'foundation',
              titleZh: '合成：f = 1 + π² k ℓ² 由特征长度',
              titleEn: 'Compose: f = 1 + π² k ℓ² from shear length',
              bodyZh:
                '因 ℓ²=D/S，剪切放大 f=1+Dπ²k/S = 1+π²kℓ²。算例钢 t=0.01、k=2 → 与 mindlin-compose-f-shear 合同。',
              bodyEn:
                'With ℓ²=D/S, f=1+π²kℓ²; sample steel t=0.01,k=2 contracts f-shear.',
              formula: {
                expr: 'f = 1 + pi^2 * k * ell^2',
                vars: {
                  f: '剪切放大因子 1',
                  pi: '圆周率',
                  k: '波数组合 1/m²',
                  ell: '剪切特征长度 m',
                },
                sample: {
                  pi: Math.PI,
                  k: 2,
                  ell: Math.sqrt(
                    ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                  ),
                },
                expected: (() => {
                  const ell = Math.sqrt(
                    ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                  )
                  return 1 + Math.PI * Math.PI * 2 * ell * ell
                })(),
                plainZh:
                  '剪切放大因子由模态波数与剪切特征长度平方合成，等价于 Dπ²k/S',
                plainEn:
                  'Shear amplification composes from modal wave-number and shear length squared, equivalent to Dπ²k/S',
              },
            },
            {
              id: 'mindlin-compose-ell-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：ℓ/a 剪切尺度比',
              titleEn: 'Compose KPI: ℓ/a shear-scale ratio',
              bodyZh:
                '把剪切特征长度与板边长合成无量纲比 r=ℓ/a。薄板 r≪1；r 抬升时 FOSD 剪切不可忽略。算例钢 t=0.01、a=1。',
              bodyEn:
                'Dimensionless shear scale r=ℓ/a; thin r≪1; larger r ⇒ FOSD shear matters; sample steel t=0.01,a=1.',
              formula: {
                expr: 'r = ell / a',
                vars: {
                  r: '剪切尺度比 1',
                  ell: '剪切特征长度 m',
                  a: '板边长 m',
                },
                sample: {
                  ell: Math.sqrt(
                    ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                      ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                  ),
                  a: 1,
                },
                expected: Math.sqrt(
                  ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                    ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01),
                ),
                plainZh:
                  '剪切特征长度与板边长之比衡量 Mindlin 剪切软化相对弯曲的强弱',
                plainEn:
                  'Ratio of shear characteristic length to plate span gauges Mindlin shear softening vs bending',
              },
            },
            {
              id: 'mindlin-compose-rotary-I',
              layer: 'foundation',
              titleZh: '合成：I_ρ = ρ t³/12 转动惯量面密度',
              titleEn: 'Compose: I_ρ = ρ t³/12 rotary inertia density',
              bodyZh:
                '把体密度 ρ 与厚度 t 合成 Mindlin 转动惯量面密度 I_ρ=ρ t³/12（均匀板）。厚板动力学 rotary dual 残差链入门；完整 forced-harmonic rotary tip 归 solvers-structural（S26bq 等）。算例钢 ρ=7850、t=0.01。',
              bodyEn:
                'Composes bulk density and thickness into Mindlin rotary inertia density I_ρ=ρt³/12; thick-plate rotary dual residual entry; full tip in solvers-structural (S26bq family).',
              formula: {
                expr: 'I_rho = rho * t^3 / 12',
                vars: {
                  I_rho: '转动惯量面密度 kg',
                  rho: '质量密度 kg/m³',
                  t: '板厚 m',
                },
                sample: { rho: 7850, t: 0.01 },
                expected: (7850 * Math.pow(0.01, 3)) / 12,
                plainZh:
                  'Mindlin 转动惯量面密度由体密度与厚度立方合成，作为 rotary dual 残差上游',
                plainEn:
                  'Mindlin rotary inertia density composes from bulk density and thickness cubed as upstream of rotary dual residuals',
              },
            },
            {
              id: 'mindlin-compose-half-power',
              layer: 'foundation',
              titleZh: '合成：Δω = 2 ζ ω 半功率带宽',
              titleEn: 'Compose: Δω = 2 ζ ω half-power bandwidth',
              bodyZh:
                '把模态阻尼比 ζ 与固有角频率 ω 合成半功率带宽 Δω≈2ζω（=ω/Q）。桥接 S26bd/S26bq half-power residual 教学入口；算例 ζ=0.05、ω=100 → Δω=10 rad/s。',
              bodyEn:
                'Composes ζ and ω into half-power bandwidth Δω≈2ζω (=ω/Q); bridges S26bd/S26bq half-power residual teaching; sample 10 rad/s.',
              formula: {
                expr: 'dOmega = 2 * zeta * omega',
                vars: {
                  dOmega: '半功率带宽 rad/s',
                  zeta: '模态阻尼比 1',
                  omega: '固有角频率 rad/s',
                },
                sample: { zeta: 0.05, omega: 100 },
                expected: 10,
                plainZh: '半功率带宽由阻尼比与固有角频率合成，约等于 2ζω',
                plainEn:
                  'Half-power bandwidth composes from damping ratio and natural frequency as about 2ζω',
              },
            },
            {
              id: 'mindlin-compose-rel-bandwidth',
              layer: 'foundation',
              titleZh: '合成：Δω/ω = 1/Q = 2 ζ 相对带宽',
              titleEn: 'Compose: Δω/ω = 1/Q = 2 ζ relative bandwidth',
              bodyZh:
                '相对半功率带宽等于 1/Q 或 2ζ。算例 Q=10 → 相对带宽 0.1，与 mindlin-compose-zeta-peak 合同。',
              bodyEn:
                'Relative half-power bandwidth is 1/Q or 2ζ; sample Q=10 → 0.1 contracts zeta-peak.',
              formula: {
                expr: 'rel = 1 / Q',
                vars: {
                  rel: '相对半功率带宽 1',
                  Q: '共振放大因子 1',
                },
                sample: { Q: 10 },
                expected: 0.1,
                plainZh: '相对半功率带宽等于共振放大因子的倒数，也等于 2ζ',
                plainEn:
                  'Relative half-power bandwidth is the reciprocal of resonance Q and equals 2ζ',
              },
            },
            {
              id: 'mindlin-compose-Q-from-bandwidth',
              layer: 'foundation',
              titleZh: '合成：Q = ω / Δω 由半功率带宽',
              titleEn: 'Compose: Q = ω / Δω from half-power bandwidth',
              bodyZh:
                '把固有频与半功率带宽反推 Q。算例 ω=100、Δω=10 → Q=10，与 1/(2ζ) 峰因子合同；对应 half-power Δω/Q residual 教学。',
              bodyEn:
                'Inverts ω and Δω into Q; sample 100/10=10 contracts 1/(2ζ); half-power Δω/Q residual teaching.',
              formula: {
                expr: 'Q = omega / dOmega',
                vars: {
                  Q: '共振放大因子 1',
                  omega: '固有角频率 rad/s',
                  dOmega: '半功率带宽 rad/s',
                },
                sample: { omega: 100, dOmega: 10 },
                expected: 10,
                plainZh: '共振放大因子由固有角频率除以半功率带宽合成',
                plainEn:
                  'Resonance Q composes as natural frequency over half-power bandwidth',
              },
            },
            {
              id: 'mindlin-compose-Q-match',
              layer: 'foundation',
              titleZh: '合成 KPI：Q 匹配残差 |Q − 1/(2ζ)| / Q',
              titleEn: 'Compose KPI: Q match residual |Q − 1/(2ζ)| / Q',
              bodyZh:
                '半功率定义 Q=ω/Δω 应与阻尼定义 Q=1/(2ζ) 一致。算例 Q=10、ζ=0.05 完全匹配时残差为 0；桥接 peak consistency residual 教学（smoke≠eng）。',
              bodyEn:
                'Half-power Q must match 1/(2ζ); sample matched residual 0; bridges peak-consistency residual teaching (smoke≠eng).',
              formula: {
                expr: 'res = abs(Q - 1 / (2 * zeta)) / abs(Q)',
                vars: {
                  res: 'Q 匹配相对残差 1',
                  Q: '半功率共振放大因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { Q: 10, zeta: 0.05 },
                expected: 0,
                plainZh: '半功率 Q 与 1/(2ζ) 峰因子匹配时相对残差应为零',
                plainEn:
                  'Relative residual between half-power Q and 1/(2ζ) peak factor should be zero when matched',
              },
            },
            {
              id: 'mindlin-compose-w-bend',
              layer: 'foundation',
              titleZh: '合成：w_b = q R⁴/(64 D) 纯弯曲项',
              titleEn: 'Compose: w_b = q R⁴/(64 D) pure bending term',
              bodyZh:
                '固支圆板中心挠度的 Kirchhoff 弯曲支路。算例 q=1000、R=0.5、钢 t=0.01；与 mindlin-compose-circ-w 弯曲分量合同。',
              bodyEn:
                'Kirchhoff bend branch of clamped circular center deflection; sample contracts circ-w bend term.',
              formula: {
                expr: 'w_b = q * R^4 / (64 * D)',
                vars: {
                  w_b: '纯弯曲中心挠度 m',
                  q: '均布面压 Pa',
                  R: '半径 m',
                  D: '弯曲刚度 N·m',
                },
                sample: {
                  q: 1000,
                  R: 0.5,
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                },
                expected:
                  (1000 * Math.pow(0.5, 4)) /
                  (64 * ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)))),
                plainZh: '固支圆板纯弯曲挠度由面压、半径四次方与弯曲刚度合成',
                plainEn:
                  'Clamped circular pure bending deflection composes pressure, radius to the fourth, and flexural rigidity',
              },
            },
            {
              id: 'mindlin-compose-w-shear',
              layer: 'foundation',
              titleZh: '合成：w_s = q R²/(4 S) 纯剪切项',
              titleEn: 'Compose: w_s = q R²/(4 S) pure shear term',
              bodyZh:
                '固支圆板中心挠度的 FOSD 纯剪切支路。算例 q=1000、R=0.5、钢 t=0.01；与 mindlin-compose-shear-fraction 上游合同。',
              bodyEn:
                'FOSD pure shear branch of clamped circular center deflection; sample contracts shear-fraction upstream.',
              formula: {
                expr: 'w_s = q * R^2 / (4 * S)',
                vars: {
                  w_s: '纯剪切中心挠度 m',
                  q: '均布面压 Pa',
                  R: '半径 m',
                  S: '横向剪切刚度 N/m',
                },
                sample: {
                  q: 1000,
                  R: 0.5,
                  S: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01,
                },
                expected:
                  (1000 * Math.pow(0.5, 2)) /
                  (4 * ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.01)),
                plainZh: '固支圆板纯剪切挠度由面压、半径平方与横向剪切刚度合成',
                plainEn:
                  'Clamped circular pure shear deflection composes pressure, radius squared, and transverse shear stiffness',
              },
            },
            {
              id: 'mindlin-compose-kappa-S-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：κ 扫描 S₂/S₁ = κ₂/κ₁',
              titleEn: 'Compose KPI: κ-sweep S₂/S₁ = κ₂/κ₁',
              bodyZh:
                '固定 G、t 时横向剪切刚度与 κ 成正比。算例 κ₁=5/6、κ₂=1 → S₂/S₁=1.2；桥接 peak×κ / κ-sweep residual 教学（smoke≠eng）。',
              bodyEn:
                'At fixed G,t, S ∝ κ; sample κ=5/6→1 yields S ratio 1.2; bridges peak×κ / κ-sweep residual teaching (smoke≠eng).',
              formula: {
                expr: 'ratio = kappa2 / kappa1',
                vars: {
                  ratio: '剪切刚度比 S2/S1 1',
                  kappa2: '扫描剪切修正 1',
                  kappa1: '基准剪切修正 1',
                },
                sample: { kappa2: 1, kappa1: 5 / 6 },
                expected: 1 / (5 / 6),
                plainZh: 'κ 扫描下横向剪切刚度比等于剪切修正因子之比',
                plainEn:
                  'Under a κ sweep, transverse shear stiffness ratio equals the shear-correction ratio',
              },
            },
            {
              id: 'mindlin-compose-thick-aspect',
              layer: 'foundation',
              titleZh: '合成 KPI：厚板边界长细比 a/t = 10',
              titleEn: 'Compose KPI: thick-boundary aspect a/t = 10',
              bodyZh:
                '厚板边界教学：a=1、t=0.1 → AR=10，剪切不可忽略；对比 mindlin-compose-aspect 薄板 AR=100。桥接 peak×aspect residual。',
              bodyEn:
                'Thick-boundary teaching AR=10 at a=1,t=0.1 vs thin AR=100; bridges peak×aspect residual.',
              formula: {
                expr: 'AR = a / t',
                vars: {
                  AR: '长细比 a/t 1',
                  a: '板边长 m',
                  t: '板厚 m',
                },
                sample: { a: 1, t: 0.1 },
                expected: 10,
                plainZh: '厚板边界长细比 a/t=10 时 Mindlin 剪切相对 Kirchhoff 不可忽略',
                plainEn:
                  'At thick-boundary aspect a/t=10 Mindlin shear is non-negligible versus Kirchhoff',
              },
            },
            {
              id: 'mindlin-compose-peak-consistency',
              layer: 'foundation',
              titleZh: '合成 KPI：|w|/能量峰一致性残差',
              titleEn: 'Compose KPI: |w|/energy peak consistency residual',
              bodyZh:
                '位移峰定义 Q_|w| 与能量峰定义 Q_E 在小阻尼线性系统应一致。算例两者均取 1/(2ζ)=10 时相对残差为 0；桥接 S26bi/S26bq/S26bu peak consistency residual 教学（smoke residual ≠ eng DoD）。',
              bodyEn:
                'Displacement-peak Q_|w| and energy-peak Q_E must match in lightly damped linear systems; sample both 10 → residual 0; bridges S26bi/S26bq/S26bu peak-consistency residual (smoke≠eng DoD).',
              formula: {
                expr: 'res = abs(Q_w - Q_E) / abs(Q_w)',
                vars: {
                  res: '峰一致性相对残差 1',
                  Q_w: '位移峰放大因子 1',
                  Q_E: '能量峰放大因子 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh:
                  '位移峰与能量峰放大因子一致时相对残差应为零，对应 peak consistency residual 教学',
                plainEn:
                  'Relative residual between displacement-peak and energy-peak Q should be zero when consistent',
              },
            },
            {
              id: 'mindlin-compose-omega-from-mu',
              layer: 'foundation',
              titleZh: '合成：ω = π² √(D/μ) · k 面密度形',
              titleEn: 'Compose: ω = π² √(D/μ) · k with areal mass',
              bodyZh:
                '把 μ=ρt 与 D、k 合成 Kirchhoff 简支板 ω（面密度形，与 mindlin-compose-omega 等价）。算例钢 μ=78.5、t=0.01、k=2。',
              bodyEn:
                'Composes areal mass μ with D,k into SS Kirchhoff ω; equivalent to rho·t form; sample steel μ=78.5,k=2.',
              formula: {
                expr: 'omega = pi^2 * sqrt(D / mu) * k',
                vars: {
                  omega: '固有角频率 rad/s',
                  pi: '圆周率',
                  D: '弯曲刚度 N·m',
                  mu: '面密度 kg/m²',
                  k: '波数组合 1/m²',
                },
                sample: {
                  pi: Math.PI,
                  D: (2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3)),
                  mu: 7850 * 0.01,
                  k: 2,
                },
                expected:
                  Math.PI *
                  Math.PI *
                  Math.sqrt(
                    ((2.1e11 * Math.pow(0.01, 3)) / (12 * (1 - 0.3 * 0.3))) /
                      (7850 * 0.01),
                  ) *
                  2,
                plainZh:
                  '简支板固有角频率由弯曲刚度、面密度与模态波数合成（面密度形）',
                plainEn:
                  'Simply-supported plate natural frequency composes flexural rigidity, areal mass, and modal wave-number (areal-mass form)',
              },
            },
            // S26bu energy↔peak dual residual packaging (wave26 residual compose expand)
            {
              id: 'mindlin-compose-peak-factor',
              layer: 'foundation',
              titleZh: '合成：p = |amp| · 2 ζ 峰因子（相对 SDOF）',
              titleEn: 'Compose: p = |amp| · 2 ζ peak factor vs SDOF',
              bodyZh:
                'S26ba/S26bu 峰因子：把位移峰放大 |amp| 与阻尼 ζ 合成 p=|amp|·2ζ；基频主导时 p≈1。算例 |amp|=10、ζ=0.05 → p=1；与 mindlin-compose-zeta-peak 对偶。桥接 S26bu dual-path peak-factor envelope。',
              bodyEn:
                'Peak factor p=|amp|·2ζ vs SDOF; fund-dom → p≈1; sample |amp|=10, ζ=0.05 → 1; dual of zeta-peak; bridges S26bu dual-path peak-factor envelope.',
              formula: {
                expr: 'p = amp * 2 * zeta',
                vars: {
                  p: '峰因子相对 SDOF 1',
                  amp: '共振峰位移放大 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { amp: 10, zeta: 0.05 },
                expected: 1,
                plainZh: '峰因子等于共振峰放大与两倍阻尼比之积，基频主导时约等于 1',
                plainEn:
                  'Peak factor is resonance amplification times twice the damping ratio; near 1 under fund domination',
              },
            },
            {
              id: 'mindlin-compose-energy-peak-factor',
              layer: 'foundation',
              titleZh: '合成：p_E = |amp_E| · 2 ζ 能量峰因子',
              titleEn: 'Compose: p_E = |amp_E| · 2 ζ energy peak factor',
              bodyZh:
                '能量支路峰因子：模态 |H| 能量放大 |amp_E| 与 2ζ 合成 p_E。算例 |amp_E|=10、ζ=0.05 → p_E=1；与 p_w 匹配时 S26bu |w|↔energy consistency 残差→0。',
              bodyEn:
                'Energy-path peak factor p_E=|amp_E|·2ζ; sample 10×0.1=1; matched with p_w yields S26bu |w|↔energy consistency residual 0.',
              formula: {
                expr: 'p_E = amp_E * 2 * zeta',
                vars: {
                  p_E: '能量峰因子 1',
                  amp_E: '能量支路峰放大 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { amp_E: 10, zeta: 0.05 },
                expected: 1,
                plainZh: '能量峰因子等于能量支路峰放大与两倍阻尼比之积',
                plainEn:
                  'Energy peak factor is energy-path peak amplification times twice the damping ratio',
              },
            },
            {
              id: 'mindlin-compose-peak-factor-consistency',
              layer: 'foundation',
              titleZh: '合成 KPI：|p_w − p_E| 峰因子一致性残差',
              titleEn: 'Compose KPI: |p_w − p_E| peak-factor consistency residual',
              bodyZh:
                'S26bi/S26bu：位移峰因子与能量峰因子绝对差。算例 p_w=p_E=1 → 残差 0；容差约 0.12（PEAK_FREQUENCY_ENERGY_CONSISTENCY_TOL）。桥接 dual-path consistency envelope。',
              bodyEn:
                'S26bi/S26bu |p_w−p_E|; sample matched 1 → 0; tol ~0.12; bridges dual-path consistency envelope.',
              formula: {
                expr: 'res = abs(p_w - p_E)',
                vars: {
                  res: '峰因子一致性绝对残差 1',
                  p_w: '位移峰因子 1',
                  p_E: '能量峰因子 1',
                },
                sample: { p_w: 1, p_E: 1 },
                expected: 0,
                plainZh: '位移与能量峰因子之差的绝对值衡量 |w|↔energy 峰一致性',
                plainEn:
                  'Absolute difference of displacement and energy peak factors measures |w|↔energy peak consistency',
              },
            },
            {
              id: 'mindlin-compose-Q-energy',
              layer: 'foundation',
              titleZh: '合成：Q_E = 1/(2 ζ) 能量半功率 Q',
              titleEn: 'Compose: Q_E = 1/(2 ζ) energy half-power Q',
              bodyZh:
                '能量半功率带宽定义 Q_E=ω_1/Δω_E≈1/(2ζ)。算例 ζ=0.05 → Q_E=10；与 mindlin-compose-zeta-peak 位移 Q 同构。桥接 S26be/S26bu energy half-power。',
              bodyEn:
                'Energy half-power Q_E≈1/(2ζ); sample ζ=0.05 → 10; isomorphic to displacement Q; bridges S26be/S26bu.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: '能量半功率品质因子由阻尼比合成，约等于 1/(2ζ)',
                plainEn:
                  'Energy half-power quality factor composes from damping ratio as about 1/(2ζ)',
              },
            },
            {
              id: 'mindlin-compose-peak-omega-sdof',
              layer: 'foundation',
              titleZh: '合成：ω_p = ω_n √(1 − 2 ζ²) SDOF 位移峰频',
              titleEn: 'Compose: ω_p = ω_n √(1 − 2 ζ²) SDOF displacement peak freq',
              bodyZh:
                'S26bi SDOF 位移 FRF 峰频恒等：ω_p/ω_n=√(1−2ζ²)（ζ<1/√2）。算例 ω_n=100、ζ=0.05 → ω_p=100√0.995。桥接 S26bu peak-frequency identity。',
              bodyEn:
                'SDOF displacement peak ω_p=ω_n√(1−2ζ²); sample ω_n=100, ζ=0.05 → 100√0.995; bridges S26bu peak-frequency identity.',
              formula: {
                expr: 'omega_p = omega_n * sqrt(1 - 2 * zeta * zeta)',
                vars: {
                  omega_p: '位移峰角频率 rad/s',
                  omega_n: '固有角频率 rad/s',
                  zeta: '模态阻尼比 1',
                },
                sample: { omega_n: 100, zeta: 0.05 },
                expected: 100 * Math.sqrt(1 - 2 * 0.05 * 0.05),
                plainZh: 'SDOF 位移响应峰角频率由固有频率与阻尼比经 √(1−2ζ²) 合成',
                plainEn:
                  'SDOF displacement-response peak angular frequency composes from natural frequency and damping via √(1−2ζ²)',
              },
            },
            {
              id: 'mindlin-compose-peak-omega-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|ω_p − ω_n√(1−2ζ²)| / ω_n 峰频残差',
              titleEn: 'Compose KPI: |ω_p − ω_n√(1−2ζ²)| / ω_n peak-freq residual',
              bodyZh:
                '峰频恒等相对残差。算例 ω_p 与 SDOF 金标重合 → 0。多模 Navier 基频主导时残差极小；桥接 S26bu peak identity honesty。',
              bodyEn:
                'Relative peak-frequency identity residual; sample matched → 0; fund-dom multi-mode Navier residual tiny; bridges S26bu.',
              formula: {
                expr: 'res = abs(omega_p - omega_sdof) / omega_n',
                vars: {
                  res: '峰频相对残差 1',
                  omega_p: '实测/级数峰角频率 rad/s',
                  omega_sdof: 'SDOF 金标峰角频率 rad/s',
                  omega_n: '固有角频率 rad/s',
                },
                sample: {
                  omega_p: 100 * Math.sqrt(1 - 2 * 0.05 * 0.05),
                  omega_sdof: 100 * Math.sqrt(1 - 2 * 0.05 * 0.05),
                  omega_n: 100,
                },
                expected: 0,
                plainZh: '峰频相对固有频率与 SDOF 金标之差的相对残差衡量峰频恒等诚实',
                plainEn:
                  'Relative residual of peak frequency vs SDOF gold measures peak-frequency identity honesty',
              },
            },
            {
              id: 'mindlin-compose-dual-path-abs-diff-w',
              layer: 'foundation',
              titleZh: '合成：d_w = dualPathMaxPeakFactorAbsDiff_|w|',
              titleEn: 'Compose: d_w = dualPathMaxPeakFactorAbsDiff_|w|',
              bodyZh:
                'S26bt |w| 双路径 expand：noRotary∪withRotary 上 |p_w−p_E| 最大绝对差。教学金标诚实包 d_w→0。算例匹配包 d_w=0；桥接 S26bu wExpand。',
              bodyEn:
                'S26bt |w| dual-path expand max |p_w−p_E| over noRotary∪withRotary; honest pack d_w→0; sample 0; bridges S26bu wExpand.',
              formula: {
                expr: 'd_w = dualPathMaxPeakFactorAbsDiff_w',
                vars: {
                  d_w: '|w| 双路径峰因子最大绝对差 1',
                  dualPathMaxPeakFactorAbsDiff_w: '|w| expand 双路径 max |p_w−p_E| 1',
                },
                sample: { dualPathMaxPeakFactorAbsDiff_w: 0 },
                expected: 0,
                plainZh: '|w| 双路径峰因子最大绝对差直接取 dual-path expand KPI',
                plainEn:
                  '|w| dual-path max peak-factor absolute difference is the dual-path expand KPI',
              },
            },
            {
              id: 'mindlin-compose-dual-path-abs-diff-E',
              layer: 'foundation',
              titleZh: '合成：d_E = dualPathMaxPeakFactorAbsDiff_E',
              titleEn: 'Compose: d_E = dualPathMaxPeakFactorAbsDiff_E',
              bodyZh:
                'S26bt 能量双路径 expand 对偶：energy 路径上 max |p_w−p_E|。算例匹配包 d_E=0；与 d_w 配对进入 joint packaging。桥接 S26bu energyExpand。',
              bodyEn:
                'S26bt energy dual-path expand max |p_w−p_E|; sample 0; pairs with d_w into joint packaging; bridges S26bu energyExpand.',
              formula: {
                expr: 'd_E = dualPathMaxPeakFactorAbsDiff_E',
                vars: {
                  d_E: '能量双路径峰因子最大绝对差 1',
                  dualPathMaxPeakFactorAbsDiff_E: 'energy expand 双路径 max |p_w−p_E| 1',
                },
                sample: { dualPathMaxPeakFactorAbsDiff_E: 0 },
                expected: 0,
                plainZh: '能量双路径峰因子最大绝对差直接取 energy dual-path expand KPI',
                plainEn:
                  'Energy dual-path max peak-factor absolute difference is the energy dual-path expand KPI',
              },
            },
            {
              id: 'mindlin-compose-joint-max-abs-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max = max(d_w, d_E) S26bu 联合上界',
              titleEn: 'Compose KPI: joint_max = max(d_w, d_E) S26bu joint upper bound',
              bodyZh:
                'S26bu 联合包装：取 |w| 与 energy 两 expand 的 dualPathMaxPeakFactorAbsDiff 上确界。算例 d_w=0.01、d_E=0.02 → joint_max=0.02；匹配诚实包→0。',
              bodyEn:
                'S26bu joint packaging upper bound max(d_w,d_E); sample 0.01,0.02 → 0.02; matched honest pack → 0.',
              formula: {
                expr: 'joint_max = max(d_w, d_E)',
                vars: {
                  joint_max: '联合双路径最大峰因子绝对差 1',
                  d_w: '|w| 双路径 max |p_w−p_E| 1',
                  d_E: '能量双路径 max |p_w−p_E| 1',
                },
                sample: { d_w: 0.01, d_E: 0.02 },
                expected: 0.02,
                plainZh: '联合双路径最大绝对差取 |w| 与能量两 expand 残差之上确界',
                plainEn:
                  'Joint dual-path max absolute difference is the upper envelope of |w| and energy expand residuals',
              },
            },
            {
              id: 'mindlin-compose-joint-mean-abs-diff',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_mean = (d_w + d_E) / 2 S26bu 联合均值',
              titleEn: 'Compose KPI: joint_mean = (d_w + d_E) / 2 S26bu joint mean',
              bodyZh:
                'S26bu 联合均值：两 expand dualPathMaxPeakFactorAbsDiff 的算术平均。算例 0.01 与 0.02 → 0.015；≤ joint_max 恒成立。',
              bodyEn:
                'S26bu joint mean of the two expand dual-path abs-diffs; sample (0.01+0.02)/2=0.015; always ≤ joint_max.',
              formula: {
                expr: 'joint_mean = (d_w + d_E) / 2',
                vars: {
                  joint_mean: '联合双路径平均峰因子绝对差 1',
                  d_w: '|w| 双路径 max |p_w−p_E| 1',
                  d_E: '能量双路径 max |p_w−p_E| 1',
                },
                sample: { d_w: 0.01, d_E: 0.02 },
                expected: 0.015,
                plainZh: '联合双路径平均绝对差等于两 expand 残差之和的一半',
                plainEn:
                  'Joint dual-path mean absolute difference is half the sum of the two expand residuals',
              },
            },
            {
              id: 'mindlin-compose-expand-path-parity',
              layer: 'foundation',
              titleZh: '合成 KPI：parity = |d_w − d_E| expand 路径对偶',
              titleEn: 'Compose KPI: parity = |d_w − d_E| expand-path parity',
              bodyZh:
                'S26bu expand-path abs-diff parity：|w| 与 energy 两 expand 应测同一 |p_w−p_E| 包络。算例 d_w=0.01、d_E=0.02 → parity=0.01；匹配诚实 → 0。容差 ~0.12。',
              bodyEn:
                'S26bu expand-path parity |d_w−d_E|; both expands should measure the same |p_w−p_E| envelope; sample 0.01; matched → 0; tol ~0.12.',
              formula: {
                expr: 'parity = abs(d_w - d_E)',
                vars: {
                  parity: 'expand 路径双路径绝对差对偶 1',
                  d_w: '|w| 双路径 max |p_w−p_E| 1',
                  d_E: '能量双路径 max |p_w−p_E| 1',
                },
                sample: { d_w: 0.01, d_E: 0.02 },
                expected: 0.01,
                plainZh: '两 expand 双路径最大绝对差之差的绝对值衡量 expand 路径对偶诚实',
                plainEn:
                  'Absolute difference of the two expand dual-path max residuals measures expand-path parity honesty',
              },
            },
            {
              id: 'mindlin-compose-expand-path-parity-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：parity / tol expand 路径对偶相对残差',
              titleEn: 'Compose KPI: parity / tol expand-path parity residual',
              bodyZh:
                '相对 S26bu 峰频–能量一致性容差（tol≈0.12）的 expand 路径对偶残差。算例 parity=0、tol=0.12 → 0；诚实门：parity≤tol。',
              bodyEn:
                'Expand-path parity residual vs S26bu peak–energy consistency tol (~0.12); sample parity=0 → 0; honesty gate parity≤tol.',
              formula: {
                expr: 'res = parity / tol',
                vars: {
                  res: 'expand 路径对偶相对残差 1',
                  parity: '|d_w − d_E| 1',
                  tol: '峰因子能量一致性容差 1',
                },
                sample: { parity: 0, tol: 0.12 },
                expected: 0,
                plainZh: 'expand 路径对偶相对残差等于 |d_w−d_E| 除以峰因子能量一致性容差',
                plainEn:
                  'Expand-path parity residual is |d_w−d_E| divided by the peak-factor energy consistency tolerance',
              },
            },
            {
              id: 'mindlin-compose-rotary-omega-drop',
              layer: 'foundation',
              titleZh: '合成：Δω = ω_no − ω_rot 转动惯量降频',
              titleEn: 'Compose: Δω = ω_no − ω_rot rotary inertia frequency drop',
              bodyZh:
                'S26bu joint rotary：每个 aspect×thickness 单元 withRotary 基频低于 noRotary。算例 ω_no=100、ω_rot=98 → Δω=2>0。桥接 jointRotaryLowersOmegaAtEveryCell。',
              bodyEn:
                'S26bu joint rotary: withRotary ω_1 < noRotary at every cell; sample 100−98=2; bridges jointRotaryLowersOmegaAtEveryCell.',
              formula: {
                expr: 'delta_omega = omega_no - omega_rot',
                vars: {
                  delta_omega: '转动惯量引起的基频降 rad/s',
                  omega_no: '无转动惯量基频 rad/s',
                  omega_rot: '含转动惯量基频 rad/s',
                },
                sample: { omega_no: 100, omega_rot: 98 },
                expected: 2,
                plainZh: '转动惯量降频等于无转动基频减去含转动基频，诚实时为正',
                plainEn:
                  'Rotary frequency drop is no-rotary fundamental minus with-rotary; honesty requires positive drop',
              },
            },
            {
              id: 'mindlin-compose-rotary-omega-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：max(0, ω_rot/ω_no − 1) 转动降频残差',
              titleEn: 'Compose KPI: max(0, ω_rot/ω_no − 1) rotary drop residual',
              bodyZh:
                '若 ω_rot≥ω_no 则残差≥0 指示 rotary 未降频（不诚实）；诚实包 ω_rot<ω_no → 残差 0。算例 98/100−1 <0 → 裁剪为 0。',
              bodyEn:
                'Residual max(0, ω_rot/ω_no−1); honest pack ω_rot<ω_no → 0; sample 98/100 → clipped 0.',
              formula: {
                expr: 'res = max(0, omega_rot / omega_no - 1)',
                vars: {
                  res: '转动降频诚实残差 1',
                  omega_rot: '含转动惯量基频 rad/s',
                  omega_no: '无转动惯量基频 rad/s',
                },
                sample: { omega_rot: 98, omega_no: 100 },
                expected: 0,
                plainZh: '转动降频诚实残差在 ω_rot 不低于 ω_no 时为正，诚实包应为零',
                plainEn:
                  'Rotary drop honesty residual is positive when rotary does not lower ω; honest pack is zero',
              },
            },
            {
              id: 'mindlin-compose-packaging-honest-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：packagingHonest 联合门（0/1）',
              titleEn: 'Compose KPI: packagingHonest joint gate (0/1)',
              bodyZh:
                'S26bu packagingHonest = joint dual-path consistency ∧ peak-factor ∧ both-paths ∧ expand parity ∧ rotary ∧ peak identity。教学金标诚实 → 1；任一子门失败 → 0。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26bu packagingHonest is conjunction of joint dual-path consistency, peak-factor, both-paths, expand parity, rotary, peak identity; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_dp * c_pf * c_both * c_par * c_rot * c_id',
                vars: {
                  gate: '联合包装诚实门 0/1',
                  c_dp: 'joint dual-path consistency 诚实 0/1',
                  c_pf: 'joint peak-factor near-1 诚实 0/1',
                  c_both: 'both-paths consistency 诚实 0/1',
                  c_par: 'expand-path parity 诚实 0/1',
                  c_rot: 'rotary lowers ω 诚实 0/1',
                  c_id: 'with-rotary peak identity 诚实 0/1',
                },
                sample: {
                  c_dp: 1,
                  c_pf: 1,
                  c_both: 1,
                  c_par: 1,
                  c_rot: 1,
                  c_id: 1,
                },
                expected: 1,
                plainZh: 'S26bu 联合包装诚实门为六个子诚实标志之积，全真时为 1',
                plainEn:
                  'S26bu packaging honesty gate is the product of six sub-honesty flags; all-true yields 1',
              },
            },
            // S26bw half-power / energy Q × κ residual packaging (wave28 residual compose expand)
            {
              id: 'mindlin-compose-Qw-at-kappa',
              layer: 'foundation',
              titleZh: '合成：Q_w(κ) = 1/(2 ζ) 半功率 Q × κ',
              titleEn: 'Compose: Q_w(κ) = 1/(2 ζ) half-power Q × κ',
              bodyZh:
                'S26bw |w| 半功率 Q×κ：小阻尼 Q_w≈1/(2ζ) 在每个 κ 上 eng 诚实。算例 ζ=0.05 → Q_w=10（与 κ 解耦教学入口）；完整 κ 表归 solvers-structural。',
              bodyEn:
                'S26bw |w| half-power Q×κ: Q_w≈1/(2ζ) eng-honest at every κ; sample ζ=0.05 → 10; full κ table in solvers-structural.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '位移半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                  kappa: '剪切修正因子 κ（表参数）',
                },
                sample: { zeta: 0.05, kappa: 5 / 6 },
                expected: 10,
                plainZh: '位移半功率品质因子在小阻尼下由阻尼比合成，κ 表上应保持 eng 诚实',
                plainEn:
                  'Displacement half-power Q composes from damping under light damping and stays eng-honest across the κ table',
              },
            },
            {
              id: 'mindlin-compose-QE-at-kappa',
              layer: 'foundation',
              titleZh: '合成：Q_E(κ) = 1/(2 ζ) 能量半功率 Q × κ',
              titleEn: 'Compose: Q_E(κ) = 1/(2 ζ) energy half-power Q × κ',
              bodyZh:
                'S26bw 能量半功率 Q×κ 对偶：Q_E≈1/(2ζ) 在每个 κ 上与 Q_w 同构。算例 ζ=0.05 → Q_E=10；桥接 |w|↔energy Q consistency × κ。',
              bodyEn:
                'S26bw energy half-power Q×κ dual of Q_w; sample ζ=0.05 → 10; bridges |w|↔energy Q consistency × κ.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                  kappa: '剪切修正因子 κ（表参数）',
                },
                sample: { zeta: 0.05, kappa: 5 / 6 },
                expected: 10,
                plainZh: '能量半功率品质因子在 κ 表上由阻尼比合成，应与位移 Q 同构',
                plainEn:
                  'Energy half-power Q composes from damping on the κ table and should match displacement Q',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| Q 一致性 × κ 残差',
              titleEn: 'Compose KPI: |Q_w − Q_E| Q consistency × κ residual',
              bodyZh:
                'S26bw 三元组闭合：每个 κ 上 |Q_w−Q_E|→0。算例 Q_w=Q_E=10 → 残差 0；完成 |w| + energy + consistency × κ。',
              bodyEn:
                'S26bw trio closure: |Q_w−Q_E|→0 at every κ; sample matched 10 → 0; completes |w|+energy+consistency × κ.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'Q 一致性绝对残差 1',
                  Q_w: '位移半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '位移与能量半功率品质因子之差在 κ 表上衡量 Q 一致性诚实',
                plainEn:
                  'Absolute difference of displacement and energy half-power Q on the κ table measures Q-consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-S-kappa',
              layer: 'foundation',
              titleZh: '合成：S(κ) = κ G t 横向剪切刚度 × κ',
              titleEn: 'Compose: S(κ) = κ G t transverse shear stiffness × κ',
              bodyZh:
                'S26bw κ 扫描上游：S=κ G t。算例 κ=5/6、G=E/(2(1+ν))、E=2.1e11、ν=0.3、t=0.2 → S=κ G t。',
              bodyEn:
                'Upstream of S26bw κ sweep: S=κGt; sample thick t=0.2 steel with κ=5/6.',
              formula: {
                expr: 'S = kappa * G * t',
                vars: {
                  S: '横向剪切刚度 N/m',
                  kappa: '剪切修正因子 κ',
                  G: '剪切模量 Pa',
                  t: '板厚 m',
                },
                sample: {
                  kappa: 5 / 6,
                  G: 2.1e11 / (2 * (1 + 0.3)),
                  t: 0.2,
                },
                expected: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.2,
                plainZh: '横向剪切刚度由剪切修正因子、剪切模量与厚度合成',
                plainEn:
                  'Transverse shear stiffness composes shear correction, shear modulus, and thickness',
              },
            },
            {
              id: 'mindlin-compose-omega-kappa-monotone',
              layer: 'foundation',
              titleZh: '合成 KPI：Δω_κ = ω(κ_hi) − ω(κ_lo) κ 单调升频',
              titleEn: 'Compose KPI: Δω_κ = ω(κ_hi) − ω(κ_lo) κ monotone rise',
              bodyZh:
                'S26bw：κ↑ ⇒ S↑ ⇒ ω_11 严格上升。算例 ω_hi=100、ω_lo=98 → Δω=2>0；诚实门要求 Δω>0。',
              bodyEn:
                'S26bw: κ↑ ⇒ S↑ ⇒ ω_11 strictly rises; sample 100−98=2; honesty requires Δω>0.',
              formula: {
                expr: 'delta_omega_kappa = omega_hi - omega_lo',
                vars: {
                  delta_omega_kappa: 'κ 升引起的基频升 rad/s',
                  omega_hi: '高 κ 基频 rad/s',
                  omega_lo: '低 κ 基频 rad/s',
                },
                sample: { omega_hi: 100, omega_lo: 98 },
                expected: 2,
                plainZh: '剪切修正因子升高时基频升量等于高 κ 与低 κ 基频之差，诚实时为正',
                plainEn:
                  'Frequency rise with shear correction is high-κ fundamental minus low-κ; honesty requires positive rise',
              },
            },
            {
              id: 'mindlin-compose-omega-kappa-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：max(0, ω_lo/ω_hi − 1) κ 单调残差',
              titleEn: 'Compose KPI: max(0, ω_lo/ω_hi − 1) κ monotone residual',
              bodyZh:
                '若 ω_lo≥ω_hi（κ 升未升频）则残差≥0 不诚实；诚实包 ω_hi>ω_lo → 残差 0。算例 98/100−1 <0 → 裁剪为 0。',
              bodyEn:
                'Residual max(0, ω_lo/ω_hi−1); honest pack ω_hi>ω_lo → 0; sample 98/100 → clipped 0.',
              formula: {
                expr: 'res = max(0, omega_lo / omega_hi - 1)',
                vars: {
                  res: 'κ 单调升频诚实残差 1',
                  omega_lo: '低 κ 基频 rad/s',
                  omega_hi: '高 κ 基频 rad/s',
                },
                sample: { omega_lo: 98, omega_hi: 100 },
                expected: 0,
                plainZh: 'κ 单调升频诚实残差在低 κ 基频不低于高 κ 时为正，诚实包应为零',
                plainEn:
                  'κ monotone residual is positive when low-κ ω is not below high-κ; honest pack is zero',
              },
            },
            {
              id: 'mindlin-compose-Q-kappa-dual-span',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_span = Q_max − Q_min κ 表双端跨度',
              titleEn: 'Compose KPI: Q_span = Q_max − Q_min κ-table dual span',
              bodyZh:
                'S26bw dual min/max Q 跨 κ 表：基频主导时 Q≈1/(2ζ) 跨度→0。算例 Q_max=Q_min=10 → span=0；桥接 dualQFactorNearOne。',
              bodyEn:
                'S26bw dual min/max Q across κ table; fund-dom span→0; sample 10−10=0; bridges dualQFactorNearOne.',
              formula: {
                expr: 'Q_span = Q_max - Q_min',
                vars: {
                  Q_span: 'κ 表 Q 双端跨度 1',
                  Q_max: 'κ 表最大半功率 Q 1',
                  Q_min: 'κ 表最小半功率 Q 1',
                },
                sample: { Q_max: 10, Q_min: 10 },
                expected: 0,
                plainZh: 'κ 表半功率 Q 双端跨度在基频主导诚实包上应趋于零',
                plainEn:
                  'Half-power Q dual span across the κ table vanishes under fund-dominated honest packaging',
              },
            },
            {
              id: 'mindlin-compose-f-shear-kappa',
              layer: 'foundation',
              titleZh: '合成：f(κ) = 1 + D π² k / (κ G t) 剪切放大 × κ',
              titleEn: 'Compose: f(κ) = 1 + D π² k / (κ G t) shear factor × κ',
              bodyZh:
                '把 κ 直接写入剪切放大：f=1+Dπ²k/S、S=κGt。κ↑ ⇒ f↓ ⇒ 更接近 Kirchhoff。算例示意 f−1 与 1/κ 成正比。',
              bodyEn:
                'Shear factor writes κ via S=κGt; κ↑ ⇒ f↓ toward Kirchhoff; sample f−1 ∝ 1/κ.',
              formula: {
                expr: 'f = 1 + D * pi * pi * k / (kappa * G * t)',
                vars: {
                  f: '剪切放大因子 1',
                  D: '弯曲刚度 N·m',
                  pi: '圆周率',
                  k: '波数组合 1/m²',
                  kappa: '剪切修正因子 κ',
                  G: '剪切模量 Pa',
                  t: '板厚 m',
                },
                sample: {
                  D: (2.1e11 * Math.pow(0.2, 3)) / (12 * (1 - 0.3 * 0.3)),
                  pi: Math.PI,
                  k: 2,
                  kappa: 5 / 6,
                  G: 2.1e11 / (2 * (1 + 0.3)),
                  t: 0.2,
                },
                expected:
                  1 +
                  ((2.1e11 * Math.pow(0.2, 3)) / (12 * (1 - 0.3 * 0.3)) *
                    Math.PI *
                    Math.PI *
                    2) /
                    ((5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.2),
                plainZh: '剪切放大因子由弯曲刚度、波数与 κ 依赖的横向剪切刚度合成',
                plainEn:
                  'Shear amplification composes flexural rigidity, wave-number, and κ-dependent transverse shear stiffness',
              },
            },
            {
              id: 'mindlin-compose-Q-kappa-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QκHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QκHonest joint gate (0/1)',
              bodyZh:
                'S26bw packaging：Q_w eng 诚实 ∧ Q_E eng 诚实 ∧ |Q_w−Q_E|→0 ∧ ω↑κ 单调 ∧ Q_span≈0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26bw packaging: Q_w eng ∧ Q_E eng ∧ consistency ∧ ω↑κ monotone ∧ Q_span≈0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw * c_QE * c_cons * c_mono * c_span',
                vars: {
                  gate: 'Q×κ 包装诚实门 0/1',
                  c_Qw: 'Q_w eng 诚实 0/1',
                  c_QE: 'Q_E eng 诚实 0/1',
                  c_cons: 'Q 一致性 诚实 0/1',
                  c_mono: 'ω↑κ 单调 诚实 0/1',
                  c_span: 'Q 双端跨度 诚实 0/1',
                },
                sample: {
                  c_Qw: 1,
                  c_QE: 1,
                  c_cons: 1,
                  c_mono: 1,
                  c_span: 1,
                },
                expected: 1,
                plainZh: 'Q×κ 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×κ packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S26bx half-power / energy Q × thickness residual packaging (wave29 residual compose expand)
            {
              id: 'mindlin-compose-Qw-at-thickness',
              layer: 'foundation',
              titleZh: '合成：Q_w(t) = 1/(2 ζ) 半功率 Q × 厚度',
              titleEn: 'Compose: Q_w(t) = 1/(2 ζ) half-power Q × thickness',
              bodyZh:
                'S26bx |w| 半功率 Q×厚度：小阻尼 Q_w≈1/(2ζ) 在厚度表上 eng 诚实。算例 ζ=0.05 → Q_w=10（与 t 解耦教学入口）；完整 t 表归 solvers-structural。',
              bodyEn:
                'S26bx |w| half-power Q×thickness: Q_w≈1/(2ζ) eng-honest on t-table; sample ζ=0.05 → 10; full t table in solvers-structural.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '位移半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                  t: '板厚 m（表参数）',
                },
                sample: { zeta: 0.05, t: 0.2 },
                expected: 10,
                plainZh: '位移半功率品质因子在小阻尼下由阻尼比合成，厚度表上应保持 eng 诚实',
                plainEn:
                  'Displacement half-power Q composes from damping under light damping and stays eng-honest across the thickness table',
              },
            },
            {
              id: 'mindlin-compose-QE-at-thickness',
              layer: 'foundation',
              titleZh: '合成：Q_E(t) = 1/(2 ζ) 能量半功率 Q × 厚度',
              titleEn: 'Compose: Q_E(t) = 1/(2 ζ) energy half-power Q × thickness',
              bodyZh:
                'S26bx 能量半功率 Q×厚度对偶：Q_E≈1/(2ζ) 在每个 t 上与 Q_w 同构。算例 ζ=0.05 → Q_E=10；桥接 |w|↔energy Q consistency × t。',
              bodyEn:
                'S26bx energy half-power Q×thickness dual of Q_w; sample ζ=0.05 → 10; bridges |w|↔energy Q consistency × t.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                  t: '板厚 m（表参数）',
                },
                sample: { zeta: 0.05, t: 0.2 },
                expected: 10,
                plainZh: '能量半功率品质因子在厚度表上由阻尼比合成，应与位移 Q 同构',
                plainEn:
                  'Energy half-power Q composes from damping on the thickness table and should match displacement Q',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| Q 一致性 × 厚度残差',
              titleEn: 'Compose KPI: |Q_w − Q_E| Q consistency × thickness residual',
              bodyZh:
                'S26bx 三元组闭合：每个 t 上 |Q_w−Q_E|→0。算例 Q_w=Q_E=10 → 残差 0；完成 |w| + energy + consistency × t。',
              bodyEn:
                'S26bx trio closure: |Q_w−Q_E|→0 at every t; sample matched 10 → 0; completes |w|+energy+consistency × t.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'Q 一致性绝对残差 1',
                  Q_w: '位移半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '位移与能量半功率品质因子之差在厚度表上衡量 Q 一致性诚实',
                plainEn:
                  'Absolute difference of displacement and energy half-power Q on the thickness table measures Q-consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-S-thickness',
              layer: 'foundation',
              titleZh: '合成：S(t) = κ G t 横向剪切刚度 × 厚度',
              titleEn: 'Compose: S(t) = κ G t transverse shear stiffness × thickness',
              bodyZh:
                'S26bx 厚度扫描上游：S=κ G t 线性于 t。算例 κ=5/6、G=E/(2(1+ν))、E=2.1e11、ν=0.3、t=0.1 → S=κ G t。',
              bodyEn:
                'Upstream of S26bx t sweep: S=κGt linear in t; sample thin-ish t=0.1 steel with κ=5/6.',
              formula: {
                expr: 'S = kappa * G * t',
                vars: {
                  S: '横向剪切刚度 N/m',
                  kappa: '剪切修正因子 κ',
                  G: '剪切模量 Pa',
                  t: '板厚 m',
                },
                sample: {
                  kappa: 5 / 6,
                  G: 2.1e11 / (2 * (1 + 0.3)),
                  t: 0.1,
                },
                expected: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.1,
                plainZh: '横向剪切刚度由剪切修正因子、剪切模量与厚度合成（厚度表扫描）',
                plainEn:
                  'Transverse shear stiffness composes shear correction, shear modulus, and thickness on the t table',
              },
            },
            {
              id: 'mindlin-compose-D-thickness',
              layer: 'foundation',
              titleZh: '合成：D(t) = E t³ / (12(1−ν²)) 弯曲刚度 × 厚度',
              titleEn: 'Compose: D(t) = E t³ / (12(1−ν²)) flexural rigidity × thickness',
              bodyZh:
                'S26bx 厚度³ 律：弯曲刚度 D∝t³。算例 E=2.1e11、ν=0.3、t=0.1 → D=E t³/(12(1−ν²))；与 S∝t 组成薄/厚剪切相对强度。',
              bodyEn:
                'S26bx thickness cube law D∝t³; sample E=2.1e11, ν=0.3, t=0.1; pairs with S∝t for thin/thick shear relative strength.',
              formula: {
                expr: 'D = E * t * t * t / (12 * (1 - nu * nu))',
                vars: {
                  D: '弯曲刚度 N·m',
                  E: '杨氏模量 Pa',
                  t: '板厚 m',
                  nu: '泊松比 1',
                },
                sample: { E: 2.1e11, t: 0.1, nu: 0.3 },
                expected: (2.1e11 * Math.pow(0.1, 3)) / (12 * (1 - 0.3 * 0.3)),
                plainZh: '弯曲刚度由杨氏模量与厚度三次方合成，分母为泊松修正',
                plainEn:
                  'Flexural rigidity composes Young modulus and thickness cubed over the Poisson factor',
              },
            },
            {
              id: 'mindlin-compose-omega-thickness-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：ω_thin/ω_thick 厚度升频比',
              titleEn: 'Compose KPI: ω_thin/ω_thick thickness frequency ratio',
              bodyZh:
                'S26bx：薄板基频高于厚板（Mindlin 剪切软化厚板）。算例 ω_thin=120、ω_thick=100 → 比=1.2；诚实要求比>1。',
              bodyEn:
                'S26bx: thin fundamental above thick (Mindlin shear softens thick); sample 120/100=1.2; honesty requires ratio>1.',
              formula: {
                expr: 'ratio = omega_thin / omega_thick',
                vars: {
                  ratio: '薄/厚基频比 1',
                  omega_thin: '薄板基频 rad/s',
                  omega_thick: '厚板基频 rad/s',
                },
                sample: { omega_thin: 120, omega_thick: 100 },
                expected: 1.2,
                plainZh: '薄板相对厚板的基频比衡量厚度表升频诚实方向',
                plainEn:
                  'Thin-over-thick fundamental ratio measures honest frequency direction on the thickness table',
              },
            },
            {
              id: 'mindlin-compose-omega-thickness-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：max(0, ω_thick/ω_thin − 1) 厚度单调残差',
              titleEn: 'Compose KPI: max(0, ω_thick/ω_thin − 1) thickness monotone residual',
              bodyZh:
                '若 ω_thick≥ω_thin（增厚未降频）则残差≥0 不诚实；诚实包 ω_thin>ω_thick → 残差 0。算例 100/120−1 <0 → 裁剪为 0。',
              bodyEn:
                'Residual max(0, ω_thick/ω_thin−1); honest pack ω_thin>ω_thick → 0; sample 100/120 → clipped 0.',
              formula: {
                expr: 'res = max(0, omega_thick / omega_thin - 1)',
                vars: {
                  res: '厚度单调降频诚实残差 1',
                  omega_thick: '厚板基频 rad/s',
                  omega_thin: '薄板基频 rad/s',
                },
                sample: { omega_thick: 100, omega_thin: 120 },
                expected: 0,
                plainZh: '厚度单调降频诚实残差在厚板基频不低于薄板时为正，诚实包应为零',
                plainEn:
                  'Thickness monotone residual is positive when thick ω is not below thin; honest pack is zero',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-dual-span',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_span_t = Q_max − Q_min 厚度表双端跨度',
              titleEn: 'Compose KPI: Q_span_t = Q_max − Q_min thickness-table dual span',
              bodyZh:
                'S26bx dual min/max Q 跨厚度表：基频主导时 Q≈1/(2ζ) 跨度→0。算例 Q_max=Q_min=10 → span=0；桥接 dualQFactorNearOne × t。',
              bodyEn:
                'S26bx dual min/max Q across t table; fund-dom span→0; sample 10−10=0; bridges dualQFactorNearOne × t.',
              formula: {
                expr: 'Q_span_t = Q_max - Q_min',
                vars: {
                  Q_span_t: '厚度表 Q 双端跨度 1',
                  Q_max: '厚度表最大半功率 Q 1',
                  Q_min: '厚度表最小半功率 Q 1',
                },
                sample: { Q_max: 10, Q_min: 10 },
                expected: 0,
                plainZh: '厚度表半功率 Q 双端跨度在基频主导诚实包上应趋于零',
                plainEn:
                  'Half-power Q dual span across the thickness table vanishes under fund-dominated honest packaging',
              },
            },
            {
              id: 'mindlin-compose-shear-fraction-thickness',
              layer: 'foundation',
              titleZh: '合成：φ_s(t) = w_s / (w_b + w_s) 剪切挠度占比 × 厚度',
              titleEn: 'Compose: φ_s(t) = w_s / (w_b + w_s) shear deflection fraction × thickness',
              bodyZh:
                'S26bx 厚板剪切占比：w_s/(w_b+w_s)。算例 w_b=0.8、w_s=0.2 → φ_s=0.2；t↑ 通常 φ_s↑，桥接 thick residual。',
              bodyEn:
                'S26bx thick shear fraction w_s/(w_b+w_s); sample 0.2/1=0.2; t↑ usually φ_s↑; bridges thick residual.',
              formula: {
                expr: 'phi_s = w_s / (w_b + w_s)',
                vars: {
                  phi_s: '剪切挠度占比 1',
                  w_s: '剪切挠度贡献 m',
                  w_b: '弯曲挠度贡献 m',
                },
                sample: { w_s: 0.2, w_b: 0.8 },
                expected: 0.2,
                plainZh: '剪切挠度占比等于剪切贡献除以弯曲与剪切贡献之和',
                plainEn:
                  'Shear deflection fraction is shear contribution over bend plus shear contributions',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QtHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QtHonest joint gate (0/1)',
              bodyZh:
                'S26bx packaging：Q_w eng 诚实 ∧ Q_E eng 诚实 ∧ |Q_w−Q_E|→0 ∧ ω_thin>ω_thick ∧ Q_span_t≈0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26bx packaging: Q_w eng ∧ Q_E eng ∧ consistency ∧ ω_thin>ω_thick ∧ Q_span_t≈0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw * c_QE * c_cons * c_mono * c_span',
                vars: {
                  gate: 'Q×厚度 包装诚实门 0/1',
                  c_Qw: 'Q_w eng 诚实 0/1',
                  c_QE: 'Q_E eng 诚实 0/1',
                  c_cons: 'Q 一致性 诚实 0/1',
                  c_mono: '厚度单调 诚实 0/1',
                  c_span: 'Q 双端跨度 诚实 0/1',
                },
                sample: {
                  c_Qw: 1,
                  c_QE: 1,
                  c_cons: 1,
                  c_mono: 1,
                  c_span: 1,
                },
                expected: 1,
                plainZh: 'Q×厚度 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×thickness packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S26by half-power / energy Q × thickness×κ residual packaging (wave30 residual compose expand)
            {
              id: 'mindlin-compose-Qw-at-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成：Q_w(t,κ) = 1/(2 ζ) 半功率 Q × 厚度×κ',
              titleEn: 'Compose: Q_w(t,κ) = 1/(2 ζ) half-power Q × thickness×κ',
              bodyZh:
                'S26by |w| 半功率 Q×厚度×κ：小阻尼 Q_w≈1/(2ζ) 在 t×κ 矩阵上 eng 诚实。算例 ζ=0.05 → Q_w=10（与 t、κ 解耦教学入口）；完整矩阵归 solvers-structural。',
              bodyEn:
                'S26by |w| half-power Q×thickness×κ: Q_w≈1/(2ζ) eng-honest on t×κ matrix; sample ζ=0.05 → 10; full matrix in solvers-structural.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '位移半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                  t: '板厚 m（表参数）',
                  kappa: '剪切修正因子 κ（表参数）',
                },
                sample: { zeta: 0.05, t: 0.2, kappa: 5 / 6 },
                expected: 10,
                plainZh: '位移半功率品质因子在小阻尼下由阻尼比合成，厚度×κ 矩阵上应保持 eng 诚实',
                plainEn:
                  'Displacement half-power Q composes from damping under light damping and stays eng-honest across the thickness×κ matrix',
              },
            },
            {
              id: 'mindlin-compose-QE-at-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成：Q_E(t,κ) = 1/(2 ζ) 能量半功率 Q × 厚度×κ',
              titleEn: 'Compose: Q_E(t,κ) = 1/(2 ζ) energy half-power Q × thickness×κ',
              bodyZh:
                'S26by 能量半功率 Q×厚度×κ 对偶：Q_E≈1/(2ζ) 在每个 (t,κ) 上与 Q_w 同构。算例 ζ=0.05 → Q_E=10；桥接 |w|↔energy Q consistency × t×κ。',
              bodyEn:
                'S26by energy half-power Q×thickness×κ dual of Q_w; sample ζ=0.05 → 10; bridges |w|↔energy Q consistency × t×κ.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                  t: '板厚 m（表参数）',
                  kappa: '剪切修正因子 κ（表参数）',
                },
                sample: { zeta: 0.05, t: 0.2, kappa: 5 / 6 },
                expected: 10,
                plainZh: '能量半功率品质因子在厚度×κ 矩阵上由阻尼比合成，应与位移 Q 同构',
                plainEn:
                  'Energy half-power Q composes from damping on the thickness×κ matrix and should match displacement Q',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| Q 一致性 × 厚度×κ 残差',
              titleEn: 'Compose KPI: |Q_w − Q_E| Q consistency × thickness×κ residual',
              bodyZh:
                'S26by 三元组闭合：每个 (t,κ) 上 |Q_w−Q_E|→0。算例 Q_w=Q_E=10 → 残差 0；完成 |w| + energy + consistency × t×κ（S26bx×S26bw 叉积）。',
              bodyEn:
                'S26by trio closure: |Q_w−Q_E|→0 at every (t,κ); sample matched 10 → 0; completes |w|+energy+consistency × t×κ (cross of S26bx×S26bw).',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'Q 一致性绝对残差 1',
                  Q_w: '位移半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '位移与能量半功率品质因子之差在厚度×κ 矩阵上衡量 Q 一致性诚实',
                plainEn:
                  'Absolute difference of displacement and energy half-power Q on the thickness×κ matrix measures Q-consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-S-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成：S(t,κ) = κ G t 横向剪切刚度 × 厚度×κ',
              titleEn: 'Compose: S(t,κ) = κ G t transverse shear stiffness × thickness×κ',
              bodyZh:
                'S26by 厚度×κ 扫描上游：S=κ G t 双线性于 t 与 κ。算例 κ=5/6、G=E/(2(1+ν))、E=2.1e11、ν=0.3、t=0.1 → S=κ G t。',
              bodyEn:
                'Upstream of S26by t×κ sweep: S=κGt bilinear in t and κ; sample t=0.1 steel with κ=5/6.',
              formula: {
                expr: 'S = kappa * G * t',
                vars: {
                  S: '横向剪切刚度 N/m',
                  kappa: '剪切修正因子 κ',
                  G: '剪切模量 Pa',
                  t: '板厚 m',
                },
                sample: {
                  kappa: 5 / 6,
                  G: 2.1e11 / (2 * (1 + 0.3)),
                  t: 0.1,
                },
                expected: (5 / 6) * (2.1e11 / (2 * (1 + 0.3))) * 0.1,
                plainZh: '横向剪切刚度由剪切修正因子、剪切模量与厚度合成（厚度×κ 矩阵扫描）',
                plainEn:
                  'Transverse shear stiffness composes shear correction, shear modulus, and thickness on the t×κ matrix',
              },
            },
            {
              id: 'mindlin-compose-omega-kappa-at-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：ω(κ_hi)/ω(κ_lo) @t 升频比 × 厚度',
              titleEn: 'Compose KPI: ω(κ_hi)/ω(κ_lo) @t frequency ratio × thickness',
              bodyZh:
                'S26by：固定 t 上 κ↑ 基频↑（剪切更硬）。算例 ω_hi=110、ω_lo=100 → 比=1.1；诚实要求比>1。',
              bodyEn:
                'S26by: at fixed t, κ↑ raises fundamental (stiffer shear); sample 110/100=1.1; honesty requires ratio>1.',
              formula: {
                expr: 'ratio = omega_hi / omega_lo',
                vars: {
                  ratio: 'κ 升频比 1',
                  omega_hi: '高 κ 基频 rad/s',
                  omega_lo: '低 κ 基频 rad/s',
                },
                sample: { omega_hi: 110, omega_lo: 100 },
                expected: 1.1,
                plainZh: '固定厚度下高 κ 相对低 κ 的基频比衡量 κ 升频诚实方向',
                plainEn:
                  'High-over-low κ fundamental ratio at fixed thickness measures honest frequency direction on the κ axis',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-span',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_span_tk = Q_max − Q_min 厚度×κ 表双端跨度',
              titleEn: 'Compose KPI: Q_span_tk = Q_max − Q_min thickness×κ dual span',
              bodyZh:
                'S26by dual min/max Q 跨 t×κ 表：基频主导时 Q≈1/(2ζ) 跨度→0。算例 Q_max=Q_min=10 → span=0；桥接 dualQFactorNearOne × t×κ。',
              bodyEn:
                'S26by dual min/max Q across t×κ table; fund-dom span→0; sample 10−10=0; bridges dualQFactorNearOne × t×κ.',
              formula: {
                expr: 'Q_span_tk = Q_max - Q_min',
                vars: {
                  Q_span_tk: '厚度×κ 表 Q 双端跨度 1',
                  Q_max: '矩阵最大半功率 Q 1',
                  Q_min: '矩阵最小半功率 Q 1',
                },
                sample: { Q_max: 10, Q_min: 10 },
                expected: 0,
                plainZh: '厚度×κ 表半功率 Q 双端跨度在基频主导诚实包上应趋于零',
                plainEn:
                  'Half-power Q dual span across the thickness×κ table vanishes under fund-dominated honest packaging',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QtkHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QtkHonest joint gate (0/1)',
              bodyZh:
                'S26by packaging：Q_w eng 诚实 ∧ Q_E eng 诚实 ∧ |Q_w−Q_E|→0 ∧ ω↑κ@t 单调 ∧ Q_span_tk≈0。教学金标 → 1（下接 S26bz）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26by packaging: Q_w eng ∧ Q_E eng ∧ consistency ∧ ω↑κ@t monotone ∧ Q_span_tk≈0; honest gold → 1 (next S26bz); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw * c_QE * c_cons * c_mono * c_span',
                vars: {
                  gate: 'Q×厚度×κ 包装诚实门 0/1',
                  c_Qw: 'Q_w eng 诚实 0/1',
                  c_QE: 'Q_E eng 诚实 0/1',
                  c_cons: 'Q 一致性 诚实 0/1',
                  c_mono: 'κ 升频单调 诚实 0/1',
                  c_span: 'Q 双端跨度 诚实 0/1',
                },
                sample: {
                  c_Qw: 1,
                  c_QE: 1,
                  c_cons: 1,
                  c_mono: 1,
                  c_span: 1,
                },
                expected: 1,
                plainZh: 'Q×厚度×κ 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×thickness×κ packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S26bz half-power / energy Q × thickness×κ rotary dual + aspect×κ residual packaging (wave31 residual compose expand)
            {
              id: 'mindlin-compose-Qw-rotary-dual-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_w rotary dual @ t×κ（无/有转动惯量）',
              titleEn: 'Compose KPI: Q_w rotary dual @ t×κ (no/with rotary inertia)',
              bodyZh:
                'S26bz：|w| 半功率 Q 在 t×κ 上无/有 rotary 双路径。小阻尼 Q_w≈1/(2ζ) 两路均 eng 诚实。算例 ζ=0.05 → Q_w=10；桥接 thickness×κ rotary dual。',
              bodyEn:
                'S26bz |w| half-power Q dual paths no/with rotary on t×κ; Q_w≈1/(2ζ) eng-honest both paths; sample ζ=0.05 → 10; bridges thickness×κ rotary dual.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '|w| 半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: '半功率品质因子在小阻尼下约等于阻尼比倒数的一半，与 rotary 路径无关的教学入口',
                plainEn:
                  'Half-power quality factor is about one over twice the damping ratio under light damping; teaching entry independent of rotary path',
              },
            },
            {
              id: 'mindlin-compose-QE-rotary-dual-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_E rotary dual @ t×κ',
              titleEn: 'Compose KPI: Q_E rotary dual @ t×κ',
              bodyZh:
                'S26bz 能量半功率 Q×t×κ rotary dual：Q_E≈1/(2ζ) 与 Q_w 同构，含 rotary 时仍 eng 诚实。算例 ζ=0.05 → 10。',
              bodyEn:
                'S26bz energy half-power Q×t×κ rotary dual: Q_E≈1/(2ζ) isomorphic to Q_w; eng-honest with rotary; sample ζ=0.05 → 10.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: '能量半功率品质因子在小阻尼下约等于阻尼比倒数的一半',
                plainEn:
                  'Energy half-power quality factor is about one over twice the damping ratio under light damping',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-rotary-thickness-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| rotary 一致性 @ t×κ',
              titleEn: 'Compose KPI: |Q_w − Q_E| rotary consistency @ t×κ',
              bodyZh:
                'S26bz：含 rotary 时 |w|↔energy Q 一致性在每个 (t,κ) 仍 →0。算例 Q_w=Q_E=10 → 0；桥接 consistencyWithRotaryHonest。',
              bodyEn:
                'S26bz with rotary |w|↔energy Q consistency still →0 at every (t,κ); sample matched 10 → 0; bridges consistencyWithRotaryHonest.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'rotary 路径 |w|↔energy Q 绝对残差 1',
                  Q_w: '|w| 半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '含转动惯量时 |w| 与能量半功率 Q 之差的绝对值衡量一致性诚实',
                plainEn:
                  'Absolute |w|–energy half-power Q difference with rotary measures consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-omega-rotary-drop',
              layer: 'foundation',
              titleZh: '合成 KPI：ω_no / ω_rot rotary 降频比 @ t×κ',
              titleEn: 'Compose KPI: ω_no / ω_rot rotary drop ratio @ t×κ',
              bodyZh:
                'S26bz：每个 (t,κ) 上 rotary 降低基频 ω_rot < ω_no。算例 110/100=1.1；诚实要求比>1（rotaryLowersOmegaAtEveryCell）。',
              bodyEn:
                'S26bz rotary lowers fundamental at every (t,κ): ω_rot < ω_no; sample 110/100=1.1; honesty requires ratio>1 (rotaryLowersOmegaAtEveryCell).',
              formula: {
                expr: 'ratio = omega_no / omega_rot',
                vars: {
                  ratio: '无/有 rotary 基频比 1',
                  omega_no: '无转动惯量基频 rad/s',
                  omega_rot: '含转动惯量基频 rad/s',
                },
                sample: { omega_no: 110, omega_rot: 100 },
                expected: 1.1,
                plainZh: 'rotary 降频比等于无转动惯量基频除以含转动惯量基频，诚实时大于 1',
                plainEn:
                  'Rotary drop ratio is no-rotary over with-rotary fundamental; honest packaging requires ratio > 1',
              },
            },
            {
              id: 'mindlin-compose-Qw-at-aspect-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_w ≈ 1/(2ζ) @ aspect×κ',
              titleEn: 'Compose KPI: Q_w ≈ 1/(2ζ) @ aspect×κ',
              bodyZh:
                'S26bz |w| 半功率 Q×aspect×κ：小阻尼 Q_w≈1/(2ζ) 在 a/t×κ 矩阵 eng 诚实。算例 ζ=0.05 → 10；与 t×κ 三元组并置。',
              bodyEn:
                'S26bz |w| half-power Q×aspect×κ: Q_w≈1/(2ζ) eng-honest on a/t×κ matrix; sample ζ=0.05 → 10; sits with t×κ trio.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '|w| 半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: 'aspect×κ 表上半功率品质因子在小阻尼下约等于阻尼比倒数的一半',
                plainEn:
                  'Half-power quality factor on the aspect×κ table is about one over twice the damping ratio under light damping',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-aspect-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| 一致性 @ aspect×κ',
              titleEn: 'Compose KPI: |Q_w − Q_E| consistency @ aspect×κ',
              bodyZh:
                'S26bz aspect×κ 三元组闭合：每个 (a/t,κ) 上 |Q_w−Q_E|→0。算例 10 vs 10 → 0；桥接 Q×aspect×κ residual。',
              bodyEn:
                'S26bz aspect×κ trio closure: |Q_w−Q_E|→0 at every (a/t,κ); sample matched → 0; bridges Q×aspect×κ residual.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'aspect×κ |w|↔energy Q 绝对残差 1',
                  Q_w: '|w| 半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: 'aspect×κ 表上 |w| 与能量半功率 Q 之差的绝对值衡量一致性诚实',
                plainEn:
                  'Absolute |w|–energy half-power Q difference on the aspect×κ table measures consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-rotary-aspect-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QrotaryAspectHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QrotaryAspectHonest joint gate (0/1)',
              bodyZh:
                'S26bz packaging：Q_w rotary eng 诚实 ∧ Q_E rotary eng 诚实 ∧ |Q_w−Q_E|→0@t×κ ∧ rotary↓ω ∧ Q_w eng@aspect×κ ∧ |Q_w−Q_E|→0@aspect×κ。教学金标 → 1（下接 S26ca）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26bz packaging: Q_w rotary eng ∧ Q_E rotary eng ∧ consistency@t×κ ∧ rotary↓ω ∧ Q_w eng@aspect×κ ∧ consistency@aspect×κ; honest gold → 1 (next S26ca); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw * c_QE * c_cons_tk * c_rot * c_Qw_ak * c_cons_ak',
                vars: {
                  gate: 'Q×rotary×aspect 包装诚实门 0/1',
                  c_Qw: 'Q_w rotary eng 诚实 0/1',
                  c_QE: 'Q_E rotary eng 诚实 0/1',
                  c_cons_tk: 't×κ 一致性 诚实 0/1',
                  c_rot: 'rotary 降频 诚实 0/1',
                  c_Qw_ak: 'Q_w aspect×κ eng 诚实 0/1',
                  c_cons_ak: 'aspect×κ 一致性 诚实 0/1',
                },
                sample: {
                  c_Qw: 1,
                  c_QE: 1,
                  c_cons_tk: 1,
                  c_rot: 1,
                  c_Qw_ak: 1,
                  c_cons_ak: 1,
                },
                expected: 1,
                plainZh: 'Q×rotary×aspect 包装诚实门为六个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×rotary×aspect packaging honesty gate is the product of six sub-honesty flags; all-true yields 1',
              },
            },
            // S26ca half-power / energy Q × aspect×κ rotary dual + aspect×thickness rotary dual (wave32 residual compose expand)
            {
              id: 'mindlin-compose-Qw-rotary-dual-aspect-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_w rotary dual @ aspect×κ（无/有转动惯量）',
              titleEn: 'Compose KPI: Q_w rotary dual @ aspect×κ (no/with rotary inertia)',
              bodyZh:
                'S26ca：|w| 半功率 Q 在 a/t×κ 上无/有 rotary 双路径。小阻尼 Q_w≈1/(2ζ) 两路均 eng 诚实。算例 ζ=0.05 → Q_w=10；桥接 aspect×κ rotary dual。',
              bodyEn:
                'S26ca |w| half-power Q dual paths no/with rotary on a/t×κ; Q_w≈1/(2ζ) eng-honest both paths; sample ζ=0.05 → 10; bridges aspect×κ rotary dual.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '|w| 半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: 'aspect×κ rotary dual 半功率品质因子在小阻尼下约等于阻尼比倒数的一半',
                plainEn:
                  'Aspect×κ rotary dual half-power quality factor is about one over twice the damping ratio under light damping',
              },
            },
            {
              id: 'mindlin-compose-QE-rotary-dual-aspect-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_E rotary dual @ aspect×κ',
              titleEn: 'Compose KPI: Q_E rotary dual @ aspect×κ',
              bodyZh:
                'S26ca 能量半功率 Q×aspect×κ rotary dual：Q_E≈1/(2ζ) 与 Q_w 同构，含 rotary 时仍 eng 诚实。算例 ζ=0.05 → 10。',
              bodyEn:
                'S26ca energy half-power Q×aspect×κ rotary dual: Q_E≈1/(2ζ) isomorphic to Q_w; eng-honest with rotary; sample ζ=0.05 → 10.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: 'aspect×κ rotary dual 能量半功率品质因子在小阻尼下约等于阻尼比倒数的一半',
                plainEn:
                  'Aspect×κ rotary dual energy half-power quality factor is about one over twice the damping ratio under light damping',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-rotary-aspect-kappa',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| rotary 一致性 @ aspect×κ',
              titleEn: 'Compose KPI: |Q_w − Q_E| rotary consistency @ aspect×κ',
              bodyZh:
                'S26ca：含 rotary 时 |w|↔energy Q 一致性在每个 (a/t,κ) 仍 →0。算例 Q_w=Q_E=10 → 0；桥接 consistencyWithRotaryHonest@aspect×κ。',
              bodyEn:
                'S26ca with rotary |w|↔energy Q consistency still →0 at every (a/t,κ); sample matched 10 → 0; bridges consistencyWithRotaryHonest@aspect×κ.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'rotary 路径 aspect×κ |w|↔energy Q 绝对残差 1',
                  Q_w: '|w| 半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '含转动惯量时 aspect×κ 表上 |w| 与能量半功率 Q 之差的绝对值衡量一致性诚实',
                plainEn:
                  'Absolute |w|–energy half-power Q difference with rotary on the aspect×κ table measures consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-Qw-rotary-dual-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_w rotary dual @ aspect×thickness',
              titleEn: 'Compose KPI: Q_w rotary dual @ aspect×thickness',
              bodyZh:
                'S26ca：|w| 半功率 Q 在 a/t×t 上无/有 rotary 双路径。小阻尼 Q_w≈1/(2ζ) eng 诚实；ω↓aspect、ω↑t。算例 ζ=0.05 → 10。',
              bodyEn:
                'S26ca |w| half-power Q dual paths no/with rotary on a/t×t; Q_w≈1/(2ζ) eng-honest; ω↓aspect, ω↑t; sample ζ=0.05 → 10.',
              formula: {
                expr: 'Q_w = 1 / (2 * zeta)',
                vars: {
                  Q_w: '|w| 半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: 'aspect×thickness rotary dual 半功率品质因子在小阻尼下约等于阻尼比倒数的一半',
                plainEn:
                  'Aspect×thickness rotary dual half-power quality factor is about one over twice the damping ratio under light damping',
              },
            },
            {
              id: 'mindlin-compose-QE-rotary-dual-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：Q_E rotary dual @ aspect×thickness',
              titleEn: 'Compose KPI: Q_E rotary dual @ aspect×thickness',
              bodyZh:
                'S26ca 能量半功率 Q×aspect×thickness rotary dual：Q_E≈1/(2ζ) 与 Q_w 同构。算例 ζ=0.05 → 10。',
              bodyEn:
                'S26ca energy half-power Q×aspect×thickness rotary dual: Q_E≈1/(2ζ) isomorphic to Q_w; sample ζ=0.05 → 10.',
              formula: {
                expr: 'Q_E = 1 / (2 * zeta)',
                vars: {
                  Q_E: '能量半功率品质因子 1',
                  zeta: '模态阻尼比 1',
                },
                sample: { zeta: 0.05 },
                expected: 10,
                plainZh: 'aspect×thickness rotary dual 能量半功率品质因子在小阻尼下约等于阻尼比倒数的一半',
                plainEn:
                  'Aspect×thickness rotary dual energy half-power quality factor is about one over twice the damping ratio under light damping',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-rotary-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| rotary 一致性 @ aspect×thickness',
              titleEn: 'Compose KPI: |Q_w − Q_E| rotary consistency @ aspect×thickness',
              bodyZh:
                'S26ca：含 rotary 时 |w|↔energy Q 一致性在每个 (a/t,t) 仍 →0。算例 10 vs 10 → 0；桥接 aspect×thickness rotary envelope honesty。',
              bodyEn:
                'S26ca with rotary |w|↔energy Q consistency still →0 at every (a/t,t); sample matched → 0; bridges aspect×thickness rotary envelope honesty.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: 'rotary 路径 aspect×thickness |w|↔energy Q 绝对残差 1',
                  Q_w: '|w| 半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '含转动惯量时 aspect×thickness 表上 |w| 与能量半功率 Q 之差的绝对值衡量一致性诚实',
                plainEn:
                  'Absolute |w|–energy half-power Q difference with rotary on the aspect×thickness table measures consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-rotary-aspect-thickness-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QrotaryAspectThicknessHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QrotaryAspectThicknessHonest joint gate (0/1)',
              bodyZh:
                'S26ca packaging：Q_w rotary eng@aspect×κ ∧ Q_E rotary eng@aspect×κ ∧ |Q_w−Q_E|→0@aspect×κ ∧ Q_w rotary eng@aspect×t ∧ Q_E rotary eng@aspect×t ∧ |Q_w−Q_E|→0@aspect×t。教学金标 → 1（下接 S26cb）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26ca packaging: Q_w rotary eng@aspect×κ ∧ Q_E rotary eng@aspect×κ ∧ consistency@aspect×κ ∧ Q_w rotary eng@aspect×t ∧ Q_E rotary eng@aspect×t ∧ consistency@aspect×t; honest gold → 1 (next S26cb); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw_ak * c_QE_ak * c_cons_ak * c_Qw_at * c_QE_at * c_cons_at',
                vars: {
                  gate: 'Q×rotary×aspect×thickness 包装诚实门 0/1',
                  c_Qw_ak: 'Q_w rotary aspect×κ eng 诚实 0/1',
                  c_QE_ak: 'Q_E rotary aspect×κ eng 诚实 0/1',
                  c_cons_ak: 'aspect×κ rotary 一致性 诚实 0/1',
                  c_Qw_at: 'Q_w rotary aspect×t eng 诚实 0/1',
                  c_QE_at: 'Q_E rotary aspect×t eng 诚实 0/1',
                  c_cons_at: 'aspect×t rotary 一致性 诚实 0/1',
                },
                sample: {
                  c_Qw_ak: 1,
                  c_QE_ak: 1,
                  c_cons_ak: 1,
                  c_Qw_at: 1,
                  c_QE_at: 1,
                  c_cons_at: 1,
                },
                expected: 1,
                plainZh: 'Q×rotary×aspect×thickness 包装诚实门为六个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×rotary×aspect×thickness packaging honesty gate is the product of six sub-honesty flags; all-true yields 1',
              },
            },
            // S26cb half-power/energy Q × aspect×thickness rotary dual-path honesty (wave33 residual compose expand)
            {
              id: 'mindlin-compose-Qw-dual-path-parity-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w,no − Q_w,rot| dual-path parity @ aspect×thickness',
              titleEn: 'Compose KPI: |Q_w,no − Q_w,rot| dual-path parity @ aspect×thickness',
              bodyZh:
                'S26cb：|w| 半功率 Q 在 a/t×t 上无/有 rotary 双路径 parity。小阻尼 Q 与 rotary 无关 → |Q_w,no−Q_w,rot|→0。算例 10 vs 10 → 0；桥接 dual-path honesty。',
              bodyEn:
                'S26cb |w| half-power Q dual-path parity on a/t×t; light damping Q independent of rotary → |Q_w,no−Q_w,rot|→0; sample matched 10 → 0; bridges dual-path honesty.',
              formula: {
                expr: 'res = abs(Q_w_no - Q_w_rot)',
                vars: {
                  res: '|w| dual-path Q parity 绝对残差 1',
                  Q_w_no: '无 rotary |w| 半功率 Q 1',
                  Q_w_rot: '含 rotary |w| 半功率 Q 1',
                },
                sample: { Q_w_no: 10, Q_w_rot: 10 },
                expected: 0,
                plainZh: 'aspect×thickness 表上无/有 rotary |w| 半功率 Q 之差的绝对值衡量 dual-path parity 诚实',
                plainEn:
                  'Absolute no/with-rotary |w| half-power Q difference on the aspect×thickness table measures dual-path parity honesty',
              },
            },
            {
              id: 'mindlin-compose-QE-dual-path-parity-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_E,no − Q_E,rot| dual-path parity @ aspect×thickness',
              titleEn: 'Compose KPI: |Q_E,no − Q_E,rot| dual-path parity @ aspect×thickness',
              bodyZh:
                'S26cb 能量半功率 Q dual-path parity @ a/t×t：小阻尼 |Q_E,no−Q_E,rot|→0 与 Q_w 同构。算例 10 vs 10 → 0。',
              bodyEn:
                'S26cb energy half-power Q dual-path parity @ a/t×t: light damping |Q_E,no−Q_E,rot|→0 isomorphic to Q_w; sample matched → 0.',
              formula: {
                expr: 'res = abs(Q_E_no - Q_E_rot)',
                vars: {
                  res: '能量 dual-path Q parity 绝对残差 1',
                  Q_E_no: '无 rotary 能量半功率 Q 1',
                  Q_E_rot: '含 rotary 能量半功率 Q 1',
                },
                sample: { Q_E_no: 10, Q_E_rot: 10 },
                expected: 0,
                plainZh: 'aspect×thickness 表上无/有 rotary 能量半功率 Q 之差的绝对值衡量 dual-path parity 诚实',
                plainEn:
                  'Absolute no/with-rotary energy half-power Q difference on the aspect×thickness table measures dual-path parity honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-dual-path-joint-max-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max dual-path = max(|ΔQ_w|, |ΔQ_E|) @ aspect×thickness',
              titleEn: 'Compose KPI: joint_max dual-path = max(|ΔQ_w|, |ΔQ_E|) @ aspect×thickness',
              bodyZh:
                'S26cb 联合 dual-path 上确界：max(|Q_w,no−Q_w,rot|, |Q_E,no−Q_E,rot|)。诚实 → 0；算例 max(0.01,0.02)=0.02。',
              bodyEn:
                'S26cb joint dual-path upper envelope max(|ΔQ_w|,|ΔQ_E|); honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(abs(d_Qw), abs(d_QE))',
                vars: {
                  joint_max: 'dual-path joint 上确界 1',
                  d_Qw: '|w| dual-path Q 残差 1',
                  d_QE: '能量 dual-path Q 残差 1',
                },
                sample: { d_Qw: 0.01, d_QE: 0.02 },
                expected: 0.02,
                plainZh: 'dual-path joint 上确界取 |w| 与能量 dual-path Q 残差绝对值之最大',
                plainEn:
                  'Dual-path joint upper bound is the max of absolute |w| and energy dual-path Q residuals',
              },
            },
            {
              id: 'mindlin-compose-Q-dual-path-parity-w-E-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：||ΔQ_w| − |ΔQ_E|| dual-path |w|↔energy parity',
              titleEn: 'Compose KPI: ||ΔQ_w| − |ΔQ_E|| dual-path |w|↔energy parity',
              bodyZh:
                'S26cb expand-path parity：|w| 与能量 dual-path 残差应对齐。算例 |0.01−0.01|=0；桥接 dual-path honesty。',
              bodyEn:
                'S26cb expand-path parity: |w| and energy dual-path residuals should align; sample |0.01−0.01|=0; bridges dual-path honesty.',
              formula: {
                expr: 'parity = abs(abs(d_Qw) - abs(d_QE))',
                vars: {
                  parity: 'dual-path |w|↔energy parity 残差 1',
                  d_Qw: '|w| dual-path Q 残差 1',
                  d_QE: '能量 dual-path Q 残差 1',
                },
                sample: { d_Qw: 0.01, d_QE: 0.01 },
                expected: 0,
                plainZh: 'dual-path |w| 与能量残差绝对值之差衡量 expand-path parity 诚实',
                plainEn:
                  'Absolute difference of |w| and energy dual-path residual magnitudes measures expand-path parity honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-consistency-both-paths-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|Q_w − Q_E| 双路径一致性 @ aspect×thickness',
              titleEn: 'Compose KPI: |Q_w − Q_E| both-paths consistency @ aspect×thickness',
              bodyZh:
                'S26cb：无/有 rotary 两路上 |Q_w−Q_E| 均 →0。算例 10 vs 10 → 0；桥接 both-paths consistency honesty。',
              bodyEn:
                'S26cb |Q_w−Q_E|→0 on both no/with-rotary paths; sample matched 10 → 0; bridges both-paths consistency honesty.',
              formula: {
                expr: 'res = abs(Q_w - Q_E)',
                vars: {
                  res: '双路径 |w|↔energy Q 绝对残差 1',
                  Q_w: '|w| 半功率 Q 1',
                  Q_E: '能量半功率 Q 1',
                },
                sample: { Q_w: 10, Q_E: 10 },
                expected: 0,
                plainZh: '双路径上 |w| 与能量半功率 Q 之差的绝对值衡量 both-paths 一致性诚实',
                plainEn:
                  'Absolute |w|–energy half-power Q difference on both dual paths measures both-paths consistency honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-aspect-thickness-dual-path-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QaspectThicknessDualPathHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QaspectThicknessDualPathHonest joint gate (0/1)',
              bodyZh:
                'S26cb packaging：Q_w dual-path parity ∧ Q_E dual-path parity ∧ joint_max→0 ∧ |w|↔energy parity ∧ both-paths |Q_w−Q_E|→0。教学金标 → 1（下接 S26cc dual-path expand）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26cb packaging: Q_w dual-path parity ∧ Q_E dual-path parity ∧ joint_max→0 ∧ |w|↔energy parity ∧ both-paths consistency; honest gold → 1 (next S26cc dual-path expand); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw_dp * c_QE_dp * c_joint * c_parity * c_cons',
                vars: {
                  gate: 'Q×aspect×thickness dual-path 包装诚实门 0/1',
                  c_Qw_dp: 'Q_w dual-path parity 诚实 0/1',
                  c_QE_dp: 'Q_E dual-path parity 诚实 0/1',
                  c_joint: 'dual-path joint_max 诚实 0/1',
                  c_parity: '|w|↔energy dual-path parity 诚实 0/1',
                  c_cons: 'both-paths 一致性 诚实 0/1',
                },
                sample: {
                  c_Qw_dp: 1,
                  c_QE_dp: 1,
                  c_joint: 1,
                  c_parity: 1,
                  c_cons: 1,
                },
                expected: 1,
                plainZh: 'Q×aspect×thickness dual-path 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×aspect×thickness dual-path packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },

            // S26cc half-power/energy Q × aspect×thickness rotary dual-path expand (|w|↔energy packaging) (wave34 residual compose expand)
            {
              id: 'mindlin-compose-Q-dual-path-joint-mean-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_mean dual-path = mean(|ΔQ_w|, |ΔQ_E|) @ aspect×thickness',
              titleEn: 'Compose KPI: joint_mean dual-path = mean(|ΔQ_w|, |ΔQ_E|) @ aspect×thickness',
              bodyZh:
                'S26cc dual-path expand：joint 均值包装 mean(|Q_w,no−Q_w,rot|, |Q_E,no−Q_E,rot|)。诚实 → 0；算例 mean(0.01,0.03)=0.02。',
              bodyEn:
                'S26cc dual-path expand joint-mean packaging mean(|ΔQ_w|,|ΔQ_E|); honest → 0; sample mean(0.01,0.03)=0.02.',
              formula: {
                expr: 'joint_mean = 0.5 * (abs(d_Qw) + abs(d_QE))',
                vars: {
                  joint_mean: 'dual-path joint 均值 1',
                  d_Qw: '|w| dual-path Q 残差 1',
                  d_QE: '能量 dual-path Q 残差 1',
                },
                sample: { d_Qw: 0.01, d_QE: 0.03 },
                expected: 0.02,
                plainZh: 'dual-path joint 均值取 |w| 与能量 dual-path Q 残差绝对值的算术平均',
                plainEn:
                  'Dual-path joint mean is the arithmetic average of absolute |w| and energy dual-path Q residuals',
              },
            },
            {
              id: 'mindlin-compose-Qw-dual-path-relative-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|ΔQ_w| / Q_w dual-path relative @ aspect×thickness',
              titleEn: 'Compose KPI: |ΔQ_w| / Q_w dual-path relative @ aspect×thickness',
              bodyZh:
                'S26cc |w| dual-path 相对包装：|Q_w,no−Q_w,rot|/max(Q_w,ε)。匹配 → 0。算例 Δ=0、Q=10 → 0。',
              bodyEn:
                'S26cc |w| dual-path relative packaging |ΔQ_w|/max(Q_w,ε); matched → 0; sample Δ=0 → 0.',
              formula: {
                expr: 'rel = abs(Q_w_no - Q_w_rot) / max(Q_w_ref, eps)',
                vars: {
                  rel: '|w| dual-path 相对残差 1',
                  Q_w_no: '无 rotary |w| 半功率 Q 1',
                  Q_w_rot: '含 rotary |w| 半功率 Q 1',
                  Q_w_ref: '参考 |w| 半功率 Q 1',
                  eps: '防除零下界',
                },
                sample: { Q_w_no: 10, Q_w_rot: 10, Q_w_ref: 10, eps: 1e-12 },
                expected: 0,
                plainZh: 'aspect×thickness 表上 |w| dual-path 相对残差等于无/有 rotary Q 差绝对值除以参考 Q',
                plainEn:
                  'Absolute no/with-rotary |w| Q difference over reference Q on aspect×thickness is dual-path relative residual',
              },
            },
            {
              id: 'mindlin-compose-QE-dual-path-relative-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|ΔQ_E| / Q_E dual-path relative @ aspect×thickness',
              titleEn: 'Compose KPI: |ΔQ_E| / Q_E dual-path relative @ aspect×thickness',
              bodyZh:
                'S26cc 能量 dual-path 相对包装：|Q_E,no−Q_E,rot|/max(Q_E,ε) 与 Q_w 同构。匹配 → 0。',
              bodyEn:
                'S26cc energy dual-path relative packaging isomorphic to Q_w; matched → 0.',
              formula: {
                expr: 'rel = abs(Q_E_no - Q_E_rot) / max(Q_E_ref, eps)',
                vars: {
                  rel: '能量 dual-path 相对残差 1',
                  Q_E_no: '无 rotary 能量半功率 Q 1',
                  Q_E_rot: '含 rotary 能量半功率 Q 1',
                  Q_E_ref: '参考能量半功率 Q 1',
                  eps: '防除零下界',
                },
                sample: { Q_E_no: 10, Q_E_rot: 10, Q_E_ref: 10, eps: 1e-12 },
                expected: 0,
                plainZh: 'aspect×thickness 表上能量 dual-path 相对残差等于无/有 rotary Q 差绝对值除以参考 Q',
                plainEn:
                  'Absolute no/with-rotary energy Q difference over reference Q on aspect×thickness is dual-path relative residual',
              },
            },
            {
              id: 'mindlin-compose-Q-dual-path-w-E-relative-parity-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：||rel_w| − |rel_E|| dual-path |w|↔energy relative parity',
              titleEn: 'Compose KPI: ||rel_w| − |rel_E|| dual-path |w|↔energy relative parity',
              bodyZh:
                'S26cc |w|↔energy packaging：相对 dual-path 残差应对齐。算例 |0.01−0.01|=0；桥接 expand-path relative parity。',
              bodyEn:
                'S26cc |w|↔energy packaging: relative dual-path residuals should align; sample |0.01−0.01|=0; bridges expand-path relative parity.',
              formula: {
                expr: 'parity = abs(abs(rel_w) - abs(rel_E))',
                vars: {
                  parity: 'dual-path |w|↔energy 相对 parity 残差 1',
                  rel_w: '|w| dual-path 相对残差 1',
                  rel_E: '能量 dual-path 相对残差 1',
                },
                sample: { rel_w: 0.01, rel_E: 0.01 },
                expected: 0,
                plainZh: 'dual-path |w| 与能量相对残差绝对值之差衡量 |w|↔energy packaging 相对 parity 诚实',
                plainEn:
                  'Absolute difference of |w| and energy dual-path relative residual magnitudes measures |w|↔energy packaging relative parity honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-dual-path-w-E-packaging-residual-aspect-thickness',
              layer: 'foundation',
              titleZh: '合成 KPI：|w|↔energy dual-path packaging residual @ aspect×thickness',
              titleEn: 'Compose KPI: |w|↔energy dual-path packaging residual @ aspect×thickness',
              bodyZh:
                'S26cc packaging residual：max(joint_mean, |w|↔energy relative parity)。诚实 → 0；算例 max(0.01,0.02)=0.02。',
              bodyEn:
                'S26cc packaging residual max(joint_mean, relative parity); honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'pack = max(joint_mean, parity_rel)',
                vars: {
                  pack: '|w|↔energy dual-path packaging 残差 1',
                  joint_mean: 'dual-path joint 均值 1',
                  parity_rel: '|w|↔energy 相对 parity 1',
                },
                sample: { joint_mean: 0.01, parity_rel: 0.02 },
                expected: 0.02,
                plainZh: '|w|↔energy dual-path packaging 残差取 joint 均值与相对 parity 之上确界',
                plainEn:
                  '|w|↔energy dual-path packaging residual is the upper envelope of joint mean and relative parity',
              },
            },
            {
              id: 'mindlin-compose-Q-aspect-thickness-dual-path-expand-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QaspectThicknessDualPathExpandHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QaspectThicknessDualPathExpandHonest joint gate (0/1)',
              bodyZh:
                'S26cc packaging：joint_mean→0 ∧ Q_w relative→0 ∧ Q_E relative→0 ∧ |w|↔energy relative parity ∧ packaging residual→0。教学金标 → 1（下接 S26cd thickness×κ dual-path landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26cc packaging: joint_mean→0 ∧ Q_w relative→0 ∧ Q_E relative→0 ∧ |w|↔energy relative parity ∧ packaging residual→0; honest gold → 1 (next S26cd thickness×κ dual-path landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_mean * c_rel_w * c_rel_E * c_parity * c_pack',
                vars: {
                  gate: 'Q×aspect×thickness dual-path expand 包装诚实门 0/1',
                  c_mean: 'dual-path joint_mean 诚实 0/1',
                  c_rel_w: 'Q_w dual-path relative 诚实 0/1',
                  c_rel_E: 'Q_E dual-path relative 诚实 0/1',
                  c_parity: '|w|↔energy 相对 parity 诚实 0/1',
                  c_pack: 'packaging residual 诚实 0/1',
                },
                sample: {
                  c_mean: 1,
                  c_rel_w: 1,
                  c_rel_E: 1,
                  c_parity: 1,
                  c_pack: 1,
                },
                expected: 1,
                plainZh: 'Q×aspect×thickness dual-path expand 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×aspect×thickness dual-path expand packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },

            // S26cd half-power/energy Q × thickness×κ rotary dual-path honesty + |w|↔energy packaging (wave35 residual compose expand; solvers tip landed)
            {
              id: 'mindlin-compose-Qw-thickness-kappa-dual-path-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：|w| Q × thickness×κ rotary dual-path honesty residual',
              titleEn: 'Compose KPI: |w| Q × thickness×κ rotary dual-path honesty residual',
              bodyZh:
                'S26cd（landed）：|w| 半功率 Q 在 thickness×κ 表上 no-rotary↔rotary dual-path 诚实包。匹配 dual-path → residual 0。算例 Q_no=Q_rot=10 → 0。',
              bodyEn:
                'S26cd (landed) |w| half-power Q thickness×κ dual-path honesty; matched no/with rotary → residual 0; sample 10=10 → 0.',
              formula: {
                expr: 'res = abs(Q_w_no - Q_w_rot) / max(Q_w_ref, eps)',
                vars: {
                  res: '|w| thickness×κ dual-path 相对残差 1',
                  Q_w_no: '无 rotary |w| 半功率 Q 1',
                  Q_w_rot: '含 rotary |w| 半功率 Q 1',
                  Q_w_ref: '参考 |w| 半功率 Q 1',
                  eps: '防除零下界',
                },
                sample: { Q_w_no: 10, Q_w_rot: 10, Q_w_ref: 10, eps: 1e-12 },
                expected: 0,
                plainZh: 'thickness×κ 表上 |w| dual-path 相对残差等于无/有 rotary Q 差绝对值除以参考 Q',
                plainEn:
                  'Absolute no/with-rotary |w| Q difference over reference Q on thickness×κ is dual-path relative residual',
              },
            },
            {
              id: 'mindlin-compose-QE-thickness-kappa-dual-path-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：energy Q × thickness×κ rotary dual-path honesty residual',
              titleEn: 'Compose KPI: energy Q × thickness×κ rotary dual-path honesty residual',
              bodyZh:
                'S26cd 能量半功率 Q 在 thickness×κ 表上 dual-path 诚实，与 |w| 同构。匹配 → 0。',
              bodyEn:
                'S26cd energy half-power Q thickness×κ dual-path honesty isomorphic to |w|; matched → 0.',
              formula: {
                expr: 'res = abs(Q_E_no - Q_E_rot) / max(Q_E_ref, eps)',
                vars: {
                  res: '能量 thickness×κ dual-path 相对残差 1',
                  Q_E_no: '无 rotary 能量半功率 Q 1',
                  Q_E_rot: '含 rotary 能量半功率 Q 1',
                  Q_E_ref: '参考能量半功率 Q 1',
                  eps: '防除零下界',
                },
                sample: { Q_E_no: 10, Q_E_rot: 10, Q_E_ref: 10, eps: 1e-12 },
                expected: 0,
                plainZh: 'thickness×κ 表上能量 dual-path 相对残差等于无/有 rotary Q 差绝对值除以参考 Q',
                plainEn:
                  'Absolute no/with-rotary energy Q difference over reference Q on thickness×κ is dual-path relative residual',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max dual-path = max(|ΔQ_w|, |ΔQ_E|) @ thickness×κ',
              titleEn: 'Compose KPI: joint_max dual-path = max(|ΔQ_w|, |ΔQ_E|) @ thickness×κ',
              bodyZh:
                'S26cd joint 包装：max(|Q_w,no−Q_w,rot|, |Q_E,no−Q_E,rot|)。诚实 → 0；算例 max(0.01,0.03)=0.03。',
              bodyEn:
                'S26cd joint packaging max(|ΔQ_w|,|ΔQ_E|); honest → 0; sample max(0.01,0.03)=0.03.',
              formula: {
                expr: 'joint_max = max(abs(d_Qw), abs(d_QE))',
                vars: {
                  joint_max: 'dual-path joint 上确界 1',
                  d_Qw: '|w| dual-path Q 残差 1',
                  d_QE: '能量 dual-path Q 残差 1',
                },
                sample: { d_Qw: 0.01, d_QE: 0.03 },
                expected: 0.03,
                plainZh: 'dual-path joint 上确界取 |w| 与能量 dual-path Q 残差绝对值之最大',
                plainEn:
                  'Dual-path joint max is the upper envelope of absolute |w| and energy dual-path Q residuals',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-consistency-parity',
              layer: 'foundation',
              titleZh: '合成 KPI：dual-path consistency abs-diff parity @ thickness×κ',
              titleEn: 'Compose KPI: dual-path consistency abs-diff parity @ thickness×κ',
              bodyZh:
                'S26cd |w|↔energy packaging：dual-path 一致性绝对差应对齐。算例 |0.01−0.01|=0；桥接 dualPathConsistencyAbsDiffParity。',
              bodyEn:
                'S26cd |w|↔energy packaging: dual-path consistency abs-diffs should align; sample |0.01−0.01|=0; bridges dualPathConsistencyAbsDiffParity.',
              formula: {
                expr: 'parity = abs(abs(d_Qw) - abs(d_QE))',
                vars: {
                  parity: 'dual-path consistency abs-diff parity 1',
                  d_Qw: '|w| dual-path Q 残差 1',
                  d_QE: '能量 dual-path Q 残差 1',
                },
                sample: { d_Qw: 0.01, d_QE: 0.01 },
                expected: 0,
                plainZh: '|w| 与能量 dual-path 绝对残差之差衡量 consistency parity 诚实',
                plainEn:
                  'Absolute difference of |w| and energy dual-path residual magnitudes measures consistency parity honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-packaging-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|w|↔energy thickness×κ dual-path packaging residual',
              titleEn: 'Compose KPI: |w|↔energy thickness×κ dual-path packaging residual',
              bodyZh:
                'S26cd packaging residual：max(joint_max, consistency parity)。诚实 → 0；算例 max(0.02,0.01)=0.02。',
              bodyEn:
                'S26cd packaging residual max(joint_max, consistency parity); honest → 0; sample max(0.02,0.01)=0.02.',
              formula: {
                expr: 'pack = max(joint_max, parity)',
                vars: {
                  pack: '|w|↔energy thickness×κ dual-path packaging 残差 1',
                  joint_max: 'dual-path joint 上确界 1',
                  parity: 'consistency parity 1',
                },
                sample: { joint_max: 0.02, parity: 0.01 },
                expected: 0.02,
                plainZh: '|w|↔energy thickness×κ dual-path packaging 残差取 joint 上确界与 consistency parity 之上确界',
                plainEn:
                  '|w|↔energy thickness×κ dual-path packaging residual is the upper envelope of joint max and consistency parity',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QthicknessKappaDualPathHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QthicknessKappaDualPathHonest joint gate (0/1)',
              bodyZh:
                'S26cd packaging：Q_w dual-path→0 ∧ Q_E dual-path→0 ∧ joint_max→0 ∧ consistency parity ∧ packaging residual→0。教学金标 → 1（下接 S26ce expand packaging landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26cd packaging: Q_w dual-path→0 ∧ Q_E dual-path→0 ∧ joint_max→0 ∧ consistency parity ∧ packaging residual→0; honest gold → 1 (next S26ce expand packaging landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_Qw * c_QE * c_joint * c_parity * c_pack',
                vars: {
                  gate: 'Q×thickness×κ dual-path 包装诚实门 0/1',
                  c_Qw: 'Q_w dual-path 诚实 0/1',
                  c_QE: 'Q_E dual-path 诚实 0/1',
                  c_joint: 'joint_max 诚实 0/1',
                  c_parity: 'consistency parity 诚实 0/1',
                  c_pack: 'packaging residual 诚实 0/1',
                },
                sample: {
                  c_Qw: 1,
                  c_QE: 1,
                  c_joint: 1,
                  c_parity: 1,
                  c_pack: 1,
                },
                expected: 1,
                plainZh: 'Q×thickness×κ dual-path 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×thickness×κ dual-path packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },

            // S26ce half-power/energy Q × thickness×κ dual-path honesty expand + |w|↔energy packaging (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'mindlin-compose-Qw-thickness-kappa-dual-path-expand-consistency',
              layer: 'foundation',
              titleZh: '合成 KPI：|w| Q × thickness×κ dual-path expand consistency residual',
              titleEn: 'Compose KPI: |w| Q × thickness×κ dual-path expand consistency residual',
              bodyZh:
                'S26ce（landed）：|w| 半功率 Q 在 thickness×κ 表上 dual-path consistency abs-diff envelope expand。匹配 → residual 0。算例 d_no=d_rot=0.01 → 0。',
              bodyEn:
                'S26ce (landed) |w| half-power Q thickness×κ dual-path consistency abs-diff envelope expand; matched → residual 0; sample 0.01=0.01 → 0.',
              formula: {
                expr: 'res = abs(d_w_no - d_w_rot)',
                vars: {
                  res: '|w| thickness×κ dual-path expand consistency 残差 1',
                  d_w_no: '无 rotary |w| consistency abs-diff 1',
                  d_w_rot: '含 rotary |w| consistency abs-diff 1',
                },
                sample: { d_w_no: 0.01, d_w_rot: 0.01 },
                expected: 0,
                plainZh: 'thickness×κ 表上 |w| dual-path expand consistency 残差等于无/有 rotary consistency abs-diff 之差',
                plainEn:
                  'Absolute no/with-rotary |w| consistency abs-diff difference on thickness×κ is dual-path expand consistency residual',
              },
            },
            {
              id: 'mindlin-compose-QE-thickness-kappa-dual-path-expand-parity',
              layer: 'foundation',
              titleZh: '合成 KPI：energy Q × thickness×κ dual-path expand both-paths parity',
              titleEn: 'Compose KPI: energy Q × thickness×κ dual-path expand both-paths parity',
              bodyZh:
                'S26ce 能量半功率 Q both-paths consistency parity expand，与 |w| 同构。匹配 → 0。',
              bodyEn:
                'S26ce energy half-power Q both-paths consistency parity expand isomorphic to |w|; matched → 0.',
              formula: {
                expr: 'res = abs(d_E_no - d_E_rot)',
                vars: {
                  res: '能量 thickness×κ dual-path expand parity 残差 1',
                  d_E_no: '无 rotary 能量 consistency abs-diff 1',
                  d_E_rot: '含 rotary 能量 consistency abs-diff 1',
                },
                sample: { d_E_no: 0.01, d_E_rot: 0.01 },
                expected: 0,
                plainZh: 'thickness×κ 表上能量 dual-path expand parity 残差等于无/有 rotary consistency abs-diff 之差',
                plainEn:
                  'Absolute no/with-rotary energy consistency abs-diff difference on thickness×κ is dual-path expand parity residual',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-expand-joint-mean',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_mean expand dual-path = mean(|Δd_w|, |Δd_E|) @ thickness×κ',
              titleEn: 'Compose KPI: joint_mean expand dual-path = mean(|Δd_w|, |Δd_E|) @ thickness×κ',
              bodyZh:
                'S26ce joint expand packaging：mean(|d_w,no−d_w,rot|, |d_E,no−d_E,rot|)。诚实 → 0；算例 mean(0.02,0.04)=0.03。',
              bodyEn:
                'S26ce joint expand packaging mean(|Δd_w|,|Δd_E|); honest → 0; sample mean(0.02,0.04)=0.03.',
              formula: {
                expr: 'joint_mean = 0.5 * (abs(d_w) + abs(d_E))',
                vars: {
                  joint_mean: 'dual-path expand joint 均值 1',
                  d_w: '|w| dual-path expand 残差 1',
                  d_E: '能量 dual-path expand 残差 1',
                },
                sample: { d_w: 0.02, d_E: 0.04 },
                expected: 0.03,
                plainZh: 'dual-path expand joint 均值取 |w| 与能量 expand 残差绝对值之算术平均',
                plainEn:
                  'Dual-path expand joint mean is the arithmetic mean of absolute |w| and energy expand residuals',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-expand-path-parity',
              layer: 'foundation',
              titleZh: '合成 KPI：expand-path abs-diff parity @ thickness×κ',
              titleEn: 'Compose KPI: expand-path abs-diff parity @ thickness×κ',
              bodyZh:
                'S26ce |w|↔energy expand packaging：expand-path abs-diff 应对齐。算例 |0.02−0.02|=0；桥接 expandPathAbsDiffParity。',
              bodyEn:
                'S26ce |w|↔energy expand packaging: expand-path abs-diffs should align; sample |0.02−0.02|=0; bridges expandPathAbsDiffParity.',
              formula: {
                expr: 'parity = abs(abs(d_w) - abs(d_E))',
                vars: {
                  parity: 'expand-path abs-diff parity 1',
                  d_w: '|w| dual-path expand 残差 1',
                  d_E: '能量 dual-path expand 残差 1',
                },
                sample: { d_w: 0.02, d_E: 0.02 },
                expected: 0,
                plainZh: '|w| 与能量 expand-path 绝对残差之差衡量 expand-path parity 诚实',
                plainEn:
                  'Absolute difference of |w| and energy expand-path residual magnitudes measures expand-path parity honesty',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-expand-packaging-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|w|↔energy thickness×κ dual-path expand packaging residual',
              titleEn: 'Compose KPI: |w|↔energy thickness×κ dual-path expand packaging residual',
              bodyZh:
                'S26ce packaging residual：max(joint_mean, expand-path parity)。诚实 → 0；算例 max(0.03,0.01)=0.03。',
              bodyEn:
                'S26ce packaging residual max(joint_mean, expand-path parity); honest → 0; sample max(0.03,0.01)=0.03.',
              formula: {
                expr: 'pack = max(joint_mean, parity)',
                vars: {
                  pack: '|w|↔energy thickness×κ dual-path expand packaging 残差 1',
                  joint_mean: 'dual-path expand joint 均值 1',
                  parity: 'expand-path parity 1',
                },
                sample: { joint_mean: 0.03, parity: 0.01 },
                expected: 0.03,
                plainZh: '|w|↔energy thickness×κ dual-path expand packaging 残差取 joint 均值与 expand-path parity 之上确界',
                plainEn:
                  '|w|↔energy thickness×κ dual-path expand packaging residual is the upper envelope of joint mean and expand-path parity',
              },
            },
            {
              id: 'mindlin-compose-Q-thickness-kappa-dual-path-expand-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：QthicknessKappaDualPathExpandHonest 联合门（0/1）',
              titleEn: 'Compose KPI: QthicknessKappaDualPathExpandHonest joint gate (0/1)',
              bodyZh:
                'S26ce packaging：|w| expand consistency→0 ∧ energy expand parity→0 ∧ joint_mean→0 ∧ expand-path parity ∧ packaging residual→0。教学金标 → 1（下接 S26cf）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S26ce packaging: |w| expand consistency→0 ∧ energy expand parity→0 ∧ joint_mean→0 ∧ expand-path parity ∧ packaging residual→0; honest gold → 1 (next S26cf); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_w * c_E * c_mean * c_parity * c_pack',
                vars: {
                  gate: 'Q×thickness×κ dual-path expand 包装诚实门 0/1',
                  c_w: '|w| expand consistency 诚实 0/1',
                  c_E: 'energy expand parity 诚实 0/1',
                  c_mean: 'joint_mean 诚实 0/1',
                  c_parity: 'expand-path parity 诚实 0/1',
                  c_pack: 'packaging residual 诚实 0/1',
                },
                sample: {
                  c_w: 1,
                  c_E: 1,
                  c_mean: 1,
                  c_parity: 1,
                  c_pack: 1,
                },
                expected: 1,
                plainZh: 'Q×thickness×κ dual-path expand 包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Q×thickness×κ dual-path expand packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
          ],
        },
        {
          id: 'mindlin-L0',
          layer: 'L0',
          titleZh: 'L0：板弯曲 / 剪切教学叶子',
          titleEn: 'L0: plate bend / shear teaching',
          bodyZh:
            '教学可用单式 D、S 与固支圆闭式演示薄/厚差；不计入 engineering DoD。完整 Mindlin Navier / FEM 归 solvers-structural。',
          bodyEn:
            'Teaching D/S and circular closed form allowed; eng Mindlin path lives in solvers-structural.',
        },
      ],
    },
  }
