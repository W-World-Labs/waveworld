import type { ApplicationProfile } from '../types'

export const app_alphavoltaic: ApplicationProfile = {
    id: 'app-alphavoltaic',
    name: 'α 伏特电池',
    nameEn: 'Alphavoltaic cell',
    icon: 'α⚡',
    category: 'energy',
    blurb:
      'α 衰变核能 → 高能 α 粒子在半导体结中电离 → 电子-空穴对分离成电流：核电池直接转换，无热机中间态，微功率超长寿命。',
    goal: { from: 'nuclear', to: 'electric' },
    familyId: 'family-nuclear-betavoltaic',
    familyRole: 'α 源 · 直接核→电',
    assemblyNote:
      '相对 β 伏特：结收集与载流子账本同构，源粒子从 β 电子换成 α（He²⁺，兆电子伏级、射程短、电离密度高）。相对 同位素热电发电机：同为同位素电源，但本档案不经衰变热→塞贝克，而是粒子直接在结区生电。质能边 质量→电-贝塔伏特 可对照质量亏损→电的总账。',
    maturity: '示范 / 研究（微功率）',
    products: [
      { vendor: '研究原型', model: '²⁴¹Am / ²³⁸Pu α 伏特结', spec: 'µW–mW 级，宽禁带半导体' },
      { vendor: '对照 · Betavolt / City Labs', model: 'β 伏特商用微电源', spec: '同族 β 源路径的并立产品' },
    ],
    levels: [
      {
        id: 'av-system',
        name: '系统层 · α 伏特核电池',
        nameEn: 'System: alphavoltaic battery',
        summary:
          '同位素 α 源 + 半导体结 + 引出电极。整体 η 常个位数；输出随半衰期缓变。路径 核→电能 直接跳，用 α伏特 功率原子与路径/㶲对照 β 伏特边。',
        energyNodeIds: [
          'nuclear',
          'nuclear-decay',
          'mass',
          'electric',
          'el-current',
        ],
        edgeIds: [
          'nuclear-to-electric-betavoltaic',
          'nuclear-to-electric-alphavoltaic',
          'nuclear-decay-to-electric-alphavoltaic',
          'mass-to-electric-alphavoltaic',
          'nuclear-decay-to-electric',
          'mass-to-electric-betavoltaic',
        ],
        methodIds: [
          'method-alphavoltaic',
          'method-algo-av-power',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-efficiency',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'av-source',
            name: '源层 · α 衰变同位素',
            nameEn: 'Source: alpha-emitting isotope',
            summary:
              '²⁴¹Am、²³⁸Pu 等 α 衰变把核结合能以 ~5 MeV α 动能释放。活度 A 与单粒子能量 Eα 决定理论功率上界；自吸收与封装屏蔽吃掉一部分。',
            energyNodeIds: ['nuclear', 'nuclear-decay', 'mass'],
            edgeIds: [
              'nuclear-to-electric-betavoltaic',
          'nuclear-to-electric-alphavoltaic',
          'nuclear-decay-to-electric-alphavoltaic',
          'mass-to-electric-alphavoltaic',
              'nuclear-decay-to-electric',
              'mass-to-electric-betavoltaic',
            ],
            methodIds: [
              'method-alphavoltaic',
              'method-algo-av-power',
              'method-monte-carlo',
              'method-algo-uq-mc',
              'method-path-efficiency',
            ],
            simPaths: ['paths'],
            children: [
              {
                id: 'av-transport',
                name: '输运层 · α 射程与沉积',
                nameEn: 'Transport: alpha range & deposition',
                summary:
                  'α 在固体中射程仅数十 µm：能量高度局域沉积。源厚度、钝化层与结深必须匹配射程，否则自吸收或死层损失主导。',
                energyNodeIds: ['nuclear', 'nuclear-decay', 'electric'],
                edgeIds: [
                  'nuclear-to-electric-betavoltaic',
          'nuclear-to-electric-alphavoltaic',
          'nuclear-decay-to-electric-alphavoltaic',
          'mass-to-electric-alphavoltaic',
                  'nuclear-decay-to-electric',
                ],
                methodIds: [
                  'method-alphavoltaic',
                  'method-algo-av-power',
                  'method-monte-carlo',
                  'method-algo-uq-mc',
                  'method-algo-exergy-lost-work',
                  'method-algo-eta-product',
                ],
                simPaths: ['paths'],
                children: [
                  {
                    id: 'av-junction',
                    name: '结层 · 电离与载流子收集',
                    nameEn: 'Junction: ionization & collection',
                    summary:
                      'α 在耗尽区产生大量电子-空穴对，内建电场分离成电流——机理与 β 伏特/光伏同构，但 dE/dx 与辐射损伤远更剧烈。宽禁带（SiC/金刚石）抗辐照更优。',
                    energyNodeIds: [
                      'nuclear',
                      'nuclear-decay',
                      'electric',
                      'el-current',
                    ],
                    edgeIds: [
                      'nuclear-to-electric-betavoltaic',
          'nuclear-to-electric-alphavoltaic',
          'nuclear-decay-to-electric-alphavoltaic',
          'mass-to-electric-alphavoltaic',
                      'mass-to-electric-betavoltaic',
                      'nuclear-decay-to-electric',
                    ],
                    methodIds: [
                      'method-alphavoltaic',
                      'method-algo-av-power',
                      'method-lumped-circuit',
                      'method-algo-series-rlc',
                      'method-algo-exergy-efficiency',
                      'method-algo-eta-product',
                    ],
                    simPaths: ['rlc', 'paths'],
                    children: [
                      {
                        id: 'av-load',
                        name: '负载层 · 微功率引出',
                        nameEn: 'Load: microwatt extraction',
                        summary:
                          '结电流经电极与匹配网络供微机电/传感器。铜损与漏电在 nW–µW 量级不可忽略；与 β 伏特商用链路同一套电路原子。',
                        energyNodeIds: ['electric', 'el-current', 'thermal'],
                        edgeIds: [
                          'nuclear-to-electric-betavoltaic',
          'nuclear-to-electric-alphavoltaic',
          'nuclear-decay-to-electric-alphavoltaic',
          'mass-to-electric-alphavoltaic',
                          'electric-to-thermal-joule',
                        ],
                        methodIds: [
                          'method-algo-av-power',
                          'method-lumped-circuit',
                          'method-algo-series-rlc',
                          'method-path-efficiency',
                          'method-algo-eta-product',
                        ],
                        simPaths: ['rlc', 'paths'],
                        children: [
                          {
                            id: 'av-loss-ledger',
                            name: '损失账本 · 自吸收 / 损伤 / 收集',
                            nameEn: 'Loss ledger',
                            summary:
                              '源自吸收、死层、辐射诱生缺陷、复合与焦耳热……用 α伏特功率算法 与 η 连乘把「活度×Eα」拆成可交付电功率。',
                            energyNodeIds: [
                              'nuclear',
                              'nuclear-decay',
                              'mass',
                              'electric',
                            ],
                            edgeIds: [
                              'nuclear-to-electric-betavoltaic',
          'nuclear-to-electric-alphavoltaic',
          'nuclear-decay-to-electric-alphavoltaic',
          'mass-to-electric-alphavoltaic',
                              'mass-to-electric-betavoltaic',
                              'nuclear-decay-to-electric',
                              'electric-to-thermal-joule',
                            ],
                            methodIds: [
                              'method-alphavoltaic',
                              'method-algo-av-power',
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
