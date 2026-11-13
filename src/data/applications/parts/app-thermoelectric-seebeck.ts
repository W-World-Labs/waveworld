import type { ApplicationProfile } from '../types'

export const app_thermoelectric_seebeck: ApplicationProfile = {
    id: 'app-thermoelectric-seebeck',
    name: '温差发电 / 塞贝克',
    nameEn: 'Thermoelectric generator (Seebeck)',
    icon: '🌡️⚡',
    category: 'energy',
    blurb:
      '温度差 → 电能：不是光伏结，而是热电材料的塞贝克效应。与珀尔帖制冷是同一耦合的正/逆方向。',
    goal: { from: 'thermal', to: 'electric' },
    familyId: 'family-thermoelectric',
    familyRole: '正过程 · 温差发电',
    assemblyNote:
      '热电耦合栈：ΔT → 电势（塞贝克）。逆过程通电抽热 = 珀尔帖制冷。可与光伏族嵌套：太阳→热→热电发电（太阳热电），或同位素热电衰变热→热电发电。',
    maturity: '商用（小功率）/ 示范（废热）',
    products: [
      { vendor: '通用 / 汽车尾气示范', model: '热电模块', spec: '热电优值 依赖，η 通常个位数 %' },
      { vendor: '航天', model: '同位素热电偶', spec: '核衰变热→电' },
    ],
    levels: [
      {
        id: 'teg-system',
        name: '系统层 · 热端 / 冷端 / 负载',
        summary: '热库与冷汇夹住热电堆；开路电压 ∝ ΔT，接负载后 η 受 热电优值 与热阻网络限制。',
        energyNodeIds: ['thermal', 'electric', 'el-current'],
        edgeIds: [
          'thermal-to-electric-thermoelectric',
          'thermal-to-el-current-seebeck',
        ],
        methodIds: [
          'method-algo-exergy-carnot',
          'method-algo-exergy-efficiency',
          'method-path-efficiency',
          'method-lumped-circuit',
        ],
        simPaths: ['paths', 'matrix', 'rlc'],
        children: [
          {
            id: 'teg-couple',
            name: '器件层 · p–n 热电偶',
            summary: '塞贝克系数 α、电导 σ、热导 κ 合成 热电优值=α²σT/κ；多偶串联升压。',
            energyNodeIds: ['thermal', 'el-current'],
            edgeIds: ['thermal-to-el-current-seebeck'],
            methodIds: [
              'method-algo-homog-series',
              'method-algo-homog-parallel',
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
            ],
            simPaths: ['sim', 'heaterfc'],
            children: [
              {
                id: 'teg-nested-rtg',
                name: '嵌套装配 · 同位素热电 / 太阳热电',
                summary:
                  '源可再嵌：核衰变热→热电发电，或太阳光→吸热→热电发电（太阳热电）。换源边不同，热电偶层不变。',
                energyNodeIds: ['nuclear', 'radiant-solar', 'thermal', 'electric'],
                edgeIds: [
                  'nuclear-to-electric-rtg-thermoelectric',
                  'radiant-to-electric-thermoelectric',
                ],
                methodIds: [
                  'method-algo-eta-product',
                  'method-algo-path-mc-eta',
                  'method-exergy-analysis',
                ],
                simPaths: ['paths'],
              },
            ],
          },
        ],
      },
    ],
  }
