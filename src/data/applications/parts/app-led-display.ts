import type { ApplicationProfile } from '../types'

export const app_led_display: ApplicationProfile = {
    id: 'app-led-display',
    name: '发光二极管 / 显示发光',
    nameEn: 'LED / display emission',
    icon: '💡',
    category: 'device',
    blurb: '电能 → 可见光：从驱动电路下钻到带隙复合与偏振滤光（液晶并行路径）。',
    goal: { from: 'electric', to: 'em-visible' },
    familyId: 'family-optoelectronic-junction',
    familyRole: '电→光 · 发光',
    assemblyNote:
      '与光伏是同一「半导体结」家族的逆方向：光伏光→电，发光二极管电→光。深层带隙方法共享。',
    maturity: '商用',
    levels: [
      {
        id: 'led-system',
        name: '系统层 · 显示 / 照明',
        summary: '直流驱动 → 发光二极管芯片 / 有机发光像素 / 液晶背光+液晶。',
        energyNodeIds: ['electric', 'em-visible', 'radiant-luminescence'],
        edgeIds: ['el-current-to-radiant-luminescence-led'],
        methodIds: ['method-display-opto', 'method-algo-led-bandgap', 'method-algo-oled-mix'],
        simPaths: ['display'],
        children: [
          {
            id: 'led-junction',
            name: '结层 · 电致发光',
            summary: '注入载流子复合发光；带隙决定色坐标，效率受非辐射复合限制。',
            energyNodeIds: ['electric', 'el-current', 'em-visible', 'radiant-luminescence', 'thermal'],
            edgeIds: [
              'el-current-to-radiant-luminescence-led',
              'electric-to-visible-led',
              'electric-to-thermal-joule',
            ],
            methodIds: [
              'method-algo-led-bandgap',
              'method-algo-lcd-malus',
              'method-lumped-circuit',
            ],
            simPaths: ['display', 'rlc'],
            children: [
              {
                id: 'led-optics-out',
                name: '出光层 · 封装与取光',
                summary:
                  '芯片内全反射、封装折射率、微结构取光；斯涅尔/菲涅尔决定外量子效率的光学部分。',
                energyNodeIds: ['em-visible', 'radiant-luminescence', 'thermal'],
                edgeIds: [
                  'electric-to-radiant-lamp',
                  'radiant-luminescence-to-thermal-stokes',
                ],
                methodIds: [
                  'method-ray-optics',
                  'method-algo-snell',
                  'method-algo-fresnel-normal',
                  'method-algo-critical-angle',
                  'method-spectrum-viewer',
                  'method-algo-spectrum-em',
                ],
                simPaths: ['electromagnetic', 'display'],
                children: [
                  {
                    id: 'led-band-material',
                    name: '材料层 · 带隙与量子阱',
                    summary:
                      '铟镓氮 / 铝镓铟磷等合金带隙调色；非辐射复合与俄歇限制内量子效率，可用密度泛函直觉对照带边。',
                    energyNodeIds: ['chemical', 'electric', 'em-visible'],
                    methodIds: [
                      'method-dft-electronic',
                      'method-algo-dft-well',
                      'method-algo-led-bandgap',
                      'method-algo-oled-mix',
                    ],
                  },
                ],
              },
              {
                id: 'led-lcd-path',
                name: '并行路径 · 液晶偏振调制',
                summary:
                  '背光白光 + 液晶双折射 + 偏振片：马吕斯定律管透过率，与发光二极管直显不同的光阀链路。',
                energyNodeIds: ['electric', 'em-visible'],
                methodIds: [
                  'method-algo-lcd-malus',
                  'method-display-opto',
                  'method-algo-fresnel-normal',
                ],
                simPaths: ['display'],
              },
            ],
          },
        ],
      },
    ],
  }
