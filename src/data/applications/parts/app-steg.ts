import type { ApplicationProfile } from '../types'

export const app_steg: ApplicationProfile = {
    id: 'app-steg',
    name: '太阳热电',
    nameEn: 'Solar thermoelectric generator',
    icon: '☀️🌡️',
    category: 'energy',
    blurb:
      '太阳辐射 → 热能 → 电能：吸收体把光变成热端温差，再经塞贝克热电偶发电。不是 p–n 光伏结，而是「光热集热 + 热电」两跳嵌套。',
    goal: { from: 'radiant-solar', to: 'electric' },
    familyId: 'family-steg',
    familyRole: '太阳源 · 光热塞贝克',
    assemblyNote:
      '相对光伏族：源同为 太阳辐射，但中段换成 辐射→热能 集热，汇侧用热电偶而非 p–n 光生伏。相对热电族(热电族)：热电发电 器件层不变，源从废热/核热换成太阳吸热体。可与 热光伏 对照：热光伏 是热→红外→光伏结，S热电发电 是热→ΔT→塞贝克。',
    maturity: '实验 / 小众示范',
    products: [
      { vendor: 'MIT / 实验室', model: '聚光太阳热电单元', spec: '峰值 η ~7–8% 量级' },
      { vendor: 'Marlow / II-VI', model: 'Bi₂Te₃ 热电模块 + 吸热涂层', spec: '非聚光 1–5%' },
    ],
    levels: [
      {
        id: 'steg-system',
        name: '系统层 · 光热–热电联装',
        nameEn: 'System: solar thermal + thermoelectric',
        summary:
          '入射太阳 → 吸收体升温 → 冷端散热 → 热电堆驱动负载。路径效率 = 光学/热收集 η × 塞贝克 η，用连乘与㶲拆账。',
        energyNodeIds: ['radiant-solar', 'thermal', 'electric', 'el-current'],
        edgeIds: [
          'radiant-to-electric-thermoelectric',
          'radiant-solar-to-thermal-collector',
          'thermal-to-electric-thermoelectric',
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
            id: 'steg-collector',
            name: '集热层 · 辐射→热',
            nameEn: 'Collector: radiant → thermal',
            summary:
              '选择性吸收涂层 / 聚光把 太阳辐射 变成热端内能；光学截距与 (Tm−Ta)/G 热损决定瞬时收集效率。',
            energyNodeIds: ['radiant-solar', 'thermal', 'em-ir', 'em-visible'],
            edgeIds: [
              'radiant-solar-to-thermal-collector',
              'edge-solar-to-thermal-collector',
              'radiant-to-thermal-absorption',
              'radiant-to-thermal-photothermal-conversion',
            ],
            methodIds: [
              'method-spectrum-viewer',
              'method-algo-spectrum-em',
              'method-ray-optics',
              'method-algo-fresnel-normal',
              'method-algo-exergy-carnot',
            ],
            simPaths: ['electromagnetic'],
            children: [
              {
                id: 'steg-teg',
                name: '热电层 · 塞贝克发电',
                nameEn: 'Thermoelectric layer: Seebeck',
                summary:
                  '热端/冷端夹住 p–n 热电偶：V∝αΔT。与 塞贝克热电应用 同构——换的是热源边，不是另一套 昂萨格 耦合。',
                energyNodeIds: ['thermal', 'electric', 'el-current'],
                edgeIds: [
                  'thermal-to-electric-thermoelectric',
                  'thermal-to-el-current-seebeck',
                  'thermal-internal-to-electric-thermoelectric',
                ],
                methodIds: [
                  'method-lumped-circuit',
                  'method-algo-homog-series',
                  'method-algo-homog-parallel',
                  'method-algo-exergy-efficiency',
                  'method-heat-ftcs',
                ],
                simPaths: ['rlc', 'sim', 'paths'],
                children: [
                  {
                    id: 'steg-couple',
                    name: '器件层 · 优值与热阻网络',
                    nameEn: 'Couple: ZT & thermal network',
                    summary:
                      '热电优值=α²σT/κ 与热阻匹配：吸热体、热电模块、散热器串联。深层热扩散与 η 连乘可复用热电族方法。',
                    energyNodeIds: ['thermal', 'thermal-internal', 'el-current'],
                    edgeIds: ['thermal-to-el-current-seebeck', 'thermal-to-thermal-heatexchange'],
                    methodIds: [
                      'method-heat-ftcs',
                      'method-algo-heat-ftcs-step',
                      'method-algo-heat-erfc',
                      'method-algo-eta-product',
                      'method-algo-exergy-lost-work',
                    ],
                    simPaths: ['sim', 'heaterfc'],
                    children: [
                      {
                        id: 'steg-vs-pv',
                        name: '对照层 · 相对光伏 / 热光伏',
                        nameEn: 'Contrast: vs PV & thermophotovoltaic',
                        summary:
                          '同太阳源：光伏直接光子→载流子；太阳热电多一跳热；热光伏是热→红外→光伏结。路径蒙特卡洛与㶲效率用于比较「嵌套代价」。',
                        energyNodeIds: ['radiant-solar', 'thermal', 'em-ir', 'electric'],
                        edgeIds: [
                          'radiant-solar-to-electric-photovoltaic',
                          'radiant-to-electric-thermoelectric',
                          'thermal-to-electric-thermophotovoltaic',
                        ],
                        methodIds: [
                          'method-algo-path-mc-eta',
                          'method-algo-eta-product',
                          'method-algo-exergy-efficiency',
                          'method-shockley-queisser',
                          'method-algo-sq-limit',
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
