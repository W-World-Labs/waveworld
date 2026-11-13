import type { ApplicationProfile } from '../types'

export const app_thermionic_converter: ApplicationProfile = {
    id: 'app-thermionic-converter',
    name: '热电子发电',
    nameEn: 'Thermionic energy converter',
    icon: '🔥⚡',
    category: 'energy',
    blurb:
      '高温阴极热电子发射（理查逊–杜什曼）→ 跨间隙飞向冷阳极 → 外电路电流：热能直接转电能，无旋转机械中间轴。',
    goal: { from: 'thermal', to: 'electric' },
    familyId: 'family-thermionic-converter',
    familyRole: '真空/等离子热离子 · 热源',
    assemblyNote:
      '相对塞贝克热电：同为静默热→电，但机理是热电子逸出与间隙输运而非固体扩散温差电动势。相对 光子增强热电子发射/光增强热离子：本档案以纯热阴极为主；光子增强边 光子增强热离子发电 可作换源变体。核热离子(核热离子发电)是源换核能的并立装配。',
    maturity: '特种 / 空间与高温研究',
    products: [
      { vendor: 'Spark Thermionics', model: '热离子热电联供 / 研究模块', spec: '高温阴极示范' },
      { vendor: '空间电源（历史）', model: '热离子堆/转换器', spec: '核热源 + 热离子' },
    ],
    levels: [
      {
        id: 'tic-system',
        name: '系统层 · 热离子转换器',
        nameEn: 'System: thermionic converter',
        summary:
          '热源 → 阴极发射 → 间隙输运 → 阳极集电 → 负载。顶层边 热→电热离子；路径效率与卡诺/㶲对照「名牌 η 5–20%」。',
        energyNodeIds: ['thermal', 'thermal-internal', 'electric', 'el-current'],
        edgeIds: [
          'thermal-to-electric-thermionic',
          'thermal-to-electric-thermionic-richardson',
        ],
        methodIds: [
          'method-thermionic-emission',
          'method-algo-richardson-current',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-algo-path-mc-eta',
          'method-exergy-analysis',
          'method-algo-exergy-carnot',
          'method-algo-exergy-efficiency',
        ],
        simPaths: ['paths', 'matrix'],
        children: [
          {
            id: 'tic-heat-source',
            name: '热源层 · 阴极加热',
            nameEn: 'Heat source: cathode heating',
            summary:
              '燃烧、聚光、核衰变或废热把阴极维持在 ~1500–2000 K。热品位决定卡诺上界；核热离子可挂 核热离子发电。',
            energyNodeIds: ['thermal', 'thermal-internal', 'nuclear', 'chemical'],
            edgeIds: [
              'thermal-to-electric-thermionic',
              'thermal-to-electric-thermionic-richardson',
              'nuclear-to-electric-thermionic',
              'chemical-to-thermal-combustion',
            ],
            methodIds: [
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
              'method-algo-exergy-carnot',
              'method-carnot',
              'method-algo-carnot-eta',
              'method-thermionic-emission',
            ],
            simPaths: ['sim', 'paths'],
            children: [
              {
                id: 'tic-emission',
                name: '发射层 · 理查森电流',
                nameEn: 'Emission: Richardson–Dushman',
                summary:
                  'J = A T² exp(−φ/kT)：功函数 φ 与阴极温度决定饱和发射电流密度。理查逊电流算法是可动手原子。',
                energyNodeIds: ['thermal', 'electric', 'el-current'],
                edgeIds: [
                  'thermal-to-electric-thermionic',
                  'thermal-to-electric-thermionic-richardson',
                ],
                methodIds: [
                  'method-thermionic-emission',
                  'method-algo-richardson-current',
                  'method-algo-exergy-carnot',
                  'method-heat-ftcs',
                  'method-particle-in-cell',
                  'method-algo-pic-push',
                ],
                simPaths: ['sim', 'paths'],
                children: [
                  {
                    id: 'tic-gap',
                    name: '间隙层 · 空间电荷 / 铯',
                    nameEn: 'Gap: space charge / Cs',
                    summary:
                      '真空或低气压铯蒸气中电子云形成空间电荷势垒，限制净电流；中和与电极间距是工程核心。可用 粒子网格 作教学类比。',
                    energyNodeIds: [
                      'thermal',
                      'electric',
                      'el-current',
                      'electromagnetic',
                    ],
                    edgeIds: [
                      'thermal-to-electric-thermionic',
                      'em-to-electric-photon-enhanced-thermionic',
                    ],
                    methodIds: [
                      'method-thermionic-emission',
                      'method-algo-richardson-current',
                      'method-particle-in-cell',
                      'method-algo-pic-cic',
                      'method-algo-pic-boris',
                      'method-vlasov',
                      'method-algo-vlasov-stream',
                    ],
                    simPaths: ['paths'],
                    children: [
                      {
                        id: 'tic-collector',
                        name: '集电 / 负载层 · 阳极→外电路',
                        nameEn: 'Collector & load',
                        summary:
                          '冷阳极收集电子，外电路形成电流；接触电位差与负载匹配决定工作点。集总电路描述 伏安。',
                        energyNodeIds: ['electric', 'el-current', 'thermal'],
                        edgeIds: [
                          'thermal-to-electric-thermionic',
                          'electric-to-thermal-joule',
                        ],
                        methodIds: [
                          'method-algo-richardson-current',
                          'method-lumped-circuit',
                          'method-algo-series-rlc',
                          'method-algo-exergy-efficiency',
                          'method-path-efficiency',
                        ],
                        simPaths: ['rlc', 'paths'],
                        children: [
                          {
                            id: 'tic-loss-ledger',
                            name: '损失账本 · 辐射 / 空间电荷 / 焦耳',
                            nameEn: 'Loss ledger',
                            summary:
                              '阴极热辐射、间隙势垒、电极导热与负载焦耳热……η 连乘与㶲损失把「理想理查森」拆成器件净效率。',
                            energyNodeIds: ['thermal', 'electric', 'radiant'],
                            edgeIds: [
                              'thermal-to-electric-thermionic',
                              'electric-to-thermal-joule',
                              'radiant-to-electric-photothermionic',
                            ],
                            methodIds: [
                              'method-algo-richardson-current',
                              'method-algo-eta-product',
                              'method-algo-exergy-lost-work',
                              'method-algo-exergy-efficiency',
                              'method-algo-exergy-carnot',
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
