import type { ApplicationProfile } from '../types'

export const app_fuel_cell: ApplicationProfile = {
    id: 'app-fuel-cell',
    name: '燃料电池',
    nameEn: 'Fuel cell',
    icon: '⛽⚡',
    category: 'energy',
    blurb:
      '化学能 → 电能：氢/燃料在电极上电化学氧化，电子走外电路、离子走电解质——不经燃烧热机，不受卡诺循环直接限制。',
    goal: { from: 'chemical', to: 'electric' },
    maturity: '商用（车用质子交换膜 / 固定式固体氧化物）',
    products: [
      { vendor: 'Toyota', model: 'Mirai 质子交换膜 电堆', spec: '~128 kW 车用' },
      { vendor: 'Bloom Energy', model: 'Energy Server 固体氧化物燃料电池', spec: '电效率约 50–60%（低热值）' },
      { vendor: 'Ballard', model: 'FCgen / FCmove', spec: '公交与商用车模块' },
    ],
    levels: [
      {
        id: 'fc-system',
        name: '系统层 · 电堆 + 平衡装置',
        nameEn: 'System: stack + balance of plant',
        summary:
          '燃料处理、空压/加湿、热管理与 DC 输出。系统净 η = 堆效率 − 寄生功耗；路径效率把燃料化学㶲报到并网点。',
        energyNodeIds: ['chemical', 'chemical-electrochemical', 'electric', 'el-current', 'thermal'],
        edgeIds: [
          'chemical-to-electric-fuelcell',
          'chemical-to-electric-fuelcell-direct',
          'chemical-to-electric-pemfc',
          'chemical-to-electric-sofc',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-exergy-efficiency',
          'method-exergy-analysis',
          'method-lumped-circuit',
        ],
        simPaths: ['paths', 'matrix', 'rlc'],
        children: [
          {
            id: 'fc-stack',
            name: '电堆层 · 质子交换膜 / 固体氧化物路线',
            nameEn: 'Stack: PEM vs SOFC',
            summary:
              '低温 质子交换膜 高功率密度、冷启动；高温 固体氧化物燃料电池 可内重整、电效率更高。两者都是 化学→电流，器件与温区不同。',
            energyNodeIds: [
              'chemical',
              'chemical-electrochemical',
              'chemical-bond',
              'electric',
              'el-current',
              'thermal',
            ],
            edgeIds: [
              'chemical-to-electric-pemfc',
              'chemical-to-electric-sofc',
              'chemical-to-electric-fuelcell',
              'chemical-combustion-to-electric-fuelcell',
            ],
            methodIds: [
              'method-lumped-circuit',
              'method-algo-series-rlc',
              'method-algo-rc-rl-transient',
              'method-algo-eta-product',
              'method-heat-ftcs',
            ],
            simPaths: ['rlc', 'transient', 'sim'],
            children: [
              {
                id: 'fc-mea',
                name: '膜电极组件层 · 三相界面',
                nameEn: 'MEA: triple-phase boundary',
                summary:
                  '阳极氧化 / 阴极氧还原、质子或 O²⁻ 迁移、电子外电路。活化、欧姆、浓差过电位决定 伏安 曲线；扩散与动力学蒙特卡洛作教学类比。',
                energyNodeIds: ['chemical-electrochemical', 'chemical', 'electric', 'thermal'],
                edgeIds: [
                  'chemical-electrochemical-to-electric',
                  'chemical-to-electric-fuelcell',
                  'chemical-to-electric-fuelcell-direct',
                ],
                methodIds: [
                  'method-heat-ftcs',
                  'method-algo-heat-erfc',
                  'method-algo-fluid-diffuse',
                  'method-kmc',
                  'method-algo-kmc-rates',
                  'method-algo-kmc-step',
                ],
                simPaths: ['sim', 'heaterfc'],
                children: [
                  {
                    id: 'fc-materials',
                    name: '材料层 · 催化剂与电解质',
                    nameEn: 'Materials: catalyst & electrolyte',
                    summary:
                      '铂系氧还原催化、聚合物膜含水电导，或氧化钇稳定氧化锆高温氧离子导体。分子动力学/密度泛函给微观输运与吸附直觉。',
                    energyNodeIds: ['chemical', 'chemical-bond', 'chemical-electrochemical'],
                    methodIds: [
                      'method-md-lj',
                      'method-algo-lj-pair',
                      'method-algo-velocity-verlet',
                      'method-dft-electronic',
                      'method-algo-ks-scf',
                      'method-phasefield',
                    ],
                    simPaths: ['md'],
                    children: [
                      {
                        id: 'fc-waste-heat',
                        name: '热管理层 · 反应余热',
                        nameEn: 'Thermal: waste heat',
                        summary:
                          'TΔS 与过电位以热放出：质子交换膜 需冷却，固体氧化物燃料电池 可热电联产。废热边与电效率互补记账。',
                        energyNodeIds: ['chemical', 'thermal', 'electric'],
                        edgeIds: [
                          'chemical-to-thermal-fuelcell-waste',
                          'electric-to-thermal-joule',
                          'thermal-to-thermal-heatexchange',
                        ],
                        methodIds: [
                          'method-heat-ftcs',
                          'method-algo-heat-implicit',
                          'method-algo-exergy-lost-work',
                          'method-algo-eta-product',
                          'method-algo-exergy-carnot',
                        ],
                        simPaths: ['sim', 'convection', 'paths'],
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
