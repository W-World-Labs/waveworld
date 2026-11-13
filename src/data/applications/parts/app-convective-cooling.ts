import type { ApplicationProfile } from '../types'

export const app_convective_cooling: ApplicationProfile = {
    id: 'app-convective-cooling',
    name: '对流传热 / 强制冷却',
    nameEn: 'Convective cooling (Nu–Re–Pr)',
    icon: '🌬️🔥',
    category: 'device',
    blurb:
      '热源热能 → 边界层/通道流体对流 → 冷端热汇：用雷诺 Re、努塞尔 Nu、普朗特 Pr 与傅里叶导热读一条 热→热能 的对流传热账本（流体机械为媒介）。',
    goal: { from: 'thermal', to: 'thermal' },
    familyId: 'family-heat-transfer',
    familyRole: '强制/自然对流冷却 · 努塞尔–雷诺–普朗特',
    assemblyNote:
      '相对固体傅里叶纯导热：同族热→热空间输送，但本档案核心是流体携带热对流（Nu=hL/k 相对纯导热增强），Re 定流态、Pr 定物性。相对换热器/热泵边 热→热换热：共享有限温差换热账本，但下钻到无量纲关联而非 性能系数。',
    maturity: '商用（电子散热/换热器/建筑暖通）',
    products: [
      { vendor: 'Noctua / Cooler Master', model: 'CPU 风冷散热器', spec: '翅片 + 轴流风扇强制对流' },
      { vendor: 'Alfa Laval', model: '板式换热器', spec: '通道 Re–Nu 关联设计' },
      { vendor: '液冷机柜 / 数据中心 CDU', model: '冷板 + 冷却液回路', spec: '高热流芯片强制对流' },
    ],
    levels: [
      {
        id: 'cc-system',
        name: '系统层 · 对流冷却链路',
        nameEn: 'System: convective cooling chain',
        summary:
          '热源壁面 → 流体边界层/通道对流 → 冷端排热。目标 热→热能；流体机械动能是媒介而非终点。Re 定层流/湍流，Nu 给 h，Pr 耦合动量与热扩散；壁内仍用傅里叶导热闭环。',
        energyNodeIds: [
          'thermal',
          'thermal-internal',
          'mechanical',
          'mechanical-kinetic',
        ],
        edgeIds: [
          'thermal-to-thermal-nusselt-convection',
          'mechanical-to-thermal-viscous-reynolds',
          'thermal-to-thermal-view-factor-radiation',
          'thermal-to-thermal-heatexchange',
          'thermal-to-thermal-fourier-conduction',
          'mechanical-to-thermal-viscous-damping',
          'mechanical-kinetic-to-thermal-viscous-stokes',
          'thermal-to-gravitational-buoyant-lofting',
        ],
        methodIds: [
          'method-reynolds-number',
          'method-algo-reynolds',
          'method-nusselt-number',
          'method-algo-nusselt',
          'method-prandtl-number',
          'method-algo-prandtl',
          'method-fourier-law',
          'method-algo-fourier-flux',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-exergy-analysis',
        ],
        simPaths: ['convection', 'fluid', 'sim', 'paths'],
        children: [
          {
            id: 'cc-forced-flow',
            name: '流态层 · 雷诺数 Re',
            nameEn: 'Flow regime: Reynolds number',
            summary:
              '通道/外掠特征速度 U、长度 L 与粘度 μ 组成 Re=ρUL/μ。层流/过渡/湍流切换边界层厚度与混合强度，是 Nu 关联式的第一自变量；泵/风扇提供机械动能媒介。',
            energyNodeIds: ['mechanical', 'mechanical-kinetic', 'thermal'],
            edgeIds: [
              'mechanical-to-thermal-viscous-damping',
              'mechanical-kinetic-to-thermal-viscous-stokes',
              'thermal-to-gravitational-buoyant-lofting',
              'thermal-to-thermal-heatexchange',
            ],
            methodIds: [
              'method-reynolds-number',
              'method-algo-reynolds',
              'method-ns-stable-fluids',
              'method-algo-fluid-pipeline',
              'method-algo-fluid-advect',
              'method-algo-fluid-project',
              'method-mach-number',
              'method-algo-mach',
            ],
            simPaths: ['fluid', 'windtunnel', 'convection'],
            children: [
              {
                id: 'cc-nusselt-pr',
                name: '换热层 · 努塞尔–普朗特 关联',
                nameEn: 'Heat transfer: Nu–Pr correlation',
                summary:
                  'Nu=hL/k 把对流传热系数 h 无量纲化；Pr=ν/α=μcp/k 定动量/热扩散比。工程关联 Nu=C·Re^m·Pr^n 把流态与物性接到可设计的 h，闭合热→热输送份额。',
                energyNodeIds: ['thermal', 'thermal-internal', 'mechanical'],
                edgeIds: [
                  'thermal-to-thermal-heatexchange',
                  'thermal-to-thermal-fourier-conduction',
                  'mechanical-to-thermal-viscous-damping',
                ],
                methodIds: [
                  'method-nusselt-number',
                  'method-algo-nusselt',
                  'method-prandtl-number',
                  'method-algo-prandtl',
                  'method-reynolds-number',
                  'method-algo-reynolds',
                  'method-algo-fluid-buoyancy',
                  'method-algo-exergy-lost-work',
                  'method-path-efficiency',
                ],
                simPaths: ['convection', 'fluid', 'paths'],
                children: [
                  {
                    id: 'cc-wall-fourier',
                    name: '壁面层 · 傅里叶导热',
                    nameEn: 'Wall: Fourier conduction',
                    summary:
                      '固体壁/翅片内 q=−k∇T 把热量从器件芯部送到对流面；与 Nu 边界条件串联。热→热傅里叶导热 是纯导热对照；接触热阻与侧向漏热进损失账本。',
                    energyNodeIds: ['thermal', 'thermal-internal'],
                    edgeIds: [
                      'thermal-to-thermal-fourier-conduction',
                      'thermal-to-thermal-heatexchange',
                    ],
                    methodIds: [
                      'method-fourier-law',
                      'method-algo-fourier-flux',
                      'method-heat-ftcs',
                      'method-algo-heat-ftcs-step',
                      'method-algo-heat-erfc',
                      'method-nusselt-number',
                      'method-algo-nusselt',
                      'method-algo-exergy-efficiency',
                      'method-path-efficiency',
                      'method-algo-eta-product',
                    ],
                    simPaths: ['sim', 'heaterfc', 'paths'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
