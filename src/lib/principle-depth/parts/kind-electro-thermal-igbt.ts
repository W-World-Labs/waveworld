import type { CalculationMethod } from '../types'

export const CALCULATION_KIND_ELECTRO_THERMAL_IGBT: CalculationMethod = {
    id: 'kind-electro-thermal-igbt',
    titleZh: 'IGBT 电热 Foster（工程 kind）',
    titleEn: 'IGBT electro-thermal Foster (engineering kind)',
    layer: 'engineering',
    summaryZh:
      'W-Sim BuiltinJobKind electro-thermal-igbt：功率器件结温 / Foster 热阻–热容网络工程路径；教学落到 Rθ、τ、阶跃响应。',
    summaryEn:
      'W-Sim kind electro-thermal-igbt: junction Foster R–C network; drills to Rθ, τ, step response.',
    jobKinds: ['electro-thermal-igbt'],
    explainRoot: {
      id: 'igbt-root',
      layer: 'method',
      titleZh: '方法：电热 IGBT / Foster',
      titleEn: 'Method: electro-thermal IGBT / Foster',
      bodyZh:
        '顶层工程计算方法：将电气损耗映射到 Foster（或部分 Cauer）热网络，输出结温 Tj、温升与热 KPI。数值实现归 @w-sim/solvers-thermal。',
      bodyEn:
        'Maps electrical loss into a Foster thermal network; owned by @w-sim/solvers-thermal.',
      jobKinds: ['electro-thermal-igbt'],
      children: [
        {
          id: 'igbt-principle-loss',
          layer: 'principle',
          titleZh: '原理：损耗 → 热源',
          titleEn: 'Principle: loss as heat source',
          bodyZh:
            '导通损耗 ~ I·Vce(sat)、开关损耗 ~ Eon/Eoff·fsw 等汇总为热源功率 P；注入 Foster 网络的结侧端口，驱动温升响应。',
          bodyEn:
            'Conduction + switching loss sum to heat power P injected at the junction port of the Foster network.',
          children: [
            {
              id: 'igbt-foundation-rth',
              layer: 'foundation',
              titleZh: '基础式：ΔT = P · Rθ',
              titleEn: 'Foundation: ΔT = P · Rθ',
              bodyZh:
                '稳态量级：结到参考点的温升约等于损耗功率乘总热阻。多层时 Rθ,total = Σ R_i（Foster 支路稳态电阻之和）。',
              bodyEn:
                'Steady order: junction rise ≈ P × Rθ,total; multilayer Rθ,total = Σ R_i.',
              formula: {
                expr: 'dT = P * Rth',
                vars: {
                  dT: '温升 K',
                  P: '损耗功率 W',
                  Rth: '热阻 K/W',
                },
                sample: { P: 100, Rth: 0.5 },
                expected: 50,
                plainZh: '稳态温升约等于功率乘热阻',
                plainEn: 'Steady temperature rise ≈ power × thermal resistance',
              },
            },
            {
              id: 'igbt-foundation-loss-sum',
              layer: 'foundation',
              titleZh: '基础：损耗合成 P = Pcond + Psw',
              titleEn: 'Foundation: P = Pcond + Psw',
              bodyZh:
                '量级上把导通与开关损耗相加作为 Foster 注入功率；更细可分芯片/封装多热源，但 smoke 常以单端口 P 驱动。',
              bodyEn:
                'Order-of-magnitude P = Pcond + Psw into one Foster port; multi-source models optional.',
              formula: {
                expr: 'P = Pcond + Psw',
                vars: {
                  P: '总损耗功率 W',
                  Pcond: '导通损耗 W',
                  Psw: '开关损耗 W',
                },
                sample: { Pcond: 80, Psw: 20 },
                expected: 100,
                plainZh: '总损耗等于导通损耗与开关损耗之和',
                plainEn: 'Total loss is conduction plus switching loss',
              },
            },
          ],
        },
        {
          id: 'igbt-principle-foster',
          layer: 'principle',
          titleZh: '原理：Foster 热阻抗网络',
          titleEn: 'Principle: Foster thermal impedance network',
          bodyZh:
            'Foster 把 Zth(jω) 拟合成若干并联 R–C 支路：Zth(s) = Σ R_i/(1 + s τ_i)，τ_i = R_i C_i。便于 datasheet 曲线拟合；Cauer 更贴近分层物理，二者可互化。',
          bodyEn:
            'Foster fits Zth as parallel R–C branches Zth=Σ R_i/(1+sτ_i); Cauer maps layered structure.',
          children: [
            {
              id: 'igbt-foundation-tau',
              layer: 'foundation',
              titleZh: '基础式：τ = R · C',
              titleEn: 'Foundation: τ = R · C',
              bodyZh:
                '单支路热时间常数 τ = Rθ · Cθ。短 τ 对应芯片/焊层快响应，长 τ 对应封装/散热器慢通道。',
              bodyEn:
                'Branch thermal time constant τ = Rθ · Cθ; short/long τ map die vs package paths.',
              formula: {
                expr: 'tau = R * C',
                vars: {
                  tau: '热时间常数 s',
                  R: '支路热阻 K/W',
                  C: '支路热容 J/K',
                },
                sample: { R: 0.2, C: 0.5 },
                expected: 0.1,
                plainZh: '热时间常数等于支路热阻乘热容',
                plainEn: 'Thermal time constant is branch resistance times capacitance',
              },
            },
            {
              id: 'igbt-foundation-step',
              layer: 'foundation',
              titleZh: '基础式：单支路阶跃 ΔT(t) = P R (1 − e^{−t/τ})',
              titleEn: 'Foundation: step ΔT(t) = P R (1 − e^{−t/τ})',
              bodyZh:
                '恒功率阶跃下单 Foster 支路的温升响应。t→∞ 时 ΔT→P R；t=τ 时约达 63% 稳态。多层为各支路响应之和。',
              bodyEn:
                'Constant-power step on one Foster branch; multi-layer sums branches.',
              formula: {
                expr: 'dT = P * R * (1 - exp(-t / tau))',
                vars: {
                  dT: '瞬时温升 K',
                  P: '损耗功率 W',
                  R: '支路热阻 K/W',
                  t: '时间 s',
                  tau: '热时间常数 s',
                },
                sample: { P: 100, R: 0.5, t: 0.1, tau: 0.1 },
                expected: 100 * 0.5 * (1 - Math.exp(-1)),
                plainZh: '单支路 Foster 阶跃温升随时间按指数趋近 PR',
                plainEn: 'Single-branch Foster step rise approaches PR exponentially',
              },
            },
            {
              id: 'igbt-foundation-rth-sum',
              layer: 'foundation',
              titleZh: '基础：多层稳态 Rθ,total = Σ R_i',
              titleEn: 'Foundation: Rθ,total = Σ R_i',
              bodyZh:
                'Foster 各支路在直流（s→0）下退化为纯电阻叠加于温升：Rθ,jc = Σ R_i。工程 smoke 常校验多层 Rθ 与结构函数残差。',
              bodyEn:
                'DC limit of Foster: Rθ,total = Σ R_i; smoke checks multilayer Rθ and structure-function residual.',
              formula: {
                expr: 'Rth_total = R1 + R2 + R3',
                vars: {
                  Rth_total: '总热阻 K/W',
                  R1: '第 1 支路热阻 K/W',
                  R2: '第 2 支路热阻 K/W',
                  R3: '第 3 支路热阻 K/W',
                },
                sample: { R1: 0.15, R2: 0.25, R3: 0.1 },
                expected: 0.5,
                plainZh: 'Foster 多层稳态总热阻等于各支路热阻之和',
                plainEn: 'Steady multilayer Foster Rθ is the sum of branch resistances',
              },
            },
            {
              id: 'igbt-foundation-network',
              layer: 'foundation',
              titleZh: '基础：Foster / Cauer 对照',
              titleEn: 'Foundation: Foster vs Cauer',
              bodyZh:
                'Foster 便于拟合 Zth(t)/Zth(jω)；Cauer 节点对应物理分层（芯片–焊料–基板–壳）。二者传递函数可等价变换；本 kind 工程路径以 Foster 拟合 + 结温 KPI 为主。',
              bodyEn:
                'Foster fits curves; Cauer maps layers; transfer functions can be equivalent.',
            },
          ],
        },
        {
          id: 'igbt-principle-tj',
          layer: 'principle',
          titleZh: '原理：结温与参考点',
          titleEn: 'Principle: junction temperature & reference',
          bodyZh:
            'Tj = Tref + ΔTj-ref。Tref 可为壳温 Tc、散热器 Ts 或环境 Ta，取决于 Rθ 链截断点；过温保护与 derating 看 Tj 上限。',
          bodyEn:
            'Tj = Tref + ΔT; reference may be case, sink, or ambient depending on Rθ chain cut.',
          children: [
            {
              id: 'igbt-foundation-tj',
              layer: 'foundation',
              titleZh: '基础式：Tj = Tref + ΔT',
              titleEn: 'Foundation: Tj = Tref + ΔT',
              bodyZh: '绝对结温 = 参考温度 + 网络给出的温升。要求与 Rθ 定义的参考点一致。',
              bodyEn: 'Absolute junction temperature = reference + network rise.',
              formula: {
                expr: 'Tj = Tref + dT',
                vars: {
                  Tj: '结温 K 或 °C',
                  Tref: '参考温度 K 或 °C',
                  dT: '温升 K',
                },
                sample: { Tref: 25, dT: 50 },
                expected: 75,
                plainZh: '结温等于参考温度加网络温升',
                plainEn: 'Junction temperature is reference plus network temperature rise',
              },
            },
            {
              id: 'igbt-foundation-assumptions',
              layer: 'foundation',
              titleZh: '假设与有效域',
              titleEn: 'Assumptions & domain',
              bodyZh:
                '线性时不变热网络、单端口或少端口注入；忽略封装非线性辐射/接触、强耦合多芯片热点需扩展。工程 smoke 覆盖多层 Rθ、阶跃/脉冲结温与结构函数残差。',
              bodyEn:
                'LTI thermal network; nonlinear radiation / multi-chip hotspots need extensions.',
            },
          ],
        },
        {
          id: 'igbt-engineering',
          layer: 'engineering',
          titleZh: '工程包：solvers-thermal',
          titleEn: 'Engineering: solvers-thermal',
          bodyZh:
            'JobKind `electro-thermal-igbt` 由 @w-sim/solvers-thermal 拥有；经 kind-matrix 与 lab-kit 登记（multi-pulse duty / Dragomir B 系列 vs-rect residual S24o–S24bc + B₃₂/B₃₃ dual S24bf + B₃₄/B₃₅ dual S24bg + B₃₆/B₃₇ dual S24bh + B₃₈/B₃₉ dual S24bi + B₄₀/B₄₁ dual S24bj + B₄₂/B₄₃ dual S24bk + B₄₄/B₄₅ dual S24bl 等 fixture）。**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Owned by @w-sim/solvers-thermal; kind-matrix + lab-kit fixtures including multi-pulse duty / Dragomir B-series vs-rect residual S24o–S24bc + B32/B33 dual S24bf + B34/B35 dual S24bg + B36/B37 dual S24bh + B38/B39 dual S24bi + B40/B41 dual S24bj + B42/B43 dual S24bk + B44/B45 dual S24bl; smoke residual expand ≠ eng DoD / Atlas graduation.',
          jobKinds: ['electro-thermal-igbt'],
        },
        {
          id: 'igbt-compose-note',
          layer: 'compose',
          titleZh: '合成视角：损耗模型 ∘ Foster 网络 ≈ 电热方法',
          titleEn: 'Compose: loss model ∘ Foster network ≈ electro-thermal method',
          bodyZh:
            '科技树语义：更基础的「损耗合成 / 占空 / 开关能量 / 全链 P / 占空 RMS·crest·form·util / 周期能量 / 电方差」与「Foster R–C / 阶跃 / Zth / 热容储能 / Rjc+Rca / 裕度 / Hellinger·Bhattacharyya·Dragomir dual residual packaging（含 B₃₂/B₃₃、B₃₄/B₃₅、B₃₆/B₃₇、B₃₈/B₃₉、B₄₀/B₄₁、B₄₂/B₄₃、B₄₄/B₄₅）」合成应在等价域复现顶层 IGBT 结温与 Rθ KPI（稳态 ΔT、Tj、多层阶跃、τ、Rθ 匹配残差、Zth(t)、多层 Zth、ΔT=P·Zth、63% 响应、阶跃→稳态残差、Q=C·ΔT、Rθ=ΔT/P 反推、初斜率 P/C、进度 α、Tj 裕度、τ 匹配、占空电学 KPI、vs-rect 距离/Dragomir 诚实门）。对应 foundation 的损耗/Foster 闭式；数值 residual tip 桥接 @w-sim/solvers-thermal multi-pulse duty + Dragomir B 系列（S24o–S24bc + S24bf B₃₂/B₃₃ + S24bg B₃₄/B₃₅ + S24bh B₃₆/B₃₇ + S24bi B₃₈/B₃₉ dual packaging + S24bj B₄₀/B₄₁ dual packaging + S24bk B₄₂/B₄₃ dual packaging + S24bl B₄₄/B₄₅ dual packaging（landed）；下接 S24bm）——**smoke residual expand ≠ eng DoD / Atlas graduation**。',
          bodyEn:
            'Composing loss/duty/switching/full-chain P + duty RMS·crest·form·util + cycle energy/variance + Foster R–C/step/Zth/storage/Rjc+Rca/margin + Hellinger·Bhattacharyya·Dragomir dual residual packaging (incl. B32/B33, B34/B35, B36/B37, B38/B39, B40/B41, B42/B43, B44/B45) should reproduce Tj/Rθ KPIs (steady ΔT, Tj, multi-branch step, τ, Rθ match, Zth(t), multi Zth, ΔT=P·Zth, 63% rise, step-to-steady residual, Q=C·ΔT, Rθ=ΔT/P invert, initial P/C slope, progress α, Tj margin, τ match, duty electrical KPIs, vs-rect distance/Dragomir honesty gates); bridges @w-sim/solvers-thermal multi-pulse duty + Dragomir B-series (S24o–S24bc + S24bf B32/B33 + S24bg B34/B35 + S24bh B36/B37 + S24bi B38/B39 dual packaging + S24bj B40/B41 dual packaging + S24bk B42/B43 dual packaging + S24bl B44/B45 dual packaging (landed); next S24bm) — smoke residual expand ≠ eng DoD / Atlas graduation.',
          children: [
            {
              id: 'igbt-compose-steady-dT',
              layer: 'foundation',
              titleZh: '合成：稳态 ΔT = P · Rθ,total',
              titleEn: 'Compose: steady ΔT = P · Rθ,total',
              bodyZh:
                '把损耗功率与多层稳态热阻合成：ΔT_ss = P · Σ R_i。连接 principle「损耗→热源」与「Foster 网络」。',
              bodyEn:
                'Composes loss power with multilayer steady Rθ: ΔT_ss = P · Σ R_i; links loss principle to Foster network.',
              formula: {
                expr: 'dT = P * Rth_total',
                vars: {
                  dT: '稳态温升 K',
                  P: '总损耗功率 W',
                  Rth_total: '总热阻 K/W',
                },
                sample: { P: 100, Rth_total: 0.5 },
                expected: 50,
                plainZh: '稳态温升等于损耗功率乘 Foster 总热阻',
                plainEn: 'Steady temperature rise is loss power times total Foster Rθ',
              },
            },
            {
              id: 'igbt-compose-tj',
              layer: 'foundation',
              titleZh: '合成：Tj = Tref + P · Rθ',
              titleEn: 'Compose: Tj = Tref + P · Rθ',
              bodyZh:
                '绝对结温合同：参考点 + 稳态温升。算例 Tref=25°C、P=100 W、Rθ=0.5 K/W → Tj=75°C。',
              bodyEn:
                'Absolute junction contract: reference + steady rise; sample 25°C + 50 K → 75°C.',
              formula: {
                expr: 'Tj = Tref + P * Rth',
                vars: {
                  Tj: '结温 °C',
                  Tref: '参考温度 °C',
                  P: '损耗功率 W',
                  Rth: '热阻 K/W',
                },
                sample: { Tref: 25, P: 100, Rth: 0.5 },
                expected: 75,
                plainZh: '结温等于参考温度加功率乘热阻的温升',
                plainEn: 'Junction temperature is reference plus power times thermal resistance',
              },
            },
            {
              id: 'igbt-compose-step-sum',
              layer: 'foundation',
              titleZh: '合成：多层阶跃 ΔT = Σ P R_i (1 − e^{−t/τ_i})',
              titleEn: 'Compose: multi-branch step ΔT = Σ P R_i (1 − e^{−t/τ_i})',
              bodyZh:
                'Foster 并联支路对恒功率阶跃的温升叠加。算例两支路在 t=τ₁ 时取一支 63% 稳态、另一支近稳态近似。',
              bodyEn:
                'Multi-branch Foster step sums exponential rises under constant power.',
              formula: {
                expr: 'dT = P * (R1 * (1 - exp(-t / tau1)) + R2 * (1 - exp(-t / tau2)))',
                vars: {
                  dT: '瞬时温升 K',
                  P: '损耗功率 W',
                  R1: '第 1 支路热阻 K/W',
                  tau1: '第 1 支路时间常数 s',
                  R2: '第 2 支路热阻 K/W',
                  tau2: '第 2 支路时间常数 s',
                  t: '时间 s',
                },
                sample: {
                  P: 100,
                  R1: 0.2,
                  tau1: 0.1,
                  R2: 0.3,
                  tau2: 1,
                  t: 0.1,
                },
                expected:
                  100 *
                  (0.2 * (1 - Math.exp(-1)) + 0.3 * (1 - Math.exp(-0.1))),
                plainZh: '多层 Foster 阶跃温升等于各支路指数响应之和',
                plainEn: 'Multi-branch Foster step rise is the sum of branch exponential responses',
              },
            },
            {
              id: 'igbt-compose-tau',
              layer: 'foundation',
              titleZh: '合成：τ = R · C 与支路响应',
              titleEn: 'Compose: τ = R · C with branch response',
              bodyZh:
                '把支路热阻与热容合成时间常数；短 τ 快通道、长 τ 慢通道共同构成 Zth(t) 曲线。',
              bodyEn:
                'Composes branch R and C into τ; short/long τ form Zth(t) shape.',
              formula: {
                expr: 'tau = R * C',
                vars: {
                  tau: '热时间常数 s',
                  R: '支路热阻 K/W',
                  C: '支路热容 J/K',
                },
                sample: { R: 0.2, C: 0.5 },
                expected: 0.1,
                plainZh: '合成热时间常数等于支路热阻乘热容',
                plainEn: 'Composed thermal time constant is branch R times C',
              },
            },
            {
              id: 'igbt-compose-rth-match',
              layer: 'foundation',
              titleZh: '合成 KPI：Rθ 匹配残差 |R_meas − Σ R_i|/R_meas',
              titleEn: 'Compose KPI: Rθ match residual |R_meas − Σ R_i|/R_meas',
              bodyZh:
                'datasheet / 结构函数拟合出的 Rθ 与支路和应一致。算例完全匹配时残差为 0。',
              bodyEn:
                'Fitted Rθ must match branch sum; sample matched residual is 0.',
              formula: {
                expr: 'res = abs(R_meas - (R1 + R2 + R3)) / abs(R_meas)',
                vars: {
                  res: 'Rθ 匹配相对残差 1',
                  R_meas: '测量/拟合总热阻 K/W',
                  R1: '第 1 支路热阻 K/W',
                  R2: '第 2 支路热阻 K/W',
                  R3: '第 3 支路热阻 K/W',
                },
                sample: { R_meas: 0.5, R1: 0.15, R2: 0.25, R3: 0.1 },
                expected: 0,
                plainZh: '热阻匹配残差在支路和等于测量值时应为零',
                plainEn: 'Rθ match residual is zero when branch sum equals measured total',
              },
            },
            {
              id: 'igbt-compose-loss-inject',
              layer: 'foundation',
              titleZh: '合成：注入功率 P = Pcond + Psw',
              titleEn: 'Compose: inject P = Pcond + Psw',
              bodyZh:
                '电侧损耗合成作为 Foster 端口注入；与热侧 R–C 合成后得结温 KPI。',
              bodyEn:
                'Electrical loss sum injects the Foster port; composed with R–C yields Tj KPIs.',
              formula: {
                expr: 'P = Pcond + Psw',
                vars: {
                  P: '注入功率 W',
                  Pcond: '导通损耗 W',
                  Psw: '开关损耗 W',
                },
                sample: { Pcond: 80, Psw: 20 },
                expected: 100,
                plainZh: 'Foster 注入功率等于导通损耗与开关损耗之和',
                plainEn: 'Foster injection power is conduction plus switching loss',
              },
            },
            {
              id: 'igbt-compose-rth-sum',
              layer: 'foundation',
              titleZh: '合成：Rθ,total = R1 + R2 + R3 入稳态链',
              titleEn: 'Compose: Rθ,total = R1+R2+R3 into steady chain',
              bodyZh:
                '把各 Foster 支路热阻合成直流总 Rθ，再进入 ΔT=P·Rθ 与 Tj 合同。算例 0.15+0.25+0.1=0.5 K/W。',
              bodyEn:
                'Composes branch R_i into DC total Rθ upstream of ΔT=P·Rθ and Tj; sample sum 0.5 K/W.',
              formula: {
                expr: 'Rth_total = R1 + R2 + R3',
                vars: {
                  Rth_total: '总热阻 K/W',
                  R1: '第 1 支路热阻 K/W',
                  R2: '第 2 支路热阻 K/W',
                  R3: '第 3 支路热阻 K/W',
                },
                sample: { R1: 0.15, R2: 0.25, R3: 0.1 },
                expected: 0.5,
                plainZh: 'Foster 总热阻由各支路热阻合成，再进入稳态温升链',
                plainEn:
                  'Total Foster Rθ composes from branch resistances before the steady-rise chain',
              },
            },
            {
              id: 'igbt-compose-zth',
              layer: 'foundation',
              titleZh: '合成：Zth(t) = R (1 − e^{−t/τ})',
              titleEn: 'Compose: Zth(t) = R (1 − e^{−t/τ})',
              bodyZh:
                '把支路 R 与 τ 合成瞬态热阻抗；恒功率下 ΔT(t)=P·Zth(t)。t=τ 时 Zth≈0.632 R。',
              bodyEn:
                'Composes branch R and τ into transient Zth; ΔT(t)=P·Zth under constant power; at t=τ, Zth≈0.632 R.',
              formula: {
                expr: 'Zth = R * (1 - exp(-t / tau))',
                vars: {
                  Zth: '瞬态热阻抗 K/W',
                  R: '支路热阻 K/W',
                  t: '时间 s',
                  tau: '热时间常数 s',
                },
                sample: { R: 0.5, t: 0.1, tau: 0.1 },
                expected: 0.5 * (1 - Math.exp(-1)),
                plainZh: '瞬态热阻抗由支路热阻与时间常数按指数趋近 R 合成',
                plainEn:
                  'Transient thermal impedance composes from branch R and τ approaching R exponentially',
              },
            },
            {
              id: 'igbt-compose-step-63',
              layer: 'foundation',
              titleZh: '合成：t=τ 时 ΔT ≈ 0.632 P R',
              titleEn: 'Compose: ΔT(t=τ) ≈ 0.632 P R',
              bodyZh:
                '单支路阶跃在一个时间常数处到达约 63.2% 稳态温升。算例 P=100、R=0.5 → ΔT≈31.606 K。',
              bodyEn:
                'Single-branch step reaches ~63.2% of steady rise at one τ; sample ≈31.606 K.',
              formula: {
                expr: 'dT_tau = P * R * (1 - exp(-1))',
                vars: {
                  dT_tau: 't=τ 时温升 K',
                  P: '损耗功率 W',
                  R: '支路热阻 K/W',
                },
                sample: { P: 100, R: 0.5 },
                expected: 100 * 0.5 * (1 - Math.exp(-1)),
                plainZh: '一个时间常数处的 Foster 阶跃温升约为稳态的 63.2%',
                plainEn:
                  'Foster step rise at one time constant is about 63.2% of the steady value',
              },
            },
            {
              id: 'igbt-compose-C-from-tau',
              layer: 'foundation',
              titleZh: '合成：C = τ / R 反推热容',
              titleEn: 'Compose: C = τ / R invert thermal capacitance',
              bodyZh:
                '从 datasheet 拟合的 (R,τ) 反推支路热容 C=τ/R，供 Cauer 变换或能量估算。算例 τ=0.1、R=0.2 → C=0.5 J/K。',
              bodyEn:
                'Inverts fitted (R,τ) into branch C=τ/R for Cauer map or energy estimates; sample C=0.5 J/K.',
              formula: {
                expr: 'C = tau / R',
                vars: {
                  C: '支路热容 J/K',
                  tau: '热时间常数 s',
                  R: '支路热阻 K/W',
                },
                sample: { tau: 0.1, R: 0.2 },
                expected: 0.5,
                plainZh: '支路热容由时间常数除以热阻反推合成',
                plainEn: 'Branch thermal capacitance composes as time constant over resistance',
              },
            },
            {
              id: 'igbt-compose-psw',
              layer: 'foundation',
              titleZh: '合成：Psw = (Eon + Eoff) · fsw',
              titleEn: 'Compose: Psw = (Eon + Eoff) · fsw',
              bodyZh:
                '把开关能量与开关频率合成平均开关损耗，再与 Pcond 合成注入 P。算例 Eon+Eoff=2 mJ、fsw=10 kHz → Psw=20 W。',
              bodyEn:
                'Composes switching energies and fsw into average Psw before total P; sample 20 W.',
              formula: {
                expr: 'Psw = (Eon + Eoff) * fsw',
                vars: {
                  Psw: '平均开关损耗 W',
                  Eon: '开通损耗能量 J',
                  Eoff: '关断损耗能量 J',
                  fsw: '开关频率 Hz',
                },
                sample: { Eon: 0.0012, Eoff: 0.0008, fsw: 10000 },
                expected: 20,
                plainZh: '平均开关损耗由开通/关断能量与开关频率合成',
                plainEn:
                  'Average switching loss composes from turn-on/off energies and switching frequency',
              },
            },
            {
              id: 'igbt-compose-pcond',
              layer: 'foundation',
              titleZh: '合成：Pcond = I · Vce',
              titleEn: 'Compose: Pcond = I · Vce',
              bodyZh:
                '导通损耗量级 I·Vce(sat)（或占空修正后的平均）。算例 I=40 A、Vce=2 V → Pcond=80 W，与 loss-inject 样例对齐。',
              bodyEn:
                'Conduction-loss order I·Vce(sat) (duty-averaged when needed); sample 80 W aligns with loss-inject.',
              formula: {
                expr: 'Pcond = I * Vce',
                vars: {
                  Pcond: '导通损耗 W',
                  I: '导通电流 A',
                  Vce: '饱和压降 V',
                },
                sample: { I: 40, Vce: 2 },
                expected: 80,
                plainZh: '导通损耗由导通电流与饱和压降合成',
                plainEn: 'Conduction loss composes from on-state current and saturation voltage',
              },
            },
            {
              id: 'igbt-compose-duty-avg',
              layer: 'foundation',
              titleZh: '合成：Pavg = Ppeak · D 占空平均',
              titleEn: 'Compose: Pavg = Ppeak · D duty average',
              bodyZh:
                '脉冲/PWM 工况下把峰值损耗与占空比合成平均注入功率，再驱动 Foster 长时温升。算例 Ppeak=200 W、D=0.5 → Pavg=100 W。',
              bodyEn:
                'Composes peak loss and duty into average injection for long-horizon Foster rise; sample 100 W.',
              formula: {
                expr: 'Pavg = Ppeak * D',
                vars: {
                  Pavg: '平均损耗功率 W',
                  Ppeak: '峰值损耗功率 W',
                  D: '占空比 0–1',
                },
                sample: { Ppeak: 200, D: 0.5 },
                expected: 100,
                plainZh: '平均损耗功率由峰值损耗与占空比合成',
                plainEn: 'Average loss power composes from peak loss and duty cycle',
              },
            },
            {
              id: 'igbt-compose-thermal-energy',
              layer: 'foundation',
              titleZh: '合成：Q = C · ΔT 热容储能',
              titleEn: 'Compose: Q = C · ΔT thermal storage',
              bodyZh:
                '支路热容储能尺度：温升 ΔT 时储存热量 Q=C·ΔT。算例 C=0.5 J/K、ΔT=50 K → Q=25 J，连接 τ=RC 与阶跃能量。',
              bodyEn:
                'Branch storage scale Q=C·ΔT; sample 25 J; links τ=RC to step energy.',
              formula: {
                expr: 'Q = C * dT',
                vars: {
                  Q: '储存热量 J',
                  C: '支路热容 J/K',
                  dT: '温升 K',
                },
                sample: { C: 0.5, dT: 50 },
                expected: 25,
                plainZh: '热容储能等于热容乘温升，连接 Foster 支路与能量尺度',
                plainEn:
                  'Thermal storage energy is capacitance times temperature rise, linking Foster branches to energy scale',
              },
            },
            {
              id: 'igbt-compose-step-steady-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：阶跃→稳态残差 |ΔT(t)−PR|/(PR)',
              titleEn: 'Compose KPI: step-to-steady residual |ΔT(t)−PR|/(PR)',
              bodyZh:
                '长时阶跃后瞬时温升应逼近 PR。算例取已达稳态的 dT=PR=50 时相对残差为 0。',
              bodyEn:
                'Long-time step rise must approach PR; sample at steady dT=PR yields residual 0.',
              formula: {
                expr: 'res = abs(dT - P * R) / abs(P * R)',
                vars: {
                  res: '阶跃逼近稳态相对残差 1',
                  dT: '瞬时温升 K',
                  P: '损耗功率 W',
                  R: '支路或总热阻 K/W',
                },
                sample: { dT: 50, P: 100, R: 0.5 },
                expected: 0,
                plainZh: '阶跃温升逼近稳态时相对残差应为零',
                plainEn:
                  'Step-to-steady relative residual should be zero when the rise has settled',
              },
            },
            {
              id: 'igbt-compose-dT-from-Zth',
              layer: 'foundation',
              titleZh: '合成：ΔT(t) = P · Zth(t)',
              titleEn: 'Compose: ΔT(t) = P · Zth(t)',
              bodyZh:
                '恒功率下把注入功率与瞬态热阻抗合成瞬时温升。算例 P=100、Zth(t=τ)=0.5·(1−e^{−1}) → ΔT≈31.606 K，与 step-63 同值。',
              bodyEn:
                'Composes injection power with transient Zth into rise under constant power; sample matches step-63.',
              formula: {
                expr: 'dT = P * Zth',
                vars: {
                  dT: '瞬时温升 K',
                  P: '损耗功率 W',
                  Zth: '瞬态热阻抗 K/W',
                },
                sample: { P: 100, Zth: 0.5 * (1 - Math.exp(-1)) },
                expected: 100 * 0.5 * (1 - Math.exp(-1)),
                plainZh: '瞬时温升等于损耗功率乘瞬态热阻抗',
                plainEn: 'Instantaneous temperature rise is loss power times transient thermal impedance',
              },
            },
            {
              id: 'igbt-compose-zth-sum',
              layer: 'foundation',
              titleZh: '合成：多层 Zth(t) = Σ R_i (1 − e^{−t/τ_i})',
              titleEn: 'Compose: multi-branch Zth(t) = Σ R_i (1 − e^{−t/τ_i})',
              bodyZh:
                '把各 Foster 支路的指数响应合成多层瞬态热阻抗；恒功率下 ΔT=P·Zth。算例与 step-sum 的 (R,τ,t) 对齐：Zth=dT/P。',
              bodyEn:
                'Composes branch exponential responses into multi-branch Zth; ΔT=P·Zth; sample aligns with step-sum.',
              formula: {
                expr: 'Zth = R1 * (1 - exp(-t / tau1)) + R2 * (1 - exp(-t / tau2))',
                vars: {
                  Zth: '多层瞬态热阻抗 K/W',
                  R1: '第 1 支路热阻 K/W',
                  tau1: '第 1 支路时间常数 s',
                  R2: '第 2 支路热阻 K/W',
                  tau2: '第 2 支路时间常数 s',
                  t: '时间 s',
                },
                sample: {
                  R1: 0.2,
                  tau1: 0.1,
                  R2: 0.3,
                  tau2: 1,
                  t: 0.1,
                },
                expected:
                  0.2 * (1 - Math.exp(-1)) + 0.3 * (1 - Math.exp(-0.1)),
                plainZh: '多层 Foster 瞬态热阻抗由各支路指数响应之和合成',
                plainEn:
                  'Multi-branch Foster transient impedance composes as the sum of branch exponential responses',
              },
            },
            {
              id: 'igbt-compose-Rth-invert',
              layer: 'foundation',
              titleZh: '合成：Rθ = ΔT / P 反推热阻',
              titleEn: 'Compose: Rθ = ΔT / P invert thermal resistance',
              bodyZh:
                '稳态或已知温升下反推有效热阻，连接实测 ΔT 与 datasheet Rθ。算例 ΔT=50 K、P=100 W → Rθ=0.5 K/W。',
              bodyEn:
                'Inverts measured steady rise into effective Rθ; sample 50 K / 100 W → 0.5 K/W.',
              formula: {
                expr: 'Rth = dT / P',
                vars: {
                  Rth: '有效热阻 K/W',
                  dT: '稳态温升 K',
                  P: '损耗功率 W',
                },
                sample: { dT: 50, P: 100 },
                expected: 0.5,
                plainZh: '有效热阻由稳态温升除以损耗功率反推合成',
                plainEn: 'Effective thermal resistance composes as steady rise over loss power',
              },
            },
            {
              id: 'igbt-compose-full-loss-chain',
              layer: 'foundation',
              titleZh: '合成：P = I·Vce·D + (Eon+Eoff)·fsw 全链损耗',
              titleEn: 'Compose: P = I·Vce·D + (Eon+Eoff)·fsw full loss chain',
              bodyZh:
                '把占空修正导通损耗与开关能量–频率链一次合成注入功率。算例 I=80、Vce=2、D=0.5 → Pcond=80；Eon+Eoff=2 mJ、fsw=10 kHz → Psw=20；P=100 W。',
              bodyEn:
                'Composes duty-averaged conduction and switching chain into injection P; sample 100 W.',
              formula: {
                expr: 'P = I * Vce * D + (Eon + Eoff) * fsw',
                vars: {
                  P: '总注入功率 W',
                  I: '导通电流 A',
                  Vce: '饱和压降 V',
                  D: '占空比 0–1',
                  Eon: '开通损耗能量 J',
                  Eoff: '关断损耗能量 J',
                  fsw: '开关频率 Hz',
                },
                sample: {
                  I: 80,
                  Vce: 2,
                  D: 0.5,
                  Eon: 0.0012,
                  Eoff: 0.0008,
                  fsw: 10000,
                },
                expected: 100,
                plainZh: '全链损耗由占空导通损耗与开关能量频率项合成',
                plainEn:
                  'Full loss chain composes duty-averaged conduction with switching energy–frequency term',
              },
            },
            {
              id: 'igbt-compose-pcond-duty',
              layer: 'foundation',
              titleZh: '合成：Pcond = I · Vce · D 占空导通',
              titleEn: 'Compose: Pcond = I · Vce · D duty conduction',
              bodyZh:
                'PWM 导通损耗把 I·Vce 与占空比合成平均导通功率。算例 I=80 A、Vce=2 V、D=0.5 → Pcond=80 W，对齐 loss-inject。',
              bodyEn:
                'PWM conduction averages I·Vce by duty; sample 80 W aligns with loss-inject.',
              formula: {
                expr: 'Pcond = I * Vce * D',
                vars: {
                  Pcond: '平均导通损耗 W',
                  I: '导通电流 A',
                  Vce: '饱和压降 V',
                  D: '占空比 0–1',
                },
                sample: { I: 80, Vce: 2, D: 0.5 },
                expected: 80,
                plainZh: '平均导通损耗由电流、饱和压降与占空比合成',
                plainEn:
                  'Average conduction loss composes from current, saturation voltage, and duty cycle',
              },
            },
            {
              id: 'igbt-compose-Esw',
              layer: 'foundation',
              titleZh: '合成：Esw = Eon + Eoff 开关周期能量',
              titleEn: 'Compose: Esw = Eon + Eoff switching energy per cycle',
              bodyZh:
                '把开通与关断能量合成单开关周期开关能量，再乘 fsw 得 Psw。算例 1.2 mJ + 0.8 mJ = 2 mJ。',
              bodyEn:
                'Composes turn-on/off energies into per-cycle switching energy before ×fsw; sample 2 mJ.',
              formula: {
                expr: 'Esw = Eon + Eoff',
                vars: {
                  Esw: '开关周期能量 J',
                  Eon: '开通损耗能量 J',
                  Eoff: '关断损耗能量 J',
                },
                sample: { Eon: 0.0012, Eoff: 0.0008 },
                expected: 0.002,
                plainZh: '开关周期能量由开通与关断能量合成',
                plainEn: 'Per-cycle switching energy composes from turn-on and turn-off energies',
              },
            },
            {
              id: 'igbt-compose-initial-slope',
              layer: 'foundation',
              titleZh: '合成：初斜率 dT/dt|₀ = P / C',
              titleEn: 'Compose: initial slope dT/dt|₀ = P / C',
              bodyZh:
                '单支路阶跃极短时限：热容尚未经 R 泄放，初斜率 ≈ P/C。算例 P=100、C=0.5 → 200 K/s，连接 Q=C·ΔT 与 τ=RC。',
              bodyEn:
                'Short-time single-branch limit: initial slope ≈ P/C; sample 200 K/s; links Q=C·ΔT and τ=RC.',
              formula: {
                expr: 'dTdt0 = P / C',
                vars: {
                  dTdt0: '初始温升斜率 K/s',
                  P: '损耗功率 W',
                  C: '支路热容 J/K',
                },
                sample: { P: 100, C: 0.5 },
                expected: 200,
                plainZh: '阶跃初温升斜率等于功率除以热容',
                plainEn: 'Initial step temperature slope is power over thermal capacitance',
              },
            },
            {
              id: 'igbt-compose-progress-alpha',
              layer: 'foundation',
              titleZh: '合成：进度 α = 1 − e^{−t/τ}',
              titleEn: 'Compose: progress α = 1 − e^{−t/τ}',
              bodyZh:
                '单支路阶跃相对稳态的完成进度；t=τ 时 α≈0.632。与 Zth=R·α、dT=P R α 同源。',
              bodyEn:
                'Single-branch step progress toward steady; α≈0.632 at t=τ; same root as Zth=R·α.',
              formula: {
                expr: 'alpha = 1 - exp(-t / tau)',
                vars: {
                  alpha: '阶跃进度 0–1',
                  t: '时间 s',
                  tau: '热时间常数 s',
                },
                sample: { t: 0.1, tau: 0.1 },
                expected: 1 - Math.exp(-1),
                plainZh: '单支路阶跃进度由归一化时间 t/τ 的指数合成',
                plainEn:
                  'Single-branch step progress composes from the exponential of normalized time t/τ',
              },
            },
            {
              id: 'igbt-compose-Rja-chain',
              layer: 'foundation',
              titleZh: '合成：Rθ,ja = Rjc + Rca 热阻链',
              titleEn: 'Compose: Rθ,ja = Rjc + Rca thermal chain',
              bodyZh:
                '把结–壳与壳–环境（或壳–散热器）热阻合成结–环境总链，再进入 ΔT=P·Rja 与 Tj 合同。算例 0.3+0.2=0.5 K/W。',
              bodyEn:
                'Composes junction–case and case–ambient (or sink) into junction–ambient chain; sample 0.5 K/W.',
              formula: {
                expr: 'Rja = Rjc + Rca',
                vars: {
                  Rja: '结–环境总热阻 K/W',
                  Rjc: '结–壳热阻 K/W',
                  Rca: '壳–环境热阻 K/W',
                },
                sample: { Rjc: 0.3, Rca: 0.2 },
                expected: 0.5,
                plainZh: '结–环境总热阻由结–壳与壳–环境热阻链合成',
                plainEn:
                  'Junction-to-ambient thermal resistance composes from junction–case and case–ambient segments',
              },
            },
            {
              id: 'igbt-compose-tj-margin',
              layer: 'foundation',
              titleZh: '合成 KPI：Tj 裕度 = Tmax − Tj',
              titleEn: 'Compose KPI: Tj margin = Tmax − Tj',
              bodyZh:
                '把最大允许结温与当前 Tj 合成过温裕度；正裕度可工作，负裕度需降额。算例 Tmax=150、Tj=75 → margin=75 K。',
              bodyEn:
                'Composes max allowed junction temp with current Tj into thermal margin; sample 75 K.',
              formula: {
                expr: 'margin = Tmax - Tj',
                vars: {
                  margin: '结温裕度 K',
                  Tmax: '最大允许结温 °C',
                  Tj: '当前结温 °C',
                },
                sample: { Tmax: 150, Tj: 75 },
                expected: 75,
                plainZh: '结温裕度等于最大允许结温减去当前结温',
                plainEn: 'Junction temperature margin is max allowed Tj minus current Tj',
              },
            },
            {
              id: 'igbt-compose-tau-match',
              layer: 'foundation',
              titleZh: '合成 KPI：τ 匹配残差 |τ_meas − R C| / τ_meas',
              titleEn: 'Compose KPI: τ match residual |τ_meas − R C| / τ_meas',
              bodyZh:
                '拟合时间常数应与 R·C 产品一致。算例 τ_meas=0.1、R=0.2、C=0.5 完全匹配时残差为 0。',
              bodyEn:
                'Fitted τ must match R·C product; sample matched residual is 0.',
              formula: {
                expr: 'res = abs(tau_meas - R * C) / abs(tau_meas)',
                vars: {
                  res: 'τ 匹配相对残差 1',
                  tau_meas: '测量/拟合时间常数 s',
                  R: '支路热阻 K/W',
                  C: '支路热容 J/K',
                },
                sample: { tau_meas: 0.1, R: 0.2, C: 0.5 },
                expected: 0,
                plainZh: '时间常数匹配残差在 R·C 等于测量值时应为零',
                plainEn: 'τ match residual is zero when R·C equals the measured time constant',
              },
            },
            {
              id: 'igbt-compose-zth-inf-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Zth(∞)→R 残差 |Z_inf − R| / R',
              titleEn: 'Compose KPI: Zth(∞)→R residual |Z_inf − R| / R',
              bodyZh:
                '长时瞬态热阻抗应逼近直流热阻 R。算例 Z_inf=R=0.5 时相对残差为 0。',
              bodyEn:
                'Long-time Zth must approach DC R; sample Z_inf=R yields residual 0.',
              formula: {
                expr: 'res = abs(Z_inf - R) / abs(R)',
                vars: {
                  res: 'Zth 逼近 R 相对残差 1',
                  Z_inf: '长时热阻抗 K/W',
                  R: '支路或总直流热阻 K/W',
                },
                sample: { Z_inf: 0.5, R: 0.5 },
                expected: 0,
                plainZh: '长时热阻抗逼近直流热阻时相对残差应为零',
                plainEn:
                  'Long-time Zth-to-R relative residual should be zero when impedance has settled',
              },
            },
            {
              id: 'igbt-compose-pulse-energy',
              layer: 'foundation',
              titleZh: '合成：E = P · t_on 脉冲能量',
              titleEn: 'Compose: E = P · t_on pulse energy',
              bodyZh:
                '短脉冲注入能量尺度，连接损耗功率与热容储能 Q；若 t_on≪τ 则近似绝热 ΔT≈E/C。算例 P=100 W、t_on=0.01 s → E=1 J。',
              bodyEn:
                'Short-pulse energy scale linking P to storage Q; if t_on≪τ then ΔT≈E/C; sample 1 J.',
              formula: {
                expr: 'E = P * t_on',
                vars: {
                  E: '脉冲能量 J',
                  P: '脉冲功率 W',
                  t_on: '脉冲宽度 s',
                },
                sample: { P: 100, t_on: 0.01 },
                expected: 1,
                plainZh: '脉冲能量由功率与开通脉宽合成',
                plainEn: 'Pulse energy composes from power and on-time width',
              },
            },
            // S24o–S24bc multi-pulse duty / Dragomir dual residual packaging (wave27 residual compose expand)
            {
              id: 'igbt-compose-duty-rms',
              layer: 'foundation',
              titleZh: '合成：P_rms = Ppeak · √D 占空 RMS',
              titleEn: 'Compose: P_rms = Ppeak · √D duty RMS',
              bodyZh:
                '矩形占空电学 RMS：P_rms=Ppeak·√D。算例 Ppeak=100、D=0.25 → P_rms=50；桥接 S24r rmsPowerW / periodRmsResidual。',
              bodyEn:
                'Rectangular duty electrical RMS P_rms=Ppeak·√D; sample 100×0.5=50; bridges S24r rmsPowerW / periodRmsResidual.',
              formula: {
                expr: 'P_rms = Ppeak * sqrt(D)',
                vars: {
                  P_rms: '占空 RMS 功率 W',
                  Ppeak: '峰值损耗功率 W',
                  D: '占空比 0–1',
                },
                sample: { Ppeak: 100, D: 0.25 },
                expected: 50,
                plainZh: '占空 RMS 功率等于峰值功率乘占空比的平方根',
                plainEn:
                  'Duty RMS power is peak power times the square root of the duty cycle',
              },
            },
            {
              id: 'igbt-compose-duty-crest',
              layer: 'foundation',
              titleZh: '合成：crest = 1/√D 占空波峰因数',
              titleEn: 'Compose: crest = 1/√D duty crest factor',
              bodyZh:
                '矩形占空 crest=peak/rms=1/√D。算例 D=0.25 → crest=2；桥接 S24s periodCrestResidual 电学金标。',
              bodyEn:
                'Rectangular crest=peak/rms=1/√D; sample D=0.25 → 2; bridges S24s periodCrestResidual electrical gold.',
              formula: {
                expr: 'crest = 1 / sqrt(D)',
                vars: {
                  crest: '波峰因数 1',
                  D: '占空比 0–1',
                },
                sample: { D: 0.25 },
                expected: 2,
                plainZh: '矩形占空波峰因数等于占空比平方根的倒数',
                plainEn:
                  'Rectangular duty crest factor is the reciprocal of the square root of duty',
              },
            },
            {
              id: 'igbt-compose-duty-form',
              layer: 'foundation',
              titleZh: '合成：form = 1/√D 占空波形因数',
              titleEn: 'Compose: form = 1/√D duty form factor',
              bodyZh:
                '矩形占空 form=rms/mean=1/√D，与 crest 同形。算例 D=0.25 → form=2；桥接 S24s periodFormResidual。',
              bodyEn:
                'Rectangular form=rms/mean=1/√D (same shape as crest); sample D=0.25 → 2; bridges S24s periodFormResidual.',
              formula: {
                expr: 'form = 1 / sqrt(D)',
                vars: {
                  form: '波形因数 1',
                  D: '占空比 0–1',
                },
                sample: { D: 0.25 },
                expected: 2,
                plainZh: '矩形占空波形因数等于占空比平方根的倒数',
                plainEn:
                  'Rectangular duty form factor is the reciprocal of the square root of duty',
              },
            },
            {
              id: 'igbt-compose-duty-util',
              layer: 'foundation',
              titleZh: '合成：util = D 占空利用率',
              titleEn: 'Compose: util = D duty utilization',
              bodyZh:
                '矩形占空 util=mean/peak=D。算例 D=0.25 → util=0.25；桥接 S24t periodUtilResidual 电学金标。',
              bodyEn:
                'Rectangular util=mean/peak=D; sample 0.25; bridges S24t periodUtilResidual electrical gold.',
              formula: {
                expr: 'util = D',
                vars: {
                  util: '利用率 0–1',
                  D: '占空比 0–1',
                },
                sample: { D: 0.25 },
                expected: 0.25,
                plainZh: '矩形占空利用率等于占空比本身',
                plainEn: 'Rectangular duty utilization equals the duty cycle itself',
              },
            },
            {
              id: 'igbt-compose-duty-peak-to-mean',
              layer: 'foundation',
              titleZh: '合成：peakToMean = 1/D 峰均比',
              titleEn: 'Compose: peakToMean = 1/D peak-to-mean ratio',
              bodyZh:
                '矩形占空 peak/mean=1/D（=crest×form）。算例 D=0.25 → 4；桥接 S24t periodPeakToMeanResidual。',
              bodyEn:
                'Rectangular peak/mean=1/D (=crest×form); sample D=0.25 → 4; bridges S24t periodPeakToMeanResidual.',
              formula: {
                expr: 'peakToMean = 1 / D',
                vars: {
                  peakToMean: '峰均比 1',
                  D: '占空比 0–1',
                },
                sample: { D: 0.25 },
                expected: 4,
                plainZh: '矩形占空峰均比等于占空比的倒数',
                plainEn:
                  'Rectangular duty peak-to-mean ratio is the reciprocal of the duty cycle',
              },
            },
            {
              id: 'igbt-compose-duty-variance',
              layer: 'foundation',
              titleZh: '合成：var = P² · D · (1−D) 占空电方差',
              titleEn: 'Compose: var = P² · D · (1−D) duty electrical variance',
              bodyZh:
                '矩形功率两态 {0,P} 方差 P²D(1−D)。算例 P=100、D=0.25 → var=1875；桥接 S24v periodVarResidual。',
              bodyEn:
                'Two-state {0,P} variance P²D(1−D); sample 100²·0.25·0.75=1875; bridges S24v periodVarResidual.',
              formula: {
                expr: 'var = P * P * D * (1 - D)',
                vars: {
                  var: '电学功率方差 W²',
                  P: '峰值功率 W',
                  D: '占空比 0–1',
                },
                sample: { P: 100, D: 0.25 },
                expected: 1875,
                plainZh: '矩形占空电方差等于峰值功率平方乘占空比乘（1−占空比）',
                plainEn:
                  'Rectangular duty electrical variance is peak power squared times D times (1−D)',
              },
            },
            {
              id: 'igbt-compose-duty-std',
              layer: 'foundation',
              titleZh: '合成：std = P · √(D(1−D)) 占空电标准差',
              titleEn: 'Compose: std = P · √(D(1−D)) duty electrical std',
              bodyZh:
                '电标准差 √var=P√(D(1−D))。算例 P=100、D=0.25 → std=25√3；桥接 S24v periodStdResidual。',
              bodyEn:
                'Electrical std √var=P√(D(1−D)); sample 100√0.1875; bridges S24v periodStdResidual.',
              formula: {
                expr: 'std = P * sqrt(D * (1 - D))',
                vars: {
                  std: '电学功率标准差 W',
                  P: '峰值功率 W',
                  D: '占空比 0–1',
                },
                sample: { P: 100, D: 0.25 },
                expected: 100 * Math.sqrt(0.25 * 0.75),
                plainZh: '矩形占空电标准差等于峰值功率乘 √(D(1−D))',
                plainEn:
                  'Rectangular duty electrical std is peak power times √(D(1−D))',
              },
            },
            {
              id: 'igbt-compose-duty-cycle-energy',
              layer: 'foundation',
              titleZh: '合成：E_cyc = P · D · T 周期注入能量',
              titleEn: 'Compose: E_cyc = P · D · T cycle injection energy',
              bodyZh:
                '矩形周期电学能量 P·D·T。算例 P=100、D=0.5、T=0.01 → E=0.5 J；桥接 S24u cycleEnergyPowerJ / periodEnergyResidual。',
              bodyEn:
                'Rectangular cycle energy P·D·T; sample 100·0.5·0.01=0.5 J; bridges S24u cycleEnergyPowerJ / periodEnergyResidual.',
              formula: {
                expr: 'E_cyc = P * D * T',
                vars: {
                  E_cyc: '周期注入能量 J',
                  P: '峰值功率 W',
                  D: '占空比 0–1',
                  T: '周期 s',
                },
                sample: { P: 100, D: 0.5, T: 0.01 },
                expected: 0.5,
                plainZh: '周期注入能量由峰值功率、占空比与周期三者合成',
                plainEn:
                  'Cycle injection energy composes peak power, duty cycle, and period',
              },
            },
            {
              id: 'igbt-compose-crest-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：crest 电学残差 |crest − 1/√D|',
              titleEn: 'Compose KPI: crest electrical residual |crest − 1/√D|',
              bodyZh:
                '末周期 crest 应逼近电学 1/√D。算例 crest=2、D=0.25 → 残差 0；桥接 S24s periodCrestResidual 诚实。',
              bodyEn:
                'Last-period crest must match electrical 1/√D; sample matched → 0; bridges S24s periodCrestResidual honesty.',
              formula: {
                expr: 'res = abs(crest - 1 / sqrt(D))',
                vars: {
                  res: 'crest 电学绝对残差 1',
                  crest: '末周期波峰因数 1',
                  D: '占空比 0–1',
                },
                sample: { crest: 2, D: 0.25 },
                expected: 0,
                plainZh: '波峰因数电学残差在 crest 等于 1/√D 时应为零',
                plainEn:
                  'Crest electrical residual is zero when crest equals 1/√D',
              },
            },
            {
              id: 'igbt-compose-hellinger-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Hellinger vs-rect 残差 H',
              titleEn: 'Compose KPI: Hellinger vs-rect residual H',
              bodyZh:
                'S24ah：|ΔTj| 直方图相对均值匹配矩形占空的 Hellinger H=√(1−BC)。匹配矩形自身 → H≡0；桥接 periodHellingerResidual。',
              bodyEn:
                'S24ah Hellinger H=√(1−BC) vs mean-matched rectangular duty; self-match → H≡0; bridges periodHellingerResidual.',
              formula: {
                expr: 'H = sqrt(1 - BC)',
                vars: {
                  H: 'Hellinger 距离 1',
                  BC: 'Bhattacharyya 系数 0–1',
                },
                sample: { BC: 1 },
                expected: 0,
                plainZh: 'Hellinger 距离等于 1 减去 Bhattacharyya 系数后的平方根，匹配时为零',
                plainEn:
                  'Hellinger distance is the square root of one minus the Bhattacharyya coefficient; zero when matched',
              },
            },
            {
              id: 'igbt-compose-bhattacharyya-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Bhattacharyya vs-rect 残差 D_B',
              titleEn: 'Compose KPI: Bhattacharyya vs-rect residual D_B',
              bodyZh:
                'S24ai Hellinger 对偶：D_B=−ln(BC)。匹配 BC=1 → D_B=0；桥接 periodBhattacharyyaResidual。',
              bodyEn:
                'S24ai Hellinger dual D_B=−ln(BC); matched BC=1 → D_B=0; bridges periodBhattacharyyaResidual.',
              formula: {
                expr: 'D_B = -ln(BC)',
                vars: {
                  D_B: 'Bhattacharyya 距离 1',
                  BC: 'Bhattacharyya 系数 0–1',
                },
                sample: { BC: 1 },
                expected: 0,
                plainZh: 'Bhattacharyya 距离等于 −ln(BC)，系数为一时残差为零',
                plainEn:
                  'Bhattacharyya distance is −ln(BC); residual is zero when the coefficient is one',
              },
            },
            {
              id: 'igbt-compose-dragomir-B1-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₁ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₁ vs-rect residual',
              bodyZh:
                'S24ap：B₁=Σ(p−q)⁴/(pq)^{3/2} 相对矩形占空 ref。匹配 p=q → B₁≡0；桥接 periodDragomirB1Residual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24ap B₁=Σ(p−q)⁴/(pq)^{3/2} vs rect duty; matched p=q → B₁≡0; bridges periodDragomirB1Residual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B1 = sum((p - q)^4 / (p * q)^1.5)',
                vars: {
                  B1: 'Dragomir B₁ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₁ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B₁ is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B2-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₂ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₂ vs-rect residual',
              bodyZh:
                'S24aq：B₂=Σ(√p−√q)⁴/(p+q) 相对矩形 ref。匹配 → B₂≡0；与 B₁ 构成 dual residual packaging。桥接 periodDragomirB2Residual。',
              bodyEn:
                'S24aq B₂=Σ(√p−√q)⁴/(p+q) vs rect; matched → 0; dual packaging with B₁; bridges periodDragomirB2Residual.',
              formula: {
                expr: 'B2 = sum((sqrt(p) - sqrt(q))^4 / (p + q))',
                vars: {
                  B2: 'Dragomir B₂ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₂ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B₂ is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₁ − B₂| Dragomir dual 对偶残差',
              titleEn: 'Compose KPI: |B₁ − B₂| Dragomir dual residual',
              bodyZh:
                'S24ap/S24aq dual packaging：匹配诚实包上 B₁ 与 B₂ 应同为零，|B₁−B₂|→0。算例 B₁=B₂=0 → 0；桥接 Dragomir dual honesty。',
              bodyEn:
                'S24ap/S24aq dual packaging: matched honest pack B₁=B₂=0 → |B₁−B₂|=0; bridges Dragomir dual honesty.',
              formula: {
                expr: 'res = abs(B1 - B2)',
                vars: {
                  res: 'Dragomir dual 绝对残差 1',
                  B1: 'Dragomir B₁ 1',
                  B2: 'Dragomir B₂ 1',
                },
                sample: { B1: 0, B2: 0 },
                expected: 0,
                plainZh: 'Dragomir B₁ 与 B₂ 之差的绝对值衡量 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B₁ and B₂ measures dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-duty-joint-max-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max = max(H, D_B, B₁, B₂) 联合上界',
              titleEn: 'Compose KPI: joint_max = max(H, D_B, B₁, B₂) joint upper bound',
              bodyZh:
                'S24ah–S24aq 联合包装：取 Hellinger、Bhattacharyya、Dragomir B₁/B₂ 四残差上确界。匹配诚实 → 0；算例 H=0、D_B=0、B₁=0.01、B₂=0.02 → 0.02。',
              bodyEn:
                'S24ah–S24aq joint packaging upper envelope of H, D_B, B₁, B₂; matched honest → 0; sample max(0,0,0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(H, D_B, B1, B2)',
                vars: {
                  joint_max: '联合距离上确界 1',
                  H: 'Hellinger 残差 1',
                  D_B: 'Bhattacharyya 残差 1',
                  B1: 'Dragomir B₁ 1',
                  B2: 'Dragomir B₂ 1',
                },
                sample: { H: 0, D_B: 0, B1: 0.01, B2: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Hellinger、Bhattacharyya 与 Dragomir 两路残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Hellinger, Bhattacharyya, and both Dragomir residuals',
              },
            },
            {
              id: 'igbt-compose-duty-packaging-honest-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dutyPackagingHonest 联合门（0/1）',
              titleEn: 'Compose KPI: dutyPackagingHonest joint gate (0/1)',
              bodyZh:
                'S24 占空 packagingHonest = crest 电学 ∧ Hellinger ∧ Bhattacharyya ∧ Dragomir dual ∧ joint_max=0。教学金标诚实 → 1；任一子门失败 → 0。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24 duty packagingHonest is conjunction of crest electrical, Hellinger, Bhattacharyya, Dragomir dual, and joint_max=0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_crest * c_H * c_DB * c_dual * c_joint',
                vars: {
                  gate: '占空联合包装诚实门 0/1',
                  c_crest: 'crest 电学诚实 0/1',
                  c_H: 'Hellinger vs-rect 诚实 0/1',
                  c_DB: 'Bhattacharyya vs-rect 诚实 0/1',
                  c_dual: 'Dragomir dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_crest: 1,
                  c_H: 1,
                  c_DB: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: '占空联合包装诚实门为五个子诚实标志之积，全真时为 1',
                plainEn:
                  'Duty packaging honesty gate is the product of five sub-honesty flags; all-true yields 1',
              },
            },
            // S24bf Dragomir B32/B33 vs-rect dual residual packaging (wave30 residual compose expand)
            {
              id: 'igbt-compose-dragomir-B32-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₂ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₂ vs-rect residual',
              bodyZh:
                'S24bf：B₃₂=Σ(p−q)⁴/((pq)¹³(p+q)) 相对矩形占空 ref。匹配 p=q → B₃₂≡0；桥接 periodDragomirB32Residual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bf B32=Σ(p−q)⁴/((pq)¹³(p+q)) vs rect duty; matched p=q → B32≡0; bridges periodDragomirB32Residual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B32 = sum((p - q)^4 / ((p * q)^13 * (p + q)))',
                vars: {
                  B32: 'Dragomir B₃₂ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₂ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B32 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B33-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₃ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₃ vs-rect residual',
              bodyZh:
                'S24bf：B₃₃=Σ(√p−√q)⁴/(pq)¹³ 相对矩形 ref。匹配 → B₃₃≡0；与 B₃₂ 构成高阶 dual residual packaging。桥接 periodDragomirB33Residual。',
              bodyEn:
                'S24bf B33=Σ(√p−√q)⁴/(pq)¹³ vs rect; matched → 0; dual packaging with B32; bridges periodDragomirB33Residual.',
              formula: {
                expr: 'B33 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^13)',
                vars: {
                  B33: 'Dragomir B₃₃ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₃ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B33 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B32-B33-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₃₂ − B₃₃| Dragomir B₃₂/B₃₃ dual 残差',
              titleEn: 'Compose KPI: |B32 − B33| Dragomir B32/B33 dual residual',
              bodyZh:
                'S24bf dual packaging：匹配诚实包上 B₃₂ 与 B₃₃ 应同为零，|B₃₂−B₃₃|→0。算例 B₃₂=B₃₃=0 → 0；桥接 B32/B33 dual honesty（下接 S24bg）。',
              bodyEn:
                'S24bf dual packaging: matched honest pack B32=B33=0 → |B32−B33|=0; bridges B32/B33 dual honesty (next S24bg).',
              formula: {
                expr: 'res = abs(B32 - B33)',
                vars: {
                  res: 'Dragomir B32/B33 dual 绝对残差 1',
                  B32: 'Dragomir B₃₂ 1',
                  B33: 'Dragomir B₃₃ 1',
                },
                sample: { B32: 0, B33: 0 },
                expected: 0,
                plainZh: 'Dragomir B₃₂ 与 B₃₃ 之差的绝对值衡量高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B32 and B33 measures high-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B32-B33-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B32B33 = max(B₃₂, B₃₃) 联合上界',
              titleEn: 'Compose KPI: joint_max_B32B33 = max(B32, B33) joint upper bound',
              bodyZh:
                'S24bf 联合包装：取 B₃₂/B₃₃ 两残差上确界。匹配诚实 → 0；算例 B₃₂=0.01、B₃₃=0.02 → 0.02。',
              bodyEn:
                'S24bf joint packaging upper envelope of B32, B33; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B32, B33)',
                vars: {
                  joint_max: 'B32/B33 联合距离上确界 1',
                  B32: 'Dragomir B₃₂ 1',
                  B33: 'Dragomir B₃₃ 1',
                },
                sample: { B32: 0.01, B33: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₃₂ 与 B₃₃ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B32 and B33 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B32-B33-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB32B33Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB32B33Honest joint gate (0/1)',
              bodyZh:
                'S24bf packaging：B₃₂ 诚实 ∧ B₃₃ 诚实 ∧ dual→0 ∧ joint_max=0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bf packaging: B32 ∧ B33 ∧ dual→0 ∧ joint_max=0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B32 * c_B33 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B32/B33 包装诚实门 0/1',
                  c_B32: 'B₃₂ vs-rect 诚实 0/1',
                  c_B33: 'B₃₃ vs-rect 诚实 0/1',
                  c_dual: 'B32/B33 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B32: 1,
                  c_B33: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B32/B33 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B32/B33 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            // S24bg Dragomir B34/B35 vs-rect dual residual packaging (wave31 residual compose expand)
            {
              id: 'igbt-compose-dragomir-B34-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₄ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₄ vs-rect residual',
              bodyZh:
                'S24bg：B₃₄=Σ(p−q)⁴/((pq)¹⁴(p+q)) 相对矩形占空 ref（B₃₂ 的更高阶）。匹配 p=q → B₃₄≡0；桥接 periodDragomirB34Residual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bg B34=Σ(p−q)⁴/((pq)¹⁴(p+q)) vs rect duty (higher-order of B32); matched p=q → B34≡0; bridges periodDragomirB34Residual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B34 = sum((p - q)^4 / ((p * q)^14 * (p + q)))',
                vars: {
                  B34: 'Dragomir B₃₄ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₄ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B34 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B35-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₅ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₅ vs-rect residual',
              bodyZh:
                'S24bg：B₃₅=Σ(√p−√q)⁴/(pq)¹⁴ 相对矩形 ref（B₃₃ 的更高阶）。匹配 → B₃₅≡0；与 B₃₄ 构成高阶 dual residual packaging。桥接 periodDragomirB35Residual。',
              bodyEn:
                'S24bg B35=Σ(√p−√q)⁴/(pq)¹⁴ vs rect (higher-order of B33); matched → 0; dual packaging with B34; bridges periodDragomirB35Residual.',
              formula: {
                expr: 'B35 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^14)',
                vars: {
                  B35: 'Dragomir B₃₅ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₅ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B35 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B34-B35-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₃₄ − B₃₅| Dragomir B₃₄/B₃₅ dual 残差',
              titleEn: 'Compose KPI: |B34 − B35| Dragomir B34/B35 dual residual',
              bodyZh:
                'S24bg dual packaging：匹配诚实包上 B₃₄ 与 B₃₅ 应同为零，|B₃₄−B₃₅|→0。算例 B₃₄=B₃₅=0 → 0；桥接 B34/B35 dual honesty（下接 S24bh）。',
              bodyEn:
                'S24bg dual packaging: matched honest pack B34=B35=0 → |B34−B35|=0; bridges B34/B35 dual honesty (next S24bh).',
              formula: {
                expr: 'res = abs(B34 - B35)',
                vars: {
                  res: 'Dragomir B34/B35 dual 绝对残差 1',
                  B34: 'Dragomir B₃₄ 1',
                  B35: 'Dragomir B₃₅ 1',
                },
                sample: { B34: 0, B35: 0 },
                expected: 0,
                plainZh: 'Dragomir B₃₄ 与 B₃₅ 之差的绝对值衡量更高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B34 and B35 measures higher-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B34-B35-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B34B35 = max(B₃₄, B₃₅) 联合上界',
              titleEn: 'Compose KPI: joint_max_B34B35 = max(B34, B35) joint upper bound',
              bodyZh:
                'S24bg 联合包装：取 B₃₄/B₃₅ 两残差上确界。匹配诚实 → 0；算例 B₃₄=0.01、B₃₅=0.02 → 0.02。',
              bodyEn:
                'S24bg joint packaging upper envelope of B34, B35; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B34, B35)',
                vars: {
                  joint_max: 'B34/B35 联合距离上确界 1',
                  B34: 'Dragomir B₃₄ 1',
                  B35: 'Dragomir B₃₅ 1',
                },
                sample: { B34: 0.01, B35: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₃₄ 与 B₃₅ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B34 and B35 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B34-B35-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB34B35Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB34B35Honest joint gate (0/1)',
              bodyZh:
                'S24bg packaging：B₃₄ 诚实 ∧ B₃₅ 诚实 ∧ dual→0 ∧ joint_max=0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bg packaging: B34 ∧ B35 ∧ dual→0 ∧ joint_max=0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B34 * c_B35 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B34/B35 包装诚实门 0/1',
                  c_B34: 'B₃₄ vs-rect 诚实 0/1',
                  c_B35: 'B₃₅ vs-rect 诚实 0/1',
                  c_dual: 'B34/B35 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B34: 1,
                  c_B35: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B34/B35 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B34/B35 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            // S24bh Dragomir B36/B37 vs-rect dual residual packaging (wave32 residual compose expand)
            {
              id: 'igbt-compose-dragomir-B36-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₆ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₆ vs-rect residual',
              bodyZh:
                'S24bh：B₃₆=Σ(p−q)⁴/((pq)¹⁵(p+q)) 相对矩形占空 ref（B₃₄ 的更高阶）。匹配 p=q → B₃₆≡0；桥接 periodDragomirB36Residual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bh B36=Σ(p−q)⁴/((pq)¹⁵(p+q)) vs rect duty (higher-order of B34); matched p=q → B36≡0; bridges periodDragomirB36Residual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B36 = sum((p - q)^4 / ((p * q)^15 * (p + q)))',
                vars: {
                  B36: 'Dragomir B₃₆ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₆ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B36 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B37-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₇ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₇ vs-rect residual',
              bodyZh:
                'S24bh：B₃₇=Σ(√p−√q)⁴/(pq)¹⁵ 相对矩形 ref（B₃₅ 的更高阶）。匹配 → B₃₇≡0；与 B₃₆ 构成高阶 dual residual packaging。桥接 periodDragomirB37Residual。',
              bodyEn:
                'S24bh B37=Σ(√p−√q)⁴/(pq)¹⁵ vs rect (higher-order of B35); matched → 0; dual packaging with B36; bridges periodDragomirB37Residual.',
              formula: {
                expr: 'B37 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^15)',
                vars: {
                  B37: 'Dragomir B₃₇ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₇ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B37 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B36-B37-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₃₆ − B₃₇| Dragomir B₃₆/B₃₇ dual 残差',
              titleEn: 'Compose KPI: |B36 − B37| Dragomir B36/B37 dual residual',
              bodyZh:
                'S24bh dual packaging：匹配诚实包上 B₃₆ 与 B₃₇ 应同为零，|B₃₆−B₃₇|→0。算例 B₃₆=B₃₇=0 → 0；桥接 B36/B37 dual honesty（下接 S24bi B38/B39）。',
              bodyEn:
                'S24bh dual packaging: matched honest pack B36=B37=0 → |B36−B37|=0; bridges B36/B37 dual honesty (next S24bi B38/B39).',
              formula: {
                expr: 'res = abs(B36 - B37)',
                vars: {
                  res: 'Dragomir B36/B37 dual 绝对残差 1',
                  B36: 'Dragomir B₃₆ 1',
                  B37: 'Dragomir B₃₇ 1',
                },
                sample: { B36: 0, B37: 0 },
                expected: 0,
                plainZh: 'Dragomir B₃₆ 与 B₃₇ 之差的绝对值衡量更高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B36 and B37 measures higher-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B36-B37-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B36B37 = max(B₃₆, B₃₇) 联合上界',
              titleEn: 'Compose KPI: joint_max_B36B37 = max(B36, B37) joint upper bound',
              bodyZh:
                'S24bh 联合包装：取 B₃₆/B₃₇ 两残差上确界。匹配诚实 → 0；算例 B₃₆=0.01、B₃₇=0.02 → 0.02。',
              bodyEn:
                'S24bh joint packaging upper envelope of B36, B37; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B36, B37)',
                vars: {
                  joint_max: 'B36/B37 联合距离上确界 1',
                  B36: 'Dragomir B₃₆ 1',
                  B37: 'Dragomir B₃₇ 1',
                },
                sample: { B36: 0.01, B37: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₃₆ 与 B₃₇ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B36 and B37 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B36-B37-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB36B37Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB36B37Honest joint gate (0/1)',
              bodyZh:
                'S24bh packaging：B₃₆ 诚实 ∧ B₃₇ 诚实 ∧ dual→0 ∧ joint_max=0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bh packaging: B36 ∧ B37 ∧ dual→0 ∧ joint_max=0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B36 * c_B37 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B36/B37 包装诚实门 0/1',
                  c_B36: 'B₃₆ vs-rect 诚实 0/1',
                  c_B37: 'B₃₇ vs-rect 诚实 0/1',
                  c_dual: 'B36/B37 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B36: 1,
                  c_B37: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B36/B37 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B36/B37 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
            // S24bi Dragomir B38/B39 vs-rect dual residual packaging (wave33 residual compose expand)
            {
              id: 'igbt-compose-dragomir-B38-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₈ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₈ vs-rect residual',
              bodyZh:
                'S24bi：B₃₈=Σ(p−q)⁴/((pq)¹⁶(p+q)) 相对矩形占空 ref（B₃₆ 的更高阶）。匹配 p=q → B₃₈≡0；桥接 periodDragomirB38Residual。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bi B38=Σ(p−q)⁴/((pq)¹⁶(p+q)) vs rect duty (higher-order of B36); matched p=q → B38≡0; bridges periodDragomirB38Residual; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B38 = sum((p - q)^4 / ((p * q)^16 * (p + q)))',
                vars: {
                  B38: 'Dragomir B₃₈ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₈ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B38 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B39-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₃₉ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₃₉ vs-rect residual',
              bodyZh:
                'S24bi：B₃₉=Σ(√p−√q)⁴/(pq)¹⁶ 相对矩形 ref（B₃₇ 的更高阶）。匹配 → B₃₉≡0；与 B₃₈ 构成高阶 dual residual packaging。桥接 periodDragomirB39Residual。',
              bodyEn:
                'S24bi B39=Σ(√p−√q)⁴/(pq)¹⁶ vs rect (higher-order of B37); matched → 0; dual packaging with B38; bridges periodDragomirB39Residual.',
              formula: {
                expr: 'B39 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^16)',
                vars: {
                  B39: 'Dragomir B₃₉ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₃₉ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B39 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B38-B39-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₃₈ − B₃₉| Dragomir B₃₈/B₃₉ dual 残差',
              titleEn: 'Compose KPI: |B38 − B39| Dragomir B38/B39 dual residual',
              bodyZh:
                'S24bi dual packaging：匹配诚实包上 B₃₈ 与 B₃₉ 应同为零，|B₃₈−B₃₉|→0。算例 B₃₈=B₃₉=0 → 0；桥接 B38/B39 dual honesty（下接 S24bj）。',
              bodyEn:
                'S24bi dual packaging: matched honest pack B38=B39=0 → |B38−B39|=0; bridges B38/B39 dual honesty (next S24bj).',
              formula: {
                expr: 'res = abs(B38 - B39)',
                vars: {
                  res: 'Dragomir B38/B39 dual 绝对残差 1',
                  B38: 'Dragomir B₃₈ 1',
                  B39: 'Dragomir B₃₉ 1',
                },
                sample: { B38: 0, B39: 0 },
                expected: 0,
                plainZh: 'Dragomir B₃₈ 与 B₃₉ 之差的绝对值衡量更高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B38 and B39 measures higher-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B38-B39-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B38B39 = max(B₃₈, B₃₉) 联合上界',
              titleEn: 'Compose KPI: joint_max_B38B39 = max(B38, B39) joint upper bound',
              bodyZh:
                'S24bi 联合包装：取 B₃₈/B₃₉ 两残差上确界。匹配诚实 → 0；算例 B₃₈=0.01、B₃₉=0.02 → 0.02。',
              bodyEn:
                'S24bi joint packaging upper envelope of B38, B39; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B38, B39)',
                vars: {
                  joint_max: 'B38/B39 联合距离上确界 1',
                  B38: 'Dragomir B₃₈ 1',
                  B39: 'Dragomir B₃₉ 1',
                },
                sample: { B38: 0.01, B39: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₃₈ 与 B₃₉ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B38 and B39 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B38-B39-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB38B39Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB38B39Honest joint gate (0/1)',
              bodyZh:
                'S24bi packaging：B₃₈ 诚实 ∧ B₃₉ 诚实 ∧ dual→0 ∧ joint_max=0。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bi packaging: B38 ∧ B39 ∧ dual→0 ∧ joint_max=0; honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B38 * c_B39 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B38/B39 包装诚实门 0/1',
                  c_B38: 'B₃₈ vs-rect 诚实 0/1',
                  c_B39: 'B₃₉ vs-rect 诚实 0/1',
                  c_dual: 'B38/B39 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B38: 1,
                  c_B39: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B38/B39 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B38/B39 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S24bj Dragomir B40/B41 vs-rect dual residual packaging (wave34 residual compose expand)
            {
              id: 'igbt-compose-dragomir-B40-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₄₀ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₄₀ vs-rect residual',
              bodyZh:
                'S24bj：B₄₀=Σ(p−q)⁴/((pq)¹⁷(p+q)) 相对矩形占空 ref（B₃₈ 的更高阶）。匹配 p=q → B₄₀≡0；桥接 periodDragomirB40Residual + duty histogram honesty。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bj B40=Σ(p−q)⁴/((pq)¹⁷(p+q)) vs rect duty (higher-order of B38); matched p=q → B40≡0; bridges periodDragomirB40Residual + duty histogram honesty; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B40 = sum((p - q)^4 / ((p * q)^17 * (p + q)))',
                vars: {
                  B40: 'Dragomir B₄₀ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₄₀ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B40 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B41-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₄₁ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₄₁ vs-rect residual',
              bodyZh:
                'S24bj：B₄₁=Σ(√p−√q)⁴/(pq)¹⁷ 相对矩形 ref（B₃₉ 的更高阶）。匹配 → B₄₁≡0；与 B₄₀ 构成高阶 dual residual packaging。桥接 periodDragomirB41Residual。',
              bodyEn:
                'S24bj B41=Σ(√p−√q)⁴/(pq)¹⁷ vs rect (higher-order of B39); matched → 0; dual packaging with B40; bridges periodDragomirB41Residual.',
              formula: {
                expr: 'B41 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^17)',
                vars: {
                  B41: 'Dragomir B₄₁ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₄₁ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B41 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B40-B41-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₄₀ − B₄₁| Dragomir B₄₀/B₄₁ dual 残差',
              titleEn: 'Compose KPI: |B40 − B41| Dragomir B40/B41 dual residual',
              bodyZh:
                'S24bj dual packaging：匹配诚实包上 B₄₀ 与 B₄₁ 应同为零，|B₄₀−B₄₁|→0。算例 B₄₀=B₄₁=0 → 0；桥接 B40/B41 dual honesty（下接 S24bk B₄₂/B₄₃ landed）。',
              bodyEn:
                'S24bj dual packaging: matched honest pack B40=B41=0 → |B40−B41|=0; bridges B40/B41 dual honesty (next S24bk B42/B43 landed).',
              formula: {
                expr: 'res = abs(B40 - B41)',
                vars: {
                  res: 'Dragomir B40/B41 dual 绝对残差 1',
                  B40: 'Dragomir B₄₀ 1',
                  B41: 'Dragomir B₄₁ 1',
                },
                sample: { B40: 0, B41: 0 },
                expected: 0,
                plainZh: 'Dragomir B₄₀ 与 B₄₁ 之差的绝对值衡量更高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B40 and B41 measures higher-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B40-B41-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B40B41 = max(B₄₀, B₄₁) 联合上界',
              titleEn: 'Compose KPI: joint_max_B40B41 = max(B40, B41) joint upper bound',
              bodyZh:
                'S24bj 联合包装：取 B₄₀/B₄₁ 两残差上确界。匹配诚实 → 0；算例 B₄₀=0.01、B₄₁=0.02 → 0.02。',
              bodyEn:
                'S24bj joint packaging upper envelope of B40, B41; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B40, B41)',
                vars: {
                  joint_max: 'B40/B41 联合距离上确界 1',
                  B40: 'Dragomir B₄₀ 1',
                  B41: 'Dragomir B₄₁ 1',
                },
                sample: { B40: 0.01, B41: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₄₀ 与 B₄₁ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B40 and B41 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B40-B41-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB40B41Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB40B41Honest joint gate (0/1)',
              bodyZh:
                'S24bj packaging：B₄₀ 诚实 ∧ B₄₁ 诚实 ∧ dual→0 ∧ joint_max=0（period residual + duty histogram honesty）。教学金标 → 1。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bj packaging: B40 ∧ B41 ∧ dual→0 ∧ joint_max=0 (period residual + duty histogram honesty); honest gold → 1; smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B40 * c_B41 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B40/B41 包装诚实门 0/1',
                  c_B40: 'B₄₀ vs-rect 诚实 0/1',
                  c_B41: 'B₄₁ vs-rect 诚实 0/1',
                  c_dual: 'B40/B41 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B40: 1,
                  c_B41: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B40/B41 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B40/B41 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S24bk Dragomir B42/B43 vs-rect dual residual packaging (wave35 residual compose expand; solvers tip landed)
            {
              id: 'igbt-compose-dragomir-B42-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₄₂ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₄₂ vs-rect residual',
              bodyZh:
                'S24bk（landed）：B₄₂=Σ(p−q)⁴/((pq)¹⁸(p+q)) 相对矩形占空 ref（B₄₀ 的更高阶）。匹配 p=q → B₄₂≡0；桥接 periodDragomirB42Residual + duty histogram honesty。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bk (landed) B42=Σ(p−q)⁴/((pq)¹⁸(p+q)) vs rect duty (higher-order of B40); matched p=q → B42≡0; bridges periodDragomirB42Residual + duty histogram honesty; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B42 = sum((p - q)^4 / ((p * q)^18 * (p + q)))',
                vars: {
                  B42: 'Dragomir B₄₂ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₄₂ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B42 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B43-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₄₃ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₄₃ vs-rect residual',
              bodyZh:
                'S24bk（landed）：B₄₃=Σ(√p−√q)⁴/(pq)¹⁸ 相对矩形 ref（B₄₁ 的更高阶）。匹配 → B₄₃≡0；与 B₄₂ 构成高阶 dual residual packaging。桥接 periodDragomirB43Residual。',
              bodyEn:
                'S24bk (landed) B43=Σ(√p−√q)⁴/(pq)¹⁸ vs rect (higher-order of B41); matched → 0; dual packaging with B42; bridges periodDragomirB43Residual.',
              formula: {
                expr: 'B43 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^18)',
                vars: {
                  B43: 'Dragomir B₄₃ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₄₃ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B43 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B42-B43-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₄₂ − B₄₃| Dragomir B₄₂/B₄₃ dual 残差',
              titleEn: 'Compose KPI: |B42 − B43| Dragomir B42/B43 dual residual',
              bodyZh:
                'S24bk dual packaging：匹配诚实包上 B₄₂ 与 B₄₃ 应同为零，|B₄₂−B₄₃|→0。算例 B₄₂=B₄₃=0 → 0；桥接 B42/B43 dual honesty（下接 S24bl B₄₄/B₄₅ landed）。',
              bodyEn:
                'S24bk dual packaging: matched honest pack B42=B43=0 → |B42−B43|=0; bridges B42/B43 dual honesty (next S24bl B44/B45 landed).',
              formula: {
                expr: 'res = abs(B42 - B43)',
                vars: {
                  res: 'Dragomir B42/B43 dual 绝对残差 1',
                  B42: 'Dragomir B₄₂ 1',
                  B43: 'Dragomir B₄₃ 1',
                },
                sample: { B42: 0, B43: 0 },
                expected: 0,
                plainZh: 'Dragomir B₄₂ 与 B₄₃ 之差的绝对值衡量更高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B42 and B43 measures higher-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B42-B43-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B42B43 = max(B₄₂, B₄₃) 联合上界',
              titleEn: 'Compose KPI: joint_max_B42B43 = max(B42, B43) joint upper bound',
              bodyZh:
                'S24bk 联合包装：取 B₄₂/B₄₃ 两残差上确界。匹配诚实 → 0；算例 B₄₂=0.01、B₄₃=0.02 → 0.02。',
              bodyEn:
                'S24bk joint packaging upper envelope of B42, B43; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B42, B43)',
                vars: {
                  joint_max: 'B42/B43 联合距离上确界 1',
                  B42: 'Dragomir B₄₂ 1',
                  B43: 'Dragomir B₄₃ 1',
                },
                sample: { B42: 0.01, B43: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₄₂ 与 B₄₃ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B42 and B43 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B42-B43-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB42B43Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB42B43Honest joint gate (0/1)',
              bodyZh:
                'S24bk packaging：B₄₂ 诚实 ∧ B₄₃ 诚实 ∧ dual→0 ∧ joint_max=0（period residual + duty histogram honesty）。教学金标 → 1（下接 S24bl B₄₄/B₄₅ landed）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bk packaging: B42 ∧ B43 ∧ dual→0 ∧ joint_max=0 (period residual + duty histogram honesty); honest gold → 1 (next S24bl B44/B45 landed); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B42 * c_B43 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B42/B43 包装诚实门 0/1',
                  c_B42: 'B₄₂ vs-rect 诚实 0/1',
                  c_B43: 'B₄₃ vs-rect 诚实 0/1',
                  c_dual: 'B42/B43 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B42: 1,
                  c_B43: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B42/B43 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B42/B43 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },

            // S24bl Dragomir B44/B45 vs-rect dual residual packaging (wave36 residual compose expand; bridges wave35 tip; solvers tip landed)
            {
              id: 'igbt-compose-dragomir-B44-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₄₄ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₄₄ vs-rect residual',
              bodyZh:
                'S24bl（landed）：B₄₄=Σ(p−q)⁴/((pq)¹⁹(p+q)) 相对矩形占空 ref（B₄₂ 的更高阶）。匹配 p=q → B₄₄≡0；桥接 periodDragomirB44Residual + duty histogram honesty。**smoke residual ≠ eng DoD**。',
              bodyEn:
                'S24bl (landed) B44=Σ(p−q)⁴/((pq)¹⁹(p+q)) vs rect duty (higher-order of B42); matched p=q → B44≡0; bridges periodDragomirB44Residual + duty histogram honesty; smoke residual ≠ eng DoD.',
              formula: {
                expr: 'B44 = sum((p - q)^4 / ((p * q)^19 * (p + q)))',
                vars: {
                  B44: 'Dragomir B₄₄ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₄₄ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B44 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B45-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：Dragomir B₄₅ vs-rect 残差',
              titleEn: 'Compose KPI: Dragomir B₄₅ vs-rect residual',
              bodyZh:
                'S24bl（landed）：B₄₅=Σ(√p−√q)⁴/(pq)¹⁹ 相对矩形 ref（B₄₃ 的更高阶）。匹配 → B₄₅≡0；与 B₄₄ 构成高阶 dual residual packaging。桥接 periodDragomirB45Residual。',
              bodyEn:
                'S24bl (landed) B45=Σ(√p−√q)⁴/(pq)¹⁹ vs rect (higher-order of B43); matched → 0; dual packaging with B44; bridges periodDragomirB45Residual.',
              formula: {
                expr: 'B45 = sum((sqrt(p) - sqrt(q))^4 / (p * q)^19)',
                vars: {
                  B45: 'Dragomir B₄₅ 距离 1',
                  p: '直方图概率质量',
                  q: '矩形占空参考质量',
                },
                sample: { p: 0.5, q: 0.5 },
                expected: 0,
                plainZh: 'Dragomir B₄₅ 在直方图与矩形参考重合时为零',
                plainEn:
                  'Dragomir B45 is zero when the histogram matches the rectangular reference',
              },
            },
            {
              id: 'igbt-compose-dragomir-B44-B45-dual-residual',
              layer: 'foundation',
              titleZh: '合成 KPI：|B₄₄ − B₄₅| Dragomir B₄₄/B₄₅ dual 残差',
              titleEn: 'Compose KPI: |B44 − B45| Dragomir B44/B45 dual residual',
              bodyZh:
                'S24bl dual packaging：匹配诚实包上 B₄₄ 与 B₄₅ 应同为零，|B₄₄−B₄₅|→0。算例 B₄₄=B₄₅=0 → 0；桥接 B44/B45 dual honesty（下接 S24bm）。',
              bodyEn:
                'S24bl dual packaging: matched honest pack B44=B45=0 → |B44−B45|=0; bridges B44/B45 dual honesty (next S24bm).',
              formula: {
                expr: 'res = abs(B44 - B45)',
                vars: {
                  res: 'Dragomir B44/B45 dual 绝对残差 1',
                  B44: 'Dragomir B₄₄ 1',
                  B45: 'Dragomir B₄₅ 1',
                },
                sample: { B44: 0, B45: 0 },
                expected: 0,
                plainZh: 'Dragomir B₄₄ 与 B₄₅ 之差的绝对值衡量更高阶 dual residual packaging 对偶诚实',
                plainEn:
                  'Absolute difference of Dragomir B44 and B45 measures higher-order dual residual packaging honesty',
              },
            },
            {
              id: 'igbt-compose-dragomir-B44-B45-joint-max',
              layer: 'foundation',
              titleZh: '合成 KPI：joint_max_B44B45 = max(B₄₄, B₄₅) 联合上界',
              titleEn: 'Compose KPI: joint_max_B44B45 = max(B44, B45) joint upper bound',
              bodyZh:
                'S24bl 联合包装：取 B₄₄/B₄₅ 两残差上确界。匹配诚实 → 0；算例 B₄₄=0.01、B₄₅=0.02 → 0.02。',
              bodyEn:
                'S24bl joint packaging upper envelope of B44, B45; matched honest → 0; sample max(0.01,0.02)=0.02.',
              formula: {
                expr: 'joint_max = max(B44, B45)',
                vars: {
                  joint_max: 'B44/B45 联合距离上确界 1',
                  B44: 'Dragomir B₄₄ 1',
                  B45: 'Dragomir B₄₅ 1',
                },
                sample: { B44: 0.01, B45: 0.02 },
                expected: 0.02,
                plainZh: '联合距离上确界取 Dragomir B₄₄ 与 B₄₅ 残差之最大',
                plainEn:
                  'Joint distance upper bound is the max of Dragomir B44 and B45 residuals',
              },
            },
            {
              id: 'igbt-compose-dragomir-B44-B45-honesty-gate',
              layer: 'foundation',
              titleZh: '合成 KPI：dragomirB44B45Honest 联合门（0/1）',
              titleEn: 'Compose KPI: dragomirB44B45Honest joint gate (0/1)',
              bodyZh:
                'S24bl packaging：B₄₄ 诚实 ∧ B₄₅ 诚实 ∧ dual→0 ∧ joint_max=0（period residual + duty histogram honesty）。教学金标 → 1（下接 S24bm）。**smoke residual expand ≠ eng DoD**。',
              bodyEn:
                'S24bl packaging: B44 ∧ B45 ∧ dual→0 ∧ joint_max=0 (period residual + duty histogram honesty); honest gold → 1 (next S24bm); smoke residual expand ≠ eng DoD.',
              formula: {
                expr: 'gate = c_B44 * c_B45 * c_dual * c_joint',
                vars: {
                  gate: 'Dragomir B44/B45 包装诚实门 0/1',
                  c_B44: 'B₄₄ vs-rect 诚实 0/1',
                  c_B45: 'B₄₅ vs-rect 诚实 0/1',
                  c_dual: 'B44/B45 dual 诚实 0/1',
                  c_joint: 'joint_max 上界诚实 0/1',
                },
                sample: {
                  c_B44: 1,
                  c_B45: 1,
                  c_dual: 1,
                  c_joint: 1,
                },
                expected: 1,
                plainZh: 'Dragomir B44/B45 包装诚实门为四个子诚实标志之积，全真时为 1',
                plainEn:
                  'Dragomir B44/B45 packaging honesty gate is the product of four sub-honesty flags; all-true yields 1',
              },
            },
          ],
        },
        {
          id: 'igbt-L0',
          layer: 'L0',
          titleZh: 'L0：热阻 / 结温教学叶子',
          titleEn: 'L0: Rθ / junction teaching',
          bodyZh:
            '教学可用单支路 Rθ 与阶跃温升演示；不计入 engineering DoD。完整多层 Foster / multi-pulse duty / Dragomir residual 归 solvers-thermal（S24 残差 tip 含 B32–B45 / S24bl landed，smoke≠eng DoD）。',
          bodyEn:
            'Teaching single-branch Rθ demos allowed; eng multilayer Foster / multi-pulse duty / Dragomir residual lives in solvers-thermal (S24 residual tip incl. B32–B45 / S24bl landed; smoke≠eng DoD).',
        },
      ],
    },
  }
