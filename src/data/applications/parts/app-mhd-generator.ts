import type { ApplicationProfile } from '../types'

export const app_mhd_generator: ApplicationProfile = {
    id: 'app-mhd-generator',
    name: '磁流体发电',
    nameEn: 'Magnetohydrodynamic generator',
    icon: '🧲⚡',
    category: 'energy',
    blurb:
      '高温导电流体（热/燃烧等离子体）高速穿过磁场，洛伦兹力分离电荷 → 电极取电：热能/化学能→电能，无旋转机械中间轴。',
    goal: { from: 'thermal', to: 'electric' },
    familyId: 'family-mhd-generator',
    familyRole: '开环磁流体 · 热/等离子体源',
    assemblyNote:
      '相对汽轮发电机：省去「热→旋转机械」一跳，直接热/化学导电流体 × B 场 → 电。相对热电塞贝克：同为无大轴静默发电，但机理是体积洛伦兹力而非固体温差扩散。燃烧磁流体可把源接到化学能。',
    maturity: '示范 / 特种研究',
    products: [
      { vendor: '历史示范', model: '开环燃烧磁流体通道', spec: 'MW 级短时试验' },
      { vendor: '航天 / 脉冲电源', model: '脉冲磁流体发电机', spec: '高功率密度短脉冲' },
    ],
    levels: [
      {
        id: 'mhd-system',
        name: '系统层 · 磁流体发电岛',
        nameEn: 'System: MHD island',
        summary:
          '热源/燃烧器 → 导电流体加速 → 磁流体通道 → 电极与逆变器。总路径 热能（或 化学能）→ 电能；用路径效率与㶲对照「有无汽轮机」的嵌套代价。',
        energyNodeIds: ['thermal', 'chemical', 'electric', 'el-current', 'mechanical-kinetic'],
        edgeIds: [
          'thermal-to-electric-magnetohydrodynamic',
          'chemical-to-electric-mhd',
        ],
        methodIds: [
          'method-mhd-generator',
          'method-algo-mhd-emf',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-carnot',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'mhd-source',
            name: '热源 / 工质层 · 导电等离子体',
            nameEn: 'Source: conductive plasma fluid',
            summary:
              '燃烧或外加热使工质电离、电导率 σ 上升；可选 种子 碱金属。化学燃烧路线挂 化学→电磁流体，纯热路线挂热磁流体边。',
            energyNodeIds: ['thermal', 'thermal-internal', 'chemical', 'mechanical-kinetic'],
            edgeIds: [
              'thermal-to-electric-magnetohydrodynamic',
              'chemical-to-electric-mhd',
              'radiant-to-thermal-absorption',
            ],
            methodIds: [
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
              'method-particle-in-cell',
              'method-algo-pic-push',
              'method-ns-stable-fluids',
              'method-algo-exergy-carnot',
            ],
            simPaths: ['sim', 'fluid'],
            children: [
              {
                id: 'mhd-channel',
                name: '通道层 · 导电流体 × B',
                nameEn: 'Channel: conductive flow × B',
                summary:
                  '高速导电流体穿过外加磁场：j = σ(E + v×B)。法拉第/霍尔拓扑决定电极布置；流体与电磁场强耦合。',
                energyNodeIds: [
                  'mechanical-kinetic',
                  'thermal',
                  'electric',
                  'el-current',
                  'electromagnetic',
                ],
                edgeIds: [
                  'thermal-to-electric-magnetohydrodynamic',
                  'chemical-to-electric-mhd',
                ],
                methodIds: [
                  'method-mhd-generator',
                  'method-algo-mhd-emf',
                  'method-particle-in-cell',
                  'method-algo-pic-cic',
                  'method-algo-pic-boris',
                  'method-vlasov',
                  'method-algo-vlasov-stream',
                  'method-ns-stable-fluids',
                  'method-algo-fluid-project',
                  'method-algo-partitioned-coupling',
                ],
                simPaths: ['fluid', 'paths'],
                children: [
                  {
                    id: 'mhd-electrodes',
                    name: '电极 / 负载层 · 取电',
                    nameEn: 'Electrodes & load',
                    summary:
                      '洛伦兹分离的电荷经电极流入外电路。集总电路与互感原子描述负载匹配；法拉第感应给 v×B 电动势直觉。',
                    energyNodeIds: ['electric', 'el-current', 'electromagnetic', 'thermal'],
                    edgeIds: [
                      'thermal-to-electric-magnetohydrodynamic',
                      'chemical-to-electric-mhd',
                      'electric-to-thermal-joule',
                    ],
                    methodIds: [
                      'method-algo-mhd-emf',
                      'method-mhd-generator',
                      'method-algo-faraday',
                      'method-lumped-circuit',
                      'method-algo-series-rlc',
                      'method-algo-mutual',
                      'method-algo-exergy-efficiency',
                    ],
                    simPaths: ['faraday', 'rlc', 'mutual'],
                    children: [
                      {
                        id: 'mhd-loss-ledger',
                        name: '损失账本 · 焦耳 / 边界 / 霍尔',
                        nameEn: 'Loss ledger',
                        summary:
                          '焦耳热、近壁边界层、霍尔漏电与流体动能未回收……η 连乘与㶲损失把「理想磁流体」拆成工程账。',
                        energyNodeIds: ['thermal', 'mechanical-kinetic', 'electric', 'el-current'],
                        edgeIds: [
                          'thermal-to-electric-magnetohydrodynamic',
                          'electric-to-thermal-joule',
                          'edge-kinetic-to-thermal-friction',
                        ],
                        methodIds: [
                          'method-mhd-generator',
                          'method-algo-eta-product',
                          'method-algo-exergy-lost-work',
                          'method-algo-exergy-efficiency',
                          'method-path-efficiency',
                          'method-algo-path-mc-eta',
                        ],
                        simPaths: ['paths', 'matrix'],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
