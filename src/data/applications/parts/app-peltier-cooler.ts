import type { ApplicationProfile } from '../types'

export const app_peltier_cooler: ApplicationProfile = {
    id: 'app-peltier-cooler',
    name: '半导体制冷 / 珀尔帖',
    nameEn: 'Peltier thermoelectric cooler',
    icon: '❄️',
    category: 'device',
    blurb:
      '电能 → 热泵：与塞贝克同一热电耦合，方向反过来——通电在冷端吸热、热端放热。',
    goal: { from: 'electric', to: 'thermal' },
    familyId: 'family-thermoelectric',
    familyRole: '逆过程 · 电驱动热泵',
    assemblyNote:
      '相对温差发电：目标 对调（电→热）。材料仍是热电偶；方程是 昂萨格 互易下的逆效应。再通电发热的焦耳支路可嵌电阻加热边。',
    maturity: '商用',
    products: [
      { vendor: '通用 TEC 模块', model: 'TEC1 系列等', spec: '小温差制冷 / CPU 水冷辅助' },
    ],
    levels: [
      {
        id: 'tec-system',
        name: '系统层 · 冷端负载 + 热端散热',
        summary: '电流驱动：冷面吸热、热面必须把 Q 排走，否则温差塌掉。',
        energyNodeIds: ['electric', 'el-current', 'thermal'],
        edgeIds: ['electric-to-thermal-peltier', 'electric-to-thermal-resistive'],
        methodIds: [
          'method-lumped-circuit',
          'method-algo-series-rlc',
          'method-heat-ftcs',
          'method-algo-exergy-carnot',
        ],
        simPaths: ['rlc', 'sim', 'paths'],
        children: [
          {
            id: 'tec-couple',
            name: '器件层 · 珀尔帖偶',
            summary: 'Q_p = Π I − ½ I²R ± KΔT：帕尔帖项、焦耳热、热回流同时存在。',
            energyNodeIds: ['el-current', 'thermal'],
            edgeIds: ['electric-to-thermal-peltier'],
            methodIds: [
              'method-algo-heat-ftcs-step',
              'method-algo-heat-erfc',
              'method-algo-exergy-lost-work',
            ],
            simPaths: ['sim', 'heaterfc'],
            children: [
              {
                id: 'tec-vs-seebeck',
                name: '互易说明 · 与塞贝克同族',
                summary:
                  '同一 α、κ、σ：开路测 ΔV/ΔT 是塞贝克；短热端测制冷是珀尔帖。族内跳到「温差发电」只是换工作点。',
                methodIds: [
                  'method-algo-exergy-efficiency',
                  'method-path-efficiency',
                ],
                simPaths: ['paths', 'matrix'],
              },
            ],
          },
        ],
      },
    ],
  }
