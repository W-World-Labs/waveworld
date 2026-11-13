import type { ApplicationProfile } from '../types'

export const app_diesel_genset: ApplicationProfile = {
    id: 'app-diesel-genset',
    name: '柴油发电机',
    nameEn: 'Diesel genset',
    icon: '🛢️⚡',
    category: 'energy',
    blurb:
      '柴油化学能 → 压燃燃烧热 → 活塞/曲轴机械功 → 发电机电能：经典内燃机–发电机组，热机路径受卡诺上界约束。',
    goal: { from: 'chemical', to: 'electric' },
    familyId: 'family-ice-thermal-mechanical',
    familyRole: '柴油压燃 · 化学源热机发电',
    assemblyNote:
      '相对汽油奥托循环：同为往复活塞内燃机→发电机，但本档案以柴油循环(等压加热、截止比 rc)与 柴油循环方法 记账。相对燃气轮机：源同为 化学能 燃烧，但膨胀机是往复活塞而非透平。汇侧与水电/风机共享电磁感应发电机层。',
    maturity: '商用主力（备用电源 / 海运 / 离网）',
    products: [
      { vendor: 'Cummins / Caterpillar', model: '柴油发电机组', spec: '数十 kW–数 MW 备用与基载' },
      { vendor: 'Wärtsilä / MAN', model: '中速船用柴油机', spec: '制动热效率 可达 ~50%' },
    ],
    levels: [
      {
        id: 'dg-system',
        name: '系统层 · 柴发机组 / 并网',
        nameEn: 'System: genset / grid-tied',
        summary:
          '燃料化学能 → 内燃机轴功 → 发电机 → 配电。路径账本 化学→热→机械→电；η 连乘与㶲对照「铭牌油耗」与卡诺上界。',
        energyNodeIds: [
          'chemical',
          'chemical-bond',
          'chemical-combustion',
          'thermal',
          'mechanical',
          'mechanical-rotational',
          'electric',
          'el-current',
        ],
        edgeIds: [
          'chemical-to-mechanical-ice',
          'chemical-to-mechanical-diesel-ice',
          'chemical-to-thermal-combustion',
          'thermal-to-mechanical-diesel-expansion',
          'mechanical-to-electric-generator',
          'mechanical-to-electric-electromagnetic-induction',
        ],
        methodIds: [
          'method-diesel',
          'method-algo-diesel-eta',
          'method-carnot',
          'method-algo-carnot-eta',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-efficiency',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'dg-fuel-chem',
            name: '燃料层 · 柴油化学能',
            nameEn: 'Fuel: diesel chemical energy',
            summary:
              '轻质馏分油化学键能 / 低位热值是源账本。喷射雾化与空燃比决定燃烧完全度；化学键→燃烧热是第一跳。',
            energyNodeIds: ['chemical', 'chemical-bond', 'chemical-combustion', 'thermal'],
            edgeIds: [
              'chemical-to-thermal-combustion',
              'chemical-to-mechanical-ice',
              'chemical-to-mechanical-diesel-ice',
            ],
            methodIds: [
              'method-path-efficiency',
              'method-algo-eta-product',
              'method-algo-exergy-efficiency',
              'method-exergy-analysis',
              'method-diesel',
            ],
            simPaths: ['paths'],
            children: [
              {
                id: 'dg-combustion',
                name: '燃烧 / 热层 · 压燃放热',
                nameEn: 'Combustion: compression-ignition heat',
                summary:
                  '高压喷射后压燃：化学→热能（高温工质）。柴油循环以等压加热段建模；与奥托等容加热对拍，用 柴油循环方法。',
                energyNodeIds: [
                  'chemical',
                  'chemical-combustion',
                  'thermal',
                  'thermal-internal',
                ],
                edgeIds: [
                  'chemical-to-thermal-combustion',
                  'chemical-to-mechanical-ice',
                ],
                methodIds: [
                  'method-diesel',
                  'method-algo-diesel-eta',
                  'method-otto',
                  'method-algo-otto-eta',
                  'method-carnot',
                  'method-algo-carnot-eta',
                  'method-heat-ftcs',
                  'method-algo-exergy-carnot',
                ],
                simPaths: ['sim', 'paths'],
                children: [
                  {
                    id: 'dg-expansion',
                    name: '膨胀层 · 热→机械轴功',
                    nameEn: 'Expansion: thermal → mechanical',
                    summary:
                      '高温高压燃气推动活塞膨胀，曲轴输出 机械转动。热→机械奥托膨胀 与 化学→机械内燃 描述这一跳；摩擦与冷却是中间 η。',
                    energyNodeIds: [
                      'thermal',
                      'thermal-internal',
                      'mechanical',
                      'mechanical-kinetic',
                      'mechanical-rotational',
                    ],
                    edgeIds: [
                      'thermal-to-mechanical-otto-gas-expansion',
                      'chemical-to-mechanical-ice',
                      'mechanical-to-mechanical-transmission',
                      'edge-kinetic-to-thermal-friction',
                    ],
                    methodIds: [
                      'method-diesel',
                      'method-algo-diesel-eta',
                      'method-algo-carnot-eta',
                      'method-algo-eta-product',
                      'method-algo-exergy-lost-work',
                      'method-algo-exergy-efficiency',
                    ],
                    simPaths: ['paths'],
                    children: [
                      {
                        id: 'dg-generator',
                        name: '机电层 · 同步/异步发电机',
                        nameEn: 'Generator: electromagnetic',
                        summary:
                          '曲轴旋转功 → 电磁感应 → 工频/变频电能。与风电/水电发电机层共享法拉第与谐振电路原子。',
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
                          'method-algo-faraday',
                          'method-lumped-circuit',
                          'method-algo-series-rlc',
                          'method-algo-mutual',
                          'method-path-efficiency',
                          'method-algo-eta-product',
                        ],
                        simPaths: ['faraday', 'rlc', 'mutual'],
                        children: [
                          {
                            id: 'dg-loss-ledger',
                            name: '损失账本 · 卡诺 / 柴油 η / 电损',
                            nameEn: 'Loss ledger',
                            summary:
                              '排气与冷却热、机械摩擦、铜铁耗与变流……用柴油循环 η、卡诺上界与 η 连乘把「克/千瓦时」拆成可解释项。',
                            energyNodeIds: [
                              'chemical',
                              'thermal',
                              'mechanical-rotational',
                              'electric',
                            ],
                            edgeIds: [
                              'chemical-to-thermal-combustion',
                              'edge-kinetic-to-thermal-friction',
                              'electric-to-thermal-joule',
                              'chemical-to-mechanical-ice',
                              'mechanical-to-electric-generator',
                            ],
                            methodIds: [
                              'method-algo-diesel-eta',
                              'method-algo-carnot-eta',
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
