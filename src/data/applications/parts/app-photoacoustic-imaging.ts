import type { ApplicationProfile } from '../types'

export const app_photoacoustic_imaging: ApplicationProfile = {
    id: 'app-photoacoustic-imaging',
    name: '光声成像',
    nameEn: 'Photoacoustic imaging',
    icon: '🔦🔊',
    category: 'sensing',
    blurb:
      '脉冲光 → 组织吸收升温 → 热弹压力波 → 超声探测成像：光学对比度 + 超声分辨率的混合模态。',
    goal: { from: 'radiant', to: 'acoustic' },
    familyId: 'family-photoacoustic',
    familyRole: '成像 · 光致热弹声',
    assemblyNote:
      '相对超声 B 超(超声成像应用)：接收链同为声传播与压电探测，但发射源从电驱动压电换成调制/脉冲光吸收。相对纯光学成像：信息载体中段换成 声能，穿透与对比机制重组。',
    maturity: '临床转化 / 研究商用',
    products: [
      { vendor: 'iThera / Seno / 研究系统', model: 'MSOT / PAI 平台', spec: '近红外多光谱光声' },
      { vendor: '实验室', model: '激光 + 线阵探头', spec: '光学分辨率光声显微' },
    ],
    levels: [
      {
        id: 'pai-system',
        name: '系统层 · 光声成像仪',
        nameEn: 'System: PAI scanner',
        summary:
          '光源–照射–吸收–声发射–接收–重建。顶层边 辐射→声能（光声）；路径效率把光学剂量与探测灵敏度连成一条账。',
        energyNodeIds: ['radiant', 'radiant-laser', 'em-visible', 'em-ir', 'thermal', 'acoustic', 'electric'],
        edgeIds: [
          'radiant-to-acoustic-photoacoustic',
          'radiant-laser-to-acoustic-photoacoustic',
          'em-visible-to-acoustic-photoacoustic',
          'em-ir-to-acoustic-photoacoustic',
          'electromagnetic-to-acoustic-photoacoustic',
        ],
        methodIds: [
          'method-photoacoustic',
          'method-algo-pa-pressure',
          'method-path-efficiency',
          'method-algo-eta-product',
          'method-b-mode-ultrasound',
          'method-spectrum-viewer',
          'method-algo-spectrum-em',
        ],
        simPaths: ['paths', 'ultrasound', 'electromagnetic'],
        children: [
          {
            id: 'pai-illumination',
            name: '照射 / 吸收层 · 光→热',
            nameEn: 'Illumination: radiant → thermal',
            summary:
              '脉冲激光/发光二极管在组织色团处被吸收，局部升温。辐射/可见光/红外 → 热能 是光声链的第一跳；光谱决定对比源（Hb、黑色素、造影剂）。',
            energyNodeIds: [
              'radiant',
              'radiant-laser',
              'em-visible',
              'em-ir',
              'thermal',
              'thermal-internal',
            ],
            edgeIds: [
              'radiant-to-thermal-absorption',
              'radiant-to-thermal-photothermal-conversion',
              'radiant-laser-to-thermal-absorption',
              'em-visible-to-thermal-absorption',
              'em-ir-to-thermal-longwave-absorption',
            ],
            methodIds: [
              'method-spectrum-viewer',
              'method-algo-spectrum-em',
              'method-ray-optics',
              'method-algo-fresnel-normal',
              'method-heat-ftcs',
              'method-algo-heat-ftcs-step',
            ],
            simPaths: ['electromagnetic', 'sim', 'heaterfc'],
            children: [
              {
                id: 'pai-thermoelastic',
                name: '热弹层 · 热→声压',
                nameEn: 'Thermoelastic: thermal → acoustic',
                summary:
                  '约束热膨胀产生初始声压 p₀∝Γ·μ_a·Φ（格吕奈森 × 吸收 × 通量）。光声边与 热声 边描述这一跳。',
                energyNodeIds: ['thermal', 'thermal-internal', 'acoustic', 'acoustic-ultrasound'],
                edgeIds: [
                  'radiant-to-acoustic-photoacoustic',
                  'radiant-laser-to-acoustic-photoacoustic',
                  'em-visible-to-acoustic-photoacoustic',
                  'thermal-to-acoustic-thermoacoustic',
                ],
                methodIds: [
                  'method-photoacoustic',
                  'method-algo-pa-pressure',
                  'method-heat-ftcs',
                  'method-algo-heat-erfc',
                  'method-wave-fd',
                  'method-algo-wave-leapfrog',
                  'method-algo-wave-laplacian',
                  'method-comsol-style-multiphysics',
                  'method-algo-partitioned-coupling',
                ],
                simPaths: ['sim', 'ripple', 'sound'],
                children: [
                  {
                    id: 'pai-propagate-detect',
                    name: '传播 / 探测层 · 声→电',
                    nameEn: 'Propagate & detect: acoustic → electric',
                    summary:
                      '宽带超声在组织中传播并衰减，压电/电容微机械超声探头把声能转为电信号。与 B 超接收链同构。',
                    energyNodeIds: [
                      'acoustic',
                      'acoustic-ultrasound',
                      'electric',
                      'el-current',
                      'mechanical',
                    ],
                    edgeIds: [
                      'acoustic-to-electric-piezoelectric',
                      'acoustic-to-electric-microphone',
                      'acoustic-ultrasound-to-electric-piezo-harvest',
                      'acoustic-to-thermal-absorption',
                      'acoustic-to-electric-capacitive',
                    ],
                    methodIds: [
                      'method-photoacoustic',
                      'method-algo-pa-pressure',
                      'method-b-mode-ultrasound',
                      'method-algo-us-reflection',
                      'method-algo-us-aline',
                      'method-wave-fd',
                      'method-algo-wave-leapfrog',
                      'method-algo-spectrum-sound',
                    ],
                    simPaths: ['ultrasound', 'sound', 'ripple'],
                    children: [
                      {
                        id: 'pai-reconstruct',
                        name: '重建层 · 波束 / 反投影成像',
                        nameEn: 'Reconstruction: beamform / invert',
                        summary:
                          '延时求和、模型反演或频域重建把多通道声压变成吸收分布图像；阵列因子与 B 帧原子可复用超声方法。',
                        energyNodeIds: ['acoustic', 'electric', 'radiant'],
                        edgeIds: [
                          'radiant-to-acoustic-photoacoustic',
                          'acoustic-to-electric-piezoelectric',
                        ],
                        methodIds: [
                          'method-algo-pa-pressure',
                          'method-array-beamforming',
                          'method-algo-array-factor',
                          'method-algo-us-bmode-compose',
                          'method-algo-mvdr-weights',
                          'method-fft',
                          'method-algo-fft-periodogram',
                          'method-wavelet',
                          'method-algo-haar-dwt',
                        ],
                        simPaths: ['ultrasound', 'phasedarray'],
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
