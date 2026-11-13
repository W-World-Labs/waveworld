import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_ACOUSTICS_3D: CalculationMethod = {
    id: 'kind-acoustics-3d',
    titleZh: '声学平面波（工程 kind）',
    titleEn: 'Acoustics plane wave (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind acoustics-3d：线性声学平面波 / 时域推进工程路径；教学可落到波速与阻抗基础式。',
    summaryEn:
      'W-Sim kind acoustics-3d: linear acoustics plane-wave path; drills to sound speed and impedance.',
    jobKinds: ['acoustics-3d'],
    explainRoot: {
      id: 'acoustics-root',
      layer: 'method',
      titleZh: '方法：声学 3D / 平面波',
      titleEn: 'Method: acoustics-3d / plane wave',
      bodyZh:
        '顶层工程计算方法：在均匀介质中推进线性声波（平面波/弱散射量级），输出压力/质点速度场与传播 KPI。数值实现归 @w-sim/solvers-acoustics。',
      bodyEn:
        'Advances linear sound in uniform media; owned by @w-sim/solvers-acoustics.',
      jobKinds: ['acoustics-3d'],
      children: [
        {
          id: 'acoustics-principle-planewave',
          layer: 'principle',
          titleZh: '原理：线性平面波',
          titleEn: 'Principle: linear plane wave',
          bodyZh:
            '小扰动下压力与密度扰动满足一维波动方程；单色平面波解 p ∝ Re{ exp(j(ωt − k·x)) }，色散关系 ω = c |k|（无耗散）。',
          bodyEn:
            'Small-signal pressure obeys the wave equation; monochromatic plane waves satisfy ω = c |k|.',
          children: [
            {
              id: 'acoustics-foundation-c',
              layer: 'foundation',
              titleZh: '基础式：声速 c = √(K/ρ)',
              titleEn: 'Foundation: c = √(K/ρ)',
              bodyZh:
                '体积模量 K 与质量密度 ρ 决定小振幅声速。理想气体常写 c = √(γ P/ρ)。要求 K>0、ρ>0。',
              bodyEn:
                'Bulk modulus K and density ρ set small-signal sound speed; ideal gas c=√(γP/ρ).',
              formula: {
                expr: 'c = sqrt(K / rho)',
                vars: {
                  c: '声速 m/s',
                  K: '体积模量 Pa',
                  rho: '质量密度 kg/m³',
                },
                sample: { K: 2.2e9, rho: 1000 },
                expected: Math.sqrt(2.2e9 / 1000),
                plainZh: '声速等于体积模量除以密度再开方',
                plainEn: 'Sound speed is the square root of bulk modulus over density',
              },
            },
            {
              id: 'acoustics-foundation-impedance',
              layer: 'foundation',
              titleZh: '基础式：特征阻抗 Z = ρ c',
              titleEn: 'Foundation: Z = ρ c',
              bodyZh:
                '正向行波中 p / v_n ≈ Z。界面反射/透射由两侧 Z 失配决定；工程边界常给吸声或硬壁近似。',
              bodyEn:
                'For progressive waves p/v_n ≈ Z; impedance mismatch sets reflection.',
              formula: {
                expr: 'Z = rho * c',
                vars: {
                  Z: '特征阻抗 Pa·s/m',
                  rho: '质量密度 kg/m³',
                  c: '声速 m/s',
                },
                sample: { rho: 1.2, c: 340 },
                expected: 408,
                plainZh: '特征阻抗等于密度乘声速',
                plainEn: 'Characteristic impedance is density times sound speed',
              },
            },
            {
              id: 'acoustics-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '线性、各向同性、弱粘滞耗散可忽略的量级；大振幅、空化、强剪切边界层需更高阶模型。工程 smoke 覆盖均匀介质平面波相位与能量流符号。',
              bodyEn:
                'Linear isotropic media; large amplitude / cavitation need higher-order models.',
            },
          ],
        },
        {
          id: 'acoustics-principle-wave-eq',
          layer: 'principle',
          titleZh: '原理：波动方程与时域推进',
          titleEn: 'Principle: wave equation & time march',
          bodyZh:
            '从连续方程 + 动量方程 + 状态关系消去得到 ∂²p/∂t² = c² ∇²p。时域格式（FDTD/有限体积等）在 CFL 约束下推进。',
          bodyEn:
            'Continuity + momentum + EOS → wave equation; time schemes march under CFL.',
          children: [
            {
              id: 'acoustics-foundation-k',
              layer: 'foundation',
              titleZh: '基础：波数 k = ω / c',
              titleEn: 'Foundation: k = ω / c',
              bodyZh: '无色散介质中波长 λ = 2π/k = 2π c / ω；网格分辨率常按每波长点数约束。',
              bodyEn: 'Non-dispersive: λ = 2π c / ω; mesh resolution often points-per-wavelength.',
              formula: {
                expr: 'k = omega / c',
                vars: {
                  k: '波数 1/m',
                  omega: '角频率 rad/s',
                  c: '声速 m/s',
                },
                sample: { omega: 2 * Math.PI * 1000, c: 340 },
                expected: (2 * Math.PI * 1000) / 340,
                plainZh: '波数等于角频率除以声速',
                plainEn: 'Wavenumber is angular frequency over sound speed',
              },
            },
            {
              id: 'acoustics-foundation-period',
              layer: 'foundation',
              titleZh: '基础：周期 T = 2π / ω',
              titleEn: 'Foundation: period T = 2π / ω',
              bodyZh:
                '单色波时间周期与角频率互逆：T = 2π/ω = 1/f。与 k=ω/c 合成为相速 c = λ/T。',
              bodyEn:
                'Monochromatic period T=2π/ω=1/f; with k=ω/c yields phase speed c=λ/T.',
              formula: {
                expr: 'T = 2 * pi / omega',
                vars: {
                  T: '周期 s',
                  pi: '圆周率',
                  omega: '角频率 rad/s',
                },
                sample: { pi: Math.PI, omega: 2 * Math.PI * 1000 },
                expected: 0.001,
                plainZh: '声波周期等于二π除以角频率',
                plainEn: 'Acoustic period is 2π over angular frequency',
              },
            },
            {
              id: 'acoustics-foundation-dt-max',
              layer: 'foundation',
              titleZh: '基础：1D 声学 CFL 上界 dt_max ≈ dx / c',
              titleEn: 'Foundation: 1D acoustic CFL bound dt_max ≈ dx / c',
              bodyZh:
                '显式时域推进在 1D 量级要求信息在一个时间步内不超过一格：dt ≤ dx/c。多维再乘 1/√d 量级因子；工程 compose 用安全比 s=dt/dt_max。',
              bodyEn:
                'Explicit 1D CFL: dt ≤ dx/c; multi-D adds ~1/√d; compose uses safety ratio s=dt/dt_max.',
              formula: {
                expr: 'dt_max = dx / c',
                vars: {
                  dt_max: '最大稳定时间步 s',
                  dx: '网格间距 m',
                  c: '声速 m/s',
                },
                sample: { dx: 1e-3, c: 340 },
                expected: 1e-3 / 340,
                plainZh: '一维声学 CFL 上界时间步约等于网格间距除以声速',
                plainEn:
                  'One-dimensional acoustic CFL max time step is grid spacing over sound speed',
              },
            },
          ],
        },
        {
          id: 'acoustics-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-acoustics',
          titleEn: 'Engineering: solvers-acoustics',
          bodyZh:
            'JobKind `acoustics-3d` 由 @w-sim/solvers-acoustics 拥有；经 kind-matrix 与 lab-kit 登记（ABC energy iuda-dense multi-CFL residual S28cj + juda-dense multi-CFL residual S28ck landed 等 fixture）。**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn: 'Owned by @w-sim/solvers-acoustics; kind-matrix + lab-kit fixtures including ABC energy iuda-dense multi-CFL residual S28cj + juda-dense multi-CFL residual S28ck landed; smoke residual expand ≠ eng DoD / Atlas graduation.',
          jobKinds: ['acoustics-3d'],
        },
        {
          id: 'acoustics-compose-note',
          layer: 'compose',
          titleZh: '合成视角：介质 (c,Z) ∘ 波动推进 ≈ 声学方法',
          titleEn: 'Compose: medium (c,Z) ∘ wave march ≈ acoustics method',
          bodyZh:
            '科技树语义：更基础的「声速/阻抗 / 波数/周期」与「时域/频域波动推进 / iuda-dense multi-CFL residual / juda-dense multi-CFL residual」合成应在等价域复现顶层声学 KPI（平面波 p/v=Z、质点速度反演、强度、I=u·c 能流链、反射/透射、CFL 安全比与 dt_max、介质 Z=ρc 与 Z=√(Kρ)、相速 ω/k、每波长点数、渡越时间、声能量密度、I–u 闭合残差、iuda-dense multi-CFL / thirtieth-grid ranking honesty、juda-dense multi-CFL / thirty-first-grid ranking honesty）。对应 principle-bridge 声学平面波合同；数值 residual tip 桥接 @w-sim/solvers-acoustics S28cj iuda-dense residual + S28ck juda-dense residual（landed；下接 S28cl）——**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Composing medium (c,Z,k,T) + wave march + iuda-dense multi-CFL residual + juda-dense multi-CFL residual should reproduce plane-wave p/v=Z, v=p/Z, intensity, I=u·c energy-flux link, reflection/transmission, CFL/dt_max, Z=ρc and Z=√(Kρ), phase speed ω/k, PPW, travel time, energy density, I–u closure residual, iuda-dense multi-CFL / thirtieth-grid ranking honesty, and juda-dense multi-CFL / thirty-first-grid ranking honesty KPIs; bridges @w-sim/solvers-acoustics S28cj iuda-dense residual + S28ck juda-dense residual (landed; next S28cl) — smoke residual expand ≠ eng DoD / Atlas graduation.',
          children: [
            {
              id: 'acoustics-compose-plane-wave-pv',
              layer: 'foundation',
              titleZh: '合成：平面波 p/v = Z',
              titleEn: 'Compose: plane-wave p/v = Z',
              bodyZh:
                '把特征阻抗 Z=ρc 与场幅合成：均匀介质正向行波 |p|/|v_n|≈Z。工程 smoke 常校验空气/水行波的 p/v 比与 Z 一致。',
              bodyEn:
                'Composes medium Z with fields: progressive plane wave |p|/|v_n|≈Z; smoke checks p/v vs Z.',
              formula: {
                expr: 'ratio = p / v',
                vars: {
                  ratio: '声压/法向质点速度比 Pa·s/m',
                  p: '声压幅度 Pa',
                  v: '法向质点速度 m/s',
                },
                sample: { p: 408, v: 1 },
                expected: 408,
                plainZh: '平面波声压与质点速度幅度比等于特征阻抗',
                plainEn:
                  'Plane-wave pressure-to-particle-velocity amplitude ratio equals characteristic impedance',
              },
            },
            {
              id: 'acoustics-compose-intensity',
              layer: 'foundation',
              titleZh: '合成：时均声强 I = p² / (2 Z)',
              titleEn: 'Compose: time-average intensity I = p² / (2 Z)',
              bodyZh:
                '把声压幅与阻抗合成能量流：平面波时均强度 I = p_rms²/Z = p²/(2Z)（p 为峰值）。连接 principle「阻抗」与可观测功率流 KPI。',
              bodyEn:
                'Composes pressure amplitude with Z into intensity I=p²/(2Z) for progressive plane waves.',
              formula: {
                expr: 'I = p * p / (2 * Z)',
                vars: {
                  I: '时均声强 W/m²',
                  p: '声压峰值 Pa',
                  Z: '特征阻抗 Pa·s/m',
                },
                sample: { p: 408, Z: 408 },
                expected: 204,
                plainZh: '平面波时均声强等于声压峰值平方除以二倍特征阻抗',
                plainEn:
                  'Plane-wave time-average intensity is peak pressure squared over twice the impedance',
              },
            },
            {
              id: 'acoustics-compose-reflection',
              layer: 'foundation',
              titleZh: '合成：正入射反射 R = (Z₂−Z₁)/(Z₂+Z₁)',
              titleEn: 'Compose: normal-incidence R = (Z₂−Z₁)/(Z₂+Z₁)',
              bodyZh:
                '把两侧特征阻抗与边界语义合成：压力释放面 Z₂→0 ⇒ R→−1（声压反相）；硬壁 Z₂→∞ ⇒ R→+1；匹配 Z₂=Z₁ ⇒ R=0。连接 principle「介质 Z」与界面/边界。',
              bodyEn:
                'Composes two-sided Z with BC: pressure-release Z₂→0 ⇒ R→−1; rigid Z₂→∞ ⇒ R→+1; matched ⇒ R=0.',
              formula: {
                expr: 'R = (Z2 - Z1) / (Z2 + Z1)',
                vars: {
                  R: '声压反射系数 1',
                  Z1: '入射侧特征阻抗 Pa·s/m',
                  Z2: '透射侧特征阻抗 Pa·s/m',
                },
                sample: { Z1: 408, Z2: 0 },
                expected: -1,
                plainZh: '正入射声压反射系数由两侧特征阻抗决定，压力释放面极限为 −1',
                plainEn:
                  'Normal-incidence pressure reflection from two impedances; pressure-release limit is −1',
              },
            },
            {
              id: 'acoustics-compose-cfl-ratio',
              layer: 'foundation',
              titleZh: '合成 KPI：声学 CFL 安全比 s = dt / (dx/c)',
              titleEn: 'Compose KPI: acoustic CFL safety ratio s = dt / (dx/c)',
              bodyZh:
                '把时间步、网格与声速合成稳定裕度：1D 量级 dt_max≈dx/c，s=dt/dt_max≤1 为稳定必要量级。算例 dt=1 μs、dx=1 mm、c=340 → s≪1。',
              bodyEn:
                'Composes dt, dx, c into CFL safety; 1D order dt_max≈dx/c; sample dt=1μs on 1mm / 340 m/s is ≪1.',
              formula: {
                expr: 's = dt / (dx / c)',
                vars: {
                  s: 'CFL 安全比 1',
                  dt: '实际时间步 s',
                  dx: '网格间距 m',
                  c: '声速 m/s',
                },
                sample: { dt: 1e-6, dx: 1e-3, c: 340 },
                expected: 1e-6 / (1e-3 / 340),
                plainZh: '声学 CFL 安全比等于实际时间步除以网格声程时间 dx/c',
                plainEn:
                  'Acoustic CFL safety ratio is the chosen time step over the grid transit time dx/c',
              },
            },
            {
              id: 'acoustics-compose-Z-from-K-rho',
              layer: 'foundation',
              titleZh: '合成：Z = √(K ρ)（由 c 与 Z 定义拼回）',
              titleEn: 'Compose: Z = √(K ρ) from c and Z definitions',
              bodyZh:
                '把 foundation「c=√(K/ρ)」与「Z=ρc」合成：Z=√(Kρ)。水算例 K=2.2 GPa、ρ=1000 → Z≈1.483×10⁶ Pa·s/m，构成介质参数两侧的可观测量合同。',
              bodyEn:
                'Composes c=√(K/ρ) with Z=ρc into Z=√(Kρ); water sample K=2.2e9, ρ=1000.',
              formula: {
                expr: 'Z = sqrt(K * rho)',
                vars: {
                  Z: '特征阻抗 Pa·s/m',
                  K: '体积模量 Pa',
                  rho: '质量密度 kg/m³',
                },
                sample: { K: 2.2e9, rho: 1000 },
                expected: Math.sqrt(2.2e9 * 1000),
                plainZh: '特征阻抗等于体积模量与密度乘积的开方',
                plainEn:
                  'Characteristic impedance is the square root of bulk modulus times density',
              },
            },
            {
              id: 'acoustics-compose-impedance-match',
              layer: 'foundation',
              titleZh: '合成：匹配校核 Z 与 p/v',
              titleEn: 'Compose: match check Z vs p/v',
              bodyZh:
                '介质公式 Z 与场比 p/v 应一致：残差 |p/v − Z|/|Z|。算例 p/v=Z 时残差为 0，构成介质参数与场观测的合成合同。',
              bodyEn:
                'Medium Z and field ratio p/v must agree; residual |p/v−Z|/|Z|; sample matched → 0.',
              formula: {
                expr: 'res = abs(p / v - Z) / abs(Z)',
                vars: {
                  res: '阻抗匹配相对残差 1',
                  p: '声压幅度 Pa',
                  v: '法向质点速度 m/s',
                  Z: '特征阻抗 Pa·s/m',
                },
                sample: { p: 408, v: 1, Z: 408 },
                expected: 0,
                plainZh: '平面波场比与特征阻抗的相对残差在匹配时应为零',
                plainEn:
                  'Relative residual between field ratio and characteristic impedance is zero when matched',
              },
            },
            {
              id: 'acoustics-compose-wavelength',
              layer: 'foundation',
              titleZh: '合成：波长 λ = 2π c / ω',
              titleEn: 'Compose: wavelength λ = 2π c / ω',
              bodyZh:
                '把声速与角频率（或 k=ω/c）合成波长：λ=2π/k=2π c/ω。网格每波长点数 N_λ=λ/dx 是分辨率 KPI 的常见合成量。',
              bodyEn:
                'Composes c and ω into λ=2π c/ω; points-per-wavelength N_λ=λ/dx is a resolution KPI.',
              formula: {
                expr: 'lambda = 2 * pi * c / omega',
                vars: {
                  lambda: '波长 m',
                  pi: '圆周率',
                  c: '声速 m/s',
                  omega: '角频率 rad/s',
                },
                sample: { pi: Math.PI, c: 340, omega: 2 * Math.PI * 1000 },
                expected: 340 / 1000,
                plainZh: '波长等于声速除以频率，也等于二π乘声速再除以角频率',
                plainEn:
                  'Wavelength is sound speed over frequency, or 2π c over angular frequency',
              },
            },
            {
              id: 'acoustics-compose-transmission',
              layer: 'foundation',
              titleZh: '合成：正入射压力透射 T = 2 Z₂ / (Z₁ + Z₂)',
              titleEn: 'Compose: normal-incidence pressure T = 2 Z₂ / (Z₁ + Z₂)',
              bodyZh:
                '把两侧特征阻抗合成压力透射系数：T_p = 2 Z₂/(Z₁+Z₂)。匹配 Z₂=Z₁ ⇒ T=1；压力释放 Z₂→0 ⇒ T→0；硬壁 Z₂→∞ ⇒ T→2（界面压力加倍语义）。与 R=(Z₂−Z₁)/(Z₂+Z₁) 合应满足 1+R=T。',
              bodyEn:
                'Composes two-sided Z into pressure transmission T_p=2Z₂/(Z₁+Z₂); matched T=1; pressure-release T→0; rigid T→2; with R satisfies 1+R=T.',
              formula: {
                expr: 'T = 2 * Z2 / (Z1 + Z2)',
                vars: {
                  T: '声压透射系数 1',
                  Z1: '入射侧特征阻抗 Pa·s/m',
                  Z2: '透射侧特征阻抗 Pa·s/m',
                },
                sample: { Z1: 408, Z2: 408 },
                expected: 1,
                plainZh: '正入射声压透射系数由两侧特征阻抗合成，匹配时等于 1',
                plainEn:
                  'Normal-incidence pressure transmission from two impedances equals 1 when matched',
              },
            },
            {
              id: 'acoustics-compose-ppw',
              layer: 'foundation',
              titleZh: '合成 KPI：每波长点数 N_λ = λ / dx',
              titleEn: 'Compose KPI: points-per-wavelength N_λ = λ / dx',
              bodyZh:
                '把波长 λ=c/f 与网格间距合成分辨率 KPI：N_λ=λ/dx。工程常要求 N_λ≳10–20 以控制色散；算例 λ=0.34 m、dx=0.01 m → N_λ=34。',
              bodyEn:
                'Composes wavelength and mesh spacing into PPW; eng often wants N_λ≳10–20; sample λ=0.34, dx=0.01 → 34.',
              formula: {
                expr: 'N_lambda = lambda / dx',
                vars: {
                  N_lambda: '每波长点数 1',
                  lambda: '波长 m',
                  dx: '网格间距 m',
                },
                sample: { lambda: 0.34, dx: 0.01 },
                expected: 34,
                plainZh: '每波长网格点数等于波长除以网格间距，衡量空间分辨率',
                plainEn:
                  'Points per wavelength equal wavelength over mesh spacing and measure spatial resolution',
              },
            },
            {
              id: 'acoustics-compose-travel-time',
              layer: 'foundation',
              titleZh: '合成：渡越时间 τ = L / c',
              titleEn: 'Compose: travel time τ = L / c',
              bodyZh:
                '把传播路径长度 L 与声速合成渡越时间：τ=L/c。平面波相位延迟 KPI 与时域 TOF 标定常用此合成；算例 L=340 m、c=340 m/s → τ=1 s。',
              bodyEn:
                'Composes path length and sound speed into travel time τ=L/c; used for phase delay and TOF KPIs; sample L=c=340 → 1 s.',
              formula: {
                expr: 'tau = L / c',
                vars: {
                  tau: '渡越时间 s',
                  L: '传播路径长度 m',
                  c: '声速 m/s',
                },
                sample: { L: 340, c: 340 },
                expected: 1,
                plainZh: '声波渡越时间等于路径长度除以声速',
                plainEn: 'Acoustic travel time is path length over sound speed',
              },
            },
            {
              id: 'acoustics-compose-energy-density',
              layer: 'foundation',
              titleZh: '合成：时均声能量密度 u = p² / (2 ρ c²)',
              titleEn: 'Compose: time-average energy density u = p² / (2 ρ c²)',
              bodyZh:
                '把声压峰值与介质 (ρ,c) 合成平面波时均能量密度：u = p_rms²/(ρ c²) = p²/(2 ρ c²)。与强度 I=p²/(2Z) 合应满足 I = u · c（因 Z=ρc）。算例空气 p=Z=408、ρ=1.2、c=340 → u=0.6 J/m³。',
              bodyEn:
                'Composes peak pressure with (ρ,c) into energy density u=p²/(2ρc²); with I=p²/(2Z) yields I=u·c; air sample u=0.6.',
              formula: {
                expr: 'u = p * p / (2 * rho * c * c)',
                vars: {
                  u: '时均声能量密度 J/m³',
                  p: '声压峰值 Pa',
                  rho: '质量密度 kg/m³',
                  c: '声速 m/s',
                },
                sample: { p: 408, rho: 1.2, c: 340 },
                expected: (408 * 408) / (2 * 1.2 * 340 * 340),
                plainZh: '平面波时均声能量密度等于声压峰值平方除以二倍密度与声速平方',
                plainEn:
                  'Plane-wave time-average energy density is peak pressure squared over twice density times sound-speed squared',
              },
            },
            {
              id: 'acoustics-compose-c-from-K-rho',
              layer: 'foundation',
              titleZh: '合成：c = √(K/ρ) 入波推进链',
              titleEn: 'Compose: c = √(K/ρ) into wave-march chain',
              bodyZh:
                '材料 (K,ρ) 先合成声速 c，再进入波长、CFL、渡越与阻抗链。水算例 K=2.2 GPa、ρ=1000 → c≈1483 m/s，与 foundation-c 及 Z=√(Kρ) 合同。',
              bodyEn:
                'Composes bulk modulus and density into sound speed upstream of λ, CFL, TOF, and Z; water sample c≈1483 m/s.',
              formula: {
                expr: 'c = sqrt(K / rho)',
                vars: {
                  c: '声速 m/s',
                  K: '体积模量 Pa',
                  rho: '质量密度 kg/m³',
                },
                sample: { K: 2.2e9, rho: 1000 },
                expected: Math.sqrt(2.2e9 / 1000),
                plainZh: '声速由体积模量与密度合成，作为波动推进与阻抗的上游',
                plainEn:
                  'Sound speed composes from bulk modulus and density as upstream of wave march and impedance',
              },
            },
            {
              id: 'acoustics-compose-RT-closure',
              layer: 'foundation',
              titleZh: '合成 KPI：反射–透射闭合 1 + R − T = 0',
              titleEn: 'Compose KPI: reflection–transmission closure 1 + R − T = 0',
              bodyZh:
                '正入射声压系数应满足 1+R=T。把 R=(Z₂−Z₁)/(Z₂+Z₁) 与 T=2Z₂/(Z₁+Z₂) 合成残差 |1+R−T|；匹配或任意 Z 时残差为 0，构成界面边界合同。',
              bodyEn:
                'Normal-incidence pressure coeffs satisfy 1+R=T; residual |1+R−T| is 0 for any Z pair.',
              formula: {
                expr: 'res = abs(1 + R - T)',
                vars: {
                  res: '反射透射闭合残差 1',
                  R: '声压反射系数 1',
                  T: '声压透射系数 1',
                },
                sample: {
                  R: (0 - 408) / (0 + 408),
                  T: (2 * 0) / (408 + 0),
                },
                expected: 0,
                plainZh: '正入射反射与透射系数应满足 1 加 R 等于 T，闭合残差为零',
                plainEn:
                  'Normal-incidence reflection and transmission close as 1 plus R equals T with zero residual',
              },
            },
            {
              id: 'acoustics-compose-v-from-p-Z',
              layer: 'foundation',
              titleZh: '合成：质点速度 v = p / Z',
              titleEn: 'Compose: particle velocity v = p / Z',
              bodyZh:
                '平面波场反演：由声压峰值与特征阻抗合成法向质点速度 v=p/Z，与 p/v=Z 对偶。算例 p=Z=408 → v=1 m/s，进入强度与能量密度链。',
              bodyEn:
                'Dual of p/v=Z: recover normal particle velocity v=p/Z; sample p=Z=408 → v=1 m/s.',
              formula: {
                expr: 'v = p / Z',
                vars: {
                  v: '法向质点速度 m/s',
                  p: '声压幅度 Pa',
                  Z: '特征阻抗 Pa·s/m',
                },
                sample: { p: 408, Z: 408 },
                expected: 1,
                plainZh: '平面波质点速度由声压峰值除以特征阻抗反演合成',
                plainEn:
                  'Plane-wave particle velocity recovers from peak pressure over characteristic impedance',
              },
            },
            {
              id: 'acoustics-compose-Z-rho-c',
              layer: 'foundation',
              titleZh: '合成：Z = ρ c 入阻抗链',
              titleEn: 'Compose: Z = ρ c into impedance chain',
              bodyZh:
                '材料 (ρ,c) 合成特征阻抗后进入 p/v、反射/透射与强度链。空气算例 ρ=1.2、c=340 → Z=408，与 foundation-impedance 及平面波合同对齐。',
              bodyEn:
                'Composes density and sound speed into Z upstream of p/v, R/T, and intensity; air sample Z=408.',
              formula: {
                expr: 'Z = rho * c',
                vars: {
                  Z: '特征阻抗 Pa·s/m',
                  rho: '质量密度 kg/m³',
                  c: '声速 m/s',
                },
                sample: { rho: 1.2, c: 340 },
                expected: 408,
                plainZh: '特征阻抗由密度与声速合成，作为平面波场比与界面系数上游',
                plainEn:
                  'Characteristic impedance composes from density and sound speed upstream of field ratios and interface coeffs',
              },
            },
            {
              id: 'acoustics-compose-I-from-u-c',
              layer: 'foundation',
              titleZh: '合成：声强 I = u · c（能流链）',
              titleEn: 'Compose: intensity I = u · c (energy-flux link)',
              bodyZh:
                '平面波时均声强与能量密度应满足 I = u · c（因 Z=ρc 时 p²/(2Z) = [p²/(2ρc²)]·c）。连接 energy-density 与 intensity 两套合成。算例 u=0.6、c=340 → I=204。',
              bodyEn:
                'Plane-wave mean intensity and energy density link as I=u·c when Z=ρc; sample u=0.6, c=340 → I=204.',
              formula: {
                expr: 'I = u * c',
                vars: {
                  I: '时均声强 W/m²',
                  u: '时均声能量密度 J/m³',
                  c: '声速 m/s',
                },
                sample: { u: 0.6, c: 340 },
                expected: 204,
                plainZh: '平面波时均声强等于声能量密度乘声速',
                plainEn:
                  'Plane-wave time-average intensity equals energy density times sound speed',
              },
            },
            {
              id: 'acoustics-compose-I-u-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：I 与 u·c 闭合残差 |I − u c| / |I|',
              titleEn: 'Compose KPI: I vs u·c closure residual |I − u c| / |I|',
              bodyZh:
                '强度公式 I=p²/(2Z) 与能量密度 u=p²/(2ρc²) 经 I=u·c 应合同：相对残差 |I−uc|/|I|。匹配算例残差为 0，构成能流–储能合成 KPI。',
              bodyEn:
                'I=p²/(2Z) and u=p²/(2ρc²) must close via I=u·c; residual 0 when matched.',
              formula: {
                expr: 'res = abs(I - u * c) / abs(I)',
                vars: {
                  res: '能流闭合相对残差 1',
                  I: '时均声强 W/m²',
                  u: '时均声能量密度 J/m³',
                  c: '声速 m/s',
                },
                sample: { I: 204, u: 0.6, c: 340 },
                expected: 0,
                plainZh: '声强与能量密度乘声速的相对残差在能流合同时应为零',
                plainEn:
                  'Relative residual between intensity and energy-density times sound speed is zero when the energy-flux link matches',
              },
            },
            {
              id: 'acoustics-compose-phase-speed',
              layer: 'foundation',
              titleZh: '合成：相速 c_p = ω / k',
              titleEn: 'Compose: phase speed c_p = ω / k',
              bodyZh:
                '把角频率与波数合成相速：无色散介质 c_p=ω/k 应等于材料声速 c。算例 ω=2π·1000、k=ω/340 → c_p=340，闭合 foundation-k 与介质 c。',
              bodyEn:
                'Composes ω and k into phase speed; non-dispersive c_p=ω/k equals material c; sample 340 m/s.',
              formula: {
                expr: 'c_p = omega / k',
                vars: {
                  c_p: '相速 m/s',
                  omega: '角频率 rad/s',
                  k: '波数 1/m',
                },
                sample: {
                  omega: 2 * Math.PI * 1000,
                  k: (2 * Math.PI * 1000) / 340,
                },
                expected: 340,
                plainZh: '无色散介质相速由角频率除以波数合成，应等于材料声速',
                plainEn:
                  'Non-dispersive phase speed composes as angular frequency over wavenumber and equals material sound speed',
              },
            },
            {
              id: 'acoustics-compose-dt-max',
              layer: 'foundation',
              titleZh: '合成：CFL 上界 dt_max = dx / c 入安全比',
              titleEn: 'Compose: CFL bound dt_max = dx / c into safety ratio',
              bodyZh:
                '网格与声速先合成 dt_max=dx/c，再与实际 dt 合成安全比 s=dt/dt_max。算例 dx=1 mm、c=340 → dt_max≈2.94 μs，与 foundation-dt-max 及 cfl-ratio 同链。',
              bodyEn:
                'Composes dx and c into dt_max upstream of s=dt/dt_max; sample dx=1e-3, c=340.',
              formula: {
                expr: 'dt_max = dx / c',
                vars: {
                  dt_max: '最大稳定时间步 s',
                  dx: '网格间距 m',
                  c: '声速 m/s',
                },
                sample: { dx: 1e-3, c: 340 },
                expected: 1e-3 / 340,
                plainZh: '一维声学稳定时间步上界由网格间距除以声速合成',
                plainEn:
                  'One-dimensional acoustic max stable time step composes as mesh spacing over sound speed',
              },
            },
            {
              id: 'acoustics-compose-freq-from-lambda',
              layer: 'foundation',
              titleZh: '合成：频率 f = c / λ',
              titleEn: 'Compose: frequency f = c / λ',
              bodyZh:
                '把声速与波长合成频率：f=c/λ，与 λ=c/f、N_λ=λ/dx 同链。算例 c=340、λ=0.34 → f=1000 Hz，对接 wavelength 与 ppw KPI。',
              bodyEn:
                'Composes c and λ into f=c/λ; sample 340/0.34 → 1 kHz; links wavelength and PPW.',
              formula: {
                expr: 'f = c / lambda',
                vars: {
                  f: '频率 Hz',
                  c: '声速 m/s',
                  lambda: '波长 m',
                },
                sample: { c: 340, lambda: 0.34 },
                expected: 1000,
                plainZh: '声波频率由声速除以波长合成',
                plainEn: 'Acoustic frequency composes as sound speed over wavelength',
              },
            },

            // S28cj iuda-dense multi-CFL residual + thirtieth-grid ranking + twenty-ninth-grid longer (wave35 residual compose expand; solvers tip landed)
            {
              id: 'acoustics-compose-iuda-dense-cfl-span',
              layer: 'foundation',
              titleZh: '合成 KPI：iuda-dense multi-CFL 样本跨度 residual',
              titleEn: 'Compose KPI: iuda-dense multi-CFL sample span residual',
              bodyZh:
                'S28cj（landed）：iuda-dense multi-CFL 样本在 [0.55,0.85] 上相对 huda 集的扩展跨度文档 KPI。算例 0.85−0.55=0.30；桥接 IUDA_DENSE_MULTI_CFL_VALUES。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S28cj (landed) iuda-dense multi-CFL samples span doc KPI on [0.55,0.85] beyond huda set; sample 0.85−0.55=0.30; bridges IUDA_DENSE_MULTI_CFL_VALUES; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'span = cfl_hi - cfl_lo',
                vars: {
                  span: 'iuda-dense multi-CFL 跨度 1',
                  cfl_hi: '高 CFL 样本',
                  cfl_lo: '低 CFL 样本',
                },
                sample: { cfl_hi: 0.85, cfl_lo: 0.55 },
                expected: 0.3,
                plainZh: 'iuda-dense multi-CFL 跨度等于高 CFL 样本减去低 CFL 样本',
                plainEn:
                  'Iuda-dense multi-CFL span is the high CFL sample minus the low CFL sample',
              },
            },
            {
              id: 'acoustics-compose-thirtieth-grid-ranking-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：thirtieth-grid ranking honesty residual',
              titleEn: 'Compose KPI: thirtieth-grid ranking honesty residual',
              bodyZh:
                'S28cj thirtieth-grid（74³）ranking residual：ABC eng 能量排序与 MIN/MAX dual 应成立。匹配 → residual 0。算例 rank_ok=1 → 0。',
              bodyEn:
                'S28cj thirtieth-grid (74³) ranking residual: ABC eng energy order + MIN/MAX dual must hold; matched → residual 0; sample rank_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - rank_ok',
                vars: {
                  res: 'thirtieth-grid ranking 诚实残差 1',
                  rank_ok: '排序成立标志 0/1',
                },
                sample: { rank_ok: 1 },
                expected: 0,
                plainZh: 'thirtieth-grid ranking 诚实残差在排序成立时为零',
                plainEn:
                  'Thirtieth-grid ranking honesty residual is zero when ranking holds',
              },
            },
            {
              id: 'acoustics-compose-iuda-longer-drop',
              layer: 'foundation',
              titleZh: '合成 KPI：iuda-dense longer-run drop residual',
              titleEn: 'Compose KPI: iuda-dense longer-run drop residual',
              bodyZh:
                'S28cj iuda-dense longer-run（2× nSteps）相对短跑 eng 保留下降应 ≥0 且有地板。匹配诚实下降示意 |E_short−E_long| 包装。算例 0.10−0.08=0.02。',
              bodyEn:
                'S28cj iuda-dense longer-run (2× nSteps) eng retention drop vs short run should be ≥0 with floors; sample 0.10−0.08=0.02.',
              formula: {
                expr: 'drop = E_short - E_long',
                vars: {
                  drop: 'iuda longer-run eng 下降 1',
                  E_short: '短跑 eng 保留 1',
                  E_long: '长跑 eng 保留 1',
                },
                sample: { E_short: 0.1, E_long: 0.08 },
                expected: 0.02,
                plainZh: 'iuda-dense longer-run eng 下降等于短跑保留减去长跑保留',
                plainEn:
                  'Iuda-dense longer-run eng drop is short-run retention minus long-run retention',
              },
            },
            {
              id: 'acoustics-compose-twenty-ninth-longer-parity',
              layer: 'foundation',
              titleZh: '合成 KPI：twenty-ninth-grid longer parity residual',
              titleEn: 'Compose KPI: twenty-ninth-grid longer parity residual',
              bodyZh:
                'S28cj twenty-ninth-grid longer-run parity：72³ / 2× nSteps 地板 + MIN/MAX dual。匹配 → residual 0。算例 parity_ok=1 → 0。',
              bodyEn:
                'S28cj twenty-ninth-grid longer-run parity: 72³ / 2× nSteps floors + MIN/MAX dual; matched → residual 0; sample parity_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - parity_ok',
                vars: {
                  res: 'twenty-ninth longer parity 诚实残差 1',
                  parity_ok: 'parity 成立标志 0/1',
                },
                sample: { parity_ok: 1 },
                expected: 0,
                plainZh: 'twenty-ninth-grid longer parity 诚实残差在 parity 成立时为零',
                plainEn:
                  'Twenty-ninth-grid longer parity honesty residual is zero when parity holds',
              },
            },
            {
              id: 'acoustics-compose-iuda-dense-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：iudaDenseHonest 联合门（0/1）',
              titleEn: 'Compose KPI: iudaDenseHonest joint gate (0/1)',
              bodyZh:
                'S28cj packaging：thirtieth-grid ranking ∧ iuda longer drop 容差 ∧ twenty-ninth longer parity。教学金标 → 1（下接 S28ck juda-dense landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S28cj packaging: thirtieth-grid ranking ∧ iuda longer drop tol ∧ twenty-ninth longer parity; honest gold → 1 (next S28ck juda-dense landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_rank * c_drop * c_parity',
                vars: {
                  gate: 'iuda-dense 包装诚实门 0/1',
                  c_rank: 'thirtieth-grid ranking 诚实 0/1',
                  c_drop: 'iuda longer drop 容差 诚实 0/1',
                  c_parity: 'twenty-ninth longer parity 诚实 0/1',
                },
                sample: { c_rank: 1, c_drop: 1, c_parity: 1 },
                expected: 1,
                plainZh: 'iuda-dense 包装诚实门为三个子诚实标志之积，全真时为 1',
                plainEn:
                  'Iuda-dense packaging honesty gate is the product of three sub-honesty flags; all-true yields 1',
              },
            },

            // S28ck juda-dense multi-CFL residual + thirty-first-grid ranking + thirtieth-grid longer (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'acoustics-compose-juda-dense-cfl-span',
              layer: 'foundation',
              titleZh: '合成 KPI：juda-dense multi-CFL 样本跨度 residual',
              titleEn: 'Compose KPI: juda-dense multi-CFL sample span residual',
              bodyZh:
                'S28ck（landed）：juda-dense multi-CFL 样本在 [0.55,0.85] 上相对 iuda 集的扩展跨度文档 KPI。算例 0.85−0.55=0.30；桥接 JUDA_DENSE_MULTI_CFL_VALUES。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S28ck (landed) juda-dense multi-CFL samples span doc KPI on [0.55,0.85] beyond iuda set; sample 0.85−0.55=0.30; bridges JUDA_DENSE_MULTI_CFL_VALUES; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'span = cfl_hi - cfl_lo',
                vars: {
                  span: 'juda-dense multi-CFL 跨度 1',
                  cfl_hi: '高 CFL 样本',
                  cfl_lo: '低 CFL 样本',
                },
                sample: { cfl_hi: 0.85, cfl_lo: 0.55 },
                expected: 0.3,
                plainZh: 'juda-dense multi-CFL 跨度等于高 CFL 样本减去低 CFL 样本',
                plainEn:
                  'Juda-dense multi-CFL span is the high CFL sample minus the low CFL sample',
              },
            },
            {
              id: 'acoustics-compose-thirty-first-grid-ranking-honesty',
              layer: 'foundation',
              titleZh: '合成 KPI：thirty-first-grid ranking honesty residual',
              titleEn: 'Compose KPI: thirty-first-grid ranking honesty residual',
              bodyZh:
                'S28ck thirty-first-grid（76³）ranking residual：ABC eng 能量排序与 MIN/MAX dual 应成立。匹配 → residual 0。算例 rank_ok=1 → 0。',
              bodyEn:
                'S28ck thirty-first-grid (76³) ranking residual: ABC eng energy order + MIN/MAX dual must hold; matched → residual 0; sample rank_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - rank_ok',
                vars: {
                  res: 'thirty-first-grid ranking 诚实残差 1',
                  rank_ok: '排序成立标志 0/1',
                },
                sample: { rank_ok: 1 },
                expected: 0,
                plainZh: 'thirty-first-grid ranking 诚实残差在排序成立时为零',
                plainEn:
                  'Thirty-first-grid ranking honesty residual is zero when ranking holds',
              },
            },
            {
              id: 'acoustics-compose-juda-longer-drop',
              layer: 'foundation',
              titleZh: '合成 KPI：juda-dense longer-run drop residual',
              titleEn: 'Compose KPI: juda-dense longer-run drop residual',
              bodyZh:
                'S28ck juda-dense longer-run（2× nSteps）相对短跑 eng 保留下降应 ≥0 且有地板。匹配诚实下降示意 |E_short−E_long| 包装。算例 0.10−0.08=0.02。',
              bodyEn:
                'S28ck juda-dense longer-run (2× nSteps) eng retention drop vs short run should be ≥0 with floors; sample 0.10−0.08=0.02.',
              formula: {
                expr: 'drop = E_short - E_long',
                vars: {
                  drop: 'juda longer-run eng 下降 1',
                  E_short: '短跑 eng 保留 1',
                  E_long: '长跑 eng 保留 1',
                },
                sample: { E_short: 0.1, E_long: 0.08 },
                expected: 0.02,
                plainZh: 'juda-dense longer-run eng 下降等于短跑保留减去长跑保留',
                plainEn:
                  'Juda-dense longer-run eng drop is short-run retention minus long-run retention',
              },
            },
            {
              id: 'acoustics-compose-thirtieth-longer-parity',
              layer: 'foundation',
              titleZh: '合成 KPI：thirtieth-grid longer parity residual',
              titleEn: 'Compose KPI: thirtieth-grid longer parity residual',
              bodyZh:
                'S28ck thirtieth-grid longer-run parity：74³ / 2× nSteps 地板 + MIN/MAX dual。匹配 → residual 0。算例 parity_ok=1 → 0。',
              bodyEn:
                'S28ck thirtieth-grid longer-run parity: 74³ / 2× nSteps floors + MIN/MAX dual; matched → residual 0; sample parity_ok=1 → 0.',
              formula: {
                expr: 'res = 1 - parity_ok',
                vars: {
                  res: 'thirtieth longer parity 诚实残差 1',
                  parity_ok: 'parity 成立标志 0/1',
                },
                sample: { parity_ok: 1 },
                expected: 0,
                plainZh: 'thirtieth-grid longer parity 诚实残差在 parity 成立时为零',
                plainEn:
                  'Thirtieth-grid longer parity honesty residual is zero when parity holds',
              },
            },
            {
              id: 'acoustics-compose-juda-dense-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：judaDenseHonest 联合门（0/1）',
              titleEn: 'Compose KPI: judaDenseHonest joint gate (0/1)',
              bodyZh:
                'S28ck packaging：thirty-first-grid ranking ∧ juda longer drop 容差 ∧ thirtieth longer parity。教学金标 → 1（下接 S28cl）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S28ck packaging: thirty-first-grid ranking ∧ juda longer drop tol ∧ thirtieth longer parity; honest gold → 1 (next S28cl); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_rank * c_drop * c_parity',
                vars: {
                  gate: 'juda-dense 包装诚实门 0/1',
                  c_rank: 'thirty-first-grid ranking 诚实 0/1',
                  c_drop: 'juda longer drop 容差 诚实 0/1',
                  c_parity: 'thirtieth longer parity 诚实 0/1',
                },
                sample: { c_rank: 1, c_drop: 1, c_parity: 1 },
                expected: 1,
                plainZh: 'juda-dense 包装诚实门为三个子诚实标志之积，全真时为 1',
                plainEn:
                  'Juda-dense packaging honesty gate is the product of three sub-honesty flags; all-true yields 1',
              },
            },
          ],
        },
        {
          id: 'acoustics-L0',
          layer: 'L0',
          titleZh: 'L0：Sound / Ultrasound 教学叶子',
          titleEn: 'L0: Sound / Ultrasound teaching',
          bodyZh:
            'WaveWorld 页 Sound、Ultrasound、Ripple 等可承载教学演示；不计入 engineering DoD。',
          bodyEn: 'Teaching pages may demo waves; not engineering DoD credit.',
        },
      ],
    },
  }
