import type { ApplicationProfile } from '../types'

export const app_hydro_plant: ApplicationProfile = {
    id: 'app-hydro-plant',
    name: '水力发电厂',
    nameEn: 'Hydroelectric power plant',
    icon: '🏞️⚡',
    category: 'energy',
    blurb:
      '水库水头（引力势能）→ 引水动能 → 水轮机旋转 → 发电机电能：经典「重力→机械→电」多级转换，不是热机朗肯链。',
    goal: { from: 'gravitational', to: 'electric' },
    familyId: 'family-hydro-power',
    familyRole: '常规水电站 · 水头驱动',
    assemblyNote:
      '相对抽蓄放电(抽水蓄能)：同为引力势能汇到电，但本档案强调单向发电链（库→管→轮机→机）。相对风力(风力透平应用)：汇侧同为旋转发电机与电磁感应，源从气流动能换成水头/重力势能。',
    maturity: '商用主力',
    products: [
      { vendor: '三峡 / 葛洲坝', model: '混流式水轮发电机组', spec: '单机数百 MW–GW 级' },
      { vendor: 'Voith / GE', model: '混流式 / Kaplan / 培尔顿', spec: '按水头与流量选型' },
    ],
    levels: [
      {
        id: 'hp-plant',
        name: '系统层 · 水电站 / 并网',
        nameEn: 'System: plant / grid-tied',
        summary:
          '库容与水头资源 → 机组出力 → 升压并网。路径账本是 水力 势能 → 动能 → 转动 → 电能；可用路径效率与㶲拆「水能利用系数」。',
        energyNodeIds: [
          'gravitational',
          'gravitational-hydro',
          'mechanical-gravitational-pe',
          'mechanical-kinetic',
          'mechanical-rotational',
          'electric',
          'el-current',
        ],
        edgeIds: [
          'grav-hydroelectric-electric',
          'grav-hydro-to-electric',
          'edge-grav-pe-to-electric-hydro',
          'grav-pe-to-mechanical-waterwheel',
          'mechanical-to-electric-generator',
          'mechanical-to-electric-electromagnetic-induction',
        ],
        methodIds: [
          'method-hydro-power',
          'method-algo-hydro-power',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-efficiency',
        ],
        simPaths: ['paths', 'matrix', 'fluid'],
        children: [
          {
            id: 'hp-reservoir',
            name: '水库 / 水头层 · 引力势能',
            nameEn: 'Reservoir / head: gravitational PE',
            summary:
              '水位差决定可用水头 H：势能 ~ρgQH。蓄水把 引力势能 组织成 水力水头 / 机械重力势能 账本。',
            energyNodeIds: [
              'gravitational',
              'gravitational-potential',
              'gravitational-hydro',
              'mechanical-gravitational-pe',
            ],
            edgeIds: [
              'grav-pot-to-hydro',
              'grav-hydroelectric-electric',
              'edge-grav-pe-to-electric-hydro',
            ],
            methodIds: [
              'method-algo-hydro-head',
              'method-algo-hydro-power',
              'method-algo-exergy-efficiency',
              'method-algo-exergy-lost-work',
              'method-path-efficiency',
              'method-algo-eta-product',
            ],
            simPaths: ['paths'],
            children: [
              {
                id: 'hp-penstock',
                name: '引水管层 · 势能→动能',
                nameEn: 'Penstock: PE → kinetic',
                summary:
                  '压力钢管/引水隧洞把水头加速为射流/管流动能：水力水头 → 机械动能。沿程摩阻与局部损失是第一段 η。',
                energyNodeIds: [
                  'gravitational-hydro',
                  'mechanical-gravitational-pe',
                  'mechanical-kinetic',
                  'mechanical',
                ],
                edgeIds: [
                  'gravitational-hydro-to-mechanical-kinetic',
                  'edge-grav-pe-to-kinetic-fall',
                  'grav-pe-to-mechanical-waterwheel',
                ],
                methodIds: [
                  'method-algo-hydro-head',
                  'method-hydro-power',
                  'method-ns-stable-fluids',
                  'method-algo-fluid-advect',
                  'method-algo-fluid-project',
                  'method-algo-fluid-pipeline',
                  'method-lattice-boltzmann',
                  'method-algo-eta-product',
                ],
                simPaths: ['fluid', 'convection', 'windtunnel'],
                children: [
                  {
                    id: 'hp-turbine',
                    name: '水轮机层 · 动能→轴功',
                    nameEn: 'Turbine: kinetic → rotational',
                    summary:
                      '叶片把水流平动动能转为 机械转动 轴功（混流/轴流/冲击式）。与风机同构「动能→转动」，工质是水而非空气。',
                    energyNodeIds: [
                      'mechanical-kinetic',
                      'mechanical-rotational',
                      'mechanical',
                      'acoustic',
                    ],
                    edgeIds: [
                      'edge-kinetic-to-rotational-wind',
                      'grav-pe-to-mechanical-waterwheel',
                      'gravitational-to-acoustic-hydro',
                      'mechanical-to-mechanical-transmission',
                    ],
                    methodIds: [
                      'method-algo-hydro-power',
                      'method-ns-stable-fluids',
                      'method-algo-fluid-pipeline',
                      'method-algo-fluid-obstacle',
                      'method-algo-exergy-efficiency',
                      'method-pid',
                      'method-algo-pid-step',
                    ],
                    simPaths: ['fluid', 'windtunnel'],
                    children: [
                      {
                        id: 'hp-generator',
                        name: '机电层 · 水轮发电机',
                        nameEn: 'Generator: electromagnetic',
                        summary:
                          '旋转轴功 → 电磁感应 → 工频电能。与核电/风电发电机层共享法拉第与谐振电路原子；边用汽轮发电机/感应电机相关边。',
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
                          'edge-rotational-to-electric-flywheel',
                        ],
                        methodIds: [
                          'method-hydro-power',
                          'method-algo-hydro-power',
                          'method-algo-faraday',
                          'method-lumped-circuit',
                          'method-algo-series-rlc',
                          'method-algo-mutual',
                        ],
                        simPaths: ['faraday', 'rlc', 'mutual'],
                        children: [
                          {
                            id: 'hp-loss-ledger',
                            name: '损失账本 · 水头 / 轮机 / 电损',
                            nameEn: 'Loss ledger',
                            summary:
                              '未利用水头、空化与尾水动能、轴承与铜铁耗……用 η 连乘把「设计水能利用」拆成可解释项；水力噪声边记账空化。',
                            energyNodeIds: [
                              'gravitational-hydro',
                              'mechanical-kinetic',
                              'mechanical-rotational',
                              'electric',
                              'thermal',
                              'acoustic',
                            ],
                            edgeIds: [
                              'gravitational-to-acoustic-hydro',
                              'edge-kinetic-to-thermal-friction',
                              'electric-to-thermal-joule',
                              'grav-hydro-to-electric',
                            ],
                            methodIds: [
                              'method-algo-hydro-power',
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
