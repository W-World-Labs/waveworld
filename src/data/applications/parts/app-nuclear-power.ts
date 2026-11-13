import type { ApplicationProfile } from '../types'

export const app_nuclear_power: ApplicationProfile = {
    id: 'app-nuclear-power',
    name: '核电站 / 热机发电链',
    nameEn: 'Nuclear power plant',
    icon: '⚛️',
    category: 'energy',
    blurb:
      '核能 → 热能 → 机械能 → 电能：裂变热驱动朗肯循环汽轮机，再经发电机并网。系统账本与㶲极限一目了然。',
    goal: { from: 'nuclear', to: 'electric' },
    maturity: '商用基荷',
    products: [
      { vendor: '压水堆 PWR', model: '二回路汽轮机组', spec: '热效率 ~33%' },
      { vendor: '高温气冷堆', model: '布雷顿 / 超临界', spec: '更高热端温度' },
    ],
    levels: [
      {
        id: 'np-plant',
        name: '系统层 · 核电厂',
        summary:
          '堆芯释热 → 一/二回路传热 → 汽轮机–发电机 → 并网。整体 η 受卡诺上限与冷却端约束，可用路径效率连乘拆账。',
        energyNodeIds: ['nuclear', 'thermal', 'mechanical', 'electric'],
        edgeIds: [
          'nuclear-to-electric-overall-plant',
          'nuclear-to-electric-plant',
          'nuclear-to-thermal-fission-heat',
        ],
        methodIds: [
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-carnot',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'np-core-heat',
            name: '堆芯层 · 裂变释热',
            summary:
              '裂变碎片动能热化 + 缓发衰变热：核结合能差额变为可导出的热功率。冷却剂把热送到蒸汽发生器。',
            energyNodeIds: [
              'nuclear',
              'nuclear-fission',
              'nuclear-binding',
              'thermal',
              'thermal-internal',
              'mass-fission',
            ],
            edgeIds: [
              'nuclear-to-thermal-fission-heat',
              'nuclear-fission-to-thermal',
              'nuclear-binding-to-fission',
              'mass-fission-to-thermal',
              'nuclear-to-thermal-decay-heat',
            ],
            methodIds: [
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
              'method-algo-heat-erfc',
              'method-monte-carlo',
              'method-algo-uq-mc',
            ],
            simPaths: ['sim', 'heaterfc'],
            children: [
              {
                id: 'np-secondary-loop',
                name: '热机层 · 朗肯 / 布雷顿',
                summary:
                  '高压蒸汽（或气轮机工质）膨胀做功：热→机械。㶲效率由热端/冷端温比与不可逆损失决定。',
                energyNodeIds: ['thermal', 'thermal-internal', 'mechanical', 'mechanical-rotational'],
                edgeIds: [
                  'thermal-to-mechanical-rankine',
                  'thermal-to-mechanical-brayton',
                  'nuclear-to-mechanical-rankine-turbine',
                  'thermal-internal-to-mechanical-heatengine',
                  'thermal-to-mechanical-organic-rankine',
                ],
                methodIds: [
                  'method-algo-exergy-carnot',
                  'method-algo-exergy-lost-work',
                  'method-algo-exergy-efficiency',
                  'method-ns-stable-fluids',
                  'method-algo-fluid-pipeline',
                  'method-pid',
                  'method-algo-pid-step',
                ],
                simPaths: ['fluid', 'convection'],
                children: [
                  {
                    id: 'np-generator',
                    name: '机电层 · 同步发电机',
                    summary:
                      '汽轮机轴功 → 电磁感应 → 电网电能。法拉第感应与集总谐振电路是发电机侧的可动手原子。',
                    energyNodeIds: ['mechanical', 'mechanical-rotational', 'electric', 'el-current'],
                    edgeIds: [
                      'mechanical-to-electric-generator',
                      'mechanical-to-electric-electromagnetic-induction',
                      'edge-rotational-to-electric-flywheel',
                    ],
                    methodIds: [
                      'method-algo-faraday',
                      'method-lumped-circuit',
                      'method-algo-series-rlc',
                      'method-algo-mutual',
                    ],
                    simPaths: ['faraday', 'rlc', 'mutual'],
                    children: [
                      {
                        id: 'np-loss-ledger',
                        name: '损失账本 · 冷凝与㶲',
                        summary:
                          '冷凝器排热、泵功、厂用电、衰变热管理……把「名牌热效率」拆成可解释的损失项。',
                        energyNodeIds: ['thermal', 'electric', 'nuclear'],
                        edgeIds: [
                          'thermal-to-thermal-heatexchange',
                          'nuclear-to-thermal-decay-heat',
                        ],
                        methodIds: [
                          'method-algo-eta-product',
                          'method-algo-exergy-lost-work',
                          'method-algo-pue-factor',
                          'method-path-efficiency',
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
