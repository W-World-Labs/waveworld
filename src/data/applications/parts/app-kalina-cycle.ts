import type { ApplicationProfile } from '../types'

export const app_kalina_cycle: ApplicationProfile = {
    id: 'app-kalina-cycle',
    name: '卡林纳循环余热发电',
    nameEn: 'Kalina cycle (ammonia–water waste-heat power)',
    icon: '🧪⚡',
    category: 'energy',
    blurb:
      '中低温废热 → 氨水混合工质沸腾/分离 → 膨胀机轴功 → 发电机：卡林纳用变沸点混合物缩小传热温差，专吃余热㶲。',
    goal: { from: 'thermal', to: 'electric' },
    familyId: 'family-orc-rankine',
    familyRole: '氨水混合工质 · 卡林纳余热',
    assemblyNote:
      '相对有机朗肯电站：同属「余热→朗肯族热机→发电」装配，但工质换成 NH3–H2O 非共沸混合物；蒸发/冷凝沿滑移温度匹配热源曲线，并多出气液分离–稀溶液回热支路。热→机械边仍挂 有机朗肯 / 朗肯 / 斯特林（无独立 卡琳娜 边时的最近邻）；汇侧共享发电机层。',
    maturity: '商用示范 / 地热与工业余热',
    products: [
      { vendor: 'Wasabi Energy / Global Geothermal', model: '卡琳娜 Cycle® 机组', spec: '地热/工业余热' },
      { vendor: '㶲 / 研究堆', model: '氨水二元循环试验', spec: '中低温热源' },
      { vendor: '水泥/钢铁余热', model: '卡林纳余热岛', spec: '排烟品位匹配' },
    ],
    levels: [
      {
        id: 'kalina-system',
        name: '系统层 · 卡林纳余热电站',
        nameEn: 'System: Kalina waste-heat plant',
        summary:
          '废热源 → 氨水蒸发/分离器 → 富氨蒸汽膨胀–发电机 → 吸收/冷凝回热。路径账本 热→机械→电能；用朗肯/卡诺/路径/㶲与 有机朗肯 对照混合工质收益。',
        energyNodeIds: [
          'thermal',
          'thermal-internal',
          'mechanical',
          'mechanical-rotational',
          'electric',
          'el-current',
        ],
        edgeIds: [
          'thermal-to-mechanical-kalina',
          'thermal-to-mechanical-organic-rankine',
          'thermal-to-mechanical-rankine',
          'thermal-to-mechanical-stirling',
          'mechanical-to-electric-generator',
          'mechanical-to-electric-electromagnetic-induction',
        ],
        methodIds: [
          'method-rankine',
          'method-algo-rankine-eta',
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
            id: 'kalina-waste-heat',
            name: '热源层 · 余热品位',
            nameEn: 'Heat source: waste-heat grade',
            summary:
              '排烟、地热卤水、工艺夹套等中低温热是源账本。Th 决定卡诺上界；卡林纳用滑移沸点去贴热源冷却曲线，减少换热器㶲损。',
            energyNodeIds: ['thermal', 'thermal-internal'],
            edgeIds: [
              'thermal-to-thermal-heatexchange',
              'thermal-to-mechanical-organic-rankine',
            ],
            methodIds: [
              'method-carnot',
              'method-algo-carnot-eta',
              'method-algo-exergy-carnot',
              'method-exergy-analysis',
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
              'method-path-efficiency',
            ],
            simPaths: ['sim', 'heaterfc', 'paths'],
            children: [
              {
                id: 'kalina-boiler-separator',
                name: '锅炉/分离器层 · 氨水相变与组分分离',
                nameEn: 'Boiler & separator: NH3–H2O',
                summary:
                  '废热经换热器加热氨水溶液：部分蒸发后气液分离——富氨蒸汽去膨胀机，稀溶液经回热器节流后在吸收器与乏汽混合。热→热换热 与 有机朗肯/朗肯 边描述热→工质焓与后续做功预备。',
                energyNodeIds: ['thermal', 'thermal-internal', 'chemical', 'mechanical'],
                edgeIds: [
                  'thermal-to-thermal-heatexchange',
                  'thermal-to-mechanical-organic-rankine',
                  'thermal-to-mechanical-rankine',
                ],
                methodIds: [
                  'method-rankine',
                  'method-algo-rankine-eta',
                  'method-heat-ftcs',
                  'method-algo-heat-ftcs-step',
                  'method-algo-exergy-lost-work',
                  'method-algo-exergy-efficiency',
                  'method-ns-stable-fluids',
                  'method-algo-fluid-pipeline',
                ],
                simPaths: ['sim', 'fluid', 'convection'],
                children: [
                  {
                    id: 'kalina-expander',
                    name: '膨胀机层 · 热→机械轴功',
                    nameEn: 'Expander: thermal → shaft work',
                    summary:
                      '高压富氨蒸汽在透平/螺杆膨胀机内做功，输出 机械转动。无独立 卡琳娜 边时挂 有机朗肯 / 朗肯 / 热机 / 斯特林 近邻；等熵效率、湿蒸汽与泄漏是中间 η。',
                    energyNodeIds: [
                      'thermal',
                      'thermal-internal',
                      'mechanical',
                      'mechanical-kinetic',
                      'mechanical-rotational',
                    ],
                    edgeIds: [
                      'thermal-to-mechanical-organic-rankine',
                      'thermal-to-mechanical-rankine',
                      'thermal-internal-to-mechanical-heatengine',
                      'thermal-to-mechanical-stirling',
                      'edge-kinetic-to-thermal-friction',
                    ],
                    methodIds: [
                      'method-rankine',
                      'method-algo-rankine-eta',
                      'method-carnot',
                      'method-algo-carnot-eta',
                      'method-algo-eta-product',
                      'method-algo-exergy-lost-work',
                      'method-algo-exergy-efficiency',
                      'method-pid',
                      'method-algo-pid-step',
                    ],
                    simPaths: ['paths', 'fluid'],
                    children: [
                      {
                        id: 'kalina-generator',
                        name: '机电层 · 发电机',
                        nameEn: 'Generator: electromagnetic',
                        summary:
                          '膨胀机轴功 → 电磁感应 → 电能。与有机朗肯/水电/风机/柴发共享法拉第与谐振电路原子；吸收器–冷凝支路的泵功从净输出中扣除。',
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
                            id: 'kalina-loss-ledger',
                            name: '损失账本 · 卡诺 / 朗肯 η / 吸收冷凝',
                            nameEn: 'Loss ledger',
                            summary:
                              '换热器有限温差、分离不可逆、膨胀机等熵效率、泵功、吸收器混合与电损……用朗肯 η、卡诺上界与 η 连乘把「氨水增益」拆成可解释项。',
                            energyNodeIds: [
                              'thermal',
                              'mechanical-rotational',
                              'electric',
                            ],
                            edgeIds: [
                              'thermal-to-mechanical-organic-rankine',
                              'thermal-to-thermal-heatexchange',
                              'edge-kinetic-to-thermal-friction',
                              'electric-to-thermal-joule',
                              'mechanical-to-electric-generator',
                            ],
                            methodIds: [
                              'method-algo-rankine-eta',
                              'method-algo-carnot-eta',
                              'method-algo-eta-product',
                              'method-algo-exergy-lost-work',
                              'method-algo-exergy-efficiency',
                              'method-path-efficiency',
                              'method-algo-path-mc-eta',
                              'method-exergy-analysis',
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
