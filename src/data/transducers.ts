/**
 * 换能器百科：工程叙事目录。
 * from/to 保留中文标签供展示；fromNodeId/toNodeId 可选挂到能量本体（多轨并存）。
 * nameEn / principleEn / fromEn / toEn / appsEn 为 i18n 叠层，不覆盖中文源。
 * 「信息/智能」等尚未成为 NODES 顶层的出口，故意不挂 node id（见 information-energy 争议）。
 */
export interface Transducer {
  name: string
  nameEn?: string
  from: string
  fromEn?: string
  to: string
  toEn?: string
  /** 可选：挂 NODES id，便于图谱/矩阵互链；未挂 = 仅百科叙事 */
  fromNodeId?: string
  toNodeId?: string
  principle: string
  principleEn?: string
  efficiency: string
  apps: string[]
  appsEn?: string[]
  icon: string
}

// 换能器：把一种能量形式转换为另一种的器件。世界由无数换能器串联而成。
export const TRANSDUCERS: Transducer[] = [
  {
    name: '光电效应换能器',
    nameEn: 'Photoelectric transducer',
    from: '光能',
    fromEn: 'Light / radiant',
    to: '电能',
    toEn: 'Electric',
    fromNodeId: 'em-visible',
    toNodeId: 'electric',
    principle: '光子激发半导体中的电子-空穴对，在 PN 结电场下形成电流。',
    principleEn:
      'Photons generate electron–hole pairs in a semiconductor; the PN-junction field drives current.',
    efficiency: '20–47%',
    apps: ['光伏电站', '相机传感器', '光电探测'],
    appsEn: ['PV plants', 'Camera sensors', 'Photodetection'],
    icon: '☀️',
  },
  {
    name: '压电换能器',
    nameEn: 'Piezoelectric transducer',
    from: '机械能',
    fromEn: 'Mechanical',
    to: '电能',
    toEn: 'Electric',
    fromNodeId: 'mechanical',
    toNodeId: 'electric',
    principle: '晶体受力时正负电荷中心错位产生电压，可逆。',
    principleEn:
      'Mechanical stress shifts charge centers in a crystal, producing a reversible voltage.',
    efficiency: '50–80%',
    apps: ['超声探头', '麦克风', '振动能量收集', '点火器'],
    appsEn: ['Ultrasound probes', 'Microphones', 'Vibration energy harvesting', 'Igniters'],
    icon: '🔲',
  },
  {
    name: '电磁感应换能器',
    nameEn: 'Electromagnetic induction transducer',
    from: '机械能',
    fromEn: 'Mechanical',
    to: '电能',
    toEn: 'Electric',
    fromNodeId: 'mechanical',
    toNodeId: 'electric',
    principle: '导体在变化磁场中切割磁感线，感应出电动势（法拉第定律）。',
    principleEn:
      'A conductor in a changing magnetic field induces an emf (Faraday’s law).',
    efficiency: '> 95%',
    apps: ['发电机', '电动机', '变压器', '动圈麦克风'],
    appsEn: ['Generators', 'Motors', 'Transformers', 'Dynamic microphones'],
    icon: '🧲',
  },
  {
    name: '热电换能器',
    nameEn: 'Thermoelectric transducer',
    from: '热能',
    fromEn: 'Thermal',
    to: '电能',
    toEn: 'Electric',
    fromNodeId: 'thermal',
    toNodeId: 'electric',
    principle: '塞贝克效应：温差驱动载流子扩散形成电势差。',
    principleEn:
      'Seebeck effect: a temperature difference drives carrier diffusion into a voltage.',
    efficiency: '5–15%',
    apps: ['余热回收', '深空探测器 RTG', '温差传感'],
    appsEn: ['Waste-heat recovery', 'Deep-space RTG', 'Temperature-difference sensing'],
    icon: '🌡️',
  },
  {
    name: '化学电池',
    nameEn: 'Chemical battery',
    from: '化学能',
    fromEn: 'Chemical',
    to: '电能',
    toEn: 'Electric',
    fromNodeId: 'chemical',
    toNodeId: 'electric',
    principle: '氧化还原反应在两极间转移电子，对外输出电流。',
    principleEn:
      'Redox reactions transfer electrons between electrodes, delivering external current.',
    efficiency: '80–99%',
    apps: ['锂电池', '燃料电池', '储能'],
    appsEn: ['Li-ion batteries', 'Fuel cells', 'Energy storage'],
    icon: '🔋',
  },
  {
    name: '扬声器',
    nameEn: 'Loudspeaker',
    from: '电能',
    fromEn: 'Electric',
    to: '声能',
    toEn: 'Acoustic',
    fromNodeId: 'electric',
    toNodeId: 'acoustic',
    principle: '音圈在磁场中随电流振动，推动振膜压缩空气。',
    principleEn:
      'A voice coil vibrates in a magnetic field with the drive current, moving a diaphragm that compresses air.',
    efficiency: '1–5%',
    apps: ['音响', '耳机', '声呐发射'],
    appsEn: ['Loudspeakers', 'Headphones', 'Sonar transmit'],
    icon: '📢',
  },
  {
    name: '算力推理引擎',
    nameEn: 'Compute / inference engine',
    from: '电能',
    fromEn: 'Electric',
    to: '信息 / 智能',
    toEn: 'Information / intelligence',
    fromNodeId: 'electric',
    // toNodeId 故意省略：信息↔能量仍属争议（见 CONTROVERSIES information-energy）
    principle: '电能驱动数十亿晶体管做矩阵运算，把电流转化为可计量的智能令牌。',
    principleEn:
      'Electric power drives billions of transistors through matrix ops, turning current into measurable intelligence tokens.',
    efficiency: '见「能量→令牌链」',
    apps: ['大模型推理', '生成式 AI', '科学计算'],
    appsEn: ['LLM inference', 'Generative AI', 'Scientific computing'],
    icon: '🧠',
  },
  {
    name: '光合作用',
    nameEn: 'Photosynthesis',
    from: '光能',
    fromEn: 'Light / radiant',
    to: '化学能',
    toEn: 'Chemical',
    fromNodeId: 'em-visible',
    toNodeId: 'chemical',
    principle: '叶绿体将光子能量固定为葡萄糖中的化学键，地球生命的能量源头。',
    principleEn:
      'Chloroplasts fix photon energy into chemical bonds of glucose—the energy root of life on Earth.',
    efficiency: '1–6%',
    apps: ['植物', '藻类', '碳循环'],
    appsEn: ['Plants', 'Algae', 'Carbon cycle'],
    icon: '🌿',
  },
]
