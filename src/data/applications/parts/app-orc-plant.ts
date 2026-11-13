import type { ApplicationProfile } from '../types'

export const app_orc_plant: ApplicationProfile = {
    id: 'app-orc-plant',
    name: '有机朗肯循环余热发电',
    nameEn: 'Organic Rankine Cycle waste-heat plant',
    icon: '♨️⚡',
    category: 'energy',
    blurb:
      '中低温废热 / 地热 → 有机工质蒸发 → 膨胀机轴功 → 发电机电能：有机朗肯把水蒸气朗肯换成低沸点工质，专吃余热品位。',
    goal: { from: 'thermal', to: 'electric' },
    familyId: 'family-orc-rankine',
    familyRole: '有机工质 · 余热/中低温热源',
    assemblyNote:
      '相对核电/火电蒸汽朗肯(核电应用热机层)：循环拓扑同为蒸发–膨胀–冷凝–加压，但工质换成 R245fa/戊烷等低沸点有机物，热端常 80–300°C。相对斯特林：同为热→机械，但 有机朗肯 是朗肯相变循环而非闭式气体循环。汇侧与水电/风机共享电磁感应发电机层。',
    maturity: '商用（余热/地热/生物质）',
    products: [
      { vendor: 'Turboden / Mitsubishi', model: '有机朗肯 机组', spec: '数百 kW–数十 MW 地热/余热' },
      { vendor: 'Ormat', model: '二元地热有机朗肯', spec: '中低温地热主力路线' },
      { vendor: '㶲 / Siemens Energy', model: '工业余热有机朗肯', spec: '水泥/钢铁/燃气轮机排烟' },
    ],
    levels: [
      {
        id: 'orc-system',
        name: '系统层 · 有机朗肯余热电站',
        nameEn: 'System: ORC waste-heat plant',
        summary:
          '废热源 → 蒸发器 → 膨胀机–发电机 → 冷凝排热。路径账本 热→机械→电能；η 受卡诺上界与有机工质相对效率约束，用朗肯/路径/㶲拆账。',
        energyNodeIds: [
          'thermal',
          'thermal-internal',
          'mechanical',
          'mechanical-rotational',
          'electric',
          'el-current',
        ],
        edgeIds: [
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
            id: 'orc-waste-heat',
            name: '热源层 · 余热 / 地热品位',
            nameEn: 'Heat source: waste / geothermal grade',
            summary:
              '排烟、夹套水、地热卤水等中低温热是源账本。热品位 Th 直接决定卡诺上界 1−Tc/Th；有机朗肯 吃的是蒸汽朗肯「吃不下」的温区。',
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
                id: 'orc-evaporator',
                name: '蒸发器层 · 热→有机工质焓',
                nameEn: 'Evaporator: heat → organic enthalpy',
                summary:
                  '废热经换热器把低沸点工质预热/蒸发/过热：热→热换热 是第一段不可逆。有限温差传热是 有机朗肯 㶲损主项之一。',
                energyNodeIds: ['thermal', 'thermal-internal', 'mechanical'],
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
                    id: 'orc-expander',
                    name: '膨胀机层 · 热→机械轴功',
                    nameEn: 'Expander: thermal → shaft work',
                    summary:
                      '高压有机蒸汽在透平/螺杆/涡旋膨胀机内做功，输出 机械转动。热→机械有机朗肯 与 朗肯 边描述这一跳；等熵效率与泄漏是中间 η。',
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
                        id: 'orc-generator',
                        name: '机电层 · 发电机',
                        nameEn: 'Generator: electromagnetic',
                        summary:
                          '膨胀机轴功 → 电磁感应 → 工频/变频电能。与风电/水电/柴发发电机层共享法拉第与谐振电路原子。',
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
                            id: 'orc-loss-ledger',
                            name: '损失账本 · 卡诺 / 朗肯 η / 冷凝',
                            nameEn: 'Loss ledger',
                            summary:
                              '冷凝器排热、换热器温差、膨胀机等熵效率、泵功与电损……用理想朗肯 η、卡诺上界与 η 连乘把「余热利用率」拆成可解释项。',
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
