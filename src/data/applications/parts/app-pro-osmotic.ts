import type { ApplicationProfile } from '../types'

export const app_pro_osmotic: ApplicationProfile = {
    id: 'app-pro-osmotic',
    name: '渗透能发电',
    nameEn: 'Pressure-retarded osmosis',
    icon: '🌊⚡',
    category: 'energy',
    blurb:
      '淡水–海水盐差化学㶲 → 半透膜渗透压驱动 → 加压汲取液透平 → 电能：压力延迟渗透盐差发电。',
    goal: { from: 'chemical', to: 'electric' },
    familyId: 'family-salinity-gradient',
    familyRole: '压力延迟渗透',
    assemblyNote:
      '相对反电渗析(反向电渗析)：同为盐差化学㶲→电，但本档案走「渗透压→液压功→透平→发电机」机械中间链，而非离子选择膜直接电化学。相对水电：汇侧同为透平+电磁感应，源从水头势能换成浓度差化学㶲。',
    maturity: '示范 / 试点',
    products: [
      { vendor: 'Statkraft（历史试点）', model: 'Tofte 压力延迟渗透 试点', spec: 'kW 级膜模块示范' },
      { vendor: '研究系统', model: '中空纤维 / 平板 压力延迟渗透 膜堆', spec: '功率密度 W/m² 级' },
    ],
    levels: [
      {
        id: 'pro-system',
        name: '系统层 · 盐差发电厂',
        nameEn: 'System: salinity-gradient plant',
        summary:
          '淡水源 + 海水/汲取液 → 膜模块 → 增压透平 → 并网。顶层目标 化学→电能；用路径效率与㶲把「可提取盐差功」报到并网点。',
        energyNodeIds: [
          'chemical',
          'mechanical',
          'mechanical-kinetic',
          'mechanical-rotational',
          'electric',
          'el-current',
        ],
        edgeIds: [
          'chemical-to-electric-salinity-gradient-pro',
        ],
        methodIds: [
          'method-osmotic-power',
          'method-algo-pro-power',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-efficiency',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'pro-salinity',
            name: '盐差层 · 化学㶲源',
            nameEn: 'Salinity: chemical exergy source',
            summary:
              '浓度差对应的混合自由能 / 范特霍夫 渗透压 π≈iCRT 是源账本。稀释与浓缩侧流量比决定可提取功上界。',
            energyNodeIds: ['chemical', 'thermal'],
            edgeIds: [
              'chemical-to-electric-salinity-gradient-pro',
            ],
            methodIds: [
              'method-osmotic-power',
              'method-algo-pro-power',
              'method-algo-exergy-efficiency',
              'method-algo-exergy-lost-work',
              'method-exergy-analysis',
            ],
            simPaths: ['paths'],
            children: [
              {
                id: 'pro-membrane',
                name: '膜层 · 压力延迟渗透',
                nameEn: 'Membrane: PRO',
                summary:
                  '水透过半透膜进入加压汲取侧：渗透压差 Δπ 驱动体积流 Q，功率原子 P≈η·Δπ·Q（压力延缓渗透功率算法）。浓差极化与膜阻力是主损失。',
                energyNodeIds: [
                  'chemical',
                  'mechanical',
                  'mechanical-kinetic',
                  'thermal',
                ],
                methodIds: [
                  'method-osmotic-power',
                  'method-algo-pro-power',
                  'method-algo-fluid-diffuse',
                  'method-ns-stable-fluids',
                  'method-algo-eta-product',
                  'method-heat-ftcs',
                ],
                simPaths: ['fluid', 'paths'],
                children: [
                  {
                    id: 'pro-hydro',
                    name: '液压 / 透平层 · 压能→轴功',
                    nameEn: 'Hydro turbine: pressure → shaft',
                    summary:
                      '加压汲取液经水轮机/能量回收透平转为 机械转动。与水电轮机同构，工质压力来自渗透而非库水位。',
                    energyNodeIds: [
                      'mechanical',
                      'mechanical-kinetic',
                      'mechanical-rotational',
                      'acoustic',
                    ],
                    edgeIds: [
                      'mechanical-to-mechanical-transmission',
                      'edge-kinetic-to-rotational-wind',
                    ],
                    methodIds: [
                      'method-algo-pro-power',
                      'method-ns-stable-fluids',
                      'method-algo-fluid-pipeline',
                      'method-algo-eta-product',
                      'method-algo-exergy-efficiency',
                    ],
                    simPaths: ['fluid', 'windtunnel'],
                    children: [
                      {
                        id: 'pro-generator',
                        name: '机电层 · 发电机',
                        nameEn: 'Generator: electromagnetic',
                        summary:
                          '透平轴功 → 电磁感应 → 电能。与水电/柴发发电机层共享法拉第原子；总链 化学→机械→电能。',
                        energyNodeIds: [
                          'mechanical-rotational',
                          'mechanical',
                          'electric',
                          'el-current',
                        ],
                        edgeIds: [
                          'mechanical-to-electric-generator',
                          'mechanical-to-electric-electromagnetic-induction',
                          'mechanical-rotational-to-el-current-turbo-generator',
                        ],
                        methodIds: [
                          'method-algo-pro-power',
                          'method-algo-faraday',
                          'method-lumped-circuit',
                          'method-algo-series-rlc',
                          'method-path-efficiency',
                          'method-algo-eta-product',
                        ],
                        simPaths: ['faraday', 'rlc', 'paths'],
                        children: [
                          {
                            id: 'pro-loss-ledger',
                            name: '损失账本 · 极化 / 泵功 / 电损',
                            nameEn: 'Loss ledger',
                            summary:
                              '浓差极化、进料泵寄生功耗、膜污堵、透平与铜铁耗……η 连乘把「理论混合功」拆成工程净输出。',
                            energyNodeIds: [
                              'chemical',
                              'mechanical',
                              'electric',
                              'thermal',
                            ],
                            edgeIds: [
                              'electric-to-thermal-joule',
                              'edge-kinetic-to-thermal-friction',
                              'mechanical-to-electric-generator',
                            ],
                            methodIds: [
                              'method-algo-pro-power',
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
      },
    ],
  }
