import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_EM_FDTD_3D: CalculationMethod = {
    id: 'kind-em-fdtd-3d',
    titleZh: '电磁 FDTD Yee3D（工程 kind）',
    titleEn: 'EM FDTD Yee3D (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind em-fdtd-3d：Yee 交错 Maxwell 时域推进；工程路径归 @w-sim/solvers-em-fdtd。',
    summaryEn:
      'W-Sim kind em-fdtd-3d: Yee staggered Maxwell march; owned by @w-sim/solvers-em-fdtd.',
    jobKinds: ['em-fdtd-3d'],
    explainRoot: {
      id: 'em-root',
      layer: 'method',
      titleZh: '方法：EM FDTD 3D',
      titleEn: 'Method: EM FDTD 3D',
      bodyZh:
        '顶层工程计算方法：在 Yee 网格上交错更新 E/H，闭合 PEC 与吸收边界，输出场与能量 KPI。数值实现归 @w-sim/solvers-em-fdtd。',
      bodyEn:
        'Yee staggered E/H updates with PEC/ABC; owned by @w-sim/solvers-em-fdtd.',
      jobKinds: ['em-fdtd-3d'],
      children: [
        {
          id: 'em-principle-maxwell',
          layer: 'principle',
          titleZh: '原理：Maxwell 与 Yee 交错',
          titleEn: 'Principle: Maxwell & Yee stagger',
          bodyZh:
            '无源区 curl E = −∂B/∂t、curl H = ∂D/∂t；Yee 将 E/H 分量放在半格点，中心差分逼近旋度。',
          bodyEn:
            'Source-free curls couple E/H; Yee places components on half-cells for centered curls.',
          children: [
            {
              id: 'em-foundation-c',
              layer: 'foundation',
              titleZh: '基础式：c = 1 / √(μ ε)',
              titleEn: 'Foundation: c = 1 / √(μ ε)',
              bodyZh:
                '均匀介质中光速由介电常数与磁导率决定。真空量级 c₀ ≈ 2.998×10⁸ m/s。',
              bodyEn: 'Phase speed from μ,ε; vacuum ≈ 2.998e8 m/s.',
              formula: {
                expr: 'c = 1 / sqrt(mu * eps)',
                vars: {
                  c: '光速 m/s',
                  mu: '磁导率 H/m',
                  eps: '介电常数 F/m',
                },
                // mu0 * eps0 with rounded eps0 → close to c0
                sample: { mu: 1.2566370614e-6, eps: 8.854187817e-12 },
                expected: 1 / Math.sqrt(1.2566370614e-6 * 8.854187817e-12),
                plainZh: '电磁波速等于磁导率与介电常数乘积开方的倒数',
                plainEn: 'Wave speed is the reciprocal square root of μ times ε',
              },
            },
            {
              id: 'em-foundation-z0',
              layer: 'foundation',
              titleZh: '基础式：Z₀ = √(μ/ε)',
              titleEn: 'Foundation: Z₀ = √(μ/ε)',
              bodyZh:
                '平面波中 |E|/|H| ≈ Z。界面反射由阻抗失配决定；工程边界含 PEC / 吸收层。',
              bodyEn: 'Plane-wave |E|/|H| ≈ Z; mismatch sets reflection.',
              formula: {
                expr: 'Z = sqrt(mu / eps)',
                vars: {
                  Z: '波阻抗 Ω',
                  mu: '磁导率 H/m',
                  eps: '介电常数 F/m',
                },
                sample: { mu: 1.2566370614e-6, eps: 8.854187817e-12 },
                expected: Math.sqrt(1.2566370614e-6 / 8.854187817e-12),
                plainZh: '特征波阻抗等于磁导率除以介电常数再开方',
                plainEn: 'Wave impedance is the square root of μ over ε',
              },
            },
            {
              id: 'em-foundation-cfl',
              layer: 'foundation',
              titleZh: '基础：CFL 稳定条件',
              titleEn: 'Foundation: CFL stability',
              bodyZh:
                '三维均匀网格上 dt ≤ dx /(c √3) 量级；超 CFL 导致指数发散。工程 smoke 覆盖能量矩阵与 ABC。',
              bodyEn:
                '3D uniform grid: dt ≤ dx/(c√3) order; smoke covers energy + ABC.',
              formula: {
                expr: 'dt_max = dx / (c * sqrt(3))',
                vars: {
                  dt_max: '最大稳定时间步 s',
                  dx: '空间步 m',
                  c: '光速 m/s',
                },
                sample: { dx: 1e-3, c: 3e8 },
                expected: 1e-3 / (3e8 * Math.sqrt(3)),
                plainZh: '三维 Yee 网格稳定时间步上限约 dx/(c√3)',
                plainEn: '3D Yee stable dt upper bound is about dx/(c√3)',
              },
            },
          ],
        },
        {
          id: 'em-principle-bc',
          layer: 'principle',
          titleZh: '原理：PEC 与吸收边界',
          titleEn: 'Principle: PEC & absorbing BC',
          bodyZh:
            'PEC 切向 E=0 封闭腔体；Mur / CPML 等吸收层近似开放域。compose 金标常看闭腔能量保持与开域泄漏。',
          bodyEn:
            'PEC closes cavities; Mur/CPML approximate open domains.',
          children: [
            {
              id: 'em-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '线性各向同性介质、Yee 二阶精度；色散媒质、亚网格结构、非线性需扩展模型。遗留 fdtd-batch 为 smoke 壳，工程深度在 em-fdtd-3d。',
              bodyEn:
                'Linear isotropic Yee; dispersive/nonlinear need extensions; eng depth on em-fdtd-3d.',
            },
          ],
        },
        {
          id: 'em-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-em-fdtd',
          titleEn: 'Engineering: solvers-em-fdtd',
          bodyZh:
            'JobKind `em-fdtd-3d` 由 @w-sim/solvers-em-fdtd 拥有；经 kind-matrix 与 lab-kit 登记（ABC eng energy nona-dense CFL residual S27ci + deca-dense CFL residual S27cj landed 等 fixture）。**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn: 'Owned by @w-sim/solvers-em-fdtd; kind-matrix + lab-kit fixtures including ABC eng energy nona-dense CFL residual S27ci + deca-dense CFL residual S27cj landed; smoke residual expand ≠ eng DoD / Atlas graduation.',
          jobKinds: ['em-fdtd-3d'],
        },
        {
          id: 'em-compose-note',
          layer: 'compose',
          titleZh: '合成视角：Maxwell/Yee ∘ 边界条件 ≈ FDTD 方法',
          titleEn: 'Compose: Maxwell/Yee ∘ BC ≈ FDTD method',
          bodyZh:
            '科技树语义：更基础的「Yee/Maxwell（c、Z、CFL、λ、PPW、相速 ω/k、波数 k=ω/c）」与「PEC/ABC / 透射 / nona-dense CFL residual / deca-dense CFL residual」合成应在等价域复现顶层场/能量 KPI（平面波 E/H=Z、H=E/Z、能量密度与电能密度支路、坡印廷合同、CFL 安全比与 dt_max=dx/(c√3)、正入射反射/透射闭合、每波长点数、渡越时间、f=c/λ、nona-dense CFL 排序/plateau/MIN dual、deca-dense CFL 排序/plateau/MIN dual）。对应 principle-bridge `eq-em-yee-pec`；数值 residual tip 桥接 @w-sim/solvers-em-fdtd S27ci nona-dense CFL residual + S27cj deca-dense CFL residual（landed；下接 S27ck）——**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Composing Yee Maxwell (c,Z,CFL,λ,PPW, phase speed ω/k, k=ω/c) + BC/transmission + nona-dense CFL residual + deca-dense CFL residual should reproduce field/energy KPIs (E/H=Z, H=E/Z, energy density + electric branch, Poynting contract, CFL/dt_max from c, R/T closure, PPW, travel time, f=c/λ, nona-dense CFL ranking/plateau/MIN dual, deca-dense CFL ranking/plateau/MIN dual); see eq-em-yee-pec; bridges @w-sim/solvers-em-fdtd S27ci nona-dense CFL residual + S27cj deca-dense CFL residual (landed; next S27ck) — smoke residual expand ≠ eng DoD / Atlas graduation.',
          children: [
            {
              id: 'em-compose-plane-wave-zh',
              layer: 'foundation',
              titleZh: '合成：平面波 E/H = Z',
              titleEn: 'Compose: plane-wave E/H = Z',
              bodyZh:
                '把介质波阻抗 Z=√(μ/ε) 与场幅合成：均匀介质平面波 |E|/|H|≈Z。工程 smoke 常校验自由空间行波的 E/H 比与 Z₀ 一致。',
              bodyEn:
                'Composes medium Z with fields: progressive plane wave |E|/|H|≈Z; free-space smoke checks E/H vs Z₀.',
              formula: {
                expr: 'ratio = E / H',
                vars: {
                  ratio: '电场/磁场幅度比 Ω',
                  E: '电场幅度 V/m',
                  H: '磁场幅度 A/m',
                },
                sample: { E: 377, H: 1 },
                expected: 377,
                plainZh: '平面波电场与磁场幅度比等于波阻抗',
                plainEn: 'Plane-wave electric-to-magnetic amplitude ratio equals wave impedance',
              },
            },
            {
              id: 'em-compose-energy-density',
              layer: 'foundation',
              titleZh: '合成：电磁能量密度 u = ½(εE² + μH²)',
              titleEn: 'Compose: EM energy density u = ½(εE² + μH²)',
              bodyZh:
                '线性无损耗介质瞬时能量密度。闭腔 PEC 下积分 U=∫u dV 在离散能量守恒格式中近似守恒；开域 ABC 则允许能量泄漏。',
              bodyEn:
                'Instantaneous linear lossless energy density; cavity ∫u conserves under discrete energy forms; ABC allows leakage.',
              formula: {
                expr: 'u = 0.5 * (eps * E * E + mu * H * H)',
                vars: {
                  u: '电磁能量密度 J/m³',
                  eps: '介电常数 F/m',
                  E: '电场幅度 V/m',
                  mu: '磁导率 H/m',
                  H: '磁场幅度 A/m',
                },
                sample: {
                  eps: 8.854187817e-12,
                  E: Math.sqrt(2 / 8.854187817e-12),
                  mu: 1.2566370614e-6,
                  H: 0,
                },
                expected: 1,
                plainZh: '线性介质电磁能量密度为电场与磁场储能之和的一半',
                plainEn: 'Linear-media EM energy density is half the sum of electric and magnetic stored energy',
              },
            },
            {
              id: 'em-compose-cfl-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：CFL 安全比 s = dt / dt_max',
              titleEn: 'Compose KPI: CFL safety ratio s = dt / dt_max',
              bodyZh:
                '把时间步与 CFL 上限合成稳定裕度：s≤1 为稳定必要量级。算例 dt=1 ps、dx=1 mm、c=3e8 → s≪1。',
              bodyEn:
                'Composes chosen dt with CFL bound into safety ratio; s≤1 needed; sample dt=1ps on 1mm grid is ≪1.',
              formula: {
                expr: 's = dt / dt_max',
                vars: {
                  s: 'CFL 安全比 1',
                  dt: '实际时间步 s',
                  dt_max: 'CFL 最大稳定时间步 s',
                },
                sample: {
                  dt: 1e-12,
                  dt_max: 1e-3 / (3e8 * Math.sqrt(3)),
                },
                expected: 1e-12 / (1e-3 / (3e8 * Math.sqrt(3))),
                plainZh: 'CFL 安全比等于实际时间步除以稳定时间步上限',
                plainEn: 'CFL safety ratio is the chosen time step over the stability upper bound',
              },
            },
            {
              id: 'em-compose-reflection',
              layer: 'foundation',
              titleZh: '合成：正入射反射 R = (Z₂−Z₁)/(Z₂+Z₁)',
              titleEn: 'Compose: normal-incidence R = (Z₂−Z₁)/(Z₂+Z₁)',
              bodyZh:
                '把两侧波阻抗与边界语义合成：PEC 极限 Z₂→0 ⇒ R→−1（电场反相）；阻抗匹配 Z₂=Z₁ ⇒ R=0。连接 principle「介质 Z」与「PEC/ABC」。',
              bodyEn:
                'Composes two-sided Z with BC: PEC Z₂→0 ⇒ R→−1; matched Z₂=Z₁ ⇒ R=0; links medium Z to PEC/ABC.',
              formula: {
                expr: 'R = (Z2 - Z1) / (Z2 + Z1)',
                vars: {
                  R: '电压/电场反射系数 1',
                  Z1: '入射侧波阻抗 Ω',
                  Z2: '透射侧波阻抗 Ω',
                },
                sample: { Z1: 377, Z2: 0 },
                expected: -1,
                plainZh: '正入射反射系数由两侧波阻抗决定，PEC 极限为 −1',
                plainEn: 'Normal-incidence reflection from two impedances; PEC limit is −1',
              },
            },
            {
              id: 'em-compose-impedance-match',
              layer: 'foundation',
              titleZh: '合成：匹配校核 Z = √(μ/ε) 与 E/H',
              titleEn: 'Compose: match check Z=√(μ/ε) vs E/H',
              bodyZh:
                '介质公式 Z 与场比 E/H 应一致：残差 |E/H − Z|/|Z|。算例 E/H=Z 时残差为 0，构成 Maxwell 介质参数与场观测的合成合同。',
              bodyEn:
                'Medium Z and field ratio E/H must agree; residual |E/H−Z|/|Z|; sample matched → 0.',
              formula: {
                expr: 'res = abs(E / H - Z) / abs(Z)',
                vars: {
                  res: '阻抗匹配相对残差 1',
                  E: '电场幅度 V/m',
                  H: '磁场幅度 A/m',
                  Z: '介质波阻抗 Ω',
                },
                sample: { E: 377, H: 1, Z: 377 },
                expected: 0,
                plainZh: '平面波场比与介质波阻抗的相对残差在匹配时应为零',
                plainEn: 'Relative residual between field ratio and medium impedance is zero when matched',
              },
            },
            {
              id: 'em-compose-poynting',
              layer: 'foundation',
              titleZh: '合成：平面波坡印廷 S = E · H',
              titleEn: 'Compose: plane-wave Poynting S = E · H',
              bodyZh:
                '把 E 与 H 合成能流密度量级：均匀介质平面波 |S|≈|E||H|（时均另有 1/2 因子；教学用峰值乘积）。算例 E=377、H=1 → S=377 W/m²，并与 E²/Z 合同。',
              bodyEn:
                'Composes E,H into |S|≈|E||H| peak; sample 377 contracts with E²/Z.',
              formula: {
                expr: 'S = E * H',
                vars: {
                  S: '坡印廷能流密度量级 W/m²',
                  E: '电场幅度 V/m',
                  H: '磁场幅度 A/m',
                },
                sample: { E: 377, H: 1 },
                expected: 377,
                plainZh: '平面波坡印廷能流密度量级等于电场与磁场幅度之积',
                plainEn: 'Plane-wave Poynting magnitude is the product of electric and magnetic amplitudes',
              },
            },
            {
              id: 'em-compose-S-from-EZ',
              layer: 'foundation',
              titleZh: '合成：S = E² / Z 与 E·H 合同',
              titleEn: 'Compose: S = E²/Z contracts with E·H',
              bodyZh:
                '介质阻抗 Z 与电场合成能流：S=E²/Z；当 H=E/Z 时与 E·H 一致。算例 E=377、Z=377 → S=377。',
              bodyEn:
                'S=E²/Z matches E·H when H=E/Z; sample E=Z=377 → S=377.',
              formula: {
                expr: 'S = E * E / Z',
                vars: {
                  S: '坡印廷能流密度量级 W/m²',
                  E: '电场幅度 V/m',
                  Z: '波阻抗 Ω',
                },
                sample: { E: 377, Z: 377 },
                expected: 377,
                plainZh: '平面波能流可由电场平方除以波阻抗合成，并与 E·H 合同',
                plainEn: 'Plane-wave power flux composes as E squared over impedance, matching E·H',
              },
            },
            {
              id: 'em-compose-wavelength',
              layer: 'foundation',
              titleZh: '合成：波长 λ = c / f',
              titleEn: 'Compose: wavelength λ = c / f',
              bodyZh:
                '把介质光速 c=1/√(με) 与激励频率合成波长，决定每波长网格点数 N_λ=λ/dx（色散/精度 KPI）。算例 c=3e8、f=1e9 → λ=0.3 m。',
              bodyEn:
                'Composes medium c and drive frequency into λ; sets points-per-wavelength KPI; sample 0.3 m at 1 GHz.',
              formula: {
                expr: 'lambda = c / f',
                vars: {
                  lambda: '波长 m',
                  c: '光速 m/s',
                  f: '频率 Hz',
                },
                sample: { c: 3e8, f: 1e9 },
                expected: 0.3,
                plainZh: '波长等于介质光速除以激励频率',
                plainEn: 'Wavelength is medium wave speed over drive frequency',
              },
            },
            {
              id: 'em-compose-dt-max-from-mu-eps',
              layer: 'foundation',
              titleZh: '合成：dt_max = dx √(μ ε) / √3',
              titleEn: 'Compose: dt_max = dx √(μ ε) / √3',
              bodyZh:
                '把介质 μ、ε 与网格 dx 直接合成 CFL 上限：c=1/√(με) ⇒ dt_max=dx/(c√3)=dx√(με)/√3。算例真空 μ0、ε0、dx=1 mm。',
              bodyEn:
                'Composes μ,ε,dx into 3D CFL bound without intermediate c; vacuum sample on 1 mm grid.',
              formula: {
                expr: 'dt_max = dx * sqrt(mu * eps) / sqrt(3)',
                vars: {
                  dt_max: '最大稳定时间步 s',
                  dx: '空间步 m',
                  mu: '磁导率 H/m',
                  eps: '介电常数 F/m',
                },
                sample: {
                  dx: 1e-3,
                  mu: 1.2566370614e-6,
                  eps: 8.854187817e-12,
                },
                expected:
                  (1e-3 * Math.sqrt(1.2566370614e-6 * 8.854187817e-12)) /
                  Math.sqrt(3),
                plainZh: '三维 Yee 稳定时间步上限由网格与介质 μ、ε 直接合成',
                plainEn:
                  '3D Yee stable dt upper bound composes grid spacing with medium μ and ε',
              },
            },
            {
              id: 'em-compose-Z-from-mu-eps',
              layer: 'foundation',
              titleZh: '合成：Z = √(μ/ε) 与平面波 E/H',
              titleEn: 'Compose: Z = √(μ/ε) with plane-wave E/H',
              bodyZh:
                '介质参数合成波阻抗，再与场观测并置：Z_med=√(μ/ε) 应等于 E/H。算例真空 μ0/ε0 → Z≈376.7 Ω。',
              bodyEn:
                'Composes medium Z from μ,ε to match E/H; vacuum sample ≈376.7 Ω.',
              formula: {
                expr: 'Z = sqrt(mu / eps)',
                vars: {
                  Z: '波阻抗 Ω',
                  mu: '磁导率 H/m',
                  eps: '介电常数 F/m',
                },
                sample: { mu: 1.2566370614e-6, eps: 8.854187817e-12 },
                expected: Math.sqrt(1.2566370614e-6 / 8.854187817e-12),
                plainZh: '波阻抗由磁导率与介电常数之比开方合成，应对齐平面波 E/H',
                plainEn:
                  'Wave impedance composes as sqrt(μ/ε) and should align with plane-wave E/H',
              },
            },
            {
              id: 'em-compose-c-from-mu-eps',
              layer: 'foundation',
              titleZh: '合成：c = 1/√(μ ε) 入波推进链',
              titleEn: 'Compose: c = 1/√(μ ε) into march chain',
              bodyZh:
                '介质 μ、ε 合成相速 c，再进入 CFL、波长与渡越时间。算例真空 μ0、ε0 → c≈2.998×10⁸ m/s。',
              bodyEn:
                'Composes phase speed c from μ,ε into CFL/λ/travel chains; vacuum sample ≈2.998e8 m/s.',
              formula: {
                expr: 'c = 1 / sqrt(mu * eps)',
                vars: {
                  c: '光速 m/s',
                  mu: '磁导率 H/m',
                  eps: '介电常数 F/m',
                },
                sample: { mu: 1.2566370614e-6, eps: 8.854187817e-12 },
                expected: 1 / Math.sqrt(1.2566370614e-6 * 8.854187817e-12),
                plainZh: '电磁波速由磁导率与介电常数乘积开方的倒数合成，进入 CFL 与波长链',
                plainEn:
                  'EM wave speed composes as 1/√(με) into CFL and wavelength chains',
              },
            },
            {
              id: 'em-compose-H-from-EZ',
              layer: 'foundation',
              titleZh: '合成：H = E / Z 平面波磁场',
              titleEn: 'Compose: H = E / Z plane-wave magnetic field',
              bodyZh:
                '把电场与波阻抗合成磁场：H=E/Z，再与 E/H=Z、S=E·H 合同。算例 E=377、Z=377 → H=1 A/m。',
              bodyEn:
                'Composes H=E/Z from E and Z; contracts with E/H=Z and S=E·H; sample H=1 A/m.',
              formula: {
                expr: 'H = E / Z',
                vars: {
                  H: '磁场幅度 A/m',
                  E: '电场幅度 V/m',
                  Z: '波阻抗 Ω',
                },
                sample: { E: 377, Z: 377 },
                expected: 1,
                plainZh: '平面波磁场幅度由电场除以波阻抗合成',
                plainEn: 'Plane-wave magnetic amplitude composes as electric field over impedance',
              },
            },
            {
              id: 'em-compose-transmission',
              layer: 'foundation',
              titleZh: '合成：正入射压力/电场透射 T = 2 Z₂ / (Z₁ + Z₂)',
              titleEn: 'Compose: normal-incidence T = 2 Z₂ / (Z₁ + Z₂)',
              bodyZh:
                '把两侧波阻抗合成透射系数；匹配 Z₂=Z₁ ⇒ T=1；PEC Z₂→0 ⇒ T→0。与反射 R 并置构成界面合同。算例 Z1=Z2=377 → T=1。',
              bodyEn:
                'Composes two-sided Z into T; matched →1, PEC →0; sits with R as interface contract; sample T=1.',
              formula: {
                expr: 'T = 2 * Z2 / (Z1 + Z2)',
                vars: {
                  T: '电场透射系数 1',
                  Z1: '入射侧波阻抗 Ω',
                  Z2: '透射侧波阻抗 Ω',
                },
                sample: { Z1: 377, Z2: 377 },
                expected: 1,
                plainZh: '正入射透射系数由两侧波阻抗合成，匹配时为 1',
                plainEn:
                  'Normal-incidence transmission composes from two impedances; matched limit is 1',
              },
            },
            {
              id: 'em-compose-RT-closure',
              layer: 'foundation',
              titleZh: '合成 KPI：反射–透射闭合 1 + R − T = 0',
              titleEn: 'Compose KPI: reflection–transmission closure 1 + R − T = 0',
              bodyZh:
                '正入射电压/电场系数合同：T = 1 + R。算例 R=0、T=1 → 残差 0；PEC R=−1、T=0 亦闭合。',
              bodyEn:
                'Normal-incidence contract T=1+R; sample matched residual 0; PEC R=−1,T=0 also closes.',
              formula: {
                expr: 'res = abs(1 + R - T)',
                vars: {
                  res: '反射–透射闭合绝对残差 1',
                  R: '反射系数 1',
                  T: '透射系数 1',
                },
                sample: { R: 0, T: 1 },
                expected: 0,
                plainZh: '正入射反射与透射闭合时 1+R−T 残差应为零',
                plainEn:
                  'Reflection–transmission closure residual 1+R−T is zero when the interface contract holds',
              },
            },
            {
              id: 'em-compose-ppw',
              layer: 'foundation',
              titleZh: '合成 KPI：每波长点数 N_λ = λ / dx',
              titleEn: 'Compose KPI: points per wavelength N_λ = λ / dx',
              bodyZh:
                '把波长与网格步合成分辨率 KPI；工程常要求 N_λ ≳ 10–20 以控数值色散。算例 λ=0.3 m、dx=0.01 m → N_λ=30。',
              bodyEn:
                'Composes λ and dx into resolution KPI; engineering often wants N_λ ≳ 10–20; sample 30.',
              formula: {
                expr: 'N_lambda = lambda / dx',
                vars: {
                  N_lambda: '每波长网格点数 1',
                  lambda: '波长 m',
                  dx: '空间步 m',
                },
                sample: { lambda: 0.3, dx: 0.01 },
                expected: 30,
                plainZh: '每波长点数等于波长除以网格步，衡量 FDTD 空间分辨率',
                plainEn:
                  'Points per wavelength is λ over grid spacing, measuring FDTD spatial resolution',
              },
            },
            {
              id: 'em-compose-travel-time',
              layer: 'foundation',
              titleZh: '合成：渡越时间 τ = L / c',
              titleEn: 'Compose: travel time τ = L / c',
              bodyZh:
                '把路径长度与介质光速合成渡越时间，供时窗/测距 KPI。算例 L=0.3 m、c=3e8 → τ=1 ns。',
              bodyEn:
                'Composes path length and medium c into travel time for window/ranging KPIs; sample 1 ns.',
              formula: {
                expr: 'tau = L / c',
                vars: {
                  tau: '渡越时间 s',
                  L: '路径长度 m',
                  c: '光速 m/s',
                },
                sample: { L: 0.3, c: 3e8 },
                expected: 1e-9,
                plainZh: '渡越时间等于路径长度除以介质光速',
                plainEn: 'Travel time is path length over medium wave speed',
              },
            },
            {
              id: 'em-compose-S-match-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：坡印廷合同残差 |E·H − E²/Z| / |E·H|',
              titleEn: 'Compose KPI: Poynting contract residual |E·H − E²/Z| / |E·H|',
              bodyZh:
                '平面波两套能流合成应一致：S_EH=E·H 与 S_EZ=E²/Z。匹配 H=E/Z 时相对残差为 0。算例 E=377、H=1、Z=377。',
              bodyEn:
                'Two Poynting compositions must agree; residual 0 when H=E/Z; sample matched free-space numbers.',
              formula: {
                expr: 'res = abs(E * H - E * E / Z) / abs(E * H)',
                vars: {
                  res: '坡印廷合同相对残差 1',
                  E: '电场幅度 V/m',
                  H: '磁场幅度 A/m',
                  Z: '波阻抗 Ω',
                },
                sample: { E: 377, H: 1, Z: 377 },
                expected: 0,
                plainZh: '平面波 E·H 与 E²/Z 两套能流合成的相对残差在匹配时应为零',
                plainEn:
                  'Relative residual between E·H and E²/Z Poynting compositions is zero when matched',
              },
            },
            {
              id: 'em-compose-phase-speed',
              layer: 'foundation',
              titleZh: '合成：相速 c_p = ω / k',
              titleEn: 'Compose: phase speed c_p = ω / k',
              bodyZh:
                '把角频率与波数合成相速：无色散介质 c_p=ω/k 应等于介质光速 c。算例 ω=2π·1e9、k=ω/3e8 → c_p=3e8，闭合 wavelength 与 c-from-μ-ε 链。',
              bodyEn:
                'Composes ω and k into phase speed; non-dispersive c_p=ω/k equals medium c; sample 3e8 m/s.',
              formula: {
                expr: 'c_p = omega / k',
                vars: {
                  c_p: '相速 m/s',
                  omega: '角频率 rad/s',
                  k: '波数 1/m',
                },
                sample: {
                  omega: 2 * Math.PI * 1e9,
                  k: (2 * Math.PI * 1e9) / 3e8,
                },
                expected: 3e8,
                plainZh: '无色散介质电磁波相速由角频率除以波数合成，应等于介质光速',
                plainEn:
                  'Non-dispersive EM phase speed composes as angular frequency over wavenumber and equals medium wave speed',
              },
            },
            {
              id: 'em-compose-freq-from-lambda',
              layer: 'foundation',
              titleZh: '合成：频率 f = c / λ',
              titleEn: 'Compose: frequency f = c / λ',
              bodyZh:
                '把介质光速与波长合成频率：f=c/λ，与 λ=c/f、N_λ=λ/dx 同链。算例 c=3e8、λ=0.3 → f=1e9 Hz，对接 wavelength 与 ppw KPI。',
              bodyEn:
                'Composes c and λ into f=c/λ; sample 3e8/0.3 → 1 GHz; links wavelength and PPW.',
              formula: {
                expr: 'f = c / lambda',
                vars: {
                  f: '频率 Hz',
                  c: '光速 m/s',
                  lambda: '波长 m',
                },
                sample: { c: 3e8, lambda: 0.3 },
                expected: 1e9,
                plainZh: '电磁波频率由介质光速除以波长合成',
                plainEn: 'EM frequency composes as medium wave speed over wavelength',
              },
            },
            {
              id: 'em-compose-dt-max-from-c',
              layer: 'foundation',
              titleZh: '合成：CFL 上界 dt_max = dx / (c √3) 入安全比',
              titleEn: 'Compose: CFL bound dt_max = dx / (c √3) into safety ratio',
              bodyZh:
                '网格与介质光速先合成 3D Yee 上界 dt_max=dx/(c√3)，再与实际 dt 合成安全比 s=dt/dt_max。与 dt-max-from-μ-ε 对偶（c=1/√(με)）。算例 dx=1 mm、c=3e8。',
              bodyEn:
                'Composes dx and c into 3D Yee dt_max upstream of s=dt/dt_max; dual of dt-max-from-μ-ε; sample dx=1e-3, c=3e8.',
              formula: {
                expr: 'dt_max = dx / (c * sqrt(3))',
                vars: {
                  dt_max: '最大稳定时间步 s',
                  dx: '空间步 m',
                  c: '光速 m/s',
                },
                sample: { dx: 1e-3, c: 3e8 },
                expected: 1e-3 / (3e8 * Math.sqrt(3)),
                plainZh: '三维 Yee 稳定时间步上界由网格间距除以光速再除以√3 合成',
                plainEn:
                  'Three-dimensional Yee max stable time step composes as grid spacing over c times √3',
              },
            },
            {
              id: 'em-compose-k-from-omega',
              layer: 'foundation',
              titleZh: '合成：波数 k = ω / c 入相速链',
              titleEn: 'Compose: wavenumber k = ω / c into phase-speed chain',
              bodyZh:
                '把角频率与介质光速合成波数 k=ω/c，再入 c_p=ω/k 与 λ=2π/k。算例 ω=2π·1e9、c=3e8 → k=ω/c，与 phase-speed 对偶闭合。',
              bodyEn:
                'Composes ω and c into k=ω/c upstream of phase speed and λ=2π/k; sample 1 GHz free-space.',
              formula: {
                expr: 'k = omega / c',
                vars: {
                  k: '波数 1/m',
                  omega: '角频率 rad/s',
                  c: '光速 m/s',
                },
                sample: { omega: 2 * Math.PI * 1e9, c: 3e8 },
                expected: (2 * Math.PI * 1e9) / 3e8,
                plainZh: '电磁波数由角频率除以介质光速合成，作为相速与波长上游',
                plainEn:
                  'EM wavenumber composes as angular frequency over medium wave speed upstream of phase speed and wavelength',
              },
            },
            {
              id: 'em-compose-u-electric',
              layer: 'foundation',
              titleZh: '合成：电能密度 u_e = ½ ε E²',
              titleEn: 'Compose: electric energy density u_e = ½ ε E²',
              bodyZh:
                '把介电常数与电场合成电场储能密度支路 u_e=½εE²，与总能 u=½(εE²+μH²) 同核。算例 ε=ε0、E=√(2/ε0) → u_e=1 J/m³（纯电场瞬间）。',
              bodyEn:
                'Composes ε and E into electric stored-energy branch; sample free-space E chosen so u_e=1 J/m³.',
              formula: {
                expr: 'u_e = 0.5 * eps * E * E',
                vars: {
                  u_e: '电场能量密度 J/m³',
                  eps: '介电常数 F/m',
                  E: '电场幅度 V/m',
                },
                sample: {
                  eps: 8.854187817e-12,
                  E: Math.sqrt(2 / 8.854187817e-12),
                },
                expected: 1,
                plainZh: '线性介质电场能量密度等于介电常数乘电场平方的一半',
                plainEn:
                  'Linear-media electric energy density is half permittivity times electric field squared',
              },
            },
            {
              id: 'em-compose-omega-from-f',
              layer: 'foundation',
              titleZh: '合成：角频率 ω = 2 π f 入色散链',
              titleEn: 'Compose: angular frequency ω = 2 π f into dispersion chain',
              bodyZh:
                '把激励频率合成角频率 ω=2πf，再进入 k=ω/c 与相速 ω/k。算例 f=1e9 → ω=2π×1e9，对接 wavelength 与 phase-speed。',
              bodyEn:
                'Composes drive frequency into ω=2πf upstream of k and phase speed; sample 1 GHz.',
              formula: {
                expr: 'omega = 2 * pi * f',
                vars: {
                  omega: '角频率 rad/s',
                  pi: '圆周率',
                  f: '频率 Hz',
                },
                sample: { pi: Math.PI, f: 1e9 },
                expected: 2 * Math.PI * 1e9,
                plainZh: '角频率由激励频率乘以 2π 合成，进入波数与相速链',
                plainEn:
                  'Angular frequency composes as 2π times drive frequency into wavenumber and phase-speed chains',
              },
            },

            // S27ci nona-dense CFL residual + twenty-fourth dual grid ranking + nona-long MIN dual (wave35 residual compose expand; solvers tip landed)
            {
              id: 'em-compose-nona-dense-cfl-span',
              layer: 'foundation',
              titleZh: '合成 KPI：nona-dense CFL 样本跨度 residual',
              titleEn: 'Compose KPI: nona-dense CFL sample span residual',
              bodyZh:
                'S27ci（landed）：nona-dense CFL half/quarter-steps 相对 octa 集的扩展跨度文档 KPI。算例 cfl_hi−cfl_lo 示意 0.85−0.55=0.30；桥接 NONA_DENSE_CFL residual samples。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S27ci (landed) nona-dense CFL half/quarter-steps span doc KPI beyond octa set; sample 0.85−0.55=0.30; bridges NONA_DENSE_CFL residual samples; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'span = cfl_hi - cfl_lo',
                vars: {
                  span: 'nona-dense CFL 跨度 1',
                  cfl_hi: '高 CFL 样本',
                  cfl_lo: '低 CFL 样本',
                },
                sample: { cfl_hi: 0.85, cfl_lo: 0.55 },
                expected: 0.3,
                plainZh: 'nona-dense CFL 跨度等于高 CFL 样本减去低 CFL 样本',
                plainEn:
                  'Nona-dense CFL span is the high CFL sample minus the low CFL sample',
              },
            },
            {
              id: 'em-compose-nona-dense-ranking-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：nona-dense ranking honesty residual',
              titleEn: 'Compose KPI: nona-dense ranking honesty residual',
              bodyZh:
                'S27ci twenty-fourth dual residual cube ranking：ABC eng 能量排序在 nona-dense CFL 上应独立成立。匹配诚实排序 → residual 0。算例 rank_ok=1 → 0。',
              bodyEn:
                'S27ci twenty-fourth dual residual cube ranking: ABC eng energy order must hold independently at each nona-dense CFL; honest → residual 0; sample rank_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - rank_ok',
                vars: {
                  res: 'nona-dense ranking 诚实残差 1',
                  rank_ok: '排序成立标志 0/1',
                },
                sample: { rank_ok: 1 },
                expected: 0,
                plainZh: 'nona-dense ranking 诚实残差在排序成立时为零',
                plainEn:
                  'Nona-dense ranking honesty residual is zero when ranking holds',
              },
            },
            {
              id: 'em-compose-nona-long-min-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：nona-long eng MIN dual residual',
              titleEn: 'Compose KPI: nona-long eng MIN dual residual',
              bodyZh:
                'S27ci nona-long（2× nSteps）eng MIN dual of MAX：长跑下 MIN/MAX 对偶地板成立。匹配 → residual 0。算例 dual_ok=1 → 0；桥接 yee3dAbcEnergyNonaLongMinDualHolds。',
              bodyEn:
                'S27ci nona-long (2× nSteps) eng MIN dual of MAX floors hold on long run; matched → residual 0; sample dual_ok=1 → 0; bridges yee3dAbcEnergyNonaLongMinDualHolds.',
              formula: {
                expr: 'res = 1 - dual_ok',
                vars: {
                  res: 'nona-long MIN dual 诚实残差 1',
                  dual_ok: 'MIN dual 成立标志 0/1',
                },
                sample: { dual_ok: 1 },
                expected: 0,
                plainZh: 'nona-long eng MIN dual 诚实残差在对偶地板成立时为零',
                plainEn:
                  'Nona-long eng MIN dual honesty residual is zero when dual floors hold',
              },
            },
            {
              id: 'em-compose-nona-dense-plateau-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：nona-dense plateau honesty residual',
              titleEn: 'Compose KPI: nona-dense plateau honesty residual',
              bodyZh:
                'S27ci nona-dense multi-CFL plateau honesty：相邻 CFL eng 保留应平台稳定。匹配 → 0。算例 plateau_ok=1 → 0。',
              bodyEn:
                'S27ci nona-dense multi-CFL plateau honesty: adjacent CFL eng retention should plateau; matched → 0; sample plateau_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - plateau_ok',
                vars: {
                  res: 'nona-dense plateau 诚实残差 1',
                  plateau_ok: '平台诚实标志 0/1',
                },
                sample: { plateau_ok: 1 },
                expected: 0,
                plainZh: 'nona-dense plateau 诚实残差在平台成立时为零',
                plainEn:
                  'Nona-dense plateau honesty residual is zero when plateau honesty holds',
              },
            },
            {
              id: 'em-compose-nona-dense-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：nonaDenseHonest 联合门（0/1）',
              titleEn: 'Compose KPI: nonaDenseHonest joint gate (0/1)',
              bodyZh:
                'S27ci packaging：ranking 诚实 ∧ nona-long MIN dual ∧ plateau 诚实。教学金标 → 1（下接 S27cj deca-dense landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S27ci packaging: ranking honest ∧ nona-long MIN dual ∧ plateau honest; honest gold → 1 (next S27cj deca-dense landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_rank * c_dual * c_plat',
                vars: {
                  gate: 'nona-dense 包装诚实门 0/1',
                  c_rank: 'ranking 诚实 0/1',
                  c_dual: 'nona-long MIN dual 诚实 0/1',
                  c_plat: 'plateau 诚实 0/1',
                },
                sample: { c_rank: 1, c_dual: 1, c_plat: 1 },
                expected: 1,
                plainZh: 'nona-dense 包装诚实门为三个子诚实标志之积，全真时为 1',
                plainEn:
                  'Nona-dense packaging honesty gate is the product of three sub-honesty flags; all-true yields 1',
              },
            },

            // S27cj deca-dense CFL residual + twenty-fifth dual grid ranking + deca-long MIN dual (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'em-compose-deca-dense-cfl-span',
              layer: 'foundation',
              titleZh: '合成 KPI：deca-dense CFL 样本跨度 residual',
              titleEn: 'Compose KPI: deca-dense CFL sample span residual',
              bodyZh:
                'S27cj（landed）：deca-dense CFL half/quarter-steps 相对 nona 集的扩展跨度文档 KPI。算例 cfl_hi−cfl_lo 示意 0.85−0.55=0.30；桥接 DECA_DENSE_CFL residual samples。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S27cj (landed) deca-dense CFL half/quarter-steps span doc KPI beyond nona set; sample 0.85−0.55=0.30; bridges DECA_DENSE_CFL residual samples; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'span = cfl_hi - cfl_lo',
                vars: {
                  span: 'deca-dense CFL 跨度 1',
                  cfl_hi: '高 CFL 样本',
                  cfl_lo: '低 CFL 样本',
                },
                sample: { cfl_hi: 0.85, cfl_lo: 0.55 },
                expected: 0.3,
                plainZh: 'deca-dense CFL 跨度等于高 CFL 样本减去低 CFL 样本',
                plainEn:
                  'Deca-dense CFL span is the high CFL sample minus the low CFL sample',
              },
            },
            {
              id: 'em-compose-deca-dense-ranking-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：deca-dense ranking honesty residual',
              titleEn: 'Compose KPI: deca-dense ranking honesty residual',
              bodyZh:
                'S27cj twenty-fifth dual residual cube ranking：ABC eng 能量排序在 deca-dense CFL 上应独立成立。匹配诚实排序 → residual 0。算例 rank_ok=1 → 0。',
              bodyEn:
                'S27cj twenty-fifth dual residual cube ranking: ABC eng energy order must hold independently at each deca-dense CFL; honest → residual 0; sample rank_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - rank_ok',
                vars: {
                  res: 'deca-dense ranking 诚实残差 1',
                  rank_ok: '排序成立标志 0/1',
                },
                sample: { rank_ok: 1 },
                expected: 0,
                plainZh: 'deca-dense ranking 诚实残差在排序成立时为零',
                plainEn:
                  'Deca-dense ranking honesty residual is zero when ranking holds',
              },
            },
            {
              id: 'em-compose-deca-long-min-dual',
              layer: 'foundation',
              titleZh: '合成 KPI：deca-long eng MIN dual residual',
              titleEn: 'Compose KPI: deca-long eng MIN dual residual',
              bodyZh:
                'S27cj deca-long（2× nSteps）eng MIN dual of MAX：长跑下 MIN/MAX 对偶地板成立。匹配 → residual 0。算例 dual_ok=1 → 0；桥接 yee3dAbcEnergyDecaLongMinDualHolds。',
              bodyEn:
                'S27cj deca-long (2× nSteps) eng MIN dual of MAX floors hold on long run; matched → residual 0; sample dual_ok=1 → 0; bridges yee3dAbcEnergyDecaLongMinDualHolds.',
              formula: {
                expr: 'res = 1 - dual_ok',
                vars: {
                  res: 'deca-long MIN dual 诚实残差 1',
                  dual_ok: 'MIN dual 成立标志 0/1',
                },
                sample: { dual_ok: 1 },
                expected: 0,
                plainZh: 'deca-long eng MIN dual 诚实残差在对偶地板成立时为零',
                plainEn:
                  'Deca-long eng MIN dual honesty residual is zero when dual floors hold',
              },
            },
            {
              id: 'em-compose-deca-dense-plateau-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：deca-dense plateau honesty residual',
              titleEn: 'Compose KPI: deca-dense plateau honesty residual',
              bodyZh:
                'S27cj deca-dense multi-CFL plateau honesty：相邻 CFL eng 保留应平台稳定。匹配 → 0。算例 plateau_ok=1 → 0。',
              bodyEn:
                'S27cj deca-dense multi-CFL plateau honesty: adjacent CFL eng retention should plateau; matched → 0; sample plateau_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - plateau_ok',
                vars: {
                  res: 'deca-dense plateau 诚实残差 1',
                  plateau_ok: '平台诚实标志 0/1',
                },
                sample: { plateau_ok: 1 },
                expected: 0,
                plainZh: 'deca-dense plateau 诚实残差在平台成立时为零',
                plainEn:
                  'Deca-dense plateau honesty residual is zero when plateau honesty holds',
              },
            },
            {
              id: 'em-compose-deca-dense-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：decaDenseHonest 联合门（0/1）',
              titleEn: 'Compose KPI: decaDenseHonest joint gate (0/1)',
              bodyZh:
                'S27cj packaging：ranking 诚实 ∧ deca-long MIN dual ∧ plateau 诚实。教学金标 → 1（下接 S27ck）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S27cj packaging: ranking honest ∧ deca-long MIN dual ∧ plateau honest; honest gold → 1 (next S27ck); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_rank * c_dual * c_plat',
                vars: {
                  gate: 'deca-dense 包装诚实门 0/1',
                  c_rank: 'ranking 诚实 0/1',
                  c_dual: 'deca-long MIN dual 诚实 0/1',
                  c_plat: 'plateau 诚实 0/1',
                },
                sample: { c_rank: 1, c_dual: 1, c_plat: 1 },
                expected: 1,
                plainZh: 'deca-dense 包装诚实门为三个子诚实标志之积，全真时为 1',
                plainEn:
                  'Deca-dense packaging honesty gate is the product of three sub-honesty flags; all-true yields 1',
              },
            },
          ],
        },
        {
          id: 'em-L0',
          layer: 'L0',
          titleZh: 'L0：FDTD / 波教学叶子',
          titleEn: 'L0: FDTD / wave teaching',
          bodyZh:
            'WaveWorld /fdtd 等页可承载教学演示；不计入 engineering DoD。',
          bodyEn: 'Teaching /fdtd pages allowed; not engineering DoD credit.',
        },
      ],
    },
  }
